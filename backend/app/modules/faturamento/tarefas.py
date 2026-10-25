"""Tarefas do escritório: por caso (aba Tarefas) e central de tarefas com filtros. Podem ter anexos.

Anexos de tarefa ficam em fat_anexo com tarefa_id; se a tarefa é de um caso, aparecem também em Anexos do caso,
na pasta "Tarefas".
"""

import uuid
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select

from app.core.config import settings
from app.core.deps import Ctx, Operador
from app.core.models import Usuario
from app.core.schemas import Mensagem
from app.modules.faturamento.models import (
    AnexoCaso,
    Caso,
    Contrato,
    PrioridadeTarefa,
    StatusTarefa,
    Tarefa,
    TipoTarefa,
)
from app.modules.faturamento.schemas import AnexoOut, TarefaIn, TarefaOut, TarefasListaOut

router = APIRouter(prefix="/faturamento", tags=["Faturamento · Tarefas"])
PASTA_TAREFAS = "Tarefas"
ANEXO_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".zip", ".msg", ".eml",
             ".odt", ".ods", ".rtf", ".ppt", ".pptx"}
ABERTAS = (StatusTarefa.a_fazer, StatusTarefa.em_andamento)
ORDEM_PRIORIDADE = {PrioridadeTarefa.urgente: 0, PrioridadeTarefa.alta: 1, PrioridadeTarefa.media: 2, PrioridadeTarefa.baixa: 3}


def _tarefa(ctx, tid: int) -> Tarefa:
    t = ctx.db.get(Tarefa, tid)
    if not t or t.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Tarefa não encontrada.")
    return t


def _out(ctx, t: Tarefa) -> TarefaOut:
    hoje = date.today()
    resp = ctx.db.get(Usuario, t.responsavel_id) if t.responsavel_id else None
    autor = ctx.db.get(Usuario, t.criado_por_id) if t.criado_por_id else None
    aberta = t.status in ABERTAS
    qtd_anexos = ctx.db.scalar(select(func.count()).select_from(AnexoCaso).where(AnexoCaso.tarefa_id == t.id)) or 0
    return TarefaOut.model_validate(t).model_copy(update={
        "caso_numero": t.caso.numero if t.caso else None, "caso_titulo": t.caso.titulo if t.caso else None,
        "cliente_nome": t.caso.contrato.tomador.nome if t.caso and t.caso.contrato.tomador else None,
        "responsavel_nome": resp.nome if resp else None, "criado_por": autor.nome if autor else None,
        "atrasada": bool(aberta and t.prazo and t.prazo < hoje),
        "dias_para_prazo": (t.prazo - hoje).days if t.prazo and aberta else None, "qtd_anexos": qtd_anexos})


def _validar(ctx, dados: TarefaIn) -> None:
    if dados.caso_id:
        c = ctx.db.get(Caso, dados.caso_id)
        if not c or c.tenant_id != ctx.tenant_id:
            raise HTTPException(404, "Caso não encontrado.")
    if dados.responsavel_id:
        u = ctx.db.get(Usuario, dados.responsavel_id)
        if not u or u.tenant_id != ctx.tenant_id:
            raise HTTPException(404, "Responsável não encontrado.")
    dados.etiquetas = list(dict.fromkeys(e.strip()[:30] for e in dados.etiquetas if e and e.strip()))[:10]


def _aplicar_status(t: Tarefa, status: StatusTarefa) -> None:
    t.status = status
    t.concluida_em = (t.concluida_em or date.today()) if status == StatusTarefa.concluida else None


