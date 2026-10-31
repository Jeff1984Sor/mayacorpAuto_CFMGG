"""controle: senha do usuário Suporte

Revision ID: c4d81e7a9b30
Revises: b7e3c19f0a21
Create Date: 2026-10-31 18:20:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d81e7a9b30'
down_revision: Union[str, Sequence[str], None] = 'b7e3c19f0a21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('politica_comercial', schema=None) as batch_op:
        batch_op.add_column(sa.Column('senha_suporte_hash', sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('politica_comercial', schema=None) as batch_op:
        batch_op.drop_column('senha_suporte_hash')
