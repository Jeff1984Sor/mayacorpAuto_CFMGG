"""Faturas: NH (honorários — da NFS-e da Lello ou de Itens a faturar) e ND (reembolso de despesas, sem NFS-e)."""

from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select

from app.core.deps import Admin, Ctx, Operador
from app.core.documentos import so_digitos
from app.core.schemas import Mensagem, Pagina
from app.modules.rpa_nfse import fatura as faturas
from app.modules.rpa_nfse import service
from app.modules.rpa_nfse.models import Fatura, Nfse, StatusFatura, StatusNfse, TipoFatura, Tomador
from app.modules.rpa_nfse.schemas import BaixaManualIn, FaturaOut, ZipIn

router = APIRouter(prefix="/nfse", tags=["Faturas"])


def fatura_out(f: Fatura) -> FaturaOut:
    tom = faturas.dados_cliente(f)
    contrato = faturas._contrato(f) if f.contrato_id else None
    return FaturaOut(
        id=f.id, codigo=f.codigo, numero=f.numero, ano=f.ano, tipo=f.tipo.value, origem=f.origem,
        contrato_id=f.contrato_id, contrato_nome=f"#{contrato.numero} {contrato.nome}" if contrato else None,
        pode_emitir_nfse=f.tipo == TipoFatura.honorarios and not f.nfse_id and f.status != StatusFatura.cancelada,
        nfse_id=f.nfse_id, nfse_numero=f.nfse.numero if f.nfse else None,
        lote_id=f.nfse.rps.lote_id if f.nfse else None, emissora_id=f.emissora_id, tomador_id=f.tomador_id,
        tomador_nome=tom.get("nome") or "", tomador_doc=tom.get("cpf_cnpj"), data_emissao=f.data_emissao,
        data_vencimento=f.data_vencimento, valor=f.valor, desconto=f.desconto, juros=f.juros, total=f.total,
        status=f.status, situacao=faturas.situacao(f), pago_em=f.pago_em, descricao=f.descricao,
        pix_copia_e_cola=faturas.pix_da_fatura(f), simulada=bool(f.nfse and f.nfse.simulada),
    )


def _fatura(ctx, fid: int) -> Fatura:
    f = ctx.db.get(Fatura, fid)
    if not f or f.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Fatura não encontrada.")
    return f


@router.get("/faturas", response_model=Pagina[FaturaOut])
def listar(
    ctx: Ctx, q: str | None = None, situacao: str | None = Query(None, pattern="^(aberta|vencida|paga|cancelada)$"),
    lote_id: int | None = None, de: date | None = None, ate: date | None = None,
    tipo: str | None = Query(None, pattern="^(honorarios|despesas)$"), contrato_id: int | None = None,
    sem_nfse: bool = False, pagina: int = Query(1, ge=1), por_pagina: int = Query(25, ge=1, le=200),
):
    base = select(Fatura).outerjoin(Nfse, Fatura.nfse_id == Nfse.id).outerjoin(Tomador, Fatura.tomador_id == Tomador.id)
    f = [Fatura.tenant_id == ctx.tenant_id]
    if q:
        dig = so_digitos(q)
        conds = [Tomador.nome.ilike(f"%{q}%")]
        if dig:
            conds += [Fatura.numero == int(dig), Nfse.numero == int(dig), Tomador.cpf_cnpj.like(f"%{dig}%")]
        f.append(or_(*conds))
    hoje = date.today()
    if situacao == "vencida":
        f += [Fatura.status == StatusFatura.aberta, Fatura.data_vencimento < hoje]
    elif situacao == "aberta":
        f += [Fatura.status == StatusFatura.aberta, Fatura.data_vencimento >= hoje]
    elif situacao:
        f.append(Fatura.status == StatusFatura(situacao))
    if lote_id:
        from app.modules.rpa_nfse.models import Rps

        f.append(Nfse.rps_id.in_(select(Rps.id).where(Rps.lote_id == lote_id)))
    if tipo:
        f.append(Fatura.tipo == TipoFatura(tipo))
    if contrato_id:
        f.append(Fatura.contrato_id == contrato_id)
    if sem_nfse:
        f += [Fatura.nfse_id.is_(None), Fatura.tipo == TipoFatura.honorarios, Fatura.status != StatusFatura.cancelada]
    if de:
        f.append(Fatura.data_emissao >= de)
    if ate:
        f.append(Fatura.data_emissao <= ate)
    total = ctx.db.scalar(select(func.count()).select_from(base.where(*f).subquery())) or 0
    itens = ctx.db.scalars(base.where(*f).order_by(Fatura.data_emissao.desc(), Fatura.id.desc())
                           .offset((pagina - 1) * por_pagina).limit(por_pagina))
    return Pagina[FaturaOut](itens=[fatura_out(x) for x in itens], total=total, pagina=pagina, por_pagina=por_pagina)


