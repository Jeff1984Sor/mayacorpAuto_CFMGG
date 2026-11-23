"""Núcleo do CNAB 240 e adaptador do Santander: campos, layout, nosso número, código de barras, remessa e retorno."""

import logging
from datetime import date
from decimal import Decimal

import pytest

from app.modules.boletos.bancos.base import DadosBoleto, DadosConvenio
from app.modules.boletos.bancos.registry import BancoNaoSuportado, bancos_disponiveis, get_banco
from app.modules.boletos.bancos.santander import codigo_barras as cb
from app.modules.boletos.bancos.santander import codigos as cod
from app.modules.boletos.bancos.santander import layout as L
from app.modules.boletos.bancos.santander import nosso_numero as nn
from app.modules.boletos.cnab import Field, LayoutInvalido, LinhaInvalida, Record, ValorNaoCabe
from app.modules.boletos.cnab.fields import limpar_texto
from app.modules.boletos.cnab.validators import conferir_estrutura, juntar, separar


# ------------------------------------------------------------------------------------------------ campos
def test_campo_numerico():
    f = Field("n", 1, 5, "N")
    assert f.formatar(42) == "00042"
    assert f.formatar("7") == "00007"
    assert f.formatar(None) == "00000"
    assert Field("n", 1, 3, "N", default="033").formatar() == "033"
    with pytest.raises(ValorNaoCabe):  # número nunca é truncado
        f.formatar(123456)
    with pytest.raises(ValorNaoCabe):
        f.formatar("12A")
    with pytest.raises(ValorNaoCabe):
        f.formatar(-1)
    with pytest.raises(ValorNaoCabe):
        f.formatar(True)
    assert f.ler("00042") == 42
    assert f.ler("     ") == 0
    with pytest.raises(ValorNaoCabe):
        f.ler("00A42")


def test_campo_numerico_com_decimais():
    f = Field("valor", 1, 15, "N", dec=2)
    assert f.formatar(Decimal("150.75")) == "000000000015075"
    assert f.formatar(Decimal("0.005")) == "000000000000001"  # arredonda meio para cima
    assert f.formatar(10) == "000000000001000"
    assert f.formatar("1.5") == "000000000000150"
    assert Field("iof", 1, 15, "N", dec=5).formatar(Decimal("1.5")) == "000000000150000"
    with pytest.raises(ValorNaoCabe):  # float nunca, para dinheiro
        f.formatar(150.75)
    with pytest.raises(ValorNaoCabe):
        f.formatar(Decimal("-1"))
    with pytest.raises(ValorNaoCabe):
        Field("v", 1, 5, "N", dec=2).formatar(Decimal("1000.00"))
    assert f.ler("000000000015075") == Decimal("150.75")
    assert f.ler(" " * 15) == Decimal(0)


def test_campo_alfanumerico(caplog):
    f = Field("nome", 1, 20, "A")
    assert f.formatar("João da Conceição") == "JOAO DA CONCEICAO   "
    assert f.formatar("a&b@c#d") == "A B C D             "
    assert f.formatar("R. (X), 1-2/3.") == "R. (X), 1-2/3.      "
    assert f.formatar(None) == " " * 20
    assert limpar_texto("  Çédilha   ñ  ") == "CEDILHA N"
    with caplog.at_level(logging.WARNING):  # texto longo: corta e avisa
        assert f.formatar("x" * 30) == "X" * 20
    assert "cortado" in caplog.text
    assert f.ler("JOAO                ") == "JOAO"


def test_campo_literal_data_e_brancos():
    x = Field("chave", 1, 20, "X")
    assert x.formatar("Fulano@Mail.com") == "Fulano@Mail.com     "
    assert x.ler("Fulano@Mail.com     ") == "Fulano@Mail.com"
    with pytest.raises(ValorNaoCabe):
        x.formatar("y" * 21)
    d = Field("data", 1, 8, "D")
    assert d.formatar(date(2026, 11, 23)) == "23112026"
    assert d.formatar(None) == "00000000"
    assert d.ler("23112026") == date(2026, 11, 23)
    assert d.ler("00000000") is None and d.ler("        ") is None and d.ler("99999999") is None
    with pytest.raises(ValorNaoCabe):
        d.formatar("23/11/2026")
    b = Field("b", 1, 4, "B")
    assert b.formatar("qualquer coisa") == "    " and b.ler("abcd") is None


