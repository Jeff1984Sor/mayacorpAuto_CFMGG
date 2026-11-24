"""Código de barras do boleto Bradesco. Campo livre (posições 20-44):

    agência (4) · carteira (2) · nosso número sem DV (11) · conta (7) · 0

O fator de vencimento, os dígitos e a linha digitável são os do padrão FEBRABAN (os mesmos de qualquer banco).
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.modules.boletos.bancos.santander.codigo_barras import (
    MOEDA,
    conferir,
    dv_geral,
    fator_vencimento,
    formatar_linha,
    linha_digitavel,
)

BANCO = "237"

__all__ = ["BANCO", "campo_livre", "codigo_barras", "conferir", "formatar_linha", "linha_digitavel"]


def campo_livre(agencia: str, carteira: str, nosso_numero: str, conta: str) -> str:
    ag, cart, conta = str(agencia).strip(), str(carteira).strip(), str(conta).strip()
    numero = (nosso_numero or "").strip()[:11]
    if not ag.isdigit() or len(ag) > 4:
        raise ValueError("A agência tem até 4 dígitos.")
    if not cart.isdigit() or len(cart) > 2:
        raise ValueError("A carteira do Bradesco tem 2 dígitos (ex.: 09).")
    if not numero.isdigit() or len(numero) != 11:
        raise ValueError("O nosso número tem 11 dígitos (mais o DV).")
    if not conta.isdigit() or len(conta) > 7:
        raise ValueError("A conta tem até 7 dígitos, sem o dígito verificador.")
    return f"{ag.zfill(4)}{cart.zfill(2)}{numero}{conta.zfill(7)}0"


def codigo_barras(*, agencia: str, carteira: str, nosso_numero: str, conta: str, vencimento: date, valor: Decimal) -> str:
    centavos = int((Decimal(valor) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    if centavos <= 0:
        raise ValueError("O valor do boleto precisa ser maior que zero.")
    if centavos > 9_999_999_999:
        raise ValueError("O valor do boleto não cabe no código de barras (máximo R$ 99.999.999,99).")
    resto = f"{fator_vencimento(vencimento):04d}{centavos:010d}{campo_livre(agencia, carteira, nosso_numero, conta)}"
    return f"{BANCO}{MOEDA}{dv_geral(BANCO + MOEDA + resto)}{resto}"
