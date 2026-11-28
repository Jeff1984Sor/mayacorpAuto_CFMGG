"""Regras do cadastro único de pessoas: documento único, o vínculo 1:1 com o cliente, OAB, busca, duplicados e mescla.

O cliente É uma parte: cada cliente (`tomador`) tem exatamente uma Pessoa (`tomador.pessoa_id`, único) e a Pessoa de um
cliente nunca é de outro. Nome, documento e tipo vão do cadastro de clientes para a Pessoa (o cliente emite fatura e
NFS-e, então ele é a fonte). "É cliente" nunca é gravado: vem de existir o vínculo.
"""

import re
from difflib import SequenceMatcher

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.documentos import cnpj_valido, cpf_valido, so_digitos
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.tribunais.cnj import UF_TR
from app.modules.tribunais.models import Parte, Pessoa
from app.modules.tribunais.vinculo import normalizar_nome

UFS = set(UF_TR)
LIMIAR_DUPLICADO = 0.8
TIPO_DO_CLIENTE = {"PF": "fisica", "PJ": "juridica", "EX": "estrangeiro"}
ENTES = {"ente_publico", "autoridade", "orgao_representacao"}
ROTULOS = {
    "tipo_pessoa": {"fisica": "Pessoa física", "juridica": "Pessoa jurídica", "ente_publico": "Ente público",
                    "estrangeiro": "Estrangeiro", "sem_documento": "Sem documento", "autoridade": "Autoridade",
                    "orgao_representacao": "Órgão de representação"},
    "estado_civil": {"solteiro": "Solteiro(a)", "casado": "Casado(a)", "divorciado": "Divorciado(a)", "viuvo": "Viúvo(a)",
                     "separado": "Separado(a)", "uniao_estavel": "União estável"},
    "regime_bens": {"comunhao_parcial": "Comunhão parcial", "comunhao_universal": "Comunhão universal",
                    "separacao_total": "Separação total", "separacao_obrigatoria": "Separação obrigatória",
                    "participacao_final": "Participação final nos aquestos"},
    "tipo_endereco": {"residencial": "Residencial", "comercial": "Comercial", "correspondencia": "Correspondência",
                      "citacao": "Citação"},
    "tipo_contato": {"email": "E-mail", "celular": "Celular", "whatsapp": "WhatsApp", "telefone": "Telefone", "site": "Site"},
    "tipo_inscricao": {"principal": "Principal", "suplementar": "Suplementar", "estagiario": "Estagiário", "provisoria": "Provisória"},
    "situacao_oab": {"regular": "Regular", "suspensa": "Suspensa", "cancelada": "Cancelada", "licenciada": "Licenciada"},
}


class RegraPessoa(ValueError):
    pass


# ------------------------------------------------------------------------------------------------ documento
def documento(p: Pessoa) -> str | None:
    return p.cnpj or p.cpf


def validar_documento(tipo_pessoa: str, doc: str | None, advogado_com_oab: bool = False) -> str | None:
    """Devolve o documento só com dígitos (ou None). CPF para pessoa física, CNPJ para jurídica, com dígito verificador."""
    d = so_digitos(doc)
    if tipo_pessoa == "sem_documento":
        if d:
            raise RegraPessoa('Pessoa "sem documento" não leva CPF/CNPJ: escolha pessoa física ou jurídica.')
        return None
    if not d:
        if tipo_pessoa == "fisica" and not advogado_com_oab:
            raise RegraPessoa("Informe o CPF (ou cadastre como “sem documento”).")
        if tipo_pessoa == "juridica":
            raise RegraPessoa("Informe o CNPJ (ou cadastre como “sem documento”).")
        return None
    if tipo_pessoa == "fisica" and len(d) != 11:
        raise RegraPessoa("Pessoa física precisa de CPF (11 dígitos).")
    if tipo_pessoa in ("juridica", *ENTES) and len(d) != 14:
        raise RegraPessoa("Informe o CNPJ com 14 dígitos.")
    if len(d) == 11 and not cpf_valido(d):
        raise RegraPessoa("CPF inválido: confira os dígitos.")
    if len(d) == 14 and not cnpj_valido(d):
        raise RegraPessoa("CNPJ inválido: confira os dígitos.")
    if len(d) not in (11, 14):
        raise RegraPessoa("CPF tem 11 dígitos e CNPJ tem 14.")
    return d


