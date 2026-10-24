"""Relatórios do financeiro: fluxo de caixa, DRE, projeção de despesas, previsão de caixa e relatório de faturamento."""

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from statistics import mean

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.modules.financas.models import (
    ContaBancaria,
    ContaPagar,
    Lancamento,
    TipoConta,
    TipoLancamento,
)
from app.modules.financas.service import ZERO, q2, saldos, somar_meses

MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def rotulo_mes(d: date) -> str:
    return f"{MESES[d.month - 1]}/{d.year}"


def _contas(db: Session, tenant_id: int, conta_ids: list[int] | None = None, ativas: bool = False) -> list[ContaBancaria]:
    q = select(ContaBancaria).where(ContaBancaria.tenant_id == tenant_id)
    if conta_ids:
        q = q.where(ContaBancaria.id.in_(conta_ids))
    if ativas:
        q = q.where(ContaBancaria.ativo)
    return list(db.scalars(q.order_by(ContaBancaria.nome)))


# ================================================================ fluxo de caixa (realizado)
def fluxo_caixa(db: Session, tenant_id: int, *, de: date, ate: date, conta_ids: list[int] | None = None,
                agrupar: str = "dia", incluir_transferencias: bool = False) -> dict:
    """Extrato consolidado de uma ou várias contas, com saldo corrente e agrupamento por dia/semana/mês."""
    contas = _contas(db, tenant_id, conta_ids)
    ids = [c.id for c in contas]
    if not ids:
        return {"saldo_anterior": ZERO, "entradas": ZERO, "saidas": ZERO, "saldo_final": ZERO, "linhas": [], "grupos": [],
                "por_categoria": []}
    saldo_ini = sum((c.saldo_inicial for c in contas), ZERO)
    anteriores = db.scalars(select(Lancamento).where(Lancamento.conta_id.in_(ids), Lancamento.data < de))
    anterior = saldo_ini + sum(((lc.valor if lc.tipo == TipoLancamento.credito else -lc.valor) for lc in anteriores), ZERO)
    q = select(Lancamento).where(Lancamento.conta_id.in_(ids), Lancamento.data >= de, Lancamento.data <= ate)
    linhas_db = list(db.scalars(q.order_by(Lancamento.data, Lancamento.id)))
    interna = len(ids) > 1  # transferência entre contas do próprio filtro não é entrada nem saída de verdade
    saldo, entradas, saidas, linhas = anterior, ZERO, ZERO, []
    grupos: dict[str, dict] = {}
    por_cat: dict[tuple, Decimal] = defaultdict(lambda: ZERO)
    for lc in linhas_db:
        sinal = lc.valor if lc.tipo == TipoLancamento.credito else -lc.valor
        saldo += sinal
        transf = lc.origem == "transferencia"
        conta_ent = not (transf and interna and not incluir_transferencias)
        if conta_ent:
            if sinal > 0:
                entradas += sinal
            else:
                saidas -= sinal
        chave = (lc.data.isoformat() if agrupar == "dia" else
                 (lc.data - timedelta(days=lc.data.weekday())).isoformat() if agrupar == "semana" else lc.data.strftime("%Y-%m"))
        g = grupos.setdefault(chave, {"chave": chave, "entradas": ZERO, "saidas": ZERO, "saldo": ZERO})
        if conta_ent:
            g["entradas" if sinal > 0 else "saidas"] += abs(sinal)
        g["saldo"] = q2(saldo)
        if conta_ent and not transf:
            cat = lc.categoria.nome if lc.categoria else "(sem categoria)"
            por_cat[("entrada" if sinal > 0 else "saida", cat)] += abs(sinal)
        linhas.append({"id": lc.id, "data": lc.data, "conta_id": lc.conta_id, "conta": lc.conta.nome, "descricao": lc.descricao,
                       "categoria": lc.categoria.nome if lc.categoria else None,
                       "subcategoria": lc.subcategoria.nome if lc.subcategoria else None,
                       "favorecido": (lc.fornecedor.nome if lc.fornecedor else lc.favorecido), "documento": lc.documento,
                       "entrada": lc.valor if sinal > 0 else None, "saida": lc.valor if sinal < 0 else None,
                       "saldo": q2(saldo), "origem": lc.origem, "observacao": lc.observacao})
    return {"saldo_anterior": q2(anterior), "entradas": q2(entradas), "saidas": q2(saidas), "saldo_final": q2(saldo),
            "resultado": q2(entradas - saidas), "linhas": linhas, "grupos": list(grupos.values()),
            "por_categoria": sorted([{"tipo": t, "categoria": c, "valor": q2(v)} for (t, c), v in por_cat.items()],
                                    key=lambda x: (x["tipo"], -x["valor"]))}


