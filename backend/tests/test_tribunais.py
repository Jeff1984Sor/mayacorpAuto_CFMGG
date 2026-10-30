"""Integração com tribunais: CNJ, vínculo, parsers, varredura → importação → caso, intimação, protocolo (simulado e MNI)."""

import base64
import hashlib
import io
from datetime import UTC, date, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

from app.modules.tribunais import adaptadores, cnj, fontes, jobs, vinculo
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)

CPF = "12345678909"


# ------------------------------------------------------------------------------------------------- unidades
def test_numero_cnj_e_roteamento():
    n = "0007663-83.2026.8.26.0100"
    assert cnj.valido(n) and not cnj.valido("0007663-84.2026.8.26.0100")
    assert cnj.formatar(cnj.so_digitos(n)) == n
    assert cnj.tribunal_do_numero(n)["sigla"] == "TJSP"
    assert cnj.tribunal_do_numero(cnj.montar(1234, 2025, 5, "02", "0001"))["sigla"] == "TRT2"
    assert cnj.tribunal_do_numero(cnj.montar(1, 2024, 4, "03", "6100"))["sigla"] == "TRF3"
    assert cnj.tribunal_do_numero(cnj.montar(1, 2024, 6, "26", "0001"))["sigla"] == "TRE-SP"
    assert cnj.valido(cnj.montar(9_000_001, 2026, 8, "26", "0001"))
    assert cnj.sistema_do_nome("SAJ") == "esaj" and cnj.sistema_do_nome("PJe") == "pje" and cnj.sistema_do_nome("e-Proc") == "eproc"


class _Cli:
    def __init__(self, id, nome, doc):
        self.id, self.nome, self.cpf_cnpj = id, nome, doc


def test_regras_de_vinculo():
    assert vinculo.normalizar_nome("Condomínio do Edifício Solar Ltda.") == "CONDOMINIO EDIFICIO SOLAR"
    assert vinculo.normalizar_nome("Banco X S/A") == "BANCO X"
    base = [_Cli(1, "Condomínio Edifício Solar", "11444777000161"), _Cli(2, "Maria da Silva", "52998224725")]
    s = vinculo.casar("qualquer", "11444777000161", None, base)
    assert s.criterio == "cpf_cnpj" and s.status == "automatico"
    assert vinculo.casar("Solar Filial", "11444777000242", None, base).criterio == "cnpj_raiz"
    assert vinculo.casar("MARIA DA SILVA", None, "***.982.247-**", base).criterio == "nome_doc_parcial"
    s = vinculo.casar("Maria Silva", None, None, base)
    assert s.criterio == "nome_exato" and s.status == "sugerido"
    s = vinculo.casar("Condominio Edificio Solar Residencial", None, None, base, limiar_fuzzy=80)
    assert s.criterio == "nome_fuzzy" and float(s.confianca) < 0.7
    assert vinculo.casar("Fulano de Tal", None, None, base) is None


def _djen(numero, polo_a, polo_p, data="2026-10-20", oab="123456", tipo="Intimação", texto="Intime-se.", hash_=None, orgao="1ª Vara Cível"):
    return {"id": hash(numero + data + texto) % 10**8, "data_disponibilizacao": data, "siglaTribunal": "", "tipoComunicacao": tipo,
            "nomeOrgao": orgao, "texto": texto, "numero_processo": cnj.so_digitos(numero), "nomeClasse": "Procedimento Comum Cível",
            "codigoClasse": "7", "hash": hash_ or hashlib.md5(f"{numero}{data}{texto}".encode()).hexdigest()[:30], "ativo": True,
            "destinatarios": [{"nome": polo_a, "polo": "A"}, {"nome": polo_p, "polo": "P"}],
            "destinatarioadvogados": [{"advogado": {"nome": "ADVOGADA TESTE", "numero_oab": oab, "uf_oab": "SP"}}]}


def _datajud(numero, sistema="PJe", grau="G1", movimentos=None, sigilo=0):
    return [{"_source": {
        "numeroProcesso": cnj.so_digitos(numero), "tribunal": "TRT2", "grau": grau, "dataAjuizamento": "20250210103000",
        "nivelSigilo": sigilo, "orgaoJulgador": {"codigo": 123, "nome": "5ª Vara do Trabalho de São Paulo"},
        "classe": {"codigo": 985, "nome": "Ação Trabalhista - Rito Ordinário"}, "sistema": {"codigo": 1, "nome": sistema},
        "assuntos": [[{"codigo": 2086, "nome": "Horas Extras"}], {"codigo": 1855, "nome": "Verbas Rescisórias"}],
        "dataHoraUltimaAtualizacao": "2026-10-10T03:28:05.190000Z",
        "movimentos": movimentos or [
            {"codigo": 26, "nome": "Distribuição", "dataHora": "2025-02-10T10:30:00.000Z"},
            {"codigo": 11009, "nome": "Despacho", "dataHora": "2025-03-01T12:00:00.000Z",
             "complementosTabelados": [{"nome": "mero expediente"}]},
        ]}}]


