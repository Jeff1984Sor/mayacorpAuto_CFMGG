from collections.abc import Iterator
from datetime import UTC, datetime, time

from sqlalchemy import DateTime, MetaData, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.core.config import settings

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def agora() -> datetime:
    return datetime.now(UTC)


class UtcDateTime(TypeDecorator):
    """Datetime sempre com fuso (UTC). O SQLite descarta o fuso; aqui ele volta na leitura."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, datetime):  # uma data simples compara como o início do dia (UTC)
            value = datetime.combine(value, time.min)
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Timestamped:
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    atualizado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora, onupdate=agora)


_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False, "timeout": 30} if _is_sqlite else {},
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


class SessaoDoEscritorio(Session):
    """Escolhe o banco na hora da consulta, pelo escritório atual (app.core.tenancy); sem multi, é o `engine`."""

    def get_bind(self, mapper=None, clause=None, **kw):
        from app.core import tenancy

        return tenancy.engine_atual()


SessionLocal = sessionmaker(class_=SessaoDoEscritorio, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
