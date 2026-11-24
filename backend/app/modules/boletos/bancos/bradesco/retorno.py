"""Lê o arquivo de retorno (.RET) do Bradesco: um par de Segmentos T + U por ocorrência."""

from app.modules.boletos.bancos import retorno_comum
from app.modules.boletos.bancos.base import RetornoLido
from app.modules.boletos.bancos.bradesco import codigos as cod
from app.modules.boletos.bancos.bradesco import layout as L


def nosso_numero_do_t(t: dict) -> str:
    """T 38-57 = carteira (3) + zeros (5) + número (11) + DV (1). Devolve número + DV (12), como guardamos."""
    bruto = (t["nosso_numero"] or "").strip().upper().rjust(20, "0")
    numero, dv = bruto[8:19], bruto[19:20]
    return f"{numero}{dv}" if numero.isdigit() and int(numero) else ""


def ler_retorno(conteudo: bytes) -> RetornoLido:
    return retorno_comum.ler_retorno(
        conteudo, banco=L.BANCO, nome_banco="Bradesco", seg_t=L.SegmentoT, seg_u=L.SegmentoU,
        nosso_numero=nosso_numero_do_t, descrever_movimento=cod.descrever_movimento_retorno,
        separar_motivos=cod.separar_motivos, descrever_motivos=cod.descrever_motivos,
        # agência: os 4 últimos dos 5 dígitos; conta: os 9 últimos dos 12
        agencia_conta=lambda linha_t: (linha_t[18:22], linha_t[26:35]),
    )
