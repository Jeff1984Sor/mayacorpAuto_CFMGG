"""Worker da fila de emissão.

Cada lote vira um job. Em desenvolvimento roda num pool de threads dentro da API; em produção o
mesmo `processar_lote` é chamado pelo serviço `worker` (python -m app.worker), que pega os lotes
na fila no banco — sem dependência de broker externo.

Fluxo por sublote de até 50 RPS:
  1. Teste de envio na Prefeitura (TesteEnvioLoteRPS) — só segue o que passou limpo
  2. Envio real (EnvioLoteRPS, transacao=false: rejeição parcial não derruba o resto)
  3. Para cada nota: grava nº + código de verificação, XML e PDF
Falha de comunicação ≠ rejeição: antes de reenviar, consulta se a nota já foi gerada.
"""

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.core import audit, certificados
from app.core.config import settings
from app.core.db import SessionLocal, agora
from app.core.models import Certificado, ConfigNotificacao, Identidade
from app.modules.rpa_nfse import fatura, pdf, service
from app.modules.rpa_nfse.models import Lote, Nfse, Rps, StatusLote, StatusRps
from app.modules.rpa_nfse.prefeitura_sp import (
    ClientePrefeitura,
    FalhaComunicacao,
    RpsXml,
    link_nota,
    simulador,
    xml_layout2,
)

log = logging.getLogger(__name__)

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="rpa-nfse")
_em_execucao: set[int] = set()
_trava = threading.Lock()


def enfileirar_job(lote_id: int) -> None:
    if not settings.worker_embutido:
        return  # o serviço app.worker pega o lote na fila do banco
    with _trava:
        if lote_id in _em_execucao:
            return
        _em_execucao.add(lote_id)
    _pool.submit(_rodar, lote_id)


def _rodar(lote_id: int) -> None:
    try:
        processar_lote(lote_id)
    except Exception:
        log.exception("Lote %s falhou", lote_id)
        with SessionLocal() as db:
            lote = db.get(Lote, lote_id)
            if lote:
                lote.status = StatusLote.falhou
                lote.mensagem = "Erro inesperado no robô. A MayaCorp foi avisada; os RPS continuam na fila."
                lote.evento("erro", lote.mensagem, "erro")
                db.commit()
    finally:
        with _trava:
            _em_execucao.discard(lote_id)


def _rps_xml(r: Rps) -> RpsXml:
    l2 = (r.dados_json or {}).get("layout2", {})
    return RpsXml(
        serie=r.serie,
        numero=r.numero,
        tipo=r.tipo_rps,
        data_emissao=r.data_emissao,
        status="C" if r.situacao == "C" else "N",
        tributacao=l2.get("tributacao_rps") or "T",
        valor=r.valor,
        deducoes=r.deducoes,
        cod_servico=r.cod_servico,
        aliquota=r.aliquota,
        iss_retido=r.iss_retido,
        discriminacao=r.discriminacao,
        tomador=(r.dados_json or {}).get("tomador", {}),
        layout2=l2,
    )


def _salvar_nota(db, lote: Lote, r: Rps, numero: int, cod: str, simulada: bool, xml_rps: bytes) -> Nfse:
    emissora = lote.emissora
    nota = Nfse(
        tenant_id=lote.tenant_id,
        rps_id=r.id,
        emissora_id=emissora.id,
        tomador_id=r.tomador_id,
        numero=numero,
        cod_verificacao=cod,
        data_emissao=agora(),
        valor=r.valor,
        iss=r.iss,
        simulada=simulada,
    )
    db.add(nota)
    db.flush()
    nota.rps = r
    nota.emissora = emissora
    destino = service.pasta(emissora.id)
    xml_path = destino / f"NFSe_{numero}.xml"
    xml_path.write_bytes(
        b'<?xml version="1.0" encoding="UTF-8"?>'
        + f'<NFSeEmitida numero="{numero}" codigoVerificacao="{cod}" emitidaEm="{nota.data_emissao.isoformat()}">'.encode()
        + xml_rps
        + b"</NFSeEmitida>"
    )
    nota.xml_path = str(xml_path)
    # PDF próprio na hora; o oficial da Prefeitura substitui depois, em paralelo (_trocar_por_pdf_oficial)
    link = link_nota(emissora.ccm, numero, cod)
    pdf_path = destino / f"NFSe_{numero}.pdf"
    pdf_path.write_bytes(pdf.gerar(nota, db.get(Identidade, lote.tenant_id), link))
    nota.pdf_path = str(pdf_path)
    r.status = StatusRps.emitido
    fatura.criar(db, nota, service.config_nfse(db, lote.tenant_id))  # toda NFS-e (lote ou individual) gera a NH
    return nota


