"""Regra por hora com tabela progressiva / regressiva (faixas de horas do mês): `faturamento/faixas.py`."""

from decimal import Decimal

from app.modules.faturamento import faixas
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_faturamento import _base

_PESSOAS: dict = {}


def _cenario(c, h, sufixo: str):
    """Cliente + contrato + caso, e dois profissionais (Sênior R$ 500/h e Júnior R$ 200/h na tabela "Faixas")."""
    if not _PESSOAS:
        sen = c.post("/api/config/cargos", headers=h, json={"nome": "Sênior (faixas)"}).json()
        jun = c.post("/api/config/cargos", headers=h, json={"nome": "Júnior (faixas)"}).json()
        tab = c.post("/api/faturamento/tabelas", headers=h, json={"nome": "Faixas", "itens": [
            {"cargo_id": sen["id"], "valor_hora": "500.00"}, {"cargo_id": jun["id"], "valor_hora": "200.00"}]}).json()
        for nome, cargo, cpf in (("senior", sen, "111.444.777-35"), ("junior", jun, "123.456.789-09")):
            r = c.post("/api/config/usuarios", headers=h, json={
                "nome": f"Prof {nome}", "email": f"{nome}.faixas@cfme.com.br", "perfil": "visualizador", "acesso_sistema": False,
                "cargo_id": cargo["id"], "cpf": cpf, "oab": None, "cep": "01310-100", "logradouro": "Av. Paulista",
                "numero_endereco": "1000", "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP"})
            assert r.status_code == 200, r.text
            _PESSOAS[nome] = r.json()["id"]
        _PESSOAS["tabela"] = tab["id"]
    cli, contrato, caso = _base(c, h, sufixo)
    return cli, contrato, caso


def _regra(c, h, contrato, faixas_, modo="escalonada", caso=None, **extra):
    url = f"/api/faturamento/casos/{caso['id']}/regras" if caso else f"/api/faturamento/contratos/{contrato['id']}/regras"
    return c.post(url, headers=h, json={"tipo": "hora", "descricao": "Horas", "faixas_modo": modo, "faixas": faixas_, **extra})


def _hora(c, h, caso, dia: str, horas: float, quem: str = "senior", descricao: str = "Trabalho"):
    r = c.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={
        "profissional_id": _PESSOAS[quem], "data": dia, "minutos": int(horas * 60), "descricao": descricao})
    assert r.status_code == 201, r.text
    return f"ts:{r.json()['id']}"


def _itens(c, h, cli, de="2027-03-01", ate="2027-03-31") -> dict:
    dados = c.get("/api/faturamento/itens-a-faturar", headers=h, params={"de": de, "ate": ate, "cliente_ids": [cli["id"]]}).json()
    return {i["chave"]: i for cl in dados["clientes"] for ct in cl["contratos"] for i in ct["itens"]}


def _faturar(c, h, cli, chaves, de="2027-03-01", ate="2027-03-31"):
    return c.post("/api/faturamento/faturar", headers=h, json={
        "aba": "honorarios", "de": de, "ate": ate, "cliente_ids": [cli["id"]], "chaves": list(chaves)})


def test_posicao_das_horas_no_mes():
    """As horas novas entram no primeiro espaço livre: continuam de onde as faturadas pararam, sem pular nem repetir."""
    d = Decimal
    ocupado = [(d(5), d(10))]
    assert faixas._ocupar(ocupado, d(7)) == [(d(0), d(5)), (d(10), d(12))]
    assert ocupado == [(d(0), d(12))]
    assert faixas._ocupar(ocupado, d("1.5")) == [(d(12), d("13.5"))]


