"""Rotas da integração: advogado (OAB, certificado, termo), varredura, processos, intimações, vínculos, painel e fila."""

from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select

from app.core.certificados import CertificadoInvalido
from app.core.db import agora
from app.core.deps import Ctx
from app.core.models import Usuario
from app.core.security import cifrar
from app.modules.faturamento.models import Caso, Contrato, PrioridadeTarefa, Tarefa, TipoTarefa
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais import catalogo, cnj, cobranca, jobs, service
from app.modules.tribunais import certificado as cert_mod
from app.modules.tribunais.models import (
    Alerta,
    CertificadoAdvogado,
    DocumentoAutos,
    Encontrado,
    InscricaoOab,
    Job,
    Movimentacao,
    Parte,
    Pessoa,
    PreferenciaNotificacao,
    Processo,
    Protocolo,
    TermoConsentimento,
    Tribunal,
    UsoCertificado,
    Varredura,
    Vinculo,
)
from app.modules.tribunais.vinculo import normalizar_nome
from app.modules.tribunais.schemas import (
    ConcluirIn,
    ComunicacoesIn,
    CriarCasoIn,
    CriarClienteIn,
    ImportarIn,
    ImportarNumeroIn,
    LidasIn,
    LigarCasoIn,
    OabIn,
    PreferenciaIn,
    ProcessoPatch,
    TarefaPrazoIn,
    VarreduraIn,
    VinculoIn,
)

router = APIRouter(prefix="/tribunais", tags=["Tribunais"])


def _erro(e: Exception, status: int = 400):
    raise HTTPException(status, str(e)) from e


def _dt(v):
    return v.isoformat() if v else None


# ------------------------------------------------------------------------------------------------------ saídas
def cert_out(c: CertificadoAdvogado | None) -> dict | None:
    if not c:
        return None
    dias = (c.valido_ate.replace(tzinfo=UTC) - datetime.now(UTC)).days
    return {"id": c.id, "usuario_id": c.usuario_id, "tipo": c.tipo, "titular_nome": c.titular_nome, "titular_cpf": c.titular_cpf,
            "emissor_ac": c.emissor_ac, "numero_serie": c.numero_serie, "thumbprint_sha256": c.thumbprint_sha256,
            "valido_de": _dt(c.valido_de), "valido_ate": _dt(c.valido_ate), "dias_para_vencer": dias, "revogado": c.revogado,
            "revogacao_verificada_em": _dt(c.revogacao_verificada_em), "revogacao_msg": c.revogacao_msg,
            "escopo_autorizado": c.escopo_autorizado, "criado_em": _dt(c.criado_em)}


def _pode_sigilo(ctx, p: Processo) -> bool:
    return (p.nivel_sigilo or 0) == 0 or ctx.pode("trib_processos.ver_sigilosos") or ctx.usuario.id in (
        p.responsavel_interno_id, p.advogado_id)


def _processo(ctx, pid: int) -> Processo:
    p = ctx.db.get(Processo, pid)
    if not p or p.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Processo não encontrado.")
    if not _pode_sigilo(ctx, p):  # regra 8
        raise HTTPException(403, "Processo sigiloso: seu perfil não tem acesso.")
    return p


def _nome(ctx, uid):
    u = ctx.db.get(Usuario, uid) if uid else None
    return u.nome if u else None


def processo_resumo(ctx, p: Processo) -> dict:
    nao_lidas = ctx.db.scalar(select(func.count()).select_from(Movimentacao).where(
        Movimentacao.processo_id == p.id, Movimentacao.lida_pelo_usuario.is_(False))) or 0
    clientes = [{"id": v.cliente_id, "nome": v.cliente.nome, "status": v.status} for v in p.vinculos
                if v.status in ("automatico", "confirmado", "sugerido") and v.cliente]
    ativo = [pa.pessoa.nome for pa in p.partes if pa.polo == "ativo"]
    passivo = [pa.pessoa.nome for pa in p.partes if pa.polo == "passivo"]
    return {"id": p.id, "numero_cnj": p.numero_cnj, "numero_formatado": p.numero_formatado, "tribunal": p.tribunal.sigla,
            "tribunal_nome": p.tribunal.nome, "ramo": p.tribunal.ramo, "sistema": p.sistema_nome, "grau": p.grau,
            "classe_nome": p.classe_nome, "orgao_julgador": p.orgao_julgador, "situacao": p.situacao, "nivel_sigilo": p.nivel_sigilo,
            "segredo_justica": p.segredo_justica, "partes_resumo": service.resumo_partes(
                [{"nome": n, "polo": "ativo"} for n in ativo] + [{"nome": n, "polo": "passivo"} for n in passivo]),
            "clientes": clientes, "caso_id": p.caso_id, "caso_numero": p.caso.numero if p.caso else None,
            "responsavel_interno_id": p.responsavel_interno_id, "responsavel_nome": _nome(ctx, p.responsavel_interno_id),
            "ultima_sincronizacao": _dt(p.ultima_sincronizacao), "sincronizacao_erro": p.sincronizacao_erro,
            "movimentacoes_nao_lidas": nao_lidas, "monitorar": p.monitorar, "origem_importacao": p.origem_importacao,
            "ultima_movimentacao_em": _dt(max((m.data_hora for m in p.movimentacoes), default=None))}


def parte_out(pa: Parte) -> dict:
    pe = pa.pessoa
    return {"id": pa.id, "polo": pa.polo, "tipo_participacao": pa.tipo_participacao, "ordem": pa.ordem,
            "assistencia_judiciaria": pa.assistencia_judiciaria, "intimacao_pendente": pa.intimacao_pendente,
            "pessoa": {"id": pe.id, "nome": pe.nome, "tipo_pessoa": pe.tipo_pessoa, "cpf": pe.cpf, "cnpj": pe.cnpj,
                       "documento_parcial": pe.documento_parcial, "enderecos": pe.enderecos, "email": pe.email},
            "advogados": [{"id": a.id, "nome": a.nome, "oab_numero": a.oab_numero, "oab_uf": a.oab_uf, "e_o_usuario": a.e_o_usuario,
                           "tipo_representante": a.tipo_representante} for a in pa.advogados]}


def mov_out(m: Movimentacao) -> dict:
    return {"id": m.id, "data_hora": _dt(m.data_hora), "codigo_nacional": m.codigo_nacional, "descricao": m.descricao,
            "complementos": m.complementos, "orgao": m.orgao, "grau": m.grau, "e_intimacao": m.e_intimacao, "prazo_final": _dt(m.prazo_final),
            "fonte": m.fonte, "lida": m.lida_pelo_usuario, "andamento_id": m.andamento_id, "tarefa_id": m.tarefa_id,
            "nivel_sigilo": m.nivel_sigilo}


