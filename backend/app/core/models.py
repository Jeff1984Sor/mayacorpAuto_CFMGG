"""Modelos do núcleo compartilhado: tenant, usuários, identidade, certificado, notificações e auditoria."""

import enum
from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped, UtcDateTime, agora


class Perfil(enum.StrEnum):
    admin = "admin"
    operador = "operador"
    visualizador = "visualizador"


class Tenant(Base, Timestamped):
    __tablename__ = "tenant"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    nome: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="ativo")

    identidade: Mapped["Identidade"] = relationship(back_populates="tenant", uselist=False)


class PerfilAcesso(Base, Timestamped):
    """Grupo de permissões (Configurações › Perfis de acesso). "administrador" pode tudo."""

    __tablename__ = "perfil_acesso"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(80))
    descricao: Mapped[str | None] = mapped_column(String(300))
    cor: Mapped[str | None] = mapped_column(String(7))
    administrador: Mapped[bool] = mapped_column(Boolean, default=False)
    sistema: Mapped[bool] = mapped_column(Boolean, default=False)  # o Administrador padrão não pode ser excluído
    permissoes: Mapped[list[str]] = mapped_column(JSON, default=list)


class Cargo(Base, Timestamped):
    """Cargo do funcionário (Sócio, Advogado Sênior, Estagiário...). É a categoria usada nas tabelas de preço."""

    __tablename__ = "cargo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(100))
    ordem: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class Usuario(Base, Timestamped):
    """Usuário = funcionário. Quem não acessa o sistema (acesso_sistema=False) existe só para lançar horas."""

    __tablename__ = "usuario"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(150))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    login: Mapped[str | None] = mapped_column(String(60), unique=True)  # opcional: entrar com usuário em vez de e-mail
    foto_path: Mapped[str | None] = mapped_column(String(500))
    # Equipe MayaCorp: configurações da plataforma (ex.: chave da IA). Só se concede pelo terminal.
    equipe_mayacorp: Mapped[bool] = mapped_column(Boolean, default=False)
    # Preferências de interface que acompanham o usuário em qualquer computador (ex.: grupos do menu recolhidos)
    preferencias: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    senha_hash: Mapped[str | None] = mapped_column(String(255))
    perfil: Mapped[Perfil] = mapped_column(Enum(Perfil, native_enum=False, length=20), default=Perfil.operador)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    acesso_sistema: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # dados de funcionário
    cargo_id: Mapped[int | None] = mapped_column(ForeignKey("cargo.id"))
    perfil_acesso_id: Mapped[int | None] = mapped_column(ForeignKey("perfil_acesso.id"))
    cpf: Mapped[str | None] = mapped_column(String(11))
    oab: Mapped[str | None] = mapped_column(String(20))
    telefone: Mapped[str | None] = mapped_column(String(20))
    data_admissao: Mapped[date | None] = mapped_column(Date)
    cep: Mapped[str | None] = mapped_column(String(8))
    logradouro: Mapped[str | None] = mapped_column(String(150))
    numero_endereco: Mapped[str | None] = mapped_column(String(10))
    complemento: Mapped[str | None] = mapped_column(String(60))
    bairro: Mapped[str | None] = mapped_column(String(80))
    cidade: Mapped[str | None] = mapped_column(String(80))
    uf: Mapped[str | None] = mapped_column(String(2))
    convite_pendente: Mapped[bool] = mapped_column(Boolean, default=False)
    ultimo_acesso: Mapped[datetime | None] = mapped_column(UtcDateTime())
    ultima_atividade: Mapped[datetime | None] = mapped_column(UtcDateTime())
    tentativas_falhas: Mapped[int] = mapped_column(Integer, default=0)
    bloqueado_ate: Mapped[datetime | None] = mapped_column(UtcDateTime())

    tenant: Mapped[Tenant] = relationship()
    cargo: Mapped["Cargo | None"] = relationship()
    perfil_acesso: Mapped["PerfilAcesso | None"] = relationship()

    @property
    def administrador(self) -> bool:
        if self.equipe_mayacorp:
            return True
        return self.perfil_acesso.administrador if self.perfil_acesso else self.perfil == Perfil.admin

    @property
    def permissoes(self) -> set[str]:
        from app.core.permissoes import PERFIS_PADRAO, TODAS

        if self.administrador:
            return set(TODAS)
        if self.perfil_acesso:
            return set(self.perfil_acesso.permissoes or [])
        # sem perfil de acesso (legado): equivale ao perfil padrão de mesmo nome
        nome = {Perfil.operador: "Operador", Perfil.visualizador: "Visualizador"}.get(self.perfil, "Visualizador")
        return set(next(p["permissoes"] for p in PERFIS_PADRAO if p["nome"] == nome))

    def pode(self, permissao: str) -> bool:
        return self.administrador or permissao in self.permissoes


