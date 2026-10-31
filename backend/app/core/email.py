"""Envio de e-mail. Sem SMTP configurado, grava a mensagem em storage/outbox (modo dev)."""

import logging
import re
import smtplib
from email.message import EmailMessage
from pathlib import Path

from app.core import tenancy
from app.core.config import settings
from app.core.db import agora
from app.core.models import ConfigNotificacao
from app.core.security import decifrar

log = logging.getLogger(__name__)


def _versao_html(msg: EmailMessage, corpo: str, config: ConfigNotificacao) -> None:
    """Versão HTML com o logo do escritório no topo (o texto puro continua para quem não lê HTML)."""
    import html
    import mimetypes

    from sqlalchemy.orm import object_session

    from app.core.models import Identidade

    sessao = object_session(config)
    ident = sessao.get(Identidade, config.tenant_id) if sessao else None
    logo = Path(ident.logo_path) if ident and ident.logo_path else None
    if not logo or not logo.exists():
        return
    mime = mimetypes.guess_type(logo.name)[0] or "image/png"
    cor = (ident.cor_destaque if ident and ident.cor_destaque else "#1E2D6B")[:7]
    texto = html.escape(corpo).replace("\n", "<br>")
    texto = re.sub(r"(https?://[^\s<]+)", lambda m: f'<a href="{m.group(1)}" style="color:{cor}">{m.group(1)}</a>', texto)
    msg.add_alternative(
        f"""<!doctype html><html><body style="margin:0;padding:24px;background:#f7f8fc;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;
border-radius:12px;overflow:hidden;border:1px solid #e6e8f0">
<tr><td style="padding:20px 28px;border-bottom:3px solid {cor}"><img src="cid:logo-escritorio" alt="{html.escape(ident.nome_exibicao)}"
style="max-height:56px;max-width:240px;display:block"></td></tr>
<tr><td style="padding:24px 28px;color:#0f1729;font-size:14px;line-height:1.6">{texto}</td></tr>
</table></body></html>""",
        subtype="html",
    )
    maintype, subtype = mime.split("/", 1)
    msg.get_payload()[-1].add_related(logo.read_bytes(), maintype=maintype, subtype=subtype, cid="<logo-escritorio>")


def enviar(
    para: list[str],
    assunto: str,
    corpo: str,
    *,
    anexos: list[tuple[str, bytes, str]] | None = None,
    config: ConfigNotificacao | None = None,
    cc: list[str] | None = None,
    cco: list[str] | None = None,
    html: str | None = None,
    imagens: dict[str, tuple[bytes, str]] | None = None,
) -> None:
    """html: versão HTML pronta (com imagens embutidas por cid → (bytes, mime)); sem ela, só o logo opcional."""
    msg = EmailMessage()
    remetente = settings.smtp_from
    if config:
        remetente = f"{config.remetente_nome} <{config.remetente_email}>"
    msg["From"] = remetente
    msg["To"] = ", ".join(para)
    if cc:
        msg["Cc"] = ", ".join(cc)
    # Cco não vai no cabeçalho (é cópia oculta): só entra na lista de entrega
    todos = list(dict.fromkeys([*para, *(cc or []), *(cco or [])]))
    msg["Subject"] = assunto
    msg.set_content(corpo)
    if html:
        msg.add_alternative(html, subtype="html")
        for cid, (dados, mime) in (imagens or {}).items():
            maintype, subtype = mime.split("/", 1)
            msg.get_payload()[-1].add_related(dados, maintype=maintype, subtype=subtype, cid=f"<{cid}>")
    elif config is not None and config.email_logo:
        _versao_html(msg, corpo, config)
    for nome, dados, mime in anexos or []:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(dados, maintype=maintype, subtype=subtype, filename=nome)

    host = (config and config.smtp_host) or settings.smtp_host
    if not host:
        outbox = tenancy.pasta_base() / "outbox"
        outbox.mkdir(parents=True, exist_ok=True)
        arq = outbox / f"{agora():%Y%m%d-%H%M%S-%f}.eml"
        oculto = f"\n\n[Cco (oculto): {', '.join(cco)}]".encode() if cco else b""
        arq.write_bytes(bytes(msg) + oculto)
        log.info("E-mail gravado em %s (SMTP não configurado)", arq)
        return

    porta = config.smtp_porta if config and config.smtp_host else settings.smtp_port
    usuario = (config and config.smtp_usuario) or settings.smtp_user
    senha = settings.smtp_password
    if config and config.smtp_senha_cifrada:
        senha = decifrar(config.smtp_senha_cifrada).decode()
    # 465 = SSL direto (padrão da GoDaddy/secureserver); outras portas = STARTTLS
    conexao = smtplib.SMTP_SSL(host, porta, timeout=30) if porta == 465 else smtplib.SMTP(host, porta, timeout=30)
    with conexao as s:
        if porta != 465:
            s.starttls()
        if usuario and senha:
            s.login(usuario, senha)
        s.send_message(msg, to_addrs=todos)
