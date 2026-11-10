"""Título do caso montado pelo modelo do cliente (Cadastros › Clientes › aba Casos).

O modelo é um texto com campos entre chaves, ex.: "{Processo} - {Parte contrária} - {Sinistro}".
Vale o rótulo dos campos padrão (abaixo) ou o nome de um campo adicional (do cliente ou geral).
Campo vazio some junto com o separador que sobraria ("A -  - B" vira "A - B").
"""

import re
import unicodedata
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.faturamento.models import ROTULO_TIPO_CASO, CampoAdicional, Caso, Contrato

# chave interna → rótulo mostrado no botão (o rótulo é o que vai entre chaves no modelo)
PADRAO = {
    "numero": "Nº do caso",
    "processo": "Processo",
    "parte_contraria": "Parte contrária",
    "tipo": "Tipo",
    "area": "Área",
    "tribunal": "Tribunal",
    "vara": "Vara",
    "comarca": "Comarca",
    "valor_causa": "Valor da causa",
    "data_distribuicao": "Distribuição",
    "cliente": "Cliente",
    "contrato": "Contrato",
}
_TOKEN = re.compile(r"\{([^{}]{1,100})\}")
_SEP = "-–—|/·,;:"


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").replace("º", "").replace("ª", "").replace("°", "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _fmt(v) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, Decimal):
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if isinstance(v, date):
        return v.strftime("%d/%m/%Y")
    s = str(v).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):  # campo adicional do tipo data
        return f"{s[8:10]}/{s[5:7]}/{s[:4]}"
    return s


def valores_padrao(c: Caso, contrato: Contrato | None) -> dict[str, str]:
    contrato = contrato or c.contrato
    return {
        "numero": f"#{c.numero}" if c.numero else "",
        "processo": c.numero_processo or "",
        "parte_contraria": c.parte_contraria or "",
        "tipo": ROTULO_TIPO_CASO.get(c.tipo, "") if c.tipo else "",
        "area": c.area.nome if c.area else "",
        "tribunal": c.tribunal or "",
        "vara": c.vara or "",
        "comarca": c.comarca or "",
        "valor_causa": _fmt(c.valor_causa),
        "data_distribuicao": _fmt(c.data_distribuicao),
        "cliente": contrato.tomador.nome if contrato and contrato.tomador else "",
        "contrato": contrato.nome if contrato else "",
    }


def renderizar(modelo: str, padrao: dict[str, str], campos: list[CampoAdicional], valores: dict) -> str:
    por_nome: dict[str, str] = {}
    for chave, rotulo in PADRAO.items():
        por_nome[_norm(rotulo)] = padrao.get(chave, "")
        por_nome[_norm(chave)] = padrao.get(chave, "")
    # campo adicional do cliente vence o geral de mesmo nome (vem por último na lista)
    for cp in campos:
        por_nome[_norm(cp.nome)] = _fmt((valores or {}).get(str(cp.id)))

    texto = _TOKEN.sub(lambda m: por_nome.get(_norm(m.group(1)), ""), modelo or "")
    # limpa separadores que ficaram sem vizinho por causa de campo vazio
    sep = re.escape(_SEP)
    texto = re.sub(rf"\s*([{sep}])(\s*[{sep}])+\s*", r" \1 ", texto)
    texto = re.sub(r"\(\s*\)|\[\s*\]", "", texto)
    texto = re.sub(r"\s{2,}", " ", texto).strip(f" {_SEP}")
    return texto[:250]


def campos_do_caso(db: Session, tenant_id: int, tomador_id: int | None, area_id: int | None) -> list[CampoAdicional]:
    """Campos adicionais ativos que valem para um caso deste cliente e área (gerais primeiro, do cliente por último)."""
    lista = db.scalars(select(CampoAdicional).where(
        CampoAdicional.tenant_id == tenant_id, CampoAdicional.entidade == "caso", CampoAdicional.ativo)
        .order_by(CampoAdicional.ordem, CampoAdicional.id))
    ok = [cp for cp in lista if (not cp.area_id or cp.area_id == area_id)
          and (not cp.tomador_id or cp.tomador_id == tomador_id)]
    return sorted(ok, key=lambda cp: cp.tomador_id is not None)


def aplicar(db: Session, c: Caso) -> bool:
    """Se o cliente tem modelo, recalcula o título. Devolve True quando mudou."""
    contrato = c.contrato or db.get(Contrato, c.contrato_id)
    tomador = contrato.tomador if contrato else None
    modelo = (tomador.modelo_titulo_caso or "").strip() if tomador else ""
    if not modelo:
        return False
    campos = campos_do_caso(db, c.tenant_id, tomador.id, c.area_id)
    novo = renderizar(modelo, valores_padrao(c, contrato), campos, c.campos or {})
    if novo and novo != c.titulo:
        c.titulo = novo
        return True
    return False


def aplicar_no_cliente(db: Session, tenant_id: int, tomador_id: int) -> int:
    """Recalcula o título de todos os casos do cliente. Devolve quantos mudaram."""
    casos = db.scalars(select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(
        Caso.tenant_id == tenant_id, Contrato.tomador_id == tomador_id))
    return sum(1 for c in casos if aplicar(db, c))
