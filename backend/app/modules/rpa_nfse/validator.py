"""Pré-validação linha a linha, antes de qualquer transmissão (seção 7.1 da especificação)."""

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from app.core.documentos import cep_valido, cnpj_valido, cpf_valido, so_digitos
from app.modules.rpa_nfse.models import Emissora, ParametroFiscal, Rps, StatusRps

CAMPOS_LAYOUT2 = {
    "nbs": "Código NBS",
    "class_trib": "Classificação tributária (cClassTrib)",
    "ind_operacao": "Indicador da operação (cIndOp)",
}

UFS = set(
    "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split()
)


def calcular_iss(valor: Decimal, deducoes: Decimal, aliquota: Decimal) -> Decimal:
    base = max(valor - deducoes, Decimal(0))
    return (base * aliquota).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def resolver_parametros(
    parametros: list[ParametroFiscal], cod_servico: str, tomador_id: int | None
) -> dict[str, str | None]:
    """Mescla padrão → regra por serviço → regra por tomador (a mais específica vence)."""
    ordem = {"padrao": 0, "servico": 1, "tomador": 2}
    aplicaveis = [
        p
        for p in parametros
        if p.ativo
        and (
            p.escopo == "padrao"
            or (p.escopo == "servico" and p.cod_servico == cod_servico)
            or (p.escopo == "tomador" and tomador_id and p.tomador_id == tomador_id)
        )
    ]
    aplicaveis.sort(key=lambda p: (ordem[p.escopo], p.prioridade))
    resultado: dict[str, str | None] = {}
    for p in aplicaveis:
        for campo in (
            "nbs",
            "cst_ibscbs",
            "class_trib",
            "ind_operacao",
            "finalidade",
            "ind_final",
            "tipo_operacao",
            "ind_destinatario",
            "tributacao_rps",
        ):
            v = getattr(p, campo)
            if v not in (None, ""):
                resultado[campo] = v
        if p.aliquota_iss is not None:
            resultado["aliquota_iss"] = str(p.aliquota_iss)
    return resultado


@dataclass
class ContextoValidacao:
    emissora: Emissora
    parametros: list[ParametroFiscal]
    servicos_permitidos: set[str]
    # chave "serie:numero" -> (nfse_id, número da NFS-e) já emitida ou na fila (0, 0)
    ja_emitidos: dict[str, tuple[int, int]] = field(default_factory=dict)
    hoje: date = field(default_factory=date.today)


def _p(campo: str, nivel: str, mensagem: str) -> dict:
    return {"campo": campo, "nivel": nivel, "mensagem": mensagem}


