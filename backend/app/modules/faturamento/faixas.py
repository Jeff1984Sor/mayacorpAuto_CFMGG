"""Tabela progressiva / regressiva da regra por hora: faixas de horas do mês, cada uma com a sua forma de cobrar.

Período: o **mês do lançamento** (a contagem zera todo dia 1º) e vale para todas as horas que a regra cobre (o caso,
ou todos os casos do contrato sem regra própria). O valor não depende do período filtrado na tela.

Modos (`RegraCobranca.faixas_modo`):
- escalonada: cada faixa vale só para as horas que caem dentro dela, na ordem dos lançamentos. Um lançamento que
  cruza o limite de uma faixa é dividido: parte sai pelo preço de uma, parte pelo da outra.
- atingida: o total de horas faturáveis do mês escolhe uma faixa só, que vale para todas as horas ainda não
  faturadas. O que já foi faturado não é recalculado (por isso, neste modo, o ideal é faturar o mês fechado).

Nada é cobrado duas vezes:
- cada hora faturada (ou reservada numa revisão) guarda o trecho do mês que ocupou (`FaturaItem.faixa["trechos"]`).
  As horas novas entram no primeiro espaço livre: continuam a contagem de onde as já faturadas pararam, e se alguém
  faturar fora de ordem as faixas não são cobradas em dobro nem puladas. Cancelar a fatura libera os trechos;
- o valor fixo de uma faixa é um item próprio ("faixa:<regra>:<aaaa-mm>:<nº>", UNIQUE em `chave_cobranca`). As horas
  dentro de uma faixa de valor fixo saem com valor zero, com a explicação no detalhe do item.
"""

from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.faturamento import service
from app.modules.faturamento.models import (
    Caso,
    Contrato,
    FaturaItem,
    FormaFaixa,
    RegraCobranca,
    RegraFaixa,
    Revisao,
    RevisaoItem,
    StatusRevisao,
    Timesheet,
)

CENT = Decimal("0.01")
Trechos = list[tuple[Decimal, Decimal]]


def _q(v: Decimal) -> Decimal:
    return v.quantize(CENT, rounding=ROUND_HALF_UP)


def _horas(minutos: int) -> Decimal:
    return _q(Decimal(minutos) / 60)


def _num(v: Decimal) -> str:
    """4.50 → "4,5" · 10.00 → "10"."""
    return (f"{v:.2f}".rstrip("0").rstrip(".") or "0").replace(".", ",")


def _brl(v: Decimal) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def rotulo(f: RegraFaixa) -> str:
    return f"acima de {_num(f.de)} h" if f.ate is None else f"de {_num(f.de)} a {_num(f.ate)} h"


def resumo(regra: RegraCobranca) -> str:
    n = len(regra.faixas)
    modo = "faixa atingida" if regra.faixas_modo == "atingida" else "escalonada"
    return f"Por hora · tabela por faixas ({n} faixa{'s' if n != 1 else ''}, {modo})"


def chave_fixo(regra_id: int, mes: date, n: int) -> str:
    return f"faixa:{regra_id}:{mes:%Y-%m}:{n}"


# ---------------------------------------------------------------- posição das horas no mês
def _marcar(ocupado: Trechos, trechos: Trechos) -> None:
    ocupado.extend(trechos)
    ocupado.sort()
    juntos: Trechos = []
    for ini, fim in ocupado:
        if juntos and ini <= juntos[-1][1]:
            juntos[-1] = (juntos[-1][0], max(juntos[-1][1], fim))
        else:
            juntos.append((ini, fim))
    ocupado[:] = juntos


def _ocupar(ocupado: Trechos, horas: Decimal) -> Trechos:
    """Coloca as horas no primeiro espaço livre do mês (pode partir em mais de um trecho)."""
    trechos: Trechos = []
    pos, resto = Decimal(0), horas
    for ini, fim in ocupado:
        if resto <= 0:
            break
        if ini > pos:
            usa = min(ini - pos, resto)
            trechos.append((pos, pos + usa))
            resto -= usa
        pos = max(pos, fim)
    if resto > 0:
        trechos.append((pos, pos + resto))
    _marcar(ocupado, trechos)
    return trechos


def _ler(faixa: dict | None) -> Trechos | None:
    try:
        return [(Decimal(a), Decimal(b)) for a, b in (faixa or {}).get("trechos") or []] or None
    except (ValueError, TypeError, ArithmeticError):
        return None


def _dentro(trechos: Trechos, f: RegraFaixa) -> Decimal:
    """Quantas horas dos trechos caem dentro da faixa."""
    total = Decimal(0)
    for ini, fim in trechos:
        a, b = max(ini, f.de), fim if f.ate is None else min(fim, f.ate)
        if b > a:
            total += b - a
    return total


def _atingida(faixas: list[RegraFaixa], total: Decimal) -> tuple[int, RegraFaixa]:
    """Faixa do total do mês: 10 h cravadas ainda são da faixa "de 0 a 10 h"."""
    for n, f in enumerate(faixas, start=1):
        if f.ate is None or total <= f.ate:
            return n, f
    return len(faixas), faixas[-1]


