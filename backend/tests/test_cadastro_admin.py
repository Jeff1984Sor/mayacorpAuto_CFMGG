"""Admin MayaCorp: o cadastro completo do cliente (o Tomador do banco do admin) é a fonte única da ficha fiscal."""

import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.core import tenancy
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)

ADM = ("cad@mayacorp.com.br", "Maya@2026xx")
ENDERECO = {"cep": "18035000", "logradouro": "Rua das Flores", "numero": "50", "bairro": "Centro", "cidade": "Sorocaba",
            "uf": "SP"}


@pytest.fixture(scope="module")
def painel(cliente):  # noqa: F811
    """Controle próprio deste arquivo: a CFME no banco principal e o admin MayaCorp num banco só dele."""
    from app.controle import models, service

    pasta = Path(tempfile.mkdtemp(prefix="mayajus-controle-cad-"))
    tenancy.forcar_controle(f"sqlite:///{(pasta / 'controle.db').as_posix()}")
    models._fabrica = None
    service.limpar_cache()
    service.migrar_controle()
    assert service.registrar_principal_se_faltar() == "cfme"
    service.provisionar("mccad", "MayaCorp", admin_nome="Jefferson", admin_email=ADM[0], dominios=["admin.cad.test"],
                        tipo="mayacorp", admin_login="cadadm", admin_senha=ADM[1])
    yield cliente
    tenancy.forcar_controle(None)
    models._fabrica = None
    service.limpar_cache()


