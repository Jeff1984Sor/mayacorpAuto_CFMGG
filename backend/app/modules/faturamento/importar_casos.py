"""Importar casos de um cliente por planilha (Cadastros › Clientes › aba Casos › Importar planilha).

Fluxo sem estado no servidor (o navegador guarda as linhas):
  1. ler      — lê a planilha e sugere qual coluna é qual (chave, contrato, texto, valor, vencimento...)
  2. analisar — para cada linha: o caso já existe (pela chave, ex.: nº do sinistro)? qual contrato? a regra de
                cobrança é nova ou igual a uma que já existe (mesmo valor e vencimento → pula)?
  3. aplicar  — grava em lotes pequenos (a tela mostra o progresso); confere tudo de novo, então repetir não duplica.
Contrato que não existe é criado (marcado como criado pela importação).
"""

import io
import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from openpyxl import load_workbook
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.core.deps import Operador
from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento import service, titulo_caso
from app.modules.faturamento.models import CampoAdicional, Caso, Contrato, RegraCobranca, TipoRegra
from app.modules.financas.planilhas import ler_data, ler_valor
from app.modules.rpa_nfse.models import Tomador

router = APIRouter(prefix="/faturamento/clientes/{tid}/importar-casos", tags=["Faturamento · Importar casos"])

PAPEIS = ("chave", "contrato", "descricao", "valor", "vencimento", "titulo", "processo", "parte_contraria", "situacao")
# palavras que denunciam cada coluna (sem acento, minúsculas)
PISTAS = {
    "situacao": ("status da regra", "situacao da regra", "status", "situacao"),
    "chave": ("sinistro", "aviso", "chave", "referencia", "ref", "codigo", "protocolo", "apolice"),
    "contrato": ("contrato", "carteira", "produto", "ramo"),
    "descricao": ("descricao", "historico", "servico", "texto", "observacao", "honorario", "objeto", "detalhe"),
    "valor": ("valor", "honorario", "total", "preco", "r$"),
    "vencimento": ("vencimento", "venc", "data pagamento", "pagamento", "data"),
    "titulo": ("titulo", "assunto"),
    "processo": ("processo", "cnj", "autos"),
    "parte_contraria": ("parte contraria", "contraparte", "segurado", "terceiro", "reu", "autor", "adverso"),
}
MAX_LINHAS = 20000


def _norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def _chave(v) -> str:
    """Chave comparável: só letras e números, sem zeros à esquerda ("0012-3" = "123")."""
    s = re.sub(r"[^0-9a-z]", "", _norm(v))
    return s.lstrip("0") or s


_CNJ = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
_NUM_CHAVE = re.compile(r"(?<![\d])\d{5,}(?:\s*[/-]\s*\d{2,4})?(?![\d])")


def _extrair_chave(texto: str) -> str:
    """"Fulano X Beltrano - 1042599/2026 - GRANDE MONTA" → "1042599/2026". Texto que já é só a chave fica igual."""
    t = (texto or "").strip()
    if not re.search(r"[a-zA-Z]{3,}", t):
        return t
    m = _NUM_CHAVE.search(t)
    return re.sub(r"\s+", "", m.group(0)) if m else t


_PREFIXO_NUMERO = re.compile(r"^(?:n[°ºo.]*|numero|número|nro\.?)\s+(?:d[oae]\s+)?", re.I)


def extrair_rotulados(texto: str, campos: list) -> dict[int, str]:
    """Lê do texto os campos do cliente escritos como "Rótulo: valor", mesmo colados uns nos outros.

    "Sinistro: 1038248/2026ref.: 39067-1Contrato:55095Autor: Fulano" com os campos Sinistro e Ref
    → {Sinistro: "1038248/2026", Ref: "39067-1"}. Só valores com cara de número/código (dígitos . / -).
    O rótulo pode vir com dois-pontos, ponto ou os dois: "ref.: 39067-1", "Ref. 39067-1", "Ref: 39067-1".
    """
    achados: dict[int, str] = {}
    for c in campos:
        nomes = {c.nome.strip(), _PREFIXO_NUMERO.sub("", c.nome.strip())}
        for nome in sorted((n for n in nomes if len(n) >= 2), key=len, reverse=True):
            # rótulo curto ("Ref") não pode ser o fim de outra palavra; o longo pode vir colado ("LelloSinistro:")
            m = re.search(("(?<![a-zà-ÿ])" if len(nome) < 4 else "") + re.escape(nome) + r"\s*(?:\.\s*:?|:)\s*(\d[\d./-]*)", texto or "", re.I)
            if m:
                achados[c.id] = m.group(1).rstrip("./-")
                break
    return achados


def _campos_do_cliente(ctx, tid: int) -> list:
    return list(ctx.db.scalars(select(CampoAdicional).where(
        CampoAdicional.tenant_id == ctx.tenant_id, CampoAdicional.entidade == "caso", CampoAdicional.ativo,
        CampoAdicional.tomador_id == tid).order_by(CampoAdicional.ordem)))


_SEP_PARTES = re.compile(r"\s+[xX]\s+|(?<=[a-zà-ÿ])X\s+")
_SINISTRO = re.compile(
    r"(?:sinistro\s*(?:n[ºo°.]*\s*)?)?(?<![\d.])(\d{3,7}\s*[/-]\s*\d{2,4}|\d{2}\s*/\s*\d{4})(?![\d.])", re.I)


