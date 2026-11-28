"""Fontes de dados dos relatórios.

Cada fonte declara as colunas (rótulo, tipo, permissão) e sabe carregar as linhas do escritório como dicionários
{id da coluna: valor}. Só o período da data principal vai para o SQL; os demais filtros, o agrupamento e o gráfico
ficam com o motor (motor.py), igual para todas as fontes.

Quem não pode ver um dado não recebe a coluna: dinheiro de horas e faturas exige acesso ao faturamento, e quem só vê
as próprias horas/tarefas recebe só as suas.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from app.core.models import Cargo, Usuario
from app.modules.faturamento.models import (
    ROTULO_TIPO_CASO,
    Andamento,
    AreaAtuacao,
    CampoAdicional,
    Caso,
    Contrato,
    Despesa,
    FaturaItem,
    RegraCobranca,
    StatusCaso,
    StatusTarefa,
    TabelaPreco,
    TabelaPrecoItem,
    Tarefa,
    Timesheet,
)
from app.modules.rpa_nfse.models import Emissora, Fatura, Nfse, StatusFatura, TipoFatura, Tomador

NUMERICOS = {"numero", "moeda", "horas"}
FINANCEIRO = "faturas.ver"  # valor de horas e faturas


@dataclass
class Coluna:
    id: str
    rotulo: str
    tipo: str  # texto | longo | lista | data | bool | numero | moeda | horas
    padrao: bool = False  # entra no relatório novo
    permissao: str | None = None
    somar: bool = True  # False = número de identificação (Nº do caso): não tem total

    def meta(self) -> dict:
        return {"id": self.id, "rotulo": self.rotulo, "tipo": self.tipo, "padrao": self.padrao}


@dataclass
class Fonte:
    id: str
    nome: str
    descricao: str
    icone: str
    permissao: str
    rotulo_contagem: str  # "Casos", "Lançamentos"...
    data_principal: str | None
    _colunas: Callable[[object], list[Coluna]]
    _carregar: Callable[[object, date | None, date | None], list[dict]]
    extra: dict = field(default_factory=dict)

    def colunas(self, ctx) -> list[Coluna]:
        from app.modules.faturamento.service import usa_contrato

        cols = [c for c in self._colunas(ctx) if not c.permissao or ctx.pode(c.permissao)]
        if not usa_contrato(ctx.db, ctx.tenant_id):  # só cliente e caso: nada de coluna de contrato
            cols = [c for c in cols if not c.id.startswith("contrato")]
        return cols

    def carregar(self, ctx, de: date | None = None, ate: date | None = None) -> list[dict]:
        return self._carregar(ctx, de, ate)


# ------------------------------------------------------------------------------------------------ rótulos
def _v(x):
    return getattr(x, "value", x)


def _num(x) -> float | None:
    return None if x is None else float(x)


SIM_NAO = {True: "Sim", False: "Não"}
STATUS_CASO = {"aberto": "Aberto", "suspenso": "Suspenso", "arquivado": "Arquivado", "encerrado": "Encerrado"}
TIPO_CASO = {k.value: v for k, v in ROTULO_TIPO_CASO.items()}
POLO = {"ativo": "Ativo (autor)", "passivo": "Passivo (réu)", "terceiro": "Terceiro interessado", "consultivo": "Consultivo"}
INSTANCIA = {"primeira": "1ª instância", "juizado": "Juizado", "segunda": "2ª instância", "turma_recursal": "Turma recursal",
             "superior": "Tribunal superior", "stf": "STF"}
TIPO_ANDAMENTO = {"andamento": "Andamento", "publicacao": "Publicação", "despacho": "Despacho", "decisao": "Decisão",
                  "sentenca": "Sentença", "audiencia": "Audiência", "prazo": "Prazo", "reuniao": "Reunião", "nota": "Nota interna"}
TIPO_TAREFA = {"prazo": "Prazo", "audiencia": "Audiência", "diligencia": "Diligência", "reuniao": "Reunião", "peticao": "Petição",
               "ligacao": "Ligação", "administrativo": "Administrativo", "outro": "Outro"}
STATUS_TAREFA = {"a_fazer": "A fazer", "em_andamento": "Em andamento", "concluida": "Concluída", "cancelada": "Cancelada"}
PRIORIDADE = {"baixa": "Baixa", "media": "Média", "alta": "Alta", "urgente": "Urgente"}
TIPO_REGRA = {"fixo": "Fixo", "recorrente": "Recorrente", "hora": "Por hora"}
FREQ = {"diaria": ("Diária", "dias"), "semanal": ("Semanal", "semanas"), "mensal": ("Mensal", "meses"), "anual": ("Anual", "anos")}
TIPO_DESPESA = {"custas": "Custas", "copias": "Cópias", "deslocamento": "Deslocamento", "correio": "Correio",
                "diligencia": "Diligência", "honorario_perito": "Honorários de perito", "outros": "Outros"}
SITUACAO_FATURA = {"aberta": "Em aberto", "vencida": "Vencida", "paga": "Paga", "cancelada": "Cancelada"}


_BRT = timezone(timedelta(hours=-3))


def _dia(dt: datetime | None) -> date | None:
    """Data (no horário de Brasília) de um carimbo de criação/alteração gravado em UTC."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(_BRT).date()


