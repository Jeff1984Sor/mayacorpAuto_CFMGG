"""Cadastro pelo site da MayaCorp: formulário público → solicitação no admin → aprovar cria o ambiente (com teste)."""

import logging
import re
import time
from collections import defaultdict, deque
from datetime import date
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.controle import service
from app.controle.models import Plano, SessaoControle, Solicitacao
from app.controle.routes_admin import ClienteNovoIn, Painel, _d, _plano_out, criar_cliente
from app.core.config import settings
from app.core.deps import Contexto, ip_cliente
from app.core.models import Usuario

log = logging.getLogger(__name__)

publico = APIRouter(prefix="/public", tags=["público"])
admin = APIRouter(prefix="/admin", tags=["admin MayaCorp"])

_envios: dict[str, deque] = defaultdict(deque)  # IP → horários dos últimos envios (freio contra robôs)
LIMITE_POR_HORA = 5


class CadastroIn(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    documento: str | None = Field(default=None, max_length=20)
    responsavel: str = Field(min_length=3, max_length=150)
    email: EmailStr
    telefone: str = Field(min_length=8, max_length=30)
    plano_id: int | None = None
    ciclo: Literal["mensal", "anual"] = "mensal"
    usuarios: int | None = Field(default=None, ge=1, le=1000)
    indicacao: str | None = Field(default=None, max_length=200)
    mensagem: str | None = Field(default=None, max_length=2000)
    aceite: bool
    site: str | None = None  # isca para robôs: campo escondido, gente de verdade deixa vazio


class AprovarIn(BaseModel):
    dias_teste: int | None = Field(default=15, ge=1, le=90)
    slug: str | None = Field(default=None, max_length=39)


def _sol_out(s: Solicitacao) -> dict:
    return {"id": s.id, "nome": s.nome, "documento": s.documento, "responsavel": s.responsavel, "email": s.email,
            "telefone": s.telefone, "plano": _plano_out(s.plano), "ciclo": s.ciclo, "usuarios": s.usuarios,
            "indicacao": s.indicacao, "mensagem": s.mensagem, "status": s.status, "cliente_id": s.cliente_id,
            "criado_em": s.criado_em}


# ================================================================ público (formulário)
@publico.get("/planos")
def planos_publicos():
    with SessaoControle() as db:
        return [{**_plano_out(p), "preco_mensal": _d(p.preco_mensal), "preco_anual": _d(p.preco_anual)}
                for p in db.scalars(select(Plano).where(Plano.ativo).order_by(Plano.ordem, Plano.id))]


@publico.post("/cadastro", status_code=201)
def cadastrar(dados: CadastroIn, request: Request):
    if dados.site:  # robô preencheu o campo escondido: finge que deu certo e descarta
        return {"ok": True}
    if not dados.aceite:
        raise HTTPException(400, "É preciso aceitar os termos para continuar.")
    ip = ip_cliente(request) or "?"
    agora_s = time.time()
    fila = _envios[ip]
    while fila and agora_s - fila[0] > 3600:
        fila.popleft()
    if len(fila) >= LIMITE_POR_HORA:
        raise HTTPException(429, "Muitos envios seguidos. Tente de novo mais tarde ou fale com a MayaCorp.")
    fila.append(agora_s)
    doc = re.sub(r"\D", "", dados.documento or "") or None
    if doc and len(doc) not in (11, 14):
        raise HTTPException(400, "CNPJ ou CPF inválido.")
    with SessaoControle() as db:
        plano = db.get(Plano, dados.plano_id) if dados.plano_id else None
        if dados.plano_id and (not plano or not plano.ativo):
            raise HTTPException(400, "Plano não disponível.")
        s = Solicitacao(nome=dados.nome.strip(), documento=doc, responsavel=dados.responsavel.strip(),
                        email=str(dados.email).lower(), telefone=dados.telefone.strip(), plano_id=dados.plano_id,
                        ciclo=dados.ciclo, usuarios=dados.usuarios, indicacao=(dados.indicacao or "").strip() or None,
                        mensagem=(dados.mensagem or "").strip() or None, status="nova", ip=ip)
        db.add(s)
        db.commit()
        plano_nome = plano.nome if plano else "a definir"
    try:
        service.enviar_email(
            [s.email], "Recebemos seu cadastro no MayaJus",
            f"Olá, {s.responsavel.split()[0]}!\n\nRecebemos o cadastro do {s.nome} (plano {plano_nome}). Em breve "
            "você recebe um e-mail com o link para criar o seu acesso e começar o teste grátis.\n\nEquipe MayaCorp")
        _avisar_mayacorp(s, plano_nome)
    except Exception:
        log.exception("E-mails do cadastro %s falharam", s.id)
    return {"ok": True}


def _avisar_mayacorp(s: Solicitacao, plano_nome: str) -> None:
    """Avisa cada administrador do admin MayaCorp, com o link para aprovar sem entrar no sistema."""
    from app.core import tenancy
    from app.core.db import SessionLocal
    from app.core.models import Usuario
    from app.core.security import criar_token

    esc = service.escritorio_mayacorp()
    if esc is None:
        return
    host = service.endereco_do_painel()
    with tenancy.usando(esc), SessionLocal() as db:
        admins = [(u.id, u.email) for u in db.scalars(select(Usuario).where(Usuario.ativo, Usuario.senha_hash.is_not(None)))
                  if u.administrador and not u.equipe_mayacorp]
        links = {uid: criar_token(str(uid), "aprovar", {"sol": s.id}) for uid, _ in admins}
    base = f"https://{host}" if host else settings.frontend_url.rstrip("/")
    for uid, email in admins:
        service.enviar_email(
            [email], f"Novo cadastro no MayaJus: {s.nome}",
            f"{s.nome} ({s.documento or 'sem CNPJ'})\nResponsável: {s.responsavel}\nE-mail: {s.email}\n"
            f"Telefone: {s.telefone}\nPlano: {plano_nome} ({s.ciclo})\nUsuários: {s.usuarios or '-'}\n"
            f"Indicação: {s.indicacao or '-'}\n\n{s.mensagem or ''}\n\n"
            f"Aprovar ou recusar (sem precisar entrar no sistema):\n{base}/aprovar?token={links[uid]}\n\n"
            "O link vale por 7 dias. Também dá para aprovar no admin, em Solicitações.")


# ================================================================ aprovar pelo link do e-mail (sem login)
class TokenIn(BaseModel):
    token: str
    dias_teste: int | None = Field(default=15, ge=1, le=90)


def _pelo_link(token: str, db) -> tuple[Usuario, int]:
    """O link do e-mail identifica o administrador da MayaCorp e a solicitação (vale 7 dias)."""
    import jwt

    from app.core import tenancy
    from app.core.escritorio_http import definir_pelo_token
    from app.core.security import decodificar_token

    try:
        payload = decodificar_token(token, "aprovar")
    except jwt.PyJWTError:
        raise HTTPException(400, "Link inválido ou expirado. Aprove pelo admin, em Solicitações.") from None
    esc = definir_pelo_token(token)
    if not (esc and esc.mayacorp) and tenancy.multi():
        raise HTTPException(400, "Link inválido.")
    u = db.get(Usuario, int(payload["sub"]))
    if not u or not u.ativo or not u.administrador:
        raise HTTPException(403, "Este link não vale mais para o seu usuário.")
    return u, int(payload["sol"])


@publico.get("/solicitacao")
def ver_pelo_link(token: str, request: Request):
    from app.core.db import SessionLocal

    with SessionLocal() as db:
        _, sid = _pelo_link(token, db)
    with SessaoControle() as ctl:
        s = ctl.get(Solicitacao, sid)
        if not s:
            raise HTTPException(404, "Solicitação não encontrada.")
        return _sol_out(s)


@publico.post("/solicitacao/aprovar")
def aprovar_pelo_link(dados: TokenIn, request: Request):
    from app.core.db import SessionLocal

    with SessionLocal() as db:
        u, sid = _pelo_link(dados.token, db)
        ctx = Contexto(db=db, usuario=u, ip=ip_cliente(request))
        return aprovar(sid, AprovarIn(dias_teste=dados.dias_teste), ctx)


@publico.post("/solicitacao/recusar")
def recusar_pelo_link(dados: TokenIn, request: Request):
    from app.core.db import SessionLocal

    with SessionLocal() as db:
        u, sid = _pelo_link(dados.token, db)
        return recusar(sid, Contexto(db=db, usuario=u, ip=ip_cliente(request)))


# ================================================================ admin
@admin.get("/solicitacoes")
def listar(ctx: Painel, status: str | None = None):
    with SessaoControle() as db:
        q = select(Solicitacao).order_by(Solicitacao.id.desc())
        if status:
            q = q.where(Solicitacao.status == status)
        return [_sol_out(s) for s in db.scalars(q.limit(300))]


def _sol(db, sid: int) -> Solicitacao:
    s = db.get(Solicitacao, sid)
    if not s:
        raise HTTPException(404, "Solicitação não encontrada.")
    if s.status != "nova":
        raise HTTPException(400, "Esta solicitação já foi tratada.")
    return s


@admin.post("/solicitacoes/{sid}/aprovar")
def aprovar(sid: int, dados: AprovarIn, ctx: Painel):
    """Cria o ambiente com teste grátis e manda as boas-vindas (o cliente cria o usuário master pelo link)."""
    with SessaoControle() as db:
        s = _sol(db, sid)
        novo = ClienteNovoIn(nome=s.nome, documento=s.documento, responsavel=s.responsavel, email_financeiro=s.email,
                             telefone=s.telefone, plano_id=s.plano_id, ciclo=s.ciclo, inicio_contrato=date.today(),
                             observacao=_observacao(s), slug=dados.slug, admin_nome=s.responsavel, admin_email=s.email,
                             dias_teste=dados.dias_teste, dominios=[])
    cliente = criar_cliente(novo, ctx)
    with SessaoControle() as db:
        s = db.get(Solicitacao, sid)
        s.status, s.cliente_id = "aprovada", cliente["id"]
        db.commit()
    return cliente


def _observacao(s: Solicitacao) -> str | None:
    partes = [f"Usuários previstos: {s.usuarios}" if s.usuarios else None,
              f"Indicação: {s.indicacao}" if s.indicacao else None, s.mensagem]
    return "\n".join(p for p in partes if p) or None


@admin.post("/solicitacoes/{sid}/recusar")
def recusar(sid: int, ctx: Painel):
    with SessaoControle() as db:
        s = _sol(db, sid)
        s.status = "recusada"
        db.commit()
        ctx.auditar("admin.solicitacao.recusar", "controle_solicitacao", sid, descricao=s.nome)
        ctx.db.commit()
        return _sol_out(s)
