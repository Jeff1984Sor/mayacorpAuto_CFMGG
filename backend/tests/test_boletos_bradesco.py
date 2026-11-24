"""Bradesco (237) no CNAB 240: layout, nosso número (DV com "P"), código de barras, remessa, retorno e o fluxo pela API."""

import io
from datetime import date, timedelta
from decimal import Decimal

import pytest
from pypdf import PdfReader

from app.modules.boletos.bancos.base import DadosBoleto, DadosConvenio
from app.modules.boletos.bancos.bradesco import codigo_barras as cb
from app.modules.boletos.bancos.bradesco import layout as L
from app.modules.boletos.bancos.bradesco import nosso_numero as nn
from app.modules.boletos.bancos.registry import bancos_disponiveis, get_banco
from app.modules.boletos.bancos.santander.codigo_barras import dv_modulo10, fator_vencimento
from app.modules.boletos.cnab import LinhaInvalida, ValorNaoCabe
from app.modules.boletos.cnab.validators import conferir_estrutura
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj

HOJE = date.today()
VENC = HOJE + timedelta(days=20)


@pytest.mark.parametrize("registro", L.REGISTROS, ids=lambda r: r.__name__)
def test_todo_registro_do_bradesco_e_contiguo_de_1_a_240(registro):
    esperado = 1
    for c in registro.CAMPOS:
        assert c.inicio == esperado, f"{registro.__name__}.{c.nome}"
        esperado = c.fim + 1
    assert esperado == 241 and len(registro.montar()) == 240


def test_nosso_numero_do_bradesco():
    # exemplos do manual do Bradesco (carteira 19): 00000000001 → P, 00000000002 → 8
    assert nn.dv("19", "00000000001") == "P" and nn.dv("19", "00000000002") == "8"
    assert nn.montar(1, "19") == "00000000001P" and nn.montar(2, "19") == "000000000028"
    assert nn.valido("00000000001P", "19") and nn.valido("00000000001p", "19") and not nn.valido("000000000010", "19")
    assert not nn.valido("123", "09") and not nn.valido("", "09")
    zero = next(n for n in range(1, 200) if nn.dv("09", f"{n:011d}") == "0")  # resto 0 → DV 0
    assert nn.montar(zero, "09").endswith("0")
    assert nn.dv("9", "00000000001") == nn.dv("09", "00000000001")  # carteira com 1 dígito vale como 09
    for ruim in (0, 10 ** 11):
        with pytest.raises(ValueError):
            nn.montar(ruim, "09")
    with pytest.raises(ValueError):
        nn.dv("0A", "00000000001")


def _convenio(**k) -> DadosConvenio:
    base = dict(beneficiario_nome="Escritório Teste Advogados", beneficiario_documento="11222333000181", agencia="105",
                agencia_dv="8", conta="17398", conta_dv="3", codigo_beneficiario="", codigo_transmissao="",
                carteira="09", tipo_cobranca="1", codigo_protesto="3", mensagem_1="Não receber após 60 dias")
    return DadosConvenio(**{**base, **k})


def _boleto(n=1, **k) -> DadosBoleto:
    base = dict(id_empresa=f"MJ{n:010d}", seu_numero=f"NH{n:05d}", nosso_numero=nn.montar(n, "09"), valor=Decimal("1079.27"),
                data_emissao=date(2026, 11, 24), data_vencimento=date(2026, 12, 10), pagador_nome="João da Conceição Ltda",
                pagador_documento="11444777000161", pagador_endereco="Rua das Flores, 100", pagador_bairro="Centro",
                pagador_cep="01310100", pagador_cidade="São Paulo", pagador_uf="SP")
    return DadosBoleto(**{**base, **k})