@pytest.fixture
def adm(painel):
    r = painel.post("/api/auth/login", json={"email": ADM[0], "senha": ADM[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def _admin_db():
    """Sessão no banco do admin, como a rotina do deploy abre."""
    from contextlib import contextmanager

    from app.controle import service
    from app.core.db import SessionLocal

    @contextmanager
    def abrir():
        with tenancy.usando(service.escritorio_mayacorp()), SessionLocal() as db:
            yield db

    return abrir()


def _tomadores(c, adm, q):
    r = c.get("/api/nfse/tomadores", headers=adm, params={"q": q, "situacao": "todos"}).json()
    return r["itens"]


def _total_de_tomadores() -> int:
    from app.modules.rpa_nfse.models import Tomador

    with _admin_db() as db:
        return db.scalar(select(func.count(Tomador.id)))


def test_clientes_antigos_sao_ligados_no_deploy_sem_duplicar(painel, adm):
    """Como em produção antes desta versão: clientes no controle sem `tomador_id` e, no banco do admin, o cadastro
    espelhado de alguns (um deles já com endereço preenchido em Cadastros › Clientes). O migrar do deploy liga tudo."""
    from app.controle import cadastro, service
    from app.controle.models import Cliente, SessaoControle
    from app.core.models import Tenant
    from app.modules.rpa_nfse.models import Tomador

    c = painel
    with _admin_db() as db:
        tenant_id = db.scalar(select(Tenant.id))
        # espelhado pelo sistema antigo, e depois completado na tela de Cadastros (endereço e um e-mail a mais)
        db.add(Tomador(tenant_id=tenant_id, tipo="PJ", nome="Alfa Advogados", cpf_cnpj="11444777000161",
                       emails=["nota@alfa.adv.br", "fin@alfa.adv.br"], telefone="1133334444", enderecos=[], telefones=[],
                       contatos=[{"nome": "Bia Alfa", "email": None, "telefone": None, "celular": None, "cargo": None,
                                  "whatsapp": False}], **ENDERECO))
        # espelhado sem documento: só o nome liga
        db.add(Tomador(tenant_id=tenant_id, tipo="PJ", nome="Beta Sem Documento", emails=[], enderecos=[], contatos=[],
                       telefones=[]))
        db.commit()
    with SessaoControle() as ctl:
        ctl.add_all([
            Cliente(slug="alfa", nome="Alfa Advogados", banco=None, tipo="externo", documento="11444777000161",
                    email_financeiro="fin@alfa.adv.br", telefone="(11) 98888-7777", responsavel="Ana Alfa"),
            Cliente(slug="beta", nome="Beta Sem Documento", banco=None, tipo="externo", email_financeiro="b@beta.com.br"),
            Cliente(slug="gama", nome="Gama Nunca Espelhado", banco=None, tipo="externo", documento="33000167000101"),
        ])
        ctl.commit()
    antes = _total_de_tomadores()

    service.migrar_todos()
    assert _total_de_tomadores() == antes + 2  # só quem não tinha cadastro ganha um: o Gama e a CFME
    with SessaoControle() as ctl:
        por_slug = {x.slug: x for x in ctl.scalars(select(Cliente))}
        alfa, beta, gama, cfme = por_slug["alfa"], por_slug["beta"], por_slug["gama"], por_slug["cfme"]
        assert all(x.tomador_id for x in (alfa, beta, gama))
        assert len({alfa.tomador_id, beta.tomador_id, gama.tomador_id}) == 3
        # nada do que a ficha tinha se perde: o e-mail do financeiro continua sendo o do controle (vai para a frente)
        assert (alfa.nome, alfa.documento, alfa.email_financeiro, alfa.responsavel, alfa.telefone) == (
            "Alfa Advogados", "11444777000161", "fin@alfa.adv.br", "Ana Alfa", "(11) 98888-7777")
        assert beta.email_financeiro == "b@beta.com.br" and gama.documento == "33000167000101"
        ids = {"alfa": alfa.tomador_id, "beta": beta.tomador_id, "gama": gama.tomador_id, "cfme": cfme.tomador_id}
    with _admin_db() as db:
        t = db.get(Tomador, ids["alfa"])
        # nem do que o cadastro tinha: endereço, o outro e-mail, o outro telefone e a outra pessoa continuam lá
        assert (t.cep, t.logradouro, t.cidade) == ("18035000", "Rua das Flores", "Sorocaba")
        assert t.emails == ["fin@alfa.adv.br", "nota@alfa.adv.br"]
        assert [x["numero"] for x in t.telefones] == ["11988887777", "1133334444"] and t.telefone == "11988887777"
        assert [(p["nome"], p["principal"]) for p in t.contatos] == [("Bia Alfa", False), ("Ana Alfa", True)]
        assert db.get(Tomador, ids["beta"]).emails == ["b@beta.com.br"]
        assert db.get(Tomador, ids["gama"]).cpf_cnpj == "33000167000101"

    # idempotente: rodar de novo (outro deploy, ou a tela abrindo) não cria nem troca nada
    total = _total_de_tomadores()
    service.migrar_todos()
    assert cadastro.ligar_todos() >= 3
    lista = {x["slug"]: x for x in c.get("/api/admin/clientes", headers=adm).json()}
    assert _total_de_tomadores() == total
    assert {k: lista[k]["tomador_id"] for k in ("alfa", "beta", "gama")} == {k: ids[k] for k in ("alfa", "beta", "gama")}
    # a lista diz o que falta para a nota de cada um
    assert lista["alfa"]["cadastro"] == {"tomador_id": ids["alfa"], "completo": True, "conflito": None, "pendencias": []}
    assert lista["beta"]["cadastro"]["pendencias"] == ["CNPJ/CPF", "CEP", "logradouro", "cidade", "UF"]
    assert lista["gama"]["cadastro"]["pendencias"] == ["CEP", "logradouro", "cidade", "UF", "e-mail"]


def test_cliente_novo_com_o_cadastro_completo(painel, adm):
    from app.controle.models import Cliente, SessaoControle

    c = painel
    cad = {"tipo": "PJ", "nome": "Delta Engenharia Ltda", "cpf_cnpj": "60.746.948/0001-12", "im": "12345",
           "emails": ["Financeiro@Delta.com.br", "nota@delta.com.br"], **ENDERECO,
           "enderecos": [{"tipo": "cobranca", "cep": "01310-100", "logradouro": "Avenida Paulista", "numero": "1000",
                          "cidade": "São Paulo", "uf": "SP"}],
           "telefones": [{"numero": "(15) 99777-6655", "tipo": "celular"}],
           "contatos": [{"nome": "Davi Delta", "cargo": "Sócio"}, {"nome": "Dora Delta", "principal": True}]}
    # as validações são as mesmas de Cadastros › Clientes
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"cadastro": {**cad, "cpf_cnpj": "60746948000199"}})
    assert r.status_code == 400 and "CPF/CNPJ inválido" in r.json()["detail"]
    assert c.post("/api/admin/clientes/externo", headers=adm, json={}).status_code == 400  # sem nome nem cadastro

    r = c.post("/api/admin/clientes/externo", headers=adm, json={"cadastro": cad, "observacao": "Indicado pelo site"})
    assert r.status_code == 201, r.text
    novo = r.json()
    # a ficha do controle é a cópia do cadastro: 1º e-mail = financeiro, 1º telefone, contato principal = responsável
    assert (novo["nome"], novo["documento"], novo["email_financeiro"], novo["telefone"], novo["responsavel"]) == (
        "Delta Engenharia Ltda", "60746948000112", "financeiro@delta.com.br", "(15) 99777-6655", "Dora Delta")
    assert novo["observacao"] == "Indicado pelo site" and novo["cadastro"]["completo"] is True
    (t,) = _tomadores(c, adm, "Delta")
    assert t["id"] == novo["tomador_id"] and t["im"] == "12345" and t["cidade"] == "Sorocaba"
    assert t["enderecos"][0]["logradouro"] == "Avenida Paulista" and len(t["contatos"]) == 2

    # outro cliente com o mesmo CNPJ: recusa antes de criar qualquer coisa
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"cadastro": {**cad, "nome": "Delta de novo"}})
    assert r.status_code == 409 and "Delta Engenharia Ltda" in r.json()["detail"]
    with SessaoControle() as ctl:
        assert ctl.scalar(select(func.count(Cliente.id)).where(Cliente.documento == "60746948000112")) == 1
    # pela ficha curta (rotas antigas) o cliente nasce, mas sem cadastro ligado e com o motivo à vista
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"nome": "Delta Filial", "documento": "60746948000112"})
    assert r.status_code == 201 and r.json()["tomador_id"] is None
    assert "mesmo do cliente Delta Engenharia Ltda" in r.json()["cadastro"]["conflito"]
    assert len(_tomadores(c, adm, "60746948000112")) == 1
    # corrigido o documento, liga sozinho
    r = c.put(f"/api/admin/clientes/{r.json()['id']}", headers=adm, json={"documento": "45.997.418/0001-53"})
    assert r.status_code == 200 and r.json()["tomador_id"] and r.json()["cadastro"]["conflito"] is None, r.text

    # CNPJ que já está em Cadastros › Clientes (sem ser de nenhum cliente do admin): usa aquele cadastro, sem duplicar
    r = c.post("/api/nfse/tomadores", headers=adm, json={"tipo": "PJ", "nome": "Epsilon (cadastro antigo)",
                                                         "cpf_cnpj": "19131243000197", "observacoes": "Cliente desde 2020"})
    assert r.status_code == 200, r.text
    antigo = r.json()["id"]
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"cadastro": {
        "tipo": "PJ", "nome": "Epsilon Comércio", "cpf_cnpj": "19131243000197", "emails": ["fin@epsilon.com.br"], **ENDERECO}})
    assert r.status_code == 201 and r.json()["tomador_id"] == antigo, r.text
    assert [t["nome"] for t in _tomadores(c, adm, "19131243000197")] == ["Epsilon Comércio"]


