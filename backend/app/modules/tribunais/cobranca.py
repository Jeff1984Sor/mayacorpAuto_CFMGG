"""Medição de uso (seção 18): franquia mensal de créditos + excedente por faixa + setup de importação.

Só conta protocolo com sucesso (simulado e registro manual não contam). Um lançamento por retorno; estorno é outro
lançamento, negativo, com motivo.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.models import Usuario
from app.modules.tribunais.models import Consumo, FaixaSetup, PesoProtocolo, Plano, RetornoProtocolo


def ciclo(d: date | None = None) -> str:
    return f"{(d or date.today()):%Y-%m}"


def peso(db: Session, tipo: str) -> int:
    p = db.get(PesoProtocolo, tipo)
    return p.creditos if p else 1


def plano_do(db: Session, tenant_id: int) -> Plano | None:
    from app.modules.tribunais.service import config

    cfg = config(db, tenant_id)
    return db.get(Plano, cfg.plano_id) if cfg.plano_id else None


def _franquia(db: Session, tenant_id: int, plano: Plano | None, c: str) -> int:
    if not plano:
        return 0
    if not plano.creditos_acumulam:
        return plano.creditos_protocolo_mes
    # acumulam: sobra dos ciclos anteriores (desde o 1º lançamento) entra na franquia
    ciclos = sorted(set(db.scalars(select(Consumo.ciclo).where(Consumo.tenant_id == tenant_id, Consumo.ciclo < c))))
    sobra = 0
    for anterior in ciclos:
        usado = _usado(db, tenant_id, anterior)
        sobra = max(0, sobra + plano.creditos_protocolo_mes - usado)
    return plano.creditos_protocolo_mes + sobra


def _usado(db: Session, tenant_id: int, c: str) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(Consumo.creditos), 0)).where(
        Consumo.tenant_id == tenant_id, Consumo.ciclo == c, Consumo.origem.in_(("protocolo", "ajuste", "estorno")))) or 0)


def _preco_unidade(plano: Plano, excedente_n: int) -> Decimal:
    for f in plano.faixas:
        if f.de_creditos <= excedente_n and (f.ate_creditos is None or excedente_n <= f.ate_creditos):
            return Decimal(f.preco_por_credito)
    return Decimal(plano.faixas[-1].preco_por_credito) if plano.faixas else Decimal("0")


def uso(db: Session, tenant_id: int, c: str | None = None) -> dict:
    c = c or ciclo()
    plano = plano_do(db, tenant_id)
    franquia = _franquia(db, tenant_id, plano, c)
    usado = _usado(db, tenant_id, c)
    valor_exc = db.scalar(select(func.coalesce(func.sum(Consumo.valor), 0)).where(
        Consumo.tenant_id == tenant_id, Consumo.ciclo == c, Consumo.origem.in_(("protocolo", "ajuste", "estorno")))) or 0
    return {"ciclo": c, "plano": plano.nome if plano else None, "franquia": franquia, "usado": usado,
            "excedente": max(0, usado - franquia) if plano else 0, "percentual": round(usado * 100 / franquia) if franquia else None,
            "valor_excedente": Decimal(valor_exc), "permite_excedente": plano.permite_excedente if plano else True}


def pode_protocolar(db: Session, tenant_id: int, tipo: str) -> tuple[bool, str | None]:
    """Regra 5: sem excedente permitido, bloqueia NOVOS protocolos ao esgotar (nunca no meio de um envio)."""
    plano = plano_do(db, tenant_id)
    if not plano:
        return True, None
    u = uso(db, tenant_id)
    n = peso(db, tipo)
    if u["usado"] + n > u["franquia"]:
        if not plano.permite_excedente:
            return False, (f"A franquia de {u['franquia']} créditos do plano {plano.nome} acabou neste mês "
                           f"({u['usado']} usados; esta petição usa {n}). Fale com a MayaCorp para ampliar o plano.")
        if plano.limite_excedente_mes is not None and u["usado"] + n - u["franquia"] > plano.limite_excedente_mes:
            return False, f"O teto de excedente do mês ({plano.limite_excedente_mes} créditos) foi atingido."
    return True, None


def lancar_protocolo(db: Session, r: RetornoProtocolo) -> Consumo | None:
    if not r.sucesso or r.simulado or r.manual:
        return None
    prot = r.protocolo
    outros = [x.id for x in prot.retornos if x.id != r.id and x.sucesso]
    if db.scalar(select(Consumo.id).where(Consumo.tenant_id == prot.tenant_id, Consumo.origem == "protocolo",
                                          Consumo.referencia_id.in_([r.id, *outros]))):
        return None  # regra 3: reenviado com sucesso conta uma vez
    c = ciclo(r.criado_em.date() if r.criado_em else None)
    plano = plano_do(db, prot.tenant_id)
    n = peso(db, prot.tipo)
    franquia = _franquia(db, prot.tenant_id, plano, c)
    usado = _usado(db, prot.tenant_id, c)
    valor = Decimal("0")
    dentro = True
    if plano:
        for u in range(usado + 1, usado + n + 1):
            if u > franquia:
                dentro = False
                valor += _preco_unidade(plano, u - franquia)
    lanc = Consumo(tenant_id=prot.tenant_id, ciclo=c, origem="protocolo", referencia_id=r.id, creditos=n, dentro_franquia=dentro,
                   valor=valor, motivo=f"Protocolo #{prot.id} ({prot.tipo})")
    db.add(lanc)
    db.flush()
    _avisar_franquia(db, prot.tenant_id, plano, c, franquia, usado + n)
    return lanc


def _avisar_franquia(db: Session, tenant_id: int, plano: Plano | None, c: str, franquia: int, usado: int) -> None:
    """Regra 4: alerta em 80% e 100% da franquia (uma vez por ciclo)."""
    from app.modules.tribunais.service import alertar, config

    if not plano or not franquia:
        return
    cfg = config(db, tenant_id)
    avisados = list(cfg.alerta_franquia or [])
    for limiar in (80, 100):
        chave = f"{c}:{limiar}"
        if usado * 100 >= franquia * limiar and chave not in avisados:
            avisados.append(chave)
            alertar(db, tenant_id, "franquia", f"O escritório usou {usado} de {franquia} créditos de protocolo do plano {plano.nome} "
                    f"em {c} ({limiar}%).", severidade="aviso" if limiar == 80 else "erro")
    cfg.alerta_franquia = avisados


def lancar_importacao(db: Session, tenant_id: int, varredura_id: int, quantidade: int) -> Consumo | None:
    """Setup cobrado uma vez por varredura importada, pela faixa de quantidade de processos novos."""
    if quantidade <= 0 or db.scalar(select(Consumo.id).where(Consumo.tenant_id == tenant_id, Consumo.origem == "importacao",
                                                              Consumo.referencia_id == varredura_id)):
        return None
    faixa = next((f for f in db.scalars(select(FaixaSetup).order_by(FaixaSetup.de_processos))
                  if f.de_processos <= quantidade and (f.ate_processos is None or quantidade <= f.ate_processos)), None)
    lanc = Consumo(tenant_id=tenant_id, ciclo=ciclo(), origem="importacao", referencia_id=varredura_id, creditos=0,
                   quantidade=quantidade, dentro_franquia=faixa is None, valor=Decimal(faixa.preco) if faixa else Decimal("0"),
                   motivo=f"Importação de {quantidade} processo(s) (varredura #{varredura_id})")
    db.add(lanc)
    db.flush()
    return lanc


def estornar(db: Session, consumo: Consumo, motivo: str, usuario: Usuario) -> Consumo:
    if consumo.origem == "estorno":
        raise ValueError("Não dá para estornar um estorno.")
    if db.scalar(select(Consumo.id).where(Consumo.tenant_id == consumo.tenant_id, Consumo.origem == "estorno",
                                          Consumo.referencia_id == consumo.id)):
        raise ValueError("Este lançamento já foi estornado.")
    e = Consumo(tenant_id=consumo.tenant_id, ciclo=ciclo(), origem="estorno", referencia_id=consumo.id, creditos=-consumo.creditos,
                quantidade=consumo.quantidade, dentro_franquia=consumo.dentro_franquia, valor=-Decimal(consumo.valor), motivo=motivo,
                criado_por_id=usuario.id)
    db.add(e)
    db.flush()
    return e


def fechamento(db: Session, tenant_id: int, c: str) -> dict:
    """Regra 6: o ciclo fecha em mensalidade + excedente + setups do mês."""
    plano = plano_do(db, tenant_id)
    lancs = list(db.scalars(select(Consumo).where(Consumo.tenant_id == tenant_id, Consumo.ciclo == c).order_by(Consumo.id)))
    excedente = sum((Decimal(x.valor) for x in lancs if x.origem in ("protocolo", "ajuste", "estorno")
                     and not (x.origem == "estorno" and x.quantidade)), Decimal("0"))
    setups = sum((Decimal(x.valor) for x in lancs if x.origem == "importacao" or (x.origem == "estorno" and x.quantidade)), Decimal("0"))
    mensalidade = Decimal(plano.preco_mensal) if plano else Decimal("0")
    return {"ciclo": c, "plano": plano.nome if plano else None, "mensalidade": mensalidade, "excedente": excedente, "setups": setups,
            "total": mensalidade + excedente + setups, "uso": uso(db, tenant_id, c), "lancamentos": lancs}
