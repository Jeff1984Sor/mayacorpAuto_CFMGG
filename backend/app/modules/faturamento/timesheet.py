"""Timesheet central: todas as horas lançadas no escritório, com filtros, totais e valor estimado.

O lançamento continua sendo do caso (POST /faturamento/casos/{id}/timesheet); aqui é o compilado.
"""

from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.core.deps import Ctx
from app.modules.faturamento import service
from app.modules.faturamento.models import Caso, Contrato, FaturaItem, Timesheet

router = APIRouter(prefix="/faturamento", tags=["Faturamento · Timesheet"])


class LinhaTimesheet(BaseModel):
    id: int
    data: date
    minutos: int
    descricao: str
    faturavel: bool
    faturado: bool
    fatura_codigo: str | None
    profissional_id: int
    profissional_nome: str
    cargo_nome: str | None
    caso_id: int
    caso_numero: int
    caso_titulo: str
    contrato_id: int
    contrato_nome: str
    cliente_id: int
    cliente_nome: str
    valor_hora: Decimal | None
    valor: Decimal | None  # estimado (tabela de preço × cargo), ou o faturado


class TimesheetCentralOut(BaseModel):
    itens: list[LinhaTimesheet]
    resumo: dict
    por_profissional: list[dict]
    por_cliente: list[dict]
    por_dia: list[dict]


def _horas(minutos: int) -> Decimal:
    return (Decimal(minutos) / 60).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _consulta(ctx, de, ate, profissional_id, minhas, caso_id, contrato_id, tomador_id, faturavel, situacao, q):
    sel = (select(Timesheet).join(Caso, Timesheet.caso_id == Caso.id).join(Contrato, Caso.contrato_id == Contrato.id)
           .where(Timesheet.tenant_id == ctx.tenant_id, Timesheet.data >= de, Timesheet.data <= ate))
    if minhas:
        sel = sel.where(Timesheet.profissional_id == ctx.usuario.id)
    elif profissional_id:
        sel = sel.where(Timesheet.profissional_id == profissional_id)
    if caso_id:
        sel = sel.where(Timesheet.caso_id == caso_id)
    if contrato_id:
        sel = sel.where(Caso.contrato_id == contrato_id)
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if faturavel is not None:
        sel = sel.where(Timesheet.faturavel == faturavel)
    if situacao == "faturadas":
        sel = sel.where(Timesheet.fatura_item_id.is_not(None))
    elif situacao == "a_faturar":
        sel = sel.where(Timesheet.fatura_item_id.is_(None), Timesheet.faturavel)
    if q:
        sel = sel.where(or_(Timesheet.descricao.ilike(f"%{q}%"), Caso.titulo.ilike(f"%{q}%"), Contrato.nome.ilike(f"%{q}%")))
    return list(ctx.db.scalars(sel.order_by(Timesheet.data.desc(), Timesheet.id.desc()).limit(5000)))


def _linhas(ctx, registros: list[Timesheet]) -> list[LinhaTimesheet]:
    cache_vh: dict = {}
    out = []
    for t in registros:
        caso = t.caso
        contrato = caso.contrato
        p = t.profissional
        item = ctx.db.get(FaturaItem, t.fatura_item_id) if t.fatura_item_id else None
        if item:
            vh, valor = item.valor_unitario, item.valor
        else:
            chave = (caso.id, t.profissional_id)
            if chave not in cache_vh:
                cache_vh[chave] = service.valor_hora_do_caso(ctx.db, caso, t.profissional_id)
            vh = cache_vh[chave]
            valor = (_horas(t.minutos) * vh).quantize(Decimal("0.01")) if vh is not None and t.faturavel else None
        out.append(LinhaTimesheet(
            id=t.id, data=t.data, minutos=t.minutos, descricao=t.descricao, faturavel=t.faturavel, faturado=item is not None,
            fatura_codigo=item.fatura.codigo if item else None, profissional_id=t.profissional_id,
            profissional_nome=p.nome if p else "?", cargo_nome=p.cargo.nome if p and p.cargo else None, caso_id=caso.id,
            caso_numero=caso.numero, caso_titulo=caso.titulo, contrato_id=contrato.id, contrato_nome=contrato.nome,
            cliente_id=contrato.tomador_id, cliente_nome=contrato.tomador.nome if contrato.tomador else "", valor_hora=vh, valor=valor))
    return out


