"""campos adicionais por cliente, modelo de título do caso e formato do título na nota

Revision ID: e5a7c9d1f3b4
Revises: d4f6a8c0e2b3
Create Date: 2026-11-10 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5a7c9d1f3b4'
down_revision: Union[str, Sequence[str], None] = 'd4f6a8c0e2b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('fat_campo', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tomador_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_fat_campo_tomador_id'), ['tomador_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_fat_campo_tomador_id_tomador'), 'tomador', ['tomador_id'], ['id'],
                                    ondelete='CASCADE')
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.add_column(sa.Column('modelo_titulo_caso', sa.String(length=300), nullable=True))
    with op.batch_alter_table('config_nfse', schema=None) as batch_op:
        batch_op.add_column(sa.Column('nota_titulo_formato', sa.String(length=10), server_default='numero', nullable=False))


def downgrade() -> None:
    with op.batch_alter_table('config_nfse', schema=None) as batch_op:
        batch_op.drop_column('nota_titulo_formato')
    with op.batch_alter_table('tomador', schema=None) as batch_op:
        batch_op.drop_column('modelo_titulo_caso')
    with op.batch_alter_table('fat_campo', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_fat_campo_tomador_id_tomador'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_fat_campo_tomador_id'))
        batch_op.drop_column('tomador_id')
