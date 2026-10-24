"""Faturamento: contratos → casos → regras de cobrança, timesheet, despesas e Itens a faturar."""

from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select

from app.core.config import settings
from app.core.deps import Admin, Ctx, Operador
from app.core.models import Cargo, Usuario
from app.core.schemas import Mensagem
from app.modules.faturamento import service
from app.modules.faturamento.models import (
    Caso,
    Contrato,
    Despesa,
    FaturaItem,
    Frequencia,
    RegraCobranca,
    TabelaPreco,
    TabelaPrecoItem,
    Termino,
    Timesheet,
    TipoRegra,
)
from app.modules.faturamento.schemas import (
    CancelarFaturaIn,
    CasoIn,
    CasoOut,
    ClientePendenteOut,
    ContratoIn,
    ContratoOut,
    ContratoPendenteOut,
    DespesaIn,
    DespesaOut,
    EmitirNfseIn,
    FaturadaOut,
    FaturarIn,
    FaturarOut,
    ItemPendenteOut,
    ItensAFaturarOut,
    ProfissionalOut,
    RegraIn,
    RegraOut,
    TabelaIn,
    TabelaOut,
    TimesheetIn,
    TimesheetOut,
)
from app.modules.rpa_nfse.models import Emissora, Fatura, Tomador

router = APIRouter(prefix="/faturamento", tags=["Faturamento"])

COMPROVANTE_MAX = 15 * 1024 * 1024


def _get(ctx, modelo, oid: int, nome: str):
    obj = ctx.db.get(modelo, oid)
    if not obj or obj.tenant_id != ctx.tenant_id:
        raise HTTPException(404, f"{nome} não encontrado.")
    return obj


def _erro(e: service.RegraFaturamento):
    raise HTTPException(400, str(e)) from e


# ================================================================ funcionários (usuários) e tabelas de preço
@router.get("/profissionais", response_model=list[ProfissionalOut])
def profissionais(ctx: Ctx, todos: bool = False):
    """Funcionários para os campos de timesheet (inclui quem não acessa o sistema)."""
    sel = select(Usuario).where(Usuario.tenant_id == ctx.tenant_id)
    if not todos:
        sel = sel.where(Usuario.ativo)
    return [ProfissionalOut(id=u.id, nome=u.nome, email=u.email, cargo_id=u.cargo_id, cargo_nome=u.cargo.nome if u.cargo else None,
                            oab=u.oab, acesso_sistema=u.acesso_sistema, ativo=u.ativo)
            for u in ctx.db.scalars(sel.order_by(Usuario.nome))]


@router.delete("/tabelas/{tid}", response_model=Mensagem)
def excluir_tabela(tid: int, ctx: Admin):
    t = _get(ctx, TabelaPreco, tid, "Tabela")
    em_uso = sum(ctx.db.scalar(select(func.count()).select_from(m).where(m.tabela_preco_id == tid)) or 0
                 for m in (Contrato, Caso, RegraCobranca))
    if em_uso:
        t.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Tabela em uso em contratos/casos: foi desativada.")
    ctx.db.delete(t)
    ctx.db.commit()
    return Mensagem(mensagem="Tabela excluída.")


@router.get("/tabelas", response_model=list[TabelaOut])
def tabelas(ctx: Ctx):
    return ctx.db.scalars(select(TabelaPreco).where(TabelaPreco.tenant_id == ctx.tenant_id).order_by(TabelaPreco.nome)).all()


def _salvar_tabela(ctx, t: TabelaPreco, dados: TabelaIn):
    t.nome, t.ativo = dados.nome, dados.ativo
    vistos = set()
    t.itens.clear()
    ctx.db.flush()
    for it in dados.itens:
        if it.cargo_id in vistos:
            raise HTTPException(400, "Cargo repetido na tabela.")
        vistos.add(it.cargo_id)
        _get(ctx, Cargo, it.cargo_id, "Cargo")
        t.itens.append(TabelaPrecoItem(cargo_id=it.cargo_id, valor_hora=it.valor_hora))


