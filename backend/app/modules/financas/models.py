"""Financeiro do escritório (inspirado no RCA): contas bancárias, extrato, contas a pagar, fornecedores, categorias e impostos.

O saldo de uma conta nunca é gravado: é sempre saldo_inicial + créditos − débitos dos lançamentos.
Pagar uma conta gera um débito no extrato; receber uma fatura gera um crédito (e desfazer apaga o lançamento).
"""

import enum
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped

Dinheiro = Numeric(14, 2)


def _enum(e: type[enum.Enum]):
    return Enum(e, native_enum=False, length=20)


class TipoConta(enum.StrEnum):
    corrente = "corrente"
    poupanca = "poupanca"
    pagamento = "pagamento"
    caixa = "caixa"
    investimento = "investimento"


class TipoLancamento(enum.StrEnum):
    credito = "credito"  # entrada
    debito = "debito"  # saída


class TipoCategoria(enum.StrEnum):
    receita = "receita"
    despesa = "despesa"


class GrupoDre(enum.StrEnum):
    """Linha da DRE gerencial em que a categoria cai."""

    receita_bruta = "receita_bruta"
    deducoes = "deducoes"  # impostos sobre faturamento
    outras_receitas = "outras_receitas"
    pessoal = "pessoal"
    custos = "custos"
    administrativas = "administrativas"
    financeiras = "financeiras"
    impostos_lucro = "impostos_lucro"  # IRPJ/CSLL
    investimentos = "investimentos"
    retiradas = "retiradas"  # pró-labore, distribuição de lucros


class FormaPagamento(enum.StrEnum):
    pix = "pix"
    boleto = "boleto"
    ted = "ted"
    dinheiro = "dinheiro"
    cartao = "cartao"
    debito = "debito"  # débito automático
    outro = "outro"


class ContaBancaria(Base, Timestamped):
    __tablename__ = "fin_conta"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(120))  # apelido
    banco: Mapped[str | None] = mapped_column(String(120))
    agencia: Mapped[str | None] = mapped_column(String(20))
    numero: Mapped[str | None] = mapped_column(String(30))
    tipo: Mapped[TipoConta] = mapped_column(_enum(TipoConta), default=TipoConta.corrente)
    titular: Mapped[str | None] = mapped_column(String(200))
    emissora_id: Mapped[int | None] = mapped_column(ForeignKey("emissora.id"))
    saldo_inicial: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    data_saldo_inicial: Mapped[date | None] = mapped_column(Date)
    cor: Mapped[str] = mapped_column(String(7), default="#7C8FFF")
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class CategoriaFinanceira(Base, Timestamped):
    __tablename__ = "fin_categoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[TipoCategoria] = mapped_column(_enum(TipoCategoria), default=TipoCategoria.despesa)
    grupo_dre: Mapped[GrupoDre | None] = mapped_column(_enum(GrupoDre))
    cor: Mapped[str | None] = mapped_column(String(7))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    subcategorias: Mapped[list["Subcategoria"]] = relationship(back_populates="categoria", order_by="Subcategoria.nome",
                                                             cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("tenant_id", "nome", "tipo", name="uq_fin_categoria"),)


class Subcategoria(Base, Timestamped):
    __tablename__ = "fin_subcategoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("fin_categoria.id", ondelete="CASCADE"), index=True)
    nome: Mapped[str] = mapped_column(String(120))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)

    categoria: Mapped[CategoriaFinanceira] = relationship(back_populates="subcategorias")

    __table_args__ = (UniqueConstraint("categoria_id", "nome", name="uq_fin_subcategoria"),)


