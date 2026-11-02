"""Importar planilha pelo assistente, em qualquer tela: a pessoa anexa um .xlsx/.csv, a IA entende o que é
(profissionais, clientes, casos...) e qual coluna vai em qual campo, mostra a prévia e, no clique, cadastra
linha a linha pelas mesmas rotas do sistema (mesmas validações, permissões e auditoria).

Para um cadastro novo entrar aqui: um `Alvo` em ALVOS (campos + função que cria uma linha).
"""

import csv
import io
import json
import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, or_, select

from app.modules.financas.planilhas import ler_data, ler_valor

MAX_LINHAS = 2000


# ---------------------------------------------------------------- leitura da planilha
def _norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def ler_tabela(nome: str, conteudo: bytes) -> tuple[list[str], list[list]]:
    """Cabeçalho (a 1ª linha com 2+ células preenchidas) e as linhas não vazias. Aceita .xlsx e .csv."""
    if nome.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        try:
            wb = load_workbook(io.BytesIO(conteudo), data_only=True, read_only=True)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "Não consegui abrir a planilha. Salve como .xlsx ou .csv e tente de novo.") from e
        linhas = [list(r) for r in wb.active.iter_rows(values_only=True)]
    elif nome.lower().endswith((".csv", ".txt")):
        texto = None
        for enc in ("utf-8-sig", "cp1252"):
            try:
                texto = conteudo.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        amostra = (texto or "")[:5000]
        sep = max((";", ",", "\t"), key=amostra.count)
        linhas = [list(r) for r in csv.reader(io.StringIO(texto or ""), delimiter=sep)]
    else:
        raise HTTPException(400, "Envie uma planilha .xlsx ou .csv (no Excel: Salvar como › Pasta de Trabalho do Excel).")
    cheias = [r for r in linhas if any(v not in (None, "") and str(v).strip() for v in r)]
    inicio = next((i for i, r in enumerate(cheias[:15]) if sum(1 for v in r if v not in (None, "")) >= 2), 0)
    if not cheias:
        raise HTTPException(400, "A planilha está vazia.")
    cab = [str(v).strip() if v not in (None, "") else f"Coluna {i + 1}" for i, v in enumerate(cheias[inicio])]
    corpo = cheias[inicio + 1:inicio + 1 + MAX_LINHAS]
    corpo = [r + [None] * (len(cab) - len(r)) for r in corpo]
    return cab, corpo


# ---------------------------------------------------------------- conversões
def _txt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def _sim(v) -> bool | None:
    s = _norm(v)
    if not s:
        return None
    return s in ("sim", "s", "x", "1", "true", "verdadeiro", "yes", "ativo")


def _minutos(v) -> int | None:
    """Horas: 1,5 · 1.5 · 1:30 · 90min · 2h."""
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.hour * 60 + v.minute
    if hasattr(v, "hour") and hasattr(v, "minute"):  # time do Excel
        return v.hour * 60 + v.minute
    if isinstance(v, int | float | Decimal):
        f = float(v)
        return round(f * 24 * 60) if 0 < f < 1 and not float(f * 4).is_integer() else round(f * 60)
    s = str(v).strip().lower().replace(" ", "")
    if m := re.fullmatch(r"(\d+):(\d{1,2})", s):
        return int(m[1]) * 60 + int(m[2])
    if m := re.fullmatch(r"(\d+)h(\d{1,2})?(min)?", s):
        return int(m[1]) * 60 + int(m[2] or 0)
    if m := re.fullmatch(r"(\d+)min", s):
        return int(m[1])
    d = ler_valor(s)
    return round(d * 60) if d is not None else None


def _doc(v) -> str | None:
    d = re.sub(r"\D", "", str(_txt(v) or ""))
    return d or None


TIPOS = {
    "texto": _txt,
    "email": lambda v: (_txt(v) or "").lower() or None,
    "data": ler_data,
    "valor": ler_valor,
    "horas": _minutos,
    "sim_nao": _sim,
    "doc": _doc,
    "lista": lambda v: [e.strip().lower() for e in re.split(r"[;,\s]+", _txt(v) or "") if e.strip()] or None,
}