def test_codigo_de_barras_do_bradesco():
    barras = cb.codigo_barras(agencia="105", carteira="09", nosso_numero=nn.montar(1, "09"), conta="17398",
                              vencimento=date(2026, 12, 10), valor=Decimal("1079.27"))
    assert len(barras) == 44 and barras[:4] == "2379" and cb.conferir(barras)
    assert barras[5:9] == f"{fator_vencimento(date(2026, 12, 10)):04d}" and barras[9:19] == "0000107927"
    assert barras[19:] == "0105" + "09" + "00000000001" + "0017398" + "0"  # agência · carteira · número · conta · 0
    linha = cb.linha_digitavel(barras)
    assert len(linha) == 47 and linha[:4] == "2379" and int(linha[9]) == dv_modulo10(linha[:9])
    assert linha[0:4] + linha[32] + linha[33:47] + linha[4:9] + linha[10:20] + linha[21:31] == barras
    ok = dict(agencia="105", carteira="09", nosso_numero=nn.montar(1, "09"), conta="17398", vencimento=date(2026, 12, 10), valor=Decimal(10))
    for troca in ({"agencia": "12345"}, {"carteira": "109"}, {"nosso_numero": "12"}, {"conta": "12345678"}, {"valor": Decimal(0)},
                  {"valor": Decimal("100000000")}):
        with pytest.raises(ValueError):
            cb.codigo_barras(**{**ok, **troca})


