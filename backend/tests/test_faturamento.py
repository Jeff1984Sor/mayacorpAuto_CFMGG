"""Faturamento: contrato → caso → regras (fixo, recorrente, hora), despesas, Itens a faturar, NH/ND e NFS-e da fatura."""

from datetime import date

from app.modules.faturamento import service
from app.modules.faturamento.models import Frequencia, RegraCobranca, Termino, TipoRegra
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


def test_recorrencia_como_no_outlook():
    r = RegraCobranca(tipo=TipoRegra.recorrente, frequencia=Frequencia.mensal, intervalo=1, data_inicio=date(2026, 1, 31),
                      termino=Termino.ocorrencias, ocorrencias=3)
    assert [d for _, d in service.ocorrencias(r, date(2027, 1, 1))] == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]
    r = RegraCobranca(tipo=TipoRegra.recorrente, frequencia=Frequencia.semanal, intervalo=2, data_inicio=date(2026, 1, 5),
                      termino=Termino.data, data_fim=date(2026, 2, 3))
    assert [d for _, d in service.ocorrencias(r, date(2027, 1, 1))] == [date(2026, 1, 5), date(2026, 1, 19), date(2026, 2, 2)]
    assert service.total_parcelas(r) == 3
    r = RegraCobranca(tipo=TipoRegra.recorrente, frequencia=Frequencia.anual, intervalo=1, data_inicio=date(2024, 2, 29),
                      termino=Termino.sem)
    assert [d for _, d in service.ocorrencias(r, date(2026, 12, 31))] == [date(2024, 2, 29), date(2025, 2, 28), date(2026, 2, 28)]


def _base(c, h, sufixo: str):
    cli = c.post("/api/nfse/tomadores", headers=h, json={
        "tipo": "PJ", "nome": f"Cliente Faturamento {sufixo}", "cidade": "São Paulo", "uf": "SP",
        "cpf_cnpj": {"A": "12345678000195", "B": "98765432000198"}.get(sufixo), "tipo_logradouro": "R",
        "logradouro": "RUA AUGUSTA", "numero": "100", "bairro": "CONSOLACAO", "cep": "01305000",
        "emails": [f"fin{sufixo}@cliente.com.br"]}).json()
    contrato = c.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": f"Consultivo {sufixo}"})
    assert contrato.status_code == 201, contrato.text
    contrato = contrato.json()
    caso = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Ação de cobrança"}).json()
    return cli, contrato, caso


def test_itens_a_faturar_e_faturas_nh_nd(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "A")
    cid = contrato["id"]
    # mensal, 3 parcelas a partir de 10/01
    r = cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "recorrente", "descricao": "Mensalidade", "valor": "1000.00", "frequencia": "mensal",
        "data_inicio": "2026-01-10", "termino": "ocorrencias", "ocorrencias": 3})
    assert r.status_code == 201, r.text
    assert "3 parcelas" in r.json()["resumo"]
    assert cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "recorrente", "descricao": "x", "valor": "1", "frequencia": "mensal", "data_inicio": "2026-01-10",
        "termino": "ocorrencias"}).status_code == 422  # faltou a quantidade de parcelas
    cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Êxito", "valor": "5000.00", "data_pagamento": "2026-02-15"})

    # por hora no caso: categoria → tabela → perfil do usuário
    cat = cliente.post("/api/config/cargos", headers=h, json={"nome": "Sócio"}).json()
    tab = cliente.post("/api/faturamento/tabelas", headers=h, json={
        "nome": "Tabela 2026", "itens": [{"cargo_id": cat["id"], "valor_hora": "800.00"}]}).json()
    eu = cliente.get("/api/auth/me", headers=h).json()
    assert cliente.patch(f"/api/config/usuarios/{eu["id"]}", headers=h, json={"cargo_id": cat["id"]}).status_code == 200
    cliente.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "hora", "descricao": "Horas", "tabela_preco_id": tab["id"]})
    assert cliente.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={
        "data": "2026-02-03", "minutos": 90, "descricao": "Petição inicial"}).status_code == 201
    desp = cliente.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-02-04", "tipo": "custas", "descricao": "Guia de custas", "valor": "320.50"}).json()
    assert cliente.post(f"/api/faturamento/despesas/{desp['id']}/comprovante", headers=h,
                        files={"arquivo": ("guia.pdf", b"%PDF-1.4 guia", "application/pdf")}).status_code in (200, 201)

    params = {"de": "2026-01-01", "ate": "2026-02-28", "cliente_ids": [cli["id"]]}
    r = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params)
    assert r.status_code == 200, r.text
    dados = r.json()
    assert len(dados["clientes"]) == 1
    c0 = dados["clientes"][0]
    itens = c0["contratos"][0]["itens"]
    # 2 parcelas (jan, fev) + fixo + 1,5 h × 800 = 1200 (a regra do caso vence a do contrato)
    assert sorted(i["tipo"] for i in itens) == ["fixo", "hora", "recorrente", "recorrente"]
    assert c0["total"] == "8200.00"
    hora = next(i for i in itens if i["tipo"] == "hora")
    assert hora["valor"] == "1200.00" and hora["caso_numero"] == caso["numero"]

    # fatura só janeiro + horas
    escolhidas = [i["chave"] for i in itens if i["tipo"] == "hora" or i["data"] == "2026-01-10"]
    r = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": escolhidas})
    assert r.status_code == 200, r.text
    nh = r.json()["faturas"][0]
    assert nh["codigo"].startswith("NH ") and nh["valor"] == "2200.00"
    restante = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]
    assert restante["total"] == "6000.00"
    # não cobra duas vezes
    r = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": escolhidas})
    assert r.status_code == 400

    # despesas → ND (nunca NFS-e)
    r = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params={**params, "aba": "despesas"}).json()
    item = r["clientes"][0]["contratos"][0]["itens"][0]
    assert item["chave"] == f"desp:{desp['id']}" and item["valor"] == "320.50"
    nd = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "despesas", **params, "chaves": [item["chave"]]}).json()
    nd = nd["faturas"][0]
    assert nd["codigo"].startswith("ND ")
    # filtro NH × ND no Fluxo e no resumo das Faturas
    for tipo, doc in (("despesas", "ND"), ("honorarios", "NH")):
        fluxo = cliente.get("/api/faturamento/fluxo", headers=h, params={"tipo": tipo}).json()
        docs = {c["documento"] for col in fluxo["colunas"].values() for c in col["cards"]}
        assert docs == {doc}, (tipo, docs)
    res = cliente.get("/api/nfse/faturas/resumo", headers=h, params={"tipo": "despesas"}).json()
    assert sum(v["qtd"] for v in res.values()) == 1
    assert cliente.get(f"/api/nfse/faturas/{nd['id']}/pdf", headers=h).content[:5] == b"%PDF-"
    r = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nd["id"]]})
    assert r.status_code == 400 and "Nota de Despesas" in r.json()["detail"]
    assert cliente.put(f"/api/faturamento/despesas/{desp['id']}", headers=h, json={
        "data": "2026-02-04", "descricao": "xy", "valor": "1"}).status_code == 400  # já faturada

    # pasta do caso (demonstração): <caso>/NH - <caso>.pdf, ND - <caso>.pdf e Anexos/
    pastas = cliente.get("/api/nfse/pasta-faturas", headers=h, params={"ids": [nh["id"], nd["id"]]}).json()
    assert [p["nome"] for p in pastas] == ["Ação de cobrança"]
    assert [a["caminho"] for a in pastas[0]["arquivos"]] == [
        "NH - Ação de cobrança.pdf", "ND - Ação de cobrança.pdf", "Anexos/2026-02-04 - Guia de custas.pdf"]
    import io
    import zipfile
    z = zipfile.ZipFile(io.BytesIO(cliente.get("/api/nfse/pasta-faturas.zip", headers=h,
                                               params={"ids": [nh["id"], nd["id"]]}).content))
    assert sorted(z.namelist())[0] == "Ação de cobrança/Anexos/2026-02-04 - Guia de custas.pdf"

    # texto da NFS-e: regra de cobrança e título do caso (Configurações › Automações)
    from app.core.db import SessionLocal
    from app.modules.faturamento.service import discriminacao_nfse
    from app.modules.rpa_nfse.models import Fatura
    with SessionLocal() as db:
        texto = discriminacao_nfse(db, db.get(Fatura, nh["id"]))
    assert "Caso #" in texto and "Ação de cobrança" in texto and "- Mensalidade" in texto and "- Horas: 1,50 h" in texto, texto
    cfg = cliente.get("/api/config/automacoes", headers=h).json()
    assert cfg["nota_texto_regra"] and cfg["nota_titulo_caso"] and not cfg["fatura_salvar_pasta"]
    cfg.update(nota_texto_regra=False, nota_titulo_caso=False, relatorio_destinatarios=cfg["relatorio_destinatarios"] or [])
    for k in ("fatura_proxima_nh", "fatura_proxima_nd"):
        cfg.pop(k)
    assert cliente.put("/api/config/automacoes", headers=h, json=cfg).status_code == 200
    with SessionLocal() as db:
        texto = discriminacao_nfse(db, db.get(Fatura, nh["id"]))
    assert "Caso #" not in texto and "Mensalidade" not in texto and "- Serviços por hora: 1,50 h" in texto, texto
    cfg.update(nota_texto_regra=True, nota_titulo_caso=True)
    cliente.put("/api/config/automacoes", headers=h, json=cfg)

    # lista de faturas mostra NH sem nota com o botão de emitir
    fat = cliente.get(f"/api/nfse/faturas/{nh['id']}", headers=h).json()
    assert fat["pode_emitir_nfse"] and fat["nfse_id"] is None and fat["contrato_id"] == cid
    assert cliente.get(f"/api/nfse/faturas/{nh['id']}/pdf", headers=h).content[:5] == b"%PDF-"

    # cancelar solta os itens
    r = cliente.post(f"/api/faturamento/faturas/{nh['id']}/cancelar", headers=h, json={"motivo": "valor errado"})
    assert r.status_code == 200, r.text
    assert cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["total"] == "8200.00"


