"""Recebimentos: extrato bancário → baixa das notas. E as configurações de automação do RPA 01."""

from datetime import date
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select

from app.core.config import settings
from app.core.deps import Admin, Ctx, Operador
from app.core.schemas import Mensagem, Pagina
from app.modules.rpa_nfse import conciliacao, fatura, service
from app.modules.rpa_nfse import extrato as leitor
from app.modules.rpa_nfse.models import Extrato, LancamentoExtrato, Nfse, StatusLancamento, StatusNfse, TipoFatura
from app.modules.rpa_nfse.schemas import (
    BaixaManualIn,
    ConfigAutomacoesIn,
    ConfigAutomacoesOut,
    ConfirmarLancamentoIn,
    ExtratoDetalhe,
    ExtratoOut,
    LancamentoOut,
    NotaResumo,
)

router = APIRouter(prefix="/nfse", tags=["Recebimentos"])
config_router = APIRouter(prefix="/config", tags=["configurações"])


# ======================================================================== configurações das automações
def _proxima(db, cfg, tipo: TipoFatura) -> int:
    return max(fatura.ultimo_numero(db, tipo, tenant_id=cfg.tenant_id) + 1, fatura.numero_definido(cfg, tipo))


def _cfg_out(db, cfg) -> ConfigAutomacoesOut:
    campos = {k: getattr(cfg, k) for k in ConfigAutomacoesOut.model_fields if not k.startswith("fatura_proxima")}
    return ConfigAutomacoesOut(**campos, fatura_proxima_nh=_proxima(db, cfg, TipoFatura.honorarios),
                               fatura_proxima_nd=_proxima(db, cfg, TipoFatura.despesas))


@config_router.get("/automacoes", response_model=ConfigAutomacoesOut)
def ler_automacoes(ctx: Ctx):
    return _cfg_out(ctx.db, service.config_nfse(ctx.db, ctx.tenant_id))


@config_router.put("/automacoes", response_model=ConfigAutomacoesOut)
def salvar_automacoes(dados: ConfigAutomacoesIn, ctx: Admin):
    cfg = service.config_nfse(ctx.db, ctx.tenant_id)
    if dados.relatorio_emissao_ativo and not dados.relatorio_destinatarios:
        raise HTTPException(400, "Informe ao menos um e-mail para receber o relatório de emissão.")
    for tipo, campo, sigla in ((TipoFatura.honorarios, "fatura_proxima_nh", "NH"), (TipoFatura.despesas, "fatura_proxima_nd", "ND")):
        pedido = getattr(dados, campo)
        ultimo = fatura.ultimo_numero(ctx.db, tipo, tenant_id=ctx.tenant_id)
        if pedido is not None and pedido <= ultimo:
            raise HTTPException(400, f"A {sigla} {ultimo:05d} já existe: a próxima {sigla} precisa ser {ultimo + 1} ou maior.")
    antes = {k: getattr(cfg, k) for k in ConfigAutomacoesIn.model_fields}
    for k, v in dados.model_dump().items():
        setattr(cfg, k, [str(e).lower() for e in v] if k == "relatorio_destinatarios" else v)
    depois = {k: getattr(cfg, k) for k in ConfigAutomacoesIn.model_fields}
    ctx.auditar("automacoes.alterar", "config_nfse", ctx.tenant_id,
                antes={k: v for k, v in antes.items() if depois[k] != v},
                depois={k: v for k, v in depois.items() if antes[k] != v})
    ctx.db.commit()
    return _cfg_out(ctx.db, cfg)


# ======================================================================== extratos
def _resumo_nota(n: Nfse) -> NotaResumo:
    tom = (n.rps.dados_json or {}).get("tomador", {})
    return NotaResumo(id=n.id, numero=n.numero, tomador_nome=tom.get("nome") or "", valor=n.valor,
                      data_emissao=n.data_emissao, pago_em=n.pago_em, lote_numero=n.rps.lote.numero)


def _lanc_out(ctx, lc: LancamentoExtrato) -> LancamentoOut:
    notas = list(ctx.db.scalars(select(Nfse).where(Nfse.id.in_(lc.nfse_ids or [])))) if lc.nfse_ids else []
    return LancamentoOut(id=lc.id, data=lc.data, valor=lc.valor, descricao=lc.descricao, documento=lc.documento,
                         status=lc.status, confianca=lc.confianca, motivo=lc.motivo,
                         notas=[_resumo_nota(n) for n in notas])


