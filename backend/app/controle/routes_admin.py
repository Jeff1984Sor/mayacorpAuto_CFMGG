"""Admin MayaCorp (/api/admin): clientes, usuários dos clientes, planos e contratos.

Só responde dentro do escritório MayaCorp (tipo "mayacorp" no controle) e para administradores; nos
escritórios clientes estas rotas não existem (404).
"""

import re
import unicodedata
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.controle import contratos, indicacao, planos, service
from app.controle.models import Cliente, ContratoCliente, Dominio, ModeloContrato, Plano, SessaoControle
from app.core import tenancy
from app.core.db import SessionLocal, agora
from app.core.deps import Contexto, Ctx

router = APIRouter(prefix="/admin", tags=["admin MayaCorp"])
STATUS = {"teste": "Em teste", "ativo": "Ativo", "suspenso": "Suspenso (avisado)", "inativo": "Inativo (sem acesso)"}


def _painel(ctx: Ctx) -> Contexto:
    esc = tenancy.atual()
    if not (tenancy.multi() and esc and esc.mayacorp):
        raise HTTPException(404, "Não encontrado.")
    if not ctx.usuario.administrador:
        raise HTTPException(403, "Só administradores da MayaCorp.")
    return ctx


Painel = Annotated[Contexto, Depends(_painel)]


def _erro(e: Exception):
    raise HTTPException(400, str(e)) from e


# ================================================================ schemas
class PlanoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    preco_mensal: Decimal = Field(ge=0)
    preco_anual: Decimal = Field(ge=0)
    usuarios: int | None = Field(default=None, ge=1)
    notas_mes: int | None = Field(default=None, ge=0)
    preco_nota_excedente: Decimal = Field(default=Decimal("0.50"), ge=0)
    preco_usuario_adicional: Decimal = Field(default=Decimal("49.90"), ge=0)
    recursos: list[str] = []
    ativo: bool = True
    ordem: int = 0


class FichaIn(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    documento: str | None = None
    responsavel: str | None = Field(default=None, max_length=150)
    email_financeiro: EmailStr | None = None
    telefone: str | None = Field(default=None, max_length=30)
    plano_id: int | None = None
    ciclo: str = Field(default="mensal", pattern="^(mensal|anual)$")
    inicio_contrato: date | None = None
    teste_ate: date | None = None
    observacao: str | None = None
    indicado_por_id: int | None = None


class PoliticaIn(BaseModel):
    desconto_por_indicacao: Decimal = Field(gt=0, le=10)
    desconto_maximo: Decimal = Field(gt=0, le=10)  # nunca acima de 10% da mensalidade


class ClienteNovoIn(FichaIn):
    slug: str | None = Field(default=None, max_length=39)
    admin_nome: str = Field(default="", max_length=150)  # quem recebe as boas-vindas (opcional)
    admin_email: EmailStr  # recebe o link de boas-vindas e cria o usuário master
    dias_teste: int | None = Field(default=None, ge=1, le=90)
    dominios: list[str] = []


class StatusIn(BaseModel):
    status: str = Field(pattern="^(teste|ativo|suspenso|inativo)$")


class DominioIn(BaseModel):
    host: str = Field(min_length=4, max_length=253)


class UsuarioClienteIn(BaseModel):
    nome: str = Field(min_length=2, max_length=150)
    email: EmailStr
    perfil: str = Field(default="Administrador", pattern="^(Administrador|Operador|Visualizador)$")


class AtivoIn(BaseModel):
    ativo: bool


class ModeloIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    corpo: str = Field(min_length=10)
    ativo: bool = True


class GerarContratoIn(BaseModel):
    modelo_id: int


class ContratoEdicaoIn(BaseModel):
    titulo: str = Field(min_length=2, max_length=200)
    corpo: str = Field(min_length=10)


class EnviarContratoIn(BaseModel):
    para: list[EmailStr] = Field(min_length=1)
    mensagem: str | None = None


class ContratoStatusIn(BaseModel):
    status: str = Field(pattern="^(assinado|cancelado)$")


# ================================================================ helpers
def _d(v: Decimal | None) -> str | None:
    """Dinheiro sai como texto (igual ao resto da API), nunca como float."""
    return None if v is None else f"{Decimal(v):.2f}"


def _plano_out(p: Plano | None) -> dict | None:
    if not p:
        return None
    return {"id": p.id, "nome": p.nome, "preco_mensal": _d(p.preco_mensal), "preco_anual": _d(p.preco_anual),
            "usuarios": p.usuarios, "notas_mes": p.notas_mes, "preco_nota_excedente": _d(p.preco_nota_excedente),
            "preco_usuario_adicional": _d(p.preco_usuario_adicional), "recursos": p.recursos or [], "ativo": p.ativo,
            "ordem": p.ordem}


def _valor(c: Cliente) -> Decimal | None:
    if not c.plano:
        return None
    return c.plano.preco_anual if c.ciclo == "anual" else c.plano.preco_mensal


def _cliente_out(c: Cliente) -> dict:
    from sqlalchemy.orm import object_session

    n, pct = indicacao.desconto(object_session(c), c)
    valor = _valor(c)
    return {"indicado_por": {"id": c.indicado_por.id, "nome": c.indicado_por.nome} if c.indicado_por else None,
            "indicado_por_id": c.indicado_por_id, "indicacoes_ativas": n, "desconto_percentual": _d(pct),
            "valor_com_desconto": _d(indicacao.aplicar(valor, pct)), **_cliente_base(c)}


def _cliente_base(c: Cliente) -> dict:
    return {"id": c.id, "slug": c.slug, "nome": c.nome, "status": c.status, "status_rotulo": STATUS.get(c.status, c.status),
            "teste_ate": c.teste_ate, "criado_em": c.criado_em, "documento": c.documento, "responsavel": c.responsavel,
            "email_financeiro": c.email_financeiro, "telefone": c.telefone, "plano": _plano_out(c.plano),
            "plano_id": c.plano_id, "ciclo": c.ciclo, "valor": _d(_valor(c)), "inicio_contrato": c.inicio_contrato,
            "observacao": c.observacao, "banco_principal": c.banco is None,
            "dominios": [{"id": d.id, "host": d.host} for d in c.dominios]}


def _cliente(db, cid: int) -> Cliente:
    c = db.get(Cliente, cid)
    if not c or c.tipo != "escritorio":
        raise HTTPException(404, "Cliente não encontrado.")
    return c


def _esc_do(c: Cliente) -> tenancy.Escritorio:
    return tenancy.Escritorio(slug=c.slug, banco=c.banco)


def _slug_de(nome: str) -> str:
    base = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:30] or "escritorio"
    return base if base[0].isalpha() else f"e-{base}"


