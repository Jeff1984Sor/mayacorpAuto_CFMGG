"""Fontes públicas do CNJ.

- DJEN (Diário de Justiça Eletrônico Nacional, comunicaapi.pje.jus.br): comunicações/intimações pela OAB. É a base da
  varredura. Só responde a IPs do Brasil: sem proxy configurado, o navegador do usuário busca e o servidor só processa.
- DataJud (api-publica.datajud.cnj.jus.br): capa e movimentos de cada processo, pelo número. Não traz partes.
"""

import hashlib
import json
import logging
import re
import time
from datetime import UTC, date, datetime

import httpx

from app.modules.tribunais import cnj

log = logging.getLogger(__name__)
_UA = "MayaJus/1.0 (+https://mayacorp.com.br)"


class ForaDoBrasil(RuntimeError):
    """O DJEN recusou o IP do servidor (bloqueio geográfico)."""


class FonteIndisponivel(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------------------- DJEN
def djen_parametros(numero_oab: str, uf_oab: str, pagina: int, inicio: date | None, fim: date | None, itens: int = 100) -> dict:
    p = {"numeroOab": re.sub(r"\D", "", numero_oab), "ufOab": uf_oab.upper(), "pagina": pagina, "itensPorPagina": itens}
    if inicio:
        p["dataDisponibilizacaoInicio"] = inicio.isoformat()
    if fim:
        p["dataDisponibilizacaoFim"] = fim.isoformat()
    return p


def djen_buscar(base_url: str, numero_oab: str, uf_oab: str, pagina: int, inicio: date | None = None,
                fim: date | None = None, timeout: float = 30.0) -> dict:
    """Uma página de comunicações. Levanta ForaDoBrasil no bloqueio geográfico (o navegador assume)."""
    url = base_url.rstrip("/") + "/comunicacao"
    for tentativa in range(3):
        try:
            r = httpx.get(url, params=djen_parametros(numero_oab, uf_oab, pagina, inicio, fim), timeout=timeout,
                          headers={"User-Agent": _UA, "Accept": "application/json"})
        except httpx.HTTPError as e:
            raise FonteIndisponivel(f"DJEN indisponível: {e}") from e
        if r.status_code == 403 and "country" in r.text.lower():
            raise ForaDoBrasil("O DJEN só responde a acessos do Brasil.")
        if r.status_code == 429:  # limite de requisições do DJEN
            time.sleep(int(r.headers.get("Retry-After", "20")) + tentativa * 5)
            continue
        if r.status_code >= 400:
            raise FonteIndisponivel(f"DJEN respondeu HTTP {r.status_code}.")
        return r.json()
    raise FonteIndisponivel("DJEN: limite de requisições excedido. Tente de novo em alguns minutos.")


def djen_por_processo(base_url: str, numero_cnj: str, max_paginas: int = 10) -> list[dict]:
    """Todas as comunicações de um processo (já convertidas por djen_item)."""
    url = base_url.rstrip("/") + "/comunicacao"
    out: list[dict] = []
    for pagina in range(1, max_paginas + 1):
        try:
            r = httpx.get(url, params={"numeroProcesso": cnj.so_digitos(numero_cnj), "pagina": pagina, "itensPorPagina": 100},
                          timeout=30.0, headers={"User-Agent": _UA, "Accept": "application/json"})
        except httpx.HTTPError as e:
            raise FonteIndisponivel(f"DJEN indisponível: {e}") from e
        if r.status_code == 403 and "country" in r.text.lower():
            raise ForaDoBrasil("O DJEN só responde a acessos do Brasil.")
        if r.status_code >= 400:
            raise FonteIndisponivel(f"DJEN respondeu HTTP {r.status_code}.")
        dados = r.json()
        itens = dados.get("items") or []
        out += [x for x in (djen_item(i) for i in itens) if x]
        if len(itens) < 100 or pagina * 100 >= int(dados.get("count") or 0):
            break
    return out


def _polo(p: str | None) -> str:
    return {"A": "ativo", "P": "passivo"}.get((p or "").upper()[:1], "outro")


def djen_item(it: dict) -> dict | None:
    """Comunicação do DJEN → dicionário interno. Ignora itens sem número CNJ válido ou cancelados."""
    numero = cnj.so_digitos(it.get("numero_processo") or it.get("numeroprocessocommascara"))
    if not cnj.valido(numero) or it.get("data_cancelamento") or it.get("ativo") is False:
        return None
    data_txt = it.get("data_disponibilizacao") or ""
    try:
        data = date.fromisoformat(data_txt[:10])
    except ValueError:
        data = None
    advs = []
    for a in it.get("destinatarioadvogados") or []:
        adv = a.get("advogado") or {}
        if adv.get("nome"):
            advs.append({"nome": adv["nome"].strip(), "oab": re.sub(r"\D", "", str(adv.get("numero_oab") or "")),
                         "uf": (adv.get("uf_oab") or "").upper()})
    return {
        "id": it.get("id"),
        "hash": it.get("hash") or hashlib.sha256(json.dumps(it, sort_keys=True, default=str).encode()).hexdigest()[:30],
        "numero_cnj": numero,
        "tribunal": (it.get("siglaTribunal") or "").upper(),
        "orgao": it.get("nomeOrgao"),
        "classe": it.get("nomeClasse"),
        "codigo_classe": it.get("codigoClasse"),
        "tipo": it.get("tipoComunicacao") or it.get("tipoDocumento"),
        "data": data,
        "texto": (it.get("texto") or "").strip(),
        "link": it.get("link"),
        "partes": [{"nome": d["nome"].strip(), "polo": _polo(d.get("polo"))} for d in it.get("destinatarios") or [] if d.get("nome")],
        "advogados": advs,
    }


# ------------------------------------------------------------------------------------------------------- DataJud
def _data(v) -> datetime | None:
    if not v:
        return None
    s = str(v)
    try:
        if re.fullmatch(r"\d{14}", s):
            return datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=UTC)
        if re.fullmatch(r"\d{8}", s):
            return datetime.strptime(s, "%Y%m%d").replace(tzinfo=UTC)
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=UTC)
    except ValueError:
        return None


