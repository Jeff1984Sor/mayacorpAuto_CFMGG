"""Conciliação bancária: leitura do extrato com débitos e créditos, classificação das linhas (já conciliada, baixa
sugerida, sem correspondência), criação e baixa em lote sem lançamento em dobro, aprendizado, desfazer e permissões.

O banco é um só para a suíte: cada teste abre a sua conta bancária e usa nomes, CNPJs (faixa 82.0xx.xxx) e valores
quebrados que só existem aqui, para não casar com títulos dos outros testes nem deixar título em aberto para eles.
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.financas import conciliacao
from app.modules.financas.models import ConciliacaoRegra, TipoLancamento
from app.modules.rpa_nfse import extrato as leitor
from app.modules.rpa_nfse import parser_txt
from tests.conftest import detalhe
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_api import _cnpj
from tests.test_financas import _cat
from tests.test_financas import _conta as _abrir_conta
from tests.test_perfis import _usuario_com_perfil
from tests.test_regras_comissao import _caso, _cliente, _cobrar, _contrato, _faturar

F = "/api/financeiro"
C = f"{F}/conciliacao"
HOJE = date.today()


_CONTAS: list[int] = []


def _conta(c, h, nome, saldo="0"):
    conta = _abrir_conta(c, h, nome, saldo=saldo)
    _CONTAS.append(conta["id"])
    return conta


@pytest.fixture(autouse=True)
def _contas_do_teste_saem_de_cena(cliente):  # noqa: F811
    """As contas bancárias de cada teste são desativadas no fim: a previsão de caixa e os outros relatórios da suíte
    somam todas as contas ativas do banco (que é um só)."""
    yield
    if _CONTAS:
        h = _login(cliente)
        while _CONTAS:
            assert cliente.delete(f"{F}/contas/{_CONTAS.pop()}", headers=h).status_code == 200


def _dia(n: int) -> date:
    return HOJE - timedelta(days=n)


def _ofx(linhas: list[tuple], saldo: str | None = None) -> bytes:
    """linhas: (data, valor com sinal, FITID, descrição)."""
    corpo = "".join(f"<STMTTRN><TRNTYPE>{'CREDIT' if not str(v).startswith('-') else 'DEBIT'}<DTPOSTED>{d:%Y%m%d}120000"
                    f"<TRNAMT>{v}<FITID>{fitid}<MEMO>{memo}</STMTTRN>\n" for d, v, fitid, memo in linhas)
    fim = f"<LEDGERBAL><BALAMT>{saldo}<DTASOF>{max(ln[0] for ln in linhas):%Y%m%d}</LEDGERBAL>" if saldo is not None else ""
    return (f"OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>341</BANKACCTFROM>"
            f"<BANKTRANLIST>\n{corpo}</BANKTRANLIST>{fim}</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>").encode()


def _subir(c, h, conta_id: int, conteudo: bytes, nome: str = "extrato.ofx") -> dict:
    r = c.post(C, headers=h, data={"conta_id": str(conta_id)}, files={"arquivo": (nome, conteudo)})
    assert r.status_code == 201, r.text
    return r.json()


def _abrir(c, h, cid: int) -> dict:
    r = c.get(f"{C}/{cid}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _linha(det: dict, trecho: str) -> dict:
    return next(ln for ln in det["linhas"] if trecho in ln["descricao"])


def _lancamentos(c, h, conta_id: int) -> list[dict]:
    r = c.get(f"{F}/contas/{conta_id}/extrato", headers=h, params={"de": _dia(90).isoformat(), "ate": (HOJE + timedelta(days=5)).isoformat()})
    return r.json()["linhas"]


def _saldo(c, h, conta_id: int) -> Decimal:
    return Decimal(next(x for x in c.get(f"{F}/contas", headers=h).json() if x["id"] == conta_id)["saldo_atual"])


def _fornecedor(c, h, nome: str, n: int) -> dict:
    r = c.post(f"{F}/fornecedores", headers=h, json={"nome": nome, "tipo": "PJ", "cpf_cnpj": _cnpj(n)})
    assert r.status_code == 201, r.text
    return r.json()


def _conta_pagar(c, h, forn: dict, valor: str, venc: date, cat: dict, descricao: str | None = None) -> dict:
    r = c.post(f"{F}/contas-pagar", headers=h, json={"fornecedor_id": forn["id"], "descricao": descricao, "data_vencimento": venc.isoformat(),
                                                     "rateio": [{"categoria_id": cat["id"], "valor": valor}]})
    assert r.status_code == 201, r.text
    return r.json()[0]


def _fatura(c, h, cli: dict, nome: str, valor: str) -> dict:
    """Uma NH em aberto (sem NFS-e) para o cliente: contrato, caso e cobrança próprios."""
    caso = _caso(c, h, _contrato(c, h, cli, nome), f"Caso {nome}")
    _cobrar(c, h, caso, valor)
    return next(f for f in _faturar(c, h, cli) if Decimal(f["valor"]) == Decimal(valor))


def _emitir(c, h, numeros: list[int], valor: str) -> dict:
    """NFS-e (e a NH de cada uma) para um cliente só deste arquivo: a previsão de caixa da suíte estima o prazo de
    cada cliente pelo histórico de pagamento, e estas notas são pagas no mesmo dia."""
    emissora = c.get("/api/nfse/emissoras", headers=h).json()[0]
    arq = parser_txt.gerar_arquivo("12345678", [detalhe(n, valor=valor, doc=_cnpj(82000012), nome="CONDOMINIO BOSQUE CONC",
                                                        email="sindico@bosqueconc.com.br") for n in numeros])
    lote = c.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("f.txt", arq)}, data={"emissora_id": emissora["id"]}).json()
    assert c.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h).status_code == 200
    return lote


def _ler_fatura(c, h, fid: int) -> dict:
    return c.get(f"/api/nfse/faturas/{fid}", headers=h).json()


# ================================================================ leitor e texto (sem banco)
def test_leitor_devolve_debitos_e_creditos_em_ofx_e_csv():
    d1, d2 = date(2025, 5, 5), date(2025, 5, 6)
    ofx = _ofx([(d1, "1500.00", "A1", "PIX RECEBIDO CLIENTE UM"), (d1, "-45.90", "A2", "TARIFA PACOTE"),
                (d2, "-380.00", "A3", "PIX ENVIADO GRAFICA"), (d2, "-380.00", "A3", "PIX ENVIADO GRAFICA"),  # FITID repetido: a mesma linha
                (d2, "0.00", "A4", "SALDO DO DIA")], saldo="1074.10")
    lido = leitor.ler_movimentos("extrato.ofx", ofx)
    assert [(m.tipo, m.valor) for m in lido.movimentos] == [("credito", Decimal("1500.00")), ("debito", Decimal("45.90")),
                                                            ("debito", Decimal("380.00"))]
    assert lido.saldo_final == Decimal("1074.10") and lido.data_saldo == d2 and lido.banco is None
    # quem já usava o leitor continua recebendo só os créditos, com a MESMA chave da linha
    so_creditos = leitor.ler("extrato.ofx", ofx)
    assert [c.chave for c in so_creditos.creditos] == ["ofx:A1"] == [m.chave for m in lido.movimentos if m.tipo == "credito"]
    assert so_creditos.debitos_ignorados == 3

    csv = ("Extrato de conta corrente\nData;Histórico;Documento;Valor;Saldo\n"
           "05/05/2025;PIX RECEBIDO CLIENTE UM;111;1.500,00;2.500,00\n"
           "06/05/2025;TARIFA PIX;;-1,50;2.498,50\n"
           "06/05/2025;TARIFA PIX;;-1,50;2.497,00\n"  # duas tarifas iguais no mesmo dia: dois movimentos
           "07/05/2025;PAGTO BOLETO;222;380,00-;2.117,00\n").encode("cp1252")
    lido = leitor.ler_movimentos("extrato.csv", csv)
    assert [(m.tipo, m.valor) for m in lido.movimentos] == [("credito", Decimal("1500.00")), ("debito", Decimal("1.50")),
                                                            ("debito", Decimal("1.50")), ("debito", Decimal("380.00"))]
    tarifas = [m.chave for m in lido.movimentos if m.descricao == "TARIFA PIX"]
    assert tarifas[1] == tarifas[0] + "#2" and len({m.chave for m in lido.movimentos}) == 4
    assert lido.saldo_final == Decimal("2117.00") and lido.data_saldo == date(2025, 5, 7)
    assert leitor.ler("extrato.csv", csv).creditos[0].chave == lido.movimentos[0].chave

    colunas = b"Data,Descricao,Credito,Debito\n2025-05-05,DEPOSITO,200.00,\n2025-05-06,SAQUE,,80.00\n"
    lido = leitor.ler_movimentos("banco.csv", colunas)
    assert [(m.tipo, m.valor) for m in lido.movimentos] == [("credito", Decimal("200.00")), ("debito", Decimal("80.00"))]
    assert lido.saldo_final is None


def test_descricao_normalizada_e_regra_parecida():
    a = conciliacao.normalizar("PIX ENVIADO 12/03 14:22 Gráfica Estrela LTDA NSU 998877")
    b = conciliacao.normalizar("PIX ENVIADO 09/04 09:01 GRAFICA ESTRELA LTDA NSU 112233")
    assert a == b == "pix enviado grafica estrela ltda nsu"
    assert conciliacao.normalizar("TARIFA PACOTE SERVICOS MAR/2026") == "tarifa pacote servicos"
    # CNPJ válido identifica o favorecido e fica; número qualquer sai
    assert conciliacao.normalizar(f"PAGTO BOLETO {_cnpj(82099999)} DOC 123456") == f"pagto boleto {_cnpj(82099999)} doc"

    regra = ConciliacaoRegra(id=1, tipo=TipoLancamento.debito, padrao=a, categoria_id=7)
    assert conciliacao.regra_para([regra], TipoLancamento.debito, "PIX ENVIADO 01/05 GRAFICA ESTRELA LTDA NSU 5") is regra
    assert conciliacao.regra_para([regra], TipoLancamento.debito, "TED GRAFICA ESTRELA") is regra  # parecida: mesmo favorecido
    assert conciliacao.regra_para([regra], TipoLancamento.credito, "PIX ENVIADO GRAFICA ESTRELA LTDA") is None  # outro sentido
    assert conciliacao.regra_para([regra], TipoLancamento.debito, "PIX ENVIADO PADARIA LUA") is None
    assert conciliacao._significativas(conciliacao.normalizar("PIX ENVIADO 12/03")) == set()  # só o meio de pagamento: não vira regra


# ================================================================ já conciliada e linha repetida
def test_linha_ja_lancada_e_conciliada_e_reimportar_nao_repete(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco A", saldo="5000.00")
    r = c.post(f"{F}/contas/{conta['id']}/lancamentos", headers=h, json={
        "data": _dia(3).isoformat(), "descricao": "Tarifa mensal", "tipo": "debito", "valor": "51.07"})
    assert r.status_code == 201, r.text
    forn = _fornecedor(c, h, "Limpeza Brilho Conc", 82000001)
    cp = _conta_pagar(c, h, forn, "321.09", _dia(2), _cat(c, h, "Aluguel e condomínio"))
    assert c.post(f"{F}/contas-pagar/{cp['id']}/pagar", headers=h, json={"data": _dia(2).isoformat(), "conta_bancaria_id": conta["id"]}).status_code == 200
    antes = _lancamentos(c, h, conta["id"])

    ofx = _ofx([(_dia(2), "-51.07", "CA-1", "TARIFA MENSALIDADE"),  # 1 dia depois do lançamento do sistema
                (_dia(2), "-321.09", "CA-2", "PIX ENVIADO LIMPEZA BRILHO CONC"),
                (_dia(1), "-9.93", "CA-3", "TARIFA AVULSA TED")])
    imp = _subir(c, h, conta["id"], ofx)
    assert imp["novas"] == 3 and not imp["ja_importado"]
    det = _abrir(c, h, imp["id"])
    assert det["resumo"]["conciliadas"] == 2 and det["resumo"]["pagar_criar"] == 1 and det["resumo"]["baixas"] == 0
    tarifa = _linha(det, "MENSALIDADE")
    assert tarifa["situacao"] == "conciliada" and "1 dia de diferença" in tarifa["motivo"] and tarifa["vinculos"][0]["tipo"] == "vinculo"
    paga = _linha(det, "LIMPEZA")
    assert paga["situacao"] == "conciliada" and paga["vinculos"][0]["conta_pagar_id"] == cp["id"]
    assert _lancamentos(c, h, conta["id"]) == antes  # nada foi criado
    assert det["so_no_sistema"] == [] and c.get(C, headers=h, params={"conta_id": conta["id"]}).json()[0]["id"] == imp["id"]

    # o mesmo arquivo de novo: nenhuma linha nova, aponta para a conciliação que já existe
    de_novo = _subir(c, h, conta["id"], ofx)
    assert de_novo["ja_importado"] and de_novo["id"] == imp["id"]
    # outro arquivo com as mesmas linhas e uma nova: só a nova entra
    maior = _ofx([(_dia(2), "-51.07", "CA-1", "TARIFA MENSALIDADE"), (_dia(2), "-321.09", "CA-2", "PIX ENVIADO LIMPEZA BRILHO CONC"),
                  (_dia(1), "-9.93", "CA-3", "TARIFA AVULSA TED"), (HOJE, "-13.31", "CA-4", "TARIFA DOC")])
    imp2 = _subir(c, h, conta["id"], maior, "extrato_maior.ofx")
    det2 = _abrir(c, h, imp2["id"])
    assert imp2["novas"] == 1 and imp2["repetidas"] == 3 and len(det2["linhas"]) == 1 and det2["qtd_repetidas"] == 3
    # o mesmo período baixado de novo em CSV (outra chave por linha): o que já foi conferido volta com aviso
    csv = (f"Data;Histórico;Valor\n{_dia(2):%d/%m/%Y};TARIFA MENSALIDADE;-51,07\n{_dia(1):%d/%m/%Y};OUTRA COISA;-77,71\n").encode()
    imp3 = _subir(c, h, conta["id"], csv, "mesmo_periodo.csv")
    det3 = _abrir(c, h, imp3["id"])
    assert "já foi conferida no extrato extrato.ofx" in _linha(det3, "TARIFA MENSALIDADE")["aviso"]
    assert _linha(det3, "OUTRA COISA")["aviso"] is None
    assert c.post(f"{C}/{imp3['id']}/ignorar", headers=h, json={"linha_ids": [ln["id"] for ln in det3["linhas"]]}).status_code == 200
    # arquivo que não é extrato
    assert c.post(C, headers=h, data={"conta_id": str(conta["id"])}, files={"arquivo": ("x.pdf", b"%PDF-1.4")}).status_code == 400
    assert c.post(C, headers=h, data={"conta_id": "999999"}, files={"arquivo": ("extrato.ofx", ofx)}).status_code == 404
    # deixa a conta limpa: as duas linhas de tarifa viram contas pagas
    tarifas = _cat(c, h, "Tarifas bancárias")
    for cid, d in ((imp["id"], det), (imp2["id"], det2)):
        itens = [{"linha_id": ln["id"], "descricao": ln["descricao"], "categoria_id": tarifas["id"]}
                 for ln in d["linhas"] if ln["situacao"] == "sem_correspondencia"]
        assert c.post(f"{C}/{cid}/criar-pagar", headers=h, json={"itens": itens}).status_code == 200


# ================================================================ baixas sugeridas (um título e vários)
def test_baixa_sugerida_de_conta_a_pagar_e_de_fatura_inclusive_varios_titulos(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco B", saldo="10000.00")
    aluguel = _cat(c, h, "Aluguel e condomínio")
    papelaria = _fornecedor(c, h, "Papelaria Aurora Conc", 82000002)
    cp = _conta_pagar(c, h, papelaria, "432.17", _dia(1), aluguel, "Material de escritório")
    grafica = _fornecedor(c, h, "Editora Farol Conc", 82000003)
    cp1 = _conta_pagar(c, h, grafica, "100.11", _dia(4), aluguel, "Livros 1")
    cp2 = _conta_pagar(c, h, grafica, "200.22", _dia(2), aluguel, "Livros 2")
    cp_solta = _conta_pagar(c, h, _fornecedor(c, h, "Seguradora Vale Conc", 82000004), "87.63", _dia(20), aluguel, "Seguro")
    horizonte = _cliente(c, h, "Construtora Horizonte Conc", 82000005)
    f1 = _fatura(c, h, horizonte, "Horizonte consultivo", "1777.71")
    duna = _cliente(c, h, "Transportes Duna Conc", 82000006)
    f2, f3 = _fatura(c, h, duna, "Duna trabalhista", "600.13"), _fatura(c, h, duna, "Duna tributário", "900.24")

    ofx = _ofx([
        (_dia(3), "-432.17", "CB-1", "PIX ENVIADO PAPELARIA AURORA CONC"),            # valor + nome + 2 dias
        (_dia(1), "-300.33", "CB-2", f"PAGTO TITULOS {_cnpj(82000003)}"),              # um débito, duas contas (pelo CNPJ)
        (_dia(1), "-87.63", "CB-3", "DEBITO AUTOMATICO"),                              # só o valor: confiança média
        (_dia(1), "1777.71", "CB-4", "PIX RECEBIDO CONSTRUTORA HORIZONTE CONC"),       # valor + cliente
        (HOJE, "1500.37", "CB-5", "TED RECEBIDA TRANSPORTES DUNA CONC"),               # um crédito, duas faturas
    ], saldo="12457.95")
    imp = _subir(c, h, conta["id"], ofx)
    det = _abrir(c, h, imp["id"])
    assert det["resumo"]["baixas"] == 5 and det["resumo"]["baixas_alta"] == 4 and det["resumo"]["pendentes"] == 5
    um = _linha(det, "PAPELARIA")
    assert um["situacao"] == "baixa_sugerida" and um["confianca"] == "alta" and "2 dias de diferença" in um["motivo"]
    assert um["titulos"] == [{"tipo": "conta_pagar", "id": cp["id"], "rotulo": "Material de escritório", "nome": "Papelaria Aurora Conc",
                              "valor": "432.17", "valor_liquido": None, "vencimento": _dia(1).isoformat()}]
    varias = _linha(det, "PAGTO TITULOS")
    assert varias["confianca"] == "alta" and {t["id"] for t in varias["titulos"]} == {cp1["id"], cp2["id"]} and "soma dos 2" in varias["motivo"]
    so_valor = _linha(det, "DEBITO AUTOMATICO")
    assert so_valor["confianca"] == "media" and so_valor["titulos"][0]["id"] == cp_solta["id"] and "única conta" in so_valor["motivo"]
    fat = _linha(det, "HORIZONTE")
    assert fat["confianca"] == "alta" and fat["titulos"][0]["id"] == f1["id"] and fat["titulos"][0]["tipo"] == "fatura"
    duas = _linha(det, "DUNA")
    assert duas["confianca"] == "alta" and {t["id"] for t in duas["titulos"]} == {f2["id"], f3["id"]}
    assert _lancamentos(c, h, conta["id"]) == []  # sugestão não grava nada
    # fechamento: o extrato diz 12.457,95; o sistema ainda tem só o saldo inicial e a diferença é o que falta lançar
    fech = det["fechamento"]
    assert (fech["saldo_extrato"], fech["saldo_sistema"], fech["diferenca"], fech["a_lancar"], fech["sem_explicacao"]) == (
        "12457.95", "10000.00", "2457.95", "2457.95", "0.00")

    # busca de título para trocar a sugestão
    achados = c.get(f"{C}/titulos", headers=h, params={"tipo": "fatura", "q": "Duna Conc"}).json()
    assert {t["id"] for t in achados} == {f2["id"], f3["id"]}
    assert c.get(f"{C}/titulos", headers=h, params={"tipo": "conta_pagar", "q": "Farol Conc"}).json()[0]["nome"] == "Editora Farol Conc"

    # débito não dá baixa em fatura; e a soma tem de fechar. Com erro, NADA do lote é gravado
    itens = [{"linha_id": ln["id"], "titulo": ln["titulos"][0]["tipo"], "ids": [t["id"] for t in ln["titulos"]]} for ln in det["linhas"]]
    errado = [dict(i) for i in itens]
    next(i for i in errado if i["linha_id"] == varias["id"])["ids"] = [cp1["id"]] + [cp_solta["id"]]
    r = c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": errado})
    assert r.status_code == 400 and r.json()["detail"]["linhas"][0]["linha_id"] == varias["id"], r.text
    assert "contas somam" in r.json()["detail"]["linhas"][0]["motivo"] and _lancamentos(c, h, conta["id"]) == []
    assert c.get(f"{F}/contas-pagar/{cp['id']}", headers=h).json()["status"] != "pago"

    r = c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": itens})
    assert r.status_code == 200, r.text
    assert r.json()["feitas"] == 5 and r.json()["conciliacao"]["resumo"]["feitas"] == 5 and r.json()["conciliacao"]["resumo"]["pendentes"] == 0
    paga = c.get(f"{F}/contas-pagar/{cp['id']}", headers=h).json()
    assert paga["status"] == "pago" and paga["data_pagamento"] == _dia(3).isoformat() and paga["conta_bancaria_id"] == conta["id"]
    assert all(c.get(f"{F}/contas-pagar/{x['id']}", headers=h).json()["data_pagamento"] == _dia(1).isoformat() for x in (cp1, cp2, cp_solta))
    for f, quando in ((f1, _dia(1)), (f2, HOJE), (f3, HOJE)):
        lida = _ler_fatura(c, h, f["id"])
        assert lida["situacao"] == "paga" and lida["pago_em"] == quando.isoformat()
    lancs = _lancamentos(c, h, conta["id"])
    assert sorted(Decimal(x["valor"]) for x in lancs if x["tipo"] == "credito") == [Decimal("600.13"), Decimal("900.24"), Decimal("1777.71")]
    assert len([x for x in lancs if x["origem"] == "conta_pagar"]) == 4 and len(lancs) == 7
    assert _saldo(c, h, conta["id"]) == Decimal("12457.95")
    final = _abrir(c, h, imp["id"])
    assert final["fechamento"]["diferenca"] == "0.00" and final["so_no_sistema"] == []
    assert {v["tipo"] for ln in final["linhas"] for v in ln["vinculos"]} == {"baixa_conta", "baixa_fatura"}

    # confirmar de novo o mesmo popup não lança nada em dobro
    r = c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": itens})
    assert r.status_code == 200 and r.json()["feitas"] == 0 and r.json()["ja_feitas"] == 5
    assert len(_lancamentos(c, h, conta["id"])) == 7


# ================================================================ criar em lote, campo faltando e aprendizado
def test_criar_em_lote_pagar_e_receber_sem_credito_em_dobro_e_aprende(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco C", saldo="3000.00")
    tec, receitas = _cat(c, h, "Tecnologia e sistemas"), _cat(c, h, "Receitas financeiras", "receita")
    tarifas = _cat(c, h, "Tarifas bancárias")
    sub = c.post(f"{F}/categorias/{tec['id']}/subcategorias", headers=h, json={"nome": "Impressão conc"}).json()
    grafica = _fornecedor(c, h, "Grafica Estrela Conc", 82000007)
    marte = _cliente(c, h, "Clinica Marte Conc", 82000008)
    adiantada = _fatura(c, h, marte, "Marte consultivo", "1888.83")

    ofx = _ofx([
        (_dia(12), "1888.83", "CC-1", "TED RECEBIDA 99887"),                 # caiu antes de a fatura existir: sem sugestão de baixa
        (_dia(2), "-45.91", "CC-2", "TARIFA PACOTE SERVICOS 10/2026"),
        (_dia(2), "-380.07", "CC-3", "PIX ENVIADO IMPRESSOS LUNAR NSU 123456"),
        (_dia(1), "250.03", "CC-4", "DEPOSITO EM DINHEIRO AGENCIA 0044"),
    ])
    imp = _subir(c, h, conta["id"], ofx)
    det = _abrir(c, h, imp["id"])
    assert det["resumo"]["pagar_criar"] == 2 and det["resumo"]["receber_criar"] == 2 and det["resumo"]["baixas"] == 0
    assert det["resumo"]["valor_pagar_criar"] == "425.98" and det["resumo"]["valor_receber_criar"] == "2138.86"
    tarifa, pix = _linha(det, "TARIFA PACOTE"), _linha(det, "IMPRESSOS LUNAR")
    ted, deposito = _linha(det, "TED RECEBIDA"), _linha(det, "DEPOSITO")
    # tarifa: a categoria já vem pelas palavras; o PIX para quem o sistema não conhece vem sem categoria
    assert tarifa["sugestao"]["categoria_id"] == tarifas["id"] and tarifa["sugestao"]["origem"] == "palavras"
    assert tarifa["sugestao"]["natureza"] == "tarifa" and tarifa["sugestao"]["favorecido"] == "Itaú"
    assert pix["sugestao"]["categoria_id"] is None and pix["sugestao"]["favorecido"] == "Impressos Lunar"
    assert pix["sugestao"]["descricao"] == "PIX ENVIADO IMPRESSOS LUNAR NSU 123456"

    # ---- contas a pagar: categoria faltando numa linha → nada é gravado e a resposta diz qual
    qtd_contas = c.get(f"{F}/contas-pagar", headers=h).json()["total"]
    itens = [{"linha_id": tarifa["id"], "descricao": "Tarifa do pacote de serviços", "categoria_id": tarifas["id"], "favorecido": "Itaú"},
             {"linha_id": pix["id"], "descricao": "Impressão de petições", "categoria_id": None, "fornecedor_id": grafica["id"]}]
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": itens})
    assert r.status_code == 400, r.text
    assert r.json()["detail"]["linhas"] == [{"linha_id": pix["id"], "motivo": "Escolha a categoria."}]
    assert c.get(f"{F}/contas-pagar", headers=h).json()["total"] == qtd_contas and _lancamentos(c, h, conta["id"]) == []
    itens[1]["categoria_id"] = receitas["id"]  # categoria de receita numa conta a pagar também não passa
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": itens})
    assert r.status_code == 400 and "é de receita" in r.json()["detail"]["linhas"][0]["motivo"]
    # um crédito não entra no popup de contas a pagar
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": [{"linha_id": deposito["id"], "descricao": "x", "categoria_id": tec["id"]}]})
    assert r.status_code == 400 and "entrada" in r.json()["detail"]["linhas"][0]["motivo"]

    itens[1].update(categoria_id=tec["id"], subcategoria_id=sub["id"])
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": itens})
    assert r.status_code == 200, r.text
    assert r.json()["feitas"] == 2 and r.json()["mensagem"].startswith("2 conta(s) a pagar criada(s)")
    criada = c.get(f"{F}/contas-pagar", headers=h, params={"fornecedor_id": grafica["id"]}).json()["itens"][0]
    assert criada["status"] == "pago" and criada["data_pagamento"] == _dia(2).isoformat() and criada["valor"] == "380.07"
    assert criada["conta_bancaria_id"] == conta["id"] and criada["descricao"] == "Impressão de petições"
    assert criada["subcategoria_nome"] == "Impressão conc" and criada["forma_pagamento"] == "pix"
    lancs = _lancamentos(c, h, conta["id"])
    assert [(x["origem"], x["valor"]) for x in lancs] == [("conta_pagar", "45.91"), ("conta_pagar", "380.07")]
    assert lancs[1]["conta_pagar_id"] == criada["id"]
    # confirmar de novo: nada em dobro
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": itens})
    assert r.status_code == 200 and r.json()["feitas"] == 0 and r.json()["ja_feitas"] == 2 and len(_lancamentos(c, h, conta["id"])) == 2

    # ---- recebimentos: um avulso e um vinculado a fatura em aberto
    receber = [{"linha_id": deposito["id"], "modo": "avulsa", "descricao": "Depósito em dinheiro", "categoria_id": None, "favorecido": "Caixa"},
               {"linha_id": ted["id"], "modo": "fatura", "fatura_ids": [adiantada["id"]]}]
    r = c.post(f"{C}/{imp['id']}/criar-receber", headers=h, json={"itens": receber})
    assert r.status_code == 400 and r.json()["detail"]["linhas"] == [{"linha_id": deposito["id"], "motivo": "Escolha a categoria."}]
    assert _ler_fatura(c, h, adiantada["id"])["situacao"] != "paga" and len(_lancamentos(c, h, conta["id"])) == 2
    receber[0]["categoria_id"] = receitas["id"]
    sem_fatura = [receber[0], {"linha_id": ted["id"], "modo": "fatura", "fatura_ids": []}]
    assert c.post(f"{C}/{imp['id']}/criar-receber", headers=h, json={"itens": sem_fatura}).json()["detail"]["linhas"][0]["motivo"] == "Escolha a fatura."
    r = c.post(f"{C}/{imp['id']}/criar-receber", headers=h, json={"itens": receber})
    assert r.status_code == 200 and r.json()["feitas"] == 2, r.text
    paga = _ler_fatura(c, h, adiantada["id"])
    assert paga["situacao"] == "paga" and paga["pago_em"] == _dia(12).isoformat()
    creditos = [x for x in _lancamentos(c, h, conta["id"]) if x["tipo"] == "credito"]
    assert sorted((x["origem"], x["valor"], x["fatura_id"]) for x in creditos) == [
        ("fatura", "1888.83", adiantada["id"]), ("manual", "250.03", None)]  # UM crédito por linha: nada em dobro
    assert next(x for x in creditos if x["origem"] == "manual")["categoria_nome"] == "Receitas financeiras"
    r = c.post(f"{C}/{imp['id']}/criar-receber", headers=h, json={"itens": receber})
    assert r.json()["feitas"] == 0 and r.json()["ja_feitas"] == 2 and len(_lancamentos(c, h, conta["id"])) == 4
    assert _saldo(c, h, conta["id"]) == Decimal("3000.00") - Decimal("425.98") + Decimal("2138.86")
    assert _abrir(c, h, imp["id"])["resumo"]["pendentes"] == 0

    # ---- aprendizado: no extrato do mês seguinte a sugestão já vem com o que o usuário escolheu
    regras = c.get(f"{C}/regras", headers=h).json()
    do_pix = next(x for x in regras if x["padrao"] == "pix enviado impressos lunar nsu")
    assert do_pix["categoria_nome"] == "Tecnologia e sistemas" and do_pix["subcategoria_nome"] == "Impressão conc"
    assert do_pix["favorecido_nome"] == "Grafica Estrela Conc" and do_pix["tipo"] == "debito"
    seguinte = _ofx([(HOJE, "-47.15", "CC-5", "TARIFA PACOTE SERVICOS 11/2026"),
                     (HOJE, "-512.49", "CC-6", "PIX ENVIADO IMPRESSOS LUNAR NSU 778899"),
                     (HOJE, "310.07", "CC-7", "DEPOSITO EM DINHEIRO AGENCIA 0044")])
    imp2 = _subir(c, h, conta["id"], seguinte, "novembro.ofx")
    det2 = _abrir(c, h, imp2["id"])
    s = _linha(det2, "IMPRESSOS LUNAR")["sugestao"]
    assert (s["origem"], s["categoria_id"], s["subcategoria_id"], s["fornecedor_id"]) == ("regra", tec["id"], sub["id"], grafica["id"])
    s = _linha(det2, "DEPOSITO")["sugestao"]
    assert (s["origem"], s["categoria_id"], s["favorecido"]) == ("regra", receitas["id"], "Caixa")
    assert _linha(det2, "TARIFA")["sugestao"]["origem"] == "regra"
    # esquecer a regra: a próxima abertura volta a pedir a categoria
    assert c.delete(f"{C}/regras/{do_pix['id']}", headers=h).status_code == 200
    assert _linha(_abrir(c, h, imp2["id"]), "IMPRESSOS LUNAR")["sugestao"]["categoria_id"] is None
    # ignorar tira a linha da contagem; e ela pode voltar
    ids = [ln["id"] for ln in det2["linhas"]]
    r = c.post(f"{C}/{imp2['id']}/ignorar", headers=h, json={"linha_ids": ids})
    assert r.json()["resumo"]["ignoradas"] == 3 and r.json()["resumo"]["pendentes"] == 0
    r = c.post(f"{C}/{imp2['id']}/ignorar", headers=h, params={"voltar": True}, json={"linha_ids": ids[:1]})
    assert r.json()["resumo"]["ignoradas"] == 2 and r.json()["resumo"]["pendentes"] == 1


# ================================================================ desfazer em bloco
def test_desfazer_em_bloco_e_o_que_nao_pode_ser_desfeito(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco D", saldo="2000.00")
    aluguel, receitas = _cat(c, h, "Aluguel e condomínio"), _cat(c, h, "Receitas financeiras", "receita")
    forn = _fornecedor(c, h, "Elevadores Torre Conc", 82000009)
    cp = _conta_pagar(c, h, forn, "611.19", _dia(1), aluguel, "Manutenção do elevador")
    cli = _cliente(c, h, "Hotel Jardim Conc", 82000010)
    fat = _fatura(c, h, cli, "Jardim consultivo", "2222.29")
    ofx = _ofx([(_dia(1), "-611.19", "CD-1", "PIX ENVIADO ELEVADORES TORRE CONC"), (_dia(1), "2222.29", "CD-2", "PIX RECEBIDO HOTEL JARDIM CONC"),
                (_dia(1), "-73.37", "CD-3", "CARTORIO SETIMO OFICIO"), (HOJE, "140.41", "CD-4", "REEMBOLSO SEGURO VIAGEM"),
                (HOJE, "55.53", "CD-5", "DEVOLUCAO CAUCAO SALA")])
    imp = _subir(c, h, conta["id"], ofx)
    det = _abrir(c, h, imp["id"])
    baixas = [{"linha_id": ln["id"], "titulo": ln["titulos"][0]["tipo"], "ids": [t["id"] for t in ln["titulos"]]}
              for ln in det["linhas"] if ln["situacao"] == "baixa_sugerida"]
    assert len(baixas) == 2 and c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": baixas}).status_code == 200
    cartorio, reembolso, caucao = _linha(det, "CARTORIO"), _linha(det, "REEMBOLSO"), _linha(det, "CAUCAO")
    assert c.post(f"{C}/{imp['id']}/criar-pagar", headers=h, json={"itens": [
        {"linha_id": cartorio["id"], "descricao": "Custas de cartório", "categoria_id": aluguel["id"], "favorecido": "Cartório"}]}).status_code == 200
    assert c.post(f"{C}/{imp['id']}/criar-receber", headers=h, json={"itens": [
        {"linha_id": x["id"], "modo": "avulsa", "descricao": x["descricao"], "categoria_id": receitas["id"]} for x in (reembolso, caucao)]}).status_code == 200
    assert len(_lancamentos(c, h, conta["id"])) == 5 and _saldo(c, h, conta["id"]) == Decimal("3733.67")
    qtd_contas = c.get(f"{F}/contas-pagar", headers=h, params={"q": "Custas de cartório"}).json()["total"]
    assert qtd_contas == 1

    # o crédito da caução foi estornado no extrato da conta: esse a conciliação não desfaz sozinha
    lanc_caucao = next(x for x in _lancamentos(c, h, conta["id"]) if "CAUCAO" in x["descricao"])
    assert c.post(f"{F}/lancamentos/{lanc_caucao['id']}/estornar", headers=h, json={"motivo": "teste"}).status_code == 201

    r = c.post(f"{C}/{imp['id']}/desfazer", headers=h, json={"excluir_importacao": True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["desfeitas"] == 4 and not d["excluida"] and len(d["nao_desfeitas"]) == 1
    assert d["nao_desfeitas"][0]["linha_id"] == caucao["id"] and "estornado" in d["nao_desfeitas"][0]["motivo"]
    # a conta criada sumiu; a que já existia voltou a ficar em aberto; a fatura voltou a ficar em aberto
    assert c.get(f"{F}/contas-pagar", headers=h, params={"q": "Custas de cartório"}).json()["total"] == 0
    assert c.get(f"{F}/contas-pagar/{cp['id']}", headers=h).json()["data_pagamento"] is None
    assert _ler_fatura(c, h, fat["id"])["situacao"] in ("aberta", "vencida")
    restou = _lancamentos(c, h, conta["id"])
    assert sorted(x["origem"] for x in restou) == ["estorno", "manual"] and _saldo(c, h, conta["id"]) == Decimal("2000.00")
    # as linhas voltaram a ficar pendentes, com as mesmas sugestões de antes
    volta = d["conciliacao"]
    assert volta["resumo"]["baixas"] == 2 and volta["resumo"]["pagar_criar"] == 1 and volta["resumo"]["receber_criar"] == 1
    assert volta["resumo"]["feitas"] == 1 and _linha(volta, "ELEVADORES")["titulos"][0]["id"] == cp["id"]
    assert _linha(volta, "CARTORIO")["sugestao"]["origem"] == "regra"  # o que foi ensinado continua valendo

    # tira o estorno, desfaz o que faltava e exclui o extrato: o arquivo pode ser enviado de novo
    estorno = next(x for x in restou if x["origem"] == "estorno")
    assert c.delete(f"{F}/lancamentos/{estorno['id']}", headers=h).status_code == 200
    r = c.post(f"{C}/{imp['id']}/desfazer", headers=h, json={"excluir_importacao": True})
    assert r.status_code == 200 and r.json()["excluida"] and r.json()["conciliacao"] is None and r.json()["desfeitas"] == 1
    assert c.get(f"{C}/{imp['id']}", headers=h).status_code == 404 and _lancamentos(c, h, conta["id"]) == []
    de_novo = _subir(c, h, conta["id"], ofx)
    assert not de_novo["ja_importado"] and de_novo["novas"] == 5
    # fecha o que este teste abriu: baixa os dois títulos e ignora o resto
    det = _abrir(c, h, de_novo["id"])
    baixas = [{"linha_id": ln["id"], "titulo": ln["titulos"][0]["tipo"], "ids": [t["id"] for t in ln["titulos"]]}
              for ln in det["linhas"] if ln["situacao"] == "baixa_sugerida"]
    assert c.post(f"{C}/{de_novo['id']}/aprovar-baixas", headers=h, json={"itens": baixas}).json()["feitas"] == 2
    # desfazer só uma linha
    linha = next(ln for ln in _abrir(c, h, de_novo["id"])["linhas"] if "ELEVADORES" in ln["descricao"])
    r = c.post(f"{C}/{de_novo['id']}/desfazer", headers=h, json={"linha_ids": [linha["id"]]})
    assert r.json()["desfeitas"] == 1 and r.json()["conciliacao"]["resumo"]["feitas"] == 1
    assert c.get(f"{F}/contas-pagar/{cp['id']}", headers=h).json()["data_pagamento"] is None
    refeita = _linha(r.json()["conciliacao"], "ELEVADORES")
    assert c.post(f"{C}/{de_novo['id']}/aprovar-baixas", headers=h, json={"itens": [
        {"linha_id": refeita["id"], "titulo": "conta_pagar", "ids": [cp["id"]]}]}).json()["feitas"] == 1


# ================================================================ o inverso: só no sistema; e o que muda por fora
def test_so_no_sistema_fechamento_e_baixa_desfeita_em_outra_tela(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco E", saldo="1000.00")
    aluguel = _cat(c, h, "Aluguel e condomínio")
    # digitado no sistema e que o banco não mostra
    fantasma = c.post(f"{F}/contas/{conta['id']}/lancamentos", headers=h, json={
        "data": _dia(4).isoformat(), "descricao": "Pagamento digitado errado", "tipo": "debito", "valor": "99.97"}).json()
    fora = c.post(f"{F}/contas/{conta['id']}/lancamentos", headers=h, json={
        "data": _dia(40).isoformat(), "descricao": "Antes do período", "tipo": "debito", "valor": "10.03"}).json()
    forn = _fornecedor(c, h, "Telefonia Sinal Conc", 82000011)
    cp = _conta_pagar(c, h, forn, "188.81", _dia(3), aluguel, "Internet")
    ofx = _ofx([(_dia(5), "-20.07", "CE-1", "TARIFA TED"), (_dia(3), "-188.81", "CE-2", "DEB AUT TELEFONIA SINAL CONC")], saldo="781.09")
    imp = _subir(c, h, conta["id"], ofx)
    det = _abrir(c, h, imp["id"])
    assert [x["id"] for x in det["so_no_sistema"]] == [fantasma["id"]] and det["resumo"]["so_no_sistema"] == 1
    assert fora["id"] not in [x["id"] for x in det["so_no_sistema"]]
    # extrato 781,09 × sistema 1.000 − 99,97 − 10,03 = 890,00: faltam 208,88 a lançar e sobram 99,97 só no sistema
    fech = det["fechamento"]
    assert (fech["saldo_sistema"], fech["diferenca"], fech["a_lancar"], fech["sem_explicacao"]) == ("890.00", "-108.91", "-208.88", "99.97")

    linha = _linha(det, "TELEFONIA")
    assert c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": [
        {"linha_id": linha["id"], "titulo": "conta_pagar", "ids": [cp["id"]]}]}).status_code == 200
    assert _linha(_abrir(c, h, imp["id"]), "TELEFONIA")["situacao"] == "feita"
    # a conta foi reaberta em Contas a pagar: a linha volta a ficar pendente, com a mesma sugestão
    assert c.post(f"{F}/contas-pagar/{cp['id']}/reabrir", headers=h).status_code == 200
    volta = _linha(_abrir(c, h, imp["id"]), "TELEFONIA")
    assert volta["situacao"] == "baixa_sugerida" and volta["titulos"][0]["id"] == cp["id"] and volta["vinculos"] == []
    # paga em Contas a pagar, pela tela de lá: a linha passa a "conciliada" sem a conciliação criar nada
    assert c.post(f"{F}/contas-pagar/{cp['id']}/pagar", headers=h, json={"data": _dia(2).isoformat(), "conta_bancaria_id": conta["id"]}).status_code == 200
    agora = _linha(_abrir(c, h, imp["id"]), "TELEFONIA")
    assert agora["situacao"] == "conciliada" and agora["vinculos"][0]["conta_pagar_id"] == cp["id"]
    # valor diferente do título escolhido à mão: a diferença entra como juros e o débito fica igual ao do banco
    cp2 = _conta_pagar(c, h, forn, "19.00", _dia(5), aluguel, "Tarifa de religação")
    tarifa = _linha(_abrir(c, h, imp["id"]), "TARIFA TED")
    r = c.post(f"{C}/{imp['id']}/aprovar-baixas", headers=h, json={"itens": [{"linha_id": tarifa["id"], "titulo": "conta_pagar", "ids": [cp2["id"]]}]})
    assert r.status_code == 200, r.text
    paga = c.get(f"{F}/contas-pagar/{cp2['id']}", headers=h).json()
    assert (paga["valor_pago"], paga["juros"]) == ("20.07", "1.07")


# ================================================================ o mesmo arquivo em NFS-e › Recebimentos
def test_mesmo_extrato_em_recebimentos_e_na_conciliacao_nao_duplica(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco F", saldo="0")
    cfg = c.get(f"{F}/config", headers=h).json()
    anterior = cfg["conta_recebimento_id"]
    assert c.put(f"{F}/config", headers=h, json={**cfg, "conta_recebimento_id": conta["id"]}).status_code == 200
    try:
        # ---- 1) primeiro em NFS-e › Recebimentos (baixa automática), depois na conciliação: tudo "já conciliado"
        _emitir(c, h, [9811], "2468.13")
        _emitir(c, h, [9812, 9813], "1357.91")
        ofx = _ofx([(HOJE, "2468.13", "CF-1", "TED RECEBIDA CONDOMINIO BOSQUE CONC"), (HOJE, "2715.82", "CF-2", "TED LOTE CONDOMINIOS")])
        ext = c.post("/api/nfse/extratos", headers=h, files={"arquivo": ("extrato.ofx", ofx)}).json()
        assert ext["qtd_conciliados"] == 2 and ext["notas_baixadas"] == 3
        assert len(_lancamentos(c, h, conta["id"])) == 3  # um crédito por fatura
        imp = _subir(c, h, conta["id"], ofx)
        det = _abrir(c, h, imp["id"])
        assert det["resumo"]["conciliadas"] == 2 and det["resumo"]["pendentes"] == 0 and det["so_no_sistema"] == []
        lote = _linha(det, "LOTE")
        assert len(lote["vinculos"]) == 2 and "NFS-e › Recebimentos (2 faturas)" in lote["motivo"]
        assert len(_lancamentos(c, h, conta["id"])) == 3 and _saldo(c, h, conta["id"]) == Decimal("5183.95")

        # ---- 2) primeiro na conciliação (baixa da fatura com NFS-e), depois em Recebimentos: nada baixa de novo
        _emitir(c, h, [9814], "1593.57")
        ofx2 = _ofx([(HOJE, "1593.57", "CF-3", "PIX RECEBIDO CONDOMINIO BOSQUE CONC")])
        imp2 = _subir(c, h, conta["id"], ofx2, "segundo.ofx")
        linha = _abrir(c, h, imp2["id"])["linhas"][0]
        assert linha["situacao"] == "baixa_sugerida" and linha["confianca"] == "alta" and "NFS-e" in linha["titulos"][0]["rotulo"]
        fid = linha["titulos"][0]["id"]
        assert c.post(f"{C}/{imp2['id']}/aprovar-baixas", headers=h, json={"itens": [
            {"linha_id": linha["id"], "titulo": "fatura", "ids": [fid]}]}).status_code == 200
        fat = _ler_fatura(c, h, fid)
        nota = c.get(f"/api/nfse/notas/{fat['nfse_id']}", headers=h).json()
        assert fat["situacao"] == "paga" and nota["pago_em"] == HOJE.isoformat() and nota["baixa_origem"] == "extrato"
        ext2 = c.post("/api/nfse/extratos", headers=h, files={"arquivo": ("segundo.ofx", ofx2)}).json()
        assert ext2["qtd_conciliados"] == 0 and ext2["notas_baixadas"] == 0
        creditos = [x for x in _lancamentos(c, h, conta["id"]) if x["fatura_id"] == fid]
        assert len(creditos) == 1 and creditos[0]["valor"] == "1593.57" and len(_lancamentos(c, h, conta["id"])) == 4
        # desfazer pela conciliação devolve a nota e a fatura para "em aberto"; refaz para não deixar nota em aberto na suíte
        r = c.post(f"{C}/{imp2['id']}/desfazer", headers=h, json={})
        assert r.json()["desfeitas"] == 1 and _ler_fatura(c, h, fid)["situacao"] in ("aberta", "vencida")
        assert c.get(f"/api/nfse/notas/{fat['nfse_id']}", headers=h).json()["pago_em"] is None
        assert c.post(f"{C}/{imp2['id']}/aprovar-baixas", headers=h, json={"itens": [
            {"linha_id": linha["id"], "titulo": "fatura", "ids": [fid]}]}).json()["feitas"] == 1
    finally:
        c.put(f"{F}/config", headers=h, json={**c.get(f"{F}/config", headers=h).json(), "conta_recebimento_id": anterior})


# ================================================================ IA opcional
def test_sugerir_categorias_com_ia_so_preenche_a_sugestao(cliente, monkeypatch):  # noqa: F811
    from app.core import ia
    from tests.test_ia import _ativar

    c, h = cliente, _login(cliente)
    conta = _conta(c, h, "Conc Banco G", saldo="0")
    tec = _cat(c, h, "Tecnologia e sistemas")
    imp = _subir(c, h, conta["id"], _ofx([(HOJE, "-64.19", "CG-1", "COMPRA CARTAO NUVEM AZUL HOSPEDAGEM")]))
    linha = _abrir(c, h, imp["id"])["linhas"][0]
    assert linha["sugestao"]["categoria_id"] is None
    cfg_ia = c.get("/api/config/ia", headers=h).json()
    if not cfg_ia["ativo"]:  # sem IA ligada o botão nem aparece, e a rota explica
        assert _abrir(c, h, imp["id"])["ia_disponivel"] is False
        assert c.post(f"{C}/{imp['id']}/sugerir-ia", headers=h).status_code == 400
    monkeypatch.setattr(ia, "listar_modelos", lambda provedor, chave: [f"{provedor}-modelo-a"])
    monkeypatch.setattr(ia, "gerar_json", lambda p, sistema, usuario, anexo=None: {"linhas": [
        {"id": linha["id"], "categoria_id": tec["id"], "subcategoria_id": None, "favorecido": "Nuvem Azul"},
        {"id": 999999, "categoria_id": tec["id"]}]})
    _ativar(c, h)
    try:
        assert _abrir(c, h, imp["id"])["ia_disponivel"] is True
        r = c.post(f"{C}/{imp['id']}/sugerir-ia", headers=h)
        assert r.status_code == 200, r.text
        s = r.json()["linhas"][0]["sugestao"]
        assert (s["origem"], s["categoria_id"]) == ("ia", tec["id"]) and _lancamentos(c, h, conta["id"]) == []
        assert _abrir(c, h, imp["id"])["linhas"][0]["sugestao"]["origem"] == "ia"  # reabrir não perde a sugestão
    finally:
        c.put("/api/config/ia", headers=h, json={"ativo": cfg_ia["ativo"], "provedor": cfg_ia["provedor"], "modelo": cfg_ia["modelo"]})
    c.post(f"{C}/{imp['id']}/ignorar", headers=h, json={"linha_ids": [linha["id"]]})


# ================================================================ permissões
def test_permissoes_da_conciliacao(cliente):  # noqa: F811
    c, h = cliente, _login(cliente)
    perfis = {p["nome"]: p for p in c.get("/api/config/perfis", headers=h).json()}
    assert {"conciliacao.ver", "conciliacao.conciliar"} <= set(perfis["Financeiro"]["permissoes"])
    assert {"conciliacao.ver", "conciliacao.conciliar"} <= set(perfis["Operador"]["permissoes"])
    assert "conciliacao.ver" in perfis["Visualizador"]["permissoes"] and "conciliacao.conciliar" not in perfis["Visualizador"]["permissoes"]
    assert not any(p.startswith("conciliacao.") for p in perfis["Advogado"]["permissoes"])
    cat = c.get("/api/config/perfis/catalogo", headers=h).json()
    fin = next(g for g in cat["grupos"] if g["grupo"] == "Financeiro")
    assert next(r for r in fin["recursos"] if r["id"] == "conciliacao")["acoes"] == ["ver", "conciliar"] and "conciliar" in cat["acoes"]

    conta = _conta(c, h, "Conc Banco H", saldo="0")
    ofx = _ofx([(HOJE, "-12.21", "CH-1", "TARIFA CONSULTA")])
    imp = _subir(c, h, conta["id"], ofx)
    linha = _abrir(c, h, imp["id"])["linhas"][0]
    item = {"itens": [{"linha_id": linha["id"], "descricao": "Tarifa", "categoria_id": _cat(c, h, "Tarifas bancárias")["id"]}]}

    _, h_vis, _ = _usuario_com_perfil(c, h, "vis.conciliacao@cfme.com.br", perfis["Visualizador"]["id"])
    assert c.get(C, headers=h_vis).status_code == 200 and c.get(f"{C}/{imp['id']}", headers=h_vis).status_code == 200
    assert c.get(f"{C}/regras", headers=h_vis).status_code == 200
    assert c.get(f"{C}/titulos", headers=h_vis, params={"tipo": "fatura"}).status_code == 200
    assert c.post(C, headers=h_vis, data={"conta_id": str(conta["id"])}, files={"arquivo": ("e.ofx", ofx)}).status_code == 403
    for rota in ("criar-pagar", "criar-receber", "aprovar-baixas", "desfazer", "ignorar", "sugerir-ia"):
        assert c.post(f"{C}/{imp['id']}/{rota}", headers=h_vis, json=item).status_code == 403, rota
    assert c.delete(f"{C}/regras/1", headers=h_vis).status_code == 403

    _, h_adv, _ = _usuario_com_perfil(c, h, "adv.conciliacao@cfme.com.br", perfis["Advogado"]["id"])
    assert c.get(C, headers=h_adv).status_code == 403 and c.get(f"{C}/{imp['id']}", headers=h_adv).status_code == 403

    _, h_fin, _ = _usuario_com_perfil(c, h, "fin.conciliacao@cfme.com.br", perfis["Financeiro"]["id"])
    r = c.post(f"{C}/{imp['id']}/criar-pagar", headers=h_fin, json=item)
    assert r.status_code == 200 and r.json()["feitas"] == 1, r.text
    # recurso do plano (admin): a partir do Escritório
    from app.controle import planos

    assert "conciliacao" in planos.RECURSOS
    assert [nome for nome, *_, recursos in planos.PADRAO if "conciliacao" in recursos] == ["Escritório", "Pro", "Ilimitado"]
