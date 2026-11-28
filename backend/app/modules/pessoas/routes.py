"""Cadastros › Pessoas: o cadastro único de partes (clientes, partes contrárias, terceiros, advogados).

Uma pessoa é cadastrada uma vez e aparece em quantos casos for preciso. Documento repetido nunca cria outra pessoa:
a que já existe é devolvida (`ja_existia`). A pessoa de um cliente traz `cliente_id` (o código do cliente).
"""

from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.core.deps import Ctx, Operador
from app.core.documentos import formatar_documento, so_digitos
from app.core.models import Usuario
from app.core.schemas import Mensagem, Pagina
from app.modules.pessoas import service
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.pessoas.service import ROTULOS, RegraPessoa
from app.modules.tribunais.models import Pessoa
from app.modules.tribunais.vinculo import normalizar_nome

router = APIRouter(prefix="/pessoas", tags=["Cadastros · Pessoas"])
advogados = APIRouter(prefix="/advogados", tags=["Cadastros · Pessoas"])


# ---------------------------------------------------------------------------------------------------- schemas
class EnderecoPessoa(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tipo: str = "residencial"  # residencial | comercial | correspondencia | citacao
    cep: str | None = None
    logradouro: str | None = None
    numero: str | None = None
    complemento: str | None = None
    bairro: str | None = None
    cidade: str | None = None
    codigo_ibge: str | None = None
    uf: str | None = None
    pais: str | None = "Brasil"
    principal: bool = False


class ContatoPessoa(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tipo: str = "celular"  # email | celular | whatsapp | telefone | site
    valor: str = Field(min_length=1, max_length=200)
    descricao: str | None = Field(default=None, max_length=100)
    principal: bool = False
    aceita_comunicacao: bool = True


class OabIO(BaseModel):
    id: int | None = None
    numero: str = Field(min_length=1, max_length=12)
    uf: str = Field(min_length=2, max_length=2)
    tipo_inscricao: str = "principal"  # principal | suplementar | estagiario | provisoria
    situacao: str = "regular"  # regular | suspensa | cancelada | licenciada
    principal: bool = False
    exibicao: str | None = None  # leitura: "OAB/SP 123.456"


class AdvogadoIO(BaseModel):
    id: int | None = None  # leitura
    sociedade_id: int | None = None  # pessoa jurídica (sociedade de advogados)
    sociedade_nome: str | None = None  # leitura
    eh_interno: bool = False
    usuario_id: int | None = None  # advogado do próprio escritório
    usuario_nome: str | None = None  # leitura
    email_profissional: str | None = Field(default=None, max_length=200)
    telefone_profissional: str | None = Field(default=None, max_length=30)
    observacoes: str | None = None
    oabs: list[OabIO] = []


class PessoaIn(BaseModel):
    tipo_pessoa: str = "fisica"  # fisica | juridica | ente_publico | estrangeiro | sem_documento
    nome: str = Field(min_length=2, max_length=300)
    nome_social: str | None = Field(default=None, max_length=200)
    nome_fantasia: str | None = Field(default=None, max_length=200)
    cpf_cnpj: str | None = None  # com ou sem máscara
    documento_estrangeiro: str | None = Field(default=None, max_length=40)
    rg: str | None = Field(default=None, max_length=20)
    rg_orgao_emissor: str | None = Field(default=None, max_length=20)
    rg_uf: str | None = Field(default=None, max_length=2)
    data_nascimento: date | None = None
    data_fundacao: date | None = None
    nacionalidade: str | None = Field(default=None, max_length=60)
    estado_civil: str | None = None
    regime_bens: str | None = None
    profissao: str | None = Field(default=None, max_length=100)
    nome_mae: str | None = Field(default=None, max_length=200)
    pis_nit: str | None = Field(default=None, max_length=20)
    ctps: str | None = Field(default=None, max_length=30)
    inscricao_estadual: str | None = Field(default=None, max_length=20)
    inscricao_municipal: str | None = Field(default=None, max_length=20)
    cnae_principal: str | None = Field(default=None, max_length=10)
    representante_legal_id: int | None = None
    email: str | None = Field(default=None, max_length=200)
    telefones: list[str] = []
    enderecos: list[EnderecoPessoa] = []
    contatos: list[ContatoPessoa] = []
    observacoes: str | None = None
    consentimento_lgpd: bool | None = None
    base_legal_lgpd: str | None = Field(default=None, max_length=100)
    ativo: bool = True
    advogado: AdvogadoIO | None = None  # dados de advogado (não mandar o campo = não mexe)

    @field_validator("tipo_pessoa")
    @classmethod
    def _tipo(cls, v):
        if v not in ROTULOS["tipo_pessoa"]:
            raise ValueError("Tipo de pessoa inválido.")
        return v


class PessoaResumo(BaseModel):
    id: int
    nome: str
    tipo_pessoa: str
    tipo_pessoa_nome: str
    cpf_cnpj: str | None
    documento_formatado: str | None
    eh_cliente: bool  # é a Pessoa de um cliente do escritório (vem do vínculo, não é um campo solto)
    cliente_id: int | None  # código do cliente (id do cadastro de clientes)
    eh_advogado: bool
    oabs: list[str] = []  # "OAB/SP 123.456"
    cidade: str | None = None
    uf: str | None = None
    ativo: bool


class PessoaOut(PessoaResumo):
    nome_social: str | None
    nome_fantasia: str | None
    documento_estrangeiro: str | None
    rg: str | None
    rg_orgao_emissor: str | None
    rg_uf: str | None
    data_nascimento: date | None
    data_fundacao: date | None
    nacionalidade: str | None
    estado_civil: str | None
    regime_bens: str | None
    profissao: str | None
    nome_mae: str | None
    pis_nit: str | None
    ctps: str | None
    inscricao_estadual: str | None
    inscricao_municipal: str | None
    cnae_principal: str | None
    representante_legal_id: int | None
    representante_legal_nome: str | None = None
    eh_ente_publico: bool
    email: str | None
    telefones: list[str]
    enderecos: list[EnderecoPessoa]
    contatos: list[ContatoPessoa]
    observacoes: str | None
    consentimento_lgpd: bool | None
    base_legal_lgpd: str | None
    advogado: AdvogadoIO | None = None
    em_uso: dict[str, int] = {}  # onde aparece (quem aparece em algum lugar não é excluído, só desativado)
    mesclada_em_id: int | None = None
    ja_existia: bool = False  # no cadastro: o CPF/CNPJ já estava no cadastro e esta é a pessoa que já existia
    criado_em: Any = None


class MesclarIn(BaseModel):
    duplicada_id: int


class AdvogadoRapidoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=300)
    oab_numero: str = Field(min_length=1, max_length=12)
    oab_uf: str = Field(min_length=2, max_length=2)
    sociedade_id: int | None = None
    email_profissional: str | None = Field(default=None, max_length=200)
    telefone_profissional: str | None = Field(default=None, max_length=30)


class AdvogadoResumo(BaseModel):
    advogado_id: int
    pessoa_id: int
    nome: str
    oabs: list[OabIO]
    sociedade_nome: str | None
    eh_interno: bool
    cliente_id: int | None
    eh_cliente: bool
    ja_existia: bool = False


# ---------------------------------------------------------------------------------------------------- saída
def _erro(e: RegraPessoa):
    raise HTTPException(400, str(e)) from e


def _pessoa(ctx, pid: int) -> Pessoa:
    p = ctx.db.get(Pessoa, pid)
    if not p or p.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Pessoa não encontrada.")
    return p


def _oab_out(o: AdvogadoOab) -> OabIO:
    return OabIO(id=o.id, numero=o.numero, uf=o.uf, tipo_inscricao=o.tipo_inscricao, situacao=o.situacao, principal=o.principal,
                 exibicao=service.exibir_oab(o.numero, o.uf))


def _advogados(ctx, pessoa_ids) -> dict[int, Advogado]:
    ids = list(pessoa_ids)
    return {a.pessoa_id: a for a in ctx.db.scalars(select(Advogado).where(Advogado.pessoa_id.in_(ids)))} if ids else {}


def resumos(ctx, pessoas: list[Pessoa]) -> list[PessoaResumo]:
    """Saída curta de pessoa, igual em toda rota (lista, busca, envolvimentos): sempre com cliente_id e eh_cliente."""
    ids = [p.id for p in pessoas]
    cli, adv = service.clientes_de(ctx.db, ids), _advogados(ctx, ids)
    saida = []
    for p in pessoas:
        doc = service.documento(p)
        end = next((e for e in (p.enderecos or []) if e.get("principal")), next(iter(p.enderecos or []), {})) or {}
        saida.append(PessoaResumo(
            id=p.id, nome=p.nome, tipo_pessoa=p.tipo_pessoa, tipo_pessoa_nome=ROTULOS["tipo_pessoa"].get(p.tipo_pessoa, p.tipo_pessoa),
            cpf_cnpj=doc, documento_formatado=formatar_documento(doc) if doc else p.documento_parcial,
            eh_cliente=p.id in cli, cliente_id=cli.get(p.id), eh_advogado=p.id in adv,
            oabs=[service.exibir_oab(o.numero, o.uf) for o in adv[p.id].oabs] if p.id in adv else [],
            cidade=end.get("cidade"), uf=end.get("uf"), ativo=p.ativo))
    return saida


def _advogado_out(ctx, a: Advogado) -> AdvogadoIO:
    soc = ctx.db.get(Pessoa, a.sociedade_id) if a.sociedade_id else None
    usu = ctx.db.get(Usuario, a.usuario_id) if a.usuario_id else None
    return AdvogadoIO(id=a.id, sociedade_id=a.sociedade_id, sociedade_nome=soc.nome if soc else None, eh_interno=a.eh_interno,
                      usuario_id=a.usuario_id, usuario_nome=usu.nome if usu else None, email_profissional=a.email_profissional,
                      telefone_profissional=a.telefone_profissional, observacoes=a.observacoes, oabs=[_oab_out(o) for o in a.oabs])


def pessoa_out(ctx, p: Pessoa, ja_existia: bool = False) -> PessoaOut:
    base = resumos(ctx, [p])[0].model_dump()
    adv = _advogados(ctx, [p.id]).get(p.id)
    rep = ctx.db.get(Pessoa, p.representante_legal_id) if p.representante_legal_id else None
    campos = {k: getattr(p, k) for k in PessoaOut.model_fields if k not in base and hasattr(Pessoa, k)}
    campos.update(telefones=[t if isinstance(t, str) else str((t or {}).get("numero") or "") for t in p.telefones or []],
                  enderecos=p.enderecos or [], contatos=p.contatos or [])
    return PessoaOut(**base, **campos, representante_legal_nome=rep.nome if rep else None,
                     eh_ente_publico=bool(p.ente_publico or p.tipo_pessoa in service.ENTES),
                     advogado=_advogado_out(ctx, adv) if adv else None, em_uso=service.em_uso(ctx.db, p), ja_existia=ja_existia)


# ---------------------------------------------------------------------------------------------------- gravação
_DIRETOS = ("nome_social", "nome_fantasia", "documento_estrangeiro", "rg", "rg_orgao_emissor", "rg_uf", "data_nascimento",
            "data_fundacao", "nacionalidade", "estado_civil", "regime_bens", "profissao", "nome_mae", "pis_nit", "ctps",
            "inscricao_estadual", "inscricao_municipal", "cnae_principal", "email", "observacoes", "consentimento_lgpd",
            "base_legal_lgpd")


def _validar(ctx, dados: PessoaIn, atual: Pessoa | None) -> str | None:
    for campo, lista in (("estado_civil", "estado_civil"), ("regime_bens", "regime_bens")):
        v = getattr(dados, campo)
        if v and v not in ROTULOS[lista]:
            raise HTTPException(400, f"{campo}: use uma destas opções: {', '.join(ROTULOS[lista])}.")
    for e in dados.enderecos:
        if e.tipo not in ROTULOS["tipo_endereco"]:
            raise HTTPException(400, "Tipo de endereço inválido.")
    for c in dados.contatos:
        if c.tipo not in ROTULOS["tipo_contato"]:
            raise HTTPException(400, "Tipo de contato inválido.")
    com_oab = bool(dados.advogado and dados.advogado.oabs) or bool(
        atual and "advogado" not in dados.model_fields_set and ctx.db.scalar(select(Advogado.id).where(Advogado.pessoa_id == atual.id)))
    try:
        doc = service.validar_documento(dados.tipo_pessoa, dados.cpf_cnpj, advogado_com_oab=com_oab)
    except RegraPessoa as e:
        _erro(e)
    if dados.representante_legal_id:
        rep = _pessoa(ctx, dados.representante_legal_id)
        if atual and rep.id == atual.id:
            raise HTTPException(400, "A pessoa não pode ser representante dela mesma.")
    return doc


def _aplicar(p: Pessoa, dados: PessoaIn, doc: str | None) -> None:
    p.tipo_pessoa, p.nome, p.nome_normalizado = dados.tipo_pessoa, dados.nome.strip(), normalizar_nome(dados.nome)
    service.definir_documento(p, doc)
    for campo in _DIRETOS:
        v = getattr(dados, campo)
        setattr(p, campo, v.strip() or None if isinstance(v, str) else v)
    p.rg_uf = p.rg_uf.upper() if p.rg_uf else None
    p.representante_legal_id = dados.representante_legal_id
    p.telefones = [t.strip() for t in dados.telefones if t and t.strip()]
    ends = [e.model_dump() for e in dados.enderecos]
    for e in ends:
        e["cep"], e["uf"] = so_digitos(e["cep"]) or None, (e["uf"] or "").upper() or None
    if ends and not any(e["principal"] for e in ends):
        ends[0]["principal"] = True
    conts = [c.model_dump() for c in dados.contatos]
    p.enderecos, p.contatos = ends, conts
    p.ente_publico = dados.tipo_pessoa in service.ENTES
    p.ativo = dados.ativo


def _salvar_advogado(ctx, p: Pessoa, dados: AdvogadoIO | None) -> None:
    db = ctx.db
    adv = db.scalar(select(Advogado).where(Advogado.pessoa_id == p.id))
    if dados is None:
        if adv is None:
            return
        env = service._envolvimento()
        if env and env.uso_do_advogado(db, adv.id):
            raise HTTPException(400, "Este advogado está em partes de casos: os dados de advogado não podem ser retirados.")
        db.delete(adv)
        return
    if p.tipo_pessoa in ("juridica", *service.ENTES):
        raise HTTPException(400, "Advogado é pessoa física. A sociedade de advogados entra no campo Sociedade.")
    if dados.sociedade_id:
        soc = _pessoa(ctx, dados.sociedade_id)
        if soc.id == p.id:
            raise HTTPException(400, "A sociedade precisa ser outra pessoa (jurídica).")
    if dados.usuario_id:
        u = db.get(Usuario, dados.usuario_id)
        if not u or u.tenant_id != ctx.tenant_id:
            raise HTTPException(400, "Usuário do advogado interno não encontrado.")
        outro = db.scalar(select(Advogado.id).where(Advogado.usuario_id == u.id, Advogado.pessoa_id != p.id))
        if outro:
            raise HTTPException(409, "Este usuário já está ligado a outro advogado do cadastro.")
    if adv is None:
        adv = Advogado(tenant_id=ctx.tenant_id, pessoa_id=p.id)
        db.add(adv)
    adv.sociedade_id, adv.usuario_id = dados.sociedade_id, dados.usuario_id
    adv.eh_interno = bool(dados.eh_interno or dados.usuario_id)
    adv.email_profissional = (dados.email_profissional or "").strip() or None
    adv.telefone_profissional = (dados.telefone_profissional or "").strip() or None
    adv.observacoes = dados.observacoes
    db.flush()
    atuais = {o.id: o for o in adv.oabs}
    vistos, novas = set(), []
    for item in dados.oabs:
        try:
            numero, uf = service.normalizar_oab(item.numero), service.validar_uf(item.uf)
        except RegraPessoa as e:
            _erro(e)
        if item.tipo_inscricao not in ROTULOS["tipo_inscricao"] or item.situacao not in ROTULOS["situacao_oab"]:
            raise HTTPException(400, "Tipo de inscrição ou situação da OAB inválidos.")
        chave = (numero, uf, item.tipo_inscricao)
        if chave in vistos:
            raise HTTPException(400, f"A {service.exibir_oab(numero, uf)} aparece duas vezes.")
        vistos.add(chave)
        dona = db.execute(select(Pessoa.nome).join(Advogado, Advogado.pessoa_id == Pessoa.id).join(
            AdvogadoOab, AdvogadoOab.advogado_id == Advogado.id).where(
                AdvogadoOab.tenant_id == ctx.tenant_id, AdvogadoOab.numero == numero, AdvogadoOab.uf == uf,
                AdvogadoOab.tipo_inscricao == item.tipo_inscricao, Advogado.id != adv.id)).first()
        if dona:
            raise HTTPException(409, f"A {service.exibir_oab(numero, uf)} já está no cadastro de {dona[0]}.")
        oab = atuais.get(item.id) or next((o for o in adv.oabs if (o.numero, o.uf, o.tipo_inscricao) == chave), None) \
            or AdvogadoOab(tenant_id=ctx.tenant_id)
        oab.numero, oab.uf, oab.tipo_inscricao, oab.situacao, oab.principal = numero, uf, item.tipo_inscricao, item.situacao, item.principal
        novas.append(oab)
    primeira = next((n for n, x in enumerate(novas) if x.principal), 0)
    for i, o in enumerate(novas):  # sempre uma, e só uma, inscrição principal
        o.principal = i == primeira
    retiradas = [o for o in adv.oabs if o not in novas]
    env = service._envolvimento()
    for o in retiradas:
        if env and env.uso_da_oab(db, o.id):
            raise HTTPException(400, f"A {service.exibir_oab(o.numero, o.uf)} está habilitada em casos: não pode ser retirada.")
    adv.oabs = novas


# ---------------------------------------------------------------------------------------------------- rotas
@router.get("/opcoes")
def opcoes(ctx: Ctx):
    """Listas fixas do cadastro de pessoas (valor e rótulo)."""
    return {campo: [{"valor": v, "rotulo": r} for v, r in itens.items()] for campo, itens in ROTULOS.items()}


@router.get("/buscar", response_model=list[PessoaResumo])
def buscar(ctx: Ctx, q: str = Query(min_length=1, max_length=100), limite: int = Query(20, ge=1, le=50), inativos: bool = False):
    """Autocomplete: nome (sem acento, qualquer caixa), nome fantasia ou CPF/CNPJ com ou sem máscara."""
    filtro = service.filtro_busca(q)
    if filtro is None:
        return []
    sel = select(Pessoa).where(Pessoa.tenant_id == ctx.tenant_id, Pessoa.mesclada_em_id.is_(None), filtro)
    if not inativos:
        sel = sel.where(Pessoa.ativo)
    return resumos(ctx, list(ctx.db.scalars(sel.order_by(Pessoa.nome).limit(limite))))


@router.get("", response_model=Pagina[PessoaResumo])
def listar(ctx: Ctx, q: str | None = None, tipo: str | None = None, eh_cliente: bool | None = None, eh_advogado: bool | None = None,
           cidade: str | None = None, uf: str | None = None, ativo: bool | None = True, pagina: int = Query(1, ge=1),
           por_pagina: int = Query(50, ge=1, le=200)):
    from app.modules.rpa_nfse.models import Tomador

    sel = select(Pessoa).where(Pessoa.tenant_id == ctx.tenant_id, Pessoa.mesclada_em_id.is_(None))
    if q and (filtro := service.filtro_busca(q)) is not None:
        sel = sel.where(filtro)
    if tipo:
        sel = sel.where(Pessoa.tipo_pessoa == tipo)
    if ativo is not None:
        sel = sel.where(Pessoa.ativo == ativo)
    if eh_cliente is not None:
        de_cliente = select(Tomador.pessoa_id).where(Tomador.tenant_id == ctx.tenant_id, Tomador.pessoa_id.is_not(None))
        sel = sel.where(Pessoa.id.in_(de_cliente) if eh_cliente else Pessoa.id.not_in(de_cliente))
    if eh_advogado is not None:
        de_adv = select(Advogado.pessoa_id).where(Advogado.tenant_id == ctx.tenant_id)
        sel = sel.where(Pessoa.id.in_(de_adv) if eh_advogado else Pessoa.id.not_in(de_adv))
    todas = list(ctx.db.scalars(sel.order_by(Pessoa.nome, Pessoa.id)))
    if cidade or uf:  # endereços ficam em lista: o filtro é feito aqui
        alvo_c, alvo_uf = normalizar_nome(cidade), (uf or "").upper()
        todas = [p for p in todas if any((not alvo_c or normalizar_nome(e.get("cidade")) == alvo_c)
                                         and (not alvo_uf or (e.get("uf") or "").upper() == alvo_uf) for e in p.enderecos or [])]
    ini = (pagina - 1) * por_pagina
    return Pagina[PessoaResumo](itens=resumos(ctx, todas[ini:ini + por_pagina]), total=len(todas), pagina=pagina,
                                por_pagina=por_pagina)


@router.post("", response_model=PessoaOut, status_code=201)
def criar(dados: PessoaIn, ctx: Operador):
    """Cadastra a pessoa. Se o CPF/CNPJ já está no cadastro (inclusive o de um cliente), nada é criado: a resposta é a
    pessoa que já existia, com `ja_existia: true` (status 200)."""
    from fastapi.responses import JSONResponse

    doc = _validar(ctx, dados, None)
    existente = service.por_documento(ctx.db, ctx.tenant_id, doc, ligar_cliente=True) if doc else None
    if existente:
        ctx.db.commit()  # a Pessoa de um cliente que ainda não tinha a sua pode ter nascido agora
        return JSONResponse(pessoa_out(ctx, existente, ja_existia=True).model_dump(mode="json"), status_code=200)
    p = Pessoa(tenant_id=ctx.tenant_id, outros_documentos=[])
    _aplicar(p, dados, doc)
    ctx.db.add(p)
    ctx.db.flush()
    if dados.advogado is not None:
        _salvar_advogado(ctx, p, dados.advogado)
    ctx.db.flush()
    ctx.auditar("pessoa.criar", "trb_pessoa", p.id, descricao=p.nome)
    ctx.db.commit()
    return pessoa_out(ctx, p)


@router.get("/{pid}", response_model=PessoaOut)
def ler(pid: int, ctx: Ctx):
    return pessoa_out(ctx, _pessoa(ctx, pid))


@router.put("/{pid}", response_model=PessoaOut)
def alterar(pid: int, dados: PessoaIn, ctx: Operador):
    p = _pessoa(ctx, pid)
    if p.mesclada_em_id:
        raise HTTPException(400, "Esta pessoa foi mesclada em outra: altere a que ficou.")
    doc = _validar(ctx, dados, p)
    cliente_id = service.clientes_de(ctx.db, [p.id]).get(p.id)
    if cliente_id:
        if dados.nome.strip() != p.nome or (doc or "") != (service.documento(p) or "") or dados.tipo_pessoa != p.tipo_pessoa:
            raise HTTPException(400, f"Esta pessoa é o cliente nº {cliente_id}: nome, CPF/CNPJ e tipo são alterados no cadastro "
                                     "de clientes (é ele que emite fatura e nota).")
        if not dados.ativo:
            raise HTTPException(400, f"Esta pessoa é o cliente nº {cliente_id}: não pode ser desativada aqui.")
    outra = service.por_documento(ctx.db, ctx.tenant_id, doc, exceto_id=p.id) if doc else None
    if outra:
        raise HTTPException(409, f"Já existe uma pessoa com este CPF/CNPJ: {outra.nome}.")
    antes = {"nome": p.nome, "documento": service.documento(p), "ativo": p.ativo}
    _aplicar(p, dados, doc)
    if "advogado" in dados.model_fields_set:
        _salvar_advogado(ctx, p, dados.advogado)
    ctx.db.flush()
    if doc and not cliente_id:  # o documento é de um cliente que ainda não tinha a sua Pessoa: passa a ser esta
        service.ligar_cliente_pelo_documento(ctx.db, ctx.tenant_id, doc)
    ctx.auditar("pessoa.alterar", "trb_pessoa", p.id, descricao=p.nome, antes=antes,
                depois={"nome": p.nome, "documento": service.documento(p), "ativo": p.ativo})
    ctx.db.commit()
    return pessoa_out(ctx, p)


@router.delete("/{pid}", response_model=Mensagem)
def excluir(pid: int, ctx: Ctx):
    """Pessoa que aparece em algum caso, processo ou cadastro é só desativada; sem uso nenhum, é excluída."""
    p = _pessoa(ctx, pid)
    cliente_id = service.clientes_de(ctx.db, [p.id]).get(p.id)
    if cliente_id:
        raise HTTPException(400, f"Esta pessoa é o cliente nº {cliente_id}: ela acompanha o cadastro de clientes e não pode ser "
                                 "desativada nem excluída aqui.")
    adv = ctx.db.scalar(select(Advogado).where(Advogado.pessoa_id == p.id))
    env = service._envolvimento()
    if service.em_uso(ctx.db, p) or (adv and env and env.uso_do_advogado(ctx.db, adv.id)):
        p.ativo = False
        ctx.auditar("pessoa.desativar", "trb_pessoa", p.id, descricao=p.nome)
        ctx.db.commit()
        return Mensagem(mensagem="A pessoa aparece em casos ou processos: foi desativada (o histórico fica).")
    ctx.auditar("pessoa.excluir", "trb_pessoa", p.id, descricao=p.nome)
    if adv:
        ctx.db.delete(adv)
        ctx.db.flush()
    ctx.db.delete(p)
    ctx.db.commit()
    return Mensagem(mensagem="Pessoa excluída.")


@router.get("/{pid}/casos")
def casos_da_pessoa(pid: int, ctx: Ctx):
    """Casos em que a pessoa aparece e em que papel (base para conferir conflito de interesses)."""
    p = _pessoa(ctx, pid)
    env = service._envolvimento()
    return env.casos_da_pessoa(ctx, p) if env else []


@router.get("/{pid}/duplicados")
def duplicados(pid: int, ctx: Ctx):
    """Possíveis duplicados: mesmo CPF/CNPJ ou nome com semelhança de 0,8 ou mais. É só um aviso."""
    p = _pessoa(ctx, pid)
    achados = service.semelhantes(ctx.db, p)
    saida = resumos(ctx, [o for o, _, _ in achados])
    return [{**r.model_dump(), "semelhanca": s, "motivo": m} for r, (_, s, m) in zip(saida, achados, strict=True)]


@router.post("/{pid}/mesclar", response_model=PessoaOut)
def mesclar(pid: int, dados: MesclarIn, ctx: Ctx):
    """Junta a duplicada na pessoa principal (a do caminho): casos, processos, endereços e contatos passam para a
    principal e a duplicada é desativada. Só administrador. A pessoa de um cliente é sempre a principal."""
    if not ctx.usuario.administrador:
        raise HTTPException(403, "Só o administrador pode mesclar pessoas.")
    a, b = _pessoa(ctx, pid), _pessoa(ctx, dados.duplicada_id)
    nomes = {a.id: a.nome, b.id: b.nome}
    try:
        principal, duplicada = service.mesclar(ctx.db, a, b)
    except RegraPessoa as e:
        _erro(e)
    ctx.auditar("pessoa.mesclar", "trb_pessoa", principal.id,
                descricao=f"{nomes[duplicada.id]} (nº {duplicada.id}) mesclada em {nomes[principal.id]} (nº {principal.id})",
                antes={"duplicada_id": duplicada.id, "nome": nomes[duplicada.id]}, depois={"principal_id": principal.id})
    ctx.db.commit()
    return pessoa_out(ctx, principal)


# ---------------------------------------------------------------------------------------------------- advogados
def _adv_resumo(ctx, a: Advogado, p: Pessoa, cli: dict[int, int], ja_existia: bool = False) -> AdvogadoResumo:
    soc = ctx.db.get(Pessoa, a.sociedade_id) if a.sociedade_id else None
    return AdvogadoResumo(advogado_id=a.id, pessoa_id=p.id, nome=p.nome, oabs=[_oab_out(o) for o in a.oabs],
                          sociedade_nome=soc.nome if soc else None, eh_interno=a.eh_interno, cliente_id=cli.get(p.id),
                          eh_cliente=p.id in cli, ja_existia=ja_existia)


@advogados.get("/buscar", response_model=list[AdvogadoResumo])
def buscar_advogados(ctx: Ctx, q: str = Query(min_length=1, max_length=100), limite: int = Query(20, ge=1, le=50),
                     interno: bool | None = None):
    """Advogados do cadastro único por nome ou OAB ("123456/SP", "OAB/SP 123.456", "123456")."""
    sel = select(Advogado, Pessoa).join(Pessoa, Pessoa.id == Advogado.pessoa_id).where(
        Advogado.tenant_id == ctx.tenant_id, Pessoa.ativo, Pessoa.mesclada_em_id.is_(None))
    if interno is not None:
        sel = sel.where(Advogado.eh_interno == interno)
    oab = service.ler_oab(q)
    digitos = so_digitos(q)
    if oab:
        sel = sel.where(Advogado.id.in_(select(AdvogadoOab.advogado_id).where(AdvogadoOab.numero == oab[0], AdvogadoOab.uf == oab[1])))
    elif digitos and not any(ch.isalpha() for ch in q):
        sel = sel.where(Advogado.id.in_(select(AdvogadoOab.advogado_id).where(AdvogadoOab.numero.like(f"{int(digitos)}%"))))
    else:
        sel = sel.where(Pessoa.nome_normalizado.like(f"%{normalizar_nome(q)}%"))
    linhas = ctx.db.execute(sel.order_by(Pessoa.nome).limit(limite)).all()
    cli = service.clientes_de(ctx.db, [p.id for _, p in linhas])
    return [_adv_resumo(ctx, a, p, cli) for a, p in linhas]


@advogados.post("", response_model=AdvogadoResumo, status_code=201)
def cadastro_rapido(dados: AdvogadoRapidoIn, ctx: Operador):
    """Cadastro rápido do advogado de uma parte: nome + OAB + UF (e sociedade). Se a OAB já está no cadastro, devolve
    o advogado que já existia (`ja_existia: true`, status 200)."""
    from fastapi.responses import JSONResponse

    try:
        numero, uf = service.normalizar_oab(dados.oab_numero), service.validar_uf(dados.oab_uf)
    except RegraPessoa as e:
        _erro(e)
    existente = service.advogado_por_oab(ctx.db, ctx.tenant_id, numero, uf)
    if existente:
        p = ctx.db.get(Pessoa, existente.pessoa_id)
        cli = service.clientes_de(ctx.db, [p.id])
        return JSONResponse(_adv_resumo(ctx, existente, p, cli, ja_existia=True).model_dump(mode="json"), status_code=200)
    if dados.sociedade_id:
        _pessoa(ctx, dados.sociedade_id)
    p = Pessoa(tenant_id=ctx.tenant_id, tipo_pessoa="fisica", nome=dados.nome.strip(), nome_normalizado=normalizar_nome(dados.nome),
               telefones=[], enderecos=[], contatos=[], outros_documentos=[])
    ctx.db.add(p)
    ctx.db.flush()
    a = Advogado(tenant_id=ctx.tenant_id, pessoa_id=p.id, sociedade_id=dados.sociedade_id,
                 email_profissional=(dados.email_profissional or "").strip() or None,
                 telefone_profissional=(dados.telefone_profissional or "").strip() or None)
    a.oabs = [AdvogadoOab(tenant_id=ctx.tenant_id, numero=numero, uf=uf, principal=True)]
    ctx.db.add(a)
    ctx.db.flush()
    ctx.auditar("pessoa.criar", "trb_pessoa", p.id, descricao=f"{p.nome} ({service.exibir_oab(numero, uf)})")
    ctx.db.commit()
    return _adv_resumo(ctx, a, p, {})
