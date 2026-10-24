"""Ler uma NFS-e já emitida e configurar a empresa emissora: XML exato (sem IA), PDF/foto via IA."""

import io

from app.core import ia
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)

XML_SP = """<?xml version="1.0" encoding="UTF-8"?>
<RetornoConsulta xmlns="http://www.prefeitura.sp.gov.br/nfe"><Cabecalho xmlns="" Versao="2"><Sucesso>true</Sucesso></Cabecalho>
<NFe xmlns="">
  <ChaveNFe><InscricaoPrestador>57038597</InscricaoPrestador><NumeroNFe>1987</NumeroNFe><CodigoVerificacao>ABCD1234</CodigoVerificacao></ChaveNFe>
  <DataEmissaoNFe>2026-09-30T10:00:00</DataEmissaoNFe>
  <ChaveRPS><InscricaoPrestador>57038597</InscricaoPrestador><SerieRPS>NF</SerieRPS><NumeroRPS>4521</NumeroRPS></ChaveRPS>
  <CPFCNPJPrestador><CNPJ>11222333000181</CNPJ></CPFCNPJPrestador>
  <RazaoSocialPrestador>CFME SOCIEDADE DE ADVOGADOS</RazaoSocialPrestador>
  <EnderecoPrestador><TipoLogradouro>AV</TipoLogradouro><Logradouro>PAULISTA</Logradouro><NumeroEndereco>1000</NumeroEndereco>
    <ComplementoEndereco>10 ANDAR</ComplementoEndereco><Bairro>BELA VISTA</Bairro><Cidade>3550308</Cidade><UF>SP</UF><CEP>1310100</CEP></EnderecoPrestador>
  <EmailPrestador>financeiro@cfme.com.br</EmailPrestador>
  <OpcaoSimples>0</OpcaoSimples>
  <ValorFinalCobrado>1250.00</ValorFinalCobrado>
  <CodigoServico>3220</CodigoServico><AliquotaServicos>0.05</AliquotaServicos><ISSRetido>false</ISSRetido>
  <CPFCNPJTomador><CNPJ>11444777000161</CNPJ></CPFCNPJTomador><RazaoSocialTomador>CONDOMINIO SOLAR</RazaoSocialTomador>
  <Discriminacao>Honorarios advocaticios</Discriminacao>
  <NBS>113011000</NBS>
  <IBSCBS><finNFSe>0</finNFSe><indFinal>0</indFinal><cIndOp>100301</cIndOp>
    <valores><trib><gIBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib></gIBSCBS></trib></valores></IBSCBS>
</NFe></RetornoConsulta>"""


def test_xml_configura_empresa_e_parametros_sem_ia(cliente):  # noqa: F811
    h = _login(cliente)
    cliente.put("/api/config/ia", headers=h, json={"ativo": False, "provedor": "openai"})  # prova que não precisa de IA
    r = cliente.post("/api/nfse/emissoras/ler-nota", headers=h, files={"arquivo": ("nota.xml", XML_SP.encode())})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["fonte"] == "xml"
    assert d["empresa"] == {"razao_social": "CFME SOCIEDADE DE ADVOGADOS", "cnpj": "11222333000181", "ccm": "57038597",
                            "logradouro": "AV PAULISTA", "numero": "1000", "complemento": "10 ANDAR",
                            "bairro": "BELA VISTA", "uf": "SP", "cep": "01310100", "email": "financeiro@cfme.com.br",
                            "cidade": "São Paulo"}
    assert d["fiscal"] == {"cod_servico_padrao": "03220", "aliquota_iss": "0.0500", "iss_retido": False,
                           "serie_rps": "NF", "prox_rps": 4522}
    assert d["parametros"] == {"nbs": "113011000", "class_trib": "000001", "cst_ibscbs": "000", "ind_operacao": "100301",
                               "finalidade": "0", "ind_final": "0"}
    assert d["nota"]["numero"] == "1987" and not d["avisos"]


def test_xml_do_proprio_sistema_e_aplicar_parametros_sem_duplicar(cliente):  # noqa: F811
    h = _login(cliente)
    nota = cliente.get("/api/nfse/notas", headers=h).json()["itens"][0]
    xml = cliente.get(f"/api/nfse/notas/{nota['id']}/xml", headers=h).content
    d = cliente.post("/api/nfse/emissoras/ler-nota", headers=h, files={"arquivo": ("NFSe.xml", xml)}).json()
    assert d["fiscal"]["cod_servico_padrao"] == "03220" and d["parametros"]["nbs"] == "113011000"
    eid = cliente.get("/api/nfse/emissoras", headers=h).json()[0]["id"]
    antes = len(cliente.get("/api/config/parametros-fiscais", headers=h).json())
    for _ in range(2):
        r = cliente.post(f"/api/nfse/emissoras/{eid}/parametros-padrao", headers=h, json=d["parametros"])
        assert r.status_code == 200 and r.json()["escopo"] == "padrao"
    assert len(cliente.get("/api/config/parametros-fiscais", headers=h).json()) == antes  # atualiza, não duplica


def test_pdf_passa_pela_ia_e_e_validado(cliente, monkeypatch):  # noqa: F811
    from reportlab.pdfgen import canvas

    from tests.test_ia import _ativar

    h = _login(cliente)
    monkeypatch.setattr(ia, "listar_modelos", lambda *a: ["m"])
    _ativar(cliente, h)
    vistos = {}

    def falsa(p, sistema, usuario, anexo=None):
        vistos["texto"] = usuario
        return {"empresa": {"razao_social": "ESCRITORIO X", "cnpj": "11.222.333/0001-81", "ccm": "5.703.859-7"},
                "fiscal": {"cod_servico_padrao": "3220", "aliquota_iss": "5,00%", "ultimo_rps": "99"},
                "parametros": {"nbs": "1.1301.10.00", "class_trib": "12"}}

    monkeypatch.setattr(ia, "gerar_json", falsa)
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(50, 800, "NOTA FISCAL ELETRONICA DE SERVICOS - NFS-e  Prestador: ESCRITORIO X  CNPJ 11.222.333/0001-81")
    c.drawString(50, 780, "Codigo do servico 03220  Aliquota 5,00%  RPS 99  NBS 1.1301.10.00")
    c.save()
    d = cliente.post("/api/nfse/emissoras/ler-nota", headers=h,
                     files={"arquivo": ("nota.pdf", buf.getvalue(), "application/pdf")}).json()
    assert "NOTA FISCAL" in vistos["texto"]
    assert d["fonte"] == "pdf" and d["empresa"]["cnpj"] == "11222333000181" and d["empresa"]["ccm"] == "57038597"
    assert d["fiscal"]["aliquota_iss"] == "0.0500" and d["fiscal"]["prox_rps"] == 100
    assert d["parametros"] == {"nbs": "113011000"}  # cClassTrib com 2 dígitos é descartado, com aviso
    assert any("cClassTrib" in a for a in d["avisos"])


def test_arquivo_que_nao_e_nota(cliente):  # noqa: F811
    h = _login(cliente)
    r = cliente.post("/api/nfse/emissoras/ler-nota", headers=h, files={"arquivo": ("x.xml", b"<pedido><item/></pedido>")})
    assert r.status_code == 400 and "NFS-e" in r.json()["detail"]
