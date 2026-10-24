"""Modelos do RPA 01 — Emissor de NFS-e em lote (layout 2)."""

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped, UtcDateTime, agora

Dinheiro = Numeric(15, 2)


def _enum(e: type[enum.Enum]):
    return Enum(e, native_enum=False, length=20)


class Regime(enum.StrEnum):
    simples = "simples"
    presumido = "presumido"
    real = "real"
    mei = "mei"


class StatusLote(enum.StrEnum):
    validando = "validando"  # importado, aguardando conferência na tela
    na_fila = "na_fila"
    transmitindo = "transmitindo"
    concluido = "concluido"
    parcial = "parcial"
    falhou = "falhou"
    descartado = "descartado"


class StatusRps(enum.StrEnum):
    ok = "ok"
    aviso = "aviso"
    erro = "erro"
    descartado = "descartado"
    na_fila = "na_fila"
    transmitindo = "transmitindo"
    emitido = "emitido"
    rejeitado = "rejeitado"


class StatusNfse(enum.StrEnum):
    emitida = "emitida"
    cancelada = "cancelada"


class ConfigNfse(Base, Timestamped):
    """Configurações do RPA 01 editáveis na tela (Configurações › Prefeitura e › Automações)."""

    __tablename__ = "config_nfse"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    # simulado: sem chamadas externas · teste: TesteEnvioLoteRPS, não gera nota · producao: emissão real
    prefeitura_modo: Mapped[str] = mapped_column(String(10), default="simulado")

    # Relatório de emissão enviado ao cliente (ex.: CFME) ao fim de cada lote
    relatorio_emissao_ativo: Mapped[bool] = mapped_column(Boolean, default=False)
    relatorio_destinatarios: Mapped[list[str]] = mapped_column(JSON, default=list)
    relatorio_anexar_planilha: Mapped[bool] = mapped_column(Boolean, default=True)
    relatorio_anexar_zip: Mapped[bool] = mapped_column(Boolean, default=False)
    relatorio_baixas_ativo: Mapped[bool] = mapped_column(Boolean, default=False)

    # Conciliação do extrato: baixa automática quando a confiança do par é alta
    baixa_automatica: Mapped[bool] = mapped_column(Boolean, default=True)
    confianca_minima: Mapped[int] = mapped_column(Integer, default=85)

    # Fatura (Nota de Honorários) gerada para cada NFS-e emitida
    fatura_ativa: Mapped[bool] = mapped_column(Boolean, default=True)
    fatura_dias_vencimento: Mapped[int] = mapped_column(Integer, default=10)
    # "dias": vence N dias após a emissão · "emissao": vence na própria data de emissão da nota (à vista)
    fatura_vencimento_modo: Mapped[str] = mapped_column(String(10), default="dias")
    fatura_instrucoes: Mapped[str | None] = mapped_column(Text)
    fatura_anexar_email: Mapped[bool] = mapped_column(Boolean, default=True)


class Emissora(Base, Timestamped):
    __tablename__ = "emissora"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    razao_social: Mapped[str] = mapped_column(String(200))
    nome_fantasia: Mapped[str | None] = mapped_column(String(200))
    cnpj: Mapped[str] = mapped_column(String(14))
    ccm: Mapped[str] = mapped_column(String(8))
    cep: Mapped[str | None] = mapped_column(String(8))
    logradouro: Mapped[str | None] = mapped_column(String(150))
    numero: Mapped[str | None] = mapped_column(String(10))
    complemento: Mapped[str | None] = mapped_column(String(60))
    bairro: Mapped[str | None] = mapped_column(String(80))
    cidade: Mapped[str | None] = mapped_column(String(80), default="São Paulo")
    uf: Mapped[str | None] = mapped_column(String(2), default="SP")
    codigo_municipio: Mapped[str | None] = mapped_column(String(7), default="3550308")
    email: Mapped[str | None] = mapped_column(String(200))
    telefone: Mapped[str | None] = mapped_column(String(30))
    # Dados para pagamento impressos na fatura (Nota de Honorários)
    banco: Mapped[str | None] = mapped_column(String(80))
    agencia: Mapped[str | None] = mapped_column(String(20))
    conta: Mapped[str | None] = mapped_column(String(30))
    chave_pix: Mapped[str | None] = mapped_column(String(120))
    regime: Mapped[Regime] = mapped_column(_enum(Regime), default=Regime.presumido)
    cod_servico_padrao: Mapped[str | None] = mapped_column(String(5))
    aliquota_iss: Mapped[Decimal] = mapped_column(Numeric(5, 4), default=Decimal("0.05"))
    serie_rps: Mapped[str] = mapped_column(String(5), default="A")
    prox_rps: Mapped[int] = mapped_column(Integer, default=1)
    certificado_id: Mapped[int | None] = mapped_column(ForeignKey("certificado.id"))
    ativa: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (UniqueConstraint("tenant_id", "cnpj", "ccm", name="uq_emissora_tenant_cnpj_ccm"),)


