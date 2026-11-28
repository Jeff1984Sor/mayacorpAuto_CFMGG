"""Dados padrão de todo escritório para os tipos de caso: listas configuráveis e áreas de atuação.

Chamado ao criar o escritório (`app.controle.service.provisionar`, `app.seed`) e, para os bancos que já existem, na
leitura das listas (cada módulo garante o seu de forma preguiçosa). Sempre idempotente.
"""

from sqlalchemy.orm import Session


def garantir(db: Session, tenant_id: int) -> int:
    from app.modules.faturamento import listas

    return listas.garantir_seeds(db, tenant_id)
