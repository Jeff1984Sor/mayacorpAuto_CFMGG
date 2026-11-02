"""config: texto da NFS-e (regra e caso) e salvar faturas numa pasta

Revision ID: a1c3e5f7b9d2
Revises: 6d7a2c160b4b
Create Date: 2026-11-02 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5f7b9d2'
down_revision: Union[str, Sequence[str], None] = '6d7a2c160b4b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('config_nfse', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nota_texto_regra', sa.Boolean(), server_default=sa.true(), nullable=False))
        batch_op.add_column(sa.Column('nota_titulo_caso', sa.Boolean(), server_default=sa.true(), nullable=False))
        batch_op.add_column(sa.Column('fatura_salvar_pasta', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('config_nfse', schema=None) as batch_op:
        batch_op.drop_column('fatura_salvar_pasta')
        batch_op.drop_column('nota_titulo_caso')
        batch_op.drop_column('nota_texto_regra')