def test_emitir_nfse_da_fatura_nh(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "B")
    cliente.post(f"/api/faturamento/contratos/{contrato['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Parecer", "valor": "3000.00", "data_pagamento": date.today().isoformat()})
    params = {"de": date.today().isoformat(), "ate": date.today().isoformat(), "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    nh = cliente.post("/api/faturamento/faturar", headers=h, json={
        "aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
    r = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nh["id"]]})
    assert r.status_code == 200, r.text
    lote_id = r.json()["lote_id"]
    lote = cliente.get(f"/api/nfse/importacoes/{lote_id}", headers=h).json()
    assert lote["status"] in ("validando", "pronto"), lote
    r = cliente.post(f"/api/nfse/importacoes/{lote_id}/emitir", headers=h)
    assert r.status_code == 200, r.text
    fat = cliente.get(f"/api/nfse/faturas/{nh['id']}", headers=h).json()
    assert fat["nfse_id"] and fat["codigo"] == nh["codigo"] and not fat["pode_emitir_nfse"]
    # e não criou uma segunda fatura para a mesma nota
    assert cliente.get("/api/nfse/faturas", headers=h, params={"lote_id": lote_id}).json()["total"] == 1
    # baixar a nota: "NF - <nome do caso> - <nº da nota>.pdf" (cobrança do contrato, sem caso: o nome do contrato)
    from urllib.parse import unquote

    r = cliente.get(f"/api/nfse/notas/{fat['nfse_id']}/pdf", headers=h)
    assert r.status_code == 200
    assert f"NF - Consultivo B - {fat['nfse_numero']}.pdf" in unquote(r.headers["content-disposition"])
    # baixar em lote: uma pasta por caso (aqui, o contrato) com a NH e a NF no mesmo padrão de nome
    import io as _io
    import zipfile

    z = cliente.post("/api/nfse/faturas/zip", headers=h, json={"ids": [nh["id"]]})
    assert z.status_code == 200, z.text
    assert sorted(zipfile.ZipFile(_io.BytesIO(z.content)).namelist()) == [
        f"Consultivo B/NF - Consultivo B - {fat['nfse_numero']}.pdf",
        f"Consultivo B/NH - Consultivo B - {fat['numero']:05d}.pdf"]
    # fatura do Faturamento não entra em "Emitidas pelo robô"
    assert cliente.get("/api/nfse/faturas", headers=h, params={"lote_id": lote_id, "tipo": "robo"}).json()["total"] == 0


def test_revisao_da_fatura(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "C")
    cid = contrato["id"]
    cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "recorrente", "descricao": "Mensalidade", "valor": "2000.00", "frequencia": "mensal",
        "data_inicio": "2026-03-01", "termino": "sem"})
    tab = cliente.post("/api/faturamento/tabelas", headers=h, json={"nome": "Tabela C", "itens": []}).json()
    cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "hora", "descricao": "Horas", "tabela_preco_id": tab["id"]})
    params = {"de": "2026-03-01", "ate": "2026-04-30", "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    assert len(itens) == 2
    r = cliente.post("/api/faturamento/revisoes", headers=h, json={"aba": "honorarios", **params, "chaves": [itens[0]["chave"]]})
    assert r.status_code == 201, r.text
    rid = r.json()[0]["id"]
    # reservado: some de Itens a faturar
    restante = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]
    assert restante["qtd_itens"] == 1
    # fluxo mostra "Em revisão"
    fluxo = cliente.get("/api/faturamento/fluxo", headers=h).json()
    assert any(c["id"] == rid for c in fluxo["colunas"]["em_revisao"]["cards"])

    # incluir a parcela de abril, adicionar horas (valor/hora informado), lançamento avulso, excluir, editar
    disp = cliente.get(f"/api/faturamento/revisoes/{rid}/disponiveis", headers=h).json()
    assert any(d["chave"] == itens[1]["chave"] for d in disp)
    rev = cliente.post(f"/api/faturamento/revisoes/{rid}/incluir", headers=h, json={"chaves": [itens[1]["chave"]]}).json()
    assert rev["total"] == "4000.00"
    r = cliente.post(f"/api/faturamento/revisoes/{rid}/horas", headers=h, json={
        "caso_id": caso["id"], "data": "2026-04-10", "minutos": 120, "descricao": "reuniao", "valor_hora": "500"})
    assert r.status_code == 201, r.text
    rev = r.json()
    hora = next(i for i in rev["itens"] if i["tipo"] == "hora")
    assert hora["valor"] == "1000.00"
    rev = cliente.post(f"/api/faturamento/revisoes/{rid}/lancamentos", headers=h, json={
        "data": "2026-04-15", "descricao": "Ajuste acordado", "valor": "150.00"}).json()
    assert rev["total"] == "5150.00"
    rev = cliente.patch(f"/api/faturamento/revisoes/{rid}/itens/{hora['id']}", headers=h, json={
        "descricao": "Reunião com o cliente sobre a estratégia processual", "quantidade": "1.5"}).json()
    assert next(i for i in rev["itens"] if i["id"] == hora["id"])["valor"] == "750.00"
    parcela_abril = next(i for i in rev["itens"] if i["chave"] == itens[1]["chave"])
    rev = cliente.delete(f"/api/faturamento/revisoes/{rid}/itens/{parcela_abril['id']}", headers=h).json()
    assert rev["total"] == "2900.00"  # 2000 + 750 + 150
    # a parcela excluída volta para Itens a faturar
    assert cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["qtd_itens"] == 1
    ts = cliente.get(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h).json()
    assert ts[0]["minutos"] == 90 and ts[0]["descricao"].startswith("Reunião")

    # IA sem provedor configurado: erro claro
    r = cliente.post(f"/api/faturamento/revisoes/{rid}/ia", headers=h)
    assert r.status_code in (200, 400)

    r = cliente.post(f"/api/faturamento/revisoes/{rid}/aprovar", headers=h)
    assert r.status_code == 200, r.text
    rev = r.json()
    assert rev["status"] == "faturada" and rev["fatura_codigo"].startswith("NH ")
    fat = cliente.get(f"/api/nfse/faturas/{rev['fatura_id']}", headers=h).json()
    assert fat["valor"] == "2900.00" and fat["pode_emitir_nfse"]
    assert cliente.post(f"/api/faturamento/revisoes/{rid}/aprovar", headers=h).status_code == 400
    fluxo = cliente.get("/api/faturamento/fluxo", headers=h).json()
    assert any(c["id"] == fat["id"] for c in fluxo["colunas"]["aguardando_nfse"]["cards"])

    # descartar devolve os itens
    rid2 = cliente.post("/api/faturamento/revisoes", headers=h, json={
        "aba": "honorarios", **params, "chaves": [itens[1]["chave"]]}).json()[0]["id"]
    assert cliente.post(f"/api/faturamento/revisoes/{rid2}/descartar", headers=h, json={}).status_code == 200
    assert cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["qtd_itens"] == 1


def test_funcionario_sem_acesso_lanca_horas_mas_nao_entra(cliente):  # noqa: F811
    h = _login(cliente)
    cargo = cliente.post("/api/config/cargos", headers=h, json={"nome": "Estagiário"}).json()
    r = cliente.post("/api/config/usuarios", headers=h, json={
        "nome": "Ana Estagiária", "email": "ana.estagio@cfme.com.br", "perfil": "visualizador", "acesso_sistema": False,
        "cargo_id": cargo["id"], "cpf": "529.982.247-25", "oab": None, "cep": "01310-100", "logradouro": "Av. Paulista",
        "numero_endereco": "1000", "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP"})
    assert r.status_code == 200, r.text
    ana = r.json()
    assert ana["acesso_sistema"] is False and ana["cargo_nome"] == "Estagiário" and ana["cep"] == "01310100"
    assert not ana["convite_pendente"]
    assert cliente.post("/api/auth/login", json={"email": "ana.estagio@cfme.com.br", "senha": "Cfme@2026"}).status_code == 401
    profs = cliente.get("/api/faturamento/profissionais", headers=h).json()
    assert any(p["id"] == ana["id"] and p["cargo_nome"] == "Estagiário" for p in profs)
    _, _, caso = _base(cliente, h, "D")
    r = cliente.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={
        "profissional_id": ana["id"], "data": "2026-05-02", "minutos": 30, "descricao": "Pesquisa de jurisprudência"})
    assert r.status_code == 201 and r.json()["cargo_nome"] == "Estagiário"


def test_excluir_caso(cliente):  # noqa: F811
    h = _login(cliente)
    _, contrato, caso = _base(cliente, h, "E")
    vazio = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Consulta avulsa"}).json()
    assert cliente.delete(f"/api/faturamento/casos/{vazio['id']}", headers=h).json()["mensagem"] == "Caso excluído."
    cliente.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-06-01", "tipo": "copias", "descricao": "Cópias", "valor": "10"})
    r = cliente.delete(f"/api/faturamento/casos/{caso['id']}", headers=h).json()
    assert "encerrado" in r["mensagem"]
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()["status"] == "encerrado"