# ================================================================ DRE gerencial (regime de caixa)
ESTRUTURA_DRE = [
    ("receita_bruta", "Receita bruta", +1),
    ("deducoes", "(−) Impostos sobre o faturamento", -1),
    ("=receita_liquida", "Receita líquida", None),
    ("custos", "(−) Custos dos serviços", -1),
    ("=lucro_bruto", "Lucro bruto", None),
    ("pessoal", "(−) Despesas com pessoal", -1),
    ("administrativas", "(−) Despesas administrativas", -1),
    ("financeiras", "(±) Resultado financeiro", 0),
    ("outras_receitas", "(+) Outras receitas", +1),
    ("nao_classificado", "(±) Não classificado", 0),
    ("=resultado_operacional", "Resultado antes do IR/CSLL", None),
    ("impostos_lucro", "(−) IRPJ e CSLL", -1),
    ("=resultado_liquido", "Resultado líquido", None),
    ("investimentos", "(−) Investimentos", -1),
    ("retiradas", "(−) Retiradas e distribuição de lucros", -1),
    ("transferencias", "(±) Transferências entre contas", 0),
    ("=geracao_caixa", "Geração de caixa do período", None),
]


def dre(db: Session, tenant_id: int, *, de: date, ate: date, mensal: bool = False, conta_ids: list[int] | None = None) -> dict:
    """DRE gerencial: lançamentos do extrato agrupados pela linha da DRE de cada categoria.

    Transferências aparecem numa seção própria (enviadas/recebidas por conta), fora da receita e da despesa operacionais:
    com todas as contas elas se anulam; filtrando uma conta, mostram o dinheiro que entrou/saiu dela.
    """
    q = select(Lancamento).where(Lancamento.tenant_id == tenant_id, Lancamento.data >= de, Lancamento.data <= ate)
    if conta_ids:
        q = q.where(Lancamento.conta_id.in_(conta_ids))
    lancs = db.scalars(q)
    meses = []
    m = de.replace(day=1)
    while m <= ate:
        meses.append(m.strftime("%Y-%m"))
        m = somar_meses(m, 1, 1)
    valores: dict[str, dict[str, dict[str, Decimal]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: ZERO)))
    for lc in lancs:
        sinal = lc.valor if lc.tipo == TipoLancamento.credito else -lc.valor
        if lc.origem == "transferencia":
            grupo = "transferencias"
            nome = f"{'Recebidas em' if sinal > 0 else 'Enviadas de'} {lc.conta.nome}"
        else:
            grupo = lc.categoria.grupo_dre.value if lc.categoria and lc.categoria.grupo_dre else "nao_classificado"
            nome = lc.categoria.nome if lc.categoria else "(sem categoria)"
        mes = lc.data.strftime("%Y-%m")
        valores[grupo][nome][mes] += sinal
        valores[grupo][nome]["total"] += sinal
    linhas, acumulado = [], defaultdict(lambda: ZERO)
    for chave, rotulo, _ in ESTRUTURA_DRE:
        if chave.startswith("="):
            linhas.append({"chave": chave[1:], "rotulo": rotulo, "tipo": "subtotal",
                           "total": q2(acumulado["total"]), "meses": {k: q2(acumulado[k]) for k in meses} if mensal else {}})
            continue
        cats = valores.get(chave, {})
        tot = defaultdict(lambda: ZERO)
        itens = []
        for nome, porm in sorted(cats.items(), key=lambda kv: -abs(kv[1]["total"])):
            itens.append({"categoria": nome, "total": q2(porm["total"]),
                          "meses": {k: q2(porm.get(k, ZERO)) for k in meses} if mensal else {}})
            for k, v in porm.items():
                tot[k] += v
        for k, v in tot.items():
            acumulado[k] += v
        if itens or chave in ("receita_bruta", "deducoes", "pessoal", "administrativas"):
            linhas.append({"chave": chave, "rotulo": rotulo, "tipo": "grupo", "total": q2(tot["total"]),
                           "meses": {k: q2(tot.get(k, ZERO)) for k in meses} if mensal else {}, "itens": itens})
    receita = sum((i["total"] for linha in linhas if linha["chave"] == "receita_bruta" for i in linha.get("itens", [])), ZERO)
    resultado = next((linha["total"] for linha in linhas if linha["chave"] == "resultado_liquido"), ZERO)
    return {"de": de, "ate": ate, "meses": meses if mensal else [], "linhas": linhas,
            "margem": q2(resultado / receita * 100) if receita else None, "receita_bruta": q2(receita), "resultado": q2(resultado)}


