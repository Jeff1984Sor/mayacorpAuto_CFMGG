"""Boletos registrados por arquivo CNAB 240: convênio com o banco, boletos, remessas, retornos e ocorrências."""

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Boolean, Date, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, Timestamped, UtcDateTime, agora

Dinheiro = Numeric(14, 2)


def _enum(e: type[enum.Enum]):
    return Enum(e, native_enum=False, length=20)


class StatusBoleto(enum.StrEnum):
    rascunho = "rascunho"  # criado, ainda fora de qualquer remessa (pode editar e excluir)
    em_remessa = "em_remessa"  # foi no arquivo, aguardando o banco responder
    registrado = "registrado"  # banco confirmou (retorno 02): já pode ir para o cliente
    rejeitado = "rejeitado"  # banco recusou (retorno 03)
    pago = "pago"
    baixado = "baixado"
    em_protesto = "em_protesto"
    protestado = "protestado"
    cancelado = "cancelado"


# o boleto ainda "vale" para a fatura: não se cria outro enquanto um destes existir
ATIVOS = (StatusBoleto.rascunho, StatusBoleto.em_remessa, StatusBoleto.registrado, StatusBoleto.em_protesto,
          StatusBoleto.pago)


class Convenio(Base, Timestamped):
    """Contrato de cobrança do escritório com o banco (os códigos vêm do gerente)."""

    __tablename__ = "bol_convenio"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    nome: Mapped[str] = mapped_column(String(120))  # apelido na tela
    emissora_id: Mapped[int] = mapped_column(ForeignKey("emissora.id"))  # beneficiário
    conta_bancaria_id: Mapped[int | None] = mapped_column(ForeignKey("fin_conta.id"))  # onde o crédito cai no Financeiro
    banco: Mapped[str] = mapped_column(String(3), default="033")
    agencia: Mapped[str] = mapped_column(String(4))
    agencia_dv: Mapped[str] = mapped_column(String(1), default="0")
    conta: Mapped[str] = mapped_column(String(9))
    conta_dv: Mapped[str] = mapped_column(String(1))
    codigo_beneficiario: Mapped[str] = mapped_column(String(7))  # vai no código de barras
    codigo_transmissao: Mapped[str] = mapped_column(String(15))  # vai no header da remessa
    carteira: Mapped[str] = mapped_column(String(3), default="101")
    tipo_cobranca: Mapped[str] = mapped_column(String(1), default="5")  # P 058
    forma_cadastramento: Mapped[str] = mapped_column(String(1), default="1")  # P 059
    tipo_documento: Mapped[str] = mapped_column(String(1), default="1")  # P 060
    especie_titulo: Mapped[str] = mapped_column(String(2), default="04")  # P 107-108 (DS)
    aceite: Mapped[str] = mapped_column(String(1), default="N")
    numeracao: Mapped[str] = mapped_column(String(7), default="EMPRESA")  # EMPRESA | BANCO
    proximo_nosso_numero: Mapped[int] = mapped_column(Integer, default=1)
    proximo_sequencial_arquivo: Mapped[int] = mapped_column(Integer, default=1)
    codigo_juros: Mapped[str] = mapped_column(String(1), default="2")  # 1 valor/dia · 2 taxa mensal · 3 isento
    juros_mensal_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("1.00"))
    multa_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("2.00"))
    codigo_protesto: Mapped[str] = mapped_column(String(1), default="0")
    dias_protesto: Mapped[int] = mapped_column(Integer, default=0)
    codigo_baixa: Mapped[str] = mapped_column(String(1), default="1")
    dias_baixa: Mapped[int] = mapped_column(Integer, default=60)
    mensagem_1: Mapped[str | None] = mapped_column(String(40))
    mensagem_2: Mapped[str | None] = mapped_column(String(40))
    instrucoes: Mapped[str | None] = mapped_column(Text)  # texto livre impresso no boleto
    pix_habilitado: Mapped[bool] = mapped_column(Boolean, default=False)
    pix_chave_tipo: Mapped[str | None] = mapped_column(String(1))
    pix_chave: Mapped[str | None] = mapped_column(String(77))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    homologado: Mapped[bool] = mapped_column(Boolean, default=False)  # enquanto não, toda remessa sai como TESTE

    emissora = relationship("Emissora")


class ArquivoRemessa(Base):
    __tablename__ = "bol_remessa"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    convenio_id: Mapped[int] = mapped_column(ForeignKey("bol_convenio.id"), index=True)
    sequencial: Mapped[int] = mapped_column(Integer)
    gerado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    gerado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    nome_arquivo: Mapped[str] = mapped_column(String(120))
    arquivo_path: Mapped[str] = mapped_column(String(500))
    qtd_boletos: Mapped[int] = mapped_column(Integer, default=0)
    valor_total: Mapped[Decimal] = mapped_column(Dinheiro, default=Decimal(0))
    hash_sha256: Mapped[str] = mapped_column(String(64))
    ambiente: Mapped[str] = mapped_column(String(10), default="teste")  # teste | producao

    convenio: Mapped[Convenio] = relationship()

    __table_args__ = (UniqueConstraint("convenio_id", "sequencial", name="uq_bol_remessa_convenio_sequencial"),)