def test_definicao_de_campo_invalida():
    for args in (("x", 1, 5, "Z"), ("x", 0, 5, "N"), ("x", 5, 4, "N"), ("x", 1, 6, "D")):
        with pytest.raises(LayoutInvalido):
            Field(*args)
    with pytest.raises(LayoutInvalido):
        Field("x", 1, 5, "A", dec=2)


def test_layout_precisa_fechar_240_sem_buraco_nem_sobreposicao():
    with pytest.raises(LayoutInvalido, match="buraco"):
        type("Furo", (Record,), {"CAMPOS": [Field("a", 1, 10, "A"), Field("b", 12, 240, "A")]})
    with pytest.raises(LayoutInvalido, match="já foi usada"):
        type("Sobre", (Record,), {"CAMPOS": [Field("a", 1, 10, "A"), Field("b", 10, 240, "A")]})
    with pytest.raises(LayoutInvalido, match="termina"):
        type("Curto", (Record,), {"CAMPOS": [Field("a", 1, 239, "A")]})
    with pytest.raises(LayoutInvalido, match="repetido"):
        type("Rep", (Record,), {"CAMPOS": [Field("a", 1, 10, "A"), Field("a", 11, 240, "A")]})
    with pytest.raises(LayoutInvalido, match="sem campos"):
        type("Vazio", (Record,), {"CAMPOS": []})


@pytest.mark.parametrize("registro", L.REGISTROS, ids=lambda r: r.__name__)
def test_todo_registro_do_santander_e_contiguo_de_1_a_240(registro):
    esperado = 1
    for c in registro.CAMPOS:
        assert c.inicio == esperado, f"{registro.__name__}.{c.nome}"
        esperado = c.fim + 1
    assert esperado == 241
    assert len(registro.montar()) == 240  # só com os valores padrão já sai uma linha inteira


def test_record_montar_e_ler():
    linha = L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=6)
    assert linha.startswith("03399999") and linha[17:23] == "000001" and linha[23:29] == "000006"
    assert L.TrailerArquivo.ler(linha)["qtd_registros"] == 6
    with pytest.raises(LayoutInvalido):
        L.TrailerArquivo.montar(campo_que_nao_existe=1)
    with pytest.raises(LinhaInvalida):
        L.TrailerArquivo.ler("curta")


# ------------------------------------------------------------------------------------------------ nosso número
def test_nosso_numero_exemplo_do_manual():
    assert nn.dv_modulo11("3147578") == 7  # soma 147, resto 4, 11 − 4 = 7
    assert nn.montar(3147578) == "0000031475787"
    assert nn.valido("0000031475787") and not nn.valido("0000031475788") and not nn.valido("123")


def test_nosso_numero_dv_10_11_e_0():
    def resto(base):
        soma, peso = 0, 2
        for d in reversed(base):
            soma += int(d) * peso
            peso = 2 if peso == 9 else peso + 1
        return soma % 11

    achados = {}
    for n in range(1, 400):
        achados.setdefault(resto(str(n).zfill(12)), n)
    assert nn.dv_modulo11(str(achados[1]).zfill(12)) == 1  # 11 − 1 = 10 → 1
    assert nn.dv_modulo11(str(achados[0]).zfill(12)) == 0  # 11 − 0 = 11 → 0
    assert nn.dv_modulo11(str(achados[2]).zfill(12)) == 9
    with pytest.raises(ValueError):
        nn.montar(0)
    with pytest.raises(ValueError):
        nn.montar(10 ** 12)
    with pytest.raises(ValueError):
        nn.dv_modulo11("12A")


# ------------------------------------------------------------------------------------------------ código de barras
def test_fator_de_vencimento():
    assert cb.fator_vencimento(date(2000, 7, 3)) == 1000
    assert cb.fator_vencimento(date(2025, 2, 21)) == 9999
    assert cb.fator_vencimento(date(2025, 2, 22)) == 1000  # recomeçou
    assert cb.fator_vencimento(date(2025, 2, 23)) == 1001
    assert cb.fator_vencimento(cb.ULTIMO_DIA) == 9999
    with pytest.raises(ValueError):
        cb.fator_vencimento(date(1999, 1, 1))
    with pytest.raises(ValueError):
        cb.fator_vencimento(date(2060, 1, 1))


