"""Projeção de impostos por empresa emissora: Simples Nacional (DAS) ou Lucro Presumido (PIS, COFINS, ISS, IRPJ, CSLL).

Reforma tributária (EC 132/2023, LC 214/2025): a CBS substitui PIS/COFINS em 2027 e o IBS substitui o ISS de 2029 a 2033.
O mês projetado usa as regras do ano dele (ver `reforma`).

É uma estimativa para planejar o caixa. O valor oficial é o apurado pelo contador (PGDAS / DCTF).
Receita = NFS-e emitidas (competência: data de emissão; caixa: data do pagamento). Notas de Despesas (reembolso) não
entram. O mês corrente soma também as faturas de honorários que ainda vão virar NFS-e.
"""

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.financas.models import ConfigImpostos, ReceitaInformada
from app.modules.financas.service import ZERO, q2, somar_meses

TETO_SIMPLES = Decimal(4_800_000)

# LC 155/2016: limite da faixa (RBT12), alíquota nominal %, parcela a deduzir
TABELAS_SIMPLES = {
    "III": [(180000, 6, 0), (360000, 11.2, 9360), (720000, 13.5, 17640), (1800000, 16, 35640), (3600000, 21, 125640),
            (4800000, 33, 648000)],
    "IV": [(180000, 4.5, 0), (360000, 9, 8100), (720000, 10.2, 12420), (1800000, 14, 39780), (3600000, 22, 183780),
           (4800000, 33, 828000)],
    "V": [(180000, 15.5, 0), (360000, 18, 4500), (720000, 19.5, 9900), (1800000, 20.5, 17100), (3600000, 23, 62100),
          (4800000, 30.5, 540000)],
}


# ISS que ainda vale no ano (o IBS ocupa o resto): EC 132, art. 128
FATOR_ISS = {2029: Decimal("0.9"), 2030: Decimal("0.8"), 2031: Decimal("0.7"), 2032: Decimal("0.6")}


def reforma(ano: int) -> dict:
    """Regras do ano na transição. `teste`: 2026, CBS 0,9% e IBS 0,1% compensados com PIS/COFINS (sem custo)."""
    if ano < 2026:
        return {"fase": "antes", "pis_cofins": True, "iss": Decimal(1)}
    if ano == 2026:
        return {"fase": "teste", "pis_cofins": True, "iss": Decimal(1)}
    if ano <= 2028:  # CBS cheia (referência − 0,1 ponto) e IBS de 0,1%
        return {"fase": "cbs", "pis_cofins": False, "iss": Decimal(1)}
    iss = FATOR_ISS.get(ano, Decimal(0))
    return {"fase": "ibs" if iss else "final", "pis_cofins": False, "iss": iss}


def _ibs_cbs(cfg: ConfigImpostos, ano: int, rec: Decimal) -> tuple[dict, dict]:
    """(impostos que somam, informativos) de CBS e IBS no ano."""
    r = reforma(ano)
    if r["fase"] == "antes":
        return {}, {}
    if r["fase"] == "teste":
        return {}, {"CBS": q2(rec * Decimal("0.9") / 100), "IBS": q2(rec * Decimal("0.1") / 100)}
    fator = (100 - cfg.reducao_ibs_cbs) / 100  # advocacia: profissão regulamentada (LC 214, art. 127)
    if r["fase"] == "cbs":
        cbs, ibs = cfg.aliq_cbs - Decimal("0.1"), Decimal("0.1")
    else:
        cbs, ibs = cfg.aliq_cbs, cfg.aliq_ibs * (1 - r["iss"])
    return {"CBS": q2(rec * cbs * fator / 100), "IBS": q2(rec * ibs * fator / 100)}, {}


def faixas_padrao(anexo: str) -> list[dict]:
    return [{"limite": lim, "aliquota": aliq, "deducao": ded} for lim, aliq, ded in TABELAS_SIMPLES.get(anexo, TABELAS_SIMPLES["IV"])]