class ArquivoRetorno(Base):
    __tablename__ = "bol_retorno"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    convenio_id: Mapped[int] = mapped_column(ForeignKey("bol_convenio.id"), index=True)
    importado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)
    importado_por_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    nome_arquivo: Mapped[str] = mapped_column(String(200))
    arquivo_path: Mapped[str] = mapped_column(String(500))
    hash_sha256: Mapped[str] = mapped_column(String(64))
    qtd_ocorrencias: Mapped[int] = mapped_column(Integer, default=0)
    qtd_orfas: Mapped[int] = mapped_column(Integer, default=0)
    status_processamento: Mapped[str] = mapped_column(String(15), default="processado")
    resumo: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # contagens por resultado + avisos

    convenio: Mapped[Convenio] = relationship()

    # o mesmo arquivo não entra duas vezes
    __table_args__ = (UniqueConstraint("tenant_id", "hash_sha256", name="uq_bol_retorno_tenant_hash"),)


class Boleto(Base, Timestamped):
    __tablename__ = "bol_boleto"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    convenio_id: Mapped[int] = mapped_column(ForeignKey("bol_convenio.id"), index=True)
    fatura_id: Mapped[int | None] = mapped_column(ForeignKey("fatura.id"), index=True)  # vazio = boleto avulso
    tomador_id: Mapped[int | None] = mapped_column(ForeignKey("tomador.id"))
    # o pagador é copiado na criação: o boleto não muda se o cadastro mudar depois
    pagador_nome: Mapped[str] = mapped_column(String(200))
    pagador_documento: Mapped[str] = mapped_column(String(14))
    pagador_endereco: Mapped[str] = mapped_column(String(200), default="")
    pagador_bairro: Mapped[str] = mapped_column(String(80), default="")
    pagador_cep: Mapped[str] = mapped_column(String(8), default="")
    pagador_cidade: Mapped[str] = mapped_column(String(80), default="")
    pagador_uf: Mapped[str] = mapped_column(String(2), default="")
    descricao: Mapped[str] = mapped_column(String(200), default="")  # o que está sendo cobrado
    seu_numero: Mapped[str] = mapped_column(String(15))
    id_empresa: Mapped[str] = mapped_column(String(25), unique=True)  # volta no retorno (T 101-125)
    nosso_numero: Mapped[str | None] = mapped_column(String(13))  # vazio enquanto o banco não numerar
    valor: Mapped[Decimal] = mapped_column(Dinheiro)
    data_emissao: Mapped[date] = mapped_column(Date)
    data_vencimento: Mapped[date] = mapped_column(Date, index=True)
    codigo_barras: Mapped[str] = mapped_column(String(44), default="")
    linha_digitavel: Mapped[str] = mapped_column(String(47), default="")
    status: Mapped[StatusBoleto] = mapped_column(_enum(StatusBoleto), default=StatusBoleto.rascunho, index=True)
    # instrução esperando a próxima remessa (02 = pedido de baixa, 06 = alteração de vencimento)
    instrucao_pendente: Mapped[str | None] = mapped_column(String(2))
    novo_vencimento: Mapped[date | None] = mapped_column(Date)  # pedido de alteração aguardando o banco confirmar
    valor_pago: Mapped[Decimal | None] = mapped_column(Dinheiro)
    valor_liquido: Mapped[Decimal | None] = mapped_column(Dinheiro)
    data_pagamento: Mapped[date | None] = mapped_column(Date)
    data_credito: Mapped[date | None] = mapped_column(Date)
    tarifa: Mapped[Decimal | None] = mapped_column(Dinheiro)
    motivos: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)  # por que o banco rejeitou
    remessa_id: Mapped[int | None] = mapped_column(ForeignKey("bol_remessa.id"), index=True)
    txid: Mapped[str] = mapped_column(String(35), default="")

    convenio: Mapped[Convenio] = relationship()
    fatura = relationship("Fatura")
    remessa: Mapped[ArquivoRemessa | None] = relationship()
    ocorrencias: Mapped[list["OcorrenciaBoleto"]] = relationship(
        back_populates="boleto", order_by="OcorrenciaBoleto.id", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("convenio_id", "nosso_numero", name="uq_bol_boleto_convenio_nosso_numero"),)


class OcorrenciaBoleto(Base):
    """Tudo o que aconteceu com o boleto: o que foi enviado e o que o banco respondeu (com a linha original)."""

    __tablename__ = "bol_ocorrencia"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenant.id"), index=True)
    boleto_id: Mapped[int | None] = mapped_column(ForeignKey("bol_boleto.id", ondelete="CASCADE"), index=True)  # vazio = órfã
    retorno_id: Mapped[int | None] = mapped_column(ForeignKey("bol_retorno.id"), index=True)
    remessa_id: Mapped[int | None] = mapped_column(ForeignKey("bol_remessa.id"))
    origem: Mapped[str] = mapped_column(String(10), default="retorno")  # retorno | remessa | sistema
    codigo_movimento: Mapped[str] = mapped_column(String(2))
    descricao: Mapped[str] = mapped_column(String(200))
    motivos: Mapped[list[dict[str, str]]] = mapped_column(JSON, default=list)
    data_ocorrencia: Mapped[date | None] = mapped_column(Date)
    valor_pago: Mapped[Decimal | None] = mapped_column(Dinheiro)
    nosso_numero: Mapped[str | None] = mapped_column(String(13))
    alerta: Mapped[str | None] = mapped_column(String(300))  # algo que alguém precisa olhar
    payload_bruto: Mapped[str | None] = mapped_column(Text)
    criado_em: Mapped[datetime] = mapped_column(UtcDateTime(), default=agora)

    boleto: Mapped[Boleto | None] = relationship(back_populates="ocorrencias")
