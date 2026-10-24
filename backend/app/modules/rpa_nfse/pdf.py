"""PDF da NFS-e.

Preferência: o PDF oficial que o portal publica em notaprintpdf.aspx (o mesmo do botão "Imprimir").
Se o portal não responder, gera um PDF próprio com a marca do cliente e QR para a versão oficial.
"""

from decimal import Decimal
from io import BytesIO
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfgen import canvas

from app.core.documentos import formatar_documento
from app.core.models import Identidade
from app.modules.rpa_nfse.models import Nfse

NAVY = colors.HexColor("#1E2D6B")
INDIGO = colors.HexColor("#7C8FFF")
CINZA = colors.HexColor("#64748B")
LINHA = colors.HexColor("#E2E8F0")
FUNDO = colors.HexColor("#F7F8FC")


PORTAL = "https://nfe.prefeitura.sp.gov.br/contribuinte/"


def baixar_oficial(ccm: str, numero: int, cod_verificacao: str) -> bytes | None:
    import re

    import httpx

    params = f"ccm={ccm}&nf={numero}&cod={re.sub(r'[^A-Za-z0-9]', '', cod_verificacao)}"
    try:
        r = httpx.get(f"{PORTAL}notaprintpdf.aspx?{params}", timeout=40, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        if r.content[:5] == b"%PDF-":
            return r.content
    except httpx.HTTPError:
        pass
    return None


def brl(v: Decimal | float) -> str:
    s = f"{Decimal(v):,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def gerar(nota: Nfse, identidade: Identidade | None, link: str) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    m = 16 * mm
    destaque = colors.HexColor(identidade.cor_destaque) if identidade and identidade.cor_destaque else NAVY
    rps = nota.rps
    tom = (rps.dados_json or {}).get("tomador", {})
    em = nota.emissora
    c.setTitle(f"NFS-e {nota.numero}")

    # ---- Faixa de topo
    c.setFillColor(destaque)
    c.rect(0, h - 34 * mm, w, 34 * mm, stroke=0, fill=1)
    x_txt = m
    if identidade and identidade.logo_path and Path(identidade.logo_path).exists():
        try:
            img = ImageReader(identidade.logo_path)
            iw, ih = img.getSize()
            alt = 16 * mm
            larg = min(alt * iw / ih, 50 * mm)
            c.drawImage(img, m, h - 25 * mm, larg, alt, mask="auto", preserveAspectRatio=True)
            x_txt = m + larg + 6 * mm
        except Exception:
            pass
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(x_txt, h - 15 * mm, (identidade.nome_exibicao if identidade else em.razao_social)[:48])
    c.setFont("Helvetica", 9)
    c.drawString(x_txt, h - 21 * mm, "NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e · Prefeitura de São Paulo")
    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(w - m, h - 16 * mm, f"Nº {nota.numero:08d}")
    c.setFont("Courier-Bold", 10)
    c.drawRightString(w - m, h - 23 * mm, f"Verificação: {nota.cod_verificacao}")
    c.setFont("Helvetica", 8)
    c.drawRightString(w - m, h - 28 * mm, f"Emitida em {nota.data_emissao:%d/%m/%Y %H:%M}")

    y = h - 44 * mm

    def bloco(titulo: str, linhas: list[tuple[str, str]], altura: float) -> None:
        nonlocal y
        c.setFillColor(FUNDO)
        c.setStrokeColor(LINHA)
        c.roundRect(m, y - altura, w - 2 * m, altura, 3 * mm, stroke=1, fill=1)
        c.setFillColor(destaque)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(m + 4 * mm, y - 5 * mm, titulo.upper())
        yy = y - 10 * mm
        col = 0
        for rot, val in linhas:
            xx = m + 4 * mm + col * (w - 2 * m) / 2
            c.setFillColor(CINZA)
            c.setFont("Helvetica", 7)
            c.drawString(xx, yy, rot)
            c.setFillColor(colors.black)
            c.setFont("Helvetica-Bold", 9)
            c.drawString(xx, yy - 4 * mm, (val or "—")[:60])
            col = 1 - col
            if col == 0:
                yy -= 10 * mm
        y -= altura + 5 * mm

    bloco(
        "Prestador de serviços",
        [
            ("Razão social", em.razao_social),
            ("CNPJ", formatar_documento(em.cnpj)),
            ("Inscrição municipal (CCM)", em.ccm),
            ("Endereço", ", ".join(filter(None, [em.logradouro, em.numero, em.bairro, em.cidade, em.uf]))),
        ],
        30 * mm,
    )
    bloco(
        "Tomador de serviços",
        [
            ("Nome / Razão social", tom.get("nome", "")),
            ("CPF / CNPJ", formatar_documento(tom.get("cpf_cnpj"))),
            ("E-mail", tom.get("email", "")),
            (
                "Endereço",
                ", ".join(
                    filter(None, [tom.get("logradouro"), tom.get("numero"), tom.get("bairro"), tom.get("cidade")])
                ),
            ),
        ],
        30 * mm,
    )

    # ---- Discriminação
    linhas = []
    for par in (rps.discriminacao or "").split("\n"):
        linhas += simpleSplit(par, "Helvetica", 9, w - 2 * m - 8 * mm) or [""]
    linhas = linhas[:28]
    alt = max(24 * mm, (len(linhas) * 4.2 + 12) * mm)
    c.setStrokeColor(LINHA)
    c.setFillColor(colors.white)
    c.roundRect(m, y - alt, w - 2 * m, alt, 3 * mm, stroke=1, fill=1)
    c.setFillColor(destaque)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(m + 4 * mm, y - 5 * mm, "DISCRIMINAÇÃO DOS SERVIÇOS")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    yy = y - 11 * mm
    for ln in linhas:
        c.drawString(m + 4 * mm, yy, ln)
        yy -= 4.2 * mm
    y -= alt + 5 * mm

    # ---- Valores
    l2 = (rps.dados_json or {}).get("layout2", {})
    base = rps.valor - rps.deducoes
    bloco(
        "Valores e tributos",
        [
            ("Valor do serviço", brl(rps.valor)),
            ("Deduções", brl(rps.deducoes)),
            ("Base de cálculo", brl(base)),
            ("Alíquota ISS", f"{rps.aliquota * 100:.2f}%".replace(".", ",")),
            ("ISS", brl(rps.iss) + (" (retido)" if rps.iss_retido else "")),
            ("Código do serviço", rps.cod_servico),
            ("NBS", l2.get("nbs") or ""),
            ("IBS/CBS — CST / cClassTrib", f"{l2.get('cst_ibscbs', '')} / {l2.get('class_trib', '')}"),
        ],
        50 * mm,
    )

    # ---- Total + QR
    c.setFillColor(destaque)
    c.roundRect(m, y - 22 * mm, w - 2 * m - 30 * mm, 22 * mm, 3 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica", 9)
    c.drawString(m + 5 * mm, y - 8 * mm, "VALOR TOTAL DA NOTA")
    c.setFont("Helvetica-Bold", 18)
    c.drawString(m + 5 * mm, y - 17 * mm, brl(nota.valor))
    qr = QrCodeWidget(link)
    b = qr.getBounds()
    tam = 26 * mm
    d = Drawing(tam, tam, transform=[tam / (b[2] - b[0]), 0, 0, tam / (b[3] - b[1]), 0, 0])
    d.add(qr)
    renderPDF.draw(d, c, w - m - tam + 2 * mm, y - 24 * mm)

    # ---- Rodapé
    c.setFillColor(CINZA)
    c.setFont("Helvetica", 7)
    c.drawString(m, 16 * mm, "Consulte a autenticidade em nfe.prefeitura.sp.gov.br ou pelo QR Code.")
    c.drawString(m, 12 * mm, link[:120])
    c.setFillColor(INDIGO)
    c.drawRightString(w - m, 12 * mm, "Uma solução MayaCorp")

    if nota.simulada:
        c.saveState()
        c.setFillColor(colors.Color(0.79, 0.26, 0.26, alpha=0.12))
        c.setFont("Helvetica-Bold", 60)
        c.translate(w / 2, h / 2)
        c.rotate(35)
        c.drawCentredString(0, 0, "SIMULAÇÃO")
        c.setFont("Helvetica-Bold", 18)
        c.drawCentredString(0, -24, "sem valor fiscal")
        c.restoreState()

    c.showPage()
    c.save()
    return buf.getvalue()
