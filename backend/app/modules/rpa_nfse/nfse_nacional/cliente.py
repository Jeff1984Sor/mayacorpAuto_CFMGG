"""Conversa com o Sistema Nacional NFS-e (Sefin Nacional e ADN): emitir, consultar, cancelar e baixar a DANFSe.

A conexão exige o certificado digital do emissor (TLS mútuo); as mensagens são JSON com o XML compactado (GZip)
em Base64. Endereços publicados em gov.br/nfse › Documentação técnica › APIs (produção restrita e produção).
"""

import base64
import gzip
import logging
import time
from dataclasses import dataclass, field

import httpx
from lxml import etree

from app.core.certificados import CertificadoCarregado
from app.modules.rpa_nfse.prefeitura_sp.cliente import FalhaComunicacao, _ssl_context

log = logging.getLogger(__name__)

ENDERECOS = {
    # modo "producao": notas de verdade
    "producao": {"sefin": "https://sefin.nfse.gov.br/SefinNacional", "adn": "https://adn.nfse.gov.br"},
    # modo "teste": produção restrita (homologação do governo; não gera nota válida)
    "teste": {"sefin": "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
              "adn": "https://adn.producaorestrita.nfse.gov.br"},
}
AMBIENTE = {"producao": "1", "teste": "2", "simulado": "2"}
TENTATIVAS = 3
TIMEOUT = 45.0
TIMEOUT_DANFSE = httpx.Timeout(8.0, connect=4.0)  # o PDF oficial é um extra: não segura quem está baixando a nota


@dataclass
class ErroNacional:
    codigo: str | None
    descricao: str
    complemento: str | None = None

    def humano(self) -> dict:
        from app.modules.rpa_nfse.nfse_nacional.erros import traduzir

        return traduzir(self.codigo, self.descricao, self.complemento)


@dataclass
class RetornoNacional:
    sucesso: bool
    chave_acesso: str | None = None
    numero: int | None = None
    id_dps: str | None = None
    xml: bytes | None = None  # XML da NFS-e (ou do evento) devolvido pelo governo
    erros: list[ErroNacional] = field(default_factory=list)
    alertas: list[ErroNacional] = field(default_factory=list)
    simulado: bool = False
    http: int | None = None


def compactar(xml: bytes) -> str:
    return base64.b64encode(gzip.compress(xml)).decode("ascii")


def descompactar(b64: str) -> bytes:
    return gzip.decompress(base64.b64decode(b64))


def _campo(d: dict, *nomes: str):
    """O governo alterna maiúsculas e minúsculas entre serviços ("codigo"/"Codigo"): procura sem diferenciar."""
    baixo = {str(k).lower(): v for k, v in (d or {}).items()}
    for n in nomes:
        if n.lower() in baixo and baixo[n.lower()] not in (None, ""):
            return baixo[n.lower()]
    return None


def _erros(lista) -> list[ErroNacional]:
    saida = []
    for e in lista or []:
        if isinstance(e, dict):
            saida.append(ErroNacional(codigo=str(_campo(e, "codigo") or "") or None,
                                      descricao=str(_campo(e, "descricao", "mensagem") or "Erro sem descrição"),
                                      complemento=_campo(e, "complemento")))
        else:
            saida.append(ErroNacional(None, str(e)))
    return saida


def numero_da_nfse(xml: bytes) -> int | None:
    """Número da NFS-e (nNFSe) dentro do XML devolvido."""
    try:
        raiz = etree.fromstring(xml)
    except etree.XMLSyntaxError:
        return None
    for el in raiz.iter():
        if isinstance(el.tag, str) and etree.QName(el).localname == "nNFSe" and (el.text or "").strip().isdigit():
            return int(el.text.strip())
    return None


def interpretar(status: int, corpo: dict | None) -> RetornoNacional:
    corpo = corpo or {}
    erros = _erros(_campo(corpo, "erros") or ([_campo(corpo, "erro")] if _campo(corpo, "erro") else []))
    alertas = _erros(_campo(corpo, "alertas"))
    chave = _campo(corpo, "chaveAcesso")
    b64 = _campo(corpo, "nfseXmlGZipB64", "eventoXmlGZipB64")
    xml = None
    if b64:
        try:
            xml = descompactar(b64)
        except (OSError, ValueError):
            xml = None
    sucesso = status in (200, 201) and not erros and bool(chave or xml)
    if not sucesso and not erros:
        erros = [ErroNacional(None, str(_campo(corpo, "mensagem", "message", "title", "detail")
                                        or f"O Sistema Nacional respondeu HTTP {status} sem explicar o motivo."))]
    return RetornoNacional(sucesso=sucesso, chave_acesso=str(chave) if chave else None, id_dps=_campo(corpo, "idDps", "idDPS"),
                           numero=numero_da_nfse(xml) if xml else None, xml=xml, erros=erros, alertas=alertas, http=status)


