"""DANFSe v2.0: o documento auxiliar da NFS-e no leiaute da Nota Técnica SE/CGNFS-e nº 008 (v1.02, 14/07/2026).

Desde 03/08/2026 o governo não gera mais o DANFSe por API: quem emite a nota desenha o documento, no modelo do
Anexo I da nota técnica. Regras seguidas aqui:

- só entra o que está no XML da NFS-e (item 2.1); campo sem informação vai com um traço (nota 12);
- blocos, ordem e rótulos do Anexo I; posições e alturas da tabela 2.4.5 (em centímetros, a partir do canto
  superior esquerdo da folha A4);
- tomador, destinatário e intermediário ausentes viram uma linha só (notas 2 e 3), assim como a tributação
  municipal de operação sem incidência do ISSQN (nota 4); o espaço ganho vai para a descrição do serviço e para
  as informações complementares (item 2.3);
- QR Code da consulta pública com a chave de acesso; "NFS-e SEM VALIDADE JURÍDICA" em nota de homologação;
  marca d'água "CANCELADA" em nota cancelada;
- sem logo nem marca do escritório ou do sistema: o modelo não tem lugar para isso;
- o canhoto (opcional, nota 11) não é impresso.

Fontes: a nota técnica pede Arial (rótulos) e Microsoft Sans Serif (conteúdo), que não podem ser distribuídas com
o sistema; vai Helvetica, que tem as mesmas medidas da Arial.
"""

from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader, simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from app.core.documentos import formatar_documento, so_digitos
from app.modules.rpa_nfse import qr
from app.modules.rpa_nfse.models import Nfse
from app.modules.rpa_nfse.nfse_nacional import leitura

CONSULTA = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave="  # item 2.4.3: endereço do QR Code + chave de acesso
LOGO = Path(__file__).parent / "logo_nfse.png"  # logomarca oficial da NFS-e (gov.br/nfse › logos da NFS-e)
ROTULO, CONTEUDO = "Helvetica-Bold", "Helvetica"
X = (0.30, 5.41, 10.51, 15.62)  # início das quatro colunas (cm)
FIM, PE = 20.70, 29.40  # borda direita e borda inferior do corpo
LIN = 0.645  # altura da linha de campos; a da identificação e a do valor total é um pouco maior
SOMBRA = colors.Color(0.95, 0.95, 0.95)  # cinza claro, 5%
VAZIO = "-"


def url_consulta(chave: str | None) -> str:
    return CONSULTA + (chave or "")


def _caber(texto: str | None, fonte: str, tam: float, largura: float) -> str:
    """O texto inteiro se couber na largura; senão, cortado com reticências."""
    texto = " ".join((texto or "").split())
    if stringWidth(texto, fonte, tam) <= largura:
        return texto
    while texto and stringWidth(texto + "...", fonte, tam) > largura:
        texto = texto[:-1]
    return texto.rstrip() + "..."


def _dec(v) -> Decimal | None:
    try:
        return Decimal(str(v)) if v not in (None, "") else None
    except InvalidOperation:
        return None


def _reais(v) -> str:
    v = _dec(v)
    if v is None:
        return VAZIO
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _pct(v) -> str:
    v = _dec(v)
    return VAZIO if v is None else f"{v:.2f}%".replace(".", ",")


def _telefone(v: str | None) -> str:
    d = so_digitos(v)
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return (v or "").strip()


def _barras(*partes) -> str:
    """Campos concatenados do leiaute ("Município / UF"): só as partes que existem; nenhuma, o traço."""
    return " / ".join(str(p).strip() for p in partes if p and str(p).strip()) or VAZIO


def _junta(*partes) -> str:
    return ", ".join(str(p).strip() for p in partes if p and str(p).strip())