def processo_detalhe(ctx, p: Processo) -> dict:
    out = processo_resumo(ctx, p)
    out.update({
        "numeros_antigos": p.numeros_antigos, "graus": p.graus, "classe_codigo_cnj": p.classe_codigo_cnj, "assuntos": p.assuntos,
        "competencia": p.competencia, "localidade_codigo": p.localidade_codigo, "localidade_nome": p.localidade_nome,
        "orgao_julgador_codigo": p.orgao_julgador_codigo, "magistrado": p.magistrado,
        "valor_causa": str(p.valor_causa) if p.valor_causa is not None else None, "data_ajuizamento": _dt(p.data_ajuizamento),
        "justica_gratuita": p.justica_gratuita, "prioridades": p.prioridades, "tutela_liminar_requerida": p.tutela_liminar_requerida,
        "juizo_100_digital": p.juizo_100_digital, "processo_principal_cnj": p.processo_principal_cnj,
        "processos_vinculados": p.processos_vinculados, "migrado_de_sistema": p.migrado_de_sistema, "migrado_em": _dt(p.migrado_em),
        "status_interno": p.status_interno, "advogado_id": p.advogado_id, "advogado_nome": _nome(ctx, p.advogado_id),
        "sistema_portal": p.sistema_instancia.url_portal if p.sistema_instancia else None,
        "partes": [parte_out(pa) for pa in p.partes],
        "vinculos": [{"id": v.id, "parte_id": v.parte_id, "cliente_id": v.cliente_id, "cliente_nome": v.cliente.nome if v.cliente else None,
                      "criterio": v.criterio, "confianca": float(v.confianca), "status": v.status, "polo_cliente": v.polo_cliente,
                      "confirmado_por": _nome(ctx, v.confirmado_por_id), "confirmado_em": _dt(v.confirmado_em)} for v in p.vinculos],
        "documentos": [{"id": d.id, "id_documento_tribunal": d.id_documento_tribunal, "id_documento_pai": d.id_documento_pai,
                        "tipo_documento_nome": d.tipo_documento_nome, "descricao": d.descricao, "data_hora_juntada": _dt(d.data_hora_juntada),
                        "mimetype": d.mimetype, "tamanho_bytes": d.tamanho_bytes, "paginas": d.paginas, "nivel_sigilo": d.nivel_sigilo,
                        "status_download": d.status_download, "tem_arquivo": bool(d.storage_ref)} for d in p.documentos
                       if d.nivel_sigilo == 0 or ctx.pode("trib_processos.ver_sigilosos")],
        "protocolos": [{"id": x.id, "tipo": x.tipo, "status": x.status, "titulo": x.titulo or x.tipo_peticao_nome, "criado_em": _dt(x.criado_em)}
                       for x in ctx.db.scalars(select(Protocolo).where(Protocolo.processo_id == p.id).order_by(Protocolo.id.desc()))],
        "total_movimentacoes": len(p.movimentacoes),
    })
    return out


def encontrado_out(ctx, e: Encontrado) -> dict:
    cli = ctx.db.get(Tomador, e.possivel_cliente_id) if e.possivel_cliente_id else None
    return {"id": e.id, "numero_cnj": e.numero_cnj, "numero_formatado": cnj.formatar(e.numero_cnj), "tribunal": e.tribunal_sigla,
            "sistema_provavel": e.sistema_provavel, "fonte": e.fonte, "partes_resumo": e.partes_resumo, "classe_resumo": e.classe_resumo,
            "orgao_resumo": e.orgao_resumo, "ultima_movimentacao_em": _dt(e.ultima_movimentacao_em), "comunicacoes": e.comunicacoes,
            "segredo_justica": e.segredo_justica, "possivel_cliente_id": e.possivel_cliente_id,
            "possivel_cliente_nome": cli.nome if cli else None, "possivel_cliente_criterio": e.possivel_cliente_criterio,
            "ja_importado": e.ja_importado, "selecionado_para_importar": e.selecionado_para_importar,
            "status_importacao": e.status_importacao, "erro": e.erro, "processo_id": e.processo_id,
            "partes": (e.dados or {}).get("partes", []), "advogados": (e.dados or {}).get("advogados", [])}


def varredura_out(ctx, v: Varredura) -> dict:
    plat = service.plataforma(ctx.db)
    contagem = dict(ctx.db.execute(select(Encontrado.status_importacao, func.count()).where(Encontrado.varredura_id == v.id)
                                   .group_by(Encontrado.status_importacao)).all())
    return {"id": v.id, "advogado_id": v.advogado_id, "advogado_nome": _nome(ctx, v.advogado_id), "inscricoes_oab": v.inscricoes_oab,
            "tribunais_alvo": v.tribunais_alvo, "data_inicio": _dt(v.data_inicio), "data_fim": _dt(v.data_fim), "coleta": v.coleta,
            "status": v.status, "iniciada_em": _dt(v.iniciada_em), "concluida_em": _dt(v.concluida_em),
            "total_comunicacoes": v.total_comunicacoes, "total_encontrados": v.total_encontrados,
            "resumo_por_tribunal": v.resumo_por_tribunal, "erro": v.erro, "por_status": contagem,
            # o navegador consulta o DJEN direto (ele libera CORS) e manda as páginas para /comunicacoes
            "djen": {"url": plat.djen_url.rstrip("/") + "/comunicacao", "itens_por_pagina": 100, "requisicoes_por_minuto": 18}}


# ------------------------------------------------------------------------------------------------- eu (advogado)
@router.get("/eu")
def eu(ctx: Ctx):
    plat = service.plataforma(ctx.db)
    u = ctx.usuario
    termo = ctx.db.scalar(select(TermoConsentimento).where(TermoConsentimento.usuario_id == u.id, TermoConsentimento.revogado_em.is_(None))
                          .order_by(TermoConsentimento.id.desc()))
    prefs = {p.evento: {"receber": p.receber, "email_alternativo": p.email_alternativo}
             for p in ctx.db.scalars(select(PreferenciaNotificacao).where(PreferenciaNotificacao.usuario_id == u.id))}
    ctx.db.commit()
    return {"usuario_id": u.id, "nome": u.nome, "cpf": u.cpf, "email": u.email, "oabs": service.oabs_do_advogado(ctx.db, u),
            "oabs_cadastradas": [{"id": o.id, "numero": o.numero, "uf": o.uf, "tipo": o.tipo, "letra_complementar": o.letra_complementar,
                                  "situacao": o.situacao} for o in ctx.db.scalars(select(InscricaoOab).where(InscricaoOab.usuario_id == u.id))],
            "certificado": cert_out(service.certificado_ativo(ctx.db, u.id)),
            "termo": {"id": termo.id, "versao": termo.versao_termo, "escopos": termo.escopos_aceitos, "aceito_em": _dt(termo.aceito_em)}
            if termo else None,
            "termo_vigente": {"versao": plat.termo_versao, "texto": plat.termo_texto or catalogo.TERMO_PADRAO},
            "preferencias": prefs}


