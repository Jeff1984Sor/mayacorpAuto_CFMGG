"""OAuth 2.1 do conector MCP: descoberta, registro dinâmico de cliente, autorização com PKCE e tokens.

Nada fica guardado sobre o aplicativo cliente: o `client_id` é um JWT assinado com os `redirect_uris` dele (o
registro acontece antes do login, quando ainda não se sabe de qual escritório é). O que fica no banco do
escritório é a conexão (quem autorizou, qual aplicativo, leitura ou escrita), que o usuário pode revogar.
"""

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal
from urllib.parse import urlencode, urlsplit

import jwt
from fastapi import APIRouter, Form, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.core import tenancy
from app.core.config import settings
from app.core.db import agora
from app.core.deps import DB, Ctx
from app.core.escritorio_http import definir_pelo_token
from app.core.models import Usuario
from app.modules.mcp.models import ConexaoMcp

router = APIRouter(prefix="/mcp", tags=["Claude (MCP)"])
raiz = APIRouter(include_in_schema=False)  # /.well-known na raiz do domínio (em produção quem responde é o Next)

ACESSO = timedelta(hours=1)
RENOVACAO = timedelta(days=90)
CODIGO = timedelta(minutes=5)
ESCOPOS = ["leitura", "escrita"]
_LOCAIS = ("localhost", "127.0.0.1", "[::1]")


