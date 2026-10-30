"""E-mail do resultado do protocolo (seção 17). Roda na fila: nunca trava nem desfaz o protocolo.

Destinatários por papel (responsável do caso, quem protocolou, titular do certificado, fixos), um e-mail por endereço,
preferência individual (o aviso de falha não se desliga), sigilo e idempotência por retorno + destinatário + evento.
"""

import logging
import smtplib
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import email as email_mod
from app.core.config import settings
from app.core.db import agora
from app.core.models import ConfigNotificacao, Usuario
from app.modules.tribunais import cnj
from app.modules.tribunais.models import EmailLog, NotificacaoProtocolo, PreferenciaNotificacao, Processo, RetornoProtocolo

log = logging.getLogger(__name__)
LIMITE_ANEXO = 10 * 1024 * 1024  # acima disso o recibo vai como link autenticado
ROTULO_SISTEMA = {"pje": "PJe", "eproc": "eproc", "esaj": "e-SAJ", "projudi": "Projudi", "proprio": "sistema próprio"}
ROTULO_TIPO = {"inicial": "Petição inicial", "intermediaria": "Petição intermediária", "habilitacao": "Pedido de habilitação",
               "recurso": "Recurso"}


def eventos_do_retorno(r: RetornoProtocolo) -> list[str]:
    if not r.sucesso:
        return ["protocolo_falha"]
    extra = "protocolo_inicial_distribuido" if r.protocolo.tipo == "inicial" and r.numero_cnj_gerado else "protocolo_intermediaria"
    return ["protocolo_sucesso", extra]


def render(modelo: str, variaveis: dict) -> str:
    out = modelo
    for k, v in variaveis.items():
        out = out.replace("{{" + k + "}}", "" if v is None else str(v))
    return out


def link_recibo(retorno_id: int, dias: int = 7) -> str:
    agora_ = datetime.now(UTC)
    tok = jwt.encode({"sub": str(retorno_id), "typ": "recibo", "iat": agora_, "exp": agora_ + timedelta(days=dias)},
                     settings.jwt_secret, algorithm="HS256")
    return f"{settings.frontend_url.rstrip('/')}/api/public/tribunais/recibo?token={tok}"


def retorno_do_link(token: str) -> int:
    p = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if p.get("typ") != "recibo":
        raise jwt.InvalidTokenError("tipo de token inválido")
    return int(p["sub"])