def test_validacao_das_faixas(cliente):  # noqa: F811
    h = _login(cliente)
    _, contrato, _ = _cenario(cliente, h, "FX0")
    fixo = {"forma": "fixo", "valor": "2000"}
    hora = {"forma": "hora", "valor": "300"}

    def erro(lista):
        r = _regra(cliente, h, contrato, lista)
        assert r.status_code == 422, r.text
        return r.text

    assert "começar em 0" in erro([{"de": 1, "ate": 10, **fixo}, {"de": 10, "ate": None, **hora}])
    assert "sobrou um buraco" in erro([{"de": 0, "ate": 10, **fixo}, {"de": 12, "ate": None, **hora}])
    assert "se sobrepõem" in erro([{"de": 0, "ate": 10, **fixo}, {"de": 8, "ate": None, **hora}])
    assert "em diante" in erro([{"de": 0, "ate": 10, **fixo}, {"de": 10, "ate": 20, **hora}])
    assert "sem limite" in erro([{"de": 0, "ate": None, **fixo}, {"de": 10, "ate": None, **hora}])
    assert "maior que o início" in erro([{"de": 0, "ate": 10, **fixo}, {"de": 10, "ate": 10, **hora}, {"de": 10, "ate": None, **hora}])
    assert "valor por hora da faixa 2" in erro([{"de": 0, "ate": 10, **fixo}, {"de": 10, "ate": None, "forma": "hora"}])
    assert "tabela de preço da faixa 1" in erro([{"de": 0, "ate": None, "forma": "tabela"}])
    assert "percentual da faixa 1" in erro([{"de": 0, "ate": None, "forma": "percentual"}])
    r = _regra(cliente, h, contrato, [{"de": 0, "ate": 10, **fixo}, {"de": 10, "ate": None, "forma": "tabela", "tabela_preco_id": 999999}])
    assert r.status_code == 404
    # regra de outro tipo ignora as faixas; a por hora guarda e devolve
    r = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Êxito", "valor": "10", "data_pagamento": "2027-01-01", "faixas": [{"de": 5, "forma": "fixo"}]})
    assert r.status_code == 201 and r.json()["faixas"] == []
    r = _regra(cliente, h, contrato, [{"de": 0, "ate": 10, **fixo}, {"de": 10, "ate": None, **hora}], modo="atingida")
    assert r.status_code == 201, r.text
    regra = r.json()
    assert [f["forma"] for f in regra["faixas"]] == ["fixo", "hora"] and regra["faixas_modo"] == "atingida"
    assert "2 faixas" in regra["resumo"] and "faixa atingida" in regra["resumo"]
    # tirar as faixas: a regra volta a cobrar como sempre
    r = cliente.put(f"/api/faturamento/regras/{regra['id']}", headers=h, json={"tipo": "hora", "descricao": "Horas", "faixas": []})
    assert r.status_code == 200 and r.json()["faixas"] == [] and "faixas" not in r.json()["resumo"]


