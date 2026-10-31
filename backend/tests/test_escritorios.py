"""Um banco por escritório: a CFME no banco principal e um escritório novo no banco próprio, sem se enxergarem."""

import tempfile
from pathlib import Path

import pytest

from app.core import tenancy
from app.core.config import settings
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


@pytest.fixture(scope="module")
def multi(cliente):  # noqa: F811
    from app.controle import models, service

    pasta = Path(tempfile.mkdtemp(prefix="mayajus-controle-"))
    settings.controle_database_url = f"sqlite:///{(pasta / 'controle.db').as_posix()}"
    models._fabrica = None
    service.limpar_cache()
    service.migrar_controle()
    service.registrar("cfme", "CFME Advogados", banco=None)
    with tenancy.usando(service.por_slug("cfme")):
        service.sincronizar_todos("cfme")
    _, link = service.provisionar("silva", "Silva Advogados", admin_nome="Ana Silva", admin_email="ana@silva.adv.br",
                                  dias_teste=15, dominios=["sistema.silva.adv.br"])
    token = link.split("token=")[1]
    r = cliente.post("/api/auth/reset", json={"token": token, "senha": "Silva@2026x"})
    assert r.status_code == 200, r.text
    _, link = service.provisionar("mayacorp", "MayaCorp", admin_nome="Jefferson", admin_email="jeff@mayacorp.com.br",
                                  dominios=["admin.mayajus.test"], tipo="mayacorp")
    r = cliente.post("/api/auth/reset", json={"token": link.split("token=")[1], "senha": "Maya@2026xx"})
    assert r.status_code == 200, r.text
    yield cliente
    settings.controle_database_url = None
    models._fabrica = None
    service.limpar_cache()


def _entrar(c, email, senha, **kw):
    r = c.post("/api/auth/login", json={"email": email, "senha": senha}, **kw)
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_cada_escritorio_no_seu_banco(multi):
    c = multi
    cfme = _login(c)  # o login diz o escritório (catálogo do controle)
    silva = _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    assert c.get("/api/auth/me", headers=silva).json()["nome"] == "Ana Silva"
    assert c.get("/api/auth/me", headers=cfme).json()["email"] == "admin@cfme.com.br"

    # o que um escritório cadastra o outro não vê (os ids podem até coincidir: são bancos diferentes)
    novo = c.post("/api/nfse/tomadores", headers=silva, json={"tipo": "PJ", "nome": "Cliente Exclusivo da Silva"})
    assert novo.status_code in (200, 201), novo.text
    busca = {"q": "Exclusivo da Silva"}
    assert c.get("/api/nfse/tomadores", headers=silva, params=busca).json()["total"] == 1
    assert c.get("/api/nfse/tomadores", headers=cfme, params=busca).json()["total"] == 0

    # login que não existe em escritório nenhum
    assert c.post("/api/auth/login", json={"email": "ninguem@x.com", "senha": "x"}).status_code == 401
    # o mesmo e-mail não pode existir em dois escritórios (no endereço principal o login decide o escritório)
    r = c.post("/api/config/usuarios", headers=cfme, json={"nome": "Ana", "email": "ana@silva.adv.br", "perfil": "operador"})
    assert r.status_code == 409 and "outro escritório" in r.json()["detail"]


def test_dominio_proprio_e_marca(multi):
    c = multi
    assert c.get("/api/public/identidade").json()["nome_exibicao"] == "MayaJus"  # endereço principal
    r = c.get("/api/public/identidade", headers={"Host": "sistema.silva.adv.br"})
    assert r.json()["nome_exibicao"] == "Silva Advogados"
    # pelo domínio do escritório o login vale só ali dentro
    _entrar(c, "ana@silva.adv.br", "Silva@2026x", headers={"Host": "sistema.silva.adv.br"})
    r = c.post("/api/auth/login", json={"email": "admin@cfme.com.br", "senha": "Cfme@2026"},
               headers={"Host": "sistema.silva.adv.br"})
    assert r.status_code == 401


