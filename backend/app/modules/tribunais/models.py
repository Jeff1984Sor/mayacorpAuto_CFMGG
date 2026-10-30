"""Integração com Tribunais: importação de processos pela OAB e protocolo de petições com o certificado do advogado.

Advogado (Usuario + OABs + certificado e-CPF + termo LGPD)
   └─ Varredura (DJEN pela OAB) → Encontrados → Importação (DataJud + MNI) → Processo ─┬─ Partes → Pessoas
                                                                                      ├─ Movimentações (→ Andamentos do caso)
                                                                                      ├─ Documentos dos autos
                                                                                      └─ Vínculo com cliente (→ Caso)
   └─ Protocolo (inicial / intermediária) → Documentos assinados → Aprovação humana (hash) → Fila → Retorno (recibo)
                                                                                                └─ E-mails + consumo de créditos

Tribunal, Sistema, Tabela local, Plataforma e Planos são da plataforma (MayaCorp mantém); o resto é do escritório (tenant).
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, LargeBinary, Numeric, String, Text, UniqueConstraint, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped, UtcDateTime, agora

Dinheiro = Numeric(15, 2)


# ------------------------------------------------------------------------------------------------ plataforma (global)
class Plataforma(Base, Timestamped):
    """Parâmetros técnicos da integração (uma linha só). Editado pela equipe MayaCorp em Configurações › Tribunais."""

    __tablename__ = "trb_plataforma"

    id: Mapped[int] = mapped_column(primary_key=True)
    datajud_url: Mapped[str] = mapped_column(String(200), default="https://api-publica.datajud.cnj.jus.br")
    # chave pública divulgada pelo CNJ (pode mudar: por isso fica aqui e não no código)
    datajud_chave: Mapped[str | None] = mapped_column(String(200))
    djen_url: Mapped[str] = mapped_column(String(200), default="https://comunicaapi.pje.jus.br/api/v1")
    # o DJEN só responde a IPs do Brasil: sem proxy, a varredura roda no navegador de quem está no escritório
    djen_proxy_url: Mapped[str | None] = mapped_column(String(300))
    intervalo_datajud_ms: Mapped[int] = mapped_column(Integer, default=1200)
    termo_versao: Mapped[str] = mapped_column(String(20), default="1.0")
    termo_texto: Mapped[str | None] = mapped_column(Text)


class Tribunal(Base, Timestamped):
    __tablename__ = "trb_tribunal"

    id: Mapped[int] = mapped_column(primary_key=True)
    sigla: Mapped[str] = mapped_column(String(12), unique=True)
    nome: Mapped[str] = mapped_column(String(150))
    segmento_j: Mapped[int] = mapped_column(Integer)
    codigo_tr: Mapped[str] = mapped_column(String(2))
    uf: Mapped[str | None] = mapped_column(String(2))
    ramo: Mapped[str] = mapped_column(String(12))  # estadual | federal | trabalho | eleitoral | militar | superior
    alias_datajud: Mapped[str | None] = mapped_column(String(20))

    sistemas: Mapped[list["Sistema"]] = relationship(back_populates="tribunal", order_by="Sistema.id")

    __table_args__ = (UniqueConstraint("segmento_j", "codigo_tr", "ramo", name="uq_trb_tribunal_jtr"),)


class Sistema(Base, Timestamped):
    """Instância de sistema (tribunal × grau × sistema). Um tribunal pode ter dois ao mesmo tempo durante uma migração."""

    __tablename__ = "trb_sistema"

    id: Mapped[int] = mapped_column(primary_key=True)
    tribunal_id: Mapped[int] = mapped_column(ForeignKey("trb_tribunal.id"), index=True)
    grau: Mapped[str] = mapped_column(String(16))  # 1g | 2g | turma_recursal | superior
    sistema: Mapped[str] = mapped_column(String(10))  # pje | eproc | esaj | projudi | proprio
    versao_sistema: Mapped[str | None] = mapped_column(String(30))
    url_portal: Mapped[str | None] = mapped_column(String(300))
    url_consulta_publica: Mapped[str | None] = mapped_column(String(300))
    url_mni: Mapped[str | None] = mapped_column(String(300))
    versao_mni: Mapped[str | None] = mapped_column(String(10), default="2.2.2")
    mni_consulta: Mapped[bool] = mapped_column(Boolean, default=False)
    mni_peticionamento: Mapped[bool] = mapped_column(Boolean, default=False)
    mni_inicial: Mapped[bool] = mapped_column(Boolean, default=False)
    exige_credenciamento: Mapped[bool] = mapped_column(Boolean, default=True)
    autenticacao: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["certificado"])
    tamanho_max_arquivo_mb: Mapped[int] = mapped_column(Integer, default=10)
    tamanho_max_total_mb: Mapped[int | None] = mapped_column(Integer)
    formatos_aceitos: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["application/pdf"])
    exige_pdf_pesquisavel: Mapped[bool] = mapped_column(Boolean, default=False)
    formato_assinatura: Mapped[str] = mapped_column(String(24), default="PAdES")  # PAdES | CAdES | assinatura_no_portal
    adaptador: Mapped[str] = mapped_column(String(40), default="MniAdapter")
    config_extra: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_fim: Mapped[date | None] = mapped_column(Date)
    status_saude: Mapped[str] = mapped_column(String(14), default="ok")  # ok | lento | fora | mudou_layout
    ultima_verificacao: Mapped[datetime | None] = mapped_column(UtcDateTime())
    # homologado pela MayaCorp para uso real (as "pendências por tribunal" foram conferidas)
    validado: Mapped[bool] = mapped_column(Boolean, default=False)
    # regra 10: intervalo mínimo entre requisições e janela de horário (HH:MM)
    intervalo_min_s: Mapped[int] = mapped_column(Integer, default=5)
    janela_inicio: Mapped[str | None] = mapped_column(String(5))
    janela_fim: Mapped[str | None] = mapped_column(String(5))
    ultima_requisicao_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    tribunal: Mapped[Tribunal] = relationship(back_populates="sistemas")


class TabelaLocal(Base, Timestamped):
    """Cache das TPU e das tabelas de cada sistema (classes, assuntos, tipos de documento...). Nunca hardcodar códigos."""

    __tablename__ = "trb_tabela_local"

    id: Mapped[int] = mapped_column(primary_key=True)
    tribunal_id: Mapped[int | None] = mapped_column(ForeignKey("trb_tribunal.id"), index=True)  # vazio = TPU nacional
    sistema_id: Mapped[int | None] = mapped_column(ForeignKey("trb_sistema.id"), index=True)
    # classe | assunto | tipo_documento | tipo_peticao | localidade | orgao_julgador | competencia
    tabela: Mapped[str] = mapped_column(String(20), index=True)
    codigo_local: Mapped[str] = mapped_column(String(40))
    codigo_cnj: Mapped[str | None] = mapped_column(String(20))
    nome: Mapped[str] = mapped_column(String(300))
    pai_codigo: Mapped[str | None] = mapped_column(String(40))
    extra: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # grau, permite_inicial, uf, codigo_ibge, competencias
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


# ----------------------------------------------------------------------------------------- escritório: configuração
class ConfigTribunais(Base, Timestamped):
    __tablename__ = "trb_config"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    # simulado: nada sai para o tribunal (recibo de simulação) · real: protocolo de verdade (só com AMBIENTE=prod)
    modo: Mapped[str] = mapped_column(String(10), default="simulado")
    sincronizar_auto: Mapped[bool] = mapped_column(Boolean, default=True)  # DataJud diário dos processos monitorados
    criar_andamentos: Mapped[bool] = mapped_column(Boolean, default=True)  # movimentações viram andamentos do caso
    vincular_automatico: Mapped[bool] = mapped_column(Boolean, default=True)  # CPF/CNPJ igual → vínculo automático
    limiar_fuzzy: Mapped[int] = mapped_column(Integer, default=88)  # % de semelhança do nome para sugerir
    plano_id: Mapped[int | None] = mapped_column(ForeignKey("trb_plano.id"))
    alerta_franquia: Mapped[list[str]] = mapped_column(JSON, default=list)  # limiares já avisados: ["2026-10:80"]


# ----------------------------------------------------------------------------------- advogado: OAB, termo, certificado
class InscricaoOab(Base, Timestamped):
    __tablename__ = "trb_oab"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    numero: Mapped[str] = mapped_column(String(10))  # só dígitos
    uf: Mapped[str] = mapped_column(String(2))
    tipo: Mapped[str] = mapped_column(String(12), default="principal")  # principal | suplementar | estagiario
    letra_complementar: Mapped[str | None] = mapped_column(String(2))
    situacao: Mapped[str | None] = mapped_column(String(10))  # regular | suspensa | cancelada

    __table_args__ = (UniqueConstraint("tenant_id", "numero", "uf", "letra_complementar", name="uq_trb_oab"),)


class TermoConsentimento(Base):
    __tablename__ = "trb_termo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    versao_termo: Mapped[str] = mapped_column(String(20))
    escopos_aceitos: Mapped[list[str]] = mapped_column(JSON, default=list)  # consulta | download | protocolo
    aceito_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    revogado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())


class CertificadoAdvogado(Base, Timestamped):
    """e-CPF do advogado. O .pfx e a senha ficam cifrados com a MASTER_KEY (o "cofre"); remover apaga os dois."""

    __tablename__ = "trb_certificado"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(2), default="A1")  # A1 | A3 (A3 exige o agente local)
    pfx_cifrado: Mapped[bytes | None] = mapped_column(LargeBinary)
    senha_cifrada: Mapped[bytes | None] = mapped_column(LargeBinary)
    titular_nome: Mapped[str] = mapped_column(String(300))
    titular_cpf: Mapped[str | None] = mapped_column(String(11))
    emissor_ac: Mapped[str] = mapped_column(String(300))
    numero_serie: Mapped[str] = mapped_column(String(80))
    thumbprint_sha256: Mapped[str] = mapped_column(String(64), index=True)
    valido_de: Mapped[datetime] = mapped_column(UtcDateTime())
    valido_ate: Mapped[datetime] = mapped_column(UtcDateTime())
    revogado: Mapped[bool] = mapped_column(Boolean, default=False)
    revogacao_verificada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    revogacao_msg: Mapped[str | None] = mapped_column(String(300))
    agente_local_id: Mapped[str | None] = mapped_column(String(60))
    escopo_autorizado: Mapped[list[str]] = mapped_column(JSON, default=list)
    termo_consentimento_id: Mapped[int] = mapped_column(ForeignKey("trb_termo.id"))
    alertas_enviados: Mapped[list[int]] = mapped_column(JSON, default=list)  # 30 / 15 / 7 dias
    removido_em: Mapped[datetime | None] = mapped_column(UtcDateTime())

    usuario = relationship("Usuario")
    termo: Mapped[TermoConsentimento] = relationship()


class UsoCertificado(Base):
    """Auditoria de cada uso do certificado. Imutável como a auditoria geral."""

    __tablename__ = "trb_uso_certificado"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    certificado_id: Mapped[int] = mapped_column(ForeignKey("trb_certificado.id"), index=True)
    acao: Mapped[str] = mapped_column(String(12))  # login | consulta | download | assinatura | protocolo
    tribunal_id: Mapped[int | None] = mapped_column(ForeignKey("trb_tribunal.id"))
    referencia: Mapped[str] = mapped_column(String(60))
    usuario_disparou_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))  # vazio = job automático
    aprovacao_humana_id: Mapped[int | None] = mapped_column(ForeignKey("trb_aprovacao.id"))
    data_hora: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora, index=True)
    ip_origem: Mapped[str | None] = mapped_column(String(64))
    resultado: Mapped[str] = mapped_column(String(12))  # ok | erro | simulado | negado
    detalhe: Mapped[str | None] = mapped_column(String(500))


@event.listens_for(UsoCertificado, "before_update")
def _uso_imutavel(*_):
    raise PermissionError("O registro de uso do certificado não pode ser alterado.")


@event.listens_for(UsoCertificado, "before_delete")
def _uso_nao_apaga(*_):
    raise PermissionError("O registro de uso do certificado não pode ser apagado.")


# ---------------------------------------------------------------------------------------------- descoberta (varredura)
class Varredura(Base, Timestamped):
    __tablename__ = "trb_varredura"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    advogado_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    disparada_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    inscricoes_oab: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{numero, uf}]
    fontes: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["djen"])  # djen | agregador | sistema_tribunal
    tribunais_alvo: Mapped[list[str]] = mapped_column(JSON, default=list)  # siglas; vazio = todos
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_fim: Mapped[date | None] = mapped_column(Date)
    coleta: Mapped[str] = mapped_column(String(10), default="navegador")  # servidor | navegador (DJEN só no Brasil)
    status: Mapped[str] = mapped_column(String(10), default="pendente")  # pendente | rodando | concluida | parcial | erro
    iniciada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    concluida_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    total_comunicacoes: Mapped[int] = mapped_column(Integer, default=0)
    total_encontrados: Mapped[int] = mapped_column(Integer, default=0)
    resumo_por_tribunal: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    erro: Mapped[str | None] = mapped_column(Text)

    encontrados: Mapped[list["Encontrado"]] = relationship(back_populates="varredura", cascade="all, delete-orphan")


class Encontrado(Base, Timestamped):
    """Processo encontrado na varredura, antes de importar (o usuário escolhe quais entram)."""

    __tablename__ = "trb_encontrado"

    id: Mapped[int] = mapped_column(primary_key=True)
    varredura_id: Mapped[int] = mapped_column(ForeignKey("trb_varredura.id", ondelete="CASCADE"), index=True)
    numero_cnj: Mapped[str] = mapped_column(String(20), index=True)
    tribunal_id: Mapped[int | None] = mapped_column(ForeignKey("trb_tribunal.id"))
    tribunal_sigla: Mapped[str | None] = mapped_column(String(12))
    sistema_provavel: Mapped[str | None] = mapped_column(String(10))
    fonte: Mapped[str] = mapped_column(String(16), default="djen")
    partes_resumo: Mapped[str | None] = mapped_column(String(500))
    classe_resumo: Mapped[str | None] = mapped_column(String(200))
    orgao_resumo: Mapped[str | None] = mapped_column(String(300))
    ultima_movimentacao_em: Mapped[date | None] = mapped_column(Date)
    comunicacoes: Mapped[int] = mapped_column(Integer, default=0)
    segredo_justica: Mapped[bool | None] = mapped_column(Boolean)
    possivel_cliente_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id", ondelete="SET NULL"))
    possivel_cliente_criterio: Mapped[str | None] = mapped_column(String(20))
    ja_importado: Mapped[bool] = mapped_column(Boolean, default=False)
    selecionado_para_importar: Mapped[bool] = mapped_column(Boolean, default=False)
    # nao_importar | fila | importado | erro | sem_acesso
    status_importacao: Mapped[str] = mapped_column(String(12), default="nao_importar")
    erro: Mapped[str | None] = mapped_column(String(500))
    processo_id: Mapped[int | None] = mapped_column(ForeignKey("trb_processo.id", ondelete="SET NULL"))
    dados: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # partes/advogados/comunicações colhidas

    varredura: Mapped[Varredura] = relationship(back_populates="encontrados")

    __table_args__ = (UniqueConstraint("varredura_id", "numero_cnj", name="uq_trb_encontrado"),)


# ------------------------------------------------------------------------------------------------------- processo
class Processo(Base, Timestamped):
    __tablename__ = "trb_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    numero_cnj: Mapped[str] = mapped_column(String(20))
    numero_formatado: Mapped[str] = mapped_column(String(25))
    numeros_antigos: Mapped[list[str]] = mapped_column(JSON, default=list)
    tribunal_id: Mapped[int] = mapped_column(ForeignKey("trb_tribunal.id"), index=True)
    sistema_instancia_id: Mapped[int | None] = mapped_column(ForeignKey("trb_sistema.id"))
    sistema_nome: Mapped[str | None] = mapped_column(String(10))  # pje | eproc | esaj... (o que o tribunal informou)
    grau: Mapped[str] = mapped_column(String(16), default="1g")
    graus: Mapped[list[str]] = mapped_column(JSON, default=list)  # todos os graus por onde o processo passou
    classe_codigo_cnj: Mapped[int | None] = mapped_column(Integer)
    classe_nome: Mapped[str | None] = mapped_column(String(200))
    assuntos: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # [{codigo_cnj, nome, principal}]
    competencia: Mapped[str | None] = mapped_column(String(150))
    localidade_codigo: Mapped[str | None] = mapped_column(String(20))
    localidade_nome: Mapped[str | None] = mapped_column(String(120))
    orgao_julgador: Mapped[str | None] = mapped_column(String(300))
    orgao_julgador_codigo: Mapped[str | None] = mapped_column(String(20))
    magistrado: Mapped[str | None] = mapped_column(String(150))
    valor_causa: Mapped[Decimal | None] = mapped_column(Dinheiro)
    data_ajuizamento: Mapped[datetime | None] = mapped_column(UtcDateTime())
    nivel_sigilo: Mapped[int] = mapped_column(Integer, default=0)
    segredo_justica: Mapped[bool] = mapped_column(Boolean, default=False)
    justica_gratuita: Mapped[bool | None] = mapped_column(Boolean)
    prioridades: Mapped[list[str]] = mapped_column(JSON, default=list)
    tutela_liminar_requerida: Mapped[bool | None] = mapped_column(Boolean)
    juizo_100_digital: Mapped[bool | None] = mapped_column(Boolean)
    situacao: Mapped[str] = mapped_column(String(10), default="ativo")  # ativo | suspenso | arquivado | baixado | extinto
    processo_principal_cnj: Mapped[str | None] = mapped_column(String(20))
    processos_vinculados: Mapped[list[str]] = mapped_column(JSON, default=list)
    migrado_de_sistema: Mapped[str | None] = mapped_column(String(10))
    migrado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    hash_dados: Mapped[str | None] = mapped_column(String(64))
    ultima_sincronizacao: Mapped[datetime | None] = mapped_column(UtcDateTime())
    sincronizacao_erro: Mapped[str | None] = mapped_column(String(500))
    origem_importacao: Mapped[str] = mapped_column(String(18), default="manual")  # varredura | manual | protocolo_inicial
    responsavel_interno_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    advogado_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))  # advogado da conta que trouxe o processo
    status_interno: Mapped[str | None] = mapped_column(String(60))
    monitorar: Mapped[bool] = mapped_column(Boolean, default=True)
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id", ondelete="SET NULL"), index=True)
    importado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    tribunal: Mapped[Tribunal] = relationship()
    sistema_instancia: Mapped["Sistema | None"] = relationship()
    partes: Mapped[list["Parte"]] = relationship(back_populates="processo", cascade="all, delete-orphan", order_by="Parte.ordem")
    movimentacoes: Mapped[list["Movimentacao"]] = relationship(
        back_populates="processo", cascade="all, delete-orphan", order_by="Movimentacao.data_hora.desc()")
    documentos: Mapped[list["DocumentoAutos"]] = relationship(back_populates="processo", cascade="all, delete-orphan")
    vinculos: Mapped[list["Vinculo"]] = relationship(back_populates="processo", cascade="all, delete-orphan")
    caso = relationship("Caso")

    __table_args__ = (UniqueConstraint("tenant_id", "numero_cnj", name="uq_trb_processo_cnj"),)


class Pessoa(Base, Timestamped):
    """Pessoa física/jurídica: parte de processo importado ou da petição inicial (CPC 319, II)."""

    __tablename__ = "trb_pessoa"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    tipo_pessoa: Mapped[str] = mapped_column(String(20), default="fisica")  # fisica | juridica | autoridade | orgao_representacao
    nome: Mapped[str] = mapped_column(String(300))
    nome_normalizado: Mapped[str] = mapped_column(String(300), index=True)
    nome_social: Mapped[str | None] = mapped_column(String(200))
    nome_fantasia: Mapped[str | None] = mapped_column(String(200))
    cpf: Mapped[str | None] = mapped_column(String(11), index=True)
    cnpj: Mapped[str | None] = mapped_column(String(14), index=True)
    documento_parcial: Mapped[str | None] = mapped_column(String(20))  # o que o tribunal mostrou mascarado
    documento_mascarado: Mapped[bool] = mapped_column(Boolean, default=False)
    outros_documentos: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    sexo: Mapped[str | None] = mapped_column(String(1))
    data_nascimento: Mapped[date | None] = mapped_column(Date)
    nacionalidade: Mapped[str | None] = mapped_column(String(60))
    naturalidade: Mapped[str | None] = mapped_column(String(80))
    estado_civil: Mapped[str | None] = mapped_column(String(14))
    uniao_estavel: Mapped[bool | None] = mapped_column(Boolean)
    profissao: Mapped[str | None] = mapped_column(String(100))
    nome_mae: Mapped[str | None] = mapped_column(String(200))
    nome_pai: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(200))
    telefones: Mapped[list[str]] = mapped_column(JSON, default=list)
    enderecos: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # seção 6.3
    representante_legal_id: Mapped[int | None] = mapped_column(ForeignKey("trb_pessoa.id"))
    ente_publico: Mapped[bool] = mapped_column(Boolean, default=False)


class Parte(Base):
    __tablename__ = "trb_parte"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("trb_processo.id", ondelete="CASCADE"), index=True)
    polo: Mapped[str] = mapped_column(String(12))  # ativo | passivo | terceiro | fiscal_lei | vitima | testemunha | outro
    tipo_participacao: Mapped[str | None] = mapped_column(String(60))
    pessoa_id: Mapped[int] = mapped_column(ForeignKey("trb_pessoa.id"), index=True)
    assistencia_judiciaria: Mapped[bool | None] = mapped_column(Boolean)
    intimacao_pendente: Mapped[bool | None] = mapped_column(Boolean)
    relacionamento: Mapped[str | None] = mapped_column(String(100))
    ordem: Mapped[int] = mapped_column(Integer, default=0)

    processo: Mapped[Processo] = relationship(back_populates="partes")
    pessoa: Mapped[Pessoa] = relationship()
    advogados: Mapped[list["AdvogadoParte"]] = relationship(back_populates="parte", cascade="all, delete-orphan")


class AdvogadoParte(Base):
    __tablename__ = "trb_advogado_parte"

    id: Mapped[int] = mapped_column(primary_key=True)
    parte_id: Mapped[int] = mapped_column(ForeignKey("trb_parte.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(200))
    cpf: Mapped[str | None] = mapped_column(String(11))
    oab_numero: Mapped[str | None] = mapped_column(String(10))
    oab_uf: Mapped[str | None] = mapped_column(String(2))
    tipo_representante: Mapped[str] = mapped_column(String(12), default="advogado")  # advogado | procurador | defensor | escritorio
    recebe_intimacao: Mapped[bool | None] = mapped_column(Boolean)
    e_o_usuario: Mapped[bool] = mapped_column(Boolean, default=False)
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    parte: Mapped[Parte] = relationship(back_populates="advogados")


class Movimentacao(Base, Timestamped):
    __tablename__ = "trb_movimentacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("trb_processo.id", ondelete="CASCADE"), index=True)
    data_hora: Mapped[datetime] = mapped_column(UtcDateTime(), index=True)
    codigo_nacional: Mapped[int | None] = mapped_column(Integer)
    codigo_local: Mapped[str | None] = mapped_column(String(20))
    descricao: Mapped[str] = mapped_column(Text)
    complementos: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    nivel_sigilo: Mapped[int] = mapped_column(Integer, default=0)
    documento_vinculado_id: Mapped[int | None] = mapped_column(
        ForeignKey("trb_documento.id", ondelete="SET NULL", use_alter=True, name="fk_trb_mov_documento"))  # ciclo com trb_documento
    responsavel: Mapped[str | None] = mapped_column(String(150))
    orgao: Mapped[str | None] = mapped_column(String(300))
    grau: Mapped[str | None] = mapped_column(String(16))
    e_intimacao: Mapped[bool] = mapped_column(Boolean, default=False)
    prazo_final: Mapped[date | None] = mapped_column(Date)
    fonte: Mapped[str] = mapped_column(String(10), default="datajud")  # datajud | djen | mni | manual
    hash: Mapped[str] = mapped_column(String(64))
    lida_pelo_usuario: Mapped[bool] = mapped_column(Boolean, default=False)
    andamento_id: Mapped[int | None] = mapped_column(ForeignKey("fat_andamento.id", ondelete="SET NULL"))
    tarefa_id: Mapped[int | None] = mapped_column(ForeignKey("fat_tarefa.id", ondelete="SET NULL"))

    processo: Mapped[Processo] = relationship(back_populates="movimentacoes")

    __table_args__ = (UniqueConstraint("processo_id", "hash", name="uq_trb_mov_hash"),)


class DocumentoAutos(Base, Timestamped):
    __tablename__ = "trb_documento"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("trb_processo.id", ondelete="CASCADE"), index=True)
    id_documento_tribunal: Mapped[str] = mapped_column(String(60))
    id_documento_pai: Mapped[str | None] = mapped_column(String(60))
    tipo_documento_codigo: Mapped[str | None] = mapped_column(String(20))
    tipo_documento_nome: Mapped[str] = mapped_column(String(150))
    descricao: Mapped[str | None] = mapped_column(String(300))
    data_hora_juntada: Mapped[datetime | None] = mapped_column(UtcDateTime())
    movimentacao_id: Mapped[int | None] = mapped_column(ForeignKey("trb_movimentacao.id", ondelete="SET NULL"))
    mimetype: Mapped[str] = mapped_column(String(100), default="application/pdf")
    tamanho_bytes: Mapped[int] = mapped_column(Integer, default=0)
    paginas: Mapped[int | None] = mapped_column(Integer)
    hash_sha256: Mapped[str | None] = mapped_column(String(64))
    nivel_sigilo: Mapped[int] = mapped_column(Integer, default=0)
    assinantes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    storage_ref: Mapped[str | None] = mapped_column(String(500))
    texto_extraido_ref: Mapped[str | None] = mapped_column(String(500))
    status_download: Mapped[str] = mapped_column(String(10), default="pendente")  # pendente | baixado | erro | sem_acesso

    processo: Mapped[Processo] = relationship(back_populates="documentos")

    __table_args__ = (UniqueConstraint("processo_id", "id_documento_tribunal", name="uq_trb_doc_tribunal"),)


class Vinculo(Base, Timestamped):
    """Qual parte do processo é cliente do escritório (seção 9)."""

    __tablename__ = "trb_vinculo"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("trb_processo.id", ondelete="CASCADE"), index=True)
    parte_id: Mapped[int | None] = mapped_column(ForeignKey("trb_parte.id", ondelete="CASCADE"))
    cliente_id: Mapped[int] = mapped_column(ForeignKey("tomador.id", ondelete="CASCADE"), index=True)
    # cpf_cnpj | cnpj_raiz | nome_doc_parcial | nome_exato | nome_fuzzy | manual
    criterio: Mapped[str] = mapped_column(String(18))
    confianca: Mapped[Decimal] = mapped_column(Numeric(4, 3))
    status: Mapped[str] = mapped_column(String(12))  # automatico | sugerido | confirmado | rejeitado
    confirmado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    confirmado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    polo_cliente: Mapped[str | None] = mapped_column(String(12))

    processo: Mapped[Processo] = relationship(back_populates="vinculos")
    parte: Mapped["Parte | None"] = relationship()
    cliente = relationship("Tomador")

    __table_args__ = (UniqueConstraint("processo_id", "parte_id", "cliente_id", name="uq_trb_vinculo"),)


# ------------------------------------------------------------------------------------------------------- protocolo
class Protocolo(Base, Timestamped):
    """Petição a protocolar: inicial (cria processo) ou intermediária (processo existente)."""

    __tablename__ = "trb_protocolo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(14))  # inicial | intermediaria | habilitacao | recurso
    # rascunho → aprovado → na_fila → enviando → protocolado | erro | verificar (incerto: consultar antes de reenviar)
    status: Mapped[str] = mapped_column(String(12), default="rascunho", index=True)
    processo_id: Mapped[int | None] = mapped_column(ForeignKey("trb_processo.id", ondelete="SET NULL"), index=True)
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id", ondelete="SET NULL"), index=True)
    numero_cnj: Mapped[str | None] = mapped_column(String(20))
    advogado_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    certificado_id: Mapped[int | None] = mapped_column(ForeignKey("trb_certificado.id"))
    tribunal_id: Mapped[int] = mapped_column(ForeignKey("trb_tribunal.id"))
    sistema_instancia_id: Mapped[int | None] = mapped_column(ForeignKey("trb_sistema.id"))
    grau: Mapped[str] = mapped_column(String(16), default="1g")
    titulo: Mapped[str | None] = mapped_column(String(200))
    # 10.1 (inicial): localidade, competência, órgão, classe, assuntos, valor da causa, gratuidade, prioridades, tutela...
    cabecalho: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    partes: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # 10.2: partes da inicial (6.1–6.4)
    conteudo_peca: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # 10.4: fatos, fundamentos, pedidos...
    # 11 (intermediária)
    tipo_peticao_codigo: Mapped[str | None] = mapped_column(String(40))
    tipo_peticao_nome: Mapped[str | None] = mapped_column(String(150))
    em_resposta_a_intimacao_id: Mapped[int | None] = mapped_column(ForeignKey("trb_movimentacao.id", ondelete="SET NULL"))
    polo_peticionante: Mapped[str | None] = mapped_column(String(12))
    parte_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    pedido_urgente: Mapped[bool] = mapped_column(Boolean, default=False)
    nivel_sigilo: Mapped[int] = mapped_column(Integer, default=0)
    prazo_final: Mapped[date | None] = mapped_column(Date)
    fora_do_prazo_justificativa: Mapped[str | None] = mapped_column(String(500))
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    enviado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    tentativas: Mapped[int] = mapped_column(Integer, default=0)
    simulado: Mapped[bool] = mapped_column(Boolean, default=False)
    ultimo_erro: Mapped[str | None] = mapped_column(Text)

    tribunal: Mapped[Tribunal] = relationship()
    sistema_instancia: Mapped["Sistema | None"] = relationship()
    processo: Mapped["Processo | None"] = relationship()
    documentos: Mapped[list["ProtocoloDocumento"]] = relationship(
        back_populates="protocolo", cascade="all, delete-orphan", order_by="ProtocoloDocumento.ordem")
    custas: Mapped[list["Custa"]] = relationship(back_populates="protocolo", cascade="all, delete-orphan")
    aprovacoes: Mapped[list["Aprovacao"]] = relationship(back_populates="protocolo", order_by="Aprovacao.id")
    retornos: Mapped[list["RetornoProtocolo"]] = relationship(back_populates="protocolo", order_by="RetornoProtocolo.id")


class ProtocoloDocumento(Base, Timestamped):
    __tablename__ = "trb_protocolo_documento"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("trb_protocolo.id", ondelete="CASCADE"), index=True)
    ordem: Mapped[int] = mapped_column(Integer, default=1)  # 1 = petição principal
    tipo_documento_codigo: Mapped[str | None] = mapped_column(String(40))
    tipo_documento_nome: Mapped[str] = mapped_column(String(150))
    descricao: Mapped[str] = mapped_column(String(300))
    nome_arquivo: Mapped[str] = mapped_column(String(255))
    arquivo_ref: Mapped[str] = mapped_column(String(500))
    mimetype: Mapped[str] = mapped_column(String(100))
    tamanho_bytes: Mapped[int] = mapped_column(Integer)
    hash_sha256: Mapped[str] = mapped_column(String(64))
    paginas: Mapped[int | None] = mapped_column(Integer)
    pesquisavel: Mapped[bool | None] = mapped_column(Boolean)
    nivel_sigilo: Mapped[int] = mapped_column(Integer, default=0)
    assinado: Mapped[bool] = mapped_column(Boolean, default=False)
    formato_assinatura: Mapped[str | None] = mapped_column(String(24))
    arquivo_assinado_ref: Mapped[str | None] = mapped_column(String(500))
    hash_assinado: Mapped[str | None] = mapped_column(String(64))

    protocolo: Mapped[Protocolo] = relationship(back_populates="documentos")


class Custa(Base, Timestamped):
    __tablename__ = "trb_custa"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("trb_protocolo.id", ondelete="CASCADE"), index=True)
    tribunal_id: Mapped[int] = mapped_column(ForeignKey("trb_tribunal.id"))
    # inicial | preparo_recursal | porte_remessa | diligencia_oficial | mandato | outra
    tipo_custa: Mapped[str] = mapped_column(String(20))
    tipo_guia: Mapped[str] = mapped_column(String(40))  # DARE (TJSP), GRU (federal), guia própria...
    codigo_receita: Mapped[str | None] = mapped_column(String(20))
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    base_calculo: Mapped[Decimal | None] = mapped_column(Dinheiro)
    numero_guia: Mapped[str] = mapped_column(String(60))
    linha_digitavel: Mapped[str | None] = mapped_column(String(80))
    codigo_barras: Mapped[str | None] = mapped_column(String(80))
    vencimento: Mapped[date] = mapped_column(Date)
    pagador_nome: Mapped[str] = mapped_column(String(200))
    pagador_documento: Mapped[str] = mapped_column(String(14))
    status: Mapped[str] = mapped_column(String(10), default="gerada")  # gerada | paga | vinculada | vencida | isenta
    comprovante_ref: Mapped[str | None] = mapped_column(String(500))
    guia_ref: Mapped[str | None] = mapped_column(String(500))
    pago_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    despesa_id: Mapped[int | None] = mapped_column(ForeignKey("fat_despesa.id", ondelete="SET NULL"))  # reembolso do cliente

    protocolo: Mapped[Protocolo] = relationship(back_populates="custas")


class Aprovacao(Base):
    """Aprovação humana do protocolo: o titular do certificado aprova exatamente este conteúdo (hash)."""

    __tablename__ = "trb_aprovacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("trb_protocolo.id", ondelete="CASCADE"), index=True)
    advogado_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"))
    hash_conteudo_aprovado: Mapped[str] = mapped_column(String(64))
    aprovado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    invalidada_em: Mapped[datetime | None] = mapped_column(UtcDateTime())  # o conteúdo mudou depois da aprovação

    protocolo: Mapped[Protocolo] = relationship(back_populates="aprovacoes")


class RetornoProtocolo(Base):
    __tablename__ = "trb_retorno"

    id: Mapped[int] = mapped_column(primary_key=True)
    protocolo_id: Mapped[int] = mapped_column(ForeignKey("trb_protocolo.id", ondelete="CASCADE"), index=True)
    sucesso: Mapped[bool] = mapped_column(Boolean)
    numero_protocolo: Mapped[str | None] = mapped_column(String(80))
    data_hora_protocolo: Mapped[datetime | None] = mapped_column(UtcDateTime())
    numero_cnj_gerado: Mapped[str | None] = mapped_column(String(20))
    orgao_julgador_distribuido: Mapped[str | None] = mapped_column(String(300))
    tipo_distribuicao: Mapped[str | None] = mapped_column(String(12))  # sorteio | dependencia | prevencao
    recibo_ref: Mapped[str | None] = mapped_column(String(500))
    resposta_bruta_ref: Mapped[str | None] = mapped_column(String(500))
    hash_documentos_enviados: Mapped[list[str]] = mapped_column(JSON, default=list)
    mensagem_erro: Mapped[str | None] = mapped_column(Text)
    codigo_erro: Mapped[str | None] = mapped_column(String(40))
    tentativa: Mapped[int] = mapped_column(Integer, default=1)
    simulado: Mapped[bool] = mapped_column(Boolean, default=False)
    manual: Mapped[bool] = mapped_column(Boolean, default=False)  # protocolado no portal e registrado à mão
    recuperado: Mapped[bool] = mapped_column(Boolean, default=False)  # achado na consulta depois de falha de rede
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    protocolo: Mapped[Protocolo] = relationship(back_populates="retornos")


# ------------------------------------------------------------------------------------------------- fila e alertas
class Job(Base, Timestamped):
    __tablename__ = "trb_job"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    # varredura | importar_processo | sincronizar | baixar_documentos | protocolar | verificar_protocolo | notificar
    # | sincronizar_tabelas | health_check
    tipo: Mapped[str] = mapped_column(String(20), index=True)
    tribunal_id: Mapped[int | None] = mapped_column(ForeignKey("trb_tribunal.id"))
    referencia_id: Mapped[int] = mapped_column(Integer)
    prioridade: Mapped[int] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(12), default="fila", index=True)  # fila | rodando | ok | erro | reprocessar | cancelado
    tentativas: Mapped[int] = mapped_column(Integer, default=0)
    max_tentativas: Mapped[int] = mapped_column(Integer, default=5)
    proxima_tentativa_em: Mapped[datetime | None] = mapped_column(UtcDateTime(), index=True)
    erro: Mapped[str | None] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    iniciado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    concluido_em: Mapped[datetime | None] = mapped_column(UtcDateTime())
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))


class Alerta(Base, Timestamped):
    __tablename__ = "trb_alerta"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(30))  # intimacao | protocolo_falha | sem_responsavel | bounce | certificado | franquia...
    severidade: Mapped[str] = mapped_column(String(8), default="info")  # info | aviso | erro
    mensagem: Mapped[str] = mapped_column(String(500))
    processo_id: Mapped[int | None] = mapped_column(ForeignKey("trb_processo.id", ondelete="CASCADE"))
    protocolo_id: Mapped[int | None] = mapped_column(ForeignKey("trb_protocolo.id", ondelete="CASCADE"))
    usuario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))  # vazio = administradores
    lido: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


# ------------------------------------------------------------------------------------------ notificação do protocolo
class NotificacaoProtocolo(Base, Timestamped):
    """Configuração por evento (17.1) com o modelo do e-mail (17.3) na mesma linha."""

    __tablename__ = "trb_notif_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    # protocolo_sucesso | protocolo_falha | protocolo_inicial_distribuido | protocolo_intermediaria
    evento: Mapped[str] = mapped_column(String(30))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    notificar_responsavel_caso: Mapped[bool] = mapped_column(Boolean, default=True)
    notificar_quem_protocolou: Mapped[bool] = mapped_column(Boolean, default=True)
    notificar_titular_certificado: Mapped[bool] = mapped_column(Boolean, default=False)
    destinatarios_fixos: Mapped[list[str]] = mapped_column(JSON, default=list)
    copia_oculta: Mapped[list[str]] = mapped_column(JSON, default=list)
    anexar_recibo: Mapped[bool] = mapped_column(Boolean, default=True)
    anexar_peca_principal: Mapped[bool] = mapped_column(Boolean, default=False)
    respeitar_sigilo: Mapped[bool] = mapped_column(Boolean, default=True)
    assunto: Mapped[str] = mapped_column(String(300))
    corpo_texto: Mapped[str] = mapped_column(Text)
    corpo_html: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("tenant_id", "evento", name="uq_trb_notif_evento"),)


class PreferenciaNotificacao(Base, Timestamped):
    __tablename__ = "trb_notif_preferencia"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    evento: Mapped[str] = mapped_column(String(30))
    receber: Mapped[bool] = mapped_column(Boolean, default=True)  # falha não pode ser desligada
    email_alternativo: Mapped[str | None] = mapped_column(String(200))

    __table_args__ = (UniqueConstraint("usuario_id", "evento", name="uq_trb_pref"),)


class EmailLog(Base, Timestamped):
    __tablename__ = "trb_email_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    retorno_protocolo_id: Mapped[int] = mapped_column(ForeignKey("trb_retorno.id", ondelete="CASCADE"), index=True)
    evento: Mapped[str] = mapped_column(String(30))
    destinatario: Mapped[str] = mapped_column(String(200))
    papel_destinatario: Mapped[str] = mapped_column(String(20))  # responsavel_caso | quem_protocolou | titular_certificado | fixo
    assunto_renderizado: Mapped[str] = mapped_column(String(400))
    anexos: Mapped[list[str]] = mapped_column(JSON, default=list)
    provedor: Mapped[str] = mapped_column(String(20), default="SMTP")
    id_mensagem_provedor: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(10), default="fila")  # fila | enviado | entregue | aberto | bounce | erro
    tentativas: Mapped[int] = mapped_column(Integer, default=0)
    erro: Mapped[str | None] = mapped_column(String(500))
    enviado_em: Mapped[datetime | None] = mapped_column(UtcDateTime())

    __table_args__ = (UniqueConstraint("retorno_protocolo_id", "destinatario", "evento", name="uq_trb_email_idem"),)


# ------------------------------------------------------------------------------------------- cobrança (plataforma)
class Plano(Base, Timestamped):
    __tablename__ = "trb_plano"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(80))
    preco_mensal: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal("0"))
    creditos_protocolo_mes: Mapped[int] = mapped_column(Integer, default=0)
    creditos_acumulam: Mapped[bool] = mapped_column(Boolean, default=False)
    permite_excedente: Mapped[bool] = mapped_column(Boolean, default=True)
    limite_excedente_mes: Mapped[int | None] = mapped_column(Integer)
    limite_processos_monitorados: Mapped[int | None] = mapped_column(Integer)
    limite_certificados: Mapped[int | None] = mapped_column(Integer)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    faixas: Mapped[list["FaixaExcedente"]] = relationship(back_populates="plano", cascade="all, delete-orphan",
                                                          order_by="FaixaExcedente.de_creditos")


class PesoProtocolo(Base):
    __tablename__ = "trb_peso"

    tipo_protocolo: Mapped[str] = mapped_column(String(14), primary_key=True)  # intermediaria | inicial | habilitacao | recurso
    creditos: Mapped[int] = mapped_column(Integer)


class FaixaExcedente(Base):
    __tablename__ = "trb_faixa_excedente"

    id: Mapped[int] = mapped_column(primary_key=True)
    plano_id: Mapped[int] = mapped_column(ForeignKey("trb_plano.id", ondelete="CASCADE"), index=True)
    de_creditos: Mapped[int] = mapped_column(Integer)
    ate_creditos: Mapped[int | None] = mapped_column(Integer)  # vazio = sem teto
    preco_por_credito: Mapped[Decimal] = mapped_column(Dinheiro)

    plano: Mapped[Plano] = relationship(back_populates="faixas")


class FaixaSetup(Base):
    __tablename__ = "trb_faixa_setup"

    id: Mapped[int] = mapped_column(primary_key=True)
    de_processos: Mapped[int] = mapped_column(Integer)
    ate_processos: Mapped[int | None] = mapped_column(Integer)
    preco: Mapped[Decimal] = mapped_column(Dinheiro)
    inclui_download_autos: Mapped[bool] = mapped_column(Boolean, default=False)
    reimportacao_gratis_dias: Mapped[int | None] = mapped_column(Integer, default=30)


class Consumo(Base):
    """Ledger de consumo: só cresce. Estorno é um lançamento negativo com motivo."""

    __tablename__ = "trb_consumo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    ciclo: Mapped[str] = mapped_column(String(7), index=True)  # AAAA-MM
    origem: Mapped[str] = mapped_column(String(10))  # protocolo | importacao | ajuste | estorno
    referencia_id: Mapped[int] = mapped_column(Integer)  # retorno_protocolo / varredura / consumo estornado
    creditos: Mapped[int] = mapped_column(Integer)
    quantidade: Mapped[int | None] = mapped_column(Integer)  # importação: nº de processos
    dentro_franquia: Mapped[bool] = mapped_column(Boolean)
    valor: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal("0"))
    motivo: Mapped[str | None] = mapped_column(String(300))
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    __table_args__ = (UniqueConstraint("tenant_id", "origem", "referencia_id", name="uq_trb_consumo_ref"),)