# ---------------------------------------------------------------- cadastros que aceitam planilha
@dataclass
class Campo:
    chave: str
    rotulo: str
    tipo: str = "texto"
    obrigatorio: bool = False
    sinonimos: tuple[str, ...] = ()


@dataclass
class Alvo:
    chave: str
    rotulo: str
    permissao: str
    telas: tuple[str, ...]
    campos: list[Campo]
    criar: Callable = field(repr=False, default=None)
    dica: str = ""


def _ref(ctx, modelo, texto: str | None, *colunas, numero: bool = False):
    """Acha um registro do escritório pelo nº, documento, e-mail ou nome (sem diferenciar maiúsculas)."""
    if not texto:
        return None
    t = str(texto).strip()
    conds = [func.lower(getattr(modelo, c)) == t.lower() for c in colunas]
    if numero and re.fullmatch(r"#?\d+", t):
        conds.append(modelo.numero == int(t.lstrip("#")))
    q = select(modelo).where(or_(*conds))
    if hasattr(modelo, "tenant_id"):
        q = q.where(modelo.tenant_id == ctx.tenant_id)
    return ctx.db.scalar(q.limit(1))


def _cliente(ctx, v):
    from app.modules.rpa_nfse.models import Tomador

    doc = _doc(v)
    if doc and len(doc) in (11, 14):
        achado = ctx.db.scalar(select(Tomador).where(Tomador.tenant_id == ctx.tenant_id, Tomador.cpf_cnpj == doc))
        if achado:
            return achado
    return _ref(ctx, Tomador, v, "nome")


def _contrato(ctx, v):
    from app.modules.faturamento.models import Contrato

    return _ref(ctx, Contrato, v, "nome", numero=True)


def _caso(ctx, v):
    from app.modules.faturamento.models import Caso

    return _ref(ctx, Caso, v, "titulo", "numero_processo", numero=True)


def _profissional(ctx, v):
    from app.core.models import Usuario

    return _ref(ctx, Usuario, v, "nome", "email", "login")


def _exigir(obj, rotulo: str, valor) -> int:
    if obj is None:
        raise ValueError(f"{rotulo} “{valor}” não encontrado no cadastro")
    return obj.id


# cada função recebe (ctx, valores) e devolve o texto do que foi criado
def _criar_profissional(ctx, v):
    from app.core.models import Cargo
    from app.core.routes.config import convidar_usuario
    from app.core.schemas import UsuarioConviteIn

    cargo_id = None
    if v.get("cargo"):
        cargo = _ref(ctx, Cargo, v["cargo"], "nome")
        if cargo is None:  # cargo novo entra no cadastro de cargos
            cargo = Cargo(tenant_id=ctx.tenant_id, nome=str(v["cargo"]).strip()[:100])
            ctx.db.add(cargo)
            ctx.db.flush()
        cargo_id = cargo.id
    u = convidar_usuario(UsuarioConviteIn(
        nome=v["nome"], email=v["email"], cargo_id=cargo_id, cpf=v.get("cpf"), oab=v.get("oab"), telefone=v.get("telefone"),
        data_admissao=v.get("data_admissao"), cidade=v.get("cidade"), uf=(v.get("uf") or "")[:2] or None,
        acesso_sistema=bool(v.get("acesso_sistema"))), ctx)
    return f"{u.nome}" + (" (convite enviado)" if v.get("acesso_sistema") else "")


def _criar_cliente(ctx, v):
    from app.modules.rpa_nfse.routes import criar_tomador
    from app.modules.rpa_nfse.schemas import TomadorIn

    doc = v.get("cpf_cnpj")
    tipo = "PF" if doc and len(doc) == 11 else "PJ"
    c = criar_tomador(TomadorIn(tipo=tipo, nome=v["nome"], cpf_cnpj=doc, emails=v.get("emails") or [],
                                telefone=v.get("telefone"), logradouro=v.get("logradouro"), numero=v.get("numero"),
                                bairro=v.get("bairro"), cidade=v.get("cidade"), uf=(v.get("uf") or "")[:2] or None,
                                cep=_doc(v.get("cep")), observacoes=v.get("observacoes")), ctx)
    return c.nome