def regime_da_emissora(emissora) -> str:
    """O regime vem do cadastro da empresa (Cadastros › Emissoras): é uma fonte só."""
    return {"simples": "simples", "mei": "simples", "presumido": "presumido", "real": "real"}.get(emissora.regime.value, "presumido")


def config(db: Session, tenant_id: int, emissora) -> ConfigImpostos:
    cfg = db.get(ConfigImpostos, emissora.id)
    if not cfg:
        cfg = ConfigImpostos(emissora_id=emissora.id, tenant_id=tenant_id, anexo="IV", faixas=faixas_padrao("IV"))
        db.add(cfg)
        db.flush()
    cfg.regime = regime_da_emissora(emissora)
    if not cfg.faixas:
        cfg.faixas = faixas_padrao(cfg.anexo)
    return cfg


# ---------------------------------------------------------------- receita por mês
def receitas_do_sistema(db: Session, emissora_id: int, regime_receita: str, de: date, ate: date) -> dict[str, Decimal]:
    from app.modules.rpa_nfse.models import Nfse, StatusNfse

    por_mes: dict[str, Decimal] = defaultdict(lambda: ZERO)
    q = select(Nfse).where(Nfse.emissora_id == emissora_id, Nfse.status != StatusNfse.cancelada)
    for n in db.scalars(q):
        quando = n.pago_em if regime_receita == "caixa" else (n.data_emissao.date() if hasattr(n.data_emissao, "date") else n.data_emissao)
        if quando and de <= quando <= ate:
            por_mes[quando.strftime("%Y-%m")] += n.valor
    return por_mes


def a_emitir_no_mes(db: Session, emissora_id: int) -> Decimal:
    """Faturas de honorários em aberto ainda sem NFS-e (viram receita quando a nota sair)."""
    from app.modules.rpa_nfse.models import Fatura, StatusFatura, TipoFatura

    return q2(sum((f.total for f in db.scalars(select(Fatura).where(
        Fatura.emissora_id == emissora_id, Fatura.tipo == TipoFatura.honorarios, Fatura.nfse_id.is_(None),
        Fatura.status == StatusFatura.aberta))), ZERO))


# ---------------------------------------------------------------- cálculo
def faixa_simples(rbt12: Decimal, faixas: list[dict]) -> tuple[int, dict]:
    for i, f in enumerate(faixas):
        if rbt12 <= Decimal(str(f["limite"])):
            return i + 1, f
    return len(faixas), faixas[-1]


def efetiva_simples(rbt12: Decimal, faixas: list[dict]) -> tuple[Decimal, int, dict]:
    n, f = faixa_simples(rbt12, faixas)
    nominal = Decimal(str(f["aliquota"]))
    if rbt12 <= 0:
        return nominal, n, f
    ef = (rbt12 * nominal / 100 - Decimal(str(f["deducao"]))) / rbt12 * 100
    return ef.quantize(Decimal("0.0001")), n, f


def _vencimento(mes: date, dia: int) -> date:
    prox = somar_meses(mes, 1, 1)
    return somar_meses(prox, 0, dia)


