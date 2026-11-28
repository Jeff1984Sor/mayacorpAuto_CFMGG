"""Tipos de caso (contencioso, consultivo, administrativo): listas fixas do sistema e as tabelas que acompanham o caso.

O caso (`fat_caso`) guarda os campos comuns. O que é só de um tipo fica numa tabela 1:1 (`fat_caso_contencioso`,
`fat_caso_consultivo`, `fat_caso_administrativo`). Listas que o escritório edita ficam em `fat_lista_item`
(seed em `listas.py`); as fixas são os enums daqui, com o rótulo em `ROTULOS`.
"""

import enum

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped


class TipoDeCaso(enum.StrEnum):
    contencioso = "contencioso"
    consultivo = "consultivo"
    administrativo = "administrativo"


class TipoVinculo(enum.StrEnum):
    recurso = "recurso"
    incidente = "incidente"
    apenso = "apenso"
    desdobramento = "desdobramento"
    conexo = "conexo"
    judicializacao = "judicializacao"


ROTULOS: dict[str, dict[str, str]] = {
    "tipo_caso": {"contencioso": "Contencioso", "consultivo": "Consultivo", "administrativo": "Administrativo"},
    "status": {"aberto": "Ativo", "suspenso": "Suspenso", "arquivado": "Arquivado", "encerrado": "Encerrado"},
    "tipo_vinculo": {"recurso": "Recurso", "incidente": "Incidente", "apenso": "Apenso", "desdobramento": "Desdobramento",
                     "conexo": "Conexo", "judicializacao": "Judicialização"},
}

# Listas que o escritório edita (Configurações › Faturamento): código → (nome, tipo de caso em que aparece ou None = todos)
LISTAS: dict[str, tuple[str, str | None]] = {
    "motivo_encerramento": ("Motivos de encerramento", None),
    "origem": ("Origem da captação", None),
    "centro_custo": ("Centros de custo", None),
    "etiqueta": ("Etiquetas", None),
    "classe": ("Classes processuais", "contencioso"),
    "assunto": ("Assuntos", "contencioso"),
    "tipo_demanda": ("Tipos de demanda", "consultivo"),
    "orgao": ("Órgãos", "administrativo"),
    "tipo_procedimento": ("Tipos de procedimento", "administrativo"),
}


class ListaItem(Base, Timestamped):
    """Item de uma lista configurável do escritório. Os do sistema (seed) têm `codigo` e nunca são apagados."""

    __tablename__ = "fat_lista_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    lista: Mapped[str] = mapped_column(String(30), index=True)
    codigo: Mapped[str | None] = mapped_column(String(80))  # só nos itens do sistema (identifica o seed)
    nome: Mapped[str] = mapped_column(String(150))
    ordem: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    sistema: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("tenant_id", "lista", "codigo", name="uq_fat_lista_item_codigo"),)


class CasoEquipe(Base):
    """Demais profissionais do caso (o responsável fica em `Caso.responsavel_id`)."""

    __tablename__ = "fat_caso_equipe"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), primary_key=True, index=True)


class CasoLista(Base):
    """Itens de lista que o caso pode ter vários: etiquetas e assuntos secundários."""

    __tablename__ = "fat_caso_lista"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("fat_lista_item.id"), primary_key=True, index=True)
    papel: Mapped[str] = mapped_column(String(20), primary_key=True)  # etiqueta | assunto_secundario
