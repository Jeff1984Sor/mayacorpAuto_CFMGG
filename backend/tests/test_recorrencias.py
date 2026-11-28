"""Admin MayaCorp: cliente sem acesso ao sistema (só cobrança) e o serviço recorrente como regra de cobrança do
faturamento (as recorrências antigas do controle, com link do Mercado Pago, são migradas e desligadas)."""

import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core import tenancy
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)

ADM = ("rec@mayacorp.com.br", "Maya@2026xx")


@pytest.fixture(scope="module")
def painel(cliente):  # noqa: F811
    """Controle próprio deste arquivo: a CFME no banco principal e o admin MayaCorp num banco só dele."""
    from app.controle import models, service

    pasta = Path(tempfile.mkdtemp(prefix="mayajus-controle-rec-"))
    tenancy.forcar_controle(f"sqlite:///{(pasta / 'controle.db').as_posix()}")
    models._fabrica = None
    service.limpar_cache()
    service.migrar_controle()
    assert service.registrar_principal_se_faltar() == "cfme"
    service.provisionar("mcrec", "MayaCorp", admin_nome="Jefferson", admin_email=ADM[0], dominios=["admin.rec.test"],
                        tipo="mayacorp", admin_login="recadm", admin_senha=ADM[1])
    yield cliente
    tenancy.forcar_controle(None)
    models._fabrica = None
    service.limpar_cache()


class _Hoje(date):
    @classmethod
    def today(cls):
        return date(2026, 11, 28)


@pytest.fixture(autouse=True)
def hoje_fixo(monkeypatch):
    """As telas decidem "vencida" pelo dia de hoje. Os testes usam datas de 2027: com o hoje fixo eles não mudam de
    resultado conforme o dia em que rodam."""
    monkeypatch.setattr("app.controle.routes_cobranca.date", _Hoje)


@pytest.fixture
def mp(monkeypatch):
    """Mercado Pago de mentira (como em test_escritorios) e os e-mails de cobrança guardados numa lista."""
    from app.controle import cobranca, mercadopago

    estado = {"ref": "", "emails": []}

    class MPFalso(mercadopago.MercadoPago):
        def _chamar(self, metodo, caminho, json=None, chave=None):
            if caminho == "/users/me":
                return {"id": 1, "email": "contato@mayacorp.com.br"}
            if caminho == "/checkout/preferences":
                return {"id": f"pref-{json['external_reference']}", "init_point": f"https://mp.test/{json['external_reference']}"}
            if caminho.startswith("/v1/payments/"):
                return {"id": 901, "status": "approved", "external_reference": estado["ref"], "payment_type_id": "pix",
                        "date_approved": "2027-01-08T10:00:00.000-03:00"}
            if caminho.startswith("/preapproval/"):
                estado["assinatura"] = (metodo, json)
                return {"id": "pre-9", "status": "cancelled"}
            raise AssertionError(caminho)

    monkeypatch.setattr(mercadopago, "MercadoPago", MPFalso)
    monkeypatch.setattr("app.controle.cobranca.MercadoPago", MPFalso)
    monkeypatch.setattr("app.controle.routes_cobranca.MercadoPago", MPFalso)
    monkeypatch.setattr(cobranca, "enviar_email", lambda para, assunto, corpo, **kw: estado["emails"].append((para, assunto, kw)))
    return estado


def _arquivo_do_banco(slug: str) -> Path:
    from sqlalchemy.engine import make_url

    from app.controle import service

    return Path(make_url(tenancy.url_do_banco(service.nome_do_banco(slug))).database)


def _entrar(c, email=ADM[0], senha=ADM[1]):
    r = c.post("/api/auth/login", json={"email": email, "senha": senha})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def _conectar_mp(c, adm):
    r = c.put("/api/admin/cobranca/config", headers=adm,
              json={"token": "APP_USR-rec", "dia_vencimento": 10, "gerar_automatico": True, "regua": [-3, 0, 3]})
    assert r.status_code == 200 and r.json()["conectado"], r.text


def _externo(c, adm, nome, **ficha):
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"nome": nome, **ficha})
    assert r.status_code == 201, r.text
    return r.json()


def _recorrencia_antiga(cid, **dados) -> int:
    """Uma linha do motor antigo, gravada direto no controle (as rotas que criavam não existem mais)."""
    from app.controle.models import CobrancaRecorrente, SessaoControle

    campos = {"descricao": "Hospedagem do site", "valor": Decimal("300.00"), "periodicidade": "mensal", "dia_vencimento": 10,
              "inicio": date(2027, 1, 1), "termino_tipo": "sem_fim", "antecedencia": 5, "status": "ativa", "geradas": 0,
              "rotina_no_dia": 0, **dados}
    campos.setdefault("proxima_competencia", campos["inicio"])
    with SessaoControle() as db:
        r = CobrancaRecorrente(cliente_id=cid, **campos)
        db.add(r)
        db.commit()
        return r.id


