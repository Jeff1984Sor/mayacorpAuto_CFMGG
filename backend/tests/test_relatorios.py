"""Relatórios: catálogo por perfil, filtros, gráfico agrupado, Excel com gráfico e relatórios salvos."""

from datetime import date, timedelta
from io import BytesIO

from openpyxl import load_workbook

from app.modules.relatorios.motor import periodo_relativo
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_perfis import _usuario_com_perfil


def test_periodos_relativos():
    hoje = date(2026, 11, 27)
    assert periodo_relativo("mes_passado", hoje) == (date(2026, 10, 1), date(2026, 10, 31))
    assert periodo_relativo("ultimos_12m", hoje) == (date(2025, 12, 1), hoje)
    assert periodo_relativo("ultimos_12m", date(2026, 12, 5)) == (date(2026, 1, 1), date(2026, 12, 5))
    assert periodo_relativo("este_ano", hoje) == (date(2026, 1, 1), date(2026, 12, 31))
    assert periodo_relativo("proximo_mes", hoje) == (date(2026, 12, 1), date(2026, 12, 31))
    assert periodo_relativo("hoje_em_diante", hoje) == (hoje, None)


def _dados(c, h):
    nome = "Cliente Relatórios Ltda"
    cli = c.post("/api/nfse/tomadores", headers=h, json={
        "tipo": "PJ", "nome": nome, "cidade": "São Paulo", "uf": "SP", "cpf_cnpj": _cnpj(70512301), "tipo_logradouro": "R",
        "logradouro": "RUA AUGUSTA", "numero": "1", "bairro": "CONSOLACAO", "cep": "01305000", "emails": ["rel@cliente.com.br"]})
    assert cli.status_code in (200, 201), cli.text
    contrato = c.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli.json()["id"], "nome": "Contencioso Rel"}).json()
    caso = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Ação indenizatória Rel"}).json()
    for d, m in (("2026-01-10", 90), ("2026-03-05", 60)):
        assert c.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={
            "data": d, "minutos": m, "descricao": f"Trabalho {d}"}).status_code == 201
    c.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-03-06", "tipo": "custas", "descricao": "Guia", "valor": "150.00"})
    t = c.post("/api/faturamento/tarefas", headers=h, json={
        "caso_id": caso["id"], "titulo": "Audiência de conciliação", "tipo": "audiencia",
        "prazo": (date.today() + timedelta(days=5)).isoformat(), "hora": "14:00"})
    assert t.status_code == 201, t.text
    return nome, caso