@router.get("/timesheet", response_model=TimesheetCentralOut)
def timesheet_central(ctx: Ctx, de: date | None = None, ate: date | None = None, profissional_id: int | None = None,
                      minhas: bool = False, caso_id: int | None = None, contrato_id: int | None = None, tomador_id: int | None = None,
                      faturavel: bool | None = None, situacao: str | None = Query(None, pattern="^(faturadas|a_faturar)$"),
                      q: str | None = None):
    hoje = date.today()
    de = de or hoje.replace(day=1)
    ate = ate or hoje
    linhas = _linhas(ctx, _consulta(ctx, de, ate, profissional_id, minhas, caso_id, contrato_id, tomador_id, faturavel, situacao, q))
    tot = lambda xs: sum(x.minutos for x in xs)  # noqa: E731
    fat = [x for x in linhas if x.faturavel]
    resumo = {
        "de": de.isoformat(), "ate": ate.isoformat(), "lancamentos": len(linhas), "minutos": tot(linhas),
        "minutos_faturaveis": tot(fat), "minutos_nao_faturaveis": tot([x for x in linhas if not x.faturavel]),
        "minutos_faturados": tot([x for x in linhas if x.faturado]),
        "minutos_a_faturar": tot([x for x in fat if not x.faturado]),
        "valor_a_faturar": str(sum((x.valor or 0 for x in fat if not x.faturado), Decimal(0))),
        "valor_faturado": str(sum((x.valor or 0 for x in linhas if x.faturado), Decimal(0))),
        "sem_valor_hora": sum(1 for x in fat if not x.faturado and x.valor_hora is None),
        "aproveitamento": round(tot(fat) / tot(linhas) * 100) if linhas else 0,
    }
    # minhas horas hoje e na semana (para o "contador" de quem lança)
    seg = hoje - timedelta(days=hoje.weekday())
    minhas_q = ctx.db.scalars(select(Timesheet).where(Timesheet.tenant_id == ctx.tenant_id, Timesheet.profissional_id == ctx.usuario.id,
                                                       Timesheet.data >= seg, Timesheet.data <= hoje))
    meus = list(minhas_q)
    resumo["meus_minutos_hoje"] = sum(t.minutos for t in meus if t.data == hoje)
    resumo["meus_minutos_semana"] = sum(t.minutos for t in meus)

    def agrupar(chave, rotulo):
        g: dict = defaultdict(lambda: {"minutos": 0, "minutos_faturaveis": 0, "valor": Decimal(0), "lancamentos": 0})
        nomes = {}
        for x in linhas:
            k = chave(x)
            nomes[k] = rotulo(x)
            g[k]["minutos"] += x.minutos
            g[k]["lancamentos"] += 1
            if x.faturavel:
                g[k]["minutos_faturaveis"] += x.minutos
                g[k]["valor"] += x.valor or 0
        return sorted([{"id": k, "nome": nomes[k], **v, "valor": str(v["valor"])} for k, v in g.items()], key=lambda d: -d["minutos"])

    por_dia: dict = defaultdict(int)
    for x in linhas:
        por_dia[x.data.isoformat()] += x.minutos
    return TimesheetCentralOut(
        itens=linhas, resumo=resumo,
        por_profissional=agrupar(lambda x: x.profissional_id, lambda x: x.profissional_nome),
        por_cliente=agrupar(lambda x: x.cliente_id, lambda x: x.cliente_nome),
        por_dia=[{"data": d, "minutos": m} for d, m in sorted(por_dia.items())])


@router.get("/timesheet/exportar.xlsx")
def exportar_timesheet(ctx: Ctx, de: date | None = None, ate: date | None = None, profissional_id: int | None = None,
                       minhas: bool = False, caso_id: int | None = None, contrato_id: int | None = None, tomador_id: int | None = None,
                       faturavel: bool | None = None, situacao: str | None = None, q: str | None = None):
    from app.modules.financas.planilhas import tabela

    hoje = date.today()
    de, ate = de or hoje.replace(day=1), ate or hoje
    linhas = _linhas(ctx, _consulta(ctx, de, ate, profissional_id, minhas, caso_id, contrato_id, tomador_id, faturavel, situacao, q))
    dados = [[x.data, x.profissional_nome, x.cargo_nome, x.cliente_nome, f"#{x.caso_numero} {x.caso_titulo}", x.descricao,
              f"{x.minutos // 60}:{x.minutos % 60:02d}", float(_horas(x.minutos)), "Sim" if x.faturavel else "Não",
              x.fatura_codigo or ("A faturar" if x.faturavel else "—"), x.valor_hora, x.valor] for x in linhas]
    total_min = sum(x.minutos for x in linhas)
    arq = tabela("Timesheet", ["Data", "Profissional", "Cargo", "Cliente", "Caso", "Descrição", "Horas (HH:MM)", "Horas (decimal)",
                               "Faturável", "Fatura", "Valor/hora", "Valor"], dados,
                 larguras=[12, 24, 20, 30, 34, 60, 12, 12, 10, 16, 12, 14], moeda={10, 11}, datas={0},
                 topo=["Timesheet", f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}"],
                 rodape=[None, f"{len(linhas)} lançamento(s)", None, None, None, None, f"{total_min // 60}:{total_min % 60:02d}",
                         float(_horas(total_min)), None, None, None, sum((x.valor or 0 for x in linhas), Decimal(0))])
    return Response(arq, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="timesheet_{de:%Y%m%d}_{ate:%Y%m%d}.xlsx"'})



