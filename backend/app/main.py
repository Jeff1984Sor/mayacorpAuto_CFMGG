import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import app.controle.sincronia  # noqa: F401  (catálogo de logins do controle)
from app.comunicador import routes as comunicador
from app.controle import routes_admin as admin_mayacorp
from app.core import cnpj, tenancy
from app.core.config import BASE_DIR, settings
from app.core.escritorio_http import EscritorioMiddleware
from app.core.routes import auditoria, auth, config, hub, ia, public
from app.core.tenancy import EscritorioNaoIdentificado
from app.modules.assistente import routes as assistente_routes
from app.modules.faturamento import judiciario as faturamento_judiciario
from app.modules.faturamento import planilhas as faturamento_planilhas
from app.modules.faturamento import routes as faturamento_routes
from app.modules.faturamento import routes_revisao
from app.modules.faturamento import tarefas as faturamento_tarefas
from app.modules.faturamento import timesheet as faturamento_timesheet
from app.modules.financas import routes as financas_routes
from app.modules.rpa_nfse import routes as nfse_routes
from app.modules.rpa_nfse import routes_dashboard, routes_faturas, routes_financeiro, tasks
from app.modules.tribunais import routes as tribunais_routes
from app.modules.tribunais import routes_config as tribunais_config
from app.modules.tribunais import routes_protocolo as tribunais_protocolo

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)  # o httpx loga a URL completa de cada chamada

VERSAO = (BASE_DIR / "VERSION").read_text().strip() if (BASE_DIR / "VERSION").exists() else "dev"


def migrar() -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "alembic"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


def _escritorios_para_retomar() -> list:
    if not tenancy.multi():
        return [None]
    from app.controle import service as controle

    return controle.ativos()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    if settings.migrar_na_subida:
        migrar()
        if tenancy.multi():
            from app.controle import service as controle

            controle.migrar_todos()
    if settings.worker_embutido:
        for esc in _escritorios_para_retomar():
            with tenancy.usando(esc):
                tasks.retomar_pendentes()
    # carteiro do Comunicador: entrega ao vivo as mensagens gravadas (inclusive as do robô, que vêm do worker)
    parar = asyncio.Event()
    carteiro = asyncio.create_task(comunicador.carteiro(parar))
    yield
    parar.set()
    with contextlib.suppress(asyncio.CancelledError, TimeoutError):
        await asyncio.wait_for(carteiro, timeout=3)


app = FastAPI(
    title="MayaJus — API",
    version=VERSAO,
    description="Hub de automações MayaCorp. RPA 01: Emissor de NFS-e em lote, layout 2 (ISS + IBS + CBS).",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(EscritorioMiddleware)  # um banco por escritório (sem CONTROLE_DATABASE_URL, não faz nada)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


def _traduzir(e: dict) -> str:
    ctx = e.get("ctx") or {}
    tipo = e.get("type", "")
    if tipo == "missing":
        return "campo obrigatório"
    if tipo == "string_too_short":
        return f"precisa ter pelo menos {ctx.get('min_length')} caracteres"
    if tipo == "string_too_long":
        return f"pode ter no máximo {ctx.get('max_length')} caracteres"
    if tipo == "string_pattern_mismatch":
        return "formato inválido"
    if tipo == "value_error" and "email" in e.get("msg", "").lower():
        return "e-mail inválido"
    if tipo.startswith(("int_", "decimal_", "float_")):
        return "número inválido"
    if tipo.startswith("date"):
        return "data inválida"
    return e.get("msg", "valor inválido")


@app.exception_handler(EscritorioNaoIdentificado)
async def _sem_escritorio(_: Request, exc: EscritorioNaoIdentificado):
    return JSONResponse(status_code=401, content={"detail": "Sessão expirada. Entre novamente."})


@app.exception_handler(RequestValidationError)
async def _validacao(_: Request, exc: RequestValidationError):
    """422 em português claro: primeiro problema no `detail`, lista completa em `erros`."""
    erros = []
    for e in exc.errors():
        campo = ".".join(str(p) for p in e["loc"] if p not in ("body", "query", "path"))
        erros.append({"campo": campo, "mensagem": _traduzir(e)})
    primeiro = erros[0] if erros else {"campo": "", "mensagem": "Dados inválidos."}
    return JSONResponse(status_code=422, content={"detail": f"{primeiro['campo']}: {primeiro['mensagem']}".strip(": "), "erros": erros})


for r in (auth.router, public.router, hub.router, config.router, nfse_routes.config_router, routes_financeiro.config_router,
          nfse_routes.router, routes_financeiro.router, routes_faturas.router, routes_dashboard.router, ia.router, cnpj.router, comunicador.router, comunicador.ws_router,
          auditoria.router, assistente_routes.router, faturamento_judiciario.router, faturamento_planilhas.router, faturamento_tarefas.router, faturamento_timesheet.router, faturamento_routes.router, routes_revisao.router, financas_routes.router,
          tribunais_routes.router, tribunais_protocolo.router, tribunais_config.router, tribunais_config.publico,
          admin_mayacorp.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["infra"])
def health():
    return {"ok": True, "versao": VERSAO, "ambiente": settings.ambiente}
