"""Transporte SOAP com TLS mútuo (certificado A1) e interpretação dos retornos.

Três modos (Configurações › Prefeitura, tabela config_nfse):
  simulado  — nenhuma chamada externa; respostas geradas pelo simulador
  teste     — "Teste de envio de lote": a Prefeitura valida tudo e não gera nota
  producao  — emissão real
"""

import logging
import os
import ssl
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from xml.sax.saxutils import escape

import httpx
from cryptography.hazmat.primitives import serialization
from lxml import etree

from app.core import certificados
from app.core.certificados import CertificadoCarregado
from app.core.config import settings
from app.modules.rpa_nfse.prefeitura_sp import simulador, xml_layout2
from app.modules.rpa_nfse.prefeitura_sp.erros import humanizar

log = logging.getLogger(__name__)

SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/"
# SOAPAction de cada operação, como no WSDL de lotenfe.asmx. Com o nome "pelado" o IIS da
# Prefeitura nem reconhece o pedido e devolve a página genérica de erro 500.
ACOES = {
    "EnvioLoteRPS": "http://www.prefeitura.sp.gov.br/nfe/ws/envioLoteRPS",
    "TesteEnvioLoteRPS": "http://www.prefeitura.sp.gov.br/nfe/ws/testeenvio",
    "CancelamentoNFe": "http://www.prefeitura.sp.gov.br/nfe/ws/cancelamentoNFe",
    "ConsultaNFe": "http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFe",
    "ConsultaCNPJ": "http://www.prefeitura.sp.gov.br/nfe/ws/consultaCNPJ",
}


class FalhaComunicacao(Exception):
    """Timeout / indisponibilidade — diferente de rejeição; o robô tenta de novo."""


@dataclass
class ErroRetorno:
    codigo: int | None
    descricao: str
    serie: str | None = None
    numero: int | None = None

    def humano(self) -> dict:
        h = humanizar(self.codigo, self.descricao)
        return {
            "campo": h.campo or "prefeitura",
            "nivel": "erro",
            "mensagem": h.mensagem,
            "acao": h.acao,
            "codigo": self.codigo,
            "tecnico": self.descricao,
        }


@dataclass
class NotaRetorno:
    serie: str
    numero_rps: int
    numero_nfe: int
    cod_verificacao: str
    emitida_em: datetime | None = None


@dataclass
class Retorno:
    sucesso: bool
    notas: list[NotaRetorno] = field(default_factory=list)
    erros: list[ErroRetorno] = field(default_factory=list)
    alertas: list[ErroRetorno] = field(default_factory=list)
    xml: bytes = b""
    simulado: bool = False


def _envelope(metodo: str, mensagem: bytes, versao: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        f'<soap:Envelope xmlns:soap="{SOAP_NS}"><soap:Body>'
        f'<{metodo}Request xmlns="http://www.prefeitura.sp.gov.br/nfe">'
        f"<VersaoSchema>{versao}</VersaoSchema>"
        f"<MensagemXML>{escape(mensagem.decode('utf-8'))}</MensagemXML>"
        f"</{metodo}Request></soap:Body></soap:Envelope>"
    ).encode()


def _ssl_context(cert: CertificadoCarregado) -> ssl.SSLContext:
    """O ssl do Python só carrega cadeia a partir de arquivo: grava PEM temporário e apaga em seguida."""
    ctx = ssl.create_default_context()
    pem = cert.cert.public_bytes(serialization.Encoding.PEM) + b"".join(
        c.public_bytes(serialization.Encoding.PEM) for c in cert.cadeia
    )
    key = cert.chave.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    fd, caminho = tempfile.mkstemp(suffix=".pem")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(pem + key)
        ctx.load_cert_chain(caminho)
    finally:
        os.remove(caminho)
    return ctx


def _local(el: etree._Element) -> str:
    return etree.QName(el).localname


def _filho(el: etree._Element, nome: str) -> etree._Element | None:
    for c in el:
        if isinstance(c.tag, str) and _local(c) == nome:
            return c
    return None


def _texto(el: etree._Element | None, *caminho: str) -> str | None:
    for nome in caminho:
        if el is None:
            return None
        el = _filho(el, nome)
    return el.text.strip() if el is not None and el.text else None


def interpretar(retorno_xml: bytes) -> Retorno:
    raiz = etree.fromstring(retorno_xml)
    sucesso = (_texto(raiz, "Cabecalho", "Sucesso") or "").lower() == "true"
    r = Retorno(sucesso=sucesso, xml=retorno_xml)

    def ler_erro(e: etree._Element) -> ErroRetorno:
        cod = _texto(e, "Codigo")
        return ErroRetorno(
            codigo=int(cod) if cod and cod.isdigit() else None,
            descricao=_texto(e, "Descricao") or "",
            serie=_texto(e, "ChaveRPS", "SerieRPS"),
            numero=int(n) if (n := _texto(e, "ChaveRPS", "NumeroRPS")) else None,
        )

    for el in raiz:
        if not isinstance(el.tag, str):
            continue
        nome = _local(el)
        if nome == "Erro":
            r.erros.append(ler_erro(el))
        elif nome == "Alerta":
            r.alertas.append(ler_erro(el))
        elif nome == "ChaveNFeRPS":
            r.notas.append(
                NotaRetorno(
                    serie=_texto(el, "ChaveRPS", "SerieRPS") or "",
                    numero_rps=int(_texto(el, "ChaveRPS", "NumeroRPS") or 0),
                    numero_nfe=int(_texto(el, "ChaveNFe", "NumeroNFe") or 0),
                    cod_verificacao=_texto(el, "ChaveNFe", "CodigoVerificacao") or "",
                )
            )
    return r