def _assuntos(lista) -> list[dict]:
    out: list[dict] = []
    for a in lista or []:
        if isinstance(a, list):  # alguns tribunais mandam listas aninhadas
            out += _assuntos(a)
        elif isinstance(a, dict) and a.get("codigo") is not None:
            out.append({"codigo_cnj": int(a["codigo"]), "nome": a.get("nome") or "", "principal": not out})
    return list({a["codigo_cnj"]: a for a in out}.values())


def hash_movimento(grau: str | None, data_hora: datetime | None, codigo, descricao: str, complementos=None) -> str:
    base = json.dumps([grau, data_hora.isoformat() if data_hora else None, codigo, descricao, complementos], sort_keys=True,
                      ensure_ascii=False, default=str)
    return hashlib.sha256(base.encode()).hexdigest()


def datajud_processo(hits: list[dict]) -> dict | None:
    """Junta os registros do DataJud (um por grau) numa capa só + todos os movimentos."""
    fontes = [h.get("_source", h) for h in hits]
    if not fontes:
        return None
    atual = max(fontes, key=lambda s: str(s.get("dataHoraUltimaAtualizacao") or ""))
    movs, vistos = [], set()
    for s in fontes:
        grau = cnj.GRAU_DATAJUD.get(str(s.get("grau") or "").upper(), "1g")
        for m in s.get("movimentos") or []:
            dh = _data(m.get("dataHora"))
            if not dh:
                continue
            comp = m.get("complementosTabelados") or None
            nome = m.get("nome") or ""
            if comp:
                nome += " (" + "; ".join(str(c.get("nome") or c.get("descricao") or "") for c in comp if c) + ")"
            h = hash_movimento(grau, dh, m.get("codigo"), nome, comp)
            if h in vistos:
                continue
            vistos.add(h)
            movs.append({"data_hora": dh, "codigo_nacional": m.get("codigo"), "descricao": nome, "complementos": comp, "grau": grau,
                         "orgao": (m.get("orgaoJulgador") or {}).get("nome"), "hash": h})
    orgao = atual.get("orgaoJulgador") or {}
    classe = atual.get("classe") or {}
    capa = {
        "numero_cnj": cnj.so_digitos(atual.get("numeroProcesso")),
        "tribunal": (atual.get("tribunal") or "").upper(),
        "grau": cnj.GRAU_DATAJUD.get(str(atual.get("grau") or "").upper(), "1g"),
        "grau_datajud": str(atual.get("grau") or "").upper(),
        "graus": sorted({cnj.GRAU_DATAJUD.get(str(s.get("grau") or "").upper(), "1g") for s in fontes}),
        "sistema": cnj.sistema_do_nome((atual.get("sistema") or {}).get("nome")),
        "classe_codigo_cnj": classe.get("codigo"),
        "classe_nome": classe.get("nome"),
        "assuntos": _assuntos(atual.get("assuntos")),
        "orgao_julgador": orgao.get("nome"),
        "orgao_julgador_codigo": str(orgao["codigo"]) if orgao.get("codigo") is not None else None,
        "localidade_codigo": str(orgao["codigoMunicipioIBGE"]) if orgao.get("codigoMunicipioIBGE") else None,
        "data_ajuizamento": _data(atual.get("dataAjuizamento")),
        "nivel_sigilo": int(atual.get("nivelSigilo") or 0),
        "formato": (atual.get("formato") or {}).get("nome"),
        "atualizado_em": _data(atual.get("dataHoraUltimaAtualizacao")),
    }
    capa["hash_dados"] = hashlib.sha256(json.dumps({k: v for k, v in capa.items() if k not in ("atualizado_em", "grau_datajud")}, sort_keys=True,
                                                   default=str).encode()).hexdigest()
    return {"capa": capa, "movimentos": sorted(movs, key=lambda m: m["data_hora"])}


