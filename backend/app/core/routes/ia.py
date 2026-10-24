"""Inteligência Artificial: configuração (Admin) e os botões "Análise por IA" e "Preenchimento por IA"."""

import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core import ia
from app.core.deps import Admin, Ctx, EquipeMayaCorp, Operador
from app.core.documentos import cep_valido, documento_valido, so_digitos
from app.core.security import cifrar, decifrar

router = APIRouter(tags=["inteligência artificial"])

AVISO_LGPD = ("Os textos analisados são enviados ao provedor escolhido. Use uma conta empresarial com retenção de "
              "dados desligada e não envie informações além do necessário.")


# ======================================================================== configuração
class ConfigIAOut(BaseModel):
    pode_editar: bool = False  # só a equipe MayaCorp altera chave/provedor/modelo
    ativo: bool
    provedor: str
    modelo: str | None
    chave_definida: bool
    chave_final: str | None  # só os 4 últimos caracteres, para conferência
    provedores: dict[str, str] = ia.PROVEDORES
    aviso: str = AVISO_LGPD


class ConfigIAIn(BaseModel):
    ativo: bool
    provedor: str = Field(pattern="^(openai|gemini)$")
    modelo: str | None = None
    chave: str | None = None  # só altera se vier


def _out(cfg, pode_editar: bool) -> ConfigIAOut:
    final = decifrar(cfg.chave_cifrada).decode()[-4:] if cfg.chave_cifrada and pode_editar else None
    return ConfigIAOut(pode_editar=pode_editar, ativo=cfg.ativo, provedor=cfg.provedor, modelo=cfg.modelo,
                       chave_definida=bool(cfg.chave_cifrada), chave_final=final)


@router.get("/config/ia", response_model=ConfigIAOut)
def ler_config(ctx: Ctx):
    return _out(ia.config(ctx.db, ctx.tenant_id), ctx.usuario.equipe_mayacorp)


@router.put("/config/ia", response_model=ConfigIAOut)
def salvar_config(dados: ConfigIAIn, ctx: EquipeMayaCorp):
    cfg = ia.config(ctx.db, ctx.tenant_id)
    antes = {"ativo": cfg.ativo, "provedor": cfg.provedor, "modelo": cfg.modelo}
    if dados.provedor != cfg.provedor and not dados.chave:
        cfg.chave_cifrada = None  # chave de um provedor não serve no outro
    cfg.provedor, cfg.modelo = dados.provedor, dados.modelo
    if dados.chave:
        cfg.chave_cifrada = cifrar(dados.chave.strip().encode())
    if dados.ativo and not (cfg.chave_cifrada and cfg.modelo):
        raise HTTPException(400, "Para ativar, informe a chave e escolha o modelo.")
    cfg.ativo = dados.ativo
    ctx.auditar("ia.configurar", "config_ia", ctx.tenant_id, antes=antes,
                depois={"ativo": cfg.ativo, "provedor": cfg.provedor, "modelo": cfg.modelo,
                        "chave": "alterada" if dados.chave else "mantida"})
    ctx.db.commit()
    return _out(cfg, True)


class ModelosIn(BaseModel):
    provedor: str = Field(pattern="^(openai|gemini)$")
    chave: str | None = None  # se não vier, usa a salva


@router.post("/config/ia/modelos", response_model=list[str])
def modelos(dados: ModelosIn, ctx: EquipeMayaCorp):
    cfg = ia.config(ctx.db, ctx.tenant_id)
    chave = dados.chave or (decifrar(cfg.chave_cifrada).decode() if cfg.chave_cifrada and cfg.provedor == dados.provedor else None)
    if not chave:
        raise HTTPException(400, "Informe a chave para buscar os modelos.")
    try:
        return ia.listar_modelos(dados.provedor, chave)
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e


@router.post("/config/ia/testar")
def testar(ctx: EquipeMayaCorp):
    try:
        p = ia.provedor_ativo(ctx.db, ctx.tenant_id)
        r = ia.gerar_json(p, "Responda apenas em JSON.", 'Responda {"ok": true, "mensagem": "<uma saudação curta em português>"}')
    except ia.IAIndisponivel as e:
        return {"ok": False, "mensagem": str(e)}
    return {"ok": True, "mensagem": f"{ia.PROVEDORES[p.nome]} ({p.modelo}) respondeu: {r.get('mensagem', 'ok')}"}


