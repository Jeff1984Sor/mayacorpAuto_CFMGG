"""PDF da NFS-e.

Prefeitura de São Paulo: a preferência é o PDF oficial que o portal publica em notaprintpdf.aspx (o mesmo do
botão "Imprimir"); se o portal não responder, fica o PDF próprio com a marca do cliente e QR para a versão oficial.

Sistema Nacional: o PDF próprio é desenhado a partir do XML autorizado (`nfse_nacional/leitura.py`), e não do
cadastro; a busca do DANFSe oficial fica em `nfse_nacional/danfse.py`.
"""

from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from app.core.documentos import formatar_documento, so_digitos
from app.core.models import Identidade
from app.modules.rpa_nfse import qr
from app.modules.rpa_nfse.models import Nfse
from app.modules.rpa_nfse.nfse_nacional import leitura

# Streams só comprimidos (sem ASCII85): o codificador ASCII85 em Python puro era o maior custo por PDF
rl_config.useA85 = 0

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
    if getattr(nota, "chave_acesso", None):
        return _gerar_nacional(nota, identidade, link)
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
    tam = 26 * mm
    qr.desenhar(c, link, w - m - tam + 2 * mm, y - 24 * mm, tam)

    # ---- Rodapé
    c.setFillColor(CINZA)
    c.setFont("Helvetica", 7)
    c.drawString(m, 16 * mm, "Consulte a autenticidade em nfe.prefeitura.sp.gov.br ou pelo QR Code.")
    c.drawString(m, 12 * mm, link[:120])
    c.setFillColor(INDIGO)
    c.drawRightString(w - m, 12 * mm, "Uma solução MayaCorp")

    if nota.simulada:
        _marca_de_simulacao(c, w, h)

    c.showPage()
    c.save()
    return buf.getvalue()


def _marca_de_simulacao(c: canvas.Canvas, w: float, h: float) -> None:
    c.saveState()
    c.setFillColor(colors.Color(0.79, 0.26, 0.26, alpha=0.12))
    c.setFont("Helvetica-Bold", 60)
    c.translate(w / 2, h / 2)
    c.rotate(35)
    c.drawCentredString(0, 0, "SIMULAÇÃO")
    c.setFont("Helvetica-Bold", 18)
    c.drawCentredString(0, -24, "sem valor fiscal")
    c.restoreState()


# ---------------------------------------------------------------------------------------------- Sistema Nacional
# Muda quando o desenho muda: o PDF guardado com um número menor é refeito na próxima vez que alguém o pedir
# (nfse_nacional/danfse.py).
LAYOUT_NACIONAL = 2


def _caber(texto: str | None, fonte: str, tam: float, largura: float) -> str:
    """O texto inteiro se couber na largura; senão, cortado com reticências."""
    texto = " ".join((texto or "").split())
    if stringWidth(texto, fonte, tam) <= largura:
        return texto
    while texto and stringWidth(texto + "…", fonte, tam) > largura:
        texto = texto[:-1]
    return texto.rstrip() + "…"


def _dec(v) -> Decimal | None:
    try:
        return Decimal(str(v)) if v not in (None, "") else None
    except InvalidOperation:
        return None


def _telefone(v: str | None) -> str:
    d = so_digitos(v)
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return (v or "").strip()


def _municipio(nome: str | None, uf: str | None, codigo: str | None) -> str:
    """"Sorocaba / SP". O XML só traz o nome de alguns municípios: sem ele, vai o código IBGE."""
    nome, uf = (nome or "").strip(), (uf or "").strip() or leitura.uf_do_municipio(codigo)
    if nome:
        return f"{nome} / {uf}" if uf else nome
    if codigo:
        return f"IBGE {codigo} / {uf}" if uf else f"IBGE {codigo}"
    return uf


def _junta(*partes) -> str:
    return ", ".join(str(p).strip() for p in partes if p and str(p).strip())