def _criar_fornecedor(ctx, v):
    from app.modules.financas.routes import criar_fornecedor
    from app.modules.financas.schemas import FornecedorIn

    doc = v.get("cpf_cnpj")
    f = criar_fornecedor(FornecedorIn(nome=v["nome"], tipo="PF" if doc and len(doc) == 11 else "PJ", cpf_cnpj=doc,
                                      email=v.get("email"), telefone=v.get("telefone"), chave_pix=v.get("chave_pix"),
                                      banco=v.get("banco"), agencia=v.get("agencia"), conta=v.get("conta"),
                                      observacao=v.get("observacao")), ctx)
    return f.nome


def _criar_contrato(ctx, v):
    from app.modules.faturamento.routes import criar_contrato
    from app.modules.faturamento.schemas import ContratoIn

    tomador = _exigir(_cliente(ctx, v["cliente"]), "Cliente", v["cliente"])
    c = criar_contrato(ContratoIn(tomador_id=tomador, nome=v["nome"], objeto=v.get("objeto"), data_inicio=v.get("data_inicio"),
                                  data_fim=v.get("data_fim"), observacao=v.get("observacao")), ctx)
    return f"#{c.numero} {c.nome}"


def _criar_caso(ctx, v):
    from app.modules.faturamento.routes import criar_caso
    from app.modules.faturamento.schemas import CasoIn

    contrato = _exigir(_contrato(ctx, v["contrato"]), "Contrato", v["contrato"])
    resp = _profissional(ctx, v.get("responsavel")) if v.get("responsavel") else None
    c = criar_caso(contrato, CasoIn(titulo=v["titulo"], numero_processo=v.get("numero_processo"),
                                    parte_contraria=v.get("parte_contraria"), descricao=v.get("descricao"),
                                    responsavel_id=resp.id if resp else None), ctx)
    return f"Caso #{c.numero} {c.titulo}"


def _criar_horas(ctx, v):
    from app.modules.faturamento.routes import lancar_horas
    from app.modules.faturamento.schemas import TimesheetIn

    caso = _exigir(_caso(ctx, v["caso"]), "Caso", v["caso"])
    prof = _exigir(_profissional(ctx, v["profissional"]), "Profissional", v["profissional"]) if v.get("profissional") else None
    h = lancar_horas(caso, TimesheetIn(data=v["data"], minutos=v["minutos"], descricao=v["descricao"], profissional_id=prof), ctx)
    return f"{h.minutos // 60}h{h.minutos % 60:02d} — {h.profissional_nome}"


def _criar_despesa(ctx, v):
    from app.modules.faturamento.models import TipoDespesa
    from app.modules.faturamento.routes import lancar_despesa
    from app.modules.faturamento.schemas import DespesaIn

    caso = _exigir(_caso(ctx, v["caso"]), "Caso", v["caso"])
    tipo = next((t for t in TipoDespesa if _norm(t.value) == _norm(v.get("tipo")).replace(" ", "_")
                 or _norm(v.get("tipo")).startswith(_norm(t.value)[:5])), TipoDespesa.outros)
    d = lancar_despesa(caso, DespesaIn(data=v["data"], descricao=v["descricao"], valor=v["valor"], tipo=tipo,
                                       reembolsavel=v.get("reembolsavel") is not False), ctx)
    return f"{d.descricao} — R$ {d.valor}"


def _criar_conta_pagar(ctx, v):
    from app.modules.financas import service as fin_service
    from app.modules.financas.models import Fornecedor, TipoCategoria
    from app.modules.financas.routes import criar_conta_pagar
    from app.modules.financas.schemas import ContaPagarIn

    cat, sub = fin_service.categoria_por_nome(ctx.db, ctx.tenant_id, v.get("categoria") or "Outras despesas",
                                              TipoCategoria.despesa, v.get("subcategoria"))
    forn = _ref(ctx, Fornecedor, v.get("fornecedor"), "nome") if v.get("fornecedor") else None
    contas = criar_conta_pagar(ContaPagarIn(
        descricao=v.get("descricao"), data_vencimento=v["data_vencimento"], fornecedor_id=forn.id if forn else None,
        favorecido=None if forn else v.get("fornecedor"), documento=v.get("documento"), observacao=v.get("observacao"),
        rateio=[{"categoria_id": cat.id, "subcategoria_id": sub.id if sub else None, "valor": v["valor"]}]), ctx)
    return f"{contas[0].descricao or cat.nome} — R$ {v['valor']}"


