"""Modo simulado do Emissor Nacional: devolve uma nota de mentira, sem falar com o governo."""

import hashlib

from lxml import etree

from app.modules.rpa_nfse.nfse_nacional.cliente import RetornoNacional


def emitir(dps_xml: bytes) -> RetornoNacional:
    raiz = etree.fromstring(dps_xml)
    id_dps = raiz[0].get("Id", "")
    numero = int(id_dps[-15:] or 1)
    # chave de 50 dígitos, sempre a mesma para a mesma DPS (não é uma chave real)
    sorteio = str(int(hashlib.sha256(id_dps.encode()).hexdigest(), 16))
    # mesmo formato da chave real: município (7) + 2 + tipo e inscrição (15) + 27 dígitos
    chave = (id_dps[3:10] + "2" + id_dps[10:25] + sorteio)[:50].ljust(50, "0")
    return RetornoNacional(sucesso=True, chave_acesso=chave, numero=numero, id_dps=id_dps, xml=dps_xml, simulado=True, http=201)
