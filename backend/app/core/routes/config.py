"""Configurações: identidade, certificado digital, usuários e notificações."""

from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from sqlalchemy import select

from app.core import audit, certificados, perfis, tenancy
from app.core import email as mail
from app.core.config import settings
from app.core.db import agora
from app.core.deps import Admin, Ctx
from app.core.models import Cargo, Certificado, ConfigNotificacao, Identidade, Perfil, PerfilAcesso, Usuario
from app.core.routes.public import logo_url
from app.core.schemas import (
    CargoIn,
    CargoOut,
    CertificadoOut,
    DefinirSenhaIn,
    IdentidadeIn,
    IdentidadeOut,
    Mensagem,
    NotificacoesIn,
    NotificacoesOut,
    PerfilAcessoIn,
    PerfilAcessoOut,
    TesteConexaoOut,
    UsuarioConviteIn,
    UsuarioOut,
    UsuarioPatch,
)
from app.core.security import cifrar, criar_token, hash_senha, validar_politica_senha

router = APIRouter(prefix="/config", tags=["configurações"])


# ---------------------------------------------------------------- identidade
def _ident(ctx) -> Identidade:
    ident = ctx.db.get(Identidade, ctx.tenant_id)
    if not ident:
        ident = Identidade(tenant_id=ctx.tenant_id, nome_exibicao=ctx.usuario.tenant.nome)
        ctx.db.add(ident)
        ctx.db.flush()
    return ident


def _ident_out(i: Identidade) -> IdentidadeOut:
    return IdentidadeOut(nome_exibicao=i.nome_exibicao, logo_url=logo_url(i), cor_destaque=i.cor_destaque,
                         assinatura_email=i.assinatura_email)


@router.get("/identidade", response_model=IdentidadeOut)
def ler_identidade(ctx: Ctx):
    return _ident_out(_ident(ctx))


@router.put("/identidade", response_model=IdentidadeOut)
def salvar_identidade(dados: IdentidadeIn, ctx: Admin):
    i = _ident(ctx)
    antes = audit.snapshot(i)
    for k, v in dados.model_dump().items():
        setattr(i, k, v)
    ctx.db.flush()
    a, d = audit.diff(antes, audit.snapshot(i))
    ctx.auditar("identidade.alterar", "identidade", ctx.tenant_id, antes=a, depois=d)
    ctx.db.commit()
    return _ident_out(i)


@router.post("/identidade/logo", response_model=IdentidadeOut)
async def enviar_logo(ctx: Admin, arquivo: UploadFile = File(...)):
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in (".png", ".svg", ".jpg", ".jpeg", ".webp"):
        raise HTTPException(400, "Envie o logo em PNG, SVG, JPG ou WEBP.")
    conteudo = await arquivo.read()
    if len(conteudo) > 3 * 1024 * 1024:
        raise HTTPException(400, "O logo deve ter no máximo 3 MB.")
    destino = tenancy.pasta_base() / "identidade" / f"tenant_{ctx.tenant_id}{ext}"
    destino.parent.mkdir(parents=True, exist_ok=True)
    for antigo in destino.parent.glob(f"tenant_{ctx.tenant_id}.*"):
        antigo.unlink()
    destino.write_bytes(conteudo)
    i = _ident(ctx)
    i.logo_path = str(destino)
    ctx.auditar("identidade.logo", "identidade", ctx.tenant_id, descricao=f"Novo logo ({arquivo.filename})")
    ctx.db.commit()
    return _ident_out(i)


# ---------------------------------------------------------------- certificado
def _cert_out(c: Certificado) -> CertificadoOut:
    return CertificadoOut(
        id=c.id, titular=c.titular, cnpj=c.cnpj, emissor=c.emissor, valido_de=c.valido_de, valido_ate=c.valido_ate,
        dias_restantes=(c.valido_ate - date.today()).days, serial=c.serial, ativo=c.ativo,
        ultimo_teste_em=c.ultimo_teste_em, ultimo_teste_ok=c.ultimo_teste_ok, ultimo_teste_msg=c.ultimo_teste_msg,
        criado_em=c.criado_em,
    )