# ================================================================ receitas previstas (faturamento)
def _receitas_previstas(db: Session, tenant_id: int, ate: date) -> list[dict]:
    """Entradas futuras: faturas em aberto, revisões em andamento e parcelas de regras ainda não faturadas."""
    from app.modules.faturamento import service as fat_service
    from app.modules.faturamento.models import Contrato, Revisao, StatusRevisao
    from app.modules.rpa_nfse.models import Fatura, StatusFatura

    hoje = date.today()
    prazo_cliente, prazo_geral = prazos_de_recebimento(db, tenant_id)
    eventos = []
    for f in db.scalars(select(Fatura).where(Fatura.tenant_id == tenant_id, Fatura.status == StatusFatura.aberta)):
        prazo = prazo_cliente.get(f.tomador_id)
        prevista = f.data_emissao + timedelta(days=prazo) if prazo is not None else f.data_vencimento
        eventos.append({"origem": "fatura", "id": f.id, "descricao": f"{f.codigo} — {f.tomador.nome if f.tomador else ''}",
                        "cliente": f.tomador.nome if f.tomador else "", "data": prevista, "vencimento": f.data_vencimento,
                        "emissao": f.data_emissao, "valor": f.total, "atrasada": prevista < hoje})
    for r in db.scalars(select(Revisao).where(Revisao.tenant_id == tenant_id, Revisao.status == StatusRevisao.em_revisao)):
        total = sum((i.valor for i in r.itens if not i.excluido), ZERO)
        if total:
            eventos.append({"origem": "revisao", "id": r.id, "descricao": f"Revisão #{r.numero} — {r.contrato.nome}",
                            "cliente": r.contrato.tomador.nome if r.contrato.tomador else "",
                            "data": hoje + timedelta(days=10 + prazo_geral), "valor": total, "atrasada": False})
    # parcelas futuras (regras fixo/recorrente) ainda não faturadas
    amanha = hoje + timedelta(days=1)
    if ate >= amanha:
        for cp in fat_service.pendencias(db, tenant_id, aba="honorarios", de=amanha, ate=ate, tipos={"fixo", "recorrente"}):
            for contrato_id, itens in cp.contratos.items():
                c = db.get(Contrato, contrato_id)
                for p in itens:
                    eventos.append({"origem": "regra", "id": p.regra_id, "descricao": f"{p.descricao} — {c.nome}",
                                    "cliente": cp.tomador.nome, "data": p.data + timedelta(days=prazo_geral), "valor": p.valor,
                                    "atrasada": False})
    return eventos


def prazos_de_recebimento(db: Session, tenant_id: int) -> tuple[dict[int, int], int]:
    """Quantos dias cada cliente costuma levar da emissão ao pagamento (últimos 18 meses, ≥ 2 faturas)."""
    from app.modules.rpa_nfse.models import Fatura, StatusFatura

    desde = date.today() - timedelta(days=548)
    por_cliente: dict[int, list[int]] = defaultdict(list)
    todos = []
    for tomador_id, emissao, pago in db.execute(select(Fatura.tomador_id, Fatura.data_emissao, Fatura.pago_em).where(
            Fatura.tenant_id == tenant_id, Fatura.status == StatusFatura.paga, Fatura.pago_em.is_not(None),
            Fatura.data_emissao >= desde)).all():
        d = (pago - emissao).days
        if 0 <= d <= 365:
            todos.append(d)
            if tomador_id:
                por_cliente[tomador_id].append(d)
    geral = round(mean(todos)) if todos else 30
    return {k: round(mean(v)) for k, v in por_cliente.items() if len(v) >= 2}, geral