def decompor_titulo(titulo: str) -> dict[str, str]:
    """"Ativo X Passivo - 1012416/2023 - GRANDE MONTA - 1002963-89.2022.8.26.0002" →
    ativo, passivo, número (sinistro), processo (CNJ) e o que sobrar (extra)."""
    t = re.sub(r"\s+", " ", (titulo or "").replace("\u2013", "-").replace("\u2014", "-")).strip()
    processo = ""
    if m := _CNJ.search(t):
        processo = m.group(0)
        t = (t[:m.start()] + t[m.end():]).strip()
    partes = _SEP_PARTES.split(t, maxsplit=1)
    ativo, resto = (partes[0], partes[1]) if len(partes) == 2 else ("", t)
    numero, extra = "", ""
    if m := _SINISTRO.search(resto):
        numero = re.sub(r"\s+", "", m.group(1))
        antes, extra = resto[:m.start()], resto[m.end():]
    else:
        antes, _, extra = resto.partition(" - ")
        if ativo and (m := _SINISTRO.search(ativo)):  # nº no começo: "1020173/2022 - Fulano X Beltrano"
            numero = re.sub(r"\s+", "", m.group(1))
            ativo = (ativo[:m.start()] + ativo[m.end():]).strip(" -")
    limpa = " -–xX:"
    antes = re.sub(r"\bsinistro\b\s*$", "", antes.strip(), flags=re.I).strip(limpa + " ")
    if not ativo:  # sem "X": não dá para separar as partes; o texto todo fica no ativo
        ativo, antes = antes, ""
    extra = re.sub(r"\s+", " ", extra).strip(" -–()").strip()
    return {"ativo": ativo.strip(limpa + " "), "passivo": antes.strip(), "numero": numero, "processo": processo,
            "extra": extra}


def _chave_partes(ativo, passivo, numero) -> str:
    return "|".join(_chave(x or "") for x in (ativo, passivo, numero))


def _data(v) -> date | None:
    """Data em texto, data de verdade ou número de série do Excel (44201 = 05/01/2021)."""
    if isinstance(v, int | float) and not isinstance(v, bool) and 20000 <= v <= 80000:
        from datetime import timedelta

        return date(1899, 12, 30) + timedelta(days=int(v))
    return ler_data(v)


def _eh_total(linha: list) -> bool:
    return any(isinstance(c, str) and _norm(c) in ("total", "subtotal", "total geral", "soma") for c in linha)


def normalizar(linhas: list[list], numeros: list[int], m: "Mapa") -> tuple[list[list], list[int]]:
    """Relatório agrupado → uma linha por cobrança: tira as linhas de total e repete o caso (e o contrato,
    título...) nas linhas de baixo do mesmo grupo, que só trazem o valor."""
    herdar = [i for i in (m.chave, m.titulo, m.contrato, m.processo, m.parte_contraria) if i is not None]
    out, nums, anterior = [], [], None
    for linha, n in zip(linhas, numeros, strict=False):
        if _eh_total(linha):
            continue
        tem_chave = _pega(linha, m.chave) not in (None, "")
        tem_valor = m.valor is not None and ler_valor(_pega(linha, m.valor)) is not None
        if not tem_chave and not tem_valor:
            continue  # cabeçalho repetido, linha de título do relatório...
        linha = list(linha)
        # só é continuação de grupo quando tudo à esquerda do caso também está vazio (relatório agrupado);
        # linha completa sem o caso (ex.: base com caso sem título) não herda o caso de cima
        continuacao = all(c in (None, "") for c in linha[: m.chave])
        if not tem_chave and not continuacao:
            anterior = None
            out.append(linha)
            nums.append(n)
            continue
        if not tem_chave and anterior is not None:
            for i in herdar:
                if _pega(linha, i) in (None, ""):
                    linha += [None] * (i + 1 - len(linha))
                    linha[i] = _pega(anterior, i)
        anterior = linha
        out.append(linha)
        nums.append(n)
    return out, nums


def _celula(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str):
        return v.strip()
    return v


def _ler_xml_2003(conteudo: bytes) -> list[list]:
    """"Planilha XML 2003" (Excel): muitos sistemas exportam assim com extensão .xls."""
    from lxml import etree

    try:
        conteudo.decode("utf-8")
    except UnicodeDecodeError:  # arquivo em Windows-1252 sem dizer no cabeçalho: os acentos viram lixo
        texto = re.sub(r"^<\?xml[^>]*\?>", "", conteudo.decode("cp1252"), count=1)
        conteudo = texto.encode("utf-8")
    try:
        raiz = etree.fromstring(conteudo, etree.XMLParser(resolve_entities=False, no_network=True))
    except etree.XMLSyntaxError as e:
        raise HTTPException(400, "Não consegui ler a planilha (XML inválido). Salve como .xlsx e tente de novo.") from e
    ss = "{urn:schemas-microsoft-com:office:spreadsheet}"
    melhor: list[list] = []
    for ws in raiz.iter(f"{ss}Worksheet"):
        if _norm(ws.get(f"{ss}Name")).startswith(("instruc", "como preencher", "leia")):
            continue
        linhas = []
        for row in ws.iter(f"{ss}Row"):
            linha: list = []
            for cel in row.findall(f"{ss}Cell"):
                if cel.get(f"{ss}Index"):
                    linha += [None] * (int(cel.get(f"{ss}Index")) - 1 - len(linha))
                d = cel.find(f"{ss}Data")
                v = d.text if d is not None else None
                tipo = d.get(f"{ss}Type") if d is not None else None
                if v is not None and tipo == "Number":
                    try:
                        v = float(v)
                    except ValueError:
                        pass
                elif v is not None and tipo == "DateTime":
                    v = v[:10]
                linha.append(v)
            if any(c not in (None, "") for c in linha):
                linhas.append(linha)
        if len(linhas) > len(melhor):
            melhor = linhas
    return melhor


def _ler_xls_binario(conteudo: bytes) -> list[list]:
    """.xls do Excel 97-2003 (formato binário), comum em exportações de sistemas antigos."""
    import xlrd

    try:
        wb = xlrd.open_workbook(file_contents=conteudo)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "Não consegui abrir o .xls. Abra no Excel e use Salvar como › .xlsx.") from e
    melhor: list[list] = []
    for sh in wb.sheets():
        if _norm(sh.name).startswith(("instruc", "como preencher", "leia")):
            continue
        linhas = []
        for r in range(sh.nrows):
            linha = []
            for c in sh.row(r):
                if c.ctype == xlrd.XL_CELL_DATE:
                    try:
                        linha.append(xlrd.xldate_as_datetime(c.value, wb.datemode))
                    except (ValueError, OverflowError):
                        linha.append(c.value)
                elif c.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    linha.append(None)
                else:
                    linha.append(c.value)
            if any(v not in (None, "") for v in linha):
                linhas.append(linha)
        if len(linhas) > len(melhor):
            melhor = linhas
    return melhor


