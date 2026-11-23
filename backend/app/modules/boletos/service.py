"""Orquestração dos boletos: criar, editar, gerar a remessa e processar o retorno do banco.

Regras que valem sempre:
- o nosso número sai de um contador por convênio, travado na hora de reservar, e nunca é reaproveitado;
- um boleto entra em uma remessa só; depois disso, o que muda vai por instrução (baixa, vencimento);
- o boleto só deve ir para o cliente depois que o banco confirma o registro (retorno 02);
- reimportar um retorno não duplica nada (hash do arquivo + ocorrência por boleto/código/data).
"""

import hashlib
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import tenancy
from app.core.documentos import so_digitos
from app.modules.boletos.bancos.base import BancoBase, DadosBoleto, DadosConvenio, OcorrenciaRetorno
from app.modules.boletos.bancos.registry import get_banco
from app.modules.boletos.bancos.santander import codigos as cod
from app.modules.boletos.models import (
    ATIVOS,
    ArquivoRemessa,
    ArquivoRetorno,
    Boleto,
    Convenio,
    OcorrenciaBoleto,
    StatusBoleto,
)
from app.modules.rpa_nfse import fatura as faturas
from app.modules.rpa_nfse import service as nfse_service
from app.modules.rpa_nfse.models import Fatura, StatusFatura, TipoFatura, Tomador


class ErroBoleto(Exception):
    """Problema que a pessoa resolve na tela (mensagem em português claro)."""

    def __init__(self, mensagem: str, erros: list[str] | None = None):
        super().__init__(mensagem)
        self.erros = erros or []


# ------------------------------------------------------------------------------------------------ conversões
def banco_do(conv: Convenio) -> BancoBase:
    return get_banco(conv.banco)


def dados_convenio(conv: Convenio) -> DadosConvenio:
    e = conv.emissora
    return DadosConvenio(
        beneficiario_nome=e.razao_social if e else "", beneficiario_documento=so_digitos(e.cnpj if e else ""),
        agencia=conv.agencia or "", agencia_dv=conv.agencia_dv or "", conta=conv.conta or "", conta_dv=conv.conta_dv or "",
        codigo_beneficiario=conv.codigo_beneficiario or "", codigo_transmissao=conv.codigo_transmissao or "",
        carteira=conv.carteira, tipo_cobranca=conv.tipo_cobranca, forma_cadastramento=conv.forma_cadastramento,
        tipo_documento=conv.tipo_documento, especie_titulo=conv.especie_titulo, aceite=conv.aceite or "N",
        numeracao=conv.numeracao, codigo_juros=conv.codigo_juros,
        juros_mensal_pct=Decimal(conv.juros_mensal_pct or 0), multa_pct=Decimal(conv.multa_pct or 0),
        codigo_protesto=conv.codigo_protesto, dias_protesto=conv.dias_protesto or 0,
        codigo_baixa=conv.codigo_baixa, dias_baixa=conv.dias_baixa or 0,
        mensagem_1=conv.mensagem_1 or "", mensagem_2=conv.mensagem_2 or "",
        pix_habilitado=bool(conv.pix_habilitado), pix_chave_tipo=conv.pix_chave_tipo or "", pix_chave=conv.pix_chave or "",
    )


def dados_boleto(b: Boleto, movimento: str = cod.ENTRADA) -> DadosBoleto:
    vencimento = b.novo_vencimento if movimento == cod.ALTERACAO_VENCIMENTO and b.novo_vencimento else b.data_vencimento
    return DadosBoleto(
        id_empresa=b.id_empresa, seu_numero=b.seu_numero, nosso_numero=b.nosso_numero or "", valor=b.valor,
        data_emissao=b.data_emissao, data_vencimento=vencimento, pagador_nome=b.pagador_nome,
        pagador_documento=b.pagador_documento, pagador_endereco=b.pagador_endereco, pagador_bairro=b.pagador_bairro,
        pagador_cep=b.pagador_cep, pagador_cidade=b.pagador_cidade, pagador_uf=b.pagador_uf, movimento=movimento,
        mensagem_3=b.descricao or "", txid=b.txid or "",
    )


