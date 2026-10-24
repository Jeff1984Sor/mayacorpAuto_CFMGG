"""Itens a faturar e faturamento (Honorários → NH · Despesas → ND).

O que está pendente é sempre recalculado das regras, do timesheet e das despesas — nunca guardado em
"rascunho". O que já foi cobrado está ligado a um FaturaItem (chave única por parcela), então some da lista.
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.faturamento.models import (
    Caso,
    Contrato,
    Despesa,
    FaturaItem,
    Frequencia,
    RegraCobranca,
    Revisao,
    RevisaoItem,
    StatusRevisao,
    TabelaPrecoItem,
    Termino,
    Timesheet,
    TipoRegra,
)
from app.modules.rpa_nfse.models import Emissora, Fatura, StatusFatura, TipoFatura, Tomador

LIMITE_OCORRENCIAS = 2000  # proteção contra regra diária sem fim num período enorme


class RegraFaturamento(ValueError):
    pass


# ---------------------------------------------------------------- recorrência
def _somar_meses(d: date, meses: int, dia: int) -> date:
    m = d.month - 1 + meses
    ano, mes = d.year + m // 12, m % 12 + 1
    return date(ano, mes, min(dia, calendar.monthrange(ano, mes)[1]))


def ocorrencias(regra: RegraCobranca, ate: date) -> list[tuple[int, date]]:
    """Datas das parcelas da regra recorrente até `ate`: [(nº da parcela, data)], respeitando o término."""
    if not regra.data_inicio or not regra.frequencia:
        return []
    passo = max(regra.intervalo or 1, 1)
    saida, i, atual = [], 0, regra.data_inicio
    dia = regra.data_inicio.day
    while atual <= ate and i < LIMITE_OCORRENCIAS:
        if regra.termino == Termino.ocorrencias and regra.ocorrencias and i >= regra.ocorrencias:
            break
        if regra.termino == Termino.data and regra.data_fim and atual > regra.data_fim:
            break
        saida.append((i + 1, atual))
        i += 1
        if regra.frequencia == Frequencia.diaria:
            atual = regra.data_inicio + timedelta(days=passo * i)
        elif regra.frequencia == Frequencia.semanal:
            atual = regra.data_inicio + timedelta(weeks=passo * i)
        elif regra.frequencia == Frequencia.mensal:
            atual = _somar_meses(regra.data_inicio, passo * i, dia)
        else:
            atual = _somar_meses(regra.data_inicio, 12 * passo * i, dia)
    return saida


def total_parcelas(regra: RegraCobranca) -> int | None:
    if regra.termino == Termino.ocorrencias:
        return regra.ocorrencias
    if regra.termino == Termino.data and regra.data_fim:
        return len(ocorrencias(regra, regra.data_fim))
    return None


def chave_parcela(regra_id: int, competencia: date) -> str:
    return f"regra:{regra_id}:{competencia.isoformat()}"


# ---------------------------------------------------------------- pendências
@dataclass
class Pendente:
    chave: str  # regra:<id>:<data> · ts:<id> · desp:<id>
    tipo: str  # fixo | recorrente | hora | despesa
    contrato_id: int
    caso_id: int | None
    data: date
    descricao: str
    valor: Decimal
    regra_id: int | None = None
    competencia: date | None = None
    parcela: str | None = None  # "3/12"
    quantidade: Decimal | None = None
    valor_unitario: Decimal | None = None
    profissional: str | None = None
    aviso: str | None = None  # ex.: sem valor/hora para a categoria
    origem_id: int | None = None  # timesheet ou despesa
    profissional_id: int | None = None


@dataclass
class ClientePendente:
    tomador: Tomador
    contratos: dict[int, list[Pendente]] = field(default_factory=lambda: defaultdict(list))

    @property
    def total(self) -> Decimal:
        return sum((p.valor for itens in self.contratos.values() for p in itens), Decimal(0))


def _valor_hora(db: Session, tabela_id: int | None, profissional_id: int, cache: dict) -> tuple[Decimal | None, str]:
    """Valor/hora = tabela de preço escolhida × categoria do profissional."""
    chave = (tabela_id, profissional_id)
    if chave in cache:
        return cache[chave]
    prof = db.get(Usuario, profissional_id)
    nome = prof.nome if prof else "?"
    valor = None
    if tabela_id and prof and prof.cargo_id:
        item = db.scalar(select(TabelaPrecoItem).where(TabelaPrecoItem.tabela_id == tabela_id,
                                                       TabelaPrecoItem.cargo_id == prof.cargo_id))
        valor = item.valor_hora if item else None
    cache[chave] = (valor, nome)
    return cache[chave]


def tabela_da_regra(regra: RegraCobranca, caso: Caso | None, contrato: Contrato) -> int | None:
    """A tabela vem da regra; se vazia, do caso; se vazia, do contrato."""
    return regra.tabela_preco_id or (caso.tabela_preco_id if caso else None) or contrato.tabela_preco_id


def _aviso_hora(nome: str, tabela_id: int | None) -> str:
    if not tabela_id:
        return "Escolha a tabela de preço no contrato ou no caso"
    return f"{nome} sem cargo ou cargo sem valor/hora na tabela de preço"


def reservadas(db: Session, tenant_id: int, exceto_revisao: int | None = None) -> set[str]:
    """Chaves que estão em alguma revisão aberta (não aparecem em Itens a faturar)."""
    q = (select(RevisaoItem.chave).join(Revisao, RevisaoItem.revisao_id == Revisao.id)
         .where(Revisao.tenant_id == tenant_id, Revisao.status == StatusRevisao.em_revisao, ~RevisaoItem.excluido))
    if exceto_revisao:
        q = q.where(Revisao.id != exceto_revisao)
    return set(db.scalars(q))


def pendencias(db: Session, tenant_id: int, *, aba: str, de: date, ate: date, cliente_ids: list[int] | None = None,
               tipos: set[str] | None = None, contrato_ids: list[int] | None = None,
               exceto_revisao: int | None = None) -> list[ClientePendente]:
    """O que pode ser faturado no período, por cliente e contrato (fora o que já está em revisão)."""
    q = select(Contrato).where(Contrato.tenant_id == tenant_id, Contrato.ativo)
    if cliente_ids:
        q = q.where(Contrato.tomador_id.in_(cliente_ids))
    if contrato_ids:
        q = q.where(Contrato.id.in_(contrato_ids))
    contratos = list(db.scalars(q))
    if not contratos:
        return []
    ids = [c.id for c in contratos]
    por_cliente: dict[int, ClientePendente] = {}
    em_revisao = reservadas(db, tenant_id, exceto_revisao)

    def add(contrato: Contrato, p: Pendente):
        if p.chave in em_revisao:
            return
        cp = por_cliente.setdefault(contrato.tomador_id, ClientePendente(db.get(Tomador, contrato.tomador_id)))
        cp.contratos[contrato.id].append(p)

    por_id = {c.id: c for c in contratos}
    casos = {c.id: c for c in db.scalars(select(Caso).where(Caso.contrato_id.in_(ids)))}

    if aba == "despesas":
        for d in db.scalars(select(Despesa).where(
                Despesa.tenant_id == tenant_id, Despesa.caso_id.in_(list(casos) or [0]), Despesa.reembolsavel,
                Despesa.fatura_item_id.is_(None), Despesa.data >= de, Despesa.data <= ate).order_by(Despesa.data)):
            caso = casos[d.caso_id]
            add(por_id[caso.contrato_id], Pendente(
                chave=f"desp:{d.id}", tipo="despesa", contrato_id=caso.contrato_id, caso_id=caso.id, data=d.data,
                descricao=f"{d.tipo.value.replace('_', ' ').capitalize()} — {d.descricao}", valor=d.valor, origem_id=d.id))
        return _ordenar(por_cliente)

    tipos = tipos or {"fixo", "recorrente", "hora"}
    regras = list(db.scalars(select(RegraCobranca).where(RegraCobranca.contrato_id.in_(ids), RegraCobranca.ativo)))
    cobradas = set(db.scalars(select(FaturaItem.chave_cobranca).where(FaturaItem.chave_cobranca.is_not(None),
                                                                          FaturaItem.regra_id.in_([r.id for r in regras] or [0]))))
    for r in regras:
        contrato = por_id[r.contrato_id]
        sufixo = f" · Caso #{casos[r.caso_id].numero}" if r.caso_id and r.caso_id in casos else ""
        if r.tipo == TipoRegra.fixo and "fixo" in tipos and r.data_pagamento and de <= r.data_pagamento <= ate:
            chave = chave_parcela(r.id, r.data_pagamento)
            if chave not in cobradas:
                add(contrato, Pendente(chave=chave, tipo="fixo", contrato_id=r.contrato_id, caso_id=r.caso_id,
                                       data=r.data_pagamento, descricao=r.descricao + sufixo, valor=r.valor or Decimal(0),
                                       regra_id=r.id, competencia=r.data_pagamento))
        elif r.tipo == TipoRegra.recorrente and "recorrente" in tipos:
            total = total_parcelas(r)
            for n, quando in ocorrencias(r, ate):
                chave = chave_parcela(r.id, quando)
                if quando < de or chave in cobradas:
                    continue
                parcela = f"{n}/{total}" if total else f"{n}"
                add(contrato, Pendente(chave=chave, tipo="recorrente", contrato_id=r.contrato_id, caso_id=r.caso_id,
                                       data=quando, descricao=f"{r.descricao} — parcela {parcela}{sufixo}",
                                       valor=r.valor or Decimal(0), regra_id=r.id, competencia=quando, parcela=parcela))

    if "hora" in tipos:
        # regra por hora do caso vence a do contrato
        hora_contrato = {r.contrato_id: r for r in regras if r.tipo == TipoRegra.hora and r.caso_id is None}
        hora_caso = {r.caso_id: r for r in regras if r.tipo == TipoRegra.hora and r.caso_id}
        caso_com_regra_propria = {r.caso_id for r in regras if r.caso_id}
        cache: dict = {}
        for ts in db.scalars(select(Timesheet).where(
                Timesheet.tenant_id == tenant_id, Timesheet.caso_id.in_(list(casos) or [0]), Timesheet.faturavel,
                Timesheet.fatura_item_id.is_(None), Timesheet.data >= de, Timesheet.data <= ate).order_by(Timesheet.data)):
            caso = casos[ts.caso_id]
            regra = hora_caso.get(caso.id) or (None if caso.id in caso_com_regra_propria else hora_contrato.get(caso.contrato_id))
            if not regra:
                continue  # caso sem cobrança por hora: as horas ficam só como controle
            horas = (Decimal(ts.minutos) / 60).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            tabela_id = tabela_da_regra(regra, caso, por_id[caso.contrato_id])
            vh, nome = _valor_hora(db, tabela_id, ts.profissional_id, cache)
            add(por_id[caso.contrato_id], Pendente(
                chave=f"ts:{ts.id}", tipo="hora", contrato_id=caso.contrato_id, caso_id=caso.id, data=ts.data,
                descricao=ts.descricao, quantidade=horas, valor_unitario=vh, profissional=nome, regra_id=regra.id,
                valor=(horas * vh).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if vh is not None else Decimal(0),
                aviso=None if vh is not None else _aviso_hora(nome, tabela_id),
                origem_id=ts.id, profissional_id=ts.profissional_id))
    return _ordenar(por_cliente)


def _ordenar(por_cliente: dict[int, ClientePendente]) -> list[ClientePendente]:
    for cp in por_cliente.values():
        for itens in cp.contratos.values():
            itens.sort(key=lambda p: (p.data, p.chave))
    return sorted((cp for cp in por_cliente.values() if cp.contratos), key=lambda c: c.tomador.nome)


# ---------------------------------------------------------------- faturar
def criar_fatura(db: Session, tenant_id: int, contrato: Contrato, sel: list[Pendente], tipo: TipoFatura, *,
                 dias_vencimento: int = 10, vencimento_na_emissao: bool = False, observacao: str | None = None) -> Fatura:
    from app.modules.rpa_nfse import fatura as faturas
    from app.modules.rpa_nfse.service import config_nfse

    sem_valor = [p for p in sel if p.aviso]
    if sem_valor:
        raise RegraFaturamento(f"Há itens sem valor definido: {sem_valor[0].aviso}. Ajuste a tabela de preço.")
    emissora_id = contrato.emissora_id or db.scalar(
        select(Emissora.id).where(Emissora.tenant_id == tenant_id, Emissora.ativa).order_by(Emissora.id))
    if not emissora_id:
        raise RegraFaturamento("Cadastre a empresa emissora antes de faturar.")
    valor = sum((p.valor for p in sel), Decimal(0))
    if valor <= 0:
        raise RegraFaturamento("A fatura ficaria com valor zero.")
    hoje = date.today()
    fat = Fatura(
        tenant_id=tenant_id, emissora_id=emissora_id, nfse_id=None, tipo=tipo, origem="faturamento",
        contrato_id=contrato.id, tomador_id=contrato.tomador_id, ano=hoje.year,
        numero=faturas.proximo_numero(db, emissora_id, hoje.year, tipo), data_emissao=hoje,
        data_vencimento=hoje if vencimento_na_emissao else hoje + timedelta(days=dias_vencimento),
        descricao=_descricao(contrato, sel, tipo), valor=valor, observacao=observacao,
    )
    db.add(fat)
    db.flush()
    for p in sel:
        item = FaturaItem(
            fatura_id=fat.id, tipo=p.tipo, regra_id=p.regra_id, caso_id=p.caso_id, competencia=p.competencia,
            chave_cobranca=p.chave if p.tipo in ("fixo", "recorrente") else None, data=p.data,
            descricao=p.descricao, profissional=p.profissional, quantidade=p.quantidade,
            valor_unitario=p.valor_unitario, valor=p.valor)
        db.add(item)
        db.flush()
        modelo = Timesheet if p.tipo == "hora" else Despesa if p.tipo == "despesa" else None
        if modelo:
            origem = db.get(modelo, p.origem_id)
            if not origem or origem.fatura_item_id:
                raise RegraFaturamento(f"“{p.descricao[:60]}” já foi faturado ou excluído. Atualize a tela.")
            origem.fatura_item_id = item.id
    db.flush()
    db.refresh(fat)
    faturas.salvar_pdf(db, fat, config_nfse(db, tenant_id))
    return fat


def faturar(db: Session, tenant_id: int, *, aba: str, de: date, ate: date, chaves: list[str],
            cliente_ids: list[int] | None = None, tipos: set[str] | None = None, dias_vencimento: int = 10,
            vencimento_na_emissao: bool = False) -> list[Fatura]:
    """Cria uma fatura por contrato com os itens escolhidos (NH para honorários, ND para despesas)."""
    tipo = TipoFatura.despesas if aba == "despesas" else TipoFatura.honorarios
    criadas: list[Fatura] = []
    for contrato, sel in _escolhidos(db, tenant_id, aba, de, ate, chaves, cliente_ids, tipos):
        criadas.append(criar_fatura(db, tenant_id, contrato, sel, tipo, dias_vencimento=dias_vencimento,
                                    vencimento_na_emissao=vencimento_na_emissao))
    return criadas


def _escolhidos(db, tenant_id, aba, de, ate, chaves, cliente_ids, tipos) -> list[tuple[Contrato, list[Pendente]]]:
    escolhidas = set(chaves)
    if not escolhidas:
        raise RegraFaturamento("Selecione ao menos um item.")
    saida = []
    for cp in pendencias(db, tenant_id, aba=aba, de=de, ate=ate, cliente_ids=cliente_ids, tipos=tipos):
        for contrato_id, itens in cp.contratos.items():
            sel = [p for p in itens if p.chave in escolhidas]
            if sel:
                saida.append((db.get(Contrato, contrato_id), sel))
    if not saida:
        raise RegraFaturamento("Os itens escolhidos não estão mais pendentes. Atualize a lista.")
    return saida


# ---------------------------------------------------------------- revisão (pré-fatura)
def enviar_revisao(db: Session, tenant_id: int, usuario: Usuario, *, aba: str, de: date, ate: date, chaves: list[str],
                   cliente_ids: list[int] | None = None, tipos: set[str] | None = None) -> list[Revisao]:
    """Uma revisão por contrato; os itens ficam reservados até aprovar ou descartar."""
    from sqlalchemy import func

    criadas = []
    numero = db.scalar(select(func.max(Revisao.numero)).where(Revisao.tenant_id == tenant_id)) or 0
    for contrato, sel in _escolhidos(db, tenant_id, aba, de, ate, chaves, cliente_ids, tipos):
        numero += 1
        rev = Revisao(tenant_id=tenant_id, numero=numero, aba=aba, contrato_id=contrato.id, tomador_id=contrato.tomador_id,
                      de=de, ate=ate, criado_por_id=usuario.id, responsavel_id=usuario.id, eventos=[])
        rev.itens = [_item_de(p) for p in sel]
        rev.evento(f"Enviada para revisão com {len(sel)} item(ns).", usuario.nome)
        db.add(rev)
        criadas.append(rev)
    db.flush()
    return criadas


def _item_de(p: Pendente, manual: bool = False) -> RevisaoItem:
    return RevisaoItem(chave=p.chave, tipo=p.tipo, regra_id=p.regra_id, caso_id=p.caso_id, competencia=p.competencia,
                       parcela=p.parcela, data=p.data, descricao=p.descricao, profissional=p.profissional,
                       profissional_id=p.profissional_id,
                       quantidade=p.quantidade, valor_unitario=p.valor_unitario, valor=p.valor, valor_original=p.valor,
                       origem_id=p.origem_id, manual=manual)


def disponiveis_para_revisao(db: Session, rev: Revisao) -> list[Pendente]:
    """O que ainda está pendente no contrato e pode entrar nesta revisão."""
    ja = {i.chave for i in rev.itens if not i.excluido}
    dados = pendencias(db, rev.tenant_id, aba=rev.aba, de=date(1900, 1, 1), ate=max(rev.ate, date.today()),
                       contrato_ids=[rev.contrato_id], exceto_revisao=rev.id)
    return [p for cp in dados for itens in cp.contratos.values() for p in itens if p.chave not in ja]


def incluir_na_revisao(db: Session, rev: Revisao, chaves: list[str]) -> int:
    escolhidas = set(chaves)
    n = 0
    for p in disponiveis_para_revisao(db, rev):
        if p.chave not in escolhidas:
            continue
        antigo = next((i for i in rev.itens if i.chave == p.chave), None)
        if antigo:  # estava excluído: volta
            antigo.excluido = False
        else:
            rev.itens.append(_item_de(p, manual=True))
        n += 1
    return n


def valor_hora_do_caso(db: Session, caso: Caso, profissional_id: int) -> Decimal | None:
    regras = list(db.scalars(select(RegraCobranca).where(RegraCobranca.contrato_id == caso.contrato_id, RegraCobranca.ativo)))
    proprias = [r for r in regras if r.caso_id == caso.id]
    regra = next((r for r in proprias if r.tipo == TipoRegra.hora), None)
    if not regra and not proprias:
        regra = next((r for r in regras if r.tipo == TipoRegra.hora and r.caso_id is None), None)
    if not regra:
        return None
    return _valor_hora(db, tabela_da_regra(regra, caso, caso.contrato), profissional_id, {})[0]


def adicionar_horas(db: Session, rev: Revisao, *, caso_id: int, profissional_id: int, data: date, minutos: int, descricao: str,
                    valor_hora: Decimal | None) -> RevisaoItem:
    """Lança as horas no caso (timesheet de verdade) e já coloca na revisão."""
    caso = db.get(Caso, caso_id)
    if not caso or caso.contrato_id != rev.contrato_id:
        raise RegraFaturamento("O caso precisa ser deste contrato.")
    vh = valor_hora if valor_hora is not None else valor_hora_do_caso(db, caso, profissional_id)
    if vh is None:
        raise RegraFaturamento("Não achei o valor/hora (regra por hora, tabela de preço ou categoria do profissional). "
                               "Informe o valor/hora.")
    ts = Timesheet(tenant_id=rev.tenant_id, caso_id=caso.id, profissional_id=profissional_id, data=data, minutos=minutos,
                   descricao=descricao, faturavel=True)
    db.add(ts)
    db.flush()
    horas = (Decimal(minutos) / 60).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    valor = (horas * vh).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    prof = db.get(Usuario, profissional_id)
    item = RevisaoItem(chave=f"ts:{ts.id}", tipo="hora", caso_id=caso.id, data=data, descricao=descricao,
                       profissional=prof.nome if prof else None, profissional_id=profissional_id, quantidade=horas, valor_unitario=vh, valor=valor,
                       valor_original=valor, origem_id=ts.id, manual=True)
    rev.itens.append(item)
    db.flush()
    return item


def adicionar_lancamento(db: Session, rev: Revisao, usuario: Usuario, *, data: date, descricao: str, valor: Decimal,
                         caso_id: int | None, tipo_despesa=None) -> RevisaoItem:
    """Honorários: lançamento avulso só desta fatura. Despesas: vira despesa do caso (com histórico)."""
    import uuid

    if caso_id:
        caso = db.get(Caso, caso_id)
        if not caso or caso.contrato_id != rev.contrato_id:
            raise RegraFaturamento("O caso precisa ser deste contrato.")
    if rev.aba == "despesas":
        if not caso_id:
            raise RegraFaturamento("Escolha o caso da despesa.")
        from app.modules.faturamento.models import TipoDespesa

        d = Despesa(tenant_id=rev.tenant_id, caso_id=caso_id, data=data, tipo=tipo_despesa or TipoDespesa.outros,
                    descricao=descricao, valor=valor, reembolsavel=True, lancado_por_id=usuario.id)
        db.add(d)
        db.flush()
        item = RevisaoItem(chave=f"desp:{d.id}", tipo="despesa", caso_id=caso_id, data=data,
                           descricao=f"{d.tipo.value.replace('_', ' ').capitalize()} — {descricao}", valor=valor,
                           valor_original=valor, origem_id=d.id, manual=True)
    else:
        item = RevisaoItem(chave=f"avulso:{uuid.uuid4().hex[:16]}", tipo="avulso", caso_id=caso_id, data=data,
                           descricao=descricao, valor=valor, valor_original=valor, manual=True)
    rev.itens.append(item)
    db.flush()
    return item


def alterar_item(db: Session, item: RevisaoItem, *, descricao: str | None = None, quantidade: Decimal | None = None,
                 valor: Decimal | None = None, excluido: bool | None = None) -> None:
    if descricao is not None:
        item.descricao = descricao
        if item.tipo == "hora" and item.origem_id and (ts := db.get(Timesheet, item.origem_id)):
            ts.descricao = descricao
    if quantidade is not None and item.tipo == "hora":
        item.quantidade = quantidade
        if item.valor_unitario is not None:
            item.valor = (quantidade * item.valor_unitario).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if item.origem_id and (ts := db.get(Timesheet, item.origem_id)):
            ts.minutos = int((quantidade * 60).to_integral_value(rounding=ROUND_HALF_UP))
    if valor is not None:
        item.valor = valor
    if excluido is not None:
        item.excluido = excluido


def remover_item(db: Session, item: RevisaoItem, apagar_lancamento: bool) -> None:
    """Tira da fatura. Horas/despesas podem também ser apagadas do caso; parcelas de regra voltam a ficar pendentes."""
    if item.tipo == "avulso":
        db.delete(item)
        return
    if apagar_lancamento and item.tipo in ("hora", "despesa") and item.origem_id:
        modelo = Timesheet if item.tipo == "hora" else Despesa
        origem = db.get(modelo, item.origem_id)
        if origem and not origem.fatura_item_id:
            db.delete(origem)
        db.delete(item)
        return
    item.excluido = True


def aprovar(db: Session, rev: Revisao, usuario: Usuario, *, dias_vencimento: int, vencimento_na_emissao: bool) -> Fatura:
    if rev.status != StatusRevisao.em_revisao:
        raise RegraFaturamento("Esta revisão já foi concluída.")
    ativos = [i for i in rev.itens if not i.excluido]
    if not ativos:
        raise RegraFaturamento("Não sobrou nenhum item: descarte a revisão.")
    sel = [Pendente(chave=i.chave, tipo=i.tipo, contrato_id=rev.contrato_id, caso_id=i.caso_id, data=i.data,
                    descricao=i.descricao, valor=i.valor, regra_id=i.regra_id, competencia=i.competencia,
                    parcela=i.parcela, quantidade=i.quantidade, valor_unitario=i.valor_unitario,
                    profissional=i.profissional, origem_id=i.origem_id) for i in ativos]
    tipo = TipoFatura.despesas if rev.aba == "despesas" else TipoFatura.honorarios
    fat = criar_fatura(db, rev.tenant_id, rev.contrato, sel, tipo, dias_vencimento=dias_vencimento,
                       vencimento_na_emissao=vencimento_na_emissao, observacao=rev.observacao)
    rev.status, rev.fatura_id, rev.concluida_em = StatusRevisao.faturada, fat.id, date.today()
    rev.evento(f"Aprovada: gerada a fatura {fat.codigo}.", usuario.nome)
    return fat


def descartar(rev: Revisao, usuario: Usuario, motivo: str | None) -> None:
    if rev.status != StatusRevisao.em_revisao:
        raise RegraFaturamento("Esta revisão já foi concluída.")
    rev.status, rev.concluida_em = StatusRevisao.descartada, date.today()
    rev.evento(f"Descartada{': ' + motivo if motivo else ''}. Os itens voltaram para Itens a faturar.", usuario.nome)


def analisar_com_ia(db: Session, rev: Revisao) -> dict:
    """Revisor de faturas: aponta riscos e sugere textos melhores (nada é aplicado sem o usuário aceitar)."""
    import json

    from app.core import ia

    ativos = [i for i in rev.itens if not i.excluido]
    contrato = rev.contrato
    regras = list(db.scalars(select(RegraCobranca).where(RegraCobranca.contrato_id == contrato.id, RegraCobranca.ativo)))
    dados = {
        "cliente": contrato.tomador.nome if contrato.tomador else "", "contrato": f"#{contrato.numero} {contrato.nome}",
        "objeto": contrato.objeto, "periodo": f"{rev.de:%d/%m/%Y} a {rev.ate:%d/%m/%Y}",
        "tipo": "Nota de Despesas (reembolso)" if rev.aba == "despesas" else "Nota de Honorários",
        "regras": [{"tipo": r.tipo.value, "descricao": r.descricao, "valor": str(r.valor or "")} for r in regras],
        "itens": [{"id": i.id, "tipo": i.tipo, "data": i.data.isoformat(), "descricao": i.descricao,
                   "profissional": i.profissional, "horas": str(i.quantidade or ""), "valor_hora": str(i.valor_unitario or ""),
                   "valor": str(i.valor), "caso": i.caso.titulo if i.caso else None} for i in ativos],
        "total": str(sum((i.valor for i in ativos), Decimal(0))),
    }
    sistema = (
        "Você é revisor(a) de faturamento de um escritório de advocacia brasileiro. Analise a pré-fatura e responda "
        'SOMENTE JSON: {"resumo": str (2-3 frases), "nota": int 0-100 (qualidade/prontidão para enviar ao cliente), '
        '"alertas": [{"item_id": int|null, "nivel": "alto"|"medio"|"baixo", "texto": str}], '
        '"sugestoes": [{"item_id": int, "descricao": str, "motivo": str}], "texto_fatura": str}. '
        "Procure: lançamentos duplicados ou parecidos no mesmo dia, horas excessivas (>10h/dia por profissional), "
        "descrições vagas ('reunião', 'análise'), termos internos ou informais, valores zerados ou fora do padrão, "
        "itens fora do período, despesas sem descrição clara. Sugira descrições profissionais e objetivas em português, "
        "sem inventar fatos. `texto_fatura` = observação curta e cordial para o cliente."
    )
    p = ia.provedor_ativo(db, rev.tenant_id)
    res = ia.gerar_json(p, sistema, json.dumps(dados, ensure_ascii=False))
    ids = {i.id for i in ativos}
    res["alertas"] = [a for a in res.get("alertas") or [] if a.get("item_id") in ids or a.get("item_id") is None]
    res["sugestoes"] = [s for s in res.get("sugestoes") or [] if s.get("item_id") in ids and s.get("descricao")]
    rev.ia_analise = res
    return res


def _descricao(contrato: Contrato, itens: list[Pendente], tipo: TipoFatura) -> str:
    """Texto da fatura — e, para honorários, a discriminação da futura NFS-e."""
    if tipo == TipoFatura.despesas:
        return f"Reembolso de despesas — contrato #{contrato.numero} {contrato.nome}"
    linhas = [f"Honorários advocatícios — {contrato.nome}"]
    horas = [p for p in itens if p.tipo == "hora"]
    outros = [p for p in itens if p.tipo != "hora"]
    linhas += [f"- {p.descricao}" for p in outros]
    if horas:
        total_h = sum((p.quantidade or 0 for p in horas), Decimal(0))
        linhas.append(f"- Serviços por hora: {total_h:.2f} h ({min(p.data for p in horas):%d/%m/%Y} a "
                      f"{max(p.data for p in horas):%d/%m/%Y})".replace(".", ","))
    return "\n".join(linhas)


def cancelar(db: Session, fat: Fatura, motivo: str) -> None:
    """Cancela a fatura e solta os itens: parcelas, horas e despesas voltam a aparecer em Itens a faturar."""
    if fat.nfse_id:
        raise RegraFaturamento("Esta fatura já tem NFS-e: cancele a nota (a fatura acompanha).")
    if fat.status == StatusFatura.paga:
        raise RegraFaturamento("Fatura paga não pode ser cancelada. Desfaça o pagamento antes.")
    for item in list(getattr(fat, "itens", []) or []):
        for modelo in (Timesheet, Despesa):
            for obj in db.scalars(select(modelo).where(modelo.fatura_item_id == item.id)):
                obj.fatura_item_id = None
        db.delete(item)
    fat.status = StatusFatura.cancelada
    from app.modules.rpa_nfse.fatura import espelhar_no_financeiro

    espelhar_no_financeiro(db, fat)
    fat.observacao = ((fat.observacao or "") + f"\nCancelada: {motivo}").strip()


# ---------------------------------------------------------------- NFS-e a partir das faturas (NH)
def emitir_nfse(db: Session, tenant_id: int, usuario_id: int, faturas_ids: list[int]):
    """Monta um lote de RPS (um por fatura NH sem nota) para o robô: segue a mesma pré-validação da Lello."""
    import hashlib

    from app.modules.rpa_nfse import service as nfse
    from app.modules.rpa_nfse.models import Lote, Rps, StatusLote, StatusRps
    from app.modules.rpa_nfse.prefeitura_sp.xml_layout2 import MUNICIPIO_SP

    fats = list(db.scalars(select(Fatura).where(Fatura.tenant_id == tenant_id, Fatura.id.in_(faturas_ids))))
    if not fats:
        raise RegraFaturamento("Selecione ao menos uma fatura.")
    for f in fats:
        if f.tipo == TipoFatura.despesas:
            raise RegraFaturamento(f"{f.codigo} é uma Nota de Despesas: reembolso não gera NFS-e.")
        if f.nfse_id:
            raise RegraFaturamento(f"{f.codigo} já tem NFS-e.")
        if f.status == StatusFatura.cancelada:
            raise RegraFaturamento(f"{f.codigo} está cancelada.")
    emissoras = {f.emissora_id for f in fats}
    if len(emissoras) > 1:
        raise RegraFaturamento("Selecione faturas de uma única empresa emissora por vez.")
    emissora = db.get(Emissora, emissoras.pop())
    assinatura = hashlib.sha256(f"faturas:{sorted(faturas_ids)}:{date.today()}".encode()).hexdigest()
    lote = Lote(tenant_id=tenant_id, numero=nfse.proximo_numero_lote(db, tenant_id), emissora_id=emissora.id,
                usuario_id=usuario_id, arquivo_origem=f"{len(fats)} fatura(s) de honorários", hash_arquivo=assinatura,
                status=StatusLote.validando, eventos=[])
    lote.evento("upload", f"Lote montado a partir das faturas {', '.join(f.codigo for f in fats)}.")
    db.add(lote)
    db.flush()
    for i, f in enumerate(fats, start=1):
        t = f.tomador
        doc = t.cpf_cnpj if t else None
        tom = {"tipo": t.tipo if t else "EX", "nome": t.nome if t else "", "cpf_cnpj": doc, "im": t.im if t else None,
               "ie": t.ie if t else None, "tipo_logradouro": t.tipo_logradouro if t else None,
               "logradouro": t.logradouro if t else None, "numero": t.numero if t else None,
               "complemento": t.complemento if t else None, "bairro": t.bairro if t else None,
               "cidade": t.cidade if t else None, "uf": t.uf if t else None, "cep": t.cep if t else None,
               "email": (t.emails or [None])[0] if t else None,
               "codigo_municipio": MUNICIPIO_SP if t and nfse._normaliza(t.cidade) == "SAO PAULO" else None}
        numero = emissora.prox_rps
        emissora.prox_rps += 1
        db.add(Rps(lote_id=lote.id, emissora_id=emissora.id, linha=i, tipo_rps="RPS", serie=emissora.serie_rps,
                   numero=numero, data_emissao=date.today(), situacao="T", tomador_id=t.id if t else None,
                   tomador_novo=False, cod_servico=emissora.cod_servico_padrao or "", aliquota=emissora.aliquota_iss,
                   valor=f.total, deducoes=Decimal(0), iss=Decimal(0), iss_retido=False, discriminacao=f.descricao,
                   dados_json={"tomador": tom, "fatura_id": f.id, "problemas_leitura": []}, status=StatusRps.ok,
                   erros_json=[]))
    db.flush()
    db.refresh(lote)
    nfse.revalidar(db, lote)
    lote.evento("validacao", f"Pré-validação concluída: {nfse.resumo(lote).com_erro} com erro.")
    return lote
