"""Faturamento: contratos → casos → regras de cobrança, timesheet, despesas e Itens a faturar."""

import re
from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.core.config import settings
from app.core.deps import Admin, Ctx, Operador
from app.core.models import Cargo, Usuario
from app.core.schemas import Mensagem
from app.modules.faturamento import service
from app.modules.faturamento.judiciario import INSTANCIAS
from app.modules.faturamento.models import (
    ROTULO_TIPO_CASO,
    Andamento,
    AnexoCaso,
    AreaAtuacao,
    CampoAdicional,
    Caso,
    Contrato,
    Despesa,
    FaturaItem,
    Frequencia,
    RegraCobranca,
    StatusCaso,
    StatusTarefa,
    TabelaPreco,
    TabelaPrecoItem,
    Tarefa,
    Termino,
    Timesheet,
    TipoCampo,
    TipoCaso,
    TipoDespesa,
    TipoRegra,
)
from app.modules.faturamento.schemas import (
    AndamentoIn,
    AndamentoOut,
    AnexoOut,
    AreaIn,
    AreaOut,
    CampoIn,
    CampoOut,
    CancelarFaturaIn,
    CasoIn,
    CasoOut,
    ClientePendenteOut,
    ContratoIn,
    ContratoOut,
    ContratoPendenteOut,
    DespesaIn,
    DespesaOut,
    EmitirNfseIn,
    FaturadaOut,
    FaturarIn,
    FaturarOut,
    ItemPendenteOut,
    ItensAFaturarOut,
    ProfissionalOut,
    RegraIn,
    RegraOut,
    ResumoCasoOut,
    TabelaIn,
    TabelaOut,
    TimesheetIn,
    TimesheetOut,
)
from app.modules.rpa_nfse.models import Emissora, Fatura, Tomador

router = APIRouter(prefix="/faturamento", tags=["Faturamento"])

COMPROVANTE_MAX = 15 * 1024 * 1024


def _get(ctx, modelo, oid: int, nome: str):
    obj = ctx.db.get(modelo, oid)
    if not obj or obj.tenant_id != ctx.tenant_id:
        raise HTTPException(404, f"{nome} não encontrado.")
    return obj


def _erro(e: service.RegraFaturamento):
    raise HTTPException(400, str(e)) from e


# ================================================================ funcionários (usuários) e tabelas de preço
@router.get("/profissionais", response_model=list[ProfissionalOut])
def profissionais(ctx: Ctx, todos: bool = False):
    """Funcionários para os campos de timesheet (inclui quem não acessa o sistema)."""
    sel = select(Usuario).where(Usuario.tenant_id == ctx.tenant_id)
    if not todos:
        sel = sel.where(Usuario.ativo)
    return [ProfissionalOut(id=u.id, nome=u.nome, email=u.email, cargo_id=u.cargo_id, cargo_nome=u.cargo.nome if u.cargo else None,
                            oab=u.oab, acesso_sistema=u.acesso_sistema, ativo=u.ativo)
            for u in ctx.db.scalars(sel.order_by(Usuario.nome))]


@router.delete("/tabelas/{tid}", response_model=Mensagem)
def excluir_tabela(tid: int, ctx: Admin):
    t = _get(ctx, TabelaPreco, tid, "Tabela")
    em_uso = sum(ctx.db.scalar(select(func.count()).select_from(m).where(m.tabela_preco_id == tid)) or 0
                 for m in (Contrato, Caso, RegraCobranca))
    if em_uso:
        t.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Tabela em uso em contratos/casos: foi desativada.")
    ctx.db.delete(t)
    ctx.db.commit()
    return Mensagem(mensagem="Tabela excluída.")


@router.get("/tabelas", response_model=list[TabelaOut])
def tabelas(ctx: Ctx):
    return ctx.db.scalars(select(TabelaPreco).where(TabelaPreco.tenant_id == ctx.tenant_id).order_by(TabelaPreco.nome)).all()


def _salvar_tabela(ctx, t: TabelaPreco, dados: TabelaIn):
    t.nome, t.ativo = dados.nome, dados.ativo
    vistos = set()
    t.itens.clear()
    ctx.db.flush()
    for it in dados.itens:
        if it.cargo_id in vistos:
            raise HTTPException(400, "Cargo repetido na tabela.")
        vistos.add(it.cargo_id)
        _get(ctx, Cargo, it.cargo_id, "Cargo")
        t.itens.append(TabelaPrecoItem(cargo_id=it.cargo_id, valor_hora=it.valor_hora))


@router.post("/tabelas", response_model=TabelaOut, status_code=201)
def criar_tabela(dados: TabelaIn, ctx: Admin):
    t = TabelaPreco(tenant_id=ctx.tenant_id, nome=dados.nome)
    ctx.db.add(t)
    _salvar_tabela(ctx, t, dados)
    ctx.db.flush()
    ctx.auditar("faturamento.tabela.criar", "fat_tabela", t.id, descricao=t.nome)
    ctx.db.commit()
    return t


@router.put("/tabelas/{tid}", response_model=TabelaOut)
def alterar_tabela(tid: int, dados: TabelaIn, ctx: Admin):
    t = _get(ctx, TabelaPreco, tid, "Tabela")
    _salvar_tabela(ctx, t, dados)
    ctx.auditar("faturamento.tabela.alterar", "fat_tabela", t.id, descricao=t.nome)
    ctx.db.commit()
    return t


# ================================================================ contratos
def _contrato_out(ctx, c: Contrato) -> ContratoOut:
    campos = {k: getattr(c, k) for k in ContratoOut.model_fields if hasattr(Contrato, k)}
    tabela = ctx.db.get(TabelaPreco, c.tabela_preco_id) if c.tabela_preco_id else None
    return ContratoOut(**campos, tomador_nome=c.tomador.nome if c.tomador else "", tabela_preco_nome=tabela.nome if tabela else None,
                       qtd_casos=len(c.casos), qtd_regras=len([r for r in c.regras if r.ativo]))


@router.get("/contratos", response_model=list[ContratoOut])
def contratos(ctx: Ctx, tomador_id: int | None = None, q: str | None = None, ativos: bool | None = None):
    sel = select(Contrato).join(Tomador, Contrato.tomador_id == Tomador.id).where(Contrato.tenant_id == ctx.tenant_id)
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if q:
        conds = [Contrato.nome.ilike(f"%{q}%"), Tomador.nome.ilike(f"%{q}%")]
        if q.strip().isdigit():
            conds.append(Contrato.numero == int(q))
        sel = sel.where(or_(*conds))
    if ativos is not None:
        sel = sel.where(Contrato.ativo == ativos)
    return [_contrato_out(ctx, c) for c in ctx.db.scalars(sel.order_by(Contrato.numero.desc()))]


def _validar_contrato(ctx, dados: ContratoIn):
    _get(ctx, Tomador, dados.tomador_id, "Cliente")
    if dados.emissora_id:
        _get(ctx, Emissora, dados.emissora_id, "Emissora")
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    if dados.data_inicio and dados.data_fim and dados.data_fim < dados.data_inicio:
        raise HTTPException(400, "O fim do contrato deve ser depois do início.")


