"""Cobranças recorrentes no admin (/api/admin): as de um cliente, a prévia antes de salvar e as ações (pausar,
retomar, encerrar, gerar a próxima agora). As regras estão em app/controle/recorrencia.py."""

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.controle import cobranca, recorrencia
from app.controle.mercadopago import ErroMercadoPago
from app.controle.models import Cobranca, CobrancaRecorrente, SessaoControle
from app.controle.routes_admin import Painel, _cliente, _d
from app.controle.routes_cobranca import _cob_out
from app.core.db import agora

admin = APIRouter(prefix="/admin", tags=["admin MayaCorp"])

PERIODICIDADE = {"mensal": "Mensal", "bimestral": "Bimestral", "trimestral": "Trimestral", "semestral": "Semestral",
                 "anual": "Anual"}
SITUACAO = {"ativa": "Ativa", "pausada": "Pausada", "encerrada": "Encerrada", "concluida": "Concluída"}


class RecorrenciaIn(BaseModel):
    descricao: str = Field(min_length=3, max_length=180)
    valor: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    periodicidade: Literal["mensal", "bimestral", "trimestral", "semestral", "anual"] = "mensal"
    dia_vencimento: int = Field(ge=0, le=28)  # 0 = último dia do mês
    inicio: date  # mês da primeira cobrança (o dia é ignorado)
    termino_tipo: Literal["sem_fim", "data", "quantidade"] = "sem_fim"
    termino_data: date | None = None
    termino_quantidade: int | None = Field(default=None, ge=1, le=600)
    antecedencia: int | None = Field(default=None, ge=0, le=60)  # vazio = o primeiro aviso da régua
    observacao: str | None = None


class PreviaIn(RecorrenciaIn):
    cliente_id: int
    recorrencia_id: int | None = None  # editando: a prévia continua de onde a recorrência está


class SituacaoIn(BaseModel):
    acao: Literal["pausar", "retomar", "encerrar"]


def _erro(e: Exception):
    raise HTTPException(400, str(e)) from e


def _rec(db, rid: int) -> CobrancaRecorrente:
    r = db.get(CobrancaRecorrente, rid)
    if not r:
        raise HTTPException(404, "Recorrência não encontrada.")
    return r


def _aplicar(db, r: CobrancaRecorrente, dados: RecorrenciaIn) -> None:
    """Põe os dados da tela na recorrência. O que já foi gerado não muda: valor, dia e periodicidade novos valem da
    próxima cobrança em diante, e o início só pode mudar enquanto nada saiu."""
    inicio = recorrencia.primeiro_dia(dados.inicio)
    if r.geradas:
        if inicio != r.inicio:
            raise HTTPException(400, "O início não muda depois que a primeira cobrança saiu. Para recomeçar, encerre "
                                     "esta recorrência e crie outra.")
    else:
        r.inicio = r.proxima_competencia = inicio
    r.descricao, r.valor, r.periodicidade = dados.descricao.strip(), dados.valor, dados.periodicidade
    r.dia_vencimento = dados.dia_vencimento
    r.termino_tipo = dados.termino_tipo
    r.termino_data = dados.termino_data if dados.termino_tipo == "data" else None
    r.termino_quantidade = dados.termino_quantidade if dados.termino_tipo == "quantidade" else None
    r.antecedencia = (dados.antecedencia if dados.antecedencia is not None
                      else recorrencia.antecedencia_padrao(cobranca.config(db).regua))
    r.observacao = (dados.observacao or "").strip() or None
    if r.termino_tipo == "data" and not r.termino_data:
        raise HTTPException(400, "Informe até quando a recorrência vale.")
    if r.termino_tipo == "quantidade" and not r.termino_quantidade:
        raise HTTPException(400, "Informe quantas cobranças a recorrência terá.")
    if r.termino_tipo == "quantidade" and r.termino_quantidade < (r.geradas or 0):
        raise HTTPException(400, f"Já saíram {r.geradas} cobranças: o total não pode ser menor que isso.")
    if not r.geradas and recorrencia._ocorrencia(r, r.proxima_competencia, 0) is None:
        raise HTTPException(400, "Com este término nenhuma cobrança seria gerada: o primeiro vencimento cai depois dele.")


