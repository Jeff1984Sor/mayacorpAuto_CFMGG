"""O PDF guardado da nota do Sistema Nacional: o DANFSe oficial quando o governo entrega, senão o do sistema.

O arquivo fica sempre em `nota.pdf_path`. Ao lado dele vai um `<arquivo>.pdf.json` dizendo o que está guardado
(oficial ou do sistema, em que desenho) e quando foi a última tentativa de buscar o oficial, para não bater no
governo a cada download.

- Só nota de produção tenta o oficial: em Teste (produção restrita) e na simulação o serviço não responde.
- Falhou? Fica o PDF do sistema, sem erro para quem pediu, e a nova tentativa só acontece depois de `INTERVALO`.
- PDF do sistema guardado num desenho antigo é refeito a partir do XML autorizado.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.modules.rpa_nfse.models import Nfse

log = logging.getLogger(__name__)

# Desligue aqui se o governo confirmar que a API do DANFSe saiu do ar de vez (Nota Técnica SE/CGNFS-e 008/2026).
BUSCAR_OFICIAL = True
INTERVALO = timedelta(hours=24)


def _ficha(pdf_path: str | Path) -> Path:
    return Path(f"{pdf_path}.json")


def estado(pdf_path: str | Path) -> dict:
    """{"oficial": bool, "layout": int, "tentado_em": iso}; {} para o PDF guardado antes desta ficha existir."""
    try:
        dados = json.loads(_ficha(pdf_path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return dados if isinstance(dados, dict) else {}


def _anotar(pdf_path: str | Path, **mudou) -> None:
    _ficha(pdf_path).write_text(json.dumps({**estado(pdf_path), **mudou}), encoding="utf-8")


def _pode_tentar(nota: Nfse, est: dict, agora: datetime) -> bool:
    if not BUSCAR_OFICIAL or nota.simulada or not nota.chave_acesso:
        return False
    try:
        ultima = datetime.fromisoformat(est.get("tentado_em") or "")
    except ValueError:
        return True
    return agora - ultima >= INTERVALO


def gravar_do_sistema(db, nota: Nfse) -> None:
    """Desenha o PDF do sistema (a partir do XML autorizado) e guarda em `nota.pdf_path`."""
    from app.core.models import Identidade
    from app.modules.rpa_nfse import pdf
    from app.modules.rpa_nfse.nfse_nacional.emissao import link

    Path(nota.pdf_path).write_bytes(pdf.gerar(nota, db.get(Identidade, nota.tenant_id), link(nota.chave_acesso)))
    _anotar(nota.pdf_path, oficial=False, layout=pdf.LAYOUT_NACIONAL)


def buscar_oficial(nota: Nfse, cliente, agora: datetime | None = None) -> bool:
    """Tenta trocar o PDF guardado pelo DANFSe oficial. Devolve True se trocou; a tentativa fica anotada."""
    agora = agora or datetime.now(UTC)
    if not nota.pdf_path or not _pode_tentar(nota, estado(nota.pdf_path), agora):
        return False
    conteudo = cliente.danfse(nota.chave_acesso)  # None em qualquer falha (já registrada no log)
    if conteudo:
        Path(nota.pdf_path).write_bytes(conteudo)
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
    """Chamado antes de entregar o PDF (download, anexo de e-mail). Nunca levanta erro: na dúvida, fica o que há.

    `oficial=False` só refaz o PDF do sistema que estiver num desenho antigo, sem chamar o governo.
    """
    if not nota.chave_acesso or not nota.pdf_path:
        return
    try:
        from app.modules.rpa_nfse import pdf

        agora = agora or datetime.now(UTC)
        est = estado(nota.pdf_path)
        existe = Path(nota.pdf_path).exists()
        if est.get("oficial") and existe:
            return
        if oficial and _pode_tentar(nota, est, agora):
            cliente = cliente or _cliente_de_producao(db, nota)
            if cliente is not None and buscar_oficial(nota, cliente, agora):
                return
        if not existe or est.get("layout") != pdf.LAYOUT_NACIONAL:
            gravar_do_sistema(db, nota)
    except Exception:  # noqa: BLE001 — o PDF é um extra: falha aqui nunca derruba o download nem o e-mail
        log.warning("Não consegui atualizar o PDF da nota %s; fica o que está guardado.", nota.chave_acesso, exc_info=True)
