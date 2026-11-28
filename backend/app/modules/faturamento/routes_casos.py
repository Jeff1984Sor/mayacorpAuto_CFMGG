"""Apoio ao formulário do caso por tipo: opções das listas fixas e conferência do número CNJ.

Registrado antes das rotas do faturamento (`/casos/opcoes` e `/casos/cnj` não podem cair em `/casos/{id}`).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.deps import Ctx, Operador
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


@router.post("/casos/{cid}/partes-do-tribunal")
def partes_do_tribunal(cid: int, ctx: Operador):
    """Chamada sozinha pela ficha do caso que nunca recebeu partes do tribunal (`CasoOut.buscar_partes_tribunal`; não há
    botão): as partes e os advogados do processo do caso viram partes do caso.
    Só inclui quem ainda não está no caso; devolve o que incluiu (`incluidas`, `advogados_incluidos`), o que já existia
    (`ja_existiam`, `advogados_ja_existiam`) e os advogados que o tribunal não disse de quem são (`advogados_sem_parte`)."""
    from app.modules.faturamento import partes_tribunal
    from app.modules.faturamento.models import Caso
    from app.modules.tribunais import fontes
    from app.modules.tribunais import service as tribunais

    c = ctx.db.get(Caso, cid)
    if not c or c.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Caso não encontrado.")
    regras_caso.exigir_ver(ctx, c)
    try:
        res = partes_tribunal.trazer_do_tribunal(ctx.db, c, usuario_id=ctx.usuario.id)
    except (tribunais.ErroIntegracao, fontes.FonteIndisponivel, fontes.ForaDoBrasil) as e:
        ctx.db.rollback()
        # a ficha chama esta rota sozinha: fica anotado que tentou, para não repetir a cada abertura
        partes_tribunal.marcar_tentativa(ctx.db, ctx.db.get(Caso, cid))
        ctx.db.commit()
        # falha de comunicação vem com detalhe técnico: para a tela vai a frase simples
        sem_resposta = isinstance(e, fontes.FonteIndisponivel) or isinstance(e.__cause__, fontes.FonteIndisponivel)
        raise HTTPException(400, "O tribunal não respondeu." if sem_resposta else str(e)) from e
    partes_tribunal.marcar_tentativa(ctx.db, c)
    if res["incluidas"] or res["advogados_incluidos"] or res["campos_preenchidos"]:
        ctx.auditar("faturamento.caso.partes_do_tribunal", "fat_caso", c.id,
                    descricao=f"#{c.numero}: {len(res['incluidas'])} parte(s) e {len(res['advogados_incluidos'])} advogado(s) do "
                              f"processo {res['numero_processo']}")
    ctx.db.commit()
    return res


# ------------------------------------------------------------------------------------------- relatórios da migração
def _so_administrador(ctx) -> None:
    if not ctx.usuario.administrador:
        raise HTTPException(403, "Só o administrador pode baixar os relatórios da migração.")


@router.get("/migracao-partes")
def relatorios_da_migracao(ctx: Ctx):
    """CSV de revisão gerados pela migração dos casos e das partes (`migrar_partes`). Só administrador."""
    from app.modules.faturamento.migrar_partes import pasta_dos_relatorios

    _so_administrador(ctx)
    pasta = pasta_dos_relatorios()
    arquivos = sorted(pasta.glob("*.csv")) if pasta.exists() else []
    return [{"nome": a.name, "tamanho": a.stat().st_size, "simulacao": a.stem.endswith("_simulacao"),
             "gerado_em": datetime.fromtimestamp(a.stat().st_mtime, UTC).isoformat()} for a in arquivos]


@router.get("/migracao-partes/{nome}")
def baixar_relatorio_da_migracao(nome: str, ctx: Ctx):
    from app.modules.faturamento.migrar_partes import pasta_dos_relatorios

    _so_administrador(ctx)
    pasta = pasta_dos_relatorios()
    arq = pasta / nome
    if "/" in nome or "\\" in nome or not nome.endswith(".csv") or arq.parent != pasta or not arq.is_file():
        raise HTTPException(404, "Relatório não encontrado.")
    ctx.auditar("faturamento.migracao.baixar", "fat_caso", descricao=nome)
    ctx.db.commit()
    return FileResponse(arq, filename=nome, media_type="text/csv")
