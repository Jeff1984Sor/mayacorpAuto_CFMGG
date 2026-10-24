from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.core.schemas import Schema
from app.modules.faturamento.models import (
    Frequencia,
    StatusCaso,
    Termino,
    TipoAndamento,
    TipoCampo,
    TipoCaso,
    TipoDespesa,
    TipoRegra,
)


# ---------- funcionários e tabelas de preço (cargo × valor/hora)
class ProfissionalOut(BaseModel):
    id: int
    nome: str
    email: str
    cargo_id: int | None
    cargo_nome: str | None
    oab: str | None
    acesso_sistema: bool
    ativo: bool


class TabelaItemIn(BaseModel):
    cargo_id: int
    valor_hora: Decimal = Field(ge=0)


class TabelaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    ativo: bool = True
    itens: list[TabelaItemIn] = []


class TabelaItemOut(Schema):
    cargo_id: int
    valor_hora: Decimal


class TabelaOut(Schema):
    id: int
    nome: str
    ativo: bool
    itens: list[TabelaItemOut]


# ---------- contratos e casos
class ContratoIn(BaseModel):
    tomador_id: int
    emissora_id: int | None = None
    tabela_preco_id: int | None = None  # valor/hora das regras por hora
    nome: str = Field(min_length=2, max_length=200)
    objeto: str | None = None
    data_inicio: date | None = None
    data_fim: date | None = None
    ativo: bool = True
    observacao: str | None = None


class ContratoOut(Schema):
    id: int
    numero: int
    tomador_id: int
    tomador_nome: str
    emissora_id: int | None
    tabela_preco_id: int | None
    tabela_preco_nome: str | None = None
    nome: str
    objeto: str | None
    data_inicio: date | None
    data_fim: date | None
    ativo: bool
    observacao: str | None
    qtd_casos: int = 0
    qtd_regras: int = 0


class AreaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=100)
    cor: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    ordem: int = 0
    ativo: bool = True


class AreaOut(Schema):
    id: int
    nome: str
    cor: str | None
    ordem: int
    ativo: bool
    qtd_casos: int = 0


class CampoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=100)
    tipo: TipoCampo = TipoCampo.texto
    opcoes: list[str] = []
    obrigatorio: bool = False
    ajuda: str | None = Field(default=None, max_length=200)
    area_id: int | None = None
    ordem: int = 0
    ativo: bool = True

    @model_validator(mode="after")
    def _opcoes(self):
        self.opcoes = [o.strip() for o in self.opcoes if o and o.strip()]
        if self.tipo == TipoCampo.lista and not self.opcoes:
            raise ValueError("Informe as opções da lista.")
        return self


class CampoOut(Schema):
    id: int
    nome: str
    tipo: TipoCampo
    opcoes: list[str]
    obrigatorio: bool
    ajuda: str | None
    area_id: int | None
    ordem: int
    ativo: bool
    qtd_preenchidos: int = 0


class CasoIn(BaseModel):
    titulo: str = Field(min_length=2, max_length=250)
    descricao: str | None = None
    numero_processo: str | None = Field(default=None, max_length=40)
    parte_contraria: str | None = Field(default=None, max_length=200)
    tipo: TipoCaso | None = None  # consultivo, administrativo, judicial estadual/federal/trabalhista
    area_id: int | None = None
    polo: str | None = Field(default=None, pattern="^(ativo|passivo|terceiro|consultivo)$")
    instancia: str | None = Field(default=None, pattern="^(primeira|juizado|segunda|turma_recursal|superior|stf)$")
    tribunal: str | None = Field(default=None, max_length=80)
    vara: str | None = Field(default=None, max_length=120)
    comarca: str | None = Field(default=None, max_length=80)
    valor_causa: Decimal | None = Field(default=None, ge=0)
    data_distribuicao: date | None = None
    campos: dict[str, Any] | None = None  # {"<id do campo>": valor}
    responsavel_id: int | None = None
    tabela_preco_id: int | None = None  # vazio = a do contrato
    status: StatusCaso = StatusCaso.aberto
    data_abertura: date | None = None
    data_encerramento: date | None = None


