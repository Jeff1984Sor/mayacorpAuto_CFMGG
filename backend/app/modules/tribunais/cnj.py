"""Número único do CNJ (Res. 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO e o catálogo dos tribunais pelo par J + TR.

O par J (segmento da Justiça) + TR (tribunal) diz qual tribunal; a tabela de sistemas (models.Sistema) diz por onde falar com ele.
"""

import re

SEGMENTOS = {1: "STF", 2: "CNJ", 3: "STJ", 4: "Justiça Federal", 5: "Justiça do Trabalho", 6: "Justiça Eleitoral",
             7: "Justiça Militar da União", 8: "Justiça Estadual", 9: "Justiça Militar Estadual"}

# código TR das UFs na Justiça Estadual e Eleitoral (ordem alfabética do nome do estado)
UF_TR = {"AC": "01", "AL": "02", "AP": "03", "AM": "04", "BA": "05", "CE": "06", "DF": "07", "ES": "08", "GO": "09", "MA": "10",
         "MT": "11", "MS": "12", "MG": "13", "PA": "14", "PB": "15", "PR": "16", "PE": "17", "PI": "18", "RJ": "19", "RN": "20",
         "RS": "21", "RO": "22", "RR": "23", "SC": "24", "SE": "25", "SP": "26", "TO": "27"}
UF_NOME = {"AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas", "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal e Territórios",
           "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
           "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco", "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
           "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima", "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe", "TO": "Tocantins"}
TRF_UFS = {1: ["AC", "AM", "AP", "BA", "DF", "GO", "MA", "MT", "PA", "PI", "RO", "RR", "TO"], 2: ["RJ", "ES"], 3: ["SP", "MS"],
           4: ["RS", "PR", "SC"], 5: ["PE", "AL", "CE", "PB", "RN", "SE"], 6: ["MG"]}
TRT_UF = {1: "RJ", 2: "SP", 3: "MG", 4: "RS", 5: "BA", 6: "PE", 7: "CE", 8: "PA", 9: "PR", 10: "DF", 11: "AM", 12: "SC", 13: "PB",
          14: "RO", 15: "SP", 16: "MA", 17: "ES", 18: "GO", 19: "AL", 20: "SE", 21: "RN", 22: "PI", 23: "MT", 24: "MS"}

# sistema mais provável de cada TJ (ponto de partida; a MayaCorp corrige em Configurações › Tribunais e o DataJud
# informa o sistema real de cada processo na importação)
_SISTEMA_TJ = {"SP": "esaj", "SC": "eproc", "RS": "eproc", "TO": "eproc", "RJ": "eproc", "PR": "projudi", "GO": "projudi",
               "RR": "projudi", "MS": "esaj", "AM": "esaj", "AC": "esaj", "AL": "esaj", "SE": "proprio", "AP": "proprio"}
_SISTEMA_TRF = {1: "pje", 2: "eproc", 3: "pje", 4: "eproc", 5: "pje", 6: "eproc"}

_RX = re.compile(r"^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$")


def so_digitos(numero: str | None) -> str:
    return re.sub(r"\D", "", numero or "")


def digito_verificador(n7: str, ano: str, j: str, tr: str, origem: str) -> str:
    """Módulo 97 base 10 (ISO 7064), como na Resolução CNJ 65/2008."""
    return f"{98 - int(f'{n7}{ano}{j}{tr}{origem}00') % 97:02d}"


def valido(numero: str | None) -> bool:
    d = so_digitos(numero)
    m = _RX.match(d)
    if not m:
        return False
    n7, dv, ano, j, tr, origem = m.groups()
    return digito_verificador(n7, ano, j, tr, origem) == dv


def formatar(numero: str | None) -> str:
    d = so_digitos(numero)
    m = _RX.match(d)
    if not m:
        return numero or ""
    n7, dv, ano, j, tr, origem = m.groups()
    return f"{n7}-{dv}.{ano}.{j}.{tr}.{origem}"


def partes(numero: str) -> dict:
    m = _RX.match(so_digitos(numero))
    if not m:
        raise ValueError("Número CNJ inválido: use NNNNNNN-DD.AAAA.J.TR.OOOO.")
    n7, dv, ano, j, tr, origem = m.groups()
    return {"sequencial": n7, "dv": dv, "ano": int(ano), "j": int(j), "tr": tr, "origem": origem}


def montar(sequencial: int, ano: int, j: int, tr: str, origem: str) -> str:
    n7, a = f"{sequencial:07d}", f"{ano:04d}"
    return f"{n7}{digito_verificador(n7, a, str(j), tr, origem)}{a}{j}{tr}{origem}"


