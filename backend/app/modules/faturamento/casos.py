"""Regras do caso por tipo (contencioso, consultivo, administrativo): o ponto único que decide o tipo, calcula a
coluna antiga `tipo`, grava os campos comuns novos e monta a parte nova da ficha.

Chamadas antigas continuam valendo: quem manda só o `tipo` antigo (telas atuais, assistente, conector do Claude) tem o
`tipo_caso` deduzido dele; sem nenhum dos dois, caso com número de processo é contencioso e o resto é consultivo.
"""

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.faturamento import listas
from app.modules.faturamento.models import AnexoCaso, Caso, StatusCaso, Timesheet, TipoCaso
from app.modules.faturamento.tipos_caso import (
    EXTENSAO,
    ROTULOS,
    CasoAdministrativo,
    CasoConsultivo,
    CasoContencioso,
    CasoEquipe,
    CasoLista,
    TipoDeCaso,
)
from app.modules.tribunais import cnj

# campos de CasoIn que não são coluna direta do caso (tratados em `aplicar`)
CAMPOS_NOVOS = {"tipo", "tipo_caso", "equipe_ids", "etiqueta_ids", "motivo_encerramento_id", "origem_id", "centro_custo_id",
                "valor_estimado", "caso_pai_id", "tipo_vinculo", "sigiloso", "observacoes", "contencioso", "consultivo",
                "administrativo"}
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
    """Depois de gravar os campos de sempre: tipo do caso, campos comuns novos, a extensão do tipo e a coluna antiga
    `tipo`. Tudo na mesma transação do caso."""
    tipo, dica = _resolver_tipo(ctx, c, dados, novo)
    trocou = bool(not novo and c.tipo_caso and c.tipo_caso != tipo)
    c.tipo_caso = tipo
    _aplicar_comuns(ctx, c, dados)
    _validar_situacao(c)
    for outro in EXTENSAO:
        if outro != tipo and getattr(dados, outro) is not None and outro in dados.model_fields_set and not trocou:
            raise HTTPException(400, f"Este caso é {ROTULOS['tipo_caso'][tipo].lower()}: os dados de "
                                     f"{ROTULOS['tipo_caso'][outro].lower()} não se aplicam.")
    if c.id is None:
        ctx.db.flush()
    ext = extensao(ctx.db, c)  # a extensão antiga (se trocou de tipo) fica guardada
    bloco = getattr(dados, tipo)
    if tipo == TipoDeCaso.contencioso:
        _aplicar_contencioso(ctx, c, ext, bloco, dica)
    elif tipo == TipoDeCaso.consultivo:
        _aplicar_consultivo(ctx, c, ext, bloco)
    else:
        _aplicar_administrativo(ctx, c, ext, bloco)
    sincronizar_tipo(c, ext)
    from app.modules.faturamento import envolvimento

    if trocou:  # as partes vão para a categoria do mesmo polo no tipo novo, pendentes de reclassificação
        envolvimento.trocar_tipo(ctx.db, c)
    envolvimento.garantir_cliente(ctx.db, c)  # o cliente do caso é sempre uma das partes
    if not novo and "polo" in dados.model_fields_set:
        envolvimento.polo_pela_ficha(ctx.db, c, dados.polo)
    envolvimento.sincronizar_polo(ctx.db, c)


def ao_criar(db: Session, c: Caso) -> None:
    """Caso criado ou alterado fora da rota (importações, tribunais): classifica pelo que já tem e garante a extensão."""
    if not c.tipo_caso:
        c.tipo_caso = classificar(c.tipo, c.numero_processo)
    if c.id is None:
        db.flush()
    ext = extensao(db, c)
    if c.tipo_caso == TipoDeCaso.contencioso:
        ext.justica = justica_do_numero(c.numero_processo) or JUSTICA_DO_TIPO.get(c.tipo) or ext.justica
        _do_numero(c, ext)
    sincronizar_tipo(c, ext)
    from app.modules.faturamento import envolvimento

    envolvimento.garantir_cliente(db, c)
    envolvimento.sincronizar_polo(db, c)


def sincronizar_tipo(c: Caso, ext=None) -> None:
    """O ponto único que calcula a coluna antiga `tipo`."""
    c.tipo = derivar_tipo(c.tipo_caso, getattr(ext, "justica", None), c.tipo)


