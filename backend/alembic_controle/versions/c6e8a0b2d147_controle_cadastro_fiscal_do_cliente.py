"""controle: cadastro fiscal do cliente (o cliente aponta para o cadastro completo dele no banco do admin)

Revision ID: c6e8a0b2d147
Revises: b2d4f6a8c035
Create Date: 2026-11-28 15:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c6e8a0b2d147'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c035'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sem chave estrangeira: o tomador mora em outro banco (o do admin). A ligação dos clientes que já existem é feita
    # logo depois das migrations (service.migrar_todos → cadastro.ligar_todos), sem duplicar cadastro.
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tomador_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_cliente_tomador_id'), ['tomador_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_cliente_tomador_id'))
        batch_op.drop_column('tomador_id')