@router.get("/tarefas", response_model=TarefasListaOut)
def tarefas(ctx: Ctx, q: str | None = None, status: list[StatusTarefa] | None = Query(None),
            prioridade: list[PrioridadeTarefa] | None = Query(None), tipo: list[TipoTarefa] | None = Query(None),
            responsavel_id: int | None = None, minhas: bool = False, caso_id: int | None = None, tomador_id: int | None = None,
            sem_caso: bool = False, de: date | None = None, ate: date | None = None,
            situacao: str | None = Query(None, pattern="^(atrasadas|hoje|semana|sem_prazo|abertas)$"), etiqueta: str | None = None):
    hoje = date.today()
    sel = select(Tarefa).outerjoin(Caso, Tarefa.caso_id == Caso.id).outerjoin(Contrato, Caso.contrato_id == Contrato.id) \
        .where(Tarefa.tenant_id == ctx.tenant_id)
    if q:
        sel = sel.where(or_(Tarefa.titulo.ilike(f"%{q}%"), Tarefa.descricao.ilike(f"%{q}%"), Caso.titulo.ilike(f"%{q}%"),
                            Caso.numero_processo.ilike(f"%{q}%")))
    if status:
        sel = sel.where(Tarefa.status.in_(status))
    if prioridade:
        sel = sel.where(Tarefa.prioridade.in_(prioridade))
    if tipo:
        sel = sel.where(Tarefa.tipo.in_(tipo))
    if not ctx.pode("tarefas.ver_todas"):  # perfil sem "ver as de todos": só as suas (responsável ou criador)
        sel = sel.where(or_(Tarefa.responsavel_id == ctx.usuario.id, Tarefa.criado_por_id == ctx.usuario.id))
    if minhas:
        sel = sel.where(Tarefa.responsavel_id == ctx.usuario.id)
    elif responsavel_id:
        sel = sel.where(Tarefa.responsavel_id == responsavel_id)
    if caso_id:
        sel = sel.where(Tarefa.caso_id == caso_id)
    if sem_caso:
        sel = sel.where(Tarefa.caso_id.is_(None))
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if de:
        sel = sel.where(Tarefa.prazo >= de)
    if ate:
        sel = sel.where(Tarefa.prazo <= ate)
    if situacao == "atrasadas":
        sel = sel.where(Tarefa.status.in_(ABERTAS), Tarefa.prazo < hoje)
    elif situacao == "hoje":
        sel = sel.where(Tarefa.status.in_(ABERTAS), Tarefa.prazo == hoje)
    elif situacao == "semana":
        sel = sel.where(Tarefa.status.in_(ABERTAS), Tarefa.prazo >= hoje, Tarefa.prazo <= hoje + timedelta(days=7))
    elif situacao == "sem_prazo":
        sel = sel.where(Tarefa.status.in_(ABERTAS), Tarefa.prazo.is_(None))
    elif situacao == "abertas":
        sel = sel.where(Tarefa.status.in_(ABERTAS))
    lista = list(ctx.db.scalars(sel.limit(2000)))
    if etiqueta:
        lista = [t for t in lista if etiqueta in (t.etiquetas or [])]
    # abertas primeiro, por prazo (sem prazo no fim) e prioridade
    lista.sort(key=lambda t: (t.status not in ABERTAS, t.prazo is None, t.prazo or date.max, ORDEM_PRIORIDADE.get(t.prioridade, 9), t.id))

    base = select(Tarefa).where(Tarefa.tenant_id == ctx.tenant_id)
    if not ctx.pode("tarefas.ver_todas"):
        base = base.where(or_(Tarefa.responsavel_id == ctx.usuario.id, Tarefa.criado_por_id == ctx.usuario.id))
    if caso_id:
        base = base.where(Tarefa.caso_id == caso_id)
    todas = list(ctx.db.scalars(base))
    abertas = [t for t in todas if t.status in ABERTAS]
    resumo = {
        "abertas": len(abertas), "atrasadas": sum(1 for t in abertas if t.prazo and t.prazo < hoje),
        "hoje": sum(1 for t in abertas if t.prazo == hoje),
        "semana": sum(1 for t in abertas if t.prazo and hoje <= t.prazo <= hoje + timedelta(days=7)),
        "minhas": sum(1 for t in abertas if t.responsavel_id == ctx.usuario.id),
        "sem_prazo": sum(1 for t in abertas if not t.prazo),
        "concluidas_7d": sum(1 for t in todas if t.concluida_em and t.concluida_em >= hoje - timedelta(days=7)),
        "a_fazer": sum(1 for t in todas if t.status == StatusTarefa.a_fazer),
        "em_andamento": sum(1 for t in todas if t.status == StatusTarefa.em_andamento),
        "concluida": sum(1 for t in todas if t.status == StatusTarefa.concluida),
        "cancelada": sum(1 for t in todas if t.status == StatusTarefa.cancelada),
    }
    return TarefasListaOut(itens=[_out(ctx, t) for t in lista], resumo=resumo)


@router.get("/tarefas/etiquetas", response_model=list[str])
def etiquetas(ctx: Ctx):
    vistas: dict[str, int] = {}
    for lista in ctx.db.scalars(select(Tarefa.etiquetas).where(Tarefa.tenant_id == ctx.tenant_id)):
        for e in lista or []:
            vistas[e] = vistas.get(e, 0) + 1
    return sorted(vistas, key=lambda e: -vistas[e])


@router.post("/tarefas", response_model=TarefaOut, status_code=201)
def criar_tarefa(dados: TarefaIn, ctx: Operador):
    _validar(ctx, dados)
    t = Tarefa(tenant_id=ctx.tenant_id, criado_por_id=ctx.usuario.id, **dados.model_dump(exclude={"status"}))
    _aplicar_status(t, dados.status)
    t.responsavel_id = t.responsavel_id or ctx.usuario.id
    ctx.db.add(t)
    ctx.db.flush()
    ctx.auditar("faturamento.tarefa.criar", "fat_tarefa", t.id, descricao=t.titulo)
    ctx.db.commit()
    ctx.db.refresh(t)
    return _out(ctx, t)


