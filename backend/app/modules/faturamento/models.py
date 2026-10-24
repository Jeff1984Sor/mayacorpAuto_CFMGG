"""Faturamento do escritório (inspirado no RCA): contratos, casos, regras de cobrança, timesheet e despesas.

Cliente (tomador) ─┬─ Contrato ─┬─ Regras de cobrança (fixo · recorrente · por hora)
                   │            └─ Casos ─┬─ Regra própria (vence a do contrato)
                   │                      ├─ Timesheet (horas)
                   │                      └─ Despesas (reembolso → Nota de Despesas, nunca NFS-e)

Nada é cobrado duas vezes: cada parcela (regra + competência), cada lançamento de horas e cada despesa
fica ligado ao item da fatura que o cobrou. Cancelar a fatura solta os itens de novo.
"""

import enum
from datetime import date
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship

from app.core.db import Base, Timestamped

Dinheiro = Numeric(15, 2)


def _enum(e: type[enum.Enum]):
    return Enum(e, native_enum=False, length=20)


class TipoRegra(enum.StrEnum):
    fixo = "fixo"  # valor único numa data
    recorrente = "recorrente"  # valor por competência (mensal, trimestral...)
    hora = "hora"  # horas lançadas × valor/hora da categoria do profissional


class Frequencia(enum.StrEnum):
    """Padrão de recorrência (como no Outlook): diária, semanal, mensal ou anual, "a cada N"."""

    diaria = "diaria"
    semanal = "semanal"
    mensal = "mensal"
    anual = "anual"


class Termino(enum.StrEnum):
    sem = "sem"  # sem data de término
    ocorrencias = "ocorrencias"  # termina após N parcelas
    data = "data"  # termina em uma data


class TabelaPreco(Base, Timestamped):
    __tablename__ = "fat_tabela"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(150))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    itens: Mapped[list["TabelaPrecoItem"]] = relationship(back_populates="tabela", cascade="all, delete-orphan")


class TabelaPrecoItem(Base):
    __tablename__ = "fat_tabela_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    tabela_id: Mapped[int] = mapped_column(ForeignKey("fat_tabela.id", ondelete="CASCADE"), index=True)
    cargo_id: Mapped[int] = mapped_column(ForeignKey("cargo.id"))
    valor_hora: Mapped[Decimal] = mapped_column(Dinheiro)

    tabela: Mapped[TabelaPreco] = relationship(back_populates="itens")

    __table_args__ = (UniqueConstraint("tabela_id", "cargo_id", name="uq_fat_tabela_item"),)


class Contrato(Base, Timestamped):
    __tablename__ = "fat_contrato"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)
    tomador_id: Mapped[int] = mapped_column(ForeignKey("tomador.id"), index=True)
    emissora_id: Mapped[int | None] = mapped_column(ForeignKey("emissora.id"))  # quem fatura
    tabela_preco_id: Mapped[int | None] = mapped_column(ForeignKey("fat_tabela.id"))  # valor/hora do contrato
    nome: Mapped[str] = mapped_column(String(200))
    objeto: Mapped[str | None] = mapped_column(Text)
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_fim: Mapped[date | None] = mapped_column(Date)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    observacao: Mapped[str | None] = mapped_column(Text)

    tomador = relationship("Tomador")
    regras: Mapped[list["RegraCobranca"]] = relationship(
        back_populates="contrato", primaryjoin="and_(Contrato.id == RegraCobranca.contrato_id, RegraCobranca.caso_id.is_(None))",
        viewonly=True,
    )
    casos: Mapped[list["Caso"]] = relationship(back_populates="contrato", order_by="Caso.numero")

    __table_args__ = (UniqueConstraint("tenant_id", "numero", name="uq_fat_contrato_numero"),)


class AreaAtuacao(Base, Timestamped):
    """Áreas de atuação do escritório (Cível, Trabalhista, Tributário...). Configurações › Faturamento."""

    __tablename__ = "fat_area"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(100))
    cor: Mapped[str | None] = mapped_column(String(7))
    ordem: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class TipoCampo(enum.StrEnum):
    texto = "texto"
    texto_longo = "texto_longo"
    numero = "numero"
    moeda = "moeda"
    data = "data"
    sim_nao = "sim_nao"
    lista = "lista"  # escolha entre as opções


