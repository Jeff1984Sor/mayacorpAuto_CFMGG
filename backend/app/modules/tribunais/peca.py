"""Gerador da peça (seção 10.4): monta o PDF da petição a partir dos campos do protocolo (CPC 319).

O advogado revisa o PDF gerado antes de aprovar; a IA só sugere texto (fatos, fundamentos, pedidos), nunca envia.
"""

import io
from datetime import date
from decimal import Decimal

from app.core.models import Usuario
from app.modules.tribunais import cnj

_UNID = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze",
         "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
_DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
_ESTADO_CIVIL = {"solteiro": "solteiro(a)", "casado": "casado(a)", "divorciado": "divorciado(a)", "separado": "separado(a)",
                 "viuvo": "viúvo(a)", "nao_informado": None}
_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def _ate_mil(n: int) -> str:
    if n == 100:
        return "cem"
    c, r = divmod(n, 100)
    partes = [_CEM[c]] if c else []
    if r < 20:
        if r:
            partes.append(_UNID[r])
    else:
        d, u = divmod(r, 10)
        partes.append(_DEZ[d] + (f" e {_UNID[u]}" if u else ""))
    return " e ".join(partes)


def _inteiro(n: int) -> str:
    if n == 0:
        return "zero"
    grupos = []
    for nome_s, nome_p in (("", ""), ("mil", "mil"), ("milhão", "milhões"), ("bilhão", "bilhões")):
        n, g = divmod(n, 1000)
        if g:
            if nome_s == "mil":
                txt = "mil" if g == 1 else f"{_ate_mil(g)} mil"
            elif nome_s:
                txt = f"{_ate_mil(g)} {nome_s if g == 1 else nome_p}"
            else:
                txt = _ate_mil(g)
            grupos.append((g, txt))
        if not n:
            break
    grupos.reverse()
    out = grupos[0][1]
    for g, txt in grupos[1:]:
        out += (" e " if g < 100 or g % 100 == 0 else ", ") + txt
    return out


def valor_por_extenso(valor) -> str:
    v = Decimal(str(valor)).quantize(Decimal("0.01"))
    reais, cent = divmod(int(v * 100), 100)
    partes = []
    if reais:
        sufixo = "real" if reais == 1 else ("de reais" if reais % 1_000_000 == 0 else "reais")
        partes.append(f"{_inteiro(reais)} {sufixo}")
    if cent:
        partes.append(f"{_inteiro(cent)} {'centavo' if cent == 1 else 'centavos'}")
    return " e ".join(partes) or "zero real"


def _moeda(v) -> str:
    return f"R$ {Decimal(str(v)):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def qualificacao(parte: dict) -> str:
    p = parte.get("pessoa") or parte
    nome = (p.get("nome") or "").upper()
    if p.get("tipo_pessoa") == "juridica":
        txt = f"{nome}, pessoa jurídica de direito privado"
        if p.get("cnpj"):
            txt += f", inscrita no CNPJ sob o nº {p['cnpj'][:2]}.{p['cnpj'][2:5]}.{p['cnpj'][5:8]}/{p['cnpj'][8:12]}-{p['cnpj'][12:]}"
    else:
        attrs = [p.get("nacionalidade") or "brasileiro(a)", _ESTADO_CIVIL.get(p.get("estado_civil") or "", None),
                 "convivente em união estável" if p.get("uniao_estavel") else None, p.get("profissao")]
        txt = ", ".join([nome, *[a for a in attrs if a]])
        if p.get("cpf"):
            c = p["cpf"]
            txt += f", inscrito(a) no CPF sob o nº {c[:3]}.{c[3:6]}.{c[6:9]}-{c[9:]}"
    if not (p.get("cpf") or p.get("cnpj")) and p.get("justificativa_sem_documento"):
        txt += f" (CPF/CNPJ não informado: {p['justificativa_sem_documento']})"
    end = next(iter(p.get("enderecos") or []), None)
    if end:
        cep = end.get("cep") or ""
        txt += (f", com endereço na {end.get('logradouro', '')}, nº {end.get('numero') or 'S/N'}"
                f"{', ' + end['complemento'] if end.get('complemento') else ''}, {end.get('bairro', '')}, {end.get('cidade', '')}/"
                f"{end.get('uf', '')}, CEP {cep[:5]}-{cep[5:]}")
    if p.get("email"):
        txt += f", e-mail {p['email']}"
    return txt