@router.post("/tabelas", response_model=TabelaOut, status_code=201)
def criar_tabela(dados: TabelaIn, ctx: Admin):
    t = TabelaPreco(tenant_id=ctx.tenant_id, nome=dados.nome)
    ctx.db.add(t)
    _salvar_tabela(ctx, t, dados)
    ctx.db.flush()
    ctx.auditar("faturamento.tabela.criar", "fat_tabela", t.id, descricao=t.nome)
    ctx.db.commit()
    return t


@router.put("/tabelas/{tid}", response_model=TabelaOut)
def alterar_tabela(tid: int, dados: TabelaIn, ctx: Admin):
    t = _get(ctx, TabelaPreco, tid, "Tabela")
    _salvar_tabela(ctx, t, dados)
    ctx.auditar("faturamento.tabela.alterar", "fat_tabela", t.id, descricao=t.nome)
    ctx.db.commit()
    return t


# ================================================================ contratos
def _contrato_out(ctx, c: Contrato) -> ContratoOut:
    campos = {k: getattr(c, k) for k in ContratoOut.model_fields if hasattr(Contrato, k)}
    tabela = ctx.db.get(TabelaPreco, c.tabela_preco_id) if c.tabela_preco_id else None
    return ContratoOut(**campos, tomador_nome=c.tomador.nome if c.tomador else "", tabela_preco_nome=tabela.nome if tabela else None,
                       qtd_casos=len(c.casos), qtd_regras=len([r for r in c.regras if r.ativo]))


@router.get("/contratos", response_model=list[ContratoOut])
def contratos(ctx: Ctx, tomador_id: int | None = None, q: str | None = None, ativos: bool | None = None):
    sel = select(Contrato).join(Tomador, Contrato.tomador_id == Tomador.id).where(Contrato.tenant_id == ctx.tenant_id)
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if q:
        conds = [Contrato.nome.ilike(f"%{q}%"), Tomador.nome.ilike(f"%{q}%")]
        if q.strip().isdigit():
            conds.append(Contrato.numero == int(q))
        sel = sel.where(or_(*conds))
    if ativos is not None:
        sel = sel.where(Contrato.ativo == ativos)
    return [_contrato_out(ctx, c) for c in ctx.db.scalars(sel.order_by(Contrato.numero.desc()))]


def _validar_contrato(ctx, dados: ContratoIn):
    _get(ctx, Tomador, dados.tomador_id, "Cliente")
    if dados.emissora_id:
        _get(ctx, Emissora, dados.emissora_id, "Emissora")
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    if dados.data_inicio and dados.data_fim and dados.data_fim < dados.data_inicio:
        raise HTTPException(400, "O fim do contrato deve ser depois do início.")


