"""Fila da integração (seção 14), no próprio banco como a fila da NFS-e: sobrevive a reinício do worker.

Prioridade: protocolo > verificação > aviso por e-mail > varredura > importação > sincronização > download.
Backoff exponencial; protocolo nunca é repetido automaticamente. Intervalo mínimo e janela de horário por tribunal (regra 10).
"""

import logging
import time as _time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal, agora
from app.modules.tribunais.models import CertificadoAdvogado, Encontrado, Job, Sistema, Tribunal, Varredura

log = logging.getLogger(__name__)

PRIORIDADE = {"protocolar": 100, "verificar_protocolo": 90, "notificar": 80, "varredura": 60, "importar_processo": 50,
              "sincronizar": 40, "baixar_documentos": 20, "health_check": 5}
FALAM_COM_TRIBUNAL = {"protocolar", "verificar_protocolo", "baixar_documentos"}  # usam o sistema do tribunal (rate limit)
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tribunais")
_ultimo_por_tribunal: dict[int, float] = {}


def enfileirar(db: Session, tenant_id: int, tipo: str, referencia_id: int, *, tribunal_id: int | None = None, payload: dict | None = None,
               quando: datetime | None = None, criado_por_id: int | None = None, max_tentativas: int = 5,
               prioridade: int | None = None) -> Job:
    existente = db.scalar(select(Job).where(Job.tenant_id == tenant_id, Job.tipo == tipo, Job.referencia_id == referencia_id,
                                            Job.status.in_(("fila", "rodando", "reprocessar"))))
    if existente:
        return existente
    j = Job(tenant_id=tenant_id, tipo=tipo, referencia_id=referencia_id, tribunal_id=tribunal_id, payload=payload or {},
            prioridade=prioridade or PRIORIDADE.get(tipo, 30), proxima_tentativa_em=quando, criado_por_id=criado_por_id,
            max_tentativas=max_tentativas)
    db.add(j)
    db.flush()
    return j


def disparar() -> None:
    """Dev: a API processa a fila numa thread. Produção: o serviço worker chama rodar_fila()."""
    if settings.worker_embutido:
        _pool.submit(rodar_fila)


def _fora_da_janela(s: Sistema | None, agora_local: datetime) -> datetime | None:
    if not s or not s.janela_inicio or not s.janela_fim:
        return None
    hm = agora_local.strftime("%H:%M")
    if s.janela_inicio <= hm <= s.janela_fim:
        return None
    h, m = map(int, s.janela_inicio.split(":"))
    prox = agora_local.replace(hour=h, minute=m, second=0, microsecond=0)
    return prox if prox > agora_local else prox + timedelta(days=1)


def _sistema_do_job(db: Session, j: Job) -> Sistema | None:
    from app.modules.tribunais.models import Processo, Protocolo

    if j.tipo in ("protocolar", "verificar_protocolo"):
        p = db.get(Protocolo, j.referencia_id)
        return p.sistema_instancia if p else None
    if j.tipo == "baixar_documentos":
        p = db.get(Processo, j.referencia_id)
        return p.sistema_instancia if p else None
    return None


def _executar(db: Session, j: Job) -> None:
    from app.modules.tribunais import cobranca, notificacoes, protocolo, service

    if j.tipo == "protocolar":
        protocolo.executar(db, j.referencia_id)
    elif j.tipo == "verificar_protocolo":
        protocolo.verificar(db, j.referencia_id, j.payload or {})
    elif j.tipo == "notificar":
        notificacoes.executar(db, j.referencia_id)
    elif j.tipo == "varredura":
        v = db.get(Varredura, j.referencia_id)
        if v and v.status == "rodando":
            service.rodar_varredura_servidor(db, v)
    elif j.tipo == "importar_processo":
        e = db.get(Encontrado, j.referencia_id)
        if not e or e.status_importacao not in ("fila", "erro"):
            return
        v = e.varredura
        try:
            p = service.importar(db, v.tenant_id, e.numero_cnj, usuario_id=j.criado_por_id, advogado_id=v.advogado_id,
                                 origem="varredura", encontrado=e)
        except service.ErroIntegracao as ex:
            e.status_importacao, e.erro = "erro", str(ex)[:500]
            db.commit()
            return
        e.status_importacao, e.processo_id, e.erro = "importado", p.id, None
        restantes = db.scalar(select(Encontrado.id).where(Encontrado.varredura_id == v.id, Encontrado.status_importacao == "fila"))
        if not restantes:  # varredura toda importada: setup (uma vez)
            novos = sum(1 for x in v.encontrados if x.status_importacao == "importado" and not x.ja_importado)
            cobranca.lancar_importacao(db, v.tenant_id, v.id, novos)
    elif j.tipo == "sincronizar":
        from app.modules.tribunais.models import Processo

        p = db.get(Processo, j.referencia_id)
        if p:
            service.sincronizar(db, p)
    elif j.tipo == "baixar_documentos":
        from app.modules.tribunais.models import Processo

        p = db.get(Processo, j.referencia_id)
        if p and p.advogado_id:
            baixar_documentos(db, p, j.criado_por_id)
    elif j.tipo == "health_check":
        from app.modules.tribunais import adaptadores

        s = db.get(Sistema, j.referencia_id)
        if s:
            s.status_saude = adaptadores.para(s).saude(s)
            s.ultima_verificacao = agora()
    else:
        raise ValueError(f"Tipo de job desconhecido: {j.tipo}")


