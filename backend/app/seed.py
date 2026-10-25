"""Dados de demonstração: `python -m app.seed` (idempotente).

Cria o tenant CFME, usuários dos três perfis, a emissora, parâmetros fiscais padrão do layout 2,
clientes, um arquivo de exemplo no layout da Lello (exemplos/) e um lote já emitido em simulação.
"""

import random
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.models import ConfigNotificacao, Identidade, Perfil, Tenant, Usuario
from app.core.security import hash_senha
from app.modules.rpa_nfse import parser_txt, service, tasks
from app.modules.rpa_nfse.models import Emissora, ParametroFiscal, Regime, Tomador

SENHA = "Cfme@2026"
CCM = "12345678"

CLIENTES = [
    ("PJ", "CONDOMINIO EDIFICIO SOLAR", "11444777000161", "RUA DAS FLORES", "100", "CENTRO", "01001000", "sindico@solar.com.br"),
    ("PJ", "CONDOMINIO RESIDENCIAL VILA VERDE", "04252011000110", "AV PAULISTA", "1500", "BELA VISTA", "01310100", "adm@vilaverde.com.br"),
    ("PJ", "CONDOMINIO PARQUE DAS ARVORES", "33000167000101", "RUA AUGUSTA", "2200", "CONSOLACAO", "01412000", "parque@arvores.com.br"),
    ("PJ", "CONDOMINIO EDIFICIO AURORA", "60701190000104", "RUA OSCAR FREIRE", "300", "JARDINS", "01426001", "aurora@condominio.com.br"),
    ("PJ", "CONDOMINIO JARDIM EUROPA", "00000000000191", "RUA EUROPA", "50", "JARDIM EUROPA", "01449000", "europa@cond.com.br"),
    ("PJ", "CONDOMINIO MORADA DO SOL", "07526557000100", "RUA VERGUEIRO", "4000", "VILA MARIANA", "04101300", "morada@sol.com.br"),
    ("PJ", "CONDOMINIO TORRES DO IPIRANGA", "61186680000174", "AV NAZARE", "800", "IPIRANGA", "04262000", "torres@ipiranga.com.br"),
    ("PF", "JOAO DA SILVA", "52998224725", "RUA TABAPUA", "45", "ITAIM BIBI", "04533010", "joao.silva@email.com"),
    ("PF", "MARIA OLIVEIRA SANTOS", "11144477735", "RUA HADDOCK LOBO", "595", "CERQUEIRA CESAR", "01414001", ""),
    ("PJ", "CONDOMINIO MIRANTE DA LAPA", "45997418000153", "RUA CLELIA", "1000", "LAPA", "05042000", "mirante@lapa.com.br"),
]


def _detalhes(qtd: int, inicio: int, com_erros: bool) -> list[dict]:
    rnd = random.Random(inicio)
    out = []
    for i in range(qtd):
        tipo, nome, doc, rua, num, bairro, cep, email = CLIENTES[i % len(CLIENTES)]
        valor = Decimal(rnd.choice([850, 950, 1250, 1480, 2100, 3200, 780, 1600])) + Decimal(rnd.randint(0, 99)) / 100
        d = {
            "numero": inicio + i, "data": date.today() - timedelta(days=rnd.randint(1, 20)), "valor": str(valor),
            "cod_servico": "03220", "aliquota": "0.05", "ind_doc": "1" if tipo == "PF" else "2", "doc": doc,
            "nome": nome, "tipo_logradouro": "R", "logradouro": rua, "numero_end": num, "bairro": bairro,
            "cidade": "SAO PAULO", "uf": "SP", "cep": cep, "email": email,
            "discriminacao": f"Honorarios advocaticios - cobranca de cotas condominiais|Competencia {date.today():%m/%Y}",
        }
        out.append(d)
    if com_erros:
        out[2]["doc"] = "98765432000119"  # CNPJ inválido
        out[5]["cep"] = "00000000"  # CEP inválido
        out[7]["nome"] = "CLIENTE NOVO LTDA"  # tomador novo
        out[7]["doc"] = "19131243000197"
        out[7]["ind_doc"] = "2"
    return out


def gerar_exemplo() -> Path:
    # vai para o storage (não para a pasta do código): as datas mudam a cada geração e sujariam o git do servidor
    destino = Path(settings.storage_dir) / "exemplos" / "lello_rps_exemplo.txt"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(parser_txt.gerar_arquivo(CCM, _detalhes(120, 2001, com_erros=True)))
    return destino


