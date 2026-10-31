"""Cobrança dos clientes do MayaJus pelo Mercado Pago.

- Mensalidade: todo mês (dia 1) sai uma cobrança por cliente ativo/suspenso com plano: o plano (com o desconto por
  indicação) + os excedentes do mês anterior (notas e usuários acima do plano). No ciclo anual, o plano entra só no
  mês de aniversário do contrato; nos outros meses vão só os excedentes, se houver.
- Quem paga no cartão (assinatura recorrente) já tem o plano debitado pelo Mercado Pago: a mensalidade dele leva só
  os excedentes. Cada débito da assinatura vira uma cobrança "cartao" paga.
- Avulsa: valor e descrição livres, sem produto.
- Régua: e-mails nos dias da régua (ex.: 3 dias antes, no dia, 3 e 10 dias depois). Atraso só gera aviso; a
  suspensão é sempre manual, no admin.
"""

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.controle import indicacao
from app.controle.mercadopago import FORMAS, ErroMercadoPago, MercadoPago
from app.controle.models import Cliente, Cobranca, ConfigCobranca, SessaoControle
from app.core import tenancy
from app.core.db import agora

log = logging.getLogger(__name__)

COBRAVEIS = ("ativo", "suspenso")  # em teste não paga; inativo não tem acesso


class RegraCobranca(Exception):
    pass


# ---------------------------------------------------------------- configuração
def config(db) -> ConfigCobranca:
    cfg = db.scalar(select(ConfigCobranca).limit(1))
    if cfg is None:
        cfg = ConfigCobranca(dia_vencimento=10, gerar_automatico=True, regua=[-3, 0, 3, 10])
        db.add(cfg)
        db.flush()
    return cfg


def token(cfg: ConfigCobranca) -> str | None:
    from app.core.security import decifrar

    return decifrar(cfg.mp_token_cifrado).decode() if cfg.mp_token_cifrado else None


def segredo(cfg: ConfigCobranca) -> str | None:
    from app.core.security import decifrar

    return decifrar(cfg.mp_segredo_cifrado).decode() if cfg.mp_segredo_cifrado else None


def mp(cfg: ConfigCobranca) -> MercadoPago:
    t = token(cfg)
    if not t:
        raise RegraCobranca("Conecte a conta do Mercado Pago em Cobranças › Mercado Pago antes de gerar links.")
    return MercadoPago(t)


def _publico() -> str | None:
    """Endereço público do admin (onde o Mercado Pago avisa e para onde o cliente volta). Só https serve ao MP."""
    from app.controle import service

    host = service.endereco_do_painel()
    return f"https://{host}" if host else None


def url_notificacao() -> str | None:
    base = _publico()
    return f"{base}/api/public/mercadopago" if base else None


def _url_cliente(c: Cliente) -> str | None:
    """Para onde o cliente volta depois de pagar: o "Meu plano" no próprio endereço dele."""
    dom = c.dominios[0].host if c.dominios else None
    if dom:
        return f"https://{dom}/minha-conta/plano"
    from app.core.config import settings

    base = settings.frontend_url.rstrip("/")
    return f"{base}/minha-conta/plano" if base.startswith("https://") else None


# ---------------------------------------------------------------- valores
def uso(c: Cliente, ano: int, mes: int) -> dict:
    """Usuários com acesso (hoje) e NFS-e reais emitidas no mês, contra os limites do plano."""
    from app.core.db import SessionLocal
    from app.core.models import Usuario
    from app.modules.rpa_nfse.models import Nfse, StatusNfse

    p = c.plano
    inicio = datetime(ano, mes, 1)
    fim = datetime(ano + (mes == 12), mes % 12 + 1, 1)
    with tenancy.usando(tenancy.Escritorio(slug=c.slug, banco=c.banco)), SessionLocal() as db:
        usuarios = db.scalar(select(func.count(Usuario.id)).where(Usuario.ativo, Usuario.acesso_sistema)) or 0
        notas = db.scalar(select(func.count(Nfse.id)).where(Nfse.status == StatusNfse.emitida, Nfse.simulada.is_(False),
                                                            Nfse.data_emissao >= inicio, Nfse.data_emissao < fim)) or 0
    exc_u = max(0, usuarios - p.usuarios) if p and p.usuarios else 0
    exc_n = max(0, notas - p.notas_mes) if p and p.notas_mes is not None else 0
    extra = (exc_u * p.preco_usuario_adicional + exc_n * p.preco_nota_excedente) if p else Decimal(0)
    return {"mes": f"{ano:04d}-{mes:02d}", "usuarios": usuarios, "limite_usuarios": p.usuarios if p else None,
            "notas_mes": notas, "limite_notas": p.notas_mes if p else None, "usuarios_excedentes": exc_u,
            "notas_excedentes": exc_n, "valor_excedente": extra}


