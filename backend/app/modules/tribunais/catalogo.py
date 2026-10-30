"""Dados de partida da integração (idempotente): plataforma, tribunais com seus sistemas, pesos e modelos de e-mail.

Só cria o que falta, nunca sobrescreve o que a MayaCorp ou o escritório já ajustaram na tela.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.tribunais import adaptadores, cnj
from app.modules.tribunais.models import ConfigTribunais, NotificacaoProtocolo, PesoProtocolo, Plataforma, Sistema, Tribunal

# chave pública divulgada pelo CNJ na documentação do DataJud (não é segredo; pode mudar e por isso é editável)
DATAJUD_CHAVE_PUBLICA = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="

TERMO_PADRAO = """Termo de consentimento para uso do certificado digital (LGPD)

Autorizo o MayaJus, sistema de gestão do escritório, a guardar o meu certificado digital (e-CPF) de forma cifrada e a usá-lo
somente para as finalidades que marquei abaixo, sempre em meu nome:

• Consulta: consultar processos em que atuo nos sistemas dos tribunais.
• Download: baixar as peças e documentos dos autos desses processos.
• Protocolo: assinar e protocolar petições — e somente depois que eu mesmo aprovar cada petição no sistema.

O certificado nunca é usado para protocolar sem a minha aprovação. Cada uso fica registrado (data, hora, tribunal e processo).
Posso revogar este consentimento a qualquer momento; a revogação apaga o certificado do cofre na mesma hora."""

PESOS_PADRAO = {"intermediaria": 1, "habilitacao": 1, "recurso": 2, "inicial": 4}

URL_PORTAL = {("TJSP", "esaj"): "https://esaj.tjsp.jus.br/esaj", ("TJSP", "eproc"): "https://eproc1g.tjsp.jus.br",
              ("TRF4", "eproc"): "https://eproc.trf4.jus.br", ("TRF2", "eproc"): "https://eproc.trf2.jus.br",
              ("TRF6", "eproc"): "https://eproc1g.trf6.jus.br", ("TRF1", "pje"): "https://pje1g.trf1.jus.br",
              ("TRF3", "pje"): "https://pje1g.trf3.jus.br", ("TRF5", "pje"): "https://pje1g.trf5.jus.br",
              ("STJ", "proprio"): "https://www.stj.jus.br", ("STF", "proprio"): "https://portal.stf.jus.br",
              ("TST", "pje"): "https://pje.tst.jus.br", ("TJMG", "pje"): "https://pje.tjmg.jus.br",
              ("TJSC", "eproc"): "https://eproc1g.tjsc.jus.br", ("TJRS", "eproc"): "https://eproc1g.tjrs.jus.br"}

MODELOS = {
    "protocolo_sucesso": {
        "ativo": True,
        "assunto": "✅ Protocolo realizado — {{numero_cnj}} ({{tribunal_sigla}})",
        "corpo_texto": (
            "Olá, {{advogado_responsavel_nome}}.\n\nA petição {{tipo_peticao}} foi protocolada com sucesso.\n"
            "- Processo: {{numero_cnj}}\n- Cliente: {{cliente_nome}}\n- Tribunal: {{tribunal_sigla}} ({{sistema}})\n"
            "- Órgão: {{orgao_julgador}}\n- Protocolo nº: {{numero_protocolo}}\n- Data/hora: {{data_hora_protocolo}}\n"
            "- Protocolado por: {{protocolado_por_nome}}\n\nO recibo segue em anexo. Abrir processo: {{link_processo}}"),
    },
    "protocolo_falha": {
        "ativo": True,
        "assunto": "⚠️ Falha no protocolo — {{numero_cnj}} ({{tribunal_sigla}})",
        "corpo_texto": (
            "Olá, {{advogado_responsavel_nome}}.\n\nA PETIÇÃO NÃO FOI PROTOCOLADA.\n- Processo: {{numero_cnj}}\n"
            "- Tentativa em: {{data_hora_protocolo}}\n- Erro retornado: {{mensagem_erro}}\n- Prazo final: {{prazo_final}}\n\n"
            "Verifique e reenvie. Abrir processo: {{link_processo}}"),
    },
    "protocolo_inicial_distribuido": {
        "ativo": False,
        "assunto": "Petição inicial distribuída — {{numero_cnj}} ({{tribunal_sigla}})",
        "corpo_texto": (
            "Olá, {{advogado_responsavel_nome}}.\n\nA petição inicial foi distribuída.\n- Processo: {{numero_cnj}}\n"
            "- Cliente: {{cliente_nome}}\n- Classe: {{classe}}\n- Órgão: {{orgao_julgador}}\n- Valor da causa: {{valor_causa}}\n"
            "- Partes: {{partes_resumo}}\n- Protocolo nº: {{numero_protocolo}} em {{data_hora_protocolo}}\n\n"
            "Abrir processo: {{link_processo}}"),
    },
    "protocolo_intermediaria": {
        "ativo": False,
        "assunto": "Petição protocolada — {{numero_cnj}} ({{tribunal_sigla}})",
        "corpo_texto": (
            "Olá, {{advogado_responsavel_nome}}.\n\n{{tipo_peticao}} protocolada no processo {{numero_cnj}}.\n"
            "- Protocolo nº: {{numero_protocolo}} em {{data_hora_protocolo}}\n- Prazo final: {{prazo_final}}\n\n"
            "Abrir processo: {{link_processo}}"),
    },
}
EVENTOS = tuple(MODELOS)


def garantir_plataforma(db: Session) -> Plataforma:
    p = db.scalar(select(Plataforma).order_by(Plataforma.id))
    if not p:
        p = Plataforma(datajud_chave=DATAJUD_CHAVE_PUBLICA, termo_texto=TERMO_PADRAO)
        db.add(p)
    for k, v in PESOS_PADRAO.items():
        if not db.get(PesoProtocolo, k):
            db.add(PesoProtocolo(tipo_protocolo=k, creditos=v))
    existentes = {t.sigla: t for t in db.scalars(select(Tribunal))}
    for t in cnj.catalogo():
        trib = existentes.get(t["sigla"])
        if trib is None:
            trib = Tribunal(**{k: v for k, v in t.items() if k != "sistemas"})
            db.add(trib)
            db.flush()
            for grau, sistema in t["sistemas"]:
                db.add(Sistema(tribunal_id=trib.id, grau=grau, sistema=sistema, adaptador=adaptadores.ADAPTADOR_PADRAO[sistema],
                               url_portal=URL_PORTAL.get((t["sigla"], sistema)),
                               formato_assinatura="assinatura_no_portal" if sistema in ("esaj", "projudi", "proprio") else "PAdES",
                               config_extra={"migracao": "e-SAJ → eproc em andamento"} if (t["sigla"], sistema) == ("TJSP", "eproc") else {}))
    db.flush()
    return p


def garantir_tenant(db: Session, tenant_id: int) -> ConfigTribunais:
    cfg = db.get(ConfigTribunais, tenant_id)
    if not cfg:
        cfg = ConfigTribunais(tenant_id=tenant_id, alerta_franquia=[])
        db.add(cfg)
    tem = set(db.scalars(select(NotificacaoProtocolo.evento).where(NotificacaoProtocolo.tenant_id == tenant_id)))
    for evento, m in MODELOS.items():
        if evento not in tem:
            db.add(NotificacaoProtocolo(tenant_id=tenant_id, evento=evento, ativo=m["ativo"], assunto=m["assunto"],
                                        corpo_texto=m["corpo_texto"], destinatarios_fixos=[], copia_oculta=[]))
    db.flush()
    return cfg
