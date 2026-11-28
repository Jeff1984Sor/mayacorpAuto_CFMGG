"""Caso judicial a partir do número CNJ: a ficha se preenche sozinha e, por trás, vêm andamentos e autos do tribunal."""

import re
import unicodedata
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.faturamento.models import AnexoCaso, Caso
from app.modules.tribunais import cnj, fontes, vinculo
from app.modules.tribunais import service as svc
from app.modules.tribunais.models import Processo

CAPITAIS = {"SP": "São Paulo", "RJ": "Rio de Janeiro", "MG": "Belo Horizonte", "RS": "Porto Alegre", "PR": "Curitiba",
            "BA": "Salvador", "PE": "Recife", "CE": "Fortaleza", "DF": "Brasília", "GO": "Goiânia", "SC": "Florianópolis",
            "ES": "Vitória", "PA": "Belém", "AM": "Manaus", "MT": "Cuiabá", "MS": "Campo Grande", "MA": "São Luís", "PB": "João Pessoa",
            "RN": "Natal", "AL": "Maceió", "SE": "Aracaju", "PI": "Teresina", "TO": "Palmas", "RO": "Porto Velho", "AC": "Rio Branco",
            "AP": "Macapá", "RR": "Boa Vista"}


def _chave(t: str | None) -> str:
    s = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().upper()
    return f" {' '.join(re.sub(r'[^A-Z0-9 ]', ' ', s).split())} "


def comarca_do_orgao(orgao: str | None, ufs: list[str]) -> str | None:
    """Município das UFs do tribunal citado no órgão ("5ª Vara do Trabalho de Campinas" → Campinas; "Foro Central" → capital)."""
    from app.modules.faturamento.judiciario import _municipios

    alvo = _chave(orgao)
    if not alvo.strip():
        return None
    melhor = None
    for uf in ufs:
        for cidade in _municipios().get(uf, []):
            if _chave(cidade) in alvo and (not melhor or len(cidade) > len(melhor)):
                melhor = cidade
    if not melhor and len(ufs) == 1 and re.search(r" (FORO CENTRAL|CENTRAL|CAPITAL) ", alvo):
        melhor = CAPITAIS.get(ufs[0])
    return melhor


def _ufs(trib) -> list[str]:
    if trib.uf:
        return [trib.uf]
    if trib.ramo == "federal":
        return cnj.TRF_UFS.get(int(trib.codigo_tr), [])
    return []


