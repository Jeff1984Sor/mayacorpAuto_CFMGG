"""Tipos de caso (contencioso, consultivo, administrativo): listas fixas do sistema e as tabelas que acompanham o caso.

O caso (`fat_caso`) guarda os campos comuns. O que é só de um tipo fica numa tabela 1:1 (`fat_caso_contencioso`,
`fat_caso_consultivo`, `fat_caso_administrativo`). Listas que o escritório edita ficam em `fat_lista_item`
(seed em `listas.py`); as fixas são os enums daqui, com o rótulo em `ROTULOS`.
"""

import enum
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped

Dinheiro = Numeric(15, 2)


class TipoDeCaso(enum.StrEnum):
    contencioso = "contencioso"
    consultivo = "consultivo"
    administrativo = "administrativo"


class TipoVinculo(enum.StrEnum):
    recurso = "recurso"
    incidente = "incidente"
    apenso = "apenso"
    desdobramento = "desdobramento"
    conexo = "conexo"
    judicializacao = "judicializacao"


ROTULOS: dict[str, dict[str, str]] = {
    "tipo_caso": {"contencioso": "Contencioso", "consultivo": "Consultivo", "administrativo": "Administrativo"},
    "status": {"aberto": "Ativo", "suspenso": "Suspenso", "arquivado": "Arquivado", "encerrado": "Encerrado"},
    "tipo_vinculo": {"recurso": "Recurso", "incidente": "Incidente", "apenso": "Apenso", "desdobramento": "Desdobramento",
                     "conexo": "Conexo", "judicializacao": "Judicialização"},
    "prognostico": {"provavel": "Provável", "possivel": "Possível", "remoto": "Remoto"},
    # ---- contencioso
    "justica": {"estadual": "Justiça Estadual", "federal": "Justiça Federal", "trabalho": "Justiça do Trabalho",
                "eleitoral": "Justiça Eleitoral", "militar_uniao": "Justiça Militar da União",
                "militar_estadual": "Justiça Militar Estadual", "stf": "STF", "stj": "STJ", "tst": "TST", "tse": "TSE",
                "stm": "STM", "cnj": "CNJ"},
    "instancia": {"primeira": "1ª instância", "juizado": "Juizado Especial", "segunda": "2ª instância (Tribunal)",
                  "turma_recursal": "Turma Recursal", "superior": "Tribunal Superior", "stf": "STF"},
    "polo": {"ativo": "Ativo", "passivo": "Passivo", "terceiro": "Terceiro"},
    "sistema_tribunal": {"pje": "PJe", "esaj": "e-SAJ", "eproc": "eproc", "projudi": "Projudi", "tucujuris": "Tucujuris",
                         "seeu": "SEEU", "fisico": "Físico", "outro": "Outro"},
    "rito": {"comum": "Comum", "sumario": "Sumário", "sumarissimo": "Sumaríssimo", "especial": "Especial", "juizado": "Juizado",
             "execucao": "Execução"},
    "fase_processual": {"pre_ajuizamento": "Pré-ajuizamento", "conhecimento": "Conhecimento", "instrucao": "Instrução",
                        "sentenciado": "Sentenciado", "recursal": "Recursal", "cumprimento_sentenca": "Cumprimento de sentença",
                        "execucao": "Execução", "acordo_cumprimento": "Acordo em cumprimento", "suspenso": "Suspenso",
                        "arquivado_provisorio": "Arquivado provisoriamente", "encerrado": "Encerrado"},
    "tutela_liminar": {"nao_requerida": "Não requerida", "requerida": "Requerida", "deferida": "Deferida",
                       "indeferida": "Indeferida", "revogada": "Revogada"},
    "resultado": {"procedente": "Procedente", "parcialmente_procedente": "Parcialmente procedente", "improcedente": "Improcedente",
                  "acordo": "Acordo", "extinto_sem_merito": "Extinto sem resolução do mérito", "desistencia": "Desistência"},
    # ---- consultivo
    "prioridade": {"baixa": "Baixa", "media": "Média", "alta": "Alta", "urgente": "Urgente"},
    "complexidade": {"baixa": "Baixa", "media": "Média", "alta": "Alta"},
    "etapa": {"recebido": "Recebido", "em_analise": "Em análise", "aguardando_cliente": "Aguardando o cliente",
              "aguardando_terceiro": "Aguardando terceiro", "em_elaboracao": "Em elaboração", "em_revisao": "Em revisão",
              "entregue": "Entregue", "em_negociacao": "Em negociação", "concluido": "Concluído", "cancelado": "Cancelado"},
    "risco_identificado": {"baixo": "Baixo", "medio": "Médio", "alto": "Alto", "critico": "Crítico"},
    # ---- administrativo
    "esfera": {"federal": "Federal", "estadual": "Estadual", "municipal": "Municipal", "distrital": "Distrital"},
    "instancia_adm": {"primeira": "1ª instância", "segunda": "2ª instância", "especial_superior": "Especial / superior",
                      "unica": "Única"},
    "fase_adm": {"pre_protocolo": "Pré-protocolo", "protocolado": "Protocolado", "em_analise": "Em análise",
                 "exigencia": "Exigência", "defesa_apresentada": "Defesa apresentada",
                 "aguardando_julgamento": "Aguardando julgamento", "decidido": "Decidido", "em_recurso": "Em recurso",
                 "definitivo": "Definitivo", "encerrado": "Encerrado"},
    "garantia": {"nenhuma": "Nenhuma", "deposito": "Depósito", "seguro_garantia": "Seguro garantia", "fianca": "Fiança",
                 "arrolamento": "Arrolamento"},
    "decisao": {"favoravel": "Favorável", "parcialmente_favoravel": "Parcialmente favorável", "desfavoravel": "Desfavorável",
                "anulado": "Anulado", "arquivado": "Arquivado"},
}

