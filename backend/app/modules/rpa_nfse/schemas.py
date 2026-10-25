from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.documentos import so_digitos
from app.core.schemas import Schema
from app.modules.rpa_nfse.models import Regime, StatusFatura, StatusLancamento, StatusLote, StatusNfse, StatusRps


def _digitos(v: str | None) -> str | None:
    return so_digitos(v) or None if v is not None else None


# ---------- Emissora ----------
class EmissoraIn(BaseModel):
    razao_social: str = Field(min_length=2)
    nome_fantasia: str | None = None
    cnpj: str
    ccm: str
    cep: str | None = None
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    cidade: str | None = "São Paulo"
    uf: str | None = "SP"
    email: EmailStr | None = None
    telefone: str | None = None
    banco: str | None = None
    agencia: str | None = None
    conta: str | None = None
    chave_pix: str | None = None
    regime: Regime = Regime.presumido
    cod_servico_padrao: str | None = None
    aliquota_iss: Decimal = Decimal("0.05")
    serie_rps: str = "A"
    prox_rps: int = 1
    certificado_id: int | None = None
    ativa: bool = True

    _d = field_validator("cnpj", "ccm", "cep", "cod_servico_padrao")(_digitos)


class EmissoraOut(Schema):
    id: int
    razao_social: str
    nome_fantasia: str | None
    cnpj: str
    ccm: str
    cep: str | None
    logradouro: str | None
    numero: str | None
    complemento: str | None
    bairro: str | None
    cidade: str | None
    uf: str | None
    email: str | None
    telefone: str | None = None
    banco: str | None = None
    agencia: str | None = None
    conta: str | None = None
    chave_pix: str | None = None
    regime: Regime
    cod_servico_padrao: str | None
    aliquota_iss: Decimal
    serie_rps: str
    prox_rps: int
    certificado_id: int | None
    ativa: bool
    saude_ok: bool = False
    saude_msg: str = ""


# ---------- Tomador ----------
def _so_digitos(v):
    return "".join(c for c in str(v or "") if c.isdigit()) or None


class EnderecoIn(BaseModel):
    tipo: str = Field(default="cobranca", pattern="^(cobranca|correspondencia|entrega|filial|outro)$")
    descricao: str | None = Field(default=None, max_length=80)  # ex.: "Filial Campinas"
    cep: str | None = None
    tipo_logradouro: str | None = Field(default=None, max_length=3)
    logradouro: str | None = Field(default=None, max_length=150)
    numero: str | None = Field(default=None, max_length=10)
    complemento: str | None = Field(default=None, max_length=60)
    bairro: str | None = Field(default=None, max_length=80)
    cidade: str | None = Field(default=None, max_length=80)
    uf: str | None = Field(default=None, max_length=2)

    _cep = field_validator("cep")(_so_digitos)


class ContatoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    cargo: str | None = Field(default=None, max_length=100)  # função / departamento
    email: EmailStr | None = None
    telefone: str | None = Field(default=None, max_length=20)
    celular: str | None = Field(default=None, max_length=20)
    whatsapp: bool = False
    recebe_notas: bool = False  # entra como destinatário dos e-mails de NFS-e/fatura
    principal: bool = False
    observacao: str | None = Field(default=None, max_length=300)

    _tel = field_validator("telefone", "celular")(_so_digitos)


class TelefoneIn(BaseModel):
    numero: str = Field(min_length=8, max_length=20)
    tipo: str = Field(default="comercial", pattern="^(comercial|celular|whatsapp|fixo|fax|outro)$")
    ramal: str | None = Field(default=None, max_length=10)
    descricao: str | None = Field(default=None, max_length=60)  # ex.: "Financeiro"

    _num = field_validator("numero")(lambda v: _so_digitos(v) or v)


class TomadorIn(BaseModel):
    tipo: str = Field(pattern="^(PF|PJ|EX)$")
    nome: str = Field(min_length=2)
    cpf_cnpj: str | None = None
    im: str | None = None
    ie: str | None = None
    tipo_logradouro: str | None = None
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    cidade: str | None = None
    uf: str | None = None
    cep: str | None = None
    emails: list[EmailStr] = []
    telefone: str | None = None
    observacoes: str | None = None
    enderecos: list[EnderecoIn] = []
    contatos: list[ContatoIn] = []
    telefones: list[TelefoneIn] = []

    _d = field_validator("cpf_cnpj", "cep", "im")(_digitos)