def clientes_de(db: Session, pessoa_ids) -> dict[int, int]:
    """{pessoa → código do cliente (id do tomador)} para as pessoas que são clientes."""
    from app.modules.rpa_nfse.models import Tomador

    ids = {i for i in pessoa_ids if i}
    return dict(db.execute(select(Tomador.pessoa_id, Tomador.id).where(Tomador.pessoa_id.in_(ids))).all()) if ids else {}


def por_documento(db: Session, tenant_id: int, doc: str | None, exceto_id: int | None = None,
                  ligar_cliente: bool = False) -> Pessoa | None:
    """A pessoa do escritório com este CPF/CNPJ (a do cliente tem preferência).

    `ligar_cliente` (em tudo que grava: cadastro de pessoa, parte de caso, parte vinda do tribunal): se o documento é de
    um cliente que ainda não tem a sua Pessoa, ela é criada ou ligada agora (`ligar_cliente_pelo_documento`)."""
    d = so_digitos(doc)
    if len(d) not in (11, 14):
        return None
    if ligar_cliente:
        do_cliente = ligar_cliente_pelo_documento(db, tenant_id, d)
        if do_cliente is not None and do_cliente.id != exceto_id:
            return do_cliente
    sel = select(Pessoa).where(Pessoa.tenant_id == tenant_id, (Pessoa.cpf if len(d) == 11 else Pessoa.cnpj) == d,
                               Pessoa.mesclada_em_id.is_(None))
    if exceto_id:
        sel = sel.where(Pessoa.id != exceto_id)
    achadas = list(db.scalars(sel.order_by(Pessoa.id)))
    if len(achadas) > 1:
        de_cliente = clientes_de(db, [p.id for p in achadas])
        achadas.sort(key=lambda p: (p.id not in de_cliente, p.id))
    return achadas[0] if achadas else None


def definir_documento(p: Pessoa, doc: str | None) -> None:
    d = so_digitos(doc)
    p.cpf = d if len(d) == 11 else None
    p.cnpj = d if len(d) == 14 else None
    if d:
        p.documento_mascarado, p.documento_parcial = False, None


# ------------------------------------------------------------------------------------------------ cliente × pessoa
def sincronizar_clientes(session: Session, tomadores) -> None:
    """Chamado antes de todo flush com clientes novos ou alterados (rpa_nfse.models): garante a Pessoa de cada um.

    Com o mesmo CPF/CNPJ já no cadastro de pessoas, o cliente é ligado a ela (nunca cria outra). Nome, documento e
    tipo da Pessoa seguem o cliente."""
    from app.modules.rpa_nfse.models import Tomador

    with session.no_autoflush:
        for t in tomadores:
            if t.tenant_id is None or not (t.nome or "").strip():
                continue
            doc = so_digitos(t.cpf_cnpj)
            p = session.get(Pessoa, t.pessoa_id) if t.pessoa_id else None
            if p is None and len(doc) in (11, 14):
                candidata = por_documento(session, t.tenant_id, doc)
                outro = session.scalar(select(Tomador.id).where(
                    Tomador.pessoa_id == candidata.id, Tomador.id != (t.id or 0))) if candidata else None
                p = candidata if candidata is not None and outro is None else None
                if p is not None:
                    t.pessoa_id = p.id
            tipo = TIPO_DO_CLIENTE.get(t.tipo, "juridica")
            if p is None:
                end = {k: getattr(t, k) for k in ("cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf")
                       if getattr(t, k)}
                valores = {"tenant_id": t.tenant_id, "tipo_pessoa": tipo, "nome": t.nome[:300],
                           "nome_normalizado": normalizar_nome(t.nome)[:300], "cpf": doc if len(doc) == 11 else None,
                           "cnpj": doc if len(doc) == 14 else None, "email": next(iter(t.emails or []), None),
                           "inscricao_estadual": t.ie, "inscricao_municipal": t.im,
                           "enderecos": [{"tipo": "comercial", "principal": True, **end}] if end else []}
                t.pessoa_id = session.execute(Pessoa.__table__.insert().values(**valores)).inserted_primary_key[0]
                continue
            if p.nome != t.nome[:300]:
                p.nome, p.nome_normalizado = t.nome[:300], normalizar_nome(t.nome)[:300]
            if p.tipo_pessoa != tipo and not (tipo == "juridica" and p.tipo_pessoa in ENTES):
                p.tipo_pessoa = tipo
            if (documento(p) or "") != doc and (doc or documento(p)):
                definir_documento(p, doc)
            if not p.ativo:
                p.ativo = True


