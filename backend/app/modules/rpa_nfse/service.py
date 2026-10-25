"""Regras do RPA 01: importação, pré-validação, correção, fila de emissão, e-mail e arquivos."""

import hashlib
import math
import unicodedata
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import agora
from app.core.documentos import cnpj_valido, so_digitos
from app.core.models import Certificado, ConfigNotificacao, Identidade
from app.modules.rpa_nfse import parser_txt, validator
from app.modules.rpa_nfse.models import (
    ConfigNfse,
    Emissora,
    EnvioEmail,
    Lote,
    Nfse,
    ParametroFiscal,
    Rps,
    StatusLote,
    StatusNfse,
    StatusRps,
    Tomador,
)
from app.modules.rpa_nfse.prefeitura_sp import link_nota
from app.modules.rpa_nfse.prefeitura_sp.xml_layout2 import MUNICIPIO_SP


class RegraNegocio(ValueError):
    """Erro que vai direto para o usuário (HTTP 400/409)."""


# ---------------------------------------------------------------- arquivos
def pasta(emissora_id: int, quando: date | None = None) -> Path:
    q = quando or date.today()
    p = Path(settings.storage_dir) / f"emissora_{emissora_id}" / f"{q:%Y}" / f"{q:%m}"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _normaliza(txt: str | None) -> str:
    return unicodedata.normalize("NFKD", txt or "").encode("ascii", "ignore").decode().upper().strip()


# ---------------------------------------------------------------- modo da Prefeitura
def modos_permitidos() -> list[str]:
    """Emissão real só existe no servidor de produção: homologação nunca gera nota de verdade."""
    return ["simulado", "teste", "producao"] if settings.ambiente == "prod" else ["simulado", "teste"]


def config_nfse(db: Session, tenant_id: int) -> ConfigNfse:
    cfg = db.get(ConfigNfse, tenant_id)
    if cfg is None:
        cfg = ConfigNfse(tenant_id=tenant_id, prefeitura_modo="simulado")
        db.add(cfg)
        db.flush()
    return cfg


def modo_prefeitura(db: Session, tenant_id: int) -> str:
    modo = config_nfse(db, tenant_id).prefeitura_modo
    return modo if modo in modos_permitidos() else "teste"


# ---------------------------------------------------------------- emissora
def saude_emissora(db: Session, e: Emissora) -> tuple[bool, str]:
    if not e.ativa:
        return False, "Emissora inativa"
    if not cnpj_valido(e.cnpj) or not e.ccm:
        return False, "CNPJ ou CCM inválido"
    if modo_prefeitura(db, e.tenant_id) == "simulado" and not e.certificado_id:
        return True, "Pronta para emitir (modo simulação)"
    cert = db.get(Certificado, e.certificado_id) if e.certificado_id else None
    if not cert:
        return False, "Falta certificado válido"
    if cert.valido_ate < date.today():
        return False, f"Certificado vencido em {cert.valido_ate:%d/%m/%Y}"
    return True, "Pronta para emitir"


def parametros_da_emissora(db: Session, emissora_id: int) -> list[ParametroFiscal]:
    return list(
        db.scalars(select(ParametroFiscal).where(ParametroFiscal.emissora_id == emissora_id, ParametroFiscal.ativo))
    )


# ---------------------------------------------------------------- importação
def _tomador_do_arquivo(d: parser_txt.DetalheRps) -> dict:
    tipo = {"1": "PF", "2": "PJ"}.get(d.ind_doc_tomador, "EX")
    cidade = d.cidade
    return {
        "tipo": tipo,
        "nome": d.nome_tomador,
        "cpf_cnpj": d.doc_tomador or None,
        "im": d.im_tomador or None,
        "ie": d.ie_tomador or None,
        "tipo_logradouro": d.tipo_logradouro or None,
        "logradouro": d.logradouro or None,
        "numero": d.numero_endereco or None,
        "complemento": d.complemento or None,
        "bairro": d.bairro or None,
        "cidade": cidade or None,
        "uf": d.uf or None,
        "cep": so_digitos(d.cep) or None,
        "email": d.email or None,
        "codigo_municipio": MUNICIPIO_SP if _normaliza(cidade) == "SAO PAULO" else None,
    }


