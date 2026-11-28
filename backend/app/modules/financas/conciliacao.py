"""Conciliação bancária: o extrato do banco de UMA conta × o que o sistema tem.

Cada linha do extrato cai em uma situação:
  - conciliada ............ já existe lançamento igual na conta (mesmo sentido e valor, até 3 dias de diferença).
                            Só vincula; nada é criado.
  - baixa sugerida ........ há conta a pagar (débito) ou fatura (crédito) em aberto que casa por valor, data e nome
                            ou documento na descrição. Vale um pagamento para vários títulos.
  - sem correspondência ... nada no sistema: sugere o lançamento a criar (categoria, favorecido), pelo que o
                            escritório já ensinou (`ConciliacaoRegra`), pelos cadastros ou por palavras-chave.
Nada é gravado sem o OK do usuário: criar e dar baixa passam pelos mesmos serviços das telas (contas a pagar,
lançamento avulso e baixa de fatura), e cada linha guarda o que fez (`ConciliacaoVinculo`) para poder desfazer.

A classificação é refeita toda vez que a conciliação é aberta: o que foi pago, lançado ou desfeito por outra tela
aparece aqui sem ninguém precisar reimportar.
"""

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from itertools import product
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import ia, tenancy
from app.core.documentos import cnpj_valido, cpf_valido, so_digitos
from app.core.models import Usuario
from app.modules.financas import service
from app.modules.financas.models import (
    CategoriaFinanceira,
    Conciliacao,
    ConciliacaoLinha,
    ConciliacaoRegra,
    ConciliacaoVinculo,
    ContaBancaria,
    ContaPagar,
    FormaPagamento,
    Fornecedor,
    GrupoDre,
    Lancamento,
    SituacaoLinha,
    Subcategoria,
    TipoCategoria,
    TipoLancamento,
)
from app.modules.rpa_nfse import conciliacao as casador_notas
from app.modules.rpa_nfse import extrato as leitor
from app.modules.rpa_nfse import fatura as faturas
from app.modules.rpa_nfse import validator
from app.modules.rpa_nfse.models import Fatura, LancamentoExtrato, StatusFatura, StatusLancamento, Tomador

JANELA_LANCAMENTO = 3  # dias entre a linha do banco e o lançamento do sistema para ser "o mesmo"
JANELA_PROXIMA = 15  # conta a pagar: vencimento a até 15 dias do débito conta como data próxima
JANELA_TITULO = 45  # conta a pagar: mais longe que isso do vencimento não é candidata
FOLGA_EMISSAO = casador_notas.FOLGA_DIAS  # fatura: o crédito pode cair até 5 dias antes da emissão
MAX_TITULOS = 12  # títulos numa mesma baixa
PENDENTES = (SituacaoLinha.baixa_sugerida, SituacaoLinha.sem_correspondencia)
ZERO = Decimal(0)


class Pendencias(ValueError):
    """A confirmação não pode ser gravada: cada item diz a linha e o motivo. Nada é gravado."""

    def __init__(self, linhas: list[dict], mensagem: str | None = None):
        self.linhas = linhas
        n = len(linhas)
        super().__init__(mensagem or (f"{n} linha(s) precisam de ajuste antes de gravar." if n != 1 else linhas[0]["motivo"]))


# ================================================================ texto
_MESES = {"janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro",
          "dezembro", "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"}
# palavras que dizem o meio do pagamento, não quem recebeu: sozinhas não ensinam nem casam regra
_GENERICAS = {
    "pix", "ted", "doc", "tev", "transf", "transferencia", "pagamento", "pagto", "pgto", "pag", "boleto", "titulo",
    "cobranca", "enviado", "enviada", "recebido", "recebida", "debito", "credito", "deb", "cred", "compra", "cartao",
    "de", "da", "do", "das", "dos", "para", "em", "via", "ref", "nsu", "aut", "autorizacao", "qr", "code", "conta",
    "banco", "eletronico", "eletronica", "internet", "online", "lancamento", "automatico", "sispag", "diversos",
    "outros", "liquidacao", "ltda", "me", "epp", "eireli", "sa", "cia", "emitido", "emitida", "rec", "env", "bco",
}
_NOME_FRACO = {"condominio", "edificio", "residencial", "ltda", "advogados", "associados", "sociedade", "servicos",
               "comercio", "empresa", "brasil", "banco", "eireli"}