def test_escalonada_valor_fixo_hora_e_tabela(cliente):  # noqa: F811
    """0–10 h valor fixo · 10–20 h R$ 300/h · acima de 20 h tabela × cargo. O mesmo valor em Itens a faturar, na
    Revisão e na fatura; lançamento que cruza a fronteira é dividido."""
    h = _login(cliente)
    cli, contrato, caso = _cenario(cliente, h, "FX1")
    r = _regra(cliente, h, contrato, [
        {"de": 0, "ate": 10, "forma": "fixo", "valor": "2000"}, {"de": 10, "ate": 20, "forma": "hora", "valor": "300"},
        {"de": 20, "ate": None, "forma": "tabela", "tabela_preco_id": _PESSOAS["tabela"]}])
    assert r.status_code == 201, r.text
    regra = r.json()
    a = _hora(cliente, h, caso, "2027-03-02", 6)  # 0–6: dentro do valor fixo
    b = _hora(cliente, h, caso, "2027-03-05", 6, "junior")  # 6–12: 4 h no fixo + 2 h × 300
    c = _hora(cliente, h, caso, "2027-03-10", 9)  # 12–21: 8 h × 300 + 1 h × 500 (sênior)
    d = _hora(cliente, h, caso, "2027-03-15", 2, "junior")  # 21–23: 2 h × 200 (júnior)
    itens = _itens(cliente, h, cli)
    fixo = f"faixa:{regra['id']}:2027-03:1"
    assert set(itens) == {a, b, c, d, fixo}
    assert [itens[k]["valor"] for k in (fixo, a, b, c, d)] == ["2000.00", "0.00", "600.00", "2900.00", "400.00"]
    assert itens[fixo]["data"] == "2027-03-02" and "valor fixo da faixa de 0 a 10 h (03/2027)" in itens[fixo]["descricao"]
    assert "10 h até agora" in itens[fixo]["detalhe"]
    assert itens[a]["detalhe"] == "Faixa de 0 a 10 h: 6 h dentro do valor fixo de R$ 2.000,00" and itens[a]["aviso"] is None
    assert itens[b]["detalhe"] == ("Faixa de 0 a 10 h: 4 h dentro do valor fixo de R$ 2.000,00; "
                                   "faixa de 10 a 20 h: 2 h × R$ 300,00 = R$ 600,00")
    assert "faixa acima de 20 h: 1 h × R$ 500,00 (tabela Faixas) = R$ 500,00" in itens[c]["detalhe"]
    assert itens[d]["valor_unitario"] == "200.00"
    # o filtro da tela não muda o valor: a posição vem do mês inteiro (e o valor fixo já vencido continua aparecendo)
    parte = _itens(cliente, h, cli, de="2027-03-09")
    assert set(parte) == {c, d, fixo} and parte[c]["valor"] == "2900.00"

    # o Timesheet mostra o mesmo valor que vai sair na fatura
    ts = cliente.get("/api/faturamento/timesheet", headers=h, params={"de": "2027-03-01", "ate": "2027-03-31", "caso_id": caso["id"]}).json()
    assert ts["resumo"]["valor_a_faturar"] == "3900.00" and ts["resumo"]["sem_valor_hora"] == 0

    # revisão → fatura
    r = cliente.post("/api/faturamento/revisoes", headers=h, json={
        "aba": "honorarios", "de": "2027-03-01", "ate": "2027-03-31", "cliente_ids": [cli["id"]], "chaves": list(itens)})
    assert r.status_code == 201, r.text
    rid = r.json()[0]["id"]
    assert r.json()[0]["total"] == "5900.00"
    rev = cliente.get(f"/api/faturamento/revisoes/{rid}", headers=h).json()
    assert next(i for i in rev["itens"] if i["chave"] == c)["detalhe"] == itens[c]["detalhe"]
    assert _itens(cliente, h, cli) == {}
    # hora lançada dentro da revisão (sem informar valor/hora) continua a contagem: 23–24 → tabela × sênior
    r = cliente.post(f"/api/faturamento/revisoes/{rid}/horas", headers=h, json={
        "caso_id": caso["id"], "profissional_id": _PESSOAS["senior"], "data": "2027-03-01", "minutos": 60, "descricao": "Reunião"})
    assert r.status_code == 201, r.text
    nova = next(i for i in r.json()["itens"] if i["descricao"] == "Reunião")
    assert nova["valor"] == "500.00" and "acima de 20 h" in nova["detalhe"]
    r = cliente.post(f"/api/faturamento/revisoes/{rid}/aprovar", headers=h)
    assert r.status_code == 200, r.text
    fat = cliente.get(f"/api/nfse/faturas/{r.json()['fatura_id']}", headers=h).json()
    assert fat["valor"] == "6400.00"
    assert _itens(cliente, h, cli) == {}

    # mais uma hora no mesmo mês, com data anterior: continua de onde as faturadas pararam (24–25) e o fixo não volta
    e = _hora(cliente, h, caso, "2027-03-01", 1, "junior")
    depois = _itens(cliente, h, cli)
    assert set(depois) == {e} and depois[e]["valor"] == "200.00"
    # mês seguinte: a contagem zera e o valor fixo de abril é outro item
    f = _hora(cliente, h, caso, "2027-04-03", 3)
    abril = _itens(cliente, h, cli, de="2027-04-01", ate="2027-04-30")
    assert set(abril) == {f, f"faixa:{regra['id']}:2027-04:1"} and abril[f]["valor"] == "0.00"


