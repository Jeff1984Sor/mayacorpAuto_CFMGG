"""Cadastro único de pessoas: documento, vínculo 1:1 com o cliente, advogados e OAB, busca, duplicados e mescla.

O banco é o mesmo da suíte inteira: documentos próprios (CNPJ de raiz 7062xxxx, CPF de base 7062xxxxx).
"""

from sqlalchemy import delete, func, select, update

from app.core import documentos
from app.core.db import SessionLocal
from app.core.models import Tenant
from app.modules.pessoas import service
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais.models import Pessoa
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_perfis import _usuario_com_perfil


def _cpf(base: int) -> str:
    c = f"{base:09d}"
    for _ in range(2):
        resto = sum(int(d) * p for d, p in zip(c, range(len(c) + 1, 1, -1), strict=True)) % 11
        c += str(0 if resto < 2 else 11 - resto)
    return c


def _pessoa(c, h, esperado=201, **corpo) -> dict:
    r = c.post("/api/pessoas", json={"tipo_pessoa": "sem_documento", **corpo}, headers=h)
    assert r.status_code == esperado, r.text
    return r.json()


def _cliente(c, h, nome: str, doc: str | None, tipo: str = "PJ") -> dict:
    r = c.post("/api/nfse/tomadores", json={"tipo": tipo, "nome": nome, "cpf_cnpj": doc}, headers=h)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _cliente_antigo_sem_pessoa(cliente_id: int, apagar_pessoa: bool = True) -> None:
    """Deixa o cliente como nos bancos anteriores à migração: sem a sua Pessoa (direto na tabela, sem passar pelo
    gancho que cria a Pessoa a cada gravação do cliente)."""
    with SessionLocal() as db:
        pessoa_id = db.scalar(select(Tomador.pessoa_id).where(Tomador.id == cliente_id))
        db.execute(update(Tomador).where(Tomador.id == cliente_id).values(pessoa_id=None))
        if apagar_pessoa and pessoa_id:
            db.execute(delete(Pessoa).where(Pessoa.id == pessoa_id))
        db.commit()


def test_validadores_de_documento_e_oab():
    assert documentos.cpf_valido("529.982.247-25") and documentos.cpf_valido(_cpf(706200001))
    assert not documentos.cpf_valido("529.982.247-26") and not documentos.cpf_valido("111.111.111-11")
    assert documentos.cnpj_valido("11.444.777/0001-61") and not documentos.cnpj_valido("11.444.777/0001-62")
    assert not documentos.cnpj_valido("00.000.000/0000-00")
    assert service.normalizar_oab("123.456") == "123456" and service.normalizar_oab("123456a") == "123456-A"
    assert service.normalizar_oab("0012345") == "12345" and service.exibir_oab("123456-A", "SP") == "OAB/SP 123.456-A"
    for ruim in ("", "abc", "12345678", "0", "12-AB"):
        try:
            service.normalizar_oab(ruim)
        except service.RegraPessoa:
            continue
        raise AssertionError(ruim)
    for texto in ("123456/SP", "123.456-SP", "SP 123456", "SP123456", "OAB/SP 123.456", "oab sp 123456"):
        assert service.ler_oab(texto) == ("123456", "SP"), texto
    assert service.ler_oab("OAB/RJ 98.765-A") == ("98765-A", "RJ") and service.ler_oab("98765-A/RJ") == ("98765-A", "RJ")
    assert service.ler_oab("Fulano de Tal") is None and service.ler_oab("123456/XX") is None