def test_modulo_10():
    # exemplo clássico da FEBRABAN: campo 1 "001905009" → DV 5
    assert cb.dv_modulo10("001905009") == 5
    assert cb.dv_modulo10("4014481606") == 9
    assert cb.dv_modulo10("0680935031") == 4


def test_codigo_de_barras_e_linha_digitavel():
    barras = cb.codigo_barras(codigo_beneficiario="1234567", nosso_numero="0000031475787", carteira="101",
                              vencimento=date(2026, 12, 10), valor=Decimal("1079.27"))
    assert len(barras) == 44 and barras.isdigit()
    assert barras[:4] == "0339"
    assert barras[5:9] == f"{1000 + (date(2026, 12, 10) - date(2025, 2, 22)).days:04d}"
    assert barras[9:19] == "0000107927"
    assert barras[19:] == "9" + "1234567" + "0000031475787" + "0" + "101"  # campo livre
    assert cb.conferir(barras)
    errado = barras[:4] + str((int(barras[4]) + 1) % 10) + barras[5:]
    assert not cb.conferir(errado)

    linha = cb.linha_digitavel(barras)
    assert len(linha) == 47 and linha.isdigit()
    assert linha[:4] == "0339" and linha[4:9] == barras[19:24] and int(linha[9]) == cb.dv_modulo10(linha[:9])
    assert linha[10:20] == barras[24:34] and int(linha[20]) == cb.dv_modulo10(linha[10:20])
    assert linha[21:31] == barras[34:44] and int(linha[31]) == cb.dv_modulo10(linha[21:31])
    assert linha[32] == barras[4] and linha[33:] == barras[5:19]
    fmt = cb.formatar_linha(linha)
    assert fmt.replace(".", "").replace(" ", "") == linha and len(fmt.split(" ")) == 5
    assert cb.formatar_linha("123") == "123"
    # da linha digitável se volta ao código de barras
    volta = linha[0:4] + linha[32] + linha[33:47] + linha[4:9] + linha[10:20] + linha[21:31]
    assert volta == barras


def test_dv_geral_nunca_e_zero():
    for seq in range(1, 300):
        barras = cb.codigo_barras(codigo_beneficiario="7654321", nosso_numero=nn.montar(seq), carteira="104",
                                  vencimento=date(2026, 1, 15), valor=Decimal("10.00") + seq)
        assert barras[4] != "0" and cb.conferir(barras)
    with pytest.raises(ValueError):
        cb.dv_geral("123")


def test_codigo_de_barras_recusa_dados_ruins():
    ok = dict(codigo_beneficiario="1234567", nosso_numero="0000031475787", carteira="101",
              vencimento=date(2026, 12, 10), valor=Decimal("10"))
    for troca in ({"valor": Decimal(0)}, {"valor": Decimal("100000000")}, {"codigo_beneficiario": "12345678"},
                  {"codigo_beneficiario": "12A"}, {"nosso_numero": "123"}, {"carteira": "1"}):
        with pytest.raises(ValueError):
            cb.codigo_barras(**{**ok, **troca})
    with pytest.raises(ValueError):
        cb.linha_digitavel("123")


# ------------------------------------------------------------------------------------------------ remessa
def _convenio(**k) -> DadosConvenio:
    base = dict(beneficiario_nome="Escritório Teste Advogados", beneficiario_documento="11222333000181",
                agencia="1234", agencia_dv="5", conta="13000123", conta_dv="4", codigo_beneficiario="1234567",
                codigo_transmissao="123400001234567", mensagem_1="Não receber após 60 dias")
    return DadosConvenio(**{**base, **k})


def _boleto(n=1, **k) -> DadosBoleto:
    base = dict(id_empresa=f"MJ{n:010d}", seu_numero=f"NH{n:05d}", nosso_numero=nn.montar(n),
                valor=Decimal("1079.27"), data_emissao=date(2026, 11, 23), data_vencimento=date(2026, 12, 10),
                pagador_nome="João da Conceição Ltda", pagador_documento="11444777000161",
                pagador_endereco="Rua das Flores, 100 - cj 12", pagador_bairro="Centro", pagador_cep="01310100",
                pagador_cidade="São Paulo", pagador_uf="SP")
    return DadosBoleto(**{**base, **k})