def _media_debitos(db: Session, tenant_id: int, meses: int, conta_ids: list[int] | None = None,
                   sem_contas_pagar: bool = False) -> Decimal:
    hoje = date.today()
    fim = hoje.replace(day=1) - timedelta(days=1)
    ini = somar_meses(hoje.replace(day=1), -meses, 1)
    q = select(func.coalesce(func.sum(Lancamento.valor), 0)).where(
        Lancamento.tenant_id == tenant_id, Lancamento.tipo == TipoLancamento.debito, Lancamento.origem != "transferencia",
        Lancamento.data >= ini, Lancamento.data <= fim)
    if conta_ids:
        q = q.where(Lancamento.conta_id.in_(conta_ids))
    if sem_contas_pagar:
        q = q.where(Lancamento.origem != "conta_pagar")
    return q2(Decimal(db.scalar(q) or 0) / meses)


# ================================================================ projeção de despesas (12 meses)
def projecao_despesas(db: Session, tenant_id: int, meses: int = 12) -> dict:
    hoje = date.today()
    inicio = hoje.replace(day=1)
    fim = somar_meses(inicio, meses, 1) - timedelta(days=1)
    s = saldos(db, tenant_id)
    ativas = {c.id for c in _contas(db, tenant_id, ativas=True)}
    saldo = sum((v for k, v in s.items() if k in ativas), ZERO)
    saldo_atual = saldo
    baseline = _media_debitos(db, tenant_id, 6, sem_contas_pagar=True)  # gastos que não passam por Contas a pagar
    abertas = list(db.scalars(select(ContaPagar).where(ContaPagar.tenant_id == tenant_id, ContaPagar.data_pagamento.is_(None),
                                                       ContaPagar.data_vencimento <= fim)))
    receitas = _receitas_previstas(db, tenant_id, fim)
    linhas = []
    for i in range(meses):
        ini_m = somar_meses(inicio, i, 1)
        fim_m = somar_meses(ini_m, 1, 1) - timedelta(days=1)
        primeira = i == 0
        contas_mes = [c for c in abertas if (c.data_vencimento <= fim_m if primeira else ini_m <= c.data_vencimento <= fim_m)]
        desp_contas = sum((c.valor for c in contas_mes), ZERO)
        rec = sum((e["valor"] for e in receitas if (e["data"] <= fim_m if primeira else ini_m <= e["data"] <= fim_m)), ZERO)
        desp = desp_contas + baseline
        saldo += rec - desp
        por_cat: dict[str, Decimal] = defaultdict(lambda: ZERO)
        for c in contas_mes:
            por_cat[c.categoria.nome if c.categoria else "(sem categoria)"] += c.valor
        linhas.append({"mes": ini_m.strftime("%Y-%m"), "rotulo": rotulo_mes(ini_m), "receitas": q2(rec),
                       "contas_a_pagar": q2(desp_contas), "gastos_estimados": baseline, "despesas": q2(desp),
                       "resultado": q2(rec - desp), "saldo": q2(saldo), "qtd_contas": len(contas_mes),
                       "por_categoria": sorted([{"categoria": k, "valor": q2(v)} for k, v in por_cat.items()], key=lambda x: -x["valor"])})
    return {"saldo_atual": q2(saldo_atual), "gasto_medio_sem_conta": baseline,
            "receitas_total": q2(sum((linha["receitas"] for linha in linhas), ZERO)),
            "despesas_total": q2(sum((linha["despesas"] for linha in linhas), ZERO)), "saldo_final": q2(saldo), "linhas": linhas,
            "primeiro_mes_negativo": next((linha["rotulo"] for linha in linhas if linha["saldo"] < 0), None)}