def base(db) -> Tenant:
    """Só o essencial para um ambiente real: o cliente, a identidade e as configurações. Sem dados de teste."""
    t = db.scalar(select(Tenant).where(Tenant.slug == "cfme"))
    if t:
        return t
    t = Tenant(slug="cfme", nome="CFME Advogados")
    db.add(t)
    db.flush()
    db.add(Identidade(tenant_id=t.id, nome_exibicao="CFME Advogados", cor_destaque=None,
                      assinatura_email="CFME Advogados\nDepartamento Financeiro"))
    db.add(ConfigNotificacao(tenant_id=t.id, remetente_nome="CFME Advogados", avisos_destinatarios=[]))
    db.commit()
    return t


def main() -> None:
    import sys

    from app.main import migrar

    migrar()
    if "--somente-base" in sys.argv:
        with SessionLocal() as db:
            base(db)
        print("Base pronta (cliente CFME, identidade e configurações), sem dados de teste.")
        print("Crie o primeiro acesso: python -m app.criar_usuario --login ... --nome ... --email ... --perfil admin")
        return

    if settings.ambiente != "dev":
        sys.exit("Dados de demonstração só no ambiente dev. No servidor use: python -m app.seed --somente-base")
    with SessionLocal() as db:
        if db.scalar(select(Tenant).where(Tenant.slug == "cfme")):
            print("Seed já aplicado.")
            print(f"Arquivo de exemplo: {gerar_exemplo()}")
            return
        t = base(db)
        for nome, email, perfil in [("Cristina", "admin@cfme.com.br", Perfil.admin),
                                    ("Operador CFME", "operador@cfme.com.br", Perfil.operador),
                                    ("Visualizador CFME", "visualizador@cfme.com.br", Perfil.visualizador)]:
            db.add(Usuario(tenant_id=t.id, nome=nome, email=email, perfil=perfil, senha_hash=hash_senha(SENHA)))
        e = Emissora(tenant_id=t.id, razao_social="CFME SOCIEDADE DE ADVOGADOS", nome_fantasia="CFME Advogados",
                     cnpj="11222333000181", ccm=CCM, cep="01310100", logradouro="Av. Paulista", numero="1000",
                     complemento="10º andar", bairro="Bela Vista", cidade="São Paulo", uf="SP",
                     email="financeiro@cfme.com.br", telefone="(11) 3000-0000", banco="341 - Itaú",
                     agencia="0001", conta="12345-6", chave_pix="11222333000181",
                     regime=Regime.presumido, cod_servico_padrao="03220",
                     aliquota_iss=Decimal("0.05"), serie_rps="A", prox_rps=3000)
        db.add(e)
        db.flush()
        # Valores provisórios — definidos com o contador da CFME na implantação (spec 6.8.4)
        db.add(ParametroFiscal(tenant_id=t.id, emissora_id=e.id, escopo="padrao",
                               descricao="Padrão CFME (provisório — validar com o contador)",
                               nbs="113011000", class_trib="000001", cst_ibscbs="000", ind_operacao="100301",
                               finalidade="0", ind_final="0", ind_destinatario="0", tributacao_rps="T"))
        for tipo, nome, doc, rua, num, bairro, cep, email in CLIENTES[:7]:
            db.add(Tomador(tenant_id=t.id, tipo=tipo, nome=nome, cpf_cnpj=doc, logradouro=rua, numero=num, bairro=bairro,
                           cidade="SAO PAULO", uf="SP", cep=cep, emails=[email] if email else []))
        db.commit()

        admin = db.scalar(select(Usuario).where(Usuario.email == "admin@cfme.com.br"))
        lote = service.importar(db, tenant_id=t.id, usuario_id=admin.id, emissora=e, nome="lello_historico.txt",
                                conteudo=parser_txt.gerar_arquivo(CCM, _detalhes(64, 1001, com_erros=False)))
        service.enfileirar(db, lote)
        db.commit()
        lote_id = lote.id
    tasks.processar_lote(lote_id)
    print("Seed aplicado. Logins (senha Cfme@2026): admin@ / operador@ / visualizador@cfme.com.br")
    print(f"Arquivo de exemplo para upload: {gerar_exemplo()}")


if __name__ == "__main__":
    main()