# ------------------------------------------------------------------------------------------- extensões por tipo
def extensao(db: Session, c: Caso, criar: bool = True):
    """A linha 1:1 do tipo do caso (criada com os padrões se ainda não existir)."""
    tipo = tipo_caso_de(c)
    modelo = EXTENSAO[tipo]
    ext = db.get(modelo, c.id) if c.id else None
    if ext is None and criar:
        ext = modelo(caso_id=c.id)
        if tipo == TipoDeCaso.contencioso:
            ext.pre_ajuizamento = not (c.numero_processo or "").strip()
            ext.fase_processual = "pre_ajuizamento" if ext.pre_ajuizamento else "conhecimento"
            ext.monitorar_andamentos = True
        elif tipo == TipoDeCaso.consultivo:
            ext.prioridade, ext.etapa, ext.data_solicitacao = "media", "recebido", c.data_abertura or date.today()
        else:
            ext.numero_processo_adm = (c.numero_processo or "").strip()[:60] or None
            ext.instancia_adm, ext.fase_adm = "primeira", "protocolado" if ext.numero_processo_adm else "pre_protocolo"
        db.add(ext)
    return ext


def monitora(db: Session, c: Caso) -> bool:
    """Busca capa e andamentos no tribunal? (contencioso com a opção ligada; caso antigo sem extensão: sim)"""
    ext = db.get(CasoContencioso, c.id) if c.id else None
    return ext.monitorar_andamentos if ext else True


def _copiar(ext, bloco, pular: set[str]) -> None:
    for campo, valor in bloco.model_dump().items():
        if campo not in pular and hasattr(type(ext), campo):
            setattr(ext, campo, valor)


def _do_numero(c: Caso, ext: CasoContencioso) -> None:
    """Com número CNJ válido: justiça, órgão e UF vêm dele; o tribunal é preenchido se estiver vazio."""
    if not cnj.valido(c.numero_processo):
        return
    p = cnj.partes(c.numero_processo)
    trib = cnj.tribunal_do_numero(c.numero_processo)
    ext.justica = justica_do_numero(c.numero_processo) or ext.justica
    ext.codigo_orgao = p["origem"]
    ext.pre_ajuizamento = False
    if trib:
        c.tribunal = c.tribunal or trib["sigla"]
        ext.uf = ext.uf or trib["uf"]


def _aplicar_contencioso(ctx, c: Caso, ext: CasoContencioso, bloco, dica: str | None) -> None:
    db, t = ctx.db, ctx.tenant_id
    if bloco is None:  # chamada antiga: nada é exigido
        ext.justica = dica or ext.justica
        if (c.numero_processo or "").strip() and ext.pre_ajuizamento:
            ext.pre_ajuizamento = False
            if ext.fase_processual == "pre_ajuizamento":
                ext.fase_processual = "conhecimento"
        _do_numero(c, ext)
        return
    numero = (c.numero_processo or "").strip()
    if not numero and not bloco.pre_ajuizamento:
        raise HTTPException(400, "Informe o número do processo (CNJ) ou marque que o caso ainda não foi ajuizado.")
    if numero:
        if len(cnj.so_digitos(numero)) != 20:
            raise HTTPException(400, "Número do processo fora do padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO). "
                                     "Numeração anterior ao CNJ vai no campo Número antigo.")
        if not cnj.valido(numero):
            raise HTTPException(400, "Número CNJ inválido: confira os dígitos (o dígito verificador não bate).")
        c.numero_processo = cnj.formatar(numero)
    listas.item_da_lista(db, t, bloco.classe_id, "classe", "Classe processual")
    listas.item_da_lista(db, t, bloco.assunto_id, "assunto", "Assunto principal")
    _copiar(ext, bloco, {"classe_nome", "assunto_nome", "assuntos_secundarios", "assuntos_secundarios_ids"})
    ext.uf = bloco.uf.upper() if bloco.uf else None
    ext.justica = bloco.justica or dica or ext.justica
    ext.pre_ajuizamento = bool(bloco.pre_ajuizamento and not numero)
    ext.fase_processual = bloco.fase_processual or ("pre_ajuizamento" if ext.pre_ajuizamento else "conhecimento")
    definir_itens(db, t, c, "assunto_secundario", "assunto",
                  [i for i in bloco.assuntos_secundarios_ids if i != bloco.assunto_id], "Assunto")
    _do_numero(c, ext)
    if bloco.data_transito_julgado and c.data_distribuicao and bloco.data_transito_julgado < c.data_distribuicao:
        raise HTTPException(400, "O trânsito em julgado não pode ser antes da distribuição.")


