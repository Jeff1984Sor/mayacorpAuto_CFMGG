"""Regras do banco de controle: achar o escritório (por domínio ou login), o catálogo de logins e a criação
do banco de um escritório novo. Usado pela API, pelo worker, pelo deploy e (em breve) pelo admin MayaCorp.
"""

import re
import time
from datetime import date, timedelta
from pathlib import Path

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
    """O cliente como escritório (com banco). Cliente sem acesso ao sistema (tipo "externo") nunca é escritório:
    é por aqui que passam o login, o domínio, o token, o worker e a migração, então ele fica fora de todos."""
    if c is None or c.tipo == "externo" or c.status not in ATIVOS:
        return None
    return Escritorio(slug=c.slug, banco=c.banco, mayacorp=c.tipo == "mayacorp")


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


def robos_do(slug: str) -> list[str]:
    """Robôs liberados para o escritório (cache curto, como o resto do catálogo)."""
    agora = time.monotonic()
    hit = _cache.get(("robos", slug))
    if hit and agora - hit[0] < _TTL:
        return hit[1]
    with SessaoControle() as db:
        valor = list(db.scalar(select(Cliente.robos).where(Cliente.slug == slug)) or [])
    _cache[("robos", slug)] = (agora, valor)
    return valor


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
    if esc is None:  # inativo ou sem acesso ao sistema: não há banco para ler
        raise RegraControle(f"{slug} não é um escritório com acesso ao sistema.")
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
        # banco vazio só quer dizer "banco principal" em quem tem acesso ao sistema; no externo é "não tem banco"
        if banco is None and tipo != "externo" and db.scalar(select(Cliente).where(Cliente.banco.is_(None),
                                                                                   Cliente.tipo != "externo")):
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


def registrar_externo(nome: str, **ficha) -> Cliente:
    """Cliente da MayaCorp sem acesso ao sistema: só a ficha (para contratos, cobranças e nota). Nada de banco,
    usuário, domínio, plano ou teste."""
    with SessaoControle() as db:
        usados = set(db.scalars(select(Cliente.slug)))
    base = slug_de(nome)
    slug, n = base, 1
    while slug in usados:
        n += 1
        slug = f"{base[:36]}-{n}"
    return registrar(slug, nome, banco=None, tipo="externo", status="ativo", **ficha)


def slug_de(nome: str) -> str:
    import unicodedata

    base = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:30] or "escritorio"
    return base if base[0].isalpha() else f"e-{base}"


def adicionar_dominio(db, cliente: Cliente, host: str) -> Dominio:
    if cliente.tipo == "externo":
        raise RegraControle("Cliente sem acesso ao sistema não tem domínio.")
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
    from sqlalchemy.exc import ProgrammingError

    adm = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with adm.connect() as conn:
            if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": banco}):
                conn.execute(text(f'CREATE DATABASE "{banco}"'))
    except ProgrammingError as e:
        if "permission denied" in str(e).lower():
            raise RegraControle(f"O servidor do banco não deixa o MayaJus criar bancos. Peça ao suporte para rodar: "
                                f"ALTER ROLE {url.username} CREATEDB;") from e
        raise
    finally:
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


def provisionar(slug: str, nome: str, *, admin_email: str, admin_nome: str = "", dias_teste: int | None = None,
                dominios: list[str] | None = None, tipo: str = "escritorio", admin_login: str | None = None,
                admin_senha: str | None = None, primeiro_acesso: bool = False, **ficha) -> tuple[Cliente, str]:
    """Escritório novo: banco próprio, tabelas, identidade, o usuário Suporte e o administrador. Com primeiro_acesso,
    o link é o de boas-vindas: o próprio cliente cria o usuário master (admin_email só recebe o e-mail)."""
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
    if not SLUG.match(slug):
        raise RegraControle("Identificador: letras minúsculas, números e hífen (2 a 39), começando com letra.")
    with SessaoControle() as db:
        if db.scalar(select(Cliente.id).where(Cliente.slug == slug)):
            raise RegraControle(f"Já existe o escritório {slug}.")
    banco = nome_do_banco(slug)
    criar_banco(banco)  # antes de registrar: sem banco, o escritório não pode existir no controle
    cliente = registrar(slug, nome, banco=banco, dias_teste=dias_teste, dominios=dominios, tipo=tipo, **ficha)
    esc = Escritorio(slug=slug, banco=banco, mayacorp=tipo == "mayacorp")
    try:
        uid, sid, link = _montar_ambiente(esc, nome, admin_nome=admin_nome, email=email, login=login,
                                          admin_senha=admin_senha, primeiro_acesso=primeiro_acesso)
    except Exception:
        with SessaoControle() as db:  # não deixa escritório pela metade no controle (o banco vazio pode ser reaproveitado)
            db.delete(db.get(Cliente, cliente.id))
            db.commit()
        limpar_cache()
        raise
    _catalogar(slug, uid, sid, email, login)
    return cliente, link