def _doc(v: str | None) -> str | None:
    d = "".join(ch for ch in (v or "") if ch.isdigit())
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return v or None


def _periodo(sel, coluna, de, ate):
    if de:
        sel = sel.where(coluna >= de)
    if ate:
        sel = sel.where(coluna <= ate)
    return sel


def _linhas(ctx, sel) -> list[dict]:
    return [dict(r._mapping) for r in ctx.db.execute(sel)]


# ------------------------------------------------------------------------------------------------ horas
def _col_horas(ctx) -> list[Coluna]:
    return [
        Coluna("data", "Data", "data", True),
        Coluna("cliente", "Cliente", "lista", True),
        Coluna("contrato", "Contrato", "lista"),
        Coluna("caso_numero", "Nº do caso", "numero", somar=False),
        Coluna("caso", "Caso", "lista", True),
        Coluna("area", "Área", "lista"),
        Coluna("profissional", "Profissional", "lista", True),
        Coluna("cargo", "Cargo", "lista"),
        Coluna("descricao", "Descrição", "longo", True),
        Coluna("horas", "Horas", "horas", True),
        Coluna("situacao", "Situação", "lista"),
        Coluna("faturavel", "Faturável", "bool"),
        Coluna("fatura", "Fatura", "texto"),
        Coluna("caso_status", "Status do caso", "lista"),
        Coluna("caso_tipo", "Tipo do caso", "lista"),
        Coluna("processo", "Nº do processo", "texto"),
        Coluna("responsavel", "Responsável pelo caso", "lista"),
        Coluna("cliente_uf", "UF do cliente", "lista"),
        Coluna("cadastro", "Lançado em", "data"),
        Coluna("valor_hora", "Valor/hora", "moeda", permissao=FINANCEIRO),
        Coluna("valor", "Valor", "moeda", True, permissao=FINANCEIRO),
    ]


def _carregar_horas(ctx, de, ate) -> list[dict]:
    p, resp = aliased(Usuario), aliased(Usuario)
    tabela = func.coalesce(Caso.tabela_preco_id, Contrato.tabela_preco_id)
    sel = (select(Timesheet.data, Timesheet.minutos, Timesheet.descricao, Timesheet.faturavel,
                  Timesheet.fatura_item_id.label("item"), Caso.numero.label("caso_numero"), Caso.titulo.label("caso"),
                  Contrato.nome.label("contrato"), Tomador.nome.label("cliente"), p.nome.label("profissional"),
                  Cargo.nome.label("cargo"), AreaAtuacao.nome.label("area"), FaturaItem.valor_unitario.label("vh_fatura"),
                  Fatura.tipo.label("f_tipo"), Fatura.numero.label("f_numero"), TabelaPrecoItem.valor_hora.label("vh_tabela"),
                  Caso.status.label("c_status"), Caso.tipo.label("c_tipo"), Caso.numero_processo.label("processo"),
                  resp.nome.label("responsavel"), Tomador.uf.label("cliente_uf"), Timesheet.criado_em.label("criado"))
           .join(Caso, Timesheet.caso_id == Caso.id).join(Contrato, Caso.contrato_id == Contrato.id)
           .join(Tomador, Contrato.tomador_id == Tomador.id).join(p, Timesheet.profissional_id == p.id)
           .outerjoin(Cargo, p.cargo_id == Cargo.id).outerjoin(AreaAtuacao, Caso.area_id == AreaAtuacao.id)
           .outerjoin(resp, Caso.responsavel_id == resp.id)
           .outerjoin(FaturaItem, Timesheet.fatura_item_id == FaturaItem.id)
           .outerjoin(Fatura, FaturaItem.fatura_id == Fatura.id)
           .outerjoin(TabelaPrecoItem, and_(TabelaPrecoItem.tabela_id == tabela, TabelaPrecoItem.cargo_id == p.cargo_id))
           .where(Timesheet.tenant_id == ctx.tenant_id))
    if not ctx.pode("timesheet.ver_todos"):
        sel = sel.where(Timesheet.profissional_id == ctx.usuario.id)
    out = []
    for r in _linhas(ctx, _periodo(sel, Timesheet.data, de, ate)):
        horas = (r["minutos"] or 0) / 60
        faturada = r["item"] is not None
        vh = r["vh_fatura"] if faturada and r["vh_fatura"] is not None else r["vh_tabela"]
        out.append({
            "data": r["data"], "cliente": r["cliente"], "contrato": r["contrato"], "caso_numero": r["caso_numero"],
            "caso": r["caso"], "area": r["area"], "profissional": r["profissional"], "cargo": r["cargo"],
            "descricao": r["descricao"], "horas": horas, "faturavel": bool(r["faturavel"]),
            "situacao": "Faturada" if faturada else ("A faturar" if r["faturavel"] else "Não faturável"),
            "fatura": (f"{'ND' if r['f_tipo'] == TipoFatura.despesas else 'NH'} {r['f_numero']:05d}" if r["f_numero"] else None),
            "caso_status": STATUS_CASO.get(_v(r["c_status"])), "caso_tipo": TIPO_CASO.get(_v(r["c_tipo"])),
            "processo": r["processo"], "responsavel": r["responsavel"], "cliente_uf": r["cliente_uf"],
            "cadastro": _dia(r["criado"]),
            "valor_hora": _num(vh), "valor": round(horas * float(vh), 2) if vh is not None and r["faturavel"] else None,
        })
    return out


