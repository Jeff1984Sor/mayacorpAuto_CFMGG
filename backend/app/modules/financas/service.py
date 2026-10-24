"""Regras do financeiro: saldo, extrato, transferências, contas a pagar (rateio, recorrência, baixa) e recebimentos."""

import calendar
import uuid
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.financas.models import (
    CategoriaFinanceira,
    ConfigFinanceiro,
    ContaBancaria,
    ContaPagar,
    Fornecedor,
    GrupoDre,
    Lancamento,
    Rateio,
    Subcategoria,
    TipoCategoria,
    TipoLancamento,
)

ZERO = Decimal(0)
HORIZONTE_INDETERMINADO = 24  # meses gerados à frente numa série sem fim


class RegraFinanceiro(ValueError):
    pass


def q2(v) -> Decimal:
    return Decimal(v or 0).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def somar_meses(d: date, meses: int, dia: int | None = None) -> date:
    m = d.month - 1 + meses
    ano, mes = d.year + m // 12, m % 12 + 1
    return date(ano, mes, min(dia or d.day, calendar.monthrange(ano, mes)[1]))


def config(db: Session, tenant_id: int) -> ConfigFinanceiro:
    cfg = db.get(ConfigFinanceiro, tenant_id)
    if not cfg:
        cfg = ConfigFinanceiro(tenant_id=tenant_id, agendamento_destinatarios=[])
        db.add(cfg)
        db.flush()
    return cfg


# ---------------------------------------------------------------- categorias padrão
PADRAO = {
    TipoCategoria.receita: [("Honorários advocatícios", GrupoDre.receita_bruta), ("Reembolso de despesas", GrupoDre.outras_receitas),
                            ("Receitas financeiras", GrupoDre.outras_receitas)],
    TipoCategoria.despesa: [("Impostos sobre faturamento", GrupoDre.deducoes), ("Folha e encargos", GrupoDre.pessoal),
                            ("Benefícios", GrupoDre.pessoal), ("Aluguel e condomínio", GrupoDre.administrativas),
                            ("Tecnologia e sistemas", GrupoDre.administrativas), ("Custas e despesas de processos", GrupoDre.custos),
                            ("Tarifas bancárias", GrupoDre.financeiras), ("IRPJ e CSLL", GrupoDre.impostos_lucro),
                            ("Distribuição de lucros", GrupoDre.retiradas)],
}


def garantir_categorias_padrao(db: Session, tenant_id: int) -> None:
    """Na primeira vez, cria um plano de contas enxuto (o escritório edita à vontade)."""
    if db.scalar(select(CategoriaFinanceira.id).where(CategoriaFinanceira.tenant_id == tenant_id).limit(1)):
        return
    for tipo, itens in PADRAO.items():
        for nome, grupo in itens:
            db.add(CategoriaFinanceira(tenant_id=tenant_id, nome=nome, tipo=tipo, grupo_dre=grupo))
    db.flush()
    cfg = config(db, tenant_id)
    cfg.categoria_honorarios_id = db.scalar(select(CategoriaFinanceira.id).where(
        CategoriaFinanceira.tenant_id == tenant_id, CategoriaFinanceira.nome == "Honorários advocatícios"))
    cfg.categoria_reembolso_id = db.scalar(select(CategoriaFinanceira.id).where(
        CategoriaFinanceira.tenant_id == tenant_id, CategoriaFinanceira.nome == "Reembolso de despesas"))


def categoria_por_nome(db: Session, tenant_id: int, nome: str, tipo: TipoCategoria, sub: str | None = None,
                       novas: list | None = None) -> tuple[CategoriaFinanceira, Subcategoria | None]:
    nome = nome.strip()
    cat = db.scalar(select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == tenant_id,
                                                      func.lower(CategoriaFinanceira.nome) == nome.lower(),
                                                      CategoriaFinanceira.tipo == tipo))
    if not cat:
        cat = CategoriaFinanceira(tenant_id=tenant_id, nome=nome, tipo=tipo)
        db.add(cat)
        db.flush()
        if novas is not None:
            novas.append(nome)
    subcat = None
    if sub and sub.strip():
        subcat = db.scalar(select(Subcategoria).where(Subcategoria.categoria_id == cat.id,
                                                      func.lower(Subcategoria.nome) == sub.strip().lower()))
        if not subcat:
            subcat = Subcategoria(categoria_id=cat.id, nome=sub.strip())
            db.add(subcat)
            db.flush()
            if novas is not None:
                novas.append(f"{nome} › {sub.strip()}")
    return cat, subcat


