"""Cobrança dos clientes do MayaJus (Mercado Pago): telas do admin, notificações do MP e o "Meu plano" do cliente."""

import logging
from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.controle import cobranca, planos
from app.controle.mercadopago import ErroMercadoPago, MercadoPago, assinatura_valida
from app.controle.models import Cliente, Cobranca, Plano, SessaoControle
from app.controle.routes_admin import Painel, _cliente, _d, _plano_out
from app.core import tenancy
from app.core.deps import Ctx
from app.core.security import cifrar

log = logging.getLogger(__name__)

admin = APIRouter(prefix="/admin", tags=["admin MayaCorp"])
publico = APIRouter(prefix="/public", tags=["público"])
meu = APIRouter(prefix="/meu-plano", tags=["meu plano"])

ROTULO = {"pendente": "Em aberto", "paga": "Paga", "cancelada": "Cancelada"}


def _erro(e: Exception):
    raise HTTPException(400, str(e)) from e


# ================================================================ schemas
class ConfigIn(BaseModel):
    token: str | None = Field(default=None, max_length=300)  # vazio = mantém o atual
    segredo: str | None = Field(default=None, max_length=300)
    dia_vencimento: int = Field(ge=1, le=28)
    gerar_automatico: bool
    regua: list[int] = Field(max_length=8)


class AvulsaIn(BaseModel):
    cliente_id: int
    descricao: str = Field(min_length=3, max_length=200)
    valor: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    vencimento: date
    enviar: bool = True


class GerarIn(BaseModel):
    competencia: str = Field(pattern=r"^\d{4}-\d{2}$")
    enviar: bool = True


class BaixaIn(BaseModel):
    forma: str = Field(default="manual", max_length=30)


class FormaIn(BaseModel):
    forma_pagamento: Literal["link", "cartao"]


class TrocaPlanoIn(BaseModel):
    plano_id: int
    ciclo: Literal["mensal", "anual"] = "mensal"


def _cob_out(k: Cobranca) -> dict:
    vencida = k.status == "pendente" and k.vencimento < date.today()
    return {"id": k.id, "cliente_id": k.cliente_id, "cliente_nome": k.cliente.nome, "tipo": k.tipo,
            "competencia": k.competencia, "descricao": k.descricao, "itens": k.itens or [], "valor": _d(k.valor),
            "vencimento": k.vencimento, "status": "vencida" if vencida else k.status,
            "status_rotulo": "Vencida" if vencida else ROTULO.get(k.status, k.status), "link": k.link,
            "pago_em": k.pago_em, "forma_paga": k.forma_paga, "avisos": k.avisos or [], "criado_em": k.criado_em}


def _cfg_out(cfg) -> dict:
    return {"conectado": bool(cfg.mp_token_cifrado), "segredo_definido": bool(cfg.mp_segredo_cifrado),
            "conta": cfg.mp_conta, "dia_vencimento": cfg.dia_vencimento, "gerar_automatico": cfg.gerar_automatico,
            "regua": cfg.regua or [], "url_notificacao": cobranca.url_notificacao()}


# ================================================================ admin: configuração
@admin.get("/cobranca/config")
def ler_config(ctx: Painel):
    with SessaoControle() as db:
        cfg = cobranca.config(db)
        db.commit()
        return _cfg_out(cfg)


@admin.put("/cobranca/config")
def salvar_config(dados: ConfigIn, ctx: Painel):
    with SessaoControle() as db:
        cfg = cobranca.config(db)
        if dados.token and dados.token.strip():
            t = dados.token.strip()
            try:
                conta = MercadoPago(t).conta()
            except ErroMercadoPago as e:
                _erro(e)
            cfg.mp_token_cifrado = cifrar(t.encode())
            cfg.mp_conta = conta.get("email") or conta.get("nickname") or str(conta.get("id"))
        if dados.segredo and dados.segredo.strip():
            cfg.mp_segredo_cifrado = cifrar(dados.segredo.strip().encode())
        cfg.dia_vencimento = dados.dia_vencimento
        cfg.gerar_automatico = dados.gerar_automatico
        cfg.regua = sorted({max(-30, min(60, d)) for d in dados.regua})
        db.commit()
        ctx.auditar("admin.cobranca.config", "controle_config", cfg.id,
                    descricao="Mercado Pago" + (" (token novo)" if dados.token else ""))
        ctx.db.commit()
        return _cfg_out(cfg)