# ------------------------------------------------------------------------------------------------- tokens
def assinar(tipo: str, dados: dict[str, Any], duracao: timedelta | None = None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {"typ": tipo, "iat": now, "jti": secrets.token_hex(8), **dados}
    if duracao:
        payload["exp"] = now + duracao
    if (esc := tenancy.atual()) is not None:
        payload["cli"] = esc.slug  # é por aqui que o EscritorioMiddleware acha o banco do escritório
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def ler(token: str, tipo: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if payload.get("typ") != tipo:
        raise jwt.InvalidTokenError("tipo de token inválido")
    return payload


def base(request: Request) -> str:
    """Endereço público por onde o pedido chegou (cada escritório pode ter o próprio domínio)."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{request.headers.get('host') or request.url.netloc}"


def _tela(request: Request) -> str:
    host = (request.headers.get("host") or "").split(":")[0]
    return settings.frontend_url.rstrip("/") if host in _LOCAIS else base(request)


# ------------------------------------------------------------------------------------------------- descoberta
def recurso_protegido(request: Request) -> dict:
    b = base(request)
    return {"resource": f"{b}/api/mcp", "authorization_servers": [b], "bearer_methods_supported": ["header"],
            "scopes_supported": ESCOPOS, "resource_name": "MayaJus"}


def servidor_de_autorizacao(request: Request) -> dict:
    b = base(request)
    return {
        "issuer": b,
        "authorization_endpoint": f"{b}/api/mcp/oauth/autorizar",
        "token_endpoint": f"{b}/api/mcp/oauth/token",
        "registration_endpoint": f"{b}/api/mcp/oauth/registrar",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ESCOPOS,
    }


for _r in (router, raiz):
    _r.add_api_route("/.well-known/oauth-protected-resource", recurso_protegido, methods=["GET"], include_in_schema=False)
    _r.add_api_route("/.well-known/oauth-authorization-server", servidor_de_autorizacao, methods=["GET"], include_in_schema=False)
    _r.add_api_route("/.well-known/openid-configuration", servidor_de_autorizacao, methods=["GET"], include_in_schema=False)
raiz.add_api_route("/.well-known/oauth-protected-resource/{resto:path}", recurso_protegido, methods=["GET"])
raiz.add_api_route("/.well-known/oauth-authorization-server/{resto:path}", servidor_de_autorizacao, methods=["GET"])


# ------------------------------------------------------------------------------------------------- cliente
def _redirect_aceito(uri: str) -> bool:
    u = urlsplit(uri)
    if u.fragment or not u.hostname:
        return False
    return u.scheme == "https" or (u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1"))


class RegistroIn(BaseModel):
    redirect_uris: list[str]
    client_name: str | None = None


@router.post("/oauth/registrar", status_code=201, include_in_schema=False)
def registrar(dados: RegistroIn):
    uris = dados.redirect_uris[:10]
    if not uris or not all(_redirect_aceito(u) and len(u) <= 500 for u in uris):
        return JSONResponse({"error": "invalid_redirect_uri", "error_description": "Use https (ou http://localhost)."}, 400)
    nome = (dados.client_name or "Aplicativo MCP").strip()[:120]
    return {
        "client_id": assinar("mcp_cliente", {"ru": uris, "nome": nome}),
        "client_name": nome,
        "redirect_uris": uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "client_id_issued_at": int(datetime.now(UTC).timestamp()),
    }


def _cliente(client_id: str, redirect_uri: str) -> dict:
    """Valida o aplicativo e o endereço de retorno. Erro aqui nunca redireciona (o retorno não é confiável)."""
    try:
        c = ler(client_id, "mcp_cliente")
    except jwt.PyJWTError:
        raise HTTPException(400, "Aplicativo não reconhecido. Remova o conector no Claude e adicione de novo.") from None
    u = urlsplit(redirect_uri)
    local = u.hostname in ("localhost", "127.0.0.1", "::1")

    def igual(registrado: str) -> bool:
        if registrado == redirect_uri:
            return True
        r = urlsplit(registrado)  # aplicativos locais (Claude Code) abrem uma porta diferente a cada vez
        return local and r.hostname == u.hostname and r.scheme == u.scheme and r.path == u.path

    if not _redirect_aceito(redirect_uri) or not any(igual(r) for r in c.get("ru", [])):
        raise HTTPException(400, "Endereço de retorno não registrado para este aplicativo.")
    host = u.hostname or ""
    confiavel = local or host in ("claude.ai", "claude.com") or host.endswith((".claude.ai", ".claude.com", ".anthropic.com"))
    return {"nome": c.get("nome") or "Aplicativo MCP", "destino": "este computador" if local else host, "confiavel": confiavel}


def _voltar(redirect_uri: str, **params: str | None) -> str:
    sep = "&" if "?" in redirect_uri else "?"
    return redirect_uri + sep + urlencode({k: v for k, v in params.items() if v is not None})


@router.get("/oauth/autorizar", include_in_schema=False)
def autorizar(request: Request, client_id: str, redirect_uri: str, response_type: str = "code", code_challenge: str | None = None,
              code_challenge_method: str | None = None, state: str | None = None):
    _cliente(client_id, redirect_uri)
    if response_type != "code" or not code_challenge or code_challenge_method != "S256":
        return RedirectResponse(_voltar(redirect_uri, error="invalid_request", state=state,
                                        error_description="Use response_type=code com PKCE (S256)."), 302)
    q = urlencode({k: v for k, v in {"client_id": client_id, "redirect_uri": redirect_uri, "code_challenge": code_challenge,
                                     "state": state}.items() if v is not None})
    return RedirectResponse(f"{_tela(request)}/conectar-claude?{q}", 302)


@router.get("/oauth/cliente", include_in_schema=False)
def cliente(client_id: str, redirect_uri: str):
    """Para a tela de autorização: quem está pedindo e para onde a pessoa volta."""
    return _cliente(client_id, redirect_uri)


class AprovarIn(BaseModel):
    client_id: str
    redirect_uri: str
    code_challenge: str
    state: str | None = None
    escopo: Literal["leitura", "escrita"] = "leitura"


@router.post("/oauth/aprovar", include_in_schema=False)
def aprovar(dados: AprovarIn, ctx: Ctx):
    c = _cliente(dados.client_id, dados.redirect_uri)
    if not ctx.usuario.acesso_sistema:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Seu usuário não tem acesso ao sistema.")
    cx = ConexaoMcp(tenant_id=ctx.tenant_id, usuario_id=ctx.usuario.id, cliente=c["nome"], destino=c["destino"][:200], escopo=dados.escopo)
    ctx.db.add(cx)
    ctx.db.flush()
    ctx.auditar("conectar", "conexao_mcp", cx.id, f"Autorizou {c['nome']} ({c['destino']}) a acessar o sistema: "
                + ("consultar e alterar" if dados.escopo == "escrita" else "só consultar"))
    ctx.db.commit()
    codigo = assinar("mcp_codigo", {"sub": str(ctx.usuario.id), "cx": cx.id, "cc": dados.code_challenge, "ru": dados.redirect_uri,
                                   "cid": _resumo(dados.client_id)}, CODIGO)
    return {"redirect": _voltar(dados.redirect_uri, code=codigo, state=dados.state)}


# ------------------------------------------------------------------------------------------------- token
def _resumo(texto: str) -> str:
    return hashlib.sha256(texto.encode()).hexdigest()[:24]


def _pkce(verificador: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).rstrip(b"=").decode()


def _negar(descricao: str, erro: str = "invalid_grant") -> JSONResponse:
    return JSONResponse({"error": erro, "error_description": descricao}, 400, headers={"Cache-Control": "no-store"})


def _emitir(cx: ConexaoMcp) -> JSONResponse:
    dados = {"sub": str(cx.usuario_id), "cx": cx.id}
    return JSONResponse({"access_token": assinar("mcp", dados, ACESSO), "token_type": "Bearer", "expires_in": int(ACESSO.total_seconds()),
                         "refresh_token": assinar("mcp_renovar", dados, RENOVACAO), "scope": cx.escopo},
                        headers={"Cache-Control": "no-store"})


def conexao_valida(db, payload: dict) -> ConexaoMcp | None:
    """A conexão do token, se ainda vale (não revogada, usuário ativo e com acesso)."""
    cx = db.get(ConexaoMcp, payload["cx"]) if isinstance(payload.get("cx"), int) else None
    if cx is None or cx.revogada_em is not None or str(cx.usuario_id) != str(payload.get("sub")):
        return None
    u = db.get(Usuario, cx.usuario_id)
    return cx if u and u.ativo and u.acesso_sistema else None


@router.post("/oauth/token", include_in_schema=False)
def token(db: DB, grant_type: Annotated[str, Form()], code: Annotated[str | None, Form()] = None,
          code_verifier: Annotated[str | None, Form()] = None, redirect_uri: Annotated[str | None, Form()] = None,
          client_id: Annotated[str | None, Form()] = None, refresh_token: Annotated[str | None, Form()] = None):
    if grant_type not in ("authorization_code", "refresh_token"):
        return _negar("Tipo de concessão não suportado.", "unsupported_grant_type")
    bruto, tipo = (code, "mcp_codigo") if grant_type == "authorization_code" else (refresh_token, "mcp_renovar")
    try:
        payload = ler(bruto or "", tipo)
    except jwt.PyJWTError:
        return _negar("Autorização inválida ou expirada. Conecte de novo.")
    if tenancy.multi() and definir_pelo_token(bruto) is None:
        return _negar("Escritório não encontrado.")
    cx = conexao_valida(db, payload)
    if cx is None:
        return _negar("Esta conexão foi encerrada. Conecte de novo.")
    if grant_type == "authorization_code":
        if cx.ativada_em is not None:  # código reaproveitado: encerra a conexão inteira
            cx.revogada_em = agora()
            db.commit()
            return _negar("Código já utilizado.")
        if not code_verifier or not secrets.compare_digest(_pkce(code_verifier), payload.get("cc", "")):
            return _negar("Verificação PKCE não confere.")
        if (redirect_uri and redirect_uri != payload.get("ru")) or (client_id and _resumo(client_id) != payload.get("cid")):
            return _negar("Aplicativo ou endereço de retorno não conferem.")
        cx.ativada_em = agora()
        db.commit()
    return _emitir(cx)


# ------------------------------------------------------------------------------------------------- conexões do usuário
@router.get("/conexoes", include_in_schema=False)
def conexoes(request: Request, ctx: Ctx):
    """O endereço do conector e as conexões ativas: as minhas e, para o administrador, as de todo o escritório."""
    q = select(ConexaoMcp).where(ConexaoMcp.tenant_id == ctx.tenant_id, ConexaoMcp.ativada_em.is_not(None),
                                 ConexaoMcp.revogada_em.is_(None)).order_by(ConexaoMcp.id.desc())
    if not ctx.usuario.administrador:
        q = q.where(ConexaoMcp.usuario_id == ctx.usuario.id)
    linhas = ctx.db.scalars(q).all()
    nomes = dict(ctx.db.execute(select(Usuario.id, Usuario.nome).where(Usuario.id.in_({c.usuario_id for c in linhas}))).all()) if linhas else {}
    return {"url": f"{base(request)}/api/mcp",
            "conexoes": [{"id": c.id, "cliente": c.cliente, "destino": c.destino, "escopo": c.escopo, "criado_em": c.criado_em,
                          "ultimo_uso": c.ultimo_uso, "usuario": nomes.get(c.usuario_id, ""), "minha": c.usuario_id == ctx.usuario.id}
                         for c in linhas]}


@router.delete("/conexoes/{cid}", status_code=204, include_in_schema=False)
def revogar(cid: int, ctx: Ctx):
    cx = ctx.db.get(ConexaoMcp, cid)
    if cx is None or cx.tenant_id != ctx.tenant_id or (cx.usuario_id != ctx.usuario.id and not ctx.usuario.administrador):
        raise HTTPException(404, "Conexão não encontrada.")
    if cx.revogada_em is None:
        cx.revogada_em = agora()
        ctx.auditar("desconectar", "conexao_mcp", cx.id, f"Encerrou a conexão de {cx.cliente} ({cx.destino})")
        ctx.db.commit()
