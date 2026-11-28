"""O que o tribunal informou sobre o processo vira ficha e partes do caso (só no contencioso). Ver docs/capa_do_tribunal.md.

- `preencher_ficha`: justiça, UF, órgão, juiz, sistema, segredo, gratuidade, valor da causa, classe, assuntos e fase.
  Cada campo é preenchido no máximo uma vez e só se estiver vazio (`CasoContencioso.preenchido_tribunal` guarda quais já
  foram): o que o usuário digitou, trocou ou apagou depois nunca é sobrescrito.
- `aplicar_partes`: cada parte do processo (`trb_parte`) vira parte do caso e cada advogado, Advogado + OAB + advogado
  da parte. Só inclui quem ainda não está no caso: parte que já está (mesmo desativada, movida ou com a qualificação
  trocada) não é alterada. A única exceção é o cliente que ainda não foi classificado à mão: ele vai para o polo que
  o processo diz, sem virar outra parte nem outra pessoa.
- Só entra o que a fonte devolve. O DJEN (diário) não diz quem cada advogado representa: só o advogado do próprio
  escritório é ligado (ao cliente); os outros entram no cadastro e voltam em `advogados_sem_parte`.

A migração dos casos antigos (`migrar_partes`) usa estas mesmas funções.
"""

import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento import envolvimento, listas
from app.modules.faturamento.models import Caso, Contrato
from app.modules.faturamento.tipos_caso import (
    CasoLista,
    EnvCategoria,
    Envolvimento,
    EnvolvimentoAdvogado,
    EnvQualificacao,
    ListaItem,
    TipoDeCaso,
)
from app.modules.pessoas import service as pessoas
from app.modules.pessoas.models import Advogado, AdvogadoOab
from app.modules.tribunais import cnj
from app.modules.tribunais.models import InscricaoOab, Parte, Pessoa, Processo
from app.modules.tribunais.vinculo import _parcial_bate, normalizar_nome

log = logging.getLogger(__name__)

# dois primeiros dígitos do código IBGE do município → UF
UF_DO_IBGE = {"11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI",
              "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
              "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF"}
SISTEMAS_CONHECIDOS = ("pje", "esaj", "eproc", "projudi")
# polo que o tribunal informa e que já diz o papel (MNI: FL = fiscal da lei, TJ = testemunha)
QUALIFICACAO_DO_POLO = {"fiscal_lei": "Ministério Público (fiscal da ordem jurídica)", "testemunha": "Testemunha"}
HABILITACAO_DO_REPRESENTANTE = {"defensor": "defensor_publico", "procurador": "procurador_publico"}
_RECURSOS = ("apelacao", "agravo_de_instrumento", "agravo_de_peticao", "recurso_ordinario", "recurso_inominado",
             "recurso_de_revista", "recurso_especial", "recurso_extraordinario", "remessa_necessaria")


# ------------------------------------------------------------------------------------------- o que dá para deduzir
def sistema_tribunal(sistema: str | None, formato: str | None = None) -> str | None:
    """Sistema informado pelo tribunal → opção da ficha. Sistema que o catálogo não conhece fica em branco."""
    if sistema in SISTEMAS_CONHECIDOS:
        return sistema
    return "fisico" if listas.slug(formato or "").startswith("fisico") else None


def uf_do_processo(tribunal, localidade_codigo: str | None = None) -> str | None:
    """UF do tribunal; em tribunal de várias UFs (TRF), a do município do órgão julgador, se o código for do IBGE."""
    if tribunal.uf:
        return tribunal.uf
    cod = re.sub(r"\D", "", localidade_codigo or "")
    uf = UF_DO_IBGE.get(cod[:2]) if len(cod) == 7 else None
    if uf and tribunal.ramo == "federal" and uf in cnj.TRF_UFS.get(int(tribunal.codigo_tr), []):
        return uf
    return None