def test_remessa_do_bradesco():
    banco = get_banco("237")
    assert [b.codigo for b in bancos_disponiveis()] == ["033", "237"]
    conteudo = banco.gerar_remessa(_convenio(), [_boleto(1), _boleto(2)], 4, date(2026, 11, 24))
    conteudo.decode("ascii")
    linhas = conteudo.decode("latin-1").splitlines()
    assert conteudo.endswith(b"\\r\\n".decode("unicode_escape").encode()) and all(len(ln) == 240 for ln in linhas)
    assert [ln[7] + (ln[13] if ln[7] == "3" else "") for ln in linhas] == ["0", "1", "3P", "3Q", "3R", "3P", "3Q", "3R", "5", "9"]
    conferir_estrutura(linhas)
    h = L.HeaderArquivo.ler(linhas[0])
    assert (h["codigo_banco"], h["inscricao"], h["agencia"], h["agencia_dv"], h["conta"], h["conta_dv"]) == (237, 11222333000181, 105, "8", 17398, "3")
    assert (h["nome_banco"], h["codigo_remessa"], h["sequencial_arquivo"], h["versao_layout"], h["densidade"]) == ("BANCO BRADESCO S.A.", 1, 4, 84, 1600)
    lote = L.HeaderLote.ler(linhas[1])
    assert (lote["tipo_operacao"], lote["tipo_servico"], lote["versao_layout"], lote["numero_remessa"], lote["mensagem_1"]) == ("R", 1, 42, 4, "NAO RECEBER APOS 60 DIAS")
    p = L.SegmentoP.ler(linhas[2])
    assert (p["codigo_movimento"], p["agencia"], p["conta"], p["nn_carteira"], p["nn_zeros"], p["nn_numero"], p["nn_dv"]) == (1, 105, 17398, 9, 0, 1, nn.montar(1, "09")[-1])
    assert (p["codigo_carteira"], p["forma_cadastramento"], p["tipo_documento"], p["emissao_boleto"], p["distribuicao_boleto"]) == (1, 1, "1", 2, "2")
    assert (p["seu_numero"], p["vencimento"], p["valor"], p["especie"], p["aceite"], p["data_emissao"]) == ("NH00001", date(2026, 12, 10), Decimal("1079.27"), 4, "N", date(2026, 11, 24))
    assert (p["codigo_juros"], p["data_juros"], p["juros"], p["codigo_protesto"], p["codigo_baixa"], p["dias_baixa"], p["moeda"]) == (2, date(2026, 12, 11), Decimal("1.00"), 3, 1, 60, 9)
    assert p["id_empresa"] == "MJ0000000001"
    q = L.SegmentoQ.ler(linhas[3])
    assert (q["pagador_tipo_inscricao"], q["pagador_inscricao"], q["pagador_nome"], q["pagador_cep"], q["pagador_cep_sufixo"], q["pagador_uf"]) == (2, 11444777000161, "JOAO DA CONCEICAO LTDA", 1310, 100, "SP")
    r = L.SegmentoR.ler(linhas[4])
    assert (r["codigo_multa"], r["data_multa"], r["multa"]) == (2, date(2026, 12, 11), Decimal("2.00"))
    t = L.TrailerLote.ler(linhas[-2])
    assert (t["qtd_registros"], t["qtd_simples"], t["valor_simples"]) == (8, 2, Decimal("2158.54"))
    assert L.TrailerArquivo.ler(linhas[-1])["qtd_registros"] == 10
    assert banco.nome_arquivo_remessa(4, date(2026, 11, 24)) == "COB_237_241126_000004.REM"

    # DV "P" vai como letra; numeração do banco manda zeros e o banco emite; protesto, valor/dia, sem multa
    um = next(n for n in range(1, 300) if nn.montar(n, "09").endswith("P"))
    linhas = banco.gerar_remessa(_convenio(multa_pct=Decimal(0), codigo_juros="1", codigo_protesto="1", dias_protesto=5),
                                 [_boleto(um, valor=Decimal("3000")), _boleto(2, movimento="02"), _boleto(3, movimento="06", valor=Decimal(1))],
                                 1).decode("latin-1").splitlines()
    ps = [L.SegmentoP.ler(ln) for ln in linhas if ln[7] == "3" and ln[13] == "P"]
    assert [ln[13] for ln in linhas if ln[7] == "3"] == ["P", "Q"] * 3
    assert (ps[0]["nn_dv"], ps[0]["codigo_juros"], ps[0]["juros"], ps[0]["codigo_protesto"], ps[0]["dias_protesto"]) == ("P", 1, Decimal("1.00"), 1, 5)
    assert [x["codigo_movimento"] for x in ps] == [1, 2, 6] and ps[2]["codigo_juros"] == 3  # R$ 1: juros/dia arredonda a zero
    assert L.TrailerLote.ler(linhas[-2])["qtd_simples"] == 1  # só a entrada conta no total
    b = _boleto(1, desconto_valor=Decimal("50"), desconto_data=date(2026, 12, 1), mensagem_3="Honorários de êxito")
    linhas = banco.gerar_remessa(_convenio(numeracao="BANCO", codigo_juros="3", multa_pct=Decimal(0), codigo_baixa="2"), [b], 2).decode("latin-1").splitlines()
    p, r = L.SegmentoP.ler(linhas[2]), L.SegmentoR.ler(linhas[4])
    assert (p["nn_numero"], p["nn_dv"], p["emissao_boleto"], p["codigo_juros"], p["codigo_desconto_1"], p["desconto_1"], p["dias_baixa"]) == (0, "0", 1, 3, 1, Decimal("50.00"), 0)
    assert (r["codigo_multa"], r["mensagem_3"]) == (0, "HONORARIOS DE EXITO")
    with pytest.raises(Exception, match="ainda não é gerado"):
        banco.gerar_remessa(_convenio(), [_boleto(1, movimento="09")], 1)
    with pytest.raises(Exception, match="Não há boletos"):
        banco.gerar_remessa(_convenio(), [], 1)
    with pytest.raises(ValorNaoCabe):
        banco.gerar_remessa(_convenio(agencia="123456"), [_boleto(1)], 1)
    assert len(banco.gerar_remessa(_convenio(), [_boleto(1)], 9).decode("latin-1").splitlines()) == 7  # com a hora de agora


