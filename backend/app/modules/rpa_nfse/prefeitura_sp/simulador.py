"""Simulador do Web Service da Prefeitura — usado em desenvolvimento e demonstração.

Responde no mesmo formato do retorno oficial. Regras de rejeição propositais para exercitar o fluxo:
- tomador com CNPJ/CPF inválido → erro 1101/1102
- discriminação contendo "[REJEITAR]" → erro 1211
"""

import random
import string

from lxml import etree

from app.core.documentos import cnpj_valido, cpf_valido

NS = "http://www.prefeitura.sp.gov.br/nfe"
_contador = [random.randint(10_000, 20_000)]


def _l(el):
    return etree.QName(el).localname


def _txt(el, *nomes):
    for n in nomes:
        el = next((c for c in el if isinstance(c.tag, str) and _l(c) == n), None)
        if el is None:
            return None
    return el.text


def _retorno(sucesso: bool, filhos: list[str]) -> bytes:
    return (
        f'<RetornoEnvioLoteRPS xmlns="{NS}"><Cabecalho Versao="2" xmlns="">'
        f"<Sucesso>{'true' if sucesso else 'false'}</Sucesso></Cabecalho>{''.join(filhos)}</RetornoEnvioLoteRPS>"
    ).encode()


def sucesso() -> bytes:
    return _retorno(True, [])


def envio_lote(pedido: etree._Element, teste: bool) -> bytes:
    filhos: list[str] = []
    algum_erro = False
    for rps in (c for c in pedido if isinstance(c.tag, str) and _l(c) == "RPS"):
        serie = _txt(rps, "ChaveRPS", "SerieRPS")
        numero = _txt(rps, "ChaveRPS", "NumeroRPS")
        chave = f"<ChaveRPS><SerieRPS>{serie}</SerieRPS><NumeroRPS>{numero}</NumeroRPS></ChaveRPS>"
        cnpj = _txt(rps, "CPFCNPJTomador", "CNPJ")
        cpf = _txt(rps, "CPFCNPJTomador", "CPF")
        erro = None
        if cnpj and not cnpj_valido(cnpj):
            erro = (1101, "CNPJ do tomador inválido.")
        elif cpf and not cpf_valido(cpf):
            erro = (1102, "CPF do tomador inválido.")
        elif "[REJEITAR]" in (_txt(rps, "Discriminacao") or ""):
            erro = (1211, "Código de serviço não permitido para o prestador.")
        if erro:
            algum_erro = True
            filhos.append(f"<Erro xmlns=''><Codigo>{erro[0]}</Codigo><Descricao>{erro[1]}</Descricao>{chave}</Erro>")
            continue
        if teste:
            continue
        _contador[0] += 1
        cod = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        filhos.append(
            f"<ChaveNFeRPS xmlns=''><ChaveNFe><InscricaoPrestador>{_txt(rps, 'ChaveRPS', 'InscricaoPrestador')}"
            f"</InscricaoPrestador><NumeroNFe>{_contador[0]}</NumeroNFe><CodigoVerificacao>{cod}</CodigoVerificacao>"
            f"</ChaveNFe>{chave}</ChaveNFeRPS>"
        )
    return _retorno(not algum_erro, filhos)
