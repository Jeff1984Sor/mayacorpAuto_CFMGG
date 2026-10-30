"""Rotas de protocolo: rascunho, documentos, custas, validação, gerar peça (e IA), aprovação, envio e retorno."""

from datetime import datetime
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select

from app.core import ia
from app.core.db import agora
from app.core.deps import Ctx
from app.core.models import Usuario
from app.modules.faturamento.models import Caso, Despesa
from app.modules.tribunais import cnj, jobs, peca
from app.modules.tribunais import protocolo as prot_mod
from app.modules.tribunais import service
from app.modules.tribunais.models import Custa, EmailLog, Processo, Protocolo, ProtocoloDocumento, RetornoProtocolo, Tribunal
from app.modules.tribunais.routes import _dt, _nome, _processo
from app.modules.tribunais.schemas import CustaIn, DocumentoPatch, ProtocoloIn, RedigirIn

router = APIRouter(prefix="/tribunais", tags=["Tribunais · Protocolo"])

TIPOS_DOCUMENTO_SUGERIDOS = ["Petição inicial", "Petição", "Procuração", "Documento de identificação", "Comprovante de endereço",
                             "Declaração de hipossuficiência", "Guia de custas", "Comprovante de pagamento de custas",
                             "Contrato social / atos constitutivos", "Documento comprobatório de prioridade", "Contrato", "Outros documentos"]


def _protocolo(ctx, pid: int) -> Protocolo:
    p = ctx.db.get(Protocolo, pid)
    if not p or p.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Protocolo não encontrado.")
    if p.processo_id:
        _processo(ctx, p.processo_id)  # sigilo
    elif p.nivel_sigilo > 0 and not ctx.pode("trib_processos.ver_sigilosos") and ctx.usuario.id not in (p.advogado_id, p.criado_por_id):
        raise HTTPException(403, "Protocolo sigiloso.")
    return p


def doc_out(d: ProtocoloDocumento) -> dict:
    return {"id": d.id, "ordem": d.ordem, "tipo_documento_codigo": d.tipo_documento_codigo, "tipo_documento_nome": d.tipo_documento_nome,
            "descricao": d.descricao, "nome_arquivo": d.nome_arquivo, "mimetype": d.mimetype, "tamanho_bytes": d.tamanho_bytes,
            "hash_sha256": d.hash_sha256, "paginas": d.paginas, "pesquisavel": d.pesquisavel, "nivel_sigilo": d.nivel_sigilo,
            "assinado": d.assinado, "formato_assinatura": d.formato_assinatura}


def custa_out(c: Custa) -> dict:
    return {"id": c.id, "tipo_custa": c.tipo_custa, "tipo_guia": c.tipo_guia, "codigo_receita": c.codigo_receita, "valor": str(c.valor),
            "base_calculo": str(c.base_calculo) if c.base_calculo is not None else None, "numero_guia": c.numero_guia,
            "linha_digitavel": c.linha_digitavel, "codigo_barras": c.codigo_barras, "vencimento": _dt(c.vencimento),
            "pagador_nome": c.pagador_nome, "pagador_documento": c.pagador_documento, "status": c.status, "pago_em": _dt(c.pago_em),
            "tem_comprovante": bool(c.comprovante_ref), "despesa_id": c.despesa_id}


def retorno_out(ctx, r: RetornoProtocolo) -> dict:
    emails = ctx.db.scalars(select(EmailLog).where(EmailLog.retorno_protocolo_id == r.id).order_by(EmailLog.id))
    return {"id": r.id, "sucesso": r.sucesso, "numero_protocolo": r.numero_protocolo, "data_hora_protocolo": _dt(r.data_hora_protocolo),
            "numero_cnj_gerado": r.numero_cnj_gerado, "numero_cnj_gerado_formatado": cnj.formatar(r.numero_cnj_gerado) if r.numero_cnj_gerado else None,
            "orgao_julgador_distribuido": r.orgao_julgador_distribuido, "tipo_distribuicao": r.tipo_distribuicao,
            "tem_recibo": bool(r.recibo_ref), "hash_documentos_enviados": r.hash_documentos_enviados, "mensagem_erro": r.mensagem_erro,
            "codigo_erro": r.codigo_erro, "tentativa": r.tentativa, "simulado": r.simulado, "manual": r.manual, "recuperado": r.recuperado,
            "criado_em": _dt(r.criado_em),
            "emails": [{"destinatario": e.destinatario, "papel": e.papel_destinatario, "evento": e.evento, "status": e.status,
                        "tentativas": e.tentativas, "erro": e.erro, "enviado_em": _dt(e.enviado_em)} for e in emails]}


