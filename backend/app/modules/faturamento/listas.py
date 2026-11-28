"""Listas configuráveis do escritório (Configurações › Faturamento): motivo de encerramento, origem, centro de custo,
etiqueta, classe, assunto, tipo de demanda, órgão e tipo de procedimento. Uma tabela só (`fat_lista_item`).

Os valores padrão (seed) entram sozinhos em todo escritório, novo ou antigo: `garantir_seeds` roda ao criar o
escritório e na leitura das listas. Item do sistema ou em uso nunca é apagado: é desativado.
"""

import re
import unicodedata

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import Admin, Ctx
from app.core.schemas import Mensagem, Schema
from app.modules.faturamento.models import AreaAtuacao, Caso
from app.modules.faturamento.tipos_caso import LISTAS, CasoLista, ListaItem

router = APIRouter(prefix="/faturamento/listas", tags=["Faturamento · Listas"])

AREAS = ["Cível", "Trabalhista", "Tributário", "Previdenciário", "Família", "Consumidor", "Empresarial/Societário", "Criminal",
         "Administrativo", "Ambiental", "Imobiliário", "Bancário", "Contratual", "Digital/LGPD", "Regulatório", "Securitário",
         "Eleitoral", "Outros"]

SEEDS: dict[str, list[str]] = {
    "motivo_encerramento": ["Êxito", "Acordo", "Improcedência", "Desistência", "Perda de objeto", "Entregue (consultivo)",
                            "Revogação de mandato", "Outros"],
    "origem": ["Indicação", "Site", "Cliente recorrente", "Parceiro", "Outros"],
    "tipo_demanda": ["Parecer", "Elaboração de contrato", "Revisão de contrato", "Due diligence", "Opinião legal",
                     "Compliance/Programa de integridade", "LGPD/Privacidade",
                     "Societário (alteração, constituição, acordo de sócios)", "Planejamento tributário",
                     "Planejamento sucessório", "Notificação extrajudicial", "Negociação", "Reunião/Consulta",
                     "Registro de marca/PI", "Regularização imobiliária", "Outros"],
    "orgao": ["Receita Federal", "PGFN", "CARF", "INSS/CRPS", "Ministério do Trabalho (SRTE)", "SEFAZ", "TIT/SP",
              "Prefeitura (ISS/IPTU)", "PROCON", "Senacon", "ANATEL", "ANS", "ANVISA", "ANEEL", "ANTT", "ANP", "ANAC", "BACEN",
              "CVM", "SUSEP", "CADE", "IBAMA", "CETESB/órgão ambiental estadual", "DETRAN", "Junta Comercial", "INPI",
              "Tribunal de Contas (TCU/TCE/TCM)", "Corregedoria", "OAB (TED)", "Conselhos profissionais",
              "Polícia Federal (imigração/armas)", "Cartórios", "Outros"],
    "tipo_procedimento": ["Defesa de auto de infração", "Impugnação", "Recurso voluntário", "Recurso especial (CARF)",
                          "Manifestação de inconformidade", "Pedido de restituição/compensação", "Consulta fiscal",
                          "Parcelamento/transação", "Requerimento de benefício (INSS)", "Recurso CRPS", "Reclamação PROCON",
                          "Processo administrativo disciplinar (PAD)", "Sindicância", "Licitação/impugnação de edital",
                          "Recurso em licitação", "Licenciamento (ambiental/sanitário)", "Registro/autorização",
                          "Processo sancionador (agência reguladora)", "Ato de concentração (CADE)", "Tomada de contas", "Outros"],
    "classe": ["Procedimento Comum Cível", "Execução de Título Extrajudicial", "Cumprimento de Sentença", "Mandado de Segurança",
               "Ação Trabalhista - Rito Ordinário", "Ação Trabalhista - Rito Sumaríssimo",
               "Procedimento do Juizado Especial Cível", "Embargos à Execução", "Monitória", "Busca e Apreensão", "Despejo",
               "Inventário", "Divórcio", "Alimentos", "Recuperação Judicial", "Falência", "Execução Fiscal",
               "Embargos de Terceiro", "Ação Civil Pública", "Tutela Cautelar Antecedente", "Agravo de Instrumento", "Apelação",
               "Recurso Ordinário", "Recurso Inominado", "Recurso de Revista", "Recurso Especial", "Recurso Extraordinário",
               "Ação Penal - Procedimento Ordinário", "Habeas Corpus"],
    "assunto": ["Indenização por Dano Moral", "Indenização por Dano Material", "Inadimplemento", "Rescisão do contrato",
                "Cobrança", "Contratos Bancários", "Cédula de Crédito Bancário", "Práticas Abusivas",
                "Inclusão Indevida em Cadastro de Inadimplentes", "Despesas Condominiais", "Locação de Imóvel",
                "Compra e Venda", "Planos de Saúde", "Acidente de Trânsito", "Responsabilidade Civil", "Alimentos",
                "Guarda", "Dissolução", "Inventário e Partilha", "Verbas Rescisórias", "Horas Extras",
                "Reconhecimento de Relação de Emprego", "Adicional de Insalubridade", "Rescisão Indireta", "FGTS",
                "Aposentadoria por Tempo de Contribuição", "Auxílio por Incapacidade Temporária",
                "Benefício Assistencial (LOAS)", "ICMS", "ISS", "IRPJ", "Contribuições Previdenciárias",
                "Dívida Ativa", "Recuperação judicial e Falência", "Marca", "Proteção de Dados Pessoais (LGPD)"],
}
TOTAL_SEEDS = sum(len(v) for v in SEEDS.values())


