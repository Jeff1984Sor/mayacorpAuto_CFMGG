"""Boletos registrados por arquivo CNAB 240 (remessa/retorno), sem API bancária.

O núcleo (`cnab/`) é genérico; cada banco é um adaptador em `bancos/` (o Santander é o primeiro).
Especificação: SPEC_CNAB240_SANTANDER.md na raiz do projeto.
"""
