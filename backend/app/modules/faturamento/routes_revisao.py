"""Revisão de faturas (pré-fatura "Em Revisão") e Fluxo de Faturamento."""

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.core.deps import Ctx, Operador
from app.core.models import Usuario
from app.core.schemas import Mensagem
from app.modules.faturamento import service
from app.modules.faturamento.models import Caso, Revisao, RevisaoItem, StatusRevisao
from app.modules.faturamento.schemas import (
    DescartarIn,
    EnviarRevisaoIn,
    IncluirIn,
    ItemPendenteOut,
    RevisaoHorasIn,
    RevisaoItemOut,
    RevisaoItemPatch,
    RevisaoLancamentoIn,
    RevisaoOut,
    RevisaoPatch,
    RevisaoResumoOut,
)
from app.modules.rpa_nfse.models import Fatura, StatusFatura, TipoFatura

router = APIRouter(prefix="/faturamento", tags=["Faturamento · Revisão"])


def _rev(ctx, rid: int) -> Revisao:
    r = ctx.db.get(Revisao, rid)
    if not r or r.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Revisão não encontrada.")
    return r


def _aberta(r: Revisao) -> Revisao:
    if r.status != StatusRevisao.em_revisao:
        raise HTTPException(400, "Esta revisão já foi concluída.")
    return r


def _item(ctx, rid: int, iid: int) -> tuple[Revisao, RevisaoItem]:
    r = _aberta(_rev(ctx, rid))
    item = ctx.db.get(RevisaoItem, iid)
    if not item or item.revisao_id != r.id:
        raise HTTPException(404, "Item não encontrado.")
    return r, item


def _falha(ctx, e: service.RegraFaturamento):
    ctx.db.rollback()
    raise HTTPException(400, str(e)) from e


def _resumo(ctx, r: Revisao) -> dict:
    ativos = [i for i in r.itens if not i.excluido]
    resp = ctx.db.get(Usuario, r.responsavel_id) if r.responsavel_id else None
    fat = ctx.db.get(Fatura, r.fatura_id) if r.fatura_id else None
    return dict(
        id=r.id, numero=r.numero, aba=r.aba, status=r.status.value, contrato_id=r.contrato_id,
        contrato_numero=r.contrato.numero, contrato_nome=r.contrato.nome, tomador_id=r.tomador_id,
        tomador_nome=r.contrato.tomador.nome if r.contrato.tomador else "", de=r.de, ate=r.ate,
        responsavel_nome=resp.nome if resp else None, criado_em=r.criado_em.isoformat(), qtd_itens=len(ativos),
        total=sum((i.valor for i in ativos), Decimal(0)), total_original=sum((i.valor_original for i in r.itens if not i.manual), Decimal(0)),
        fatura_id=r.fatura_id, fatura_codigo=fat.codigo if fat else None,
        nota_ia=(r.ia_analise or {}).get("nota") if r.ia_analise else None)


def _out(ctx, r: Revisao) -> RevisaoOut:
    itens = []
    for i in r.itens:
        o = RevisaoItemOut.model_validate(i, from_attributes=True)
        if i.caso:
            o.caso_numero, o.caso_titulo = i.caso.numero, i.caso.titulo
        itens.append(o)
    casos = [{"id": c.id, "numero": c.numero, "titulo": c.titulo}
             for c in ctx.db.scalars(select(Caso).where(Caso.contrato_id == r.contrato_id).order_by(Caso.numero))]
    return RevisaoOut(**_resumo(ctx, r), observacao=r.observacao, nota_interna=r.nota_interna, responsavel_id=r.responsavel_id,
                      ia_analise=r.ia_analise, eventos=list(reversed(r.eventos or [])), itens=itens, casos=casos,
                      total_horas=sum((i.quantidade or 0 for i in r.itens if i.tipo == "hora" and not i.excluido), Decimal(0)))