@router.post("/contratos", response_model=ContratoOut, status_code=201)
def criar_contrato(dados: ContratoIn, ctx: Operador):
    _validar_contrato(ctx, dados)
    numero = (ctx.db.scalar(select(func.max(Contrato.numero)).where(Contrato.tenant_id == ctx.tenant_id)) or 0) + 1
    c = Contrato(tenant_id=ctx.tenant_id, numero=numero, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("faturamento.contrato.criar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    ctx.db.refresh(c)
    return _contrato_out(ctx, c)


@router.get("/contratos/{cid}", response_model=ContratoOut)
def ler_contrato(cid: int, ctx: Ctx):
    return _contrato_out(ctx, _get(ctx, Contrato, cid, "Contrato"))


@router.put("/contratos/{cid}", response_model=ContratoOut)
def alterar_contrato(cid: int, dados: ContratoIn, ctx: Operador):
    c = _get(ctx, Contrato, cid, "Contrato")
    _validar_contrato(ctx, dados)
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("faturamento.contrato.alterar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    ctx.db.refresh(c)
    return _contrato_out(ctx, c)


@router.delete("/contratos/{cid}", response_model=Mensagem)
def excluir_contrato(cid: int, ctx: Admin):
    c = _get(ctx, Contrato, cid, "Contrato")
    if c.casos or ctx.db.scalar(select(func.count()).select_from(Fatura).where(Fatura.contrato_id == cid)):
        c.ativo = False
        ctx.auditar("faturamento.contrato.desativar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
        ctx.db.commit()
        return Mensagem(mensagem="Contrato com casos ou faturas: foi desativado.")
    for r in ctx.db.scalars(select(RegraCobranca).where(RegraCobranca.contrato_id == cid)):
        ctx.db.delete(r)
    ctx.db.delete(c)
    ctx.auditar("faturamento.contrato.excluir", "fat_contrato", cid, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    return Mensagem(mensagem="Contrato excluído.")


# ================================================================ casos
def _caso_out(ctx, c: Caso) -> CasoOut:
    resp = ctx.db.get(Usuario, c.responsavel_id) if c.responsavel_id else None
    min_pend = ctx.db.scalar(select(func.coalesce(func.sum(Timesheet.minutos), 0)).where(
        Timesheet.caso_id == c.id, Timesheet.faturavel, Timesheet.fatura_item_id.is_(None))) or 0
    desp = ctx.db.scalar(select(func.coalesce(func.sum(Despesa.valor), 0)).where(
        Despesa.caso_id == c.id, Despesa.reembolsavel, Despesa.fatura_item_id.is_(None))) or 0
    return CasoOut(
        id=c.id, numero=c.numero, contrato_id=c.contrato_id, contrato_nome=c.contrato.nome, contrato_numero=c.contrato.numero,
        tomador_id=c.contrato.tomador_id, tomador_nome=c.contrato.tomador.nome if c.contrato.tomador else "",
        titulo=c.titulo, descricao=c.descricao, numero_processo=c.numero_processo, parte_contraria=c.parte_contraria,
        responsavel_id=c.responsavel_id, responsavel_nome=resp.nome if resp else None, status=c.status,
        tabela_preco_id=c.tabela_preco_id,
        tabela_preco_efetiva=(t.nome if (t := ctx.db.get(TabelaPreco, c.tabela_preco_id or c.contrato.tabela_preco_id or 0)) else None),
        data_abertura=c.data_abertura, data_encerramento=c.data_encerramento,
        tem_regra_propria=any(r.ativo for r in c.regras),
        horas_pendentes=(Decimal(min_pend) / 60).quantize(Decimal("0.01")), despesas_pendentes=Decimal(desp))


@router.get("/casos", response_model=list[CasoOut])
def casos(ctx: Ctx, contrato_id: int | None = None, tomador_id: int | None = None, q: str | None = None,
          status: str | None = Query(None, pattern="^(aberto|encerrado)$")):
    sel = select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(Caso.tenant_id == ctx.tenant_id)
    if contrato_id:
        sel = sel.where(Caso.contrato_id == contrato_id)
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if status:
        sel = sel.where(Caso.status == status)
    if q:
        conds = [Caso.titulo.ilike(f"%{q}%"), Caso.numero_processo.ilike(f"%{q}%"), Caso.parte_contraria.ilike(f"%{q}%")]
        if q.strip().isdigit():
            conds.append(Caso.numero == int(q))
        sel = sel.where(or_(*conds))
    return [_caso_out(ctx, c) for c in ctx.db.scalars(sel.order_by(Caso.numero.desc()).limit(500))]


@router.post("/contratos/{cid}/casos", response_model=CasoOut, status_code=201)
def criar_caso(cid: int, dados: CasoIn, ctx: Operador):
    contrato = _get(ctx, Contrato, cid, "Contrato")
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    if dados.responsavel_id:
        _get(ctx, Usuario, dados.responsavel_id, "Responsável")
    numero = (ctx.db.scalar(select(func.max(Caso.numero)).where(Caso.tenant_id == ctx.tenant_id)) or 0) + 1
    c = Caso(tenant_id=ctx.tenant_id, numero=numero, contrato_id=contrato.id, **dados.model_dump())
    c.data_abertura = c.data_abertura or date.today()
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("faturamento.caso.criar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
    ctx.db.commit()
    ctx.db.refresh(c)
    return _caso_out(ctx, c)


@router.get("/casos/{cid}", response_model=CasoOut)
def ler_caso(cid: int, ctx: Ctx):
    return _caso_out(ctx, _get(ctx, Caso, cid, "Caso"))


@router.put("/casos/{cid}", response_model=CasoOut)
def alterar_caso(cid: int, dados: CasoIn, ctx: Operador):
    c = _get(ctx, Caso, cid, "Caso")
    if dados.responsavel_id:
        _get(ctx, Usuario, dados.responsavel_id, "Responsável")
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("faturamento.caso.alterar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
    ctx.db.commit()
    return _caso_out(ctx, c)


# ================================================================ regras de cobrança
_FREQ = {Frequencia.diaria: ("Diária", "dia", "dias"), Frequencia.semanal: ("Semanal", "semana", "semanas"),
         Frequencia.mensal: ("Mensal", "mês", "meses"), Frequencia.anual: ("Anual", "ano", "anos")}


def _resumo_regra(r: RegraCobranca) -> str:
    def brl(v):
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if v is not None else ""

    if r.tipo == TipoRegra.fixo:
        return f"{brl(r.valor)} em {r.data_pagamento:%d/%m/%Y}" if r.data_pagamento else brl(r.valor)
    if r.tipo == TipoRegra.hora:
        return f"Por hora · {r.tabela_preco.nome}" if r.tabela_preco else "Por hora · tabela do caso/contrato"
    nome, um, varios = _FREQ.get(r.frequencia, ("", "", ""))
    txt = f"{brl(r.valor)} · {nome.lower() if r.intervalo == 1 else f'a cada {r.intervalo} {varios}'}"
    if r.data_inicio:
        txt += f" · desde {r.data_inicio:%d/%m/%Y}"
    if r.termino == Termino.ocorrencias and r.ocorrencias:
        txt += f" · {r.ocorrencias} parcela{'s' if r.ocorrencias > 1 else ''}"
    elif r.termino == Termino.data and r.data_fim:
        txt += f" · até {r.data_fim:%d/%m/%Y}"
    else:
        txt += " · sem término"
    return txt


def _regra_out(ctx, r: RegraCobranca) -> RegraOut:
    faturadas = ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(
        FaturaItem.regra_id == r.id, FaturaItem.chave_cobranca.is_not(None))) or 0
    proxima = None
    if r.tipo == TipoRegra.recorrente:
        cobradas = set(ctx.db.scalars(select(FaturaItem.competencia).where(FaturaItem.regra_id == r.id)))
        limite = date(date.today().year + 30, 12, 31)
        proxima = next((d for _, d in service.ocorrencias(r, limite) if d not in cobradas), None)
    elif r.tipo == TipoRegra.fixo and not faturadas:
        proxima = r.data_pagamento
    return RegraOut.model_validate(r, from_attributes=True).model_copy(
        update={"resumo": _resumo_regra(r), "parcelas_faturadas": faturadas, "proxima": proxima})


@router.get("/regras", response_model=list[RegraOut])
def regras(ctx: Ctx, contrato_id: int | None = None, caso_id: int | None = None):
    sel = select(RegraCobranca).where(RegraCobranca.tenant_id == ctx.tenant_id)
    if caso_id:
        sel = sel.where(RegraCobranca.caso_id == caso_id)
    elif contrato_id:
        sel = sel.where(RegraCobranca.contrato_id == contrato_id, RegraCobranca.caso_id.is_(None))
    return [_regra_out(ctx, r) for r in ctx.db.scalars(sel.order_by(RegraCobranca.id))]


def _aplicar_regra(ctx, r: RegraCobranca, dados: RegraIn):
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    for k, v in dados.model_dump().items():
        setattr(r, k, v)
    if r.tipo != TipoRegra.recorrente:
        r.frequencia, r.data_inicio, r.termino, r.ocorrencias, r.data_fim = None, None, Termino.sem, None, None
    if r.tipo != TipoRegra.fixo:
        r.data_pagamento = None
    if r.tipo != TipoRegra.hora:
        r.tabela_preco_id = None
    else:
        r.valor = None


@router.post("/contratos/{cid}/regras", response_model=RegraOut, status_code=201)
def criar_regra_contrato(cid: int, dados: RegraIn, ctx: Operador):
    c = _get(ctx, Contrato, cid, "Contrato")
    return _criar_regra(ctx, c.id, None, dados)


@router.post("/casos/{cid}/regras", response_model=RegraOut, status_code=201)
def criar_regra_caso(cid: int, dados: RegraIn, ctx: Operador):
    c = _get(ctx, Caso, cid, "Caso")
    return _criar_regra(ctx, c.contrato_id, c.id, dados)


def _criar_regra(ctx, contrato_id: int, caso_id: int | None, dados: RegraIn) -> RegraOut:
    r = RegraCobranca(tenant_id=ctx.tenant_id, contrato_id=contrato_id, caso_id=caso_id)
    _aplicar_regra(ctx, r, dados)
    ctx.db.add(r)
    ctx.db.flush()
    ctx.auditar("faturamento.regra.criar", "fat_regra", r.id, descricao=f"{r.tipo.value}: {r.descricao}")
    ctx.db.commit()
    ctx.db.refresh(r)
    return _regra_out(ctx, r)


@router.put("/regras/{rid}", response_model=RegraOut)
def alterar_regra(rid: int, dados: RegraIn, ctx: Operador):
    r = _get(ctx, RegraCobranca, rid, "Regra")
    ja_cobrada = ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(FaturaItem.regra_id == rid))
    if ja_cobrada and dados.tipo != r.tipo:
        raise HTTPException(400, "Esta regra já foi faturada: não dá para mudar o tipo. Desative-a e crie outra.")
    _aplicar_regra(ctx, r, dados)
    ctx.auditar("faturamento.regra.alterar", "fat_regra", r.id, descricao=f"{r.tipo.value}: {r.descricao}")
    ctx.db.commit()
    ctx.db.refresh(r)
    return _regra_out(ctx, r)


@router.delete("/regras/{rid}", response_model=Mensagem)
def excluir_regra(rid: int, ctx: Operador):
    r = _get(ctx, RegraCobranca, rid, "Regra")
    if ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(FaturaItem.regra_id == rid)):
        r.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Regra já faturada: foi desativada (o histórico fica).")
    ctx.db.delete(r)
    ctx.auditar("faturamento.regra.excluir", "fat_regra", rid, descricao=r.descricao)
    ctx.db.commit()
    return Mensagem(mensagem="Regra excluída.")


@router.post("/regras/simular")
def simular_regra(dados: RegraIn, ctx: Ctx, ate: date | None = None):
    """Prévia das parcelas (para a tela mostrar "1ª 05/01 · 2ª 05/02 · ...")."""
    r = RegraCobranca(**dados.model_dump())
    limite = ate or date(date.today().year + 5, 12, 31)
    datas = service.ocorrencias(r, limite)[:60] if r.tipo == TipoRegra.recorrente else (
        [(1, r.data_pagamento)] if r.data_pagamento else [])
    return {"resumo": _resumo_regra(r), "parcelas": [{"n": n, "data": d} for n, d in datas],
            "total_parcelas": service.total_parcelas(r) if r.tipo == TipoRegra.recorrente else 1}


# ================================================================ timesheet
def _fatura_codigo(ctx, item_id: int | None) -> str | None:
    if not item_id:
        return None
    item = ctx.db.get(FaturaItem, item_id)
    return item.fatura.codigo if item else None


def _ts_out(ctx, t: Timesheet) -> TimesheetOut:
    p = t.profissional
    return TimesheetOut(id=t.id, caso_id=t.caso_id, profissional_id=t.profissional_id, profissional_nome=p.nome if p else "?",
                        cargo_nome=p.cargo.nome if p and p.cargo else None,
                        data=t.data, minutos=t.minutos, descricao=t.descricao, faturavel=t.faturavel,
                        faturado=t.fatura_item_id is not None, fatura_codigo=_fatura_codigo(ctx, t.fatura_item_id))


@router.get("/casos/{cid}/timesheet", response_model=list[TimesheetOut])
def timesheet(cid: int, ctx: Ctx):
    _get(ctx, Caso, cid, "Caso")
    return [_ts_out(ctx, t) for t in ctx.db.scalars(select(Timesheet).where(Timesheet.caso_id == cid)
                                                    .order_by(Timesheet.data.desc(), Timesheet.id.desc()))]


@router.post("/casos/{cid}/timesheet", response_model=TimesheetOut, status_code=201)
def lancar_horas(cid: int, dados: TimesheetIn, ctx: Operador):
    _get(ctx, Caso, cid, "Caso")
    pid = profissional_de(ctx, dados.profissional_id)
    t = Timesheet(tenant_id=ctx.tenant_id, caso_id=cid, profissional_id=pid, data=dados.data, minutos=dados.minutos,
                  descricao=dados.descricao, faturavel=dados.faturavel)
    ctx.db.add(t)
    ctx.db.commit()
    return _ts_out(ctx, t)


def profissional_de(ctx, profissional_id: int | None) -> int:
    """O funcionário escolhido ou, sem escolha, quem está lançando."""
    if profissional_id:
        p = _get(ctx, Usuario, profissional_id, "Profissional")
        if not p.ativo:
            raise HTTPException(400, f"{p.nome} está inativo.")
        return p.id
    return ctx.usuario.id


def _editavel(obj, nome: str):
    if obj.fatura_item_id:
        raise HTTPException(400, f"{nome} já faturado: cancele a fatura para alterar.")


@router.put("/timesheet/{tid}", response_model=TimesheetOut)
def alterar_horas(tid: int, dados: TimesheetIn, ctx: Operador):
    t = _get(ctx, Timesheet, tid, "Lançamento")
    _editavel(t, "Lançamento")
    if dados.profissional_id:
        t.profissional_id = profissional_de(ctx, dados.profissional_id)
    t.data, t.minutos, t.descricao, t.faturavel = dados.data, dados.minutos, dados.descricao, dados.faturavel
    ctx.db.commit()
    return _ts_out(ctx, t)


@router.delete("/timesheet/{tid}", response_model=Mensagem)
def excluir_horas(tid: int, ctx: Operador):
    t = _get(ctx, Timesheet, tid, "Lançamento")
    _editavel(t, "Lançamento")
    ctx.db.delete(t)
    ctx.db.commit()
    return Mensagem(mensagem="Lançamento excluído.")


# ================================================================ despesas
def _desp_out(ctx, d: Despesa) -> DespesaOut:
    u = ctx.db.get(Usuario, d.lancado_por_id) if d.lancado_por_id else None
    return DespesaOut(id=d.id, caso_id=d.caso_id, data=d.data, tipo=d.tipo, descricao=d.descricao, valor=d.valor,
                      reembolsavel=d.reembolsavel, tem_comprovante=bool(d.comprovante_path), lancado_por=u.nome if u else None,
                      faturado=d.fatura_item_id is not None, fatura_codigo=_fatura_codigo(ctx, d.fatura_item_id))


@router.get("/casos/{cid}/despesas", response_model=list[DespesaOut])
def despesas(cid: int, ctx: Ctx):
    _get(ctx, Caso, cid, "Caso")
    return [_desp_out(ctx, d) for d in ctx.db.scalars(select(Despesa).where(Despesa.caso_id == cid)
                                                      .order_by(Despesa.data.desc(), Despesa.id.desc()))]


@router.post("/casos/{cid}/despesas", response_model=DespesaOut, status_code=201)
def lancar_despesa(cid: int, dados: DespesaIn, ctx: Operador):
    _get(ctx, Caso, cid, "Caso")
    d = Despesa(tenant_id=ctx.tenant_id, caso_id=cid, lancado_por_id=ctx.usuario.id, **dados.model_dump())
    ctx.db.add(d)
    ctx.db.flush()
    ctx.auditar("faturamento.despesa.lancar", "fat_despesa", d.id, descricao=f"{d.descricao}: {d.valor}")
    ctx.db.commit()
    return _desp_out(ctx, d)


@router.put("/despesas/{did}", response_model=DespesaOut)
def alterar_despesa(did: int, dados: DespesaIn, ctx: Operador):
    d = _get(ctx, Despesa, did, "Despesa")
    _editavel(d, "Despesa")
    for k, v in dados.model_dump().items():
        setattr(d, k, v)
    ctx.db.commit()
    return _desp_out(ctx, d)


@router.delete("/despesas/{did}", response_model=Mensagem)
def excluir_despesa(did: int, ctx: Operador):
    d = _get(ctx, Despesa, did, "Despesa")
    _editavel(d, "Despesa")
    ctx.auditar("faturamento.despesa.excluir", "fat_despesa", d.id, descricao=f"{d.descricao}: {d.valor}")
    ctx.db.delete(d)
    ctx.db.commit()
    return Mensagem(mensagem="Despesa excluída.")


@router.post("/despesas/{did}/comprovante", response_model=DespesaOut)
async def enviar_comprovante(did: int, ctx: Operador, arquivo: UploadFile = File(...)):
    d = _get(ctx, Despesa, did, "Despesa")
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Envie PDF ou imagem.")
    conteudo = await arquivo.read()
    if len(conteudo) > COMPROVANTE_MAX:
        raise HTTPException(400, "Arquivo maior que 15 MB.")
    pasta = Path(settings.storage_dir) / "despesas" / f"{d.data:%Y}"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"despesa_{d.id}{ext}"
    destino.write_bytes(conteudo)
    d.comprovante_path = str(destino)
    ctx.db.commit()
    return _desp_out(ctx, d)


@router.get("/despesas/{did}/comprovante")
def baixar_comprovante(did: int, ctx: Ctx):
    d = _get(ctx, Despesa, did, "Despesa")
    if not d.comprovante_path or not Path(d.comprovante_path).exists():
        raise HTTPException(404, "Sem comprovante.")
    return FileResponse(d.comprovante_path, filename=Path(d.comprovante_path).name, content_disposition_type="inline")


# ================================================================ itens a faturar
@router.get("/itens-a-faturar", response_model=ItensAFaturarOut)
def itens_a_faturar(ctx: Ctx, de: date, ate: date, aba: str = Query("honorarios", pattern="^(honorarios|despesas)$"),
                    cliente_ids: list[int] | None = Query(None), tipos: list[str] | None = Query(None)):
    if ate < de:
        raise HTTPException(400, "O período está invertido.")
    dados = service.pendencias(ctx.db, ctx.tenant_id, aba=aba, de=de, ate=ate, cliente_ids=cliente_ids,
                               tipos=set(tipos) if tipos else None)
    casos_cache: dict[int, Caso] = {}

    def caso(cid):
        if cid and cid not in casos_cache:
            casos_cache[cid] = ctx.db.get(Caso, cid)
        return casos_cache.get(cid) if cid else None

    clientes = []
    for cp in dados:
        contratos_out, por_tipo = [], {}
        for contrato_id, itens in cp.contratos.items():
            c = ctx.db.get(Contrato, contrato_id)
            for p in itens:
                por_tipo[p.tipo] = por_tipo.get(p.tipo, Decimal(0)) + p.valor
            contratos_out.append(ContratoPendenteOut(
                contrato_id=c.id, contrato_numero=c.numero, contrato_nome=c.nome,
                total=sum((p.valor for p in itens), Decimal(0)),
                itens=[ItemPendenteOut(chave=p.chave, tipo=p.tipo, caso_id=p.caso_id,
                                       caso_numero=caso(p.caso_id).numero if caso(p.caso_id) else None,
                                       caso_titulo=caso(p.caso_id).titulo if caso(p.caso_id) else None,
                                       data=p.data, descricao=p.descricao, valor=p.valor, parcela=p.parcela,
                                       quantidade=p.quantidade, valor_unitario=p.valor_unitario,
                                       profissional=p.profissional, aviso=p.aviso) for p in itens]))
        contratos_out.sort(key=lambda x: x.contrato_numero)
        clientes.append(ClientePendenteOut(
            tomador_id=cp.tomador.id, tomador_nome=cp.tomador.nome, tomador_doc=cp.tomador.cpf_cnpj, total=cp.total,
            qtd_itens=sum(len(c.itens) for c in contratos_out), tipos=por_tipo, contratos=contratos_out))
    return ItensAFaturarOut(clientes=clientes, total=sum((c.total for c in clientes), Decimal(0)),
                            qtd_itens=sum(c.qtd_itens for c in clientes))


@router.post("/faturar", response_model=FaturarOut)
def faturar(dados: FaturarIn, ctx: Operador):
    from app.modules.rpa_nfse.service import config_nfse

    cfg = config_nfse(ctx.db, ctx.tenant_id)
    try:
        fats = service.faturar(ctx.db, ctx.tenant_id, aba=dados.aba, de=dados.de, ate=dados.ate, chaves=dados.chaves,
                               cliente_ids=dados.cliente_ids, tipos=set(dados.tipos) if dados.tipos else None,
                               dias_vencimento=cfg.fatura_dias_vencimento if cfg.fatura_dias_vencimento is not None else 10,
                               vencimento_na_emissao=cfg.fatura_vencimento_modo == "emissao")
    except service.RegraFaturamento as e:
        ctx.db.rollback()
        _erro(e)
    for f in fats:
        ctx.auditar("faturamento.faturar", "fatura", f.id, descricao=f"{f.codigo} — {f.valor}")
    ctx.db.commit()
    return FaturarOut(
        faturas=[FaturadaOut(id=f.id, codigo=f.codigo, tomador_nome=f.tomador.nome if f.tomador else "",
                             contrato_nome=ctx.db.get(Contrato, f.contrato_id).nome if f.contrato_id else None,
                             valor=f.valor, data_vencimento=f.data_vencimento) for f in fats],
        total=sum((f.valor for f in fats), Decimal(0)))


@router.post("/faturas/{fid}/cancelar", response_model=Mensagem)
def cancelar_fatura(fid: int, dados: CancelarFaturaIn, ctx: Admin):
    f = _get(ctx, Fatura, fid, "Fatura")
    try:
        service.cancelar(ctx.db, f, dados.motivo)
    except service.RegraFaturamento as e:
        _erro(e)
    ctx.auditar("faturamento.cancelar", "fatura", f.id, descricao=f"{f.codigo}: {dados.motivo}")
    ctx.db.commit()
    return Mensagem(mensagem=f"{f.codigo} cancelada. Os itens voltaram para Itens a faturar.")


@router.post("/emitir-nfse")
def emitir_nfse(dados: EmitirNfseIn, ctx: Operador):
    """Monta o lote de RPS das faturas NH escolhidas; a emissão segue pela tela do lote (pré-validação → emitir)."""
    try:
        lote = service.emitir_nfse(ctx.db, ctx.tenant_id, ctx.usuario.id, dados.fatura_ids)
    except service.RegraFaturamento as e:
        ctx.db.rollback()
        _erro(e)
    ctx.auditar("faturamento.emitir_nfse", "lote", lote.id, descricao=f"Lote #{lote.numero} com {len(dados.fatura_ids)} fatura(s)")
    ctx.db.commit()
    return {"lote_id": lote.id, "numero": lote.numero}