class Tomador(Base, Timestamped):
    __tablename__ = "tomador"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(2))  # PF | PJ | EX
    nome: Mapped[str] = mapped_column(String(200), index=True)
    cpf_cnpj: Mapped[str | None] = mapped_column(String(14), index=True)
    im: Mapped[str | None] = mapped_column(String(8))
    ie: Mapped[str | None] = mapped_column(String(12))
    tipo_logradouro: Mapped[str | None] = mapped_column(String(3))
    logradouro: Mapped[str | None] = mapped_column(String(150))
    numero: Mapped[str | None] = mapped_column(String(10))
    complemento: Mapped[str | None] = mapped_column(String(60))
    bairro: Mapped[str | None] = mapped_column(String(80))
    cidade: Mapped[str | None] = mapped_column(String(80))
    uf: Mapped[str | None] = mapped_column(String(2))
    cep: Mapped[str | None] = mapped_column(String(8))
    emails: Mapped[list[str]] = mapped_column(JSON, default=list)
    telefone: Mapped[str | None] = mapped_column(String(20))
    observacoes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("tenant_id", "cpf_cnpj", name="uq_tomador_tenant_doc"),)


class ParametroFiscal(Base, Timestamped):
    """Padrões do layout 2 (ISS / IBS / CBS). Escopo: padrão da emissora, por serviço ou por tomador."""

    __tablename__ = "parametro_fiscal"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    escopo: Mapped[str] = mapped_column(String(10), default="padrao")  # padrao | servico | tomador
    descricao: Mapped[str | None] = mapped_column(String(200))
    cod_servico: Mapped[str | None] = mapped_column(String(5))
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id"))
    aliquota_iss: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    nbs: Mapped[str | None] = mapped_column(String(9))
    cst_ibscbs: Mapped[str | None] = mapped_column(String(3))
    class_trib: Mapped[str | None] = mapped_column(String(6))
    ind_operacao: Mapped[str | None] = mapped_column(String(6))  # cIndOp
    finalidade: Mapped[str | None] = mapped_column(String(1), default="0")  # finNFSe
    ind_final: Mapped[str | None] = mapped_column(String(1), default="0")  # consumidor final
    tipo_operacao: Mapped[str | None] = mapped_column(String(1), default="1")
    ind_destinatario: Mapped[str | None] = mapped_column(String(1), default="0")
    tributacao_rps: Mapped[str] = mapped_column(String(1), default="T")
    prioridade: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class Lote(Base, Timestamped):
    __tablename__ = "lote"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    arquivo_origem: Mapped[str] = mapped_column(String(255))
    arquivo_path: Mapped[str | None] = mapped_column(String(500))
    hash_arquivo: Mapped[str] = mapped_column(String(64), index=True)
    encoding: Mapped[str | None] = mapped_column(String(20))
    qtd: Mapped[int] = mapped_column(Integer, default=0)
    valor_total: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    iss_total: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    status: Mapped[StatusLote] = mapped_column(_enum(StatusLote), default=StatusLote.validando, index=True)
    sublotes_total: Mapped[int] = mapped_column(Integer, default=0)
    sublotes_feitos: Mapped[int] = mapped_column(Integer, default=0)
    qtd_emitidas: Mapped[int] = mapped_column(Integer, default=0)
    qtd_rejeitadas: Mapped[int] = mapped_column(Integer, default=0)
    mensagem: Mapped[str | None] = mapped_column(Text)
    eventos: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    iniciado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    concluido_em: Mapped[datetime | None] = mapped_column(UtcDateTime())

    emissora: Mapped[Emissora] = relationship()
    rps: Mapped[list["Rps"]] = relationship(back_populates="lote", order_by="Rps.linha")

    __table_args__ = (UniqueConstraint("tenant_id", "numero", name="uq_lote_tenant_numero"),)

    def evento(self, etapa: str, texto: str, nivel: str = "info") -> None:
        self.eventos = [*(self.eventos or []), {"em": agora().isoformat(), "etapa": etapa, "texto": texto, "nivel": nivel}]


