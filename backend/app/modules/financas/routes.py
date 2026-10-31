"""Financeiro: Conta Bancária (extrato, transferência, fluxo, DRE, previsões), Contas a Pagar e Projeção de Impostos."""

from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import ValidationError
from sqlalchemy import func, or_, select

from app.core import tenancy
from app.core.deps import Admin, Ctx, Operador
from app.core.models import Usuario
from app.core.schemas import Mensagem
from app.modules.financas import impostos, planilhas, relatorios, service
from app.modules.financas.models import (
    CategoriaFinanceira,
    ContaBancaria,
    ContaPagar,
    FormaPagamento,
    Fornecedor,
    Lancamento,
    Rateio,
    ReceitaInformada,
    Subcategoria,
    TipoCategoria,
    TipoLancamento,
)
from app.modules.financas.schemas import (
    CategoriaIn,
    CategoriaOut,
    ConfigFinanceiroIn,
    ConfigFinanceiroOut,
    ConfigImpostosIn,
    ContaIn,
    ContaOut,
    ContaPagarEdicaoIn,
    ContaPagarIn,
    ContaPagarOut,
    ContasPagarListaOut,
    ExcluirContaIn,
    ExtratoOut,
    FornecedorIn,
    FornecedorOut,
    LancamentoIn,
    LancamentoOut,
    PagarIn,
    PagarLoteIn,
    RateioOut,
    ReceitaInformadaIn,
    SimularImpostoIn,
    SubcategoriaIn,
    SubcategoriaOut,
    TransferenciaIn,
)
from app.modules.rpa_nfse.models import Emissora

