"""Conciliação: cada crédito do extrato é casado com as notas em aberto e recebe uma confiança de 0 a 100.

Ordem das tentativas (a primeira que fechar vence):
  1. Valor exato de UMA nota, com CNPJ ou nome do cliente na descrição ......... 97
  2. Valor exato de UMA nota, única em aberto com esse valor .................... 88
  3. Soma exata de um LOTE inteiro em aberto (a Lello paga em bloco) ............ 92
  4. Soma exata das notas em aberto de UM cliente citado na descrição ............ 90
  5. Valor exato, mas várias notas possíveis (sugere a mais antiga) ............... 60
  6. Combinação de notas que soma o valor (até 12 notas, mesmo lote) .............. 70
Acima da confiança mínima (Configurações, padrão 85) a baixa é automática, com a data do crédito.
"""

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import agora
from app.core.documentos import so_digitos
from app.modules.rpa_nfse import extrato as leitor
from app.modules.rpa_nfse.models import (
    Extrato,
    LancamentoExtrato,
    Nfse,
    StatusLancamento,
    StatusNfse,
)

FOLGA_DIAS = 5  # crédito pode cair até 5 dias "antes" da emissão registrada (fuso, emissão retroativa)


def _norm(t: str) -> str:
    return leitor._norm(t)


def _abertas(db: Session, tenant_id: int, excluir: set[int]) -> list[Nfse]:
    q = (
        select(Nfse)
        .where(Nfse.tenant_id == tenant_id, Nfse.status == StatusNfse.emitida, Nfse.pago_em.is_(None))
        .order_by(Nfse.data_emissao)
    )
    return [n for n in db.scalars(q) if n.id not in excluir]


def _citado(n: Nfse, desc_norm: str, desc_dig: str) -> bool:
    tom = (n.rps.dados_json or {}).get("tomador", {})
    doc = tom.get("cpf_cnpj") or ""
    if doc and (doc in desc_dig or (len(doc) == 14 and doc[:8] in desc_dig)):
        return True
    nome = _norm(tom.get("nome") or "")
    palavras = [p for p in nome.split() if len(p) > 3 and p not in ("condominio", "edificio", "residencial", "ltda")]
    return bool(palavras) and all(p in desc_norm for p in palavras[:3])


def casar(credito: leitor.Credito, abertas: list[Nfse]) -> tuple[int, list[Nfse], str]:
    limite = credito.data + timedelta(days=FOLGA_DIAS)
    cand = [n for n in abertas if n.data_emissao.date() <= limite]
    desc_norm, desc_dig = _norm(credito.descricao), so_digitos(credito.descricao)
    exatas = [n for n in cand if n.valor == credito.valor]

    citadas = [n for n in exatas if _citado(n, desc_norm, desc_dig)]
    if len(citadas) == 1:
        return 97, citadas, "Valor exato e cliente identificado na descrição"
    if len(exatas) == 1:
        return 88, exatas, "Única nota em aberto com este valor"

    por_lote: dict[int, list[Nfse]] = defaultdict(list)
    for n in cand:
        por_lote[n.rps.lote_id].append(n)
    for _lote, notas in sorted(por_lote.items()):
        if len(notas) > 1 and sum(n.valor for n in notas) == credito.valor:
            return 92, notas, f"Pagamento do lote inteiro ({len(notas)} notas)"

    por_cliente: dict[str, list[Nfse]] = defaultdict(list)
    for n in cand:
        if _citado(n, desc_norm, desc_dig):
            por_cliente[(n.rps.dados_json or {}).get("tomador", {}).get("cpf_cnpj") or ""].append(n)
    for notas in por_cliente.values():
        if len(notas) > 1 and sum(n.valor for n in notas) == credito.valor:
            return 90, notas, f"Soma das {len(notas)} notas em aberto do cliente"

    if exatas:
        return 60, [exatas[0]], f"{len(exatas)} notas com este valor; sugerida a mais antiga"

    for notas in por_lote.values():
        combo = _combinacao(notas, credito.valor)
        if combo:
            return 70, combo, f"Combinação de {len(combo)} notas do mesmo lote soma o valor"
    return 0, [], "Nenhuma nota em aberto bate com este crédito"


def _combinacao(notas: list[Nfse], alvo: Decimal) -> list[Nfse] | None:
    """Pares e trios que somam exatamente o alvo, no lote inteiro (busca exata com índice por valor)."""
    pequenas = [n for n in notas if n.valor < alvo]
    por_valor: dict[Decimal, list[Nfse]] = defaultdict(list)
    for n in pequenas:
        por_valor[n.valor].append(n)

    def achar(falta: Decimal, usados: set[int]) -> Nfse | None:
        return next((n for n in por_valor.get(falta, []) if n.id not in usados), None)

    for a in pequenas:
        if (b := achar(alvo - a.valor, {a.id})):
            return [a, b]
    if len(pequenas) <= 600:  # trios: O(n²) com índice
        for a, b in combinations(pequenas, 2):
            falta = alvo - a.valor - b.valor
            if falta > 0 and (c := achar(falta, {a.id, b.id})):
                return [a, b, c]
    return None


