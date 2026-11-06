from decimal import Decimal

from lxml import etree

from app.core.certificados import carregar_pfx, ler_info
from app.modules.rpa_nfse import parser_txt
from app.modules.rpa_nfse.prefeitura_sp import xml_layout2
from tests.conftest import detalhe


def test_parser_le_arquivo_cp1252_com_acentos():
    conteudo = parser_txt.gerar_arquivo("12345678", [detalhe(1021, nome="JOÃO DA SILVA", ind_doc="1", doc="52998224725"), detalhe(1022)])
    arq = parser_txt.ler(conteudo)
    assert arq.encoding == "cp1252"
    assert arq.ccm_prestador == "12345678"
    assert len(arq.detalhes) == 2
    d = arq.detalhes[0]
    assert d.numero == 1021 and d.nome_tomador == "JOÃO DA SILVA"
    assert d.doc_tomador == "52998224725"
    assert d.valor == Decimal("1250.00") and d.aliquota == Decimal("0.05")
    assert d.discriminacao == "Honorarios advocaticios ref. outubro\nProcesso 123"
    assert arq.detalhes[1].doc_tomador == "11444777000161"
    assert not arq.problemas


def test_parser_detecta_rodape_divergente():
    conteudo = parser_txt.gerar_arquivo("12345678", [detalhe(1)]).replace(b"9000000100", b"9000000200")
    arq = parser_txt.ler(conteudo)
    assert any("rodapé informa 2" in p.mensagem for p in arq.problemas)


def test_info_certificado(pfx):
    info = ler_info(pfx, "1234")
    assert info.cnpj == "11222333000181"
    assert info.titular == "CFME ADVOGADOS"


def _rps(n=1):
    from datetime import date

    return xml_layout2.RpsXml(
        serie="A", numero=n, tipo="RPS", data_emissao=date(2026, 10, 1), status="N", tributacao="T",
        valor=Decimal("1250.00"), deducoes=Decimal("0"), cod_servico="03220", aliquota=Decimal("0.05"),
        iss_retido=False, discriminacao="Honorários advocatícios",
        tomador={"cpf_cnpj": "11444777000161", "nome": "Condomínio Ed. Solar", "logradouro": "Rua X", "numero": "10",
                 "cep": "01001000", "uf": "SP", "codigo_municipio": "3550308", "email": "a@b.com", "im": "1234567"},
        layout2={"nbs": "113011000", "class_trib": "000001", "ind_operacao": "100301"},
    )


def test_xml_lote_layout2_valida_no_xsd_oficial(pfx):
    cert = carregar_pfx(pfx, "1234")
    pedido = xml_layout2.pedido_envio_lote(cnpj_remetente="11222333000181", ccm="12345678", rps=[_rps(1), _rps(2)], cert=cert)
    erros = xml_layout2.validar_xsd(pedido, "PedidoEnvioLoteRPS_v02.xsd")
    assert erros == [], erros
    texto = xml_layout2.para_bytes(pedido).decode()
    assert "<ds:Signature" in texto and "rsa-sha256" in texto
    assert "Honorarios advocaticios" in texto  # sem acento


def test_assinatura_do_xml_confere(pfx):
    from signxml import XMLVerifier
    from signxml.algorithms import SignatureMethod
    from signxml.verifier import SignatureConfiguration

    cert = carregar_pfx(pfx, "1234")
    pedido = xml_layout2.pedido_envio_lote(cnpj_remetente="11222333000181", ccm="12345678", rps=[_rps()], cert=cert)
    from cryptography.hazmat.primitives import serialization

    pem = cert.cert.public_bytes(serialization.Encoding.PEM)
    XMLVerifier().verify(etree.fromstring(xml_layout2.para_bytes(pedido)), x509_cert=pem,
                         expect_config=SignatureConfiguration(signature_methods=frozenset({SignatureMethod.RSA_SHA256})))