def test_parsers_djen_e_datajud():
    it = fontes.djen_item(_djen("0007663-83.2026.8.26.0100", "Autor X", "Réu Y"))
    assert it["numero_cnj"] == "00076638320268260100" and it["partes"][0] == {"nome": "Autor X", "polo": "ativo"}
    assert it["advogados"][0]["oab"] == "123456" and it["data"] == date(2026, 10, 20)
    assert fontes.djen_item({"numero_processo": "123"}) is None
    d = fontes.datajud_processo(_datajud(cnj.montar(1234, 2025, 5, "02", "0001")))
    assert d["capa"]["sistema"] == "pje" and d["capa"]["grau"] == "1g" and len(d["capa"]["assuntos"]) == 2
    assert d["capa"]["assuntos"][0]["principal"] and d["capa"]["data_ajuizamento"].year == 2025
    assert [m["descricao"] for m in d["movimentos"]] == ["Distribuição", "Despacho (mero expediente)"]


def test_mni_xml_ida_e_volta():
    env = adaptadores.Envio(tipo="intermediaria", numero_cnj="00012345620255020001", cpf_manifestante=CPF, tipo_peticao_codigo="57",
                            documentos=[adaptadores.DocumentoEnvio(1, "57", "Manifestação", "application/pdf", b"%PDF-1.4 x")])
    xml = adaptadores.xml_manifestacao(env, datetime(2026, 10, 30, 14, 0, tzinfo=UTC))
    assert b"entregarManifestacaoProcessual" in xml and b"<tip:numeroProcesso>00012345620255020001" in xml
    assert base64.b64encode(b"%PDF-1.4 x") in xml and b"20261030140000" in xml
    resp = _resposta_mni(True, "PROT-77")
    r = adaptadores.ler_manifestacao(resp)
    assert r.sucesso and r.numero_protocolo == "PROT-77" and r.recibo == b"%PDF recibo"
    with pytest.raises(adaptadores.ErroTribunal):
        adaptadores.ler_manifestacao(b"<html>fora do ar</html>")


def _resposta_mni(ok: bool, protocolo: str = "", mensagem: str = "") -> bytes:
    rec = base64.b64encode(b"%PDF recibo").decode()
    return f"""<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:ns2="{adaptadores.NS_TIP}"><soapenv:Body><ns2:entregarManifestacaoProcessualResposta>
    <ns2:sucesso>{'true' if ok else 'false'}</ns2:sucesso><ns2:mensagem>{mensagem}</ns2:mensagem>
    <ns2:protocoloRecebimento>{protocolo}</ns2:protocoloRecebimento><ns2:dataOperacao>20261030141500</ns2:dataOperacao>
    <ns2:recibo>{rec}</ns2:recibo></ns2:entregarManifestacaoProcessualResposta></soapenv:Body></soapenv:Envelope>""".encode()


def _consulta_mni(numero: str, docs: list[tuple[str, str, str]]) -> bytes:
    d = "".join(f'<ns2:documento idDocumento="{i}" tipoDocumento="57" dataHora="{dh}" mimetype="application/pdf" descricao="{desc}"/>'
                for i, desc, dh in docs)
    return f"""<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:ns2="{adaptadores.NS_TIP}" xmlns:i="{adaptadores.NS_INT}"><soapenv:Body><ns2:consultarProcessoResposta>
    <ns2:sucesso>true</ns2:sucesso><ns2:mensagem>ok</ns2:mensagem><ns2:processo>
    <i:dadosBasicos numero="{numero}" classeProcessual="985" codigoLocalidade="3550308" nivelSigilo="0">
      <i:polo polo="AT"><i:parte><i:pessoa nome="JOSE RECLAMANTE" numeroDocumentoPrincipal="52998224725" tipoPessoa="fisica">
        <i:endereco cep="01001000"><i:logradouro>Rua A</i:logradouro><i:numero>1</i:numero><i:cidade>Sao Paulo</i:cidade>
        <i:estado>SP</i:estado></i:endereco></i:pessoa>
        <i:advogado nome="ADMIN" inscricao="SP123456" numeroDocumentoPrincipal="{CPF}" tipoRepresentante="A"/></i:parte></i:polo>
      <i:polo polo="PA"><i:parte><i:pessoa nome="EMPRESA RECLAMADA LTDA" numeroDocumentoPrincipal="11444777000161" tipoPessoa="juridica"/>
      </i:parte></i:polo>
      <i:assunto principal="true"><i:codigoNacional>2086</i:codigoNacional></i:assunto>
      <i:valorCausa>50000.00</i:valorCausa><i:orgaoJulgador codigoOrgao="123" nomeOrgao="5ª Vara do Trabalho de São Paulo"/>
    </i:dadosBasicos>{d}</ns2:processo></ns2:consultarProcessoResposta></soapenv:Body></soapenv:Envelope>""".encode()


def test_mni_consulta_le_partes_e_documentos():
    r = adaptadores.ler_consulta(_consulta_mni("00012345620255020001", [("99", "Manifestação", "20261030141000")]))
    assert [p["polo"] for p in r.partes] == ["ativo", "passivo"]
    assert r.partes[0]["pessoa"]["documento"] == "52998224725" and r.partes[0]["advogados"][0]["oab_numero"] == "123456"
    assert r.capa["valor_causa"] == "50000.00" and r.documentos[0]["id"] == "99"


def test_valor_por_extenso():
    from app.modules.tribunais.peca import valor_por_extenso

    assert valor_por_extenso("1500.50") == "mil e quinhentos reais e cinquenta centavos"
    assert valor_por_extenso("1000000") == "um milhão de reais"
    assert valor_por_extenso("21") == "vinte e um reais"