def test_edicao_pelos_dois_lados_da_no_mesmo_registro(painel, adm):
    c = painel
    r = c.post("/api/admin/clientes/externo", headers=adm, json={"cadastro": {
        "tipo": "PJ", "nome": "Zeta Serviços", "cpf_cnpj": "27865757000102", "emails": ["fin@zeta.com.br"]}})
    assert r.status_code == 201, r.text
    cid, tid = r.json()["id"], r.json()["tomador_id"]
    assert r.json()["cadastro"]["pendencias"] == ["CEP", "logradouro", "cidade", "UF"]

    # 1) pela tela Cadastros › Clientes do admin (PUT /nfse/tomadores): a ficha do admin acompanha
    atual = c.get(f"/api/nfse/tomadores/{tid}", headers=adm).json()
    r = c.put(f"/api/nfse/tomadores/{tid}", headers=adm, json={
        **atual, "nome": "Zeta Serviços Digitais Ltda", "emails": ["cobranca@zeta.com.br", "fin@zeta.com.br"], **ENDERECO,
        "telefones": [{"numero": "1532221000", "tipo": "fixo"}], "contatos": [{"nome": "Zeca Zeta"}]})
    assert r.status_code == 200, r.text
    from app.controle.models import Cliente, SessaoControle

    with SessaoControle() as ctl:  # direto no controle: é o que a cobrança, a régua e os contratos leem
        z = ctl.get(Cliente, cid)
        assert (z.nome, z.email_financeiro, z.telefone, z.responsavel) == (
            "Zeta Serviços Digitais Ltda", "cobranca@zeta.com.br", "(15) 3222-1000", "Zeca Zeta")
    ficha = c.get(f"/api/admin/clientes/{cid}", headers=adm).json()
    assert ficha["tomador_id"] == tid and ficha["cadastro"]["completo"] is True

    # 2) pela ficha do admin (ficha curta das rotas antigas): entra no mesmo cadastro, sem apagar o que ele tinha
    r = c.put(f"/api/admin/clientes/{cid}", headers=adm, json={
        "nome": "Zeta Digital", "email_financeiro": "Novo@Zeta.com.br", "responsavel": "Zilda Zeta", "observacao": "VIP"})
    assert r.status_code == 200, r.text
    assert (r.json()["nome"], r.json()["email_financeiro"], r.json()["responsavel"], r.json()["telefone"]) == (
        "Zeta Digital", "novo@zeta.com.br", "Zilda Zeta", "(15) 3222-1000")
    t = c.get(f"/api/nfse/tomadores/{tid}", headers=adm).json()
    assert t["nome"] == "Zeta Digital" and t["emails"] == ["novo@zeta.com.br", "cobranca@zeta.com.br", "fin@zeta.com.br"]
    assert [(p["nome"], p["principal"]) for p in t["contatos"]] == [("Zeca Zeta", False), ("Zilda Zeta", True)]
    assert t["cep"] == "18035000" and len(_tomadores(c, adm, "27865757000102")) == 1
    # só o comercial: o cadastro não é tocado
    r = c.put(f"/api/admin/clientes/{cid}", headers=adm, json={"observacao": "Só comercial"})
    assert r.status_code == 200 and r.json()["nome"] == "Zeta Digital" and r.json()["observacao"] == "Só comercial"
    assert c.get(f"/api/nfse/tomadores/{tid}", headers=adm).json()["emails"][0] == "novo@zeta.com.br"

    # o cadastro de um cliente do admin não é excluído por Cadastros › Clientes
    r = c.delete(f"/api/nfse/tomadores/{tid}", headers=adm)
    assert r.status_code == 409 and "Zeta Digital" in r.json()["detail"]
    # mudou por outro caminho (importação, robô): a próxima leitura do admin acerta a cópia
    from app.modules.rpa_nfse.models import Tomador

    with _admin_db() as db:
        db.get(Tomador, tid).nome = "Zeta Importada"
        db.commit()
    assert c.get(f"/api/admin/clientes/{cid}", headers=adm).json()["nome"] == "Zeta Importada"
    with SessaoControle() as ctl:
        assert ctl.get(Cliente, cid).nome == "Zeta Importada"