def variaveis(db: Session, r: RetornoProtocolo) -> dict:
    prot = r.protocolo
    proc: Processo | None = prot.processo
    if proc is None and r.numero_cnj_gerado:
        proc = db.scalar(select(Processo).where(Processo.tenant_id == prot.tenant_id, Processo.numero_cnj == r.numero_cnj_gerado))
    resp_id = (proc.responsavel_interno_id if proc else None) or (proc.caso.responsavel_id if proc and proc.caso else None)
    responsavel = db.get(Usuario, resp_id) if resp_id else None
    aprov = next((a for a in reversed(prot.aprovacoes) if not a.invalidada_em), None)
    quem = db.get(Usuario, aprov.advogado_id if aprov else prot.enviado_por_id or prot.advogado_id)
    sigiloso = (proc.nivel_sigilo if proc else 0) > 0 or prot.nivel_sigilo > 0
    clientes = [v.cliente.nome for v in (proc.vinculos if proc else []) if v.status in ("automatico", "confirmado") and v.cliente]
    if not clientes and prot.caso_id:
        from app.modules.faturamento.models import Caso

        caso = db.get(Caso, prot.caso_id)
        clientes = [caso.contrato.tomador.nome] if caso and caso.contrato and caso.contrato.tomador else []
    if proc:
        ativo = [p.pessoa.nome for p in proc.partes if p.polo == "ativo"]
        passivo = [p.pessoa.nome for p in proc.partes if p.polo == "passivo"]
    else:
        ativo = [(p.get("pessoa") or p).get("nome") for p in prot.partes if p.get("polo") == "ativo"]
        passivo = [(p.get("pessoa") or p).get("nome") for p in prot.partes if p.get("polo") == "passivo"]
    partes = f"{ativo[0] if ativo else '—'} x {passivo[0] if passivo else '—'}" if ativo or passivo else ""
    numero = r.numero_cnj_gerado or prot.numero_cnj or (proc.numero_cnj if proc else None)
    sist = prot.sistema_instancia
    quando = r.data_hora_protocolo or r.criado_em
    valor = prot.cabecalho.get("valor_causa") if prot.tipo == "inicial" else None
    link = f"{settings.frontend_url.rstrip('/')}/tribunais/" + (f"processos/{proc.id}" if proc else f"protocolos/{prot.id}")
    return {
        "advogado_responsavel_nome": (responsavel or quem).nome if (responsavel or quem) else "",
        "protocolado_por_nome": quem.nome if quem else "",
        "cliente_nome": "(processo sigiloso)" if sigiloso else (", ".join(clientes) or "—"),
        "numero_cnj": cnj.formatar(numero) if numero else "(processo novo)",
        "numero_protocolo": r.numero_protocolo or "—",
        "data_hora_protocolo": quando.astimezone().strftime("%d/%m/%Y %H:%M") if quando else "",
        "tribunal_sigla": prot.tribunal.sigla,
        "sistema": ROTULO_SISTEMA.get(sist.sistema, sist.sistema) if sist else "",
        "orgao_julgador": r.orgao_julgador_distribuido or (proc.orgao_julgador if proc else "") or "—",
        "classe": prot.cabecalho.get("classe_nome") or (proc.classe_nome if proc else "") or "",
        "tipo_peticao": prot.tipo_peticao_nome or ROTULO_TIPO.get(prot.tipo, prot.tipo),
        "partes_resumo": "" if sigiloso else partes,
        "valor_causa": f"R$ {float(valor):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if valor not in (None, "") else "",
        "prazo_final": prot.prazo_final.strftime("%d/%m/%Y") if prot.prazo_final else "—",
        "mensagem_erro": r.mensagem_erro or "",
        "link_processo": link,
        "_sigiloso": sigiloso, "_responsavel": responsavel, "_quem": quem, "_processo": proc,
    }


def _preferencia(db: Session, usuario_id: int, evento: str) -> PreferenciaNotificacao | None:
    return db.scalar(select(PreferenciaNotificacao).where(PreferenciaNotificacao.usuario_id == usuario_id,
                                                          PreferenciaNotificacao.evento == evento))


def destinatarios(db: Session, r: RetornoProtocolo, cfg: NotificacaoProtocolo, var: dict) -> list[tuple[str, str]]:
    """[(e-mail, papel)] já deduplicado. Aplica preferências e as regras 1 e 4."""
    from app.modules.tribunais.service import alertar

    prot = r.protocolo
    falha = cfg.evento == "protocolo_falha"
    papeis: list[tuple[Usuario | str, str]] = []
    resp: Usuario | None = var["_responsavel"]
    quem: Usuario | None = var["_quem"]
    if cfg.notificar_responsavel_caso:
        if resp and resp.email:
            papeis.append((resp, "responsavel_caso"))
        elif quem:  # regra 1: sem responsável → quem protocolou + alerta no processo
            papeis.append((quem, "quem_protocolou"))
            alertar(db, prot.tenant_id, "sem_responsavel", f"Processo do protocolo #{prot.id} está sem advogado responsável.",
                    severidade="aviso", processo_id=prot.processo_id, protocolo_id=prot.id)
    if cfg.notificar_quem_protocolou and quem:
        papeis.append((quem, "quem_protocolou"))
    if cfg.notificar_titular_certificado:
        titular = db.get(Usuario, prot.advogado_id)
        if titular:
            papeis.append((titular, "titular_certificado"))
    urgente = falha and prot.prazo_final == date.today()
    if cfg.destinatarios_fixos or urgente:
        papeis += [(e, "fixo") for e in cfg.destinatarios_fixos or []]
    saida, vistos = [], set()
    for alvo, papel in papeis:
        if isinstance(alvo, Usuario):
            pref = _preferencia(db, alvo.id, cfg.evento)
            if pref and not pref.receber and not falha:  # falha não pode ser desligada
                continue
            endereco = (pref.email_alternativo if pref and pref.email_alternativo else alvo.email) or ""
        else:
            endereco = alvo
        endereco = endereco.strip().lower()
        if endereco and endereco not in vistos:
            vistos.add(endereco)
            saida.append((endereco, papel))
    return saida