@router.get("/faturas/resumo")
def resumo(ctx: Ctx):
    hoje = date.today()
    linhas = ctx.db.execute(
        select(Fatura.status, Fatura.data_vencimento < hoje, func.count(Fatura.id), func.coalesce(func.sum(Fatura.valor), 0))
        .where(Fatura.tenant_id == ctx.tenant_id).group_by(Fatura.status, Fatura.data_vencimento < hoje)
    ).all()
    out = {k: {"qtd": 0, "valor": 0.0} for k in ("aberta", "vencida", "paga", "cancelada")}
    for status, vencida, qtd, valor in linhas:
        chave = "vencida" if status == StatusFatura.aberta and vencida else status.value
        out[chave]["qtd"] += qtd
        out[chave]["valor"] += float(valor)
    return out


@router.get("/faturas/{fid}", response_model=FaturaOut)
def ler(fid: int, ctx: Ctx):
    return fatura_out(_fatura(ctx, fid))


@router.get("/faturas/{fid}/pdf")
def pdf(fid: int, ctx: Ctx):
    f = _fatura(ctx, fid)
    if not f.pdf_path or not Path(f.pdf_path).exists():
        faturas.salvar_pdf(ctx.db, f, service.config_nfse(ctx.db, ctx.tenant_id))
        ctx.db.commit()
    return FileResponse(f.pdf_path, media_type="application/pdf", filename=f"Fatura_{f.codigo.replace(' ', '_').replace('/', '-')}.pdf",
                        content_disposition_type="inline")


class FaturaPatch(BaseModel):
    data_vencimento: date | None = None
    desconto: Decimal | None = None
    juros: Decimal | None = None
    observacao: str | None = None


@router.patch("/faturas/{fid}", response_model=FaturaOut)
def alterar(fid: int, dados: FaturaPatch, ctx: Operador):
    f = _fatura(ctx, fid)
    if f.status != StatusFatura.aberta:
        raise HTTPException(400, "Só faturas em aberto podem ser alteradas.")
    antes = {"vencimento": str(f.data_vencimento), "desconto": str(f.desconto), "juros": str(f.juros)}
    for k, v in dados.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    if f.desconto and f.desconto > f.valor:
        raise HTTPException(400, "O desconto não pode ser maior que o valor.")
    faturas.salvar_pdf(ctx.db, f, service.config_nfse(ctx.db, ctx.tenant_id))
    ctx.auditar("fatura.alterar", "fatura", f.id, descricao=f.codigo, antes=antes,
                depois={"vencimento": str(f.data_vencimento), "desconto": str(f.desconto), "juros": str(f.juros)})
    ctx.db.commit()
    return fatura_out(f)


