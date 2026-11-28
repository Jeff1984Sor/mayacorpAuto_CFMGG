"""Leitura do XML da NFS-e autorizada (o que o governo devolveu): é dele que sai o DANFSe.

O cadastro pode estar digitado errado (cidade, por exemplo); o XML autorizado é o que vale. No modo simulado o
arquivo guardado é só a DPS: os campos que o governo acrescenta (nome do município, descrição do código de
tributação, valor líquido) ficam vazios e quem desenha o PDF completa com o cadastro.

As descrições dos códigos são as dos XSD oficiais (tiposSimples_v1.01.xsd), como manda a Nota Técnica
SE/CGNFS-e nº 008 ("utilizar a descrição destas opções").
"""

from datetime import date, datetime

from lxml import etree

NS = "http://www.sped.fazenda.gov.br/nfse"

SIMPLES = {"1": "Não Optante", "2": "Optante - Microempreendedor Individual (MEI)",
           "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)"}
APURACAO_SN = {"1": "Regime de apuração dos tributos federais e municipal pelo SN",
               "2": "Regime de apuração dos tributos federais pelo SN e ISSQN por fora do SN",
               "3": "Regime de apuração dos tributos federais e municipal por fora do SN"}
REGIME_ESPECIAL = {"0": "Nenhum", "1": "Ato Cooperado (Cooperativa)", "2": "Estimativa", "3": "Microempresa Municipal",
                   "4": "Notário ou Registrador", "5": "Profissional Autônomo", "6": "Sociedade de Profissionais", "9": "Outros"}
TRIBUTACAO_ISSQN = {"1": "Operação Tributável", "2": "Imunidade", "3": "Exportação de Serviço", "4": "Não Incidência"}
RETENCAO_ISSQN = {"1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário"}
EMITENTE = {"1": "Prestador", "2": "Tomador", "3": "Intermediário"}
SITUACAO = {"100": "NFS-e Gerada", "102": "NFS-e de Decisão Judicial", "103": "NFS-e Avulsa", "107": "NFS-e MEI"}
FINALIDADE = {"0": "NFS-e regular"}
AMBIENTE_GERADOR = {"1": "Prefeitura", "2": "Sistema Nacional da NFS-e"}
TIPO_AMBIENTE = {"1": "Produção", "2": "Homologação"}
IMUNIDADE = {"0": "Imunidade (tipo não informado na nota de origem)", "1": "Patrimônio, renda ou serviços, uns dos outros",
             "2": "Templos de qualquer culto",
             "3": "Patrimônio, renda ou serviços dos partidos políticos, entidades sindicais e instituições sem fins lucrativos",
             "4": "Livros, jornais, periódicos e o papel destinado a sua impressão",
             "5": "Fonogramas e videofonogramas musicais produzidos no Brasil"}
SUSPENSAO = {"1": "Exigibilidade Suspensa por Decisão Judicial", "2": "Exigibilidade Suspensa por Processo Administrativo"}
BENEFICIO = {"1": "Isenção", "2": "Redução da BC em %", "3": "Redução da BC em R$", "4": "Alíquota Diferenciada"}
RETENCAO_PIS_COFINS = {"0": "PIS/COFINS/CSLL Não Retidos", "1": "PIS/COFINS Retidos", "2": "PIS/COFINS Não Retidos",
                       "3": "PIS/COFINS/CSLL Retidos", "4": "PIS/COFINS Retidos, CSLL Não Retido",
                       "5": "PIS Retido, COFINS/CSLL Não Retido", "6": "COFINS Retido, PIS/CSLL Não Retido",
                       "7": "PIS Não Retido, COFINS/CSLL Retidos", "8": "PIS/COFINS Não Retidos, CSLL Retido",
                       "9": "COFINS Não Retido, PIS/CSLL Retidos"}

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


def _dentro(el, nome: str) -> str:
    """Texto do primeiro elemento `nome` em qualquer nível abaixo de `el` (para grupos de aninhamento variável)."""
    if el is None:
        return ""
    achado = el.find(f".//{{{NS}}}{nome}")
    return (achado.text or "").strip() if achado is not None else ""


def _filho(el, nome: str):
    return el.find(f"{{{NS}}}{nome}") if el is not None else None


