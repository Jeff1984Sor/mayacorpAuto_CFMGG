"""Um banco por escritório: a CFME no banco principal e um escritório novo no banco próprio, sem se enxergarem."""

import tempfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core import tenancy
from app.core.config import settings
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


@pytest.fixture(scope="module")
def multi(cliente):  # noqa: F811
    from app.controle import models, service

    pasta = Path(tempfile.mkdtemp(prefix="mayajus-controle-"))
    tenancy.forcar_controle(f"sqlite:///{(pasta / 'controle.db').as_posix()}")
    models._fabrica = None
    service.limpar_cache()
    service.migrar_controle()
    assert service.registrar_principal_se_faltar() == "cfme"  # primeira ativação: a CFME entra sozinha, com os logins
    assert service.registrar_principal_se_faltar() is None
    _, link = service.provisionar("silva", "Silva Advogados", admin_nome="Ana Silva", admin_email="ana@silva.adv.br",
                                  dias_teste=15, dominios=["sistema.silva.adv.br"])
    token = link.split("token=")[1]
    r = cliente.post("/api/auth/reset", json={"token": token, "senha": "Silva@2026x"})
    assert r.status_code == 200, r.text
    _, link = service.provisionar("mayacorp", "MayaCorp", admin_nome="Jefferson", admin_email="jeff@mayacorp.com.br",
                                  dominios=["admin.mayajus.test"], tipo="mayacorp", admin_login="jeffadm",
                                  admin_senha="Maya@2026xx")
    assert link == ""  # com senha definida não há convite
    yield cliente
    tenancy.forcar_controle(None)
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

    # senha do usuário Suporte: definida no admin (nunca no código)
    assert c.get("/api/admin/suporte", headers=adm).json() == {"senha_definida": False}
    assert c.put("/api/admin/suporte", headers=adm, json={"senha": "Suporte#Teste1"}).status_code == 200

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
    # o cliente do MayaJus é o mesmo cliente no cadastro da MayaCorp (um cadastro só)
    tom = c.get("/api/nfse/tomadores", headers=adm, params={"q": "Souza"}).json()
    tom = tom.get("itens", tom) if isinstance(tom, dict) else tom
    assert [(t["nome"], t["cpf_cnpj"]) for t in tom] == [("Souza & Lima Advogados", "12345678000195")]
    assert c.get("/api/auth/me", headers=adm).json()["endereco_painel"] == "admin.mayajus.test"
    # boas-vindas: o próprio cliente cria o usuário master pelo link (e já entra)
    assert "/primeiro-acesso?token=" in novo["convite"]
    tk = novo["convite"].split("token=")[1]
    info = c.get("/api/auth/primeiro-acesso", params={"token": tk}).json()
    assert info == {"escritorio": "Souza & Lima Advogados", "email": "carla@souzalima.adv.br"}
    assert c.post("/api/auth/primeiro-acesso", json={"token": tk, "nome": "Carla Souza", "email": "admin@cfme.com.br",
                                                      "senha": "Carla@2026x"}).status_code == 409  # e-mail de outro escritório
    r = c.post("/api/auth/primeiro-acesso", json={"token": tk, "nome": "Carla Souza", "email": "carla@souzalima.adv.br",
                                                  "login": "carla", "senha": "Carla@2026x"})
    assert r.status_code == 200 and r.json()["usuario"]["administrador"] is True, r.text
    assert c.post("/api/auth/primeiro-acesso", json={"token": tk, "nome": "Outra", "email": "x@souzalima.adv.br",
                                                      "senha": "Outra@2026x"}).status_code == 409  # o link vale uma vez
    carla = _entrar(c, "carla", "Carla@2026x")
    # todo escritório novo tem o usuário Suporte da MayaCorp (fora do limite do plano)
    _entrar(c, "suporte.souza-lima-advogados", "Suporte#Teste1")

    # usuários do cliente: criar, zerar a senha
    r = c.post(f"/api/admin/clientes/{cid}/usuarios", headers=adm,
               json={"nome": "Beto", "email": "beto@souzalima.adv.br", "perfil": "Operador"})
    assert r.status_code == 201, r.text
    assert c.post(f"/api/admin/clientes/{cid}/usuarios", headers=adm,
                  json={"nome": "Xavier", "email": "admin@cfme.com.br"}).status_code == 409  # e-mail de outro escritório
    usuarios = c.get(f"/api/admin/clientes/{cid}/usuarios", headers=adm).json()
    assert {u["email"] for u in usuarios} == {"carla@souzalima.adv.br", "beto@souzalima.adv.br",
                                              "suporte+souza-lima-advogados@mayacorp.com.br"}
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
    todos = c.get("/api/admin/contratos", headers=adm).json()
    assert [(x["id"], x["cliente_nome"]) for x in todos] == [(k["id"], "Souza & Lima Advogados")]


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


