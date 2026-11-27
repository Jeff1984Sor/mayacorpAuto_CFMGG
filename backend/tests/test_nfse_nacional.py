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
    assert nomes == ["tpAmb", "dhEmi", "verAplic", "serie", "nDPS", "dCompet", "tpEmit", "cLocEmi", "prest", "toma", "serv", "valores"]
    txt = {etree.QName(e).localname: (e.text or "") for e in inf.iter() if len(e) == 0}
    assert (txt["tpAmb"], txt["dhEmi"], txt["serie"], txt["nDPS"], txt["dCompet"], txt["cLocEmi"]) == (
        "2", "2026-11-27T10:30:00-03:00", "1", "12", "2026-11-27", SOROCABA)
    assert (txt["opSimpNac"], txt["regEspTrib"], txt["cTribNac"], txt["vServ"], txt["tribISSQN"], txt["tpRetISSQN"], txt["indTotTrib"]) == (
        "2", "0", "010101", "279.00", "1", "1", "0")
    assert (txt["xNome"], txt["CEP"], txt["cMun"], txt["fone"], txt["cLocPrestacao"]) == (
        "Escritório Exemplo Advogados", "01310100", "3550308", "1133334444", SOROCABA)
    assert "pAliq" not in txt and "regApTribSN" not in txt  # MEI não informa alíquota nem regime de apuração
    assert dps.validar_xsd(raiz) == []


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
    ]
    for d in casos:
        raiz = dps.montar(d)
        assert dps.validar_xsd(raiz) == [], etree.tostring(raiz, pretty_print=True).decode()
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
    assert dps.validar_xsd(raiz) == []  # com a assinatura, continua dentro do esquema
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
    chave = "35522052" + "37552605000103" + "0" * 28
    assert len(chave) == 50
    xml = dps.gerar_cancelamento(certificado_de_simulacao(), chave_acesso=chave, documento_autor="37552605000103",
                                 motivo="Nota emitida com o valor errado", codigo_motivo="1")
    raiz = etree.fromstring(xml)
    assert raiz[0].get("Id") == "PRE" + chave + "101101" and len(raiz[0].get("Id")) == 59
    assert dps.validar_xsd(raiz, "pedRegEvento_v1.01.xsd") == []
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
    assert r1.numero == 12 and sim.ambiente == "2" and sim.chave_da_dps("x") is None and sim.danfse("x") is None
    assert sim.cancelar("9" * 50, b"<x/>").sucesso and not sim.consultar("9" * 50).sucesso
    assert sim.link_danfse("123").endswith("/danfse/123") and "producaorestrita" in sim.link_danfse("123")
    with pytest.raises(RuntimeError):
        cli.ClienteNacional(None, "teste")
    with pytest.raises(ValueError):
        cli.ClienteNacional(None, "outro")