def test_remessa_estrutura_tamanho_e_contagens():
    banco = get_banco("033")
    conteudo = banco.gerar_remessa(_convenio(), [_boleto(1), _boleto(2)], 7, date(2026, 11, 23))
    assert conteudo.endswith(b"\r\n") and b"\n" not in conteudo.replace(b"\r\n", b"")
    conteudo.decode("ascii")  # só ASCII
    linhas = conteudo.decode("latin-1").splitlines()
    assert all(len(ln) == 240 for ln in linhas)
    # header, lote, (P Q R) × 2, trailer de lote, trailer de arquivo  (R por causa da multa de 2%)
    assert [ln[7] + (ln[13] if ln[7] == "3" else "") for ln in linhas] == ["0", "1", "3P", "3Q", "3R", "3P", "3Q", "3R", "5", "9"]
    assert [int(ln[8:13]) for ln in linhas if ln[7] == "3"] == [1, 2, 3, 4, 5, 6]
    assert linhas[-2][17:23] == "000008"  # lote: 6 detalhes + header + trailer
    assert linhas[-1][17:23] == "000001" and linhas[-1][23:29] == "000010"
    conferir_estrutura(linhas)

    h = L.HeaderArquivo.ler(linhas[0])
    assert (h["codigo_banco"], h["tipo_inscricao"], h["inscricao"], h["codigo_transmissao"]) == (33, 2, 11222333000181, 123400001234567)
    assert (h["nome_empresa"], h["nome_banco"], h["codigo_remessa"]) == ("ESCRITORIO TESTE ADVOGADOS", "BANCO SANTANDER", 1)
    assert (h["data_geracao"], h["sequencial_arquivo"], h["versao_layout"]) == (date(2026, 11, 23), 7, 40)
    lote = L.HeaderLote.ler(linhas[1])
    assert (lote["tipo_operacao"], lote["tipo_servico"], lote["versao_layout"], lote["numero_remessa"]) == ("R", 1, 30, 7)
    assert lote["mensagem_1"] == "NAO RECEBER APOS 60 DIAS"

    p = L.SegmentoP.ler(linhas[2])
    assert (p["codigo_movimento"], p["agencia"], p["agencia_dv"], p["conta"], p["conta_dv"]) == (1, 1234, 5, 13000123, 4)
    assert f"{p['nosso_numero']:013d}" == nn.montar(1)
    assert (p["tipo_cobranca"], p["forma_cadastramento"], p["tipo_documento"], p["especie"], p["aceite"]) == ("5", 1, 1, 4, "N")
    assert (p["seu_numero"], p["vencimento"], p["valor"], p["data_emissao"]) == ("NH00001", date(2026, 12, 10), Decimal("1079.27"), date(2026, 11, 23))
    assert (p["codigo_juros"], p["data_juros"], p["juros"]) == (2, date(2026, 12, 11), Decimal("1.00"))
    assert (p["codigo_desconto_1"], p["data_desconto_1"], p["iof"], p["abatimento"]) == (0, None, Decimal(0), Decimal(0))
    assert (p["id_empresa"], p["codigo_protesto"], p["dias_protesto"], p["codigo_baixa"], p["dias_baixa"], p["moeda"]) == ("MJ0000000001", 0, 0, 1, 60, 0)
    q = L.SegmentoQ.ler(linhas[3])
    assert (q["pagador_tipo_inscricao"], q["pagador_inscricao"], q["pagador_nome"]) == (2, 11444777000161, "JOAO DA CONCEICAO LTDA")
    assert (q["pagador_endereco"], q["pagador_bairro"], q["pagador_cep"], q["pagador_cep_sufixo"]) == ("RUA DAS FLORES, 100 - CJ 12", "CENTRO", 1310, 100)
    assert (q["pagador_cidade"], q["pagador_uf"], q["sacador_tipo_inscricao"]) == ("SAO PAULO", "SP", 0)
    r = L.SegmentoR.ler(linhas[4])
    assert (r["codigo_multa"], r["data_multa"], r["multa"]) == (2, date(2026, 12, 11), Decimal("2.00"))
    assert banco.nome_arquivo_remessa(7, date(2026, 11, 23)) == "COB_033_231126_000007.REM"


