"""Configurações › Faturamento: trabalhar sem a figura do contrato (só Cliente → Caso).

O banco é o mesmo para a suíte inteira: o teste liga a opção direto no banco (os outros testes já deixaram clientes
com vários contratos, o que a tela não deixaria desligar) e volta ao padrão no fim.
"""

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.models import Tenant
from app.modules.faturamento import service
from app.modules.faturamento.models import ConfigFaturamento, Contrato
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj


def _tomador(c, h, nome: str, raiz: int) -> int:
    r = c.post("/api/nfse/tomadores", json={"tipo": "PJ", "cpf_cnpj": _cnpj(raiz), "nome": nome}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _desligar(valor: bool) -> None:
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).order_by(Tenant.id).limit(1))
        cfg = db.get(ConfigFaturamento, tenant_id) or ConfigFaturamento(tenant_id=tenant_id)
        cfg.usa_contrato = valor
        db.add(cfg)
        db.commit()


def test_sem_contrato_cada_cliente_tem_um_contrato_unico(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    assert c.get("/api/faturamento/config", headers=h).json() == {"usa_contrato": True}
    tid = _tomador(c, h, "Cliente Só Com Casos", 70519911)
    assert c.get(f"/api/faturamento/clientes/{tid}/contrato", headers=h).json() is None
    _desligar(False)
    try:
        assert c.get("/api/faturamento/config", headers=h).json() == {"usa_contrato": False}
        # o contrato do cliente nasce na primeira vez e é sempre o mesmo
        c1 = c.post(f"/api/faturamento/clientes/{tid}/contrato", headers=h).json()
        c2 = c.post(f"/api/faturamento/clientes/{tid}/contrato", headers=h).json()
        assert c1["id"] == c2["id"] and c1["tomador_id"] == tid and c1["nome"] == service.NOME_CONTRATO_UNICO
        assert c.get(f"/api/faturamento/clientes/{tid}/contrato", headers=h).json()["id"] == c1["id"]
        caso = c.post(f"/api/faturamento/contratos/{c1['id']}/casos", json={"titulo": "Consultoria"}, headers=h)
        assert caso.status_code == 201, caso.text
        # os relatórios deixam de oferecer colunas de contrato
        cat = c.get("/api/relatorios/catalogo", headers=h).json()
        assert not any(col["id"].startswith("contrato") for f in cat["fontes"] for col in f["colunas"])
        assert not any("contrato" in p["config"]["colunas"] for p in cat["prontos"])
        assert not any(p["id"] == "horas-por-contrato" for p in cat["prontos"])
        # voltar a usar contratos é sempre permitido
        assert c.put("/api/faturamento/config", json={"usa_contrato": True}, headers=h).status_code == 200
    finally:
        _desligar(True)
    cat = c.get("/api/relatorios/catalogo", headers=h).json()
    assert any(p["id"] == "horas-por-contrato" for p in cat["prontos"])


def test_nao_desliga_com_cliente_de_varios_contratos(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    tid = _tomador(c, h, "Cliente de Dois Contratos", 70519922)
    for nome in ("Consultivo", "Contencioso"):
        assert c.post("/api/faturamento/contratos", json={"tomador_id": tid, "nome": nome}, headers=h).status_code == 201
    r = c.put("/api/faturamento/config", json={"usa_contrato": False}, headers=h)
    assert r.status_code == 400
    assert "mais de um" in r.json()["detail"]
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).order_by(Tenant.id).limit(1))
        assert "Cliente de Dois Contratos" in service.clientes_com_varios_contratos(db, tenant_id)
    assert c.get("/api/faturamento/config", headers=h).json() == {"usa_contrato": True}


def test_texto_da_fatura_sem_o_nome_do_contrato():
    from app.modules.rpa_nfse.models import TipoFatura

    k = Contrato(numero=7, nome="Geral")
    assert service._descricao(k, [], TipoFatura.honorarios) == "Honorários advocatícios — Geral"
    assert service._descricao(k, [], TipoFatura.honorarios, None, False) == "Honorários advocatícios"
    assert service._descricao(k, [], TipoFatura.despesas, None, False) == "Reembolso de despesas"