def protocolo_out(ctx, p: Protocolo, com_validacao: bool = True) -> dict:
    aprov = prot_mod.aprovacao_valida(p)
    out = {
        "id": p.id, "tipo": p.tipo, "status": p.status, "titulo": p.titulo, "processo_id": p.processo_id, "caso_id": p.caso_id,
        "numero_cnj": p.numero_cnj, "numero_formatado": cnj.formatar(p.numero_cnj) if p.numero_cnj else None,
        "advogado_id": p.advogado_id, "advogado_nome": _nome(ctx, p.advogado_id), "tribunal": p.tribunal.sigla,
        "tribunal_nome": p.tribunal.nome, "grau": p.grau, "sistema": p.sistema_instancia.sistema if p.sistema_instancia else None,
        "sistema_portal": p.sistema_instancia.url_portal if p.sistema_instancia else None,
        "cabecalho": p.cabecalho, "partes": p.partes, "conteudo_peca": p.conteudo_peca, "tipo_peticao_codigo": p.tipo_peticao_codigo,
        "tipo_peticao_nome": p.tipo_peticao_nome, "em_resposta_a_intimacao_id": p.em_resposta_a_intimacao_id,
        "polo_peticionante": p.polo_peticionante, "parte_ids": p.parte_ids, "pedido_urgente": p.pedido_urgente,
        "nivel_sigilo": p.nivel_sigilo, "prazo_final": _dt(p.prazo_final), "fora_do_prazo_justificativa": p.fora_do_prazo_justificativa,
        "criado_por": _nome(ctx, p.criado_por_id), "enviado_por": _nome(ctx, p.enviado_por_id), "tentativas": p.tentativas,
        "simulado": p.simulado, "ultimo_erro": p.ultimo_erro, "criado_em": _dt(p.criado_em), "atualizado_em": _dt(p.atualizado_em),
        "hash_conteudo": prot_mod.hash_conteudo(p),
        "aprovacao": {"id": aprov.id, "advogado": _nome(ctx, aprov.advogado_id), "aprovado_em": _dt(aprov.aprovado_em), "ip": aprov.ip,
                      "hash": aprov.hash_conteudo_aprovado} if aprov else None,
        "aprovacoes_invalidadas": sum(1 for a in p.aprovacoes if a.invalidada_em),
        "pode_aprovar": ctx.usuario.id == p.advogado_id and p.status in ("rascunho", "erro", "aprovado"),
        "documentos": [doc_out(d) for d in p.documentos], "custas": [custa_out(c) for c in p.custas],
        "retornos": [retorno_out(ctx, r) for r in p.retornos],
    }
    if com_validacao and p.status in prot_mod.EDITAVEIS:
        out["validacao"] = prot_mod.validar(ctx.db, p)
    return out


