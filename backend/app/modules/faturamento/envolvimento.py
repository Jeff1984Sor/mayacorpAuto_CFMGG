"""Partes do caso (aba Partes): o envolvimento de uma Pessoa do cadastro único num caso, com categoria (ex.: Polo
Ativo), qualificação (ex.: Autor) e os advogados daquela parte.

- As categorias dependem do tipo do caso e vêm de seed (não se criam nem se apagam); as qualificações também vêm de
  seed e o escritório pode acrescentar as suas.
- O cliente do caso (o do contrato) entra sozinho como parte "é cliente"; o caso nunca fica sem cliente.
- No contencioso, `Caso.polo` é calculado das partes que são cliente (`sincronizar_polo`).
- Conflito de interesses: a mesma pessoa é cliente num caso em andamento e parte contrária em outro. Avisa e pede
  confirmação; quem confirmou fica na auditoria.
"""

from datetime import date

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import Admin, Ctx, Operador
from app.core.schemas import Mensagem
from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento.listas import slug
from app.modules.faturamento.models import AnexoCaso, Caso, Contrato, StatusCaso
from app.modules.faturamento.tipos_caso import (
    ROTULOS,
    EnvCategoria,
    Envolvimento,
    EnvolvimentoAdvogado,
    EnvQualificacao,
    TipoDeCaso,
)
from app.modules.pessoas import service as pessoas
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.tribunais.models import Pessoa

router = APIRouter(prefix="/faturamento", tags=["Faturamento · Partes do caso"])

HABILITACAO = {"procuracao": "Procuração", "substabelecimento_com_reserva": "Substabelecimento com reserva",
               "substabelecimento_sem_reserva": "Substabelecimento sem reserva", "defensor_publico": "Defensor público",
               "dativo": "Dativo", "procurador_publico": "Procurador público"}
ROTULO_POLO = {"ativo": "Ativo", "passivo": "Passivo", "neutro": "Neutro"}
POLO_DO_CASO = {"ativo": "ativo", "passivo": "passivo", "neutro": "terceiro"}  # polo da categoria → Caso.polo
EM_ANDAMENTO = (StatusCaso.aberto, StatusCaso.suspenso)

# Seeds das seções 6.2 a 6.4 da especificação: tipo de caso → [(código, categoria, polo, qualificações)]
SEED: dict[str, list[tuple[str, str, str, list[str]]]] = {
    "contencioso": [
        ("polo_ativo", "Polo Ativo", "ativo", [
            "Autor", "Requerente", "Reclamante", "Exequente", "Impetrante", "Embargante", "Apelante", "Agravante", "Recorrente",
            "Querelante", "Denunciante (penal)", "Assistente de Acusação", "Litisconsorte Ativo", "Credor", "Alimentando",
            "Inventariante", "Promovente", "Suscitante", "Oponente"]),
        ("polo_passivo", "Polo Passivo", "passivo", [
            "Réu", "Requerido", "Reclamado", "Executado", "Impetrado (autoridade coatora)", "Embargado", "Apelado", "Agravado",
            "Recorrido", "Querelado", "Denunciado/Acusado", "Investigado", "Litisconsorte Passivo", "Devedor", "Alimentante",
            "Promovido", "Suscitado", "Oposto", "Responsável Subsidiário/Solidário (trabalhista)"]),
        ("terceiros", "Terceiros", "neutro", [
            "Terceiro Interessado", "Assistente Simples", "Assistente Litisconsorcial", "Denunciado à Lide",
            "Chamado ao Processo", "Opoente", "Amicus Curiae", "Terceiro Embargante", "Arrematante", "Credor Habilitado",
            "Administrador Judicial", "Interveniente"]),
        ("outros", "Outros", "neutro", [
            "Ministério Público (fiscal da ordem jurídica)", "Defensoria Pública", "Perito Judicial", "Assistente Técnico",
            "Testemunha", "Informante", "Preposto", "Curador Especial", "Tutor/Curador", "Representante Legal", "Leiloeiro",
            "Depositário", "Intérprete/Tradutor", "Mediador/Conciliador", "Correspondente"]),
    ],
    "consultivo": [
        ("cliente", "Cliente / Solicitante", "ativo", [
            "Cliente", "Contratante", "Solicitante", "Consulente", "Sócio/Acionista", "Administrador", "Empresa do Grupo",
            "Beneficiário"]),
        ("contraparte", "Contraparte", "passivo", [
            "Contraparte", "Contratado", "Fornecedor", "Locador", "Locatário", "Comprador", "Vendedor", "Cedente", "Cessionário",
            "Investidor", "Empresa-alvo (M&A/Due diligence)", "Licenciante", "Licenciado", "Notificado"]),
        ("intervenientes", "Intervenientes", "neutro", [
            "Interveniente Anuente", "Fiador/Avalista", "Garantidor", "Cônjuge Anuente", "Testemunha Contratual",
            "Agente Fiduciário", "Escrow Agent"]),
        ("outros", "Outros", "neutro", [
            "Assessor Externo", "Contador", "Auditor", "Consultor Técnico", "Corretor", "Cartório/Tabelião", "Órgão de Registro",
            "Advogado da Contraparte", "Parecerista Externo"]),
    ],
    "administrativo": [
        ("interessado", "Interessado / Requerente", "ativo", [
            "Interessado", "Requerente", "Autuado", "Contribuinte", "Impugnante", "Recorrente", "Segurado/Beneficiário",
            "Licitante", "Reclamante (PROCON)", "Representante (denúncia)", "Servidor Processado (PAD)", "Requerente de Licença"]),
        ("orgao", "Órgão / Autoridade", "passivo", [
            "Órgão Público", "Autoridade Autuante", "Autoridade Julgadora", "Fazenda Pública", "Agência Reguladora",
            "Comissão de Licitação/Agente de Contratação", "Comissão Processante", "Recorrido"]),
        ("terceiros", "Terceiros Interessados", "neutro", [
            "Terceiro Interessado", "Concorrente", "Licitante Concorrente", "Reclamado (PROCON)", "Representado",
            "Responsável Solidário", "Coobrigado"]),
        ("outros", "Outros", "neutro", [
            "Fiscal/Auditor", "Perito", "Assistente Técnico", "Testemunha", "Relator/Conselheiro", "Procurador do Órgão",
            "Ministério Público de Contas", "Preposto", "Contador"]),
    ],
}
TOTAL_CATEGORIAS = sum(len(v) for v in SEED.values())
TOTAL_QUALIFICACOES = sum(len(q) for v in SEED.values() for *_, q in v)


