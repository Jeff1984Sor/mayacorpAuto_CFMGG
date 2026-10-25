"""IA plugável: o provedor é simulado (nenhuma chamada real à OpenAI/Gemini)."""

import pytest

from app.core import ia
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


@pytest.fixture
def ia_falsa(monkeypatch):
    respostas = {}

    def gerar_json(p, sistema, usuario, anexo=None):
        respostas["ultimo"] = (p, usuario)
        respostas["anexo"] = anexo
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
    ia_falsa["proxima"] = {"assunto": "NFS-e {numero_nota}", "corpo": "Olá {nome_tomador}, ver {inventada}."}
    r = cliente.post("/api/ia/preencher/email", headers=h, json={"instrucao": "mais formal"}).json()
    assert r["campos"]["corpo_modelo"] == "Olá {nome_tomador}, ver ."
    assert "{inventada}" in r["avisos"][0]


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


def test_analise_de_qualquer_tela(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    ia_falsa["proxima"] = {"titulo": "3 contas atrasadas", "resumo": "Há atrasos.", "recomendacao": "Pagar hoje.",
                           "pontos": [{"nivel": "risco", "texto": "Aluguel vencido"}]}
    r = cliente.post("/api/ia/analise/tela", headers=h, json={
        "tela": "/financeiro/pagar?status=atrasado", "titulo": "Lançamentos",
        "conteudo": "Em aberto R$ 3.000 · Atrasado R$ 1.000 · Aluguel venc. 10/10 R$ 1.000 atrasado"})
    assert r.status_code == 200 and r.json()["pontos"][0]["nivel"] == "risco"
    assert "contas atrasadas" in ia_falsa["ultimo"][1] and "Aluguel venc." in ia_falsa["ultimo"][1]


def test_assistente_conversa_e_executa_acao(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    cli = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Cliente Assistente"}).json()
    contrato = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": "Contrato IA"}).json()
    caso = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Caso IA"}).json()
    ia_falsa["proxima"] = {"resposta": "Vou lançar 2h.", "acoes": [
        {"tipo": "lancar_horas", "rotulo": "Lançar 2h no caso", "parametros": {"caso_id": caso["id"], "data": "2026-10-20",
                                                                                "minutos": 120, "descricao": "Reunião com o cliente"}},
        {"tipo": "apagar_tudo", "rotulo": "x", "parametros": {}}]}
    r = cliente.post("/api/ia/assistente/conversa", headers=h, json={
        "tela": f"/faturamento/casos/{caso['id']}", "titulo": "Caso", "conteudo": "Caso IA",
        "mensagens": [{"papel": "usuario", "texto": "lança 2h de reunião hoje"}]}).json()
    assert r["resposta"] == "Vou lançar 2h." and [a["tipo"] for a in r["acoes"]] == ["lancar_horas"]  # fora do catálogo cai fora
    assert "caso_aberto_na_tela" in ia_falsa["ultimo"][1]
    e = cliente.post("/api/ia/assistente/executar", headers=h, json=r["acoes"][0])
    assert e.status_code == 200, e.text
    ts = cliente.get(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h).json()
    assert ts[0]["minutos"] == 120
    assert cliente.post("/api/ia/assistente/executar", headers=h, json={"tipo": "navegar", "parametros": {"rota": "//evil.com"}}).status_code == 400
    assert cliente.post("/api/ia/assistente/executar", headers=h, json={"tipo": "lancar_horas", "parametros": {}}).status_code == 400


def test_enriquecer_andamento_e_horas(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    ia_falsa["proxima"] = {"titulo": "Protocolo da contestação", "descricao": "Contestação protocolada no prazo."}
    r = cliente.post("/api/faturamento/ia/enriquecer", headers=h, json={"tipo": "andamento", "texto": "protocolei contestacao"})
    assert r.status_code == 200 and r.json()["titulo"] == "Protocolo da contestação"
    ia_falsa["proxima"] = {"descricao": "Elaboração de contestação."}
    r = cliente.post("/api/faturamento/ia/enriquecer", headers=h, json={"tipo": "timesheet", "texto": "fiz contestacao", "minutos": 90})
    assert r.json() == {"descricao": "Elaboração de contestação."} and "1h30" in ia_falsa["ultimo"][1]


def test_ler_recibo(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    _ativar(cliente, h)
    ia_falsa["proxima"] = {"data": "2026-10-20", "tipo": "deslocamento", "descricao": "Uber até o fórum", "valor": "32,90"}
    r = cliente.post("/api/faturamento/ia/ler-recibo", headers=h, files={"arquivo": ("recibo.jpg", b"\xff\xd8\xff", "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["campos"] == {"data": "2026-10-20", "tipo": "deslocamento", "descricao": "Uber até o fórum", "valor": "32.90"}
    assert cliente.post("/api/faturamento/ia/ler-recibo", headers=h, files={"arquivo": ("x.exe", b"MZ")}).status_code == 400


def test_assistente_resolve_nome_no_lugar_do_id(cliente, ia_falsa):  # noqa: F811
    h = _login(cliente)
    cats = cliente.get("/api/financeiro/categorias", headers=h).json()
    cat = next(c for c in cats if c["tipo"] == "despesa")
    r = cliente.post("/api/ia/assistente/executar", headers=h, json={"tipo": "criar_conta_pagar", "parametros": {
        "descricao": "Conta de energia elétrica", "valor": 350.9, "data_vencimento": "2026-11-10",
        "categoria_id": cat["nome"], "fornecedor_id": "Enel Distribuição"}})
    assert r.status_code == 200, r.text
    conta = cliente.get("/api/financeiro/contas-pagar", headers=h, params={"q": "energia elétrica"}).json()["itens"][0]
    assert conta["favorecido_nome"] == "Enel Distribuição" and conta["categoria_id"] == cat["id"] and conta["valor"] == "350.90"
    r = cliente.post("/api/ia/assistente/executar", headers=h, json={"tipo": "criar_conta_pagar", "parametros": {
        "descricao": "x", "valor": 1, "data_vencimento": "2026-11-10", "categoria_id": "Categoria que não existe"}})
    assert r.status_code == 400 and "Não encontrei" in r.json()["detail"]
