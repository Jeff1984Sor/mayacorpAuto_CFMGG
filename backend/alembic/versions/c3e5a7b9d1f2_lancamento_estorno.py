"""lançamento: estorno ligado ao original

Revision ID: c3e5a7b9d1f2
Revises: b2d4f6a8c0e1
Create Date: 2026-11-02 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3e5a7b9d1f2'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('fin_lancamento', schema=None) as batch_op:
        batch_op.add_column(sa.Column('estorno_de_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_fin_lancamento_estorno_de_id'), ['estorno_de_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_fin_lancamento_estorno_de_id_fin_lancamento'), 'fin_lancamento',
                                    ['estorno_de_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    with op.batch_alter_table('fin_lancamento', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_fin_lancamento_estorno_de_id_fin_lancamento'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_fin_lancamento_estorno_de_id'))
        batch_op.drop_column('estorno_de_id')
