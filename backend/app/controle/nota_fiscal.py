"""NFS-e da mensalidade: quando a cobrança de um escritório é paga, o admin da MayaCorp emite a nota para ele.

A nota nasce no banco do admin (escritório "mayacorp"), pela empresa emissora da MayaCorp e com o certificado
dela; na cobrança (banco de controle) fica só o resumo: número, chave de acesso, situação e o erro, se houver.
Nenhum dado de um escritório cliente vai para outro: a nota é da MayaCorp para o escritório que pagou.
"""

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.controle.models import Cliente, Cobranca, ConfigCobranca, SessaoControle
from app.core import tenancy
from app.core.db import SessionLocal, agora

log = logging.getLogger(__name__)

DESCRICAO_PADRAO = "Licença de uso do sistema MayaJus - {descricao}"
_fila = ThreadPoolExecutor(max_workers=1, thread_name_prefix="nfse-mensalidade")
EM_SEGUNDO_PLANO = True  # os testes desligam para rodar na hora


class ErroNotaMensalidade(ValueError):
    pass


def escritorio_mayacorp() -> tenancy.Escritorio | None:
    with SessaoControle() as db:
        c = db.scalar(select(Cliente).where(Cliente.tipo == "mayacorp").order_by(Cliente.id))
        return tenancy.Escritorio(slug=c.slug, banco=c.banco, mayacorp=True) if c else None


def _config(db) -> ConfigCobranca:
    from app.controle.cobranca import config

    return config(db)


def apos_pagamento(ids: list[int]) -> None:
    """Chamado depois do commit da baixa: com a emissão automática ligada, a nota sai em segundo plano."""
    if not ids:
        return
    with SessaoControle() as db:
        if not _config(db).nfse_automatica:
            return
    for cid in dict.fromkeys(ids):
        if EM_SEGUNDO_PLANO:
            _fila.submit(_emitir_sem_erro, cid)
        else:
            _emitir_sem_erro(cid)


def _emitir_sem_erro(cob_id: int) -> None:
    try:
        emitir(cob_id)
    except Exception:  # noqa: BLE001 — a falha fica registrada na cobrança, nunca derruba quem chamou
        log.exception("NFS-e da cobrança %s falhou", cob_id)


def _registrar(cob_id: int, **campos) -> None:
    with SessaoControle() as db:
        cob = db.get(Cobranca, cob_id)
        for k, v in campos.items():
            setattr(cob, k, v)
        db.commit()


def emitir(cob_id: int, *, de_novo: bool = False) -> Cobranca:
    """Emite a NFS-e de uma cobrança paga. Uma nota por cobrança: só refaz se a anterior deu erro ou foi cancelada."""
    with SessaoControle() as db:
        cob = db.get(Cobranca, cob_id)
        if cob is None:
            raise ErroNotaMensalidade("Cobrança não encontrada.")
        if cob.status != "paga":
            raise ErroNotaMensalidade("A nota só é emitida depois que a cobrança é paga.")
        # de_novo: quem chama já conferiu que a nota anterior foi cancelada no admin
        if cob.nfse_status in ("emitida", "emitindo") and not de_novo:
            raise ErroNotaMensalidade(f"Esta cobrança já tem NFS-e (situação: {cob.nfse_status}). "
                                      "Para emitir outra, cancele a nota antes em Notas emitidas.")
        cfg = _config(db)
        cli = cob.cliente
        # o texto configurado fala da licença do MayaJus: vale para a mensalidade e para as cobranças de quem usa o
        # sistema. Serviço recorrente e cliente sem acesso ao sistema levam na nota a própria descrição da cobrança.
        outro_servico = cob.tipo == "recorrente" or cli.tipo == "externo"
        dados = {"valor": Decimal(cob.valor), "descricao": cob.descricao, "competencia": cob.competencia,
                 "cliente_id": cli.id, "nome": cli.nome,
                 "emissora_id": cfg.nfse_emissora_id,
                 "texto": "{descricao}" if outro_servico else (cfg.nfse_descricao or DESCRICAO_PADRAO),
                 "pago_em": cob.pago_em.date() if cob.pago_em else date.today()}
        cob.nfse_status, cob.nfse_erro = "emitindo", None
        db.commit()
    try:
        esc = escritorio_mayacorp()
        if esc is None:
            raise ErroNotaMensalidade("O escritório MayaCorp (admin) não foi encontrado.")
        resultado = _emitir_no_admin(esc, cob_id, dados)
    except Exception as e:  # noqa: BLE001
        msg = str(e) if isinstance(e, ErroNotaMensalidade) else f"Falha inesperada ao emitir: {e}"
        _registrar(cob_id, nfse_status="erro", nfse_erro=msg[:500])
        if isinstance(e, ErroNotaMensalidade):
            raise
        raise ErroNotaMensalidade(msg) from e
    _registrar(cob_id, **resultado)
    with SessaoControle() as db:
        cob = db.get(Cobranca, cob_id)
        db.expunge(cob)
        return cob


