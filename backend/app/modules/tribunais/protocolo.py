"""Protocolo de petições (seções 10–13): validação, aprovação humana, assinatura, envio pela fila e retorno.

Regras de ouro:
- o robô nunca assina sozinho: só envia com aprovação do titular do certificado sobre ESTE conteúdo (hash);
- protocolo nunca é reenviado automaticamente; em falha de rede, consulta antes (status "verificar");
- guarda tudo: resposta bruta, recibo e hashes dos documentos enviados.
"""

import hashlib
import io
import json
import logging
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import agora
from app.core.models import Usuario
from app.modules.tribunais import adaptadores, cnj, cobranca
from app.modules.tribunais import certificado as cert_mod
from app.modules.tribunais import service as svc
from app.modules.tribunais.models import (
    Aprovacao,
    Processo,
    Protocolo,
    ProtocoloDocumento,
    RetornoProtocolo,
    Sistema,
    TabelaLocal,
)

log = logging.getLogger(__name__)

EDITAVEIS = ("rascunho", "aprovado", "erro")
CAMPOS_ENDERECO = ("cep", "logradouro", "numero", "bairro", "cidade", "uf")


class ErroProtocolo(ValueError):
    pass


# --------------------------------------------------------------------------------------------- conteúdo e hash
def hash_conteudo(p: Protocolo) -> str:
    """O que o advogado aprova. Qualquer mudança aqui invalida a aprovação."""
    base = {
        "tipo": p.tipo, "numero_cnj": p.numero_cnj, "tribunal": p.tribunal_id, "grau": p.grau, "cabecalho": p.cabecalho,
        "partes": p.partes, "conteudo_peca": p.conteudo_peca, "tipo_peticao": p.tipo_peticao_codigo, "polo": p.polo_peticionante,
        "parte_ids": sorted(p.parte_ids or []), "sigilo": p.nivel_sigilo, "urgente": p.pedido_urgente,
        "documentos": [[d.ordem, d.tipo_documento_codigo, d.descricao, d.hash_sha256, d.nivel_sigilo] for d in
                       sorted(p.documentos, key=lambda x: x.ordem)],
    }
    return hashlib.sha256(json.dumps(base, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def aprovacao_valida(p: Protocolo) -> Aprovacao | None:
    a = next((a for a in reversed(p.aprovacoes) if not a.invalidada_em), None)
    return a if a and a.hash_conteudo_aprovado == hash_conteudo(p) else None


def depois_de_editar(db: Session, p: Protocolo) -> None:
    """Conteúdo mudou: aprovações antigas deixam de valer."""
    if p.status not in EDITAVEIS:
        raise ErroProtocolo("Este protocolo está na fila ou já foi enviado: não dá para alterar.")
    h = hash_conteudo(p)
    for a in p.aprovacoes:
        if not a.invalidada_em and a.hash_conteudo_aprovado != h:
            a.invalidada_em = agora()
    if p.status == "aprovado" and not aprovacao_valida(p):
        p.status = "rascunho"


# ---------------------------------------------------------------------------------------------------- documentos
def analisar_pdf(dados: bytes) -> tuple[int | None, bool | None, str | None]:
    """(páginas, pesquisável, erro)."""
    from pypdf import PdfReader

    try:
        r = PdfReader(io.BytesIO(dados))
        texto = "".join((pg.extract_text() or "") for pg in r.pages[:3])
        return len(r.pages), bool(texto.strip()), None
    except Exception as e:  # noqa: BLE001
        return None, None, f"PDF inválido ou corrompido ({e.__class__.__name__})."


def adicionar_documento(db: Session, p: Protocolo, nome: str, dados: bytes, mimetype: str, *, tipo_nome: str, descricao: str,
                        tipo_codigo: str | None = None, ordem: int | None = None, nivel_sigilo: int = 0) -> ProtocoloDocumento:
    if p.status not in EDITAVEIS:
        raise ErroProtocolo("Este protocolo não aceita mais documentos.")
    if not dados:
        raise ErroProtocolo("Arquivo vazio.")
    paginas = pesquisavel = None
    if mimetype == "application/pdf" or nome.lower().endswith(".pdf"):
        mimetype = "application/pdf"
        paginas, pesquisavel, erro = analisar_pdf(dados)
        if erro:
            raise ErroProtocolo(erro)
    h = svc.sha256(dados)
    caminho = svc.guardar(p.tenant_id, f"protocolos/{p.id}", f"{h[:12]}-{nome}", dados)
    d = ProtocoloDocumento(protocolo_id=p.id, ordem=ordem or (max([x.ordem for x in p.documentos], default=0) + 1),
                           tipo_documento_codigo=tipo_codigo, tipo_documento_nome=tipo_nome, descricao=descricao[:300],
                           nome_arquivo=nome[:255], arquivo_ref=caminho, mimetype=mimetype, tamanho_bytes=len(dados), hash_sha256=h,
                           paginas=paginas, pesquisavel=pesquisavel, nivel_sigilo=nivel_sigilo)
    p.documentos.append(d)
    db.flush()
    depois_de_editar(db, p)
    return d


# ---------------------------------------------------------------------------------------------------- validação
def _modo_real(db: Session, tenant_id: int) -> bool:
    return svc.config(db, tenant_id).modo == "real" and settings.ambiente == "prod"


def sistema_do_protocolo(db: Session, p: Protocolo) -> Sistema | None:
    """Regra 1: o sistema de HOJE (o processo pode ter migrado desde a importação)."""
    proc = p.processo
    return svc.sistema_atual(p.tribunal, p.grau, proc.sistema_nome if proc else None)


def _endereco_completo(end: dict | None) -> bool:
    return bool(end) and all((end.get(c) or "").strip() for c in CAMPOS_ENDERECO)


def _validar_partes_inicial(p: Protocolo, oabs: set[tuple[str, str]], msgs: list[dict]) -> None:
    def erro(m):
        msgs.append({"nivel": "erro", "mensagem": m})

    ativos = [x for x in p.partes if x.get("polo") == "ativo"]
    passivos = [x for x in p.partes if x.get("polo") == "passivo"]
    if not ativos:
        erro("Inclua ao menos uma parte no polo ativo.")
    if not passivos and not p.cabecalho.get("sem_reu"):
        erro("Inclua ao menos uma parte no polo passivo (ou marque procedimento sem réu, como jurisdição voluntária).")
    if ativos and not any((a.get("oab_numero"), (a.get("oab_uf") or "").upper()) in oabs for x in ativos for a in x.get("advogados") or []):
        erro("O advogado que assina precisa estar vinculado a uma parte do polo ativo.")
    for x in p.partes:
        pes = x.get("pessoa") or {}
        nome = (pes.get("nome") or "").strip()
        rot = nome or f"parte {p.partes.index(x) + 1}"
        if not nome:
            erro(f"A {rot} está sem nome.")
        if not (pes.get("cpf") or pes.get("cnpj")) and not (pes.get("justificativa_sem_documento") or "").strip():
            erro(f"{rot}: informe CPF/CNPJ ou a justificativa de não tê-lo (CPC 319 §1º).")
        if not any(_endereco_completo(e) for e in pes.get("enderecos") or []):
            erro(f"{rot}: endereço completo é obrigatório (CEP, logradouro, número, bairro, cidade e UF).")
        if pes.get("tipo_pessoa", "fisica") == "fisica" and x.get("polo") == "ativo":
            faltam = [c for c, r in (("estado_civil", "estado civil"), ("profissao", "profissão"), ("email", "e-mail")) if not pes.get(c)]
            if faltam:
                msgs.append({"nivel": "aviso", "mensagem": f"{rot}: CPC 319 pede {', '.join(faltam)}."})


def _tabela(db: Session, tribunal_id: int, sistema_id: int | None, tabela: str) -> set[str] | None:
    q = select(TabelaLocal.codigo_local).where(TabelaLocal.tabela == tabela, TabelaLocal.ativo.is_(True),
                                               (TabelaLocal.tribunal_id == tribunal_id) | (TabelaLocal.tribunal_id.is_(None)))
    if sistema_id:
        q = q.where((TabelaLocal.sistema_id == sistema_id) | (TabelaLocal.sistema_id.is_(None)))
    codigos = set(db.scalars(q))
    return codigos or None


def validar(db: Session, p: Protocolo) -> list[dict]:
    """[{nivel: erro|aviso, mensagem}]. Com qualquer erro, não aprova nem envia."""
    msgs: list[dict] = []

    def erro(m):
        msgs.append({"nivel": "erro", "mensagem": m})

    def aviso(m):
        msgs.append({"nivel": "aviso", "mensagem": m})

    real = _modo_real(db, p.tenant_id)
    adv = db.get(Usuario, p.advogado_id)
    oabs = {(o["numero"], o["uf"]) for o in svc.oabs_do_advogado(db, adv)} if adv else set()
    if not oabs:
        erro("O advogado que assina não tem OAB cadastrada.")
    # regra 3: certificado
    cert = svc.certificado_ativo(db, p.advogado_id)
    try:
        cert_mod.checar(cert, "protocolo", adv.cpf if adv else None)
        p.certificado_id = cert.id
    except cert_mod.CertificadoNaoUtilizavel as e:
        erro(str(e))
    # regra 1: sistema de hoje
    sist = sistema_do_protocolo(db, p)
    if not sist:
        erro(f"Não há sistema ativo do {p.tribunal.sigla} para o grau {p.grau}.")
    else:
        p.sistema_instancia_id = sist.id
        if sist.status_saude in ("fora", "mudou_layout"):
            (erro if real else aviso)(f"O {p.tribunal.sigla} ({sist.sistema}) está {'fora do ar' if sist.status_saude == 'fora' else 'com layout alterado'} "
                                      "na última verificação.")
        problemas = []
        if not sist.validado:
            problemas.append("este tribunal ainda não foi homologado pela MayaCorp para protocolo automático")
        if not sist.mni_peticionamento or not sist.url_mni:
            problemas.append("o sistema não aceita petição pelo serviço MNI")
        elif p.tipo == "inicial" and not sist.mni_inicial:
            problemas.append("a petição inicial só é aceita pelo portal")
        if problemas:
            texto = "; ".join(problemas)
            if real:
                erro(f"Não dá para protocolar pelo MayaJus: {texto}. Protocole no portal"
                     f"{' (' + sist.url_portal + ')' if sist.url_portal else ''} e registre o recibo aqui.")
            else:
                aviso(f"Modo simulado. No modo real: {texto}.")
        if sist.exige_credenciamento:
            aviso(f"O {p.tribunal.sigla} exige credenciamento prévio do advogado no {sist.sistema}.")
    # documentos (regra 5)
    if not p.documentos:
        erro("Inclua a petição (documento principal).")
    elif sist:
        total = 0
        aceitos = sist.formatos_aceitos or ["application/pdf"]
        for d in p.documentos:
            total += d.tamanho_bytes
            if d.mimetype not in aceitos:
                erro(f"“{d.descricao}”: formato {d.mimetype} não aceito pelo {p.tribunal.sigla} ({', '.join(aceitos)}).")
            if d.tamanho_bytes > sist.tamanho_max_arquivo_mb * 1024 * 1024:
                erro(f"“{d.descricao}” tem {d.tamanho_bytes / 1048576:.1f} MB; o limite por arquivo é {sist.tamanho_max_arquivo_mb} MB.")
            if sist.exige_pdf_pesquisavel and d.mimetype == "application/pdf" and d.pesquisavel is False:
                erro(f"“{d.descricao}” não é pesquisável (é imagem). Passe OCR antes de enviar.")
            if not (d.descricao or "").strip():
                erro("Todo documento precisa de descrição (é o nome que aparece nos autos).")
        if sist.tamanho_max_total_mb and total > sist.tamanho_max_total_mb * 1024 * 1024:
            erro(f"O total dos arquivos ({total / 1048576:.1f} MB) passa do limite do tribunal ({sist.tamanho_max_total_mb} MB).")
        codigos = _tabela(db, p.tribunal_id, sist.id, "tipo_documento")
        if codigos:
            for d in p.documentos:
                if d.tipo_documento_codigo and d.tipo_documento_codigo not in codigos:
                    erro(f"“{d.descricao}”: tipo de documento {d.tipo_documento_codigo} não existe na tabela do {p.tribunal.sigla}.")
        else:
            aviso("As tabelas de tipos de documento deste tribunal ainda não foram sincronizadas: confira os códigos.")
    nomes_docs = " ".join((d.tipo_documento_nome or "").lower() + " " + (d.descricao or "").lower() for d in p.documentos)
    # regra 7: prazo
    if p.prazo_final:
        hoje = date.today()
        if p.prazo_final < hoje and not (p.fora_do_prazo_justificativa or "").strip():
            erro(f"O prazo terminou em {p.prazo_final:%d/%m/%Y}. Para protocolar assim mesmo, registre a justificativa.")
        elif p.prazo_final < hoje:
            aviso(f"FORA DO PRAZO (venceu em {p.prazo_final:%d/%m/%Y}). Justificativa registrada.")
        elif p.prazo_final == hoje:
            aviso("O prazo termina HOJE.")
    if p.tipo == "inicial":
        c = p.cabecalho or {}
        for campo, rot in (("localidade_codigo", "comarca/foro/seção"), ("classe_codigo", "classe processual"),
                           ("audiencia_conciliacao", "opção pela audiência de conciliação")):
            if not c.get(campo):
                erro(f"Informe a {rot}.")
        if c.get("valor_causa") in (None, ""):
            erro("Informe o valor da causa (CPC 319, V).")
        assuntos = c.get("assuntos") or []
        if not assuntos or not any(a.get("principal") for a in assuntos):
            erro("Inclua ao menos um assunto e marque o principal.")
        for campo in ("justica_gratuita_requerida", "tutela_urgencia", "segredo_justica_requerido"):
            if not isinstance(c.get(campo), bool):
                erro(f"Responda: {campo.replace('_', ' ')}.")
        if sist and sist.config_extra.get("exige_competencia") and not c.get("competencia_codigo"):
            erro(f"O {p.tribunal.sigla} exige a competência na petição inicial.")
        if sist:
            for tabela, campo, rot in (("classe", "classe_codigo", "classe"), ("localidade", "localidade_codigo", "localidade")):
                codigos = _tabela(db, p.tribunal_id, sist.id, tabela)
                if codigos and c.get(campo) and str(c[campo]) not in codigos:
                    erro(f"A {rot} {c[campo]} não existe na tabela do {p.tribunal.sigla}.")
        _validar_partes_inicial(p, oabs, msgs)
        if "procura" not in nomes_docs:
            aviso("Não encontrei a procuração entre os documentos (com o e-mail do advogado — CPC 287).")
        if c.get("justica_gratuita_requerida") and "hipossufici" not in nomes_docs:
            aviso("Pedido de gratuidade sem declaração de hipossuficiência anexada.")
        # regra 6: custas
        if c.get("justica_gratuita_requerida") is False and not any(
                x.tipo_custa == "inicial" and x.status in ("paga", "vinculada", "isenta") for x in p.custas):
            erro("Petição inicial sem gratuidade só sobe com a guia de custas iniciais paga (anexe o comprovante).")
        if c.get("prioridades") and "priorid" not in nomes_docs and "idos" not in nomes_docs:
            aviso("Prioridade pedida: anexe o documento que a comprova.")
    else:
        proc: Processo | None = p.processo
        if not proc:
            erro("Escolha o processo da petição.")
        else:
            if proc.situacao != "ativo":
                erro(f"O processo está {proc.situacao}: não aceita petição intermediária.")
            if (proc.nivel_sigilo or 0) > p.nivel_sigilo:
                aviso("O processo é sigiloso: confira o nível de sigilo da petição.")
            habilitado = any(a.e_o_usuario or (a.oab_numero, (a.oab_uf or "").upper()) in oabs for pa in proc.partes for a in pa.advogados)
            partes_completas = any(pa.pessoa.cpf or pa.pessoa.cnpj for pa in proc.partes)  # vieram do MNI
            if not habilitado and p.tipo != "habilitacao":
                (erro if partes_completas else aviso)(
                    "O advogado não aparece nos autos: a primeira petição deve ser um pedido de habilitação com procuração.")
            if p.tipo == "habilitacao" and "procura" not in nomes_docs:
                erro("Pedido de habilitação precisa da procuração.")
        if not p.tipo_peticao_codigo:
            erro("Escolha o tipo de petição.")
        elif sist:
            codigos = _tabela(db, p.tribunal_id, sist.id, "tipo_peticao")
            if codigos and p.tipo_peticao_codigo not in codigos:
                erro(f"O tipo de petição {p.tipo_peticao_codigo} não existe na tabela do {p.tribunal.sigla}.")
        if not p.polo_peticionante:
            erro("Informe o polo de quem peticiona.")
        if not p.parte_ids and proc and proc.partes:
            erro("Escolha em nome de qual(is) parte(s) a petição é feita.")
        elif not p.parte_ids:
            aviso("As partes deste processo não foram carregadas do tribunal: a petição vai em nome do polo escolhido.")
        if p.tipo == "recurso" and not any(x.tipo_custa == "preparo_recursal" and x.status in ("paga", "vinculada", "isenta") for x in p.custas):
            aviso("Recurso sem preparo pago anexado (confira se é isento).")
    ok, msg = cobranca.pode_protocolar(db, p.tenant_id, p.tipo)
    if not ok:
        erro(msg)
    return msgs


# -------------------------------------------------------------------------------------------- aprovação e envio
def aprovar(db: Session, p: Protocolo, usuario: Usuario, ip: str | None, user_agent: str | None) -> Aprovacao:
    if usuario.id != p.advogado_id:
        raise ErroProtocolo("Só o advogado titular do certificado aprova o protocolo.")
    if p.status not in ("rascunho", "erro", "aprovado"):
        raise ErroProtocolo("Este protocolo não está aguardando aprovação.")
    erros = [m["mensagem"] for m in validar(db, p) if m["nivel"] == "erro"]
    if erros:
        raise ErroProtocolo("Corrija antes de aprovar: " + " · ".join(erros))
    a = Aprovacao(protocolo_id=p.id, advogado_id=usuario.id, hash_conteudo_aprovado=hash_conteudo(p), ip=ip,
                  user_agent=(user_agent or "")[:300] or None)
    p.aprovacoes.append(a)
    p.status = "aprovado"
    db.flush()
    return a


def enviar(db: Session, p: Protocolo, usuario: Usuario) -> None:
    """Coloca na fila. Exige aprovação válida para o conteúdo atual."""
    from app.modules.tribunais import jobs

    if p.status == "verificar":
        raise ErroProtocolo("O envio anterior ficou sem resposta do tribunal. Confirme se entrou antes de reenviar.")
    if p.status not in ("aprovado", "erro"):
        raise ErroProtocolo("Só protocolos aprovados podem ser enviados.")
    if not aprovacao_valida(p):
        p.status = "rascunho"
        raise ErroProtocolo("O conteúdo mudou depois da aprovação (ou não foi aprovado): o advogado precisa aprovar de novo.")
    erros = [m["mensagem"] for m in validar(db, p) if m["nivel"] == "erro"]
    if erros:
        raise ErroProtocolo(" · ".join(erros))
    p.status, p.enviado_por_id = "na_fila", usuario.id
    db.flush()
    jobs.enfileirar(db, p.tenant_id, "protocolar", p.id, tribunal_id=p.tribunal_id, criado_por_id=usuario.id, max_tentativas=1)


def _envio(db: Session, p: Protocolo, carregado, sist: Sistema) -> tuple[adaptadores.Envio, list[str]]:
    adv = db.get(Usuario, p.advogado_id)
    docs, hashes = [], []
    for d in sorted(p.documentos, key=lambda x: x.ordem):
        dados = Path(d.arquivo_ref).read_bytes()
        if svc.sha256(dados) != d.hash_sha256:
            raise ErroProtocolo(f"O arquivo “{d.descricao}” foi alterado no disco depois da aprovação.")
        cades = None
        if sist.formato_assinatura == "PAdES" and d.mimetype == "application/pdf":
            dados = cert_mod.assinar_pades(dados, carregado)
            d.formato_assinatura = "PAdES"
        elif sist.formato_assinatura == "CAdES":
            cades = cert_mod.assinar_cades(dados, carregado)
            d.formato_assinatura = "CAdES"
        d.assinado = sist.formato_assinatura in ("PAdES", "CAdES")
        if d.assinado:
            d.arquivo_assinado_ref = svc.guardar(p.tenant_id, f"protocolos/{p.id}/assinados", f"{d.ordem}-{d.nome_arquivo}", dados)
            d.hash_assinado = svc.sha256(dados)
        hashes.append(d.hash_assinado or d.hash_sha256)
        docs.append(adaptadores.DocumentoEnvio(ordem=d.ordem, tipo_codigo=d.tipo_documento_codigo, descricao=d.descricao,
                                               mimetype=d.mimetype, conteudo=dados, nivel_sigilo=d.nivel_sigilo, assinatura_cades=cades))
    envio = adaptadores.Envio(tipo=p.tipo, numero_cnj=p.numero_cnj, cpf_manifestante=adv.cpf, documentos=docs,
                              cabecalho=p.cabecalho or {}, partes=p.partes or [], tipo_peticao_codigo=p.tipo_peticao_codigo,
                              parametros={"tipoPeticao": p.tipo_peticao_codigo} if p.tipo_peticao_codigo else {})
    return envio, hashes


def _retorno(db: Session, p: Protocolo, res: adaptadores.ResultadoEnvio | None, hashes: list[str], *, erro: str | None = None,
             codigo: str | None = None, bruto: bytes = b"", recuperado=False, manual=False) -> RetornoProtocolo:
    from app.modules.tribunais import jobs

    r = RetornoProtocolo(protocolo_id=p.id, sucesso=bool(res and res.sucesso), tentativa=p.tentativas, hash_documentos_enviados=hashes,
                         simulado=bool(res and res.simulado), recuperado=recuperado, manual=manual)
    if res:
        r.numero_protocolo, r.data_hora_protocolo = res.numero_protocolo, res.data_hora or agora()
        r.numero_cnj_gerado, r.orgao_julgador_distribuido, r.tipo_distribuicao = res.numero_cnj_gerado, res.orgao_distribuido, res.tipo_distribuicao
        r.mensagem_erro, r.codigo_erro = (None, None) if res.sucesso else (res.mensagem or "O tribunal recusou a petição.", res.codigo_erro)
        bruto = res.bruto or bruto
        if res.recibo:
            r.recibo_ref = svc.guardar(p.tenant_id, f"protocolos/{p.id}", f"recibo-{p.tentativas}.pdf", res.recibo)
    else:
        r.mensagem_erro, r.codigo_erro, r.data_hora_protocolo = erro, codigo, agora()
    r.resposta_bruta_ref = svc.guardar(p.tenant_id, f"protocolos/{p.id}", f"resposta-{p.tentativas}.xml", bruto or b"")
    p.retornos.append(r)
    db.flush()
    if r.sucesso:
        p.status, p.ultimo_erro, p.simulado = "protocolado", None, r.simulado
        _pos_sucesso(db, p, r)
        cobranca.lancar_protocolo(db, r)
    else:
        p.status, p.ultimo_erro = "erro", r.mensagem_erro
        svc.alertar(db, p.tenant_id, "protocolo_falha", f"Falha no protocolo #{p.id}: {r.mensagem_erro}"[:500], severidade="erro",
                    protocolo_id=p.id, processo_id=p.processo_id, usuario_id=p.advogado_id)
    jobs.enfileirar(db, p.tenant_id, "notificar", r.id, prioridade=80)
    return r


def _pos_sucesso(db: Session, p: Protocolo, r: RetornoProtocolo) -> None:
    """Inicial distribuída vira processo no sistema (e liga no caso do protocolo); intermediária vira andamento."""
    from app.modules.faturamento.models import Andamento, Caso, TipoAndamento

    if p.tipo == "inicial" and r.numero_cnj_gerado and not r.simulado:
        proc = db.scalar(select(Processo).where(Processo.tenant_id == p.tenant_id, Processo.numero_cnj == r.numero_cnj_gerado))
        if not proc:
            c = p.cabecalho or {}
            proc = Processo(tenant_id=p.tenant_id, numero_cnj=r.numero_cnj_gerado, numero_formatado=cnj.formatar(r.numero_cnj_gerado),
                            tribunal_id=p.tribunal_id, sistema_instancia_id=p.sistema_instancia_id,
                            sistema_nome=p.sistema_instancia.sistema if p.sistema_instancia else None, grau=p.grau,
                            classe_nome=c.get("classe_nome"), assuntos=[{"codigo_cnj": a.get("codigo"), "nome": a.get("nome"),
                                                                         "principal": a.get("principal")} for a in c.get("assuntos") or []],
                            valor_causa=Decimal(str(c["valor_causa"])) if c.get("valor_causa") not in (None, "") else None,
                            orgao_julgador=r.orgao_julgador_distribuido, data_ajuizamento=r.data_hora_protocolo,
                            nivel_sigilo=p.nivel_sigilo, segredo_justica=bool(c.get("segredo_justica_requerido")),
                            justica_gratuita=c.get("justica_gratuita_requerida"), tutela_liminar_requerida=c.get("tutela_urgencia"),
                            prioridades=c.get("prioridades") or [], juizo_100_digital=c.get("juizo_100_digital"),
                            origem_importacao="protocolo_inicial", advogado_id=p.advogado_id, responsavel_interno_id=p.advogado_id,
                            numeros_antigos=[], processos_vinculados=[], graus=[p.grau])
            db.add(proc)
            db.flush()
        p.processo_id, p.numero_cnj = proc.id, r.numero_cnj_gerado
        if p.caso_id and not proc.caso_id:
            caso = db.get(Caso, p.caso_id)
            if caso:
                caso.numero_processo = caso.numero_processo or proc.numero_formatado
                svc.ligar_caso(db, proc, caso)
    caso_id = p.caso_id or (p.processo.caso_id if p.processo else None)
    if caso_id:
        quando = (r.data_hora_protocolo or agora()).astimezone()
        titulo = f"{'[SIMULAÇÃO] ' if r.simulado else ''}Protocolo: {p.tipo_peticao_nome or p.titulo or p.tipo} nº {r.numero_protocolo}"
        db.add(Andamento(caso_id=caso_id, data=quando.date(), tipo=TipoAndamento.andamento, titulo=titulo[:200],
                         descricao=f"Protocolado em {quando:%d/%m/%Y %H:%M} no {p.tribunal.sigla}."))


def executar(db: Session, protocolo_id: int) -> None:
    """Job "protocolar": assina e envia. Nunca é repetido automaticamente."""
    p = db.get(Protocolo, protocolo_id)
    if not p or p.status != "na_fila":
        return
    aprov = aprovacao_valida(p)
    if not aprov:
        p.status, p.ultimo_erro = "rascunho", "Conteúdo mudou depois da aprovação: aprove de novo."
        return
    p.status, p.tentativas = "enviando", p.tentativas + 1
    db.commit()
    sist = sistema_do_protocolo(db, p) or p.sistema_instancia
    if not sist:
        _retorno(db, p, None, [], erro="Nenhum sistema ativo do tribunal para este grau.", codigo="pre_envio")
        return
    simulado = not _modo_real(db, p.tenant_id)
    cert = db.get(cert_mod.CertificadoAdvogado, p.certificado_id) if p.certificado_id else svc.certificado_ativo(db, p.advogado_id)
    adv = db.get(Usuario, p.advogado_id)
    try:
        cert_mod.checar(cert, "protocolo", adv.cpf if adv else None)
        carregado = cert_mod.abrir(cert)
        envio, hashes = _envio(db, p, carregado, sist)
        cert_mod.registrar_uso(db, cert, "assinatura", f"protocolo:{p.id}", "simulado" if simulado else "ok", tribunal_id=p.tribunal_id,
                               usuario_id=p.enviado_por_id, aprovacao_id=aprov.id)
    except (cert_mod.CertificadoNaoUtilizavel, ErroProtocolo, OSError, ValueError) as e:
        _retorno(db, p, None, [], erro=str(e), codigo="pre_envio")
        return
    try:
        res = adaptadores.para(sist, simulado=simulado).protocolar(sist, carregado, envio)
    except adaptadores.ErroRede as e:  # regra 9: não se sabe se entrou → consultar antes de qualquer reenvio
        p.status, p.ultimo_erro = "verificar", f"{e} — conferindo no tribunal se a petição entrou."
        cert_mod.registrar_uso(db, cert, "protocolo", f"protocolo:{p.id}", "erro", tribunal_id=p.tribunal_id,
                               usuario_id=p.enviado_por_id, aprovacao_id=aprov.id, detalhe=str(e))
        svc.guardar(p.tenant_id, f"protocolos/{p.id}", f"envio-{p.tentativas}-sem-resposta.txt",
                    f"{agora().isoformat()} {e}\nhashes: {hashes}".encode())
        from app.modules.tribunais import jobs

        jobs.enfileirar(db, p.tenant_id, "verificar_protocolo", p.id, tribunal_id=p.tribunal_id, quando=agora() + timedelta(minutes=2),
                        payload={"enviado_em": agora().isoformat(), "hashes": hashes})
        return
    except adaptadores.NaoSuportado as e:
        _retorno(db, p, None, hashes, erro=str(e), codigo="nao_suportado")
        return
    except adaptadores.ErroTribunal as e:
        _retorno(db, p, None, hashes, erro=str(e), codigo=e.codigo or "tribunal", bruto=e.bruto or b"")
        cert_mod.registrar_uso(db, cert, "protocolo", f"protocolo:{p.id}", "erro", tribunal_id=p.tribunal_id,
                               usuario_id=p.enviado_por_id, aprovacao_id=aprov.id, detalhe=str(e))
        return
    if sist and not simulado:
        sist.ultima_requisicao_em = agora()
    cert_mod.registrar_uso(db, cert, "protocolo", f"protocolo:{p.id}", "simulado" if simulado else ("ok" if res.sucesso else "erro"),
                           tribunal_id=p.tribunal_id, usuario_id=p.enviado_por_id, aprovacao_id=aprov.id, detalhe=res.mensagem)
    _retorno(db, p, res, hashes)


def verificar(db: Session, protocolo_id: int, payload: dict) -> str:
    """Job "verificar_protocolo": depois de falha de rede, procura nos autos se a petição entrou. Nunca reenvia."""
    p = db.get(Protocolo, protocolo_id)
    if not p or p.status != "verificar":
        return "nada a fazer"
    sist = p.sistema_instancia
    adv = db.get(Usuario, p.advogado_id)
    cert = svc.certificado_ativo(db, p.advogado_id)
    enviado = datetime.fromisoformat(payload["enviado_em"]) if payload.get("enviado_em") else agora() - timedelta(hours=1)
    if p.tipo == "inicial" or not p.numero_cnj:
        p.ultimo_erro = ("Sem resposta do tribunal no envio da inicial. Confira no portal se o processo foi distribuído e "
                         "registre o recibo (ou marque que não entrou) antes de reenviar.")
        svc.alertar(db, p.tenant_id, "protocolo_verificar", p.ultimo_erro, severidade="erro", protocolo_id=p.id, usuario_id=p.advogado_id)
        return "manual"
    try:
        cert_mod.checar(cert, "consulta", adv.cpf if adv else None)
        res = adaptadores.para(sist).consultar(sist, cert_mod.abrir(cert), adv.cpf, p.numero_cnj, False)
        cert_mod.registrar_uso(db, cert, "consulta", p.numero_cnj, "ok", tribunal_id=p.tribunal_id,
                               detalhe=f"Conferência do protocolo #{p.id} após falha de comunicação")
    except Exception as e:  # noqa: BLE001  (sem consulta automática: decisão humana)
        p.ultimo_erro = f"Não deu para conferir no tribunal ({e}). Verifique no portal antes de reenviar."
        svc.alertar(db, p.tenant_id, "protocolo_verificar", p.ultimo_erro[:500], severidade="erro", protocolo_id=p.id,
                    usuario_id=p.advogado_id)
        return "manual"
    principal = min(p.documentos, key=lambda d: d.ordem)
    margem = enviado - timedelta(minutes=10)
    achado = next((d for d in res.documentos if d.get("data_hora") and d["data_hora"] >= margem
                   and (d.get("descricao") or "").strip().lower() == principal.descricao.strip().lower()), None)
    if achado:
        r = adaptadores.ResultadoEnvio(sucesso=True, numero_protocolo=f"doc:{achado['id']}", data_hora=achado["data_hora"],
                                       bruto=res.bruto, mensagem="Encontrado nos autos após falha de comunicação.")
        _retorno(db, p, r, payload.get("hashes") or [], recuperado=True)
        return "entrou"
    _retorno(db, p, None, payload.get("hashes") or [], erro="A petição não aparece nos autos após a falha de comunicação. "
             "Revise e envie de novo.", codigo="nao_entrou", bruto=res.bruto)
    return "nao_entrou"


def resolver_manual(db: Session, p: Protocolo, entrou: bool, usuario: Usuario, *, numero_protocolo: str | None = None,
                    data_hora: datetime | None = None, recibo: bytes | None = None, numero_cnj_gerado: str | None = None) -> RetornoProtocolo:
    """O usuário confere no portal: registra o recibo (entrou / protocolou pelo portal) ou marca que não entrou."""
    if p.status not in ("verificar", "erro", "aprovado", "rascunho"):
        raise ErroProtocolo("Este protocolo já tem retorno do tribunal.")
    if entrou and not numero_protocolo:
        raise ErroProtocolo("Informe o número do protocolo do recibo.")
    if numero_cnj_gerado and not cnj.valido(numero_cnj_gerado):
        raise ErroProtocolo("Número do processo distribuído inválido.")
    if p.status in ("aprovado", "rascunho") and not entrou:
        raise ErroProtocolo("Nada a registrar.")
    p.tentativas = max(p.tentativas, 1)
    if entrou:
        res = adaptadores.ResultadoEnvio(sucesso=True, numero_protocolo=numero_protocolo,
                                         data_hora=(data_hora.astimezone(UTC) if data_hora else agora()), recibo=recibo,
                                         numero_cnj_gerado=cnj.so_digitos(numero_cnj_gerado) or None,
                                         bruto=f"<registro_manual usuario='{usuario.id}'/>".encode())
        # protocolado no portal: não consome crédito do MayaJus (cobranca ignora retorno manual)
        r = _retorno(db, p, res, [d.hash_sha256 for d in p.documentos], manual=True)
    else:
        r = _retorno(db, p, None, [], erro="Confirmado pelo usuário: a petição não entrou. Revise e envie de novo.", codigo="nao_entrou")
    db.flush()
    return r