def test_nao_cobra_duas_vezes_mesmo_faturando_fora_de_ordem(cliente):  # noqa: F811
    """Regressiva: 0–10 h a R$ 400 · acima a R$ 250. Faturar só as horas do fim do mês não empurra as do começo
    para a faixa mais barata; cancelar a fatura devolve as horas no mesmo lugar."""
    h = _login(cliente)
    cli, contrato, caso = _cenario(cliente, h, "FX2")
    assert _regra(cliente, h, contrato, [{"de": 0, "ate": 10, "forma": "hora", "valor": "400"},
                                         {"de": 10, "ate": None, "forma": "hora", "valor": "250"}]).status_code == 201
    a = _hora(cliente, h, caso, "2027-03-01", 6)  # 0–6
    b = _hora(cliente, h, caso, "2027-03-20", 6)  # 6–12: 4 × 400 + 2 × 250
    itens = _itens(cliente, h, cli)
    assert (itens[a]["valor"], itens[b]["valor"], itens[b]["valor_unitario"]) == ("2400.00", "2100.00", "350.00")
    r = _faturar(cliente, h, cli, [b])
    assert r.status_code == 200 and r.json()["total"] == "2100.00", r.text
    fid = r.json()["faturas"][0]["id"]
    assert {k: v["valor"] for k, v in _itens(cliente, h, cli).items()} == {a: "2400.00"}
    assert _faturar(cliente, h, cli, [b]).status_code == 400  # já faturada: não está mais pendente
    # hora nova: ocupa o que sobrou depois das duas (12–15), não o lugar da que ainda não foi faturada
    c = _hora(cliente, h, caso, "2027-03-10", 3)
    itens = _itens(cliente, h, cli)
    assert (itens[a]["valor"], itens[c]["valor"]) == ("2400.00", "750.00")
    # cancelar devolve a hora ao mesmo valor do mês: 15 h = 10 × 400 + 5 × 250
    assert cliente.post(f"/api/faturamento/faturas/{fid}/cancelar", headers=h, json={"motivo": "teste das faixas"}).status_code == 200
    itens = _itens(cliente, h, cli)
    assert sum(Decimal(i["valor"]) for i in itens.values()) == Decimal("5250.00")
    r = _faturar(cliente, h, cli, list(itens))
    assert r.status_code == 200 and r.json()["total"] == "5250.00"
    assert _itens(cliente, h, cli) == {}


