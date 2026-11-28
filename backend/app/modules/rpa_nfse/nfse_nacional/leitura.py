"""Leitura do XML da NFS-e autorizada (o que o governo devolveu): é dele que sai o PDF da nota.

O cadastro pode estar digitado errado (cidade, por exemplo); o XML autorizado é o que vale. No modo simulado o
arquivo guardado é só a DPS: os campos que o governo acrescenta (nome do município, descrição do código de
tributação, valor líquido) ficam vazios e quem desenha o PDF completa com o cadastro.
"""

from datetime import date, datetime

from lxml import etree

NS = "http://www.sped.fazenda.gov.br/nfse"

# descrições dos XSD oficiais (tiposSimples_v1.01.xsd)
SIMPLES = {"1": "Não optante do Simples Nacional", "2": "Optante do Simples Nacional — MEI",
           "3": "Optante do Simples Nacional — ME/EPP"}
APURACAO_SN = {"1": "Tributos federais e municipal pelo Simples Nacional",
               "2": "Tributos federais pelo Simples Nacional e ISSQN por fora",
               "3": "Tributos federais e municipal por fora do Simples Nacional"}
REGIME_ESPECIAL = {"1": "Ato cooperado (cooperativa)", "2": "Estimativa", "3": "Microempresa municipal",
                   "4": "Notário ou registrador", "5": "Profissional autônomo", "6": "Sociedade de profissionais", "9": "Outros"}
TRIBUTACAO_ISSQN = {"1": "Operação tributável", "2": "Imunidade", "3": "Exportação de serviço", "4": "Não incidência"}
RETENCAO_ISSQN = {"1": "Não retido", "2": "Retido pelo tomador", "3": "Retido pelo intermediário"}

# os dois primeiros dígitos do código IBGE do município dizem a UF
UF_DO_IBGE = {"11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI",
              "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
              "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF"}


def uf_do_municipio(codigo: str | None) -> str:
    return UF_DO_IBGE.get((codigo or "")[:2], "")


def _txt(el, caminho: str) -> str:
    """Texto do elemento em `caminho` (nomes separados por "/", sem namespace), ou ""."""
    if el is None:
        return ""
    achado = el.find("/".join(f"{{{NS}}}{p}" for p in caminho.split("/")))
    return (achado.text or "").strip() if achado is not None else ""


def _primeiro(el, *caminhos: str) -> str:
    for c in caminhos:
        v = _txt(el, c)
        if v:
            return v
    return ""


def _pessoa(el) -> dict:
    """Prestador, tomador ou emitente: documento, nome, contato e endereço (dois formatos de endereço no layout)."""
    if el is None:
        return {}
    return {
        "documento": _primeiro(el, "CNPJ", "CPF", "NIF"), "nome": _txt(el, "xNome"), "im": _txt(el, "IM"),
        "telefone": _txt(el, "fone"), "email": _txt(el, "email"),
        "logradouro": _primeiro(el, "enderNac/xLgr", "end/xLgr"), "numero": _primeiro(el, "enderNac/nro", "end/nro"),
        "complemento": _primeiro(el, "enderNac/xCpl", "end/xCpl"), "bairro": _primeiro(el, "enderNac/xBairro", "end/xBairro"),
        "codigo_municipio": _primeiro(el, "enderNac/cMun", "end/endNac/cMun"),
        "uf": _txt(el, "enderNac/UF"), "cep": _primeiro(el, "enderNac/CEP", "end/endNac/CEP"),
    }


