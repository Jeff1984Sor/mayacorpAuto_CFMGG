"""Endpoint MCP (Streamable HTTP, sem sessão): JSON-RPC por POST em /api/mcp, uma resposta JSON por pedido."""

import logging
from datetime import timedelta

import anyio
import jwt
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.core.db import SessionLocal, agora
from app.core.deps import ip_cliente
from app.core.models import Identidade, Usuario
from app.core.security import criar_token
from app.modules.mcp import ferramentas, oauth

log = logging.getLogger(__name__)
router = APIRouter(tags=["Claude (MCP)"])

VERSOES = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")


def _autenticar(token: str, ip: str | None) -> tuple[ferramentas.Sessao, str] | None:
    try:
        payload = oauth.ler(token, "mcp")
        with SessionLocal() as db:
            cx = oauth.conexao_valida(db, payload)
            if cx is None or cx.ativada_em is None:
                return None
            u = db.get(Usuario, cx.usuario_id)
            if u is None:
                return None
            agora_ = agora()
            if cx.ultimo_uso is None or agora_ - cx.ultimo_uso > timedelta(minutes=1):
                cx.ultimo_uso = agora_
                db.commit()
            ident = db.get(Identidade, u.tenant_id)
            escritorio = (ident.nome_exibicao if ident else None) or "o escritório"
            sessao = ferramentas.Sessao(usuario_id=u.id, nome=u.nome, escopo=cx.escopo, administrador=u.administrador,
                                        permissoes=set(u.permissoes), token_interno=criar_token(str(u.id), "access"), ip=ip)
            return sessao, escritorio
    except (jwt.PyJWTError, RuntimeError, KeyError, ValueError):
        return None  # token inválido/expirado ou escritório não identificado


def _instrucoes(s: ferramentas.Sessao, escritorio: str) -> str:
    modo = ("Esta conexão pode consultar e alterar dados (ferramenta `alterar`)." if s.escreve else
            "Esta conexão só consulta: não há como alterar dados por aqui.")
    return (
        f"MayaJus é o sistema de gestão do escritório de advocacia ({escritorio}). Você age como {s.nome}, com as permissões dessa "
        f"pessoa. {modo}\n"
        "Como os dados se organizam: Cliente → Contrato → Caso. O caso tem andamentos, tarefas (prazos, audiências), horas "
        "(timesheet), despesas e anexos. As regras de cobrança (fixo, recorrente, por hora) geram itens a faturar → revisão → fatura "
        "(NH de honorários, ND de despesas) → NFS-e, boleto e baixa. O Financeiro tem contas bancárias, contas a pagar, fluxo de "
        "caixa e DRE. Tribunais traz processos e intimações.\n"
        "Como trabalhar: 1) `buscar_rotas` para achar a rota; 2) `detalhar_rota` quando precisar dos filtros ou dos campos; "
        "3) `consultar` para ler; `relatorio` para totais, agrupamentos e séries no tempo (prefira a números somados à mão). "
        "Valores são em reais; datas no formato AAAA-MM-DD. Erro 403 = o perfil do usuário não permite: diga isso, não insista."
    )


def _erro(id_, codigo: int, mensagem: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": codigo, "message": mensagem}}


async def _tratar(request: Request, msg, s: ferramentas.Sessao, escritorio: str) -> dict | None:
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _erro(msg.get("id") if isinstance(msg, dict) else None, -32600, "Pedido inválido.")
    if "id" not in msg:  # notificação (ex.: notifications/initialized): sem resposta
        return None
    id_, metodo, params = msg["id"], msg["method"], msg.get("params") or {}

    def ok(resultado: dict) -> dict:
        return {"jsonrpc": "2.0", "id": id_, "result": resultado}

    if metodo == "initialize":
        pedida = params.get("protocolVersion")
        from app.main import VERSAO

        return ok({"protocolVersion": pedida if pedida in VERSOES else VERSOES[1], "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": "mayajus", "title": "MayaJus", "version": VERSAO}, "instructions": _instrucoes(s, escritorio)})
    if metodo == "ping":
        return ok({})
    if metodo == "tools/list":
        return ok({"tools": ferramentas.listar(s)})
    if metodo == "tools/call":
        nome, args = str(params.get("name") or ""), params.get("arguments") or {}
        if not isinstance(args, dict):
            return _erro(id_, -32602, "`arguments` precisa ser um objeto.")
        try:
            texto = await ferramentas.executar(request.app, s, nome, args)
        except KeyError:
            return _erro(id_, -32602, f"Ferramenta desconhecida: {nome}")
        except ferramentas.Recusa as e:
            return ok({"content": [{"type": "text", "text": str(e)}], "isError": True})
        except Exception:
            log.exception("MCP: falha na ferramenta %s", nome)
            return ok({"content": [{"type": "text", "text": "O MayaJus teve um problema ao atender. Tente de novo."}], "isError": True})
        return ok({"content": [{"type": "text", "text": texto}], "isError": False})
    if metodo in ("resources/list", "prompts/list", "resources/templates/list"):
        return ok({metodo.split("/")[0] if "templates" not in metodo else "resourceTemplates": []})
    return _erro(id_, -32601, f"Método não suportado: {metodo}")


@router.post("/mcp", include_in_schema=False)
async def mcp(request: Request):
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    achado = await anyio.to_thread.run_sync(_autenticar, token, ip_cliente(request)) if token else None
    if achado is None:
        b = oauth.base(request)
        return JSONResponse({"error": "invalid_token", "error_description": "Conecte o MayaJus no Claude para continuar."}, 401, headers={
            "WWW-Authenticate": f'Bearer resource_metadata="{b}/.well-known/oauth-protected-resource/api/mcp", scope="leitura"'})
    s, escritorio = achado
    try:
        corpo = await request.json()
    except ValueError:
        return JSONResponse(_erro(None, -32700, "JSON inválido."), 400)
    if isinstance(corpo, list):
        respostas = [r for m in corpo[:50] if (r := await _tratar(request, m, s, escritorio)) is not None]
        return JSONResponse(respostas) if respostas else Response(status_code=202)
    resposta = await _tratar(request, corpo, s, escritorio)
    return JSONResponse(resposta) if resposta is not None else Response(status_code=202)


@router.api_route("/mcp", methods=["GET", "DELETE"], include_in_schema=False)
def sem_stream():
    """Sem sessão e sem stream iniciado pelo servidor: só POST."""
    return Response(status_code=405, headers={"Allow": "POST"})
