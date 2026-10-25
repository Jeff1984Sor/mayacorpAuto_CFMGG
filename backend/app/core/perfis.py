"""Perfis de acesso: criação dos padrões e sincronia com o perfil legado (admin/operador/visualizador)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import Perfil, PerfilAcesso, Usuario
from app.core.permissoes import PERFIS_PADRAO


def garantir_padrao(db: Session, tenant_id: int) -> dict[str, PerfilAcesso]:
    """Cria os perfis padrão que faltarem e liga quem está sem perfil ao equivalente do perfil legado."""
    existentes = {p.nome: p for p in db.scalars(select(PerfilAcesso).where(PerfilAcesso.tenant_id == tenant_id))}
    for modelo in PERFIS_PADRAO:
        if modelo["nome"] not in existentes:
            p = PerfilAcesso(tenant_id=tenant_id, **modelo)
            db.add(p)
            existentes[p.nome] = p
    db.flush()
    equivalente = {Perfil.admin: "Administrador", Perfil.operador: "Operador", Perfil.visualizador: "Visualizador"}
    for u in db.scalars(select(Usuario).where(Usuario.tenant_id == tenant_id, Usuario.perfil_acesso_id.is_(None))):
        u.perfil_acesso_id = existentes[equivalente.get(u.perfil, "Visualizador")].id
    return existentes


def perfil_legado(perfil: PerfilAcesso) -> Perfil:
    """O perfil legado acompanha o de acesso: administrador → admin; quem altera algo → operador; senão visualizador."""
    if perfil.administrador:
        return Perfil.admin
    so_leitura = {"comunicador.usar", "ia.usar"}
    altera = any(not p.endswith(".ver") and p not in so_leitura for p in perfil.permissoes or [])
    return Perfil.operador if altera else Perfil.visualizador


def aplicar(u: Usuario, perfil: PerfilAcesso) -> None:
    u.perfil_acesso_id = perfil.id
    u.perfil_acesso = perfil
    u.perfil = perfil_legado(perfil)
