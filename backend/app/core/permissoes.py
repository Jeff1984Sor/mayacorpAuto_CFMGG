"""Perfis de acesso: catálogo de permissões e o mapa rota → permissão aplicado no servidor.

Cada permissão é "recurso.acao". O perfil "administrador" pode tudo. A checagem acontece em deps.get_contexto
para toda chamada da API: o frontend só esconde o que o servidor já recusa.
"""

import re

ROTULO_ACAO = {
    "ver": "Ver", "editar": "Criar e editar", "excluir": "Excluir", "importar": "Importar planilha", "usar": "Usar",
    "ver_todas": "Ver as de todos", "lancar": "Lançar horas", "ver_todos": "Ver as horas de todos", "faturar": "Faturar",
    "aprovar": "Aprovar e faturar", "baixar": "Dar baixa (pagamento)", "cancelar": "Cancelar", "configurar": "Configurar",
    "pagar": "Pagar / reabrir", "emitir": "Emitir NFS-e", "enviar_email": "Enviar por e-mail", "reabrir": "Reabrir concluídas",
}

CATALOGO: list[dict] = [
    {"grupo": "Geral", "recursos": [
        {"id": "dashboard", "nome": "Dashboard de Faturamento", "acoes": ["ver"]},
        {"id": "comunicador", "nome": "Comunicador", "acoes": ["usar"]},
        {"id": "ia", "nome": "Inteligência Artificial (análises, assistente, preencher e enriquecer)", "acoes": ["usar"]},
    ]},
    {"grupo": "Cadastros", "recursos": [
        {"id": "clientes", "nome": "Clientes", "acoes": ["ver", "editar", "excluir", "importar"]},
        {"id": "contratos", "nome": "Contratos e regras de cobrança", "acoes": ["ver", "editar", "excluir", "importar"]},
        {"id": "casos", "nome": "Casos (ficha, andamentos, despesas, anexos)", "acoes": ["ver", "editar", "excluir", "importar"]},
        {"id": "tarefas", "nome": "Tarefas", "acoes": ["ver", "editar", "excluir", "ver_todas", "reabrir"]},
        {"id": "timesheet", "nome": "Timesheet", "acoes": ["ver", "lancar", "ver_todos"]},
    ]},
    {"grupo": "Faturamento", "recursos": [
        {"id": "itens_faturar", "nome": "Itens a faturar", "acoes": ["ver", "faturar"]},
        {"id": "revisoes", "nome": "Revisões de fatura", "acoes": ["ver", "editar", "aprovar"]},
        {"id": "faturas", "nome": "Faturas e fluxo de faturamento", "acoes": ["ver", "editar", "baixar", "cancelar"]},
        {"id": "relatorio_faturamento", "nome": "Relatório de Faturamento", "acoes": ["ver"]},
        {"id": "impostos", "nome": "Projeção de Impostos", "acoes": ["ver", "configurar"]},
    ]},
    {"grupo": "Financeiro", "recursos": [
        {"id": "contas_bancarias", "nome": "Contas bancárias, extrato e transferências", "acoes": ["ver", "editar", "excluir"]},
        {"id": "contas_pagar", "nome": "Contas a pagar", "acoes": ["ver", "editar", "excluir", "pagar"]},
        {"id": "categorias_fin", "nome": "Categorias e subcategorias", "acoes": ["ver", "editar"]},
        {"id": "fornecedores", "nome": "Fornecedores", "acoes": ["ver", "editar", "excluir"]},
        {"id": "relatorios_fin", "nome": "Fluxo de caixa, DRE, previsão e projeção", "acoes": ["ver"]},
    ]},
    {"grupo": "NFS-e", "recursos": [
        {"id": "nfse_emissao", "nome": "Nova emissão em lote e lotes", "acoes": ["ver", "emitir"]},
        {"id": "nfse_notas", "nome": "Notas emitidas e painel", "acoes": ["ver", "cancelar", "enviar_email"]},
        {"id": "nfse_recebimentos", "nome": "Recebimentos (extratos e baixas)", "acoes": ["ver", "editar"]},
    ]},
    {"grupo": "Configurações", "recursos": [
        {"id": "cfg_identidade", "nome": "Identidade (nome, logo, cor)", "acoes": ["ver", "editar"]},
        {"id": "cfg_profissionais", "nome": "Profissionais e cargos", "acoes": ["ver", "editar"]},
        {"id": "cfg_perfis", "nome": "Perfis de acesso", "acoes": ["ver", "editar"]},
        {"id": "cfg_emissoras", "nome": "Empresas emissoras", "acoes": ["ver", "editar"]},
        {"id": "cfg_certificado", "nome": "Certificado digital", "acoes": ["ver", "editar"]},
        {"id": "cfg_prefeitura", "nome": "Prefeitura (modo de emissão)", "acoes": ["ver", "editar"]},
        {"id": "cfg_parametros", "nome": "Parâmetros fiscais", "acoes": ["ver", "editar"]},
        {"id": "cfg_faturamento", "nome": "Faturamento (tabelas de preço, áreas, campos)", "acoes": ["ver", "editar"]},
        {"id": "cfg_financeiro", "nome": "Financeiro (conta de recebimento etc.)", "acoes": ["ver", "editar"]},
        {"id": "cfg_notificacoes", "nome": "Notificações e e-mail", "acoes": ["ver", "editar"]},
        {"id": "cfg_automacoes", "nome": "Automações (baixa automática, relatórios)", "acoes": ["ver", "editar"]},
        {"id": "auditoria", "nome": "Auditoria", "acoes": ["ver"]},
    ]},
]