def _aplicar(ctx, p: Protocolo, dados: ProtocoloIn) -> None:
    adv = ctx.db.get(Usuario, dados.advogado_id)
    if not adv or adv.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Advogado não encontrado.")
    if dados.tipo == "inicial":
        if dados.processo_id:
            raise HTTPException(400, "Petição inicial não tem processo: ele nasce na distribuição.")
        t = cnj.tribunal_por_sigla(dados.tribunal_sigla)
        trib = ctx.db.scalar(select(Tribunal).where(Tribunal.sigla == t["sigla"])) if t else None
        if not trib:
            raise HTTPException(400, "Escolha o tribunal da petição inicial.")
        p.tribunal_id, p.processo_id, p.numero_cnj = trib.id, None, None
    else:
        if not dados.processo_id:
            raise HTTPException(400, "Escolha o processo.")
        proc = _processo(ctx, dados.processo_id)
        p.tribunal_id, p.processo_id, p.numero_cnj = proc.tribunal_id, proc.id, proc.numero_cnj
        p.caso_id = dados.caso_id or proc.caso_id
        ids = {pa.id for pa in proc.partes}
        if any(i not in ids for i in dados.parte_ids):
            raise HTTPException(400, "Parte que não é deste processo.")
    if dados.caso_id:
        c = ctx.db.get(Caso, dados.caso_id)
        if not c or c.tenant_id != ctx.tenant_id:
            raise HTTPException(404, "Caso não encontrado.")
        p.caso_id = c.id
    d = dados.model_dump(mode="json", exclude={"tribunal_sigla", "processo_id", "caso_id", "partes", "cabecalho", "conteudo_peca",
                                               "prazo_final"})
    for k, v in d.items():
        setattr(p, k, v)
    p.prazo_final = dados.prazo_final
    if dados.em_resposta_a_intimacao_id:  # vincular à intimação: o prazo dela vale se não vier outro
        from app.modules.tribunais.models import Movimentacao

        m = ctx.db.get(Movimentacao, dados.em_resposta_a_intimacao_id)
        if not m or m.processo_id != p.processo_id:
            raise HTTPException(400, "A intimação não é deste processo.")
        p.prazo_final = dados.prazo_final or m.prazo_final
    p.cabecalho = dados.cabecalho.model_dump(mode="json") if dados.tipo == "inicial" else {}
    p.partes = [x.model_dump(mode="json") for x in dados.partes] if dados.tipo == "inicial" else []
    p.conteudo_peca = dados.conteudo_peca.model_dump(mode="json")


@router.get("/protocolos")
def protocolos(ctx: Ctx, status: str | None = None, tipo: str | None = None, processo_id: int | None = None, caso_id: int | None = None,
               advogado_id: int | None = None, limite: int = Query(200, le=500)):
    sel = select(Protocolo).where(Protocolo.tenant_id == ctx.tenant_id)
    for campo, valor in (("status", status), ("tipo", tipo), ("processo_id", processo_id), ("caso_id", caso_id), ("advogado_id", advogado_id)):
        if valor is not None:
            sel = sel.where(getattr(Protocolo, campo) == valor)
    out = []
    for p in ctx.db.scalars(sel.order_by(Protocolo.id.desc()).limit(limite)):
        if p.nivel_sigilo > 0 and not ctx.pode("trib_processos.ver_sigilosos") and ctx.usuario.id not in (p.advogado_id, p.criado_por_id):
            continue
        ult = p.retornos[-1] if p.retornos else None
        out.append({"id": p.id, "tipo": p.tipo, "status": p.status, "titulo": p.titulo or p.tipo_peticao_nome, "tribunal": p.tribunal.sigla,
                    "numero_formatado": cnj.formatar(p.numero_cnj) if p.numero_cnj else None, "advogado_nome": _nome(ctx, p.advogado_id),
                    "prazo_final": _dt(p.prazo_final), "criado_em": _dt(p.criado_em), "simulado": p.simulado,
                    "numero_protocolo": ult.numero_protocolo if ult and ult.sucesso else None,
                    "data_hora_protocolo": _dt(ult.data_hora_protocolo) if ult and ult.sucesso else None,
                    "documentos": len(p.documentos), "aprovado": bool(prot_mod.aprovacao_valida(p)), "ultimo_erro": p.ultimo_erro})
    return out


@router.get("/protocolos/tipos-documento")
def tipos_documento(ctx: Ctx):
    return TIPOS_DOCUMENTO_SUGERIDOS