def _validar_indicacao(db, indicado_por_id: int | None, proprio_id: int | None = None) -> None:
    if indicado_por_id is None:
        return
    quem = db.get(Cliente, indicado_por_id)
    if not quem or quem.tipo != "escritorio" or indicado_por_id == proprio_id:
        raise HTTPException(400, "Indicação inválida: escolha outro cliente do MayaJus.")


def _ficha(dados: FichaIn) -> dict:
    campos = dados.model_dump(include=set(FichaIn.model_fields))
    campos["documento"] = re.sub(r"\D", "", campos["documento"] or "") or None
    campos["email_financeiro"] = str(campos["email_financeiro"]).lower() if campos["email_financeiro"] else None
    return campos


# ================================================================ resumo e clientes
@router.get("/resumo")
def resumo(ctx: Painel):
    with SessaoControle() as db:
        clientes = list(db.scalars(select(Cliente).where(Cliente.tipo == "escritorio")))
        por_status = {k: 0 for k in STATUS}
        mrr = Decimal(0)
        for c in clientes:
            por_status[c.status] = por_status.get(c.status, 0) + 1
            if c.status in ("ativo", "suspenso") and c.plano:
                mrr += c.plano.preco_anual / 12 if c.ciclo == "anual" else c.plano.preco_mensal
        return {"clientes": len(clientes), "por_status": por_status, "mrr": _d(mrr)}


@router.get("/clientes")
def listar_clientes(ctx: Painel, q: str | None = None, status: str | None = None):
    with SessaoControle() as db:
        sel = select(Cliente).where(Cliente.tipo == "escritorio")
        if status:
            sel = sel.where(Cliente.status == status)
        if q:
            dig = re.sub(r"\D", "", q)
            conds = [Cliente.nome.ilike(f"%{q}%"), Cliente.slug.ilike(f"%{q}%")]
            if dig:
                conds.append(Cliente.documento.like(f"%{dig}%"))
            from sqlalchemy import or_

            sel = sel.where(or_(*conds))
        return [_cliente_out(c) for c in db.scalars(sel.order_by(Cliente.nome))]