def _tokens(texto: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", leitor._norm(texto)) if t]


def normalizar(descricao: str) -> str:
    """Descrição do banco reduzida ao que se repete de um mês para o outro: sem acento, sem datas, sem horas e sem
    números que mudam (NSU, autenticação, parcela). CPF e CNPJ ficam: identificam quem recebeu ou pagou."""
    t = leitor._norm(descricao)
    t = re.sub(r"\b(\d{2})\.(\d{3})\.(\d{3})/(\d{4})-(\d{2})\b", r"\1\2\3\4\5", t)
    t = re.sub(r"\b(\d{3})\.(\d{3})\.(\d{3})-(\d{2})\b", r"\1\2\3\4", t)
    saida = []
    for tok in re.split(r"[^a-z0-9]+", t):
        if not tok or tok in _MESES:
            continue
        if any(ch.isdigit() for ch in tok):
            if tok.isdigit() and ((len(tok) == 14 and cnpj_valido(tok)) or (len(tok) == 11 and cpf_valido(tok))):
                saida.append(tok)
            continue
        if len(tok) >= 2:
            saida.append(tok)
    return " ".join(saida)[:200]


def _significativas(padrao: str) -> set[str]:
    return {t for t in padrao.split() if t not in _GENERICAS}


def _limpa(descricao: str) -> str:
    return re.sub(r"\s+", " ", descricao or "").strip()


def _fortes(texto: str) -> list[str]:
    """Palavras que identificam alguém: sem partículas (de, da), sem "ltda", sem o meio de pagamento."""
    return [p for p in _tokens(texto) if len(p) > 3 and p not in _NOME_FRACO and p not in _GENERICAS]


def _cita(nome: str | None, doc: str | None, desc_norm: str, desc_dig: str) -> bool:
    """O CPF/CNPJ (ou a raiz do CNPJ) aparece na descrição do banco, ou o nome aparece: as 3 primeiras palavras
    fortes, juntas e na ordem ("João da Silva" não é "João Pereira da Silva")."""
    doc = so_digitos(doc)
    if len(doc) >= 11 and (doc in desc_dig or (len(doc) == 14 and doc[:8] in desc_dig)):
        return True
    palavras = _fortes(nome or "")[:3]
    if not palavras:
        return False
    seq = _fortes(desc_norm)
    return any(seq[i:i + len(palavras)] == palavras for i in range(len(seq) - len(palavras) + 1))


def _dias(n: int) -> str:
    return "mesmo dia" if n == 0 else ("1 dia de diferença" if n == 1 else f"{n} dias de diferença")


# ================================================================ importar
def importar(db: Session, *, conta: ContaBancaria, usuario: Usuario, nome: str, conteudo: bytes) -> tuple[Conciliacao | None, int]:
    """Guarda o arquivo e as linhas NOVAS da conta. Devolve (conciliação, id da anterior quando nada era novo)."""
    lido = leitor.ler_movimentos(nome, conteudo)
    chaves = [m.chave for m in lido.movimentos]
    ja = dict(db.execute(select(ConciliacaoLinha.chave, ConciliacaoLinha.conciliacao_id).where(
        ConciliacaoLinha.conta_id == conta.id, ConciliacaoLinha.chave.in_(chaves))).all())
    novos = [m for m in lido.movimentos if m.chave not in ja]
    if not novos:
        anteriores = list(ja.values())
        return None, max(set(anteriores), key=anteriores.count)
    destino = tenancy.pasta_base() / "extratos" / f"tenant_{conta.tenant_id}" / "conciliacao"
    destino.mkdir(parents=True, exist_ok=True)
    caminho = destino / f"{date.today():%Y%m%d}_{conta.id}_{Path(nome).name}"
    caminho.write_bytes(conteudo)
    conc = Conciliacao(tenant_id=conta.tenant_id, conta_id=conta.id, usuario_id=usuario.id, arquivo_nome=nome[:255],
                       arquivo_path=str(caminho), formato=lido.formato, banco=lido.banco,
                       periodo_de=lido.movimentos[0].data, periodo_ate=lido.movimentos[-1].data,
                       saldo_final=lido.saldo_final, data_saldo=lido.data_saldo if lido.saldo_final is not None else None,
                       qtd_linhas=len(novos), qtd_repetidas=len(lido.movimentos) - len(novos))
    db.add(conc)
    db.flush()
    for m in novos:
        db.add(ConciliacaoLinha(tenant_id=conta.tenant_id, conciliacao_id=conc.id, conta_id=conta.id, data=m.data,
                                tipo=TipoLancamento(m.tipo), valor=m.valor, descricao=m.descricao[:500],
                                documento=(m.documento or None) and m.documento[:80], chave=m.chave, sugestao={}))
    db.flush()
    db.refresh(conc)
    classificar(db, conc)
    return conc, 0


# ================================================================ classificar
@dataclass
class _Titulo:
    """Conta a pagar ou fatura em aberto, do jeito que o casador precisa (`id` e `valor` servem ao `_combinacao`)."""

    id: int
    valor: Decimal  # o valor que casa com o extrato
    obj: object
    nome: str
    doc: str | None
    quando: date  # vencimento
    grupo: str  # quem recebe / quem paga: junta os títulos de um mesmo pagamento
    outros_valores: tuple[Decimal, ...] = ()  # fatura com retenção: o líquido também vale


def _sem_vinculo(db: Session, conc: Conciliacao) -> None:
    """Vínculo cujo lançamento sumiu (conta reaberta, baixa desfeita ou lançamento excluído em outra tela) deixa de
    valer. A linha que ficou sem nenhum volta a ficar pendente."""
    for linha in conc.linhas:
        for v in list(linha.vinculos):
            if not v.lancamento_id or db.get(Lancamento, v.lancamento_id) is None:
                linha.vinculos.remove(v)
        if linha.situacao in (SituacaoLinha.conciliada, SituacaoLinha.feita) and not linha.vinculos:
            linha.situacao = SituacaoLinha.sem_correspondencia
    db.flush()


def _lancamentos_livres(db: Session, conc: Conciliacao, linhas: list[ConciliacaoLinha]) -> list[Lancamento]:
    from datetime import timedelta

    de = min(ln.data for ln in linhas) - timedelta(days=JANELA_LANCAMENTO)
    ate = max(ln.data for ln in linhas) + timedelta(days=JANELA_LANCAMENTO)
    ocupados = select(ConciliacaoVinculo.lancamento_id).where(ConciliacaoVinculo.lancamento_id.is_not(None))
    return list(db.scalars(select(Lancamento).where(Lancamento.conta_id == conc.conta_id, Lancamento.data >= de,
                                                    Lancamento.data <= ate, Lancamento.id.not_in(ocupados))
                           .order_by(Lancamento.data, Lancamento.id)))


def _contas_abertas(db: Session, tenant_id: int) -> list[_Titulo]:
    saida = []
    for c in db.scalars(select(ContaPagar).where(ContaPagar.tenant_id == tenant_id, ContaPagar.data_pagamento.is_(None))
                        .order_by(ContaPagar.data_vencimento, ContaPagar.id)):
        doc = c.fornecedor.cpf_cnpj if c.fornecedor else None
        nome = service._favorecido(db, c)
        grupo = f"f{c.fornecedor_id}" if c.fornecedor_id else (f"u{c.funcionario_id}" if c.funcionario_id else f"n{leitor._norm(nome)}")
        saida.append(_Titulo(c.id, c.valor, c, nome, doc, c.data_vencimento, grupo))
    return saida


def valor_liquido(fat: Fatura) -> Decimal | None:
    """Quanto o cliente deposita quando retém tributos: só as faturas que já têm NFS-e (a baixa guarda o valor pago)."""
    if not (fat.nfse and fat.nfse.rps):
        return None
    dados = fat.nfse.rps.dados_json or {}
    doc = so_digitos((dados.get("tomador") or {}).get("cpf_cnpj"))
    ret = validator.calcular_retencoes(fat.nfse.valor, dados.get("layout2") or {}, doc)
    retido = sum((ret[k] for k in faturas.ROTULO_RETENCAO if ret.get(k)), ZERO)
    return fat.total - retido if retido else None


def _faturas_abertas(db: Session, tenant_id: int) -> list[_Titulo]:
    saida = []
    for f in db.scalars(select(Fatura).where(Fatura.tenant_id == tenant_id, Fatura.status == StatusFatura.aberta)
                        .order_by(Fatura.data_vencimento, Fatura.id)):
        cli = faturas.dados_cliente(f)
        liquido = valor_liquido(f)
        saida.append(_Titulo(f.id, f.total, f, cli.get("nome") or "", cli.get("cpf_cnpj"), f.data_vencimento,
                             f"t{f.tomador_id}" if f.tomador_id else f"n{leitor._norm(cli.get('nome') or '')}",
                             (liquido,) if liquido else ()))
    return saida


def _com_valor(titulos: list[_Titulo], valor: Decimal) -> list[_Titulo]:
    """Títulos que valem `valor` (pelo total ou, na fatura com retenção, pelo líquido), já com o valor que casou."""
    saida = []
    for t in titulos:
        if t.valor == valor:
            saida.append(t)
        elif valor in t.outros_valores:
            saida.append(_Titulo(t.id, valor, t.obj, t.nome, t.doc, t.quando, t.grupo))
    return saida


def _varios(cand: list[_Titulo], valor: Decimal, citado) -> tuple[str, list[_Titulo], str] | None:
    """Um pagamento para vários títulos de quem aparece na descrição: todos os em aberto, ou uma combinação."""
    grupos: dict[str, list[_Titulo]] = {}
    for t in cand:
        if citado(t):
            grupos.setdefault(t.grupo, []).append(t)
    for titulos in grupos.values():
        if len(titulos) < 2 or len(titulos) > 200:
            continue
        if len(titulos) <= MAX_TITULOS:
            for escolha in ((t.valor for t in titulos), (t.outros_valores[0] if t.outros_valores else t.valor for t in titulos)):
                valores = list(escolha)
                if sum(valores, ZERO) == valor:
                    return ("alta", [_Titulo(t.id, v, t.obj, t.nome, t.doc, t.quando, t.grupo) for t, v in zip(titulos, valores, strict=True)],
                            f"soma dos {len(titulos)} títulos em aberto de {titulos[0].nome}")
        combo = casador_notas._combinacao(titulos, valor)
        if combo:
            return "media", combo, f"{len(combo)} títulos de {combo[0].nome} somam este valor"
    return None


def _casar_pagar(linha: ConciliacaoLinha, abertas: list[_Titulo]) -> tuple[str, list[_Titulo], str] | None:
    desc_norm, desc_dig = leitor._norm(linha.descricao), so_digitos(linha.descricao)

    def citado(t: _Titulo) -> bool:
        doc_conta = so_digitos(getattr(t.obj, "documento", None))
        return _cita(t.nome, t.doc, desc_norm, desc_dig) or (len(doc_conta) >= 5 and doc_conta in desc_dig)

    def dist(t: _Titulo) -> int:
        return abs((linha.data - t.quando).days)

    cand = [t for t in abertas if dist(t) <= JANELA_TITULO]
    exatas = sorted(_com_valor(cand, linha.valor), key=lambda t: (dist(t), t.id))
    citadas = [t for t in exatas if citado(t)]
    if citadas:
        t = citadas[0]
        perto = dist(t) <= JANELA_PROXIMA
        motivo = f"mesmo valor, {_dias(dist(t))} do vencimento, nome ou documento confere"
        if len(citadas) > 1:
            motivo += f" ({len(citadas)} contas iguais; sugerida a de vencimento mais próximo)"
        return ("alta" if perto else "media"), [t], motivo
    if len(exatas) == 1:
        return "media", exatas, f"mesmo valor, {_dias(dist(exatas[0]))} do vencimento; única conta em aberto com este valor"
    if (varios := _varios(cand, linha.valor, citado)):
        return varios
    if exatas:
        return "media", [exatas[0]], f"{len(exatas)} contas em aberto com este valor; sugerida a de vencimento mais próximo"
    return None


def _casar_receber(linha: ConciliacaoLinha, abertas: list[_Titulo]) -> tuple[str, list[_Titulo], str] | None:
    from datetime import timedelta

    desc_norm, desc_dig = leitor._norm(linha.descricao), so_digitos(linha.descricao)

    def citado(t: _Titulo) -> bool:
        return _cita(t.nome, t.doc, desc_norm, desc_dig)

    limite = linha.data + timedelta(days=FOLGA_EMISSAO)
    cand = [t for t in abertas if t.obj.data_emissao <= limite]
    exatas = _com_valor(cand, linha.valor)  # já em ordem de vencimento: a mais antiga primeiro
    citadas = [t for t in exatas if citado(t)]
    if citadas:
        t = citadas[0]
        motivo = f"mesmo valor, {_dias(abs((linha.data - t.quando).days))} do vencimento, cliente confere"
        if len(citadas) > 1:
            return "media", [t], motivo + f" ({len(citadas)} faturas iguais deste cliente; sugerida a mais antiga)"
        return "alta", [t], motivo
    if len(exatas) == 1:
        return "media", exatas, "mesmo valor; única fatura em aberto com este valor (o cliente não aparece na descrição)"
    if (varios := _varios(cand, linha.valor, citado)):
        confianca, titulos, motivo = varios
        return confianca, titulos, motivo.replace("títulos", "faturas")
    if exatas:
        return "media", [exatas[0]], f"{len(exatas)} faturas em aberto com este valor; sugerida a mais antiga"
    return None


# ---------------------------------------------------------------- sugestão do lançamento a criar
_NATUREZAS = (
    # natureza, palavras, grupos da DRE em que a categoria costuma estar (na ordem de preferência), nome que ajuda
    ("tarifa", ("tarifa", "tar ", "pacote de servicos", "pacote servicos", "manutencao de conta", "anuidade", "iof", "encargos",
                "juros", "cesta "), (GrupoDre.financeiras,), "tarifa"),
    ("imposto", ("darf", "simples nacional", " das ", "das-", "iss ", "issqn", "inss", "fgts", "gps", "irrf", "cofins", "csll", "irpj",
                 "receita federal", "prefeitura", "tributo", "imposto", "pis "), (GrupoDre.deducoes, GrupoDre.impostos_lucro), "imposto"),
    ("folha", ("salario", "folha", "pro labore", "prolabore", "ferias", "rescisao", "13o"), (GrupoDre.pessoal,), "folha"),
)
_RENDIMENTO = ("rendimento", "rend ", "juros", "resgate", "aplicacao", "remuneracao")


def _natureza(tipo: TipoLancamento, desc_norm: str) -> str | None:
    texto = f" {desc_norm} "
    if tipo == TipoLancamento.credito:
        return "rendimento" if any(p in texto for p in _RENDIMENTO) else None
    for nome, palavras, _, _ in _NATUREZAS:
        if any(p in texto for p in palavras):
            return nome
    return None


def _forma(desc_norm: str) -> FormaPagamento | None:
    for palavra, forma in (("pix", FormaPagamento.pix), ("boleto", FormaPagamento.boleto), ("titulo", FormaPagamento.boleto),
                           ("ted", FormaPagamento.ted), ("cartao", FormaPagamento.cartao), ("deb aut", FormaPagamento.debito),
                           ("debito automatico", FormaPagamento.debito)):
        if palavra in desc_norm:
            return forma
    return None


@dataclass
class _Cadastros:
    categorias: dict[int, CategoriaFinanceira]
    regras: list[ConciliacaoRegra]
    fornecedores: list[Fornecedor]
    funcionarios: list[Usuario]
    clientes: list[Tomador]
    conta: ContaBancaria
    cat_honorarios: int | None


def _cadastros(db: Session, conc: Conciliacao) -> _Cadastros:
    t = conc.tenant_id
    service.garantir_categorias_padrao(db, t)
    cfg = service.config(db, t)
    return _Cadastros(
        categorias={c.id: c for c in db.scalars(select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == t, CategoriaFinanceira.ativo))},
        regras=list(db.scalars(select(ConciliacaoRegra).where(ConciliacaoRegra.tenant_id == t).order_by(ConciliacaoRegra.id))),
        fornecedores=list(db.scalars(select(Fornecedor).where(Fornecedor.tenant_id == t, Fornecedor.ativo))),
        funcionarios=list(db.scalars(select(Usuario).where(Usuario.tenant_id == t, Usuario.ativo))),
        clientes=list(db.scalars(select(Tomador).where(Tomador.tenant_id == t))),
        conta=conc.conta, cat_honorarios=cfg.categoria_honorarios_id)


