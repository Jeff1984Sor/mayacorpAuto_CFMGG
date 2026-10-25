"""Assistente por IA em todas as telas: conversa sobre o que está na tela e propõe ações (o usuário confirma).

Fluxo: o navegador manda o texto visível da tela + a conversa. O servidor junta dados estruturados (com os ids)
para a IA saber de quais registros se fala, e a IA devolve uma resposta e, se pedido, ações de um catálogo fechado.
Nenhuma ação roda sem o clique em "Executar"; a execução passa pelas mesmas rotas/validações/permissões do sistema
e fica na auditoria.
"""

import json
import re
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from app.core import ia
from app.core.deps import Ctx, Operador
from app.core.models import Usuario

router = APIRouter(prefix="/ia/assistente", tags=["Assistente IA"])


class Mensagem(BaseModel):
    papel: str = Field(pattern="^(usuario|assistente)$")
    texto: str = Field(max_length=8000)


class ConversaIn(BaseModel):
    tela: str = Field(max_length=300)
    titulo: str = Field(default="", max_length=200)
    conteudo: str = Field(default="", max_length=60000)
    mensagens: list[Mensagem] = Field(min_length=1, max_length=30)


class Acao(BaseModel):
    tipo: str
    rotulo: str
    parametros: dict[str, Any] = {}


class ConversaOut(BaseModel):
    resposta: str
    acoes: list[Acao] = []


class ExecutarIn(BaseModel):
    tipo: str
    parametros: dict[str, Any] = {}


# ------------------------------------------------------------------------------------------- catálogo de ações
CATALOGO = {
    "navegar": "Abrir uma tela. {rota: '/financeiro/pagar?status=atrasado'} (rotas do sistema, começando com /)",
    "criar_andamento": "Andamento no caso. {caso_id, data: AAAA-MM-DD, tipo: andamento|publicacao|despacho|decisao|sentenca|"
                       "nota, titulo, descricao?} (audiência, reunião e prazo são tarefas)",
    "criar_tarefa": "Tarefa (prazos, audiências, diligências...). {titulo, descricao?, prazo?: AAAA-MM-DD, hora?: HH:MM, caso_id?, "
                    "tipo?: prazo|audiencia|diligencia|reuniao|peticao|ligacao|administrativo|outro, prioridade?: baixa|media|alta|urgente, "
                    "responsavel_id?}",
    "concluir_tarefa": "Marcar tarefa como concluída. {tarefa_id}",
    "lancar_horas": "Horas no timesheet do caso. {caso_id, data, minutos: int, descricao, profissional_id?}",
    "lancar_despesa": "Despesa do caso. {caso_id, data, tipo: custas|copias|deslocamento|correio|diligencia|honorario_perito|outros, "
                      "descricao, valor, reembolsavel?: bool}",
    "criar_caso": "Novo caso. {contrato_id, titulo, tipo?: consultivo|administrativo|judicial_estadual|judicial_federal|"
                  "judicial_trabalhista, numero_processo?, parte_contraria?, descricao?, responsavel_id?, area_id?}",
    "atualizar_caso": "Alterar campos do caso. {caso_id, ...campos a mudar (titulo, tipo, status: aberto|encerrado, numero_processo, "
                      "parte_contraria, tribunal, vara, comarca, valor_causa, descricao, responsavel_id, area_id)}",
    "criar_conta_pagar": "Conta a pagar. {descricao, valor, data_vencimento, categoria_id, subcategoria_id?, fornecedor_id? ou "
                         "favorecido?, forma_pagamento?: pix|boleto|ted|dinheiro|cartao|debito|outro, documento?}",
    "pagar_conta": "Dar baixa numa conta a pagar. {conta_id, data, conta_bancaria_id?, juros?, desconto?}",
    "lancamento_bancario": "Lançamento no extrato. {conta_bancaria_id, data, descricao, tipo: credito|debito, valor, categoria_id?}",
    "criar_cliente": "Cadastrar cliente. {tipo: PF|PJ, nome, cpf_cnpj?, emails?: [..], telefone?}",
}


