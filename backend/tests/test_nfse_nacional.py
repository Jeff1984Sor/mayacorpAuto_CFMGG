"""NFS-e Nacional: a DPS segue o XSD oficial, a assinatura confere e o retorno do governo é lido."""

from datetime import date, datetime
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives import serialization
from lxml import etree

from app.core.certificados import certificado_de_simulacao
from app.modules.rpa_nfse.nfse_nacional import cliente as cli
from app.modules.rpa_nfse.nfse_nacional import dps
from app.modules.rpa_nfse.nfse_nacional.erros import traduzir
from tests.test_api_fluxo import cliente  # noqa: F401  (fixture)

SOROCABA = "3552205"


def _dps(**k) -> dps.Dps:
    base = dict(
        prestador=dps.Prestador(documento="37.552.605/0001-03", codigo_municipio=SOROCABA, opcao_simples=dps.MEI),
        serie="1", numero=12, competencia=date(2026, 11, 27), cod_tributacao_nacional="010101",
        descricao="Licença de uso do MayaJus - novembro/2026", valor=Decimal("279.00"),
        emitida_em=datetime(2026, 11, 27, 10, 30, tzinfo=dps.BRASILIA),
        tomador=dps.Tomador(nome="Escritório  Exemplo Advogados", documento="11.444.777/0001-61", codigo_municipio="3550308",
                            cep="01310-100", logradouro="Av. Paulista", numero="1000", bairro="Bela Vista",
                            email="financeiro@exemplo.com.br", telefone="(11) 3333-4444"),
    )
    return dps.Dps(**{**base, **k})


def test_id_e_ordem_da_dps_mei():
    raiz = dps.montar(_dps())
    inf = raiz[0]
    assert raiz.get("versao") == "1.01" and raiz.nsmap[None] == dps.NS
    assert inf.get("Id") == "DPS" + SOROCABA + "2" + "37552605000103" + "00001" + "000000000000012" and len(inf.get("Id")) == 45
    nomes = [etree.QName(e).localname for e in inf]
    assert nomes == ["tpAmb", "dhEmi", "verAplic", "serie", "nDPS", "dCompet", "tpEmit", "finNFSe", "cLocEmi", "prest", "toma",
                     "indDest", "serv", "valores"]
    txt = {etree.QName(e).localname: (e.text or "") for e in inf.iter() if len(e) == 0}
    assert (txt["tpAmb"], txt["dhEmi"], txt["serie"], txt["nDPS"], txt["dCompet"], txt["cLocEmi"]) == (
        "2", "2026-11-27T10:30:00-03:00", "1", "12", "2026-11-27", SOROCABA)
    assert (txt["opSimpNac"], txt["regEspTrib"], txt["cTribNac"], txt["vServ"], txt["tribISSQN"], txt["tpRetISSQN"], txt["indTotTrib"]) == (
        "2", "0", "010101", "279.00", "1", "1", "0")
    assert (txt["xNome"], txt["CEP"], txt["cMun"], txt["fone"], txt["cLocPrestacao"]) == (
        "Escritório Exemplo Advogados", "01310100", "3550308", "1133334444", SOROCABA)
    assert "pAliq" not in txt and "regApTribSN" not in txt  # MEI não informa alíquota nem regime de apuração
    assert dps.validar_xsd(raiz, layout="rtc") == []


def test_layout_novo_da_producao_restrita():
    """Na produção restrita o governo já exige o layout da Reforma Tributária: finNFSe e indDest a mais."""
    for d in (_dps(), _dps(tomador=None), _dps(ambiente="1")):
        raiz = dps.montar(d)
        nomes = [etree.QName(e).localname for e in raiz[0]]
        if d.ambiente == "2":
            assert d.layout == "rtc" and nomes[nomes.index("tpEmit") + 1] == "finNFSe" and "indDest" in nomes
            assert nomes.index("indDest") == nomes.index("prest") + (2 if d.tomador else 1)
            assert dps.validar_xsd(raiz, layout="rtc") == []
            assert dps.validar_xsd(raiz, layout="atual") != []  # o layout de produção não aceita os campos novos
        else:
            assert d.layout == "atual" and "finNFSe" not in nomes and "indDest" not in nomes
            assert dps.validar_xsd(raiz, layout="atual") == []
    assert dps.assinatura_confere(dps.gerar(_dps(), certificado_de_simulacao()))