def validar(rps: Rps, ctx: ContextoValidacao, duplicados_no_arquivo: set[str] | None = None) -> None:
    """Preenche rps.erros_json, rps.status, rps.iss e os campos do layout 2 em rps.dados_json."""
    if rps.status in (StatusRps.descartado, StatusRps.emitido):
        return
    problemas: list[dict[str, str]] = [
        _p("arquivo", "erro", m) for m in (rps.dados_json or {}).get("problemas_leitura", [])
    ]
    tom = dict((rps.dados_json or {}).get("tomador", {}))
    chave = f"{rps.serie}:{rps.numero}"

    # ---- Duplicidade / idempotência
    if chave in ctx.ja_emitidos:
        nfse_id, nfse_numero = ctx.ja_emitidos[chave]
        p = _p("numero", "erro", f"Este recibo já virou nota (NFS-e nº {nfse_numero}).")
        p.update({"acao": "Abrir a nota existente →", "nfse_id": nfse_id})
        problemas.append(p)
    if duplicados_no_arquivo and chave in duplicados_no_arquivo:
        problemas.append(_p("numero", "erro", "O mesmo RPS (série + número) aparece mais de uma vez no arquivo."))
    if not rps.serie:
        problemas.append(_p("serie", "erro", "Série do RPS em branco."))

    # ---- Datas
    if rps.data_emissao > ctx.hoje:
        problemas.append(_p("data_emissao", "erro", "A data de emissão está no futuro."))
    elif (ctx.hoje - rps.data_emissao).days > 180:
        problemas.append(_p("data_emissao", "aviso", "Competência com mais de 6 meses. Confira a data."))

    # ---- Valores
    if rps.valor <= 0:
        problemas.append(_p("valor", "erro", "O valor do serviço precisa ser maior que zero."))
    if rps.deducoes < 0:
        problemas.append(_p("deducoes", "erro", "Deduções não podem ser negativas."))
    if rps.deducoes > rps.valor:
        problemas.append(_p("deducoes", "erro", "As deduções são maiores que o valor do serviço."))

    # ---- Serviço e alíquota
    cod = so_digitos(rps.cod_servico)
    if len(cod) != 5:
        problemas.append(_p("cod_servico", "erro", "Código de serviço deve ter 5 dígitos."))
    elif ctx.servicos_permitidos and cod not in ctx.servicos_permitidos:
        problemas.append(
            _p("cod_servico", "aviso", f"O código {cod} não está entre os serviços configurados para a emissora.")
        )

    params = resolver_parametros(ctx.parametros, cod, rps.tomador_id)
    if rps.aliquota == 0 and params.get("aliquota_iss"):
        rps.aliquota = Decimal(params["aliquota_iss"])
    if rps.aliquota == 0 and ctx.emissora.aliquota_iss:
        rps.aliquota = ctx.emissora.aliquota_iss
    if not (Decimal("0.02") <= rps.aliquota <= Decimal("0.05")):
        problemas.append(_p("aliquota", "erro", "Alíquota de ISS fora da faixa legal (2% a 5%)."))
    elif ctx.emissora.aliquota_iss and rps.aliquota != ctx.emissora.aliquota_iss:
        problemas.append(
            _p(
                "aliquota",
                "aviso",
                f"Alíquota {rps.aliquota * 100:.2f}% diferente da padrão da emissora "
                f"({ctx.emissora.aliquota_iss * 100:.2f}%).",
            )
        )
    rps.iss = calcular_iss(rps.valor, rps.deducoes, rps.aliquota)

    # ---- Tomador
    doc = so_digitos(tom.get("cpf_cnpj"))
    if not tom.get("nome"):
        problemas.append(_p("tomador.nome", "erro", "Nome do cliente em branco."))
    if tom.get("tipo") == "PF":
        if not cpf_valido(doc):
            problemas.append(_p("tomador.cpf_cnpj", "erro", "O CPF do cliente está incorreto."))
    elif tom.get("tipo") == "PJ":
        if not cnpj_valido(doc):
            problemas.append(_p("tomador.cpf_cnpj", "erro", "O CNPJ do cliente está incorreto."))
    else:
        problemas.append(_p("tomador.cpf_cnpj", "aviso", "Cliente sem CPF/CNPJ informado."))

    if tom.get("cep") and not cep_valido(tom.get("cep")):
        problemas.append(_p("tomador.cep", "erro", "CEP do cliente inválido."))
    elif not tom.get("cep"):
        problemas.append(_p("tomador.cep", "aviso", "Cliente sem CEP."))
    if tom.get("uf") and tom["uf"].upper() not in UFS:
        problemas.append(_p("tomador.uf", "erro", f"UF '{tom['uf']}' inválida."))
    if not tom.get("email"):
        problemas.append(_p("tomador.email", "aviso", "Cliente sem e-mail: a nota não poderá ser enviada a ele."))
    if rps.tomador_novo:
        problemas.append(_p("tomador", "aviso", "Tomador novo: será cadastrado automaticamente."))

    # ---- Layout 2 (IBS/CBS)
    for campo, rotulo in CAMPOS_LAYOUT2.items():
        if not params.get(campo):
            problemas.append(
                _p(campo, "erro", f"{rotulo} não definido. Configure em Configurações › Parâmetros Fiscais.")
            )

    dados = dict(rps.dados_json or {})
    dados["layout2"] = params
    rps.dados_json = dados
    rps.erros_json = problemas
    if any(p["nivel"] == "erro" for p in problemas):
        rps.status = StatusRps.erro
    elif problemas:
        rps.status = StatusRps.aviso
    else:
        rps.status = StatusRps.ok