def baixar_documentos(db: Session, p, usuario_id: int | None) -> int:
    """Download dos autos com o certificado (escopo "download")."""
    from app.modules.tribunais import certificado as cert_mod
    from app.modules.tribunais import service

    cert = service.certificado_ativo(db, p.advogado_id)
    if not cert or "download" not in (cert.escopo_autorizado or []):
        for d in p.documentos:
            if d.status_download == "pendente":
                d.status_download = "sem_acesso"
        return 0
    service.consultar_mni(db, p, p.advogado_id, usuario_id, incluir_documentos=True)
    baixados = 0
    for d in p.documentos:
        if d.status_download == "baixado" and d.storage_ref:
            baixados += 1
    if baixados:
        cert_mod.registrar_uso(db, cert, "download", p.numero_cnj, "ok", tribunal_id=p.tribunal_id, usuario_id=usuario_id,
                               detalhe=f"{baixados} documento(s)")
    return baixados


def rodar_fila(limite: int = 50) -> int:
    """Processa até `limite` jobs vencidos, na ordem de prioridade."""
    feitos = 0
    pulados: set[int] = set()
    while feitos < limite:
        with SessionLocal() as db:
            q = (select(Job).where(Job.status.in_(("fila", "reprocessar")),
                                   (Job.proxima_tentativa_em.is_(None)) | (Job.proxima_tentativa_em <= agora()))
                 .order_by(Job.prioridade.desc(), Job.id))
            if pulados:
                q = q.where(Job.id.not_in(pulados))
            j = db.scalar(q.limit(1))
            if not j:
                return feitos
            if j.tipo in FALAM_COM_TRIBUNAL:
                s = _sistema_do_job(db, j)
                prox = _fora_da_janela(s, datetime.now().astimezone())
                if prox:
                    j.proxima_tentativa_em = prox
                    db.commit()
                    continue
                if s and j.tribunal_id and _time.monotonic() - _ultimo_por_tribunal.get(j.tribunal_id, -1e9) < s.intervalo_min_s:
                    pulados.add(j.id)  # outro job deste tribunal acabou de rodar: deixa para a próxima volta
                    continue
            j.status, j.iniciado_em, j.tentativas = "rodando", agora(), j.tentativas + 1
            db.commit()
            try:
                _executar(db, j)
                j.status, j.concluido_em, j.erro = "ok", agora(), None
            except Exception as e:  # noqa: BLE001
                db.rollback()
                j = db.get(Job, j.id)
                log.exception("Job %s (%s #%s) falhou", j.id, j.tipo, j.referencia_id)
                j.erro = str(e)[:2000]
                if j.tipo == "protocolar" or j.tentativas >= j.max_tentativas:
                    j.status, j.concluido_em = "erro", agora()
                    _protocolo_preso(db, j)
                else:
                    j.status = "reprocessar"
                    j.proxima_tentativa_em = agora() + timedelta(seconds=30 * 2 ** j.tentativas)
            if j.tribunal_id and j.tipo in FALAM_COM_TRIBUNAL:
                _ultimo_por_tribunal[j.tribunal_id] = _time.monotonic()
            db.commit()
            feitos += 1
    return feitos