def proximo_numero_lote(db: Session, tenant_id: int) -> int:
    return (db.scalar(select(func.max(Lote.numero)).where(Lote.tenant_id == tenant_id)) or 0) + 1


def importar(db: Session, *, tenant_id: int, usuario_id: int, emissora: Emissora, nome: str, conteudo: bytes) -> Lote:
    try:
        arq = parser_txt.ler(conteudo)
    except parser_txt.ArquivoInvalido as e:
        raise RegraNegocio(str(e)) from e

    if arq.ccm_prestador and so_digitos(arq.ccm_prestador).lstrip("0") != so_digitos(emissora.ccm).lstrip("0"):
        raise RegraNegocio(
            f"Este arquivo é de outro emissor (CCM {arq.ccm_prestador}), não de {emissora.razao_social} "
            f"(CCM {emissora.ccm}). Escolha a emissora certa ou confira o arquivo."
        )

    hash_arq = hashlib.sha256(conteudo).hexdigest()
    anterior = db.scalar(
        select(Lote).where(
            Lote.tenant_id == tenant_id, Lote.hash_arquivo == hash_arq, Lote.status != StatusLote.descartado
        )
    )
    destino = pasta(emissora.id) / f"lote_{hash_arq[:12]}_{Path(nome).name}"
    destino.write_bytes(conteudo)

    lote = Lote(
        tenant_id=tenant_id,
        numero=proximo_numero_lote(db, tenant_id),
        emissora_id=emissora.id,
        usuario_id=usuario_id,
        arquivo_origem=Path(nome).name,
        arquivo_path=str(destino),
        hash_arquivo=hash_arq,
        encoding=arq.encoding,
        status=StatusLote.validando,
        eventos=[],
    )
    lote.evento(
        "upload", f"Arquivo {lote.arquivo_origem} recebido · {len(arq.detalhes)} RPS · encoding {arq.encoding}"
    )
    if anterior:
        lote.evento("upload", f"Atenção: este mesmo arquivo já foi importado no lote #{anterior.numero}.", "aviso")
    for p in arq.problemas:
        lote.evento("leitura", f"Linha {p.linha}: {p.mensagem}", "aviso")
    db.add(lote)
    db.flush()

    docs = {d.doc_tomador for d in arq.detalhes if d.doc_tomador}
    existentes = {
        t.cpf_cnpj: t
        for t in db.scalars(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj.in_(docs)))
    }
    for d in arq.detalhes:
        tom = _tomador_do_arquivo(d)
        cad = existentes.get(d.doc_tomador) if d.doc_tomador else None
        if cad and not tom.get("email") and cad.emails:
            tom["email"] = cad.emails[0]
        db.add(
            Rps(
                lote_id=lote.id,
                emissora_id=emissora.id,
                linha=d.linha,
                tipo_rps=d.tipo_rps,
                serie=d.serie or emissora.serie_rps,
                numero=d.numero or 0,
                data_emissao=d.data_emissao or date.today(),
                situacao=d.situacao,
                tomador_id=cad.id if cad else None,
                tomador_novo=cad is None and bool(d.doc_tomador),
                cod_servico=d.cod_servico or (emissora.cod_servico_padrao or ""),
                aliquota=d.aliquota,
                valor=d.valor,
                deducoes=d.deducoes,
                iss=Decimal(0),
                iss_retido=d.iss_retido,
                discriminacao=d.discriminacao,
                dados_json={"tomador": tom, "extras": d.extras, "problemas_leitura": d.problemas},
                status=StatusRps.ok,
                erros_json=[],
            )
        )
    db.flush()
    db.refresh(lote)
    revalidar(db, lote)
    lote.evento("validacao", f"Pré-validação concluída: {resumo(lote).com_erro} com erro.")
    return lote


