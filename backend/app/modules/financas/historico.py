"""Importar o histórico de uma conta bancária com IA: lê o extrato antigo (OFX, CSV ou Excel, entradas e saídas),
agrupa por favorecido, descobre quem é cada um (fornecedor, profissional, cliente, banco, imposto...), cruza com o
que já está cadastrado e mostra o que falta. No clique, cadastra o que faltava e lança o histórico categorizado,
sem duplicar o que já estava na conta.
"""

import csv
import io
import json
import re
import secrets
import unicodedata
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select

from app.modules.financas.models import (
    CategoriaFinanceira,
    ContaBancaria,
    Fornecedor,
    Lancamento,
    Subcategoria,
    TipoCategoria,
    TipoLancamento,
)
from app.modules.financas.planilhas import ler_data, ler_valor

PAPEIS = ("fornecedor", "profissional", "cliente", "banco", "imposto", "transferencia", "outro")
MAX_GRUPOS_IA = 150


# ---------------------------------------------------------------- leitura do extrato (entradas e saídas)
def _norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _decodificar(b: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            continue
    return b.decode("latin-1", "ignore")


def _ofx(texto: str) -> list[dict]:
    out = []
    for bloco in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|(?=</BANKTRANLIST>))", texto, re.S | re.I):
        def tag(nome: str, b: str = bloco) -> str | None:
            m = re.search(rf"<{nome}>([^<\r\n]*)", b, re.I)
            return m.group(1).strip() if m else None

        valor = ler_valor((tag("TRNAMT") or "").replace(",", "."))
        quando = ler_data(datetime.strptime((tag("DTPOSTED") or "")[:8], "%Y%m%d").date()
                          if re.match(r"\d{8}", tag("DTPOSTED") or "") else None)
        if valor is None or quando is None or valor == 0:
            continue
        desc = " ".join(filter(None, [tag("NAME"), tag("MEMO")])) or "Sem descrição"
        out.append({"data": quando, "descricao": desc, "valor": abs(valor),
                    "tipo": "credito" if valor > 0 else "debito", "documento": tag("CHECKNUM") or tag("FITID")})
    return out


def _tabela(linhas: list[list]) -> list[dict]:
    linhas = [r for r in linhas if any(v not in (None, "") for v in r)]
    cab_i = next((i for i, r in enumerate(linhas[:15]) if any(_norm(v).startswith("data") for v in r)), None)
    if cab_i is None:
        raise HTTPException(400, "Não achei a coluna de data no extrato. Envie em OFX (recomendado), CSV ou Excel com cabeçalho.")
    pos: dict[str, int] = {}
    for i, h in enumerate(linhas[cab_i]):
        n = _norm(h)
        if n.startswith("data") and "data" not in pos:
            pos["data"] = i
        elif any(x in n for x in ("descric", "histor", "lancament", "memo", "detalhe")) and "descricao" not in pos:
            pos["descricao"] = i
        elif any(x in n for x in ("entrada", "credito")) and "entrada" not in pos:
            pos["entrada"] = i
        elif any(x in n for x in ("saida", "debito")) and "saida" not in pos:
            pos["saida"] = i
        elif n.startswith("valor") and "valor" not in pos:
            pos["valor"] = i
        elif n in ("tipo", "d c", "dc", "natureza") and "tipo" not in pos:
            pos["tipo"] = i
        elif "document" in n and "documento" not in pos:
            pos["documento"] = i
    out = []
    for r in linhas[cab_i + 1:]:
        def col(k: str, r: list = r):
            i = pos.get(k)
            return r[i] if i is not None and i < len(r) else None

        quando = ler_data(col("data"))
        if not quando:
            continue
        desc = str(col("descricao") or "").strip() or "Sem descrição"
        if _norm(desc).startswith(("saldo", "sdo ")):
            continue  # linha de saldo do banco não é movimento
        pares = []
        if "valor" in pos and "entrada" not in pos:
            v = ler_valor(col("valor"))
            t = _norm(col("tipo"))
            if v:
                pares.append(("debito" if v < 0 or t.startswith(("d", "sa")) else "credito", abs(v)))
        else:
            for k, t in (("entrada", "credito"), ("saida", "debito")):
                v = ler_valor(col(k))
                if v:
                    pares.append((("debito" if t == "credito" else "credito") if v < 0 else t, abs(v)))
        for t, v in pares:
            out.append({"data": quando, "descricao": desc[:255], "valor": v, "tipo": t,
                        "documento": str(col("documento") or "").strip() or None})
    return out


