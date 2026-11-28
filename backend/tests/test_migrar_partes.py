"""Migração dos casos antigos para os tipos de caso e o cadastro único de partes: classificação, papéis, idempotência
e relatórios.

Os casos "antigos" são gravados direto no banco, como estavam antes desta entrega (sem tipo de caso e sem partes).
O banco é o mesmo da suíte inteira: documentos próprios (raiz 7064xxxx).
"""

import csv
from datetime import date

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.core.models import Tenant
from app.modules.faturamento import migrar_partes
from app.modules.faturamento.models import Caso, Contrato, TipoCaso
from app.modules.faturamento.tipos_caso import (
    CasoContencioso,
    EnvCategoria,
    Envolvimento,
    EnvolvimentoAdvogado,
    EnvQualificacao,
)
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais import cnj, service
from app.modules.tribunais.models import AdvogadoParte, Parte, Pessoa, Processo, Vinculo
from app.modules.tribunais.vinculo import normalizar_nome
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_tipos_caso import operador

CNJ_LEGADO = cnj.montar(7064001, 2023, 8, "26", "0100")


def _ler(arq) -> list[dict]:
    with arq.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def _legado(db, tenant_id: int) -> dict[str, int]:
    """Clientes, contratos e casos do jeito antigo + um processo importado ligado a um caso."""
    banco = Tomador(tenant_id=tenant_id, tipo="PJ", nome="Banco Legado 7064 S.A.", cpf_cnpj=_cnpj(70640001), emails=[])
    homonimo = Tomador(tenant_id=tenant_id, tipo="PJ", nome="Cliente Homônimo Legado 7064", cpf_cnpj=_cnpj(70640002), emails=[])
    db.add_all([banco, homonimo])
    db.flush()
    contrato = Contrato(tenant_id=tenant_id, numero=(db.scalar(select(func.max(Contrato.numero))) or 0) + 1, tomador_id=banco.id, nome="Legado")
    db.add(contrato)
    db.flush()
    n = (db.scalar(select(func.max(Caso.numero))) or 0) + 1
    base = dict(tenant_id=tenant_id, contrato_id=contrato.id, data_abertura=date(2024, 1, 10))
    casos = {
        "judicial": Caso(numero=n, titulo="Execução antiga", tipo=TipoCaso.judicial_estadual, polo="ativo",
                         numero_processo=cnj.formatar(CNJ_LEGADO), parte_contraria="Devedor Legado 7064 Ltda", **base),
        "consultivo": Caso(numero=n + 1, titulo="Consulta antiga", **base),
        "sem_polo": Caso(numero=n + 2, titulo="Processo sem polo", numero_processo="583.00.2010.123456", parte_contraria="Fulano Legado 7064", **base),
        "administrativo": Caso(numero=n + 3, titulo="Auto antigo", tipo=TipoCaso.administrativo, parte_contraria="Receita Legado 7064", **base),
        "homonimo": Caso(numero=n + 4, titulo="Contra o homônimo", tipo=TipoCaso.judicial_trabalhista, polo="passivo",
                         parte_contraria="CLIENTE HOMONIMO LEGADO 7064", **base),
        "repetido": Caso(numero=n + 5, titulo="Mesmo devedor", tipo=TipoCaso.judicial_estadual, polo="ativo",
                         parte_contraria="devedor legado 7064 ltda.", **base),
    }
    db.add_all(casos.values())
    db.flush()
    # processo importado do tribunal, ligado ao caso judicial: o banco (cliente, autor) e o devedor (réu, com advogado)
    trib = service.tribunal_do_numero(db, CNJ_LEGADO)
    proc = Processo(tenant_id=tenant_id, numero_cnj=CNJ_LEGADO, numero_formatado=cnj.formatar(CNJ_LEGADO), tribunal_id=trib.id,
                    caso_id=casos["judicial"].id, assuntos=[], prioridades=[], graus=[], numeros_antigos=[], processos_vinculados=[])
    db.add(proc)
    db.flush()

    def pessoa(nome, **kw):
        p = Pessoa(tenant_id=tenant_id, nome=nome, nome_normalizado=normalizar_nome(nome), telefones=[], enderecos=[],
                   outros_documentos=[], **kw)
        db.add(p)
        db.flush()
        return p

    autor = Parte(processo_id=proc.id, polo="ativo", tipo_participacao="EXEQUENTE", ordem=1,
                  pessoa_id=pessoa("BANCO LEGADO 7064 SA", tipo_pessoa="juridica").id)
    reu = Parte(processo_id=proc.id, polo="passivo", tipo_participacao="Executado", ordem=2,
                pessoa_id=pessoa("Devedor Legado 7064 Ltda", tipo_pessoa="juridica", cnpj=_cnpj(70640003)).id)
    perito = Parte(processo_id=proc.id, polo="outro", tipo_participacao="Perito", ordem=3, pessoa_id=pessoa("Perito Legado 7064").id)
    db.add_all([autor, reu, perito])
    db.flush()
    db.add(Vinculo(processo_id=proc.id, parte_id=autor.id, cliente_id=banco.id, criterio="manual", confianca=1, status="confirmado",
                   polo_cliente="ativo"))
    db.add(AdvogadoParte(parte_id=reu.id, nome="Dr. Advogado Legado", oab_numero="706401", oab_uf="SP", recebe_intimacao=True))
    db.add(AdvogadoParte(parte_id=reu.id, nome="Dra. Sem OAB Legado"))
    db.commit()
    return {"banco": banco.id, "cli_homonimo": homonimo.id, **{k: c.id for k, c in casos.items()}}