def garantir_pessoa_do_cliente(db: Session, tomador) -> int:
    """A Pessoa do cliente (cria ou liga se ainda não houver). Usado pela migração e pelos envolvimentos."""
    if not tomador.pessoa_id:
        sincronizar_clientes(db, [tomador])
        db.flush()
    return tomador.pessoa_id


def ligar_cliente_pelo_documento(db: Session, tenant_id: int, doc: str | None) -> Pessoa | None:
    """O cliente é uma parte cadastrada uma vez só. Cliente do escritório com este CPF/CNPJ e ainda sem a sua Pessoa
    (banco anterior à migração): a Pessoa dele nasce agora, ou a que já existe com o documento passa a ser a dele.
    Devolve essa Pessoa; `None` quando não há cliente nessa situação."""
    from app.modules.rpa_nfse.models import Tomador

    d = so_digitos(doc)
    if len(d) not in (11, 14):
        return None
    db.flush()  # a procura abaixo enxerga a pessoa que acabou de receber o documento
    t = db.scalar(select(Tomador).where(Tomador.tenant_id == tenant_id, Tomador.cpf_cnpj == d, Tomador.pessoa_id.is_(None))
                  .order_by(Tomador.id).limit(1))
    if t is None:
        return None
    pessoa_id = garantir_pessoa_do_cliente(db, t)
    return db.get(Pessoa, pessoa_id) if pessoa_id else None


# ------------------------------------------------------------------------------------------------ OAB
_RX_OAB = re.compile(r"^(\d{1,7})-?([A-Z])?$")


def normalizar_oab(numero: str | None) -> str:
    """Só dígitos e, se houver, a letra: "123.456" → "123456"; "123456a" → "123456-A"."""
    m = _RX_OAB.match(re.sub(r"[\s./]", "", (numero or "").upper()))
    if not m or int(m.group(1)) == 0:
        raise RegraPessoa("Número da OAB inválido: use só os dígitos (ex.: 123456) ou os dígitos e a letra (123456-A).")
    return str(int(m.group(1))) + (f"-{m.group(2)}" if m.group(2) else "")


def validar_uf(uf: str | None) -> str:
    u = (uf or "").strip().upper()
    if u not in UFS:
        raise RegraPessoa("UF da OAB inválida.")
    return u


def exibir_oab(numero: str, uf: str) -> str:
    """OAB/SP 123.456"""
    digitos, _, letra = numero.partition("-")
    return f"OAB/{uf} {int(digitos):,}".replace(",", ".") + (f"-{letra}" if letra else "")


def ler_oab(texto: str | None) -> tuple[str, str] | None:
    """Acha número e UF num texto: "123456/SP", "123.456-SP", "SP 123456", "OAB/SP 123.456-A"."""
    t = (texto or "").upper().replace("OAB", " ")
    num = r"(\d{1,3}(?:\.\d{3})+|\d{1,7})"
    m = re.search(rf"(?<![A-Z])([A-Z]{{2}})[\s/:.-]*{num}(?:-?([A-Z])(?![A-Z]))?", t)
    if m and m.group(1) in UFS:
        uf, numero, letra = m.group(1), m.group(2), m.group(3)
    else:
        m = re.search(rf"{num}(?:-?([A-Z])(?![A-Z]))?[\s/-]*([A-Z]{{2}})(?![A-Z])", t)
        if not m or m.group(3) not in UFS:
            return None
        numero, letra, uf = m.group(1), m.group(2), m.group(3)
    try:
        return normalizar_oab(numero + (f"-{letra}" if letra else "")), uf
    except RegraPessoa:
        return None