@admin.post("/cobranca/config/testar")
def testar(ctx: Painel):
    with SessaoControle() as db:
        try:
            conta = cobranca.mp(cobranca.config(db)).conta()
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            _erro(e)
        return {"ok": True, "conta": conta.get("email") or conta.get("nickname"), "id": conta.get("id")}


# ================================================================ admin: cobranças
@admin.get("/cobrancas")
def listar(ctx: Painel, status: str | None = None, cliente_id: int | None = None):
    with SessaoControle() as db:
        q = select(Cobranca).order_by(Cobranca.vencimento.desc(), Cobranca.id.desc())
        if cliente_id:
            q = q.where(Cobranca.cliente_id == cliente_id)
        if status == "vencida":
            q = q.where(Cobranca.status == "pendente", Cobranca.vencimento < date.today())
        elif status == "pendente":
            q = q.where(Cobranca.status == "pendente", Cobranca.vencimento >= date.today())
        elif status:
            q = q.where(Cobranca.status == status)
        return [_cob_out(k) for k in db.scalars(q.limit(500))]


@admin.get("/cobrancas/resumo")
def resumo(ctx: Painel):
    hoje = date.today()
    with SessaoControle() as db:
        todas = list(db.scalars(select(Cobranca).where(Cobranca.status != "cancelada")))
    aberto = sum((k.valor for k in todas if k.status == "pendente" and k.vencimento >= hoje), Decimal(0))
    vencido = sum((k.valor for k in todas if k.status == "pendente" and k.vencimento < hoje), Decimal(0))
    recebido = sum((k.valor for k in todas if k.status == "paga" and k.pago_em and k.pago_em.date().replace(day=1)
                    == hoje.replace(day=1)), Decimal(0))
    return {"em_aberto": _d(aberto), "vencido": _d(vencido), "recebido_mes": _d(recebido),
            "inadimplentes": len({k.cliente_id for k in todas if k.status == "pendente" and k.vencimento < hoje})}


def _enviar(db, k: Cobranca) -> list[str]:
    try:
        return cobranca.enviar_cobranca(db, k)
    except (ErroMercadoPago, cobranca.RegraCobranca) as e:
        db.rollback()
        _erro(e)


@admin.post("/cobrancas/avulsa", status_code=201)
def criar_avulsa(dados: AvulsaIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, dados.cliente_id)
        try:
            k = cobranca.avulsa(db, c, dados.descricao, dados.valor, dados.vencimento)
            cobranca.criar_link(db, k)
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        if dados.enviar:
            _enviar(db, k)
        db.commit()
        ctx.auditar("admin.cobranca.avulsa", "controle_cobranca", k.id, descricao=f"{c.nome}: {k.descricao} {k.valor}")
        ctx.db.commit()
        return _cob_out(k)


@admin.post("/cobrancas/gerar")
def gerar(dados: GerarIn, ctx: Painel):
    """Mensalidades do mês para todos os clientes ativos (as que já existem ficam como estão)."""
    ano, mes = map(int, dados.competencia.split("-"))
    criadas, erros = [], []
    with SessaoControle() as db:
        clientes = db.scalars(select(Cliente).where(Cliente.tipo == "escritorio", Cliente.status.in_(cobranca.COBRAVEIS)))
        for c in clientes:
            try:
                k = cobranca.gerar_mensalidade(db, c, ano, mes)
                if k and dados.enviar:
                    cobranca.enviar_cobranca(db, k)
                db.commit()
                if k:
                    criadas.append(c.nome)
            except Exception as e:  # um cliente com problema não para os outros
                db.rollback()
                erros.append(f"{c.nome}: {e}")
        ctx.auditar("admin.cobranca.gerar", "controle_cobranca", None, descricao=f"{dados.competencia}: {len(criadas)}")
        ctx.db.commit()
    return {"criadas": criadas, "erros": erros}


@admin.post("/cobrancas/{kid}/enviar")
def reenviar(kid: int, ctx: Painel):
    with SessaoControle() as db:
        k = _cob(db, kid)
        if k.status != "pendente":
            raise HTTPException(400, "Só cobranças em aberto podem ser enviadas.")
        para = _enviar(db, k)
        db.commit()
        ctx.auditar("admin.cobranca.enviar", "controle_cobranca", k.id, descricao=", ".join(para))
        ctx.db.commit()
        return {**_cob_out(k), "enviado_para": para}


