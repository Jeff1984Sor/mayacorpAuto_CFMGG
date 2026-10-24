"""Trilha de auditoria imutável."""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.core.models import Auditoria, Usuario

CAMPOS_SENSIVEIS = {"senha_hash", "pfx_cifrado", "senha_cifrada", "smtp_senha_cifrada", "chave_cifrada"}


@event.listens_for(Auditoria, "before_update")
def _bloquear_update(*_):
    raise PermissionError("A auditoria é imutável.")


@event.listens_for(Auditoria, "before_delete")
def _bloquear_delete(*_):
    raise PermissionError("A auditoria é imutável.")


def _jsonable(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, bytes):
        return "<binário>"
    return v


def snapshot(obj: Any) -> dict[str, Any]:
    """Foto das colunas de um modelo, sem campos sensíveis."""
    mapper = inspect(obj).mapper
    return {
        c.key: _jsonable(getattr(obj, c.key))
        for c in mapper.column_attrs
        if c.key not in CAMPOS_SENSIVEIS
    }


def diff(antes: dict[str, Any], depois: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    chaves = {k for k in set(antes) | set(depois) if antes.get(k) != depois.get(k) and k != "atualizado_em"}
    return {k: antes.get(k) for k in chaves}, {k: depois.get(k) for k in chaves}


def registrar(
    db: Session,
    *,
    tenant_id: int,
    usuario: Usuario | None,
    acao: str,
    entidade: str,
    entidade_id: Any = None,
    descricao: str | None = None,
    antes: dict[str, Any] | None = None,
    depois: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    db.add(
        Auditoria(
            tenant_id=tenant_id,
            usuario_id=usuario.id if usuario else None,
            usuario_nome=usuario.nome if usuario else "Robô",
            acao=acao,
            entidade=entidade,
            entidade_id=str(entidade_id) if entidade_id is not None else None,
            descricao=descricao,
            antes_json=antes,
            depois_json=depois,
            ip=ip,
        )
    )