def capa(db: Session, tenant_id: int, numero: str, nomes_cliente: list[str] | None = None, cliente=None) -> dict:
    """Dados para preencher a ficha do caso só com o número (nada é gravado). `cliente` é o cliente do contrato.

    Além do de sempre, o que o tribunal informar dos campos do contencioso (`_detalhes`): só o que a fonte devolve."""
    numero = cnj.so_digitos(numero)
    trib = svc.tribunal_do_numero(db, numero)
    plat = svc.plataforma(db)
    proc = db.scalar(select(Processo).where(Processo.tenant_id == tenant_id, Processo.numero_cnj == numero))
    out = {"numero_cnj": numero, "numero_formatado": cnj.formatar(numero), "tribunal": trib.sigla, "tribunal_nome": trib.nome,
           "tipo": cnj.TIPO_CASO_DO_RAMO.get(trib.ramo), "instancia": None, "vara": None, "comarca": None, "classe": None,
           "assuntos": [], "data_distribuicao": None, "sistema": None, "partes": [], "polo": None, "parte_contraria": None,
           "titulo": None, "movimentos": 0, "encontrado": False, "avisos": [],
           "processo_id": proc.id if proc else None}
    dados = None
    if trib.alias_datajud:
        try:
            dados = fontes.datajud_buscar(plat.datajud_url, plat.datajud_chave, trib.alias_datajud, numero, plat.intervalo_datajud_ms)
        except fontes.FonteIndisponivel as e:
            out["avisos"].append(str(e))
    if dados:
        c = dados["capa"]
        out.update(encontrado=True, classe=c.get("classe_nome"), assuntos=[a["nome"] for a in c.get("assuntos") or []],
                   vara=(c.get("orgao_julgador") or "")[:120] or None, sistema=c.get("sistema"), movimentos=len(dados["movimentos"]),
                   data_distribuicao=c["data_ajuizamento"].date().isoformat() if c.get("data_ajuizamento") else None,
                   instancia="juizado" if c.get("grau_datajud") == "JE" else cnj.INSTANCIA_DO_GRAU.get(c.get("grau")),
                   comarca=comarca_do_orgao(c.get("orgao_julgador"), _ufs(trib)))
    comunic: list[dict] = []
    base = plat.djen_proxy_url or (plat.djen_url if settings.ambiente != "prod" else None)
    if base:
        try:
            comunic = fontes.djen_por_processo(base, numero, max_paginas=2)
        except (fontes.ForaDoBrasil, fontes.FonteIndisponivel) as e:
            out["avisos"].append(f"Partes não consultadas no DJEN: {e}")
    partes: list[dict] = []
    for it in comunic:
        partes = svc._juntar(partes, it["partes"], lambda x: (vinculo.normalizar_nome(x["nome"]), x["polo"]))
        out["classe"] = out["classe"] or it.get("classe")
        out["vara"] = out["vara"] or (it.get("orgao") or "")[:120] or None
    advogados: list[dict] = []
    for it in comunic:
        advogados = svc._juntar(advogados, it["advogados"], lambda a: (a["oab"], a["uf"], a["nome"]))
    fonte_partes = "djen" if partes else None
    if proc is not None and proc.partes:  # já importado: as partes guardadas (com documento e advogados, se vieram do MNI)
        from app.modules.faturamento import partes_tribunal

        fonte_partes = "processo_importado"
        sem_dono = partes_tribunal.fonte_das_partes(proc) == "djen"
        advogados = [{"nome": a.nome, "oab": a.oab_numero, "uf": a.oab_uf} for pa in proc.partes for a in pa.advogados] if sem_dono else []
        partes = [{"nome": pa.pessoa.nome, "polo": pa.polo, "tipo_participacao": pa.tipo_participacao,
                   "documento": pa.pessoa.cnpj or pa.pessoa.cpf, "documento_parcial": pa.pessoa.documento_parcial,
                   "assistencia_judiciaria": pa.assistencia_judiciaria,
                   "advogados": [] if sem_dono else [{"nome": a.nome, "oab": a.oab_numero, "uf": a.oab_uf} for a in pa.advogados]}
                  for pa in proc.partes]
    out["partes"] = partes
    if comunic:
        out["encontrado"] = True
        out["comarca"] = out["comarca"] or comarca_do_orgao(comunic[0].get("orgao"), _ufs(trib))
    if not out["encontrado"]:
        out["avisos"].append("Não encontrei o processo no DataJud nem no DJEN (processos novos levam alguns dias para aparecer). "
                             "Pode salvar assim mesmo: o sistema tenta de novo sozinho.")
    if nomes_cliente:
        out["polo"], out["parte_contraria"] = sugerir_polo(partes, nomes_cliente)
    resumo = svc.resumo_partes(partes)
    out["titulo"] = f"{out['classe'] or 'Processo'}{' — ' + resumo if resumo else ''}"[:250]
    _detalhes(db, tenant_id, out, trib, (dados or {}).get("capa") or {}, proc, advogados, fonte_partes, cliente)
    return out


