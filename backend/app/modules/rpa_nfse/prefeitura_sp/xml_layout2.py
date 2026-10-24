"""Montagem das mensagens XML do layout 2 (ISS + IBS + CBS) — Manual Web Service v3.3.4 / NT 003 e 004.

Se os XSD oficiais estiverem em ./xsd (PedidoEnvioLoteRPS_v02.xsd etc.), toda mensagem é validada
antes de sair do servidor.
"""

import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

from lxml import etree

from app.core.certificados import CertificadoCarregado
from app.core.documentos import so_digitos
from app.modules.rpa_nfse.prefeitura_sp import assinatura

NS = "http://www.prefeitura.sp.gov.br/nfe"
VERSAO = "2"
XSD_DIR = Path(__file__).parent / "xsd"
MUNICIPIO_SP = "3550308"


@dataclass
class RpsXml:
    """Visão plana de um RPS pronta para virar XML."""

    serie: str
    numero: int
    tipo: str
    data_emissao: date
    status: str  # N normal | C cancelado
    tributacao: str
    valor: Decimal
    deducoes: Decimal
    cod_servico: str
    aliquota: Decimal
    iss_retido: bool
    discriminacao: str
    tomador: dict
    layout2: dict


def _sub(pai: etree._Element, tag: str, texto: object | None = None) -> etree._Element:
    el = etree.SubElement(pai, tag)
    if texto is not None:
        el.text = str(texto)
    return el


def _dec(v: Decimal, casas: int = 2) -> str:
    return "0" if v == 0 and casas == 2 else f"{v:.{casas}f}"


def _ind_tomador(doc: str) -> str:
    return {11: "1", 14: "2"}.get(len(doc), "3")


def sem_acento(texto: str | None) -> str:
    """A Prefeitura recusa acentos em razão social e discriminação."""
    return unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode().replace(chr(13), "")


def _rps(pai: etree._Element, ccm: str, r: RpsXml, cert: CertificadoCarregado | None) -> None:
    """Elemento RPS na ORDEM exata do tpRPS de TiposNFe_v02.xsd (fora de ordem = recusa)."""
    t = r.tomador
    l2 = r.layout2
    doc = so_digitos(t.get("cpf_cnpj"))
    zero = "0.00"
    el = _sub(pai, "RPS")
    texto = assinatura.string_assinatura_rps(
        ccm=ccm,
        serie=r.serie,
        numero=r.numero,
        data_emissao=r.data_emissao,
        tributacao=r.tributacao,
        status=r.status,
        iss_retido=r.iss_retido,
        valor=r.valor,
        deducoes=r.deducoes,
        cod_servico=r.cod_servico,
        ind_tomador=_ind_tomador(doc),
        doc_tomador=doc,
        layout=VERSAO,
    )
    _sub(el, "Assinatura", assinatura.assinar_texto(cert, texto))
    chave = _sub(el, "ChaveRPS")
    _sub(chave, "InscricaoPrestador", int(so_digitos(ccm)))
    _sub(chave, "SerieRPS", r.serie)
    _sub(chave, "NumeroRPS", r.numero)
    _sub(el, "TipoRPS", r.tipo or "RPS")
    _sub(el, "DataEmissao", r.data_emissao.isoformat())
    _sub(el, "StatusRPS", r.status)
    _sub(el, "TributacaoRPS", r.tributacao)
    _sub(el, "ValorDeducoes", _dec(r.deducoes))
    # Retenções federais passam a ser obrigatórias no layout 2 (zero quando não há)
    for tag in ("ValorPIS", "ValorCOFINS", "ValorINSS", "ValorIR", "ValorCSLL"):
        _sub(el, tag, zero)
    _sub(el, "CodigoServico", int(so_digitos(r.cod_servico)))
    _sub(el, "AliquotaServicos", _dec(r.aliquota, 4))
    _sub(el, "ISSRetido", "true" if r.iss_retido else "false")
    if doc:
        _sub(_sub(el, "CPFCNPJTomador"), "CPF" if len(doc) == 11 else "CNPJ", doc)
    if t.get("im") and t.get("codigo_municipio") == MUNICIPIO_SP:
        _sub(el, "InscricaoMunicipalTomador", int(so_digitos(t["im"])))
    _sub(el, "RazaoSocialTomador", sem_acento(t.get("nome"))[:75])
    if t.get("logradouro") or t.get("cep"):
        end = _sub(el, "EnderecoTomador")
        for tag, campo, tam in [
            ("TipoLogradouro", "tipo_logradouro", 3),
            ("Logradouro", "logradouro", 50),
            ("NumeroEndereco", "numero", 10),
            ("ComplementoEndereco", "complemento", 30),
            ("Bairro", "bairro", 30),
        ]:
            if t.get(campo):
                _sub(end, tag, sem_acento(str(t[campo]))[:tam])
        if t.get("codigo_municipio"):
            _sub(end, "Cidade", t["codigo_municipio"])
        if t.get("uf"):
            _sub(end, "UF", t["uf"].upper())
        if so_digitos(t.get("cep")):
            _sub(end, "CEP", int(so_digitos(t["cep"])))
    if t.get("email"):
        _sub(el, "EmailTomador", t["email"][:75])
    _sub(el, "Discriminacao", sem_acento(r.discriminacao)[:2000] or "Servicos prestados")
    # Valor total da nota: a Prefeitura calcula os tributos "de trás para frente" e o total fica igual ao RPS
    _sub(el, "ValorFinalCobrado", _dec(r.valor))
    _sub(el, "ValorIPI", zero)
    _sub(el, "ExigibilidadeSuspensa", "0")
    _sub(el, "PagamentoParceladoAntecipado", "0")
    _sub(el, "NBS", so_digitos(l2.get("nbs")))
    _sub(el, "cLocPrestacao", MUNICIPIO_SP)
    ibs = _sub(el, "IBSCBS")
    _sub(ibs, "finNFSe", l2.get("finalidade") or "0")
    _sub(ibs, "indFinal", l2.get("ind_final") or "0")
    _sub(ibs, "cIndOp", so_digitos(l2.get("ind_operacao")))
    _sub(ibs, "indDest", l2.get("ind_destinatario") or "0")
    g = _sub(_sub(_sub(ibs, "valores"), "trib"), "gIBSCBS")
    _sub(g, "cClassTrib", so_digitos(l2.get("class_trib")))