# ------------------------------------------------------------------------------------------------ casos
_TIPO_CAMPO = {"texto": "texto", "texto_longo": "longo", "numero": "numero", "moeda": "moeda", "data": "data",
               "sim_nao": "bool", "lista": "lista"}


def _campos(ctx) -> list[CampoAdicional]:
    return list(ctx.db.scalars(select(CampoAdicional).where(
        CampoAdicional.tenant_id == ctx.tenant_id, CampoAdicional.entidade == "caso", CampoAdicional.ativo.is_(True))
        .order_by(CampoAdicional.ordem, CampoAdicional.id)))


def _col_casos(ctx) -> list[Coluna]:
    base = [
        Coluna("numero", "Nº", "numero", True, somar=False),
        Coluna("titulo", "Título", "texto", True),
        Coluna("cliente", "Cliente", "lista", True),
        Coluna("contrato", "Contrato", "lista"),
        Coluna("area", "Área", "lista", True),
        Coluna("tipo", "Tipo", "lista"),
        Coluna("tipo_caso", "Tipo de caso", "lista"),
        Coluna("fase", "Fase / etapa", "lista"),
        Coluna("prognostico", "Prognóstico", "lista"),
        Coluna("partes", "Partes", "texto"),
        Coluna("status", "Status", "lista", True),
        Coluna("responsavel", "Responsável", "lista", True),
        Coluna("cadastro", "Data de cadastro", "data"),
        Coluna("alteracao", "Última alteração", "data"),
        Coluna("descricao", "Descrição", "longo"),
        Coluna("tem_processo", "Tem nº de processo", "bool"),
        Coluna("processo", "Nº do processo", "texto"),
        Coluna("parte_contraria", "Parte contrária", "texto"),
        Coluna("polo", "Polo", "lista"),
        Coluna("instancia", "Instância", "lista"),
        Coluna("tribunal", "Tribunal", "lista"),
        Coluna("vara", "Vara", "lista"),
        Coluna("comarca", "Comarca", "lista"),
        Coluna("foro", "Foro", "lista"),
        Coluna("valor_causa", "Valor da causa", "moeda"),
        Coluna("abertura", "Abertura", "data"),
        Coluna("distribuicao", "Distribuição", "data"),
        Coluna("encerramento", "Encerramento", "data"),
        Coluna("dias", "Dias em andamento", "numero"),
        Coluna("horas", "Horas lançadas", "horas"),
        Coluna("tarefas_abertas", "Tarefas abertas", "numero"),
        Coluna("ult_andamento_data", "Último andamento (data)", "data"),
        Coluna("ult_andamento", "Último andamento", "longo"),
        Coluna("andamentos", "Qtd. de andamentos", "numero"),
        Coluna("prox_tarefa", "Próxima tarefa (data)", "data"),
        Coluna("despesas", "Despesas lançadas", "moeda"),
        Coluna("faturado", "Valor faturado", "moeda", permissao=FINANCEIRO),
        Coluna("tabela", "Tabela de preço", "lista"),
        Coluna("contrato_numero", "Nº do contrato", "numero", somar=False),
        Coluna("contrato_ativo", "Contrato ativo", "bool"),
        Coluna("cliente_doc", "CPF/CNPJ do cliente", "texto"),
        Coluna("cliente_tipo", "Tipo de cliente", "lista"),
        Coluna("cliente_cidade", "Cidade do cliente", "lista"),
        Coluna("cliente_uf", "UF do cliente", "lista"),
    ]
    return base + [Coluna(f"campo_{c.id}", c.nome, _TIPO_CAMPO.get(_v(c.tipo), "texto")) for c in _campos(ctx)]


def _valor_campo(tipo: str, v):
    if v in (None, ""):
        return None
    try:
        if tipo in ("numero", "moeda"):
            return float(v)
        if tipo == "data":
            return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
        if tipo == "bool":
            return v if isinstance(v, bool) else str(v).lower() in ("1", "true", "sim", "s")
    except (TypeError, ValueError):
        return None
    return str(v)