def _salvar_oabs(ctx, usuario: Usuario, oabs: list[OabIn]) -> None:
    for o in ctx.db.scalars(select(InscricaoOab).where(InscricaoOab.usuario_id == usuario.id)):
        ctx.db.delete(o)
    ctx.db.flush()
    vistos = set()
    for o in oabs:
        chave = (o.numero, o.uf, o.letra_complementar)
        if chave in vistos:
            continue
        vistos.add(chave)
        outro = ctx.db.scalar(select(InscricaoOab).where(InscricaoOab.tenant_id == ctx.tenant_id, InscricaoOab.numero == o.numero,
                                                         InscricaoOab.uf == o.uf, InscricaoOab.usuario_id != usuario.id))
        if outro:
            raise HTTPException(400, f"A OAB {o.numero}/{o.uf} já está cadastrada para outro profissional.")
        ctx.db.add(InscricaoOab(tenant_id=ctx.tenant_id, usuario_id=usuario.id, **o.model_dump()))
    if oabs and not usuario.oab:
        principal = next((o for o in oabs if o.tipo == "principal"), oabs[0])
        usuario.oab = f"{principal.numero}/{principal.uf}"


@router.put("/eu/oabs")
def minhas_oabs(oabs: list[OabIn], ctx: Ctx):
    _salvar_oabs(ctx, ctx.usuario, oabs)
    ctx.auditar("tribunais.oab.alterar", "usuario", ctx.usuario.id, descricao=", ".join(f"{o.numero}/{o.uf}" for o in oabs))
    ctx.db.commit()
    return eu(ctx)


@router.post("/eu/certificado")
async def enviar_certificado(request: Request, ctx: Ctx, arquivo: UploadFile = File(...), senha: str = Form(...),
                             escopos: str = Form("consulta,download,protocolo"), aceite_termo: bool = Form(...),
                             versao_termo: str = Form(...)):
    """Upload do e-CPF (A1) com o aceite do termo LGPD. Substitui o certificado anterior (que é apagado do cofre)."""
    if not aceite_termo:
        raise HTTPException(400, "É preciso aceitar o termo de consentimento para guardar o certificado.")
    plat = service.plataforma(ctx.db)
    if versao_termo != plat.termo_versao:
        raise HTTPException(400, "O termo foi atualizado. Recarregue a página e leia a versão nova.")
    lista = [e.strip() for e in escopos.split(",") if e.strip() in cert_mod.ESCOPOS]
    if not lista:
        raise HTTPException(400, "Marque ao menos uma finalidade (consulta, download ou protocolo).")
    pfx = await arquivo.read()
    if len(pfx) > 50_000:
        raise HTTPException(400, "Arquivo grande demais para um certificado A1 (.pfx/.p12).")
    try:
        info = cert_mod.ler(pfx, senha)
    except CertificadoInvalido as e:
        _erro(e)
    u = ctx.usuario
    if info.valido_ate < datetime.now(UTC):
        raise HTTPException(400, f"Este certificado venceu em {info.valido_ate:%d/%m/%Y}.")
    if info.titular_cpf and u.cpf and info.titular_cpf != u.cpf:
        raise HTTPException(400, "O CPF do certificado não é o seu CPF cadastrado. O certificado precisa ser do próprio advogado.")
    if not info.titular_cpf:
        raise HTTPException(400, "Não encontrei o CPF no certificado. Use um e-CPF (certificado de pessoa física ICP-Brasil).")
    plano = cobranca.plano_do(ctx.db, ctx.tenant_id)
    if plano and plano.limite_certificados:
        ativos = ctx.db.scalar(select(func.count()).select_from(CertificadoAdvogado).where(
            CertificadoAdvogado.tenant_id == ctx.tenant_id, CertificadoAdvogado.removido_em.is_(None),
            CertificadoAdvogado.usuario_id != u.id)) or 0
        if ativos >= plano.limite_certificados:
            raise HTTPException(400, f"O plano permite {plano.limite_certificados} advogado(s) com certificado.")
    u.cpf = u.cpf or info.titular_cpf
    for antigo in ctx.db.scalars(select(CertificadoAdvogado).where(CertificadoAdvogado.usuario_id == u.id,
                                                                  CertificadoAdvogado.removido_em.is_(None))):
        antigo.pfx_cifrado = antigo.senha_cifrada = None
        antigo.removido_em = agora()
    termo = TermoConsentimento(tenant_id=ctx.tenant_id, usuario_id=u.id, versao_termo=plat.termo_versao, escopos_aceitos=lista,
                               ip=ctx.ip, user_agent=(request.headers.get("user-agent") or "")[:300])
    ctx.db.add(termo)
    ctx.db.flush()
    c = CertificadoAdvogado(tenant_id=ctx.tenant_id, usuario_id=u.id, tipo="A1", pfx_cifrado=cifrar(pfx), senha_cifrada=cifrar(senha.encode()),
                            titular_nome=info.titular_nome, titular_cpf=info.titular_cpf, emissor_ac=info.emissor_ac,
                            numero_serie=info.numero_serie, thumbprint_sha256=info.thumbprint_sha256, valido_de=info.valido_de,
                            valido_ate=info.valido_ate, escopo_autorizado=lista, termo_consentimento_id=termo.id, alertas_enviados=[])
    ctx.db.add(c)
    ctx.db.flush()
    cert_mod.verificar_revogacao(c, timeout=8)
    ctx.auditar("tribunais.certificado.enviar", "trb_certificado", c.id, descricao=f"{info.titular_nome} · válido até {info.valido_ate:%d/%m/%Y}"
                f" · {', '.join(lista)}")
    ctx.db.commit()
    return eu(ctx)


def _remover_certificado(ctx, motivo: str) -> None:
    for c in ctx.db.scalars(select(CertificadoAdvogado).where(CertificadoAdvogado.usuario_id == ctx.usuario.id,
                                                             CertificadoAdvogado.removido_em.is_(None))):
        c.pfx_cifrado = c.senha_cifrada = None  # remoção = apagar do cofre
        c.removido_em = agora()
        ctx.auditar("tribunais.certificado.remover", "trb_certificado", c.id, descricao=motivo)


@router.delete("/eu/certificado")
def remover_certificado(ctx: Ctx):
    _remover_certificado(ctx, "Removido pelo titular")
    ctx.db.commit()
    return eu(ctx)


@router.post("/eu/termo/revogar")
def revogar_termo(ctx: Ctx):
    """Revogar o consentimento apaga o certificado do cofre na hora."""
    for t in ctx.db.scalars(select(TermoConsentimento).where(TermoConsentimento.usuario_id == ctx.usuario.id,
                                                            TermoConsentimento.revogado_em.is_(None))):
        t.revogado_em = agora()
    _remover_certificado(ctx, "Termo de consentimento revogado")
    ctx.auditar("tribunais.termo.revogar", "usuario", ctx.usuario.id)
    ctx.db.commit()
    return eu(ctx)


