"""Cadastro fiscal do cliente da MayaCorp: uma fonte só.

O cadastro completo (tipo de pessoa, CPF/CNPJ, inscrições, endereço, e-mails, telefones, pessoas de contato) é o
`Tomador` do banco do admin, o mesmo registro de Cadastros › Clientes e o que vai na NFS-e. O `Cliente` do controle
aponta para ele (`tomador_id`) e continua dono só do que é comercial (plano, ciclo, teste, situação, indicação,
observação interna). Nome, documento, e-mail do financeiro, telefone e responsável do `Cliente` são uma CÓPIA do
cadastro, refeita aqui toda vez que ele muda, porque o login, a cobrança, a régua e os contratos leem essas colunas.

Regras da cópia (`do_tomador`):
- e-mail do financeiro = o 1º e-mail do cadastro (recebe cobranças, contratos e a nota);
- telefone = o 1º telefone do cadastro;
- responsável = a pessoa de contato marcada como principal (sem marca, a 1ª da lista).
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import object_session

from app.controle.models import Cliente, SessaoControle

log = logging.getLogger(__name__)


def _dig(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def formatar_telefone(v) -> str | None:
    d = _dig(v)
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    return d or None


def email_financeiro(t) -> str | None:
    return next((e.strip().lower() for e in (t.emails or []) if e and e.strip()), None)


def responsavel(t) -> str | None:
    pessoas = [p for p in (t.contatos or []) if (p.get("nome") or "").strip()]
    p = next((x for x in pessoas if x.get("principal")), pessoas[0] if pessoas else None)
    return p["nome"].strip()[:150] if p else None


def telefone(t) -> str | None:
    tels = t.telefones or []
    return formatar_telefone((tels[0].get("numero") if tels else None) or t.telefone)


def do_tomador(t) -> dict:
    """O que o controle copia do cadastro completo."""
    return {"nome": (t.nome or "")[:200], "documento": _dig(t.cpf_cnpj)[:14] or None,
            "email_financeiro": email_financeiro(t), "telefone": telefone(t), "responsavel": responsavel(t)}


def aplicar_no_cliente(c: Cliente, t) -> list[str]:
    """Copia o cadastro para a ficha do controle. Devolve os campos que mudaram."""
    mudou = []
    for campo, valor in do_tomador(t).items():
        if campo == "nome" and not valor:
            continue
        if getattr(c, campo) != valor:
            setattr(c, campo, valor)
            mudou.append(campo)
    return mudou


def _tel(numero: str) -> dict:
    return {"numero": numero, "tipo": "comercial", "ramal": None, "descricao": None}


def por_na_frente(t, *, email: str | None = None, telefone: str | None = None, responsavel: str | None = None) -> None:
    """Põe um dado da ficha curta na posição que o controle lê (1º e-mail, 1º telefone, contato principal), sem
    apagar nada do que o cadastro já tinha: o que estava na frente continua na lista, logo atrás."""
    if email and email.strip():
        email = email.strip().lower()
        nova = [email, *[e for e in (t.emails or []) if e and e.strip().lower() != email]]
        if nova != list(t.emails or []):
            t.emails = nova
    d = _dig(telefone)
    if 8 <= len(d) <= 20:
        tels = [dict(x) for x in (t.telefones or [])]
        if not tels and 8 <= len(_dig(t.telefone)) <= 20 and _dig(t.telefone) != d:
            tels = [_tel(_dig(t.telefone))]  # cadastro antigo, só com o telefone solto
        atual = next((x for x in tels if _dig(x.get("numero")) == d), None)
        nova = [atual or _tel(d), *[x for x in tels if x is not atual]]
        if nova != list(t.telefones or []):
            t.telefones = nova
        t.telefone = d
    if responsavel and responsavel.strip():
        nome = responsavel.strip()
        pessoas = [dict(x) for x in (t.contatos or [])]
        alvo = next((x for x in pessoas if (x.get("nome") or "").strip().lower() == nome.lower()), None)
        if alvo is None:
            alvo = {"nome": nome[:150], "cargo": None, "email": None, "telefone": None, "celular": None,
                    "whatsapp": False, "recebe_notas": False, "principal": False, "observacao": None}
            pessoas.append(alvo)
        for x in pessoas:
            x["principal"] = x is alvo
        if pessoas != list(t.contatos or []):
            t.contatos = pessoas


def de_outro(c: Cliente, tomador_id: int) -> Cliente | None:
    """Outro cliente que já usa este cadastro (um cadastro fiscal é de um cliente só)."""
    ctl = object_session(c)
    ctl.flush()  # a sessão do controle não dá flush sozinha: sem isto, dois clientes ligados na mesma rodada não se veem
    return ctl.scalar(select(Cliente).where(Cliente.tomador_id == tomador_id, Cliente.id != c.id))


def _tipo(doc: str | None) -> str:
    return "PF" if doc and len(doc) == 11 else "PJ"


def ligar(db, tenant_id: int, c: Cliente):
    """Devolve o cadastro completo do cliente, ligando na primeira vez (idempotente). Na primeira vez acha o cadastro
    que já existe (pelo CNPJ/CPF; sem ele, pelo nome) ou cria um; o que a ficha curta tinha e o cadastro não tinha é
    levado para ele, e o que o cadastro já tinha fica. Devolve None quando o CNPJ/CPF já é o cadastro de OUTRO cliente:
    aí nada é ligado nem copiado (ver `conflito`).

    `db` é a sessão do banco do admin; `c` está numa sessão do controle. Quem chama dá o commit nas duas."""
    from app.modules.rpa_nfse.models import Tomador

    if c.tipo == "mayacorp":
        return None
    if c.tomador_id:
        t = db.get(Tomador, c.tomador_id)
        if t is not None and t.tenant_id == tenant_id:
            return t
        c.tomador_id = None  # o cadastro foi apagado: liga de novo
    doc = _dig(c.documento) or None
    t = db.scalar(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj == doc)) if doc else None
    if t is not None and de_outro(c, t.id):
        return None
    if t is None:
        homonimos = db.scalars(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.nome == c.nome)
                               .order_by(Tomador.id))
        # pelo nome só quando os documentos não brigam (um dos dois está vazio) e o cadastro não é de outro cliente
        t = next((x for x in homonimos if not (doc and x.cpf_cnpj) and not de_outro(c, x.id)), None)
    if t is None:
        t = Tomador(tenant_id=tenant_id, tipo=_tipo(doc), nome=c.nome, cpf_cnpj=doc, emails=[], enderecos=[],
                    contatos=[], telefones=[])
        db.add(t)
    if not (t.nome or "").strip():
        t.nome = c.nome
    if doc and not t.cpf_cnpj:
        t.cpf_cnpj, t.tipo = doc, _tipo(doc)
    por_na_frente(t, email=c.email_financeiro, telefone=c.telefone, responsavel=c.responsavel)
    db.flush()
    antes = {k: getattr(c, k) for k in do_tomador(t)}
    c.tomador_id = t.id
    for campo in aplicar_no_cliente(c, t):
        if antes[campo]:  # fica no log do deploy o que a ligação mudou numa ficha que já tinha valor
            log.warning("Cadastro do cliente %s: %s passou de %r para %r (vale o cadastro completo).", c.slug, campo,
                        antes[campo], getattr(c, campo))
    return t


def conflito(db, tenant_id: int, c: Cliente) -> str | None:
    """Por que o cliente ficou sem cadastro ligado: o CNPJ/CPF dele é o cadastro de outro cliente."""
    from app.modules.rpa_nfse.models import Tomador

    doc = _dig(c.documento)
    if c.tomador_id or not doc:
        return None
    t = db.scalar(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj == doc))
    outro = de_outro(c, t.id) if t is not None else None
    return f"o CNPJ/CPF é o mesmo do cliente {outro.nome}; corrija o documento de um dos dois" if outro else None


def situacao(db, tenant_id: int, c: Cliente, t) -> dict:
    """O que a tela mostra do cadastro: se está pronto para a nota e, se não, o que falta."""
    from app.modules.rpa_nfse import service as nfse

    if t is None:
        motivo = conflito(db, tenant_id, c)
        return {"tomador_id": None, "completo": False, "conflito": motivo,
                "pendencias": [motivo] if motivo else ["o cadastro completo"]}
    falta = nfse.pendencias_para_nota(t)
    return {"tomador_id": t.id, "completo": not falta, "conflito": None, "pendencias": falta}


def conferir(db, tenant_id: int, clientes: list[Cliente]) -> dict[int, dict]:
    """Para cada cliente: liga o que ainda não está ligado e refaz a cópia se o cadastro mudou por outro caminho
    (importação de planilha, nota emitida, MCP). Devolve a situação de cada um. Quem chama dá o commit nas duas sessões."""
    saida = {}
    for c in clientes:
        t = ligar(db, tenant_id, c)
        if t is not None:
            aplicar_no_cliente(c, t)
        saida[c.id] = situacao(db, tenant_id, c, t)
    db.flush()
    return saida


def gravar(db, tenant_id: int, c: Cliente, dados: dict):
    """Grava o cadastro completo vindo do formulário (os dados já validados de `TomadorIn`) e refaz a cópia."""
    from app.modules.rpa_nfse.models import Tomador

    t = db.get(Tomador, c.tomador_id) if c.tomador_id else None
    if t is None:
        doc = _dig(dados.get("cpf_cnpj")) or None
        t = db.scalar(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj == doc)) if doc else None
        if t is not None and de_outro(c, t.id):
            raise ValueError(f"Já existe o cliente {de_outro(c, t.id).nome} com este CNPJ/CPF.")
        if t is None:
            t = Tomador(tenant_id=tenant_id, emails=[], enderecos=[], contatos=[], telefones=[])
            db.add(t)
    for k, v in dados.items():
        setattr(t, k, v)
    db.flush()
    c.tomador_id = t.id
    aplicar_no_cliente(c, t)
    return t


def empurrar(db, tenant_id: int, c: Cliente, *, nome: str | None = None, documento: str | None = None,
             email_financeiro: str | None = None, telefone: str | None = None, responsavel: str | None = None):
    """Ficha curta (rotas antigas, aprovação do site, "dar acesso"): o que veio preenchido entra no cadastro completo
    e volta copiado para o controle. Campo vazio não mexe em nada."""
    doc = _dig(documento) or None
    if c.tomador_id is None:  # ainda sem cadastro: a ficha curta vale e a ligação é tentada com ela
        if nome:
            c.nome = nome
        if doc:
            c.documento = doc
        for campo, v in (("email_financeiro", email_financeiro), ("telefone", telefone), ("responsavel", responsavel)):
            if v:
                setattr(c, campo, v)
    t = ligar(db, tenant_id, c)
    if t is None:
        return None
    if nome:
        t.nome = nome
    if doc and doc != t.cpf_cnpj:
        t.cpf_cnpj, t.tipo = doc, _tipo(doc)
    por_na_frente(t, email=email_financeiro, telefone=telefone, responsavel=responsavel)
    db.flush()
    aplicar_no_cliente(c, t)
    return t


def tomador_alterado(t) -> None:
    """O cadastro foi salvo em Cadastros › Clientes do admin: a ficha do controle acompanha."""
    with SessaoControle() as ctl:
        for c in ctl.scalars(select(Cliente).where(Cliente.tomador_id == t.id)):
            aplicar_no_cliente(c, t)
        ctl.commit()


def cliente_do_tomador(tomador_id: int) -> str | None:
    with SessaoControle() as ctl:
        return ctl.scalar(select(Cliente.nome).where(Cliente.tomador_id == tomador_id))


def ligar_todos() -> int:
    """Liga todos os clientes ao cadastro completo (roda no migrar de todo deploy; idempotente, não duplica cadastro)."""
    from app.controle import service
    from app.core import tenancy
    from app.core.db import SessionLocal
    from app.core.models import Tenant

    esc = service.escritorio_mayacorp()
    if esc is None:
        return 0
    with SessaoControle() as ctl, tenancy.usando(esc), SessionLocal() as db:
        tenant_id = db.scalar(select(Tenant.id).order_by(Tenant.id))
        if tenant_id is None:
            return 0
        clientes = list(ctl.scalars(select(Cliente).where(Cliente.tipo != "mayacorp").order_by(Cliente.id)))
        conferir(db, tenant_id, clientes)
        db.commit()  # primeiro o cadastro: se o controle falhar, a próxima rodada acha o mesmo cadastro e liga
        ctl.commit()
        return len(clientes)
