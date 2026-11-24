"""Layout CNAB 240 de cobrança do Bradesco (padrão FEBRABAN 240, arquivo 084 / lote 042), campo a campo.

TODO [CONFIRMAR no validador de arquivos do Bradesco (Net Empresa › Cobrança › Teste de arquivo)]: as posições
seguem o layout FEBRABAN 240 que o Bradesco adota; o que é escolha do banco (convênio, carteira, emissão do boleto)
fica no cadastro do convênio.
"""

from app.modules.boletos.cnab import Field, Record

BANCO = "237"
NOME_BANCO = "BANCO BRADESCO S.A."
VERSAO_ARQUIVO = "084"
VERSAO_LOTE = "042"


def _B(n: int, inicio: int, fim: int) -> Field:
    return Field(f"brancos_{n}", inicio, fim, "B")


_CONTROLE_DETALHE = [
    Field("codigo_banco", 1, 3, "N", default=BANCO),
    Field("lote", 4, 7, "N", default="0001"),
    Field("tipo_registro", 8, 8, "N", default="3"),
    Field("sequencial", 9, 13, "N"),
]


# ------------------------------------------------------------------------------------------------ remessa
class HeaderArquivo(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0000"),
        Field("tipo_registro", 8, 8, "N", default="0"),
        _B(1, 9, 17),
        Field("tipo_inscricao", 18, 18, "N"),  # 1=CPF, 2=CNPJ
        Field("inscricao", 19, 32, "N"),
        Field("convenio", 33, 52, "A"),
        Field("agencia", 53, 57, "N"),
        Field("agencia_dv", 58, 58, "A"),
        Field("conta", 59, 70, "N"),
        Field("conta_dv", 71, 71, "A"),
        Field("agencia_conta_dv", 72, 72, "A"),
        Field("nome_empresa", 73, 102, "A"),
        Field("nome_banco", 103, 132, "A", default=NOME_BANCO),
        _B(2, 133, 142),
        Field("codigo_remessa", 143, 143, "N", default="1"),  # 1=remessa, 2=retorno
        Field("data_geracao", 144, 151, "D"),
        Field("hora_geracao", 152, 157, "N"),
        Field("sequencial_arquivo", 158, 163, "N"),
        Field("versao_layout", 164, 166, "N", default=VERSAO_ARQUIVO),
        Field("densidade", 167, 171, "N", default="01600"),
        Field("reservado_banco", 172, 191, "A"),
        Field("reservado_empresa", 192, 211, "A"),
        _B(3, 212, 240),
    ]


class HeaderLote(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="1"),
        Field("tipo_operacao", 9, 9, "A", default="R"),
        Field("tipo_servico", 10, 11, "N", default="01"),
        _B(1, 12, 13),
        Field("versao_layout", 14, 16, "N", default=VERSAO_LOTE),
        _B(2, 17, 17),
        Field("tipo_inscricao", 18, 18, "N"),
        Field("inscricao", 19, 33, "N"),
        Field("convenio", 34, 53, "A"),
        Field("agencia", 54, 58, "N"),
        Field("agencia_dv", 59, 59, "A"),
        Field("conta", 60, 71, "N"),
        Field("conta_dv", 72, 72, "A"),
        Field("agencia_conta_dv", 73, 73, "A"),
        Field("nome_beneficiario", 74, 103, "A"),
        Field("mensagem_1", 104, 143, "A"),
        Field("mensagem_2", 144, 183, "A"),
        Field("numero_remessa", 184, 191, "N"),
        Field("data_gravacao", 192, 199, "D"),
        Field("data_credito", 200, 207, "D"),
        _B(3, 208, 240),
    ]


