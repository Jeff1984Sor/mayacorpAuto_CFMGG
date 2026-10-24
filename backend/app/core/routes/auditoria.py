from datetime import date, datetime, time

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.core.deps import Admin
from app.core.models import Auditoria
from app.core.schemas import AuditoriaOut, Pagina

router = APIRouter(tags=["auditoria"])


@router.get("/auditoria", response_model=Pagina[AuditoriaOut])
def listar(
    ctx: Admin,
    q: str | None = None,
    acao: str | None = None,
    entidade: str | None = None,
    de: date | None = None,
    ate: date | None = None,
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(25, ge=1, le=200),
):
    filtro = [Auditoria.tenant_id == ctx.tenant_id]
    if q:
        like = f"%{q}%"
        filtro.append(or_(Auditoria.descricao.ilike(like), Auditoria.usuario_nome.ilike(like), Auditoria.acao.ilike(like)))
    if acao:
        filtro.append(Auditoria.acao.startswith(acao))
    if entidade:
        filtro.append(Auditoria.entidade == entidade)
    if de:
        filtro.append(Auditoria.criado_em >= datetime.combine(de, time.min))
    if ate:
        filtro.append(Auditoria.criado_em <= datetime.combine(ate, time.max))
    total = ctx.db.scalar(select(func.count()).select_from(Auditoria).where(*filtro)) or 0
    itens = ctx.db.scalars(
        select(Auditoria).where(*filtro).order_by(Auditoria.id.desc()).offset((pagina - 1) * por_pagina).limit(por_pagina)
    )
    return Pagina[AuditoriaOut](itens=[AuditoriaOut.model_validate(a) for a in itens], total=total, pagina=pagina,
                                por_pagina=por_pagina)