def test_ficha_do_caso_areas_campos_anexos_andamentos(cliente):  # noqa: F811
    h = _login(cliente)
    _, contrato, caso = _base(cliente, h, "F")
    area = cliente.post("/api/faturamento/areas", headers=h, json={"nome": "Trabalhista", "cor": "#1A8F5E"}).json()
    assert cliente.post("/api/faturamento/areas", headers=h, json={"nome": "trabalhista"}).status_code == 409
    fase = cliente.post("/api/faturamento/campos", headers=h, json={
        "nome": "Fase", "tipo": "lista", "opcoes": ["Conhecimento", "Recursal", "Execução"], "obrigatorio": True}).json()
    sindicato = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Sindicato", "tipo": "texto",
                                                                         "area_id": area["id"]}).json()
    assert cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Lista vazia", "tipo": "lista"}).status_code == 422

    base = {"titulo": "Reclamação trabalhista", "area_id": area["id"], "polo": "passivo", "tribunal": "TRT-2",
            "vara": "12ª Vara do Trabalho", "comarca": "São Paulo", "valor_causa": "150000.00", "data_distribuicao": "2026-03-10"}
    r = cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={**base, "campos": {}})
    assert r.status_code == 400 and "Fase" in r.json()["detail"]  # obrigatório
    r = cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={**base, "campos": {str(fase["id"]): "Outra"}})
    assert r.status_code == 400  # fora das opções
    r = cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={
        **base, "campos": {str(fase["id"]): "Recursal", str(sindicato["id"]): "Sindicato X", "999": "ignorado"}})
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["area_nome"] == "Trabalhista" and c["polo"] == "passivo" and c["valor_causa"] == "150000.00"
    assert c["campos"] == {str(fase["id"]): "Recursal", str(sindicato["id"]): "Sindicato X"}
    assert any(a["id"] == area["id"] and a["qtd_casos"] == 1 for a in cliente.get("/api/faturamento/areas", headers=h).json())

    # anexos
    r = cliente.post(f"/api/faturamento/casos/{caso['id']}/anexos", headers=h, data={"descricao": "Inicial", "categoria": "Petição"},
                     files=[("arquivos", ("inicial.pdf", b"%PDF-1.4 teste", "application/pdf")),
                            ("arquivos", ("procuracao.docx", b"PK..", "application/octet-stream"))])
    assert r.status_code == 201, r.text
    anexos = r.json()
    assert len(anexos) == 2 and anexos[0]["categoria"] == "Petição"
    assert cliente.get(f"/api/faturamento/anexos/{anexos[0]['id']}", headers=h).content == b"%PDF-1.4 teste"
    assert cliente.post(f"/api/faturamento/casos/{caso['id']}/anexos", headers=h,
                        files=[("arquivos", ("virus.exe", b"MZ", "application/octet-stream"))]).status_code == 400
    assert cliente.delete(f"/api/faturamento/anexos/{anexos[1]['id']}", headers=h).status_code == 200
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()["qtd_anexos"] == 1

    # andamentos
    r = cliente.post(f"/api/faturamento/casos/{caso['id']}/andamentos", headers=h, json={
        "data": "2026-04-01", "tipo": "despacho", "titulo": "Contestação", "prazo": "2026-04-15"})
    assert r.status_code == 201, r.text
    and1 = r.json()
    assert and1["atrasado"] is True  # prazo no passado e não concluído
    r = cliente.put(f"/api/faturamento/andamentos/{and1['id']}", headers=h, json={**and1, "concluido": True})
    assert r.json()["atrasado"] is False
    cliente.post(f"/api/faturamento/casos/{caso['id']}/andamentos", headers=h, json={
        "data": "2026-05-01", "tipo": "decisao", "titulo": "Audiência inicial"})
    lista = cliente.get(f"/api/faturamento/casos/{caso['id']}/andamentos", headers=h).json()
    assert [a["titulo"] for a in lista] == ["Audiência inicial", "Contestação"]
    assert cliente.delete(f"/api/faturamento/andamentos/{and1['id']}", headers=h).status_code == 200

    # IA sem provedor configurado: mensagem clara
    assert cliente.post(f"/api/faturamento/casos/{caso['id']}/ia/resumo", headers=h).status_code == 400
    assert cliente.post("/api/faturamento/casos/ia/preencher", headers=h, data={"texto": "Processo 0001234-56.2026.5.02.0012"}).status_code == 400
    # campo usado só desativa
    assert "desativado" in cliente.delete(f"/api/faturamento/campos/{fase['id']}", headers=h).json()["mensagem"]


def test_dashboard_mostra_todas_as_faturas(cliente):  # noqa: F811
    h = _login(cliente)
    d = cliente.get("/api/dashboard/faturamento", headers=h).json()
    tipos = {x["tipo"] for x in d["notas"]}
    assert "ND" in tipos and "NH" in tipos  # criadas nos testes anteriores
    nd = next(x for x in d["notas"] if x["tipo"] == "ND")
    assert nd["nf"] is None and nd["nfse"].startswith("Não se aplica") and nd["origem"] == "Contrato"
    assert len({x["chave"] for x in d["notas"]}) == len(d["notas"])


def test_exportar_importar_contratos_e_casos(cliente):  # noqa: F811
    import io

    from openpyxl import load_workbook

    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "G")
    r = cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={"titulo": "Caso G", "tipo": "judicial_federal"})
    assert r.status_code == 200 and r.json()["tipo_nome"] == "Judicial Federal"
    assert any(c["id"] == caso["id"] for c in cliente.get("/api/faturamento/casos", headers=h, params={"tipo": "judicial_federal"}).json())

    # contratos: exporta, edita e importa de volta + linha nova
    x = cliente.get("/api/faturamento/contratos/exportar.xlsx", headers=h)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    wb = load_workbook(io.BytesIO(x.content))
    ws = wb["Contratos"]
    linha = next(r for r in ws.iter_rows(min_row=2) if r[0].value == contrato["numero"])
    linha[3].value = "Consultivo G (renomeado)"
    ws.append([None, cli["nome"], None, "Contrato importado", "Objeto", "01/02/2026", None, None, None, "Sim", None])
    ws.append([None, "Cliente que não existe", None, "X", None, None, None, None, None, None, None])
    buf = io.BytesIO()
    wb.save(buf)
    r = cliente.post("/api/faturamento/contratos/importar", headers=h, files={"arquivo": ("c.xlsx", buf.getvalue())}).json()
    assert r["criados"] == 1 and r["atualizados"] >= 1 and r["qtd_erros"] == 1
    assert cliente.get(f"/api/faturamento/contratos/{contrato['id']}", headers=h).json()["nome"] == "Consultivo G (renomeado)"

    # casos: modelo + importação com tipo, área nova e campo adicional
    m = load_workbook(io.BytesIO(cliente.get("/api/faturamento/casos/modelo.xlsx", headers=h).content))
    ws = m["Casos"]
    cab = [c.value for c in ws[1]]
    assert cab[:4] == ["Nº", "Nº do contrato", "Título", "Tipo do caso"]
    ws.delete_rows(2)
    nova = {k: None for k in cab}
    nova.update({"Nº do contrato": contrato["numero"], "Título": "Caso importado", "Tipo do caso": "Judicial Trabalhista",
                 "Área": "Previdenciário", "Polo": "Réu", "Valor da causa": "10.000,50", "Distribuição": "05/03/2026"})
    ws.append([nova[k] for k in cab])
    ws.append([None, 99999, "Sem contrato"] + [None] * (len(cab) - 3))
    buf = io.BytesIO()
    m.save(buf)
    r = cliente.post("/api/faturamento/casos/importar", headers=h, files={"arquivo": ("k.xlsx", buf.getvalue())}).json()
    assert r["criados"] == 1 and r["qtd_erros"] == 1, r
    novo = next(c for c in cliente.get("/api/faturamento/casos", headers=h, params={"q": "Caso importado"}).json())
    assert novo["tipo"] == "judicial_trabalhista" and novo["area_nome"] == "Previdenciário" and novo["polo"] == "passivo"
    assert novo["valor_causa"] == "10000.50" and novo["data_distribuicao"] == "2026-03-05"
    assert cliente.get("/api/faturamento/casos/exportar.xlsx", headers=h).content[:2] == b"PK"


def test_comprovante_da_despesa_vai_para_anexos(cliente):  # noqa: F811
    h = _login(cliente)
    _, _, caso = _base(cliente, h, "H")
    d = cliente.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-10-01", "tipo": "deslocamento", "descricao": "Uber fórum", "valor": "30"}).json()
    r = cliente.post(f"/api/faturamento/despesas/{d['id']}/comprovante", headers=h, files={"arquivo": ("uber.pdf", b"%PDF-1", "application/pdf")})
    assert r.status_code == 200 and r.json()["tem_comprovante"]
    anexos = cliente.get(f"/api/faturamento/casos/{caso['id']}/anexos", headers=h).json()
    assert len(anexos) == 1 and anexos[0]["categoria"] == "Despesas" and anexos[0]["despesa_id"] == d["id"]
    assert cliente.delete(f"/api/faturamento/anexos/{anexos[0]['id']}", headers=h).status_code == 400
    assert cliente.delete(f"/api/faturamento/despesas/{d['id']}", headers=h).status_code == 200
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}/anexos", headers=h).json() == []


def test_judiciario_tribunais_comarcas_varas_instancia(cliente):  # noqa: F811
    h = _login(cliente)
    est = cliente.get("/api/faturamento/judiciario/tribunais", headers=h, params={"tipo": "judicial_estadual"}).json()
    assert len(est) == 27 and any(t["sigla"] == "TJSP" for t in est) and any(t["sigla"] == "TJDFT" for t in est)
    fed = cliente.get("/api/faturamento/judiciario/tribunais", headers=h, params={"tipo": "judicial_federal"}).json()
    assert [t["sigla"] for t in fed] == ["TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6"]
    trab = cliente.get("/api/faturamento/judiciario/tribunais", headers=h, params={"tipo": "judicial_trabalhista"}).json()
    assert len(trab) == 24
    sup = cliente.get("/api/faturamento/judiciario/tribunais", headers=h, params={"instancia": "superior"}).json()
    assert {t["sigla"] for t in sup} >= {"STF", "STJ", "TST"}
    com = cliente.get("/api/faturamento/judiciario/comarcas", headers=h, params={"tribunal": "TJSP"}).json()
    assert "Campinas" in com and len(com) == 645
    assert "Vitória (ES)" in cliente.get("/api/faturamento/judiciario/comarcas", headers=h, params={"tribunal": "TRF2"}).json()
    _, _, caso = _base(cliente, h, "J")
    r = cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={
        "titulo": "Caso J", "tipo": "judicial_estadual", "instancia": "primeira", "tribunal": "TJSP", "comarca": "Campinas",
        "vara": "3ª Vara Cível de Campinas"})
    assert r.status_code == 200 and r.json()["instancia_nome"] == "1ª instância"
    varas = cliente.get("/api/faturamento/judiciario/varas", headers=h, params={"tribunal": "TJSP", "comarca": "Campinas"}).json()
    assert varas[0] == "3ª Vara Cível de Campinas" and "1ª Vara Cível" in varas