def _pessoa(el) -> dict | None:
    """Prestador, tomador, destinatário, intermediário ou emitente: documento, nome, contato e endereço."""
    if el is None:
        return None
    return {
        "documento": _primeiro(el, "CNPJ", "CPF", "NIF"), "nome": _txt(el, "xNome"), "im": _txt(el, "IM"),
        "telefone": _txt(el, "fone"), "email": _txt(el, "email"),
        "logradouro": _primeiro(el, "enderNac/xLgr", "end/xLgr"), "numero": _primeiro(el, "enderNac/nro", "end/nro"),
        "complemento": _primeiro(el, "enderNac/xCpl", "end/xCpl"), "bairro": _primeiro(el, "enderNac/xBairro", "end/xBairro"),
        "codigo_municipio": _primeiro(el, "enderNac/cMun", "end/endNac/cMun"),
        "uf": _txt(el, "enderNac/UF"), "cep": _primeiro(el, "enderNac/CEP", "end/endNac/CEP"),
        # endereço no exterior
        "cidade_exterior": _txt(el, "end/endExt/xCidade"), "cep_exterior": _txt(el, "end/endExt/cEndPost"),
    }


def ler(xml: bytes | None) -> dict:
    """Devolve os dados da nota num dicionário simples (texto como veio no XML); {} quando não há XML legível."""
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
    ibs_n, ibs_d = _filho(nfse, "IBSCBS"), _filho(dps, "IBSCBS")  # apuração (governo) e declaração (DPS)
    fed = "valores/trib/tribFed/"
    d = {
        "autorizada": nfse is not None,
        # ---- o que o governo acrescenta na nota autorizada
        "chave": (nfse.get("Id") or "").removeprefix("NFS") if nfse is not None else "",
        "municipio_emissao": _txt(nfse, "xLocEmi"), "local_prestacao": _txt(nfse, "xLocPrestacao"),
        "municipio_incidencia": _txt(nfse, "xLocIncid"), "codigo_incidencia": _txt(nfse, "cLocIncid"),
        "numero": _txt(nfse, "nNFSe"), "processada_em": _txt(nfse, "dhProc"),
        "ambiente_gerador": _txt(nfse, "ambGer"), "situacao": _txt(nfse, "cStat"),
        "descricao_tributacao": _primeiro(nfse, "xTribMun", "xTribNac"), "outras_informacoes": _txt(nfse, "xOutInf"),
        "valor_liquido": _txt(nfse, "valores/vLiq"), "base_calculo": _txt(nfse, "valores/vBC"),
        "aliquota": _txt(nfse, "valores/pAliqAplic") or _txt(dps, "valores/trib/tribMun/pAliq"),
        "issqn": _txt(nfse, "valores/vISSQN"), "retencoes": _txt(nfse, "valores/vTotalRet"),
        "beneficio": _txt(nfse, "valores/tpBM"),
        "calculo_bm": _txt(nfse, "valores/vCalcBM") or _dentro(_filho(dps, "valores"), "vRedBCBM"),
        "deducoes": _txt(dps, "valores/vDedRed/vDR") or _txt(nfse, "valores/vCalcDR"),
        "emitente": _pessoa(_filho(nfse, "emit")) or {},
        # ---- o que foi declarado na DPS
        "ambiente": _txt(dps, "tpAmb"), "dps_emitida_em": _txt(dps, "dhEmi"), "serie": _txt(dps, "serie"),
        "numero_dps": _txt(dps, "nDPS"), "competencia": _txt(dps, "dCompet"), "codigo_emissao": _txt(dps, "cLocEmi"),
        "emitente_dps": _txt(dps, "tpEmit"), "finalidade": _primeiro(dps, "finNFSe", "IBSCBS/finNFSe"),
        "substituida": _txt(dps, "subst/chSubstda"),
        "prestador": _pessoa(_filho(dps, "prest")) or {}, "tomador": _pessoa(_filho(dps, "toma")),
        "intermediario": _pessoa(_filho(dps, "interm")),
        "destinatario": _pessoa(_filho(dps, "dest") if _filho(dps, "dest") is not None else _filho(ibs_d, "dest")),
        "destinatario_e_tomador": _primeiro(dps, "indDest", "IBSCBS/indDest") == "0",
        "simples": _txt(dps, "prest/regTrib/opSimpNac"), "apuracao_sn": _txt(dps, "prest/regTrib/regApTribSN"),
        "regime_especial": _txt(dps, "prest/regTrib/regEspTrib"),
        "codigo_prestacao": _txt(dps, "serv/locPrest/cLocPrestacao"), "pais_prestacao": _txt(dps, "serv/locPrest/cPaisPrestacao"),
        "tributacao_nacional": _txt(dps, "serv/cServ/cTribNac"), "tributacao_municipal": _txt(dps, "serv/cServ/cTribMun"),
        "nbs": _txt(dps, "serv/cServ/cNBS"), "descricao": _txt(dps, "serv/cServ/xDescServ"),
        "valor_servico": _txt(dps, "valores/vServPrest/vServ"),
        "desconto_incondicionado": _txt(dps, "valores/vDescCondIncond/vDescIncond"),
        "desconto_condicionado": _txt(dps, "valores/vDescCondIncond/vDescCond"),
        "tributacao_issqn": _txt(dps, "valores/trib/tribMun/tribISSQN"),
        "retencao_issqn": _txt(dps, "valores/trib/tribMun/tpRetISSQN"),
        "pais_incidencia": _txt(dps, "valores/trib/tribMun/cPaisResult"),
        "imunidade": _txt(dps, "valores/trib/tribMun/tpImunidade"),
        "suspensao": _txt(dps, "valores/trib/tribMun/exigSusp/tpSusp"),
        "processo_suspensao": _txt(dps, "valores/trib/tribMun/exigSusp/nProcesso"),
        "irrf": _txt(dps, fed + "vRetIRRF"), "previdencia": _txt(dps, fed + "vRetCP"), "csll": _txt(dps, fed + "vRetCSLL"),
        "pis": _txt(dps, fed + "piscofins/vPis"), "cofins": _txt(dps, fed + "piscofins/vCofins"),
        "retencao_pis_cofins": _txt(dps, fed + "piscofins/tpRetPisCofins"),
        "total_tributos": {k: _dentro(_filho(dps, "valores"), k) for k in (
            "vTotTribFed", "vTotTribEst", "vTotTribMun", "pTotTribFed", "pTotTribEst", "pTotTribMun", "pTotTribSN")},
        "complementares": {k: _dentro(_filho(dps, "serv"), k) for k in (
            "xInfComp", "docRef", "cObra", "inscImobFisc", "idAtvEvt", "idDocTec", "xPed", "xItemPed")},
        # ---- IBS/CBS (Reforma Tributária): None quando a nota não traz o grupo
        "ibs_cbs": None if ibs_n is None and ibs_d is None else {
            "cst": _dentro(ibs_d, "CST"), "class_trib": _dentro(ibs_d, "cClassTrib"), "ind_op": _dentro(ibs_d, "cIndOp"),
            "codigo_incidencia": _txt(ibs_n, "cLocalidadeIncid"), "municipio_incidencia": _txt(ibs_n, "xLocalidadeIncid"),
            "reembolso": _dentro(ibs_n, "vCalcReeRepRes"), "base_calculo": _txt(ibs_n, "valores/vBC"),
            "red_aliq_uf": _dentro(ibs_n, "pRedAliqUF"), "red_aliq_mun": _dentro(ibs_n, "pRedAliqMun"),
            "red_aliq_cbs": _dentro(ibs_n, "pRedAliqCBS"), "aliq_uf": _dentro(ibs_n, "pIBSUF"),
            "aliq_mun": _dentro(ibs_n, "pIBSMun"), "aliq_efet_mun": _dentro(ibs_n, "pAliqEfetMun"),
            "valor_mun": _dentro(ibs_n, "vIBSMun"), "aliq_efet_uf": _dentro(ibs_n, "pAliqEfetUF"),
            "valor_uf": _dentro(ibs_n, "vIBSUF"), "total_ibs": _dentro(ibs_n, "vIBSTot"), "aliq_cbs": _dentro(ibs_n, "pCBS"),
            "aliq_efet_cbs": _dentro(ibs_n, "pAliqEfetCBS"), "total_cbs": _dentro(ibs_n, "vCBS"),
            "total_nota": _dentro(ibs_n, "vTotNF"),
        },
    }
    # nome de município só existe no XML para os três códigos abaixo (emissão, prestação e incidência)
    d["municipios"] = {c: n for c, n in ((d["codigo_emissao"], d["municipio_emissao"]),
                                         (d["codigo_prestacao"], d["local_prestacao"]),
                                         (d["codigo_incidencia"], d["municipio_incidencia"])) if c and n}
    return d


def _digitos(v: str | None) -> str:
    return "".join(x for x in (v or "") if x.isdigit())


def formatar_tributacao(codigo: str | None) -> str:
    """cTribNac 170201 → 17.02.01 (item, subitem e desdobro da lista nacional)."""
    c = _digitos(codigo)
    return f"{c[:2]}.{c[2:4]}.{c[4:]}" if len(c) == 6 else c


def formatar_nbs(codigo: str | None) -> str:
    """cNBS 113011000 → 1.1301.10.00."""
    c = _digitos(codigo)
    return f"{c[0]}.{c[1:5]}.{c[5:7]}.{c[7:]}" if len(c) == 9 else c


def formatar_cep(cep: str | None) -> str:
    """18081000 → 18.081-000 (formato do DANFSe)."""
    c = _digitos(cep)
    return f"{c[:2]}.{c[2:5]}-{c[5:]}" if len(c) == 8 else (cep or "").strip()


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
