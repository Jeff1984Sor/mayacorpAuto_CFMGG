"""Dashboard de Faturamento (inspirado no painel do RCA, estilo Power BI).

Uma linha por fatura (NH ou ND, da Lello ou do faturamento por contrato) e mais as NFS-e que não têm fatura;
o navegador faz as contas, então clicar num gráfico filtra todos os outros na hora e os filtros vão na URL.
Volume da CFME (~500 documentos/mês) cabe com folga: são poucos KB por mês de histórico.
"""

from datetime import date

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import Ctx
from app.modules.rpa_nfse.fatura import dados_cliente, situacao
from app.modules.rpa_nfse.models import Emissora, Fatura, Lote, Nfse, Rps, StatusLote, TipoFatura

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard/faturamento")
def dados(ctx: Ctx):
    from app.modules.faturamento.models import Contrato

    db = ctx.db
    emissoras = {e.id: e.nome_fantasia or e.razao_social for e in db.scalars(select(Emissora).where(Emissora.tenant_id == ctx.tenant_id))}
    contratos = {c.id: f"#{c.numero} {c.nome}" for c in db.scalars(select(Contrato).where(Contrato.tenant_id == ctx.tenant_id))}
    notas = {n.id: n for n in db.scalars(
        select(Nfse).where(Nfse.tenant_id == ctx.tenant_id).options(selectinload(Nfse.rps).selectinload(Rps.lote)))}
    linhas, com_fatura = [], set()

    def linha_nota(n: Nfse | None) -> dict:
        if not n:
            return {"nf": None, "servico": "—", "lote": None, "lote_id": None, "iss": 0.0, "nfse": "Aguardando NFS-e",
                    "simulada": False, "origem_baixa": None}
        return {"nf": n.numero, "servico": n.rps.cod_servico, "lote": n.rps.lote.numero, "lote_id": n.rps.lote_id,
                "iss": float(n.iss), "nfse": "Cancelada" if n.status.value == "cancelada" else "Emitida",
                "simulada": n.simulada, "origem_baixa": n.baixa_origem}

    for f in db.scalars(select(Fatura).where(Fatura.tenant_id == ctx.tenant_id).options(selectinload(Fatura.tomador))):
        n = notas.get(f.nfse_id) if f.nfse_id else None
        if n:
            com_fatura.add(n.id)
        tom = dados_cliente(f)
        nd = f.tipo == TipoFatura.despesas
        linhas.append({
            "id": f.id, "chave": f"f{f.id}", "fatura_id": f.id, "fatura": f.codigo, "nfse_id": n.id if n else None,
            "tipo": "ND" if nd else "NH", "origem": "Contrato" if f.origem == "faturamento" else "Arquivo da Lello",
            "contrato": contratos.get(f.contrato_id, "—") if f.contrato_id else "—",
            "cliente": tom.get("nome") or (f.tomador.nome if f.tomador else "—"), "cliente_id": f.tomador_id,
            "doc": tom.get("cpf_cnpj"), "emissora": emissoras.get(f.emissora_id, "—"),
            "emissao": f.data_emissao.isoformat(), "vencimento": f.data_vencimento.isoformat(),
            "pagamento": f.pago_em.isoformat() if f.pago_em else None,
            "valor": float(f.total), "recebido": float((n.valor_pago if n and n.valor_pago else f.total) if f.pago_em else 0),
            "cancelada": f.status.value == "cancelada", "situacao": situacao(f),
            **linha_nota(n), **({"nfse": "Não se aplica (reembolso)"} if nd else {}),
        })
    # notas sem fatura (ex.: emitidas antes de ativar as faturas)
    for n in notas.values():
        if n.id in com_fatura:
            continue
        tom = (n.rps.dados_json or {}).get("tomador", {})
        cancelada = n.status.value == "cancelada"
        linhas.append({
            "id": n.id, "chave": f"n{n.id}", "fatura_id": None, "fatura": None, "nfse_id": n.id, "tipo": "NH",
            "origem": "Arquivo da Lello", "contrato": "—", "cliente": tom.get("nome") or "—", "cliente_id": n.tomador_id,
            "doc": tom.get("cpf_cnpj"), "emissora": emissoras.get(n.emissora_id, "—"),
            "emissao": n.data_emissao.date().isoformat(), "vencimento": None,
            "pagamento": n.pago_em.isoformat() if n.pago_em else None, "valor": float(n.valor),
            "recebido": float(n.valor_pago or 0), "cancelada": cancelada,
            "situacao": "cancelada" if cancelada else ("paga" if n.pago_em else "aberta"), **linha_nota(n),
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