def test_tarefas_crud_filtros_e_anexos(cliente):  # noqa: F811
    from datetime import timedelta

    h = _login(cliente)
    _, _, caso = _base(cliente, h, "T")
    hoje = date.today()
    assert cliente.post(f"/api/faturamento/casos/{caso['id']}/andamentos", headers=h, json={
        "data": hoje.isoformat(), "tipo": "prazo", "titulo": "x"}).status_code == 422  # prazo virou tarefa
    t1 = cliente.post("/api/faturamento/tarefas", headers=h, json={
        "caso_id": caso["id"], "titulo": "Protocolar contestação", "tipo": "prazo", "prioridade": "urgente",
        "prazo": (hoje - timedelta(days=1)).isoformat(), "etiquetas": ["contencioso", " contencioso "]})
    assert t1.status_code == 201, t1.text
    t1 = t1.json()
    assert t1["atrasada"] and t1["etiquetas"] == ["contencioso"] and t1["responsavel_id"] and t1["caso_numero"] == caso["numero"]
    avulsa = cliente.post("/api/faturamento/tarefas", headers=h, json={
        "titulo": "Renovar certificado digital", "tipo": "administrativo", "prazo": (hoje + timedelta(days=3)).isoformat(), "hora": "14:30"}).json()
    assert avulsa["caso_id"] is None and avulsa["hora"] == "14:30"
    assert cliente.post("/api/faturamento/tarefas", headers=h, json={"titulo": "x hora", "hora": "25:00"}).status_code == 422

    r = cliente.get("/api/faturamento/tarefas", headers=h, params={"situacao": "atrasadas"}).json()
    assert any(t["id"] == t1["id"] for t in r["itens"]) and r["resumo"]["atrasadas"] >= 1
    assert any(t["id"] == avulsa["id"] for t in cliente.get("/api/faturamento/tarefas", headers=h, params={"situacao": "semana"}).json()["itens"])
    assert [t["id"] for t in cliente.get("/api/faturamento/tarefas", headers=h, params={"caso_id": caso["id"]}).json()["itens"]] == [t1["id"]]
    assert cliente.get("/api/faturamento/tarefas", headers=h, params={"sem_caso": True, "q": "certificado"}).json()["itens"][0]["id"] == avulsa["id"]
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()["qtd_tarefas_abertas"] == 1
    assert "contencioso" in cliente.get("/api/faturamento/tarefas/etiquetas", headers=h).json()

    # anexos: tarefa do caso aparece na pasta Tarefas do caso; tarefa avulsa não
    a = cliente.post(f"/api/faturamento/tarefas/{t1['id']}/anexos", headers=h, files=[("arquivos", ("minuta.docx", b"PK", "application/octet-stream"))])
    assert a.status_code == 201, a.text
    anexos_caso = cliente.get(f"/api/faturamento/casos/{caso['id']}/anexos", headers=h).json()
    assert anexos_caso[0]["categoria"] == "Tarefas" and anexos_caso[0]["tarefa_id"] == t1["id"]
    b = cliente.post(f"/api/faturamento/tarefas/{avulsa['id']}/anexos", headers=h, files=[("arquivos", ("boleto.pdf", b"%PDF", "application/pdf"))]).json()
    assert cliente.get(f"/api/faturamento/anexos/{b[0]['id']}", headers=h).content == b"%PDF"
    assert cliente.get(f"/api/faturamento/tarefas/{avulsa['id']}", headers=h).json()["qtd_anexos"] == 1

    # status e exclusão
    r = cliente.patch(f"/api/faturamento/tarefas/{t1['id']}/status", headers=h, json={"status": "concluida"}).json()
    assert r["status"] == "concluida" and r["concluida_em"] == hoje.isoformat() and not r["atrasada"]
    assert cliente.delete(f"/api/faturamento/tarefas/{avulsa['id']}", headers=h).status_code == 200
    assert cliente.get(f"/api/faturamento/anexos/{b[0]['id']}", headers=h).status_code == 404


def test_timesheet_central(cliente):  # noqa: F811
    h = _login(cliente)
    _, contrato, caso = _base(cliente, h, "K")
    cargo = cliente.post("/api/config/cargos", headers=h, json={"nome": "Cargo K"}).json()
    tab = cliente.post("/api/faturamento/tabelas", headers=h, json={"nome": "Tabela K", "itens": [{"cargo_id": cargo["id"], "valor_hora": "600"}]}).json()
    cliente.put(f"/api/faturamento/contratos/{contrato['id']}", headers=h, json={**contrato, "tabela_preco_id": tab["id"]})
    cliente.post(f"/api/faturamento/contratos/{contrato['id']}/regras", headers=h, json={"tipo": "hora", "descricao": "Horas"})
    eu = cliente.get("/api/auth/me", headers=h).json()
    cliente.patch(f"/api/config/usuarios/{eu['id']}", headers=h, json={"cargo_id": cargo["id"]})
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={"data": hoje, "minutos": 90, "descricao": "Parecer"})
    cliente.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={"data": hoje, "minutos": 30, "descricao": "Interno", "faturavel": False})
    r = cliente.get("/api/faturamento/timesheet", headers=h, params={"caso_id": caso["id"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["resumo"]["minutos"] == 120 and d["resumo"]["minutos_faturaveis"] == 90 and d["resumo"]["aproveitamento"] == 75
    assert d["resumo"]["valor_a_faturar"] == "900.00" and d["por_profissional"][0]["minutos"] == 120
    parecer = next(x for x in d["itens"] if x["descricao"] == "Parecer")
    assert parecer["valor_hora"] == "600.00" and parecer["cliente_nome"].startswith("Cliente Faturamento K")
    assert d["resumo"]["meus_minutos_hoje"] >= 120
    assert cliente.get("/api/faturamento/timesheet", headers=h, params={"caso_id": caso["id"], "faturavel": False}).json()["resumo"]["minutos"] == 30
    assert cliente.get("/api/faturamento/timesheet/exportar.xlsx", headers=h).content[:2] == b"PK"


def test_contrato_com_outro_pagador_e_dividido(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "P")
    cid = contrato["id"]
    assert contrato["pagadores"] == []  # padrão: o próprio cliente paga
    outro = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Holding Pagadora"}).json()
    base = {"tomador_id": cli["id"], "nome": contrato["nome"]}

    # a divisão precisa fechar 100% e não repetir pagador
    r = cliente.put(f"/api/faturamento/contratos/{cid}", headers=h, json={**base, "pagadores": [
        {"tomador_id": cli["id"], "percentual": "60"}, {"tomador_id": outro["id"], "percentual": "30"}]})
    assert r.status_code == 400 and "100%" in r.json()["detail"]
    # o próprio cliente com 100% é o padrão: não guarda nada
    r = cliente.put(f"/api/faturamento/contratos/{cid}", headers=h, json={**base, "pagadores": [
        {"tomador_id": cli["id"], "percentual": "100"}]})
    assert r.json()["pagadores"] == []

    cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Parecer", "valor": "1000.01", "data_pagamento": "2026-03-10"})
    cliente.post(f"/api/faturamento/contratos/{cid}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Consulta", "valor": "500.00", "data_pagamento": "2026-03-20"})
    params = {"de": "2026-03-01", "ate": "2026-03-31", "cliente_ids": [cli["id"]]}

    def pendentes():
        return cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]

    # outro cliente paga tudo: a NH sai em nome dele
    r = cliente.put(f"/api/faturamento/contratos/{cid}", headers=h, json={**base, "pagadores": [
        {"tomador_id": outro["id"], "percentual": "100"}]})
    assert r.status_code == 200 and r.json()["pagadores"][0]["tomador_nome"] == "Holding Pagadora"
    itens = pendentes()["itens"]
    consulta = next(i["chave"] for i in itens if i["descricao"] == "Consulta")
    fats = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": [consulta]}).json()["faturas"]
    assert [(f["tomador_nome"], f["valor"]) for f in fats] == [("Holding Pagadora", "500.00")]

    # dividido 60/40: uma fatura por pagador, os centavos fecham o total
    r = cliente.put(f"/api/faturamento/contratos/{cid}", headers=h, json={**base, "pagadores": [
        {"tomador_id": cli["id"], "percentual": "60"}, {"tomador_id": outro["id"], "percentual": "40"}]})
    assert [p["percentual"] for p in r.json()["pagadores"]] == ["60.00", "40.00"]
    pend = pendentes()
    assert len(pend["pagadores"]) == 2
    parecer = pend["itens"][0]["chave"]
    fats = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": [parecer]}).json()["faturas"]
    assert [(f["tomador_nome"], f["valor"]) for f in fats] == [("Cliente Faturamento P", "600.01"), ("Holding Pagadora", "400.00")]
    assert cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"] == []  # não cobra de novo

    # cancelar uma cancela a divisão inteira e o item volta inteiro
    r = cliente.post(f"/api/faturamento/faturas/{fats[1]['id']}/cancelar", headers=h, json={"motivo": "refazer"})
    assert r.status_code == 200 and "canceladas" in r.json()["mensagem"]
    assert cliente.get(f"/api/nfse/faturas/{fats[0]['id']}", headers=h).json()["status"] == "cancelada"
    assert pendentes()["itens"][0]["valor"] == "1000.01"


def test_proximo_numero_da_nh_e_da_nd_nas_configuracoes(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "N")
    cfg = cliente.get("/api/config/automacoes", headers=h).json()
    assert cfg["fatura_proxima_nh"] >= 1 and cfg["fatura_proxima_nd"] >= 1
    r = cliente.put("/api/config/automacoes", headers=h, json={**cfg, "fatura_proxima_nh": 500, "fatura_proxima_nd": 70})
    assert r.status_code == 200, r.text
    assert (r.json()["fatura_proxima_nh"], r.json()["fatura_proxima_nd"]) == (500, 70)

    cliente.post(f"/api/faturamento/contratos/{contrato['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Parecer", "valor": "900.00", "data_pagamento": "2026-04-10"})
    cliente.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-04-11", "tipo": "custas", "descricao": "Guia", "valor": "50.00"})
    params = {"de": "2026-04-01", "ate": "2026-04-30", "cliente_ids": [cli["id"]]}
    for aba, sigla, numero in (("honorarios", "NH", 500), ("despesas", "ND", 70)):
        itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params={**params, "aba": aba}).json()["clientes"][0]["contratos"][0]["itens"]
        fat = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": aba, **params, "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
        assert fat["codigo"] == f"{sigla} {numero:05d}", fat["codigo"]  # só o número, sem o ano
    cfg = cliente.get("/api/config/automacoes", headers=h).json()
    assert (cfg["fatura_proxima_nh"], cfg["fatura_proxima_nd"]) == (501, 71)  # segue a sequência de cada uma
    r = cliente.put("/api/config/automacoes", headers=h, json={**cfg, "fatura_proxima_nh": 10})
    assert r.status_code == 400 and "501 ou maior" in r.json()["detail"]  # não volta para número usado


