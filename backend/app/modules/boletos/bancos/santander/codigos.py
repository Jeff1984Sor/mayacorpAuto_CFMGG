"""Tabelas de códigos do CNAB 240 do Santander.

TODO [CONFIRMAR com o manual H7815 v8.3 ou no "Teste de Arquivos" do banco]: os valores marcados abaixo
vêm do padrão FEBRABAN e das notas do manual; todos são editáveis no cadastro do convênio, nada está fixo
no gerador.
"""

# ------------------------------------------------------------------------------------------- remessa (P 016-017)
ENTRADA = "01"
PEDIDO_BAIXA = "02"
CONCESSAO_ABATIMENTO = "04"
CANCELAMENTO_ABATIMENTO = "05"
ALTERACAO_VENCIMENTO = "06"
ALTERACAO_ID_EMPRESA = "07"
ALTERACAO_SEU_NUMERO = "08"
PEDIDO_PROTESTO = "09"
CONCESSAO_DESCONTO = "10"
CANCELAMENTO_DESCONTO = "11"
SUSTAR_PROTESTO = "18"
ALTERACAO_OUTROS_DADOS = "31"
NAO_PROTESTAR = "98"

MOVIMENTO_REMESSA: dict[str, str] = {
    ENTRADA: "Entrada de boleto",
    PEDIDO_BAIXA: "Pedido de baixa",
    CONCESSAO_ABATIMENTO: "Concessão de abatimento",
    CANCELAMENTO_ABATIMENTO: "Cancelamento de abatimento",
    ALTERACAO_VENCIMENTO: "Alteração de vencimento",
    ALTERACAO_ID_EMPRESA: "Alteração da identificação do título na empresa",
    ALTERACAO_SEU_NUMERO: "Alteração do seu número",
    PEDIDO_PROTESTO: "Pedido de protesto",
    CONCESSAO_DESCONTO: "Concessão de desconto",
    CANCELAMENTO_DESCONTO: "Cancelamento de desconto",
    SUSTAR_PROTESTO: "Sustar protesto",
    ALTERACAO_OUTROS_DADOS: "Alteração de outros dados",
    NAO_PROTESTAR: "Não protestar",
}
# o que o gerador já sabe montar (fase 1); o resto fica catalogado para as próximas fases
MOVIMENTOS_IMPLEMENTADOS = (ENTRADA, PEDIDO_BAIXA, ALTERACAO_VENCIMENTO)

# ------------------------------------------------------------------------------------------- retorno (T 016-017)
MOVIMENTO_RETORNO: dict[str, str] = {
    "02": "Entrada confirmada",
    "03": "Entrada rejeitada",
    "04": "Transferência de carteira (entrada)",
    "05": "Transferência de carteira (baixa)",
    "06": "Liquidação",
    "09": "Baixa",
    "11": "Títulos em carteira (em ser)",
    "12": "Confirmação de recebimento de instrução de abatimento",
    "13": "Confirmação de recebimento de instrução de cancelamento de abatimento",
    "14": "Alteração de vencimento confirmada",
    "17": "Liquidação após baixa ou liquidação de título não registrado",
    "19": "Instrução de protesto confirmada",
    "20": "Instrução de sustação/não protestar confirmada",
    "23": "Remessa a cartório (aponte em cartório)",
    "24": "Retirada de cartório e manutenção em carteira",
    "25": "Protestado e baixado",
    "26": "Instrução rejeitada",
    "27": "Confirmação do pedido de alteração de outros dados",
    "28": "Débito de tarifas e custas",
    "29": "Ocorrência do pagador",
    "30": "Alteração de dados rejeitada",
    "32": "Código de IOF inválido",
    "51": "Título DDA reconhecido pelo pagador",
    "52": "Título DDA não reconhecido pelo pagador",
    "53": "Título DDA recusado pela CIP",
    "93": "Pagamento recebido",
}

