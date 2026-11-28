"""Cadastro único de pessoas (Cadastros › Pessoas): a pessoa em si é `trb_pessoa` (`tribunais.models.Pessoa`), a mesma
das partes de processo importado. Aqui ficam os dados profissionais de quem é advogado.

Pessoa (trb_pessoa) ─┬─ Advogado (0..1) ── inscrições na OAB (N)
                     └─ cliente (0..1): `tomador.pessoa_id`, vínculo 1:1 (o cadastro de clientes é a fonte de nome e documento)
"""

from sqlalchemy import Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped


class Advogado(Base, Timestamped):
    """Dados profissionais de uma pessoa que é advogado (da parte contrária, correspondente ou do próprio escritório)."""

    __tablename__ = "pes_advogado"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    pessoa_id: Mapped[int] = mapped_column(ForeignKey("trb_pessoa.id"), unique=True)
    sociedade_id: Mapped[int | None] = mapped_column(ForeignKey("trb_pessoa.id"))  # escritório a que pertence (pessoa jurídica)
    eh_interno: Mapped[bool] = mapped_column(Boolean, default=False)  # advogado do próprio escritório
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id", ondelete="SET NULL"), index=True)
    email_profissional: Mapped[str | None] = mapped_column(String(200))
    telefone_profissional: Mapped[str | None] = mapped_column(String(30))
    observacoes: Mapped[str | None] = mapped_column(Text)

    oabs: Mapped[list["AdvogadoOab"]] = relationship(back_populates="advogado", cascade="all, delete-orphan",
                                                    order_by="(AdvogadoOab.principal.desc(), AdvogadoOab.id)")


class AdvogadoOab(Base, Timestamped):
    __tablename__ = "pes_advogado_oab"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    advogado_id: Mapped[int] = mapped_column(ForeignKey("pes_advogado.id", ondelete="CASCADE"), index=True)
    numero: Mapped[str] = mapped_column(String(10))  # dígitos e, se houver, a letra: 123456 ou 123456-A
    uf: Mapped[str] = mapped_column(String(2))
    tipo_inscricao: Mapped[str] = mapped_column(String(12), default="principal")  # principal | suplementar | estagiario | provisoria
    situacao: Mapped[str] = mapped_column(String(10), default="regular")  # regular | suspensa | cancelada | licenciada
    principal: Mapped[bool] = mapped_column(Boolean, default=False)

    advogado: Mapped[Advogado] = relationship(back_populates="oabs")

    __table_args__ = (UniqueConstraint("tenant_id", "numero", "uf", "tipo_inscricao", name="uq_pes_advogado_oab"),)
