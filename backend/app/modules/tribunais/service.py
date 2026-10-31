"""Regras da integração: varredura, importação, sincronização, vínculo com cliente e espelho no caso (andamentos)."""

import hashlib
import logging
import re
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import tenancy
from app.core.db import agora
from app.core.models import Usuario
from app.modules.faturamento.models import Andamento, Caso, TipoAndamento
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais import catalogo, cnj, fontes, vinculo
from app.modules.tribunais.models import (
    AdvogadoParte,
    Alerta,
    CertificadoAdvogado,
    ConfigTribunais,
    Encontrado,
    InscricaoOab,
    Movimentacao,
    Parte,
    Pessoa,
    Plataforma,
    Processo,
    Sistema,
    Tribunal,
    Varredura,
    Vinculo,
)

log = logging.getLogger(__name__)


class ErroIntegracao(ValueError):
    pass


# --------------------------------------------------------------------------------------------------------- apoio
def plataforma(db: Session) -> Plataforma:
    return db.scalar(select(Plataforma).order_by(Plataforma.id)) or catalogo.garantir_plataforma(db)


def config(db: Session, tenant_id: int) -> ConfigTribunais:
    cfg = db.get(ConfigTribunais, tenant_id)
    if not cfg:
        plataforma(db)
        cfg = catalogo.garantir_tenant(db, tenant_id)
    return cfg


def pasta(tenant_id: int, *sub: str) -> Path:
    p = tenancy.pasta_base() / "tribunais" / str(tenant_id) / Path(*sub)
    p.mkdir(parents=True, exist_ok=True)
    return p


def guardar(tenant_id: int, sub: str, nome: str, dados: bytes) -> str:
    caminho = pasta(tenant_id, sub) / re.sub(r"[^\w.\-]", "_", nome)[:150]
    caminho.write_bytes(dados)
    return str(caminho)


def sha256(dados: bytes) -> str:
    return hashlib.sha256(dados).hexdigest()


def tribunal_do_numero(db: Session, numero: str) -> Tribunal:
    if not cnj.valido(numero):
        raise ErroIntegracao(f"Número de processo inválido: {numero}. Confira os dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).")
    t = cnj.tribunal_do_numero(numero)
    trib = db.scalar(select(Tribunal).where(Tribunal.sigla == t["sigla"])) if t else None
    if not trib:
        plataforma(db)
        trib = db.scalar(select(Tribunal).where(Tribunal.sigla == t["sigla"])) if t else None
    if not trib:
        raise ErroIntegracao("O número não corresponde a nenhum tribunal conhecido (segmento/tribunal do CNJ).")
    return trib


def sistema_atual(tribunal: Tribunal, grau: str | None, nome_sistema: str | None = None, hoje: date | None = None) -> Sistema | None:
    """Regra 1: em qual sistema o processo tramita HOJE (há tribunais com dois sistemas durante a migração)."""
    hoje = hoje or date.today()
    vigentes = [s for s in tribunal.sistemas if s.ativo and (not s.data_inicio or s.data_inicio <= hoje)
                and (not s.data_fim or s.data_fim >= hoje)]
    do_grau = [s for s in vigentes if s.grau == grau] or vigentes
    if nome_sistema:
        exato = [s for s in do_grau if s.sistema == nome_sistema] or [s for s in vigentes if s.sistema == nome_sistema]
        if exato:
            return exato[0]
    return do_grau[0] if do_grau else None


def oabs_do_advogado(db: Session, usuario: Usuario) -> list[dict]:
    lista = [{"numero": o.numero, "uf": o.uf, "tipo": o.tipo} for o in db.scalars(
        select(InscricaoOab).where(InscricaoOab.usuario_id == usuario.id).order_by(InscricaoOab.id))]
    if not lista and usuario.oab:  # cadastro antigo: "123456/SP" no campo OAB do profissional
        m = re.match(r"\s*(\d+)\s*[/\- ]?\s*([A-Za-z]{2})?", usuario.oab)
        uf = (m.group(2) or usuario.uf or "").upper() if m else ""
        if m and uf:
            lista = [{"numero": m.group(1), "uf": uf, "tipo": "principal"}]
    return lista


def certificado_ativo(db: Session, usuario_id: int) -> CertificadoAdvogado | None:
    return db.scalar(select(CertificadoAdvogado).where(CertificadoAdvogado.usuario_id == usuario_id,
                                                       CertificadoAdvogado.removido_em.is_(None))
                     .order_by(CertificadoAdvogado.id.desc()))


def alertar(db: Session, tenant_id: int, tipo: str, mensagem: str, *, severidade="info", processo_id=None, protocolo_id=None,
            usuario_id=None) -> Alerta:
    a = Alerta(tenant_id=tenant_id, tipo=tipo, mensagem=mensagem[:500], severidade=severidade, processo_id=processo_id,
               protocolo_id=protocolo_id, usuario_id=usuario_id)
    db.add(a)
    return a


