"""Conector MCP: descoberta e login OAuth (PKCE), ferramentas com as permissões do usuário, escopo e revogação."""

import base64
import hashlib
import json
from urllib.parse import parse_qs, urlsplit

from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_perfis import _usuario_com_perfil

RETORNO = "https://claude.ai/api/mcp/auth_callback"
VERIFICADOR = "verificador-pkce-de-teste-com-tamanho-suficiente-0123456789"
DESAFIO = base64.urlsafe_b64encode(hashlib.sha256(VERIFICADOR.encode()).digest()).rstrip(b"=").decode()


def _conectar(c, h, escopo="leitura", retorno=RETORNO):
    reg = c.post("/api/mcp/oauth/registrar", json={"client_name": "Claude", "redirect_uris": [retorno]})
    assert reg.status_code == 201, reg.text
    cid = reg.json()["client_id"]
    r = c.get("/api/mcp/oauth/autorizar", follow_redirects=False, params={
        "response_type": "code", "client_id": cid, "redirect_uri": retorno, "code_challenge": DESAFIO,
        "code_challenge_method": "S256", "state": "xyz"})
    assert r.status_code == 302 and "/conectar-claude?" in r.headers["location"]
    ap = c.post("/api/mcp/oauth/aprovar", headers=h, json={
        "client_id": cid, "redirect_uri": retorno, "code_challenge": DESAFIO, "state": "xyz", "escopo": escopo})
    assert ap.status_code == 200, ap.text
    volta = urlsplit(ap.json()["redirect"])
    q = parse_qs(volta.query)
    assert f"{volta.scheme}://{volta.netloc}{volta.path}" == retorno and q["state"] == ["xyz"]
    return cid, q["code"][0]


def _trocar(c, cid, codigo, verificador=VERIFICADOR):
    return c.post("/api/mcp/oauth/token", data={"grant_type": "authorization_code", "code": codigo, "code_verifier": verificador,
                                                "redirect_uri": RETORNO, "client_id": cid})