def catalogo() -> list[dict]:
    """Todos os tribunais com o par J/TR, ramo, UF e o alias do DataJud (api_publica_<alias>)."""
    t: list[dict] = [
        {"sigla": "STF", "nome": "Supremo Tribunal Federal", "segmento_j": 1, "codigo_tr": "00", "uf": None, "ramo": "superior",
         "alias_datajud": None, "sistemas": [("superior", "proprio")]},
        {"sigla": "STJ", "nome": "Superior Tribunal de Justiça", "segmento_j": 3, "codigo_tr": "00", "uf": None, "ramo": "superior",
         "alias_datajud": "stj", "sistemas": [("superior", "proprio")]},
        {"sigla": "TST", "nome": "Tribunal Superior do Trabalho", "segmento_j": 5, "codigo_tr": "00", "uf": None, "ramo": "superior",
         "alias_datajud": "tst", "sistemas": [("superior", "pje")]},
        {"sigla": "TSE", "nome": "Tribunal Superior Eleitoral", "segmento_j": 6, "codigo_tr": "00", "uf": None, "ramo": "superior",
         "alias_datajud": "tse", "sistemas": [("superior", "pje")]},
        {"sigla": "STM", "nome": "Superior Tribunal Militar", "segmento_j": 7, "codigo_tr": "00", "uf": None, "ramo": "militar",
         "alias_datajud": "stm", "sistemas": [("superior", "eproc")]},
    ]
    for n, ufs in TRF_UFS.items():
        s = _SISTEMA_TRF[n]
        t.append({"sigla": f"TRF{n}", "nome": f"Tribunal Regional Federal da {n}ª Região", "segmento_j": 4, "codigo_tr": f"{n:02d}",
                  "uf": ufs[0] if len(ufs) == 1 else None, "ramo": "federal", "alias_datajud": f"trf{n}",
                  "sistemas": [("1g", s), ("2g", s), ("turma_recursal", s)]})
    for n, uf in TRT_UF.items():
        t.append({"sigla": f"TRT{n}", "nome": f"Tribunal Regional do Trabalho da {n}ª Região", "segmento_j": 5, "codigo_tr": f"{n:02d}",
                  "uf": uf, "ramo": "trabalho", "alias_datajud": f"trt{n}", "sistemas": [("1g", "pje"), ("2g", "pje")]})
    for uf, tr in UF_TR.items():
        sigla = "TJDFT" if uf == "DF" else f"TJ{uf}"
        s = _SISTEMA_TJ.get(uf, "pje")
        sistemas = [("1g", s), ("2g", s), ("turma_recursal", s)]
        if uf == "SP":  # TJSP em migração do e-SAJ para o eproc: os dois convivem
            sistemas.append(("1g", "eproc"))
        t.append({"sigla": sigla, "nome": f"Tribunal de Justiça · {UF_NOME[uf]}", "segmento_j": 8, "codigo_tr": tr, "uf": uf,
                  "ramo": "estadual", "alias_datajud": sigla.lower(), "sistemas": sistemas})
        t.append({"sigla": f"TRE-{uf}", "nome": f"Tribunal Regional Eleitoral · {UF_NOME[uf]}", "segmento_j": 6, "codigo_tr": tr,
                  "uf": uf, "ramo": "eleitoral", "alias_datajud": f"tre-{uf.lower()}", "sistemas": [("1g", "pje"), ("2g", "pje")]})
    for uf in ("MG", "RS", "SP"):
        t.append({"sigla": f"TJM{uf}", "nome": f"Tribunal de Justiça Militar · {UF_NOME[uf]}", "segmento_j": 9, "codigo_tr": UF_TR[uf],
                  "uf": uf, "ramo": "militar", "alias_datajud": f"tjm{uf.lower()}", "sistemas": [("1g", "eproc"), ("2g", "eproc")]})
    return t


_POR_JTR = {(t["segmento_j"], t["codigo_tr"]): t for t in catalogo()}
_POR_SIGLA = {t["sigla"]: t for t in _POR_JTR.values()}


def tribunal_do_numero(numero: str) -> dict | None:
    """Roteamento pelo número: J + TR → tribunal do catálogo (None se o par não existir)."""
    p = partes(numero)
    return _POR_JTR.get((p["j"], p["tr"]))


def tribunal_por_sigla(sigla: str | None) -> dict | None:
    s = (sigla or "").upper().replace(" ", "")
    if s in _POR_SIGLA:
        return _POR_SIGLA[s]
    if re.fullmatch(r"TRE[A-Z]{2}", s):
        return _POR_SIGLA.get(f"TRE-{s[3:]}")
    return None


def sistema_do_nome(nome: str | None) -> str | None:
    """Nome do sistema como o DataJud/DJEN escreve ("PJe", "SAJ", "e-Proc"...) → enum interno."""
    n = (nome or "").lower().replace("-", "").replace(" ", "")
    if not n:
        return None
    if "pje" in n:
        return "pje"
    if "saj" in n:
        return "esaj"
    if "eproc" in n:
        return "eproc"
    if "projudi" in n:
        return "projudi"
    return "proprio"


GRAU_DATAJUD = {"G1": "1g", "JE": "1g", "G2": "2g", "TR": "turma_recursal", "TRU": "turma_recursal", "SUP": "superior",
                "TNU": "superior", "TRF": "2g"}
INSTANCIA_DO_GRAU = {"1g": "primeira", "2g": "segunda", "turma_recursal": "turma_recursal", "superior": "superior"}
TIPO_CASO_DO_RAMO = {"estadual": "judicial_estadual", "federal": "judicial_federal", "trabalho": "judicial_trabalhista"}