@router.put("/eu/preferencias")
def minhas_preferencias(prefs: list[PreferenciaIn], ctx: Ctx):
    for p in prefs:
        atual = ctx.db.scalar(select(PreferenciaNotificacao).where(PreferenciaNotificacao.usuario_id == ctx.usuario.id,
                                                                   PreferenciaNotificacao.evento == p.evento))
        if not atual:
            atual = PreferenciaNotificacao(tenant_id=ctx.tenant_id, usuario_id=ctx.usuario.id, evento=p.evento)
            ctx.db.add(atual)
        atual.receber = True if p.evento == "protocolo_falha" else p.receber  # falha não pode ser desligada
        atual.email_alternativo = p.email_alternativo
    ctx.db.commit()
    return eu(ctx)


@router.get("/eu/uso-certificado")
def meu_uso_certificado(ctx: Ctx, limite: int = Query(100, le=500)):
    ids = list(ctx.db.scalars(select(CertificadoAdvogado.id).where(CertificadoAdvogado.usuario_id == ctx.usuario.id)))
    return [_uso_out(ctx, x) for x in ctx.db.scalars(select(UsoCertificado).where(UsoCertificado.certificado_id.in_(ids or [0]))
                                                    .order_by(UsoCertificado.id.desc()).limit(limite))]


def _uso_out(ctx, x: UsoCertificado) -> dict:
    t = ctx.db.get(Tribunal, x.tribunal_id) if x.tribunal_id else None
    return {"id": x.id, "certificado_id": x.certificado_id, "acao": x.acao, "tribunal": t.sigla if t else None, "referencia": x.referencia,
            "usuario": _nome(ctx, x.usuario_disparou_id) or "Robô (automático)", "aprovacao_humana_id": x.aprovacao_humana_id,
            "data_hora": _dt(x.data_hora), "ip_origem": x.ip_origem, "resultado": x.resultado, "detalhe": x.detalhe}


# ----------------------------------------------------------------------------------------- advogados (gestão)
@router.get("/advogados")
def advogados(ctx: Ctx):
    """Profissionais com OAB/certificado: base para a varredura e o protocolo."""
    out = []
    for u in ctx.db.scalars(select(Usuario).where(Usuario.tenant_id == ctx.tenant_id, Usuario.ativo.is_(True)).order_by(Usuario.nome)):
        oabs = service.oabs_do_advogado(ctx.db, u)
        cert = service.certificado_ativo(ctx.db, u.id)
        if not oabs and not cert:
            continue
        ultima = ctx.db.scalar(select(Varredura).where(Varredura.advogado_id == u.id).order_by(Varredura.id.desc()))
        out.append({"id": u.id, "nome": u.nome, "cpf": u.cpf, "email": u.email, "oabs": oabs, "certificado": cert_out(cert),
                    "ultima_varredura": varredura_out(ctx, ultima) if ultima else None,
                    "processos": ctx.db.scalar(select(func.count()).select_from(Processo).where(Processo.advogado_id == u.id)) or 0})
    return out


@router.get("/advogados/candidatos")
def candidatos(ctx: Ctx):
    """Todos os profissionais (para cadastrar OAB de quem ainda não tem)."""
    return [{"id": u.id, "nome": u.nome, "cpf": u.cpf, "oab": u.oab, "oabs": service.oabs_do_advogado(ctx.db, u)}
            for u in ctx.db.scalars(select(Usuario).where(Usuario.tenant_id == ctx.tenant_id, Usuario.ativo.is_(True)).order_by(Usuario.nome))]


@router.put("/advogados/{uid}/oabs")
def oabs_do_profissional(uid: int, oabs: list[OabIn], ctx: Ctx):
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Profissional não encontrado.")
    _salvar_oabs(ctx, u, oabs)
    ctx.auditar("tribunais.oab.alterar", "usuario", u.id, descricao=", ".join(f"{o.numero}/{o.uf}" for o in oabs))
    ctx.db.commit()
    return {"id": u.id, "oabs": service.oabs_do_advogado(ctx.db, u)}


@router.get("/uso-certificado")
def uso_certificado(ctx: Ctx, usuario_id: int | None = None, limite: int = Query(200, le=1000)):
    q = select(UsoCertificado).where(UsoCertificado.tenant_id == ctx.tenant_id)
    if usuario_id:
        ids = list(ctx.db.scalars(select(CertificadoAdvogado.id).where(CertificadoAdvogado.usuario_id == usuario_id)))
        q = q.where(UsoCertificado.certificado_id.in_(ids or [0]))
    return [_uso_out(ctx, x) for x in ctx.db.scalars(q.order_by(UsoCertificado.id.desc()).limit(limite))]


# -------------------------------------------------------------------------------------------------- varredura
def _advogado(ctx, uid: int) -> Usuario:
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Advogado não encontrado.")
    return u


@router.post("/varreduras", status_code=201)
def nova_varredura(dados: VarreduraIn, ctx: Ctx):
    adv = _advogado(ctx, dados.advogado_id)
    inicio, fim = dados.data_inicio, dados.data_fim
    if dados.so_novas and not inicio:  # intimações novas: desde a última varredura concluída (com 1 dia de folga)
        inicio, fim = service.inicio_intimacoes_novas(ctx.db, adv.id), fim or date.today()
    if inicio and fim and inicio > fim:
        raise HTTPException(400, "A data inicial é depois da final.")
    try:
        v = service.iniciar_varredura(ctx.db, ctx.tenant_id, adv, ctx.usuario, data_inicio=inicio, data_fim=fim,
                                      tribunais_alvo=dados.tribunais_alvo)
    except service.ErroIntegracao as e:
        _erro(e)
    ctx.auditar("tribunais.varredura.iniciar", "trb_varredura", v.id, descricao=f"{adv.nome}: " + ", ".join(
        f"{o['numero']}/{o['uf']}" for o in v.inscricoes_oab))
    if v.coleta == "servidor":
        jobs.enfileirar(ctx.db, ctx.tenant_id, "varredura", v.id, criado_por_id=ctx.usuario.id)
    ctx.db.commit()
    if v.coleta == "servidor":
        jobs.disparar()
        ctx.db.refresh(v)
    return varredura_out(ctx, v)


@router.get("/varreduras")
def varreduras(ctx: Ctx, advogado_id: int | None = None):
    q = select(Varredura).where(Varredura.tenant_id == ctx.tenant_id)
    if advogado_id:
        q = q.where(Varredura.advogado_id == advogado_id)
    return [varredura_out(ctx, v) for v in ctx.db.scalars(q.order_by(Varredura.id.desc()).limit(100))]


def _varredura(ctx, vid: int) -> Varredura:
    v = ctx.db.get(Varredura, vid)
    if not v or v.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Varredura não encontrada.")
    return v