def test_ia_no_admin(multi, monkeypatch):
    from types import SimpleNamespace

    from app.core import ia

    resposta = {}
    monkeypatch.setattr(ia, "provedor_ativo", lambda db, tid: SimpleNamespace(nome="gemini", modelo="teste"))
    monkeypatch.setattr(ia, "gerar_json", lambda p, sistema, usuario, anexo=None: resposta["proxima"])
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")

    resposta["proxima"] = {"nome": "Ramos Advocacia", "documento": "11.222.333/0001-81", "responsavel": "Dra. Ramos",
                           "email_financeiro": "nao-e-email", "telefone": "(11) 3333-4444"}
    r = c.post("/api/admin/ia/ficha", headers=adm, json={"texto": "Ramos Advocacia CNPJ 11.222.333/0001-81 ..."}).json()
    assert r["campos"]["documento"] == "11222333000181" and "email_financeiro" not in r["campos"]  # e-mail inválido sai

    resposta["proxima"] = {"corpo": "CONTRATANTE: {{cliente_nome}} no plano {{plano}}. " * 3 + "{{inventada}}", "resumo": "ok"}
    r = c.post("/api/admin/ia/contrato", headers=adm, json={"instrucao": "contrato simples"}).json()
    assert r["variaveis_desconhecidas"] == ["inventada"]  # o admin vê o que a IA inventou
    assert c.post("/api/admin/ia/contrato", headers=adm, json={}).status_code == 400

    cliente_id = next(x["id"] for x in c.get("/api/admin/clientes", headers=adm).json() if x["slug"] == "silva")
    resposta["proxima"] = {"mensagem": "Olá, segue o contrato."}
    r = c.post("/api/admin/ia/mensagem", headers=adm, json={"titulo": "Contrato", "cliente_id": cliente_id})
    assert r.json()["mensagem"] == "Olá, segue o contrato."
    assert c.post("/api/admin/ia/ficha", headers=_login(c), json={"texto": "x" * 20}).status_code == 404  # só no admin