def valor_do_plano(db, c: Cliente) -> Decimal | None:
    """Mensalidade (ou anuidade) já com o desconto por indicação."""
    if not c.plano:
        return None
    bruto = c.plano.preco_anual if c.ciclo == "anual" else c.plano.preco_mensal
    _, pct = indicacao.desconto(db, c)
    return indicacao.aplicar(bruto, pct)


def _mes_anterior(ano: int, mes: int) -> tuple[int, int]:
    return (ano - 1, 12) if mes == 1 else (ano, mes - 1)


def itens_da_mensalidade(db, c: Cliente, ano: int, mes: int) -> list[dict]:
    itens: list[dict] = []
    nome_mes = f"{mes:02d}/{ano}"
    aniversario = (c.inicio_contrato or c.criado_em.date()).month == mes
    if c.plano and c.forma_pagamento != "cartao" and (c.ciclo == "mensal" or aniversario):
        bruto = c.plano.preco_anual if c.ciclo == "anual" else c.plano.preco_mensal
        rotulo = "anuidade" if c.ciclo == "anual" else "mensalidade"
        itens.append({"descricao": f"Plano {c.plano.nome} ({rotulo} {nome_mes})", "valor": f"{bruto:.2f}"})
        n, pct = indicacao.desconto(db, c)
        if pct:
            desc = bruto - indicacao.aplicar(bruto, pct)
            itens.append({"descricao": f"Desconto por indicação ({n} indicado(s), {pct:g}%)", "valor": f"{-desc:.2f}"})
    if c.plano:
        a, m = _mes_anterior(ano, mes)
        u = uso(c, a, m)
        if u["notas_excedentes"]:
            v = u["notas_excedentes"] * c.plano.preco_nota_excedente
            itens.append({"descricao": f"{u['notas_excedentes']} nota(s) além do plano em {m:02d}/{a}", "valor": f"{v:.2f}"})
        if u["usuarios_excedentes"]:
            v = u["usuarios_excedentes"] * c.plano.preco_usuario_adicional
            itens.append({"descricao": f"{u['usuarios_excedentes']} usuário(s) adicional(is)", "valor": f"{v:.2f}"})
    return itens


def _vencimento(cfg: ConfigCobranca, ano: int, mes: int) -> date:
    dia = min(max(cfg.dia_vencimento, 1), 28)
    return date(ano, mes, dia)


# ---------------------------------------------------------------- criar cobranças
def gerar_mensalidade(db, c: Cliente, ano: int, mes: int) -> Cobranca | None:
    """Idempotente: uma mensalidade por cliente e mês. None quando não há nada a cobrar."""
    comp = f"{ano:04d}-{mes:02d}"
    if db.scalar(select(Cobranca.id).where(Cobranca.cliente_id == c.id, Cobranca.tipo == "mensalidade",
                                           Cobranca.competencia == comp)):
        return None
    itens = itens_da_mensalidade(db, c, ano, mes)
    total = sum((Decimal(i["valor"]) for i in itens), Decimal(0))
    if total <= 0:
        return None
    cfg = config(db)
    cob = Cobranca(cliente_id=c.id, tipo="mensalidade", competencia=comp, descricao=f"MayaJus {mes:02d}/{ano}",
                   itens=itens, valor=total, vencimento=_vencimento(cfg, ano, mes), status="pendente", avisos=[])
    db.add(cob)
    db.flush()
    return cob


def avulsa(db, c: Cliente, descricao: str, valor: Decimal, vencimento: date) -> Cobranca:
    if valor <= 0:
        raise RegraCobranca("O valor precisa ser maior que zero.")
    cob = Cobranca(cliente_id=c.id, tipo="avulsa", descricao=descricao, valor=valor, vencimento=vencimento,
                   itens=[{"descricao": descricao, "valor": f"{valor:.2f}"}], status="pendente", avisos=[])
    db.add(cob)
    db.flush()
    return cob


def criar_link(db, cob: Cobranca) -> str:
    """Link do Mercado Pago (Pix, cartão ou boleto). Reaproveita o que já existe."""
    if cob.link:
        return cob.link
    cfg = config(db)
    c = cob.cliente
    r = mp(cfg).preferencia(ref=f"cob:{cob.id}", titulo=f"{cob.descricao} — {c.nome}", valor=cob.valor,
                            email=c.email_financeiro, notificacao=url_notificacao(), voltar=_url_cliente(c))
    cob.mp_preferencia_id = r.get("id")
    cob.link = r.get("init_point")
    return cob.link