@admin.post("/cobrancas/{kid}/baixa")
def baixa_manual(kid: int, dados: BaixaIn, ctx: Painel):
    with SessaoControle() as db:
        k = _cob(db, kid)
        if k.status == "cancelada":
            raise HTTPException(400, "Cobrança cancelada.")
        cobranca.dar_baixa(k, dados.forma or "manual")
        db.commit()
        ctx.auditar("admin.cobranca.baixa", "controle_cobranca", k.id, descricao=f"{k.cliente.nome}: {k.valor}")
        ctx.db.commit()
        return _cob_out(k)


@admin.post("/cobrancas/{kid}/cancelar")
def cancelar(kid: int, ctx: Painel):
    with SessaoControle() as db:
        k = _cob(db, kid)
        if k.status == "paga":
            raise HTTPException(400, "Cobrança já paga não pode ser cancelada.")
        k.status = "cancelada"
        db.commit()
        ctx.auditar("admin.cobranca.cancelar", "controle_cobranca", k.id, descricao=f"{k.cliente.nome}: {k.descricao}")
        ctx.db.commit()
        return _cob_out(k)


def _cob(db, kid: int) -> Cobranca:
    k = db.get(Cobranca, kid)
    if not k:
        raise HTTPException(404, "Cobrança não encontrada.")
    return k


