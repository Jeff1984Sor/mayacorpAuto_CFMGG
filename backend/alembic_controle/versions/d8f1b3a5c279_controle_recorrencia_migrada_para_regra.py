"""controle: recorrência migrada para regra de cobrança (guarda o id da regra no banco do admin)

Revision ID: d8f1b3a5c279
Revises: c6e8a0b2d147
Create Date: 2026-11-28 19:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8f1b3a5c279'
down_revision: Union[str, Sequence[str], None] = 'c6e8a0b2d147'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # sem chave estrangeira: a regra mora em outro banco (o do admin). A migração dos dados é feita logo depois das
    # migrations (service.migrar_todos → faturamento_admin.preparar), uma vez por recorrência.
    with op.batch_alter_table('cobranca_recorrente', schema=None) as batch_op:
        batch_op.add_column(sa.Column('regra_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cobranca_recorrente', schema=None) as batch_op:
        batch_op.drop_column('regra_id')
