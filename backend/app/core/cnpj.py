"""Consulta pública de CNPJ (Receita Federal) para preencher cadastros sozinho.

Mesmo caminho do Flicsales: BrasilAPI v1 (gratuita, sem chave). Se ela falhar, tenta o minhareceita.org,
que devolve os mesmos campos. Resultado em cache por 24h para não repetir consultas.
"""

import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from app.core.deps import Ctx
from app.core.documentos import cnpj_valido, so_digitos

FONTES = ["https://brasilapi.com.br/api/cnpj/v1/{cnpj}", "https://minhareceita.org/{cnpj}"]
_cache: dict[str, tuple[float, dict]] = {}
CACHE_SEG = 24 * 3600

router = APIRouter(prefix="/cadastros", tags=["cadastros"])


class CnpjNaoEncontrado(Exception):
    pass


def _consultar(cnpj: str) -> dict[str, Any]:
    erro = None
    for url in FONTES:
        try:
            r = httpx.get(url.format(cnpj=cnpj), timeout=10, headers={"User-Agent": "MayaCorp-Automacoes/1.0"})
        except httpx.HTTPError as e:
            erro = e
            continue
        if r.status_code == 404:
            raise CnpjNaoEncontrado
        if r.status_code == 200:
            return r.json()
        erro = RuntimeError(f"HTTP {r.status_code}")
    raise RuntimeError(f"Consulta de CNPJ indisponível ({erro})")


def _titulo(txt: str | None) -> str | None:
    """RUA DAS FLORES → Rua das Flores (mantém siglas curtas e preposições minúsculas)."""
    if not txt:
        return None
    minusc = {"da", "das", "de", "do", "dos", "e"}
    return " ".join(p.lower() if p.lower() in minusc else (p if len(p) <= 2 and p.isupper() else p.capitalize())
                    for p in txt.strip().split())


def normalizar(d: dict[str, Any]) -> dict[str, Any]:
    tel = so_digitos(d.get("ddd_telefone_1") or "")
    situacao = (d.get("descricao_situacao_cadastral") or "").upper() or None
    logradouro = " ".join(x for x in [d.get("descricao_tipo_de_logradouro"), d.get("logradouro")] if x)
    return {
        "cnpj": so_digitos(d.get("cnpj")),
        # MEI: a Receita põe a raiz do CNPJ na frente do nome ("37.552.605 FULANO DE TAL")
        "razao_social": re.sub(r"^\d{2}\.?\d{3}\.?\d{3}\s+", "", d.get("razao_social") or "") or None,
        "nome_fantasia": d.get("nome_fantasia") or None,
        "situacao": situacao,
        "ativa": situacao == "ATIVA",
        "logradouro": _titulo(logradouro),
        "numero": (d.get("numero") or "").strip() or None,
        "complemento": _titulo(d.get("complemento")) or None,
        "bairro": _titulo(d.get("bairro")),
        "cidade": _titulo(d.get("municipio")),
        "uf": (d.get("uf") or "").upper() or None,
        "cep": so_digitos(d.get("cep")) or None,
        "telefone": (f"({tel[:2]}) {tel[2:-4]}-{tel[-4:]}" if len(tel) >= 10 else None),
        "email": (d.get("email") or "").lower() or None,
        "abertura": d.get("data_inicio_atividade"),
        "atividade_principal": d.get("cnae_fiscal_descricao"),
        "natureza_juridica": d.get("natureza_juridica"),
    }


def buscar(cnpj: str) -> dict[str, Any]:
    c = so_digitos(cnpj)
    if not cnpj_valido(c):
        raise ValueError("CNPJ inválido.")
    agora = time.time()
    if c in _cache and agora - _cache[c][0] < CACHE_SEG:
        return _cache[c][1]
    dados = normalizar(_consultar(c))
    _cache[c] = (agora, dados)
    return dados


@router.get("/cnpj/{cnpj}")
def consultar_cnpj(cnpj: str, ctx: Ctx):
    try:
        return buscar(cnpj)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except CnpjNaoEncontrado:
        raise HTTPException(404, "CNPJ não encontrado na Receita Federal.") from None
    except RuntimeError:
        raise HTTPException(503, "A consulta à Receita está fora do ar agora. Preencha manualmente ou tente de novo.") from None
