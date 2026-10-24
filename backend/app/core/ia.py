"""Inteligência Artificial plugável: OpenAI ou Gemini, escolhidos em Configurações › Inteligência Artificial.

A chave fica cifrada no banco (mesma MASTER_KEY do certificado) e só é decifrada no momento da chamada.
Toda resposta é pedida em JSON e validada por quem chama: a IA sugere, as regras do sistema decidem.
"""

import json
import logging
from dataclasses import dataclass

import httpx
from sqlalchemy.orm import Session

from app.core.models import ConfigIA
from app.core.security import decifrar

log = logging.getLogger(__name__)

PROVEDORES = {"openai": "OpenAI", "gemini": "Google Gemini"}
TIMEOUT = 60.0


class IAIndisponivel(Exception):
    """Mensagem já pronta para o usuário."""


@dataclass
class Provedor:
    nome: str
    modelo: str
    chave: str


def config(db: Session, tenant_id: int) -> ConfigIA:
    cfg = db.get(ConfigIA, tenant_id)
    if cfg is None:
        cfg = ConfigIA(tenant_id=tenant_id, ativo=False, provedor="openai")
        db.add(cfg)
        db.flush()
    return cfg


def provedor_ativo(db: Session, tenant_id: int) -> Provedor:
    cfg = config(db, tenant_id)
    if not cfg.ativo:
        raise IAIndisponivel("A Inteligência Artificial está desligada. Ative em Configurações › Inteligência Artificial.")
    if not cfg.chave_cifrada or not cfg.modelo:
        raise IAIndisponivel("Falta a chave ou o modelo da IA em Configurações › Inteligência Artificial.")
    return Provedor(cfg.provedor, cfg.modelo, decifrar(cfg.chave_cifrada).decode())


def _erro_http(p: str, r: httpx.Response) -> IAIndisponivel:
    if r.status_code in (401, 403):
        return IAIndisponivel(f"A chave da {PROVEDORES[p]} foi recusada. Confira em Configurações › Inteligência Artificial.")
    if r.status_code == 429:
        return IAIndisponivel(f"Limite de uso da {PROVEDORES[p]} atingido (cota ou créditos). Tente mais tarde.")
    if r.status_code == 404:
        return IAIndisponivel("O modelo escolhido não existe mais neste provedor. Escolha outro em Configurações.")
    return IAIndisponivel(f"A {PROVEDORES[p]} respondeu com erro ({r.status_code}). Tente novamente.")


def listar_modelos(provedor: str, chave: str) -> list[str]:
    try:
        if provedor == "openai":
            r = httpx.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {chave}"}, timeout=20)
            if r.status_code != 200:
                raise _erro_http(provedor, r)
            ids = [m["id"] for m in r.json().get("data", [])]
            # só modelos de texto/chat (fora embeddings, áudio, imagem, moderação)
            fora = ("embedding", "whisper", "tts", "dall-e", "moderation", "audio", "realtime", "image", "transcribe", "search")
            return sorted((i for i in ids if i.startswith(("gpt", "o")) and not any(f in i for f in fora)), reverse=True)
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params={"key": chave, "pageSize": 200},
                      timeout=20)
        if r.status_code != 200:
            raise _erro_http(provedor, r)
        return sorted(
            (m["name"].removeprefix("models/") for m in r.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", []) and "gemini" in m["name"]),
            reverse=True,
        )
    except httpx.HTTPError as e:
        raise IAIndisponivel(f"Não foi possível falar com a {PROVEDORES.get(provedor, provedor)}: {e}") from e


def gerar_json(p: Provedor, sistema: str, usuario: str) -> dict:
    """Chama o provedor pedindo JSON e devolve o objeto. Erros viram IAIndisponivel com texto claro."""
    try:
        if p.nome == "openai":
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {p.chave}"},
                json={"model": p.modelo, "response_format": {"type": "json_object"},
                      "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]},
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                raise _erro_http(p.nome, r)
            texto = r.json()["choices"][0]["message"]["content"]
        else:
            r = httpx.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{p.modelo}:generateContent",
                params={"key": p.chave},
                json={"systemInstruction": {"parts": [{"text": sistema}]},
                      "contents": [{"role": "user", "parts": [{"text": usuario}]}],
                      "generationConfig": {"responseMimeType": "application/json"}},
                timeout=TIMEOUT,
            )
            if r.status_code != 200:
                raise _erro_http(p.nome, r)
            texto = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.TimeoutException as e:
        raise IAIndisponivel("A IA demorou demais para responder. Tente novamente.") from e
    except httpx.HTTPError as e:
        raise IAIndisponivel(f"Não foi possível falar com a {PROVEDORES[p.nome]}: {e}") from e
    except (KeyError, IndexError) as e:
        raise IAIndisponivel("A IA devolveu uma resposta vazia. Tente novamente.") from e
    try:
        return json.loads(texto.strip().removeprefix("```json").removesuffix("```"))
    except json.JSONDecodeError as e:
        log.warning("IA devolveu JSON inválido: %s", texto[:300])
        raise IAIndisponivel("A IA devolveu uma resposta fora do formato. Tente novamente.") from e
