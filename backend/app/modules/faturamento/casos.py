"""Regras do caso por tipo (contencioso, consultivo, administrativo): o ponto único que decide o tipo, calcula a
coluna antiga `tipo`, grava os campos comuns novos e monta a parte nova da ficha.

Chamadas antigas continuam valendo: quem manda só o `tipo` antigo (telas atuais, assistente, conector do Claude) tem o
`tipo_caso` deduzido dele; sem nenhum dos dois, caso com número de processo é contencioso e o resto é consultivo.
"""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.faturamento import listas
from app.modules.faturamento.models import Caso, StatusCaso, TipoCaso
from app.modules.faturamento.tipos_caso import ROTULOS, CasoEquipe, CasoLista, TipoDeCaso
from app.modules.tribunais import cnj

# campos de CasoIn que não são coluna direta do caso (tratados em `aplicar`)
CAMPOS_NOVOS = {"tipo", "tipo_caso", "equipe_ids", "etiqueta_ids", "motivo_encerramento_id", "origem_id", "centro_custo_id",
                "valor_estimado", "caso_pai_id", "tipo_vinculo", "sigiloso", "observacoes"}
_DIRETOS = ("valor_estimado", "tipo_vinculo", "observacoes")

JUSTICA_DO_TIPO = {TipoCaso.judicial_estadual: "estadual", TipoCaso.judicial_federal: "federal",
                   TipoCaso.judicial_trabalhista: "trabalho"}
TIPO_DA_JUSTICA = {"estadual": TipoCaso.judicial_estadual, "federal": TipoCaso.judicial_federal,
                   "trabalho": TipoCaso.judicial_trabalhista, "tst": TipoCaso.judicial_trabalhista}
# dígito J do número CNJ → justiça
JUSTICA_DO_J = {1: "stf", 2: "cnj", 3: "stj", 4: "federal", 5: "trabalho", 6: "eleitoral", 7: "militar_uniao", 8: "estadual",
                9: "militar_estadual"}


def classificar(tipo_antigo, numero_processo: str | None) -> str:
    """Tipo de caso de quem não informou: pelo tipo antigo; sem ele, com número de processo é contencioso."""
    if tipo_antigo:
        t = TipoCaso(tipo_antigo)
        if t in (TipoCaso.consultivo, TipoCaso.administrativo):
            return t.value
        return TipoDeCaso.contencioso.value
    return (TipoDeCaso.contencioso if (numero_processo or "").strip() else TipoDeCaso.consultivo).value


def tipo_caso_de(c: Caso) -> str:
    """O tipo do caso; em caso antigo ainda não classificado, o que a classificação daria."""
    return c.tipo_caso or classificar(c.tipo, c.numero_processo)


def justica_do_numero(numero: str | None) -> str | None:
    if not cnj.valido(numero):
        return None
    p = cnj.partes(numero)
    if p["j"] == 5 and p["tr"] == "00":
        return "tst"
    if p["j"] == 6 and p["tr"] == "00":
        return "tse"
    if p["j"] == 7 and p["tr"] == "00":
        return "stm"
    return JUSTICA_DO_J.get(p["j"])


def derivar_tipo(tipo_caso: str, justica: str | None, atual: TipoCaso | None = None) -> TipoCaso | None:
    """A coluna antiga `tipo`, calculada num ponto só: consultivo, administrativo ou judicial pela justiça."""
    if tipo_caso == TipoDeCaso.consultivo:
        return TipoCaso.consultivo
    if tipo_caso == TipoDeCaso.administrativo:
        return TipoCaso.administrativo
    if justica:
        return TIPO_DA_JUSTICA.get(justica)
    return atual if atual in JUSTICA_DO_TIPO else None  # contencioso sem justiça conhecida: mantém o que já havia


def pode_ver(ctx, c: Caso) -> bool:
    """Caso sigiloso: só o responsável, a equipe e o administrador."""
    if not c.sigiloso or ctx.usuario.administrador or c.responsavel_id == ctx.usuario.id:
        return True
    return any(e.usuario_id == ctx.usuario.id for e in c.equipe)


def exigir_ver(ctx, c: Caso) -> None:
    if not pode_ver(ctx, c):
        raise HTTPException(403, "Caso sigiloso: só a equipe do caso pode abrir.")


def _resolver_tipo(ctx, c: Caso, dados, novo: bool) -> tuple[str, str | None]:
    """(tipo de caso, justiça que o pedido informou pelo tipo antigo)."""
    dica = JUSTICA_DO_TIPO.get(dados.tipo) if dados.tipo else None
    if dados.tipo_caso:
        tipo = dados.tipo_caso.value
    elif dados.tipo:
        tipo = classificar(dados.tipo, None)
    elif novo:
        tipo = classificar(None, c.numero_processo)
    else:
        tipo = tipo_caso_de(c)
    if not novo and c.tipo_caso and tipo != c.tipo_caso:
        if not ctx.usuario.administrador:
            raise HTTPException(403, "Só o administrador pode trocar o tipo do caso.")
        ctx.auditar("faturamento.caso.trocar_tipo", "fat_caso", c.id,
                    descricao=f"#{c.numero}: {ROTULOS['tipo_caso'][c.tipo_caso]} → {ROTULOS['tipo_caso'][tipo]}",
                    antes={"tipo_caso": c.tipo_caso}, depois={"tipo_caso": tipo})
    return tipo, dica if tipo == TipoDeCaso.contencioso else None


