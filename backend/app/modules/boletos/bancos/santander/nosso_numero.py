"""Nosso número do Santander: 12 dígitos + DV (módulo 11, pesos 2 a 9 da direita para a esquerda)."""

TAMANHO_BASE = 12


def dv_modulo11(base: str) -> int:
    """DV = 11 − (soma mod 11); 10 vira 1; 11 (ou 0) vira 0. Exemplo do manual: 3147578 → 7."""
    if not base.isdigit():
        raise ValueError(f"Nosso número '{base}' não é numérico.")
    soma, peso = 0, 2
    for digito in reversed(base):
        soma += int(digito) * peso
        peso = 2 if peso == 9 else peso + 1
    dv = 11 - soma % 11
    if dv == 10:
        return 1
    if dv in (0, 11):
        return 0
    return dv


def montar(sequencial: int) -> str:
    """Sequencial do convênio → nosso número de 13 posições (12 da base + DV), como vai no Segmento P."""
    if sequencial < 1:
        raise ValueError("O sequencial do nosso número começa em 1.")
    base = str(sequencial)
    if len(base) > TAMANHO_BASE:
        raise ValueError(f"Sequencial {sequencial} não cabe em {TAMANHO_BASE} dígitos.")
    base = base.zfill(TAMANHO_BASE)
    return f"{base}{dv_modulo11(base)}"


def valido(nosso_numero: str) -> bool:
    n = (nosso_numero or "").strip()
    return len(n) == TAMANHO_BASE + 1 and n.isdigit() and dv_modulo11(n[:-1]) == int(n[-1])
