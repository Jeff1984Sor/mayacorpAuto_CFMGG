"""Comissões: regras na ficha do profissional (Configurações › Profissionais) e a tela Financeiro › Comissões."""

import io
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.core.deps import Ctx, Operador
from app.core.models import Usuario
from app.core.schemas import Mensagem, Schema
from app.modules.comissoes import service
from app.modules.comissoes.models import ALCANCES, RegraComissao
from app.modules.faturamento.models import Caso, Contrato
from app.modules.rpa_nfse.models import Tomador

# as regras seguem a permissão dos profissionais (cfg_profissionais); a tela do financeiro, a de comissões
regras_router = APIRouter(prefix="/config/usuarios", tags=["Comissões"])
router = APIRouter(prefix="/financeiro/comissoes", tags=["Comissões"])

SITUACAO = "^(a_pagar|conta_gerada|paga)$"


# ================================================================ regras do profissional
class RegraIn(BaseModel):
    alcance: str = Field("geral", pattern="^(geral|cliente|contrato|caso)$")
    tomador_id: int | None = None
    contrato_id: int | None = None
    caso_id: int | None = None
    percentual: Decimal = Field(ge=0, le=100, max_digits=5, decimal_places=2)
    vigencia_inicio: date | None = None
    ativo: bool = True
    observacao: str | None = Field(None, max_length=200)


class RegraOut(Schema):
    id: int
    usuario_id: int
    alcance: str
    tomador_id: int | None
    contrato_id: int | None
    caso_id: int | None
    percentual: Decimal
    vigencia_inicio: date | None
    ativo: bool
    observacao: str | None
    alvo: str | None = None  # nome do cliente, contrato ou caso
    alvo_detalhe: str | None = None  # de quem é o contrato/caso


class AlvoOut(BaseModel):
    id: int
    rotulo: str
    detalhe: str | None = None


def _usuario(ctx, uid: int) -> Usuario:
    u = ctx.db.get(Usuario, uid)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Profissional não encontrado.")
    return u


def _alvo(ctx, r: RegraComissao) -> tuple[str | None, str | None]:
    if r.alcance == "cliente" and (t := ctx.db.get(Tomador, r.tomador_id)):
        return t.nome, None
    if r.alcance == "contrato" and (c := ctx.db.get(Contrato, r.contrato_id)):
        return f"#{c.numero} — {c.nome}", c.tomador.nome if c.tomador else None
    if r.alcance == "caso" and (k := ctx.db.get(Caso, r.caso_id)):
        dono = k.contrato.tomador if k.contrato else None
        return f"#{k.numero} — {k.titulo}", dono.nome if dono else None
    return None, None


def _regra_out(ctx, r: RegraComissao) -> RegraOut:
    alvo, detalhe = _alvo(ctx, r)
    return RegraOut.model_validate(r).model_copy(update={"alvo": alvo, "alvo_detalhe": detalhe})


def _aplicar(ctx, r: RegraComissao, dados: RegraIn) -> None:
    modelo, campo, nome = {"cliente": (Tomador, "tomador_id", "o cliente"), "contrato": (Contrato, "contrato_id", "o contrato"),
                           "caso": (Caso, "caso_id", "o caso")}.get(dados.alcance, (None, None, None))
    alvo_id = getattr(dados, campo) if campo else None
    if modelo:
        alvo = ctx.db.get(modelo, alvo_id) if alvo_id else None
        if not alvo or alvo.tenant_id != ctx.tenant_id:
            raise HTTPException(400, f"Escolha {nome} desta comissão.")
    r.alcance, r.percentual, r.vigencia_inicio = dados.alcance, dados.percentual, dados.vigencia_inicio
    r.ativo, r.observacao = dados.ativo, (dados.observacao or "").strip() or None
    r.tomador_id = r.contrato_id = r.caso_id = None
    if campo:
        setattr(r, campo, alvo_id)
    igual = ctx.db.scalar(select(RegraComissao.id).where(
        RegraComissao.usuario_id == r.usuario_id, RegraComissao.id != (r.id or 0), RegraComissao.alcance == r.alcance,
        RegraComissao.tomador_id.is_(None) if r.tomador_id is None else RegraComissao.tomador_id == r.tomador_id,
        RegraComissao.contrato_id.is_(None) if r.contrato_id is None else RegraComissao.contrato_id == r.contrato_id,
        RegraComissao.caso_id.is_(None) if r.caso_id is None else RegraComissao.caso_id == r.caso_id,
        RegraComissao.vigencia_inicio.is_(None) if r.vigencia_inicio is None
        else RegraComissao.vigencia_inicio == r.vigencia_inicio))
    if igual:
        raise HTTPException(400, "Já existe uma comissão igual para este profissional (mesmo alcance e mesma vigência). "
                                 "Altere a que já existe.")


