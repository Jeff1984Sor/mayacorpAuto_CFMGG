"""Migrations do banco de controle (MayaCorp): `alembic -c alembic_controle.ini upgrade head`."""

from logging.config import fileConfig

from alembic import context

from app.controle.models import BaseControle, engine_controle

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = BaseControle.metadata

with engine_controle().connect() as connection:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