def _cobranca_antiga(cid, rid, competencia, descricao, valor) -> int:
    from app.controle.models import Cobranca, SessaoControle

    with SessaoControle() as db:
        k = Cobranca(cliente_id=cid, tipo="recorrente", recorrencia_id=rid, competencia=competencia, descricao=descricao,
                     itens=[{"descricao": descricao, "valor": valor}], valor=Decimal(valor),
                     vencimento=date(int(competencia[:4]), int(competencia[5:]), 10), status="pendente", avisos=[])
        db.add(k)
        db.commit()
        return k.id


def _emissora(c, adm) -> int:
    lista = c.get("/api/nfse/emissoras", headers=adm).json()
    if lista:
        return lista[0]["id"]
    r = c.post("/api/nfse/emissoras", headers=adm, json={
        "razao_social": "MayaCorp MEI", "cnpj": "37552605000103", "ccm": "", "sistema_emissao": "nacional", "regime": "mei",
        "cep": "18035000", "cidade": "Sorocaba", "uf": "SP", "codigo_municipio": "3552205", "cod_trib_nacional": "010101",
        "serie_rps": "2", "prox_rps": 1, "aliquota_iss": "0.02"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _regras(c, adm, tomador_id):
    k = c.get(f"/api/faturamento/clientes/{tomador_id}/contrato", headers=adm).json()
    return c.get("/api/faturamento/regras", headers=adm, params={"contrato_id": k["id"]}).json() if k else []


def _itens(c, adm, tomador_id, de, ate):
    r = c.get("/api/faturamento/itens-a-faturar", headers=adm, params={"de": de, "ate": ate, "cliente_ids": [tomador_id]})
    assert r.status_code == 200, r.text
    return [i for cli in r.json()["clientes"] for k in cli["contratos"] for i in k["itens"]]


def _cobrancas(c, adm, cid, **filtro):
    return c.get("/api/admin/cobrancas", headers=adm, params={"cliente_id": cid, **filtro}).json()


def test_cliente_sem_acesso_nao_cria_banco_nem_login(painel, mp):
    from app.controle import cobranca, service
    from app.controle.models import Cliente, Login, SessaoControle
    from app.core.security import criar_token

    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    novo = _externo(c, adm, "Padaria Pão Quente Ltda", documento="11.444.777/0001-61", responsavel="Rui Pão",
                    email_financeiro="Fin@PaoQuente.com.br", telefone="15 99999-0000", observacao="Site e e-mail")
    cid, slug = novo["id"], novo["slug"]
    assert novo["tipo"] == "externo" and novo["status"] == "ativo" and slug == "padaria-pao-quente-ltda"
    assert novo["plano"] is None and novo["valor"] is None and novo["teste_ate"] is None and novo["dominios"] == []
    assert novo["banco_principal"] is False and novo["ambiente_guardado"] is False
    assert novo["email_financeiro"] == "fin@paoquente.com.br" and novo["documento"] == "11444777000161"
    assert "convite" not in novo and mp["emails"] == []  # nada de boas-vindas

    # nada de banco, login ou domínio
    assert not _arquivo_do_banco(slug).exists()
    with SessaoControle() as db:
        reg = db.get(Cliente, cid)
        assert reg.banco is None and reg.plano_id is None and reg.dominios == []
        assert db.scalar(select(Login).where(Login.cliente_id == cid)) is None
        # o uso nunca abre o banco principal por engano (banco vazio aqui não é a CFME)
        assert cobranca.uso(reg, 2027, 1)["usuarios"] == 0
        assert cobranca.gerar_mensalidade(db, reg, 2027, 1) is None and cobranca.primeira_cobranca(db, reg) is None
    # o mesmo cliente está no cadastro da MayaCorp (para a nota)
    tom = c.get("/api/nfse/tomadores", headers=adm, params={"q": "Padaria"}).json()
    assert [(t["nome"], t["cpf_cnpj"]) for t in tom.get("itens", tom)] == [("Padaria Pão Quente Ltda", "11444777000161")]

    # nunca é escritório: nem pelo identificador, nem na lista dos ativos (worker, migração), nem no login
    assert service.por_slug(slug) is None
    assert slug not in {e.slug for e in service.ativos()}
    assert slug not in service.migrar_todos()
    assert service.registrar_principal_se_faltar() is None  # a CFME continua sendo a única no banco principal
    with pytest.raises(service.RegraControle):
        service.sincronizar_todos(slug)
    with SessaoControle() as db:  # mesmo que um login apontasse para ele, não entra
        db.add(Login(chave="rui@paoquente.com.br", cliente_id=cid, usuario_id=1))
        db.commit()
    assert service.por_login("rui@paoquente.com.br") is None
    assert c.post("/api/auth/login", json={"email": "rui@paoquente.com.br", "senha": "Cfme@2026"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "fin@paoquente.com.br", "senha": "Cfme@2026"}).status_code == 401
    # token com o identificador dele (banco vazio) não pode cair no banco principal: o usuário 1 lá é da CFME
    with tenancy.usando(tenancy.Escritorio(slug=slug, banco=None)):
        token = criar_token("1", "access")
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert c.post("/api/auth/primeiro-acesso/pedir", json={"email": "fin@paoquente.com.br"}).status_code == 200

    # lista, filtro e resumo
    todos = c.get("/api/admin/clientes", headers=adm).json()
    assert {x["slug"]: x["tipo"] for x in todos} == {"cfme": "escritorio", slug: "externo"}
    assert [x["slug"] for x in c.get("/api/admin/clientes", headers=adm, params={"tipo": "externo"}).json()] == [slug]
    assert [x["slug"] for x in c.get("/api/admin/clientes", headers=adm, params={"tipo": "escritorio"}).json()] == ["cfme"]
    resumo = c.get("/api/admin/resumo", headers=adm).json()
    assert resumo["clientes"] == 1 and resumo["sem_acesso"] == 1  # não entra na conta dos escritórios

    # o que é do ambiente não existe para ele
    for metodo, rota, corpo in [("get", "uso", None), ("get", "usuarios", None), ("get", "ia", None),
                                ("post", "usuarios", {"nome": "Ana", "email": "ana@paoquente.com.br"}),
                                ("post", "dominios", {"host": "app.paoquente.com.br"}), ("post", "boas-vindas", None),
                                ("post", "assinatura", None), ("put", "pagamento", {"forma_pagamento": "cartao"})]:
        r = getattr(c, metodo)(f"/api/admin/clientes/{cid}/{rota}", headers=adm, **({"json": corpo} if corpo else {}))
        assert r.status_code == 400 and "acesso ao sistema" in r.json()["detail"], (rota, r.text)
    assert c.get(f"/api/admin/clientes/{cid}/pagamento", headers=adm).json()["forma_pagamento"] == "link"
    # situação: só ativo ou inativo; a ficha não aceita plano, teste nem indicação
    assert c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "suspenso"}).status_code == 400
    plano = c.get("/api/admin/planos", headers=adm).json()[0]
    r = c.put(f"/api/admin/clientes/{cid}", headers=adm, json={
        "nome": "Padaria Pão Quente", "documento": "11444777000161", "responsavel": "Rui Pão", "telefone": None,
        "email_financeiro": "fin@paoquente.com.br", "plano_id": plano["id"], "ciclo": "anual", "teste_ate": "2027-12-31",
        "inicio_contrato": None, "observacao": None, "indicado_por_id": None, "robos": ["nfse_lote"]})
    assert r.status_code == 200 and r.json()["nome"] == "Padaria Pão Quente", r.text
    assert r.json()["plano"] is None and r.json()["teste_ate"] is None and r.json()["robos"] == []
    # não pode indicar (o desconto por indicação é entre escritórios)
    cfme = next(x for x in todos if x["slug"] == "cfme")
    ficha = {k: cfme[k] for k in ("nome", "documento", "responsavel", "email_financeiro", "telefone", "plano_id", "ciclo",
                                   "inicio_contrato", "teste_ate", "observacao")}
    assert c.put(f"/api/admin/clientes/{cfme['id']}", headers=adm, json={**ficha, "indicado_por_id": cid}).status_code == 400

    # mensalidade de plano não é com ele; a avulsa continua valendo
    assert c.post("/api/admin/cobrancas/gerar", headers=adm, json={"competencia": "2027-01", "enviar": False}).json() == {
        "criadas": [], "erros": []}
    r = c.post("/api/admin/cobrancas/avulsa", headers=adm, json={"cliente_id": cid, "descricao": "Criação do site",
                                                                 "valor": "900.00", "vencimento": "2027-01-20"})
    assert r.status_code == 201 and r.json()["cliente_tipo"] == "externo", r.text
    para, assunto, extra = mp["emails"][-1]
    assert para == ["fin@paoquente.com.br"] and assunto.startswith("MayaCorp — Criação do site") and extra == {"marca": "MayaCorp"}

    # nome repetido ganha outro identificador; excluir não mexe em banco nenhum
    outro = _externo(c, adm, "Padaria Pão Quente Ltda")
    assert outro["slug"] == "padaria-pao-quente-ltda-2"
    r = c.delete(f"/api/admin/clientes/{outro['id']}", headers=adm, params={"confirmar": outro["slug"]})
    assert r.status_code == 200 and "banco" not in r.json()["mensagem"], r.text
    assert _login(c)  # a CFME (banco principal) continua entrando