def _detalhes(db: Session, tenant_id: int, out: dict, trib, c: dict, proc: Processo | None, advogados: list[dict],
              fonte_partes: str | None, cliente) -> None:
    """Campos novos do contencioso na capa (só leitura). `c` é a capa do DataJud; `proc`, o processo já importado.

    DataJud: classe e assuntos (código CNJ e nome), sistema, sigilo. DJEN: nome e polo das partes e a lista de advogados
    (sem dizer de quem). Juiz, valor da causa, justiça gratuita, documento e advogados de cada parte só existem quando o
    processo já foi consultado com certificado (MNI): sem isso ficam nulos."""
    from app.modules.faturamento import casos as regras_caso
    from app.modules.faturamento import partes_tribunal as pt
    from app.modules.faturamento.tipos_caso import ROTULOS
    from app.modules.pessoas import service as pessoas

    justica = regras_caso.justica_do_numero(out["numero_cnj"])
    classe_nome = c.get("classe_nome") or out["classe"]
    classe_item = pt.item_da_capa(db, tenant_id, "classe", classe_nome, criar=False)
    assuntos = c.get("assuntos") or [a for a in (proc.assuntos if proc else []) or [] if a.get("nome")]
    grau = c.get("grau") or (proc.grau if proc else None)
    out.update(
        justica=justica, justica_nome=ROTULOS["justica"].get(justica or ""),
        uf=pt.uf_do_processo(trib, c.get("localidade_codigo") or (proc.localidade_codigo if proc else None)),
        codigo_orgao=cnj.partes(out["numero_cnj"])["origem"],
        juiz_relator=(proc.magistrado if proc else None) or None,
        sistema_tribunal=pt.sistema_tribunal(c.get("sistema"), c.get("formato")),
        valor_causa=str(proc.valor_causa) if proc and proc.valor_causa is not None else None,
        segredo_justica=(c["nivel_sigilo"] > 0) if c.get("nivel_sigilo") is not None else (proc.segredo_justica if proc else None),
        justica_gratuita=proc.justica_gratuita if proc else None,
        fase_processual=pt.fase_da_classe(classe_nome, grau),
        classe_codigo=c.get("classe_codigo_cnj") or (proc.classe_codigo_cnj if proc else None),
        classe_detalhe={"codigo": c.get("classe_codigo_cnj") or (proc.classe_codigo_cnj if proc else None), "nome": classe_nome,
                        "item_id": classe_item.id if classe_item else None} if classe_nome else None,
        assuntos_detalhe=[{"codigo": a.get("codigo_cnj"), "nome": a["nome"], "principal": bool(a.get("principal")),
                           "item_id": getattr(pt.item_da_capa(db, tenant_id, "assunto", a["nome"], criar=False), "id", None)}
                          for a in assuntos if a.get("nome")],
        fonte_partes=fonte_partes)
    nome_cliente = vinculo.normalizar_nome(cliente.nome) if cliente is not None else None
    doc_cliente = re.sub(r"\D", "", cliente.cpf_cnpj or "") if cliente is not None else ""

    def advogado(a: dict) -> dict:
        achado = None
        try:
            if a.get("oab") and a.get("uf"):
                achado = pessoas.advogado_por_oab(db, tenant_id, pessoas.normalizar_oab(a["oab"]), pessoas.validar_uf(a["uf"]))
        except pessoas.RegraPessoa:
            achado = None
        return {"nome": a["nome"], "oab_numero": a.get("oab") or None, "oab_uf": a.get("uf") or None,
                "advogado_id": achado.id if achado else None}

    for p in out["partes"]:
        doc = p.get("documento")
        do_caso = bool(cliente is not None and ((doc and doc == doc_cliente) or (
            not doc and nome_cliente and vinculo.normalizar_nome(p["nome"]) == nome_cliente)))
        if do_caso and cliente.pessoa_id:
            pessoa, criterio = db.get(pt.Pessoa, cliente.pessoa_id), "documento" if doc else "nome"
        else:
            pessoa, criterio = pt.pessoa_do_cadastro(db, tenant_id, p["nome"], doc, p.get("documento_parcial"))
        p.update(tipo_participacao=p.get("tipo_participacao"), documento=doc, documento_parcial=p.get("documento_parcial"),
                 advogados=[advogado(a) for a in p.get("advogados") or []],
                 pessoa_id=pessoa.id if pessoa else None, pessoa_criterio=criterio if pessoa else None,
                 cliente_id=pessoas.clientes_de(db, [pessoa.id]).get(pessoa.id) if pessoa else None, cliente_do_caso=do_caso)
    out["advogados"] = [advogado(a) for a in advogados]
    if cliente is not None and not out["polo"]:  # o nome não bateu, mas o documento sim
        achada = next((p for p in out["partes"] if p["cliente_do_caso"] and p["polo"] in ("ativo", "passivo")), None)
        if achada:
            outro = "passivo" if achada["polo"] == "ativo" else "ativo"
            out["polo"], out["parte_contraria"] = achada["polo"], next((x["nome"] for x in out["partes"] if x["polo"] == outro), None)


