"""Gera o arquivo de remessa (.REM) do Santander.

    Header de arquivo
      Header de lote
        P + Q [+ R] [+ Y-03]   por boleto
      Trailer de lote
    Trailer de arquivo
"""

from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.modules.boletos.bancos.base import DadosBoleto, DadosConvenio
from app.modules.boletos.bancos.santander import codigos as cod
from app.modules.boletos.bancos.santander import layout as L
from app.modules.boletos.cnab.exceptions import CnabError
from app.modules.boletos.cnab.validators import conferir_estrutura, juntar

CENTAVO = Decimal("0.01")


def _tipo_inscricao(documento: str) -> int:
    return 1 if len(documento) == 11 else 2


def _juros(convenio: DadosConvenio, boleto: DadosBoleto) -> tuple[str, date | None, Decimal]:
    """(código, data, valor) dos juros de mora. Sem taxa (ou valor por dia que arredonda para zero) = isento."""
    taxa = Decimal(convenio.juros_mensal_pct or 0)
    if convenio.codigo_juros == "3" or taxa <= 0:
        return "3", None, Decimal(0)
    inicio = boleto.data_vencimento + timedelta(days=1)
    if convenio.codigo_juros == "1":  # valor em reais por dia de atraso
        por_dia = (boleto.valor * taxa / 100 / 30).quantize(CENTAVO, rounding=ROUND_HALF_UP)
        return ("1", inicio, por_dia) if por_dia > 0 else ("3", None, Decimal(0))
    return "2", inicio, taxa.quantize(CENTAVO, rounding=ROUND_HALF_UP)


def tem_segmento_r(convenio: DadosConvenio, boleto: DadosBoleto) -> bool:
    return Decimal(convenio.multa_pct or 0) > 0 or bool((boleto.mensagem_3 or "").strip() or (boleto.mensagem_4 or "").strip())


def tem_segmento_y03(convenio: DadosConvenio, boleto: DadosBoleto) -> bool:
    return bool(convenio.pix_habilitado and convenio.pix_chave and boleto.txid)


