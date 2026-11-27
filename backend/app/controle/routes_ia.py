"""Admin MayaCorp: chaves de IA da MayaCorp e a liberação da IA em cada escritório.

As chaves (OpenAI, Gemini) ficam no banco de controle, cifradas. Liberar a IA de um escritório grava, na base dele,
o provedor, o modelo e a chave central. Trocar uma chave central atualiza as bases que usavam a chave antiga.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.controle import service
from app.controle.models import ChaveIA, SessaoControle
from app.controle.routes_admin import Painel, _cliente, _esc_do
from app.core import ia, tenancy
from app.core.db import SessionLocal
from app.core.security import cifrar, decifrar

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/ia", tags=["admin MayaCorp"])
clientes = APIRouter(prefix="/admin/clientes", tags=["admin MayaCorp"])


def _abrir(cifrada: bytes | None) -> str | None:
    if not cifrada:
        return None
    try:
        return decifrar(cifrada).decode()
    except Exception:  # noqa: BLE001 — chave cifrada com outra MASTER_KEY: trata como ausente
        return None


def _central(provedor: str) -> ChaveIA | None:
    with SessaoControle() as db:
        c = db.get(ChaveIA, provedor)
        if c is not None:
            db.expunge(c)
        return c


def _provedor(p: str) -> str:
    if p not in ia.PROVEDORES:
        raise HTTPException(404, "Provedor de IA desconhecido.")
    return p


# ---------------------------------------------------------------- chaves da MayaCorp
class ChaveIn(BaseModel):
    chave: str = Field(min_length=10, max_length=400)


@router.get("/chaves")
def listar_chaves(ctx: Painel):
    with SessaoControle() as db:
        tem = {c.provedor: c.atualizado_em for c in db.scalars(select(ChaveIA))}
    return [{"provedor": p, "nome": n, "definida": p in tem, "atualizado_em": tem.get(p)} for p, n in ia.PROVEDORES.items()]


@router.put("/chaves/{provedor}")
def salvar_chave(provedor: str, dados: ChaveIn, ctx: Painel):
    """Testa a chave no provedor (lista os modelos) antes de guardar; depois atualiza as bases que usavam a antiga."""
    p = _provedor(provedor)
    nova = dados.chave.strip()
    try:
        modelos = ia.listar_modelos(p, nova)
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e
    with SessaoControle() as db:
        c = db.get(ChaveIA, p)
        antiga = _abrir(c.chave_cifrada) if c else None
        if c is None:
            c = ChaveIA(provedor=p, chave_cifrada=cifrar(nova.encode()))
            db.add(c)
        else:
            c.chave_cifrada = cifrar(nova.encode())
        db.commit()
    atualizadas = _trocar_nas_bases(p, antiga, nova) if antiga and antiga != nova else []
    ctx.auditar("admin.ia.chave", "controle_ia", None,
                descricao=f"Chave {ia.PROVEDORES[p]} da MayaCorp salva" + (f"; bases atualizadas: {', '.join(atualizadas)}" if atualizadas else ""))
    ctx.db.commit()
    return {"provedor": p, "definida": True, "modelos": modelos[:40], "bases_atualizadas": atualizadas}


def _trocar_nas_bases(provedor: str, antiga: str, nova: str) -> list[str]:
    from app.core.models import ConfigIA

    feitas = []
    for esc in service.ativos():
        try:
            with tenancy.usando(esc), SessionLocal() as db:
                mudou = False
                for cfg in db.scalars(select(ConfigIA).where(ConfigIA.provedor == provedor)):
                    if _abrir(cfg.chave_cifrada) == antiga:
                        cfg.chave_cifrada = cifrar(nova.encode())
                        mudou = True
                if mudou:
                    db.commit()
                    feitas.append(esc.slug)
        except Exception:  # noqa: BLE001 — uma base fora do ar não impede as outras
            log.exception("Não consegui atualizar a chave de IA em %s", esc.slug)
    return feitas


@router.post("/chaves/{provedor}/importar")
def importar_chave(provedor: str, ctx: Painel):
    """Sem chave central ainda: usa a que já está ligada em algum escritório (ex.: a da CFME)."""
    from app.core.models import ConfigIA

    p = _provedor(provedor)
    if _central(p):
        raise HTTPException(400, "A MayaCorp já tem chave deste provedor.")
    for esc in service.ativos():
        try:
            with tenancy.usando(esc), SessionLocal() as db:
                cfg = db.scalar(select(ConfigIA).where(ConfigIA.provedor == p, ConfigIA.ativo.is_(True),
                                                       ConfigIA.chave_cifrada.is_not(None)))
                chave = _abrir(cfg.chave_cifrada) if cfg else None
        except Exception:  # noqa: BLE001
            continue
        if chave:
            with SessaoControle() as db:
                db.add(ChaveIA(provedor=p, chave_cifrada=cifrar(chave.encode())))
                db.commit()
            ctx.auditar("admin.ia.chave", "controle_ia", None,
                        descricao=f"Chave {ia.PROVEDORES[p]} da MayaCorp importada da base {esc.slug}")
            ctx.db.commit()
            return {"provedor": p, "definida": True, "origem": esc.slug}
    raise HTTPException(404, f"Nenhum escritório usa {ia.PROVEDORES[p]} ainda. Cole a chave.")


@router.get("/modelos/{provedor}")
def modelos(provedor: str, ctx: Painel):
    p = _provedor(provedor)
    c = _central(p)
    if c is None:
        raise HTTPException(400, f"Cadastre antes a chave da {ia.PROVEDORES[p]} em Planos e indicação.")
    try:
        return ia.listar_modelos(p, _abrir(c.chave_cifrada) or "")
    except ia.IAIndisponivel as e:
        raise HTTPException(400, str(e)) from e


# ---------------------------------------------------------------- IA de um escritório
class IAClienteIn(BaseModel):
    ativo: bool
    provedor: str | None = None
    modelo: str | None = Field(default=None, max_length=100)


def _ia_out(cfg, centrais: dict[str, str | None]) -> dict:
    if cfg is None:
        return {"ativo": False, "provedor": None, "modelo": None, "chave_mayacorp": False, "tem_chave": False}
    chave = _abrir(cfg.chave_cifrada)
    return {"ativo": bool(cfg.ativo), "provedor": cfg.provedor, "modelo": cfg.modelo, "tem_chave": bool(chave),
            "chave_mayacorp": bool(chave) and chave == centrais.get(cfg.provedor)}


def _centrais() -> dict[str, str | None]:
    with SessaoControle() as db:
        return {c.provedor: _abrir(c.chave_cifrada) for c in db.scalars(select(ChaveIA))}


@clientes.get("/{cid}/ia")
def ia_do_cliente(cid: int, ctx: Painel):
    from app.core.models import ConfigIA, Tenant

    with SessaoControle() as db:
        esc = _esc_do(_cliente(db, cid))
    with tenancy.usando(esc), SessionLocal() as db:
        tid = db.scalar(select(Tenant.id).order_by(Tenant.id))
        return _ia_out(db.get(ConfigIA, tid), _centrais())


@clientes.put("/{cid}/ia")
def liberar_ia(cid: int, dados: IAClienteIn, ctx: Painel):
    from app.core.models import ConfigIA, Tenant

    with SessaoControle() as db:
        c = _cliente(db, cid)
        esc, nome = _esc_do(c), c.nome
    cifrada = None
    if dados.ativo:
        p = _provedor(dados.provedor or "")
        if not (dados.modelo or "").strip():
            raise HTTPException(400, "Escolha o modelo da IA.")
        central = _central(p)
        if central is None:
            raise HTTPException(400, f"A MayaCorp ainda não tem chave da {ia.PROVEDORES[p]}. Cadastre em Planos e indicação.")
        cifrada = central.chave_cifrada
    with tenancy.usando(esc), SessionLocal() as db:
        tid = db.scalar(select(Tenant.id).order_by(Tenant.id))
        cfg = db.get(ConfigIA, tid)
        if cfg is None:
            cfg = ConfigIA(tenant_id=tid, ativo=False, provedor="openai")
            db.add(cfg)
        antes = {"ativo": cfg.ativo, "provedor": cfg.provedor, "modelo": cfg.modelo}
        cfg.ativo = dados.ativo
        if dados.ativo:
            cfg.provedor, cfg.modelo, cfg.chave_cifrada = dados.provedor, dados.modelo.strip(), cifrada
        db.commit()
        out = _ia_out(cfg, _centrais())
    ctx.auditar("admin.ia.cliente", "controle_cliente", cid, antes=antes,
                depois={"ativo": out["ativo"], "provedor": out["provedor"], "modelo": out["modelo"]},
                descricao=f"{nome}: IA {'liberada' if dados.ativo else 'desligada'}"
                + (f" ({ia.PROVEDORES[dados.provedor]} {dados.modelo})" if dados.ativo else ""))
    ctx.db.commit()
    return out