def sugerir_polo(partes: list[dict], nomes_cliente: list[str]) -> tuple[str | None, str | None]:
    """(polo do cliente, parte contrária) comparando as partes com o nome do cliente do contrato."""
    nomes = {vinculo.normalizar_nome(n) for n in nomes_cliente if n}
    for p in partes:
        if vinculo.normalizar_nome(p["nome"]) in nomes and p["polo"] in ("ativo", "passivo"):
            outro = "passivo" if p["polo"] == "ativo" else "ativo"
            return p["polo"], next((x["nome"] for x in partes if x["polo"] == outro), None)
    return None, None


class _EncontradoAvulso:
    """Comunicações do DJEN de um processo no formato que service.importar() espera de um Encontrado."""

    def __init__(self, itens: list[dict]):
        partes: list[dict] = []
        advs: list[dict] = []
        for it in itens:
            partes = svc._juntar(partes, it["partes"], lambda x: (vinculo.normalizar_nome(x["nome"]), x["polo"]))
            advs = svc._juntar(advs, it["advogados"], lambda a: (a["oab"], a["uf"], a["nome"]))
        self.dados = {"partes": partes, "advogados": advs, "comunicacoes": [
            {"hash": it["hash"], "data": it["data"].isoformat() if it["data"] else None, "tipo": it["tipo"], "orgao": it["orgao"],
             "texto": it["texto"][:4000]} for it in itens]}
        self.classe_resumo = next((it["classe"] for it in itens if it.get("classe")), None)
        self.orgao_resumo = next((it["orgao"] for it in itens if it.get("orgao")), None)


def _do_djen(db: Session, numero: str) -> _EncontradoAvulso | None:
    plat = svc.plataforma(db)
    if not plat.djen_proxy_url:
        return None
    try:
        itens = fontes.djen_por_processo(plat.djen_proxy_url, numero)
    except (fontes.ForaDoBrasil, fontes.FonteIndisponivel):
        return None
    return _EncontradoAvulso(itens) if itens else None


def anexar_autos(db: Session, p: Processo) -> int:
    """Documentos dos autos já baixados aparecem na aba Anexos do caso (pasta "Autos do processo")."""
    if not p.caso_id:
        return 0
    ja = set(db.scalars(select(AnexoCaso.caminho).where(AnexoCaso.caso_id == p.caso_id)))
    n = 0
    for d in p.documentos:
        if d.storage_ref and d.storage_ref not in ja:
            db.add(AnexoCaso(caso_id=p.caso_id, nome=Path(d.storage_ref).name[:255], descricao=(d.descricao or d.tipo_documento_nome)[:300],
                             categoria="Autos do processo", caminho=d.storage_ref, tamanho=d.tamanho_bytes, mime=d.mimetype))
            n += 1
    db.flush()
    return n


def importar_para_caso(db: Session, caso: Caso) -> Processo | None:
    """Por trás da ficha: capa + movimentos (DataJud), intimações e partes (DJEN) e, com certificado, os autos."""
    from app.modules.tribunais import jobs

    numero = cnj.so_digitos(caso.numero_processo)
    if not cnj.valido(numero):
        return None
    p = db.scalar(select(Processo).where(Processo.tenant_id == caso.tenant_id, Processo.numero_cnj == numero))
    aplicado = False  # ligar_caso já traz a ficha e as partes para o caso
    if p is None:
        p = svc.importar(db, caso.tenant_id, numero, usuario_id=caso.responsavel_id, advogado_id=caso.responsavel_id, origem="manual",
                         encontrado=_do_djen(db, numero))
        aplicado = p.caso_id == caso.id
    if p.caso_id is None:
        svc.ligar_caso(db, p, caso)
        aplicado = True
    if not aplicado:  # processo que já estava no sistema (reimportação, ou outro caso com o mesmo número)
        from app.modules.faturamento import partes_tribunal

        partes_tribunal.ao_ligar(db, caso, p)
    anexar_autos(db, p)
    if svc.config(db, caso.tenant_id).modo == "real" and p.advogado_id and svc.certificado_ativo(db, p.advogado_id):
        jobs.enfileirar(db, caso.tenant_id, "baixar_documentos", p.id, tribunal_id=p.tribunal_id, criado_por_id=caso.responsavel_id)
    db.flush()
    return p