def test_pessoa_nao_duplica_por_documento(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    cpf = _cpf(706200010)
    r = c.post("/api/pessoas", json={"tipo_pessoa": "fisica", "nome": "Maria Única"}, headers=h)
    assert r.status_code == 400 and "CPF" in r.json()["detail"]
    r = c.post("/api/pessoas", json={"tipo_pessoa": "fisica", "nome": "Maria Única", "cpf_cnpj": "111.111.111-11"}, headers=h)
    assert r.status_code == 400 and "CPF inválido" in r.json()["detail"]
    p = _pessoa(c, h, tipo_pessoa="fisica", nome="Maria Única da Sílva", cpf_cnpj=documentos.formatar_documento(cpf),
                estado_civil="casado", enderecos=[{"tipo": "residencial", "cidade": "Campinas", "uf": "sp", "cep": "13010-000"}],
                contatos=[{"tipo": "whatsapp", "valor": "19999990000"}])
    assert p["cpf_cnpj"] == cpf and p["documento_formatado"] == documentos.formatar_documento(cpf)
    assert p["eh_cliente"] is False and p["cliente_id"] is None and p["ja_existia"] is False
    assert p["enderecos"][0]["principal"] is True and p["enderecos"][0]["uf"] == "SP" and p["cidade"] == "Campinas"
    # o mesmo CPF de novo (com outro nome): devolve a que já existe, não cria
    de_novo = _pessoa(c, h, esperado=200, tipo_pessoa="fisica", nome="Maria Outra", cpf_cnpj=cpf)
    assert de_novo["id"] == p["id"] and de_novo["ja_existia"] is True and de_novo["nome"] == "Maria Única da Sílva"
    # busca: nome sem acento e em qualquer caixa, documento com e sem máscara
    for q in ("maria unica", "ÚNICA DA SILVA", cpf, documentos.formatar_documento(cpf), cpf[:6]):
        assert p["id"] in [x["id"] for x in c.get("/api/pessoas/buscar", params={"q": q}, headers=h).json()], q
    lista = c.get("/api/pessoas", params={"cidade": "campinas", "uf": "SP", "eh_cliente": False}, headers=h).json()
    assert p["id"] in [x["id"] for x in lista["itens"]] and lista["total"] >= 1
    # outra pessoa não pode pegar o mesmo documento
    outra = _pessoa(c, h, nome="Sem Documento Ainda")
    r = c.put(f"/api/pessoas/{outra['id']}", json={"tipo_pessoa": "fisica", "nome": "Sem Documento Ainda", "cpf_cnpj": cpf}, headers=h)
    assert r.status_code == 409 and "Maria Única" in r.json()["detail"]
    # sem uso nenhum: excluir apaga de verdade
    assert c.delete(f"/api/pessoas/{outra['id']}", headers=h).json()["mensagem"] == "Pessoa excluída."
    assert c.get(f"/api/pessoas/{outra['id']}", headers=h).status_code == 404


def test_cliente_e_pessoa_vinculo_um_para_um(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    cnpj = _cnpj(70620001)
    cli = _cliente(c, h, "Banco Vínculo S.A.", cnpj)
    assert cli["pessoa_id"]
    p = c.get(f"/api/pessoas/{cli['pessoa_id']}", headers=h).json()
    assert (p["nome"], p["cpf_cnpj"], p["tipo_pessoa"]) == ("Banco Vínculo S.A.", cnpj, "juridica")
    assert p["eh_cliente"] is True and p["cliente_id"] == cli["id"]
    # todo cliente do banco tem pessoa, e nenhuma pessoa é de dois clientes
    c.get("/api/nfse/tomadores", headers=h)
    with SessionLocal() as db:
        for t in db.scalars(select(Tomador).where(Tomador.pessoa_id.is_(None))):
            service.garantir_pessoa_do_cliente(db, t)
        db.commit()
        assert db.scalar(select(func.count()).select_from(Tomador).where(Tomador.pessoa_id.is_(None))) == 0
        total, distintas = db.execute(select(func.count(Tomador.pessoa_id), func.count(func.distinct(Tomador.pessoa_id)))).one()
        assert total == distintas
    # nome, documento e tipo vão do cliente para a pessoa
    novo_cnpj = _cnpj(70620002)
    r = c.put(f"/api/nfse/tomadores/{cli['id']}", json={"tipo": "PJ", "nome": "Banco Vínculo Renomeado", "cpf_cnpj": novo_cnpj}, headers=h)
    assert r.status_code == 200 and r.json()["pessoa_id"] == cli["pessoa_id"]
    p = c.get(f"/api/pessoas/{cli['pessoa_id']}", headers=h).json()
    assert (p["nome"], p["cpf_cnpj"]) == ("Banco Vínculo Renomeado", novo_cnpj)
    assert p["id"] in [x["id"] for x in c.get("/api/pessoas/buscar", params={"q": "vinculo renomeado"}, headers=h).json()]
    # pela tela de pessoas, o que é do cliente não muda (o resto, sim) e a pessoa não é desativada nem excluída
    corpo = {"tipo_pessoa": "juridica", "nome": "Outro Nome", "cpf_cnpj": novo_cnpj}
    r = c.put(f"/api/pessoas/{p['id']}", json=corpo, headers=h)
    assert r.status_code == 400 and f"cliente nº {cli['id']}" in r.json()["detail"]
    r = c.put(f"/api/pessoas/{p['id']}", json={**corpo, "nome": "Banco Vínculo Renomeado", "nome_fantasia": "BV"}, headers=h)
    assert r.status_code == 200 and r.json()["nome_fantasia"] == "BV" and r.json()["cliente_id"] == cli["id"]
    assert c.delete(f"/api/pessoas/{p['id']}", headers=h).status_code == 400
    lista = c.get("/api/pessoas", params={"q": "vinculo renomeado", "eh_cliente": True}, headers=h).json()
    assert [(x["id"], x["cliente_id"]) for x in lista["itens"]] == [(p["id"], cli["id"])]


def test_reaproveita_a_pessoa_pelo_documento(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    # a parte já estava no cadastro de pessoas; ao virar cliente, o cliente é ligado a ela (não nasce outra)
    cnpj = _cnpj(70620003)
    parte = _pessoa(c, h, tipo_pessoa="juridica", nome="Seguradora Reaproveitada", cpf_cnpj=cnpj, nome_fantasia="SegRe")
    cli = _cliente(c, h, "Seguradora Reaproveitada Ltda", cnpj)
    assert cli["pessoa_id"] == parte["id"]
    p = c.get(f"/api/pessoas/{parte['id']}", headers=h).json()
    assert p["cliente_id"] == cli["id"] and p["nome"] == "Seguradora Reaproveitada Ltda" and p["nome_fantasia"] == "SegRe"
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Pessoa).where(Pessoa.cnpj == cnpj)) == 1
    # cadastrar pessoa (ou parte) com o documento de um cliente devolve a pessoa do cliente
    de_novo = _pessoa(c, h, esperado=200, tipo_pessoa="juridica", nome="Qualquer Nome", cpf_cnpj=cnpj)
    assert de_novo["id"] == parte["id"] and de_novo["ja_existia"] and de_novo["cliente_id"] == cli["id"]
    # cliente sem documento ganha a sua própria pessoa, mesmo com nome igual ao de outra
    homonimo = _pessoa(c, h, nome="Homônimo Sem Documento")
    sem_doc = _cliente(c, h, "Homônimo Sem Documento", None, tipo="PF")
    assert sem_doc["pessoa_id"] and sem_doc["pessoa_id"] != homonimo["id"]


def test_advogados_e_oab(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    soc = _pessoa(c, h, tipo_pessoa="juridica", nome="Souza & Lima Advogados", cpf_cnpj=_cnpj(70620004))
    adv = _pessoa(c, h, tipo_pessoa="fisica", nome="Dr. Carlos Souza Oabê", advogado={
        "sociedade_id": soc["id"], "oabs": [{"numero": "706.201", "uf": "sp"}, {"numero": "70620-a", "uf": "RJ", "tipo_inscricao": "suplementar"}]})
    assert adv["eh_advogado"] and adv["oabs"] == ["OAB/SP 706.201", "OAB/RJ 70.620-A"]
    assert adv["advogado"]["sociedade_nome"] == "Souza & Lima Advogados" and adv["advogado"]["oabs"][0]["principal"] is True
    for q in ("706201/SP", "OAB/SP 706.201", "706201", "carlos souza oabe", "70620-A/RJ"):
        achados = c.get("/api/advogados/buscar", params={"q": q}, headers=h).json()
        assert [a["pessoa_id"] for a in achados] == [adv["id"]], q
    assert c.get("/api/advogados/buscar", params={"q": "706201/MG"}, headers=h).json() == []
    # a mesma OAB não entra em outro advogado
    r = c.post("/api/pessoas", json={"tipo_pessoa": "fisica", "nome": "Outro Advogado", "advogado": {
        "oabs": [{"numero": "706201", "uf": "SP"}]}}, headers=h)
    assert r.status_code == 409 and "OAB/SP 706.201" in r.json()["detail"]
    r = c.post("/api/pessoas", json={"tipo_pessoa": "fisica", "nome": "Outro Advogado", "advogado": {
        "oabs": [{"numero": "1", "uf": "ZZ"}]}}, headers=h)
    assert r.status_code == 400 and "UF" in r.json()["detail"]
    r = c.post("/api/pessoas", json={"tipo_pessoa": "juridica", "nome": "Escritório PJ", "cpf_cnpj": _cnpj(70620005),
                                     "advogado": {"oabs": []}}, headers=h)
    assert r.status_code == 400 and "pessoa física" in r.json()["detail"]
    # cadastro rápido (nome + OAB): reaproveita quem já tem a OAB
    r = c.post("/api/advogados", json={"nome": "Carlos S.", "oab_numero": "706201", "oab_uf": "SP"}, headers=h)
    assert r.status_code == 200 and r.json()["ja_existia"] and r.json()["pessoa_id"] == adv["id"]
    r = c.post("/api/advogados", json={"nome": "Dra. Ana Rápida", "oab_numero": "706.202", "oab_uf": "SP", "sociedade_id": soc["id"]}, headers=h)
    assert r.status_code == 201 and r.json()["oabs"][0]["exibicao"] == "OAB/SP 706.202" and r.json()["sociedade_nome"]
    # alterar a pessoa sem mandar o bloco não mexe nos dados de advogado
    r = c.put(f"/api/pessoas/{adv['id']}", json={"tipo_pessoa": "fisica", "nome": "Dr. Carlos Souza Oabê", "profissao": "Advogado"}, headers=h)
    assert r.status_code == 200 and len(r.json()["advogado"]["oabs"]) == 2


def test_duplicados_e_mescla(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    a = _pessoa(c, h, nome="Joaquim Duplicado Pereira Netto", telefones=["1133330000"])
    b = _pessoa(c, h, nome="Joaquim Duplicado Pereira Neto", email="joaquim@duplicado.com.br", telefones=["11999990000"])
    _pessoa(c, h, nome="Fernanda Bem Diferente")
    dups = c.get(f"/api/pessoas/{a['id']}/duplicados", headers=h).json()
    assert [(d["id"], d["motivo"]) for d in dups] == [(b["id"], "Nome parecido")] and dups[0]["semelhanca"] >= 0.8
    # só administrador mescla
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    ho = _usuario_com_perfil(c, h, "operador.pessoas@cfme.com.br", perfis["Operador"]["id"])[1]
    assert c.post(f"/api/pessoas/{a['id']}/mesclar", json={"duplicada_id": b["id"]}, headers=ho).status_code == 403
    assert c.get("/api/pessoas", headers=ho).status_code == 200 and c.delete(f"/api/pessoas/{b['id']}", headers=ho).status_code == 200
    b = _pessoa(c, h, nome="Joaquim Duplicado Pereira Neto", email="joaquim@duplicado.com.br", telefones=["11999990000"])
    r = c.post(f"/api/pessoas/{a['id']}/mesclar", json={"duplicada_id": b["id"]}, headers=h)
    assert r.status_code == 200, r.text
    fim = r.json()
    assert fim["id"] == a["id"] and fim["email"] == "joaquim@duplicado.com.br" and fim["telefones"] == ["1133330000", "11999990000"]
    velha = c.get(f"/api/pessoas/{b['id']}", headers=h).json()
    assert velha["ativo"] is False and velha["mesclada_em_id"] == a["id"]
    assert b["id"] not in [x["id"] for x in c.get("/api/pessoas/buscar", params={"q": "joaquim duplicado"}, headers=h).json()]
    assert c.post(f"/api/pessoas/{a['id']}/mesclar", json={"duplicada_id": b["id"]}, headers=h).status_code == 400  # já mesclada
    aud = c.get("/api/auditoria", params={"acao": "pessoa.mesclar"}, headers=h)
    assert aud.status_code == 200 and "Joaquim Duplicado Pereira Neto" in aud.text


def test_mescla_com_cliente(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    cli1 = _cliente(c, h, "Construtora Mescla Um", _cnpj(70620006))
    cli2 = _cliente(c, h, "Construtora Mescla Dois", _cnpj(70620007))
    # duas pessoas de clientes diferentes nunca se mesclam
    r = c.post(f"/api/pessoas/{cli1['pessoa_id']}/mesclar", json={"duplicada_id": cli2["pessoa_id"]}, headers=h)
    assert r.status_code == 400 and "clientes diferentes" in r.json()["detail"]
    assert f"nº {cli1['id']}" in r.json()["detail"] and f"nº {cli2['id']}" in r.json()["detail"]
    # se uma das duas é de cliente, é ela que fica (mesmo pedindo o contrário) e continua ligada ao cliente
    avulsa = _pessoa(c, h, nome="Construtora Mescla Um Ltda", nome_fantasia="CMU")
    r = c.post(f"/api/pessoas/{avulsa['id']}/mesclar", json={"duplicada_id": cli1["pessoa_id"]}, headers=h)
    assert r.status_code == 200, r.text
    fim = r.json()
    assert fim["id"] == cli1["pessoa_id"] and fim["cliente_id"] == cli1["id"] and fim["ativo"] and fim["nome_fantasia"] == "CMU"
    assert fim["nome"] == "Construtora Mescla Um"
    assert c.get(f"/api/pessoas/{avulsa['id']}", headers=h).json()["ativo"] is False
    assert c.get(f"/api/nfse/tomadores/{cli1['id']}", headers=h).json()["pessoa_id"] == cli1["pessoa_id"]
    # documentos diferentes: não são a mesma pessoa
    x = _pessoa(c, h, tipo_pessoa="fisica", nome="Pedro Documento Um", cpf_cnpj=_cpf(706200021))
    y = _pessoa(c, h, tipo_pessoa="fisica", nome="Pedro Documento Dois", cpf_cnpj=_cpf(706200022))
    r = c.post(f"/api/pessoas/{x['id']}/mesclar", json={"duplicada_id": y["id"]}, headers=h)
    assert r.status_code == 400 and "diferentes" in r.json()["detail"]


def test_isolamento_entre_escritorios(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    cpf = _cpf(706200030)
    with SessionLocal() as db:
        outro = db.scalar(select(Tenant).where(Tenant.slug == "outro-7062")) or Tenant(slug="outro-7062", nome="Outro Escritório")
        db.add(outro)
        db.flush()
        de_fora = Pessoa(tenant_id=outro.id, tipo_pessoa="fisica", nome="Pessoa de Outro Escritório",
                         nome_normalizado=service.normalizar_nome("Pessoa de Outro Escritório"), cpf=cpf, telefones=[], enderecos=[],
                         outros_documentos=[])
        db.add(de_fora)
        db.commit()
        de_fora_id, meu_tenant = de_fora.id, db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        assert service.por_documento(db, meu_tenant, cpf) is None and service.por_documento(db, outro.id, cpf).id == de_fora_id
    for q in ("outro escritorio", cpf):
        assert c.get("/api/pessoas/buscar", params={"q": q}, headers=h).json() == []
    assert c.get(f"/api/pessoas/{de_fora_id}", headers=h).status_code == 404
    assert de_fora_id not in [x["id"] for x in c.get("/api/pessoas", params={"q": "outro escritorio"}, headers=h).json()["itens"]]
    # o mesmo documento pode existir nos dois escritórios
    minha = _pessoa(c, h, tipo_pessoa="fisica", nome="Mesma Pessoa Aqui", cpf_cnpj=cpf)
    assert minha["id"] != de_fora_id and minha["ja_existia"] is False
    assert c.post(f"/api/pessoas/{minha['id']}/mesclar", json={"duplicada_id": de_fora_id}, headers=h).status_code == 404


def test_documento_de_cliente_sem_pessoa_nao_cria_pessoa_solta(cliente):  # noqa: F811
    """Cliente que ainda não tem a sua Pessoa (banco antigo): cadastrar pessoa com o documento dele cria ou liga a
    Pessoa DELE. O cliente é uma parte cadastrada uma vez só."""
    c, h = cliente, _login(cliente)

    def do_cliente(cliente_id: int, doc: str) -> tuple[int | None, int]:
        with SessionLocal() as db:
            coluna = Pessoa.cnpj if len(doc) == 14 else Pessoa.cpf
            return db.get(Tomador, cliente_id).pessoa_id, db.scalar(select(func.count()).select_from(Pessoa).where(coluna == doc))

    # 1. cadastro de pessoa (o mesmo usado no cadastro rápido das partes): a Pessoa nasce já como a do cliente
    cnpj = _cnpj(70620020)
    cli = _cliente(c, h, "Cliente Antigo Um 7062 Ltda", cnpj)
    _cliente_antigo_sem_pessoa(cli["id"])
    assert do_cliente(cli["id"], cnpj) == (None, 0)
    p = _pessoa(c, h, esperado=200, tipo_pessoa="juridica", nome="Nome Digitado na Parte", cpf_cnpj=cnpj)
    assert p["ja_existia"] and p["cliente_id"] == cli["id"] and p["eh_cliente"] and p["nome"] == "Cliente Antigo Um 7062 Ltda"
    assert do_cliente(cli["id"], cnpj) == (p["id"], 1)
    de_novo = _pessoa(c, h, esperado=200, tipo_pessoa="juridica", nome="Outra Vez", cpf_cnpj=cnpj)
    assert de_novo["id"] == p["id"] and do_cliente(cli["id"], cnpj) == (p["id"], 1)

    # 2. já havia uma pessoa solta com o documento: ela passa a ser a do cliente (não nasce outra)
    cnpj2 = _cnpj(70620021)
    cli2 = _cliente(c, h, "Cliente Antigo Dois 7062 Ltda", cnpj2)
    _cliente_antigo_sem_pessoa(cli2["id"], apagar_pessoa=False)
    solta = c.get(f"/api/pessoas/{cli2['pessoa_id']}", headers=h).json()
    assert solta["cliente_id"] is None and solta["cpf_cnpj"] == cnpj2
    p2 = _pessoa(c, h, esperado=200, tipo_pessoa="juridica", nome="Qualquer", cpf_cnpj=cnpj2)
    assert p2["id"] == solta["id"] and p2["cliente_id"] == cli2["id"]
    assert do_cliente(cli2["id"], cnpj2) == (solta["id"], 1)

    # 3. pessoa sem documento que recebe, na alteração, o CPF de um cliente sem Pessoa: vira a Pessoa dele
    cpf = _cpf(706200220)
    cli3 = _cliente(c, h, "Cliente Antigo Três 7062", cpf, tipo="PF")
    _cliente_antigo_sem_pessoa(cli3["id"])
    sem = _pessoa(c, h, nome="Cliente Antigo Tres 7062")
    r = c.put(f"/api/pessoas/{sem['id']}", json={"tipo_pessoa": "fisica", "nome": "Cliente Antigo Tres 7062", "cpf_cnpj": cpf}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["cliente_id"] == cli3["id"] and r.json()["nome"] == "Cliente Antigo Três 7062"  # o nome é o do cliente
    assert do_cliente(cli3["id"], cpf) == (sem["id"], 1)
    # a procura que só consulta (capa do tribunal) não cria nada
    cnpj4 = _cnpj(70620023)
    cli4 = _cliente(c, h, "Cliente Antigo Quatro 7062 Ltda", cnpj4)
    _cliente_antigo_sem_pessoa(cli4["id"])
    with SessionLocal() as db:
        assert service.por_documento(db, db.get(Tomador, cli4["id"]).tenant_id, cnpj4) is None
        db.commit()
    assert do_cliente(cli4["id"], cnpj4) == (None, 0)