# ------------------------------------------------------------------------------------------------ seeds
def garantir_seeds(db: Session, tenant_id: int) -> int:
    """Cria as categorias e qualificações padrão que faltarem. Idempotente; devolve quantas criou."""
    n_cat = db.scalar(select(func.count()).select_from(EnvCategoria).where(
        EnvCategoria.tenant_id == tenant_id, EnvCategoria.sistema)) or 0
    n_qual = db.scalar(select(func.count()).select_from(EnvQualificacao).where(
        EnvQualificacao.tenant_id == tenant_id, EnvQualificacao.sistema)) or 0
    if n_cat >= TOTAL_CATEGORIAS and n_qual >= TOTAL_QUALIFICACOES:  # item do sistema nunca é apagado
        return 0
    criados = 0
    try:
        with db.begin_nested():
            cats = {(c.tipo_caso, c.codigo): c for c in db.scalars(select(EnvCategoria).where(EnvCategoria.tenant_id == tenant_id))}
            for tipo, lista in SEED.items():
                for ordem, (codigo, nome, polo, quals) in enumerate(lista, start=1):
                    cat = cats.get((tipo, codigo))
                    if cat is None:
                        cat = EnvCategoria(tenant_id=tenant_id, tipo_caso=tipo, codigo=codigo, nome=nome, polo=polo, ordem=ordem,
                                           sistema=True)
                        db.add(cat)
                        db.flush()
                        criados += 1
                    tem = set(db.scalars(select(EnvQualificacao.codigo).where(EnvQualificacao.categoria_id == cat.id)))
                    for n, q in enumerate(quals, start=1):
                        if slug(q) not in tem:
                            db.add(EnvQualificacao(tenant_id=tenant_id, categoria_id=cat.id, codigo=slug(q), nome=q, ordem=n,
                                                   sistema=True))
                            criados += 1
            db.flush()
    except IntegrityError:  # outro pedido criou ao mesmo tempo
        return 0
    return criados


def categorias(db: Session, tenant_id: int, tipo_caso: str | None = None) -> list[EnvCategoria]:
    garantir_seeds(db, tenant_id)
    sel = select(EnvCategoria).where(EnvCategoria.tenant_id == tenant_id)
    if tipo_caso:
        sel = sel.where(EnvCategoria.tipo_caso == tipo_caso)
    return list(db.scalars(sel.order_by(EnvCategoria.tipo_caso, EnvCategoria.ordem, EnvCategoria.id)))


def categoria_do_polo(db: Session, tenant_id: int, tipo_caso: str, polo: str) -> EnvCategoria:
    """A categoria do tipo de caso para um polo: ativo, passivo, terceiro (só contencioso) ou neutro (= Outros)."""
    cats = categorias(db, tenant_id, tipo_caso)
    if polo in ("ativo", "passivo"):
        return next(c for c in cats if c.polo == polo)
    if polo == "terceiro":
        return next((c for c in cats if c.codigo in ("terceiros", "intervenientes")), cats[-1])
    return next(c for c in cats if c.codigo == "outros")


# ------------------------------------------------------------------------------------------------ cliente e polo
def _ativos(db: Session, caso_id: int) -> list[Envolvimento]:
    return list(db.scalars(select(Envolvimento).where(Envolvimento.caso_id == caso_id, Envolvimento.ativo)
                           .order_by(Envolvimento.ordem, Envolvimento.id)))


def _cats(db: Session, envs) -> dict[int, EnvCategoria]:
    ids = {e.categoria_id for e in envs}
    return {c.id: c for c in db.scalars(select(EnvCategoria).where(EnvCategoria.id.in_(ids)))} if ids else {}


def garantir_cliente(db: Session, c: Caso) -> Envolvimento | None:
    """O cliente do caso (o do contrato) entra como parte "é cliente" se o caso ainda não tem nenhuma.
    Sem polo conhecido no contencioso, vai para o lado ativo marcado "pendente de reclassificação"."""
    if c.id is None:
        db.flush()
    if db.scalar(select(Envolvimento.id).where(Envolvimento.caso_id == c.id, Envolvimento.eh_cliente, Envolvimento.ativo).limit(1)):
        return None
    contrato = db.get(Contrato, c.contrato_id)
    tomador = contrato.tomador if contrato else None
    if tomador is None:
        return None
    pessoa_id = pessoas.garantir_pessoa_do_cliente(db, tomador)
    tipo = regras_caso.tipo_caso_de(c)
    polo = c.polo if tipo == TipoDeCaso.contencioso and c.polo in ("ativo", "passivo", "terceiro") else "ativo"
    cat = categoria_do_polo(db, c.tenant_id, tipo, polo)
    existente = db.scalar(select(Envolvimento).where(Envolvimento.caso_id == c.id, Envolvimento.pessoa_id == pessoa_id)
                          .order_by(Envolvimento.id).limit(1))
    if existente:  # já estava no caso (desativada ou sem a marca de cliente): volta como cliente
        existente.eh_cliente, existente.ativo, existente.data_exclusao = True, True, None
        return existente
    e = Envolvimento(tenant_id=c.tenant_id, caso_id=c.id, pessoa_id=pessoa_id, categoria_id=cat.id, eh_cliente=True,
                     principal=not _tem_principal(db, c.id, cat.id), data_inclusao=c.data_abertura,
                     pendente_reclassificacao=tipo == TipoDeCaso.contencioso and c.polo not in ("ativo", "passivo", "terceiro"))
    db.add(e)
    db.flush()
    return e


def _tem_principal(db: Session, caso_id: int, categoria_id: int, exceto: int | None = None) -> Envolvimento | None:
    sel = select(Envolvimento).where(Envolvimento.caso_id == caso_id, Envolvimento.categoria_id == categoria_id,
                                     Envolvimento.principal, Envolvimento.ativo)
    if exceto:
        sel = sel.where(Envolvimento.id != exceto)
    return db.scalars(sel.limit(1)).first()


def polo_do_cliente(db: Session, c: Caso) -> tuple[str | None, bool]:
    """(polo do cliente pelas partes, há clientes em polos diferentes?). Partes pendentes de reclassificação não contam."""
    envs = [e for e in _ativos(db, c.id) if e.eh_cliente and not e.pendente_reclassificacao]
    cats = _cats(db, envs)
    polos = list(dict.fromkeys(POLO_DO_CASO[cats[e.categoria_id].polo] for e in envs))
    return (polos[0] if polos else None), len(polos) > 1


def sincronizar_polo(db: Session, c: Caso) -> None:
    """No contencioso, `Caso.polo` é o polo das partes que são cliente (quando houver alguma já classificada)."""
    if regras_caso.tipo_caso_de(c) != TipoDeCaso.contencioso:
        return
    db.flush()
    polo, _ = polo_do_cliente(db, c)
    if polo:
        c.polo = polo


def polo_pela_ficha(db: Session, c: Caso, polo: str | None) -> None:
    """A ficha (tela antiga) mudou o polo do caso: as partes que são cliente acompanham."""
    if regras_caso.tipo_caso_de(c) != TipoDeCaso.contencioso or polo not in ("ativo", "passivo", "terceiro"):
        return
    atual, _ = polo_do_cliente(db, c)
    if atual == polo:
        return
    cat = categoria_do_polo(db, c.tenant_id, TipoDeCaso.contencioso, polo)
    for e in _ativos(db, c.id):
        if e.eh_cliente and e.categoria_id != cat.id:
            e.categoria_id, e.qualificacao_id = cat.id, None
            e.principal = e.principal and not _tem_principal(db, c.id, cat.id, exceto=e.id)
        if e.eh_cliente:
            e.pendente_reclassificacao = False
    db.flush()