def test_remessa_snapshot_das_linhas():
    """Fotografia de um P e de um Q: qualquer campo que mude de posição quebra aqui."""
    linhas = get_banco("033").gerar_remessa(_convenio(multa_pct=Decimal(0)), [_boleto(1)], 1, date(2026, 11, 23)) \
        .decode("latin-1").splitlines()
    assert linhas[0] == ("03300000" + " " * 8 + "2" + "011222333000181" + "123400001234567" + " " * 25
                         + "ESCRITORIO TESTE ADVOGADOS".ljust(30) + "BANCO SANTANDER".ljust(30) + " " * 10 + "1"
                         + "23112026" + " " * 6 + "000001" + "040" + " " * 74)
    assert linhas[2] == ("03300013" + "00001" + "P" + " " + "01" + "1234" + "5" + "013000123" + "4" + "000000000" + "0"
                         + "  " + "0000000000019" + "5" + "1" + "1" + " " + " " + "NH00001".ljust(15) + "10122026"
                         + "000000000107927" + "0000" + "0" + " " + "04" + "N" + "23112026" + "2" + "11122026"
                         + "000000000000100" + "0" + "00000000" + "000000000000000" + "000000000000000"
                         + "000000000000000" + "MJ0000000001".ljust(25) + "0" + "00" + "1" + "0" + "60" + "00" + " " * 11)
    assert linhas[3] == ("03300013" + "00002" + "Q" + " " + "01" + "2" + "000011444777000161"[3:]
                         + "JOAO DA CONCEICAO LTDA".ljust(40) + "RUA DAS FLORES, 100 - CJ 12".ljust(40)
                         + "CENTRO".ljust(15) + "01310" + "100" + "SAO PAULO".ljust(15) + "SP" + "0"
                         + "0" * 15 + " " * 40 + "000" * 4 + " " * 19)
    assert [ln[7] for ln in linhas] == ["0", "1", "3", "3", "5", "9"]  # sem multa nem mensagem: sem Segmento R


def test_remessa_variacoes():
    banco = get_banco("033")
    # juros em valor por dia; valor pequeno arredonda para zero e vira isento
    linhas = banco.gerar_remessa(_convenio(codigo_juros="1"), [_boleto(1, valor=Decimal("3000")), _boleto(2, valor=Decimal("1"))],
                                 1).decode("latin-1").splitlines()
    p1, p2 = L.SegmentoP.ler(linhas[2]), L.SegmentoP.ler(linhas[5])
    assert (p1["codigo_juros"], p1["juros"]) == (1, Decimal("1.00")) and (p2["codigo_juros"], p2["juros"], p2["data_juros"]) == (3, Decimal(0), None)
    # isento, protesto, sem baixa automática, desconto, mensagens e numeração do banco
    conv = _convenio(codigo_juros="3", multa_pct=Decimal(0), codigo_protesto="1", dias_protesto=5, codigo_baixa="2",
                     numeracao="BANCO")
    b = _boleto(1, desconto_valor=Decimal("50"), desconto_data=date(2026, 12, 1), mensagem_3="Honorários de êxito",
                pagador_documento="52998224725")
    linhas = banco.gerar_remessa(conv, [b], 2).decode("latin-1").splitlines()
    p, q, r = L.SegmentoP.ler(linhas[2]), L.SegmentoQ.ler(linhas[3]), L.SegmentoR.ler(linhas[4])
    assert (p["codigo_juros"], p["nosso_numero"], p["codigo_protesto"], p["dias_protesto"], p["codigo_baixa"], p["dias_baixa"]) == (3, 0, 1, 5, 2, 0)
    assert (p["codigo_desconto_1"], p["data_desconto_1"], p["desconto_1"]) == (1, date(2026, 12, 1), Decimal("50.00"))
    assert q["pagador_tipo_inscricao"] == 1 and (r["codigo_multa"], r["mensagem_3"]) == (0, "HONORARIOS DE EXITO")
    # instruções: baixa (02) e alteração de vencimento (06)
    linhas = banco.gerar_remessa(_convenio(multa_pct=Decimal(0)), [_boleto(1, movimento="02"), _boleto(2, movimento="06")],
                                 3).decode("latin-1").splitlines()
    assert [ln[15:17] for ln in linhas if ln[7] == "3"] == ["02", "02", "06", "06"]
    with pytest.raises(Exception, match="ainda não é gerado"):
        banco.gerar_remessa(_convenio(), [_boleto(1, movimento="09")], 1)
    with pytest.raises(Exception, match="Não há boletos"):
        banco.gerar_remessa(_convenio(), [], 1)
    with pytest.raises(ValorNaoCabe):  # conta com dígitos demais não é truncada
        banco.gerar_remessa(_convenio(conta="1234567890"), [_boleto(1)], 1)