# ======================================================================== execução comum
def _chamar(ctx, acao: str, sistema: str, usuario: str) -> dict:
    try:
        p = ia.provedor_ativo(ctx.db, ctx.tenant_id)
        resultado = ia.gerar_json(p, sistema, usuario)
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    ctx.auditar(f"ia.{acao}", "ia", descricao=f"{ia.PROVEDORES[p.nome]} · {p.modelo}")
    ctx.db.commit()
    return resultado


SISTEMA_BASE = ("Você é o assistente do MayaJus, sistema de gestão usado por um escritório de advocacia de São Paulo "
                "para emitir NFS-e (layout 2, com ISS, IBS e CBS). Escreva em português do Brasil, claro, sem jargão "
                "técnico e sem inventar dados. Responda SOMENTE com um objeto JSON válido no formato pedido.")


# ======================================================================== análise por IA
class AnaliseOut(BaseModel):
    titulo: str
    resumo: str
    pontos: list[dict]  # {nivel: ok|atencao|risco, texto}
    recomendacao: str


FORMATO_ANALISE = ('{"titulo": "frase curta", "resumo": "2 a 4 frases", '
                   '"pontos": [{"nivel": "ok|atencao|risco", "texto": "uma frase"}], "recomendacao": "1 frase objetiva"}')


def _analise(r: dict) -> AnaliseOut:
    pontos = [{"nivel": p.get("nivel") if p.get("nivel") in ("ok", "atencao", "risco") else "atencao",
               "texto": str(p.get("texto", ""))[:400]} for p in (r.get("pontos") or [])[:8] if isinstance(p, dict)]
    return AnaliseOut(titulo=str(r.get("titulo", "Análise"))[:120], resumo=str(r.get("resumo", ""))[:1500],
                      pontos=pontos, recomendacao=str(r.get("recomendacao", ""))[:400])


@router.post("/ia/analise/lote/{lid}", response_model=AnaliseOut)
def analisar_lote(lid: int, ctx: Operador):
    from app.modules.rpa_nfse import raio_x, service
    from app.modules.rpa_nfse.models import Lote, StatusRps

    lote = ctx.db.get(Lote, lid)
    if not lote or lote.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Lote não encontrado.")
    rx = raio_x.gerar(ctx.db, lote)
    problemas: dict[str, int] = {}
    for r in lote.rps:
        if r.status == StatusRps.descartado:
            continue
        for e in r.erros_json or []:
            problemas[e["mensagem"].split(".")[0]] = problemas.get(e["mensagem"].split(".")[0], 0) + 1
    dados = {
        "lote": lote.numero, "arquivo": lote.arquivo_origem, "status": lote.status.value,
        "resumo": json.loads(service.resumo(lote).model_dump_json()),
        "raio_x": {k: rx[k] for k in ("score", "frase", "insights", "comparativo", "top_clientes", "previsao_segundos")},
        "problemas_mais_comuns": sorted(problemas.items(), key=lambda kv: -kv[1])[:10],
        "rejeitadas": lote.qtd_rejeitadas, "emitidas": lote.qtd_emitidas,
    }
    r = _chamar(ctx, "analise_lote", SISTEMA_BASE,
                f"Analise este lote de RPS antes/depois da emissão e diga ao financeiro o que conferir.\n"
                f"Formato: {FORMATO_ANALISE}\nDados:\n{json.dumps(dados, ensure_ascii=False, default=str)}")
    return _analise(r)


@router.post("/ia/analise/painel", response_model=AnaliseOut)
def analisar_painel(ctx: Ctx):
    from app.modules.rpa_nfse.routes import painel

    p = painel(ctx)
    dados = json.loads(p.model_dump_json(exclude={"ultimos_lotes"}))
    dados["por_dia"] = [d for d in dados["por_dia"] if d["notas"]]
    r = _chamar(ctx, "analise_painel", SISTEMA_BASE,
                f"Faça uma análise executiva do mês de emissão de NFS-e e recebimentos para a sócia do escritório.\n"
                f"Formato: {FORMATO_ANALISE}\nDados:\n{json.dumps(dados, ensure_ascii=False, default=str)}")
    return _analise(r)


class TelaIn(BaseModel):
    """O que está na tela no momento (texto visível: indicadores, tabelas, filtros)."""

    tela: str = Field(max_length=300)  # rota, ex.: /financeiro/pagar?status=atrasado
    titulo: str = Field(default="", max_length=200)
    conteudo: str = Field(min_length=20, max_length=60000)