def fase_da_classe(classe: str | None, grau: str | None = None) -> str | None:
    """Fase processual que a própria classe diz (cumprimento de sentença, execução, recurso no tribunal). Sem isso: None."""
    s = listas.slug(classe or "")
    if s.startswith(("cumprimento_de_sentenca", "cumprimento_provisorio_de_sentenca")):
        return "cumprimento_sentenca"
    if s.startswith("execucao_"):
        return "execucao"
    if grau in ("2g", "turma_recursal", "superior") and s.startswith(_RECURSOS):
        return "recursal"
    return None


# ------------------------------------------------------------------------------------------- listas (classe, assunto)
def item_da_capa(db: Session, tenant_id: int, lista: str, nome: str | None, criar: bool = True) -> ListaItem | None:
    """O item da lista com este nome (sem acento, qualquer caixa). Se não existir e `criar`, entra como item do escritório."""
    nome = " ".join((nome or "").split())[:150]
    alvo = listas.slug(nome)
    if not alvo:
        return None
    if criar:
        listas.garantir_seeds(db, tenant_id)  # antes de criar, para não repetir um item padrão
    itens = list(db.scalars(select(ListaItem).where(ListaItem.tenant_id == tenant_id, ListaItem.lista == lista)
                            .order_by(ListaItem.ativo.desc(), ListaItem.id)))
    achado = next((i for i in itens if listas.slug(i.nome) == alvo), None)
    if achado is not None or not criar:
        return achado
    it = ListaItem(tenant_id=tenant_id, lista=lista, nome=nome, ordem=max((i.ordem for i in itens), default=0) + 1)
    db.add(it)
    db.flush()
    return it


# ------------------------------------------------------------------------------------------- cadastro único
def pessoa_do_cadastro(db: Session, tenant_id: int, nome: str | None, documento: str | None = None,
                       documento_parcial: str | None = None, exceto: set[int] | None = None) -> tuple[Pessoa | None, str | None]:
    """(pessoa, critério) de quem já está no cadastro único: pelo CPF/CNPJ; sem documento (ou com ele mascarado), só por
    nome normalizado idêntico. Vários com o mesmo nome e documento: não escolhe (fica com o cadastro sem documento, se
    houver). Nunca por semelhança."""
    doc = re.sub(r"\D", "", documento or "")
    if len(doc) in (11, 14):
        p = pessoas.por_documento(db, tenant_id, doc)
        return (p, "documento") if p is not None else (None, None)
    alvo = normalizar_nome(nome)
    if not alvo:
        return None, None
    achadas = [p for p in db.scalars(select(Pessoa).where(
        Pessoa.tenant_id == tenant_id, Pessoa.nome_normalizado == alvo, Pessoa.mesclada_em_id.is_(None), Pessoa.ativo)
        .order_by(Pessoa.id)) if p.id not in (exceto or set())]
    if documento_parcial:
        achadas = [p for p in achadas if not pessoas.documento(p) or _parcial_bate(documento_parcial, pessoas.documento(p))]
    com = [p for p in achadas if pessoas.documento(p)]
    sem = [p for p in achadas if not pessoas.documento(p)]
    if len(com) == 1:
        return com[0], "nome"
    return (sem[0], "nome") if sem else (None, None)


def partes_do_cliente(proc: Processo, tomador) -> set[int]:
    """As partes do processo que são o cliente do caso: vínculo confirmado, a mesma pessoa, o mesmo CPF/CNPJ ou, sem
    documento, o mesmo nome (normalizado, idêntico). Vínculo que o usuário rejeitou não conta."""
    if tomador is None:
        return set()
    nome_cliente = normalizar_nome(tomador.nome)
    doc_cliente = re.sub(r"\D", "", tomador.cpf_cnpj or "")
    do_cliente = [v for v in proc.vinculos if v.cliente_id == tomador.id and v.parte_id]
    rejeitadas = {v.parte_id for v in do_cliente if v.status == "rejeitado"}
    achadas = {v.parte_id for v in do_cliente if v.status in ("automatico", "confirmado")}
    for parte in proc.partes:
        if parte.id in rejeitadas or parte.id in achadas:
            continue
        pes = parte.pessoa
        doc = pessoas.documento(pes)
        if tomador.pessoa_id and (pes.mesclada_em_id or pes.id) == tomador.pessoa_id:
            achadas.add(parte.id)
        elif doc:
            if doc == doc_cliente:
                achadas.add(parte.id)
        elif nome_cliente and normalizar_nome(pes.nome) == nome_cliente and (
                not pes.documento_parcial or not doc_cliente or _parcial_bate(pes.documento_parcial, doc_cliente)):
            achadas.add(parte.id)
    return achadas