# ---------------------------------------------------------------- saldo e extrato
def _soma_sinal():
    return func.coalesce(func.sum(case((Lancamento.tipo == TipoLancamento.credito, Lancamento.valor), else_=-Lancamento.valor)), 0)


def saldos(db: Session, tenant_id: int, ate: date | None = None) -> dict[int, Decimal]:
    """Saldo de cada conta (até a data, inclusive)."""
    q = select(Lancamento.conta_id, _soma_sinal()).where(Lancamento.tenant_id == tenant_id)
    if ate:
        q = q.where(Lancamento.data <= ate)
    mov = dict(db.execute(q.group_by(Lancamento.conta_id)).all())
    contas = db.scalars(select(ContaBancaria).where(ContaBancaria.tenant_id == tenant_id))
    return {c.id: q2(c.saldo_inicial + Decimal(mov.get(c.id, 0))) for c in contas}


def extrato(db: Session, conta: ContaBancaria, de: date, ate: date) -> dict:
    anterior = conta.saldo_inicial + Decimal(db.scalar(select(_soma_sinal()).where(
        Lancamento.conta_id == conta.id, Lancamento.data < de)) or 0)
    linhas = list(db.scalars(select(Lancamento).where(Lancamento.conta_id == conta.id, Lancamento.data >= de,
                                                      Lancamento.data <= ate).order_by(Lancamento.data, Lancamento.id)))
    saldo, entradas, saidas, out = anterior, ZERO, ZERO, []
    for lc in linhas:
        if lc.tipo == TipoLancamento.credito:
            saldo += lc.valor
            entradas += lc.valor
        else:
            saldo -= lc.valor
            saidas += lc.valor
        out.append((lc, q2(saldo)))
    return {"saldo_anterior": q2(anterior), "entradas": q2(entradas), "saidas": q2(saidas),
            "saldo_periodo": q2(entradas - saidas), "saldo_final": q2(saldo), "linhas": out}


def transferir(db: Session, tenant_id: int, usuario: Usuario, *, origem: ContaBancaria, destino: ContaBancaria, data: date,
               valor: Decimal, descricao: str | None) -> tuple[Lancamento, Lancamento]:
    if origem.id == destino.id:
        raise RegraFinanceiro("Escolha contas diferentes.")
    texto = descricao or f"Transferência {origem.nome} → {destino.nome}"
    deb = Lancamento(tenant_id=tenant_id, conta_id=origem.id, data=data, descricao=f"{texto} (envio)", tipo=TipoLancamento.debito,
                     valor=valor, origem="transferencia", observacao=f"Transferência para {destino.nome}", criado_por_id=usuario.id)
    cred = Lancamento(tenant_id=tenant_id, conta_id=destino.id, data=data, descricao=f"{texto} (recebimento)",
                      tipo=TipoLancamento.credito, valor=valor, origem="transferencia",
                      observacao=f"Transferência de {origem.nome}", criado_por_id=usuario.id)
    db.add_all([deb, cred])
    db.flush()
    deb.transferencia_par_id, cred.transferencia_par_id = cred.id, deb.id
    return deb, cred


def excluir_lancamento(db: Session, lc: Lancamento) -> None:
    if lc.origem == "conta_pagar":
        raise RegraFinanceiro("Este débito é o pagamento de uma conta: reabra a conta em Contas a pagar.")
    if lc.origem == "fatura":
        raise RegraFinanceiro("Este crédito é o recebimento de uma fatura: desfaça a baixa na fatura.")
    if lc.transferencia_par_id and (par := db.get(Lancamento, lc.transferencia_par_id)):
        par.transferencia_par_id = None
        db.flush()
        db.delete(par)
    db.delete(lc)