def trocar_tipo(db: Session, c: Caso) -> int:
    """O caso mudou de tipo: cada parte vai para a categoria do mesmo polo no tipo novo (neutro → Outros), sem
    qualificação e marcada "pendente de reclassificação". Devolve quantas foram remarcadas."""
    tipo = regras_caso.tipo_caso_de(c)
    envs = list(db.scalars(select(Envolvimento).where(Envolvimento.caso_id == c.id)))
    cats = _cats(db, envs)
    n = 0
    for e in envs:
        antiga = cats[e.categoria_id]
        if antiga.tipo_caso == tipo:
            continue
        nova = categoria_do_polo(db, c.tenant_id, tipo, antiga.polo)
        e.categoria_id, e.qualificacao_id, e.pendente_reclassificacao = nova.id, None, True
        n += 1
    db.flush()
    for cat_id in {e.categoria_id for e in envs}:  # um principal por categoria
        principais = [e for e in envs if e.categoria_id == cat_id and e.principal and e.ativo]
        for e in principais[1:]:
            e.principal = False
    return n


# ------------------------------------------------------------------------------------------------ título e resumo
def _nomes(db: Session, envs) -> dict[int, str]:
    ids = {e.pessoa_id for e in envs}
    return dict(db.execute(select(Pessoa.id, Pessoa.nome).where(Pessoa.id.in_(ids))).all()) if ids else {}


def _lados(db: Session, caso_id: int) -> tuple[str | None, str | None]:
    """(lado ativo, lado passivo): o nome da parte principal de cada polo, com "e outros" se houver mais."""
    envs = _ativos(db, caso_id)
    cats, nomes = _cats(db, envs), _nomes(db, envs)
    saida = []
    for polo in ("ativo", "passivo"):
        do_polo = [e for e in envs if cats[e.categoria_id].polo == polo]
        if not do_polo:
            saida.append(None)
            continue
        principal = next((e for e in do_polo if e.principal), do_polo[0])
        saida.append(nomes.get(principal.pessoa_id, "") + (" e outros" if len(do_polo) > 1 else ""))
    return saida[0], saida[1]


def titulo_sugerido(db: Session, c: Caso) -> str | None:
    """Contencioso: "{principal do polo ativo} x {principal do polo passivo}". Só sugestão: o título continua livre."""
    if regras_caso.tipo_caso_de(c) != TipoDeCaso.contencioso:
        return None
    ativo, passivo = _lados(db, c.id)
    return f"{ativo} x {passivo}"[:250] if ativo and passivo else None


def resumo_partes(db: Session, caso_id: int) -> str | None:
    """Coluna "Partes" da lista de casos: "Ativo x Passivo" resumido."""
    ativo, passivo = _lados(db, caso_id)
    return f"{ativo} x {passivo}" if ativo and passivo else (ativo or passivo)


def resumos_do_escritorio(db: Session, tenant_id: int) -> dict[int, str]:
    """{caso → "Ativo x Passivo"} de todos os casos, em poucas consultas (relatórios)."""
    linhas = db.execute(
        select(Envolvimento.caso_id, EnvCategoria.polo, Envolvimento.principal, Pessoa.nome)
        .join(EnvCategoria, EnvCategoria.id == Envolvimento.categoria_id).join(Pessoa, Pessoa.id == Envolvimento.pessoa_id)
        .where(Envolvimento.tenant_id == tenant_id, Envolvimento.ativo, EnvCategoria.polo.in_(("ativo", "passivo")))
        .order_by(Envolvimento.caso_id, Envolvimento.principal.desc(), Envolvimento.ordem, Envolvimento.id)).all()
    lados: dict[int, dict[str, list[str]]] = {}
    for caso_id, polo, _principal, nome in linhas:
        lados.setdefault(caso_id, {}).setdefault(polo, []).append(nome)
    saida = {}
    for caso_id, d in lados.items():
        partes = [d[p][0] + (" e outros" if len(d[p]) > 1 else "") for p in ("ativo", "passivo") if d.get(p)]
        saida[caso_id] = " x ".join(partes)
    return saida


def pendentes(db: Session, caso_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Envolvimento).where(
        Envolvimento.caso_id == caso_id, Envolvimento.ativo, Envolvimento.pendente_reclassificacao)) or 0


# ------------------------------------------------------------------------------------------------ conflito de interesses
def _papel(eh_cliente: bool, polo_categoria: str, polos_dos_clientes: set[str]) -> str | None:
    """cliente | contraria | None (terceiro, auxiliar ou do mesmo lado do cliente)."""
    if eh_cliente:
        return "cliente"
    if polo_categoria in ("ativo", "passivo") and polos_dos_clientes and polo_categoria not in polos_dos_clientes:
        return "contraria"
    return None


def conflitos(db: Session, c: Caso, pessoa_id: int, eh_cliente: bool, categoria: EnvCategoria) -> list[dict]:
    """Outros casos em andamento em que a mesma pessoa está do lado oposto: cliente lá e parte contrária aqui, ou o
    contrário. É um aviso: quem cadastra confirma e segue."""
    aqui = _ativos(db, c.id)
    cats_aqui = _cats(db, aqui)
    polos_aqui = {cats_aqui[e.categoria_id].polo for e in aqui if e.eh_cliente and e.pessoa_id != pessoa_id}
    papel = _papel(eh_cliente, categoria.polo, polos_aqui)
    if papel is None:
        return []
    saida: dict[int, dict] = {}
    outros = db.execute(
        select(Envolvimento, Caso).join(Caso, Caso.id == Envolvimento.caso_id)
        .where(Envolvimento.tenant_id == c.tenant_id, Envolvimento.pessoa_id == pessoa_id, Envolvimento.ativo,
               Envolvimento.caso_id != c.id, Caso.status.in_(EM_ANDAMENTO)).order_by(Caso.numero)).all()
    for e, outro in outros:
        la = _ativos(db, outro.id)
        cats_la = _cats(db, la)
        polos_la = {cats_la[x.categoria_id].polo for x in la if x.eh_cliente and x.pessoa_id != pessoa_id}
        papel_la = _papel(e.eh_cliente, cats_la[e.categoria_id].polo, polos_la)
        if papel_la and papel_la != papel:
            saida[outro.id] = {"caso_id": outro.id, "numero": outro.numero, "titulo": outro.titulo, "papel": papel_la,
                               "papel_nome": "Cliente" if papel_la == "cliente" else "Parte contrária",
                               "categoria": cats_la[e.categoria_id].nome}
    if papel == "contraria":  # é cliente do escritório com caso em andamento ainda sem as partes cadastradas
        from app.modules.rpa_nfse.models import Tomador

        for outro in db.scalars(
                select(Caso).join(Contrato, Contrato.id == Caso.contrato_id).join(Tomador, Tomador.id == Contrato.tomador_id)
                .where(Caso.tenant_id == c.tenant_id, Tomador.pessoa_id == pessoa_id, Caso.id != c.id,
                       Caso.status.in_(EM_ANDAMENTO)).order_by(Caso.numero).limit(50)):
            saida.setdefault(outro.id, {"caso_id": outro.id, "numero": outro.numero, "titulo": outro.titulo, "papel": "cliente",
                                        "papel_nome": "Cliente", "categoria": None})
    return list(saida.values())


# ------------------------------------------------------------------------------------------------ uso por Pessoas
def uso_da_pessoa(db: Session, pessoa_id: int) -> dict[str, int]:
    return {"casos": db.scalar(select(func.count()).select_from(Envolvimento).where(Envolvimento.pessoa_id == pessoa_id)) or 0}


def uso_do_advogado(db: Session, advogado_id: int) -> int:
    return db.scalar(select(func.count()).select_from(EnvolvimentoAdvogado).where(
        EnvolvimentoAdvogado.advogado_id == advogado_id)) or 0