def _ler_arquivo(conteudo: bytes, nome: str) -> list[list]:
    nome = nome.lower()
    inicio = conteudo[:200].lstrip(b"\xef\xbb\xbf \r\n\t")
    if inicio.startswith((b"<?xml", b"<Workbook")):
        return _ler_xml_2003(conteudo)
    if conteudo[:4] == b"\xd0\xcf\x11\xe0":
        return _ler_xls_binario(conteudo)
    if nome.endswith(".csv"):
        import csv

        texto = None
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                texto = conteudo.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        sep = ";" if (texto or "").count(";") > (texto or "").count(",") else ","
        return [list(r) for r in csv.reader(io.StringIO(texto or ""), delimiter=sep)]
    if not nome.endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Envie a planilha em .xlsx, .xls (XML) ou .csv.")
    melhor: list[list] = []
    # o modo rápido (read_only) confia no tamanho que o arquivo declara; relatórios exportados por outros
    # sistemas às vezes declaram errado (só "A1") e a planilha parece vazia: aí lê do jeito completo
    for rapido in (True, False):
        try:
            wb = load_workbook(io.BytesIO(conteudo), read_only=rapido, data_only=True)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "Não consegui abrir a planilha. Salve como .xlsx e tente de novo.") from e
        # a aba com mais linhas preenchidas costuma ser a de dados
        for ws in wb.worksheets:
            if _norm(ws.title).startswith(("instruc", "como preencher", "leia")):
                continue  # aba de instruções da planilha modelo
            linhas = [list(r) for r in ws.iter_rows(values_only=True) if any(c not in (None, "") for c in r)]
            if len(linhas) > len(melhor):
                melhor = linhas
        if len(melhor) > 2 or len(conteudo) > 20_000_000:
            break
    return melhor


def _linha_cabecalho(linhas: list[list]) -> int:
    """Primeira linha que parece cabeçalho (vários textos) entre as 10 primeiras."""
    for i, r in enumerate(linhas[:10]):
        textos = [c for c in r if isinstance(c, str) and c.strip() and not re.fullmatch(r"[\d.,/\- ]+", c)]
        if len(textos) >= 2:
            return i
    return 0


def _sugerir(colunas: list[str], linhas: list[list], campo_chave: str | None) -> dict[str, int | None]:
    sug: dict[str, int | None] = dict.fromkeys(PAPEIS)
    usados: set[int] = set()
    nomes = [_norm(c) for c in colunas]
    pistas = dict(PISTAS)
    if campo_chave:  # o nome do campo do cliente (ex.: "Nº do sinistro") é a melhor pista da chave
        pistas["chave"] = (_norm(campo_chave).replace("n ", "").replace("no ", ""), *PISTAS["chave"])
    for papel in ("chave", "valor", "vencimento", "situacao", "processo", "parte_contraria", "contrato", "titulo",
                  "descricao"):
        for pista in pistas[papel]:
            achou = None
            if papel == "contrato":  # entre as colunas de contrato, a do nome/título vence a do código
                achou = next((i for i, n in enumerate(nomes) if i not in usados and pista in n
                              and any(x in n for x in ("titulo", "nome", "descricao"))), None)
            if achou is None:
                achou = next((i for i, n in enumerate(nomes) if i not in usados and pista and pista in n), None)
            if achou is not None:
                sug[papel] = achou
                usados.add(achou)
                break
    def amostra(i):
        return [r[i] for r in linhas[:60] if i < len(r) and r[i] not in (None, "") and not _eh_total(r)]

    def numerica(i):
        vals = amostra(i)
        return bool(vals) and sum(isinstance(v, float | int) and not isinstance(v, bool) for v in vals) >= 0.7 * len(vals)

    def datas(i):
        vals = amostra(i)
        return bool(vals) and sum(_data(v) is not None for v in vals) >= 0.8 * len(vals)

    # o nome enganou (ex.: coluna "Total" com textos): descarta
    for papel, ok in (("valor", numerica), ("vencimento", datas)):
        if sug[papel] is not None and not ok(sug[papel]):
            usados.discard(sug[papel])
            sug[papel] = None
    def cnj(i):
        vals = [str(v) for v in amostra(i)]
        return bool(vals) and sum(bool(_CNJ.search(v)) for v in vals) >= 0.7 * len(vals)

    if sug["processo"] is None:
        sug["processo"] = next((i for i in range(len(colunas)) if i not in usados and cnj(i)), None)
        if sug["processo"] is not None:
            usados.add(sug["processo"])
    # chave: coluna cujos textos trazem um número longo (ex.: "Fulano X Beltrano - 1042599/2026")
    if sug["chave"] is None or not any(_NUM_CHAVE.search(str(v)) for v in amostra(sug["chave"])):
        melhor = None
        for i in range(len(colunas)):
            vals = [str(v) for v in amostra(i)]
            if i == sug["processo"] or cnj(i):
                continue
            if vals and sum(bool(_NUM_CHAVE.search(v)) for v in vals) >= 0.7 * len(vals):
                comp = sum(map(len, vals)) / len(vals)
                if melhor is None or comp > melhor[0]:
                    melhor = (comp, i)
        if melhor:
            if sug["chave"] is not None:
                usados.discard(sug["chave"])
            sug["chave"] = melhor[1]
            usados.add(melhor[1])
            # o texto completo do caso também serve de título
            if sug["titulo"] is None and any(re.search(r"[a-zA-Z]{3,}", str(v)) for v in amostra(melhor[1])):
                sug["titulo"] = melhor[1]
    # coluna que traz o próprio rótulo do campo-chave ("Sinistro: 1038248/2026ref.: ...") vence qualquer outra
    if campo_chave:
        class _C:
            id, nome = 0, campo_chave

        for i in range(len(colunas)):
            vals = [str(v) for v in amostra(i)]
            if vals and sum(bool(extrair_rotulados(v, [_C])) for v in vals) >= 0.5 * len(vals):
                if sug["chave"] is not None:
                    usados.discard(sug["chave"])
                sug["chave"] = i
                usados.add(i)
                if sug["titulo"] == i:  # não serve de título: o título sai dos campos (modelo do cliente)
                    sug["titulo"] = None
                # a própria coluna é o texto da cobrança, inteira (ex.: "Observação" com sinistro, ref, autor, acordo…)
                if sug["descricao"] is None:
                    sug["descricao"] = i
                break
    if sug["vencimento"] is None:
        sug["vencimento"] = next((i for i in range(len(colunas)) if i not in usados and datas(i)), None)
        if sug["vencimento"] is not None:
            usados.add(sug["vencimento"])
    # valor: se o nome não ajudou, a 1ª coluna numérica com centavos; senão a 1ª com números de tamanho de
    # valor (códigos e nº de sinistro costumam passar de 1 milhão)
    if sug["valor"] is None:
        livres = [i for i in range(len(colunas)) if i not in usados and numerica(i)]
        com_centavos = [i for i in livres if any(isinstance(v, float) for v in amostra(i))]
        cara_de_valor = [i for i in livres if max(abs(float(v)) for v in amostra(i) if isinstance(v, int | float)) < 1_000_000]
        escolha = (com_centavos or cara_de_valor or [None])[0]
        if escolha is not None:
            sug["valor"] = escolha
            usados.add(escolha)
    return sug


