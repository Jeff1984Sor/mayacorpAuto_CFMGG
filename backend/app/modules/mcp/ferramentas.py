"""Ferramentas do conector MCP. Todas passam pela própria API (chamada por dentro, com o usuário da conexão).

O índice de rotas vem do OpenAPI do FastAPI: rota nova aparece sozinha em `buscar_rotas`. O que nunca passa por
aqui está em `_BLOQUEADAS` (senhas, usuários e perfis, certificado, painel MayaCorp, cobrança do plano, envio de
petição ao tribunal, IA interna, streams), alterar configurações (`_SO_LEITURA`) e upload de arquivo (multipart).
"""

import json
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlsplit

import anyio
import httpx

from app.core.permissoes import permissao_da_rota

LIMITE = 60_000  # caracteres por resposta (o que passar disso é cortado, com aviso)
_METODOS = ("GET", "POST", "PUT", "PATCH", "DELETE")

_BLOQUEADAS = re.compile(
    r"^/(auth|public|admin|mcp|ws|meu-plano|health)(/|$)"
    r"|^/config/(certificados|perfis|usuarios)(/|$)"
    r"|^/tribunais/(eu|plataforma|sistemas|planos|pesos|faixas-setup|rotina-diaria|uso-certificado|cobranca)(/|$)"
    r"|^/tribunais/protocolos/[^/]+/(aprovar|enviar)$"
    r"|/ia(/|-|$)|/progresso$|/ws(/|$)"
)
# configurações do escritório (modo da Prefeitura, SMTP, identidade, automações): pelo conector, só leitura
_SO_LEITURA = re.compile(r"^/config(/|$)|^/tribunais/(config|notificacoes|advogados)(/|$)|^/boletos/convenios(/|$)")
# POST que só consulta: vale também para a conexão "só consultar"
_POST_DE_CONSULTA = {"/relatorios/executar"}


@dataclass
class Sessao:
    usuario_id: int
    nome: str
    escopo: str  # leitura | escrita
    administrador: bool
    permissoes: set[str]
    token_interno: str  # access token de curta duração do próprio usuário, para chamar a API por dentro
    ip: str | None = None

    @property
    def escreve(self) -> bool:
        return self.escopo == "escrita"

    def pode(self, permissao: str) -> bool:
        return self.administrador or permissao in self.permissoes


@dataclass
class Rota:
    metodo: str
    caminho: str  # sem o /api, com {parametros}
    resumo: str
    tag: str
    operacao: dict
    regex: re.Pattern
    arquivo: bool  # recebe upload (multipart)
    texto: str = field(default="", repr=False)  # para a busca, sem acentos

    @property
    def consulta(self) -> bool:
        return self.metodo == "GET" or (self.metodo == "POST" and self.caminho in _POST_DE_CONSULTA)

    @property
    def exemplo(self) -> str:
        return "/api" + re.sub(r"\{[^}]+\}", "1", self.caminho)


def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))


_indice: dict[int, tuple[list[Rota], dict]] = {}


def indice(app) -> tuple[list[Rota], dict]:
    """(rotas liberadas para o conector, schemas do OpenAPI). Montado uma vez por processo."""
    if id(app) not in _indice:
        spec = app.openapi()
        rotas: list[Rota] = []
        for caminho, ops in spec.get("paths", {}).items():
            curto = caminho.removeprefix("/api") or "/"
            if not caminho.startswith("/api/") or _BLOQUEADAS.search(curto):
                continue
            for metodo, op in ops.items():
                if metodo.upper() not in _METODOS or (metodo.upper() != "GET" and _SO_LEITURA.search(curto)):
                    continue
                corpo = (op.get("requestBody") or {}).get("content", {})
                respostas = {t for r in op.get("responses", {}).values() for t in (r.get("content") or {})}
                if "text/event-stream" in respostas:
                    continue
                tag = (op.get("tags") or [""])[0]
                resumo = op.get("summary") or op.get("operationId") or ""
                rx = re.compile("^" + re.sub(r"\\\{[^}]+\\\}", r"[^/]+", re.escape(curto)) + "$")
                rotas.append(Rota(metodo.upper(), curto, resumo, tag, op, rx, arquivo="multipart/form-data" in corpo and "application/json" not in corpo,
                                  texto=_sem_acento(f"{metodo} {curto} {resumo} {tag} {op.get('description') or ''}").replace("-", " ").replace("_", " ")))
        rotas.sort(key=lambda r: (r.caminho, _METODOS.index(r.metodo)))
        _indice[id(app)] = (rotas, spec.get("components", {}).get("schemas", {}))
    return _indice[id(app)]


