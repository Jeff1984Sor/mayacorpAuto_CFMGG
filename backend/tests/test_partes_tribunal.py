"""Capa do tribunal na ficha do caso: campos do contencioso, classe e assuntos nas listas e as partes do processo no
cadastro único (pessoas, envolvimentos e advogados), sem duplicar e sem desfazer o que o usuário ajustou.

Nenhum teste fala com tribunal: o DataJud e o DJEN são trocados por funções locais, como em test_tribunais.py.
O banco é o mesmo da suíte inteira: documentos e números próprios (raiz 7065xxxx).
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.core.models import Tenant
from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento import partes_tribunal
from app.modules.faturamento.models import Caso
from app.modules.faturamento.tipos_caso import CasoContencioso, Envolvimento, EnvolvimentoAdvogado, ListaItem
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais import cnj, fontes, jobs, service
from app.modules.tribunais.models import Pessoa, Processo
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_perfis import _usuario_com_perfil
from tests.test_tribunais import _datajud, _djen, _preparar_advogado

CPF_DEVEDOR, CPF_UPGRADE = "70650000191", "70650000272"


def _numero(seq: int, j: int = 5, tr: str = "15", origem: str = "0001") -> str:
    return cnj.formatar(cnj.montar(7065000 + seq, 2025, j, tr, origem))


@pytest.fixture
def trib(cliente, monkeypatch):  # noqa: F811
    """Fila síncrona, DataJud e DJEN falsos (o DJEN só é consultado com o proxy configurado)."""
    monkeypatch.setattr(jobs, "disparar", lambda: jobs.rodar_fila())
    datajud: dict[str, list] = {}
    djen: dict[str, list] = {}
    monkeypatch.setattr(fontes, "datajud_buscar", lambda base, chave, alias, numero, intervalo=0: fontes.datajud_processo(
        datajud.get(cnj.so_digitos(numero), [])))
    monkeypatch.setattr(fontes, "djen_por_processo", lambda base, numero, max_paginas=10: [
        x for x in (fontes.djen_item(i) for i in djen.get(cnj.so_digitos(numero), [])) if x])
    with SessionLocal() as db:
        service.plataforma(db).djen_proxy_url = "https://proxy-br.exemplo/s/api/v1"
        db.commit()
    yield {"datajud": datajud, "djen": djen}
    with SessionLocal() as db:
        service.plataforma(db).djen_proxy_url = None
        db.commit()


def _cliente_e_contrato(c, h, nome: str, raiz: int) -> tuple[dict, dict]:
    r = c.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": nome, "cpf_cnpj": _cnpj(raiz)})
    assert r.status_code in (200, 201), r.text
    k = c.post("/api/faturamento/contratos", headers=h, json={"tomador_id": r.json()["id"], "nome": "Contencioso"})
    assert k.status_code == 201, k.text
    return r.json(), k.json()


def _processo_no_tribunal(trib, numero: str, autor: str, reu: str, classe: str | None = None, assuntos: list | None = None,
                          outros: list[str] = (), adversario: tuple[str, str] | None = ("DR CONTRARIO 7065", "706501")) -> None:
    """Um processo que o DataJud (capa) e o DJEN (partes e advogados, sem dizer de quem) conhecem."""
    dj = _datajud(numero)
    dj[0]["_source"]["orgaoJulgador"]["nome"] = "2ª Vara do Trabalho de Campinas"
    if classe:
        dj[0]["_source"]["classe"] = {"codigo": 99065, "nome": classe}
    if assuntos is not None:
        dj[0]["_source"]["assuntos"] = assuntos
    com = _djen(numero, autor, reu, texto="Cite-se.")
    com["destinatarios"] += [{"nome": n, "polo": "O"} for n in outros]
    if adversario:
        com["destinatarioadvogados"].append({"advogado": {"nome": adversario[0], "numero_oab": adversario[1], "uf_oab": "SP"}})
    trib["datajud"][cnj.so_digitos(numero)] = dj
    trib["djen"][cnj.so_digitos(numero)] = [com]


def _partes(c, h, caso_id: int, inativos: bool = False) -> dict[str, list[dict]]:
    r = c.get(f"/api/faturamento/casos/{caso_id}/envolvimentos", params={"inativos": inativos}, headers=h)
    assert r.status_code == 200, r.text
    return {b["nome"]: b["envolvimentos"] for b in r.json()["categorias"]}


def _trazer(c, h, caso_id: int, esperado: int = 200) -> dict:
    r = c.post(f"/api/faturamento/casos/{caso_id}/partes-do-tribunal", headers=h)
    assert r.status_code == esperado, r.text
    return r.json()


def _contagens(db) -> list[int]:
    return [db.scalar(select(func.count()).select_from(m)) for m in (Pessoa, Envolvimento, EnvolvimentoAdvogado, Advogado, AdvogadoOab)]


def test_capa_devolve_os_campos_novos_sem_gravar(cliente, trib):  # noqa: F811
    c, h = cliente, _login(cliente)
    cli, contrato = _cliente_e_contrato(c, h, "Indústria Capa Nova 7065 Ltda", 70650001)
    itens = {i["nome"]: i["id"] for lista in ("classe", "assunto")
             for i in c.get(f"/api/faturamento/listas?lista={lista}", headers=h).json()}
    n = _numero(1)
    _processo_no_tribunal(trib, n, "Maria Capa 7065", "INDUSTRIA CAPA NOVA 7065 LTDA",
                          assuntos=[{"codigo": 2086, "nome": "Horas Extras"}, {"codigo": 706599, "nome": "Assunto Só da Capa 7065"}])
    with SessionLocal() as db:
        antes = (_contagens(db), db.scalar(select(func.count()).select_from(ListaItem)))
    r = c.get(f"/api/tribunais/capa?numero={n}&contrato_id={contrato['id']}", headers=h)
    assert r.status_code == 200, r.text
    capa = r.json()
    # o que a tela atual já usava continua igual
    assert capa["tribunal"] == "TRT15" and capa["tipo"] == "judicial_trabalhista" and capa["comarca"] == "Campinas"
    assert capa["classe"] == "Ação Trabalhista - Rito Ordinário" and capa["assuntos"] == ["Horas Extras", "Assunto Só da Capa 7065"]
    assert capa["polo"] == "passivo" and capa["parte_contraria"] == "Maria Capa 7065"
    # campos novos do contencioso: só o que a fonte pública informa
    assert (capa["justica"], capa["uf"], capa["codigo_orgao"], capa["sistema_tribunal"]) == ("trabalho", "SP", "0001", "pje")
    assert capa["segredo_justica"] is False and capa["fonte_partes"] == "djen" and capa["fase_processual"] is None
    assert capa["juiz_relator"] is None and capa["valor_causa"] is None and capa["justica_gratuita"] is None  # só com certificado
    assert capa["classe_detalhe"] == {"codigo": 985, "nome": "Ação Trabalhista - Rito Ordinário",
                                      "item_id": itens["Ação Trabalhista - Rito Ordinário"]}
    assert capa["assuntos_detalhe"] == [
        {"codigo": 2086, "nome": "Horas Extras", "principal": True, "item_id": itens["Horas Extras"]},
        {"codigo": 706599, "nome": "Assunto Só da Capa 7065", "principal": False, "item_id": None}]
    autora, re_ = capa["partes"]
    assert (autora["nome"], autora["polo"], autora["pessoa_id"], autora["cliente_do_caso"]) == ("Maria Capa 7065", "ativo", None, False)
    assert autora["documento"] is None and autora["tipo_participacao"] is None and autora["advogados"] == []  # o DJEN não informa
    with SessionLocal() as db:
        pessoa_cliente = db.get(Tomador, cli["id"]).pessoa_id
        assert (_contagens(db), db.scalar(select(func.count()).select_from(ListaItem))) == antes  # consulta: nada foi gravado
    assert (re_["pessoa_id"], re_["cliente_id"], re_["cliente_do_caso"], re_["pessoa_criterio"]) == (pessoa_cliente, cli["id"], True, "nome")
    assert capa["advogados"] == [{"nome": "ADVOGADA TESTE", "oab_numero": "123456", "oab_uf": "SP", "advogado_id": capa["advogados"][0]["advogado_id"]},
                                 {"nome": "DR CONTRARIO 7065", "oab_numero": "706501", "oab_uf": "SP", "advogado_id": capa["advogados"][1]["advogado_id"]}]


def test_importacao_cria_partes_preenche_ficha_e_nao_duplica(cliente, trib):  # noqa: F811
    c, h = cliente, _login(cliente)
    eu = _preparar_advogado(c, h)  # OAB 123456/SP: é o advogado do escritório entre os do DJEN
    cli, contrato = _cliente_e_contrato(c, h, "Metalúrgica Partes 7065 Ltda", 70650002)
    n = _numero(2)
    _processo_no_tribunal(trib, n, "João Partes 7065", "METALURGICA PARTES 7065 LTDA", outros=["Perito Partes 7065"])
    # caso salvo só com o número: o cliente entra como parte sem polo conhecido e o tribunal é buscado por trás
    r = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={
        "titulo": "Reclamação 7065", "numero_processo": n, "responsavel_id": eu["usuario_id"]})
    assert r.status_code == 201, r.text
    caso_id = r.json()["id"]
    ficha = c.get(f"/api/faturamento/casos/{caso_id}", headers=h).json()
    blocos = _partes(c, h, caso_id)
    with SessionLocal() as db:
        pessoa_cliente = db.get(Tomador, cli["id"]).pessoa_id
        assert db.scalar(select(func.count()).select_from(Envolvimento).where(Envolvimento.caso_id == caso_id, Envolvimento.eh_cliente)) == 1
    # polos certos; o cliente é a MESMA parte (uma só, a pessoa do cadastro de clientes), agora no polo que o processo diz
    assert [(e["pessoa"]["nome"], e["eh_cliente"], e["pessoa_id"], e["pendente_reclassificacao"]) for e in blocos["Polo Passivo"]] == [
        ("Metalúrgica Partes 7065 Ltda", True, pessoa_cliente, False)]
    assert [(e["pessoa"]["nome"], e["eh_cliente"]) for e in blocos["Polo Ativo"]] == [("João Partes 7065", False)]
    assert [e["pessoa"]["nome"] for e in blocos["Outros"]] == ["Perito Partes 7065"] and blocos["Terceiros"] == []
    assert ficha["polo"] == "passivo" and ficha["partes_resumo"] == "João Partes 7065 x Metalúrgica Partes 7065 Ltda"
    # o DJEN não diz quem cada advogado representa: só o do escritório é ligado (ao cliente)
    assert [(a["nome"], a["oab"], a["eh_interno"]) for a in blocos["Polo Passivo"][0]["advogados"]] == [("ADVOGADA TESTE", "OAB/SP 123.456", True)]
    assert blocos["Polo Ativo"][0]["advogados"] == []
    # ficha do contencioso com o que o DataJud informou
    ct = ficha["contencioso"]
    assert (ct["justica"], ct["uf"], ct["codigo_orgao"], ct["sistema_tribunal"]) == ("trabalho", "SP", "0001", "pje")
    assert ct["classe_nome"] == "Ação Trabalhista - Rito Ordinário" and ct["assunto_nome"] == "Horas Extras"
    assert [a["nome"] for a in ct["assuntos_secundarios"]] == ["Verbas Rescisórias"]
    assert ct["segredo_justica"] is False and ct["juiz_relator"] is None and ficha["valor_causa"] is None  # a fonte pública não traz

    # reimportar não duplica nada: o botão devolve tudo como "já existia"
    with SessionLocal() as db:
        antes = _contagens(db)
    res = _trazer(c, h, caso_id)
    assert res["incluidas"] == [] and res["advogados_incluidos"] == [] and res["campos_preenchidos"] == [] and res["fonte"] == "djen"
    assert sorted(x["nome"] for x in res["ja_existiam"]) == ["João Partes 7065", "Metalúrgica Partes 7065 Ltda", "Perito Partes 7065"]
    assert [x["nome"] for x in res["advogados_ja_existiam"]] == ["ADVOGADA TESTE"]
    assert [(x["nome"], x["oab_numero"], x["oab_uf"], x["envolvimento_id"]) for x in res["advogados_sem_parte"]] == [
        ("DR CONTRARIO 7065", "706501", "SP", None)]
    with SessionLocal() as db:
        assert _contagens(db) == antes
        proc = db.scalar(select(Processo).where(Processo.caso_id == caso_id))
        jobs.enfileirar(db, proc.tenant_id, "importar_caso", caso_id)  # o job de importação de novo
        db.commit()
    jobs.rodar_fila()
    with SessionLocal() as db:
        assert _contagens(db) == antes

    # ajuste manual preservado: parte movida com outra qualificação, parte desativada e advogado ligado à mão
    cats = {b["nome"]: b for b in c.get(f"/api/faturamento/casos/{caso_id}/envolvimentos", headers=h).json()["categorias"]}
    joao, perito = blocos["Polo Ativo"][0], blocos["Outros"][0]
    assistente = next(q["id"] for q in cats["Terceiros"]["qualificacoes"] if q["nome"] == "Assistente Simples")
    r = c.post(f"/api/faturamento/casos/{caso_id}/envolvimentos/{joao['id']}/mover", headers=h,
               json={"categoria_id": cats["Terceiros"]["id"], "qualificacao_id": assistente})
    assert r.status_code == 200, r.text
    assert c.delete(f"/api/faturamento/casos/{caso_id}/envolvimentos/{perito['id']}", headers=h).status_code == 200
    r = c.post(f"/api/faturamento/casos/{caso_id}/envolvimentos/{joao['id']}/advogados", headers=h,
               json={"advogado_id": res["advogados_sem_parte"][0]["advogado_id"]})
    assert r.status_code == 201, r.text
    res = _trazer(c, h, caso_id)
    assert res["incluidas"] == [] and res["advogados_incluidos"] == [] and res["advogados_sem_parte"] == []
    assert sorted(x["nome"] for x in res["advogados_ja_existiam"]) == ["ADVOGADA TESTE", "DR CONTRARIO 7065"]
    depois = _partes(c, h, caso_id, inativos=True)
    assert [(e["pessoa"]["nome"], e["qualificacao_nome"]) for e in depois["Terceiros"]] == [("João Partes 7065", "Assistente Simples")]
    assert depois["Polo Ativo"] == [] and [(e["pessoa"]["nome"], e["ativo"]) for e in depois["Outros"]] == [("Perito Partes 7065", False)]
    with SessionLocal() as db:
        assert _contagens(db)[:2] == antes[:2]  # nem pessoa nem parte nova

    # quem só consulta não traz partes; caso de outro tipo não recebe partes do tribunal
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    hv = _usuario_com_perfil(c, h, "visualizador.partes7065@cfme.com.br", perfis["Visualizador"]["id"])[1]
    assert c.post(f"/api/faturamento/casos/{caso_id}/partes-do-tribunal", headers=hv).status_code == 403
    consultivo = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Parecer 7065"}).json()
    assert "contencioso" in _trazer(c, h, consultivo["id"], esperado=400)["detail"]


def test_caso_criado_pelo_processo_e_busca_desligada(cliente, trib):  # noqa: F811
    c, h = cliente, _login(cliente)
    _preparar_advogado(c, h)
    cli, contrato = _cliente_e_contrato(c, h, "Comércio Processo 7065 Ltda", 70650003)
    n = _numero(3)
    _processo_no_tribunal(trib, n, "COMERCIO PROCESSO 7065 LTDA", "Banco Réu 7065 S.A.")
    # processo importado em Tribunais (o DJEN vem pela varredura do advogado) e caso criado a partir dele
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        from app.modules.tribunais import caso as caso_mod

        proc = service.importar(db, tenant_id, n, usuario_id=None, advogado_id=None, encontrado=caso_mod._do_djen(db, n))
        db.commit()
        pid = proc.id
    r = c.post(f"/api/tribunais/processos/{pid}/caso", headers=h, json={"contrato_id": contrato["id"]})
    assert r.status_code == 201, r.text
    caso_id = r.json()["caso_id"]
    blocos = _partes(c, h, caso_id)
    # o nome do cliente bate com a parte autora: é a mesma parte "é cliente" (vínculo só sugerido não cria outra)
    assert [(e["pessoa"]["nome"], e["eh_cliente"], e["pessoa"]["cliente_id"]) for e in blocos["Polo Ativo"]] == [
        ("Comércio Processo 7065 Ltda", True, cli["id"])]
    assert [(e["pessoa"]["nome"], e["eh_cliente"]) for e in blocos["Polo Passivo"]] == [("Banco Réu 7065 S.A.", False)]
    assert c.get(f"/api/faturamento/casos/{caso_id}", headers=h).json()["polo"] == "ativo"

    # busca no tribunal desligada no caso: nada é buscado, nem pelo botão
    n2 = _numero(4)
    _processo_no_tribunal(trib, n2, "Fulano Desligado 7065", "COMERCIO PROCESSO 7065 LTDA")
    r = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={
        "titulo": "Sem busca 7065", "tipo_caso": "contencioso", "numero_processo": n2,
        "contencioso": {"monitorar_andamentos": False}})
    assert r.status_code == 201, r.text
    desligado = r.json()["id"]
    assert "desligada" in _trazer(c, h, desligado, esperado=400)["detail"]
    with SessionLocal() as db:
        assert db.scalar(select(Processo.id).where(Processo.numero_cnj == cnj.so_digitos(n2))) is None
        assert db.scalar(select(func.count()).select_from(Envolvimento).where(Envolvimento.caso_id == desligado)) == 1  # só o cliente


def _mni(nome: str, polo: str, documento: str | None = None, tipo: str | None = None, advogados: list | None = None, **extra) -> dict:
    return {"polo": polo, "tipo_participacao": tipo, "pessoa": {"nome": nome, "documento": documento}, "advogados": advogados or [], **extra}


def _caso_direto(db, tenant_id: int, contrato_id: int, numero: str, **campos) -> Caso:
    c = Caso(tenant_id=tenant_id, numero=(db.scalar(select(func.max(Caso.numero))) or 0) + 1, contrato_id=contrato_id,
             titulo=f"Caso {numero}", numero_processo=numero, data_abertura=date(2025, 3, 1), **campos)
    db.add(c)
    regras_caso.ao_criar(db, c)
    db.flush()
    return c


def _processo_direto(db, tenant_id: int, numero: str, **campos) -> Processo:
    p = Processo(tenant_id=tenant_id, numero_cnj=cnj.so_digitos(numero), numero_formatado=numero,
                 tribunal_id=service.tribunal_do_numero(db, numero).id, prioridades=[], graus=[], numeros_antigos=[],
                 processos_vinculados=[], **{"assuntos": [], **campos})
    db.add(p)
    db.flush()
    return p


def test_pessoa_pelo_documento_e_advogado_pela_oab_em_dois_processos(cliente):  # noqa: F811
    """Partes completas (consulta com certificado): documento, tipo de participação e advogados de cada parte."""
    c, h = cliente, _login(cliente)
    cli, contrato = _cliente_e_contrato(c, h, "Banco Dois Processos 7065 S.A.", 70650004)
    # o devedor já está no cadastro único com o CNPJ
    r = c.post("/api/pessoas", headers=h, json={"tipo_pessoa": "juridica", "nome": "Devedor Comum 7065 Ltda", "cpf_cnpj": _cnpj(70650005)})
    assert r.status_code in (200, 201), r.text
    devedor_id = r.json()["id"]
    adv = [{"nome": "Dra. Defesa 7065", "oab_numero": "706502", "oab_uf": "SP", "recebe_intimacao": True}]
    casos = []
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        for seq in (5, 6):
            n = _numero(seq, j=8, tr="26", origem="0100")
            proc = _processo_direto(db, tenant_id, n)
            service.substituir_partes(db, proc, [
                _mni("BANCO DOIS PROCESSOS 7065 SA", "ativo", cli["cpf_cnpj"], "Exequente"),
                _mni("DEVEDOR COMUM 7065 LTDA", "passivo", _cnpj(70650005), "EXECUTADO", adv),
                _mni("MINISTERIO PUBLICO 7065", "fiscal_lei")], set(), None, fonte="mni")
            caso = _caso_direto(db, tenant_id, contrato["id"], n)
            service.ligar_caso(db, proc, caso)
            casos.append(caso.id)
        db.commit()
        envs = {cid: {e.pessoa_id: e for e in db.scalars(select(Envolvimento).where(Envolvimento.caso_id == cid))} for cid in casos}
        pessoa_cliente = db.get(Tomador, cli["id"]).pessoa_id
        for cid in casos:  # a pessoa do cadastro (pelo documento) e a do cliente, uma vez cada
            assert devedor_id in envs[cid] and pessoa_cliente in envs[cid] and len(envs[cid]) == 3
            assert envs[cid][pessoa_cliente].eh_cliente and sum(e.eh_cliente for e in envs[cid].values()) == 1
        assert db.scalar(select(func.count()).select_from(Pessoa).where(Pessoa.cnpj == _cnpj(70650005))) == 1
        # o mesmo advogado (pela OAB) nos dois processos: um Advogado, uma inscrição, um vínculo por caso
        oabs = db.scalars(select(AdvogadoOab).where(AdvogadoOab.numero == "706502", AdvogadoOab.uf == "SP")).all()
        assert len(oabs) == 1
        ligados = db.scalars(select(EnvolvimentoAdvogado).where(EnvolvimentoAdvogado.advogado_id == oabs[0].advogado_id)).all()
        assert sorted(x.envolvimento_id for x in ligados) == sorted(envs[cid][devedor_id].id for cid in casos)
        assert all(x.principal and x.oab_id == oabs[0].id for x in ligados)
    blocos = _partes(c, h, casos[0])
    assert [(e["pessoa"]["nome"], e["qualificacao_nome"], e["eh_cliente"]) for e in blocos["Polo Ativo"]] == [
        ("Banco Dois Processos 7065 S.A.", "Exequente", True)]
    assert [(e["pessoa"]["nome"], e["qualificacao_nome"], [a["oab"] for a in e["advogados"]]) for e in blocos["Polo Passivo"]] == [
        ("Devedor Comum 7065 Ltda", "Executado", ["OAB/SP 706.502"])]
    assert [(e["pessoa"]["nome"], e["qualificacao_nome"]) for e in blocos["Outros"]] == [
        ("MINISTERIO PUBLICO 7065", "Ministério Público (fiscal da ordem jurídica)")]
    res = _trazer(c, h, casos[0])
    assert res["incluidas"] == [] and res["advogados_incluidos"] == [] and res["fonte"] == "mni" and len(res["ja_existiam"]) == 3
    assert {x["pessoa_criterio"] for x in res["ja_existiam"]} == {"cliente", "documento", "nome"}
    # advogado que o usuário retirou da parte não volta na próxima vez
    devedor = blocos["Polo Passivo"][0]
    r = c.delete(f"/api/faturamento/casos/{casos[0]}/envolvimentos/{devedor['id']}/advogados/{devedor['advogados'][0]['id']}", headers=h)
    assert r.status_code == 200, r.text
    res = _trazer(c, h, casos[0])
    assert res["advogados_incluidos"] == [] and [x["retirado"] for x in res["advogados_ja_existiam"]] == [True]
    assert _partes(c, h, casos[0])["Polo Passivo"][0]["advogados"] == []


def test_parte_do_diario_que_ganha_documento_continua_a_mesma(cliente):  # noqa: F811
    """O DJEN traz só o nome; a consulta com certificado traz depois o CPF: a pessoa e a parte do caso são as mesmas."""
    c, h = cliente, _login(cliente)
    _cli, contrato = _cliente_e_contrato(c, h, "Cliente Upgrade 7065 Ltda", 70650006)
    n = _numero(7, j=8, tr="26", origem="0100")
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        proc = _processo_direto(db, tenant_id, n)
        service.substituir_partes(db, proc, [_mni("CLIENTE UPGRADE 7065 LTDA", "ativo"), _mni("Fulano Upgrade 7065", "passivo")],
                                  set(), None, fonte="djen")
        caso = _caso_direto(db, tenant_id, contrato["id"], n)
        service.ligar_caso(db, proc, caso)
        db.commit()
        antes = _contagens(db)
        fulano = db.scalar(select(Pessoa).where(Pessoa.nome == "Fulano Upgrade 7065"))
        assert fulano.cpf is None
        service.substituir_partes(db, proc, [
            _mni("CLIENTE UPGRADE 7065 LTDA", "ativo", _cnpj(70650006), "Autor"),
            _mni("FULANO UPGRADE 7065", "passivo", CPF_UPGRADE, "Réu", assistencia_judiciaria=True)], set(), None, fonte="mni")
        res = partes_tribunal.do_processo(db, caso, proc)
        db.commit()
        db.refresh(fulano)
        assert fulano.cpf == CPF_UPGRADE and _contagens(db) == antes  # a mesma pessoa, agora com CPF; nenhuma parte nova
        assert res["incluidas"] == [] and len(res["ja_existiam"]) == 2
        # o cliente ainda sem qualificação recebe a do processo; a parte contrária, que já estava no caso, não é alterada
        quem = {x["nome"]: x for x in res["ja_existiam"]}
        assert (quem["Cliente Upgrade 7065 Ltda"]["qualificacao"], quem["Cliente Upgrade 7065 Ltda"]["atualizada"]) == ("Autor", True)
        assert (quem["Fulano Upgrade 7065"]["qualificacao"], quem["Fulano Upgrade 7065"]["atualizada"]) == (None, False)
        assert db.get(CasoContencioso, caso.id).justica_gratuita is False  # a gratuidade é da outra parte, não do cliente


def test_classe_e_assunto_criados_uma_vez_e_reaproveitados(cliente, trib):  # noqa: F811
    c, h = cliente, _login(cliente)
    _cli, contrato = _cliente_e_contrato(c, h, "Cliente Listas 7065 Ltda", 70650007)
    fichas = []
    for seq, classe in ((8, "Classe Inédita do Tribunal 7065"), (9, "CLASSE INEDITA DO TRIBUNAL 7065")):
        n = _numero(seq)
        _processo_no_tribunal(trib, n, "Autor Listas 7065", "Réu Listas 7065", classe=classe, adversario=None,
                              assuntos=[[{"codigo": 706501, "nome": "Assunto Inédito 7065"}], {"codigo": 1855, "nome": "Verbas Rescisórias"}])
        r = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": f"Listas {seq}", "numero_processo": n})
        assert r.status_code == 201, r.text
        fichas.append(c.get(f"/api/faturamento/casos/{r.json()['id']}", headers=h).json()["contencioso"])
    a, b = fichas
    assert a["classe_nome"] == "Classe Inédita do Tribunal 7065" and a["assunto_nome"] == "Assunto Inédito 7065"
    assert (a["classe_id"], a["assunto_id"], a["assuntos_secundarios_ids"]) == (b["classe_id"], b["assunto_id"], b["assuntos_secundarios_ids"])
    assert [x["nome"] for x in a["assuntos_secundarios"]] == ["Verbas Rescisórias"]
    por_nome = {}
    for lista in ("classe", "assunto"):
        for i in c.get(f"/api/faturamento/listas?lista={lista}", headers=h).json():
            por_nome.setdefault((lista, i["nome"].lower()), []).append(i)
    criada = por_nome[("classe", "classe inédita do tribunal 7065")]
    assert len(criada) == 1 and criada[0]["sistema"] is False and criada[0]["id"] == a["classe_id"]  # item do escritório, uma vez só
    assert len(por_nome[("assunto", "assunto inédito 7065")]) == 1 and ("classe", "classe inedita do tribunal 7065") not in por_nome
    do_seed = por_nome[("assunto", "verbas rescisórias")]
    assert len(do_seed) == 1 and do_seed[0]["sistema"] is True and do_seed[0]["id"] == a["assuntos_secundarios_ids"][0]  # reaproveitado


def test_campos_so_sao_preenchidos_quando_vazios(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    _cli, contrato = _cliente_e_contrato(c, h, "Cliente Campos 7065 Ltda", 70650008)
    n_vazio, n_cheio = _numero(10, j=4, tr="03", origem="6100"), _numero(11, j=4, tr="03", origem="6100")  # TRF3: SP e MS
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        dados = dict(magistrado="Juíza do Tribunal 7065", valor_causa=Decimal("50000.00"), segredo_justica=True, nivel_sigilo=1,
                     justica_gratuita=True, sistema_nome="pje", hash_dados="x" * 64, localidade_codigo="5002704", grau="1g",
                     classe_nome="Cumprimento de sentença", assuntos=[{"codigo_cnj": 1, "nome": "Assunto Campos 7065", "principal": True}])
        vazio = _caso_direto(db, tenant_id, contrato["id"], n_vazio)
        service.ligar_caso(db, _processo_direto(db, tenant_id, n_vazio, **dados), vazio)
        ext = db.get(CasoContencioso, vazio.id)
        assert (ext.justica, ext.uf, ext.codigo_orgao, ext.juiz_relator, ext.sistema_tribunal) == (
            "federal", "MS", "6100", "Juíza do Tribunal 7065", "pje")  # UF pelo município do órgão (código IBGE de Campo Grande)
        assert ext.segredo_justica and ext.justica_gratuita and vazio.valor_causa == Decimal("50000.00")
        assert ext.fase_processual == "cumprimento_sentenca"  # a classe diz a fase; sem isso ficaria como estava
        assert db.get(ListaItem, ext.classe_id).nome == "Cumprimento de Sentença" and db.get(ListaItem, ext.assunto_id).nome == "Assunto Campos 7065"

        # o usuário corrige ou apaga depois: reimportar não traz de volta
        ext.juiz_relator, ext.segredo_justica, ext.fase_processual, vazio.valor_causa = None, False, "conhecimento", None
        db.flush()
        res = partes_tribunal.do_processo(db, vazio, db.scalar(select(Processo).where(Processo.caso_id == vazio.id)))
        assert res["campos_preenchidos"] == []
        assert (ext.juiz_relator, ext.segredo_justica, ext.fase_processual, vazio.valor_causa) == (None, False, "conhecimento", None)

        # o que o usuário já tinha digitado antes da importação fica; só o que estava vazio é preenchido
        cheio = _caso_direto(db, tenant_id, contrato["id"], n_cheio, valor_causa=Decimal("123.45"))
        ext2 = regras_caso.extensao(db, cheio)
        outra = partes_tribunal.item_da_capa(db, tenant_id, "classe", "Monitória")
        ext2.juiz_relator, ext2.sistema_tribunal, ext2.uf, ext2.classe_id, ext2.fase_processual = "Juiz Digitado", "eproc", "SP", outra.id, "instrucao"
        db.flush()
        service.ligar_caso(db, _processo_direto(db, tenant_id, n_cheio, **dados), cheio)
        assert (ext2.juiz_relator, ext2.sistema_tribunal, ext2.uf, ext2.classe_id, ext2.fase_processual) == (
            "Juiz Digitado", "eproc", "SP", outra.id, "instrucao")
        assert cheio.valor_causa == Decimal("123.45")
        assert ext2.segredo_justica and ext2.justica_gratuita and db.get(ListaItem, ext2.assunto_id).nome == "Assunto Campos 7065"
        assert sorted(ext2.preenchido_tribunal) == ["assunto_id", "justica_gratuita", "segredo_justica"]
        db.commit()
    ficha = c.get(f"/api/faturamento/casos/{cheio.id}", headers=h).json()
    assert ficha["contencioso"]["juiz_relator"] == "Juiz Digitado" and "preenchido_tribunal" not in ficha["contencioso"]