# ------------------------------------------------------------------ esquemas
class Mapa(BaseModel):
    chave: int
    contrato: int | None = None
    descricao: int | None = None
    valor: int | None = None
    vencimento: int | None = None
    titulo: int | None = None
    processo: int | None = None
    parte_contraria: int | None = None
    situacao: int | None = None  # ex.: "Status da Regra" (Ativa / Inativa)


class AnalisarIn(BaseModel):
    linhas: list[list] = Field(max_length=MAX_LINHAS)
    mapa: Mapa
    # campo: acha o caso pelo campo-chave (ex.: Nº do sinistro) · titulo: pelo título do caso; aí o campo é só
    # onde guardar o nº tirado do título (opcional)
    chave_modo: Literal["campo", "titulo"] = "campo"
    campo_chave_id: int | None = None
    # com coluna de situação: ignora as regras inativas (o caso entra). Desligado por padrão: em sistemas antigos
    # "inativa" costuma ser só regra que já gerou cobrança, e a migração precisa trazer todas
    so_ativas: bool = False
    como_historico: bool = False  # cobranças já faturadas em outro sistema: entram desativadas (nunca cobradas)
    contratos_de_para: dict[str, int | str] = {}  # valor da planilha → id de contrato ou nome do contrato a criar
    # pelo título: separa "Ativo X Passivo - nº" nos campos do cliente {"ativo": id, "passivo": id, "numero": id};
    # o caso passa a ser achado por esses campos e o título sai do modelo do cliente
    decompor: dict[str, int] | None = None
    contrato_padrao_id: int | None = None  # sem coluna de contrato: vai tudo para este
    vencimento_padrao: date | None = None  # resposta do "mesma data para todos?"
    primeira_linha: int = 2  # número da 1ª linha de dados na planilha (para mostrar ao usuário)
    numeros: list[int] | None = None  # nº de cada linha na planilha (linhas já normalizadas pela análise)
    # quantas vezes a mesma cobrança (caso + valor + vencimento) já apareceu antes desta linha na planilha
    ocorrencias: list[int] | None = None
    descricao_padrao: str | None = Field(default=None, max_length=300)  # sem coluna de texto da cobrança


class AplicarIn(AnalisarIn):
    pass


# ------------------------------------------------------------------ helpers
def _tomador(ctx, tid: int) -> Tomador:
    t = ctx.db.get(Tomador, tid)
    if not t or t.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Cliente não encontrado.")
    return t


def _campo_chave(ctx, cid: int, tid: int) -> CampoAdicional:
    cp = ctx.db.get(CampoAdicional, cid)
    if not cp or cp.tenant_id != ctx.tenant_id or (cp.tomador_id and cp.tomador_id != tid):
        raise HTTPException(400, "Escolha o campo do caso que guarda a chave (ex.: Nº do sinistro).")
    return cp


def _inativa(v) -> bool:
    return _norm(v).startswith(("inativ", "cancel", "desativ", "excluid"))


def _casos_por_partes(ctx, tid: int, dec: dict[str, int]) -> dict[str, Caso]:
    """Casos do cliente indexados por ativo|passivo|nº (dos campos; sem campos, do próprio título)."""
    casos = ctx.db.scalars(select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(
        Caso.tenant_id == ctx.tenant_id, Contrato.tomador_id == tid).order_by(Caso.numero))
    out: dict[str, Caso] = {}
    for c in casos:
        v = c.campos or {}
        vals = [v.get(str(dec.get(k))) if dec.get(k) else None for k in ("ativo", "passivo", "numero")]
        if not any(vals):
            d = decompor_titulo(c.titulo)
            vals = [d["ativo"], d["passivo"], d["numero"]]
        out.setdefault(_chave_partes(*vals), c)
    return out


def _casos_por_titulo(ctx, tid: int) -> dict[str, Caso]:
    casos = ctx.db.scalars(select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(
        Caso.tenant_id == ctx.tenant_id, Contrato.tomador_id == tid).order_by(Caso.numero))
    out: dict[str, Caso] = {}
    for c in casos:
        out.setdefault(_chave(c.titulo), c)
    return out


