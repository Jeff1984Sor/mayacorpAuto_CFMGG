from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.schemas import Schema
from app.modules.faturamento.models import (
    FormaFaixa,
    Frequencia,
    PrioridadeTarefa,
    StatusCaso,
    StatusTarefa,
    Termino,
    TipoAndamento,
    TipoCampo,
    TipoCaso,
    TipoDespesa,
    TipoRegra,
    TipoTarefa,
)
from app.modules.faturamento.tipos_caso import TipoDeCaso, TipoVinculo


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
class PagadorIn(BaseModel):
    tomador_id: int
    percentual: Decimal = Field(gt=0, le=100)


class PagadorOut(PagadorIn):
    tomador_nome: str


class ContratoIn(BaseModel):
    tomador_id: int
    # vazio = o próprio cliente paga tudo; um = outro cliente paga; vários = contrato dividido (soma 100%)
    pagadores: list[PagadorIn] = []
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
    pagadores: list[PagadorOut] = []
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
    tomador_id: int | None = None  # só para casos deste cliente
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
    tomador_id: int | None = None
    tomador_nome: str | None = None
    ordem: int
    ativo: bool
    qtd_preenchidos: int = 0


class ModeloTituloIn(BaseModel):
    modelo_titulo_caso: str | None = Field(default=None, max_length=300)
    arquivo_modelo: str | None = Field(default=None, max_length=300)  # nome dos arquivos NH/NF (vazio = título do caso)
    pasta_modelo: str | None = Field(default=None, max_length=300)  # pasta do caso na rede (vazio = título do caso)
    nota_titulo_caso: bool | None = None  # vazio = segue Configurações › Automações
    nota_texto_regra: bool | None = None
    fatura_agrupamento: str | None = Field(default=None, pattern="^(contrato|caso|cobranca)$")
    nota_contrato: bool | None = None  # nome do contrato na nota (vazio = sim)
    nota_campo_inicio_id: int | None = None  # campo do caso que abre o texto da nota


class ModeloTituloOut(BaseModel):
    tomador_id: int
    modelo_titulo_caso: str | None
    arquivo_modelo: str | None = None
    pasta_modelo: str | None = None
    nota_titulo_caso: bool | None = None
    nota_texto_regra: bool | None = None
    fatura_agrupamento: str | None = None
    nota_contrato: bool | None = None
    nota_campo_inicio_id: int | None = None
    padrao: list[str]  # rótulos dos campos padrão que podem ir entre chaves
    atualizados: int = 0


class CasoIn(BaseModel):
    titulo: str = Field(default="", max_length=250)  # vazio vale quando o cliente tem modelo de título
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
    status: StatusCaso = StatusCaso.aberto  # aberto (ativo) | suspenso | arquivado | encerrado
    data_abertura: date | None = None
    data_encerramento: date | None = None  # obrigatória quando encerrado
    # --- tipos de caso. Sem tipo_caso, vale o `tipo` antigo; sem os dois: com nº de processo é contencioso, senão consultivo.
    # Os campos abaixo só são alterados quando vêm no pedido (telas antigas não mandam e não apagam nada).
    tipo_caso: TipoDeCaso | None = None
    equipe_ids: list[int] | None = None  # demais profissionais (o responsável fica em responsavel_id)
    etiqueta_ids: list[int] | None = None  # itens da lista "etiqueta"
    motivo_encerramento_id: int | None = None  # lista "motivo_encerramento"
    origem_id: int | None = None  # lista "origem"
    centro_custo_id: int | None = None  # lista "centro_custo"
    valor_estimado: Decimal | None = Field(default=None, ge=0)
    caso_pai_id: int | None = None
    tipo_vinculo: TipoVinculo | None = None
    sigiloso: bool | None = None
    observacoes: str | None = None
    # dados só do tipo do caso (mande o bloco do tipo; os outros ficam vazios)
    contencioso: "ContenciosoDados | None" = None
    consultivo: "ConsultivoDados | None" = None
    administrativo: "AdministrativoDados | None" = None


class ItemNome(BaseModel):
    id: int
    nome: str


def _opcoes(obj, *campos: str) -> None:
    """Listas fixas do sistema: confere o valor contra tipos_caso.ROTULOS (as opções saem em /faturamento/casos/opcoes)."""
    from app.modules.faturamento.tipos_caso import ROTULOS

    for campo in campos:
        v = getattr(obj, campo)
        if v is not None and v not in ROTULOS[campo]:
            raise ValueError(f"{campo}: use uma destas opções: {', '.join(ROTULOS[campo])}.")