# Listas que o escritório edita (Configurações › Faturamento): código → (nome, tipo de caso em que aparece ou None = todos)
LISTAS: dict[str, tuple[str, str | None]] = {
    "motivo_encerramento": ("Motivos de encerramento", None),
    "origem": ("Origem da captação", None),
    "centro_custo": ("Centros de custo", None),
    "etiqueta": ("Etiquetas", None),
    "classe": ("Classes processuais", "contencioso"),
    "assunto": ("Assuntos", "contencioso"),
    "tipo_demanda": ("Tipos de demanda", "consultivo"),
    "orgao": ("Órgãos", "administrativo"),
    "tipo_procedimento": ("Tipos de procedimento", "administrativo"),
}


class ListaItem(Base, Timestamped):
    """Item de uma lista configurável do escritório. Os do sistema (seed) têm `codigo` e nunca são apagados."""

    __tablename__ = "fat_lista_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    lista: Mapped[str] = mapped_column(String(30), index=True)
    codigo: Mapped[str | None] = mapped_column(String(80))  # só nos itens do sistema (identifica o seed)
    nome: Mapped[str] = mapped_column(String(150))
    ordem: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    sistema: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (UniqueConstraint("tenant_id", "lista", "codigo", name="uq_fat_lista_item_codigo"),)


class CasoEquipe(Base):
    """Demais profissionais do caso (o responsável fica em `Caso.responsavel_id`)."""

    __tablename__ = "fat_caso_equipe"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), primary_key=True, index=True)


class CasoLista(Base):
    """Itens de lista que o caso pode ter vários: etiquetas e assuntos secundários."""

    __tablename__ = "fat_caso_lista"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("fat_lista_item.id"), primary_key=True, index=True)
    papel: Mapped[str] = mapped_column(String(20), primary_key=True)  # etiqueta | assunto_secundario


# ------------------------------------------------------------------------------------------- extensões 1:1 do caso
# Só o que NÃO existe no caso. No contencioso, número do processo (CNJ), tribunal, vara (órgão julgador), comarca,
# instância, valor da causa, data de distribuição e polo do cliente continuam nas colunas de `fat_caso`.
class CasoContencioso(Base, Timestamped):
    __tablename__ = "fat_caso_contencioso"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    pre_ajuizamento: Mapped[bool] = mapped_column(Boolean, default=False)  # ainda não distribuído (sem número CNJ)
    numero_antigo: Mapped[str | None] = mapped_column(String(40))
    justica: Mapped[str | None] = mapped_column(String(20))  # pelo dígito J do CNJ
    uf: Mapped[str | None] = mapped_column(String(2))
    codigo_orgao: Mapped[str | None] = mapped_column(String(4))  # OOOO do CNJ
    juiz_relator: Mapped[str | None] = mapped_column(String(150))
    sistema_tribunal: Mapped[str | None] = mapped_column(String(12))
    classe_id: Mapped[int | None] = mapped_column(ForeignKey("fat_lista_item.id"))
    assunto_id: Mapped[int | None] = mapped_column(ForeignKey("fat_lista_item.id"))  # os secundários ficam em fat_caso_lista
    rito: Mapped[str | None] = mapped_column(String(12))
    fase_processual: Mapped[str | None] = mapped_column(String(22), index=True)
    data_citacao: Mapped[date | None] = mapped_column(Date)
    data_transito_julgado: Mapped[date | None] = mapped_column(Date)
    valor_condenacao: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_acordo: Mapped[Decimal | None] = mapped_column(Dinheiro)
    prognostico: Mapped[str | None] = mapped_column(String(10))
    valor_provisionado: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_risco: Mapped[Decimal | None] = mapped_column(Dinheiro)
    deposito_judicial: Mapped[Decimal | None] = mapped_column(Dinheiro)
    justica_gratuita: Mapped[bool] = mapped_column(Boolean, default=False)
    segredo_justica: Mapped[bool] = mapped_column(Boolean, default=False)
    tutela_liminar: Mapped[str | None] = mapped_column(String(15))
    resultado: Mapped[str | None] = mapped_column(String(25))
    monitorar_andamentos: Mapped[bool] = mapped_column(Boolean, default=True)  # busca capa e andamentos no tribunal