# --------------------------------------------------------------------------------------------- fluxo pela API
def ecpf(cpf=CPF, nome="ADMIN TESTE", dias=365) -> bytes:
    chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    agora = datetime.now(UTC)
    cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"{nome}:{cpf}")]))
            .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "AC TESTE ICP")])).public_key(chave.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(agora - timedelta(days=1))
            .not_valid_after(agora + timedelta(days=dias)).sign(chave, hashes.SHA256()))
    return pkcs12.serialize_key_and_certificates(b"e", chave, cert, None, serialization.BestAvailableEncryption(b"1234"))


def _pdf(texto="Petição de teste") -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, texto)
    c.save()
    return buf.getvalue()


@pytest.fixture
def trib(cliente, monkeypatch):  # noqa: F811
    """Fila síncrona e DataJud falso."""
    monkeypatch.setattr(jobs, "disparar", lambda: jobs.rodar_fila())
    banco: dict[str, list] = {}
    monkeypatch.setattr(fontes, "datajud_buscar", lambda base, chave, alias, numero, intervalo=0: fontes.datajud_processo(
        banco.get(cnj.so_digitos(numero), [])))
    return banco


def _preparar_advogado(c, h):
    r = c.put("/api/tribunais/eu/oabs", headers=h, json=[{"numero": "123456", "uf": "SP"}])
    assert r.status_code == 200, r.text
    termo = r.json()["termo_vigente"]
    r = c.post("/api/tribunais/eu/certificado", headers=h, files={"arquivo": ("ecpf.pfx", ecpf())},
               data={"senha": "1234", "aceite_termo": "true", "versao_termo": termo["versao"], "escopos": "consulta,download,protocolo"})
    assert r.status_code == 200, r.text
    eu = r.json()
    assert eu["certificado"]["titular_cpf"] == CPF and eu["cpf"] == CPF and eu["termo"]["escopos"] == ["consulta", "download", "protocolo"]
    return eu