def ler_extrato(nome: str, conteudo: bytes) -> list[dict]:
    ext = nome.lower().rsplit(".", 1)[-1] if "." in nome else ""
    if ext in ("xlsx", "xlsm"):
        from openpyxl import load_workbook

        try:
            ws = load_workbook(io.BytesIO(conteudo), read_only=True, data_only=True).active
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, "Não consegui abrir a planilha.") from e
        movs = _tabela([list(r) for r in ws.iter_rows(values_only=True)])
    else:
        texto = _decodificar(conteudo)
        if ext == "ofx" or "<OFX>" in texto.upper() or "OFXHEADER" in texto.upper():
            movs = _ofx(texto)
        elif ext in ("csv", "txt"):
            sep = max((";", ",", "\t"), key=texto[:5000].count)
            movs = _tabela([list(r) for r in csv.reader(io.StringIO(texto), delimiter=sep)])
        else:
            raise HTTPException(400, "Envie o extrato em OFX (recomendado), CSV ou Excel.")
    if not movs:
        raise HTTPException(400, "Não encontrei movimentações no extrato.")
    return sorted(movs, key=lambda m: m["data"])


# ---------------------------------------------------------------- agrupar por favorecido
_PREFIXOS = r"^(pix (enviado|recebido|transf|transferencia|pagamento|qr code)?|ted (enviada|recebida)?|doc (enviado|recebido)?|" \
            r"transf(erencia)? (enviada|recebida|entre contas|p/|para|de)?|pag(amento|to)? (de )?(boleto|titulo|conta|fatura)?|" \
            r"deb(ito)? (aut(omatico)?|em conta)?|compra (cartao|debito)?|cred(ito)?|rec(ebimento)?|envio|remessa|tarifa)\s*"


def chave_do_grupo(desc: str) -> str:
    n = _norm(desc)
    n = re.sub(r"\b\d[\d ./-]*\b", " ", n)  # datas, documentos, CNPJ, agência/conta
    n = re.sub(_PREFIXOS, "", n).strip()
    palavras = [p for p in n.split() if len(p) > 1][:4]
    return " ".join(palavras) or _norm(desc)[:30] or "sem descricao"


def agrupar(movs: list[dict]) -> dict[str, dict]:
    grupos: dict[str, dict] = {}
    for i, m in enumerate(movs):
        k = f"{m['tipo']}:{chave_do_grupo(m['descricao'])}"
        g = grupos.setdefault(k, {"chave": k, "tipo": m["tipo"], "exemplo": m["descricao"], "qtd": 0, "total": Decimal(0),
                                  "datas": [], "valores": [], "linhas": []})
        g["qtd"] += 1
        g["total"] += m["valor"]
        g["datas"].append(m["data"])
        g["valores"].append(m["valor"])
        g["linhas"].append(i)
        m["grupo"] = k
    for g in grupos.values():
        meses = {(d.year, d.month) for d in g["datas"]}
        media = g["total"] / g["qtd"]
        estavel = all(abs(v - media) <= media * Decimal("0.15") for v in g["valores"])
        g["recorrente"] = ({"meses": len(meses), "valor_medio": str(media.quantize(Decimal("0.01"))),
                            "dia": round(sum(d.day for d in g["datas"]) / len(g["datas"]))}
                           if len(meses) >= 3 and len(meses) >= g["qtd"] * 0.7 and estavel else None)
    return grupos


# ---------------------------------------------------------------- cadastros existentes e a IA
def _cadastros(ctx) -> dict:
    from app.core.models import Usuario
    from app.modules.rpa_nfse.models import Tomador

    t = ctx.tenant_id
    cats = {}
    for c in ctx.db.scalars(select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == t, CategoriaFinanceira.ativo)):
        cats[c.id] = {"id": c.id, "nome": c.nome, "tipo": c.tipo.value,
                      "subcategorias": [s.nome for s in ctx.db.scalars(select(Subcategoria).where(Subcategoria.categoria_id == c.id))]}
    return {
        "fornecedores": [{"id": f.id, "nome": f.nome} for f in ctx.db.scalars(
            select(Fornecedor).where(Fornecedor.tenant_id == t).order_by(Fornecedor.nome).limit(400))],
        "profissionais": [{"id": u.id, "nome": u.nome} for u in ctx.db.scalars(
            select(Usuario).where(Usuario.tenant_id == t, Usuario.equipe_mayacorp.is_(False)).order_by(Usuario.nome))],
        "clientes": [{"id": c.id, "nome": c.nome} for c in ctx.db.scalars(
            select(Tomador).where(Tomador.tenant_id == t).order_by(Tomador.nome).limit(400))],
        "categorias": list(cats.values()),
    }


