"""Emissão das notas de um lote pelo Sistema Nacional NFS-e (uma DPS por recibo, síncrona).

Mesmo lote, mesma tela e mesma fatura (NH) da emissão pela Prefeitura de São Paulo: muda só o caminho. A nota
fica guardada com a chave de acesso de 50 dígitos. Cada escritório usa o certificado da própria empresa emissora.
"""

import logging
from decimal import Decimal

from app.core.documentos import so_digitos
from app.modules.rpa_nfse.models import Emissora, Rps, StatusRps
from app.modules.rpa_nfse.nfse_nacional import dps as D
from app.modules.rpa_nfse.nfse_nacional.cliente import ClienteNacional, RetornoNacional
from app.modules.rpa_nfse.prefeitura_sp.cliente import FalhaComunicacao

log = logging.getLogger(__name__)

CONSULTA_PUBLICA = "https://www.nfse.gov.br/ConsultaPublica"
# o governo devolve este erro quando a DPS já virou nota: aí a nota é recuperada, não reemitida
JA_EMITIDA = ("E0014",)


def prestador(e: Emissora) -> D.Prestador:
    regime = e.regime.value if hasattr(e.regime, "value") else str(e.regime)
    opcao = D.OPCAO_DO_REGIME.get(regime, D.NAO_OPTANTE)
    return D.Prestador(
        documento=e.cnpj, codigo_municipio=so_digitos(e.codigo_municipio), opcao_simples=opcao,
        regime_apuracao_sn="1" if opcao == D.ME_EPP else None,  # 1 = tributos federais e municipal pelo Simples
        inscricao_municipal=so_digitos(e.ccm) or None, telefone=e.telefone, email=e.email,
    )


def montar_dps(r: Rps, e: Emissora, ambiente: str) -> D.Dps:
    t = (r.dados_json or {}).get("tomador", {}) or {}
    logradouro = " ".join(x for x in [t.get("tipo_logradouro"), t.get("logradouro")] if x).strip()
    tomador = D.Tomador(
        nome=t.get("nome") or "", documento=so_digitos(t.get("cpf_cnpj")), codigo_municipio=t.get("codigo_municipio"),
        cep=t.get("cep"), logradouro=logradouro or None, numero=t.get("numero"), complemento=t.get("complemento"),
        bairro=t.get("bairro"), email=t.get("email"), telefone=t.get("telefone"),
    ) if t.get("nome") else None
    p = prestador(e)
    return D.Dps(
        prestador=p, serie=str(r.serie), numero=int(r.numero), competencia=r.data_emissao,
        cod_tributacao_nacional=so_digitos(e.cod_trib_nacional), descricao=r.discriminacao or "", valor=Decimal(r.valor),
        tomador=tomador, ambiente=ambiente, iss_retido=bool(r.iss_retido),
        aliquota_iss=(Decimal(r.aliquota) * 100) if p.opcao_simples == D.NAO_OPTANTE and r.aliquota else None,
    )


def problemas_humanos(ret: RetornoNacional) -> list[dict]:
    saida = []
    for e in ret.erros:
        h = e.humano()
        texto = h["mensagem"] + (f" ({h['detalhe']})" if h.get("detalhe") else "") + (f" [código {h['codigo']}]" if h.get("codigo") else "")
        saida.append({"campo": "sistema_nacional", "nivel": "erro", "mensagem": texto, "acao": h.get("acao") or ""})
    return saida or [{"campo": "sistema_nacional", "nivel": "erro", "mensagem": "O Sistema Nacional recusou a nota.", "acao": ""}]


def emitir_um(cliente: ClienteNacional, r: Rps, e: Emissora, salvar, rejeitar, gravar) -> bool:
    """Emite um recibo. `salvar(r, ret)` grava a nota; `rejeitar(r, problemas)` recusa; `gravar()` dá commit.

    Antes de enviar, o Id da DPS fica gravado no recibo: se a conexão cair, a próxima tentativa pergunta ao governo
    se aquela DPS já virou nota, em vez de mandar de novo. Devolve True se a nota saiu.
    """
    try:
        d = montar_dps(r, e, cliente.ambiente)
        xml = D.gerar(d, cliente.cert)
    except D.DpsInvalida as ex:
        rejeitar(r, [{"campo": "dps", "nivel": "erro", "mensagem": m, "acao": "Corrija o cadastro e reprocesse."} for m in ex.erros[:5]])
        return False
    id_dps = D.id_dps(d.prestador, d.serie, d.numero)
    dados = dict(r.dados_json or {})
    ja_tentou = dados.get("id_dps") == id_dps
    dados["id_dps"] = id_dps
    r.dados_json = dados
    gravar()
    if ja_tentou:  # tentativa anterior caiu no meio: a nota pode já existir
        recuperada = _recuperar(cliente, id_dps)
        if recuperada:
            salvar(r, recuperada)
            return True
    ret = cliente.emitir(xml)  # FalhaComunicacao sobe: o recibo volta para a fila e o lote para
    if not ret.sucesso and any((x.codigo or "").upper() in JA_EMITIDA for x in ret.erros):
        recuperada = _recuperar(cliente, id_dps)
        if recuperada:
            salvar(r, recuperada)
            return True
    if ret.sucesso:
        salvar(r, ret)
        return True
    rejeitar(r, problemas_humanos(ret))
    return False


def _recuperar(cliente: ClienteNacional, id_dps: str) -> RetornoNacional | None:
    try:
        chave = cliente.chave_da_dps(id_dps)
        if not chave:
            return None
        ret = cliente.consultar(chave)
        return ret if ret.sucesso else RetornoNacional(sucesso=True, chave_acesso=chave)
    except FalhaComunicacao:
        return None


def link(chave_acesso: str | None) -> str:
    """Onde qualquer pessoa confere a nota: a consulta pública do portal nacional (pela chave de acesso)."""
    return CONSULTA_PUBLICA


__all__ = ["StatusRps", "emitir_um", "link", "montar_dps", "prestador"]