def test_remessa_com_pix_gera_segmento_y03():
    conv = _convenio(pix_habilitado=True, pix_chave_tipo="4", pix_chave="Financeiro@Escritorio.com.br", multa_pct=Decimal(0))
    linhas = get_banco("033").gerar_remessa(conv, [_boleto(1, txid="MJ" + "a1B2" * 7)], 1).decode("latin-1").splitlines()
    assert [ln[13] for ln in linhas if ln[7] == "3"] == ["P", "Q", "Y"]
    y = L.SegmentoY03.ler(linhas[4])
    assert (y["identificacao"], y["pix_tipo_chave"], y["pix_chave"], y["txid"]) == (3, "4", "Financeiro@Escritorio.com.br", "MJ" + "a1B2" * 7)


def test_validacoes_do_convenio_e_do_boleto():
    banco = get_banco("033")
    assert banco.validar_convenio(_convenio()) == []
    assert banco.validar_boleto(_boleto(), _convenio()) == []
    ruim = _convenio(beneficiario_documento="11111111111111", beneficiario_nome="", agencia="12345", agencia_dv="",
                     conta="x", conta_dv="", codigo_beneficiario="", codigo_transmissao="abc", carteira="1",
                     tipo_cobranca="9", forma_cadastramento="7", tipo_documento="3", especie_titulo="X",
                     codigo_juros="8", codigo_protesto="1", dias_protesto=0, codigo_baixa="1", dias_baixa=0,
                     juros_mensal_pct=Decimal("-1"), pix_habilitado=True)
    assert len(banco.validar_convenio(ruim)) == 18
    assert any("Código de protesto" in e for e in banco.validar_convenio(_convenio(codigo_protesto="7")))
    assert any("baixa/devolução inválido" in e for e in banco.validar_convenio(_convenio(codigo_baixa="7")))
    assert any("77" in e for e in banco.validar_convenio(_convenio(pix_habilitado=True, pix_chave_tipo="5", pix_chave="k" * 78)))
    b = _boleto(valor=Decimal(0), pagador_nome="", pagador_documento="123", pagador_endereco=" ", pagador_cep="0131",
                pagador_cidade="", pagador_uf="XX", data_vencimento=date(2026, 1, 1), nosso_numero="1", id_empresa="")
    assert len(banco.validar_boleto(b, _convenio())) == 10
    assert any("máximo" in e for e in banco.validar_boleto(_boleto(valor=Decimal("100000000")), _convenio()))
    assert banco.formatar_nosso_numero("0000031475787") == "000003147578-7" and banco.formatar_nosso_numero("1") == "1"
    assert banco.agencia_codigo_beneficiario(_convenio()) == "1234 / 1234567"
    assert banco.sigla_especie("04") == "DS" and "carteira" in banco.opcoes()
    assert banco.calcular_nosso_numero(3147578, _convenio()) == "0000031475787"
    barras = banco.codigo_barras(_boleto(), _convenio())
    assert banco.formatar_linha_digitavel(banco.linha_digitavel(barras)).count(" ") == 4


def test_registro_de_bancos():
    assert [b.codigo for b in bancos_disponiveis()] == ["033"]
    assert get_banco("33").nome == "BANCO SANTANDER"
    with pytest.raises(BancoNaoSuportado):
        get_banco("341")


# ------------------------------------------------------------------------------------------------ retorno
def linha_t(seq, movimento, nosso_numero="", id_empresa="", valor=Decimal("1079.27"), tarifa=Decimal(0), motivos="",
            seu_numero="NH00001"):
    return L.SegmentoT.montar(codigo_banco="033", lote=1, tipo_registro=3, sequencial=seq, segmento="T",
                              codigo_movimento=movimento, agencia=1234, agencia_dv=5, conta=13000123, conta_dv=4,
                              nosso_numero=nosso_numero or 0, carteira="5", seu_numero=seu_numero,
                              vencimento=date(2026, 12, 10), valor=valor, banco_cobrador=33, agencia_cobradora=1234,
                              agencia_cobradora_dv=5, id_empresa=id_empresa, moeda=0, pagador_tipo_inscricao=2,
                              pagador_inscricao=11444777000161, pagador_nome="JOAO DA CONCEICAO LTDA",
                              conta_cobranca="", tarifa=tarifa, motivos=motivos)


