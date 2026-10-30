"""Certificado e-CPF do advogado: leitura (titular, CPF, validade), checagens antes de cada uso, revogação e assinatura.

O .pfx só é decifrado em memória, na hora de usar. Toda vez que é usado fica um registro em UsoCertificado.
"""

import hashlib
import io
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtensionOID, NameOID
from sqlalchemy.orm import Session

from app.core.certificados import CertificadoCarregado, CertificadoInvalido, carregar_pfx
from app.core.db import agora
from app.core.security import decifrar
from app.modules.tribunais.models import CertificadoAdvogado, UsoCertificado

log = logging.getLogger(__name__)

OID_DADOS_PF = x509.ObjectIdentifier("2.16.76.1.3.1")  # ICP-Brasil: nascimento(8) + CPF(11) + NIS(11) + RG...
ESCOPOS = ("consulta", "download", "protocolo")


class CertificadoNaoUtilizavel(ValueError):
    pass


@dataclass
class InfoCertificadoAdv:
    titular_nome: str
    titular_cpf: str | None
    emissor_ac: str
    numero_serie: str
    thumbprint_sha256: str
    valido_de: datetime
    valido_ate: datetime


def _cn(nome: x509.Name) -> str:
    a = nome.get_attributes_for_oid(NameOID.COMMON_NAME)
    return str(a[0].value) if a else nome.rfc4514_string()


def _cpf_do_san(cert: x509.Certificate) -> str | None:
    try:
        san = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value
    except x509.ExtensionNotFound:
        return None
    for o in san.get_values_for_type(x509.OtherName):
        if o.type_id == OID_DADOS_PF:
            digitos = re.sub(r"\D", "", o.value.decode("latin-1", "ignore"))
            if len(digitos) >= 19:
                return digitos[8:19]
    return None


def ler(pfx: bytes, senha: str) -> InfoCertificadoAdv:
    c = carregar_pfx(pfx, senha).cert
    cn = _cn(c.subject)
    m = re.search(r":(\d{11})$", cn)  # e-CPF ICP-Brasil: "NOME DO TITULAR:12345678901"
    cpf = _cpf_do_san(c) or (m.group(1) if m else None)
    return InfoCertificadoAdv(
        titular_nome=cn.split(":")[0] if m else cn,
        titular_cpf=cpf,
        emissor_ac=_cn(c.issuer),
        numero_serie=format(c.serial_number, "x"),
        thumbprint_sha256=hashlib.sha256(c.public_bytes(serialization.Encoding.DER)).hexdigest(),
        valido_de=c.not_valid_before_utc,
        valido_ate=c.not_valid_after_utc,
    )


def abrir(cert: CertificadoAdvogado) -> CertificadoCarregado:
    if not cert.pfx_cifrado or not cert.senha_cifrada:
        raise CertificadoNaoUtilizavel("O certificado foi removido do cofre.")
    return carregar_pfx(decifrar(cert.pfx_cifrado), decifrar(cert.senha_cifrada).decode())


def checar(cert: CertificadoAdvogado | None, escopo: str, cpf_advogado: str | None) -> None:
    """Regra 3: titular = advogado, dentro da validade, não revogado, escopo autorizado. A3 só via agente local."""
    if cert is None or cert.removido_em:
        raise CertificadoNaoUtilizavel("O advogado não tem certificado digital ativo. Envie o e-CPF em Tribunais › Meu certificado.")
    if cert.tipo == "A3" and not cert.agente_local_id:
        raise CertificadoNaoUtilizavel("Certificado A3 (token/cartão) só funciona com o agente local MayaJus instalado no computador.")
    if cert.tipo == "A3":
        raise CertificadoNaoUtilizavel("O agente local para certificado A3 ainda não está disponível. Use um certificado A1.")
    if cert.revogado:
        raise CertificadoNaoUtilizavel("O certificado consta como REVOGADO pela Autoridade Certificadora. Envie um novo.")
    agora_utc = datetime.now(UTC)
    if cert.valido_ate.replace(tzinfo=UTC) < agora_utc:
        raise CertificadoNaoUtilizavel(f"O certificado venceu em {cert.valido_ate:%d/%m/%Y}. Envie o certificado renovado.")
    if cert.valido_de.replace(tzinfo=UTC) > agora_utc:
        raise CertificadoNaoUtilizavel("O certificado ainda não está dentro da validade.")
    if escopo not in (cert.escopo_autorizado or []):
        raise CertificadoNaoUtilizavel(f"O advogado não autorizou o uso do certificado para {escopo}. Ajuste o termo de consentimento.")
    if cpf_advogado and cert.titular_cpf and cert.titular_cpf != cpf_advogado:
        raise CertificadoNaoUtilizavel("O CPF do certificado não é o CPF do advogado cadastrado em Profissionais.")
    if not cpf_advogado:
        raise CertificadoNaoUtilizavel("Cadastre o CPF do advogado em Configurações › Profissionais.")


def registrar_uso(db: Session, cert: CertificadoAdvogado, acao: str, referencia: str, resultado: str, *, tribunal_id=None,
                  usuario_id=None, aprovacao_id=None, ip=None, detalhe=None) -> None:
    db.add(UsoCertificado(tenant_id=cert.tenant_id, certificado_id=cert.id, acao=acao, tribunal_id=tribunal_id,
                          referencia=str(referencia)[:60], usuario_disparou_id=usuario_id, aprovacao_humana_id=aprovacao_id,
                          ip_origem=ip, resultado=resultado, detalhe=(detalhe or "")[:500] or None))