class Fornecedor(Base, Timestamped):
    __tablename__ = "fin_fornecedor"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(200), index=True)
    tipo: Mapped[str] = mapped_column(String(2), default="PJ")  # PF | PJ
    cpf_cnpj: Mapped[str | None] = mapped_column(String(14), index=True)
    email: Mapped[str | None] = mapped_column(String(200))
    telefone: Mapped[str | None] = mapped_column(String(40))
    chave_pix: Mapped[str | None] = mapped_column(String(120))
    banco: Mapped[str | None] = mapped_column(String(80))
    agencia: Mapped[str | None] = mapped_column(String(20))
    conta: Mapped[str | None] = mapped_column(String(30))
    categoria_padrao_id: Mapped[int | None] = mapped_column(ForeignKey("fin_categoria.id"))
    observacao: Mapped[str | None] = mapped_column(Text)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class Lancamento(Base, Timestamped):
    """Linha do extrato. `valor` é sempre positivo; o sinal vem do tipo."""

    __tablename__ = "fin_lancamento"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    conta_id: Mapped[int] = mapped_column(ForeignKey("fin_conta.id", ondelete="CASCADE"), index=True)
    data: Mapped[date] = mapped_column(Date, index=True)
    descricao: Mapped[str] = mapped_column(String(255))
    tipo: Mapped[TipoLancamento] = mapped_column(_enum(TipoLancamento), default=TipoLancamento.debito)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_categoria.id", ondelete="SET NULL"), index=True)
    subcategoria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_subcategoria.id", ondelete="SET NULL"))
    fornecedor_id: Mapped[int | None] = mapped_column(ForeignKey("fin_fornecedor.id", ondelete="SET NULL"))
    funcionario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    favorecido: Mapped[str | None] = mapped_column(String(200))
    documento: Mapped[str | None] = mapped_column(String(80))
    observacao: Mapped[str | None] = mapped_column(Text)
    origem: Mapped[str] = mapped_column(String(15), default="manual")  # manual | conta_pagar | fatura | transferencia | importacao
    transferencia_par_id: Mapped[int | None] = mapped_column(ForeignKey("fin_lancamento.id", ondelete="SET NULL"))
    fatura_id: Mapped[int | None] = mapped_column(ForeignKey("fatura.id", ondelete="SET NULL"), index=True)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    conta: Mapped[ContaBancaria] = relationship()
    categoria: Mapped["CategoriaFinanceira | None"] = relationship()
    subcategoria: Mapped["Subcategoria | None"] = relationship()
    fornecedor: Mapped["Fornecedor | None"] = relationship()


class ContaPagar(Base, Timestamped):
    __tablename__ = "fin_conta_pagar"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    descricao: Mapped[str] = mapped_column(String(255))
    fornecedor_id: Mapped[int | None] = mapped_column(ForeignKey("fin_fornecedor.id"), index=True)
    funcionario_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))  # reembolso, salário...
    favorecido: Mapped[str | None] = mapped_column(String(200))
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_categoria.id"), index=True)  # 1ª do rateio
    subcategoria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_subcategoria.id"))
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    data_vencimento: Mapped[date] = mapped_column(Date, index=True)
    data_competencia: Mapped[date | None] = mapped_column(Date)
    forma_pagamento: Mapped[FormaPagamento | None] = mapped_column(_enum(FormaPagamento))
    documento: Mapped[str | None] = mapped_column(String(80))
    codigo_barras: Mapped[str | None] = mapped_column(String(60))
    observacao: Mapped[str | None] = mapped_column(Text)
    # recorrência: todas as parcelas da série têm o mesmo grupo
    grupo_recorrencia: Mapped[str | None] = mapped_column(String(32), index=True)
    recorrencia_meses: Mapped[int] = mapped_column(Integer, default=0)  # 0, 1, 2, 3, 6, 12
    recorrencia_indeterminada: Mapped[bool] = mapped_column(Boolean, default=False)
    parcela: Mapped[int | None] = mapped_column(Integer)
    parcelas_total: Mapped[int | None] = mapped_column(Integer)
    # pagamento
    conta_bancaria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_conta.id"))
    data_pagamento: Mapped[date | None] = mapped_column(Date, index=True)
    valor_pago: Mapped[Decimal | None] = mapped_column(Dinheiro)
    juros: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    desconto: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    lancamento_id: Mapped[int | None] = mapped_column(ForeignKey("fin_lancamento.id", ondelete="SET NULL"))
    anexo_path: Mapped[str | None] = mapped_column(String(500))  # boleto / nota
    comprovante_path: Mapped[str | None] = mapped_column(String(500))
    agendamento_enviado_em: Mapped[date | None] = mapped_column(Date)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    fornecedor: Mapped["Fornecedor | None"] = relationship()
    categoria: Mapped["CategoriaFinanceira | None"] = relationship()
    subcategoria: Mapped["Subcategoria | None"] = relationship()
    conta_bancaria: Mapped["ContaBancaria | None"] = relationship()
    rateio: Mapped[list["Rateio"]] = relationship(back_populates="conta", cascade="all, delete-orphan", order_by="Rateio.id")

    @property
    def status(self) -> str:
        if self.data_pagamento:
            return "pago"
        return "atrasado" if self.data_vencimento < date.today() else "pendente"