def regra_para(regras: list[ConciliacaoRegra], tipo: TipoLancamento, descricao: str) -> ConciliacaoRegra | None:
    """A regra aprendida que vale para esta descrição: a de texto igual; senão a mais parecida (pelo menos 60% das
    palavras que identificam o favorecido em comum)."""
    padrao = normalizar(descricao)
    sig = _significativas(padrao)
    melhor, nota = None, 0.0
    for r in regras:
        if r.tipo != tipo:
            continue
        if r.padrao == padrao:
            return r
        outras = _significativas(r.padrao)
        if not sig or not outras:
            continue
        parecido = len(sig & outras) / len(sig | outras)
        if parecido >= 0.6 and parecido > nota:
            melhor, nota = r, parecido
    return melhor


def _categoria_por_grupo(cad: _Cadastros, tipo: TipoCategoria, grupos: tuple[GrupoDre, ...], pista: str) -> int | None:
    do_tipo = [c for c in cad.categorias.values() if c.tipo == tipo and c.grupo_dre in grupos]
    do_tipo.sort(key=lambda c: (grupos.index(c.grupo_dre), pista not in leitor._norm(c.nome), c.id))
    return do_tipo[0].id if do_tipo else None


def _sugerir(linha: ConciliacaoLinha, cad: _Cadastros) -> dict:
    debito = linha.tipo == TipoLancamento.debito
    tipo_cat = TipoCategoria.despesa if debito else TipoCategoria.receita
    desc_norm, desc_dig = leitor._norm(linha.descricao), so_digitos(linha.descricao)
    s: dict = {"descricao": _limpa(linha.descricao)[:255], "categoria_id": None, "subcategoria_id": None, "fornecedor_id": None,
               "funcionario_id": None, "favorecido": None, "natureza": _natureza(linha.tipo, desc_norm), "origem": None,
               "regra_id": None}
    if (anterior := (linha.sugestao or {}).get("ia")):
        s["ia"] = anterior

    def categoria_ok(cid) -> bool:
        return bool(cid) and cid in cad.categorias and cad.categorias[cid].tipo == tipo_cat

    regra = regra_para(cad.regras, linha.tipo, linha.descricao)
    if regra:
        s.update(origem="regra", regra_id=regra.id, natureza=regra.natureza or s["natureza"], favorecido=regra.favorecido,
                 fornecedor_id=regra.fornecedor_id, funcionario_id=regra.funcionario_id)
        if categoria_ok(regra.categoria_id):
            s["categoria_id"] = regra.categoria_id
            if regra.subcategoria and regra.subcategoria.categoria_id == regra.categoria_id and regra.subcategoria.ativo:
                s["subcategoria_id"] = regra.subcategoria_id
        return s

    if debito:
        forn = next((f for f in cad.fornecedores if _cita(f.nome, f.cpf_cnpj, desc_norm, desc_dig)), None)
        func = None if forn else next((u for u in cad.funcionarios if _cita(u.nome, getattr(u, "cpf", None), desc_norm, desc_dig)), None)
        if forn:
            s.update(origem="cadastro", fornecedor_id=forn.id)
            if categoria_ok(forn.categoria_padrao_id):
                s["categoria_id"] = forn.categoria_padrao_id
        elif func:
            s.update(origem="cadastro", funcionario_id=func.id)
        for nome, _, grupos, pista in _NATUREZAS:
            if s["natureza"] == nome and not s["categoria_id"]:
                s["categoria_id"] = _categoria_por_grupo(cad, tipo_cat, grupos, pista)
                s["origem"] = s["origem"] or "palavras"
        if s["natureza"] == "tarifa" and not (forn or func):
            s["favorecido"] = cad.conta.banco or cad.conta.nome
    else:
        cli = next((c for c in cad.clientes if _cita(c.nome, c.cpf_cnpj, desc_norm, desc_dig)), None)
        if cli:
            s.update(origem="cadastro", favorecido=cli.nome[:200])
            if categoria_ok(cad.cat_honorarios):
                s["categoria_id"] = cad.cat_honorarios
        elif s["natureza"] == "rendimento":
            s["categoria_id"] = _categoria_por_grupo(cad, tipo_cat, (GrupoDre.outras_receitas,), "financeir")
            s.update(origem="palavras", favorecido=cad.conta.banco or cad.conta.nome)

    if not s["categoria_id"] and (dica := s.get("ia")) and categoria_ok(dica.get("categoria_id")):
        s.update(origem="ia", categoria_id=dica["categoria_id"], subcategoria_id=dica.get("subcategoria_id"))
        if not (s["fornecedor_id"] or s["funcionario_id"] or s["favorecido"]):
            s["favorecido"] = dica.get("favorecido")
    if not (s["fornecedor_id"] or s["funcionario_id"] or s["favorecido"]) and s["natureza"] != "imposto":
        nome = " ".join(t for t in normalizar(linha.descricao).split() if t not in _GENERICAS and not t.isdigit())
        s["favorecido"] = nome.title()[:200] or None
    return s