def _texto(ctx, r: RegraComissao) -> str:
    alvo, _ = _alvo(ctx, r)
    return f"{service.pct(r.percentual)} · {service.ROTULO_ALCANCE[r.alcance]}" + (f": {alvo}" if alvo else "")


@regras_router.get("/comissoes/alvos", response_model=list[AlvoOut])
def buscar_alvos(ctx: Ctx, alcance: str = Query(pattern="^(cliente|contrato|caso)$"), q: str = ""):
    """Busca do cliente, contrato ou caso para a regra (até 20 resultados)."""
    termo, db, t = q.strip(), ctx.db, ctx.tenant_id
    numero = int(termo.lstrip("#")) if termo.lstrip("#").isdigit() and len(termo) < 9 else None
    if alcance == "cliente":
        f = [Tomador.tenant_id == t]
        if termo:
            f.append(or_(Tomador.nome.ilike(f"%{termo}%"), Tomador.cpf_cnpj.like(f"{termo}%")))
        return [AlvoOut(id=x.id, rotulo=x.nome) for x in db.scalars(select(Tomador).where(*f).order_by(Tomador.nome).limit(20))]
    if alcance == "contrato":
        f = [Contrato.tenant_id == t]
        if termo:
            f.append(or_(Contrato.nome.ilike(f"%{termo}%"), Contrato.numero == numero,
                         Contrato.tomador_id.in_(select(Tomador.id).where(Tomador.nome.ilike(f"%{termo}%")))))
        return [AlvoOut(id=c.id, rotulo=f"#{c.numero} — {c.nome}", detalhe=c.tomador.nome if c.tomador else None)
                for c in db.scalars(select(Contrato).where(*f).order_by(Contrato.numero.desc()).limit(20))]
    f = [Caso.tenant_id == t]
    if termo:
        f.append(or_(Caso.titulo.ilike(f"%{termo}%"), Caso.numero == numero, Caso.numero_processo.ilike(f"%{termo}%")))
    return [AlvoOut(id=k.id, rotulo=f"#{k.numero} — {k.titulo}",
                    detalhe=k.contrato.tomador.nome if k.contrato and k.contrato.tomador else None)
            for k in db.scalars(select(Caso).where(*f).order_by(Caso.numero.desc()).limit(20))]


@regras_router.get("/{uid}/comissoes", response_model=list[RegraOut])
def listar_regras(uid: int, ctx: Ctx):
    _usuario(ctx, uid)
    regras = ctx.db.scalars(select(RegraComissao).where(RegraComissao.tenant_id == ctx.tenant_id, RegraComissao.usuario_id == uid)
                            .order_by(RegraComissao.id))
    return sorted((_regra_out(ctx, r) for r in regras), key=lambda r: (ALCANCES.index(r.alcance), r.alvo or "", r.id))


@regras_router.post("/{uid}/comissoes", response_model=RegraOut, status_code=201)
def criar_regra(uid: int, dados: RegraIn, ctx: Operador):
    u = _usuario(ctx, uid)
    r = RegraComissao(tenant_id=ctx.tenant_id, usuario_id=u.id)
    _aplicar(ctx, r, dados)
    ctx.db.add(r)
    ctx.db.flush()
    ctx.auditar("comissao.regra.criar", "com_regra", r.id, descricao=f"{u.nome}: {_texto(ctx, r)}")
    ctx.db.commit()
    return _regra_out(ctx, r)


def _regra(ctx, uid: int, rid: int) -> RegraComissao:
    r = ctx.db.get(RegraComissao, rid)
    if not r or r.tenant_id != ctx.tenant_id or r.usuario_id != uid:
        raise HTTPException(404, "Comissão não encontrada.")
    return r


