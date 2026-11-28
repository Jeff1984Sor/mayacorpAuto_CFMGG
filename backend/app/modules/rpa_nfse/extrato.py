"""Leitura de extrato bancário: OFX (padrão de todos os bancos), CSV e Excel.

`ler` devolve só os créditos (NFS-e › Recebimentos: os pagamentos que a Lello fez à CFME).
`ler_movimentos` devolve tudo, créditos e débitos, e o saldo final quando o arquivo traz (Financeiro › Conciliação).
Os dois usam a mesma leitura e a mesma chave por linha: um crédito tem a mesma identidade nas duas telas.
"""

import csv
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from openpyxl import load_workbook

from app.modules.rpa_nfse.parser_txt import decodificar


class ExtratoInvalido(ValueError):
    pass


@dataclass
class Credito:
    data: date
    valor: Decimal
    descricao: str
    documento: str | None
    chave: str


@dataclass
class ExtratoLido:
    formato: str
    banco: str | None
    creditos: list[Credito]
    debitos_ignorados: int


@dataclass
class Movimento:
    """Linha do extrato com o sentido: `valor` é sempre positivo."""

    data: date
    tipo: str  # credito | debito
    valor: Decimal
    descricao: str
    documento: str | None
    chave: str


@dataclass
class ExtratoCompleto:
    formato: str
    banco: str | None
    movimentos: list[Movimento]
    saldo_final: Decimal | None = None  # só quando o arquivo traz
    data_saldo: date | None = None


@dataclass
class _Bruto:
    """O que a leitura do arquivo devolve antes de separar créditos e débitos (valor com sinal)."""

    formato: str
    banco: str | None
    linhas: list[tuple[date, Decimal, str, str | None, str | None]]  # data, valor, descrição, documento, FITID
    saldo_final: Decimal | None = None
    data_saldo: date | None = None


def _norm(txt: str) -> str:
    return unicodedata.normalize("NFKD", txt or "").encode("ascii", "ignore").decode().lower().strip()


def _chave(data: date, valor: Decimal, descricao: str, doc: str | None) -> str:
    base = f"{data.isoformat()}|{valor}|{_norm(descricao)}|{doc or ''}"
    return "h:" + hashlib.sha1(base.encode()).hexdigest()[:32]  # noqa: S324 (identidade, não segurança)


def _valor_br(txt) -> Decimal | None:
    if txt is None or txt == "":
        return None
    if isinstance(txt, int | float | Decimal):
        return Decimal(str(txt)).quantize(Decimal("0.01"))
    s = str(txt).strip().replace("R$", "").replace(" ", "")
    negativo = s.endswith("-") or s.startswith("-") or (s.startswith("(") and s.endswith(")")) or s.upper().endswith("D")
    s = s.strip("-()").rstrip("CDcd")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        v = Decimal(s).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    return -v if negativo else v


def _data(txt) -> date | None:
    if isinstance(txt, datetime):
        return txt.date()
    if isinstance(txt, date):
        return txt
    s = str(txt or "").strip()[:10]
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%Y", "%Y%m%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------- OFX
def _ler_ofx(texto: str) -> _Bruto:
    banco = None
    if m := re.search(r"<ORG>([^<\r\n]+)", texto):
        banco = m.group(1).strip()
    linhas = []
    for bloco in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|(?=</BANKTRANLIST>))", texto, re.S | re.I):
        def tag(nome: str, bloco: str = bloco) -> str | None:
            m = re.search(rf"<{nome}>([^<\r\n]*)", bloco, re.I)
            return m.group(1).strip() if m else None

        valor = _valor_br((tag("TRNAMT") or "").replace(",", "."))
        quando = _data((tag("DTPOSTED") or "")[:8])
        if valor is None or quando is None:
            continue
        descricao = " ".join(filter(None, [tag("NAME"), tag("MEMO")]))
        linhas.append((quando, valor, descricao, tag("CHECKNUM") or tag("REFNUM"), tag("FITID")))
    saldo = data_saldo = None
    if m := re.search(r"<LEDGERBAL>(.*?)(?:</LEDGERBAL>|<AVAILBAL>|</STMTRS>|\Z)", texto, re.S | re.I):
        if v := re.search(r"<BALAMT>([^<\r\n]*)", m.group(1), re.I):
            saldo = _valor_br(v.group(1).strip().replace(",", "."))
        if saldo is not None and (d := re.search(r"<DTASOF>([^<\r\n]*)", m.group(1), re.I)):
            data_saldo = _data(d.group(1).strip()[:8])
    return _Bruto("ofx", banco, linhas, saldo, data_saldo)


# ---------------------------------------------------------------- CSV / Excel
COLUNAS = {
    "data": ("data", "dt", "data lancamento", "data do lancamento", "data mov", "data movimento"),
    "descricao": ("descricao", "historico", "lancamento", "memo", "detalhe", "descricao do lancamento"),
    "valor": ("valor", "valor (r$)", "valor r$", "montante"),
    "credito": ("credito", "entrada", "credito (r$)"),
    "debito": ("debito", "saida", "debito (r$)"),
    "documento": ("documento", "doc", "n documento", "numero documento", "num doc"),
    "saldo": ("saldo",),
}