class ClienteNacional:
    """`modo`: producao | teste (produção restrita) | simulado (não chama ninguém)."""

    transporte: httpx.BaseTransport | None = None  # os testes trocam por um httpx.MockTransport

    def __init__(self, cert: CertificadoCarregado | None, modo: str):
        if modo not in ("producao", "teste", "simulado"):
            raise ValueError(f"Modo '{modo}' desconhecido.")
        if modo != "simulado" and cert is None:
            raise RuntimeError("Sem certificado digital não há como falar com o Sistema Nacional NFS-e.")
        self.cert, self.modo = cert, modo

    @property
    def ambiente(self) -> str:
        return AMBIENTE[self.modo]

    def _url(self, servico: str, caminho: str) -> str:
        return ENDERECOS[self.modo][servico] + caminho

    def _chamar(self, metodo: str, url: str, corpo: dict | None = None) -> httpx.Response:
        espera, ultimo = 2.0, None
        for tentativa in range(1, TENTATIVAS + 1):
            try:
                with httpx.Client(verify=_ssl_context(self.cert), timeout=TIMEOUT) as c:
                    resp = c.request(metodo, url, json=corpo, headers={"Accept": "application/json"})
                if resp.status_code >= 500 or resp.status_code == 429:
                    raise FalhaComunicacao(f"HTTP {resp.status_code} do Sistema Nacional: {resp.text[:300]}")
                return resp
            except (httpx.TransportError, FalhaComunicacao) as e:
                ultimo = e
                log.warning("Sistema Nacional NFS-e instável (%s), tentativa %s", e, tentativa)
                if tentativa < TENTATIVAS:
                    time.sleep(espera)
                    espera *= 2
        raise FalhaComunicacao(str(ultimo))

    @staticmethod
    def _json(resp: httpx.Response) -> dict | None:
        try:
            dados = resp.json()
        except ValueError:
            return {"mensagem": resp.text[:400]} if resp.text else None
        return dados if isinstance(dados, dict) else {"erros": dados} if isinstance(dados, list) else None

    # ------------------------------------------------------------------ emissão
    def emitir(self, dps_xml: bytes) -> RetornoNacional:
        if self.modo == "simulado":
            from app.modules.rpa_nfse.nfse_nacional import simulador

            return simulador.emitir(dps_xml)
        resp = self._chamar("POST", self._url("sefin", "/nfse"), {"dpsXmlGZipB64": compactar(dps_xml)})
        return interpretar(resp.status_code, self._json(resp))

    def chave_da_dps(self, id_dps: str) -> str | None:
        """Depois de uma falha de comunicação: a DPS virou nota? Devolve a chave de acesso, se virou."""
        if self.modo == "simulado":
            return None
        # o serviço quer só os 42 números, sem o prefixo "DPS" (confirmado na produção restrita em 27/11/2026)
        resp = self._chamar("GET", self._url("sefin", f"/dps/{id_dps.removeprefix('DPS')}"))
        if resp.status_code != 200:
            return None
        chave = _campo(self._json(resp) or {}, "chaveAcesso")
        return str(chave) if chave else None

    def consultar(self, chave_acesso: str) -> RetornoNacional:
        if self.modo == "simulado":
            return RetornoNacional(sucesso=False, erros=[ErroNacional(None, "Consulta indisponível no modo simulado.")], simulado=True)
        resp = self._chamar("GET", self._url("sefin", f"/nfse/{chave_acesso}"))
        ret = interpretar(resp.status_code, self._json(resp))
        ret.chave_acesso = ret.chave_acesso or chave_acesso
        return ret

    # ------------------------------------------------------------------ cancelamento
    def cancelar(self, chave_acesso: str, pedido_xml: bytes) -> RetornoNacional:
        if self.modo == "simulado":
            return RetornoNacional(sucesso=True, chave_acesso=chave_acesso, simulado=True)
        resp = self._chamar("POST", self._url("sefin", f"/nfse/{chave_acesso}/eventos"),
                            {"pedidoRegistroEventoXmlGZipB64": compactar(pedido_xml)})
        ret = interpretar(resp.status_code, self._json(resp))
        ret.chave_acesso = ret.chave_acesso or chave_acesso
        if resp.status_code in (200, 201) and not ret.erros:
            ret.sucesso = True
        return ret

    # ------------------------------------------------------------------ DANFSe (o PDF oficial)
    def danfse(self, chave_acesso: str) -> bytes | None:
        """PDF oficial pela chave de acesso: `GET {adn}/danfse/{chave}`, só em produção (na produção restrita não
        responde). Uma tentativa só, com tempo curto: quem chama tem o PDF do próprio sistema como plano B, então
        qualquer falha (tempo, 4xx/5xx, resposta que não é PDF) vira None e um aviso no log.

        A Nota Técnica SE/CGNFS-e nº 008/2026 anunciou a suspensão desta API (os sistemas emissores passam a
        gerar o DANFSe): se ela estiver mesmo fora do ar, a resposta é sempre None e vale o PDF do sistema.
        """
        if self.modo != "producao":
            return None
        try:
            with httpx.Client(verify=_ssl_context(self.cert), timeout=TIMEOUT_DANFSE, transport=self.transporte) as c:
                resp = c.get(self._url("adn", f"/danfse/{chave_acesso}"), headers={"Accept": "application/pdf"})
        except (httpx.HTTPError, OSError) as e:
            log.warning("DANFSe oficial da nota %s não veio (%s: %s); fica o PDF do sistema.", chave_acesso, type(e).__name__, e)
            return None
        if resp.status_code != 200 or not resp.content.startswith(b"%PDF-"):
            log.warning("DANFSe oficial da nota %s não veio (HTTP %s, %s); fica o PDF do sistema.", chave_acesso,
                        resp.status_code, resp.headers.get("content-type") or "sem tipo")
            return None
        return resp.content

    def link_danfse(self, chave_acesso: str) -> str:
        return ENDERECOS["producao" if self.modo == "producao" else "teste"]["adn"] + f"/danfse/{chave_acesso}"