def _aplicar_comuns(ctx, c: Caso, dados) -> None:
    """Campos comuns novos: só mexe no que o pedido mandou (telas antigas não mandam e não apagam nada)."""
    db, t, enviados = ctx.db, ctx.tenant_id, dados.model_fields_set
    for campo in _DIRETOS:
        if campo in enviados:
            setattr(c, campo, getattr(dados, campo))
    if "sigiloso" in enviados:
        c.sigiloso = bool(dados.sigiloso)
    for campo, lista, rotulo in (("motivo_encerramento_id", "motivo_encerramento", "Motivo de encerramento"),
                                 ("origem_id", "origem", "Origem da captação"), ("centro_custo_id", "centro_custo", "Centro de custo")):
        if campo in enviados:
            listas.item_da_lista(db, t, getattr(dados, campo), lista, rotulo)
            setattr(c, campo, getattr(dados, campo))
    if "caso_pai_id" in enviados:
        if dados.caso_pai_id:
            pai = db.get(Caso, dados.caso_pai_id)
            if not pai or pai.tenant_id != t:
                raise HTTPException(400, "Caso vinculado não encontrado.")
            if c.id and pai.id == c.id:
                raise HTTPException(400, "O caso não pode ser vinculado a ele mesmo.")
        c.caso_pai_id = dados.caso_pai_id
        if not dados.caso_pai_id:
            c.tipo_vinculo = None
    if "equipe_ids" in enviados and dados.equipe_ids is not None:
        ids = list(dict.fromkeys(i for i in dados.equipe_ids if i != c.responsavel_id))
        validos = set(db.scalars(select(Usuario.id).where(Usuario.tenant_id == t, Usuario.id.in_(ids)))) if ids else set()
        if len(validos) != len(ids):
            raise HTTPException(400, "Profissional da equipe não encontrado.")
        atuais = {e.usuario_id: e for e in c.equipe}
        c.equipe = [atuais.get(i) or CasoEquipe(usuario_id=i) for i in ids]
    if "etiqueta_ids" in enviados and dados.etiqueta_ids is not None:
        definir_itens(db, t, c, "etiqueta", "etiqueta", dados.etiqueta_ids, "Etiqueta")


def definir_itens(db: Session, tenant_id: int, c: Caso, papel: str, lista: str, ids: list[int], rotulo: str) -> None:
    ids = list(dict.fromkeys(ids))
    for i in ids:
        listas.item_da_lista(db, tenant_id, i, lista, rotulo)
    atuais = {x.item_id: x for x in c.itens_lista if x.papel == papel}
    c.itens_lista = [x for x in c.itens_lista if x.papel != papel] + [atuais.get(i) or CasoLista(item_id=i, papel=papel) for i in ids]


def _validar_situacao(c: Caso) -> None:
    if c.status == StatusCaso.encerrado and not c.data_encerramento:
        raise HTTPException(400, "Informe a data de encerramento do caso.")
    if c.data_encerramento and c.data_abertura and c.data_encerramento < c.data_abertura:
        raise HTTPException(400, "A data de encerramento não pode ser antes da abertura.")


def aplicar(ctx, c: Caso, dados, novo: bool) -> None:
    """Depois de gravar os campos de sempre: tipo do caso, campos comuns novos e a coluna antiga `tipo`."""
    tipo, dica = _resolver_tipo(ctx, c, dados, novo)
    c.tipo_caso = tipo
    _aplicar_comuns(ctx, c, dados)
    _validar_situacao(c)
    c.tipo = derivar_tipo(tipo, justica_do_numero(c.numero_processo) or dica, c.tipo)


def ao_criar(db: Session, c: Caso) -> None:
    """Caso criado fora da rota (importações, tribunais): classifica pelo que já tem."""
    if not c.tipo_caso:
        c.tipo_caso = classificar(c.tipo, c.numero_processo)
    c.tipo = derivar_tipo(c.tipo_caso, justica_do_numero(c.numero_processo), c.tipo)


def saida(ctx, c: Caso) -> dict:
    """Parte nova de CasoOut."""
    db = ctx.db
    nomes = listas.nomes(db, [c.motivo_encerramento_id, c.origem_id, c.centro_custo_id, *(x.item_id for x in c.itens_lista)])
    equipe_ids = [e.usuario_id for e in c.equipe]
    usuarios = dict(db.execute(select(Usuario.id, Usuario.nome).where(Usuario.id.in_(equipe_ids))).all()) if equipe_ids else {}
    etiquetas = [x.item_id for x in c.itens_lista if x.papel == "etiqueta"]
    pai = db.get(Caso, c.caso_pai_id) if c.caso_pai_id else None
    tipo = tipo_caso_de(c)
    return {
        "tipo_caso": tipo, "tipo_caso_nome": ROTULOS["tipo_caso"][tipo], "status_nome": ROTULOS["status"][c.status.value],
        "equipe_ids": equipe_ids, "equipe": [{"id": i, "nome": usuarios.get(i, "")} for i in equipe_ids],
        "etiqueta_ids": etiquetas, "etiquetas": [{"id": i, "nome": nomes.get(i, "")} for i in etiquetas],
        "motivo_encerramento_id": c.motivo_encerramento_id, "motivo_encerramento_nome": nomes.get(c.motivo_encerramento_id),
        "origem_id": c.origem_id, "origem_nome": nomes.get(c.origem_id),
        "centro_custo_id": c.centro_custo_id, "centro_custo_nome": nomes.get(c.centro_custo_id),
        "valor_estimado": c.valor_estimado, "caso_pai_id": c.caso_pai_id,
        "caso_pai_titulo": f"#{pai.numero} {pai.titulo}" if pai else None,
        "tipo_vinculo": c.tipo_vinculo, "sigiloso": bool(c.sigiloso), "observacoes": c.observacoes,
    }