def _out(db, r: CobrancaRecorrente) -> dict:
    contas = dict(db.execute(select(Cobranca.status, func.count(Cobranca.id)).where(Cobranca.recorrencia_id == r.id)
                             .group_by(Cobranca.status)).all())
    prox = recorrencia.proxima(r)
    c = r.cliente
    return {"id": r.id, "cliente_id": r.cliente_id, "cliente_nome": c.nome, "descricao": r.descricao, "valor": _d(r.valor),
            "periodicidade": r.periodicidade, "periodicidade_rotulo": PERIODICIDADE[r.periodicidade],
            "dia_vencimento": r.dia_vencimento, "inicio": r.inicio, "termino_tipo": r.termino_tipo,
            "termino_data": r.termino_data, "termino_quantidade": r.termino_quantidade, "antecedencia": r.antecedencia,
            "status": r.status, "status_rotulo": SITUACAO.get(r.status, r.status), "observacao": r.observacao,
            "geradas": r.geradas or 0, "pagas": contas.get("paga", 0), "em_aberto": contas.get("pendente", 0),
            "proxima_competencia": f"{prox[0]:%Y-%m}" if prox else None, "proximo_vencimento": prox[1] if prox else None,
            # cliente inativo não é cobrado: a recorrência fica parada mesmo estando ativa
            "cliente_inativo": c.status == "inativo", "criado_em": r.criado_em, "encerrada_em": r.encerrada_em}


def _nova(dados: RecorrenciaIn, cliente_id: int) -> CobrancaRecorrente:
    inicio = recorrencia.primeiro_dia(dados.inicio)
    return CobrancaRecorrente(cliente_id=cliente_id, status="ativa", geradas=0, rotina_no_dia=0, inicio=inicio,
                              proxima_competencia=inicio)


@admin.get("/clientes/{cid}/recorrencias")
def listar(cid: int, ctx: Painel):
    with SessaoControle() as db:
        _cliente(db, cid)
        q = select(CobrancaRecorrente).where(CobrancaRecorrente.cliente_id == cid).order_by(CobrancaRecorrente.id.desc())
        return [_out(db, r) for r in db.scalars(q)]


@admin.post("/recorrencias/previa")
def previa(dados: PreviaIn, ctx: Painel):
    """As 3 próximas cobranças com os dados do formulário (nada é gravado) e os avisos para a pessoa conferir."""
    with SessaoControle() as db:
        c = _cliente(db, dados.cliente_id)
        if dados.recorrencia_id:
            r = _rec(db, dados.recorrencia_id)
            if r.cliente_id != c.id:
                raise HTTPException(404, "Recorrência não encontrada.")
        else:
            r = _nova(dados, c.id)
        _aplicar(db, r, dados)
        p = recorrencia.previa(r, date.today())
        saida = {"proximas": [{**x, "valor": _d(x["valor"])} for x in p["proximas"]], "saem_ja": p["saem_ja"],
                 "termina": p["termina"], "por_dia": recorrencia.TETO_POR_DIA,
                 "prazo_atrasada": recorrencia.PRAZO_ATRASADA, "antecedencia": r.antecedencia,
                 "sem_email": not c.email_financeiro, "cliente_inativo": c.status == "inativo"}
        db.rollback()  # prévia nunca grava
        return saida


