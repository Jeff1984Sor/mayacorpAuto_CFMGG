"""Descobre o escritório de cada pedido (HTTP e WebSocket) quando há um banco por escritório.

Ordem: o token (cabeçalho Authorization ou ?token=, que o SSE, o WebSocket e os links de e-mail usam) e,
sem token, o domínio próprio do escritório. Sem nenhum dos dois o pedido segue sem escritório: só o login
(que procura no catálogo de logins) e as rotas públicas funcionam assim.
"""

from urllib.parse import parse_qs

import anyio
import jwt

from app.core import tenancy
from app.core.config import settings
from app.core.tenancy import Escritorio


def escritorio_do_token(token: str | None) -> Escritorio | None:
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    slug = payload.get("cli")
    if not slug:
        return None
    from app.controle import service

    return service.por_slug(slug)


def definir_pelo_token(token: str | None) -> Escritorio | None:
    """Para os tokens que chegam no corpo (refresh, redefinir senha)."""
    if not tenancy.multi():
        return None
    esc = escritorio_do_token(token)
    if esc is not None:
        tenancy.definir(esc)
    return esc


def _identificar(scope) -> Escritorio | None:
    from app.controle import service

    headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
    auth = headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else None
    if not token:
        token = (parse_qs(scope.get("query_string", b"").decode()).get("token") or [None])[0]
    esc = escritorio_do_token(token)
    if esc is None and headers.get("host"):
        esc = service.por_host(headers["host"])
    return esc


class EscritorioMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not tenancy.multi():
            await self.app(scope, receive, send)
            return
        esc = await anyio.to_thread.run_sync(_identificar, scope)  # consulta o banco de controle (com cache)
        token = tenancy.definir(esc)
        try:
            await self.app(scope, receive, send)
        finally:
            tenancy._atual.reset(token)