def test_cobranca_mercado_pago(multi, monkeypatch):
    from app.controle import mercadopago

    chamadas = []

    class MPFalso(mercadopago.MercadoPago):
        def _chamar(self, metodo, caminho, json=None, chave=None):
            chamadas.append((metodo, caminho, json))
            if caminho == "/users/me":
                return {"id": 1, "email": "contato@mayacorp.com.br"}
            if caminho == "/checkout/preferences":
                return {"id": f"pref-{json['external_reference']}", "init_point": f"https://mp.test/{json['external_reference']}"}
            if caminho.startswith("/v1/payments/"):
                return {"id": 555, "status": "approved", "external_reference": pagamento_ref[0],
                        "payment_type_id": "pix", "date_approved": "2026-11-05T10:00:00.000-03:00"}
            if caminho == "/preapproval" and metodo == "POST":
                return {"id": "pre-1", "status": "pending", "init_point": "https://mp.test/assinar"}
            if caminho.startswith("/preapproval/"):
                return {"id": "pre-1", "status": "authorized"}
            if caminho.startswith("/authorized_payments/"):
                return {"preapproval_id": "pre-1", "transaction_amount": 279, "debit_date": "2026-11-10T09:00:00Z",
                        "payment": {"id": 777, "status": "approved"}}
            raise AssertionError(caminho)

    monkeypatch.setattr(mercadopago, "MercadoPago", MPFalso)
    monkeypatch.setattr("app.controle.cobranca.MercadoPago", MPFalso)
    monkeypatch.setattr("app.controle.routes_cobranca.MercadoPago", MPFalso)
    pagamento_ref = [""]
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")

    # sem conta conectada, nada de link
    assert c.get("/api/admin/cobranca/config", headers=adm).json()["conectado"] is False
    r = c.put("/api/admin/cobranca/config", headers=adm,
              json={"token": "APP_USR-123", "dia_vencimento": 10, "gerar_automatico": True, "regua": [-3, 0, 3]})
    assert r.status_code == 200, r.text
    assert r.json()["conectado"] and r.json()["conta"] == "contato@mayacorp.com.br"
    assert r.json()["url_notificacao"] == "https://admin.mayajus.test/api/public/mercadopago"

    silva = next(x for x in c.get("/api/admin/clientes", headers=adm).json() if x["slug"] == "silva")
    solo = next(p for p in c.get("/api/admin/planos", headers=adm).json() if p["nome"] == "Solo")
    ficha = {k: silva[k] for k in ("nome", "documento", "responsavel", "telefone", "ciclo", "inicio_contrato",
                                    "teste_ate", "observacao", "indicado_por_id")}
    ficha.update(plano_id=solo["id"], email_financeiro="fin@silva.adv.br")
    assert c.put(f"/api/admin/clientes/{silva['id']}", headers=adm, json=ficha).status_code == 200
    c.post(f"/api/admin/clientes/{silva['id']}/status", headers=adm, json={"status": "ativo"})

    # mensalidade do mês: idempotente
    r = c.post("/api/admin/cobrancas/gerar", headers=adm, json={"competencia": "2026-11", "enviar": True})
    assert r.status_code == 200 and "Silva Advogados" in r.json()["criadas"], r.text
    assert "Silva Advogados" not in c.post("/api/admin/cobrancas/gerar", headers=adm,
                                           json={"competencia": "2026-11", "enviar": False}).json()["criadas"]
    cob = next(k for k in c.get("/api/admin/cobrancas", headers=adm).json() if k["cliente_nome"] == "Silva Advogados")
    assert cob["valor"] == "119.00" and cob["link"] == f"https://mp.test/cob:{cob['id']}"

    # o Mercado Pago avisa o pagamento: baixa automática (relida na API, não no aviso)
    pagamento_ref[0] = f"cob:{cob['id']}"
    assert c.post("/api/public/mercadopago", json={"type": "payment", "data": {"id": "555"}}).status_code == 200
    cob = next(k for k in c.get("/api/admin/cobrancas", headers=adm).json() if k["id"] == cob["id"])
    assert cob["status"] == "paga" and cob["forma_paga"] == "Pix"

    # avulsa (sem produto) + assinatura secreta: aviso com assinatura errada é ignorado
    r = c.post("/api/admin/cobrancas/avulsa", headers=adm, json={"cliente_id": silva["id"], "descricao": "Implantação",
                                                                 "valor": "500.00", "vencimento": (date.today() + timedelta(days=10)).isoformat()})
    assert r.status_code == 201, r.text
    av = r.json()
    c.put("/api/admin/cobranca/config", headers=adm,
          json={"segredo": "s3gr3d0", "dia_vencimento": 10, "gerar_automatico": True, "regua": [-3, 0, 3]})
    pagamento_ref[0] = f"cob:{av['id']}"
    c.post("/api/public/mercadopago?data.id=555&type=payment", json={"type": "payment", "data": {"id": "555"}},
           headers={"x-signature": "ts=1,v1=errado", "x-request-id": "r1"})
    assert next(k for k in c.get("/api/admin/cobrancas", headers=adm).json() if k["id"] == av["id"])["status"] == "pendente"
    import hashlib
    import hmac
    v1 = hmac.new(b"s3gr3d0", b"id:555;request-id:r1;ts:1;", hashlib.sha256).hexdigest()
    c.post("/api/public/mercadopago?data.id=555&type=payment", json={"type": "payment", "data": {"id": "555"}},
           headers={"x-signature": f"ts=1,v1={v1}", "x-request-id": "r1"})
    assert next(k for k in c.get("/api/admin/cobrancas", headers=adm).json() if k["id"] == av["id"])["status"] == "paga"

    # "Meu plano" no ambiente do cliente: upgrade e cartão recorrente
    ana = _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    meu = c.get("/api/meu-plano", headers=ana).json()
    assert meu["plano"]["nome"] == "Solo" and meu["pode_alterar"] is True
    esc = next(p for p in meu["planos"] if p["nome"] == "Escritório")
    r = c.put("/api/meu-plano", headers=ana, json={"plano_id": esc["id"], "ciclo": "mensal"})
    assert r.status_code == 200 and r.json()["plano"]["nome"] == "Escritório", r.text
    r = c.post("/api/meu-plano/cartao", headers=ana)
    assert r.status_code == 200 and r.json()["link"] == "https://mp.test/assinar", r.text
    assert c.get("/api/meu-plano", headers=adm).status_code == 404  # o admin não tem "Meu plano"

    # débito da assinatura vira cobrança paga
    c.post("/api/public/mercadopago", json={"type": "subscription_authorized_payment", "data": {"id": "9"}})
    cartao = [k for k in c.get("/api/admin/cobrancas", headers=adm).json() if k["tipo"] == "cartao"]
    assert [(k["competencia"], k["valor"], k["status"]) for k in cartao] == [("2026-11", "279.00", "paga")]

    # régua: uma pendente vencida recebe um aviso só (o passo mais recente)

    from app.controle import cobranca
    from app.controle.models import Cobranca, SessaoControle

    r = c.post("/api/admin/cobrancas/avulsa", headers=adm, json={"cliente_id": silva["id"], "descricao": "Treinamento",
                                                                 "valor": "200.00", "vencimento": "2026-11-01",
                                                                 "enviar": False})
    kid = r.json()["id"]
    assert cobranca.rotina_diaria(date(2026, 11, 6))["avisos"] >= 1
    with SessaoControle() as db:
        assert db.get(Cobranca, kid).avisos == [-3, 0, 3]