def revalidar(db: Session, lote: Lote, somente: list[Rps] | None = None) -> None:
    emissora = lote.emissora
    params = parametros_da_emissora(db, emissora.id)
    servicos = {p.cod_servico for p in params if p.cod_servico}
    if emissora.cod_servico_padrao:
        servicos.add(emissora.cod_servico_padrao)

    chaves = {f"{emissora.id}:{r.serie}:{r.numero}" for r in lote.rps}
    ja = {
        f"{r.serie}:{r.numero}": ((r.nfse.id, r.nfse.numero) if r.nfse else (0, 0))
        for r in db.scalars(select(Rps).where(Rps.chave_emissao.in_(chaves), Rps.lote_id != lote.id))
    }
    contagem: dict[str, int] = {}
    for r in lote.rps:
        if r.status != StatusRps.descartado:
            k = f"{r.serie}:{r.numero}"
            contagem[k] = contagem.get(k, 0) + 1
    duplicados = {k for k, n in contagem.items() if n > 1}

    ctx = validator.ContextoValidacao(
        emissora=emissora, parametros=params, servicos_permitidos=servicos, ja_emitidos=ja
    )
    alvo = somente if somente is not None else lote.rps
    for r in alvo:
        if r.status in (StatusRps.na_fila, StatusRps.transmitindo, StatusRps.emitido, StatusRps.descartado):
            continue
        validator.validar(r, ctx, duplicados)
        if r.status == StatusRps.erro and lote.status == StatusLote.validando and _nunca_tocado(r):
            r.selecionado = False
    atualizar_totais(lote)


def _nunca_tocado(r: Rps) -> bool:
    """Na primeira validação, linhas com erro já vêm desmarcadas (o usuário marca depois de corrigir)."""
    return not (r.dados_json or {}).get("editado")


def atualizar_totais(lote: Lote) -> None:
    ativos = [r for r in lote.rps if r.status != StatusRps.descartado]
    lote.qtd = len(ativos)
    lote.valor_total = sum((r.valor for r in ativos), Decimal(0))
    lote.iss_total = sum((r.iss for r in ativos), Decimal(0))


def resumo(lote: Lote):
    from app.modules.rpa_nfse.schemas import ResumoImportacao

    ativos = [r for r in lote.rps if r.status != StatusRps.descartado]
    sel = [r for r in ativos if r.selecionado]
    com_erro = sum(1 for r in ativos if r.status in (StatusRps.erro, StatusRps.rejeitado))
    return ResumoImportacao(
        qtd=len(ativos),
        qtd_selecionados=len(sel),
        valor_total=sum((r.valor for r in sel), Decimal(0)),
        iss_total=sum((r.iss for r in sel), Decimal(0)),
        tomadores_novos=len({(r.dados_json or {}).get("tomador", {}).get("cpf_cnpj") for r in ativos if r.tomador_novo}),
        com_erro=com_erro,
        com_aviso=sum(1 for r in ativos if r.status == StatusRps.aviso),
        ok=sum(1 for r in ativos if r.status == StatusRps.ok),
        pode_emitir=bool(sel) and not any(r.status == StatusRps.erro for r in sel),
    )


CAMPOS_TOMADOR_EDITAVEIS = {
    "tipo",
    "nome",
    "cpf_cnpj",
    "im",
    "ie",
    "tipo_logradouro",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cidade",
    "uf",
    "cep",
    "email",
}