def _ja_no_sistema(linha: ConciliacaoLinha, livres: list[Lancamento], das_notas: dict[str, list[Lancamento]]) -> tuple[list[Lancamento], str] | None:
    """Lançamento(s) que já respondem por esta linha."""
    do_tipo = [lc for lc in livres if lc.tipo == linha.tipo]
    iguais = sorted((lc for lc in do_tipo if lc.valor == linha.valor and abs((lc.data - linha.data).days) <= JANELA_LANCAMENTO),
                    key=lambda lc: (abs((lc.data - linha.data).days), lc.id))
    if iguais:
        lc = iguais[0]
        origem = {"conta_pagar": "pagamento de conta a pagar", "fatura": "recebimento de fatura", "transferencia": "transferência",
                  "importacao": "lançamento importado", "estorno": "estorno"}.get(lc.origem, "lançamento manual")
        return [lc], f"já lançado no sistema em {lc.data:%d/%m/%Y} ({origem}), {_dias(abs((lc.data - linha.data).days))}"
    if linha.tipo != TipoLancamento.credito:
        return None
    # um crédito que pagou várias faturas: o sistema tem um lançamento por fatura
    ids_livres = {lc.id for lc in livres}
    notas = [lc for lc in das_notas.get(linha.chave, []) if lc.id in ids_livres]
    if notas and sum((lc.valor for lc in notas), ZERO) == linha.valor:
        return notas, f"já baixado em NFS-e › Recebimentos ({len(notas)} faturas)"
    do_dia = [lc for lc in do_tipo if lc.origem == "fatura" and lc.data == linha.data and lc.valor < linha.valor]
    if len(do_dia) > 1:
        if sum((lc.valor for lc in do_dia), ZERO) == linha.valor:
            return do_dia, f"já lançado no sistema: {len(do_dia)} recebimentos de fatura neste dia somam o valor"
        if (combo := casador_notas._combinacao(do_dia, linha.valor)):
            return combo, f"já lançado no sistema: {len(combo)} recebimentos de fatura neste dia somam o valor"
    return None