def uso_da_oab(db: Session, oab_id: int) -> int:
    return db.scalar(select(func.count()).select_from(EnvolvimentoAdvogado).where(EnvolvimentoAdvogado.oab_id == oab_id)) or 0


def mover_pessoa(db: Session, de: int, para: int) -> None:
    """Mescla de pessoas: as partes da duplicada passam para a principal (sem repetir o mesmo papel no mesmo caso)."""
    db.flush()
    db.execute(update(Envolvimento).where(Envolvimento.pessoa_id == de).values(pessoa_id=para))
    vistos: dict[tuple, Envolvimento] = {}
    for e in db.scalars(select(Envolvimento).where(Envolvimento.pessoa_id == para, Envolvimento.ativo)
                        .order_by(Envolvimento.id).execution_options(populate_existing=True)):
        chave = (e.caso_id, e.categoria_id, e.qualificacao_id)
        if chave in vistos:
            fica = vistos[chave]
            fica.eh_cliente, fica.principal = fica.eh_cliente or e.eh_cliente, fica.principal or e.principal
            db.execute(update(EnvolvimentoAdvogado).where(EnvolvimentoAdvogado.envolvimento_id == e.id)
                       .values(envolvimento_id=fica.id))
            e.ativo, e.eh_cliente, e.principal, e.data_exclusao = False, False, False, date.today()
        else:
            vistos[chave] = e
    db.flush()


def mover_advogado(db: Session, de: int, para: int) -> None:
    db.execute(update(EnvolvimentoAdvogado).where(EnvolvimentoAdvogado.advogado_id == de).values(advogado_id=para))


def casos_da_pessoa(ctx, p: Pessoa) -> list[dict]:
    """Casos em que a pessoa aparece, com o papel em cada um."""
    from app.modules.rpa_nfse.models import Tomador
    from app.modules.tribunais.models import Parte, Processo

    db = ctx.db
    saida, vistos = [], set()

    def linha(c: Caso, **extra) -> dict:
        tom = c.contrato.tomador if c.contrato else None
        tipo = regras_caso.tipo_caso_de(c)
        return {"caso_id": c.id, "numero": c.numero, "titulo": c.titulo, "tipo_caso": tipo,
                "tipo_caso_nome": ROTULOS["tipo_caso"][tipo], "status": c.status.value,
                "status_nome": ROTULOS["status"][c.status.value], "cliente_id": tom.id if tom else None,
                "cliente_nome": tom.nome if tom else None, "numero_processo": c.numero_processo,
                "categoria": None, "qualificacao": None, "polo": None, "eh_cliente": False, "principal": False, "ativo": True,
                "pendente_reclassificacao": False, "origem": "partes", **extra}

    linhas = db.execute(
        select(Envolvimento, Caso, EnvCategoria, EnvQualificacao).join(Caso, Caso.id == Envolvimento.caso_id)
        .join(EnvCategoria, EnvCategoria.id == Envolvimento.categoria_id)
        .outerjoin(EnvQualificacao, EnvQualificacao.id == Envolvimento.qualificacao_id)
        .where(Envolvimento.tenant_id == ctx.tenant_id, Envolvimento.pessoa_id == p.id)
        .order_by(Caso.numero.desc(), Envolvimento.id)).all()
    for e, c, cat, qual in linhas:
        if not regras_caso.pode_ver(ctx, c):
            continue
        vistos.add(c.id)
        saida.append(linha(c, categoria=cat.nome, qualificacao=qual.nome if qual else None, polo=cat.polo, eh_cliente=e.eh_cliente,
                           principal=e.principal, ativo=e.ativo, pendente_reclassificacao=e.pendente_reclassificacao))
    # cliente em caso ainda sem as partes cadastradas
    for c in db.scalars(select(Caso).join(Contrato, Contrato.id == Caso.contrato_id).join(Tomador, Tomador.id == Contrato.tomador_id)
                        .where(Caso.tenant_id == ctx.tenant_id, Tomador.pessoa_id == p.id).order_by(Caso.numero.desc())):
        if c.id not in vistos and regras_caso.pode_ver(ctx, c):
            vistos.add(c.id)
            saida.append(linha(c, categoria="Cliente", eh_cliente=True, origem="cliente"))
    # parte de processo importado do tribunal, ligado a um caso
    for parte, c in db.execute(select(Parte, Caso).join(Processo, Processo.id == Parte.processo_id)
                               .join(Caso, Caso.id == Processo.caso_id)
                               .where(Caso.tenant_id == ctx.tenant_id, Parte.pessoa_id == p.id)).all():
        if c.id not in vistos and regras_caso.pode_ver(ctx, c):
            vistos.add(c.id)
            saida.append(linha(c, categoria=f"Polo {parte.polo}", qualificacao=parte.tipo_participacao, polo=parte.polo,
                               origem="processo"))
    return saida


# ------------------------------------------------------------------------------------------------ schemas
class QualificacaoIn(BaseModel):
    categoria_id: int
    nome: str = Field(min_length=2, max_length=120)
    ordem: int = 0
    ativo: bool = True


class AdvogadoDaParteIn(BaseModel):
    advogado_id: int
    oab_id: int | None = None  # vazio = a inscrição principal do advogado
    principal: bool = False  # recebe as intimações
    tipo_habilitacao: str | None = None
    data_habilitacao: date | None = None
    data_desabilitacao: date | None = None
    documento_procuracao_id: int | None = None  # anexo do caso
    ativo: bool = True


class EnvolvimentoIn(BaseModel):
    pessoa_id: int
    categoria_id: int
    qualificacao_id: int | None = None
    eh_cliente: bool = False
    principal: bool = False
    representado_por_id: int | None = None  # outra parte deste caso
    data_inclusao: date | None = None
    observacoes: str | None = None
    advogados: list[AdvogadoDaParteIn] = []
    conflito_confirmado: bool = False  # depois do aviso de conflito de interesses


class EnvolvimentoAlterar(BaseModel):
    """Só o que vier no pedido é alterado."""

    qualificacao_id: int | None = None
    eh_cliente: bool | None = None
    principal: bool | None = None
    representado_por_id: int | None = None
    data_inclusao: date | None = None
    data_exclusao: date | None = None
    observacoes: str | None = None
    ativo: bool | None = None  # true reativa uma parte desativada
    conflito_confirmado: bool = False


class MoverIn(BaseModel):
    categoria_id: int
    qualificacao_id: int | None = None
    posicao: int | None = Field(default=None, ge=0)  # posição dentro do bloco (0 = primeiro); vazio = no fim
    conflito_confirmado: bool = False


class ReordenarIn(BaseModel):
    categoria_id: int
    ids: list[int] = Field(min_length=1)


# ------------------------------------------------------------------------------------------------ apoio das rotas
def _caso(ctx, cid: int) -> Caso:
    c = ctx.db.get(Caso, cid)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Caso não encontrado.")
    regras_caso.exigir_ver(ctx, c)
    return c


def _env(ctx, c: Caso, eid: int) -> Envolvimento:
    e = ctx.db.get(Envolvimento, eid)
    if not e or e.caso_id != c.id:
        raise HTTPException(404, "Parte não encontrada neste caso.")
    return e


