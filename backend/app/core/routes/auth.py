import re
from datetime import timedelta
from pathlib import Path
from typing import Any

import jwt
from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, select

from app.core import audit, tenancy
from app.core import email as mail
from app.core.config import settings
from app.core.db import agora
from app.core.deps import DB, Admin, Ctx, ip_cliente
from app.core.escritorio_http import definir_pelo_token
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


def _escritorio_do_login(ident: str) -> bool:
    """Um banco por escritório: pelo domínio (já identificado no pedido) ou pelo catálogo de logins."""
    if not tenancy.multi() or tenancy.atual() is not None:
        return True
    from app.controle import service as controle

    esc = controle.por_login(ident)
    if esc is None:
        return False
    tenancy.definir(esc)
    return True


def foto_url(u: Usuario) -> str | None:
    if not u.foto_path or not Path(u.foto_path).exists():
        return None
    return f"/auth/usuarios/{u.id}/foto?v={int(Path(u.foto_path).stat().st_mtime)}"


def me_out(u: Usuario) -> UsuarioMe:
    return UsuarioMe.model_validate(u).model_copy(update={
        "foto_url": foto_url(u), "administrador": u.administrador, "permissoes": sorted(u.permissoes),
        "perfil_acesso_nome": u.perfil_acesso.nome if u.perfil_acesso else None,
        "painel_mayacorp": bool(u.administrador and (esc := tenancy.atual()) and esc.mayacorp),
        "endereco_painel": _endereco_painel()})


def _endereco_painel() -> str | None:
    esc = tenancy.atual()
    if not (esc and esc.mayacorp):
        return None
    from app.controle import service

    return service.endereco_do_painel()


def _tokens(u: Usuario) -> TokenOut:
    return TokenOut(
        access_token=criar_token(str(u.id), "access", {"tid": u.tenant_id, "perfil": u.perfil.value}),
        refresh_token=criar_token(str(u.id), "refresh"),
        usuario=me_out(u),
    )


@router.post("/login", response_model=TokenOut)
def login(dados: LoginIn, request: Request, db: DB):
    ident = dados.email.strip().lower()
    if not _escritorio_do_login(ident):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos.")
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
        if (esc := tenancy.atual()) is not None and esc.mayacorp:  # quem errou o endereço: o admin é só da MayaCorp
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha incorretos. Este endereço é só do admin "
                                f"da MayaCorp; os escritórios entram por {settings.frontend_url}")
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
    if tenancy.multi() and definir_pelo_token(dados.refresh_token) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    u = db.get(Usuario, int(payload["sub"]))
    if not u or not u.ativo or not u.acesso_sistema:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário inativo.")
    return _tokens(u)


@router.post("/forgot", response_model=Mensagem)
def forgot(dados: ForgotIn, db: DB):
    if not _escritorio_do_login(dados.email):
        return Mensagem(mensagem="Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha.")
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
    if tenancy.multi() and definir_pelo_token(dados.token) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link inválido ou expirado.")
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
    pasta = tenancy.pasta_base() / "usuarios"
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


# ---------------------------------------------------------------- primeiro acesso (escritório novo)
class PrimeiroAcessoIn(BaseModel):
    token: str
    nome: str = Field(min_length=3, max_length=150)
    email: EmailStr
    login: str | None = Field(default=None, max_length=60)
    senha: str


def _escritorio_sem_master(token: str, db) -> dict[str, Any]:
    """O link de boas-vindas vale enquanto o escritório não tem o usuário master (além do Suporte da MayaCorp)."""
    try:
        payload = decodificar_token(token, "primeiro")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link inválido ou expirado. Peça um novo à MayaCorp.") from None
    if tenancy.multi() and definir_pelo_token(token) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link inválido ou expirado. Peça um novo à MayaCorp.")
    if db.scalar(select(Usuario.id).where(Usuario.equipe_mayacorp.is_(False), Usuario.senha_hash.is_not(None))):
        raise HTTPException(status.HTTP_409_CONFLICT, "O usuário master deste escritório já foi criado. Entre com ele.")
    return payload


@router.get("/primeiro-acesso")
def ler_primeiro_acesso(token: str, db: DB):
    from app.core.models import Identidade

    payload = _escritorio_sem_master(token, db)
    ident = db.scalar(select(Identidade).limit(1))
    return {"escritorio": ident.nome_exibicao if ident else "", "email": payload.get("email")}