def _criar_categoria(ctx, v):
    from app.modules.financas.models import GrupoDre, TipoCategoria
    from app.modules.financas.routes import criar_categoria
    from app.modules.financas.schemas import CategoriaIn

    tipo = TipoCategoria.receita if _norm(v.get("tipo")).startswith("rec") else TipoCategoria.despesa
    grupo = next((g for g in GrupoDre if _norm(g.value) == _norm(v.get("grupo_dre"))
                  or (v.get("grupo_dre") and _norm(v["grupo_dre"]) in _norm(g.value))), None)
    c = criar_categoria(CategoriaIn(nome=v["nome"], tipo=tipo, grupo_dre=grupo), ctx)
    return c.nome


def _criar_conta_bancaria(ctx, v):
    from app.modules.financas.routes import criar_conta
    from app.modules.financas.schemas import ContaIn

    c = criar_conta(ContaIn(nome=v["nome"], banco=v.get("banco"), agencia=v.get("agencia"), numero=v.get("numero"),
                            titular=v.get("titular"), saldo_inicial=v.get("saldo_inicial") or Decimal(0),
                            data_saldo_inicial=v.get("data_saldo_inicial")), ctx)
    return c.nome


def _criar_tarefa(ctx, v):
    from app.modules.faturamento import tarefas as tar
    from app.modules.faturamento.schemas import TarefaIn

    caso = _exigir(_caso(ctx, v["caso"]), "Caso", v["caso"]) if v.get("caso") else None
    resp = _exigir(_profissional(ctx, v["responsavel"]), "Responsável", v["responsavel"]) if v.get("responsavel") else None
    t = tar.criar_tarefa(TarefaIn(titulo=v["titulo"], descricao=v.get("descricao"), prazo=v.get("prazo"), caso_id=caso,
                                  responsavel_id=resp), ctx)
    return t.titulo


