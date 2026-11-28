"""Relatórios: catálogo (fontes, prontos e salvos), execução, valores para filtros, Excel e relatórios salvos.

A rota é livre para quem está logado; quem decide o acesso é a fonte (permissão do dado) e cada coluna (dinheiro).
"""

from datetime import date, datetime
from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Response
from openpyxl import Workbook
from openpyxl.chart import BarChart, DoughnutChart, LineChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import or_, select

from app.core.deps import Ctx
from app.core.models import Usuario
from app.modules.faturamento.service import usa_contrato
from app.modules.relatorios import motor
from app.modules.relatorios.fontes import NUMERICOS, disponiveis
from app.modules.relatorios.models import RelatorioSalvo
from app.modules.relatorios.prontos import PERMISSAO_EXTRA, PRONTOS

router = APIRouter(prefix="/relatorios", tags=["Relatórios"])


def _fonte_meta(ctx, f) -> dict:
    return {"id": f.id, "nome": f.nome, "descricao": f.descricao, "icone": f.icone, "rotulo_contagem": f.rotulo_contagem,
            "data_principal": f.data_principal, "colunas": [c.meta() for c in f.colunas(ctx)]}


def _salvo_out(ctx, s: RelatorioSalvo, autores: dict[int, str]) -> dict:
    return {"id": s.id, "nome": s.nome, "descricao": s.descricao, "fonte": s.fonte, "config": s.config or {},
            "compartilhado": s.compartilhado, "meu": s.criado_por_id == ctx.usuario.id,
            "autor": autores.get(s.criado_por_id or 0), "atualizado_em": s.atualizado_em}


def _salvos(ctx) -> list[dict]:
    ok = {f.id for f in disponiveis(ctx)}
    lista = [s for s in ctx.db.scalars(select(RelatorioSalvo).where(
        RelatorioSalvo.tenant_id == ctx.tenant_id,
        or_(RelatorioSalvo.criado_por_id == ctx.usuario.id, RelatorioSalvo.compartilhado.is_(True)))
        .order_by(RelatorioSalvo.nome)) if s.fonte in ok]
    ids = {s.criado_por_id for s in lista if s.criado_por_id}
    autores = dict(ctx.db.execute(select(Usuario.id, Usuario.nome).where(Usuario.id.in_(ids))).all()) if ids else {}
    return [_salvo_out(ctx, s, autores) for s in lista]


def _sem_contrato(p: dict) -> dict:
    cfg = p["config"]
    return {**p, "config": {**cfg, "colunas": [c for c in cfg["colunas"] if c != "contrato"],
                            "ordenar": [o for o in cfg["ordenar"] if o.get("coluna") != "contrato"]}}


@router.get("/catalogo")
def catalogo(ctx: Ctx):
    fontes = disponiveis(ctx)
    ok = {f.id for f in fontes}
    prontos = [p for p in PRONTOS
               if p["fonte"] in ok and (p["id"] not in PERMISSAO_EXTRA or ctx.pode(PERMISSAO_EXTRA[p["id"]]))]
    if not usa_contrato(ctx.db, ctx.tenant_id):  # só cliente e caso: os prontos saem sem a coluna de contrato
        prontos = [_sem_contrato(p) for p in prontos if (p["config"]["grafico"] or {}).get("dimensao") != "contrato"]
    return {"fontes": [_fonte_meta(ctx, f) for f in fontes], "prontos": prontos, "salvos": _salvos(ctx)}


@router.post("/executar")
def executar(p: motor.Pedido, ctx: Ctx):
    r = motor.executar(ctx, p)
    r.pop("_rows")
    r.pop("_cols")
    return r


@router.get("/valores")
def valores(ctx: Ctx, fonte: str, coluna: str):
    return motor.valores_distintos(ctx, fonte, coluna)


# ------------------------------------------------------------------------------------------------ Excel
class ExportarIn(motor.Pedido):
    titulo: str = Field(default="Relatório", max_length=150)
    subtitulo: str | None = Field(default=None, max_length=1000)


NAVY = "1E2D6B"
FMT = {"moeda": '"R$" #,##0.00', "horas": "[h]:mm", "numero": "#,##0.##", "data": "DD/MM/YYYY"}


