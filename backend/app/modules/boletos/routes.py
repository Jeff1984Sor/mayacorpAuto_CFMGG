"""API dos boletos: convênios, boletos (criar, editar, excluir, PDF), remessa e retorno."""

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select

from app.core.deps import Ctx, Operador
from app.core.documentos import so_digitos
from app.core.schemas import Mensagem, Pagina, Schema
from app.modules.boletos import envio, service
from app.modules.boletos.bancos.registry import BancoNaoSuportado, bancos_disponiveis, get_banco
from app.modules.boletos.cnab.exceptions import CnabError
from app.modules.boletos.impressao import imprimir
from app.modules.boletos.models import (
    ATIVOS,
    ArquivoRemessa,
    ArquivoRetorno,
    Boleto,
    Convenio,
    OcorrenciaBoleto,
    StatusBoleto,
)
from app.modules.boletos.service import ErroBoleto
from app.modules.rpa_nfse.models import Emissora, Fatura, StatusFatura, Tomador

router = APIRouter(prefix="/boletos", tags=["Boletos"])

ROTULO_STATUS = {
    "rascunho": "Aguardando remessa", "em_remessa": "Enviado ao banco", "registrado": "Registrado",
    "rejeitado": "Rejeitado pelo banco", "pago": "Pago", "baixado": "Baixado", "em_protesto": "Em protesto",
    "protestado": "Protestado", "cancelado": "Cancelado",
}


def _erro(e: Exception) -> HTTPException:
    return HTTPException(400, str(e))


# ================================================================ bancos
@router.get("/bancos")
def bancos(ctx: Ctx):
    return [{"codigo": b.codigo, "nome": b.nome_curto, "opcoes": b.opcoes()} for b in bancos_disponiveis()]


# ================================================================ convênios
class ConvenioIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    emissora_id: int
    conta_bancaria_id: int | None = None
    banco: str = Field(default="033", pattern=r"^\d{3}$")
    agencia: str = Field(pattern=r"^\d{1,4}$")
    agencia_dv: str = Field(default="0", pattern=r"^\d$")
    conta: str = Field(pattern=r"^\d{1,9}$")
    conta_dv: str = Field(pattern=r"^\d$")
    codigo_beneficiario: str = Field(pattern=r"^\d{1,7}$")
    codigo_transmissao: str = Field(pattern=r"^\d{1,15}$")
    carteira: str = Field(default="101", pattern=r"^\d{3}$")
    tipo_cobranca: str = Field(default="5", max_length=1)
    forma_cadastramento: str = Field(default="1", max_length=1)
    tipo_documento: str = Field(default="1", max_length=1)
    especie_titulo: str = Field(default="04", pattern=r"^\d{2}$")
    numeracao: str = Field(default="EMPRESA", pattern="^(EMPRESA|BANCO)$")
    proximo_nosso_numero: int = Field(default=1, ge=1, le=999_999_999_999)
    proximo_sequencial_arquivo: int = Field(default=1, ge=1, le=999_999)
    codigo_juros: str = Field(default="2", max_length=1)
    juros_mensal_pct: Decimal = Field(default=Decimal("1.00"), ge=0, le=99)
    multa_pct: Decimal = Field(default=Decimal("2.00"), ge=0, le=99)
    codigo_protesto: str = Field(default="0", max_length=1)
    dias_protesto: int = Field(default=0, ge=0, le=99)
    codigo_baixa: str = Field(default="1", max_length=1)
    dias_baixa: int = Field(default=60, ge=0, le=99)
    mensagem_1: str | None = Field(default=None, max_length=40)
    mensagem_2: str | None = Field(default=None, max_length=40)
    instrucoes: str | None = Field(default=None, max_length=600)
    pix_habilitado: bool = False
    pix_chave_tipo: str | None = Field(default=None, max_length=1)
    pix_chave: str | None = Field(default=None, max_length=77)
    ativo: bool = True
    homologado: bool = False


class ConvenioOut(ConvenioIn, Schema):
    id: int
    banco_nome: str
    emissora_nome: str
    qtd_boletos: int = 0
    pendencias: list[str] = []


def _convenio(ctx, cid: int) -> Convenio:
    c = ctx.db.get(Convenio, cid)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Convênio não encontrado.")
    return c