# ---------------------------------------------------------------- cálculo
def pendentes(db: Session, tenant_id: int, regra_do_caso: dict[int, RegraCobranca], casos: dict[int, Caso],
              contratos: dict[int, Contrato], de: date, ate: date, cobradas: set[str], cache: dict) -> list:
    """Horas a faturar (e valores fixos de faixa) das regras com tabela por faixas, com data entre `de` e `ate`.

    `regra_do_caso` = {caso: regra por hora com faixas que vale para ele}. Lê o mês inteiro de cada lançamento,
    porque a posição de uma hora depende de todas as outras do mês.
    """
    if not regra_do_caso:
        return []
    inicio, fim = de.replace(day=1), service._somar_meses(ate.replace(day=1), 1, 1)
    linhas = db.execute(
        select(Timesheet, FaturaItem.faixa).outerjoin(FaturaItem, Timesheet.fatura_item_id == FaturaItem.id)
        .where(Timesheet.tenant_id == tenant_id, Timesheet.caso_id.in_(list(regra_do_caso)),
               Timesheet.faturavel | Timesheet.fatura_item_id.is_not(None), Timesheet.data >= inicio, Timesheet.data < fim)
        .order_by(Timesheet.data, Timesheet.id)).all()
    if not linhas:
        return []
    reservadas = {origem: faixa for origem, faixa in db.execute(
        select(RevisaoItem.origem_id, RevisaoItem.faixa).join(Revisao, RevisaoItem.revisao_id == Revisao.id)
        .where(Revisao.tenant_id == tenant_id, Revisao.status == StatusRevisao.em_revisao, ~RevisaoItem.excluido,
               RevisaoItem.tipo == "hora", RevisaoItem.origem_id.is_not(None)))}
    grupos: dict[tuple[int, date], list] = defaultdict(list)
    for ts, faixa_faturada in linhas:
        grupos[(regra_do_caso[ts.caso_id].id, ts.data.replace(day=1))].append((ts, faixa_faturada))
    regras = {r.id: r for r in regra_do_caso.values()}
    saida = []
    for (regra_id, mes), lancs in grupos.items():
        saida += _mes(db, regras[regra_id], mes, lancs, reservadas, casos, contratos, de, ate, cobradas, cache)
    return saida