def dados_nacional(nota: Nfse) -> dict:
    """O que vai impresso na nota do Sistema Nacional. Vale o XML autorizado; o cadastro só completa o que o XML
    não tem (na simulação o arquivo guardado é a DPS, sem os campos que o governo acrescenta)."""
    from app.modules.rpa_nfse.nfse_nacional import dps as D

    rps, em = nota.rps, nota.emissora
    cad = (rps.dados_json or {}).get("tomador", {}) or {}
    x: dict = {}
    if nota.xml_path and Path(nota.xml_path).exists():
        x = leitura.ler(Path(nota.xml_path).read_bytes())
    g = x.get
    nomes = dict(g("municipios") or {})
    e, p = g("emitente") or {}, g("prestador") or {}
    if e:  # nota autorizada: nome e endereço do prestador são os que o governo gravou
        cod = e["codigo_municipio"] or g("codigo_emissao")
        prest = {"nome": e["nome"] or em.razao_social, "documento": e["documento"] or em.cnpj, "im": p.get("im", ""),
                 "telefone": e["telefone"] or p.get("telefone", ""), "email": e["email"] or p.get("email", ""),
                 "endereco": _junta(e["logradouro"], e["numero"], e["complemento"], e["bairro"]),
                 "municipio": _municipio(nomes.get(cod), e["uf"], cod), "cep": e["cep"]}
    else:
        nomes.setdefault(so_digitos(em.codigo_municipio), em.cidade or "")
        prest = {"nome": em.razao_social, "documento": em.cnpj, "im": em.ccm, "telefone": em.telefone, "email": em.email,
                 "endereco": _junta(em.logradouro, em.numero, em.complemento, em.bairro),
                 "municipio": _municipio(em.cidade, em.uf, so_digitos(em.codigo_municipio)), "cep": em.cep}
    t = g("tomador")
    if t:
        cod = t["codigo_municipio"]
        cod_cad = so_digitos(cad.get("codigo_municipio"))
        cidade = nomes.get(cod) or (cad.get("cidade") if not cod_cad or cod_cad == cod else "")
        toma = {"nome": t["nome"], "documento": t["documento"], "im": t["im"], "telefone": t["telefone"], "email": t["email"],
                "endereco": _junta(t["logradouro"], t["numero"], t["complemento"], t["bairro"]),
                "municipio": _municipio(cidade, t["uf"], cod), "cep": t["cep"]}
    elif x:
        toma = None  # a nota saiu sem tomador
    else:
        toma = {"nome": cad.get("nome"), "documento": cad.get("cpf_cnpj"), "im": "", "telefone": cad.get("telefone"),
                "email": cad.get("email"),
                "endereco": _junta(cad.get("logradouro"), cad.get("numero"), cad.get("complemento"), cad.get("bairro")),
                "municipio": _municipio(cad.get("cidade"), cad.get("uf"), so_digitos(cad.get("codigo_municipio"))),
                "cep": cad.get("cep")}

    regime = em.regime.value if hasattr(em.regime, "value") else str(em.regime)
    simples = g("simples") or ("" if x else D.OPCAO_DO_REGIME.get(regime, ""))
    aliquota, issqn = _dec(g("aliquota")), _dec(g("issqn"))
    if not x:  # sem XML nenhum (nota recuperada sem o arquivo): o que foi calculado no recibo
        aliquota = Decimal(rps.aliquota) * 100 if rps.aliquota else None
        issqn = Decimal(rps.iss) if rps.iss else None
    retencao = leitura.RETENCAO_ISSQN.get(g("retencao_issqn") or "") or (
        "" if x else "Retido pelo tomador" if rps.iss_retido else "Não retido")
    explicacao = ""
    if aliquota is None and issqn is None:
        if simples == D.MEI:
            explicacao = ("Prestador MEI: o ISSQN é recolhido em valor fixo mensal no DAS do Simples Nacional, "
                          "por isso a nota não destaca alíquota nem valor do imposto.")
        elif simples == D.ME_EPP and (g("apuracao_sn") or "1") == "1":
            explicacao = "ISSQN recolhido pelo Simples Nacional (DAS): a nota não destaca alíquota nem valor do imposto."
    cod_trib = g("tributacao_nacional") or so_digitos(em.cod_trib_nacional)
    return {
        "numero": nota.numero, "chave": nota.chave_acesso,
        "competencia": leitura.formatar_data(g("competencia")) or (f"{rps.data_emissao:%d/%m/%Y}" if rps.data_emissao else ""),
        "emitida_em": leitura.formatar_data_hora(g("processada_em")) or f"{nota.data_emissao:%d/%m/%Y %H:%M}",
        "numero_dps": g("numero_dps") or str(rps.numero or ""), "serie": g("serie") or str(rps.serie or ""),
        "dps_emitida_em": leitura.formatar_data_hora(g("dps_emitida_em")),
        "municipio_emissor": _municipio(nomes.get(g("codigo_emissao")), "", g("codigo_emissao")) if x else prest["municipio"],
        "ambiente": {"1": "Produção", "2": "Homologação (sem valor fiscal)"}.get(g("ambiente") or "", ""),
        "prestador": prest, "tomador": toma,
        "codigo_tributacao": " — ".join(v for v in (leitura.formatar_tributacao(cod_trib), g("descricao_tributacao")) if v),
        "tributacao_municipal": g("tributacao_municipal") or "", "nbs": g("nbs") or "",
        "local_prestacao": _municipio(nomes.get(g("codigo_prestacao")), "", g("codigo_prestacao")),
        "discriminacao": g("descricao") or rps.discriminacao or "",
        "regime": leitura.SIMPLES.get(simples, ""), "apuracao_sn": leitura.APURACAO_SN.get(g("apuracao_sn") or "", ""),
        "regime_especial": leitura.REGIME_ESPECIAL.get(g("regime_especial") or "", ""),
        "tributacao_issqn": leitura.TRIBUTACAO_ISSQN.get(g("tributacao_issqn") or "", ""), "retencao_issqn": retencao,
        "incidencia": _municipio(g("municipio_incidencia"), "", g("codigo_incidencia")),
        "base_calculo": _dec(g("base_calculo")), "aliquota": aliquota, "issqn": issqn, "explicacao_iss": explicacao,
        "ibs_cbs": " / ".join(v for v in (g("cst_ibscbs"), g("class_trib")) if v),
        "valor_servico": _dec(g("valor_servico")) or Decimal(nota.valor),
        "desconto": _dec(g("desconto_incondicionado")), "retencoes": _dec(g("retencoes")),
        "valor_liquido": _dec(g("valor_liquido")),
    }


