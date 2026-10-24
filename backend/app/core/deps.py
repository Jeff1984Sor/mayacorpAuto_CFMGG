"""Dependências FastAPI: sessão, usuário logado e controle de perfil (aplicado no backend)."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core import audit
from app.core.db import agora, get_db
from app.core.models import Perfil, Usuario
from app.core.security import decodificar_token

_bearer = HTTPBearer(auto_error=False)

DB = Annotated[Session, Depends(get_db)]


@dataclass
class Contexto:
    db: Session
    usuario: Usuario
    ip: str | None

    @property
    def tenant_id(self) -> int:
        return self.usuario.tenant_id

    def auditar(self, acao: str, entidade: str, entidade_id=None, descricao=None, antes=None, depois=None):
        audit.registrar(
            self.db,
            tenant_id=self.tenant_id,
            usuario=self.usuario,
            acao=acao,
            entidade=entidade,
            entidade_id=entidade_id,
            descricao=descricao,
            antes=antes,
            depois=depois,
            ip=self.ip,
        )


def ip_cliente(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _token(request: Request, cred: HTTPAuthorizationCredentials | None) -> str | None:
    if cred:
        return cred.credentials
    # EventSource (SSE) não envia cabeçalhos: aceita ?token= somente nessa rota
    return request.query_params.get("token") if request.url.path.endswith("/progresso") else None


def get_contexto(
    request: Request, db: DB, cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> Contexto:
    token = _token(request, cred)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Faça login para continuar.")
    try:
        payload = decodificar_token(token, "access")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.") from None
    usuario = db.get(Usuario, int(payload["sub"]))
    if not usuario or not usuario.ativo:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inativo.")
    now = agora()
    ultima = usuario.ultima_atividade
    if ultima is None or (now - ultima.replace(tzinfo=now.tzinfo)) > timedelta(minutes=1):
        usuario.ultima_atividade = now
        db.commit()
    return Contexto(db=db, usuario=usuario, ip=ip_cliente(request))


Ctx = Annotated[Contexto, Depends(get_contexto)]


def exigir(*perfis: Perfil):
    def _dep(ctx: Ctx) -> Contexto:
        if ctx.usuario.perfil not in perfis:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Seu perfil não tem permissão para esta ação.")
        return ctx

    return Depends(_dep)


Admin = Annotated[Contexto, exigir(Perfil.admin)]
Operador = Annotated[Contexto, exigir(Perfil.admin, Perfil.operador)]
