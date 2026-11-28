"""Tipos de caso (contencioso, consultivo, administrativo): tipo, campos comuns, listas e extensões por tipo.

O banco é o mesmo da suíte inteira: clientes com CNPJ próprio (raiz 7061xxxx).
"""

import pytest

from app.modules.tribunais import cnj
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_perfis import _usuario_com_perfil


@pytest.fixture(autouse=True)
def _sem_tribunal(monkeypatch):
    """Caso com número CNJ válido entra na fila de busca no tribunal: aqui a fila fica desligada (sem rede)."""
    from app.modules.tribunais import jobs

    monkeypatch.setattr(jobs, "enfileirar", lambda *a, **kw: None)
    monkeypatch.setattr(jobs, "disparar", lambda: None)


CNJ_TJSP = cnj.formatar(cnj.montar(7061001, 2024, 8, "26", "0100"))
CNJ_TRT15 = cnj.formatar(cnj.montar(7061002, 2024, 5, "15", "0001"))
CNJ_TRF3 = cnj.formatar(cnj.montar(7061003, 2024, 4, "03", "6100"))


def contrato_novo(c, h, nome: str, raiz: int) -> dict:
    r = c.post("/api/nfse/tomadores", json={"tipo": "PJ", "cpf_cnpj": _cnpj(raiz), "nome": nome}, headers=h)
    assert r.status_code in (200, 201), r.text
    k = c.post("/api/faturamento/contratos", json={"tomador_id": r.json()["id"], "nome": "Geral"}, headers=h)
    assert k.status_code == 201, k.text
    return k.json()


def caso_novo(c, h, contrato_id: int, **corpo) -> dict:
    r = c.post(f"/api/faturamento/contratos/{contrato_id}/casos", json={"titulo": "Caso de teste", **corpo}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def operador(c, h, email: str):
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    return _usuario_com_perfil(c, h, email, perfis["Operador"]["id"])[1]


def test_tipo_do_caso_e_coluna_antiga(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente Tipos de Caso", 70610001)
    # chamadas antigas: sem nada é consultivo; com número de processo é contencioso; o tipo antigo decide
    assert caso_novo(c, h, k["id"])["tipo_caso"] == "consultivo"
    proc = caso_novo(c, h, k["id"], numero_processo="123/2019")
    assert proc["tipo_caso"] == "contencioso" and proc["tipo"] is None
    fed = caso_novo(c, h, k["id"], tipo="judicial_federal")
    assert (fed["tipo_caso"], fed["tipo"], fed["tipo_nome"]) == ("contencioso", "judicial_federal", "Judicial Federal")
    adm = caso_novo(c, h, k["id"], tipo="administrativo")
    assert (adm["tipo_caso"], adm["tipo"]) == ("administrativo", "administrativo")
    # tipo novo: a coluna antiga é calculada (a justiça vem do número CNJ)
    assert caso_novo(c, h, k["id"], tipo_caso="consultivo", tipo="judicial_federal")["tipo"] == "consultivo"
    trt = caso_novo(c, h, k["id"], tipo_caso="contencioso", numero_processo=CNJ_TRT15)
    assert (trt["tipo"], trt["tipo_caso_nome"]) == ("judicial_trabalhista", "Contencioso")
    assert caso_novo(c, h, k["id"], tipo_caso="contencioso", numero_processo=CNJ_TRF3)["tipo"] == "judicial_federal"
    # filtro da lista
    lista = c.get("/api/faturamento/casos", params={"contrato_id": k["id"], "tipo_caso": "administrativo"}, headers=h).json()
    assert [x["id"] for x in lista] == [adm["id"]]
    # a tela antiga regrava o caso sem tipo_caso: nada muda
    corpo = {"titulo": "Trabalhista", "numero_processo": CNJ_TRT15, "tipo": "judicial_trabalhista"}
    r = c.put(f"/api/faturamento/casos/{trt['id']}", json=corpo, headers=h).json()
    assert (r["tipo_caso"], r["tipo"]) == ("contencioso", "judicial_trabalhista")


def test_troca_de_tipo_so_administrador(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente Troca de Tipo", 70610002)
    caso = caso_novo(c, h, k["id"], tipo_caso="consultivo")
    ho = operador(c, h, "operador.tipos@cfme.com.br")
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Caso de teste", "tipo_caso": "administrativo"}, headers=ho)
    assert r.status_code == 403 and "administrador" in r.json()["detail"]
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Caso de teste", "tipo": "administrativo"}, headers=ho)
    assert r.status_code == 403  # pelo tipo antigo também é troca
    assert c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Outro título"}, headers=ho).status_code == 200
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Caso de teste", "tipo_caso": "administrativo"}, headers=h)
    assert r.status_code == 200 and r.json()["tipo_caso"] == "administrativo" and r.json()["tipo"] == "administrativo"


def test_situacao_e_campos_comuns(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente Campos Comuns", 70610003)
    pai = caso_novo(c, h, k["id"])
    itens = c.get("/api/faturamento/listas", headers=h).json()
    origem = next(i for i in itens if i["lista"] == "origem" and i["nome"] == "Indicação")
    motivo = next(i for i in itens if i["lista"] == "motivo_encerramento" and i["nome"] == "Acordo")
    etiqueta = c.post("/api/faturamento/listas", json={"lista": "etiqueta", "nome": "Estratégico 7061"}, headers=h).json()
    eu = c.get("/api/auth/me", headers=h).json()
    colega = c.post("/api/config/usuarios", headers=h, json={"nome": "Colega Equipe", "email": "colega.equipe@cfme.com.br",
                                                             "perfil": "operador", "senha": "Senha@Forte2026"}).json()
    caso = caso_novo(c, h, k["id"], status="suspenso", origem_id=origem["id"], etiqueta_ids=[etiqueta["id"]],
                     equipe_ids=[colega["id"]], valor_estimado="15000.50", caso_pai_id=pai["id"], tipo_vinculo="desdobramento",
                     observacoes="Observação interna", responsavel_id=eu["id"])
    assert caso["status"] == "suspenso" and caso["status_nome"] == "Suspenso"
    assert caso["origem_nome"] == "Indicação" and caso["etiquetas"] == [{"id": etiqueta["id"], "nome": "Estratégico 7061"}]
    assert caso["equipe"] == [{"id": colega["id"], "nome": "Colega Equipe"}] and caso["valor_estimado"] == "15000.50"
    assert caso["caso_pai_id"] == pai["id"] and caso["tipo_vinculo"] == "desdobramento"
    # a tela antiga (sem os campos novos) não apaga nada
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Só o título", "status": "suspenso"}, headers=h).json()
    assert r["origem_id"] == origem["id"] and r["equipe_ids"] == [colega["id"]] and r["observacoes"] == "Observação interna"
    # encerrar exige a data
    corpo = {"titulo": "Só o título", "status": "encerrado", "motivo_encerramento_id": motivo["id"]}
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json=corpo, headers=h)
    assert r.status_code == 400 and "data de encerramento" in r.json()["detail"]
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={**corpo, "data_encerramento": "2030-01-10"}, headers=h)
    assert r.status_code == 200 and r.json()["motivo_encerramento_nome"] == "Acordo"
    assert c.get("/api/faturamento/casos", params={"contrato_id": k["id"], "status": "encerrado"}, headers=h).json()[0]["id"] == caso["id"]
    # item de outra lista não entra
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "x1", "origem_id": motivo["id"]}, headers=h)
    assert r.status_code == 400 and "Origem" in r.json()["detail"]