def _protocolo_preso(db: Session, j: Job) -> None:
    """Erro inesperado no meio do envio: o protocolo fica em "verificar" (nunca reenvia sozinho)."""
    if j.tipo != "protocolar":
        return
    from app.modules.tribunais.models import Protocolo
    from app.modules.tribunais.service import alertar

    p = db.get(Protocolo, j.referencia_id)
    if p and p.status in ("enviando", "na_fila"):
        p.status = "verificar" if p.status == "enviando" else "erro"
        p.ultimo_erro = f"Erro interno durante o envio: {j.erro}"[:2000]
        alertar(db, p.tenant_id, "protocolo_verificar", f"Protocolo #{p.id} interrompido. Confira no tribunal antes de reenviar.",
                severidade="erro", protocolo_id=p.id, usuario_id=p.advogado_id)


def liberar_presos() -> None:
    """Na subida do worker: jobs "rodando" de uma execução interrompida voltam para a fila (exceto protocolo)."""
    with SessionLocal() as db:
        for j in db.scalars(select(Job).where(Job.status == "rodando")):
            if j.tipo == "protocolar":
                j.status, j.erro = "erro", "Worker reiniciado durante o envio."
                _protocolo_preso(db, j)
            else:
                j.status = "reprocessar"
        db.commit()


def rotina_diaria() -> None:
    """Sincronização dos processos monitorados, alertas de certificado (30/15/7 dias), revogação e saúde dos tribunais."""
    from app.modules.tribunais import certificado as cert_mod
    from app.modules.tribunais import service

    with SessionLocal() as db:
        for p in service.pendentes_de_sincronizar(db):
            enfileirar(db, p.tenant_id, "sincronizar", p.id, tribunal_id=p.tribunal_id)
        service.agendar_intimacoes_diarias(db)  # só com proxy do DJEN no Brasil
        hoje = date.today()
        for c in db.scalars(select(CertificadoAdvogado).where(CertificadoAdvogado.removido_em.is_(None))):
            dias = (c.valido_ate.date() - hoje).days
            for limite in (30, 15, 7):
                if dias <= limite and limite not in (c.alertas_enviados or []):
                    c.alertas_enviados = [*(c.alertas_enviados or []), limite]
                    service.alertar(db, c.tenant_id, "certificado", f"O certificado de {c.titular_nome} vence em {max(dias, 0)} dia(s) "
                                    f"({c.valido_ate:%d/%m/%Y}).", severidade="erro" if limite == 7 else "aviso", usuario_id=c.usuario_id)
                    _avisar_certificado(db, c, dias)
                    break
            if not c.revogacao_verificada_em or (agora() - c.revogacao_verificada_em.replace(tzinfo=agora().tzinfo)).days >= 7:
                antes = c.revogado
                cert_mod.verificar_revogacao(c)
                if c.revogado and not antes:
                    service.alertar(db, c.tenant_id, "certificado", f"O certificado de {c.titular_nome} foi REVOGADO pela AC.",
                                    severidade="erro", usuario_id=c.usuario_id)
        from app.core.models import Tenant

        tenant = db.scalar(select(Tenant.id).order_by(Tenant.id))  # sistemas são da plataforma; o job fica no 1º escritório
        for s in [] if tenant is None else db.scalars(select(Sistema).join(Tribunal).where(Sistema.ativo.is_(True),
                                                                                            Sistema.url_mni.is_not(None))):
            enfileirar(db, tenant, "health_check", s.id, tribunal_id=s.tribunal_id)
        db.commit()


def _avisar_certificado(db: Session, c: CertificadoAdvogado, dias: int) -> None:
    from app.core import email as email_mod
    from app.core.models import ConfigNotificacao, Usuario

    u = db.get(Usuario, c.usuario_id)
    if not u or not u.email:
        return
    try:
        email_mod.enviar([u.email], f"Seu certificado digital vence em {max(dias, 0)} dia(s)",
                         f"Olá, {u.nome}.\n\nO certificado digital {c.titular_nome} (emitido por {c.emissor_ac}) vence em "
                         f"{c.valido_ate:%d/%m/%Y}. Depois disso o MayaJus não consegue consultar nem protocolar em seu nome.\n\n"
                         "Renove com a sua Autoridade Certificadora e envie o novo arquivo em Tribunais › Meu certificado.",
                         config=db.get(ConfigNotificacao, c.tenant_id))
    except Exception:  # noqa: BLE001
        log.exception("Aviso de vencimento do certificado %s não enviado", c.id)
