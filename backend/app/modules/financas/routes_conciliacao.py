"""Financeiro › Conciliação bancária: extrato do banco × contas a pagar, faturas e lançamentos de UMA conta.

Permissão `conciliacao.ver` (consultar) e `conciliacao.conciliar` (subir extrato, criar, dar baixa e desfazer).
"""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.core import ia
from app.core.deps import Ctx, Operador
from app.core.documentos import so_digitos
from app.core.models import Usuario
from app.core.schemas import Mensagem
from app.modules.financas import conciliacao, service
from app.modules.financas.models import (
    Conciliacao,
    ConciliacaoLinha,
    ConciliacaoRegra,
    ContaBancaria,
    ContaPagar,
    Fornecedor,
    Lancamento,
    SituacaoLinha,
    TipoLancamento,
)
from app.modules.rpa_nfse import extrato as leitor
from app.modules.rpa_nfse import fatura as faturas
from app.modules.rpa_nfse.models import Fatura, Nfse, StatusFatura, Tomador

router = APIRouter(prefix="/financeiro/conciliacao", tags=["Conciliação bancária"])
TAMANHO_MAX = 15 * 1024 * 1024


# ---------------------------------------------------------------- o que entra
class ItemPagar(BaseModel):
    linha_id: int
    descricao: str | None = Field(default=None, max_length=255)
    categoria_id: int | None = None
    subcategoria_id: int | None = None
    fornecedor_id: int | None = None
    funcionario_id: int | None = None
    favorecido: str | None = Field(default=None, max_length=200)


class ItemReceber(BaseModel):
    linha_id: int
    modo: Literal["avulsa", "fatura"] = "avulsa"
    descricao: str | None = Field(default=None, max_length=255)
    categoria_id: int | None = None
    subcategoria_id: int | None = None
    favorecido: str | None = Field(default=None, max_length=200)
    fatura_ids: list[int] = Field(default_factory=list, max_length=conciliacao.MAX_TITULOS)


class ItemBaixa(BaseModel):
    linha_id: int
    titulo: Literal["conta_pagar", "fatura"]
    ids: list[int] = Field(default_factory=list, max_length=conciliacao.MAX_TITULOS)


class CriarPagarIn(BaseModel):
    itens: list[ItemPagar] = Field(min_length=1, max_length=500)


class CriarReceberIn(BaseModel):
    itens: list[ItemReceber] = Field(min_length=1, max_length=500)


class AprovarBaixasIn(BaseModel):
    itens: list[ItemBaixa] = Field(min_length=1, max_length=500)


class DesfazerIn(BaseModel):
    linha_ids: list[int] | None = None  # vazio = tudo o que esta conciliação criou ou baixou
    excluir_importacao: bool = False  # depois de desfazer tudo, apaga o extrato (para subir o arquivo certo)


class LinhasIn(BaseModel):
    linha_ids: list[int] = Field(min_length=1, max_length=500)


# ---------------------------------------------------------------- o que sai
class TituloOut(BaseModel):
    tipo: Literal["conta_pagar", "fatura"]
    id: int
    rotulo: str  # descrição da conta ou código da fatura
    nome: str  # favorecido ou cliente
    valor: Decimal
    valor_liquido: Decimal | None = None  # fatura com retenção: o que o cliente deposita
    vencimento: date


class VinculoOut(BaseModel):
    tipo: str
    rotulo: str
    lancamento_id: int | None
    conta_pagar_id: int | None
    fatura_id: int | None


class SugestaoOut(BaseModel):
    descricao: str = ""
    categoria_id: int | None = None
    subcategoria_id: int | None = None
    fornecedor_id: int | None = None
    funcionario_id: int | None = None
    favorecido: str | None = None
    natureza: str | None = None
    origem: str | None = None  # regra | cadastro | palavras | ia
    aviso: str | None = None


