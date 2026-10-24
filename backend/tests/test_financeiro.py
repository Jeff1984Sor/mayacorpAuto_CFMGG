"""Fatura por nota, PIX, conciliação do extrato (baixa automática) e relatório de emissão ao cliente."""

import email
import email.policy
from datetime import date
from pathlib import Path

from app.core.config import settings
from app.modules.rpa_nfse import parser_txt
from app.modules.rpa_nfse.pix import _crc16, br_code
from tests.conftest import detalhe
from tests.test_api_fluxo import _login, cliente  # noqa: F401  (fixture)


def _emitir(c, h, numeros: list[int], valor: str) -> dict:
    emissora = c.get("/api/nfse/emissoras", headers=h).json()[0]
    arq = parser_txt.gerar_arquivo("12345678", [detalhe(n, valor=valor) for n in numeros])
    lote = c.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("f.txt", arq)},
                  data={"emissora_id": emissora["id"]}).json()
    assert c.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h).status_code == 200
    return lote


def test_pix_br_code_valido():
    codigo = br_code("financeiro@cfme.com.br", "CFME Sociedade de Advogados", "São Paulo", 1250, "NH202600001")
    assert codigo.startswith("000201") and "br.gov.bcb.pix" in codigo and "54071250.00" in codigo
    assert codigo[-4:] == _crc16(codigo[:-4])


def test_cada_nota_gera_fatura_com_pdf_e_pix(cliente):  # noqa: F811
    h = _login(cliente)
    lote = _emitir(cliente, h, [9101, 9102], "777.70")
    fats = cliente.get("/api/nfse/faturas", headers=h, params={"lote_id": lote["id"]}).json()
    assert fats["total"] == 2
    f = fats["itens"][0]
    assert f["codigo"].startswith("NH ") and f["situacao"] == "aberta" and f["pix_copia_e_cola"]
    assert cliente.get(f"/api/nfse/faturas/{f['id']}/pdf", headers=h).content[:5] == b"%PDF-"
    nota = cliente.get(f"/api/nfse/notas/{f['nfse_id']}", headers=h).json()
    assert nota["fatura_codigo"] == f["codigo"]


def test_extrato_ofx_da_baixa_automatica_com_a_data(cliente):  # noqa: F811
    h = _login(cliente)
    lote = _emitir(cliente, h, [9201, 9202, 9203], "1111.11")
    hoje = date.today()
    # um crédito único que paga o lote inteiro (3 × 1111,11) + um crédito sem par
    ofx = f"""OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>{hoje:%Y%m%d}120000<TRNAMT>3333.33<FITID>LELLO-001<MEMO>TED LELLO CONDOMINIOS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>{hoje:%Y%m%d}<TRNAMT>12.34<FITID>REND-01<MEMO>RENDIMENTO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>{hoje:%Y%m%d}<TRNAMT>-50.00<FITID>TAR-01<MEMO>TARIFA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>""".encode()
    r = cliente.post("/api/nfse/extratos", headers=h, files={"arquivo": ("extrato.ofx", ofx)})
    assert r.status_code == 200, r.text
    ext = r.json()
    assert ext["qtd_creditos"] == 2 and ext["qtd_conciliados"] == 1 and ext["notas_baixadas"] == 3
    lanc = next(lc for lc in ext["lancamentos"] if lc["valor"] == "3333.33")
    assert lanc["status"] == "conciliado" and lanc["confianca"] >= 85 and len(lanc["notas"]) == 3
    notas = cliente.get("/api/nfse/notas", headers=h, params={"lote_id": lote["id"]}).json()["itens"]
    assert all(n["pago_em"] == hoje.isoformat() for n in notas)
    fats = cliente.get("/api/nfse/faturas", headers=h, params={"lote_id": lote["id"]}).json()["itens"]
    assert all(f["situacao"] == "paga" and f["pago_em"] == hoje.isoformat() for f in fats)

    # o mesmo extrato de novo não baixa nada duas vezes
    ext2 = cliente.post("/api/nfse/extratos", headers=h, files={"arquivo": ("extrato.ofx", ofx)}).json()
    assert ext2["qtd_conciliados"] == 0
    assert any(lc["status"] == "duplicado" for lc in ext2["lancamentos"])

    # desfazer volta a nota e a fatura para "em aberto"
    r = cliente.post(f"/api/nfse/extratos/{ext['id']}/lancamentos/{lanc['id']}/desfazer", headers=h)
    assert r.status_code == 200
    fats = cliente.get("/api/nfse/faturas", headers=h, params={"lote_id": lote["id"]}).json()["itens"]
    assert all(f["situacao"] == "aberta" for f in fats)


