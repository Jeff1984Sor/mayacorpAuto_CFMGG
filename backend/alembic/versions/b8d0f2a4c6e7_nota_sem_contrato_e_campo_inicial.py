"""texto da NFS-e por cliente: nome do contrato (sim/não) e campo do caso que abre o texto (ex.: nº do sinistro)

Revision ID: b8d0f2a4c6e7
Revises: a7c9e1f3b5d6
Create Date: 2026-11-23 16:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8d0f2a4c6e7'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1f3b5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nota_contrato', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('nota_campo_inicio_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.drop_column('nota_campo_inicio_id')
        batch_op.drop_column('nota_contrato')