class LinhaOut(BaseModel):
    id: int
    data: date
    tipo: TipoLancamento
    valor: Decimal
    descricao: str
    documento: str | None
    situacao: SituacaoLinha
    confianca: str | None
    motivo: str | None
    aviso: str | None = None
    sugestao: SugestaoOut | None = None
    titulos: list[TituloOut] = []
    vinculos: list[VinculoOut] = []


class SoNoSistemaOut(BaseModel):
    id: int
    data: date
    tipo: TipoLancamento
    valor: Decimal
    descricao: str
    origem: str
    fatura_id: int | None
    conta_pagar_id: int | None


class ResumoOut(BaseModel):
    pagar_criar: int = 0
    receber_criar: int = 0
    baixas: int = 0
    baixas_alta: int = 0
    conciliadas: int = 0
    feitas: int = 0
    ignoradas: int = 0
    so_no_sistema: int = 0
    pendentes: int = 0
    valor_pagar_criar: Decimal = Decimal(0)
    valor_receber_criar: Decimal = Decimal(0)


class FechamentoOut(BaseModel):
    data: date
    saldo_extrato: Decimal | None
    saldo_sistema: Decimal
    diferenca: Decimal | None
    a_lancar: Decimal
    sem_explicacao: Decimal | None


class ConciliacaoOut(BaseModel):
    id: int
    conta_id: int
    conta_nome: str
    arquivo_nome: str
    formato: str
    banco: str | None
    periodo_de: date
    periodo_ate: date
    criado_em: datetime
    usuario_nome: str | None
    qtd_linhas: int
    qtd_repetidas: int
    resumo: ResumoOut


class ConciliacaoDetalhe(ConciliacaoOut):
    linhas: list[LinhaOut]
    so_no_sistema: list[SoNoSistemaOut]
    fechamento: FechamentoOut
    ia_disponivel: bool


class ResultadoOut(BaseModel):
    feitas: int
    ja_feitas: int
    mensagem: str
    conciliacao: ConciliacaoDetalhe


class DesfeitoOut(BaseModel):
    desfeitas: int
    avisos: list[str]
    nao_desfeitas: list[dict]
    excluida: bool
    mensagem: str
    conciliacao: ConciliacaoDetalhe | None


class RegraOut(BaseModel):
    id: int
    tipo: TipoLancamento
    padrao: str
    exemplo: str | None
    natureza: str | None
    categoria_nome: str | None
    subcategoria_nome: str | None
    favorecido_nome: str | None
    usos: int


# ---------------------------------------------------------------- montagem
def _conc(ctx, cid: int) -> Conciliacao:
    c = ctx.db.get(Conciliacao, cid)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Conciliação não encontrada.")
    return c


def _titulo_conta(ctx, c: ContaPagar) -> TituloOut:
    return TituloOut(tipo="conta_pagar", id=c.id, rotulo=c.descricao, nome=service._favorecido(ctx.db, c), valor=c.valor,
                     vencimento=c.data_vencimento)


def _titulo_fatura(f: Fatura) -> TituloOut:
    rotulo = f.codigo + (f" · NFS-e {f.nfse.numero}" if f.nfse else "")
    return TituloOut(tipo="fatura", id=f.id, rotulo=rotulo, nome=faturas.dados_cliente(f).get("nome") or "", valor=f.total,
                     valor_liquido=conciliacao.valor_liquido(f), vencimento=f.data_vencimento)


