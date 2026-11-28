"""O PDF guardado da nota do Sistema Nacional (o DANFSe) e quando ele é refeito.

O arquivo fica sempre em `nota.pdf_path`. Ao lado dele vai um `<arquivo>.pdf.json` dizendo o que está guardado:
em que desenho, se a nota já estava cancelada, se é o PDF que veio do governo e quando foi a última tentativa.

- O DANFSe é desenhado pelo próprio sistema no leiaute oficial (`danfse_pdf.py`, Nota Técnica SE/CGNFS-e nº 008),
  a partir do XML autorizado. Ele é refeito sozinho quando o desenho muda (`pdf.LAYOUT_NACIONAL`) e quando a
  nota é cancelada (ganha a marca "CANCELADA").
- A API do governo que devolvia o DANFSe pronto foi suspensa em 03/08/2026 (mesma nota técnica), por isso a
  busca vem desligada (`BUSCAR_OFICIAL`). O caminho continua aqui, testado com cliente simulado: religado, só
  nota de produção tenta, no máximo uma vez a cada `INTERVALO`, e qualquer falha deixa o PDF do sistema.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.modules.rpa_nfse.models import Nfse

log = logging.getLogger(__name__)

BUSCAR_OFICIAL = False  # a API do DANFSe foi suspensa pelo governo em 03/08/2026
INTERVALO = timedelta(hours=24)


def _ficha(pdf_path: str | Path) -> Path:
    return Path(f"{pdf_path}.json")


def estado(pdf_path: str | Path) -> dict:
    """{"oficial": bool, "layout": int, "cancelada": bool, "tentado_em": iso}; {} para PDF guardado antes da ficha."""
    try:
        dados = json.loads(_ficha(pdf_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return dados if isinstance(dados, dict) else {}


def _anotar(pdf_path: str | Path, **mudou) -> None:
    _ficha(pdf_path).write_text(json.dumps({**estado(pdf_path), **mudou}), encoding="utf-8")


def _cancelada(nota: Nfse) -> bool:
    return str(getattr(nota, "status", "") or "") == "cancelada"


def _pode_tentar(nota: Nfse, est: dict, agora: datetime) -> bool:
    if not BUSCAR_OFICIAL or nota.simulada or not nota.chave_acesso:
        return False
    try:
        ultima = datetime.fromisoformat(est.get("tentado_em") or "")
    except ValueError:
        return True
    return agora - ultima >= INTERVALO


def gravar_do_sistema(db, nota: Nfse) -> None:
    """Desenha o DANFSe (a partir do XML autorizado) e guarda em `nota.pdf_path`."""
    from app.core.models import Identidade
    from app.modules.rpa_nfse import pdf
    from app.modules.rpa_nfse.nfse_nacional.emissao import link

    Path(nota.pdf_path).write_bytes(pdf.gerar(nota, db.get(Identidade, nota.tenant_id), link(nota.chave_acesso)))
    _anotar(nota.pdf_path, oficial=False, layout=pdf.LAYOUT_NACIONAL, cancelada=_cancelada(nota))


def buscar_oficial(nota: Nfse, cliente, agora: datetime | None = None) -> bool:
    """Tenta trocar o PDF guardado pelo DANFSe do governo. Devolve True se trocou; a tentativa fica anotada."""
    agora = agora or datetime.now(UTC)
    if not nota.pdf_path or not _pode_tentar(nota, estado(nota.pdf_path), agora):
        return False
    conteudo = cliente.danfse(nota.chave_acesso)  # None em qualquer falha (já registrada no log)
    if conteudo:
        Path(nota.pdf_path).write_bytes(conteudo)
        _anotar(nota.pdf_path, cancelada=_cancelada(nota))
    _anotar(nota.pdf_path, oficial=bool(conteudo), tentado_em=agora.isoformat())
    return bool(conteudo)


def _cliente_de_producao(db, nota: Nfse):
    """Cliente com o certificado da emissora, só no servidor de produção (cópia do banco em outro lugar não chama)."""
    from app.core import certificados
    from app.core.models import Certificado
    from app.modules.rpa_nfse import service
    from app.modules.rpa_nfse.nfse_nacional.cliente import ClienteNacional

    if "producao" not in service.modos_permitidos() or not nota.emissora.certificado_id:
        return None
    cert = db.get(Certificado, nota.emissora.certificado_id)
    return ClienteNacional(certificados.abrir(cert), "producao") if cert else None


def atualizar(db, nota: Nfse, *, cliente=None, oficial: bool = True, agora: datetime | None = None) -> None:
    """Chamado antes de entregar o PDF (download, anexo de e-mail, ZIP). Nunca levanta erro: na dúvida, fica o que há.

    `oficial=False` nunca chama o governo: só refaz o PDF que estiver desatualizado.
    """
    if not nota.chave_acesso or not nota.pdf_path:
        return
    try:
        from app.modules.rpa_nfse import pdf

        agora = agora or datetime.now(UTC)
        est = estado(nota.pdf_path)
        existe = Path(nota.pdf_path).exists()
        mudou_a_situacao = bool(est.get("cancelada")) != _cancelada(nota)  # cancelada depois de o PDF ser guardado
        if est.get("oficial") and existe and not mudou_a_situacao:
            return
        if oficial and _pode_tentar(nota, est, agora):
            cliente = cliente or _cliente_de_producao(db, nota)
            if cliente is not None and buscar_oficial(nota, cliente, agora):
                return
        if not existe or mudou_a_situacao or est.get("oficial") or est.get("layout") != pdf.LAYOUT_NACIONAL:
            gravar_do_sistema(db, nota)
    except Exception:  # noqa: BLE001 — o PDF é um extra: falha aqui nunca derruba o download nem o e-mail
        log.warning("Não consegui atualizar o PDF da nota %s; fica o que está guardado.", nota.chave_acesso, exc_info=True)
