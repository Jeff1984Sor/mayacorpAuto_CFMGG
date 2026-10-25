"""Perfis de acesso: catálogo, CRUD, checagem no servidor e filtro "ver as de todos"."""

from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


def _usuario_com_perfil(c, h, email, perfil_id):
    r = c.post("/api/config/usuarios", headers=h, json={"nome": email.split("@")[0], "email": email, "perfil": "operador",
                                                        "senha": "Senha@Forte2026", "perfil_acesso_id": perfil_id})
    assert r.status_code == 200, r.text
    lg = c.post("/api/auth/login", json={"email": email, "senha": "Senha@Forte2026"}).json()
    return r.json(), {"Authorization": "Bearer " + lg["access_token"]}, lg["usuario"]


def test_perfis_padrao_catalogo_e_checagem(cliente):  # noqa: F811
    h = _login(cliente)
    perfis = {p["nome"]: p for p in cliente.get("/api/config/perfis", headers=h).json()}
    assert {"Administrador", "Operador", "Advogado", "Financeiro", "Visualizador"} <= set(perfis)
    assert perfis["Administrador"]["administrador"] and perfis["Administrador"]["sistema"]
    cat = cliente.get("/api/config/perfis/catalogo", headers=h).json()
    assert any(g["grupo"] == "Financeiro" for g in cat["grupos"]) and cat["acoes"]["ver"] == "Ver"

    # perfil só de tarefas (sem ver as de todos) e timesheet
    r = cliente.post("/api/config/perfis", headers=h, json={"nome": "Estagiário teste", "permissoes": [
        "tarefas.editar", "timesheet.lancar", "inexistente.ver"]})
    assert r.status_code == 201, r.text
    est = r.json()
    assert "tarefas.ver" in est["permissoes"] and "timesheet.ver" in est["permissoes"] and "inexistente.ver" not in est["permissoes"]
    u, hu, me = _usuario_com_perfil(cliente, h, "estagiario.teste@cfme.com.br", est["id"])
    assert me["perfil_acesso_nome"] == "Estagiário teste" and not me["administrador"] and "tarefas.editar" in me["permissoes"]
    assert me["perfil"] == "operador"  # perfil legado acompanha (tem permissão de alterar)

    # servidor recusa o que o perfil não tem
    assert cliente.get("/api/financeiro/contas-pagar", headers=hu).status_code == 403
    assert cliente.get("/api/config/usuarios", headers=hu).status_code == 403
    assert cliente.post("/api/config/perfis", headers=hu, json={"nome": "x hack", "administrador": True}).status_code == 403
    assert cliente.get("/api/faturamento/tarefas", headers=hu).status_code == 200
    assert cliente.get("/api/faturamento/judiciario/tribunais", headers=hu).status_code == 200  # livre (formulários)

    # "ver as de todos": a tarefa do admin não aparece para o estagiário
    t_admin = cliente.post("/api/faturamento/tarefas", headers=h, json={"titulo": "Tarefa só do admin"}).json()
    t_est = cliente.post("/api/faturamento/tarefas", headers=hu, json={"titulo": "Minha tarefa"}).json()
    ids = [t["id"] for t in cliente.get("/api/faturamento/tarefas", headers=hu).json()["itens"]]
    assert t_est["id"] in ids and t_admin["id"] not in ids
    assert t_admin["id"] in [t["id"] for t in cliente.get("/api/faturamento/tarefas", headers=h).json()["itens"]]
    assert cliente.delete(f"/api/faturamento/tarefas/{t_est['id']}", headers=hu).status_code == 403  # não tem excluir

    # dar a permissão libera na hora
    r = cliente.put(f"/api/config/perfis/{est['id']}", headers=h, json={"nome": "Estagiário teste", "permissoes": [
        *est["permissoes"], "tarefas.excluir", "contas_pagar.ver"]})
    assert r.status_code == 200
    assert cliente.get("/api/financeiro/contas-pagar", headers=hu).status_code == 200
    assert cliente.delete(f"/api/faturamento/tarefas/{t_est['id']}", headers=hu).status_code == 200

    # regras de proteção
    assert cliente.delete(f"/api/config/perfis/{perfis['Administrador']['id']}", headers=h).status_code == 400
    assert cliente.put(f"/api/config/perfis/{perfis['Administrador']['id']}", headers=h,
                       json={"nome": "Administrador", "administrador": False}).status_code == 400
    assert cliente.delete(f"/api/config/perfis/{est['id']}", headers=h).status_code == 400  # tem usuário
    dup = cliente.post(f"/api/config/perfis/{perfis['Administrador']['id']}/duplicar", headers=h).json()
    assert dup["nome"].startswith("Administrador (cópia") and not dup["administrador"] and len(dup["permissoes"]) > 40
    assert cliente.delete(f"/api/config/perfis/{dup['id']}", headers=h).status_code == 200

    # visualizador: só consulta
    vis, hv, mv = _usuario_com_perfil(cliente, h, "visual.teste@cfme.com.br", perfis["Visualizador"]["id"])
    assert mv["perfil"] == "visualizador"
    assert cliente.get("/api/faturamento/casos", headers=hv).status_code == 200
    assert cliente.post("/api/nfse/tomadores", headers=hv, json={"tipo": "PJ", "nome": "Não pode"}).status_code == 403


def test_assistente_respeita_o_perfil(cliente):  # noqa: F811
    h = _login(cliente)
    r = cliente.post("/api/config/perfis", headers=h, json={"nome": "Só IA", "permissoes": ["ia.usar"]}).json()
    _, hu, me = _usuario_com_perfil(cliente, h, "so.ia@cfme.com.br", r["id"])
    assert me["perfil"] == "visualizador"
    cat = next(c for c in cliente.get("/api/financeiro/categorias", headers=h).json() if c["tipo"] == "despesa")
    x = cliente.post("/api/ia/assistente/executar", headers=hu, json={"tipo": "criar_conta_pagar", "parametros": {
        "descricao": "Hack", "valor": 1, "data_vencimento": "2026-12-01", "categoria_id": cat["id"]}})
    assert x.status_code == 403
    assert cliente.post("/api/ia/assistente/executar", headers=hu, json={"tipo": "navegar", "parametros": {"rota": "/"}}).status_code == 200


def test_reabrir_tarefa_concluida_exige_permissao(cliente):  # noqa: F811
    h = _login(cliente)
    p = cliente.post("/api/config/perfis", headers=h, json={"nome": "Tarefeiro", "permissoes": ["tarefas.editar"]}).json()
    _, hu, _ = _usuario_com_perfil(cliente, h, "tarefeiro@cfme.com.br", p["id"])
    t = cliente.post("/api/faturamento/tarefas", headers=hu, json={"titulo": "Protocolar"}).json()
    assert cliente.patch(f"/api/faturamento/tarefas/{t['id']}/status", headers=hu, json={"status": "concluida"}).status_code == 200
    r = cliente.patch(f"/api/faturamento/tarefas/{t['id']}/status", headers=hu, json={"status": "a_fazer"})
    assert r.status_code == 403 and "Reabrir" in r.json()["detail"]
    assert cliente.put(f"/api/faturamento/tarefas/{t['id']}", headers=hu, json={"titulo": "Mudou", "status": "concluida"}).status_code == 403
    cliente.put(f"/api/config/perfis/{p['id']}", headers=h, json={"nome": "Tarefeiro", "permissoes": ["tarefas.editar", "tarefas.reabrir"]})
    r = cliente.patch(f"/api/faturamento/tarefas/{t['id']}/status", headers=hu, json={"status": "a_fazer"})
    assert r.status_code == 200 and r.json()["concluida_em"] is None
