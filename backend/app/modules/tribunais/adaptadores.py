"""Adaptadores por sistema de tribunal. Toda a conversa com o tribunal passa por aqui; mudou o layout, só este arquivo muda.

- MniAdapter: Modelo Nacional de Interoperabilidade 2.2.2 (SOAP), usado por PJe e eproc. Autentica com o e-CPF (TLS mútuo).
- SimuladoAdapter: modo simulado. Nada sai do servidor; o recibo diz "SIMULAÇÃO — sem valor jurídico".
- PortalAdapter: sistemas sem serviço para advogados (e-SAJ, Projudi, próprios): o protocolo é feito no portal e o recibo
  é registrado à mão no MayaJus.
"""

import base64
import io
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

import httpx
from lxml import etree

from app.core.certificados import CertificadoCarregado
from app.modules.tribunais import cnj

log = logging.getLogger(__name__)

NS_SER = "http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/"
NS_TIP = "http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2"
NS_INT = "http://www.cnj.jus.br/intercomunicacao-2.2.2"
NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
POLO_MNI = {"ativo": "AT", "passivo": "PA", "terceiro": "TC", "fiscal_lei": "FL", "vitima": "VI", "testemunha": "TJ", "outro": "AD"}
POLO_DO_MNI = {v: k for k, v in POLO_MNI.items()}


class NaoSuportado(RuntimeError):
    """O sistema não oferece esta operação pelo serviço: fazer no portal do tribunal."""


class ErroRede(RuntimeError):
    """Falha de comunicação: NÃO se sabe se o tribunal recebeu. Consultar antes de reenviar."""


class ErroTribunal(RuntimeError):
    def __init__(self, mensagem: str, codigo: str | None = None, bruto: bytes | None = None):
        super().__init__(mensagem)
        self.codigo, self.bruto = codigo, bruto


@dataclass
class DocumentoEnvio:
    ordem: int
    tipo_codigo: str | None
    descricao: str
    mimetype: str
    conteudo: bytes
    nivel_sigilo: int = 0
    assinatura_cades: bytes | None = None


@dataclass
class Envio:
    tipo: str  # inicial | intermediaria | habilitacao | recurso
    numero_cnj: str | None
    cpf_manifestante: str
    documentos: list[DocumentoEnvio]
    cabecalho: dict = field(default_factory=dict)
    partes: list[dict] = field(default_factory=list)
    tipo_peticao_codigo: str | None = None
    parametros: dict = field(default_factory=dict)


@dataclass
class ResultadoEnvio:
    sucesso: bool
    numero_protocolo: str | None = None
    data_hora: datetime | None = None
    numero_cnj_gerado: str | None = None
    orgao_distribuido: str | None = None
    tipo_distribuicao: str | None = None
    recibo: bytes | None = None
    recibo_mime: str = "application/pdf"
    mensagem: str | None = None
    codigo_erro: str | None = None
    bruto: bytes = b""
    simulado: bool = False


@dataclass
class ResultadoConsulta:
    capa: dict
    partes: list[dict]
    movimentos: list[dict]
    documentos: list[dict]
    bruto: bytes = b""


class Adaptador(Protocol):
    def consultar(self, sistema, cert: CertificadoCarregado | None, cpf: str, numero_cnj: str, incluir_documentos: bool = False,
                  documentos_ids: list[str] | None = None) -> ResultadoConsulta: ...

    def protocolar(self, sistema, cert: CertificadoCarregado, envio: Envio) -> ResultadoEnvio: ...

    def saude(self, sistema) -> str: ...


# --------------------------------------------------------------------------------------------------------- MNI
def _el(pai, ns, tag_, texto=None, **attrs):
    e = etree.SubElement(pai, f"{{{ns}}}{tag_}", {k: str(v) for k, v in attrs.items() if v is not None})
    if texto is not None:
        e.text = str(texto)
    return e


def _envelope(operacao: str):
    env = etree.Element(f"{{{NS_SOAP}}}Envelope", nsmap={"soapenv": NS_SOAP, "ser": NS_SER, "tip": NS_TIP, "int": NS_INT})
    etree.SubElement(env, f"{{{NS_SOAP}}}Header")
    corpo = etree.SubElement(env, f"{{{NS_SOAP}}}Body")
    return env, etree.SubElement(corpo, f"{{{NS_SER}}}{operacao}")


