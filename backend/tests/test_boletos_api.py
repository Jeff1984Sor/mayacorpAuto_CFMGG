"""Boletos de ponta a ponta pela API: convênio, cadastro do boleto, PDF, remessa, retorno, baixa da fatura e idempotência."""

import io
from datetime import date, timedelta
from decimal import Decimal

from pypdf import PdfReader

from app.modules.boletos.bancos.santander import codigo_barras as cb
from app.modules.boletos.bancos.santander import layout as L
from app.modules.boletos.bancos.santander import nosso_numero as nn
from app.modules.boletos.boleto_pdf import barcode_itf
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)
from tests.test_boletos_cnab import arquivo_retorno, linha_t, linha_u

HOJE = date.today()
VENC = HOJE + timedelta(days=15)


def _cnpj(raiz: int) -> str:
    """CNPJ válido só destes testes (o banco de teste é o mesmo dos outros módulos: nada de repetir documento)."""
    base = f"{raiz:08d}0001"
    for pesos in ((5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2), (6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)):
        resto = sum(int(d) * p_ for d, p_ in zip(base, pesos, strict=True)) % 11
        base += str(0 if resto < 2 else 11 - resto)
    return base


CNPJ_1, CNPJ_2, CNPJ_3 = _cnpj(70412233), _cnpj(70412244), _cnpj(70412255)


def _base(c, h, nome: str, cnpj: str, endereco: bool = True):
    corpo = {"tipo": "PJ", "nome": nome, "cpf_cnpj": cnpj, "emails": [f"fin@{nome.split()[0].lower()}.com.br"]}
    if endereco:
        corpo.update(cidade="São Paulo", uf="SP", tipo_logradouro="R", logradouro="RUA AUGUSTA", numero="100",
                     bairro="CONSOLACAO", cep="01305000")
    cli = c.post("/api/nfse/tomadores", headers=h, json=corpo)
    assert cli.status_code in (200, 201), cli.text
    cli = cli.json()
    contrato = c.post("/api/faturamento/contratos", headers=h, json={"tomador_id": cli["id"], "nome": f"Contrato {nome}"})
    assert contrato.status_code == 201, contrato.text
    contrato = contrato.json()
    caso = c.post(f"/api/faturamento/contratos/{contrato['id']}/casos", headers=h, json={"titulo": "Ação de cobrança"}).json()
    return cli, contrato, caso


def _fatura(c, h, cli, caso, valor="1150.00", texto="Honorários iniciais"):
    hoje = HOJE.isoformat()
    r = c.post(f"/api/faturamento/casos/{caso['id']}/regras", headers=h, json={
        "tipo": "fixo", "descricao": texto, "valor": valor, "data_pagamento": hoje})
    assert r.status_code in (200, 201), r.text
    params = {"de": hoje, "ate": hoje, "cliente_ids": [cli["id"]]}
    itens = c.get("/api/faturamento/itens-a-faturar", headers=h, params=params).json()["clientes"][0]["contratos"][0]["itens"]
    r = c.post("/api/faturamento/faturar", headers=h, json={"aba": "honorarios", **params, "chaves": [i["chave"] for i in itens]})
    assert r.status_code in (200, 201), r.text
    return r.json()["faturas"][0]


def _retorno(c, h, detalhes, nome="retorno.ret", convenio_id=None):
    dados = {"convenio_id": str(convenio_id)} if convenio_id else {}
    return c.post("/api/boletos/retornos", headers=h, files={"arquivo": (nome, arquivo_retorno(detalhes))}, data=dados)


