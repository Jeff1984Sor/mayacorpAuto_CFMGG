"""E-mail de cobrança ao cliente: o boleto e, quando existem, a fatura (NH/ND) e a NFS-e, tudo na mesma mensagem.

Só sai depois que o banco confirma o registro do boleto: antes disso ele pode ser recusado na hora de pagar.
"""

from pathlib import Path

from sqlalchemy.orm import Session

from app.core.models import ConfigNotificacao, Identidade
from app.modules.boletos import service
from app.modules.boletos.bancos.registry import get_banco
from app.modules.boletos.impressao import imprimir
from app.modules.boletos.models import Boleto, StatusBoleto
from app.modules.boletos.service import ErroBoleto
from app.modules.rpa_nfse.models import StatusFatura, StatusNfse, TipoFatura, Tomador

ENVIAVEIS = (StatusBoleto.registrado, StatusBoleto.em_protesto)


def _limpo(texto: str) -> str:
    return "".join(c for c in texto if c not in '\\/:*?"<>|').strip()


def anexos(db: Session, b: Boleto) -> list[dict]:
    """O que pode ir junto: boleto, fatura (NH ou ND) e NFS-e. Cada item: tipo, nome, mime e como obter os bytes."""
    lista = []
    if b.codigo_barras:
        lista.append({"tipo": "boleto", "nome": f"Boleto - {_limpo(b.seu_numero)}.pdf", "mime": "application/pdf",
                      "rotulo": "Boleto", "bytes": lambda: imprimir(b)})
    f = b.fatura
    if f and f.status != StatusFatura.cancelada and f.pdf_path and Path(f.pdf_path).exists():
        sigla = "ND" if f.tipo == TipoFatura.despesas else "NH"
        lista.append({"tipo": "fatura", "nome": f"{sigla} - {f.numero:05d}.pdf", "mime": "application/pdf",
                      "rotulo": f"Fatura {f.codigo}", "bytes": lambda p=f.pdf_path: Path(p).read_bytes()})
    n = f.nfse if f else None
    if n and n.status != StatusNfse.cancelada and n.pdf_path and Path(n.pdf_path).exists():
        lista.append({"tipo": "nfse", "nome": f"NF - {n.numero}.pdf", "mime": "application/pdf",
                      "rotulo": f"NFS-e {n.numero}", "bytes": lambda p=n.pdf_path: Path(p).read_bytes()})
    return lista


def _moeda(v) -> str:
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def emails_do_pagador(db: Session, b: Boleto) -> list[str]:
    t = db.get(Tomador, b.tomador_id) if b.tomador_id else (b.fatura.tomador if b.fatura else None)
    return [e for e in (t.emails or []) if e] if t else []


def montar(db: Session, b: Boleto) -> dict:
    ident = db.get(Identidade, b.tenant_id)
    escritorio = (ident.nome_exibicao if ident and ident.nome_exibicao else None) or (b.convenio.emissora.razao_social if b.convenio.emissora else "")
    banco = get_banco(b.convenio.banco)
    itens = anexos(db, b)
    referencia = b.fatura.codigo if b.fatura else b.seu_numero
    nomes = ["o boleto" if a["tipo"] == "boleto" else f"a fatura {a['rotulo'][7:]}" if a["tipo"] == "fatura"
             else f"a {a['rotulo']}" for a in itens]
    partes = nomes[0] if len(nomes) == 1 else ", ".join(nomes[:-1]) + " e " + nomes[-1] if nomes else "o boleto"
    assinatura = ident.assinatura_email if ident and ident.assinatura_email else f"Atenciosamente,\n{escritorio}"
    corpo = (
        f"Olá,\n\n"
        f"Segue em anexo: {partes}.\n\n"
        f"Referência: {b.descricao or referencia}\n"
        f"Valor: R$ {_moeda(b.valor)}\n"
        f"Vencimento: {b.data_vencimento:%d/%m/%Y}\n"
        + (f"Linha digitável: {banco.formatar_linha_digitavel(b.linha_digitavel)}\n" if b.linha_digitavel else "")
        + f"\nO boleto pode ser pago em qualquer banco ou aplicativo até o vencimento.\n\n{assinatura}\n"
    )
    aviso = None
    if b.status not in ENVIAVEIS:
        aviso = ("O banco ainda não confirmou o registro deste boleto. Importe o retorno do banco antes de enviar ao cliente."
                 if b.status in (StatusBoleto.rascunho, StatusBoleto.em_remessa)
                 else f"Este boleto está {b.status.value.replace('_', ' ')} e não deve ser enviado.")
    return {
        "para": emails_do_pagador(db, b),
        "assunto": f"Boleto {referencia} - vencimento {b.data_vencimento:%d/%m/%Y} - {escritorio}"[:300],
        "corpo": corpo,
        "anexos": [{"tipo": a["tipo"], "nome": a["nome"], "rotulo": a["rotulo"]} for a in itens],
        "pode_enviar": b.status in ENVIAVEIS, "aviso": aviso,
    }


def enviar(db: Session, b: Boleto, *, destinatarios: list[str] | None = None, cc: list[str] | None = None,
           assunto: str | None = None, corpo: str | None = None, tipos: list[str] | None = None) -> dict:
    """Manda o e-mail. `tipos` escolhe os anexos (padrão: todos os que existem)."""
    from app.core import email as mail

    if b.status not in ENVIAVEIS:
        raise ErroBoleto(montar(db, b)["aviso"] or "Este boleto não pode ser enviado.")
    base = montar(db, b)
    para = list(dict.fromkeys(e.strip().lower() for e in (destinatarios or base["para"]) if e and e.strip()))
    if not para:
        raise ErroBoleto(f"{b.pagador_nome} não tem e-mail cadastrado. Informe o e-mail ou complete o cadastro do cliente.")
    disponiveis = anexos(db, b)
    escolhidos = [a for a in disponiveis if tipos is None or a["tipo"] in tipos]
    if not any(a["tipo"] == "boleto" for a in escolhidos):
        raise ErroBoleto("O boleto precisa ir no e-mail.")
    arquivos = [(a["nome"], a["bytes"](), a["mime"]) for a in escolhidos]
    try:
        mail.enviar(para, (assunto or base["assunto"]).strip()[:300], corpo or base["corpo"], anexos=arquivos,
                    config=db.get(ConfigNotificacao, b.tenant_id), cc=list(dict.fromkeys(cc or [])) or None)
    except Exception as e:  # noqa: BLE001  (SMTP fora do ar, senha errada…: vira mensagem para a pessoa)
        raise ErroBoleto(f"Não consegui enviar o e-mail: {e}") from e
    service.registrar(db, b, "sistema", "00", f"E-mail enviado para {', '.join(para)} ({', '.join(a['rotulo'] for a in escolhidos)})"[:200])
    db.flush()
    return {"destinatarios": para, "anexos": [a["nome"] for a in escolhidos]}