class CasoConsultivo(Base, Timestamped):
    __tablename__ = "fat_caso_consultivo"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    tipo_demanda_id: Mapped[int | None] = mapped_column(ForeignKey("fat_lista_item.id"))
    solicitante_id: Mapped[int | None] = mapped_column(ForeignKey("trb_pessoa.id"))  # quem pediu (cadastro único)
    departamento_solicitante: Mapped[str | None] = mapped_column(String(100))
    data_solicitacao: Mapped[date | None] = mapped_column(Date)
    prazo_entrega: Mapped[date | None] = mapped_column(Date)
    sla_dias: Mapped[int | None] = mapped_column(Integer)
    prioridade: Mapped[str] = mapped_column(String(10), default="media")
    complexidade: Mapped[str | None] = mapped_column(String(10))
    etapa: Mapped[str] = mapped_column(String(20), default="recebido", index=True)
    horas_estimadas: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    valor_envolvido: Mapped[Decimal | None] = mapped_column(Dinheiro)
    contrato_vigencia_inicio: Mapped[date | None] = mapped_column(Date)
    contrato_vigencia_fim: Mapped[date | None] = mapped_column(Date)
    renovacao_automatica: Mapped[bool] = mapped_column(Boolean, default=False)
    data_entrega: Mapped[date | None] = mapped_column(Date)
    documento_entregue_id: Mapped[int | None] = mapped_column(ForeignKey("fat_anexo.id", ondelete="SET NULL"))  # anexo do caso
    risco_identificado: Mapped[str | None] = mapped_column(String(10))
    recomendacao_resumo: Mapped[str | None] = mapped_column(Text)
    gerou_contencioso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id", ondelete="SET NULL"))


class CasoAdministrativo(Base, Timestamped):
    __tablename__ = "fat_caso_administrativo"

    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), primary_key=True)
    esfera: Mapped[str | None] = mapped_column(String(10))
    orgao_id: Mapped[int | None] = mapped_column(ForeignKey("fat_lista_item.id"))
    unidade_orgao: Mapped[str | None] = mapped_column(String(150))
    uf: Mapped[str | None] = mapped_column(String(2))
    municipio: Mapped[str | None] = mapped_column(String(80))
    tipo_procedimento_id: Mapped[int | None] = mapped_column(ForeignKey("fat_lista_item.id"))
    numero_processo_adm: Mapped[str | None] = mapped_column(String(60), index=True)
    numero_protocolo: Mapped[str | None] = mapped_column(String(60))
    numero_auto_infracao: Mapped[str | None] = mapped_column(String(60))
    numero_nb: Mapped[str | None] = mapped_column(String(30))  # nº do benefício (INSS)
    instancia_adm: Mapped[str | None] = mapped_column(String(20))
    fase_adm: Mapped[str | None] = mapped_column(String(25), index=True)
    data_ciencia: Mapped[date | None] = mapped_column(Date)  # ciência / notificação: base da contagem do prazo
    prazo_defesa: Mapped[date | None] = mapped_column(Date)
    data_protocolo: Mapped[date | None] = mapped_column(Date)
    valor_autuado: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_multa: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_juros: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_atualizado: Mapped[Decimal | None] = mapped_column(Dinheiro)
    data_atualizacao_valor: Mapped[date | None] = mapped_column(Date)
    exigibilidade_suspensa: Mapped[bool] = mapped_column(Boolean, default=False)
    garantia: Mapped[str | None] = mapped_column(String(16))
    prognostico: Mapped[str | None] = mapped_column(String(10))
    decisao: Mapped[str | None] = mapped_column(String(25))
    data_decisao: Mapped[date | None] = mapped_column(Date)
    cabe_judicializacao: Mapped[bool] = mapped_column(Boolean, default=False)
    prazo_judicializacao: Mapped[date | None] = mapped_column(Date)
    caso_judicial_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id", ondelete="SET NULL"))
    link_sistema_orgao: Mapped[str | None] = mapped_column(String(300))


EXTENSAO = {TipoDeCaso.contencioso.value: CasoContencioso, TipoDeCaso.consultivo.value: CasoConsultivo,
            TipoDeCaso.administrativo.value: CasoAdministrativo}