def pagador_do_cliente(t: Tomador | None) -> dict[str, str]:
    """Dados do pagador a partir do cadastro do cliente."""
    if t is None:
        return {}
    rua = " ".join(x for x in [t.tipo_logradouro, t.logradouro] if x)
    endereco = ", ".join(x for x in [rua, t.numero] if x) + (f" {t.complemento}" if t.complemento else "")
    return {
        "pagador_nome": t.nome or "", "pagador_documento": so_digitos(t.cpf_cnpj), "pagador_endereco": endereco.strip(),
        "pagador_bairro": t.bairro or "", "pagador_cep": so_digitos(t.cep), "pagador_cidade": t.cidade or "",
        "pagador_uf": (t.uf or "").upper(),
    }


def sugestao_da_fatura(db: Session, f: Fatura) -> dict:
    """O que vem preenchido quando o boleto nasce de uma fatura (NH ou ND)."""
    return {
        **pagador_do_cliente(f.tomador), "tomador_id": f.tomador_id,
        "valor": faturas.valor_a_pagar(db, f),  # com retenção na nota, o cliente paga o líquido
        "data_vencimento": f.data_vencimento,
        "descricao": f"{'Reembolso de despesas' if f.tipo == TipoFatura.despesas else 'Honorários'} - {f.codigo}",
    }


# ------------------------------------------------------------------------------------------------ convênio
def validar_convenio(conv: Convenio) -> list[str]:
    return banco_do(conv).validar_convenio(dados_convenio(conv))


def _travar(db: Session, convenio_id: int) -> Convenio:
    """Relê o convênio com trava de linha: dois boletos nunca pegam o mesmo número."""
    return db.execute(select(Convenio).where(Convenio.id == convenio_id).with_for_update()
                      .execution_options(populate_existing=True)).scalar_one()


def _reservar_nosso_numero(db: Session, conv: Convenio) -> int:
    conv = _travar(db, conv.id)
    numero = conv.proximo_nosso_numero
    conv.proximo_nosso_numero = numero + 1
    db.flush()
    return numero


# ------------------------------------------------------------------------------------------------ boleto (CRUD)
def boleto_ativo_da_fatura(db: Session, fatura_id: int, exceto_id: int | None = None) -> Boleto | None:
    q = select(Boleto).where(Boleto.fatura_id == fatura_id, Boleto.status.in_(ATIVOS))
    if exceto_id:
        q = q.where(Boleto.id != exceto_id)
    return db.scalar(q)


def _calcular_codigos(b: Boleto, conv: Convenio) -> None:
    """Código de barras e linha digitável (só quando já existe nosso número)."""
    if not b.nosso_numero:
        b.codigo_barras = b.linha_digitavel = ""
        return
    banco = banco_do(conv)
    b.codigo_barras = banco.codigo_barras(dados_boleto(b), dados_convenio(conv))
    b.linha_digitavel = banco.linha_digitavel(b.codigo_barras)


def _validar(b: Boleto, conv: Convenio) -> None:
    banco = banco_do(conv)
    erros = banco.validar_boleto(dados_boleto(b), dados_convenio(conv))
    if erros:
        raise ErroBoleto(erros[0], erros)