def _categoria(ctx, c: Caso, categoria_id: int) -> EnvCategoria:
    cat = ctx.db.get(EnvCategoria, categoria_id)
    if not cat or cat.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Categoria não encontrada.")
    tipo = regras_caso.tipo_caso_de(c)
    if cat.tipo_caso != tipo:
        raise HTTPException(400, f"A categoria “{cat.nome}” é de caso {ROTULOS['tipo_caso'][cat.tipo_caso].lower()} e este caso é "
                                 f"{ROTULOS['tipo_caso'][tipo].lower()}.")
    return cat


def _qualificacao(ctx, cat: EnvCategoria, qualificacao_id: int | None) -> EnvQualificacao | None:
    if not qualificacao_id:
        return None
    q = ctx.db.get(EnvQualificacao, qualificacao_id)
    if not q or q.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Qualificação não encontrada.")
    if q.categoria_id != cat.id:
        raise HTTPException(400, f"A qualificação “{q.nome}” não é da categoria “{cat.nome}”.")
    return q


def _sem_repetir(ctx, c: Caso, pessoa_id: int, categoria_id: int, qualificacao_id: int | None, exceto: int | None = None) -> None:
    sel = select(Envolvimento.id).where(
        Envolvimento.caso_id == c.id, Envolvimento.pessoa_id == pessoa_id, Envolvimento.categoria_id == categoria_id,
        Envolvimento.ativo, (Envolvimento.qualificacao_id == qualificacao_id) if qualificacao_id
        else Envolvimento.qualificacao_id.is_(None))
    if exceto:
        sel = sel.where(Envolvimento.id != exceto)
    if ctx.db.scalar(sel.limit(1)):
        raise HTTPException(409, "Esta pessoa já está neste caso com o mesmo papel.")


def _um_principal(ctx, c: Caso, cat: EnvCategoria, exceto: int | None = None) -> None:
    outro = _tem_principal(ctx.db, c.id, cat.id, exceto=exceto)
    if outro:
        nome = ctx.db.scalar(select(Pessoa.nome).where(Pessoa.id == outro.pessoa_id))
        raise HTTPException(400, f"“{cat.nome}” já tem uma parte principal ({nome}). Tire a marca dela antes de marcar outra.")


def _nao_tirar_ultimo_cliente(ctx, c: Caso, e: Envolvimento) -> None:
    outros = ctx.db.scalar(select(func.count()).select_from(Envolvimento).where(
        Envolvimento.caso_id == c.id, Envolvimento.eh_cliente, Envolvimento.ativo, Envolvimento.id != e.id)) or 0
    if not outros:
        raise HTTPException(400, "O caso precisa ter pelo menos um cliente entre as partes: marque outra parte como cliente antes.")


def _conferir_conflito(ctx, c: Caso, pessoa_id: int, eh_cliente: bool, cat: EnvCategoria, confirmado: bool):
    """Sem confirmação, devolve a resposta 409 com os casos; confirmado, registra na auditoria quem confirmou."""
    achados = conflitos(ctx.db, c, pessoa_id, eh_cliente, cat)
    if not achados:
        return None
    nome = ctx.db.scalar(select(Pessoa.nome).where(Pessoa.id == pessoa_id))
    if not confirmado:
        return JSONResponse(status_code=409, content={
            "detail": f"Possível conflito de interesses: {nome} aparece do lado oposto em {len(achados)} caso(s) em andamento. "
                      "Confira e confirme para continuar.", "conflito": True, "conflitos": achados})
    ctx.auditar("faturamento.envolvimento.conflito_confirmado", "fat_caso", c.id,
                descricao=f"#{c.numero}: conflito de interesses confirmado para {nome} (casos "
                          + ", ".join(f"#{x['numero']}" for x in achados) + ")",
                depois={"pessoa_id": pessoa_id, "casos": [x["caso_id"] for x in achados]})
    return None


def _advogado_da_parte(ctx, c: Caso, e: Envolvimento, dados: AdvogadoDaParteIn, atual: EnvolvimentoAdvogado | None = None):
    db = ctx.db
    adv = db.get(Advogado, dados.advogado_id)
    if not adv or adv.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Advogado não encontrado no cadastro de pessoas.")
    oab = db.get(AdvogadoOab, dados.oab_id) if dados.oab_id else next(iter(adv.oabs), None)
    if dados.oab_id and (not oab or oab.advogado_id != adv.id):
        raise HTTPException(400, "A inscrição na OAB não é deste advogado.")
    if dados.tipo_habilitacao and dados.tipo_habilitacao not in HABILITACAO:
        raise HTTPException(400, f"Tipo de habilitação inválido: use {', '.join(HABILITACAO)}.")
    if dados.data_habilitacao and dados.data_desabilitacao and dados.data_desabilitacao < dados.data_habilitacao:
        raise HTTPException(400, "A desabilitação não pode ser antes da habilitação.")
    if dados.documento_procuracao_id:
        anexo = db.get(AnexoCaso, dados.documento_procuracao_id)
        if not anexo or anexo.caso_id != c.id:
            raise HTTPException(400, "Procuração: escolha um anexo deste caso.")
    repetido = db.scalar(select(EnvolvimentoAdvogado.id).where(
        EnvolvimentoAdvogado.envolvimento_id == e.id, EnvolvimentoAdvogado.advogado_id == adv.id,
        EnvolvimentoAdvogado.id != (atual.id if atual else 0)).limit(1))
    if repetido:
        raise HTTPException(409, "Este advogado já está nesta parte.")
    ea = atual or EnvolvimentoAdvogado(envolvimento_id=e.id)
    ea.advogado_id, ea.oab_id = adv.id, oab.id if oab else None
    ea.tipo_habilitacao, ea.data_habilitacao, ea.data_desabilitacao = dados.tipo_habilitacao, dados.data_habilitacao, dados.data_desabilitacao
    ea.documento_procuracao_id, ea.ativo = dados.documento_procuracao_id, dados.ativo
    ea.principal = dados.principal
    if atual is None:
        db.add(ea)
    db.flush()
    if ea.principal:  # só um advogado recebe as intimações da parte
        db.execute(update(EnvolvimentoAdvogado).where(EnvolvimentoAdvogado.envolvimento_id == e.id,
                                                      EnvolvimentoAdvogado.id != ea.id).values(principal=False))
    return ea


def _advogados_out(ctx, env_ids: list[int]) -> dict[int, list[dict]]:
    if not env_ids:
        return {}
    linhas = ctx.db.execute(
        select(EnvolvimentoAdvogado, Advogado, Pessoa, AdvogadoOab).join(Advogado, Advogado.id == EnvolvimentoAdvogado.advogado_id)
        .join(Pessoa, Pessoa.id == Advogado.pessoa_id).outerjoin(AdvogadoOab, AdvogadoOab.id == EnvolvimentoAdvogado.oab_id)
        .where(EnvolvimentoAdvogado.envolvimento_id.in_(env_ids))
        .order_by(EnvolvimentoAdvogado.principal.desc(), EnvolvimentoAdvogado.id)).all()
    saida: dict[int, list[dict]] = {}
    for ea, adv, p, oab in linhas:
        saida.setdefault(ea.envolvimento_id, []).append({
            "id": ea.id, "advogado_id": adv.id, "pessoa_id": p.id, "nome": p.nome, "eh_interno": adv.eh_interno,
            "oab_id": oab.id if oab else None, "oab": pessoas.exibir_oab(oab.numero, oab.uf) if oab else None,
            "principal": ea.principal, "tipo_habilitacao": ea.tipo_habilitacao,
            "tipo_habilitacao_nome": HABILITACAO.get(ea.tipo_habilitacao or ""), "data_habilitacao": ea.data_habilitacao,
            "data_desabilitacao": ea.data_desabilitacao, "documento_procuracao_id": ea.documento_procuracao_id, "ativo": ea.ativo})
    return saida


