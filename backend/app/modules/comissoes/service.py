"""Apuração das comissões (sempre calculada na leitura) e geração das contas a pagar.

Base: o que o cliente efetivamente pagou em faturas de honorários (NH). É o mesmo valor que entra no extrato
(`financas.service.espelhar_recebimento`): o valor pago informado na baixa da nota ou, sem ele, o total da fatura.
Nota de Despesas (ND) é reembolso e não gera comissão. Quando a fatura tem itens de casos diferentes, o valor
recebido é distribuído entre os casos na proporção dos itens, e cada fatia procura a regra mais específica do
profissional (caso > contrato > cliente > geral).
"""

import calendar
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.comissoes.models import ComissaoLancada, RegraComissao
from app.modules.faturamento.models import AreaAtuacao, Caso, Contrato, FaturaItem
from app.modules.financas import service as financas
from app.modules.financas.models import CategoriaFinanceira, ContaPagar, GrupoDre, TipoCategoria
from app.modules.rpa_nfse.models import Fatura, Nfse, StatusFatura, TipoFatura, Tomador

ZERO = Decimal(0)
PESO = {"geral": 0, "cliente": 1, "contrato": 2, "caso": 3}
ROTULO_ALCANCE = {"geral": "Geral", "cliente": "Cliente", "contrato": "Contrato", "caso": "Caso"}
ROTULO_SITUACAO = {"a_pagar": "A pagar", "conta_gerada": "Conta gerada", "paga": "Paga"}
CATEGORIA_PADRAO = "Comissões"
MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro",
         "dezembro"]
# o servidor roda em UTC e o escritório está no Brasil: "hoje" e "este mês" são os do escritório
_BRT = timezone(timedelta(hours=-3))


class RegraComissoes(ValueError):
    pass


def hoje() -> date:
    return datetime.now(_BRT).date()


def mes_atual() -> tuple[date, date]:
    h = hoje()
    return h.replace(day=1), h.replace(day=calendar.monthrange(h.year, h.month)[1])


def rotulo_periodo(de: date, ate: date) -> str:
    if de.day == 1 and ate == de.replace(day=calendar.monthrange(de.year, de.month)[1]):
        return f"{MESES[de.month - 1]}/{de.year}"
    return f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}"