def _convenio_out(ctx, c: Convenio) -> ConvenioOut:
    campos = {k: getattr(c, k) for k in ConvenioIn.model_fields}
    try:
        nome_banco, pendencias = get_banco(c.banco).nome_curto, service.validar_convenio(c)
    except BancoNaoSuportado as e:
        nome_banco, pendencias = c.banco, [str(e)]
    qtd = ctx.db.scalar(select(func.count()).select_from(Boleto).where(Boleto.convenio_id == c.id)) or 0
    return ConvenioOut(id=c.id, banco_nome=nome_banco, emissora_nome=c.emissora.razao_social if c.emissora else "",
                       qtd_boletos=qtd, pendencias=pendencias, **campos)


def _conferir_convenio(ctx, dados: ConvenioIn) -> None:
    e = ctx.db.get(Emissora, dados.emissora_id)
    if not e or e.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Escolha a empresa emissora (beneficiário).")
    try:
        get_banco(dados.banco)
    except BancoNaoSuportado as ex:
        raise _erro(ex) from ex
    if dados.conta_bancaria_id:
        from app.modules.financas.models import ContaBancaria

        conta = ctx.db.get(ContaBancaria, dados.conta_bancaria_id)
        if not conta or conta.tenant_id != ctx.tenant_id:
            raise HTTPException(400, "Conta bancária não encontrada.")


@router.get("/convenios", response_model=list[ConvenioOut])
def listar_convenios(ctx: Ctx):
    cs = ctx.db.scalars(select(Convenio).where(Convenio.tenant_id == ctx.tenant_id).order_by(Convenio.ativo.desc(), Convenio.nome))
    return [_convenio_out(ctx, c) for c in cs]


