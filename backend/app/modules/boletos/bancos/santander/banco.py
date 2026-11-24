"""Adaptador do Santander (033): junta nosso número, código de barras, remessa e retorno."""

from datetime import date
from decimal import Decimal

from app.core.documentos import cnpj_valido, cpf_valido
from app.modules.boletos.bancos.base import BancoBase, DadosBoleto, DadosConvenio, RetornoLido
from app.modules.boletos.bancos.santander import codigo_barras as cb
from app.modules.boletos.bancos.santander import codigos as cod
from app.modules.boletos.bancos.santander import nosso_numero as nn
from app.modules.boletos.bancos.santander import remessa, retorno

UFS = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())


def _documento_valido(doc: str) -> bool:
    return cpf_valido(doc) if len(doc) == 11 else cnpj_valido(doc) if len(doc) == 14 else False


def _digitos(valor: str, maximo: int) -> bool:
    v = (valor or "").strip()
    return v.isdigit() and len(v) <= maximo


class SantanderCNAB240(BancoBase):
    codigo = "033"
    nome = "BANCO SANTANDER"
    nome_curto = "Santander"
    codigo_com_dv = "033-7"
    local_pagamento = "PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO"

    def calcular_nosso_numero(self, sequencial: int, convenio: DadosConvenio) -> str:
        return nn.montar(sequencial)

    def codigo_barras(self, boleto: DadosBoleto, convenio: DadosConvenio) -> str:
        return cb.codigo_barras(codigo_beneficiario=convenio.codigo_beneficiario, nosso_numero=boleto.nosso_numero,
                                carteira=convenio.carteira, vencimento=boleto.data_vencimento, valor=boleto.valor)

    def linha_digitavel(self, codigo_barras: str) -> str:
        return cb.linha_digitavel(codigo_barras)

    def formatar_linha_digitavel(self, linha: str) -> str:
        return cb.formatar_linha(linha)

    def formatar_nosso_numero(self, nosso_numero: str) -> str:
        n = (nosso_numero or "").strip()
        return f"{n[:-1]}-{n[-1]}" if len(n) == 13 else n

    def agencia_codigo_beneficiario(self, convenio: DadosConvenio) -> str:
        return f"{convenio.agencia.zfill(4)} / {convenio.codigo_beneficiario.zfill(7)}"

    # ------------------------------------------------------------------ validações (antes de entrar na remessa)
    def validar_convenio(self, convenio: DadosConvenio) -> list[str]:
        erros = []
        if not _documento_valido(convenio.beneficiario_documento):
            erros.append("O CNPJ/CPF do beneficiário (empresa emissora) é inválido.")
        if not (convenio.beneficiario_nome or "").strip():
            erros.append("Falta o nome do beneficiário.")
        if not _digitos(convenio.agencia, 4):
            erros.append("A agência tem até 4 dígitos, sem o dígito verificador.")
        if not _digitos(convenio.agencia_dv, 1):
            erros.append("Informe o dígito da agência (use 0 se a agência não tiver).")
        if not _digitos(convenio.conta, 9):
            erros.append("A conta tem até 9 dígitos, sem o dígito verificador.")
        if not _digitos(convenio.conta_dv, 1):
            erros.append("Informe o dígito da conta.")
        if not _digitos(convenio.codigo_beneficiario, 7):
            erros.append("O código do beneficiário tem até 7 dígitos (vem do contrato de cobrança).")
        if not _digitos(convenio.codigo_transmissao, 15):
            erros.append("O código de transmissão tem até 15 dígitos (vem do contrato de cobrança).")
        if not (convenio.carteira or "").isdigit() or len(convenio.carteira) != 3:
            erros.append("A carteira tem 3 dígitos (101 ou 104).")
        if convenio.tipo_cobranca not in cod.TIPO_COBRANCA:
            erros.append("Tipo de cobrança inválido.")
        if convenio.forma_cadastramento not in cod.FORMA_CADASTRAMENTO:
            erros.append("Forma de cadastramento inválida.")
        if convenio.tipo_documento not in cod.TIPO_DOCUMENTO:
            erros.append("Tipo de documento inválido.")
        if not (convenio.especie_titulo or "").isdigit() or len(convenio.especie_titulo) != 2:
            erros.append("A espécie do título tem 2 dígitos (04 = duplicata de serviço).")
        if convenio.codigo_juros not in cod.JUROS:
            erros.append("Código de juros inválido.")
        if convenio.codigo_protesto not in cod.PROTESTO:
            erros.append("Código de protesto inválido.")
        elif convenio.codigo_protesto in ("1", "2") and not 1 <= int(convenio.dias_protesto or 0) <= 99:
            erros.append("Para protestar, informe os dias para protesto (1 a 99).")
        if convenio.codigo_baixa not in cod.BAIXA:
            erros.append("Código de baixa/devolução inválido.")
        elif convenio.codigo_baixa == "1" and not 1 <= int(convenio.dias_baixa or 0) <= 99:
            erros.append("Informe os dias para baixa/devolução (1 a 99).")
        if Decimal(convenio.juros_mensal_pct or 0) < 0 or Decimal(convenio.multa_pct or 0) < 0:
            erros.append("Juros e multa não podem ser negativos.")
        if convenio.pix_habilitado:
            if convenio.pix_chave_tipo not in cod.PIX_TIPO_CHAVE or not (convenio.pix_chave or "").strip():
                erros.append("Com o Pix ligado, informe o tipo e a chave Pix.")
            elif len(convenio.pix_chave) > 77:
                erros.append("A chave Pix tem no máximo 77 caracteres.")
        return erros

    def validar_boleto(self, boleto: DadosBoleto, convenio: DadosConvenio) -> list[str]:
        erros = []
        if Decimal(boleto.valor or 0) <= 0:
            erros.append("O valor do boleto precisa ser maior que zero.")
        elif Decimal(boleto.valor) > Decimal("99999999.99"):
            erros.append("O valor passa do máximo aceito no código de barras (R$ 99.999.999,99).")
        if not (boleto.pagador_nome or "").strip():
            erros.append("Falta o nome do pagador.")
        if not _documento_valido(boleto.pagador_documento or ""):
            erros.append("O CPF/CNPJ do pagador é inválido ou está em branco.")
        if not (boleto.pagador_endereco or "").strip():
            erros.append("Falta o endereço do pagador.")
        cep = (boleto.pagador_cep or "").strip()
        if not (cep.isdigit() and len(cep) == 8) or cep == "00000000":
            erros.append("O CEP do pagador precisa ter 8 dígitos.")
        if not (boleto.pagador_cidade or "").strip():
            erros.append("Falta a cidade do pagador.")
        if (boleto.pagador_uf or "").upper() not in UFS:
            erros.append("A UF do pagador é inválida.")
        if boleto.movimento == cod.ENTRADA and boleto.data_vencimento < boleto.data_emissao:
            erros.append("O vencimento é anterior à data de emissão.")
        if convenio.numeracao == "EMPRESA" and not nn.valido(boleto.nosso_numero):
            erros.append("Nosso número inválido.")
        if not (boleto.id_empresa or "").strip():
            erros.append("Falta a identificação do título.")
        return erros

    # ------------------------------------------------------------------ arquivos
    def gerar_remessa(self, convenio: DadosConvenio, boletos: list[DadosBoleto], sequencial_arquivo: int,
                      data_geracao: date | None = None) -> bytes:
        return remessa.gerar_remessa(convenio, boletos, sequencial_arquivo, data_geracao)

    def nome_arquivo_remessa(self, sequencial_arquivo: int, data_geracao: date) -> str:
        return remessa.nome_arquivo(sequencial_arquivo, data_geracao)

    def ler_retorno(self, conteudo: bytes) -> RetornoLido:
        return retorno.ler_retorno(conteudo)

    def opcoes(self) -> dict[str, dict[str, str]]:
        return {
            "carteira": cod.CARTEIRAS, "tipo_cobranca": cod.TIPO_COBRANCA,
            "forma_cadastramento": cod.FORMA_CADASTRAMENTO, "tipo_documento": cod.TIPO_DOCUMENTO,
            "especie_titulo": cod.ESPECIE, "codigo_juros": cod.JUROS, "codigo_protesto": cod.PROTESTO,
            "codigo_baixa": cod.BAIXA, "pix_chave_tipo": cod.PIX_TIPO_CHAVE,
            "tipo_cobranca_da_carteira": cod.TIPO_COBRANCA_DA_CARTEIRA,
        }

    def padroes(self) -> dict:
        return {"carteira": "101", "tipo_cobranca": "5", "forma_cadastramento": "1", "tipo_documento": "1",
                "especie_titulo": "04", "codigo_juros": "2", "codigo_protesto": "0", "codigo_baixa": "1", "dias_baixa": 60}

    def campos(self) -> dict:
        return {
            "codigo_beneficiario": {"rotulo": "Código do beneficiário", "obrigatorio": True, "tamanho": 7,
                                    "dica": "Vai no código de barras"},
            "codigo_transmissao": {"rotulo": "Código de transmissão", "obrigatorio": True, "tamanho": 15,
                                   "dica": "Vai no cabeçalho da remessa"},
            "conta_tamanho": 9,
        }

    def sigla_especie(self, especie: str) -> str:
        return cod.ESPECIE_SIGLA.get(especie, "DS")
