"""Configuração central da plataforma, lida de variáveis de ambiente (.env)."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_JWT_DEV = "dev-inseguro-troque-em-producao-0000"
_MASTER_DEV = "q5w0m9cY3G1o4oE5d2u2x2gVQv0q6Q7k1tq9a0c3Zf8="

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MayaCorp Automações"
    ambiente: Literal["dev", "hml", "prod"] = "dev"
    database_url: str = f"sqlite:///{(BASE_DIR / 'data' / 'dev.db').as_posix()}"
    storage_dir: Path = BASE_DIR / "storage"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Segurança
    jwt_secret: str = _JWT_DEV
    jwt_access_minutes: int = 30
    jwt_refresh_days: int = 14
    # Chave Fernet (base64 urlsafe 32 bytes) usada para cifrar o .pfx e a senha do certificado.
    master_key: str = _MASTER_DEV
    login_max_tentativas: int = 5
    login_bloqueio_minutos: int = 15

    # Prefeitura de São Paulo: o modo (simulado / teste / produção) é escolhido em Configurações › Prefeitura.
    # Aqui ficam só os parâmetros técnicos do Web Service.
    prefeitura_url: str = "https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx"
    prefeitura_url_v2: str = "https://nfews.prefeitura.sp.gov.br/lotenfe.asmx"
    prefeitura_timeout: float = 60.0
    prefeitura_tentativas: int = 4
    lote_tamanho: int = 50

    # E-mail
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "CFME Advogados <nao-responda@mayacorp.com.br>"

    frontend_url: str = "http://localhost:3000"

    # Dev: a API processa a fila em threads e aplica as migrations ao subir.
    # Produção: worker_embutido=false (o serviço app.worker processa) e migrations no deploy.
    worker_embutido: bool = True
    migrar_na_subida: bool = True

    @model_validator(mode="after")
    def _segredos_fora_do_dev(self):
        if self.ambiente != "dev" and (self.jwt_secret == _JWT_DEV or self.master_key == _MASTER_DEV):
            raise ValueError("Em hml/prod defina JWT_SECRET e MASTER_KEY próprios no .env.")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