def _trocar_por_pdf_oficial(ccm: str, notas: list[Nfse]) -> None:
    """Baixa o PDF oficial do portal (notaprintpdf.aspx) de 8 em 8. Se o portal falhar, fica o PDF próprio."""
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    def baixar(n: Nfse) -> None:
        conteudo = pdf.baixar_oficial(ccm, n.numero, n.cod_verificacao)
        if conteudo and n.pdf_path:
            Path(n.pdf_path).write_bytes(conteudo)

    alvo = [(n.numero, n.cod_verificacao, n.pdf_path) for n in notas]
    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="pdf-oficial") as pool:
        list(pool.map(lambda t: baixar(_NotaPdf(*t)), alvo))


class _NotaPdf:
    """Só os campos necessários: objetos ORM não atravessam threads."""

    def __init__(self, numero: int, cod_verificacao: str, pdf_path: str | None):
        self.numero, self.cod_verificacao, self.pdf_path = numero, cod_verificacao, pdf_path


def _rejeitar(r: Rps, erros: list[dict]) -> None:
    r.status = StatusRps.rejeitado
    r.erros_json = [e for e in (r.erros_json or []) if e.get("nivel") != "erro"] + erros
    r.chave_emissao = None  # libera para reenvio isolado depois da correção


def _enviar_sublote(db, lote: Lote, rps: list[Rps], cliente: ClientePrefeitura) -> None:
    emissora = lote.emissora
    por_chave = {(r.serie, r.numero): r for r in rps}
    pedido_xml = {(r.serie, r.numero): _rps_xml(r) for r in rps}

    # 1) teste
    teste = cliente.enviar_lote(cnpj=emissora.cnpj, ccm=emissora.ccm, rps=list(pedido_xml.values()), teste=True)
    if teste.erros:
        gerais = []
        for e in teste.erros:
            r = por_chave.get((e.serie, e.numero)) if e.numero else None
            if r:
                _rejeitar(r, [e.humano()])
            else:
                gerais.append(e)
        if gerais:  # erro sem RPS identificado (schema, certificado...) — o sublote inteiro volta
            for r in rps:
                if r.status != StatusRps.rejeitado:
                    _rejeitar(r, [g.humano() for g in gerais])
        lote.evento(
            "teste",
            f"Teste na Prefeitura: {sum(1 for r in rps if r.status == StatusRps.rejeitado)} recusado(s).",
            "aviso",
        )
    limpos = [r for r in rps if r.status != StatusRps.rejeitado]
    if not limpos:
        return
    if cliente.modo == "teste":
        for r in limpos:
            r.status = StatusRps.ok
            r.chave_emissao = None
        lote.evento("teste", f"{len(limpos)} RPS validados pela Prefeitura (modo teste: nenhuma nota gerada).")
        return

    # 2) envio real, com consulta antes de reenviar em caso de falha de comunicação
    if cliente.modo == "simulado":
        ultimo = db.scalar(select(func.max(Nfse.numero)).where(Nfse.emissora_id == emissora.id)) or 10_000
        simulador._contador[0] = max(simulador._contador[0], ultimo)
    for tentativa in range(1, 4):
        try:
            ret = cliente.enviar_lote(
                cnpj=emissora.cnpj, ccm=emissora.ccm, rps=[pedido_xml[(r.serie, r.numero)] for r in limpos], teste=False
            )
            break
        except FalhaComunicacao as e:
            lote.evento("envio", f"Prefeitura instável ({e}). Conferindo se as notas já foram geradas…", "aviso")
            db.commit()
            recuperadas = []
            for r in limpos:
                achou = cliente.consultar_por_rps(cnpj=emissora.cnpj, ccm=emissora.ccm, serie=r.serie, numero=r.numero)
                if achou:
                    _salvar_nota(db, lote, r, achou.numero_nfe, achou.cod_verificacao, False, b"")
                    recuperadas.append(r)
            limpos = [r for r in limpos if r not in recuperadas]
            if not limpos:
                return
            if tentativa == 3:
                raise
            time.sleep(30 * tentativa)

    pedido_bytes = {k: xml_layout2.rps_isolado(emissora.ccm, v, cliente.cert) for k, v in pedido_xml.items()}

    emitidos = set()
    for n in ret.notas:
        r = por_chave.get((n.serie, n.numero_rps))
        if r and r.status != StatusRps.emitido:
            _salvar_nota(db, lote, r, n.numero_nfe, n.cod_verificacao, ret.simulado, pedido_bytes.get((r.serie, r.numero), b""))
            emitidos.add(r.id)
    if not ret.simulado:
        _trocar_por_pdf_oficial(emissora.ccm, [r.nfse for r in limpos if r.id in emitidos and r.nfse])
    for e in ret.erros:
        r = por_chave.get((e.serie, e.numero)) if e.numero else None
        if r and r.id not in emitidos:
            _rejeitar(r, [e.humano()])
    for r in limpos:
        if r.status not in (StatusRps.emitido, StatusRps.rejeitado):
            _rejeitar(r, [{"campo": "prefeitura", "nivel": "erro", "mensagem": "A Prefeitura não devolveu a nota deste recibo.", "acao": "Reenvie; o robô confere antes para não duplicar."}])