def projecao(db: Session, tenant_id: int, emissora, *, metodo: str = "media3", editados: dict[str, Decimal] | None = None) -> dict:
    """24 meses: 12 realizados, o atual (parcial + estimado) e 12 projetados."""
    cfg = config(db, tenant_id, emissora)
    hoje = date.today()
    atual = hoje.replace(day=1)
    inicio_hist = somar_meses(atual, -24, 1)
    sistema = receitas_do_sistema(db, emissora.id, cfg.regime_receita, inicio_hist, hoje)
    informadas = {r.mes.strftime("%Y-%m"): r for r in db.scalars(select(ReceitaInformada).where(ReceitaInformada.emissora_id == emissora.id))}
    editados = editados or {}

    receita: dict[str, Decimal] = {}
    origem: dict[str, str] = {}
    for i in range(24, 0, -1):
        k = somar_meses(atual, -i, 1).strftime("%Y-%m")
        if k in informadas:
            receita[k], origem[k] = informadas[k].valor, "contador"
        else:
            receita[k], origem[k] = q2(sistema.get(k, ZERO)), "sistema"

    def base_media(mes: date, n: int) -> Decimal:
        vals = [receita.get(somar_meses(mes, -j, 1).strftime("%Y-%m"), ZERO) for j in range(1, n + 1)]
        return q2(sum(vals, ZERO) / n)

    k_atual = atual.strftime("%Y-%m")
    faturado_atual = q2(sistema.get(k_atual, ZERO))
    pendente = a_emitir_no_mes(db, emissora.id)
    estimado_atual = max(faturado_atual + pendente, _estimativa(metodo, atual, receita, base_media))
    if k_atual in editados:
        receita[k_atual], origem[k_atual] = q2(editados[k_atual]), "editado"
    elif k_atual in informadas:
        receita[k_atual], origem[k_atual] = informadas[k_atual].valor, "contador"
    else:
        receita[k_atual], origem[k_atual] = estimado_atual, "mes_corrente"
    for i in range(1, 13):
        m = somar_meses(atual, i, 1)
        k = m.strftime("%Y-%m")
        if k in editados:
            receita[k], origem[k] = q2(editados[k]), "editado"
        else:
            receita[k], origem[k] = _estimativa(metodo, m, receita, base_media), "projecao"

    linhas = []
    meses = [somar_meses(atual, i, 1) for i in range(-12, 13)]
    faixa_anterior = None
    for m in meses:
        k = m.strftime("%Y-%m")
        rec = receita.get(k, ZERO)
        linha = {"mes": k, "receita": rec, "origem": origem.get(k, "sistema"), "realizado": m < atual, "atual": m == atual}
        if cfg.regime == "simples":
            rbt12 = q2(sum((receita.get(somar_meses(m, -j, 1).strftime("%Y-%m"), ZERO) for j in range(1, 13)), ZERO))
            ef, n, f = efetiva_simples(rbt12, cfg.faixas)
            das = q2(rec * ef / 100)
            linha.update({"rbt12": rbt12, "faixa": n, "aliquota_nominal": Decimal(str(f["aliquota"])), "aliquota_efetiva": ef,
                          "impostos": {"DAS": das}, "informativos": {}, "total_impostos": das, "vencimento": _vencimento(m, cfg.dia_vencimento_das),
                          "mudou_faixa": faixa_anterior is not None and n != faixa_anterior})
            faixa_anterior = n
        else:
            linha.update(_presumido(cfg, emissora, m, rec, receita))
        linhas.append(linha)

    passado = [linha for linha in linhas if linha["realizado"]]
    futuro = [linha for linha in linhas if not linha["realizado"] and not linha["atual"]]
    atual_l = next(linha for linha in linhas if linha["atual"])
    anterior_l = passado[-1] if passado else None
    resumo = {
        "regime": cfg.regime, "regime_cadastro": emissora.regime.value, "regime_receita": cfg.regime_receita, "anexo": cfg.anexo,
        "faturado_mes_atual": faturado_atual, "a_emitir_mes_atual": pendente, "estimado_mes_atual": atual_l["receita"],
        "imposto_mes_atual": atual_l["total_impostos"],
        "proximo_pagamento": {"valor": anterior_l["total_impostos"], "vencimento": anterior_l["vencimento"]} if anterior_l else None,
        "impostos_12m": q2(sum((linha["total_impostos"] for linha in passado), ZERO)),
        "receita_12m": q2(sum((linha["receita"] for linha in passado), ZERO)),
        "projecao_12m": q2(sum((linha["total_impostos"] for linha in futuro), ZERO)),
        "receita_projetada_12m": q2(sum((linha["receita"] for linha in futuro), ZERO)),
    }
    resumo["carga_12m"] = q2(resumo["impostos_12m"] / resumo["receita_12m"] * 100) if resumo["receita_12m"] else ZERO
    if cfg.regime == "simples":
        rbt12 = atual_l["rbt12"]
        n, f = faixa_simples(rbt12, cfg.faixas)
        resumo.update({"rbt12": rbt12, "faixa": n, "aliquota_efetiva": atual_l["aliquota_efetiva"],
                       "aliquota_nominal": atual_l["aliquota_nominal"],
                       "falta_proxima_faixa": q2(Decimal(str(f["limite"])) - rbt12) if n < len(cfg.faixas) else None,
                       "uso_faixa": q2((rbt12 - (Decimal(str(cfg.faixas[n - 2]["limite"])) if n > 1 else 0)) /
                                       (Decimal(str(f["limite"])) - (Decimal(str(cfg.faixas[n - 2]["limite"])) if n > 1 else 0)) * 100),
                       "uso_teto": q2(rbt12 / TETO_SIMPLES * 100),
                       "muda_faixa_em": next((linha["mes"] for linha in futuro if linha.get("mudou_faixa")), None)})
    return {"emissora_id": emissora.id, "emissora": emissora.razao_social, "metodo": metodo, "resumo": resumo,
            "linhas": list(reversed(linhas)), "config": _config_out(cfg, emissora),
            "receitas_informadas": [{"mes": k, "valor": r.valor, "observacao": r.observacao} for k, r in sorted(informadas.items())],
            "aviso": ("No Anexo IV o INSS patronal (CPP, 20% sobre folha e pró-labore) não está no DAS e é pago à parte. "
                      if cfg.regime == "simples" and cfg.anexo == "IV" else "")
            + ("No Lucro Real, PIS e COFINS são não cumulativos (os créditos reduzem o valor) e IRPJ/CSLL dependem do lucro "
               "apurado, por isso não entram na projeção. " if cfg.regime == "real" else "")
            + _aviso_reforma(cfg)
            + "Valores estimados: o oficial é o apurado pelo contador."}


