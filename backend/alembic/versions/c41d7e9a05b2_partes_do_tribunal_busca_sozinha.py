"""partes do tribunal: quando vieram para o caso e a última busca feita pela ficha

Revision ID: c41d7e9a05b2
Revises: a231ec81bcc4
Create Date: 2026-11-28 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.core.db


# revision identifiers, used by Alembic.
revision: str = 'c41d7e9a05b2'
down_revision: Union[str, Sequence[str], None] = 'a231ec81bcc4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('fat_caso_contencioso', schema=None) as batch_op:
        batch_op.add_column(sa.Column('partes_tribunal_em', app.core.db.UtcDateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('partes_tribunal_tentativa_em', app.core.db.UtcDateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('fat_caso_contencioso', schema=None) as batch_op:
        batch_op.drop_column('partes_tribunal_tentativa_em')
        batch_op.drop_column('partes_tribunal_em')