C = Campo
ALVOS: dict[str, Alvo] = {a.chave: a for a in [
    Alvo("profissionais", "Profissionais (equipe)", "cfg_profissionais.editar", ("/configuracoes/usuarios", "/faturamento/timesheet"), [
        C("nome", "Nome", obrigatorio=True, sinonimos=("nome completo", "funcionario", "profissional", "advogado")),
        C("email", "E-mail", "email", True, ("email", "e mail", "correio")),
        C("cargo", "Cargo", sinonimos=("cargo", "funcao", "categoria", "posicao")),
        C("oab", "OAB", sinonimos=("oab", "inscricao")),
        C("cpf", "CPF", "doc", sinonimos=("cpf",)),
        C("telefone", "Telefone", sinonimos=("telefone", "celular", "whatsapp", "fone")),
        C("data_admissao", "Admissão", "data", sinonimos=("admissao", "data de admissao", "entrada")),
        C("cidade", "Cidade"), C("uf", "UF", sinonimos=("uf", "estado")),
        C("acesso_sistema", "Acesso ao sistema (Sim/Não)", "sim_nao", sinonimos=("acesso", "login", "usa o sistema")),
    ], _criar_profissional, "Quem tiver “Sim” em acesso ao sistema recebe convite por e-mail; os demais só lançam horas."),
    Alvo("clientes", "Clientes", "clientes.editar", ("/cadastros/clientes",), [
        C("nome", "Nome / razão social", obrigatorio=True, sinonimos=("nome", "razao social", "cliente", "empresa")),
        C("cpf_cnpj", "CPF/CNPJ", "doc", sinonimos=("cnpj", "cpf", "cpf cnpj", "documento")),
        C("emails", "E-mails", "lista", sinonimos=("email", "e mail", "emails")),
        C("telefone", "Telefone", sinonimos=("telefone", "celular", "fone")),
        C("logradouro", "Endereço", sinonimos=("endereco", "logradouro", "rua")), C("numero", "Número", sinonimos=("numero", "n")),
        C("bairro", "Bairro"), C("cidade", "Cidade", sinonimos=("cidade", "municipio")), C("uf", "UF", sinonimos=("uf", "estado")),
        C("cep", "CEP"), C("observacoes", "Observações", sinonimos=("observacao", "observacoes", "obs")),
    ], _criar_cliente),
    Alvo("fornecedores", "Fornecedores", "fornecedores.editar", ("/financeiro/fornecedores",), [
        C("nome", "Nome", obrigatorio=True, sinonimos=("nome", "fornecedor", "razao social")),
        C("cpf_cnpj", "CPF/CNPJ", "doc", sinonimos=("cnpj", "cpf", "documento")),
        C("email", "E-mail", "email"), C("telefone", "Telefone"), C("chave_pix", "Chave PIX", sinonimos=("pix", "chave pix")),
        C("banco", "Banco"), C("agencia", "Agência"), C("conta", "Conta"), C("observacao", "Observação", sinonimos=("obs", "observacao")),
    ], _criar_fornecedor),
    Alvo("contratos", "Contratos", "contratos.editar", ("/faturamento/contratos",), [
        C("cliente", "Cliente (nome ou CPF/CNPJ)", obrigatorio=True, sinonimos=("cliente", "cnpj", "tomador")),
        C("nome", "Nome do contrato", obrigatorio=True, sinonimos=("contrato", "nome do contrato", "nome")),
        C("objeto", "Objeto"), C("data_inicio", "Início", "data", sinonimos=("inicio", "data inicio", "vigencia")),
        C("data_fim", "Fim", "data", sinonimos=("fim", "termino", "data fim")), C("observacao", "Observação"),
    ], _criar_contrato, "O cliente precisa estar cadastrado (procuro pelo CPF/CNPJ ou pelo nome)."),
    Alvo("casos", "Casos", "casos.editar", ("/faturamento/casos",), [
        C("contrato", "Contrato (nº ou nome)", obrigatorio=True, sinonimos=("contrato", "n do contrato")),
        C("titulo", "Título", obrigatorio=True, sinonimos=("titulo", "caso", "assunto")),
        C("numero_processo", "Nº do processo", sinonimos=("processo", "n do processo", "numero do processo", "cnj")),
        C("parte_contraria", "Parte contrária", sinonimos=("parte contraria", "reu", "adverso")),
        C("responsavel", "Responsável (nome ou e-mail)", sinonimos=("responsavel", "advogado")),
        C("descricao", "Descrição"),
    ], _criar_caso),
    Alvo("horas", "Horas (timesheet)", "timesheet.lancar", ("/faturamento/timesheet",), [
        C("caso", "Caso (nº, título ou processo)", obrigatorio=True, sinonimos=("caso", "processo")),
        C("data", "Data", "data", True), C("minutos", "Horas", "horas", True, ("horas", "tempo", "duracao", "qtd horas")),
        C("descricao", "Descrição", obrigatorio=True, sinonimos=("descricao", "atividade", "servico")),
        C("profissional", "Profissional (nome ou e-mail)", sinonimos=("profissional", "advogado", "responsavel", "usuario")),
    ], _criar_horas),
    Alvo("despesas", "Despesas dos casos", "casos.editar", ("/faturamento/casos",), [
        C("caso", "Caso (nº, título ou processo)", obrigatorio=True, sinonimos=("caso", "processo")),
        C("data", "Data", "data", True), C("descricao", "Descrição", obrigatorio=True),
        C("valor", "Valor", "valor", True, ("valor", "total")), C("tipo", "Tipo (custas, cópias...)"),
        C("reembolsavel", "Reembolsável (Sim/Não)", "sim_nao", sinonimos=("reembolsavel", "reembolso")),
    ], _criar_despesa),
    Alvo("contas_pagar", "Contas a pagar", "contas_pagar.editar", ("/financeiro/pagar",), [
        C("data_vencimento", "Vencimento", "data", True, ("vencimento", "data", "vence")),
        C("valor", "Valor", "valor", True, ("valor", "total")), C("descricao", "Descrição"),
        C("categoria", "Categoria"), C("subcategoria", "Subcategoria"),
        C("fornecedor", "Fornecedor / favorecido", sinonimos=("fornecedor", "favorecido", "credor")),
        C("documento", "Documento", sinonimos=("documento", "nf", "boleto")), C("observacao", "Observação"),
    ], _criar_conta_pagar, "Categoria nova é criada sozinha; fornecedor não cadastrado entra como favorecido."),
    Alvo("categorias", "Categorias financeiras", "categorias_fin.editar", ("/financeiro/categorias",), [
        C("nome", "Nome", obrigatorio=True, sinonimos=("categoria", "nome")),
        C("tipo", "Tipo (receita/despesa)"), C("grupo_dre", "Grupo da DRE", sinonimos=("dre", "grupo")),
    ], _criar_categoria),
    Alvo("contas_bancarias", "Contas bancárias", "contas_bancarias.editar", ("/financeiro/contas", "/financeiro/nova-conta"), [
        C("nome", "Nome da conta", obrigatorio=True, sinonimos=("conta", "nome", "apelido")),
        C("banco", "Banco"), C("agencia", "Agência"), C("numero", "Número da conta", sinonimos=("conta corrente", "numero", "n da conta")),
        C("titular", "Titular"), C("saldo_inicial", "Saldo inicial", "valor", sinonimos=("saldo",)),
        C("data_saldo_inicial", "Data do saldo", "data"),
    ], _criar_conta_bancaria),
    Alvo("tarefas", "Tarefas", "tarefas.editar", ("/faturamento/tarefas",), [
        C("titulo", "Título", obrigatorio=True, sinonimos=("titulo", "tarefa", "atividade")),
        C("descricao", "Descrição"), C("prazo", "Prazo", "data", sinonimos=("prazo", "vencimento", "data")),
        C("responsavel", "Responsável (nome ou e-mail)", sinonimos=("responsavel", "quem")),
        C("caso", "Caso (nº, título ou processo)", sinonimos=("caso", "processo")),
    ], _criar_tarefa),
]}