@router.post("/convenios", response_model=ConvenioOut, status_code=201)
def criar_convenio(dados: ConvenioIn, ctx: Operador):
    _conferir_convenio(ctx, dados)
    c = Convenio(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("boletos.convenio.criar", "bol_convenio", c.id, descricao=f"{c.nome} (banco {c.banco})")
    ctx.db.commit()
    return _convenio_out(ctx, c)


@router.put("/convenios/{cid}", response_model=ConvenioOut)
def alterar_convenio(cid: int, dados: ConvenioIn, ctx: Operador):
    c = _convenio(ctx, cid)
    _conferir_convenio(ctx, dados)
    if dados.proximo_nosso_numero < c.proximo_nosso_numero:
        raise HTTPException(400, f"O próximo nosso número não pode voltar (o atual é {c.proximo_nosso_numero}): "
                                 "número de boleto nunca é reaproveitado.")
    if dados.proximo_sequencial_arquivo < c.proximo_sequencial_arquivo:
        raise HTTPException(400, f"O sequencial da remessa não pode voltar (o atual é {c.proximo_sequencial_arquivo}).")
    antes = {"homologado": c.homologado, "ativo": c.ativo, "carteira": c.carteira}
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("boletos.convenio.alterar", "bol_convenio", c.id, descricao=c.nome, antes=antes,
                depois={"homologado": c.homologado, "ativo": c.ativo, "carteira": c.carteira})
    ctx.db.commit()
    return _convenio_out(ctx, c)


@router.delete("/convenios/{cid}", response_model=Mensagem)
def excluir_convenio(cid: int, ctx: Operador):
    c = _convenio(ctx, cid)
    if ctx.db.scalar(select(func.count()).select_from(Boleto).where(Boleto.convenio_id == c.id)):
        raise HTTPException(400, "Este convênio já tem boletos: desative-o em vez de excluir.")
    ctx.auditar("boletos.convenio.excluir", "bol_convenio", c.id, descricao=c.nome)
    ctx.db.delete(c)
    ctx.db.commit()
    return Mensagem(mensagem="Convênio excluído.")


# ================================================================ boletos
class OcorrenciaOut(Schema):
    id: int
    origem: str
    codigo_movimento: str
    descricao: str
    motivos: list[dict] = []
    data_ocorrencia: date | None
    valor_pago: Decimal | None
    alerta: str | None
    criado_em: datetime


class BoletoOut(Schema):
    id: int
    convenio_id: int
    convenio_nome: str
    banco: str
    fatura_id: int | None
    fatura_codigo: str | None
    tomador_id: int | None
    pagador_nome: str
    pagador_documento: str
    pagador_endereco: str
    pagador_bairro: str
    pagador_cep: str
    pagador_cidade: str
    pagador_uf: str
    descricao: str
    seu_numero: str
    nosso_numero: str | None
    nosso_numero_fmt: str | None
    valor: Decimal
    data_emissao: date
    data_vencimento: date
    codigo_barras: str
    linha_digitavel: str
    linha_digitavel_fmt: str
    status: str
    status_rotulo: str
    instrucao_pendente: str | None
    novo_vencimento: date | None
    valor_pago: Decimal | None
    valor_liquido: Decimal | None
    data_pagamento: date | None
    data_credito: date | None
    tarifa: Decimal | None
    motivos: list[dict] = []
    remessa_id: int | None
    remessa_sequencial: int | None
    editavel: bool
    pode_enviar_ao_cliente: bool
    ocorrencias: list[OcorrenciaOut] = []


class BoletoIn(BaseModel):
    convenio_id: int
    fatura_id: int | None = None
    tomador_id: int | None = None
    valor: Decimal = Field(gt=0, le=Decimal("99999999.99"))
    data_vencimento: date
    descricao: str = Field(default="", max_length=200)
    pagador_nome: str = Field(min_length=2, max_length=200)
    pagador_documento: str = Field(min_length=11, max_length=18)
    pagador_endereco: str = Field(default="", max_length=200)
    pagador_bairro: str = Field(default="", max_length=80)
    pagador_cep: str = Field(default="", max_length=9)
    pagador_cidade: str = Field(default="", max_length=80)
    pagador_uf: str = Field(default="", max_length=2)


class BoletoPatch(BaseModel):
    valor: Decimal | None = Field(default=None, gt=0, le=Decimal("99999999.99"))
    data_vencimento: date | None = None
    descricao: str | None = Field(default=None, max_length=200)
    pagador_nome: str | None = Field(default=None, min_length=2, max_length=200)
    pagador_documento: str | None = Field(default=None, max_length=18)
    pagador_endereco: str | None = Field(default=None, max_length=200)
    pagador_bairro: str | None = Field(default=None, max_length=80)
    pagador_cep: str | None = Field(default=None, max_length=9)
    pagador_cidade: str | None = Field(default=None, max_length=80)
    pagador_uf: str | None = Field(default=None, max_length=2)


def _boleto(ctx, bid: int) -> Boleto:
    b = ctx.db.get(Boleto, bid)
    if not b or b.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Boleto não encontrado.")
    return b


def boleto_out(b: Boleto, detalhe: bool = False) -> BoletoOut:
    try:
        banco = get_banco(b.convenio.banco)
        nn_fmt = banco.formatar_nosso_numero(b.nosso_numero) if b.nosso_numero else None
        linha_fmt = banco.formatar_linha_digitavel(b.linha_digitavel) if b.linha_digitavel else ""
    except BancoNaoSuportado:
        nn_fmt, linha_fmt = b.nosso_numero, b.linha_digitavel
    return BoletoOut(
        id=b.id, convenio_id=b.convenio_id, convenio_nome=b.convenio.nome, banco=b.convenio.banco,
        fatura_id=b.fatura_id, fatura_codigo=b.fatura.codigo if b.fatura else None, tomador_id=b.tomador_id,
        pagador_nome=b.pagador_nome, pagador_documento=b.pagador_documento, pagador_endereco=b.pagador_endereco,
        pagador_bairro=b.pagador_bairro, pagador_cep=b.pagador_cep, pagador_cidade=b.pagador_cidade,
        pagador_uf=b.pagador_uf, descricao=b.descricao, seu_numero=b.seu_numero, nosso_numero=b.nosso_numero,
        nosso_numero_fmt=nn_fmt, valor=b.valor, data_emissao=b.data_emissao, data_vencimento=b.data_vencimento,
        codigo_barras=b.codigo_barras or "", linha_digitavel=b.linha_digitavel or "", linha_digitavel_fmt=linha_fmt,
        status=b.status.value, status_rotulo=ROTULO_STATUS[b.status.value], instrucao_pendente=b.instrucao_pendente,
        novo_vencimento=b.novo_vencimento, valor_pago=b.valor_pago, valor_liquido=b.valor_liquido,
        data_pagamento=b.data_pagamento, data_credito=b.data_credito, tarifa=b.tarifa, motivos=b.motivos or [],
        remessa_id=b.remessa_id, remessa_sequencial=b.remessa.sequencial if b.remessa else None,
        editavel=b.status == StatusBoleto.rascunho,
        pode_enviar_ao_cliente=b.status in (StatusBoleto.registrado, StatusBoleto.em_protesto),
        ocorrencias=[OcorrenciaOut.model_validate(o) for o in reversed(b.ocorrencias)] if detalhe else [],
    )


def _filtros(ctx, q, status, convenio_id, de, ate):
    f = [Boleto.tenant_id == ctx.tenant_id]
    if q:
        dig = so_digitos(q)
        conds = [Boleto.pagador_nome.ilike(f"%{q.strip()}%"), Boleto.seu_numero.ilike(f"%{q.strip()}%"),
                 Boleto.descricao.ilike(f"%{q.strip()}%")]
        if dig:
            conds += [Boleto.nosso_numero.like(f"%{dig}%"), Boleto.pagador_documento.like(f"%{dig}%"),
                      Boleto.linha_digitavel == dig]
        f.append(or_(*conds))
    if status == "vencido":
        f += [Boleto.status.in_((StatusBoleto.registrado, StatusBoleto.em_remessa)), Boleto.data_vencimento < date.today()]
    elif status:
        f.append(Boleto.status == StatusBoleto(status))
    if convenio_id:
        f.append(Boleto.convenio_id == convenio_id)
    if de:
        f.append(Boleto.data_vencimento >= de)
    if ate:
        f.append(Boleto.data_vencimento <= ate)
    return f


_STATUS = "^(rascunho|em_remessa|registrado|rejeitado|pago|baixado|em_protesto|protestado|cancelado|vencido)$"


@router.get("", response_model=Pagina[BoletoOut])
def listar(ctx: Ctx, q: str | None = None, status: str | None = Query(None, pattern=_STATUS),
           convenio_id: int | None = None, de: date | None = None, ate: date | None = None,
           pagina: int = Query(1, ge=1), por_pagina: int = Query(25, ge=1, le=200)):
    f = _filtros(ctx, q, status, convenio_id, de, ate)
    total = ctx.db.scalar(select(func.count()).select_from(Boleto).where(*f)) or 0
    itens = ctx.db.scalars(select(Boleto).where(*f).order_by(Boleto.id.desc())
                           .offset((pagina - 1) * por_pagina).limit(por_pagina))
    return Pagina[BoletoOut](itens=[boleto_out(b) for b in itens], total=total, pagina=pagina, por_pagina=por_pagina)


@router.get("/resumo")
def resumo(ctx: Ctx, convenio_id: int | None = None):
    f = [Boleto.tenant_id == ctx.tenant_id]
    if convenio_id:
        f.append(Boleto.convenio_id == convenio_id)
    linhas = ctx.db.execute(select(Boleto.status, func.count(), func.coalesce(func.sum(Boleto.valor), 0))
                            .where(*f).group_by(Boleto.status)).all()
    por_status = {s.value: {"qtd": 0, "total": Decimal(0)} for s in StatusBoleto}
    for st, qtd, total in linhas:
        por_status[st.value if hasattr(st, "value") else st] = {"qtd": qtd, "total": Decimal(total)}
    instrucoes = ctx.db.scalar(select(func.count()).select_from(Boleto).where(
        *f, Boleto.instrucao_pendente.is_not(None), Boleto.status != StatusBoleto.rascunho)) or 0
    return {"por_status": por_status, "aguardando_remessa": por_status["rascunho"]["qtd"] + instrucoes,
            "instrucoes_pendentes": instrucoes}


@router.get("/faturas-disponiveis")
def faturas_disponiveis(ctx: Ctx, q: str | None = None, limite: int = Query(50, ge=1, le=200)):
    """Faturas em aberto (NH e ND) que ainda não têm boleto, com o que vem preenchido no boleto."""
    com_boleto = select(Boleto.fatura_id).where(Boleto.fatura_id.is_not(None), Boleto.status.in_(ATIVOS))
    base = (select(Fatura).outerjoin(Tomador, Fatura.tomador_id == Tomador.id)
            .where(Fatura.tenant_id == ctx.tenant_id, Fatura.status == StatusFatura.aberta, Fatura.id.not_in(com_boleto)))
    if q:
        dig = so_digitos(q)
        conds = [Tomador.nome.ilike(f"%{q.strip()}%")]
        if dig:
            conds.append(Fatura.numero == int(dig))
        base = base.where(or_(*conds))
    saida = []
    for f in ctx.db.scalars(base.order_by(Fatura.data_vencimento, Fatura.id).limit(limite)):
        s = service.sugestao_da_fatura(ctx.db, f)
        saida.append({"id": f.id, "codigo": f.codigo, "cliente": f.tomador.nome if f.tomador else "",
                      "total": f.total, "sugestao": {**s, "valor": str(s["valor"]),
                                                     "data_vencimento": s["data_vencimento"].isoformat()}})
    return saida


@router.get("/clientes/{tid}/pagador")
def pagador_do_cliente(tid: int, ctx: Ctx):
    t = ctx.db.get(Tomador, tid)
    if not t or t.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Cliente não encontrado.")
    return service.pagador_do_cliente(t)


def _criar(ctx, dados: BoletoIn) -> Boleto:
    conv = _convenio(ctx, dados.convenio_id)
    fatura = None
    if dados.fatura_id:
        fatura = ctx.db.get(Fatura, dados.fatura_id)
        if not fatura or fatura.tenant_id != ctx.tenant_id:
            raise HTTPException(404, "Fatura não encontrada.")
    pagador = {k: getattr(dados, k) for k in BoletoIn.model_fields if k.startswith("pagador_")}
    b = service.criar_boleto(ctx.db, ctx.tenant_id, conv, valor=dados.valor, data_vencimento=dados.data_vencimento,
                             pagador=pagador, descricao=dados.descricao, fatura=fatura, tomador_id=dados.tomador_id)
    ctx.auditar("boletos.criar", "bol_boleto", b.id,
                descricao=f"{b.seu_numero} · {b.pagador_nome} · R$ {b.valor:.2f} · vence {b.data_vencimento:%d/%m/%Y}")
    return b


@router.post("", response_model=BoletoOut, status_code=201)
def criar(dados: BoletoIn, ctx: Operador):
    try:
        b = _criar(ctx, dados)
    except (ErroBoleto, CnabError, ValueError) as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.db.commit()
    return boleto_out(b, detalhe=True)


class LoteIn(BaseModel):
    convenio_id: int
    fatura_ids: list[int] = Field(min_length=1, max_length=500)


@router.post("/lote")
def criar_em_lote(dados: LoteIn, ctx: Operador):
    """Um boleto por fatura, com os dados do cadastro do cliente. O que não der fica na lista com o motivo."""
    conv = _convenio(ctx, dados.convenio_id)
    criados, falhas = [], []
    for fid in dict.fromkeys(dados.fatura_ids):
        f = ctx.db.get(Fatura, fid)
        if not f or f.tenant_id != ctx.tenant_id:
            falhas.append({"fatura_id": fid, "codigo": None, "cliente": "", "erros": ["Fatura não encontrada."]})
            continue
        s = service.sugestao_da_fatura(ctx.db, f)
        try:
            with ctx.db.begin_nested():
                b = service.criar_boleto(ctx.db, ctx.tenant_id, conv, valor=s["valor"], data_vencimento=s["data_vencimento"],
                                         pagador=s, descricao=s["descricao"], fatura=f)
                ctx.auditar("boletos.criar", "bol_boleto", b.id,
                            descricao=f"{b.seu_numero} · {b.pagador_nome} · R$ {b.valor:.2f} (em lote)")
            criados.append(b.id)
        except (ErroBoleto, CnabError, ValueError) as e:
            falhas.append({"fatura_id": fid, "codigo": f.codigo, "cliente": f.tomador.nome if f.tomador else "",
                           "erros": getattr(e, "erros", None) or [str(e)]})
    ctx.db.commit()
    return {"criados": len(criados), "ids": criados, "falhas": falhas}


# ---------------------------------------------------------------- remessa (antes das rotas com /{bid})
class RemessaOut(Schema):
    id: int
    convenio_id: int
    convenio_nome: str
    sequencial: int
    gerado_em: datetime
    nome_arquivo: str
    qtd_boletos: int
    valor_total: Decimal
    ambiente: str


def _remessa_out(r: ArquivoRemessa) -> RemessaOut:
    return RemessaOut(id=r.id, convenio_id=r.convenio_id, convenio_nome=r.convenio.nome, sequencial=r.sequencial,
                      gerado_em=r.gerado_em, nome_arquivo=r.nome_arquivo, qtd_boletos=r.qtd_boletos,
                      valor_total=r.valor_total, ambiente=r.ambiente)


@router.get("/remessas", response_model=list[RemessaOut])
def listar_remessas(ctx: Ctx, convenio_id: int | None = None, limite: int = Query(100, ge=1, le=500)):
    q = select(ArquivoRemessa).where(ArquivoRemessa.tenant_id == ctx.tenant_id)
    if convenio_id:
        q = q.where(ArquivoRemessa.convenio_id == convenio_id)
    return [_remessa_out(r) for r in ctx.db.scalars(q.order_by(ArquivoRemessa.id.desc()).limit(limite))]


@router.get("/remessas/pendentes")
def remessa_pendentes(convenio_id: int, ctx: Ctx):
    conv = _convenio(ctx, convenio_id)
    pend = service.pendentes_de_remessa(ctx.db, conv)
    return {"entradas": sum(1 for _, m in pend if m == "01"), "instrucoes": sum(1 for _, m in pend if m != "01"),
            "valor": sum((b.valor for b, m in pend if m == "01"), Decimal(0)),
            "teste": not conv.homologado, "pendencias": service.validar_convenio(conv)}


class RemessaIn(BaseModel):
    convenio_id: int


@router.post("/remessas", status_code=201)
def gerar_remessa(dados: RemessaIn, ctx: Operador):
    conv = _convenio(ctx, dados.convenio_id)
    try:
        rem, fora = service.gerar_remessa(ctx.db, conv, ctx.usuario.id)
    except (ErroBoleto, CnabError, ValueError) as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.auditar("boletos.remessa.gerar", "bol_remessa", rem.id,
                descricao=f"Remessa {rem.sequencial} ({rem.ambiente}): {rem.qtd_boletos} registro(s), R$ {rem.valor_total:.2f}")
    ctx.db.commit()
    return {"remessa": _remessa_out(rem), "fora": fora}


@router.get("/remessas/{rid}/arquivo")
def baixar_remessa(rid: int, ctx: Ctx):
    r = ctx.db.get(ArquivoRemessa, rid)
    if not r or r.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Remessa não encontrada.")
    if not Path(r.arquivo_path).exists():
        raise HTTPException(404, "O arquivo desta remessa não está mais no servidor.")
    return FileResponse(r.arquivo_path, media_type="application/octet-stream", filename=r.nome_arquivo)


# ---------------------------------------------------------------- retorno
class RetornoOut(Schema):
    id: int
    convenio_id: int
    convenio_nome: str
    importado_em: datetime
    nome_arquivo: str
    qtd_ocorrencias: int
    qtd_orfas: int
    resumo: dict


def _retorno_out(r: ArquivoRetorno, completo: bool = True) -> RetornoOut:
    resumo = r.resumo or {}
    if not completo:
        resumo = {k: v for k, v in resumo.items() if k != "linhas"}
    return RetornoOut(id=r.id, convenio_id=r.convenio_id, convenio_nome=r.convenio.nome, importado_em=r.importado_em,
                      nome_arquivo=r.nome_arquivo, qtd_ocorrencias=r.qtd_ocorrencias, qtd_orfas=r.qtd_orfas, resumo=resumo)


@router.get("/retornos", response_model=list[RetornoOut])
def listar_retornos(ctx: Ctx, limite: int = Query(100, ge=1, le=500)):
    q = select(ArquivoRetorno).where(ArquivoRetorno.tenant_id == ctx.tenant_id).order_by(ArquivoRetorno.id.desc()).limit(limite)
    return [_retorno_out(r, completo=False) for r in ctx.db.scalars(q)]


@router.get("/retornos/{rid}", response_model=RetornoOut)
def ver_retorno(rid: int, ctx: Ctx):
    r = ctx.db.get(ArquivoRetorno, rid)
    if not r or r.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Retorno não encontrado.")
    return _retorno_out(r)


@router.post("/retornos", response_model=RetornoOut, status_code=201)
async def importar_retorno(ctx: Operador, arquivo: UploadFile = File(...), convenio_id: int | None = Form(None)):
    conteudo = await arquivo.read()
    if len(conteudo) > 20 * 1024 * 1024:
        raise HTTPException(400, "Arquivo grande demais para um retorno de cobrança.")
    try:
        ret = service.processar_retorno(ctx.db, ctx.tenant_id, conteudo, arquivo.filename or "retorno.ret",
                                        convenio_id=convenio_id, usuario_id=ctx.usuario.id)
    except (ErroBoleto, CnabError, BancoNaoSuportado, ValueError) as e:
        ctx.db.rollback()
        raise _erro(e) from e
    c = ret.resumo["contagem"]
    ctx.auditar("boletos.retorno.importar", "bol_retorno", ret.id,
                descricao=(f"{ret.nome_arquivo}: {c['registrados']} registrado(s), {c['rejeitados']} rejeitado(s), "
                           f"{c['pagos']} pago(s), {c['baixados']} baixado(s), {c['orfas']} sem boleto"))
    ctx.db.commit()
    return _retorno_out(ret)


@router.get("/ocorrencias-orfas", response_model=list[OcorrenciaOut])
def ocorrencias_orfas(ctx: Ctx):
    q = (select(OcorrenciaBoleto).where(OcorrenciaBoleto.tenant_id == ctx.tenant_id, OcorrenciaBoleto.boleto_id.is_(None),
                                        OcorrenciaBoleto.origem == "retorno").order_by(OcorrenciaBoleto.id.desc()).limit(200))
    return [OcorrenciaOut.model_validate(o) for o in ctx.db.scalars(q)]


# ---------------------------------------------------------------- e-mail (boleto + fatura + NFS-e)
class EmailIn(BaseModel):
    destinatarios: list[EmailStr] | None = None
    cc: list[EmailStr] | None = None
    assunto: str | None = Field(default=None, max_length=300)
    corpo: str | None = Field(default=None, max_length=10000)
    anexos: list[str] | None = None  # boleto | fatura | nfse (vazio = todos os que existirem)


class EmailLoteIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=300)