@router.get("/certificados", response_model=list[CertificadoOut])
def listar_certificados(ctx: Ctx):
    q = select(Certificado).where(Certificado.tenant_id == ctx.tenant_id).order_by(Certificado.ativo.desc(), Certificado.id.desc())
    return [_cert_out(c) for c in ctx.db.scalars(q)]


@router.post("/certificados", response_model=CertificadoOut)
async def enviar_certificado(ctx: Admin, arquivo: UploadFile = File(...), senha: str = Form(...)):
    if Path(arquivo.filename or "").suffix.lower() not in (".pfx", ".p12"):
        raise HTTPException(400, "Envie o certificado A1 no formato .pfx ou .p12.")
    pfx = await arquivo.read()
    try:
        info = certificados.ler_info(pfx, senha)
    except certificados.CertificadoInvalido as e:
        raise HTTPException(400, str(e)) from e
    if info.valido_ate < date.today():
        raise HTTPException(400, f"Este certificado venceu em {info.valido_ate:%d/%m/%Y}.")
    # Substituição sem perder o anterior: o novo entra inativo até ser ativado (ou ativo se for o primeiro)
    tem_ativo = ctx.db.scalar(select(Certificado.id).where(Certificado.tenant_id == ctx.tenant_id, Certificado.ativo))
    c = Certificado(
        tenant_id=ctx.tenant_id, titular=info.titular, cnpj=info.cnpj, emissor=info.emissor, valido_de=info.valido_de,
        valido_ate=info.valido_ate, serial=info.serial, pfx_cifrado=cifrar(pfx), senha_cifrada=cifrar(senha.encode()),
        ativo=not tem_ativo, alertas_enviados=[],
    )
    ctx.db.add(c)
    ctx.db.flush()
    if c.ativo:
        _vincular_emissoras(ctx, c)
    ctx.auditar("certificado.enviar", "certificado", c.id, descricao=f"{info.titular} · válido até {info.valido_ate:%d/%m/%Y}")
    ctx.db.commit()
    return _cert_out(c)


def _vincular_emissoras(ctx, c: Certificado) -> None:
    from app.modules.rpa_nfse.models import Emissora

    for e in ctx.db.scalars(select(Emissora).where(Emissora.tenant_id == ctx.tenant_id)):
        if not c.cnpj or e.cnpj[:8] == c.cnpj[:8]:
            e.certificado_id = c.id


@router.post("/certificados/{cert_id}/ativar", response_model=CertificadoOut)
def ativar_certificado(cert_id: int, ctx: Admin):
    c = ctx.db.get(Certificado, cert_id)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Certificado não encontrado.")
    for outro in ctx.db.scalars(select(Certificado).where(Certificado.tenant_id == ctx.tenant_id)):
        outro.ativo = outro.id == c.id
    _vincular_emissoras(ctx, c)
    ctx.auditar("certificado.ativar", "certificado", c.id, descricao=f"Ativado: {c.titular}")
    ctx.db.commit()
    return _cert_out(c)


@router.post("/certificados/{cert_id}/testar", response_model=TesteConexaoOut)
def testar_certificado(cert_id: int, ctx: Admin):
    """Consulta real à Prefeitura (ConsultaCNPJ) usando o certificado."""
    from app.modules.rpa_nfse.prefeitura_sp import ClientePrefeitura, FalhaComunicacao

    c = ctx.db.get(Certificado, cert_id)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Certificado não encontrado.")
    try:
        carregado = certificados.abrir(c)
        cnpj = c.cnpj or "00000000000000"
        from app.modules.rpa_nfse.service import modo_prefeitura

        ret = ClientePrefeitura(carregado, modo_prefeitura(ctx.db, ctx.tenant_id)).consultar_cnpj(cnpj_remetente=cnpj, cnpj=cnpj)
        ok = ret.sucesso
        msg = ("Conexão com a Prefeitura aprovada" + (" (modo simulação)" if ret.simulado else "") + ".") if ok else (
            ret.erros[0].humano()["mensagem"] if ret.erros else "A Prefeitura recusou a consulta.")
        detalhe = "; ".join(f"{e.codigo}: {e.descricao}" for e in ret.erros) or None
    except (certificados.CertificadoInvalido, FalhaComunicacao, RuntimeError) as e:
        ok, msg, detalhe = False, "Não foi possível falar com a Prefeitura usando este certificado.", str(e)[:500]
    c.ultimo_teste_em, c.ultimo_teste_ok, c.ultimo_teste_msg = agora(), ok, msg
    ctx.auditar("certificado.testar", "certificado", c.id, descricao=msg)
    ctx.db.commit()
    return TesteConexaoOut(ok=ok, mensagem=msg, detalhe=detalhe)


