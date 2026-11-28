"""Migração dos dados antigos para os tipos de caso e o cadastro único de partes (idempotente: pode rodar de novo).

    uv run python -m app.modules.faturamento.migrar_partes [--dry-run] [--escritorio <slug>]

Em cada escritório (um banco por escritório, como o worker percorre):
1. Tipo: caso sem tipo de caso é classificado (tipo antigo judicial ou número de processo → contencioso; tipo antigo
   administrativo → administrativo; o resto → consultivo) e ganha a extensão do tipo.
2. Clientes: todo cliente ganha a sua Pessoa (uma por cliente; com o mesmo CPF/CNPJ já no cadastro, é ligado a ela) e
   entra em cada caso seu como parte "é cliente".
3. Processo importado do tribunal ligado ao caso: as partes viram partes do caso e os advogados, advogados da parte.
4. Parte contrária em texto: vira Pessoa sem documento (uma por nome idêntico) no polo oposto ao do cliente; sem polo
   conhecido, vai para Outros como "pendente de reclassificação". Nome igual ao de um cliente não é fundido sozinho.
Nada é apagado: `parte_contraria`, `polo` e `tipo` continuam nas tabelas.

Os CSV de revisão têm dados de clientes: ficam na pasta de arquivos do escritório (`migracao_partes/`), nunca no
repositório. O administrador baixa em /api/faturamento/migracao-partes. Com --dry-run nada é gravado no banco e os
arquivos saem com o sufixo `_simulacao`.
"""

import argparse
import csv
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import tenancy
from app.core.models import Tenant
from app.modules.faturamento import casos as regras_caso
from app.modules.faturamento import envolvimento, partes_tribunal, seeds_caso
from app.modules.faturamento.models import Caso, Contrato
from app.modules.faturamento.tipos_caso import ROTULOS, EnvCategoria, Envolvimento
from app.modules.pessoas import service as pessoas
from app.modules.rpa_nfse.models import Tomador
from app.modules.tribunais.models import Pessoa, Processo
from app.modules.tribunais.vinculo import normalizar_nome

PASTA = "migracao_partes"
ARQ_TIPOS, ARQ_PARTES = "migracao_tipo_caso", "migracao_partes_relatorio"
CAB_TIPOS = ["caso", "titulo", "cliente", "tipo_antigo", "numero_processo", "tipo_caso", "motivo"]
CAB_PARTES = ["linha", "pessoa_id", "pessoa", "documento", "cliente_id", "caso", "caso_titulo", "categoria", "qualificacao",
              "observacao"]


@dataclass
class Resultado:
    tipos: list[dict] = field(default_factory=list)
    partes: list[dict] = field(default_factory=list)
    numeros: Counter = field(default_factory=Counter)
    arquivos: list[Path] = field(default_factory=list)

    def parte(self, linha: str, p: Pessoa | None = None, c: Caso | None = None, **extra) -> None:
        self.numeros[linha] += 1
        self.partes.append({"linha": linha, "pessoa_id": p.id if p else "", "pessoa": p.nome if p else "",
                            "documento": pessoas.documento(p) or "" if p else "", "cliente_id": "", "caso": c.numero if c else "",
                            "caso_titulo": c.titulo if c else "", "categoria": "", "qualificacao": "", "observacao": "", **extra})


def pasta_dos_relatorios() -> Path:
    return tenancy.pasta_base() / PASTA


def _gravar(nome: str, cabecalho: list[str], linhas: list[dict], simulacao: bool) -> Path | None:
    if not linhas:  # rodar de novo sem nada a fazer não apaga o relatório da primeira vez
        return None
    pasta = pasta_dos_relatorios()
    pasta.mkdir(parents=True, exist_ok=True)
    arq = pasta / f"{nome}{'_simulacao' if simulacao else ''}.csv"
    with arq.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cabecalho, delimiter=";", extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)
    return arq