class CampoAdicional(Base, Timestamped):
    """Campo criado pelo escritório; aparece na aba Detalhes do caso."""

    __tablename__ = "fat_campo"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    entidade: Mapped[str] = mapped_column(String(20), default="caso")
    nome: Mapped[str] = mapped_column(String(100))
    tipo: Mapped[TipoCampo] = mapped_column(_enum(TipoCampo), default=TipoCampo.texto)
    opcoes: Mapped[list[str]] = mapped_column(JSON, default=list)
    obrigatorio: Mapped[bool] = mapped_column(Boolean, default=False)
    ajuda: Mapped[str | None] = mapped_column(String(200))
    area_id: Mapped[int | None] = mapped_column(ForeignKey("fat_area.id", ondelete="SET NULL"))  # só para casos desta área
    ordem: Mapped[int] = mapped_column(Integer, default=0)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class TipoCaso(enum.StrEnum):
    consultivo = "consultivo"
    administrativo = "administrativo"
    judicial_estadual = "judicial_estadual"
    judicial_federal = "judicial_federal"
    judicial_trabalhista = "judicial_trabalhista"


ROTULO_TIPO_CASO = {
    TipoCaso.consultivo: "Consultivo", TipoCaso.administrativo: "Administrativo", TipoCaso.judicial_estadual: "Judicial Estadual",
    TipoCaso.judicial_federal: "Judicial Federal", TipoCaso.judicial_trabalhista: "Judicial Trabalhista",
}


class StatusCaso(enum.StrEnum):
    aberto = "aberto"
    encerrado = "encerrado"


class Caso(Base, Timestamped):
    __tablename__ = "fat_caso"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)
    contrato_id: Mapped[int] = mapped_column(ForeignKey("fat_contrato.id"), index=True)
    titulo: Mapped[str] = mapped_column(String(250))
    descricao: Mapped[str | None] = mapped_column(Text)
    numero_processo: Mapped[str | None] = mapped_column(String(40))
    parte_contraria: Mapped[str | None] = mapped_column(String(200))
    tipo: Mapped[TipoCaso | None] = mapped_column(_enum(TipoCaso), index=True)
    area_id: Mapped[int | None] = mapped_column(ForeignKey("fat_area.id", ondelete="SET NULL"), index=True)
    polo: Mapped[str | None] = mapped_column(String(10))  # ativo | passivo | terceiro | consultivo
    instancia: Mapped[str | None] = mapped_column(String(20))  # primeira | juizado | segunda | turma_recursal | superior | stf
    tribunal: Mapped[str | None] = mapped_column(String(80))
    vara: Mapped[str | None] = mapped_column(String(120))
    comarca: Mapped[str | None] = mapped_column(String(80))
    valor_causa: Mapped[Decimal | None] = mapped_column(Dinheiro)
    data_distribuicao: Mapped[date | None] = mapped_column(Date)
    campos: Mapped[dict | None] = mapped_column(JSON)  # {id do campo adicional: valor}
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    tabela_preco_id: Mapped[int | None] = mapped_column(ForeignKey("fat_tabela.id"))  # vence a do contrato
    status: Mapped[StatusCaso] = mapped_column(_enum(StatusCaso), default=StatusCaso.aberto)
    data_abertura: Mapped[date | None] = mapped_column(Date)
    data_encerramento: Mapped[date | None] = mapped_column(Date)

    contrato: Mapped[Contrato] = relationship(back_populates="casos")
    regras: Mapped[list["RegraCobranca"]] = relationship(back_populates="caso")
    area: Mapped["AreaAtuacao | None"] = relationship()
    anexos: Mapped[list["AnexoCaso"]] = relationship(back_populates="caso", cascade="all, delete-orphan",
                                                     order_by="AnexoCaso.id.desc()")
    andamentos: Mapped[list["Andamento"]] = relationship(back_populates="caso", cascade="all, delete-orphan",
                                                         order_by="(Andamento.data.desc(), Andamento.id.desc())")

    __table_args__ = (UniqueConstraint("tenant_id", "numero", name="uq_fat_caso_numero"),)


class TipoAndamento(enum.StrEnum):
    andamento = "andamento"
    publicacao = "publicacao"
    despacho = "despacho"
    decisao = "decisao"
    sentenca = "sentenca"
    audiencia = "audiencia"
    prazo = "prazo"
    reuniao = "reuniao"
    nota = "nota"  # nota interna


class Andamento(Base, Timestamped):
    """Histórico do caso: movimentações do processo, prazos, audiências e notas internas."""

    __tablename__ = "fat_andamento"

    id: Mapped[int] = mapped_column(primary_key=True)
    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), index=True)
    data: Mapped[date] = mapped_column(Date, index=True)
    tipo: Mapped[TipoAndamento] = mapped_column(_enum(TipoAndamento), default=TipoAndamento.andamento)
    titulo: Mapped[str] = mapped_column(String(200))
    descricao: Mapped[str | None] = mapped_column(Text)
    prazo: Mapped[date | None] = mapped_column(Date)  # data limite (prazos e audiências)
    concluido: Mapped[bool] = mapped_column(Boolean, default=False)
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    caso: Mapped["Caso"] = relationship(back_populates="andamentos")


