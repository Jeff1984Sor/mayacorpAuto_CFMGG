"""Planos do MayaJus e os recursos que cada um libera. Toda funcionalidade nova entra em RECURSOS (e no admin)."""

from decimal import Decimal

from sqlalchemy import select

from app.controle.models import Plano

# chave → rótulo exibido no admin e no "Meu plano"
RECURSOS: dict[str, str] = {
    "gestao": "Gestão de processos e financeiro",
    "automacoes": "Automações padrão",
    "contador": "Integração com contador",
    "boletos": "Boletos registrados (CNAB 240, remessa e retorno)",
    "relatorios": "Relatórios com gráficos, gerador de relatórios e Excel",
    "partes": "Tipos de caso (contencioso, consultivo, administrativo) e cadastro único de partes e advogados",
    "comissoes": "Comissões dos profissionais (regras por cliente, contrato ou caso e conta a pagar)",
    "conciliacao": "Conciliação bancária (extrato do banco × contas a pagar e faturas, com revisão em lote)",
    "claude": "Conector do Claude (MCP): consultar e operar o sistema conversando",
}

# robôs feitos sob medida, liberados cliente a cliente na ficha do admin (Clientes › Ficha › Robôs liberados)
ROBOS: dict[str, str] = {
    "nfse_lote": "Emissor de NFS-e em lote (arquivo da Lello)",
    "porto_seguro": "Upload Porto Seguro (em breve)",
}

PADRAO = [
    # nome, mensal, anual (2 meses grátis), usuários, notas/mês, recursos
    ("Solo", "119", "1190", 1, 20, ["gestao", "partes", "relatorios", "claude"]),
    ("Escritório", "279", "2790", 5, 100, ["gestao", "partes", "boletos", "relatorios", "comissoes", "conciliacao", "claude"]),
    ("Pro", "549", "5490", 15, 500, ["gestao", "partes", "automacoes", "contador", "boletos", "relatorios", "comissoes", "conciliacao", "claude"]),
    ("Ilimitado", "990", "9900", 30, None, ["gestao", "partes", "automacoes", "contador", "boletos", "relatorios", "comissoes", "conciliacao", "claude"]),
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