def _outro_caso(ctx, c: Caso, caso_id: int | None, rotulo: str) -> None:
    if not caso_id:
        return
    outro = ctx.db.get(Caso, caso_id)
    if not outro or outro.tenant_id != ctx.tenant_id:
        raise HTTPException(400, f"{rotulo}: caso não encontrado.")
    if outro.id == c.id:
        raise HTTPException(400, f"{rotulo}: escolha outro caso, não este mesmo.")


def _aplicar_consultivo(ctx, c: Caso, ext: CasoConsultivo, bloco) -> None:
    if bloco is None:
        return
    db, t = ctx.db, ctx.tenant_id
    if not bloco.tipo_demanda_id:
        raise HTTPException(400, "Escolha o tipo de demanda.")
    listas.item_da_lista(db, t, bloco.tipo_demanda_id, "tipo_demanda", "Tipo de demanda")
    if bloco.solicitante_id:
        from app.modules.tribunais.models import Pessoa

        p = db.get(Pessoa, bloco.solicitante_id)
        if not p or p.tenant_id != t:
            raise HTTPException(400, "Solicitante não encontrado no cadastro de pessoas.")
    if bloco.etapa in ("entregue", "concluido") and not bloco.data_entrega:
        raise HTTPException(400, f"Informe a data de entrega: a etapa é “{ROTULOS['etapa'][bloco.etapa]}”.")
    if bloco.contrato_vigencia_inicio and bloco.contrato_vigencia_fim and bloco.contrato_vigencia_fim < bloco.contrato_vigencia_inicio:
        raise HTTPException(400, "O fim da vigência do contrato não pode ser antes do início.")
    if bloco.documento_entregue_id:
        a = db.get(AnexoCaso, bloco.documento_entregue_id)
        if not a or a.caso_id != c.id:
            raise HTTPException(400, "Documento entregue: escolha um anexo deste caso.")
    _outro_caso(ctx, c, bloco.gerou_contencioso_id, "Caso judicial gerado")
    _copiar(ext, bloco, {"tipo_demanda_nome", "solicitante_nome", "horas_realizadas", "gerou_contencioso_titulo"})
    ext.data_solicitacao = bloco.data_solicitacao or c.data_abertura or date.today()
    if ext.data_entrega and ext.data_entrega < ext.data_solicitacao:
        raise HTTPException(400, "A data de entrega não pode ser antes da solicitação.")


def _aplicar_administrativo(ctx, c: Caso, ext: CasoAdministrativo, bloco) -> None:
    if bloco is None:
        return
    db, t = ctx.db, ctx.tenant_id
    if not bloco.esfera:
        raise HTTPException(400, "Escolha a esfera (federal, estadual, municipal ou distrital).")
    if not bloco.orgao_id:
        raise HTTPException(400, "Escolha o órgão.")
    if not bloco.tipo_procedimento_id:
        raise HTTPException(400, "Escolha o tipo de procedimento.")
    listas.item_da_lista(db, t, bloco.orgao_id, "orgao", "Órgão")
    listas.item_da_lista(db, t, bloco.tipo_procedimento_id, "tipo_procedimento", "Tipo de procedimento")
    tem_numero = bool((bloco.numero_processo_adm or "").strip() or (bloco.numero_protocolo or "").strip())
    fase = bloco.fase_adm or ("protocolado" if tem_numero else "pre_protocolo")
    if not tem_numero and fase != "pre_protocolo":
        raise HTTPException(400, "Informe o número do processo administrativo ou o número do protocolo.")
    if bloco.decisao and not bloco.data_decisao:
        raise HTTPException(400, "Informe a data da decisão.")
    if bloco.cabe_judicializacao is False and bloco.prazo_judicializacao:
        raise HTTPException(400, "Marque que cabe judicialização para informar o prazo.")
    _outro_caso(ctx, c, bloco.caso_judicial_id, "Caso judicial")
    _copiar(ext, bloco, {"orgao_nome", "tipo_procedimento_nome", "caso_judicial_titulo"})
    ext.uf = bloco.uf.upper() if bloco.uf else None
    ext.fase_adm, ext.instancia_adm = fase, bloco.instancia_adm or "primeira"


