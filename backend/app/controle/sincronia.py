"""Mantém o catálogo de logins do controle em dia: login ou e-mail de usuário criado/alterado no banco de um
escritório é registrado no controle depois do commit. Importado pela API, pelo worker e pelo terminal.
"""

from sqlalchemy import event, inspect

from app.core import tenancy
from app.core.db import SessaoDoEscritorio
from app.core.models import Usuario

_CHAVE = "catalogo_logins"


@event.listens_for(SessaoDoEscritorio, "after_flush")
def _anotar(session, _ctx) -> None:
    if not tenancy.multi() or tenancy.atual() is None:
        return
    for obj in session.new | session.dirty:
        if not isinstance(obj, Usuario):
            continue
        estado = inspect(obj)
        if obj in session.new or estado.attrs.email.history.has_changes() or estado.attrs.login.history.has_changes():
            session.info.setdefault(_CHAVE, {})[obj.id] = [obj.login, obj.email]


@event.listens_for(SessaoDoEscritorio, "after_commit")
def _gravar(session) -> None:
    pendentes = session.info.pop(_CHAVE, None)
    esc = tenancy.atual()
    if not pendentes or esc is None:
        return
    from app.controle import service

    for uid, chaves in pendentes.items():
        service.sincronizar_usuario(esc.slug, uid, chaves)


@event.listens_for(SessaoDoEscritorio, "after_rollback")
def _descartar(session) -> None:
    session.info.pop(_CHAVE, None)