@router.post("/primeiro-acesso", response_model=TokenOut)
def primeiro_acesso(dados: PrimeiroAcessoIn, request: Request, db: DB):
    from app.core import perfis
    from app.core.models import Perfil, Tenant
    from app.core.security import hash_senha

    _escritorio_sem_master(dados.token, db)
    if erro := validar_politica_senha(dados.senha):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, erro)
    email = str(dados.email).lower()
    login = (dados.login or "").strip().lower() or None
    if login and not re.match(r"^[a-z0-9._-]{3,60}$", login):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Login: letras, números, ponto, hífen ou sublinhado (3 a 60).")
    if tenancy.multi():
        from app.controle import service as controle

        esc = tenancy.atual()
        if controle.chaves_em_uso([k for k in (email, login) if k], exceto_slug=esc.slug if esc else None):
            raise HTTPException(status.HTTP_409_CONFLICT, "Este e-mail ou login já é usado no MayaJus. Escolha outro.")
    ja = [Usuario.email == email] + ([Usuario.login == login] if login else [])
    if db.scalar(select(Usuario.id).where(or_(*ja))):
        raise HTTPException(status.HTTP_409_CONFLICT, "Este e-mail ou login já existe neste escritório.")
    tenant = db.scalar(select(Tenant).order_by(Tenant.id))
    padrao = perfis.garantir_padrao(db, tenant.id)
    u = Usuario(tenant_id=tenant.id, nome=dados.nome.strip(), email=email, login=login, perfil=Perfil.admin,
                senha_hash=hash_senha(dados.senha), convite_pendente=False, ultimo_acesso=agora())
    perfis.aplicar(u, padrao["Administrador"])
    db.add(u)
    db.flush()
    audit.registrar(db, tenant_id=u.tenant_id, usuario=u, acao="auth.primeiro_acesso", entidade="usuario",
                    entidade_id=u.id, ip=ip_cliente(request), descricao="usuário master criado pelo link de boas-vindas")
    db.commit()
    return _tokens(u)


class PedirPrimeiroAcessoIn(BaseModel):
    email: EmailStr


@router.post("/primeiro-acesso/pedir", response_model=Mensagem)
def pedir_primeiro_acesso(dados: PedirPrimeiroAcessoIn):
    """Botão "1º acesso" do login: o e-mail do financeiro do escritório recebe o link para criar o usuário master.
    A resposta é sempre a mesma (não revela quais e-mails são clientes)."""
    resposta = Mensagem(mensagem="Se este e-mail for o do financeiro de um escritório que ainda não criou o acesso, "
                                 "enviamos agora o link para criar a sua senha. Confira a caixa de entrada e o spam.")
    if not tenancy.multi():
        return resposta
    from app.controle import service as controle
    from app.controle.models import Cliente, SessaoControle
    from app.core.db import SessionLocal

    email = str(dados.email).lower()
    with SessaoControle() as ctl:
        clientes = ctl.scalars(select(Cliente).where(Cliente.tipo == "escritorio", Cliente.banco.is_not(None),
                                                     Cliente.status.in_(("teste", "ativo", "suspenso")),
                                                     Cliente.email_financeiro.ilike(email))).all()
        alvos = [(c.slug, c.banco, c.nome, c.responsavel or "") for c in clientes]
    for slug, banco, nome, pessoa in alvos:
        with tenancy.usando(tenancy.Escritorio(slug=slug, banco=banco)), SessionLocal() as db:
            if db.scalar(select(Usuario.id).where(Usuario.equipe_mayacorp.is_(False), Usuario.senha_hash.is_not(None))):
                continue  # já tem usuário master: o caminho é "Esqueci minha senha"
        link = controle.link_primeiro_acesso(slug, email)
        ola = f"Olá, {pessoa.split()[0]}!" if pessoa.strip() else "Olá!"
        controle.enviar_email([email], f"Seu primeiro acesso ao MayaJus — {nome}",
                              f"{ola}\n\nPara criar o usuário master do {nome} e a sua senha, acesse:\n{link}\n\n"
                              "O link vale por 7 dias.\n\nEquipe MayaCorp")
    return resposta
