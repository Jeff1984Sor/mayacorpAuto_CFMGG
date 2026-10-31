"""Fatura (Nota de Honorários) gerada para cada NFS-e emitida.

Mesmo desenho da NH do sistema RCA: emitente à esquerda e logo do escritório à direita, título com
Emissão / Vencimento / Documento nº / Nota Fiscal, cliente, item, totais e dados para pagamento.
Aqui com um extra: QR Code PIX "copia e cola" já com o valor.

A fatura acompanha a nota: nota paga (extrato ou baixa manual) = fatura paga na mesma data;
nota cancelada = fatura cancelada.
"""

from datetime import date, timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.documentos import formatar_documento
from app.core.models import Identidade
from app.modules.rpa_nfse import service
from app.modules.rpa_nfse.models import ConfigNfse, Fatura, Nfse, StatusFatura, StatusNfse, TipoFatura
from app.modules.rpa_nfse.pix import br_code
from app.modules.rpa_nfse.qr import QrFlowable


def ultimo_numero(db: Session, tipo: TipoFatura, *, emissora_id: int | None = None, tenant_id: int | None = None) -> int:
    q = select(func.max(Fatura.numero)).where(Fatura.tipo == tipo)
    q = q.where(Fatura.emissora_id == emissora_id) if emissora_id else q.where(Fatura.tenant_id == tenant_id)
    return db.scalar(q) or 0


def numero_definido(cfg: ConfigNfse | None, tipo: TipoFatura) -> int:
    """Próximo número escolhido em Configurações (0 = segue a sequência)."""
    if not cfg:
        return 0
    return (cfg.fatura_proxima_nd if tipo == TipoFatura.despesas else cfg.fatura_proxima_nh) or 0


def proximo_numero(db: Session, emissora_id: int, tipo: TipoFatura = TipoFatura.honorarios) -> int:
    """Numeração própria por emissora e tipo (NH / ND), contínua entre os anos. Nunca volta para um número já usado."""
    from app.modules.rpa_nfse.models import Emissora

    cfg = db.scalar(select(ConfigNfse).join(Emissora, Emissora.tenant_id == ConfigNfse.tenant_id)
                    .where(Emissora.id == emissora_id))
    return max(ultimo_numero(db, tipo, emissora_id=emissora_id) + 1, numero_definido(cfg, tipo))


def criar(db: Session, nota: Nfse, cfg: ConfigNfse) -> Fatura | None:
    """Idempotente: a nota tem no máximo uma fatura."""
    existente = db.scalar(select(Fatura).where(Fatura.nfse_id == nota.id))
    if existente:
        return existente
    origem_id = (nota.rps.dados_json or {}).get("fatura_id")
    if origem_id and (origem := db.get(Fatura, origem_id)) and origem.nfse_id is None:
        origem.nfse_id = nota.id
        origem.nfse = nota
        salvar_pdf(db, origem, cfg)
        return origem
    emissao = nota.data_emissao.date() if hasattr(nota.data_emissao, "date") else date.today()
    fat = Fatura(
        tenant_id=nota.tenant_id, emissora_id=nota.emissora_id, nfse_id=nota.id, tomador_id=nota.tomador_id,
        ano=emissao.year, numero=proximo_numero(db, nota.emissora_id), data_emissao=emissao,
        data_vencimento=emissao if cfg.fatura_vencimento_modo == "emissao"
        else emissao + timedelta(days=cfg.fatura_dias_vencimento if cfg.fatura_dias_vencimento is not None else 10),
        descricao=nota.rps.discriminacao or "Honorários advocatícios", valor=nota.valor,
    )
    db.add(fat)
    db.flush()
    fat.nfse = nota
    fat.emissora = nota.emissora
    salvar_pdf(db, fat, cfg)
    return fat


def sincronizar(db: Session, nota: Nfse) -> None:
    """Espelha na fatura o que aconteceu com a nota (baixa, estorno ou cancelamento)."""
    fat = db.scalar(select(Fatura).where(Fatura.nfse_id == nota.id))
    if not fat:
        return
    if nota.status == StatusNfse.cancelada and fat.origem == "faturamento":
        # a cobrança continua valendo: a fatura volta a aguardar uma nova NFS-e
        fat.nfse_id, fat.nfse = None, None
        fat.status, fat.pago_em = StatusFatura.aberta, None
        fat.observacao = ((fat.observacao or "") + f"\nNFS-e {nota.numero} cancelada: emita uma nova nota.").strip()
    elif nota.status == StatusNfse.cancelada:
        fat.status = StatusFatura.cancelada
    elif nota.pago_em:
        fat.status, fat.pago_em = StatusFatura.paga, nota.pago_em
    else:
        fat.status, fat.pago_em = StatusFatura.aberta, None
    salvar_pdf(db, fat, service.config_nfse(db, nota.tenant_id))
    espelhar_no_financeiro(db, fat)