def slug(texto: str) -> str:
    s = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")[:80]


def garantir_seeds(db: Session, tenant_id: int) -> int:
    """Cria os itens padrão que faltarem (e as áreas de atuação que faltarem). Idempotente; devolve quantos criou."""
    tem = db.scalar(select(func.count()).select_from(ListaItem).where(ListaItem.tenant_id == tenant_id, ListaItem.sistema)) or 0
    if tem >= TOTAL_SEEDS:  # item do sistema nunca é apagado, então a contagem basta
        return 0
    existentes = set(db.execute(select(ListaItem.lista, ListaItem.codigo).where(
        ListaItem.tenant_id == tenant_id, ListaItem.sistema)).all())
    criados = 0
    try:
        with db.begin_nested():
            for lista, nomes in SEEDS.items():
                for ordem, nome in enumerate(nomes, start=1):
                    if (lista, slug(nome)) not in existentes:
                        db.add(ListaItem(tenant_id=tenant_id, lista=lista, codigo=slug(nome), nome=nome, ordem=ordem, sistema=True))
                        criados += 1
            areas = {slug(n) for n in db.scalars(select(AreaAtuacao.nome).where(AreaAtuacao.tenant_id == tenant_id))}
            ordem = db.scalar(select(func.max(AreaAtuacao.ordem)).where(AreaAtuacao.tenant_id == tenant_id)) or 0
            for nome in AREAS:
                if slug(nome) not in areas and slug(nome.split("/")[0]) not in areas:
                    ordem += 1
                    db.add(AreaAtuacao(tenant_id=tenant_id, nome=nome, ordem=ordem))
                    criados += 1
            db.flush()
    except IntegrityError:  # outro pedido criou ao mesmo tempo
        return 0
    return criados


def garantir(ctx) -> None:
    if garantir_seeds(ctx.db, ctx.tenant_id):
        ctx.db.commit()


def item_da_lista(db: Session, tenant_id: int, item_id: int | None, lista: str, rotulo: str) -> ListaItem | None:
    """Confere que o item existe, é do escritório e é da lista certa."""
    if not item_id:
        return None
    it = db.get(ListaItem, item_id)
    if not it or it.tenant_id != tenant_id or it.lista != lista:
        raise HTTPException(400, f"{rotulo}: escolha um item da lista.")
    return it


