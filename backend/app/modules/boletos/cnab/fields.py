"""Campo de posição fixa do CNAB: sabe se escrever (remessa) e se ler (retorno).

Tipos:
    N  numérico: só dígitos, zeros à esquerda. Com `dec`, o valor é Decimal sem vírgula (150.75 → ...15075).
    A  alfanumérico: maiúsculo, sem acento, espaços à direita; se passar do tamanho, corta e avisa.
    X  texto literal: como veio (chave Pix, TXID), só completa com espaços; não pode passar do tamanho.
    D  data DDMMAAAA; vazia = 00000000.
    B  brancos.
"""

import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.modules.boletos.cnab.exceptions import LayoutInvalido, ValorNaoCabe

log = logging.getLogger(__name__)

TIPOS = ("N", "A", "X", "D", "B")
_FORA_DO_PADRAO = re.compile(r"[^A-Z0-9 .,\-/()]")


def limpar_texto(valor: Any) -> str:
    """Maiúsculo, sem acento, só A-Z 0-9 espaço . , - / ( ). O que não é aceito vira espaço."""
    s = unicodedata.normalize("NFKD", str(valor or "")).encode("ascii", "ignore").decode("ascii").upper()
    s = _FORA_DO_PADRAO.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


@dataclass(frozen=True)
class Field:
    nome: str
    inicio: int  # posição inicial, contando de 1 (como no manual do banco)
    fim: int
    tipo: str
    dec: int = 0
    default: Any = None

    def __post_init__(self):
        if self.tipo not in TIPOS:
            raise LayoutInvalido(f"{self.nome}: tipo '{self.tipo}' desconhecido.")
        if self.inicio < 1 or self.fim < self.inicio:
            raise LayoutInvalido(f"{self.nome}: posições {self.inicio}-{self.fim} inválidas.")
        if self.tipo == "D" and self.tamanho != 8:
            raise LayoutInvalido(f"{self.nome}: data ocupa 8 posições (DDMMAAAA), não {self.tamanho}.")
        if self.dec and self.tipo != "N":
            raise LayoutInvalido(f"{self.nome}: só campo numérico tem casas decimais.")

    @property
    def tamanho(self) -> int:
        return self.fim - self.inicio + 1

    # ------------------------------------------------------------------ escrita (remessa)
    def formatar(self, valor: Any = None) -> str:
        if valor is None:
            valor = self.default
        if self.tipo == "B":
            return " " * self.tamanho
        if self.tipo == "N":
            return self._numero(valor)
        if self.tipo == "D":
            return self._data(valor)
        if self.tipo == "X":
            s = "" if valor is None else str(valor)
            if len(s) > self.tamanho:
                raise ValorNaoCabe(f"{self.nome}: '{s}' tem {len(s)} caracteres e o campo aceita {self.tamanho}.")
            return s.ljust(self.tamanho)
        s = limpar_texto(valor)
        if len(s) > self.tamanho:
            log.warning("CNAB: campo %s cortado de %d para %d caracteres: %r", self.nome, len(s), self.tamanho, s)
            s = s[: self.tamanho]
        return s.ljust(self.tamanho)

    def _numero(self, valor: Any) -> str:
        if valor is None or valor == "":
            valor = 0
        if isinstance(valor, bool):
            raise ValorNaoCabe(f"{self.nome}: verdadeiro/falso não é número.")
        if self.dec:
            if isinstance(valor, float):
                raise ValorNaoCabe(f"{self.nome}: use Decimal para dinheiro, nunca float.")
            d = Decimal(str(valor)) if not isinstance(valor, Decimal) else valor
            if d < 0:
                raise ValorNaoCabe(f"{self.nome}: valor negativo ({d}).")
            inteiro = int((d * (10 ** self.dec)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
            s = str(inteiro)
        elif isinstance(valor, int):
            if valor < 0:
                raise ValorNaoCabe(f"{self.nome}: valor negativo ({valor}).")
            s = str(valor)
        else:
            s = str(valor).strip()
            if not s.isdigit():
                raise ValorNaoCabe(f"{self.nome}: '{valor}' não é numérico.")
        if len(s) > self.tamanho:
            raise ValorNaoCabe(f"{self.nome}: {s} tem {len(s)} dígitos e o campo aceita {self.tamanho}.")
        return s.zfill(self.tamanho)

    def _data(self, valor: Any) -> str:
        if valor in (None, "", 0, "0"):
            return "0" * 8
        if isinstance(valor, datetime):
            valor = valor.date()
        if not isinstance(valor, date):
            raise ValorNaoCabe(f"{self.nome}: '{valor}' não é uma data.")
        return f"{valor:%d%m%Y}"

    # ------------------------------------------------------------------ leitura (retorno)
    def ler(self, linha: str) -> Any:
        bruto = linha[self.inicio - 1: self.fim]
        if self.tipo == "B":
            return None
        if self.tipo == "N":
            digitos = bruto.strip()
            if not digitos:
                return Decimal(0) if self.dec else 0
            if not digitos.isdigit():
                raise ValorNaoCabe(f"{self.nome}: '{bruto}' não é numérico (posições {self.inicio}-{self.fim}).")
            return Decimal(int(digitos)).scaleb(-self.dec) if self.dec else int(digitos)
        if self.tipo == "D":
            digitos = bruto.strip()
            if not digitos or set(digitos) == {"0"}:
                return None
            try:
                return datetime.strptime(digitos, "%d%m%Y").date()
            except ValueError:
                return None  # banco manda lixo em data opcional: tratar como vazia, não derrubar o arquivo
        return bruto.rstrip() if self.tipo == "X" else bruto.strip()