def test_recorrencias_antigas_viram_regras_de_cobranca(painel, mp, caplog):
    """O motor do controle foi desligado: no migrar do deploy cada recorrência ativa ou pausada vira uma regra
    recorrente do faturamento no cliente, só com as competências que ainda não tinham saído, uma vez só."""
    from app.controle import cobranca, faturamento_admin
    from app.controle.models import Cliente, Cobranca, CobrancaRecorrente, SessaoControle

    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    # o banco do admin trabalha sem contratos (ligado sozinho no migrar); o dos escritórios não muda
    assert faturamento_admin.preparar()["sem_contratos"] is True
    assert c.get("/api/faturamento/config", headers=adm).json() == {"usa_contrato": False}
    # e tem o emissor de NFS-e liberado (a nota da fatura sai pela tela do lote)
    assert "nfse_lote" in c.get("/api/auth/me", headers=adm).json()["robos"]
    assert c.get("/api/faturamento/config", headers=_login(c)).json() == {"usa_contrato": True}

    vida = _externo(c, adm, "Clínica Vida", documento="33000167000101", email_financeiro="fin@clinicavida.com.br")
    cid, tid = vida["id"], vida["tomador_id"]
    assert tid and _regras(c, adm, tid) == []
    # como está em produção: mensal, dia 5, começa em 12/2026, nenhuma cobrança gerada
    r1 = _recorrencia_antiga(cid, descricao="Geração de Documentos", valor=Decimal("200.00"), dia_vencimento=5,
                             inicio=date(2026, 12, 1), observacao="Combinado com a Dra. Ana")
    # trimestral de 5 cobranças que já gerou 2 (jan e abr/2027): sobram 3, a partir de julho
    r2 = _recorrencia_antiga(cid, descricao="Suporte", valor=Decimal("450.00"), periodicidade="trimestral",
                             termino_tipo="quantidade", termino_quantidade=5, geradas=2, proxima_competencia=date(2027, 7, 1))
    k_abril = _cobranca_antiga(cid, r2, "2027-04", "Suporte 04/2027", "450.00")
    # pausada, anual, no último dia do mês, até uma data
    r3 = _recorrencia_antiga(cid, descricao="Domínio", valor=Decimal("90.00"), periodicidade="anual", dia_vencimento=0,
                             inicio=date(2027, 2, 1), termino_tipo="data", termino_data=date(2029, 12, 31), status="pausada")
    # as que não entram: encerrada, e a que já gerou tudo o que tinha para gerar
    r4 = _recorrencia_antiga(cid, descricao="Antiga", status="encerrada")
    r5 = _recorrencia_antiga(cid, descricao="Parcelas", termino_tipo="quantidade", termino_quantidade=2, geradas=2,
                             proxima_competencia=date(2027, 3, 1))
    # cliente cujo CNPJ é o cadastro de outro: fica sem cadastro ligado, não migra e o log avisa
    orfao = _externo(c, adm, "Sem Cadastro Ligado")["id"]
    with SessaoControle() as db:
        o = db.get(Cliente, orfao)
        o.documento, o.tomador_id = "33000167000101", None
        db.commit()
    r6 = _recorrencia_antiga(orfao, descricao="Backup")

    with caplog.at_level("WARNING"):
        feito = faturamento_admin.preparar()
    assert len(feito["regras"]) == 3
    assert "Backup" in caplog.text and "NÃO foi migrada" in caplog.text
    assert faturamento_admin.preparar()["regras"] == []  # rodar de novo (todo deploy) não cria outra

    regras = {r["descricao"]: r for r in _regras(c, adm, tid)}
    assert set(regras) == {"Geração de Documentos", "Suporte", "Domínio"}
    g, s, d = regras["Geração de Documentos"], regras["Suporte"], regras["Domínio"]
    assert (g["tipo"], g["valor"], g["frequencia"], g["intervalo"], g["data_inicio"], g["termino"], g["ativo"], g["caso_id"]) == (
        "recorrente", "200.00", "mensal", 1, "2026-12-05", "sem", True, None)
    assert "cobrança recorrente nº" in g["observacao"] and "Combinado com a Dra. Ana" in g["observacao"]
    assert (s["frequencia"], s["intervalo"], s["data_inicio"], s["termino"], s["ocorrencias"]) == (
        "mensal", 3, "2027-07-10", "ocorrencias", 3)
    assert (d["frequencia"], d["intervalo"], d["data_inicio"], d["termino"], d["data_fim"], d["ativo"]) == (
        "anual", 1, "2027-02-28", "data", "2029-12-31", False)

    with SessaoControle() as db:
        situacao = {r.id: (r.status, r.regra_id) for r in db.scalars(select(CobrancaRecorrente))}
        assert situacao[r1] == ("migrada", g["id"]) and situacao[r2] == ("migrada", s["id"]) and situacao[r3] == ("migrada", d["id"])
        assert situacao[r4] == ("encerrada", None) and situacao[r5] == ("concluida", None) and situacao[r6] == ("ativa", None)
        assert "regra de cobrança nº" in db.get(CobrancaRecorrente, r1).observacao
        antes = db.scalar(select(Cobranca.id).order_by(Cobranca.id.desc()))

    # aparece em Itens a faturar no mês certo, sem repetir o que o motor antigo já tinha cobrado
    assert [(i["descricao"], i["data"], i["valor"]) for i in _itens(c, adm, tid, "2026-12-01", "2026-12-31")] == [
        ("Geração de Documentos — parcela 1", "2026-12-05", "200.00")]
    de_2027 = [(i["descricao"], i["data"]) for i in _itens(c, adm, tid, "2027-01-01", "2027-12-31")]
    assert [x for x in de_2027 if x[0].startswith("Suporte")] == [("Suporte — parcela 1/3", "2027-07-10"),
                                                                  ("Suporte — parcela 2/3", "2027-10-10")]
    assert not [x for x in de_2027 if x[0].startswith("Domínio")]  # pausada

    # o motor antigo não gera mais nada, em dia nenhum; a cobrança que ele já tinha gerado continua na régua e recebe baixa
    for dia in (date(2026, 12, 2), date(2026, 12, 5), date(2027, 7, 8), date(2028, 1, 10)):
        feitos = cobranca.rotina_diaria(dia)
        assert "recorrentes" not in feitos and feitos["geradas"] == 0
    with SessaoControle() as db:
        assert db.scalar(select(Cobranca.id).order_by(Cobranca.id.desc())) == antes
        assert db.get(Cobranca, k_abril).avisos  # a régua passou por ela
    assert [k["id"] for k in _cobrancas(c, adm, cid, tipo="recorrente")] == [k_abril]
    assert c.post(f"/api/admin/cobrancas/{k_abril}/baixa", headers=adm, json={"forma": "pix"}).status_code == 200
    # as rotas do motor antigo saíram, e a receita recorrente do resumo é só a dos planos
    assert c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).status_code == 404
    assert c.post(f"/api/admin/clientes/{cid}/recorrencias", headers=adm, json={}).status_code == 404
    assert c.post(f"/api/admin/recorrencias/{r6}/gerar", headers=adm).status_code == 404
    resumo = c.get("/api/admin/cobrancas/resumo", headers=adm).json()
    assert "receita_recorrencias" not in resumo and resumo["receita_recorrente"] == resumo["receita_planos"]

    # cliente inativo não é cobrado: some de Itens a faturar e volta ao ser reativado; excluído, some de vez
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "inativo"})
    assert _itens(c, adm, tid, "2026-12-01", "2026-12-31") == []
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "ativo"})
    assert len(_itens(c, adm, tid, "2026-12-01", "2026-12-31")) == 1
    assert c.delete(f"/api/admin/clientes/{cid}", headers=adm, params={"confirmar": vida["slug"]}).status_code == 200
    assert _itens(c, adm, tid, "2026-12-01", "2027-12-31") == []
    with SessaoControle() as db:  # a recorrência órfã não fica para o próximo teste
        db.delete(db.get(CobrancaRecorrente, r6))
        db.commit()


