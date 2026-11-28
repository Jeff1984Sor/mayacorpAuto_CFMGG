# Tipos de caso e cadastro único de partes: o que existe hoje e como vai ser migrado

Reconhecimento pedido na seção 0 de `SPEC_MAYAJUS_TIPOS_DE_CASO_E_PARTES.md`, feito em 28/11/2026.

A especificação foi escrita para Django, com execução só no servidor. Este repositório é FastAPI + SQLAlchemy 2 +
Alembic, com testes locais em SQLite e produção em PostgreSQL. Vale o `CLAUDE.md`: os conceitos e o modelo de dados da
especificação são mantidos, a forma segue os padrões daqui. Onde a especificação e o que já existe se sobrepõem, o que
existe é reaproveitado (seção 0, item 4).

## 1. O que existe hoje

| Assunto | Onde está | Situação |
|---|---|---|
| Escritório (multi-tenant) | Um banco por escritório (`app/core/tenancy.py`) e `tenant_id` em toda tabela | Todo model novo leva `tenant_id` e filtra por `ctx.tenant_id` |
| Classe base | `Base` + `Timestamped` (`criado_em`, `atualizado_em`); auditoria por `ctx.auditar(...)` | Mantido |
| Caso | `fat_caso` (`faturamento.models.Caso`), sempre dentro de um contrato do cliente | Mantido |
| Tipo do caso | `Caso.tipo`, opcional: consultivo, administrativo, judicial_estadual, judicial_federal, judicial_trabalhista | Vira derivado do novo `tipo_caso` + justiça |
| Dados do processo | Colunas do próprio caso: `numero_processo`, `tribunal`, `vara`, `comarca`, `instancia`, `valor_causa`, `data_distribuicao`, `polo` | Continuam no caso; a extensão do contencioso só guarda o que falta |
| Partes do caso | Texto livre `Caso.parte_contraria` + `Caso.polo` (lado do cliente) | Migram para Pessoa + Envolvimento; as colunas ficam como legado |
| Cliente | `tomador` (`rpa_nfse.models.Tomador`): cadastro usado por contratos, faturas, NFS-e e boletos | Continua sendo o cliente; ganha vínculo com a Pessoa |
| Pessoas de processo | `trb_pessoa` (`tribunais.models.Pessoa`): PF/PJ por escritório, com nome normalizado, CPF/CNPJ, estado civil, mãe, representante legal, ente público, endereços e telefones em JSON | Vira o cadastro único |
| Partes de processo importado | `trb_parte` (pessoa + polo + tipo de participação) e `trb_advogado_parte` (nome, OAB em texto) ligados a `trb_processo` | Continuam como espelho do tribunal; alimentam os envolvimentos |
| Advogado interno | `usuario.oab` e `trb_oab` (inscrições usadas na varredura e no protocolo) | Mantido; o advogado interno do cadastro único aponta para o usuário |
| Áreas de atuação | `fat_area` (configurável, com cor) | É a `area_direito`; recebe o seed que faltar |
| Campos personalizados | `fat_campo` + `Caso.campos` (JSON), com tela em Configurações › Faturamento › Campos adicionais | É a seção 7 já pronta; ganha o filtro por tipo de caso |
| Validação do CNJ | `tribunais/cnj.py`: dígito verificador, formatação, J/TR → tribunal e sistema | Reaproveitado (não se cria `utils/cnj.py`) |
| Tribunais | `trb_tribunal` + `faturamento/judiciario.py` | Reaproveitados |

Volume em produção hoje (cinco bancos): o escritório CFME tem 2.197 casos, 1 com tipo e 53 com número de processo;
o banco de demonstração tem 201 casos, 200 com tipo e 201 com parte contrária em texto. Nenhum banco tem pessoa ou
parte importada de tribunal.

## 2. Decisões

1. **Tipo de caso.** Coluna nova `Caso.tipo_caso` (contencioso, consultivo, administrativo), obrigatória ao criar.
   A coluna antiga `tipo` continua existindo e passa a ser calculada (consultivo, administrativo ou
   judicial_estadual/federal/trabalhista pela justiça), para não quebrar tribunais, relatórios e o seletor de tribunal.
2. **Campos comuns.** Reaproveitados: `numero` (número interno por escritório), `titulo`, `descricao`, `area_id`,
   `responsavel_id`, `data_abertura`, `data_encerramento`, `campos`. O cliente principal continua vindo do contrato.
   A situação ganha "suspenso" e "arquivado" (hoje: aberto e encerrado). Novos: equipe, motivo de encerramento, valor
   estimado, origem da captação, centro de custo, etiquetas, caso pai e tipo de vínculo, sigiloso, observações.
   Forma, valor e percentual de honorários não viram coluna: a cobrança do caso já é a regra de cobrança.
3. **Extensões 1:1.** `fat_caso_contencioso`, `fat_caso_consultivo` e `fat_caso_administrativo`, com colunas reais.
   No contencioso, número CNJ, tribunal, órgão julgador (vara), comarca, instância, valor da causa, data de
   distribuição e polo do cliente continuam nas colunas atuais do caso.