# o que o escritório espera de cada área do sistema (pelo começo da rota)
FOCO_TELA = [
    ("/financeiro/previsao-caixa", "risco de faltar caixa, quando e quanto transferir do investimento, recebimentos atrasados"),
    ("/financeiro/projecao-despesas", "meses em que o saldo aperta, despesas que mais pesam, tendência"),
    ("/financeiro/dre", "margem, linhas que mais pesam, variações mês a mês, categorias sem classificação"),
    ("/financeiro/fluxo-caixa", "entradas x saídas, concentração de gastos, dias de maior saída"),
    ("/financeiro/pagar", "contas atrasadas, vencimentos próximos, concentração por fornecedor/categoria, duplicidades"),
    ("/financeiro/fornecedores", "concentração de gastos, cadastros incompletos (sem CNPJ/PIX)"),
    ("/financeiro/categorias", "categorias duplicadas ou mal nomeadas, sem linha da DRE, plano de contas confuso"),
    ("/financeiro", "saldo, movimentações fora do padrão, lançamentos sem categoria"),
    ("/faturamento/itens", "o que está pronto para faturar, itens com aviso, clientes com valores altos parados"),
    ("/faturamento/revisoes", "revisões paradas há muitos dias, valores alterados contra o original"),
    ("/faturamento/fluxo", "gargalos do fluxo, faturas aguardando NFS-e, vencidas"),
    ("/faturamento/relatorio", "concentração de receita por cliente, inadimplência, prazo de recebimento"),
    ("/faturamento/impostos", "carga tributária, mudança de faixa, próximos pagamentos e como planejar"),
    ("/faturamento/casos", "casos sem andamento recente, prazos, horas e despesas a faturar"),
    ("/faturamento/contratos", "contratos sem regra de cobrança, vigência vencendo, casos e faturamento"),
    ("/dashboard", "tendências de faturamento e recebimento, clientes que concentram ou atrasam"),
    ("/nfse", "emissão de notas, rejeições, recebimentos e pendências"),
    ("/cadastros", "cadastros incompletos ou duplicados e o que completar"),
    ("/configuracoes", "configurações faltando ou arriscadas e o que ajustar"),
]


@router.post("/ia/analise/tela", response_model=AnaliseOut)
def analisar_tela(dados: TelaIn, ctx: Ctx):
    """Análise por IA de qualquer tela: recebe o conteúdo visível e devolve pontos de atenção e recomendação."""
    foco = next((f for prefixo, f in FOCO_TELA if dados.tela.startswith(prefixo)), "o que chama atenção e o que fazer")
    r = _chamar(ctx, "analise_tela", SISTEMA_BASE.replace("para emitir NFS-e (layout 2, com ISS, IBS e CBS)",
                                                          "(faturamento, financeiro, casos e NFS-e)"),
                f"Você está vendo a tela “{dados.titulo or dados.tela}” do sistema (rota {dados.tela}). "
                f"Analise SOMENTE os dados abaixo, como um controller experiente do escritório. Foco: {foco}. "
                "Cite números e nomes da tela quando ajudar; se a tela estiver vazia ou sem dados suficientes, diga isso "
                "e sugira o primeiro passo.\n"
                f"Formato: {FORMATO_ANALISE}\nConteúdo da tela:\n{dados.conteudo}")
    return _analise(r)


# ======================================================================== preenchimento por IA
class TextoIn(BaseModel):
    texto: str = Field(min_length=10, max_length=8000)


CAMPOS_ENDERECO = "logradouro, numero, complemento, bairro, cidade, uf (2 letras), cep (8 dígitos)"