def _pct(d: Decimal) -> str:
    return f"{Decimal(d).quantize(Decimal('0.01')):f}".rstrip("0").rstrip(".").replace(".", ",")


def _aviso_reforma(cfg: ConfigImpostos) -> str:
    if cfg.regime == "simples":
        return ("Reforma tributária: no Simples, a partir de 2027 a CBS e o IBS entram dentro do DAS, no lugar de PIS/COFINS "
                "e ISS, sem guia nova. ")
    return ("Reforma tributária: em 2026 a CBS (0,9%) e o IBS (0,1%) são só teste, compensados com PIS/COFINS (aparecem "
            "em cinza e não somam). Em 2027 a CBS substitui PIS e COFINS; de 2029 a 2032 o ISS cai 10% ao ano e o IBS "
            f"ocupa o lugar, até 2033. As alíquotas de referência ainda não foram fixadas: usamos CBS {_pct(cfg.aliq_cbs)}% "
            f"e IBS {_pct(cfg.aliq_ibs)}%, com redução de {_pct(cfg.reducao_ibs_cbs)}% para advocacia (ajuste na configuração). ")


def _estimativa(metodo: str, mes: date, receita: dict[str, Decimal], base_media) -> Decimal:
    if metodo == "ano_anterior":
        return receita.get(somar_meses(mes, -12, 1).strftime("%Y-%m"), ZERO)
    n = {"media3": 3, "media6": 6, "media12": 12}.get(metodo, 3)
    return base_media(mes, n)