def test_fluxo_varredura_importacao_caso_e_intimacao(cliente, trib):  # noqa: F811
    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    n1 = cnj.formatar(cnj.montar(1234, 2025, 5, "02", "0001"))  # TRT2 (PJe)
    n2 = cnj.formatar(cnj.montar(555, 2024, 8, "26", "0100"))  # TJSP
    trib[cnj.so_digitos(n1)] = _datajud(n1)
    # cliente já cadastrado com o mesmo nome da parte do DJEN
    r = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Metalúrgica Paulista Ltda", "cpf_cnpj": "11222333000181",
                                                             "logradouro": "Rua X", "numero": "1", "bairro": "Centro", "cidade": "São Paulo",
                                                             "uf": "SP", "cep": "01001000", "emails": ["fin@metal.com.br"]})
    assert r.status_code in (200, 201), r.text
    tomador = r.json()

    r = cliente.post("/api/tribunais/varreduras", headers=h, json={"advogado_id": eu["usuario_id"]})
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["coleta"] == "navegador" and v["djen"]["url"].endswith("/comunicacao") and v["inscricoes_oab"][0]["numero"] == "123456"
    itens = [_djen(n1, "João Reclamante", "METALURGICA PAULISTA LTDA"), _djen(n1, "João Reclamante", "METALURGICA PAULISTA LTDA", data="2026-10-21"),
             _djen(n2, "Fulano", "Banco Y S/A"), {"numero_processo": "lixo"}]
    r = cliente.post(f"/api/tribunais/varreduras/{v['id']}/comunicacoes", headers=h, json={"itens": itens})
    assert r.status_code == 200 and r.json()["total_encontrados"] == 2 and r.json()["total_comunicacoes"] == 3, r.text
    cliente.post(f"/api/tribunais/varreduras/{v['id']}/comunicacoes", headers=h, json={"itens": itens[:1]})  # repetida: ignora
    r = cliente.post(f"/api/tribunais/varreduras/{v['id']}/concluir", headers=h, json={})
    assert r.json()["status"] == "concluida" and r.json()["resumo_por_tribunal"] == {"TRT2": 1, "TJSP": 1}
    det = cliente.get(f"/api/tribunais/varreduras/{v['id']}", headers=h).json()
    e1 = next(e for e in det["encontrados"] if e["numero_formatado"] == n1)
    assert e1["comunicacoes"] == 2 and e1["possivel_cliente_id"] == tomador["id"] and e1["possivel_cliente_criterio"] == "nome_exato"
    assert e1["partes_resumo"] == "João Reclamante x METALURGICA PAULISTA LTDA"

    r = cliente.post(f"/api/tribunais/varreduras/{v['id']}/importar", headers=h, json={"todos": True})
    assert r.json()["na_fila"] == 2
    det = cliente.get(f"/api/tribunais/varreduras/{v['id']}", headers=h).json()
    st = {e["numero_formatado"]: e for e in det["encontrados"]}
    assert st[n1]["status_importacao"] == "importado"
    assert st[n2]["status_importacao"] == "importado"  # sem DataJud: fica com os dados do DJEN

    p = cliente.get(f"/api/tribunais/processos/{st[n1]['processo_id']}", headers=h).json()
    assert p["tribunal"] == "TRT2" and p["sistema"] == "pje" and p["classe_nome"].startswith("Ação Trabalhista")
    assert [x["polo"] for x in p["partes"]] == ["ativo", "passivo"] and p["partes"][0]["advogados"][0]["e_o_usuario"]
    assert p["total_movimentacoes"] == 4  # 2 DataJud + 2 comunicações DJEN
    vinc = next(x for x in p["vinculos"] if x["cliente_id"] == tomador["id"])
    assert vinc["status"] == "sugerido" and vinc["polo_cliente"] == "passivo"
    p = cliente.post(f"/api/tribunais/vinculos/{vinc['id']}/confirmar", headers=h).json()
    assert next(x for x in p["vinculos"] if x["id"] == vinc["id"])["status"] == "confirmado"

    # caso a partir do processo: andamentos trazem o histórico
    r = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": tomador["id"], "nome": "Contencioso trabalhista"})
    assert r.status_code in (200, 201), r.text
    r = cliente.post(f"/api/tribunais/processos/{p['id']}/caso", headers=h, json={"contrato_id": r.json()["id"]})
    assert r.status_code == 201, r.text
    caso_id = r.json()["caso_id"]
    caso = cliente.get(f"/api/faturamento/casos/{caso_id}", headers=h).json()
    assert caso["numero_processo"] == n1 and caso["tribunal"] == "TRT2" and caso["tipo"] == "judicial_trabalhista"
    assert caso["polo"] == "passivo" and caso["parte_contraria"] == "João Reclamante"
    ands = cliente.get(f"/api/faturamento/casos/{caso_id}/andamentos", headers=h).json()
    assert len(ands) == 4 and {a["tipo"] for a in ands} >= {"publicacao", "despacho"}

    # nova varredura (intimações novas): comunicação de processo já importado vira intimação + alerta + andamento
    v2 = cliente.post("/api/tribunais/varreduras", headers=h, json={"advogado_id": eu["usuario_id"], "so_novas": True}).json()
    r = cliente.post(f"/api/tribunais/varreduras/{v2['id']}/comunicacoes", headers=h,
                     json={"itens": [_djen(n1, "João Reclamante", "METALURGICA PAULISTA LTDA", data="2026-10-29", texto="Manifeste-se em 5 dias.")]})
    assert r.json()["intimacoes_registradas"] == 1
    painel = cliente.get("/api/tribunais/painel", headers=h).json()
    assert painel["intimacoes_nao_lidas"] >= 1 and painel["processos"] >= 2
    intim = next(m for m in painel["intimacoes_recentes"] if "Manifeste-se" in m["descricao"])
    r = cliente.post(f"/api/tribunais/movimentacoes/{intim['id']}/tarefa", headers=h, json={"prazo": str(date.today() + timedelta(days=5))})
    assert r.status_code == 201, r.text
    t = cliente.get(f"/api/faturamento/tarefas/{r.json()['tarefa_id']}", headers=h).json()
    assert t["tipo"] == "prazo" and t["caso_id"] == caso_id
    assert len(cliente.get(f"/api/faturamento/casos/{caso_id}/andamentos", headers=h).json()) == 5

    # sincronização: movimento novo no DataJud
    trib[cnj.so_digitos(n1)] = _datajud(n1, movimentos=[*_datajud(n1)[0]["_source"]["movimentos"],
                                                       {"codigo": 51, "nome": "Conclusão", "dataHora": "2026-10-30T10:00:00.000Z"}])
    r = cliente.post(f"/api/tribunais/processos/{p['id']}/sincronizar", headers=h)
    assert r.json()["novas"] == 1


def _processo_trt(c, h, trib, sigilo=0):
    n = cnj.formatar(cnj.montar(4321 + sigilo, 2025, 5, "02", "0001"))
    trib[cnj.so_digitos(n)] = _datajud(n, sigilo=sigilo)
    r = c.post("/api/tribunais/processos/importar", headers=h, json={"numero_cnj": n})
    assert r.status_code == 201, r.text
    return r.json()


def _intermediaria(c, h, proc, uid):
    r = c.post("/api/tribunais/protocolos", headers=h, json={
        "tipo": "intermediaria", "advogado_id": uid, "processo_id": proc["id"], "titulo": "Manifestação sobre documentos",
        "tipo_peticao_codigo": "57", "tipo_peticao_nome": "Manifestação", "polo_peticionante": "passivo", "parte_ids": [],
        "prazo_final": str(date.today() + timedelta(days=3))})
    assert r.status_code == 201, r.text
    return r.json()