def segmentos_do_boleto(convenio: DadosConvenio, boleto: DadosBoleto, sequencial: int) -> list[str]:
    """Linhas de um boleto, numeradas a partir de `sequencial`."""
    if boleto.movimento not in cod.MOVIMENTOS_IMPLEMENTADOS:
        raise CnabError(f"Movimento {boleto.movimento} ainda não é gerado pelo sistema.")
    codigo_juros, data_juros, juros = _juros(convenio, boleto)
    com_desconto = Decimal(boleto.desconto_valor or 0) > 0 and boleto.desconto_data is not None
    protesta = convenio.codigo_protesto in ("1", "2")
    cep = (boleto.pagador_cep or "").zfill(8)
    linhas = [L.SegmentoP.montar(
        sequencial=sequencial,
        codigo_movimento=boleto.movimento,
        agencia=convenio.agencia, agencia_dv=convenio.agencia_dv,
        conta=convenio.conta, conta_dv=convenio.conta_dv,
        conta_fidc=0, conta_fidc_dv=0,
        nosso_numero=boleto.nosso_numero if convenio.numeracao == "EMPRESA" else 0,
        tipo_cobranca=convenio.tipo_cobranca,
        forma_cadastramento=convenio.forma_cadastramento,
        tipo_documento=convenio.tipo_documento,
        seu_numero=boleto.seu_numero,
        vencimento=boleto.data_vencimento,
        valor=boleto.valor,
        agencia_fidc=0, agencia_fidc_dv=0,
        especie=convenio.especie_titulo,
        aceite=convenio.aceite or "N",
        data_emissao=boleto.data_emissao,
        codigo_juros=codigo_juros, data_juros=data_juros, juros=juros,
        codigo_desconto_1="1" if com_desconto else "0",
        data_desconto_1=boleto.desconto_data if com_desconto else None,
        desconto_1=boleto.desconto_valor if com_desconto else Decimal(0),
        iof=Decimal(0),
        abatimento=boleto.abatimento or Decimal(0),
        id_empresa=boleto.id_empresa,
        codigo_protesto=convenio.codigo_protesto,
        dias_protesto=convenio.dias_protesto if protesta else 0,
        codigo_baixa=convenio.codigo_baixa,
        dias_baixa=convenio.dias_baixa if convenio.codigo_baixa == "1" else 0,
    ), L.SegmentoQ.montar(
        sequencial=sequencial + 1,
        codigo_movimento=boleto.movimento,
        pagador_tipo_inscricao=_tipo_inscricao(boleto.pagador_documento),
        pagador_inscricao=boleto.pagador_documento,
        pagador_nome=boleto.pagador_nome,
        pagador_endereco=boleto.pagador_endereco,
        pagador_bairro=boleto.pagador_bairro,
        pagador_cep=cep[:5], pagador_cep_sufixo=cep[5:],
        pagador_cidade=boleto.pagador_cidade,
        pagador_uf=boleto.pagador_uf,
        sacador_tipo_inscricao=0, sacador_inscricao=0, sacador_nome="",
        reservado_1=0, reservado_2=0, reservado_3=0, reservado_4=0,
    )]
    if tem_segmento_r(convenio, boleto):
        multa = Decimal(convenio.multa_pct or 0)
        linhas.append(L.SegmentoR.montar(
            sequencial=sequencial + len(linhas),
            codigo_movimento=boleto.movimento,
            codigo_desconto_2=0, data_desconto_2=None, desconto_2=Decimal(0),
            codigo_desconto_3=0, data_desconto_3=None, desconto_3=Decimal(0),
            codigo_multa="2" if multa > 0 else "0",
            data_multa=boleto.data_vencimento + timedelta(days=1) if multa > 0 else None,
            multa=multa.quantize(CENTAVO, rounding=ROUND_HALF_UP),
            mensagem_3=boleto.mensagem_3, mensagem_4=boleto.mensagem_4,
        ))
    if tem_segmento_y03(convenio, boleto):
        linhas.append(L.SegmentoY03.montar(
            sequencial=sequencial + len(linhas),
            codigo_movimento=boleto.movimento,
            pix_tipo_chave=convenio.pix_chave_tipo, pix_chave=convenio.pix_chave, txid=boleto.txid,
        ))
    return linhas


def gerar_remessa(convenio: DadosConvenio, boletos: list[DadosBoleto], sequencial_arquivo: int,
                  data_geracao: date | None = None) -> bytes:
    if not boletos:
        raise CnabError("Não há boletos para a remessa.")
    hoje = data_geracao or date.today()
    tipo = _tipo_inscricao(convenio.beneficiario_documento)
    linhas = [
        L.HeaderArquivo.montar(
            tipo_inscricao=tipo, inscricao=convenio.beneficiario_documento,
            codigo_transmissao=convenio.codigo_transmissao, nome_empresa=convenio.beneficiario_nome,
            data_geracao=hoje, sequencial_arquivo=sequencial_arquivo),
        L.HeaderLote.montar(
            tipo_inscricao=tipo, inscricao=convenio.beneficiario_documento,
            codigo_transmissao=convenio.codigo_transmissao, nome_beneficiario=convenio.beneficiario_nome,
            mensagem_1=convenio.mensagem_1, mensagem_2=convenio.mensagem_2,
            numero_remessa=sequencial_arquivo, data_gravacao=hoje),
    ]
    sequencial = 1
    for boleto in boletos:
        novos = segmentos_do_boleto(convenio, boleto, sequencial)
        linhas += novos
        sequencial += len(novos)
    detalhes = sequencial - 1
    linhas.append(L.TrailerLote.montar(qtd_registros=detalhes + 2))  # + header e trailer do lote
    linhas.append(L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=len(linhas) + 1))
    conferir_estrutura(linhas)  # o arquivo só sai se as contagens fecharem
    return juntar(linhas)


def nome_arquivo(sequencial_arquivo: int, data_geracao: date) -> str:
    return f"COB_033_{data_geracao:%d%m%y}_{sequencial_arquivo:06d}.REM"