def dar_baixa(notas: list[Nfse], lanc: LancamentoExtrato, origem: str = "extrato") -> None:
    from sqlalchemy.orm import object_session

    from app.modules.rpa_nfse import fatura

    for n in notas:
        n.pago_em = lanc.data
        n.valor_pago = n.valor
        n.baixa_origem = origem
        n.lancamento_id = lanc.id
        if (db := object_session(n)) is not None:
            fatura.sincronizar(db, n)


def processar(db: Session, *, tenant_id: int, usuario_id: int | None, nome: str, caminho: str | None,
              lido: leitor.ExtratoLido, baixa_automatica: bool, confianca_minima: int) -> Extrato:
    ext = Extrato(tenant_id=tenant_id, usuario_id=usuario_id, arquivo_nome=nome, arquivo_path=caminho,
                  formato=lido.formato, banco=lido.banco, periodo_de=lido.creditos[0].data,
                  periodo_ate=lido.creditos[-1].data, qtd_creditos=len(lido.creditos),
                  valor_creditos=sum((c.valor for c in lido.creditos), Decimal(0)))
    db.add(ext)
    db.flush()

    ja_vistos = set(db.scalars(
        select(LancamentoExtrato.chave).where(
            LancamentoExtrato.tenant_id == tenant_id,
            LancamentoExtrato.chave.in_([c.chave for c in lido.creditos]),
            LancamentoExtrato.status.in_([StatusLancamento.conciliado, StatusLancamento.ignorado]),
        )
    ))
    usadas: set[int] = set()
    abertas = _abertas(db, tenant_id, usadas)
    for c in lido.creditos:
        lanc = LancamentoExtrato(tenant_id=tenant_id, extrato_id=ext.id, data=c.data, valor=c.valor,
                                 descricao=c.descricao[:500], documento=c.documento, chave=c.chave)
        db.add(lanc)
        db.flush()
        if c.chave in ja_vistos:
            lanc.status, lanc.motivo = StatusLancamento.duplicado, "Este crédito já foi conciliado em outro extrato"
            continue
        confianca, notas, motivo = casar(c, [n for n in abertas if n.id not in usadas])
        lanc.confianca, lanc.motivo, lanc.nfse_ids = confianca, motivo, [n.id for n in notas]
        if not notas:
            lanc.status = StatusLancamento.sem_par
        elif baixa_automatica and confianca >= confianca_minima:
            dar_baixa(notas, lanc)
            lanc.status = StatusLancamento.conciliado
            usadas.update(n.id for n in notas)
        else:
            lanc.status = StatusLancamento.sugerido
            usadas.update(n.id for n in notas)  # não oferece a mesma nota para dois créditos
    atualizar_totais(db, ext)
    return ext


def atualizar_totais(db: Session, ext: Extrato) -> None:
    lancs = list(db.scalars(select(LancamentoExtrato).where(LancamentoExtrato.extrato_id == ext.id)))
    conc = [lc for lc in lancs if lc.status == StatusLancamento.conciliado]
    ext.qtd_conciliados = len(conc)
    ext.qtd_sugeridos = sum(1 for lc in lancs if lc.status == StatusLancamento.sugerido)
    ext.valor_conciliado = sum((lc.valor for lc in conc), Decimal(0))
    ext.notas_baixadas = sum(len(lc.nfse_ids or []) for lc in conc)
    ext.atualizado_em = agora()


def confirmar(db: Session, lanc: LancamentoExtrato, nfse_ids: list[int]) -> list[Nfse]:
    notas = list(db.scalars(select(Nfse).where(Nfse.id.in_(nfse_ids), Nfse.tenant_id == lanc.tenant_id)))
    if len(notas) != len(set(nfse_ids)):
        raise ValueError("Nota não encontrada.")
    if any(n.pago_em for n in notas):
        raise ValueError("Alguma destas notas já tem baixa.")
    if any(n.status != StatusNfse.emitida for n in notas):
        raise ValueError("Nota cancelada não recebe baixa.")
    soma = sum((n.valor for n in notas), Decimal(0))
    if soma != lanc.valor:
        raise ValueError(f"As notas somam {soma}, mas o crédito é de {lanc.valor}.")
    dar_baixa(notas, lanc)
    lanc.status, lanc.nfse_ids, lanc.confianca = StatusLancamento.conciliado, [n.id for n in notas], 100
    lanc.motivo = "Confirmado manualmente"
    return notas


def estornar(db: Session, lanc: LancamentoExtrato) -> int:
    notas = list(db.scalars(select(Nfse).where(Nfse.lancamento_id == lanc.id)))
    from app.modules.rpa_nfse import fatura

    for n in notas:
        n.pago_em = n.valor_pago = n.baixa_origem = n.lancamento_id = None
        fatura.sincronizar(db, n)
    lanc.status, lanc.motivo = StatusLancamento.sugerido, "Baixa desfeita"
    return len(notas)