def alvos_do(ctx) -> list[Alvo]:
    return [a for a in ALVOS.values() if ctx.pode(a.permissao)]


# ---------------------------------------------------------------- entender a planilha
def _mapear_por_nome(alvo: Alvo, cab: list[str]) -> dict[str, int]:
    usados, mapa = set(), {}
    nomes = [_norm(c) for c in cab]
    for campo in alvo.campos:
        chaves = [_norm(campo.rotulo), _norm(campo.chave.replace("_", " ")), *(_norm(s) for s in campo.sinonimos)]
        melhor = next((i for i, n in enumerate(nomes) if i not in usados and n in chaves), None)
        if melhor is None:
            melhor = next((i for i, n in enumerate(nomes) if i not in usados and any(k and k in n for k in chaves if len(k) > 2)), None)
        if melhor is not None:
            mapa[campo.chave] = melhor
            usados.add(melhor)
    return mapa


def _pontos(alvo: Alvo, mapa: dict[str, int]) -> int:
    obrig = [c for c in alvo.campos if c.obrigatorio]
    return sum(3 for c in obrig if c.chave in mapa) + len(mapa) - (10 if any(c.chave not in mapa for c in obrig) else 0)


def entender(ctx, tela: str, pedido: str, cab: list[str], linhas: list[list]) -> tuple[Alvo, dict[str, int], str | None]:
    """Qual cadastro e qual coluna vai em qual campo: pela IA quando ligada; senão pelos nomes das colunas e pela tela."""
    from app.core import ia

    possiveis = alvos_do(ctx)
    if not possiveis:
        raise HTTPException(403, "Seu perfil de acesso não permite cadastrar nada por planilha.")
    try:
        p = ia.provedor_ativo(ctx.db, ctx.tenant_id)
        amostra = [[_txt(v) if not isinstance(v, date | datetime) else v.isoformat() for v in r] for r in linhas[:6]]
        catalogo = {a.chave: {"rotulo": a.rotulo, "campos": {c.chave: c.rotulo for c in a.campos}} for a in possiveis}
        r = ia.gerar_json(p, "Você mapeia planilhas para cadastros de um sistema jurídico. Responda SOMENTE JSON: "
                             '{"alvo": "<chave do cadastro>", "mapeamento": {"<chave do campo>": <índice da coluna, 0 = primeira>}, '
                             '"observacao": "<uma frase curta em português, opcional>"}. Use só cadastros e campos do catálogo; '
                             "deixe fora campos sem coluna correspondente; nunca use a mesma coluna em dois campos.",
                          json.dumps({"tela_atual": tela, "pedido_do_usuario": pedido, "catalogo": catalogo,
                                      "colunas": {i: c for i, c in enumerate(cab)}, "primeiras_linhas": amostra},
                                     ensure_ascii=False, default=str))
        alvo = ALVOS.get(str(r.get("alvo")))
        if alvo in possiveis:
            mapa = {k: int(v) for k, v in (r.get("mapeamento") or {}).items()
                    if any(c.chave == k for c in alvo.campos) and str(v).lstrip("-").isdigit() and 0 <= int(v) < len(cab)}
            if mapa:
                return alvo, mapa, (r.get("observacao") or None)
    except ia.IAIndisponivel:
        pass
    except Exception:  # noqa: BLE001 — a IA falhou: segue pelos nomes das colunas
        pass
    pedido_n = _norm(pedido)
    citado = next((a for a in possiveis if _norm(a.rotulo).split()[0] in pedido_n or a.chave in pedido_n), None)
    da_tela = next((a for a in possiveis if any(tela.startswith(t) for t in a.telas)), None)
    candidatos = [citado] if citado else sorted(possiveis, key=lambda a: _pontos(a, _mapear_por_nome(a, cab)) + (2 if a is da_tela else 0),
                                                reverse=True)
    alvo = candidatos[0]
    return alvo, _mapear_por_nome(alvo, cab), None