def test_nfse_da_mensalidade_paga(multi, monkeypatch):
    """Cobrança paga: o admin emite a NFS-e da MayaCorp para o CNPJ do escritório (banco do admin, Emissor Nacional)."""
    from datetime import datetime

    from app.controle import nota_fiscal
    from app.controle.models import Cliente, Cobranca, SessaoControle

    monkeypatch.setattr(nota_fiscal, "EM_SEGUNDO_PLANO", False)
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    # empresa emissora da MayaCorp: MEI de Sorocaba, pelo Emissor Nacional (modo simulação no teste)
    r = c.post("/api/nfse/emissoras", headers=adm, json={
        "razao_social": "MayaCorp MEI", "cnpj": "37552605000103", "ccm": "", "sistema_emissao": "nacional", "regime": "mei",
        "cep": "18035000", "cidade": "Sorocaba", "uf": "SP", "codigo_municipio": "3552205", "cod_trib_nacional": "010101",
        "serie_rps": "2", "prox_rps": 1, "aliquota_iss": "0.02"})
    assert r.status_code == 200, r.text
    emissora = r.json()
    cfg = c.get("/api/admin/cobranca/config", headers=adm).json()
    assert cfg["nfse_automatica"] is False and "{descricao}" in cfg["nfse_descricao"]
    r = c.put("/api/admin/cobranca/config", headers=adm, json={
        "dia_vencimento": cfg["dia_vencimento"], "gerar_automatico": cfg["gerar_automatico"], "regua": cfg["regua"],
        "nfse_automatica": True, "nfse_emissora_id": emissora["id"], "nfse_descricao": "Licença MayaJus - {descricao}"})
    assert r.status_code == 200 and r.json()["nfse_automatica"] is True, r.text
    assert c.put("/api/admin/cobranca/config", headers=adm, json={**r.json(), "nfse_emissora_id": 99999}).status_code == 400

    with SessaoControle() as db:
        silva = db.scalar(select(Cliente).where(Cliente.slug == "silva"))
        silva.documento, silva.email_financeiro = "11444777000161", "fin@silva.adv.br"
        sem_doc = db.scalar(select(Cliente).where(Cliente.slug == "cfme"))
        sem_doc.documento = None
        k1 = Cobranca(cliente_id=silva.id, tipo="avulsa", descricao="Implantação de dezembro", itens=[], valor=Decimal("450.00"),
                      vencimento=date.today(), status="pendente", avisos=[])
        k2 = Cobranca(cliente_id=sem_doc.id, tipo="avulsa", descricao="Treinamento", itens=[], valor=Decimal("90.00"),
                      vencimento=date.today(), status="pendente", avisos=[])
        db.add_all([k1, k2])
        db.commit()
        k1_id, k2_id = k1.id, k2.id

    # baixa manual: a nota sai sozinha
    assert c.post(f"/api/admin/cobrancas/{k1_id}/baixa", headers=adm, json={"forma": "pix"}).status_code == 200
    k = next(x for x in c.get("/api/admin/cobrancas", headers=adm).json() if x["id"] == k1_id)
    assert k["nfse_status"] == "emitida", k
    assert k["nfse_numero"] and len(k["nfse_chave"]) == 50 and k["nfse_chave"].startswith("3552205"), k
    pdf = c.get(f"/api/admin/cobrancas/{k1_id}/nfse/pdf", headers=adm)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    nota = c.get(f"/api/nfse/notas/{k['nfse_id']}", headers=adm).json()
    assert nota["tomador_doc"] == "11444777000161" and nota["valor"] == "450.00" and "Licença MayaJus - Implantação" in nota["discriminacao"]
    # uma nota por cobrança
    r = c.post(f"/api/admin/cobrancas/{k1_id}/nfse", headers=adm)
    assert r.status_code == 400 and "já tem NFS-e" in r.json()["detail"]
    # o escritório que pagou não vê o cadastro do admin (a nota é da MayaCorp, no banco dela)
    nota1 = k["nfse_id"]
    ana = _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    assert c.get("/api/nfse/tomadores", headers=ana, params={"q": "11444777000161"}).json()["total"] == 0
    assert c.get("/api/nfse/tomadores", headers=adm, params={"q": "11444777000161"}).json()["total"] == 1

    # escritório sem CNPJ: a baixa vale, a nota fica com o erro na cobrança e pode ser refeita depois
    assert c.post(f"/api/admin/cobrancas/{k2_id}/baixa", headers=adm, json={}).status_code == 200
    k = next(x for x in c.get("/api/admin/cobrancas", headers=adm).json() if x["id"] == k2_id)
    assert k["status"] == "paga" and k["nfse_status"] == "erro" and "CNPJ" in k["nfse_erro"], k
    with SessaoControle() as db:
        db.get(Cliente, db.get(Cobranca, k2_id).cliente_id).documento = "33000167000101"
        db.commit()
    r = c.post(f"/api/admin/cobrancas/{k2_id}/nfse", headers=adm)
    assert r.status_code == 200 and r.json()["nfse_status"] == "emitida", r.text
    # cobrança em aberto não tem nota
    with SessaoControle() as db:
        k3 = Cobranca(cliente_id=silva.id, tipo="avulsa", descricao="Em aberto", itens=[], valor=Decimal("10"),
                      vencimento=date.today(), status="pendente", avisos=[], criado_em=datetime.now())
        db.add(k3)
        db.commit()
        k3_id = k3.id
    r = c.post(f"/api/admin/cobrancas/{k3_id}/nfse", headers=adm)
    assert r.status_code == 400 and "depois que a cobrança é paga" in r.json()["detail"]
    assert c.get(f"/api/admin/cobrancas/{k3_id}/nfse/pdf", headers=adm).status_code == 404
    # nota cancelada no admin: a cobrança mostra e deixa emitir de novo
    assert c.post(f"/api/nfse/notas/{nota1}/cancelar", headers=adm, json={"motivo": "Emitida com valor errado"}).status_code == 200
    k = next(x for x in c.get("/api/admin/cobrancas", headers=adm).json() if x["id"] == k1_id)
    assert k["nfse_status"] == "cancelada"
    r = c.post(f"/api/admin/cobrancas/{k1_id}/nfse", headers=adm)
    assert r.status_code == 200 and r.json()["nfse_status"] == "emitida" and r.json()["nfse_id"] != nota1, r.text