def _extrato(ctx, eid: int) -> Extrato:
    e = ctx.db.get(Extrato, eid)
    if not e or e.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Extrato não encontrado.")
    return e


def _detalhe(ctx, e: Extrato) -> ExtratoDetalhe:
    return ExtratoDetalhe(**ExtratoOut.model_validate(e).model_dump(),
                          lancamentos=[_lanc_out(ctx, lc) for lc in e.lancamentos])


@router.post("/extratos", response_model=ExtratoDetalhe)
async def enviar_extrato(ctx: Operador, arquivo: UploadFile = File(...)):
    nome = Path(arquivo.filename or "extrato").name
    conteudo = await arquivo.read()
    if len(conteudo) > 15 * 1024 * 1024:
        raise HTTPException(400, "Extrato maior que 15 MB.")
    try:
        lido = leitor.ler(nome, conteudo)
    except leitor.ExtratoInvalido as e:
        raise HTTPException(400, str(e)) from e
    destino = Path(settings.storage_dir) / "extratos" / f"tenant_{ctx.tenant_id}"
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / f"{date.today():%Y%m%d}_{nome}"
    caminho.write_bytes(conteudo)
    cfg = service.config_nfse(ctx.db, ctx.tenant_id)
    ext = conciliacao.processar(ctx.db, tenant_id=ctx.tenant_id, usuario_id=ctx.usuario.id, nome=nome,
                                caminho=str(caminho), lido=lido, baixa_automatica=cfg.baixa_automatica,
                                confianca_minima=cfg.confianca_minima)
    ctx.auditar("extrato.conciliar", "extrato", ext.id,
                descricao=f"{nome}: {ext.qtd_creditos} créditos, {ext.qtd_conciliados} conciliados "
                          f"({ext.notas_baixadas} notas baixadas), {ext.qtd_sugeridos} sugestões")
    ctx.db.commit()
    if ext.qtd_conciliados or ext.qtd_sugeridos:
        from app.comunicador.service import robo_postar
        from app.modules.rpa_nfse.pdf import brl

        texto = f"💰 Extrato {nome} conciliado: {ext.notas_baixadas} nota(s) baixada(s), {brl(ext.valor_conciliado)} recebidos."
        if ext.qtd_sugeridos:
            texto += f" {ext.qtd_sugeridos} crédito(s) aguardam confirmação."
        robo_postar(ctx.db, ctx.tenant_id, texto, link=f"/nfse/recebimentos/{ext.id}")
        ctx.db.commit()
    if cfg.relatorio_baixas_ativo and cfg.relatorio_destinatarios and ext.qtd_conciliados:
        service.enviar_relatorio_baixas(ctx.db, ext, cfg)
    return _detalhe(ctx, ext)


@router.get("/extratos", response_model=Pagina[ExtratoOut])
def listar_extratos(ctx: Ctx, pagina: int = Query(1, ge=1), por_pagina: int = Query(25, ge=1, le=100)):
    f = [Extrato.tenant_id == ctx.tenant_id]
    total = ctx.db.scalar(select(func.count()).select_from(Extrato).where(*f)) or 0
    itens = ctx.db.scalars(select(Extrato).where(*f).order_by(Extrato.id.desc()).offset((pagina - 1) * por_pagina).limit(por_pagina))
    return Pagina[ExtratoOut](itens=[ExtratoOut.model_validate(e) for e in itens], total=total, pagina=pagina,
                              por_pagina=por_pagina)


@router.get("/extratos/{eid}", response_model=ExtratoDetalhe)
def ler_extrato(eid: int, ctx: Ctx):
    return _detalhe(ctx, _extrato(ctx, eid))


def _lancamento(ctx, eid: int, lid: int) -> tuple[Extrato, LancamentoExtrato]:
    e = _extrato(ctx, eid)
    lc = ctx.db.get(LancamentoExtrato, lid)
    if not lc or lc.extrato_id != e.id:
        raise HTTPException(404, "Lançamento não encontrado.")
    return e, lc


@router.post("/extratos/{eid}/lancamentos/{lid}/confirmar", response_model=LancamentoOut)
def confirmar_lancamento(eid: int, lid: int, dados: ConfirmarLancamentoIn, ctx: Operador):
    e, lc = _lancamento(ctx, eid, lid)
    if lc.status == StatusLancamento.conciliado:
        raise HTTPException(400, "Este crédito já está conciliado.")
    try:
        notas = conciliacao.confirmar(ctx.db, lc, dados.nfse_ids or lc.nfse_ids or [])
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    conciliacao.atualizar_totais(ctx.db, e)
    ctx.auditar("extrato.confirmar", "lancamento_extrato", lc.id,
                descricao=f"Crédito de {lc.valor} em {lc.data:%d/%m/%Y} → NFS-e {', '.join(str(n.numero) for n in notas)}")
    ctx.db.commit()
    return _lanc_out(ctx, lc)


