"""Contrato que todo banco cumpre. O núcleo conversa só com estes tipos, nunca com o ORM.

Os dados chegam em estruturas simples (`DadosConvenio`, `DadosBoleto`), assim cada adaptador é testado sem banco
de dados e um banco novo (Itaú, Bradesco, BB, Sicoob…) entra sem tocar no resto do sistema.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass
class DadosConvenio:
    """Contrato de cobrança do escritório com o banco."""

    beneficiario_nome: str
    beneficiario_documento: str  # só dígitos (CPF 11 ou CNPJ 14)
    agencia: str
    agencia_dv: str
    conta: str
    conta_dv: str
    codigo_beneficiario: str
    codigo_transmissao: str
    carteira: str = "101"
    tipo_cobranca: str = "5"
    forma_cadastramento: str = "1"
    tipo_documento: str = "1"
    especie_titulo: str = "04"
    aceite: str = "N"
    numeracao: str = "EMPRESA"  # EMPRESA | BANCO
    codigo_juros: str = "2"
    juros_mensal_pct: Decimal = Decimal("1.00")
    multa_pct: Decimal = Decimal("2.00")
    codigo_protesto: str = "0"
    dias_protesto: int = 0
    codigo_baixa: str = "1"
    dias_baixa: int = 60
    mensagem_1: str = ""
    mensagem_2: str = ""
    pix_habilitado: bool = False
    pix_chave_tipo: str = ""
    pix_chave: str = ""


@dataclass
class DadosBoleto:
    """Um título dentro da remessa. `movimento` diz o que fazer com ele (01 entrada, 02 baixa, 06 vencimento…)."""

    id_empresa: str
    seu_numero: str
    nosso_numero: str  # 13 dígitos com DV; vazio/zeros quando a numeração é do banco
    valor: Decimal
    data_emissao: date
    data_vencimento: date
    pagador_nome: str
    pagador_documento: str  # só dígitos
    pagador_endereco: str
    pagador_bairro: str
    pagador_cep: str  # 8 dígitos
    pagador_cidade: str
    pagador_uf: str
    movimento: str = "01"
    desconto_valor: Decimal = Decimal(0)
    desconto_data: date | None = None
    abatimento: Decimal = Decimal(0)
    mensagem_3: str = ""
    mensagem_4: str = ""
    txid: str = ""


@dataclass
class OcorrenciaRetorno:
    """Um par T + U do arquivo de retorno, já traduzido."""

    codigo_movimento: str
    descricao: str
    nosso_numero: str
    id_empresa: str
    seu_numero: str
    vencimento: date | None
    valor: Decimal
    tarifa: Decimal
    motivos: list[str] = field(default_factory=list)
    motivos_descricao: list[dict[str, str]] = field(default_factory=list)
    valor_pago: Decimal = Decimal(0)
    valor_liquido: Decimal = Decimal(0)
    juros_multa: Decimal = Decimal(0)
    desconto: Decimal = Decimal(0)
    abatimento: Decimal = Decimal(0)
    data_ocorrencia: date | None = None
    data_credito: date | None = None
    pagador_nome: str = ""
    pagador_documento: str = ""
    sequencial: int = 0
    payload_bruto: str = ""  # as linhas T e U como vieram, para auditoria


@dataclass
class RetornoLido:
    banco: str
    agencia: str
    conta: str
    data_geracao: date | None
    sequencial_arquivo: int
    ocorrencias: list[OcorrenciaRetorno]
    avisos: list[str] = field(default_factory=list)


class BancoBase(ABC):
    codigo: str  # "033"
    nome: str  # "BANCO SANTANDER"
    nome_curto: str  # "Santander"
    codigo_com_dv: str  # "033-7", como vai impresso no boleto
    local_pagamento: str = "PAGÁVEL EM QUALQUER BANCO ATÉ O VENCIMENTO"

    @abstractmethod
    def calcular_nosso_numero(self, sequencial: int, convenio: DadosConvenio) -> str: ...

    @abstractmethod
    def codigo_barras(self, boleto: DadosBoleto, convenio: DadosConvenio) -> str: ...  # 44 dígitos

    @abstractmethod
    def linha_digitavel(self, codigo_barras: str) -> str: ...  # 47 dígitos

    @abstractmethod
    def formatar_linha_digitavel(self, linha: str) -> str: ...

    @abstractmethod
    def formatar_nosso_numero(self, nosso_numero: str) -> str: ...

    @abstractmethod
    def agencia_codigo_beneficiario(self, convenio: DadosConvenio) -> str: ...

    @abstractmethod
    def validar_convenio(self, convenio: DadosConvenio) -> list[str]: ...

    @abstractmethod
    def validar_boleto(self, boleto: DadosBoleto, convenio: DadosConvenio) -> list[str]: ...

    @abstractmethod
    def gerar_remessa(self, convenio: DadosConvenio, boletos: list[DadosBoleto], sequencial_arquivo: int,
                      data_geracao: date | None = None) -> bytes: ...

    @abstractmethod
    def nome_arquivo_remessa(self, sequencial_arquivo: int, data_geracao: date) -> str: ...

    @abstractmethod
    def ler_retorno(self, conteudo: bytes) -> RetornoLido: ...

    @abstractmethod
    def opcoes(self) -> dict[str, dict[str, str]]:
        """Tabelas de códigos para os selects do cadastro do convênio."""
