"""Admin MayaCorp: cliente sem acesso ao sistema (só cobrança) e cobranças recorrentes."""

import logging
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

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
    """As telas decidem "vencida", a prévia e o "gerar agora" pelo dia de hoje. Os testes usam datas de 2027: com o
    hoje fixo eles não mudam de resultado conforme o dia em que rodam."""
    monkeypatch.setattr("app.controle.routes_cobranca.date", _Hoje)
    monkeypatch.setattr("app.controle.routes_recorrencia.date", _Hoje)


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


def _recorrencia(c, adm, cid, **dados):
    corpo = {"descricao": "Hospedagem do site", "valor": "300.00", "periodicidade": "mensal", "dia_vencimento": 10,
             "inicio": "2027-01-01", "antecedencia": 5, **dados}
    r = c.post(f"/api/admin/clientes/{cid}/recorrencias", headers=adm, json=corpo)
    assert r.status_code == 201, r.text
    return r.json()


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


def test_recorrencia_gera_na_data_sem_duplicar(painel, mp):
    from app.controle import cobranca
    from app.controle.models import Cobranca, SessaoControle

    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    cid = _externo(c, adm, "Clínica Vida", documento="33000167000101", email_financeiro="fin@clinicavida.com.br")["id"]

    # prévia antes de salvar: as 3 próximas datas e valores
    corpo = {"cliente_id": cid, "descricao": "Hospedagem do site", "valor": "300.00", "periodicidade": "mensal",
             "dia_vencimento": 10, "inicio": "2027-01-15", "antecedencia": 5}
    p = c.post("/api/admin/recorrencias/previa", headers=adm, json=corpo).json()
    assert [(x["competencia"], x["vencimento"], x["valor"]) for x in p["proximas"]] == [
        ("2027-01", "2027-01-10", "300.00"), ("2027-02", "2027-02-10", "300.00"), ("2027-03", "2027-03-10", "300.00")]
    assert p["sem_email"] is False and p["termina"] is False
    assert c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json() == []  # a prévia não grava
    # sem informar a antecedência, vale o primeiro aviso da régua (3 dias antes)
    assert c.post("/api/admin/recorrencias/previa", headers=adm, json={**corpo, "antecedencia": None}).json()["antecedencia"] == 3
    # término que não deixa nascer nenhuma cobrança
    r = c.post("/api/admin/recorrencias/previa", headers=adm, json={**corpo, "termino_tipo": "data", "termino_data": "2027-01-05"})
    assert r.status_code == 400 and "nenhuma cobrança" in r.json()["detail"]

    rec = _recorrencia(c, adm, cid)
    rid = rec["id"]
    assert rec["status"] == "ativa" and rec["proximo_vencimento"] == "2027-01-10" and rec["geradas"] == 0
    assert rec["sem_email"] is False

    # antes da data nada sai; 5 dias antes do vencimento sai uma, com link e e-mail; rodar de novo no dia não duplica
    assert cobranca.rotina_diaria(date(2027, 1, 4))["recorrentes"] == 0
    mp["emails"].clear()
    assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] == 1
    assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] == 0
    (k,) = _cobrancas(c, adm, cid)
    assert (k["tipo"], k["competencia"], k["descricao"], k["valor"], k["vencimento"], k["status"]) == (
        "recorrente", "2027-01", "Hospedagem do site 01/2027", "300.00", "2027-01-10", "pendente")
    assert k["recorrencia_id"] == rid and k["link"] == f"https://mp.test/cob:{k['id']}" and k["envio_erro"] is None
    assert [(e[0], e[1]) for e in mp["emails"]] == [(["fin@clinicavida.com.br"], "MayaCorp — Hospedagem do site 01/2027: vence em 10/01/2027")]
    # depois segue a régua como qualquer cobrança (3 dias antes do vencimento)
    assert cobranca.rotina_diaria(date(2027, 1, 7))["avisos"] == 1
    with SessaoControle() as db:
        assert db.get(Cobranca, k["id"]).avisos == [-3]
    # o tipo aparece na tela geral e dá para filtrar
    assert [x["id"] for x in c.get("/api/admin/cobrancas", headers=adm, params={"tipo": "recorrente"}).json()] == [k["id"]]

    # reajuste vale só para as próximas: a de janeiro continua 300, a de fevereiro sai 350
    edicao = {"descricao": "Hospedagem do site", "valor": "350.00", "periodicidade": "mensal", "dia_vencimento": 10,
              "inicio": "2027-01-01", "antecedencia": 5}
    r = c.put(f"/api/admin/recorrencias/{rid}", headers=adm, json=edicao)
    assert r.status_code == 200 and r.json()["valor"] == "350.00" and r.json()["proxima_competencia"] == "2027-02", r.text
    # o início não muda depois que a primeira saiu
    assert c.put(f"/api/admin/recorrencias/{rid}", headers=adm, json={**edicao, "inicio": "2027-06-01"}).status_code == 400
    assert cobranca.rotina_diaria(date(2027, 2, 5))["recorrentes"] == 1
    assert sorted((x["competencia"], x["valor"]) for x in _cobrancas(c, adm, cid)) == [("2027-01", "300.00"), ("2027-02", "350.00")]

    # pausada não gera; retomada continua de onde parou, sem pular março
    assert c.post(f"/api/admin/recorrencias/{rid}/situacao", headers=adm, json={"acao": "pausar"}).json()["status"] == "pausada"
    assert cobranca.rotina_diaria(date(2027, 3, 5))["recorrentes"] == 0
    assert c.post(f"/api/admin/recorrencias/{rid}/gerar", headers=adm).status_code == 400  # pausada
    assert c.post(f"/api/admin/recorrencias/{rid}/situacao", headers=adm, json={"acao": "retomar"}).json()["status"] == "ativa"
    assert cobranca.rotina_diaria(date(2027, 3, 6))["recorrentes"] == 1
    assert sorted(x["competencia"] for x in _cobrancas(c, adm, cid)) == ["2027-01", "2027-02", "2027-03"]

    # um cliente pode ter várias: a anual, no último dia do mês, cai no mesmo mês de outra sem conflito
    anual = _recorrencia(c, adm, cid, descricao="Suporte anual", valor="1200.00", periodicidade="anual", dia_vencimento=0,
                         inicio="2027-03-01", antecedencia=10)
    assert anual["proximo_vencimento"] == "2027-03-31"
    assert cobranca.rotina_diaria(date(2027, 3, 21))["recorrentes"] == 1
    marco = [x for x in _cobrancas(c, adm, cid) if x["competencia"] == "2027-03"]
    assert sorted((x["descricao"], x["valor"], x["vencimento"]) for x in marco) == [
        ("Hospedagem do site 03/2027", "350.00", "2027-03-10"), ("Suporte anual 03/2027", "1200.00", "2027-03-31")]
    assert c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json()[0]["proximo_vencimento"] == "2028-03-31"

    # "Gerar a próxima agora" não espera a data e nunca repete a competência
    r = c.post(f"/api/admin/recorrencias/{rid}/gerar", headers=adm)
    assert r.status_code == 200 and r.json()["cobranca"]["competencia"] == "2027-04", r.text
    assert r.json()["recorrencia"]["geradas"] == 4 and r.json()["recorrencia"]["proxima_competencia"] == "2027-05"
    assert cobranca.rotina_diaria(date(2027, 4, 6))["recorrentes"] == 0  # abril já saiu
    # o banco não aceita duas da mesma recorrência no mesmo mês, e a regra das mensalidades continua valendo
    with SessaoControle() as db:
        db.add(Cobranca(cliente_id=cid, tipo="recorrente", recorrencia_id=rid, competencia="2027-04", descricao="x", itens=[],
                        valor=Decimal(1), vencimento=date(2027, 4, 10), status="pendente", avisos=[]))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        for _ in range(2):
            db.add(Cobranca(cliente_id=cid, tipo="mensalidade", competencia="2027-04", descricao="x", itens=[],
                            valor=Decimal(1), vencimento=date(2027, 4, 10), status="pendente", avisos=[]))
        with pytest.raises(IntegrityError):
            db.commit()

    # cliente inativo não é cobrado; encerrar não apaga o que já saiu
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "inativo"})
    assert cobranca.rotina_diaria(date(2027, 5, 6))["recorrentes"] == 0
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "ativo"})
    r = c.post(f"/api/admin/recorrencias/{rid}/situacao", headers=adm, json={"acao": "encerrar"})
    assert r.json()["status"] == "encerrada" and r.json()["proximo_vencimento"] is None
    assert cobranca.rotina_diaria(date(2027, 5, 7))["recorrentes"] == 0
    assert len([x for x in _cobrancas(c, adm, cid) if x["recorrencia_id"] == rid]) == 4
    assert c.delete(f"/api/admin/recorrencias/{rid}", headers=adm).status_code == 409  # já gerou: só encerra
    # receita recorrente mensal prevista: a anual de 1.200 vale 100 por mês (a encerrada não conta)
    assert c.get("/api/admin/cobrancas/resumo", headers=adm).json()["receita_recorrencias"] == "100.00"


