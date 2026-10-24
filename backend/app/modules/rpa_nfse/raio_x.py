"""Raio-X do arquivo: antes de emitir, o robô compara o lote com o histórico e aponta o que um humano
deixaria passar. Nada aqui bloqueia a emissão; são alertas para a pessoa decidir.

- Possível cobrança em dobro: mesmo cliente e mesmo valor já faturados nos últimos 45 dias
- Valor fora do padrão: bem acima ou abaixo do que o cliente costuma pagar
- Clientes que sumiram: faturados todo mês e ausentes neste arquivo
- Comparação com o lote anterior, concentração por cliente e previsão de tempo de emissão
"""

import math
from datetime import timedelta
from decimal import Decimal
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import agora
from app.modules.rpa_nfse.models import Lote, Nfse, Rps, StatusLote, StatusNfse, StatusRps, Tomador

SEG_POR_SUBLOTE = 9  # média observada por sublote de 50 (teste + envio + PDF)


def _n(qtd: int, singular: str, plural: str) -> str:
    return f"{qtd} {singular if qtd == 1 else plural}"


def _brl(v: Decimal | float) -> str:
    return "R$ " + f"{Decimal(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def gerar(db: Session, lote: Lote) -> dict:
    ativos = [r for r in lote.rps if r.status != StatusRps.descartado]
    sel = [r for r in ativos if r.selecionado] or ativos
    insights: list[dict] = []
    docs = {(r.dados_json or {}).get("tomador", {}).get("cpf_cnpj") for r in ativos} - {None}
    desde = agora() - timedelta(days=45)

    historico = db.execute(
        select(Tomador.cpf_cnpj, Nfse.valor, Nfse.numero, Nfse.data_emissao)
        .join(Tomador, Nfse.tomador_id == Tomador.id)
        .join(Rps, Nfse.rps_id == Rps.id)
        .where(Nfse.tenant_id == lote.tenant_id, Nfse.status == StatusNfse.emitida, Tomador.cpf_cnpj.in_(docs),
               Rps.lote_id != lote.id)
    ).all()
    por_doc: dict[str, list] = {}
    for doc, valor, numero, quando in historico:
        por_doc.setdefault(doc, []).append((Decimal(valor), numero, quando))

    # ---- cobrança em dobro
    dobro = []
    for r in ativos:
        doc = (r.dados_json or {}).get("tomador", {}).get("cpf_cnpj")
        for valor, numero, quando in por_doc.get(doc, []):
            q = quando if quando.tzinfo else quando.replace(tzinfo=desde.tzinfo)
            if valor == r.valor and q >= desde:
                dobro.append((r, numero, q))
                break
    if dobro:
        exemplo = dobro[0]
        insights.append({
            "tipo": "duplicidade", "nivel": "erro", "titulo": _n(len(dobro), "possível cobrança em dobro", "possíveis cobranças em dobro"),
            "texto": f"{(exemplo[0].dados_json or {}).get('tomador', {}).get('nome', 'Cliente')} já recebeu a NFS-e "
                     f"nº {exemplo[1]} com o mesmo valor ({_brl(exemplo[0].valor)}) em {exemplo[2]:%d/%m}. "
                     "Confira antes de emitir.",
            "rps_ids": [d[0].id for d in dobro],
        })

    # ---- valor fora do padrão
    atipicos = []
    for r in ativos:
        doc = (r.dados_json or {}).get("tomador", {}).get("cpf_cnpj")
        valores = [v for v, _, _ in por_doc.get(doc, [])]
        if len(valores) >= 3:
            m = median(valores)
            if m and (r.valor > m * 3 or r.valor < m / 3):
                atipicos.append((r, m))
    if atipicos:
        r, m = atipicos[0]
        insights.append({
            "tipo": "valor_atipico", "nivel": "aviso", "titulo": _n(len(atipicos), "valor fora do padrão do cliente", "valores fora do padrão dos clientes"),
            "texto": f"{(r.dados_json or {}).get('tomador', {}).get('nome', 'Cliente')}: {_brl(r.valor)} neste arquivo, "
                     f"mas costuma ser {_brl(m)}.",
            "rps_ids": [a[0].id for a in atipicos],
        })

    # ---- clientes que sumiram (faturados nos 2 últimos meses e fora deste arquivo)
    ini = (agora().replace(day=1) - timedelta(days=1)).replace(day=1) - timedelta(days=31)
    meses_por_cliente: dict[tuple[str, str], set[str]] = {}
    for nome, doc, quando in db.execute(
        select(Tomador.nome, Tomador.cpf_cnpj, Nfse.data_emissao)
        .join(Tomador, Nfse.tomador_id == Tomador.id)
        .where(Nfse.tenant_id == lote.tenant_id, Nfse.status == StatusNfse.emitida, Nfse.data_emissao >= ini,
               Nfse.emissora_id == lote.emissora_id)
    ):
        meses_por_cliente.setdefault((nome, doc), set()).add(f"{quando:%Y-%m}")
    recorrentes = [(nome, doc, len(meses)) for (nome, doc), meses in meses_por_cliente.items()]
    sumidos = [nome for nome, doc, meses in recorrentes if meses >= 2 and doc not in docs]
    if sumidos:
        insights.append({
            "tipo": "ausentes", "nivel": "aviso", "titulo": _n(len(sumidos), "cliente recorrente fora deste arquivo", "clientes recorrentes fora deste arquivo"),
            "texto": "Faturados nos últimos meses e ausentes agora: " + ", ".join(sumidos[:4])
                     + (f" e mais {len(sumidos) - 4}" if len(sumidos) > 4 else "") + ". Esqueceram de lançar na Lello?",
            "rps_ids": [],
        })

    # ---- comparação com o lote anterior
    anterior = db.scalar(
        select(Lote).where(Lote.tenant_id == lote.tenant_id, Lote.emissora_id == lote.emissora_id, Lote.id != lote.id,
                           Lote.status.in_([StatusLote.concluido, StatusLote.parcial])).order_by(Lote.id.desc())
    )
    total = sum((r.valor for r in sel), Decimal(0))
    comparativo = None
    if anterior and anterior.valor_total:
        var = float((total - anterior.valor_total) / anterior.valor_total * 100)
        comparativo = {"lote_anterior": anterior.numero, "valor_anterior": float(anterior.valor_total),
                       "valor_atual": float(total), "variacao": round(var, 1)}
        if abs(var) >= 30:
            insights.append({
                "tipo": "variacao", "nivel": "info",
                "titulo": f"Faturamento {'+' if var > 0 else ''}{var:.0f}% vs. lote #{anterior.numero:04d}",
                "texto": f"{_brl(total)} agora contra {_brl(anterior.valor_total)} no lote anterior.", "rps_ids": [],
            })

    # ---- concentração
    por_cliente: dict[str, Decimal] = {}
    for r in sel:
        nome = (r.dados_json or {}).get("tomador", {}).get("nome") or "?"
        por_cliente[nome] = por_cliente.get(nome, Decimal(0)) + r.valor
    top = sorted(por_cliente.items(), key=lambda kv: kv[1], reverse=True)[:5]
    if total and top:
        pct = float(sum(v for _, v in top[:3]) / total * 100)
        if pct >= 50 and len(por_cliente) > 3:
            insights.append({"tipo": "concentracao", "nivel": "info",
                             "titulo": f"3 clientes concentram {pct:.0f}% do valor",
                             "texto": ", ".join(n for n, _ in top[:3]) + ".", "rps_ids": []})

    # ---- nota de saúde do arquivo (0–100)
    com_erro = sum(1 for r in ativos if r.status == StatusRps.erro)
    com_aviso = sum(1 for r in ativos if r.status == StatusRps.aviso)
    n = max(len(ativos), 1)
    score = 100 - (com_erro / n) * 70 - (com_aviso / n) * 15 - min(len(dobro) * 5, 20) - min(len(atipicos) * 2, 10)
    score = max(0, min(100, round(score)))
    sublotes = math.ceil(len(sel) / settings.lote_tamanho) if sel else 0
    frase = (
        "Arquivo impecável. Pode emitir." if score >= 95 else
        "Arquivo saudável, com poucos pontos de atenção." if score >= 80 else
        "Vale revisar os alertas antes de emitir." if score >= 50 else
        "Muitos problemas: corrija antes de emitir."
    )
    return {
        "score": score,
        "frase": frase,
        "insights": insights,
        "comparativo": comparativo,
        "top_clientes": [{"nome": nome, "valor": float(v)} for nome, v in top],
        "previsao_segundos": sublotes * SEG_POR_SUBLOTE,
        "sublotes": sublotes,
    }