class Rps(Base, Timestamped):
    __tablename__ = "rps"

    id: Mapped[int] = mapped_column(primary_key=True)
    lote_id: Mapped[int] = mapped_column(ForeignKey("lote.id", ondelete="CASCADE"), index=True)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    linha: Mapped[int] = mapped_column(Integer)
    selecionado: Mapped[bool] = mapped_column(Boolean, default=True)
    tipo_rps: Mapped[str] = mapped_column(String(5), default="RPS")
    serie: Mapped[str] = mapped_column(String(5))
    numero: Mapped[int] = mapped_column(Integer)
    data_emissao: Mapped[date] = mapped_column(Date)
    situacao: Mapped[str] = mapped_column(String(1), default="T")
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id"))
    tomador_novo: Mapped[bool] = mapped_column(Boolean, default=False)
    cod_servico: Mapped[str] = mapped_column(String(5))
    aliquota: Mapped[Decimal] = mapped_column(Numeric(5, 4))
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    deducoes: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    iss: Mapped[Decimal] = mapped_column(Dinheiro)
    iss_retido: Mapped[bool] = mapped_column(Boolean, default=False)
    discriminacao: Mapped[str] = mapped_column(Text, default="")
    dados_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # tomador + campos layout 2
    status: Mapped[StatusRps] = mapped_column(_enum(StatusRps), default=StatusRps.ok, index=True)
    erros_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    tentativas: Mapped[int] = mapped_column(Integer, default=0)
    # A chave de idempotência só é preenchida quando o RPS entra na fila de emissão:
    # emissora + série + número nunca podem ser transmitidos duas vezes.
    chave_emissao: Mapped[str | None] = mapped_column(String(40), unique=True)

    lote: Mapped[Lote] = relationship(back_populates="rps")
    tomador: Mapped["Tomador | None"] = relationship()
    nfse: Mapped["Nfse | None"] = relationship(back_populates="rps", uselist=False)


class Nfse(Base, Timestamped):
    __tablename__ = "nfse"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    rps_id: Mapped[int] = mapped_column(ForeignKey("rps.id"), unique=True)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id"))
    numero: Mapped[int] = mapped_column(Integer, index=True)
    cod_verificacao: Mapped[str] = mapped_column(String(20))
    data_emissao: Mapped[datetime] = mapped_column(UtcDateTime(), index=True)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    iss: Mapped[Decimal] = mapped_column(Dinheiro)
    xml_path: Mapped[str | None] = mapped_column(String(500))
    pdf_path: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[StatusNfse] = mapped_column(_enum(StatusNfse), default=StatusNfse.emitida, index=True)
    cancelada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    motivo_cancelamento: Mapped[str | None] = mapped_column(Text)
    simulada: Mapped[bool] = mapped_column(Boolean, default=False)
    # Recebimento (baixa): vem da conciliação do extrato ou de lançamento manual
    pago_em: Mapped[date | None] = mapped_column(Date, index=True)
    valor_pago: Mapped[Decimal | None] = mapped_column(Dinheiro)
    baixa_origem: Mapped[str | None] = mapped_column(String(10))  # extrato | manual
    lancamento_id: Mapped[int | None] = mapped_column(ForeignKey("lancamento_extrato.id"))

    rps: Mapped[Rps] = relationship(back_populates="nfse")
    tomador: Mapped["Tomador | None"] = relationship()
    emissora: Mapped[Emissora] = relationship()
    envios: Mapped[list["EnvioEmail"]] = relationship(back_populates="nfse")


class EnvioEmail(Base):
    __tablename__ = "envio_email"

    id: Mapped[int] = mapped_column(primary_key=True)
    nfse_id: Mapped[int] = mapped_column(ForeignKey("nfse.id"), index=True)
    destinatarios: Mapped[list[str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20))
    enviado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    erro: Mapped[str | None] = mapped_column(Text)

    nfse: Mapped[Nfse] = relationship(back_populates="envios")


