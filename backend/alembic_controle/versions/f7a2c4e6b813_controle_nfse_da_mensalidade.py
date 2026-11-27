"""controle: NFS-e da mensalidade (emitida no admin quando a cobrança é paga)

Revision ID: f7a2c4e6b813
Revises: e3b5c7d9f102
Create Date: 2026-11-27 15:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7a2c4e6b813'
down_revision: Union[str, Sequence[str], None] = 'e3b5c7d9f102'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('config_cobranca', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nfse_automatica', sa.Boolean(), server_default=sa.false(), nullable=False))
        batch_op.add_column(sa.Column('nfse_emissora_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('nfse_descricao', sa.String(length=300), nullable=True))
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nfse_status', sa.String(length=12), nullable=True))
        batch_op.add_column(sa.Column('nfse_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('nfse_numero', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('nfse_chave', sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column('nfse_erro', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('nfse_em', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        for col in ('nfse_em', 'nfse_erro', 'nfse_chave', 'nfse_numero', 'nfse_id', 'nfse_status'):
            batch_op.drop_column(col)
    with op.batch_alter_table('config_cobranca', schema=None) as batch_op:
        for col in ('nfse_descricao', 'nfse_emissora_id', 'nfse_automatica'):
            batch_op.drop_column(col)