def fonte_das_partes(proc: Processo) -> str | None:
    """mni (o tribunal disse os advogados de cada parte) ou djen (lista única de advogados, sem dizer de quem).
    Parte gravada antes de existir a coluna: é do MNI se alguma tem documento, tipo de participação ou advogado com CPF."""
    if not proc.partes:
        return None
    fonte = next((p.fonte for p in proc.partes if p.fonte), None)
    if fonte:
        return fonte
    completa = any(pessoas.documento(p.pessoa) or p.pessoa.documento_parcial or p.tipo_participacao for p in proc.partes)
    advs = [a for p in proc.partes for a in p.advogados]
    if completa or any(a.cpf or a.recebe_intimacao is not None for a in advs) or sum(1 for p in proc.partes if p.advogados) > 1:
        return "mni"
    return "djen"


def qualificacao_da_parte(db: Session, cat: EnvCategoria, texto: str | None) -> EnvQualificacao | None:
    """A qualificação da categoria com o nome do tipo de participação que o tribunal informou (Exequente, Réu...)."""
    alvo = listas.slug(texto or "")
    if not alvo:
        return None
    for q in db.scalars(select(EnvQualificacao).where(EnvQualificacao.categoria_id == cat.id, EnvQualificacao.ativo)):
        if alvo in (q.codigo, listas.slug(q.nome), listas.slug(q.nome.split("(")[0])):
            return q
    return None


def advogado_do_cadastro(db: Session, tenant_id: int, ap) -> tuple[Advogado, AdvogadoOab | None]:
    """Advogado do cadastro único para um advogado de parte de processo importado: pela OAB, pelo usuário (advogado do
    escritório), pelo CPF ou, sem OAB, pelo nome idêntico entre os advogados."""
    oab = None
    try:
        oab = (pessoas.normalizar_oab(ap.oab_numero), pessoas.validar_uf(ap.oab_uf)) if ap.oab_numero and ap.oab_uf else None
    except pessoas.RegraPessoa:
        oab = None
    adv = pessoas.advogado_por_oab(db, tenant_id, *oab) if oab else None
    if adv is None and ap.usuario_id:
        adv = db.scalar(select(Advogado).where(Advogado.tenant_id == tenant_id, Advogado.usuario_id == ap.usuario_id).limit(1))
    if adv is None:
        p = pessoas.por_documento(db, tenant_id, ap.cpf) if ap.cpf else None
        if p is None:
            nome = normalizar_nome(ap.nome)
            p = db.scalar(select(Pessoa).join(Advogado, Advogado.pessoa_id == Pessoa.id).where(
                Pessoa.tenant_id == tenant_id, Pessoa.nome_normalizado == nome, Pessoa.cpf.is_(None),
                Pessoa.mesclada_em_id.is_(None)).limit(1)) if not oab else None
        if p is None:
            p = Pessoa(tenant_id=tenant_id, tipo_pessoa="fisica", nome=ap.nome[:300], nome_normalizado=normalizar_nome(ap.nome)[:300],
                       cpf=ap.cpf if ap.cpf and len(ap.cpf) == 11 else None, telefones=[], enderecos=[], contatos=[], outros_documentos=[])
            db.add(p)
            db.flush()
        adv = db.scalar(select(Advogado).where(Advogado.pessoa_id == p.id))
        if adv is None:
            adv = Advogado(tenant_id=tenant_id, pessoa_id=p.id, eh_interno=bool(ap.usuario_id or ap.e_o_usuario))
            if ap.usuario_id and not db.scalar(select(Advogado.id).where(Advogado.usuario_id == ap.usuario_id)):
                adv.usuario_id = ap.usuario_id
            db.add(adv)
            db.flush()
    registro = next((o for o in adv.oabs if oab and (o.numero, o.uf) == oab), None)
    if oab and registro is None:
        registro = AdvogadoOab(tenant_id=tenant_id, advogado_id=adv.id, numero=oab[0], uf=oab[1], principal=not adv.oabs)
        db.add(registro)
        db.flush()
        db.refresh(adv, ["oabs"])
    return adv, registro