# ================================================================ previsão de caixa (simulação diária)
def previsao_caixa(db: Session, tenant_id: int, *, horizonte: int = 90, saldo_minimo: Decimal | None = None,
                   atraso_dias: int | None = 15, recorrentes: bool = True, revisoes: bool = False,
                   gasto_medio: bool = True) -> dict:
    from app.modules.financas.service import config

    hoje = date.today()
    fim = hoje + timedelta(days=horizonte)
    minimo = saldo_minimo if saldo_minimo is not None else config(db, tenant_id).saldo_minimo
    contas = _contas(db, tenant_id, ativas=True)
    invest_ids = {c.id for c in contas if c.tipo == TipoConta.investimento or "invest" in c.nome.lower()}
    corr_ids = [c.id for c in contas if c.id not in invest_ids]
    s = saldos(db, tenant_id)
    saldo_corrente = sum((s[i] for i in corr_ids), ZERO)
    saldo_invest = sum((s[i] for i in invest_ids), ZERO)

    eventos: list[dict] = []
    for c in db.scalars(select(ContaPagar).where(ContaPagar.tenant_id == tenant_id, ContaPagar.data_pagamento.is_(None),
                                                 ContaPagar.data_vencimento <= fim)):
        eventos.append({"tipo": "saida", "origem": "conta_pagar", "id": c.id, "data": max(c.data_vencimento, hoje),
                        "vencida": c.data_vencimento < hoje, "descricao": c.descricao,
                        "quem": c.fornecedor.nome if c.fornecedor else c.favorecido,
                        "categoria": c.categoria.nome if c.categoria else "(sem categoria)", "valor": c.valor})
    atrasados = []
    for e in _receitas_previstas(db, tenant_id, fim):
        if e["origem"] == "revisao" and not revisoes:
            continue
        if e["origem"] == "regra" and not recorrentes:
            continue
        data = e["data"]
        if e.get("atrasada"):
            atrasados.append({**e, "dias_atraso": (hoje - e["data"]).days})
            if atraso_dias is None:
                continue
            data = hoje + timedelta(days=atraso_dias)
        if data <= fim:
            eventos.append({"tipo": "entrada", "origem": e["origem"], "id": e["id"], "data": max(data, hoje),
                            "descricao": e["descricao"], "quem": e["cliente"], "categoria": "Recebimentos", "valor": e["valor"]})

    # gastos do dia a dia que não estão em Contas a pagar, distribuídos como costumam cair no mês
    if gasto_medio:
        media = _media_debitos(db, tenant_id, 3, corr_ids, sem_contas_pagar=True)
        peso = _peso_dia(db, tenant_id, corr_ids)
        m = hoje.replace(day=1)
        while m <= fim:
            fim_m = somar_meses(m, 1, 1) - timedelta(days=1)
            ja = ZERO
            if m == hoje.replace(day=1):
                ja = Decimal(db.scalar(select(func.coalesce(func.sum(Lancamento.valor), 0)).where(
                    Lancamento.conta_id.in_(corr_ids or [0]), Lancamento.tipo == TipoLancamento.debito,
                    Lancamento.origem.notin_(["transferencia", "conta_pagar"]), Lancamento.data >= m, Lancamento.data <= hoje)) or 0)
            restante = max(ZERO, media - ja)
            dias_mes = [d for d in _dias(max(m, hoje + timedelta(days=1)), min(fim_m, fim))]
            pesos = [peso.get(d.day, 1) for d in dias_mes]
            soma = sum(pesos) or 1
            for d, p in zip(dias_mes, pesos, strict=True):
                v = q2(restante * Decimal(p) / Decimal(soma))
                if v:
                    eventos.append({"tipo": "saida", "origem": "estimado", "id": None, "data": d, "descricao": "Gastos do dia a dia (média)",
                                    "quem": None, "categoria": "Gastos estimados", "valor": v})
            m = somar_meses(m, 1, 1)

    eventos.sort(key=lambda e: (e["data"], 0 if e["tipo"] == "entrada" else 1))
    por_dia: dict[date, Decimal] = defaultdict(lambda: ZERO)
    for e in eventos:
        por_dia[e["data"]] += e["valor"] if e["tipo"] == "entrada" else -e["valor"]

    # simulação: sem transferir e com o plano de resgates do investimento
    serie, plano = [], []
    sem, com, invest = saldo_corrente, saldo_corrente, saldo_invest
    menor_sem = menor_com = (saldo_corrente, hoje)
    primeiro_abaixo = primeiro_negativo = None
    dias_lista = list(_dias(hoje, fim))
    for i, d in enumerate(dias_lista):
        sem += por_dia.get(d, ZERO)
        com += por_dia.get(d, ZERO)
        if com < minimo and invest > 0:
            # traz o suficiente para segurar os próximos 30 dias
            futuro, pior = com, com
            for d2 in dias_lista[i + 1:i + 31]:
                futuro += por_dia.get(d2, ZERO)
                pior = min(pior, futuro)
            falta = minimo - pior
            valor = min(invest, Decimal(-(-falta // 1000) * 1000))
            if valor > 0:
                com += valor
                invest -= valor
                plano.append({"data": d, "valor": q2(valor), "parcial": invest <= 0 and com < minimo})
        if sem < minimo and not primeiro_abaixo:
            primeiro_abaixo = d
        if sem < 0 and not primeiro_negativo:
            primeiro_negativo = d
        menor_sem = min(menor_sem, (sem, d), key=lambda x: x[0])
        menor_com = min(menor_com, (com, d), key=lambda x: x[0])
        serie.append({"data": d, "sem_transferir": q2(sem), "com_transferencias": q2(com)})

    realizado = _realizado(db, corr_ids, s, 60)
    entra = sum((e["valor"] for e in eventos if e["tipo"] == "entrada"), ZERO)
    sai = sum((e["valor"] for e in eventos if e["tipo"] == "saida"), ZERO)
    if menor_com[0] < 0:
        alerta = {"nivel": "critico", "texto": f"Falta dinheiro em {menor_com[1]:%d/%m/%Y}, mesmo usando o investimento."}
    elif plano:
        alerta = {"nivel": "atencao", "texto": f"Transfira R$ {plano[0]['valor']:,.2f} do investimento até {plano[0]['data']:%d/%m/%Y}."
                  .replace(",", "X").replace(".", ",").replace("X", ".")}
    else:
        alerta = {"nivel": "ok", "texto": f"O caixa aguenta os próximos {horizonte} dias acima do saldo mínimo."}

    limite30 = hoje + timedelta(days=30)
    cats: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for e in eventos:
        if e["tipo"] == "saida" and e["data"] <= limite30:
            cats[e["categoria"]] += e["valor"]
    top = sorted(cats.items(), key=lambda kv: -kv[1])
    saidas_30 = [{"categoria": k, "valor": q2(v)} for k, v in top[:8]]
    if len(top) > 8:
        saidas_30.append({"categoria": "Outras", "valor": q2(sum((v for _, v in top[8:]), ZERO))})

    semanas, atual = [], None
    sem_s, com_s = saldo_corrente, saldo_corrente
    for d in dias_lista:
        inicio_sem = d - timedelta(days=d.weekday())
        if not atual or atual["inicio"] != inicio_sem:
            atual = {"inicio": inicio_sem, "fim": inicio_sem + timedelta(days=6), "entra": ZERO, "sai": ZERO, "menor": None, "eventos": []}
            semanas.append(atual)
        for e in eventos:
            if e["data"] == d:
                atual["entra" if e["tipo"] == "entrada" else "sai"] += e["valor"]
                if e["origem"] != "estimado":
                    atual["eventos"].append(e)
        sem_s += por_dia.get(d, ZERO)
        com_s = next(x["com_transferencias"] for x in serie if x["data"] == d)
        atual["saldo_fim"], atual["com_transferencias"] = q2(sem_s), com_s
        atual["menor"] = q2(min(atual["menor"], com_s) if atual["menor"] is not None else com_s)
    estimado_semana = defaultdict(lambda: ZERO)
    for e in eventos:
        if e["origem"] == "estimado":
            estimado_semana[e["data"] - timedelta(days=e["data"].weekday())] += e["valor"]
    for w in semanas:
        w["entra"], w["sai"], w["gastos_estimados"] = q2(w["entra"]), q2(w["sai"]), q2(estimado_semana.get(w["inicio"], ZERO))

    folego = (primeiro_negativo - hoje).days if primeiro_negativo else None
    return {
        "hoje": hoje, "horizonte": horizonte, "saldo_minimo": q2(minimo), "alerta": alerta,
        "kpis": {"conta_corrente": q2(saldo_corrente), "investimento": q2(saldo_invest), "entra": q2(entra), "sai": q2(sai),
                 "menor_saldo": q2(menor_sem[0]), "menor_saldo_data": menor_sem[1],
                 "menor_saldo_com_transferencias": q2(menor_com[0]), "folego_dias": folego,
                 "primeiro_dia_abaixo_minimo": primeiro_abaixo},
        "serie": serie, "realizado": realizado, "plano_transferencias": plano,
        "recebimentos_atrasados": sorted(atrasados, key=lambda e: -e["dias_atraso"]), "saidas_30_dias": saidas_30,
        "semanas": semanas,
    }


def _dias(de: date, ate: date):
    d = de
    while d <= ate:
        yield d
        d += timedelta(days=1)


def _peso_dia(db: Session, tenant_id: int, conta_ids: list[int]) -> dict[int, float]:
    """Em que dias do mês o gasto costuma cair (últimos 6 meses); sem histórico, distribui por igual."""
    desde = somar_meses(date.today().replace(day=1), -6, 1)
    peso: dict[int, float] = defaultdict(float)
    for data, valor in db.execute(select(Lancamento.data, Lancamento.valor).where(
            Lancamento.conta_id.in_(conta_ids or [0]), Lancamento.tipo == TipoLancamento.debito,
            Lancamento.origem.notin_(["transferencia", "conta_pagar"]), Lancamento.data >= desde)).all():
        peso[data.day] += float(valor)
    if not peso:
        return {}
    total = sum(peso.values())
    return {d: max(peso.get(d, 0) / total * 31, 0.2) for d in range(1, 32)}


def _realizado(db: Session, conta_ids: list[int], saldos_hoje: dict[int, Decimal], dias_atras: int) -> list[dict]:
    hoje = date.today()
    saldo = sum((saldos_hoje[i] for i in conta_ids), ZERO)
    mov: dict[date, Decimal] = defaultdict(lambda: ZERO)
    for data, tipo, valor in db.execute(select(Lancamento.data, Lancamento.tipo, Lancamento.valor).where(
            Lancamento.conta_id.in_(conta_ids or [0]), Lancamento.data > hoje - timedelta(days=dias_atras))).all():
        mov[data] += valor if tipo == TipoLancamento.credito else -valor
    serie = []
    for i in range(dias_atras):
        d = hoje - timedelta(days=i)
        serie.append({"data": d, "saldo": q2(saldo)})
        saldo -= mov.get(d, ZERO)
    return list(reversed(serie))


# ================================================================ relatório de faturamento
def relatorio_faturamento(db: Session, tenant_id: int, *, de: date | None, ate: date | None, tomador_id: int | None = None,
                          emissora_id: int | None = None, tipo: str | None = None, situacao: str | None = None) -> dict:
    from app.modules.faturamento.models import Contrato, FaturaItem
    from app.modules.rpa_nfse import fatura as faturas
    from app.modules.rpa_nfse.models import Fatura, StatusFatura, TipoFatura

    q = select(Fatura).where(Fatura.tenant_id == tenant_id)
    if de:
        q = q.where(Fatura.data_emissao >= de)
    if ate:
        q = q.where(Fatura.data_emissao <= ate)
    if tomador_id:
        q = q.where(Fatura.tomador_id == tomador_id)
    if emissora_id:
        q = q.where(Fatura.emissora_id == emissora_id)
    if tipo:
        q = q.where(Fatura.tipo == TipoFatura(tipo))
    fats = [f for f in db.scalars(q.order_by(Fatura.data_emissao)) if not situacao or faturas.situacao(f) == situacao]
    validas = [f for f in fats if f.status != StatusFatura.cancelada]

    def soma(xs):
        return q2(sum((f.total for f in xs), ZERO))

    por = {k: defaultdict(list) for k in ("cliente", "situacao", "mes", "contrato", "tipo")}
    for f in fats:
        por["situacao"][faturas.situacao(f)].append(f)
        if f.status == StatusFatura.cancelada:
            continue
        por["cliente"][(f.tomador_id, f.tomador.nome if f.tomador else "(sem cliente)")].append(f)
        por["mes"][f.data_emissao.strftime("%Y-%m")].append(f)
        por["tipo"]["NH" if f.tipo == TipoFatura.honorarios else "ND"].append(f)
        if f.contrato_id:
            por["contrato"][f.contrato_id].append(f)
    pagas = [f for f in validas if f.status == StatusFatura.paga]
    prazos = [(f.pago_em - f.data_emissao).days for f in pagas if f.pago_em]
    hoje = date.today()
    vencidas = [f for f in validas if faturas.situacao(f) == "vencida"]

    contratos = []
    for cid, xs in por["contrato"].items():
        c = db.get(Contrato, cid)
        contratos.append({"contrato_id": cid, "contrato": f"#{c.numero} {c.nome}" if c else "?",
                          "cliente": c.tomador.nome if c and c.tomador else "", "qtd": len(xs), "total": soma(xs)})
    horas: dict[str, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    ids = [f.id for f in validas]
    if ids:
        for it in db.scalars(select(FaturaItem).where(FaturaItem.fatura_id.in_(ids), FaturaItem.tipo == "hora")):
            h = horas[it.profissional or "?"]
            h[0] += it.quantidade or 0
            h[1] += it.valor
    return {
        "resumo": {"qtd": len(validas), "total": soma(validas), "pago": soma(pagas),
                   "em_aberto": soma([f for f in validas if f.status == StatusFatura.aberta]), "vencido": soma(vencidas),
                   "qtd_vencidas": len(vencidas), "canceladas": len(fats) - len(validas),
                   "ticket_medio": q2(soma(validas) / len(validas)) if validas else ZERO,
                   "prazo_medio_recebimento": round(mean(prazos)) if prazos else None,
                   "inadimplencia": q2(soma(vencidas) / soma(validas) * 100) if validas and soma(validas) else ZERO},
        "por_cliente": sorted([{"tomador_id": k[0], "cliente": k[1], "qtd": len(xs), "total": soma(xs),
                                "pago": soma([f for f in xs if f.status == StatusFatura.paga]),
                                "aberto": soma([f for f in xs if f.status == StatusFatura.aberta])}
                               for k, xs in por["cliente"].items()], key=lambda x: -x["total"]),
        "por_situacao": [{"situacao": k, "qtd": len(xs), "total": soma(xs)} for k, xs in sorted(por["situacao"].items())],
        "por_mes": [{"mes": k, "rotulo": rotulo_mes(date.fromisoformat(k + "-01")), "qtd": len(xs), "total": soma(xs),
                     "pago": soma([f for f in xs if f.status == StatusFatura.paga])} for k, xs in sorted(por["mes"].items())],
        "por_tipo": [{"tipo": k, "qtd": len(xs), "total": soma(xs)} for k, xs in sorted(por["tipo"].items())],
        "por_contrato": sorted(contratos, key=lambda x: -x["total"]),
        "horas_por_profissional": sorted([{"profissional": k, "horas": q2(v[0]), "valor": q2(v[1])} for k, v in horas.items()],
                                         key=lambda x: -x["valor"]),
        "faturas": [{"id": f.id, "codigo": f.codigo, "tipo": f.tipo.value, "cliente": f.tomador.nome if f.tomador else "",
                     "emissao": f.data_emissao, "vencimento": f.data_vencimento, "pago_em": f.pago_em, "total": f.total,
                     "situacao": faturas.situacao(f), "nfse": f.nfse.numero if f.nfse else None,
                     "dias_atraso": (hoje - f.data_vencimento).days if faturas.situacao(f) == "vencida" else 0} for f in fats],
    }


def categorias_em_uso(db: Session, tenant_id: int) -> dict[int, dict[str, int]]:
    uso: dict[int, dict[str, int]] = defaultdict(lambda: {"contas": 0, "lancamentos": 0})
    for cid, n in db.execute(select(ContaPagar.categoria_id, func.count()).where(ContaPagar.tenant_id == tenant_id)
                             .group_by(ContaPagar.categoria_id)).all():
        if cid:
            uso[cid]["contas"] += n
    from app.modules.financas.models import Rateio

    for cid, n in db.execute(select(Rateio.categoria_id, func.count()).group_by(Rateio.categoria_id)).all():
        uso[cid]["contas"] = max(uso[cid]["contas"], n)
    for cid, n in db.execute(select(Lancamento.categoria_id, func.count()).where(Lancamento.tenant_id == tenant_id)
                             .group_by(Lancamento.categoria_id)).all():
        if cid:
            uso[cid]["lancamentos"] += n
    return uso