def _parecido(nome: str, lista: list[dict]) -> dict | None:
    """Mesmo nome (sem acento/caixa) ou um contém o outro com 2+ palavras: é o mesmo cadastro."""
    n = _norm(nome)
    if not n:
        return None
    for x in lista:
        m = _norm(x["nome"])
        if m == n or (len(n.split()) >= 2 and (n in m or m in n)):
            return x
    return None


_HEURISTICA = [
    (("tarifa", "pacote servicos", "cesta", "iof", "juros", "manutencao conta"), "banco", "Tarifas bancárias"),
    (("darf", "das ", "simples nacional", "gps", "inss", "fgts", "iss", "receita federal", "prefeitura"), "imposto", "Impostos e taxas"),
    (("aplicacao", "resgate", "transf mesma titularidade", "entre contas"), "transferencia", None),
    (("salario", "folha", "pro labore", "prolabore", "ferias", "rescisao", "13 sal"), "profissional", "Pessoal"),
    (("aluguel", "condominio"), "fornecedor", "Ocupação"),
    (("enel", "light", "sabesp", "comgas", "eletropaulo", "energia", "agua", "vivo", "claro", "tim ", "internet", "net "),
     "fornecedor", "Utilidades"),
]


def _heuristica(g: dict) -> dict:
    n = _norm(g["exemplo"])
    for chaves, papel, cat in _HEURISTICA:
        if any(k.strip() in n for k in chaves):
            return {"papel": papel, "categoria": cat}
    return {"papel": "cliente" if g["tipo"] == "credito" else "fornecedor",
            "categoria": "Honorários recebidos" if g["tipo"] == "credito" else "Outras despesas"}


_PALAVRAS_DE_PAGAMENTO = {"salario", "salarios", "aluguel", "pagamento", "pagto", "ferias", "pro", "labore", "prolabore",
                          "honorarios", "mensalidade", "ref", "referente", "nf", "boleto"}


def _nome_bonito(chave: str) -> str:
    """Sem IA: "salario mariana souza" → "Mariana Souza" (tira as palavras do motivo do pagamento)."""
    palavras = chave.split(":", 1)[-1].split()
    limpas = [p for p in palavras if p not in _PALAVRAS_DE_PAGAMENTO] or palavras
    return " ".join(p.capitalize() if len(p) > 3 else p.upper() for p in limpas)[:120]