def _carregar_casos(ctx, de, ate) -> list[dict]:
    r_ = aliased(Usuario)
    sel = (select(Caso, Contrato.nome.label("contrato"), Tomador.nome.label("cliente"), AreaAtuacao.nome.label("area"),
                  r_.nome.label("responsavel"), Contrato.numero.label("contrato_numero"), Contrato.ativo.label("contrato_ativo"),
                  Contrato.tabela_preco_id.label("k_tabela"), Tomador.cpf_cnpj.label("doc"), Tomador.tipo.label("cli_tipo"),
                  Tomador.cidade.label("cli_cidade"), Tomador.uf.label("cli_uf"))
           .join(Contrato, Caso.contrato_id == Contrato.id).join(Tomador, Contrato.tomador_id == Tomador.id)
           .outerjoin(AreaAtuacao, Caso.area_id == AreaAtuacao.id).outerjoin(r_, Caso.responsavel_id == r_.id)
           .where(Caso.tenant_id == ctx.tenant_id))
    sel = _periodo(sel, Caso.data_abertura, de, ate)
    t = ctx.tenant_id
    minutos = dict(ctx.db.execute(select(Timesheet.caso_id, func.sum(Timesheet.minutos)).where(Timesheet.tenant_id == t)
                                  .group_by(Timesheet.caso_id)).all())
    abertas = dict(ctx.db.execute(select(Tarefa.caso_id, func.count()).where(
        Tarefa.tenant_id == t, Tarefa.caso_id.is_not(None),
        Tarefa.status.in_([StatusTarefa.a_fazer, StatusTarefa.em_andamento])).group_by(Tarefa.caso_id)).all())
    n_and = dict(ctx.db.execute(select(Andamento.caso_id, func.count()).join(Caso).where(Caso.tenant_id == t)
                                .group_by(Andamento.caso_id)).all())
    prox = dict(ctx.db.execute(select(Tarefa.caso_id, func.min(Tarefa.prazo)).where(
        Tarefa.tenant_id == t, Tarefa.caso_id.is_not(None), Tarefa.prazo >= date.today(),
        Tarefa.status.in_([StatusTarefa.a_fazer, StatusTarefa.em_andamento])).group_by(Tarefa.caso_id)).all())
    desp = dict(ctx.db.execute(select(Despesa.caso_id, func.sum(Despesa.valor)).where(Despesa.tenant_id == t)
                               .group_by(Despesa.caso_id)).all())
    fat = dict(ctx.db.execute(
        select(FaturaItem.caso_id, func.sum(FaturaItem.valor)).join(Fatura, FaturaItem.fatura_id == Fatura.id)
        .where(Fatura.tenant_id == t, Fatura.status != StatusFatura.cancelada, FaturaItem.caso_id.is_not(None))
        .group_by(FaturaItem.caso_id)).all()) if ctx.pode(FINANCEIRO) else {}
    tabelas = dict(ctx.db.execute(select(TabelaPreco.id, TabelaPreco.nome).where(TabelaPreco.tenant_id == t)).all())
    ultimo: dict[int, tuple] = {}
    for cid, d, tit in ctx.db.execute(select(Andamento.caso_id, Andamento.data, Andamento.titulo).join(Caso)
                                      .where(Caso.tenant_id == t).order_by(Andamento.caso_id, Andamento.data.desc(),
                                                                          Andamento.id.desc())):
        ultimo.setdefault(cid, (d, tit))
    campos = [(c.id, _TIPO_CAMPO.get(_v(c.tipo), "texto")) for c in _campos(ctx)]
    # tipos de caso: fase (contencioso: fase processual; consultivo: etapa; administrativo: fase) e prognóstico
    from app.modules.faturamento import casos as regras_caso
    from app.modules.faturamento import envolvimento
    from app.modules.faturamento.tipos_caso import ROTULOS, CasoAdministrativo, CasoConsultivo, CasoContencioso

    fase: dict[tuple[str, int], str | None] = {}
    prognostico: dict[tuple[str, int], str | None] = {}
    for tipo, modelo, col_fase, rotulo in (("contencioso", CasoContencioso, CasoContencioso.fase_processual, "fase_processual"),
                                           ("consultivo", CasoConsultivo, CasoConsultivo.etapa, "etapa"),
                                           ("administrativo", CasoAdministrativo, CasoAdministrativo.fase_adm, "fase_adm")):
        col_prog = getattr(modelo, "prognostico", None)
        linhas = ctx.db.execute(select(modelo.caso_id, col_fase, *([col_prog] if col_prog is not None else []))
                                .join(Caso, Caso.id == modelo.caso_id).where(Caso.tenant_id == t)).all()
        for linha in linhas:
            fase[(tipo, linha[0])] = ROTULOS[rotulo].get(linha[1] or "")
            if col_prog is not None:
                prognostico[(tipo, linha[0])] = ROTULOS["prognostico"].get(linha[2] or "")
    partes = envolvimento.resumos_do_escritorio(ctx.db, t)
    hoje = date.today()
    out = []
    for row in ctx.db.execute(sel):
        c: Caso = row[0]
        tipo_caso = regras_caso.tipo_caso_de(c)
        m = row._mapping
        ini = c.data_abertura or c.data_distribuicao
        fim = c.data_encerramento if c.status == StatusCaso.encerrado and c.data_encerramento else hoje
        ua = ultimo.get(c.id)
        d = {
            "numero": c.numero, "titulo": c.titulo, "cliente": m["cliente"], "contrato": m["contrato"], "area": m["area"],
            "tipo": TIPO_CASO.get(_v(c.tipo)), "status": STATUS_CASO.get(_v(c.status)), "responsavel": m["responsavel"],
            "tipo_caso": ROTULOS["tipo_caso"][tipo_caso], "fase": fase.get((tipo_caso, c.id)),
            "prognostico": prognostico.get((tipo_caso, c.id)), "partes": partes.get(c.id),
            "processo": c.numero_processo, "parte_contraria": c.parte_contraria, "polo": POLO.get(c.polo or ""),
            "instancia": INSTANCIA.get(c.instancia or "", c.instancia), "tribunal": c.tribunal, "vara": c.vara,
            "comarca": c.comarca, "foro": c.comarca or c.tribunal, "valor_causa": _num(c.valor_causa),
            "abertura": c.data_abertura, "distribuicao": c.data_distribuicao, "encerramento": c.data_encerramento,
            "dias": (fim - ini).days if ini else None, "horas": (minutos.get(c.id) or 0) / 60,
            "tarefas_abertas": abertas.get(c.id, 0), "ult_andamento_data": ua[0] if ua else None,
            "ult_andamento": ua[1] if ua else None,
            "cadastro": _dia(c.criado_em), "alteracao": _dia(c.atualizado_em), "descricao": c.descricao,
            "tem_processo": bool(c.numero_processo), "andamentos": n_and.get(c.id, 0), "prox_tarefa": prox.get(c.id),
            "despesas": _num(desp.get(c.id)) or 0.0, "faturado": _num(fat.get(c.id)) or 0.0,
            "tabela": tabelas.get(c.tabela_preco_id or m["k_tabela"] or 0), "contrato_numero": m["contrato_numero"],
            "contrato_ativo": bool(m["contrato_ativo"]), "cliente_doc": _doc(m["doc"]),
            "cliente_tipo": {"PF": "Pessoa física", "PJ": "Pessoa jurídica", "EX": "Exterior"}.get(m["cli_tipo"], m["cli_tipo"]),
            "cliente_cidade": m["cli_cidade"], "cliente_uf": m["cli_uf"],
        }
        valores = c.campos or {}
        for cid, tipo in campos:
            d[f"campo_{cid}"] = _valor_campo(tipo, valores.get(str(cid)))
        out.append(d)
    return out