class CasoOut(Schema):
    id: int
    numero: int
    contrato_id: int
    contrato_nome: str
    contrato_numero: int
    tomador_id: int
    tomador_nome: str
    titulo: str
    descricao: str | None
    numero_processo: str | None
    parte_contraria: str | None
    responsavel_id: int | None
    responsavel_nome: str | None
    tipo: TipoCaso | None = None
    tipo_nome: str | None = None
    area_id: int | None = None
    area_nome: str | None = None
    area_cor: str | None = None
    polo: str | None = None
    instancia: str | None = None
    instancia_nome: str | None = None
    tribunal: str | None = None
    vara: str | None = None
    comarca: str | None = None
    valor_causa: Decimal | None = None
    data_distribuicao: date | None = None
    campos: dict[str, Any] = {}
    qtd_anexos: int = 0
    qtd_andamentos: int = 0
    tabela_preco_id: int | None
    tabela_preco_efetiva: str | None = None  # nome da tabela que vale (caso ou contrato)
    status: StatusCaso
    data_abertura: date | None
    data_encerramento: date | None
    tem_regra_propria: bool = False
    horas_pendentes: Decimal = Decimal(0)
    despesas_pendentes: Decimal = Decimal(0)


# ---------- regras de cobrança
class RegraIn(BaseModel):
    tipo: TipoRegra
    descricao: str = Field(min_length=2, max_length=300)
    valor: Decimal | None = Field(default=None, ge=0)
    data_pagamento: date | None = None
    frequencia: Frequencia | None = None
    intervalo: int = Field(default=1, ge=1, le=99)
    data_inicio: date | None = None
    termino: Termino = Termino.sem
    ocorrencias: int | None = Field(default=None, ge=1, le=999)
    data_fim: date | None = None
    tabela_preco_id: int | None = None
    ativo: bool = True
    observacao: str | None = None

    @model_validator(mode="after")
    def _coerente(self):
        if self.tipo in (TipoRegra.fixo, TipoRegra.recorrente) and not self.valor:
            raise ValueError("Informe o valor da cobrança.")
        if self.tipo == TipoRegra.fixo and not self.data_pagamento:
            raise ValueError("Informe a data de pagamento.")
        if self.tipo == TipoRegra.recorrente:
            if not self.frequencia or not self.data_inicio:
                raise ValueError("Informe a frequência e quando começa.")
            if self.termino == Termino.ocorrencias and not self.ocorrencias:
                raise ValueError("Informe a quantidade de parcelas.")
            if self.termino == Termino.data and (not self.data_fim or self.data_fim < self.data_inicio):
                raise ValueError("A data de término deve ser depois do início.")
        return self


class RegraOut(Schema):
    id: int
    contrato_id: int
    caso_id: int | None
    tipo: TipoRegra
    descricao: str
    valor: Decimal | None
    data_pagamento: date | None
    frequencia: Frequencia | None
    intervalo: int
    data_inicio: date | None
    termino: Termino
    ocorrencias: int | None
    data_fim: date | None
    tabela_preco_id: int | None
    ativo: bool
    observacao: str | None
    resumo: str = ""  # "Mensal, todo dia 5 · 12 parcelas"
    parcelas_faturadas: int = 0
    proxima: date | None = None


# ---------- timesheet e despesas
class TimesheetIn(BaseModel):
    profissional_id: int | None = None  # funcionário (usuário); padrão: quem lança
    data: date
    minutos: int = Field(gt=0, le=24 * 60)
    descricao: str = Field(min_length=2, max_length=5000)
    faturavel: bool = True


class TimesheetOut(Schema):
    id: int
    caso_id: int
    profissional_id: int
    profissional_nome: str
    cargo_nome: str | None = None
    data: date
    minutos: int
    descricao: str
    faturavel: bool
    faturado: bool
    fatura_codigo: str | None = None


class DespesaIn(BaseModel):
    data: date
    tipo: TipoDespesa = TipoDespesa.outros
    descricao: str = Field(min_length=2, max_length=300)
    valor: Decimal = Field(gt=0)
    reembolsavel: bool = True


class DespesaOut(Schema):
    id: int
    caso_id: int
    data: date
    tipo: TipoDespesa
    descricao: str
    valor: Decimal
    reembolsavel: bool
    tem_comprovante: bool
    lancado_por: str | None
    faturado: bool
    fatura_codigo: str | None = None


# ---------- itens a faturar
class ItemPendenteOut(BaseModel):
    chave: str
    tipo: str
    caso_id: int | None
    caso_numero: int | None
    caso_titulo: str | None
    data: date
    descricao: str
    valor: Decimal
    parcela: str | None
    quantidade: Decimal | None
    valor_unitario: Decimal | None
    profissional: str | None
    aviso: str | None


class ContratoPendenteOut(BaseModel):
    contrato_id: int
    contrato_numero: int
    contrato_nome: str
    total: Decimal
    itens: list[ItemPendenteOut]


class ClientePendenteOut(BaseModel):
    tomador_id: int
    tomador_nome: str
    tomador_doc: str | None
    total: Decimal
    qtd_itens: int
    tipos: dict[str, Decimal]  # total por tipo de regra
    contratos: list[ContratoPendenteOut]


