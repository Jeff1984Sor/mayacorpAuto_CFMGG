from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped, UtcDateTime


class ConexaoMcp(Base, Timestamped):
    """Uma autorização dada por um usuário a um cliente MCP (ex.: Claude). Revogar = os tokens param de valer."""

    __tablename__ = "conexao_mcp"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    cliente: Mapped[str] = mapped_column(String(120))  # nome que o aplicativo informou ao se registrar
    destino: Mapped[str] = mapped_column(String(200))  # domínio para onde a autorização voltou
    escopo: Mapped[str] = mapped_column(String(10), default="leitura")  # leitura | escrita
    ativada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())  # o código de autorização foi trocado (uso único)
    ultimo_uso: Mapped[datetime | None] = mapped_column(UtcDateTime())
    revogada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
