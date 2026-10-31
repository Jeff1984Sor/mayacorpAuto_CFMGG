"""Banco de controle da MayaCorp: quais escritórios existem, onde mora o banco de cada um, por quais domínios
eles entram e a quem pertence cada login. Fica fora dos bancos dos escritórios (nenhum escritório o enxerga).
"""

from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, MetaData, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from app.core.config import settings
from app.core.db import NAMING, UtcDateTime, agora


class BaseControle(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Cliente(BaseControle):
    __tablename__ = "cliente"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)  # identificador curto (cfme, silva-adv…)
    nome: Mapped[str] = mapped_column(String(200))
    banco: Mapped[str | None] = mapped_column(String(63), unique=True)  # None = banco principal (DATABASE_URL)
    status: Mapped[str] = mapped_column(String(15), default="ativo")  # teste | ativo | suspenso | cancelado
    teste_ate: Mapped[date | None] = mapped_column(Date)
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    dominios: Mapped[list["Dominio"]] = relationship(back_populates="cliente", cascade="all, delete-orphan",
                                                     order_by="Dominio.id")


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
        url = settings.controle_database_url
        if not url:
            raise RuntimeError("CONTROLE_DATABASE_URL não configurado.")
        args = {"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {}
        _engine = create_engine(url, pool_pre_ping=True, connect_args=args)
        _fabrica = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _fabrica()


def engine_controle():
    SessaoControle().close()
    return _engine
