"""Comissões: regras por profissional (geral × cliente × contrato × caso), apuração pelos recebimentos e conta a pagar.

O arquivo roda depois de test_faturamento/test_financas de propósito: aqueles testes contam as ND e as categorias do
banco inteiro (que é um só para a suíte), e este aqui cria uma ND e a categoria "Comissões".
"""

from datetime import date
from decimal import Decimal
from io import BytesIO

from openpyxl import load_workbook

from app.modules.comissoes import service
from app.modules.comissoes.models import RegraComissao
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_perfis import _usuario_com_perfil

# pagamentos numa data só deste teste: o período isola dos recebimentos dos outros testes (o banco é o mesmo)
PAGO = "2025-03-10"
PERIODO = {"de": "2025-03-01", "ate": "2025-03-31"}


def test_distribuicao_e_regra_mais_especifica():
    assert service.distribuir(Decimal("100.00"), [Decimal(1), Decimal(1), Decimal(1)]) == [
        Decimal("33.33"), Decimal("33.33"), Decimal("33.34")]  # os centavos ficam na última parte
    assert service.distribuir(Decimal("50.00"), [Decimal(0)]) == [Decimal("50.00")]
    assert service.rotulo_periodo(date(2025, 3, 1), date(2025, 3, 31)) == "março/2025"
    assert service.rotulo_periodo(date(2025, 3, 1), date(2025, 3, 15)) == "01/03/2025 a 15/03/2025"

    def regra(i, alcance, pct, **kw):
        return RegraComissao(id=i, usuario_id=1, alcance=alcance, percentual=Decimal(pct), ativo=True, **kw)

    parte = service.Parte(caso_id=7, contrato_id=3, cliente_id=2, pagador_id=9, base=Decimal(100))
    geral, cli = regra(1, "geral", 5), regra(2, "cliente", 10, tomador_id=2)
    contrato, caso = regra(3, "contrato", 15, contrato_id=3), regra(4, "caso", 20, caso_id=7)
    dia = date(2025, 3, 10)
    assert service.escolher_regra([geral, cli, contrato, caso], parte, dia) is caso
    assert service.escolher_regra([geral, cli, contrato], parte, dia) is contrato
    assert service.escolher_regra([geral, cli], parte, dia) is cli
    assert service.escolher_regra([geral, regra(5, "cliente", 8, tomador_id=9)], parte, dia).id == 5  # quem pagou também conta
    assert service.escolher_regra([geral, regra(6, "caso", 20, caso_id=99)], parte, dia) is geral
    # vigência: a regra do caso só vale para pagamentos a partir de abril
    futura = regra(7, "caso", 30, caso_id=7, vigencia_inicio=date(2025, 4, 1))
    assert service.escolher_regra([geral, futura], parte, dia) is geral
    assert service.escolher_regra([geral, futura], parte, date(2025, 4, 1)) is futura
    # duas gerais: vale a de vigência mais recente que já começou
    nova = regra(8, "geral", 6, vigencia_inicio=date(2025, 3, 1))
    assert service.escolher_regra([geral, nova], parte, dia) is nova
    assert service.escolher_regra([], parte, dia) is None


def _cliente(c, h, nome, n):
    r = c.post("/api/nfse/tomadores", headers=h, json={
        "tipo": "PJ", "nome": nome, "cidade": "São Paulo", "uf": "SP", "cpf_cnpj": _cnpj(n), "tipo_logradouro": "R",
        "logradouro": "RUA AUGUSTA", "numero": "1", "bairro": "CONSOLACAO", "cep": "01305000", "emails": ["com@cliente.com.br"]})
    assert r.status_code in (200, 201), r.text
    return r.json()


def _contrato(c, h, cli, nome):
    r = c.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": nome})
    assert r.status_code == 201, r.text
    return r.json()