class SegmentoP(Record):
    CAMPOS = [
        *_CONTROLE_DETALHE,
        Field("segmento", 14, 14, "A", default="P"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("agencia", 18, 22, "N"),
        Field("agencia_dv", 23, 23, "A"),
        Field("conta", 24, 35, "N"),
        Field("conta_dv", 36, 36, "A"),
        Field("agencia_conta_dv", 37, 37, "A"),
        # identificação do título no banco (20): carteira (3) + zeros (5) + nosso número (11) + DV (1, pode ser "P")
        Field("nn_carteira", 38, 40, "N"),
        Field("nn_zeros", 41, 45, "N"),
        Field("nn_numero", 46, 56, "N"),
        Field("nn_dv", 57, 57, "A"),
        Field("codigo_carteira", 58, 58, "N"),  # 1 = cobrança simples
        Field("forma_cadastramento", 59, 59, "N"),  # 1 = com registro
        Field("tipo_documento", 60, 60, "A"),  # 1 = tradicional, 2 = escritural
        Field("emissao_boleto", 61, 61, "N"),  # 1 = banco emite, 2 = cliente emite
        Field("distribuicao_boleto", 62, 62, "A"),  # 1 = banco distribui, 2 = cliente distribui
        Field("seu_numero", 63, 77, "A"),
        Field("vencimento", 78, 85, "D"),
        Field("valor", 86, 100, "N", dec=2),
        Field("agencia_cobradora", 101, 105, "N"),
        Field("agencia_cobradora_dv", 106, 106, "A"),
        Field("especie", 107, 108, "N"),
        Field("aceite", 109, 109, "A", default="N"),
        Field("data_emissao", 110, 117, "D"),
        Field("codigo_juros", 118, 118, "N"),
        Field("data_juros", 119, 126, "D"),
        Field("juros", 127, 141, "N", dec=2),
        Field("codigo_desconto_1", 142, 142, "N"),
        Field("data_desconto_1", 143, 150, "D"),
        Field("desconto_1", 151, 165, "N", dec=2),
        Field("iof", 166, 180, "N", dec=2),
        Field("abatimento", 181, 195, "N", dec=2),
        Field("id_empresa", 196, 220, "A"),
        Field("codigo_protesto", 221, 221, "N"),
        Field("dias_protesto", 222, 223, "N"),
        Field("codigo_baixa", 224, 224, "N"),
        Field("dias_baixa", 225, 227, "N"),
        Field("moeda", 228, 229, "N", default="09"),
        Field("contrato", 230, 239, "N"),
        _B(2, 240, 240),
    ]


class SegmentoQ(Record):
    CAMPOS = [
        *_CONTROLE_DETALHE,
        Field("segmento", 14, 14, "A", default="Q"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("pagador_tipo_inscricao", 18, 18, "N"),
        Field("pagador_inscricao", 19, 33, "N"),
        Field("pagador_nome", 34, 73, "A"),
        Field("pagador_endereco", 74, 113, "A"),
        Field("pagador_bairro", 114, 128, "A"),
        Field("pagador_cep", 129, 133, "N"),
        Field("pagador_cep_sufixo", 134, 136, "N"),
        Field("pagador_cidade", 137, 151, "A"),
        Field("pagador_uf", 152, 153, "A"),
        Field("sacador_tipo_inscricao", 154, 154, "N"),
        Field("sacador_inscricao", 155, 169, "N"),
        Field("sacador_nome", 170, 209, "A"),
        Field("banco_correspondente", 210, 212, "N"),
        Field("nosso_numero_correspondente", 213, 232, "A"),
        _B(2, 233, 240),
    ]


class SegmentoR(Record):
    CAMPOS = [
        *_CONTROLE_DETALHE,
        Field("segmento", 14, 14, "A", default="R"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("codigo_desconto_2", 18, 18, "N"),
        Field("data_desconto_2", 19, 26, "D"),
        Field("desconto_2", 27, 41, "N", dec=2),
        Field("codigo_desconto_3", 42, 42, "N"),
        Field("data_desconto_3", 43, 50, "D"),
        Field("desconto_3", 51, 65, "N", dec=2),
        Field("codigo_multa", 66, 66, "N"),  # 1 = valor fixo, 2 = percentual
        Field("data_multa", 67, 74, "D"),
        Field("multa", 75, 89, "N", dec=2),
        Field("informacao_pagador", 90, 99, "A"),
        Field("mensagem_3", 100, 139, "A"),
        Field("mensagem_4", 140, 179, "A"),
        _B(2, 180, 199),
        Field("ocorrencia_pagador", 200, 207, "N"),
        Field("debito_banco", 208, 210, "N"),
        Field("debito_agencia", 211, 215, "N"),
        Field("debito_agencia_dv", 216, 216, "A"),
        Field("debito_conta", 217, 228, "N"),
        Field("debito_conta_dv", 229, 229, "A"),
        Field("debito_agencia_conta_dv", 230, 230, "A"),
        Field("aviso_debito", 231, 231, "N"),
        _B(3, 232, 240),
    ]


class TrailerLote(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="5"),
        _B(1, 9, 17),
        Field("qtd_registros", 18, 23, "N"),  # conta o header e o trailer do lote
        Field("qtd_simples", 24, 29, "N"),
        Field("valor_simples", 30, 46, "N", dec=2),
        Field("qtd_vinculada", 47, 52, "N"),
        Field("valor_vinculada", 53, 69, "N", dec=2),
        Field("qtd_caucionada", 70, 75, "N"),
        Field("valor_caucionada", 76, 92, "N", dec=2),
        Field("qtd_descontada", 93, 98, "N"),
        Field("valor_descontada", 99, 115, "N", dec=2),
        Field("aviso_lancamento", 116, 123, "A"),
        _B(2, 124, 240),
    ]


class TrailerArquivo(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="9999"),
        Field("tipo_registro", 8, 8, "N", default="9"),
        _B(1, 9, 17),
        Field("qtd_lotes", 18, 23, "N"),
        Field("qtd_registros", 24, 29, "N"),
        Field("qtd_contas", 30, 35, "N"),
        _B(2, 36, 240),
    ]


# ------------------------------------------------------------------------------------------------ retorno
class SegmentoT(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N"),
        Field("lote", 4, 7, "N"),
        Field("tipo_registro", 8, 8, "N"),
        Field("sequencial", 9, 13, "N"),
        Field("segmento", 14, 14, "A"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "A"),
        Field("agencia", 18, 22, "N"),
        Field("agencia_dv", 23, 23, "A"),
        Field("conta", 24, 35, "N"),
        Field("conta_dv", 36, 36, "A"),
        Field("agencia_conta_dv", 37, 37, "A"),
        Field("nosso_numero", 38, 57, "A"),  # carteira (3) + zeros (5) + número (11) + DV (1)
        Field("carteira", 58, 58, "A"),
        Field("seu_numero", 59, 73, "A"),
        Field("vencimento", 74, 81, "D"),
        Field("valor", 82, 96, "N", dec=2),
        Field("banco_cobrador", 97, 99, "N"),
        Field("agencia_cobradora", 100, 104, "N"),
        Field("agencia_cobradora_dv", 105, 105, "A"),
        Field("id_empresa", 106, 130, "A"),
        Field("moeda", 131, 132, "N"),
        Field("pagador_tipo_inscricao", 133, 133, "N"),
        Field("pagador_inscricao", 134, 148, "N"),
        Field("pagador_nome", 149, 188, "A"),
        Field("contrato", 189, 198, "A"),
        Field("tarifa", 199, 213, "N", dec=2),
        Field("motivos", 214, 223, "A"),  # até 5 códigos de 2 posições
        _B(2, 224, 240),
    ]


class SegmentoU(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N"),
        Field("lote", 4, 7, "N"),
        Field("tipo_registro", 8, 8, "N"),
        Field("sequencial", 9, 13, "N"),
        Field("segmento", 14, 14, "A"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "A"),
        Field("juros_multa", 18, 32, "N", dec=2),
        Field("desconto", 33, 47, "N", dec=2),
        Field("abatimento", 48, 62, "N", dec=2),
        Field("iof", 63, 77, "N", dec=2),
        Field("valor_pago", 78, 92, "N", dec=2),
        Field("valor_liquido", 93, 107, "N", dec=2),
        Field("outras_despesas", 108, 122, "N", dec=2),
        Field("outros_creditos", 123, 137, "N", dec=2),
        Field("data_ocorrencia", 138, 145, "D"),
        Field("data_credito", 146, 153, "D"),
        Field("ocorrencia_pagador", 154, 157, "A"),
        Field("data_ocorrencia_pagador", 158, 165, "D"),
        Field("valor_ocorrencia_pagador", 166, 180, "N", dec=2),
        Field("complemento", 181, 210, "A"),
        Field("banco_correspondente", 211, 213, "N"),
        Field("nosso_numero_correspondente", 214, 233, "A"),
        _B(2, 234, 240),
    ]


REGISTROS = [HeaderArquivo, HeaderLote, SegmentoP, SegmentoQ, SegmentoR, TrailerLote, TrailerArquivo, SegmentoT, SegmentoU]