# ------------------------------------------------------------------------------------------------ passos
def _tipos_e_clientes(db: Session, tenant_id: int, r: Resultado) -> None:
    """Passos 1 e 2: classifica, garante a extensão e põe o cliente como parte de cada caso."""
    for t in db.scalars(select(Tomador).where(Tomador.tenant_id == tenant_id).order_by(Tomador.id)):
        if not t.pessoa_id:
            antes = pessoas.por_documento(db, tenant_id, t.cpf_cnpj)
            pessoas.garantir_pessoa_do_cliente(db, t)
            p = db.get(Pessoa, t.pessoa_id)
            r.parte("cliente_ligado" if antes is not None and antes.id == p.id else "pessoa_criada", p, cliente_id=t.id,
                    observacao="Cliente ligado à pessoa que já tinha o mesmo CPF/CNPJ" if antes is not None and antes.id == p.id
                    else "Pessoa do cliente")
    for c in db.scalars(select(Caso).where(Caso.tenant_id == tenant_id).order_by(Caso.numero)):
        contrato = db.get(Contrato, c.contrato_id)
        tinha_cliente = db.scalar(select(Envolvimento.id).where(Envolvimento.caso_id == c.id, Envolvimento.eh_cliente).limit(1))
        if not c.tipo_caso:
            tipo_antigo, tem_numero = c.tipo, bool((c.numero_processo or "").strip())
            if tipo_antigo and tipo_antigo.value.startswith("judicial"):
                motivo = "Tipo antigo judicial"
            elif tipo_antigo:
                motivo = f"Tipo antigo {tipo_antigo.value}"
            else:
                motivo = "Tem número de processo" if tem_numero else "Sem tipo e sem número de processo"
            regras_caso.ao_criar(db, c)
            r.numeros[f"tipo_{c.tipo_caso}"] += 1
            r.tipos.append({"caso": c.numero, "titulo": c.titulo, "cliente": contrato.tomador.nome if contrato and contrato.tomador else "",
                            "tipo_antigo": tipo_antigo.value if tipo_antigo else "", "numero_processo": c.numero_processo or "",
                            "tipo_caso": ROTULOS["tipo_caso"][c.tipo_caso], "motivo": motivo})
        else:
            regras_caso.ao_criar(db, c)  # garante a extensão e o cliente entre as partes
        if not tinha_cliente:
            e = db.scalar(select(Envolvimento).where(Envolvimento.caso_id == c.id, Envolvimento.eh_cliente).limit(1))
            if e:
                cat = db.get(EnvCategoria, e.categoria_id)
                r.parte("envolvimento", db.get(Pessoa, e.pessoa_id), c, cliente_id=contrato.tomador_id, categoria=cat.nome,
                        observacao="Cliente do caso" + (" (polo a confirmar)" if e.pendente_reclassificacao else ""))
                if e.pendente_reclassificacao:
                    r.numeros["pendencia"] += 1
    db.flush()


def _processos(db: Session, tenant_id: int, r: Resultado) -> None:
    """Passo 3: partes e advogados dos processos importados que estão ligados a um caso (a mesma regra do botão
    "Trazer partes do tribunal": `partes_tribunal.aplicar_partes`)."""
    for proc in db.scalars(select(Processo).where(Processo.tenant_id == tenant_id, Processo.caso_id.is_not(None))):
        c = db.get(Caso, proc.caso_id)
        if c is None or c.tenant_id != tenant_id:
            continue
        res = partes_tribunal.aplicar_partes(db, c, proc, qualquer_tipo=True)
        for x in res["incluidas"]:
            r.parte("envolvimento", db.get(Pessoa, x["pessoa_id"]), c, categoria=x["categoria"], qualificacao=x["qualificacao"] or "",
                    observacao=f"Do processo {proc.numero_formatado}" + (" · cliente" if x["eh_cliente"] else ""))
        r.numeros["pendencia"] -= sum(1 for x in res["ja_existiam"] if x.get("saiu_de_pendente"))
        r.numeros["advogado_da_parte"] += len(res["advogados_incluidos"])


