"""Cria (ou atualiza) um usuário pelo terminal, para o primeiro acesso de um ambiente novo.

    uv run python -m app.criar_usuario --login admin --nome "Jefferson" --email voce@mayacorp.com.br --perfil admin

A senha é pedida no terminal (ou lida da entrada padrão) e nunca fica em arquivo.
Depois do primeiro acesso, usuários e senhas são gerenciados em Configurações › Usuários.
"""

import argparse
import getpass
import sys

from sqlalchemy import or_, select

from app.core import audit
from app.core.db import SessionLocal
from app.core.models import Perfil, Tenant, Usuario
from app.core.security import hash_senha, validar_politica_senha


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--login", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--perfil", choices=[p.value for p in Perfil], default="admin")
    ap.add_argument("--tenant", default="cfme", help="slug do cliente (padrão: cfme)")
    ap.add_argument("--equipe-mayacorp", action="store_true",
                    help="libera as configurações da plataforma (ex.: chave da IA); só se concede por aqui")
    a = ap.parse_args()

    senha = getpass.getpass("Senha: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\r\n")
    if erro := validar_politica_senha(senha):
        sys.exit(erro)

    with SessionLocal() as db:
        tenant = db.scalar(select(Tenant).where(Tenant.slug == a.tenant))
        if not tenant:
            sys.exit(f"Cliente '{a.tenant}' não existe. Rode antes: python -m app.seed")
        login, email = a.login.strip().lower(), a.email.strip().lower()
        u = db.scalar(select(Usuario).where(or_(Usuario.login == login, Usuario.email == email)))
        novo = u is None
        if novo:
            u = Usuario(tenant_id=tenant.id, email=email)
            db.add(u)
        u.login, u.email, u.nome, u.perfil = login, email, a.nome, Perfil(a.perfil)
        u.equipe_mayacorp = a.equipe_mayacorp or bool(u.equipe_mayacorp)
        u.senha_hash = hash_senha(senha)
        u.ativo, u.convite_pendente, u.tentativas_falhas, u.bloqueado_ate = True, False, 0, None
        db.flush()
        audit.registrar(db, tenant_id=tenant.id, usuario=None, acao="usuario.criar_terminal", entidade="usuario",
                        entidade_id=u.id, descricao=f"{'Criado' if novo else 'Atualizado'} pelo terminal: {login}")
        db.commit()
        print(f"Usuário '{login}' {'criado' if novo else 'atualizado'} ({u.perfil.value}).")


if __name__ == "__main__":
    main()