@router.get("/varreduras/{vid}")
def ler_varredura(vid: int, ctx: Ctx, tribunal: str | None = None, status: str | None = None, q: str | None = None,
                  so_clientes: bool = False, pagina: int = 1, por_pagina: int = Query(100, le=500)):
    v = _varredura(ctx, vid)
    sel = select(Encontrado).where(Encontrado.varredura_id == v.id)
    if tribunal:
        sel = sel.where(Encontrado.tribunal_sigla == tribunal.upper())
    if status:
        sel = sel.where(Encontrado.status_importacao == status)
    if so_clientes:
        sel = sel.where(Encontrado.possivel_cliente_id.is_not(None))
    if q:
        termo = f"%{q.strip()}%"
        sel = sel.where(or_(Encontrado.partes_resumo.ilike(termo), Encontrado.numero_cnj.like(f"%{cnj.so_digitos(q) or '#'}%"),
                            Encontrado.classe_resumo.ilike(termo)))
    total = ctx.db.scalar(select(func.count()).select_from(sel.subquery())) or 0
    itens = ctx.db.scalars(sel.order_by(Encontrado.ultima_movimentacao_em.desc().nullslast(), Encontrado.id)
                           .offset((pagina - 1) * por_pagina).limit(por_pagina))
    return {**varredura_out(ctx, v), "encontrados": [encontrado_out(ctx, e) for e in itens], "total_filtrado": total, "pagina": pagina}


@router.post("/varreduras/{vid}/comunicacoes")
def receber_comunicacoes(vid: int, dados: ComunicacoesIn, ctx: Ctx):
    """Página do DJEN colhida pelo navegador (o DJEN não responde ao servidor fora do Brasil)."""
    v = _varredura(ctx, vid)
    try:
        r = service.ingerir_comunicacoes(ctx.db, v, dados.itens)
    except service.ErroIntegracao as e:
        _erro(e)
    ctx.db.commit()
    return r


@router.post("/varreduras/{vid}/concluir")
def concluir(vid: int, dados: ConcluirIn, ctx: Ctx):
    v = _varredura(ctx, vid)
    if v.status == "rodando":
        service.concluir_varredura(ctx.db, v, erro=dados.erro, parcial=dados.parcial)
        ctx.auditar("tribunais.varredura.concluir", "trb_varredura", v.id,
                    descricao=f"{v.total_encontrados} processos em {v.total_comunicacoes} comunicações")
        ctx.db.commit()
    return varredura_out(ctx, v)


@router.post("/varreduras/{vid}/importar")
def importar_encontrados(vid: int, dados: ImportarIn, ctx: Ctx):
    v = _varredura(ctx, vid)
    if v.status == "rodando":
        raise HTTPException(400, "Espere a varredura terminar para importar.")
    sel = select(Encontrado).where(Encontrado.varredura_id == v.id, Encontrado.status_importacao.in_(("nao_importar", "erro")))
    if not dados.todos:
        if not dados.encontrado_ids:
            raise HTTPException(400, "Escolha os processos a importar.")
        sel = sel.where(Encontrado.id.in_(dados.encontrado_ids))
    plano = cobranca.plano_do(ctx.db, ctx.tenant_id)
    escolhidos = list(ctx.db.scalars(sel))
    if plano and plano.limite_processos_monitorados:
        atuais = ctx.db.scalar(select(func.count()).select_from(Processo).where(Processo.tenant_id == ctx.tenant_id,
                                                                                Processo.monitorar.is_(True))) or 0
        if atuais + len(escolhidos) > plano.limite_processos_monitorados:
            raise HTTPException(400, f"O plano permite {plano.limite_processos_monitorados} processos monitorados "
                                     f"(hoje: {atuais}; selecionados: {len(escolhidos)}).")
    for e in escolhidos:
        e.selecionado_para_importar, e.status_importacao, e.erro = True, "fila", None
        jobs.enfileirar(ctx.db, ctx.tenant_id, "importar_processo", e.id, tribunal_id=e.tribunal_id, criado_por_id=ctx.usuario.id)
    ctx.auditar("tribunais.importar", "trb_varredura", v.id, descricao=f"{len(escolhidos)} processo(s) para importar")
    ctx.db.commit()
    jobs.disparar()
    return {"na_fila": len(escolhidos)}


# -------------------------------------------------------------------------------------------------- processos
@router.get("/processos")
def processos(ctx: Ctx, q: str | None = None, tribunal: str | None = None, situacao: str | None = None, cliente_id: int | None = None,
              responsavel_id: int | None = None, com_intimacao: bool = False, sem_caso: bool = False, pagina: int = 1,
              por_pagina: int = Query(50, le=200)):
    sel = select(Processo).where(Processo.tenant_id == ctx.tenant_id)
    if not ctx.pode("trib_processos.ver_sigilosos"):
        sel = sel.where(or_(Processo.nivel_sigilo == 0, Processo.responsavel_interno_id == ctx.usuario.id,
                            Processo.advogado_id == ctx.usuario.id))
    if q:
        dig = cnj.so_digitos(q)
        conds = [Processo.classe_nome.ilike(f"%{q}%"), Processo.orgao_julgador.ilike(f"%{q}%"),
                 Processo.id.in_(select(Parte.processo_id).join(Pessoa, Pessoa.id == Parte.pessoa_id).where(
                     Pessoa.nome_normalizado.like(f"%{normalizar_nome(q)}%")))]
        if len(dig) >= 4:
            conds.append(Processo.numero_cnj.like(f"%{dig}%"))
        sel = sel.where(or_(*conds))
    if tribunal:
        sel = sel.join(Tribunal, Tribunal.id == Processo.tribunal_id).where(Tribunal.sigla == tribunal.upper())
    if situacao:
        sel = sel.where(Processo.situacao == situacao)
    if cliente_id:
        sel = sel.where(Processo.id.in_(select(Vinculo.processo_id).where(Vinculo.cliente_id == cliente_id,
                                                                          Vinculo.status.in_(("automatico", "confirmado")))))
    if responsavel_id:
        sel = sel.where(Processo.responsavel_interno_id == responsavel_id)
    if com_intimacao:
        sel = sel.where(Processo.id.in_(select(Movimentacao.processo_id).where(Movimentacao.e_intimacao.is_(True),
                                                                               Movimentacao.lida_pelo_usuario.is_(False))))
    if sem_caso:
        sel = sel.where(Processo.caso_id.is_(None))
    total = ctx.db.scalar(select(func.count()).select_from(sel.subquery())) or 0
    itens = ctx.db.scalars(sel.order_by(Processo.id.desc()).offset((pagina - 1) * por_pagina).limit(por_pagina))
    return {"itens": [processo_resumo(ctx, p) for p in itens], "total": total, "pagina": pagina}


