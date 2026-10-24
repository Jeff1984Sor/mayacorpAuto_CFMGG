"""Comunicador: REST (histórico, conversas, menções) + WebSocket (presença, digitando, entrega ao vivo)."""

import asyncio
import contextlib
import logging
from datetime import datetime

import jwt
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.comunicador import service
from app.comunicador.hub import hub
from app.comunicador.models import Conversa, Mencao, Mensagem, Participante
from app.core.db import SessionLocal, agora
from app.core.deps import Ctx
from app.core.models import Usuario
from app.core.security import decodificar_token

log = logging.getLogger(__name__)
router = APIRouter(prefix="/comunicador", tags=["comunicador"])
ws_router = APIRouter()


# ======================================================================== serialização
def _nome(db, uid: int | None, cache: dict) -> str:
    if uid is None:
        return service.ROBO["nome"]
    if uid not in cache:
        u = db.get(Usuario, uid)
        cache[uid] = u.nome if u else "?"
    return cache[uid]


def msg_out(db, m: Mensagem, cache: dict | None = None) -> dict:
    cache = cache if cache is not None else {}
    resposta = None
    if m.resposta_a_id and (r := db.get(Mensagem, m.resposta_a_id)):
        resposta = {"id": r.id, "autor_nome": _nome(db, r.autor_id, cache),
                    "texto": service.texto_simples(r.texto)[:140] if not r.apagada_em else "Mensagem apagada"}
    return {
        "id": m.id, "conversa_id": m.conversa_id, "autor_id": m.autor_id, "autor_nome": _nome(db, m.autor_id, cache),
        "robo": m.autor_id is None, "texto": "" if m.apagada_em else m.texto, "apagada": bool(m.apagada_em),
        "editada": bool(m.editada_em), "link": m.link, "resposta_a": resposta, "criada_em": m.criada_em.isoformat(),
    }


def conversa_out(db, c: Conversa, eu: int, nao_lidas: int = 0) -> dict:
    outros = [p.usuario_id for p in c.participantes if p.usuario_id != eu]
    if c.tipo == "direta":
        u = db.get(Usuario, outros[0]) if outros else None
        titulo = u.nome if u else "Conversa"
    else:
        titulo = c.titulo or "Grupo"
    ultima = db.scalar(select(Mensagem).where(Mensagem.conversa_id == c.id).order_by(Mensagem.id.desc()).limit(1))
    # ✓✓: até onde TODOS os outros leram
    lida_por_todos = min((p.lida_ate for p in c.participantes if p.usuario_id != eu), default=0)
    return {
        "id": c.id, "tipo": c.tipo, "titulo": titulo, "participantes": [p.usuario_id for p in c.participantes],
        "outro_id": outros[0] if c.tipo == "direta" and outros else None, "nao_lidas": nao_lidas,
        "lida_por_todos_ate": lida_por_todos,
        "ultima": msg_out(db, ultima) if ultima else None,
        "ultima_msg_em": c.ultima_msg_em.isoformat() if c.ultima_msg_em else None,
    }


def mencao_out(db, m: Mencao) -> dict:
    return {"id": m.id, "autor_nome": _nome(db, m.autor_id, {}), "trecho": service.texto_simples(m.trecho),
            "url": m.url, "origem_tipo": m.origem_tipo, "criada_em": m.criada_em.isoformat(),
            "lida": bool(m.lida_em), "resolvida": bool(m.resolvida_em)}


def _conversa(ctx, cid: int) -> tuple[Conversa, Participante]:
    c = ctx.db.get(Conversa, cid)
    p = service.participa(ctx.db, cid, ctx.usuario.id) if c else None
    if not c or c.tenant_id != ctx.tenant_id or not p:
        raise HTTPException(404, "Conversa não encontrada.")
    return c, p


def _erro(e: service.Proibido):
    return HTTPException(400, str(e))


