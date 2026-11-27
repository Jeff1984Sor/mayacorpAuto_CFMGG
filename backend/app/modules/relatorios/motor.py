"""Motor dos relatórios: filtra, agrupa para o gráfico, ordena e projeta as colunas escolhidas. Vale para toda fonte."""

from __future__ import annotations

import unicodedata
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.modules.relatorios.fontes import FONTES, NUMERICOS, Coluna, Fonte

VAZIO = "(vazio)"
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
MAX_SERIES = 8  # a paleta categórica tem 8 cores; o resto vira "Outros"


# ------------------------------------------------------------------------------------------------ pedido
class Filtro(BaseModel):
    coluna: str
    valores: list[str] | None = None  # é um destes ("(vazio)" = sem valor)
    contem: str | None = Field(default=None, max_length=200)
    de: date | None = None
    ate: date | None = None
    relativo: str | None = None  # este_mes, mes_passado, este_ano, ultimos_30, proximos_30, hoje_em_diante...
    min: float | None = None
    max: float | None = None
    negar: bool = False  # "não é" / "não contém"


class Grafico(BaseModel):
    tipo: str = Field(default="barras", pattern="^(barras|barras_h|empilhado|linhas|area|rosca|nenhum)$")
    dimensao: str | None = None
    granularidade: str | None = Field(default="mes", pattern="^(dia|semana|mes|trimestre|ano|dia_semana)$")
    serie: str | None = None
    medida: str = "_contagem"
    agregacao: str = Field(default="soma", pattern="^(soma|media|max|min)$")
    limite: int = Field(default=15, ge=3, le=60)


class Ordem(BaseModel):
    coluna: str
    desc: bool = False


class Pedido(BaseModel):
    fonte: str
    colunas: list[str] = Field(default_factory=list, max_length=80)
    filtros: list[Filtro] = Field(default_factory=list, max_length=40)
    grafico: Grafico = Field(default_factory=Grafico)
    ordenar: list[Ordem] = Field(default_factory=list, max_length=5)


# ------------------------------------------------------------------------------------------------ datas relativas
def _inicio_mes(d: date) -> date:
    return d.replace(day=1)


