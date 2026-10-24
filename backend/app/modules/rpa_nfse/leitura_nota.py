"""Lê uma NFS-e que a empresa já emitiu e devolve o cadastro + a configuração fiscal prontos para aplicar.

- XML (portal da Prefeitura ou o que este sistema guarda): leitura EXATA pelos nomes oficiais, sem IA.
- PDF com texto: o texto vai para a IA interpretar.
- Foto/print (ou PDF escaneado, no Gemini): a IA lê a imagem.

Tudo passa pelas mesmas validações (CNPJ, CCM, CEP, NBS, cClassTrib, cIndOp, alíquota). Nada é salvo aqui.
"""

import io
import json
from decimal import Decimal, InvalidOperation

from lxml import etree

from app.core.documentos import cep_valido, cnpj_valido, so_digitos

UFS = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())


class NotaIlegivel(ValueError):
    pass


# ---------------------------------------------------------------- XML (exato)
def _locais(raiz):
    for el in raiz.iter():
        if isinstance(el.tag, str):
            yield etree.QName(el).localname, el


def _primeiro(raiz, nome: str, dentro: str | None = None) -> str | None:
    base = raiz
    if dentro:
        base = next((el for n, el in _locais(raiz) if n == dentro), None)
        if base is None:
            return None
    el = next((el for n, el in _locais(base) if n == nome), None)
    return el.text.strip() if el is not None and el.text and el.text.strip() else None


def ler_xml(conteudo: bytes) -> dict:
    try:
        raiz = etree.fromstring(conteudo, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    except etree.XMLSyntaxError as e:
        raise NotaIlegivel("O XML está corrompido ou não é uma NFS-e.") from e
    nomes = {n for n, _ in _locais(raiz)}
    if not nomes & {"ChaveNFe", "ChaveRPS", "NumeroNFe", "CodigoServico"}:
        raise NotaIlegivel("Este XML não parece uma NFS-e de São Paulo.")
    g = lambda nome, dentro=None: _primeiro(raiz, nome, dentro)  # noqa: E731
    opcao_simples = g("OpcaoSimples")
    return {
        "empresa": {
            "razao_social": g("RazaoSocialPrestador"),
            "cnpj": g("CNPJ", "CPFCNPJPrestador"),
            "ccm": g("InscricaoPrestador"),
            "tipo_logradouro": g("TipoLogradouro", "EnderecoPrestador"),
            "logradouro": g("Logradouro", "EnderecoPrestador"),
            "numero": g("NumeroEndereco", "EnderecoPrestador"),
            "complemento": g("ComplementoEndereco", "EnderecoPrestador"),
            "bairro": g("Bairro", "EnderecoPrestador"),
            "uf": g("UF", "EnderecoPrestador"),
            "cep": g("CEP", "EnderecoPrestador"),
            "email": g("EmailPrestador"),
        },
        "fiscal": {
            "cod_servico_padrao": g("CodigoServico"),
            "aliquota_iss": g("AliquotaServicos"),
            "iss_retido": (g("ISSRetido") or "").lower() in ("true", "1", "s"),
            "regime": "simples" if opcao_simples and opcao_simples != "0" else None,
            "serie_rps": g("SerieRPS", "ChaveRPS"),
            "ultimo_rps": g("NumeroRPS", "ChaveRPS"),
        },
        "parametros": {
            "nbs": g("NBS"),
            "class_trib": g("cClassTrib"),
            "cst_ibscbs": g("CST"),
            "ind_operacao": g("cIndOp"),
            "finalidade": g("finNFSe"),
            "ind_final": g("indFinal"),
        },
        "nota": {
            "numero": g("NumeroNFe"),
            "data": g("DataEmissaoNFe") or g("DataEmissao"),
            "valor": g("ValorServicos") or g("ValorFinalCobrado") or g("ValorInicialCobrado"),
            "tomador": g("RazaoSocialTomador"),
            "discriminacao": (g("Discriminacao") or "")[:300] or None,
        },
    }


# ---------------------------------------------------------------- PDF / imagem (IA)
FORMATO_IA = {
    "empresa": {"razao_social": "", "nome_fantasia": "", "cnpj": "", "ccm": "inscrição municipal do PRESTADOR",
                "logradouro": "", "numero": "", "complemento": "", "bairro": "", "cidade": "", "uf": "", "cep": "",
                "email": "", "telefone": ""},
    "fiscal": {"cod_servico_padrao": "código do serviço (4-5 dígitos)", "aliquota_iss": "ex. 5,00%",
               "iss_retido": "true/false", "regime": "simples|presumido|real|mei ou null",
               "serie_rps": "", "ultimo_rps": "número do RPS que originou a nota"},
    "parametros": {"nbs": "9 dígitos", "class_trib": "cClassTrib, 6 dígitos", "cst_ibscbs": "3 dígitos",
                   "ind_operacao": "cIndOp, 6 dígitos"},
    "nota": {"numero": "", "data": "", "valor": "", "tomador": "", "discriminacao": "até 300 caracteres"},
}
SISTEMA_NOTA = ("Você lê Notas Fiscais de Serviços Eletrônicas (NFS-e) da Prefeitura de São Paulo. Extraia os dados do "
                "PRESTADOR (quem emitiu), nunca os do tomador, nos campos pedidos. Use null para o que não estiver na "
                "nota; nunca invente nem deduza códigos. Responda SOMENTE com JSON válido.")


def texto_do_pdf(conteudo: bytes) -> str:
    from pypdf import PdfReader

    try:
        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(conteudo)).pages[:3]).strip()
    except Exception as e:  # noqa: BLE001
        raise NotaIlegivel("Não consegui abrir este PDF.") from e