def texto_da_peca(prot, advogado: Usuario, oab: str) -> list[tuple[str, str]]:
    """[(estilo, texto)] — estilos: titulo, paragrafo, subtitulo, item, assinatura."""
    c = prot.cabecalho or {}
    cp = prot.conteudo_peca or {}
    linhas: list[tuple[str, str]] = []
    linhas.append(("titulo", (cp.get("enderecamento") or "EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO").upper()))
    ativos = [p for p in prot.partes if p.get("polo") == "ativo"]
    passivos = [p for p in prot.partes if p.get("polo") == "passivo"]
    if prot.tipo == "inicial":
        quali_a = "; ".join(qualificacao(p) for p in ativos)
        quali_p = "; ".join(qualificacao(p) for p in passivos)
        acao = (c.get("classe_nome") or "AÇÃO").upper()
        linhas.append(("paragrafo", f"{quali_a}, por seu advogado que esta subscreve (procuração anexa), vem respeitosamente propor a "
                                    f"presente {acao} em face de {quali_p or '(procedimento sem réu)'}, pelos fatos e fundamentos a seguir."))
    else:
        linhas.append(("paragrafo", f"Processo nº {cnj.formatar(prot.numero_cnj or '')}"))
        linhas.append(("paragrafo", cp.get("abertura") or "A parte, por seu advogado, vem respeitosamente expor e requerer o que segue."))
    for chave, titulo in (("fatos", "DOS FATOS"), ("fundamentos_juridicos", "DO DIREITO")):
        if cp.get(chave):
            linhas.append(("subtitulo", titulo))
            linhas += [("paragrafo", par.strip()) for par in str(cp[chave]).split("\n") if par.strip()]
    if c.get("tutela_urgencia") and cp.get("pedido_tutela"):
        linhas.append(("subtitulo", "DA TUTELA DE URGÊNCIA"))
        linhas += [("paragrafo", par.strip()) for par in str(cp["pedido_tutela"]).split("\n") if par.strip()]
    if c.get("justica_gratuita_requerida"):
        linhas.append(("subtitulo", "DA GRATUIDADE DA JUSTIÇA"))
        linhas.append(("paragrafo", "Requer os benefícios da gratuidade da justiça (CPC, art. 98), conforme declaração anexa."))
    pedidos = cp.get("pedidos") or []
    if pedidos:
        linhas.append(("subtitulo", "DOS PEDIDOS"))
        linhas += [("item", f"{chr(97 + i)}) {ped}") for i, ped in enumerate(pedidos[:26])]
    if prot.tipo == "inicial":
        provas = cp.get("provas") or ["documental", "testemunhal", "pericial", "depoimento pessoal"]
        linhas.append(("paragrafo", f"Protesta provar o alegado por todos os meios admitidos, especialmente: {', '.join(provas)}."))
        opcao = c.get("audiencia_conciliacao")
        linhas.append(("paragrafo", "O autor manifesta interesse na audiência de conciliação ou de mediação (CPC, art. 319, VII)."
                       if opcao == "deseja" else "O autor não tem interesse na audiência de conciliação ou de mediação (CPC, art. 319, VII)."))
        if c.get("valor_causa") not in (None, ""):
            linhas.append(("paragrafo", f"Dá-se à causa o valor de {_moeda(c['valor_causa'])} ({valor_por_extenso(c['valor_causa'])})."))
    linhas.append(("paragrafo", "Termos em que pede deferimento."))
    hoje = date.today()
    local = cp.get("local") or (advogado.cidade or "")
    linhas.append(("paragrafo", f"{local + ', ' if local else ''}{hoje.day} de {_MESES[hoje.month - 1]} de {hoje.year}."))
    linhas.append(("assinatura", f"{advogado.nome}\nOAB/{oab}"))
    return linhas


def gerar_pdf(prot, advogado: Usuario, oab: str) -> bytes:
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer
    from xml.sax.saxutils import escape

    estilos = {
        "titulo": ParagraphStyle("t", fontName="Times-Bold", fontSize=12, leading=16, alignment=TA_JUSTIFY, spaceAfter=36),
        "subtitulo": ParagraphStyle("s", fontName="Times-Bold", fontSize=12, leading=16, spaceBefore=12, spaceAfter=8),
        "paragrafo": ParagraphStyle("p", fontName="Times-Roman", fontSize=12, leading=18, alignment=TA_JUSTIFY, firstLineIndent=2 * cm,
                                    spaceAfter=8),
        "item": ParagraphStyle("i", fontName="Times-Roman", fontSize=12, leading=18, leftIndent=1.5 * cm, alignment=TA_JUSTIFY, spaceAfter=4),
        "assinatura": ParagraphStyle("a", fontName="Times-Roman", fontSize=12, leading=16, alignment=TA_CENTER, spaceBefore=36),
    }
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=3 * cm, rightMargin=2 * cm, topMargin=3 * cm, bottomMargin=2 * cm,
                            title=prot.titulo or "Petição", author=advogado.nome)
    fluxo = []
    for estilo, texto in texto_da_peca(prot, advogado, oab):
        fluxo.append(Paragraph(escape(texto).replace("\n", "<br/>"), estilos[estilo]))
        if estilo == "titulo":
            fluxo.append(Spacer(1, 12))
    doc.build(fluxo)
    return buf.getvalue()


SISTEMA_IA = ("Você é advogado(a) brasileiro(a) experiente. Redija em português formal e técnico, citando apenas dispositivos "
              "legais que você tem certeza que existem (CPC, CC, CDC, CLT, CF). Não invente jurisprudência nem números de "
              "processo. Responda só JSON.")


def prompt_redigir(prot, briefing: str) -> str:
    c = prot.cabecalho or {}
    partes = "; ".join(f"{p.get('polo')}: {(p.get('pessoa') or p).get('nome')}" for p in prot.partes)
    return (f"Tipo: {prot.tipo}. Classe: {c.get('classe_nome') or '-'}. Tribunal: {prot.tribunal.sigla}. Partes: {partes or '-'}.\n"
            f"Tutela de urgência: {'sim' if c.get('tutela_urgencia') else 'não'}. Valor da causa: {c.get('valor_causa') or '-'}.\n"
            f"Relato do advogado:\n{briefing}\n\n"
            'Devolva {"enderecamento": str, "abertura": str ou null (só petição intermediária: o parágrafo de abertura), '
            '"fatos": str (parágrafos separados por \\n), "fundamentos_juridicos": str, "pedidos": [str], '
            '"pedido_tutela": str ou null, "provas": [str], "local": str ou null (cidade do foro)}')