def _vinculo_out(ctx, v) -> VinculoOut:
    lc = ctx.db.get(Lancamento, v.lancamento_id) if v.lancamento_id else None
    cp_id, fat_id = v.conta_pagar_id, v.fatura_id
    if v.tipo == "vinculo" and lc:  # mostra de onde veio o lançamento que já existia
        fat_id = lc.fatura_id
        cp_id = ctx.db.scalar(select(ContaPagar.id).where(ContaPagar.lancamento_id == lc.id)) if lc.origem == "conta_pagar" else None
        rotulo = f"{lc.descricao} ({lc.data:%d/%m/%Y})"
    elif v.tipo == "conta_criada":
        cp = ctx.db.get(ContaPagar, cp_id) if cp_id else None
        rotulo = f"Conta a pagar criada e paga: {cp.descricao}" if cp else "Conta a pagar criada e paga"
    elif v.tipo == "receita_avulsa":
        rotulo = f"Receita lançada: {lc.descricao}" if lc else "Receita lançada"
    elif v.tipo == "baixa_conta":
        cp = ctx.db.get(ContaPagar, cp_id) if cp_id else None
        rotulo = f"Baixa da conta a pagar: {cp.descricao}" if cp else "Baixa de conta a pagar"
    else:
        fat = ctx.db.get(Fatura, fat_id) if fat_id else None
        rotulo = f"Baixa da fatura {fat.codigo}" if fat else "Baixa de fatura"
    return VinculoOut(tipo=v.tipo, rotulo=rotulo, lancamento_id=v.lancamento_id, conta_pagar_id=cp_id, fatura_id=fat_id)


def _linha_out(ctx, ln: ConciliacaoLinha) -> LinhaOut:
    s = ln.sugestao or {}
    titulos, sugestao, aviso = [], None, None
    if ln.situacao == SituacaoLinha.baixa_sugerida:
        for tid in s.get("ids") or []:
            if s.get("titulo") == "conta_pagar" and (c := ctx.db.get(ContaPagar, tid)):
                titulos.append(_titulo_conta(ctx, c))
            elif s.get("titulo") == "fatura" and (f := ctx.db.get(Fatura, tid)):
                titulos.append(_titulo_fatura(f))
        aviso = s.get("aviso")
    elif ln.situacao in (SituacaoLinha.sem_correspondencia, SituacaoLinha.ignorada):
        sugestao = SugestaoOut(**{k: s.get(k) for k in SugestaoOut.model_fields if s.get(k) is not None})
        aviso = s.get("aviso")
    vinculos = [_vinculo_out(ctx, v) for v in ln.vinculos]
    if ln.situacao == SituacaoLinha.feita:
        lancado = sum((lc.valor for v in ln.vinculos if v.lancamento_id and (lc := ctx.db.get(Lancamento, v.lancamento_id))), Decimal(0))
        if lancado != ln.valor:
            aviso = (f"O que está lançado para esta linha soma {conciliacao._brl(lancado)}, e o banco mostra "
                     f"{conciliacao._brl(ln.valor)}: parte foi desfeita ou alterada em outra tela.")
    return LinhaOut(id=ln.id, data=ln.data, tipo=ln.tipo, valor=ln.valor, descricao=ln.descricao, documento=ln.documento,
                    situacao=ln.situacao, confianca=ln.confianca, motivo=ln.motivo, aviso=aviso, sugestao=sugestao,
                    titulos=titulos, vinculos=vinculos)


def _resumo(linhas: list[ConciliacaoLinha], so_sistema: int = 0) -> ResumoOut:
    r = ResumoOut(so_no_sistema=so_sistema)
    for ln in linhas:
        if ln.situacao == SituacaoLinha.sem_correspondencia:
            if ln.tipo == TipoLancamento.debito:
                r.pagar_criar += 1
                r.valor_pagar_criar += ln.valor
            else:
                r.receber_criar += 1
                r.valor_receber_criar += ln.valor
        elif ln.situacao == SituacaoLinha.baixa_sugerida:
            r.baixas += 1
            r.baixas_alta += 1 if ln.confianca == "alta" else 0
        elif ln.situacao == SituacaoLinha.conciliada:
            r.conciliadas += 1
        elif ln.situacao == SituacaoLinha.feita:
            r.feitas += 1
        else:
            r.ignoradas += 1
    r.pendentes = r.pagar_criar + r.receber_criar + r.baixas
    return r