def test_admin_libera_a_ia_do_escritorio(multi, monkeypatch):
    """Chave de IA da MayaCorp guardada no admin e aplicada na base do escritório; trocar a chave atualiza as bases."""
    from app.controle.models import Cliente, SessaoControle
    from app.core import ia

    testadas = []

    def modelos_falsos(provedor, chave):
        testadas.append((provedor, chave))
        if chave.startswith("ruim"):
            raise ia.IAIndisponivel("A chave da OpenAI foi recusada.")
        return ["gpt-mini", "gpt-grande"]

    monkeypatch.setattr(ia, "listar_modelos", modelos_falsos)
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    assert {x["provedor"]: x["definida"] for x in c.get("/api/admin/ia/chaves", headers=adm).json()} == {"openai": False, "gemini": False}
    with SessaoControle() as db:
        silva_id = db.scalar(select(Cliente.id).where(Cliente.slug == "silva"))
    # sem chave central não libera
    r = c.put(f"/api/admin/clientes/{silva_id}/ia", headers=adm, json={"ativo": True, "provedor": "openai", "modelo": "gpt-mini"})
    assert r.status_code == 400 and "ainda não tem chave" in r.json()["detail"]
    assert c.put("/api/admin/ia/chaves/openai", headers=adm, json={"chave": "ruim-1234567890"}).status_code == 400
    r = c.put("/api/admin/ia/chaves/openai", headers=adm, json={"chave": "sk-primeira-1234567890"})
    assert r.status_code == 200 and r.json()["modelos"] == ["gpt-mini", "gpt-grande"], r.text
    assert c.get("/api/admin/ia/modelos/openai", headers=adm).json() == ["gpt-mini", "gpt-grande"]
    assert c.get("/api/admin/ia/modelos/xpto", headers=adm).status_code == 404
    # libera para a Silva: o escritório passa a ter IA, com a chave da MayaCorp
    r = c.put(f"/api/admin/clientes/{silva_id}/ia", headers=adm, json={"ativo": True, "provedor": "openai", "modelo": "gpt-mini"})
    assert r.status_code == 200 and r.json() == {"ativo": True, "provedor": "openai", "modelo": "gpt-mini", "tem_chave": True,
                                                 "chave_mayacorp": True}, r.text
    ana = _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    cfg = c.get("/api/config/ia", headers=ana).json()
    assert (cfg["ativo"], cfg["provedor"], cfg["modelo"]) == (True, "openai", "gpt-mini")
    # trocar a chave central atualiza a base da Silva
    r = c.put("/api/admin/ia/chaves/openai", headers=adm, json={"chave": "sk-segunda-1234567890"})
    assert "silva" in r.json()["bases_atualizadas"], r.json()
    assert c.get(f"/api/admin/clientes/{silva_id}/ia", headers=adm).json()["chave_mayacorp"] is True
    # desligar
    r = c.put(f"/api/admin/clientes/{silva_id}/ia", headers=adm, json={"ativo": False})
    assert r.status_code == 200 and r.json()["ativo"] is False
    assert c.get("/api/config/ia", headers=ana).json()["ativo"] is False
    # importar do que já está em uso: nenhum escritório usa Gemini
    assert c.post("/api/admin/ia/chaves/gemini/importar", headers=adm).status_code == 404
    assert c.post("/api/admin/ia/chaves/openai/importar", headers=adm).status_code == 400  # já tem
    # só o admin da MayaCorp mexe nisso
    assert c.get("/api/admin/ia/chaves", headers=ana).status_code == 404
    assert c.put(f"/api/admin/clientes/{silva_id}/ia", headers=ana, json={"ativo": True}).status_code == 404


