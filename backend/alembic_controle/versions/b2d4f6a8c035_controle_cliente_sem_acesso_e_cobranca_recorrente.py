"""controle: cobranças recorrentes (e cliente sem acesso ao sistema, que só usa a coluna tipo já existente)

Revision ID: b2d4f6a8c035
Revises: a8c3e5f7d924
Create Date: 2026-11-28 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.core.db


revision: str = 'b2d4f6a8c035'
down_revision: Union[str, Sequence[str], None] = 'a8c3e5f7d924'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SO_SEM_RECORRENCIA = sa.text("recorrencia_id IS NULL")


def upgrade() -> None:
    op.create_table('cobranca_recorrente',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('cliente_id', sa.Integer(), nullable=False),
    sa.Column('descricao', sa.String(length=180), nullable=False),
    sa.Column('valor', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('periodicidade', sa.String(length=10), nullable=False),
    sa.Column('dia_vencimento', sa.Integer(), nullable=False),
    sa.Column('inicio', sa.Date(), nullable=False),
    sa.Column('termino_tipo', sa.String(length=10), nullable=False),
    sa.Column('termino_data', sa.Date(), nullable=True),
    sa.Column('termino_quantidade', sa.Integer(), nullable=True),
    sa.Column('antecedencia', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('observacao', sa.Text(), nullable=True),
    sa.Column('proxima_competencia', sa.Date(), nullable=False),
    sa.Column('geradas', sa.Integer(), nullable=False),
    sa.Column('rotina_dia', sa.Date(), nullable=True),
    sa.Column('rotina_no_dia', sa.Integer(), nullable=False),
    sa.Column('criado_em', app.core.db.UtcDateTime(), nullable=False),
    sa.Column('encerrada_em', app.core.db.UtcDateTime(), nullable=True),
    sa.ForeignKeyConstraint(['cliente_id'], ['cliente.id'], name=op.f('fk_cobranca_recorrente_cliente_id_cliente'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_cobranca_recorrente'))
    )
    with op.batch_alter_table('cobranca_recorrente', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_cobranca_recorrente_cliente_id'), ['cliente_id'], unique=False)
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        batch_op.add_column(sa.Column('recorrencia_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('envio_erro', sa.String(length=200), nullable=True))
        batch_op.create_index(batch_op.f('ix_cobranca_recorrencia_id'), ['recorrencia_id'], unique=False)
        batch_op.create_foreign_key(batch_op.f('fk_cobranca_recorrencia_id_cobranca_recorrente'), 'cobranca_recorrente',
                                    ['recorrencia_id'], ['id'], ondelete='SET NULL')
        batch_op.create_unique_constraint('uq_cobranca_recorrencia', ['recorrencia_id', 'competencia'])
        # "uma por cliente, tipo e mês" continua valendo para mensalidade e cartão; as recorrentes saem da regra
        # (um cliente pode ter duas recorrências no mesmo mês) e ganham a delas: recorrência × competência
        batch_op.drop_constraint('uq_cobranca_competencia', type_='unique')
    op.create_index('uq_cobranca_competencia', 'cobranca', ['cliente_id', 'tipo', 'competencia'], unique=True,
                    postgresql_where=SO_SEM_RECORRENCIA, sqlite_where=SO_SEM_RECORRENCIA)


def downgrade() -> None:
    op.drop_index('uq_cobranca_competencia', table_name='cobranca')
    with op.batch_alter_table('cobranca', schema=None) as batch_op:
        batch_op.create_unique_constraint('uq_cobranca_competencia', ['cliente_id', 'tipo', 'competencia'])
        batch_op.drop_constraint('uq_cobranca_recorrencia', type_='unique')
        batch_op.drop_constraint(batch_op.f('fk_cobranca_recorrencia_id_cobranca_recorrente'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_cobranca_recorrencia_id'))
        batch_op.drop_column('envio_erro')
        batch_op.drop_column('recorrencia_id')
    with op.batch_alter_table('cobranca_recorrente', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_cobranca_recorrente_cliente_id'))
    op.drop_table('cobranca_recorrente')
