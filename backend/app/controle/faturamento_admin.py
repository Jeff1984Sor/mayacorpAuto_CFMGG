"""Faturamento do painel MayaCorp: os serviços cobrados dos clientes do admin são REGRAS DE COBRANÇA do módulo de
faturamento (as mesmas dos escritórios), no banco do admin. O caminho é um só: regra no cliente → Faturamento ›
Itens a faturar → fatura → NFS-e.

- O banco do admin trabalha sem a figura do contrato (`fat_config.usa_contrato = False`): as regras ficam direto no
  cliente, no contrato único criado por trás (`faturamento.service.contrato_do_cliente`).
- As "cobranças recorrentes" do controle (tabela `cobranca_recorrente`, que geravam cobrança com link do Mercado
  Pago) foram desligadas: cada uma ativa ou pausada vira uma regra recorrente (`migrar_recorrencias`) e fica marcada
  como "migrada", com o id da regra. A tabela e as cobranças que ela já gerou ficam como histórico.
- O admin ganha o emissor de NFS-e (`robos` com "nfse_lote"), senão a tela do lote da fatura abre "Sem acesso".
- `preparar()` roda no migrar de todo deploy, depois de `cadastro.ligar_todos()`; tudo aqui é idempotente.
"""

import calendar
import logging
from datetime import date

from sqlalchemy import func, select

from app.controle.models import Cliente, CobrancaRecorrente, SessaoControle
from app.core.db import agora

log = logging.getLogger(__name__)

PASSO = {"mensal": 1, "bimestral": 2, "trimestral": 3, "semestral": 6, "anual": 12}  # meses entre as cobranças
EMISSOR = "nfse_lote"  # chave de planos.ROBOS: libera as telas de NFS-e (lote, notas emitidas)
TEXTO_SERVICO = "Serviços prestados"  # 1ª linha da fatura e da nota no painel (nos escritórios: "Honorários advocatícios")


