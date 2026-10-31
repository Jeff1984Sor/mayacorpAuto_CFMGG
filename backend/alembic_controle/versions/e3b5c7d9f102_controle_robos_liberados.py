"""controle: robôs liberados por escritório

Revision ID: e3b5c7d9f102
Revises: d9a27f4c1e55
Create Date: 2026-10-31 19:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3b5c7d9f102'
down_revision: Union[str, Sequence[str], None] = 'd9a27f4c1e55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.add_column(sa.Column('robos', sa.JSON(), server_default='[]', nullable=False))
    # o escritório do banco principal (CFME) já usa os dois robôs
    op.execute("""UPDATE cliente SET robos = '["nfse_lote", "porto_seguro"]' WHERE banco IS NULL""")


def downgrade() -> None:
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.drop_column('robos')
