"""Gera `docs/campos_padrao.md` (campos de cada tipo de caso, para suporte e implantação) a partir dos schemas e das
listas do código, para o documento nunca ficar diferente do sistema.

    uv run python -m app.modules.faturamento.doc_campos
"""

import types
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Union, get_args, get_origin

from app.modules.faturamento import envolvimento, listas
from app.modules.faturamento.schemas import AdministrativoDados, CasoIn, ConsultivoDados, ContenciosoDados
from app.modules.faturamento.tipos_caso import LISTAS, ROTULOS
from app.modules.pessoas import routes as pessoas_routes
from app.modules.pessoas import service as pessoas

DESTINO = Path(__file__).resolve().parents[4] / "docs" / "campos_padrao.md"

# campo → lista configurável (Configurações › Faturamento) de onde vem o valor
DA_LISTA = {"motivo_encerramento_id": "motivo_encerramento", "origem_id": "origem", "centro_custo_id": "centro_custo",
            "etiqueta_ids": "etiqueta", "classe_id": "classe", "assunto_id": "assunto", "assuntos_secundarios_ids": "assunto",
            "tipo_demanda_id": "tipo_demanda", "orgao_id": "orgao", "tipo_procedimento_id": "tipo_procedimento"}
OUTROS = {"area_id": "Área de atuação (Configurações › Faturamento)", "responsavel_id": "Profissional do escritório",
          "equipe_ids": "Profissionais do escritório", "tabela_preco_id": "Tabela de preço", "caso_pai_id": "Outro caso",
          "gerou_contencioso_id": "Outro caso", "caso_judicial_id": "Outro caso", "solicitante_id": "Pessoa do cadastro único",
          "documento_entregue_id": "Anexo do caso", "campos": "Campos adicionais do escritório (Configurações › Faturamento)",
          "representante_legal_id": "Pessoa do cadastro único", "polo": "ativo, passivo, terceiro (no contencioso vem das partes)",
          "instancia": ", ".join(ROTULOS["instancia"].values()),
          "tipo": "Calculado: consultivo, administrativo ou judicial estadual/federal/trabalhista (pela justiça)",
          "tipo_caso": ", ".join(ROTULOS["tipo_caso"].values()), "status": ", ".join(ROTULOS["status"].values())}
SO_LEITURA = ("_nome", "_titulo", "horas_realizadas", "assuntos_secundarios")
OBRIGATORIOS = {
    "caso": {"titulo": "sim (ou o modelo de título do cliente)", "tipo_caso": "sim (deduzido em chamadas antigas)",
             "data_encerramento": "quando encerrado"},
    "contencioso": {"numero_processo": "sim, salvo pré-ajuizamento"},
    "consultivo": {"tipo_demanda_id": "sim", "data_entrega": "quando a etapa é entregue ou concluído"},
    "administrativo": {"esfera": "sim", "orgao_id": "sim", "tipo_procedimento_id": "sim",
                       "numero_processo_adm": "este ou o protocolo, depois do pré-protocolo", "data_decisao": "quando há decisão"},
}


def _tipo(anotacao) -> str:
    origem = get_origin(anotacao)
    if origem in (Union, types.UnionType):
        return _tipo(next(a for a in get_args(anotacao) if a is not type(None)))
    if origem in (list, dict):
        return "lista" if origem is list else "campos"
    nomes = {str: "texto", bool: "sim/não", int: "número", Decimal: "valor", date: "data"}
    return nomes.get(anotacao, "opção")


def _tipo_do_campo(nome: str, anotacao) -> str:
    if nome.endswith("_ids"):
        return "várias escolhas"
    if nome.endswith("_id"):
        return "escolha"
    return "opção" if nome in ROTULOS else _tipo(anotacao)


def _tabela(modelo, grupo: str, pular: tuple[str, ...] = ()) -> list[str]:
    linhas = ["| Campo | Tipo | Obrigatório | Opções / de onde vem |", "|---|---|---|---|"]
    for nome, f in modelo.model_fields.items():
        if nome in pular or nome.endswith(SO_LEITURA[:2]) or nome in SO_LEITURA:
            continue
        if nome in DA_LISTA:
            opcoes = f"Lista “{LISTAS[DA_LISTA[nome]][0]}”"
        elif nome in OUTROS:
            opcoes = OUTROS[nome]
        elif nome in ROTULOS:
            opcoes = ", ".join(ROTULOS[nome].values())
        else:
            opcoes = ""
        linhas.append(f"| `{nome}` | {_tipo_do_campo(nome, f.annotation)} | {OBRIGATORIOS[grupo].get(nome, '')} | {opcoes} |")
    return linhas


