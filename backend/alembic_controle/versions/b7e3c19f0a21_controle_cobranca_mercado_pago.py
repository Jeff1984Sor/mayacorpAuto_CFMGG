"""controle: cobrança pelo Mercado Pago

Revision ID: b7e3c19f0a21
Revises: ddaa2530da85
Create Date: 2026-10-31 17:10:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.core.db


revision: str = 'b7e3c19f0a21'
down_revision: Union[str, Sequence[str], None] = 'ddaa2530da85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('config_cobranca',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('mp_token_cifrado', sa.LargeBinary(), nullable=True),
    sa.Column('mp_segredo_cifrado', sa.LargeBinary(), nullable=True),
    sa.Column('mp_conta', sa.String(length=200), nullable=True),
    sa.Column('dia_vencimento', sa.Integer(), nullable=False),
    sa.Column('gerar_automatico', sa.Boolean(), nullable=False),
    sa.Column('regua', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_config_cobranca'))
    )
    op.create_table('cobranca',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('cliente_id', sa.Integer(), nullable=False),
    sa.Column('tipo', sa.String(length=12), nullable=False),
    sa.Column('competencia', sa.String(length=7), nullable=True),
    sa.Column('descricao', sa.String(length=200), nullable=False),
    sa.Column('itens', sa.JSON(), nullable=False),
    sa.Column('valor', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('vencimento', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('link', sa.String(length=500), nullable=True),
    sa.Column('mp_preferencia_id', sa.String(length=80), nullable=True),
    sa.Column('mp_pagamento_id', sa.String(length=40), nullable=True),
    sa.Column('pago_em', app.core.db.UtcDateTime(), nullable=True),
    sa.Column('forma_paga', sa.String(length=30), nullable=True),
    sa.Column('avisos', sa.JSON(), nullable=False),
    sa.Column('criado_em', app.core.db.UtcDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['cliente_id'], ['cliente.id'], name=op.f('fk_cobranca_cliente_id_cliente'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cobranca')),
    sa.UniqueConstraint('cliente_id', 'tipo', 'competencia', name='uq_cobranca_competencia')
    )
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_cobranca_cliente_id'), ['cliente_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_cobranca_mp_pagamento_id'), ['mp_pagamento_id'], unique=False)
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.add_column(sa.Column('forma_pagamento', sa.String(length=10), server_default='link', nullable=False))
        batch_op.add_column(sa.Column('mp_assinatura_id', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('mp_assinatura_status', sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cliente', schema=None) as batch_op:
        batch_op.drop_column('mp_assinatura_status')
        batch_op.drop_column('mp_assinatura_id')
        batch_op.drop_column('forma_pagamento')
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_cobranca_mp_pagamento_id'))
        batch_op.drop_index(batch_op.f('ix_cobranca_cliente_id'))
    op.drop_table('cobranca')
    op.drop_table('config_cobranca')