def test_boletos_do_cadastro_ao_pagamento(cliente):  # noqa: F811
    h = _login(cliente)
    cli, _contrato, caso = _base(cliente, h, "Boletoum Advocacia Cliente", CNPJ_1)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    conta = cliente.post("/api/financeiro/contas", headers=h, json={"nome": "Santander cobrança", "banco": "Santander"})
    assert conta.status_code == 201, conta.text
    conta = conta.json()

    # ---------------------------------------------------------------- convênio
    bancos = cliente.get("/api/boletos/bancos", headers=h).json()
    assert bancos[0]["codigo"] == "033" and "especie_titulo" in bancos[0]["opcoes"]
    corpo = {"nome": "Santander 101", "emissora_id": emissora["id"], "conta_bancaria_id": conta["id"], "agencia": "1234",
             "agencia_dv": "5", "conta": "13000123", "conta_dv": "4", "codigo_beneficiario": "1234567",
             "codigo_transmissao": "123400001234567", "proximo_nosso_numero": 100}
    assert cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "agencia": "12A4"}).status_code == 422
    assert cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "banco": "341"}).status_code == 400
    assert cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "emissora_id": 99999}).status_code == 400
    r = cliente.post("/api/boletos/convenios", headers=h, json=corpo)
    assert r.status_code == 201, r.text
    conv = r.json()
    assert (conv["banco_nome"], conv["pendencias"], conv["homologado"], conv["especie_titulo"], conv["carteira"]) == ("Santander", [], False, "04", "101")
    assert [x["id"] for x in cliente.get("/api/boletos/convenios", headers=h).json()] == [conv["id"]]

    # ---------------------------------------------------------------- boleto de uma fatura
    nh = _fatura(cliente, h, cli, caso)
    disp = cliente.get("/api/boletos/faturas-disponiveis", headers=h, params={"q": "Boletoum"}).json()
    sug = next(x for x in disp if x["id"] == nh["id"])["sugestao"]
    assert (sug["pagador_documento"], sug["pagador_cep"], sug["pagador_uf"], sug["valor"]) == (CNPJ_1, "01305000", "SP", "1150.00")
    assert sug["pagador_endereco"] == "R RUA AUGUSTA, 100"
    novo = {"convenio_id": conv["id"], "fatura_id": nh["id"], **{k: v for k, v in sug.items() if k != "data_vencimento"},
            "data_vencimento": VENC.isoformat()}
    r = cliente.post("/api/boletos", headers=h, json=novo)
    assert r.status_code == 201, r.text
    b1 = r.json()
    assert (b1["status"], b1["nosso_numero"], b1["seu_numero"], b1["fatura_codigo"]) == ("rascunho", nn.montar(100), nh["codigo"].replace(" ", ""), nh["codigo"])
    assert cb.conferir(b1["codigo_barras"]) and b1["codigo_barras"][19:] == "9" + "1234567" + nn.montar(100) + "0" + "101"
    assert b1["linha_digitavel"] == cb.linha_digitavel(b1["codigo_barras"]) and len(b1["linha_digitavel_fmt"]) == 54
    assert (b1["editavel"], b1["pode_enviar_ao_cliente"], b1["nosso_numero_fmt"]) == (True, False, f"{nn.montar(100)[:-1]}-{nn.montar(100)[-1]}")
    assert b1["ocorrencias"][0]["descricao"] == "Boleto criado"
    # a mesma fatura não ganha dois boletos; e some da lista de disponíveis
    r = cliente.post("/api/boletos", headers=h, json=novo)
    assert r.status_code == 400 and "já tem um boleto" in r.json()["detail"]
    assert nh["id"] not in [x["id"] for x in cliente.get("/api/boletos/faturas-disponiveis", headers=h).json()]

    # ---------------------------------------------------------------- boleto avulso: criar, editar, excluir
    avulso = {"convenio_id": conv["id"], "valor": "250.00", "data_vencimento": VENC.isoformat(), "descricao": "Consulta avulsa",
              "pagador_nome": "Maria Conceição", "pagador_documento": "529.982.247-25", "pagador_endereco": "Av. Paulista, 1000",
              "pagador_bairro": "Bela Vista", "pagador_cep": "01310-100", "pagador_cidade": "São Paulo", "pagador_uf": "sp"}
    r = cliente.post("/api/boletos", headers=h, json={**avulso, "pagador_cep": "0131"})
    assert r.status_code == 400 and "CEP" in r.json()["detail"]
    r = cliente.post("/api/boletos", headers=h, json={**avulso, "pagador_documento": "11111111111"})
    assert r.status_code == 400 and "CPF/CNPJ" in r.json()["detail"]
    assert cliente.post("/api/boletos", headers=h, json={**avulso, "valor": "0"}).status_code == 422
    r = cliente.post("/api/boletos", headers=h, json=avulso)
    assert r.status_code == 201, r.text
    b2 = r.json()
    # boleto recusado na validação não gastou número: o avulso é o 101
    assert (b2["nosso_numero"], b2["seu_numero"], b2["pagador_documento"], b2["pagador_cep"], b2["pagador_uf"]) == (nn.montar(101), "BOL00000101", "52998224725", "01310100", "SP")
    r = cliente.put(f"/api/boletos/{b2['id']}", headers=h, json={"valor": "300.00", "pagador_nome": "Maria da Conceição"})
    assert r.status_code == 200, r.text
    assert r.json()["codigo_barras"] != b2["codigo_barras"] and r.json()["codigo_barras"][9:19] == "0000030000"
    assert cliente.put(f"/api/boletos/{b2['id']}", headers=h, json={"pagador_uf": "XX"}).status_code == 400
    assert cliente.get(f"/api/boletos/{b2['id']}", headers=h).json()["pagador_uf"] == "SP"  # a edição recusada não ficou
    extra = cliente.post("/api/boletos", headers=h, json=avulso).json()
    assert cliente.delete(f"/api/boletos/{extra['id']}", headers=h).status_code == 200
    assert cliente.get(f"/api/boletos/{extra['id']}", headers=h).status_code == 404
    b3 = cliente.post("/api/boletos", headers=h, json={**avulso, "pagador_nome": "Terceiro Pagador"}).json()
    assert b3["nosso_numero"] == nn.montar(103)  # o 102 foi excluído e não volta

    # listagem, busca e resumo
    lista = cliente.get("/api/boletos", headers=h, params={"status": "rascunho"}).json()
    assert lista["total"] == 3
    assert cliente.get("/api/boletos", headers=h, params={"q": "terceiro"}).json()["total"] == 1
    assert cliente.get("/api/boletos", headers=h, params={"q": nn.montar(100)}).json()["itens"][0]["id"] == b1["id"]
    assert cliente.get("/api/boletos", headers=h, params={"convenio_id": conv["id"], "de": VENC.isoformat(), "ate": VENC.isoformat()}).json()["total"] == 3
    res = cliente.get("/api/boletos/resumo", headers=h).json()
    assert res["por_status"]["rascunho"]["qtd"] == 3 and res["aguardando_remessa"] == 3

    # ---------------------------------------------------------------- PDF
    pdf = cliente.get(f"/api/boletos/{b1['id']}/pdf", headers=h)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    texto = " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(pdf.content)).pages)
    for trecho in (b1["linha_digitavel_fmt"], "033-7", "Banco Santander", "1.150,00", f"{VENC:%d/%m/%Y}", "Ficha de Compensação",
                   "Recibo do Pagador", "1234 / 1234567", b1["nosso_numero_fmt"], "Boletoum",
                   "AGUARDANDO REGISTRO NO BANCO", "multa de 2,00%", "juros de 1,00% ao mês", "DS"):
        assert trecho in texto, (trecho, texto)

    # ---------------------------------------------------------------- remessa
    pend = cliente.get("/api/boletos/remessas/pendentes", headers=h, params={"convenio_id": conv["id"]}).json()
    assert (pend["entradas"], pend["instrucoes"], pend["teste"], pend["pendencias"]) == (3, 0, True, [])
    r = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]})
    assert r.status_code == 201, r.text
    rem = r.json()["remessa"]
    assert (rem["sequencial"], rem["qtd_boletos"], rem["ambiente"], Decimal(rem["valor_total"]), r.json()["fora"]) == (1, 3, "teste", Decimal("1700.00"), [])
    arq = cliente.get(f"/api/boletos/remessas/{rem['id']}/arquivo", headers=h)
    assert arq.status_code == 200 and rem["nome_arquivo"] in arq.headers["content-disposition"]
    linhas = arq.content.decode("latin-1").splitlines()
    assert all(len(ln) == 240 for ln in linhas) and arq.content.endswith(b"\r\n")
    assert [ln[13] for ln in linhas if ln[7] == "3"] == ["P", "Q", "R"] * 3  # R: multa de 2% e a descrição
    p = L.SegmentoP.ler(linhas[2])
    assert (f"{p['nosso_numero']:013d}", p["valor"], p["vencimento"], p["id_empresa"]) == (nn.montar(100), Decimal("1150.00"), VENC, b1["id_empresa"] if "id_empresa" in b1 else p["id_empresa"])
    assert L.HeaderArquivo.ler(linhas[0])["inscricao"] == int(emissora["cnpj"])
    b1 = cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()
    assert (b1["status"], b1["remessa_sequencial"], b1["editavel"]) == ("em_remessa", 1, False)
    # depois da remessa: nada de editar nem excluir; e não há o que mandar de novo
    assert cliente.put(f"/api/boletos/{b1['id']}", headers=h, json={"valor": "1.00"}).status_code == 400
    assert cliente.delete(f"/api/boletos/{b1['id']}", headers=h).status_code == 400
    r = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]})
    assert r.status_code == 400 and "Não há boletos" in r.json()["detail"]
    assert len(cliente.get("/api/boletos/remessas", headers=h, params={"convenio_id": conv["id"]}).json()) == 1

    # ---------------------------------------------------------------- retorno: registrado, rejeitado e sem boleto
    id1 = p["id_empresa"]
    detalhes = [
        linha_t(1, "02", nn.montar(100), id1), linha_u(2, "02", ocorrencia=HOJE),
        linha_t(3, "03", nn.montar(101), motivos="4852"), linha_u(4, "03", ocorrencia=HOJE),
        linha_t(5, "02", "", L.SegmentoP.ler(linhas[8])["id_empresa"]), linha_u(6, "02", ocorrencia=HOJE),  # achado pelo ID na empresa
        linha_t(7, "06", nn.montar(999)), linha_u(8, "06", pago=Decimal("10"), ocorrencia=HOJE),  # não é nosso
    ]
    r = _retorno(cliente, h, detalhes, "ret1.ret")
    assert r.status_code == 201, r.text
    ret = r.json()
    assert ret["resumo"]["contagem"] == {"registrados": 2, "rejeitados": 1, "pagos": 0, "baixados": 0, "alterados": 0,
                                         "outras": 0, "orfas": 1, "repetidas": 0}
    assert (ret["qtd_ocorrencias"], ret["qtd_orfas"], ret["convenio_id"]) == (4, 1, conv["id"])
    assert [ln["resultado"] for ln in ret["resumo"]["linhas"]] == ["registrados", "rejeitados", "registrados", "orfas"]
    b1 = cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()
    assert (b1["status"], b1["pode_enviar_ao_cliente"]) == ("registrado", True)
    b2 = cliente.get(f"/api/boletos/{b2['id']}", headers=h).json()
    assert b2["status"] == "rejeitado" and b2["motivos"] == [{"codigo": "48", "descricao": "CEP inválido"}, {"codigo": "52", "descricao": "UF inválida"}]
    assert cliente.get(f"/api/boletos/{b3['id']}", headers=h).json()["status"] == "registrado"
    assert len(cliente.get("/api/boletos/ocorrencias-orfas", headers=h).json()) == 1
    assert "AGUARDANDO" not in " ".join(pg.extract_text() for pg in PdfReader(io.BytesIO(
        cliente.get(f"/api/boletos/{b1['id']}/pdf", headers=h).content)).pages)
    # ---------------------------------------------------------------- e-mail: boleto + fatura (NH) no mesmo envio
    previa = cliente.get(f"/api/boletos/{b1['id']}/email", headers=h).json()
    assert previa["pode_enviar"] and previa["para"] == ["fin@boletoum.com.br"] and nh["codigo"] in previa["assunto"]
    assert [a["tipo"] for a in previa["anexos"]] == ["boleto", "fatura"] and b1["linha_digitavel_fmt"] in previa["corpo"]
    assert "o boleto e a fatura" in previa["corpo"]
    r = cliente.post(f"/api/boletos/{b1['id']}/enviar-email", headers=h, json={})
    assert r.status_code == 200 and "fin@boletoum.com.br" in r.json()["mensagem"], r.text
    import email as _email
    from pathlib import Path as _Path

    from app.core import tenancy as _ten

    ultimo = sorted((_ten.pasta_base() / "outbox").glob("*.eml"))[-1]
    msg = _email.message_from_bytes(_Path(ultimo).read_bytes())
    nomes = [p_.get_filename() for p_ in msg.walk() if p_.get_filename()]
    assert nomes == [f"Boleto - {b1['seu_numero']}.pdf", f"NH - {nh['codigo'][3:]}.pdf"], nomes
    assert msg["To"] == "fin@boletoum.com.br" and "Boleto" in msg["Subject"]
    assert "E-mail enviado" in cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()["ocorrencias"][0]["descricao"]
    # só o boleto, para outro endereço; anexo desconhecido e boleto fora do envio são recusados
    r = cliente.post(f"/api/boletos/{b1['id']}/enviar-email", headers=h, json={"destinatarios": ["Outro@Cliente.com"], "anexos": ["boleto"]})
    assert r.status_code == 200 and "outro@cliente.com" in r.json()["mensagem"]
    assert cliente.post(f"/api/boletos/{b1['id']}/enviar-email", headers=h, json={"anexos": ["xml"]}).status_code == 400
    assert cliente.post(f"/api/boletos/{b1['id']}/enviar-email", headers=h, json={"anexos": ["fatura"]}).status_code == 400
    # rejeitado não vai para o cliente; avulso sem cadastro precisa de e-mail informado
    r = cliente.post(f"/api/boletos/{b2['id']}/enviar-email", headers=h, json={"destinatarios": ["x@y.com"]})
    assert r.status_code == 400 and "rejeitado" in r.json()["detail"]
    r = cliente.post(f"/api/boletos/{b3['id']}/enviar-email", headers=h, json={})
    assert r.status_code == 400 and "não tem e-mail" in r.json()["detail"]
    lote_email = cliente.post("/api/boletos/enviar-emails", headers=h, json={"ids": [b1["id"], b2["id"], b3["id"], 987654]}).json()
    assert lote_email["enviados"] == 1 and len(lote_email["falhas"]) == 3
    # o mesmo arquivo de novo: recusado, nada muda
    r = _retorno(cliente, h, detalhes, "ret1-copia.ret")
    assert r.status_code == 400 and "já foi importado" in r.json()["detail"]
    assert len(cliente.get("/api/boletos/retornos", headers=h).json()) == 1
    assert cliente.get(f"/api/boletos/retornos/{ret['id']}", headers=h).json()["resumo"]["linhas"][1]["motivos"][0]["codigo"] == "48"
    # arquivo que não é retorno
    r = cliente.post("/api/boletos/retornos", headers=h, files={"arquivo": ("x.ret", b"isto nao e cnab\r\n")})
    assert r.status_code == 400

    # ---------------------------------------------------------------- instruções: vencimento (06) e baixa (02)
    novo_venc = VENC + timedelta(days=10)
    r = cliente.post(f"/api/boletos/{b1['id']}/vencimento", headers=h, json={"data": novo_venc.isoformat()})
    assert r.status_code == 200 and (r.json()["instrucao_pendente"], r.json()["novo_vencimento"]) == ("06", novo_venc.isoformat())
    assert cliente.post(f"/api/boletos/{b1['id']}/vencimento", headers=h, json={"data": "2020-01-01"}).status_code == 400
    assert cliente.post(f"/api/boletos/{b3['id']}/baixa", headers=h).json()["instrucao_pendente"] == "02"
    assert cliente.delete(f"/api/boletos/{b3['id']}/instrucao", headers=h).json()["instrucao_pendente"] is None
    assert cliente.delete(f"/api/boletos/{b3['id']}/instrucao", headers=h).status_code == 400
    assert cliente.post(f"/api/boletos/{b3['id']}/baixa", headers=h).json()["instrucao_pendente"] == "02"
    assert cliente.get("/api/boletos/resumo", headers=h).json()["instrucoes_pendentes"] == 2
    r = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]})
    assert r.status_code == 201, r.text
    rem2 = r.json()["remessa"]
    linhas2 = cliente.get(f"/api/boletos/remessas/{rem2['id']}/arquivo", headers=h).content.decode("latin-1").splitlines()
    ps = [L.SegmentoP.ler(ln) for ln in linhas2 if ln[7] == "3" and ln[13] == "P"]
    assert [(x["codigo_movimento"], x["vencimento"]) for x in ps] == [(6, novo_venc), (2, VENC)]
    assert (rem2["sequencial"], L.HeaderArquivo.ler(linhas2[0])["sequencial_arquivo"]) == (2, 2)
    antes = b1["codigo_barras"]
    r = _retorno(cliente, h, [
        L.SegmentoT.montar(**{**L.SegmentoT.ler(linha_t(1, "14", nn.montar(100), id1)), "vencimento": novo_venc}),
        linha_u(2, "14", ocorrencia=HOJE),
        linha_t(3, "09", nn.montar(103)), linha_u(4, "09", ocorrencia=HOJE),
    ], "ret2.ret", convenio_id=conv["id"])
    assert r.status_code == 201, r.text
    assert r.json()["resumo"]["contagem"]["alterados"] == 1 and r.json()["resumo"]["contagem"]["baixados"] == 1
    b1 = cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()
    assert (b1["data_vencimento"], b1["novo_vencimento"], b1["status"]) == (novo_venc.isoformat(), None, "registrado")
    assert b1["codigo_barras"] != antes and b1["codigo_barras"][5:9] == f"{cb.fator_vencimento(novo_venc):04d}"
    assert cliente.get(f"/api/boletos/{b3['id']}", headers=h).json()["status"] == "baixado"

    # ---------------------------------------------------------------- pagamento: baixa a fatura e cai no Financeiro
    pago = [linha_t(1, "06", nn.montar(100), id1, tarifa=Decimal("2.50")),
            linha_u(2, "06", pago=Decimal("1161.50"), liquido=Decimal("1159.00"), ocorrencia=HOJE, credito=HOJE, juros=Decimal("11.50"))]
    r = _retorno(cliente, h, pago, "ret3.ret")
    assert r.status_code == 201, r.text
    linha = r.json()["resumo"]["linhas"][0]
    assert linha["resultado"] == "pagos" and "juros/multa de R$ 11.50" in linha["alerta"]
    b1 = cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()
    assert (b1["status"], b1["valor_pago"], b1["valor_liquido"], b1["tarifa"], b1["data_pagamento"]) == ("pago", "1161.50", "1159.00", "2.50", HOJE.isoformat())
    assert [o["codigo_movimento"] for o in b1["ocorrencias"] if o["origem"] == "retorno"] == ["06", "14", "02"]
    f = cliente.get(f"/api/nfse/faturas/{nh['id']}", headers=h).json()
    assert (f["situacao"], f["pago_em"]) == ("paga", HOJE.isoformat())
    lancs = cliente.get(f"/api/financeiro/contas/{conta['id']}/extrato", headers=h).json()["linhas"]
    assert any(nh["codigo"] in (x.get("descricao") or "") for x in lancs), lancs
    # o banco repete a liquidação em outro arquivo: não duplica nada
    r = _retorno(cliente, h, [*pago, linha_t(3, "28", nn.montar(100), tarifa=Decimal("1.00")), linha_u(4, "28", ocorrencia=HOJE)], "ret4.ret")
    assert r.status_code == 201 and r.json()["resumo"]["contagem"]["repetidas"] == 1
    b1 = cliente.get(f"/api/boletos/{b1['id']}", headers=h).json()
    assert len([o for o in b1["ocorrencias"] if o["codigo_movimento"] == "06" and o["origem"] == "retorno"]) == 1 and b1["tarifa"] == "3.50"
    # boleto pago não aceita mais baixa nem exclusão; e a fatura paga não ganha boleto novo
    assert cliente.post(f"/api/boletos/{b1['id']}/baixa", headers=h).status_code == 400
    assert cliente.delete(f"/api/boletos/{b1['id']}", headers=h).status_code == 400
    r = cliente.post("/api/boletos", headers=h, json=novo)
    assert r.status_code == 400 and "não está em aberto" in r.json()["detail"]
    # rejeitado pode ser excluído
    assert cliente.delete(f"/api/boletos/{b2['id']}", headers=h).status_code == 200

    # ---------------------------------------------------------------- convênio: travas
    r = cliente.put(f"/api/boletos/convenios/{conv['id']}", headers=h, json={**corpo, "proximo_nosso_numero": 5})
    assert r.status_code == 400 and "nunca é reaproveitado" in r.json()["detail"]
    r = cliente.put(f"/api/boletos/convenios/{conv['id']}", headers=h, json={**corpo, "proximo_nosso_numero": 500, "proximo_sequencial_arquivo": 1})
    assert r.status_code == 400
    r = cliente.put(f"/api/boletos/convenios/{conv['id']}", headers=h, json={
        **corpo, "proximo_nosso_numero": 500, "proximo_sequencial_arquivo": 3, "homologado": True, "multa_pct": "0", "codigo_juros": "3"})
    assert r.status_code == 200 and r.json()["homologado"] is True
    assert cliente.delete(f"/api/boletos/convenios/{conv['id']}", headers=h).status_code == 400
    vazio = cliente.post("/api/boletos/convenios", headers=h, json={**corpo, "nome": "Sem uso"}).json()
    assert cliente.delete(f"/api/boletos/convenios/{vazio['id']}", headers=h).status_code == 200
    # homologado: a remessa sai como produção; sem multa nem juros e sem descrição não há Segmento R
    r = cliente.post("/api/boletos", headers=h, json={**avulso, "descricao": ""})
    assert r.json()["nosso_numero"] == nn.montar(500)
    cancelar = cliente.post("/api/boletos", headers=h, json=avulso).json()
    assert cliente.post(f"/api/boletos/{cancelar['id']}/baixa", headers=h).json()["status"] == "cancelado"  # rascunho: cancela direto
    rem3 = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]}).json()["remessa"]
    linhas3 = cliente.get(f"/api/boletos/remessas/{rem3['id']}/arquivo", headers=h).content.decode("latin-1").splitlines()
    assert (rem3["ambiente"], rem3["sequencial"], rem3["qtd_boletos"]) == ("producao", 3, 1)
    assert [ln[13] for ln in linhas3 if ln[7] == "3"] == ["P", "Q"] and L.SegmentoP.ler(linhas3[2])["codigo_juros"] == 3