class StatusLancamento(enum.StrEnum):
    conciliado = "conciliado"  # baixa dada (automática ou confirmada)
    sugerido = "sugerido"  # par encontrado, aguardando confirmação
    sem_par = "sem_par"  # nenhuma nota bate
    ignorado = "ignorado"  # não é recebimento de nota (ex.: rendimento, estorno)
    duplicado = "duplicado"  # já veio em outro extrato


class Extrato(Base, Timestamped):
    __tablename__ = "extrato"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    arquivo_nome: Mapped[str] = mapped_column(String(255))
    arquivo_path: Mapped[str | None] = mapped_column(String(500))
    formato: Mapped[str] = mapped_column(String(10))  # ofx | csv | xlsx
    banco: Mapped[str | None] = mapped_column(String(120))
    periodo_de: Mapped[date | None] = mapped_column(Date)
    periodo_ate: Mapped[date | None] = mapped_column(Date)
    qtd_creditos: Mapped[int] = mapped_column(Integer, default=0)
    qtd_conciliados: Mapped[int] = mapped_column(Integer, default=0)
    qtd_sugeridos: Mapped[int] = mapped_column(Integer, default=0)
    valor_creditos: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    valor_conciliado: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    notas_baixadas: Mapped[int] = mapped_column(Integer, default=0)

    lancamentos: Mapped[list["LancamentoExtrato"]] = relationship(back_populates="extrato", order_by="LancamentoExtrato.data")


class LancamentoExtrato(Base, Timestamped):
    __tablename__ = "lancamento_extrato"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    extrato_id: Mapped[int] = mapped_column(ForeignKey("extrato.id", ondelete="CASCADE"), index=True)
    data: Mapped[date] = mapped_column(Date)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    descricao: Mapped[str] = mapped_column(String(500), default="")
    documento: Mapped[str | None] = mapped_column(String(80))
    # Identidade do lançamento (FITID do OFX ou data+valor+descrição): o mesmo crédito nunca baixa duas vezes
    chave: Mapped[str] = mapped_column(String(120))
    status: Mapped[StatusLancamento] = mapped_column(_enum(StatusLancamento), default=StatusLancamento.sem_par)
    confianca: Mapped[int] = mapped_column(Integer, default=0)
    nfse_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    motivo: Mapped[str | None] = mapped_column(String(300))

    extrato: Mapped[Extrato] = relationship(back_populates="lancamentos")

    __table_args__ = (UniqueConstraint("tenant_id", "chave", "extrato_id", name="uq_lancamento_tenant_chave_extrato"),)


class StatusFatura(enum.StrEnum):
    aberta = "aberta"
    paga = "paga"
    cancelada = "cancelada"


class Fatura(Base, Timestamped):
    """Nota de Honorários: o documento de cobrança que acompanha cada NFS-e (modelo do sistema RCA)."""

    __tablename__ = "fatura"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    nfse_id: Mapped[int] = mapped_column(ForeignKey("nfse.id"), unique=True)
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id"))
    numero: Mapped[int] = mapped_column(Integer)  # sequencial por emissora e ano
    ano: Mapped[int] = mapped_column(Integer)
    data_emissao: Mapped[date] = mapped_column(Date)
    data_vencimento: Mapped[date] = mapped_column(Date, index=True)
    descricao: Mapped[str] = mapped_column(Text, default="")
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    desconto: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    juros: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    status: Mapped[StatusFatura] = mapped_column(_enum(StatusFatura), default=StatusFatura.aberta, index=True)
    pago_em: Mapped[date | None] = mapped_column(Date)
    pdf_path: Mapped[str | None] = mapped_column(String(500))
    observacao: Mapped[str | None] = mapped_column(Text)

    nfse: Mapped[Nfse] = relationship()
    emissora: Mapped[Emissora] = relationship()
    tomador: Mapped["Tomador | None"] = relationship()

    __table_args__ = (UniqueConstraint("emissora_id", "ano", "numero", name="uq_fatura_emissora_ano_numero"),)

    @property
    def codigo(self) -> str:
        return f"NH {self.ano}/{self.numero:05d}"

    @property
    def total(self) -> Decimal:
        return self.valor - (self.desconto or 0) + (self.juros or 0)