def analisar(ctx, conta: ContaBancaria, movs: list[dict]) -> dict:
    from app.core import ia

    grupos = agrupar(movs)
    cad = _cadastros(ctx)
    # o que já está na conta (mesma data, valor, tipo e descrição) não entra de novo
    existentes = defaultdict(int)
    for d, v, t, ds in ctx.db.execute(select(Lancamento.data, Lancamento.valor, Lancamento.tipo, Lancamento.descricao).where(
            Lancamento.conta_id == conta.id, Lancamento.data >= movs[0]["data"], Lancamento.data <= movs[-1]["data"])):
        existentes[(d, Decimal(v), t.value, _norm(ds))] += 1
    for m in movs:
        k = (m["data"], m["valor"], m["tipo"], _norm(m["descricao"]))
        m["duplicada"] = existentes[k] > 0
        if m["duplicada"]:
            existentes[k] -= 1

    # a IA diz quem é cada favorecido (sem IA: palavras-chave)
    usou_ia, respostas = False, {}
    ordem = sorted(grupos.values(), key=lambda g: g["total"], reverse=True)
    try:
        p = ia.provedor_ativo(ctx.db, ctx.tenant_id)
        pedido = [{"chave": g["chave"], "tipo": "entrada" if g["tipo"] == "credito" else "saida", "exemplo": g["exemplo"],
                   "qtd": g["qtd"], "total": str(g["total"]), "recorrente": bool(g["recorrente"])} for g in ordem[:MAX_GRUPOS_IA]]
        r = ia.gerar_json(p, (
            "Você é um contador analisando o extrato bancário de um escritório de advocacia brasileiro. Para cada grupo de "
            "movimentações (mesmo favorecido), diga quem é: papel = fornecedor | profissional (salário, pró-labore, "
            "estagiário, advogado associado: PESSOA que trabalha no escritório) | cliente (quem paga honorários) | banco "
            "(tarifas, juros, IOF) | imposto | transferencia (entre contas próprias, aplicação/resgate) | outro. "
            "nome = nome limpo do favorecido como deve ficar no cadastro (sem 'PIX ENVIADO', sem números). Se já existir "
            "nos cadastros enviados, use o id em existente_id. categoria/subcategoria: prefira as existentes (nome exato); "
            "se nenhuma servir, sugira um nome curto. Responda SOMENTE JSON: {\"grupos\": [{\"chave\", \"papel\", \"nome\", "
            "\"existente_id\", \"categoria\", \"subcategoria\"}]}"),
            json.dumps({"cadastros": cad, "grupos": pedido}, ensure_ascii=False, default=str))
        respostas = {x.get("chave"): x for x in (r.get("grupos") or []) if isinstance(x, dict)}
        usou_ia = bool(respostas)
    except ia.IAIndisponivel:
        pass
    except Exception:  # noqa: BLE001 — sem IA, segue pelas palavras-chave
        pass

    nomes_cat = {_norm(c["nome"]): c for c in cad["categorias"]}
    saida_grupos = []
    for g in ordem:
        r = respostas.get(g["chave"]) or {}
        h = _heuristica(g)
        papel = r.get("papel") if r.get("papel") in PAPEIS else h["papel"]
        nome = (r.get("nome") or "").strip() or _nome_bonito(g["chave"])
        lista = {"fornecedor": cad["fornecedores"], "profissional": cad["profissionais"], "cliente": cad["clientes"]}.get(papel)
        existente = None
        if lista is not None:
            eid = r.get("existente_id")
            existente = next((x for x in lista if str(x["id"]) == str(eid)), None) if eid else None
            existente = existente or _parecido(nome, lista)
        categoria = (r.get("categoria") or h["categoria"] or "").strip() or None
        if papel == "transferencia":
            categoria = None
        saida_grupos.append({
            "chave": g["chave"], "tipo": g["tipo"], "exemplo": g["exemplo"], "qtd": g["qtd"], "total": str(g["total"]),
            "de": min(g["datas"]).isoformat(), "ate": max(g["datas"]).isoformat(), "recorrente": g["recorrente"],
            "papel": papel, "nome": existente["nome"] if existente else nome,
            "existente_id": existente["id"] if existente else None,
            "categoria": categoria, "subcategoria": (r.get("subcategoria") or None) if categoria else None,
            "categoria_nova": bool(categoria) and _norm(categoria) not in nomes_cat,
        })
    novos = lambda p: sum(1 for g in saida_grupos if g["papel"] == p and not g["existente_id"])  # noqa: E731
    entradas = sum((m["valor"] for m in movs if m["tipo"] == "credito"), Decimal(0))
    saidas = sum((m["valor"] for m in movs if m["tipo"] == "debito"), Decimal(0))
    return {
        "ia": usou_ia,
        "periodo": {"de": movs[0]["data"].isoformat(), "ate": movs[-1]["data"].isoformat()},
        "totais": {"movimentos": len(movs), "entradas": str(entradas), "saidas": str(saidas),
                   "ja_lancados": sum(1 for m in movs if m["duplicada"])},
        "resumo": {"fornecedores_novos": novos("fornecedor"), "profissionais_novos": novos("profissional"),
                   "clientes_novos": novos("cliente"),
                   "categorias_novas": len({_norm(g["categoria"]) for g in saida_grupos if g["categoria_nova"]})},
        "grupos": saida_grupos,
        "linhas": [{"data": m["data"].isoformat(), "descricao": m["descricao"], "valor": str(m["valor"]), "tipo": m["tipo"],
                    "documento": m.get("documento"), "grupo": m["grupo"], "duplicada": m["duplicada"]} for m in movs],
    }


# ---------------------------------------------------------------- importar
def _email_sem_acesso(ctx, nome: str) -> str:
    base = re.sub(r"[^a-z0-9]+", ".", _norm(nome)).strip(".")[:40] or "profissional"
    return f"{base}.{secrets.token_hex(3)}@sem-email.mayajus.com.br"


