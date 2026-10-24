"""Tradução dos códigos de retorno da Prefeitura para português claro + ação sugerida (seção 7.4).

Mapeamento inicial: os códigos devem ser conferidos com a tabela de erros do Manual v3.3.4 e
das NTs 003/004 durante a homologação. Códigos desconhecidos caem no texto genérico + descrição técnica.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ErroHumano:
    mensagem: str
    acao: str
    campo: str | None = None


MAPA: dict[int, ErroHumano] = {
    1057: ErroHumano(
        "O certificado não conseguiu assinar esta nota.",
        "Verifique se ele está válido em Configurações › Certificado.",
    ),
    1206: ErroHumano(
        "A assinatura do recibo não confere.",
        "Confira se o certificado ativo é da empresa emissora.",
    ),
    1101: ErroHumano("O CNPJ do cliente está incorreto.", "Corrija o cadastro e reenvie.", "tomador.cpf_cnpj"),
    1102: ErroHumano("O CPF do cliente está incorreto.", "Corrija o cadastro e reenvie.", "tomador.cpf_cnpj"),
    1112: ErroHumano("O CEP do cliente não existe.", "Corrija o CEP e reenvie.", "tomador.cep"),
    1209: ErroHumano("Este recibo já virou nota.", "Abrir a nota existente →", "numero"),
    1211: ErroHumano(
        "O código de serviço não é permitido para a empresa.",
        "Confira o código no cadastro da emissora ou nos parâmetros fiscais.",
        "cod_servico",
    ),
    1214: ErroHumano("A alíquota informada não confere com o código de serviço.", "Corrija a alíquota.", "aliquota"),
    1223: ErroHumano("A data do recibo está fora do período permitido.", "Corrija a data de emissão.", "data_emissao"),
    1301: ErroHumano("O CCM da empresa emissora não está habilitado para emitir NFS-e.", "Fale com o contador."),
    1306: ErroHumano("O certificado não pertence ao CNPJ remetente.", "Ative o certificado correto."),
    1601: ErroHumano(
        "A Prefeitura não aceitou os campos de IBS/CBS.",
        "Revise CST, classificação tributária e NBS em Parâmetros Fiscais.",
        "class_trib",
    ),
    1602: ErroHumano("O código NBS informado não existe.", "Corrija o NBS em Parâmetros Fiscais.", "nbs"),
    1603: ErroHumano("A classificação tributária (cClassTrib) não combina com o CST.", "Revise os parâmetros.", "class_trib"),
    1404: ErroHumano("Esta nota já está cancelada.", "Nenhuma ação necessária."),
    1405: ErroHumano(
        "O prazo de cancelamento desta nota já passou.",
        "Cancele pelo portal da Prefeitura com processo administrativo, ou emita nota de substituição.",
    ),
}


def humanizar(codigo: int | None, descricao_tecnica: str) -> ErroHumano:
    if codigo is not None and codigo in MAPA:
        return MAPA[codigo]
    d = descricao_tecnica.lower()
    if "assinatura" in d:
        return MAPA[1057]
    if "cnpj" in d and "tomador" in d:
        return MAPA[1101]
    if "cpf" in d and "tomador" in d:
        return MAPA[1102]
    if "já convertido" in d or "ja convertido" in d:
        return MAPA[1209]
    return ErroHumano(
        f"A Prefeitura recusou este recibo: {descricao_tecnica}",
        "Corrija os dados indicados e reenvie. Se persistir, fale com a MayaCorp.",
    )
