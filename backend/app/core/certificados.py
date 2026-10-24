"""Leitura de certificado A1 (.pfx/.p12) e acesso seguro (descriptografado só em memória)."""

import re
from dataclasses import dataclass
from datetime import date

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from app.core.models import Certificado
from app.core.security import decifrar


class CertificadoInvalido(ValueError):
    pass


@dataclass
class InfoCertificado:
    titular: str
    cnpj: str | None
    emissor: str
    valido_de: date
    valido_ate: date
    serial: str


@dataclass
class CertificadoCarregado:
    chave: RSAPrivateKey
    cert: x509.Certificate
    cadeia: list[x509.Certificate]
    pfx: bytes
    senha: str


def _nome(n: x509.Name) -> str:
    attrs = n.get_attributes_for_oid(NameOID.COMMON_NAME)
    return str(attrs[0].value) if attrs else n.rfc4514_string()


def carregar_pfx(pfx: bytes, senha: str) -> CertificadoCarregado:
    try:
        chave, cert, cadeia = pkcs12.load_key_and_certificates(pfx, senha.encode() if senha else None)
    except ValueError as e:
        raise CertificadoInvalido("Não foi possível abrir o certificado. Confira a senha.") from e
    if cert is None or chave is None:
        raise CertificadoInvalido("O arquivo não contém um certificado A1 com chave privada.")
    if not isinstance(chave, RSAPrivateKey):
        raise CertificadoInvalido("O certificado precisa usar chave RSA.")
    return CertificadoCarregado(chave=chave, cert=cert, cadeia=list(cadeia or []), pfx=pfx, senha=senha)


def ler_info(pfx: bytes, senha: str) -> InfoCertificado:
    c = carregar_pfx(pfx, senha).cert
    titular = _nome(c.subject)
    # Certificados ICP-Brasil e-CNPJ trazem "RAZAO SOCIAL:12345678000199" no CN
    m = re.search(r":(\d{14})$", titular)
    cnpj = m.group(1) if m else None
    return InfoCertificado(
        titular=titular.split(":")[0] if m else titular,
        cnpj=cnpj,
        emissor=_nome(c.issuer),
        valido_de=c.not_valid_before_utc.date(),
        valido_ate=c.not_valid_after_utc.date(),
        serial=format(c.serial_number, "x"),
    )


def abrir(certificado: Certificado) -> CertificadoCarregado:
    return carregar_pfx(decifrar(certificado.pfx_cifrado), decifrar(certificado.senha_cifrada).decode())


_simulacao: CertificadoCarregado | None = None


def certificado_de_simulacao() -> CertificadoCarregado:
    """Certificado autoassinado efêmero: no modo simulado o XML é assinado e validado no XSD de verdade."""
    global _simulacao
    if _simulacao is None:
        from datetime import UTC, datetime, timedelta

        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import rsa

        chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SIMULACAO MAYACORP")])
        agora = datetime.now(UTC)
        cert = (
            x509.CertificateBuilder().subject_name(nome).issuer_name(nome).public_key(chave.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(agora - timedelta(days=1))
            .not_valid_after(agora + timedelta(days=365)).sign(chave, hashes.SHA256())
        )
        _simulacao = CertificadoCarregado(chave=chave, cert=cert, cadeia=[], pfx=b"", senha="")
    return _simulacao