def cnj_duplicado(db: Session, tenant_id: int, numero: str | None, exceto_caso_id: int | None = None) -> dict | None:
    """Outro caso do escritório com o mesmo número CNJ (aviso; nunca bloqueia)."""
    if not cnj.valido(numero):
        return None
    sel = select(Caso).where(Caso.tenant_id == tenant_id,
                             Caso.numero_processo.in_([cnj.formatar(numero), cnj.so_digitos(numero)]))
    if exceto_caso_id:
        sel = sel.where(Caso.id != exceto_caso_id)
    outro = db.scalars(sel.order_by(Caso.id).limit(1)).first()
    return {"caso_id": outro.id, "numero": outro.numero, "titulo": outro.titulo} if outro else None


def ler_cnj(db: Session, tenant_id: int, numero: str, exceto_caso_id: int | None = None) -> dict:
    digitos = cnj.so_digitos(numero)
    if len(digitos) != 20:
        return {"valido": False, "mensagem": "O número CNJ tem 20 dígitos: NNNNNNN-DD.AAAA.J.TR.OOOO."}
    if not cnj.valido(digitos):
        return {"valido": False, "mensagem": "Número CNJ inválido: o dígito verificador não bate."}
    p, trib = cnj.partes(digitos), cnj.tribunal_do_numero(digitos)
    justica = justica_do_numero(digitos)
    return {"valido": True, "mensagem": None, "numero_formatado": cnj.formatar(digitos), "ano": p["ano"],
            "justica": justica, "justica_nome": ROTULOS["justica"].get(justica or ""),
            "tribunal": trib["sigla"] if trib else None, "tribunal_nome": trib["nome"] if trib else None,
            "uf": trib["uf"] if trib else None, "codigo_orgao": p["origem"],
            "tipo": getattr(derivar_tipo(TipoDeCaso.contencioso, justica), "value", None),
            "duplicado": cnj_duplicado(db, tenant_id, digitos, exceto_caso_id)}


def _bloco(ctx, c: Caso, ext, tipo: str, lote: dict | None = None) -> dict:
    from app.modules.faturamento import schemas

    db = ctx.db
    nomes_de = (lambda ids: lote["nomes"]) if lote else (lambda ids: listas.nomes(db, ids))
    dados = {k: getattr(ext, k) for k in EXTENSAO[tipo].__table__.columns.keys() if k not in ("caso_id", "criado_em", "atualizado_em")}
    if tipo == TipoDeCaso.contencioso:
        sec = [x.item_id for x in c.itens_lista if x.papel == "assunto_secundario"]
        nomes = nomes_de([ext.classe_id, ext.assunto_id, *sec])
        dados.update(classe_nome=nomes.get(ext.classe_id), assunto_nome=nomes.get(ext.assunto_id), assuntos_secundarios_ids=sec,
                     assuntos_secundarios=[{"id": i, "nome": nomes.get(i, "")} for i in sec])
        return schemas.ContenciosoDados(**dados)
    if tipo == TipoDeCaso.consultivo:
        from app.modules.tribunais.models import Pessoa

        sol = db.get(Pessoa, ext.solicitante_id) if ext.solicitante_id else None
        gerou = db.get(Caso, ext.gerou_contencioso_id) if ext.gerou_contencioso_id else None
        minutos = lote["minutos"].get(c.id, 0) if lote else (
            db.scalar(select(func.coalesce(func.sum(Timesheet.minutos), 0)).where(Timesheet.caso_id == c.id)) or 0)
        dados.update(tipo_demanda_nome=nomes_de([ext.tipo_demanda_id]).get(ext.tipo_demanda_id),
                     solicitante_nome=sol.nome if sol else None,
                     horas_realizadas=(Decimal(minutos) / 60).quantize(Decimal("0.01")),
                     gerou_contencioso_titulo=f"#{gerou.numero} {gerou.titulo}" if gerou else None)
        return schemas.ConsultivoDados(**dados)
    nomes = nomes_de([ext.orgao_id, ext.tipo_procedimento_id])
    judicial = db.get(Caso, ext.caso_judicial_id) if ext.caso_judicial_id else None
    dados.update(orgao_nome=nomes.get(ext.orgao_id), tipo_procedimento_nome=nomes.get(ext.tipo_procedimento_id),
                 caso_judicial_titulo=f"#{judicial.numero} {judicial.titulo}" if judicial else None)
    return schemas.AdministrativoDados(**dados)


