"""Vínculo automático das partes do processo com os clientes do escritório (seção 9).

| 1 | CPF/CNPJ completo igual                          | vínculo automático            |
| 2 | CNPJ raiz (8 dígitos) igual                      | sugerido (filial/matriz)      |
| 3 | nome normalizado igual + documento parcial bate  | sugerido, confiança alta      |
| 4 | nome normalizado igual, sem documento            | sugerido, exige confirmação   |
| 5 | nome parecido (≥ limiar)                         | sugerido, confiança baixa     |
"""

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from difflib import SequenceMatcher

_SUFIXOS = {"LTDA", "SA", "S/A", "ME", "EPP", "EIRELI", "MEI", "SLU", "SS", "S/S", "CIA"}
_LIGACOES = {"DE", "DA", "DO", "DOS", "DAS", "E"}


def normalizar_nome(nome: str | None) -> str:
    """Maiúsculas, sem acento e pontuação, sem sufixo societário e sem DE/DA/DO/DOS/DAS."""
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode().upper()
    s = s.replace("S/A", " SA ").replace("S.A.", " SA ").replace("S/S", " SS ")
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    palavras = [p for p in s.split() if p not in _LIGACOES]
    while palavras and palavras[-1] in _SUFIXOS:
        palavras.pop()
    return " ".join(p for p in palavras if p not in {"LTDA", "EIRELI"})


@dataclass
class Sugestao:
    cliente_id: int
    criterio: str
    confianca: Decimal
    status: str  # automatico | sugerido


def _parcial_bate(parcial: str | None, completo: str | None) -> bool:
    """'***.456.789-**' ou '12.345.***/0001-**' contra o documento do cliente."""
    if not parcial or not completo:
        return False
    p = re.sub(r"[^0-9*xX]", "", parcial)
    if len(p) != len(completo) or not re.search(r"\d", p):
        return False
    return all(a in "*xX" or a == b for a, b in zip(p, completo, strict=True))


def casar(nome: str, documento: str | None, documento_parcial: str | None, clientes: list, limiar_fuzzy: int = 88,
          ) -> Sugestao | None:
    """Melhor cliente para uma parte. `clientes` são Tomador (id, nome, cpf_cnpj)."""
    doc = re.sub(r"\D", "", documento or "")
    alvo = normalizar_nome(nome)
    if doc:
        for c in clientes:
            if c.cpf_cnpj and c.cpf_cnpj == doc:
                return Sugestao(c.id, "cpf_cnpj", Decimal("1.000"), "automatico")
        if len(doc) == 14:
            for c in clientes:
                if c.cpf_cnpj and len(c.cpf_cnpj) == 14 and c.cpf_cnpj[:8] == doc[:8]:
                    return Sugestao(c.id, "cnpj_raiz", Decimal("0.850"), "sugerido")
    if not alvo:
        return None
    iguais = [c for c in clientes if normalizar_nome(c.nome) == alvo]
    for c in iguais:
        if _parcial_bate(documento_parcial, c.cpf_cnpj):
            return Sugestao(c.id, "nome_doc_parcial", Decimal("0.900"), "sugerido")
    if iguais and not doc:
        return Sugestao(iguais[0].id, "nome_exato", Decimal("0.700"), "sugerido")
    melhor, nota = None, 0.0
    for c in clientes:
        n = SequenceMatcher(None, alvo, normalizar_nome(c.nome)).ratio()
        if n > nota:
            melhor, nota = c, n
    if melhor and nota * 100 >= limiar_fuzzy and not doc:
        return Sugestao(melhor.id, "nome_fuzzy", Decimal(str(round(nota * 0.6, 3))), "sugerido")
    return None