def clientes(db: Session, tenant_id: int) -> list[Tomador]:
    return list(db.scalars(select(Tomador).where(Tomador.tenant_id == tenant_id)))


# ------------------------------------------------------------------------------------------------------ varredura
def iniciar_varredura(db: Session, tenant_id: int, advogado: Usuario, disparada_por: Usuario | None, *, data_inicio: date | None = None,
                      data_fim: date | None = None, tribunais_alvo: list[str] | None = None) -> Varredura:
    oabs = oabs_do_advogado(db, advogado)
    if not oabs:
        raise ErroIntegracao(f"{advogado.nome} não tem OAB cadastrada. Cadastre em Tribunais › Advogados.")
    plat = plataforma(db)
    v = Varredura(tenant_id=tenant_id, advogado_id=advogado.id, disparada_por_id=disparada_por.id if disparada_por else None, inscricoes_oab=oabs,
                  fontes=["djen"], tribunais_alvo=[t.upper() for t in tribunais_alvo or []], data_inicio=data_inicio,
                  data_fim=data_fim, coleta="servidor" if plat.djen_proxy_url else "navegador", status="rodando",
                  iniciada_em=agora(), resumo_por_tribunal={})
    db.add(v)
    db.flush()
    return v


def _juntar(lista: list[dict], novos: list[dict], chave) -> list[dict]:
    vistos = {chave(x) for x in lista}
    for n in novos:
        if chave(n) not in vistos:
            lista.append(n)
            vistos.add(chave(n))
    return lista


def ingerir_comunicacoes(db: Session, v: Varredura, brutos: list[dict]) -> dict:
    """Recebe uma página do DJEN (colhida pelo servidor ou pelo navegador) e agrega por processo."""
    if v.status not in ("rodando", "pendente"):
        raise ErroIntegracao("Esta varredura já foi encerrada.")
    alvo = set(v.tribunais_alvo or [])
    por_numero = {e.numero_cnj: e for e in v.encontrados}
    novos = intimacoes = 0
    for bruto in brutos:
        it = fontes.djen_item(bruto)
        if not it:
            continue
        t = cnj.tribunal_do_numero(it["numero_cnj"])
        sigla = (t or {}).get("sigla") or it["tribunal"]
        if alvo and sigla not in alvo:
            continue
        e = por_numero.get(it["numero_cnj"])
        if e is None:
            trib = db.scalar(select(Tribunal).where(Tribunal.sigla == sigla))
            sist = sistema_atual(trib, "1g") if trib else None
            e = Encontrado(varredura_id=v.id, numero_cnj=it["numero_cnj"], tribunal_id=trib.id if trib else None, tribunal_sigla=sigla,
                           sistema_provavel=sist.sistema if sist else None, fonte="djen",
                           dados={"partes": [], "advogados": [], "comunicacoes": []})
            e.ja_importado = bool(db.scalar(select(Processo.id).where(Processo.tenant_id == v.tenant_id, Processo.numero_cnj == it["numero_cnj"])))
            e.status_importacao = "importado" if e.ja_importado else "nao_importar"
            db.add(e)
            v.encontrados.append(e)
            por_numero[e.numero_cnj] = e
            novos += 1
        dados = dict(e.dados or {})
        hashes = {c["hash"] for c in dados.get("comunicacoes", [])}
        if it["hash"] in hashes:
            continue
        dados["partes"] = _juntar(list(dados.get("partes", [])), it["partes"], lambda p: (vinculo.normalizar_nome(p["nome"]), p["polo"]))
        dados["advogados"] = _juntar(list(dados.get("advogados", [])), it["advogados"], lambda a: (a["oab"], a["uf"], a["nome"]))
        dados["comunicacoes"] = [*dados.get("comunicacoes", []), {
            "hash": it["hash"], "id": it["id"], "data": it["data"].isoformat() if it["data"] else None, "tipo": it["tipo"],
            "orgao": it["orgao"], "texto": it["texto"][:4000], "link": it["link"]}]
        e.dados = dados
        e.comunicacoes = len(dados["comunicacoes"])
        e.classe_resumo = e.classe_resumo or (it["classe"] or "")[:200] or None
        e.orgao_resumo = (it["orgao"] or e.orgao_resumo or "")[:300] or None
        if it["data"] and (not e.ultima_movimentacao_em or it["data"] > e.ultima_movimentacao_em):
            e.ultima_movimentacao_em = it["data"]
        e.partes_resumo = resumo_partes(dados["partes"])
        v.total_comunicacoes += 1
        if e.ja_importado:  # processo já está no sistema: a comunicação entra como intimação
            p = db.scalar(select(Processo).where(Processo.tenant_id == v.tenant_id, Processo.numero_cnj == e.numero_cnj))
            if p and registrar_comunicacao(db, p, it):
                intimacoes += 1
    v.total_encontrados = len(por_numero)
    resumo: dict[str, int] = {}
    for e in por_numero.values():
        resumo[e.tribunal_sigla or "?"] = resumo.get(e.tribunal_sigla or "?", 0) + 1
    v.resumo_por_tribunal = dict(sorted(resumo.items(), key=lambda kv: -kv[1]))
    db.flush()
    return {"novos": novos, "total_encontrados": v.total_encontrados, "total_comunicacoes": v.total_comunicacoes,
            "intimacoes_registradas": intimacoes, "resumo_por_tribunal": v.resumo_por_tribunal}