def ler(xml: bytes | None) -> dict:
    """Devolve os dados da nota num dicionário simples; {} quando não há XML legível."""
    if not xml:
        return {}
    try:
        raiz = etree.fromstring(xml)
    except etree.XMLSyntaxError:
        return {}
    nfse = raiz if etree.QName(raiz).localname == "infNFSe" else raiz.find(f".//{{{NS}}}infNFSe")
    dps = raiz if etree.QName(raiz).localname == "infDPS" else raiz.find(f".//{{{NS}}}infDPS")
    if nfse is None and dps is None:
        return {}
    d = {
        "autorizada": nfse is not None,
        # o que o governo acrescenta na nota autorizada
        "municipio_emissao": _txt(nfse, "xLocEmi"), "local_prestacao": _txt(nfse, "xLocPrestacao"),
        "municipio_incidencia": _txt(nfse, "xLocIncid"), "codigo_incidencia": _txt(nfse, "cLocIncid"),
        "numero": _txt(nfse, "nNFSe"), "processada_em": _txt(nfse, "dhProc"),
        "descricao_tributacao": _primeiro(nfse, "xTribMun", "xTribNac"), "nbs_descricao": _txt(nfse, "xNBS"),
        "valor_liquido": _txt(nfse, "valores/vLiq"), "base_calculo": _txt(nfse, "valores/vBC"),
        "aliquota": _primeiro(nfse, "valores/pAliqAplic") or _txt(dps, "valores/trib/tribMun/pAliq"),
        "issqn": _txt(nfse, "valores/vISSQN"), "retencoes": _txt(nfse, "valores/vTotalRet"),
        "emitente": _pessoa(nfse.find(f"{{{NS}}}emit")) if nfse is not None else {},
        # o que foi declarado na DPS
        "ambiente": _txt(dps, "tpAmb"), "dps_emitida_em": _txt(dps, "dhEmi"), "serie": _txt(dps, "serie"),
        "numero_dps": _txt(dps, "nDPS"), "competencia": _txt(dps, "dCompet"), "codigo_emissao": _txt(dps, "cLocEmi"),
        "prestador": _pessoa(dps.find(f"{{{NS}}}prest")) if dps is not None else {},
        "tomador": _pessoa(dps.find(f"{{{NS}}}toma")) if dps is not None and dps.find(f"{{{NS}}}toma") is not None else None,
        "simples": _txt(dps, "prest/regTrib/opSimpNac"), "apuracao_sn": _txt(dps, "prest/regTrib/regApTribSN"),
        "regime_especial": _txt(dps, "prest/regTrib/regEspTrib"),
        "codigo_prestacao": _txt(dps, "serv/locPrest/cLocPrestacao"),
        "tributacao_nacional": _txt(dps, "serv/cServ/cTribNac"), "tributacao_municipal": _txt(dps, "serv/cServ/cTribMun"),
        "nbs": _txt(dps, "serv/cServ/cNBS"), "descricao": _txt(dps, "serv/cServ/xDescServ"),
        "valor_servico": _txt(dps, "valores/vServPrest/vServ"),
        "desconto_incondicionado": _txt(dps, "valores/vDescCondIncond/vDescIncond"),
        "tributacao_issqn": _txt(dps, "valores/trib/tribMun/tribISSQN"),
        "retencao_issqn": _txt(dps, "valores/trib/tribMun/tpRetISSQN"),
        "cst_ibscbs": _txt(dps, "IBSCBS/valores/trib/gIBSCBS/CST"),
        "class_trib": _txt(dps, "IBSCBS/valores/trib/gIBSCBS/cClassTrib"),
    }
    # nome de município só existe no XML para os três códigos abaixo (emissão, prestação e incidência)
    d["municipios"] = {c: n for c, n in ((d["codigo_emissao"], d["municipio_emissao"]),
                                         (d["codigo_prestacao"], d["local_prestacao"]),
                                         (d["codigo_incidencia"], d["municipio_incidencia"])) if c and n}
    return d


def formatar_tributacao(codigo: str | None) -> str:
    """cTribNac 170201 → 17.02.01 (item, subitem e desdobro da lista nacional)."""
    c = "".join(x for x in (codigo or "") if x.isdigit())
    return f"{c[:2]}.{c[2:4]}.{c[4:]}" if len(c) == 6 else c


def formatar_cep(cep: str | None) -> str:
    c = "".join(x for x in (cep or "") if x.isdigit())
    return f"{c[:5]}-{c[5:]}" if len(c) == 8 else c


def formatar_data(iso: str | None) -> str:
    try:
        return date.fromisoformat((iso or "")[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return ""


def formatar_data_hora(iso: str | None) -> str:
    """Data e hora como vieram no XML (já no fuso de quem emitiu)."""
    try:
        return datetime.fromisoformat(iso or "").strftime("%d/%m/%Y %H:%M:%S")
    except ValueError:
        return ""