def _rpc(c, token, metodo, params=None, id_=1):
    r = c.post("/api/mcp", headers={"Authorization": f"Bearer {token}"}, json={"jsonrpc": "2.0", "id": id_, "method": metodo, "params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()


def _usar(c, token, nome, **args):
    r = _rpc(c, token, "tools/call", {"name": nome, "arguments": args})["result"]
    return r["isError"], r["content"][0]["text"]


def test_descoberta_e_recusas(cliente):  # noqa: F811
    r = cliente.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert r.status_code == 401 and "oauth-protected-resource" in r.headers["www-authenticate"]
    h = _login(cliente)
    assert cliente.post("/api/mcp", headers=h, json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401  # token da tela não serve
    assert cliente.get("/api/mcp").status_code == 405

    pr = cliente.get("/.well-known/oauth-protected-resource/api/mcp").json()
    assert pr["resource"].endswith("/api/mcp") and pr["authorization_servers"]
    meta = cliente.get("/.well-known/oauth-authorization-server").json()
    assert meta["code_challenge_methods_supported"] == ["S256"] and meta["registration_endpoint"].endswith("/api/mcp/oauth/registrar")
    assert cliente.get("/api/mcp/.well-known/oauth-authorization-server").json()["issuer"] == meta["issuer"]

    assert cliente.post("/api/mcp/oauth/registrar", json={"redirect_uris": ["http://malicioso.example/cb"]}).status_code == 400
    cid = cliente.post("/api/mcp/oauth/registrar", json={"redirect_uris": [RETORNO]}).json()["client_id"]
    # retorno diferente do registrado: erro na hora, sem redirecionar
    r = cliente.get("/api/mcp/oauth/autorizar", follow_redirects=False, params={
        "client_id": cid, "redirect_uri": "https://outro.example/cb", "code_challenge": DESAFIO, "code_challenge_method": "S256"})
    assert r.status_code == 400
    # sem PKCE: volta para o aplicativo com erro
    r = cliente.get("/api/mcp/oauth/autorizar", follow_redirects=False, params={"client_id": cid, "redirect_uri": RETORNO})
    assert r.status_code == 302 and "error=invalid_request" in r.headers["location"]
    info = cliente.get("/api/mcp/oauth/cliente", params={"client_id": cid, "redirect_uri": RETORNO}).json()
    assert info["destino"] == "claude.ai" and info["confiavel"]
    assert cliente.post("/api/mcp/oauth/aprovar", json={"client_id": cid, "redirect_uri": RETORNO, "code_challenge": DESAFIO}).status_code == 401


def test_conexao_so_consulta(cliente):  # noqa: F811
    h = _login(cliente)
    cid, codigo = _conectar(cliente, h)
    assert _trocar(cliente, cid, codigo, "verificador-errado").status_code == 400
    t = _trocar(cliente, cid, codigo)
    assert t.status_code == 200, t.text
    t = t.json()
    assert t["token_type"] == "Bearer" and t["scope"] == "leitura" and t["refresh_token"]
    token = t["access_token"]
    # o token do conector não entra na API diretamente
    assert cliente.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    ini = _rpc(cliente, token, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    assert ini["result"]["protocolVersion"] == "2025-06-18" and ini["result"]["serverInfo"]["name"] == "mayajus"
    assert "só consulta" in ini["result"]["instructions"]
    r = cliente.post("/api/mcp", headers={"Authorization": f"Bearer {token}"}, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    assert r.status_code == 202
    nomes = [f["name"] for f in _rpc(cliente, token, "tools/list")["result"]["tools"]]
    assert nomes == ["buscar_rotas", "detalhar_rota", "consultar", "relatorio"]  # sem `alterar`
    assert _rpc(cliente, token, "nao/existe")["error"]["code"] == -32601

    erro, texto = _usar(cliente, token, "buscar_rotas", termo="casos")
    assert not erro and "GET /faturamento/casos" in texto and "POST" not in texto
    erro, texto = _usar(cliente, token, "buscar_rotas")
    assert not erro and "Faturamento" in texto
    erro, texto = _usar(cliente, token, "detalhar_rota", metodo="GET", caminho="/faturamento/tarefas")
    assert not erro and json.loads(texto)["caminho"] == "/faturamento/tarefas"

    erro, texto = _usar(cliente, token, "consultar", caminho="/api/nfse/emissoras")
    assert not erro and json.loads(texto)[0]["id"]
    erro, texto = _usar(cliente, token, "consultar", caminho="/faturamento/casos?busca=zzzz-nao-existe")
    assert not erro
    erro, texto = _usar(cliente, token, "relatorio", fonte="casos", grafico={"tipo": "barras", "dimensao": "status"}, max_linhas=1)
    assert not erro and "total_linhas" in json.loads(texto)

    # o que não passa pelo conector
    for caminho in ("/auth/me", "/config/usuarios", "/admin/clientes", "/rota/que-nao-existe", "/faturamento/../auth/me"):
        erro, texto = _usar(cliente, token, "consultar", caminho=caminho)
        assert erro, caminho
    assert _rpc(cliente, token, "tools/call", {"name": "alterar", "arguments": {}}).get("error")  # nem existe nesta conexão

    # código não vale duas vezes, e o reuso encerra a conexão
    assert _trocar(cliente, cid, codigo).status_code == 400
    assert cliente.post("/api/mcp", headers={"Authorization": f"Bearer {token}"}, json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401
    assert cliente.post("/api/mcp/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"]}).status_code == 400


def test_conexao_com_escrita_perfil_e_revogacao(cliente):  # noqa: F811
    h = _login(cliente)
    cid, codigo = _conectar(cliente, h, "escrita")
    t = _trocar(cliente, cid, codigo).json()
    token = t["access_token"]
    assert "alterar" in [f["name"] for f in _rpc(cliente, token, "tools/list")["result"]["tools"]]

    erro, texto = _usar(cliente, token, "alterar", metodo="POST", caminho="/faturamento/tarefas", corpo={"titulo": "Tarefa criada pelo Claude"})
    assert not erro, texto
    tid = json.loads(texto)["id"]
    assert cliente.get(f"/api/faturamento/tarefas/{tid}", headers=h).json()["titulo"] == "Tarefa criada pelo Claude"
    erro, texto = _usar(cliente, token, "alterar", metodo="POST", caminho="/faturamento/tarefas", corpo={})
    assert erro and "422" in texto  # validação da API volta em português
    erro, texto = _usar(cliente, token, "consultar", caminho="/faturamento/tarefas", parametros={"busca": "Claude"})
    assert not erro
    erro, texto = _usar(cliente, token, "alterar", metodo="POST", caminho="/config/usuarios", corpo={"nome": "x"})
    assert erro and "não está disponível" in texto
    erro, texto = _usar(cliente, token, "alterar", metodo="PUT", caminho="/config/prefeitura", corpo={"modo": "producao"})
    assert erro and "não está disponível" in texto  # configuração: só pela tela
    assert not _usar(cliente, token, "consultar", caminho="/config/prefeitura")[0]
    erro, texto = _usar(cliente, token, "alterar", metodo="POST", caminho="/nfse/importacoes")
    assert erro and "arquivo" in texto

    # renovar o token
    novo = cliente.post("/api/mcp/oauth/token", data={"grant_type": "refresh_token", "refresh_token": t["refresh_token"], "client_id": cid})
    assert novo.status_code == 200 and _rpc(cliente, novo.json()["access_token"], "ping")["result"] == {}

    # perfil sem financeiro: a rota some da busca e a API recusa
    perfis = {p["nome"]: p for p in cliente.get("/api/config/perfis", headers=h).json()}
    _, ha, _ = _usuario_com_perfil(cliente, h, "advogado.mcp@cfme.com.br", perfis["Advogado"]["id"])
    cid2, codigo2 = _conectar(cliente, ha, "escrita", "http://localhost:53124/callback")
    token2 = cliente.post("/api/mcp/oauth/token", data={"grant_type": "authorization_code", "code": codigo2, "code_verifier": VERIFICADOR,
                                                        "client_id": cid2}).json()["access_token"]
    erro, texto = _usar(cliente, token2, "buscar_rotas", termo="contas pagar")
    assert "/financeiro/contas-pagar" not in texto
    erro, texto = _usar(cliente, token2, "consultar", caminho="/financeiro/contas-pagar")
    assert erro and "403" in texto
    erro, texto = _usar(cliente, token2, "relatorio", fonte="faturas")
    assert erro

    # conexões: o advogado vê a dele; o administrador vê as duas e encerra a do advogado
    minhas = cliente.get("/api/mcp/conexoes", headers=ha).json()
    assert minhas["url"].endswith("/api/mcp") and [c["destino"] for c in minhas["conexoes"]] == ["este computador"]
    todas = cliente.get("/api/mcp/conexoes", headers=h).json()["conexoes"]
    assert {c["escopo"] for c in todas} >= {"escrita"} and any(not c["minha"] for c in todas)
    alheia = next(c for c in todas if c["minha"])
    assert cliente.delete(f"/api/mcp/conexoes/{alheia['id']}", headers=ha).status_code == 404
    assert cliente.delete(f"/api/mcp/conexoes/{minhas['conexoes'][0]['id']}", headers=h).status_code == 204
    assert cliente.post("/api/mcp", headers={"Authorization": f"Bearer {token2}"}, json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401
    assert _rpc(cliente, token, "ping")["result"] == {}  # a do administrador continua