TODAS = {f"{r['id']}.{a}" for g in CATALOGO for r in g["recursos"] for a in r["acoes"]}


def _todas_de(*recursos: str, acoes: tuple[str, ...] | None = None) -> set[str]:
    return {p for p in TODAS if p.split(".")[0] in recursos and (acoes is None or p.split(".")[1] in acoes)}


_CADASTROS = ("clientes", "contratos", "casos", "tarefas", "timesheet")
_FATURAMENTO = ("itens_faturar", "revisoes", "faturas", "relatorio_faturamento", "impostos", "dashboard")
_FINANCEIRO = ("contas_bancarias", "contas_pagar", "categorias_fin", "fornecedores", "relatorios_fin")
_NFSE = ("nfse_emissao", "nfse_notas", "nfse_recebimentos")
_CONFIG = tuple(r["id"] for g in CATALOGO if g["grupo"] == "Configurações" for r in g["recursos"])

# perfis criados de saída em todo escritório (o administrador edita/duplica à vontade)
PERFIS_PADRAO: list[dict] = [
    {"nome": "Administrador", "descricao": "Acesso total, inclusive configurações e perfis.", "cor": "#1E2D6B",
     "administrador": True, "sistema": True, "permissoes": []},
    {"nome": "Operador", "descricao": "Usa todo o sistema; não altera configurações.", "cor": "#7C8FFF", "administrador": False,
     "sistema": False, "permissoes": sorted(TODAS - _todas_de(*_CONFIG) | _todas_de(*_CONFIG, acoes=("ver",))
                                            - {"auditoria.ver", "tarefas.reabrir"})},
    {"nome": "Advogado", "descricao": "Casos, tarefas e timesheet; sem financeiro.", "cor": "#1A8F5E", "administrador": False,
     "sistema": False, "permissoes": sorted(
         _todas_de(*_CADASTROS) - {"clientes.excluir", "contratos.excluir", "casos.excluir", "tarefas.ver_todas", "timesheet.ver_todos",
                                   "tarefas.reabrir"}
         | {"comunicador.usar", "ia.usar", "clientes.ver", "contratos.ver"})},
    {"nome": "Financeiro", "descricao": "Faturamento, financeiro e NFS-e; cadastros só para consulta.", "cor": "#F5A623",
     "administrador": False, "sistema": False, "permissoes": sorted(
         _todas_de(*_FATURAMENTO, *_FINANCEIRO, *_NFSE) | _todas_de(*_CADASTROS, acoes=("ver", "ver_todas", "ver_todos"))
         | {"comunicador.usar", "ia.usar", "cfg_financeiro.ver", "cfg_financeiro.editar"})},
    {"nome": "Visualizador", "descricao": "Só consulta, sem alterar nada.", "cor": "#64748B", "administrador": False,
     "sistema": False, "permissoes": sorted({p for p in TODAS if p.endswith(".ver")} - _todas_de(*_CONFIG) | {"comunicador.usar"})},
]