def _celula(v, tipo: str):
    if v is None:
        return None
    if tipo == "horas":
        return v / 24  # o Excel conta o tempo em dias; o formato [h]:mm mostra as horas
    if tipo == "bool":
        return "Sim" if v else "Não"
    return v


def _planilha(r: dict, dados: ExportarIn) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Relatório"
    cols = r["_cols"]
    ws["A1"] = dados.titulo
    ws["A1"].font = Font(size=14, bold=True, color=NAVY)
    ws["A2"] = (dados.subtitulo + " · " if dados.subtitulo else "") + f"{r['total_linhas']} {r['rotulo_contagem'].lower()} · gerado em {datetime.now():%d/%m/%Y %H:%M}"
    ws["A2"].font = Font(size=9, color="64748B")
    cab = 4
    for i, c in enumerate(cols, 1):
        cel = ws.cell(cab, i, c.rotulo)
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor=NAVY)
        cel.alignment = Alignment(vertical="center")
    larg = [len(c.rotulo) + 2 for c in cols]
    for n, row in enumerate(r["_rows"], cab + 1):
        for i, c in enumerate(cols, 1):
            v = row.get(c.id)
            cel = ws.cell(n, i, _celula(v, c.tipo))
            if c.tipo in FMT:
                cel.number_format = FMT[c.tipo]
            if c.tipo == "longo":
                cel.alignment = Alignment(wrap_text=True, vertical="top")
            larg[i - 1] = max(larg[i - 1], min(60 if c.tipo == "longo" else 45, len(str(v or "")) + 2))
    fim = cab + len(r["_rows"])
    if r["_rows"]:
        tot = fim + 1
        ws.cell(tot, 1, "Total").font = Font(bold=True)
        for i, c in enumerate(cols, 1):
            if c.tipo in NUMERICOS and c.somar and i > 1:
                letra = get_column_letter(i)
                cel = ws.cell(tot, i, f"=SUBTOTAL(9,{letra}{cab + 1}:{letra}{fim})")
                cel.font = Font(bold=True)
                cel.number_format = FMT.get(c.tipo, "#,##0.##")
        ws.auto_filter.ref = f"A{cab}:{get_column_letter(len(cols))}{fim}"
    for i, w in enumerate(larg, 1):
        ws.column_dimensions[get_column_letter(i)].width = max(8, w)
    ws.freeze_panes = ws.cell(cab + 1, 1)

    g = r["grafico"]
    if g and g["categorias"]:
        _aba_grafico(wb, g)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _aba_grafico(wb, g: dict) -> None:
    ws = wb.create_sheet("Gráfico")
    med = g["medida"]
    horas = med["tipo"] == "horas"
    series = g["series"] or [med["rotulo"]]
    ws.cell(1, 1, g["dimensao"]["rotulo"]).font = Font(bold=True)
    for j, s in enumerate(series, 2):
        ws.cell(1, j, s).font = Font(bold=True)
    fmt = '#,##0.0" h"' if horas else FMT.get(med["tipo"], "#,##0")
    for i, c in enumerate(g["categorias"], 2):
        ws.cell(i, 1, c["rotulo"])
        vals = [c["valores"].get(s, 0) for s in series] if g["series"] else [c["total"]]
        for j, v in enumerate(vals, 2):
            ws.cell(i, j, v).number_format = fmt
    n = len(g["categorias"])
    ws.column_dimensions["A"].width = max(14, min(40, max(len(c["rotulo"]) for c in g["categorias"]) + 2))
    dados = Reference(ws, min_col=2, max_col=1 + len(series), min_row=1, max_row=n + 1)
    cats = Reference(ws, min_col=1, min_row=2, max_row=n + 1)
    tipo = g["tipo"]
    if tipo == "rosca":
        ch = DoughnutChart()
    elif tipo in ("linhas", "area"):
        ch = LineChart()
    else:
        ch = BarChart()
        ch.type = "bar" if tipo == "barras_h" else "col"
        if g["series"] and tipo in ("empilhado", "barras_h"):  # "barras" com série = lado a lado
            ch.grouping = "stacked"
            ch.overlap = 100
    titulo_med = med["rotulo"] if g["agregacao"] in ("soma", "contagem") else f"{med['rotulo']} ({g['agregacao']})"
    ch.title = f"{titulo_med} por {g['dimensao']['rotulo'].lower()}"
    ch.add_data(dados, titles_from_data=True)
    ch.set_categories(cats)
    ch.height, ch.width = 9 + (n * 0.35 if tipo == "barras_h" else 0), 22
    ws.add_chart(ch, f"{get_column_letter(len(series) + 3)}2")