def test_recorrencia_termino_e_atrasadas_com_teto(painel, mp):
    from app.controle import cobranca, recorrencia

    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    cid = _externo(c, adm, "Oficina do Zé", email_financeiro="ze@oficina.com.br")["id"]

    # N cobranças: sai a 2ª e a recorrência fica concluída
    duas = _recorrencia(c, adm, cid, descricao="Parcelas do sistema", termino_tipo="quantidade", termino_quantidade=2)
    assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] == 1
    assert cobranca.rotina_diaria(date(2027, 2, 5))["recorrentes"] == 1
    assert cobranca.rotina_diaria(date(2027, 3, 5))["recorrentes"] == 0
    lista = {x["id"]: x for x in c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json()}
    assert lista[duas["id"]]["status"] == "concluida" and lista[duas["id"]]["geradas"] == 2
    assert c.post(f"/api/admin/recorrencias/{duas['id']}/gerar", headers=adm).status_code == 400
    # até uma data: o vencimento de abril (10/04) passa do término (31/03)
    ate = _recorrencia(c, adm, cid, descricao="Manutenção", inicio="2027-03-01", termino_tipo="data", termino_data="2027-03-31")
    assert cobranca.rotina_diaria(date(2027, 3, 5))["recorrentes"] == 1
    assert cobranca.rotina_diaria(date(2027, 4, 5))["recorrentes"] == 0
    lista = {x["id"]: x for x in c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json()}
    assert lista[ate["id"]]["status"] == "concluida"
    # criada por engano, sem cobrança: dá para excluir
    engano = _recorrencia(c, adm, cid, descricao="Engano", inicio="2030-01-01")
    assert c.delete(f"/api/admin/recorrencias/{engano['id']}", headers=adm).status_code == 200

    # o sistema ficou parado: em 15/06 há 6 competências para trás (jan a jun). Saem em ordem, 3 por dia.
    velha = _recorrencia(c, adm, cid, descricao="Backup", valor="80.00", inicio="2027-01-01", antecedencia=3)
    p = c.post("/api/admin/recorrencias/previa", headers=adm, json={
        "cliente_id": cid, "descricao": "Backup", "valor": "80.00", "periodicidade": "mensal", "dia_vencimento": 10,
        "inicio": "2020-01-01", "antecedencia": 3}).json()
    assert p["saem_ja"] > 80 and p["por_dia"] == recorrencia.TETO_POR_DIA == 3  # a tela avisa antes de salvar
    mp["emails"].clear()
    assert cobranca.rotina_diaria(date(2027, 6, 15))["recorrentes"] == 3
    assert cobranca.rotina_diaria(date(2027, 6, 15))["recorrentes"] == 0  # o teto é por dia, mesmo rodando de novo
    feitas = sorted((x["competencia"], x["vencimento"]) for x in _cobrancas(c, adm, cid) if x["recorrencia_id"] == velha["id"])
    # a que nasce depois do vencimento ganha 5 dias para pagar (não nasce vencida)
    assert feitas == [("2027-01", "2027-06-20"), ("2027-02", "2027-06-20"), ("2027-03", "2027-06-20")]
    assert len([e for e in mp["emails"] if "Backup" in e[1]]) == 3 and all("vence em 20/06/2027" in e[1] for e in mp["emails"] if "Backup" in e[1])
    assert cobranca.rotina_diaria(date(2027, 6, 16))["recorrentes"] == 3
    assert cobranca.rotina_diaria(date(2027, 6, 17))["recorrentes"] == 0  # em dia: julho só sai em 07/07
    feitas = sorted((x["competencia"], x["vencimento"]) for x in _cobrancas(c, adm, cid) if x["recorrencia_id"] == velha["id"])
    assert [f[0] for f in feitas] == ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]
    assert feitas[-1] == ("2027-06", "2027-06-21")
    assert cobranca.rotina_diaria(date(2027, 7, 7))["recorrentes"] == 1


