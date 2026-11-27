"""Camada isolada de integração com a NFS-e de São Paulo.

Quando a Prefeitura mudar o layout, só este pacote muda. Para outros municípios ou a NFS-e Nacional,
basta um pacote irmão expondo a mesma interface (ClientePrefeitura.enviar_lote/cancelar/consultar_*).
"""

from app.modules.rpa_nfse.prefeitura_sp import simulador, xml_layout2
from app.modules.rpa_nfse.prefeitura_sp.cliente import ClientePrefeitura, FalhaComunicacao, Retorno
from app.modules.rpa_nfse.prefeitura_sp.xml_layout2 import RpsXml

__all__ = ["ClientePrefeitura", "FalhaComunicacao", "Retorno", "RpsXml", "simulador", "xml_layout2"]


def link_da_nfse(nota) -> str:
    """Onde a nota é conferida: no portal da Prefeitura de SP ou na consulta pública do Sistema Nacional."""
    if getattr(nota, "chave_acesso", None):
        from app.modules.rpa_nfse.nfse_nacional.emissao import link

        return link(nota.chave_acesso)
    return link_nota(nota.emissora.ccm, nota.numero, nota.cod_verificacao)


def link_nota(ccm: str, numero: int, cod_verificacao: str) -> str:
    return (
        "https://nfe.prefeitura.sp.gov.br/contribuinte/notaprint.aspx"
        f"?ccm={ccm}&nf={numero}&cod={cod_verificacao.replace('-', '')}"
    )