class Identidade(Base, Timestamped):
    __tablename__ = "identidade"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    nome_exibicao: Mapped[str] = mapped_column(String(200))
    logo_path: Mapped[str | None] = mapped_column(String(500))
    cor_destaque: Mapped[str | None] = mapped_column(String(9))
    assinatura_email: Mapped[str | None] = mapped_column(Text)

    tenant: Mapped[Tenant] = relationship(back_populates="identidade")


class Certificado(Base, Timestamped):
    __tablename__ = "certificado"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    titular: Mapped[str] = mapped_column(String(300))
    cnpj: Mapped[str | None] = mapped_column(String(14))
    emissor: Mapped[str] = mapped_column(String(300))
    valido_de: Mapped[date] = mapped_column(Date)
    valido_ate: Mapped[date] = mapped_column(Date)
    serial: Mapped[str] = mapped_column(String(80))
    pfx_cifrado: Mapped[bytes] = mapped_column(LargeBinary)
    senha_cifrada: Mapped[bytes] = mapped_column(LargeBinary)
    ativo: Mapped[bool] = mapped_column(Boolean, default=False)
    ultimo_teste_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    ultimo_teste_ok: Mapped[bool | None] = mapped_column(Boolean)
    ultimo_teste_msg: Mapped[str | None] = mapped_column(Text)
    alertas_enviados: Mapped[list[int]] = mapped_column(JSON, default=list)


class ConfigNotificacao(Base, Timestamped):
    __tablename__ = "config_notificacao"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    remetente_nome: Mapped[str] = mapped_column(String(150), default="CFME Advogados")
    remetente_email: Mapped[str] = mapped_column(String(200), default="nao-responda@mayacorp.com.br")
    smtp_host: Mapped[str | None] = mapped_column(String(200))
    smtp_porta: Mapped[int] = mapped_column(Integer, default=587)
    smtp_usuario: Mapped[str | None] = mapped_column(String(200))
    smtp_senha_cifrada: Mapped[bytes | None] = mapped_column(LargeBinary)
    assunto_modelo: Mapped[str] = mapped_column(
        String(300), default="NFS-e nº {numero_nota} — {nome_emissora}"
    )
    corpo_modelo: Mapped[str] = mapped_column(
        Text,
        default=(
            "Olá, {nome_tomador}.\n\nSegue a Nota Fiscal de Serviços nº {numero_nota}, no valor de {valor}.\n"
            "Você também pode consultá-la no site da Prefeitura: {link_prefeitura}\n\nAtenciosamente,"
        ),
    )
    anexar_pdf: Mapped[bool] = mapped_column(Boolean, default=True)
    anexar_xml: Mapped[bool] = mapped_column(Boolean, default=True)
    envio_automatico: Mapped[bool] = mapped_column(Boolean, default=False)
    avisos_destinatarios: Mapped[list[str]] = mapped_column(JSON, default=list)
    # cópias padrão do e-mail da nota ao cliente (ex.: sempre copiar o financeiro)
    email_cc_padrao: Mapped[list[str]] = mapped_column(JSON, default=list)
    email_cco_padrao: Mapped[list[str]] = mapped_column(JSON, default=list)
    email_logo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")  # logo do escritório no topo dos e-mails
    aviso_fim_lote: Mapped[bool] = mapped_column(Boolean, default=True)
    aviso_rejeicoes: Mapped[bool] = mapped_column(Boolean, default=True)
    aviso_certificado: Mapped[bool] = mapped_column(Boolean, default=True)


class Auditoria(Base):
    """Registro imutável: só aceita INSERT (ver listener em app.core.audit)."""

    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    usuario_nome: Mapped[str | None] = mapped_column(String(150))
    acao: Mapped[str] = mapped_column(String(60), index=True)
    entidade: Mapped[str] = mapped_column(String(60))
    entidade_id: Mapped[str | None] = mapped_column(String(60))
    descricao: Mapped[str | None] = mapped_column(String(500))
    antes_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    depois_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora, index=True)


class ConfigIA(Base, Timestamped):
    """Inteligência Artificial plugável (Configurações › Inteligência Artificial). Chave cifrada com a MASTER_KEY."""

    __tablename__ = "config_ia"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    ativo: Mapped[bool] = mapped_column(Boolean, default=False)
    provedor: Mapped[str] = mapped_column(String(10), default="openai")  # openai | gemini
    modelo: Mapped[str | None] = mapped_column(String(100))
    chave_cifrada: Mapped[bytes | None] = mapped_column(LargeBinary)