def importar(ctx, conta: ContaBancaria, grupos: list[dict], linhas: list[dict]) -> dict:
    """Cadastra o que falta (conforme a revisão do usuário) e lança o histórico na conta."""
    from app.core.routes.config import convidar_usuario
    from app.core.schemas import UsuarioConviteIn
    from app.modules.financas import service
    from app.modules.rpa_nfse.models import Tomador

    criados = {"fornecedores": [], "profissionais": [], "clientes": [], "categorias": []}
    vinculo: dict[str, dict] = {}
    for g in grupos:
        papel, nome = g.get("papel"), (g.get("nome") or "").strip()[:200]
        v = {"favorecido": nome or None}
        eid = g.get("existente_id")
        cadastrar = g.get("cadastrar") is not False  # "Não, só anotar o nome" na pergunta do cliente
        if papel == "fornecedor" and nome:
            if not eid and cadastrar and ctx.pode("fornecedores.editar"):
                f = Fornecedor(tenant_id=ctx.tenant_id, nome=nome, tipo="PJ")
                ctx.db.add(f)
                ctx.db.flush()
                eid = f.id
                criados["fornecedores"].append(nome)
            v["fornecedor_id"] = eid
        elif papel == "profissional" and nome:
            if not eid and cadastrar and ctx.pode("cfg_profissionais.editar"):
                u = convidar_usuario(UsuarioConviteIn(nome=nome, email=_email_sem_acesso(ctx, nome), acesso_sistema=False), ctx)
                eid = u.id
                criados["profissionais"].append(nome)
            v["funcionario_id"] = eid
        elif papel == "cliente" and nome and not eid and cadastrar and ctx.pode("clientes.editar"):
            t = Tomador(tenant_id=ctx.tenant_id, tipo="PJ", nome=nome, emails=[], enderecos=[], contatos=[], telefones=[])
            ctx.db.add(t)
            ctx.db.flush()
            criados["clientes"].append(nome)
        if g.get("categoria") and papel != "transferencia":
            tipo_cat = TipoCategoria.receita if g.get("tipo") == "credito" else TipoCategoria.despesa
            cat, sub = service.categoria_por_nome(ctx.db, ctx.tenant_id, g["categoria"], tipo_cat, g.get("subcategoria"),
                                                  criados["categorias"])
            v["categoria_id"], v["subcategoria_id"] = cat.id, sub.id if sub else None
        vinculo[g.get("chave")] = v

    lancados = ignorados = 0
    for m in linhas:
        if m.get("duplicada") or m.get("ignorar"):
            ignorados += 1
            continue
        try:
            quando = date.fromisoformat(str(m["data"])[:10])
            valor = Decimal(str(m["valor"]))
        except (KeyError, ValueError, ArithmeticError):
            ignorados += 1
            continue
        v = vinculo.get(m.get("grupo"), {})
        ctx.db.add(Lancamento(
            tenant_id=ctx.tenant_id, conta_id=conta.id, data=quando, descricao=str(m.get("descricao") or "")[:255] or "Sem descrição",
            tipo=TipoLancamento.credito if m.get("tipo") == "credito" else TipoLancamento.debito, valor=valor,
            categoria_id=v.get("categoria_id"), subcategoria_id=v.get("subcategoria_id"), fornecedor_id=v.get("fornecedor_id"),
            funcionario_id=v.get("funcionario_id"),
            favorecido=None if (v.get("fornecedor_id") or v.get("funcionario_id")) else v.get("favorecido"),
            documento=(str(m.get("documento"))[:80] if m.get("documento") else None), origem="importacao",
            criado_por_id=ctx.usuario.id))
        lancados += 1
    ctx.auditar("financeiro.historico_ia", "fin_conta", conta.id,
                descricao=f"{lancados} lançamentos; novos: {len(criados['fornecedores'])} fornecedor(es), "
                          f"{len(criados['profissionais'])} profissional(is), {len(criados['clientes'])} cliente(s), "
                          f"{len(criados['categorias'])} categoria(s)")
    ctx.db.commit()
    return {"lancados": lancados, "ignorados": ignorados, "criados": criados}


def saldo_conferencia(ctx, conta: ContaBancaria) -> Decimal:
    entradas = ctx.db.scalar(select(func.coalesce(func.sum(Lancamento.valor), 0)).where(
        Lancamento.conta_id == conta.id, Lancamento.tipo == TipoLancamento.credito)) or 0
    saidas = ctx.db.scalar(select(func.coalesce(func.sum(Lancamento.valor), 0)).where(
        Lancamento.conta_id == conta.id, Lancamento.tipo == TipoLancamento.debito)) or 0
    return Decimal(conta.saldo_inicial or 0) + Decimal(entradas) - Decimal(saidas)
