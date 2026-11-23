class CnabError(Exception):
    """Qualquer problema de montagem ou leitura de arquivo CNAB."""


class LayoutInvalido(CnabError):
    """O layout declarado tem buraco, sobreposição ou não fecha em 240 posições."""


class ValorNaoCabe(CnabError):
    """Um número não cabe no campo. Número nunca é truncado: cortar dígito muda o valor."""


class LinhaInvalida(CnabError):
    """Linha do arquivo fora do padrão (tamanho, banco, tipo de registro)."""