def test_cadastro_pelo_site(multi):
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    planos = c.get("/api/public/planos").json()  # sem login: o site mostra os planos
    pro = next(p for p in planos if p["nome"] == "Pro")
    base = {"nome": "Ramos Advocacia", "documento": "11.222.333/0001-81", "responsavel": "Paula Ramos",
            "email": "paula@ramos.adv.br", "telefone": "(11) 99999-0000", "plano_id": pro["id"], "ciclo": "mensal",
            "usuarios": 6, "indicacao": "Silva Advogados", "aceite": True}
    assert c.post("/api/public/cadastro", json={**base, "aceite": False}).status_code == 400
    assert c.post("/api/public/cadastro", json={**base, "site": "spam.com"}).status_code == 201  # robô: descartado
    assert c.post("/api/public/cadastro", json=base).status_code == 201
    sols = c.get("/api/admin/solicitacoes", headers=adm, params={"status": "nova"}).json()
    assert [s["nome"] for s in sols] == ["Ramos Advocacia"]
    r = c.post(f"/api/admin/solicitacoes/{sols[0]['id']}/aprovar", headers=adm, json={"dias_teste": 15})
    assert r.status_code == 200, r.text
    cli = r.json()
    assert cli["status"] == "teste" and cli["plano"]["nome"] == "Pro" and "/primeiro-acesso?token=" in cli["convite"]
    assert c.post(f"/api/admin/solicitacoes/{sols[0]['id']}/aprovar", headers=adm, json={}).status_code == 400