def _enviar_email(ctx, b: Boleto, dados: EmailIn | None = None) -> dict:
    d = dados or EmailIn()
    if d.anexos is not None and not set(d.anexos) <= {"boleto", "fatura", "nfse"}:
        raise ErroBoleto("Anexo desconhecido.")
    r = envio.enviar(ctx.db, b, destinatarios=[str(e) for e in d.destinatarios] if d.destinatarios else None,
                     cc=[str(e) for e in d.cc] if d.cc else None, assunto=d.assunto, corpo=d.corpo, tipos=d.anexos)
    ctx.auditar("boletos.enviar_email", "bol_boleto", b.id,
                descricao=f"{b.seu_numero} → {', '.join(r['destinatarios'])} ({', '.join(r['anexos'])})")
    return r


@router.post("/enviar-emails")
def enviar_emails(dados: EmailLoteIn, ctx: Operador):
    """Envia vários de uma vez, cada um para o e-mail do cadastro do cliente. O que não for fica na lista com o motivo."""
    enviados, falhas = [], []
    for bid in dict.fromkeys(dados.ids):
        b = ctx.db.get(Boleto, bid)
        if not b or b.tenant_id != ctx.tenant_id:
            falhas.append({"boleto_id": bid, "seu_numero": None, "pagador": "", "erro": "Boleto não encontrado."})
            continue
        try:
            _enviar_email(ctx, b)
            enviados.append(bid)
        except ErroBoleto as e:
            falhas.append({"boleto_id": bid, "seu_numero": b.seu_numero, "pagador": b.pagador_nome, "erro": str(e)})
        ctx.db.commit()
    return {"enviados": len(enviados), "ids": enviados, "falhas": falhas}