def test_validacoes_do_bradesco():
    banco = get_banco("237")
    assert banco.validar_convenio(_convenio()) == [] and banco.validar_boleto(_boleto(), _convenio()) == []
    ruim = _convenio(beneficiario_documento="1", beneficiario_nome="", agencia="12345", agencia_dv="", conta="12345678", conta_dv="",
                     codigo_transmissao="abc", carteira="109", tipo_cobranca="9", forma_cadastramento="7", tipo_documento="3",
                     especie_titulo="X", codigo_juros="8", codigo_protesto="1", dias_protesto=0, codigo_baixa="1", dias_baixa=0,
                     multa_pct=Decimal("-1"))
    assert len(banco.validar_convenio(ruim)) == 16
    assert any("protesto inválido" in e for e in banco.validar_convenio(_convenio(codigo_protesto="0")))  # 0 é do Santander
    assert any("baixa/devolução inválido" in e for e in banco.validar_convenio(_convenio(codigo_baixa="9")))
    b = _boleto(valor=Decimal(0), pagador_nome="", pagador_documento="123", pagador_endereco="", pagador_cep="1", pagador_cidade="",
                pagador_uf="XX", data_vencimento=date(2026, 1, 1), nosso_numero="1", id_empresa="")
    assert len(banco.validar_boleto(b, _convenio())) == 10
    assert any("máximo" in e for e in banco.validar_boleto(_boleto(valor=Decimal("100000000")), _convenio()))
    assert banco.formatar_nosso_numero("00000000001P") == "00000000001-P" and banco.formatar_nosso_numero("1") == "1"
    assert banco.agencia_codigo_beneficiario(_convenio()) == "0105-8 / 0017398-3"
    assert banco.sigla_especie("04") == "DS" and banco.padroes()["codigo_protesto"] == "3"
    assert banco.campos()["codigo_beneficiario"] is None and "carteira" in banco.opcoes()
    assert banco.formatar_linha_digitavel(banco.linha_digitavel(banco.codigo_barras(_boleto(), _convenio()))).count(" ") == 4
    assert get_banco("033").padroes()["carteira"] == "101" and get_banco("033").campos()["codigo_beneficiario"]["obrigatorio"]


def linha_t(seq, movimento, nosso_numero="", id_empresa="", valor=Decimal("1079.27"), tarifa=Decimal(0), motivos=""):
    nn20 = ("009" + "00000" + nosso_numero) if nosso_numero else ""
    return L.SegmentoT.montar(codigo_banco="237", lote=1, tipo_registro=3, sequencial=seq, segmento="T", codigo_movimento=movimento,
                              agencia=105, agencia_dv="8", conta=17398, conta_dv="3", agencia_conta_dv="", nosso_numero=nn20,
                              carteira="1", seu_numero="NH00001", vencimento=date(2026, 12, 10), valor=valor, banco_cobrador=237,
                              agencia_cobradora=105, agencia_cobradora_dv="8", id_empresa=id_empresa, moeda=9,
                              pagador_tipo_inscricao=2, pagador_inscricao=11444777000161, pagador_nome="JOAO DA CONCEICAO LTDA",
                              contrato="", tarifa=tarifa, motivos=motivos)


def linha_u(seq, movimento, pago=Decimal(0), liquido=Decimal(0), ocorrencia=None, credito=None):
    return L.SegmentoU.montar(codigo_banco="237", lote=1, tipo_registro=3, sequencial=seq, segmento="U", codigo_movimento=movimento,
                              juros_multa=Decimal(0), desconto=Decimal(0), abatimento=Decimal(0), iof=Decimal(0), valor_pago=pago,
                              valor_liquido=liquido, outras_despesas=Decimal(0), outros_creditos=Decimal(0),
                              data_ocorrencia=ocorrencia, data_credito=credito, ocorrencia_pagador="",
                              data_ocorrencia_pagador=None, valor_ocorrencia_pagador=Decimal(0), complemento="",
                              banco_correspondente=0, nosso_numero_correspondente="")


def arquivo_retorno(detalhes: list[str], codigo_arquivo="2") -> bytes:
    conta = dict(agencia=105, agencia_dv="8", conta=17398, conta_dv="3", agencia_conta_dv="")
    linhas = [L.HeaderArquivo.montar(tipo_inscricao=2, inscricao="11222333000181", convenio="", **conta, nome_empresa="ESCRITORIO",
                                     codigo_remessa=codigo_arquivo, data_geracao=date(2026, 12, 11), hora_geracao=101500,
                                     sequencial_arquivo=7, reservado_banco="", reservado_empresa=""),
              L.HeaderLote.montar(tipo_operacao="T", tipo_inscricao=2, inscricao="11222333000181", convenio="", **conta,
                                  nome_beneficiario="ESCRITORIO", mensagem_1="", mensagem_2="", numero_remessa=7,
                                  data_gravacao=date(2026, 12, 11), data_credito=None),
              *detalhes, L.TrailerLote.montar(qtd_registros=len(detalhes) + 2)]
    linhas.append(L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=len(linhas) + 1))
    return (chr(13) + chr(10)).join(linhas).encode("latin-1") + bytes([13, 10])


