"""Código de barras Intercalado 2 de 5 (ITF), o do boleto.

Cada dígito são 5 elementos, 2 largos e 3 estreitos. Os dígitos andam em pares: o primeiro vai nas barras,
o segundo nos espaços entre elas. Início = 4 estreitos (barra, espaço, barra, espaço); fim = barra larga,
espaço estreito, barra estreita.
"""

PADROES = {
    "0": "00110", "1": "10001", "2": "01001", "3": "11000", "4": "00101",
    "5": "10100", "6": "01100", "7": "00011", "8": "10010", "9": "01010",
}
RAZAO = 3  # barra larga = 3 estreitas (padrão FEBRABAN)


def elementos(digitos: str) -> list[tuple[bool, int]]:
    """Sequência (é_barra, largura em módulos) do código inteiro, com início e fim."""
    if not digitos.isdigit():
        raise ValueError("O código de barras ITF só aceita dígitos.")
    if len(digitos) % 2:
        raise ValueError("O código de barras ITF precisa de um número par de dígitos.")
    seq: list[tuple[bool, int]] = [(True, 1), (False, 1), (True, 1), (False, 1)]
    for i in range(0, len(digitos), 2):
        barras, espacos = PADROES[digitos[i]], PADROES[digitos[i + 1]]
        for b, e in zip(barras, espacos, strict=True):
            seq.append((True, RAZAO if b == "1" else 1))
            seq.append((False, RAZAO if e == "1" else 1))
    seq += [(True, RAZAO), (False, 1), (True, 1)]
    return seq


def largura_em_modulos(digitos: str) -> int:
    return sum(w for _, w in elementos(digitos))


def desenhar(canvas, digitos: str, x: float, y: float, largura: float, altura: float) -> None:
    """Desenha o código no canvas do ReportLab ocupando exatamente `largura` × `altura` (em pontos)."""
    seq = elementos(digitos)
    modulo = largura / sum(w for _, w in seq)
    canvas.saveState()
    canvas.setFillColorRGB(0, 0, 0)
    pos = x
    for barra, w in seq:
        if barra:
            canvas.rect(pos, y, w * modulo, altura, stroke=0, fill=1)
        pos += w * modulo
    canvas.restoreState()