# o que cada movimento faz com o boleto no MayaJus (ver services.processar_retorno)
RETORNO_REGISTRADO = ("02",)
RETORNO_REJEITADO = ("03",)
RETORNO_PAGO = ("06", "17")
RETORNO_BAIXADO = ("09",)
RETORNO_VENCIMENTO_ALTERADO = ("14",)
RETORNO_EM_PROTESTO = ("19",)
RETORNO_PROTESTADO = ("25",)
RETORNO_ALERTA = ("26", "30")
RETORNO_TARIFA = ("28",)

# ------------------------------------------------------------------------------------------- Segmento P
# pos. 058: tipo de cobrança (nota 5). Acompanha a carteira do código de barras.
TIPO_COBRANCA: dict[str, str] = {
    "1": "Cobrança simples (eletrônica com registro)",
    "3": "Cobrança caucionada (eletrônica com registro)",
    "4": "Cobrança descontada (eletrônica com registro)",
    "5": "Cobrança simples (rápida com registro)",
    "6": "Cobrança caucionada (rápida com registro)",
    "8": "Cobrança cessão",
}
TIPO_COBRANCA_DA_CARTEIRA = {"101": "5", "104": "1"}
CARTEIRAS: dict[str, str] = {
    "101": "101 · Cobrança rápida com registro",
    "104": "104 · Cobrança eletrônica com registro",
}
# pos. 059: forma de cadastramento (nota 6)
FORMA_CADASTRAMENTO: dict[str, str] = {"1": "Cobrança registrada", "2": "Cobrança sem registro"}
# pos. 060
TIPO_DOCUMENTO: dict[str, str] = {"1": "Tradicional", "2": "Escritural"}
# pos. 107-108: espécie do título (nota 20). Honorários = duplicata de serviço.
ESPECIE: dict[str, str] = {
    "02": "DM · Duplicata mercantil",
    "04": "DS · Duplicata de serviço",
    "07": "LC · Letra de câmbio",
    "12": "NP · Nota promissória",
    "13": "NR · Nota promissória rural",
    "17": "RC · Recibo",
    "20": "AP · Apólice de seguro",
    "97": "CH · Cheque",
    "98": "ND · Nota promissória direta",
}
ESPECIE_SIGLA = {k: v.split(" · ")[0] for k, v in ESPECIE.items()}
# pos. 118: juros de mora (nota 21)
JUROS: dict[str, str] = {"1": "Valor por dia", "2": "Taxa mensal (%)", "3": "Isento"}
# pos. 142: desconto (nota 23)
DESCONTO: dict[str, str] = {"0": "Sem desconto", "1": "Valor fixo até a data", "2": "Percentual até a data"}
# pos. 221: protesto (nota 25)
PROTESTO: dict[str, str] = {
    "0": "Não protestar",
    "1": "Protestar (dias corridos)",
    "2": "Protestar (dias úteis)",
    "3": "Usar o perfil do beneficiário no banco",
}
# pos. 224: baixa/devolução (nota 26)
BAIXA: dict[str, str] = {
    "1": "Baixar/devolver depois dos dias informados",
    "2": "Não baixar/não devolver",
    "3": "Usar o perfil do beneficiário no banco",
}
# R 066
MULTA: dict[str, str] = {"1": "Valor fixo", "2": "Percentual"}
PIX_TIPO_CHAVE: dict[str, str] = {"1": "CPF", "2": "CNPJ", "3": "Telefone", "4": "E-mail", "5": "Aleatória"}

