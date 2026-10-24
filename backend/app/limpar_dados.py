"""Zera os dados de teste antes de colocar um ambiente no ar. **Mantém os usuários.**

    uv run python -m app.limpar_dados --confirmar "LIMPAR TUDO"

Apaga: lotes, RPS, notas, faturas, extratos, e-mails enviados, clientes (tomadores), emissoras,
parâmetros fiscais, certificados, auditoria e os arquivos gerados (PDF/XML/extratos/outbox).
Mantém: usuários (e fotos), cliente/tenant, identidade (nome, logo, cor) e as configurações.

A auditoria é imutável no sistema; aqui ela é zerada uma única vez, de propósito, para o ambiente
começar sem o histórico dos testes. A própria limpeza fica registrada como o primeiro evento.
"""

import argparse
import shutil
import sys
from pathlib import Path

from sqlalchemy import text

from app.core import audit
from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.models import Tenant

# ordem respeita as chaves estrangeiras (filhos antes dos pais)
TABELAS = [
    "envio_email",
    "fatura",
    "nfse",
    "lancamento_extrato",
    "extrato",
    "rps",
    "lote",
    "parametro_fiscal",
    "tomador",
    "emissora",
    "certificado",
    "auditoria",
]
PASTAS_MANTIDAS = {"identidade", "usuarios"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirmar", default="", help='digite exatamente: "LIMPAR TUDO"')
    a = ap.parse_args()
    if a.confirmar != "LIMPAR TUDO":
        sys.exit('Nada foi apagado. Para confirmar: --confirmar "LIMPAR TUDO"')

    contagem = {}
    with engine.begin() as conn:
        if conn.dialect.name == "sqlite":
            conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
        for t in TABELAS:
            contagem[t] = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            conn.execute(text(f"DELETE FROM {t}"))
        if conn.dialect.name == "sqlite":
            conn.exec_driver_sql("PRAGMA foreign_keys=ON")

    storage = Path(settings.storage_dir)
    removidas = []
    if storage.exists():
        for item in storage.iterdir():
            if item.name in PASTAS_MANTIDAS:
                continue
            removidas.append(item.name)
            shutil.rmtree(item) if item.is_dir() else item.unlink()

    with SessionLocal() as db:
        for tenant in db.query(Tenant).all():
            audit.registrar(db, tenant_id=tenant.id, usuario=None, acao="ambiente.limpeza", entidade="sistema",
                            descricao="Dados de teste apagados antes da entrada em operação (usuários mantidos).")
        db.commit()

    print("Apagado:")
    for t, n in contagem.items():
        print(f"  {t:<20} {n}")
    print(f"  arquivos: {', '.join(removidas) or 'nenhum'}")
    print("Usuários, identidade e configurações mantidos.")


if __name__ == "__main__":
    main()