def inicio_intimacoes_novas(db: Session, advogado_id: int) -> date:
    """Desde a última varredura concluída do advogado (1 dia de folga) ou dos últimos 7 dias."""
    ult = db.scalar(select(Varredura).where(Varredura.advogado_id == advogado_id, Varredura.status.in_(("concluida", "parcial")))
                    .order_by(Varredura.id.desc()))
    return (ult.concluida_em.date() - timedelta(days=1)) if ult and ult.concluida_em else date.today() - timedelta(days=7)


def agendar_intimacoes_diarias(db: Session) -> int:
    """Com proxy no Brasil, o servidor busca sozinho as intimações novas de cada advogado com OAB (1x por dia)."""
    from app.modules.tribunais import jobs

    if not plataforma(db).djen_proxy_url:
        return 0
    n = 0
    ids = set(db.scalars(select(InscricaoOab.usuario_id))) | set(db.scalars(select(Usuario.id).where(Usuario.oab.is_not(None))))
    for u in db.scalars(select(Usuario).where(Usuario.id.in_(ids or {0}), Usuario.ativo.is_(True))):
        hoje = db.scalar(select(Varredura.id).where(Varredura.advogado_id == u.id, Varredura.iniciada_em >= datetime.combine(
            date.today(), time(0), tzinfo=UTC)))
        if hoje or not oabs_do_advogado(db, u):
            continue
        v = iniciar_varredura(db, u.tenant_id, u, None, data_inicio=inicio_intimacoes_novas(db, u.id), data_fim=date.today())
        jobs.enfileirar(db, u.tenant_id, "varredura", v.id)
        n += 1
    db.flush()
    return n


def resumo_partes(partes: list[dict]) -> str | None:
    ativo = [p["nome"] for p in partes if p["polo"] == "ativo"]
    passivo = [p["nome"] for p in partes if p["polo"] == "passivo"]
    outros = [p["nome"] for p in partes if p["polo"] not in ("ativo", "passivo")]

    def fmt(nomes):
        return (nomes[0] + (f" e outros ({len(nomes) - 1})" if len(nomes) > 1 else "")) if nomes else ""

    if ativo or passivo:
        return f"{fmt(ativo) or '—'} x {fmt(passivo) or '—'}"[:500]
    return fmt(outros)[:500] or None


def concluir_varredura(db: Session, v: Varredura, *, erro: str | None = None, parcial: bool = False) -> Varredura:
    cfg = config(db, v.tenant_id)
    base = clientes(db, v.tenant_id)
    for e in v.encontrados:
        melhor = None
        for p in (e.dados or {}).get("partes", []):
            s = vinculo.casar(p["nome"], None, None, base, cfg.limiar_fuzzy)
            if s and (not melhor or s.confianca > melhor.confianca):
                melhor = s
        e.possivel_cliente_id = melhor.cliente_id if melhor else None
        e.possivel_cliente_criterio = melhor.criterio if melhor else None
    v.status = "erro" if erro and not v.encontrados else ("parcial" if erro or parcial else "concluida")
    v.erro = erro
    v.concluida_em = agora()
    db.flush()
    return v


def rodar_varredura_servidor(db: Session, v: Varredura, max_paginas: int = 200) -> Varredura:
    """Coleta pelo servidor (só funciona com proxy no Brasil configurado na plataforma)."""
    plat = plataforma(db)
    base = plat.djen_proxy_url or plat.djen_url
    erro = None
    try:
        for oab in v.inscricoes_oab:
            for pagina in range(1, max_paginas + 1):
                r = fontes.djen_buscar(base, oab["numero"], oab["uf"], pagina, v.data_inicio, v.data_fim)
                itens = r.get("items") or []
                ingerir_comunicacoes(db, v, itens)
                db.commit()
                if len(itens) < 100 or pagina * 100 >= int(r.get("count") or 0):
                    break
    except fontes.ForaDoBrasil:
        v.coleta = "navegador"
        db.commit()
        return v  # o navegador assume a coleta
    except fontes.FonteIndisponivel as e:
        erro = str(e)
    return concluir_varredura(db, v, erro=erro)