def _parte_contraria(db: Session, tenant_id: int, r: Resultado) -> None:
    """Passo 4: a parte contrária em texto livre vira Pessoa sem documento e parte do caso."""
    sem_doc: dict[str, Pessoa] = {}
    de_cliente = set(db.scalars(select(Tomador.pessoa_id).where(Tomador.tenant_id == tenant_id, Tomador.pessoa_id.is_not(None))))
    avisados: set[tuple[int, int]] = set()
    for c in db.scalars(select(Caso).where(Caso.tenant_id == tenant_id, Caso.parte_contraria.is_not(None)).order_by(Caso.numero)):
        texto = (c.parte_contraria or "").strip()
        nome = normalizar_nome(texto)
        if not nome:
            continue
        ja = db.execute(select(Envolvimento.id).join(Pessoa, Pessoa.id == Envolvimento.pessoa_id).where(
            Envolvimento.caso_id == c.id, Pessoa.nome_normalizado == nome, Envolvimento.eh_cliente.is_(False)).limit(1)).first()
        if ja:
            continue
        p = sem_doc.get(nome)
        if p is None:
            homonimos = list(db.scalars(select(Pessoa).where(Pessoa.tenant_id == tenant_id, Pessoa.nome_normalizado == nome,
                                                             Pessoa.mesclada_em_id.is_(None)).order_by(Pessoa.id)))
            p = next((h for h in homonimos if not h.cpf and not h.cnpj and h.id not in de_cliente), None)
            if p is None:
                p = Pessoa(tenant_id=tenant_id, tipo_pessoa="sem_documento", nome=texto[:300], nome_normalizado=nome[:300],
                           telefones=[], enderecos=[], contatos=[], outros_documentos=[])
                db.add(p)
                db.flush()
                r.parte("pessoa_criada", p, c, observacao="Parte contrária em texto (sem documento)")
            sem_doc[nome] = p
            clientes = pessoas.clientes_de(db, [h.id for h in homonimos])
            for h in homonimos:  # mesmo nome com documento ou de cliente: não funde sozinho, só avisa
                if h.id != p.id and (p.id, h.id) not in avisados:
                    avisados.add((p.id, h.id))
                    r.parte("possivel_duplicado", p, c, cliente_id=clientes.get(h.id, ""),
                            observacao=f"Mesmo nome de {h.nome} (pessoa nº {h.id}"
                                       + (f", cliente nº {clientes[h.id]}" if h.id in clientes else "")
                                       + "): confira e mescle se for a mesma")
        tipo = regras_caso.tipo_caso_de(c)
        if tipo != "contencioso":
            polo, pendente = "passivo", False  # o cliente é sempre o lado ativo
        elif c.polo in ("ativo", "passivo"):
            polo, pendente = ("passivo" if c.polo == "ativo" else "ativo"), False
        else:
            polo, pendente = "neutro", True
        cat = envolvimento.categoria_do_polo(db, tenant_id, tipo, polo)
        db.add(Envolvimento(tenant_id=tenant_id, caso_id=c.id, pessoa_id=p.id, categoria_id=cat.id, data_inclusao=c.data_abertura,
                            principal=not pendente and not envolvimento._tem_principal(db, c.id, cat.id),
                            pendente_reclassificacao=pendente))
        db.flush()
        r.parte("envolvimento", p, c, categoria=cat.nome,
                observacao="Parte contrária em texto" + (" · polo do cliente desconhecido: pendente de reclassificação" if pendente else ""))
        if pendente:
            r.numeros["pendencia"] += 1


def migrar(db: Session, tenant_id: int, dry_run: bool = False) -> Resultado:
    """Roda a migração de um escritório nesta sessão. Com dry_run, desfaz tudo no fim (os CSV de simulação ficam)."""
    r = Resultado()
    seeds_caso.garantir(db, tenant_id)
    _tipos_e_clientes(db, tenant_id, r)
    _processos(db, tenant_id, r)
    _parte_contraria(db, tenant_id, r)
    r.arquivos = [a for a in (_gravar(ARQ_TIPOS, CAB_TIPOS, r.tipos, dry_run), _gravar(ARQ_PARTES, CAB_PARTES, r.partes, dry_run)) if a]
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return r


# ------------------------------------------------------------------------------------------------ terminal
def _escritorios(slug_pedido: str | None) -> list:
    """Um banco só: [None]. Um banco por escritório: os ativos do controle (ou só o pedido)."""
    if not tenancy.multi():
        return [None]
    from app.controle import service as controle

    if slug_pedido:
        esc = controle.por_slug(slug_pedido)
        if esc is None:
            raise SystemExit(f"Escritório {slug_pedido} não encontrado (ou inativo).")
        return [esc]
    return controle.ativos()


def main() -> None:
    from app.core.db import SessionLocal

    ap = argparse.ArgumentParser(prog="app.modules.faturamento.migrar_partes", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="mostra o que faria, sem gravar no banco")
    ap.add_argument("--escritorio", help="só este escritório (slug)")
    a = ap.parse_args()
    feito = False
    for esc in _escritorios(a.escritorio):
        with tenancy.usando(esc), SessionLocal() as db:
            sel = select(Tenant).order_by(Tenant.id)
            if a.escritorio and esc is None:
                sel = sel.where(Tenant.slug == a.escritorio)
            for t in db.scalars(sel).all():
                r = migrar(db, t.id, dry_run=a.dry_run)
                feito = True
                n = r.numeros
                print(f"[{esc.slug if esc else t.slug}] {'SIMULAÇÃO: ' if a.dry_run else ''}"
                      f"casos classificados: {len(r.tipos)} (contencioso {n['tipo_contencioso']}, consultivo {n['tipo_consultivo']}, "
                      f"administrativo {n['tipo_administrativo']}) · pessoas criadas: {n['pessoa_criada']} · clientes ligados a pessoa "
                      f"existente: {n['cliente_ligado']} · partes incluídas: {n['envolvimento']} · advogados de parte: "
                      f"{n['advogado_da_parte']} · possíveis duplicados: {n['possivel_duplicado']} · pendências: {n['pendencia']}")
                for arq in r.arquivos:
                    print(f"    relatório: {arq}")
    if not feito:
        print("Nenhum escritório encontrado.")


if __name__ == "__main__":
    main()