def test_inativar_e_excluir_cliente_com_tudo(cliente):  # noqa: F811
    h = _login(cliente)
    cli = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Cadastrado por engano"}).json()
    ct = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": "Errado"}).json()
    caso = cliente.post(f"/api/faturamento/contratos/{ct['id']}/casos", headers=h, json={"titulo": "Caso errado"}).json()
    assert cliente.post(f"/api/faturamento/casos/{caso['id']}/timesheet", headers=h, json={
        "data": "2026-02-03", "minutos": 30, "descricao": "Teste"}).status_code == 201
    desp = cliente.post(f"/api/faturamento/casos/{caso['id']}/despesas", headers=h, json={
        "data": "2026-02-04", "tipo": "custas", "descricao": "Guia", "valor": "10"}).json()
    cliente.post(f"/api/faturamento/despesas/{desp['id']}/comprovante", headers=h,
                 files={"arquivo": ("g.pdf", b"%PDF-1.4", "application/pdf")})
    cliente.post("/api/faturamento/tarefas", headers=h, json={"titulo": "Tarefa errada", "caso_id": caso["id"]})

    # inativar: some da lista de ativos, continua em "todos"
    atual = cliente.get(f"/api/nfse/tomadores/{cli['id']}", headers=h).json()
    assert cliente.put(f"/api/nfse/tomadores/{cli['id']}", headers=h, json={**atual, "ativo": False}).status_code == 200
    ativos = cliente.get("/api/nfse/tomadores", headers=h, params={"q": "por engano", "situacao": "ativos"}).json()
    assert ativos["total"] == 0
    assert cliente.get("/api/nfse/tomadores", headers=h, params={"q": "por engano"}).json()["total"] == 1

    dep = cliente.get(f"/api/nfse/tomadores/{cli['id']}/dependencias", headers=h).json()
    assert (dep["contratos"], dep["casos"], dep["horas"], dep["despesas"], dep["tarefas"], dep["bloqueio"]) == (1, 1, 1, 1, 1, None)
    assert cliente.delete(f"/api/nfse/tomadores/{cli['id']}", headers=h).status_code == 409  # sem "com tudo"
    r = cliente.delete(f"/api/nfse/tomadores/{cli['id']}", headers=h, params={"tudo": True})
    assert r.status_code == 200, r.text
    assert cliente.get(f"/api/nfse/tomadores/{cli['id']}", headers=h).status_code == 404
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).status_code == 404

    # com fatura: histórico fiscal, só inativar
    cli2, contrato2, _ = _base(cliente, h, "D")
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/contratos/{contrato2['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Parecer 2", "valor": "100.00", "data_pagamento": hoje})
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli2["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]})
    dep = cliente.get(f"/api/nfse/tomadores/{cli2['id']}/dependencias", headers=h).json()
    assert dep["bloqueio"] and "Inative" in dep["bloqueio"]
    assert cliente.delete(f"/api/nfse/tomadores/{cli2['id']}", headers=h, params={"tudo": True}).status_code == 409


def test_dre_abre_cliente_contrato_caso(cliente):  # noqa: F811
    h = _login(cliente)
    conta = cliente.post("/api/financeiro/contas", headers=h, json={"nome": "Conta DRE"}).json()
    cli = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Cliente da DRE"}).json()
    ct = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": "Contrato DRE"}).json()
    caso = cliente.post(f"/api/faturamento/contratos/{ct['id']}/casos", headers=h, json={"titulo": "Caso DRE"}).json()
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Parecer DRE", "valor": "500.00", "data_pagamento": hoje})
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    nh = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params,
                                                                    "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
    r = cliente.post(f"/api/nfse/faturas/{nh['id']}/baixa", headers=h, json={"data": hoje, "conta_bancaria_id": conta["id"]})
    assert r.status_code == 200, r.text
    dre = cliente.get("/api/financeiro/dre", headers=h, params={"de": hoje, "ate": hoje, "conta_ids": [conta["id"]]}).json()
    # sem categoria de recebimento configurada no teste, o crédito cai em "Não classificado": a árvore é a mesma
    itens = [i for x in dre["linhas"] for i in x.get("itens", [])]
    no_cliente = next(f for i in itens for f in i["filhos"] if f["nome"] == "Cliente da DRE")
    assert no_cliente["total"] == 500
    no_contrato = no_cliente["filhos"][0]
    assert no_contrato["nome"].endswith("Contrato DRE")
    assert no_contrato["filhos"][0]["nome"] == f"Caso #{caso['numero']} — Caso DRE"


def test_campos_do_cliente_e_modelo_de_titulo(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "T")
    _, outro_contrato, _ = _base(cliente, h, "U")
    # campo só deste cliente
    r = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Sinistro", "tipo": "texto", "tomador_id": cli["id"]})
    assert r.status_code == 201, r.text
    sinistro = r.json()
    so_dele = cliente.get("/api/faturamento/campos", headers=h, params={"tomador_id": cli["id"]}).json()
    assert [c["nome"] for c in so_dele] == ["Sinistro"] and so_dele[0]["tomador_nome"] == cli["nome"]
    # caso antigo ganha o título do modelo quando ele é salvo
    cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={
        "titulo": "Ação de cobrança", "parte_contraria": "Fulano", "campos": {str(sinistro["id"]): "SIN-77"}})
    r = cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h,
                    json={"modelo_titulo_caso": "{Sinistro} - {Processo} - {Parte contrária}"})
    assert r.status_code == 200 and r.json()["atualizados"] == 1, r.text
    assert cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()["titulo"] == "SIN-77 - Fulano"
    # caso novo sem título: sai do modelo
    r = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={
        "titulo": "", "numero_processo": "0001234-56.2026.8.26.0100", "parte_contraria": "Beltrano",
        "campos": {str(sinistro["id"]): "SIN-99"}})
    assert r.status_code == 201, r.text
    assert r.json()["titulo"] == "SIN-99 - 0001234-56.2026.8.26.0100 - Beltrano"
    # outro cliente: o campo não vale e o título é obrigatório
    r = cliente.post(f"/api/faturamento/contratos/{outro_contrato['id']}/casos", headers=h,
                     json={"titulo": "", "campos": {str(sinistro["id"]): "X"}})
    assert r.status_code == 400
    r = cliente.post(f"/api/faturamento/contratos/{outro_contrato['id']}/casos", headers=h,
                     json={"titulo": "Consulta", "campos": {str(sinistro["id"]): "X"}})
    assert r.status_code == 201 and r.json()["campos"] == {}


def test_titulo_renderiza_e_limpa_separadores():
    from app.modules.faturamento import titulo_caso
    from app.modules.faturamento.models import CampoAdicional

    cp = CampoAdicional(id=7, nome="Nº Sinistro")
    padrao = {"processo": "", "parte_contraria": "Porto Seguro", "numero": "#12"}
    assert titulo_caso.renderizar("{n sinistro} - {Processo} - {Parte Contraria} ({Nº do caso})", padrao, [cp],
                                  {"7": "A1"}) == "A1 - Porto Seguro (#12)"
    assert titulo_caso.renderizar("{Processo} / {Vara}", padrao, [], {}) == ""


