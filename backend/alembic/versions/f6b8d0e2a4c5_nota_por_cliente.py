"""texto da NFS-e por cliente: título do caso e texto da regra (vazio = segue Configurações)

Revision ID: f6b8d0e2a4c5
Revises: e5a7c9d1f3b4
Create Date: 2026-11-18 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6b8d0e2a4c5'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9d1f3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nota_titulo_caso', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('nota_texto_regra', sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.drop_column('nota_texto_regra')
        batch_op.drop_column('nota_titulo_caso')