# ------------------------------------------------------------------------------------------- motivos (T 209-218)
# TODO [CONFIRMAR notas 40-A e 40-C do manual]: tabela padrão FEBRABAN (C047). Código fora da lista aparece
# como "Motivo XX" na tela, nunca some.
MOTIVOS_REJEICAO: dict[str, str] = {
    "01": "Código do banco inválido",
    "02": "Código do registro detalhe inválido",
    "03": "Código do segmento inválido",
    "04": "Código de movimento não permitido para a carteira",
    "05": "Código de movimento inválido",
    "06": "Tipo ou número de inscrição do beneficiário inválido",
    "07": "Agência, conta ou dígito inválido",
    "08": "Nosso número inválido",
    "09": "Nosso número duplicado",
    "10": "Carteira inválida",
    "11": "Forma de cadastramento do título inválida",
    "12": "Tipo de documento inválido",
    "13": "Identificação da emissão do boleto inválida",
    "14": "Identificação da distribuição do boleto inválida",
    "15": "Características da cobrança incompatíveis",
    "16": "Data de vencimento inválida",
    "17": "Data de vencimento anterior à data de emissão",
    "18": "Vencimento fora do prazo de operação",
    "19": "Título a cargo de banco correspondente com vencimento muito próximo",
    "20": "Valor do título inválido",
    "21": "Espécie do título inválida",
    "22": "Espécie não permitida para a carteira",
    "23": "Aceite inválido",
    "24": "Data de emissão inválida",
    "25": "Data de emissão posterior à data de entrada",
    "26": "Código de juros de mora inválido",
    "27": "Valor ou taxa de juros de mora inválido",
    "28": "Código do desconto inválido",
    "29": "Valor do desconto maior ou igual ao valor do título",
    "30": "Desconto a conceder não confere",
    "31": "Concessão de desconto: já existe desconto anterior",
    "32": "Valor do IOF inválido",
    "33": "Valor do abatimento inválido",
    "34": "Valor do abatimento maior ou igual ao valor do título",
    "35": "Abatimento a conceder não confere",
    "36": "Concessão de abatimento: já existe abatimento anterior",
    "37": "Código para protesto inválido",
    "38": "Prazo para protesto inválido",
    "39": "Pedido de protesto não permitido para o título",
    "40": "Título com ordem de protesto emitida",
    "41": "Pedido de cancelamento/sustação para título sem instrução de protesto",
    "42": "Código para baixa/devolução inválido",
    "43": "Prazo para baixa/devolução inválido",
    "44": "Código da moeda inválido",
    "45": "Nome do pagador não informado",
    "46": "Tipo ou número de inscrição do pagador inválido",
    "47": "Endereço do pagador não informado",
    "48": "CEP inválido",
    "49": "CEP sem praça de cobrança",
    "50": "CEP referente a um banco correspondente",
    "51": "CEP incompatível com a UF",
    "52": "UF inválida",
    "53": "Tipo ou número de inscrição do sacador/avalista inválido",
    "54": "Sacador/avalista não informado",
    "55": "Nosso número no banco correspondente não informado",
    "56": "Código do banco correspondente não informado",
    "57": "Código da multa inválido",
    "58": "Data da multa inválida",
    "59": "Valor ou percentual da multa inválido",
    "60": "Movimento para título não cadastrado",
    "61": "Alteração da agência cobradora inválida",
    "62": "Tipo de impressão inválido",
    "63": "Entrada para título já cadastrado",
    "64": "Número da linha inválido",
    "79": "Data de juros de mora inválida",
    "80": "Data do desconto inválida",
    "86": "Seu número inválido",
}


def descrever_movimento_retorno(codigo: str) -> str:
    return MOVIMENTO_RETORNO.get(codigo, f"Movimento {codigo}")


def separar_motivos(campo: str) -> list[str]:
    """T 209-218 → até 5 códigos de 2 posições (ignora brancos e zeros)."""
    bruto = (campo or "").ljust(10)[:10]
    codigos = [bruto[i:i + 2].strip() for i in range(0, 10, 2)]
    return [c for c in codigos if c and c != "00"]


def descrever_motivos(codigos: list[str]) -> list[dict[str, str]]:
    return [{"codigo": c, "descricao": MOTIVOS_REJEICAO.get(c, f"Motivo {c}")} for c in codigos]