def _visivel(r: Rota, s: Sessao) -> bool:
    if not r.consulta and not s.escreve:
        return False
    mapeada, permissao = permissao_da_rota(r.metodo, r.exemplo)
    return not (mapeada and permissao and not s.pode(permissao))


def _achar(app, metodo: str, caminho: str) -> Rota | None:
    candidatas = [r for r in indice(app)[0] if r.metodo == metodo and (r.caminho == caminho or r.regex.match(caminho))]
    return min(candidatas, key=lambda r: (r.caminho != caminho, r.caminho.count("{"))) if candidatas else None


# ------------------------------------------------------------------------------------------------- buscar / detalhar
def buscar_rotas(app, s: Sessao, termo: str = "", modulo: str = "") -> str:
    rotas = [r for r in indice(app)[0] if _visivel(r, s)]
    if modulo:
        rotas = [r for r in rotas if _sem_acento(modulo) in _sem_acento(r.tag)]
    palavras = [p for p in re.split(r"[\s/_\-.,]+", _sem_acento(termo)) if len(p) > 1]
    if not palavras and not modulo:
        tags: dict[str, int] = {}
        for r in rotas:
            tags[r.tag or "outros"] = tags.get(r.tag or "outros", 0) + 1
        linhas = [f"- {t}: {n} rotas" for t, n in sorted(tags.items())]
        return "Módulos disponíveis para você (busque por palavra ou informe `modulo`):\n" + "\n".join(linhas)
    if palavras:
        pontuadas = [(sum(p in r.texto or p.rstrip("s") in r.texto for p in palavras), r) for r in rotas]
        melhor = max((n for n, _ in pontuadas), default=0)
        rotas = [r for n, r in sorted(pontuadas, key=lambda x: -x[0]) if n and n >= min(melhor, len(palavras))] if melhor else []
    if not rotas:
        return "Nenhuma rota encontrada. Tente outra palavra (ex.: casos, tarefas, faturas, contas-pagar) ou chame sem termo para ver os módulos."
    total = len(rotas)
    linhas = [f"{r.metodo} {r.caminho} — {r.resumo} [{r.tag}]" + (" (envia arquivo: só pela tela)" if r.arquivo else "") for r in rotas[:40]]
    return "\n".join(linhas) + (f"\n… e mais {total - 40}. Refine a busca." if total > 40 else "")


