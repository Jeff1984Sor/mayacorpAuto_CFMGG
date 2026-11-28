"""Partes do caso: categorias e qualificações por tipo, validações, cliente obrigatório, polo calculado, advogados da
parte, conflito de interesses, título sugerido e troca de tipo.

O banco é o mesmo da suíte inteira: clientes com CNPJ próprio (raiz 7063xxxx).
"""

import pytest

from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_tipos_caso import caso_novo, contrato_novo, operador


@pytest.fixture(autouse=True)
def _sem_tribunal(monkeypatch):
    from app.modules.tribunais import jobs

    monkeypatch.setattr(jobs, "enfileirar", lambda *a, **kw: None)
    monkeypatch.setattr(jobs, "disparar", lambda: None)


def _partes(c, h, caso_id: int, **params) -> dict:
    r = c.get(f"/api/faturamento/casos/{caso_id}/envolvimentos", params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _bloco(partes: dict, nome: str) -> dict:
    return next(b for b in partes["categorias"] if b["nome"] == nome)


def _qual(bloco: dict, nome: str) -> int:
    return next(q["id"] for q in bloco["qualificacoes"] if q["nome"] == nome)


def _pessoa(c, h, nome: str, **extra) -> dict:
    r = c.post("/api/pessoas", json={"tipo_pessoa": "sem_documento", "nome": nome, **extra}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _incluir(c, h, caso_id: int, esperado: int = 201, **corpo):
    r = c.post(f"/api/faturamento/casos/{caso_id}/envolvimentos", json=corpo, headers=h)
    assert r.status_code == esperado, r.text
    return r.json()


def test_categorias_e_qualificacoes_do_seed(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    cats = c.get("/api/faturamento/envolvimento/categorias", headers=h).json()
    por_tipo = {t: [(x["nome"], x["polo"]) for x in cats if x["tipo_caso"] == t] for t in ("contencioso", "consultivo", "administrativo")}
    assert por_tipo["contencioso"] == [("Polo Ativo", "ativo"), ("Polo Passivo", "passivo"), ("Terceiros", "neutro"), ("Outros", "neutro")]
    assert por_tipo["consultivo"] == [("Cliente / Solicitante", "ativo"), ("Contraparte", "passivo"), ("Intervenientes", "neutro"),
                                      ("Outros", "neutro")]
    assert por_tipo["administrativo"] == [("Interessado / Requerente", "ativo"), ("Órgão / Autoridade", "passivo"),
                                          ("Terceiros Interessados", "neutro"), ("Outros", "neutro")]
    quals = {(x["tipo_caso"], x["nome"]): [q["nome"] for q in x["qualificacoes"]] for x in cats}
    ativo = quals[("contencioso", "Polo Ativo")]
    assert len(ativo) == 19 and set(ativo) >= {"Autor", "Reclamante", "Exequente", "Impetrante", "Oponente"}
    assert len(quals[("contencioso", "Polo Passivo")]) == 19 and "Responsável Subsidiário/Solidário (trabalhista)" in quals[("contencioso", "Polo Passivo")]
    assert len(quals[("contencioso", "Terceiros")]) == 12 and len(quals[("contencioso", "Outros")]) == 15
    assert [len(quals[("consultivo", n)]) for n, _ in por_tipo["consultivo"]] == [8, 14, 7, 9]
    assert [len(quals[("administrativo", n)]) for n, _ in por_tipo["administrativo"]] == [12, 8, 7, 9]
    assert "Empresa-alvo (M&A/Due diligence)" in quals[("consultivo", "Contraparte")]
    assert "Servidor Processado (PAD)" in quals[("administrativo", "Interessado / Requerente")]
    # de novo: nada se repete
    assert len(c.get("/api/faturamento/envolvimento/categorias", headers=h).json()) == 12
    assert len(c.get("/api/faturamento/envolvimento/categorias", params={"tipo_caso": "consultivo"}, headers=h).json()) == 4
    # qualificação própria do escritório; em uso ou do sistema só desativa
    passivo = next(x for x in cats if x["tipo_caso"] == "contencioso" and x["nome"] == "Polo Passivo")
    nova = c.post("/api/faturamento/envolvimento/qualificacoes", json={"categoria_id": passivo["id"], "nome": "Corréu 7063"}, headers=h)
    assert nova.status_code == 201 and nova.json()["sistema"] is False
    assert c.post("/api/faturamento/envolvimento/qualificacoes", json={"categoria_id": passivo["id"], "nome": "réu"}, headers=h).status_code == 409
    assert c.delete(f"/api/faturamento/envolvimento/qualificacoes/{nova.json()['id']}", headers=h).json()["mensagem"] == "Qualificação excluída."
    do_sistema = _qual(passivo, "Investigado")
    assert "desativada" in c.delete(f"/api/faturamento/envolvimento/qualificacoes/{do_sistema}", headers=h).json()["mensagem"]
    ho = operador(c, h, "operador.partes.cfg@cfme.com.br")
    assert c.get("/api/faturamento/envolvimento/categorias", headers=ho).status_code == 200
    assert c.post("/api/faturamento/envolvimento/qualificacoes", json={"categoria_id": passivo["id"], "nome": "X"}, headers=ho).status_code == 403


def test_cliente_entra_sozinho_e_validacoes(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Banco das Partes S.A.", 70630001)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso", polo="passivo")
    partes = _partes(c, h, caso["id"])
    assert [b["nome"] for b in partes["categorias"]] == ["Polo Ativo", "Polo Passivo", "Terceiros", "Outros"]
    passivo, ativo = _bloco(partes, "Polo Passivo"), _bloco(partes, "Polo Ativo")
    cli = passivo["envolvimentos"][0]
    assert cli["eh_cliente"] and cli["principal"] and not cli["pendente_reclassificacao"] and partes["tem_cliente"]
    assert cli["pessoa"]["nome"] == "Banco das Partes S.A." and cli["pessoa"]["cliente_id"] == k["tomador_id"] and cli["pessoa"]["eh_cliente"]
    assert partes["polo_cliente"] == "passivo" and not partes["polo_inconsistente"]
    # consultivo e administrativo: o cliente vai para a categoria do lado dele
    cons = caso_novo(c, h, k["id"], tipo_caso="consultivo")
    assert _bloco(_partes(c, h, cons["id"]), "Cliente / Solicitante")["envolvimentos"][0]["eh_cliente"]
    adm = caso_novo(c, h, k["id"], tipo_caso="administrativo")
    assert _bloco(_partes(c, h, adm["id"]), "Interessado / Requerente")["envolvimentos"][0]["eh_cliente"]

    autor = _pessoa(c, h, "Autor das Partes Silva")
    contraparte = _bloco(_partes(c, h, cons["id"]), "Contraparte")
    # categoria de outro tipo de caso; qualificação de outra categoria
    r = _incluir(c, h, caso["id"], esperado=400, pessoa_id=autor["id"], categoria_id=contraparte["id"])
    assert "consultivo" in r["detail"] and "contencioso" in r["detail"]
    r = _incluir(c, h, caso["id"], esperado=400, pessoa_id=autor["id"], categoria_id=ativo["id"], qualificacao_id=_qual(passivo, "Réu"))
    assert "não é da categoria" in r["detail"]
    # inclui o autor; o mesmo papel de novo não entra
    e = _incluir(c, h, caso["id"], pessoa_id=autor["id"], categoria_id=ativo["id"], qualificacao_id=_qual(ativo, "Autor"), principal=True)
    assert e["qualificacao_nome"] == "Autor" and e["categoria_nome"] == "Polo Ativo" and e["pessoa"]["cliente_id"] is None
    _incluir(c, h, caso["id"], esperado=409, pessoa_id=autor["id"], categoria_id=ativo["id"], qualificacao_id=_qual(ativo, "Autor"))
    # um principal por polo
    outro = _pessoa(c, h, "Outro Autor das Partes")
    r = _incluir(c, h, caso["id"], esperado=400, pessoa_id=outro["id"], categoria_id=ativo["id"], principal=True)
    assert "já tem uma parte principal" in r["detail"] and "Autor das Partes Silva" in r["detail"]
    e2 = _incluir(c, h, caso["id"], pessoa_id=outro["id"], categoria_id=ativo["id"])
    url = f"/api/faturamento/casos/{caso['id']}/envolvimentos"
    assert c.put(f"{url}/{e2['id']}", json={"principal": True}, headers=h).status_code == 400
    # título sugerido e resumo
    partes = _partes(c, h, caso["id"])
    assert partes["titulo_sugerido"] == "Autor das Partes Silva e outros x Banco das Partes S.A."
    ficha = c.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()
    assert ficha["titulo_sugerido"] == partes["titulo_sugerido"] and ficha["partes_resumo"] == partes["titulo_sugerido"]
    assert c.get(f"/api/faturamento/casos/{caso['id']}/titulo-sugerido", headers=h).json()["titulo"] == partes["titulo_sugerido"]
    lista = c.get("/api/faturamento/casos", params={"contrato_id": k["id"], "tipo_caso": "contencioso"}, headers=h).json()
    assert lista[0]["partes_resumo"] == partes["titulo_sugerido"]
    # reordenar dentro do bloco
    r = c.post(f"{url}/reordenar", json={"categoria_id": ativo["id"], "ids": [e2["id"], e["id"]]}, headers=h)
    assert r.status_code == 200
    assert [x["id"] for x in _bloco(_partes(c, h, caso["id"]), "Polo Ativo")["envolvimentos"]] == [e2["id"], e["id"]]
    assert c.post(f"{url}/reordenar", json={"categoria_id": ativo["id"], "ids": [cli["id"]]}, headers=h).status_code == 400
    # pelo menos um cliente: não tira nem desmarca o último
    r = c.delete(f"{url}/{cli['id']}", headers=h)
    assert r.status_code == 400 and "pelo menos um cliente" in r.json()["detail"]
    assert c.put(f"{url}/{cli['id']}", json={"eh_cliente": False}, headers=h).status_code == 400
    # parte retirada fica no histórico e pode voltar
    assert c.delete(f"{url}/{e2['id']}", headers=h).status_code == 200
    assert e2["id"] not in [x["id"] for b in _partes(c, h, caso["id"])["categorias"] for x in b["envolvimentos"]]
    fora = next(x for b in _partes(c, h, caso["id"], inativos=True)["categorias"] for x in b["envolvimentos"] if x["id"] == e2["id"])
    assert fora["ativo"] is False and fora["data_exclusao"]
    assert c.put(f"{url}/{e2['id']}", json={"ativo": True}, headers=h).json()["ativo"] is True
    # quem aparece em caso não é excluído do cadastro, só desativado
    assert "desativada" in c.delete(f"/api/pessoas/{outro['id']}", headers=h).json()["mensagem"]
    casos_do_autor = c.get(f"/api/pessoas/{autor['id']}/casos", headers=h).json()
    assert [(x["caso_id"], x["categoria"], x["qualificacao"], x["eh_cliente"]) for x in casos_do_autor] == [
        (caso["id"], "Polo Ativo", "Autor", False)]
    casos_do_banco = c.get(f"/api/pessoas/{cli['pessoa_id']}/casos", headers=h).json()
    assert {x["caso_id"] for x in casos_do_banco} == {caso["id"], cons["id"], adm["id"]} and all(x["eh_cliente"] for x in casos_do_banco)
    # quem só consulta não altera as partes
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    from tests.test_perfis import _usuario_com_perfil

    hv = _usuario_com_perfil(c, h, "visualizador.partes@cfme.com.br", perfis["Visualizador"]["id"])[1]
    assert c.get(url, headers=hv).status_code == 200
    assert c.post(url, json={"pessoa_id": autor["id"], "categoria_id": passivo["id"]}, headers=hv).status_code == 403


def test_polo_do_caso_vem_das_partes(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente do Polo Calculado", 70630002)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso")  # sem polo: lado ativo, a confirmar
    partes = _partes(c, h, caso["id"])
    cli = _bloco(partes, "Polo Ativo")["envolvimentos"][0]
    assert cli["pendente_reclassificacao"] and partes["pendentes_reclassificacao"] == 1 and partes["polo_cliente"] is None
    assert caso["polo"] is None and caso["pendentes_reclassificacao"] == 1
    url = f"/api/faturamento/casos/{caso['id']}"
    # mover o cliente de bloco define o polo do caso
    passivo = _bloco(partes, "Polo Passivo")
    r = c.post(f"{url}/envolvimentos/{cli['id']}/mover", json={"categoria_id": passivo["id"], "qualificacao_id": _qual(passivo, "Réu")}, headers=h)
    assert r.status_code == 200 and r.json()["qualificacao_nome"] == "Réu" and not r.json()["pendente_reclassificacao"]
    assert c.get(url, headers=h).json()["polo"] == "passivo"
    # a ficha (tela antiga) muda o polo: a parte que é cliente acompanha
    r = c.put(url, json={"titulo": "Caso de teste", "tipo_caso": "contencioso", "polo": "ativo"}, headers=h)
    assert r.status_code == 200 and r.json()["polo"] == "ativo"
    partes = _partes(c, h, caso["id"])
    assert [x["id"] for x in _bloco(partes, "Polo Ativo")["envolvimentos"]] == [cli["id"]] and partes["polo_cliente"] == "ativo"
    # a ficha sem polo não desfaz o que as partes dizem
    assert c.put(url, json={"titulo": "Caso de teste"}, headers=h).json()["polo"] == "ativo"
    # dois clientes em polos diferentes: avisa
    socio = _pessoa(c, h, "Sócio Também Cliente 7063")
    _incluir(c, h, caso["id"], pessoa_id=socio["id"], categoria_id=passivo["id"], eh_cliente=True)
    assert _partes(c, h, caso["id"])["polo_inconsistente"] is True
    # agora dá para tirar um cliente (sobra o outro)
    assert c.delete(f"{url}/envolvimentos/{cli['id']}", headers=h).status_code == 200
    assert c.get(url, headers=h).json()["polo"] == "passivo"


def test_advogados_da_parte(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente dos Advogados da Parte", 70630003)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso", polo="ativo")
    partes = _partes(c, h, caso["id"])
    reu = _pessoa(c, h, "Réu Com Advogado 7063")
    a1 = c.post("/api/advogados", json={"nome": "Dr. Primeiro da Parte", "oab_numero": "706301", "oab_uf": "SP"}, headers=h).json()
    a2 = c.post("/api/advogados", json={"nome": "Dra. Segunda da Parte", "oab_numero": "706302", "oab_uf": "RJ"}, headers=h).json()
    passivo = _bloco(partes, "Polo Passivo")
    e = _incluir(c, h, caso["id"], pessoa_id=reu["id"], categoria_id=passivo["id"], qualificacao_id=_qual(passivo, "Réu"),
                 advogados=[{"advogado_id": a1["advogado_id"], "principal": True, "tipo_habilitacao": "procuracao"}])
    assert [(a["nome"], a["oab"], a["principal"]) for a in e["advogados"]] == [("Dr. Primeiro da Parte", "OAB/SP 706.301", True)]
    url = f"/api/faturamento/casos/{caso['id']}/envolvimentos/{e['id']}/advogados"
    r = c.post(url, json={"advogado_id": a2["advogado_id"], "principal": True, "data_habilitacao": "2030-01-05"}, headers=h)
    assert r.status_code == 201 and r.json()["oab"] == "OAB/RJ 706.302"
    lista = c.get(url, headers=h).json()
    assert [(a["nome"], a["principal"]) for a in lista] == [("Dra. Segunda da Parte", True), ("Dr. Primeiro da Parte", False)]
    assert c.post(url, json={"advogado_id": a2["advogado_id"]}, headers=h).status_code == 409
    assert c.post(url, json={"advogado_id": a1["advogado_id"], "oab_id": a2["oabs"][0]["id"]}, headers=h).status_code in (400, 409)
    r = c.put(f"{url}/{lista[1]['id']}", json={"advogado_id": a1["advogado_id"], "tipo_habilitacao": "substabelecimento_com_reserva",
                                                "data_desabilitacao": "2031-01-01", "ativo": False}, headers=h)
    assert r.status_code == 200 and r.json()["ativo"] is False and r.json()["tipo_habilitacao_nome"] == "Substabelecimento com reserva"
    assert c.put(f"{url}/{lista[1]['id']}", json={"advogado_id": a1["advogado_id"], "tipo_habilitacao": "xpto"}, headers=h).status_code == 400
    # advogado habilitado em caso não perde os dados de advogado nem a OAB em uso
    r = c.put(f"/api/pessoas/{a2['pessoa_id']}", json={"tipo_pessoa": "sem_documento", "nome": "Dra. Segunda da Parte", "advogado": None}, headers=h)
    assert r.status_code == 400 and "partes de casos" in r.json()["detail"]
    assert c.delete(f"{url}/{lista[0]['id']}", headers=h).status_code == 200
    assert len(c.get(url, headers=h).json()) == 1


def test_conflito_de_interesses(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    ka = contrato_novo(c, h, "Construtora Conflito Ltda", 70630004)
    kb = contrato_novo(c, h, "Fornecedor Conflito Ltda", 70630005)
    caso_a = caso_novo(c, h, ka["id"], tipo_caso="contencioso", polo="ativo", titulo="A construtora cobra")
    caso_b = caso_novo(c, h, kb["id"], tipo_caso="contencioso", polo="ativo", titulo="O fornecedor cobra")
    construtora = _bloco(_partes(c, h, caso_a["id"]), "Polo Ativo")["envolvimentos"][0]["pessoa"]
    partes_b = _partes(c, h, caso_b["id"])
    passivo_b, ativo_b = _bloco(partes_b, "Polo Passivo"), _bloco(partes_b, "Polo Ativo")
    url_b = f"/api/faturamento/casos/{caso_b['id']}/envolvimentos"
    # a construtora é cliente no caso A e entraria como parte contrária no caso B
    chk = c.get(f"{url_b}/conflito", params={"pessoa_id": construtora["id"], "categoria_id": passivo_b["id"]}, headers=h).json()
    assert chk["conflito"] and [(x["caso_id"], x["papel"]) for x in chk["conflitos"]] == [(caso_a["id"], "cliente")]
    # do mesmo lado do cliente não é conflito
    assert c.get(f"{url_b}/conflito", params={"pessoa_id": construtora["id"], "categoria_id": ativo_b["id"]}, headers=h).json()["conflito"] is False
    r = c.post(url_b, json={"pessoa_id": construtora["id"], "categoria_id": passivo_b["id"]}, headers=h)
    assert r.status_code == 409 and r.json()["conflito"] is True and "conflito de interesses" in r.json()["detail"]
    assert r.json()["conflitos"][0]["numero"] == caso_a["numero"]
    assert construtora["id"] not in [x["pessoa_id"] for x in _partes(c, h, caso_b["id"])["categorias"][1]["envolvimentos"]]
    # confirmando, entra, e fica registrado quem confirmou
    e = _incluir(c, h, caso_b["id"], pessoa_id=construtora["id"], categoria_id=passivo_b["id"], conflito_confirmado=True)
    assert [x["caso_id"] for x in e["conflitos"]] == [caso_a["id"]]
    aud = c.get("/api/auditoria", headers=h).text
    assert "conflito de interesses confirmado" in aud and "Construtora Conflito Ltda" in aud
    # o aviso aparece dos dois lados: no caso A a construtora (cliente) é parte contrária em B
    cli_a = _bloco(_partes(c, h, caso_a["id"]), "Polo Ativo")["envolvimentos"][0]
    assert [(x["caso_id"], x["papel"]) for x in cli_a["conflitos"]] == [(caso_b["id"], "contraria")]
    # caso encerrado deixa de contar
    c.put(f"/api/faturamento/casos/{caso_a['id']}", json={"titulo": "A construtora cobra", "polo": "ativo", "status": "encerrado",
                                                           "data_encerramento": "2030-05-05"}, headers=h)
    assert c.get(f"{url_b}/conflito", params={"pessoa_id": construtora["id"], "categoria_id": passivo_b["id"]}, headers=h).json()["conflito"] is False


def test_troca_de_tipo_preserva_e_marca_pendencias(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente da Troca de Partes", 70630006)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso", polo="passivo", titulo="Vai virar consultivo")
    partes = _partes(c, h, caso["id"])
    ativo, outros = _bloco(partes, "Polo Ativo"), _bloco(partes, "Outros")
    autor, perito = _pessoa(c, h, "Autor da Troca 7063"), _pessoa(c, h, "Perito da Troca 7063")
    _incluir(c, h, caso["id"], pessoa_id=autor["id"], categoria_id=ativo["id"], qualificacao_id=_qual(ativo, "Autor"), principal=True)
    _incluir(c, h, caso["id"], pessoa_id=perito["id"], categoria_id=outros["id"], qualificacao_id=_qual(outros, "Perito Judicial"))
    r = c.put(f"/api/faturamento/casos/{caso['id']}", json={"titulo": "Vai virar consultivo", "tipo_caso": "consultivo"}, headers=h)
    assert r.status_code == 200 and r.json()["pendentes_reclassificacao"] == 3 and r.json()["consultivo"]["etapa"] == "recebido"
    partes = _partes(c, h, caso["id"])
    assert [b["nome"] for b in partes["categorias"]] == ["Cliente / Solicitante", "Contraparte", "Intervenientes", "Outros"]
    por_bloco = {b["nome"]: [(x["pessoa"]["nome"], x["qualificacao_id"], x["pendente_reclassificacao"]) for x in b["envolvimentos"]]
                 for b in partes["categorias"]}
    assert por_bloco["Cliente / Solicitante"] == [("Autor da Troca 7063", None, True)]  # polo ativo → ativo
    assert por_bloco["Contraparte"] == [("Cliente da Troca de Partes", None, True)]  # polo passivo → passivo
    assert por_bloco["Outros"] == [("Perito da Troca 7063", None, True)] and por_bloco["Intervenientes"] == []
    assert partes["tem_cliente"] and partes["titulo_sugerido"] is None
    # revisar a parte tira a pendência
    cliente_env = _bloco(partes, "Contraparte")["envolvimentos"][0]
    solic = _bloco(partes, "Cliente / Solicitante")
    r = c.post(f"/api/faturamento/casos/{caso['id']}/envolvimentos/{cliente_env['id']}/mover",
               json={"categoria_id": solic["id"], "qualificacao_id": _qual(solic, "Contratante")}, headers=h)
    assert r.status_code == 200 and r.json()["pendente_reclassificacao"] is False
    assert c.get(f"/api/faturamento/casos/{caso['id']}", headers=h).json()["pendentes_reclassificacao"] == 2
    from app.core.db import SessionLocal
    from app.modules.faturamento.tipos_caso import CasoContencioso

    with SessionLocal() as db:
        assert db.get(CasoContencioso, caso["id"]) is not None  # os dados do contencioso ficam guardados


def test_mescla_leva_as_partes(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente da Mescla de Partes", 70630007)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso", polo="ativo")
    passivo = _bloco(_partes(c, h, caso["id"]), "Polo Passivo")
    certa, errada = _pessoa(c, h, "Transportadora Mesclada 7063 Ltda"), _pessoa(c, h, "Transportadora Mesclada 7063")
    _incluir(c, h, caso["id"], pessoa_id=errada["id"], categoria_id=passivo["id"], qualificacao_id=_qual(passivo, "Réu"))
    r = c.post(f"/api/pessoas/{certa['id']}/mesclar", json={"duplicada_id": errada["id"]}, headers=h)
    assert r.status_code == 200 and r.json()["em_uso"]["casos"] == 1
    reu = _bloco(_partes(c, h, caso["id"]), "Polo Passivo")["envolvimentos"][0]
    assert reu["pessoa_id"] == certa["id"] and reu["qualificacao_nome"] == "Réu"
    assert c.get(f"/api/pessoas/{errada['id']}/casos", headers=h).json() == []
    # pessoa desativada não entra em caso novo
    r = c.post(f"/api/faturamento/casos/{caso['id']}/envolvimentos", json={"pessoa_id": errada["id"], "categoria_id": passivo["id"]}, headers=h)
    assert r.status_code == 400 and "desativada" in r.json()["detail"]


def test_relatorio_de_casos_com_tipo_fase_prognostico_e_partes(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    k = contrato_novo(c, h, "Cliente do Relatório de Partes", 70630008)
    caso = caso_novo(c, h, k["id"], tipo_caso="contencioso", polo="ativo", titulo="Relatório 7063",
                     contencioso={"pre_ajuizamento": True, "fase_processual": "recursal", "prognostico": "provavel"})
    passivo = _bloco(_partes(c, h, caso["id"]), "Polo Passivo")
    _incluir(c, h, caso["id"], pessoa_id=_pessoa(c, h, "Réu do Relatório 7063")["id"], categoria_id=passivo["id"], principal=True)
    cons = caso_novo(c, h, k["id"], tipo_caso="consultivo", titulo="Relatório 7063 consultivo")
    cat = c.get("/api/relatorios/catalogo", headers=h).json()
    colunas = {col["id"]: col["rotulo"] for f in cat["fontes"] if f["id"] == "casos" for col in f["colunas"]}
    assert {"tipo_caso": "Tipo de caso", "fase": "Fase / etapa", "prognostico": "Prognóstico", "partes": "Partes"}.items() <= colunas.items()
    r = c.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "colunas": ["numero", "tipo_caso", "fase", "prognostico", "partes"],
        "filtros": [{"coluna": "cliente", "valores": ["Cliente do Relatório de Partes"]}]})
    assert r.status_code == 200, r.text
    linhas = {x[0]: x[1:] for x in r.json()["linhas"]}
    assert linhas[caso["numero"]] == ["Contencioso", "Recursal", "Provável", "Cliente do Relatório de Partes x Réu do Relatório 7063"]
    assert linhas[cons["numero"]] == ["Consultivo", "Recebido", None, "Cliente do Relatório de Partes"]
    r = c.post("/api/relatorios/executar", headers=h, json={
        "fonte": "casos", "filtros": [{"coluna": "cliente", "valores": ["Cliente do Relatório de Partes"]}],
        "grafico": {"tipo": "barras", "dimensao": "tipo_caso"}}).json()
    assert {x["rotulo"]: x["total"] for x in r["grafico"]["categorias"]} == {"Contencioso": 1, "Consultivo": 1}