def test_regra_do_cliente_vira_fatura_e_nota(painel, mp):
    """O caminho novo, inteiro: regra recorrente no cliente do admin (sem caso) → Itens a faturar → fatura para o
    cadastro completo → NFS-e pelo lote das faturas, com o texto da regra e sem "Honorários advocatícios"."""
    from app.controle import faturamento_admin

    c = painel
    adm = _entrar(c)
    faturamento_admin.preparar()
    _emissora(c, adm)
    novo = _externo(c, adm, None, cadastro={
        "tipo": "PJ", "nome": "Cartório Central", "cpf_cnpj": "11.222.333/0001-81", "emails": ["fin@cartoriocentral.com.br"],
        "cep": "18035-000", "logradouro": "Rua do Cartório", "numero": "50", "bairro": "Centro", "cidade": "Sorocaba",
        "uf": "SP", "telefones": [{"numero": "(15) 3222-2000", "tipo": "comercial"}], "contatos": [{"nome": "Caio Central"}]})
    tid = novo["tomador_id"]
    assert novo["cadastro"]["completo"] is True and tid

    # a ficha do admin usa as mesmas rotas da aba Cobrança dos escritórios: o contrato único nasce por trás
    assert c.get(f"/api/faturamento/clientes/{tid}/contrato", headers=adm).json() is None
    k = c.post(f"/api/faturamento/clientes/{tid}/contrato", headers=adm, json={})
    assert k.status_code == 200 and k.json()["tomador_id"] == tid, k.text
    r = c.post(f"/api/faturamento/contratos/{k.json()['id']}/regras", headers=adm, json={
        "tipo": "recorrente", "descricao": "Geração de Documentos", "valor": "200.00", "frequencia": "mensal",
        "intervalo": 1, "data_inicio": "2026-12-05"})
    assert r.status_code == 201 and r.json()["caso_id"] is None, r.text

    periodo = {"de": "2026-12-01", "ate": "2026-12-31"}
    assert _itens(c, adm, tid, "2026-11-01", "2026-11-30") == []
    (item,) = _itens(c, adm, tid, **periodo)
    assert (item["tipo"], item["descricao"], item["data"], item["valor"], item["caso_id"], item["aviso"]) == (
        "recorrente", "Geração de Documentos — parcela 1", "2026-12-05", "200.00", None, None)
    r = c.post("/api/faturamento/faturar", headers=adm, json={"aba": "honorarios", **periodo, "cliente_ids": [tid],
                                                             "chaves": [item["chave"]]})
    assert r.status_code == 200, r.text
    (nh,) = r.json()["faturas"]
    assert nh["tomador_nome"] == "Cartório Central" and nh["valor"] == "200.00"
    assert _itens(c, adm, tid, **periodo) == []  # faturado: não aparece de novo
    fat = c.get(f"/api/nfse/faturas/{nh['id']}", headers=adm).json()
    assert fat["tomador_id"] == tid and fat["pode_emitir_nfse"] and fat["nfse_id"] is None
    assert fat["descricao"] == "Serviços prestados\n- Geração de Documentos — parcela 1"

    r = c.post("/api/faturamento/emitir-nfse", headers=adm, json={"fatura_ids": [nh["id"]]})
    assert r.status_code == 200, r.text
    lote_id = r.json()["lote_id"]
    r = c.post(f"/api/nfse/importacoes/{lote_id}/emitir", headers=adm)
    assert r.status_code == 200, r.text
    fat = c.get(f"/api/nfse/faturas/{nh['id']}", headers=adm).json()
    assert fat["nfse_id"] and not fat["pode_emitir_nfse"], fat
    nota = c.get(f"/api/nfse/notas/{fat['nfse_id']}", headers=adm).json()
    assert nota["tomador_id"] == tid and nota["tomador_doc"] == "11222333000181" and nota["valor"] == "200.00"
    assert "Geracao de Documentos" in nota["discriminacao"] or "Geração de Documentos" in nota["discriminacao"], nota["discriminacao"]
    assert "Honor" not in nota["discriminacao"] and "ontrato" not in nota["discriminacao"]
    # nos escritórios o texto padrão continua o de sempre
    from app.core.db import SessionLocal
    from app.modules.faturamento import service as fat_service

    with tenancy.usando(tenancy.Escritorio(slug="cfme", banco=None)), SessionLocal() as db:
        assert fat_service.texto_servico(db, 1) == "Honorários advocatícios"