def test_variacoes_passam_no_xsd_oficial():
    casos = [
        _dps(tomador=None),  # sem tomador identificado
        _dps(tomador=dps.Tomador(nome="Maria da Silva", documento="529.982.247-25")),  # pessoa física, sem endereço
        _dps(tomador=dps.Tomador(nome="Consumidor")),  # sem documento
        _dps(prestador=dps.Prestador(documento="37552605000103", codigo_municipio=SOROCABA, opcao_simples=dps.ME_EPP,
                                     regime_apuracao_sn="1", email="a@b.com", telefone="15999990000", inscricao_municipal="123456"),
             percentual_tributos_sn=Decimal("6.00"), nbs="115021000", cod_tributacao_municipal="1", informacoes="Pedido  42"),
        _dps(prestador=dps.Prestador(documento="37552605000103", codigo_municipio="3550308", opcao_simples=dps.NAO_OPTANTE),
             aliquota_iss=Decimal("5"), iss_retido=True, desconto_incondicional=Decimal("10"), local_prestacao="3550308",
             ambiente="1", valor=Decimal("1234567.8")),
        _dps(prestador=dps.Prestador(documento="52998224725", codigo_municipio=SOROCABA)),  # prestador pessoa física
        _dps(nbs="115021000", ambiente="1"),  # NBS no layout atual: descrição antes do NBS
    ]
    for d in casos:
        raiz = dps.montar(d)
        assert dps.validar_xsd(raiz, layout=d.layout) == [], etree.tostring(raiz, pretty_print=True).decode()
    xml = etree.tostring(dps.montar(casos[3]), encoding="unicode")
    assert "<regApTribSN>1</regApTribSN>" in xml and "<pTotTribSN>6.00</pTotTribSN>" in xml and "<cTribMun>001</cTribMun>" in xml
    assert "<xInfComp>Pedido 42</xInfComp>" in xml and "<cNBS>115021000</cNBS>" in xml
    xml = etree.tostring(dps.montar(casos[4]), encoding="unicode")
    assert "<pAliq>5.00</pAliq>" in xml and "<tpRetISSQN>2</tpRetISSQN>" in xml and "<vDescIncond>10.00</vDescIncond>" in xml
    assert "<vServ>1234567.80</vServ>" in xml and "<tpAmb>1</tpAmb>" in xml
    assert "<cNaoNIF>0</cNaoNIF>" in etree.tostring(dps.montar(casos[2]), encoding="unicode")
    assert dps.id_dps(casos[5].prestador, "1", 12)[10:25] == "1" + "00052998224725"  # CPF: tipo 1 e zeros à esquerda


def test_dados_ruins_sao_recusados_antes_de_montar():
    ruim = _dps(prestador=dps.Prestador(documento="123", codigo_municipio="35", opcao_simples="9"), cod_tributacao_nacional="1",
                descricao=" ", valor=Decimal(0), serie="ABC", numero=0, tomador=dps.Tomador(nome=""))
    assert len(dps.conferir(ruim)) == 9
    with pytest.raises(dps.DpsInvalida) as e:
        dps.montar(ruim)
    assert len(e.value.erros) == 9
    assert any("regime de apuração" in x for x in dps.conferir(
        _dps(prestador=dps.Prestador(documento="37552605000103", codigo_municipio=SOROCABA, opcao_simples=dps.ME_EPP))))