def _caso(c, h, contrato, titulo, **kw):
    r = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": titulo, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def _cobrar(c, h, caso, valor, desc="Honorários"):
    r = c.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": desc, "valor": valor, "data_pagamento": date.today().isoformat()})
    assert r.status_code == 201, r.text


def _faturar(c, h, cli, aba="honorarios"):
    hoje = date.today().isoformat()
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    contratos = c.get("/api/faturamento/itens-a-faturar", headers=h, params={**params, "aba": aba}).json()["clientes"][0]["contratos"]
    r = c.post("/api/faturamento/faturar", headers=h, json={"aba": aba, **params,
                                                            "chaves": [i["chave"] for k in contratos for i in k["itens"]]})
    assert r.status_code in (200, 201), r.text
    return r.json()["faturas"]


def _pagar(c, h, fatura, valor=None):
    r = c.post(f"/api/nfse/faturas/{fatura['id']}/baixa", headers=h, json={"data": PAGO, "valor": valor})
    assert r.status_code == 200, r.text


def _regra(c, h, uid, alcance, pct, **alvo):
    r = c.post(f"/api/config/usuarios/{uid}/comissoes", headers=h, json={"alcance": alcance, "percentual": pct, **alvo})
    assert r.status_code == 201, r.text
    return r.json()


def _apurar(c, h, **filtros):
    r = c.get("/api/financeiro/comissoes", headers=h, params={**PERIODO, **filtros})
    assert r.status_code == 200, r.text
    return r.json()


