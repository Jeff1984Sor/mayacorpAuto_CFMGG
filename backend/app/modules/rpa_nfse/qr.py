"""QR Code desenhado direto no PDF.

O QrCodeWidget do ReportLab cria um objeto gráfico por módulo (e mede tudo duas vezes): era metade do
tempo de emissão de um lote. Aqui o QR é desenhado em faixas horizontais contínuas, o mesmo resultado
visual, dezenas de vezes mais rápido.
"""

from reportlab.graphics.barcode import qrencoder
from reportlab.platypus import Flowable


def matriz(texto: str) -> list[list[bool]]:
    q = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)  # None = versão automática
    q.addData(texto)
    # make() testaria as 8 máscaras para escolher a "mais bonita" (Python puro, caro). Qualquer máscara
    # gera um QR válido e legível; fixar a 0 corta esse custo.
    q.version = q.calculate_version()
    q.makeImpl(False, 0)
    n = q.getModuleCount()
    return [[q.isDark(r, c) for c in range(n)] for r in range(n)]


def desenhar(canvas, texto: str, x: float, y: float, tamanho: float, margem: int = 2) -> None:
    """Desenha o QR com o canto inferior esquerdo em (x, y), ocupando tamanho × tamanho."""
    m = matriz(texto)
    n = len(m) + 2 * margem
    passo = tamanho / n
    canvas.saveState()
    canvas.setFillColorRGB(1, 1, 1)
    canvas.rect(x, y, tamanho, tamanho, stroke=0, fill=1)
    canvas.setFillColorRGB(0, 0, 0)
    for r, linha in enumerate(m):
        yy = y + tamanho - (r + margem + 1) * passo
        c = 0
        while c < len(linha):
            if linha[c]:
                ini = c
                while c < len(linha) and linha[c]:
                    c += 1
                canvas.rect(x + (ini + margem) * passo, yy, (c - ini) * passo, passo, stroke=0, fill=1)
            else:
                c += 1
    canvas.restoreState()


class QrFlowable(Flowable):
    """Versão para documentos montados com platypus (a fatura)."""

    def __init__(self, texto: str, tamanho: float):
        super().__init__()
        self.texto, self.width, self.height = texto, tamanho, tamanho

    def draw(self):
        desenhar(self.canv, self.texto, 0, 0, self.width)