@router.post("/extratos/{eid}/lancamentos/{lid}/ignorar", response_model=LancamentoOut)
def ignorar_lancamento(eid: int, lid: int, ctx: Operador):
    e, lc = _lancamento(ctx, eid, lid)
    if lc.status == StatusLancamento.conciliado:
        raise HTTPException(400, "Desfaça a baixa antes de ignorar.")
    lc.status, lc.nfse_ids, lc.motivo = StatusLancamento.ignorado, [], "Marcado como não relacionado a notas"
    conciliacao.atualizar_totais(ctx.db, e)
    ctx.auditar("extrato.ignorar", "lancamento_extrato", lc.id, descricao=f"{lc.valor} em {lc.data:%d/%m/%Y}")
    ctx.db.commit()
    return _lanc_out(ctx, lc)


@router.post("/extratos/{eid}/lancamentos/{lid}/desfazer", response_model=LancamentoOut)
def desfazer_lancamento(eid: int, lid: int, ctx: Admin):
    e, lc = _lancamento(ctx, eid, lid)
    if lc.status != StatusLancamento.conciliado:
        raise HTTPException(400, "Este crédito não tem baixa para desfazer.")
    n = conciliacao.estornar(ctx.db, lc)
    conciliacao.atualizar_totais(ctx.db, e)
    ctx.auditar("extrato.desfazer", "lancamento_extrato", lc.id, descricao=f"Baixa de {n} nota(s) desfeita")
    ctx.db.commit()
    return _lanc_out(ctx, lc)


@router.get("/extratos/{eid}/lancamentos/{lid}/candidatas", response_model=list[NotaResumo])
def candidatas(eid: int, lid: int, ctx: Ctx, q: str | None = None):
    """Notas em aberto para o usuário escolher manualmente (busca por nº, cliente ou valor)."""
    _, lc = _lancamento(ctx, eid, lid)
    notas = conciliacao._abertas(ctx.db, ctx.tenant_id, set())
    if q:
        qn = leitor._norm(q)
        notas = [n for n in notas if qn in str(n.numero) or qn in leitor._norm((n.rps.dados_json or {}).get("tomador", {}).get("nome", ""))
                 or qn.replace(",", ".") in str(n.valor)]
    notas.sort(key=lambda n: (abs(n.valor - lc.valor), n.data_emissao))
    return [_resumo_nota(n) for n in notas[:50]]


# ======================================================================== baixa manual por nota
@router.post("/notas/{nid}/baixa", response_model=Mensagem)
def baixa_manual(nid: int, dados: BaixaManualIn, ctx: Operador):
    n = ctx.db.get(Nfse, nid)
    if not n or n.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Nota não encontrada.")
    if n.status != StatusNfse.emitida:
        raise HTTPException(400, "Nota cancelada não recebe baixa.")
    if n.pago_em:
        raise HTTPException(400, f"Esta nota já tem baixa em {n.pago_em:%d/%m/%Y}.")
    n.pago_em, n.valor_pago, n.baixa_origem = dados.data, dados.valor or n.valor, "manual"
    fatura.sincronizar(ctx.db, n)
    ctx.auditar("nfse.baixa_manual", "nfse", n.id, descricao=f"NFS-e {n.numero} paga em {dados.data:%d/%m/%Y}")
    ctx.db.commit()
    return Mensagem(mensagem=f"Baixa da NFS-e {n.numero} registrada em {dados.data:%d/%m/%Y}.")


@router.delete("/notas/{nid}/baixa", response_model=Mensagem)
def desfazer_baixa_manual(nid: int, ctx: Admin):
    n = ctx.db.get(Nfse, nid)
    if not n or n.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Nota não encontrada.")
    if not n.pago_em:
        raise HTTPException(400, "Esta nota não tem baixa.")
    if n.lancamento_id:
        raise HTTPException(400, "Esta baixa veio do extrato: desfaça pela tela do extrato.")
    n.pago_em = n.valor_pago = n.baixa_origem = None
    fatura.sincronizar(ctx.db, n)
    ctx.auditar("nfse.desfazer_baixa", "nfse", n.id, descricao=f"NFS-e {n.numero}")
    ctx.db.commit()
    return Mensagem(mensagem="Baixa desfeita.")