def _montar_ambiente(esc: Escritorio, nome: str, *, admin_nome: str, email: str, login: str | None,
                     admin_senha: str | None, primeiro_acesso: bool) -> tuple[int | None, int | None, str]:
    """Tabelas, identidade, listas padrão, usuário Suporte e o primeiro acesso no banco (já criado) do escritório."""
    from app.core.db import SessionLocal
    from app.core.models import Identidade, Tenant

    slug = esc.slug
    migrar(esc)
    with tenancy.usando(esc), SessionLocal() as db:
        t = Tenant(slug=slug, nome=nome)
        db.add(t)
        db.flush()
        db.add(Identidade(tenant_id=t.id, nome_exibicao=nome))
        from app.modules.faturamento import seeds_caso

        seeds_caso.garantir(db, t.id)  # listas, áreas e papéis das partes padrão
        suporte = _usuario_suporte(db, t.id, slug) if not esc.mayacorp else None
        if primeiro_acesso:  # o próprio cliente cria o usuário master pelo link de boas-vindas
            db.commit()
            uid, link = None, link_primeiro_acesso(slug, email)
        else:
            admin = _primeiro_admin(db, t.id, admin_nome, email, login, admin_senha)
            db.commit()
            uid = admin.id
            link = "" if admin_senha else _convite(admin)
        return uid, suporte.id if suporte else None, link


def _catalogar(slug: str, uid: int | None, sid: int | None, email: str, login: str | None) -> None:
    if uid:
        sincronizar_usuario(slug, uid, [email, login])
    if sid:
        sincronizar_usuario(slug, sid, [f"suporte+{slug}@mayacorp.com.br", f"suporte.{slug}"])


def dar_acesso(cliente_id: int, *, admin_email: str | None, dias_teste: int | None = None,
               dominios: list[str] | None = None, **ficha) -> tuple[Cliente, str | None]:
    """Cliente sem acesso vira escritório do MayaJus. Quem nunca teve banco ganha o ambiente pelo mesmo caminho do
    cadastro normal (o link devolvido é o de boas-vindas); quem já teve (perdeu o acesso e ficou só na cobrança)
    volta para o banco de antes, com os usuários e os dados como estavam (link None)."""
    with SessaoControle() as db:
        c = db.get(Cliente, cliente_id)
        if c is None or c.tipo != "externo":
            raise RegraControle("Este cliente já tem acesso ao sistema.")
        slug, nome, banco_antigo = c.slug, c.nome, c.banco
        email = (admin_email or "").strip().lower()
        if banco_antigo is None:
            if not email:
                raise RegraControle("Informe o e-mail que recebe as boas-vindas.")
            if db.get(Login, email):
                raise RegraControle(f"{email} já é usado em outro escritório (o login precisa ser único no MayaJus).")
    banco = banco_antigo or nome_do_banco(slug)
    if banco_antigo is None:
        criar_banco(banco)  # antes de mudar o cadastro: sem banco, o cliente continua só na cobrança
    with SessaoControle() as db:
        c = db.get(Cliente, cliente_id)
        antes = {"status": c.status, "teste_ate": c.teste_ate, "plano_id": c.plano_id, "ciclo": c.ciclo,
                 "inicio_contrato": c.inicio_contrato}
        c.tipo, c.banco = "escritorio", banco
        c.status = "teste" if dias_teste else "ativo"
        c.teste_ate = date.today() + timedelta(days=dias_teste) if dias_teste else None
        for k, v in ficha.items():
            setattr(c, k, v)
        try:
            novos = [adicionar_dominio(db, c, h) for h in dominios or []]
            db.flush()
            ids_dominios = [d.id for d in novos]
            db.commit()
        except Exception:
            db.rollback()
            raise
    limpar_cache()
    if banco_antigo is not None:
        with SessaoControle() as db:
            return db.get(Cliente, cliente_id), None
    try:
        uid, sid, link = _montar_ambiente(Escritorio(slug=slug, banco=banco), nome, admin_nome="", email=email, login=None,
                                          admin_senha=None, primeiro_acesso=True)
    except Exception:
        with SessaoControle() as db:  # volta a ser só cobrança (o banco vazio pode ser reaproveitado)
            c = db.get(Cliente, cliente_id)
            c.tipo, c.banco = "externo", None
            for k, v in antes.items():
                setattr(c, k, v)
            for d in list(c.dominios):
                if d.id in ids_dominios:
                    db.delete(d)
            db.commit()
        limpar_cache()
        raise
    _catalogar(slug, uid, sid, email, None)
    with SessaoControle() as db:
        return db.get(Cliente, cliente_id), link