def test_recorrencia_de_cliente_sem_email(painel, mp, caplog):
    from app.controle import cobranca

    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    sem = _externo(c, adm, "Mercadinho Sem Email")
    cid = sem["id"]
    rec = _recorrencia(c, adm, cid, descricao="Site", valor="150.00")
    assert rec["sem_email"] is True  # a tela avisa ao criar
    mp["emails"].clear()
    with caplog.at_level(logging.WARNING):
        assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] == 1  # a cobrança nasce mesmo assim
        (k,) = _cobrancas(c, adm, cid)
        assert k["status"] == "pendente" and k["link"] and k["envio_erro"] == "falta o e-mail do financeiro"
        assert c.get("/api/admin/cobrancas/resumo", headers=adm).json()["nao_enviadas"] >= 1
        # os dias passam (régua: 3 antes, no dia, 3 depois) e nada de erro repetido no log
        for dia in (7, 8, 10, 13, 14):
            cobranca.rotina_diaria(date(2027, 1, dia))
    # só o que a cobrança registrou (outras partes do sistema rodam em paralelo nos testes e têm os próprios logs)
    da_cobranca = [r for r in caplog.records if r.name.startswith("app.controle")]
    assert not [r for r in da_cobranca if r.levelno >= logging.ERROR], caplog.text
    assert len([r for r in da_cobranca if "Mercadinho Sem Email" in r.getMessage()]) <= 1
    assert not [e for e in mp["emails"] if "Site 01/2027" in e[1]]
    # mandar pela tela explica o que falta
    r = c.post(f"/api/admin/cobrancas/{k['id']}/enviar", headers=adm)
    assert r.status_code == 400 and "e-mail do financeiro" in r.json()["detail"]
    # com o e-mail na ficha, a próxima rodada envia e tira a marca
    c.put(f"/api/admin/clientes/{cid}", headers=adm, json={
        "nome": sem["nome"], "documento": None, "responsavel": None, "email_financeiro": "dono@mercadinho.com.br",
        "telefone": None, "plano_id": None, "ciclo": "mensal", "inicio_contrato": None, "teste_ate": None,
        "observacao": None, "indicado_por_id": None})
    cobranca.rotina_diaria(date(2027, 1, 15))
    assert [e[0] for e in mp["emails"] if "Site 01/2027" in e[1]] == [["dono@mercadinho.com.br"]]
    (k,) = _cobrancas(c, adm, cid)
    assert k["envio_erro"] is None