def criar_boleto(db: Session, tenant_id: int, conv: Convenio, *, valor: Decimal, data_vencimento: date,
                 pagador: dict[str, str], descricao: str = "", fatura: Fatura | None = None,
                 tomador_id: int | None = None, data_emissao: date | None = None) -> Boleto:
    if not conv.ativo:
        raise ErroBoleto("Este convênio está inativo.")
    problemas = validar_convenio(conv)
    if problemas:
        raise ErroBoleto("O cadastro do convênio está incompleto: " + problemas[0], problemas)
    if fatura is not None:
        if fatura.status != StatusFatura.aberta:
            raise ErroBoleto(f"A fatura {fatura.codigo} não está em aberto.")
        outro = boleto_ativo_da_fatura(db, fatura.id)
        if outro:
            raise ErroBoleto(f"A fatura {fatura.codigo} já tem um boleto ({outro.seu_numero}). Cancele-o antes de criar outro.")
    dc = dados_convenio(conv)
    b = Boleto(
        tenant_id=tenant_id, convenio_id=conv.id, fatura_id=fatura.id if fatura else None,
        tomador_id=tomador_id or (fatura.tomador_id if fatura else None),
        pagador_nome=(pagador.get("pagador_nome") or "").strip()[:200],
        pagador_documento=so_digitos(pagador.get("pagador_documento")),
        pagador_endereco=(pagador.get("pagador_endereco") or "").strip()[:200],
        pagador_bairro=(pagador.get("pagador_bairro") or "").strip()[:80],
        pagador_cep=so_digitos(pagador.get("pagador_cep")),
        pagador_cidade=(pagador.get("pagador_cidade") or "").strip()[:80],
        pagador_uf=(pagador.get("pagador_uf") or "").strip().upper()[:2],
        descricao=(descricao or "").strip()[:200], valor=Decimal(valor),
        data_emissao=data_emissao or date.today(), data_vencimento=data_vencimento,
        id_empresa="MJ" + uuid.uuid4().hex[:22].upper(), seu_numero="", nosso_numero=None,
        txid=("MJ" + uuid.uuid4().hex) if conv.pix_habilitado else "", status=StatusBoleto.rascunho,
    )
    b.convenio = conv
    # valida antes de gastar um nosso número (com um provisório válido, só para a conferência)
    b.nosso_numero = banco_do(conv).calcular_nosso_numero(1, dc) if conv.numeracao == "EMPRESA" else None
    _validar(b, conv)
    sequencial = _reservar_nosso_numero(db, conv)
    b.nosso_numero = banco_do(conv).calcular_nosso_numero(sequencial, dc) if conv.numeracao == "EMPRESA" else None
    b.seu_numero = (f"{'ND' if fatura.tipo == TipoFatura.despesas else 'NH'}{fatura.numero:05d}" if fatura
                    else f"BOL{sequencial:08d}")[:15]
    _calcular_codigos(b, conv)
    db.add(b)
    db.flush()
    registrar(db, b, "sistema", "00", "Boleto criado")
    return b


EDITAVEIS = ("valor", "data_vencimento", "descricao", "pagador_nome", "pagador_documento", "pagador_endereco",
             "pagador_bairro", "pagador_cep", "pagador_cidade", "pagador_uf")


def atualizar_boleto(db: Session, b: Boleto, dados: dict) -> Boleto:
    """Só o rascunho muda livremente. Depois da remessa, o que muda vai por instrução ao banco."""
    if b.status != StatusBoleto.rascunho:
        raise ErroBoleto("Este boleto já foi para o banco: para mudar o vencimento use “Alterar vencimento”; "
                         "para desistir dele, “Pedir baixa”.")
    for campo in EDITAVEIS:
        if campo in dados and dados[campo] is not None:
            v = dados[campo]
            if campo in ("pagador_documento", "pagador_cep"):
                v = so_digitos(v)
            elif campo == "pagador_uf":
                v = str(v).strip().upper()[:2]
            elif isinstance(v, str):
                v = v.strip()
            setattr(b, campo, v)
    _validar(b, b.convenio)
    _calcular_codigos(b, b.convenio)
    db.flush()
    return b


def excluir_boleto(db: Session, b: Boleto) -> None:
    """Rascunho some de vez (o nosso número dele não volta a ser usado). Recusado pelo banco também pode sair."""
    if b.status not in (StatusBoleto.rascunho, StatusBoleto.rejeitado, StatusBoleto.cancelado):
        raise ErroBoleto("Este boleto já foi para o banco e não pode ser excluído. Use “Pedir baixa”.")
    db.delete(b)
    db.flush()


def pedir_baixa(db: Session, b: Boleto) -> Boleto:
    if b.status == StatusBoleto.rascunho:
        b.status = StatusBoleto.cancelado
        registrar(db, b, "sistema", "00", "Boleto cancelado antes de ir para o banco")
    elif b.status in (StatusBoleto.em_remessa, StatusBoleto.registrado, StatusBoleto.em_protesto):
        b.instrucao_pendente, b.novo_vencimento = cod.PEDIDO_BAIXA, None
        registrar(db, b, "sistema", cod.PEDIDO_BAIXA, "Pedido de baixa: vai na próxima remessa")
    else:
        raise ErroBoleto("Este boleto não pode mais ser baixado.")
    db.flush()
    return b


