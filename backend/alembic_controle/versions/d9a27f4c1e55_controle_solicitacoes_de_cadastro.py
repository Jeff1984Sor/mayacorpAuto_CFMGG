"""controle: solicitações de cadastro (formulário público)

Revision ID: d9a27f4c1e55
Revises: c4d81e7a9b30
Create Date: 2026-10-31 18:50:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.core.db


revision: str = 'd9a27f4c1e55'
down_revision: Union[str, Sequence[str], None] = 'c4d81e7a9b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('solicitacao',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('nome', sa.String(length=200), nullable=False),
    sa.Column('documento', sa.String(length=14), nullable=True),
    sa.Column('responsavel', sa.String(length=150), nullable=False),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('telefone', sa.String(length=30), nullable=True),
    sa.Column('plano_id', sa.Integer(), nullable=True),
    sa.Column('ciclo', sa.String(length=10), nullable=False),
    sa.Column('usuarios', sa.Integer(), nullable=True),
    sa.Column('indicacao', sa.String(length=200), nullable=True),
    sa.Column('mensagem', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('cliente_id', sa.Integer(), nullable=True),
    sa.Column('ip', sa.String(length=45), nullable=True),
    sa.Column('criado_em', app.core.db.UtcDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['plano_id'], ['plano.id'], name=op.f('fk_solicitacao_plano_id_plano'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['cliente_id'], ['cliente.id'], name=op.f('fk_solicitacao_cliente_id_cliente'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_solicitacao'))
    )


def downgrade() -> None:
    op.drop_table('solicitacao')