def _resolver_contrato(contratos: list[Contrato], txt: str, de_para: dict) -> tuple[Contrato | None, str | None]:
    """(contrato existente, nome do contrato a criar). O de-para escolhido na tela vence a busca automática."""
    escolha = de_para.get(txt)
    if isinstance(escolha, int):
        return next((c for c in contratos if c.id == escolha), None), None
    if isinstance(escolha, str) and escolha.strip():
        nome = escolha.strip()[:200]
        return _achar_contrato(contratos, nome), nome
    c = _achar_contrato(contratos, txt)
    if c:
        return c, None
    return None, (f"Contrato {txt}" if re.fullmatch(r"[#\w-]{1,10}", txt) and any(ch.isdigit() for ch in txt) else txt)


def _casos_por_chave(ctx, tid: int, campo_id: int) -> dict[str, Caso]:
    casos = ctx.db.scalars(select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(
        Caso.tenant_id == ctx.tenant_id, Contrato.tomador_id == tid))
    out: dict[str, Caso] = {}
    for c in casos:
        v = (c.campos or {}).get(str(campo_id))
        if v not in (None, ""):
            out.setdefault(_chave(v), c)
    return out


def _contratos(ctx, tid: int) -> list[Contrato]:
    return list(ctx.db.scalars(select(Contrato).where(Contrato.tenant_id == ctx.tenant_id, Contrato.tomador_id == tid)
                               .order_by(Contrato.ativo.desc(), Contrato.numero)))


def _achar_contrato(contratos: list[Contrato], texto) -> Contrato | None:
    if texto in (None, ""):
        return None
    s = str(texto).strip()
    # só "#12" aponta para o nº do contrato no MayaJus; um número solto ("4") é o código do sistema de origem
    if m := re.fullmatch(r"#\s*(\d{1,6})", s):
        if c := next((c for c in contratos if c.numero == int(m.group(1))), None):
            return c
    alvo = _norm(s)
    exato = next((c for c in contratos if _norm(c.nome) == alvo), None)
    if exato or len(alvo) < 12:  # texto curto ("4", "CO-4"): só vale igual, nunca "parecido"
        return exato
    return next((c for c in contratos if alvo in _norm(c.nome) or _norm(c.nome) in alvo), None)


def _pega(linha: list, i: int | None):
    return linha[i] if i is not None and i < len(linha) else None


def _texto(v) -> str:
    if v in (None, ""):
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def _qtd_iguais(ctx, caso: Caso | None, valor: Decimal, venc: date | None) -> int:
    """Quantas cobranças o caso já tem com este valor e vencimento."""
    if caso is None or caso.id is None:
        return 0
    return ctx.db.scalar(select(func.count()).select_from(RegraCobranca).where(
        RegraCobranca.caso_id == caso.id, RegraCobranca.tipo == TipoRegra.fixo,
        RegraCobranca.valor == valor, RegraCobranca.data_pagamento == venc)) or 0