def corrigir_rps(db: Session, lote: Lote, rps: Rps, patch: dict) -> Rps:
    editavel = lote.status == StatusLote.validando or (
        lote.status in (StatusLote.parcial, StatusLote.falhou) and rps.status == StatusRps.rejeitado
    )
    if not editavel:
        raise RegraNegocio("Este RPS não pode mais ser alterado.")
    if patch.pop("descartar", None):
        rps.status = StatusRps.descartado
        rps.selecionado = False
        atualizar_totais(lote)
        return rps
    for campo in ("data_emissao", "cod_servico", "aliquota", "valor", "deducoes", "iss_retido", "discriminacao"):
        if patch.get(campo) is not None:
            setattr(rps, campo, patch[campo])
    if "selecionado" in patch and patch["selecionado"] is not None:
        rps.selecionado = patch["selecionado"]
    dados = dict(rps.dados_json or {})
    if patch.get("tomador"):
        tom = dict(dados.get("tomador", {}))
        for k, v in patch["tomador"].items():
            if k in CAMPOS_TOMADOR_EDITAVEIS:
                tom[k] = (so_digitos(v) or None) if k in ("cpf_cnpj", "cep", "im") else (v or None)
        if tom.get("cpf_cnpj"):
            tom["tipo"] = "PF" if len(tom["cpf_cnpj"]) == 11 else "PJ"
        tom["codigo_municipio"] = MUNICIPIO_SP if _normaliza(tom.get("cidade")) == "SAO PAULO" else None
        dados["tomador"] = tom
        cad = (
            db.scalar(select(Tomador).where(Tomador.tenant_id == lote.tenant_id, Tomador.cpf_cnpj == tom["cpf_cnpj"]))
            if tom.get("cpf_cnpj")
            else None
        )
        rps.tomador_id = cad.id if cad else None
        rps.tomador_novo = cad is None and bool(tom.get("cpf_cnpj"))
    dados["editado"] = True
    dados["problemas_leitura"] = []
    rps.dados_json = dados
    if rps.status == StatusRps.rejeitado:
        rps.status = StatusRps.ok
    revalidar(db, lote, somente=[rps])
    return rps


def selecionar(lote: Lote, selecionado: bool, status: str | None) -> None:
    for r in lote.rps:
        if r.status == StatusRps.descartado:
            continue
        if status and r.status.value != status:
            continue
        r.selecionado = selecionado


# ---------------------------------------------------------------- fila de emissão
def enfileirar(db: Session, lote: Lote, *, apenas_status: set[StatusRps] | None = None) -> int:
    """Marca os RPS selecionados como na fila. A chave única (emissora:série:número) é a idempotência."""
    ok, msg = saude_emissora(db, lote.emissora)
    if not ok:
        raise RegraNegocio(f"A emissora não está pronta: {msg}.")
    alvo = [
        r
        for r in lote.rps
        if r.selecionado
        and r.status not in (StatusRps.descartado, StatusRps.emitido, StatusRps.na_fila, StatusRps.transmitindo)
        and (apenas_status is None or r.status in apenas_status)
    ]
    if not alvo:
        raise RegraNegocio("Nenhum RPS selecionado para emitir.")
    if any(r.status == StatusRps.erro for r in alvo):
        raise RegraNegocio("Há RPS com erro marcados para envio. Corrija ou desmarque antes de emitir.")

    chaves = {f"{r.emissora_id}:{r.serie}:{r.numero}": r for r in alvo}
    ocupadas = set(db.scalars(select(Rps.chave_emissao).where(Rps.chave_emissao.in_(chaves))))
    if ocupadas - {r.chave_emissao for r in alvo}:
        nums = ", ".join(sorted(k.split(":")[-1] for k in ocupadas)[:5])
        raise RegraNegocio(f"Os RPS {nums} já foram emitidos ou estão na fila em outro lote.")
    for chave, r in chaves.items():
        r.chave_emissao = chave
        r.status = StatusRps.na_fila
        r.erros_json = [e for e in (r.erros_json or []) if e.get("nivel") != "erro"]
    for r in lote.rps:
        if not r.selecionado and lote.status == StatusLote.validando and r.status != StatusRps.emitido:
            r.status = StatusRps.descartado

    lote.status = StatusLote.na_fila
    lote.sublotes_total = (lote.sublotes_feitos or 0) + math.ceil(len(alvo) / settings.lote_tamanho)
    lote.mensagem = None
    lote.evento("fila", f"{len(alvo)} RPS na fila, em {math.ceil(len(alvo) / settings.lote_tamanho)} lote(s) de até {settings.lote_tamanho}.")
    atualizar_totais(lote)
    return len(alvo)