class ItensAFaturarOut(BaseModel):
    clientes: list[ClientePendenteOut]
    total: Decimal
    qtd_itens: int


class FaturarIn(BaseModel):
    aba: str = Field(pattern="^(honorarios|despesas)$")
    de: date
    ate: date
    chaves: list[str] = Field(min_length=1)
    cliente_ids: list[int] | None = None
    tipos: list[str] | None = None


class FaturadaOut(BaseModel):
    id: int
    codigo: str
    tomador_nome: str
    contrato_nome: str | None
    valor: Decimal
    data_vencimento: date


class FaturarOut(BaseModel):
    faturas: list[FaturadaOut]
    total: Decimal


class EmitirNfseIn(BaseModel):
    fatura_ids: list[int] = Field(min_length=1)


class CancelarFaturaIn(BaseModel):
    motivo: str = Field(min_length=3, max_length=500)


# ---------- revisão (pré-fatura)
class EnviarRevisaoIn(FaturarIn):
    pass


class RevisaoItemOut(Schema):
    id: int
    chave: str
    tipo: str
    regra_id: int | None
    caso_id: int | None
    caso_numero: int | None = None
    caso_titulo: str | None = None
    competencia: date | None
    parcela: str | None
    data: date
    descricao: str
    profissional: str | None
    profissional_id: int | None = None
    quantidade: Decimal | None
    valor_unitario: Decimal | None
    valor: Decimal
    valor_original: Decimal
    excluido: bool
    manual: bool


class RevisaoResumoOut(BaseModel):
    id: int
    numero: int
    aba: str
    status: str
    contrato_id: int
    contrato_numero: int
    contrato_nome: str
    tomador_id: int
    tomador_nome: str
    de: date
    ate: date
    responsavel_nome: str | None
    criado_em: str
    qtd_itens: int
    total: Decimal
    total_original: Decimal
    fatura_id: int | None
    fatura_codigo: str | None
    nota_ia: int | None


class RevisaoOut(RevisaoResumoOut):
    observacao: str | None
    nota_interna: str | None
    responsavel_id: int | None
    ia_analise: dict | None
    eventos: list[dict]
    itens: list[RevisaoItemOut]
    casos: list[dict]  # casos do contrato, para os formulários
    total_horas: Decimal


class RevisaoPatch(BaseModel):
    observacao: str | None = None
    nota_interna: str | None = None
    responsavel_id: int | None = None


class RevisaoItemPatch(BaseModel):
    descricao: str | None = Field(default=None, min_length=2, max_length=5000)
    quantidade: Decimal | None = Field(default=None, gt=0, le=24)
    valor: Decimal | None = Field(default=None, ge=0)
    excluido: bool | None = None


class RevisaoHorasIn(BaseModel):
    caso_id: int
    profissional_id: int | None = None
    data: date
    minutos: int = Field(gt=0, le=24 * 60)
    descricao: str = Field(min_length=2, max_length=5000)
    valor_hora: Decimal | None = Field(default=None, ge=0)


class RevisaoLancamentoIn(BaseModel):
    data: date
    descricao: str = Field(min_length=2, max_length=300)
    valor: Decimal = Field(gt=0)
    caso_id: int | None = None
    tipo_despesa: TipoDespesa | None = None


class IncluirIn(BaseModel):
    chaves: list[str] = Field(min_length=1)


class DescartarIn(BaseModel):
    motivo: str | None = Field(default=None, max_length=500)


class AnexoOut(Schema):
    id: int
    caso_id: int
    despesa_id: int | None = None
    nome: str
    descricao: str | None
    categoria: str | None
    tamanho: int
    mime: str | None
    enviado_por: str | None = None
    criado_em: str


class AndamentoIn(BaseModel):
    data: date
    tipo: TipoAndamento = TipoAndamento.andamento
    titulo: str = Field(min_length=2, max_length=200)
    descricao: str | None = Field(default=None, max_length=20000)
    prazo: date | None = None
    concluido: bool = False
    responsavel_id: int | None = None


class AndamentoOut(Schema):
    id: int
    caso_id: int
    data: date
    tipo: TipoAndamento
    titulo: str
    descricao: str | None
    prazo: date | None
    concluido: bool
    responsavel_id: int | None
    responsavel_nome: str | None = None
    criado_por: str | None = None
    criado_em: datetime
    atrasado: bool = False


class ResumoCasoOut(BaseModel):
    resumo: str
    situacao_atual: str
    proximos_passos: list[str]
    riscos: list[str]
    gerado_em: str
