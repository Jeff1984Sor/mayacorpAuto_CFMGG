"""faturamento: texto do servico na fatura (vazio = Honorarios advocaticios)

Revision ID: b3d5f7a9c1e4
Revises: a7cebee73917
Create Date: 2026-11-28 19:05:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3d5f7a9c1e4'
down_revision: Union[str, Sequence[str], None] = 'a7cebee73917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('fat_config', schema=None) as batch_op:
        batch_op.add_column(sa.Column('texto_servico', sa.String(length=80), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('fat_config', schema=None) as batch_op:
        batch_op.drop_column('texto_servico')
