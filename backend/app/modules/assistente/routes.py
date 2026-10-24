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
                       "audiencia|prazo|reuniao|nota, titulo, descricao?, prazo?: AAAA-MM-DD}",
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
    "Você é o assistente do Maya Jus, sistema de gestão de um escritório de advocacia brasileiro (casos, faturamento, "
    "financeiro, NFS-e). Converse em português do Brasil, curto e direto, citando números e nomes da tela. "
    "Use SOMENTE os dados fornecidos (tela + referências); se faltar informação, diga o que falta. Nunca invente ids. "
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
              f"Perfil do usuário: {ctx.usuario.perfil.value} (visualizador não executa ações).\n"
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
def _limpo(p: dict, *permitidos: str) -> dict:
    return {k: v for k, v in p.items() if k in permitidos and v not in (None, "")}


@router.post("/executar")
def executar(dados: ExecutarIn, ctx: Operador):
    """Executa uma ação proposta (depois do clique do usuário), pelas rotas normais do sistema."""
    from app.modules.faturamento import routes as fat
    from app.modules.faturamento.schemas import AndamentoIn, CasoIn, DespesaIn, TimesheetIn
    from app.modules.financas import routes as fin
    from app.modules.financas.schemas import ContaPagarIn, LancamentoIn, PagarIn
    from app.modules.rpa_nfse import routes as nfse
    from app.modules.rpa_nfse.schemas import TomadorIn

    p, t = dados.parametros or {}, dados.tipo
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