def _referencias(ctx, tela: str) -> dict:
    """Dados com ids para a IA resolver “o caso 15”, “a conta do aluguel”, “a Imobiliária X”…"""
    from app.modules.faturamento.models import Caso, Contrato, StatusCaso
    from app.modules.financas.models import CategoriaFinanceira, ContaBancaria, ContaPagar, Fornecedor, TipoCategoria
    from app.modules.rpa_nfse.models import Tomador

    db, t = ctx.db, ctx.tenant_id
    ref: dict[str, Any] = {"hoje": date.today().isoformat(), "usuario": {"id": ctx.usuario.id, "nome": ctx.usuario.nome}}
    ref["casos_abertos"] = [{"id": c.id, "numero": c.numero, "titulo": c.titulo, "cliente": c.contrato.tomador.nome if c.contrato.tomador else ""}
                            for c in db.scalars(select(Caso).where(Caso.tenant_id == t, Caso.status == StatusCaso.aberto)
                                                .order_by(Caso.numero.desc()).limit(150))]
    ref["contratos"] = [{"id": c.id, "numero": c.numero, "nome": c.nome, "cliente": c.tomador.nome if c.tomador else ""}
                        for c in db.scalars(select(Contrato).where(Contrato.tenant_id == t, Contrato.ativo).order_by(Contrato.numero.desc()).limit(100))]
    ref["profissionais"] = [{"id": u.id, "nome": u.nome} for u in db.scalars(select(Usuario).where(Usuario.tenant_id == t, Usuario.ativo))]
    from app.modules.faturamento.models import StatusTarefa, Tarefa

    ref["tarefas_abertas"] = [{"id": x.id, "titulo": x.titulo, "prazo": str(x.prazo or ""), "caso_id": x.caso_id, "responsavel_id": x.responsavel_id}
                              for x in db.scalars(select(Tarefa).where(Tarefa.tenant_id == t, Tarefa.status.in_(
                                  [StatusTarefa.a_fazer, StatusTarefa.em_andamento])).order_by(Tarefa.prazo).limit(150))]
    if tela.startswith(("/financeiro", "/configuracoes/financeiro")) or "conta" in tela:
        ref["contas_bancarias"] = [{"id": c.id, "nome": c.nome} for c in db.scalars(select(ContaBancaria).where(ContaBancaria.tenant_id == t, ContaBancaria.ativo))]
        ref["categorias_despesa"] = [{"id": c.id, "nome": c.nome, "subcategorias": [{"id": s.id, "nome": s.nome} for s in c.subcategorias]}
                                     for c in db.scalars(select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == t,
                                                                                           CategoriaFinanceira.tipo == TipoCategoria.despesa,
                                                                                           CategoriaFinanceira.ativo))]
        ref["fornecedores"] = [{"id": f.id, "nome": f.nome} for f in db.scalars(select(Fornecedor).where(Fornecedor.tenant_id == t, Fornecedor.ativo).limit(200))]
        ref["contas_a_pagar_em_aberto"] = [
            {"id": c.id, "descricao": c.descricao, "favorecido": c.fornecedor.nome if c.fornecedor else c.favorecido, "valor": str(c.valor),
             "vencimento": c.data_vencimento.isoformat()}
            for c in db.scalars(select(ContaPagar).where(ContaPagar.tenant_id == t, ContaPagar.data_pagamento.is_(None))
                                .order_by(ContaPagar.data_vencimento).limit(150))]
    if m := re.match(r"^/faturamento/casos/(\d+)", tela):
        c = db.get(Caso, int(m.group(1)))
        if c and c.tenant_id == t:
            ref["caso_aberto_na_tela"] = {"id": c.id, "numero": c.numero, "titulo": c.titulo, "contrato_id": c.contrato_id,
                                          "andamentos": [{"data": str(a.data), "tipo": a.tipo.value, "titulo": a.titulo,
                                                          "prazo": str(a.prazo or ""), "concluido": a.concluido} for a in c.andamentos[:30]]}
    if tela.startswith("/cadastros/clientes"):
        ref["clientes"] = [{"id": x.id, "nome": x.nome} for x in db.scalars(select(Tomador).where(Tomador.tenant_id == t).order_by(Tomador.nome).limit(300))]
    return ref