@router.post("/clientes", status_code=201)
def criar_cliente(dados: ClienteNovoIn, ctx: Painel):

    with SessaoControle() as db:
        _validar_indicacao(db, dados.indicado_por_id)
    ficha = _ficha(dados)
    nome = ficha.pop("nome")
    teste_ate = ficha.pop("teste_ate")
    slug = (dados.slug or _slug_de(nome)).lower()
    try:
        cliente, link = service.provisionar(slug, nome, admin_nome=dados.admin_nome, admin_email=str(dados.admin_email),
                                            dias_teste=dados.dias_teste, dominios=dados.dominios, primeiro_acesso=True,
                                            **ficha)
    except service.RegraControle as e:
        _erro(e)
    if teste_ate and not dados.dias_teste:
        with SessaoControle() as db:
            db.get(Cliente, cliente.id).teste_ate = teste_ate
            db.commit()
    _boas_vindas(str(dados.admin_email), dados.admin_nome, nome, link, dados.dias_teste)
    with SessaoControle() as db:
        service.espelhar_no_cadastro(ctx.db, ctx.tenant_id, db.get(Cliente, cliente.id))
    ctx.auditar("admin.cliente.criar", "controle_cliente", cliente.id, descricao=f"{slug}: {nome}")
    ctx.db.commit()
    with SessaoControle() as db:
        return {**_cliente_out(db.get(Cliente, cliente.id)), "convite": link}


def _boas_vindas(email: str, pessoa: str, escritorio: str, link: str, dias_teste: int | None = None) -> None:
    ola = f"Olá, {pessoa.split()[0]}!" if pessoa.strip() else "Olá!"
    teste = f"\n\nVocê tem {dias_teste} dias de teste grátis, com todos os recursos do plano." if dias_teste else ""
    service.enviar_email(
        [email], f"Bem-vindo ao MayaJus — {escritorio}",
        f"{ola}\n\nO ambiente do {escritorio} no MayaJus está pronto.{teste}\n\nPara começar, crie o seu usuário "
        f"master (o administrador do escritório) neste link:\n{link}\n\nCom ele você cadastra a equipe, a empresa "
        "emissora e o certificado digital. O link vale por 7 dias.\n\nQualquer dúvida, é só responder este e-mail."
        "\n\nEquipe MayaCorp")


@router.post("/clientes/{cid}/boas-vindas")
def reenviar_boas_vindas(cid: int, ctx: Painel):
    """Link novo de primeiro acesso (enquanto o cliente não criou o usuário master)."""
    from app.core.models import Usuario

    with SessaoControle() as db:
        c = _cliente(db, cid)
        esc, nome, para, pessoa = _esc_do(c), c.nome, c.email_financeiro, c.responsavel or ""
    with tenancy.usando(esc), SessionLocal() as db:
        if db.scalar(select(Usuario.id).where(Usuario.equipe_mayacorp.is_(False), Usuario.senha_hash.is_not(None))):
            raise HTTPException(400, "O cliente já criou o usuário master. Use \"Zerar senha\" na aba Usuários.")
    if not para:
        raise HTTPException(400, "Informe o e-mail do financeiro na ficha para reenviar as boas-vindas.")
    link = service.link_primeiro_acesso(esc.slug, para)
    _boas_vindas(para, pessoa, nome, link)
    ctx.auditar("admin.cliente.boas_vindas", "controle_cliente", cid, descricao=para)
    ctx.db.commit()
    return {"link": link, "enviado_para": para}


@router.get("/clientes/{cid}")
def ler_cliente(cid: int, ctx: Painel):
    with SessaoControle() as db:
        return _cliente_out(_cliente(db, cid))