# ---------------------------------------------------------------- contas a pagar
def montar_rateio(db: Session, tenant_id: int, linhas: list[dict]) -> tuple[Decimal, list[Rateio]]:
    """Rateio por categoria: o valor da conta é a soma das linhas."""
    if not linhas:
        raise RegraFinanceiro("Informe ao menos uma categoria.")
    total = q2(sum((Decimal(str(lin["valor"])) for lin in linhas), ZERO))
    if total <= 0:
        raise RegraFinanceiro("O valor da conta deve ser maior que zero.")
    saida = []
    for lin in linhas:
        cat = db.get(CategoriaFinanceira, lin["categoria_id"])
        if not cat or cat.tenant_id != tenant_id:
            raise RegraFinanceiro("Categoria não encontrada.")
        sub_id = lin.get("subcategoria_id")
        if sub_id:
            sub = db.get(Subcategoria, sub_id)
            if not sub or sub.categoria_id != cat.id:
                raise RegraFinanceiro("A subcategoria não pertence à categoria escolhida.")
        v = q2(Decimal(str(lin["valor"])))
        saida.append(Rateio(categoria_id=cat.id, subcategoria_id=sub_id, valor=v,
                            percentual=(v / total * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
    return total, saida


def _favorecido(db: Session, conta: ContaPagar) -> str:
    if conta.fornecedor_id and (f := db.get(Fornecedor, conta.fornecedor_id)):
        return f.nome
    if conta.funcionario_id and (u := db.get(Usuario, conta.funcionario_id)):
        return u.nome
    return conta.favorecido or ""


def criar_contas(db: Session, tenant_id: int, usuario: Usuario, dados: dict, rateio: list[dict]) -> list[ContaPagar]:
    """Cria a conta e, se recorrente, a série inteira (cada parcela com o valor cheio e o mesmo rateio)."""
    total, _ = montar_rateio(db, tenant_id, rateio)
    passo = dados.pop("recorrencia_meses", 0) or 0
    indeterminada = dados.pop("recorrencia_indeterminada", False)
    repeticoes = dados.pop("repeticoes", None) or 1
    qtd = 1 if not passo else (HORIZONTE_INDETERMINADO // passo + 1 if indeterminada else max(1, min(240, repeticoes)))
    grupo = uuid.uuid4().hex if passo else None
    venc0 = dados["data_vencimento"]
    contas = []
    for i in range(qtd):
        c = ContaPagar(tenant_id=tenant_id, criado_por_id=usuario.id, **dados)
        c.valor = total
        c.data_vencimento = somar_meses(venc0, passo * i, venc0.day) if passo else venc0
        if c.data_competencia and passo:
            c.data_competencia = somar_meses(dados["data_competencia"], passo * i)
        c.grupo_recorrencia, c.recorrencia_meses, c.recorrencia_indeterminada = grupo, passo, indeterminada
        c.parcela, c.parcelas_total = (i + 1, None if indeterminada else qtd) if passo else (None, None)
        _, linhas = montar_rateio(db, tenant_id, rateio)
        c.rateio = linhas
        c.categoria_id, c.subcategoria_id = linhas[0].categoria_id, linhas[0].subcategoria_id
        if not c.descricao:
            c.descricao = _favorecido(db, c) or "Conta a pagar"
        db.add(c)
        contas.append(c)
    db.flush()
    return contas


def editar_conta(db: Session, conta: ContaPagar, dados: dict, rateio: list[dict] | None, escopo: str) -> int:
    """Edita a conta (ou as demais em aberto da série, mantendo o vencimento de cada uma)."""
    if conta.data_pagamento:
        raise RegraFinanceiro("Conta paga não pode ser editada. Reabra antes.")
    alvo = [conta]
    if escopo == "serie" and conta.grupo_recorrencia:
        alvo = list(db.scalars(select(ContaPagar).where(ContaPagar.grupo_recorrencia == conta.grupo_recorrencia,
                                                        ContaPagar.data_pagamento.is_(None),
                                                        ContaPagar.data_vencimento >= conta.data_vencimento)))
    for c in alvo:
        for k, v in dados.items():
            if k == "data_vencimento" and c.id != conta.id:
                continue
            setattr(c, k, v)
        if rateio is not None:
            total, linhas = montar_rateio(db, conta.tenant_id, rateio)
            c.rateio = linhas
            c.valor = total
            c.categoria_id, c.subcategoria_id = linhas[0].categoria_id, linhas[0].subcategoria_id
        if not c.descricao:
            c.descricao = _favorecido(db, c) or "Conta a pagar"
    db.flush()
    return len(alvo)


def excluir_conta(db: Session, conta: ContaPagar, escopo: str) -> int:
    if conta.data_pagamento:
        raise RegraFinanceiro("Conta paga não pode ser excluída. Reabra antes.")
    alvo = [conta]
    if escopo == "serie" and conta.grupo_recorrencia:
        alvo = list(db.scalars(select(ContaPagar).where(ContaPagar.grupo_recorrencia == conta.grupo_recorrencia,
                                                        ContaPagar.data_pagamento.is_(None),
                                                        ContaPagar.data_vencimento >= conta.data_vencimento)))
    for c in alvo:
        db.delete(c)
    return len(alvo)


def pagar(db: Session, conta: ContaPagar, usuario: Usuario, *, data: date, conta_bancaria: ContaBancaria | None,
          juros: Decimal = ZERO, desconto: Decimal = ZERO) -> Lancamento | None:
    """Baixa: grava o pagamento e lança o débito no extrato da conta bancária."""
    if conta.data_pagamento:
        raise RegraFinanceiro("Esta conta já está paga.")
    if desconto > conta.valor:
        raise RegraFinanceiro("O desconto não pode ser maior que o valor.")
    if not conta_bancaria:
        ativas = list(db.scalars(select(ContaBancaria).where(ContaBancaria.tenant_id == conta.tenant_id, ContaBancaria.ativo)))
        conta_bancaria = db.get(ContaBancaria, conta.conta_bancaria_id) if conta.conta_bancaria_id else (
            ativas[0] if len(ativas) == 1 else None)
    pago = q2(conta.valor + (juros or 0) - (desconto or 0))
    conta.data_pagamento, conta.valor_pago, conta.juros, conta.desconto = data, pago, juros or ZERO, desconto or ZERO
    if not conta_bancaria:
        return None
    conta.conta_bancaria_id = conta_bancaria.id
    lc = Lancamento(tenant_id=conta.tenant_id, conta_id=conta_bancaria.id, data=data, tipo=TipoLancamento.debito, valor=pago,
                    descricao=f"Pagamento — {_favorecido(db, conta)} — {conta.descricao}"[:255],
                    categoria_id=conta.categoria_id, subcategoria_id=conta.subcategoria_id, fornecedor_id=conta.fornecedor_id,
                    funcionario_id=conta.funcionario_id, favorecido=conta.favorecido, documento=conta.documento,
                    observacao=f"Baixa da conta a pagar #{conta.id} (vencimento {conta.data_vencimento:%d/%m/%Y})",
                    origem="conta_pagar", criado_por_id=usuario.id)
    db.add(lc)
    db.flush()
    conta.lancamento_id = lc.id
    return lc


def reabrir(db: Session, conta: ContaPagar) -> None:
    if not conta.data_pagamento:
        raise RegraFinanceiro("Esta conta não está paga.")
    if conta.lancamento_id and (lc := db.get(Lancamento, conta.lancamento_id)):
        conta.lancamento_id = None
        db.flush()
        db.delete(lc)
    conta.data_pagamento = conta.valor_pago = None
    conta.juros = conta.desconto = ZERO


def estender_recorrencias(db: Session, tenant_id: int) -> int:
    """Séries sem fim: mantém parcelas geradas até 24 meses à frente (roda ao abrir a lista)."""
    limite = somar_meses(date.today(), HORIZONTE_INDETERMINADO)
    criadas = 0
    grupos = db.execute(select(ContaPagar.grupo_recorrencia, func.max(ContaPagar.data_vencimento)).where(
        ContaPagar.tenant_id == tenant_id, ContaPagar.recorrencia_indeterminada, ContaPagar.grupo_recorrencia.is_not(None))
        .group_by(ContaPagar.grupo_recorrencia)).all()
    for grupo, ultima_data in grupos:
        ultima = db.scalar(select(ContaPagar).where(ContaPagar.grupo_recorrencia == grupo, ContaPagar.data_vencimento == ultima_data)
                           .order_by(ContaPagar.id.desc()).limit(1))
        primeira = db.scalar(select(ContaPagar).where(ContaPagar.grupo_recorrencia == grupo).order_by(ContaPagar.data_vencimento).limit(1))
        venc, n = ultima.data_vencimento, ultima.parcela or 1
        while True:
            venc = somar_meses(venc, ultima.recorrencia_meses, primeira.data_vencimento.day)
            if venc > limite:
                break
            n += 1
            nova = ContaPagar(
                tenant_id=tenant_id, descricao=ultima.descricao, fornecedor_id=ultima.fornecedor_id,
                funcionario_id=ultima.funcionario_id, favorecido=ultima.favorecido, categoria_id=ultima.categoria_id,
                subcategoria_id=ultima.subcategoria_id, valor=ultima.valor, data_vencimento=venc,
                forma_pagamento=ultima.forma_pagamento, documento=ultima.documento, observacao=ultima.observacao,
                grupo_recorrencia=grupo, recorrencia_meses=ultima.recorrencia_meses, recorrencia_indeterminada=True,
                parcela=n, conta_bancaria_id=ultima.conta_bancaria_id, criado_por_id=ultima.criado_por_id,
                rateio=[Rateio(categoria_id=r.categoria_id, subcategoria_id=r.subcategoria_id, valor=r.valor,
                               percentual=r.percentual) for r in ultima.rateio])
            db.add(nova)
            criadas += 1
    if criadas:
        db.flush()
    return criadas


# ---------------------------------------------------------------- recebimento das faturas (crédito no extrato)
def espelhar_recebimento(db: Session, fat, conta_id: int | None = None) -> None:
    """Fatura paga ⇒ crédito na conta de recebimento; fatura reaberta/cancelada ⇒ o crédito some."""
    from app.modules.rpa_nfse.models import StatusFatura, TipoFatura

    existente = db.scalar(select(Lancamento).where(Lancamento.fatura_id == fat.id, Lancamento.origem == "fatura"))
    if fat.status != StatusFatura.paga:
        if existente:
            db.delete(existente)
        return
    cfg = db.get(ConfigFinanceiro, fat.tenant_id)
    destino = conta_id or (existente.conta_id if existente else None) or (cfg.conta_recebimento_id if cfg else None)
    if not destino:
        return  # financeiro não configurado: a baixa vale só na fatura
    valor = fat.total
    if fat.nfse and fat.nfse.valor_pago:
        valor = fat.nfse.valor_pago
    categoria = (cfg.categoria_reembolso_id if fat.tipo == TipoFatura.despesas else cfg.categoria_honorarios_id) if cfg else None
    cliente = fat.tomador.nome if fat.tomador else ""
    texto = f"Recebimento {fat.codigo}" + (f" — NFS-e {fat.nfse.numero}" if fat.nfse else "") + (f" — {cliente}" if cliente else "")
    lc = existente or Lancamento(tenant_id=fat.tenant_id, origem="fatura", fatura_id=fat.id, tipo=TipoLancamento.credito)
    lc.conta_id, lc.data, lc.valor, lc.descricao, lc.categoria_id, lc.favorecido = (
        destino, fat.pago_em or date.today(), q2(valor), texto[:255], categoria, cliente[:200] or None)
    db.add(lc)
    db.flush()


# ---------------------------------------------------------------- períodos
def mes_atual() -> tuple[date, date]:
    hoje = date.today()
    return hoje.replace(day=1), hoje.replace(day=calendar.monthrange(hoje.year, hoje.month)[1])


def fim_do_mes(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def dias(de: date, ate: date):
    d = de
    while d <= ate:
        yield d
        d += timedelta(days=1)
