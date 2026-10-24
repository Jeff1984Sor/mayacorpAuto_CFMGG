"""Hash de senha (Argon2), tokens JWT e criptografia simétrica do certificado (Fernet)."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from cryptography.fernet import Fernet
from pwdlib import PasswordHash

from app.core.config import settings

_hasher = PasswordHash.recommended()
_fernet = Fernet(settings.master_key.encode())

TokenTipo = Literal["access", "refresh", "reset"]


def hash_senha(senha: str) -> str:
    return _hasher.hash(senha)


def verificar_senha(senha: str, senha_hash: str) -> bool:
    try:
        return _hasher.verify(senha, senha_hash)
    except Exception:
        return False


def criar_token(sub: str, tipo: TokenTipo, extra: dict[str, Any] | None = None) -> str:
    duracao = {
        "access": timedelta(minutes=settings.jwt_access_minutes),
        "refresh": timedelta(days=settings.jwt_refresh_days),
        "reset": timedelta(hours=2),
    }[tipo]
    now = datetime.now(UTC)
    payload = {"sub": sub, "typ": tipo, "iat": now, "exp": now + duracao, "jti": secrets.token_hex(8)}
    payload.update(extra or {})
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decodificar_token(token: str, tipo: TokenTipo) -> dict[str, Any]:
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if payload.get("typ") != tipo:
        raise jwt.InvalidTokenError("tipo de token inválido")
    return payload


def cifrar(dados: bytes) -> bytes:
    return _fernet.encrypt(dados)


def decifrar(dados: bytes) -> bytes:
    return _fernet.decrypt(dados)


def validar_politica_senha(senha: str) -> str | None:
    if len(senha) < 8:
        return "A senha precisa ter pelo menos 8 caracteres."
    if senha.isdigit() or senha.isalpha():
        return "Use letras e números na senha."
    return None