SISTEMA = (
    "Você é o assistente do MayaJus, sistema de gestão de um escritório de advocacia brasileiro (casos, faturamento, "
    "financeiro, NFS-e). Converse em português do Brasil, curto e direto, citando números e nomes da tela. "
    "Use SOMENTE os dados fornecidos (tela + referências); se faltar informação, diga o que falta. Nunca invente ids: "
    "campos terminados em _id levam o NÚMERO id das referências; fornecedor que não está nas referências vai em "
    "'favorecido' (texto), sem fornecedor_id. "
    "Quando o usuário pedir para FAZER algo, proponha ações do catálogo com parâmetros completos (ids das referências, "
    "datas AAAA-MM-DD, valores numéricos) e um rótulo claro do que será feito; o usuário confirma antes. "
    "Se faltar um dado obrigatório (ex.: categoria), pergunte em vez de propor. Para perguntas, não proponha ações. "
    'Responda SOMENTE JSON: {"resposta": "texto (pode usar listas com -)", "acoes": [{"tipo": "...", "rotulo": "...", '
    '"parametros": {...}}]}'
)


@router.post("/conversa", response_model=ConversaOut)
def conversar(dados: ConversaIn, ctx: Ctx):
    refs = _referencias(ctx, dados.tela)
    historico = "\n".join(f"{'Usuário' if m.papel == 'usuario' else 'Assistente'}: {m.texto}" for m in dados.mensagens[-12:])
    prompt = (f"Tela: “{dados.titulo or dados.tela}” (rota {dados.tela}).\n"
              f"Catálogo de ações: {json.dumps(CATALOGO, ensure_ascii=False)}\n"
              f"Ações que este usuário pode executar: {[a for a, perm in PERMISSAO_ACAO.items() if ctx.pode(perm)] + ['navegar']} "
              "(não proponha as outras: diga que o perfil de acesso não permite).\n"
              f"Referências (com ids): {json.dumps(refs, ensure_ascii=False, default=str)}\n"
              f"Conteúdo visível da tela:\n{dados.conteudo[:40000]}\n\nConversa:\n{historico}\nAssistente:")
    try:
        r = ia.gerar_json(ia.provedor_ativo(ctx.db, ctx.tenant_id), SISTEMA, prompt)
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    acoes = []
    for a in (r.get("acoes") or [])[:6]:
        if isinstance(a, dict) and a.get("tipo") in CATALOGO:
            acoes.append(Acao(tipo=a["tipo"], rotulo=str(a.get("rotulo") or a["tipo"])[:200],
                              parametros=a.get("parametros") if isinstance(a.get("parametros"), dict) else {}))
    ctx.auditar("ia.assistente", "ia", descricao=f"{dados.tela}: {dados.mensagens[-1].texto[:120]}")
    ctx.db.commit()
    return ConversaOut(resposta=str(r.get("resposta") or "")[:6000], acoes=acoes)


# ------------------------------------------------------------------------------------------- execução
# permissão que cada ação do assistente exige (a mesma da tela equivalente)
PERMISSAO_ACAO = {
    "criar_andamento": "casos.editar", "lancar_despesa": "casos.editar", "criar_caso": "casos.editar", "atualizar_caso": "casos.editar",
    "lancar_horas": "timesheet.lancar", "criar_tarefa": "tarefas.editar", "concluir_tarefa": "tarefas.editar",
    "criar_conta_pagar": "contas_pagar.editar", "pagar_conta": "contas_pagar.pagar", "lancamento_bancario": "contas_bancarias.editar",
    "criar_cliente": "clientes.editar",
}


