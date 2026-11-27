"""controle: chaves de IA da MayaCorp (o admin libera a IA de cada escritório)

Revision ID: a8c3e5f7d924
Revises: f7a2c4e6b813
Create Date: 2026-11-27 18:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c3e5f7d924'
down_revision: Union[str, Sequence[str], None] = 'f7a2c4e6b813'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('ia_chave',
                    sa.Column('provedor', sa.String(length=10), nullable=False),
                    sa.Column('chave_cifrada', sa.LargeBinary(), nullable=False),
                    sa.Column('atualizado_em', sa.DateTime(timezone=True), nullable=False),
                    sa.PrimaryKeyConstraint('provedor', name=op.f('pk_ia_chave')))


def downgrade() -> None:
    op.drop_table('ia_chave')