def reabrir_rejeitados(db: Session, lote: Lote) -> int:
    rejeitados = [r for r in lote.rps if r.status in (StatusRps.rejeitado, StatusRps.ok, StatusRps.aviso) and not r.nfse]
    if not rejeitados:
        raise RegraNegocio("Não há RPS rejeitados para reprocessar.")
    revalidar(db, lote, somente=rejeitados)
    for r in rejeitados:
        r.selecionado = r.status != StatusRps.erro
    if not any(r.selecionado for r in rejeitados):
        raise RegraNegocio("Os rejeitados ainda têm erros. Corrija-os antes de reprocessar.")
    return enfileirar(db, lote, apenas_status={StatusRps.ok, StatusRps.aviso})


# ---------------------------------------------------------------- tomadores
def sincronizar_tomador(db: Session, tenant_id: int, rps: Rps) -> None:
    """Cadastra tomador novo / atualiza o existente com os dados confirmados no RPS."""
    tom = (rps.dados_json or {}).get("tomador", {})
    doc = tom.get("cpf_cnpj")
    if not doc:
        return
    cad = db.scalar(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj == doc))
    if cad is None:
        cad = Tomador(tenant_id=tenant_id, tipo=tom.get("tipo") or "PJ", nome=tom.get("nome") or "", cpf_cnpj=doc, emails=[])
        db.add(cad)
    for campo in ("nome", "im", "ie", "tipo_logradouro", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "cep"):
        if tom.get(campo):
            setattr(cad, campo, tom[campo])
    if tom.get("email") and tom["email"] not in (cad.emails or []):
        cad.emails = [*(cad.emails or []), tom["email"]]
    db.flush()
    rps.tomador_id = cad.id
    rps.tomador_novo = False


def tomador_incompleto(t: Tomador) -> bool:
    return not (t.cpf_cnpj and t.cep and t.logradouro and t.emails)


# ---------------------------------------------------------------- e-mail ao tomador
def _anexos_disponiveis(db: Session, nota: Nfse) -> list[dict]:
    """PDF, XML e fatura que existem para a nota, com o que vem marcado por padrão nas configurações."""
    from app.modules.rpa_nfse.models import Fatura, StatusFatura

    cfg = db.get(ConfigNotificacao, nota.tenant_id)
    lista = []
    if nota.pdf_path and Path(nota.pdf_path).exists():
        lista.append({"tipo": "pdf", "nome": f"NFSe_{nota.numero}.pdf", "caminho": nota.pdf_path, "mime": "application/pdf",
                      "padrao": not cfg or cfg.anexar_pdf})
    if nota.xml_path and Path(nota.xml_path).exists():
        lista.append({"tipo": "xml", "nome": f"NFSe_{nota.numero}.xml", "caminho": nota.xml_path, "mime": "application/xml",
                      "padrao": not cfg or cfg.anexar_xml})
    fat = db.scalar(select(Fatura).where(Fatura.nfse_id == nota.id))
    if fat and fat.status != StatusFatura.cancelada and fat.pdf_path and Path(fat.pdf_path).exists():
        lista.append({"tipo": "fatura", "nome": f"Fatura_{fat.ano}_{fat.numero:05d}.pdf", "caminho": fat.pdf_path,
                      "mime": "application/pdf",
                      "padrao": fat.status == StatusFatura.aberta and config_nfse(db, nota.tenant_id).fatura_anexar_email})
    for a in lista:
        a["tamanho"] = Path(a["caminho"]).stat().st_size
    return lista


