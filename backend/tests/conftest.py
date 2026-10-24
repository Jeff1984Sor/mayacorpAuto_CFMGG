import os
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="mayacorp-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_tmp / "storage")

import pytest  # noqa: E402
from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402
from cryptography.hazmat.primitives.serialization import pkcs12  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402


def gerar_pfx(senha: str = "1234", cnpj: str = "11222333000181", dias: int = 365) -> bytes:
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"CFME ADVOGADOS:{cnpj}")])
    emissor = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "AC TESTE MAYACORP")])
    agora = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(nome)
        .issuer_name(emissor)
        .public_key(chave.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(agora - timedelta(days=1))
        .not_valid_after(agora + timedelta(days=dias))
        .sign(chave, hashes.SHA256())
    )
    return pkcs12.serialize_key_and_certificates(
        b"cfme", chave, cert, None, serialization.BestAvailableEncryption(senha.encode())
    )


@pytest.fixture
def pfx() -> bytes:
    return gerar_pfx()


def detalhe(n: int, **kw) -> dict:
    base = dict(
        numero=n,
        data=date.today() - timedelta(days=1),
        valor="1250.00",
        cod_servico="03220",
        aliquota="0.05",
        ind_doc="2",
        doc="11444777000161",
        nome="CONDOMINIO EDIFICIO SOLAR",
        tipo_logradouro="R",
        logradouro="RUA DAS FLORES",
        numero_end="100",
        bairro="CENTRO",
        cidade="SAO PAULO",
        uf="SP",
        cep="01001000",
        email="sindico@solar.com.br",
        discriminacao="Honorarios advocaticios ref. outubro|Processo 123",
    )
    base.update(kw)
    return base
