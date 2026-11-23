"""cliente: como agrupar as cobranças em faturas/notas (contrato, caso ou cobrança)

Revision ID: a7c9e1f3b5d6
Revises: f6b8d0e2a4c5
Create Date: 2026-11-23 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c9e1f3b5d6'
down_revision: Union[str, Sequence[str], None] = 'f6b8d0e2a4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.add_column(sa.Column('fatura_agrupamento', sa.String(length=10), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.drop_column('fatura_agrupamento')
