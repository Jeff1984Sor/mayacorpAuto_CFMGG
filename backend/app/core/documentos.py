"""Validação e formatação de CPF/CNPJ/CEP."""

import re


def so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", valor or "")


def _dv(base: str, pesos: list[int]) -> int:
    resto = sum(int(d) * p for d, p in zip(base, pesos, strict=True)) % 11
    return 0 if resto < 2 else 11 - resto


def cpf_valido(cpf: str | None) -> bool:
    c = so_digitos(cpf)
    if len(c) != 11 or c == c[0] * 11:
        return False
    d1 = _dv(c[:9], list(range(10, 1, -1)))
    d2 = _dv(c[:9] + str(d1), list(range(11, 1, -1)))
    return c[-2:] == f"{d1}{d2}"


def cnpj_valido(cnpj: str | None) -> bool:
    c = so_digitos(cnpj)
    if len(c) != 14 or c == c[0] * 14:
        return False
    p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = _dv(c[:12], p1)
    d2 = _dv(c[:12] + str(d1), [6, *p1])
    return c[-2:] == f"{d1}{d2}"


def documento_valido(doc: str | None) -> bool:
    d = so_digitos(doc)
    return cpf_valido(d) if len(d) == 11 else cnpj_valido(d)


def formatar_documento(doc: str | None) -> str:
    d = so_digitos(doc)
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return doc or ""


def cep_valido(cep: str | None) -> bool:
    c = so_digitos(cep)
    return len(c) == 8 and c != "00000000"
