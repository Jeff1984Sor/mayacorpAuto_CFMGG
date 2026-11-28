"""Apoio ao formulário do caso por tipo: opções das listas fixas e conferência do número CNJ.

Registrado antes das rotas do faturamento (`/casos/opcoes` e `/casos/cnj` não podem cair em `/casos/{id}`).
"""

from fastapi import APIRouter, Query

from app.core.deps import Ctx
from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento.tipos_caso import LISTAS, ROTULOS

router = APIRouter(prefix="/faturamento", tags=["Faturamento · Casos por tipo"])


@router.get("/casos/opcoes")
def opcoes(ctx: Ctx):
    """Listas fixas do sistema (valor e rótulo) e as listas que o escritório edita, para montar os formulários."""
    return {"opcoes": {campo: [{"valor": v, "rotulo": r} for v, r in itens.items()] for campo, itens in ROTULOS.items()},
            "listas": [{"lista": k, "nome": nome, "tipo_caso": tipo} for k, (nome, tipo) in LISTAS.items()]}


@router.get("/casos/cnj")
def conferir_cnj(ctx: Ctx, numero: str = Query(min_length=1, max_length=40), caso_id: int | None = None):
    """Confere o número CNJ (dígito verificador) e devolve o que ele diz: justiça, tribunal, UF, órgão e ano.
    `duplicado` aponta outro caso do escritório com o mesmo número (aviso, não bloqueia)."""
    return regras_caso.ler_cnj(ctx.db, ctx.tenant_id, numero, exceto_caso_id=caso_id)