def _raiz(nome: str) -> etree._Element:
    return etree.Element(f"{{{NS}}}{nome}", nsmap={"nfe": NS})


def _finalizar(raiz: etree._Element) -> etree._Element:
    """Converte para a forma aceita pela Prefeitura: raiz no namespace padrão e filhos com xmlns="".

    O lxml não emite xmlns="" sozinho (os filhos herdariam o namespace da raiz e o XSD recusa).
    """
    nome = etree.QName(raiz).localname
    filhos = []
    for c in raiz:
        txt = etree.tostring(c, encoding="unicode")
        nome_filho = etree.QName(c).localname
        filhos.append(txt.replace(f"<{nome_filho}", f'<{nome_filho} xmlns=""', 1))
    return etree.fromstring(f'<{nome} xmlns="{NS}">{"".join(filhos)}</{nome}>'.encode())


def rps_isolado(ccm: str, r: RpsXml, cert: CertificadoCarregado | None) -> bytes:
    """XML de um RPS sozinho (com a assinatura do RPS) — guardado junto de cada nota emitida."""
    pai = etree.Element("tmp")
    _rps(pai, ccm, r, cert)
    return etree.tostring(pai[0], encoding="utf-8")


def pedido_envio_lote(
    *, cnpj_remetente: str, ccm: str, rps: list[RpsXml], cert: CertificadoCarregado | None
) -> etree._Element:
    raiz = _raiz("PedidoEnvioLoteRPS")
    cab = _sub(raiz, "Cabecalho")
    cab.set("Versao", VERSAO)
    rem = _sub(cab, "CPFCNPJRemetente")
    _sub(rem, "CNPJ", cnpj_remetente)
    _sub(cab, "transacao", "false")  # rejeição parcial: o que passou fica emitido
    _sub(cab, "dtInicio", min(r.data_emissao for r in rps).isoformat())
    _sub(cab, "dtFim", max(r.data_emissao for r in rps).isoformat())
    _sub(cab, "QtdRPS", len(rps))
    for r in rps:
        _rps(raiz, ccm, r, cert)
    return assinatura.assinar_xml(_finalizar(raiz), cert)


def pedido_cancelamento(
    *, cnpj_remetente: str, ccm: str, numero_nfe: int, cert: CertificadoCarregado | None
) -> etree._Element:
    raiz = _raiz("PedidoCancelamentoNFe")
    cab = _sub(raiz, "Cabecalho")
    cab.set("Versao", "1")
    _sub(_sub(cab, "CPFCNPJRemetente"), "CNPJ", cnpj_remetente)
    _sub(cab, "transacao", "true")
    det = _sub(raiz, "Detalhe")
    ch = _sub(det, "ChaveNFe")
    _sub(ch, "InscricaoPrestador", ccm.zfill(8))
    _sub(ch, "NumeroNFe", numero_nfe)
    _sub(
        det,
        "AssinaturaCancelamento",
        assinatura.assinar_texto(cert, assinatura.string_assinatura_cancelamento(ccm, numero_nfe)),
    )
    return assinatura.assinar_xml(_finalizar(raiz), cert)


def pedido_consulta_nfe_por_rps(
    *, cnpj_remetente: str, ccm: str, serie: str, numero: int, cert: CertificadoCarregado | None
) -> etree._Element:
    raiz = _raiz("PedidoConsultaNFe")
    cab = _sub(raiz, "Cabecalho")
    cab.set("Versao", "1")
    _sub(_sub(cab, "CPFCNPJRemetente"), "CNPJ", cnpj_remetente)
    det = _sub(raiz, "Detalhe")
    ch = _sub(det, "ChaveRPS")
    _sub(ch, "InscricaoPrestador", ccm.zfill(8))
    _sub(ch, "SerieRPS", serie)
    _sub(ch, "NumeroRPS", numero)
    return assinatura.assinar_xml(_finalizar(raiz), cert)


def pedido_consulta_cnpj(*, cnpj_remetente: str, cnpj: str, cert: CertificadoCarregado | None) -> etree._Element:
    raiz = _raiz("PedidoConsultaCNPJ")
    cab = _sub(raiz, "Cabecalho")
    cab.set("Versao", "1")
    _sub(_sub(cab, "CPFCNPJRemetente"), "CNPJ", cnpj_remetente)
    _sub(_sub(raiz, "CNPJContribuinte"), "CNPJ", cnpj)
    return assinatura.assinar_xml(_finalizar(raiz), cert)


def validar_xsd(raiz: etree._Element, nome_xsd: str) -> list[str]:
    """Retorna a lista de erros de schema (vazia se ok ou se o XSD oficial não estiver presente)."""
    arq = XSD_DIR / nome_xsd
    if not arq.exists():
        return []
    schema = etree.XMLSchema(etree.parse(str(arq)))
    if schema.validate(raiz):
        return []
    return [f"linha {e.line}: {e.message}" for e in schema.error_log]


def para_bytes(raiz: etree._Element) -> bytes:
    return etree.tostring(raiz, encoding="utf-8", xml_declaration=False)
