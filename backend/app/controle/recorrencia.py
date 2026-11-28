"""Cobranças recorrentes: um serviço cobrado todo período (hospedagem, suporte, manutenção…), para qualquer cliente
da MayaCorp, com ou sem acesso ao sistema. É a forma de cobrar quem não usa o MayaJus.

- A recorrência guarda o cursor (`proxima_competencia` + `geradas`). Cada cobrança sai com tipo "recorrente",
  ligada à recorrência, e o banco não aceita duas da mesma recorrência no mesmo mês (uq_cobranca_recorrencia).
- Quando sai: `antecedencia` dias antes do vencimento, na rotina diária do worker (`cobranca.rotina_diaria`), já
  com o link do Mercado Pago e o e-mail. Depois ela segue a régua, a baixa e a NFS-e como qualquer cobrança.
- Sistema parado por dias (ou recorrência criada com início no passado): as competências que ficaram para trás
  saem em ordem, sem pular, no máximo TETO_POR_DIA por recorrência a cada dia (mesmo que a rotina rode várias
  vezes) e TETO_POR_RODADA no total; o resto sai nos dias seguintes. A que já nasce depois do vencimento ganha
  PRAZO_ATRASADA dias para pagar, em vez de nascer vencida.
- Mudar o valor (ou o dia, a periodicidade) só vale para as próximas: cobrança gerada não muda.
- Cliente inativo não gera. Sempre por link: o cartão recorrente do Mercado Pago é só da mensalidade do plano.
"""

import calendar
import logging
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from app.controle import cobranca
from app.controle.models import Cliente, Cobranca, CobrancaRecorrente
from app.core.db import agora

log = logging.getLogger(__name__)

PASSO = {"mensal": 1, "bimestral": 2, "trimestral": 3, "semestral": 6, "anual": 12}  # meses entre as cobranças
TETO_POR_DIA = 3  # cobranças que a rotina gera de uma mesma recorrência no mesmo dia (as atrasadas saem aos poucos)
TETO_POR_RODADA = 50  # cobranças recorrentes novas por rodada, somando todos os clientes
PRAZO_ATRASADA = 5  # dias para pagar a cobrança que saiu depois do vencimento previsto


class RegraRecorrencia(cobranca.RegraCobranca):
    pass


def primeiro_dia(d: date) -> date:
    return d.replace(day=1)