# ------------------------------------------------------------------------------------------- ficha
def _processo_do_caso(db: Session, caso: Caso) -> Processo | None:
    p = db.scalar(select(Processo).where(Processo.caso_id == caso.id).order_by(Processo.id).limit(1))
    numero = cnj.so_digitos(caso.numero_processo)
    if p is None and cnj.valido(numero):
        p = db.scalar(select(Processo).where(Processo.tenant_id == caso.tenant_id, Processo.numero_cnj == numero))
    return p


def preencher_ficha(db: Session, caso: Caso, proc: Processo) -> list[str]:
    """Campos do contencioso que o tribunal informou e estavam vazios. Devolve os que preencheu agora."""
    if regras_caso.tipo_caso_de(caso) != TipoDeCaso.contencioso:
        return []
    ext = regras_caso.extensao(db, caso)
    ja = list(ext.preenchido_tribunal or [])
    feitos: list[str] = []

    def por(campo: str, valor, alvo=ext, vazio=(None, "")) -> None:
        if campo in ja or valor in (None, "", False) or getattr(alvo, campo) not in vazio:
            return
        setattr(alvo, campo, valor)
        feitos.append(campo)

    trib = proc.tribunal
    contrato = db.get(Contrato, caso.contrato_id)
    do_cliente = partes_do_cliente(proc, contrato.tomador if contrato else None)
    por("justica", regras_caso.justica_do_numero(proc.numero_cnj))
    por("uf", uf_do_processo(trib, proc.localidade_codigo))
    por("codigo_orgao", cnj.partes(proc.numero_cnj)["origem"])
    por("juiz_relator", (proc.magistrado or "")[:150] or None)
    por("sistema_tribunal", sistema_tribunal(proc.sistema_nome) if proc.hash_dados else None)  # só o que o DataJud disse
    por("segredo_justica", bool(proc.segredo_justica), vazio=(None, False))
    por("justica_gratuita", bool(proc.justica_gratuita) or any(p.assistencia_judiciaria for p in proc.partes if p.id in do_cliente),
        vazio=(None, False))
    por("valor_causa", proc.valor_causa, alvo=caso)
    classe = item_da_capa(db, caso.tenant_id, "classe", proc.classe_nome) if "classe_id" not in ja and not ext.classe_id else None
    por("classe_id", classe.id if classe else None)
    assuntos = [a for a in proc.assuntos or [] if (a.get("nome") or "").strip()]
    secundarios = [x for x in caso.itens_lista if x.papel == "assunto_secundario"]
    if assuntos and "assunto_id" not in ja and not ext.assunto_id:
        principal = next((a for a in assuntos if a.get("principal")), assuntos[0])
        item = item_da_capa(db, caso.tenant_id, "assunto", principal["nome"])
        por("assunto_id", item.id if item else None)
        if item and "assuntos_secundarios" not in ja and not secundarios:
            ids = list(dict.fromkeys(i.id for i in (item_da_capa(db, caso.tenant_id, "assunto", a["nome"])
                                                    for a in assuntos if a is not principal) if i and i.id != item.id))
            if ids:
                caso.itens_lista = [*caso.itens_lista, *(CasoLista(item_id=i, papel="assunto_secundario") for i in ids)]
                feitos.append("assuntos_secundarios")
    fase = fase_da_classe(proc.classe_nome, proc.grau)
    por("fase_processual", fase, vazio=(None, "", "conhecimento"))  # "conhecimento" é o padrão de quem não escolheu
    if feitos:
        ext.preenchido_tribunal = [*ja, *feitos]
        db.flush()
    return feitos