def _base(ctx, c: Conciliacao, so_sistema: int = 0) -> dict:
    autor = ctx.db.get(Usuario, c.usuario_id) if c.usuario_id else None
    return dict(id=c.id, conta_id=c.conta_id, conta_nome=c.conta.nome, arquivo_nome=c.arquivo_nome, formato=c.formato, banco=c.banco,
                periodo_de=c.periodo_de, periodo_ate=c.periodo_ate, criado_em=c.criado_em, usuario_nome=autor.nome if autor else None,
                qtd_linhas=c.qtd_linhas, qtd_repetidas=c.qtd_repetidas, resumo=_resumo(c.linhas, so_sistema))


def _ia_ligada(ctx) -> bool:
    try:
        ia.provedor_ativo(ctx.db, ctx.tenant_id)
    except ia.IAIndisponivel:
        return False
    return ctx.pode("ia.usar")


def _detalhe(ctx, c: Conciliacao) -> ConciliacaoDetalhe:
    fora = conciliacao.so_no_sistema(ctx.db, c)
    contas_pagas = dict(ctx.db.execute(select(ContaPagar.lancamento_id, ContaPagar.id).where(
        ContaPagar.lancamento_id.in_([lc.id for lc in fora if lc.origem == "conta_pagar"]))).all()) if fora else {}
    return ConciliacaoDetalhe(
        **_base(ctx, c, len(fora)), linhas=[_linha_out(ctx, ln) for ln in c.linhas],
        so_no_sistema=[SoNoSistemaOut(id=lc.id, data=lc.data, tipo=lc.tipo, valor=lc.valor, descricao=lc.descricao, origem=lc.origem,
                                      fatura_id=lc.fatura_id, conta_pagar_id=contas_pagas.get(lc.id)) for lc in fora],
        fechamento=FechamentoOut(**conciliacao.fechamento(ctx.db, c)), ia_disponivel=_ia_ligada(ctx))


def _atualizar(ctx, c: Conciliacao) -> None:
    """Refaz a classificação antes de mostrar (o que mudou em outras telas aparece aqui)."""
    try:
        conciliacao.classificar(ctx.db, c)
        ctx.db.commit()
    except IntegrityError:  # outra chamada acabou de vincular a mesma linha: vale o que ela gravou
        ctx.db.rollback()
    ctx.db.refresh(c)


def _gravar(ctx, c: Conciliacao, acao, itens: list[dict], *, auditoria: str, feito: str) -> ResultadoOut:
    """Confirmação de um popup: tudo numa transação. Qualquer problema desfaz o lote inteiro e diz em que linha."""
    cid = c.id
    try:
        r = acao(ctx.db, c, ctx.usuario, itens)
        conciliacao.classificar(ctx.db, c)
        if r["feitas"]:
            ctx.auditar(auditoria, "fin_conciliacao", cid, descricao=f"{c.arquivo_nome} ({c.conta.nome}): {r['feitas']} {feito}")
        ctx.db.commit()
    except conciliacao.Pendencias as e:
        ctx.db.rollback()
        raise HTTPException(400, {"mensagem": str(e), "linhas": e.linhas}) from e
    except IntegrityError as e:
        ctx.db.rollback()
        raise HTTPException(409, "Estas linhas acabaram de ser lançadas por outra confirmação. Atualize a tela.") from e
    c = _conc(ctx, cid)
    if r["feitas"]:
        mensagem = f"{r['feitas']} {feito}."
    else:
        mensagem = "Nada a gravar: estas linhas já estavam lançadas." if r["ja_feitas"] else "Nada a gravar."
    return ResultadoOut(feitas=r["feitas"], ja_feitas=r["ja_feitas"], mensagem=mensagem, conciliacao=_detalhe(ctx, c))


