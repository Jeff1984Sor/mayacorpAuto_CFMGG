from sqlalchemy import JSON, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped


class RelatorioSalvo(Base, Timestamped):
    """Relatório montado e salvo pelo usuário (colunas, filtros e gráfico). Compartilhado = todo o escritório vê."""

    __tablename__ = "relatorio_salvo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(120))
    descricao: Mapped[str | None] = mapped_column(String(300))
    fonte: Mapped[str] = mapped_column(String(30))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    compartilhado: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id", ondelete="SET NULL"))
