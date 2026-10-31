"""Worker de produção (systemd `mayacorp-worker`): processa a fila de lotes, a fila dos tribunais e as rotinas diárias.

A fila mora no próprio banco (lote.status = na_fila), então não depende de broker: se o worker
reiniciar, retoma de onde parou. Rodar: `python -m app.worker`.
"""

import logging
import signal
import time
from datetime import date

from sqlalchemy import select

import app.comunicador.models  # noqa: F401  (registra todos os modelos: Processo aponta para Caso)
import app.core.models  # noqa: F401
import app.modules.faturamento.models  # noqa: F401
import app.modules.financas.models  # noqa: F401
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
    with SessionLocal() as db:
        service.liberar_presos(db)
    tribunais_jobs.liberar_presos()
    ultimo_diario: date | None = None
    log.info("Worker iniciado")
    while not _parar:
        with SessionLocal() as db:
            ids = list(db.scalars(select(Lote.id).where(Lote.status == StatusLote.na_fila).order_by(Lote.id)))
        for lote_id in ids:
            if _parar:
                break
            log.info("Processando lote %s", lote_id)
            tasks._rodar(lote_id)
        try:  # fila dos tribunais (varredura, importação, protocolo, avisos)
            tribunais_jobs.rodar_fila(limite=20)
        except Exception:
            log.exception("Fila dos tribunais falhou")
        if ultimo_diario != date.today():
            tasks.alertar_certificados()
            try:
                tribunais_jobs.rotina_diaria()
            except Exception:
                log.exception("Rotina diária dos tribunais falhou")
            ultimo_diario = date.today()
        time.sleep(3)
    log.info("Worker encerrado")


if __name__ == "__main__":
    main()