@router.post("/processos/importar", status_code=201)
def importar_numero(dados: ImportarNumeroIn, ctx: Ctx):
    """Importação manual pelo número (DataJud + MNI, se houver certificado)."""
    adv_id = dados.advogado_id or ctx.usuario.id
    _advogado(ctx, adv_id)
    try:
        p = service.importar(ctx.db, ctx.tenant_id, dados.numero_cnj, usuario_id=ctx.usuario.id, advogado_id=adv_id, origem="manual")
    except service.ErroIntegracao as e:
        _erro(e)
    ctx.auditar("tribunais.processo.importar", "trb_processo", p.id, descricao=p.numero_formatado)
    ctx.db.commit()
    return processo_detalhe(ctx, p)


@router.get("/processos/{pid}")
def ler_processo(pid: int, ctx: Ctx):
    return processo_detalhe(ctx, _processo(ctx, pid))


@router.patch("/processos/{pid}")
def alterar_processo(pid: int, dados: ProcessoPatch, ctx: Ctx):
    p = _processo(ctx, pid)
    for k, v in dados.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    if p.caso and dados.responsavel_interno_id and not p.caso.responsavel_id:
        p.caso.responsavel_id = dados.responsavel_interno_id
    ctx.auditar("tribunais.processo.alterar", "trb_processo", p.id, descricao=p.numero_formatado, depois=dados.model_dump(exclude_unset=True))
    ctx.db.commit()
    return processo_detalhe(ctx, p)


@router.delete("/processos/{pid}")
def excluir_processo(pid: int, ctx: Ctx):
    p = _processo(ctx, pid)
    if ctx.db.scalar(select(Protocolo.id).where(Protocolo.processo_id == p.id, Protocolo.status == "protocolado")):
        raise HTTPException(400, "Este processo tem protocolos feitos pelo sistema: pare de monitorar em vez de excluir.")
    ctx.auditar("tribunais.processo.excluir", "trb_processo", p.id, descricao=p.numero_formatado)
    for e in ctx.db.scalars(select(Encontrado).where(Encontrado.processo_id == p.id)):
        e.processo_id, e.status_importacao = None, "nao_importar"
    ctx.db.delete(p)
    ctx.db.commit()
    return {"ok": True}


@router.post("/processos/{pid}/sincronizar")
def sincronizar_agora(pid: int, ctx: Ctx):
    p = _processo(ctx, pid)
    try:
        r = service.sincronizar(ctx.db, p)
        if p.advogado_id:
            service.consultar_mni(ctx.db, p, p.advogado_id, ctx.usuario.id)
    except service.fontes.FonteIndisponivel as e:
        ctx.db.commit()
        _erro(e, 502)
    ctx.db.commit()
    return {**r, "processo": processo_detalhe(ctx, p)}


@router.post("/processos/{pid}/baixar-documentos")
def baixar_documentos(pid: int, ctx: Ctx):
    p = _processo(ctx, pid)
    cfg = service.config(ctx.db, ctx.tenant_id)
    if cfg.modo != "real":
        raise HTTPException(400, "O download dos autos com certificado só funciona no modo real (Configurações › Tribunais).")
    jobs.enfileirar(ctx.db, ctx.tenant_id, "baixar_documentos", p.id, tribunal_id=p.tribunal_id, criado_por_id=ctx.usuario.id)
    ctx.db.commit()
    jobs.disparar()
    return {"na_fila": True}


@router.get("/processos/{pid}/movimentacoes")
def movimentacoes(pid: int, ctx: Ctx, so_intimacoes: bool = False, nao_lidas: bool = False, pagina: int = 1,
                  por_pagina: int = Query(100, le=500)):
    p = _processo(ctx, pid)
    sel = select(Movimentacao).where(Movimentacao.processo_id == p.id)
    if so_intimacoes:
        sel = sel.where(Movimentacao.e_intimacao.is_(True))
    if nao_lidas:
        sel = sel.where(Movimentacao.lida_pelo_usuario.is_(False))
    if not ctx.pode("trib_processos.ver_sigilosos"):
        sel = sel.where(Movimentacao.nivel_sigilo == 0)
    total = ctx.db.scalar(select(func.count()).select_from(sel.subquery())) or 0
    itens = ctx.db.scalars(sel.order_by(Movimentacao.data_hora.desc(), Movimentacao.id.desc()).offset((pagina - 1) * por_pagina).limit(por_pagina))
    return {"itens": [mov_out(m) for m in itens], "total": total, "pagina": pagina}


@router.post("/processos/{pid}/movimentacoes/lidas")
def marcar_lidas(pid: int, dados: LidasIn, ctx: Ctx):
    p = _processo(ctx, pid)
    sel = select(Movimentacao).where(Movimentacao.processo_id == p.id, Movimentacao.lida_pelo_usuario.is_(False))
    if not dados.todas:
        sel = sel.where(Movimentacao.id.in_(dados.ids or [0]))
    n = 0
    for m in ctx.db.scalars(sel):
        m.lida_pelo_usuario = True
        n += 1
    ctx.db.commit()
    return {"marcadas": n}


@router.post("/movimentacoes/{mid}/tarefa", status_code=201)
def tarefa_da_intimacao(mid: int, dados: TarefaPrazoIn, ctx: Ctx):
    """Intimação → tarefa de prazo no caso (com o prazo final na movimentação, para o alerta do protocolo)."""
    m = ctx.db.get(Movimentacao, mid)
    if not m:
        raise HTTPException(404, "Movimentação não encontrada.")
    p = _processo(ctx, m.processo_id)
    if m.tarefa_id:
        raise HTTPException(400, "Esta movimentação já tem tarefa.")
    t = Tarefa(tenant_id=ctx.tenant_id, caso_id=p.caso_id, titulo=(dados.titulo or f"Prazo — {p.numero_formatado}")[:200],
               descricao=m.descricao[:4000], tipo=TipoTarefa.prazo, prioridade=PrioridadeTarefa(dados.prioridade), prazo=dados.prazo,
               responsavel_id=dados.responsavel_id or p.responsavel_interno_id or ctx.usuario.id, etiquetas=["intimação", p.tribunal.sigla],
               criado_por_id=ctx.usuario.id)
    ctx.db.add(t)
    ctx.db.flush()
    m.tarefa_id, m.prazo_final, m.lida_pelo_usuario = t.id, dados.prazo, True
    ctx.auditar("tribunais.intimacao.tarefa", "fat_tarefa", t.id, descricao=f"{p.numero_formatado} · prazo {dados.prazo:%d/%m/%Y}")
    ctx.db.commit()
    return {"tarefa_id": t.id, "movimentacao": mov_out(m)}