# ---------------------------------------------------------------------------------------------- movimentações
_TIPO_POR_TEXTO = [
    (re.compile(r"senten|julgad[oa] (im)?procedente|proced[eê]ncia|extin[cç][aã]o", re.I), TipoAndamento.sentenca),
    (re.compile(r"decis[aã]o|tutela|liminar|concess[aã]o|indeferi", re.I), TipoAndamento.decisao),
    (re.compile(r"despacho|mero expediente", re.I), TipoAndamento.despacho),
    (re.compile(r"audi[eê]ncia", re.I), TipoAndamento.andamento),
]


def tipo_andamento(descricao: str, e_intimacao: bool) -> TipoAndamento:
    if e_intimacao:
        return TipoAndamento.publicacao
    for rx, tipo in _TIPO_POR_TEXTO:
        if rx.search(descricao or ""):
            return tipo
    return TipoAndamento.andamento


def _espelhar_andamento(db: Session, p: Processo, m: Movimentacao) -> None:
    if not p.caso_id or m.andamento_id or not config(db, p.tenant_id).criar_andamentos:
        return
    titulo = m.descricao.split("\n")[0][:200]
    a = Andamento(caso_id=p.caso_id, data=m.data_hora.date(), tipo=tipo_andamento(m.descricao, m.e_intimacao), titulo=titulo,
                  descricao=m.descricao if len(m.descricao) > len(titulo) else None)
    db.add(a)
    db.flush()
    m.andamento_id = a.id


def registrar_movimentacao(db: Session, p: Processo, dados: dict, fonte: str) -> Movimentacao | None:
    """Grava a movimentação se ainda não existe (hash) e espelha no caso. None = já existia."""
    h = dados.get("hash") or fontes.hash_movimento(dados.get("grau"), dados["data_hora"], dados.get("codigo_nacional"), dados["descricao"])
    if db.scalar(select(Movimentacao.id).where(Movimentacao.processo_id == p.id, Movimentacao.hash == h)):
        return None
    m = Movimentacao(processo_id=p.id, data_hora=dados["data_hora"], codigo_nacional=dados.get("codigo_nacional"),
                     codigo_local=dados.get("codigo_local"), descricao=dados["descricao"] or "Movimentação",
                     complementos=dados.get("complementos"), nivel_sigilo=dados.get("nivel_sigilo", 0), orgao=(dados.get("orgao") or "")[:300] or None,
                     grau=dados.get("grau"), e_intimacao=dados.get("e_intimacao", False), prazo_final=dados.get("prazo_final"),
                     fonte=fonte, hash=h, lida_pelo_usuario=dados.get("lida", False))
    db.add(m)
    db.flush()
    _espelhar_andamento(db, p, m)
    return m


def registrar_comunicacao(db: Session, p: Processo, it: dict) -> Movimentacao | None:
    """Comunicação do DJEN (intimação) de um processo já importado → movimentação + alerta para o responsável."""
    quando = datetime.combine(it["data"] or date.today(), time(12, 0), tzinfo=UTC)
    texto = f"{it['tipo'] or 'Comunicação'} (DJEN) — {it['orgao'] or ''}\n{it['texto']}".strip()
    m = registrar_movimentacao(db, p, {"data_hora": quando, "descricao": texto, "e_intimacao": True, "hash": f"djen:{it['hash']}",
                                       "orgao": it["orgao"]}, "djen")
    if m:
        alertar(db, p.tenant_id, "intimacao", f"Nova intimação no processo {p.numero_formatado} ({it['data']:%d/%m/%Y})."
                if it["data"] else f"Nova intimação no processo {p.numero_formatado}.", severidade="aviso", processo_id=p.id,
                usuario_id=p.responsavel_interno_id)
    return m


# -------------------------------------------------------------------------------------------------- importação
def _aplicar_capa(db: Session, p: Processo, capa: dict, tribunal: Tribunal) -> bool:
    """Atualiza a capa com o que veio do DataJud. True se algo mudou (hash_dados)."""
    mudou = capa.get("hash_dados") != p.hash_dados
    sist = sistema_atual(tribunal, capa.get("grau"), capa.get("sistema"))
    if p.sistema_nome and capa.get("sistema") and capa["sistema"] != p.sistema_nome:  # migrou (ex.: e-SAJ → eproc)
        p.migrado_de_sistema, p.migrado_em = p.sistema_nome, agora()
        alertar(db, p.tenant_id, "migracao", f"O processo {p.numero_formatado} migrou de {p.sistema_nome} para {capa['sistema']}.",
                severidade="aviso", processo_id=p.id, usuario_id=p.responsavel_interno_id)
    p.sistema_nome = capa.get("sistema") or p.sistema_nome
    p.sistema_instancia_id = sist.id if sist else p.sistema_instancia_id
    for campo in ("grau", "graus", "classe_codigo_cnj", "classe_nome", "assuntos", "orgao_julgador", "orgao_julgador_codigo",
                  "localidade_codigo", "data_ajuizamento", "nivel_sigilo"):
        if capa.get(campo) not in (None, [], ""):
            setattr(p, campo, capa[campo])
    p.segredo_justica = p.nivel_sigilo > 0
    p.hash_dados = capa.get("hash_dados") or p.hash_dados
    return mudou