def executar(db: Session, retorno_id: int) -> dict:
    """Envia os avisos do retorno. Levanta exceção se algum envio falhou (a fila tenta de novo, até 5 vezes)."""
    from app.modules.tribunais.service import alertar

    r = db.get(RetornoProtocolo, retorno_id)
    if not r:
        return {"enviados": 0}
    prot = r.protocolo
    smtp = db.get(ConfigNotificacao, prot.tenant_id)
    var = variaveis(db, r)
    enviados, falhas = 0, []
    for evento in eventos_do_retorno(r):
        cfg = db.scalar(select(NotificacaoProtocolo).where(NotificacaoProtocolo.tenant_id == prot.tenant_id,
                                                           NotificacaoProtocolo.evento == evento))
        if not cfg or not cfg.ativo:
            continue
        publicas = {k: v for k, v in var.items() if not k.startswith("_")}
        assunto = render(cfg.assunto, publicas)
        if evento == "protocolo_falha" and prot.prazo_final == date.today():
            assunto = "[URGENTE] " + assunto  # regra 4
        corpo = render(cfg.corpo_texto, publicas)
        anexos: list[tuple[str, bytes, str]] = []
        if not (cfg.respeitar_sigilo and var["_sigiloso"]):
            if cfg.anexar_recibo and r.recibo_ref and Path(r.recibo_ref).exists():
                dados = Path(r.recibo_ref).read_bytes()
                if len(dados) > LIMITE_ANEXO:  # regra 6: link autenticado com validade
                    corpo += f"\n\nRecibo (link válido por 7 dias): {link_recibo(r.id)}"
                else:
                    anexos.append((f"recibo-protocolo-{r.numero_protocolo or r.id}.pdf", dados, "application/pdf"))
            principal = prot.documentos[0] if prot.documentos else None
            if cfg.anexar_peca_principal and principal and Path(principal.arquivo_ref).exists():
                anexos.append((principal.nome_arquivo, Path(principal.arquivo_ref).read_bytes(), principal.mimetype))
        cco = list(cfg.copia_oculta or [])
        for endereco, papel in destinatarios(db, r, cfg, var):
            log_ = db.scalar(select(EmailLog).where(EmailLog.retorno_protocolo_id == r.id, EmailLog.destinatario == endereco,
                                                    EmailLog.evento == evento))
            if log_ and log_.status in ("enviado", "entregue", "aberto", "bounce"):
                continue  # regra 7: nunca o mesmo aviso duas vezes
            if not log_:
                log_ = EmailLog(tenant_id=prot.tenant_id, retorno_protocolo_id=r.id, evento=evento, destinatario=endereco,
                                papel_destinatario=papel, assunto_renderizado=assunto[:400], anexos=[a[0] for a in anexos],
                                provedor="SMTP" if (smtp and smtp.smtp_host) or settings.smtp_host else "arquivo")
                db.add(log_)
                db.flush()
            log_.tentativas += 1
            try:
                email_mod.enviar([endereco], assunto, corpo, anexos=anexos, config=smtp, cco=cco or None)
                log_.status, log_.enviado_em, log_.erro = "enviado", agora(), None
                enviados += 1
                cco = []  # cópia oculta só uma vez
            except smtplib.SMTPRecipientsRefused as e:  # regra 5: bounce → alerta para o administrador
                log_.status, log_.erro = "bounce", str(e)[:500]
                alertar(db, prot.tenant_id, "bounce", f"O e-mail {endereco} foi recusado pelo servidor. Corrija o cadastro.",
                        severidade="erro", protocolo_id=prot.id)
            except Exception as e:  # noqa: BLE001
                log_.status, log_.erro = "erro", str(e)[:500]
                falhas.append(endereco)
            db.commit()
    if falhas:
        raise RuntimeError(f"Falha ao enviar para: {', '.join(falhas)}")
    return {"enviados": enviados}
