from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.core.models import Perfil


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Pagina[T](Schema):
    itens: list[T]
    total: int
    pagina: int
    por_pagina: int


class Mensagem(Schema):
    mensagem: str


# ---------- Auth ----------
class LoginIn(BaseModel):
    email: str = Field(min_length=1, description="E-mail ou nome de usuário")
    senha: str


class RefreshIn(BaseModel):
    refresh_token: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    senha: str


class UsuarioMe(Schema):
    id: int
    nome: str
    email: str
    login: str | None = None
    foto_url: str | None = None  # buscar com o token (fetch → blob)
    equipe_mayacorp: bool = False
    preferencias: dict[str, Any] = {}
    perfil: Perfil
    tenant_id: int


class IdentidadePublica(Schema):
    nome_exibicao: str
    logo_url: str | None = None
    cor_destaque: str | None = None


class TokenOut(Schema):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    usuario: UsuarioMe


# ---------- Identidade ----------
class IdentidadeOut(Schema):
    nome_exibicao: str
    logo_url: str | None = None
    cor_destaque: str | None = None
    assinatura_email: str | None = None


class IdentidadeIn(BaseModel):
    nome_exibicao: str = Field(min_length=2, max_length=200)
    cor_destaque: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    assinatura_email: str | None = None


# ---------- Certificado ----------
class CertificadoOut(Schema):
    id: int
    titular: str
    cnpj: str | None
    emissor: str
    valido_de: date
    valido_ate: date
    dias_restantes: int
    serial: str
    ativo: bool
    ultimo_teste_em: datetime | None
    ultimo_teste_ok: bool | None
    ultimo_teste_msg: str | None
    criado_em: datetime


class TesteConexaoOut(Schema):
    ok: bool
    mensagem: str
    detalhe: str | None = None


# ---------- Usuários ----------
LOGIN_RE = r"^[a-z0-9._-]{3,60}$"


class UsuarioOut(Schema):
    id: int
    nome: str
    email: str
    login: str | None = None
    foto_url: str | None = None
    perfil: Perfil
    ativo: bool
    convite_pendente: bool
    ultimo_acesso: datetime | None
    online: bool = False


class UsuarioConviteIn(BaseModel):
    nome: str = Field(min_length=2)
    email: EmailStr
    login: str | None = Field(default=None, pattern=LOGIN_RE)
    perfil: Perfil = Perfil.operador
    senha: str | None = None  # opcional: já define a senha (sem depender do e-mail de convite)


class UsuarioPatch(BaseModel):
    nome: str | None = None
    email: EmailStr | None = None
    login: str | None = Field(default=None, pattern=LOGIN_RE)
    perfil: Perfil | None = None
    ativo: bool | None = None


class DefinirSenhaIn(BaseModel):
    senha: str


class TrocarSenhaIn(BaseModel):
    senha_atual: str
    nova_senha: str


# ---------- Notificações ----------
class NotificacoesOut(Schema):
    remetente_nome: str
    remetente_email: str
    smtp_host: str | None
    smtp_porta: int
    smtp_usuario: str | None
    smtp_senha_definida: bool = False
    assunto_modelo: str
    corpo_modelo: str
    anexar_pdf: bool
    anexar_xml: bool
    envio_automatico: bool
    avisos_destinatarios: list[str]
    email_cc_padrao: list[str] = []
    email_cco_padrao: list[str] = []
    aviso_fim_lote: bool
    aviso_rejeicoes: bool
    aviso_certificado: bool


class NotificacoesIn(BaseModel):
    remetente_nome: str
    remetente_email: EmailStr
    smtp_host: str | None = None
    smtp_porta: int = 587
    smtp_usuario: str | None = None
    smtp_senha: str | None = None  # só altera se enviado
    assunto_modelo: str
    corpo_modelo: str
    anexar_pdf: bool = True
    anexar_xml: bool = True
    envio_automatico: bool = False
    avisos_destinatarios: list[EmailStr] = []
    email_cc_padrao: list[EmailStr] = []
    email_cco_padrao: list[EmailStr] = []
    aviso_fim_lote: bool = True
    aviso_rejeicoes: bool = True
    aviso_certificado: bool = True


# ---------- Auditoria ----------
class AuditoriaOut(Schema):
    id: int
    usuario_nome: str | None
    acao: str
    entidade: str
    entidade_id: str | None
    descricao: str | None
    antes_json: dict[str, Any] | None
    depois_json: dict[str, Any] | None
    ip: str | None
    criado_em: datetime


# ---------- Hub ----------
class AutomacaoCard(Schema):
    slug: str
    nome: str
    descricao: str
    icone: str
    status: str  # ativo | planejado | ideia
    href: str | None
    metrica: str | None = None
