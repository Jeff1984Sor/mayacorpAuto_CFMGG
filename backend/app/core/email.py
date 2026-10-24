"""Envio de e-mail. Sem SMTP configurado, grava a mensagem em storage/outbox (modo dev)."""

import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path

from app.core.config import settings
from app.core.db import agora
from app.core.models import ConfigNotificacao
from app.core.security import decifrar

log = logging.getLogger(__name__)


def enviar(
    para: list[str],
    assunto: str,
    corpo: str,
    *,
    anexos: list[tuple[str, bytes, str]] | None = None,
    config: ConfigNotificacao | None = None,
) -> None:
    msg = EmailMessage()
    remetente = settings.smtp_from
    if config:
        remetente = f"{config.remetente_nome} <{config.remetente_email}>"
    msg["From"] = remetente
    msg["To"] = ", ".join(para)
    msg["Subject"] = assunto
    msg.set_content(corpo)
    for nome, dados, mime in anexos or []:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(dados, maintype=maintype, subtype=subtype, filename=nome)

    host = (config and config.smtp_host) or settings.smtp_host
    if not host:
        outbox = Path(settings.storage_dir) / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        arq = outbox / f"{agora():%Y%m%d-%H%M%S-%f}.eml"
        arq.write_bytes(bytes(msg))
        log.info("E-mail gravado em %s (SMTP não configurado)", arq)
        return

    porta = config.smtp_porta if config and config.smtp_host else settings.smtp_port
    usuario = (config and config.smtp_usuario) or settings.smtp_user
    senha = settings.smtp_password
    if config and config.smtp_senha_cifrada:
        senha = decifrar(config.smtp_senha_cifrada).decode()
    with smtplib.SMTP(host, porta, timeout=30) as s:
        s.starttls()
        if usuario and senha:
            s.login(usuario, senha)
        s.send_message(msg)