def tirar_acesso(cliente_id: int) -> Cliente:
    """Escritório vira cliente só de cobrança: ninguém mais entra e a mensalidade do plano para. Nada é apagado
    (banco, usuários, domínios e o plano ficam guardados para o caso de o acesso voltar)."""
    with SessaoControle() as db:
        c = db.get(Cliente, cliente_id)
        if c is None or c.tipo != "escritorio":
            raise RegraControle("Este cliente não tem acesso ao sistema.")
        if c.banco is None:
            raise RegraControle("O escritório do banco principal não pode ficar sem acesso ao sistema.")
        c.tipo = "externo"
        c.status = "inativo" if c.status == "inativo" else "ativo"  # ativo aqui = continua sendo cobrado
        c.teste_ate = None
        c.forma_pagamento = "link"
        db.commit()
        limpar_cache()
        return c


def _usuario_suporte(db, tenant_id: int, slug: str):
    """Usuário "Suporte" da MayaCorp em todo escritório novo (não conta no limite de usuários do plano). A senha é a
    definida no admin (Planos e indicação › Usuário Suporte); sem ela, o usuário nasce sem senha (use "Zerar senha")."""
    from app.controle import indicacao
    from app.core import perfis
    from app.core.models import Perfil, Usuario

    with SessaoControle() as ctl:
        senha_hash = indicacao.politica(ctl).senha_suporte_hash
        ctl.commit()
    padrao = perfis.garantir_padrao(db, tenant_id)
    u = Usuario(tenant_id=tenant_id, nome="Suporte", email=f"suporte+{slug}@mayacorp.com.br", login=f"suporte.{slug}",
                perfil=Perfil.admin, senha_hash=senha_hash, convite_pendente=senha_hash is None, equipe_mayacorp=True)
    perfis.aplicar(u, padrao["Administrador"])
    db.add(u)
    db.flush()
    return u


def link_primeiro_acesso(slug: str, email: str) -> str:
    from app.core.config import settings
    from app.core.security import criar_token

    with tenancy.usando(Escritorio(slug=slug, banco=nome_do_banco(slug))):
        token = criar_token(slug, "primeiro", {"email": email})
    return f"{settings.frontend_url}/primeiro-acesso?token={token}"


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
        if db.scalar(select(Cliente.id).where(Cliente.banco.is_(None), Cliente.tipo != "externo")):
            return None
    with Session(tenancy.engine_do(None)) as db:
        t = db.scalar(select(Tenant).order_by(Tenant.id))
        if t is None:
            return None
        slug, nome = t.slug, t.nome
    registrar(slug, nome, banco=None, robos=list(planos_robos()))  # o principal (CFME) já usa os robôs dele
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
    espelhar_todos_no_cadastro()
    return feitos


def espelhar_todos_no_cadastro() -> int:
    """Liga cada cliente ao cadastro completo dele no banco do admin (Cadastros › Clientes), criando o que faltar.
    Roda no migrar de todo deploy; as regras estão em app/controle/cadastro.py."""
    from app.controle import cadastro

    return cadastro.ligar_todos()


def endereco_do_painel() -> str | None:
    """Domínio do admin MayaCorp (o 1º cadastrado): o admin só abre nele, nunca dentro do endereço do MayaJus."""
    with SessaoControle() as db:
        return db.scalar(select(Dominio.host).join(Cliente).where(Cliente.tipo == "mayacorp").order_by(Dominio.id))