def gerar() -> str:
    s = ["# Campos padrão por tipo de caso", "",
         "Gerado do código por `uv run python -m app.modules.faturamento.doc_campos` (não edite à mão). Os nomes são os da API "
         "(`CasoIn` / `CasoOut`); as listas marcadas como “Lista” são editadas pelo escritório em Configurações › Faturamento.", "",
         "## Campos comuns (todo caso)", ""]
    s += _tabela(CasoIn, "caso", pular=("contencioso", "consultivo", "administrativo"))
    s += ["", "O cliente do caso vem do contrato e entra sozinho entre as partes. A cobrança (forma, valor, êxito) é a regra de "
          "cobrança do caso ou do contrato, não um campo do caso.", "",
          "## Contencioso (bloco `contencioso`)", "",
          "Número do processo (CNJ), tribunal, vara, comarca, instância, valor da causa, data de distribuição e polo são os campos "
          "comuns acima. Com um número CNJ válido, justiça, tribunal, órgão e UF são preenchidos sozinhos.", ""]
    s += _tabela(ContenciosoDados, "contencioso")
    s += ["", "## Consultivo (bloco `consultivo`)", ""] + _tabela(ConsultivoDados, "consultivo")
    s += ["", "## Administrativo (bloco `administrativo`)", ""] + _tabela(AdministrativoDados, "administrativo")
    s += ["", "## Listas configuráveis e os valores que vêm prontos", ""]
    for cod, (nome, tipo) in LISTAS.items():
        valores = "; ".join(listas.SEEDS.get(cod, [])) or "(começa vazia: o escritório cria os seus)"
        s.append(f"- **{nome}** (`{cod}`" + (f", {ROTULOS['tipo_caso'][tipo].lower()}" if tipo else "") + f"): {valores}")
    s.append("- **Áreas de atuação**: " + "; ".join(listas.AREAS))
    s += ["", "## Partes do caso: categorias e qualificações", "",
          "As categorias são fixas por tipo de caso. As qualificações vêm prontas e o escritório pode acrescentar as suas.", ""]
    for tipo, cats in envolvimento.SEED.items():
        s += [f"### {ROTULOS['tipo_caso'][tipo]}", "", "| Categoria | Polo | Qualificações |", "|---|---|---|"]
        s += [f"| {nome} | {envolvimento.ROTULO_POLO[polo]} | {', '.join(quals)} |" for _, nome, polo, quals in cats]
        s.append("")
    s += ["Campos de cada parte: pessoa (cadastro único), categoria, qualificação, é cliente, principal, representado por, data de "
          "inclusão, data de exclusão, observações e advogados (advogado, OAB, principal, tipo de habilitação: "
          + ", ".join(envolvimento.HABILITACAO.values()) + ", datas de habilitação e desabilitação, procuração).", "",
          "## Pessoas (Cadastros › Pessoas)", "", "| Campo | Tipo | Opções |", "|---|---|---|"]
    for nome, f in pessoas_routes.PessoaIn.model_fields.items():
        if nome in ("advogado", "enderecos", "contatos"):
            continue
        tipo = "opção" if nome in pessoas.ROTULOS else _tipo_do_campo(nome, f.annotation)
        s.append(f"| `{nome}` | {tipo} | {', '.join(pessoas.ROTULOS[nome].values()) if nome in pessoas.ROTULOS else ''} |")
    s += ["", "- Endereços (vários): tipo (" + ", ".join(pessoas.ROTULOS["tipo_endereco"].values()) + "), CEP, logradouro, número, "
          "complemento, bairro, cidade, código IBGE, UF, país, principal.",
          "- Contatos (vários): tipo (" + ", ".join(pessoas.ROTULOS["tipo_contato"].values()) + "), valor, descrição, principal, "
          "aceita comunicação.",
          "- Advogado (quando a pessoa é advogado): sociedade, advogado do escritório (usuário), e-mail e telefone profissionais e "
          "inscrições na OAB (número, UF, tipo: " + ", ".join(pessoas.ROTULOS["tipo_inscricao"].values()) + "; situação: "
          + ", ".join(pessoas.ROTULOS["situacao_oab"].values()) + ").",
          "- A pessoa de um cliente traz o código do cliente (`cliente_id`); nome, CPF/CNPJ e tipo dela são os do cadastro de "
          "clientes.", ""]
    return "\n".join(s)


if __name__ == "__main__":
    DESTINO.write_text(gerar(), encoding="utf-8", newline="\n")
    print(f"Gerado: {DESTINO}")