class AnexoCaso(Base, Timestamped):
    __tablename__ = "fat_anexo"

    id: Mapped[int] = mapped_column(primary_key=True)
    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(255))  # nome original do arquivo
    descricao: Mapped[str | None] = mapped_column(String(300))
    categoria: Mapped[str | None] = mapped_column(String(60))  # Petição, Contrato, Procuração...
    caminho: Mapped[str] = mapped_column(String(500))
    tamanho: Mapped[int] = mapped_column(Integer, default=0)
    mime: Mapped[str | None] = mapped_column(String(100))
    enviado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    despesa_id: Mapped[int | None] = mapped_column(ForeignKey("fat_despesa.id", ondelete="CASCADE"), index=True)  # pasta Despesas

    caso: Mapped[Caso] = relationship(back_populates="anexos")


class RegraCobranca(Base, Timestamped):
    """Como o cliente paga. No contrato vale para o contrato todo; no caso, vence a do contrato para aquele caso."""

    __tablename__ = "fat_regra"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    contrato_id: Mapped[int] = mapped_column(ForeignKey("fat_contrato.id"), index=True)
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id"), index=True)
    tipo: Mapped[TipoRegra] = mapped_column(_enum(TipoRegra))
    descricao: Mapped[str] = mapped_column(String(300))  # texto que sai na fatura
    valor: Mapped[Decimal | None] = mapped_column(Dinheiro)
    data_pagamento: Mapped[date | None] = mapped_column(Date)  # fixo
    # recorrente: padrão + intervalo de recorrência
    frequencia: Mapped[Frequencia | None] = mapped_column(_enum(Frequencia))
    intervalo: Mapped[int] = mapped_column(Integer, default=1)  # "a cada N" dias/semanas/meses/anos
    data_inicio: Mapped[date | None] = mapped_column(Date)  # começa em (1ª parcela)
    termino: Mapped[Termino] = mapped_column(_enum(Termino), default=Termino.sem)
    ocorrencias: Mapped[int | None] = mapped_column(Integer)  # termina após N parcelas
    data_fim: Mapped[date | None] = mapped_column(Date)  # termina em
    tabela_preco_id: Mapped[int | None] = mapped_column(ForeignKey("fat_tabela.id"))  # hora: vazio = do caso/contrato
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    observacao: Mapped[str | None] = mapped_column(Text)

    contrato: Mapped[Contrato] = relationship(foreign_keys=[contrato_id])
    caso: Mapped["Caso | None"] = relationship(back_populates="regras")
    tabela_preco: Mapped["TabelaPreco | None"] = relationship()


class Timesheet(Base, Timestamped):
    __tablename__ = "fat_timesheet"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id"), index=True)
    profissional_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)  # funcionário (usuário)
    data: Mapped[date] = mapped_column(Date, index=True)
    minutos: Mapped[int] = mapped_column(Integer)
    descricao: Mapped[str] = mapped_column(Text)
    faturavel: Mapped[bool] = mapped_column(Boolean, default=True)
    fatura_item_id: Mapped[int | None] = mapped_column(ForeignKey("fat_fatura_item.id", ondelete="SET NULL"))

    caso: Mapped[Caso] = relationship()
    profissional = relationship("Usuario")


class TipoDespesa(enum.StrEnum):
    custas = "custas"
    copias = "copias"
    deslocamento = "deslocamento"
    correio = "correio"
    diligencia = "diligencia"
    honorario_perito = "honorario_perito"
    outros = "outros"


class Despesa(Base, Timestamped):
    __tablename__ = "fat_despesa"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    caso_id: Mapped[int] = mapped_column(ForeignKey("fat_caso.id"), index=True)
    data: Mapped[date] = mapped_column(Date, index=True)
    tipo: Mapped[TipoDespesa] = mapped_column(_enum(TipoDespesa), default=TipoDespesa.outros)
    descricao: Mapped[str] = mapped_column(String(300))
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    reembolsavel: Mapped[bool] = mapped_column(Boolean, default=True)
    comprovante_path: Mapped[str | None] = mapped_column(String(500))
    lancado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    fatura_item_id: Mapped[int | None] = mapped_column(ForeignKey("fat_fatura_item.id", ondelete="SET NULL"))

    caso: Mapped[Caso] = relationship()