def _pessoa(db: Session, tenant_id: int, dados: dict) -> Pessoa:
    doc = re.sub(r"\D", "", dados.get("documento") or "")
    nome = (dados.get("nome") or "").strip()[:300] or "Parte sem nome"
    q = select(Pessoa).where(Pessoa.tenant_id == tenant_id)
    existente = None
    if len(doc) == 11:
        existente = db.scalar(q.where(Pessoa.cpf == doc))
    elif len(doc) == 14:
        existente = db.scalar(q.where(Pessoa.cnpj == doc))
    if existente is None and not doc:
        existente = db.scalar(q.where(Pessoa.nome_normalizado == vinculo.normalizar_nome(nome), Pessoa.cpf.is_(None),
                                      Pessoa.cnpj.is_(None)))
    p = existente or Pessoa(tenant_id=tenant_id, nome=nome, nome_normalizado=vinculo.normalizar_nome(nome), telefones=[], enderecos=[],
                            outros_documentos=[])
    tipo = dados.get("tipo_pessoa") or ("juridica" if len(doc) == 14 or re.search(r"\b(LTDA|S\.?A\.?|EIRELI|ME|EPP|BANCO|CONDOMINIO)\b",
                                                                                   nome.upper()) else "fisica")
    p.tipo_pessoa = tipo
    if len(doc) == 11:
        p.cpf = doc
    elif len(doc) == 14:
        p.cnpj = doc
    if dados.get("documento_parcial"):
        p.documento_parcial, p.documento_mascarado = dados["documento_parcial"][:20], True
    for campo in ("sexo", "nome_mae", "nome_pai"):
        if dados.get(campo):
            setattr(p, campo, dados[campo])
    if dados.get("enderecos"):
        p.enderecos = dados["enderecos"]
    if p.id is None:
        db.add(p)
        db.flush()
    return p


def substituir_partes(db: Session, p: Processo, partes: list[dict], oabs_conta: set[tuple[str, str]], usuario_id: int | None) -> None:
    """Partes completas (MNI) ou resumidas (DJEN). A lista nova substitui a anterior.

    Vínculos que o usuário já confirmou/rejeitou acompanham a mesma pessoa na lista nova."""
    decisoes = [(v, v.parte.pessoa_id) for v in p.vinculos if v.parte_id and v.status in ("confirmado", "rejeitado")]
    for v in [v for v in p.vinculos if v.parte_id]:
        p.vinculos.remove(v)
    for antiga in list(p.partes):
        p.partes.remove(antiga)
    db.flush()
    for i, dados in enumerate(partes, start=1):
        pessoa = _pessoa(db, p.tenant_id, dados.get("pessoa") or dados)
        parte = Parte(processo_id=p.id, polo=dados.get("polo") or "outro", tipo_participacao=dados.get("tipo_participacao"),
                      pessoa_id=pessoa.id, assistencia_judiciaria=dados.get("assistencia_judiciaria"),
                      intimacao_pendente=dados.get("intimacao_pendente"), ordem=dados.get("ordem") or i)
        for a in dados.get("advogados") or []:
            e_usuario = (a.get("oab_numero"), (a.get("oab_uf") or "").upper()) in oabs_conta
            parte.advogados.append(AdvogadoParte(nome=a.get("nome") or "", cpf=a.get("cpf"), oab_numero=a.get("oab_numero"),
                                                 oab_uf=(a.get("oab_uf") or "")[:2] or None,
                                                 tipo_representante=a.get("tipo_representante") or "advogado",
                                                 recebe_intimacao=a.get("recebe_intimacao"), e_o_usuario=e_usuario,
                                                 usuario_id=usuario_id if e_usuario else None))
        p.partes.append(parte)
    db.flush()
    for v, pessoa_id in decisoes:
        parte = next((x for x in p.partes if x.pessoa_id == pessoa_id), None)
        if parte:
            p.vinculos.append(Vinculo(processo_id=p.id, parte_id=parte.id, cliente_id=v.cliente_id, criterio=v.criterio,
                                      confianca=v.confianca, status=v.status, confirmado_por_id=v.confirmado_por_id,
                                      confirmado_em=v.confirmado_em, polo_cliente=parte.polo))
    db.flush()


