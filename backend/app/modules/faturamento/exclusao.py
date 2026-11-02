"""Excluir um cliente cadastrado por engano junto com tudo o que nasceu dele (contratos, casos, horas, despesas,
tarefas, anexos, revisões em aberto). Nunca apaga histórico fiscal: com nota ou fatura, o caminho é inativar."""

from pathlib import Path

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.modules.faturamento.models import (
    Andamento,
    AnexoCaso,
    Caso,
    Contrato,
    ContratoPagador,
    Despesa,
    RegraCobranca,
    Revisao,
    RevisaoItem,
    Tarefa,
    Timesheet,
)
from app.modules.rpa_nfse.models import Fatura, Nfse, ParametroFiscal, Rps, Tomador


def _contar(db: Session, modelo, *cond) -> int:
    return db.scalar(select(func.count()).select_from(modelo).where(*cond)) or 0


def dependencias(db: Session, t: Tomador) -> dict:
    """O que está ligado ao cliente e o que impede excluir (nota ou fatura = histórico fiscal)."""
    contratos = list(db.scalars(select(Contrato.id).where(Contrato.tomador_id == t.id)))
    casos = list(db.scalars(select(Caso.id).where(Caso.contrato_id.in_(contratos)))) if contratos else []
    paga_outros = list(db.scalars(
        select(Contrato.nome).join(ContratoPagador, ContratoPagador.contrato_id == Contrato.id)
        .where(ContratoPagador.tomador_id == t.id, Contrato.tomador_id != t.id)))
    d = {
        "notas": _contar(db, Nfse, Nfse.tomador_id == t.id),
        "faturas": _contar(db, Fatura, or_(Fatura.tomador_id == t.id, Fatura.contrato_id.in_(contratos or [0]))),
        "contratos": len(contratos),
        "casos": len(casos),
        "horas": _contar(db, Timesheet, Timesheet.caso_id.in_(casos or [0])),
        "despesas": _contar(db, Despesa, Despesa.caso_id.in_(casos or [0])),
        "tarefas": _contar(db, Tarefa, Tarefa.caso_id.in_(casos or [0])),
        "revisoes": _contar(db, Revisao, or_(Revisao.tomador_id == t.id, Revisao.contrato_id.in_(contratos or [0]))),
        "pagador_em": paga_outros,
    }
    if d["notas"] or d["faturas"]:
        d["bloqueio"] = (f"{t.nome} tem {d['notas']} nota(s) e {d['faturas']} fatura(s): é histórico fiscal e não pode ser "
                         "apagado. Inative o cliente para tirá-lo das listas.")
    elif paga_outros:
        d["bloqueio"] = f"{t.nome} é pagador do contrato “{paga_outros[0]}” de outro cliente: tire-o de lá antes."
    else:
        d["bloqueio"] = None
    return d


def excluir_cliente(db: Session, t: Tomador) -> list[str]:
    """Apaga o cliente e tudo o que nasceu dele (sem nota/fatura: confira `dependencias` antes). Devolve os arquivos
    a remover do disco depois do commit."""
    from app.modules.tribunais.models import Custa, Encontrado, Movimentacao, Processo, Protocolo, Vinculo

    contratos = list(db.scalars(select(Contrato.id).where(Contrato.tomador_id == t.id)))
    casos = list(db.scalars(select(Caso.id).where(Caso.contrato_id.in_(contratos)))) if contratos else []
    arquivos: list[str] = []
    if casos:
        despesas = list(db.scalars(select(Despesa).where(Despesa.caso_id.in_(casos))))
        tarefas = list(db.scalars(select(Tarefa.id).where(Tarefa.caso_id.in_(casos))))
        anexos = list(db.scalars(select(AnexoCaso).where(or_(
            AnexoCaso.caso_id.in_(casos), AnexoCaso.despesa_id.in_([d.id for d in despesas] or [0]),
            AnexoCaso.tarefa_id.in_(tarefas or [0])))))
        arquivos += [a.caminho for a in anexos] + [d.comprovante_path for d in despesas if d.comprovante_path]
        db.execute(update(Custa).where(Custa.despesa_id.in_([d.id for d in despesas] or [0])).values(despesa_id=None))
        db.execute(update(Movimentacao).where(Movimentacao.tarefa_id.in_(tarefas or [0])).values(tarefa_id=None))
        db.execute(update(Processo).where(Processo.caso_id.in_(casos)).values(caso_id=None))
        db.execute(update(Protocolo).where(Protocolo.caso_id.in_(casos)).values(caso_id=None))
        for a in anexos:
            db.delete(a)
        db.flush()
        for modelo in (Despesa, Timesheet, Tarefa, Andamento, RevisaoItem):
            db.query(modelo).filter(modelo.caso_id.in_(casos)).delete(synchronize_session=False)
        db.query(RegraCobranca).filter(RegraCobranca.caso_id.in_(casos)).delete(synchronize_session=False)
    revisoes = list(db.scalars(select(Revisao.id).where(or_(Revisao.tomador_id == t.id,
                                                            Revisao.contrato_id.in_(contratos or [0])))))
    if revisoes:
        db.query(RevisaoItem).filter(RevisaoItem.revisao_id.in_(revisoes)).delete(synchronize_session=False)
        db.query(Revisao).filter(Revisao.id.in_(revisoes)).delete(synchronize_session=False)
    if casos:
        db.query(Caso).filter(Caso.id.in_(casos)).delete(synchronize_session=False)
    if contratos:
        db.query(RegraCobranca).filter(RegraCobranca.contrato_id.in_(contratos)).delete(synchronize_session=False)
        db.query(ContratoPagador).filter(ContratoPagador.contrato_id.in_(contratos)).delete(synchronize_session=False)
        db.query(Contrato).filter(Contrato.id.in_(contratos)).delete(synchronize_session=False)
    db.query(ParametroFiscal).filter(ParametroFiscal.tomador_id == t.id).delete(synchronize_session=False)
    db.query(Vinculo).filter(Vinculo.cliente_id == t.id).delete(synchronize_session=False)
    db.execute(update(Encontrado).where(Encontrado.possivel_cliente_id == t.id).values(possivel_cliente_id=None))
    db.execute(update(Rps).where(Rps.tomador_id == t.id).values(tomador_id=None))
    db.delete(t)
    return arquivos


def apagar_arquivos(caminhos: list[str]) -> None:
    for c in caminhos:
        try:
            Path(c).unlink(missing_ok=True)
        except OSError:
            pass