_Valor = Field(default=None, ge=0)


class ContenciosoDados(BaseModel):
    """Dados do processo que não ficam no caso (entra e sai igual). Número CNJ, tribunal, vara, comarca, instância,
    valor da causa, distribuição e polo continuam nos campos de sempre do caso. Os *_nome são só de leitura."""

    pre_ajuizamento: bool = False  # ainda sem número CNJ
    numero_antigo: str | None = Field(default=None, max_length=40)
    justica: str | None = None  # preenchida pelo número CNJ
    uf: str | None = Field(default=None, pattern="^[A-Za-z]{2}$")
    codigo_orgao: str | None = Field(default=None, max_length=4)
    juiz_relator: str | None = Field(default=None, max_length=150)
    sistema_tribunal: str | None = None
    classe_id: int | None = None  # lista "classe"
    classe_nome: str | None = None
    assunto_id: int | None = None  # lista "assunto"
    assunto_nome: str | None = None
    assuntos_secundarios_ids: list[int] = []
    assuntos_secundarios: list[ItemNome] = []
    rito: str | None = None
    fase_processual: str | None = None
    data_citacao: date | None = None
    data_transito_julgado: date | None = None
    valor_condenacao: Decimal | None = _Valor
    valor_acordo: Decimal | None = _Valor
    prognostico: str | None = None
    valor_provisionado: Decimal | None = _Valor
    valor_risco: Decimal | None = _Valor
    deposito_judicial: Decimal | None = _Valor
    justica_gratuita: bool = False
    segredo_justica: bool = False
    tutela_liminar: str | None = None
    resultado: str | None = None
    monitorar_andamentos: bool = True

    @model_validator(mode="after")
    def _listas(self):
        _opcoes(self, "justica", "sistema_tribunal", "rito", "fase_processual", "prognostico", "tutela_liminar", "resultado")
        return self


class ConsultivoDados(BaseModel):
    tipo_demanda_id: int | None = None  # lista "tipo_demanda" (obrigatório)
    tipo_demanda_nome: str | None = None
    solicitante_id: int | None = None  # Pessoa do cadastro único
    solicitante_nome: str | None = None
    departamento_solicitante: str | None = Field(default=None, max_length=100)
    data_solicitacao: date | None = None  # vazio = data de abertura
    prazo_entrega: date | None = None
    sla_dias: int | None = Field(default=None, ge=0, le=3650)
    prioridade: str = "media"
    complexidade: str | None = None
    etapa: str = "recebido"
    horas_estimadas: Decimal | None = Field(default=None, ge=0, le=99999)
    horas_realizadas: Decimal | None = None  # leitura: soma do timesheet
    valor_envolvido: Decimal | None = _Valor
    contrato_vigencia_inicio: date | None = None
    contrato_vigencia_fim: date | None = None
    renovacao_automatica: bool = False
    data_entrega: date | None = None  # obrigatória quando a etapa é entregue ou concluído
    documento_entregue_id: int | None = None  # anexo do caso
    risco_identificado: str | None = None
    recomendacao_resumo: str | None = None
    gerou_contencioso_id: int | None = None  # caso judicial que nasceu daqui
    gerou_contencioso_titulo: str | None = None

    @model_validator(mode="after")
    def _listas(self):
        _opcoes(self, "prioridade", "complexidade", "etapa", "risco_identificado")
        return self