# ---------------------------------------------------------------- rotas fixas (antes de /{cid})
@router.get("", response_model=list[ConciliacaoOut])
def listar(ctx: Ctx, conta_id: int | None = None, limite: int = Query(50, ge=1, le=200)):
    q = select(Conciliacao).where(Conciliacao.tenant_id == ctx.tenant_id)
    if conta_id:
        q = q.where(Conciliacao.conta_id == conta_id)
    return [ConciliacaoOut(**_base(ctx, c)) for c in ctx.db.scalars(q.order_by(Conciliacao.id.desc()).limit(limite))]


@router.post("", status_code=201)
async def enviar(ctx: Operador, conta_id: int = Form(...), arquivo: UploadFile = File(...)):
    """Sobe o extrato (OFX, CSV ou Excel) de uma conta. Linha que já veio em outro arquivo da conta não entra de novo."""
    conta = ctx.db.get(ContaBancaria, conta_id)
    if not conta or conta.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Conta bancária não encontrada.")
    nome = Path(arquivo.filename or "extrato").name
    conteudo = await arquivo.read()
    if len(conteudo) > TAMANHO_MAX:
        raise HTTPException(400, "Extrato maior que 15 MB.")
    try:
        conc, anterior = conciliacao.importar(ctx.db, conta=conta, usuario=ctx.usuario, nome=nome, conteudo=conteudo)
    except leitor.ExtratoInvalido as e:
        ctx.db.rollback()
        raise HTTPException(400, str(e)) from e
    except IntegrityError as e:  # o mesmo arquivo enviado duas vezes ao mesmo tempo
        ctx.db.rollback()
        raise HTTPException(409, "Este extrato acabou de ser enviado. Atualize a tela.") from e
    except Exception as e:  # noqa: BLE001 — arquivo que o leitor não entende
        ctx.db.rollback()
        raise HTTPException(400, "Não consegui ler o arquivo. Envie o extrato em OFX (recomendado), CSV ou Excel.") from e
    if conc is None:
        return {"id": anterior, "ja_importado": True, "novas": 0, "repetidas": 0,
                "mensagem": "Este extrato já tinha sido importado nesta conta: nenhuma linha nova."}
    r = _resumo(conc.linhas)
    ctx.auditar("financeiro.conciliacao.importar", "fin_conciliacao", conc.id,
                descricao=f"{nome} ({conta.nome}): {conc.qtd_linhas} linhas novas, {conc.qtd_repetidas} repetidas, "
                          f"{r.conciliadas} já conciliadas, {r.baixas} baixas sugeridas, {r.pagar_criar + r.receber_criar} sem correspondência")
    ctx.db.commit()
    return {"id": conc.id, "ja_importado": False, "novas": conc.qtd_linhas, "repetidas": conc.qtd_repetidas,
            "mensagem": f"{conc.qtd_linhas} linha(s) nova(s)" + (f"; {conc.qtd_repetidas} já tinham vindo em outro extrato." if conc.qtd_repetidas else ".")}


@router.get("/titulos", response_model=list[TituloOut])
def titulos(ctx: Ctx, tipo: Literal["conta_pagar", "fatura"], q: str | None = None, limite: int = Query(30, ge=1, le=100)):
    """Títulos em aberto para trocar a sugestão ou vincular um crédito a uma fatura."""
    termo = (q or "").strip()
    if tipo == "conta_pagar":
        f = [ContaPagar.tenant_id == ctx.tenant_id, ContaPagar.data_pagamento.is_(None)]
        if termo:
            f.append(or_(ContaPagar.descricao.ilike(f"%{termo}%"), ContaPagar.favorecido.ilike(f"%{termo}%"),
                         ContaPagar.documento.ilike(f"%{termo}%"),
                         ContaPagar.fornecedor_id.in_(select(Fornecedor.id).where(Fornecedor.nome.ilike(f"%{termo}%"))),
                         ContaPagar.funcionario_id.in_(select(Usuario.id).where(Usuario.nome.ilike(f"%{termo}%")))))
        return [_titulo_conta(ctx, c) for c in ctx.db.scalars(
            select(ContaPagar).where(*f).order_by(ContaPagar.data_vencimento, ContaPagar.id).limit(limite))]
    base = select(Fatura).outerjoin(Tomador, Fatura.tomador_id == Tomador.id).outerjoin(Nfse, Fatura.nfse_id == Nfse.id)
    f = [Fatura.tenant_id == ctx.tenant_id, Fatura.status == StatusFatura.aberta]
    if termo:
        conds = [Tomador.nome.ilike(f"%{termo}%")]
        if (dig := so_digitos(termo)):
            conds += [Tomador.cpf_cnpj.like(f"%{dig}%")]
            if len(dig) <= 9:
                conds += [Fatura.numero == int(dig), Nfse.numero == int(dig)]
        f.append(or_(*conds))
    return [_titulo_fatura(x) for x in ctx.db.scalars(base.where(*f).order_by(Fatura.data_vencimento, Fatura.id).limit(limite))]