def test_importar_casos_por_planilha(cliente):  # noqa: F811
    import io

    from openpyxl import Workbook

    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "P")
    sin = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Nº do sinistro", "tipo": "texto",
                                                                    "tomador_id": cli["id"]}).json()
    # caso que já existe (sinistro 555) com uma regra igual à da planilha
    existente = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={
        "titulo": "Sinistro antigo", "campos": {str(sin["id"]): "000555"}}).json()
    cliente.post(f"/api/faturamento/casos/{existente['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Honorários iniciais", "valor": "1150.00", "data_pagamento": "2026-12-10"})

    wb = Workbook()
    ws = wb.active
    ws.append(["Relatório de honorários"])  # título antes do cabeçalho
    ws.append(["Sinistro", "Contrato", "Descrição do serviço", "Valor", "Vencimento"])
    ws.append(["555", contrato["nome"], "Honorários iniciais", 1150.0, date(2026, 12, 10)])  # igual: pula
    ws.append(["555", contrato["nome"], "Honorários finais", 800.5, date(2026, 12, 10)])  # diferente: cria
    ws.append(["777", "Carteira Nova", "Honorários iniciais", 1150.0, None])  # contrato novo, sem data
    buf = io.BytesIO()
    wb.save(buf)
    r = cliente.post(f"/api/faturamento/clientes/{cli['id']}/importar-casos/ler", headers=h,
                     files={"arquivo": ("porto.xlsx", buf.getvalue())})
    assert r.status_code == 200, r.text
    lido = r.json()
    s = lido["sugestao"]
    assert lido["campo_chave_id"] == sin["id"] and lido["primeira_linha"] == 3
    assert (s["chave"], s["contrato"], s["descricao"], s["valor"], s["vencimento"]) == (0, 1, 2, 3, 4)

    corpo = {"linhas": lido["linhas"], "mapa": {k: v for k, v in s.items() if v is not None},
             "campo_chave_id": sin["id"], "primeira_linha": lido["primeira_linha"]}
    # cliente com um contrato só: sem escolha na tela, nada de contrato novo
    so_um = cliente.post(f"/api/faturamento/clientes/{cli['id']}/importar-casos/analisar", headers=h, json=corpo).json()
    assert so_um["resumo"]["contratos_novos"] == []
    corpo["contratos_de_para"] = {"Carteira Nova": "Carteira Nova"}  # escolhido na tela: aí sim cria
    plano = cliente.post(f"/api/faturamento/clientes/{cli['id']}/importar-casos/analisar", headers=h, json=corpo).json()
    res = plano["resumo"]
    assert (res["casos_existentes"], res["casos_novos"], res["regras_iguais"], res["regras_novas"], res["sem_data"]) == (2, 1, 1, 1, 1)
    assert res["contratos_novos"] == ["Carteira Nova"]

    corpo["vencimento_padrao"] = "2026-12-20"  # "mesma data para todos?" → sim
    url = f"/api/faturamento/clientes/{cli['id']}/importar-casos/aplicar"
    r = cliente.post(url, headers=h, json=corpo)
    assert r.status_code == 200, r.text
    st = [(x["caso"], x["regra"]) for x in r.json()["resultados"]]
    assert st == [("existente", "igual"), ("existente", "criada"), ("criado", "criada")]
    # repetir não duplica nada
    st = [(x["caso"], x["regra"]) for x in cliente.post(url, headers=h, json=corpo).json()["resultados"]]
    assert st == [("existente", "igual"), ("existente", "igual"), ("existente", "igual")]
    novo = [c for c in cliente.get("/api/faturamento/casos", headers=h, params={"tomador_id": cli["id"]}).json()
            if c["campos"].get(str(sin["id"])) == "777"][0]
    assert novo["contrato_nome"] == "Carteira Nova"


def test_texto_da_nota_por_cliente(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "N")
    # padrão do escritório: sem título do caso e sem o texto da regra
    cfg = cliente.get("/api/config/automacoes", headers=h).json()
    cliente.put("/api/config/automacoes", headers=h, json={**cfg, "nota_titulo_caso": False, "nota_texto_regra": False})
    # este cliente quer os dois na nota
    r = cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h,
                    json={"modelo_titulo_caso": None, "nota_titulo_caso": True, "nota_texto_regra": True})
    assert r.status_code == 200 and r.json()["nota_titulo_caso"] is True, r.text
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Honorarios iniciais sinistro 123", "valor": "1150.00", "data_pagamento": hoje})
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    nh = cliente.post("/api/faturamento/faturar", headers=h, json={
        "aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
    lote_id = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nh["id"]]}).json()["lote_id"]
    texto = cliente.get(f"/api/nfse/importacoes/{lote_id}", headers=h).json()["rps"][0]["discriminacao"]
    assert f"Caso #{caso['numero']} — Ação de cobrança" in texto and "Honorarios iniciais sinistro 123" in texto, texto
    assert texto.split(chr(10))[0] == "Honorários advocatícios — Consultivo N"
    # o cliente tira o nome do contrato e abre o texto com um campo do caso (ex.: nº do sinistro)
    sin = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "N° Sinistro", "tipo": "texto",
                                                                    "tomador_id": cli["id"]}).json()
    ficha = cliente.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()
    cliente.put(f"/api/faturamento/casos/{caso['id']}", headers=h, json={
        "titulo": ficha["titulo"], "campos": {str(sin["id"]): "1037344/2026"}})
    r = cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h, json={
        "nota_titulo_caso": True, "nota_texto_regra": True, "nota_contrato": False, "nota_campo_inicio_id": sin["id"]})
    assert r.status_code == 200 and r.json()["nota_campo_inicio_id"] == sin["id"], r.text
    cliente.delete(f"/api/nfse/importacoes/{lote_id}", headers=h)  # descarta o lote: a fatura volta a poder emitir
    lote2 = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nh["id"]]})
    assert lote2.status_code == 200, lote2.text
    linhas = cliente.get(f"/api/nfse/importacoes/{lote2.json()['lote_id']}", headers=h).json()["rps"][0]["discriminacao"].split(chr(10))
    assert linhas[:2] == ["Sinistro 1037344/2026", "Honorários advocatícios"], linhas


def test_planilha_modelo_da_importacao_volta_reconhecida(cliente):  # noqa: F811
    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "M")
    sin = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Nº do sinistro", "tipo": "texto",
                                                                    "tomador_id": cli["id"]}).json()
    base = f"/api/faturamento/clientes/{cli['id']}/importar-casos"
    r = cliente.get(f"{base}/modelo", headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/vnd.openxmlformats"), r.text
    lido = cliente.post(f"{base}/ler", headers=h, files={"arquivo": ("modelo.xlsx", r.content)}).json()
    assert lido["colunas"][0] == "Nº do sinistro" and len(lido["linhas"]) == 2  # a aba Instruções fica de fora
    assert lido["campo_chave_id"] == sin["id"]
    s = lido["sugestao"]
    assert [s[k] for k in ("chave", "contrato", "descricao", "valor", "vencimento", "titulo", "processo", "parte_contraria")] == list(range(8))
    plano = cliente.post(f"{base}/analisar", headers=h, json={
        "linhas": lido["linhas"], "mapa": s, "campo_chave_id": sin["id"]}).json()
    assert plano["resumo"]["casos_novos"] == 2 and plano["resumo"]["sem_data"] == 1 and not plano["resumo"]["contratos_novos"]


def test_importar_relatorio_xml_agrupado(cliente):  # noqa: F811
    """Relatório exportado de outro sistema: XML 2003 com extensão .xls, em Windows-1252, cabeçalho torto,
    caso só na 1ª linha do grupo, linhas de Total e o nº do sinistro dentro do nome do caso."""
    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "X")
    sin = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Nº do sinistro", "tipo": "texto",
                                                                    "tomador_id": cli["id"]}).json()
    # caso que já existe, cadastrado com o sinistro sem a barra
    cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={
        "titulo": "Caso antigo", "campos": {str(sin["id"]): "1000001-2026"}})

    def cel(v, tipo="String", idx=None):
        i = f' ss:Index="{idx}"' if idx else ""
        return f'<Cell{i}><Data ss:Type="{tipo}">{v}</Data></Cell>'

    linhas = [
        cel("NH", idx=2) + cel("Total"),
        cel("Emissão", idx=5),
        cel("Seguradora Exemplo") + cel("João Silva X José Souza - 1000001/2026") + cel("10/11") + cel("Fixo")
        + cel(1150, "Number") + cel(1150, "Number"),
        cel("11/11", idx=3) + cel("Fixo") + cel(575, "Number") + cel(575, "Number"),
        cel("Total", idx=3) + cel(1725, "Number") + cel(1725, "Number"),
        cel("Ana Lima X Loja Ltda - 1000002/2026 - GRANDE MONTA", idx=2) + cel("12/11") + cel("Fixo")
        + cel(4020, "Number") + cel(4020, "Number"),
        cel("Total", idx=3) + cel(4020, "Number") + cel(4020, "Number"),
        cel("Total") + cel(5745, "Number") + cel(5745, "Number"),
    ]
    xml = ('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
           'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Page 1"><Table>'
           + "".join(f"<Row>{r}</Row>" for r in linhas) + "</Table></Worksheet></Workbook>").encode("cp1252")
    base = f"/api/faturamento/clientes/{cli['id']}/importar-casos"
    r = cliente.post(f"{base}/ler", headers=h, files={"arquivo": ("Faturas de honorários.xls", xml)})
    assert r.status_code == 200, r.text
    lido = r.json()
    assert len(lido["colunas"]) == 6
    s = lido["sugestao"]
    assert (s["chave"], s["titulo"], s["valor"]) == (1, 1, 4), s
    corpo = {"linhas": lido["linhas"], "mapa": {k: v for k, v in s.items() if v is not None}, "campo_chave_id": sin["id"],
             "primeira_linha": lido["primeira_linha"], "descricao_padrao": "Honorários advocatícios",
             "vencimento_padrao": "2026-12-15"}
    plano = cliente.post(f"{base}/analisar", headers=h, json=corpo).json()
    assert [(i["chave"], i["valor"], i["acao_caso"]) for i in plano["itens"]] == [
        ("1000001/2026", "1150.00", "existe"), ("1000001/2026", "575.00", "existe"), ("1000002/2026", "4020.00", "criar")]
    assert not plano["resumo"]["erros"]
    corpo.update(linhas=plano["linhas"], numeros=plano["numeros"])
    res = cliente.post(f"{base}/aplicar", headers=h, json=corpo).json()["resultados"]
    assert [(x["caso"], x["regra"]) for x in res] == [("existente", "criada"), ("existente", "criada"), ("criado", "criada")]
    novo = [c for c in cliente.get("/api/faturamento/casos", headers=h, params={"tomador_id": cli["id"]}).json()
            if c["campos"].get(str(sin["id"])) == "1000002/2026"][0]
    assert novo["titulo"] == "Ana Lima X Loja Ltda - 1000002/2026 - GRANDE MONTA"