@router.get("/tarefas/{tid}", response_model=TarefaOut)
def ler_tarefa(tid: int, ctx: Ctx):
    return _out(ctx, _tarefa(ctx, tid))


@router.put("/tarefas/{tid}", response_model=TarefaOut)
def alterar_tarefa(tid: int, dados: TarefaIn, ctx: Operador):
    t = _tarefa(ctx, tid)
    _validar(ctx, dados)
    caso_antes = t.caso_id
    for k, v in dados.model_dump(exclude={"status"}).items():
        setattr(t, k, v)
    _aplicar_status(t, dados.status)
    if caso_antes != t.caso_id:  # anexos acompanham a tarefa para o novo caso (ou saem do caso)
        for a in ctx.db.scalars(select(AnexoCaso).where(AnexoCaso.tarefa_id == t.id)):
            a.caso_id = t.caso_id
    ctx.auditar("faturamento.tarefa.alterar", "fat_tarefa", t.id, descricao=t.titulo)
    ctx.db.commit()
    ctx.db.refresh(t)
    return _out(ctx, t)


@router.patch("/tarefas/{tid}/status", response_model=TarefaOut)
def mudar_status(tid: int, body: dict, ctx: Operador):
    t = _tarefa(ctx, tid)
    try:
        _aplicar_status(t, StatusTarefa(body.get("status")))
    except ValueError:
        raise HTTPException(400, "Status inválido.") from None
    ctx.auditar("faturamento.tarefa.status", "fat_tarefa", t.id, descricao=f"{t.titulo}: {t.status.value}")
    ctx.db.commit()
    return _out(ctx, t)


@router.delete("/tarefas/{tid}", response_model=Mensagem)
def excluir_tarefa(tid: int, ctx: Operador):
    t = _tarefa(ctx, tid)
    arquivos = [Path(a.caminho) for a in ctx.db.scalars(select(AnexoCaso).where(AnexoCaso.tarefa_id == t.id))]
    for a in ctx.db.scalars(select(AnexoCaso).where(AnexoCaso.tarefa_id == t.id)):
        ctx.db.delete(a)
    ctx.auditar("faturamento.tarefa.excluir", "fat_tarefa", t.id, descricao=t.titulo)
    ctx.db.delete(t)
    ctx.db.commit()
    for arq in arquivos:
        arq.unlink(missing_ok=True)
    return Mensagem(mensagem="Tarefa excluída.")


# ---------------------------------------------------------------- anexos da tarefa
def _anexo_out(ctx, a: AnexoCaso) -> AnexoOut:
    from app.modules.faturamento.routes import _anexo_out as base

    return base(ctx, a)


@router.get("/tarefas/{tid}/anexos", response_model=list[AnexoOut])
def anexos_tarefa(tid: int, ctx: Ctx):
    t = _tarefa(ctx, tid)
    return [_anexo_out(ctx, a) for a in ctx.db.scalars(select(AnexoCaso).where(AnexoCaso.tarefa_id == t.id).order_by(AnexoCaso.id.desc()))]


@router.post("/tarefas/{tid}/anexos", response_model=list[AnexoOut], status_code=201)
async def enviar_anexos_tarefa(tid: int, ctx: Operador, arquivos: list[UploadFile] = File(...)):
    t = _tarefa(ctx, tid)
    pasta = Path(settings.storage_dir) / "tarefas" / str(t.id)
    pasta.mkdir(parents=True, exist_ok=True)
    novos = []
    for arq in arquivos:
        nome = Path(arq.filename or "arquivo").name
        ext = Path(nome).suffix.lower()
        if ext not in ANEXO_EXT:
            raise HTTPException(400, f"Tipo de arquivo não aceito: {nome}")
        conteudo = await arq.read()
        if len(conteudo) > 50 * 1024 * 1024:
            raise HTTPException(400, f"{nome} passa de 50 MB.")
        destino = pasta / f"{uuid.uuid4().hex}{ext}"
        destino.write_bytes(conteudo)
        a = AnexoCaso(caso_id=t.caso_id, tarefa_id=t.id, nome=nome[:255], descricao=f"Tarefa: {t.titulo}"[:300],
                      categoria=PASTA_TAREFAS, caminho=str(destino), tamanho=len(conteudo), mime=arq.content_type,
                      enviado_por_id=ctx.usuario.id)
        ctx.db.add(a)
        novos.append(a)
    ctx.db.flush()
    ctx.auditar("faturamento.tarefa.anexo", "fat_tarefa", t.id, descricao=", ".join(a.nome for a in novos))
    ctx.db.commit()
    return [_anexo_out(ctx, a) for a in novos]
