"""Bancos disponíveis. Um banco novo é só mais uma linha aqui (e o pacote dele ao lado)."""

from app.modules.boletos.bancos.base import BancoBase
from app.modules.boletos.bancos.bradesco import BradescoCNAB240
from app.modules.boletos.bancos.santander import SantanderCNAB240

_BANCOS: dict[str, type[BancoBase]] = {
    SantanderCNAB240.codigo: SantanderCNAB240,
    BradescoCNAB240.codigo: BradescoCNAB240,
}


class BancoNaoSuportado(Exception):
    pass


def get_banco(codigo: str) -> BancoBase:
    try:
        return _BANCOS[str(codigo).zfill(3)]()
    except KeyError:
        raise BancoNaoSuportado(f"O banco {codigo} ainda não tem cobrança por CNAB 240 no sistema.") from None


def bancos_disponiveis() -> list[BancoBase]:
    return [cls() for cls in _BANCOS.values()]
