"""Comissionamento dos profissionais.

A comissão nunca é gravada: é calculada na leitura, a partir das faturas de honorários pagas e das regras de cada
profissional (como o saldo do Financeiro). A única coisa guardada é o vínculo "a comissão deste recebimento para
este profissional já virou a conta a pagar X" (`ComissaoLancada`, UNIQUE), para nunca gerar duas contas.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, Timestamped

Dinheiro = Numeric(14, 2)

ALCANCES = ("geral", "cliente", "contrato", "caso")


class RegraComissao(Base, Timestamped):
    """Percentual que o profissional recebe sobre o que o cliente pagou (honorários).

    Alcance: geral (tudo o que for recebido), um cliente, um contrato ou um caso. Quando mais de uma regra do mesmo
    profissional alcança o mesmo recebimento, vale a mais específica (caso > contrato > cliente > geral).
    """

    __tablename__ = "com_regra"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id", ondelete="CASCADE"), index=True)
    alcance: Mapped[str] = mapped_column(String(10), default="geral")  # geral | cliente | contrato | caso
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id", ondelete="CASCADE"))
    contrato_id: Mapped[int | None] = mapped_column(ForeignKey("fat_contrato.id", ondelete="CASCADE"))
    caso_id: Mapped[int | None] = mapped_column(ForeignKey("fat_caso.id", ondelete="CASCADE"))
    percentual: Mapped[Decimal] = mapped_column(Numeric(6, 2))  # 0 a 100; 0 = "aqui não tem comissão"
    vigencia_inicio: Mapped[date | None] = mapped_column(Date)  # vale para pagamentos a partir desta data
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    observacao: Mapped[str | None] = mapped_column(String(200))


class ComissaoLancada(Base, Timestamped):
    """A comissão de um recebimento (fatura paga) para um profissional já está numa conta a pagar.

    Excluir a conta apaga o vínculo (ON DELETE CASCADE) e a comissão volta a ficar "a pagar". Os valores guardados
    são os do momento em que a conta foi gerada: servem para apontar divergência se o recebimento for estornado
    ou a regra mudar depois.
    """

    __tablename__ = "com_lancada"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    fatura_id: Mapped[int] = mapped_column(ForeignKey("fatura.id"), index=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuario.id"), index=True)
    conta_pagar_id: Mapped[int] = mapped_column(ForeignKey("fin_conta_pagar.id", ondelete="CASCADE"), index=True)
    pago_em: Mapped[date] = mapped_column(Date, index=True)  # data do recebimento quando a conta foi gerada
    valor_base: Mapped[Decimal] = mapped_column(Dinheiro)
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    criado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    __table_args__ = (UniqueConstraint("fatura_id", "usuario_id", name="uq_com_lancada_fatura_usuario"),)