def somar_meses(d: date, n: int) -> date:
    total = d.year * 12 + (d.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def vencimento_de(dia: int, competencia: date) -> date:
    """dia 0 = último dia do mês."""
    ultimo = calendar.monthrange(competencia.year, competencia.month)[1]
    return competencia.replace(day=ultimo if dia == 0 else min(dia, ultimo))


def antecedencia_padrao(regua: list[int] | None) -> int:
    """O primeiro aviso "antes do vencimento" da régua (ex.: 3 dias antes); sem ele, 3."""
    antes = [-p for p in regua or [] if p < 0]
    return max(antes) if antes else 3


def proxima(rec: CobrancaRecorrente) -> tuple[date, date] | None:
    """(competência, vencimento) da próxima cobrança; None quando a recorrência chegou ao fim."""
    if rec.status in ("encerrada", "concluida"):
        return None
    return _ocorrencia(rec, rec.proxima_competencia, rec.geradas or 0)


def _ocorrencia(rec: CobrancaRecorrente, comp: date, ja_geradas: int) -> tuple[date, date] | None:
    venc = vencimento_de(rec.dia_vencimento, comp)
    if rec.termino_tipo == "data" and rec.termino_data and venc > rec.termino_data:
        return None
    if rec.termino_tipo == "quantidade" and rec.termino_quantidade is not None and ja_geradas >= rec.termino_quantidade:
        return None
    return comp, venc


def previa(rec: CobrancaRecorrente, hoje: date, n: int = 3) -> dict:
    """As próximas cobranças (para a pessoa conferir antes de salvar) e quantas já sairiam hoje."""
    proximas, atrasadas = [], 0
    comp, geradas = rec.proxima_competencia, rec.geradas or 0
    for _ in range(600):  # 50 anos de mensal: só para a conta das atrasadas nunca rodar para sempre
        o = _ocorrencia(rec, comp, geradas)
        if o is None:
            break
        _, venc = o
        sai_em = venc - timedelta(days=rec.antecedencia)
        ja = sai_em <= hoje
        if ja:
            atrasadas += 1
        if len(proximas) < n:
            real = venc if venc >= hoje else hoje + timedelta(days=PRAZO_ATRASADA)
            proximas.append({"competencia": f"{comp:%Y-%m}", "vencimento": real, "vencimento_previsto": venc,
                             "sai_em": max(sai_em, hoje), "valor": rec.valor, "ja_sai": ja})
        elif not ja:
            break
        comp, geradas = somar_meses(comp, PASSO[rec.periodicidade]), geradas + 1
    return {"proximas": proximas, "saem_ja": atrasadas, "termina": len(proximas) < n}


def gerar(db, rec: CobrancaRecorrente, hoje: date, *, forcar: bool = False) -> Cobranca | None:
    """A cobrança da próxima competência, se já chegou a data (forcar = "Gerar a próxima agora": não espera a
    antecedência, mas respeita o término). Avança o cursor; None quando não há o que gerar."""
    o = proxima(rec)
    if o is None:
        if rec.status == "ativa":
            _concluir(rec)
        return None
    comp, venc = o
    if not forcar and hoje < venc - timedelta(days=rec.antecedencia):
        return None
    chave = f"{comp:%Y-%m}"
    ja = db.scalar(select(Cobranca.id).where(Cobranca.recorrencia_id == rec.id, Cobranca.competencia == chave))
    cob = None
    if ja is None:
        descricao = f"{rec.descricao} {comp:%m/%Y}"
        cob = Cobranca(cliente_id=rec.cliente_id, tipo="recorrente", recorrencia_id=rec.id, competencia=chave,
                       descricao=descricao, itens=[{"descricao": descricao, "valor": f"{rec.valor:.2f}"}],
                       valor=rec.valor, vencimento=venc if venc >= hoje else hoje + timedelta(days=PRAZO_ATRASADA),
                       status="pendente", avisos=[])
        db.add(cob)
    rec.geradas = (rec.geradas or 0) + 1
    rec.proxima_competencia = somar_meses(comp, PASSO[rec.periodicidade])
    if _ocorrencia(rec, rec.proxima_competencia, rec.geradas) is None:
        _concluir(rec)
    db.flush()
    return cob


def _concluir(rec: CobrancaRecorrente) -> None:
    rec.status, rec.encerrada_em = "concluida", agora()


def enviar_nova(db, cob: Cobranca, hoje: date, regua: list[int]) -> None:
    """Link + e-mail da cobrança que acabou de nascer. Sem e-mail do financeiro ela existe do mesmo jeito e fica
    marcada como não enviada; os passos da régua que já venceram hoje contam como feitos (um e-mail só)."""
    cobranca.criar_link(db, cob)
    if not cob.cliente.email_financeiro:
        cob.envio_erro = cobranca.SEM_EMAIL
    else:
        try:
            cobranca.enviar_cobranca(db, cob)
        except Exception as e:  # noqa: BLE001 — a cobrança vale; a régua tenta o e-mail de novo amanhã
            log.warning("Cobrança recorrente %s gerada, mas o e-mail não saiu: %s", cob.id, e)
            cob.envio_erro = f"o e-mail não saiu: {e}"[:200]
    cob.avisos = sorted(p for p in regua if hoje >= cob.vencimento + timedelta(days=p))


def rotina(db, hoje: date, regua: list[int]) -> int:
    """Chamado pela rotina diária: gera e envia o que chegou na data. Pode rodar várias vezes no dia."""
    feitas = 0
    ids = db.scalars(select(CobrancaRecorrente.id).join(Cliente).where(
        CobrancaRecorrente.status == "ativa", Cliente.status != "inativo", Cliente.tipo != "mayacorp")
        .order_by(CobrancaRecorrente.id)).all()
    for rid in ids:
        for _ in range(TETO_POR_DIA):
            if feitas >= TETO_POR_RODADA:
                log.warning("Cobranças recorrentes: teto de %s por rodada atingido; o resto sai na próxima.", TETO_POR_RODADA)
                return feitas
            try:
                rec = db.get(CobrancaRecorrente, rid)
                no_dia = (rec.rotina_no_dia or 0) if rec.rotina_dia == hoje else 0
                if no_dia >= TETO_POR_DIA:
                    break
                cob = gerar(db, rec, hoje)
                if cob is None:
                    db.commit()  # pode ter concluído a recorrência
                    break
                rec.rotina_dia, rec.rotina_no_dia = hoje, no_dia + 1
                enviar_nova(db, cob, hoje, regua)
                db.commit()
                feitas += 1
            except Exception:
                db.rollback()
                log.exception("Cobrança recorrente %s falhou", rid)
                break
    return feitas


def receita_mensal(db) -> Decimal:
    """Soma das recorrências ativas, cada uma trazida para o mês (anual ÷ 12, trimestral ÷ 3…)."""
    total = Decimal(0)
    q = select(CobrancaRecorrente).join(Cliente).where(CobrancaRecorrente.status == "ativa", Cliente.status != "inativo")
    for rec in db.scalars(q):
        total += Decimal(rec.valor) / PASSO[rec.periodicidade]
    return total.quantize(Decimal("0.01"))