# ------------------------------------------------------------------------------------------- partes
def _adv_linha(db: Session, adv: Advogado, oab: AdvogadoOab | None, e: Envolvimento | None = None, parte: str | None = None) -> dict:
    p = db.get(Pessoa, adv.pessoa_id)
    return {"advogado_id": adv.id, "pessoa_id": adv.pessoa_id, "nome": p.nome if p else "", "oab_numero": oab.numero if oab else None,
            "oab_uf": oab.uf if oab else None, "oab": pessoas.exibir_oab(oab.numero, oab.uf) if oab else None,
            "eh_interno": adv.eh_interno, "envolvimento_id": e.id if e else None, "parte": parte}


def aplicar_partes(db: Session, caso: Caso, proc: Processo, qualquer_tipo: bool = False) -> dict:
    """Traz para o caso as partes e os advogados do processo. Idempotente: só inclui quem ainda não está no caso."""
    tenant_id = caso.tenant_id
    tipo = regras_caso.tipo_caso_de(caso)
    fonte = fonte_das_partes(proc)
    res = {"caso_id": caso.id, "processo_id": proc.id, "numero_processo": proc.numero_formatado, "fonte": fonte, "incluidas": [],
           "ja_existiam": [], "advogados_incluidos": [], "advogados_ja_existiam": [], "advogados_sem_parte": [], "avisos": []}
    if tipo != TipoDeCaso.contencioso and not qualquer_tipo:
        res["avisos"].append("As partes do tribunal só entram em caso contencioso.")
        return res
    if not proc.partes:
        res["avisos"].append("O tribunal ainda não informou as partes deste processo.")
        return res
    envolvimento.garantir_cliente(db, caso)
    contrato = db.get(Contrato, caso.contrato_id)
    tomador = contrato.tomador if contrato else None
    do_cliente = partes_do_cliente(proc, tomador)
    pessoa_cliente = pessoas.garantir_pessoa_do_cliente(db, tomador) if tomador is not None else None
    rejeitado = {pessoa_cliente} if pessoa_cliente and any(
        v.cliente_id == tomador.id and v.status == "rejeitado" for v in proc.vinculos) else set()
    envs = sorted(db.scalars(select(Envolvimento).where(Envolvimento.caso_id == caso.id)), key=lambda e: (not e.ativo, e.id))
    gente = {p.id: p for p in db.scalars(select(Pessoa).where(Pessoa.id.in_({e.pessoa_id for e in envs} or {0})))}
    cats: dict[int, EnvCategoria] = {}
    quals: dict[int, EnvQualificacao] = {}
    clientes = pessoas.clientes_de(db, list(gente))

    def no_caso(ids: set[int], nome: str, doc: str | None) -> Envolvimento | None:
        """A parte já está no caso? A mesma pessoa ou alguém de nome idêntico sem documento diferente."""
        e = next((e for e in envs if e.pessoa_id in ids), None)
        if e is None and nome:
            e = next((e for e in envs if gente[e.pessoa_id].nome_normalizado == nome and not (
                doc and pessoas.documento(gente[e.pessoa_id]) and pessoas.documento(gente[e.pessoa_id]) != doc)), None)
        return e

    def linha(e: Envolvimento, parte: Parte, criterio: str, **extra) -> dict:
        cat = cats.get(e.categoria_id) or cats.setdefault(e.categoria_id, db.get(EnvCategoria, e.categoria_id))
        qual = (quals.get(e.qualificacao_id) or quals.setdefault(e.qualificacao_id, db.get(EnvQualificacao, e.qualificacao_id))
                ) if e.qualificacao_id else None
        p = gente[e.pessoa_id]
        return {"envolvimento_id": e.id, "pessoa_id": p.id, "nome": p.nome, "documento": pessoas.documento(p),
                "cliente_id": clientes.get(p.id), "eh_cliente": e.eh_cliente, "categoria_id": cat.id, "categoria": cat.nome,
                "polo": cat.polo, "qualificacao_id": e.qualificacao_id, "qualificacao": qual.nome if qual else None,
                "ativo": e.ativo, "polo_tribunal": parte.polo, "tipo_participacao": parte.tipo_participacao,
                "pessoa_criterio": criterio, **extra}

    def ligar_advogado(e: Envolvimento, ap, parte_nome: str) -> None:
        adv, oab = advogado_do_cadastro(db, tenant_id, ap)
        ligado = db.scalar(select(EnvolvimentoAdvogado.id).where(EnvolvimentoAdvogado.envolvimento_id == e.id,
                                                                 EnvolvimentoAdvogado.advogado_id == adv.id).limit(1))
        if ligado or adv.id in (e.advogados_do_tribunal or []):  # já está, ou já veio e o usuário retirou
            res["advogados_ja_existiam"].append({**_adv_linha(db, adv, oab, e, parte_nome), "retirado": not ligado})
            return
        db.add(EnvolvimentoAdvogado(envolvimento_id=e.id, advogado_id=adv.id, oab_id=oab.id if oab else None,
                                    principal=bool(ap.recebe_intimacao),
                                    tipo_habilitacao=HABILITACAO_DO_REPRESENTANTE.get(ap.tipo_representante)))
        e.advogados_do_tribunal = [*(e.advogados_do_tribunal or []), adv.id]
        db.flush()
        res["advogados_incluidos"].append(_adv_linha(db, adv, oab, e, parte_nome))

    for parte in proc.partes:
        pes = parte.pessoa
        if pes.mesclada_em_id:
            pes = db.get(Pessoa, pes.mesclada_em_id) or pes
        doc = pessoas.documento(pes)
        nome = pes.nome_normalizado or normalizar_nome(pes.nome)
        eh_cliente = parte.id in do_cliente and pessoa_cliente is not None
        if eh_cliente:
            alvo, criterio = db.get(Pessoa, pessoa_cliente), "cliente"
        else:
            alvo, criterio = pessoa_do_cadastro(db, tenant_id, pes.nome, doc, pes.documento_parcial, exceto=rejeitado)
            alvo, criterio = alvo or pes, criterio or ("documento" if doc else "nome")
        cat = envolvimento.categoria_do_polo(db, tenant_id, tipo, parte.polo if parte.polo in ("ativo", "passivo", "terceiro") else "neutro")
        cats[cat.id] = cat
        qual = qualificacao_da_parte(db, cat, parte.tipo_participacao) or qualificacao_da_parte(db, cat, QUALIFICACAO_DO_POLO.get(parte.polo))
        e = no_caso({alvo.id} if eh_cliente else {alvo.id, pes.id}, "" if eh_cliente else nome, doc)
        if e is None:
            e = Envolvimento(tenant_id=tenant_id, caso_id=caso.id, pessoa_id=alvo.id, categoria_id=cat.id,
                             qualificacao_id=qual.id if qual else None, eh_cliente=eh_cliente, ordem=parte.ordem,
                             principal=not envolvimento._tem_principal(db, caso.id, cat.id), data_inclusao=caso.data_abertura)
            db.add(e)
            db.flush()
            envs.append(e)
            gente[alvo.id] = alvo
            if alvo.id not in clientes:
                clientes.update(pessoas.clientes_de(db, [alvo.id]))
            res["incluidas"].append(linha(e, parte, criterio))
        else:
            mudou = saiu_de_pendente = False
            # o cliente que ninguém classificou à mão recebe o polo e a qualificação que o processo diz
            if eh_cliente and e.eh_cliente and e.ativo and e.qualificacao_id is None and (
                    e.pendente_reclassificacao or e.categoria_id == cat.id):
                mudou = e.pendente_reclassificacao or e.categoria_id != cat.id or qual is not None
                saiu_de_pendente = e.pendente_reclassificacao
                if e.pendente_reclassificacao:
                    e.principal = not envolvimento._tem_principal(db, caso.id, cat.id, exceto=e.id)
                e.categoria_id, e.qualificacao_id, e.pendente_reclassificacao = cat.id, (qual.id if qual else None), False
                db.flush()
            res["ja_existiam"].append(linha(e, parte, criterio, atualizada=bool(mudou), saiu_de_pendente=bool(saiu_de_pendente)))
        if fonte != "djen" and e.ativo:
            for ap in parte.advogados:
                ligar_advogado(e, ap, gente[e.pessoa_id].nome)
    if fonte == "djen":
        _advogados_do_diario(db, caso, proc, envs, pessoa_cliente, gente, res, ligar_advogado)
    db.flush()
    envolvimento.sincronizar_polo(db, caso)
    return res


