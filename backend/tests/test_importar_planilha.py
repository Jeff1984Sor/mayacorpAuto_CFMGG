"""Assistente: planilha anexada em qualquer tela → prévia → cadastro em lote (pelos caminhos normais do sistema)."""

import io
import json

from openpyxl import Workbook

from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


def _xlsx(linhas: list[list]) -> bytes:
    wb = Workbook()
    for r in linhas:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_planilha_de_profissionais_pela_tela(cliente):  # noqa: F811
    h = _login(cliente)
    arq = _xlsx([["Lista da equipe"], [], ["Nome completo", "E-mail", "Função", "OAB", "Usa o sistema?"],
                 ["Ana Prado", "ana.prado@escritorio.com.br", "Advogada Sênior", "SP 123456", "Não"],
                 ["Bruno Lima", "bruno@escritorio.com.br", "Estagiário", "", "nao"],
                 ["Sem email", "", "Estagiário", "", ""]])
    r = cliente.post("/api/ia/assistente/planilha", headers=h, data={"tela": "/configuracoes/usuarios", "pedido": ""},
                     files={"arquivo": ("equipe.xlsx", arq, "application/octet-stream")})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["alvo"] == "profissionais" and p["total"] == 3 and p["validas"] == 2
    assert p["mapeamento"]["nome"] == 0 and p["mapeamento"]["email"] == 1 and p["mapeamento"]["cargo"] == 2
    assert p["linhas"][2]["erros"] == ["falta E-mail"]
    r = cliente.post("/api/ia/assistente/planilha/importar", headers=h,
                     data={"alvo": p["alvo"], "mapeamento": json.dumps(p["mapeamento"])},
                     files={"arquivo": ("equipe.xlsx", arq, "application/octet-stream")})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["criados"] == 2 and res["com_erro"] == 1, res
    nomes = {u["nome"]: u for u in cliente.get("/api/config/usuarios", headers=h).json()}
    assert "Ana Prado" in nomes and nomes["Ana Prado"]["acesso_sistema"] is False
    cargos = {c["nome"] for c in cliente.get("/api/config/cargos", headers=h).json()}
    assert {"Advogada Sênior", "Estagiário"} <= cargos  # cargo novo entra sozinho
    # de novo: e-mail repetido vira erro da linha, sem derrubar o resto
    res = cliente.post("/api/ia/assistente/planilha/importar", headers=h,
                       data={"alvo": "profissionais", "mapeamento": json.dumps(p["mapeamento"])},
                       files={"arquivo": ("equipe.xlsx", arq, "application/octet-stream")}).json()
    assert res["criados"] == 0 and res["com_erro"] == 3


def test_planilha_csv_de_clientes_e_horas_pelo_pedido(cliente):  # noqa: F811
    h = _login(cliente)
    csv = "Razão social;CNPJ;E-mail\nPlanilha Alfa Ltda;73.615.294/0001-30;fin@alfa.com.br\n".encode("cp1252")
    r = cliente.post("/api/ia/assistente/planilha", headers=h, data={"tela": "/", "pedido": "cadastre esses clientes"},
                     files={"arquivo": ("clientes.csv", csv, "text/csv")})
    p = r.json()
    assert p["alvo"] == "clientes" and p["validas"] == 1, p
    res = cliente.post("/api/ia/assistente/planilha/importar", headers=h,
                       data={"alvo": "clientes", "mapeamento": json.dumps(p["mapeamento"])},
                       files={"arquivo": ("clientes.csv", csv, "text/csv")}).json()
    assert res["criados"] == 1, res
    # horas: caso pelo título, 1:30 vira 90 minutos; caso inexistente dá erro na linha
    tom = cliente.get("/api/nfse/tomadores", headers=h, params={"q": "Planilha Alfa"}).json()["itens"][0]
    ct = cliente.post("/api/faturamento/contratos", headers=h, json={"tomador_id": tom["id"], "nome": "Consultivo Alfa"}).json()
    cliente.post(f"/api/faturamento/contratos/{ct['id']}/casos", headers=h, json={"titulo": "Revisão contratual Alfa"})
    arq = _xlsx([["Caso", "Data", "Horas", "Atividade"], ["Revisão contratual Alfa", "03/11/2026", "1:30", "Reunião"],
                 ["Caso que não existe", "03/11/2026", "2", "Pesquisa"]])
    p = cliente.post("/api/ia/assistente/planilha", headers=h, data={"tela": "/faturamento/timesheet", "pedido": ""},
                     files={"arquivo": ("horas.xlsx", arq, "application/octet-stream")}).json()
    assert p["alvo"] == "horas" and p["linhas"][0]["valores"]["minutos"] == 90, p
    res = cliente.post("/api/ia/assistente/planilha/importar", headers=h,
                       data={"alvo": "horas", "mapeamento": json.dumps(p["mapeamento"])},
                       files={"arquivo": ("horas.xlsx", arq, "application/octet-stream")}).json()
    assert res["criados"] == 1 and "não encontrado" in res["erros"][0]["erro"], res