@router.get("/regras", response_model=list[RegraOut])
def regras(ctx: Ctx):
    """O que o escritório já ensinou (descrição → categoria e favorecido)."""
    saida = []
    for r in ctx.db.scalars(select(ConciliacaoRegra).where(ConciliacaoRegra.tenant_id == ctx.tenant_id)
                            .order_by(ConciliacaoRegra.usos.desc(), ConciliacaoRegra.id.desc())):
        forn = ctx.db.get(Fornecedor, r.fornecedor_id) if r.fornecedor_id else None
        func_ = ctx.db.get(Usuario, r.funcionario_id) if r.funcionario_id else None
        saida.append(RegraOut(id=r.id, tipo=r.tipo, padrao=r.padrao, exemplo=r.exemplo, natureza=r.natureza,
                              categoria_nome=r.categoria.nome if r.categoria else None,
                              subcategoria_nome=r.subcategoria.nome if r.subcategoria else None,
                              favorecido_nome=forn.nome if forn else (func_.nome if func_ else r.favorecido), usos=r.usos))
    return saida


@router.delete("/regras/{rid}", response_model=Mensagem)
def esquecer_regra(rid: int, ctx: Operador):
    r = ctx.db.get(ConciliacaoRegra, rid)
    if not r or r.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Regra não encontrada.")
    ctx.auditar("financeiro.conciliacao.esquecer_regra", "fin_conciliacao_regra", r.id, descricao=r.exemplo or r.padrao)
    ctx.db.delete(r)
    ctx.db.commit()
    return Mensagem(mensagem="Regra esquecida: a próxima linha parecida volta a pedir a categoria.")


# ---------------------------------------------------------------- uma conciliação
@router.get("/{cid}", response_model=ConciliacaoDetalhe)
def ler(cid: int, ctx: Ctx):
    c = _conc(ctx, cid)
    _atualizar(ctx, c)
    return _detalhe(ctx, c)


@router.post("/{cid}/criar-pagar", response_model=ResultadoOut)
def criar_pagar(cid: int, dados: CriarPagarIn, ctx: Operador):
    return _gravar(ctx, _conc(ctx, cid), conciliacao.criar_pagar, [i.model_dump() for i in dados.itens],
                   auditoria="financeiro.conciliacao.criar_pagar", feito="conta(s) a pagar criada(s) e paga(s)")


@router.post("/{cid}/criar-receber", response_model=ResultadoOut)
def criar_receber(cid: int, dados: CriarReceberIn, ctx: Operador):
    return _gravar(ctx, _conc(ctx, cid), conciliacao.criar_receber, [i.model_dump() for i in dados.itens],
                   auditoria="financeiro.conciliacao.criar_receber", feito="recebimento(s) lançado(s)")