def _limpo(p: dict, *permitidos: str) -> dict:
    return {k: v for k, v in p.items() if k in permitidos and v not in (None, "")}


def _como_id(v) -> int | None:
    try:
        return int(str(v).strip().lstrip("#"))
    except (TypeError, ValueError):
        return None


def _resolver_ids(ctx, p: dict) -> dict:
    """A IA às vezes manda o nome no lugar do id ("Enel", "Energia elétrica"): procura pelo nome no cadastro."""
    from sqlalchemy import func

    from app.modules.financas.models import CategoriaFinanceira, ContaBancaria, Fornecedor, Subcategoria

    p = dict(p)
    for campo, modelo in (("fornecedor_id", Fornecedor), ("categoria_id", CategoriaFinanceira), ("conta_bancaria_id", ContaBancaria)):
        v = p.get(campo)
        if v in (None, "") or _como_id(v) is not None:
            continue
        achado = ctx.db.scalar(select(modelo.id).where(modelo.tenant_id == ctx.tenant_id,
                                                       func.lower(modelo.nome) == str(v).strip().lower()))
        if achado:
            p[campo] = achado
        elif campo == "fornecedor_id":  # fornecedor não cadastrado: vai como favorecido (texto)
            p.pop(campo)
            p.setdefault("favorecido", str(v).strip()[:200])
        else:
            raise HTTPException(400, f"Não encontrei “{v}” no cadastro ({campo.replace('_id', '').replace('_', ' ')}).")
    sub = p.get("subcategoria_id")
    if sub not in (None, "") and _como_id(sub) is None:
        cat = _como_id(p.get("categoria_id"))
        achado = ctx.db.scalar(select(Subcategoria.id).where(Subcategoria.categoria_id == cat,
                                                             func.lower(Subcategoria.nome) == str(sub).strip().lower())) if cat else None
        if achado:
            p["subcategoria_id"] = achado
        else:
            p.pop("subcategoria_id")
    return p