def test_importar_dois_lancamentos_iguais_no_mesmo_caso(cliente):  # noqa: F811
    """Duas parcelas iguais (mesmo valor e vencimento) no mesmo caso são duas cobranças, e repetir não duplica."""
    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "Y")
    sin = cliente.post("/api/faturamento/campos", headers=h, json={"nome": "Nº do sinistro", "tipo": "texto",
                                                                    "tomador_id": cli["id"]}).json()
    linhas = [["555", "Parcela", 575.0], ["555", "Parcela", 575.0], ["555", "Outra", 1150.0]]
    corpo = {"linhas": linhas, "mapa": {"chave": 0, "descricao": 1, "valor": 2}, "campo_chave_id": sin["id"],
             "contrato_padrao_id": contrato["id"], "vencimento_padrao": "2026-12-15"}
    base = f"/api/faturamento/clientes/{cli['id']}/importar-casos"
    plano = cliente.post(f"{base}/analisar", headers=h, json=corpo).json()
    assert [i["acao_regra"] for i in plano["itens"]] == ["criar", "criar", "criar"]
    # aplica em dois lotes, como a tela faz (a contagem atravessa os lotes)
    for de, ate in ((0, 1), (1, 3)):
        lote = {**corpo, "linhas": plano["linhas"][de:ate], "numeros": plano["numeros"][de:ate],
                "ocorrencias": plano["ocorrencias"][de:ate]}
        cliente.post(f"{base}/aplicar", headers=h, json=lote)
    caso = [c for c in cliente.get("/api/faturamento/casos", headers=h, params={"tomador_id": cli["id"]}).json()
            if c["campos"].get(str(sin["id"])) == "555"][0]
    regras = cliente.get("/api/faturamento/regras", headers=h, params={"caso_id": caso["id"]}).json()
    assert sorted(float(r["valor"]) for r in regras) == [575.0, 575.0, 1150.0]
    # importar de novo: tudo igual, nada novo
    plano = cliente.post(f"{base}/analisar", headers=h, json=corpo).json()
    assert [i["acao_regra"] for i in plano["itens"]] == ["pular", "pular", "pular"]


def test_agrupamento_das_faturas_por_cliente(cliente):  # noqa: F811
    """O cliente escolhe: tudo numa fatura (contrato), uma por caso ou uma por cobrança."""
    h = _login(cliente)
    cli, contrato, caso1 = _base(cliente, h, "G")
    caso2 = cliente.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Outro caso"}).json()
    hoje = date.today().isoformat()

    def cobrar(caso, desc, valor):
        cliente.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
            "tipo": "fixo", "descricao": desc, "valor": valor, "data_pagamento": hoje})

    def faturar(modo):
        r = cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h, json={"fatura_agrupamento": modo})
        assert r.status_code == 200 and r.json()["fatura_agrupamento"] == (None if modo == "contrato" else modo), r.text
        params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
        itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
        r = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]})
        assert r.status_code in (200, 201), r.text
        return sorted(float(f["valor"]) for f in r.json()["faturas"])

    cobrar(caso1, "Iniciais", "1150.00")
    cobrar(caso1, "Finais", "575.00")
    cobrar(caso2, "Iniciais", "1720.00")
    assert faturar("caso") == [1720.0, 1725.0]  # caso 1 junta as duas cobranças
    cobrar(caso1, "Complemento A", "100.00")
    cobrar(caso1, "Complemento B", "200.00")
    assert faturar("cobranca") == [100.0, 200.0]
    cobrar(caso1, "Extra", "50.00")
    cobrar(caso2, "Extra", "60.00")
    assert faturar("contrato") == [110.0]


def test_xlsx_com_tamanho_declarado_errado_e_lido_inteiro():
    """Relatório exportado que diz ter só "A1": o modo rápido do openpyxl veria a planilha vazia."""
    import io
    import re
    import zipfile

    from openpyxl import Workbook

    from app.modules.faturamento import importar_casos as ic

    wb = Workbook()
    ws = wb.active
    ws.append(["Filtros aplicados: Pagador = Exemplo"])
    ws.append([])
    ws.append(["Contrato_Num", "Contrato_Titulo", "Caso_Titulo", "NumeroExterno", "Data_Vencimento", "Valor_Bruto_Caso_Real"])
    ws.append(["CO-4", "Sinistro Fiança - Tradicional", "Fulano X Beltrano - 1030059/2026", "4029013-47.2026.8.26.0007",
               date(2026, 10, 30), 287.5])
    buf = io.BytesIO()
    wb.save(buf)
    entrada, saida = zipfile.ZipFile(io.BytesIO(buf.getvalue())), io.BytesIO()
    with zipfile.ZipFile(saida, "w") as z:
        for item in entrada.infolist():
            dados = entrada.read(item.filename)
            if item.filename.startswith("xl/worksheets/sheet"):
                dados = re.sub(rb'<dimension ref="[^"]*"/>', b'<dimension ref="A1"/>', dados)
            z.writestr(item, dados)
    linhas = ic._ler_arquivo(saida.getvalue(), "data.xlsx")
    assert len(linhas) == 3
    i = ic._linha_cabecalho(linhas)
    sug = ic._sugerir([str(c) for c in linhas[i]], [[ic._celula(c) for c in r] for r in linhas[i + 1:]], "Nº do sinistro")
    assert (sug["contrato"], sug["chave"], sug["titulo"], sug["processo"], sug["vencimento"], sug["valor"]) == (1, 2, 2, 3, 4, 5)


def test_data_em_numero_de_serie_do_excel():
    from app.modules.faturamento import importar_casos as ic

    assert ic._data(44201.0) == date(2021, 1, 5)  # 44197 = 01/01/2021
    assert ic._data("30/10/2026") == date(2026, 10, 30)
    assert ic._data(1150.0) is None  # valor não é data


def test_importar_base_separando_o_titulo_nos_campos(cliente):  # noqa: F811
    """Base de regras do sistema antigo: o título "Ativo X Passivo - nº" vira três campos do cliente, o título sai do
    modelo, as regras ativas entram como histórico (desativadas), as inativas não entram e o contrato vem do de-para."""
    from app.modules.faturamento import importar_casos as ic

    assert ic.decompor_titulo("Fulano de Tal X Beltrano Ltda - 1012416/2023 - GRANDE MONTA - 1002963-89.2022.8.26.0002") == {
        "ativo": "Fulano de Tal", "passivo": "Beltrano Ltda", "numero": "1012416/2023",
        "processo": "1002963-89.2022.8.26.0002", "extra": "GRANDE MONTA"}
    assert ic.decompor_titulo("Ana MeloX Rui Souza -21745/2022")["passivo"] == "Rui Souza"
    assert ic.decompor_titulo("1020173/2022 - Ana Lima X Rui Souza")["numero"] == "1020173/2022"

    h = _login(cliente)
    cli, contrato_mj, _ = _base(cliente, h, "S")
    ids = {n: cliente.post("/api/faturamento/campos", headers=h, json={"nome": n, "tipo": "texto", "tomador_id": cli["id"]}).json()["id"]
           for n in ("Nº Sinistro", "Parte Polo Ativo", "Parte Polo Passivo")}
    cliente.put(f"/api/faturamento/clientes/{cli['id']}/modelo-caso", headers=h, json={
        "modelo_titulo_caso": "{Parte Polo Ativo} - {Parte Polo Passivo} - Sinistro nº {Nº Sinistro}"})
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Nº Contrato", "Título Caso", "Status da Regra", "Valor", "Data de Pagamento", "Observação"])
    ws.append([4, "Ana Lima X Rui Souza - 1000001/2023", "Ativa", 1150, 44935, "Honorários iniciais"])
    ws.append([4, "Ana Lima X Rui Souza - 1000001/2023", "Inativa", 575, 44935, "Honorários finais"])
    ws.append([35, "Bia Reis X Caio Melo - 1000002/2024", "Inativa", 310, 45300, "Despesas administrativas"])
    ws.append([35, "", "Inativa", 99, 45300, "sem título"])  # inativa sem caso: some
    import io as _io

    buf = _io.BytesIO()
    wb.save(buf)
    base = f"/api/faturamento/clientes/{cli['id']}/importar-casos"
    lido = cliente.post(f"{base}/ler", headers=h, files={"arquivo": ("base.xlsx", buf.getvalue())}).json()
    assert lido["chave_modo"] == "titulo" and lido["decompor"] == {
        "ativo": ids["Parte Polo Ativo"], "passivo": ids["Parte Polo Passivo"], "numero": ids["Nº Sinistro"]}
    corpo = {"linhas": lido["linhas"], "mapa": {k: v for k, v in lido["sugestao"].items() if v is not None},
             "chave_modo": "titulo", "decompor": lido["decompor"], "como_historico": True, "so_ativas": True,
             "contratos_de_para": {"4": "Sinistro Fiança - Tradicional", "35": "Seguro Fiança - Essencial"}}
    # sem de-para, um número solto da planilha é código do sistema antigo: nunca o nº de um contrato do MayaJus
    sem_de_para = cliente.post(f"{base}/analisar", headers=h, json={
        **corpo, "contratos_de_para": {}, "linhas": [[contrato_mj["numero"], "Zé X Lia - 1000009/2024", "Ativa", 10, 44935, "x"]]}).json()
    # cliente com um contrato só: sem escolha na tela, vai para ele (não cria "Contrato N")
    assert sem_de_para["itens"][0]["contrato"]["id"] == contrato_mj["id"] and not sem_de_para["itens"][0]["contrato_novo"]
    # padrão: todas as regras entram, ativas e inativas
    todas = cliente.post(f"{base}/analisar", headers=h, json={**corpo, "so_ativas": False}).json()["resumo"]
    assert (todas["regras_historico"], todas["inativas_ignoradas"]) == (3, 0)
    plano = cliente.post(f"{base}/analisar", headers=h, json=corpo).json()
    r = plano["resumo"]
    assert (r["linhas"], r["casos_novos"], r["regras_historico"], r["inativas_ignoradas"]) == (3, 2, 1, 2), r
    assert {d["valor"]: d["novo"] for d in r["contratos_planilha"]} == {"4": "Sinistro Fiança - Tradicional",
                                                                         "35": "Seguro Fiança - Essencial"}
    corpo.update(linhas=plano["linhas"], numeros=plano["numeros"], ocorrencias=plano["ocorrencias"])
    res = cliente.post(f"{base}/aplicar", headers=h, json=corpo).json()["resultados"]
    assert [(x["caso"], x["regra"]) for x in res] == [("criado", "historico"), ("existente", "inativa"), ("criado", "inativa")]
    casos = {c["titulo"]: c for c in cliente.get("/api/faturamento/casos", headers=h, params={"tomador_id": cli["id"]}).json()}
    ana = casos["Ana Lima - Rui Souza - Sinistro nº 1000001/2023"]
    assert ana["contrato_nome"] == "Sinistro Fiança - Tradicional"
    assert ana["campos"] == {str(ids["Parte Polo Ativo"]): "Ana Lima", str(ids["Parte Polo Passivo"]): "Rui Souza",
                             str(ids["Nº Sinistro"]): "1000001/2023"}
    regras = cliente.get("/api/faturamento/regras", headers=h, params={"caso_id": ana["id"]}).json()
    assert [(x["descricao"], x["valor"], x["ativo"]) for x in regras] == [("Honorários iniciais", "1150.00", False)]
    assert "Bia Reis - Caio Melo - Sinistro nº 1000002/2024" in casos
    # o título mudou (modelo), mas reimportar acha os casos pelos campos e não cria nada
    r2 = cliente.post(f"{base}/analisar", headers=h, json={**corpo, "numeros": None, "ocorrencias": None,
                                                         "linhas": lido["linhas"]}).json()["resumo"]
    assert (r2["casos_novos"], r2["casos_existentes"], r2["regras_iguais"]) == (0, 3, 1)