@router.get("/documentos/{did}/arquivo")
def arquivo_documento(did: int, ctx: Ctx):
    d = ctx.db.get(DocumentoAutos, did)
    if not d:
        raise HTTPException(404, "Documento não encontrado.")
    p = _processo(ctx, d.processo_id)
    if d.nivel_sigilo > 0 and not ctx.pode("trib_processos.ver_sigilosos"):
        raise HTTPException(403, "Documento sigiloso.")
    if not d.storage_ref or not Path(d.storage_ref).exists():
        raise HTTPException(404, "O arquivo ainda não foi baixado do tribunal.")
    ctx.auditar("tribunais.documento.abrir", "trb_documento", d.id, descricao=f"{p.numero_formatado} · {d.tipo_documento_nome}")
    ctx.db.commit()
    return FileResponse(d.storage_ref, media_type=d.mimetype, filename=Path(d.storage_ref).name)


# ---------------------------------------------------------------------------------------------- vínculo / caso
def _vinculo(ctx, vid: int) -> Vinculo:
    v = ctx.db.get(Vinculo, vid)
    if not v:
        raise HTTPException(404, "Vínculo não encontrado.")
    _processo(ctx, v.processo_id)
    return v


@router.post("/processos/{pid}/vinculos", status_code=201)
def vincular_manual(pid: int, dados: VinculoIn, ctx: Ctx):
    p = _processo(ctx, pid)
    cli = ctx.db.get(Tomador, dados.cliente_id)
    if not cli or cli.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Cliente não encontrado.")
    parte = next((x for x in p.partes if x.id == dados.parte_id), None) if dados.parte_id else None
    if dados.parte_id and not parte:
        raise HTTPException(404, "Parte não encontrada neste processo.")
    v = next((x for x in p.vinculos if x.cliente_id == cli.id and x.parte_id == dados.parte_id), None)
    if not v:
        v = Vinculo(processo_id=p.id, parte_id=dados.parte_id, cliente_id=cli.id, criterio="manual", confianca=1, status="confirmado",
                    polo_cliente=parte.polo if parte else None)
        p.vinculos.append(v)
    v.status, v.confirmado_por_id, v.confirmado_em = "confirmado", ctx.usuario.id, agora()
    ctx.auditar("tribunais.vinculo.criar", "trb_processo", p.id, descricao=f"{p.numero_formatado} → {cli.nome}")
    ctx.db.commit()
    return processo_detalhe(ctx, p)


@router.post("/vinculos/{vid}/confirmar")
def confirmar_vinculo(vid: int, ctx: Ctx):
    v = _vinculo(ctx, vid)
    v.status, v.confirmado_por_id, v.confirmado_em = "confirmado", ctx.usuario.id, agora()
    ctx.auditar("tribunais.vinculo.confirmar", "trb_processo", v.processo_id, descricao=v.cliente.nome if v.cliente else None)
    ctx.db.commit()
    return processo_detalhe(ctx, v.processo)


@router.post("/vinculos/{vid}/rejeitar")
def rejeitar_vinculo(vid: int, ctx: Ctx):
    v = _vinculo(ctx, vid)
    v.status, v.confirmado_por_id, v.confirmado_em = "rejeitado", ctx.usuario.id, agora()
    ctx.auditar("tribunais.vinculo.rejeitar", "trb_processo", v.processo_id, descricao=v.cliente.nome if v.cliente else None)
    ctx.db.commit()
    return processo_detalhe(ctx, v.processo)


@router.post("/processos/{pid}/criar-cliente", status_code=201)
def criar_cliente_da_parte(pid: int, dados: CriarClienteIn, ctx: Ctx):
    """9.3: parte sem cadastro → cliente novo pré-preenchido + vínculo confirmado."""
    if not ctx.pode("clientes.editar"):
        raise HTTPException(403, "Seu perfil não pode cadastrar clientes.")
    p = _processo(ctx, pid)
    parte = next((x for x in p.partes if x.id == dados.parte_id), None)
    if not parte:
        raise HTTPException(404, "Parte não encontrada.")
    pe = parte.pessoa
    doc = pe.cnpj or pe.cpf
    if doc and ctx.db.scalar(select(Tomador.id).where(Tomador.tenant_id == ctx.tenant_id, Tomador.cpf_cnpj == doc)):
        raise HTTPException(400, "Já existe cliente com este CPF/CNPJ: use Vincular.")
    end = next(iter(pe.enderecos or []), {}) or {}
    cli = Tomador(tenant_id=ctx.tenant_id, tipo="PJ" if pe.tipo_pessoa == "juridica" else "PF", nome=pe.nome[:200], cpf_cnpj=doc,
                  logradouro=(end.get("logradouro") or "")[:150] or None, numero=(end.get("numero") or "")[:10] or None,
                  complemento=(end.get("complemento") or "")[:60] or None, bairro=(end.get("bairro") or "")[:80] or None,
                  cidade=(end.get("cidade") or "")[:80] or None, uf=(end.get("uf") or "")[:2] or None,
                  cep="".join(c for c in (end.get("cep") or "") if c.isdigit())[:8] or None, emails=[pe.email] if pe.email else [],
                  enderecos=[], contatos=[], telefones=[{"numero": t, "tipo": "comercial"} for t in pe.telefones or []],
                  observacoes=f"Criado a partir do processo {p.numero_formatado}.")
    ctx.db.add(cli)
    ctx.db.flush()
    p.vinculos.append(Vinculo(processo_id=p.id, parte_id=parte.id, cliente_id=cli.id, criterio="manual", confianca=1, status="confirmado",
                              polo_cliente=parte.polo, confirmado_por_id=ctx.usuario.id, confirmado_em=agora()))
    ctx.auditar("tribunais.cliente.criar", "tomador", cli.id, descricao=f"{cli.nome} (parte de {p.numero_formatado})")
    ctx.db.commit()
    return {"cliente_id": cli.id, "processo": processo_detalhe(ctx, p)}


@router.post("/processos/{pid}/caso", status_code=201)
def criar_caso(pid: int, dados: CriarCasoIn, ctx: Ctx):
    if not ctx.pode("casos.editar"):
        raise HTTPException(403, "Seu perfil não pode criar casos.")
    p = _processo(ctx, pid)
    if p.caso_id:
        raise HTTPException(400, "O processo já está ligado a um caso.")
    contrato = ctx.db.get(Contrato, dados.contrato_id)
    if not contrato or contrato.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Contrato não encontrado.")
    try:
        c = service.criar_caso(ctx.db, p, contrato, ctx.usuario, dados.titulo)
    except service.ErroIntegracao as e:
        _erro(e)
    ctx.auditar("faturamento.caso.criar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo} (do processo {p.numero_formatado})")
    ctx.db.commit()
    return {"caso_id": c.id, "caso_numero": c.numero, "processo": processo_detalhe(ctx, p)}


@router.post("/processos/{pid}/ligar-caso")
def ligar_caso(pid: int, dados: LigarCasoIn, ctx: Ctx):
    p = _processo(ctx, pid)
    c = ctx.db.get(Caso, dados.caso_id)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Caso não encontrado.")
    outro = ctx.db.scalar(select(Processo).where(Processo.caso_id == c.id, Processo.id != p.id))
    if outro:
        raise HTTPException(400, f"Este caso já está ligado ao processo {outro.numero_formatado}.")
    service.ligar_caso(ctx.db, p, c)
    ctx.auditar("tribunais.processo.ligar_caso", "trb_processo", p.id, descricao=f"{p.numero_formatado} → caso #{c.numero}")
    ctx.db.commit()
    return processo_detalhe(ctx, p)


