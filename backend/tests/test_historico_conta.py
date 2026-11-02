"""Conta bancária: importar o histórico com raio-x (quem é cada favorecido, o que falta cadastrar)."""

from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)

OFX = """OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-4500.00<FITID>1<MEMO>PIX ENVIADO LOCADORA PAULISTA ALUGUEL
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260205<TRNAMT>-4500.00<FITID>2<MEMO>PIX ENVIADO LOCADORA PAULISTA ALUGUEL
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305<TRNAMT>-4500.00<FITID>3<MEMO>PIX ENVIADO LOCADORA PAULISTA ALUGUEL
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-3200.00<FITID>4<MEMO>PIX ENVIADO SALARIO MARIANA SOUZA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260210<TRNAMT>-3200.00<FITID>5<MEMO>PIX ENVIADO SALARIO MARIANA SOUZA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260115<TRNAMT>-39.90<FITID>6<MEMO>TARIFA PACOTE SERVICOS
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260120<TRNAMT>12000.00<FITID>7<MEMO>PIX RECEBIDO CONSTRUTORA HORIZONTE LTDA
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"""


def test_historico_com_raio_x(cliente):  # noqa: F811
    h = _login(cliente)
    conta = cliente.post("/api/financeiro/contas", headers=h, json={"nome": "Conta Histórico"}).json()
    r = cliente.post(f"/api/financeiro/contas/{conta['id']}/historico/analisar", headers=h,
                     files={"arquivo": ("extrato.ofx", OFX.encode(), "application/octet-stream")})
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["totais"]["movimentos"] == 7 and a["periodo"] == {"de": "2026-01-05", "ate": "2026-03-05"}
    por_papel = {g["papel"]: g for g in a["grupos"]}
    aluguel = next(g for g in a["grupos"] if "locadora" in g["chave"])
    assert aluguel["papel"] == "fornecedor" and aluguel["recorrente"]["meses"] == 3 and aluguel["categoria"] == "Ocupação"
    assert por_papel["profissional"]["qtd"] == 2 and por_papel["banco"]["categoria"] == "Tarifas bancárias"
    assert por_papel["cliente"]["tipo"] == "credito"
    assert a["resumo"]["fornecedores_novos"] >= 1 and a["resumo"]["profissionais_novos"] == 1

    # o usuário dá nome certo ao profissional e importa
    for g in a["grupos"]:
        if g["papel"] == "profissional":
            g["nome"] = "Mariana Souza"
    r = cliente.post(f"/api/financeiro/contas/{conta['id']}/historico/importar", headers=h,
                     json={"grupos": a["grupos"], "linhas": a["linhas"]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["lancados"] == 7 and "Mariana Souza" in res["criados"]["profissionais"]
    assert res["saldo_calculado"] == str(12000 - 4500 * 3 - 3200 * 2 - 39.9 + 0).replace("-7939.9", "-7939.90")
    usuarios = {u["nome"]: u for u in cliente.get("/api/config/usuarios", headers=h).json()}
    assert usuarios["Mariana Souza"]["acesso_sistema"] is False

    # de novo: tudo já está na conta
    a2 = cliente.post(f"/api/financeiro/contas/{conta['id']}/historico/analisar", headers=h,
                      files={"arquivo": ("extrato.ofx", OFX.encode(), "application/octet-stream")}).json()
    assert a2["totais"]["ja_lancados"] == 7
    assert next(g for g in a2["grupos"] if g["papel"] == "profissional")["existente_id"] == usuarios["Mariana Souza"]["id"]