def vincular_clientes(db: Session, p: Processo) -> list[Vinculo]:
    """Regras de match (seção 9) para cada parte. Mantém vínculos confirmados/rejeitados pelo usuário."""
    cfg = config(db, p.tenant_id)
    base = clientes(db, p.tenant_id)
    decididos = {(v.cliente_id, v.parte.pessoa_id if v.parte else None) for v in p.vinculos if v.status in ("confirmado", "rejeitado")}
    for v in [v for v in p.vinculos if v.status in ("automatico", "sugerido")]:
        p.vinculos.remove(v)
    db.flush()
    novos = []
    for parte in p.partes:
        pes = parte.pessoa
        s = vinculo.casar(pes.nome, pes.cpf or pes.cnpj, pes.documento_parcial, base, cfg.limiar_fuzzy)
        if not s or (s.cliente_id, pes.id) in decididos:
            continue
        status = "automatico" if s.status == "automatico" and cfg.vincular_automatico else "sugerido"
        v = Vinculo(processo_id=p.id, parte_id=parte.id, cliente_id=s.cliente_id, criterio=s.criterio, confianca=s.confianca,
                    status=status, polo_cliente=parte.polo)
        p.vinculos.append(v)
        novos.append(v)
    db.flush()
    return novos


def ligar_caso_existente(db: Session, p: Processo) -> None:
    if p.caso_id:
        return
    for c in db.scalars(select(Caso).where(Caso.tenant_id == p.tenant_id, Caso.numero_processo.is_not(None))):
        if cnj.so_digitos(c.numero_processo) == p.numero_cnj:
            ligar_caso(db, p, c)
            return


def ligar_caso(db: Session, p: Processo, caso: Caso) -> None:
    """Liga o processo ao caso e traz todo o histórico como andamentos."""
    p.caso_id = caso.id
    caso.numero_processo = caso.numero_processo or p.numero_formatado
    if not caso.responsavel_id and p.responsavel_interno_id:
        caso.responsavel_id = p.responsavel_interno_id
    p.responsavel_interno_id = p.responsavel_interno_id or caso.responsavel_id
    db.flush()
    for m in sorted(p.movimentacoes, key=lambda x: x.data_hora):
        _espelhar_andamento(db, p, m)


def criar_caso(db: Session, p: Processo, contrato, usuario: Usuario, titulo: str | None = None) -> Caso:
    trib = p.tribunal
    polos = {pa.polo: pa.pessoa.nome for pa in p.partes}
    cliente_ids = {v.cliente_id for v in p.vinculos if v.status in ("automatico", "confirmado")}
    polo_cliente = next((v.polo_cliente for v in p.vinculos if v.status in ("automatico", "confirmado")), None)
    contraria = polos.get("passivo" if polo_cliente == "ativo" else "ativo") if polo_cliente in ("ativo", "passivo") else None
    if cliente_ids and contrato.tomador_id not in cliente_ids:
        raise ErroIntegracao("O contrato escolhido é de outro cliente.")
    numero = (db.scalar(select(func.max(Caso.numero)).where(Caso.tenant_id == p.tenant_id)) or 0) + 1
    c = Caso(tenant_id=p.tenant_id, numero=numero, contrato_id=contrato.id,
             titulo=(titulo or f"{p.classe_nome or 'Processo'} — {p.numero_formatado}")[:250],
             numero_processo=p.numero_formatado, parte_contraria=(contraria or "")[:200] or None,
             tipo=cnj.TIPO_CASO_DO_RAMO.get(trib.ramo), polo=polo_cliente if polo_cliente in ("ativo", "passivo", "terceiro") else None,
             instancia=cnj.INSTANCIA_DO_GRAU.get(p.grau), tribunal=trib.sigla, vara=(p.orgao_julgador or "")[:120] or None,
             comarca=(p.localidade_nome or "")[:80] or None, valor_causa=p.valor_causa,
             data_distribuicao=p.data_ajuizamento.date() if p.data_ajuizamento else None,
             responsavel_id=p.responsavel_interno_id or usuario.id, data_abertura=date.today())
    db.add(c)
    db.flush()
    ligar_caso(db, p, c)
    return c