@router.post("/protocolos", status_code=201)
def criar_protocolo(dados: ProtocoloIn, ctx: Ctx):
    p = Protocolo(tenant_id=ctx.tenant_id, tipo=dados.tipo, advogado_id=dados.advogado_id, tribunal_id=0, criado_por_id=ctx.usuario.id,
                  cabecalho={}, partes=[], conteudo_peca={}, parte_ids=[])
    _aplicar(ctx, p, dados)
    ctx.db.add(p)
    ctx.db.flush()
    ctx.auditar("tribunais.protocolo.criar", "trb_protocolo", p.id, descricao=f"{p.tipo} · {p.titulo or ''}")
    ctx.db.commit()
    ctx.db.refresh(p)
    return protocolo_out(ctx, p)


@router.get("/protocolos/{pid}")
def ler_protocolo(pid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    out = protocolo_out(ctx, p)
    ctx.db.commit()  # a validação grava o sistema/certificado escolhidos
    return out


@router.put("/protocolos/{pid}")
def alterar_protocolo(pid: int, dados: ProtocoloIn, ctx: Ctx):
    p = _protocolo(ctx, pid)
    if p.status not in prot_mod.EDITAVEIS:
        raise HTTPException(400, "Este protocolo está na fila ou já foi enviado: não dá para alterar.")
    if dados.tipo != p.tipo and (p.tipo == "inicial") != (dados.tipo == "inicial"):
        raise HTTPException(400, "Não dá para trocar entre inicial e intermediária: crie outro protocolo.")
    _aplicar(ctx, p, dados)
    ctx.db.flush()
    prot_mod.depois_de_editar(ctx.db, p)
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.delete("/protocolos/{pid}")
def excluir_protocolo(pid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    if p.retornos or p.status not in ("rascunho", "aprovado"):
        raise HTTPException(400, "Protocolo com envio ao tribunal não pode ser excluído (é a prova do que foi feito).")
    ctx.auditar("tribunais.protocolo.excluir", "trb_protocolo", p.id, descricao=p.titulo)
    ctx.db.delete(p)
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------------------------- documentos
@router.post("/protocolos/{pid}/documentos", status_code=201)
async def enviar_documento(pid: int, ctx: Ctx, arquivo: UploadFile = File(...), tipo_documento_nome: str = Form(...),
                           descricao: str | None = Form(None), tipo_documento_codigo: str | None = Form(None), ordem: int | None = Form(None),
                           nivel_sigilo: int = Form(0)):
    p = _protocolo(ctx, pid)
    dados = await arquivo.read()
    if len(dados) > 200 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 200 MB.")
    try:
        prot_mod.adicionar_documento(ctx.db, p, arquivo.filename or "documento.pdf", dados, arquivo.content_type or "application/pdf",
                                     tipo_nome=tipo_documento_nome[:150], descricao=(descricao or tipo_documento_nome)[:300],
                                     tipo_codigo=tipo_documento_codigo or None, ordem=ordem, nivel_sigilo=max(0, min(5, nivel_sigilo)))
    except prot_mod.ErroProtocolo as e:
        raise HTTPException(400, str(e)) from e
    ctx.db.commit()
    return protocolo_out(ctx, p)


def _documento(p: Protocolo, did: int) -> ProtocoloDocumento:
    d = next((x for x in p.documentos if x.id == did), None)
    if not d:
        raise HTTPException(404, "Documento não encontrado.")
    return d


@router.patch("/protocolos/{pid}/documentos/{did}")
def alterar_documento(pid: int, did: int, dados: DocumentoPatch, ctx: Ctx):
    p = _protocolo(ctx, pid)
    d = _documento(p, did)
    for k, v in dados.model_dump(exclude_unset=True).items():
        setattr(d, k, v)
    try:
        prot_mod.depois_de_editar(ctx.db, p)
    except prot_mod.ErroProtocolo as e:
        raise HTTPException(400, str(e)) from e
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.delete("/protocolos/{pid}/documentos/{did}")
def excluir_documento(pid: int, did: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    d = _documento(p, did)
    if p.status not in prot_mod.EDITAVEIS:
        raise HTTPException(400, "Este protocolo não aceita mais alterações.")
    p.documentos.remove(d)
    ctx.db.flush()
    for i, x in enumerate(sorted(p.documentos, key=lambda x: x.ordem), start=1):
        x.ordem = i
    prot_mod.depois_de_editar(ctx.db, p)
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.get("/protocolos/{pid}/documentos/{did}/arquivo")
def baixar_documento(pid: int, did: int, ctx: Ctx, assinado: bool = False):
    p = _protocolo(ctx, pid)
    d = _documento(p, did)
    caminho = d.arquivo_assinado_ref if assinado and d.arquivo_assinado_ref else d.arquivo_ref
    if not Path(caminho).exists():
        raise HTTPException(404, "Arquivo não encontrado no armazenamento.")
    return FileResponse(caminho, media_type=d.mimetype, filename=d.nome_arquivo)


# ---------------------------------------------------------------------------------------------- peça e IA
@router.post("/protocolos/{pid}/gerar-peca")
def gerar_peca(pid: int, ctx: Ctx, substituir: bool = True):
    """Gera o PDF da petição a partir dos campos (10.4) e põe como documento principal (ordem 1)."""
    p = _protocolo(ctx, pid)
    adv = ctx.db.get(Usuario, p.advogado_id)
    oabs = service.oabs_do_advogado(ctx.db, adv)
    if not oabs:
        raise HTTPException(400, "O advogado não tem OAB cadastrada.")
    principal = next((o for o in oabs if o["tipo"] == "principal"), oabs[0])
    pdf = peca.gerar_pdf(p, adv, f"{principal['uf']} {principal['numero']}")
    if substituir:
        for d in [x for x in p.documentos if x.ordem == 1]:
            p.documentos.remove(d)
        ctx.db.flush()
    for d in p.documentos:
        if d.ordem >= 1:
            d.ordem += 1
    nome = "peticao-inicial.pdf" if p.tipo == "inicial" else "peticao.pdf"
    try:
        prot_mod.adicionar_documento(ctx.db, p, nome, pdf, "application/pdf", ordem=1,
                                     tipo_nome="Petição inicial" if p.tipo == "inicial" else (p.tipo_peticao_nome or "Petição"),
                                     descricao=p.titulo or ("Petição inicial" if p.tipo == "inicial" else (p.tipo_peticao_nome or "Petição")),
                                     nivel_sigilo=p.nivel_sigilo)
    except prot_mod.ErroProtocolo as e:
        raise HTTPException(400, str(e)) from e
    for i, x in enumerate(sorted(p.documentos, key=lambda x: x.ordem), start=1):
        x.ordem = i
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.get("/protocolos/{pid}/previa")
def previa_peca(pid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    adv = ctx.db.get(Usuario, p.advogado_id)
    oabs = service.oabs_do_advogado(ctx.db, adv)
    oab = f"{oabs[0]['uf']} {oabs[0]['numero']}" if oabs else ""
    return Response(peca.gerar_pdf(p, adv, oab), media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="previa.pdf"'})


@router.post("/protocolos/{pid}/ia-redigir")
def ia_redigir(pid: int, dados: RedigirIn, ctx: Ctx):
    """A IA sugere fatos, fundamentos e pedidos a partir do relato. Não grava: o advogado revisa e salva."""
    p = _protocolo(ctx, pid)
    try:
        r = ia.gerar_json(ia.provedor_ativo(ctx.db, ctx.tenant_id), peca.SISTEMA_IA, peca.prompt_redigir(p, dados.briefing))
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    ctx.auditar("tribunais.protocolo.ia", "trb_protocolo", p.id, descricao="Rascunho da peça por IA")
    ctx.db.commit()
    return {k: r.get(k) for k in ("enderecamento", "fatos", "fundamentos_juridicos", "pedidos", "pedido_tutela", "provas")}


# ---------------------------------------------------------------------------------------------- custas
def _custa(p: Protocolo, cid: int) -> Custa:
    c = next((x for x in p.custas if x.id == cid), None)
    if not c:
        raise HTTPException(404, "Custa não encontrada.")
    return c


def _lancar_despesa(ctx, p: Protocolo, c: Custa) -> None:
    """Reembolso: a custa paga vira despesa do caso (sai na Nota de Despesas, nunca na NFS-e)."""
    from app.modules.faturamento.models import TipoDespesa

    if c.despesa_id or not p.caso_id or c.status != "paga":
        return
    d = Despesa(tenant_id=ctx.tenant_id, caso_id=p.caso_id, data=(c.pago_em or agora()).date(), tipo=TipoDespesa.custas,
                descricao=f"{c.tipo_guia} {c.numero_guia} — {c.tipo_custa.replace('_', ' ')}"[:300], valor=Decimal(c.valor),
                reembolsavel=True, comprovante_path=c.comprovante_ref, lancado_por_id=ctx.usuario.id)
    ctx.db.add(d)
    ctx.db.flush()
    c.despesa_id = d.id


@router.post("/protocolos/{pid}/custas", status_code=201)
def criar_custa(pid: int, dados: CustaIn, ctx: Ctx):
    p = _protocolo(ctx, pid)
    c = Custa(protocolo_id=p.id, tribunal_id=p.tribunal_id, **dados.model_dump(exclude={"reembolsar_cliente"}))
    p.custas.append(c)
    ctx.db.flush()
    if dados.reembolsar_cliente:
        _lancar_despesa(ctx, p, c)
    ctx.auditar("tribunais.custa.criar", "trb_protocolo", p.id, descricao=f"{c.tipo_guia} {c.numero_guia} R$ {c.valor}")
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.put("/protocolos/{pid}/custas/{cid}")
def alterar_custa(pid: int, cid: int, dados: CustaIn, ctx: Ctx):
    p = _protocolo(ctx, pid)
    c = _custa(p, cid)
    for k, v in dados.model_dump(exclude={"reembolsar_cliente"}).items():
        setattr(c, k, v)
    if c.status == "paga" and not c.pago_em:
        c.pago_em = agora()
    if dados.reembolsar_cliente:
        _lancar_despesa(ctx, p, c)
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.delete("/protocolos/{pid}/custas/{cid}")
def excluir_custa(pid: int, cid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    c = _custa(p, cid)
    if p.status not in prot_mod.EDITAVEIS:
        raise HTTPException(400, "Protocolo já enviado.")
    p.custas.remove(c)
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.post("/protocolos/{pid}/custas/{cid}/comprovante")
async def comprovante_custa(pid: int, cid: int, ctx: Ctx, arquivo: UploadFile = File(...), pago_em: datetime | None = Form(None)):
    p = _protocolo(ctx, pid)
    c = _custa(p, cid)
    dados = await arquivo.read()
    if not dados:
        raise HTTPException(400, "Arquivo vazio.")
    c.comprovante_ref = service.guardar(ctx.tenant_id, f"protocolos/{p.id}/custas", f"{c.id}-{arquivo.filename or 'comprovante.pdf'}", dados)
    c.status, c.pago_em = "paga", pago_em or c.pago_em or agora()
    ctx.auditar("tribunais.custa.comprovante", "trb_protocolo", p.id, descricao=f"{c.tipo_guia} {c.numero_guia} paga")
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.get("/protocolos/{pid}/custas/{cid}/comprovante")
def ver_comprovante(pid: int, cid: int, ctx: Ctx):
    c = _custa(_protocolo(ctx, pid), cid)
    if not c.comprovante_ref or not Path(c.comprovante_ref).exists():
        raise HTTPException(404, "Sem comprovante.")
    return FileResponse(c.comprovante_ref, filename=Path(c.comprovante_ref).name)


# ---------------------------------------------------------------------------------------- validar / aprovar / enviar
@router.post("/protocolos/{pid}/validar")
def validar(pid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    msgs = prot_mod.validar(ctx.db, p)
    ctx.db.commit()
    return {"validacao": msgs, "pode_aprovar": not any(m["nivel"] == "erro" for m in msgs)}


@router.post("/protocolos/{pid}/aprovar")
def aprovar(pid: int, request: Request, ctx: Ctx):
    p = _protocolo(ctx, pid)
    try:
        a = prot_mod.aprovar(ctx.db, p, ctx.usuario, ctx.ip, request.headers.get("user-agent"))
    except prot_mod.ErroProtocolo as e:
        raise HTTPException(400, str(e)) from e
    ctx.auditar("tribunais.protocolo.aprovar", "trb_protocolo", p.id, descricao=f"hash {a.hash_conteudo_aprovado[:16]}…")
    ctx.db.commit()
    return protocolo_out(ctx, p)


@router.post("/protocolos/{pid}/enviar")
def enviar(pid: int, ctx: Ctx):
    p = _protocolo(ctx, pid)
    try:
        prot_mod.enviar(ctx.db, p, ctx.usuario)
    except prot_mod.ErroProtocolo as e:
        ctx.db.commit()
        raise HTTPException(400, str(e)) from e
    ctx.auditar("tribunais.protocolo.enviar", "trb_protocolo", p.id, descricao=f"{p.tribunal.sigla} · {p.titulo or p.tipo}")
    ctx.db.commit()
    jobs.disparar()
    ctx.db.refresh(p)
    return protocolo_out(ctx, p)


@router.post("/protocolos/{pid}/registrar-retorno")
async def registrar_retorno(pid: int, ctx: Ctx, entrou: bool = Form(...), numero_protocolo: str | None = Form(None),
                            data_hora: datetime | None = Form(None), numero_cnj_gerado: str | None = Form(None),
                            recibo: UploadFile | None = File(None)):
    """Protocolo feito no portal do tribunal (ou conferência depois de falha de rede): registra o recibo à mão."""
    p = _protocolo(ctx, pid)
    dados = await recibo.read() if recibo else None
    try:
        r = prot_mod.resolver_manual(ctx.db, p, entrou, ctx.usuario, numero_protocolo=numero_protocolo, data_hora=data_hora,
                                     recibo=dados or None, numero_cnj_gerado=numero_cnj_gerado)
    except prot_mod.ErroProtocolo as e:
        raise HTTPException(400, str(e)) from e
    ctx.auditar("tribunais.protocolo.retorno_manual", "trb_protocolo", p.id,
                descricao=f"{'entrou' if entrou else 'não entrou'} · {numero_protocolo or ''}")
    ctx.db.commit()
    jobs.disparar()
    return protocolo_out(ctx, ctx.db.get(Protocolo, p.id)) if r else protocolo_out(ctx, p)


@router.get("/retornos/{rid}/recibo")
def recibo(rid: int, ctx: Ctx):
    r = ctx.db.get(RetornoProtocolo, rid)
    if not r:
        raise HTTPException(404, "Recibo não encontrado.")
    _protocolo(ctx, r.protocolo_id)
    if not r.recibo_ref or not Path(r.recibo_ref).exists():
        raise HTTPException(404, "Este retorno não tem recibo.")
    return FileResponse(r.recibo_ref, media_type="application/pdf", filename=f"recibo-{r.numero_protocolo or r.id}.pdf")


@router.get("/processos/{pid}/intimacoes-abertas")
def intimacoes_abertas(pid: int, ctx: Ctx):
    """Para "em resposta à intimação" no formulário da intermediária."""
    from app.modules.tribunais.models import Movimentacao

    p = _processo(ctx, pid)
    return [{"id": m.id, "data_hora": _dt(m.data_hora), "descricao": m.descricao[:300], "prazo_final": _dt(m.prazo_final)}
            for m in ctx.db.scalars(select(Movimentacao).where(Movimentacao.processo_id == p.id, Movimentacao.e_intimacao.is_(True))
                                    .order_by(Movimentacao.data_hora.desc()).limit(30))]


@router.get("/casos/{cid}/processo")
def processo_do_caso(cid: int, ctx: Ctx):
    """Ficha do caso: processo ligado (para a aba Tribunal)."""
    p = ctx.db.scalar(select(Processo).where(Processo.tenant_id == ctx.tenant_id, Processo.caso_id == cid))
    if not p:
        return None
    from app.modules.tribunais.routes import processo_resumo

    return processo_resumo(ctx, _processo(ctx, p.id))