_ultima_datajud = 0.0


def datajud_buscar(base_url: str, chave: str | None, alias: str, numero_cnj: str, intervalo_ms: int = 1200,
                   timeout: float = 40.0) -> dict | None:
    """Capa + movimentos pelo número (None se o DataJud não conhece o processo)."""
    global _ultima_datajud
    if not chave:
        raise FonteIndisponivel("Chave do DataJud não configurada (Configurações › Tribunais › Plataforma).")
    espera = intervalo_ms / 1000 - (time.monotonic() - _ultima_datajud)
    if espera > 0:
        time.sleep(espera)
    url = f"{base_url.rstrip('/')}/api_publica_{alias}/_search"
    corpo = {"size": 10, "query": {"match": {"numeroProcesso": cnj.so_digitos(numero_cnj)}}}
    try:
        r = httpx.post(url, json=corpo, timeout=timeout, headers={"Authorization": f"APIKey {chave}", "User-Agent": _UA})
    except httpx.HTTPError as e:
        raise FonteIndisponivel(f"DataJud indisponível: {e}") from e
    finally:
        _ultima_datajud = time.monotonic()
    if r.status_code in (401, 403):
        raise FonteIndisponivel("O DataJud recusou a chave de acesso. A chave pública do CNJ pode ter mudado.")
    if r.status_code == 404:
        raise FonteIndisponivel(f"O DataJud não tem o índice {alias}.")
    if r.status_code >= 400:
        raise FonteIndisponivel(f"DataJud respondeu HTTP {r.status_code}.")
    return datajud_processo((r.json().get("hits") or {}).get("hits") or [])