def alterar_vencimento(db: Session, b: Boleto, novo: date) -> Boleto:
    if b.status == StatusBoleto.rascunho:
        return atualizar_boleto(db, b, {"data_vencimento": novo})
    if b.status not in (StatusBoleto.em_remessa, StatusBoleto.registrado):
        raise ErroBoleto("Só dá para alterar o vencimento de boleto em aberto no banco.")
    if novo < date.today():
        raise ErroBoleto("O novo vencimento não pode estar no passado.")
    b.instrucao_pendente, b.novo_vencimento = cod.ALTERACAO_VENCIMENTO, novo
    registrar(db, b, "sistema", cod.ALTERACAO_VENCIMENTO, f"Alteração de vencimento para {novo:%d/%m/%Y}: vai na próxima remessa")
    db.flush()
    return b


def desistir_da_instrucao(db: Session, b: Boleto) -> Boleto:
    if not b.instrucao_pendente:
        raise ErroBoleto("Este boleto não tem instrução esperando a remessa.")
    b.instrucao_pendente, b.novo_vencimento = None, None
    registrar(db, b, "sistema", "00", "Instrução cancelada antes de ir para o banco")
    db.flush()
    return b


def registrar(db: Session, b: Boleto | None, origem: str, codigo: str, descricao: str, **k) -> OcorrenciaBoleto:
    oc = OcorrenciaBoleto(tenant_id=(b.tenant_id if b else k.pop("tenant_id")), boleto_id=b.id if b else None,
                          origem=origem, codigo_movimento=codigo, descricao=descricao[:200], **k)
    db.add(oc)
    return oc


# ------------------------------------------------------------------------------------------------ remessa
def _pasta(nome: str) -> Path:
    p = tenancy.pasta_base() / "boletos" / nome
    p.mkdir(parents=True, exist_ok=True)
    return p


def pendentes_de_remessa(db: Session, conv: Convenio) -> list[tuple[Boleto, str]]:
    """(boleto, movimento) do que vai na próxima remessa: entradas novas e instruções."""
    novos = db.scalars(select(Boleto).where(Boleto.convenio_id == conv.id, Boleto.status == StatusBoleto.rascunho)
                       .order_by(Boleto.id)).all()
    instrucoes = db.scalars(select(Boleto).where(Boleto.convenio_id == conv.id, Boleto.instrucao_pendente.is_not(None),
                                                 Boleto.status != StatusBoleto.rascunho).order_by(Boleto.id)).all()
    return [(b, cod.ENTRADA) for b in novos] + [(b, b.instrucao_pendente) for b in instrucoes]