def xml_consulta(cpf: str, numero: str, incluir_documentos: bool, documentos_ids: list[str] | None = None) -> bytes:
    env, op = _envelope("consultarProcesso")
    _el(op, NS_TIP, "idConsultante", cpf)
    _el(op, NS_TIP, "senhaConsultante", "")
    _el(op, NS_TIP, "numeroProcesso", cnj.so_digitos(numero))
    _el(op, NS_TIP, "movimentos", "true")
    _el(op, NS_TIP, "incluirCabecalho", "true")
    _el(op, NS_TIP, "incluirDocumentos", "true" if incluir_documentos else "false")
    for d in documentos_ids or []:
        _el(op, NS_TIP, "documento", d)
    return etree.tostring(env, xml_declaration=True, encoding="utf-8")


def _pessoa_mni(pai, p: dict):
    pes = _el(pai, NS_INT, "pessoa", nome=p.get("nome"), numeroDocumentoPrincipal=p.get("cpf") or p.get("cnpj"),
              tipoPessoa={"juridica": "juridica", "autoridade": "autoridade", "orgao_representacao": "orgaorepresentacao"}.get(
                  p.get("tipo_pessoa"), "fisica"),
              sexo=p.get("sexo"), nomeGenitor=p.get("nome_pai"), nomeGenitora=p.get("nome_mae"),
              dataNascimento=p["data_nascimento"].replace("-", "") if p.get("data_nascimento") else None,
              nacionalidade=p.get("nacionalidade_codigo"))
    for end in p.get("enderecos") or []:
        e = _el(pes, NS_INT, "endereco", cep=end.get("cep"))
        for campo, tag in (("logradouro", "logradouro"), ("numero", "numero"), ("complemento", "complemento"),
                           ("bairro", "bairro"), ("cidade", "cidade"), ("uf", "estado"), ("pais", "pais")):
            if end.get(campo):
                _el(e, NS_INT, tag, end[campo])
    return pes


def xml_manifestacao(envio: Envio, data_envio: datetime) -> bytes:
    env, op = _envelope("entregarManifestacaoProcessual")
    _el(op, NS_TIP, "idManifestante", envio.cpf_manifestante)
    _el(op, NS_TIP, "senhaManifestante", "")
    if envio.tipo == "inicial":
        c = envio.cabecalho
        db = _el(op, NS_TIP, "dadosBasicos", classeProcessual=c.get("classe_codigo"), codigoLocalidade=c.get("localidade_codigo"),
                 competencia=c.get("competencia_codigo"), nivelSigilo=c.get("nivel_sigilo", 0))
        for polo in ("ativo", "passivo", "terceiro"):
            partes = [p for p in envio.partes if p.get("polo") == polo]
            if not partes:
                continue
            pe = _el(db, NS_INT, "polo", polo=POLO_MNI[polo])
            for p in partes:
                pa = _el(pe, NS_INT, "parte", assistenciaJudiciaria="true" if p.get("assistencia_judiciaria") else None)
                _pessoa_mni(pa, p.get("pessoa") or p)
                for a in p.get("advogados") or []:
                    _el(pa, NS_INT, "advogado", nome=a.get("nome"), inscricao=f"{a.get('oab_uf')}{a.get('oab_numero')}",
                        numeroDocumentoPrincipal=a.get("cpf"), tipoRepresentante="A")
        for a in c.get("assuntos") or []:
            ass = _el(db, NS_INT, "assunto", principal="true" if a.get("principal") else "false")
            _el(ass, NS_INT, "codigoNacional", a.get("codigo"))
        for pr in c.get("prioridades") or []:
            _el(db, NS_INT, "prioridade", pr)
        if c.get("valor_causa") is not None:
            _el(db, NS_INT, "valorCausa", f"{float(c['valor_causa']):.2f}")
        if c.get("orgao_julgador_codigo"):
            _el(db, NS_INT, "orgaoJulgador", codigoOrgao=c["orgao_julgador_codigo"])
    else:
        _el(op, NS_TIP, "numeroProcesso", cnj.so_digitos(envio.numero_cnj))
    for d in sorted(envio.documentos, key=lambda x: x.ordem):
        doc = _el(op, NS_TIP, "documento", idDocumento=d.ordem, tipoDocumento=d.tipo_codigo or envio.tipo_peticao_codigo,
                  mimetype=d.mimetype, nivelSigilo=d.nivel_sigilo, descricao=d.descricao)
        _el(doc, NS_INT, "conteudo", base64.b64encode(d.conteudo).decode())
        if d.assinatura_cades:
            _el(doc, NS_INT, "assinatura", assinatura=base64.b64encode(d.assinatura_cades).decode(), codificacaoCertificado="PkiPath",
                algoritmoHash="SHA256withRSA")
    _el(op, NS_TIP, "dataEnvio", data_envio.strftime("%Y%m%d%H%M%S"))
    for k, v in envio.parametros.items():
        _el(op, NS_TIP, "parametros", nome=k, valor=v)
    return etree.tostring(env, xml_declaration=True, encoding="utf-8")