def _creditos_das_notas(db: Session, conc: Conciliacao, linhas: list[ConciliacaoLinha]) -> tuple[dict[str, list[Lancamento]], dict[str, str]]:
    """O mesmo arquivo já passou por NFS-e › Recebimentos: por chave da linha, os créditos que aquela baixa lançou
    nesta conta (e, quando foram para outra conta, o aviso)."""
    chaves = [ln.chave for ln in linhas if ln.tipo == TipoLancamento.credito]
    nesta: dict[str, list[Lancamento]] = {}
    avisos: dict[str, str] = {}
    if not chaves:
        return nesta, avisos
    for chave, nfse_ids in db.execute(select(LancamentoExtrato.chave, LancamentoExtrato.nfse_ids).where(
            LancamentoExtrato.tenant_id == conc.tenant_id, LancamentoExtrato.chave.in_(chaves),
            LancamentoExtrato.status == StatusLancamento.conciliado)):
        if not nfse_ids:
            continue
        lancs = list(db.scalars(select(Lancamento).join(Fatura, Lancamento.fatura_id == Fatura.id).where(
            Fatura.nfse_id.in_(nfse_ids), Lancamento.origem == "fatura")))
        aqui = [lc for lc in lancs if lc.conta_id == conc.conta_id]
        if aqui:
            nesta.setdefault(chave, []).extend(aqui)
        elif lancs:
            outra = db.get(ContaBancaria, lancs[0].conta_id)
            avisos[chave] = (f"Este crédito já foi baixado em NFS-e › Recebimentos e lançado na conta {outra.nome if outra else 'de recebimento'}. "
                             "Lançar de novo aqui duplicaria o recebimento.")
    return nesta, avisos


def _linhas_gemeas(db: Session, conc: Conciliacao, linhas: list[ConciliacaoLinha]) -> dict[tuple, list[tuple[str, str, str]]]:
    """Linhas já conferidas em OUTRO extrato da conta, por (data, sentido, valor). O mesmo movimento pode voltar com
    outra chave: o mesmo período baixado em OFX e em CSV, ou banco que troca o identificador a cada download."""
    de, ate = min(ln.data for ln in linhas), max(ln.data for ln in linhas)
    mapa: dict[tuple, list[tuple[str, str, str]]] = {}
    for d, tipo, valor, chave, descricao, arquivo in db.execute(
            select(ConciliacaoLinha.data, ConciliacaoLinha.tipo, ConciliacaoLinha.valor, ConciliacaoLinha.chave,
                   ConciliacaoLinha.descricao, Conciliacao.arquivo_nome)
            .join(Conciliacao, ConciliacaoLinha.conciliacao_id == Conciliacao.id)
            .where(ConciliacaoLinha.conta_id == conc.conta_id, ConciliacaoLinha.conciliacao_id != conc.id,
                   ConciliacaoLinha.data >= de, ConciliacaoLinha.data <= ate,
                   ConciliacaoLinha.situacao.in_((SituacaoLinha.conciliada, SituacaoLinha.feita)))):
        mapa.setdefault((d, tipo, valor), []).append((chave, normalizar(descricao), arquivo))
    return mapa


def _aviso_de_gemea(linha: ConciliacaoLinha, gemeas: dict[tuple, list[tuple[str, str, str]]]) -> str | None:
    padrao, do_ofx = normalizar(linha.descricao), linha.chave.startswith("ofx:")
    for chave, outro_padrao, arquivo in gemeas.get((linha.data, linha.tipo, linha.valor), []):
        if chave.startswith("ofx:") != do_ofx or outro_padrao == padrao:
            return (f"Parece a mesma linha que já foi conferida no extrato {arquivo} (mesma data e mesmo valor). "
                    "Confira antes de lançar, para não lançar em dobro.")
    return None


def classificar(db: Session, conc: Conciliacao) -> None:
    """Refaz a situação das linhas pendentes (as conciliadas, feitas e ignoradas ficam como estão)."""
    _sem_vinculo(db, conc)
    pendentes = [ln for ln in conc.linhas if ln.situacao in PENDENTES]
    if not pendentes:
        return
    livres = _lancamentos_livres(db, conc, pendentes)
    das_notas, avisos = _creditos_das_notas(db, conc, pendentes)
    contas, fats = _contas_abertas(db, conc.tenant_id), _faturas_abertas(db, conc.tenant_id)
    cad = _cadastros(db, conc)
    gemeas = _linhas_gemeas(db, conc, pendentes)
    usados: dict[str, set[int]] = {"conta_pagar": set(), "fatura": set()}
    for linha in pendentes:
        if (achado := _ja_no_sistema(linha, livres, das_notas)):
            lancs, motivo = achado
            for lc in lancs:
                linha.vinculos.append(ConciliacaoVinculo(tenant_id=conc.tenant_id, tipo="vinculo", alvo=f"lanc:{lc.id}", lancamento_id=lc.id))
                livres.remove(lc)
            _gravar(linha, SituacaoLinha.conciliada, None, motivo, {})
            continue
        titulo = "conta_pagar" if linha.tipo == TipoLancamento.debito else "fatura"
        disponiveis = [t for t in (contas if titulo == "conta_pagar" else fats) if t.id not in usados[titulo]]
        casou = (_casar_pagar if titulo == "conta_pagar" else _casar_receber)(linha, disponiveis)
        aviso = avisos.get(linha.chave) or _aviso_de_gemea(linha, gemeas)
        if casou:
            confianca, titulos, motivo = casou
            usados[titulo].update(t.id for t in titulos)  # o mesmo título não é oferecido a duas linhas
            sugestao = {"titulo": titulo, "ids": [t.id for t in titulos]}
        else:
            confianca, motivo, sugestao = None, None, _sugerir(linha, cad)
        if aviso:
            sugestao["aviso"] = aviso
        _gravar(linha, SituacaoLinha.baixa_sugerida if casou else SituacaoLinha.sem_correspondencia, confianca,
                motivo[:300] if motivo else None, sugestao)
    db.flush()


def _gravar(linha: ConciliacaoLinha, situacao: SituacaoLinha, confianca: str | None, motivo: str | None, sugestao: dict) -> None:
    if linha.situacao != situacao:
        linha.situacao = situacao
    if linha.confianca != confianca:
        linha.confianca = confianca
    if linha.motivo != motivo:
        linha.motivo = motivo
    if (linha.sugestao or {}) != sugestao:
        linha.sugestao = sugestao


# ================================================================ o inverso e o fechamento
def so_no_sistema(db: Session, conc: Conciliacao) -> list[Lancamento]:
    """Lançado na conta dentro do período do extrato e que o banco não mostrou (nenhuma linha responde por ele)."""
    ocupados = select(ConciliacaoVinculo.lancamento_id).where(ConciliacaoVinculo.lancamento_id.is_not(None))
    return list(db.scalars(select(Lancamento).where(
        Lancamento.conta_id == conc.conta_id, Lancamento.data >= conc.periodo_de, Lancamento.data <= conc.periodo_ate,
        Lancamento.id.not_in(ocupados)).order_by(Lancamento.data, Lancamento.id)))