@router.post("/contratos", response_model=ContratoOut, status_code=201)
def criar_contrato(dados: ContratoIn, ctx: Operador):
    _validar_contrato(ctx, dados)
    numero = (ctx.db.scalar(select(func.max(Contrato.numero)).where(Contrato.tenant_id == ctx.tenant_id)) or 0) + 1
    c = Contrato(tenant_id=ctx.tenant_id, numero=numero, **dados.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("faturamento.contrato.criar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    ctx.db.refresh(c)
    return _contrato_out(ctx, c)


@router.get("/contratos/{cid}", response_model=ContratoOut)
def ler_contrato(cid: int, ctx: Ctx):
    return _contrato_out(ctx, _get(ctx, Contrato, cid, "Contrato"))


@router.put("/contratos/{cid}", response_model=ContratoOut)
def alterar_contrato(cid: int, dados: ContratoIn, ctx: Operador):
    c = _get(ctx, Contrato, cid, "Contrato")
    _validar_contrato(ctx, dados)
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("faturamento.contrato.alterar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    ctx.db.refresh(c)
    return _contrato_out(ctx, c)


@router.delete("/contratos/{cid}", response_model=Mensagem)
def excluir_contrato(cid: int, ctx: Admin):
    c = _get(ctx, Contrato, cid, "Contrato")
    if c.casos or ctx.db.scalar(select(func.count()).select_from(Fatura).where(Fatura.contrato_id == cid)):
        c.ativo = False
        ctx.auditar("faturamento.contrato.desativar", "fat_contrato", c.id, descricao=f"#{c.numero} {c.nome}")
        ctx.db.commit()
        return Mensagem(mensagem="Contrato com casos ou faturas: foi desativado.")
    for r in ctx.db.scalars(select(RegraCobranca).where(RegraCobranca.contrato_id == cid)):
        ctx.db.delete(r)
    ctx.db.delete(c)
    ctx.auditar("faturamento.contrato.excluir", "fat_contrato", cid, descricao=f"#{c.numero} {c.nome}")
    ctx.db.commit()
    return Mensagem(mensagem="Contrato excluído.")


# ================================================================ casos
def _caso_out(ctx, c: Caso) -> CasoOut:
    resp = ctx.db.get(Usuario, c.responsavel_id) if c.responsavel_id else None
    min_pend = ctx.db.scalar(select(func.coalesce(func.sum(Timesheet.minutos), 0)).where(
        Timesheet.caso_id == c.id, Timesheet.faturavel, Timesheet.fatura_item_id.is_(None))) or 0
    desp = ctx.db.scalar(select(func.coalesce(func.sum(Despesa.valor), 0)).where(
        Despesa.caso_id == c.id, Despesa.reembolsavel, Despesa.fatura_item_id.is_(None))) or 0
    return CasoOut(
        id=c.id, numero=c.numero, contrato_id=c.contrato_id, contrato_nome=c.contrato.nome, contrato_numero=c.contrato.numero,
        tomador_id=c.contrato.tomador_id, tomador_nome=c.contrato.tomador.nome if c.contrato.tomador else "",
        titulo=c.titulo, descricao=c.descricao, numero_processo=c.numero_processo, parte_contraria=c.parte_contraria,
        responsavel_id=c.responsavel_id, responsavel_nome=resp.nome if resp else None, status=c.status,
        tipo=c.tipo, tipo_nome=ROTULO_TIPO_CASO.get(c.tipo) if c.tipo else None,
        area_id=c.area_id, area_nome=c.area.nome if c.area else None, area_cor=c.area.cor if c.area else None, polo=c.polo,
        instancia=c.instancia, instancia_nome=INSTANCIAS.get(c.instancia or ""), tribunal=c.tribunal, vara=c.vara, comarca=c.comarca, valor_causa=c.valor_causa, data_distribuicao=c.data_distribuicao,
        campos=c.campos or {}, qtd_anexos=len(c.anexos), qtd_andamentos=len(c.andamentos),
        qtd_tarefas_abertas=ctx.db.scalar(select(func.count()).select_from(Tarefa).where(
            Tarefa.caso_id == c.id, Tarefa.status.in_([StatusTarefa.a_fazer, StatusTarefa.em_andamento]))) or 0,
        tabela_preco_id=c.tabela_preco_id,
        tabela_preco_efetiva=(t.nome if (t := ctx.db.get(TabelaPreco, c.tabela_preco_id or c.contrato.tabela_preco_id or 0)) else None),
        data_abertura=c.data_abertura, data_encerramento=c.data_encerramento,
        tem_regra_propria=any(r.ativo for r in c.regras),
        horas_pendentes=(Decimal(min_pend) / 60).quantize(Decimal("0.01")), despesas_pendentes=Decimal(desp))


def _validar_caso(ctx, dados: CasoIn) -> None:
    if dados.responsavel_id:
        _get(ctx, Usuario, dados.responsavel_id, "Responsável")
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    if dados.area_id:
        _get(ctx, AreaAtuacao, dados.area_id, "Área")
    dados.campos = _validar_campos(ctx, dados.campos or {}, dados.area_id)


def _validar_campos(ctx, valores: dict, area_id: int | None) -> dict:
    """Confere os campos adicionais: obrigatórios, tipos e opções. Guarda só campos conhecidos."""
    campos = list(ctx.db.scalars(select(CampoAdicional).where(CampoAdicional.tenant_id == ctx.tenant_id,
                                                              CampoAdicional.entidade == "caso", CampoAdicional.ativo)))
    saida = {}
    for cp in campos:
        if cp.area_id and cp.area_id != area_id:
            continue
        v = valores.get(str(cp.id))
        vazio = v is None or (isinstance(v, str) and not v.strip())
        if vazio:
            if cp.obrigatorio:
                raise HTTPException(400, f"Preencha o campo “{cp.nome}”.")
            continue
        try:
            if cp.tipo in (TipoCampo.numero, TipoCampo.moeda):
                v = str(Decimal(str(v).replace(",", ".")))
            elif cp.tipo == TipoCampo.data:
                v = date.fromisoformat(str(v)).isoformat()
            elif cp.tipo == TipoCampo.sim_nao:
                v = v in (True, "true", "sim", "1", 1)
            elif cp.tipo == TipoCampo.lista and str(v) not in cp.opcoes:
                raise ValueError
            else:
                v = str(v).strip()
        except (ValueError, ArithmeticError):
            raise HTTPException(400, f"Valor inválido em “{cp.nome}”.") from None
        saida[str(cp.id)] = v
    return saida


@router.get("/casos", response_model=list[CasoOut])
def casos(ctx: Ctx, contrato_id: int | None = None, tomador_id: int | None = None, q: str | None = None,
          status: str | None = Query(None, pattern="^(aberto|encerrado)$"), tipo: TipoCaso | None = None,
          area_id: int | None = None):
    sel = select(Caso).join(Contrato, Caso.contrato_id == Contrato.id).where(Caso.tenant_id == ctx.tenant_id)
    if contrato_id:
        sel = sel.where(Caso.contrato_id == contrato_id)
    if tomador_id:
        sel = sel.where(Contrato.tomador_id == tomador_id)
    if status:
        sel = sel.where(Caso.status == status)
    if tipo:
        sel = sel.where(Caso.tipo == tipo)
    if area_id:
        sel = sel.where(Caso.area_id == area_id)
    if q:
        conds = [Caso.titulo.ilike(f"%{q}%"), Caso.numero_processo.ilike(f"%{q}%"), Caso.parte_contraria.ilike(f"%{q}%")]
        if q.strip().isdigit():
            conds.append(Caso.numero == int(q))
        sel = sel.where(or_(*conds))
    return [_caso_out(ctx, c) for c in ctx.db.scalars(sel.order_by(Caso.numero.desc()).limit(500))]


@router.post("/contratos/{cid}/casos", response_model=CasoOut, status_code=201)
def criar_caso(cid: int, dados: CasoIn, ctx: Operador):
    contrato = _get(ctx, Contrato, cid, "Contrato")
    _validar_caso(ctx, dados)
    numero = (ctx.db.scalar(select(func.max(Caso.numero)).where(Caso.tenant_id == ctx.tenant_id)) or 0) + 1
    c = Caso(tenant_id=ctx.tenant_id, numero=numero, contrato_id=contrato.id, **dados.model_dump())
    c.data_abertura = c.data_abertura or date.today()
    ctx.db.add(c)
    ctx.db.flush()
    ctx.auditar("faturamento.caso.criar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
    disparar = _buscar_no_tribunal(ctx, c)
    ctx.db.commit()
    if disparar:
        disparar()
    ctx.db.refresh(c)
    return _caso_out(ctx, c)


@router.get("/casos/{cid}", response_model=CasoOut)
def ler_caso(cid: int, ctx: Ctx):
    return _caso_out(ctx, _get(ctx, Caso, cid, "Caso"))


@router.put("/casos/{cid}", response_model=CasoOut)
def alterar_caso(cid: int, dados: CasoIn, ctx: Operador):
    c = _get(ctx, Caso, cid, "Caso")
    _validar_caso(ctx, dados)
    numero_antes = c.numero_processo
    for k, v in dados.model_dump().items():
        setattr(c, k, v)
    ctx.auditar("faturamento.caso.alterar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
    disparar = _buscar_no_tribunal(ctx, c) if c.numero_processo != numero_antes else None
    ctx.db.commit()
    if disparar:
        disparar()
    return _caso_out(ctx, c)


def _buscar_no_tribunal(ctx, c: Caso):
    """Caso com número CNJ válido: capa, andamentos e autos vêm do tribunal por trás (fila). Devolve o disparo."""
    from app.modules.tribunais import cnj, jobs

    if not (c.numero_processo and cnj.valido(c.numero_processo)):
        return None
    jobs.enfileirar(ctx.db, ctx.tenant_id, "importar_caso", c.id, criado_por_id=ctx.usuario.id, max_tentativas=8)
    return jobs.disparar


@router.delete("/casos/{cid}", response_model=Mensagem)
def excluir_caso(cid: int, ctx: Admin):
    """Exclui o caso sem histórico; com horas, despesas, regras ou faturas, apenas encerra (o histórico fica)."""
    from app.modules.faturamento.models import RevisaoItem

    c = _get(ctx, Caso, cid, "Caso")
    historico = sum(ctx.db.scalar(select(func.count()).select_from(m).where(m.caso_id == cid)) or 0
                    for m in (Timesheet, Despesa, RegraCobranca, FaturaItem, RevisaoItem, Tarefa))
    if historico:
        c.status = StatusCaso.encerrado
        c.data_encerramento = c.data_encerramento or date.today()
        ctx.auditar("faturamento.caso.encerrar", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
        ctx.db.commit()
        return Mensagem(mensagem="O caso tem horas, despesas, regras ou faturas: foi encerrado (o histórico fica).")
    ctx.auditar("faturamento.caso.excluir", "fat_caso", c.id, descricao=f"#{c.numero} {c.titulo}")
    ctx.db.delete(c)
    ctx.db.commit()
    return Mensagem(mensagem="Caso excluído.")


# ================================================================ andamentos do caso
def _and_out(ctx, a: Andamento) -> AndamentoOut:
    resp = ctx.db.get(Usuario, a.responsavel_id) if a.responsavel_id else None
    autor = ctx.db.get(Usuario, a.criado_por_id) if a.criado_por_id else None
    return AndamentoOut.model_validate(a).model_copy(update={
        "responsavel_nome": resp.nome if resp else None, "criado_por": autor.nome if autor else None,
        "atrasado": bool(a.prazo and not a.concluido and a.prazo < date.today())})


def _andamento(ctx, aid: int) -> Andamento:
    a = ctx.db.get(Andamento, aid)
    if not a or a.caso.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Andamento não encontrado.")
    return a


@router.get("/casos/{cid}/andamentos", response_model=list[AndamentoOut])
def andamentos(cid: int, ctx: Ctx):
    return [_and_out(ctx, a) for a in _get(ctx, Caso, cid, "Caso").andamentos]


@router.post("/casos/{cid}/andamentos", response_model=AndamentoOut, status_code=201)
def criar_andamento(cid: int, dados: AndamentoIn, ctx: Operador):
    c = _get(ctx, Caso, cid, "Caso")
    if dados.responsavel_id:
        _get(ctx, Usuario, dados.responsavel_id, "Responsável")
    a = Andamento(caso_id=c.id, criado_por_id=ctx.usuario.id, **dados.model_dump())
    ctx.db.add(a)
    ctx.db.flush()
    ctx.auditar("faturamento.caso.andamento", "fat_caso", c.id, descricao=f"#{c.numero}: {a.titulo}")
    ctx.db.commit()
    return _and_out(ctx, a)


@router.put("/andamentos/{aid}", response_model=AndamentoOut)
def alterar_andamento(aid: int, dados: AndamentoIn, ctx: Operador):
    a = _andamento(ctx, aid)
    if dados.responsavel_id:
        _get(ctx, Usuario, dados.responsavel_id, "Responsável")
    for k, v in dados.model_dump().items():
        setattr(a, k, v)
    ctx.db.commit()
    return _and_out(ctx, a)


@router.delete("/andamentos/{aid}", response_model=Mensagem)
def excluir_andamento(aid: int, ctx: Operador):
    a = _andamento(ctx, aid)
    ctx.auditar("faturamento.caso.andamento_excluir", "fat_caso", a.caso_id, descricao=a.titulo)
    ctx.db.delete(a)
    ctx.db.commit()
    return Mensagem(mensagem="Andamento excluído.")


# ================================================================ IA do caso: preencher e resumir
def _ia(ctx, acao: str, sistema: str, usuario: str, anexo=None) -> dict:
    from app.core import ia

    try:
        p = ia.provedor_ativo(ctx.db, ctx.tenant_id)
        r = ia.gerar_json(p, sistema, usuario, anexo) if anexo else ia.gerar_json(p, sistema, usuario)
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    ctx.auditar(f"ia.{acao}", "ia", descricao=acao)
    ctx.db.commit()
    return r


SISTEMA_CASO = ("Você é assistente jurídico do MayaJus, sistema de gestão de um escritório de advocacia brasileiro. "
                "Escreva em português do Brasil, de forma objetiva e profissional, sem inventar fatos. "
                "Responda SOMENTE com um objeto JSON válido no formato pedido.")


@router.post("/casos/ia/preencher")
async def preencher_caso_ia(ctx: Operador, texto: str | None = Form(None), arquivo: UploadFile | None = File(None)):
    """Lê uma petição, decisão, e-mail ou texto colado e sugere os campos do caso (nada é salvo)."""
    from app.modules.rpa_nfse.leitura_nota import texto_do_pdf

    anexo, conteudo_txt = None, (texto or "").strip()
    if arquivo is not None:
        dados = await arquivo.read()
        if len(dados) > 15 * 1024 * 1024:
            raise HTTPException(400, "Arquivo maior que 15 MB.")
        nome = (arquivo.filename or "").lower()
        if nome.endswith(".pdf"):
            extraido = texto_do_pdf(dados)
            if len(extraido) > 200:
                conteudo_txt = (conteudo_txt + "\n\n" + extraido).strip()
            else:
                anexo = ("application/pdf", dados)  # PDF escaneado: a IA lê a imagem
        elif nome.endswith((".png", ".jpg", ".jpeg", ".webp")):
            anexo = (arquivo.content_type or "image/png", dados)
        elif nome.endswith(".docx"):
            import io
            import zipfile

            xml = zipfile.ZipFile(io.BytesIO(dados)).read("word/document.xml").decode("utf-8", "ignore")
            conteudo_txt = (conteudo_txt + "\n\n" + re.sub(r"<[^>]+>", " ", xml)).strip()
        elif nome.endswith(".txt"):
            conteudo_txt = (conteudo_txt + "\n\n" + dados.decode("utf-8", "ignore")).strip()
        else:
            raise HTTPException(400, "Envie PDF, DOCX, TXT ou imagem.")
    if not conteudo_txt and not anexo:
        raise HTTPException(400, "Cole um texto ou envie um arquivo.")
    areas_ = [a.nome for a in ctx.db.scalars(select(AreaAtuacao).where(AreaAtuacao.tenant_id == ctx.tenant_id, AreaAtuacao.ativo))]
    campos_ = list(ctx.db.scalars(select(CampoAdicional).where(CampoAdicional.tenant_id == ctx.tenant_id, CampoAdicional.ativo)))
    extra = {str(c.id): f"{c.nome} ({c.tipo.value}{': ' + '|'.join(c.opcoes) if c.opcoes else ''})" for c in campos_}
    formato = ('{"titulo": "título curto do caso", "numero_processo": "formato CNJ", "parte_contraria": str, '
               '"tipo": "consultivo|administrativo|judicial_estadual|judicial_federal|judicial_trabalhista", '
               '"polo": "ativo|passivo|terceiro|consultivo", "instancia": "primeira|juizado|segunda|turma_recursal|superior|stf", "tribunal": "ex.: TJSP", "vara": str, "comarca": str, '
               '"valor_causa": number, "data_distribuicao": "AAAA-MM-DD", "area": "uma das áreas", '
               '"descricao": "resumo do caso em 3-6 frases", "campos": {"<id>": valor}}')
    r = _ia(ctx, "preencher_caso", SISTEMA_CASO,
            "Extraia os dados do caso jurídico. Use null para o que não estiver no documento; nunca invente. "
            f"Áreas do escritório: {', '.join(areas_) or '(nenhuma cadastrada)'}. "
            f"Campos adicionais (id: nome e tipo): {extra or '{}'}.\nFormato: {formato}\n\nDocumento:\n{conteudo_txt[:30000]}",
            anexo)
    sug = {k: r.get(k) for k in ("titulo", "tipo", "instancia", "numero_processo", "parte_contraria", "polo", "tribunal", "vara", "comarca",
                                 "valor_causa", "data_distribuicao", "descricao") if r.get(k) not in (None, "", "null")}
    if sug.get("polo") not in ("ativo", "passivo", "terceiro", "consultivo"):
        sug.pop("polo", None)
    if sug.get("tipo") not in {t.value for t in TipoCaso}:
        sug.pop("tipo", None)
    if sug.get("instancia") not in INSTANCIAS:
        sug.pop("instancia", None)
    try:
        if "data_distribuicao" in sug:
            sug["data_distribuicao"] = date.fromisoformat(str(sug["data_distribuicao"])[:10]).isoformat()
    except ValueError:
        sug.pop("data_distribuicao")
    try:
        if "valor_causa" in sug:
            sug["valor_causa"] = str(Decimal(str(sug["valor_causa"]).replace(".", "").replace(",", "."))
                                     if "," in str(sug["valor_causa"]) else Decimal(str(sug["valor_causa"])))
    except (ArithmeticError, ValueError):
        sug.pop("valor_causa")
    area = next((a for a in ctx.db.scalars(select(AreaAtuacao).where(AreaAtuacao.tenant_id == ctx.tenant_id))
                 if r.get("area") and a.nome.lower() == str(r["area"]).lower()), None)
    if area:
        sug["area_id"] = area.id
    validos = {str(c.id): c for c in campos_}
    sug["campos"] = {k: v for k, v in (r.get("campos") or {}).items() if k in validos and v not in (None, "")
                     and (validos[k].tipo != TipoCampo.lista or str(v) in validos[k].opcoes)}
    return {"campos": sug}


class EnriquecerIn(BaseModel):
    tipo: str = Field(pattern="^(andamento|timesheet|tarefa)$")
    texto: str = Field(min_length=2, max_length=8000)
    titulo: str | None = Field(default=None, max_length=200)
    tipo_andamento: str | None = None
    caso_id: int | None = None
    minutos: int | None = None


@router.post("/ia/ler-recibo")
async def ler_recibo_ia(ctx: Operador, arquivo: UploadFile = File(...)):
    """Lê um recibo/comprovante (foto ou PDF) e sugere data, tipo, descrição e valor da despesa (nada é salvo)."""
    from app.modules.rpa_nfse.leitura_nota import texto_do_pdf

    dados = await arquivo.read()
    if len(dados) > 15 * 1024 * 1024:
        raise HTTPException(400, "Arquivo maior que 15 MB.")
    nome = (arquivo.filename or "").lower()
    texto, anexo = "", None
    if nome.endswith(".pdf"):
        texto = texto_do_pdf(dados)
        if len(texto) < 40:
            anexo = ("application/pdf", dados)  # PDF escaneado
    elif nome.endswith((".png", ".jpg", ".jpeg", ".webp", ".heic")):
        anexo = (arquivo.content_type or "image/jpeg", dados)
    else:
        raise HTTPException(400, "Envie foto ou PDF do recibo.")
    tipos = "custas|copias|deslocamento|correio|diligencia|honorario_perito|outros"
    r = _ia(ctx, "ler_recibo", SISTEMA_CASO,
            "Leia o recibo/comprovante de uma despesa de escritório de advocacia e extraia: data do pagamento, tipo "
            f"({tipos}: custas = guias/taxas judiciais e cartório; deslocamento = táxi, Uber, estacionamento, pedágio, "
            "combustível, passagem, hospedagem; correio = Correios/motoboy; copias = cópias/impressão/autenticação; "
            "diligencia = correspondente/diligência; honorario_perito = perito), descrição curta e clara (ex.: "
            "'Uber até o Fórum João Mendes', 'Guia de custas iniciais — TJSP') e valor total pago. Use null se não "
            'estiver legível; nunca invente. Formato: {"data": "AAAA-MM-DD", "tipo": "...", "descricao": str, "valor": number, '
            '"fornecedor": str}' + (f"\nTexto do recibo:\n{texto[:15000]}" if texto else ""), anexo)
    out: dict = {}
    try:
        if r.get("data"):
            out["data"] = date.fromisoformat(str(r["data"])[:10]).isoformat()
    except ValueError:
        pass
    if r.get("tipo") in {t.value for t in TipoDespesa}:
        out["tipo"] = r["tipo"]
    if r.get("descricao"):
        out["descricao"] = str(r["descricao"]).strip()[:300]
    try:
        if r.get("valor") not in (None, ""):
            v = str(r["valor"]).replace("R$", "").strip()
            v = v.replace(".", "").replace(",", ".") if "," in v else v
            out["valor"] = str(Decimal(v).quantize(Decimal("0.01")))
    except (ArithmeticError, ValueError):
        pass
    if r.get("fornecedor"):
        out["fornecedor"] = str(r["fornecedor"])[:200]
    return {"campos": out}


@router.post("/ia/enriquecer")
def enriquecer_ia(dados: EnriquecerIn, ctx: Operador):
    """Reescreve o texto curto do usuário de forma profissional (andamento do caso ou descrição de horas da fatura)."""
    caso = _get(ctx, Caso, dados.caso_id, "Caso") if dados.caso_id else None
    contexto = (f"Caso #{caso.numero} — {caso.titulo}" + (f" (processo {caso.numero_processo})" if caso.numero_processo else "")
                + (f", cliente {caso.contrato.tomador.nome}" if caso.contrato.tomador else "")) if caso else "—"
    if dados.tipo == "timesheet":
        pedido = ("Reescreva a descrição de horas trabalhadas para aparecer na fatura de honorários: objetiva, profissional, "
                  "no infinitivo ou substantivada (ex.: 'Elaboração de contestação…'), 1 a 3 frases, sem inventar fatos, "
                  "sem mencionar valores. "
                  + (f"Tempo: {dados.minutos // 60}h{dados.minutos % 60:02d}. " if dados.minutos else "")
                  + 'Formato: {"descricao": str}')
    elif dados.tipo == "tarefa":
        pedido = ("Melhore a tarefa do escritório: título curto no imperativo (até 80 caracteres, ex.: 'Protocolar contestação') "
                  "e descrição objetiva com o passo a passo/os pontos de atenção, mantendo datas, prazos, nomes e números citados; "
                  'sem inventar fatos. Formato: {"titulo": str, "descricao": str}')
    else:
        pedido = ("Melhore o registro de andamento do caso: título curto e claro (até 80 caracteres) e descrição completa, "
                  "organizada e profissional, mantendo datas, prazos, nomes e números citados; sem inventar fatos. "
                  + (f"Tipo: {dados.tipo_andamento}. " if dados.tipo_andamento else "")
                  + 'Formato: {"titulo": str, "descricao": str}')
    r = _ia(ctx, f"enriquecer_{dados.tipo}", SISTEMA_CASO,
            f"{pedido}\nContexto: {contexto}\n" + (f"Título atual: {dados.titulo}\n" if dados.titulo else "") + f"Texto:\n{dados.texto}")
    saida = {"descricao": str(r.get("descricao") or dados.texto).strip()[:5000]}
    if dados.tipo in ("andamento", "tarefa"):
        saida["titulo"] = str(r.get("titulo") or dados.titulo or "").strip()[:200]
    return saida


@router.post("/casos/{cid}/ia/resumo", response_model=ResumoCasoOut)
def resumir_caso_ia(cid: int, ctx: Operador):
    """Resumo executivo do caso: situação, próximos passos e riscos, a partir da ficha, andamentos, horas e despesas."""
    from app.core.db import agora

    c = _get(ctx, Caso, cid, "Caso")
    co = _caso_out(ctx, c)
    nomes = {str(cp.id): cp.nome for cp in ctx.db.scalars(select(CampoAdicional).where(CampoAdicional.tenant_id == ctx.tenant_id))}
    horas = list(ctx.db.scalars(select(Timesheet).where(Timesheet.caso_id == c.id).order_by(Timesheet.data.desc()).limit(40)))
    desp = list(ctx.db.scalars(select(Despesa).where(Despesa.caso_id == c.id).order_by(Despesa.data.desc()).limit(30)))
    dados = {
        "caso": {"numero": c.numero, "titulo": c.titulo, "cliente": co.tomador_nome, "contrato": co.contrato_nome,
                 "tipo": co.tipo_nome, "area": co.area_nome, "processo": c.numero_processo, "parte_contraria": c.parte_contraria, "polo": c.polo,
                 "tribunal": c.tribunal, "vara": c.vara, "comarca": c.comarca, "valor_causa": str(c.valor_causa or ""),
                 "distribuicao": str(c.data_distribuicao or ""), "abertura": str(c.data_abertura or ""), "status": c.status.value,
                 "responsavel": co.responsavel_nome, "descricao": c.descricao,
                 "campos": {nomes.get(k, k): v for k, v in (c.campos or {}).items()}},
        "andamentos": [{"data": str(a.data), "tipo": a.tipo.value, "titulo": a.titulo, "descricao": (a.descricao or "")[:1500],
                        "prazo": str(a.prazo or ""), "concluido": a.concluido} for a in c.andamentos[:60]],
        "horas": [{"data": str(t.data), "horas": round(t.minutos / 60, 2), "descricao": t.descricao[:300]} for t in horas],
        "total_horas": round(sum(t.minutos for t in horas) / 60, 2),
        "despesas": [{"data": str(d.data), "descricao": d.descricao, "valor": str(d.valor)} for d in desp],
        "anexos": [a.nome for a in c.anexos[:30]],
        "hoje": str(date.today()),
    }
    import json

    r = _ia(ctx, "resumo_caso", SISTEMA_CASO,
            'Faça um resumo executivo do caso para o sócio responsável. Formato: {"resumo": "1 parágrafo (4-7 frases)", '
            '"situacao_atual": "1-2 frases", "proximos_passos": ["até 5 ações objetivas, com prazos se houver"], '
            '"riscos": ["até 4 pontos de atenção (prazos vencidos, falta de andamento, horas sem faturar etc.)"]}\n'
            f"Dados: {json.dumps(dados, ensure_ascii=False)}")
    return ResumoCasoOut(resumo=str(r.get("resumo") or ""), situacao_atual=str(r.get("situacao_atual") or ""),
                         proximos_passos=[str(x) for x in (r.get("proximos_passos") or [])][:5],
                         riscos=[str(x) for x in (r.get("riscos") or [])][:4], gerado_em=agora().isoformat())


# ================================================================ anexos do caso
ANEXO_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".png", ".jpg", ".jpeg", ".webp",
             ".gif", ".zip", ".msg", ".eml", ".odt", ".ods", ".rtf", ".xml"}
ANEXO_MAX = 50 * 1024 * 1024


def _anexo_out(ctx, a: AnexoCaso) -> AnexoOut:
    u = ctx.db.get(Usuario, a.enviado_por_id) if a.enviado_por_id else None
    return AnexoOut(id=a.id, caso_id=a.caso_id, despesa_id=a.despesa_id, tarefa_id=a.tarefa_id, nome=a.nome, descricao=a.descricao, categoria=a.categoria, tamanho=a.tamanho,
                    mime=a.mime, enviado_por=u.nome if u else None, criado_em=a.criado_em.isoformat())


@router.get("/casos/{cid}/anexos", response_model=list[AnexoOut])
def anexos(cid: int, ctx: Ctx):
    c = _get(ctx, Caso, cid, "Caso")
    return [_anexo_out(ctx, a) for a in c.anexos]


@router.post("/casos/{cid}/anexos", response_model=list[AnexoOut], status_code=201)
async def enviar_anexos(cid: int, ctx: Operador, arquivos: list[UploadFile] = File(...), descricao: str | None = Form(None),
                        categoria: str | None = Form(None)):
    import uuid

    c = _get(ctx, Caso, cid, "Caso")
    pasta = Path(settings.storage_dir) / "casos" / str(c.id)
    pasta.mkdir(parents=True, exist_ok=True)
    novos = []
    for arq in arquivos:
        nome = Path(arq.filename or "arquivo").name
        ext = Path(nome).suffix.lower()
        if ext not in ANEXO_EXT:
            raise HTTPException(400, f"Tipo de arquivo não aceito: {nome}")
        conteudo = await arq.read()
        if len(conteudo) > ANEXO_MAX:
            raise HTTPException(400, f"{nome} passa de 50 MB.")
        destino = pasta / f"{uuid.uuid4().hex}{ext}"
        destino.write_bytes(conteudo)
        a = AnexoCaso(caso_id=c.id, nome=nome[:255], descricao=(descricao or "").strip()[:300] or None,
                      categoria=(categoria or "").strip()[:60] or None, caminho=str(destino), tamanho=len(conteudo),
                      mime=arq.content_type, enviado_por_id=ctx.usuario.id)
        ctx.db.add(a)
        novos.append(a)
    ctx.db.flush()
    ctx.auditar("faturamento.caso.anexo", "fat_caso", c.id, descricao=f"#{c.numero}: {', '.join(a.nome for a in novos)}")
    ctx.db.commit()
    return [_anexo_out(ctx, a) for a in novos]


@router.get("/anexos/{aid}")
def baixar_anexo(aid: int, ctx: Ctx, download: bool = False):
    a = ctx.db.get(AnexoCaso, aid)
    if not a or a.tenant_id != ctx.tenant_id or not Path(a.caminho).exists():
        raise HTTPException(404, "Anexo não encontrado.")
    return FileResponse(a.caminho, filename=a.nome, media_type=a.mime or None,
                        content_disposition_type="attachment" if download else "inline")


@router.patch("/anexos/{aid}", response_model=AnexoOut)
def alterar_anexo(aid: int, body: dict, ctx: Operador):
    a = ctx.db.get(AnexoCaso, aid)
    if not a or a.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Anexo não encontrado.")
    if "descricao" in body:
        a.descricao = (body.get("descricao") or "").strip()[:300] or None
    if "categoria" in body:
        a.categoria = (body.get("categoria") or "").strip()[:60] or None
    ctx.db.commit()
    return _anexo_out(ctx, a)


@router.delete("/anexos/{aid}", response_model=Mensagem)
def excluir_anexo(aid: int, ctx: Operador):
    a = ctx.db.get(AnexoCaso, aid)
    if not a or a.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Anexo não encontrado.")
    if a.despesa_id:
        raise HTTPException(400, "Este arquivo é o comprovante de uma despesa: troque ou exclua pela aba Despesas.")
    caminho = Path(a.caminho)
    ctx.auditar("faturamento.caso.anexo_excluir", "fat_caso", a.caso_id, descricao=a.nome)
    ctx.db.delete(a)
    ctx.db.commit()
    caminho.unlink(missing_ok=True)
    return Mensagem(mensagem="Anexo excluído.")


# ================================================================ áreas de atuação e campos adicionais (Configurações)
@router.get("/areas", response_model=list[AreaOut])
def areas(ctx: Ctx):
    qtd = dict(ctx.db.execute(select(Caso.area_id, func.count()).where(Caso.tenant_id == ctx.tenant_id).group_by(Caso.area_id)).all())
    return [AreaOut.model_validate(a).model_copy(update={"qtd_casos": qtd.get(a.id, 0)})
            for a in ctx.db.scalars(select(AreaAtuacao).where(AreaAtuacao.tenant_id == ctx.tenant_id)
                                    .order_by(AreaAtuacao.ordem, AreaAtuacao.nome))]


@router.post("/areas", response_model=AreaOut, status_code=201)
def criar_area(dados: AreaIn, ctx: Admin):
    if ctx.db.scalar(select(AreaAtuacao.id).where(AreaAtuacao.tenant_id == ctx.tenant_id,
                                                  func.lower(AreaAtuacao.nome) == dados.nome.strip().lower())):
        raise HTTPException(409, "Esta área já existe.")
    a = AreaAtuacao(tenant_id=ctx.tenant_id, **dados.model_dump())
    ctx.db.add(a)
    ctx.db.flush()
    ctx.auditar("faturamento.area.criar", "fat_area", a.id, descricao=a.nome)
    ctx.db.commit()
    return AreaOut.model_validate(a)


@router.put("/areas/{aid}", response_model=AreaOut)
def alterar_area(aid: int, dados: AreaIn, ctx: Admin):
    a = _get(ctx, AreaAtuacao, aid, "Área")
    for k, v in dados.model_dump().items():
        setattr(a, k, v)
    ctx.db.commit()
    return AreaOut.model_validate(a)


@router.delete("/areas/{aid}", response_model=Mensagem)
def excluir_area(aid: int, ctx: Admin):
    a = _get(ctx, AreaAtuacao, aid, "Área")
    if ctx.db.scalar(select(func.count()).select_from(Caso).where(Caso.area_id == aid)):
        a.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Área usada em casos: foi desativada.")
    ctx.db.delete(a)
    ctx.db.commit()
    return Mensagem(mensagem="Área excluída.")


@router.get("/campos", response_model=list[CampoOut])
def campos(ctx: Ctx, entidade: str = "caso"):
    lista = list(ctx.db.scalars(select(CampoAdicional).where(CampoAdicional.tenant_id == ctx.tenant_id,
                                                             CampoAdicional.entidade == entidade)
                                .order_by(CampoAdicional.ordem, CampoAdicional.id)))
    preenchidos: dict[str, int] = {}
    for vals in ctx.db.scalars(select(Caso.campos).where(Caso.tenant_id == ctx.tenant_id, Caso.campos.is_not(None))):
        for k in (vals or {}):
            preenchidos[k] = preenchidos.get(k, 0) + 1
    return [CampoOut.model_validate(cp).model_copy(update={"qtd_preenchidos": preenchidos.get(str(cp.id), 0)}) for cp in lista]


@router.post("/campos", response_model=CampoOut, status_code=201)
def criar_campo(dados: CampoIn, ctx: Admin):
    if dados.area_id:
        _get(ctx, AreaAtuacao, dados.area_id, "Área")
    ordem = (ctx.db.scalar(select(func.max(CampoAdicional.ordem)).where(CampoAdicional.tenant_id == ctx.tenant_id)) or 0) + 1
    cp = CampoAdicional(tenant_id=ctx.tenant_id, entidade="caso", **{**dados.model_dump(), "ordem": dados.ordem or ordem})
    ctx.db.add(cp)
    ctx.db.flush()
    ctx.auditar("faturamento.campo.criar", "fat_campo", cp.id, descricao=cp.nome)
    ctx.db.commit()
    return CampoOut.model_validate(cp)


@router.put("/campos/{fid}", response_model=CampoOut)
def alterar_campo(fid: int, dados: CampoIn, ctx: Admin):
    cp = _get(ctx, CampoAdicional, fid, "Campo")
    if dados.area_id:
        _get(ctx, AreaAtuacao, dados.area_id, "Área")
    for k, v in dados.model_dump().items():
        setattr(cp, k, v)
    ctx.db.commit()
    return CampoOut.model_validate(cp)


@router.post("/campos/ordem", response_model=Mensagem)
def ordenar_campos(body: dict, ctx: Admin):
    for i, fid in enumerate(body.get("ids") or []):
        _get(ctx, CampoAdicional, int(fid), "Campo").ordem = i + 1
    ctx.db.commit()
    return Mensagem(mensagem="Ordem salva.")


@router.delete("/campos/{fid}", response_model=Mensagem)
def excluir_campo(fid: int, ctx: Admin):
    cp = _get(ctx, CampoAdicional, fid, "Campo")
    usado = any(str(fid) in (v or {}) for v in ctx.db.scalars(select(Caso.campos).where(Caso.tenant_id == ctx.tenant_id)))
    if usado:
        cp.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Campo já preenchido em casos: foi desativado (os valores ficam guardados).")
    ctx.db.delete(cp)
    ctx.db.commit()
    return Mensagem(mensagem="Campo excluído.")


# ================================================================ regras de cobrança
_FREQ = {Frequencia.diaria: ("Diária", "dia", "dias"), Frequencia.semanal: ("Semanal", "semana", "semanas"),
         Frequencia.mensal: ("Mensal", "mês", "meses"), Frequencia.anual: ("Anual", "ano", "anos")}


def _resumo_regra(r: RegraCobranca) -> str:
    def brl(v):
        return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if v is not None else ""

    if r.tipo == TipoRegra.fixo:
        return f"{brl(r.valor)} em {r.data_pagamento:%d/%m/%Y}" if r.data_pagamento else brl(r.valor)
    if r.tipo == TipoRegra.hora:
        return f"Por hora · {r.tabela_preco.nome}" if r.tabela_preco else "Por hora · tabela do caso/contrato"
    nome, um, varios = _FREQ.get(r.frequencia, ("", "", ""))
    txt = f"{brl(r.valor)} · {nome.lower() if r.intervalo == 1 else f'a cada {r.intervalo} {varios}'}"
    if r.data_inicio:
        txt += f" · desde {r.data_inicio:%d/%m/%Y}"
    if r.termino == Termino.ocorrencias and r.ocorrencias:
        txt += f" · {r.ocorrencias} parcela{'s' if r.ocorrencias > 1 else ''}"
    elif r.termino == Termino.data and r.data_fim:
        txt += f" · até {r.data_fim:%d/%m/%Y}"
    else:
        txt += " · sem término"
    return txt


def _regra_out(ctx, r: RegraCobranca) -> RegraOut:
    faturadas = ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(
        FaturaItem.regra_id == r.id, FaturaItem.chave_cobranca.is_not(None))) or 0
    proxima = None
    if r.tipo == TipoRegra.recorrente:
        cobradas = set(ctx.db.scalars(select(FaturaItem.competencia).where(FaturaItem.regra_id == r.id)))
        limite = date(date.today().year + 30, 12, 31)
        proxima = next((d for _, d in service.ocorrencias(r, limite) if d not in cobradas), None)
    elif r.tipo == TipoRegra.fixo and not faturadas:
        proxima = r.data_pagamento
    return RegraOut.model_validate(r, from_attributes=True).model_copy(
        update={"resumo": _resumo_regra(r), "parcelas_faturadas": faturadas, "proxima": proxima})


@router.get("/regras", response_model=list[RegraOut])
def regras(ctx: Ctx, contrato_id: int | None = None, caso_id: int | None = None):
    sel = select(RegraCobranca).where(RegraCobranca.tenant_id == ctx.tenant_id)
    if caso_id:
        sel = sel.where(RegraCobranca.caso_id == caso_id)
    elif contrato_id:
        sel = sel.where(RegraCobranca.contrato_id == contrato_id, RegraCobranca.caso_id.is_(None))
    return [_regra_out(ctx, r) for r in ctx.db.scalars(sel.order_by(RegraCobranca.id))]


def _aplicar_regra(ctx, r: RegraCobranca, dados: RegraIn):
    if dados.tabela_preco_id:
        _get(ctx, TabelaPreco, dados.tabela_preco_id, "Tabela de preço")
    for k, v in dados.model_dump().items():
        setattr(r, k, v)
    if r.tipo != TipoRegra.recorrente:
        r.frequencia, r.data_inicio, r.termino, r.ocorrencias, r.data_fim = None, None, Termino.sem, None, None
    if r.tipo != TipoRegra.fixo:
        r.data_pagamento = None
    if r.tipo != TipoRegra.hora:
        r.tabela_preco_id = None
    else:
        r.valor = None


@router.post("/contratos/{cid}/regras", response_model=RegraOut, status_code=201)
def criar_regra_contrato(cid: int, dados: RegraIn, ctx: Operador):
    c = _get(ctx, Contrato, cid, "Contrato")
    return _criar_regra(ctx, c.id, None, dados)


@router.post("/casos/{cid}/regras", response_model=RegraOut, status_code=201)
def criar_regra_caso(cid: int, dados: RegraIn, ctx: Operador):
    c = _get(ctx, Caso, cid, "Caso")
    return _criar_regra(ctx, c.contrato_id, c.id, dados)


def _criar_regra(ctx, contrato_id: int, caso_id: int | None, dados: RegraIn) -> RegraOut:
    r = RegraCobranca(tenant_id=ctx.tenant_id, contrato_id=contrato_id, caso_id=caso_id)
    _aplicar_regra(ctx, r, dados)
    ctx.db.add(r)
    ctx.db.flush()
    ctx.auditar("faturamento.regra.criar", "fat_regra", r.id, descricao=f"{r.tipo.value}: {r.descricao}")
    ctx.db.commit()
    ctx.db.refresh(r)
    return _regra_out(ctx, r)


@router.put("/regras/{rid}", response_model=RegraOut)
def alterar_regra(rid: int, dados: RegraIn, ctx: Operador):
    r = _get(ctx, RegraCobranca, rid, "Regra")
    ja_cobrada = ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(FaturaItem.regra_id == rid))
    if ja_cobrada and dados.tipo != r.tipo:
        raise HTTPException(400, "Esta regra já foi faturada: não dá para mudar o tipo. Desative-a e crie outra.")
    _aplicar_regra(ctx, r, dados)
    ctx.auditar("faturamento.regra.alterar", "fat_regra", r.id, descricao=f"{r.tipo.value}: {r.descricao}")
    ctx.db.commit()
    ctx.db.refresh(r)
    return _regra_out(ctx, r)


@router.delete("/regras/{rid}", response_model=Mensagem)
def excluir_regra(rid: int, ctx: Operador):
    r = _get(ctx, RegraCobranca, rid, "Regra")
    if ctx.db.scalar(select(func.count()).select_from(FaturaItem).where(FaturaItem.regra_id == rid)):
        r.ativo = False
        ctx.db.commit()
        return Mensagem(mensagem="Regra já faturada: foi desativada (o histórico fica).")
    ctx.db.delete(r)
    ctx.auditar("faturamento.regra.excluir", "fat_regra", rid, descricao=r.descricao)
    ctx.db.commit()
    return Mensagem(mensagem="Regra excluída.")


@router.post("/regras/simular")
def simular_regra(dados: RegraIn, ctx: Ctx, ate: date | None = None):
    """Prévia das parcelas (para a tela mostrar "1ª 05/01 · 2ª 05/02 · ...")."""
    r = RegraCobranca(**dados.model_dump())
    limite = ate or date(date.today().year + 5, 12, 31)
    datas = service.ocorrencias(r, limite)[:60] if r.tipo == TipoRegra.recorrente else (
        [(1, r.data_pagamento)] if r.data_pagamento else [])
    return {"resumo": _resumo_regra(r), "parcelas": [{"n": n, "data": d} for n, d in datas],
            "total_parcelas": service.total_parcelas(r) if r.tipo == TipoRegra.recorrente else 1}


# ================================================================ timesheet
def _fatura_codigo(ctx, item_id: int | None) -> str | None:
    if not item_id:
        return None
    item = ctx.db.get(FaturaItem, item_id)
    return item.fatura.codigo if item else None


def _ts_out(ctx, t: Timesheet) -> TimesheetOut:
    p = t.profissional
    return TimesheetOut(id=t.id, caso_id=t.caso_id, profissional_id=t.profissional_id, profissional_nome=p.nome if p else "?",
                        cargo_nome=p.cargo.nome if p and p.cargo else None,
                        data=t.data, minutos=t.minutos, descricao=t.descricao, faturavel=t.faturavel,
                        faturado=t.fatura_item_id is not None, fatura_codigo=_fatura_codigo(ctx, t.fatura_item_id))


@router.get("/casos/{cid}/timesheet", response_model=list[TimesheetOut])
def timesheet(cid: int, ctx: Ctx):
    _get(ctx, Caso, cid, "Caso")
    return [_ts_out(ctx, t) for t in ctx.db.scalars(select(Timesheet).where(Timesheet.caso_id == cid)
                                                    .order_by(Timesheet.data.desc(), Timesheet.id.desc()))]


@router.post("/casos/{cid}/timesheet", response_model=TimesheetOut, status_code=201)
def lancar_horas(cid: int, dados: TimesheetIn, ctx: Operador):
    _get(ctx, Caso, cid, "Caso")
    pid = profissional_de(ctx, dados.profissional_id)
    t = Timesheet(tenant_id=ctx.tenant_id, caso_id=cid, profissional_id=pid, data=dados.data, minutos=dados.minutos,
                  descricao=dados.descricao, faturavel=dados.faturavel)
    ctx.db.add(t)
    ctx.db.commit()
    return _ts_out(ctx, t)


def profissional_de(ctx, profissional_id: int | None) -> int:
    """O funcionário escolhido ou, sem escolha, quem está lançando."""
    if profissional_id:
        p = _get(ctx, Usuario, profissional_id, "Profissional")
        if not p.ativo:
            raise HTTPException(400, f"{p.nome} está inativo.")
        return p.id
    return ctx.usuario.id


def _editavel(obj, nome: str):
    if obj.fatura_item_id:
        raise HTTPException(400, f"{nome} já faturado: cancele a fatura para alterar.")


@router.put("/timesheet/{tid}", response_model=TimesheetOut)
def alterar_horas(tid: int, dados: TimesheetIn, ctx: Operador):
    t = _get(ctx, Timesheet, tid, "Lançamento")
    _editavel(t, "Lançamento")
    if dados.profissional_id:
        t.profissional_id = profissional_de(ctx, dados.profissional_id)
    t.data, t.minutos, t.descricao, t.faturavel = dados.data, dados.minutos, dados.descricao, dados.faturavel
    ctx.db.commit()
    return _ts_out(ctx, t)


@router.delete("/timesheet/{tid}", response_model=Mensagem)
def excluir_horas(tid: int, ctx: Operador):
    t = _get(ctx, Timesheet, tid, "Lançamento")
    _editavel(t, "Lançamento")
    ctx.db.delete(t)
    ctx.db.commit()
    return Mensagem(mensagem="Lançamento excluído.")


# ================================================================ despesas
def _desp_out(ctx, d: Despesa) -> DespesaOut:
    u = ctx.db.get(Usuario, d.lancado_por_id) if d.lancado_por_id else None
    return DespesaOut(id=d.id, caso_id=d.caso_id, data=d.data, tipo=d.tipo, descricao=d.descricao, valor=d.valor,
                      reembolsavel=d.reembolsavel, tem_comprovante=bool(d.comprovante_path), lancado_por=u.nome if u else None,
                      faturado=d.fatura_item_id is not None, fatura_codigo=_fatura_codigo(ctx, d.fatura_item_id))


@router.get("/casos/{cid}/despesas", response_model=list[DespesaOut])
def despesas(cid: int, ctx: Ctx):
    _get(ctx, Caso, cid, "Caso")
    return [_desp_out(ctx, d) for d in ctx.db.scalars(select(Despesa).where(Despesa.caso_id == cid)
                                                      .order_by(Despesa.data.desc(), Despesa.id.desc()))]


@router.post("/casos/{cid}/despesas", response_model=DespesaOut, status_code=201)
def lancar_despesa(cid: int, dados: DespesaIn, ctx: Operador):
    _get(ctx, Caso, cid, "Caso")
    d = Despesa(tenant_id=ctx.tenant_id, caso_id=cid, lancado_por_id=ctx.usuario.id, **dados.model_dump())
    ctx.db.add(d)
    ctx.db.flush()
    ctx.auditar("faturamento.despesa.lancar", "fat_despesa", d.id, descricao=f"{d.descricao}: {d.valor}")
    ctx.db.commit()
    return _desp_out(ctx, d)


@router.put("/despesas/{did}", response_model=DespesaOut)
def alterar_despesa(did: int, dados: DespesaIn, ctx: Operador):
    d = _get(ctx, Despesa, did, "Despesa")
    _editavel(d, "Despesa")
    for k, v in dados.model_dump().items():
        setattr(d, k, v)
    ctx.db.commit()
    return _desp_out(ctx, d)


@router.delete("/despesas/{did}", response_model=Mensagem)
def excluir_despesa(did: int, ctx: Operador):
    d = _get(ctx, Despesa, did, "Despesa")
    _editavel(d, "Despesa")
    ctx.auditar("faturamento.despesa.excluir", "fat_despesa", d.id, descricao=f"{d.descricao}: {d.valor}")
    for anexo in ctx.db.scalars(select(AnexoCaso).where(AnexoCaso.despesa_id == d.id)):
        ctx.db.delete(anexo)
    ctx.db.delete(d)
    ctx.db.commit()
    return Mensagem(mensagem="Despesa excluída.")


@router.post("/despesas/{did}/comprovante", response_model=DespesaOut)
async def enviar_comprovante(did: int, ctx: Operador, arquivo: UploadFile = File(...)):
    d = _get(ctx, Despesa, did, "Despesa")
    ext = Path(arquivo.filename or "").suffix.lower()
    if ext not in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Envie PDF ou imagem.")
    conteudo = await arquivo.read()
    if len(conteudo) > COMPROVANTE_MAX:
        raise HTTPException(400, "Arquivo maior que 15 MB.")
    pasta = Path(settings.storage_dir) / "despesas" / f"{d.data:%Y}"
    pasta.mkdir(parents=True, exist_ok=True)
    destino = pasta / f"despesa_{d.id}{ext}"
    destino.write_bytes(conteudo)
    d.comprovante_path = str(destino)
    # o comprovante também aparece em Anexos do caso, na pasta "Despesas"
    anexo = ctx.db.scalar(select(AnexoCaso).where(AnexoCaso.despesa_id == d.id))
    if not anexo:
        anexo = AnexoCaso(caso_id=d.caso_id, despesa_id=d.id, categoria=PASTA_DESPESAS, caminho=str(destino), enviado_por_id=ctx.usuario.id)
        ctx.db.add(anexo)
    anexo.nome = (Path(arquivo.filename or "").name or destino.name)[:255]
    anexo.caminho, anexo.tamanho, anexo.mime = str(destino), len(conteudo), arquivo.content_type
    anexo.descricao = f"{d.data:%d/%m/%Y} · {d.descricao} · R$ {d.valor}"[:300]
    ctx.db.commit()
    return _desp_out(ctx, d)


PASTA_DESPESAS = "Despesas"


@router.get("/despesas/{did}/comprovante")
def baixar_comprovante(did: int, ctx: Ctx):
    d = _get(ctx, Despesa, did, "Despesa")
    if not d.comprovante_path or not Path(d.comprovante_path).exists():
        raise HTTPException(404, "Sem comprovante.")
    return FileResponse(d.comprovante_path, filename=Path(d.comprovante_path).name, content_disposition_type="inline")


# ================================================================ itens a faturar
@router.get("/itens-a-faturar", response_model=ItensAFaturarOut)
def itens_a_faturar(ctx: Ctx, de: date, ate: date, aba: str = Query("honorarios", pattern="^(honorarios|despesas)$"),
                    cliente_ids: list[int] | None = Query(None), tipos: list[str] | None = Query(None)):
    if ate < de:
        raise HTTPException(400, "O período está invertido.")
    dados = service.pendencias(ctx.db, ctx.tenant_id, aba=aba, de=de, ate=ate, cliente_ids=cliente_ids,
                               tipos=set(tipos) if tipos else None)
    casos_cache: dict[int, Caso] = {}

    def caso(cid):
        if cid and cid not in casos_cache:
            casos_cache[cid] = ctx.db.get(Caso, cid)
        return casos_cache.get(cid) if cid else None

    clientes = []
    for cp in dados:
        contratos_out, por_tipo = [], {}
        for contrato_id, itens in cp.contratos.items():
            c = ctx.db.get(Contrato, contrato_id)
            for p in itens:
                por_tipo[p.tipo] = por_tipo.get(p.tipo, Decimal(0)) + p.valor
            contratos_out.append(ContratoPendenteOut(
                contrato_id=c.id, contrato_numero=c.numero, contrato_nome=c.nome,
                total=sum((p.valor for p in itens), Decimal(0)),
                itens=[ItemPendenteOut(chave=p.chave, tipo=p.tipo, caso_id=p.caso_id,
                                       caso_numero=caso(p.caso_id).numero if caso(p.caso_id) else None,
                                       caso_titulo=caso(p.caso_id).titulo if caso(p.caso_id) else None,
                                       data=p.data, descricao=p.descricao, valor=p.valor, parcela=p.parcela,
                                       quantidade=p.quantidade, valor_unitario=p.valor_unitario,
                                       profissional=p.profissional, aviso=p.aviso) for p in itens]))
        contratos_out.sort(key=lambda x: x.contrato_numero)
        clientes.append(ClientePendenteOut(
            tomador_id=cp.tomador.id, tomador_nome=cp.tomador.nome, tomador_doc=cp.tomador.cpf_cnpj, total=cp.total,
            qtd_itens=sum(len(c.itens) for c in contratos_out), tipos=por_tipo, contratos=contratos_out))
    return ItensAFaturarOut(clientes=clientes, total=sum((c.total for c in clientes), Decimal(0)),
                            qtd_itens=sum(c.qtd_itens for c in clientes))


@router.post("/faturar", response_model=FaturarOut)
def faturar(dados: FaturarIn, ctx: Operador):
    from app.modules.rpa_nfse.service import config_nfse

    cfg = config_nfse(ctx.db, ctx.tenant_id)
    try:
        fats = service.faturar(ctx.db, ctx.tenant_id, aba=dados.aba, de=dados.de, ate=dados.ate, chaves=dados.chaves,
                               cliente_ids=dados.cliente_ids, tipos=set(dados.tipos) if dados.tipos else None,
                               dias_vencimento=cfg.fatura_dias_vencimento if cfg.fatura_dias_vencimento is not None else 10,
                               vencimento_na_emissao=cfg.fatura_vencimento_modo == "emissao")
    except service.RegraFaturamento as e:
        ctx.db.rollback()
        _erro(e)
    for f in fats:
        ctx.auditar("faturamento.faturar", "fatura", f.id, descricao=f"{f.codigo} — {f.valor}")
    ctx.db.commit()
    return FaturarOut(
        faturas=[FaturadaOut(id=f.id, codigo=f.codigo, tomador_nome=f.tomador.nome if f.tomador else "",
                             contrato_nome=ctx.db.get(Contrato, f.contrato_id).nome if f.contrato_id else None,
                             valor=f.valor, data_vencimento=f.data_vencimento) for f in fats],
        total=sum((f.valor for f in fats), Decimal(0)))


@router.post("/faturas/{fid}/cancelar", response_model=Mensagem)
def cancelar_fatura(fid: int, dados: CancelarFaturaIn, ctx: Admin):
    f = _get(ctx, Fatura, fid, "Fatura")
    try:
        service.cancelar(ctx.db, f, dados.motivo)
    except service.RegraFaturamento as e:
        _erro(e)
    ctx.auditar("faturamento.cancelar", "fatura", f.id, descricao=f"{f.codigo}: {dados.motivo}")
    ctx.db.commit()
    return Mensagem(mensagem=f"{f.codigo} cancelada. Os itens voltaram para Itens a faturar.")


@router.post("/emitir-nfse")
def emitir_nfse(dados: EmitirNfseIn, ctx: Operador):
    """Monta o lote de RPS das faturas NH escolhidas; a emissão segue pela tela do lote (pré-validação → emitir)."""
    try:
        lote = service.emitir_nfse(ctx.db, ctx.tenant_id, ctx.usuario.id, dados.fatura_ids)
    except service.RegraFaturamento as e:
        ctx.db.rollback()
        _erro(e)
    ctx.auditar("faturamento.emitir_nfse", "lote", lote.id, descricao=f"Lote #{lote.numero} com {len(dados.fatura_ids)} fatura(s)")
    ctx.db.commit()
    return {"lote_id": lote.id, "numero": lote.numero}