def advogado_por_oab(db: Session, tenant_id: int, numero: str, uf: str) -> Advogado | None:
    return db.scalar(select(Advogado).join(AdvogadoOab, AdvogadoOab.advogado_id == Advogado.id).where(
        Advogado.tenant_id == tenant_id, AdvogadoOab.numero == numero, AdvogadoOab.uf == uf).order_by(Advogado.id).limit(1))


# ------------------------------------------------------------------------------------------------ busca e duplicados
def filtro_busca(q: str):
    """Nome (sem acento, qualquer caixa), nome fantasia ou documento com ou sem máscara."""
    conds = []
    nome = normalizar_nome(q)
    if nome:
        conds.append(Pessoa.nome_normalizado.like(f"%{nome}%"))
        conds.append(func.lower(Pessoa.nome_fantasia).like(f"%{q.strip().lower()}%"))
    digitos = so_digitos(q)
    if len(digitos) >= 3 and not re.search(r"[A-Za-zÀ-ÿ]", q):
        conds += [Pessoa.cpf.like(f"%{digitos}%"), Pessoa.cnpj.like(f"%{digitos}%")]
    return or_(*conds) if conds else None


def semelhantes(db: Session, p: Pessoa) -> list[tuple[Pessoa, float, str]]:
    """Possíveis duplicados: mesmo documento ou nome parecido (calculado aqui, sem extensão do banco)."""
    doc = documento(p)
    saida = []
    for o in db.scalars(select(Pessoa).where(Pessoa.tenant_id == p.tenant_id, Pessoa.id != p.id, Pessoa.ativo,
                                             Pessoa.mesclada_em_id.is_(None))):
        odoc = documento(o)
        if doc and odoc:
            if doc == odoc:
                saida.append((o, 1.0, "Mesmo CPF/CNPJ"))
            continue  # documentos diferentes: são pessoas diferentes
        sm = SequenceMatcher(None, p.nome_normalizado, o.nome_normalizado)
        if sm.quick_ratio() < LIMIAR_DUPLICADO:
            continue
        r = sm.ratio()
        if r >= LIMIAR_DUPLICADO:
            saida.append((o, round(r, 2), "Mesmo nome" if r == 1 else "Nome parecido"))
    return sorted(saida, key=lambda x: (-x[1], x[0].nome))


# ------------------------------------------------------------------------------------------------ uso e mescla
def _envolvimento():
    try:
        from app.modules.faturamento import envolvimento
    except ImportError:  # pragma: no cover
        return None
    return envolvimento


def em_uso(db: Session, p: Pessoa) -> dict[str, int]:
    """Onde a pessoa aparece (pessoa em uso nunca é excluída, só desativada)."""
    from app.modules.faturamento.tipos_caso import CasoConsultivo

    conta = lambda sel: db.scalar(sel) or 0  # noqa: E731
    uso = {
        "processos": conta(select(func.count()).select_from(Parte).where(Parte.pessoa_id == p.id)),
        "representados": conta(select(func.count()).select_from(Pessoa).where(Pessoa.representante_legal_id == p.id)),
        "solicitacoes": conta(select(func.count()).select_from(CasoConsultivo).where(CasoConsultivo.solicitante_id == p.id)),
        "sociedade_de": conta(select(func.count()).select_from(Advogado).where(Advogado.sociedade_id == p.id)),
        "mescladas": conta(select(func.count()).select_from(Pessoa).where(Pessoa.mesclada_em_id == p.id)),
    }
    env = _envolvimento()
    if env:
        uso.update(env.uso_da_pessoa(db, p.id))
    return {k: v for k, v in uso.items() if v}


_CAMPOS_COMPLETAR = ("nome_social", "nome_fantasia", "documento_estrangeiro", "rg", "rg_orgao_emissor", "rg_uf", "sexo",
                     "data_nascimento", "data_fundacao", "nacionalidade", "naturalidade", "estado_civil", "regime_bens",
                     "uniao_estavel", "profissao", "nome_mae", "nome_pai", "pis_nit", "ctps", "inscricao_estadual",
                     "inscricao_municipal", "cnae_principal", "email", "representante_legal_id", "base_legal_lgpd",
                     "consentimento_lgpd")