# ================================================================ admin: forma de pagamento do cliente
@admin.put("/clientes/{cid}/pagamento")
def forma_pagamento(cid: int, dados: FormaIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        c.forma_pagamento = dados.forma_pagamento
        db.commit()
        ctx.auditar("admin.cliente.pagamento", "controle_cliente", c.id, descricao=dados.forma_pagamento)
        ctx.db.commit()
        return _pagamento_out(c)


@admin.post("/clientes/{cid}/assinatura")
def criar_assinatura(cid: int, ctx: Painel):
    """Link para o cliente cadastrar o cartão (vai por e-mail para o financeiro)."""
    with SessaoControle() as db:
        c = _cliente(db, cid)
        try:
            link = cobranca.assinar_cartao(db, c)
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        db.commit()
        cobranca.enviar_email([c.email_financeiro], "MayaJus — cadastre o cartão para a mensalidade",
                              f"Olá, {c.responsavel or c.nome}.\n\nPara a mensalidade do MayaJus ser debitada todo mês "
                              f"no cartão, cadastre-o neste link do Mercado Pago:\n{link}\n\nMayaCorp")
        ctx.auditar("admin.cliente.assinatura", "controle_cliente", c.id, descricao=c.nome)
        ctx.db.commit()
        return {**_pagamento_out(c), "link": link}


@admin.get("/clientes/{cid}/pagamento")
def ler_pagamento(cid: int, ctx: Painel):
    with SessaoControle() as db:
        return _pagamento_out(_cliente(db, cid))


def _pagamento_out(c: Cliente) -> dict:
    return {"forma_pagamento": c.forma_pagamento, "assinatura_id": c.mp_assinatura_id,
            "assinatura_status": c.mp_assinatura_status}


# ================================================================ notificações do Mercado Pago (públicas)
@publico.post("/mercadopago")
async def notificacao(request: Request):
    """O Mercado Pago avisa aqui (pagamento, assinatura, débito da assinatura). A assinatura secreta confere a origem."""
    try:
        corpo = await request.json()
    except ValueError:
        corpo = {}
    qp = request.query_params
    tipo = corpo.get("type") or qp.get("type") or qp.get("topic") or ""
    recurso = str((corpo.get("data") or {}).get("id") or qp.get("data.id") or qp.get("id") or "")
    if not (tipo and recurso):
        return {"ok": True}
    with SessaoControle() as db:
        cfg = cobranca.config(db)
        seg, assinatura = cobranca.segredo(cfg), request.headers.get("x-signature")
        if seg and assinatura and not assinatura_valida(seg, assinatura, request.headers.get("x-request-id"),
                                                        qp.get("data.id") or recurso):
            log.warning("Notificação do Mercado Pago com assinatura inválida (%s %s): ignorada", tipo, recurso)
            return {"ok": True}
        try:
            # nada é aceito às cegas: o pagamento é sempre relido na API do Mercado Pago com o nosso token
            resultado = cobranca.processar_notificacao(db, tipo, recurso)
            db.commit()
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            log.warning("Notificação %s %s: %s", tipo, recurso, e)
            raise HTTPException(503, "Tente de novo.") from e
    log.info("Mercado Pago: %s", resultado)
    return {"ok": True}


# ================================================================ "Meu plano" (no ambiente do cliente)
def _meu_cliente(db) -> Cliente:
    esc = tenancy.atual()
    if not (tenancy.multi() and esc) or esc.mayacorp:
        raise HTTPException(404, "Não encontrado.")
    c = db.scalar(select(Cliente).where(Cliente.slug == esc.slug))
    if not c:
        raise HTTPException(404, "Não encontrado.")
    return c


@meu.get("")
def meu_plano(ctx: Ctx):
    hoje = date.today()
    with SessaoControle() as db:
        c = _meu_cliente(db)
        disponiveis = db.scalars(select(Plano).where(Plano.ativo).order_by(Plano.ordem, Plano.id))
        abertas = db.scalars(select(Cobranca).where(Cobranca.cliente_id == c.id, Cobranca.status == "pendente")
                             .order_by(Cobranca.vencimento))
        pagas = db.scalars(select(Cobranca).where(Cobranca.cliente_id == c.id, Cobranca.status == "paga")
                           .order_by(Cobranca.pago_em.desc()).limit(12))
        u = cobranca.uso(c, hoje.year, hoje.month)
        return {
            "nome": c.nome, "status": c.status, "teste_ate": c.teste_ate, "ciclo": c.ciclo,
            "plano": _plano_out(c.plano), "valor": _d(cobranca.valor_do_plano(db, c)),
            "forma_pagamento": c.forma_pagamento, "assinatura_status": c.mp_assinatura_status,
            "pode_alterar": ctx.usuario.administrador,
            "uso": {**u, "valor_excedente": _d(u["valor_excedente"])},
            "planos": [_plano_out(p) for p in disponiveis],
            "recursos": [{"chave": k, "rotulo": v} for k, v in planos.RECURSOS.items()],
            "em_aberto": [_cob_out(k) for k in abertas], "pagas": [_cob_out(k) for k in pagas],
        }


def _so_admin(ctx) -> None:
    if not ctx.usuario.administrador:
        raise HTTPException(403, "Só o administrador do escritório pode mudar o plano.")


@meu.put("")
def trocar_plano(dados: TrocaPlanoIn, ctx: Ctx):
    """Upgrade ou downgrade: os limites mudam na hora; a cobrança nova vale a partir da próxima mensalidade."""
    _so_admin(ctx)
    with SessaoControle() as db:
        c = _meu_cliente(db)
        p = db.get(Plano, dados.plano_id)
        if not p or not p.ativo:
            raise HTTPException(400, "Plano não disponível.")
        if c.forma_pagamento == "cartao" and dados.ciclo == "anual":
            raise HTTPException(400, "A assinatura no cartão é mensal. Para o plano anual, fale com a MayaCorp.")
        u = cobranca.uso(c, date.today().year, date.today().month)
        if p.usuarios and u["usuarios"] > p.usuarios:
            raise HTTPException(400, f"O plano {p.nome} vai até {p.usuarios} usuário(s) e o escritório tem "
                                     f"{u['usuarios']} com acesso. Desative alguns em Configurações › Profissionais.")
        antes = c.plano.nome if c.plano else "sem plano"
        c.plano_id, c.ciclo = p.id, dados.ciclo
        db.flush()
        db.refresh(c)
        try:
            cobranca.plano_mudou(db, c)
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        db.commit()
        ctx.auditar("meu_plano.trocar", "controle_cliente", c.id, descricao=f"{antes} → {p.nome} ({dados.ciclo})")
        ctx.db.commit()
    return meu_plano(ctx)


@meu.post("/cartao")
def meu_cartao(ctx: Ctx):
    _so_admin(ctx)
    with SessaoControle() as db:
        c = _meu_cliente(db)
        try:
            link = cobranca.assinar_cartao(db, c)
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        db.commit()
        ctx.auditar("meu_plano.cartao", "controle_cliente", c.id, descricao="assinatura no cartão")
        ctx.db.commit()
        return {"link": link}


@meu.post("/cobrancas/{kid}/link")
def meu_link(kid: int, ctx: Ctx):
    with SessaoControle() as db:
        c = _meu_cliente(db)
        k = db.get(Cobranca, kid)
        if not k or k.cliente_id != c.id or k.status != "pendente":
            raise HTTPException(404, "Cobrança não encontrada.")
        try:
            link = cobranca.criar_link(db, k)
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        db.commit()
        return {"link": link}
