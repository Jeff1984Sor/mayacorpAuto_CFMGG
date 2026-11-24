"""Leitura do retorno CNAB 240 que vale para qualquer banco: um par de Segmentos T + U por ocorrência.

Cada banco entrega só o que é dele: o layout do T e do U, as tabelas de códigos e como ler o nosso número.
"""

from collections.abc import Callable
from datetime import datetime

from app.modules.boletos.bancos.base import OcorrenciaRetorno, RetornoLido
from app.modules.boletos.cnab.exceptions import CnabError, LinhaInvalida
from app.modules.boletos.cnab.record import Record
from app.modules.boletos.cnab.validators import conferir_estrutura, segmento, separar, tipo_registro


def _data(ddmmaaaa: str):
    d = ddmmaaaa.strip()
    if not d or set(d) == {"0"}:
        return None
    try:
        return datetime.strptime(d, "%d%m%Y").date()
    except ValueError:
        return None


def _inteiro(texto: str) -> int:
    t = texto.strip()
    return int(t) if t.isdigit() else 0


def ler_retorno(conteudo: bytes, *, banco: str, nome_banco: str, seg_t: type[Record], seg_u: type[Record],
                nosso_numero: Callable[[dict], str], descrever_movimento: Callable[[str], str],
                separar_motivos: Callable[[str], list[str]], descrever_motivos: Callable[[list[str]], list[dict]],
                agencia_conta: Callable[[str], tuple[str, str]]) -> RetornoLido:
    linhas = separar(conteudo)
    header = linhas[0]
    if tipo_registro(header) != "0":
        raise LinhaInvalida("A primeira linha não é o header do arquivo. Este não parece um retorno CNAB 240.")
    if header[0:3] != banco:
        raise LinhaInvalida(f"Este arquivo é do banco {header[0:3]}, não do {nome_banco} ({banco}).")
    if header[142] == "1":
        raise LinhaInvalida("Este é um arquivo de remessa (o que vai para o banco), não o retorno do banco.")
    if header[142] != "2":
        raise LinhaInvalida("O arquivo não está marcado como retorno (posição 143 do header).")

    avisos: list[str] = []
    try:
        conferir_estrutura(linhas)
    except CnabError as e:  # contagem do banco não fecha: avisa, mas lê o que veio
        avisos.append(str(e))

    ocorrencias: list[OcorrenciaRetorno] = []
    atual: tuple[dict, str] | None = None  # (campos do T, linha T)

    def fechar(t: dict, linha_t: str, u: dict | None, linha_u: str) -> None:
        motivos = separar_motivos(t["motivos"])
        codigo = (t["codigo_movimento"] or "").zfill(2)
        ocorrencias.append(OcorrenciaRetorno(
            codigo_movimento=codigo, descricao=descrever_movimento(codigo), nosso_numero=nosso_numero(t),
            id_empresa=t["id_empresa"], seu_numero=t["seu_numero"],
            vencimento=t["vencimento"], valor=t["valor"], tarifa=t["tarifa"],
            motivos=motivos, motivos_descricao=descrever_motivos(motivos),
            valor_pago=u["valor_pago"] if u else 0, valor_liquido=u["valor_liquido"] if u else 0,
            juros_multa=u["juros_multa"] if u else 0, desconto=u["desconto"] if u else 0,
            abatimento=u["abatimento"] if u else 0,
            data_ocorrencia=u["data_ocorrencia"] if u else None, data_credito=u["data_credito"] if u else None,
            pagador_nome=t["pagador_nome"], pagador_documento=str(t["pagador_inscricao"] or ""),
            sequencial=t["sequencial"], payload_bruto=linha_t + ("\n" + linha_u if linha_u else ""),
        ))

    for n, linha in enumerate(linhas, 1):
        if tipo_registro(linha) != "3":
            continue
        seg = segmento(linha)
        if seg == "T":
            if atual:  # T sem U: registra assim mesmo
                avisos.append(f"Linha {n - 1}: Segmento T sem o Segmento U correspondente.")
                fechar(atual[0], atual[1], None, "")
            atual = (seg_t.ler(linha), linha)
        elif seg == "U":
            if not atual:
                avisos.append(f"Linha {n}: Segmento U sem o Segmento T antes dele (ignorado).")
                continue
            fechar(atual[0], atual[1], seg_u.ler(linha), linha)
            atual = None
        else:
            avisos.append(f"Linha {n}: Segmento {seg} não é tratado (ignorado).")
    if atual:
        avisos.append("Último Segmento T sem o Segmento U correspondente.")
        fechar(atual[0], atual[1], None, "")

    primeiro_t = next((ln for ln in linhas if tipo_registro(ln) == "3" and segmento(ln) == "T"), None)
    agencia, conta = agencia_conta(primeiro_t) if primeiro_t else ("", "")
    return RetornoLido(banco=banco, agencia=agencia, conta=conta, data_geracao=_data(header[143:151]),
                       sequencial_arquivo=_inteiro(header[157:163]), ocorrencias=ocorrencias, avisos=avisos)