def test_boletos_em_lote_permissoes_e_barras(cliente):  # noqa: F811
    h = _login(cliente)
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    conv = cliente.post("/api/boletos/convenios", headers=h, json={
        "nome": "Lote", "emissora_id": emissora["id"], "agencia": "4321", "conta": "13009999", "conta_dv": "1",
        "codigo_beneficiario": "7654321", "codigo_transmissao": "432100007654321", "numeracao": "BANCO"}).json()
    cli, _contrato, caso = _base(cliente, h, "Boletodois Cliente", CNPJ_2)
    f1 = _fatura(cliente, h, cli, caso, "500.00", "Parecer")
    # cliente sem endereço: a fatura dele fica de fora, com o motivo
    sem, _contrato2, caso2 = _base(cliente, h, "Boletotres Sem Endereco", CNPJ_3, endereco=False)
    f2 = _fatura(cliente, h, sem, caso2, "90.00", "Consulta")
    r = cliente.post("/api/boletos/lote", headers=h, json={"convenio_id": conv["id"], "fatura_ids": [f1["id"], f2["id"], 987654, f1["id"]]})
    assert r.status_code == 200, r.text
    lote = r.json()
    assert lote["criados"] == 1 and [x["fatura_id"] for x in lote["falhas"]] == [f2["id"], 987654]
    assert any("endereço" in e for e in lote["falhas"][0]["erros"])
    # numeração do banco: sem nosso número, sem código de barras e sem PDF até o retorno
    b = cliente.get(f"/api/boletos/{lote['ids'][0]}", headers=h).json()
    assert (b["nosso_numero"], b["codigo_barras"], b["valor"], b["seu_numero"]) == (None, "", "500.00", f1["codigo"].replace(" ", ""))
    assert cliente.get(f"/api/boletos/{b['id']}/pdf", headers=h).status_code == 400
    rem = cliente.post("/api/boletos/remessas", headers=h, json={"convenio_id": conv["id"]}).json()["remessa"]
    linhas = cliente.get(f"/api/boletos/remessas/{rem['id']}/arquivo", headers=h).content.decode("latin-1").splitlines()
    p = L.SegmentoP.ler(linhas[2])
    assert p["nosso_numero"] == 0
    # o banco numera e devolve no retorno: aí nascem o código de barras e o PDF
    r = cliente.post("/api/boletos/retornos", headers=h, data={"convenio_id": str(conv["id"])}, files={"arquivo": ("r.ret", arquivo_retorno(
        [linha_t(1, "02", nn.montar(777), p["id_empresa"], valor=Decimal("500")), linha_u(2, "02", ocorrencia=HOJE)]))})
    assert r.status_code == 201, r.text
    b = cliente.get(f"/api/boletos/{b['id']}", headers=h).json()
    assert (b["status"], b["nosso_numero"]) == ("registrado", nn.montar(777)) and cb.conferir(b["codigo_barras"])
    assert cliente.get(f"/api/boletos/{b['id']}/pdf", headers=h).status_code == 200

    # perfil só de consulta vê, mas não cria, não gera remessa nem importa retorno
    v = _login(cliente, "visualizador@cfme.com.br")
    assert cliente.get("/api/boletos", headers=v).status_code == 200
    assert cliente.get("/api/boletos/convenios", headers=v).status_code == 200
    assert cliente.post("/api/boletos/remessas", headers=v, json={"convenio_id": conv["id"]}).status_code == 403
    assert cliente.delete(f"/api/boletos/{b['id']}", headers=v).status_code == 403
    assert cliente.post("/api/boletos/convenios", headers=v, json={}).status_code == 403
    assert cliente.get("/api/boletos/987654", headers=h).status_code == 404
    assert cliente.get("/api/boletos/remessas/987654/arquivo", headers=h).status_code == 404
    assert cliente.get("/api/boletos/retornos/987654", headers=h).status_code == 404
    assert cliente.get("/api/boletos/clientes/987654/pagador", headers=h).status_code == 404
    assert cliente.get(f"/api/boletos/clientes/{cli['id']}/pagador", headers=h).json()["pagador_cep"] == "01305000"


def test_codigo_de_barras_itf():
    seq = barcode_itf.elementos("12")
    # início (4 estreitos) + par "1"/"2" + fim (larga, estreito, estreita)
    assert seq[:4] == [(True, 1), (False, 1), (True, 1), (False, 1)] and seq[-3:] == [(True, 3), (False, 1), (True, 1)]
    barras = [w for b, w in seq[4:-3] if b]
    espacos = [w for b, w in seq[4:-3] if not b]
    assert barras == [3, 1, 1, 1, 3] and espacos == [1, 3, 1, 1, 3]  # 1 = 10001 nas barras, 2 = 01001 nos espaços
    # 44 dígitos: 22 pares × 18 módulos + 4 de início + 5 de fim
    assert barcode_itf.largura_em_modulos("0" * 44) == 22 * 18 + 4 + 5
    for ruim in ("123", "12A4"):
        try:
            barcode_itf.elementos(ruim)
        except ValueError:
            continue
        raise AssertionError(ruim)
