"""Tabelas de códigos do CNAB 240 do Bradesco (padrão FEBRABAN).

TODO [CONFIRMAR com o manual do Bradesco ou no teste de arquivo do banco]: tudo aqui é editável no convênio.
"""

from app.modules.boletos.bancos.santander.codigos import (  # códigos de movimento e motivos são do padrão FEBRABAN
    ALTERACAO_VENCIMENTO,
    ENTRADA,
    MOTIVOS_REJEICAO,
    MOVIMENTO_REMESSA,
    MOVIMENTO_RETORNO,
    MOVIMENTOS_IMPLEMENTADOS,
    PEDIDO_BAIXA,
    descrever_motivos,
    descrever_movimento_retorno,
    separar_motivos,
)

__all__ = ["ALTERACAO_VENCIMENTO", "ENTRADA", "MOTIVOS_REJEICAO", "MOVIMENTO_REMESSA", "MOVIMENTO_RETORNO",
           "MOVIMENTOS_IMPLEMENTADOS", "PEDIDO_BAIXA", "descrever_motivos", "descrever_movimento_retorno",
           "separar_motivos"]

CARTEIRAS: dict[str, str] = {
    "09": "09 · Cobrança com registro (o escritório emite o boleto)",
    "04": "04 · Cobrança com registro",
    "26": "26 · Cobrança com registro",
}
# P 058: código da carteira
TIPO_COBRANCA: dict[str, str] = {
    "1": "Cobrança simples",
    "2": "Cobrança vinculada",
    "3": "Cobrança caucionada",
    "4": "Cobrança descontada",
}
FORMA_CADASTRAMENTO: dict[str, str] = {"1": "Com registro", "2": "Sem registro"}
TIPO_DOCUMENTO: dict[str, str] = {"1": "Tradicional", "2": "Escritural"}
ESPECIE: dict[str, str] = {
    "02": "DM · Duplicata mercantil",
    "04": "DS · Duplicata de serviço",
    "12": "NP · Nota promissória",
    "17": "RC · Recibo",
    "99": "Outros",
}
ESPECIE_SIGLA = {"02": "DM", "04": "DS", "12": "NP", "17": "RC", "99": "OU"}
JUROS: dict[str, str] = {"1": "Valor por dia", "2": "Taxa mensal (%)", "3": "Isento"}
PROTESTO: dict[str, str] = {
    "3": "Não protestar",
    "1": "Protestar (dias corridos)",
    "2": "Protestar (dias úteis)",
}
BAIXA: dict[str, str] = {"1": "Baixar/devolver depois dos dias informados", "2": "Não baixar/não devolver"}

PADROES = {"carteira": "09", "tipo_cobranca": "1", "forma_cadastramento": "1", "tipo_documento": "1",
           "especie_titulo": "04", "codigo_juros": "2", "codigo_protesto": "3", "codigo_baixa": "1", "dias_baixa": 60}