class Rateio(Base):
    __tablename__ = "fin_rateio"

    id: Mapped[int] = mapped_column(primary_key=True)
    conta_id: Mapped[int] = mapped_column(ForeignKey("fin_conta_pagar.id", ondelete="CASCADE"), index=True)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("fin_categoria.id"))
    subcategoria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_subcategoria.id"))
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    percentual: Mapped[Decimal] = mapped_column(Numeric(6, 2))

    conta: Mapped[ContaPagar] = relationship(back_populates="rateio")
    categoria: Mapped[CategoriaFinanceira] = relationship()
    subcategoria: Mapped["Subcategoria | None"] = relationship()


class ConfigFinanceiro(Base, Timestamped):
    """Preferências do financeiro (por escritório)."""

    __tablename__ = "fin_config"

    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), primary_key=True)
    conta_recebimento_id: Mapped[int | None] = mapped_column(ForeignKey("fin_conta.id", ondelete="SET NULL"))
    categoria_honorarios_id: Mapped[int | None] = mapped_column(ForeignKey("fin_categoria.id", ondelete="SET NULL"))
    categoria_reembolso_id: Mapped[int | None] = mapped_column(ForeignKey("fin_categoria.id", ondelete="SET NULL"))
    saldo_minimo: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(10000))
    agendamento_destinatarios: Mapped[list[str]] = mapped_column(JSON, default=list)


class ConfigImpostos(Base, Timestamped):
    """Parâmetros da projeção de impostos por empresa emissora (estimativa; o oficial é o do contador)."""

    __tablename__ = "fin_config_impostos"

    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"), primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    regime: Mapped[str] = mapped_column(String(10), default="presumido")  # cópia do regime do cadastro da emissora
    regime_receita: Mapped[str] = mapped_column(String(12), default="competencia")  # competencia | caixa
    # Simples Nacional
    anexo: Mapped[str] = mapped_column(String(3), default="IV")
    faixas: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    dia_vencimento_das: Mapped[int] = mapped_column(Integer, default=20)
    # Lucro Presumido (serviços)
    aliq_pis: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0.65"))
    aliq_cofins: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("3.00"))
    presuncao_irpj: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("32.00"))
    presuncao_csll: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("32.00"))
    aliq_irpj: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("15.00"))
    aliq_adicional_irpj: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("10.00"))
    limite_adicional_trimestre: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(60000))
    aliq_csll: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("9.00"))
    # Lucro Real (PIS/COFINS não cumulativos, antes dos créditos)
    aliq_pis_real: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("1.65"))
    aliq_cofins_real: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("7.60"))
    iss_modo: Mapped[str] = mapped_column(String(10), default="percentual")  # percentual | fixo (sociedade uniprofissional)
    iss_fixo_mensal: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    dia_vencimento: Mapped[int] = mapped_column(Integer, default=25)
    # Reforma tributária: alíquotas de referência ainda não fixadas pelo Senado (estimativas) e a redução da advocacia
    aliq_cbs: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("8.80"), server_default="8.80")
    aliq_ibs: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("17.70"), server_default="17.70")
    reducao_ibs_cbs: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("30.00"), server_default="30.00")


class ReceitaInformada(Base, Timestamped):
    """Receita do mês informada pelo contador: substitui o valor calculado pelo sistema naquele mês."""

    __tablename__ = "fin_receita_informada"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))
    mes: Mapped[date] = mapped_column(Date)  # dia 1
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    observacao: Mapped[str | None] = mapped_column(String(300))

    __table_args__ = (UniqueConstraint("emissora_id", "mes", name="uq_fin_receita_informada"),)