def valores_da_linha(alvo: Alvo, mapa: dict[str, int], linha: list) -> tuple[dict, list[str]]:
    v, erros = {}, []
    for c in alvo.campos:
        i = mapa.get(c.chave)
        bruto = linha[i] if i is not None and i < len(linha) else None
        conv = TIPOS[c.tipo](bruto) if bruto not in (None, "") else None
        if bruto not in (None, "") and conv is None and c.tipo in ("data", "valor", "horas"):
            erros.append(f"{c.rotulo}: “{bruto}” não é {'uma data' if c.tipo == 'data' else 'um número'}")
        elif conv in (None, "", []) and c.obrigatorio:
            erros.append(f"falta {c.rotulo}")
        if conv not in (None, "", []):
            v[c.chave] = conv
    return v, erros


def previa(alvo: Alvo, mapa: dict[str, int], cab: list[str], linhas: list[list]) -> dict:
    itens = []
    for n, linha in enumerate(linhas, start=2):
        v, erros = valores_da_linha(alvo, mapa, linha)
        itens.append({"linha": n, "valores": {k: (x.isoformat() if isinstance(x, date) else str(x) if isinstance(x, Decimal) else x)
                                              for k, x in v.items()}, "erros": erros})
    return {
        "alvo": alvo.chave, "alvo_rotulo": alvo.rotulo, "dica": alvo.dica, "colunas": cab,
        "campos": [{"chave": c.chave, "rotulo": c.rotulo, "obrigatorio": c.obrigatorio} for c in alvo.campos],
        "mapeamento": mapa, "total": len(itens), "validas": sum(1 for i in itens if not i["erros"]),
        "linhas": itens[:200],
    }


def importar(ctx, alvo: Alvo, mapa: dict[str, int], linhas: list[list]) -> dict:
    if not ctx.pode(alvo.permissao):
        raise HTTPException(403, "Seu perfil de acesso não permite este cadastro.")
    criados, erros = [], []
    for n, linha in enumerate(linhas, start=2):
        v, problemas = valores_da_linha(alvo, mapa, linha)
        if problemas:
            erros.append({"linha": n, "erro": "; ".join(problemas)})
            continue
        try:
            criados.append(alvo.criar(ctx, v))
        except HTTPException as e:
            ctx.db.rollback()
            erros.append({"linha": n, "erro": str(e.detail)})
        except ValidationError as e:
            ctx.db.rollback()
            x = e.errors()[0]
            erros.append({"linha": n, "erro": f"{'.'.join(str(p) for p in x['loc'])}: {x['msg']}"})
        except (ValueError, KeyError) as e:
            ctx.db.rollback()
            erros.append({"linha": n, "erro": str(e).strip("'")})
    ctx.auditar("ia.importar_planilha", alvo.chave, None, descricao=f"{len(criados)} criados, {len(erros)} com erro")
    ctx.db.commit()
    return {"alvo_rotulo": alvo.rotulo, "criados": len(criados), "exemplos": criados[:10], "erros": erros[:200],
            "com_erro": len(erros)}
