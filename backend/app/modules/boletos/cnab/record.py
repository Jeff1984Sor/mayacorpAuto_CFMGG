"""Registro (linha) de 240 posições, descrito por uma lista de campos.

O layout é validado na hora em que a classe é criada: posições contíguas de 1 a 240, sem buraco nem
sobreposição, nomes únicos. Um layout errado nem chega a importar.
"""

from typing import Any, ClassVar

from app.modules.boletos.cnab.exceptions import LayoutInvalido, LinhaInvalida
from app.modules.boletos.cnab.fields import Field

TAMANHO = 240


def validar_layout(nome: str, campos: list[Field], tamanho: int = TAMANHO) -> None:
    if not campos:
        raise LayoutInvalido(f"{nome}: layout sem campos.")
    esperado = 1
    vistos: set[str] = set()
    for c in campos:
        if c.nome in vistos:
            raise LayoutInvalido(f"{nome}: campo '{c.nome}' repetido.")
        vistos.add(c.nome)
        if c.inicio > esperado:
            raise LayoutInvalido(f"{nome}: buraco entre as posições {esperado} e {c.inicio - 1} (antes de '{c.nome}').")
        if c.inicio < esperado:
            raise LayoutInvalido(f"{nome}: '{c.nome}' começa em {c.inicio}, mas a posição {esperado - 1} já foi usada.")
        esperado = c.fim + 1
    if esperado - 1 != tamanho:
        raise LayoutInvalido(f"{nome}: o layout termina na posição {esperado - 1}, e a linha tem {tamanho}.")


class Record:
    """Subclasse define `CAMPOS`. `montar(**valores)` devolve a linha; `ler(linha)` devolve um dicionário."""

    CAMPOS: ClassVar[list[Field]] = []
    _por_nome: ClassVar[dict[str, Field]] = {}

    def __init_subclass__(cls, **kw):
        super().__init_subclass__(**kw)
        if "CAMPOS" in cls.__dict__:
            validar_layout(cls.__name__, cls.CAMPOS)
            cls._por_nome = {c.nome: c for c in cls.CAMPOS}

    @classmethod
    def montar(cls, **valores: Any) -> str:
        desconhecidos = set(valores) - set(cls._por_nome)
        if desconhecidos:
            raise LayoutInvalido(f"{cls.__name__}: campo(s) inexistente(s): {', '.join(sorted(desconhecidos))}.")
        linha = "".join(c.formatar(valores.get(c.nome)) for c in cls.CAMPOS)
        if len(linha) != TAMANHO:  # defesa: nunca deveria acontecer com o layout validado
            raise LinhaInvalida(f"{cls.__name__}: linha com {len(linha)} posições.")
        return linha

    @classmethod
    def ler(cls, linha: str) -> dict[str, Any]:
        if len(linha) != TAMANHO:
            raise LinhaInvalida(f"{cls.__name__}: linha com {len(linha)} posições (o correto é {TAMANHO}).")
        return {c.nome: c.ler(linha) for c in cls.CAMPOS if c.tipo != "B"}