def linha_u(seq, movimento, pago=Decimal(0), liquido=Decimal(0), ocorrencia=None, credito=None, juros=Decimal(0)):
    return L.SegmentoU.montar(codigo_banco="033", lote=1, tipo_registro=3, sequencial=seq, segmento="U",
                              codigo_movimento=movimento, juros_multa=juros, desconto=Decimal(0), abatimento=Decimal(0),
                              iof=Decimal(0), valor_pago=pago, valor_liquido=liquido, outras_despesas=Decimal(0),
                              outros_creditos=Decimal(0), data_ocorrencia=ocorrencia, data_credito=credito,
                              ocorrencia_pagador="", data_ocorrencia_pagador=None, valor_ocorrencia_pagador=Decimal(0),
                              complemento="", banco_correspondente=0)


def arquivo_retorno(detalhes: list[str], fim_de_linha="\r\n", codigo_arquivo="2", banco="033") -> bytes:
    header = L.HeaderArquivo.montar(codigo_banco=banco, tipo_inscricao=2, inscricao="11222333000181",
                                    codigo_transmissao="123400001234567", nome_empresa="ESCRITORIO TESTE",
                                    codigo_remessa=codigo_arquivo, data_geracao=date(2026, 12, 11), sequencial_arquivo=15)
    lote = L.HeaderLote.montar(codigo_banco=banco, tipo_operacao="T", tipo_inscricao=2, inscricao="11222333000181",
                               codigo_transmissao="123400001234567", nome_beneficiario="ESCRITORIO TESTE",
                               numero_remessa=15, data_gravacao=date(2026, 12, 11))
    linhas = [header, lote, *detalhes, L.TrailerLote.montar(codigo_banco=banco, qtd_registros=len(detalhes) + 2)]
    linhas.append(L.TrailerArquivo.montar(codigo_banco=banco, qtd_lotes=1, qtd_registros=len(linhas) + 1))
    return (fim_de_linha.join(linhas) + fim_de_linha).encode("latin-1")


def test_retorno_le_cada_movimento():
    n1, n2, n3 = nn.montar(1), nn.montar(2), nn.montar(3)
    detalhes = [
        linha_t(1, "02", n1, "MJ0000000001"), linha_u(2, "02", ocorrencia=date(2026, 11, 24)),
        linha_t(3, "03", n2, "MJ0000000002", motivos="4852"), linha_u(4, "03", ocorrencia=date(2026, 11, 24)),
        linha_t(5, "06", n3, "MJ0000000003", tarifa=Decimal("2.50")),
        linha_u(6, "06", pago=Decimal("1090.06"), liquido=Decimal("1087.56"), ocorrencia=date(2026, 12, 12),
                credito=date(2026, 12, 13), juros=Decimal("10.79")),
        linha_t(7, "09", n1), linha_u(8, "09", ocorrencia=date(2027, 2, 10)),
        linha_t(9, "17", n2), linha_u(10, "17", pago=Decimal("1079.27"), ocorrencia=date(2027, 2, 11)),
        linha_t(11, "77", n1), linha_u(12, "77"),
    ]
    lido = get_banco("033").ler_retorno(arquivo_retorno(detalhes))
    assert (lido.banco, lido.agencia, lido.conta, lido.data_geracao, lido.sequencial_arquivo) == ("033", "1234", "013000123", date(2026, 12, 11), 15)
    assert lido.avisos == []
    o = lido.ocorrencias
    assert [x.codigo_movimento for x in o] == ["02", "03", "06", "09", "17", "77"]
    assert (o[0].descricao, o[0].nosso_numero, o[0].id_empresa, o[0].seu_numero) == ("Entrada confirmada", n1, "MJ0000000001", "NH00001")
    assert o[1].motivos == ["48", "52"] and o[1].motivos_descricao == [
        {"codigo": "48", "descricao": "CEP inválido"}, {"codigo": "52", "descricao": "UF inválida"}]
    assert (o[2].valor_pago, o[2].valor_liquido, o[2].tarifa, o[2].juros_multa) == (Decimal("1090.06"), Decimal("1087.56"), Decimal("2.50"), Decimal("10.79"))
    assert (o[2].data_ocorrencia, o[2].data_credito, o[2].valor, o[2].vencimento) == (date(2026, 12, 12), date(2026, 12, 13), Decimal("1079.27"), date(2026, 12, 10))
    assert o[2].payload_bruto.count("\n") == 1 and len(o[2].payload_bruto) == 481
    assert o[5].descricao == "Movimento 77" and o[2].pagador_nome == "JOAO DA CONCEICAO LTDA"
    # LF simples e linha em branco no fim também valem
    assert len(get_banco("033").ler_retorno(arquivo_retorno(detalhes, "\n") + b"\n\x1a").ocorrencias) == 6