class AdministrativoDados(BaseModel):
    esfera: str | None = None  # obrigatória
    orgao_id: int | None = None  # lista "orgao" (obrigatório)
    orgao_nome: str | None = None
    unidade_orgao: str | None = Field(default=None, max_length=150)
    uf: str | None = Field(default=None, pattern="^[A-Za-z]{2}$")
    municipio: str | None = Field(default=None, max_length=80)
    tipo_procedimento_id: int | None = None  # lista "tipo_procedimento" (obrigatório)
    tipo_procedimento_nome: str | None = None
    numero_processo_adm: str | None = Field(default=None, max_length=60)  # este ou o protocolo, depois de protocolado
    numero_protocolo: str | None = Field(default=None, max_length=60)
    numero_auto_infracao: str | None = Field(default=None, max_length=60)
    numero_nb: str | None = Field(default=None, max_length=30)
    instancia_adm: str | None = None  # vazio = primeira
    fase_adm: str | None = None  # vazio = pré-protocolo (sem número) ou protocolado
    data_ciencia: date | None = None
    prazo_defesa: date | None = None
    data_protocolo: date | None = None
    valor_autuado: Decimal | None = _Valor
    valor_multa: Decimal | None = _Valor
    valor_juros: Decimal | None = _Valor
    valor_atualizado: Decimal | None = _Valor
    data_atualizacao_valor: date | None = None
    exigibilidade_suspensa: bool = False
    garantia: str | None = None
    prognostico: str | None = None
    decisao: str | None = None
    data_decisao: date | None = None
    cabe_judicializacao: bool = False
    prazo_judicializacao: date | None = None
    caso_judicial_id: int | None = None  # contencioso que nasceu daqui
    caso_judicial_titulo: str | None = None
    link_sistema_orgao: str | None = Field(default=None, max_length=300, pattern="^https?://")

    @model_validator(mode="after")
    def _listas(self):
        _opcoes(self, "esfera", "instancia_adm", "fase_adm", "garantia", "prognostico", "decisao")
        return self


class CasoRef(BaseModel):
    caso_id: int
    numero: int
    titulo: str


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
    qtd_tarefas_abertas: int = 0
    tabela_preco_id: int | None
    tabela_preco_efetiva: str | None = None  # nome da tabela que vale (caso ou contrato)
    status: StatusCaso
    data_abertura: date | None
    data_encerramento: date | None
    tem_regra_propria: bool = False
    horas_pendentes: Decimal = Decimal(0)
    despesas_pendentes: Decimal = Decimal(0)
    # --- tipos de caso
    tipo_caso: TipoDeCaso
    tipo_caso_nome: str
    status_nome: str
    equipe_ids: list[int] = []
    equipe: list[ItemNome] = []
    etiqueta_ids: list[int] = []
    etiquetas: list[ItemNome] = []
    motivo_encerramento_id: int | None = None
    motivo_encerramento_nome: str | None = None
    origem_id: int | None = None
    origem_nome: str | None = None
    centro_custo_id: int | None = None
    centro_custo_nome: str | None = None
    valor_estimado: Decimal | None = None
    caso_pai_id: int | None = None
    caso_pai_titulo: str | None = None
    tipo_vinculo: TipoVinculo | None = None
    sigiloso: bool = False
    observacoes: str | None = None
    contencioso: ContenciosoDados | None = None  # só o bloco do tipo do caso vem preenchido
    consultivo: ConsultivoDados | None = None
    administrativo: AdministrativoDados | None = None
    aviso_cnj_duplicado: CasoRef | None = None  # outro caso do escritório com o mesmo número CNJ (aviso, não bloqueia)
    partes_resumo: str | None = None  # "Ativo x Passivo" (coluna Partes da lista)
    titulo_sugerido: str | None = None  # contencioso: "{principal do polo ativo} x {principal do polo passivo}"
    pendentes_reclassificacao: int = 0  # partes a revisar (depois de troca de tipo ou da migração)


# ---------- regras de cobrança
class FaixaIn(BaseModel):
    """Uma faixa de horas da tabela progressiva / regressiva (regra por hora)."""

    de: Decimal = Field(ge=0, le=99999)
    ate: Decimal | None = Field(default=None, gt=0, le=99999)  # vazio = em diante (só a última)
    forma: FormaFaixa
    valor: Decimal | None = Field(default=None, ge=0)
    tabela_preco_id: int | None = None
    percentual: Decimal | None = Field(default=None, gt=0, le=1000)


class FaixaOut(Schema):
    de: Decimal
    ate: Decimal | None
    forma: FormaFaixa
    valor: Decimal | None
    tabela_preco_id: int | None
    percentual: Decimal | None


def _h(v: Decimal) -> str:
    return f"{v.normalize():f}".replace(".", ",")