def _gerar_nacional(nota: Nfse, identidade: Identidade | None, link: str) -> bytes:
    d = dados_nacional(nota)
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    m = 16 * mm
    util = w - 2 * m - 8 * mm  # largura de texto dentro de um bloco
    destaque = colors.HexColor(identidade.cor_destaque) if identidade and identidade.cor_destaque else NAVY
    c.setTitle(f"NFS-e {nota.numero}")

    # ---- Faixa de topo: nome à esquerda, número à direita, subtítulo embaixo. Nada divide a linha com a chave.
    c.setFillColor(destaque)
    c.rect(0, h - 26 * mm, w, 26 * mm, stroke=0, fill=1)
    x_txt = m
    if identidade and identidade.logo_path and Path(identidade.logo_path).exists():
        try:
            img = ImageReader(identidade.logo_path)
            iw, ih = img.getSize()
            alt = 15 * mm
            larg = min(alt * iw / ih, 45 * mm)
            c.drawImage(img, m, h - 21 * mm, larg, alt, mask="auto", preserveAspectRatio=True)
            x_txt = m + larg + 6 * mm
        except Exception:
            pass
    c.setFillColor(colors.white)
    numero = f"Nº {nota.numero:08d}"
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(w - m, h - 13 * mm, numero)
    livre = w - m - stringWidth(numero, "Helvetica-Bold", 20) - 6 * mm - x_txt
    nome = identidade.nome_exibicao if identidade else d["prestador"]["nome"]
    c.setFont("Helvetica-Bold", 15)
    c.drawString(x_txt, h - 12 * mm, _caber(nome, "Helvetica-Bold", 15, livre))
    subtitulo = "NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e · Sistema Nacional NFS-e"
    tam = next((t for t in (9, 8, 7) if stringWidth(subtitulo, "Helvetica", t) <= w - m - x_txt), 7)
    c.setFont("Helvetica", tam)
    c.drawString(x_txt, h - 19 * mm, _caber(subtitulo, "Helvetica", tam, w - m - x_txt))

    # ---- Chave de acesso: 50 dígitos numa linha só dela
    c.setFillColor(FUNDO)
    c.rect(0, h - 36 * mm, w, 10 * mm, stroke=0, fill=1)
    c.setFillColor(CINZA)
    c.setFont("Helvetica", 6.5)
    c.drawString(m, h - 29.5 * mm, "CHAVE DE ACESSO DA NFS-e")
    c.setFillColor(colors.black)
    c.setFont("Courier-Bold", 10.5)
    c.drawString(m, h - 34 * mm, d["chave"] or "")

    y = h - 39 * mm
    TIT, LIN, VAO = 6.5 * mm, 8.6 * mm, 3 * mm

    def limpar(linhas: list[list[tuple]]) -> list[list[tuple]]:
        """Campo sem valor não aparece; linha que ficou vazia some."""
        return [linha for linha in ([cel for cel in ln if (cel[1] or "").strip()] for ln in linhas) if linha]

    def altura(linhas: list, notas: list[str] | tuple = ()) -> float:
        return TIT + len(linhas) * LIN + (len(notas) * 3.6 * mm + 1.5 * mm if notas else 0) + 1 * mm

    def moldura(titulo: str, alt: float, fundo=FUNDO) -> None:
        c.setFillColor(fundo)
        c.setStrokeColor(LINHA)
        c.roundRect(m, y - alt, w - 2 * m, alt, 3 * mm, stroke=1, fill=1)
        c.setFillColor(destaque)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(m + 4 * mm, y - 4.6 * mm, titulo.upper())

    def campos(linhas: list[list[tuple]], yy: float) -> float:
        """Grade de 4 colunas: cada campo é (rótulo, valor, colunas); o último da linha ocupa o que sobrar."""
        for linha in linhas:
            xx, usadas = m + 4 * mm, 0
            for i, (rot, val, col) in enumerate(linha):
                col = 4 - usadas if i == len(linha) - 1 else col
                c.setFillColor(CINZA)
                c.setFont("Helvetica", 6.5)
                c.drawString(xx, yy, rot)
                c.setFillColor(colors.black)
                c.setFont("Helvetica-Bold", 8.5)
                c.drawString(xx, yy - 3.8 * mm, _caber(val, "Helvetica-Bold", 8.5, util / 4 * col - 3 * mm))
                xx += util / 4 * col
                usadas += col
            yy -= LIN
        return yy

    def bloco(titulo: str, linhas: list[list[tuple]], notas: list[str] | tuple = ()) -> None:
        nonlocal y
        moldura(titulo, altura(linhas, notas))
        yy = campos(linhas, y - TIT - 2.4 * mm)
        c.setFillColor(CINZA)
        c.setFont("Helvetica-Oblique", 7.5)
        for txt in notas:
            c.drawString(m + 4 * mm, yy - 0.3 * mm, txt)
            yy -= 3.6 * mm
        y -= altura(linhas, notas) + VAO

    def pessoa(p: dict | None, vazio: str) -> list[list[tuple]]:
        if p is None:
            return [[("", vazio, 4)]]
        return limpar([
            [("Nome / Razão social", p["nome"], 2), ("CPF / CNPJ", formatar_documento(p["documento"]), 1),
             ("Inscrição municipal", p["im"], 1)],
            [("Endereço", p["endereco"], 2), ("Município / UF", p["municipio"], 1), ("CEP", leitura.formatar_cep(p["cep"]), 1)],
            [("E-mail", p["email"], 2), ("Telefone", _telefone(p["telefone"]), 2)],
        ])

    def pct(v: Decimal | None) -> str:
        return f"{v:.2f}%".replace(".", ",") if v is not None else ""

    def reais(v: Decimal | None) -> str:
        return brl(v) if v else ""

    identificacao = limpar([
        [("Número da NFS-e", str(d["numero"]), 1), ("Competência", d["competencia"], 1),
         ("Emissão da NFS-e", d["emitida_em"], 1), ("Município emissor", d["municipio_emissor"], 1)],
        [("Número da DPS", d["numero_dps"], 1), ("Série da DPS", d["serie"], 1),
         ("Emissão da DPS", d["dps_emitida_em"], 1), ("Ambiente", d["ambiente"], 1)],
    ])
    prestador = pessoa(d["prestador"], "")
    tomador = pessoa(d["tomador"], "Tomador não identificado na NFS-e")
    servico = limpar([[("Local da prestação", d["local_prestacao"], 2),
                       ("Código de tributação municipal", d["tributacao_municipal"], 1), ("NBS", d["nbs"], 1)]])
    tributos = limpar([
        [("Regime tributário do prestador", d["regime"], 2), ("Regime de apuração (Simples Nacional)", d["apuracao_sn"], 2)],
        [("Tributação do ISSQN", d["tributacao_issqn"], 1), ("Retenção do ISSQN", d["retencao_issqn"], 1),
         ("Município de incidência do ISSQN", d["incidencia"], 1), ("Regime especial de tributação", d["regime_especial"], 1)],
        [("Base de cálculo do ISSQN", brl(d["base_calculo"]) if d["base_calculo"] is not None else "", 1),
         ("Alíquota do ISSQN", pct(d["aliquota"]), 1),
         ("ISSQN", brl(d["issqn"]) if d["issqn"] is not None else "", 1), ("IBS/CBS — CST / cClassTrib", d["ibs_cbs"], 1)],
        [("Desconto incondicionado", reais(d["desconto"]), 1), ("Total de retenções", reais(d["retencoes"]), 1)],
    ])
    notas_iss = simpleSplit(d["explicacao_iss"], "Helvetica-Oblique", 7.5, util) if d["explicacao_iss"] else []

    # ---- o serviço ocupa o espaço que sobra entre os blocos de cima e os de baixo
    FAIXA, PE = 22 * mm, 24 * mm
    codigo = simpleSplit(d["codigo_tributacao"], "Helvetica-Bold", 8.5, util)[:2]
    alt_codigo = 3.8 * mm + len(codigo) * 4 * mm + 1.2 * mm if codigo else 0
    fixo_servico = TIT + 2.4 * mm + alt_codigo + len(servico) * LIN + 4 * mm + 2 * mm
    outros = altura(identificacao) + altura(prestador) + altura(tomador) + altura(tributos, notas_iss) + 4 * VAO
    cabem = max(3, int((y - outros - fixo_servico - VAO - FAIXA - PE) // (4 * mm)))
    texto: list[str] = []
    for par in d["discriminacao"].split("\n"):
        texto += simpleSplit(par, "Helvetica", 8.5, util) or [""]
    if len(texto) > cabem:
        texto = texto[:cabem]
        texto[-1] = _caber(texto[-1] + " …", "Helvetica", 8.5, util)

    bloco("Identificação da nota", identificacao)
    bloco("Prestador de serviços", prestador)
    bloco("Tomador de serviços", tomador)

    alt = fixo_servico + max(len(texto), 3) * 4 * mm
    moldura("Serviço prestado", alt, colors.white)
    yy = y - TIT - 2.4 * mm
    if codigo:
        c.setFillColor(CINZA)
        c.setFont("Helvetica", 6.5)
        c.drawString(m + 4 * mm, yy, "Código de tributação nacional")
        c.setFillColor(colors.black)
        c.setFont("Helvetica-Bold", 8.5)
        yy -= 3.8 * mm
        for i, ln in enumerate(codigo):
            c.drawString(m + 4 * mm, yy, ln if i < len(codigo) - 1 else _caber(ln, "Helvetica-Bold", 8.5, util))
            yy -= 4 * mm
        yy -= 1.2 * mm
    yy = campos(servico, yy)
    c.setFillColor(CINZA)
    c.setFont("Helvetica", 6.5)
    c.drawString(m + 4 * mm, yy, "Discriminação dos serviços")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8.5)
    yy -= 4 * mm
    for ln in texto:
        c.drawString(m + 4 * mm, yy, ln)
        yy -= 4 * mm
    y -= alt + VAO

    bloco("Tributação", tributos, notas_iss)

    # ---- Total + QR
    c.setFillColor(destaque)
    c.roundRect(m, y - FAIXA, w - 2 * m - 26 * mm, FAIXA, 3 * mm, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica", 9)
    c.drawString(m + 5 * mm, y - 8 * mm, "VALOR TOTAL DA NOTA")
    if d["valor_liquido"] is not None:
        c.drawString(m + 80 * mm, y - 8 * mm, "VALOR LÍQUIDO")
    c.setFont("Helvetica-Bold", 17)
    c.drawString(m + 5 * mm, y - 16.5 * mm, brl(d["valor_servico"]))
    if d["valor_liquido"] is not None:
        c.drawString(m + 80 * mm, y - 16.5 * mm, brl(d["valor_liquido"]))
    qr.desenhar(c, link, w - m - FAIXA, y - FAIXA, FAIXA)

    # ---- Rodapé
    c.setFillColor(CINZA)
    c.setFont("Helvetica", 7)
    c.drawString(m, 16 * mm, "Consulte a autenticidade em www.nfse.gov.br/ConsultaPublica com a chave de acesso acima.")
    c.drawString(m, 12 * mm, link[:120])
    c.setFillColor(INDIGO)
    c.drawRightString(w - m, 12 * mm, "Uma solução MayaCorp")

    if nota.simulada:
        _marca_de_simulacao(c, w, h)

    c.showPage()
    c.save()
    return buf.getvalue()