def test_retorno_recusa_arquivo_errado_e_avisa_o_que_estranha():
    banco = get_banco("033")
    par = [linha_t(1, "02", nn.montar(1)), linha_u(2, "02")]
    with pytest.raises(LinhaInvalida, match="240"):
        banco.ler_retorno(b"linha curta\r\n")
    with pytest.raises(LinhaInvalida, match="vazio"):
        banco.ler_retorno(b"\r\n")
    with pytest.raises(LinhaInvalida, match="remessa"):
        banco.ler_retorno(arquivo_retorno(par, codigo_arquivo="1"))
    with pytest.raises(LinhaInvalida, match="não está marcado"):
        banco.ler_retorno(arquivo_retorno(par, codigo_arquivo="3"))
    with pytest.raises(LinhaInvalida, match="banco 341"):
        banco.ler_retorno(arquivo_retorno(par, banco="341"))
    with pytest.raises(LinhaInvalida, match="header"):
        banco.ler_retorno((par[0] + "\r\n").encode())
    # T sem U, U solto e segmento desconhecido: lê o que dá e avisa
    y = L.SegmentoY03.montar(sequencial=5, codigo_movimento="02")
    lido = banco.ler_retorno(arquivo_retorno([linha_u(1, "02"), linha_t(2, "02", nn.montar(1)), linha_t(3, "06", nn.montar(2)),
                                              linha_u(4, "06", pago=Decimal("5")), y, linha_t(6, "09", nn.montar(3))]))
    assert [x.codigo_movimento for x in lido.ocorrencias] == ["02", "06", "09"] and len(lido.avisos) == 4
    assert lido.ocorrencias[0].valor_pago == 0 and lido.ocorrencias[0].data_ocorrencia is None
    # contagem do trailer errada: avisa, mas lê
    linhas = arquivo_retorno(par).decode("latin-1").splitlines()
    linhas[-1] = L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=99)
    lido = banco.ler_retorno(("\r\n".join(linhas) + "\r\n").encode("latin-1"))
    assert len(lido.ocorrencias) == 1 and "99" in lido.avisos[0]


def test_validadores_de_arquivo():
    h, lt, p = L.HeaderArquivo.montar(), L.HeaderLote.montar(), L.SegmentoP.montar(sequencial=1)
    tl, ta = L.TrailerLote.montar(qtd_registros=3), L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=5)
    conferir_estrutura([h, lt, p, tl, ta])
    assert separar(juntar([h, lt, p, tl, ta])) == [h, lt, p, tl, ta]
    with pytest.raises(LinhaInvalida):
        juntar(["curta"])
    for errado in ([lt, p, tl, ta], [h, lt, p, tl], [h, lt, lt, p, tl, ta], [h, p, tl, ta], [h, tl, ta], [h, lt, p, ta],
                   [h, lt, p, L.TrailerLote.montar(qtd_registros=9), ta], [h, lt, p, tl, L.TrailerArquivo.montar(qtd_lotes=2, qtd_registros=5)],
                   [h, lt, p, tl, L.TrailerArquivo.montar(qtd_lotes=1, qtd_registros=6)], [h, lt, h, tl, ta]):
        with pytest.raises(LinhaInvalida):
            conferir_estrutura(errado)


def test_tabelas_de_codigos():
    assert cod.separar_motivos("0408  00  ") == ["04", "08"] and cod.separar_motivos("") == []
    assert cod.descrever_motivos(["ZZ"]) == [{"codigo": "ZZ", "descricao": "Motivo ZZ"}]
    assert set(cod.MOVIMENTOS_IMPLEMENTADOS) <= set(cod.MOVIMENTO_REMESSA)
    assert cod.TIPO_COBRANCA_DA_CARTEIRA == {"101": "5", "104": "1"}