def importar(db: Session, tenant_id: int, numero: str, *, usuario_id: int | None, advogado_id: int | None, origem: str = "manual",
             encontrado: Encontrado | None = None, usar_mni: bool = True) -> Processo:
    """Importa (ou reimporta) um processo: DataJud (capa + movimentos) + DJEN (partes) + MNI com certificado, se houver."""
    numero = cnj.so_digitos(numero)
    trib = tribunal_do_numero(db, numero)
    plat = plataforma(db)
    p = db.scalar(select(Processo).where(Processo.tenant_id == tenant_id, Processo.numero_cnj == numero))
    novo = p is None
    if novo:
        p = Processo(tenant_id=tenant_id, numero_cnj=numero, numero_formatado=cnj.formatar(numero), tribunal_id=trib.id,
                     origem_importacao=origem, importado_por_id=usuario_id, advogado_id=advogado_id,
                     responsavel_interno_id=advogado_id, assuntos=[], prioridades=[], graus=[], numeros_antigos=[], processos_vinculados=[])
        db.add(p)
        db.flush()
        db.refresh(p)
    dados_dj = None
    if trib.alias_datajud:
        try:
            dados_dj = fontes.datajud_buscar(plat.datajud_url, plat.datajud_chave, trib.alias_datajud, numero, plat.intervalo_datajud_ms)
        except fontes.FonteIndisponivel as e:
            p.sincronizacao_erro = str(e)[:500]
            if novo and not encontrado:
                db.delete(p)
                db.flush()
                raise ErroIntegracao(str(e)) from e
    if dados_dj:
        _aplicar_capa(db, p, dados_dj["capa"], trib)
        for m in dados_dj["movimentos"]:
            registrar_movimentacao(db, p, {**m, "lida": True}, "datajud")
        p.sincronizacao_erro = None
    elif novo and not encontrado:
        db.delete(p)
        db.flush()
        raise ErroIntegracao("O processo não foi encontrado no DataJud. Confira o número ou aguarde: processos novos levam alguns dias para aparecer.")
    if not p.sistema_instancia_id:
        s = sistema_atual(trib, p.grau)
        p.sistema_instancia_id, p.sistema_nome = (s.id, s.sistema) if s else (None, None)
    oabs: set[tuple[str, str]] = set()
    if advogado_id:
        adv = db.get(Usuario, advogado_id)
        oabs = {(o["numero"], o["uf"]) for o in oabs_do_advogado(db, adv)} if adv else set()
    if encontrado:
        d = encontrado.dados or {}
        if not p.partes and d.get("partes"):
            partes = [{"polo": x["polo"], "pessoa": {"nome": x["nome"]}} for x in d["partes"]]
            if partes and d.get("advogados"):  # o DJEN não diz quem representa quem: advogados ficam na 1ª parte do polo da conta
                partes[0]["advogados"] = [{"nome": a["nome"], "oab_numero": a["oab"], "oab_uf": a["uf"]} for a in d["advogados"]]
            substituir_partes(db, p, partes, oabs, advogado_id)
        p.classe_nome = p.classe_nome or encontrado.classe_resumo
        p.orgao_julgador = p.orgao_julgador or encontrado.orgao_resumo
        for c in d.get("comunicacoes", []):
            it = {"hash": c["hash"], "data": date.fromisoformat(c["data"]) if c.get("data") else None, "tipo": c.get("tipo"),
                  "orgao": c.get("orgao"), "texto": c.get("texto") or ""}
            quando = datetime.combine(it["data"] or date.today(), time(12, 0), tzinfo=UTC)
            registrar_movimentacao(db, p, {"data_hora": quando, "descricao": f"{it['tipo'] or 'Comunicação'} (DJEN) — {it['orgao'] or ''}\n{it['texto']}".strip(),
                                           "e_intimacao": True, "hash": f"djen:{it['hash']}", "orgao": it["orgao"], "lida": True}, "djen")
    if usar_mni and advogado_id:
        consultar_mni(db, p, advogado_id, usuario_id)
    vincular_clientes(db, p)
    ligar_caso_existente(db, p)
    p.ultima_sincronizacao = agora()
    db.flush()
    return p