def test_retorno_do_bradesco():
    banco = get_banco("237")
    com_p = next(nn.montar(n, "09") for n in range(1, 300) if nn.montar(n, "09").endswith("P"))
    lido = banco.ler_retorno(arquivo_retorno([
        linha_t(1, "02", com_p, "MJ0000000001"), linha_u(2, "02", ocorrencia=date(2026, 11, 25)),
        linha_t(3, "03", nn.montar(2, "09"), motivos="4852"), linha_u(4, "03"),
        linha_t(5, "06", nn.montar(3, "09"), tarifa=Decimal("1.90")),
        linha_u(6, "06", pago=Decimal("1079.27"), liquido=Decimal("1077.37"), ocorrencia=date(2026, 12, 10), credito=date(2026, 12, 11)),
        linha_t(7, "02", "", "MJ0000000009"), linha_u(8, "02"),
    ]))
    assert (lido.banco, lido.agencia, lido.conta, lido.data_geracao, lido.sequencial_arquivo, lido.avisos) == ("237", "0105", "000017398", date(2026, 12, 11), 7, [])
    o = lido.ocorrencias
    assert [x.codigo_movimento for x in o] == ["02", "03", "06", "02"]
    assert (o[0].nosso_numero, o[0].id_empresa, o[0].descricao) == (com_p, "MJ0000000001", "Entrada confirmada")
    assert o[1].motivos == ["48", "52"] and o[1].motivos_descricao[0]["descricao"] == "CEP inválido"
    assert (o[2].valor_pago, o[2].valor_liquido, o[2].tarifa, o[2].data_ocorrencia, o[2].data_credito) == (Decimal("1079.27"), Decimal("1077.37"), Decimal("1.90"), date(2026, 12, 10), date(2026, 12, 11))
    assert o[3].nosso_numero == ""  # sem número: será achado pelo ID na empresa
    with pytest.raises(LinhaInvalida, match="remessa"):
        banco.ler_retorno(arquivo_retorno([], codigo_arquivo="1"))
    with pytest.raises(LinhaInvalida, match="banco 237"):
        get_banco("033").ler_retorno(arquivo_retorno([linha_t(1, "02", com_p), linha_u(2, "02")]))