def assinar_cartao(db, c: Cliente) -> str:
    """Link para o cliente cadastrar o cartão: o Mercado Pago passa a debitar a mensalidade todo mês."""
    if not c.plano:
        raise RegraCobranca("Defina o plano do cliente antes de criar a assinatura.")
    if c.ciclo == "anual":
        raise RegraCobranca("A assinatura no cartão é mensal. No plano anual, use o link de pagamento.")
    if not c.email_financeiro:
        raise RegraCobranca("Informe o e-mail do financeiro na ficha: o Mercado Pago exige o e-mail de quem paga.")
    voltar = _url_cliente(c) or _publico()
    if not voltar:
        raise RegraCobranca("Cadastre o domínio do admin para o Mercado Pago saber para onde voltar.")
    cfg = config(db)
    cliente_mp = mp(cfg)
    if c.mp_assinatura_id and c.mp_assinatura_status not in ("cancelled",):
        try:
            cliente_mp.alterar_assinatura(c.mp_assinatura_id, status="cancelled")
        except ErroMercadoPago:
            log.warning("Não deu para cancelar a assinatura antiga %s", c.mp_assinatura_id)
    r = cliente_mp.assinatura(ref=f"cli:{c.id}", titulo=f"MayaJus — plano {c.plano.nome}", valor=valor_do_plano(db, c),
                              email=c.email_financeiro, voltar=voltar, notificacao=url_notificacao())
    c.mp_assinatura_id = r.get("id")
    c.mp_assinatura_status = r.get("status") or "pending"
    c.forma_pagamento = "cartao"
    return r.get("init_point")


def plano_mudou(db, c: Cliente) -> None:
    """Upgrade/downgrade: a assinatura no cartão passa a debitar o valor novo a partir do próximo mês."""
    if c.forma_pagamento == "cartao" and c.mp_assinatura_id and c.mp_assinatura_status == "authorized":
        mp(config(db)).alterar_assinatura(c.mp_assinatura_id, valor=valor_do_plano(db, c))


def dar_baixa(cob: Cobranca, forma: str, pagamento_id: str | None = None, quando: datetime | None = None) -> bool:
    if cob.status == "paga":
        return False
    cob.status = "paga"
    cob.forma_paga = forma
    cob.mp_pagamento_id = pagamento_id or cob.mp_pagamento_id
    cob.pago_em = quando or agora()
    return True


# ---------------------------------------------------------------- notificações do Mercado Pago
def processar_notificacao(db, tipo: str, recurso_id: str) -> str:
    cfg = config(db)
    cliente_mp = mp(cfg)
    if tipo == "payment":
        p = cliente_mp.pagamento(recurso_id)
        ref = p.get("external_reference") or ""
        if not ref.startswith("cob:") or p.get("status") != "approved":
            return f"pagamento {recurso_id}: {p.get('status')} ({ref or 'sem referência'})"
        cob = db.get(Cobranca, int(ref[4:]))
        if cob is None:
            return f"cobrança {ref} não existe"
        pago = _data_mp(p.get("date_approved"))
        if dar_baixa(cob, FORMAS.get(p.get("payment_type_id"), p.get("payment_type_id") or "Mercado Pago"),
                     str(p.get("id")), pago):
            _avisar_pagamento(cob)
        return f"{ref} paga"
    if tipo in ("subscription_preapproval", "preapproval"):
        a = cliente_mp.ler_assinatura(recurso_id)
        c = db.scalar(select(Cliente).where(Cliente.mp_assinatura_id == recurso_id))
        if c:
            c.mp_assinatura_status = a.get("status")
        return f"assinatura {recurso_id}: {a.get('status')}"
    if tipo == "subscription_authorized_payment":
        a = cliente_mp.pagamento_da_assinatura(recurso_id)
        c = db.scalar(select(Cliente).where(Cliente.mp_assinatura_id == a.get("preapproval_id")))
        pag = a.get("payment") or {}
        if not c or pag.get("status") != "approved":
            return f"débito {recurso_id}: {pag.get('status')}"
        quando = _data_mp(a.get("debit_date") or a.get("date_created")) or agora()
        comp = f"{quando:%Y-%m}"
        cob = db.scalar(select(Cobranca).where(Cobranca.cliente_id == c.id, Cobranca.tipo == "cartao",
                                               Cobranca.competencia == comp))
        if cob is None:
            valor = Decimal(str(a.get("transaction_amount") or 0))
            cob = Cobranca(cliente_id=c.id, tipo="cartao", competencia=comp, descricao=f"MayaJus {quando:%m/%Y} (cartão)",
                           itens=[{"descricao": f"Plano {c.plano.nome if c.plano else ''} — assinatura", "valor": f"{valor:.2f}"}],
                           valor=valor, vencimento=quando.date(), status="pendente", avisos=[])
            db.add(cob)
            db.flush()
        if dar_baixa(cob, "cartão (assinatura)", str(pag.get("id") or recurso_id), quando):
            _avisar_pagamento(cob)
        return f"débito da assinatura de {c.slug} em {comp}"
    return f"tipo {tipo} ignorado"