def test_extrato_csv_sugere_quando_ambiguo_e_confirma(cliente):  # noqa: F811
    h = _login(cliente)
    _emitir(cliente, h, [9301, 9302], "424.24")  # duas notas com o mesmo valor → ambíguo
    csv = f"Data;Histórico;Valor\n{date.today():%d/%m/%Y};PIX RECEBIDO;424,24\n".encode()
    ext = cliente.post("/api/nfse/extratos", headers=h, files={"arquivo": ("extrato.csv", csv)}).json()
    lanc = ext["lancamentos"][0]
    assert lanc["status"] == "sugerido" and lanc["confianca"] < 85
    r = cliente.post(f"/api/nfse/extratos/{ext['id']}/lancamentos/{lanc['id']}/confirmar", headers=h, json={})
    assert r.status_code == 200 and r.json()["status"] == "conciliado"


def test_relatorio_de_emissao_para_o_cliente(cliente):  # noqa: F811
    h = _login(cliente)
    cfg = cliente.get("/api/config/automacoes", headers=h).json()
    cfg.update(relatorio_emissao_ativo=True, relatorio_destinatarios=["financeiro@cfme.com.br"])
    assert cliente.put("/api/config/automacoes", headers=h, json=cfg).status_code == 200
    outbox = Path(settings.storage_dir) / "outbox"
    antes = set(outbox.glob("*.eml")) if outbox.exists() else set()
    _emitir(cliente, h, [9401, 9402], "300.00")
    msgs = [email.message_from_bytes(p.read_bytes(), policy=email.policy.default)
            for p in set(outbox.glob("*.eml")) - antes]
    relatorio = next(m for m in msgs if "emitida" in str(m["Subject"]))
    assert "2 nota(s) emitida(s)" in str(relatorio["Subject"])
    assert relatorio["To"] == "financeiro@cfme.com.br"
    anexos = [a.get_filename() for a in relatorio.iter_attachments()]
    assert any(n.startswith("conferencia_lote_") for n in anexos)


def test_foto_do_usuario(cliente):  # noqa: F811
    h = _login(cliente)
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")
    me = cliente.post("/api/auth/me/foto", headers=h, files={"arquivo": ("eu.png", png)}).json()
    assert me["foto_url"]
    assert cliente.get("/api" + me["foto_url"], headers=h).content[:4] == b"\x89PNG"


def test_trocar_senha(cliente):  # noqa: F811
    h = _login(cliente, "visualizador@cfme.com.br")
    r = cliente.post("/api/auth/trocar-senha", headers=h, json={"senha_atual": "errada", "nova_senha": "Nova@2026x"})
    assert r.status_code == 400
    r = cliente.post("/api/auth/trocar-senha", headers=h, json={"senha_atual": "Cfme@2026", "nova_senha": "Nova@2026x"})
    assert r.status_code == 200
    assert cliente.post("/api/auth/login", json={"email": "visualizador@cfme.com.br", "senha": "Nova@2026x"}).status_code == 200


def test_extrato_combinacao_de_duas_notas_no_meio_do_lote(cliente):  # noqa: F811
    h = _login(cliente)
    valores = ["100.01", "200.02", "300.03", "400.04", "500.05", "600.06", "700.07", "800.08", "900.09",
               "1000.10", "1100.11", "1200.12", "1300.13", "1414.14", "1515.15"]
    emissora = cliente.get("/api/nfse/emissoras", headers=h).json()[0]
    arq = parser_txt.gerar_arquivo("12345678", [detalhe(9500 + i, valor=v) for i, v in enumerate(valores)])
    lote = cliente.post("/api/nfse/importacoes", headers=h, files={"arquivo": ("c.txt", arq)},
                        data={"emissora_id": emissora["id"]}).json()
    cliente.post(f"/api/nfse/importacoes/{lote['id']}/emitir", headers=h)
    # 1414,14 + 1515,15 = 2929,29: as duas últimas notas do lote (fora das 12 primeiras)
    csv = f"Data;Histórico;Valor\n{date.today():%d/%m/%Y};TED LELLO;2929,29\n".encode()
    ext = cliente.post("/api/nfse/extratos", headers=h, files={"arquivo": ("x.csv", csv)}).json()
    lanc = ext["lancamentos"][0]
    assert lanc["status"] == "sugerido", lanc
    assert sorted(n["valor"] for n in lanc["notas"]) == ["1414.14", "1515.15"]


def test_hub_automacoes(cliente):  # noqa: F811
    h = _login(cliente)
    r = cliente.get("/api/hub/automacoes", headers=h)
    assert r.status_code == 200 and r.json()[0]["slug"] == "nfse"