def _mapear(cabecalho: list) -> dict[str, int]:
    norm = [_norm(str(c or "")) for c in cabecalho]
    mapa = {}
    for campo, nomes in COLUNAS.items():
        for i, c in enumerate(norm):
            if c in nomes or any(c.startswith(n) for n in nomes):
                mapa.setdefault(campo, i)
    return mapa


def _ler_tabela(linhas: list[list], formato: str) -> _Bruto:
    inicio, mapa = None, {}
    for i, ln in enumerate(linhas[:30]):  # bancos colocam algumas linhas de título antes do cabeçalho
        m = _mapear(ln)
        if "data" in m and ("valor" in m or "credito" in m):
            inicio, mapa = i, m
            break
    if inicio is None:
        raise ExtratoInvalido("Não encontrei as colunas de data e valor. O extrato precisa ter cabeçalho (Data, Histórico, Valor).")
    saida, saldos = [], []
    for ln in linhas[inicio + 1:]:
        def col(campo, ln=ln):
            i = mapa.get(campo)
            return ln[i] if i is not None and i < len(ln) else None

        quando = _data(col("data"))
        if not quando:
            continue
        if "saldo" in mapa and (saldo_linha := _valor_br(col("saldo"))) is not None:
            saldos.append((quando, saldo_linha))
        if "credito" in mapa:  # colunas separadas de entrada e saída
            valor = _valor_br(col("credito"))
            if not valor and "debito" in mapa and (saiu := _valor_br(col("debito"))):
                valor = -abs(saiu)
        else:
            valor = _valor_br(col("valor"))
        if not valor:
            continue
        desc = str(col("descricao") or "").strip()
        doc = str(col("documento") or "").strip() or None
        saida.append((quando, valor, desc, doc, None))
    saldo = data_saldo = None
    if saldos:  # o saldo da linha mais recente (o arquivo pode vir do mais novo para o mais antigo)
        data_saldo, saldo = saldos[-1] if saldos[-1][0] >= saldos[0][0] else saldos[0]
    return _Bruto(formato, None, saida, saldo, data_saldo)


def _bruto(nome: str, conteudo: bytes) -> _Bruto:
    ext = nome.lower().rsplit(".", 1)[-1] if "." in nome else ""
    if ext in ("xlsx", "xlsm"):
        ws = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True).active
        return _ler_tabela([list(r) for r in ws.iter_rows(values_only=True)], "xlsx")
    texto, _ = decodificar(conteudo)
    if ext == "ofx" or "<OFX>" in texto.upper() or "OFXHEADER" in texto.upper():
        return _ler_ofx(texto)
    if ext in ("csv", "txt"):
        sep = ";" if texto.count(";") >= texto.count(",") else ","
        return _ler_tabela(list(csv.reader(io.StringIO(texto), delimiter=sep)), "csv")
    raise ExtratoInvalido("Envie o extrato em OFX (recomendado), CSV ou Excel.")


def _chave_da_linha(formato: str, quando: date, valor: Decimal, desc: str, doc: str | None, fitid: str | None) -> str:
    if fitid:
        return f"ofx:{fitid}"
    return _chave(quando, valor, desc, None if formato == "ofx" else doc)


def ler(nome: str, conteudo: bytes) -> ExtratoLido:
    """Só os créditos (NFS-e › Recebimentos)."""
    bruto = _bruto(nome, conteudo)
    creditos = [Credito(quando, valor, desc, doc, _chave_da_linha(bruto.formato, quando, valor, desc, doc, fitid))
                for quando, valor, desc, doc, fitid in bruto.linhas if valor > 0]
    if not creditos:
        raise ExtratoInvalido("Nenhum crédito encontrado no extrato.")
    # o mesmo crédito repetido no arquivo (FITIDs iguais) conta uma vez
    vistos, unicos = set(), []
    for c in creditos:
        if c.chave not in vistos:
            vistos.add(c.chave)
            unicos.append(c)
    return ExtratoLido(bruto.formato, bruto.banco, sorted(unicos, key=lambda c: c.data),
                       sum(1 for ln in bruto.linhas if ln[1] < 0))


def ler_movimentos(nome: str, conteudo: bytes) -> ExtratoCompleto:
    """Créditos e débitos, cada linha com uma chave estável (a mesma de `ler` para os créditos).

    Sem FITID, duas linhas iguais no mesmo dia (duas tarifas de mesmo valor) são movimentos diferentes: a segunda
    ganha "#2" na chave. Com FITID repetido é a mesma linha e conta uma vez.
    """
    bruto = _bruto(nome, conteudo)
    movimentos, vistos = [], {}
    for quando, valor, desc, doc, fitid in bruto.linhas:
        if not valor:
            continue
        chave = _chave_da_linha(bruto.formato, quando, valor, desc, doc, fitid)
        vistos[chave] = vistos.get(chave, 0) + 1
        if vistos[chave] > 1:
            if fitid:
                continue
            chave = f"{chave}#{vistos[chave]}"
        movimentos.append(Movimento(quando, "credito" if valor > 0 else "debito", abs(valor), desc, doc, chave))
    if not movimentos:
        raise ExtratoInvalido("Nenhum lançamento encontrado no extrato.")
    movimentos.sort(key=lambda m: m.data)
    return ExtratoCompleto(bruto.formato, bruto.banco, movimentos, bruto.saldo_final, bruto.data_saldo)
