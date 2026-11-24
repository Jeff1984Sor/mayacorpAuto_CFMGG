"""Nosso número do Bradesco: 11 dígitos + DV (módulo 11, base 7, calculado sobre carteira + número).

Resto 0 → DV 0; resto 1 → DV "P"; nos demais, 11 − resto. Guardamos "número + DV" (12 posições).
"""

TAMANHO = 11


def dv(carteira: str, numero: str) -> str:
    base = f"{str(carteira).strip().zfill(2)[-2:]}{numero}"
    if not base.isdigit():
        raise ValueError(f"Carteira/nosso número '{base}' não é numérico.")
    soma, peso = 0, 2
    for digito in reversed(base):
        soma += int(digito) * peso
        peso = 2 if peso == 7 else peso + 1
    resto = soma % 11
    if resto == 0:
        return "0"
    if resto == 1:
        return "P"
    return str(11 - resto)


def montar(sequencial: int, carteira: str) -> str:
    """Sequencial do convênio → nosso número com DV (12 posições)."""
    if sequencial < 1:
        raise ValueError("O sequencial do nosso número começa em 1.")
    numero = str(sequencial)
    if len(numero) > TAMANHO:
        raise ValueError(f"Sequencial {sequencial} não cabe em {TAMANHO} dígitos.")
    numero = numero.zfill(TAMANHO)
    return f"{numero}{dv(carteira, numero)}"


def valido(nosso_numero: str, carteira: str) -> bool:
    n = (nosso_numero or "").strip().upper()
    return len(n) == TAMANHO + 1 and n[:-1].isdigit() and dv(carteira, n[:-1]) == n[-1]