class TomadorOut(Schema):
    id: int
    tipo: str
    nome: str
    cpf_cnpj: str | None
    im: str | None
    ie: str | None
    tipo_logradouro: str | None
    logradouro: str | None
    numero: str | None
    complemento: str | None
    bairro: str | None
    cidade: str | None
    uf: str | None
    cep: str | None
    emails: list[str]
    telefone: str | None
    observacoes: str | None
    enderecos: list[dict[str, Any]] = []
    contatos: list[dict[str, Any]] = []
    telefones: list[dict[str, Any]] = []
    incompleto: bool = False
    qtd_notas: int = 0
    valor_acumulado: Decimal = Decimal(0)
    criado_em: datetime


# ---------- Parâmetros fiscais ----------
class ParametroFiscalIn(BaseModel):
    emissora_id: int
    escopo: str = Field(default="padrao", pattern="^(padrao|servico|tomador)$")
    descricao: str | None = None
    cod_servico: str | None = None
    tomador_id: int | None = None
    aliquota_iss: Decimal | None = None
    nbs: str | None = None
    cst_ibscbs: str | None = None
    class_trib: str | None = None
    ind_operacao: str | None = None
    finalidade: str | None = "0"
    ind_final: str | None = "0"
    tipo_operacao: str | None = "1"
    ind_destinatario: str | None = "0"
    tributacao_rps: str = "T"
    prioridade: int = 0
    ativo: bool = True


class ParametroFiscalOut(ParametroFiscalIn, Schema):
    id: int


# ---------- Importação / RPS ----------
class Problema(Schema):
    campo: str
    nivel: str  # erro | aviso
    mensagem: str
    acao: str | None = None
    codigo: int | None = None
    tecnico: str | None = None
    nfse_id: int | None = None


class RpsOut(Schema):
    id: int
    linha: int
    selecionado: bool
    serie: str
    numero: int
    data_emissao: date
    tomador_id: int | None
    tomador_nome: str
    tomador_doc: str | None
    tomador_novo: bool
    cod_servico: str
    aliquota: Decimal
    valor: Decimal
    deducoes: Decimal
    iss: Decimal
    iss_retido: bool
    discriminacao: str
    status: StatusRps
    erros: list[Problema]
    dados: dict[str, Any]
    nfse_id: int | None = None
    nfse_numero: int | None = None


class RpsPatch(BaseModel):
    selecionado: bool | None = None
    descartar: bool | None = None
    data_emissao: date | None = None
    cod_servico: str | None = None
    aliquota: Decimal | None = None
    valor: Decimal | None = None
    deducoes: Decimal | None = None
    iss_retido: bool | None = None
    discriminacao: str | None = None
    tomador: dict[str, Any] | None = None  # nome, cpf_cnpj, email, cep, logradouro...


class ResumoImportacao(Schema):
    qtd: int
    qtd_selecionados: int
    valor_total: Decimal
    iss_total: Decimal
    tomadores_novos: int
    com_erro: int
    com_aviso: int
    ok: int
    pode_emitir: bool


class LoteOut(Schema):
    id: int
    numero: int
    emissora_id: int
    emissora_nome: str
    usuario_nome: str | None
    arquivo_origem: str
    qtd: int
    valor_total: Decimal
    iss_total: Decimal
    status: StatusLote
    sublotes_total: int
    sublotes_feitos: int
    qtd_emitidas: int
    qtd_rejeitadas: int
    mensagem: str | None
    criado_em: datetime
    iniciado_em: datetime | None
    concluido_em: datetime | None


class LoteDetalhe(LoteOut):
    encoding: str | None
    eventos: list[dict[str, Any]]
    resumo: ResumoImportacao
    rps: list[RpsOut]


class ProgressoOut(Schema):
    lote_id: int
    status: StatusLote
    sublotes_total: int
    sublotes_feitos: int
    qtd: int
    qtd_emitidas: int
    qtd_rejeitadas: int
    percentual: float
    mensagem: str | None
    eventos: list[dict[str, Any]]


