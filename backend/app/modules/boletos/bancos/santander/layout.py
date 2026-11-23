"""Layout CNAB 240 de cobrança do Santander (H7815, v8.3, abril/2025), campo a campo.

Cada classe é uma linha de 240 posições. As posições são as do manual (contando de 1); o `Record`
confere, ao importar este arquivo, que elas fecham de 1 a 240 sem buraco nem sobreposição.
"""

from app.modules.boletos.cnab import Field, Record

BANCO = "033"
NOME_BANCO = "BANCO SANTANDER"
VERSAO_ARQUIVO = "040"
VERSAO_LOTE = "030"


def _B(n: int, inicio: int, fim: int) -> Field:
    return Field(f"brancos_{n}", inicio, fim, "B")


# ------------------------------------------------------------------------------------------------ remessa
class HeaderArquivo(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0000"),
        Field("tipo_registro", 8, 8, "N", default="0"),
        _B(1, 9, 16),
        Field("tipo_inscricao", 17, 17, "N"),  # 1=CPF, 2=CNPJ
        Field("inscricao", 18, 32, "N"),
        Field("codigo_transmissao", 33, 47, "N"),
        _B(2, 48, 72),
        Field("nome_empresa", 73, 102, "A"),
        Field("nome_banco", 103, 132, "A", default=NOME_BANCO),
        _B(3, 133, 142),
        Field("codigo_remessa", 143, 143, "N", default="1"),  # 1=remessa, 2=retorno
        Field("data_geracao", 144, 151, "D"),
        _B(4, 152, 157),
        Field("sequencial_arquivo", 158, 163, "N"),
        Field("versao_layout", 164, 166, "N", default=VERSAO_ARQUIVO),
        _B(5, 167, 240),
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
        _B(3, 34, 53),
        Field("codigo_transmissao", 54, 68, "N"),
        _B(4, 69, 73),
        Field("nome_beneficiario", 74, 103, "A"),
        Field("mensagem_1", 104, 143, "A"),
        Field("mensagem_2", 144, 183, "A"),
        Field("numero_remessa", 184, 191, "N"),
        Field("data_gravacao", 192, 199, "D"),
        _B(5, 200, 240),
    ]


class SegmentoP(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="3"),
        Field("sequencial", 9, 13, "N"),
        Field("segmento", 14, 14, "A", default="P"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("agencia", 18, 21, "N"),
        Field("agencia_dv", 22, 22, "N"),
        Field("conta", 23, 31, "N"),
        Field("conta_dv", 32, 32, "N"),
        Field("conta_fidc", 33, 41, "N"),
        Field("conta_fidc_dv", 42, 42, "N"),
        _B(2, 43, 44),
        Field("nosso_numero", 45, 57, "N"),
        Field("tipo_cobranca", 58, 58, "A"),
        Field("forma_cadastramento", 59, 59, "N"),
        Field("tipo_documento", 60, 60, "N"),
        _B(3, 61, 61),
        _B(4, 62, 62),
        Field("seu_numero", 63, 77, "A"),
        Field("vencimento", 78, 85, "D"),
        Field("valor", 86, 100, "N", dec=2),
        Field("agencia_fidc", 101, 104, "N"),
        Field("agencia_fidc_dv", 105, 105, "N"),
        _B(5, 106, 106),
        Field("especie", 107, 108, "N"),
        Field("aceite", 109, 109, "A", default="N"),
        Field("data_emissao", 110, 117, "D"),
        Field("codigo_juros", 118, 118, "N"),
        Field("data_juros", 119, 126, "D"),
        Field("juros", 127, 141, "N", dec=2),
        Field("codigo_desconto_1", 142, 142, "N"),
        Field("data_desconto_1", 143, 150, "D"),
        Field("desconto_1", 151, 165, "N", dec=2),
        Field("iof", 166, 180, "N", dec=5),
        Field("abatimento", 181, 195, "N", dec=2),
        Field("id_empresa", 196, 220, "A"),
        Field("codigo_protesto", 221, 221, "N"),
        Field("dias_protesto", 222, 223, "N"),
        Field("codigo_baixa", 224, 224, "N"),
        Field("fixo_zero", 225, 225, "N", default="0"),
        Field("dias_baixa", 226, 227, "N"),
        Field("moeda", 228, 229, "N", default="00"),
        _B(6, 230, 240),
    ]


