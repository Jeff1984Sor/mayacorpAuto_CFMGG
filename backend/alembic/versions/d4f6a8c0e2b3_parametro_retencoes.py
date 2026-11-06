"""parâmetro fiscal: retenções federais (IR, PIS, COFINS, CSLL, INSS)

Revision ID: d4f6a8c0e2b3
Revises: c3e5a7b9d1f2
Create Date: 2026-11-06 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f6a8c0e2b3'
down_revision: Union[str, Sequence[str], None] = 'c3e5a7b9d1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CAMPOS = ('ret_ir', 'ret_pis', 'ret_cofins', 'ret_csll', 'ret_inss')


def upgrade() -> None:
    with op.batch_alter_table('parametro_fiscal', schema=None) as batch_op:
        for c in CAMPOS:
            batch_op.add_column(sa.Column(c, sa.Numeric(5, 4), nullable=True))
        batch_op.add_column(sa.Column('retencao_pis_cofins', sa.String(length=1), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('parametro_fiscal', schema=None) as batch_op:
        batch_op.drop_column('retencao_pis_cofins')
        for c in reversed(CAMPOS):
            batch_op.drop_column(c)