# ---------- NFS-e ----------
class NfseOut(Schema):
    id: int
    numero: int
    cod_verificacao: str
    data_emissao: datetime
    rps_serie: str
    rps_numero: int
    lote_id: int
    emissora_id: int
    tomador_id: int | None
    tomador_nome: str
    tomador_doc: str | None
    valor: Decimal
    iss: Decimal
    status: StatusNfse
    cancelada_em: datetime | None
    motivo_cancelamento: str | None
    link_prefeitura: str
    simulada: bool
    pago_em: date | None = None
    valor_pago: Decimal | None = None
    baixa_origem: str | None = None
    fatura_id: int | None = None
    fatura_codigo: str | None = None


class NfseDetalhe(NfseOut):
    discriminacao: str
    cod_servico: str
    aliquota: Decimal
    tomador_emails: list[str]
    envios: list[dict[str, Any]]


class CancelarIn(BaseModel):
    motivo: str = Field(min_length=10)


class ZipIn(BaseModel):
    ids: list[int] = []
    lote_id: int | None = None


class EnviarEmailIn(BaseModel):
    destinatarios: list[EmailStr] | None = None  # "Para"; vazio = e-mails do cliente
    cc: list[EmailStr] | None = None
    cco: list[EmailStr] | None = None
    assunto: str | None = Field(default=None, max_length=300)
    corpo: str | None = Field(default=None, max_length=20000)
    anexos: list[str] | None = Field(default=None)  # "pdf", "xml", "fatura"; None = padrão das configurações
    salvar_no_cliente: bool = False  # e-mails novos do "Para" entram no cadastro do cliente


class FiltroNotas(BaseModel):
    q: str | None = None
    status: StatusNfse | None = None
    emissora_id: int | None = None
    lote_id: int | None = None
    de: date | None = None
    ate: date | None = None
    pagamento: str | None = Field(default=None, pattern="^(paga|aberta)$")


class EnviarEmailsLoteIn(BaseModel):
    """Envio em lote: o texto é um MODELO com variáveis, montado nota a nota para o cliente de cada uma."""

    ids: list[int] | None = None
    filtro: FiltroNotas | None = None  # "todas do filtro" (em vez de ids)
    para_extra: list[EmailStr] = []  # além do e-mail de cada cliente
    cc: list[EmailStr] = []
    cco: list[EmailStr] = []
    assunto_modelo: str = Field(min_length=2, max_length=300)
    corpo_modelo: str = Field(min_length=2, max_length=20000)
    anexos: list[str] = ["pdf", "xml", "fatura"]
    pular_ja_enviadas: bool = False


class EnvioLoteOut(Schema):
    total: int
    enviados: int
    falhas: list[dict[str, Any]]
    sem_email: list[dict[str, Any]]
    puladas: int


class ModeloEmailOut(Schema):
    remetente: str
    assunto_modelo: str
    corpo_modelo: str
    assinatura: str
    cc: list[str]
    cco: list[str]
    anexos_padrao: list[str]
    variaveis: list[str]


class AnexoEmail(Schema):
    tipo: str  # pdf | xml | fatura
    nome: str
    tamanho: int
    padrao: bool  # marcado por padrão (configurações)


class EmailPreviaOut(Schema):
    remetente: str
    para: list[str]
    cc: list[str]
    cco: list[str]
    assunto: str
    corpo: str
    anexos: list[AnexoEmail]
    emails_cliente: list[str]
    cliente_id: int | None
    envios: list[dict[str, Any]]


# ---------- Raio-X do arquivo ----------
class Insight(Schema):
    tipo: str  # duplicidade | valor_atipico | ausentes | variacao | concentracao
    nivel: str  # erro | aviso | info
    titulo: str
    texto: str
    rps_ids: list[int]


class RaioXOut(Schema):
    score: int  # 0–100, saúde do arquivo
    frase: str
    insights: list[Insight]
    comparativo: dict[str, Any] | None
    top_clientes: list[dict[str, Any]]
    previsao_segundos: int
    sublotes: int


# ---------- Configurações › Automações ----------
class ConfigAutomacoesIn(BaseModel):
    fatura_ativa: bool = True
    fatura_dias_vencimento: int = Field(default=10, ge=0, le=120)
    fatura_vencimento_modo: str = Field(default="dias", pattern="^(dias|emissao)$")
    fatura_instrucoes: str | None = None
    fatura_anexar_email: bool = True
    relatorio_emissao_ativo: bool = False
    relatorio_destinatarios: list[EmailStr] = []
    relatorio_anexar_planilha: bool = True
    relatorio_anexar_zip: bool = False
    relatorio_baixas_ativo: bool = False
    baixa_automatica: bool = True
    confianca_minima: int = Field(default=85, ge=60, le=100)