def _advogados_do_diario(db: Session, caso: Caso, proc: Processo, envs, pessoa_cliente, gente, res: dict, ligar_advogado) -> None:
    """O DJEN traz uma lista só de advogados, sem dizer de quem: o do escritório é o do cliente; os outros ficam no
    cadastro, sem parte, para o usuário ligar."""
    cliente = next((e for e in envs if e.ativo and e.eh_cliente and e.pessoa_id == pessoa_cliente), None) \
        or next((e for e in envs if e.ativo and e.eh_cliente), None)
    ids_envs = {e.id for e in envs}
    da_casa = {(re.sub(r"\D", "", n), uf.upper()): u for n, uf, u in db.execute(
        select(InscricaoOab.numero, InscricaoOab.uf, InscricaoOab.usuario_id).where(InscricaoOab.tenant_id == caso.tenant_id))}
    for ap in (a for parte in proc.partes for a in parte.advogados):
        adv, oab = advogado_do_cadastro(db, caso.tenant_id, ap)
        usuario_id = da_casa.get((re.sub(r"\D", "", ap.oab_numero or ""), (ap.oab_uf or "").upper()))
        if usuario_id and not adv.eh_interno:  # a OAB é de um profissional do escritório
            adv.eh_interno = True
            if not adv.usuario_id and not db.scalar(select(Advogado.id).where(Advogado.usuario_id == usuario_id)):
                adv.usuario_id = usuario_id
        if (ap.e_o_usuario or ap.usuario_id or adv.eh_interno) and cliente is not None:
            ligar_advogado(cliente, ap, gente[cliente.pessoa_id].nome)
            continue
        ligado = db.scalar(select(EnvolvimentoAdvogado.envolvimento_id).where(
            EnvolvimentoAdvogado.advogado_id == adv.id, EnvolvimentoAdvogado.envolvimento_id.in_(ids_envs or {0})).limit(1))
        if ligado:
            e = next(x for x in envs if x.id == ligado)
            res["advogados_ja_existiam"].append({**_adv_linha(db, adv, oab, e, gente[e.pessoa_id].nome), "retirado": False})
        else:
            res["advogados_sem_parte"].append(_adv_linha(db, adv, oab))
    if res["advogados_sem_parte"]:
        res["avisos"].append("O diário (DJEN) não informa quem cada advogado representa: os advogados que não são do "
                             "escritório entraram no cadastro sem parte. Ligue cada um à parte dele na aba Partes.")


