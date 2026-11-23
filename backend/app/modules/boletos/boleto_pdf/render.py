"""PDF do boleto no padrão FEBRABAN: recibo do pagador + ficha de compensação com código de barras ITF.

Não leva o logo do banco: só o nome e o código (ex.: "Banco Santander | 033-7").
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from io import BytesIO

from app.modules.boletos.boleto_pdf import barcode_itf


@dataclass
class BoletoImpresso:
    banco_nome: str  # "Banco Santander"
    banco_codigo: str  # "033-7"
    linha_digitavel: str  # já formatada
    codigo_barras: str  # 44 dígitos
    local_pagamento: str
    beneficiario_nome: str
    beneficiario_documento: str  # formatado
    beneficiario_endereco: str
    agencia_codigo: str
    nosso_numero: str
    carteira: str
    especie_documento: str  # DS
    aceite: str
    numero_documento: str
    data_documento: date
    data_processamento: date
    vencimento: date
    valor: Decimal
    pagador_nome: str
    pagador_documento: str  # formatado
    pagador_endereco: str
    pagador_cidade: str
    instrucoes: list[str] = field(default_factory=list)
    aviso: str = ""  # faixa no topo (ex.: ainda sem registro no banco)


def moeda(v: Decimal) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def gerar_pdf(b: BoletoImpresso) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"Boleto {b.numero_documento}")
    c.setAuthor(b.beneficiario_nome)
    larg_pag, alt_pag = A4
    X0, LARG = 15 * mm, 180 * mm
    X1 = X0 + LARG
    COL = X0 + 132 * mm  # divisão da coluna da direita (vencimento, valores)
    H = 7.2 * mm  # altura de uma linha da grade

    def celula(x, y, w, rotulo, valor="", h=H, direita=False, negrito=False, tam=8.5):
        """Caixa com o rótulo pequeno em cima e o valor embaixo. (x, y) é o canto superior esquerdo."""
        c.setLineWidth(0.5)
        c.rect(x, y - h, w, h)
        c.setFont("Helvetica", 5.5)
        c.drawString(x + 1.2 * mm, y - 2.3 * mm, rotulo)
        if valor:
            fonte = "Helvetica-Bold" if negrito else "Helvetica"
            texto = str(valor)
            while c.stringWidth(texto, fonte, tam) > w - 2.4 * mm and tam > 6:  # texto longo: primeiro diminui a letra
                tam -= 0.5
            while c.stringWidth(texto, fonte, tam) > w - 2.4 * mm and len(texto) > 4:  # só então corta
                texto = texto[:-1]
            c.setFont(fonte, tam)
            if direita:
                c.drawRightString(x + w - 1.5 * mm, y - h + 1.6 * mm, texto)
            else:
                c.drawString(x + 1.2 * mm, y - h + 1.6 * mm, texto)

    def cabecalho(y):
        """Banco | código | linha digitável. Devolve o y da linha de baixo."""
        base = y - 8 * mm
        c.setFont("Helvetica-Bold", 12)
        c.drawString(X0, base + 1.8 * mm, b.banco_nome)
        x_cod = X0 + 46 * mm
        c.setLineWidth(1)
        c.line(x_cod, base, x_cod, base + 7 * mm)
        c.line(x_cod + 18 * mm, base, x_cod + 18 * mm, base + 7 * mm)
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(x_cod + 9 * mm, base + 1.6 * mm, b.banco_codigo)
        c.setFont("Helvetica-Bold", 10.5)
        c.drawRightString(X1, base + 1.8 * mm, b.linha_digitavel)
        c.setLineWidth(1)
        c.line(X0, base, X1, base)
        return base

    def bloco_superior(y, com_instrucoes: bool):
        """Linhas comuns ao recibo e à ficha, do local de pagamento até o pagador. Devolve o y final."""
        dir_w = X1 - COL
        celula(X0, y, COL - X0, "Local de pagamento", b.local_pagamento)
        celula(COL, y, dir_w, "Vencimento", f"{b.vencimento:%d/%m/%Y}", direita=True, negrito=True)
        y -= H
        celula(X0, y, COL - X0, "Beneficiário", f"{b.beneficiario_nome} - CNPJ/CPF {b.beneficiario_documento}")
        celula(COL, y, dir_w, "Agência / Código do beneficiário", b.agencia_codigo, direita=True)
        y -= H
        w = (COL - X0) / 5
        celula(X0, y, w, "Data do documento", f"{b.data_documento:%d/%m/%Y}")
        celula(X0 + w, y, w * 1.4, "Nº do documento", b.numero_documento)
        celula(X0 + w * 2.4, y, w * 0.8, "Espécie doc.", b.especie_documento)
        celula(X0 + w * 3.2, y, w * 0.6, "Aceite", b.aceite)
        celula(X0 + w * 3.8, y, w * 1.2, "Data do processamento", f"{b.data_processamento:%d/%m/%Y}")
        celula(COL, y, dir_w, "Nosso número", b.nosso_numero, direita=True)
        y -= H
        celula(X0, y, w, "Uso do banco", "")
        celula(X0 + w, y, w * 0.8, "Carteira", b.carteira)
        celula(X0 + w * 1.8, y, w * 0.7, "Espécie", "R$")
        celula(X0 + w * 2.5, y, w * 1.3, "Quantidade", "")
        celula(X0 + w * 3.8, y, w * 1.2, "(x) Valor", "")
        celula(COL, y, dir_w, "(=) Valor do documento", moeda(b.valor), direita=True, negrito=True)
        y -= H
        if com_instrucoes:
            alto = H * 5
            c.setLineWidth(0.5)
            c.rect(X0, y - alto, COL - X0, alto)
            c.setFont("Helvetica", 5.5)
            c.drawString(X0 + 1.2 * mm, y - 2.3 * mm, "Instruções (texto de responsabilidade do beneficiário)")
            c.setFont("Helvetica", 7.5)
            ty = y - 6 * mm
            for linha in b.instrucoes[:8]:
                c.drawString(X0 + 1.2 * mm, ty, linha[:110])
                ty -= 3.5 * mm
            for rotulo in ("(-) Desconto / Abatimento", "(-) Outras deduções", "(+) Mora / Multa", "(+) Outros acréscimos",
                           "(=) Valor cobrado"):
                celula(COL, y, dir_w, rotulo, "")
                y -= H
        alto = H * 2.2
        c.setLineWidth(0.5)
        c.rect(X0, y - alto, LARG, alto)
        c.setFont("Helvetica", 5.5)
        c.drawString(X0 + 1.2 * mm, y - 2.3 * mm, "Pagador")
        c.setFont("Helvetica", 8)
        c.drawString(X0 + 12 * mm, y - 3.2 * mm, f"{b.pagador_nome} - CPF/CNPJ {b.pagador_documento}"[:120])
        c.drawString(X0 + 12 * mm, y - 6.8 * mm, b.pagador_endereco[:120])
        c.drawString(X0 + 12 * mm, y - 10.4 * mm, b.pagador_cidade[:120])
        c.setFont("Helvetica", 5.5)
        c.drawString(X0 + 1.2 * mm, y - alto + 1.2 * mm, "Sacador / Avalista")
        return y - alto

    y = alt_pag - 12 * mm
    if b.aviso:
        c.setFillColorRGB(0.79, 0.26, 0.26)
        c.rect(X0, y - 7 * mm, LARG, 7 * mm, stroke=0, fill=1)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(X0 + LARG / 2, y - 4.8 * mm, b.aviso[:120])
        c.setFillColorRGB(0, 0, 0)
        y -= 10 * mm

    # ---------------------------------------------------------------- recibo do pagador
    y = cabecalho(y)
    y = bloco_superior(y, com_instrucoes=False)
    c.setFont("Helvetica-Bold", 7)
    c.drawRightString(X1, y - 3.5 * mm, "Recibo do Pagador")
    c.setFont("Helvetica", 6)
    c.drawString(X0, y - 3.5 * mm, "Autenticação mecânica")
    y -= 22 * mm

    # ---------------------------------------------------------------- linha de corte
    c.setDash(3, 2)
    c.setLineWidth(0.5)
    c.line(X0, y, X1, y)
    c.setDash()
    c.setFont("Helvetica", 5.5)
    c.drawRightString(X1, y + 1 * mm, "Corte na linha pontilhada")
    y -= 5 * mm

    # ---------------------------------------------------------------- ficha de compensação
    y = cabecalho(y)
    y = bloco_superior(y, com_instrucoes=True)
    c.setFont("Helvetica-Bold", 7)
    c.drawRightString(X1, y - 3.5 * mm, "Autenticação mecânica - Ficha de Compensação")
    if b.codigo_barras:
        # FEBRABAN: 103 mm de comprimento por 13 mm de altura, com zona de silêncio dos dois lados
        barcode_itf.desenhar(c, b.codigo_barras, X0 + 5 * mm, y - 19 * mm, 103 * mm, 13 * mm)
    c.showPage()
    c.save()
    return buf.getvalue()
