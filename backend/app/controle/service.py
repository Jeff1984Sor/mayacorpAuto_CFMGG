"""Regras do banco de controle: achar o escritório (por domínio ou login), o catálogo de logins e a criação
do banco de um escritório novo. Usado pela API, pelo worker, pelo deploy e (em breve) pelo admin MayaCorp.
"""

import re
import time
from datetime import date, timedelta

from sqlalchemy import select, text

from app.controle.models import Cliente, Dominio, Login, SessaoControle
from app.core import tenancy
from app.core.tenancy import Escritorio

SLUG = re.compile(r"^[a-z][a-z0-9-]{1,38}$")
ATIVOS = ("teste", "ativo", "suspenso")  # suspenso continua entrando (a cobrança só avisa); inativo não entra
_cache: dict[tuple[str, str], tuple[float, Escritorio | None]] = {}
_TTL = 60


class RegraControle(ValueError):
    pass


def _esc(c: Cliente | None) -> Escritorio | None:
    return Escritorio(slug=c.slug, banco=c.banco, mayacorp=c.tipo == "mayacorp") if c and c.status in ATIVOS else None


def _memo(tipo: str, chave: str, buscar) -> Escritorio | None:
    agora = time.monotonic()
    hit = _cache.get((tipo, chave))
    if hit and agora - hit[0] < _TTL:
        return hit[1]
    valor = buscar()
    _cache[(tipo, chave)] = (agora, valor)
    return valor


def limpar_cache() -> None:
    _cache.clear()


def normalizar_host(host: str) -> str:
    return host.split(":")[0].strip().lower().rstrip(".")


def por_slug(slug: str) -> Escritorio | None:
    def buscar():
        with SessaoControle() as db:
            return _esc(db.scalar(select(Cliente).where(Cliente.slug == slug)))
    return _memo("slug", slug, buscar)


def por_host(host: str) -> Escritorio | None:
    host = normalizar_host(host)

    def buscar():
        with SessaoControle() as db:
            d = db.scalar(select(Dominio).where(Dominio.host == host))
            return _esc(d.cliente) if d else None
    return _memo("host", host, buscar) if host else None


def por_login(ident: str) -> Escritorio | None:
    """Sem cache: o login acabou de ser criado ou mudou de dono."""
    with SessaoControle() as db:
        item = db.get(Login, ident.strip().lower())
        return _esc(db.get(Cliente, item.cliente_id)) if item else None


def ativos() -> list[Escritorio]:
    with SessaoControle() as db:
        return [e for c in db.scalars(select(Cliente).order_by(Cliente.id)) if (e := _esc(c))]


# ---------------------------------------------------------------- catálogo de logins
def _cliente_id(db, slug: str) -> int:
    cid = db.scalar(select(Cliente.id).where(Cliente.slug == slug))
    if cid is None:
        raise RegraControle(f"Escritório {slug} não existe no controle.")
    return cid


def chaves_em_uso(chaves: list[str], *, exceto_slug: str, exceto_usuario: int | None = None) -> list[str]:
    """Logins/e-mails já usados em OUTRO escritório (no endereço principal, o login precisa ser único)."""
    chaves = [c.strip().lower() for c in chaves if c]
    with SessaoControle() as db:
        meu = _cliente_id(db, exceto_slug)
        return [x.chave for x in db.scalars(select(Login).where(Login.chave.in_(chaves)))
                if x.cliente_id != meu or (exceto_usuario is not None and x.usuario_id != exceto_usuario)]


def sincronizar_usuario(slug: str, usuario_id: int, chaves: list[str]) -> None:
    """Deixa no catálogo exatamente as chaves (login, e-mail) deste usuário."""
    chaves = {c.strip().lower() for c in chaves if c}
    with SessaoControle() as db:
        cid = _cliente_id(db, slug)
        for x in db.scalars(select(Login).where(Login.cliente_id == cid, Login.usuario_id == usuario_id)):
            if x.chave not in chaves:
                db.delete(x)
        for c in chaves:
            x = db.get(Login, c)
            if x is None:
                db.add(Login(chave=c, cliente_id=cid, usuario_id=usuario_id))
            elif x.cliente_id == cid:
                x.usuario_id = usuario_id
        db.commit()


def sincronizar_todos(slug: str) -> int:
    """Reconstrói o catálogo do escritório a partir dos usuários do banco dele."""
    from app.core.db import SessionLocal
    from app.core.models import Usuario

    esc = por_slug(slug)
    with tenancy.usando(esc), SessionLocal() as db:
        usuarios = [(u.id, [u.login, u.email]) for u in db.scalars(select(Usuario))]
    for uid, chaves in usuarios:
        sincronizar_usuario(slug, uid, chaves)
    return len(usuarios)


# ---------------------------------------------------------------- escritórios
def registrar(slug: str, nome: str, *, banco: str | None, status: str = "ativo", dias_teste: int | None = None,
              dominios: list[str] | None = None, tipo: str = "escritorio", **ficha) -> Cliente:
    if not SLUG.match(slug):
        raise RegraControle("Identificador: letras minúsculas, números e hífen (2 a 39), começando com letra.")
    with SessaoControle() as db:
        if db.scalar(select(Cliente).where(Cliente.slug == slug)):
            raise RegraControle(f"Já existe o escritório {slug}.")
        if banco is None and db.scalar(select(Cliente).where(Cliente.banco.is_(None))):
            raise RegraControle("Já existe um escritório no banco principal.")
        if tipo == "mayacorp" and db.scalar(select(Cliente).where(Cliente.tipo == "mayacorp")):
            raise RegraControle("O admin da MayaCorp já existe.")
        c = Cliente(slug=slug, nome=nome, banco=banco, status="teste" if dias_teste else status, tipo=tipo,
                    teste_ate=date.today() + timedelta(days=dias_teste) if dias_teste else None, **ficha)
        db.add(c)
        db.flush()
        for host in dominios or []:
            adicionar_dominio(db, c, host)
        db.commit()
        limpar_cache()
        return c