VARIAVEIS_EMAIL = ["nome_tomador", "numero_nota", "valor", "link_prefeitura", "nome_emissora", "vencimento", "codigo_fatura"]


def variaveis_nota(db: Session, nota: Nfse) -> dict:
    from app.modules.rpa_nfse.models import Fatura
    from app.modules.rpa_nfse.pdf import brl

    ident = db.get(Identidade, nota.tenant_id)
    tom = (nota.rps.dados_json or {}).get("tomador", {})
    fat = db.scalar(select(Fatura).where(Fatura.nfse_id == nota.id))
    return {
        "nome_tomador": tom.get("nome", ""),
        "numero_nota": nota.numero,
        "valor": brl(nota.valor),
        "link_prefeitura": link_nota(nota.emissora.ccm, nota.numero, nota.cod_verificacao),
        "nome_emissora": ident.nome_exibicao if ident else nota.emissora.razao_social,
        "vencimento": f"{fat.data_vencimento:%d/%m/%Y}" if fat else "",
        "codigo_fatura": fat.codigo if fat else "",
    }


def aplicar_modelo(texto: str, variaveis: dict) -> str:
    return texto.format_map(_Seguro(variaveis))


def assinatura_email(db: Session, tenant_id: int) -> str:
    ident = db.get(Identidade, tenant_id)
    return ident.assinatura_email if ident and ident.assinatura_email else ""


def emails_do_cliente(nota: Nfse) -> list[str]:
    tom = (nota.rps.dados_json or {}).get("tomador", {})
    emails = list(nota.tomador.emails or []) if nota.tomador else []
    if nota.tomador:  # pessoas de contato marcadas como "recebe as notas"
        emails += [c["email"] for c in nota.tomador.contatos or [] if c.get("recebe_notas") and c.get("email")]
    emails = list(dict.fromkeys(e.lower() for e in emails))
    return emails or ([tom["email"]] if tom.get("email") else [])


def montar_email(db: Session, nota: Nfse) -> dict:
    """O e-mail da nota como o compositor mostra: destinatários, cópias padrão, texto do modelo e anexos."""
    cfg = db.get(ConfigNotificacao, nota.tenant_id)
    emails_cliente = emails_do_cliente(nota)
    variaveis = variaveis_nota(db, nota)
    assunto = aplicar_modelo(cfg.assunto_modelo if cfg else "NFS-e nº {numero_nota}", variaveis)
    corpo = aplicar_modelo(cfg.corpo_modelo if cfg else "Segue a NFS-e nº {numero_nota}.", variaveis)
    if assinatura := assinatura_email(db, nota.tenant_id):
        corpo += "\n\n" + assinatura
    remetente = f"{cfg.remetente_nome} <{cfg.remetente_email}>" if cfg else settings.smtp_from
    return {
        "remetente": remetente,
        "para": emails_cliente,
        "cc": list(cfg.email_cc_padrao or []) if cfg else [],
        "cco": list(cfg.email_cco_padrao or []) if cfg else [],
        "assunto": assunto,
        "corpo": corpo,
        "anexos": _anexos_disponiveis(db, nota),
        "emails_cliente": emails_cliente,
    }


