"""Planos do MayaJus e os recursos que cada um libera. Toda funcionalidade nova entra em RECURSOS (e no admin)."""

from decimal import Decimal

from sqlalchemy import select

from app.controle.models import Plano

# chave → rótulo exibido no admin e no "Meu plano"
RECURSOS: dict[str, str] = {
    "gestao": "Gestão de processos e financeiro",
    "automacoes": "Automações padrão",
    "contador": "Integração com contador",
}

PADRAO = [
    # nome, mensal, anual (2 meses grátis), usuários, notas/mês, recursos
    ("Solo", "119", "1190", 1, 20, ["gestao"]),
    ("Escritório", "279", "2790", 5, 100, ["gestao"]),
    ("Pro", "549", "5490", 15, 500, ["gestao", "automacoes", "contador"]),
    ("Ilimitado", "990", "9900", 30, None, ["gestao", "automacoes", "contador"]),
]


def garantir_padrao(db) -> None:
    """Na primeira vez cria a tabela de planos da MayaCorp (depois é editada no admin)."""
    if db.scalar(select(Plano.id).limit(1)):
        return
    for ordem, (nome, mensal, anual, usuarios, notas, recursos) in enumerate(PADRAO):
        db.add(Plano(nome=nome, preco_mensal=Decimal(mensal), preco_anual=Decimal(anual), usuarios=usuarios,
                     notas_mes=notas, preco_nota_excedente=Decimal("0.50"), preco_usuario_adicional=Decimal("49.90"),
                     recursos=recursos, ordem=ordem))
    db.commit()
