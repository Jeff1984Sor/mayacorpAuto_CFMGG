from datetime import timedelta
from pathlib import Path
from typing import Any

import jwt
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.core import audit
from app.core import email as mail
from app.core.config import settings
from app.core.db import agora
from app.core.deps import DB, Admin, Ctx, ip_cliente
from app.core.models import Usuario
from app.core.schemas import ForgotIn, LoginIn, Mensagem, RefreshIn, ResetIn, TokenOut, TrocarSenhaIn, UsuarioMe
from app.core.security import (
    criar_token,
    decodificar_token,
    hash_senha,
    validar_politica_senha,
    verificar_senha,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def foto_url(u: Usuario) -> str | None:
    if not u.foto_path or not Path(u.foto_path).exists():
        return None
    return f"/auth/usuarios/{u.id}/foto?v={int(Path(u.foto_path).stat().st_mtime)}"


def me_out(u: Usuario) -> UsuarioMe:
    return UsuarioMe.model_validate(u).model_copy(update={"foto_url": foto_url(u)})


def _tokens(u: Usuario) -> TokenOut:
    return TokenOut(
        access_token=criar_token(str(u.id), "access", {"tid": u.tenant_id, "perfil": u.perfil.value}),
        refresh_token=criar_token(str(u.id), "refresh"),
        usuario=me_out(u),
    )


@router.post("/login", response_model=TokenOut)
def login(dados: LoginIn, request: Request, db: DB):
    ident = dados.email.strip().lower()
    campo = Usuario.email if "@" in ident else Usuario.login
    u = db.scalar(select(Usuario).where(campo == ident))
    now = agora()
    if u and u.bloqueado_ate and u.bloqueado_ate.replace(tzinfo=now.tzinfo) > now:
        minutos = int((u.bloqueado_ate.replace(tzinfo=now.tzinfo) - now).total_seconds() // 60) + 1
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Muitas tentativas. Tente de novo em {minutos} min.")
    if not u or not u.ativo or not u.acesso_sistema or not u.senha_hash or not verificar_senha(dados.senha, u.senha_hash):
        if u:
            u.tentativas_falhas += 1
            if u.tentativas_falhas >= settings.login_max_tentativas:
                u.bloqueado_ate = now + timedelta(minutes=settings.login_bloqueio_minutos)
                u.tentativas_falhas = 0
                audit.registrar(db, tenant_id=u.tenant_id, usuario=u, acao="auth.bloqueio", entidade="usuario",
                                entidade_id=u.id, descricao="Bloqueio temporário por tentativas", ip=ip_cliente(request))
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
    u.tentativas_falhas = 0
    u.bloqueado_ate = None
    u.ultimo_acesso = now
    u.ultima_atividade = now
    audit.registrar(db, tenant_id=u.tenant_id, usuario=u, acao="auth.login", entidade="usuario", entidade_id=u.id,
                    ip=ip_cliente(request))
    db.commit()
    return _tokens(u)


@router.post("/refresh", response_model=TokenOut)
def refresh(dados: RefreshIn, db: DB):
    try:
        payload = decodificar_token(dados.refresh_token, "refresh")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.") from None
    u = db.get(Usuario, int(payload["sub"]))
    if not u or not u.ativo or not u.acesso_sistema:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inativo.")
    return _tokens(u)


@router.post("/forgot", response_model=Mensagem)
def forgot(dados: ForgotIn, db: DB):
    u = db.scalar(select(Usuario).where(Usuario.email == dados.email.lower(), Usuario.ativo, Usuario.acesso_sistema))
    if u:
        token = criar_token(str(u.id), "reset", {"h": (u.senha_hash or "")[-12:]})
        link = f"{settings.frontend_url}/redefinir-senha?token={token}"
        mail.enviar([u.email], "Redefinição de senha", f"Olá, {u.nome}.\n\nPara criar uma nova senha, acesse:\n{link}\n\n"
                    "O link vale por 2 horas. Se não foi você, ignore este e-mail.")
    # Resposta igual existindo ou não (não revela quem tem conta)
    return Mensagem(mensagem="Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.")


@router.post("/reset", response_model=Mensagem)
def reset(dados: ResetIn, request: Request, db: DB):
    try:
        payload = decodificar_token(dados.token, "reset")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link inválido ou expirado.") from None
    u = db.get(Usuario, int(payload["sub"]))
    # o token embute o final do hash atual: usado uma vez, deixa de valer
    if not u or payload.get("h") != (u.senha_hash or "")[-12:]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link inválido ou já utilizado.")
    if erro := validar_politica_senha(dados.senha):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, erro)
    u.senha_hash = hash_senha(dados.senha)
    u.convite_pendente = False
    u.tentativas_falhas = 0
    u.bloqueado_ate = None
    audit.registrar(db, tenant_id=u.tenant_id, usuario=u, acao="auth.reset", entidade="usuario", entidade_id=u.id,
                    ip=ip_cliente(request))
    db.commit()
    return Mensagem(mensagem="Senha definida. Você já pode entrar.")


@router.post("/trocar-senha", response_model=Mensagem)
def trocar_senha(dados: TrocarSenhaIn, ctx: Ctx):
    u = ctx.usuario
    if not u.senha_hash or not verificar_senha(dados.senha_atual, u.senha_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Senha atual incorreta.")
    if erro := validar_politica_senha(dados.nova_senha):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, erro)
    u.senha_hash = hash_senha(dados.nova_senha)
    ctx.auditar("auth.trocar_senha", "usuario", u.id)
    ctx.db.commit()
    return Mensagem(mensagem="Senha alterada.")


@router.get("/me", response_model=UsuarioMe)
def me(ctx: Ctx):
    return me_out(ctx.usuario)


@router.put("/me/preferencias", response_model=UsuarioMe)
def salvar_preferencias(dados: dict[str, Any], ctx: Ctx):
    """Mescla as preferências enviadas (ex.: {"menu_recolhido": ["Cadastros"]}). Valor null remove a chave."""
    import json

    atual = dict(ctx.usuario.preferencias or {})
    for k, v in dados.items():
        if v is None:
            atual.pop(k, None)
        else:
            atual[str(k)[:60]] = v
    if len(json.dumps(atual)) > 20_000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Preferências grandes demais.")
    ctx.usuario.preferencias = atual
    ctx.db.commit()
    return me_out(ctx.usuario)


async def _salvar_foto(u: Usuario, arquivo: UploadFile) -> None:
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Envie a foto em PNG, JPG ou WEBP.")
    conteudo = await arquivo.read()
    if len(conteudo) > 4 * 1024 * 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A foto deve ter no máximo 4 MB.")
    pasta = Path(settings.storage_dir) / "usuarios"
    pasta.mkdir(parents=True, exist_ok=True)
    for antigo in pasta.glob(f"usuario_{u.id}.*"):
        antigo.unlink()
    destino = pasta / f"usuario_{u.id}{ext}"
    destino.write_bytes(conteudo)
    u.foto_path = str(destino)


def _apagar_foto(u: Usuario) -> None:
    if u.foto_path and Path(u.foto_path).exists():
        Path(u.foto_path).unlink()
    u.foto_path = None


@router.post("/me/foto", response_model=UsuarioMe)
async def enviar_foto(ctx: Ctx, arquivo: UploadFile = File(...)):
    await _salvar_foto(ctx.usuario, arquivo)
    ctx.auditar("usuario.foto", "usuario", ctx.usuario.id, descricao="Nova foto de perfil")
    ctx.db.commit()
    return me_out(ctx.usuario)


@router.delete("/me/foto", response_model=UsuarioMe)
def remover_foto(ctx: Ctx):
    _apagar_foto(ctx.usuario)
    ctx.db.commit()
    return me_out(ctx.usuario)


def _profissional(ctx, uid: int) -> Usuario:
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profissional não encontrado.")
    return u


@router.post("/usuarios/{uid}/foto", response_model=Mensagem)
async def enviar_foto_de(uid: int, ctx: Admin, arquivo: UploadFile = File(...)):
    """O administrador troca a foto de outro profissional (ex.: quem não acessa o sistema)."""
    u = _profissional(ctx, uid)
    await _salvar_foto(u, arquivo)
    ctx.auditar("usuario.foto", "usuario", u.id, descricao=f"Foto de {u.nome} trocada por {ctx.usuario.nome}")
    ctx.db.commit()
    return Mensagem(mensagem=f"Foto de {u.nome} atualizada.")


@router.delete("/usuarios/{uid}/foto", response_model=Mensagem)
def remover_foto_de(uid: int, ctx: Admin):
    u = _profissional(ctx, uid)
    _apagar_foto(u)
    ctx.auditar("usuario.foto", "usuario", u.id, descricao=f"Foto de {u.nome} removida por {ctx.usuario.nome}")
    ctx.db.commit()
    return Mensagem(mensagem="Foto removida.")


@router.get("/usuarios/{uid}/foto")
def foto(uid: int, ctx: Ctx):
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id or not u.foto_path or not Path(u.foto_path).exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sem foto.")
    return FileResponse(u.foto_path, headers={"Cache-Control": "private, max-age=86400"})