def fechamento(db: Session, conc: Conciliacao) -> dict:
    """Saldo final do extrato × saldo do sistema na mesma data (o do sistema é sempre calculado)."""
    quando = conc.data_saldo or conc.periodo_ate
    sistema = service.saldos(db, conc.tenant_id, ate=quando).get(conc.conta_id, ZERO)
    a_lancar = sum(((ln.valor if ln.tipo == TipoLancamento.credito else -ln.valor) for ln in conc.linhas
                    if ln.situacao in PENDENTES and ln.data <= quando), ZERO)
    diferenca = None if conc.saldo_final is None else service.q2(conc.saldo_final - sistema)
    return {"data": quando, "saldo_extrato": conc.saldo_final, "saldo_sistema": sistema, "diferenca": diferenca,
            "a_lancar": service.q2(a_lancar), "sem_explicacao": None if diferenca is None else service.q2(diferenca - a_lancar)}


# ================================================================ aprender
def aprender(db: Session, linha: ConciliacaoLinha, *, categoria_id: int | None, subcategoria_id: int | None = None,
             fornecedor_id: int | None = None, funcionario_id: int | None = None, favorecido: str | None = None) -> ConciliacaoRegra | None:
    """O usuário confirmou (ou corrigiu) o lançamento desta linha: a próxima descrição parecida já vem assim.
    Descrição só com palavras de meio de pagamento ("PIX ENVIADO") não vira regra: valeria para qualquer um."""
    padrao = normalizar(linha.descricao)
    if not categoria_id or not _significativas(padrao):
        return None
    regra = db.scalar(select(ConciliacaoRegra).where(ConciliacaoRegra.tenant_id == linha.tenant_id, ConciliacaoRegra.tipo == linha.tipo,
                                                     ConciliacaoRegra.padrao == padrao))
    if not regra:
        regra = ConciliacaoRegra(tenant_id=linha.tenant_id, tipo=linha.tipo, padrao=padrao, usos=0)
        db.add(regra)
    regra.exemplo = _limpa(linha.descricao)[:255]
    regra.natureza = _natureza(linha.tipo, leitor._norm(linha.descricao))
    regra.categoria_id, regra.subcategoria_id = categoria_id, subcategoria_id
    regra.fornecedor_id, regra.funcionario_id = fornecedor_id, funcionario_id
    regra.favorecido = None if (fornecedor_id or funcionario_id) else ((favorecido or "").strip()[:200] or None)
    regra.usos = (regra.usos or 0) + 1
    db.flush()
    return regra


# ================================================================ confirmar (tudo ou nada)
def _linhas_do_pedido(conc: Conciliacao, itens: list[dict], tipo: TipoLancamento | None) -> tuple[list[tuple[ConciliacaoLinha, dict]], int, list[dict]]:
    """(linhas a gravar, quantas já estavam feitas, problemas). Linha já resolvida não é erro: confirmar duas vezes
    o mesmo popup não lança em dobro."""
    por_id = {ln.id: ln for ln in conc.linhas}
    fazer, ja, erros, vistos = [], 0, [], set()
    for item in itens:
        lid = item["linha_id"]
        linha = por_id.get(lid)
        if lid in vistos:
            continue
        vistos.add(lid)
        if not linha:
            erros.append({"linha_id": lid, "motivo": "Esta linha não é desta conciliação."})
        elif linha.situacao in (SituacaoLinha.feita, SituacaoLinha.conciliada):
            ja += 1
        elif tipo and linha.tipo != tipo:
            erros.append({"linha_id": lid, "motivo": "Esta linha é uma " + ("entrada: lance em Recebimentos." if tipo == TipoLancamento.debito
                                                                           else "saída: lance em Contas a pagar.")})
        else:
            fazer.append((linha, item))
    return fazer, ja, erros


def _categoria(db: Session, tenant_id: int, item: dict, tipo: TipoCategoria) -> str | None:
    """Motivo do problema com a categoria do item (None = está certa)."""
    cat = db.get(CategoriaFinanceira, item.get("categoria_id")) if item.get("categoria_id") else None
    if not cat or cat.tenant_id != tenant_id:
        return "Escolha a categoria."
    if cat.tipo != tipo:
        return f"A categoria {cat.nome} é de {'receita' if cat.tipo == TipoCategoria.receita else 'despesa'}."
    if item.get("subcategoria_id"):
        sub = db.get(Subcategoria, item["subcategoria_id"])
        if not sub or sub.categoria_id != cat.id:
            return "A subcategoria não pertence à categoria escolhida."
    return None


def _favorecido_ok(db: Session, tenant_id: int, item: dict) -> str | None:
    if item.get("fornecedor_id"):
        f = db.get(Fornecedor, item["fornecedor_id"])
        if not f or f.tenant_id != tenant_id:
            return "Fornecedor não encontrado."
    if item.get("funcionario_id"):
        u = db.get(Usuario, item["funcionario_id"])
        if not u or u.tenant_id != tenant_id:
            return "Funcionário não encontrado."
    return None


def _vincular(linha: ConciliacaoLinha, usuario: Usuario, tipo: str, alvo: str, lc: Lancamento | None, **ids) -> None:
    if lc is None:
        raise service.RegraFinanceiro("O lançamento não foi gerado na conta bancária.")
    linha.vinculos.append(ConciliacaoVinculo(tenant_id=linha.tenant_id, tipo=tipo, alvo=alvo, lancamento_id=lc.id,
                                             usuario_id=usuario.id, **ids))
    linha.situacao, linha.confianca = SituacaoLinha.feita, None


def criar_pagar(db: Session, conc: Conciliacao, usuario: Usuario, itens: list[dict]) -> dict:
    """Débitos sem correspondência viram contas a pagar já PAGAS na data e na conta do extrato (com o débito)."""
    fazer, ja, erros = _linhas_do_pedido(conc, itens, TipoLancamento.debito)
    for linha, item in fazer:
        motivo = (None if (item.get("descricao") or "").strip() else "Informe a descrição.") \
            or _categoria(db, conc.tenant_id, item, TipoCategoria.despesa) or _favorecido_ok(db, conc.tenant_id, item)
        if motivo:
            erros.append({"linha_id": linha.id, "motivo": motivo})
    if erros:
        raise Pendencias(erros)
    for linha, item in fazer:
        try:
            dados = {"descricao": item["descricao"].strip()[:255], "fornecedor_id": item.get("fornecedor_id"),
                     "funcionario_id": item.get("funcionario_id"), "favorecido": (item.get("favorecido") or "").strip()[:200] or None,
                     "data_vencimento": linha.data, "forma_pagamento": _forma(leitor._norm(linha.descricao)),
                     "documento": linha.documento, "conta_bancaria_id": conc.conta_id,
                     "observacao": f"Criada pela conciliação do extrato {conc.arquivo_nome} (linha: {_limpa(linha.descricao)})"}
            conta = service.criar_contas(db, conc.tenant_id, usuario, dados, [{
                "categoria_id": item["categoria_id"], "subcategoria_id": item.get("subcategoria_id"), "valor": linha.valor}])[0]
            lc = service.pagar(db, conta, usuario, data=linha.data, conta_bancaria=conc.conta)
            _vincular(linha, usuario, "conta_criada", "novo", lc, conta_pagar_id=conta.id)
        except service.RegraFinanceiro as e:
            raise Pendencias([{"linha_id": linha.id, "motivo": str(e)}]) from e
        aprender(db, linha, categoria_id=item["categoria_id"], subcategoria_id=item.get("subcategoria_id"),
                 fornecedor_id=item.get("fornecedor_id"), funcionario_id=item.get("funcionario_id"), favorecido=item.get("favorecido"))
    db.flush()
    return {"feitas": len(fazer), "ja_feitas": ja}