class FaturaItem(Base):
    """Linha de uma fatura (NH ou ND). `chave_cobranca` UNIQUE impede cobrar a mesma parcela duas vezes."""

    __tablename__ = "fat_fatura_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    fatura_id: Mapped[int] = mapped_column(ForeignKey("fatura.id", ondelete="CASCADE"), index=True)
    tipo: Mapped[str] = mapped_column(String(15))  # fixo | recorrente | hora | despesa
    regra_id: Mapped[int | None] = mapped_column(ForeignKey("fat_regra.id"))
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id"))
    competencia: Mapped[date | None] = mapped_column(Date)
    chave_cobranca: Mapped[str | None] = mapped_column(String(60), unique=True)
    data: Mapped[date | None] = mapped_column(Date)
    descricao: Mapped[str] = mapped_column(Text)
    profissional: Mapped[str | None] = mapped_column(String(150))
    quantidade: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))  # horas
    valor_unitario: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)

    fatura = relationship("Fatura", backref=backref("itens", order_by="FaturaItem.id", cascade="all, delete-orphan"))
    caso: Mapped["Caso | None"] = relationship()


class StatusRevisao(enum.StrEnum):
    em_revisao = "em_revisao"
    faturada = "faturada"
    descartada = "descartada"


class Revisao(Base, Timestamped):
    """Pré-fatura "Em Revisão": os itens ficam reservados (somem de Itens a faturar) até aprovar ou descartar.

    Na revisão dá para incluir/excluir horas, lançamentos avulsos e parcelas de regra, editar textos e valores e
    pedir a análise da IA. Aprovar gera a fatura (NH ou ND) com o que sobrou.
    """

    __tablename__ = "fat_revisao"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)
    aba: Mapped[str] = mapped_column(String(15))  # honorarios | despesas
    contrato_id: Mapped[int] = mapped_column(ForeignKey("fat_contrato.id"), index=True)
    tomador_id: Mapped[int] = mapped_column(ForeignKey("tomador.id"), index=True)
    de: Mapped[date] = mapped_column(Date)
    ate: Mapped[date] = mapped_column(Date)
    status: Mapped[StatusRevisao] = mapped_column(_enum(StatusRevisao), default=StatusRevisao.em_revisao, index=True)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    observacao: Mapped[str | None] = mapped_column(Text)  # vai para a fatura
    nota_interna: Mapped[str | None] = mapped_column(Text)
    ia_analise: Mapped[dict | None] = mapped_column(JSON)
    fatura_id: Mapped[int | None] = mapped_column(ForeignKey("fatura.id"))
    concluida_em: Mapped[date | None] = mapped_column(Date)
    eventos: Mapped[list] = mapped_column(JSON, default=list)

    contrato: Mapped[Contrato] = relationship()
    itens: Mapped[list["RevisaoItem"]] = relationship(back_populates="revisao", cascade="all, delete-orphan",
                                                     order_by="(RevisaoItem.data, RevisaoItem.id)")

    __table_args__ = (UniqueConstraint("tenant_id", "numero", name="uq_fat_revisao_numero"),)

    def evento(self, texto: str, usuario: str | None = None) -> None:
        from app.core.db import agora

        self.eventos = [*(self.eventos or []), {"em": agora().isoformat(), "texto": texto, "usuario": usuario}]


class RevisaoItem(Base):
    __tablename__ = "fat_revisao_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    revisao_id: Mapped[int] = mapped_column(ForeignKey("fat_revisao.id", ondelete="CASCADE"), index=True)
    chave: Mapped[str] = mapped_column(String(60), index=True)  # regra:… · ts:… · desp:… · avulso:…
    tipo: Mapped[str] = mapped_column(String(15))  # fixo | recorrente | hora | despesa | avulso
    regra_id: Mapped[int | None] = mapped_column(ForeignKey("fat_regra.id"))
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id"))
    competencia: Mapped[date | None] = mapped_column(Date)
    parcela: Mapped[str | None] = mapped_column(String(15))
    data: Mapped[date] = mapped_column(Date)
    descricao: Mapped[str] = mapped_column(Text)
    profissional: Mapped[str | None] = mapped_column(String(150))
    profissional_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    quantidade: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    valor_unitario: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    valor_original: Mapped[Decimal] = mapped_column(Dinheiro)
    origem_id: Mapped[int | None] = mapped_column(Integer)  # timesheet ou despesa
    excluido: Mapped[bool] = mapped_column(Boolean, default=False)
    manual: Mapped[bool] = mapped_column(Boolean, default=False)  # incluído durante a revisão

    revisao: Mapped[Revisao] = relationship(back_populates="itens")
    caso: Mapped["Caso | None"] = relationship()
