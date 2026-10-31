from datetime import date
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.schemas import Schema
from app.modules.financas.models import FormaPagamento, GrupoDre, TipoCategoria, TipoConta, TipoLancamento


def _digitos(v):
    return "".join(c for c in v or "" if c.isdigit()) or None


# ---------- contas bancárias
class ContaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    banco: str | None = Field(default=None, max_length=120)
    agencia: str | None = Field(default=None, max_length=20)
    numero: str | None = Field(default=None, max_length=30)
    tipo: TipoConta = TipoConta.corrente
    titular: str | None = Field(default=None, max_length=200)
    emissora_id: int | None = None
    saldo_inicial: Decimal = Decimal(0)
    data_saldo_inicial: date | None = None
    cor: str = Field(default="#7C8FFF", pattern=r"^#[0-9a-fA-F]{6}$")
    ativo: bool = True


class ContaOut(Schema):
    id: int
    nome: str
    banco: str | None
    agencia: str | None
    numero: str | None
    tipo: TipoConta
    titular: str | None
    emissora_id: int | None
    saldo_inicial: Decimal
    data_saldo_inicial: date | None
    cor: str
    ativo: bool
    saldo_atual: Decimal = Decimal(0)
    entradas_mes: Decimal = Decimal(0)
    saidas_mes: Decimal = Decimal(0)
    qtd_lancamentos: int = 0


class LancamentoIn(BaseModel):
    data: date
    descricao: str = Field(min_length=2, max_length=255)
    tipo: TipoLancamento
    valor: Decimal = Field(gt=0)
    categoria_id: int | None = None
    subcategoria_id: int | None = None
    fornecedor_id: int | None = None
    funcionario_id: int | None = None
    favorecido: str | None = Field(default=None, max_length=200)
    documento: str | None = Field(default=None, max_length=80)
    observacao: str | None = None


class LancamentoOut(Schema):
    id: int
    conta_id: int
    data: date
    descricao: str
    tipo: TipoLancamento
    valor: Decimal
    categoria_id: int | None
    categoria_nome: str | None = None
    subcategoria_id: int | None
    subcategoria_nome: str | None = None
    fornecedor_id: int | None
    funcionario_id: int | None
    favorecido_nome: str | None = None
    documento: str | None
    observacao: str | None
    origem: str
    transferencia_par_id: int | None
    fatura_id: int | None
    fatura_codigo: str | None = None
    conta_pagar_id: int | None = None
    saldo: Decimal | None = None
    editavel: bool = True


class ExtratoOut(BaseModel):
    conta: ContaOut
    de: date
    ate: date
    saldo_anterior: Decimal
    entradas: Decimal
    saidas: Decimal
    saldo_periodo: Decimal
    saldo_final: Decimal
    linhas: list[LancamentoOut]


class TransferenciaIn(BaseModel):
    origem_id: int
    destino_id: int
    data: date
    valor: Decimal = Field(gt=0)
    descricao: str | None = Field(default=None, max_length=200)


# ---------- categorias e fornecedores
class CategoriaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    tipo: TipoCategoria = TipoCategoria.despesa
    grupo_dre: GrupoDre | None = None
    cor: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    ativo: bool = True


class SubcategoriaIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    ativo: bool = True


class SubcategoriaOut(Schema):
    id: int
    categoria_id: int
    nome: str
    ativo: bool
    uso: int = 0


class CategoriaOut(Schema):
    id: int
    nome: str
    tipo: TipoCategoria
    grupo_dre: GrupoDre | None
    cor: str | None
    ativo: bool
    subcategorias: list[SubcategoriaOut] = []
    uso_contas: int = 0
    uso_lancamentos: int = 0
    revisar: bool = False  # veio de importação com nome estranho


