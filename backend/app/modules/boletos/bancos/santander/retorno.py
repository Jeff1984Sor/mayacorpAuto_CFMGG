"""Lê o arquivo de retorno (.RET) do Santander: um par de Segmentos T + U por ocorrência."""

from app.modules.boletos.bancos import retorno_comum
from app.modules.boletos.bancos.base import RetornoLido
from app.modules.boletos.bancos.santander import codigos as cod
from app.modules.boletos.bancos.santander import layout as L


def ler_retorno(conteudo: bytes) -> RetornoLido:
    return retorno_comum.ler_retorno(
        conteudo, banco=L.BANCO, nome_banco="Santander", seg_t=L.SegmentoT, seg_u=L.SegmentoU,
        nosso_numero=lambda t: f"{t['nosso_numero']:013d}" if t["nosso_numero"] else "",
        descrever_movimento=cod.descrever_movimento_retorno, separar_motivos=cod.separar_motivos,
        descrever_motivos=cod.descrever_motivos,
        agencia_conta=lambda linha_t: (linha_t[17:21], linha_t[22:31]),
    )
