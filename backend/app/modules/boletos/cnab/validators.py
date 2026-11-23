"""Conferências do arquivo inteiro: tamanho das linhas, fim de linha, estrutura e contagens dos trailers."""

from app.modules.boletos.cnab.exceptions import LinhaInvalida
from app.modules.boletos.cnab.record import TAMANHO

FIM_DE_LINHA = "\r\n"
ENCODING = "latin-1"


def juntar(linhas: list[str]) -> bytes:
    """Linhas → bytes do arquivo: CRLF depois de cada registro, inclusive o último."""
    for n, linha in enumerate(linhas, 1):
        if len(linha) != TAMANHO:
            raise LinhaInvalida(f"Linha {n} com {len(linha)} posições (o correto é {TAMANHO}).")
    return (FIM_DE_LINHA.join(linhas) + FIM_DE_LINHA).encode(ENCODING)


def separar(conteudo: bytes) -> list[str]:
    """Bytes do arquivo → linhas de 240. Aceita CRLF ou LF, linha em branco no fim e o caractere de fim de arquivo."""
    texto = conteudo.decode(ENCODING).replace("\x1a", "")
    linhas = [ln for ln in texto.replace("\r\n", "\n").replace("\r", "\n").split("\n") if ln.strip()]
    if not linhas:
        raise LinhaInvalida("O arquivo está vazio.")
    for n, linha in enumerate(linhas, 1):
        if len(linha) != TAMANHO:
            raise LinhaInvalida(
                f"Linha {n} com {len(linha)} posições (o correto é {TAMANHO}). Este não parece um arquivo CNAB 240.")
    return linhas


def tipo_registro(linha: str) -> str:
    return linha[7]


def segmento(linha: str) -> str:
    return linha[13]


def conferir_estrutura(linhas: list[str]) -> None:
    """Header de arquivo, lotes (header … trailer) e trailer de arquivo, com as contagens batendo."""
    if tipo_registro(linhas[0]) != "0":
        raise LinhaInvalida("A primeira linha não é o header do arquivo (tipo 0).")
    if tipo_registro(linhas[-1]) != "9":
        raise LinhaInvalida("A última linha não é o trailer do arquivo (tipo 9).")
    lotes = 0
    dentro = None  # índice do header do lote aberto
    for i, linha in enumerate(linhas[1:-1], 1):
        t = tipo_registro(linha)
        if t == "1":
            if dentro is not None:
                raise LinhaInvalida(f"Linha {i + 1}: lote aberto sem fechar o anterior.")
            dentro, lotes = i, lotes + 1
        elif t == "3":
            if dentro is None:
                raise LinhaInvalida(f"Linha {i + 1}: registro de detalhe fora de um lote.")
        elif t == "5":
            if dentro is None:
                raise LinhaInvalida(f"Linha {i + 1}: trailer de lote sem header.")
            qtd = int(linha[17:23] or 0)
            real = i - dentro + 1
            if qtd != real:
                raise LinhaInvalida(f"Lote {lotes}: o trailer diz {qtd} registros, mas o lote tem {real}.")
            dentro = None
        else:
            raise LinhaInvalida(f"Linha {i + 1}: tipo de registro '{t}' inesperado.")
    if dentro is not None:
        raise LinhaInvalida("Lote sem trailer.")
    fim = linhas[-1]
    if int(fim[17:23] or 0) != lotes:
        raise LinhaInvalida(f"O trailer do arquivo diz {int(fim[17:23] or 0)} lote(s), mas há {lotes}.")
    if int(fim[23:29] or 0) != len(linhas):
        raise LinhaInvalida(f"O trailer do arquivo diz {int(fim[23:29] or 0)} registros, mas há {len(linhas)}.")