def processar_lote(lote_id: int) -> None:
    with SessionLocal() as db:
        lote = db.get(Lote, lote_id)
        if not lote or lote.status not in (StatusLote.na_fila, StatusLote.transmitindo):
            return
        emissora = lote.emissora
        cert = None
        if emissora.certificado_id:
            c = db.get(Certificado, emissora.certificado_id)
            cert = certificados.abrir(c) if c else None
        modo = service.modo_prefeitura(db, lote.tenant_id)
        if modo != "simulado" and cert is None:
            lote.status = StatusLote.falhou
            lote.mensagem = "A emissora não tem certificado digital. Configure em Configurações › Certificado."
            lote.evento("erro", lote.mensagem, "erro")
            db.commit()
            return
        cliente = ClientePrefeitura(cert, modo)

        lote.status = StatusLote.transmitindo
        lote.iniciado_em = lote.iniciado_em or agora()
        lote.evento("envio", "Robô iniciou a transmissão.")
        db.commit()

        fila = [r for r in lote.rps if r.status == StatusRps.na_fila]
        for r in fila:
            service.sincronizar_tomador(db, lote.tenant_id, r)
        db.commit()

        tam = settings.lote_tamanho
        for i in range(0, len(fila), tam):
            parte = fila[i : i + tam]
            for r in parte:
                r.status = StatusRps.transmitindo
                r.tentativas += 1
            db.commit()
            try:
                _enviar_sublote(db, lote, parte, cliente)
            except FalhaComunicacao as e:
                for r in parte:
                    if r.status == StatusRps.transmitindo:
                        r.status = StatusRps.na_fila
                lote.status = StatusLote.falhou
                lote.mensagem = "A Prefeitura está fora do ar. Os RPS continuam na fila; use “Reprocessar” mais tarde."
                lote.evento("erro", f"{lote.mensagem} ({e})", "erro")
                db.commit()
                return
            lote.sublotes_feitos += 1
            lote.qtd_emitidas = sum(1 for r in lote.rps if r.status == StatusRps.emitido)
            lote.qtd_rejeitadas = sum(1 for r in lote.rps if r.status == StatusRps.rejeitado)
            lote.evento(
                "envio",
                f"Lote {lote.sublotes_feitos}/{lote.sublotes_total}: "
                f"{sum(1 for r in parte if r.status == StatusRps.emitido)} emitida(s), "
                f"{sum(1 for r in parte if r.status == StatusRps.rejeitado)} rejeitada(s).",
            )
            db.commit()
            if modo == "simulado":
                time.sleep(0.8)  # deixa o progresso visível na demonstração

        lote.qtd_emitidas = sum(1 for r in lote.rps if r.status == StatusRps.emitido)
        lote.qtd_rejeitadas = sum(1 for r in lote.rps if r.status == StatusRps.rejeitado)
        if modo == "teste":
            lote.status = StatusLote.validando if not lote.qtd_rejeitadas else StatusLote.parcial
        elif lote.qtd_rejeitadas == 0:
            lote.status = StatusLote.concluido
        elif lote.qtd_emitidas:
            lote.status = StatusLote.parcial
        else:
            lote.status = StatusLote.falhou
        lote.concluido_em = agora()
        lote.mensagem = f"{lote.qtd_emitidas} nota(s) emitida(s), {lote.qtd_rejeitadas} rejeitada(s)."
        lote.evento("retorno", lote.mensagem, "sucesso" if not lote.qtd_rejeitadas else "aviso")
        audit.registrar(
            db,
            tenant_id=lote.tenant_id,
            usuario=None,
            acao="lote.concluido",
            entidade="lote",
            entidade_id=lote.id,
            descricao=f"Lote #{lote.numero}: {lote.mensagem}",
        )
        db.commit()
        _pos_lote(db, lote)