def enviar_email_nota(
    db: Session,
    nota: Nfse,
    destinatarios: list[str] | None = None,
    *,
    cc: list[str] | None = None,
    cco: list[str] | None = None,
    assunto: str | None = None,
    corpo: str | None = None,
    anexos: list[str] | None = None,
    usuario_nome: str | None = None,
) -> EnvioEmail:
    """Envia a nota ao cliente. Sem parâmetros usa o modelo e os padrões das configurações (envio automático)."""
    from app.core import email as mail

    cfg = db.get(ConfigNotificacao, nota.tenant_id)
    base = montar_email(db, nota)
    para = list(dict.fromkeys(destinatarios or base["para"]))
    if not para:
        raise RegraNegocio("O cliente não tem e-mail cadastrado.")
    cc = list(dict.fromkeys(cc if cc is not None else base["cc"]))
    cco = list(dict.fromkeys(cco if cco is not None else base["cco"]))
    escolhidos = set(anexos) if anexos is not None else {a["tipo"] for a in base["anexos"] if a["padrao"]}
    arquivos = [(a["nome"], Path(a["caminho"]).read_bytes(), a["mime"]) for a in base["anexos"] if a["tipo"] in escolhidos]
    assunto = (assunto or base["assunto"]).strip()
    envio = EnvioEmail(nfse_id=nota.id, destinatarios=para, cc=cc, cco=cco, assunto=assunto[:300],
                       anexos=[n for n, _, _ in arquivos], usuario_nome=usuario_nome, status="enviado", enviado_em=agora())
    try:
        mail.enviar(para, assunto, corpo or base["corpo"], anexos=arquivos, config=cfg, cc=cc, cco=cco)
    except Exception as e:  # noqa: BLE001
        envio.status = "falhou"
        envio.erro = str(e)[:500]
    db.add(envio)
    return envio


class _Seguro(dict):
    def __missing__(self, k):
        return "{" + k + "}"


def notas_do_lote(db: Session, lote_id: int) -> list[Nfse]:
    return list(db.scalars(select(Nfse).join(Rps).where(Rps.lote_id == lote_id, Nfse.status == StatusNfse.emitida)))


def liberar_presos(db: Session) -> list[int]:
    """Na subida do servidor: lotes que estavam transmitindo voltam para a fila."""
    db.execute(update(Lote).where(Lote.status == StatusLote.transmitindo).values(status=StatusLote.na_fila))
    db.execute(update(Rps).where(Rps.status == StatusRps.transmitindo).values(status=StatusRps.na_fila))
    db.commit()
    return list(db.scalars(select(Lote.id).where(Lote.status == StatusLote.na_fila)))


# ---------------------------------------------------------------- planilha, ZIP e relatórios ao cliente
def planilha_conferencia(lote: Lote) -> bytes:
    import io

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = f"Lote {lote.numero}"
    ws.append(["Linha", "Série", "RPS", "Data", "Tomador", "CPF/CNPJ", "Serviço", "Valor", "ISS", "Status", "NFS-e",
               "Cód. verificação", "Problemas"])
    for r in lote.rps:
        if r.status == StatusRps.descartado:
            continue
        tom = (r.dados_json or {}).get("tomador", {})
        ws.append([r.linha, r.serie, r.numero, r.data_emissao, tom.get("nome"), tom.get("cpf_cnpj"), r.cod_servico,
                   float(r.valor), float(r.iss), r.status.value, r.nfse.numero if r.nfse else None,
                   r.nfse.cod_verificacao if r.nfse else None, "; ".join(e["mensagem"] for e in r.erros_json or [])])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def zip_notas(notas: list[Nfse]) -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n in notas:
            for caminho, ext in ((n.pdf_path, "pdf"), (n.xml_path, "xml")):
                if caminho and Path(caminho).exists():
                    z.write(caminho, f"{ext.upper()}/NFSe_{n.numero}.{ext}")
    return buf.getvalue()


def _assinatura(db: Session, tenant_id: int) -> str:
    ident = db.get(Identidade, tenant_id)
    return "\n\n—\nRobô de NFS-e · Uma solução MayaCorp" + (f"\n{ident.assinatura_email}" if ident and ident.assinatura_email else "")