def escritorio_mayacorp() -> Escritorio | None:
    with SessaoControle() as db:
        c = db.scalar(select(Cliente).where(Cliente.tipo == "mayacorp"))
        return Escritorio(slug=c.slug, banco=c.banco, mayacorp=True) if c else None


def enviar_email(para: list[str], assunto: str, corpo: str, anexos: list[tuple[str, bytes, str]] | None = None,
                 marca: str = "MayaJus") -> None:
    """E-mails da MayaCorp aos clientes (convites, contratos, cobranças) saem pelo SMTP configurado no admin
    (Configurações › Notificações e e-mail), no modelo HTML com a marca; sem SMTP no admin, pelo do servidor."""
    import mimetypes
    from pathlib import Path

    from app.controle.email_modelo import corpo_html
    from app.core import email as mail
    from app.core.db import SessionLocal
    from app.core.models import ConfigNotificacao, Identidade

    esc = escritorio_mayacorp()
    if esc is None:
        mail.enviar(para, assunto, corpo, anexos=anexos, html=corpo_html(corpo, titulo=assunto, marca=marca))
        return
    with tenancy.usando(esc), SessionLocal() as s:
        cfg = s.scalar(select(ConfigNotificacao).limit(1))
        ident = s.scalar(select(Identidade).limit(1))
        imagens = {}
        logo = Path(ident.logo_path) if ident and ident.logo_path else None
        if logo and logo.exists():
            imagens["logo-mayacorp"] = (logo.read_bytes(), mimetypes.guess_type(logo.name)[0] or "image/png")
        html = corpo_html(corpo, titulo=assunto, marca=marca, logo_cid="logo-mayacorp" if imagens else None)
        mail.enviar(para, assunto, corpo, anexos=anexos, config=cfg if cfg and cfg.smtp_host else None, html=html,
                    imagens=imagens)


def planos_robos() -> list[str]:
    from app.controle.planos import ROBOS

    return list(ROBOS)


def excluir_escritorio(slug: str) -> None:
    """Apaga de vez um escritório (cliente de teste ou cadastrado por engano): o banco dele, o registro no controle
    (domínios, logins, contratos, cobranças) e guarda os arquivos em storage/excluidos/. Só inativo, nunca o principal."""
    import shutil
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    from app.core.config import settings

    with SessaoControle() as db:
        c = db.scalar(select(Cliente).where(Cliente.slug == slug))
        if c is None:
            raise RegraControle("Escritório não encontrado.")
        if c.tipo == "mayacorp" or (c.banco is None and c.tipo != "externo"):
            raise RegraControle("O escritório principal e o admin da MayaCorp não podem ser excluídos.")
        if c.status != "inativo":
            raise RegraControle("Inative o cliente antes de excluir." if c.tipo == "externo" else
                                "Inative o escritório antes de excluir (ninguém entra enquanto está inativo).")
        banco = c.banco
    if banco is None:  # cliente sem acesso que nunca teve banco: só o registro no controle
        with SessaoControle() as db:
            db.delete(db.scalar(select(Cliente).where(Cliente.slug == slug)))
            db.commit()
        limpar_cache()
        return
    eng = tenancy._engines.pop(banco, None)
    if eng is not None:
        eng.dispose()
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite":
        Path(make_url(tenancy.url_do_banco(banco)).database).unlink(missing_ok=True)
    else:
        if not re.match(r"^[a-z][a-z0-9_]{1,62}$", banco):
            raise RegraControle("Nome de banco inválido.")
        adm = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
        try:
            with adm.connect() as conn:
                conn.execute(text(f'DROP DATABASE IF EXISTS "{banco}" WITH (FORCE)'))
        finally:
            adm.dispose()
    pasta = Path(settings.storage_dir) / "clientes" / slug  # mesma regra de tenancy.pasta_base()
    if pasta.exists():
        destino = pasta.parent.parent / "excluidos" / f"{slug}-{datetime.now():%Y%m%d%H%M%S}"
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(pasta), str(destino))
    with SessaoControle() as db:
        db.delete(db.scalar(select(Cliente).where(Cliente.slug == slug)))
        db.commit()
    limpar_cache()