def espelhar_no_financeiro(db: Session, fat: Fatura, conta_id: int | None = None) -> None:
    """Recebimento da fatura vira crédito no extrato (Financeiro › Conta Bancária)."""
    from app.modules.financas.service import espelhar_recebimento

    espelhar_recebimento(db, fat, conta_id)


def situacao(fat: Fatura) -> str:
    if fat.status == StatusFatura.aberta and fat.data_vencimento < date.today():
        return "vencida"
    return fat.status.value


def pix_da_fatura(fat: Fatura) -> str | None:
    e = fat.emissora
    if not e.chave_pix or fat.status != StatusFatura.aberta:
        return None
    return br_code(e.chave_pix, e.razao_social, e.cidade or "SAO PAULO", fat.total, fat.codigo.replace(" ", "").replace("/", ""))


def salvar_pdf(db: Session, fat: Fatura, cfg: ConfigNfse) -> None:
    prefixo = "ND" if fat.tipo == TipoFatura.despesas else "NH"
    destino = service.pasta(fat.emissora_id, fat.data_emissao) / f"Fatura_{prefixo}{fat.numero:05d}.pdf"
    destino.write_bytes(gerar_pdf(fat, db.get(Identidade, fat.tenant_id), cfg))
    fat.pdf_path = str(destino)


def dados_cliente(fat: Fatura) -> dict:
    """Cliente da fatura: o que foi para a nota (se já existe NFS-e) ou o cadastro do cliente."""
    if fat.nfse:
        return (fat.nfse.rps.dados_json or {}).get("tomador", {})
    t = fat.tomador
    if not t:
        return {}
    return {"nome": t.nome, "cpf_cnpj": t.cpf_cnpj, "logradouro": t.logradouro, "numero": t.numero,
            "bairro": t.bairro, "cidade": t.cidade, "uf": t.uf, "cep": t.cep, "email": (t.emails or [None])[0]}


def _contrato(fat: Fatura):
    from sqlalchemy.orm import object_session

    from app.modules.faturamento.models import Contrato

    sess = object_session(fat)
    return sess.get(Contrato, fat.contrato_id) if sess else None