@router.post("/faturas/{fid}/baixa", response_model=FaturaOut)
def baixa(fid: int, dados: BaixaManualIn, ctx: Operador):
    """Baixa manual pela fatura: dá baixa também na NFS-e (são o mesmo recebimento)."""
    f = _fatura(ctx, fid)
    if f.status != StatusFatura.aberta:
        raise HTTPException(400, "Esta fatura não está em aberto.")
    n = f.nfse
    if not n:  # ND ou NH ainda sem nota
        f.status, f.pago_em = StatusFatura.paga, dados.data
        faturas.salvar_pdf(ctx.db, f, service.config_nfse(ctx.db, ctx.tenant_id))
        faturas.espelhar_no_financeiro(ctx.db, f, dados.conta_bancaria_id)
        ctx.auditar("fatura.baixa", "fatura", f.id, descricao=f"{f.codigo} paga em {dados.data:%d/%m/%Y}")
        ctx.db.commit()
        return fatura_out(f)
    n.pago_em, n.valor_pago, n.baixa_origem = dados.data, dados.valor or f.total, "manual"
    faturas.sincronizar(ctx.db, n)
    if dados.conta_bancaria_id:
        faturas.espelhar_no_financeiro(ctx.db, f, dados.conta_bancaria_id)
    ctx.auditar("fatura.baixa", "fatura", f.id, descricao=f"{f.codigo} paga em {dados.data:%d/%m/%Y}")
    ctx.db.commit()
    return fatura_out(f)


@router.delete("/faturas/{fid}/baixa", response_model=FaturaOut)
def desfazer_baixa(fid: int, ctx: Admin):
    f = _fatura(ctx, fid)
    n = f.nfse
    if f.status != StatusFatura.paga:
        raise HTTPException(400, "Esta fatura não está paga.")
    if not n:
        f.status, f.pago_em = StatusFatura.aberta, None
        faturas.salvar_pdf(ctx.db, f, service.config_nfse(ctx.db, ctx.tenant_id))
        faturas.espelhar_no_financeiro(ctx.db, f)
        ctx.auditar("fatura.desfazer_baixa", "fatura", f.id, descricao=f.codigo)
        ctx.db.commit()
        return fatura_out(f)
    if n.lancamento_id:
        raise HTTPException(400, "Esta baixa veio do extrato: desfaça pela tela de Recebimentos.")
    n.pago_em = n.valor_pago = n.baixa_origem = None
    faturas.sincronizar(ctx.db, n)
    ctx.auditar("fatura.desfazer_baixa", "fatura", f.id, descricao=f.codigo)
    ctx.db.commit()
    return fatura_out(f)


@router.post("/faturas/zip")
def zip_faturas(dados: ZipIn, ctx: Ctx):
    import io
    import zipfile

    from fastapi.responses import Response

    q = select(Fatura).where(Fatura.tenant_id == ctx.tenant_id)
    if dados.lote_id:
        from app.modules.rpa_nfse.models import Rps

        q = q.join(Nfse, Fatura.nfse_id == Nfse.id).join(Rps, Nfse.rps_id == Rps.id).where(Rps.lote_id == dados.lote_id)
    elif dados.ids:
        q = q.where(Fatura.id.in_(dados.ids))
    else:
        raise HTTPException(400, "Selecione ao menos uma fatura.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ctx.db.scalars(q):
            if f.pdf_path and Path(f.pdf_path).exists():
                z.write(f.pdf_path, Path(f.pdf_path).name)
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="faturas_{date.today():%Y%m%d}.zip"'})


@router.post("/faturas/gerar-pendentes", response_model=Mensagem)
def gerar_pendentes(ctx: Admin):
    """Cria a fatura das notas emitidas que ainda não têm (ex.: notas anteriores à ativação)."""
    cfg = service.config_nfse(ctx.db, ctx.tenant_id)
    sem = ctx.db.scalars(select(Nfse).where(Nfse.tenant_id == ctx.tenant_id, Nfse.status == StatusNfse.emitida,
                                            ~Nfse.id.in_(select(Fatura.nfse_id).where(Fatura.nfse_id.is_not(None)))))
    n = 0
    for nota in sem:
        f = faturas.criar(ctx.db, nota, cfg)
        if nota.pago_em:
            faturas.sincronizar(ctx.db, nota)
        n += 1 if f else 0
    ctx.auditar("fatura.gerar_pendentes", "fatura", descricao=f"{n} faturas geradas")
    ctx.db.commit()
    return Mensagem(mensagem=f"{n} fatura(s) gerada(s).")