def _limpar(d: dict, campos: list[str]) -> tuple[dict, list[str]]:
    """Mantém só campos conhecidos, normaliza e valida. Devolve (dados, avisos)."""
    out, avisos = {}, []
    for c in campos:
        v = d.get(c)
        if v in (None, "", [], "null"):
            continue
        out[c] = v if isinstance(v, list) else str(v).strip()
    for c in ("cpf_cnpj", "cnpj"):
        if c in out:
            dig = so_digitos(out[c])
            if documento_valido(dig):
                out[c] = dig
            else:
                avisos.append(f"O {'CPF/CNPJ' if c == 'cpf_cnpj' else 'CNPJ'} encontrado ({out[c]}) não passou na validação e foi deixado em branco.")
                out.pop(c)
    if "cep" in out:
        if cep_valido(out["cep"]):
            out["cep"] = so_digitos(out["cep"])
        else:
            avisos.append("O CEP encontrado é inválido e foi deixado em branco.")
            out.pop("cep")
    if "uf" in out:
        out["uf"] = out["uf"].upper()[:2]
    if "emails" in out:
        lista = out["emails"] if isinstance(out["emails"], list) else re.split(r"[;,\s]+", out["emails"])
        out["emails"] = [e.strip().lower() for e in lista if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", e.strip())]
    return out, avisos


@router.post("/ia/preencher/cliente")
def preencher_cliente(dados: TextoIn, ctx: Operador):
    campos = ["tipo", "nome", "cpf_cnpj", "im", "ie", "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
              "cep", "emails", "telefone", "observacoes"]
    r = _chamar(ctx, "preencher_cliente", SISTEMA_BASE,
                "Extraia do texto os dados cadastrais de um cliente (tomador de serviço). Use null para o que não "
                "estiver no texto; nunca invente. tipo = PF (CPF) ou PJ (CNPJ). emails = lista.\n"
                f"Formato: {{\"tipo\", \"nome\", \"cpf_cnpj\", \"im\", \"ie\", {CAMPOS_ENDERECO}, \"emails\", \"telefone\", \"observacoes\"}}\n"
                f"Texto:\n{dados.texto}")
    out, avisos = _limpar(r, campos)
    if out.get("cpf_cnpj"):
        out["tipo"] = "PF" if len(out["cpf_cnpj"]) == 11 else "PJ"
    elif out.get("tipo") not in ("PF", "PJ"):
        out.pop("tipo", None)
    return {"campos": out, "avisos": avisos}


@router.post("/ia/preencher/emissora")
def preencher_emissora(dados: TextoIn, ctx: Admin):
    campos = ["razao_social", "nome_fantasia", "cnpj", "ccm", "logradouro", "numero", "complemento", "bairro", "cidade",
              "uf", "cep", "email", "telefone"]
    r = _chamar(ctx, "preencher_emissora", SISTEMA_BASE,
                "Extraia do texto (ex.: cartão CNPJ) os dados da empresa emissora. ccm = inscrição municipal de São Paulo "
                "(até 8 dígitos). Use null para o que não estiver no texto; nunca invente.\n"
                f"Formato: {{\"razao_social\", \"nome_fantasia\", \"cnpj\", \"ccm\", {CAMPOS_ENDERECO}, \"email\", \"telefone\"}}\n"
                f"Texto:\n{dados.texto}")
    out, avisos = _limpar(r, campos)
    if "ccm" in out:
        out["ccm"] = so_digitos(out["ccm"])[:8] or None
    return {"campos": {k: v for k, v in out.items() if v}, "avisos": avisos}


class EmailIn(BaseModel):
    instrucao: str = Field(min_length=5, max_length=2000)
    assunto_atual: str | None = None
    corpo_atual: str | None = None


VARIAVEIS = ["{nome_tomador}", "{numero_nota}", "{valor}", "{link_prefeitura}", "{nome_emissora}", "{vencimento}",
             "{codigo_fatura}"]


@router.post("/ia/preencher/email")
def preencher_email(dados: EmailIn, ctx: Admin):
    r = _chamar(ctx, "preencher_email", SISTEMA_BASE,
                "Escreva o modelo do e-mail que acompanha a NFS-e enviada ao cliente do escritório. Use as variáveis "
                f"exatamente assim, com chaves: {', '.join(VARIAVEIS)}. Não use outras variáveis. Não inclua assinatura "
                "(ela é adicionada pelo sistema).\n"
                'Formato: {"assunto": "...", "corpo": "texto com quebras de linha \\n"}\n'
                f"Pedido: {dados.instrucao}\nModelo atual (pode melhorar): assunto={dados.assunto_atual!r} corpo={dados.corpo_atual!r}")
    assunto, corpo = str(r.get("assunto", ""))[:300], str(r.get("corpo", ""))[:5000]
    desconhecidas = sorted(set(re.findall(r"\{[a-z_]+\}", assunto + corpo)) - set(VARIAVEIS))
    for v in desconhecidas:  # variável que o sistema não conhece sairia literal no e-mail
        assunto, corpo = assunto.replace(v, ""), corpo.replace(v, "")
    avisos = [f"Removi variáveis que o sistema não conhece: {', '.join(desconhecidas)}"] if desconhecidas else []
    return {"campos": {"assunto_modelo": assunto, "corpo_modelo": corpo}, "avisos": avisos}