def adicionar_dominio(db, cliente: Cliente, host: str) -> Dominio:
    host = normalizar_host(host)
    if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", host):
        raise RegraControle(f"Domínio inválido: {host}")
    if db.scalar(select(Dominio).where(Dominio.host == host)):
        raise RegraControle(f"O domínio {host} já está em uso.")
    d = Dominio(cliente_id=cliente.id, host=host)
    db.add(d)
    limpar_cache()
    return d


def nome_do_banco(slug: str) -> str:
    return "mayajus_" + slug.replace("-", "_")


def criar_banco(banco: str) -> None:
    """CREATE DATABASE no mesmo servidor do principal (no SQLite o arquivo nasce na primeira conexão)."""
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    from app.core.config import settings

    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite":
        return
    if not re.match(r"^[a-z][a-z0-9_]{1,62}$", banco):
        raise RegraControle("Nome de banco inválido.")
    adm = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with adm.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": banco}):
            conn.execute(text(f'CREATE DATABASE "{banco}"'))
    adm.dispose()


def migrar(esc: Escritorio) -> None:
    """Aplica as migrations do sistema no banco do escritório."""
    from alembic.config import Config

    from alembic import command
    from app.core.config import BASE_DIR

    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    with tenancy.engine_do(esc.banco).connect() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
        conn.commit()


def provisionar(slug: str, nome: str, *, admin_nome: str, admin_email: str, dias_teste: int | None = None,
                dominios: list[str] | None = None, tipo: str = "escritorio", admin_login: str | None = None,
                admin_senha: str | None = None, **ficha) -> tuple[Cliente, str]:
    """Escritório novo: banco próprio, tabelas, identidade e o primeiro administrador (recebe o convite)."""
    from app.core.db import SessionLocal
    from app.core.models import Identidade, Tenant

    email = admin_email.strip().lower()
    login = admin_login.strip().lower() if admin_login else None
    if admin_senha:
        from app.core.security import validar_politica_senha

        if erro := validar_politica_senha(admin_senha):
            raise RegraControle(erro)
    with SessaoControle() as db:
        for chave in filter(None, (email, login)):
            if db.get(Login, chave):
                raise RegraControle(f"{chave} já é usado em outro escritório (o login precisa ser único no MayaJus).")
    banco = nome_do_banco(slug)
    cliente = registrar(slug, nome, banco=banco, dias_teste=dias_teste, dominios=dominios, tipo=tipo, **ficha)
    esc = Escritorio(slug=slug, banco=banco, mayacorp=tipo == "mayacorp")
    criar_banco(banco)
    migrar(esc)
    with tenancy.usando(esc), SessionLocal() as db:
        t = Tenant(slug=slug, nome=nome)
        db.add(t)
        db.flush()
        db.add(Identidade(tenant_id=t.id, nome_exibicao=nome))
        admin = _primeiro_admin(db, t.id, admin_nome, email, login, admin_senha)
        db.commit()
        uid = admin.id
        link = "" if admin_senha else _convite(admin)
    sincronizar_usuario(slug, uid, [email, login])
    return cliente, link


def _primeiro_admin(db, tenant_id: int, nome: str, email: str, login: str | None = None, senha: str | None = None):
    from app.core import perfis
    from app.core.models import Perfil, Usuario
    from app.core.security import hash_senha

    padrao = perfis.garantir_padrao(db, tenant_id)
    u = Usuario(tenant_id=tenant_id, nome=nome, email=email, login=login, perfil=Perfil.admin,
                senha_hash=hash_senha(senha) if senha else None, convite_pendente=not senha)
    perfis.aplicar(u, padrao["Administrador"])
    db.add(u)
    db.flush()
    return u


def _convite(u) -> str:
    from app.core.config import settings
    from app.core.security import criar_token

    return f"{settings.frontend_url}/redefinir-senha?token={criar_token(str(u.id), 'reset', {'h': ''})}"


def migrar_controle() -> None:
    from alembic.config import Config

    from alembic import command
    from app.core.config import BASE_DIR

    cfg = Config(str(BASE_DIR / "alembic_controle.ini"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    from app.controle import planos

    with SessaoControle() as db:
        planos.garantir_padrao(db)


def registrar_principal_se_faltar() -> str | None:
    """Primeira ativação: o escritório que já mora no banco principal (a CFME) entra no controle com os logins,
    antes de a API reiniciar no modo novo — ninguém fica sem acesso."""
    from sqlalchemy.orm import Session

    from app.core.models import Tenant

    with SessaoControle() as db:
        if db.scalar(select(Cliente.id).where(Cliente.banco.is_(None))):
            return None
    with Session(tenancy.engine_do(None)) as db:
        t = db.scalar(select(Tenant).order_by(Tenant.id))
        if t is None:
            return None
        slug, nome = t.slug, t.nome
    registrar(slug, nome, banco=None)
    sincronizar_todos(slug)
    return slug


def migrar_todos() -> list[str]:
    """Controle + o banco de cada escritório (o principal é migrado pelo deploy de sempre)."""
    migrar_controle()
    registrar_principal_se_faltar()
    feitos = []
    for esc in ativos():
        if esc.banco is not None:
            migrar(esc)
            feitos.append(esc.slug)
    return feitos
