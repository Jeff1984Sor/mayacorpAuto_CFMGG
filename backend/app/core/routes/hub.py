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


@router.get("/inicio")
def inicio(ctx: Ctx):
    """Tela inicial: o dia de trabalho de quem entrou (tarefas, prazos, o que está parado). Sem nenhum valor em dinheiro."""
    from datetime import timedelta

    from app.modules.boletos.models import Boleto, StatusBoleto
    from app.modules.faturamento.models import Caso, Contrato, Revisao, StatusCaso, StatusRevisao, StatusTarefa, Tarefa
    from app.modules.rpa_nfse.models import Fatura, Lote, StatusFatura, StatusLote, TipoFatura, Tomador
    from app.modules.tribunais.models import Alerta, Processo

    db, t, hoje = ctx.db, ctx.tenant_id, date.today()
    eu = ctx.usuario.id

    def conta(modelo, *filtros) -> int:
        return db.scalar(select(func.count()).select_from(modelo).where(*filtros)) or 0

    saida: dict = {"data": hoje, "tarefas": None, "numeros": [], "pendencias": [], "lotes": []}

    if ctx.pode("tarefas.ver"):
        abertas = [Tarefa.tenant_id == t, Tarefa.responsavel_id == eu,
                   Tarefa.status.in_((StatusTarefa.a_fazer, StatusTarefa.em_andamento))]
        proximas = db.scalars(select(Tarefa).where(*abertas).order_by(Tarefa.prazo.is_(None), Tarefa.prazo, Tarefa.hora, Tarefa.id).limit(7))
        saida["tarefas"] = {
            "abertas": conta(Tarefa, *abertas),
            "hoje": conta(Tarefa, *abertas, Tarefa.prazo == hoje),
            "atrasadas": conta(Tarefa, *abertas, Tarefa.prazo < hoje),
            "semana": conta(Tarefa, *abertas, Tarefa.prazo > hoje, Tarefa.prazo <= hoje + timedelta(days=7)),
            "proximas": [{"id": x.id, "titulo": x.titulo, "prazo": x.prazo, "hora": x.hora, "tipo": x.tipo.value,
                          "prioridade": x.prioridade.value, "caso_id": x.caso_id, "caso": x.caso.titulo if x.caso else None,
                          "atrasada": bool(x.prazo and x.prazo < hoje)} for x in proximas],
        }

    if ctx.pode("casos.ver"):
        saida["numeros"].append({"rotulo": "Casos em andamento", "valor": conta(Caso, Caso.tenant_id == t, Caso.status == StatusCaso.aberto),
                                 "href": "/faturamento/casos", "icone": "casos"})
        saida["numeros"].append({"rotulo": "Casos abertos este mês", "valor": conta(
            Caso, Caso.tenant_id == t, Caso.data_abertura >= hoje.replace(day=1)), "href": "/faturamento/casos", "icone": "novo"})
    if ctx.pode("clientes.ver"):
        saida["numeros"].append({"rotulo": "Clientes ativos", "valor": conta(Tomador, Tomador.tenant_id == t, Tomador.ativo.is_(True)),
                                 "href": "/cadastros/clientes", "icone": "clientes"})
    if ctx.pode("contratos.ver"):
        saida["numeros"].append({"rotulo": "Contratos ativos", "valor": conta(Contrato, Contrato.tenant_id == t, Contrato.ativo.is_(True)),
                                 "href": "/faturamento/contratos", "icone": "contratos"})
    if ctx.pode("trib_processos.ver"):
        saida["numeros"].append({"rotulo": "Processos monitorados", "valor": conta(
            Processo, Processo.tenant_id == t, Processo.monitorar.is_(True)), "href": "/tribunais", "icone": "processos"})

    def pendencia(qtd: int, um: str, varios: str, href: str, tom: str = "aviso") -> None:
        if qtd:
            saida["pendencias"].append({"qtd": qtd, "texto": um if qtd == 1 else varios.format(n=qtd), "href": href, "tom": tom})

    if ctx.pode("trib_processos.ver"):
        pendencia(conta(Alerta, Alerta.tenant_id == t, Alerta.lido.is_(False), Alerta.tipo == "intimacao",
                        (Alerta.usuario_id == eu) | Alerta.usuario_id.is_(None)),
                  "1 intimação nova para ler", "{n} intimações novas para ler", "/tribunais", "erro")
    if ctx.pode("revisoes.ver"):
        pendencia(conta(Revisao, Revisao.tenant_id == t, Revisao.status == StatusRevisao.em_revisao),
                  "1 pré-fatura esperando revisão", "{n} pré-faturas esperando revisão", "/faturamento/revisoes")
    if ctx.pode("nfse_emissao.ver"):
        pendencia(conta(Lote, Lote.tenant_id == t, Lote.status == StatusLote.validando),
                  "1 lote de notas esperando conferência", "{n} lotes de notas esperando conferência", "/nfse/lotes")
        pendencia(conta(Lote, Lote.tenant_id == t, Lote.status.in_((StatusLote.parcial, StatusLote.falhou))),
                  "1 lote com notas recusadas pela Prefeitura", "{n} lotes com notas recusadas pela Prefeitura", "/nfse/lotes", "erro")
    if ctx.pode("faturas.ver"):
        pendencia(conta(Fatura, Fatura.tenant_id == t, Fatura.tipo == TipoFatura.honorarios, Fatura.nfse_id.is_(None),
                        Fatura.status == StatusFatura.aberta),
                  "1 fatura ainda sem nota fiscal", "{n} faturas ainda sem nota fiscal", "/nfse/faturas", "info")
    if ctx.pode("boletos.ver"):
        pendencia(conta(Boleto, Boleto.tenant_id == t, Boleto.status == StatusBoleto.rascunho),
                  "1 boleto esperando remessa ao banco", "{n} boletos esperando remessa ao banco", "/boletos", "info")
        pendencia(conta(Boleto, Boleto.tenant_id == t, Boleto.status == StatusBoleto.em_remessa),
                  "1 boleto aguardando o retorno do banco", "{n} boletos aguardando o retorno do banco", "/boletos", "info")
        pendencia(conta(Boleto, Boleto.tenant_id == t, Boleto.status == StatusBoleto.rejeitado),
                  "1 boleto recusado pelo banco", "{n} boletos recusados pelo banco", "/boletos", "erro")

    if ctx.pode("nfse_emissao.ver"):
        lotes = db.scalars(select(Lote).where(Lote.tenant_id == t, Lote.status != StatusLote.descartado)
                           .order_by(Lote.id.desc()).limit(5))
        saida["lotes"] = [{"id": x.id, "numero": x.numero, "arquivo": x.arquivo_origem, "qtd": x.qtd,
                           "status": x.status.value, "criado_em": x.criado_em} for x in lotes]
    return saida