# ------------------------------------------------------------------------------------------------ andamentos
def _col_andamentos(ctx) -> list[Coluna]:
    return [
        Coluna("data", "Data", "data", True),
        Coluna("tipo", "Tipo", "lista", True),
        Coluna("titulo", "Andamento", "texto", True),
        Coluna("descricao", "Descrição", "longo"),
        Coluna("caso", "Caso", "lista", True),
        Coluna("processo", "Nº do processo", "texto", True),
        Coluna("cliente", "Cliente", "lista", True),
        Coluna("tribunal", "Tribunal", "lista"),
        Coluna("responsavel", "Responsável", "lista"),
        Coluna("prazo", "Prazo", "data"),
        Coluna("concluido", "Concluído", "bool"),
        Coluna("area", "Área", "lista"),
        Coluna("caso_status", "Status do caso", "lista"),
        Coluna("cadastro", "Registrado em", "data"),
    ]


def _carregar_andamentos(ctx, de, ate) -> list[dict]:
    r_ = aliased(Usuario)
    sel = (select(Andamento.data, Andamento.tipo, Andamento.titulo, Andamento.descricao, Andamento.prazo,
                  Andamento.concluido, Caso.titulo.label("caso"), Caso.numero_processo.label("processo"),
                  Caso.tribunal, Tomador.nome.label("cliente"), r_.nome.label("responsavel"), AreaAtuacao.nome.label("area"),
                  Caso.status.label("caso_status"), Andamento.criado_em.label("cadastro"))
           .join(Caso, Andamento.caso_id == Caso.id).join(Contrato, Caso.contrato_id == Contrato.id)
           .join(Tomador, Contrato.tomador_id == Tomador.id).outerjoin(r_, Andamento.responsavel_id == r_.id)
           .outerjoin(AreaAtuacao, Caso.area_id == AreaAtuacao.id)
           .where(Caso.tenant_id == ctx.tenant_id))
    out = []
    for r in _linhas(ctx, _periodo(sel, Andamento.data, de, ate)):
        r["tipo"] = TIPO_ANDAMENTO.get(_v(r["tipo"]), _v(r["tipo"]))
        r["concluido"] = bool(r["concluido"])
        r["caso_status"] = STATUS_CASO.get(_v(r["caso_status"]))
        r["cadastro"] = _dia(r["cadastro"])
        out.append(r)
    return out