router = APIRouter(prefix="/financeiro", tags=["Financeiro"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
ANEXO_MAX = 15 * 1024 * 1024


def _get(ctx, modelo, oid: int, nome: str):
    obj = ctx.db.get(modelo, oid)
    if not obj or getattr(obj, "tenant_id", ctx.tenant_id) != ctx.tenant_id:
        raise HTTPException(404, f"{nome} não encontrado.")
    return obj


def _falha(ctx, e: Exception):
    ctx.db.rollback()
    raise HTTPException(400, str(e)) from e


def _xlsx(conteudo: bytes, nome: str) -> Response:
    import unicodedata
    from urllib.parse import quote

    ascii_ = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    return Response(conteudo, media_type=XLSX, headers={
        "Content-Disposition": f"attachment; filename=\"{ascii_}\"; filename*=UTF-8''{quote(nome)}"})


def _sub(ctx, sub_id: int | None) -> Subcategoria | None:
    if not sub_id:
        return None
    s = ctx.db.get(Subcategoria, sub_id)
    if not s or s.categoria.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Subcategoria não encontrada.")
    return s


# ================================================================ contas bancárias
def _conta_out(ctx, c: ContaBancaria, saldos: dict[int, Decimal]) -> ContaOut:
    ini, fim = service.mes_atual()
    mov = dict(ctx.db.execute(select(Lancamento.tipo, func.coalesce(func.sum(Lancamento.valor), 0)).where(
        Lancamento.conta_id == c.id, Lancamento.data >= ini, Lancamento.data <= fim, Lancamento.origem != "transferencia")
        .group_by(Lancamento.tipo)).all())
    qtd = ctx.db.scalar(select(func.count()).select_from(Lancamento).where(Lancamento.conta_id == c.id)) or 0
    return ContaOut.model_validate(c).model_copy(update={
        "saldo_atual": saldos.get(c.id, c.saldo_inicial), "entradas_mes": service.q2(mov.get(TipoLancamento.credito, 0)),
        "saidas_mes": service.q2(mov.get(TipoLancamento.debito, 0)), "qtd_lancamentos": qtd})


@router.get("/contas", response_model=list[ContaOut])
def contas(ctx: Ctx):
    service.garantir_categorias_padrao(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    s = service.saldos(ctx.db, ctx.tenant_id)
    lista = ctx.db.scalars(select(ContaBancaria).where(ContaBancaria.tenant_id == ctx.tenant_id)
                           .order_by(ContaBancaria.ativo.desc(), ContaBancaria.nome))
    return [_conta_out(ctx, c, s) for c in lista]


@router.post("/contas", response_model=ContaOut, status_code=201)
def criar_conta(dados: ContaIn, ctx: Admin):
    if dados.emissora_id:
        _get(ctx, Emissora, dados.emissora_id, "Emissora")
    c = ContaBancaria(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    cfg = service.config(ctx.db, ctx.tenant_id)
    if not cfg.conta_recebimento_id and c.tipo.value == "corrente":
        cfg.conta_recebimento_id = c.id  # a primeira conta corrente vira a de recebimento
    ctx.auditar("financeiro.conta.criar", "fin_conta", c.id, descricao=c.nome)
    ctx.db.commit()
    return _conta_out(ctx, c, service.saldos(ctx.db, ctx.tenant_id))


@router.put("/contas/{cid}", response_model=ContaOut)
def alterar_conta(cid: int, dados: ContaIn, ctx: Admin):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    antes = {"saldo_inicial": str(c.saldo_inicial)}
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("financeiro.conta.alterar", "fin_conta", c.id, descricao=c.nome, antes=antes, depois={"saldo_inicial": str(c.saldo_inicial)})
    ctx.db.commit()
    return _conta_out(ctx, c, service.saldos(ctx.db, ctx.tenant_id))


@router.delete("/contas/{cid}", response_model=Mensagem)
def excluir_conta_bancaria(cid: int, ctx: Admin):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    qtd = ctx.db.scalar(select(func.count()).select_from(Lancamento).where(Lancamento.conta_id == cid)) or 0
    if qtd:
        c.ativo = False
        ctx.auditar("financeiro.conta.desativar", "fin_conta", c.id, descricao=c.nome)
        ctx.db.commit()
        return Mensagem(mensagem=f"A conta tem {qtd} lançamento(s): foi desativada (o histórico fica).")
    ctx.auditar("financeiro.conta.excluir", "fin_conta", c.id, descricao=c.nome)
    ctx.db.delete(c)
    ctx.db.commit()
    return Mensagem(mensagem="Conta excluída.")


def _lanc_out(ctx, lc: Lancamento, saldo: Decimal | None = None) -> LancamentoOut:
    from app.core.models import Usuario as U
    from app.modules.rpa_nfse.models import Fatura

    fav = lc.fornecedor.nome if lc.fornecedor else (
        (u.nome if (u := ctx.db.get(U, lc.funcionario_id)) else None) if lc.funcionario_id else lc.favorecido)
    cp = ctx.db.scalar(select(ContaPagar.id).where(ContaPagar.lancamento_id == lc.id)) if lc.origem == "conta_pagar" else None
    fat = ctx.db.get(Fatura, lc.fatura_id) if lc.fatura_id else None
    return LancamentoOut.model_validate(lc).model_copy(update={
        "categoria_nome": lc.categoria.nome if lc.categoria else None,
        "subcategoria_nome": lc.subcategoria.nome if lc.subcategoria else None, "favorecido_nome": fav,
        "fatura_codigo": fat.codigo if fat else None, "conta_pagar_id": cp, "saldo": saldo,
        "editavel": lc.origem in ("manual", "importacao")})


@router.get("/contas/{cid}/extrato", response_model=ExtratoOut)
def extrato(cid: int, ctx: Ctx, de: date | None = None, ate: date | None = None):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    ini, fim = service.mes_atual()
    de, ate = de or ini, ate or fim
    e = service.extrato(ctx.db, c, de, ate)
    return ExtratoOut(conta=_conta_out(ctx, c, service.saldos(ctx.db, ctx.tenant_id)), de=de, ate=ate,
                      saldo_anterior=e["saldo_anterior"], entradas=e["entradas"], saidas=e["saidas"],
                      saldo_periodo=e["saldo_periodo"], saldo_final=e["saldo_final"],
                      linhas=[_lanc_out(ctx, lc, s) for lc, s in e["linhas"]])


@router.get("/contas/{cid}/extrato.xlsx")
def extrato_xlsx(cid: int, ctx: Ctx, de: date | None = None, ate: date | None = None):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    ini, fim = service.mes_atual()
    de, ate = de or ini, ate or fim
    e = service.extrato(ctx.db, c, de, ate)
    linhas = [[None, "Saldo anterior ao período", None, None, None, None, None, None, e["saldo_anterior"]]]
    for lc, s in e["linhas"]:
        o = _lanc_out(ctx, lc)
        linhas.append([lc.data, lc.descricao, "Entrada" if lc.tipo == TipoLancamento.credito else "Saída", o.favorecido_nome,
                       o.categoria_nome, o.subcategoria_nome, lc.valor if lc.tipo == TipoLancamento.credito else None,
                       lc.valor if lc.tipo == TipoLancamento.debito else None, s])
    arq = planilhas.tabela("Extrato", ["Data", "Descrição", "Tipo", "Favorecido / Cliente", "Categoria", "Subcategoria", "Entrada",
                                       "Saída", "Saldo"], linhas, larguras=[12, 44, 10, 30, 24, 22, 14, 14, 16],
                           moeda={6, 7, 8}, datas={0}, topo=[f"Extrato — {c.nome}", f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}"],
                           rodape=[None, "Totais do período", None, None, None, None, e["entradas"], e["saidas"], e["saldo_final"]])
    return _xlsx(arq, f"extrato_{c.nome}_{de:%Y%m%d}_{ate:%Y%m%d}.xlsx".replace(" ", "_"))


def _validar_lanc(ctx, dados: LancamentoIn):
    if dados.categoria_id:
        _get(ctx, CategoriaFinanceira, dados.categoria_id, "Categoria")
    sub = _sub(ctx, dados.subcategoria_id)
    if sub and sub.categoria_id != dados.categoria_id:
        raise HTTPException(400, "A subcategoria não pertence à categoria escolhida.")
    if dados.fornecedor_id:
        _get(ctx, Fornecedor, dados.fornecedor_id, "Fornecedor")
    if dados.funcionario_id:
        _get(ctx, Usuario, dados.funcionario_id, "Funcionário")


@router.post("/contas/{cid}/lancamentos", response_model=LancamentoOut, status_code=201)
def lancar(cid: int, dados: LancamentoIn, ctx: Operador):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    _validar_lanc(ctx, dados)
    lc = Lancamento(tenant_id=ctx.tenant_id, conta_id=c.id, criado_por_id=ctx.usuario.id, origem="manual", **dados.model_dump())
    ctx.db.add(lc)
    ctx.db.flush()
    ctx.auditar("financeiro.lancamento.criar", "fin_lancamento", lc.id, descricao=f"{c.nome}: {lc.descricao} {lc.valor}")
    ctx.db.commit()
    return _lanc_out(ctx, lc)


@router.put("/lancamentos/{lid}", response_model=LancamentoOut)
def alterar_lancamento(lid: int, dados: LancamentoIn, ctx: Operador):
    lc = _get(ctx, Lancamento, lid, "Lançamento")
    if lc.origem not in ("manual", "importacao"):
        raise HTTPException(400, "Este lançamento veio de outra tela (pagamento, recebimento ou transferência): altere por lá.")
    _validar_lanc(ctx, dados)
    for k, v in dados.model_dump().items():
        setattr(lc, k, v)
    ctx.auditar("financeiro.lancamento.alterar", "fin_lancamento", lc.id, descricao=f"{lc.descricao} {lc.valor}")
    ctx.db.commit()
    return _lanc_out(ctx, lc)


@router.delete("/lancamentos/{lid}", response_model=Mensagem)
def excluir_lancamento(lid: int, ctx: Operador):
    lc = _get(ctx, Lancamento, lid, "Lançamento")
    texto = f"{lc.descricao} {lc.valor}"
    try:
        service.excluir_lancamento(ctx.db, lc)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.lancamento.excluir", "fin_lancamento", lid, descricao=texto)
    ctx.db.commit()
    return Mensagem(mensagem="Lançamento excluído.")


@router.post("/transferencias", response_model=Mensagem, status_code=201)
def transferencia(dados: TransferenciaIn, ctx: Operador):
    o = _get(ctx, ContaBancaria, dados.origem_id, "Conta de origem")
    d = _get(ctx, ContaBancaria, dados.destino_id, "Conta de destino")
    try:
        service.transferir(ctx.db, ctx.tenant_id, ctx.usuario, origem=o, destino=d, data=dados.data, valor=dados.valor,
                           descricao=dados.descricao)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.transferencia", "fin_lancamento", descricao=f"{o.nome} → {d.nome}: {dados.valor}")
    ctx.db.commit()
    return Mensagem(mensagem=f"Transferência de {o.nome} para {d.nome} registrada.")


@router.get("/contas/{cid}/modelo.xlsx")
def modelo_extrato(cid: int, ctx: Ctx):
    c = _get(ctx, ContaBancaria, cid, "Conta")
    return _xlsx(planilhas.modelo_extrato(c.nome), f"modelo_extrato_{c.id}.xlsx")


@router.post("/contas/{cid}/importar")
async def importar_extrato(cid: int, ctx: Operador, arquivo: UploadFile = File(...), simular: bool = False):
    """Importa lançamentos de uma planilha (modelo ou extrato do banco em .xlsx)."""
    c = _get(ctx, ContaBancaria, cid, "Conta")
    conteudo = await arquivo.read()
    try:
        linhas = planilhas.linhas_planilha(conteudo, "Extrato")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Não consegui ler a planilha. Envie um .xlsx.") from e
    if not linhas:
        raise HTTPException(400, "Planilha vazia.")
    pos = planilhas.colunas_extrato(linhas[0])
    corpo = linhas if pos.get("_sem_cabecalho") else linhas[1:]
    novos, ignoradas, novas_cats, total_e, total_s = 0, 0, [], Decimal(0), Decimal(0)

    def col(row, k):
        i = pos.get(k)
        return row[i] if i is not None and i < len(row) else None

    for row in corpo:
        data = planilhas.ler_data(col(row, "data"))
        if not data:
            ignoradas += 1
            continue
        pares = []
        if "valor" in pos and "entrada" not in pos:
            v = planilhas.ler_valor(col(row, "valor"))
            tipo_txt = str(col(row, "tipo") or "").lower()
            if v is not None:
                saida = v < 0 or "sa" in tipo_txt or "deb" in tipo_txt
                pares.append((TipoLancamento.debito if saida else TipoLancamento.credito, abs(v)))
        else:
            for k, t in (("entrada", TipoLancamento.credito), ("saida", TipoLancamento.debito)):
                v = planilhas.ler_valor(col(row, k))
                if v:
                    pares.append(((TipoLancamento.debito if t == TipoLancamento.credito else TipoLancamento.credito) if v < 0 else t, abs(v)))
        if not pares:
            ignoradas += 1
            continue
        cat_txt = str(col(row, "categoria") or "").strip()
        for tipo, valor in pares:
            cat = sub = None
            if cat_txt:
                nome, _, subnome = cat_txt.partition(":")
                cat, sub = service.categoria_por_nome(ctx.db, ctx.tenant_id, nome, TipoCategoria.receita if tipo == TipoLancamento.credito
                                                      else TipoCategoria.despesa, subnome or None, novas_cats)
            ctx.db.add(Lancamento(tenant_id=ctx.tenant_id, conta_id=c.id, data=data, tipo=tipo, valor=valor,
                                  descricao=str(col(row, "descricao") or "Lançamento importado")[:255], origem="importacao",
                                  categoria_id=cat.id if cat else None, subcategoria_id=sub.id if sub else None,
                                  criado_por_id=ctx.usuario.id))
            novos += 1
            if tipo == TipoLancamento.credito:
                total_e += valor
            else:
                total_s += valor
    resumo = {"importados": novos, "ignoradas": ignoradas, "entradas": total_e, "saidas": total_s, "categorias_novas": novas_cats,
              "simulacao": simular}
    if simular:
        ctx.db.rollback()
        return resumo
    ctx.auditar("financeiro.extrato.importar", "fin_conta", c.id, descricao=f"{arquivo.filename}: {novos} lançamentos")
    ctx.db.commit()
    return resumo


# ================================================================ categorias
@router.get("/categorias", response_model=list[CategoriaOut])
def categorias(ctx: Ctx, tipo: TipoCategoria | None = None, ativas: bool | None = None):
    service.garantir_categorias_padrao(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    q = select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == ctx.tenant_id)
    if tipo:
        q = q.where(CategoriaFinanceira.tipo == tipo)
    if ativas is not None:
        q = q.where(CategoriaFinanceira.ativo == ativas)
    uso = relatorios.categorias_em_uso(ctx.db, ctx.tenant_id)
    uso_sub = dict(ctx.db.execute(select(Lancamento.subcategoria_id, func.count()).where(Lancamento.tenant_id == ctx.tenant_id)
                                  .group_by(Lancamento.subcategoria_id)).all())
    for sid, n in ctx.db.execute(select(ContaPagar.subcategoria_id, func.count()).where(ContaPagar.tenant_id == ctx.tenant_id)
                                 .group_by(ContaPagar.subcategoria_id)).all():
        uso_sub[sid] = uso_sub.get(sid, 0) + n
    for sid, n in ctx.db.execute(select(Rateio.subcategoria_id, func.count()).group_by(Rateio.subcategoria_id)).all():
        uso_sub[sid] = uso_sub.get(sid, 0) + n
    out = []
    for c in ctx.db.scalars(q.order_by(CategoriaFinanceira.tipo, CategoriaFinanceira.nome)):
        u = uso.get(c.id, {"contas": 0, "lancamentos": 0})
        out.append(CategoriaOut(
            id=c.id, nome=c.nome, tipo=c.tipo, grupo_dre=c.grupo_dre, cor=c.cor, ativo=c.ativo,
            subcategorias=[SubcategoriaOut(id=s.id, categoria_id=c.id, nome=s.nome, ativo=s.ativo, uso=uso_sub.get(s.id, 0))
                           for s in c.subcategorias],
            uso_contas=u["contas"], uso_lancamentos=u["lancamentos"], revisar="," in c.nome))
    return out


@router.post("/categorias", response_model=CategoriaOut, status_code=201)
def criar_categoria(dados: CategoriaIn, ctx: Operador):
    if ctx.db.scalar(select(CategoriaFinanceira.id).where(CategoriaFinanceira.tenant_id == ctx.tenant_id,
                                                          func.lower(CategoriaFinanceira.nome) == dados.nome.lower(),
                                                          CategoriaFinanceira.tipo == dados.tipo)):
        raise HTTPException(409, "Já existe uma categoria com este nome.")
    c = CategoriaFinanceira(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.commit()
    return CategoriaOut.model_validate(c)


@router.put("/categorias/{cid}", response_model=CategoriaOut)
def alterar_categoria(cid: int, dados: CategoriaIn, ctx: Operador):
    c = _get(ctx, CategoriaFinanceira, cid, "Categoria")
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.db.commit()
    return CategoriaOut.model_validate(c)


def _cat_em_uso(ctx, cid: int) -> bool:
    u = relatorios.categorias_em_uso(ctx.db, ctx.tenant_id).get(cid)
    return bool(u and (u["contas"] or u["lancamentos"]))


@router.delete("/categorias/{cid}", response_model=Mensagem)
def excluir_categoria(cid: int, ctx: Operador):
    c = _get(ctx, CategoriaFinanceira, cid, "Categoria")
    if c.subcategorias:
        raise HTTPException(400, "Exclua as subcategorias antes.")
    if _cat_em_uso(ctx, cid):
        raise HTTPException(400, "Categoria em uso: desative em vez de excluir.")
    ctx.db.delete(c)
    ctx.db.commit()
    return Mensagem(mensagem="Categoria excluída.")


@router.post("/categorias/excluir-lote")
def excluir_categorias_lote(body: dict, ctx: Operador):
    excluidas, puladas = 0, []
    for sid in body.get("subcategoria_ids") or []:
        s = _sub(ctx, sid)
        usado = (ctx.db.scalar(select(func.count()).select_from(Lancamento).where(Lancamento.subcategoria_id == sid)) or 0) + \
            (ctx.db.scalar(select(func.count()).select_from(ContaPagar).where(ContaPagar.subcategoria_id == sid)) or 0) + \
            (ctx.db.scalar(select(func.count()).select_from(Rateio).where(Rateio.subcategoria_id == sid)) or 0)
        if usado:
            puladas.append(s.nome)
        else:
            ctx.db.delete(s)
            excluidas += 1
    ctx.db.flush()
    for cid in body.get("categoria_ids") or []:
        c = _get(ctx, CategoriaFinanceira, cid, "Categoria")
        ctx.db.refresh(c)
        if c.subcategorias or _cat_em_uso(ctx, cid):
            puladas.append(c.nome)
        else:
            ctx.db.delete(c)
            excluidas += 1
    ctx.db.commit()
    return {"excluidas": excluidas, "puladas": puladas}


@router.post("/categorias/{cid}/subcategorias", response_model=SubcategoriaOut, status_code=201)
def criar_subcategoria(cid: int, dados: SubcategoriaIn, ctx: Operador):
    c = _get(ctx, CategoriaFinanceira, cid, "Categoria")
    if any(s.nome.lower() == dados.nome.lower() for s in c.subcategorias):
        raise HTTPException(409, "Esta subcategoria já existe.")
    s = Subcategoria(categoria_id=c.id, **dados.model_dump())
    ctx.db.add(s)
    ctx.db.commit()
    return SubcategoriaOut.model_validate(s)


@router.put("/subcategorias/{sid}", response_model=SubcategoriaOut)
def alterar_subcategoria(sid: int, dados: SubcategoriaIn, ctx: Operador):
    s = _sub(ctx, sid)
    s.nome, s.ativo = dados.nome, dados.ativo
    ctx.db.commit()
    return SubcategoriaOut.model_validate(s)


@router.delete("/subcategorias/{sid}", response_model=Mensagem)
def excluir_subcategoria(sid: int, ctx: Operador):
    r = excluir_categorias_lote({"subcategoria_ids": [sid]}, ctx)
    if r["puladas"]:
        raise HTTPException(400, "Subcategoria em uso: desative em vez de excluir.")
    return Mensagem(mensagem="Subcategoria excluída.")


# ================================================================ fornecedores e favorecidos
@router.get("/fornecedores", response_model=list[FornecedorOut])
def fornecedores(ctx: Ctx, q: str | None = None, ativos: bool | None = None):
    sel = select(Fornecedor).where(Fornecedor.tenant_id == ctx.tenant_id)
    if q:
        dig = "".join(ch for ch in q if ch.isdigit())
        conds = [Fornecedor.nome.ilike(f"%{q}%"), Fornecedor.email.ilike(f"%{q}%")]
        if dig:
            conds.append(Fornecedor.cpf_cnpj.like(f"%{dig}%"))
        sel = sel.where(or_(*conds))
    if ativos is not None:
        sel = sel.where(Fornecedor.ativo == ativos)
    desde = date.today() - timedelta(days=365)
    qtd = dict(ctx.db.execute(select(ContaPagar.fornecedor_id, func.count()).where(ContaPagar.tenant_id == ctx.tenant_id)
                              .group_by(ContaPagar.fornecedor_id)).all())
    pago = dict(ctx.db.execute(select(ContaPagar.fornecedor_id, func.coalesce(func.sum(ContaPagar.valor_pago), 0)).where(
        ContaPagar.tenant_id == ctx.tenant_id, ContaPagar.data_pagamento >= desde).group_by(ContaPagar.fornecedor_id)).all())
    return [FornecedorOut.model_validate(f).model_copy(update={"qtd_contas": qtd.get(f.id, 0),
                                                               "total_pago_12m": service.q2(pago.get(f.id, 0))})
            for f in ctx.db.scalars(sel.order_by(Fornecedor.nome))]


@router.post("/fornecedores", response_model=FornecedorOut, status_code=201)
def criar_fornecedor(dados: FornecedorIn, ctx: Operador):
    if dados.cpf_cnpj and ctx.db.scalar(select(Fornecedor.id).where(Fornecedor.tenant_id == ctx.tenant_id,
                                                                    Fornecedor.cpf_cnpj == dados.cpf_cnpj)):
        raise HTTPException(409, "Já existe um fornecedor com este CPF/CNPJ.")
    f = Fornecedor(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(f)
    ctx.db.flush()
    ctx.auditar("financeiro.fornecedor.criar", "fin_fornecedor", f.id, descricao=f.nome)
    ctx.db.commit()
    return FornecedorOut.model_validate(f)


@router.put("/fornecedores/{fid}", response_model=FornecedorOut)
def alterar_fornecedor(fid: int, dados: FornecedorIn, ctx: Operador):
    f = _get(ctx, Fornecedor, fid, "Fornecedor")
    for k, v in dados.model_dump().items():
        setattr(f, k, v)
    ctx.db.commit()
    return FornecedorOut.model_validate(f)


@router.delete("/fornecedores/{fid}", response_model=Mensagem)
def excluir_fornecedor(fid: int, ctx: Operador):
    f = _get(ctx, Fornecedor, fid, "Fornecedor")
    if ctx.db.scalar(select(func.count()).select_from(ContaPagar).where(ContaPagar.fornecedor_id == fid)) or \
            ctx.db.scalar(select(func.count()).select_from(Lancamento).where(Lancamento.fornecedor_id == fid)):
        f.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Fornecedor com contas ou lançamentos: foi desativado.")
    ctx.db.delete(f)
    ctx.db.commit()
    return Mensagem(mensagem="Fornecedor excluído.")


_ROTULO_FORN = {"nome": "nome", "tipo": "tipo", "cpf_cnpj": "CPF/CNPJ", "email": "e-mail", "telefone": "telefone",
                "chave_pix": "chave PIX", "banco": "banco", "agencia": "agência", "conta": "conta", "observacao": "observação"}


@router.get("/fornecedores/modelo.xlsx")
def modelo_fornecedores(ctx: Ctx):
    return _xlsx(planilhas.modelo_fornecedores(), "modelo_fornecedores.xlsx")


@router.post("/fornecedores/importar")
async def importar_fornecedores(ctx: Operador, arquivo: UploadFile = File(...)):
    """Cria ou atualiza fornecedores pela planilha do modelo: o CPF/CNPJ (ou, sem ele, o nome) acha o cadastro existente."""
    conteudo = await arquivo.read()
    try:
        linhas = planilhas.linhas_planilha(conteudo, "Fornecedores")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Não consegui ler a planilha. Use o modelo (.xlsx).") from e
    if not linhas:
        raise HTTPException(400, "Planilha vazia.")
    pos = planilhas.colunas_fornecedores(linhas[0])
    if "nome" not in pos:
        raise HTTPException(400, "A planilha não tem a coluna \"Nome\". Use o modelo.")
    criados, atualizados, erros, novas = 0, 0, [], []

    def col(row, k):
        i = pos.get(k)
        v = row[i] if i is not None and i < len(row) else None
        v = str(int(v) if isinstance(v, float) and v.is_integer() else v).strip() if v is not None else ""
        return v or None

    for n, row in enumerate(linhas[1:], start=2):
        if not any(v not in (None, "") for v in row):
            continue
        nome = col(row, "nome")
        if not nome:
            erros.append(f"Linha {n}: nome vazio")
            continue
        doc = "".join(ch for ch in col(row, "cpf_cnpj") or "" if ch.isdigit()) or None
        tipo = (col(row, "tipo") or "").upper() or None
        if tipo and tipo not in ("PF", "PJ"):
            erros.append(f"Linha {n}: tipo \"{tipo}\" inválido (use PF ou PJ)")
            continue
        if doc and not tipo:
            tipo = "PF" if len(doc) == 11 else "PJ"
        if doc and len(doc) != (11 if tipo == "PF" else 14):
            erros.append(f"Linha {n}: {'CPF precisa ter 11 dígitos' if tipo == 'PF' else 'CNPJ precisa ter 14 dígitos'}")
            continue
        ativo_txt = (col(row, "ativo") or "").lower()
        if ativo_txt and ativo_txt not in ("sim", "s", "não", "nao", "n"):
            erros.append(f"Linha {n}: ativo deve ser Sim ou Não")
            continue
        if doc:
            f = ctx.db.scalar(select(Fornecedor).where(Fornecedor.tenant_id == ctx.tenant_id, Fornecedor.cpf_cnpj == doc))
        else:
            f = ctx.db.scalar(select(Fornecedor).where(Fornecedor.tenant_id == ctx.tenant_id, Fornecedor.cpf_cnpj.is_(None),
                                                       func.lower(Fornecedor.nome) == nome.lower()))
        dados = {k: getattr(f, k) for k in FornecedorIn.model_fields} if f else {}
        dados.update({k: v for k, v in {
            "nome": nome, "tipo": tipo, "cpf_cnpj": doc, "email": col(row, "email"), "telefone": col(row, "telefone"),
            "chave_pix": col(row, "chave_pix"), "banco": col(row, "banco"), "agencia": col(row, "agencia"),
            "conta": col(row, "conta"), "observacao": col(row, "observacao"),
            "ativo": ativo_txt.startswith("s") if ativo_txt else None}.items() if v is not None})
        try:
            valido = FornecedorIn.model_validate(dados)
        except ValidationError as e:
            campo = str(e.errors()[0]["loc"][0]) if e.errors() and e.errors()[0]["loc"] else ""
            erros.append(f"Linha {n}: {_ROTULO_FORN.get(campo, campo) or 'dados'} inválido")
            continue
        cat_nome = col(row, "categoria")
        if cat_nome:
            cat, _ = service.categoria_por_nome(ctx.db, ctx.tenant_id, cat_nome, TipoCategoria.despesa, None, novas)
            valido.categoria_padrao_id = cat.id
        if f:
            for k, v in valido.model_dump().items():
                setattr(f, k, v)
            atualizados += 1
        else:
            ctx.db.add(Fornecedor(tenant_id=ctx.tenant_id, **valido.model_dump()))
            criados += 1
        ctx.db.flush()
    ctx.auditar("financeiro.fornecedor.importar", "fin_fornecedor",
                descricao=f"{arquivo.filename}: {criados} criados, {atualizados} atualizados, {len(erros)} com erro")
    ctx.db.commit()
    return {"criados": criados, "atualizados": atualizados, "erros": erros[:50], "qtd_erros": len(erros), "categorias_novas": novas}


@router.get("/favorecidos")
def favorecidos(ctx: Ctx):
    """Para o campo "Favorecido": fornecedores e funcionários juntos, em grupos."""
    return {
        "fornecedores": [{"id": f.id, "nome": f.nome, "tipo": f.tipo, "categoria_padrao_id": f.categoria_padrao_id}
                         for f in ctx.db.scalars(select(Fornecedor).where(Fornecedor.tenant_id == ctx.tenant_id, Fornecedor.ativo)
                                                 .order_by(Fornecedor.nome))],
        "funcionarios": [{"id": u.id, "nome": u.nome, "cargo": u.cargo.nome if u.cargo else None}
                         for u in ctx.db.scalars(select(Usuario).where(Usuario.tenant_id == ctx.tenant_id, Usuario.ativo)
                                                 .order_by(Usuario.nome))],
    }


# ================================================================ contas a pagar
def _cp_out(ctx, c: ContaPagar) -> ContaPagarOut:
    hoje = date.today()
    return ContaPagarOut.model_validate(c).model_copy(update={
        "favorecido_nome": service._favorecido(ctx.db, c), "categoria_nome": c.categoria.nome if c.categoria else None,
        "subcategoria_nome": c.subcategoria.nome if c.subcategoria else None,
        "conta_bancaria_nome": c.conta_bancaria.nome if c.conta_bancaria else None, "status": c.status,
        "dias_atraso": (hoje - c.data_vencimento).days if c.status == "atrasado" else 0,
        "tem_anexo": bool(c.anexo_path), "tem_comprovante": bool(c.comprovante_path),
        "rateio": [RateioOut(categoria_id=r.categoria_id, categoria_nome=r.categoria.nome, subcategoria_id=r.subcategoria_id,
                             subcategoria_nome=r.subcategoria.nome if r.subcategoria else None, valor=r.valor, percentual=r.percentual)
                   for r in c.rateio]})


def _filtro_cp(ctx, q, categoria_id, subcategoria_id, status, de, ate, fornecedor_id, funcionario_id):
    hoje = date.today()
    f = [ContaPagar.tenant_id == ctx.tenant_id]
    if q:
        f.append(or_(ContaPagar.descricao.ilike(f"%{q}%"), ContaPagar.favorecido.ilike(f"%{q}%"),
                     ContaPagar.documento.ilike(f"%{q}%"),
                     ContaPagar.fornecedor_id.in_(select(Fornecedor.id).where(Fornecedor.nome.ilike(f"%{q}%")))))
    if categoria_id:
        f.append(or_(ContaPagar.categoria_id == categoria_id,
                     ContaPagar.id.in_(select(Rateio.conta_id).where(Rateio.categoria_id == categoria_id))))
    if subcategoria_id:
        f.append(or_(ContaPagar.subcategoria_id == subcategoria_id,
                     ContaPagar.id.in_(select(Rateio.conta_id).where(Rateio.subcategoria_id == subcategoria_id))))
    if status == "pago":
        f.append(ContaPagar.data_pagamento.is_not(None))
    elif status == "atrasado":
        f += [ContaPagar.data_pagamento.is_(None), ContaPagar.data_vencimento < hoje]
    elif status == "pendente":
        f += [ContaPagar.data_pagamento.is_(None), ContaPagar.data_vencimento >= hoje]
    elif status == "aberto":
        f.append(ContaPagar.data_pagamento.is_(None))
    if de:
        f.append(ContaPagar.data_vencimento >= de)
    if ate:
        f.append(ContaPagar.data_vencimento <= ate)
    if fornecedor_id:
        f.append(ContaPagar.fornecedor_id == fornecedor_id)
    if funcionario_id:
        f.append(ContaPagar.funcionario_id == funcionario_id)
    return f


@router.get("/contas-pagar", response_model=ContasPagarListaOut)
def contas_pagar(ctx: Ctx, q: str | None = None, categoria_id: int | None = None, subcategoria_id: int | None = None,
                 status: str | None = Query(None, pattern="^(pendente|atrasado|pago|aberto)$"), de: date | None = None,
                 ate: date | None = None, fornecedor_id: int | None = None, funcionario_id: int | None = None,
                 pagina: int = Query(1, ge=1), por_pagina: int = Query(100, ge=1, le=500)):
    if service.estender_recorrencias(ctx.db, ctx.tenant_id):
        ctx.db.commit()
    f = _filtro_cp(ctx, q, categoria_id, subcategoria_id, status, de, ate, fornecedor_id, funcionario_id)
    todas = list(ctx.db.scalars(select(ContaPagar).where(*f).order_by(ContaPagar.data_vencimento, ContaPagar.id)))
    hoje = date.today()
    soma = lambda xs: service.q2(sum((x.valor for x in xs), Decimal(0)))  # noqa: E731
    abertas = [c for c in todas if not c.data_pagamento]
    atrasadas = [c for c in abertas if c.data_vencimento < hoje]
    semana = [c for c in abertas if hoje <= c.data_vencimento <= hoje + timedelta(days=7)]
    pagas = [c for c in todas if c.data_pagamento]
    kpis = {"em_aberto": soma(abertas), "qtd_aberto": len(abertas), "atrasado": soma(atrasadas), "qtd_atrasado": len(atrasadas),
            "a_vencer": soma(abertas) - soma(atrasadas), "proximos_7_dias": soma(semana), "qtd_proximos_7_dias": len(semana),
            "pago": service.q2(sum((c.valor_pago or c.valor for c in pagas), Decimal(0))), "qtd_pago": len(pagas),
            "total": soma(todas), "qtd": len(todas)}
    pag = todas[(pagina - 1) * por_pagina: pagina * por_pagina]
    return ContasPagarListaOut(itens=[_cp_out(ctx, c) for c in pag], total=len(todas), kpis=kpis)


def _validar_cp(ctx, dados: ContaPagarIn):
    if dados.fornecedor_id:
        _get(ctx, Fornecedor, dados.fornecedor_id, "Fornecedor")
    if dados.funcionario_id:
        _get(ctx, Usuario, dados.funcionario_id, "Funcionário")
    if dados.conta_bancaria_id:
        _get(ctx, ContaBancaria, dados.conta_bancaria_id, "Conta bancária")
    if not (dados.fornecedor_id or dados.funcionario_id or dados.favorecido or dados.descricao):
        raise HTTPException(400, "Informe o favorecido ou a descrição.")


@router.post("/contas-pagar", response_model=list[ContaPagarOut], status_code=201)
def criar_conta_pagar(dados: ContaPagarIn, ctx: Operador):
    _validar_cp(ctx, dados)
    base = dados.model_dump(exclude={"rateio"})
    base["descricao"] = base.get("descricao") or ""
    try:
        contas = service.criar_contas(ctx.db, ctx.tenant_id, ctx.usuario, base, [r.model_dump() for r in dados.rateio])
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.conta_pagar.criar", "fin_conta_pagar", contas[0].id,
                descricao=f"{contas[0].descricao} {contas[0].valor}" + (f" ({len(contas)} parcelas)" if len(contas) > 1 else ""))
    ctx.db.commit()
    return [_cp_out(ctx, c) for c in contas]


@router.get("/contas-pagar/modelo.xlsx")
def modelo_contas_pagar(ctx: Ctx):
    return _xlsx(planilhas.modelo_contas_pagar(), "modelo_contas_a_pagar.xlsx")


@router.post("/contas-pagar/importar")
async def importar_contas_pagar(ctx: Operador, arquivo: UploadFile = File(...)):
    conteudo = await arquivo.read()
    try:
        linhas = planilhas.linhas_planilha(conteudo, "Contas")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Não consegui ler a planilha. Use o modelo (.xlsx).") from e
    importadas, erros, novas = 0, [], []
    for i, row in enumerate(linhas[1:], start=2):
        row = list(row) + [None] * (10 - len(row))
        if not any(v not in (None, "") for v in row[:10]):
            continue
        venc, pag = planilhas.ler_data(row[0]), planilhas.ler_data(row[1])
        valor = planilhas.ler_valor(row[6])
        cat_nome = str(row[2] or "").strip()
        if not venc:
            erros.append(f"Linha {i}: vencimento inválido")
            continue
        if not valor or valor <= 0:
            erros.append(f"Linha {i}: valor inválido")
            continue
        if not cat_nome:
            erros.append(f"Linha {i}: categoria vazia")
            continue
        cat, sub = service.categoria_por_nome(ctx.db, ctx.tenant_id, cat_nome, TipoCategoria.despesa, str(row[3] or "") or None, novas)
        fav = str(row[5] or "").strip() or None
        forn = None
        if fav:
            forn = ctx.db.scalar(select(Fornecedor).where(Fornecedor.tenant_id == ctx.tenant_id, func.lower(Fornecedor.nome) == fav.lower()))
            if not forn:
                forn = Fornecedor(tenant_id=ctx.tenant_id, nome=fav)
                ctx.db.add(forn)
                ctx.db.flush()
        forma = planilhas.FORMAS.get(str(row[7] or "").strip().lower())
        c = ContaPagar(tenant_id=ctx.tenant_id, descricao=str(row[4] or "").strip() or cat.nome, fornecedor_id=forn.id if forn else None,
                       favorecido=fav, categoria_id=cat.id, subcategoria_id=sub.id if sub else None, valor=valor, data_vencimento=venc,
                       data_pagamento=pag, valor_pago=valor if pag else None, forma_pagamento=FormaPagamento(forma) if forma else None,
                       documento=str(row[8] or "")[:80] or None, observacao=str(row[9] or "") or None, criado_por_id=ctx.usuario.id,
                       rateio=[Rateio(categoria_id=cat.id, subcategoria_id=sub.id if sub else None, valor=valor, percentual=Decimal(100))])
        ctx.db.add(c)
        importadas += 1
    ctx.auditar("financeiro.conta_pagar.importar", "fin_conta_pagar", descricao=f"{arquivo.filename}: {importadas} contas")
    ctx.db.commit()
    return {"importadas": importadas, "erros": erros[:50], "qtd_erros": len(erros), "categorias_novas": novas}


@router.get("/contas-pagar/exportar.xlsx")
def exportar_contas_pagar(ctx: Ctx, q: str | None = None, categoria_id: int | None = None, subcategoria_id: int | None = None,
                          status: str | None = None, de: date | None = None, ate: date | None = None, fornecedor_id: int | None = None):
    f = _filtro_cp(ctx, q, categoria_id, subcategoria_id, status, de, ate, fornecedor_id, None)
    linhas = []
    total = Decimal(0)
    for c in ctx.db.scalars(select(ContaPagar).where(*f).order_by(ContaPagar.data_vencimento)):
        o = _cp_out(ctx, c)
        total += c.valor
        linhas.append([c.data_vencimento, c.data_pagamento, o.categoria_nome, o.subcategoria_nome, c.descricao, o.favorecido_nome,
                       c.valor, c.forma_pagamento.value if c.forma_pagamento else None, c.documento, c.observacao, o.status])
    arq = planilhas.tabela("Contas", planilhas.COLUNAS_CONTAS + ["Status"], linhas, larguras=[14, 14, 24, 20, 32, 28, 14, 16, 16, 30, 12],
                           moeda={6}, datas={0, 1}, rodape=[None, None, None, None, "Total", None, total])
    return _xlsx(arq, f"contas_a_pagar_{date.today():%Y%m%d}.xlsx")


@router.post("/contas-pagar/pagar-lote", response_model=Mensagem)
def pagar_lote(dados: PagarLoteIn, ctx: Operador):
    banco = _get(ctx, ContaBancaria, dados.conta_bancaria_id, "Conta bancária") if dados.conta_bancaria_id else None
    n = 0
    for cid in dados.ids:
        c = _get(ctx, ContaPagar, cid, "Conta")
        if c.data_pagamento:
            continue
        try:
            service.pagar(ctx.db, c, ctx.usuario, data=dados.data or c.data_vencimento, conta_bancaria=banco)
        except service.RegraFinanceiro as e:
            _falha(ctx, e)
        n += 1
    ctx.auditar("financeiro.conta_pagar.pagar_lote", "fin_conta_pagar", descricao=f"{n} contas pagas")
    ctx.db.commit()
    return Mensagem(mensagem=f"{n} conta(s) paga(s).")


@router.get("/contas-pagar/{cid}", response_model=ContaPagarOut)
def ler_conta_pagar(cid: int, ctx: Ctx):
    return _cp_out(ctx, _get(ctx, ContaPagar, cid, "Conta"))


@router.put("/contas-pagar/{cid}", response_model=Mensagem)
def alterar_conta_pagar(cid: int, dados: ContaPagarEdicaoIn, ctx: Operador):
    c = _get(ctx, ContaPagar, cid, "Conta")
    _validar_cp(ctx, dados)
    campos = dados.model_dump(exclude={"rateio", "escopo", "recorrencia_meses", "recorrencia_indeterminada", "repeticoes"})
    campos["descricao"] = campos.get("descricao") or ""
    try:
        n = service.editar_conta(ctx.db, c, campos, [r.model_dump() for r in dados.rateio], dados.escopo)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.conta_pagar.alterar", "fin_conta_pagar", c.id, descricao=f"{c.descricao} ({n} conta(s))")
    ctx.db.commit()
    return Mensagem(mensagem="Conta atualizada." if n == 1 else f"{n} contas da série atualizadas.")


@router.delete("/contas-pagar/{cid}", response_model=Mensagem)
def excluir_conta_pagar(cid: int, ctx: Operador, escopo: str = Query("ocorrencia", pattern="^(ocorrencia|serie)$")):
    c = _get(ctx, ContaPagar, cid, "Conta")
    texto = f"{c.descricao} {c.valor}"
    try:
        n = service.excluir_conta(ctx.db, c, ExcluirContaIn(escopo=escopo).escopo)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.conta_pagar.excluir", "fin_conta_pagar", cid, descricao=f"{texto} ({n} conta(s))")
    ctx.db.commit()
    return Mensagem(mensagem="Conta excluída." if n == 1 else f"{n} contas da série excluídas.")


@router.post("/contas-pagar/{cid}/pagar", response_model=ContaPagarOut)
def pagar(cid: int, dados: PagarIn, ctx: Operador):
    c = _get(ctx, ContaPagar, cid, "Conta")
    banco = _get(ctx, ContaBancaria, dados.conta_bancaria_id, "Conta bancária") if dados.conta_bancaria_id else None
    try:
        lc = service.pagar(ctx.db, c, ctx.usuario, data=dados.data, conta_bancaria=banco, juros=dados.juros, desconto=dados.desconto)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.conta_pagar.pagar", "fin_conta_pagar", c.id,
                descricao=f"{c.descricao} paga em {dados.data:%d/%m/%Y}" + ("" if lc else " (sem conta bancária)"))
    ctx.db.commit()
    return _cp_out(ctx, c)


@router.post("/contas-pagar/{cid}/reabrir", response_model=ContaPagarOut)
def reabrir(cid: int, ctx: Operador):
    c = _get(ctx, ContaPagar, cid, "Conta")
    try:
        service.reabrir(ctx.db, c)
    except service.RegraFinanceiro as e:
        _falha(ctx, e)
    ctx.auditar("financeiro.conta_pagar.reabrir", "fin_conta_pagar", c.id, descricao=c.descricao)
    ctx.db.commit()
    return _cp_out(ctx, c)


@router.post("/contas-pagar/{cid}/arquivo", response_model=ContaPagarOut)
async def enviar_arquivo(cid: int, ctx: Operador, tipo: str = Query("anexo", pattern="^(anexo|comprovante)$"),
                         arquivo: UploadFile = File(...)):
    c = _get(ctx, ContaPagar, cid, "Conta")
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Envie PDF ou imagem.")
    conteudo = await arquivo.read()
    if len(conteudo) > ANEXO_MAX:
        raise HTTPException(400, "Arquivo maior que 15 MB.")
    pasta = tenancy.pasta_base() / "contas_pagar" / f"{c.data_vencimento:%Y}"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"conta_{c.id}_{tipo}{ext}"
    destino.write_bytes(conteudo)
    setattr(c, f"{tipo}_path", str(destino))
    ctx.db.commit()
    return _cp_out(ctx, c)


@router.get("/contas-pagar/{cid}/arquivo")
def baixar_arquivo(cid: int, ctx: Ctx, tipo: str = Query("anexo", pattern="^(anexo|comprovante)$")):
    c = _get(ctx, ContaPagar, cid, "Conta")
    p = getattr(c, f"{tipo}_path")
    if not p or not Path(p).exists():
        raise HTTPException(404, "Arquivo não encontrado.")
    return FileResponse(p, filename=Path(p).name, content_disposition_type="inline")


@router.post("/contas-pagar/{cid}/agendamento", response_model=ContaPagarOut)
def enviar_agendamento(cid: int, ctx: Operador):
    """Avisa por e-mail (quem agenda os pagamentos no banco) que há uma conta para agendar."""
    from app.core import email as mail

    c = _get(ctx, ContaPagar, cid, "Conta")
    cfg = service.config(ctx.db, ctx.tenant_id)
    if not cfg.agendamento_destinatarios:
        raise HTTPException(400, "Defina os destinatários do aviso em Configurações › Financeiro.")
    o = _cp_out(ctx, c)
    valor = f"R$ {c.valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    corpo = (f"Olá,\n\nPor favor, agende o pagamento abaixo:\n\nFavorecido: {o.favorecido_nome}\nDescrição: {c.descricao}\n"
             f"Valor: {valor}\nVencimento: {c.data_vencimento:%d/%m/%Y}\n"
             f"Forma: {c.forma_pagamento.value.upper() if c.forma_pagamento else '—'}\n"
             + (f"Código de barras: {c.codigo_barras}\n" if c.codigo_barras else "")
             + (f"Documento: {c.documento}\n" if c.documento else "") + f"\nEnviado por {ctx.usuario.nome}.")
    anexos = [(Path(c.anexo_path).name, Path(c.anexo_path).read_bytes())] if c.anexo_path and Path(c.anexo_path).exists() else None
    try:
        mail.enviar(cfg.agendamento_destinatarios, f"Agendar pagamento — {o.favorecido_nome} — {valor} — venc. {c.data_vencimento:%d/%m}",
                    corpo, anexos)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Não consegui enviar o e-mail: {e}") from e
    c.agendamento_enviado_em = date.today()
    ctx.auditar("financeiro.conta_pagar.agendamento", "fin_conta_pagar", c.id, descricao=c.descricao)
    ctx.db.commit()
    return _cp_out(ctx, c)


# ================================================================ relatórios
@router.get("/fluxo-caixa")
def fluxo_caixa(ctx: Ctx, de: date | None = None, ate: date | None = None, conta_ids: list[int] | None = Query(None),
                agrupar: str = Query("dia", pattern="^(dia|semana|mes)$")):
    ini, fim = service.mes_atual()
    return relatorios.fluxo_caixa(ctx.db, ctx.tenant_id, de=de or ini, ate=ate or fim, conta_ids=conta_ids, agrupar=agrupar)


@router.get("/fluxo-caixa.xlsx")
def fluxo_caixa_xlsx(ctx: Ctx, de: date | None = None, ate: date | None = None, conta_ids: list[int] | None = Query(None)):
    ini, fim = service.mes_atual()
    de, ate = de or ini, ate or fim
    r = relatorios.fluxo_caixa(ctx.db, ctx.tenant_id, de=de, ate=ate, conta_ids=conta_ids)
    linhas = [[None, "Saldo anterior", None, None, None, None, None, None, r["saldo_anterior"]]]
    linhas += [[x["data"], x["descricao"], x["conta"], x["categoria"], x["subcategoria"], x["favorecido"], x["saida"], x["entrada"], x["saldo"]]
               for x in r["linhas"]]
    from app.core.models import Identidade

    ident = ctx.db.get(Identidade, ctx.tenant_id)
    arq = planilhas.tabela("Fluxo de caixa", ["Data", "Descrição", "Conta", "Categoria", "Subcategoria", "Favorecido", "Débito", "Crédito",
                                              "Saldo"], linhas, larguras=[12, 44, 20, 24, 22, 28, 14, 14, 16], moeda={6, 7, 8},
                           datas={0}, topo=[f"Fluxo de caixa — {ident.nome_exibicao if ident else ''}", f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}"],
                           rodape=[None, "Totais do período", None, None, None, None, r["saidas"], r["entradas"], r["saldo_final"]])
    return _xlsx(arq, f"fluxo_caixa_{de:%Y%m%d}_{ate:%Y%m%d}.xlsx")


@router.get("/dre")
def dre(ctx: Ctx, de: date | None = None, ate: date | None = None, mensal: bool = False,
        conta_ids: list[int] | None = Query(None)):
    hoje = date.today()
    return relatorios.dre(ctx.db, ctx.tenant_id, de=de or hoje.replace(month=1, day=1), ate=ate or hoje, mensal=mensal,
                          conta_ids=conta_ids)


@router.get("/dre.xlsx")
def dre_xlsx(ctx: Ctx, de: date | None = None, ate: date | None = None, conta_ids: list[int] | None = Query(None)):
    hoje = date.today()
    de, ate = de or hoje.replace(month=1, day=1), ate or hoje
    r = relatorios.dre(ctx.db, ctx.tenant_id, de=de, ate=ate, mensal=True, conta_ids=conta_ids)
    cab = ["Linha"] + [relatorios.rotulo_mes(date.fromisoformat(m + "-01")) for m in r["meses"]] + ["Total"]
    linhas = []
    for lin in r["linhas"]:
        linhas.append([lin["rotulo"].upper() if lin["tipo"] == "subtotal" else lin["rotulo"]] + [lin["meses"].get(m) for m in r["meses"]]
                      + [lin["total"]])
        for it in lin.get("itens", []):
            linhas.append(["    " + it["categoria"]] + [it["meses"].get(m) for m in r["meses"]] + [it["total"]])
    arq = planilhas.tabela("DRE", cab, linhas, larguras=[44] + [14] * (len(cab) - 1), moeda=set(range(1, len(cab))),
                           topo=["DRE gerencial (regime de caixa)", f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}"])
    return _xlsx(arq, f"dre_{de:%Y%m%d}_{ate:%Y%m%d}.xlsx")


@router.get("/projecao-despesas")
def projecao_despesas(ctx: Ctx, meses: int = Query(12, ge=3, le=24)):
    return relatorios.projecao_despesas(ctx.db, ctx.tenant_id, meses)


@router.get("/previsao-caixa")
def previsao_caixa(ctx: Ctx, horizonte: int = Query(90, ge=7, le=365), saldo_minimo: Decimal | None = None,
                   atraso_dias: int | None = Query(15, ge=0, le=120), contar_atrasados: bool = True, recorrentes: bool = True,
                   revisoes: bool = False, gasto_medio: bool = True):
    return relatorios.previsao_caixa(ctx.db, ctx.tenant_id, horizonte=horizonte, saldo_minimo=saldo_minimo,
                                     atraso_dias=atraso_dias if contar_atrasados else None, recorrentes=recorrentes,
                                     revisoes=revisoes, gasto_medio=gasto_medio)


@router.get("/relatorio-faturamento")
def relatorio_faturamento(ctx: Ctx, de: date | None = None, ate: date | None = None, tomador_id: int | None = None,
                          emissora_id: int | None = None, tipo: str | None = Query(None, pattern="^(honorarios|despesas)$"),
                          situacao: str | None = Query(None, pattern="^(aberta|vencida|paga|cancelada)$")):
    return relatorios.relatorio_faturamento(ctx.db, ctx.tenant_id, de=de, ate=ate, tomador_id=tomador_id, emissora_id=emissora_id,
                                            tipo=tipo, situacao=situacao)


@router.get("/relatorio-faturamento.xlsx")
def relatorio_faturamento_xlsx(ctx: Ctx, de: date | None = None, ate: date | None = None, tomador_id: int | None = None,
                               emissora_id: int | None = None, tipo: str | None = None, situacao: str | None = None):
    r = relatorios.relatorio_faturamento(ctx.db, ctx.tenant_id, de=de, ate=ate, tomador_id=tomador_id, emissora_id=emissora_id,
                                         tipo=tipo, situacao=situacao)
    linhas = [[f["codigo"], f["cliente"], f["emissao"], f["vencimento"], f["pago_em"], f["nfse"], f["situacao"], f["total"]]
              for f in r["faturas"]]
    arq = planilhas.tabela("Faturamento", ["Fatura", "Cliente", "Emissão", "Vencimento", "Pagamento", "NFS-e", "Situação", "Total"],
                           linhas, larguras=[16, 40, 12, 12, 12, 10, 12, 16], moeda={7}, datas={2, 3, 4},
                           topo=["Relatório de faturamento", f"{de:%d/%m/%Y} a {ate:%d/%m/%Y}" if de and ate else "Todo o período"],
                           rodape=[None, f"{r['resumo']['qtd']} fatura(s)", None, None, None, None, None, r["resumo"]["total"]])
    return _xlsx(arq, f"relatorio_faturamento_{date.today():%Y%m%d}.xlsx")


# ================================================================ configurações
@router.get("/config", response_model=ConfigFinanceiroOut)
def ler_config(ctx: Ctx):
    service.garantir_categorias_padrao(ctx.db, ctx.tenant_id)
    cfg = service.config(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    return cfg


@router.put("/config", response_model=ConfigFinanceiroOut)
def salvar_config(dados: ConfigFinanceiroIn, ctx: Admin):
    cfg = service.config(ctx.db, ctx.tenant_id)
    if dados.conta_recebimento_id:
        _get(ctx, ContaBancaria, dados.conta_recebimento_id, "Conta")
    for k in ("categoria_honorarios_id", "categoria_reembolso_id"):
        if getattr(dados, k):
            _get(ctx, CategoriaFinanceira, getattr(dados, k), "Categoria")
    for k, v in dados.model_dump().items():
        setattr(cfg, k, [str(e).lower() for e in v] if k == "agendamento_destinatarios" else v)
    ctx.auditar("financeiro.config", "fin_config", descricao="Configurações do financeiro")
    ctx.db.commit()
    return cfg


# ================================================================ projeção de impostos
def _emissora(ctx, emissora_id: int | None) -> Emissora:
    if emissora_id:
        return _get(ctx, Emissora, emissora_id, "Emissora")
    e = ctx.db.scalar(select(Emissora).where(Emissora.tenant_id == ctx.tenant_id, Emissora.ativa).order_by(Emissora.id))
    if not e:
        raise HTTPException(400, "Cadastre a empresa emissora primeiro.")
    return e


@router.get("/impostos")
def projecao_impostos(ctx: Ctx, emissora_id: int | None = None, metodo: str = Query("media3", pattern="^(media3|media6|media12|ano_anterior)$")):
    e = _emissora(ctx, emissora_id)
    r = impostos.projecao(ctx.db, ctx.tenant_id, e, metodo=metodo)
    ctx.db.commit()
    return r


@router.post("/impostos/recalcular")
def recalcular_impostos(body: dict, ctx: Ctx):
    """Recalcula com as receitas futuras editadas na tela ({emissora_id, metodo, editados: {"2026-11": 50000}})."""
    e = _emissora(ctx, body.get("emissora_id"))
    editados = {k: Decimal(str(v)) for k, v in (body.get("editados") or {}).items() if v not in (None, "")}
    return impostos.projecao(ctx.db, ctx.tenant_id, e, metodo=body.get("metodo") or "media3", editados=editados)


@router.put("/impostos/{emissora_id}/config")
def salvar_config_impostos(emissora_id: int, dados: ConfigImpostosIn, ctx: Admin):
    e = _get(ctx, Emissora, emissora_id, "Emissora")
    if dados.regime and dados.regime != e.regime.value:  # o regime mora no cadastro da emissora
        from app.modules.rpa_nfse.models import Regime

        e.regime = Regime(dados.regime)
    cfg = impostos.config(ctx.db, ctx.tenant_id, e)
    campos = dados.model_dump(exclude={"faixas", "recarregar_tabela", "regime"})
    trocou_anexo = campos["anexo"] != cfg.anexo
    for k, v in campos.items():
        setattr(cfg, k, v)
    if dados.recarregar_tabela or (trocou_anexo and not dados.faixas):
        cfg.faixas = impostos.faixas_padrao(cfg.anexo)
    elif dados.faixas:
        if len(dados.faixas) != 6:
            raise HTTPException(400, "O Simples tem 6 faixas.")
        cfg.faixas = [{"limite": float(f["limite"]), "aliquota": float(f["aliquota"]), "deducao": float(f["deducao"])} for f in dados.faixas]
    ctx.auditar("financeiro.impostos.config", "fin_config_impostos", e.id, descricao=f"{e.razao_social}: {cfg.regime}")
    ctx.db.commit()
    return impostos.projecao(ctx.db, ctx.tenant_id, e)


@router.post("/impostos/{emissora_id}/receitas-informadas")
def informar_receita(emissora_id: int, dados: ReceitaInformadaIn, ctx: Operador):
    e = _get(ctx, Emissora, emissora_id, "Emissora")
    mes = date.fromisoformat(dados.mes + "-01")
    r = ctx.db.scalar(select(ReceitaInformada).where(ReceitaInformada.emissora_id == e.id, ReceitaInformada.mes == mes))
    if not r:
        r = ReceitaInformada(tenant_id=ctx.tenant_id, emissora_id=e.id, mes=mes, valor=dados.valor)
        ctx.db.add(r)
    r.valor, r.observacao = dados.valor, dados.observacao
    ctx.auditar("financeiro.impostos.receita_informada", "fin_receita_informada", descricao=f"{e.razao_social} {dados.mes}: {dados.valor}")
    ctx.db.commit()
    return impostos.projecao(ctx.db, ctx.tenant_id, e)


@router.delete("/impostos/{emissora_id}/receitas-informadas/{mes}")
def apagar_receita_informada(emissora_id: int, mes: str, ctx: Operador):
    e = _get(ctx, Emissora, emissora_id, "Emissora")
    r = ctx.db.scalar(select(ReceitaInformada).where(ReceitaInformada.emissora_id == e.id,
                                                     ReceitaInformada.mes == date.fromisoformat(mes + "-01")))
    if r:
        ctx.db.delete(r)
        ctx.db.commit()
    return impostos.projecao(ctx.db, ctx.tenant_id, e)


@router.post("/impostos/{emissora_id}/simular")
def simular_imposto(emissora_id: int, dados: SimularImpostoIn, ctx: Ctx):
    e = _get(ctx, Emissora, emissora_id, "Emissora")
    return impostos.simular(ctx.db, ctx.tenant_id, e, dados.valor, dados.mes)