def preparar_lista(ctx, casos: list[Caso]) -> dict:
    """Tudo o que a lista de casos precisa da parte nova, em poucas consultas (em vez de várias por caso)."""
    from app.modules.faturamento import envolvimento
    from app.modules.faturamento.tipos_caso import Envolvimento, ListaItem

    db, t = ctx.db, ctx.tenant_id
    ids = [c.id for c in casos]
    lote = {"ext": {}, "minutos": {}, "pendentes": {}, "partes": {}, "usuarios": {}, "nomes": {}}
    if not ids:
        return lote
    for tipo, modelo in EXTENSAO.items():
        for ext in db.scalars(select(modelo).where(modelo.caso_id.in_(ids))):
            lote["ext"][(tipo, ext.caso_id)] = ext
    lote["minutos"] = dict(db.execute(select(Timesheet.caso_id, func.sum(Timesheet.minutos)).where(Timesheet.caso_id.in_(ids))
                                      .group_by(Timesheet.caso_id)).all())
    lote["pendentes"] = dict(db.execute(select(Envolvimento.caso_id, func.count()).where(
        Envolvimento.caso_id.in_(ids), Envolvimento.ativo, Envolvimento.pendente_reclassificacao).group_by(Envolvimento.caso_id)).all())
    lote["partes"] = envolvimento.resumos_do_escritorio(db, t)
    lote["usuarios"] = dict(db.execute(select(Usuario.id, Usuario.nome).where(Usuario.tenant_id == t)).all())
    lote["nomes"] = dict(db.execute(select(ListaItem.id, ListaItem.nome).where(ListaItem.tenant_id == t)).all())
    return lote


def saida(ctx, c: Caso, ficha: bool = True, lote: dict | None = None) -> dict:
    """Parte nova de CasoOut. Na lista (`ficha=False`, com o `lote` de `preparar_lista`) o aviso de CNJ repetido e o
    título sugerido ficam de fora."""
    db = ctx.db
    from app.modules.faturamento import envolvimento

    equipe_ids = [e.usuario_id for e in c.equipe]
    etiquetas = [x.item_id for x in c.itens_lista if x.papel == "etiqueta"]
    pai = db.get(Caso, c.caso_pai_id) if c.caso_pai_id else None
    tipo = tipo_caso_de(c)
    if lote:
        nomes, usuarios, ext = lote["nomes"], lote["usuarios"], lote["ext"].get((tipo, c.id))
        partes, n_pendentes = lote["partes"].get(c.id), lote["pendentes"].get(c.id, 0)
    else:
        nomes = listas.nomes(db, [c.motivo_encerramento_id, c.origem_id, c.centro_custo_id, *(x.item_id for x in c.itens_lista)])
        usuarios = dict(db.execute(select(Usuario.id, Usuario.nome).where(Usuario.id.in_(equipe_ids))).all()) if equipe_ids else {}
        ext = extensao(db, c, criar=False)
        partes, n_pendentes = envolvimento.resumo_partes(db, c.id), envolvimento.pendentes(db, c.id)
    return {
        "partes_resumo": partes,
        "titulo_sugerido": envolvimento.titulo_sugerido(db, c) if ficha else None,
        "pendentes_reclassificacao": n_pendentes,
        tipo: _bloco(ctx, c, ext, tipo, lote) if ext else None,
        "aviso_cnj_duplicado": cnj_duplicado(db, c.tenant_id, c.numero_processo, c.id) if ficha and tipo == "contencioso" else None,
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