def _planejar(ctx, tid: int, dados: AnalisarIn) -> dict:
    t = _tomador(ctx, tid)
    por_titulo = dados.chave_modo == "titulo"
    if dados.campo_chave_id or not por_titulo:
        _campo_chave(ctx, dados.campo_chave_id or 0, tid)
    m = dados.mapa
    com_contrato = service.usa_contrato(ctx.db, ctx.tenant_id)
    contratos = _contratos(ctx, tid)
    padrao = next((c for c in contratos if c.id == dados.contrato_padrao_id), None)
    if padrao is None and m.contrato is None:
        ativos = [c for c in contratos if c.ativo]
        padrao = ativos[0] if len(ativos) == 1 else None
    unico = contratos[0] if len(contratos) == 1 else None
    dec = dados.decompor if por_titulo and dados.decompor else None
    if dec:
        for cid in dec.values():
            _campo_chave(ctx, cid, tid)
        casos = _casos_por_partes(ctx, tid, dec)
    else:
        casos = _casos_por_titulo(ctx, tid) if por_titulo else _casos_por_chave(ctx, tid, dados.campo_chave_id)

    def inativa(r) -> bool:
        return dados.so_ativas and m.situacao is not None and _inativa(_pega(r, m.situacao))

    if dados.numeros is None:  # 1ª análise: limpa o relatório (linhas de total, grupos)
        linhas, numeros = normalizar(dados.linhas, [dados.primeira_linha + i for i in range(len(dados.linhas))], m)
        # regra inativa sem caso identificado não serve para nada: sai já aqui
        fica = [i for i, r in enumerate(linhas) if not (inativa(r) and _pega(r, m.chave) in (None, ""))]
        linhas, numeros = [linhas[i] for i in fica], [numeros[i] for i in fica]
    else:
        linhas, numeros = dados.linhas, dados.numeros
    vistos: dict[str, int] = {}
    repeticao: dict[tuple, int] = {}
    ocorrencias: list[int] = []
    itens = []
    # texto com rótulos ("Sinistro: 123/2026ref.: 39067-1..."): cada campo do cliente é lido pelo seu nome
    campos_cliente = [] if dec else _campos_do_cliente(ctx, tid)
    for n, linha in enumerate(linhas):
        texto_chave = _texto(_pega(linha, m.chave))
        rotulados = extrair_rotulados(texto_chave, campos_cliente) if campos_cliente else {}
        # pelo título: a chave é o título inteiro; o nº (sinistro) tirado dele só é guardado no campo
        numero_extraido = rotulados.get(dados.campo_chave_id or 0) or _extrair_chave(texto_chave)
        chave_txt = texto_chave if por_titulo else numero_extraido
        item = {"linha": numeros[n] if n < len(numeros) else n, "indice": n, "chave": chave_txt,
                "texto_chave": texto_chave, "erro": None, "caso": None,
                "numero_extraido": numero_extraido if numero_extraido != texto_chave else None,
                "contrato": None, "contrato_novo": None, "descricao": "", "valor": None, "vencimento": None,
                "campos_extra": {str(k_): v for k_, v in rotulados.items() if k_ != dados.campo_chave_id},
                "acao_caso": None, "acao_regra": None, "motivo": None}
        if not chave_txt:
            if not any(c not in (None, "") for c in linha):
                continue  # linha em branco
            item["erro"] = "Linha sem o título do caso." if por_titulo else "Linha sem a chave do caso."
            ocorrencias.append(0)
            itens.append(item)
            continue
        if dec:
            partes = decompor_titulo(texto_chave)
            item["partes"] = partes
            k = _chave_partes(partes["ativo"], partes["passivo"], partes["numero"])
        else:
            k = _chave(chave_txt)
        caso = casos.get(k)
        item["caso"] = {"id": caso.id, "numero": caso.numero, "titulo": caso.titulo} if caso else None
        item["acao_caso"] = "existe" if caso else ("repetido" if k in vistos else "criar")
        vistos[k] = vistos.get(k, 0) + 1
        # contrato
        if caso:
            item["contrato"] = {"id": caso.contrato_id, "nome": caso.contrato.nome, "numero": caso.contrato.numero}
        else:
            txt = _texto(_pega(linha, m.contrato))
            # cliente com um contrato só: tudo vai para ele, diga o que disser a planilha (não cria outro);
            # só muda se a pessoa escolher outro destino na tela (de-para)
            if unico and dados.contratos_de_para.get(txt) in (None, ""):
                c, novo = unico, None
            else:
                c, novo = _resolver_contrato(contratos, txt, dados.contratos_de_para) if txt else (padrao, None)
            if c:
                item["contrato"] = {"id": c.id, "nome": c.nome, "numero": c.numero}
            else:
                item["contrato_novo"] = novo or (f"{t.nome} — casos importados" if com_contrato else service.NOME_CONTRATO_UNICO)
        item["contrato_planilha"] = _texto(_pega(linha, m.contrato))
        # regra de cobrança
        desc = _texto(_pega(linha, m.descricao)) or (dados.descricao_padrao or "").strip()
        # o texto da cobrança entra inteiro, como está na planilha (só sem espaço sobrando no fim das linhas)
        desc = re.sub(r"[ \t]+\n", "\n", desc.replace("\r\n", "\n")).strip()
        item["texto_completo"] = None
        valor = ler_valor(_pega(linha, m.valor)) if m.valor is not None else None
        venc = _data(_pega(linha, m.vencimento)) if m.vencimento is not None else None
        venc = venc or dados.vencimento_padrao
        item.update(descricao=desc, valor=str(valor) if valor is not None else None,
                    vencimento=venc.isoformat() if venc else None)
        if inativa(linha):
            item["acao_regra"], item["motivo"] = "inativa", "Regra inativa: não é importada (só o caso)."
        elif valor is None or valor <= 0:
            item["acao_regra"], item["motivo"] = "sem_valor", "Sem valor: só o caso é cadastrado."
        elif venc is None:
            item["acao_regra"], item["motivo"] = "sem_data", "Falta a data de vencimento."
        else:
            # dois lançamentos iguais no mesmo caso são duas cobranças: conta em vez de só perguntar "existe?"
            chave_rep = (k, valor, venc)
            if dados.ocorrencias is not None and n < len(dados.ocorrencias):
                ocorr = dados.ocorrencias[n]
            else:
                ocorr = repeticao.get(chave_rep, 0)
            repeticao[chave_rep] = repeticao.get(chave_rep, 0) + 1
            item["ocorrencia"] = ocorr
            if _qtd_iguais(ctx, caso, valor, venc) > ocorr:
                item["acao_regra"], item["motivo"] = "pular", "Já tem regra com o mesmo valor e vencimento."
            else:
                item["acao_regra"] = "historico" if dados.como_historico else "criar"
        ocorrencias.append(item.get("ocorrencia", 0))
        itens.append(item)

    def qtd(campo, valor):
        return sum(1 for i in itens if i[campo] == valor)

    # contratos da planilha (para o de-para da tela): valor → para onde vai e quantas linhas
    por_valor: dict[str, dict] = {}
    for i in itens:
        if i["erro"] or not i.get("contrato_planilha"):
            continue
        d = por_valor.setdefault(i["contrato_planilha"], {"valor": i["contrato_planilha"], "qtd": 0,
                                                          "contrato": None, "novo": None})
        d["qtd"] += 1
        if not i["caso"]:
            d["contrato"], d["novo"] = i["contrato"], i["contrato_novo"]

    return {
        "itens": itens,
        "linhas": linhas,
        "numeros": numeros,
        "ocorrencias": ocorrencias,
        "resumo": {
            "linhas": len(itens), "erros": sum(1 for i in itens if i["erro"]),
            "casos_novos": qtd("acao_caso", "criar"), "casos_existentes": qtd("acao_caso", "existe"),
            "repetidos": qtd("acao_caso", "repetido"),
            "regras_novas": qtd("acao_regra", "criar"), "regras_iguais": qtd("acao_regra", "pular"),
            "regras_historico": qtd("acao_regra", "historico"), "inativas_ignoradas": qtd("acao_regra", "inativa"),
            "sem_partes": sum(1 for i in itens if i.get("partes") and not i["partes"]["passivo"]),
            "contratos_planilha": sorted(por_valor.values(), key=lambda d: -d["qtd"]),
            "sem_data": qtd("acao_regra", "sem_data"), "sem_valor": qtd("acao_regra", "sem_valor"),
            "contratos_novos": sorted({i["contrato_novo"] for i in itens if i["contrato_novo"]}),
        },
    }