def _pessoa(p: dict | None, nomes: dict, cidade_do_cadastro: str = "") -> dict | None:
    """Os campos de um bloco de pessoa, já no formato do DANFSe."""
    if p is None:
        return None
    cod = p.get("codigo_municipio") or ""
    cidade = nomes.get(cod) or p.get("cidade_exterior") or cidade_do_cadastro
    return {
        "documento": formatar_documento(p.get("documento")) or VAZIO, "im": p.get("im") or VAZIO,
        "telefone": _telefone(p.get("telefone")) or VAZIO, "nome": p.get("nome") or VAZIO,
        "municipio": _barras(cidade, p.get("uf") or leitura.uf_do_municipio(cod)),
        "ibge_cep": _barras(cod, leitura.formatar_cep(p.get("cep")) or p.get("cep_exterior")),
        "endereco": _junta(p.get("logradouro"), p.get("numero"), p.get("complemento"), p.get("bairro")) or VAZIO,
        "email": p.get("email") or VAZIO,
    }


def dados(nota: Nfse) -> dict:
    """O que vai impresso. Vale o XML autorizado; o cadastro só completa o que o XML não tem (na simulação o
    arquivo guardado é a DPS, sem os campos que o governo acrescenta; nota recuperada pode não ter arquivo)."""
    from app.modules.rpa_nfse.nfse_nacional import dps as D

    rps, em = nota.rps, nota.emissora
    cad = (rps.dados_json or {}).get("tomador", {}) or {}
    x: dict = {}
    if nota.xml_path and Path(nota.xml_path).exists():
        x = leitura.ler(Path(nota.xml_path).read_bytes())
    g = x.get
    autorizada = bool(g("autorizada"))
    nomes = dict(g("municipios") or {})
    e, p = g("emitente") or {}, g("prestador") or {}
    if e:  # nota autorizada: nome e endereço do prestador são os que o governo gravou
        prest = {**e, "im": p.get("im") or e.get("im"), "telefone": e.get("telefone") or p.get("telefone"),
                 "email": e.get("email") or p.get("email"), "codigo_municipio": e.get("codigo_municipio") or g("codigo_emissao")}
    else:
        cod_em = so_digitos(em.codigo_municipio)
        nomes.setdefault(cod_em, em.cidade or "")
        prest = {"documento": em.cnpj, "nome": em.razao_social, "im": em.ccm, "telefone": em.telefone, "email": em.email,
                 "logradouro": em.logradouro, "numero": em.numero, "complemento": em.complemento, "bairro": em.bairro,
                 "codigo_municipio": cod_em, "uf": em.uf, "cep": em.cep}
    toma, cidade_toma = g("tomador"), ""
    if not x and cad.get("nome"):
        toma = {"documento": cad.get("cpf_cnpj"), "nome": cad.get("nome"), "telefone": cad.get("telefone"),
                "email": cad.get("email"), "logradouro": cad.get("logradouro"), "numero": cad.get("numero"),
                "complemento": cad.get("complemento"), "bairro": cad.get("bairro"),
                "codigo_municipio": so_digitos(cad.get("codigo_municipio")), "uf": cad.get("uf"), "cep": cad.get("cep")}
    if toma:  # o XML traz só o código IBGE do tomador: o nome da cidade vem do cadastro quando o código é o mesmo
        cod_cad = so_digitos(cad.get("codigo_municipio"))
        cidade_toma = cad.get("cidade") or "" if not cod_cad or cod_cad == toma.get("codigo_municipio") else ""

    regime = em.regime.value if hasattr(em.regime, "value") else str(em.regime)
    simples = g("simples") or ("" if x else D.OPCAO_DO_REGIME.get(regime, ""))
    cod_trib = g("tributacao_nacional") or so_digitos(em.cod_trib_nacional)
    ambiente = g("ambiente") or ("2" if nota.simulada else "1")
    competencia = g("competencia") or (rps.data_emissao.isoformat() if rps.data_emissao else "")
    cod_emi = g("codigo_emissao") or prest.get("codigo_municipio") or ""
    cod_prest, cod_incid = g("codigo_prestacao") or "", g("codigo_incidencia") or ""
    ret_pc = g("retencao_pis_cofins") or ""
    soma = lambda *v: sum((_dec(i) or Decimal(0) for i in v), Decimal(0)) if any(_dec(i) is not None for i in v) else None  # noqa: E731
    ibs = g("ibs_cbs") or {}
    i = ibs.get
    red = [i("red_aliq_uf"), i("red_aliq_mun"), i("red_aliq_cbs")]
    comp, tot = g("complementares") or {}, g("total_tributos") or {}
    extras = [("Inf. Cont.", comp.get("xInfComp")), ("NFS-e Subst.", g("substituida")), ("Doc. Ref.", comp.get("docRef")),
              ("Cod. Obra", comp.get("cObra")), ("Insc. Imob.", comp.get("inscImobFisc")), ("Cod. Evt.", comp.get("idAtvEvt")),
              ("Doc. Tec.", comp.get("idDocTec")), ("Núm. Ped.", comp.get("xPed")), ("Item Ped.", comp.get("xItemPed")),
              ("Inf. A. T. Mun.", g("outras_informacoes"))]
    informacoes = " | ".join(f"{r}: {' '.join(v.split())}" for r, v in extras if v)
    if len(informacoes) > 1997:
        informacoes = informacoes[:1997] + "..."
    if any(tot.get(k) for k in ("vTotTribFed", "vTotTribEst", "vTotTribMun")):
        partes = [_reais(tot.get(k)) for k in ("vTotTribFed", "vTotTribEst", "vTotTribMun")]
    else:
        partes = [_pct(tot.get(k)) for k in ("pTotTribFed", "pTotTribEst", "pTotTribMun")]
    totais = ("Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: "
              f"Federais: {partes[0]}; Estaduais: {partes[1]}; Municipais: {partes[2]}")
    if tot.get("pTotTribSN"):
        totais += f"; Simples Nacional: {_pct(tot['pTotTribSN'])}"
    descricao = g("descricao") or rps.discriminacao or ""
    return {
        "chave": g("chave") or nota.chave_acesso or "", "homologacao": ambiente == "2" or bool(nota.simulada),
        "simulacao": bool(nota.simulada) and not autorizada,  # simulação do próprio sistema: nunca foi ao governo
        "cancelada": str(getattr(nota, "status", "") or "") == "cancelada",
        "municipio": "" if cod_trib[:2] == "99" else _barras(nomes.get(cod_emi), leitura.uf_do_municipio(cod_emi)),
        "ambiente_gerador": leitura.AMBIENTE_GERADOR.get(g("ambiente_gerador") or "", VAZIO),
        "tipo_ambiente": leitura.TIPO_AMBIENTE.get(ambiente, VAZIO),
        "numero": g("numero") or str(nota.numero), "competencia": leitura.formatar_data(competencia) or VAZIO,
        "emitida_em": leitura.formatar_data_hora(g("processada_em")) or (
            VAZIO if autorizada else f"{nota.data_emissao:%d/%m/%Y %H:%M:%S}"),
        "numero_dps": g("numero_dps") or str(rps.numero or VAZIO), "serie": g("serie") or str(rps.serie or VAZIO),
        "dps_emitida_em": leitura.formatar_data_hora(g("dps_emitida_em")) or VAZIO,
        "emitente": leitura.EMITENTE.get(g("emitente_dps") or ("" if x else "1"), VAZIO),
        "situacao": leitura.SITUACAO.get(g("situacao") or "", g("situacao") or VAZIO),
        "finalidade": leitura.FINALIDADE.get(g("finalidade") or "", g("finalidade") or VAZIO),
        "prestador": _pessoa(prest, nomes),
        "simples": leitura.SIMPLES.get(simples, VAZIO), "apuracao_sn": leitura.APURACAO_SN.get(g("apuracao_sn") or "", VAZIO),
        "tomador": _pessoa(toma, nomes, cidade_toma), "destinatario": _pessoa(g("destinatario"), nomes),
        "destinatario_e_tomador": bool(g("destinatario_e_tomador")) and toma is not None,
        "intermediario": _pessoa(g("intermediario"), nomes),
        "codigo_tributacao": _barras(leitura.formatar_tributacao(cod_trib), g("tributacao_municipal")),
        "nbs": leitura.formatar_nbs(g("nbs")) or VAZIO,
        "local_prestacao": _barras(nomes.get(cod_prest), leitura.uf_do_municipio(cod_prest),
                                   g("pais_prestacao") or ("BR" if cod_prest else "")),
        "descricao_tributacao": g("descricao_tributacao") or VAZIO,
        "descricao": descricao if len(descricao) <= 1297 else descricao[:1297] + "...",
        "sem_issqn": g("tributacao_issqn") == "4",
        "tributacao_issqn": leitura.TRIBUTACAO_ISSQN.get(g("tributacao_issqn") or "", VAZIO),
        "incidencia": _barras(g("municipio_incidencia"), leitura.uf_do_municipio(cod_incid),
                              g("pais_incidencia") or ("BR" if cod_incid else "")),
        "regime_especial": leitura.REGIME_ESPECIAL.get(g("regime_especial") or "", VAZIO),
        "imunidade": leitura.IMUNIDADE.get(g("imunidade") or "", VAZIO),
        "suspensao": leitura.SUSPENSAO.get(g("suspensao") or "", VAZIO), "processo_suspensao": g("processo_suspensao") or VAZIO,
        "beneficio": leitura.BENEFICIO.get(g("beneficio") or "", VAZIO), "calculo_bm": _reais(g("calculo_bm")),
        "deducoes": _reais(soma(g("deducoes"), i("reembolso")) if g("deducoes") or i("reembolso") else None),
        "desconto_incondicionado": _reais(g("desconto_incondicionado")),
        "desconto_condicionado": _reais(g("desconto_condicionado")),
        "base_calculo": _reais(g("base_calculo")), "aliquota": _pct(g("aliquota")),
        "retencao_issqn": leitura.RETENCAO_ISSQN.get(g("retencao_issqn") or "") or (
            VAZIO if x else "Retido pelo Tomador" if rps.iss_retido else "Não Retido"),
        "issqn": _reais(g("issqn")),
        "irrf": _reais(g("irrf")), "previdencia": _reais(g("previdencia")),
        # nota técnica: com PIS/COFINS retidos (tpRetPisCofins = 1) eles somam nas contribuições retidas e zeram no débito próprio
        "contribuicoes": _reais(soma(g("csll"), g("pis"), g("cofins")) if ret_pc == "1" else g("csll")),
        "pis": _reais("0" if ret_pc == "1" else g("pis")), "cofins": _reais("0" if ret_pc == "1" else g("cofins")),
        "retencao_pis_cofins": leitura.RETENCAO_PIS_COFINS.get(ret_pc, VAZIO),
        "pis_cofins_ate_2026": not competencia or competencia[:4] <= "2026",  # nota 6
        "cst": _barras(i("cst"), i("class_trib")),
        "operacao": _barras(i("ind_op"), i("codigo_incidencia"), i("municipio_incidencia"),
                            leitura.uf_do_municipio(i("codigo_incidencia"))),
        "exclusoes": _reais(soma(g("desconto_incondicionado"), i("reembolso"), g("issqn"), g("pis"), g("cofins")) if ibs else None),
        "base_ibs": _reais(i("base_calculo")),
        "reducoes": " / ".join(_pct(v) for v in red) if any(red) else VAZIO,
        "aliq_ibs": " / ".join(_pct(v) for v in (i("aliq_uf"), i("aliq_mun"))) if i("aliq_uf") or i("aliq_mun") else VAZIO,
        "aliq_efet_mun": _pct(i("aliq_efet_mun")), "valor_ibs_mun": _reais(i("valor_mun")),
        "aliq_efet_uf": _pct(i("aliq_efet_uf")), "valor_ibs_uf": _reais(i("valor_uf")), "total_ibs": _reais(i("total_ibs")),
        "aliq_cbs": _pct(i("aliq_cbs")), "aliq_efet_cbs": _pct(i("aliq_efet_cbs")), "total_cbs": _reais(i("total_cbs")),
        "valor_servico": _reais(g("valor_servico") or nota.valor), "retencoes": _reais(g("retencoes")),
        "valor_liquido": _reais(g("valor_liquido")), "total_ibs_cbs": _reais(soma(i("total_ibs"), i("total_cbs"))),
        "valor_com_ibs_cbs": _reais(i("total_nota")),
        "informacoes": informacoes, "totais_tributos": totais,
    }