# ------------------------------------------------------------------------------------------------ tarefas
def _col_tarefas(ctx) -> list[Coluna]:
    return [
        Coluna("prazo", "Data", "data", True),
        Coluna("hora", "Hora", "texto", True),
        Coluna("tipo", "Tipo", "lista", True),
        Coluna("titulo", "Tarefa", "texto", True),
        Coluna("status", "Status", "lista", True),
        Coluna("prioridade", "Prioridade", "lista"),
        Coluna("responsavel", "Responsável", "lista", True),
        Coluna("caso", "Caso", "lista", True),
        Coluna("cliente", "Cliente", "lista"),
        Coluna("processo", "Nº do processo", "texto"),
        Coluna("local", "Local (vara / comarca)", "lista"),
        Coluna("etiquetas", "Etiquetas", "texto"),
        Coluna("atrasada", "Atrasada", "bool"),
        Coluna("concluida_em", "Concluída em", "data"),
        Coluna("descricao", "Descrição", "longo"),
        Coluna("area", "Área", "lista"),
        Coluna("caso_status", "Status do caso", "lista"),
        Coluna("criado_por", "Criada por", "lista"),
        Coluna("cadastro", "Criada em", "data"),
        Coluna("dias_prazo", "Dias até o prazo", "numero"),
    ]


def _carregar_tarefas(ctx, de, ate) -> list[dict]:
    r_, cr = aliased(Usuario), aliased(Usuario)
    sel = (select(Tarefa, Caso.titulo.label("caso"), Caso.numero_processo.label("processo"), Caso.vara, Caso.comarca,
                  Tomador.nome.label("cliente"), r_.nome.label("responsavel"), AreaAtuacao.nome.label("area"),
                  Caso.status.label("caso_status"), cr.nome.label("criado_por"))
           .outerjoin(Caso, Tarefa.caso_id == Caso.id).outerjoin(Contrato, Caso.contrato_id == Contrato.id)
           .outerjoin(Tomador, Contrato.tomador_id == Tomador.id).outerjoin(r_, Tarefa.responsavel_id == r_.id)
           .outerjoin(AreaAtuacao, Caso.area_id == AreaAtuacao.id).outerjoin(cr, Tarefa.criado_por_id == cr.id)
           .where(Tarefa.tenant_id == ctx.tenant_id))
    if not ctx.pode("tarefas.ver_todas"):
        sel = sel.where(or_(Tarefa.responsavel_id == ctx.usuario.id, Tarefa.criado_por_id == ctx.usuario.id))
    hoje = date.today()
    out = []
    for row in ctx.db.execute(_periodo(sel, Tarefa.prazo, de, ate)):
        t: Tarefa = row[0]
        m = row._mapping
        st = _v(t.status)
        out.append({
            "prazo": t.prazo, "hora": t.hora, "tipo": TIPO_TAREFA.get(_v(t.tipo)), "titulo": t.titulo,
            "status": STATUS_TAREFA.get(st), "prioridade": PRIORIDADE.get(_v(t.prioridade)), "responsavel": m["responsavel"],
            "caso": m["caso"], "cliente": m["cliente"], "processo": m["processo"],
            "local": " · ".join(x for x in (m["vara"], m["comarca"]) if x) or None,
            "etiquetas": ", ".join(t.etiquetas or []) or None,
            "atrasada": bool(t.prazo and t.prazo < hoje and st in ("a_fazer", "em_andamento")),
            "concluida_em": t.concluida_em, "descricao": t.descricao, "area": m["area"],
            "caso_status": STATUS_CASO.get(_v(m["caso_status"])), "criado_por": m["criado_por"], "cadastro": _dia(t.criado_em),
            "dias_prazo": (t.prazo - hoje).days if t.prazo and st in ("a_fazer", "em_andamento") else None,
        })
    return out


# ------------------------------------------------------------------------------------------------ regras de cobrança
def _col_regras(ctx) -> list[Coluna]:
    return [
        Coluna("cliente", "Cliente", "lista", True),
        Coluna("contrato", "Contrato", "lista", True),
        Coluna("caso", "Caso", "lista", True),
        Coluna("tipo", "Tipo", "lista", True),
        Coluna("descricao", "Descrição", "longo", True),
        Coluna("valor", "Valor", "moeda", True),
        Coluna("frequencia", "Recorrência", "lista", True),
        Coluna("data_pagamento", "Data (fixo)", "data"),
        Coluna("inicio", "Começa em", "data"),
        Coluna("termino", "Término", "texto"),
        Coluna("tabela", "Tabela de preço", "lista"),
        Coluna("faixas", "Tabela por faixas de horas", "bool"),
        Coluna("ativo", "Ativa", "bool", True),
        Coluna("observacao", "Observação", "longo"),
        Coluna("contrato_ativo", "Contrato ativo", "bool"),
        Coluna("caso_status", "Status do caso", "lista"),
        Coluna("cadastro", "Criada em", "data"),
    ]