def gerar_remessa(db: Session, conv: Convenio, usuario_id: int | None = None, hoje: date | None = None) -> tuple[ArquivoRemessa, list[dict]]:
    """Gera o .REM com tudo o que está pendente. Devolve a remessa e os boletos que ficaram de fora (com o motivo)."""
    problemas = validar_convenio(conv)
    if problemas:
        raise ErroBoleto("O cadastro do convênio está incompleto: " + problemas[0], problemas)
    banco, dc = banco_do(conv), dados_convenio(conv)
    hoje = hoje or date.today()
    entram: list[tuple[Boleto, str, DadosBoleto]] = []
    fora: list[dict] = []
    for b, movimento in pendentes_de_remessa(db, conv):
        d = dados_boleto(b, movimento)
        erros = banco.validar_boleto(d, dc)
        if erros:
            fora.append({"boleto_id": b.id, "seu_numero": b.seu_numero, "pagador": b.pagador_nome, "erros": erros})
        else:
            entram.append((b, movimento, d))
    if not entram:
        if fora:
            raise ErroBoleto("Nenhum boleto pôde entrar na remessa: " + fora[0]["erros"][0], [e for f in fora for e in f["erros"]])
        raise ErroBoleto("Não há boletos novos nem instruções esperando remessa neste convênio.")

    conv = _travar(db, conv.id)
    sequencial = conv.proximo_sequencial_arquivo
    conv.proximo_sequencial_arquivo = sequencial + 1
    conteudo = banco.gerar_remessa(dc, [d for _, _, d in entram], sequencial, hoje)
    nome = banco.nome_arquivo_remessa(sequencial, hoje)
    destino = _pasta("remessas") / f"conv{conv.id}_{nome}"
    destino.write_bytes(conteudo)
    entradas = [b for b, m, _ in entram if m == cod.ENTRADA]
    rem = ArquivoRemessa(
        tenant_id=conv.tenant_id, convenio_id=conv.id, sequencial=sequencial, gerado_por_id=usuario_id,
        nome_arquivo=nome, arquivo_path=str(destino), qtd_boletos=len(entram),
        valor_total=sum((b.valor for b in entradas), Decimal(0)), hash_sha256=hashlib.sha256(conteudo).hexdigest(),
        ambiente="producao" if conv.homologado else "teste")
    db.add(rem)
    db.flush()
    for b, movimento, _ in entram:
        if movimento == cod.ENTRADA:
            b.status, b.remessa_id = StatusBoleto.em_remessa, rem.id
        else:
            b.instrucao_pendente = None  # o novo vencimento fica guardado até o banco confirmar
        registrar(db, b, "remessa", movimento, f"{cod.MOVIMENTO_REMESSA[movimento]} enviado na remessa {sequencial}",
                  remessa_id=rem.id)
    db.flush()
    return rem, fora


# ------------------------------------------------------------------------------------------------ retorno
def _achar_convenio(db: Session, tenant_id: int, banco: str, agencia: str, conta: str) -> Convenio | None:
    convs = db.scalars(select(Convenio).where(Convenio.tenant_id == tenant_id, Convenio.banco == banco)
                       .order_by(Convenio.ativo.desc(), Convenio.id)).all()
    for c in convs:
        if (c.agencia or "").zfill(4) == (agencia or "").zfill(4) and (c.conta or "").zfill(9) == (conta or "").zfill(9):
            return c
    return convs[0] if len(convs) == 1 else None


def _achar_boleto(db: Session, conv: Convenio, oc: OcorrenciaRetorno) -> Boleto | None:
    if oc.nosso_numero and int(oc.nosso_numero):
        b = db.scalar(select(Boleto).where(Boleto.convenio_id == conv.id, Boleto.nosso_numero == oc.nosso_numero))
        if b:
            return b
    if oc.id_empresa:
        return db.scalar(select(Boleto).where(Boleto.tenant_id == conv.tenant_id, Boleto.id_empresa == oc.id_empresa))
    return None


def _baixar_fatura(db: Session, b: Boleto, conv: Convenio) -> str | None:
    """Liquidação do boleto dá baixa na fatura (e, com ela, na NFS-e e no Financeiro). Devolve um alerta, se houver."""
    f = b.fatura
    if f is None:
        return None
    if f.status == StatusFatura.paga:
        return f"A fatura {f.codigo} já estava paga: confira se não houve pagamento em dobro."
    if f.status != StatusFatura.aberta:
        return f"A fatura {f.codigo} está {f.status.value}: o pagamento do boleto não foi lançado nela."
    quando = b.data_pagamento or date.today()
    if f.nfse:
        n = f.nfse
        n.pago_em, n.valor_pago, n.baixa_origem = quando, b.valor_pago or b.valor, "boleto"
        faturas.sincronizar(db, n)
    else:
        f.status, f.pago_em = StatusFatura.paga, quando
        faturas.salvar_pdf(db, f, nfse_service.config_nfse(db, f.tenant_id))
    faturas.espelhar_no_financeiro(db, f, conv.conta_bancaria_id)
    return None