@router.post("/{cid}/aprovar-baixas", response_model=ResultadoOut)
def aprovar_baixas(cid: int, dados: AprovarBaixasIn, ctx: Operador):
    return _gravar(ctx, _conc(ctx, cid), conciliacao.aprovar_baixas, [i.model_dump() for i in dados.itens],
                   auditoria="financeiro.conciliacao.aprovar_baixas", feito="baixa(s) dada(s)")


@router.post("/{cid}/ignorar", response_model=ConciliacaoDetalhe)
def ignorar(cid: int, dados: LinhasIn, ctx: Operador, voltar: bool = False):
    """Linha que o escritório decidiu não lançar sai da contagem (e pode voltar)."""
    c = _conc(ctx, cid)
    de = (SituacaoLinha.ignorada,) if voltar else conciliacao.PENDENTES
    n = 0
    for ln in c.linhas:
        if ln.id in dados.linha_ids and ln.situacao in de:
            ln.situacao = SituacaoLinha.sem_correspondencia if voltar else SituacaoLinha.ignorada
            n += 1
    if n:
        ctx.auditar("financeiro.conciliacao.ignorar", "fin_conciliacao", c.id,
                    descricao=f"{n} linha(s) " + ("de volta à conciliação" if voltar else "ignorada(s)"))
    conciliacao.classificar(ctx.db, c)
    ctx.db.commit()
    return _detalhe(ctx, _conc(ctx, cid))


@router.post("/{cid}/desfazer", response_model=DesfeitoOut)
def desfazer(cid: int, dados: DesfazerIn, ctx: Operador):
    """Desfaz em bloco o que esta conciliação criou ou baixou, pelos mesmos caminhos das telas de origem."""
    c = _conc(ctx, cid)
    nome, conta = c.arquivo_nome, c.conta.nome
    r = conciliacao.desfazer(ctx.db, c, dados.linha_ids)
    c = _conc(ctx, cid)
    excluida = False
    if dados.excluir_importacao and not r["nao_desfeitas"] and not any(ln.situacao == SituacaoLinha.feita for ln in c.linhas):
        ctx.db.delete(c)
        excluida = True
    ctx.auditar("financeiro.conciliacao.desfazer", "fin_conciliacao", cid,
                descricao=f"{nome} ({conta}): {r['desfeitas']} linha(s) desfeita(s), {len(r['nao_desfeitas'])} não desfeita(s)"
                          + ("; extrato excluído" if excluida else ""))
    ctx.db.commit()
    if r["nao_desfeitas"]:
        mensagem = f"{r['desfeitas']} linha(s) desfeita(s); {len(r['nao_desfeitas'])} não puderam ser desfeitas."
    elif excluida:
        mensagem = "Tudo desfeito e o extrato foi excluído: suba o arquivo certo."
    else:
        mensagem = f"{r['desfeitas']} linha(s) desfeita(s): voltaram a ficar pendentes." if r["desfeitas"] else "Não havia nada para desfazer."
    return DesfeitoOut(desfeitas=r["desfeitas"], avisos=r["avisos"], nao_desfeitas=[{**x, "valor": str(x["valor"])} for x in r["nao_desfeitas"]],
                       excluida=excluida, mensagem=mensagem, conciliacao=None if excluida else _detalhe(ctx, _conc(ctx, cid)))


@router.post("/{cid}/sugerir-ia", response_model=ConciliacaoDetalhe)
def sugerir_ia(cid: int, ctx: Operador):
    """Opcional: a IA sugere a categoria das linhas que ficaram sem sugestão. Nada é gravado além da sugestão."""
    if not ctx.pode("ia.usar"):
        raise HTTPException(403, "Seu perfil de acesso não permite usar a Inteligência Artificial.")
    c = _conc(ctx, cid)
    try:
        conciliacao.sugerir_com_ia(ctx.db, c)
    except ia.IAIndisponivel as e:
        ctx.db.rollback()
        raise HTTPException(400, str(e)) from e
    ctx.db.commit()
    return _detalhe(ctx, _conc(ctx, cid))