@regras_router.put("/{uid}/comissoes/{rid}", response_model=RegraOut)
def alterar_regra(uid: int, rid: int, dados: RegraIn, ctx: Operador):
    u, r = _usuario(ctx, uid), _regra(ctx, uid, rid)
    antes = _texto(ctx, r) + ("" if r.ativo else " (inativa)")
    _aplicar(ctx, r, dados)
    ctx.auditar("comissao.regra.alterar", "com_regra", r.id, descricao=f"{u.nome}: {_texto(ctx, r)}",
                antes={"regra": antes}, depois={"regra": _texto(ctx, r) + ("" if r.ativo else " (inativa)")})
    ctx.db.commit()
    return _regra_out(ctx, r)


@regras_router.delete("/{uid}/comissoes/{rid}", response_model=Mensagem)
def excluir_regra(uid: int, rid: int, ctx: Operador):
    u, r = _usuario(ctx, uid), _regra(ctx, uid, rid)
    ctx.auditar("comissao.regra.excluir", "com_regra", r.id, descricao=f"{u.nome}: {_texto(ctx, r)}")
    ctx.db.delete(r)
    ctx.db.commit()
    return Mensagem(mensagem="Comissão excluída.")


# ================================================================ Financeiro › Comissões
class ItemComissao(BaseModel):
    fatura_id: int
    usuario_id: int


class GerarContaIn(BaseModel):
    itens: list[ItemComissao] = Field(min_length=1, max_length=2000)
    data_vencimento: date
    categoria_id: int | None = None  # vazio = categoria "Comissões" (criada se não existir)
    de: date
    ate: date
    observacao: str | None = Field(None, max_length=500)


def _periodo(de: date | None, ate: date | None) -> tuple[date, date]:
    ini, fim = service.mes_atual()
    de, ate = de or ini, ate or fim
    if ate < de:
        raise HTTPException(400, "O fim do período não pode ser antes do início.")
    return de, ate


@router.get("")
def comissoes(ctx: Ctx, de: date | None = None, ate: date | None = None, usuario_id: int | None = None,
              tomador_id: int | None = None, situacao: str | None = Query(None, pattern=SITUACAO)):
    """Comissões dos recebimentos do período (data do pagamento; padrão: mês atual)."""
    de, ate = _periodo(de, ate)
    return service.apurar(ctx.db, ctx.tenant_id, de=de, ate=ate, usuario_id=usuario_id, tomador_id=tomador_id,
                          situacao=situacao)


@router.get("/exportar.xlsx")
def exportar(ctx: Ctx, de: date | None = None, ate: date | None = None, usuario_id: int | None = None,
             tomador_id: int | None = None, situacao: str | None = Query(None, pattern=SITUACAO)):
    de, ate = _periodo(de, ate)
    r = service.apurar(ctx.db, ctx.tenant_id, de=de, ate=ate, usuario_id=usuario_id, tomador_id=tomador_id, situacao=situacao)
    from app.modules.financas.routes import _xlsx

    return _xlsx(_planilha(r, de, ate), f"comissoes_{de:%Y-%m-%d}_a_{ate:%Y-%m-%d}.xlsx")


@router.post("/gerar-conta", status_code=201)
def gerar_conta(dados: GerarContaIn, ctx: Operador):
    """Cria uma conta a pagar por profissional com as comissões escolhidas."""
    try:
        r = service.gerar_contas(ctx.db, ctx.tenant_id, ctx.usuario, itens=[(i.fatura_id, i.usuario_id) for i in dados.itens],
                                 vencimento=dados.data_vencimento, categoria_id=dados.categoria_id, de=dados.de, ate=dados.ate,
                                 observacao=(dados.observacao or "").strip() or None)
    except service.RegraComissoes as e:
        ctx.db.rollback()
        raise HTTPException(400, str(e)) from e
    for c in r["contas"]:
        ctx.auditar("comissao.gerar_conta", "fin_conta_pagar", c["id"],
                    descricao=f"{c['descricao']}: {service.brl(c['valor'])} ({c['comissoes']} recebimento(s))")
    ctx.db.commit()
    return r