def _valores_das_faturas(fats: list[Fatura], valor: Decimal) -> list[Decimal]:
    """Quanto do crédito é de cada fatura: o total ou, com retenção, o líquido. A soma tem de fechar com o crédito."""
    opcoes = []
    for f in fats:
        liquido = valor_liquido(f)
        opcoes.append((f.total, liquido) if liquido else (f.total,))
    for escolha in product(*opcoes):
        if sum(escolha, ZERO) == valor:
            return list(escolha)
    com_nota = [i for i, f in enumerate(fats) if f.nfse]
    if len(com_nota) == 1:  # a diferença (juros, desconto, retenção) fica registrada como valor pago da nota
        valores = [f.total for f in fats]
        resto = valor - sum((v for i, v in enumerate(valores) if i != com_nota[0]), ZERO)
        if resto > 0:
            valores[com_nota[0]] = resto
            return valores
    soma = sum((f.total for f in fats), ZERO)
    raise service.RegraFinanceiro(
        f"O crédito é de {_brl(valor)}, mas {'a fatura é de' if len(fats) == 1 else 'as faturas somam'} {_brl(soma)}. "
        "Ajuste o desconto ou os juros na fatura, ou lance a diferença como receita avulsa.")


def _brl(v) -> str:
    return "R$ " + f"{Decimal(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _baixar_faturas(db: Session, conc: Conciliacao, usuario: Usuario, linha: ConciliacaoLinha, ids: list[int]) -> None:
    """Baixa pelo mesmo serviço da tela de Faturas: sincroniza a NFS-e e lança UM crédito por fatura nesta conta."""
    if not ids or len(set(ids)) > MAX_TITULOS:
        raise service.RegraFinanceiro("Escolha a fatura." if not ids else f"No máximo {MAX_TITULOS} faturas por crédito.")
    fats = [db.get(Fatura, i) for i in dict.fromkeys(ids)]
    if any(f is None or f.tenant_id != conc.tenant_id for f in fats):
        raise service.RegraFinanceiro("Fatura não encontrada.")
    for f in fats:
        if f.status != StatusFatura.aberta:
            raise service.RegraFinanceiro(f"A fatura {f.codigo} não está mais em aberto.")
    for f, valor in zip(fats, _valores_das_faturas(fats, linha.valor), strict=True):
        try:
            faturas.dar_baixa(db, f, linha.data, valor=valor, conta_bancaria_id=conc.conta_id, origem="extrato")
        except faturas.BaixaInvalida as e:
            raise service.RegraFinanceiro(f"{f.codigo}: {e}") from e
        lc = db.scalar(select(Lancamento).where(Lancamento.fatura_id == f.id, Lancamento.origem == "fatura"))
        _vincular(linha, usuario, "baixa_fatura", f"fat:{f.id}", lc, fatura_id=f.id)


def _baixar_contas(db: Session, conc: Conciliacao, usuario: Usuario, linha: ConciliacaoLinha, ids: list[int]) -> None:
    """Baixa pelo mesmo serviço de Contas a pagar. Um título só com valor diferente: a diferença entra como juros
    ou desconto, para o débito ficar igual ao do banco."""
    if not ids or len(set(ids)) > MAX_TITULOS:
        raise service.RegraFinanceiro("Escolha a conta a pagar." if not ids else f"No máximo {MAX_TITULOS} contas por débito.")
    contas = [db.get(ContaPagar, i) for i in dict.fromkeys(ids)]
    if any(c is None or c.tenant_id != conc.tenant_id for c in contas):
        raise service.RegraFinanceiro("Conta a pagar não encontrada.")
    soma = sum((c.valor for c in contas), ZERO)
    juros = desconto = ZERO
    if soma != linha.valor:
        if len(contas) > 1:
            raise service.RegraFinanceiro(f"O débito é de {_brl(linha.valor)}, mas as contas somam {_brl(soma)}.")
        juros, desconto = max(linha.valor - soma, ZERO), max(soma - linha.valor, ZERO)
    for c in contas:
        lc = service.pagar(db, c, usuario, data=linha.data, conta_bancaria=conc.conta, juros=juros, desconto=desconto)
        _vincular(linha, usuario, "baixa_conta", f"cp:{c.id}", lc, conta_pagar_id=c.id)


def criar_receber(db: Session, conc: Conciliacao, usuario: Usuario, itens: list[dict]) -> dict:
    """Créditos sem correspondência: receita avulsa (crédito no extrato) ou baixa de uma fatura em aberto."""
    fazer, ja, erros = _linhas_do_pedido(conc, itens, TipoLancamento.credito)
    for linha, item in fazer:
        if item.get("modo") == "fatura":
            motivo = None if item.get("fatura_ids") else "Escolha a fatura."
        else:
            motivo = (None if len((item.get("descricao") or "").strip()) >= 2 else "Informe a descrição.") \
                or _categoria(db, conc.tenant_id, item, TipoCategoria.receita)
        if motivo:
            erros.append({"linha_id": linha.id, "motivo": motivo})
    if erros:
        raise Pendencias(erros)
    for linha, item in fazer:
        try:
            if item.get("modo") == "fatura":
                _baixar_faturas(db, conc, usuario, linha, item["fatura_ids"])
                continue
            lc = service.lancar(db, conc.tenant_id, usuario, conc.conta, {
                "data": linha.data, "descricao": item["descricao"].strip()[:255], "tipo": TipoLancamento.credito, "valor": linha.valor,
                "categoria_id": item["categoria_id"], "subcategoria_id": item.get("subcategoria_id"),
                "favorecido": (item.get("favorecido") or "").strip()[:200] or None, "documento": linha.documento,
                "observacao": f"Criado pela conciliação do extrato {conc.arquivo_nome}"})
            _vincular(linha, usuario, "receita_avulsa", "novo", lc)
        except service.RegraFinanceiro as e:
            raise Pendencias([{"linha_id": linha.id, "motivo": str(e)}]) from e
        aprender(db, linha, categoria_id=item["categoria_id"], subcategoria_id=item.get("subcategoria_id"), favorecido=item.get("favorecido"))
    db.flush()
    return {"feitas": len(fazer), "ja_feitas": ja}