def _local(e) -> str:
    return etree.QName(e).localname


def _filho(e, nome):
    return next((c for c in e if isinstance(c.tag, str) and _local(c) == nome), None)


def _filhos(e, nome):
    return [c for c in e if isinstance(c.tag, str) and _local(c) == nome]


def _texto(e, nome) -> str | None:
    f = _filho(e, nome) if e is not None else None
    return f.text.strip() if f is not None and f.text else None


def _resposta(bruto: bytes, operacao: str):
    try:
        raiz = etree.fromstring(bruto)
    except etree.XMLSyntaxError as e:
        raise ErroTribunal("O tribunal respondeu algo que não é XML (sistema fora do ar ou mudou o layout).", "layout", bruto) from e
    fault = next(raiz.iter(f"{{{NS_SOAP}}}Fault"), None)
    if fault is not None:
        raise ErroTribunal((_texto(fault, "faultstring") or "Erro SOAP").strip(), _texto(fault, "faultcode"), bruto)
    r = next((e for e in raiz.iter() if isinstance(e.tag, str) and _local(e) == f"{operacao}Resposta"), None)
    if r is None:
        raise ErroTribunal("Resposta do tribunal sem o elemento esperado (o layout pode ter mudado).", "layout", bruto)
    return r


def ler_consulta(bruto: bytes) -> ResultadoConsulta:
    r = _resposta(bruto, "consultarProcesso")
    if (_texto(r, "sucesso") or "").lower() != "true":
        raise ErroTribunal(_texto(r, "mensagem") or "O tribunal recusou a consulta.", "consulta", bruto)
    proc = _filho(r, "processo")
    if proc is None:
        raise ErroTribunal("O tribunal não devolveu o processo (sem acesso ou segredo de justiça).", "sem_acesso", bruto)
    db = _filho(proc, "dadosBasicos")
    capa, partes = {}, []
    if db is not None:
        orgao = _filho(db, "orgaoJulgador")
        capa = {
            "classe_codigo_cnj": int(db.get("classeProcessual")) if (db.get("classeProcessual") or "").isdigit() else None,
            "localidade_codigo": db.get("codigoLocalidade"), "competencia": db.get("competencia"),
            "nivel_sigilo": int(db.get("nivelSigilo") or 0),
            "valor_causa": _texto(db, "valorCausa"), "magistrado": _texto(db, "magistradoAtuante"),
            "orgao_julgador": orgao.get("nomeOrgao") if orgao is not None else None,
            "orgao_julgador_codigo": orgao.get("codigoOrgao") if orgao is not None else None,
            "assuntos": [{"codigo_cnj": int(_texto(a, "codigoNacional")), "principal": a.get("principal") == "true"}
                         for a in _filhos(db, "assunto") if (_texto(a, "codigoNacional") or "").isdigit()],
            "prioridades": [p.text for p in _filhos(db, "prioridade") if p.text],
        }
        ordem = 0
        for polo in _filhos(db, "polo"):
            for pa in _filhos(polo, "parte"):
                pes = _filho(pa, "pessoa")
                if pes is None:
                    continue
                ordem += 1
                doc = (pes.get("numeroDocumentoPrincipal") or "").strip()
                digitos = "".join(ch for ch in doc if ch.isdigit())
                enderecos = []
                for en in _filhos(pes, "endereco"):
                    enderecos.append({"cep": en.get("cep"), "logradouro": _texto(en, "logradouro"), "numero": _texto(en, "numero"),
                                      "complemento": _texto(en, "complemento"), "bairro": _texto(en, "bairro"),
                                      "cidade": _texto(en, "cidade"), "uf": _texto(en, "estado"), "pais": _texto(en, "pais") or "Brasil"})
                partes.append({
                    "polo": POLO_DO_MNI.get(polo.get("polo"), "outro"), "ordem": ordem,
                    "assistencia_judiciaria": pa.get("assistenciaJudiciaria") == "true",
                    "intimacao_pendente": (pa.get("intimacaoPendente") or "0") not in ("0", "false"),
                    "pessoa": {"nome": pes.get("nome"), "tipo_pessoa": "juridica" if pes.get("tipoPessoa") == "juridica" else "fisica",
                               "documento": digitos if len(digitos) in (11, 14) and "*" not in doc else None,
                               "documento_parcial": doc if "*" in doc else None, "sexo": pes.get("sexo"),
                               "nome_mae": pes.get("nomeGenitora"), "nome_pai": pes.get("nomeGenitor"), "enderecos": enderecos},
                    "advogados": [{"nome": a.get("nome"), "cpf": a.get("numeroDocumentoPrincipal"),
                                   "oab_uf": (a.get("inscricao") or "")[:2], "oab_numero": "".join(ch for ch in (a.get("inscricao") or "") if ch.isdigit()),
                                   "tipo_representante": {"A": "advogado", "P": "procurador", "D": "defensor", "E": "escritorio"}.get(
                                       a.get("tipoRepresentante"), "advogado"),
                                   "recebe_intimacao": a.get("intimacao") == "true"} for a in _filhos(pa, "advogado")],
                })
    movs = []
    for m in _filhos(proc, "movimento"):
        nac, loc = _filho(m, "movimentoNacional"), _filho(m, "movimentoLocal")
        compl = [c.text for c in (nac if nac is not None else m) if isinstance(c.tag, str) and _local(c) == "complemento" and c.text]
        desc = (loc.get("descricao") if loc is not None else None) or " ".join(compl) or "Movimentação"
        dh = m.get("dataHora")
        movs.append({"data_hora": datetime.strptime(dh, "%Y%m%d%H%M%S").replace(tzinfo=UTC) if dh and len(dh) == 14 else None,
                     "codigo_nacional": int(nac.get("codigoNacional")) if nac is not None and (nac.get("codigoNacional") or "").isdigit() else None,
                     "codigo_local": loc.get("codigoMovimento") if loc is not None else None,
                     "descricao": desc, "complementos": [{"texto": c} for c in compl] or None,
                     "nivel_sigilo": int(m.get("nivelSigilo") or 0), "documentos": [d.text for d in _filhos(m, "idDocumentoVinculado") if d.text]})
    docs = []
    for d in _filhos(proc, "documento"):
        conteudo = _texto(d, "conteudo")
        dh = d.get("dataHora")
        docs.append({"id": d.get("idDocumento"), "pai": d.get("idDocumentoVinculado"), "tipo_codigo": d.get("tipoDocumento"),
                     "descricao": d.get("descricao"), "mimetype": d.get("mimetype") or "application/pdf",
                     "nivel_sigilo": int(d.get("nivelSigilo") or 0),
                     "data_hora": datetime.strptime(dh, "%Y%m%d%H%M%S").replace(tzinfo=UTC) if dh and len(dh) == 14 else None,
                     "conteudo": base64.b64decode(conteudo) if conteudo else None,
                     "assinantes": [{"nome": a.get("signatarioLogin"), "data_hora": a.get("dataAssinatura")} for a in _filhos(d, "assinatura")]})
        for v in _filhos(d, "documentoVinculado"):  # anexos de uma petição
            c2 = _texto(v, "conteudo")
            docs.append({"id": v.get("idDocumento"), "pai": d.get("idDocumento"), "tipo_codigo": v.get("tipoDocumento"),
                         "descricao": v.get("descricao"), "mimetype": v.get("mimetype") or "application/pdf",
                         "nivel_sigilo": int(v.get("nivelSigilo") or 0), "data_hora": None,
                         "conteudo": base64.b64decode(c2) if c2 else None, "assinantes": []})
    return ResultadoConsulta(capa=capa, partes=partes, movimentos=movs, documentos=docs, bruto=bruto)