def q2(v) -> Decimal:
    return Decimal(v or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def brl(v) -> str:
    return "R$ " + f"{q2(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(v) -> str:
    return f"{Decimal(v).normalize():f}".replace(".", ",") + "%"


# ---------------------------------------------------------------- cálculo
@dataclass
class Parte:
    """Fatia de um recebimento: o que coube a um caso da fatura (ou a fatura inteira, sem itens)."""

    caso_id: int | None
    contrato_id: int | None
    cliente_id: int | None  # dono do contrato (ou quem pagou, se não há contrato)
    pagador_id: int | None
    base: Decimal


def distribuir(total: Decimal, pesos: list[Decimal]) -> list[Decimal]:
    """Divide `total` na proporção dos pesos; os centavos do arredondamento ficam na última parte."""
    soma = sum(pesos, ZERO)
    if soma <= 0:
        return [total] + [ZERO] * (len(pesos) - 1)
    saida, acumulado = [], ZERO
    for i, p in enumerate(pesos):
        v = total - acumulado if i == len(pesos) - 1 else q2(total * p / soma)
        saida.append(v)
        acumulado += v
    return saida


def partes_do_recebimento(fat: Fatura, recebido: Decimal, itens: list[FaturaItem], casos: dict[int, Caso],
                          contratos: dict[int, Contrato]) -> list[Parte]:
    por_caso: dict[int | None, Decimal] = {}
    for i in itens:
        por_caso[i.caso_id] = por_caso.get(i.caso_id, ZERO) + (i.valor or ZERO)
    if not por_caso or sum(por_caso.values(), ZERO) <= 0:
        por_caso = {None: Decimal(1)}
    chaves = list(por_caso)
    partes = []
    for caso_id, base in zip(chaves, distribuir(recebido, [por_caso[k] for k in chaves]), strict=True):
        caso = casos.get(caso_id) if caso_id else None
        contrato_id = caso.contrato_id if caso else fat.contrato_id
        contrato = contratos.get(contrato_id) if contrato_id else None
        partes.append(Parte(caso_id=caso.id if caso else None, contrato_id=contrato.id if contrato else None,
                            cliente_id=contrato.tomador_id if contrato else fat.tomador_id, pagador_id=fat.tomador_id,
                            base=base))
    return partes


def escolher_regra(regras: list[RegraComissao], parte: Parte, pago_em: date) -> RegraComissao | None:
    """A regra mais específica que alcança a fatia; no empate, a de vigência mais recente."""

    def alcanca(r: RegraComissao) -> bool:
        if r.vigencia_inicio and pago_em < r.vigencia_inicio:
            return False
        if r.alcance == "geral":
            return True
        if r.alcance == "cliente":
            return r.tomador_id is not None and r.tomador_id in (parte.cliente_id, parte.pagador_id)
        if r.alcance == "contrato":
            return r.contrato_id is not None and r.contrato_id == parte.contrato_id
        return r.alcance == "caso" and r.caso_id is not None and r.caso_id == parte.caso_id

    return max((r for r in regras if alcanca(r)), key=lambda r: (PESO[r.alcance], r.vigencia_inicio or date.min, r.id),
               default=None)


def _por_id(db: Session, modelo, ids) -> dict:
    ids = {i for i in ids if i}
    return {o.id: o for o in db.scalars(select(modelo).where(modelo.id.in_(ids)))} if ids else {}


def descrever_regra(r: RegraComissao, tomadores: dict, contratos: dict, casos: dict) -> str:
    if r.alcance == "cliente":
        t = tomadores.get(r.tomador_id)
        return f"Cliente: {t.nome}" if t else "Cliente"
    if r.alcance == "contrato":
        c = contratos.get(r.contrato_id)
        return f"Contrato #{c.numero} — {c.nome}" if c else "Contrato"
    if r.alcance == "caso":
        c = casos.get(r.caso_id)
        return f"Caso #{c.numero} — {c.titulo}" if c else "Caso"
    return "Geral (tudo o que for recebido)"


def apurar(db: Session, tenant_id: int, *, de: date | None = None, ate: date | None = None,
           fatura_ids: list[int] | None = None, usuario_id: int | None = None, tomador_id: int | None = None,
           situacao: str | None = None) -> dict:
    """Comissões dos recebimentos do período (pela data do pagamento) ou das faturas pedidas.

    Devolve as linhas (uma por recebimento × profissional × caso), os indicadores e as divergências: comissões que
    já viraram conta a pagar mas cujo recebimento foi estornado ou cuja fatura foi cancelada.
    """
    regras: dict[int, list[RegraComissao]] = {}
    for r in db.scalars(select(RegraComissao).where(RegraComissao.tenant_id == tenant_id, RegraComissao.ativo)):
        regras.setdefault(r.usuario_id, []).append(r)

    cond = [Fatura.tenant_id == tenant_id, Fatura.tipo == TipoFatura.honorarios, Fatura.status == StatusFatura.paga,
            Fatura.pago_em.is_not(None)]
    if fatura_ids is not None:
        cond.append(Fatura.id.in_(fatura_ids or [0]))
    else:
        cond += [Fatura.pago_em >= de, Fatura.pago_em <= ate]
    pagas = {f.id: f for f in db.scalars(select(Fatura).where(*cond))}

    lq = select(ComissaoLancada).where(ComissaoLancada.tenant_id == tenant_id)
    if fatura_ids is not None:
        lq = lq.where(ComissaoLancada.fatura_id.in_(fatura_ids or [0]))
    else:
        lq = lq.where(or_(ComissaoLancada.fatura_id.in_(list(pagas) or [0]),
                          and_(ComissaoLancada.pago_em >= de, ComissaoLancada.pago_em <= ate)))
    lancadas = {(x.fatura_id, x.usuario_id): x for x in db.scalars(lq)}
    contas = _por_id(db, ContaPagar, {x.conta_pagar_id for x in lancadas.values()})
    # vínculo cuja conta não existe mais não vale (a exclusão da conta já o apaga; isto é só garantia)
    lancadas = {k: x for k, x in lancadas.items() if x.conta_pagar_id in contas}
    outras = _por_id(db, Fatura, {fid for fid, _ in lancadas} - set(pagas))

    itens: dict[int, list[FaturaItem]] = {}
    if pagas:
        for i in db.scalars(select(FaturaItem).where(FaturaItem.fatura_id.in_(list(pagas))).order_by(FaturaItem.id)):
            itens.setdefault(i.fatura_id, []).append(i)
    casos = _por_id(db, Caso, {i.caso_id for xs in itens.values() for i in xs}
                    | {r.caso_id for rs in regras.values() for r in rs})
    contratos = _por_id(db, Contrato, {c.contrato_id for c in casos.values()} | {f.contrato_id for f in pagas.values()}
                        | {r.contrato_id for rs in regras.values() for r in rs})
    notas = {f.nfse_id for f in pagas.values() if f.nfse_id}
    pago_nota = dict(db.execute(select(Nfse.id, Nfse.valor_pago).where(Nfse.id.in_(notas))).all()) if notas else {}
    todas = {**outras, **pagas}
    tomadores = _por_id(db, Tomador, {c.tomador_id for c in contratos.values()} | {f.tomador_id for f in todas.values()}
                        | {r.tomador_id for rs in regras.values() for r in rs})
    areas = _por_id(db, AreaAtuacao, {c.area_id for c in casos.values()})
    usuarios = _por_id(db, Usuario, set(regras) | {uid for _, uid in lancadas})

    def nome(mapa: dict, oid: int | None, attr: str = "nome") -> str | None:
        o = mapa.get(oid) if oid else None
        return getattr(o, attr) if o else None

    def linha(fat: Fatura, uid: int, pago_em: date, **campos) -> dict:
        lanc = lancadas.get((fat.id, uid))
        conta = contas.get(lanc.conta_pagar_id) if lanc else None
        base = {"chave": f"{fat.id}:{uid}", "fatura_id": fat.id, "fatura": fat.codigo, "usuario_id": uid,
                "profissional": nome(usuarios, uid) or "?", "pago_em": pago_em,
                "situacao": "paga" if conta and conta.data_pagamento else "conta_gerada" if lanc else "a_pagar",
                "conta_pagar_id": conta.id if conta else None,
                "conta_descricao": conta.descricao if conta else None,
                "conta_vencimento": conta.data_vencimento if conta else None,
                "conta_pagamento": conta.data_pagamento if conta else None,
                "cliente_id": fat.tomador_id, "cliente": nome(tomadores, fat.tomador_id) or "Sem cliente",
                "contrato_id": None, "contrato": None, "caso_id": None, "caso": None, "area_id": None, "area": None,
                "percentual": None, "regra_id": None, "alcance": None, "regra": None, "divergencia": None}
        return {**base, **campos}

    linhas: list[dict] = []
    for fat in pagas.values():
        recebido = q2(pago_nota.get(fat.nfse_id) or fat.total)
        partes = partes_do_recebimento(fat, recebido, itens.get(fat.id, []), casos, contratos)
        for uid, rs in regras.items():
            do_recebimento = []
            for p in partes:
                r = escolher_regra(rs, p, fat.pago_em)
                if not r or r.percentual <= 0 or p.base <= 0:
                    continue  # regra de 0% = "neste cliente/contrato/caso não tem comissão"
                caso, contrato = casos.get(p.caso_id), contratos.get(p.contrato_id)
                do_recebimento.append(linha(
                    fat, uid, fat.pago_em, cliente_id=p.cliente_id, cliente=nome(tomadores, p.cliente_id) or "Sem cliente",
                    contrato_id=p.contrato_id, contrato=f"#{contrato.numero} — {contrato.nome}" if contrato else None,
                    caso_id=p.caso_id, caso=f"#{caso.numero} — {caso.titulo}" if caso else None,
                    area_id=caso.area_id if caso else None, area=nome(areas, caso.area_id) if caso else None,
                    pagador_id=p.pagador_id, base=p.base, percentual=r.percentual,
                    comissao=q2(p.base * r.percentual / 100), regra_id=r.id, alcance=r.alcance,
                    regra=descrever_regra(r, tomadores, contratos, casos)))
            lanc = lancadas.get((fat.id, uid))
            total = sum((x["comissao"] for x in do_recebimento), ZERO)
            if lanc and abs(total - lanc.valor) >= Decimal("0.01"):
                aviso = (f"A conta foi gerada com {brl(lanc.valor)}; pelo recebimento e pelas regras de hoje seriam "
                         f"{brl(total)}. Confira a conta em Contas a pagar.")
                for x in do_recebimento:
                    x["divergencia"] = aviso
            linhas += do_recebimento
    com_linha = {(x["fatura_id"], x["usuario_id"]) for x in linhas}
    for (fid, uid), lanc in lancadas.items():
        # a conta existe, mas hoje nenhuma regra do profissional alcança este recebimento
        if fid in pagas and (fid, uid) not in com_linha:
            fat = pagas[fid]
            linhas.append(linha(fat, uid, fat.pago_em, pagador_id=fat.tomador_id, base=lanc.valor_base, comissao=lanc.valor,
                                regra="Regra alterada depois do lançamento",
                                divergencia=f"A conta foi gerada com {brl(lanc.valor)}, mas pelas regras de hoje este "
                                            "recebimento não gera comissão. Confira a conta em Contas a pagar."))

    divergencias: list[dict] = []
    for (fid, uid), lanc in lancadas.items():
        fat = outras.get(fid)
        if fid in pagas or not fat:
            continue
        if fat.status == StatusFatura.paga and fat.tipo == TipoFatura.honorarios and fat.pago_em:
            continue  # paga em outra data: aparece no período do pagamento atual
        motivo = ("Comissão já lançada para uma fatura cancelada." if fat.status == StatusFatura.cancelada
                  else "Comissão já lançada para um recebimento estornado: a fatura não está mais paga.")
        divergencias.append(linha(fat, uid, lanc.pago_em, pagador_id=fat.tomador_id, base=lanc.valor_base,
                                  comissao=lanc.valor, divergencia=motivo))

    opcoes = {
        "profissionais": sorted(({"id": i, "nome": n} for i, n in {(x["usuario_id"], x["profissional"])
                                                                    for x in linhas + divergencias}), key=lambda o: o["nome"]),
        "clientes": sorted(({"id": i, "nome": n} for i, n in {(x["cliente_id"], x["cliente"]) for x in linhas} if i),
                           key=lambda o: o["nome"]),
    }

    def passa(x: dict) -> bool:
        return ((not usuario_id or x["usuario_id"] == usuario_id)
                and (not tomador_id or tomador_id in (x["cliente_id"], x.get("pagador_id")))
                and (not situacao or x["situacao"] == situacao))

    linhas = sorted((x for x in linhas if passa(x)), key=lambda x: (x["pago_em"], x["fatura_id"], x["profissional"]))
    divergencias = sorted((x for x in divergencias if passa(x)), key=lambda x: (x["pago_em"], x["fatura_id"]))
    soma = lambda sit=None: sum((x["comissao"] for x in linhas if not sit or x["situacao"] == sit), ZERO)  # noqa: E731
    bases = {(x["fatura_id"], x["caso_id"]): x["base"] for x in linhas}  # dois profissionais não dobram a base
    kpis = {"base": sum(bases.values(), ZERO), "comissao": soma(), "a_pagar": soma("a_pagar"),
            "conta_gerada": soma("conta_gerada"), "paga": soma("paga"),
            "recebimentos": len({x["fatura_id"] for x in linhas}), "comissoes": len({x["chave"] for x in linhas}),
            "divergencias": len(divergencias) + len({x["chave"] for x in linhas if x["divergencia"]})}
    return {"de": de, "ate": ate, "kpis": kpis, "linhas": linhas, "divergencias": divergencias, "opcoes": opcoes}


# ---------------------------------------------------------------- conta a pagar
def soltar_contas(db: Session, conta_ids: list[int]) -> None:
    """A conta a pagar vai ser excluída: as comissões ligadas a ela voltam a ficar "a pagar"."""
    if conta_ids:
        db.execute(delete(ComissaoLancada).where(ComissaoLancada.conta_pagar_id.in_(conta_ids)))


def categoria_padrao(db: Session, tenant_id: int):
    """Categoria "Comissões" (despesa de pessoal): usa a que existir ou cria."""
    financas.garantir_categorias_padrao(db, tenant_id)  # o plano de contas padrão só nasce com a tabela vazia
    novas: list[str] = []
    cat, _ = financas.categoria_por_nome(db, tenant_id, CATEGORIA_PADRAO, TipoCategoria.despesa, novas=novas)
    if novas:
        cat.grupo_dre = GrupoDre.pessoal
    return cat


def gerar_contas(db: Session, tenant_id: int, usuario: Usuario, *, itens: list[tuple[int, int]], vencimento: date,
                 categoria_id: int | None, de: date, ate: date, observacao: str | None = None) -> dict:
    """Uma conta a pagar por profissional com a soma das comissões escolhidas (recebimento × profissional).

    Os valores são recalculados aqui (nunca vêm da tela). Comissão que já tem conta é ignorada: repetir o pedido não
    duplica nada; e o UNIQUE de `com_lancada` segura dois cliques ao mesmo tempo.
    """
    pedidas = set(itens)
    if not pedidas:
        raise RegraComissoes("Escolha ao menos uma comissão.")
    apuracao = apurar(db, tenant_id, fatura_ids=sorted({fid for fid, _ in pedidas}))
    por_usuario: dict[int, dict[int, list[dict]]] = {}
    ja_lancadas: set[tuple[int, int]] = set()
    achadas = set()
    for x in apuracao["linhas"]:
        chave = (x["fatura_id"], x["usuario_id"])
        if chave not in pedidas:
            continue
        achadas.add(chave)
        if x["situacao"] != "a_pagar":
            ja_lancadas.add(chave)
            continue
        por_usuario.setdefault(x["usuario_id"], {}).setdefault(x["fatura_id"], []).append(x)
    if not por_usuario:
        if achadas:
            raise RegraComissoes("As comissões escolhidas já têm conta a pagar gerada.")
        raise RegraComissoes("Nenhuma comissão a pagar entre as escolhidas: o recebimento pode ter sido estornado. "
                             "Atualize a tela.")
    cat = db.get(CategoriaFinanceira, categoria_id) if categoria_id else categoria_padrao(db, tenant_id)
    if not cat or cat.tenant_id != tenant_id:
        raise RegraComissoes("Categoria não encontrada.")
    periodo = rotulo_periodo(de, ate)
    contas = []
    for uid, faturas in por_usuario.items():
        prof = db.get(Usuario, uid)
        total = sum((x["comissao"] for xs in faturas.values() for x in xs), ZERO)
        codigos = sorted({xs[0]["fatura"] for xs in faturas.values()})
        detalhe = f"Comissão sobre {len(codigos)} recebimento(s): {', '.join(codigos)}."
        dados = {"descricao": f"Comissão de {prof.nome} — {periodo}"[:255], "funcionario_id": uid,
                 "data_vencimento": vencimento, "data_competencia": ate,
                 "observacao": "\n".join(t for t in (detalhe, observacao) if t)}
        try:
            conta = financas.criar_contas(db, tenant_id, usuario, dados, [{"categoria_id": cat.id, "valor": total}])[0]
        except financas.RegraFinanceiro as e:
            raise RegraComissoes(str(e)) from e
        for fid, xs in faturas.items():
            # está "a pagar": se sobrou um vínculo antigo sem conta, ele sai para não esbarrar no UNIQUE
            db.execute(delete(ComissaoLancada).where(ComissaoLancada.fatura_id == fid, ComissaoLancada.usuario_id == uid))
            db.add(ComissaoLancada(
                tenant_id=tenant_id, fatura_id=fid, usuario_id=uid, conta_pagar_id=conta.id, pago_em=xs[0]["pago_em"],
                valor_base=sum((x["base"] for x in xs), ZERO), valor=sum((x["comissao"] for x in xs), ZERO),
                criado_por_id=usuario.id))
        contas.append({"id": conta.id, "descricao": conta.descricao, "valor": conta.valor, "usuario_id": uid,
                       "profissional": prof.nome, "comissoes": len(faturas)})
    try:
        db.flush()
    except IntegrityError as e:
        raise RegraComissoes("Outra pessoa acabou de gerar a conta de uma destas comissões. Atualize a tela.") from e
    return {"contas": contas, "ja_lancadas": len(ja_lancadas), "categoria": cat.nome}