def _cfg(ctx):
    from app.modules.rpa_nfse.service import config_nfse

    cfg = config_nfse(ctx.db, ctx.tenant_id)
    return {"dias_vencimento": cfg.fatura_dias_vencimento if cfg.fatura_dias_vencimento is not None else 10,
            "vencimento_na_emissao": cfg.fatura_vencimento_modo == "emissao"}


@router.post("/revisoes", response_model=list[RevisaoResumoOut], status_code=201)
def enviar_para_revisao(dados: EnviarRevisaoIn, ctx: Operador):
    try:
        revs = service.enviar_revisao(ctx.db, ctx.tenant_id, ctx.usuario, aba=dados.aba, de=dados.de, ate=dados.ate,
                                      chaves=dados.chaves, cliente_ids=dados.cliente_ids,
                                      tipos=set(dados.tipos) if dados.tipos else None)
    except service.RegraFaturamento as e:
        _falha(ctx, e)
    for r in revs:
        ctx.auditar("faturamento.revisao.criar", "fat_revisao", r.id, descricao=f"Revisão #{r.numero} ({len(r.itens)} itens)")
    ctx.db.commit()
    return [_resumo(ctx, r) for r in revs]


@router.get("/revisoes", response_model=list[RevisaoResumoOut])
def revisoes(ctx: Ctx, status: str | None = Query("em_revisao", pattern="^(em_revisao|faturada|descartada|todas)$"),
             tomador_id: int | None = None):
    q = select(Revisao).where(Revisao.tenant_id == ctx.tenant_id)
    if status and status != "todas":
        q = q.where(Revisao.status == StatusRevisao(status))
    if tomador_id:
        q = q.where(Revisao.tomador_id == tomador_id)
    return [_resumo(ctx, r) for r in ctx.db.scalars(q.order_by(Revisao.numero.desc()).limit(300))]


@router.get("/revisoes/{rid}", response_model=RevisaoOut)
def ler(rid: int, ctx: Ctx):
    return _out(ctx, _rev(ctx, rid))


@router.patch("/revisoes/{rid}", response_model=RevisaoOut)
def alterar(rid: int, dados: RevisaoPatch, ctx: Operador):
    r = _aberta(_rev(ctx, rid))
    for k, v in dados.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    ctx.db.commit()
    return _out(ctx, r)


@router.get("/revisoes/{rid}/disponiveis", response_model=list[ItemPendenteOut])
def disponiveis(rid: int, ctx: Ctx):
    """Pendências do contrato (de qualquer data) que ainda podem entrar nesta revisão."""
    r = _aberta(_rev(ctx, rid))
    casos = {c.id: c for c in ctx.db.scalars(select(Caso).where(Caso.contrato_id == r.contrato_id))}
    return [ItemPendenteOut(chave=p.chave, tipo=p.tipo, caso_id=p.caso_id,
                            caso_numero=casos[p.caso_id].numero if p.caso_id in casos else None,
                            caso_titulo=casos[p.caso_id].titulo if p.caso_id in casos else None, data=p.data,
                            descricao=p.descricao, valor=p.valor, parcela=p.parcela, quantidade=p.quantidade,
                            valor_unitario=p.valor_unitario, profissional=p.profissional, aviso=p.aviso)
            for p in service.disponiveis_para_revisao(ctx.db, r)]