def test_recorrente_paga_da_baixa_e_emite_nota(painel, mp, monkeypatch):
    """Histórico: a cobrança "recorrente" que o motor antigo já tinha gerado continua recebendo a baixa do Mercado
    Pago (e a manual), e a NFS-e dela sai pelo caminho de sempre."""
    from app.controle import nota_fiscal

    monkeypatch.setattr(nota_fiscal, "EM_SEGUNDO_PLANO", False)
    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    emissora_id = _emissora(c, adm)
    cfg = c.get("/api/admin/cobranca/config", headers=adm).json()
    r = c.put("/api/admin/cobranca/config", headers=adm, json={
        "dia_vencimento": cfg["dia_vencimento"], "gerar_automatico": True, "regua": cfg["regua"], "nfse_automatica": True,
        "nfse_emissora_id": emissora_id, "nfse_descricao": "Licença MayaJus - {descricao}"})
    assert r.status_code == 200, r.text

    # cliente novo já com o cadastro completo (o mesmo formulário de Cadastros › Clientes): é ele que vai na nota
    novo = _externo(c, adm, None, cadastro={
        "tipo": "PJ", "nome": "Escola Saber", "cpf_cnpj": "60.746.948/0001-12", "emails": ["Fin@EscolaSaber.com.br"],
        "cep": "18035-000", "logradouro": "Rua da Escola", "numero": "10", "bairro": "Centro", "cidade": "Sorocaba",
        "uf": "SP", "telefones": [{"numero": "(15) 3222-1000", "tipo": "comercial"}],
        "contatos": [{"nome": "Sara Saber", "cargo": "Financeiro"}]})
    cid = novo["id"]
    assert (novo["nome"], novo["documento"], novo["email_financeiro"], novo["telefone"], novo["responsavel"]) == (
        "Escola Saber", "60746948000112", "fin@escolasaber.com.br", "(15) 3222-1000", "Sara Saber")
    assert novo["cadastro"]["completo"] is True and novo["tomador_id"]
    rid = _recorrencia_antiga(cid, descricao="Portal do aluno", valor=Decimal("480.00"), status="migrada", geradas=2,
                              proxima_competencia=date(2027, 3, 1))
    _cobranca_antiga(cid, rid, "2027-01", "Portal do aluno 01/2027", "480.00")
    (k,) = _cobrancas(c, adm, cid)
    mp["ref"] = f"cob:{k['id']}"
    assert c.post("/api/public/mercadopago", json={"type": "payment", "data": {"id": "901"}}).status_code == 200
    (k,) = _cobrancas(c, adm, cid)
    assert k["status"] == "paga" and k["forma_paga"] == "Pix" and k["nfse_status"] == "emitida", k
    nota = c.get(f"/api/nfse/notas/{k['nfse_id']}", headers=adm).json()
    # a nota leva a descrição do serviço, não o texto da licença do MayaJus
    assert nota["tomador_doc"] == "60746948000112" and nota["valor"] == "480.00"
    assert nota["tomador_id"] == novo["tomador_id"]
    assert "Portal do aluno 01/2027" in nota["discriminacao"] and "MayaJus" not in nota["discriminacao"]
    assert mp["emails"][-1][1] == "MayaCorp — pagamento recebido (Portal do aluno 01/2027)"
    # baixa manual também vale, e paga não entra mais na régua
    k2 = _cobranca_antiga(cid, rid, "2027-02", "Portal do aluno 02/2027", "480.00")
    assert c.post(f"/api/admin/cobrancas/{k2}/baixa", headers=adm, json={"forma": "pix"}).status_code == 200
    assert {x["status"] for x in _cobrancas(c, adm, cid)} == {"paga"}
    c.put("/api/admin/cobranca/config", headers=adm, json={"dia_vencimento": 10, "gerar_automatico": True,
                                                           "regua": cfg["regua"], "nfse_automatica": False})


