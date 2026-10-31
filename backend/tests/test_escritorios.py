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