@router.post("/executar")
def executar(dados: ExecutarIn, ctx: Operador):
    """Executa uma ação proposta (depois do clique do usuário), pelas rotas normais do sistema."""
    from app.modules.faturamento import routes as fat
    from app.modules.faturamento.schemas import AndamentoIn, CasoIn, DespesaIn, TimesheetIn
    from app.modules.financas import routes as fin
    from app.modules.financas.schemas import ContaPagarIn, LancamentoIn, PagarIn
    from app.modules.rpa_nfse import routes as nfse
    from app.modules.rpa_nfse.schemas import TomadorIn

    exigida = PERMISSAO_ACAO.get(dados.tipo)
    if exigida and not ctx.pode(exigida):  # a IA não passa por cima do perfil de acesso
        raise HTTPException(403, "Seu perfil de acesso não permite esta ação.")
    p, t = _resolver_ids(ctx, dados.parametros or {}), dados.tipo
    try:
        if t == "navegar":
            rota = str(p.get("rota") or "")
            if not rota.startswith("/") or rota.startswith("//"):
                raise HTTPException(400, "Rota inválida.")
            return {"mensagem": "Abrindo…", "navegar": rota}
        if t == "criar_andamento":
            a = fat.criar_andamento(int(p["caso_id"]), AndamentoIn(**_limpo(p, "data", "tipo", "titulo", "descricao", "prazo",
                                                                               "responsavel_id")), ctx)
            return {"mensagem": f"Andamento “{a.titulo}” criado.", "navegar": f"/faturamento/casos/{p['caso_id']}"}
        if t == "criar_tarefa":
            from app.modules.faturamento import tarefas as tar
            from app.modules.faturamento.schemas import TarefaIn

            tf = tar.criar_tarefa(TarefaIn(**_limpo(p, "titulo", "descricao", "prazo", "hora", "caso_id", "tipo", "prioridade",
                                                       "responsavel_id")), ctx)
            return {"mensagem": f"Tarefa “{tf.titulo}” criada.", "navegar": "/faturamento/tarefas"}
        if t == "concluir_tarefa":
            from app.modules.faturamento import tarefas as tar

            tf = tar.mudar_status(int(p["tarefa_id"]), {"status": "concluida"}, ctx)
            return {"mensagem": f"Tarefa “{tf.titulo}” concluída."}
        if t == "lancar_horas":
            h = fat.lancar_horas(int(p["caso_id"]), TimesheetIn(**_limpo(p, "data", "minutos", "descricao", "profissional_id")), ctx)
            return {"mensagem": f"{h.minutos // 60}h{h.minutos % 60:02d} lançadas para {h.profissional_nome}."}
        if t == "lancar_despesa":
            d = fat.lancar_despesa(int(p["caso_id"]), DespesaIn(**_limpo(p, "data", "tipo", "descricao", "valor", "reembolsavel")), ctx)
            return {"mensagem": f"Despesa “{d.descricao}” de R$ {d.valor} lançada."}
        if t == "criar_caso":
            c = fat.criar_caso(int(p["contrato_id"]), CasoIn(**_limpo(p, "titulo", "tipo", "numero_processo", "parte_contraria",
                                                                       "descricao", "responsavel_id", "area_id")), ctx)
            return {"mensagem": f"Caso #{c.numero} criado.", "navegar": f"/faturamento/casos/{c.id}"}
        if t == "atualizar_caso":
            atual = fat.ler_caso(int(p["caso_id"]), ctx)
            base = {k: getattr(atual, k) for k in CasoIn.model_fields if hasattr(atual, k)}
            base.update(_limpo(p, *CasoIn.model_fields))
            c = fat.alterar_caso(int(p["caso_id"]), CasoIn(**base), ctx)
            return {"mensagem": f"Caso #{c.numero} atualizado."}
        if t == "criar_conta_pagar":
            valor = Decimal(str(p["valor"]))
            corpo = ContaPagarIn(**_limpo(p, "descricao", "fornecedor_id", "favorecido", "data_vencimento", "forma_pagamento",
                                          "documento", "observacao", "conta_bancaria_id"),
                                 rateio=[{"categoria_id": int(p["categoria_id"]), "subcategoria_id": p.get("subcategoria_id"), "valor": valor}])
            contas = fin.criar_conta_pagar(corpo, ctx)
            return {"mensagem": f"Conta “{contas[0].descricao}” de R$ {valor} criada.", "navegar": "/financeiro/pagar"}
        if t == "pagar_conta":
            c = fin.pagar(int(p["conta_id"]), PagarIn(**_limpo(p, "data", "conta_bancaria_id", "juros", "desconto")), ctx)
            return {"mensagem": f"Conta “{c.descricao}” paga em {c.data_pagamento:%d/%m/%Y}."}
        if t == "lancamento_bancario":
            lc = fin.lancar(int(p["conta_bancaria_id"]), LancamentoIn(**_limpo(p, "data", "descricao", "tipo", "valor", "categoria_id",
                                                                                 "subcategoria_id", "fornecedor_id", "documento")), ctx)
            return {"mensagem": f"Lançamento “{lc.descricao}” registrado."}
        if t == "criar_cliente":
            c = nfse.criar_tomador(TomadorIn(**_limpo(p, "tipo", "nome", "cpf_cnpj", "emails", "telefone", "cidade", "uf")), ctx)
            return {"mensagem": f"Cliente “{c.nome}” cadastrado."}
    except ValidationError as e:
        erro = e.errors()[0]
        raise HTTPException(400, f"Dado inválido em “{'.'.join(str(x) for x in erro['loc'])}”: {erro['msg']}") from None
    except (KeyError, ValueError, ArithmeticError) as e:
        raise HTTPException(400, f"Faltou ou está errado um dado da ação: {e}") from None
    raise HTTPException(400, "Ação desconhecida.")