def _carregar_regras(ctx, de, ate) -> list[dict]:
    from app.modules.faturamento.service import usa_contrato

    todo = "(contrato todo)" if usa_contrato(ctx.db, ctx.tenant_id) else "(todos os casos)"
    sel = (select(RegraCobranca, Contrato.nome.label("contrato"), Tomador.nome.label("cliente"), Caso.titulo.label("caso"),
                  TabelaPreco.nome.label("tabela"), Contrato.ativo.label("contrato_ativo"), Caso.status.label("caso_status"))
           .join(Contrato, RegraCobranca.contrato_id == Contrato.id).join(Tomador, Contrato.tomador_id == Tomador.id)
           .outerjoin(Caso, RegraCobranca.caso_id == Caso.id)
           .outerjoin(TabelaPreco, RegraCobranca.tabela_preco_id == TabelaPreco.id)
           .where(RegraCobranca.tenant_id == ctx.tenant_id))
    out = []
    for row in ctx.db.execute(sel):
        g: RegraCobranca = row[0]
        m = row._mapping
        freq = None
        if _v(g.tipo) == "recorrente" and g.frequencia:
            nome, plural = FREQ[_v(g.frequencia)]
            freq = nome if (g.intervalo or 1) == 1 else f"A cada {g.intervalo} {plural}"
        term = {"sem": "Sem término", "ocorrencias": f"Após {g.ocorrencias} parcelas",
                "data": f"Em {g.data_fim:%d/%m/%Y}" if g.data_fim else "Em data"}.get(_v(g.termino))
        out.append({
            "cliente": m["cliente"], "contrato": m["contrato"], "caso": m["caso"] or todo,
            "tipo": TIPO_REGRA.get(_v(g.tipo)), "descricao": g.descricao, "valor": _num(g.valor), "frequencia": freq,
            "data_pagamento": g.data_pagamento, "inicio": g.data_inicio,
            "termino": term if _v(g.tipo) == "recorrente" else None, "tabela": m["tabela"], "ativo": bool(g.ativo),
            "faixas": bool(g.faixas), "observacao": g.observacao, "contrato_ativo": bool(m["contrato_ativo"]),
            "caso_status": STATUS_CASO.get(_v(m["caso_status"])), "cadastro": _dia(g.criado_em),
        })
    return out


# ------------------------------------------------------------------------------------------------ despesas
def _col_despesas(ctx) -> list[Coluna]:
    return [
        Coluna("data", "Data", "data", True),
        Coluna("cliente", "Cliente", "lista", True),
        Coluna("contrato", "Contrato", "lista"),
        Coluna("caso", "Caso", "lista", True),
        Coluna("tipo", "Tipo", "lista", True),
        Coluna("descricao", "Descrição", "longo", True),
        Coluna("valor", "Valor", "moeda", True),
        Coluna("reembolsavel", "Reembolsável", "bool"),
        Coluna("situacao", "Situação", "lista", True),
        Coluna("lancado_por", "Lançada por", "lista"),
        Coluna("area", "Área", "lista"),
        Coluna("caso_status", "Status do caso", "lista"),
        Coluna("processo", "Nº do processo", "texto"),
        Coluna("tem_comprovante", "Tem comprovante", "bool"),
        Coluna("cadastro", "Lançada em", "data"),
    ]


def _carregar_despesas(ctx, de, ate) -> list[dict]:
    u = aliased(Usuario)
    sel = (select(Despesa.data, Despesa.tipo, Despesa.descricao, Despesa.valor, Despesa.reembolsavel,
                  Despesa.fatura_item_id.label("item"), Caso.titulo.label("caso"), Contrato.nome.label("contrato"),
                  Tomador.nome.label("cliente"), u.nome.label("lancado_por"), AreaAtuacao.nome.label("area"),
                  Caso.status.label("caso_status"), Caso.numero_processo.label("processo"),
                  Despesa.comprovante_path.label("tem_comprovante"), Despesa.criado_em.label("cadastro"))
           .join(Caso, Despesa.caso_id == Caso.id).join(Contrato, Caso.contrato_id == Contrato.id)
           .join(Tomador, Contrato.tomador_id == Tomador.id).outerjoin(u, Despesa.lancado_por_id == u.id)
           .outerjoin(AreaAtuacao, Caso.area_id == AreaAtuacao.id)
           .where(Despesa.tenant_id == ctx.tenant_id))
    out = []
    for r in _linhas(ctx, _periodo(sel, Despesa.data, de, ate)):
        item = r.pop("item")
        r["tipo"] = TIPO_DESPESA.get(_v(r["tipo"]), _v(r["tipo"]))
        r["valor"] = _num(r["valor"])
        r["reembolsavel"] = bool(r["reembolsavel"])
        r["caso_status"] = STATUS_CASO.get(_v(r["caso_status"]))
        r["tem_comprovante"] = bool(r["tem_comprovante"])
        r["cadastro"] = _dia(r["cadastro"])
        r["situacao"] = "Faturada" if item else ("A faturar" if r["reembolsavel"] else "Não reembolsável")
        out.append(r)
    return out