def test_caso_sigiloso_so_a_equipe(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente Sigiloso", 70610004)
    ho = operador(c, h, "operador.sigilo@cfme.com.br")
    eu_op = c.get("/api/auth/me", headers=ho).json()
    caso = caso_novo(c, h, k["id"], sigiloso=True)
    assert c.get(f"/api/faturamento/casos/{caso['id']}", headers=ho).status_code == 403
    assert caso["id"] not in [x["id"] for x in c.get("/api/faturamento/casos", params={"contrato_id": k["id"]}, headers=ho).json()]
    c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Caso de teste", "equipe_ids": [eu_op["id"]]}, headers=h)
    assert c.get(f"/api/faturamento/casos/{caso['id']}", headers=ho).json()["sigiloso"] is True


def test_listas_configuraveis(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    tipos = {t["lista"]: t for t in c.get("/api/faturamento/listas/tipos", headers=h).json()}
    assert tipos["orgao"]["tipo_caso"] == "administrativo" and tipos["etiqueta"]["tipo_caso"] is None
    orgaos = c.get("/api/faturamento/listas", params={"lista": "orgao"}, headers=h).json()
    assert {"Receita Federal", "CARF", "PROCON", "INPI"} <= {o["nome"] for o in orgaos} and all(o["sistema"] for o in orgaos)
    n = len(c.get("/api/faturamento/listas", headers=h).json())
    assert len(c.get("/api/faturamento/listas", headers=h).json()) == n  # o seed não se repete
    areas = {a["nome"] for a in c.get("/api/faturamento/areas", headers=h).json()}
    assert {"Cível", "Trabalhista", "Digital/LGPD", "Securitário"} <= areas
    # item novo do escritório, sem repetir
    novo = c.post("/api/faturamento/listas", json={"lista": "origem", "nome": "Evento 7061"}, headers=h)
    assert novo.status_code == 201 and novo.json()["sistema"] is False
    assert c.post("/api/faturamento/listas", json={"lista": "origem", "nome": "evento 7061"}, headers=h).status_code == 409
    assert c.post("/api/faturamento/listas", json={"lista": "inexistente", "nome": "x"}, headers=h).status_code == 400
    # em uso: desativa em vez de apagar; do sistema: também
    k = contrato_novo(c, h, "Cliente Listas", 70610005)
    caso_novo(c, h, k["id"], origem_id=novo.json()["id"])
    r = c.delete(f"/api/faturamento/listas/{novo.json()['id']}", headers=h)
    assert "desativado" in r.json()["mensagem"]
    sistema = next(o for o in orgaos if o["nome"] == "DETRAN")
    assert "desativado" in c.delete(f"/api/faturamento/listas/{sistema['id']}", headers=h).json()["mensagem"]
    ativos = c.get("/api/faturamento/listas", params={"lista": "orgao", "ativos": True}, headers=h).json()
    assert "DETRAN" not in {o["nome"] for o in ativos}
    livre = c.post("/api/faturamento/listas", json={"lista": "etiqueta", "nome": "Apagar 7061"}, headers=h).json()
    assert c.delete(f"/api/faturamento/listas/{livre['id']}", headers=h).json()["mensagem"] == "Item excluído."
    # quem não configura o faturamento lê, mas não altera
    ho = operador(c, h, "operador.listas@cfme.com.br")
    assert c.get("/api/faturamento/listas", headers=ho).status_code == 200
    assert c.post("/api/faturamento/listas", json={"lista": "origem", "nome": "Não pode"}, headers=ho).status_code == 403