4. **Listas.** Fixas do sistema ficam em enum no código. Configuráveis por escritório (motivo de encerramento, origem,
   centro de custo, etiqueta, classe, assunto, tipo de demanda, órgão, tipo de procedimento) ficam numa tabela só,
   `fat_lista_item` (lista, nome, ordem, ativo, sistema), com seed. Item em uso nunca é apagado, só desativado.
5. **Cadastro único de pessoas.** A tabela `trb_pessoa` vira o cadastro único (menu Cadastros › Pessoas) e ganha os
   campos que faltam. Endereços, contatos e telefones continuam em listas JSON, como no cadastro de clientes.
   Documento único por escritório quando preenchido.
   **O cliente é uma parte** (confirmado pelo dono do produto em 28/11/2026):
   - Cada cliente (`tomador`) tem exatamente uma Pessoa, e essa Pessoa só existe uma vez no banco. O vínculo é 1:1:
     `tomador.pessoa_id` é único (nunca duas pessoas para o mesmo cliente, nunca dois clientes para a mesma pessoa).
   - A Pessoa que é cliente é reconhecida pelo código do cliente: toda saída de Pessoa (lista, detalhe, busca,
     envolvimentos) traz `cliente_id` (o id do tomador) e `eh_cliente`, que vem de existir o vínculo e não é um campo
     gravado que possa divergir.
   - Sem duplicar: ao criar ou alterar um cliente, se já existe Pessoa do escritório com o mesmo CPF/CNPJ, o cliente é
     ligado a ela em vez de nascer outra; ao cadastrar Pessoa (ou parte de um caso) com o documento de um cliente, a
     resposta é a Pessoa do cliente. Nome, documento e tipo vão do cliente para a Pessoa: a fonte é o cadastro de
     clientes, que emite fatura e NFS-e (pela tela de Pessoas esses três campos não mudam quando a pessoa é cliente).
   - Mesclar: a Pessoa de um cliente nunca é desativada; se uma das duas é de cliente, ela é a principal. Duas pessoas
     de clientes diferentes não se mesclam.
   - Tudo isso acontece num ponto só: antes de todo flush com cliente novo ou alterado (`rpa_nfse/models.py` chama
     `pessoas.service.sincronizar_clientes`), valendo para telas, importações e robôs.
6. **Advogados.** Tabelas novas `pes_advogado` (1:1 com a pessoa) e `pes_advogado_oab`. O advogado interno aponta para
   o usuário.
7. **Envolvimento.** Tabelas novas `fat_env_categoria`, `fat_env_qualificacao`, `fat_envolvimento` e
   `fat_envolvimento_advogado`, com os seeds das seções 6.2 a 6.4.
8. **Busca.** Por `nome_normalizado` (sem acento, minúsculo) e documento só com dígitos. As extensões `pg_trgm` e
   `unaccent` não são criadas: o PostgreSQL é compartilhado com outros sistemas e exigiria superusuário em cada
   banco. A semelhança de nomes para o aviso de duplicado é calculada no servidor da aplicação.
9. **Relatórios da migração.** Os CSV de revisão trazem dados de clientes, então não entram no repositório: o comando
   grava na pasta de armazenamento do escritório e a tela oferece o download.
10. **Fora desta entrega**, além da seção 13: tela de administração do Django (não se aplica) e a restrição de
    visualização de caso sigiloso em relatórios e no conector do Claude (nesta entrega vale na lista e na ficha).

## 3. Como os dados atuais são migrados

Comando `uv run python -m app.modules.faturamento.migrar_partes [--dry-run] [--escritorio <slug>]`, idempotente.

1. **Tipo.** Caso com tipo judicial ou com número de processo vira contencioso (a justiça vem do tipo antigo ou do
   dígito J do CNJ); tipo administrativo vira administrativo; o resto vira consultivo. Sai um CSV para revisão.
2. **Clientes.** Cada `tomador` ganha a sua Pessoa (uma por cliente; com o mesmo CPF/CNPJ já no cadastro de pessoas,
   o cliente é ligado a ela) e, em cada caso, o envolvimento "é cliente" na categoria do lado do cliente (polo do
   caso; sem polo, lado ativo, marcado "pendente de reclassificação" no contencioso para o polo não ser inventado).
3. **Parte contrária em texto.** Vira Pessoa sem documento (uma por nome idêntico normalizado) e envolvimento no polo
   oposto ao do cliente; sem polo conhecido, categoria Outros com "pendente de reclassificação". Nome idêntico ao de
   um cliente NÃO é fundido sozinho com a Pessoa do cliente (não há documento para confirmar): a parte ganha a sua
   Pessoa e a dupla entra como possível duplicado no CSV, para o administrador mesclar se for o caso.
4. **Processo importado ligado ao caso.** As partes de `trb_parte` viram envolvimentos (polo e qualificação pelo tipo
   de participação) e os advogados de `trb_advogado_parte` viram Advogado + OAB + advogado do envolvimento.
5. Nada é apagado: `parte_contraria`, `polo` e `tipo` continuam nas tabelas.