# ---------------------------------------------------------------- um boleto
@router.get("/{bid}", response_model=BoletoOut)
def ver(bid: int, ctx: Ctx):
    return boleto_out(_boleto(ctx, bid), detalhe=True)


@router.put("/{bid}", response_model=BoletoOut)
def alterar(bid: int, dados: BoletoPatch, ctx: Operador):
    b = _boleto(ctx, bid)
    antes = {"valor": str(b.valor), "vencimento": str(b.data_vencimento), "pagador": b.pagador_nome}
    try:
        service.atualizar_boleto(ctx.db, b, dados.model_dump(exclude_unset=True))
    except (ErroBoleto, CnabError, ValueError) as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.auditar("boletos.alterar", "bol_boleto", b.id, descricao=b.seu_numero, antes=antes,
                depois={"valor": str(b.valor), "vencimento": str(b.data_vencimento), "pagador": b.pagador_nome})
    ctx.db.commit()
    return boleto_out(b, detalhe=True)


@router.delete("/{bid}", response_model=Mensagem)
def excluir(bid: int, ctx: Operador):
    b = _boleto(ctx, bid)
    descricao = f"{b.seu_numero} · {b.pagador_nome} · R$ {b.valor:.2f} (nosso número {b.nosso_numero or '—'})"
    try:
        service.excluir_boleto(ctx.db, b)
    except ErroBoleto as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.auditar("boletos.excluir", "bol_boleto", bid, descricao=descricao)
    ctx.db.commit()
    return Mensagem(mensagem="Boleto excluído.")