def test_comissoes_do_calculo_a_conta_a_pagar(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    ana, h_ana, _ = _usuario_com_perfil(c, h, "ana.comissao@cfme.com.br", perfis["Advogado"]["id"])
    beto, h_beto, _ = _usuario_com_perfil(c, h, "beto.comissao@cfme.com.br", perfis["Visualizador"]["id"])

    x = _cliente(c, h, "Cliente Comissão X", 81000001)
    y = _cliente(c, h, "Cliente Comissão Y", 81000002)
    k1, k2, k3 = _contrato(c, h, x, "Contencioso X"), _contrato(c, h, x, "Consultivo X"), _contrato(c, h, y, "Consultivo Y")
    area = c.post("/api/faturamento/areas", headers=h, json={"nome": "Tributário comissão"})
    assert area.status_code == 201, area.text
    caso_a, caso_b = _caso(c, h, k1, "Caso A", area_id=area.json()["id"]), _caso(c, h, k1, "Caso B")
    caso_c, caso_d = _caso(c, h, k2, "Caso C"), _caso(c, h, k3, "Caso D")

    # ---- regras: busca do alvo, validação e duplicidade
    alvos = c.get("/api/config/usuarios/comissoes/alvos", headers=h, params={"alcance": "caso", "q": "Caso A"}).json()
    assert any(a["id"] == caso_a["id"] and a["detalhe"] == "Cliente Comissão X" for a in alvos)
    assert c.get("/api/config/usuarios/comissoes/alvos", headers=h, params={"alcance": "contrato", "q": "Contencioso X"}).json()[0]["id"] == k1["id"]
    assert c.get("/api/config/usuarios/comissoes/alvos", headers=h, params={"alcance": "cliente", "q": "Comissão Y"}).json()[0]["id"] == y["id"]
    geral = _regra(c, h, ana["id"], "geral", "5")
    _regra(c, h, ana["id"], "cliente", "10", tomador_id=x["id"])
    _regra(c, h, ana["id"], "contrato", "15", contrato_id=k1["id"])
    r_caso = _regra(c, h, ana["id"], "caso", "20", caso_id=caso_a["id"])
    assert r_caso["alvo"] == f"#{caso_a['numero']} — Caso A" and r_caso["alvo_detalhe"] == "Cliente Comissão X"
    _regra(c, h, beto["id"], "geral", "2")
    assert c.post(f"/api/config/usuarios/{ana['id']}/comissoes", headers=h, json={"alcance": "geral", "percentual": "7"}).status_code == 400
    assert c.post(f"/api/config/usuarios/{ana['id']}/comissoes", headers=h, json={"alcance": "caso", "percentual": "7"}).status_code == 400
    assert c.post(f"/api/config/usuarios/{ana['id']}/comissoes", headers=h, json={"alcance": "geral", "percentual": "101"}).status_code == 422
    assert len(c.get(f"/api/config/usuarios/{ana['id']}/comissoes", headers=h).json()) == 4

    # ---- faturas: uma com itens de dois casos (A 1.000 + B 500), C 800 e D 400; e uma ND no caso A
    _cobrar(c, h, caso_a, "1000.00")
    _cobrar(c, h, caso_b, "500.00")
    _cobrar(c, h, caso_c, "800.00")
    _cobrar(c, h, caso_d, "400.00")
    c.post(f"/api/faturamento/casos/{caso_a['id']}/despesas", headers=h, json={
        "data": date.today().isoformat(), "tipo": "custas", "descricao": "Guia", "valor": "150.00"})
    do_x = sorted(_faturar(c, h, x), key=lambda f: Decimal(f["valor"]))
    f_c, f_ab = do_x  # uma fatura por contrato
    f_d = _faturar(c, h, y)[0]
    nd = _faturar(c, h, x, "despesas")[0]
    assert Decimal(f_ab["valor"]) == 1500 and nd["codigo"].startswith("ND ")
    assert _apurar(c, h)["linhas"] == []  # nada pago ainda: nada de comissão
    for f in (f_ab, f_c, f_d, nd):
        _pagar(c, h, f)

    d = _apurar(c, h)
    da_ana = {x["caso"].split(" — ")[1]: x for x in d["linhas"] if x["usuario_id"] == ana["id"]}
    assert {k: (v["base"], float(v["percentual"]), v["comissao"], v["alcance"]) for k, v in da_ana.items()} == {
        "Caso A": (1000, 20, 200, "caso"), "Caso B": (500, 15, 75, "contrato"),
        "Caso C": (800, 10, 80, "cliente"), "Caso D": (400, 5, 20, "geral")}
    assert da_ana["Caso A"]["area"] == "Tributário comissão" and da_ana["Caso B"]["area"] is None
    assert da_ana["Caso A"]["fatura_id"] == da_ana["Caso B"]["fatura_id"] == f_ab["id"]  # a mesma fatura, dois casos
    assert da_ana["Caso A"]["cliente"] == "Cliente Comissão X" and da_ana["Caso A"]["regra"].startswith("Caso #")
    assert not any(x["fatura_id"] == nd["id"] for x in d["linhas"])  # ND (reembolso) não gera comissão
    # dois profissionais sobre o mesmo recebimento: a base não dobra
    assert d["kpis"]["base"] == 2700 and d["kpis"]["comissao"] == 375 + 54 and d["kpis"]["a_pagar"] == 429
    assert d["kpis"]["recebimentos"] == 3 and d["kpis"]["comissoes"] == 6 and d["divergencias"] == []
    assert {o["nome"] for o in d["opcoes"]["clientes"]} == {"Cliente Comissão X", "Cliente Comissão Y"}
    # filtros
    assert _apurar(c, h, usuario_id=beto["id"])["kpis"]["comissao"] == 54
    assert _apurar(c, h, tomador_id=y["id"], usuario_id=ana["id"])["kpis"]["comissao"] == 20
    assert _apurar(c, h, situacao="paga")["linhas"] == []
    assert c.get("/api/financeiro/comissoes", headers=h, params={"de": "2025-04-01", "ate": "2025-04-30"}).json()["linhas"] == []

    # regra de 0% mais específica tira o caso da comissão; inativar a regra devolve
    zero = _regra(c, h, beto["id"], "caso", "0", caso_id=caso_d["id"])
    assert _apurar(c, h, usuario_id=beto["id"])["kpis"]["comissao"] == 46
    r = c.put(f"/api/config/usuarios/{beto['id']}/comissoes/{zero['id']}", headers=h, json={
        "alcance": "caso", "percentual": "0", "caso_id": caso_d["id"], "ativo": False})
    assert r.status_code == 200 and not r.json()["ativo"]
    assert _apurar(c, h, usuario_id=beto["id"])["kpis"]["comissao"] == 54
    assert c.delete(f"/api/config/usuarios/{beto['id']}/comissoes/{zero['id']}", headers=h).status_code == 200

    # ---- Excel
    r = c.get("/api/financeiro/comissoes/exportar.xlsx", headers=h, params=PERIODO)
    assert r.status_code == 200, r.text
    wb = load_workbook(BytesIO(r.content))
    assert wb.sheetnames == ["Comissões", "Por profissional"] and wb["Comissões"].max_row == 4 + 8 + 1  # topo + 8 fatias + total

    # ---- gerar conta a pagar: uma por profissional, com o valor recalculado no servidor
    escolhidas = [{"fatura_id": f["id"], "usuario_id": u["id"]} for f in (f_ab, f_c) for u in (ana, beto)]
    pedido = {"itens": escolhidas, "data_vencimento": "2025-04-05", **PERIODO}
    r = c.post("/api/financeiro/comissoes/gerar-conta", headers=h, json=pedido)
    assert r.status_code == 201, r.text
    contas = {k["usuario_id"]: k for k in r.json()["contas"]}
    assert len(contas) == 2 and r.json()["categoria"] == "Comissões"
    assert contas[ana["id"]]["valor"] == 355 and contas[ana["id"]]["descricao"] == "Comissão de ana.comissao — março/2025"
    assert contas[beto["id"]]["valor"] == 46 and contas[beto["id"]]["comissoes"] == 2
    conta = c.get(f"/api/financeiro/contas-pagar/{contas[ana['id']]['id']}", headers=h).json()
    assert conta["funcionario_id"] == ana["id"] and conta["favorecido_nome"] == "ana.comissao"  # o favorecido é o profissional
    assert conta["categoria_nome"] == "Comissões" and conta["data_vencimento"] == "2025-04-05" and conta["status"] == "atrasado"
    assert f_ab["codigo"] in conta["observacao"] and f_c["codigo"] in conta["observacao"]
    cats = [k for k in c.get("/api/financeiro/categorias", headers=h, params={"tipo": "despesa"}).json() if k["nome"] == "Comissões"]
    assert len(cats) == 1 and cats[0]["grupo_dre"] == "pessoal"
    d = _apurar(c, h)
    assert d["kpis"]["conta_gerada"] == 401 and d["kpis"]["a_pagar"] == 28 and d["kpis"]["paga"] == 0
    assert {x["conta_pagar_id"] for x in d["linhas"] if x["usuario_id"] == ana["id"] and x["situacao"] == "conta_gerada"} == {conta["id"]}

    # repetir não duplica; pedir junto uma comissão nova gera conta só da nova
    total_antes = c.get("/api/financeiro/contas-pagar", headers=h, params={"funcionario_id": ana["id"]}).json()["total"]
    r = c.post("/api/financeiro/comissoes/gerar-conta", headers=h, json=pedido)
    assert r.status_code == 400 and "já têm conta" in r.json()["detail"]
    assert c.get("/api/financeiro/contas-pagar", headers=h, params={"funcionario_id": ana["id"]}).json()["total"] == total_antes
    r = c.post("/api/financeiro/comissoes/gerar-conta", headers=h, json={
        **pedido, "itens": [*escolhidas, {"fatura_id": f_d["id"], "usuario_id": ana["id"]}], "categoria_id": cats[0]["id"]})
    assert r.status_code == 201 and r.json()["ja_lancadas"] == 4  # as quatro (recebimento × profissional) que já tinham conta
    assert [(k["usuario_id"], k["valor"]) for k in r.json()["contas"]] == [(ana["id"], 20)]
    conta_d = r.json()["contas"][0]
    assert c.post("/api/financeiro/comissoes/gerar-conta", headers=h, json={
        **pedido, "itens": [{"fatura_id": nd["id"], "usuario_id": ana["id"]}]}).status_code == 400  # ND não tem comissão

    # ---- conta paga → comissão paga; reaberta → conta gerada; excluída → volta a "a pagar"
    r = c.post(f"/api/financeiro/contas-pagar/{conta['id']}/pagar", headers=h, json={"data": "2025-04-05"})
    assert r.status_code == 200, r.text
    d = _apurar(c, h)
    assert d["kpis"]["paga"] == 355 and d["kpis"]["conta_gerada"] == 46 + 20 and d["kpis"]["a_pagar"] == 8
    assert _apurar(c, h, situacao="paga")["kpis"]["comissoes"] == 2
    assert c.post(f"/api/financeiro/contas-pagar/{conta['id']}/reabrir", headers=h).status_code == 200
    assert _apurar(c, h)["kpis"]["paga"] == 0
    assert c.delete(f"/api/financeiro/contas-pagar/{conta_d['id']}", headers=h).status_code == 200
    d = _apurar(c, h, usuario_id=ana["id"])
    assert d["kpis"]["a_pagar"] == 20 and d["kpis"]["conta_gerada"] == 355
    assert next(x for x in d["linhas"] if x["fatura_id"] == f_d["id"])["conta_pagar_id"] is None

    # ---- regra muda depois do lançamento: a linha aponta a diferença, a conta fica como está
    r = c.put(f"/api/config/usuarios/{ana['id']}/comissoes/{r_caso['id']}", headers=h, json={
        "alcance": "caso", "percentual": "25", "caso_id": caso_a["id"]})
    assert r.status_code == 200
    d = _apurar(c, h, usuario_id=ana["id"])
    assert all("R$ 275,00" in x["divergencia"] and "R$ 325,00" in x["divergencia"] for x in d["linhas"] if x["fatura_id"] == f_ab["id"])
    assert next(x for x in d["linhas"] if x["fatura_id"] == f_c["id"])["divergencia"] is None
    c.put(f"/api/config/usuarios/{ana['id']}/comissoes/{r_caso['id']}", headers=h, json={
        "alcance": "caso", "percentual": "20", "caso_id": caso_a["id"]})

    # ---- baixa desfeita: sem conta, a comissão some; com conta, vira divergência (nada é apagado)
    assert c.delete(f"/api/nfse/faturas/{f_d['id']}/baixa", headers=h).status_code == 200
    assert c.delete(f"/api/nfse/faturas/{f_c['id']}/baixa", headers=h).status_code == 200
    d = _apurar(c, h)
    assert not any(x["fatura_id"] in (f_c["id"], f_d["id"]) for x in d["linhas"])
    assert {(x["fatura_id"], x["usuario_id"], x["comissao"]) for x in d["divergencias"]} == {
        (f_c["id"], ana["id"], 80), (f_c["id"], beto["id"], 16)}
    assert all("estornado" in x["divergencia"] and x["situacao"] == "conta_gerada" for x in d["divergencias"])
    assert d["kpis"]["base"] == 1500 and d["kpis"]["divergencias"] == 2
    assert c.get(f"/api/financeiro/contas-pagar/{conta['id']}", headers=h).json()["valor"] == "355.00"
    wb = load_workbook(BytesIO(c.get("/api/financeiro/comissoes/exportar.xlsx", headers=h, params=PERIODO).content))
    assert "Divergências" in wb.sheetnames
    # fatura cancelada depois do estorno: continua como divergência, agora dizendo que foi cancelada
    r = c.post(f"/api/faturamento/faturas/{f_c['id']}/cancelar", headers=h, json={"motivo": "Cobrança indevida"})
    assert r.status_code == 200, r.text
    assert all("cancelada" in x["divergencia"] for x in _apurar(c, h)["divergencias"])
    # a fatura D (sem conta) cancelada não gera nada
    assert c.post(f"/api/faturamento/faturas/{f_d['id']}/cancelar", headers=h, json={"motivo": "Erro"}).status_code == 200
    assert len(_apurar(c, h)["divergencias"]) == 2

    # ---- permissões: quem barra é o servidor
    assert c.get("/api/financeiro/comissoes", headers=h_ana, params=PERIODO).status_code == 403  # Advogado: sem financeiro
    assert c.get("/api/financeiro/comissoes/exportar.xlsx", headers=h_ana, params=PERIODO).status_code == 403
    assert c.get(f"/api/config/usuarios/{ana['id']}/comissoes", headers=h_ana).status_code == 403  # nem as próprias regras
    assert c.get("/api/financeiro/comissoes", headers=h_beto, params=PERIODO).status_code == 200  # Visualizador: só vê
    assert c.post("/api/financeiro/comissoes/gerar-conta", headers=h_beto, json=pedido).status_code == 403
    assert c.post(f"/api/config/usuarios/{beto['id']}/comissoes", headers=h_beto, json={"alcance": "geral", "percentual": "50"}).status_code == 403
    assert c.delete(f"/api/config/usuarios/{ana['id']}/comissoes/{geral['id']}", headers=h_beto).status_code == 403
    assert "comissoes.ver" in perfis["Financeiro"]["permissoes"] and "comissoes.editar" in perfis["Financeiro"]["permissoes"]
    assert "comissoes.editar" in perfis["Operador"]["permissoes"] and "comissoes.ver" not in perfis["Advogado"]["permissoes"]
    assert perfis["Visualizador"]["permissoes"].count("comissoes.ver") == 1 and "comissoes.editar" not in perfis["Visualizador"]["permissoes"]


def test_pagamento_parcial_da_nota(cliente):  # noqa: F811
    """Com NFS-e, a baixa informa o valor pago: a comissão é sobre o que entrou, dividido entre os casos."""
    c, h = cliente, _login(cliente)
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    caio, _, _ = _usuario_com_perfil(c, h, "caio.comissao@cfme.com.br", perfis["Advogado"]["id"])
    z = _cliente(c, h, "Cliente Comissão Z", 81000003)
    k = _contrato(c, h, z, "Contencioso Z")
    caso_1, caso_2 = _caso(c, h, k, "Caso Um"), _caso(c, h, k, "Caso Dois")
    _regra(c, h, caio["id"], "contrato", "10", contrato_id=k["id"])
    _regra(c, h, caio["id"], "caso", "30", caso_id=caso_2["id"])
    _cobrar(c, h, caso_1, "2000.00")
    _cobrar(c, h, caso_2, "1000.00")
    fat = _faturar(c, h, z)[0]
    r = c.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [fat["id"]]})
    assert r.status_code == 200, r.text
    assert c.post(f"/api/nfse/importacoes/{r.json()['lote_id']}/emitir", headers=h).status_code == 200
    assert c.get(f"/api/nfse/faturas/{fat['id']}", headers=h).json()["nfse_id"]
    _pagar(c, h, fat, "1500.00")  # o cliente pagou metade dos R$ 3.000

    d = _apurar(c, h, usuario_id=caio["id"])
    linhas = {x["caso"].split(" — ")[1]: x for x in d["linhas"]}
    assert (linhas["Caso Um"]["base"], linhas["Caso Um"]["comissao"]) == (1000, 100)  # 2/3 de 1.500 × 10%
    assert (linhas["Caso Dois"]["base"], linhas["Caso Dois"]["comissao"]) == (500, 150)  # 1/3 de 1.500 × 30%
    assert d["kpis"]["base"] == 1500 and d["kpis"]["comissao"] == 250
