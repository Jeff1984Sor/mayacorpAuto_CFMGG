"""Terminal do banco de controle (um banco por escritório).

    python -m app.controle.cli migrar                      # controle + banco de cada escritório
    python -m app.controle.cli registrar-principal --slug cfme --nome "CFME Advogados"
    python -m app.controle.cli criar --slug silva --nome "Silva Advogados" --admin-nome "Ana" --admin-email ana@x.com --teste 15
    python -m app.controle.cli criar-admin --admin-nome "Jefferson" --admin-email voce@mayacorp.com.br --dominio admin.mayajus.com.br
    python -m app.controle.cli dominio --slug cfme --host sistema.cfme.com.br
    python -m app.controle.cli sincronizar-logins --slug cfme
    python -m app.controle.cli listar
"""

import argparse
import sys

import app.controle.sincronia  # noqa: F401
from app.controle import service
from app.controle.models import Cliente, SessaoControle
from app.core import tenancy


def main() -> None:
    ap = argparse.ArgumentParser(prog="app.controle.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrar")
    sub.add_parser("listar")
    p = sub.add_parser("registrar-principal", help="o escritório que já usa o DATABASE_URL (CFME)")
    p.add_argument("--slug", required=True)
    p.add_argument("--nome", required=True)
    p = sub.add_parser("criar", help="escritório novo, com banco próprio")
    p.add_argument("--slug", required=True)
    p.add_argument("--nome", required=True)
    p.add_argument("--admin-nome", required=True)
    p.add_argument("--admin-email", required=True)
    p.add_argument("--teste", type=int, help="dias de teste grátis")
    p.add_argument("--dominio", action="append", default=[])
    p = sub.add_parser("criar-admin", help="o admin da MayaCorp (banco próprio, mesmos módulos + menu MayaCorp)")
    p.add_argument("--admin-nome", required=True)
    p.add_argument("--admin-email", required=True)
    p.add_argument("--login", help="entrar com este usuário além do e-mail")
    p.add_argument("--senha-stdin", action="store_true", help="lê a senha da entrada (sem ela, vai convite)")
    p.add_argument("--dominio", action="append", default=[])
    p = sub.add_parser("dominio")
    p.add_argument("--slug", required=True)
    p.add_argument("--host", required=True)
    p = sub.add_parser("sincronizar-logins")
    p.add_argument("--slug", required=True)
    a = ap.parse_args()
    if not tenancy.multi():
        if a.cmd == "migrar":  # o deploy sempre chama: sem banco de controle, nada a fazer
            print(f"Sem o banco {tenancy.BANCO_CONTROLE}: um banco só, nada a migrar no controle.")
            return
        sys.exit(f"Crie o banco {tenancy.BANCO_CONTROLE} no servidor do MayaJus para usar um banco por escritório.")

    try:
        if a.cmd == "migrar":
            print("Migrados:", ", ".join(service.migrar_todos()) or "(só o controle)")
        elif a.cmd == "registrar-principal":
            service.migrar_controle()
            service.registrar(a.slug, a.nome, banco=None)
            print(f"{a.slug} registrado no banco principal; logins no catálogo: {service.sincronizar_todos(a.slug)}")
        elif a.cmd == "criar":
            _, link = service.provisionar(a.slug, a.nome, admin_nome=a.admin_nome, admin_email=a.admin_email,
                                          dias_teste=a.teste, dominios=a.dominio)
            print(f"Escritório {a.slug} criado no banco {service.nome_do_banco(a.slug)}.\nConvite do administrador: {link}")
        elif a.cmd == "criar-admin":
            senha = sys.stdin.readline().rstrip("\r\n") if a.senha_stdin else None
            _, link = service.provisionar("mayacorp", "MayaCorp", admin_nome=a.admin_nome, admin_email=a.admin_email,
                                          dominios=a.dominio, tipo="mayacorp", admin_login=a.login, admin_senha=senha)
            print(f"Admin MayaCorp criado no banco {service.nome_do_banco('mayacorp')}."
                  + (f"\nConvite: {link}" if link else " Entre com o login e a senha informados."))
        elif a.cmd == "dominio":
            with SessaoControle() as db:
                c = db.query(Cliente).filter_by(slug=a.slug).one_or_none()
                if not c:
                    sys.exit(f"Escritório {a.slug} não existe.")
                service.adicionar_dominio(db, c, a.host)
                db.commit()
            print(f"{a.host} → {a.slug}")
        elif a.cmd == "sincronizar-logins":
            print(f"{service.sincronizar_todos(a.slug)} usuário(s) no catálogo.")
        elif a.cmd == "listar":
            with SessaoControle() as db:
                for c in db.query(Cliente).order_by(Cliente.id):
                    doms = ", ".join(d.host for d in c.dominios) or "-"
                    print(f"{c.slug:20} {c.status:10} {c.banco or '(principal)':28} {doms}")
    except service.RegraControle as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
