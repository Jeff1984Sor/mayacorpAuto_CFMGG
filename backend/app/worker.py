"""Worker de produção (systemd `mayacorp-worker`): processa a fila de lotes, a fila dos tribunais e as rotinas diárias.

A fila mora no próprio banco (lote.status = na_fila), então não depende de broker: se o worker
reiniciar, retoma de onde parou. Rodar: `python -m app.worker`.
"""

import logging
import signal
import time
from datetime import date, datetime

from sqlalchemy import select

import app.comunicador.models  # noqa: F401  (registra todos os modelos: Processo aponta para Caso)
import app.controle.sincronia  # noqa: F401  (catálogo de logins do controle)
import app.core.models  # noqa: F401
import app.modules.faturamento.models  # noqa: F401
import app.modules.financas.models  # noqa: F401
from app.core import tenancy
from app.core.db import SessionLocal
from app.modules.rpa_nfse import service, tasks
from app.modules.rpa_nfse.models import Lote, StatusLote
from app.modules.tribunais import jobs as tribunais_jobs

log = logging.getLogger("worker")
_parar = False


def _sinal(*_):
    global _parar
    _parar = True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # o httpx loga a URL completa de cada chamada
    signal.signal(signal.SIGTERM, _sinal)
    signal.signal(signal.SIGINT, _sinal)
    iniciados: set[str] = set()
    ultimo_diario: dict[str, date] = {}
    log.info("Worker iniciado")
    while not _parar:
        for esc in _escritorios():
            if _parar:
                break
            chave = esc.slug if esc else ""
            try:
                with tenancy.usando(esc):
                    if chave not in iniciados:  # primeira volta do escritório: solta o que ficou preso
                        with SessionLocal() as db:
                            service.liberar_presos(db)
                        tribunais_jobs.liberar_presos()
                        iniciados.add(chave)
                    _ciclo(chave, ultimo_diario)
            except Exception:  # um escritório com problema não para os outros
                log.exception("Ciclo do escritório %s falhou", chave or "principal")
        _cobranca_do_dia(ultimo_diario)
        time.sleep(3)
    log.info("Worker encerrado")


def _cobranca_do_dia(ultimo_diario: dict[str, date]) -> None:
    """Uma vez por dia, a partir das 8h: mensalidades dos clientes do MayaJus e e-mails da régua (Mercado Pago)."""
    if not tenancy.multi() or ultimo_diario.get("@cobranca") == date.today() or datetime.now().hour < 8:
        return
    ultimo_diario["@cobranca"] = date.today()
    from app.controle import cobranca

    try:
        log.info("Cobrança do dia: %s", cobranca.rotina_diaria())
    except Exception:
        log.exception("Cobrança do dia falhou")


def _escritorios() -> list:
    """Um banco só: [None]. Um banco por escritório: os escritórios ativos do controle (relidos a cada volta)."""
    if not tenancy.multi():
        return [None]
    from app.controle import service as controle

    return controle.ativos()


def _ciclo(chave: str, ultimo_diario: dict[str, date]) -> None:
    with SessionLocal() as db:
        ids = list(db.scalars(select(Lote.id).where(Lote.status == StatusLote.na_fila).order_by(Lote.id)))
    for lote_id in ids:
        if _parar:
            return
        log.info("Processando lote %s (%s)", lote_id, chave or "principal")
        tasks._rodar(lote_id)
    try:  # fila dos tribunais (varredura, importação, protocolo, avisos)
        tribunais_jobs.rodar_fila(limite=20)
    except Exception:
        log.exception("Fila dos tribunais falhou")
    if ultimo_diario.get(chave) != date.today():
        tasks.alertar_certificados()
        try:
            tribunais_jobs.rotina_diaria()
        except Exception:
            log.exception("Rotina diária dos tribunais falhou")
        ultimo_diario[chave] = date.today()


if __name__ == "__main__":
    main()