def _aplicar(db: Session, conv: Convenio, b: Boleto, oc: OcorrenciaRetorno) -> tuple[str, str | None]:
    """Muda o boleto conforme o movimento. Devolve (resultado para o relatório, alerta)."""
    codigo, alerta = oc.codigo_movimento, None
    if oc.tarifa:
        b.tarifa = (b.tarifa or Decimal(0)) + oc.tarifa if codigo in cod.RETORNO_TARIFA else oc.tarifa
    if codigo in cod.RETORNO_REGISTRADO:
        if b.status in (StatusBoleto.rascunho, StatusBoleto.em_remessa, StatusBoleto.rejeitado):
            b.status, b.motivos = StatusBoleto.registrado, []
        if not b.nosso_numero and oc.nosso_numero and int(oc.nosso_numero):  # numeração do banco: chega agora
            b.nosso_numero = oc.nosso_numero
            _calcular_codigos(b, conv)
        return "registrados", None
    if codigo in cod.RETORNO_REJEITADO:
        if b.status in (StatusBoleto.rascunho, StatusBoleto.em_remessa):
            b.status = StatusBoleto.rejeitado
        b.motivos = oc.motivos_descricao
        return "rejeitados", None
    if codigo in cod.RETORNO_PAGO:
        if b.status == StatusBoleto.pago:
            alerta = "O banco informou este pagamento mais de uma vez: confira se o cliente pagou em dobro."
        elif codigo == "17" or b.status in (StatusBoleto.baixado, StatusBoleto.cancelado):
            alerta = "Pagamento recebido depois da baixa do boleto: revise."
        b.status = StatusBoleto.pago
        b.valor_pago, b.valor_liquido = oc.valor_pago or oc.valor, oc.valor_liquido or None
        b.data_pagamento, b.data_credito = oc.data_ocorrencia, oc.data_credito
        b.instrucao_pendente, b.novo_vencimento = None, None
        if b.valor_pago != b.valor:
            diferenca = b.valor_pago - b.valor
            extra = f"Pago R$ {b.valor_pago:.2f} para um boleto de R$ {b.valor:.2f} ({'juros/multa' if diferenca > 0 else 'desconto/abatimento'} de R$ {abs(diferenca):.2f})."
            alerta = f"{alerta} {extra}" if alerta else extra
        aviso_fatura = _baixar_fatura(db, b, conv)
        if aviso_fatura:
            alerta = f"{alerta} {aviso_fatura}" if alerta else aviso_fatura
        return "pagos", alerta
    if codigo in cod.RETORNO_BAIXADO:
        if b.status != StatusBoleto.pago:
            b.status = StatusBoleto.baixado
        b.instrucao_pendente, b.novo_vencimento = None, None
        return "baixados", None
    if codigo in cod.RETORNO_VENCIMENTO_ALTERADO:
        novo = oc.vencimento or b.novo_vencimento
        if novo:
            b.data_vencimento = novo
            _calcular_codigos(b, conv)
        b.novo_vencimento = None
        return "alterados", None
    if codigo in cod.RETORNO_EM_PROTESTO:
        b.status = StatusBoleto.em_protesto
        return "outras", None
    if codigo in cod.RETORNO_PROTESTADO:
        b.status = StatusBoleto.protestado
        return "outras", None
    if codigo in cod.RETORNO_ALERTA:
        b.novo_vencimento = None
        motivos = "; ".join(m["descricao"] for m in oc.motivos_descricao) or "sem motivo informado"
        return "outras", f"{oc.descricao}: {motivos}."
    return "outras", None


