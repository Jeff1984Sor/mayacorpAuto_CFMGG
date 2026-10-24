"""audiencias e reunioes viram tarefas

Revision ID: cee6f5084fae
Revises: 880c07407ad2
Create Date: 2026-10-24 19:37:03.002734

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = 'cee6f5084fae'
down_revision: str | Sequence[str] | None = '880c07407ad2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