def test_horas_cobertas_pelo_valor_fixo_ja_faturado(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _cenario(cliente, h, "FX3")
    regra = _regra(cliente, h, contrato, [{"de": 0, "ate": 10, "forma": "fixo", "valor": "1500"},
                                          {"de": 10, "ate": None, "forma": "hora", "valor": "300"}]).json()
    a = _hora(cliente, h, caso, "2027-03-03", 4)
    fixo = f"faixa:{regra['id']}:2027-03:1"
    # só as horas (valor zero), sem o valor fixo: não vira fatura
    assert _faturar(cliente, h, cli, [a]).status_code == 400
    r = _faturar(cliente, h, cli, [a, fixo])
    assert r.status_code == 200 and r.json()["total"] == "1500.00", r.text
    # mais horas dentro da mesma faixa: valem zero e o valor fixo não aparece de novo
    b = _hora(cliente, h, caso, "2027-03-08", 3)
    itens = _itens(cliente, h, cli)
    assert set(itens) == {b} and itens[b]["valor"] == "0.00" and "dentro do valor fixo" in itens[b]["detalhe"]
    # "faturar" essas horas só as liga à fatura do valor fixo: nenhuma fatura nova, e somem da lista
    r = _faturar(cliente, h, cli, [b])
    assert r.status_code == 200 and r.json()["faturas"] == [], r.text
    assert _itens(cliente, h, cli) == {}
    ts = cliente.get("/api/faturamento/timesheet", headers=h, params={"de": "2027-03-01", "ate": "2027-03-31", "caso_id": caso["id"]}).json()
    assert all(x["faturado"] for x in ts["itens"])
    # passou do limite: 7–12 → 3 h no fixo (já pago) + 2 h × 300
    c = _hora(cliente, h, caso, "2027-03-20", 5)
    itens = _itens(cliente, h, cli)
    assert set(itens) == {c} and itens[c]["valor"] == "600.00"


def test_faixa_atingida_e_percentual_da_tabela_padrao(cliente):  # noqa: F811
    """Faixa atingida: o total do mês escolhe uma faixa só. Percentual: % do valor/hora da tabela padrão da regra."""
    h = _login(cliente)
    cli, contrato, caso = _cenario(cliente, h, "FX4")
    assert _regra(cliente, h, contrato, modo="atingida", tabela_preco_id=_PESSOAS["tabela"], faixas_=[
        {"de": 0, "ate": 10, "forma": "percentual", "percentual": "100"},
        {"de": 10, "ate": None, "forma": "percentual", "percentual": "80"}]).status_code == 201
    a = _hora(cliente, h, caso, "2027-03-02", 8)
    b = _hora(cliente, h, caso, "2027-03-04", 2, "junior")
    itens = _itens(cliente, h, cli)  # 10 h cravadas: ainda é a primeira faixa
    assert (itens[a]["valor"], itens[b]["valor"]) == ("4000.00", "400.00")
    c = _hora(cliente, h, caso, "2027-03-09", 2.5)
    itens = _itens(cliente, h, cli)  # 12,5 h: todas a 80% da tabela
    assert [itens[k]["valor"] for k in (a, b, c)] == ["3200.00", "320.00", "1000.00"]
    assert itens[c]["detalhe"] == "Total do mês: 12,5 h → faixa acima de 10 h: 2,5 h × R$ 400,00 (80% da tabela padrão) = R$ 1.000,00"

    # sem cargo na tabela da faixa: avisa e não deixa faturar (como na regra sem faixas)
    cli2, contrato2, caso2 = _cenario(cliente, h, "FX5")
    vazia = cliente.post("/api/faturamento/tabelas", headers=h, json={"nome": "Faixas vazia", "itens": []}).json()
    assert _regra(cliente, h, contrato2, [{"de": 0, "ate": None, "forma": "tabela", "tabela_preco_id": vazia["id"]}]).status_code == 201
    x = _hora(cliente, h, caso2, "2027-03-02", 1)
    itens = _itens(cliente, h, cli2)
    assert itens[x]["aviso"] and Decimal(itens[x]["valor"]) == 0
    assert _faturar(cliente, h, cli2, [x]).status_code == 400
    # a tabela usada numa faixa não é excluída, só desativada
    assert "desativada" in cliente.delete(f"/api/faturamento/tabelas/{vazia['id']}", headers=h).json()["mensagem"]


def test_regra_do_contrato_soma_as_horas_de_todos_os_casos(cliente):  # noqa: F811
    """As faixas contam as horas de todos os casos que a regra cobre; mesmo com "uma fatura por caso", as horas e o
    valor fixo da regra saem numa cobrança só. Caso com regra própria fica de fora da contagem."""
    h = _login(cliente)
    cli, contrato, caso1 = _cenario(cliente, h, "FX6")
    caso2 = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Segundo"}).json()
    caso3 = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Com regra própria"}).json()
    regra = _regra(cliente, h, contrato, [{"de": 0, "ate": 5, "forma": "fixo", "valor": "1000"},
                                          {"de": 5, "ate": None, "forma": "hora", "valor": "100"}]).json()
    assert cliente.post(f"/api/faturamento/casos/{caso3['id']}/regras", headers=h, json={
        "tipo": "hora", "descricao": "Horas do caso", "tabela_preco_id": _PESSOAS["tabela"]}).status_code == 201
    a = _hora(cliente, h, caso1, "2027-03-02", 4)
    z = _hora(cliente, h, caso3, "2027-03-03", 2)  # regra própria, sem faixas: 2 × 500
    b = _hora(cliente, h, caso2, "2027-03-04", 3)  # 4–7: 1 h no fixo + 2 × 100
    itens = _itens(cliente, h, cli)
    fixo = f"faixa:{regra['id']}:2027-03:1"
    assert {k: v["valor"] for k, v in itens.items()} == {a: "0.00", b: "200.00", z: "1000.00", fixo: "1000.00"}
    assert itens[z]["detalhe"] is None
    assert cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h, json={"fatura_agrupamento": "caso"}).status_code == 200
    r = _faturar(cliente, h, cli, list(itens))
    assert r.status_code == 200, r.text
    assert sorted(f["valor"] for f in r.json()["faturas"]) == ["1000.00", "1200.00"]
    assert _itens(cliente, h, cli) == {}

    # relatório de regras: coluna "Tabela por faixas de horas"
    rel = cliente.post("/api/relatorios/executar", headers=h, json={"fonte": "regras", "colunas": ["descricao", "faixas"]})
    assert rel.status_code == 200, rel.text
    assert {tuple(x) for x in rel.json()["linhas"]} >= {("Horas", True), ("Horas do caso", False)}