def test_string_assinatura_v2_tem_ccm_12():
    from datetime import date

    from app.modules.rpa_nfse.prefeitura_sp.assinatura import string_assinatura_rps

    s = string_assinatura_rps(ccm="12345678", serie="A", numero=1, data_emissao=date(2026, 10, 1), tributacao="T",
                              status="N", iss_retido=False, valor=Decimal("100"), deducoes=Decimal(0),
                              cod_servico="3220", ind_tomador="2", doc_tomador="11444777000161")
    assert s.startswith("000012345678A    000000000001")
    assert len(s) == 90


def test_retencoes_federais_como_na_nfse_20806(pfx):
    """NFS-e 20806 (Porto Seguro, R$ 1.150): IR 17,25 · PIS 7,48 · COFINS 34,50 · CSLL 11,50, alíquota 0 (03380)."""
    from dataclasses import replace

    cert = carregar_pfx(pfx, "1234")
    l2 = {"nbs": "113012000", "class_trib": "200052", "ind_operacao": "100301", "ret_ir": "0.0150",
          "ret_pis": "0.0065", "ret_cofins": "0.0300", "ret_csll": "0.0100", "retencao_pis_cofins": "3"}
    pj = replace(_rps(), valor=Decimal("1150.00"), cod_servico="03380", aliquota=Decimal("0"), layout2=l2)
    pedido = xml_layout2.pedido_envio_lote(cnpj_remetente="11222333000181", ccm="12345678", rps=[pj], cert=cert)
    assert xml_layout2.validar_xsd(pedido, "PedidoEnvioLoteRPS_v02.xsd") == []
    rps = pedido.find("RPS")
    valores = {t: rps.findtext(t) for t in ("ValorPIS", "ValorCOFINS", "ValorINSS", "ValorIR", "ValorCSLL",
                                            "AliquotaServicos", "RetencaoPisCofins", "ValorFinalCobrado")}
    assert valores == {"ValorPIS": "7.48", "ValorCOFINS": "34.50", "ValorINSS": "0.00", "ValorIR": "17.25",
                       "ValorCSLL": "11.50", "AliquotaServicos": "0.0000", "RetencaoPisCofins": "3",
                       "ValorFinalCobrado": "1150.00"}
    # Pessoa física não retém, mesmo com a regra ativa
    pf = replace(pj, tomador={**pj.tomador, "cpf_cnpj": "52998224725"})
    rps_pf = xml_layout2.pedido_envio_lote(cnpj_remetente="11222333000181", ccm="12345678", rps=[pf], cert=cert).find("RPS")
    assert rps_pf.findtext("ValorIR") == "0.00" and rps_pf.find("RetencaoPisCofins") is None


def test_aliquota_zero_da_regra_vence_a_da_emissora():
    """Sociedade de advogados (03380): regra com alíquota 0 = ISS fixo, sem erro de faixa e sem ISS na nota."""
    from datetime import date

    from app.modules.rpa_nfse import validator
    from app.modules.rpa_nfse.models import Emissora, ParametroFiscal, Rps

    em = Emissora(aliquota_iss=Decimal("0.05"))
    regra = ParametroFiscal(escopo="padrao", ativo=True, prioridade=0, aliquota_iss=Decimal("0"), nbs="113012000",
                            class_trib="200052", ind_operacao="100301", ret_ir=Decimal("0.015"))
    ctx = validator.ContextoValidacao(emissora=em, parametros=[regra], servicos_permitidos=set(), hoje=date(2026, 11, 6))
    for aliq_origem in (Decimal("0"), Decimal("0.05")):  # do TXT (0000) ou da fatura (padrão da emissora)
        r = Rps(serie="125", numero=1, data_emissao=date(2026, 10, 31), valor=Decimal("1150"), deducoes=Decimal(0),
                cod_servico="03380", aliquota=aliq_origem, tomador_novo=False, status="pendente",
                dados_json={"tomador": {"tipo": "PJ", "nome": "Porto", "cpf_cnpj": "61198164000160", "cep": "01205001",
                                        "email": "a@b.com"}})
        validator.validar(r, ctx)
        assert r.aliquota == 0 and r.iss == 0
        assert not [p for p in r.erros_json if p["nivel"] == "erro"], r.erros_json
        assert Decimal(r.dados_json["layout2"]["ret_ir"]) == Decimal("0.015")