class ClientePrefeitura:
    def __init__(self, cert: CertificadoCarregado | None, modo: str):
        self.modo = modo
        if self.modo != "simulado" and cert is None:
            raise ValueError("Certificado obrigatório fora do modo simulado.")
        self.cert = cert or certificados.certificado_de_simulacao()

    # ---------- transporte ----------
    def _chamar(self, metodo: str, raiz: etree._Element, versao: str = "1") -> bytes:
        corpo = _envelope(metodo, xml_layout2.para_bytes(raiz), versao)
        headers = {"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ACOES[metodo]}
        # O endereço antigo não aceita o layout 2; o novo (nfews) atende os dois.
        url = settings.prefeitura_url_v2 if versao == "2" else settings.prefeitura_url
        espera = 2.0
        ultimo: Exception | None = None
        for tentativa in range(1, settings.prefeitura_tentativas + 1):
            try:
                with httpx.Client(verify=_ssl_context(self.cert), timeout=settings.prefeitura_timeout) as c:
                    resp = c.post(url, content=corpo, headers=headers)
                ret = None
                try:
                    env = etree.fromstring(resp.content)
                    ret = next((e for e in env.iter() if isinstance(e.tag, str) and _local(e) == "RetornoXML"), None)
                except etree.XMLSyntaxError:
                    pass
                if ret is not None and ret.text:
                    return ret.text.encode("utf-8")
                # Sem RetornoXML: devolve o texto que a Prefeitura mandou, não só o código HTTP
                texto = " ".join(etree.HTML(resp.content).itertext()).split() if resp.content else []
                msg = f"HTTP {resp.status_code} da Prefeitura: {' '.join(texto)[:400]}"
                if resp.status_code >= 500 or resp.status_code == 429:
                    raise FalhaComunicacao(msg)
                raise RuntimeError(msg)
            except (httpx.TransportError, FalhaComunicacao) as e:
                ultimo = e
                log.warning("Prefeitura instável (%s), tentativa %s", e, tentativa)
                time.sleep(espera)
                espera *= 2  # intervalo crescente
        raise FalhaComunicacao(str(ultimo))

    # ---------- métodos ----------
    def enviar_lote(self, *, cnpj: str, ccm: str, rps: list[xml_layout2.RpsXml], teste: bool) -> Retorno:
        pedido = xml_layout2.pedido_envio_lote(cnpj_remetente=cnpj, ccm=ccm, rps=rps, cert=self.cert)
        erros_xsd = xml_layout2.validar_xsd(pedido, "PedidoEnvioLoteRPS_v02.xsd")
        if erros_xsd:
            return Retorno(
                sucesso=False,
                erros=[ErroRetorno(None, f"XML fora do schema oficial: {e}") for e in erros_xsd[:10]],
                xml=xml_layout2.para_bytes(pedido),
            )
        if self.modo == "simulado":
            return _simulado(interpretar(simulador.envio_lote(pedido, teste=teste)))
        metodo = "TesteEnvioLoteRPS" if teste or self.modo == "teste" else "EnvioLoteRPS"
        return interpretar(self._chamar(metodo, pedido, xml_layout2.VERSAO))

    def consultar_por_rps(self, *, cnpj: str, ccm: str, serie: str, numero: int) -> NotaRetorno | None:
        if self.modo == "simulado":
            return None
        pedido = xml_layout2.pedido_consulta_nfe_por_rps(
            cnpj_remetente=cnpj, ccm=ccm, serie=serie, numero=numero, cert=self.cert
        )
        raiz = etree.fromstring(self._chamar("ConsultaNFe", pedido))
        nfe = next((e for e in raiz.iter() if isinstance(e.tag, str) and _local(e) == "NFe"), None)
        if nfe is None:
            return None
        return NotaRetorno(
            serie=serie,
            numero_rps=numero,
            numero_nfe=int(_texto(nfe, "ChaveNFe", "NumeroNFe") or 0),
            cod_verificacao=_texto(nfe, "ChaveNFe", "CodigoVerificacao") or "",
        )

    def cancelar(self, *, cnpj: str, ccm: str, numero_nfe: int) -> Retorno:
        pedido = xml_layout2.pedido_cancelamento(cnpj_remetente=cnpj, ccm=ccm, numero_nfe=numero_nfe, cert=self.cert)
        if self.modo == "simulado":
            return _simulado(interpretar(simulador.sucesso()))
        if self.modo == "teste":
            return Retorno(sucesso=False, erros=[ErroRetorno(None, "Cancelamento indisponível no modo teste.")])
        return interpretar(self._chamar("CancelamentoNFe", pedido))

    def consultar_cnpj(self, *, cnpj_remetente: str, cnpj: str) -> Retorno:
        pedido = xml_layout2.pedido_consulta_cnpj(cnpj_remetente=cnpj_remetente, cnpj=cnpj, cert=self.cert)
        if self.modo == "simulado":
            return _simulado(interpretar(simulador.sucesso()))
        return interpretar(self._chamar("ConsultaCNPJ", pedido))



def _simulado(r: Retorno) -> Retorno:
    r.simulado = True
    return r