def _presumido(cfg: ConfigImpostos, emissora, mes: date, rec: Decimal, receita: dict[str, Decimal]) -> dict:
    real = cfg.regime == "real"
    regras = reforma(mes.year)
    impostos: dict[str, Decimal] = {}
    if regras["pis_cofins"]:
        impostos["PIS"] = q2(rec * (cfg.aliq_pis_real if real else cfg.aliq_pis) / 100)
        impostos["COFINS"] = q2(rec * (cfg.aliq_cofins_real if real else cfg.aliq_cofins) / 100)
    novos, informativos = _ibs_cbs(cfg, mes.year, rec)
    impostos.update(novos)
    iss = cfg.iss_fixo_mensal if cfg.iss_modo == "fixo" else rec * (emissora.aliquota_iss or 0)
    if regras["iss"]:
        impostos["ISS"] = q2(iss * regras["iss"])
    if not real and mes.month in (3, 6, 9, 12):  # IRPJ e CSLL são trimestrais
        tri = sum((receita.get(somar_meses(mes, -j, 1).strftime("%Y-%m"), ZERO) for j in range(0, 3)), ZERO)
        base_ir = tri * cfg.presuncao_irpj / 100
        irpj = base_ir * cfg.aliq_irpj / 100 + max(ZERO, base_ir - cfg.limite_adicional_trimestre) * cfg.aliq_adicional_irpj / 100
        csll = tri * cfg.presuncao_csll / 100 * cfg.aliq_csll / 100
        impostos.update({"IRPJ": q2(irpj), "CSLL": q2(csll)})
    total = q2(sum(impostos.values(), ZERO))
    return {"impostos": impostos, "informativos": informativos, "total_impostos": total,
            "aliquota_efetiva": q2(total / rec * 100) if rec else ZERO,
            "vencimento": _vencimento(mes, cfg.dia_vencimento), "trimestre": not real and mes.month in (3, 6, 9, 12)}


def simular(db: Session, tenant_id: int, emissora, valor: Decimal, mes: date) -> dict:
    """"Se eu faturar R$ X no mês M": imposto adicional, líquido e vencimento."""
    base = projecao(db, tenant_id, emissora)
    k = mes.replace(day=1).strftime("%Y-%m")
    linha = next((linha for linha in base["linhas"] if linha["mes"] == k), None)
    atual = linha["receita"] if linha else ZERO
    com = projecao(db, tenant_id, emissora, metodo=base["metodo"], editados={k: atual + valor})
    l2 = next(linha for linha in com["linhas"] if linha["mes"] == k)
    # no presumido o IRPJ/CSLL do trimestre também sobe: soma o fechamento do trimestre
    extra = l2["total_impostos"] - (linha["total_impostos"] if linha else ZERO)
    if base["resumo"]["regime"] == "presumido" and mes.month not in (3, 6, 9, 12):
        fecho = somar_meses(mes.replace(day=1), (3 - mes.month % 3) % 3, 1).strftime("%Y-%m")
        a = next((x for x in base["linhas"] if x["mes"] == fecho), None)
        b = next((x for x in com["linhas"] if x["mes"] == fecho), None)
        if a and b:
            extra += b["total_impostos"] - a["total_impostos"]
    return {"valor": q2(valor), "mes": k, "imposto": q2(extra), "liquido": q2(valor - extra),
            "aliquota": q2(extra / valor * 100) if valor else ZERO, "vencimento": l2["vencimento"]}


def _config_out(cfg: ConfigImpostos, emissora) -> dict:
    return {"regime": cfg.regime, "regime_receita": cfg.regime_receita, "anexo": cfg.anexo, "faixas": cfg.faixas,
            "dia_vencimento_das": cfg.dia_vencimento_das, "aliq_pis": cfg.aliq_pis, "aliq_cofins": cfg.aliq_cofins,
            "aliq_pis_real": cfg.aliq_pis_real, "aliq_cofins_real": cfg.aliq_cofins_real, "regime_cadastro": emissora.regime.value,
            "presuncao_irpj": cfg.presuncao_irpj, "presuncao_csll": cfg.presuncao_csll, "aliq_irpj": cfg.aliq_irpj,
            "aliq_adicional_irpj": cfg.aliq_adicional_irpj, "limite_adicional_trimestre": cfg.limite_adicional_trimestre,
            "aliq_csll": cfg.aliq_csll, "iss_modo": cfg.iss_modo, "iss_fixo_mensal": cfg.iss_fixo_mensal,
            "aliquota_iss_emissora": q2((emissora.aliquota_iss or 0) * 100), "dia_vencimento": cfg.dia_vencimento,
            "aliq_cbs": cfg.aliq_cbs, "aliq_ibs": cfg.aliq_ibs, "reducao_ibs_cbs": cfg.reducao_ibs_cbs}



