"""E-mail da nota: compositor (Para/Cc/Cco, texto editável, anexos) e envio em lote personalizado por nota."""

import email
import email.policy
from pathlib import Path

from app.core.config import settings
from app.modules.rpa_nfse import parser_txt
from tests.conftest import detalhe
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


def _caixa():
    pasta = Path(settings.storage_dir) / "outbox"
    return set(pasta.glob("*.eml")) if pasta.exists() else set()


def _ler(arquivos):
    return [email.message_from_bytes(p.read_bytes(), policy=email.policy.default) for p in arquivos]


def _emitir(c, h, numeros, **kw):
    emissora = c.get("/api/nfse/emissoras", headers=h).json()[0]
    arq = parser_txt.gerar_arquivo("12345678", [detalhe(n, **kw) for n in numeros])
    lote = c.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("e.txt", arq)}, data={"emissora_id": emissora["id"]}).json()
    c.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h)
    return c.get("/api/nfse/notas", headers=h, params={"lote_id": lote["id"]}).json()["itens"]


def test_compositor_nota_por_nota_com_cc_cco_e_anexos(cliente):  # noqa: F811
    h = _login(cliente)
    nota = _emitir(cliente, h, [9701])[0]
    p = cliente.get(f"/api/nfse/notas/{nota['id']}/email/previa", headers=h).json()
    assert p["para"] == ["sindico@solar.com.br"] and str(nota["numero"]) in p["assunto"]
    assert {a["tipo"] for a in p["anexos"]} == {"pdf", "xml", "fatura"}
    antes = _caixa()
    r = cliente.post(f"/api/nfse/notas/{nota['id']}/enviar-email", headers=h, json={
        "destinatarios": ["sindico@solar.com.br", "novo@solar.com.br"], "cc": ["financeiro@cfme.com.br"],
        "cco": ["arquivo@cfme.com.br"], "assunto": "Sua nota chegou", "corpo": "Texto editado pela pessoa.",
        "anexos": ["pdf"], "salvar_no_cliente": True})
    assert r.status_code == 200, r.text
    assert "salvo(s) no cadastro" in r.json()["mensagem"]
    msg = _ler(_caixa() - antes)[0]
    assert msg["Subject"] == "Sua nota chegou" and msg["Cc"] == "financeiro@cfme.com.br"
    assert "arquivo@cfme.com.br" not in str(msg["To"]) + str(msg["Cc"])  # Cco não aparece no cabeçalho
    assert [a.get_filename() for a in msg.iter_attachments()] == [f"NFSe_{nota['numero']}.pdf"]
    hist = cliente.get(f"/api/nfse/notas/{nota['id']}/email/previa", headers=h).json()["envios"][0]
    assert hist["cco"] == ["arquivo@cfme.com.br"] and hist["usuario_nome"]
    assert "novo@solar.com.br" in cliente.get(f"/api/nfse/tomadores/{nota['tomador_id']}", headers=h).json()["emails"]


def test_envio_em_lote_personaliza_cada_nota(cliente):  # noqa: F811
    h = _login(cliente)
    notas = _emitir(cliente, h, [9711, 9712]) + _emitir(cliente, h, [9713], email="", doc="19131243000197", nome="SEM EMAIL LTDA")
    modelo = cliente.get("/api/nfse/notas/email/modelo", headers=h).json()
    assert "{numero_nota}" in modelo["assunto_modelo"] and "vencimento" in modelo["variaveis"]
    antes = _caixa()
    r = cliente.post("/api/nfse/notas/enviar-emails", headers=h, json={
        "ids": [n["id"] for n in notas], "cc": ["financeiro@cfme.com.br"],
        "assunto_modelo": "NFS-e {numero_nota} — vence {vencimento}", "corpo_modelo": "Olá {nome_tomador}, valor {valor}.",
        "anexos": ["pdf", "fatura"]}).json()
    assert r["total"] == 3 and r["enviados"] == 2 and len(r["sem_email"]) == 1
    msgs = _ler(_caixa() - antes)
    assuntos = sorted(str(m["Subject"]) for m in msgs)
    assert all("{" not in a for a in assuntos) and len(assuntos) == 2
    assert {str(n["numero"]) for n in notas[:2]} == {a.split()[1] for a in assuntos}
    # "pular as já enviadas" evita mandar de novo
    r = cliente.post("/api/nfse/notas/enviar-emails", headers=h, json={
        "ids": [n["id"] for n in notas[:2]], "assunto_modelo": "x {numero_nota}", "corpo_modelo": "yy", "pular_ja_enviadas": True}).json()
    assert r["enviados"] == 0 and r["puladas"] == 2


def test_envio_em_lote_por_filtro(cliente):  # noqa: F811
    h = _login(cliente)
    notas = _emitir(cliente, h, [9721, 9722])
    lote_id = cliente.get(f"/api/nfse/notas/{notas[0]['id']}", headers=h).json()["lote_id"]
    r = cliente.post("/api/nfse/notas/enviar-emails", headers=h, json={
        "filtro": {"lote_id": lote_id}, "assunto_modelo": "NFS-e {numero_nota}", "corpo_modelo": "Segue."}).json()
    assert r["total"] == 2 and r["enviados"] == 2


def test_email_com_logo_do_escritorio(tmp_path):
    from email import message_from_bytes

    from app.core import email as mail
    from app.core.config import settings
    from app.core.db import SessionLocal
    from app.core.models import ConfigNotificacao, Identidade, Tenant

    logo = tmp_path / "logo.png"
    logo.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    with SessionLocal() as db:
        tid = db.query(Tenant).first().id
        ident = db.get(Identidade, tid)
        antigo = ident.logo_path
        ident.logo_path = str(logo)
        cfg = db.get(ConfigNotificacao, tid) or ConfigNotificacao(tenant_id=tid)
        db.add(cfg)
        cfg.email_logo, cfg.smtp_host = True, None
        db.flush()
        outbox = Path(settings.storage_dir) / "outbox"
        antes = set(outbox.glob("*.eml")) if outbox.exists() else set()
        mail.enviar(["cliente@exemplo.com"], "Teste", "Olá!\nVeja https://exemplo.com", config=cfg)
        novo = (set(outbox.glob("*.eml")) - antes).pop()
        m = message_from_bytes(novo.read_bytes())
        tipos = [p.get_content_type() for p in m.walk()]
        assert "text/plain" in tipos and "text/html" in tipos and "image/png" in tipos
        html = next(p for p in m.walk() if p.get_content_type() == "text/html").get_payload(decode=True).decode()
        assert "cid:logo-escritorio" in html and 'href="https://exemplo.com"' in html
        ident.logo_path, cfg.email_logo = antigo, False
        db.commit()