def envolvimentos_out(ctx, c: Caso, envs: list[Envolvimento]) -> list[dict]:
    from app.modules.pessoas.routes import resumos

    db = ctx.db
    cats = _cats(db, envs)
    quals = {q.id: q for q in db.scalars(select(EnvQualificacao).where(
        EnvQualificacao.id.in_({e.qualificacao_id for e in envs if e.qualificacao_id})))} if envs else {}
    gente = {p.id: p for p in db.scalars(select(Pessoa).where(Pessoa.id.in_({e.pessoa_id for e in envs})))} if envs else {}
    resumo = {r.id: r.model_dump() for r in resumos(ctx, list(gente.values()))}
    advs = _advogados_out(ctx, [e.id for e in envs])
    por_id = {e.id: e for e in envs}
    saida = []
    for e in envs:
        cat, rep = cats[e.categoria_id], por_id.get(e.representado_por_id or 0)
        saida.append({
            "id": e.id, "caso_id": e.caso_id, "pessoa_id": e.pessoa_id, "pessoa": resumo[e.pessoa_id],
            "categoria_id": cat.id, "categoria_nome": cat.nome, "polo": cat.polo, "qualificacao_id": e.qualificacao_id,
            "qualificacao_nome": quals[e.qualificacao_id].nome if e.qualificacao_id in quals else None,
            "eh_cliente": e.eh_cliente, "principal": e.principal, "ordem": e.ordem,
            "representado_por_id": e.representado_por_id,
            "representado_por_nome": gente[rep.pessoa_id].nome if rep and rep.pessoa_id in gente else None,
            "data_inclusao": e.data_inclusao, "data_exclusao": e.data_exclusao, "ativo": e.ativo,
            "pendente_reclassificacao": e.pendente_reclassificacao, "observacoes": e.observacoes,
            "advogados": advs.get(e.id, []),
            "conflitos": conflitos(db, c, e.pessoa_id, e.eh_cliente, cat) if e.ativo and c.status in EM_ANDAMENTO else []})
    return saida


def _um(ctx, c: Caso, e: Envolvimento) -> dict:
    return envolvimentos_out(ctx, c, [e] + ([ctx.db.get(Envolvimento, e.representado_por_id)] if e.representado_por_id else []))[0]


def _categorias_out(ctx, tipo_caso: str | None, so_ativas: bool = False) -> list[dict]:
    cats = [c for c in categorias(ctx.db, ctx.tenant_id, tipo_caso) if c.ativo or not so_ativas]
    quals: dict[int, list[EnvQualificacao]] = {}
    for q in ctx.db.scalars(select(EnvQualificacao).where(EnvQualificacao.tenant_id == ctx.tenant_id)
                            .order_by(EnvQualificacao.ordem, EnvQualificacao.nome)):
        quals.setdefault(q.categoria_id, []).append(q)
    return [{"id": c.id, "tipo_caso": c.tipo_caso, "codigo": c.codigo, "nome": c.nome, "polo": c.polo,
             "polo_nome": ROTULO_POLO[c.polo], "ordem": c.ordem, "ativo": c.ativo, "sistema": c.sistema,
             "qualificacoes": [{"id": q.id, "nome": q.nome, "ordem": q.ordem, "ativo": q.ativo, "sistema": q.sistema}
                               for q in quals.get(c.id, []) if q.ativo or not so_ativas]} for c in cats]


# ------------------------------------------------------------------------------------------------ rotas: configuração
@router.get("/envolvimento/categorias")
def listar_categorias(ctx: Ctx, tipo_caso: str | None = None):
    """Categorias de partes de cada tipo de caso (com o polo) e as qualificações de cada uma."""
    if tipo_caso and tipo_caso not in ROTULOS["tipo_caso"]:
        raise HTTPException(400, "Tipo de caso inválido.")
    saida = _categorias_out(ctx, tipo_caso)
    ctx.db.commit()  # o seed pode ter entrado agora
    return saida


@router.get("/envolvimento/opcoes")
def opcoes(ctx: Ctx):
    return {"tipo_habilitacao": [{"valor": v, "rotulo": r} for v, r in HABILITACAO.items()],
            "polo": [{"valor": v, "rotulo": r} for v, r in ROTULO_POLO.items()]}


def _qual(ctx, qid: int) -> EnvQualificacao:
    q = ctx.db.get(EnvQualificacao, qid)
    if not q or q.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Qualificação não encontrada.")
    return q


def _qual_repetida(ctx, categoria_id: int, nome: str, exceto: int | None = None) -> bool:
    return any(slug(n) == slug(nome) for i, n in ctx.db.execute(select(EnvQualificacao.id, EnvQualificacao.nome).where(
        EnvQualificacao.categoria_id == categoria_id)).all() if i != exceto)


@router.post("/envolvimento/qualificacoes", status_code=201)
def criar_qualificacao(dados: QualificacaoIn, ctx: Admin):
    """Qualificação própria do escritório dentro de uma categoria."""
    garantir_seeds(ctx.db, ctx.tenant_id)
    cat = ctx.db.get(EnvCategoria, dados.categoria_id)
    if not cat or cat.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Categoria não encontrada.")
    if _qual_repetida(ctx, cat.id, dados.nome):
        raise HTTPException(409, "Esta qualificação já existe na categoria.")
    ordem = dados.ordem or (ctx.db.scalar(select(func.max(EnvQualificacao.ordem)).where(EnvQualificacao.categoria_id == cat.id)) or 0) + 1
    q = EnvQualificacao(tenant_id=ctx.tenant_id, categoria_id=cat.id, nome=dados.nome.strip(), ordem=ordem, ativo=dados.ativo)
    ctx.db.add(q)
    ctx.db.flush()
    ctx.auditar("faturamento.qualificacao.criar", "fat_env_qualificacao", q.id, descricao=f"{cat.nome}: {q.nome}")
    ctx.db.commit()
    return {"id": q.id, "categoria_id": cat.id, "nome": q.nome, "ordem": q.ordem, "ativo": q.ativo, "sistema": q.sistema}


@router.put("/envolvimento/qualificacoes/{qid}")
def alterar_qualificacao(qid: int, dados: QualificacaoIn, ctx: Admin):
    q = _qual(ctx, qid)
    if dados.categoria_id != q.categoria_id:
        raise HTTPException(400, "A qualificação não muda de categoria.")
    if _qual_repetida(ctx, q.categoria_id, dados.nome, exceto=q.id):
        raise HTTPException(409, "Esta qualificação já existe na categoria.")
    q.nome, q.ordem, q.ativo = dados.nome.strip(), dados.ordem, dados.ativo
    ctx.auditar("faturamento.qualificacao.alterar", "fat_env_qualificacao", q.id, descricao=q.nome)
    ctx.db.commit()
    return {"id": q.id, "categoria_id": q.categoria_id, "nome": q.nome, "ordem": q.ordem, "ativo": q.ativo, "sistema": q.sistema}


