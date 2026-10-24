"""Rotas públicas (sem login): identidade visual para a tela de login."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core.deps import DB
from app.core.models import Identidade, Tenant
from app.core.schemas import IdentidadePublica

router = APIRouter(prefix="/public", tags=["público"])


def _identidade(request: Request, db) -> Identidade | None:
    # Multi-cliente por subdomínio/caminho no futuro; hoje: ?tenant=slug ou o primeiro tenant
    slug = request.query_params.get("tenant")
    q = select(Identidade).join(Tenant)
    if slug:
        q = q.where(Tenant.slug == slug)
    return db.scalar(q.order_by(Tenant.id))


def logo_url(ident: Identidade | None) -> str | None:
    if not ident or not ident.logo_path:
        return None
    return f"/public/logo?v={int(Path(ident.logo_path).stat().st_mtime) if Path(ident.logo_path).exists() else 0}"


@router.get("/identidade", response_model=IdentidadePublica)
def identidade(request: Request, db: DB):
    ident = _identidade(request, db)
    if not ident:
        return IdentidadePublica(nome_exibicao="MayaJus")
    return IdentidadePublica(nome_exibicao=ident.nome_exibicao, logo_url=logo_url(ident), cor_destaque=ident.cor_destaque)


@router.get("/logo")
def logo(request: Request, db: DB):
    ident = _identidade(request, db)
    if not ident or not ident.logo_path or not Path(ident.logo_path).exists():
        raise HTTPException(404, "Sem logo")
    return FileResponse(ident.logo_path, headers={"Cache-Control": "public, max-age=300"})
