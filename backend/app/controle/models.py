"""Banco de controle da MayaCorp: quais escritórios existem, onde mora o banco de cada um, por quais domínios
eles entram e a quem pertence cada login. Fica fora dos bancos dos escritórios (nenhum escritório o enxerga).
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    ForeignKey,
    Integer,
    LargeBinary,
    MetaData,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from app.core.db import NAMING, UtcDateTime, agora


class BaseControle(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Cliente(BaseControle):
    __tablename__ = "cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)  # identificador curto (cfme, silva-adv…)
    nome: Mapped[str] = mapped_column(String(200))
    banco: Mapped[str | None] = mapped_column(String(63), unique=True)  # None = banco principal (DATABASE_URL)
    status: Mapped[str] = mapped_column(String(15), default="ativo")  # teste | ativo | suspenso | inativo (sem acesso)
    teste_ate: Mapped[date | None] = mapped_column(Date)
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    # "escritorio" = cliente do MayaJus · "mayacorp" = o admin (mesmos módulos, banco próprio, fora da lista e da cobrança)
    tipo: Mapped[str] = mapped_column(String(15), default="escritorio", server_default="escritorio")
    # ficha comercial
    documento: Mapped[str | None] = mapped_column(String(14))  # CNPJ/CPF, só dígitos
    responsavel: Mapped[str | None] = mapped_column(String(150))
    email_financeiro: Mapped[str | None] = mapped_column(String(200))
    telefone: Mapped[str | None] = mapped_column(String(30))
    plano_id: Mapped[int | None] = mapped_column(ForeignKey("plano.id"))
    ciclo: Mapped[str] = mapped_column(String(10), default="mensal", server_default="mensal")  # mensal | anual
    inicio_contrato: Mapped[date | None] = mapped_column(Date)
    observacao: Mapped[str | None] = mapped_column(Text)
    indicado_por_id: Mapped[int | None] = mapped_column(ForeignKey("cliente.id", ondelete="SET NULL"))  # quem indicou
    # robôs liberados para o escritório (chaves de planos.ROBOS); os módulos de gestão valem para todos
    robos: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    # cobrança: "link" = link do Mercado Pago todo mês por e-mail · "cartao" = assinatura recorrente no cartão
    forma_pagamento: Mapped[str] = mapped_column(String(10), default="link", server_default="link")
    mp_assinatura_id: Mapped[str | None] = mapped_column(String(64))  # preapproval do Mercado Pago
    mp_assinatura_status: Mapped[str | None] = mapped_column(String(20))  # pending | authorized | paused | cancelled

    plano: Mapped["Plano | None"] = relationship()
    indicado_por: Mapped["Cliente | None"] = relationship(remote_side="Cliente.id")
    dominios: Mapped[list["Dominio"]] = relationship(back_populates="cliente", cascade="all, delete-orphan",
                                                     order_by="Dominio.id")


class Plano(BaseControle):
    """Produto vendido (Solo, Escritório, Pro, Ilimitado). Limite vazio = ilimitado."""

    __tablename__ = "plano"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(60), unique=True)
    preco_mensal: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    preco_anual: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    usuarios: Mapped[int | None] = mapped_column(Integer)
    notas_mes: Mapped[int | None] = mapped_column(Integer)
    preco_nota_excedente: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.50"))
    preco_usuario_adicional: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("49.90"))
    recursos: Mapped[list[str]] = mapped_column(JSON, default=list)  # chaves de RECURSOS (app/controle/planos.py)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    ordem: Mapped[int] = mapped_column(Integer, default=0)


class PoliticaComercial(BaseControle):
    """Uma linha só: regras comerciais editáveis no admin (desconto por indicação)."""

    __tablename__ = "politica_comercial"

    id: Mapped[int] = mapped_column(primary_key=True)
    desconto_por_indicacao: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("5.00"))  # % por indicado ativo
    desconto_maximo: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("10.00"))  # teto (nunca acima de 10%)
    # senha do usuário "Suporte" criado em todo escritório novo (hash; definida no admin, nunca no código)
    senha_suporte_hash: Mapped[str | None] = mapped_column(String(255))


class ModeloContrato(BaseControle):
    """Modelo do contrato com o cliente: texto com {{variaveis}} preenchidas na hora de gerar."""

    __tablename__ = "modelo_contrato"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(120))
    corpo: Mapped[str] = mapped_column(Text)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    atualizado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora, onupdate=agora)


class ContratoCliente(BaseControle):
    """Contrato gerado para um cliente a partir de um modelo (o texto final fica guardado como foi enviado)."""

    __tablename__ = "contrato_cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id", ondelete="CASCADE"), index=True)
    modelo_id: Mapped[int | None] = mapped_column(ForeignKey("modelo_contrato.id", ondelete="SET NULL"))
    titulo: Mapped[str] = mapped_column(String(200))
    corpo: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(15), default="rascunho")  # rascunho | enviado | assinado | cancelado
    enviado_para: Mapped[list[str]] = mapped_column(JSON, default=list)
    enviado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    cliente: Mapped[Cliente] = relationship()


class ConfigCobranca(BaseControle):
    """Uma linha só: a conta do Mercado Pago da MayaCorp e a régua de cobrança (editadas no admin)."""

    __tablename__ = "config_cobranca"

    id: Mapped[int] = mapped_column(primary_key=True)
    mp_token_cifrado: Mapped[bytes | None] = mapped_column(LargeBinary)  # Access Token (cifrado com a MASTER_KEY)
    mp_segredo_cifrado: Mapped[bytes | None] = mapped_column(LargeBinary)  # assinatura secreta das notificações
    mp_conta: Mapped[str | None] = mapped_column(String(200))  # e-mail/apelido da conta conferido no "Testar"
    dia_vencimento: Mapped[int] = mapped_column(Integer, default=10)
    gerar_automatico: Mapped[bool] = mapped_column(Boolean, default=True)  # mensalidades geradas e enviadas sozinhas
    regua: Mapped[list[int]] = mapped_column(JSON, default=lambda: [-3, 0, 3, 10])  # dias em relação ao vencimento


class Cobranca(BaseControle):
    """Uma cobrança ao cliente: mensalidade (do plano), avulsa (sem produto) ou paga pela assinatura no cartão."""

    __tablename__ = "cobranca"
    __table_args__ = (UniqueConstraint("cliente_id", "tipo", "competencia", name="uq_cobranca_competencia"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(12))  # mensalidade | avulsa | cartao
    competencia: Mapped[str | None] = mapped_column(String(7))  # AAAA-MM (mensalidade/cartão); avulsa: None
    descricao: Mapped[str] = mapped_column(String(200))
    itens: Mapped[list[dict]] = mapped_column(JSON, default=list)  # [{descricao, valor}] (plano, excedentes, desconto)
    valor: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    vencimento: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(12), default="pendente")  # pendente | paga | cancelada
    link: Mapped[str | None] = mapped_column(String(500))
    mp_preferencia_id: Mapped[str | None] = mapped_column(String(80))
    mp_pagamento_id: Mapped[str | None] = mapped_column(String(40), index=True)
    pago_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    forma_paga: Mapped[str | None] = mapped_column(String(30))  # pix | cartão | boleto | manual
    avisos: Mapped[list[int]] = mapped_column(JSON, default=list)  # passos da régua já enviados
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    cliente: Mapped[Cliente] = relationship()


class Solicitacao(BaseControle):
    """Pedido de cadastro vindo do formulário público (site da MayaCorp). Vira cliente quando aprovado no admin."""

    __tablename__ = "solicitacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(200))  # escritório
    documento: Mapped[str | None] = mapped_column(String(14))
    responsavel: Mapped[str] = mapped_column(String(150))
    email: Mapped[str] = mapped_column(String(200))
    telefone: Mapped[str | None] = mapped_column(String(30))
    plano_id: Mapped[int | None] = mapped_column(ForeignKey("plano.id", ondelete="SET NULL"))
    ciclo: Mapped[str] = mapped_column(String(10), default="mensal")
    usuarios: Mapped[int | None] = mapped_column(Integer)  # quantas pessoas vão usar (informado)
    indicacao: Mapped[str | None] = mapped_column(String(200))  # quem indicou (texto livre)
    mensagem: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), default="nova")  # nova | aprovada | recusada
    cliente_id: Mapped[int | None] = mapped_column(ForeignKey("cliente.id", ondelete="SET NULL"))
    ip: Mapped[str | None] = mapped_column(String(45))
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    plano: Mapped["Plano | None"] = relationship()


class Dominio(BaseControle):
    """Endereço próprio do escritório (ex.: sistema.cfme.com.br). Quem entra por ele cai direto no escritório."""

    __tablename__ = "dominio"

    id: Mapped[int] = mapped_column(primary_key=True)
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id", ondelete="CASCADE"), index=True)
    host: Mapped[str] = mapped_column(String(253), unique=True)

    cliente: Mapped[Cliente] = relationship(back_populates="dominios")


class Login(BaseControle):
    """Catálogo de logins: no endereço principal, o login (ou e-mail) diz de qual escritório é a pessoa."""

    __tablename__ = "login"

    chave: Mapped[str] = mapped_column(String(200), primary_key=True)  # login ou e-mail, minúsculo
    cliente_id: Mapped[int] = mapped_column(ForeignKey("cliente.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int]


_engine = None
_fabrica = None


def SessaoControle():  # noqa: N802 — usado como SessionLocal
    global _engine, _fabrica
    if _fabrica is None:
        from app.core import tenancy

        url = tenancy.url_controle()
        args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
        _engine = create_engine(url, pool_pre_ping=True, connect_args=args)
        _fabrica = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _fabrica()


def engine_controle():
    SessaoControle().close()
    return _engine