# ---------------------------------------------------------------- usuários
def _usuario_out(u: Usuario) -> UsuarioOut:
    now = agora()
    online = bool(u.ultima_atividade and now - u.ultima_atividade.replace(tzinfo=now.tzinfo) < timedelta(minutes=5))
    from app.core.routes.auth import foto_url

    return UsuarioOut(id=u.id, nome=u.nome, email=u.email, login=u.login, foto_url=foto_url(u), perfil=u.perfil, ativo=u.ativo,
                      convite_pendente=u.convite_pendente and u.acesso_sistema, ultimo_acesso=u.ultimo_acesso, online=online,
                      acesso_sistema=u.acesso_sistema, cargo_id=u.cargo_id, perfil_acesso_id=u.perfil_acesso_id,
                      perfil_acesso_nome=u.perfil_acesso.nome if u.perfil_acesso else None,
                      perfil_acesso_cor=u.perfil_acesso.cor if u.perfil_acesso else None, cargo_nome=u.cargo.nome if u.cargo else None,
                      cpf=u.cpf, oab=u.oab, telefone=u.telefone, data_admissao=u.data_admissao, cep=u.cep,
                      logradouro=u.logradouro, numero_endereco=u.numero_endereco, complemento=u.complemento, bairro=u.bairro,
                      cidade=u.cidade, uf=u.uf)


@router.get("/usuarios", response_model=list[UsuarioOut])
def listar_usuarios(ctx: Admin):
    return [_usuario_out(u) for u in ctx.db.scalars(select(Usuario).where(Usuario.tenant_id == ctx.tenant_id).order_by(Usuario.nome))]


def _enviar_convite(u: Usuario, novo: bool) -> None:
    token = criar_token(str(u.id), "reset", {"h": (u.senha_hash or "")[-12:]})
    link = f"{settings.frontend_url}/redefinir-senha?token={token}"
    if novo:
        assunto, texto = "Seu acesso ao MayaJus", f"Olá, {u.nome}!\n\nVocê foi convidado(a) para a plataforma. Defina sua senha:\n{link}"
    else:
        assunto, texto = "Redefinição de senha", f"Olá, {u.nome}.\n\nUm administrador pediu a redefinição da sua senha:\n{link}"
    mail.enviar([u.email], assunto, texto + "\n\nO link vale por 2 horas.")


def _checar_unicos(ctx, email: str | None, login: str | None, exceto: int | None = None) -> None:
    if email and ctx.db.scalar(select(Usuario.id).where(Usuario.email == email.lower(), Usuario.id != (exceto or 0))):
        raise HTTPException(409, "Já existe um usuário com este e-mail.")
    if login and ctx.db.scalar(select(Usuario.id).where(Usuario.login == login.lower(), Usuario.id != (exceto or 0))):
        raise HTTPException(409, "Este login já está em uso.")
    from app.core import tenancy

    if tenancy.multi() and (esc := tenancy.atual()) and (email or login):
        from app.controle import service as controle

        # no endereço principal o login diz o escritório: não pode repetir entre escritórios
        if controle.chaves_em_uso([email, login], exceto_slug=esc.slug, exceto_usuario=exceto):
            raise HTTPException(409, "Este e-mail ou login já é usado em outro escritório do MayaJus.")


def _checar_cargo(ctx, cargo_id: int | None) -> None:
    if cargo_id:
        c = ctx.db.get(Cargo, cargo_id)
        if not c or c.tenant_id != ctx.tenant_id:
            raise HTTPException(404, "Cargo não encontrado.")