@router.post("/revisoes/{rid}/incluir", response_model=RevisaoOut)
def incluir(rid: int, dados: IncluirIn, ctx: Operador):
    r = _aberta(_rev(ctx, rid))
    n = service.incluir_na_revisao(ctx.db, r, dados.chaves)
    r.evento(f"{n} item(ns) incluído(s).", ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.post("/revisoes/{rid}/horas", response_model=RevisaoOut, status_code=201)
def adicionar_horas(rid: int, dados: RevisaoHorasIn, ctx: Operador):
    r = _aberta(_rev(ctx, rid))
    from app.modules.faturamento.routes import profissional_de

    u = ctx.db.get(Usuario, profissional_de(ctx, dados.profissional_id))
    try:
        item = service.adicionar_horas(ctx.db, r, caso_id=dados.caso_id, profissional_id=u.id, data=dados.data,
                                       minutos=dados.minutos, descricao=dados.descricao, valor_hora=dados.valor_hora)
    except service.RegraFaturamento as e:
        _falha(ctx, e)
    r.evento(f"Horas incluídas: {item.quantidade} h de {u.nome} — {dados.descricao[:60]}", ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.post("/revisoes/{rid}/lancamentos", response_model=RevisaoOut, status_code=201)
def adicionar_lancamento(rid: int, dados: RevisaoLancamentoIn, ctx: Operador):
    r = _aberta(_rev(ctx, rid))
    try:
        service.adicionar_lancamento(ctx.db, r, ctx.usuario, data=dados.data, descricao=dados.descricao, valor=dados.valor,
                                     caso_id=dados.caso_id, tipo_despesa=dados.tipo_despesa)
    except service.RegraFaturamento as e:
        _falha(ctx, e)
    r.evento(f"Lançamento incluído: {dados.descricao[:60]} ({dados.valor})", ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.patch("/revisoes/{rid}/itens/{iid}", response_model=RevisaoOut)
def alterar_item(rid: int, iid: int, dados: RevisaoItemPatch, ctx: Operador):
    r, item = _item(ctx, rid, iid)
    antes = f"{item.descricao[:40]} ({item.valor})"
    service.alterar_item(ctx.db, item, **dados.model_dump(exclude_unset=True))
    acao = ("excluído" if item.excluido else "restaurado") if dados.excluido is not None else "editado"
    r.evento(f"Item {acao}: {antes}" + (f" → {item.valor}" if dados.valor is not None or dados.quantidade else ""), ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.delete("/revisoes/{rid}/itens/{iid}", response_model=RevisaoOut)
def remover_item(rid: int, iid: int, ctx: Operador, apagar_lancamento: bool = False):
    r, item = _item(ctx, rid, iid)
    texto = f"{item.descricao[:60]} ({item.valor})"
    service.remover_item(ctx.db, item, apagar_lancamento)
    r.evento(("Lançamento apagado do caso: " if apagar_lancamento and item.tipo in ("hora", "despesa") else "Item retirado: ")
             + texto, ctx.usuario.nome)
    ctx.db.commit()
    ctx.db.refresh(r)
    return _out(ctx, r)


@router.post("/revisoes/{rid}/ia", response_model=RevisaoOut)
def analisar_ia(rid: int, ctx: Operador):
    from app.core.ia import IAIndisponivel

    r = _aberta(_rev(ctx, rid))
    try:
        service.analisar_com_ia(ctx.db, r)
    except IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    r.evento("Análise da IA concluída.", ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.post("/revisoes/{rid}/ia/aplicar", response_model=RevisaoOut)
def aplicar_sugestoes(rid: int, body: dict, ctx: Operador):
    """Aplica as sugestões de texto da IA escolhidas ({"item_ids": [...]}, vazio = todas)."""
    r = _aberta(_rev(ctx, rid))
    escolhidos = set(body.get("item_ids") or [])
    sugestoes = (r.ia_analise or {}).get("sugestoes") or []
    por_id = {i.id: i for i in r.itens}
    n = 0
    for s in sugestoes:
        if (not escolhidos or s["item_id"] in escolhidos) and s["item_id"] in por_id:
            service.alterar_item(ctx.db, por_id[s["item_id"]], descricao=s["descricao"])
            n += 1
    r.ia_analise = {**r.ia_analise, "sugestoes": [s for s in sugestoes if escolhidos and s["item_id"] not in escolhidos]}
    r.evento(f"{n} sugestão(ões) da IA aplicada(s).", ctx.usuario.nome)
    ctx.db.commit()
    return _out(ctx, r)


@router.post("/revisoes/{rid}/aprovar", response_model=RevisaoOut)
def aprovar(rid: int, ctx: Operador):
    r = _rev(ctx, rid)
    try:
        fat = service.aprovar(ctx.db, r, ctx.usuario, **_cfg(ctx))
    except service.RegraFaturamento as e:
        _falha(ctx, e)
    ctx.auditar("faturamento.revisao.aprovar", "fat_revisao", r.id, descricao=f"Revisão #{r.numero} → {fat.codigo}")
    ctx.db.commit()
    return _out(ctx, r)


@router.post("/revisoes/{rid}/descartar", response_model=Mensagem)
def descartar(rid: int, dados: DescartarIn, ctx: Operador):
    r = _rev(ctx, rid)
    try:
        service.descartar(r, ctx.usuario, dados.motivo)
    except service.RegraFaturamento as e:
        _falha(ctx, e)
    ctx.auditar("faturamento.revisao.descartar", "fat_revisao", r.id, descricao=f"Revisão #{r.numero}")
    ctx.db.commit()
    return Mensagem(mensagem="Revisão descartada. Os itens voltaram para Itens a faturar.")


# ================================================================ fluxo de faturamento
@router.get("/fluxo")
def fluxo(ctx: Ctx, de: date | None = None, ate: date | None = None, tomador_id: int | None = None):
    """Quadro do ciclo: Em revisão → Aguardando NFS-e → A receber → Vencidas → Pagas."""
    hoje = date.today()
    de = de or hoje - timedelta(days=90)
    ate = ate or hoje
    colunas: dict[str, list] = {k: [] for k in ("em_revisao", "aguardando_nfse", "a_receber", "vencidas", "pagas")}

    q = select(Revisao).where(Revisao.tenant_id == ctx.tenant_id, Revisao.status == StatusRevisao.em_revisao)
    if tomador_id:
        q = q.where(Revisao.tomador_id == tomador_id)
    for r in ctx.db.scalars(q.order_by(Revisao.criado_em)):
        res = _resumo(ctx, r)
        colunas["em_revisao"].append({
            "tipo": "revisao", "id": r.id, "titulo": f"Revisão #{r.numero}", "cliente": res["tomador_nome"],
            "contrato": f"#{res['contrato_numero']} {res['contrato_nome']}", "valor": res["total"], "data": r.criado_em.date(),
            "documento": "ND" if r.aba == "despesas" else "NH", "responsavel": res["responsavel_nome"],
            "dias": (hoje - r.criado_em.date()).days, "nota_ia": res["nota_ia"]})

    q = select(Fatura).where(Fatura.tenant_id == ctx.tenant_id, Fatura.status != StatusFatura.cancelada,
                             Fatura.data_emissao >= de, Fatura.data_emissao <= ate)
    if tomador_id:
        q = q.where(Fatura.tomador_id == tomador_id)
    for f in ctx.db.scalars(q.order_by(Fatura.data_vencimento)):
        card = {"tipo": "fatura", "id": f.id, "titulo": f.codigo, "cliente": f.tomador.nome if f.tomador else "",
                "contrato": None, "valor": f.total, "data": f.data_emissao, "vencimento": f.data_vencimento,
                "documento": "ND" if f.tipo == TipoFatura.despesas else "NH", "nfse_numero": f.nfse.numero if f.nfse else None,
                "origem": f.origem, "pago_em": f.pago_em}
        if f.contrato_id:
            from app.modules.faturamento.models import Contrato

            c = ctx.db.get(Contrato, f.contrato_id)
            card["contrato"] = f"#{c.numero} {c.nome}" if c else None
        if f.status == StatusFatura.paga:
            colunas["pagas"].append(card)
        elif f.tipo == TipoFatura.honorarios and not f.nfse_id:
            colunas["aguardando_nfse"].append(card)
        elif f.data_vencimento < hoje:
            card["dias"] = (hoje - f.data_vencimento).days
            colunas["vencidas"].append(card)
        else:
            colunas["a_receber"].append(card)
    return {"de": de, "ate": ate, "colunas": {k: {"qtd": len(v), "total": sum((c["valor"] for c in v), Decimal(0)), "cards": v}
                                              for k, v in colunas.items()}}