def test_escritorio_novo_com_cadastro_e_nota_bloqueada_ate_completar(painel, adm, monkeypatch):
    from app.controle import nota_fiscal
    from app.controle.models import Cobranca, SessaoControle

    monkeypatch.setattr(nota_fiscal, "EM_SEGUNDO_PLANO", False)
    monkeypatch.setattr("app.controle.service.enviar_email", lambda *a, **kw: None)
    c = painel
    r = c.post("/api/nfse/emissoras", headers=adm, json={
        "razao_social": "MayaCorp MEI", "cnpj": "37552605000103", "ccm": "", "sistema_emissao": "nacional", "regime": "mei",
        "cep": "18035000", "cidade": "Sorocaba", "uf": "SP", "codigo_municipio": "3552205", "cod_trib_nacional": "010101",
        "serie_rps": "3", "prox_rps": 1, "aliquota_iss": "0.02"})
    assert r.status_code == 200, r.text
    cfg = c.get("/api/admin/cobranca/config", headers=adm).json()
    r = c.put("/api/admin/cobranca/config", headers=adm, json={
        "dia_vencimento": cfg["dia_vencimento"], "gerar_automatico": False, "regua": cfg["regua"], "nfse_automatica": True,
        "nfse_emissora_id": r.json()["id"], "nfse_descricao": "Licença MayaJus - {descricao}"})
    assert r.status_code == 200, r.text

    # escritório (usa o MayaJus) com o cadastro sem endereço e sem e-mail: o das boas-vindas vira o do financeiro
    r = c.post("/api/admin/clientes", headers=adm, json={
        "cadastro": {"tipo": "PJ", "nome": "Teta Advogados Associados", "cpf_cnpj": "04252011000110"},
        "slug": "teta-adv", "admin_nome": "Tais", "admin_email": "Tais@Teta.adv.br", "dias_teste": 15})
    assert r.status_code == 201, r.text
    teta = r.json()
    assert teta["tipo"] == "escritorio" and teta["slug"] == "teta-adv" and "/primeiro-acesso?token=" in teta["convite"]
    assert teta["email_financeiro"] == "tais@teta.adv.br" and teta["documento"] == "04252011000110"
    assert teta["cadastro"]["pendencias"] == ["CEP", "logradouro", "cidade", "UF"]
    (t,) = _tomadores(c, adm, "Teta")
    assert t["id"] == teta["tomador_id"] and t["emails"] == ["tais@teta.adv.br"]

    with SessaoControle() as ctl:
        k = Cobranca(cliente_id=teta["id"], tipo="avulsa", descricao="Implantação", itens=[], valor=Decimal("300.00"),
                     vencimento=date.today(), status="pendente", avisos=[])
        ctl.add(k)
        ctl.commit()
        kid = k.id
    # paga com o cadastro incompleto: a baixa vale, a nota não vai ao governo e a cobrança diz o que falta
    assert c.post(f"/api/admin/cobrancas/{kid}/baixa", headers=adm, json={"forma": "pix"}).status_code == 200
    k = next(x for x in c.get("/api/admin/cobrancas", headers=adm).json() if x["id"] == kid)
    assert k["status"] == "paga" and k["nfse_status"] == "erro" and k["nfse_id"] is None, k
    assert k["nfse_erro"] == ("Cadastro de Teta Advogados Associados incompleto para emitir a nota: falta CEP, logradouro, "
                              "cidade e UF. Complete em Clientes › Teta Advogados Associados › Dados e emita de novo.")
    r = c.post(f"/api/admin/cobrancas/{kid}/nfse", headers=adm)  # "Emitir NFS-e" na tela de Cobranças
    assert r.status_code == 400 and "falta CEP, logradouro, cidade e UF" in r.json()["detail"]
    from app.modules.rpa_nfse.models import Rps

    with _admin_db() as db:
        assert db.scalar(select(func.count(Rps.id))) == 0  # nenhum RPS gasto com a tentativa

    # completou o cadastro (na ficha do admin ou em Cadastros › Clientes: é o mesmo PUT): a nota sai com o endereço
    atual = c.get(f"/api/nfse/tomadores/{teta['tomador_id']}", headers=adm).json()
    assert c.put(f"/api/nfse/tomadores/{teta['tomador_id']}", headers=adm, json={**atual, **ENDERECO}).status_code == 200
    r = c.post(f"/api/admin/cobrancas/{kid}/nfse", headers=adm)
    assert r.status_code == 200 and r.json()["nfse_status"] == "emitida" and r.json()["nfse_erro"] is None, r.text
    nota = c.get(f"/api/nfse/notas/{r.json()['nfse_id']}", headers=adm).json()
    assert nota["tomador_id"] == teta["tomador_id"] and nota["tomador_doc"] == "04252011000110"
    with _admin_db() as db:
        tom = db.scalar(select(Rps)).dados_json["tomador"]
        assert (tom["cep"], tom["logradouro"], tom["cidade"], tom["uf"], tom["email"]) == (
            "18035000", "Rua das Flores", "Sorocaba", "SP", "tais@teta.adv.br")