# ------------------------------------------------------------------ rotas
@router.post("/ler")
async def ler(tid: int, ctx: Operador, arquivo: UploadFile = File(...)):
    _tomador(ctx, tid)
    linhas = _ler_arquivo(await arquivo.read(), arquivo.filename or "")
    if len(linhas) < 2:
        raise HTTPException(400, "A planilha não tem linhas de dados.")
    i = _linha_cabecalho(linhas)
    largura = max(len(r) for r in linhas)  # relatório: o cabeçalho pode ter menos colunas que os dados
    colunas = [_texto(c) or f"Coluna {n + 1}" for n, c in enumerate(linhas[i])]
    colunas += [f"Coluna {n + 1}" for n in range(len(colunas), largura)]
    dados = [[_celula(c) for c in r] for r in linhas[i + 1:]][:MAX_LINHAS]
    campos = list(ctx.db.scalars(select(CampoAdicional).where(
        CampoAdicional.tenant_id == ctx.tenant_id, CampoAdicional.entidade == "caso", CampoAdicional.ativo,
        (CampoAdicional.tomador_id == tid) | CampoAdicional.tomador_id.is_(None))
        .order_by(CampoAdicional.tomador_id.is_(None), CampoAdicional.ordem)))
    campos_texto = [c for c in campos if c.tipo.value in ("texto", "numero")]
    chave = next((c for c in campos_texto if any(p in _norm(c.nome) for p in PISTAS["chave"])), None) or (
        campos_texto[0] if campos_texto else None)
    # cliente com campos de polo ativo/passivo: sugere separar o título "Ativo X Passivo - nº" nesses campos
    def campo_com(*pistas):
        return next((c.id for c in campos_texto if any(p in _norm(c.nome) for p in pistas)), None)

    decompor = {"ativo": campo_com("ativo", "autor", "requerente"), "passivo": campo_com("passivo", "reu", "requerido"),
                "numero": chave.id if chave else None}
    sugestao = _sugerir(colunas, dados, chave.nome if chave else None)
    pelo_titulo = bool(decompor["ativo"] and decompor["passivo"]) and sugestao.get("titulo") is not None
    if pelo_titulo:
        sugestao["chave"] = sugestao["titulo"]
    return {
        "chave_modo": "titulo" if pelo_titulo else "campo",
        "decompor": decompor if pelo_titulo else None,
        "arquivo": arquivo.filename, "colunas": colunas, "linhas": dados, "primeira_linha": i + 2,
        "sugestao": sugestao,
        "campos": [{"id": c.id, "nome": c.nome, "do_cliente": c.tomador_id is not None} for c in campos_texto],
        "campo_chave_id": chave.id if chave else None,
        "contratos": [{"id": c.id, "numero": c.numero, "nome": c.nome, "ativo": c.ativo} for c in _contratos(ctx, tid)],
    }


@router.post("/analisar")
def analisar(tid: int, dados: AnalisarIn, ctx: Operador):
    return _planejar(ctx, tid, dados)


@router.post("/aplicar")
def aplicar(tid: int, dados: AplicarIn, ctx: Operador):
    """Grava um lote de linhas (a tela manda de 10 em 10 para mostrar o progresso)."""
    t = _tomador(ctx, tid)
    por_titulo = dados.chave_modo == "titulo"
    campo = _campo_chave(ctx, dados.campo_chave_id, tid) if dados.campo_chave_id else None
    plano = _planejar(ctx, tid, dados)
    m = dados.mapa
    dec = dados.decompor if por_titulo and dados.decompor else None
    criados: dict[str, Caso] = {}
    resultados = []
    for item in plano["itens"]:
        r = {"linha": item["linha"], "chave": item["chave"], "caso_numero": None, "caso": None, "regra": None,
             "status": "ok", "mensagem": None}
        if item["erro"]:
            r.update(status="erro", mensagem=item["erro"])
            resultados.append(r)
            continue
        if dec:
            pt = item["partes"]
            k = _chave_partes(pt["ativo"], pt["passivo"], pt["numero"])
        else:
            k = _chave(item["chave"])
        caso = ctx.db.get(Caso, item["caso"]["id"]) if item["caso"] else criados.get(k)
        if caso is None:
            if item["contrato"]:
                contrato = ctx.db.get(Contrato, item["contrato"]["id"])
            else:  # contrato fictício: cria uma vez por nome
                contrato = _achar_contrato(_contratos(ctx, tid), item["contrato_novo"])
                if contrato is None:
                    numero = (ctx.db.scalar(select(func.max(Contrato.numero)).where(
                        Contrato.tenant_id == ctx.tenant_id)) or 0) + 1
                    contrato = Contrato(tenant_id=ctx.tenant_id, numero=numero, tomador_id=t.id,
                                        nome=item["contrato_novo"][:200], data_inicio=date.today(),
                                        observacao="Criado pela importação de planilha: confira os dados do contrato.")
                    ctx.db.add(contrato)
                    ctx.db.flush()
                    ctx.auditar("faturamento.contrato.criar", "fat_contrato", contrato.id,
                                descricao=f"#{contrato.numero} {contrato.nome} (importação de planilha)")
            numero = (ctx.db.scalar(select(func.max(Caso.numero)).where(Caso.tenant_id == ctx.tenant_id)) or 0) + 1
            linha = plano["linhas"][item["indice"]]
            texto_caso = item["texto_chave"] if item["texto_chave"] != item["chave"] else ""
            descricao_caso = None
            if dec:  # título separado nos campos do cliente; o título sai do modelo do cliente
                pt = item["partes"]
                titulo = item["chave"]
                campos = {str(dec[k_]): pt[k_] for k_ in ("ativo", "passivo", "numero") if dec.get(k_) and pt[k_]}
                descricao_caso = pt["extra"] or None
            elif por_titulo:  # o título é a chave: fica como veio (o modelo de título não mexe, senão não se acha depois)
                titulo = item["chave"]
                campos = {str(campo.id): item["numero_extraido"]} if campo and item["numero_extraido"] else {}
            else:
                titulo = _texto(_pega(linha, m.titulo)) or texto_caso or f"{campo.nome}: {item['chave']}"
                campos = {str(campo.id): item["chave"]}
            if not dec:  # demais campos do cliente lidos do texto (ex.: Ref)
                campos = {**item.get("campos_extra", {}), **campos}
            processo = _texto(_pega(linha, m.processo)) or (item["partes"]["processo"] if dec else "")
            caso = Caso(tenant_id=ctx.tenant_id, numero=numero, contrato_id=contrato.id, data_abertura=date.today(),
                        titulo=titulo[:250], numero_processo=processo[:40] or None, descricao=descricao_caso,
                        parte_contraria=_texto(_pega(linha, m.parte_contraria))[:200] or None, campos=campos)
            caso.contrato = contrato
            ctx.db.add(caso)
            regras_caso.ao_criar(ctx.db, caso)
            ctx.db.flush()
            if dec or not por_titulo:
                titulo_caso.aplicar(ctx.db, caso)
            ctx.auditar("faturamento.caso.criar", "fat_caso", caso.id, descricao=f"#{caso.numero} {caso.titulo} (planilha)")
            criados[k] = caso
            r["caso"] = "criado"
        else:
            r["caso"] = "existente"
            # caso que já existia: completa só os campos que estavam vazios (ex.: Ref)
            faltam = {k_: v for k_, v in item.get("campos_extra", {}).items() if not (caso.campos or {}).get(k_)}
            if faltam:
                caso.campos = {**(caso.campos or {}), **faltam}
                titulo_caso.aplicar(ctx.db, caso)
        r["caso_numero"] = caso.numero
        # regra: confere de novo na hora de gravar (repetir a importação não duplica)
        valor = Decimal(item["valor"]) if item["valor"] else None
        venc = date.fromisoformat(item["vencimento"]) if item["vencimento"] else None
        if item["acao_regra"] in ("criar", "pular", "historico") and valor and venc:
            if _qtd_iguais(ctx, caso, valor, venc) > item.get("ocorrencia", 0):
                r["regra"] = "igual"
            else:
                historico = item["acao_regra"] == "historico"
                obs = ("Já faturada no sistema antigo: importada como histórico (desativada, não é cobrada)."
                       if historico else "Importada de planilha.")
                if item.get("texto_completo"):
                    obs += "\n\n" + item["texto_completo"]
                regra = RegraCobranca(tenant_id=ctx.tenant_id, contrato_id=caso.contrato_id, caso_id=caso.id,
                                      tipo=TipoRegra.fixo, descricao=item["descricao"] or "Honorários",
                                      valor=valor, data_pagamento=venc, observacao=obs, ativo=not historico)
                ctx.db.add(regra)
                ctx.db.flush()
                ctx.auditar("faturamento.regra.criar", "fat_regra", regra.id,
                            descricao=f"fixo: {regra.descricao} (planilha{', histórico' if historico else ''})")
                r["regra"] = "historico" if historico else "criada"
        else:
            r["regra"] = item["acao_regra"]
            r["mensagem"] = item["motivo"]
        resultados.append(r)
    ctx.db.commit()
    return {"resultados": resultados}