def _mes(db, regra: RegraCobranca, mes: date, lancs: list, reservadas: dict, casos, contratos, de: date, ate: date,
         cobradas: set[str], cache: dict) -> list:
    faixas = list(regra.faixas)
    # 1) o que já tem lugar marcado (faturado ou em revisão); 2) faturado/reservado sem lugar (ex.: faturado antes de a
    # regra ter faixas, ou hora incluída na revisão com valor informado); 3) as horas pendentes, na ordem dos lançamentos
    ocupado: Trechos = []
    lugar: dict[int, Trechos] = {}
    sem_lugar, a_cobrar = [], []
    gatilho: set[int] = set()  # lançamentos que "ligam" o valor fixo (tudo menos o que foi faturado antes das faixas)
    for ts, faixa_faturada in lancs:
        if ts.fatura_item_id or ts.id in reservadas:
            trechos = _ler(faixa_faturada if ts.fatura_item_id else reservadas[ts.id])
            if trechos:
                lugar[ts.id] = trechos
                _marcar(ocupado, list(trechos))
            else:
                sem_lugar.append(ts)
            if trechos or not ts.fatura_item_id:
                gatilho.add(ts.id)
        else:
            a_cobrar.append(ts)
            gatilho.add(ts.id)
    for ts in [*sem_lugar, *a_cobrar]:
        lugar[ts.id] = _ocupar(ocupado, _horas(ts.minutos))
    total = sum((_horas(ts.minutos) for ts, _ in lancs), Decimal(0))
    atingida = _atingida(faixas, total) if regra.faixas_modo == "atingida" else None

    saida = []
    for ts in a_cobrar:
        if not de <= ts.data <= ate:
            continue
        caso = casos[ts.caso_id]
        contrato = contratos[caso.contrato_id]
        horas = _horas(ts.minutos)
        if atingida:
            partes = [(atingida[0], atingida[1], horas)]
        else:
            partes = [(n, f, h) for n, f in enumerate(faixas, start=1) if (h := _dentro(lugar[ts.id], f)) > 0]
        valor, textos, aviso, nome, fixo, taxas = Decimal(0), [], None, "?", None, set()
        for n, f, h in partes:
            if f.forma == FormaFaixa.fixo:
                fixo = fixo or chave_fixo(regra.id, mes, n)
                textos.append(f"faixa {rotulo(f)}: {_num(h)} h dentro do valor fixo de {_brl(f.valor or Decimal(0))}")
                taxas.add(Decimal(0))
                continue
            if f.forma == FormaFaixa.hora:
                vh, origem = f.valor, ""
            elif f.forma == FormaFaixa.tabela:
                vh, nome = service._valor_hora(db, f.tabela_preco_id, ts.profissional_id, cache)
                origem = f" (tabela {f.tabela_preco.nome})" if f.tabela_preco else ""
                aviso = aviso or (None if vh is not None else service._aviso_hora(nome, f.tabela_preco_id))
            else:  # percentual da tabela padrão da regra (regra → caso → contrato)
                tabela_id = service.tabela_da_regra(regra, caso, contrato)
                base, nome = service._valor_hora(db, tabela_id, ts.profissional_id, cache)
                aviso = aviso or (None if base is not None else service._aviso_hora(nome, tabela_id))
                vh = _q(base * f.percentual / 100) if base is not None else None
                origem = f" ({_num(f.percentual)}% da tabela padrão)"
            if vh is None:
                continue
            parte = _q(h * vh)
            valor += parte
            taxas.add(vh)
            textos.append(f"faixa {rotulo(f)}: {_num(h)} h × {_brl(vh)}{origem} = {_brl(parte)}")
        if nome == "?":
            nome = service._valor_hora(db, None, ts.profissional_id, cache)[1]
        texto = "; ".join(textos)
        if atingida:
            texto = f"Total do mês: {_num(total)} h → {texto}"
        # valor/hora do item: o da faixa; quando o lançamento cruza faixas, a média (só para mostrar)
        unitario = None if aviso or not taxas else (
            next(iter(taxas)) if len(taxas) == 1 else _q(valor / horas) if horas else None)
        cobertas = fixo if fixo and valor == 0 and not aviso else None  # horas inteiras dentro do valor fixo
        saida.append(service.Pendente(
            chave=f"ts:{ts.id}", tipo="hora", contrato_id=caso.contrato_id, caso_id=caso.id, data=ts.data,
            descricao=ts.descricao, quantidade=horas, valor_unitario=unitario, profissional=nome, regra_id=regra.id,
            valor=Decimal(0) if aviso else _q(valor), aviso=aviso, origem_id=ts.id, profissional_id=ts.profissional_id,
            faixa={"trechos": [[str(a), str(b)] for a, b in lugar[ts.id]], "texto": texto[:1].upper() + texto[1:],
                   "fixo": cobertas, "caso": regra.caso_id}))

    # valor fixo de faixa: um item próprio, uma vez por mês (a chave é única)
    for n, f in enumerate(faixas, start=1):
        if f.forma != FormaFaixa.fixo or (atingida and atingida[0] != n):
            continue
        chave = chave_fixo(regra.id, mes, n)
        dentro = [(ts, h) for ts, _ in lancs if ts.id in gatilho
                  and (h := _horas(ts.minutos) if atingida else _dentro(lugar[ts.id], f)) > 0]
        if chave in cobradas or not dentro:
            continue
        quando = min(ts.data for ts, _ in dentro)
        if quando > ate:
            continue
        horas_na_faixa = sum((h for _, h in dentro), Decimal(0))
        sufixo = f" · Caso #{casos[regra.caso_id].numero}" if regra.caso_id and regra.caso_id in casos else ""
        texto = (f"Valor fechado da faixa {rotulo(f)} em {mes:%m/%Y}: não muda com a quantidade de horas "
                 f"({_num(horas_na_faixa)} h até agora).")
        if atingida:
            texto = f"Total do mês: {_num(total)} h → {texto[:1].lower() + texto[1:]}"
        outra = next((c for c in cobradas if c.startswith(f"faixa:{regra.id}:{mes:%Y-%m}:")), None)
        if outra:
            texto += " Atenção: o valor fixo de outra faixa deste mês já foi faturado. Confira antes de cobrar."
        saida.append(service.Pendente(
            chave=chave, tipo="hora", contrato_id=regra.contrato_id, caso_id=regra.caso_id, data=quando,
            descricao=f"{regra.descricao} — valor fixo da faixa {rotulo(f)} ({mes:%m/%Y}){sufixo}",
            valor=f.valor or Decimal(0), regra_id=regra.id, competencia=mes,
            faixa={"trechos": [], "texto": texto, "fixo": None, "caso": regra.caso_id}))
    return saida


def absorver(db: Session, itens: list) -> int:
    """Horas (valor zero) cobertas por um valor fixo de faixa que já foi faturado: ficam ligadas ao item que cobrou
    o valor fixo, para não sobrarem em Itens a faturar. Devolve quantas foram ligadas."""
    n = 0
    for p in itens:
        chave = (p.faixa or {}).get("fixo")
        if p.tipo != "hora" or not chave or not p.origem_id or p.valor:
            continue
        item = db.scalar(select(FaturaItem).where(FaturaItem.chave_cobranca == chave))
        ts = db.get(Timesheet, p.origem_id)
        if item and ts and not ts.fatura_item_id:
            ts.fatura_item_id = item.id
            n += 1
    return n
