"""DPS (Declaração de Prestação de Serviço) do Sistema Nacional NFS-e, versão 1.01, e o pedido de cancelamento.

Os elementos saem na ORDEM do esquema oficial (xsd/DPS_v1.01.xsd, baixado de gov.br/nfse em 11/2026) e todo
documento é validado contra o XSD antes de ser assinado: o que o esquema recusa nem chega ao governo.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from lxml import etree
from signxml import CanonicalizationMethod, DigestAlgorithm, SignatureConstructionMethod, SignatureMethod, XMLSigner

from app.core.certificados import CertificadoCarregado
from app.core.documentos import so_digitos

NS = "http://www.sped.fazenda.gov.br/nfse"
NS_DS = "http://www.w3.org/2000/09/xmldsig#"
VERSAO = "1.01"
VER_APLIC = "MayaJus-1.0"
XSD_DIR = Path(__file__).parent / "xsd"
BRASILIA = timezone(timedelta(hours=-3))

# opção pelo Simples Nacional do prestador (regTrib/opSimpNac)
NAO_OPTANTE, MEI, ME_EPP = "1", "2", "3"
OPCAO_DO_REGIME = {"mei": MEI, "simples": ME_EPP, "presumido": NAO_OPTANTE, "real": NAO_OPTANTE}
# justificativa do cancelamento (e101101/cMotivo)
MOTIVOS_CANCELAMENTO = {"1": "Erro na emissão", "2": "Serviço não prestado", "9": "Outros"}


class DpsInvalida(ValueError):
    """Dados que não cabem na DPS (a mensagem é para quem está emitindo, em português claro)."""

    def __init__(self, mensagem: str, erros: list[str] | None = None):
        super().__init__(mensagem)
        self.erros = erros or [mensagem]


@dataclass
class Prestador:
    documento: str  # CNPJ (14) ou CPF (11), só dígitos
    codigo_municipio: str  # IBGE, 7 dígitos (município emissor)
    opcao_simples: str = NAO_OPTANTE  # 1 não optante · 2 MEI · 3 ME/EPP
    regime_apuracao_sn: str | None = None  # só ME/EPP: 1, 2 ou 3
    regime_especial: str = "0"
    inscricao_municipal: str | None = None
    telefone: str | None = None
    email: str | None = None


@dataclass
class Tomador:
    nome: str
    documento: str = ""  # CNPJ ou CPF; vazio = tomador não identificado
    codigo_municipio: str | None = None
    cep: str | None = None
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    telefone: str | None = None
    email: str | None = None
    inscricao_municipal: str | None = None


@dataclass
class Dps:
    prestador: Prestador
    serie: str
    numero: int
    competencia: date
    cod_tributacao_nacional: str  # cTribNac, 6 dígitos (item da lista + desdobro nacional)
    descricao: str
    valor: Decimal
    tomador: Tomador | None = None
    emitida_em: datetime | None = None
    ambiente: str = "2"  # 1 produção · 2 produção restrita (testes)
    local_prestacao: str | None = None  # IBGE; vazio = município do prestador
    cod_tributacao_municipal: str | None = None  # cTribMun, 3 dígitos, quando o município exige
    nbs: str | None = None
    iss_retido: bool = False
    aliquota_iss: Decimal | None = None  # percentual (ex.: 2.00); MEI e Simples não informam
    desconto_incondicional: Decimal = Decimal(0)
    percentual_tributos_sn: Decimal | None = None  # Simples: carga aproximada (pTotTribSN)
    informacoes: str | None = None
    extras: dict = field(default_factory=dict)


def _dec(v: Decimal) -> str:
    """Formato TSDec15V2 do esquema: "0", ou com duas casas e sem zeros à esquerda."""
    q = Decimal(v).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return "0" if q == 0 else f"{q:.2f}"


def _data_hora(d: datetime | None) -> str:
    d = (d or datetime.now(BRASILIA)).astimezone(BRASILIA).replace(microsecond=0)
    return d.isoformat()


def id_dps(prestador: Prestador, serie: str, numero: int) -> str:
    """"DPS" + município (7) + tipo de inscrição (1) + inscrição (14) + série (5) + número (15) = 45 posições."""
    doc = so_digitos(prestador.documento)
    tipo = "2" if len(doc) == 14 else "1"
    return f"DPS{prestador.codigo_municipio}{tipo}{doc.zfill(14)}{str(serie).zfill(5)}{int(numero):015d}"


def _el(pai, nome: str, texto: str | None = None):
    e = etree.SubElement(pai, f"{{{NS}}}{nome}")
    if texto is not None:
        e.text = texto
    return e


def _pessoa(pai, nome_tag: str, t: Tomador) -> None:
    doc = so_digitos(t.documento)
    el = _el(pai, nome_tag)
    if len(doc) == 14:
        _el(el, "CNPJ", doc)
    elif len(doc) == 11:
        _el(el, "CPF", doc)
    else:
        _el(el, "cNaoNIF", "0")  # não informado na nota de origem
    if t.inscricao_municipal:
        _el(el, "IM", so_digitos(t.inscricao_municipal)[:15])
    _el(el, "xNome", " ".join((t.nome or "").split())[:300])
    cep, mun = so_digitos(t.cep), so_digitos(t.codigo_municipio)
    if len(cep) == 8 and len(mun) == 7 and (t.logradouro or "").strip():
        end = _el(el, "end")
        nac = _el(end, "endNac")
        _el(nac, "cMun", mun)
        _el(nac, "CEP", cep)
        _el(end, "xLgr", t.logradouro.strip()[:255])
        _el(end, "nro", (t.numero or "S/N").strip()[:60])
        if (t.complemento or "").strip():
            _el(end, "xCpl", t.complemento.strip()[:156])
        _el(end, "xBairro", (t.bairro or "Não informado").strip()[:60])
    fone = so_digitos(t.telefone)
    if 6 <= len(fone) <= 20:
        _el(el, "fone", fone)
    if (t.email or "").strip():
        _el(el, "email", t.email.strip()[:80])


def conferir(d: Dps) -> list[str]:
    """O que impede a emissão, em linguagem de quem emite (antes mesmo do esquema)."""
    erros = []
    p = d.prestador
    doc = so_digitos(p.documento)
    if len(doc) not in (11, 14):
        erros.append("O CNPJ/CPF da empresa emissora está incompleto.")
    if len(so_digitos(p.codigo_municipio)) != 7:
        erros.append("Falta o código IBGE (7 dígitos) do município da empresa emissora.")
    if p.opcao_simples not in (NAO_OPTANTE, MEI, ME_EPP):
        erros.append("Regime da empresa emissora inválido para a NFS-e Nacional.")
    if p.opcao_simples == ME_EPP and p.regime_apuracao_sn not in ("1", "2", "3"):
        erros.append("Empresa do Simples (ME/EPP): informe o regime de apuração dos tributos.")
    if not (so_digitos(d.cod_tributacao_nacional) and len(so_digitos(d.cod_tributacao_nacional)) == 6):
        erros.append("O código de tributação nacional do serviço tem 6 dígitos (ex.: 010101).")
    if not (d.descricao or "").strip():
        erros.append("Falta a descrição do serviço.")
    if Decimal(d.valor or 0) <= 0:
        erros.append("O valor do serviço precisa ser maior que zero.")
    if not str(d.serie).isdigit() or not 1 <= int(d.serie) <= 99999:
        erros.append("A série da DPS é um número de 1 a 99999.")
    if not 1 <= int(d.numero or 0) <= 999_999_999_999_999:
        erros.append("Número da DPS inválido.")
    if d.tomador is not None and not (d.tomador.nome or "").strip():
        erros.append("Falta o nome do cliente (tomador).")
    return erros


def montar(d: Dps) -> etree._Element:
    """Monta a DPS (sem assinatura), na ordem do TCInfDPS."""
    erros = conferir(d)
    if erros:
        raise DpsInvalida(erros[0], erros)
    p = d.prestador
    doc = so_digitos(p.documento)
    raiz = etree.Element(f"{{{NS}}}DPS", nsmap={None: NS})
    raiz.set("versao", VERSAO)
    inf = _el(raiz, "infDPS")
    inf.set("Id", id_dps(p, d.serie, d.numero))
    _el(inf, "tpAmb", d.ambiente)
    _el(inf, "dhEmi", _data_hora(d.emitida_em))
    _el(inf, "verAplic", VER_APLIC)
    _el(inf, "serie", str(int(d.serie)))
    _el(inf, "nDPS", str(int(d.numero)))
    _el(inf, "dCompet", d.competencia.isoformat())
    _el(inf, "tpEmit", "1")  # quem emite é o prestador
    _el(inf, "cLocEmi", so_digitos(p.codigo_municipio))

    # prestador: só a identificação e o regime (nome e endereço vêm do cadastro nacional)
    prest = _el(inf, "prest")
    _el(prest, "CNPJ" if len(doc) == 14 else "CPF", doc)
    if p.inscricao_municipal:
        _el(prest, "IM", so_digitos(p.inscricao_municipal)[:15])
    fone = so_digitos(p.telefone)
    if 6 <= len(fone) <= 20:
        _el(prest, "fone", fone)
    if (p.email or "").strip():
        _el(prest, "email", p.email.strip()[:80])
    reg = _el(prest, "regTrib")
    _el(reg, "opSimpNac", p.opcao_simples)
    if p.opcao_simples == ME_EPP:
        _el(reg, "regApTribSN", p.regime_apuracao_sn)
    _el(reg, "regEspTrib", p.regime_especial or "0")

    if d.tomador is not None:
        _pessoa(inf, "toma", d.tomador)

    serv = _el(inf, "serv")
    loc = _el(serv, "locPrest")
    _el(loc, "cLocPrestacao", so_digitos(d.local_prestacao) or so_digitos(p.codigo_municipio))
    cserv = _el(serv, "cServ")
    _el(cserv, "cTribNac", so_digitos(d.cod_tributacao_nacional))
    if so_digitos(d.cod_tributacao_municipal):
        _el(cserv, "cTribMun", so_digitos(d.cod_tributacao_municipal).zfill(3)[-3:])
    _el(cserv, "xDescServ", d.descricao.strip()[:2000])
    if len(so_digitos(d.nbs)) == 9:
        _el(cserv, "cNBS", so_digitos(d.nbs))
    if (d.informacoes or "").strip():
        compl = _el(serv, "infoCompl")
        _el(compl, "xInfComp", " ".join(d.informacoes.split())[:2000])

    valores = _el(inf, "valores")
    vserv = _el(valores, "vServPrest")
    _el(vserv, "vServ", _dec(d.valor))
    if Decimal(d.desconto_incondicional or 0) > 0:
        desc = _el(valores, "vDescCondIncond")
        _el(desc, "vDescIncond", _dec(d.desconto_incondicional))
    trib = _el(valores, "trib")
    mun = _el(trib, "tribMun")
    _el(mun, "tribISSQN", "1")  # operação tributável
    _el(mun, "tpRetISSQN", "2" if d.iss_retido else "1")  # 1 não retido · 2 retido pelo tomador
    if d.aliquota_iss is not None and p.opcao_simples == NAO_OPTANTE:
        _el(mun, "pAliq", f"{Decimal(d.aliquota_iss).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):.2f}")
    tot = _el(trib, "totTrib")
    if p.opcao_simples == ME_EPP and d.percentual_tributos_sn is not None:
        _el(tot, "pTotTribSN", _dec(d.percentual_tributos_sn))
    else:
        _el(tot, "indTotTrib", "0")  # sem informar os tributos aproximados
    return raiz


def validar_xsd(raiz: etree._Element, nome_xsd: str = "DPS_v1.01.xsd") -> list[str]:
    schema = etree.XMLSchema(etree.parse(str(XSD_DIR / nome_xsd)))
    if schema.validate(raiz):
        return []
    return [f"linha {e.line}: {e.message}" for e in schema.error_log]


def assinar(raiz: etree._Element, cert: CertificadoCarregado, id_assinado: str) -> etree._Element:
    """Assinatura XMLDSig envelopada no elemento com o Id informado: RSA-SHA256, canonicalização inclusiva (C14N 1.0)
    e o <Signature> como último filho da raiz, sem prefixo. É o mesmo formato das NFS-e que o governo assina."""
    chave_pem = cert.chave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                         serialization.NoEncryption())
    cert_pem = cert.cert.public_bytes(serialization.Encoding.PEM).decode()
    signer = XMLSigner(
        method=SignatureConstructionMethod.enveloped,
        signature_algorithm=SignatureMethod.RSA_SHA256,
        digest_algorithm=DigestAlgorithm.SHA256,
        c14n_algorithm=CanonicalizationMethod.CANONICAL_XML_1_0,
    )
    signer.namespaces = {None: NS_DS}
    return signer.sign(raiz, key=chave_pem, cert=[cert_pem], reference_uri=f"#{id_assinado}", id_attribute="Id")


def assinatura_confere(xml: bytes) -> bool:
    """Confere a assinatura de um documento nosso, por conta própria: o resumo do elemento assinado e a assinatura
    do SignedInfo, com a chave pública do certificado que veio no próprio XML.

    (O verificador da signxml recusa assinatura sem prefixo com canonicalização inclusiva, embora ela esteja certa;
    por isso a conferência é feita aqui, com a canonicalização de cada trecho isolado.)
    """
    import base64
    import hashlib

    from cryptography import x509
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    def c14n(el) -> bytes:
        return etree.tostring(etree.fromstring(etree.tostring(el)), method="c14n")

    try:
        raiz = etree.fromstring(xml)
        sig = raiz.find(f"{{{NS_DS}}}Signature")
        si = sig.find(f"{{{NS_DS}}}SignedInfo")
        ref = si.find(f"{{{NS_DS}}}Reference")
        assinado = next(e for e in raiz if e.get("Id") == ref.get("URI", "")[1:])
        resumo = hashlib.sha256(c14n(assinado)).digest()
        if base64.b64encode(resumo).decode() != (ref.findtext(f"{{{NS_DS}}}DigestValue") or "").strip():
            return False
        der = base64.b64decode(sig.findtext(f".//{{{NS_DS}}}X509Certificate"))
        valor = base64.b64decode(sig.findtext(f"{{{NS_DS}}}SignatureValue"))
        x509.load_der_x509_certificate(der).public_key().verify(
            valor, c14n(si), padding.PKCS1v15(), hashes.SHA256())
        return True
    except (InvalidSignature, StopIteration, AttributeError, TypeError, ValueError, etree.XMLSyntaxError):
        return False


def para_bytes(raiz: etree._Element) -> bytes:
    return etree.tostring(raiz, xml_declaration=True, encoding="UTF-8")


def gerar(d: Dps, cert: CertificadoCarregado | None) -> bytes:
    """DPS pronta para envio: montada, conferida contra o XSD oficial e assinada."""
    raiz = montar(d)
    problemas = validar_xsd(raiz)
    if problemas:
        raise DpsInvalida("A nota não passou na conferência do layout oficial: " + problemas[0], problemas)
    if cert is not None:
        raiz = assinar(raiz, cert, raiz[0].get("Id"))
    return para_bytes(raiz)


# ------------------------------------------------------------------------------------------------ cancelamento
def id_pedido_cancelamento(chave_acesso: str) -> str:
    """"PRE" + chave de acesso (50) + código do evento (6)."""
    return f"PRE{chave_acesso}101101"


def montar_cancelamento(*, chave_acesso: str, documento_autor: str, motivo: str, codigo_motivo: str = "9",
                        ambiente: str = "2", quando: datetime | None = None) -> etree._Element:
    chave = so_digitos(chave_acesso)
    if len(chave) != 50:
        raise DpsInvalida("A chave de acesso da NFS-e tem 50 dígitos.")
    if codigo_motivo not in MOTIVOS_CANCELAMENTO:
        raise DpsInvalida("Motivo de cancelamento inválido.")
    texto = " ".join((motivo or "").split())
    if len(texto) < 15:
        raise DpsInvalida("Descreva o motivo do cancelamento com pelo menos 15 letras.")
    doc = so_digitos(documento_autor)
    raiz = etree.Element(f"{{{NS}}}pedRegEvento", nsmap={None: NS})
    raiz.set("versao", VERSAO)
    inf = _el(raiz, "infPedReg")
    inf.set("Id", id_pedido_cancelamento(chave))
    _el(inf, "tpAmb", ambiente)
    _el(inf, "verAplic", VER_APLIC)
    _el(inf, "dhEvento", _data_hora(quando))
    _el(inf, "CNPJAutor" if len(doc) == 14 else "CPFAutor", doc)
    _el(inf, "chNFSe", chave)
    ev = _el(inf, "e101101")
    _el(ev, "xDesc", "Cancelamento de NFS-e")
    _el(ev, "cMotivo", codigo_motivo)
    _el(ev, "xMotivo", texto[:255])
    return raiz


def gerar_cancelamento(cert: CertificadoCarregado | None, **k) -> bytes:
    raiz = montar_cancelamento(**k)
    problemas = validar_xsd(raiz, "pedRegEvento_v1.01.xsd")
    if problemas:
        raise DpsInvalida("O pedido de cancelamento não passou no layout oficial: " + problemas[0], problemas)
    if cert is not None:
        raiz = assinar(raiz, cert, raiz[0].get("Id"))
    return para_bytes(raiz)