@router.get("/modelo")
def modelo(tid: int, ctx: Operador) -> Response:
    """Planilha modelo já com o nome do campo-chave do cliente e os contratos dele nas instruções."""
    from app.modules.faturamento.planilhas import _baixar, _planilha

    t = _tomador(ctx, tid)
    campos = list(ctx.db.scalars(select(CampoAdicional).where(
        CampoAdicional.tenant_id == ctx.tenant_id, CampoAdicional.entidade == "caso", CampoAdicional.ativo,
        (CampoAdicional.tomador_id == tid) | CampoAdicional.tomador_id.is_(None))
        .order_by(CampoAdicional.tomador_id.is_(None), CampoAdicional.ordem)))
    chave = next((c for c in campos if any(p in _norm(c.nome) for p in PISTAS["chave"])), None)
    nome_chave = chave.nome if chave else "Nº do sinistro"
    contratos = _contratos(ctx, tid)
    exemplo_contrato = contratos[0].nome if contratos else "Contencioso"
    cab = [nome_chave, "Contrato", "Descrição da cobrança", "Valor", "Vencimento", "Título do caso", "Nº do processo",
           "Parte contrária"]
    linhas = [
        ["1234567", exemplo_contrato, "Honorários iniciais", Decimal("1150.00"), date.today(), "", "", "Fulano de Tal"],
        ["7654321", exemplo_contrato, "Honorários de êxito", Decimal("2300.00"), None, "", "1001234-56.2026.8.26.0100", ""],
    ]
    instrucoes = [
        f"Planilha de casos de {t.nome}: uma linha por cobrança (o mesmo caso pode aparecer em mais de uma linha).",
        "Apague as duas linhas de exemplo antes de importar.",
        f"{nome_chave}: obrigatório. É por ele que o sistema acha o caso que já existe.",
        "Contrato: nome ou nº do contrato. Se não existir, o contrato é criado. Vazio: vai para o contrato escolhido na importação.",
        "Descrição da cobrança: texto que vai para a regra de cobrança (e para a nota fiscal, se o cliente estiver configurado assim).",
        "Valor: valor da cobrança. Vazio: só o caso é cadastrado.",
        "Vencimento: data da cobrança (dd/mm/aaaa). Se faltar, o sistema pergunta se pode usar a mesma data para todas.",
        "Cobrança já cadastrada com o mesmo valor e vencimento é pulada; importar de novo não duplica nada.",
        "Título do caso, Nº do processo e Parte contrária: opcionais. Com modelo de título no cliente, o título é montado sozinho.",
        "",
        "Contratos deste cliente: " + (", ".join(f"#{c.numero} {c.nome}" for c in contratos) or "nenhum ainda"),
    ]
    nome = re.sub(r"[^\w\- ]", "", t.nome)[:40].strip() or "cliente"
    return _baixar(_planilha("Casos", cab, linhas, instrucoes), f"modelo_casos_{nome}.xlsx")
