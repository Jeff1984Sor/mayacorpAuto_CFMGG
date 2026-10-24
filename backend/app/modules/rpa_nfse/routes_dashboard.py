"""Dashboard de Faturamento (inspirado no painel do RCA, estilo Power BI).

Uma linha por nota fiscal (todas as épocas, para comparar com o período anterior) e o navegador faz as contas:
assim clicar num gráfico filtra todos os outros na hora, sem recarregar, e os filtros vão na URL.
Volume da CFME (~500 notas/mês) cabe com folga: são poucos KB por mês de histórico.
"""

from datetime import date

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import Ctx
from app.modules.rpa_nfse.fatura import situacao
from app.modules.rpa_nfse.models import Emissora, Fatura, Lote, Nfse, Rps, StatusLote

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/faturamento")
def dados(ctx: Ctx):
    db = ctx.db
    emissoras = {e.id: e.nome_fantasia or e.razao_social for e in db.scalars(select(Emissora).where(Emissora.tenant_id == ctx.tenant_id))}
    faturas = {f.nfse_id: f for f in db.scalars(select(Fatura).where(Fatura.tenant_id == ctx.tenant_id))}
    notas = db.scalars(
        select(Nfse).where(Nfse.tenant_id == ctx.tenant_id).options(selectinload(Nfse.rps).selectinload(Rps.lote))
    )
    linhas = []
    for n in notas:
        tom = (n.rps.dados_json or {}).get("tomador", {})
        f = faturas.get(n.id)
        linhas.append({
            "id": n.id,
            "nf": n.numero,
            "fatura_id": f.id if f else None,
            "fatura": f.codigo if f else None,
            "cliente": tom.get("nome") or "—",
            "cliente_id": n.tomador_id,
            "doc": tom.get("cpf_cnpj"),
            "emissora": emissoras.get(n.emissora_id, "—"),
            "servico": n.rps.cod_servico,
            "lote": n.rps.lote.numero,
            "lote_id": n.rps.lote_id,
            "emissao": n.data_emissao.date().isoformat(),
            "vencimento": f.data_vencimento.isoformat() if f else None,
            "pagamento": n.pago_em.isoformat() if n.pago_em else None,
            "valor": float(n.valor),
            "iss": float(n.iss),
            "recebido": float(n.valor_pago or 0),
            "cancelada": n.status.value == "cancelada",
            "situacao": situacao(f) if f else ("cancelada" if n.status.value == "cancelada" else ("paga" if n.pago_em else "aberta")),
            "origem_baixa": n.baixa_origem,
            "simulada": n.simulada,
        })
    lotes = [
        {"id": lt.id, "numero": lt.numero, "mes": (lt.concluido_em or lt.criado_em).date().isoformat()[:7],
         "emitidas": lt.qtd_emitidas, "rejeitadas": lt.qtd_rejeitadas, "status": lt.status.value,
         "segundos": (lt.concluido_em - lt.iniciado_em).total_seconds() if lt.concluido_em and lt.iniciado_em else None}
        for lt in db.scalars(select(Lote).where(Lote.tenant_id == ctx.tenant_id,
                                                Lote.status.in_([StatusLote.concluido, StatusLote.parcial, StatusLote.falhou])))
    ]
    hoje = date.today()
    return {"notas": linhas, "lotes": lotes, "hoje": hoje.isoformat(),
            "inicial": {"de": hoje.replace(month=1, day=1).isoformat(), "ate": hoje.isoformat()}}
