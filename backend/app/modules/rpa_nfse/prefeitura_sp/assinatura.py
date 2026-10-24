"""Assinaturas exigidas pelo Web Service da NFS-e de São Paulo.

1. Assinatura de cada RPS: string de campos concatenados, RSA-SHA1, em base64.
2. Assinatura XMLDSig enveloped da mensagem inteira (RSA-SHA256, C14N 1.0).
"""

import base64
from datetime import date
from decimal import Decimal

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from lxml import etree
from signxml import SignatureConstructionMethod, XMLSigner
from signxml.algorithms import CanonicalizationMethod, DigestAlgorithm, SignatureMethod

from app.core.certificados import CertificadoCarregado


def _cents(v: Decimal) -> str:
    return str(int((v * 100).quantize(Decimal(1)))).zfill(15)


def string_assinatura_rps(
    *,
    ccm: str,
    serie: str,
    numero: int,
    data_emissao: date,
    tributacao: str,
    status: str,
    iss_retido: bool,
    valor: Decimal,
    deducoes: Decimal,
    cod_servico: str,
    ind_tomador: str,
    doc_tomador: str,
    layout: str = "2",
) -> str:
    """Cadeia de 86 posições (V1) — no V2 o CCM vai com 12 posições e o valor é o ValorFinalCobrado."""
    return (
        ccm.zfill(12 if layout == "2" else 8)
        + serie.ljust(5)
        + str(numero).zfill(12)
        + data_emissao.strftime("%Y%m%d")
        + tributacao
        + status
        + ("S" if iss_retido else "N")
        + _cents(valor)
        + _cents(deducoes)
        + cod_servico.zfill(5)
        + ind_tomador
        + (doc_tomador or "").zfill(14)
    )


def string_assinatura_cancelamento(ccm: str, numero_nfe: int) -> str:
    return ccm.zfill(8) + str(numero_nfe).zfill(12)


def assinar_texto(cert: CertificadoCarregado | None, texto: str) -> str:
    if cert is None:  # modo simulado sem certificado
        return base64.b64encode(texto.encode("ascii")).decode()
    sig = cert.chave.sign(texto.encode("ascii"), padding.PKCS1v15(), hashes.SHA1())  # noqa: S303 (exigido pelo manual)
    return base64.b64encode(sig).decode()


def assinar_xml(raiz: etree._Element, cert: CertificadoCarregado | None) -> etree._Element:
    if cert is None:
        return raiz
    chave_pem = cert.chave.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    cert_pem = cert.cert.public_bytes(serialization.Encoding.PEM)
    # RSA-SHA256 + C14N 1.0 com o prefixo padrão "ds:": combinação aceita pela Prefeitura
    # (ConsultaCNPJ e TesteEnvioLoteRPS, validado no sistema RCA em 15/09/2026). Em SHA-1 ou
    # sem prefixo a resposta era 1057 "Assinatura difere do calculado".
    signer = XMLSigner(
        method=SignatureConstructionMethod.enveloped,
        signature_algorithm=SignatureMethod.RSA_SHA256,
        digest_algorithm=DigestAlgorithm.SHA256,
        c14n_algorithm=CanonicalizationMethod.CANONICAL_XML_1_0,
    )
    return signer.sign(raiz, key=chave_pem, cert=[cert_pem.decode()])