def test_aprovar_pelo_link_do_email(multi):
    from app.controle import service
    from app.core import tenancy
    from app.core.db import SessionLocal
    from app.core.models import Usuario
    from app.core.security import criar_token

    c = multi
    base = {"nome": "Lima Advocacia", "responsavel": "Rui Lima", "email": "rui@lima.adv.br",
            "telefone": "(11) 98888-0000", "ciclo": "mensal", "aceite": True}
    assert c.post("/api/public/cadastro", json=base, headers={"x-forwarded-for": "10.9.9.9"}).status_code == 201
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    sid = next(s["id"] for s in c.get("/api/admin/solicitacoes", headers=adm).json() if s["nome"] == "Lima Advocacia")
    esc = service.escritorio_mayacorp()
    with tenancy.usando(esc), SessionLocal() as db:
        uid = db.query(Usuario).filter_by(email="jeff@mayacorp.com.br").one().id
        tk = criar_token(str(uid), "aprovar", {"sol": sid})
    assert c.get("/api/public/solicitacao", params={"token": "lixo"}).status_code == 400
    assert c.get("/api/public/solicitacao", params={"token": tk}).json()["nome"] == "Lima Advocacia"
    r = c.post("/api/public/solicitacao/aprovar", json={"token": tk, "dias_teste": 10})
    assert r.status_code == 200 and r.json()["status"] == "teste", r.text
    assert c.post("/api/public/solicitacao/recusar", json={"token": tk}).status_code == 400  # já tratada


def test_primeiro_acesso_pelo_login_e_primeira_cobranca(multi):
    import glob
    import os

    from app.core import tenancy as tn

    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    solo = next(p for p in c.get("/api/admin/planos", headers=adm).json() if p["nome"] == "Solo")
    r = c.post("/api/admin/clientes", headers=adm, json={
        "nome": "Torres Advogados", "plano_id": solo["id"], "ciclo": "mensal", "dias_teste": 10,
        "admin_email": "fin@torres.adv.br", "dominios": []})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["email_financeiro"] == "fin@torres.adv.br"
    # a 1ª cobrança já nasce, vencendo no fim do teste
    cobs = c.get("/api/admin/cobrancas", headers=adm, params={"cliente_id": cid}).json()
    assert [(k["valor"], k["vencimento"]) for k in cobs] == [("119.00", r.json()["teste_ate"])]
    # botão "1º acesso" no login: resposta igual para qualquer e-mail; o do financeiro recebe o link
    antes = set(glob.glob(str(tn.pasta_base() / "**" / "outbox" / "*.eml"), recursive=True))
    msg = c.post("/api/auth/primeiro-acesso/pedir", json={"email": "fin@torres.adv.br"}).json()["mensagem"]
    assert msg == c.post("/api/auth/primeiro-acesso/pedir", json={"email": "ninguem@x.com"}).json()["mensagem"]
    novos = set(glob.glob(str(tn.pasta_base() / "**" / "outbox" / "*.eml"), recursive=True)) - antes
    assert any("primeiro-acesso?token=" in open(f, encoding="utf8", errors="ignore").read() for f in novos), novos
    assert all(os.path.exists(f) for f in novos)