def test_arquivos_separados_e_token_sem_escritorio(multi):
    from app.controle import service

    with tenancy.usando(service.por_slug("silva")):
        assert tenancy.pasta_base() == Path(settings.storage_dir) / "clientes" / "silva"
    with tenancy.usando(service.por_slug("cfme")):
        assert tenancy.pasta_base() == Path(settings.storage_dir)  # a CFME continua onde sempre esteve
    # sem escritório identificado nenhuma rota abre banco: pede login de novo
    assert multi.get("/api/auth/me", headers={"Authorization": "Bearer invalido"}).status_code == 401


def test_admin_mayacorp(multi):
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    cfme = _login(c)
    assert c.get("/api/auth/me", headers=adm).json()["painel_mayacorp"] is True
    assert c.get("/api/auth/me", headers=cfme).json()["painel_mayacorp"] is False
    assert c.get("/api/admin/clientes", headers=cfme).status_code == 404  # nos clientes o admin nem existe

    planos = c.get("/api/admin/planos", headers=adm).json()
    assert [p["nome"] for p in planos] == ["Solo", "Escritório", "Pro", "Ilimitado"]
    pro = next(p for p in planos if p["nome"] == "Pro")
    lista = c.get("/api/admin/clientes", headers=adm).json()
    assert {x["slug"] for x in lista} == {"cfme", "silva"}  # o próprio admin não aparece como cliente

    # cliente novo com plano, início do contrato e teste grátis
    r = c.post("/api/admin/clientes", headers=adm, json={
        "nome": "Souza & Lima Advogados", "documento": "12.345.678/0001-95", "responsavel": "Carla Souza",
        "email_financeiro": "fin@souzalima.adv.br", "plano_id": pro["id"], "ciclo": "anual",
        "inicio_contrato": "2026-11-01", "dias_teste": 15, "admin_nome": "Carla", "admin_email": "carla@souzalima.adv.br",
        "dominios": ["app.souzalima.adv.br"]})
    assert r.status_code == 201, r.text
    novo = r.json()
    assert novo["slug"] == "souza-lima-advogados" and novo["status"] == "teste" and novo["valor"] == "5490.00"
    cid = novo["id"]
    c.post("/api/auth/reset", json={"token": novo["convite"].split("token=")[1], "senha": "Carla@2026x"})
    carla = _entrar(c, "carla@souzalima.adv.br", "Carla@2026x")

    # usuários do cliente: criar, zerar a senha
    r = c.post(f"/api/admin/clientes/{cid}/usuarios", headers=adm,
               json={"nome": "Beto", "email": "beto@souzalima.adv.br", "perfil": "Operador"})
    assert r.status_code == 201, r.text
    assert c.post(f"/api/admin/clientes/{cid}/usuarios", headers=adm,
                  json={"nome": "Xavier", "email": "admin@cfme.com.br"}).status_code == 409  # e-mail de outro escritório
    usuarios = c.get(f"/api/admin/clientes/{cid}/usuarios", headers=adm).json()
    assert {u["email"] for u in usuarios} == {"carla@souzalima.adv.br", "beto@souzalima.adv.br"}
    uid = next(u["id"] for u in usuarios if u["email"] == "carla@souzalima.adv.br")
    r = c.post(f"/api/admin/clientes/{cid}/usuarios/{uid}/zerar-senha", headers=adm)
    assert r.status_code == 200, r.text
    assert c.post("/api/auth/login", json={"email": "carla@souzalima.adv.br", "senha": "Carla@2026x"}).status_code == 401
    c.post("/api/auth/reset", json={"token": r.json()["link"].split("token=")[1], "senha": "Carla@2027x"})
    carla = _entrar(c, "carla@souzalima.adv.br", "Carla@2027x")
    uso = c.get(f"/api/admin/clientes/{cid}/uso", headers=adm).json()
    assert uso["usuarios"] == 2 and uso["limite_usuarios"] == 15 and uso["notas_mes"] == 0

    # inativar corta o acesso; reativar devolve
    assert c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "inativo"}).status_code == 200
    assert c.get("/api/auth/me", headers=carla).status_code == 401
    assert c.post("/api/auth/login", json={"email": "carla@souzalima.adv.br", "senha": "Carla@2027x"}).status_code == 401
    c.post(f"/api/admin/clientes/{cid}/status", headers=adm, json={"status": "ativo"})
    _entrar(c, "carla@souzalima.adv.br", "Carla@2027x")

    # modelo de contrato → contrato do cliente → PDF → e-mail
    m = c.post("/api/admin/modelos-contrato", headers=adm, json={
        "nome": "Contrato de Licença MayaJus",
        "corpo": "CONTRATANTE: {{cliente_nome}}, CNPJ {{cliente_documento}}.\n\nPlano {{plano}} ({{ciclo}}): "
                 "R$ {{valor}}, a partir de {{data_inicio}}. Até {{usuarios}} usuários. {{inexistente}}"}).json()
    assert m["variaveis_desconhecidas"] == ["inexistente"]
    k = c.post(f"/api/admin/clientes/{cid}/contratos", headers=adm, json={"modelo_id": m["id"]}).json()
    assert "Souza & Lima Advogados, CNPJ 12.345.678/0001-95" in k["corpo"]
    assert "Plano Pro (anual): R$ 5.490,00, a partir de 01/11/2026. Até 15 usuários." in k["corpo"]
    assert c.get(f"/api/admin/contratos/{k['id']}/pdf", headers=adm).content[:5] == b"%PDF-"
    r = c.post(f"/api/admin/contratos/{k['id']}/enviar", headers=adm, json={"para": ["fin@souzalima.adv.br"]})
    assert r.status_code == 200 and r.json()["status"] == "enviado", r.text
    assert c.put(f"/api/admin/contratos/{k['id']}", headers=adm, json={"titulo": "x x", "corpo": "y" * 20}).status_code == 400


