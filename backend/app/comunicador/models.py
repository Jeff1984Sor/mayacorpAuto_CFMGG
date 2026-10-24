"""Comunicador interno (inspirado no do sistema RCA): presença, chat direto/grupo, menções e o canal do robô.

Conversa direta é única por par de usuários (chave_direta UNIQUE, não só por consulta). Em vez de um recibo
por mensagem, cada participante guarda até qual mensagem leu (`lida_ate`) — dá o ✓✓ e o contador com uma linha.
"""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UtcDateTime, agora


def chave_direta(a: int, b: int) -> str:
    x, y = sorted((int(a), int(b)))
    return f"{x}:{y}"


class Conversa(Base):
    __tablename__ = "cm_conversa"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(10))  # direta | grupo | robo
    titulo: Mapped[str | None] = mapped_column(String(140))
    chave_direta: Mapped[str | None] = mapped_column(String(40))
    criado_por: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    ultima_msg_em: Mapped[datetime | None] = mapped_column(UtcDateTime(), index=True)

    participantes: Mapped[list["Participante"]] = relationship(back_populates="conversa", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("tenant_id", "chave_direta", name="uq_cm_conversa_direta"),)


class Participante(Base):
    __tablename__ = "cm_participante"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int] = mapped_column(ForeignKey("cm_conversa.id", ondelete="CASCADE"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    lida_ate: Mapped[int] = mapped_column(Integer, default=0)  # id da última mensagem lida
    silenciada: Mapped[bool] = mapped_column(Boolean, default=False)
    entrou_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    conversa: Mapped[Conversa] = relationship(back_populates="participantes")

    __table_args__ = (UniqueConstraint("conversa_id", "usuario_id", name="uq_cm_participante"),)


class Mensagem(Base):
    __tablename__ = "cm_mensagem"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int] = mapped_column(ForeignKey("cm_conversa.id", ondelete="CASCADE"))
    autor_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))  # None = Robô MayaCorp
    texto: Mapped[str] = mapped_column(Text)
    resposta_a_id: Mapped[int | None] = mapped_column(ForeignKey("cm_mensagem.id", ondelete="SET NULL"))
    link: Mapped[str | None] = mapped_column(String(300))  # mensagens do robô apontam para o lote/extrato
    criada_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    editada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    apagada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())

    __table_args__ = (Index("ix_cm_mensagem_conversa_id_id", "conversa_id", "id"),)


class Mencao(Base):
    """@ numa mensagem ou "Chamar alguém" a partir de um registro (lote, nota, extrato...)."""

    __tablename__ = "cm_mencao"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"))  # quem foi mencionado
    autor_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"))
    mensagem_id: Mapped[int | None] = mapped_column(ForeignKey("cm_mensagem.id", ondelete="CASCADE"))
    origem_tipo: Mapped[str | None] = mapped_column(String(30))  # lote | nfse | fatura | extrato
    origem_id: Mapped[int | None] = mapped_column(Integer)
    trecho: Mapped[str] = mapped_column(String(300), default="")
    url: Mapped[str | None] = mapped_column(String(300))
    criada_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora, index=True)
    lida_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    resolvida_em: Mapped[datetime | None] = mapped_column(UtcDateTime())

    __table_args__ = (Index("ix_cm_mencao_usuario_lida", "usuario_id", "lida_em"),)