@router.post("/usuarios", response_model=UsuarioOut)
def convidar_usuario(dados: UsuarioConviteIn, ctx: Admin):
    """Cadastra o funcionário. Com acesso ao sistema, recebe convite (ou já sai com senha)."""
    _checar_unicos(ctx, dados.email, dados.login)
    _checar_cargo(ctx, dados.cargo_id)
    acesso = dados.acesso_sistema
    if acesso and dados.senha and (erro := validar_politica_senha(dados.senha)):
        raise HTTPException(400, erro)
    u = Usuario(tenant_id=ctx.tenant_id, nome=dados.nome, email=dados.email.lower(),
                login=dados.login.lower() if dados.login and acesso else None, perfil=dados.perfil,
                senha_hash=hash_senha(dados.senha) if dados.senha and acesso else None,
                convite_pendente=acesso and not dados.senha, acesso_sistema=acesso, cargo_id=dados.cargo_id,
                **dados.model_dump(include={"cpf", "oab", "telefone", "data_admissao", "cep", "logradouro", "numero_endereco",
                                            "complemento", "bairro", "cidade", "uf"}))
    u.perfil_acesso_id = None
    ctx.db.add(u)
    ctx.db.flush()
    _definir_perfil(ctx, u, dados.perfil_acesso_id, dados.perfil)
    if acesso and not dados.senha:
        _enviar_convite(u, novo=True)
    ctx.auditar("usuario.convidar", "usuario", u.id, descricao=f"{u.nome} ({u.perfil.value})", depois=audit.snapshot(u))
    ctx.db.commit()
    return _usuario_out(u)


def _usuario(ctx, uid: int) -> Usuario:
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Usuário não encontrado.")
    return u


def _perfil(ctx, pid: int | None) -> PerfilAcesso:
    p = ctx.db.get(PerfilAcesso, pid) if pid else None
    if not p or p.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Perfil de acesso não encontrado.")
    return p


def _definir_perfil(ctx, u: Usuario, perfil_acesso_id: int | None, legado: Perfil) -> None:
    """Novo usuário: o perfil de acesso escolhido ou o equivalente ao perfil legado informado."""
    if perfil_acesso_id:
        perfis.aplicar(u, _perfil(ctx, perfil_acesso_id))
        return
    nome = {Perfil.admin: "Administrador", Perfil.operador: "Operador"}.get(legado, "Visualizador")
    padrao = perfis.garantir_padrao(ctx.db, ctx.tenant_id)
    perfis.aplicar(u, padrao[nome])


def _sobra_admin(ctx, u: Usuario) -> bool:
    outros = ctx.db.scalar(select(Usuario.id).where(Usuario.tenant_id == ctx.tenant_id, Usuario.id != u.id,
                                                    Usuario.perfil == Perfil.admin, Usuario.ativo))
    return bool(outros)


@router.patch("/usuarios/{uid}", response_model=UsuarioOut)
def alterar_usuario(uid: int, dados: UsuarioPatch, ctx: Admin):
    u = _usuario(ctx, uid)
    mudancas = dados.model_dump(exclude_unset=True)
    _checar_unicos(ctx, mudancas.get("email"), mudancas.get("login"), exceto=u.id)
    _checar_cargo(ctx, mudancas.get("cargo_id"))
    if mudancas.get("acesso_sistema") is False and u.id == ctx.usuario.id:
        raise HTTPException(400, "Você não pode tirar o seu próprio acesso.")
    if mudancas.get("acesso_sistema") is False and u.perfil == Perfil.admin and not _sobra_admin(ctx, u):
        raise HTTPException(400, "É preciso manter pelo menos um Administrador com acesso.")
    for k in ("email", "login"):
        if mudancas.get(k):
            mudancas[k] = mudancas[k].lower()
    if "perfil_acesso_id" in mudancas:
        novo = _perfil(ctx, mudancas.pop("perfil_acesso_id"))
        mudancas.pop("perfil", None)
        if u.administrador and not novo.administrador and u.id == ctx.usuario.id:
            raise HTTPException(400, "Você não pode tirar o seu próprio acesso de administrador.")
        mudancas["perfil"] = perfis.perfil_legado(novo)
        u.perfil_acesso_id = novo.id
    perde_admin = (mudancas.get("perfil") not in (None, Perfil.admin) or mudancas.get("ativo") is False)
    if u.perfil == Perfil.admin and perde_admin and not _sobra_admin(ctx, u):
        raise HTTPException(400, "É preciso manter pelo menos um Administrador ativo.")
    antes = audit.snapshot(u)
    for k, v in mudancas.items():
        setattr(u, k, v)
    ctx.db.flush()
    a, d = audit.diff(antes, audit.snapshot(u))
    ctx.auditar("usuario.alterar", "usuario", u.id, descricao=u.nome, antes=a, depois=d)
    ctx.db.commit()
    return _usuario_out(u)


