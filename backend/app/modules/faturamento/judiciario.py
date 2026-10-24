"""Tribunais do país, comarcas (municípios da área do tribunal) e sugestões de varas para a ficha do caso judicial.

Tribunais e jurisdições são fixos (CNJ). Não existe base pública completa das varas de cada comarca, então as varas
sugeridas são as já cadastradas naquela comarca + modelos comuns do ramo (o campo continua livre).
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from app.core.deps import Ctx
from app.modules.faturamento.models import Caso

router = APIRouter(prefix="/faturamento/judiciario", tags=["Faturamento · Judiciário"])

UF_NOME = {"AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal e Territórios",
           "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
           "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
           "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins"}

ESTADUAIS = [{"sigla": f"TJ{uf}" if uf != "DF" else "TJDFT", "nome": f"Tribunal de Justiça · {nome}", "ufs": [uf]}
             for uf, nome in UF_NOME.items()]
FEDERAIS = [
    {"sigla": "TRF1", "nome": "Tribunal Regional Federal da 1ª Região", "ufs": ["AC", "AM", "AP", "BA", "DF", "GO", "MA", "MT", "PA", "PI", "RO", "RR", "TO"]},
    {"sigla": "TRF2", "nome": "Tribunal Regional Federal da 2ª Região", "ufs": ["RJ", "ES"]},
    {"sigla": "TRF3", "nome": "Tribunal Regional Federal da 3ª Região", "ufs": ["SP", "MS"]},
    {"sigla": "TRF4", "nome": "Tribunal Regional Federal da 4ª Região", "ufs": ["RS", "PR", "SC"]},
    {"sigla": "TRF5", "nome": "Tribunal Regional Federal da 5ª Região", "ufs": ["PE", "AL", "CE", "PB", "RN", "SE"]},
    {"sigla": "TRF6", "nome": "Tribunal Regional Federal da 6ª Região", "ufs": ["MG"]},
]
TRABALHISTAS = [{"sigla": f"TRT{n}", "nome": f"Tribunal Regional do Trabalho da {n}ª Região" + (f" ({rot})" if rot else ""), "ufs": ufs}
                for n, ufs, rot in [
                    (1, ["RJ"], ""), (2, ["SP"], "São Paulo capital, Grande SP e Baixada Santista"), (3, ["MG"], ""), (4, ["RS"], ""),
                    (5, ["BA"], ""), (6, ["PE"], ""), (7, ["CE"], ""), (8, ["PA", "AP"], ""), (9, ["PR"], ""), (10, ["DF", "TO"], ""),
                    (11, ["AM", "RR"], ""), (12, ["SC"], ""), (13, ["PB"], ""), (14, ["RO", "AC"], ""), (15, ["SP"], "Campinas e interior de SP"),
                    (16, ["MA"], ""), (17, ["ES"], ""), (18, ["GO"], ""), (19, ["AL"], ""), (20, ["SE"], ""), (21, ["RN"], ""), (22, ["PI"], ""),
                    (23, ["MT"], ""), (24, ["MS"], "")]]
SUPERIORES = [
    {"sigla": "STF", "nome": "Supremo Tribunal Federal", "ufs": ["DF"]},
    {"sigla": "STJ", "nome": "Superior Tribunal de Justiça", "ufs": ["DF"]},
    {"sigla": "TST", "nome": "Tribunal Superior do Trabalho", "ufs": ["DF"]},
    {"sigla": "TSE", "nome": "Tribunal Superior Eleitoral", "ufs": ["DF"]},
    {"sigla": "STM", "nome": "Superior Tribunal Militar", "ufs": ["DF"]},
]
POR_TIPO = {"judicial_estadual": ESTADUAIS, "judicial_federal": FEDERAIS, "judicial_trabalhista": TRABALHISTAS}
TODOS = {t["sigla"]: t for t in [*ESTADUAIS, *FEDERAIS, *TRABALHISTAS, *SUPERIORES]}

VARAS_MODELO = {
    "judicial_estadual": ["Vara Cível", "Vara da Família e Sucessões", "Vara Criminal", "Vara da Fazenda Pública", "Vara de Execuções Fiscais",
                          "Vara Empresarial", "Vara de Falências e Recuperações Judiciais", "Vara do Juizado Especial Cível",
                          "Juizado Especial da Fazenda Pública", "Vara da Infância e Juventude", "Vara de Registros Públicos", "Vara Única"],
    "judicial_federal": ["Vara Federal", "Vara Federal Cível", "Vara Federal Previdenciária", "Vara de Execuções Fiscais Federal",
                         "Juizado Especial Federal", "Vara Federal Criminal", "Vara Federal Ambiental e Agrária"],
    "judicial_trabalhista": ["Vara do Trabalho"],
}
INSTANCIAS = {"primeira": "1ª instância", "juizado": "Juizado Especial", "segunda": "2ª instância (Tribunal)",
              "turma_recursal": "Turma Recursal", "superior": "Tribunal Superior", "stf": "STF"}

_MUNICIPIOS: dict[str, list[str]] | None = None


def _municipios() -> dict[str, list[str]]:
    global _MUNICIPIOS
    if _MUNICIPIOS is None:
        _MUNICIPIOS = json.loads((Path(__file__).resolve().parents[2] / "core" / "dados" / "municipios.json").read_text(encoding="utf-8"))
    return _MUNICIPIOS


@router.get("/tribunais")
def tribunais(ctx: Ctx, tipo: str | None = None, instancia: str | None = None):
    """Tribunais do ramo do caso; na instância superior, os tribunais superiores."""
    if instancia in ("superior", "stf"):
        return SUPERIORES
    return POR_TIPO.get(tipo or "", [*ESTADUAIS, *FEDERAIS, *TRABALHISTAS])


@router.get("/comarcas", response_model=list[str])
def comarcas(ctx: Ctx, tribunal: str = Query(min_length=2)):
    """Municípios da área do tribunal (comarcas / subseções / jurisdições)."""
    t = TODOS.get(tribunal.strip().upper())
    if not t:
        raise HTTPException(404, "Tribunal não encontrado.")
    mun = _municipios()
    if len(t["ufs"]) == 1:
        return mun.get(t["ufs"][0], [])
    return sorted({f"{c} ({uf})" for uf in t["ufs"] for c in mun.get(uf, [])}, key=str.lower)


@router.get("/varas", response_model=list[str])
def varas(ctx: Ctx, tribunal: str | None = None, comarca: str | None = None, tipo: str | None = None):
    """Varas já usadas nesta comarca (mais usadas primeiro) + modelos comuns do ramo."""
    q = select(Caso.vara, func.count()).where(Caso.tenant_id == ctx.tenant_id, Caso.vara.is_not(None), Caso.vara != "")
    if tribunal:
        q = q.where(func.upper(Caso.tribunal) == tribunal.strip().upper())
    if comarca:
        q = q.where(func.lower(Caso.comarca) == comarca.strip().lower())
    usadas = [v for v, _ in ctx.db.execute(q.group_by(Caso.vara).order_by(func.count().desc()).limit(50)).all()]
    if not tipo and tribunal:
        tipo = next((k for k, lista in POR_TIPO.items() if any(t["sigla"] == tribunal.upper() for t in lista)), None)
    modelos = VARAS_MODELO.get(tipo or "", [])
    numeradas = [f"{n}ª {m}" for m in modelos[:3] for n in range(1, 6)] if tipo != "judicial_trabalhista" else [f"{n}ª Vara do Trabalho" for n in range(1, 21)]
    return list(dict.fromkeys([*usadas, *numeradas, *modelos]))


@router.get("/instancias")
def instancias(ctx: Ctx):
    return [{"valor": k, "rotulo": v} for k, v in INSTANCIAS.items()]