def _resolver(schema: Any, schemas: dict, nivel: int = 0, vistos: tuple = ()) -> Any:
    if isinstance(schema, list):
        return [_resolver(x, schemas, nivel, vistos) for x in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        nome = schema["$ref"].rsplit("/", 1)[-1]
        if nome in vistos or nivel > 5:
            return {"tipo": nome}
        return _resolver(schemas.get(nome, {}), schemas, nivel + 1, (*vistos, nome))
    return {k: _resolver(v, schemas, nivel, vistos) for k, v in schema.items() if k != "title"}


def detalhar_rota(app, s: Sessao, metodo: str, caminho: str) -> str:
    metodo, caminho = metodo.upper().strip(), _normalizar(caminho)[0]
    r = _achar(app, metodo, caminho)
    if r is None or not _visivel(r, s):
        return f"Rota {metodo} {caminho} não encontrada (ou sem acesso). Use buscar_rotas."
    schemas, op = indice(app)[1], r.operacao
    corpo = (op.get("requestBody") or {}).get("content", {}).get("application/json", {}).get("schema")
    ok = next((v for k, v in sorted(op.get("responses", {}).items()) if k.startswith("2")), {})
    resposta = (ok.get("content") or {}).get("application/json", {}).get("schema")
    saida = {
        "metodo": r.metodo, "caminho": r.caminho, "resumo": r.resumo, "descricao": op.get("description"),
        "parametros": [{"nome": p["name"], "em": {"path": "caminho", "query": "parametros"}.get(p["in"], p["in"]),
                        "obrigatorio": p.get("required", False), "schema": _resolver(p.get("schema"), schemas)}
                       for p in op.get("parameters", []) if p.get("in") in ("path", "query")],
        "corpo": _resolver(corpo, schemas) if corpo else None,
        "resposta": _resolver(resposta, schemas, 3) if resposta else None,
    }
    return _cortar(json.dumps({k: v for k, v in saida.items() if v not in (None, [])}, ensure_ascii=False, default=str))


# ------------------------------------------------------------------------------------------------- chamar a API
def _normalizar(caminho: str) -> tuple[str, list[tuple[str, str]]]:
    u = urlsplit(caminho.strip())
    c = "/" + u.path.strip().lstrip("/")
    c = c.removeprefix("/api") if c == "/api" or c.startswith("/api/") else c
    return (c.rstrip("/") or "/"), parse_qsl(u.query)


def _cortar(texto: str) -> str:
    if len(texto) <= LIMITE:
        return texto
    return texto[:LIMITE] + f"\n… [resposta cortada: {len(texto)} caracteres no total. Use filtros, paginação ou a ferramenta `relatorio`.]"


def _formatar(dados: Any) -> str:
    texto = json.dumps(dados, ensure_ascii=False, default=str, separators=(",", ":"))
    if len(texto) <= LIMITE or not isinstance(dados, list):
        return _cortar(texto)
    partes, tamanho = [], 0
    for item in dados:
        t = json.dumps(item, ensure_ascii=False, default=str, separators=(",", ":"))
        if tamanho + len(t) > LIMITE:
            break
        partes.append(t)
        tamanho += len(t) + 1
    return "[" + ",".join(partes) + f"]\n… [mostrando {len(partes)} de {len(dados)} itens. Use filtros ou paginação para ver o resto.]"


class Recusa(Exception):
    """A chamada nem chegou na API (rota inexistente, bloqueada, fora do escopo da conexão)."""


async def chamar(app, s: Sessao, metodo: str, caminho: str, parametros: dict | None = None, corpo: Any = None,
                 so_consulta: bool = False, bruto: bool = False):
    metodo = metodo.upper().strip()
    caminho, da_url = _normalizar(caminho)
    if metodo not in _METODOS or ".." in caminho or "//" in caminho:
        raise Recusa("Método ou caminho inválido.")
    r = _achar(app, metodo, caminho)
    if r is None:
        raise Recusa(f"Rota {metodo} {caminho} não existe ou não está disponível pelo conector. Use buscar_rotas para achar a rota certa.")
    if so_consulta and not r.consulta:
        raise Recusa("Esta ferramenta só consulta. Para criar, alterar ou excluir use `alterar`.")
    if not r.consulta and not s.escreve:
        raise Recusa("Esta conexão foi autorizada só para consultar. Para alterar dados, o usuário precisa conectar de novo "
                     "escolhendo \"Consultar e alterar\".")
    if r.arquivo:
        raise Recusa("Esta rota recebe um arquivo e só funciona pela tela do sistema.")
    query: list[tuple[str, Any]] = list(da_url)
    for k, v in (parametros or {}).items():
        if v is None:
            continue
        query += [(k, x) for x in v] if isinstance(v, list) else [(k, str(v).lower() if isinstance(v, bool) else v)]
    headers = {"Authorization": f"Bearer {s.token_interno}"}
    if s.ip:
        headers["X-Forwarded-For"] = s.ip
    try:
        with anyio.fail_after(120):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://mayajus.interno") as http:
                resp = await http.request(metodo, "/api" + caminho, params=query, json=corpo if corpo is not None else None, headers=headers)
    except TimeoutError:
        raise Recusa("A operação demorou demais e foi interrompida.") from None
    tipo = resp.headers.get("content-type", "")
    if "json" in tipo:
        dados = resp.json()
    elif tipo.startswith("text/"):
        dados = resp.text
    elif resp.status_code == 204 or not resp.content:
        dados = "Feito."
    else:
        dados = f"[arquivo {tipo or 'binário'}, {len(resp.content)} bytes: abra pela tela do sistema]"
    if resp.status_code >= 400:
        detalhe = dados.get("detail", dados) if isinstance(dados, dict) else dados
        raise Recusa(f"Erro {resp.status_code}: {detalhe if isinstance(detalhe, str) else json.dumps(detalhe, ensure_ascii=False, default=str)}")
    return dados if bruto else (dados if isinstance(dados, str) else _formatar(dados))


async def relatorio(app, s: Sessao, args: dict) -> str:
    linhas_max = max(1, min(int(args.get("max_linhas") or 100), 500))
    corpo = {k: args[k] for k in ("fonte", "colunas", "filtros", "grafico", "ordenar") if args.get(k) is not None}
    dados = await chamar(app, s, "POST", "/relatorios/executar", corpo=corpo, bruto=True)
    if isinstance(dados, dict) and isinstance(dados.get("linhas"), list) and len(dados["linhas"]) > linhas_max:
        total = dados.get("total_linhas", len(dados["linhas"]))
        dados["linhas"] = dados["linhas"][:linhas_max]
        dados["aviso"] = f"Mostrando {linhas_max} de {total} linhas (os totais e o gráfico consideram todas). Filtre ou aumente max_linhas (até 500)."
    return _formatar(dados)


# ------------------------------------------------------------------------------------------------- catálogo MCP
_OBJ = {"type": "object", "additionalProperties": True}

FERRAMENTAS: list[dict] = [
    {"name": "buscar_rotas", "title": "Buscar o que dá para fazer",
     "description": "Procura, por palavra-chave em português, as rotas da API do MayaJus que este usuário pode usar (ex.: 'casos', "
                    "'tarefas', 'timesheet', 'faturas', 'contas a pagar', 'boletos', 'clientes'). Sem termo, lista os módulos. "
                    "Use antes de `consultar` ou `alterar` para descobrir o caminho certo.",
     "inputSchema": {"type": "object", "properties": {
         "termo": {"type": "string", "description": "Palavras a procurar no caminho e no nome da rota."},
         "modulo": {"type": "string", "description": "Opcional: restringe a um módulo (ex.: Financeiro, Faturamento, Tribunais)."}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "detalhar_rota", "title": "Ver os campos de uma rota",
     "description": "Mostra os parâmetros, o corpo (campos, tipos, obrigatórios) e o formato da resposta de uma rota. "
                    "Use antes de `alterar` e sempre que não souber os filtros de uma consulta.",
     "inputSchema": {"type": "object", "required": ["metodo", "caminho"], "properties": {
         "metodo": {"type": "string", "enum": list(_METODOS)},
         "caminho": {"type": "string", "description": "Como em buscar_rotas, ex.: /faturamento/casos/{caso_id}"}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "consultar", "title": "Consultar dados",
     "description": "Lê dados do MayaJus (GET) com as permissões do usuário conectado: clientes, contratos, casos, andamentos, tarefas, "
                    "horas, faturas, notas fiscais, financeiro, boletos, processos dos tribunais. Não altera nada.",
     "inputSchema": {"type": "object", "required": ["caminho"], "properties": {
         "caminho": {"type": "string", "description": "Caminho da rota, ex.: /faturamento/casos ou /faturamento/casos/12"},
         "parametros": {**_OBJ, "description": "Filtros e paginação (query string), ex.: {\"busca\": \"Silva\", \"pagina\": 1}"}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "relatorio", "title": "Gerar relatório",
     "description": "Monta um relatório com filtros, totais e dados agrupados para gráfico. Fontes: horas, casos, andamentos, tarefas, "
                    "regras, despesas, faturas. Veja as colunas de cada fonte e os relatórios prontos em `consultar /relatorios/catalogo`. "
                    "Filtro: {coluna, valores:[...]} | {coluna, contem} | {coluna, de, ate} | {coluna, relativo: hoje|esta_semana|este_mes|"
                    "mes_passado|este_ano|ultimos_30|ultimos_12m|proximos_30|atrasadas} | {coluna, min, max}; `negar: true` inverte. "
                    "Gráfico: {tipo: barras|barras_h|empilhado|linhas|area|rosca, dimensao, granularidade: dia|semana|mes|trimestre|ano, "
                    "serie, medida: _contagem ou coluna numérica, agregacao: soma|media|max|min}. Não altera nada.",
     "inputSchema": {"type": "object", "required": ["fonte"], "properties": {
         "fonte": {"type": "string"},
         "colunas": {"type": "array", "items": {"type": "string"}},
         "filtros": {"type": "array", "items": _OBJ},
         "grafico": _OBJ,
         "ordenar": {"type": "array", "items": _OBJ, "description": "[{coluna, desc}]"},
         "max_linhas": {"type": "integer", "description": "Linhas devolvidas (padrão 100, máximo 500)."}}},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "alterar", "title": "Criar, alterar ou excluir",
     "description": "Grava no MayaJus (POST, PUT, PATCH, DELETE) em nome do usuário conectado, com as permissões dele e registro na "
                    "auditoria. Antes de chamar, confira os campos com `detalhar_rota` e CONFIRME com o usuário, mostrando o que será "
                    "feito, toda ação difícil de desfazer ou que saia do escritório: emitir ou cancelar NFS-e, faturar, dar baixa ou "
                    "pagar, gerar remessa de boleto, enviar e-mail, excluir.",
     "inputSchema": {"type": "object", "required": ["metodo", "caminho"], "properties": {
         "metodo": {"type": "string", "enum": ["POST", "PUT", "PATCH", "DELETE"]},
         "caminho": {"type": "string"},
         "corpo": {"description": "Corpo JSON da chamada, conforme detalhar_rota."},
         "parametros": {**_OBJ, "description": "Parâmetros de query, se a rota tiver."}}},
     "annotations": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": True}},
]


def listar(s: Sessao) -> list[dict]:
    return [f for f in FERRAMENTAS if f["name"] != "alterar" or s.escreve]


async def executar(app, s: Sessao, nome: str, args: dict) -> str:
    if nome == "buscar_rotas":
        return buscar_rotas(app, s, str(args.get("termo") or ""), str(args.get("modulo") or ""))
    if nome == "detalhar_rota":
        return detalhar_rota(app, s, str(args.get("metodo") or "GET"), str(args.get("caminho") or ""))
    if nome == "consultar":
        return await chamar(app, s, "GET", str(args.get("caminho") or ""), args.get("parametros"), so_consulta=True)
    if nome == "relatorio":
        return await relatorio(app, s, args)
    if nome == "alterar" and s.escreve:
        metodo = str(args.get("metodo") or "").upper()
        if metodo == "GET":
            raise Recusa("Para ler dados use `consultar`.")
        return await chamar(app, s, metodo, str(args.get("caminho") or ""), args.get("parametros"), args.get("corpo"))
    raise KeyError(nome)
