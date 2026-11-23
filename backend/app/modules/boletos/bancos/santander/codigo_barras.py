"""Código de barras (44 posições) e linha digitável (47) do boleto Santander.

Campo livre (posições 20-44), conforme o manual "Código de Barras Santander" v3.6 (abril/2025):
    9 · código do beneficiário (7) · nosso número com DV (13) · 0 (IOF) · carteira (3)
"""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

BANCO = "033"
MOEDA = "9"

# O fator de vencimento chegou a 9999 em 21/02/2025 e recomeçou em 1000 em 22/02/2025 (regra FEBRABAN).
BASE_ANTIGA = date(1997, 10, 7)  # fator 0 do primeiro ciclo (03/07/2000 = 1000)
BASE_NOVA = date(2025, 2, 22)  # fator 1000 do segundo ciclo
ULTIMO_DIA = BASE_NOVA + timedelta(days=8999)  # fator 9999 do segundo ciclo


def fator_vencimento(vencimento: date) -> int:
    if vencimento >= BASE_NOVA:
        if vencimento > ULTIMO_DIA:
            raise ValueError(f"Vencimento {vencimento:%d/%m/%Y} além do limite do fator de vencimento.")
        return 1000 + (vencimento - BASE_NOVA).days
    fator = (vencimento - BASE_ANTIGA).days
    if fator < 1000:
        raise ValueError(f"Vencimento {vencimento:%d/%m/%Y} anterior ao início do fator de vencimento.")
    return fator


def dv_modulo10(numero: str) -> int:
    """Pesos 2, 1, 2, 1… da direita para a esquerda; produto maior que 9 soma os dígitos."""
    soma, peso = 0, 2
    for digito in reversed(numero):
        produto = int(digito) * peso
        soma += produto // 10 + produto % 10
        peso = 1 if peso == 2 else 2
    return (10 - soma % 10) % 10


def dv_geral(codigo_sem_dv: str) -> int:
    """Módulo 11 (pesos 2 a 9) sobre as 43 posições; resultado 0, 10 ou 11 vira 1."""
    if len(codigo_sem_dv) != 43 or not codigo_sem_dv.isdigit():
        raise ValueError("O DV geral é calculado sobre 43 dígitos.")
    soma, peso = 0, 2
    for digito in reversed(codigo_sem_dv):
        soma += int(digito) * peso
        peso = 2 if peso == 9 else peso + 1
    dv = 11 - soma % 11
    return 1 if dv in (0, 10, 11) else dv


def campo_livre(codigo_beneficiario: str, nosso_numero: str, carteira: str) -> str:
    cod, nn, cart = str(codigo_beneficiario).strip(), str(nosso_numero).strip(), str(carteira).strip()
    if not cod.isdigit() or len(cod) > 7:
        raise ValueError("O código do beneficiário tem até 7 dígitos.")
    if not nn.isdigit() or len(nn) != 13:
        raise ValueError("O nosso número tem 13 dígitos (com o DV).")
    if not cart.isdigit() or len(cart) != 3:
        raise ValueError("A carteira tem 3 dígitos (ex.: 101).")
    return f"9{cod.zfill(7)}{nn}0{cart}"


def codigo_barras(*, codigo_beneficiario: str, nosso_numero: str, carteira: str, vencimento: date, valor: Decimal) -> str:
    centavos = int((Decimal(valor) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    if centavos <= 0:
        raise ValueError("O valor do boleto precisa ser maior que zero.")
    if centavos > 9_999_999_999:
        raise ValueError("O valor do boleto não cabe no código de barras (máximo R$ 99.999.999,99).")
    livre = campo_livre(codigo_beneficiario, nosso_numero, carteira)
    resto = f"{fator_vencimento(vencimento):04d}{centavos:010d}{livre}"
    return f"{BANCO}{MOEDA}{dv_geral(BANCO + MOEDA + resto)}{resto}"


def linha_digitavel(barras: str) -> str:
    """Os 5 campos padrão FEBRABAN, sem pontuação (47 dígitos)."""
    if len(barras) != 44 or not barras.isdigit():
        raise ValueError("O código de barras tem 44 dígitos.")
    c1 = barras[0:4] + barras[19:24]
    c2 = barras[24:34]
    c3 = barras[34:44]
    return f"{c1}{dv_modulo10(c1)}{c2}{dv_modulo10(c2)}{c3}{dv_modulo10(c3)}{barras[4]}{barras[5:19]}"


def formatar_linha(linha: str) -> str:
    """XXXXX.XXXXX XXXXX.XXXXXX XXXXX.XXXXXX X XXXXXXXXXXXXXX"""
    if len(linha) != 47:
        return linha
    return (f"{linha[0:5]}.{linha[5:10]} {linha[10:15]}.{linha[15:21]} {linha[21:26]}.{linha[26:32]} "
            f"{linha[32]} {linha[33:47]}")


def conferir(barras: str) -> bool:
    return len(barras) == 44 and barras.isdigit() and dv_geral(barras[:4] + barras[5:]) == int(barras[4])