def test_assinatura_envelopada_confere():
    cert = certificado_de_simulacao()
    xml = dps.gerar(_dps(), cert)
    raiz = etree.fromstring(xml)
    assert [etree.QName(e).localname for e in raiz] == ["infDPS", "Signature"]  # assinatura é o último filho da raiz
    assert raiz[1].prefix is None and raiz[1].tag == f"{{{dps.NS_DS}}}Signature"  # sem prefixo ds:
    ref = raiz[1].find(f".//{{{dps.NS_DS}}}Reference")
    assert ref.get("URI") == "#" + raiz[0].get("Id")
    algs = [e.get("Algorithm") for e in raiz[1].iter() if e.get("Algorithm")]
    assert "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" in algs
    assert "http://www.w3.org/2000/09/xmldsig#enveloped-signature" in algs
    assert dps.validar_xsd(raiz, layout="rtc") == []  # com a assinatura, continua dentro do esquema
    # conferência independente (resumo + RSA com a chave pública do certificado que vai no XML)
    assert dps.assinatura_confere(xml)
    assert not dps.assinatura_confere(xml.replace(b"279.00", b"979.00"))  # conteúdo adulterado
    trocado = xml.replace(raiz[1].findtext(f"{{{dps.NS_DS}}}SignatureValue")[:8].encode(), b"AAAAAAAA", 1)
    assert not dps.assinatura_confere(trocado)  # assinatura adulterada
    assert not dps.assinatura_confere(b"<x/>") and not dps.assinatura_confere(b"lixo")
    der = cert.cert.public_bytes(serialization.Encoding.DER)
    import base64

    assert base64.b64decode(raiz[1].findtext(f".//{{{dps.NS_DS}}}X509Certificate")) == der
    assert dps.gerar(_dps(), None).count(b"Signature") == 0  # sem certificado (simulado): só o XML


def test_pedido_de_cancelamento():
    # formato real (a nota de teste gerada pelo governo em 27/11/2026): município (7) + 2 dígitos + inscrição (14) + 27
    chave = "35522052237552605000103000000000000126113227642863"
    assert len(chave) == 50
    xml = dps.gerar_cancelamento(certificado_de_simulacao(), chave_acesso=chave, documento_autor="37552605000103",
                                 motivo="Nota emitida com o valor errado", codigo_motivo="1")
    raiz = etree.fromstring(xml)
    assert raiz[0].get("Id") == "PRE" + chave + "101101" and len(raiz[0].get("Id")) == 59
    assert dps.validar_xsd(raiz, "pedRegEvento_v1.01.xsd", "rtc") == []
    assert dps.validar_xsd(raiz, "pedRegEvento_v1.01.xsd", "atual") == []
    assert b"<cMotivo>1</cMotivo>" in xml and b"<xDesc>Cancelamento de NFS-e</xDesc>" in xml
    assert b"<CNPJAutor>37552605000103</CNPJAutor>" in xml
    for ruim in (dict(chave_acesso="123", motivo="Nota emitida com o valor errado"), dict(chave_acesso=chave, motivo="curto"),
                 dict(chave_acesso=chave, motivo="Nota emitida com o valor errado", codigo_motivo="7")):
        with pytest.raises(dps.DpsInvalida):
            dps.montar_cancelamento(documento_autor="37552605000103", **ruim)


def test_retorno_do_governo_e_simulador():
    nfse = b"<NFSe xmlns=\"http://www.sped.fazenda.gov.br/nfse\"><infNFSe Id=\"NFS1\"><nNFSe>57</nNFSe></infNFSe></NFSe>"
    ok = cli.interpretar(201, {"tipoAmbiente": 2, "idDps": "DPS1", "chaveAcesso": "9" * 50, "nfseXmlGZipB64": cli.compactar(nfse),
                               "alertas": [{"Codigo": "A1", "Descricao": "aviso"}]})
    assert (ok.sucesso, ok.chave_acesso, ok.numero, ok.id_dps, ok.xml, ok.http) == (True, "9" * 50, 57, "DPS1", nfse, 201)
    assert ok.alertas[0].codigo == "A1" and cli.descompactar(cli.compactar(nfse)) == nfse
    # erros vêm com maiúsculas ou minúsculas, conforme o serviço
    for corpo in ({"erros": [{"Codigo": "E0714", "Descricao": "Arquivo enviado com erro na assinatura", "Complemento": "x"}]},
                  {"Erros": [{"codigo": "E0714", "descricao": "Arquivo enviado com erro na assinatura"}]}):
        r = cli.interpretar(400, corpo)
        assert not r.sucesso and r.erros[0].codigo == "E0714" and "assinatura" in r.erros[0].humano()["mensagem"]
    assert cli.interpretar(403, None).erros[0].descricao.startswith("O Sistema Nacional respondeu HTTP 403")
    assert cli.interpretar(400, {"message": "bad"}).erros[0].descricao == "bad"
    assert cli.interpretar(200, {"erro": {"codigo": "E1", "descricao": "d"}}).erros[0].codigo == "E1"
    assert cli.numero_da_nfse(b"<x") is None and cli.numero_da_nfse(b"<a/>") is None
    assert traduzir("E9999", "Texto do governo", "mais")["mensagem"] == "Texto do governo"
    # simulado: não chama ninguém e devolve uma chave de 50 dígitos, sempre a mesma para a mesma DPS
    sim = cli.ClienteNacional(None, "simulado")
    xml = dps.gerar(_dps(), None)
    r1, r2 = sim.emitir(xml), sim.emitir(xml)
    assert r1.sucesso and r1.simulado and len(r1.chave_acesso) == 50 and r1.chave_acesso.isdigit() and r1.chave_acesso == r2.chave_acesso
    assert r1.chave_acesso[:7] == SOROCABA and r1.chave_acesso[8:23] == "237552605000103"
    assert r1.numero == 12 and sim.ambiente == "2" and sim.chave_da_dps("x") is None and sim.danfse("x") is None
    assert sim.cancelar("9" * 50, b"<x/>").sucesso and not sim.consultar("9" * 50).sucesso
    assert sim.link_danfse("123").endswith("/danfse/123") and "producaorestrita" in sim.link_danfse("123")
    with pytest.raises(RuntimeError):
        cli.ClienteNacional(None, "teste")
    with pytest.raises(ValueError):
        cli.ClienteNacional(None, "outro")


