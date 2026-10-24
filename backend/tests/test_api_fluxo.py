"""Fluxo completo pela API, no modo simulado: do upload do arquivo da Lello até o ZIP das notas."""

import pytest
from fastapi.testclient import TestClient

from app.modules.rpa_nfse import parser_txt, tasks
from tests.conftest import detalhe


@pytest.fixture(scope="module")
def cliente():
    from app import seed
    from app.main import app

    seed.main()
    tasks.enfileirar_job = tasks.processar_lote  # síncrono nos testes
    from app.modules.rpa_nfse import routes

    routes.tasks.enfileirar_job = tasks.processar_lote
    with TestClient(app) as c:
        yield c


def _login(c, email="admin@cfme.com.br"):
    r = c.post("/api/auth/login", json={"email": email, "senha": "Cfme@2026"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_login_errado_e_bloqueio(cliente):
    for _ in range(5):
        r = cliente.post("/api/auth/login", json={"email": "operador@cfme.com.br", "senha": "errada"})
    assert r.status_code == 401
    r = cliente.post("/api/auth/login", json={"email": "operador@cfme.com.br", "senha": "Cfme@2026"})
    assert r.status_code == 429


def test_fluxo_emissao(cliente):
    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    arquivo = parser_txt.gerar_arquivo("12345678", [detalhe(5001), detalhe(5002, doc="11444777000199"), detalhe(5003, discriminacao="[REJEITAR] teste")])
    r = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("lote.txt", arquivo)}, data={"emissora_id": emissora["id"]})
    assert r.status_code == 200, r.text
    lote = r.json()
    assert lote["resumo"]["qtd"] == 3 and lote["resumo"]["com_erro"] == 1
    rps_erro = next(x for x in lote["rps"] if x["status"] == "erro")
    assert not rps_erro["selecionado"]

    r = cliente.patch(f"/api/nfse/importacoes/{lote['id']}/rps/{rps_erro['id']}", headers=h,
                      json={"tomador": {"cpf_cnpj": "11444777000161"}, "selecionado": True})
    assert r.json()["rps"]["status"] in ("ok", "aviso") and r.json()["resumo"]["pode_emitir"]

    r = cliente.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h)
    assert r.status_code == 200, r.text
    det = cliente.get(f"/api/nfse/lotes/{lote['id']}", headers=h).json()
    assert det["status"] == "parcial" and det["qtd_emitidas"] == 2 and det["qtd_rejeitadas"] == 1
    rej = next(x for x in det["rps"] if x["status"] == "rejeitado")
    assert rej["erros"][-1]["codigo"] == 1211 and rej["erros"][-1]["acao"]

    # corrige o rejeitado e reprocessa só ele
    cliente.patch(f"/api/nfse/importacoes/{lote['id']}/rps/{rej['id']}", headers=h, json={"discriminacao": "Honorarios"})
    r = cliente.post(f"/api/nfse/lotes/{lote['id']}/reprocessar-rejeitados", headers=h)
    assert r.status_code == 200, r.text
    det = cliente.get(f"/api/nfse/lotes/{lote['id']}", headers=h).json()
    assert det["status"] == "concluido" and det["qtd_emitidas"] == 3

    notas = cliente.get("/api/nfse/notas", headers=h, params={"lote_id": lote["id"]}).json()
    assert notas["total"] == 3
    nid = notas["itens"][0]["id"]
    assert cliente.get(f"/api/nfse/notas/{nid}/pdf", headers=h).content[:5] == b"%PDF-"
    assert b"NFSeEmitida" in cliente.get(f"/api/nfse/notas/{nid}/xml", headers=h).content
    z = cliente.post("/api/nfse/notas/zip", headers=h, json={"lote_id": lote["id"]})
    assert z.headers["content-type"] == "application/zip"

    # idempotência: o mesmo arquivo de novo não emite nada
    r = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("lote.txt", arquivo)}, data={"emissora_id": emissora["id"]}).json()
    assert r["resumo"]["com_erro"] == 3 and not r["resumo"]["pode_emitir"]
    assert r["rps"][0]["erros"][0]["nfse_id"]


def test_arquivo_de_outro_emissor(cliente):
    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    arquivo = parser_txt.gerar_arquivo("99999999", [detalhe(7001)])
    r = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("x.txt", arquivo)}, data={"emissora_id": emissora["id"]})
    assert r.status_code == 400 and "outro emissor" in r.json()["detail"]


def test_perfis_no_backend(cliente):
    h = _login(cliente, "visualizador@cfme.com.br")
    assert cliente.get("/api/nfse/notas", headers=h).status_code == 200
    assert cliente.post("/api/nfse/notas/1/cancelar", headers=h, json={"motivo": "teste de permissão"}).status_code == 403
    assert cliente.get("/api/config/usuarios", headers=h).status_code == 403


def test_auditoria_imutavel(cliente):
    from app.core.db import SessionLocal
    from app.core.models import Auditoria

    with SessionLocal() as db:
        a = db.query(Auditoria).first()
        a.descricao = "adulterado"
        with pytest.raises(PermissionError):
            db.commit()


def test_raio_x_aponta_dobro_e_valor_atipico(cliente):
    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    # histórico: 3 notas do mesmo cliente a R$ 1.000
    hist = parser_txt.gerar_arquivo("12345678", [detalhe(8001 + i, valor="1000.00") for i in range(3)])
    lote = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("h.txt", hist)},
                        data={"emissora_id": emissora["id"]}).json()
    cliente.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h)
    # novo arquivo: um valor repetido (dobro) e um 5x acima do padrão
    novo = parser_txt.gerar_arquivo("12345678", [detalhe(8101, valor="1000.00"), detalhe(8102, valor="5000.00")])
    lote2 = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("n.txt", novo)},
                         data={"emissora_id": emissora["id"]}).json()
    rx = cliente.get(f"/api/nfse/importacoes/{lote2['id']}/raio-x", headers=h).json()
    tipos = {i["tipo"] for i in rx["insights"]}
    assert {"duplicidade", "valor_atipico"} <= tipos
    assert 0 <= rx["score"] <= 100 and rx["frase"]