class SegmentoQ(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="3"),
        Field("sequencial", 9, 13, "N"),
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
        Field("reservado_1", 210, 212, "N"),
        Field("reservado_2", 213, 215, "N"),
        Field("reservado_3", 216, 218, "N"),
        Field("reservado_4", 219, 221, "N"),
        _B(2, 222, 240),
    ]


class SegmentoR(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="3"),
        Field("sequencial", 9, 13, "N"),
        Field("segmento", 14, 14, "A", default="R"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("codigo_desconto_2", 18, 18, "N"),
        Field("data_desconto_2", 19, 26, "D"),
        Field("desconto_2", 27, 41, "N", dec=2),
        Field("codigo_desconto_3", 42, 42, "N"),
        Field("data_desconto_3", 43, 50, "D"),
        Field("desconto_3", 51, 65, "N", dec=2),
        Field("codigo_multa", 66, 66, "N"),  # 1=valor fixo, 2=percentual
        Field("data_multa", 67, 74, "D"),
        Field("multa", 75, 89, "N", dec=2),
        _B(2, 90, 99),
        Field("mensagem_3", 100, 139, "A"),
        Field("mensagem_4", 140, 179, "A"),
        _B(3, 180, 240),
    ]


class SegmentoY03(Record):
    """Boleto híbrido (QR Code Pix). Chave e TXID vão como texto literal: e-mail e TXID têm minúsculas."""

    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="3"),
        Field("sequencial", 9, 13, "N"),
        Field("segmento", 14, 14, "A", default="Y"),
        _B(1, 15, 15),
        Field("codigo_movimento", 16, 17, "N"),
        Field("identificacao", 18, 19, "N", default="03"),
        _B(2, 20, 80),
        Field("pix_tipo_chave", 81, 81, "A"),  # 1=CPF, 2=CNPJ, 3=Telefone, 4=E-mail, 5=Aleatória
        Field("pix_chave", 82, 158, "X"),
        Field("txid", 159, 193, "X"),
        _B(3, 194, 240),
    ]


class TrailerLote(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="0001"),
        Field("tipo_registro", 8, 8, "N", default="5"),
        _B(1, 9, 17),
        Field("qtd_registros", 18, 23, "N"),  # conta o header e o trailer do lote
        _B(2, 24, 240),
    ]


class TrailerArquivo(Record):
    CAMPOS = [
        Field("codigo_banco", 1, 3, "N", default=BANCO),
        Field("lote", 4, 7, "N", default="9999"),
        Field("tipo_registro", 8, 8, "N", default="9"),
        _B(1, 9, 17),
        Field("qtd_lotes", 18, 23, "N"),
        Field("qtd_registros", 24, 29, "N"),
        _B(2, 30, 240),
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
        Field("agencia", 18, 21, "N"),
        Field("agencia_dv", 22, 22, "N"),
        Field("conta", 23, 31, "N"),
        Field("conta_dv", 32, 32, "N"),
        _B(2, 33, 40),
        Field("nosso_numero", 41, 53, "N"),
        Field("carteira", 54, 54, "A"),
        Field("seu_numero", 55, 69, "A"),
        Field("vencimento", 70, 77, "D"),
        Field("valor", 78, 92, "N", dec=2),
        Field("banco_cobrador", 93, 95, "N"),
        Field("agencia_cobradora", 96, 99, "N"),
        Field("agencia_cobradora_dv", 100, 100, "N"),
        Field("id_empresa", 101, 125, "A"),
        Field("moeda", 126, 127, "N"),
        Field("pagador_tipo_inscricao", 128, 128, "N"),
        Field("pagador_inscricao", 129, 143, "N"),
        Field("pagador_nome", 144, 183, "A"),
        Field("conta_cobranca", 184, 193, "A"),
        Field("tarifa", 194, 208, "N", dec=2),
        Field("motivos", 209, 218, "A"),  # até 5 códigos de 2 posições
        _B(3, 219, 240),
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
        _B(2, 214, 240),
    ]


REGISTROS = [HeaderArquivo, HeaderLote, SegmentoP, SegmentoQ, SegmentoR, SegmentoY03, TrailerLote, TrailerArquivo,
             SegmentoT, SegmentoU]