def do_processo(db: Session, caso: Caso, proc: Processo) -> dict | None:
    """Processo ligado a um caso (importação, criação pelo processo, sincronização): ficha + partes. Só no contencioso
    e só com a busca no tribunal ligada no caso."""
    if regras_caso.tipo_caso_de(caso) != TipoDeCaso.contencioso or not regras_caso.monitora(db, caso):
        return None
    campos = preencher_ficha(db, caso, proc)
    return {**aplicar_partes(db, caso, proc), "campos_preenchidos": campos}


def ao_ligar(db: Session, caso: Caso, proc: Processo) -> dict | None:
    """`do_processo` para as importações automáticas: um problema com as partes não derruba a importação do processo
    (andamentos e autos seguem); fica no log e o botão "Trazer partes do tribunal" mostra o erro."""
    try:
        with db.begin_nested():
            return do_processo(db, caso, proc)
    except Exception:  # noqa: BLE001
        log.exception("Partes do tribunal não aplicadas (caso %s, processo %s)", caso.id, proc.numero_formatado)
        return None


def trazer_do_tribunal(db: Session, caso: Caso, usuario_id: int | None = None) -> dict:
    """Botão "Trazer partes do tribunal": aplica as partes do processo do caso. Sem processo importado (ou sem partes)
    e com a busca ligada no caso, importa antes. Levanta `tribunais.service.ErroIntegracao` com a mensagem para a tela."""
    from app.modules.tribunais import caso as caso_mod
    from app.modules.tribunais import service as svc

    if regras_caso.tipo_caso_de(caso) != TipoDeCaso.contencioso:
        raise svc.ErroIntegracao("As partes do tribunal só entram em caso contencioso.")
    numero = cnj.so_digitos(caso.numero_processo)
    proc = _processo_do_caso(db, caso)
    # a importação já aplica as partes por dentro: o retrato de antes separa o que entrou agora do que já existia
    envs_antes = set(db.scalars(select(Envolvimento.id).where(Envolvimento.caso_id == caso.id)))
    advs_antes = {tuple(x) for x in db.execute(
        select(EnvolvimentoAdvogado.envolvimento_id, EnvolvimentoAdvogado.advogado_id)
        .join(Envolvimento, Envolvimento.id == EnvolvimentoAdvogado.envolvimento_id).where(Envolvimento.caso_id == caso.id))}
    ext = regras_caso.extensao(db, caso)
    campos_antes = set(ext.preenchido_tribunal or [])
    if (proc is None or not proc.partes) and regras_caso.monitora(db, caso):
        if not cnj.valido(numero):
            raise svc.ErroIntegracao("Informe o número do processo (CNJ) no caso para trazer as partes do tribunal.")
        if proc is None:
            proc = caso_mod.importar_para_caso(db, caso)
        else:
            svc.importar(db, caso.tenant_id, numero, usuario_id=usuario_id, advogado_id=proc.advogado_id, origem=proc.origem_importacao,
                         encontrado=caso_mod._do_djen(db, numero))
    if proc is None:
        raise svc.ErroIntegracao("Este caso não tem processo importado do tribunal e a busca de andamentos está desligada nele. "
                                 "Ligue a busca na ficha do caso para trazer as partes.")
    if proc.caso_id is None:
        svc.ligar_caso(db, proc, caso)
    if regras_caso.monitora(db, caso):
        preencher_ficha(db, caso, proc)
    res = aplicar_partes(db, caso, proc)
    for novas, antigas, nova in (("incluidas", "ja_existiam", lambda x: x["envolvimento_id"] not in envs_antes),
                                 ("advogados_incluidos", "advogados_ja_existiam",
                                  lambda x: not x.get("retirado") and (x["envolvimento_id"], x["advogado_id"]) not in advs_antes)):
        res[novas] += [x for x in res[antigas] if nova(x)]
        res[antigas] = [x for x in res[antigas] if not nova(x)]
    res["campos_preenchidos"] = [c for c in ext.preenchido_tribunal or [] if c not in campos_antes]
    return res