@router.post("/{bid}/baixa", response_model=BoletoOut)
def pedir_baixa(bid: int, ctx: Operador):
    b = _boleto(ctx, bid)
    try:
        service.pedir_baixa(ctx.db, b)
    except ErroBoleto as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.auditar("boletos.pedir_baixa", "bol_boleto", b.id, descricao=b.seu_numero)
    ctx.db.commit()
    return boleto_out(b, detalhe=True)


class VencimentoIn(BaseModel):
    data: date


@router.post("/{bid}/vencimento", response_model=BoletoOut)
def alterar_vencimento(bid: int, dados: VencimentoIn, ctx: Operador):
    b = _boleto(ctx, bid)
    antes = str(b.data_vencimento)
    try:
        service.alterar_vencimento(ctx.db, b, dados.data)
    except (ErroBoleto, CnabError, ValueError) as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.auditar("boletos.alterar_vencimento", "bol_boleto", b.id, descricao=b.seu_numero,
                antes={"vencimento": antes}, depois={"vencimento": str(dados.data)})
    ctx.db.commit()
    return boleto_out(b, detalhe=True)


@router.delete("/{bid}/instrucao", response_model=BoletoOut)
def desistir_da_instrucao(bid: int, ctx: Operador):
    b = _boleto(ctx, bid)
    try:
        service.desistir_da_instrucao(ctx.db, b)
    except ErroBoleto as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.db.commit()
    return boleto_out(b, detalhe=True)


@router.get("/{bid}/email")
def previa_do_email(bid: int, ctx: Ctx):
    """O que vai no e-mail (destinatários, assunto, texto e anexos), para conferir antes de enviar."""
    return envio.montar(ctx.db, _boleto(ctx, bid))


@router.post("/{bid}/enviar-email", response_model=Mensagem)
def enviar_email(bid: int, dados: EmailIn, ctx: Operador):
    b = _boleto(ctx, bid)
    try:
        r = _enviar_email(ctx, b, dados)
    except ErroBoleto as e:
        ctx.db.rollback()
        raise _erro(e) from e
    ctx.db.commit()
    return Mensagem(mensagem=f"E-mail enviado para {', '.join(r['destinatarios'])}.")


@router.get("/{bid}/pdf")
def pdf(bid: int, ctx: Ctx):
    b = _boleto(ctx, bid)
    if not b.codigo_barras:
        raise HTTPException(400, "Este boleto ainda não tem nosso número (a numeração é do banco): "
                                 "o PDF fica disponível depois de importar o retorno com o registro.")
    nome = f"Boleto - {b.seu_numero} - {b.pagador_nome[:60]}.pdf".replace("/", "-")
    return Response(imprimir(b), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(nome)}"})
