"""Camada isolada de integração com a NFS-e de São Paulo.

Quando a Prefeitura mudar o layout, só este pacote muda. Para outros municípios ou a NFS-e Nacional,
basta um pacote irmão expondo a mesma interface (ClientePrefeitura.enviar_lote/cancelar/consultar_*).
"""

from app.modules.rpa_nfse.prefeitura_sp import simulador, xml_layout2
from app.modules.rpa_nfse.prefeitura_sp.cliente import ClientePrefeitura, FalhaComunicacao, Retorno
from app.modules.rpa_nfse.prefeitura_sp.xml_layout2 import RpsXml

__all__ = ["ClientePrefeitura", "FalhaComunicacao", "Retorno", "RpsXml", "simulador", "xml_layout2"]


def link_nota(ccm: str, numero: int, cod_verificacao: str) -> str:
    return (
        "https://nfe.prefeitura.sp.gov.br/contribuinte/notaprint.aspx"
        f"?ccm={ccm}&nf={numero}&cod={cod_verificacao.replace('-', '')}"
    )