def _data_mp(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------- e-mails (pelo SMTP configurado no admin)
def enviar_email(para: list[str], assunto: str, corpo: str) -> None:
    from app.controle import service

    service.enviar_email(para, assunto, corpo)


def _moeda(v: Decimal) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _texto_itens(cob: Cobranca) -> str:
    return "\n".join(f"  • {i['descricao']}: {_moeda(Decimal(i['valor']))}" for i in cob.itens or [])


def enviar_cobranca(db, cob: Cobranca, passo: int | None = None) -> list[str]:
    c = cob.cliente
    para = [e for e in [c.email_financeiro] if e]
    if not para:
        raise RegraCobranca(f"{c.nome} não tem e-mail do financeiro na ficha.")
    link = criar_link(db, cob)
    venc = f"{cob.vencimento:%d/%m/%Y}"
    if passo is None or passo < 0:
        assunto = f"MayaJus — {cob.descricao}: vence em {venc}"
        abertura = f"Segue a cobrança do MayaJus, com vencimento em {venc}."
    elif passo == 0:
        assunto = f"MayaJus — {cob.descricao} vence hoje"
        abertura = "Lembrete: a cobrança do MayaJus vence hoje."
    else:
        assunto = f"MayaJus — {cob.descricao} em aberto"
        abertura = (f"Ainda não identificamos o pagamento da cobrança que venceu em {venc}. Se já pagou, "
                    "desconsidere este aviso.")
    corpo = (f"Olá, {c.responsavel or c.nome}.\n\n{abertura}\n\n{_texto_itens(cob)}\n\nTotal: {_moeda(cob.valor)}\n\n"
             f"Pague por Pix, cartão ou boleto neste link:\n{link}\n\nQualquer dúvida, é só responder este e-mail.\n\n"
             "MayaCorp")
    enviar_email(para, assunto, corpo)
    return para


def _avisar_pagamento(cob: Cobranca) -> None:
    c = cob.cliente
    if not c.email_financeiro:
        return
    try:
        enviar_email([c.email_financeiro], f"MayaJus — pagamento recebido ({cob.descricao})",
                     f"Olá, {c.responsavel or c.nome}.\n\nRecebemos o pagamento de {_moeda(cob.valor)} "
                     f"({cob.descricao}). Obrigado!\n\nMayaCorp")
    except Exception:
        log.exception("Aviso de pagamento da cobrança %s falhou", cob.id)


# ---------------------------------------------------------------- rotina diária (worker)
def rotina_diaria(hoje: date | None = None) -> dict:
    """Gera as mensalidades do mês (se automático) e manda os e-mails da régua. Atraso só gera aviso."""
    hoje = hoje or date.today()
    feitos = {"geradas": 0, "avisos": 0}
    with SessaoControle() as db:
        cfg = config(db)
        db.commit()
        if not cfg.mp_token_cifrado:
            return feitos
        if cfg.gerar_automatico:
            for c in db.scalars(select(Cliente).where(Cliente.tipo == "escritorio", Cliente.status.in_(COBRAVEIS))):
                try:
                    cob = gerar_mensalidade(db, c, hoje.year, hoje.month)
                    db.commit()
                    feitos["geradas"] += bool(cob)
                except Exception:
                    db.rollback()
                    log.exception("Mensalidade de %s falhou", c.slug)
        regua = sorted(set(cfg.regua or []))
        pendentes = db.scalars(select(Cobranca).where(Cobranca.status == "pendente", Cobranca.tipo != "cartao"))
        for cob in pendentes:
            devidos = [p for p in regua if hoje >= cob.vencimento + timedelta(days=p) and p not in (cob.avisos or [])]
            if not devidos:
                continue
            try:
                enviar_cobranca(db, cob, max(devidos))  # só o passo mais recente: nunca vários e-mails de uma vez
                cob.avisos = sorted({*(cob.avisos or []), *devidos})
                db.commit()
                feitos["avisos"] += 1
            except Exception:
                db.rollback()
                log.exception("Aviso da cobrança %s falhou", cob.id)
    return feitos