@router.put("/clientes/{cid}")
def alterar_cliente(cid: int, dados: FichaIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        if dados.plano_id and not db.get(Plano, dados.plano_id):
            raise HTTPException(400, "Plano não encontrado.")
        _validar_indicacao(db, dados.indicado_por_id, c.id)
        for k, v in _ficha(dados).items():
            setattr(c, k, v)
        db.commit()
        service.espelhar_no_cadastro(ctx.db, ctx.tenant_id, c)
        ctx.auditar("admin.cliente.alterar", "controle_cliente", c.id, descricao=c.nome)
        ctx.db.commit()
        return _cliente_out(c)


@router.post("/clientes/{cid}/status")
def mudar_status(cid: int, dados: StatusIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        antes = c.status
        c.status = dados.status
        db.commit()
        service.limpar_cache()
        ctx.auditar("admin.cliente.status", "controle_cliente", c.id, descricao=f"{c.nome}: {antes} → {dados.status}")
        ctx.db.commit()
        return _cliente_out(c)


@router.post("/clientes/{cid}/dominios", status_code=201)
def adicionar_dominio(cid: int, dados: DominioIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        try:
            service.adicionar_dominio(db, c, dados.host)
        except service.RegraControle as e:
            _erro(e)
        db.commit()
        db.refresh(c)
        ctx.auditar("admin.cliente.dominio", "controle_cliente", c.id, descricao=f"+ {dados.host}")
        ctx.db.commit()
        return _cliente_out(c)


@router.delete("/clientes/{cid}/dominios/{did}")
def remover_dominio(cid: int, did: int, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        d = db.get(Dominio, did)
        if not d or d.cliente_id != c.id:
            raise HTTPException(404, "Domínio não encontrado.")
        host = d.host
        db.delete(d)
        db.commit()
        db.refresh(c)
        service.limpar_cache()
        ctx.auditar("admin.cliente.dominio", "controle_cliente", c.id, descricao=f"- {host}")
        ctx.db.commit()
        return _cliente_out(c)


@router.get("/clientes/{cid}/uso")
def uso(cid: int, ctx: Painel):
    """Usuários com acesso e NFS-e reais emitidas no mês, contra os limites do plano."""
    from app.controle import cobranca

    with SessaoControle() as db:
        c = _cliente(db, cid)
        hoje = date.today()
        u = cobranca.uso(c, hoje.year, hoje.month)
    return {**u, "valor_excedente": _d(u["valor_excedente"])}


# ================================================================ usuários do cliente
def _usuario_out(u) -> dict:
    return {"id": u.id, "nome": u.nome, "email": u.email, "login": u.login, "ativo": u.ativo,
            "acesso_sistema": u.acesso_sistema, "convite_pendente": u.convite_pendente,
            "perfil": u.perfil_acesso.nome if u.perfil_acesso else u.perfil.value, "ultimo_acesso": u.ultimo_acesso}


@router.get("/clientes/{cid}/usuarios")
def usuarios_do_cliente(cid: int, ctx: Painel):
    from app.core.models import Usuario

    with SessaoControle() as db:
        esc = _esc_do(_cliente(db, cid))
    with tenancy.usando(esc), SessionLocal() as db:
        return [_usuario_out(u) for u in db.scalars(select(Usuario).order_by(Usuario.nome))]


def _link_senha(u) -> str:
    from app.core.config import settings
    from app.core.security import criar_token

    return f"{settings.frontend_url}/redefinir-senha?token={criar_token(str(u.id), 'reset', {'h': (u.senha_hash or '')[-12:]})}"


@router.post("/clientes/{cid}/usuarios", status_code=201)
def criar_usuario_do_cliente(cid: int, dados: UsuarioClienteIn, ctx: Painel):
    from app.core import perfis
    from app.core.models import Tenant, Usuario

    email = str(dados.email).lower()
    with SessaoControle() as db:
        c = _cliente(db, cid)
        esc, nome_cliente = _esc_do(c), c.nome
    if service.chaves_em_uso([email], exceto_slug=esc.slug):
        raise HTTPException(409, "Este e-mail já é usado em outro escritório do MayaJus.")
    with tenancy.usando(esc), SessionLocal() as db:
        if db.scalar(select(Usuario.id).where(Usuario.email == email)):
            raise HTTPException(409, "Já existe um usuário com este e-mail neste cliente.")
        tenant = db.scalar(select(Tenant).order_by(Tenant.id))
        padrao = perfis.garantir_padrao(db, tenant.id)
        u = Usuario(tenant_id=tenant.id, nome=dados.nome, email=email, convite_pendente=True)
        perfis.aplicar(u, padrao[dados.perfil])
        db.add(u)
        db.commit()
        link = _link_senha(u)
        out = _usuario_out(u)
    service.enviar_email([email], f"Convite para o MayaJus — {nome_cliente}",
                f"Olá, {dados.nome}.\n\nVocê foi convidado(a) para o MayaJus do {nome_cliente}. Para criar sua senha, "
                f"acesse:\n{link}\n\nO link vale por 2 horas.")
    ctx.auditar("admin.usuario.criar", "controle_cliente", cid, descricao=f"{nome_cliente}: {email}")
    ctx.db.commit()
    return {**out, "convite": link}


@router.post("/clientes/{cid}/usuarios/{uid}/zerar-senha")
def zerar_senha(cid: int, uid: int, ctx: Painel):
    """Apaga a senha atual (ninguém entra com ela) e envia o link para a pessoa criar uma nova."""
    from app.core.models import Usuario

    with SessaoControle() as db:
        c = _cliente(db, cid)
        esc, nome_cliente = _esc_do(c), c.nome
    with tenancy.usando(esc), SessionLocal() as db:
        u = db.get(Usuario, uid)
        if not u:
            raise HTTPException(404, "Usuário não encontrado.")
        u.senha_hash, u.tentativas_falhas, u.bloqueado_ate, u.convite_pendente = None, 0, None, True
        db.commit()
        link = _link_senha(u)
        email, nome = u.email, u.nome
    service.enviar_email([email], "Sua senha do MayaJus foi zerada",
                f"Olá, {nome}.\n\nA MayaCorp zerou a sua senha do MayaJus ({nome_cliente}). Para criar uma nova, "
                f"acesse:\n{link}\n\nO link vale por 2 horas.")
    ctx.auditar("admin.usuario.zerar_senha", "controle_cliente", cid, descricao=f"{nome_cliente}: {email}")
    ctx.db.commit()
    return {"mensagem": f"Senha de {nome} zerada. Enviamos o link para {email}.", "link": link}


@router.post("/clientes/{cid}/usuarios/{uid}/ativo")
def ativar_usuario(cid: int, uid: int, dados: AtivoIn, ctx: Painel):
    from app.core.models import Usuario

    with SessaoControle() as db:
        c = _cliente(db, cid)
        esc, nome_cliente = _esc_do(c), c.nome
    with tenancy.usando(esc), SessionLocal() as db:
        u = db.get(Usuario, uid)
        if not u:
            raise HTTPException(404, "Usuário não encontrado.")
        u.ativo = dados.ativo
        db.commit()
        out = _usuario_out(u)
    ctx.auditar("admin.usuario.ativo", "controle_cliente", cid,
                descricao=f"{nome_cliente}: {out['email']} {'ativado' if dados.ativo else 'desativado'}")
    ctx.db.commit()
    return out


# ================================================================ política de indicação
@router.get("/politica-indicacao")
def ler_politica(ctx: Painel):
    with SessaoControle() as db:
        p = indicacao.politica(db)
        db.commit()
        return {"desconto_por_indicacao": _d(p.desconto_por_indicacao), "desconto_maximo": _d(p.desconto_maximo),
                "teto": _d(indicacao.TETO)}


@router.put("/politica-indicacao")
def salvar_politica(dados: PoliticaIn, ctx: Painel):
    with SessaoControle() as db:
        p = indicacao.politica(db)
        p.desconto_por_indicacao, p.desconto_maximo = dados.desconto_por_indicacao, dados.desconto_maximo
        db.commit()
        ctx.auditar("admin.politica_indicacao", "controle_politica", 1,
                    descricao=f"{dados.desconto_por_indicacao}% por indicação, máximo {dados.desconto_maximo}%")
        ctx.db.commit()
    return ler_politica(ctx)


# ================================================================ usuário Suporte
class SenhaSuporteIn(BaseModel):
    senha: str = Field(min_length=8, max_length=128)


@router.get("/suporte")
def ler_suporte(ctx: Painel):
    with SessaoControle() as db:
        p = indicacao.politica(db)
        db.commit()
        return {"senha_definida": bool(p.senha_suporte_hash)}


@router.put("/suporte")
def salvar_suporte(dados: SenhaSuporteIn, ctx: Painel):
    """Senha do usuário Suporte dos escritórios NOVOS (os que já existem mantêm a deles)."""
    from app.core.security import hash_senha, validar_politica_senha

    if erro := validar_politica_senha(dados.senha):
        raise HTTPException(400, erro)
    with SessaoControle() as db:
        indicacao.politica(db).senha_suporte_hash = hash_senha(dados.senha)
        db.commit()
    ctx.auditar("admin.suporte.senha", "controle_politica", 1, descricao="senha do usuário Suporte alterada")
    ctx.db.commit()
    return {"senha_definida": True}


# ================================================================ planos
@router.get("/recursos")
def recursos(ctx: Painel):
    return [{"chave": k, "rotulo": v} for k, v in planos.RECURSOS.items()]


@router.get("/planos")
def listar_planos(ctx: Painel):
    with SessaoControle() as db:
        return [_plano_out(p) for p in db.scalars(select(Plano).order_by(Plano.ordem, Plano.id))]


def _salvar_plano(db, p: Plano, dados: PlanoIn) -> None:
    invalidos = set(dados.recursos) - set(planos.RECURSOS)
    if invalidos:
        raise HTTPException(400, f"Recurso desconhecido: {', '.join(sorted(invalidos))}")
    dup = db.scalar(select(Plano.id).where(func.lower(Plano.nome) == dados.nome.lower(), Plano.id != (p.id or 0)))
    if dup:
        raise HTTPException(409, "Já existe um plano com este nome.")
    for k, v in dados.model_dump().items():
        setattr(p, k, v)


@router.post("/planos", status_code=201)
def criar_plano(dados: PlanoIn, ctx: Painel):
    with SessaoControle() as db:
        p = Plano()
        _salvar_plano(db, p, dados)
        db.add(p)
        db.commit()
        ctx.auditar("admin.plano.criar", "controle_plano", p.id, descricao=p.nome)
        ctx.db.commit()
        return _plano_out(p)


@router.put("/planos/{pid}")
def alterar_plano(pid: int, dados: PlanoIn, ctx: Painel):
    with SessaoControle() as db:
        p = db.get(Plano, pid)
        if not p:
            raise HTTPException(404, "Plano não encontrado.")
        _salvar_plano(db, p, dados)
        db.commit()
        ctx.auditar("admin.plano.alterar", "controle_plano", p.id, descricao=p.nome)
        ctx.db.commit()
        return _plano_out(p)


# ================================================================ modelos de contrato
def _modelo_out(m: ModeloContrato) -> dict:
    return {"id": m.id, "nome": m.nome, "corpo": m.corpo, "ativo": m.ativo, "atualizado_em": m.atualizado_em,
            "variaveis_desconhecidas": contratos.desconhecidas(m.corpo)}


@router.get("/contratos/variaveis")
def variaveis(ctx: Painel):
    return [{"chave": k, "rotulo": v} for k, v in contratos.VARIAVEIS.items()]


@router.get("/modelos-contrato")
def listar_modelos(ctx: Painel):
    with SessaoControle() as db:
        return [_modelo_out(m) for m in db.scalars(select(ModeloContrato).order_by(ModeloContrato.nome))]


@router.post("/modelos-contrato", status_code=201)
def criar_modelo(dados: ModeloIn, ctx: Painel):
    with SessaoControle() as db:
        m = ModeloContrato(**dados.model_dump())
        db.add(m)
        db.commit()
        ctx.auditar("admin.modelo_contrato.criar", "controle_modelo", m.id, descricao=m.nome)
        ctx.db.commit()
        return _modelo_out(m)


@router.put("/modelos-contrato/{mid}")
def alterar_modelo(mid: int, dados: ModeloIn, ctx: Painel):
    with SessaoControle() as db:
        m = db.get(ModeloContrato, mid)
        if not m:
            raise HTTPException(404, "Modelo não encontrado.")
        for k, v in dados.model_dump().items():
            setattr(m, k, v)
        db.commit()
        ctx.auditar("admin.modelo_contrato.alterar", "controle_modelo", m.id, descricao=m.nome)
        ctx.db.commit()
        return _modelo_out(m)


# ================================================================ contratos dos clientes
def _contrato_out(k: ContratoCliente) -> dict:
    return {"id": k.id, "cliente_id": k.cliente_id, "modelo_id": k.modelo_id, "titulo": k.titulo, "corpo": k.corpo,
            "status": k.status, "enviado_para": k.enviado_para or [], "enviado_em": k.enviado_em, "criado_em": k.criado_em}


def _contrato(db, kid: int) -> ContratoCliente:
    k = db.get(ContratoCliente, kid)
    if not k:
        raise HTTPException(404, "Contrato não encontrado.")
    return k


@router.get("/contratos")
def todos_os_contratos(ctx: Painel):
    with SessaoControle() as db:
        q = select(ContratoCliente).order_by(ContratoCliente.id.desc())
        return [{**_contrato_out(k), "cliente_nome": k.cliente.nome} for k in db.scalars(q)]


@router.get("/clientes/{cid}/contratos")
def contratos_do_cliente(cid: int, ctx: Painel):
    with SessaoControle() as db:
        _cliente(db, cid)
        q = select(ContratoCliente).where(ContratoCliente.cliente_id == cid).order_by(ContratoCliente.id.desc())
        return [_contrato_out(k) for k in db.scalars(q)]


@router.post("/clientes/{cid}/contratos", status_code=201)
def gerar_contrato(cid: int, dados: GerarContratoIn, ctx: Painel):
    with SessaoControle() as db:
        c = _cliente(db, cid)
        m = db.get(ModeloContrato, dados.modelo_id)
        if not m or not m.ativo:
            raise HTTPException(400, "Modelo não encontrado ou inativo.")
        corpo, vazias = contratos.preencher(m.corpo, c)
        k = ContratoCliente(cliente_id=c.id, modelo_id=m.id, titulo=f"{m.nome} — {c.nome}", corpo=corpo)
        db.add(k)
        db.commit()
        ctx.auditar("admin.contrato.gerar", "controle_contrato", k.id, descricao=k.titulo)
        ctx.db.commit()
        return {**_contrato_out(k), "variaveis_vazias": [contratos.VARIAVEIS[v] for v in vazias]}


@router.put("/contratos/{kid}")
def editar_contrato(kid: int, dados: ContratoEdicaoIn, ctx: Painel):
    with SessaoControle() as db:
        k = _contrato(db, kid)
        if k.status != "rascunho":
            raise HTTPException(400, "Contrato já enviado: gere um novo para alterar o texto.")
        k.titulo, k.corpo = dados.titulo, dados.corpo
        db.commit()
        return _contrato_out(k)


def _emitente(ctx) -> str:
    from app.core.models import Identidade

    ident = ctx.db.scalar(select(Identidade).where(Identidade.tenant_id == ctx.tenant_id))
    return ident.nome_exibicao if ident else "MayaCorp"


@router.get("/contratos/{kid}/pdf")
def contrato_pdf(kid: int, ctx: Painel):
    with SessaoControle() as db:
        k = _contrato(db, kid)
        conteudo = contratos.pdf(k.titulo, k.corpo, _emitente(ctx))
    return Response(conteudo, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="contrato-{kid}.pdf"'})


@router.post("/contratos/{kid}/enviar")
def enviar_contrato(kid: int, dados: EnviarContratoIn, ctx: Painel):

    with SessaoControle() as db:
        k = _contrato(db, kid)
        if k.status == "cancelado":
            raise HTTPException(400, "Contrato cancelado.")
        emitente = _emitente(ctx)
        arquivo = contratos.pdf(k.titulo, k.corpo, emitente)
        para = [str(e).lower() for e in dados.para]
        texto = (dados.mensagem or f"Olá,\n\nSegue em anexo o contrato \"{k.titulo}\" para leitura e assinatura.\n\n"
                 "Qualquer dúvida, é só responder este e-mail.").strip()
        service.enviar_email(para, k.titulo, f"{texto}\n\n{emitente}", anexos=[(f"contrato-{k.id}.pdf", arquivo, "application/pdf")])
        k.status, k.enviado_para, k.enviado_em = "enviado", para, agora()
        db.commit()
        ctx.auditar("admin.contrato.enviar", "controle_contrato", k.id, descricao=f"{k.titulo} → {', '.join(para)}")
        ctx.db.commit()
        return _contrato_out(k)


@router.post("/contratos/{kid}/status")
def status_contrato(kid: int, dados: ContratoStatusIn, ctx: Painel):
    with SessaoControle() as db:
        k = _contrato(db, kid)
        k.status = dados.status
        db.commit()
        ctx.auditar("admin.contrato.status", "controle_contrato", k.id, descricao=f"{k.titulo}: {dados.status}")
        ctx.db.commit()
        return _contrato_out(k)


@router.get("/meta", response_model=None)
def meta(ctx: Painel) -> dict:
    return {"status": [{"chave": k, "rotulo": v} for k, v in STATUS.items()]}



# ================================================================ ✨ IA (provedor configurado no próprio admin)
SISTEMA_ADMIN = ("Você é o assistente comercial da MayaCorp, empresa que vende o MayaJus (sistema de gestão para "
                 "escritórios de advocacia) por assinatura. Escreva em português do Brasil, claro, profissional e sem "
                 "inventar dados. Responda SOMENTE com um objeto JSON válido no formato pedido.")


class TextoIAIn(BaseModel):
    texto: str = Field(min_length=10, max_length=8000)


class ContratoIAIn(BaseModel):
    instrucao: str | None = Field(default=None, max_length=2000)
    corpo: str | None = Field(default=None, max_length=30000)


class MensagemIAIn(BaseModel):
    titulo: str = Field(max_length=200)
    cliente_id: int
    instrucao: str | None = Field(default=None, max_length=1000)


def _ia(ctx, acao: str, pedido: str) -> dict:
    from app.core.routes.ia import _chamar

    return _chamar(ctx, f"admin.{acao}", SISTEMA_ADMIN, pedido)


@router.post("/ia/ficha")
def ia_ficha(dados: TextoIAIn, ctx: Painel):
    """Preenche a ficha do cliente a partir de um texto colado (cartão CNPJ, e-mail, assinatura)."""
    r = _ia(ctx, "ficha", "Extraia do texto os dados do escritório cliente. Use null para o que não estiver no texto; "
                          "nunca invente.\nFormato: {\"nome\", \"documento\" (CNPJ ou CPF), \"responsavel\" (pessoa que "
                          "assina), \"email_financeiro\", \"telefone\"}\nTexto:\n" + dados.texto)
    campos = {k: str(v).strip() for k, v in r.items()
              if k in ("nome", "documento", "responsavel", "email_financeiro", "telefone") and v not in (None, "", "null")}
    if "documento" in campos:
        dig = re.sub(r"\D", "", campos["documento"])
        if len(dig) in (11, 14):
            campos["documento"] = dig
        else:
            campos.pop("documento")
    if "email_financeiro" in campos and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", campos["email_financeiro"]):
        campos.pop("email_financeiro")
    return {"campos": campos}


@router.post("/ia/contrato")
def ia_contrato(dados: ContratoIAIn, ctx: Painel):
    """Escreve ou melhora o texto do contrato usando só as variáveis que o sistema sabe preencher."""
    if not (dados.instrucao or dados.corpo):
        raise HTTPException(400, "Diga o que a IA deve fazer ou cole o texto atual.")
    lista = "\n".join(f"{{{{{k}}}}} = {v}" for k, v in contratos.VARIAVEIS.items())
    r = _ia(ctx, "contrato",
            "Escreva (ou melhore, se houver texto atual) um contrato de licença de uso de software por assinatura entre "
            "a MayaCorp (contratada) e o escritório (contratante). Use os dados do cliente SOMENTE por estas variáveis, "
            f"exatamente como escritas:\n{lista}\nNão crie outras variáveis nem invente valores. Parágrafos separados "
            "por uma linha em branco; cláusulas numeradas; sem markdown.\n"
            f"Pedido: {dados.instrucao or 'revise e deixe mais claro, completo e profissional'}\n"
            f"Texto atual:\n{dados.corpo or '(nenhum)'}\n"
            'Formato: {"corpo": str, "resumo": str (o que mudou, 1-2 frases)}')
    corpo = str(r.get("corpo") or "").strip()
    if len(corpo) < 50:
        raise HTTPException(400, "A IA não devolveu um texto utilizável. Tente de novo com outro pedido.")
    return {"corpo": corpo, "resumo": str(r.get("resumo") or ""), "variaveis_desconhecidas": contratos.desconhecidas(corpo)}


@router.post("/ia/mensagem")
def ia_mensagem(dados: MensagemIAIn, ctx: Painel):
    """Texto do e-mail que leva o contrato."""
    with SessaoControle() as db:
        c = _cliente(db, dados.cliente_id)
        quem, nome = c.responsavel or "", c.nome
    r = _ia(ctx, "mensagem", f"Escreva um e-mail curto e cordial enviando o contrato \"{dados.titulo}\" para {nome}"
                             f"{f', aos cuidados de {quem}' if quem else ''}, pedindo leitura e assinatura. Sem assinatura "
                             f"no final (ela é adicionada depois). {dados.instrucao or ''}\n"
                             'Formato: {"mensagem": str}')
    mensagem = str(r.get("mensagem") or "").strip()
    if not mensagem:
        raise HTTPException(400, "A IA não devolveu um texto. Tente de novo.")
    return {"mensagem": mensagem}