def test_relatorios_graficos_excel_e_salvos(cliente):  # noqa: F811
    h = _login(cliente)
    nome, caso = _dados(cliente, h)

    cat = cliente.get("/api/relatorios/catalogo", headers=h).json()
    fontes = {f["id"]: f for f in cat["fontes"]}
    assert {"horas", "casos", "tarefas", "regras", "despesas", "faturas", "andamentos"} <= set(fontes)
    assert any(c["id"] == "valor" for c in fontes["horas"]["colunas"])  # administrador vê dinheiro
    prontos = {p["id"] for p in cat["prontos"]}
    assert {"horas-por-cliente", "pauta-de-audiencia", "casos-por-foro", "agenda", "horas-faturadas"} <= prontos

    so_cliente = {"coluna": "cliente", "valores": [nome]}
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "horas", "colunas": ["data", "caso", "horas", "situacao"], "filtros": [so_cliente],
        "grafico": {"tipo": "barras", "dimensao": "data", "granularidade": "mes", "medida": "horas"},
        "ordenar": [{"coluna": "data", "desc": True}]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total_linhas"] == 2 and d["linhas"][0][0] == "2026-03-05"  # mais recente primeiro
    assert d["totais"]["horas"]["soma"] == 2.5
    g = d["grafico"]
    # a linha do tempo é contínua: fevereiro aparece zerado
    assert [(c["rotulo"], c["total"]) for c in g["categorias"]] == [("jan/26", 1.5), ("fev/26", 0.0), ("mar/26", 1.0)]
    assert g["categorias"][0]["de"] == "2026-01-01" and g["categorias"][0]["ate"] == "2026-01-31"

    # filtro por período + "não é" + texto
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "horas", "filtros": [so_cliente, {"coluna": "data", "de": "2026-03-01", "ate": "2026-03-31"},
                                      {"coluna": "descricao", "contem": "TRABALHO"}],
        "grafico": {"tipo": "rosca", "dimensao": "situacao", "medida": "horas"}}).json()
    assert r["total_linhas"] == 1 and r["grafico"]["categorias"][0]["valor"] == "A faturar"
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "horas", "filtros": [so_cliente, {"coluna": "data", "relativo": "mes_passado", "negar": True}]}).json()
    assert r["total_linhas"] == 2

    # casos por cliente (contagem) e pauta de audiência
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "filtros": [so_cliente], "grafico": {"tipo": "barras_h", "dimensao": "cliente", "serie": "status"}}).json()
    assert r["grafico"]["categorias"][0]["total"] == 1 and r["grafico"]["series"] == ["Aberto"]
    linha = dict(zip([c["id"] for c in r["colunas"]], r["linhas"][0]))
    assert linha["titulo"] == "Ação indenizatória Rel" and "numero" not in r["totais"]  # Nº do caso não se soma
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "colunas": ["titulo", "horas", "tarefas_abertas"], "filtros": [so_cliente]}).json()
    assert r["linhas"][0] == ["Ação indenizatória Rel", 2.5, 1]
    # campos novos: data de cadastro (hoje), status, UF e despesas do caso
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "colunas": ["titulo", "cadastro", "cliente_uf", "despesas", "contrato_ativo", "cliente_doc"],
        "filtros": [so_cliente, {"coluna": "cadastro", "relativo": "hoje"}, {"coluna": "status", "valores": ["Aberto"]},
                    {"coluna": "cliente_uf", "valores": ["SP"]}]}).json()
    assert r["total_linhas"] == 1 and r["linhas"][0][2:5] == ["SP", 150.0, True] and "/" in r["linhas"][0][5]
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "filtros": [so_cliente, {"coluna": "cadastro", "relativo": "mes_passado"}]}).json()
    assert r["total_linhas"] == 0
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "horas", "filtros": [so_cliente, {"coluna": "caso_status", "valores": ["Aberto"]},
                                      {"coluna": "cadastro", "relativo": "hoje"}]}).json()
    assert r["total_linhas"] == 2
    r = cliente.post("/api/relatorios/executar", headers=h, json={
        "fonte": "tarefas", "filtros": [so_cliente, {"coluna": "tipo", "valores": ["Audiência"]},
                                        {"coluna": "prazo", "relativo": "hoje_em_diante"}]}).json()
    assert r["total_linhas"] == 1
    vals = cliente.get("/api/relatorios/valores", headers=h, params={"fonte": "despesas", "coluna": "tipo"}).json()
    assert {"valor": "Custas", "qtd": 1} in vals or any(v["valor"] == "Custas" for v in vals)

    # Excel: dados + aba com gráfico nativo
    x = cliente.post("/api/relatorios/exportar", headers=h, json={
        "fonte": "horas", "titulo": "Horas do cliente", "colunas": ["data", "cliente", "horas"], "filtros": [so_cliente],
        "grafico": {"tipo": "barras", "dimensao": "data", "granularidade": "mes", "medida": "horas"}})
    assert x.status_code == 200, x.text
    wb = load_workbook(BytesIO(x.content))
    assert wb.sheetnames == ["Relatório", "Gráfico"]
    ws = wb["Relatório"]
    assert ws["A1"].value == "Horas do cliente" and [c.value for c in ws[4]] == ["Data", "Cliente", "Horas"]
    assert ws["C5"].number_format == "[h]:mm" and len(wb["Gráfico"]._charts) == 1

    # salvos: meu, compartilhado e permissão de alterar
    cfg = {"colunas": ["data", "horas"], "filtros": [so_cliente], "grafico": {"tipo": "linhas", "dimensao": "data"}}
    s = cliente.post("/api/relatorios/salvos", headers=h, json={"nome": "Minhas horas", "fonte": "horas", "config": cfg})
    assert s.status_code == 201, s.text
    s = s.json()
    assert s["meu"] and s["config"]["grafico"]["tipo"] == "linhas"
    assert cliente.post("/api/relatorios/salvos", headers=h, json={
        "nome": "Inválido", "fonte": "horas", "config": {"grafico": {"tipo": "pizza3d"}}}).status_code == 422

    perfis = {p["nome"]: p for p in cliente.get("/api/config/perfis", headers=h).json()}
    _, ha, _ = _usuario_com_perfil(cliente, h, "advogado.relatorios@cfme.com.br", perfis["Advogado"]["id"])
    cat = cliente.get("/api/relatorios/catalogo", headers=ha).json()
    fontes = {f["id"]: f for f in cat["fontes"]}
    assert "faturas" not in fontes and "horas-faturadas" not in {p["id"] for p in cat["prontos"]}
    assert not any(c["tipo"] == "moeda" for c in fontes["horas"]["colunas"])  # sem acesso ao faturamento: sem valores
    assert all(x["id"] != s["id"] for x in cat["salvos"])  # não compartilhado
    assert cliente.post("/api/relatorios/executar", headers=ha, json={"fonte": "faturas"}).status_code == 404
    # perfil sem "ver as de todos": só as próprias horas
    r = cliente.post("/api/relatorios/executar", headers=ha, json={"fonte": "horas", "filtros": [so_cliente]}).json()
    assert r["total_linhas"] == 0

    assert cliente.put(f"/api/relatorios/salvos/{s['id']}", headers=h, json={
        "nome": "Horas do mês", "fonte": "horas", "config": cfg, "compartilhado": True}).status_code == 200
    vistos = {x["id"]: x for x in cliente.get("/api/relatorios/catalogo", headers=ha).json()["salvos"]}
    assert vistos[s["id"]]["nome"] == "Horas do mês" and not vistos[s["id"]]["meu"]
    assert cliente.put(f"/api/relatorios/salvos/{s['id']}", headers=ha, json={
        "nome": "Meu agora", "fonte": "horas", "config": cfg}).status_code == 403
    assert cliente.delete(f"/api/relatorios/salvos/{s['id']}", headers=ha).status_code == 403
    assert cliente.delete(f"/api/relatorios/salvos/{s['id']}", headers=h).status_code == 204
