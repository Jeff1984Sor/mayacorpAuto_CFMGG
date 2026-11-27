"""Relatórios prontos: configurações do motor (colunas, filtros, gráfico). O usuário abre, mexe e salva como seu."""


def _p(id_, grupo, nome, descricao, icone, fonte, colunas, grafico, filtros=None, ordenar=None):
    return {"id": id_, "grupo": grupo, "nome": nome, "descricao": descricao, "icone": icone, "fonte": fonte,
            "config": {"colunas": colunas, "filtros": filtros or [], "grafico": grafico, "ordenar": ordenar or []}}


_ESTE_MES = {"coluna": "data", "relativo": "este_mes"}
_ESTE_ANO = {"coluna": "data", "relativo": "este_ano"}
_ABERTOS = {"coluna": "status", "valores": ["Aberto"]}
_PENDENTES = {"coluna": "status", "valores": ["A fazer", "Em andamento"]}
_HORAS = ["data", "cliente", "contrato", "caso", "profissional", "descricao", "horas", "situacao", "valor"]

PRONTOS: list[dict] = [
    # ---------------------------------------------------------------- Clientes
    _p("horas-por-cliente", "Clientes", "Planilha de horas por cliente", "Quanto tempo cada cliente consumiu, dividido por profissional.",
       "users", "horas", _HORAS,
       {"tipo": "barras_h", "dimensao": "cliente", "serie": "profissional", "medida": "horas"},
       [_ESTE_MES], [{"coluna": "cliente"}, {"coluna": "data"}]),
    _p("horas-por-contrato", "Clientes", "Planilha de horas por contrato", "Horas de cada contrato, separando o que já foi faturado.",
       "file-signature", "horas", _HORAS,
       {"tipo": "barras_h", "dimensao": "contrato", "serie": "situacao", "medida": "horas"},
       [_ESTE_MES], [{"coluna": "contrato"}, {"coluna": "data"}]),
    _p("horas-por-profissional-cliente", "Clientes", "Planilha de horas por profissional", "Horas de cada profissional, por cliente atendido.",
       "user-round", "horas", ["data", "profissional", "cliente", "caso", "descricao", "horas", "valor"],
       {"tipo": "barras", "dimensao": "profissional", "serie": "cliente", "medida": "horas"},
       [_ESTE_MES], [{"coluna": "profissional"}, {"coluna": "data"}]),
    _p("regras-de-cobranca", "Clientes", "Regras de cobrança", "Como cada cliente é cobrado: fixo, recorrente ou por hora, com valores.",
       "receipt", "regras", ["cliente", "contrato", "caso", "tipo", "descricao", "valor", "frequencia", "inicio", "ativo"],
       {"tipo": "barras_h", "dimensao": "cliente", "serie": "tipo", "medida": "valor"},
       [{"coluna": "ativo", "valores": ["Sim"]}], [{"coluna": "cliente"}, {"coluna": "contrato"}]),
    # ---------------------------------------------------------------- Casos
    _p("informacoes-processuais", "Casos", "Informações processuais", "Processo, tribunal, vara, comarca, instância e o último andamento de cada caso.",
       "scale", "casos", ["numero", "titulo", "cliente", "processo", "tribunal", "vara", "comarca", "instancia", "polo",
                          "parte_contraria", "valor_causa", "ult_andamento_data", "ult_andamento"],
       {"tipo": "barras_h", "dimensao": "tribunal", "serie": "instancia"}, [_ABERTOS], [{"coluna": "numero"}]),
    _p("horas-por-caso", "Casos", "Planilha de horas por caso", "Horas lançadas em cada caso, por profissional.",
       "briefcase", "horas", ["data", "caso", "cliente", "profissional", "descricao", "horas", "situacao", "valor"],
       {"tipo": "barras_h", "dimensao": "caso", "serie": "profissional", "medida": "horas"},
       [_ESTE_MES], [{"coluna": "caso"}, {"coluna": "data"}]),
    _p("horas-por-profissional-casos", "Casos", "Planilha de horas por profissional", "A evolução das horas de cada profissional, mês a mês.",
       "user-round", "horas", ["data", "profissional", "caso", "cliente", "descricao", "horas"],
       {"tipo": "linhas", "dimensao": "data", "granularidade": "mes", "serie": "profissional", "medida": "horas"},
       [{"coluna": "data", "relativo": "ultimos_12m"}], [{"coluna": "profissional"}, {"coluna": "data"}]),
    _p("casos-por-cliente", "Casos", "Casos por cliente", "Quantos casos cada cliente tem, abertos e encerrados.",
       "users", "casos", ["numero", "titulo", "cliente", "area", "status", "responsavel", "abertura"],
       {"tipo": "barras_h", "dimensao": "cliente", "serie": "status"}, [], [{"coluna": "cliente"}, {"coluna": "numero"}]),
    _p("casos-por-foro", "Casos", "Casos por foro", "Onde estão os processos: comarca/tribunal, vara e tipo de ação.",
       "landmark", "casos", ["numero", "titulo", "cliente", "foro", "vara", "tribunal", "processo", "tipo"],
       {"tipo": "barras_h", "dimensao": "foro", "serie": "tipo"}, [_ABERTOS], [{"coluna": "foro"}, {"coluna": "vara"}]),
    _p("casos-por-profissional", "Casos", "Casos por profissional", "A carteira de cada responsável, por área de atuação.",
       "user-check", "casos", ["numero", "titulo", "cliente", "responsavel", "area", "status", "tarefas_abertas", "horas"],
       {"tipo": "barras", "dimensao": "responsavel", "serie": "area"}, [_ABERTOS], [{"coluna": "responsavel"}, {"coluna": "numero"}]),
    _p("clientes-e-casos", "Casos", "Clientes e casos", "A lista completa de casos por cliente e área.",
       "folder-open", "casos", ["cliente", "contrato", "numero", "titulo", "area", "tipo", "status", "responsavel", "abertura"],
       {"tipo": "rosca", "dimensao": "area"}, [], [{"coluna": "cliente"}, {"coluna": "numero"}]),
    _p("andamentos", "Casos", "Andamentos do período", "Movimentações, publicações e decisões registradas nos casos.",
       "scroll", "andamentos", ["data", "tipo", "titulo", "caso", "processo", "cliente"],
       {"tipo": "empilhado", "dimensao": "data", "granularidade": "semana", "serie": "tipo"},
       [{"coluna": "data", "relativo": "ultimos_30"}], [{"coluna": "data", "desc": True}]),
    _p("agenda", "Casos", "Agenda", "Prazos, audiências e reuniões dos próximos 30 dias.",
       "calendar", "tarefas", ["prazo", "hora", "tipo", "titulo", "responsavel", "caso", "cliente", "prioridade"],
       {"tipo": "empilhado", "dimensao": "prazo", "granularidade": "dia", "serie": "tipo"},
       [{"coluna": "prazo", "relativo": "proximos_30"}, _PENDENTES], [{"coluna": "prazo"}, {"coluna": "hora"}]),
    _p("pauta-de-audiencia", "Casos", "Pauta de audiência", "Audiências marcadas, com processo, vara e comarca.",
       "gavel", "tarefas", ["prazo", "hora", "titulo", "processo", "local", "caso", "cliente", "responsavel"],
       {"tipo": "barras", "dimensao": "prazo", "granularidade": "semana", "serie": "responsavel"},
       [{"coluna": "tipo", "valores": ["Audiência"]}, {"coluna": "prazo", "relativo": "hoje_em_diante"}, _PENDENTES],
       [{"coluna": "prazo"}, {"coluna": "hora"}]),
    _p("timesheet", "Casos", "Timesheet", "Todos os lançamentos de horas, mês a mês.",
       "clock", "horas", _HORAS, {"tipo": "barras", "dimensao": "data", "granularidade": "mes", "serie": "situacao", "medida": "horas"},
       [{"coluna": "data", "relativo": "ultimos_12m"}], [{"coluna": "data", "desc": True}]),
    # ---------------------------------------------------------------- Financeiro
    _p("despesas-lancadas", "Financeiro", "Despesas lançadas", "Despesas dos casos por mês e tipo, com a situação de reembolso.",
       "wallet", "despesas", ["data", "cliente", "caso", "tipo", "descricao", "valor", "situacao"],
       {"tipo": "empilhado", "dimensao": "data", "granularidade": "mes", "serie": "tipo", "medida": "valor"},
       [_ESTE_ANO], [{"coluna": "data", "desc": True}]),
    _p("gerencial-despesas", "Financeiro", "Gerencial de despesas", "Para onde vai o dinheiro: despesas por tipo e por cliente.",
       "pie-chart", "despesas", ["cliente", "tipo", "descricao", "valor", "situacao", "data"],
       {"tipo": "rosca", "dimensao": "tipo", "medida": "valor"}, [_ESTE_ANO], [{"coluna": "valor", "desc": True}]),
    _p("faturamento", "Financeiro", "Faturamento", "NH e ND emitidas por mês, pela situação de pagamento.",
       "receipt-text", "faturas", ["codigo", "tipo", "cliente", "emissao", "vencimento", "valor", "situacao", "nfse"],
       {"tipo": "empilhado", "dimensao": "emissao", "granularidade": "mes", "serie": "situacao", "medida": "valor"},
       [{"coluna": "emissao", "relativo": "este_ano"}, {"coluna": "situacao", "valores": ["Cancelada"], "negar": True}],
       [{"coluna": "emissao", "desc": True}]),
    _p("recebimento", "Financeiro", "Recebimento", "O que entrou, mês a mês, e quanto cada cliente levou para pagar.",
       "hand-coins", "faturas", ["codigo", "cliente", "emissao", "pago_em", "dias_receber", "valor"],
       {"tipo": "barras", "dimensao": "pago_em", "granularidade": "mes", "serie": "tipo", "medida": "valor"},
       [{"coluna": "pago_em", "relativo": "este_ano"}, {"coluna": "situacao", "valores": ["Paga"]}],
       [{"coluna": "pago_em", "desc": True}]),
    _p("horas-faturadas", "Financeiro", "Horas faturadas", "Horas que já viraram fatura, por profissional e valor.",
       "timer", "horas", ["data", "profissional", "cliente", "caso", "horas", "valor_hora", "valor", "fatura"],
       {"tipo": "barras_h", "dimensao": "profissional", "serie": "cliente", "medida": "valor"},
       [_ESTE_ANO, {"coluna": "situacao", "valores": ["Faturada"]}], [{"coluna": "data", "desc": True}]),
]

POR_ID = {p["id"]: p for p in PRONTOS}

# além da permissão da fonte (o relatório não tem sentido sem os valores)
PERMISSAO_EXTRA = {"horas-faturadas": "faturas.ver"}