# ------------------------------------------------------------------------------------------------ faturas
def _col_faturas(ctx) -> list[Coluna]:
    return [
        Coluna("codigo", "Fatura", "texto", True),
        Coluna("tipo", "Tipo", "lista", True),
        Coluna("cliente", "Cliente (pagador)", "lista", True),
        Coluna("contrato", "Contrato", "lista"),
        Coluna("emissora", "Emissora", "lista"),
        Coluna("emissao", "Emissão", "data", True),
        Coluna("vencimento", "Vencimento", "data", True),
        Coluna("pago_em", "Pago em", "data"),
        Coluna("valor", "Valor", "moeda", True),
        Coluna("situacao", "Situação", "lista", True),
        Coluna("nfse", "NFS-e", "texto"),
        Coluna("dias_atraso", "Dias de atraso", "numero"),
        Coluna("dias_receber", "Dias até receber", "numero"),
        Coluna("descricao", "Descrição", "longo"),
        Coluna("origem", "Origem", "lista"),
        Coluna("tem_nfse", "Tem NFS-e", "bool"),
        Coluna("cliente_doc", "CPF/CNPJ do cliente", "texto"),
        Coluna("cliente_uf", "UF do cliente", "lista"),
        Coluna("desconto", "Desconto", "moeda"),
        Coluna("juros", "Juros", "moeda"),
        Coluna("cadastro", "Criada em", "data"),
    ]


def _carregar_faturas(ctx, de, ate) -> list[dict]:
    sel = (select(Fatura, Tomador.nome.label("cliente"), Contrato.nome.label("contrato"),
                  func.coalesce(Emissora.nome_fantasia, Emissora.razao_social).label("emissora"), Nfse.numero.label("nfse"),
                  Tomador.cpf_cnpj.label("doc"), Tomador.uf.label("cli_uf"))
           .join(Emissora, Fatura.emissora_id == Emissora.id).outerjoin(Tomador, Fatura.tomador_id == Tomador.id)
           .outerjoin(Contrato, Fatura.contrato_id == Contrato.id).outerjoin(Nfse, Fatura.nfse_id == Nfse.id)
           .where(Fatura.tenant_id == ctx.tenant_id))
    hoje = date.today()
    out = []
    for row in ctx.db.execute(_periodo(sel, Fatura.data_emissao, de, ate)):
        f: Fatura = row[0]
        m = row._mapping
        st = _v(f.status)
        sit = "vencida" if f.status == StatusFatura.aberta and f.data_vencimento < hoje else st
        out.append({
            "codigo": f.codigo, "tipo": "ND (despesas)" if f.tipo == TipoFatura.despesas else "NH (honorários)",
            "cliente": m["cliente"], "contrato": m["contrato"], "emissora": m["emissora"], "emissao": f.data_emissao,
            "vencimento": f.data_vencimento, "pago_em": f.pago_em, "valor": float(f.valor - (f.desconto or Decimal(0)) + (f.juros or Decimal(0))),
            "situacao": SITUACAO_FATURA.get(sit, sit), "nfse": str(m["nfse"]) if m["nfse"] else None,
            "dias_atraso": (hoje - f.data_vencimento).days if sit == "vencida" else 0,
            "dias_receber": (f.pago_em - f.data_emissao).days if f.pago_em else None, "descricao": f.descricao or None,
            "origem": {"nota": "Arquivo de notas", "faturamento": "Itens a faturar"}.get(f.origem, f.origem),
            "tem_nfse": bool(m["nfse"]), "cliente_doc": _doc(m["doc"]), "cliente_uf": m["cli_uf"],
            "desconto": _num(f.desconto) or 0.0, "juros": _num(f.juros) or 0.0, "cadastro": _dia(f.criado_em),
        })
    return out


# ------------------------------------------------------------------------------------------------ catálogo
FONTES: dict[str, Fonte] = {f.id: f for f in [
    Fonte("horas", "Horas lançadas (timesheet)", "Cada lançamento de horas, com cliente, caso, profissional e valor.",
          "clock", "timesheet.ver", "Lançamentos", "data", _col_horas, _carregar_horas),
    Fonte("casos", "Casos", "Ficha dos casos: cliente, área, foro, processo, responsável, horas e campos adicionais.",
          "briefcase", "casos.ver", "Casos", "abertura", _col_casos, _carregar_casos),
    Fonte("andamentos", "Andamentos processuais", "Movimentações, publicações, decisões e notas dos casos.",
          "scroll", "casos.ver", "Andamentos", "data", _col_andamentos, _carregar_andamentos),
    Fonte("tarefas", "Tarefas e agenda", "Prazos, audiências, reuniões e diligências.",
          "calendar", "tarefas.ver", "Tarefas", "prazo", _col_tarefas, _carregar_tarefas),
    Fonte("regras", "Regras de cobrança", "Como cada contrato e caso é cobrado: fixo, recorrente ou por hora.",
          "receipt", "contratos.ver", "Regras", None, _col_regras, _carregar_regras),
    Fonte("despesas", "Despesas dos casos", "Custas, cópias, deslocamentos e demais despesas lançadas.",
          "wallet", "casos.ver", "Despesas", "data", _col_despesas, _carregar_despesas),
    Fonte("faturas", "Faturas (NH e ND)", "Faturamento e recebimento: emissão, vencimento, pagamento e NFS-e.",
          "banknote", "relatorio_faturamento.ver", "Faturas", "emissao", _col_faturas, _carregar_faturas),
]}


def disponiveis(ctx) -> list[Fonte]:
    return [f for f in FONTES.values() if ctx.pode(f.permissao)]