def validar_faixas(faixas: list[FaixaIn]) -> None:
    """Faixas contíguas: começam em 0, sem buraco nem sobreposição, e a última vai "em diante"."""
    if len(faixas) > 20:
        raise ValueError("Use no máximo 20 faixas.")
    if faixas[0].de != 0:
        raise ValueError("A primeira faixa precisa começar em 0 hora.")
    for n, f in enumerate(faixas, start=1):
        ultima = n == len(faixas)
        if f.ate is None and not ultima:
            raise ValueError(f"Só a última faixa pode ficar sem limite: informe até quantas horas vai a faixa {n}.")
        if f.ate is not None and ultima:
            raise ValueError('A última faixa precisa ser "em diante" (sem limite), para nenhuma hora ficar sem preço.')
        if f.ate is not None and f.ate <= f.de:
            raise ValueError(f"Na faixa {n}, o fim ({_h(f.ate)} h) precisa ser maior que o início ({_h(f.de)} h).")
        if not ultima and faixas[n].de != f.ate:
            problema = "sobrou um buraco" if faixas[n].de > f.ate else "as faixas se sobrepõem"
            raise ValueError(f"A faixa {n + 1} precisa começar onde a faixa {n} termina ({_h(f.ate)} h): {problema}.")
        if f.forma == FormaFaixa.fixo and f.valor is None:
            raise ValueError(f"Informe o valor fixo da faixa {n}.")
        if f.forma == FormaFaixa.hora and not f.valor:
            raise ValueError(f"Informe o valor por hora da faixa {n}.")
        if f.forma == FormaFaixa.tabela and not f.tabela_preco_id:
            raise ValueError(f"Escolha a tabela de preço da faixa {n}.")
        if f.forma == FormaFaixa.percentual and not f.percentual:
            raise ValueError(f"Informe o percentual da faixa {n}.")


class RegraIn(BaseModel):
    tipo: TipoRegra
    descricao: str = Field(min_length=2, max_length=4000)
    valor: Decimal | None = Field(default=None, ge=0)
    data_pagamento: date | None = None
    frequencia: Frequencia | None = None
    intervalo: int = Field(default=1, ge=1, le=99)
    data_inicio: date | None = None
    termino: Termino = Termino.sem
    ocorrencias: int | None = Field(default=None, ge=1, le=999)
    data_fim: date | None = None
    tabela_preco_id: int | None = None
    faixas_modo: str = Field(default="escalonada", pattern="^(escalonada|atingida)$")
    faixas: list[FaixaIn] = []  # só na regra por hora; vazio = cobra como sempre (tabela × cargo)
    ativo: bool = True
    observacao: str | None = None

    @model_validator(mode="after")
    def _coerente(self):
        if self.tipo != TipoRegra.hora:
            self.faixas, self.faixas_modo = [], "escalonada"
        elif self.faixas:
            validar_faixas(self.faixas)
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
    faixas_modo: str = "escalonada"
    faixas: list[FaixaOut] = []
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
    detalhe: str | None = None  # regra por faixas: de onde veio o valor


class ContratoPendenteOut(BaseModel):
    contrato_id: int
    contrato_numero: int
    contrato_nome: str
    pagadores: list[PagadorOut] = []  # vazio = o próprio cliente paga
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
    detalhe: str | None = None  # regra por faixas: de onde veio o valor


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
    caso_id: int | None
    despesa_id: int | None = None
    tarefa_id: int | None = None
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

    @field_validator("tipo")
    @classmethod
    def _sem_prazo(cls, v):
        if v in (TipoAndamento.prazo, TipoAndamento.audiencia, TipoAndamento.reuniao):
            raise ValueError("Prazos, audiências e reuniões agora são Tarefas: use a aba Tarefas do caso.")
        return v

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


class TarefaIn(BaseModel):
    caso_id: int | None = None
    titulo: str = Field(min_length=2, max_length=200)
    descricao: str | None = Field(default=None, max_length=20000)
    tipo: TipoTarefa = TipoTarefa.outro
    status: StatusTarefa = StatusTarefa.a_fazer
    prioridade: PrioridadeTarefa = PrioridadeTarefa.media
    prazo: date | None = None
    hora: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    responsavel_id: int | None = None
    etiquetas: list[str] = []


class TarefaOut(Schema):
    id: int
    caso_id: int | None
    caso_numero: int | None = None
    caso_titulo: str | None = None
    cliente_nome: str | None = None
    titulo: str
    descricao: str | None
    tipo: TipoTarefa
    status: StatusTarefa
    prioridade: PrioridadeTarefa
    prazo: date | None
    hora: str | None
    responsavel_id: int | None
    responsavel_nome: str | None = None
    etiquetas: list[str]
    concluida_em: date | None
    criado_por: str | None = None
    criado_em: datetime
    atrasada: bool = False
    dias_para_prazo: int | None = None
    qtd_anexos: int = 0


class TarefasListaOut(BaseModel):
    itens: list[TarefaOut]
    resumo: dict[str, int]


CasoIn.model_rebuild()
