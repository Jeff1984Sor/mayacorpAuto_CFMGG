"""Um banco por escritório (cliente do MayaJus).

Sem o banco `mayajus_controle` (no mesmo servidor do DATABASE_URL) o sistema roda como sempre: um banco só, a
pasta `storage/`. Quando ele existe, o modo liga sozinho (nada no .env): o banco de controle (app/controle) diz
quais escritórios existem e em qual banco mora cada um; o
escritório do pedido atual fica numa ContextVar e é ela que decide o banco de toda sessão (`SessionLocal`,
`get_db`) e a pasta dos arquivos. Quem define o escritório:

- a API, a cada pedido (main.EscritorioMiddleware): pelo token (claim `cli`) ou pelo domínio do escritório;
- o login, pelo domínio ou pelo catálogo de logins do controle;
- o worker, que percorre os escritórios ativos.

O escritório "principal" (banco = None) usa o `DATABASE_URL` e a pasta `storage/` de antes: é a CFME, que
continua no mesmo banco, sem migrar dados.
"""

import contextvars
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url

from app.core.config import settings


@dataclass(frozen=True)
class Escritorio:
    slug: str
    banco: str | None  # None = o banco principal (DATABASE_URL)
    mayacorp: bool = False  # o admin da MayaCorp (mesmos módulos + o menu MayaCorp)


class EscritorioNaoIdentificado(RuntimeError):
    pass


BANCO_CONTROLE = "mayajus_controle"

_atual: contextvars.ContextVar[Escritorio | None] = contextvars.ContextVar("escritorio", default=None)
_engines: dict[str, Engine] = {}
_trava = threading.Lock()
_url_forcada: str | None = None  # testes apontam para um controle próprio
_multi: bool | None = None


def forcar_controle(url: str | None) -> None:
    """Testes: usa este banco de controle (None = volta a detectar)."""
    global _url_forcada, _multi
    _url_forcada, _multi = url, None


def url_controle() -> str:
    return _url_forcada or url_do_banco(BANCO_CONTROLE)


def _controle_existe() -> bool:
    from sqlalchemy import text

    from app.core.db import engine

    url = make_url(url_do_banco(BANCO_CONTROLE))
    if url.get_backend_name() == "sqlite":
        return Path(url.database or "").exists()
    with engine.connect() as conn:  # se o servidor estiver fora, falha alto (não liga o modo errado)
        return bool(conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": BANCO_CONTROLE}))


def multi() -> bool:
    """Um banco por escritório? Liga sozinho quando o banco de controle existe (decidido uma vez por processo)."""
    global _multi
    if _multi is None:
        _multi = _url_forcada is not None or _controle_existe()
    return _multi


def atual() -> Escritorio | None:
    return _atual.get()


def definir(esc: Escritorio | None) -> contextvars.Token:
    return _atual.set(esc)


@contextmanager
def usando(esc: Escritorio | None) -> Iterator[None]:
    token = _atual.set(esc)
    try:
        yield
    finally:
        _atual.reset(token)


def url_do_banco(banco: str) -> str:
    """Mesmo servidor e credenciais do DATABASE_URL, outro banco (no SQLite, outro arquivo ao lado)."""
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite":
        return str(url.set(database=str(Path(url.database or "data/dev.db").with_name(f"{banco}.db"))))
    return url.set(database=banco).render_as_string(hide_password=False)


def engine_do(banco: str | None) -> Engine:
    from app.core.db import engine

    if banco is None:
        return engine
    with _trava:
        if banco not in _engines:
            url = url_do_banco(banco)
            if url.startswith("sqlite"):
                _engines[banco] = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
            else:  # servidor compartilhado: poucas conexões por escritório
                _engines[banco] = create_engine(url, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_recycle=1800)
        return _engines[banco]


def engine_atual() -> Engine:
    esc = atual()
    if esc is None:
        if multi():
            raise EscritorioNaoIdentificado("Escritório não identificado para este acesso.")
        return engine_do(None)
    return engine_do(esc.banco)


def pasta_base() -> Path:
    """Raiz dos arquivos do escritório atual (o principal continua em storage/, os demais em storage/clientes/<slug>)."""
    esc = atual()
    if esc is None or esc.banco is None:
        return Path(settings.storage_dir)
    return Path(settings.storage_dir) / "clientes" / esc.slug


def com_escritorio(fn: Callable) -> Callable:
    """Leva o escritório atual para outra thread (ThreadPoolExecutor não copia a ContextVar)."""
    ctx = contextvars.copy_context()
    return lambda *a, **kw: ctx.run(fn, *a, **kw)