def aprovar_baixas(db: Session, conc: Conciliacao, usuario: Usuario, itens: list[dict]) -> dict:
    """Baixas sugeridas (ou com o título trocado pelo usuário): conta a pagar para débito, fatura para crédito."""
    fazer, ja, erros = _linhas_do_pedido(conc, itens, None)
    for linha, item in fazer:
        esperado = "conta_pagar" if linha.tipo == TipoLancamento.debito else "fatura"
        if item.get("titulo") != esperado:
            erros.append({"linha_id": linha.id, "motivo": "Débito dá baixa em conta a pagar; crédito, em fatura."})
        elif not item.get("ids"):
            erros.append({"linha_id": linha.id, "motivo": "Escolha o título para dar baixa."})
    if erros:
        raise Pendencias(erros)
    for linha, item in fazer:
        try:
            (_baixar_contas if linha.tipo == TipoLancamento.debito else _baixar_faturas)(db, conc, usuario, linha, item["ids"])
        except service.RegraFinanceiro as e:
            raise Pendencias([{"linha_id": linha.id, "motivo": str(e)}]) from e
    db.flush()
    return {"feitas": len(fazer), "ja_feitas": ja}


# ================================================================ desfazer
def _desfazer_vinculo(db: Session, v: ConciliacaoVinculo) -> str | None:
    """Desfaz pelo caminho que a tela de origem usa. Devolve um aviso para o usuário, quando há."""
    lc = db.get(Lancamento, v.lancamento_id) if v.lancamento_id else None
    if v.tipo == "conta_criada":
        conta = db.get(ContaPagar, v.conta_pagar_id) if v.conta_pagar_id else None
        if conta:
            if conta.data_pagamento:
                service.reabrir(db, conta)
            service.excluir_conta(db, conta, "ocorrencia")
    elif v.tipo == "receita_avulsa":
        if lc:
            if db.scalar(select(Lancamento.id).where(Lancamento.estorno_de_id == lc.id).limit(1)):
                raise service.RegraFinanceiro("Este lançamento foi estornado: exclua o estorno no extrato da conta antes.")
            service.excluir_lancamento(db, lc)
    elif v.tipo == "baixa_conta":
        conta = db.get(ContaPagar, v.conta_pagar_id) if v.conta_pagar_id else None
        if conta and conta.data_pagamento and conta.lancamento_id == v.lancamento_id:
            service.reabrir(db, conta)
    elif v.tipo == "baixa_fatura":
        fat = db.get(Fatura, v.fatura_id) if v.fatura_id else None
        if fat and fat.status == StatusFatura.paga and lc is not None and lc.fatura_id == fat.id:
            try:
                faturas.desfazer_baixa(db, fat)
            except faturas.BaixaInvalida as e:
                raise service.RegraFinanceiro(str(e)) from e
            from app.modules.comissoes.models import ComissaoLancada

            if db.scalar(select(func.count()).select_from(ComissaoLancada).where(ComissaoLancada.fatura_id == fat.id)):
                return f"A comissão da {fat.codigo} já virou conta a pagar: confira em Financeiro › Comissões."
    return None


def desfazer(db: Session, conc: Conciliacao, linha_ids: list[int] | None = None) -> dict:
    """Desfaz o que a conciliação criou ou baixou (todas as linhas feitas, ou só as pedidas). O que os serviços de
    origem não deixam desfazer fica como está e volta na lista, com o motivo."""
    desfeitas, avisos, nao = 0, [], []
    for linha in conc.linhas:
        if linha.situacao != SituacaoLinha.feita or (linha_ids is not None and linha.id not in linha_ids):
            continue
        for v in list(linha.vinculos):
            try:
                with db.begin_nested():
                    aviso = _desfazer_vinculo(db, v)
                    db.flush()
            except service.RegraFinanceiro as e:
                nao.append({"linha_id": linha.id, "descricao": _limpa(linha.descricao), "valor": linha.valor, "motivo": str(e)})
                continue
            if aviso:
                avisos.append(aviso)
            linha.vinculos.remove(v)
        if not linha.vinculos:
            linha.situacao = SituacaoLinha.sem_correspondencia
            desfeitas += 1
    db.flush()
    db.expire_all()  # contas e lançamentos excluídos saem da sessão antes de reclassificar
    classificar(db, conc)
    return {"desfeitas": desfeitas, "avisos": avisos, "nao_desfeitas": nao}


# ================================================================ IA (opcional)
def sugerir_com_ia(db: Session, conc: Conciliacao) -> int:
    """Pede à IA a categoria das linhas sem correspondência que ficaram sem sugestão. Só preenche a sugestão:
    quem grava é o usuário, no popup. Levanta `ia.IAIndisponivel` quando o escritório não tem IA ligada."""
    import json

    alvo = [ln for ln in conc.linhas if ln.situacao == SituacaoLinha.sem_correspondencia and not (ln.sugestao or {}).get("categoria_id")]
    if not alvo:
        return 0
    provedor = ia.provedor_ativo(db, conc.tenant_id)
    cats = list(db.scalars(select(CategoriaFinanceira).where(CategoriaFinanceira.tenant_id == conc.tenant_id, CategoriaFinanceira.ativo)))
    catalogo = [{"id": c.id, "nome": c.nome, "tipo": c.tipo.value,
                 "subcategorias": [{"id": s.id, "nome": s.nome} for s in c.subcategorias if s.ativo]} for c in cats]
    pedido = [{"id": ln.id, "tipo": "saida" if ln.tipo == TipoLancamento.debito else "entrada", "descricao": ln.descricao,
               "valor": str(ln.valor)} for ln in alvo[:150]]
    r = ia.gerar_json(provedor, (
        "Você é o financeiro de um escritório de advocacia brasileiro classificando linhas do extrato bancário. Para cada "
        "linha escolha a categoria (e a subcategoria, se houver uma que sirva) SOMENTE entre as enviadas, pelo id: saída usa "
        "categoria de tipo despesa; entrada, de tipo receita. favorecido = nome limpo de quem recebeu ou pagou (sem 'PIX "
        "ENVIADO', sem números). Se não der para saber a categoria, devolva categoria_id nulo. Responda SOMENTE JSON: "
        "{\"linhas\": [{\"id\", \"categoria_id\", \"subcategoria_id\", \"favorecido\"}]}"),
        json.dumps({"categorias": catalogo, "linhas": pedido}, ensure_ascii=False))
    por_id = {ln.id: ln for ln in alvo}
    validas = {c.id: c for c in cats}
    n = 0
    for x in r.get("linhas") or []:
        linha = por_id.get(x.get("id")) if isinstance(x, dict) else None
        cat = validas.get(x.get("categoria_id")) if linha else None
        if not cat or cat.tipo != (TipoCategoria.despesa if linha.tipo == TipoLancamento.debito else TipoCategoria.receita):
            continue
        sub = x.get("subcategoria_id") if x.get("subcategoria_id") in {s.id for s in cat.subcategorias} else None
        linha.sugestao = {**(linha.sugestao or {}), "ia": {"categoria_id": cat.id, "subcategoria_id": sub,
                                                          "favorecido": str(x.get("favorecido") or "").strip()[:200] or None}}
        n += 1
    db.flush()
    classificar(db, conc)
    return n