def test_emissora_no_emissor_nacional_de_ponta_a_ponta(cliente):  # noqa: F811
    """Empresa de Sorocaba (MEI) emitindo pelo Sistema Nacional: cadastro, fatura → nota (simulação) e cancelamento."""
    from tests.test_api_fluxo import _login
    from tests.test_boletos_api import _cnpj

    h = _login(cliente)
    # emissora própria do teste (o banco de testes é compartilhado: a do seed continua na Prefeitura de SP)
    base = {"razao_social": "Empresa Sorocaba MEI", "cnpj": _cnpj(37552601), "ccm": "", "sistema_emissao": "nacional",
            "regime": "mei", "cep": "18035000", "cidade": "Sorocaba", "uf": "SP", "codigo_municipio": SOROCABA,
            "cod_trib_nacional": "01.01.01", "serie_rps": "1", "prox_rps": 1, "aliquota_iss": "0.02"}
    for troca, trecho in (({"codigo_municipio": ""}, "IBGE"), ({"cod_trib_nacional": "123"}, "tributação nacional"),
                          ({"serie_rps": "A"}, "série"), ({"sistema_emissao": "prefeitura_sp"}, "CCM")):
        r = cliente.post("/api/nfse/emissoras", headers=h, json={**base, **troca})
        assert r.status_code == 400 and trecho in r.json()["detail"], r.text
    r = cliente.post("/api/nfse/emissoras", headers=h, json=base)
    assert r.status_code == 200, r.text
    em = r.json()
    assert (em["sistema_emissao"], em["codigo_municipio"], em["cod_trib_nacional"], em["ccm"]) == ("nacional", SOROCABA, "010101", "")
    assert em["saude_ok"], em["saude_msg"]
    r = cliente.put(f"/api/nfse/emissoras/{em['id']}", headers=h, json={**base, "razao_social": "Empresa Sorocaba MEI Ltda"})
    assert r.status_code == 200 and r.json()["sistema_emissao"] == "nacional", r.text

    cli = cliente.post("/api/nfse/tomadores", headers=h, json={"tipo": "PJ", "nome": "Escritório Cliente Nacional",
                                                              "cpf_cnpj": _cnpj(37552602), "emails": ["fin@nacional.com.br"]})
    assert cli.status_code in (200, 201), cli.text
    cli = cli.json()
    contrato = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": "Licença MayaJus",
                                                                           "emissora_id": em["id"]})
    assert contrato.status_code == 201, contrato.text
    contrato = contrato.json()
    hoje = date.today().isoformat()
    cliente.post(f"/api/faturamento/contratos/{contrato['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": "Licença de uso do sistema", "valor": "279.00", "data_pagamento": hoje})
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    itens = cliente.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    nh = cliente.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params,
                                                                   "chaves": [i["chave"] for i in itens]}).json()["faturas"][0]
    lote_id = cliente.post("/api/faturamento/emitir-nfse", headers=h, json={"fatura_ids": [nh["id"]]}).json()["lote_id"]
    lote = cliente.get(f"/api/nfse/importacoes/{lote_id}", headers=h).json()
    rps = lote["rps"][0]
    assert rps["status"] in ("ok", "aviso"), rps  # sem exigir NBS/cClassTrib da Prefeitura nem alíquota do MEI
    assert not any(p["campo"] in ("nbs", "class_trib", "ind_operacao", "aliquota") for p in rps["erros"]), rps
    r = cliente.post(f"/api/nfse/importacoes/{lote_id}/emitir", headers=h)
    assert r.status_code == 200, r.text
    lote = cliente.get(f"/api/nfse/importacoes/{lote_id}", headers=h).json()
    assert lote["status"] == "concluido", lote
    fat = cliente.get(f"/api/nfse/faturas/{nh['id']}", headers=h).json()
    assert fat["nfse_id"], fat
    nota = cliente.get(f"/api/nfse/notas/{fat['nfse_id']}", headers=h).json()
    assert len(nota["chave_acesso"]) == 50 and nota["chave_acesso"].startswith(SOROCABA), nota
    assert nota["link_prefeitura"] == "https://www.nfse.gov.br/ConsultaPublica"
    import io

    from pypdf import PdfReader

    pdf = cliente.get(f"/api/nfse/notas/{fat['nfse_id']}/pdf", headers=h)
    texto = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    assert "Sistema Nacional NFS-e" in texto and nota["chave_acesso"] in texto and "ConsultaPublica" in texto, texto
    # cancelamento: nota de simulação sai só do sistema (não vai ao governo)
    r = cliente.post(f"/api/nfse/notas/{fat['nfse_id']}/cancelar", headers=h, json={"motivo": "Teste de cancelamento da nota"})
    assert r.status_code == 200 and r.json()["status"] == "cancelada", r.text