def test_recorrente_paga_da_baixa_e_emite_nota(painel, mp, monkeypatch):
    """O aviso do Mercado Pago dá baixa na cobrança recorrente e a NFS-e sai pelo caminho de sempre."""
    from app.controle import cobranca, nota_fiscal

    monkeypatch.setattr(nota_fiscal, "EM_SEGUNDO_PLANO", False)
    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    r = c.post("/api/nfse/emissoras", headers=adm, json={
        "razao_social": "MayaCorp MEI", "cnpj": "37552605000103", "ccm": "", "sistema_emissao": "nacional", "regime": "mei",
        "cep": "18035000", "cidade": "Sorocaba", "uf": "SP", "codigo_municipio": "3552205", "cod_trib_nacional": "010101",
        "serie_rps": "2", "prox_rps": 1, "aliquota_iss": "0.02"})
    assert r.status_code == 200, r.text
    cfg = c.get("/api/admin/cobranca/config", headers=adm).json()
    r = c.put("/api/admin/cobranca/config", headers=adm, json={
        "dia_vencimento": cfg["dia_vencimento"], "gerar_automatico": True, "regua": cfg["regua"], "nfse_automatica": True,
        "nfse_emissora_id": r.json()["id"], "nfse_descricao": "Licença MayaJus - {descricao}"})
    assert r.status_code == 200, r.text

    cid = _externo(c, adm, "Escola Saber", documento="60746948000112", email_financeiro="fin@escolasaber.com.br")["id"]
    _recorrencia(c, adm, cid, descricao="Portal do aluno", valor="480.00")
    assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] == 1
    (k,) = _cobrancas(c, adm, cid)
    mp["ref"] = f"cob:{k['id']}"
    assert c.post("/api/public/mercadopago", json={"type": "payment", "data": {"id": "901"}}).status_code == 200
    (k,) = _cobrancas(c, adm, cid)
    assert k["status"] == "paga" and k["forma_paga"] == "Pix" and k["nfse_status"] == "emitida", k
    nota = c.get(f"/api/nfse/notas/{k['nfse_id']}", headers=adm).json()
    # a nota leva a descrição do serviço, não o texto da licença do MayaJus
    assert nota["tomador_doc"] == "60746948000112" and nota["valor"] == "480.00"
    assert "Portal do aluno 01/2027" in nota["discriminacao"] and "MayaJus" not in nota["discriminacao"]
    assert mp["emails"][-1][1] == "MayaCorp — pagamento recebido (Portal do aluno 01/2027)"
    # baixa manual também vale, e paga não entra mais na régua
    assert c.post(f"/api/admin/recorrencias/{c.get(f'/api/admin/clientes/{cid}/recorrencias', headers=adm).json()[0]['id']}/gerar",
                  headers=adm).status_code == 200
    k2 = next(x for x in _cobrancas(c, adm, cid) if x["competencia"] == "2027-02")
    assert c.post(f"/api/admin/cobrancas/{k2['id']}/baixa", headers=adm, json={"forma": "pix"}).status_code == 200
    rec = c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json()[0]
    assert (rec["geradas"], rec["pagas"], rec["em_aberto"]) == (2, 2, 0)
    c.put("/api/admin/cobranca/config", headers=adm, json={"dia_vencimento": 10, "gerar_automatico": True,
                                                           "regua": cfg["regua"], "nfse_automatica": False})


def test_dar_e_tirar_o_acesso_ao_sistema(painel, mp, monkeypatch):
    from app.controle import cobranca, service
    from app.controle.models import Cliente, SessaoControle

    monkeypatch.setattr(service, "enviar_email", lambda *a, **kw: None)  # boas-vindas
    c = painel
    adm = _entrar(c)
    _conectar_mp(c, adm)
    ext = _externo(c, adm, "Lima Contabilidade", email_financeiro="fin@limacont.com.br")
    cid, slug = ext["id"], ext["slug"]
    rid = _recorrencia(c, adm, cid, descricao="E-mail corporativo", valor="60.00")["id"]
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
    # a 1ª mensalidade do plano nasce (vence no fim do teste) e a recorrência continua sendo dele
    assert [(k["tipo"], k["valor"]) for k in _cobrancas(c, adm, cid)] == [("mensalidade", "119.00")]
    assert [x["id"] for x in c.get(f"/api/admin/clientes/{cid}/recorrencias", headers=adm).json()] == [rid]
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
    assert cobranca.rotina_diaria(date(2027, 1, 5))["recorrentes"] >= 1  # a recorrência segue cobrando
    assert "recorrente" in {k["tipo"] for k in _cobrancas(c, adm, cid)}
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