@router.post("/exportar")
def exportar(dados: ExportarIn, ctx: Ctx):
    r = motor.executar(ctx, dados, limite_linhas=None)
    if r["total_linhas"] > 100_000:
        raise HTTPException(400, "Mais de 100 mil linhas: filtre um período menor.")
    nome = f"{dados.titulo} - {date.today():%Y-%m-%d}.xlsx".replace("/", "-")
    return Response(_planilha(r, dados), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(nome)}"})


# ------------------------------------------------------------------------------------------------ salvos
class SalvoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    descricao: str | None = Field(default=None, max_length=300)
    fonte: str
    config: dict
    compartilhado: bool = False


def _config(dados: SalvoIn) -> dict:
    # valida o formato pelo próprio pedido do motor (colunas, filtros, gráfico, ordenação)
    try:
        p = motor.Pedido(fonte=dados.fonte, **{k: v for k, v in dados.config.items()
                                               if k in ("colunas", "filtros", "grafico", "ordenar")})
    except ValidationError as e:
        raise HTTPException(422, "Configuração do relatório inválida: " + "; ".join(
            f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors())) from e
    return p.model_dump(exclude={"fonte"}, mode="json", exclude_none=True)


def _meu(ctx, sid: int) -> RelatorioSalvo:
    s = ctx.db.get(RelatorioSalvo, sid)
    if s is None or s.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Relatório não encontrado.")
    if s.criado_por_id != ctx.usuario.id and not ctx.usuario.administrador:
        raise HTTPException(403, "Só quem criou o relatório (ou um administrador) pode alterá-lo.")
    return s


@router.post("/salvos", status_code=201)
def salvar(dados: SalvoIn, ctx: Ctx):
    motor.fonte_ou_404(ctx, dados.fonte)
    s = RelatorioSalvo(tenant_id=ctx.tenant_id, nome=dados.nome.strip(), descricao=dados.descricao, fonte=dados.fonte,
                       config=_config(dados), compartilhado=dados.compartilhado, criado_por_id=ctx.usuario.id)
    ctx.db.add(s)
    ctx.db.flush()
    ctx.auditar("relatorio.salvar", "relatorio_salvo", s.id, descricao=f"Relatório \"{s.nome}\" salvo")
    ctx.db.commit()
    return _salvo_out(ctx, s, {ctx.usuario.id: ctx.usuario.nome})


@router.put("/salvos/{sid}")
def atualizar(sid: int, dados: SalvoIn, ctx: Ctx):
    s = _meu(ctx, sid)
    motor.fonte_ou_404(ctx, dados.fonte)
    s.nome, s.descricao, s.fonte, s.config, s.compartilhado = (dados.nome.strip(), dados.descricao, dados.fonte,
                                                               _config(dados), dados.compartilhado)
    ctx.auditar("relatorio.editar", "relatorio_salvo", s.id, descricao=f"Relatório \"{s.nome}\" alterado")
    ctx.db.commit()
    return _salvo_out(ctx, s, {ctx.usuario.id: ctx.usuario.nome})


@router.delete("/salvos/{sid}", status_code=204)
def excluir(sid: int, ctx: Ctx):
    s = _meu(ctx, sid)
    ctx.auditar("relatorio.excluir", "relatorio_salvo", s.id, descricao=f"Relatório \"{s.nome}\" excluído")
    ctx.db.delete(s)
    ctx.db.commit()
    return Response(status_code=204)


@router.get("/salvos")
def listar_salvos(ctx: Ctx, fonte: str | None = Query(None)):
    return [s for s in _salvos(ctx) if not fonte or s["fonte"] == fonte]