def processar_retorno(db: Session, tenant_id: int, conteudo: bytes, nome_arquivo: str, *,
                      convenio_id: int | None = None, usuario_id: int | None = None) -> ArquivoRetorno:
    """Lê o .RET e aplica cada ocorrência. Tudo ou nada: quem chama dá o commit."""
    if not conteudo or not conteudo.strip():
        raise ErroBoleto("O arquivo está vazio.")
    marca = hashlib.sha256(conteudo).hexdigest()
    ja = db.scalar(select(ArquivoRetorno).where(ArquivoRetorno.tenant_id == tenant_id, ArquivoRetorno.hash_sha256 == marca))
    if ja:
        raise ErroBoleto(f"Este arquivo já foi importado em {ja.importado_em:%d/%m/%Y} ({ja.nome_arquivo}). Nada foi alterado.")
    codigo_banco = conteudo[:3].decode("latin-1", "replace")
    try:
        banco = get_banco(codigo_banco)
    except Exception as e:
        raise ErroBoleto(f"Não reconheci o banco deste arquivo ({codigo_banco!r}). Envie o arquivo de retorno CNAB 240 do banco.") from e
    lido = banco.ler_retorno(conteudo)
    conv = db.get(Convenio, convenio_id) if convenio_id else _achar_convenio(db, tenant_id, lido.banco, lido.agencia, lido.conta)
    if conv is None or conv.tenant_id != tenant_id:
        raise ErroBoleto("Não achei o convênio deste retorno (agência e conta não batem com nenhum cadastro). "
                         "Escolha o convênio e importe de novo.")
    if conv.banco != lido.banco:
        raise ErroBoleto("Este arquivo é de outro banco, não o do convênio escolhido.")

    destino = _pasta("retornos") / f"conv{conv.id}_{marca[:12]}_{Path(nome_arquivo or 'retorno.ret').name}"
    destino.write_bytes(conteudo)
    ret = ArquivoRetorno(tenant_id=tenant_id, convenio_id=conv.id, importado_por_id=usuario_id,
                         nome_arquivo=(nome_arquivo or "retorno.ret")[:200], arquivo_path=str(destino), hash_sha256=marca)
    db.add(ret)
    db.flush()

    contagem = dict.fromkeys(("registrados", "rejeitados", "pagos", "baixados", "alterados", "outras", "orfas", "repetidas"), 0)
    linhas: list[dict] = []
    for oc in lido.ocorrencias:
        b = _achar_boleto(db, conv, oc)
        item = {"codigo": oc.codigo_movimento, "descricao": oc.descricao, "nosso_numero": oc.nosso_numero,
                "seu_numero": oc.seu_numero, "pagador": oc.pagador_nome, "valor": str(oc.valor),
                "valor_pago": str(oc.valor_pago) if oc.valor_pago else None,
                "data": oc.data_ocorrencia.isoformat() if oc.data_ocorrencia else None,
                "motivos": oc.motivos_descricao, "boleto_id": b.id if b else None, "resultado": None, "alerta": None}
        if b is None:
            contagem["orfas"] += 1
            item["resultado"] = "orfas"
            item["alerta"] = "Boleto não encontrado no sistema: confira manualmente."
            registrar(db, None, "retorno", oc.codigo_movimento, oc.descricao, tenant_id=tenant_id, retorno_id=ret.id,
                      motivos=oc.motivos_descricao, data_ocorrencia=oc.data_ocorrencia, valor_pago=oc.valor_pago or None,
                      nosso_numero=oc.nosso_numero or None, alerta=item["alerta"], payload_bruto=oc.payload_bruto)
            linhas.append(item)
            continue
        repetida = db.scalar(select(func.count()).select_from(OcorrenciaBoleto).where(
            OcorrenciaBoleto.boleto_id == b.id, OcorrenciaBoleto.origem == "retorno",
            OcorrenciaBoleto.codigo_movimento == oc.codigo_movimento,
            OcorrenciaBoleto.data_ocorrencia == oc.data_ocorrencia if oc.data_ocorrencia else OcorrenciaBoleto.data_ocorrencia.is_(None)))
        if repetida:
            contagem["repetidas"] += 1
            item["resultado"] = "repetidas"
            linhas.append(item)
            continue
        resultado, alerta = _aplicar(db, conv, b, oc)
        contagem[resultado] += 1
        item["resultado"], item["alerta"] = resultado, alerta
        registrar(db, b, "retorno", oc.codigo_movimento, oc.descricao, retorno_id=ret.id, motivos=oc.motivos_descricao,
                  data_ocorrencia=oc.data_ocorrencia, valor_pago=oc.valor_pago or None, nosso_numero=oc.nosso_numero or None,
                  alerta=alerta[:300] if alerta else None, payload_bruto=oc.payload_bruto)
        db.flush()
        linhas.append(item)

    ret.qtd_ocorrencias, ret.qtd_orfas = len(lido.ocorrencias), contagem["orfas"]
    ret.resumo = {"contagem": contagem, "avisos": lido.avisos, "linhas": linhas,
                  "data_arquivo": lido.data_geracao.isoformat() if lido.data_geracao else None,
                  "sequencial": lido.sequencial_arquivo}
    db.flush()
    return ret