def _fim_mes(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def periodo_relativo(rel: str, hoje: date | None = None) -> tuple[date | None, date | None]:
    h = hoje or date.today()
    seg = h - timedelta(days=h.weekday())
    mp = _inicio_mes(h) - timedelta(days=1)
    tabela = {
        "hoje": (h, h),
        "esta_semana": (seg, seg + timedelta(days=6)),
        "proxima_semana": (seg + timedelta(days=7), seg + timedelta(days=13)),
        "este_mes": (_inicio_mes(h), _fim_mes(h)),
        "mes_passado": (_inicio_mes(mp), mp),
        "proximo_mes": (_fim_mes(h) + timedelta(days=1), _fim_mes(_fim_mes(h) + timedelta(days=1))),
        "este_ano": (date(h.year, 1, 1), date(h.year, 12, 31)),
        "ano_passado": (date(h.year - 1, 1, 1), date(h.year - 1, 12, 31)),
        "ultimos_7": (h - timedelta(days=6), h),
        "ultimos_30": (h - timedelta(days=29), h),
        "ultimos_90": (h - timedelta(days=89), h),
        "ultimos_12m": (date(h.year - (h.month < 12), h.month % 12 + 1, 1), h),  # 12 meses cheios até este
        "proximos_7": (h, h + timedelta(days=6)),
        "proximos_30": (h, h + timedelta(days=29)),
        "hoje_em_diante": (h, None),
        "ate_hoje": (None, h),
        "atrasadas": (None, h - timedelta(days=1)),
    }
    if rel not in tabela:
        raise HTTPException(400, f"Período desconhecido: {rel}")
    return tabela[rel]


def _faixa(f: Filtro) -> tuple[date | None, date | None]:
    if f.relativo:
        return periodo_relativo(f.relativo)
    return f.de, f.ate


# ------------------------------------------------------------------------------------------------ comparação
def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def exibido(v: Any, tipo: str) -> str:
    """Como o valor aparece nos filtros de lista e nas categorias do gráfico."""
    if v is None or v == "":
        return VAZIO
    if tipo == "bool":
        return "Sim" if v else "Não"
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _passa(row: dict, f: Filtro, c: Coluna) -> bool:
    v = row.get(c.id)
    if c.tipo == "data":
        de, ate = _faixa(f)
        if de is None and ate is None:
            ok = True
        else:
            ok = v is not None and (de is None or v >= de) and (ate is None or v <= ate)
    elif c.tipo in NUMERICOS and (f.min is not None or f.max is not None):
        ok = v is not None and (f.min is None or v >= f.min) and (f.max is None or v <= f.max)
    elif f.contem:
        ok = v is not None and _sem_acento(f.contem) in _sem_acento(str(v))
    elif f.valores is not None:
        ok = exibido(v, c.tipo) in set(f.valores)
    else:
        return True
    return not ok if f.negar else ok


# ------------------------------------------------------------------------------------------------ agrupamento
def _chave_data(d: date, g: str) -> tuple[str, str, date, date]:
    """(chave ordenável, rótulo, de, até) do período que contém a data."""
    if g == "dia":
        return d.isoformat(), d.strftime("%d/%m/%y"), d, d
    if g == "semana":
        s = d - timedelta(days=d.weekday())
        return s.isoformat(), f"sem. {s:%d/%m/%y}", s, s + timedelta(days=6)
    if g == "trimestre":
        t = (d.month - 1) // 3
        ini = date(d.year, t * 3 + 1, 1)
        return f"{d.year}-T{t + 1}", f"{t + 1}º tri/{d.year % 100:02d}", ini, _fim_mes(date(d.year, t * 3 + 3, 1))
    if g == "ano":
        return str(d.year), str(d.year), date(d.year, 1, 1), date(d.year, 12, 31)
    if g == "dia_semana":
        return str(d.weekday()), DIAS_SEMANA[d.weekday()], d, d
    ini = _inicio_mes(d)
    return ini.strftime("%Y-%m"), f"{MESES[d.month - 1]}/{d.year % 100:02d}", ini, _fim_mes(d)


def _proximo(d: date, g: str) -> date:
    if g == "dia":
        return d + timedelta(days=1)
    if g == "semana":
        return d + timedelta(days=7)
    if g == "ano":
        return date(d.year + 1, 1, 1)
    meses = 3 if g == "trimestre" else 1
    m = d.month - 1 + meses
    return date(d.year + m // 12, m % 12 + 1, 1)


class _Acum:
    __slots__ = ("soma", "n", "mx", "mn")

    def __init__(self):
        self.soma, self.n, self.mx, self.mn = 0.0, 0, None, None

    def add(self, v: float | None, contar: bool):
        if contar:
            self.soma += 1
            self.n += 1
            return
        if v is None:
            return
        self.soma += v
        self.n += 1
        self.mx = v if self.mx is None else max(self.mx, v)
        self.mn = v if self.mn is None else min(self.mn, v)

    def juntar(self, o: _Acum):
        self.soma += o.soma
        self.n += o.n
        for a in ("mx", "mn"):
            x, y = getattr(self, a), getattr(o, a)
            setattr(self, a, y if x is None else x if y is None else (max(x, y) if a == "mx" else min(x, y)))

    def valor(self, ag: str, contar: bool) -> float:
        if contar or ag == "soma":
            return round(self.soma, 2)
        if ag == "media":
            return round(self.soma / self.n, 2) if self.n else 0.0
        v = self.mx if ag == "max" else self.mn
        return round(v, 2) if v is not None else 0.0


def agrupar(rows: list[dict], g: Grafico, cols: dict[str, Coluna]) -> dict | None:
    dim = cols.get(g.dimensao or "")
    if g.tipo == "nenhum" or dim is None:
        return None
    contar = g.medida == "_contagem" or g.medida not in cols or cols[g.medida].tipo not in NUMERICOS
    med = None if contar else cols[g.medida]
    serie = cols.get(g.serie or "") if g.tipo != "rosca" else None
    if serie is not None and serie.id == dim.id:
        serie = None
    eh_data = dim.tipo == "data"
    gran = g.granularidade or "mes"
    limite = min(g.limite, MAX_SERIES) if g.tipo == "rosca" else g.limite  # a rosca tem uma cor por fatia

    cats: dict[str, dict] = {}
    for r in rows:
        v = r.get(dim.id)
        if eh_data:
            if v is None:
                chave, rotulo, de, ate = "~", "Sem data", None, None
            else:
                chave, rotulo, de, ate = _chave_data(v, gran)
            cat = cats.setdefault(chave, {"chave": chave, "rotulo": rotulo, "de": de, "ate": ate, "partes": {}, "acum": _Acum()})
        else:
            rot = exibido(v, dim.tipo)
            cat = cats.setdefault(rot, {"chave": rot, "rotulo": rot, "valor": rot, "partes": {}, "acum": _Acum()})
        x = None if contar else r.get(med.id)
        cat["acum"].add(x, contar)
        if serie is not None:
            s = exibido(r.get(serie.id), serie.tipo)
            cat["partes"].setdefault(s, _Acum()).add(x, contar)

    lista = list(cats.values())
    outros = 0
    if eh_data:
        lista.sort(key=lambda c: (c["chave"] == "~", int(c["chave"]) if gran == "dia_semana" and c["chave"] != "~" else c["chave"]))
        # completa os períodos vazios (linha do tempo contínua)
        datas = [c for c in lista if c["de"] is not None]
        if datas and gran in ("mes", "trimestre", "ano", "semana", "dia"):
            ini, fim = datas[0]["de"], datas[-1]["de"]
            limite_pontos = {"dia": 120, "semana": 160}.get(gran, 400)
            cheio, d = [], ini
            existentes = {c["chave"]: c for c in datas}
            while d <= fim and len(cheio) <= limite_pontos:
                k, rot, de, ate = _chave_data(d, gran)
                cheio.append(existentes.get(k) or {"chave": k, "rotulo": rot, "de": de, "ate": ate, "partes": {}, "acum": _Acum()})
                d = _proximo(de, gran)
            if len(cheio) <= limite_pontos:
                lista = cheio + [c for c in lista if c["de"] is None]
    else:
        lista.sort(key=lambda c: (-c["acum"].valor(g.agregacao, contar), c["rotulo"]))
        if len(lista) > limite:
            resto = lista[limite - 1:]
            lista = lista[:limite - 1]
            outros = len(resto)
            o = {"chave": "__outros__", "rotulo": f"Outros ({outros})", "partes": {}, "acum": _Acum()}
            for c in resto:
                o["acum"].juntar(c["acum"])
                for s, a in c["partes"].items():
                    o["partes"].setdefault(s, _Acum()).juntar(a)
            lista.append(o)

    series: list[str] = []
    if serie is not None:
        tot: dict[str, _Acum] = {}
        for c in lista:
            for s, a in c["partes"].items():
                tot.setdefault(s, _Acum()).juntar(a)
        ordem = sorted(tot, key=lambda s: -tot[s].valor(g.agregacao, contar))
        series = ordem[:MAX_SERIES - 1] if len(ordem) > MAX_SERIES else ordem
        if len(ordem) > MAX_SERIES:
            for c in lista:
                o = _Acum()
                for s in ordem[MAX_SERIES - 1:]:
                    if s in c["partes"]:
                        o.juntar(c["partes"].pop(s))
                if o.n:
                    c["partes"]["Outros"] = o
            series.append("Outros")

    def _saida(c: dict) -> dict:
        d = {"chave": c["chave"], "rotulo": c["rotulo"], "total": c["acum"].valor(g.agregacao, contar),
             "qtd": c["acum"].n if contar else None,
             "valores": {s: a.valor(g.agregacao, contar) for s, a in c["partes"].items()}}
        if eh_data:
            d["de"] = c["de"].isoformat() if c.get("de") else None
            d["ate"] = c["ate"].isoformat() if c.get("ate") else None
        elif c["chave"] != "__outros__":
            d["valor"] = c["valor"]
        return d

    total = _Acum()
    for c in lista:
        total.juntar(c["acum"])
    return {
        "tipo": g.tipo, "dimensao": dim.meta(), "granularidade": gran if eh_data else None,
        "serie": serie.meta() if serie else None,
        "medida": {"id": "_contagem", "rotulo": "Quantidade", "tipo": "numero"} if contar else med.meta(),
        "agregacao": "contagem" if contar else g.agregacao,
        "categorias": [_saida(c) for c in lista], "series": series, "outros": outros,
        "total": total.valor(g.agregacao, contar),
    }


# ------------------------------------------------------------------------------------------------ execução
def _json(v: Any) -> Any:
    return v.isoformat() if isinstance(v, date) else v


def _ordenar(rows: list[dict], ordens: list[Ordem], cols: dict[str, Coluna]) -> None:
    for o in reversed([o for o in ordens if o.coluna in cols]):
        t = cols[o.coluna].tipo
        presentes = [r for r in rows if r.get(o.coluna) is not None]
        vazios = [r for r in rows if r.get(o.coluna) is None]

        def chave(r, _c=o.coluna, _t=t):
            v = r[_c]
            return _sem_acento(str(v)) if _t in ("texto", "longo", "lista") else v

        presentes.sort(key=chave, reverse=o.desc)
        rows[:] = presentes + vazios  # vazio sempre no fim


def fonte_ou_404(ctx, nome: str) -> Fonte:
    f = FONTES.get(nome)
    if f is None or not ctx.pode(f.permissao):
        raise HTTPException(404, "Relatório não disponível para o seu perfil.")
    return f


def filtrar(ctx, p: Pedido) -> tuple[Fonte, dict[str, Coluna], list[dict]]:
    fonte = fonte_ou_404(ctx, p.fonte)
    cols = {c.id: c for c in fonte.colunas(ctx)}
    filtros = [f for f in p.filtros if f.coluna in cols]
    # o período da data principal vai para o banco (menos linhas); os demais filtros são aplicados aqui
    de = ate = None
    for f in filtros:
        if f.coluna == fonte.data_principal and not f.negar:
            de, ate = _faixa(f)
            break
    rows = fonte.carregar(ctx, de, ate)
    for f in filtros:
        c = cols[f.coluna]
        rows = [r for r in rows if _passa(r, f, c)]
    return fonte, cols, rows


def executar(ctx, p: Pedido, limite_linhas: int | None = 2000) -> dict:
    fonte, cols, rows = filtrar(ctx, p)
    escolhidas = [cols[c] for c in p.colunas if c in cols] or [c for c in cols.values() if c.padrao]
    _ordenar(rows, p.ordenar, cols)
    totais = {}
    for c in escolhidas:
        if c.tipo in NUMERICOS and c.somar:
            vals = [r[c.id] for r in rows if r.get(c.id) is not None]
            totais[c.id] = {"soma": round(sum(vals), 2), "media": round(sum(vals) / len(vals), 2) if vals else None}
    mostrar = rows if limite_linhas is None else rows[:limite_linhas]
    return {
        "fonte": fonte.id, "rotulo_contagem": fonte.rotulo_contagem,
        "colunas": [c.meta() for c in escolhidas],
        "linhas": [[_json(r.get(c.id)) for c in escolhidas] for r in mostrar],
        "total_linhas": len(rows), "truncado": len(mostrar) < len(rows),
        "totais": totais,
        "grafico": agrupar(rows, p.grafico, cols),
        "_rows": rows, "_cols": escolhidas,
    }


def valores_distintos(ctx, fonte_id: str, coluna: str, limite: int = 500) -> list[dict]:
    fonte = fonte_ou_404(ctx, fonte_id)
    cols = {c.id: c for c in fonte.colunas(ctx)}
    c = cols.get(coluna)
    if c is None:
        raise HTTPException(404, "Coluna desconhecida.")
    cont: dict[str, int] = {}
    for r in fonte.carregar(ctx):
        k = exibido(r.get(coluna), c.tipo)
        cont[k] = cont.get(k, 0) + 1
    ordem = sorted(cont, key=lambda k: (k == VAZIO, _sem_acento(k)))
    return [{"valor": k, "qtd": cont[k]} for k in ordem[:limite]]