def test_bradesco_pela_api(cliente):  # noqa: F811
    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    bancos = {b["codigo"]: b for b in cliente.get("/api/boletos/bancos", headers=h).json()}
    assert bancos["237"]["nome"] == "Bradesco" and bancos["237"]["padroes"]["carteira"] == "09" and bancos["237"]["campos"]["codigo_beneficiario"] is None
    corpo = {"nome": "Bradesco 09", "emissora_id": emissora["id"], "banco": "237", "agencia": "105", "agencia_dv": "8", "conta": "17398",
             "conta_dv": "3", **{k: v for k, v in bancos["237"]["padroes"].items()}}
    # incompleto não grava: no Santander os códigos do contrato são obrigatórios; no Bradesco a conta tem até 7 dígitos
    r = cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "banco": "033", "carteira": "101", "tipo_cobranca": "5", "codigo_protesto": "0"})
    assert r.status_code == 400 and "código do beneficiário" in r.json()["detail"]
    r = cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "conta": "123456789"})
    assert r.status_code == 400 and "7 dígitos" in r.json()["detail"]
    assert len([c for c in cliente.get("/api/boletos/convenios", headers=h).json() if c["nome"] == "Bradesco 09"]) == 0
    r = cliente.post("/api/boletos/convenios", headers=h, json=corpo)
    assert r.status_code == 201, r.text
    conv = r.json()
    assert (conv["banco_nome"], conv["pendencias"], conv["carteira"], conv["codigo_beneficiario"]) == ("Bradesco", [], "09", "")

    doc = _cnpj(70412266)
    novo = {"convenio_id": conv["id"], "valor": "850.00", "data_vencimento": VENC.isoformat(), "descricao": "Parecer",
            "pagador_nome": "Cliente do Bradesco Ltda", "pagador_documento": doc, "pagador_endereco": "Av. Paulista, 1000",
            "pagador_bairro": "Bela Vista", "pagador_cep": "01310100", "pagador_cidade": "São Paulo", "pagador_uf": "SP"}
    b = cliente.post("/api/boletos", headers=h, json=novo)
    assert b.status_code == 201, b.text
    b = b.json()
    assert (b["nosso_numero"], b["nosso_numero_fmt"], b["banco"]) == (nn.montar(1, "09"), f"{nn.montar(1, '09')[:-1]}-{nn.montar(1, '09')[-1]}", "237")
    assert cb.conferir(b["codigo_barras"]) and b["codigo_barras"][19:] == "0105" + "09" + "00000000001" + "0017398" + "0"
    pdf = cliente.get(f"/api/boletos/{b['id']}/pdf", headers=h)
    texto = " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(pdf.content)).pages)
    for trecho in ("Banco Bradesco", "237-2", b["linha_digitavel_fmt"], "0105-8 / 0017398-3", b["nosso_numero_fmt"], "850,00", "09"):
        assert trecho in texto, (trecho, texto)

    rem = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]})
    assert rem.status_code == 201, rem.text
    rem = rem.json()["remessa"]
    assert rem["nome_arquivo"].startswith("COB_237_")
    linhas = cliente.get(f"/api/boletos/remessas/{rem['id']}/arquivo", headers=h).content.decode("latin-1").splitlines()
    p = L.SegmentoP.ler(linhas[2])
    assert linhas[0][:3] == "237" and (p["nn_numero"], p["valor"]) == (1, Decimal("850.00"))
    # retorno: o sistema acha o convênio pela agência e conta do arquivo; registra, depois paga
    r = cliente.post("/api/boletos/retornos", headers=h, files={"arquivo": ("brad1.ret", arquivo_retorno(
        [linha_t(1, "02", b["nosso_numero"], p["id_empresa"], valor=Decimal("850")), linha_u(2, "02", ocorrencia=HOJE)]))})
    assert r.status_code == 201, r.text
    assert (r.json()["convenio_id"], r.json()["resumo"]["contagem"]["registrados"]) == (conv["id"], 1)
    assert cliente.get(f"/api/boletos/{b['id']}", headers=h).json()["status"] == "registrado"
    r = cliente.post("/api/boletos/retornos", headers=h, files={"arquivo": ("brad2.ret", arquivo_retorno(
        [linha_t(1, "06", b["nosso_numero"], valor=Decimal("850"), tarifa=Decimal("1.90")),
         linha_u(2, "06", pago=Decimal("850"), liquido=Decimal("848.10"), ocorrencia=HOJE, credito=HOJE)]))})
    assert r.status_code == 201 and r.json()["resumo"]["contagem"]["pagos"] == 1, r.text
    pago = cliente.get(f"/api/boletos/{b['id']}", headers=h).json()
    assert (pago["status"], pago["valor_pago"], pago["tarifa"]) == ("pago", "850.00", "1.90")
    # convênio com boletos não troca de banco
    r = cliente.put(f"/api/boletos/convenios/{conv['id']}", headers=h, json={**corpo, "banco": "033", "codigo_beneficiario": "1234567",
                                                                             "codigo_transmissao": "123", "carteira": "101", "tipo_cobranca": "5",
                                                                             "codigo_protesto": "0", "proximo_nosso_numero": 2, "proximo_sequencial_arquivo": 2})
    assert r.status_code == 400 and "trocar o banco" in r.json()["detail"]
