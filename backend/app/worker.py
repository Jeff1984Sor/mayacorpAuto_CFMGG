"""Worker de produção (systemd `mayacorp-worker`): processa a fila de lotes e as rotinas diárias.

A fila mora no próprio banco (lote.status = na_fila), então não depende de broker: se o worker
reiniciar, retoma de onde parou. Rodar: `python -m app.worker`.
"""

import logging
import signal
import time
from datetime import date

from sqlalchemy import select

from app.core.db import SessionLocal
from app.modules.rpa_nfse import service, tasks
from app.modules.rpa_nfse.models import Lote, StatusLote

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
        if ultimo_diario != date.today():
            tasks.alertar_certificados()
            ultimo_diario = date.today()
        time.sleep(3)
    log.info("Worker encerrado")


if __name__ == "__main__":
    main()