@router.delete("/usuarios/{uid}", response_model=Mensagem)
def desativar_usuario(uid: int, ctx: Admin):
    u = _usuario(ctx, uid)
    if u.id == ctx.usuario.id:
        raise HTTPException(400, "Você não pode desativar a si mesmo.")
    if u.perfil == Perfil.admin and not _sobra_admin(ctx, u):
        raise HTTPException(400, "É preciso manter pelo menos um Administrador ativo.")
    u.ativo = False
    ctx.auditar("usuario.desativar", "usuario", u.id, descricao=u.nome)
    ctx.db.commit()
    return Mensagem(mensagem=f"{u.nome} foi desativado(a).")


@router.get("/cargos", response_model=list[CargoOut])
def listar_cargos(ctx: Ctx):
    from sqlalchemy import func

    qtd = dict(ctx.db.execute(select(Usuario.cargo_id, func.count()).where(Usuario.tenant_id == ctx.tenant_id, Usuario.ativo)
                              .group_by(Usuario.cargo_id)).all())
    return [CargoOut(id=c.id, nome=c.nome, ordem=c.ordem, ativo=c.ativo, qtd_funcionarios=qtd.get(c.id, 0))
            for c in ctx.db.scalars(select(Cargo).where(Cargo.tenant_id == ctx.tenant_id).order_by(Cargo.ordem, Cargo.nome))]