def somar_meses(d: date, n: int) -> date:
    total = d.year * 12 + (d.month - 1) + n
    return date(total // 12, total % 12 + 1, 1)


def vencimento_de(dia: int, competencia: date) -> date:
    """dia 0 = último dia do mês."""
    ultimo = calendar.monthrange(competencia.year, competencia.month)[1]
    return competencia.replace(day=ultimo if dia == 0 else min(dia, ultimo))


def proxima(rec: CobrancaRecorrente) -> tuple[date, date] | None:
    """(competência, vencimento) da próxima cobrança que a recorrência ainda NÃO gerou; None se ela chegou ao fim."""
    venc = vencimento_de(rec.dia_vencimento, rec.proxima_competencia)
    if rec.termino_tipo == "data" and rec.termino_data and venc > rec.termino_data:
        return None
    if rec.termino_tipo == "quantidade" and rec.termino_quantidade is not None and (rec.geradas or 0) >= rec.termino_quantidade:
        return None
    return rec.proxima_competencia, venc


def _marca(rec: CobrancaRecorrente) -> str:
    return f"Veio da cobrança recorrente nº {rec.id} do painel (Mercado Pago)."


def sem_contratos(db, tenant_id: int) -> bool:
    """Põe o banco do admin no modo "sem contratos" (uma vez). Se ele já tiver contratos, não força: só avisa."""
    from app.modules.faturamento.models import ConfigFaturamento, Contrato
    from app.modules.rpa_nfse.service import config_nfse

    cfg = db.get(ConfigFaturamento, tenant_id)
    if cfg is not None and not cfg.usa_contrato:
        return True
    n = db.scalar(select(func.count(Contrato.id)).where(Contrato.tenant_id == tenant_id)) or 0
    if n:
        log.warning("Painel MayaCorp: o banco do admin já tem %s contrato(s); o modo sem contratos NÃO foi ligado "
                    "sozinho. Ligue em Configurações › Faturamento depois de conferir.", n)
        return False
    if cfg is None:
        cfg = ConfigFaturamento(tenant_id=tenant_id)
        db.add(cfg)
    cfg.usa_contrato = False
    # só nesta virada (depois vale o que for escolhido nas telas): a fatura e a nota levam o texto da regra de
    # cobrança ("Geração de Documentos") debaixo de "Serviços prestados", e não "Honorários advocatícios"
    if cfg.texto_servico is None:
        cfg.texto_servico = TEXTO_SERVICO
    config_nfse(db, tenant_id).nota_texto_regra = True
    db.flush()
    log.info("Painel MayaCorp: faturamento sem contratos ligado no banco do admin.")
    return True


def migrar_recorrencias(ctl, db, tenant_id: int) -> list[int]:
    """Cada recorrência ativa ou pausada do controle vira uma regra recorrente no contrato único do cliente, só com
    as competências que ela ainda não gerou. Devolve os ids das regras criadas. Dá commit uma a uma (primeiro a regra,
    depois a marca no controle); se cair no meio, a próxima rodada acha a regra pela marca e não cria outra."""
    from app.controle import cadastro
    from app.modules.faturamento import service as fat
    from app.modules.faturamento.models import Frequencia, RegraCobranca, Termino, TipoRegra

    criadas = []
    recs = list(ctl.scalars(select(CobrancaRecorrente).where(CobrancaRecorrente.status.in_(("ativa", "pausada")))
                            .order_by(CobrancaRecorrente.id)))
    for rec in recs:
        c: Cliente = rec.cliente
        prox = proxima(rec)
        if prox is None:  # já tinha gerado tudo: não há o que levar
            rec.status, rec.encerrada_em = "concluida", agora()
            ctl.commit()
            continue
        t = cadastro.ligar(db, tenant_id, c)
        if t is None:
            log.warning("Cobrança recorrente %s (%s, %s): o cliente não tem cadastro ligado (%s). NÃO foi migrada e "
                        "não gera mais cobrança: complete o cadastro e rode o migrar de novo, ou crie a regra na ficha.",
                        rec.id, c.nome, rec.descricao, cadastro.conflito(db, tenant_id, c) or "sem cadastro")
            db.rollback()
            ctl.rollback()
            continue
        regra = db.scalar(select(RegraCobranca).where(RegraCobranca.tenant_id == tenant_id,
                                                      RegraCobranca.observacao.like(_marca(rec) + "%")))
        if regra is None:
            comp, venc = prox
            contrato = fat.contrato_do_cliente(db, tenant_id, t.id, criar=True)
            anual = rec.periodicidade == "anual"
            regra = RegraCobranca(
                tenant_id=tenant_id, contrato_id=contrato.id, caso_id=None, tipo=TipoRegra.recorrente,
                descricao=rec.descricao, valor=rec.valor, data_inicio=venc,
                frequencia=Frequencia.anual if anual else Frequencia.mensal, intervalo=1 if anual else PASSO[rec.periodicidade],
                termino=Termino.sem, ativo=rec.status == "ativa",
                observacao=" ".join(x for x in (_marca(rec), rec.observacao) if x))
            if rec.termino_tipo == "data" and rec.termino_data:
                regra.termino, regra.data_fim = Termino.data, rec.termino_data
            elif rec.termino_tipo == "quantidade" and rec.termino_quantidade:
                regra.termino, regra.ocorrencias = Termino.ocorrencias, rec.termino_quantidade - (rec.geradas or 0)
            db.add(regra)
            db.flush()
            criadas.append(regra.id)
            log.info("Cobrança recorrente %s (%s: %s, %s) virou a regra de cobrança %s, a partir de %s%s.", rec.id, c.nome,
                     rec.descricao, rec.valor, regra.id, f"{venc:%d/%m/%Y}", "" if regra.ativo else " (pausada: regra inativa)")
        if c.status == "inativo":  # o motor antigo não cobrava cliente inativo: a regra espera ele ser reativado
            cobrar_cliente(db, tenant_id, t.id, False)
        db.commit()  # primeiro a regra e o cadastro
        nota = (f"Migrada em {date.today():%d/%m/%Y} para a regra de cobrança nº {regra.id} do faturamento "
                f"(estava {rec.status}; próxima competência {rec.proxima_competencia:%m/%Y}).")
        rec.status, rec.regra_id, rec.encerrada_em = "migrada", regra.id, agora()
        rec.observacao = "\n".join(x for x in (rec.observacao, nota) if x)
        ctl.commit()
    return criadas


def cobrar_cliente(db, tenant_id: int, tomador_id: int | None, ativo: bool) -> int:
    """Cliente inativado ou excluído no admin para de aparecer em Itens a faturar (e volta ao ser reativado): liga ou
    desliga o contrato único dele. `db` é a sessão do banco do admin; quem chama dá o commit."""
    from app.modules.faturamento.models import Contrato

    if not tomador_id:
        return 0
    n = 0
    for k in db.scalars(select(Contrato).where(Contrato.tenant_id == tenant_id, Contrato.tomador_id == tomador_id,
                                               Contrato.ativo != ativo)):
        k.ativo = ativo
        n += 1
    return n


def liberar_emissor(ctl) -> bool:
    """A NFS-e da fatura sai pela tela do lote (NFS-e › Nova emissão), que só abre para quem tem o emissor liberado.
    O painel é da própria MayaCorp e não aparece na lista de clientes para alguém liberar: fica liberado aqui."""
    from app.controle import service

    c = ctl.scalar(select(Cliente).where(Cliente.tipo == "mayacorp"))
    if c is None or EMISSOR in (c.robos or []):
        return False
    c.robos = [*(c.robos or []), EMISSOR]
    ctl.commit()
    service.limpar_cache()
    log.info("Painel MayaCorp: emissor de NFS-e liberado para o admin (para emitir a nota das faturas).")
    return True


def preparar() -> dict:
    """Deploy/subida: banco do admin sem contratos, com o emissor de NFS-e, e as recorrências antigas viram regras."""
    from app.controle import service
    from app.core import tenancy
    from app.core.db import SessionLocal
    from app.core.models import Tenant

    esc = service.escritorio_mayacorp()
    if esc is None:
        return {}
    with SessaoControle() as ctl, tenancy.usando(esc), SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).order_by(Tenant.id))
        if tenant_id is None:
            return {}
        liberar_emissor(ctl)
        modo = sem_contratos(db, tenant_id)
        db.commit()
        return {"sem_contratos": modo, "regras": migrar_recorrencias(ctl, db, tenant_id)}
