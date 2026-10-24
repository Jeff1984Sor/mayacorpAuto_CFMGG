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
    return [
        AutomacaoCard(slug="nfse", nome="Emissor de NFS-e em Lote",
                      descricao="Arquivo da Lello → notas no layout 2 (ISS + IBS + CBS), assinadas e transmitidas.",
                      icone="receipt", status="ativo", href="/nfse", metrica=f"{notas_mes} notas no mês"),
        AutomacaoCard(slug="porto", nome="Upload Porto Seguro",
                      descricao="Robô de envio de arquivos ao portal da Porto Seguro.",
                      icone="upload", status="planejado", href=None, metrica="Em breve"),
    ]
