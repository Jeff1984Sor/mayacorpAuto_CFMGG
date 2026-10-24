"""Comunicador: conversas, menções, canal do robô e entrega ao vivo pelo WebSocket."""

import time

import pytest

from app.core.security import criar_token
from tests.conftest import detalhe
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


@pytest.fixture(autouse=True)
def _desbloquear():
    """Outro teste bloqueia o operador de propósito (tentativas de senha); aqui começamos limpos."""
    from app.core.db import SessionLocal
    from app.core.models import Usuario

    with SessionLocal() as db:
        db.query(Usuario).update({Usuario.tentativas_falhas: 0, Usuario.bloqueado_ate: None})
        db.commit()


def _ids(c, h):
    return {u["login"] or u["nome"]: u["id"] for u in c.get("/api/comunicador/usuarios", headers=h).json()}


def test_conversa_direta_unica_mencao_e_lido(cliente):  # noqa: F811
    h_admin = _login(cliente)
    h_op = _login(cliente, "operador@cfme.com.br")
    me_op = cliente.get("/api/auth/me", headers=h_op).json()
    antes = cliente.get("/api/comunicador/resumo", headers=h_op).json()  # inclui avisos do robô
    conv = cliente.post(f"/api/comunicador/diretas/{me_op['id']}", headers=h_admin).json()
    # a conversa direta é única por par, dos dois lados
    assert cliente.post(f"/api/comunicador/diretas/{me_op['id']}", headers=h_admin).json()["id"] == conv["id"]
    texto = f"Oi @[{me_op['nome']}]({me_op['id']}), confere o lote?"
    m = cliente.post(f"/api/comunicador/conversas/{conv['id']}/mensagens", headers=h_admin, json={"texto": texto}).json()
    assert m["autor_nome"] and not m["robo"]
    depois = cliente.get("/api/comunicador/resumo", headers=h_op).json()
    assert depois == {"nao_lidas": antes["nao_lidas"] + 1, "mencoes": antes["mencoes"] + 1}
    men = cliente.get("/api/comunicador/mencoes", headers=h_op).json()[0]
    assert "@" + me_op["nome"] in men["trecho"]
    cliente.post(f"/api/comunicador/conversas/{conv['id']}/lido", headers=h_op, json={})
    assert cliente.get("/api/comunicador/resumo", headers=h_op).json() == antes
    # quem não participa não lê
    h_vis = _login(cliente, "visualizador@cfme.com.br")
    assert cliente.get(f"/api/comunicador/conversas/{conv['id']}/mensagens", headers=h_vis).status_code == 404


def test_canal_do_robo_avisa_fim_de_lote(cliente):  # noqa: F811
    from app.modules.rpa_nfse import parser_txt

    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    arq = parser_txt.gerar_arquivo("12345678", [detalhe(9801), detalhe(9802)])
    lote = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("r.txt", arq)}, data={"emissora_id": emissora["id"]}).json()
    cliente.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h)
    robo = next(c for c in cliente.get("/api/comunicador/conversas", headers=h).json() if c["tipo"] == "robo")
    msgs = cliente.get(f"/api/comunicador/conversas/{robo['id']}/mensagens", headers=h).json()["itens"]
    ultima = msgs[-1]
    assert ultima["robo"] and f"#{lote['numero']:04d}" in ultima["texto"] and ultima["link"] == f"/nfse/lotes/{lote['id']}"
    # ninguém escreve no canal do robô
    r = cliente.post(f"/api/comunicador/conversas/{robo['id']}/mensagens", headers=h, json={"texto": "oi"})
    assert r.status_code == 400


def test_websocket_entrega_ao_vivo_e_presenca(cliente):  # noqa: F811
    h_admin = _login(cliente)
    me_admin = cliente.get("/api/auth/me", headers=h_admin).json()
    h_op = _login(cliente, "operador@cfme.com.br")
    me_op = cliente.get("/api/auth/me", headers=h_op).json()
    token_op = criar_token(str(me_op["id"]), "access", {"tid": 1})
    with cliente.websocket_connect(f"/api/ws/comunicador?token={token_op}") as ws:
        assert ws.receive_json()["tipo"] == "ola"
        # o admin vê o operador online
        assert {u["id"]: u["status"] for u in cliente.get("/api/comunicador/usuarios", headers=h_admin).json()}[me_op["id"]] == "online"
        conv = cliente.post(f"/api/comunicador/diretas/{me_op['id']}", headers=h_admin).json()
        cliente.post(f"/api/comunicador/conversas/{conv['id']}/mensagens", headers=h_admin, json={"texto": "Bom dia!"})
        inicio = time.time()
        while True:  # o carteiro entrega em até ~1s
            ev = ws.receive_json()
            if ev["tipo"] == "mensagem.nova" and ev["mensagem"]["conversa_id"] == conv["id"]:
                break
            assert time.time() - inicio < 5
        assert ev["mensagem"]["texto"] == "Bom dia!" and ev["mensagem"]["autor_id"] == me_admin["id"]
    # token inválido é recusado
    try:
        with cliente.websocket_connect("/api/ws/comunicador?token=invalido") as ws:
            ws.receive_json()
        raise AssertionError("deveria recusar")
    except Exception as e:  # noqa: BLE001
        assert "4401" in str(e) or "WebSocketDisconnect" in type(e).__name__


def test_chamar_alguem_a_partir_do_lote(cliente):  # noqa: F811
    h = _login(cliente)
    h_op = _login(cliente, "operador@cfme.com.br")
    me_op = cliente.get("/api/auth/me", headers=h_op).json()
    lote_id = cliente.get("/api/nfse/lotes", headers=h).json()["itens"][0]["id"]
    r = cliente.post("/api/comunicador/chamar", headers=h, json={
        "usuario_id": me_op["id"], "texto": "Confere as rejeitadas deste lote?", "origem_tipo": "lote",
        "origem_id": lote_id, "url": f"/nfse/lotes/{lote_id}"})
    assert r.status_code == 200, r.text
    men = cliente.get("/api/comunicador/mencoes?pendentes=true", headers=h_op).json()[0]
    assert men["url"] == f"/nfse/lotes/{lote_id}" and men["origem_tipo"] == "lote"
    assert cliente.post(f"/api/comunicador/mencoes/{men['id']}/resolver", headers=h_op).json()["resolvida"]