# ------------------------------------------------------------------------------------------------- revogação (OCSP)
def verificar_revogacao(cert: CertificadoAdvogado, timeout: float = 15.0) -> str:
    """Consulta o OCSP da AC (endereço no próprio certificado). Marca revogado se a AC disser. Retorna o resultado."""
    import httpx

    try:
        c = abrir(cert)
    except Exception as e:  # noqa: BLE001
        return f"não verificado: {e}"
    try:
        aia = c.cert.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_INFORMATION_ACCESS).value
        url = next(d.access_location.value for d in aia if d.access_method == AuthorityInformationAccessOID.OCSP)
    except (x509.ExtensionNotFound, StopIteration):
        cert.revogacao_verificada_em, cert.revogacao_msg = agora(), "A AC não informa OCSP neste certificado."
        return cert.revogacao_msg
    emissor = next((i for i in c.cadeia if i.subject == c.cert.issuer), None)
    if emissor is None:
        cert.revogacao_verificada_em, cert.revogacao_msg = agora(), "Cadeia da AC ausente no arquivo: revogação não verificada."
        return cert.revogacao_msg
    req = ocsp.OCSPRequestBuilder().add_certificate(c.cert, emissor, hashes.SHA1()).build()
    try:
        r = httpx.post(url, content=req.public_bytes(serialization.Encoding.DER),
                       headers={"Content-Type": "application/ocsp-request"}, timeout=timeout)
        resp = ocsp.load_der_ocsp_response(r.content)
    except Exception as e:  # noqa: BLE001
        cert.revogacao_msg = f"OCSP indisponível: {e}"[:300]
        return cert.revogacao_msg
    cert.revogacao_verificada_em = agora()
    if resp.response_status != ocsp.OCSPResponseStatus.SUCCESSFUL:
        cert.revogacao_msg = f"OCSP respondeu {resp.response_status.name}"
    elif resp.certificate_status == ocsp.OCSPCertStatus.REVOKED:
        cert.revogado, cert.revogacao_msg = True, f"Revogado em {resp.revocation_time_utc:%d/%m/%Y}"
    else:
        cert.revogacao_msg = "Válido (OCSP)" if resp.certificate_status == ocsp.OCSPCertStatus.GOOD else "Situação desconhecida na AC"
    return cert.revogacao_msg


# ---------------------------------------------------------------------------------------------------- assinatura
def assinar_pades(pdf: bytes, c: CertificadoCarregado, motivo: str = "Peticionamento eletrônico") -> bytes:
    """Assinatura PAdES (PDF assinado por dentro), o formato que PJe e eproc aceitam."""
    from asn1crypto import x509 as asn1x509
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers

    signer = None
    if c.pfx:
        signer = signers.SimpleSigner.load_pkcs12_data(c.pfx, other_certs=[], passphrase=c.senha.encode() if c.senha else None)
    if signer is None:  # certificado de simulação (sem .pfx): monta o signer direto da chave
        from asn1crypto import keys as asn1keys
        from pyhanko_certvalidator.registry import SimpleCertificateStore

        chave = asn1keys.PrivateKeyInfo.load(c.chave.private_bytes(
            serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        signer = signers.SimpleSigner(signing_cert=asn1x509.Certificate.load(c.cert.public_bytes(serialization.Encoding.DER)),
                                      signing_key=chave, cert_registry=SimpleCertificateStore())
    try:
        w = IncrementalPdfFileWriter(io.BytesIO(pdf), strict=False)
    except Exception as e:  # noqa: BLE001
        raise CertificadoInvalido(f"O PDF não pôde ser aberto para assinatura: {e}") from e
    meta = signers.PdfSignatureMetadata(field_name="MayaJus", subfilter=fields.SigSeedSubFilter.PADES, md_algorithm="sha256",
                                        reason=motivo, name=_cn(c.cert.subject).split(":")[0])
    return signers.sign_pdf(w, meta, signer=signer).getvalue()


def assinar_cades(dados: bytes, c: CertificadoCarregado) -> bytes:
    """CAdES destacada (.p7s): para sistemas que pedem o arquivo e a assinatura separados."""
    return (pkcs7.PKCS7SignatureBuilder().set_data(dados).add_signer(c.cert, c.chave, hashes.SHA256())
            .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary]))


def pem_temporario(c: CertificadoCarregado):
    """(cert.pem, key.pem) para TLS com certificado do cliente. Apagar logo depois de carregar no SSLContext."""
    import os
    import tempfile

    cert_pem = c.cert.public_bytes(serialization.Encoding.PEM) + b"".join(i.public_bytes(serialization.Encoding.PEM) for i in c.cadeia)
    key_pem = c.chave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    arquivos = []
    for dados in (cert_pem, key_pem):
        fd, caminho = tempfile.mkstemp(suffix=".pem")
        with os.fdopen(fd, "wb") as f:
            f.write(dados)
        arquivos.append(caminho)
    return arquivos[0], arquivos[1]


def ssl_com_certificado(c: CertificadoCarregado):
    import os
    import ssl

    ctx = ssl.create_default_context()
    cert_path, key_path = pem_temporario(c)
    try:
        ctx.load_cert_chain(cert_path, key_path)
    finally:
        for p in (cert_path, key_path):
            os.unlink(p)
    return ctx