# ------------------------------------------------------------------------------------------- painel e alertas
@router.get("/painel")
def painel(ctx: Ctx):
    db, t = ctx.db, ctx.tenant_id
    base = select(func.count()).select_from(Processo).where(Processo.tenant_id == t)
    intim = db.scalar(select(func.count()).select_from(Movimentacao).join(Processo).where(
        Processo.tenant_id == t, Movimentacao.e_intimacao.is_(True), Movimentacao.lida_pelo_usuario.is_(False))) or 0
    por_status = dict(db.execute(select(Protocolo.status, func.count()).where(Protocolo.tenant_id == t).group_by(Protocolo.status)).all())
    por_tribunal = [{"tribunal": s, "processos": n} for s, n in db.execute(
        select(Tribunal.sigla, func.count()).select_from(Processo).join(Tribunal, Tribunal.id == Processo.tribunal_id)
        .where(Processo.tenant_id == t)
        .group_by(Tribunal.sigla)).all()]
    certs = [cert_out(c) for c in db.scalars(select(CertificadoAdvogado).where(CertificadoAdvogado.tenant_id == t,
                                                                              CertificadoAdvogado.removido_em.is_(None)))]
    fila = dict(db.execute(select(Job.status, func.count()).where(Job.tenant_id == t, Job.status.in_(("fila", "rodando", "reprocessar", "erro")))
                           .group_by(Job.status)).all())
    cfg = service.config(db, t)
    db.commit()
    return {
        "modo": cfg.modo,
        "processos": db.scalar(base) or 0, "monitorados": db.scalar(base.where(Processo.monitorar.is_(True))) or 0,
        "sem_caso": db.scalar(base.where(Processo.caso_id.is_(None))) or 0, "intimacoes_nao_lidas": intim,
        "vinculos_sugeridos": db.scalar(select(func.count()).select_from(Vinculo).join(Processo).where(
            Processo.tenant_id == t, Vinculo.status == "sugerido")) or 0,
        "protocolos": por_status, "por_tribunal": sorted(por_tribunal, key=lambda x: -x["processos"]),
        "certificados": certs, "fila": fila, "uso": cobranca.uso(db, t),
        "alertas_nao_lidos": db.scalar(select(func.count()).select_from(Alerta).where(Alerta.tenant_id == t, Alerta.lido.is_(False),
                                                                                       or_(Alerta.usuario_id.is_(None), Alerta.usuario_id == ctx.usuario.id))) or 0,
        "intimacoes_recentes": [
            {**mov_out(m), "processo_id": m.processo_id, "numero_formatado": m.processo.numero_formatado, "tribunal": m.processo.tribunal.sigla}
            for m in db.scalars(select(Movimentacao).join(Processo).where(
                Processo.tenant_id == t, Movimentacao.e_intimacao.is_(True), Movimentacao.lida_pelo_usuario.is_(False))
                .order_by(Movimentacao.data_hora.desc()).limit(20)) if _pode_sigilo(ctx, m.processo)],
    }


@router.get("/alertas")
def alertas(ctx: Ctx, nao_lidos: bool = True, limite: int = Query(100, le=500)):
    sel = select(Alerta).where(Alerta.tenant_id == ctx.tenant_id, or_(Alerta.usuario_id.is_(None), Alerta.usuario_id == ctx.usuario.id))
    if nao_lidos:
        sel = sel.where(Alerta.lido.is_(False))
    return [{"id": a.id, "tipo": a.tipo, "severidade": a.severidade, "mensagem": a.mensagem, "processo_id": a.processo_id,
             "protocolo_id": a.protocolo_id, "lido": a.lido, "criado_em": _dt(a.criado_em)}
            for a in ctx.db.scalars(sel.order_by(Alerta.id.desc()).limit(limite))]


@router.post("/alertas/lidos")
def alertas_lidos(dados: LidasIn, ctx: Ctx):
    sel = select(Alerta).where(Alerta.tenant_id == ctx.tenant_id, Alerta.lido.is_(False),
                               or_(Alerta.usuario_id.is_(None), Alerta.usuario_id == ctx.usuario.id))
    if not dados.todas:
        sel = sel.where(Alerta.id.in_(dados.ids or [0]))
    n = 0
    for a in ctx.db.scalars(sel):
        a.lido = True
        n += 1
    ctx.db.commit()
    return {"marcados": n}


@router.get("/jobs")
def fila(ctx: Ctx, status: str | None = None, limite: int = Query(100, le=500)):
    sel = select(Job).where(Job.tenant_id == ctx.tenant_id)
    if status:
        sel = sel.where(Job.status == status)
    return [{"id": j.id, "tipo": j.tipo, "referencia_id": j.referencia_id, "prioridade": j.prioridade, "status": j.status,
             "tentativas": j.tentativas, "max_tentativas": j.max_tentativas, "proxima_tentativa_em": _dt(j.proxima_tentativa_em),
             "erro": j.erro, "criado_em": _dt(j.criado_em), "concluido_em": _dt(j.concluido_em)}
            for j in ctx.db.scalars(sel.order_by(Job.id.desc()).limit(limite))]


@router.post("/jobs/{jid}/reprocessar")
def reprocessar(jid: int, ctx: Ctx):
    j = ctx.db.get(Job, jid)
    if not j or j.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Tarefa da fila não encontrada.")
    if j.tipo == "protocolar":
        raise HTTPException(400, "Protocolo não se reprocessa pela fila: abra o protocolo e confira o retorno antes de reenviar.")
    if j.status not in ("erro", "cancelado"):
        raise HTTPException(400, "Só tarefas com erro ou canceladas.")
    j.status, j.tentativas, j.proxima_tentativa_em, j.erro = "fila", 0, None, None
    if j.tipo == "importar_processo":
        e = ctx.db.get(Encontrado, j.referencia_id)
        if e and e.status_importacao == "erro":
            e.status_importacao = "fila"
    ctx.db.commit()
    jobs.disparar()
    return {"ok": True}


@router.post("/jobs/{jid}/cancelar")
def cancelar_job(jid: int, ctx: Ctx):
    j = ctx.db.get(Job, jid)
    if not j or j.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Tarefa da fila não encontrada.")
    if j.status not in ("fila", "reprocessar"):
        raise HTTPException(400, "Só tarefas que ainda não começaram.")
    if j.tipo == "protocolar":
        p = ctx.db.get(Protocolo, j.referencia_id)
        if p and p.status == "na_fila":
            p.status = "aprovado"
    j.status = "cancelado"
    ctx.db.commit()
    return {"ok": True}