def ler_com_ia(provedor, texto: str | None, anexo: tuple[str, bytes] | None) -> dict:
    from app.core import ia

    pedido = f"Formato (preencha os valores):\n{json.dumps(FORMATO_IA, ensure_ascii=False)}"
    if texto:
        pedido += f"\n\nTexto da nota:\n{texto[:12000]}"
    r = ia.gerar_json(provedor, SISTEMA_NOTA, pedido, anexo)
    return {k: r.get(k) if isinstance(r.get(k), dict) else {} for k in ("empresa", "fiscal", "parametros", "nota")}


# ---------------------------------------------------------------- validação comum
def _aliquota(v) -> str | None:
    if v in (None, ""):
        return None
    try:
        d = Decimal(str(v).replace("%", "").replace(",", ".").strip())
    except InvalidOperation:
        return None
    if d > 1:  # veio em percentual (5,00) → fração (0.05)
        d = d / 100
    return str(d.quantize(Decimal("0.0001"))) if Decimal("0.02") <= d <= Decimal("0.05") else None


def validar(bruto: dict, fonte: str) -> dict:
    avisos: list[str] = []
    emp = {k: (str(v).strip() if v not in (None, "", "null") else None) for k, v in (bruto.get("empresa") or {}).items()}
    fis = dict(bruto.get("fiscal") or {})
    par = {k: (so_digitos(str(v)) if v not in (None, "", "null") else None) for k, v in (bruto.get("parametros") or {}).items()}
    nota = {k: v for k, v in (bruto.get("nota") or {}).items() if v not in (None, "", "null")}

    if emp.get("cnpj"):
        d = so_digitos(emp["cnpj"])
        if cnpj_valido(d):
            emp["cnpj"] = d
        else:
            avisos.append(f"O CNPJ lido ({emp['cnpj']}) não passou na validação e foi deixado em branco.")
            emp["cnpj"] = None
    if emp.get("ccm"):
        d = so_digitos(emp["ccm"]).lstrip("0")
        emp["ccm"] = d.zfill(8) if d and len(d) <= 8 else None
        if not emp["ccm"]:
            avisos.append("A inscrição municipal (CCM) lida não tem o formato de São Paulo (até 8 dígitos).")
    if emp.get("cep"):
        d = so_digitos(emp["cep"]).zfill(8)
        emp["cep"] = d if cep_valido(d) else None
    if emp.get("uf"):
        emp["uf"] = emp["uf"].upper()[:2] if emp["uf"].upper()[:2] in UFS else None
    tipo = emp.pop("tipo_logradouro", None)
    if tipo and emp.get("logradouro") and not emp["logradouro"].upper().startswith(tipo.upper()):
        emp["logradouro"] = f"{tipo} {emp['logradouro']}"
    if emp.get("cidade") is None and emp.get("uf") == "SP" and fonte == "xml":
        emp["cidade"] = "São Paulo"

    cod = so_digitos(str(fis.get("cod_servico_padrao") or ""))
    fis["cod_servico_padrao"] = cod.zfill(5) if 4 <= len(cod) <= 5 else None
    fis["aliquota_iss"] = _aliquota(fis.get("aliquota_iss"))
    if fis.get("aliquota_iss") is None and (bruto.get("fiscal") or {}).get("aliquota_iss"):
        avisos.append("A alíquota de ISS lida está fora da faixa legal (2% a 5%) e não foi aplicada.")
    fis["iss_retido"] = str(fis.get("iss_retido")).lower() in ("true", "1", "s", "sim")
    if fis.get("regime") not in ("simples", "presumido", "real", "mei"):
        fis["regime"] = None
    serie = (str(fis.get("serie_rps") or "").strip() or None)
    fis["serie_rps"] = serie[:5] if serie else None
    ultimo = so_digitos(str(fis.pop("ultimo_rps", "") or ""))
    fis["prox_rps"] = int(ultimo) + 1 if ultimo else None  # continua a numeração, sem repetir RPS

    for campo, tam, rotulo in (("nbs", 9, "NBS"), ("class_trib", 6, "cClassTrib"), ("ind_operacao", 6, "cIndOp"),
                               ("cst_ibscbs", 3, "CST")):
        if par.get(campo) and len(par[campo]) != tam:
            avisos.append(f"O {rotulo} lido ({par[campo]}) não tem {tam} dígitos e foi ignorado.")
            par[campo] = None
    par = {k: v for k, v in par.items() if v}
    if not any(par.get(k) for k in ("nbs", "class_trib", "ind_operacao")):
        avisos.append("A nota não traz os campos de IBS/CBS (é do layout antigo). Defina NBS, cClassTrib e cIndOp "
                      "com o contador em Parâmetros Fiscais.")
    return {
        "fonte": fonte,
        "empresa": {k: v for k, v in emp.items() if v},
        "fiscal": {k: v for k, v in fis.items() if v not in (None, "")} | {"iss_retido": fis["iss_retido"]},
        "parametros": par,
        "nota": nota,
        "avisos": avisos,
    }