def _linhas_da_pessoa(p: dict, inscricao: bool = True) -> list[list[tuple]]:
    """As três linhas dos blocos de prestador, tomador, destinatário e intermediário: (coluna, colunas, rótulo, valor)."""
    return [
        [(1, 1, "CNPJ / CPF / NIF", p["documento"]), *([(2, 1, "Indicador Municipal (Inscrição)", p["im"])] if inscricao else []),
         (3, 1, "Telefone", p["telefone"])],
        [(0, 2, "Nome / Nome Empresarial", p["nome"]), (2, 1, "Município / Sigla UF", p["municipio"]),
         (3, 1, "Código IBGE / CEP", p["ibge_cep"])],
        [(0, 2, "Endereço", p["endereco"]), (2, 2, "E-mail", p["email"])],
    ]


def gerar(nota: Nfse) -> bytes:
    d = dados(nota)
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    altura_folha = A4[1]
    c.setTitle(f"DANFSe - NFS-e {d['numero']}")
    c.setAuthor("")

    def y(sup: float) -> float:
        return altura_folha - sup * cm

    def largura(col: int, cols: int) -> float:
        return ((X[col + cols] if col + cols < 4 else FIM) - X[col] - 0.16) * cm

    def divisoria(sup: float) -> None:
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.5)
        c.line(X[0] * cm, y(sup), FIM * cm, y(sup))

    def sombra(col: int, cols: int, sup: float, alt: float) -> None:
        c.setFillColor(SOMBRA)
        fim = X[col + cols] if col + cols < 4 else FIM
        c.rect(X[col] * cm, y(sup + alt), (fim - X[col]) * cm, alt * cm, stroke=0, fill=1)
        c.setFillColor(colors.black)

    def campo(col: int, cols: int, sup: float, rotulo: str, valor: str, tam: float = 6) -> None:
        c.setFillColor(colors.black)
        c.setFont(ROTULO, tam)
        c.drawString((X[col] + 0.08) * cm, y(sup + 0.25), rotulo)
        # texto que não cabe na célula: primeiro a letra diminui um pouco (até 5); só depois é cortado
        texto, corpo = " ".join((valor or VAZIO).split()), 7.0
        while corpo > 5.0 and stringWidth(texto, CONTEUDO, corpo) > largura(col, cols):
            corpo -= 0.25
        c.setFont(CONTEUDO, corpo)
        c.drawString((X[col] + 0.08) * cm, y(sup + 0.53), _caber(texto, CONTEUDO, corpo, largura(col, cols)))

    def bloco(titulo: str, sup: float, linhas: list[list[tuple]], alt: float = LIN, tam: float = 6) -> float:
        """Título sombreado na primeira coluna da primeira linha e os campos; devolve onde o bloco termina."""
        divisoria(sup)
        sombra(0, 1, sup, alt)
        c.setFont(ROTULO, 7)
        c.drawString((X[0] + 0.08) * cm, y(sup + 0.33), titulo)
        for n, linha in enumerate(linhas):
            for col, cols, rotulo, valor in linha:
                campo(col, cols, sup + n * alt, rotulo, valor, tam)
        return sup + len(linhas) * alt

    def aviso(texto: str, sup: float) -> float:
        """Bloco reduzido a uma linha (notas 2, 3 e 4 da nota técnica)."""
        divisoria(sup)
        c.setFont(CONTEUDO, 7)
        c.drawCentredString((X[0] + FIM) / 2 * cm, y(sup + 0.24), texto)
        return sup + 0.32

    def marca(texto: str) -> None:
        """Marca d'água na diagonal, cinza (K35), antes do conteúdo para não cobrir nada."""
        c.saveState()
        c.setFillColor(colors.Color(0.65, 0.65, 0.65))
        c.setFont(CONTEUDO, 76)
        c.translate(A4[0] / 2, altura_folha / 2)
        c.rotate(52)
        c.drawCentredString(0, -26, texto)
        c.restoreState()

    if d["cancelada"]:
        marca("CANCELADA")
    elif d["simulacao"]:
        marca("SIMULAÇÃO")

    # ---- Cabeçalho: logomarca da NFS-e, identificação do documento, município e ambiente
    sombra(0, 4, 0.30, 1.18)
    try:
        c.drawImage(ImageReader(str(LOGO)), 0.49 * cm, y(0.44 + 0.85), 4.00 * cm, 0.85 * cm, mask="auto",
                    preserveAspectRatio=True, anchor="w")
    except Exception:  # noqa: BLE001 — sem a imagem o documento sai do mesmo jeito
        pass
    centro = (X[1] + X[3]) / 2 * cm
    c.setFont(ROTULO, 9)
    passo = 0.34 if d["homologacao"] else 0.40
    base = 0.30 + (0.37 if d["homologacao"] else 0.47)
    c.drawCentredString(centro, y(base), "DANFSe v2.0")
    c.drawCentredString(centro, y(base + passo), "Documento Auxiliar da NFS-e")
    if d["homologacao"]:
        c.setFillColor(colors.Color(1, 0, 0))
        c.drawCentredString(centro, y(base + 2 * passo), "NFS-e SEM VALIDADE JURÍDICA")
        c.setFillColor(colors.black)
    c.setFont(CONTEUDO, 8)
    if d["municipio"]:
        c.drawString(X[3] * cm, y(0.66), _caber(f"Município: {d['municipio']}", CONTEUDO, 8, largura(3, 1)))
    c.setFont(CONTEUDO, 6)
    c.drawString(X[3] * cm, y(1.15), f"Ambiente Gerador: {d['ambiente_gerador']}")
    c.drawString(X[3] * cm, y(1.40), f"Tipo de Ambiente: {d['tipo_ambiente']}")

    # ---- Dados da NFS-e, com o QR Code da consulta pública à direita
    divisoria(1.48)
    campo(0, 3, 1.50, "CHAVE DE ACESSO DA NFS-E", d["chave"], 7)
    sombra(0, 1, 3.65, 0.69)
    for n, linha in enumerate((
        (("NÚMERO DA NFS-E", d["numero"]), ("COMPETÊNCIA DA NFS-E", d["competencia"]), ("DATA E HORA DA EMISSÃO DA NFS-E", d["emitida_em"])),
        (("NÚMERO DA DPS", d["numero_dps"]), ("SÉRIE DA DPS", d["serie"]), ("DATA E HORA DA EMISSÃO DA DPS", d["dps_emitida_em"])),
        (("EMITENTE DA NFS-e", d["emitente"]), ("SITUAÇÃO DA NFS-e", d["situacao"]), ("FINALIDADE", d["finalidade"])),
    )):
        for col, (rotulo, valor) in enumerate(linha):
            campo(col, 1, 2.27 + n * 0.69 + 0.03, rotulo, valor, 7)
    qr.desenhar(c, url_consulta(d["chave"]), 17.42 * cm, y(1.60 + 1.66), 1.66 * cm, margem=1)
    c.setFont(CONTEUDO, 6)
    autenticidade = ("A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da "
                     "chave de acesso no portal nacional da NFS-e")
    for n, ln in enumerate(simpleSplit(autenticidade, CONTEUDO, 6, 4.72 * cm)[:3]):
        c.drawString(15.80 * cm, y(3.36 + 0.22 + n * 0.23), ln)

    # ---- Prestador, tomador, destinatário e intermediário
    p = d["prestador"]
    sup = bloco("PRESTADOR / FORNECEDOR", 4.34, [
        *_linhas_da_pessoa(p),
        [(0, 1, "Simples Nacional na Data de Competência", d["simples"]),
         (1, 3, "Regime de Apuração Tributária pelo SN", d["apuracao_sn"])],
    ])
    if d["tomador"]:
        sup = bloco("TOMADOR / ADQUIRENTE", sup, _linhas_da_pessoa(d["tomador"]))
    else:
        sup = aviso("TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", sup)
    if d["destinatario"]:
        sup = bloco("DESTINATÁRIO DA OPERAÇÃO", sup, _linhas_da_pessoa(d["destinatario"], inscricao=False))
    elif d["destinatario_e_tomador"]:
        sup = aviso("O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO", sup)
    else:
        sup = aviso("DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", sup)
    if d["intermediario"]:
        sup = bloco("INTERMEDIÁRIO DA OPERAÇÃO", sup, _linhas_da_pessoa(d["intermediario"]))
    else:
        sup = aviso("INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e", sup)

    # ---- os blocos de baixo têm altura certa; o que sobra da folha vai para a descrição do serviço e, depois,
    #      para as informações complementares (item 2.3 da nota técnica)
    municipal = [] if d["sem_issqn"] else [
        [(1, 1, "Tipo de Tributação do ISSQN", d["tributacao_issqn"]),
         (2, 2, "Município / Sigla UF / País de Incidência do ISSQN", d["incidencia"])],
        [(0, 1, "Regime Especial de Tributação do ISSQN", d["regime_especial"]), (1, 1, "Tipo de Imunidade do ISSQN", d["imunidade"]),
         (2, 1, "Suspensão da Exigibilidade do ISSQN", d["suspensao"]), (3, 1, "Número Processo Suspensão", d["processo_suspensao"])],
        [(0, 1, "Benefício Municipal", d["beneficio"]), (1, 1, "Cálculo do BM", d["calculo_bm"]),
         (2, 1, "Total Deduções/Reduções", d["deducoes"]), (3, 1, "Desconto Incondicionado", d["desconto_incondicionado"])],
        [(0, 1, "BC ISSQN", d["base_calculo"]), (1, 1, "Alíquota Aplicada", d["aliquota"]),
         (2, 1, "Retenção do ISSQN", d["retencao_issqn"]), (3, 1, "ISSQN Apurado", d["issqn"])],
    ]
    # nota 5: a linha some quando nenhum dos seus campos tem dado no XML
    municipal = [ln for n, ln in enumerate(municipal) if n in (0, 3) or any(v != VAZIO for *_, v in ln)]
    federal = [
        [(1, 1, "IRRF", d["irrf"]), (2, 1, "Contribuição Previdenciária - Retida", d["previdencia"]),
         (3, 1, "Contribuições Sociais - Retidas", d["contribuicoes"])],
        *([[(0, 1, "PIS - Débito Apuração Própria", d["pis"]), (1, 1, "COFINS - Débito Apuração Própria", d["cofins"]),
            (2, 2, "Descrição Contrib. Sociais - Retidas", d["retencao_pis_cofins"])]] if d["pis_cofins_ate_2026"] else []),
    ]
    ibs_cbs = [
        [(1, 1, "CST / cClassTrib", d["cst"]),
         (2, 2, "Indicador de Operação / Código IBGE Incidência / Município Incidência / Sigla UF", d["operacao"])],
        [(0, 1, "Exclusões e Reduções da Base de Cálculo", d["exclusoes"]), (1, 1, "Base de Cálculo Após Exclusões e Reduções", d["base_ibs"]),
         (2, 1, "Red. Alíquota IBS / Red. Alíquota CBS", d["reducoes"]), (3, 1, "Alíquota - IBS UF / IBS Mun", d["aliq_ibs"])],
        [(0, 1, "Alíq. Efetiva Municipal - IBS", d["aliq_efet_mun"]), (1, 1, "Valor Apurado Municipal - IBS", d["valor_ibs_mun"]),
         (2, 1, "Alíq. Efetiva Estadual - IBS", d["aliq_efet_uf"]), (3, 1, "Valor Apurado Estadual - IBS", d["valor_ibs_uf"])],
        [(0, 1, "Valor Total Apurado - IBS", d["total_ibs"]), (1, 1, "Alíquota - CBS", d["aliq_cbs"]),
         (2, 1, "Alíquota Efetiva - CBS", d["aliq_efet_cbs"]), (3, 1, "Valor Total Apurado - CBS", d["total_cbs"])],
    ]
    PASSO = 0.29  # entrelinha do texto corrido (7 pontos)
    largura_texto = (FIM - X[0] - 0.16) * cm
    complementares = (simpleSplit(d["informacoes"], CONTEUDO, 7, largura_texto) if d["informacoes"] else []) + simpleSplit(
        d["totais_tributos"], CONTEUDO, 7, largura_texto)
    alt_municipal = len(municipal) * LIN if municipal else 0.32
    abaixo = alt_municipal + len(federal) * LIN + len(ibs_cbs) * LIN + 2 * 0.69 + 0.41 + len(complementares) * PASSO + 0.15
    texto: list[str] = []
    for par in d["descricao"].split("\n"):
        texto += simpleSplit(par, CONTEUDO, 7, largura_texto) or [""]
    cabem = max(1, int((PE - abaixo - (sup + LIN + 0.40) - 0.40) / PASSO))
    if len(texto) > cabem:
        texto = texto[:cabem]
        texto[-1] = _caber(texto[-1] + " ...", CONTEUDO, 7, largura_texto)

    # ---- Serviço prestado
    sup = bloco("SERVIÇO PRESTADO", sup, [[
        (1, 1, "Código de Tributação Nacional / Municipal", d["codigo_tributacao"]), (2, 1, "Código da NBS", d["nbs"]),
        (3, 1, "Local da Prestação / Sigla UF / País", d["local_prestacao"])]])
    c.setFont(CONTEUDO, 7)
    c.drawString((X[0] + 0.08) * cm, y(sup + 0.26), _caber(d["descricao_tributacao"], CONTEUDO, 7, largura_texto))
    sup += 0.40
    c.setFont(ROTULO, 6)
    c.drawString((X[0] + 0.08) * cm, y(sup + 0.22), "Descrição do Serviço")
    c.setFont(CONTEUDO, 7)
    for n, ln in enumerate(texto):
        c.drawString((X[0] + 0.08) * cm, y(sup + 0.52 + n * PASSO), ln)
    sup += max(LIN, 0.30 + len(texto) * PASSO + 0.10)

    # ---- Tributação municipal, federal e IBS/CBS
    if municipal:
        sup = bloco("TRIBUTAÇÃO MUNICIPAL (ISSQN)", sup, municipal)
    else:
        sup = aviso("TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN", sup)
    sup = bloco("TRIBUTAÇÃO FEDERAL (EXCETO CBS)", sup, federal)
    sup = bloco("TRIBUTAÇÃO IBS / CBS", sup, ibs_cbs)

    # ---- Valor total
    sombra(3, 1, sup + 0.69, 0.69)
    sup = bloco("VALOR TOTAL DA NFS-E", sup, [
        [(1, 1, "VALOR DA OPERAÇÃO / SERVIÇO", d["valor_servico"]), (2, 1, "Desconto Incondicionado", d["desconto_incondicionado"]),
         (3, 1, "Desconto Condicionado", d["desconto_condicionado"])],
        [(0, 1, "Total das Retenções (ISSQN / Federais)", d["retencoes"]), (1, 1, "VALOR LÍQUIDO DA NFS-e", d["valor_liquido"]),
         (2, 1, "Total do IBS/CBS", d["total_ibs_cbs"]), (3, 1, "VALOR LÍQUIDO DA NFS-e + IBS/CBS", d["valor_com_ibs_cbs"])],
    ], alt=0.69)

    # ---- Informações complementares: até o fim da folha
    divisoria(sup)
    c.setFont(ROTULO, 7)
    c.drawString((X[0] + 0.08) * cm, y(sup + 0.30), "INFORMAÇÕES COMPLEMENTARES")
    c.setFont(CONTEUDO, 7)
    for n, ln in enumerate(complementares):
        c.drawString((X[0] + 0.08) * cm, y(sup + 0.41 + 0.24 + n * PASSO), ln)

    # ---- borda da página (1 ponto)
    c.setLineWidth(1)
    c.setStrokeColor(colors.black)
    c.rect(X[0] * cm, y(PE), (FIM - X[0]) * cm, (PE - 0.30) * cm, stroke=1, fill=0)

    c.showPage()
    c.save()
    return buf.getvalue()
