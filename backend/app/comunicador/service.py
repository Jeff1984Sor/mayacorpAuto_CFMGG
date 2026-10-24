import re

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.comunicador.models import Conversa, Mencao, Mensagem, Participante, chave_direta
from app.core.db import agora
from app.core.models import Usuario

# Menção vinda do autocomplete do front: @[Nome Sobrenome](42)
RE_MENCAO = re.compile(r"@\[([^\]]{1,80})\]\((\d+)\)")
ROBO = {"id": None, "nome": "Robô MayaCorp"}


class Proibido(Exception):
    pass


def participa(db: Session, conversa_id: int, usuario_id: int) -> Participante | None:
    return db.scalar(select(Participante).where(Participante.conversa_id == conversa_id,
                                                Participante.usuario_id == usuario_id))


def _usuarios_ativos(db: Session, tenant_id: int) -> list[Usuario]:
    return list(db.scalars(select(Usuario).where(Usuario.tenant_id == tenant_id, Usuario.ativo, Usuario.acesso_sistema)))


def abrir_direta(db: Session, eu: Usuario, outro_id: int) -> Conversa:
    outro = db.get(Usuario, outro_id)
    if not outro or outro.tenant_id != eu.tenant_id or not outro.ativo or outro.id == eu.id:
        raise Proibido("Usuário não encontrado.")
    chave = chave_direta(eu.id, outro.id)
    c = db.scalar(select(Conversa).where(Conversa.tenant_id == eu.tenant_id, Conversa.chave_direta == chave))
    if c:
        return c
    c = Conversa(tenant_id=eu.tenant_id, tipo="direta", chave_direta=chave, criado_por=eu.id)
    c.participantes = [Participante(usuario_id=eu.id), Participante(usuario_id=outro.id)]
    db.add(c)
    db.flush()
    return c


def criar_grupo(db: Session, eu: Usuario, titulo: str, usuario_ids: list[int]) -> Conversa:
    validos = {u.id for u in _usuarios_ativos(db, eu.tenant_id)}
    membros = ({eu.id} | set(usuario_ids)) & validos
    if len(membros) < 2:
        raise Proibido("Escolha ao menos uma pessoa para o grupo.")
    c = Conversa(tenant_id=eu.tenant_id, tipo="grupo", titulo=titulo.strip()[:140], criado_por=eu.id)
    c.participantes = [Participante(usuario_id=u) for u in membros]
    db.add(c)
    db.flush()
    return c


def canal_robo(db: Session, tenant_id: int) -> Conversa:
    """Canal "Robô MayaCorp": todos os usuários ativos participam (quem entrar depois é incluído aqui)."""
    c = db.scalar(select(Conversa).where(Conversa.tenant_id == tenant_id, Conversa.tipo == "robo"))
    if c is None:
        c = Conversa(tenant_id=tenant_id, tipo="robo", titulo="Robô MayaCorp")
        db.add(c)
        db.flush()
    ja = {p.usuario_id for p in c.participantes}
    ultima = db.scalar(select(func.max(Mensagem.id)).where(Mensagem.conversa_id == c.id)) or 0
    for u in _usuarios_ativos(db, tenant_id):
        if u.id not in ja:
            c.participantes.append(Participante(usuario_id=u.id, lida_ate=ultima))
    db.flush()
    return c


def enviar(db: Session, conversa: Conversa, autor: Usuario | None, texto: str, resposta_a_id: int | None = None,
           link: str | None = None) -> Mensagem:
    texto = texto.strip()
    if not texto:
        raise Proibido("Mensagem vazia.")
    if conversa.tipo == "robo" and autor is not None:
        raise Proibido("O canal do robô é só para avisos.")
    if resposta_a_id:
        alvo = db.get(Mensagem, resposta_a_id)
        if not alvo or alvo.conversa_id != conversa.id:
            resposta_a_id = None
    m = Mensagem(conversa_id=conversa.id, autor_id=autor.id if autor else None, texto=texto[:4000],
                 resposta_a_id=resposta_a_id, link=link)
    db.add(m)
    db.flush()
    conversa.ultima_msg_em = m.criada_em
    if autor:
        p = participa(db, conversa.id, autor.id)
        if p:
            p.lida_ate = m.id  # quem envia já leu
        membros = {p.usuario_id for p in conversa.participantes}
        for _nome, uid_txt in RE_MENCAO.findall(texto):
            uid = int(uid_txt)
            if uid in membros and uid != autor.id:
                db.add(Mencao(tenant_id=conversa.tenant_id, usuario_id=uid, autor_id=autor.id, mensagem_id=m.id,
                              trecho=texto_simples(texto)[:300], url=f"/comunicador?conversa={conversa.id}&msg={m.id}"))
    return m


def robo_postar(db: Session, tenant_id: int, texto: str, link: str | None = None) -> None:
    """Aviso do robô no canal (chamado pelo worker ao fim de lote, pela conciliação etc.)."""
    enviar(db, canal_robo(db, tenant_id), None, texto, link=link)


def chamar(db: Session, eu: Usuario, usuario_id: int, texto: str, origem_tipo: str, origem_id: int, url: str) -> Mencao:
    """"Chamar alguém" a partir de um registro: menção avulsa + mensagem na conversa direta, com o link."""
    alvo = db.get(Usuario, usuario_id)
    if not alvo or alvo.tenant_id != eu.tenant_id or not alvo.ativo:
        raise Proibido("Usuário não encontrado.")
    conversa = abrir_direta(db, eu, alvo.id)
    m = enviar(db, conversa, eu, texto, link=url)
    men = Mencao(tenant_id=eu.tenant_id, usuario_id=alvo.id, autor_id=eu.id, mensagem_id=m.id, origem_tipo=origem_tipo,
                 origem_id=origem_id, trecho=texto[:300], url=url)
    db.add(men)
    db.flush()
    return men


def marcar_lido(db: Session, p: Participante, ate_id: int | None) -> int:
    ultima = db.scalar(select(func.max(Mensagem.id)).where(Mensagem.conversa_id == p.conversa_id)) or 0
    p.lida_ate = max(p.lida_ate, min(ate_id or ultima, ultima))
    # abrir a conversa também dá as menções dela por lidas
    db.query(Mencao).filter(Mencao.usuario_id == p.usuario_id, Mencao.lida_em.is_(None),
                            Mencao.mensagem_id.in_(select(Mensagem.id).where(Mensagem.conversa_id == p.conversa_id,
                                                                            Mensagem.id <= p.lida_ate))
                            ).update({Mencao.lida_em: agora()}, synchronize_session=False)
    return p.lida_ate


def nao_lidas(db: Session, usuario_id: int) -> dict[int, int]:
    rows = db.execute(
        select(Participante.conversa_id, func.count(Mensagem.id))
        .join(Mensagem, Mensagem.conversa_id == Participante.conversa_id)
        .where(Participante.usuario_id == usuario_id, Mensagem.id > Participante.lida_ate,
               or_(Mensagem.autor_id.is_(None), Mensagem.autor_id != usuario_id), Mensagem.apagada_em.is_(None))
        .group_by(Participante.conversa_id)
    ).all()
    return {cid: n for cid, n in rows}


def texto_simples(texto: str) -> str:
    """@[Nome](42) → @Nome (para trechos, e-mails e buscas)."""
    return RE_MENCAO.sub(lambda m: "@" + m.group(1), texto)