class ConfigAutomacoesOut(Schema):
    fatura_ativa: bool
    fatura_dias_vencimento: int
    fatura_vencimento_modo: str
    fatura_instrucoes: str | None
    fatura_anexar_email: bool
    relatorio_emissao_ativo: bool
    relatorio_destinatarios: list[str]
    relatorio_anexar_planilha: bool
    relatorio_anexar_zip: bool
    relatorio_baixas_ativo: bool
    baixa_automatica: bool
    confianca_minima: int


# ---------- Faturas (Notas de Honorários) ----------
class FaturaOut(Schema):
    id: int
    codigo: str  # "NH 2026/00012" · "ND 2026/00003"
    numero: int
    ano: int
    tipo: str = "honorarios"  # honorarios (NH) | despesas (ND)
    origem: str = "nota"  # nota (Lello) | faturamento (Itens a faturar)
    contrato_id: int | None = None
    contrato_nome: str | None = None
    pode_emitir_nfse: bool = False
    nfse_id: int | None
    nfse_numero: int | None
    lote_id: int | None
    emissora_id: int
    tomador_id: int | None
    tomador_nome: str
    tomador_doc: str | None
    data_emissao: date
    data_vencimento: date
    valor: Decimal
    desconto: Decimal
    juros: Decimal
    total: Decimal
    status: StatusFatura
    situacao: str  # aberta | vencida | paga | cancelada
    pago_em: date | None
    descricao: str
    pix_copia_e_cola: str | None
    simulada: bool


# ---------- Recebimentos (extrato → baixa) ----------
class NotaResumo(Schema):
    id: int
    numero: int
    tomador_nome: str
    valor: Decimal
    data_emissao: datetime
    pago_em: date | None
    lote_numero: int


class LancamentoOut(Schema):
    id: int
    data: date
    valor: Decimal
    descricao: str
    documento: str | None
    status: StatusLancamento
    confianca: int
    motivo: str | None
    notas: list[NotaResumo]


class ExtratoOut(Schema):
    id: int
    arquivo_nome: str
    formato: str
    banco: str | None
    periodo_de: date | None
    periodo_ate: date | None
    qtd_creditos: int
    qtd_conciliados: int
    qtd_sugeridos: int
    valor_creditos: Decimal
    valor_conciliado: Decimal
    notas_baixadas: int
    criado_em: datetime


class ExtratoDetalhe(ExtratoOut):
    lancamentos: list[LancamentoOut]


class ConfirmarLancamentoIn(BaseModel):
    nfse_ids: list[int] = []  # vazio = confirma a sugestão do robô


class BaixaManualIn(BaseModel):
    data: date
    valor: Decimal | None = None
    conta_bancaria_id: int | None = None  # onde o dinheiro entrou (vazio = conta padrão de recebimento)


# ---------- Configurações › Prefeitura ----------
class ConfigPrefeituraOut(Schema):
    modo: str
    modos_permitidos: list[str]
    ambiente: str
    endpoint: str


class ConfigPrefeituraIn(BaseModel):
    modo: str = Field(pattern="^(simulado|teste|producao)$")
    confirmacao: str | None = None  # para "producao": digitar EMITIR NOTAS REAIS


# ---------- Painel ----------
class Indicador(Schema):
    valor: float
    anterior: float
    variacao: float | None


class Alerta(Schema):
    nivel: str  # info | aviso | erro
    texto: str
    href: str | None = None


class PainelOut(Schema):
    a_receber: float = 0
    a_receber_qtd: int = 0
    recebido_mes: float = 0
    notas_emitidas: Indicador
    valor_faturado: Indicador
    iss: Indicador
    rejeicoes: Indicador
    tempo_medio_lote_seg: Indicador
    por_dia: list[dict[str, Any]]
    top_tomadores: list[dict[str, Any]]
    status_lotes: list[dict[str, Any]]
    alertas: list[Alerta]
    ultimos_lotes: list[LoteOut]