def _brl(v) -> str:
    return "R$ " + f"{Decimal(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def gerar_pdf(fat: Fatura, ident: Identidade | None, cfg: ConfigNfse) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    DARK, TX, CINZA = colors.HexColor("#333333"), colors.HexColor("#222222"), colors.HexColor("#666666")
    DESTAQUE = colors.HexColor(ident.cor_destaque) if ident and ident.cor_destaque else colors.HexColor("#1E2D6B")
    LARG = 174 * mm
    ss = getSampleStyleSheet()
    p = ParagraphStyle("p", parent=ss["Normal"], fontName="Helvetica", fontSize=8, leading=11, textColor=TX)
    p_sm = ParagraphStyle("sm", parent=p, fontSize=7, leading=9.5, textColor=CINZA)
    p_sm_r = ParagraphStyle("smr", parent=p_sm, alignment=TA_RIGHT)
    p_r = ParagraphStyle("r", parent=p, alignment=TA_RIGHT)
    p_th = ParagraphStyle("th", parent=p, fontName="Helvetica-Bold", fontSize=7, textColor=DARK)
    p_th_r = ParagraphStyle("thr", parent=p_th, alignment=TA_RIGHT)
    p_nome = ParagraphStyle("nome", parent=p, fontName="Helvetica-Bold", fontSize=10, textColor=DARK)
    p_tit = ParagraphStyle("tit", parent=p, fontName="Helvetica-Bold", fontSize=12, textColor=DARK)
    p_total = ParagraphStyle("tot", parent=p, fontName="Helvetica-Bold", fontSize=11, alignment=TA_RIGHT, textColor=DESTAQUE)

    def linha(esp=0.7, antes=3, depois=3, cor=DARK):
        return HRFlowable(width="100%", thickness=esp, color=cor, spaceBefore=antes, spaceAfter=depois, lineCap="butt")

    def d(x):
        return x.strftime("%d/%m/%Y") if x else "----"

    e, nota = fat.emissora, fat.nfse
    despesas = fat.tipo == TipoFatura.despesas
    tom = dados_cliente(fat)
    story = []

    # ---- cabeçalho: emitente + logo do escritório
    emp = [Paragraph(e.razao_social, p_nome)]
    det = [f"CNPJ: {formatar_documento(e.cnpj)}", f"I.M.: {e.ccm}"]
    emp.append(Paragraph(" &nbsp;•&nbsp; ".join(det), p_sm))
    l1 = ", ".join(x for x in [e.logradouro, e.numero, e.complemento] if x)
    l2 = " - ".join(x for x in [e.bairro, e.cidade, e.uf] if x) + (f" - CEP {e.cep[:5]}-{e.cep[5:]}" if e.cep else "")
    for t in (l1, l2):
        if t:
            emp.append(Paragraph(t, p_sm))
    contato = " &nbsp;•&nbsp; ".join(x for x in [f"Tel: {e.telefone}" if e.telefone else "", e.email or ""] if x)
    if contato:
        emp.append(Paragraph(contato, p_sm))
    logo = ""
    if ident and ident.logo_path and Path(ident.logo_path).exists() and not ident.logo_path.lower().endswith(".svg"):
        try:
            logo = Image(ident.logo_path)
            ratio = logo.imageWidth / float(logo.imageHeight or 1)
            logo.drawHeight = 20 * mm
            logo.drawWidth = min(55 * mm, 20 * mm * ratio)
            logo.hAlign = "RIGHT"
        except Exception:  # noqa: BLE001 — logo ilegível não pode quebrar a fatura
            logo = ""
    head = Table([[emp, logo]], colWidths=[LARG - 58 * mm, 58 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [head, linha(1.0, 6, 8)]

    # ---- título + meta
    meta = [[Paragraph("Emissão", p_sm), Paragraph(f"<b>{d(fat.data_emissao)}</b>", p_sm_r)],
            [Paragraph("Vencimento", p_sm), Paragraph(f"<b>{d(fat.data_vencimento)}</b>", p_sm_r)],
            [Paragraph("Documento nº", p_sm), Paragraph(f"<b>{fat.codigo}</b>", p_sm_r)]]
    if nota:
        meta.append([Paragraph("Nota Fiscal", p_sm), Paragraph(f"<b>{nota.numero}</b>", p_sm_r)])
    mt = Table(meta, colWidths=[28 * mm, 30 * mm])
    mt.setStyle(TableStyle([("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    titulo = [Paragraph("Nota de Despesas" if despesas else "Nota de Honorários", p_tit)]
    if despesas:
        titulo.append(Paragraph("Reembolso de despesas · documento não fiscal", p_sm))
    tit = Table([[titulo, mt]], colWidths=[LARG - 58 * mm, 58 * mm])
    tit.setStyle(TableStyle([("VALIGN", (0, 0), (0, 0), "MIDDLE"), ("VALIGN", (1, 0), (1, 0), "TOP"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [tit, linha(1.2, 8, 10)]

    selo = {"paga": (f"PAGA EM {d(fat.pago_em)}", "#1A8F5E"), "cancelada": ("CANCELADA", "#C94343")}.get(fat.status.value)
    if selo:
        story += [Paragraph(f"<b>{selo[0]}</b>", ParagraphStyle("selo", parent=p, textColor=colors.HexColor(selo[1]))),
                  Spacer(1, 3 * mm)]
    if nota and nota.simulada:
        story += [Paragraph("<b>SIMULAÇÃO — documento de demonstração, sem valor de cobrança</b>",
                            ParagraphStyle("sim", parent=p_sm, textColor=colors.HexColor("#C94343"))), Spacer(1, 2 * mm)]

    # ---- cliente
    doc = formatar_documento(tom.get("cpf_cnpj"))
    story.append(Paragraph(f"<b>Cliente:</b> {tom.get('nome', '')}" + (f" &nbsp;•&nbsp; {'CPF' if len(tom.get('cpf_cnpj') or '') == 11 else 'CNPJ'}: {doc}" if doc else ""), p_sm))
    end = " - ".join(x for x in [", ".join(x for x in [tom.get("logradouro"), tom.get("numero")] if x),
                                 tom.get("bairro"), tom.get("cidade"), tom.get("uf")] if x)
    if end:
        story.append(Paragraph(end, p_sm))
    if fat.contrato_id and (contrato := _contrato(fat)):
        story.append(Paragraph(f"<b>Contrato:</b> #{contrato.numero} — {contrato.nome}", p_sm))
    if nota:
        story.append(Paragraph(f"<b>RPS:</b> {nota.rps.serie}-{nota.rps.numero} &nbsp;•&nbsp; <b>Lote:</b> #{nota.rps.lote.numero:04d} "
                               f"&nbsp;•&nbsp; <b>Verificação NFS-e:</b> {nota.cod_verificacao}", p_sm))
    story.append(Spacer(1, 5 * mm))

    # ---- item
    linhas_itens = list(getattr(fat, "itens", []) or [])
    if linhas_itens:  # fatura gerada em Itens a faturar: uma linha por parcela, hora ou despesa
        itens = [[Paragraph("Data", p_th), Paragraph("Descrição", p_th), Paragraph("Qtd.", p_th_r), Paragraph("Valor (R$)", p_th_r)]]
        for it in linhas_itens:
            texto = it.descricao.replace("\n", "<br/>")
            if it.caso_id and it.caso:
                texto += f"<br/><font size=6 color='#666666'>Caso #{it.caso.numero} — {it.caso.titulo}</font>"
            if it.profissional:
                texto += f"<br/><font size=6 color='#666666'>{it.profissional}</font>"
            qtd = f"{it.quantidade:.2f}h".replace(".", ",") if it.quantidade else ""
            itens.append([Paragraph(d(it.data or it.competencia) if (it.data or it.competencia) else "", p_sm),
                          Paragraph(texto, p), Paragraph(qtd, p_r), Paragraph(_brl(it.valor).replace("R$ ", ""), p_r)])
        t = Table(itens, colWidths=[20 * mm, LARG - 20 * mm - 18 * mm - 30 * mm, 18 * mm, 30 * mm], repeatRows=1)
    else:
        desc = (fat.descricao or "").replace("\n", "<br/>")
        itens = [[Paragraph("Descrição", p_th), Paragraph("Valor (R$)", p_th_r)],
                 [Paragraph(desc, p), Paragraph(_brl(fat.valor).replace("R$ ", ""), p_r)]]
        t = Table(itens, colWidths=[LARG - 35 * mm, 35 * mm])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 1.0, DARK), ("LINEBELOW", (0, 0), (-1, 0), 1.0, DARK),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.5, DARK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [t, Spacer(1, 3 * mm)]

    # ---- totais
    tot = [[Paragraph("Subtotal", p_sm_r), Paragraph(_brl(fat.valor), p_r)]]
    if fat.desconto:
        tot.append([Paragraph("Desconto", p_sm_r), Paragraph("- " + _brl(fat.desconto), p_r)])
    if fat.juros:
        tot.append([Paragraph("Juros/multa", p_sm_r), Paragraph(_brl(fat.juros), p_r)])
    tot.append([Paragraph("<b>Total a pagar</b>", p_r), Paragraph(_brl(fat.total), p_total)])
    tt = Table(tot, colWidths=[LARG - 40 * mm, 40 * mm])
    tt.setStyle(TableStyle([("LINEABOVE", (0, -1), (-1, -1), 1.0, DARK), ("TOPPADDING", (0, 0), (-1, -1), 2),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [tt, Spacer(1, 8 * mm)]

    # ---- dados para pagamento + PIX
    pag = [Paragraph("<b>Dados para pagamento</b>", p)]
    if e.banco or e.conta:
        pag.append(Paragraph(" &nbsp;•&nbsp; ".join(x for x in [
            f"Banco: {e.banco}" if e.banco else "", f"Agência: {e.agencia}" if e.agencia else "",
            f"Conta: {e.conta}" if e.conta else ""] if x), p_sm))
    pag.append(Paragraph(f"Favorecido: {e.razao_social} &nbsp;•&nbsp; CNPJ {formatar_documento(e.cnpj)}", p_sm))
    if e.chave_pix:
        pag.append(Paragraph(f"Chave PIX: <b>{e.chave_pix}</b>", p_sm))
    if cfg.fatura_instrucoes:
        pag += [Spacer(1, 2 * mm), Paragraph(cfg.fatura_instrucoes.replace("\n", "<br/>"), p_sm)]
    codigo_pix = pix_da_fatura(fat)
    qr_cell = ""
    if codigo_pix:
        qr_cell = [QrFlowable(codigo_pix, 30 * mm), Paragraph("PIX copia e cola", ParagraphStyle("qrc", parent=p_sm, alignment=1))]
        pag += [Spacer(1, 2 * mm), Paragraph(f"<font size=6>{codigo_pix}</font>", p_sm)]
    caixa = Table([[pag, qr_cell]], colWidths=[LARG - 38 * mm, 38 * mm])
    caixa.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.7, DARK), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                               ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8)]))
    story.append(caixa)

    def rodape(c, docu):
        c.saveState()
        c.setFont("Helvetica", 6.5)
        c.setFillColor(CINZA)
        c.drawString(18 * mm, 10 * mm, f"{e.razao_social} • {fat.codigo}" + (f" • NFS-e {nota.numero}" if nota else ""))
        c.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Página {docu.page}  •  Uma solução MayaCorp")
        c.restoreState()

    buf = BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                      title=f"Nota de Honorários {fat.codigo}").build(story, onFirstPage=rodape, onLaterPages=rodape)
    return buf.getvalue()

