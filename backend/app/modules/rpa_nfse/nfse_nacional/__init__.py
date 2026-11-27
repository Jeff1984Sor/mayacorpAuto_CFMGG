"""Emissão pelo Sistema Nacional NFS-e (o "Emissor Nacional" do gov.br), para emissor de qualquer município.

Pacote irmão do prefeitura_sp: a empresa emissora escolhe por onde a nota sai. Aqui a nota nasce de uma DPS
(dps.py), vai por API com o certificado do emissor (cliente.py) e volta com a chave de acesso de 50 dígitos.
"""
