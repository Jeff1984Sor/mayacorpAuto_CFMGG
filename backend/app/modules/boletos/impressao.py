"""Do boleto gravado ao PDF: junta convênio, banco e beneficiário e chama o desenho."""

from decimal import Decimal

from app.core.documentos import formatar_documento
from app.modules.boletos import service
from app.modules.boletos.bancos.registry import get_banco
from app.modules.boletos.boleto_pdf.render import BoletoImpresso, gerar_pdf
from app.modules.boletos.models import Boleto, StatusBoleto

AVISO_SEM_REGISTRO = "AGUARDANDO REGISTRO NO BANCO - NÃO ENVIE AO PAGADOR AINDA"
AVISOS = {
    StatusBoleto.rascunho: AVISO_SEM_REGISTRO,
    StatusBoleto.em_remessa: AVISO_SEM_REGISTRO,
    StatusBoleto.rejeitado: "BOLETO REJEITADO PELO BANCO - NÃO VALE PARA PAGAMENTO",
    StatusBoleto.cancelado: "BOLETO CANCELADO",
    StatusBoleto.baixado: "BOLETO BAIXADO - NÃO VALE PARA PAGAMENTO",
    StatusBoleto.pago: "BOLETO JÁ PAGO",
}


def _pct(v) -> str:
    return f"{Decimal(v):.2f}".replace(".", ",")


def instrucoes(b: Boleto) -> list[str]:
    conv = b.convenio
    linhas: list[str] = []
    if b.descricao:
        linhas.append(b.descricao)
    if Decimal(conv.multa_pct or 0) > 0:
        linhas.append(f"Após o vencimento, multa de {_pct(conv.multa_pct)}%.")
    if conv.codigo_juros != "3" and Decimal(conv.juros_mensal_pct or 0) > 0:
        linhas.append(f"Após o vencimento, juros de {_pct(conv.juros_mensal_pct)}% ao mês.")
    linhas += [x for x in (conv.mensagem_1, conv.mensagem_2) if x]
    linhas += [ln.strip() for ln in (conv.instrucoes or "").splitlines() if ln.strip()]
    return linhas


def imprimir(b: Boleto) -> bytes:
    conv = b.convenio
    banco = get_banco(conv.banco)
    dc = service.dados_convenio(conv)
    e = conv.emissora
    cep = b.pagador_cep or ""
    cidade = f"{b.pagador_cidade} - {b.pagador_uf}"
    return gerar_pdf(BoletoImpresso(
        banco_nome=f"Banco {banco.nome_curto}", banco_codigo=banco.codigo_com_dv,
        linha_digitavel=banco.formatar_linha_digitavel(b.linha_digitavel), codigo_barras=b.codigo_barras,
        local_pagamento=banco.local_pagamento, beneficiario_nome=dc.beneficiario_nome,
        beneficiario_documento=formatar_documento(dc.beneficiario_documento),
        beneficiario_endereco=", ".join(x for x in [e.logradouro, e.numero, e.cidade, e.uf] if x) if e else "",
        agencia_codigo=banco.agencia_codigo_beneficiario(dc), nosso_numero=banco.formatar_nosso_numero(b.nosso_numero or ""),
        carteira=conv.carteira, especie_documento=getattr(banco, "sigla_especie", lambda _: "DS")(conv.especie_titulo),
        aceite=conv.aceite or "N", numero_documento=b.seu_numero, data_documento=b.data_emissao,
        data_processamento=b.data_emissao, vencimento=b.data_vencimento, valor=b.valor,
        pagador_nome=b.pagador_nome, pagador_documento=formatar_documento(b.pagador_documento),
        pagador_endereco=" - ".join(x for x in [b.pagador_endereco, b.pagador_bairro] if x),
        pagador_cidade=f"{cep[:5]}-{cep[5:]} {cidade}" if len(cep) == 8 else cidade,
        instrucoes=instrucoes(b), aviso=AVISOS.get(b.status, "")))