def enviar_relatorio_emissao(db: Session, lote: Lote, cfg: ConfigNfse) -> None:
    """E-mail ao cliente (ex.: CFME) dizendo quantas notas o robô emitiu neste lote."""
    from app.core import email as mail
    from app.modules.rpa_nfse.pdf import brl

    emitidas = notas_do_lote(db, lote.id)
    total = sum((n.valor for n in emitidas), Decimal(0))
    iss = sum((n.iss for n in emitidas), Decimal(0))
    rejeitados = [r for r in lote.rps if r.status == StatusRps.rejeitado]
    linhas = [
        "Olá,",
        "",
        f"O robô terminou o lote #{lote.numero:04d} ({lote.arquivo_origem}).",
        "",
        f"  ✅ {len(emitidas)} nota(s) emitida(s)",
        f"  💰 Valor total: {brl(total)}",
        f"  🧾 ISS: {brl(iss)}",
    ]
    if rejeitados:
        linhas.append(f"  ❌ {len(rejeitados)} rejeitada(s):")
        for r in rejeitados[:10]:
            msg = next((e["mensagem"] for e in reversed(r.erros_json or []) if e.get("nivel") == "erro"), "")
            linhas.append(f"     · RPS {r.numero} — {(r.dados_json or {}).get('tomador', {}).get('nome', '')}: {msg}")
    if emitidas:
        nums = sorted(n.numero for n in emitidas)
        linhas += ["", f"Notas de nº {nums[0]} a {nums[-1]}."]
    linhas += ["", f"Ver no sistema: {settings.frontend_url}/nfse/lotes/{lote.id}"]
    anexos = []
    if cfg.relatorio_anexar_planilha:
        anexos.append((f"conferencia_lote_{lote.numero}.xlsx", planilha_conferencia(lote),
                       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
    if cfg.relatorio_anexar_zip and emitidas:
        anexos.append((f"notas_lote_{lote.numero}.zip", zip_notas(emitidas), "application/zip"))
    mail.enviar(
        cfg.relatorio_destinatarios,
        f"NFS-e: {len(emitidas)} nota(s) emitida(s) — lote #{lote.numero:04d}" + (f" · {len(rejeitados)} rejeitada(s)" if rejeitados else ""),
        "\n".join(linhas) + _assinatura(db, lote.tenant_id),
        anexos=anexos,
        config=db.get(ConfigNotificacao, lote.tenant_id),
    )


def enviar_relatorio_baixas(db: Session, ext, cfg: ConfigNfse) -> None:
    """E-mail ao cliente com as notas que receberam baixa pela conciliação do extrato."""
    from app.core import email as mail
    from app.modules.rpa_nfse.models import LancamentoExtrato, StatusLancamento
    from app.modules.rpa_nfse.pdf import brl

    lancs = list(db.scalars(select(LancamentoExtrato).where(
        LancamentoExtrato.extrato_id == ext.id, LancamentoExtrato.status == StatusLancamento.conciliado)))
    linhas = ["Olá,", "", f"O extrato {ext.arquivo_nome} foi conciliado.", "",
              f"  ✅ {ext.notas_baixadas} nota(s) baixada(s), {brl(ext.valor_conciliado)} recebidos",
              f"  🔎 {ext.qtd_sugeridos} crédito(s) aguardando confirmação", ""]
    for lc in lancs[:30]:
        notas = db.scalars(select(Nfse).where(Nfse.id.in_(lc.nfse_ids or []))).all()
        linhas.append(f"  · {lc.data:%d/%m/%Y}  {brl(lc.valor)}  → NFS-e {', '.join(str(n.numero) for n in notas)}")
    linhas += ["", f"Ver no sistema: {settings.frontend_url}/nfse/recebimentos/{ext.id}"]
    mail.enviar(cfg.relatorio_destinatarios, f"Recebimentos: {ext.notas_baixadas} nota(s) baixada(s)",
                "\n".join(linhas) + _assinatura(db, ext.tenant_id), config=db.get(ConfigNotificacao, ext.tenant_id))