def _planilha(r: dict, de: date, ate: date) -> bytes:
    """Excel: aba com o detalhe (uma linha por recebimento × profissional × caso) e aba com o resumo por profissional."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    from app.modules.financas.planilhas import BRL, CABECALHO, DATA, FONTE_CAB, NAVY

    def folha(ws, titulo: str, cabecalho: list[str], linhas: list[list], larguras: list[int], moeda: set[int],
              datas: frozenset[int] = frozenset(), rodape: list | None = None):
        ws.title = titulo
        ws.cell(1, 1, f"Comissões — {service.rotulo_periodo(de, ate)}").font = Font(bold=True, size=13, color=NAVY)
        ws.cell(2, 1, "Percentual sobre o que o cliente pagou em honorários, pela data do pagamento.").font = Font(color="444444")
        for i, h in enumerate(cabecalho, start=1):
            c = ws.cell(4, i, h)
            c.fill, c.font, c.alignment = CABECALHO, FONTE_CAB, Alignment(vertical="center")
        n = 4
        for linha in linhas + ([rodape] if rodape else []):
            n += 1
            for i, v in enumerate(linha, start=1):
                c = ws.cell(n, i, float(v) if isinstance(v, Decimal) else v)
                if i - 1 in moeda:
                    c.number_format = BRL
                if i - 1 in datas:
                    c.number_format = DATA
                if rodape and linha is rodape:
                    c.font = Font(bold=True)
        for i, w in enumerate(larguras, start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.auto_filter.ref = f"A4:{get_column_letter(len(cabecalho))}{max(4, 4 + len(linhas))}"
        ws.freeze_panes = ws.cell(5, 1)

    wb = Workbook()
    linhas = r["linhas"]
    k = r["kpis"]
    folha(wb.active, "Comissões",
          ["Profissional", "Fatura", "Cliente", "Contrato", "Caso", "Área", "Pago em", "Valor recebido", "%", "Comissão",
           "Regra aplicada", "Situação", "Conta a pagar", "Divergência"],
          [[x["profissional"], x["fatura"], x["cliente"], x["contrato"], x["caso"], x["area"], x["pago_em"], x["base"],
            float(x["percentual"]) if x["percentual"] is not None else None, x["comissao"], x["regra"],
            service.ROTULO_SITUACAO[x["situacao"]], x["conta_descricao"], x["divergencia"]] for x in linhas],
          [28, 12, 34, 30, 36, 18, 12, 16, 8, 16, 34, 14, 40, 60], moeda={7, 9}, datas=frozenset({6}),
          rodape=["Total", None, None, None, None, None, None, k["base"], None, k["comissao"]] if linhas else None)
    resumo: dict[str, dict] = {}
    for x in linhas:
        g = resumo.setdefault(x["profissional"], {"base": Decimal(0), "comissao": Decimal(0), "a_pagar": Decimal(0),
                                                  "conta_gerada": Decimal(0), "paga": Decimal(0)})
        g["base"] += x["base"]
        g["comissao"] += x["comissao"]
        g[x["situacao"]] += x["comissao"]
    folha(wb.create_sheet(), "Por profissional",
          ["Profissional", "Valor recebido", "Comissão", "A pagar", "Conta gerada", "Paga"],
          [[nome, g["base"], g["comissao"], g["a_pagar"], g["conta_gerada"], g["paga"]] for nome, g in sorted(resumo.items())],
          [32, 18, 16, 16, 16, 16], moeda={1, 2, 3, 4, 5},
          rodape=["Total", None, k["comissao"], k["a_pagar"], k["conta_gerada"], k["paga"]] if linhas else None)
    if r["divergencias"]:
        folha(wb.create_sheet(), "Divergências", ["Profissional", "Fatura", "Cliente", "Pago em", "Comissão lançada",
                                                  "Conta a pagar", "O que aconteceu"],
              [[x["profissional"], x["fatura"], x["cliente"], x["pago_em"], x["comissao"], x["conta_descricao"], x["divergencia"]]
               for x in r["divergencias"]], [28, 12, 34, 12, 18, 40, 70], moeda={4}, datas=frozenset({3}))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
