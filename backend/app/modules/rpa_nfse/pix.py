"""PIX "copia e cola" (BR Code estático, padrão EMV do Banco Central) com o valor da fatura.

O cliente aponta a câmera do app do banco para o QR da fatura e o pagamento já vem preenchido.
"""

import unicodedata
from decimal import Decimal


def _campo(id_: str, valor: str) -> str:
    return f"{id_}{len(valor):02d}{valor}"


def _limpo(txt: str, tam: int) -> str:
    t = unicodedata.normalize("NFKD", txt or "").encode("ascii", "ignore").decode().upper()
    return "".join(c for c in t if c.isalnum() or c == " ").strip()[:tam] or "NA"


def _crc16(payload: str) -> str:
    crc = 0xFFFF
    for b in payload.encode():
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def br_code(chave: str, nome: str, cidade: str, valor: Decimal, txid: str = "***") -> str:
    conta = _campo("00", "br.gov.bcb.pix") + _campo("01", chave.strip())
    txid = "".join(c for c in txid if c.isalnum())[:25] or "***"
    payload = (
        _campo("00", "01")
        + _campo("26", conta)
        + _campo("52", "0000")
        + _campo("53", "986")
        + _campo("54", f"{Decimal(valor):.2f}")
        + _campo("58", "BR")
        + _campo("59", _limpo(nome, 25))
        + _campo("60", _limpo(cidade, 15))
        + _campo("62", _campo("05", txid))
        + "6304"
    )
    return payload + _crc16(payload)
