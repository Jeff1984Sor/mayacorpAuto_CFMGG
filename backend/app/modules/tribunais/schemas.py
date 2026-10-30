"""Entradas da API da integração com tribunais (as saídas são montadas em routes._*_out)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

UF = Field(pattern="^[A-Z]{2}$")
Escopo = Literal["consulta", "download", "protocolo"]
Evento = Literal["protocolo_sucesso", "protocolo_falha", "protocolo_inicial_distribuido", "protocolo_intermediaria"]
Polo = Literal["ativo", "passivo", "terceiro", "fiscal_lei", "vitima", "testemunha", "outro"]


def _digitos(v):
    return "".join(c for c in str(v or "") if c.isdigit()) or None


class OabIn(BaseModel):
    numero: str = Field(min_length=1, max_length=10)
    uf: str = UF
    tipo: Literal["principal", "suplementar", "estagiario"] = "principal"
    letra_complementar: str | None = Field(default=None, max_length=2)
    situacao: Literal["regular", "suspensa", "cancelada"] | None = None

    _n = field_validator("numero")(lambda v: _digitos(v) or v)


class PreferenciaIn(BaseModel):
    evento: Evento
    receber: bool = True
    email_alternativo: EmailStr | None = None


class VarreduraIn(BaseModel):
    advogado_id: int
    data_inicio: date | None = None
    data_fim: date | None = None
    tribunais_alvo: list[str] = []
    so_novas: bool = False  # busca de intimações: desde a última varredura do advogado


class ComunicacoesIn(BaseModel):
    itens: list[dict] = Field(max_length=500)


class ConcluirIn(BaseModel):
    erro: str | None = Field(default=None, max_length=1000)
    parcial: bool = False


class ImportarIn(BaseModel):
    encontrado_ids: list[int] = []
    todos: bool = False


class ImportarNumeroIn(BaseModel):
    numero_cnj: str = Field(min_length=20, max_length=25)
    advogado_id: int | None = None


class ProcessoPatch(BaseModel):
    responsavel_interno_id: int | None = None
    status_interno: str | None = Field(default=None, max_length=60)
    monitorar: bool | None = None
    situacao: Literal["ativo", "suspenso", "arquivado", "baixado", "extinto"] | None = None
    justica_gratuita: bool | None = None


class LidasIn(BaseModel):
    ids: list[int] = []
    todas: bool = False


class TarefaPrazoIn(BaseModel):
    prazo: date
    titulo: str | None = Field(default=None, max_length=200)
    responsavel_id: int | None = None
    prioridade: Literal["baixa", "media", "alta", "urgente"] = "alta"


class VinculoIn(BaseModel):
    cliente_id: int
    parte_id: int | None = None


class CriarClienteIn(BaseModel):
    parte_id: int


class CriarCasoIn(BaseModel):
    contrato_id: int
    titulo: str | None = Field(default=None, max_length=250)


class LigarCasoIn(BaseModel):
    caso_id: int


class EnderecoParte(BaseModel):
    cep: str | None = None
    logradouro: str | None = Field(default=None, max_length=150)
    numero: str | None = Field(default=None, max_length=10)
    complemento: str | None = Field(default=None, max_length=60)
    bairro: str | None = Field(default=None, max_length=80)
    cidade: str | None = Field(default=None, max_length=80)
    codigo_ibge: str | None = Field(default=None, max_length=7)
    uf: str | None = Field(default=None, max_length=2)
    pais: str = "Brasil"
    tipo: Literal["residencial", "comercial", "citacao"] | None = None

    _cep = field_validator("cep")(_digitos)


class PessoaIn(BaseModel):
    tipo_pessoa: Literal["fisica", "juridica", "autoridade", "orgao_representacao"] = "fisica"
    nome: str = Field(min_length=2, max_length=300)
    nome_social: str | None = None
    nome_fantasia: str | None = None
    cpf: str | None = None
    cnpj: str | None = None
    justificativa_sem_documento: str | None = Field(default=None, max_length=300)
    outros_documentos: list[dict] = []
    sexo: Literal["M", "F", "N"] | None = None
    data_nascimento: date | None = None
    nacionalidade: str | None = None
    naturalidade: str | None = None
    estado_civil: Literal["solteiro", "casado", "divorciado", "separado", "viuvo", "nao_informado"] | None = None
    uniao_estavel: bool | None = None
    profissao: str | None = None
    nome_mae: str | None = None
    nome_pai: str | None = None
    email: EmailStr | None = None
    telefones: list[str] = []
    enderecos: list[EnderecoParte] = []
    ente_publico: bool = False

    _doc = field_validator("cpf", "cnpj")(_digitos)


class AdvogadoParteIn(BaseModel):
    nome: str
    cpf: str | None = None
    oab_numero: str
    oab_uf: str = UF
    tipo_representante: Literal["advogado", "procurador", "defensor", "escritorio"] = "advogado"
    recebe_intimacao: bool = True


class ParteIn(BaseModel):
    polo: Polo
    tipo_participacao: str | None = None
    pessoa: PessoaIn
    assistencia_judiciaria: bool = False
    advogados: list[AdvogadoParteIn] = []
    cliente_id: int | None = None  # veio do cadastro de clientes


class AssuntoIn(BaseModel):
    codigo: str
    nome: str | None = None
    principal: bool = False


class CabecalhoInicial(BaseModel):
    localidade_codigo: str | None = None
    localidade_nome: str | None = None
    competencia_codigo: str | None = None
    orgao_julgador_codigo: str | None = None
    classe_codigo: str | None = None
    classe_nome: str | None = None
    assuntos: list[AssuntoIn] = []
    valor_causa: Decimal | None = None
    justica_gratuita_requerida: bool | None = None
    prioridades: list[Literal["idoso", "idoso_80", "doenca_grave", "pcd", "crianca_adolescente", "violencia_domestica", "outra"]] = []
    tutela_urgencia: bool | None = None
    segredo_justica_requerido: bool | None = None
    nivel_sigilo: int = Field(default=0, ge=0, le=5)
    juizo_100_digital: bool | None = None
    audiencia_conciliacao: Literal["deseja", "nao_deseja"] | None = None
    prevencao_processo_cnj: str | None = None
    processo_referencia_cnj: str | None = None
    sem_reu: bool = False


class ConteudoPeca(BaseModel):
    enderecamento: str | None = None
    abertura: str | None = None
    fatos: str | None = None
    fundamentos_juridicos: str | None = None
    pedidos: list[str] = []
    pedido_tutela: str | None = None
    provas: list[str] = []
    local: str | None = None


class ProtocoloIn(BaseModel):
    tipo: Literal["inicial", "intermediaria", "habilitacao", "recurso"]
    advogado_id: int
    titulo: str | None = Field(default=None, max_length=200)
    processo_id: int | None = None  # intermediária / habilitação / recurso
    caso_id: int | None = None
    tribunal_sigla: str | None = None  # inicial
    grau: Literal["1g", "2g", "turma_recursal", "superior"] = "1g"
    cabecalho: CabecalhoInicial = CabecalhoInicial()
    partes: list[ParteIn] = []
    conteudo_peca: ConteudoPeca = ConteudoPeca()
    tipo_peticao_codigo: str | None = None
    tipo_peticao_nome: str | None = None
    em_resposta_a_intimacao_id: int | None = None
    polo_peticionante: Polo | None = None
    parte_ids: list[int] = []
    pedido_urgente: bool = False
    nivel_sigilo: int = Field(default=0, ge=0, le=5)
    prazo_final: date | None = None
    fora_do_prazo_justificativa: str | None = Field(default=None, max_length=500)


class DocumentoPatch(BaseModel):
    ordem: int | None = Field(default=None, ge=1)
    descricao: str | None = Field(default=None, max_length=300)
    tipo_documento_nome: str | None = Field(default=None, max_length=150)
    tipo_documento_codigo: str | None = None
    nivel_sigilo: int | None = Field(default=None, ge=0, le=5)


class CustaIn(BaseModel):
    tipo_custa: Literal["inicial", "preparo_recursal", "porte_remessa", "diligencia_oficial", "mandato", "outra"]
    tipo_guia: str = Field(min_length=2, max_length=40)
    codigo_receita: str | None = None
    valor: Decimal = Field(ge=0)
    base_calculo: Decimal | None = None
    numero_guia: str = Field(min_length=1, max_length=60)
    linha_digitavel: str | None = None
    codigo_barras: str | None = None
    vencimento: date
    pagador_nome: str = Field(min_length=2, max_length=200)
    pagador_documento: str
    status: Literal["gerada", "paga", "vinculada", "vencida", "isenta"] = "gerada"
    pago_em: datetime | None = None
    reembolsar_cliente: bool = False  # lança como despesa do caso (Nota de Despesas)

    _doc = field_validator("pagador_documento")(lambda v: _digitos(v) or v)


class RedigirIn(BaseModel):
    briefing: str = Field(min_length=20, max_length=20000)


class ConfigIn(BaseModel):
    modo: Literal["simulado", "real"]
    sincronizar_auto: bool = True
    criar_andamentos: bool = True
    vincular_automatico: bool = True
    limiar_fuzzy: int = Field(default=88, ge=60, le=100)


class NotificacaoIn(BaseModel):
    ativo: bool
    notificar_responsavel_caso: bool = True
    notificar_quem_protocolou: bool = True
    notificar_titular_certificado: bool = False
    destinatarios_fixos: list[EmailStr] = []
    copia_oculta: list[EmailStr] = []
    anexar_recibo: bool = True
    anexar_peca_principal: bool = False
    respeitar_sigilo: bool = True
    assunto: str = Field(min_length=3, max_length=300)
    corpo_texto: str = Field(min_length=3)
    corpo_html: str | None = None


class PlataformaIn(BaseModel):
    datajud_url: str
    datajud_chave: str | None = None
    djen_url: str
    djen_proxy_url: str | None = None
    intervalo_datajud_ms: int = Field(ge=200, le=10000)
    termo_versao: str = Field(min_length=1, max_length=20)
    termo_texto: str = Field(min_length=50)


class SistemaIn(BaseModel):
    grau: Literal["1g", "2g", "turma_recursal", "superior"]
    sistema: Literal["pje", "eproc", "esaj", "projudi", "proprio"]
    versao_sistema: str | None = None
    url_portal: str | None = None
    url_consulta_publica: str | None = None
    url_mni: str | None = None
    versao_mni: str | None = "2.2.2"
    mni_consulta: bool = False
    mni_peticionamento: bool = False
    mni_inicial: bool = False
    exige_credenciamento: bool = True
    autenticacao: list[Literal["certificado", "usuario_senha", "2fa"]] = ["certificado"]
    tamanho_max_arquivo_mb: int = Field(default=10, ge=1, le=500)
    tamanho_max_total_mb: int | None = Field(default=None, ge=1)
    formatos_aceitos: list[str] = ["application/pdf"]
    exige_pdf_pesquisavel: bool = False
    formato_assinatura: Literal["PAdES", "CAdES", "assinatura_no_portal"] = "PAdES"
    adaptador: Literal["MniAdapter", "PjeAdapter", "EprocAdapter", "EsajAdapter", "ProjudiAdapter", "PortalAdapter"] = "MniAdapter"
    config_extra: dict = {}
    data_inicio: date | None = None
    data_fim: date | None = None
    status_saude: Literal["ok", "lento", "fora", "mudou_layout"] = "ok"
    validado: bool = False
    intervalo_min_s: int = Field(default=5, ge=0, le=3600)
    janela_inicio: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    janela_fim: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    ativo: bool = True


class FaixaIn(BaseModel):
    de_creditos: int = Field(ge=1)
    ate_creditos: int | None = None
    preco_por_credito: Decimal = Field(ge=0)


class PlanoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=80)
    preco_mensal: Decimal = Field(ge=0)
    creditos_protocolo_mes: int = Field(ge=0)
    creditos_acumulam: bool = False
    permite_excedente: bool = True
    limite_excedente_mes: int | None = None
    limite_processos_monitorados: int | None = None
    limite_certificados: int | None = None
    ativo: bool = True
    faixas: list[FaixaIn] = []


class FaixaSetupIn(BaseModel):
    de_processos: int = Field(ge=1)
    ate_processos: int | None = None
    preco: Decimal = Field(ge=0)
    inclui_download_autos: bool = False
    reimportacao_gratis_dias: int | None = 30


class EstornoIn(BaseModel):
    consumo_id: int
    motivo: str = Field(min_length=5, max_length=300)


class AjusteIn(BaseModel):
    creditos: int
    valor: Decimal = Decimal("0")
    motivo: str = Field(min_length=5, max_length=300)