def _pos_lote(db, lote: Lote) -> None:
    from app.core import email as mail
    from app.modules.rpa_nfse.pdf import brl

    try:  # 🤖 o robô conta para a equipe no Comunicador
        from app.comunicador.service import robo_postar

        valor = sum((r.valor for r in lote.rps if r.nfse), 0)
        if lote.qtd_rejeitadas and lote.qtd_emitidas:
            texto = (f"⚠️ Lote #{lote.numero:04d} concluído com pendências: {lote.qtd_emitidas} nota(s) emitida(s) "
                     f"({brl(valor)}) e {lote.qtd_rejeitadas} rejeitada(s). Vale olhar as rejeitadas.")
        elif lote.qtd_rejeitadas:
            texto = f"❌ Lote #{lote.numero:04d}: nenhuma nota emitida, {lote.qtd_rejeitadas} rejeitada(s). Precisa de atenção."
        else:
            texto = f"✅ Lote #{lote.numero:04d} concluído: {lote.qtd_emitidas} nota(s) emitida(s), {brl(valor)}. Tudo certo!"
        robo_postar(db, lote.tenant_id, texto, link=f"/nfse/lotes/{lote.id}")
        db.commit()
    except Exception:  # noqa: BLE001 — aviso no chat nunca derruba a emissão
        log.warning("Não consegui postar o aviso do lote %s no Comunicador", lote.id, exc_info=True)

    cfg_nfse = service.config_nfse(db, lote.tenant_id)
    db.commit()
    if cfg_nfse.relatorio_emissao_ativo and cfg_nfse.relatorio_destinatarios:
        try:
            service.enviar_relatorio_emissao(db, lote, cfg_nfse)
            lote.evento("relatorio", f"Relatório enviado para {', '.join(cfg_nfse.relatorio_destinatarios)}.")
        except Exception:  # noqa: BLE001
            log.warning("Não consegui enviar o relatório do lote %s", lote.id, exc_info=True)
            lote.evento("relatorio", "Falha ao enviar o relatório de emissão por e-mail.", "aviso")
        db.commit()

    cfg = db.get(ConfigNotificacao, lote.tenant_id)
    if not cfg:
        return
    if cfg.envio_automatico:
        for nota in service.notas_do_lote(db, lote.id):
            if not nota.envios:
                try:
                    service.enviar_email_nota(db, nota)
                except service.RegraNegocio:
                    pass
        db.commit()
    avisar = cfg.avisos_destinatarios or []
    if avisar and (cfg.aviso_fim_lote or (cfg.aviso_rejeicoes and lote.qtd_rejeitadas)):
        link = f"{settings.frontend_url}/nfse/lotes/{lote.id}"
        try:
            mail.enviar(
                avisar,
                f"Lote #{lote.numero} concluído — {lote.qtd_emitidas} emitida(s), {lote.qtd_rejeitadas} rejeitada(s)",
                f"O robô terminou o lote #{lote.numero} ({lote.arquivo_origem}).\n\n{lote.mensagem}\n\nDetalhes: {link}",
                config=cfg,
            )
        except Exception:  # noqa: BLE001
            log.warning("Não consegui enviar o aviso do lote %s", lote.id, exc_info=True)


def retomar_pendentes() -> None:
    with SessionLocal() as db:
        for lote_id in service.liberar_presos(db):
            enfileirar_job(lote_id)


def alertar_certificados() -> None:
    """Alertas de vencimento: 30, 15, 7 e 1 dia antes (chamado 1x/dia pelo agendador)."""
    from datetime import date

    from app.core import email as mail

    with SessionLocal() as db:
        for c in db.scalars(select(Certificado).where(Certificado.ativo)):
            dias = (c.valido_ate - date.today()).days
            marco = next((m for m in (1, 7, 15, 30) if dias <= m), None)
            if marco is None or marco in (c.alertas_enviados or []):
                continue
            cfg = db.get(ConfigNotificacao, c.tenant_id)
            if cfg and cfg.aviso_certificado and cfg.avisos_destinatarios:
                mail.enviar(
                    cfg.avisos_destinatarios,
                    f"Certificado digital vence em {dias} dia(s)",
                    f"O certificado de {c.titular} vence em {c.valido_ate:%d/%m/%Y}. "
                    f"Envie o novo em {settings.frontend_url}/configuracoes/certificado.",
                    config=cfg,
                )
            c.alertas_enviados = [*(c.alertas_enviados or []), marco]
        db.commit()