def consultar_mni(db: Session, p: Processo, advogado_id: int, usuario_id: int | None, incluir_documentos: bool = False) -> bool:
    """Consulta completa com o certificado (partes com documento, movimentos, lista de documentos). False se não deu."""
    from app.modules.tribunais import adaptadores
    from app.modules.tribunais import certificado as cert_mod

    cfg = config(db, p.tenant_id)
    sist = p.sistema_instancia
    adv = db.get(Usuario, advogado_id)
    cert = certificado_ativo(db, advogado_id)
    if cfg.modo != "real" or not sist or not sist.mni_consulta or not sist.url_mni or not cert or not adv:
        return False
    try:
        cert_mod.checar(cert, "consulta", adv.cpf)
        carregado = cert_mod.abrir(cert)
        res = adaptadores.para(sist).consultar(sist, carregado, adv.cpf, p.numero_cnj, incluir_documentos)
    except (cert_mod.CertificadoNaoUtilizavel, adaptadores.NaoSuportado) as e:
        p.sincronizacao_erro = str(e)[:500]
        return False
    except (adaptadores.ErroRede, adaptadores.ErroTribunal) as e:
        cert_mod.registrar_uso(db, cert, "consulta", p.numero_cnj, "erro", tribunal_id=p.tribunal_id, usuario_id=usuario_id, detalhe=str(e))
        p.sincronizacao_erro = str(e)[:500]
        return False
    cert_mod.registrar_uso(db, cert, "consulta", p.numero_cnj, "ok", tribunal_id=p.tribunal_id, usuario_id=usuario_id)
    sist.ultima_requisicao_em = agora()
    oabs = {(o["numero"], o["uf"]) for o in oabs_do_advogado(db, adv)}
    if res.partes:
        substituir_partes(db, p, res.partes, oabs, advogado_id)
    c = res.capa
    for campo in ("competencia", "magistrado", "orgao_julgador", "orgao_julgador_codigo", "localidade_codigo"):
        if c.get(campo):
            setattr(p, campo, c[campo])
    if c.get("valor_causa"):
        try:
            p.valor_causa = Decimal(str(c["valor_causa"]))
        except InvalidOperation:
            pass
    p.prioridades = c.get("prioridades") or p.prioridades
    for m in res.movimentos:
        if m.get("data_hora"):
            registrar_movimentacao(db, p, {**m, "grau": p.grau, "lida": True}, "mni")
    from app.modules.tribunais.models import DocumentoAutos

    existentes = {d.id_documento_tribunal for d in p.documentos}
    for d in res.documentos:
        if not d.get("id") or d["id"] in existentes:
            continue
        doc = DocumentoAutos(processo_id=p.id, id_documento_tribunal=str(d["id"]), id_documento_pai=d.get("pai"),
                             tipo_documento_codigo=d.get("tipo_codigo"), tipo_documento_nome=(d.get("descricao") or "Documento")[:150],
                             descricao=d.get("descricao"), data_hora_juntada=d.get("data_hora"), mimetype=d.get("mimetype") or "application/pdf",
                             nivel_sigilo=d.get("nivel_sigilo", 0), assinantes=d.get("assinantes") or [], status_download="pendente")
        if d.get("conteudo"):
            salvar_documento(doc, p.tenant_id, d["conteudo"])
        p.documentos.append(doc)
    db.flush()
    return True


def salvar_documento(doc, tenant_id: int, conteudo: bytes) -> None:
    import io

    from pypdf import PdfReader

    doc.hash_sha256 = sha256(conteudo)
    doc.tamanho_bytes = len(conteudo)
    ext = ".pdf" if "pdf" in (doc.mimetype or "") else ".bin"
    doc.storage_ref = guardar(tenant_id, f"autos/{doc.processo_id}", f"{doc.id_documento_tribunal}{ext}", conteudo)
    if ext == ".pdf":
        try:
            leitor = PdfReader(io.BytesIO(conteudo))
            doc.paginas = len(leitor.pages)
            texto = "\n".join((pg.extract_text() or "") for pg in leitor.pages[:200])
            if texto.strip():
                doc.texto_extraido_ref = guardar(tenant_id, f"autos/{doc.processo_id}", f"{doc.id_documento_tribunal}.txt", texto.encode())
        except Exception:  # noqa: BLE001  (PDF ilegível não impede guardar o original)
            pass
    doc.status_download = "baixado"


def sincronizar(db: Session, p: Processo) -> dict:
    """Atualização periódica: DataJud (capa + movimentos novos). Novas movimentações geram um alerta para o responsável."""
    plat = plataforma(db)
    trib = p.tribunal
    if not trib.alias_datajud:
        return {"novas": 0, "mudou": False}
    try:
        dados = fontes.datajud_buscar(plat.datajud_url, plat.datajud_chave, trib.alias_datajud, p.numero_cnj, plat.intervalo_datajud_ms)
    except fontes.FonteIndisponivel as e:
        p.sincronizacao_erro = str(e)[:500]
        raise
    novas = 0
    mudou = False
    if dados:
        mudou = _aplicar_capa(db, p, dados["capa"], trib)
        for m in dados["movimentos"]:
            if registrar_movimentacao(db, p, m, "datajud"):
                novas += 1
    if novas:
        alertar(db, p.tenant_id, "movimentacao", f"{novas} nova(s) movimentação(ões) no processo {p.numero_formatado}.",
                processo_id=p.id, usuario_id=p.responsavel_interno_id)
    p.ultima_sincronizacao, p.sincronizacao_erro = agora(), None
    db.flush()
    return {"novas": novas, "mudou": mudou}


def pendentes_de_sincronizar(db: Session, horas: int = 20) -> list[Processo]:
    limite = agora() - timedelta(hours=horas)
    return list(db.scalars(select(Processo).join(ConfigTribunais, ConfigTribunais.tenant_id == Processo.tenant_id).where(
        Processo.monitorar.is_(True), ConfigTribunais.sincronizar_auto.is_(True), Processo.situacao == "ativo",
        (Processo.ultima_sincronizacao.is_(None)) | (Processo.ultima_sincronizacao < limite)).order_by(Processo.ultima_sincronizacao)))
