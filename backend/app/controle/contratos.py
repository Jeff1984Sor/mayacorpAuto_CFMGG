"""Contrato da MayaCorp com o cliente: modelo com {{variaveis}} → texto final → PDF → e-mail."""

import re
from datetime import date
from decimal import Decimal
from io import BytesIO

from app.controle.models import Cliente

VARIAVEIS: dict[str, str] = {
    "cliente_nome": "Nome do escritório",
    "cliente_documento": "CNPJ/CPF do escritório",
    "responsavel": "Responsável pelo contrato",
    "email_financeiro": "E-mail do financeiro",
    "plano": "Plano contratado",
    "ciclo": "Mensal ou anual",
    "valor": "Valor do ciclo (R$)",
    "valor_mensal": "Valor mensal do plano (R$)",
    "valor_anual": "Valor anual do plano (R$)",
    "usuarios": "Usuários incluídos",
    "notas_mes": "Notas fiscais por mês",
    "nota_excedente": "Valor da nota excedente (R$)",
    "usuario_adicional": "Valor do usuário adicional (R$)",
    "desconto_indicacao": "Desconto por indicação (%)",
    "valor_com_desconto": "Valor do ciclo com o desconto (R$)",
    "data_inicio": "Início do contrato",
    "data_hoje": "Data de hoje",
}

_VAR = re.compile(r"{{\s*([a-z_]+)\s*}}")


def _brl(v: Decimal | None) -> str:
    if v is None:
        return ""
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _doc(d: str | None) -> str:
    from app.core.documentos import formatar_documento

    return formatar_documento(d) if d else ""


def valores(c: Cliente) -> dict[str, str]:
    from sqlalchemy.orm import object_session

    from app.controle import indicacao

    p = c.plano
    anual = c.ciclo == "anual"
    _, pct = indicacao.desconto(object_session(c), c)
    ciclo = (p.preco_anual if anual else p.preco_mensal) if p else None
    return {
        "desconto_indicacao": f"{pct:.2f}".rstrip("0").rstrip(".").replace(".", ","),
        "valor_com_desconto": _brl(indicacao.aplicar(ciclo, pct)),
        "cliente_nome": c.nome, "cliente_documento": _doc(c.documento), "responsavel": c.responsavel or "",
        "email_financeiro": c.email_financeiro or "", "plano": p.nome if p else "", "ciclo": "anual" if anual else "mensal",
        "valor": _brl((p.preco_anual if anual else p.preco_mensal) if p else None),
        "valor_mensal": _brl(p.preco_mensal if p else None), "valor_anual": _brl(p.preco_anual if p else None),
        "usuarios": str(p.usuarios) if p and p.usuarios else "ilimitados" if p else "",
        "notas_mes": str(p.notas_mes) if p and p.notas_mes else "ilimitadas" if p else "",
        "nota_excedente": _brl(p.preco_nota_excedente if p else None),
        "usuario_adicional": _brl(p.preco_usuario_adicional if p else None),
        "data_inicio": f"{c.inicio_contrato:%d/%m/%Y}" if c.inicio_contrato else "",
        "data_hoje": f"{date.today():%d/%m/%Y}",
    }


def preencher(corpo: str, c: Cliente) -> tuple[str, list[str]]:
    """Texto final e as variáveis que ficaram sem valor (para o admin conferir antes de enviar)."""
    vals = valores(c)
    vazias: list[str] = []

    def troca(m: re.Match) -> str:
        chave = m.group(1)
        if chave not in vals:
            return m.group(0)
        if not vals[chave]:
            vazias.append(chave)
        return vals[chave]

    return _VAR.sub(troca, corpo), sorted(set(vazias))


def desconhecidas(corpo: str) -> list[str]:
    return sorted({m for m in _VAR.findall(corpo) if m not in VARIAVEIS})


def pdf(titulo: str, corpo: str, emitente: str) -> bytes:
    from xml.sax.saxutils import escape

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    base = getSampleStyleSheet()
    titulo_st = ParagraphStyle("t", parent=base["Title"], fontSize=14, spaceAfter=6 * mm)
    texto_st = ParagraphStyle("p", parent=base["BodyText"], fontSize=10, leading=14, spaceAfter=3 * mm)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=22 * mm, rightMargin=22 * mm, topMargin=20 * mm,
                            bottomMargin=20 * mm, title=titulo, author=emitente)
    story = [Paragraph(escape(titulo), titulo_st)]
    for bloco in re.split(r"\n\s*\n", corpo.strip()):
        story.append(Paragraph(escape(bloco).replace("\n", "<br/>"), texto_st))
    story.append(Spacer(1, 4 * mm))

    def rodape(canvas, d):
        canvas.setFont("Helvetica", 7)
        canvas.drawString(22 * mm, 10 * mm, f"{emitente} · {titulo} · página {d.page}")

    doc.build(story, onFirstPage=rodape, onLaterPages=rodape)
    return buf.getvalue()