class FornecedorIn(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    tipo: str = Field(default="PJ", pattern="^(PF|PJ)$")
    cpf_cnpj: str | None = None
    email: EmailStr | None = None
    telefone: str | None = Field(default=None, max_length=40)
    chave_pix: str | None = Field(default=None, max_length=120)
    banco: str | None = Field(default=None, max_length=80)
    agencia: str | None = Field(default=None, max_length=20)
    conta: str | None = Field(default=None, max_length=30)
    categoria_padrao_id: int | None = None
    observacao: str | None = None
    ativo: bool = True

    _d = field_validator("cpf_cnpj")(_digitos)


class FornecedorOut(Schema):
    id: int
    nome: str
    tipo: str
    cpf_cnpj: str | None
    email: str | None
    telefone: str | None
    chave_pix: str | None
    banco: str | None
    agencia: str | None
    conta: str | None
    categoria_padrao_id: int | None
    observacao: str | None
    ativo: bool
    qtd_contas: int = 0
    total_pago_12m: Decimal = Decimal(0)


# ---------- contas a pagar
class RateioIn(BaseModel):
    categoria_id: int
    subcategoria_id: int | None = None
    valor: Decimal = Field(gt=0)


class RateioOut(Schema):
    categoria_id: int
    categoria_nome: str | None = None
    subcategoria_id: int | None
    subcategoria_nome: str | None = None
    valor: Decimal
    percentual: Decimal


class ContaPagarIn(BaseModel):
    descricao: str | None = Field(default=None, max_length=255)
    fornecedor_id: int | None = None
    funcionario_id: int | None = None
    favorecido: str | None = Field(default=None, max_length=200)
    data_vencimento: date
    data_competencia: date | None = None
    forma_pagamento: FormaPagamento | None = None
    documento: str | None = Field(default=None, max_length=80)
    codigo_barras: str | None = Field(default=None, max_length=60)
    observacao: str | None = None
    conta_bancaria_id: int | None = None
    rateio: list[RateioIn] = Field(min_length=1)
    # recorrência (só na criação)
    recorrencia_meses: int = Field(default=0, ge=0, le=12)
    recorrencia_indeterminada: bool = False
    repeticoes: int | None = Field(default=None, ge=1, le=240)


class ContaPagarEdicaoIn(ContaPagarIn):
    escopo: str = Field(default="ocorrencia", pattern="^(ocorrencia|serie)$")


class ContaPagarOut(Schema):
    id: int
    descricao: str
    fornecedor_id: int | None
    funcionario_id: int | None
    favorecido: str | None
    favorecido_nome: str = ""
    categoria_id: int | None
    categoria_nome: str | None = None
    subcategoria_nome: str | None = None
    valor: Decimal
    data_vencimento: date
    data_competencia: date | None
    forma_pagamento: FormaPagamento | None
    documento: str | None
    codigo_barras: str | None
    observacao: str | None
    grupo_recorrencia: str | None
    recorrencia_meses: int
    recorrencia_indeterminada: bool
    parcela: int | None
    parcelas_total: int | None
    conta_bancaria_id: int | None
    conta_bancaria_nome: str | None = None
    data_pagamento: date | None
    valor_pago: Decimal | None
    juros: Decimal
    desconto: Decimal
    status: str
    dias_atraso: int = 0
    tem_anexo: bool = False
    tem_comprovante: bool = False
    agendamento_enviado_em: date | None
    rateio: list[RateioOut] = []


class ContasPagarListaOut(BaseModel):
    itens: list[ContaPagarOut]
    total: int
    kpis: dict


class PagarIn(BaseModel):
    data: date
    conta_bancaria_id: int | None = None
    juros: Decimal = Field(default=Decimal(0), ge=0)
    desconto: Decimal = Field(default=Decimal(0), ge=0)


class PagarLoteIn(BaseModel):
    ids: list[int] = Field(min_length=1)
    data: date | None = None  # vazio = no vencimento de cada uma
    conta_bancaria_id: int | None = None


class ExcluirContaIn(BaseModel):
    escopo: str = Field(default="ocorrencia", pattern="^(ocorrencia|serie)$")


# ---------- configurações
class ConfigFinanceiroIn(BaseModel):
    conta_recebimento_id: int | None = None
    categoria_honorarios_id: int | None = None
    categoria_reembolso_id: int | None = None
    saldo_minimo: Decimal = Field(default=Decimal(10000), ge=0)
    agendamento_destinatarios: list[EmailStr] = []


class ConfigFinanceiroOut(Schema):
    conta_recebimento_id: int | None
    categoria_honorarios_id: int | None
    categoria_reembolso_id: int | None
    saldo_minimo: Decimal
    agendamento_destinatarios: list[str]


class ConfigImpostosIn(BaseModel):
    regime: str | None = Field(default=None, pattern="^(simples|presumido|real|mei)$")  # grava no cadastro da emissora
    regime_receita: str = Field(default="competencia", pattern="^(competencia|caixa)$")
    anexo: str = Field(default="IV", pattern="^(III|IV|V)$")
    faixas: list[dict] | None = None
    recarregar_tabela: bool = False
    dia_vencimento_das: int = Field(default=20, ge=1, le=31)
    aliq_pis: Decimal = Decimal("0.65")
    aliq_cofins: Decimal = Decimal("3.00")
    presuncao_irpj: Decimal = Decimal("32.00")
    presuncao_csll: Decimal = Decimal("32.00")
    aliq_irpj: Decimal = Decimal("15.00")
    aliq_adicional_irpj: Decimal = Decimal("10.00")
    limite_adicional_trimestre: Decimal = Decimal(60000)
    aliq_csll: Decimal = Decimal("9.00")
    aliq_pis_real: Decimal = Decimal("1.65")
    aliq_cofins_real: Decimal = Decimal("7.60")
    iss_modo: str = Field(default="percentual", pattern="^(percentual|fixo)$")
    iss_fixo_mensal: Decimal = Decimal(0)
    dia_vencimento: int = Field(default=25, ge=1, le=31)
    aliq_cbs: Decimal = Field(default=Decimal("8.80"), ge=0, le=100)
    aliq_ibs: Decimal = Field(default=Decimal("17.70"), ge=0, le=100)
    reducao_ibs_cbs: Decimal = Field(default=Decimal("30.00"), ge=0, le=100)


class ReceitaInformadaIn(BaseModel):
    mes: str = Field(pattern=r"^\d{4}-\d{2}$")
    valor: Decimal = Field(ge=0)
    observacao: str | None = Field(default=None, max_length=300)


class SimularImpostoIn(BaseModel):
    valor: Decimal = Field(gt=0)
    mes: date