def test_robos_liberados_por_escritorio(multi):
    c = multi
    cfme, ana = _login(c), _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    assert set(c.get("/api/auth/me", headers=cfme).json()["robos"]) == {"nfse_lote", "porto_seguro"}
    assert c.get("/api/auth/me", headers=ana).json()["robos"] == []
    assert {k["slug"] for k in c.get("/api/hub/automacoes", headers=ana).json()} == {"tribunais"}
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    silva = next(x for x in c.get("/api/admin/clientes", headers=adm).json() if x["slug"] == "silva")
    ficha = {k: silva[k] for k in ("nome", "documento", "responsavel", "email_financeiro", "telefone", "plano_id", "ciclo",
                                    "inicio_contrato", "teste_ate", "observacao", "indicado_por_id")}
    r = c.put(f"/api/admin/clientes/{silva['id']}", headers=adm, json={**ficha, "robos": ["nfse_lote", "inventado"]})
    assert r.status_code == 200 and r.json()["robos"] == ["nfse_lote"], r.text
    assert c.get("/api/auth/me", headers=ana).json()["robos"] == ["nfse_lote"]


def test_exclusoes_do_admin_e_profissional(multi):
    c = multi
    adm = _entrar(c, "jeff@mayacorp.com.br", "Maya@2026xx")
    r = c.post("/api/admin/clientes", headers=adm, json={"nome": "Escritorio Para Apagar", "admin_email": "x@apagar.adv.br",
                                                         "dominios": [], "dias_teste": 5})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert c.delete(f"/api/admin/clientes/{cid}", headers=adm, params={"confirmar": "errado"}).status_code == 400
    r = c.delete(f"/api/admin/clientes/{cid}", headers=adm, params={"confirmar": "escritorio-para-apagar"})
    assert r.status_code == 200, r.text
    assert c.get(f"/api/admin/clientes/{cid}", headers=adm).status_code == 404
    # o e-mail ficou livre no catálogo
    from app.controle import service
    assert service.chaves_em_uso(["x@apagar.adv.br"], exceto_slug="silva") == []

    # plano com cliente não sai; modelo e solicitação saem
    planos = c.get("/api/admin/planos", headers=adm).json()
    usado = next(p for p in planos if p["nome"] == "Pro")
    assert c.delete(f"/api/admin/planos/{usado['id']}", headers=adm).status_code == 409
    m = c.post("/api/admin/modelos-contrato", headers=adm, json={"nome": "Modelo descartável", "corpo": "x" * 30}).json()
    assert c.delete(f"/api/admin/modelos-contrato/{m['id']}", headers=adm).status_code == 200
    c.post("/api/public/cadastro", json={"nome": "Spam Ltda", "responsavel": "Fulano Spam", "email": "s@spam.com",
                                         "telefone": "11999990000", "aceite": True}, headers={"x-forwarded-for": "10.7.7.7"})
    sid = next(s["id"] for s in c.get("/api/admin/solicitacoes", headers=adm).json() if s["nome"] == "Spam Ltda")
    assert c.delete(f"/api/admin/solicitacoes/{sid}", headers=adm).status_code == 200

    # profissional: sem histórico sai de vez; consigo mesmo, não
    ana = _entrar(c, "ana@silva.adv.br", "Silva@2026x")
    u = c.post("/api/config/usuarios", headers=ana, json={"nome": "Engano Silva", "email": "engano@silva.adv.br",
                                                          "acesso_sistema": False}).json()
    r = c.delete(f"/api/config/usuarios/{u['id']}", headers=ana, params={"definitivo": True})
    assert r.status_code == 200, r.text
    eu = c.get("/api/auth/me", headers=ana).json()
    assert c.delete(f"/api/config/usuarios/{eu['id']}", headers=ana, params={"definitivo": True}).status_code == 400


def test_inicio_sem_financeiro(cliente):  # noqa: F811
    """A tela inicial mostra o dia de trabalho (tarefas, casos, o que está parado), sem nenhum valor em dinheiro."""
    import json

    h = _login(cliente)
    r = cliente.get("/api/hub/inicio", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(d) == {"data", "tarefas", "numeros", "pendencias", "lotes"}
    assert {"abertas", "hoje", "atrasadas", "semana", "proximas"} <= set(d["tarefas"])
    assert all(isinstance(n["valor"], int) for n in d["numeros"]) and any(n["rotulo"] == "Casos em andamento" for n in d["numeros"])
    texto = json.dumps(d).lower()
    for proibido in ("valor_total", "faturado", "iss", "r$", "receita"):
        assert proibido not in texto, proibido
    v = _login(cliente, "visualizador@cfme.com.br")
    assert cliente.get("/api/hub/inicio", headers=v).status_code == 200
