from logging.config import fileConfig

from alembic import context

import app.core.models  # noqa: F401  (registra os modelos)
import app.comunicador.models  # noqa: F401
import app.modules.faturamento.models  # noqa: F401
import app.modules.financas.models  # noqa: F401
import app.modules.rpa_nfse.models  # noqa: F401
import app.modules.tribunais.models  # noqa: F401
from app.core.config import settings
from app.core.db import Base, engine

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True,
                      render_as_batch=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    externa = config.attributes.get("connection")  # banco de um escritório (app.controle.service.migrar)
    if externa is not None:
        context.configure(connection=externa, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    with engine.connect() as connection:
        if connection.dialect.name == "sqlite":
            # batch_alter_table recria a tabela; com FKs ligadas o DROP falha
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
