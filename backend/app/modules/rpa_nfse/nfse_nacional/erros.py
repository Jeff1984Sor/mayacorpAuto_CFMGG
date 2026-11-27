"""Mensagens do Sistema Nacional NFS-e em português claro, com o que fazer.

TODO [CONFIRMAR com o Anexo I (regras de negócio) durante a homologação]: mapa inicial com os códigos mais
comuns; código fora da lista aparece com o texto original do governo.
"""

CONHECIDOS: dict[str, tuple[str, str]] = {
    "E0714": ("A assinatura digital da nota não foi aceita.",
              "Confira se o certificado é do mesmo CNPJ da empresa emissora e se está válido."),
    "E0004": ("O certificado usado na conexão não é do emissor da nota.",
              "Envie o certificado digital da própria empresa emissora."),
    "E0014": ("Esta DPS já foi usada em outra nota.", "A nota já existe: consulte-a em vez de emitir de novo."),
    "E0138": ("O código do serviço não é aceito para esta empresa neste município.",
              "Confira o código de tributação nacional no cadastro da empresa emissora."),
    "E0312": ("O município da empresa emissora não está apto a emitir pelo Sistema Nacional.",
              "Confirme no portal da NFS-e se o município está conveniado."),
}


def traduzir(codigo: str | None, descricao: str, complemento: str | None = None) -> dict:
    mensagem, acao = CONHECIDOS.get((codigo or "").upper(), (descricao, ""))
    detalhe = " ".join(x for x in [descricao if mensagem != descricao else "", complemento or ""] if x).strip()
    return {"codigo": codigo, "mensagem": mensagem, "acao": acao, "detalhe": detalhe or None}