def test_protocolo_simulado_aprovacao_e_hash(cliente, trib):  # noqa: F811
    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    proc = _processo_trt(cliente, h, trib)
    prot = _intermediaria(cliente, h, proc, eu["usuario_id"])
    erros = [m["mensagem"] for m in prot["validacao"] if m["nivel"] == "erro"]
    assert any("petição (documento principal)" in e for e in erros)
    assert cliente.post(f"/api/tribunais/protocolos/{prot['id']}/aprovar", headers=h).status_code == 400

    r = cliente.post(f"/api/tribunais/protocolos/{prot['id']}/documentos", headers=h, files={"arquivo": ("manif.pdf", _pdf(), "application/pdf")},
                     data={"tipo_documento_nome": "Petição", "descricao": "Manifestação"})
    assert r.status_code == 201, r.text
    assert cliente.post(f"/api/tribunais/protocolos/{prot['id']}/documentos", headers=h,
                        files={"arquivo": ("x.pdf", b"nao e pdf", "application/pdf")}, data={"tipo_documento_nome": "Petição"}).status_code == 400
    partes = [proc["partes"][1]["id"]] if proc["partes"] else []
    body = {"tipo": "intermediaria", "advogado_id": eu["usuario_id"], "processo_id": proc["id"], "titulo": "Manifestação sobre documentos",
            "tipo_peticao_codigo": "57", "tipo_peticao_nome": "Manifestação", "polo_peticionante": "passivo", "parte_ids": partes,
            "prazo_final": str(date.today() + timedelta(days=3))}
    r = cliente.put(f"/api/tribunais/protocolos/{prot['id']}", headers=h, json=body)
    assert r.status_code == 200, r.text
    val = r.json()["validacao"]
    assert not [m for m in val if m["nivel"] == "erro"], val
    assert any("Modo simulado" in m["mensagem"] for m in val)

    r = cliente.post(f"/api/tribunais/protocolos/{prot['id']}/aprovar", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "aprovado" and r.json()["aprovacao"], r.text
    # mudou o conteúdo depois de aprovar: a aprovação cai
    r = cliente.put(f"/api/tribunais/protocolos/{prot['id']}", headers=h, json={**body, "pedido_urgente": True})
    assert r.json()["status"] == "rascunho" and r.json()["aprovacao"] is None and r.json()["aprovacoes_invalidadas"] == 1
    assert cliente.post(f"/api/tribunais/protocolos/{prot['id']}/enviar", headers=h).status_code == 400
    cliente.post(f"/api/tribunais/protocolos/{prot['id']}/aprovar", headers=h)

    r = cliente.post(f"/api/tribunais/protocolos/{prot['id']}/enviar", headers=h)
    assert r.status_code == 200, r.text
    p = cliente.get(f"/api/tribunais/protocolos/{prot['id']}", headers=h).json()
    assert p["status"] == "protocolado" and p["simulado"], p
    ret = p["retornos"][-1]
    assert ret["sucesso"] and ret["simulado"] and ret["numero_protocolo"].startswith("SIM-") and ret["tem_recibo"]
    assert p["documentos"][0]["assinado"] and p["documentos"][0]["formato_assinatura"] == "PAdES"  # PJe: PDF assinado por dentro
    assert ret["emails"] and all(e["status"] == "enviado" for e in ret["emails"])
    rec = cliente.get(f"/api/tribunais/retornos/{ret['id']}/recibo", headers=h)
    assert rec.status_code == 200 and rec.content.startswith(b"%PDF")
    assert cliente.get("/api/tribunais/cobranca", headers=h).json()["uso"]["usado"] == 0  # simulado não consome
    assert cliente.delete(f"/api/tribunais/protocolos/{prot['id']}", headers=h).status_code == 400  # prova do envio
    # pyHanko: o PDF enviado tem assinatura válida
    from pyhanko.pdf_utils.reader import PdfFileReader

    assinado = cliente.get(f"/api/tribunais/protocolos/{prot['id']}/documentos/{p['documentos'][0]['id']}/arquivo?assinado=true", headers=h)
    assert len(PdfFileReader(io.BytesIO(assinado.content)).embedded_signatures) == 1


def test_inicial_validacoes(cliente, trib):  # noqa: F811
    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    r = cliente.post("/api/tribunais/protocolos", headers=h, json={"tipo": "inicial", "advogado_id": eu["usuario_id"], "tribunal_sigla": "TJSP",
                                                                   "titulo": "Ação de cobrança"})
    assert r.status_code == 201, r.text
    erros = " | ".join(m["mensagem"] for m in r.json()["validacao"] if m["nivel"] == "erro")
    for trecho in ("polo ativo", "polo passivo", "valor da causa", "assunto", "classe processual"):
        assert trecho in erros, (trecho, erros)
    pid = r.json()["id"]
    end = {"cep": "01001000", "logradouro": "Rua A", "numero": "10", "bairro": "Sé", "cidade": "São Paulo", "uf": "SP"}
    body = {"tipo": "inicial", "advogado_id": eu["usuario_id"], "tribunal_sigla": "TJSP", "titulo": "Ação de cobrança",
            "cabecalho": {"localidade_codigo": "100", "classe_codigo": "7", "classe_nome": "Procedimento Comum Cível",
                          "assuntos": [{"codigo": "7691", "principal": True}], "valor_causa": "15000.00", "justica_gratuita_requerida": False,
                          "tutela_urgencia": False, "segredo_justica_requerido": False, "audiencia_conciliacao": "nao_deseja"},
            "partes": [{"polo": "ativo", "pessoa": {"tipo_pessoa": "juridica", "nome": "Credora SA", "cnpj": "11444777000161", "enderecos": [end]},
                        "advogados": [{"nome": "Admin", "oab_numero": "123456", "oab_uf": "SP"}]},
                       {"polo": "passivo", "pessoa": {"nome": "Devedor da Silva", "enderecos": [end]}}],
            "conteudo_peca": {"fatos": "O réu deve.", "fundamentos_juridicos": "CC, art. 389.", "pedidos": ["condenação ao pagamento"]}}
    r = cliente.put(f"/api/tribunais/protocolos/{pid}", headers=h, json=body)
    erros = [m["mensagem"] for m in r.json()["validacao"] if m["nivel"] == "erro"]
    assert any("Devedor da Silva: informe CPF/CNPJ" in e for e in erros)
    assert any("guia de custas" in e for e in erros)  # regra 6
    body["partes"][1]["pessoa"]["justificativa_sem_documento"] = "Desconhecido; requer pesquisa ao juízo"
    cliente.put(f"/api/tribunais/protocolos/{pid}", headers=h, json=body)
    r = cliente.post(f"/api/tribunais/protocolos/{pid}/custas", headers=h, json={
        "tipo_custa": "inicial", "tipo_guia": "DARE", "valor": "150.00", "numero_guia": "123", "vencimento": str(date.today()),
        "pagador_nome": "Credora SA", "pagador_documento": "11444777000161"})
    assert r.status_code == 201
    cid = r.json()["custas"][0]["id"]
    r = cliente.post(f"/api/tribunais/protocolos/{pid}/custas/{cid}/comprovante", headers=h, files={"arquivo": ("c.pdf", _pdf("pago"))})
    assert r.json()["custas"][0]["status"] == "paga"
    r = cliente.post(f"/api/tribunais/protocolos/{pid}/gerar-peca", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["documentos"][0]["descricao"] == "Ação de cobrança" and r.json()["documentos"][0]["paginas"] >= 1
    erros = [m["mensagem"] for m in r.json()["validacao"] if m["nivel"] == "erro"]
    assert not erros, erros
    assert any("procuração" in m["mensagem"] for m in r.json()["validacao"])
    pdf = cliente.get(f"/api/tribunais/protocolos/{pid}/previa", headers=h)
    assert pdf.content.startswith(b"%PDF")
    # prazo vencido sem justificativa bloqueia (regra 7)
    r = cliente.put(f"/api/tribunais/protocolos/{pid}", headers=h, json={**body, "prazo_final": str(date.today() - timedelta(days=1))})
    assert any("prazo terminou" in m["mensagem"] for m in r.json()["validacao"] if m["nivel"] == "erro")


def test_protocolo_real_mni_cobranca_e_falha_de_rede(cliente, trib, monkeypatch):  # noqa: F811
    from app.core.config import settings
    from app.core.db import SessionLocal
    from app.modules.tribunais.models import Plano, FaixaExcedente, Sistema, Tribunal
    from app.modules.tribunais.service import config

    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    proc = _processo_trt(cliente, h, trib, sigilo=0)
    with SessionLocal() as db:
        s = next(x for x in db.query(Tribunal).filter_by(sigla="TRT2").one().sistemas if x.grau == "1g")
        s.url_mni, s.mni_consulta, s.mni_peticionamento, s.validado, s.exige_credenciamento = "https://mni.trt2.test/ws", True, True, True, False
        s.intervalo_min_s = 0
        plano = Plano(nome="Teste", preco_mensal=100, creditos_protocolo_mes=1, permite_excedente=True,
                      faixas=[FaixaExcedente(de_creditos=1, ate_creditos=None, preco_por_credito=7)])
        db.add(plano)
        db.flush()
        cfg = config(db, eu and 1)
        cfg.plano_id, cfg.modo = plano.id, "real"
        db.commit()
    monkeypatch.setattr(settings, "ambiente", "prod")
    enviados = []

    def transporte(url, xml):
        enviados.append(xml)
        if b"consultarProcesso" in xml:
            return _consulta_mni(proc["numero_cnj"], [("501", "Manifestação", datetime.now(UTC).strftime("%Y%m%d%H%M%S"))])
        return _resposta_mni(True, f"TRT2-{len(enviados)}")

    monkeypatch.setattr(adaptadores.MniAdapter, "transporte", staticmethod(transporte))

    def protocolar():
        prot = _intermediaria(cliente, h, proc, eu["usuario_id"])
        cliente.post(f"/api/tribunais/protocolos/{prot['id']}/documentos", headers=h, files={"arquivo": ("m.pdf", _pdf(), "application/pdf")},
                     data={"tipo_documento_nome": "Petição", "descricao": "Manifestação", "tipo_documento_codigo": "57"})
        body = {"tipo": "intermediaria", "advogado_id": eu["usuario_id"], "processo_id": proc["id"], "tipo_peticao_codigo": "57",
                "tipo_peticao_nome": "Manifestação", "polo_peticionante": "passivo", "parte_ids": [proc["partes"][1]["id"]] if proc["partes"] else []}
        r = cliente.put(f"/api/tribunais/protocolos/{prot['id']}", headers=h, json=body)
        assert not [m for m in r.json()["validacao"] if m["nivel"] == "erro"], r.json()["validacao"]
        assert cliente.post(f"/api/tribunais/protocolos/{prot['id']}/aprovar", headers=h).status_code == 200
        cliente.post(f"/api/tribunais/protocolos/{prot['id']}/enviar", headers=h)
        return cliente.get(f"/api/tribunais/protocolos/{prot['id']}", headers=h).json()

    p1 = protocolar()
    assert p1["status"] == "protocolado" and not p1["simulado"] and p1["retornos"][-1]["numero_protocolo"].startswith("TRT2-")
    assert any(b"entregarManifestacaoProcessual" in x and b"<tip:numeroProcesso>" in x for x in enviados)
    p2 = protocolar()
    assert p2["status"] == "protocolado"
    cob = cliente.get("/api/tribunais/cobranca", headers=h).json()
    lanc = [x for x in cob["lancamentos"] if x["origem"] == "protocolo"]
    assert [x["dentro_franquia"] for x in lanc] == [True, False] and lanc[1]["valor"] == "7.00"
    assert cob["uso"]["usado"] == 2 and cob["total"] == "107.00"
    alertas = cliente.get("/api/tribunais/alertas", headers=h).json()
    assert any(a["tipo"] == "franquia" for a in alertas)
    r = cliente.post("/api/tribunais/cobranca/estorno", headers=h, json={"consumo_id": lanc[1]["id"], "motivo": "Teste de estorno"})
    assert r.status_code == 200 and r.json()["creditos"] == -1

    # falha de rede: não reenvia; consulta e acha a petição nos autos
    def rede_cai(url, xml):
        if b"consultarProcesso" in xml:
            return transporte(url, xml)
        raise adaptadores.ErroRede("timeout")

    monkeypatch.setattr(adaptadores.MniAdapter, "transporte", staticmethod(rede_cai))
    p3 = protocolar()
    assert p3["status"] == "verificar", p3
    with SessionLocal() as db:
        from app.modules.tribunais.models import Job

        j = db.query(Job).filter_by(tipo="verificar_protocolo", referencia_id=p3["id"]).one()
        j.proxima_tentativa_em = None
        db.commit()
    jobs.rodar_fila()
    p3 = cliente.get(f"/api/tribunais/protocolos/{p3['id']}", headers=h).json()
    assert p3["status"] == "protocolado" and p3["retornos"][-1]["recuperado"]
    assert sum(1 for x in enviados if b"entregarManifestacaoProcessual" in x) == 2  # o 3º envio não foi repetido
    uso = cliente.get("/api/tribunais/eu/uso-certificado", headers=h).json()
    assert {"assinatura", "protocolo", "consulta"} <= {u["acao"] for u in uso}
    with SessionLocal() as db:
        config(db, 1).modo = "simulado"
        config(db, 1).plano_id = None
        db.commit()


def test_rbac_e_sigilo(cliente, trib):  # noqa: F811
    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    sig = _processo_trt(cliente, h, trib, sigilo=3)
    assert sig["nivel_sigilo"] == 3
    perfis = {p["nome"]: p for p in cliente.get("/api/config/perfis", headers=h).json()}
    assert "trib_protocolos.protocolar" in perfis["Advogado"]["permissoes"]
    r = cliente.post("/api/config/usuarios", headers=h, json={"nome": "Visu", "email": "visu.trib@cfme.com.br", "perfil": "visualizador",
                                                               "senha": "Senha@Forte2026", "perfil_acesso_id": perfis["Visualizador"]["id"]})
    assert r.status_code == 200, r.text
    hv = {"Authorization": "Bearer " + cliente.post("/api/auth/login", json={"email": "visu.trib@cfme.com.br", "senha": "Senha@Forte2026"}).json()["access_token"]}
    assert cliente.get("/api/tribunais/eu", headers=hv).status_code == 200  # o próprio advogado: livre
    assert cliente.get("/api/tribunais/processos", headers=hv).status_code == 200
    ids = [p["id"] for p in cliente.get("/api/tribunais/processos", headers=hv).json()["itens"]]
    assert sig["id"] not in ids  # regra 8
    assert cliente.get(f"/api/tribunais/processos/{sig['id']}", headers=hv).status_code == 403
    assert cliente.post("/api/tribunais/protocolos", headers=hv, json={"tipo": "inicial", "advogado_id": eu["usuario_id"]}).status_code == 403
    assert cliente.put("/api/tribunais/config", headers=hv, json={"modo": "simulado"}).status_code == 403
    assert cliente.get("/api/tribunais/plataforma", headers=hv).status_code == 403  # só equipe MayaCorp
    assert cliente.put("/api/tribunais/config", headers=h, json={"modo": "real"}).status_code == 400  # real só em produção
    # quem não é o titular não aprova
    r = cliente.post("/api/tribunais/protocolos", headers=h, json={"tipo": "inicial", "advogado_id": eu["usuario_id"], "tribunal_sigla": "TJSP"})
    assert r.status_code == 201
    # revogar o termo apaga o certificado
    r = cliente.post("/api/tribunais/eu/termo/revogar", headers=h)
    assert r.json()["certificado"] is None and r.json()["termo"] is None


def test_proxy_no_brasil_busca_intimacoes_sozinho(cliente, trib, monkeypatch):  # noqa: F811
    from app.core.db import SessionLocal
    from app.modules.tribunais import service
    from app.modules.tribunais.models import Varredura

    h = _login(cliente)
    eu = _preparar_advogado(cliente, h)
    n = cnj.formatar(cnj.montar(777, 2025, 5, "02", "0001"))
    paginas = []

    def djen(base, numero, uf, pagina, inicio=None, fim=None, timeout=30.0):
        paginas.append((base, numero, uf, pagina, inicio))
        return {"count": 1, "items": [_djen(n, "Autor Proxy", "Ré Proxy", data=str(date.today()))] if pagina == 1 else []}

    monkeypatch.setattr(fontes, "djen_buscar", djen)
    with SessionLocal() as db:
        service.plataforma(db).djen_proxy_url = "https://proxy-br.exemplo/djen-segredo/api/v1"
        db.commit()
    try:
        r = cliente.post("/api/tribunais/varreduras", headers=h, json={"advogado_id": eu["usuario_id"], "so_novas": True})
        assert r.json()["coleta"] == "servidor" and r.json()["status"] == "concluida", r.json()
        assert paginas[0][0].startswith("https://proxy-br.exemplo/") and paginas[0][1:3] == ("123456", "SP")
        with SessionLocal() as db:  # rotina diária: já houve varredura hoje → não repete
            assert service.agendar_intimacoes_diarias(db) == 0
            db.query(Varredura).filter_by(advogado_id=eu["usuario_id"]).update({"iniciada_em": datetime.now(UTC) - timedelta(days=2)})
            db.commit()
            assert service.agendar_intimacoes_diarias(db) >= 1
            db.commit()
        jobs.rodar_fila()
        v = cliente.get("/api/tribunais/varreduras", headers=h).json()[0]
        assert v["status"] == "concluida" and v["total_encontrados"] == 1 and v["data_inicio"]
    finally:
        with SessionLocal() as db:
            service.plataforma(db).djen_proxy_url = None
            db.commit()


def test_caso_so_com_numero_cnj(cliente, trib, monkeypatch):  # noqa: F811
    from app.core.db import SessionLocal
    from app.modules.tribunais import caso as caso_mod
    from app.modules.tribunais import service
    from app.modules.tribunais.models import DocumentoAutos, Processo

    h = _login(cliente)
    _preparar_advogado(cliente, h)
    n = cnj.formatar(cnj.montar(31337, 2025, 5, "15", "0001"))  # TRT15 (Campinas)
    trib[cnj.so_digitos(n)] = _datajud(n)
    trib[cnj.so_digitos(n)][0]["_source"]["orgaoJulgador"]["nome"] = "2ª Vara do Trabalho de Campinas"
    monkeypatch.setattr(fontes, "djen_por_processo", lambda base, numero, max_paginas=10: [
        fontes.djen_item(_djen(n, "Maria Operária", "Indústria Capa Ltda", texto="Cite-se."))])
    with SessionLocal() as db:
        service.plataforma(db).djen_proxy_url = "https://proxy-br.exemplo/s/api/v1"
        db.commit()
    try:
        cli = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Indústria Capa Ltda", "cpf_cnpj": "73914625000132",
                                                                   "logradouro": "Rua X", "numero": "1", "bairro": "Centro", "cidade": "Campinas",
                                                                   "uf": "SP", "cep": "13010000", "emails": ["a@capa.com.br"]}).json()
        assert "id" in cli, cli
        ct = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": "Trabalhista Capa"}).json()
        r = cliente.get(f"/api/tribunais/capa?numero={n}&contrato_id={ct['id']}", headers=h)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["tribunal"] == "TRT15" and c["tipo"] == "judicial_trabalhista" and c["instancia"] == "primeira"
        assert c["comarca"] == "Campinas" and c["vara"] == "2ª Vara do Trabalho de Campinas" and c["data_distribuicao"] == "2025-02-10"
        assert c["polo"] == "passivo" and c["parte_contraria"] == "Maria Operária" and c["titulo"].startswith("Ação Trabalhista")
        assert cliente.get("/api/tribunais/capa?numero=0000000-00.0000.0.00.0000", headers=h).status_code == 400

        r = cliente.post(f"/api/faturamento/contratos/{ct['id']}/casos", headers=h, json={
            "titulo": c["titulo"], "numero_processo": n, "tipo": c["tipo"], "tribunal": c["tribunal"], "vara": c["vara"],
            "comarca": c["comarca"], "instancia": c["instancia"], "polo": c["polo"], "parte_contraria": c["parte_contraria"],
            "data_distribuicao": c["data_distribuicao"]})
        assert r.status_code == 201, r.text
        caso_id = r.json()["id"]
        ands = cliente.get(f"/api/faturamento/casos/{caso_id}/andamentos", headers=h).json()
        assert len(ands) == 3  # 2 do DataJud + a citação do DJEN, por trás
        proc = cliente.get(f"/api/tribunais/casos/{caso_id}/processo", headers=h).json()
        assert proc["numero_formatado"] == n and proc["caso_id"] == caso_id
        with SessionLocal() as db:  # autos baixados (MNI) aparecem nos anexos do caso
            p = db.get(Processo, proc["id"])
            d = DocumentoAutos(processo_id=p.id, id_documento_tribunal="1", tipo_documento_nome="Petição inicial", mimetype="application/pdf")
            p.documentos.append(d)
            db.flush()
            service.salvar_documento(d, p.tenant_id, _pdf("inicial"))
            assert caso_mod.anexar_autos(db, p) == 1 and caso_mod.anexar_autos(db, p) == 0
            db.commit()
        anexos = cliente.get(f"/api/faturamento/casos/{caso_id}/anexos", headers=h).json()
        assert any(a["categoria"] == "Autos do processo" for a in anexos)
    finally:
        with SessionLocal() as db:
            service.plataforma(db).djen_proxy_url = None
            db.commit()