@router.delete("/envolvimento/qualificacoes/{qid}", response_model=Mensagem)
def excluir_qualificacao(qid: int, ctx: Admin):
    q = _qual(ctx, qid)
    usada = ctx.db.scalar(select(func.count()).select_from(Envolvimento).where(Envolvimento.qualificacao_id == q.id))
    if q.sistema or usada:
        q.ativo = False
        ctx.auditar("faturamento.qualificacao.desativar", "fat_env_qualificacao", q.id, descricao=q.nome)
        ctx.db.commit()
        return Mensagem(mensagem="Qualificação padrão do sistema: foi desativada." if q.sistema
                        else "Qualificação usada em casos: foi desativada.")
    ctx.auditar("faturamento.qualificacao.excluir", "fat_env_qualificacao", q.id, descricao=q.nome)
    ctx.db.delete(q)
    ctx.db.commit()
    return Mensagem(mensagem="Qualificação excluída.")


# ------------------------------------------------------------------------------------------------ rotas: partes do caso
@router.get("/casos/{cid}/envolvimentos")
def listar(cid: int, ctx: Ctx, inativos: bool = False):
    """Partes do caso agrupadas pelas categorias do tipo do caso (no contencioso: Polo Ativo, Polo Passivo, Terceiros e
    Outros), com os advogados de cada uma, o título sugerido e os avisos."""
    c = _caso(ctx, cid)
    tipo = regras_caso.tipo_caso_de(c)
    cats = _categorias_out(ctx, tipo, so_ativas=True)
    sel = select(Envolvimento).where(Envolvimento.caso_id == c.id)
    if not inativos:
        sel = sel.where(Envolvimento.ativo)
    envs = envolvimentos_out(ctx, c, list(ctx.db.scalars(sel.order_by(Envolvimento.ordem, Envolvimento.id))))
    for cat in cats:
        cat["envolvimentos"] = [e for e in envs if e["categoria_id"] == cat["id"]]
    polo, inconsistente = polo_do_cliente(ctx.db, c)
    ctx.db.commit()  # o seed pode ter entrado agora
    return {"caso_id": c.id, "tipo_caso": tipo, "categorias": cats, "titulo_sugerido": titulo_sugerido(ctx.db, c),
            "partes_resumo": resumo_partes(ctx.db, c.id), "pendentes_reclassificacao": sum(e["pendente_reclassificacao"] for e in envs if e["ativo"]),
            "polo_cliente": polo if tipo == TipoDeCaso.contencioso else None,
            "polo_inconsistente": inconsistente if tipo == TipoDeCaso.contencioso else False,
            "tem_cliente": any(e["eh_cliente"] and e["ativo"] for e in envs)}


@router.get("/casos/{cid}/envolvimentos/conflito")
def conferir_conflito(cid: int, pessoa_id: int, categoria_id: int, ctx: Ctx, eh_cliente: bool = False):
    """Antes de incluir a parte: a mesma pessoa está do lado oposto em outro caso em andamento?"""
    c = _caso(ctx, cid)
    cat = _categoria(ctx, c, categoria_id)
    achados = conflitos(ctx.db, c, pessoa_id, eh_cliente, cat)
    return {"conflito": bool(achados), "conflitos": achados}


@router.get("/casos/{cid}/titulo-sugerido")
def sugerir_titulo(cid: int, ctx: Ctx):
    """Contencioso: "{principal do polo ativo} x {principal do polo passivo}" (com "e outros"). Só sugestão."""
    c = _caso(ctx, cid)
    return {"titulo": titulo_sugerido(ctx.db, c), "titulo_atual": c.titulo}


@router.post("/casos/{cid}/envolvimentos", status_code=201)
def criar(cid: int, dados: EnvolvimentoIn, ctx: Operador):
    """Inclui uma pessoa do cadastro único no caso. Com possível conflito de interesses, responde 409 com os casos
    (`conflitos`); repita com `conflito_confirmado: true` para incluir mesmo assim (fica na auditoria)."""
    c = _caso(ctx, cid)
    db = ctx.db
    garantir_seeds(db, ctx.tenant_id)
    p = db.get(Pessoa, dados.pessoa_id)
    if not p or p.tenant_id != ctx.tenant_id:
        raise HTTPException(400, "Pessoa não encontrada no cadastro.")
    if p.mesclada_em_id or not p.ativo:
        raise HTTPException(400, "Esta pessoa está desativada no cadastro: reative ou escolha outra.")
    cat = _categoria(ctx, c, dados.categoria_id)
    if not cat.ativo:
        raise HTTPException(400, "Esta categoria está desativada.")
    qual = _qualificacao(ctx, cat, dados.qualificacao_id)
    _sem_repetir(ctx, c, p.id, cat.id, qual.id if qual else None)
    if dados.principal:
        _um_principal(ctx, c, cat)
    if dados.representado_por_id:
        _env(ctx, c, dados.representado_por_id)
    if (aviso := _conferir_conflito(ctx, c, p.id, dados.eh_cliente, cat, dados.conflito_confirmado)) is not None:
        return aviso
    ordem = (db.scalar(select(func.max(Envolvimento.ordem)).where(Envolvimento.caso_id == c.id, Envolvimento.categoria_id == cat.id)) or 0) + 1
    e = Envolvimento(tenant_id=ctx.tenant_id, caso_id=c.id, pessoa_id=p.id, categoria_id=cat.id, qualificacao_id=qual.id if qual else None,
                     eh_cliente=dados.eh_cliente, principal=dados.principal, ordem=ordem, representado_por_id=dados.representado_por_id,
                     data_inclusao=dados.data_inclusao or date.today(), observacoes=dados.observacoes)
    db.add(e)
    db.flush()
    for adv in dados.advogados:
        _advogado_da_parte(ctx, c, e, adv)
    sincronizar_polo(db, c)
    ctx.auditar("faturamento.envolvimento.criar", "fat_caso", c.id, descricao=f"#{c.numero}: {p.nome} em {cat.nome}"
                + (f" ({qual.nome})" if qual else "") + (" · cliente" if e.eh_cliente else ""))
    db.commit()
    return _um(ctx, c, e)