# ======================================================================== REST
@router.get("/usuarios")
def usuarios(ctx: Ctx):
    from app.core.routes.auth import foto_url

    online = hub.online_do_tenant(ctx.tenant_id)
    lista = ctx.db.scalars(select(Usuario).where(Usuario.tenant_id == ctx.tenant_id, Usuario.ativo).order_by(Usuario.nome))
    return [{"id": u.id, "nome": u.nome, "login": u.login, "perfil": u.perfil.value, "foto_url": foto_url(u),
             "status": online.get(u.id, "offline")} for u in lista if u.id != ctx.usuario.id]


@router.get("/conversas")
def conversas(ctx: Ctx):
    service.canal_robo(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    nl = service.nao_lidas(ctx.db, ctx.usuario.id)
    q = (select(Conversa).join(Participante).where(Participante.usuario_id == ctx.usuario.id)
         .order_by(Conversa.ultima_msg_em.desc().nulls_last(), Conversa.id.desc()))
    return [conversa_out(ctx.db, c, ctx.usuario.id, nl.get(c.id, 0)) for c in ctx.db.scalars(q)]


@router.get("/resumo")
def resumo(ctx: Ctx):
    nl = service.nao_lidas(ctx.db, ctx.usuario.id)
    mencoes = ctx.db.scalar(select(func.count(Mencao.id)).where(Mencao.usuario_id == ctx.usuario.id,
                                                                 Mencao.resolvida_em.is_(None), Mencao.lida_em.is_(None))) or 0
    return {"nao_lidas": sum(nl.values()), "mencoes": mencoes}


@router.post("/diretas/{usuario_id}")
def abrir_direta(usuario_id: int, ctx: Ctx):
    try:
        c = service.abrir_direta(ctx.db, ctx.usuario, usuario_id)
    except service.Proibido as e:
        raise _erro(e) from e
    ctx.db.commit()
    return conversa_out(ctx.db, c, ctx.usuario.id)


class GrupoIn(BaseModel):
    titulo: str = Field(min_length=2, max_length=140)
    usuario_ids: list[int]


@router.post("/grupos")
def criar_grupo(dados: GrupoIn, ctx: Ctx):
    try:
        c = service.criar_grupo(ctx.db, ctx.usuario, dados.titulo, dados.usuario_ids)
    except service.Proibido as e:
        raise _erro(e) from e
    ctx.db.commit()
    return conversa_out(ctx.db, c, ctx.usuario.id)


@router.get("/conversas/{cid}/mensagens")
def mensagens(cid: int, ctx: Ctx, antes: int | None = None, limite: int = Query(40, ge=1, le=100)):
    _conversa(ctx, cid)
    q = select(Mensagem).where(Mensagem.conversa_id == cid)
    if antes:
        q = q.where(Mensagem.id < antes)
    itens = list(ctx.db.scalars(q.order_by(Mensagem.id.desc()).limit(limite)))
    cache: dict = {}
    return {"itens": [msg_out(ctx.db, m, cache) for m in reversed(itens)], "tem_mais": len(itens) == limite}


class MensagemIn(BaseModel):
    texto: str = Field(min_length=1, max_length=4000)
    resposta_a_id: int | None = None


@router.post("/conversas/{cid}/mensagens")
def enviar(cid: int, dados: MensagemIn, ctx: Ctx):
    c, _ = _conversa(ctx, cid)
    try:
        m = service.enviar(ctx.db, c, ctx.usuario, dados.texto, dados.resposta_a_id)
    except service.Proibido as e:
        raise _erro(e) from e
    ctx.db.commit()
    return msg_out(ctx.db, m)  # os outros recebem pelo carteiro


@router.patch("/mensagens/{mid}")
def editar(mid: int, dados: MensagemIn, ctx: Ctx):
    m = ctx.db.get(Mensagem, mid)
    if not m or m.autor_id != ctx.usuario.id or m.apagada_em:
        raise HTTPException(404, "Mensagem não encontrada.")
    m.texto, m.editada_em = dados.texto.strip()[:4000], agora()
    ctx.db.commit()
    hub_atualizar(ctx, m)
    return msg_out(ctx.db, m)


@router.delete("/mensagens/{mid}")
def apagar(mid: int, ctx: Ctx):
    m = ctx.db.get(Mensagem, mid)
    if not m or m.autor_id != ctx.usuario.id:
        raise HTTPException(404, "Mensagem não encontrada.")
    m.apagada_em = agora()
    ctx.db.commit()
    hub_atualizar(ctx, m)
    return msg_out(ctx.db, m)


def hub_atualizar(ctx, m: Mensagem) -> None:
    c = ctx.db.get(Conversa, m.conversa_id)
    _fila_eventos.append(([p.usuario_id for p in c.participantes], {"tipo": "mensagem.atualizada", "mensagem": msg_out(ctx.db, m)}))


class LidoIn(BaseModel):
    ate_id: int | None = None


@router.post("/conversas/{cid}/lido")
def lido(cid: int, dados: LidoIn, ctx: Ctx):
    c, p = _conversa(ctx, cid)
    ate = service.marcar_lido(ctx.db, p, dados.ate_id)
    ctx.db.commit()
    _fila_eventos.append(([x.usuario_id for x in c.participantes],
                          {"tipo": "lida", "conversa_id": cid, "usuario_id": ctx.usuario.id, "ate_id": ate}))
    return {"ate_id": ate}


@router.get("/busca")
def busca(ctx: Ctx, q: str = Query(min_length=2)):
    ids = select(Participante.conversa_id).where(Participante.usuario_id == ctx.usuario.id)
    itens = ctx.db.scalars(select(Mensagem).where(Mensagem.conversa_id.in_(ids), Mensagem.apagada_em.is_(None),
                                                  Mensagem.texto.ilike(f"%{q}%")).order_by(Mensagem.id.desc()).limit(30))
    cache: dict = {}
    return [msg_out(ctx.db, m, cache) for m in itens]


@router.get("/mencoes")
def mencoes(ctx: Ctx, pendentes: bool = False):
    q = select(Mencao).where(Mencao.usuario_id == ctx.usuario.id)
    if pendentes:
        q = q.where(Mencao.resolvida_em.is_(None))
    return [mencao_out(ctx.db, m) for m in ctx.db.scalars(q.order_by(Mencao.id.desc()).limit(50))]


def _mencao(ctx, mid: int) -> Mencao:
    m = ctx.db.get(Mencao, mid)
    if not m or m.usuario_id != ctx.usuario.id:
        raise HTTPException(404, "Menção não encontrada.")
    return m


@router.post("/mencoes/{mid}/ler")
def ler_mencao(mid: int, ctx: Ctx):
    m = _mencao(ctx, mid)
    m.lida_em = m.lida_em or agora()
    ctx.db.commit()
    return mencao_out(ctx.db, m)


@router.post("/mencoes/{mid}/resolver")
def resolver_mencao(mid: int, ctx: Ctx):
    m = _mencao(ctx, mid)
    m.lida_em = m.lida_em or agora()
    m.resolvida_em = agora()
    ctx.db.commit()
    return mencao_out(ctx.db, m)


class ChamarIn(BaseModel):
    usuario_id: int
    texto: str = Field(min_length=2, max_length=1000)
    origem_tipo: str = Field(pattern="^(lote|nfse|fatura|extrato|cliente)$")
    origem_id: int
    url: str = Field(pattern=r"^/[\w/\-?=&]*$", max_length=300)


@router.post("/chamar")
def chamar(dados: ChamarIn, ctx: Ctx):
    """"Chamar alguém" a partir de um lote, nota, fatura… (como a marcação em andamento do RCA)."""
    try:
        m = service.chamar(ctx.db, ctx.usuario, dados.usuario_id, dados.texto, dados.origem_tipo, dados.origem_id, dados.url)
    except service.Proibido as e:
        raise _erro(e) from e
    ctx.auditar("comunicador.chamar", dados.origem_tipo, dados.origem_id, descricao=f"Chamou {m.usuario_id}: {dados.texto[:80]}")
    ctx.db.commit()
    return mencao_out(ctx.db, m)


# ======================================================================== tempo real
# Eventos gerados nas rotas síncronas; o carteiro (async) entrega.
_fila_eventos: list[tuple[list[int], dict]] = []
_cursor = {"mensagem": None, "mencao": None}


def _novidades() -> list[tuple[list[int], dict]]:
    """Mensagens e menções novas no banco (inclusive as do robô, gravadas pelo worker)."""
    saida = []
    with SessionLocal() as db:
        if _cursor["mensagem"] is None:  # primeira volta: começa do agora
            _cursor["mensagem"] = db.scalar(select(func.max(Mensagem.id))) or 0
            _cursor["mencao"] = db.scalar(select(func.max(Mencao.id))) or 0
            return saida
        cache: dict = {}
        for m in db.scalars(select(Mensagem).where(Mensagem.id > _cursor["mensagem"]).order_by(Mensagem.id)):
            membros = list(db.scalars(select(Participante.usuario_id).where(Participante.conversa_id == m.conversa_id)))
            saida.append((membros, {"tipo": "mensagem.nova", "mensagem": msg_out(db, m, cache)}))
            _cursor["mensagem"] = m.id
        for men in db.scalars(select(Mencao).where(Mencao.id > _cursor["mencao"]).order_by(Mencao.id)):
            saida.append(([men.usuario_id], {"tipo": "mencao.nova", "mencao": mencao_out(db, men)}))
            _cursor["mencao"] = men.id
    return saida


async def carteiro(parar: asyncio.Event) -> None:
    ciclo = 0
    while not parar.is_set():
        try:
            eventos = await asyncio.to_thread(_novidades)
            while _fila_eventos:
                eventos.append(_fila_eventos.pop(0))
            for usuarios_ids, payload in eventos:
                await hub.para_usuarios(usuarios_ids, payload)
            ciclo += 1
            if ciclo % 30 == 0:
                await hub.varrer_ausentes()
        except Exception:  # noqa: BLE001 — o carteiro nunca pode morrer
            log.exception("Carteiro do comunicador falhou num ciclo")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(parar.wait(), timeout=1.0)


@ws_router.websocket("/ws/comunicador")
async def ws_comunicador(ws: WebSocket, token: str = ""):
    try:
        payload = decodificar_token(token, "access")
    except jwt.PyJWTError:
        await ws.close(code=4401)  # o front renova o token e reconecta
        return

    def carregar():
        with SessionLocal() as db:
            u = db.get(Usuario, int(payload["sub"]))
            return (u.id, u.tenant_id) if u and u.ativo else None

    dono = await asyncio.to_thread(carregar)
    if not dono:
        await ws.close(code=4401)
        return
    uid, tenant = dono
    await ws.accept()
    # primeiro o "olá" com quem já está online; depois avisa os outros que esta pessoa entrou
    await ws.send_json({"tipo": "ola", "online": hub.online_do_tenant(tenant)})
    await hub.conectar(ws, uid, tenant)
    try:
        while True:
            dado = await ws.receive_json()
            tipo = dado.get("tipo")
            if tipo == "ping":
                await ws.send_json({"tipo": "pong", "em": datetime.now().isoformat()})
            elif tipo == "atividade":
                await hub.ativo(uid)
            elif tipo == "status":
                await hub.definir_status(uid, str(dado.get("valor", "online")))
            elif tipo == "digitando":
                cid = int(dado.get("conversa_id", 0))
                membros = await asyncio.to_thread(_membros_se_participa, cid, uid)
                if membros:
                    await hub.para_usuarios([m for m in membros if m != uid],
                                            {"tipo": "digitando", "conversa_id": cid, "usuario_id": uid})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.debug("WebSocket do comunicador encerrado", exc_info=True)
    finally:
        await hub.desconectar(ws, uid)


def _membros_se_participa(cid: int, uid: int) -> list[int]:
    with SessionLocal() as db:
        membros = list(db.scalars(select(Participante.usuario_id).where(Participante.conversa_id == cid)))
        return membros if uid in membros else []