# ------------------------------------------------------------------------------------------------- rota → permissão
LIVRE = None  # basta estar logado (listas usadas em formulários, dados públicos, a própria conta)
A = "/api"
# (métodos, regex do caminho, permissão) — a primeira regra que casa vale. "VER" vira ".ver" e "*" usa a ação por método.
_REGRAS: list[tuple[str, str, str | None]] = [
    ("POST", r"/auth/usuarios/\d+/foto$", "cfg_profissionais.editar"),
    ("DELETE", r"/auth/usuarios/\d+/foto$", "cfg_profissionais.editar"),
    ("*", r"/(auth|public|health|hub)(/|$)", LIVRE),
    ("GET", r"/cadastros/(cidades|cnpj)/", LIVRE),
    ("GET", r"/faturamento/(judiciario|profissionais)(/|$)", LIVRE),
    ("GET", r"/faturamento/(areas|campos|tabelas)$", LIVRE),
    ("GET", r"/financeiro/(categorias|favorecidos|config)$", LIVRE),
    ("GET", r"/config/(cargos|identidade|ia)$", LIVRE),
    ("GET", r"/nfse/emissoras$", LIVRE),
    ("*", r"/dashboard/", "dashboard.ver"),
    ("*", r"/comunicador(/|$)", "comunicador.usar"),
    ("*", r"/ia/", "ia.usar"),
    ("*", r"/faturamento/ia/", "ia.usar"),
    ("*", r"/faturamento/casos/(\d+/)?ia(/|$)", "ia.usar"),
    ("*", r"/faturamento/revisoes/\d+/ia", "ia.usar"),
    # cadastros
    ("POST", r"/nfse/tomadores/importar$", "clientes.importar"),
    ("*", r"/nfse/tomadores", "clientes.*"),
    ("POST", r"/faturamento/contratos/importar$", "contratos.importar"),
    ("POST", r"/faturamento/contratos/\d+/casos$", "casos.editar"),
    ("*", r"/faturamento/contratos/\d+/regras", "contratos.editar"),
    ("*", r"/faturamento/regras", "contratos.*e"),
    ("*", r"/faturamento/contratos", "contratos.*"),
    ("POST", r"/faturamento/casos/importar$", "casos.importar"),
    ("GET", r"/faturamento/casos/\d+/timesheet$", "timesheet.ver"),
    ("POST", r"/faturamento/casos/\d+/timesheet$", "timesheet.lancar"),
    ("*", r"/faturamento/timesheet/\d+$", "timesheet.lancar"),
    ("*", r"/faturamento/timesheet", "timesheet.ver"),
    ("GET", r"/faturamento/(casos|anexos|andamentos|despesas)", "casos.ver"),
    ("DELETE", r"/faturamento/casos/\d+$", "casos.excluir"),
    ("*", r"/faturamento/(casos|anexos|andamentos|despesas)", "casos.editar"),
    ("*", r"/faturamento/tarefas", "tarefas.*"),
    # faturamento
    ("GET", r"/faturamento/itens-a-faturar$", "itens_faturar.ver"),
    ("*", r"/faturamento/faturar$", "itens_faturar.faturar"),
    ("*", r"/faturamento/emitir-nfse$", "nfse_emissao.emitir"),
    ("*", r"/faturamento/faturas/\d+/cancelar$", "faturas.cancelar"),
    ("*", r"/faturamento/fluxo$", "faturas.ver"),
    ("POST", r"/faturamento/revisoes/\d+/aprovar$", "revisoes.aprovar"),
    ("*", r"/faturamento/revisoes", "revisoes.*e"),
    ("*", r"/faturamento/(areas|campos|tabelas)", "cfg_faturamento.editar"),
    ("*", r"/nfse/faturas/\d+/baixa$", "faturas.baixar"),
    ("POST", r"/nfse/faturas/zip$", "faturas.ver"),
    ("*", r"/nfse/faturas", "faturas.*e"),
    ("*", r"/financeiro/relatorio-faturamento", "relatorio_faturamento.ver"),
    ("GET", r"/financeiro/impostos$", "impostos.ver"),
    ("POST", r"/financeiro/impostos/(recalcular|\d+/simular)$", "impostos.ver"),
    ("*", r"/financeiro/impostos", "impostos.configurar"),
    # financeiro
    ("*", r"/financeiro/contas-pagar/(\d+/(pagar|reabrir)|pagar-lote)$", "contas_pagar.pagar"),
    ("*", r"/financeiro/contas-pagar", "contas_pagar.*"),
    ("*", r"/financeiro/(contas|lancamentos|transferencias)", "contas_bancarias.*"),
    ("*", r"/financeiro/(categorias|subcategorias)", "categorias_fin.*e"),
    ("*", r"/financeiro/fornecedores", "fornecedores.*"),
    ("*", r"/financeiro/(fluxo-caixa|dre|previsao-caixa|projecao-despesas)", "relatorios_fin.ver"),
    ("*", r"/financeiro/config$", "cfg_financeiro.editar"),
    # NFS-e
    ("*", r"/nfse/notas/\d+/baixa$", "faturas.baixar"),
    ("POST", r"/nfse/lotes/\d+/enviar-emails$", "nfse_notas.enviar_email"),
    ("*", r"/nfse/(importacoes|lotes)(/\d+)?/emitir", "nfse_emissao.emitir"),
    ("*", r"/nfse/(importacoes|lotes)", "nfse_emissao.*e"),
    ("*", r"/nfse/notas/\d+/cancelar$", "nfse_notas.cancelar"),
    ("*", r"/nfse/notas/(\d+/)?(email|enviar|enviar-emails)", "nfse_notas.enviar_email"),
    ("*", r"/nfse/(notas|painel)", "nfse_notas.ver"),
    ("*", r"/nfse/extratos", "nfse_recebimentos.*e"),
    ("*", r"/nfse/emissoras", "cfg_emissoras.*e"),
    # configurações
    ("*", r"/config/perfis", "cfg_perfis.*e"),
    ("*", r"/config/(usuarios|cargos)", "cfg_profissionais.*e"),
    ("*", r"/config/identidade", "cfg_identidade.editar"),
    ("*", r"/config/certificados", "cfg_certificado.*e"),
    ("*", r"/config/prefeitura", "cfg_prefeitura.*e"),
    ("*", r"/config/parametros-fiscais", "cfg_parametros.*e"),
    ("*", r"/config/notificacoes", "cfg_notificacoes.*e"),
    ("*", r"/config/automacoes", "cfg_automacoes.*e"),
    ("*", r"/auditoria", "auditoria.ver"),
]
_COMPILADAS = [(m, re.compile(A + rx), p) for m, rx, p in _REGRAS]


def _acao_por_metodo(metodo: str, so_editar: bool) -> str:
    if metodo in ("GET", "HEAD", "OPTIONS"):
        return "ver"
    if metodo == "DELETE" and not so_editar:
        return "excluir"
    return "editar"


def permissao_da_rota(metodo: str, caminho: str) -> tuple[bool, str | None]:
    """(mapeada?, permissão exigida). Permissão None = livre para quem está logado."""
    for m, rx, p in _COMPILADAS:
        if (m == "*" or m == metodo) and rx.search(caminho):
            if p is None:
                return True, None
            rec, acao = p.split(".")
            if acao in ("*", "*e"):  # pela ação do método ("*e": DELETE conta como editar)
                acao = _acao_por_metodo(metodo, acao == "*e")
            return True, f"{rec}.{acao}"
    return False, None


def normalizar(permissoes: list[str]) -> list[str]:
    """Só permissões conhecidas; quem pode editar/excluir/etc. também pode ver."""
    ok = {p for p in permissoes if p in TODAS}
    ok |= {f"{p.split('.')[0]}.ver" for p in ok if f"{p.split('.')[0]}.ver" in TODAS}
    return sorted(ok)