@router.put("/casos/{cid}/envolvimentos/{eid}")
def alterar(cid: int, eid: int, dados: EnvolvimentoAlterar, ctx: Operador):
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    db, enviados = ctx.db, dados.model_fields_set
    cat = db.get(EnvCategoria, e.categoria_id)
    if "ativo" in enviados and dados.ativo is False:
        raise HTTPException(400, "Para tirar a parte do caso, use a exclusão (ela fica no histórico).")
    if "ativo" in enviados and dados.ativo and not e.ativo:
        _sem_repetir(ctx, c, e.pessoa_id, e.categoria_id, e.qualificacao_id, exceto=e.id)
        e.ativo, e.data_exclusao = True, None
    if "qualificacao_id" in enviados:
        qual = _qualificacao(ctx, cat, dados.qualificacao_id)
        _sem_repetir(ctx, c, e.pessoa_id, cat.id, qual.id if qual else None, exceto=e.id)
        e.qualificacao_id, e.pendente_reclassificacao = (qual.id if qual else None), False
    if "eh_cliente" in enviados and dados.eh_cliente is not None and dados.eh_cliente != e.eh_cliente:
        if not dados.eh_cliente:
            _nao_tirar_ultimo_cliente(ctx, c, e)
        if (aviso := _conferir_conflito(ctx, c, e.pessoa_id, dados.eh_cliente, cat, dados.conflito_confirmado)) is not None:
            return aviso
        e.eh_cliente = dados.eh_cliente
    if "principal" in enviados and dados.principal is not None:
        if dados.principal and not e.principal:
            _um_principal(ctx, c, cat, exceto=e.id)
        e.principal = dados.principal
    if "representado_por_id" in enviados:
        if dados.representado_por_id:
            if dados.representado_por_id == e.id:
                raise HTTPException(400, "A parte não pode ser representada por ela mesma.")
            _env(ctx, c, dados.representado_por_id)
        e.representado_por_id = dados.representado_por_id
    for campo in ("data_inclusao", "data_exclusao", "observacoes"):
        if campo in enviados:
            setattr(e, campo, getattr(dados, campo))
    db.flush()
    sincronizar_polo(db, c)
    nome = db.scalar(select(Pessoa.nome).where(Pessoa.id == e.pessoa_id))
    ctx.auditar("faturamento.envolvimento.alterar", "fat_caso", c.id, descricao=f"#{c.numero}: {nome} ({cat.nome})")
    db.commit()
    return _um(ctx, c, e)


@router.post("/casos/{cid}/envolvimentos/{eid}/mover")
def mover(cid: int, eid: int, dados: MoverIn, ctx: Operador):
    """Muda a parte de categoria (arrastar de um bloco para outro). A qualificação antiga não vale na nova categoria."""
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    db = ctx.db
    cat = _categoria(ctx, c, dados.categoria_id)
    qual = _qualificacao(ctx, cat, dados.qualificacao_id)
    mudou = cat.id != e.categoria_id
    _sem_repetir(ctx, c, e.pessoa_id, cat.id, qual.id if qual else None, exceto=e.id)
    if mudou:
        if (aviso := _conferir_conflito(ctx, c, e.pessoa_id, e.eh_cliente, cat, dados.conflito_confirmado)) is not None:
            return aviso
        if e.principal and _tem_principal(db, c.id, cat.id, exceto=e.id):
            e.principal = False
    antiga = db.get(EnvCategoria, e.categoria_id)
    e.categoria_id, e.qualificacao_id, e.pendente_reclassificacao = cat.id, (qual.id if qual else None), False
    irmaos = [x for x in _ativos(db, c.id) if x.categoria_id == cat.id and x.id != e.id]
    posicao = len(irmaos) if dados.posicao is None else min(dados.posicao, len(irmaos))
    for n, x in enumerate(irmaos[:posicao] + [e] + irmaos[posicao:], start=1):
        x.ordem = n
    db.flush()
    sincronizar_polo(db, c)
    nome = db.scalar(select(Pessoa.nome).where(Pessoa.id == e.pessoa_id))
    ctx.auditar("faturamento.envolvimento.mover", "fat_caso", c.id, descricao=f"#{c.numero}: {nome} de {antiga.nome} para {cat.nome}")
    db.commit()
    return _um(ctx, c, e)


@router.post("/casos/{cid}/envolvimentos/reordenar", response_model=Mensagem)
def reordenar(cid: int, dados: ReordenarIn, ctx: Operador):
    """Ordem das partes dentro de um bloco: mande os ids na ordem desejada."""
    c = _caso(ctx, cid)
    cat = _categoria(ctx, c, dados.categoria_id)
    do_bloco = {x.id: x for x in _ativos(ctx.db, c.id) if x.categoria_id == cat.id}
    if len(set(dados.ids)) != len(dados.ids) or not set(dados.ids) <= set(do_bloco):
        raise HTTPException(400, "A lista tem parte que não é deste bloco.")
    resto = [i for i in do_bloco if i not in dados.ids]
    for n, i in enumerate([*dados.ids, *resto], start=1):
        do_bloco[i].ordem = n
    ctx.db.commit()
    return Mensagem(mensagem="Ordem salva.")


@router.delete("/casos/{cid}/envolvimentos/{eid}", response_model=Mensagem)
def desativar(cid: int, eid: int, ctx: Operador):
    """Tira a parte do caso. Ela não é apagada: fica desativada, com a data, no histórico do caso."""
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    if not e.ativo:
        return Mensagem(mensagem="Esta parte já estava fora do caso.")
    if e.eh_cliente:
        _nao_tirar_ultimo_cliente(ctx, c, e)
    e.ativo, e.principal, e.data_exclusao = False, False, e.data_exclusao or date.today()
    ctx.db.flush()
    sincronizar_polo(ctx.db, c)
    nome = ctx.db.scalar(select(Pessoa.nome).where(Pessoa.id == e.pessoa_id))
    ctx.auditar("faturamento.envolvimento.desativar", "fat_caso", c.id, descricao=f"#{c.numero}: {nome}")
    ctx.db.commit()
    return Mensagem(mensagem="Parte retirada do caso (fica no histórico).")


# ------------------------------------------------------------------------------------------------ rotas: advogados da parte
def _adv_da_parte(ctx, e: Envolvimento, aid: int) -> EnvolvimentoAdvogado:
    ea = ctx.db.get(EnvolvimentoAdvogado, aid)
    if not ea or ea.envolvimento_id != e.id:
        raise HTTPException(404, "Advogado não encontrado nesta parte.")
    return ea


@router.get("/casos/{cid}/envolvimentos/{eid}/advogados")
def advogados_da_parte(cid: int, eid: int, ctx: Ctx):
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    return _advogados_out(ctx, [e.id]).get(e.id, [])


@router.post("/casos/{cid}/envolvimentos/{eid}/advogados", status_code=201)
def incluir_advogado(cid: int, eid: int, dados: AdvogadoDaParteIn, ctx: Operador):
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    ea = _advogado_da_parte(ctx, c, e, dados)
    ctx.auditar("faturamento.envolvimento.advogado", "fat_caso", c.id, descricao=f"#{c.numero}: advogado incluído na parte")
    ctx.db.commit()
    return next(a for a in _advogados_out(ctx, [e.id])[e.id] if a["id"] == ea.id)


@router.put("/casos/{cid}/envolvimentos/{eid}/advogados/{aid}")
def alterar_advogado(cid: int, eid: int, aid: int, dados: AdvogadoDaParteIn, ctx: Operador):
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    ea = _advogado_da_parte(ctx, c, e, dados, atual=_adv_da_parte(ctx, e, aid))
    ctx.db.commit()
    return next(a for a in _advogados_out(ctx, [e.id])[e.id] if a["id"] == ea.id)


@router.delete("/casos/{cid}/envolvimentos/{eid}/advogados/{aid}", response_model=Mensagem)
def retirar_advogado(cid: int, eid: int, aid: int, ctx: Operador):
    c = _caso(ctx, cid)
    e = _env(ctx, c, eid)
    ea = _adv_da_parte(ctx, e, aid)
    ctx.auditar("faturamento.envolvimento.advogado_retirar", "fat_caso", c.id, descricao=f"#{c.numero}: advogado retirado da parte")
    ctx.db.delete(ea)
    ctx.db.commit()
    return Mensagem(mensagem="Advogado retirado da parte.")