def test_nota_recuperada_so_vale_se_o_valor_bater():
    """Numeração já usada por outra nota (ex.: emitida no portal): não liga a nota alheia à fatura."""
    from app.modules.rpa_nfse.nfse_nacional import emissao

    nfse = lambda v: cli.compactar(  # noqa: E731
        f"<NFSe xmlns=\"{dps.NS}\"><infNFSe><nNFSe>9</nNFSe><valores><vServ>{v}</vServ></valores></infNFSe></NFSe>".encode())
    assert emissao.valor_da_nfse(cli.descompactar(nfse("279.00"))) == Decimal("279.00")
    assert emissao.valor_da_nfse(None) is None and emissao.valor_da_nfse(b"<x") is None

    class Falso:
        ambiente, cert = "2", None

        def __init__(self, valor):
            self.valor = valor

        def emitir(self, xml):
            return cli.RetornoNacional(sucesso=False, erros=[cli.ErroNacional("E0014", "DPS já utilizada")])

        def chave_da_dps(self, id_dps):
            return "9" * 50

        def consultar(self, chave):
            return cli.interpretar(200, {"chaveAcesso": chave, "nfseXmlGZipB64": nfse(self.valor)})

    from types import SimpleNamespace

    from app.modules.rpa_nfse.models import Regime

    e = SimpleNamespace(cnpj="37552605000103", codigo_municipio=SOROCABA, regime=Regime.mei, ccm="", telefone=None, email=None,
                        cod_trib_nacional="010101")
    r = SimpleNamespace(dados_json={"tomador": {"nome": "Cliente", "cpf_cnpj": "11444777000161"}}, serie="1", numero=5,
                        data_emissao=date(2026, 11, 27), discriminacao="Licença", valor=Decimal("279.00"), iss_retido=False, aliquota=Decimal(0))
    salvos, recusados = [], []
    ok = emissao.emitir_um(Falso("279.00"), r, e, lambda rr, ret: salvos.append(ret), lambda rr, p: recusados.append(p), lambda: None)
    assert ok and salvos and salvos[0].chave_acesso == "9" * 50 and not recusados
    salvos.clear()
    r.dados_json = {"tomador": {"nome": "Cliente"}}
    ok = emissao.emitir_um(Falso("999.00"), r, e, lambda rr, ret: salvos.append(ret), lambda rr, p: recusados.append(p), lambda: None)
    assert not ok and not salvos and "já foi usada em outra nota" in recusados[0][0]["mensagem"]
