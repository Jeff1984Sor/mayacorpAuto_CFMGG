"""IA plugável: o provedor é simulado (nenhuma chamada real à OpenAI/Gemini)."""

import pytest

from app.core import ia
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


@pytest.fixture
def ia_falsa(monkeypatch):
    respostas = {}

    def gerar_json(p, sistema, usuario):
        respostas["ultimo"] = (p, usuario)
        return respostas.get("proxima", {"ok": True, "mensagem": "Olá!"})

    monkeypatch.setattr(ia, "gerar_json", gerar_json)
    monkeypatch.setattr(ia, "listar_modelos", lambda provedor, chave: [f"{provedor}-modelo-b", f"{provedor}-modelo-a"])
    return respostas


def _equipe(login="admin@cfme.com.br"):
    from app.core.db import SessionLocal
    from app.core.models import Usuario

    with SessionLocal() as db:
        db.query(Usuario).filter(Usuario.email == login).update({Usuario.equipe_mayacorp: True})
        db.commit()


def _ativar(c, h, provedor="gemini"):
    _equipe()
    r = c.put("/api/config/ia", headers=h, json={"ativo": True, "provedor": provedor, "modelo": f"{provedor}-modelo-a",
                                                "chave": "sk-teste-1234ABCD"})
    assert r.status_code == 200, r.text
    return r.json()


def test_configuracao_nao_devolve_a_chave(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    assert cliente.get("/api/config/ia", headers=h).json()["ativo"] is False
    cfg = _ativar(cliente, h)
    assert cfg["chave_definida"] and cfg["chave_final"] == "ABCD"
    assert "sk-teste" not in str(cfg)
    assert cliente.post("/api/config/ia/modelos", headers=h, json={"provedor": "gemini"}).json()[0] == "gemini-modelo-b"
    assert cliente.post("/api/config/ia/testar", headers=h).json()["ok"] is True
    # ativar sem chave/modelo é recusado
    r = cliente.put("/api/config/ia", headers=h, json={"ativo": True, "provedor": "openai", "modelo": None})
    assert r.status_code == 400


def test_ia_desligada_explica_onde_ligar(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    cliente.put("/api/config/ia", headers=h, json={"ativo": False, "provedor": "openai"})
    r = cliente.post("/api/ia/preencher/cliente", headers=h, json={"texto": "Condomínio Solar, CNPJ 11.444.777/0001-61"})
    assert r.status_code == 400 and "Configurações" in r.json()["detail"]


def test_preencher_cliente_valida_o_que_a_ia_devolve(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h, "openai")
    ia_falsa["proxima"] = {"tipo": "PJ", "nome": "CONDOMINIO SOLAR", "cpf_cnpj": "11.444.777/0001-61", "cep": "01001-000",
                           "uf": "sp", "emails": "sindico@solar.com.br; errado", "inventado": "x"}
    r = cliente.post("/api/ia/preencher/cliente", headers=h, json={"texto": "Condomínio Solar - CNPJ 11.444.777/0001-61"}).json()
    assert r["campos"] == {"tipo": "PJ", "nome": "CONDOMINIO SOLAR", "cpf_cnpj": "11444777000161", "cep": "01001000",
                           "uf": "SP", "emails": ["sindico@solar.com.br"]}
    ia_falsa["proxima"] = {"nome": "X", "cpf_cnpj": "11.111.111/1111-11"}  # CNPJ inválido nunca entra
    r = cliente.post("/api/ia/preencher/cliente", headers=h, json={"texto": "texto qualquer com dados"}).json()
    assert "cpf_cnpj" not in r["campos"] and r["avisos"]


def test_preencher_email_remove_variavel_desconhecida(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    ia_falsa["proxima"] = {"assunto": "NFS-e {numero_nota}", "corpo": "Olá {nome_tomador}, vence em {vencimento}."}
    r = cliente.post("/api/ia/preencher/email", headers=h, json={"instrucao": "mais formal"}).json()
    assert r["campos"]["corpo_modelo"] == "Olá {nome_tomador}, vence em ."
    assert "{vencimento}" in r["avisos"][0]


def test_analise_do_painel_e_do_lote(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    ia_falsa["proxima"] = {"titulo": "Mês saudável", "resumo": "Tudo certo.", "recomendacao": "Seguir.",
                           "pontos": [{"nivel": "ok", "texto": "Sem rejeições"}, {"nivel": "estranho", "texto": "x"}]}
    a = cliente.post("/api/ia/analise/painel", headers=h).json()
    assert a["titulo"] == "Mês saudável" and a["pontos"][1]["nivel"] == "atencao"
    lote_id = cliente.get("/api/nfse/lotes", headers=h).json()["itens"][0]["id"]
    assert cliente.post(f"/api/ia/analise/lote/{lote_id}", headers=h).status_code == 200
    assert "raio_x" in ia_falsa["ultimo"][1]


def test_so_a_equipe_mayacorp_altera_a_ia(cliente, ia_falsa):  # noqa: F811
    from app.core.db import SessionLocal
    from app.core.models import Usuario

    with SessionLocal() as db:  # um administrador comum da CFME
        db.query(Usuario).filter(Usuario.email == "admin@cfme.com.br").update({Usuario.equipe_mayacorp: False})
        db.commit()
    h = _login(cliente)
    cfg = cliente.get("/api/config/ia", headers=h).json()
    assert cfg["pode_editar"] is False and cfg["chave_final"] is None
    r = cliente.put("/api/config/ia", headers=h, json={"ativo": False, "provedor": "openai", "chave": "sk-intruso"})
    assert r.status_code == 403 and "MayaCorp" in r.json()["detail"]
    assert cliente.post("/api/config/ia/testar", headers=h).status_code == 403
    # e não dá para se promover pela tela de usuários
    me = cliente.get("/api/auth/me", headers=h).json()
    cliente.patch(f"/api/config/usuarios/{me['id']}", headers=h, json={"equipe_mayacorp": True})
    assert cliente.get("/api/auth/me", headers=h).json()["equipe_mayacorp"] is False