def ler_manifestacao(bruto: bytes) -> ResultadoEnvio:
    r = _resposta(bruto, "entregarManifestacaoProcessual")
    ok = (_texto(r, "sucesso") or "").lower() == "true"
    data_txt = _texto(r, "dataOperacao")
    recibo = _texto(r, "recibo")
    params = {p.get("nome"): p.get("valor") for p in _filhos(r, "parametro")}
    return ResultadoEnvio(
        sucesso=ok, numero_protocolo=_texto(r, "protocoloRecebimento"), mensagem=_texto(r, "mensagem"),
        data_hora=datetime.strptime(data_txt, "%Y%m%d%H%M%S").replace(tzinfo=UTC) if data_txt and len(data_txt) == 14 else None,
        recibo=base64.b64decode(recibo) if recibo else None,
        numero_cnj_gerado=cnj.so_digitos(params.get("numeroProcesso")) or None, orgao_distribuido=params.get("orgaoJulgador"),
        tipo_distribuicao=params.get("tipoDistribuicao"), codigo_erro=None if ok else "recusado", bruto=bruto)


class MniAdapter:
    """MNI 2.2.2 sobre HTTPS com o e-CPF do advogado (TLS mútuo)."""

    transporte = None  # testes trocam por uma função (url, xml) -> bytes

    def _post(self, sistema, cert: CertificadoCarregado | None, xml: bytes, timeout: float) -> bytes:
        if not sistema.url_mni:
            raise NaoSuportado("O endereço do serviço MNI deste tribunal ainda não foi configurado.")
        if self.transporte:
            return self.transporte(sistema.url_mni, xml)
        from app.modules.tribunais.certificado import ssl_com_certificado

        verify = ssl_com_certificado(cert) if cert else True
        try:
            r = httpx.post(sistema.url_mni, content=xml, timeout=timeout, verify=verify,
                           headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": '""'})
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as e:
            raise ErroRede(f"Sem resposta do tribunal: {e.__class__.__name__}") from e
        if r.status_code >= 500 and b"Fault" not in r.content:
            raise ErroRede(f"O tribunal respondeu HTTP {r.status_code} sem detalhe.")
        return r.content

    def consultar(self, sistema, cert, cpf, numero_cnj, incluir_documentos=False, documentos_ids=None) -> ResultadoConsulta:
        if not sistema.mni_consulta:
            raise NaoSuportado("Este tribunal não libera consulta de processo pelo MNI.")
        bruto = self._post(sistema, cert, xml_consulta(cpf, numero_cnj, incluir_documentos, documentos_ids), 90.0)
        return ler_consulta(bruto)

    def protocolar(self, sistema, cert, envio: Envio) -> ResultadoEnvio:
        if not sistema.mni_peticionamento:
            raise NaoSuportado("Este tribunal não aceita peticionamento pelo MNI: protocole pelo portal.")
        if envio.tipo == "inicial" and not sistema.mni_inicial:
            raise NaoSuportado("Este tribunal só aceita petição inicial pelo portal.")
        bruto = self._post(sistema, cert, xml_manifestacao(envio, datetime.now(UTC)), 180.0)
        return ler_manifestacao(bruto)

    def saude(self, sistema) -> str:
        if not sistema.url_mni:
            return sistema.status_saude
        try:
            ini = datetime.now(UTC)
            r = httpx.get(sistema.url_mni.split("?")[0] + "?wsdl", timeout=20)
            seg = (datetime.now(UTC) - ini).total_seconds()
        except httpx.HTTPError:
            return "fora"
        if r.status_code >= 500:
            return "fora"
        if b"entregarManifestacaoProcessual" not in r.content and r.status_code == 200:
            return "mudou_layout"
        return "lento" if seg > 8 else "ok"


class PortalAdapter:
    def consultar(self, sistema, cert, cpf, numero_cnj, incluir_documentos=False, documentos_ids=None):
        raise NaoSuportado("Este sistema não oferece serviço de consulta para advogados: os dados vêm do DataJud e do DJEN.")

    def protocolar(self, sistema, cert, envio):
        url = f" ({sistema.url_portal})" if sistema.url_portal else ""
        raise NaoSuportado(f"Este sistema só aceita protocolo pelo portal{url}. Protocole lá e registre o recibo aqui.")

    def saude(self, sistema) -> str:
        if not sistema.url_portal:
            return sistema.status_saude
        try:
            r = httpx.get(sistema.url_portal, timeout=20, follow_redirects=True)
        except httpx.HTTPError:
            return "fora"
        return "fora" if r.status_code >= 500 else "ok"


def recibo_simulado(envio: Envio, numero: str, quando: datetime, cnj_gerado: str | None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(60, 790, "SIMULAÇÃO — sem valor jurídico")
    c.setFont("Helvetica", 11)
    linhas = [f"Recibo de protocolo simulado nº {numero}", f"Data/hora: {quando.astimezone():%d/%m/%Y %H:%M:%S}",
              f"Tipo: {envio.tipo}", f"Processo: {cnj.formatar(cnj_gerado or envio.numero_cnj or '') or '(novo)'}",
              f"Manifestante (CPF): {envio.cpf_manifestante[:3]}.***.***-{envio.cpf_manifestante[-2:]}", "Documentos:"]
    linhas += [f"  {d.ordem}. {d.descricao} ({len(d.conteudo) // 1024} KB)" for d in envio.documentos]
    linhas += ["", "Nada foi enviado ao tribunal. Mude o modo para Real em Configurações › Tribunais para protocolar de verdade."]
    y = 760
    for ln in linhas:
        c.drawString(60, y, ln[:110])
        y -= 18
    c.showPage()
    c.save()
    return buf.getvalue()


class SimuladoAdapter:
    def consultar(self, sistema, cert, cpf, numero_cnj, incluir_documentos=False, documentos_ids=None):
        raise NaoSuportado("Modo simulado: a consulta com certificado não é feita.")

    def protocolar(self, sistema, cert, envio: Envio) -> ResultadoEnvio:
        agora_ = datetime.now(UTC)
        numero = f"SIM-{agora_:%Y%m%d%H%M%S}-{len(envio.documentos)}"
        gerado = None
        if envio.tipo == "inicial":
            t = sistema.tribunal
            gerado = cnj.montar(9_000_000 + agora_.microsecond % 999_999, agora_.year, t.segmento_j, t.codigo_tr, "0001")
        return ResultadoEnvio(sucesso=True, numero_protocolo=numero, data_hora=agora_, numero_cnj_gerado=gerado,
                              orgao_distribuido="Juízo simulado" if gerado else None, tipo_distribuicao="sorteio" if gerado else None,
                              recibo=recibo_simulado(envio, numero, agora_, gerado), simulado=True,
                              bruto=f"<simulacao protocolo='{numero}'/>".encode())

    def saude(self, sistema) -> str:
        return "ok"


_ADAPTADORES: dict[str, type] = {"MniAdapter": MniAdapter, "PjeAdapter": MniAdapter, "EprocAdapter": MniAdapter,
                                 "PortalAdapter": PortalAdapter, "EsajAdapter": PortalAdapter, "ProjudiAdapter": PortalAdapter}
ADAPTADOR_PADRAO = {"pje": "PjeAdapter", "eproc": "EprocAdapter", "esaj": "EsajAdapter", "projudi": "ProjudiAdapter", "proprio": "PortalAdapter"}


def para(sistema, simulado: bool = False) -> Adaptador:
    if simulado:
        return SimuladoAdapter()
    return _ADAPTADORES.get(sistema.adaptador, PortalAdapter)()