def nomes(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    return dict(db.execute(select(ListaItem.id, ListaItem.nome).where(ListaItem.id.in_(ids))).all()) if ids else {}


def em_uso(db: Session, item_id: int) -> int:
    """Quantos casos usam o item (qualquer campo que aponte para a lista)."""
    from app.modules.faturamento import tipos_caso as tc

    total = db.scalar(select(func.count()).select_from(CasoLista).where(CasoLista.item_id == item_id)) or 0
    colunas = [Caso.motivo_encerramento_id, Caso.origem_id, Caso.centro_custo_id]
    for modelo, campos in (("CasoContencioso", ("classe_id", "assunto_id")), ("CasoConsultivo", ("tipo_demanda_id",)),
                           ("CasoAdministrativo", ("orgao_id", "tipo_procedimento_id"))):
        if hasattr(tc, modelo):
            colunas += [getattr(getattr(tc, modelo), c) for c in campos]
    for col in colunas:
        total += db.scalar(select(func.count()).where(col == item_id)) or 0
    return total


# ---------------------------------------------------------------------------------------------------- rotas
class ListaItemIn(BaseModel):
    lista: str = Field(max_length=30)
    nome: str = Field(min_length=1, max_length=150)
    ordem: int = 0
    ativo: bool = True


class ListaItemOut(Schema):
    id: int
    lista: str
    nome: str
    ordem: int
    ativo: bool
    sistema: bool


def _item(ctx, iid: int) -> ListaItem:
    it = ctx.db.get(ListaItem, iid)
    if not it or it.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Item não encontrado.")
    return it


def _repetido(ctx, lista: str, nome: str, exceto: int | None = None) -> bool:
    return any(slug(n) == slug(nome) for i, n in ctx.db.execute(select(ListaItem.id, ListaItem.nome).where(
        ListaItem.tenant_id == ctx.tenant_id, ListaItem.lista == lista)).all() if i != exceto)


@router.get("/tipos")
def tipos_de_lista(ctx: Ctx):
    """As listas que existem: código, nome e o tipo de caso em que aparecem (vazio = todos)."""
    return [{"lista": k, "nome": nome, "tipo_caso": tipo} for k, (nome, tipo) in LISTAS.items()]


@router.get("", response_model=list[ListaItemOut])
def listar(ctx: Ctx, lista: str | None = None, ativos: bool | None = None):
    """Itens de uma lista (ou de todas), na ordem de exibição."""
    if lista and lista not in LISTAS:
        raise HTTPException(404, "Lista não encontrada.")
    garantir(ctx)
    sel = select(ListaItem).where(ListaItem.tenant_id == ctx.tenant_id)
    if lista:
        sel = sel.where(ListaItem.lista == lista)
    if ativos is not None:
        sel = sel.where(ListaItem.ativo == ativos)
    return ctx.db.scalars(sel.order_by(ListaItem.lista, ListaItem.ordem, ListaItem.nome)).all()


@router.post("", response_model=ListaItemOut, status_code=201)
def criar(dados: ListaItemIn, ctx: Admin):
    if dados.lista not in LISTAS:
        raise HTTPException(400, "Lista não encontrada.")
    garantir(ctx)
    nome = dados.nome.strip()
    if _repetido(ctx, dados.lista, nome):
        raise HTTPException(409, "Este item já existe na lista.")
    ordem = dados.ordem or (ctx.db.scalar(select(func.max(ListaItem.ordem)).where(
        ListaItem.tenant_id == ctx.tenant_id, ListaItem.lista == dados.lista)) or 0) + 1
    it = ListaItem(tenant_id=ctx.tenant_id, lista=dados.lista, nome=nome, ordem=ordem, ativo=dados.ativo)
    ctx.db.add(it)
    ctx.db.flush()
    ctx.auditar("faturamento.lista.criar", "fat_lista_item", it.id, descricao=f"{LISTAS[it.lista][0]}: {it.nome}")
    ctx.db.commit()
    return it


@router.put("/{iid}", response_model=ListaItemOut)
def alterar(iid: int, dados: ListaItemIn, ctx: Admin):
    it = _item(ctx, iid)
    nome = dados.nome.strip()
    if dados.lista != it.lista:
        raise HTTPException(400, "O item não muda de lista.")
    if _repetido(ctx, it.lista, nome, exceto=it.id):
        raise HTTPException(409, "Este item já existe na lista.")
    it.nome, it.ordem, it.ativo = nome, dados.ordem, dados.ativo
    ctx.auditar("faturamento.lista.alterar", "fat_lista_item", it.id, descricao=f"{LISTAS[it.lista][0]}: {it.nome}")
    ctx.db.commit()
    return it


@router.delete("/{iid}", response_model=Mensagem)
def excluir(iid: int, ctx: Admin):
    it = _item(ctx, iid)
    descricao = f"{LISTAS[it.lista][0]}: {it.nome}"
    if it.sistema or em_uso(ctx.db, it.id):
        it.ativo = False
        ctx.auditar("faturamento.lista.desativar", "fat_lista_item", it.id, descricao=descricao)
        ctx.db.commit()
        return Mensagem(mensagem="Item padrão do sistema: foi desativado." if it.sistema else "Item usado em casos: foi desativado.")
    ctx.auditar("faturamento.lista.excluir", "fat_lista_item", it.id, descricao=descricao)
    ctx.db.delete(it)
    ctx.db.commit()
    return Mensagem(mensagem="Item excluído.")
