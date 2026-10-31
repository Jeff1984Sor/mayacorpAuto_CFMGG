"""Catálogo "Minhas automações". Cada RPA registra seu card aqui."""

from datetime import date

from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import Ctx
from app.core.schemas import AutomacaoCard

router = APIRouter(prefix="/hub", tags=["hub"])


@router.get("/automacoes", response_model=list[AutomacaoCard])
def automacoes(ctx: Ctx):
    from app.modules.rpa_nfse.models import Nfse, StatusNfse

    inicio = date.today().replace(day=1)
    notas_mes = ctx.db.scalar(
        select(func.count()).select_from(Nfse).where(
            Nfse.tenant_id == ctx.tenant_id, Nfse.status == StatusNfse.emitida, Nfse.data_emissao >= inicio
        )
    ) or 0
    from app.core import tenancy

    robos = tenancy.robos()
    cards = [
        AutomacaoCard(slug="nfse", nome="Emissor de NFS-e em Lote",
                      descricao="Arquivo da Lello → notas no layout 2 (ISS + IBS + CBS), assinadas e transmitidas.",
                      icone="receipt", status="ativo", href="/nfse", metrica=f"{notas_mes} notas no mês"),
        _card_tribunais(ctx),
        AutomacaoCard(slug="porto", nome="Upload Porto Seguro",
                      descricao="Robô de envio de arquivos ao portal da Porto Seguro.",
                      icone="upload", status="planejado", href=None, metrica="Em breve"),
    ]
    liberado = {"nfse": "nfse_lote", "porto": "porto_seguro"}  # cards de robôs feitos sob medida
    return [c for c in cards if robos is None or c.slug not in liberado or liberado[c.slug] in robos]


def _card_tribunais(ctx) -> AutomacaoCard:
    from app.modules.tribunais.models import Processo

    n = ctx.db.scalar(select(func.count()).select_from(Processo).where(Processo.tenant_id == ctx.tenant_id, Processo.monitorar.is_(True))) or 0
    return AutomacaoCard(slug="tribunais", nome="Integração com Tribunais",
                         descricao="Processos pela OAB (DJEN + DataJud), intimações e protocolo de petições com o certificado do advogado.",
                         icone="scale", status="ativo", href="/tribunais", metrica=f"{n} processos monitorados")