def test_desconto_por_indicacao(multi):
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    clientes = {x["slug"]: x for x in c.get("/api/admin/clientes", headers=adm).json()}
    pro = next(p for p in c.get("/api/admin/planos", headers=adm).json() if p["nome"] == "Pro")
    souza, silva, cfme = clientes["souza-lima-advogados"], clientes["silva"], clientes["cfme"]
    c.put(f"/api/admin/clientes/{souza['id']}", headers=adm, json={
        "nome": souza["nome"], "plano_id": pro["id"], "ciclo": "mensal"})

    def ficha():
        return c.get(f"/api/admin/clientes/{souza['id']}", headers=adm).json()

    assert ficha()["desconto_percentual"] == "0.00" and ficha()["valor_com_desconto"] == "549.00"
    # indicado em teste não conta; ativo (pagando) conta 5%
    c.put(f"/api/admin/clientes/{silva['id']}", headers=adm, json={"nome": silva["nome"], "indicado_por_id": souza["id"]})
    assert ficha()["indicacoes_ativas"] == 0  # silva está em teste
    c.post(f"/api/admin/clientes/{silva['id']}/status", headers=adm, json={"status": "ativo"})
    assert ficha()["desconto_percentual"] == "5.00" and ficha()["valor_com_desconto"] == "521.55"
    c.put(f"/api/admin/clientes/{cfme['id']}", headers=adm, json={"nome": cfme["nome"], "indicado_por_id": souza["id"]})
    assert ficha()["indicacoes_ativas"] == 2 and ficha()["desconto_percentual"] == "10.00"
    # 8% por indicação: 2 indicações dariam 16%, mas o teto é 10%
    assert c.put("/api/admin/politica-indicacao", headers=adm,
                 json={"desconto_por_indicacao": "8", "desconto_maximo": "10"}).status_code == 200
    assert ficha()["desconto_percentual"] == "10.00" and ficha()["valor_com_desconto"] == "494.10"
    assert c.put("/api/admin/politica-indicacao", headers=adm,
                 json={"desconto_por_indicacao": "5", "desconto_maximo": "15"}).status_code == 422  # nunca acima de 10%
    assert c.put(f"/api/admin/clientes/{souza['id']}", headers=adm,
                 json={"nome": souza["nome"], "indicado_por_id": souza["id"]}).status_code == 400  # não indica a si mesmo