def mesclar(db: Session, a: Pessoa, b: Pessoa) -> tuple[Pessoa, Pessoa]:
    """Junta duas pessoas: (a que fica, a que foi desativada). `a` é a principal pedida; se só `b` for de cliente,
    as duas trocam de lugar (a Pessoa de um cliente nunca é desativada)."""
    from app.modules.faturamento.tipos_caso import CasoConsultivo

    if a.id == b.id:
        raise RegraPessoa("Escolha duas pessoas diferentes.")
    if a.tenant_id != b.tenant_id:
        raise RegraPessoa("Pessoa não encontrada.")
    if a.mesclada_em_id or b.mesclada_em_id:
        raise RegraPessoa("Uma das pessoas já foi mesclada em outra.")
    cli = clientes_de(db, [a.id, b.id])
    if a.id in cli and b.id in cli:
        raise RegraPessoa(f"{a.nome} é o cliente nº {cli[a.id]} e {b.nome} é o cliente nº {cli[b.id]}: clientes diferentes não "
                          "são mesclados. Se for o mesmo cliente, unifique primeiro no cadastro de clientes.")
    if b.id in cli:
        a, b = b, a
    da, dbb = documento(a), documento(b)
    if da and dbb and da != dbb:
        raise RegraPessoa("As duas pessoas têm CPF/CNPJ diferentes: não são a mesma pessoa.")
    for modelo, coluna in ((Parte, Parte.pessoa_id), (Pessoa, Pessoa.representante_legal_id),
                           (CasoConsultivo, CasoConsultivo.solicitante_id), (Advogado, Advogado.sociedade_id),
                           (Pessoa, Pessoa.mesclada_em_id)):
        db.execute(update(modelo).where(coluna == b.id).values({coluna.key: a.id}))
    env = _envolvimento()
    if env:
        env.mover_pessoa(db, de=b.id, para=a.id)
    adv_a = db.scalar(select(Advogado).where(Advogado.pessoa_id == a.id))
    adv_b = db.scalar(select(Advogado).where(Advogado.pessoa_id == b.id))
    if adv_b and not adv_a:
        adv_b.pessoa_id = a.id
    elif adv_b and adv_a:
        for oab in list(adv_b.oabs):
            oab.advogado_id, oab.principal = adv_a.id, False
        db.flush()
        if env:
            env.mover_advogado(db, de=adv_b.id, para=adv_a.id)
        for campo in ("sociedade_id", "usuario_id", "email_profissional", "telefone_profissional", "observacoes"):
            if getattr(adv_a, campo) in (None, "") and getattr(adv_b, campo) not in (None, ""):
                setattr(adv_a, campo, getattr(adv_b, campo))
        adv_a.eh_interno = adv_a.eh_interno or adv_b.eh_interno
        db.expire(adv_b, ["oabs"])
        db.delete(adv_b)
    for campo in _CAMPOS_COMPLETAR:
        if getattr(a, campo) in (None, "") and getattr(b, campo) not in (None, ""):
            setattr(a, campo, getattr(b, campo))
    if a.representante_legal_id == a.id:
        a.representante_legal_id = None
    for campo in ("enderecos", "contatos", "telefones", "outros_documentos"):
        atuais = list(getattr(a, campo) or [])
        setattr(a, campo, atuais + [x for x in (getattr(b, campo) or []) if x not in atuais])
    if dbb and not da and a.id not in cli:
        definir_documento(a, dbb)
    obs = f"Mesclada em {a.nome} (nº {a.id})." + (f" Documento: {dbb}." if dbb else "")
    b.cpf = b.cnpj = None  # o documento fica só na pessoa que continua
    b.observacoes = f"{b.observacoes}\n{obs}" if b.observacoes else obs
    a.observacoes = a.observacoes or None
    a.ente_publico = a.ente_publico or b.ente_publico
    b.ativo, b.mesclada_em_id = False, a.id
    db.flush()
    return a, b