def _tomador_do_cliente(db, d: dict):
    """O cadastro completo do cliente (o mesmo de Cadastros › Clientes do admin), já conferido: se falta algo que a
    nota exige, a emissão para aqui com a lista do que falta, em vez de ir ao governo e voltar recusada."""
    from app.controle import cadastro
    from app.core.models import Tenant
    from app.modules.rpa_nfse import service as nfse

    tenant_id = db.scalar(select(Tenant.id).order_by(Tenant.id))
    with SessaoControle() as ctl:
        cli = ctl.get(Cliente, d["cliente_id"])
        tom = cadastro.ligar(db, tenant_id, cli)
        if tom is not None:
            cadastro.aplicar_no_cliente(cli, tom)
        motivo = None if tom is not None else (cadastro.conflito(db, tenant_id, cli) or "o cadastro completo")
        db.commit()  # a ligação fica feita mesmo que a nota não saia
        ctl.commit()
        nome = cli.nome
    falta = [motivo] if motivo else nfse.pendencias_para_nota(tom)
    if falta:
        lista = falta[0] if len(falta) == 1 else ", ".join(falta[:-1]) + " e " + falta[-1]
        raise ErroNotaMensalidade(f"Cadastro de {nome} incompleto para emitir a nota: falta {lista}. "
                                  f"Complete em Clientes › {nome} › Dados e emita de novo.")
    return tom


def _emitir_no_admin(esc: tenancy.Escritorio, cob_id: int, d: dict) -> dict:
    from app.controle import cadastro
    from app.modules.rpa_nfse import service as nfse
    from app.modules.rpa_nfse import tasks
    from app.modules.rpa_nfse.models import Emissora, Lote, Nfse, Rps, StatusLote, StatusRps

    with tenancy.usando(esc), SessionLocal() as db:
        tom = _tomador_do_cliente(db, d)
        d = {**d, "nome": tom.nome, "email": cadastro.email_financeiro(tom)}
        q = select(Emissora).where(Emissora.ativa.is_(True)).order_by(Emissora.id)
        emissora = db.get(Emissora, d["emissora_id"]) if d["emissora_id"] else db.scalar(q)
        if emissora is None:
            raise ErroNotaMensalidade("Cadastre a empresa emissora da MayaCorp no admin (Configurações › Empresas emissoras).")
        ok, msg = nfse.saude_emissora(db, emissora)
        if not ok:
            raise ErroNotaMensalidade(f"A empresa emissora não está pronta: {msg}.")
        tenant_id = emissora.tenant_id
        texto = d["texto"].replace("{descricao}", d["descricao"]).replace("{competencia}", d["competencia"] or "")
        assinatura = hashlib.sha256(f"cobranca:{cob_id}:{agora().isoformat()}".encode()).hexdigest()
        lote = Lote(tenant_id=tenant_id, numero=nfse.proximo_numero_lote(db, tenant_id), emissora_id=emissora.id,
                    arquivo_origem=f"Mensalidade: {d['nome']} ({d['descricao']})"[:255], hash_arquivo=assinatura,
                    status=StatusLote.validando, eventos=[])
        lote.evento("upload", f"Nota da cobrança #{cob_id} paga ({d['nome']}).")
        db.add(lote)
        db.flush()
        numero = emissora.prox_rps
        emissora.prox_rps += 1
        tomador_json = {**nfse.tomador_para_rps(tom), "email": d["email"]}
        r = Rps(lote_id=lote.id, emissora_id=emissora.id, linha=1, tipo_rps="RPS", serie=emissora.serie_rps, numero=numero,
                data_emissao=date.today(), situacao="T", tomador_id=tom.id, tomador_novo=False,
                cod_servico=emissora.cod_servico_padrao or "", aliquota=emissora.aliquota_iss, valor=d["valor"],
                deducoes=Decimal(0), iss=Decimal(0), iss_retido=False, discriminacao=texto[:2000],
                dados_json={"tomador": tomador_json, "cobranca_id": cob_id, "problemas_leitura": []},
                status=StatusRps.ok, erros_json=[])
        db.add(r)
        db.flush()
        db.refresh(lote)
        nfse.revalidar(db, lote)
        if r.status == StatusRps.erro:
            problemas = "; ".join(p["mensagem"] for p in r.erros_json if p.get("nivel") == "erro")
            lote.status = StatusLote.descartado
            db.commit()
            raise ErroNotaMensalidade(f"A nota não passou na conferência: {problemas}")
        nfse.enfileirar(db, lote)
        db.commit()
        lote_id, rps_id = lote.id, r.id
    # o robô abre a própria sessão (no mesmo escritório)
    with tenancy.usando(esc):
        tasks.processar_lote(lote_id)
    with tenancy.usando(esc), SessionLocal() as db:
        r = db.get(Rps, rps_id)
        nota = db.scalar(select(Nfse).where(Nfse.rps_id == rps_id))
        if nota is None:
            problemas = "; ".join(p.get("mensagem", "") for p in (r.erros_json or []) if p.get("nivel") == "erro")
            raise ErroNotaMensalidade(problemas or "O governo não devolveu a nota. Tente de novo em instantes.")
        if not nota.envios and d["email"]:  # o escritório recebe a nota por e-mail
            try:
                nfse.enviar_email_nota(db, nota, [d["email"]])
                db.commit()
            except Exception:  # noqa: BLE001 — a nota saiu; o e-mail pode ser reenviado na tela da nota
                log.warning("Nota %s emitida, mas o e-mail não saiu", nota.id, exc_info=True)
        return {"nfse_status": "emitida", "nfse_id": nota.id, "nfse_numero": nota.numero, "nfse_chave": nota.chave_acesso,
                "nfse_erro": None, "nfse_em": agora()}