def test_dar_e_tirar_o_acesso_ao_sistema(painel, mp, monkeypatch):
    from app.controle import service
    from app.controle.models import Cliente, SessaoControle

    monkeypatch.setattr(service, "enviar_email", lambda *a, **kw: None)  # boas-vindas
    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    ext = _externo(c, adm, "Lima Contabilidade", email_financeiro="fin@limacont.com.br")
    cid, slug = ext["id"], ext["slug"]
    tid = ext["tomador_id"]
    k = c.post(f"/api/faturamento/clientes/{tid}/contrato", headers=adm, json={}).json()
    assert c.post(f"/api/faturamento/contratos/{k['id']}/regras", headers=adm, json={
        "tipo": "recorrente", "descricao": "E-mail corporativo", "valor": "60.00", "frequencia": "mensal",
        "data_inicio": "2027-01-10"}).status_code == 201
    solo = next(p for p in c.get("/api/admin/planos", headers=adm).json() if p["nome"] == "Solo")

    # externo → escritório: ganha o ambiente pelo caminho do cadastro normal, com plano, teste e boas-vindas
    assert c.post(f"/api/admin/clientes/{cid}/dar-acesso", headers=adm,
                  json={"admin_email": "admin@cfme.com.br", "plano_id": solo["id"]}).status_code == 400  # e-mail de outro
    r = c.post(f"/api/admin/clientes/{cid}/dar-acesso", headers=adm, json={
        "admin_nome": "Lia Lima", "admin_email": "lia@limacont.com.br", "plano_id": solo["id"], "ciclo": "mensal",
        "dias_teste": 15, "dominios": ["app.limacont.com.br"]})
    assert r.status_code == 200, r.text
    novo = r.json()
    assert novo["tipo"] == "escritorio" and novo["status"] == "teste" and novo["plano"]["nome"] == "Solo"
    assert novo["dominios"][0]["host"] == "app.limacont.com.br" and novo["boas_vindas_para"] == "lia@limacont.com.br"
    assert novo["email_financeiro"] == "fin@limacont.com.br" and novo["ambiente_de_antes"] is False
    assert _arquivo_do_banco(slug).exists()
    tk = novo["convite"].split("token=")[1]
    r = c.post("/api/auth/primeiro-acesso", json={"token": tk, "nome": "Lia Lima", "email": "lia@limacont.com.br",
                                                  "senha": "Lia@2026xx"})
    assert r.status_code == 200, r.text
    lia = _entrar(c, "lia@limacont.com.br", "Lia@2026xx")
    assert c.get("/api/auth/me", headers=lia).json()["nome"] == "Lia Lima"
    assert {u["email"] for u in c.get(f"/api/admin/clientes/{cid}/usuarios", headers=adm).json()} == {
        "lia@limacont.com.br", f"suporte+{slug}@mayacorp.com.br"}
    assert c.get(f"/api/admin/clientes/{cid}/uso", headers=adm).json()["usuarios"] == 1
    # a 1ª mensalidade do plano nasce (vence no fim do teste) e a regra de cobrança continua sendo dele
    assert [(k["tipo"], k["valor"]) for k in _cobrancas(c, adm, cid)] == [("mensalidade", "119.00")]
    assert [i["descricao"] for i in _itens(c, adm, tid, "2027-01-01", "2027-01-31")] == ["E-mail corporativo — parcela 1"]
    assert c.post(f"/api/admin/clientes/{cid}/dar-acesso", headers=adm, json={}).status_code == 400  # já tem

    # escritório → externo: ninguém entra, a mensalidade para, o cartão é cancelado no Mercado Pago e nada é apagado
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "ativo"})
    with SessaoControle() as db:
        reg = db.get(Cliente, cid)
        reg.forma_pagamento, reg.mp_assinatura_id, reg.mp_assinatura_status = "cartao", "pre-9", "authorized"
        db.commit()
    r = c.post(f"/api/admin/clientes/{cid}/tirar-acesso", headers=adm)
    assert r.status_code == 200, r.text
    fora = r.json()
    assert fora["tipo"] == "externo" and fora["status"] == "ativo" and fora["ambiente_guardado"] is True
    assert fora["plano"] is None and fora["valor"] is None and fora["dominios"] == []  # some da conta dos planos
    assert c.get("/api/admin/resumo", headers=adm).json()["mrr"] == "0.00"
    assert mp["assinatura"] == ("PUT", {"status": "cancelled"})
    assert c.get(f"/api/admin/clientes/{cid}/pagamento", headers=adm).json() == {
        "forma_pagamento": "link", "assinatura_id": "pre-9", "assinatura_status": "cancelled"}
    assert c.get("/api/auth/me", headers=lia).status_code == 401
    assert c.post("/api/auth/login", json={"email": "lia@limacont.com.br", "senha": "Lia@2026xx"}).status_code == 401
    assert c.get("/api/public/identidade", headers={"Host": "app.limacont.com.br"}).json()["nome_exibicao"] == "MayaJus"
    assert slug not in service.migrar_todos()
    assert "Lima Contabilidade" not in c.post("/api/admin/cobrancas/gerar", headers=adm,
                                              json={"competencia": "2027-03", "enviar": False}).json()["criadas"]
    assert _arquivo_do_banco(slug).exists()  # o banco fica guardado
    # sem acesso, o serviço dele segue em Itens a faturar
    assert [i["descricao"] for i in _itens(c, adm, tid, "2027-01-01", "2027-01-31")] == ["E-mail corporativo — parcela 1"]
    # o escritório do banco principal não pode perder o acesso
    cfme = next(x for x in c.get("/api/admin/clientes", headers=adm).json() if x["slug"] == "cfme")
    assert c.post(f"/api/admin/clientes/{cfme['id']}/tirar-acesso", headers=adm).status_code == 400
    assert _login(c)

    # devolver o acesso: o ambiente de antes volta, com os mesmos usuários e senhas
    r = c.post(f"/api/admin/clientes/{cid}/dar-acesso", headers=adm, json={"plano_id": solo["id"]})
    assert r.status_code == 200 and r.json()["tipo"] == "escritorio" and r.json()["ambiente_de_antes"] is True, r.text
    assert r.json()["status"] == "ativo" and r.json()["boas_vindas_para"] is None
    lia = _entrar(c, "lia@limacont.com.br", "Lia@2026xx")
    assert c.get("/api/auth/me", headers=lia).json()["nome"] == "Lia Lima"
