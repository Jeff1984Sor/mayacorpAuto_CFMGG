"""Leitor do arquivo TXT de RPS em lote da Prefeitura de São Paulo (o arquivo gerado pela Lello).

Estrutura (posições 1-based, campos de largura fixa):
  Tipo 1 — Cabeçalho: tipo(1) versão(3) CCM prestador(8) data início(8) data fim(8)
  Tipo 2 — Detalhe (versão 001) / Tipo 6 — Detalhe (versão 002, mesmos campos iniciais + tributos)
  Tipo 9 — Rodapé: tipo(1) qtd linhas(7) total serviços(15) total deduções(15)

Os campos de detalhe que não existem no arquivo (IBS/CBS do layout 2) são completados
depois, pelos Parâmetros Fiscais da emissora.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")

# (nome, início 1-based, tamanho)
CAMPOS_DETALHE: list[tuple[str, int, int]] = [
    ("tipo_registro", 1, 1),
    ("tipo_rps", 2, 5),
    ("serie", 7, 5),
    ("numero", 12, 12),
    ("data_emissao", 24, 8),
    ("situacao", 32, 1),
    ("valor", 33, 15),
    ("deducoes", 48, 15),
    ("cod_servico", 63, 5),
    ("aliquota", 68, 4),
    ("iss_retido", 72, 1),
    ("ind_doc_tomador", 73, 1),
    ("doc_tomador", 74, 14),
    ("im_tomador", 88, 8),
    ("ie_tomador", 96, 12),
    ("nome_tomador", 108, 75),
    ("tipo_logradouro", 183, 3),
    ("logradouro", 186, 50),
    ("numero_endereco", 236, 10),
    ("complemento", 246, 30),
    ("bairro", 276, 30),
    ("cidade", 306, 50),
    ("uf", 356, 2),
    ("cep", 358, 8),
    ("email", 366, 75),
]
FIM_FIXO = 440  # depois disso: discriminação (tipo 2) ou tributos + discriminação (tipo 6)

# Tipo 6 (versão 002): após o e-mail vêm PIS, COFINS, INSS, IR, CSLL (15 cada),
# carga tributária valor(15) / % (5) / fonte(10), CEI(12), matrícula obra(12),
# município prestação IBGE(7) e só então a discriminação.
TAM_TRIBUTOS_V2 = 15 * 5 + 15 + 5 + 10 + 12 + 12 + 7


class ArquivoInvalido(ValueError):
    pass


@dataclass
class ProblemaLeitura:
    linha: int
    mensagem: str


@dataclass
class DetalheRps:
    linha: int
    tipo_rps: str
    serie: str
    numero: int | None
    data_emissao: date | None
    situacao: str
    valor: Decimal
    deducoes: Decimal
    cod_servico: str
    aliquota: Decimal  # fração: 0.05 = 5%
    iss_retido: bool
    ind_doc_tomador: str
    doc_tomador: str
    im_tomador: str
    ie_tomador: str
    nome_tomador: str
    tipo_logradouro: str
    logradouro: str
    numero_endereco: str
    complemento: str
    bairro: str
    cidade: str
    uf: str
    cep: str
    email: str
    discriminacao: str
    extras: dict[str, str] = field(default_factory=dict)
    problemas: list[str] = field(default_factory=list)


@dataclass
class ArquivoRps:
    encoding: str
    versao: str
    ccm_prestador: str
    data_inicio: date | None
    data_fim: date | None
    detalhes: list[DetalheRps]
    rodape_qtd: int | None
    rodape_valor: Decimal | None
    rodape_deducoes: Decimal | None
    problemas: list[ProblemaLeitura]
    total_linhas: int


def decodificar(conteudo: bytes) -> tuple[str, str]:
    """Detecção de encoding: UTF-8 estrito primeiro; depois Windows-1252 (padrão dos sistemas legados)."""
    for enc in ENCODINGS:
        try:
            return conteudo.decode(enc), enc.replace("-sig", "")
        except UnicodeDecodeError:
            continue
    return conteudo.decode("latin-1", errors="replace"), "latin-1"


def _corte(linha: str, ini: int, tam: int) -> str:
    return linha[ini - 1 : ini - 1 + tam]


def _data(txt: str) -> date | None:
    txt = txt.strip()
    if not txt:
        return None
    try:
        return datetime.strptime(txt, "%Y%m%d").date()
    except ValueError:
        return None


def _centavos(txt: str) -> Decimal:
    txt = txt.strip()
    if not txt:
        return Decimal(0)
    if not txt.isdigit():
        raise ValueError(txt)
    return (Decimal(int(txt)) / 100).quantize(Decimal("0.01"))


def _doc_tomador(indicador: str, doc: str) -> str:
    """O campo tem 14 posições com zeros à esquerda; CPF ocupa as 11 últimas."""
    if not doc.strip("0"):
        return ""
    return doc[-11:] if indicador == "1" else doc.zfill(14)[-14:]


def _ler_detalhe(n: int, linha: str) -> DetalheRps:
    bruto = {nome: _corte(linha, ini, tam) for nome, ini, tam in CAMPOS_DETALHE}
    problemas: list[str] = []

    def dinheiro(campo: str) -> Decimal:
        try:
            return _centavos(bruto[campo])
        except ValueError:
            problemas.append(f"Valor ilegível no campo {campo}: '{bruto[campo].strip()}'")
            return Decimal(0)

    numero_txt = bruto["numero"].strip()
    numero = int(numero_txt) if numero_txt.isdigit() else None
    if numero is None:
        problemas.append("Número do RPS ilegível.")

    data = _data(bruto["data_emissao"])
    if data is None:
        problemas.append("Data de emissão ilegível.")

    aliq_txt = bruto["aliquota"].strip()
    aliquota = (Decimal(int(aliq_txt)) / 10000) if aliq_txt.isdigit() else Decimal(0)

    extras: dict[str, str] = {}
    resto = linha[FIM_FIXO:]
    if bruto["tipo_registro"] == "6":
        trib, resto = resto[:TAM_TRIBUTOS_V2], resto[TAM_TRIBUTOS_V2:]
        nomes = ["pis", "cofins", "inss", "ir", "csll", "carga_valor"]
        for i, nome in enumerate(nomes):
            extras[nome] = trib[i * 15 : (i + 1) * 15].strip()
        p = 90
        extras["carga_percentual"] = trib[p : p + 5].strip()
        extras["carga_fonte"] = trib[p + 5 : p + 15].strip()
        extras["cei"] = trib[p + 15 : p + 27].strip()
        extras["matricula_obra"] = trib[p + 27 : p + 39].strip()
        extras["municipio_prestacao"] = trib[p + 39 : p + 46].strip()
        extras = {k: v for k, v in extras.items() if v}

    # A Prefeitura usa "|" como quebra de linha na discriminação
    discriminacao = resto.rstrip().replace("|", "\n").strip()

    return DetalheRps(
        linha=n,
        tipo_rps=bruto["tipo_rps"].strip() or "RPS",
        serie=bruto["serie"].strip(),
        numero=numero,
        data_emissao=data,
        situacao=bruto["situacao"].strip() or "T",
        valor=dinheiro("valor"),
        deducoes=dinheiro("deducoes"),
        cod_servico=bruto["cod_servico"].strip(),
        aliquota=aliquota,
        iss_retido=bruto["iss_retido"].strip() == "1",
        ind_doc_tomador=bruto["ind_doc_tomador"].strip() or "3",
        doc_tomador=_doc_tomador(bruto["ind_doc_tomador"].strip(), bruto["doc_tomador"].strip()),
        im_tomador=bruto["im_tomador"].strip().lstrip("0"),
        ie_tomador=bruto["ie_tomador"].strip().lstrip("0"),
        nome_tomador=" ".join(bruto["nome_tomador"].split()),
        tipo_logradouro=bruto["tipo_logradouro"].strip(),
        logradouro=" ".join(bruto["logradouro"].split()),
        numero_endereco=bruto["numero_endereco"].strip(),
        complemento=" ".join(bruto["complemento"].split()),
        bairro=" ".join(bruto["bairro"].split()),
        cidade=" ".join(bruto["cidade"].split()),
        uf=bruto["uf"].strip().upper(),
        cep=bruto["cep"].strip(),
        email=bruto["email"].strip().lower(),
        discriminacao=discriminacao,
        extras=extras,
        problemas=problemas,
    )


def ler(conteudo: bytes) -> ArquivoRps:
    if not conteudo.strip():
        raise ArquivoInvalido("O arquivo está vazio.")
    texto, encoding = decodificar(conteudo)
    linhas = [ln for ln in texto.splitlines() if ln.strip()]

    cab = linhas[0]
    if not cab.startswith("1"):
        raise ArquivoInvalido(
            "Este arquivo não parece um lote de RPS da Prefeitura de São Paulo (falta o cabeçalho tipo 1)."
        )
    versao = _corte(cab, 2, 3)
    if versao not in ("001", "002"):
        raise ArquivoInvalido(f"Versão de layout '{versao}' não reconhecida (esperado 001 ou 002).")

    detalhes: list[DetalheRps] = []
    problemas: list[ProblemaLeitura] = []
    rodape = None
    for n, ln in enumerate(linhas[1:], start=2):
        tipo = ln[:1]
        if tipo in ("2", "6"):
            if len(ln) < FIM_FIXO - 75:  # aceita linha que termina antes do e-mail
                problemas.append(ProblemaLeitura(n, "Linha de detalhe mais curta que o layout."))
            detalhes.append(_ler_detalhe(n, ln.ljust(FIM_FIXO)))
        elif tipo == "9":
            rodape = ln
        else:
            problemas.append(ProblemaLeitura(n, f"Tipo de registro '{tipo}' ignorado."))

    rodape_qtd = rodape_valor = rodape_deducoes = None
    if rodape:
        try:
            rodape_qtd = int(_corte(rodape, 2, 7))
            rodape_valor = _centavos(_corte(rodape, 9, 15))
            rodape_deducoes = _centavos(_corte(rodape, 24, 15))
        except ValueError:
            problemas.append(ProblemaLeitura(len(linhas), "Rodapé ilegível."))
        if rodape_qtd is not None and rodape_qtd != len(detalhes):
            problemas.append(
                ProblemaLeitura(
                    len(linhas), f"O rodapé informa {rodape_qtd} RPS, mas o arquivo tem {len(detalhes)}."
                )
            )
        soma = sum((d.valor for d in detalhes), Decimal(0))
        if rodape_valor is not None and rodape_valor != soma:
            problemas.append(
                ProblemaLeitura(len(linhas), f"Total do rodapé ({rodape_valor}) difere da soma dos RPS ({soma}).")
            )
    else:
        problemas.append(ProblemaLeitura(len(linhas), "Arquivo sem rodapé (tipo 9)."))

    if not detalhes:
        raise ArquivoInvalido("Nenhum RPS encontrado no arquivo.")

    return ArquivoRps(
        encoding=encoding,
        versao=versao,
        ccm_prestador=_corte(cab, 5, 8).strip(),
        data_inicio=_data(_corte(cab, 13, 8)),
        data_fim=_data(_corte(cab, 21, 8)),
        detalhes=detalhes,
        rodape_qtd=rodape_qtd,
        rodape_valor=rodape_valor,
        rodape_deducoes=rodape_deducoes,
        problemas=problemas,
        total_linhas=len(linhas),
    )


# ---------- Geração (usada em testes e no arquivo de exemplo) ----------
def _fx(v: str | int, tam: int, num: bool = False) -> str:
    s = str(v)
    return s.rjust(tam, "0")[:tam] if num else s.ljust(tam)[:tam]


def gerar_linha_detalhe(d: dict) -> str:
    cents = lambda v: _fx(int((Decimal(str(v)) * 100).quantize(Decimal(1))), 15, True)  # noqa: E731
    return (
        "2"
        + _fx(d.get("tipo_rps", "RPS"), 5)
        + _fx(d.get("serie", "A"), 5)
        + _fx(d["numero"], 12, True)
        + d["data"].strftime("%Y%m%d")
        + d.get("situacao", "T")
        + cents(d["valor"])
        + cents(d.get("deducoes", 0))
        + _fx(d["cod_servico"], 5, True)
        + _fx(int(Decimal(str(d["aliquota"])) * 10000), 4, True)
        + ("1" if d.get("iss_retido") else "2")
        + d.get("ind_doc", "2")
        + _fx(d.get("doc", ""), 14, True)
        + _fx(d.get("im", ""), 8, True)
        + _fx(d.get("ie", ""), 12, True)
        + _fx(d["nome"], 75)
        + _fx(d.get("tipo_logradouro", "R"), 3)
        + _fx(d.get("logradouro", ""), 50)
        + _fx(d.get("numero_end", ""), 10)
        + _fx(d.get("complemento", ""), 30)
        + _fx(d.get("bairro", ""), 30)
        + _fx(d.get("cidade", "SAO PAULO"), 50)
        + _fx(d.get("uf", "SP"), 2)
        + _fx(d.get("cep", ""), 8, True)
        + _fx(d.get("email", ""), 75)
        + d.get("discriminacao", "").replace("\n", "|")
    )


def gerar_arquivo(ccm: str, detalhes: list[dict], encoding: str = "cp1252") -> bytes:
    datas = [d["data"] for d in detalhes]
    total = sum(Decimal(str(d["valor"])) for d in detalhes)
    deducoes = sum(Decimal(str(d.get("deducoes", 0))) for d in detalhes)
    linhas = ["1002" + _fx(ccm, 8, True) + min(datas).strftime("%Y%m%d") + max(datas).strftime("%Y%m%d")]
    linhas += [gerar_linha_detalhe(d) for d in detalhes]
    linhas.append(
        "9"
        + _fx(len(detalhes), 7, True)
        + _fx(int(total * 100), 15, True)
        + _fx(int(deducoes * 100), 15, True)
    )
    return ("\r\n".join(linhas) + "\r\n").encode(encoding)