@admin.post("/clientes/{cid}/recorrencias", status_code=201)
def criar(cid: int, dados: RecorrenciaIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        r = _nova(dados, c.id)
        _aplicar(db, r, dados)
        db.add(r)
        db.commit()
        ctx.auditar("admin.recorrencia.criar", "controle_recorrencia", r.id,
                    descricao=f"{c.nome}: {r.descricao} {r.valor} ({r.periodicidade})")
        ctx.db.commit()
        return {**_out(db, r), "sem_email": not c.email_financeiro}


@admin.put("/recorrencias/{rid}")
def alterar(rid: int, dados: RecorrenciaIn, ctx: Painel):
    with SessaoControle() as db:
        r = _rec(db, rid)
        if r.status == "encerrada":
            raise HTTPException(400, "Recorrência encerrada não muda. Crie outra.")
        antes = f"{r.valor}"
        _aplicar(db, r, dados)
        if r.status == "concluida" and recorrencia._ocorrencia(r, r.proxima_competencia, r.geradas or 0) is not None:
            r.status, r.encerrada_em = "ativa", None  # o término foi esticado: volta a gerar
        db.commit()
        ctx.auditar("admin.recorrencia.alterar", "controle_recorrencia", r.id,
                    descricao=f"{r.cliente.nome}: {r.descricao}" + (f" (valor {antes} → {r.valor})" if antes != f"{r.valor}" else ""))
        ctx.db.commit()
        return _out(db, r)


@admin.post("/recorrencias/{rid}/situacao")
def mudar_situacao(rid: int, dados: SituacaoIn, ctx: Painel):
    """Pausar (para de gerar até retomar), retomar ou encerrar de vez. As cobranças já geradas não mudam."""
    with SessaoControle() as db:
        r = _rec(db, rid)
        if r.status in ("encerrada", "concluida"):
            raise HTTPException(400, "Esta recorrência já terminou.")
        if dados.acao == "pausar":
            r.status = "pausada"
        elif dados.acao == "retomar":
            r.status = "ativa"
        else:
            r.status, r.encerrada_em = "encerrada", agora()
        db.commit()
        ctx.auditar(f"admin.recorrencia.{dados.acao}", "controle_recorrencia", r.id,
                    descricao=f"{r.cliente.nome}: {r.descricao}")
        ctx.db.commit()
        return _out(db, r)


@admin.post("/recorrencias/{rid}/gerar")
def gerar_agora(rid: int, ctx: Painel):
    """Gera já a próxima cobrança (sem esperar a rotina nem a antecedência), com o link e o e-mail. Nunca duplica:
    cada clique gera a competência seguinte, e o término continua valendo."""
    with SessaoControle() as db:
        r = _rec(db, rid)
        if r.status == "pausada":
            raise HTTPException(400, "A recorrência está pausada. Retome antes de gerar.")
        if r.cliente.status == "inativo":
            raise HTTPException(400, "O cliente está inativo: reative para voltar a cobrar.")
        cfg = cobranca.config(db)
        try:
            k = recorrencia.gerar(db, r, date.today(), forcar=True)
            if k is None:
                db.commit()
                raise HTTPException(400, "Esta recorrência já terminou: não há próxima cobrança.")
            recorrencia.enviar_nova(db, k, date.today(), sorted(set(cfg.regua or [])))
        except (ErroMercadoPago, cobranca.RegraCobranca) as e:
            db.rollback()
            _erro(e)
        db.commit()
        ctx.auditar("admin.recorrencia.gerar", "controle_cobranca", k.id,
                    descricao=f"{k.cliente.nome}: {k.descricao} {k.valor}")
        ctx.db.commit()
        return {"cobranca": _cob_out(k), "recorrencia": _out(db, r)}


@admin.delete("/recorrencias/{rid}")
def excluir(rid: int, ctx: Painel):
    """Só a que foi criada por engano e ainda não gerou cobrança; as outras são encerradas."""
    with SessaoControle() as db:
        r = _rec(db, rid)
        if r.geradas or db.scalar(select(Cobranca.id).where(Cobranca.recorrencia_id == rid).limit(1)):
            raise HTTPException(409, "Esta recorrência já gerou cobrança: encerre em vez de excluir.")
        desc = f"{r.cliente.nome}: {r.descricao}"
        db.delete(r)
        db.commit()
    ctx.auditar("admin.recorrencia.excluir", "controle_recorrencia", rid, descricao=desc)
    ctx.db.commit()
    return {"mensagem": "Recorrência excluída."}