@router.post("/cargos", response_model=CargoOut, status_code=201)
def criar_cargo(dados: CargoIn, ctx: Admin):
    c = Cargo(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("cargo.criar", "cargo", c.id, descricao=c.nome)
    ctx.db.commit()
    return CargoOut.model_validate(c)


@router.put("/cargos/{cid}", response_model=CargoOut)
def alterar_cargo(cid: int, dados: CargoIn, ctx: Admin):
    _checar_cargo(ctx, cid)
    c = ctx.db.get(Cargo, cid)
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("cargo.alterar", "cargo", c.id, descricao=c.nome)
    ctx.db.commit()
    return CargoOut.model_validate(c)


@router.delete("/cargos/{cid}", response_model=Mensagem)
def excluir_cargo(cid: int, ctx: Admin):
    from sqlalchemy import func

    from app.modules.faturamento.models import TabelaPrecoItem

    _checar_cargo(ctx, cid)
    c = ctx.db.get(Cargo, cid)
    em_uso = (ctx.db.scalar(select(func.count()).select_from(Usuario).where(Usuario.cargo_id == cid)) or 0) + \
        (ctx.db.scalar(select(func.count()).select_from(TabelaPrecoItem).where(TabelaPrecoItem.cargo_id == cid)) or 0)
    if em_uso:
        c.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Cargo em uso (funcionários ou tabelas de preço): foi desativado.")
    ctx.auditar("cargo.excluir", "cargo", c.id, descricao=c.nome)
    ctx.db.delete(c)
    ctx.db.commit()
    return Mensagem(mensagem="Cargo excluído.")


# ---------------------------------------------------------------- perfis de acesso
def _perfil_out(ctx, p: PerfilAcesso) -> PerfilAcessoOut:
    from sqlalchemy import func

    qtd = ctx.db.scalar(select(func.count()).select_from(Usuario).where(Usuario.perfil_acesso_id == p.id, Usuario.ativo)) or 0
    return PerfilAcessoOut.model_validate(p).model_copy(update={"qtd_usuarios": qtd})


@router.get("/perfis/catalogo")
def catalogo_permissoes(ctx: Ctx):
    from app.core.permissoes import CATALOGO, ROTULO_ACAO

    return {"grupos": CATALOGO, "acoes": ROTULO_ACAO}


@router.get("/perfis", response_model=list[PerfilAcessoOut])
def listar_perfis(ctx: Ctx):
    perfis.garantir_padrao(ctx.db, ctx.tenant_id)
    ctx.db.commit()
    lista = ctx.db.scalars(select(PerfilAcesso).where(PerfilAcesso.tenant_id == ctx.tenant_id)
                           .order_by(PerfilAcesso.administrador.desc(), PerfilAcesso.nome))
    return [_perfil_out(ctx, p) for p in lista]


def _salvar_perfil(ctx, p: PerfilAcesso, dados: PerfilAcessoIn) -> None:
    from sqlalchemy import func

    from app.core.permissoes import normalizar

    if ctx.db.scalar(select(PerfilAcesso.id).where(PerfilAcesso.tenant_id == ctx.tenant_id, PerfilAcesso.id != (p.id or 0),
                                                   func.lower(PerfilAcesso.nome) == dados.nome.strip().lower())):
        raise HTTPException(409, "Já existe um perfil com este nome.")
    if p.sistema and not dados.administrador:
        raise HTTPException(400, "O perfil Administrador padrão continua com acesso total (duplique para criar outro).")
    p.nome, p.descricao, p.cor = dados.nome.strip(), dados.descricao, dados.cor
    p.administrador = dados.administrador
    p.permissoes = [] if dados.administrador else normalizar(dados.permissoes)
    ctx.db.flush()
    for u in ctx.db.scalars(select(Usuario).where(Usuario.perfil_acesso_id == p.id)):
        u.perfil = perfis.perfil_legado(p)


@router.post("/perfis", response_model=PerfilAcessoOut, status_code=201)
def criar_perfil(dados: PerfilAcessoIn, ctx: Admin):
    p = PerfilAcesso(tenant_id=ctx.tenant_id, nome=dados.nome)
    ctx.db.add(p)
    _salvar_perfil(ctx, p, dados)
    ctx.auditar("perfil_acesso.criar", "perfil_acesso", p.id, descricao=p.nome, depois={"permissoes": p.permissoes})
    ctx.db.commit()
    return _perfil_out(ctx, p)


@router.put("/perfis/{pid}", response_model=PerfilAcessoOut)
def alterar_perfil(pid: int, dados: PerfilAcessoIn, ctx: Admin):
    p = _perfil(ctx, pid)
    antes = {"nome": p.nome, "administrador": p.administrador, "permissoes": list(p.permissoes or [])}
    if p.administrador and not dados.administrador and ctx.usuario.perfil_acesso_id == p.id:
        raise HTTPException(400, "Você usa este perfil: tirar o acesso total dele tiraria o seu também.")
    _salvar_perfil(ctx, p, dados)
    ctx.auditar("perfil_acesso.alterar", "perfil_acesso", p.id, descricao=p.nome, antes=antes,
                depois={"nome": p.nome, "administrador": p.administrador, "permissoes": p.permissoes})
    ctx.db.commit()
    return _perfil_out(ctx, p)


@router.post("/perfis/{pid}/duplicar", response_model=PerfilAcessoOut, status_code=201)
def duplicar_perfil(pid: int, ctx: Admin):
    base = _perfil(ctx, pid)
    nome, n = f"{base.nome} (cópia)", 2
    while ctx.db.scalar(select(PerfilAcesso.id).where(PerfilAcesso.tenant_id == ctx.tenant_id, PerfilAcesso.nome == nome)):
        nome, n = f"{base.nome} (cópia {n})", n + 1
    from app.core.permissoes import TODAS

    p = PerfilAcesso(tenant_id=ctx.tenant_id, nome=nome, descricao=base.descricao, cor=base.cor, administrador=False,
                     permissoes=sorted(TODAS) if base.administrador else list(base.permissoes or []))
    ctx.db.add(p)
    ctx.db.flush()
    ctx.auditar("perfil_acesso.criar", "perfil_acesso", p.id, descricao=f"{p.nome} (duplicado de {base.nome})")
    ctx.db.commit()
    return _perfil_out(ctx, p)


@router.delete("/perfis/{pid}", response_model=Mensagem)
def excluir_perfil(pid: int, ctx: Admin):
    from sqlalchemy import func

    p = _perfil(ctx, pid)
    if p.sistema:
        raise HTTPException(400, "O perfil Administrador padrão não pode ser excluído.")
    qtd = ctx.db.scalar(select(func.count()).select_from(Usuario).where(Usuario.perfil_acesso_id == p.id)) or 0
    if qtd:
        raise HTTPException(400, f"{qtd} profissional(is) usam este perfil: troque o perfil deles antes de excluir.")
    ctx.auditar("perfil_acesso.excluir", "perfil_acesso", p.id, descricao=p.nome)
    ctx.db.delete(p)
    ctx.db.commit()
    return Mensagem(mensagem="Perfil excluído.")


@router.post("/usuarios/{uid}/redefinir-senha", response_model=Mensagem)
def redefinir_senha(uid: int, ctx: Admin):
    u = _usuario(ctx, uid)
    _enviar_convite(u, novo=u.convite_pendente)
    ctx.auditar("usuario.redefinir_senha", "usuario", u.id, descricao=u.nome)
    ctx.db.commit()
    return Mensagem(mensagem=f"Enviamos um link para {u.email}.")


@router.post("/usuarios/{uid}/definir-senha", response_model=Mensagem)
def definir_senha(uid: int, dados: DefinirSenhaIn, ctx: Admin):
    u = _usuario(ctx, uid)
    if erro := validar_politica_senha(dados.senha):
        raise HTTPException(400, erro)
    u.senha_hash = hash_senha(dados.senha)
    u.convite_pendente = False
    u.tentativas_falhas = 0
    u.bloqueado_ate = None
    ctx.auditar("usuario.definir_senha", "usuario", u.id, descricao=f"Senha definida por {ctx.usuario.nome}")
    ctx.db.commit()
    return Mensagem(mensagem=f"Senha de {u.nome} definida.")


# ---------------------------------------------------------------- notificações
def _notif(ctx) -> ConfigNotificacao:
    n = ctx.db.get(ConfigNotificacao, ctx.tenant_id)
    nome = (ident := ctx.db.get(Identidade, ctx.tenant_id)) and ident.nome_exibicao
    if not n:
        n = ConfigNotificacao(tenant_id=ctx.tenant_id, avisos_destinatarios=[], remetente_nome=nome or "MayaJus")
        ctx.db.add(n)
        ctx.db.flush()
    elif nome and n.remetente_nome == "CFME Advogados" and nome != "CFME Advogados" and not n.smtp_host:
        n.remetente_nome = nome  # nascia com o nome da CFME fixo; corrige quem ainda não configurou
    return n


def _notif_out(n: ConfigNotificacao) -> NotificacoesOut:
    dados = {k: getattr(n, k) for k in NotificacoesOut.model_fields if k != "smtp_senha_definida"}
    return NotificacoesOut(**dados, smtp_senha_definida=bool(n.smtp_senha_cifrada))


@router.get("/notificacoes", response_model=NotificacoesOut)
def ler_notificacoes(ctx: Ctx):
    return _notif_out(_notif(ctx))


@router.put("/notificacoes", response_model=NotificacoesOut)
def salvar_notificacoes(dados: NotificacoesIn, ctx: Admin):
    n = _notif(ctx)
    antes = audit.snapshot(n)
    valores = dados.model_dump()
    senha = valores.pop("smtp_senha")
    for k, v in valores.items():
        setattr(n, k, v)
    if senha:
        n.smtp_senha_cifrada = cifrar(senha.encode())
    ctx.db.flush()
    a, d = audit.diff(antes, audit.snapshot(n))
    ctx.auditar("notificacoes.alterar", "config_notificacao", ctx.tenant_id, antes=a, depois=d)
    ctx.db.commit()
    return _notif_out(n)