def _partes(db, caso_id: int) -> list[tuple]:
    linhas = db.execute(
        select(Pessoa.nome, EnvCategoria.nome, EnvQualificacao.nome, Envolvimento.eh_cliente, Envolvimento.pendente_reclassificacao)
        .join(Pessoa, Pessoa.id == Envolvimento.pessoa_id).join(EnvCategoria, EnvCategoria.id == Envolvimento.categoria_id)
        .outerjoin(EnvQualificacao, EnvQualificacao.id == Envolvimento.qualificacao_id)
        .where(Envolvimento.caso_id == caso_id).order_by(Envolvimento.id)).all()
    return [tuple(x) for x in linhas]


def test_migracao_classifica_cria_partes_e_e_idempotente(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    with SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).where(Tenant.slug == "cfme"))
        ids = _legado(db, tenant_id)
        # o estado antigo: sem tipo de caso e sem partes (a pessoa do cliente nasce com o cliente)
        for k in ("judicial", "consultivo", "sem_polo", "administrativo", "homonimo", "repetido"):
            db.execute(Caso.__table__.update().where(Caso.id == ids[k]).values(tipo_caso=None))
        # clientes de antes do cadastro único: um sem pessoa nenhuma, o outro com a pessoa já no cadastro (mesmo CNPJ)
        pessoa_do_banco, pessoa_do_homonimo = (db.scalar(select(Tomador.pessoa_id).where(Tomador.id == ids[k]))
                                               for k in ("banco", "cli_homonimo"))
        db.execute(Tomador.__table__.update().where(Tomador.id.in_([ids["banco"], ids["cli_homonimo"]])).values(pessoa_id=None))
        db.execute(Pessoa.__table__.delete().where(Pessoa.id == pessoa_do_homonimo))
        db.commit()
        db.expire_all()
        n_pessoas = db.scalar(select(func.count()).select_from(Pessoa))

        # simulação: relatório sai, nada é gravado
        sim = migrar_partes.migrar(db, tenant_id, dry_run=True)
        assert sim.numeros["envolvimento"] > 0 and all(a.stem.endswith("_simulacao") for a in sim.arquivos) and len(sim.arquivos) == 2
        assert db.scalar(select(func.count()).select_from(Pessoa)) == n_pessoas
        assert db.scalar(select(func.count()).select_from(Envolvimento).where(Envolvimento.caso_id.in_([v for k_, v in ids.items() if k_ not in ("banco", "cli_homonimo")]))) == 0
        assert db.scalar(select(Caso.tipo_caso).where(Caso.id == ids["judicial"])) is None

        r = migrar_partes.migrar(db, tenant_id)
        tipos = {linha["titulo"]: linha for linha in _ler(next(a for a in r.arquivos if a.stem == "migracao_tipo_caso"))}
        assert (tipos["Execução antiga"]["tipo_caso"], tipos["Execução antiga"]["motivo"]) == ("Contencioso", "Tipo antigo judicial")
        assert (tipos["Consulta antiga"]["tipo_caso"], tipos["Processo sem polo"]["tipo_caso"]) == ("Consultivo", "Contencioso")
        assert tipos["Processo sem polo"]["motivo"] == "Tem número de processo" and tipos["Auto antigo"]["tipo_caso"] == "Administrativo"
        caso = {k: db.get(Caso, v) for k, v in ids.items() if k not in ("banco", "cli_homonimo")}
        for v in caso.values():
            db.refresh(v)
        assert [caso[k].tipo_caso for k in ("judicial", "consultivo", "sem_polo", "administrativo", "homonimo")] == [
            "contencioso", "consultivo", "contencioso", "administrativo", "contencioso"]
        assert caso["judicial"].tipo == TipoCaso.judicial_estadual and caso["consultivo"].tipo == TipoCaso.consultivo
        assert caso["sem_polo"].tipo is None and caso["sem_polo"].polo is None and caso["judicial"].polo == "ativo"
        assert db.get(CasoContencioso, ids["judicial"]).justica == "estadual"
        # nada do que era antigo foi apagado
        assert caso["judicial"].parte_contraria == "Devedor Legado 7064 Ltda" and caso["homonimo"].parte_contraria

        # caso judicial com processo importado: o cliente (autor) pelo vínculo, o réu com documento e advogados, o perito em Outros
        assert _partes(db, ids["judicial"]) == [
            ("Banco Legado 7064 S.A.", "Polo Ativo", "Exequente", True, False),
            ("Devedor Legado 7064 Ltda", "Polo Passivo", "Executado", False, False),
            ("Perito Legado 7064", "Outros", None, False, False)]
        banco = db.get(Tomador, ids["banco"])
        env_cli = db.scalar(select(Envolvimento).where(Envolvimento.caso_id == ids["judicial"], Envolvimento.eh_cliente))
        assert env_cli.pessoa_id == banco.pessoa_id  # a parte do processo não virou outra pessoa do cliente
        env_reu = db.scalar(select(Envolvimento).join(Pessoa, Pessoa.id == Envolvimento.pessoa_id).where(
            Envolvimento.caso_id == ids["judicial"], Pessoa.cnpj == _cnpj(70640003)))
        advs = db.execute(select(Pessoa.nome, AdvogadoOab.numero, AdvogadoOab.uf, EnvolvimentoAdvogado.principal)
                          .join(Advogado, Advogado.pessoa_id == Pessoa.id)
                          .join(EnvolvimentoAdvogado, EnvolvimentoAdvogado.advogado_id == Advogado.id)
                          .outerjoin(AdvogadoOab, AdvogadoOab.id == EnvolvimentoAdvogado.oab_id)
                          .where(EnvolvimentoAdvogado.envolvimento_id == env_reu.id).order_by(EnvolvimentoAdvogado.id)).all()
        assert [tuple(a) for a in advs] == [("Dr. Advogado Legado", "706401", "SP", True), ("Dra. Sem OAB Legado", None, None, False)]
        # parte contrária em texto: polo oposto ao do cliente; a mesma pessoa serve aos dois casos (nome idêntico normalizado)
        assert _partes(db, ids["repetido"]) == [("Banco Legado 7064 S.A.", "Polo Ativo", None, True, False),
                                                ("devedor legado 7064 ltda.", "Polo Passivo", None, False, False)]
        # sem polo: cliente no lado ativo e parte contrária em Outros, os dois pendentes
        assert _partes(db, ids["sem_polo"]) == [("Banco Legado 7064 S.A.", "Polo Ativo", None, True, True),
                                                ("Fulano Legado 7064", "Outros", None, False, True)]
        assert _partes(db, ids["consultivo"]) == [("Banco Legado 7064 S.A.", "Cliente / Solicitante", None, True, False)]
        assert _partes(db, ids["administrativo"]) == [("Banco Legado 7064 S.A.", "Interessado / Requerente", None, True, False),
                                                      ("Receita Legado 7064", "Órgão / Autoridade", None, False, False)]
        # nome igual ao de um cliente: não funde com a pessoa do cliente; entra como possível duplicado
        homonimo = db.get(Tomador, ids["cli_homonimo"])
        partes_h = db.scalars(select(Envolvimento).where(Envolvimento.caso_id == ids["homonimo"], Envolvimento.eh_cliente.is_(False))).all()
        assert len(partes_h) == 1 and partes_h[0].pessoa_id != homonimo.pessoa_id
        assert db.get(Pessoa, partes_h[0].pessoa_id).tipo_pessoa == "sem_documento"
        rel = _ler(next(a for a in r.arquivos if a.stem == "migracao_partes_relatorio"))
        dup = [x for x in rel if x["linha"] == "possivel_duplicado" and x["pessoa"] == "CLIENTE HOMONIMO LEGADO 7064"]
        assert len(dup) == 1 and dup[0]["cliente_id"] == str(ids["cli_homonimo"]) and f"cliente nº {ids['cli_homonimo']}" in dup[0]["observacao"]
        assert any(x["linha"] == "envolvimento" and "pendente de reclassificação" in x["observacao"] for x in rel)
        # o cliente com o CNPJ já no cadastro de pessoas foi ligado a ela; o outro ganhou a sua
        assert db.get(Tomador, ids["banco"]).pessoa_id == pessoa_do_banco
        assert [x["linha"] for x in rel if x["cliente_id"] == str(ids["banco"]) and not x["caso"]] == ["cliente_ligado"]
        assert [x["linha"] for x in rel if x["cliente_id"] == str(ids["cli_homonimo"]) and not x["caso"]] == ["pessoa_criada"]
        assert db.get(Pessoa, homonimo.pessoa_id).cnpj == _cnpj(70640002)
        assert r.numeros["pendencia"] >= 2 and r.numeros["advogado_da_parte"] == 2
        # um cliente, uma pessoa (1:1), também depois da migração
        total, distintas = db.execute(select(func.count(Tomador.pessoa_id), func.count(func.distinct(Tomador.pessoa_id)))
                                      .where(Tomador.tenant_id == tenant_id)).one()
        assert total == distintas == db.scalar(select(func.count()).select_from(Tomador).where(Tomador.tenant_id == tenant_id))

        # idempotente: rodar de novo não cria nada e não apaga o relatório
        contagens = [db.scalar(select(func.count()).select_from(m)) for m in (Pessoa, Envolvimento, EnvolvimentoAdvogado, Advogado, AdvogadoOab)]
        r2 = migrar_partes.migrar(db, tenant_id)
        assert [db.scalar(select(func.count()).select_from(m)) for m in (Pessoa, Envolvimento, EnvolvimentoAdvogado, Advogado, AdvogadoOab)] == contagens
        assert not r2.tipos and not r2.partes and r2.arquivos == []
        assert (migrar_partes.pasta_dos_relatorios() / "migracao_partes_relatorio.csv").exists()

    # o administrador baixa os relatórios; os outros perfis, não
    lista = c.get("/api/faturamento/migracao-partes", headers=h)
    assert lista.status_code == 200 and {"migracao_tipo_caso.csv", "migracao_partes_relatorio.csv"} <= {a["nome"] for a in lista.json()}
    baixado = c.get("/api/faturamento/migracao-partes/migracao_tipo_caso.csv", headers=h)
    assert baixado.status_code == 200 and "Execução antiga" in baixado.content.decode("utf-8-sig")
    assert c.get("/api/faturamento/migracao-partes/nao_existe.csv", headers=h).status_code == 404
    ho = operador(c, h, "operador.migracao@cfme.com.br")
    assert c.get("/api/faturamento/migracao-partes", headers=ho).status_code == 403
    # a ficha depois da migração
    ficha = c.get(f"/api/faturamento/casos/{ids['judicial']}", headers=h).json()
    assert ficha["partes_resumo"] == "Banco Legado 7064 S.A. x Devedor Legado 7064 Ltda" and ficha["tipo_caso"] == "contencioso"
    assert c.get(f"/api/faturamento/casos/{ids['sem_polo']}", headers=h).json()["pendentes_reclassificacao"] == 2