def test_fatura_mostra_valor_bruto_e_liquido(cliente):  # noqa: F811
    """Líquido = bruto − retenções federais da nota (regra fiscal do cliente; depois de emitida, as da própria nota)."""
    h = _login(cliente)
    cli, contrato, caso = _base(cliente, h, "L")
    ficha = cliente.get(f"/api/nfse/tomadores/{cli['id']}", headers=h).json()
    ficha.update(cpf_cnpj="73428195000149")
    assert cliente.put(f"/api/nfse/tomadores/{cli['id']}", headers=h, json=ficha).status_code == 200
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    r = cliente.post("/api/config/parametros-fiscais", headers=h, json={
        "emissora_id": emissora["id"], "escopo": "tomador", "tomador_id": cli["id"], "descricao": "Retém",
        "ret_ir": "0.015", "ret_pis": "0.0065", "ret_cofins": "0.03", "ret_csll": "0.01", "retencao_pis_cofins": "3"})
    assert r.status_code in (200, 201), r.text
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Honorários iniciais", "valor": "1150.00", "data_pagamento": hoje})
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    nh = cliente.post("/api/faturamento/faturar", headers=h, json={
        "aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
    f = cliente.get(f"/api/nfse/faturas/{nh['id']}", headers=h).json()
    # 17,25 + 7,48 + 34,50 + 11,50 = 70,73 → líquido 1.079,27 (como a NFS-e 20806)
    assert (f["total"], f["retencoes"], f["valor_liquido"]) == ("1150.00", "70.73", "1079.27"), f
    # filtro por cliente na lista e no resumo
    lista = cliente.get("/api/nfse/faturas", headers=h, params={"tomador_id": cli["id"]}).json()
    assert lista["total"] == 1 and lista["itens"][0]["id"] == nh["id"]
    assert cliente.get("/api/nfse/faturas/resumo", headers=h, params={"tomador_id": cli["id"]}).status_code == 200
    # busca pelo título do caso, em Faturas e no Fluxo (o cartão traz o caso)
    assert f["caso_titulo"] == caso["titulo"], f
    achou = cliente.get("/api/nfse/faturas", headers=h, params={"q": caso["titulo"][:-1]}).json()
    assert nh["id"] in [x["id"] for x in achou["itens"]] and achou["itens"][0]["caso_titulo"], achou
    assert cliente.get("/api/nfse/faturas", headers=h, params={"q": "caso que nao existe zzz"}).json()["total"] == 0
    fluxo = cliente.get("/api/faturamento/fluxo", headers=h, params={"tomador_id": cli["id"]}).json()["colunas"]
    cards = [c for col in fluxo.values() for c in col["cards"] if c["tipo"] == "fatura" and c["id"] == nh["id"]]
    assert cards and cards[0]["caso"] == caso["titulo"], cards
    # a NH (PDF) traz a tabela de tributos e o valor a pagar líquido; o PIX também sai no líquido
    import io as _io

    from pypdf import PdfReader

    pdf = cliente.get(f"/api/nfse/faturas/{nh['id']}/pdf", headers=h)
    assert pdf.status_code == 200, pdf.text
    texto = " ".join(pg.extract_text() for pg in PdfReader(_io.BytesIO(pdf.content)).pages)
    for trecho in ("Total de honorários", "Descrição dos tributos", "IR", "17,25", "CSLL", "11,50", "PIS", "7,48",
                   "COFINS", "34,50", "VALOR A PAGAR", "1.079,27"):
        assert trecho in texto, (trecho, texto)
    assert "TOTAL A PAGAR" not in texto
    if f["pix_copia_e_cola"]:
        assert "1079.27" in f["pix_copia_e_cola"]
    # pré-validação do lote da nota: cada RPS e o rodapé mostram o bruto, o retido e o líquido
    lote_id = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nh["id"]]}).json()["lote_id"]
    lote = cliente.get(f"/api/nfse/importacoes/{lote_id}", headers=h).json()
    rps = lote["rps"][0]
    assert (rps["valor"], rps["retencoes"], rps["valor_liquido"]) == ("1150.00", "70.73", "1079.27"), rps
    assert (lote["resumo"]["retencoes_total"], lote["resumo"]["valor_liquido_total"]) == ("70.73", "1079.27"), lote["resumo"]


def test_importar_lendo_campos_rotulados_da_observacao(cliente):  # noqa: F811
    """"Sinistro: 1038248/2026ref.: 39067-1Contrato:55095Autor: ..." → 1 caso por sinistro, com Sinistro e Ref."""
    from app.modules.faturamento.importar_casos import extrair_rotulados

    class C:
        def __init__(self, id, nome):
            self.id, self.nome = id, nome

    cs = [C(1, "Sinistro"), C(2, "Ref"), C(3, "N° do Contrato")]
    assert extrair_rotulados("Sinistro: 1038248/2026ref.: 39067-1Contrato:55095Autor: Agostinho", cs) == {
        1: "1038248/2026", 2: "39067-1", 3: "55095"}
    assert extrair_rotulados("Porto LelloSinistro: 1045549/2026ref.: 39031/2Contrato: 71308Autor: MARILENE", cs) == {
        1: "1045549/2026", 2: "39031/2", 3: "71308"}
    assert extrair_rotulados("Sinistro: 1042289/2026 ref.: 50261-1Contrato: 70841", cs[:2]) == {
        1: "1042289/2026", 2: "50261-1"}
    assert extrair_rotulados("Referente: 12345 sem rotulo", cs) == {}

    h = _login(cliente)
    cli, contrato, _ = _base(cliente, h, "R")
    tid = cli["id"]
    ids = {}
    for nome in ("Sinistro", "Ref"):
        r = cliente.post("/api/faturamento/campos", headers=h, json={"nome": nome, "tipo": "texto", "tomador_id": tid})
        assert r.status_code in (200, 201), r.text
        ids[nome] = r.json()["id"]
    r = cliente.put(f"/api/faturamento/clientes/{tid}/modelo-caso", headers=h, json={"modelo_titulo_caso": "{Sinistro} - {Ref}"})
    assert r.status_code == 200, r.text
    obs1 = "Sinistro: 1038248/2026ref.: 39067-1Contrato:55095Autor: Agostinho Gomes da SilvaGarantido: Maria"
    obs2 = "Porto LelloSinistro: 1045549/2026ref.: 39031/2Contrato: 71308Autor: MARILENE"
    hoje = date.today().isoformat()
    corpo = {"linhas": [[obs1, 500.0, hoje], [obs1, 300.0, hoje], [obs2, 700.0, hoje]],
             "mapa": {"chave": 0, "valor": 1, "vencimento": 2}, "campo_chave_id": ids["Sinistro"],
             "descricao_padrao": "Honorários"}
    # cliente com um contrato só: tudo vai para ele, mesmo com a coluna de contrato dizendo outra coisa
    corpo["linhas"] = [[*ln, "Contrato que nao existe 55095"] for ln in corpo["linhas"]]
    corpo["mapa"]["contrato"] = 3
    plano = cliente.post(f"/api/faturamento/clientes/{tid}/importar-casos/analisar", headers=h, json=corpo)
    assert plano.status_code == 200, plano.text
    plano = plano.json()
    assert plano["resumo"]["casos_novos"] == 2 and plano["resumo"]["regras_novas"] == 3, plano["resumo"]
    assert plano["resumo"]["contratos_novos"] == [] and plano["itens"][0]["contrato"]["id"] == contrato["id"]
    assert plano["itens"][0]["chave"] == "1038248/2026" and plano["itens"][0]["campos_extra"] == {str(ids["Ref"]): "39067-1"}
    r = cliente.post(f"/api/faturamento/clientes/{tid}/importar-casos/aplicar", headers=h, json={
        **corpo, "linhas": plano["linhas"], "numeros": plano["numeros"], "ocorrencias": plano["ocorrencias"]})
    assert r.status_code == 200, r.text
    casos = [c for c in cliente.get("/api/faturamento/casos", headers=h, params={"contrato_id": contrato["id"]}).json()
             if (c.get("campos") or {}).get(str(ids["Sinistro"]))]
    por_sinistro = {c["campos"][str(ids["Sinistro"])]: c for c in casos}
    assert set(por_sinistro) == {"1038248/2026", "1045549/2026"}, por_sinistro
    c1 = por_sinistro["1038248/2026"]
    assert c1["campos"][str(ids["Ref"])] == "39067-1" and c1["titulo"] == "1038248/2026 - 39067-1", c1
    assert por_sinistro["1045549/2026"]["titulo"] == "1045549/2026 - 39031/2"
