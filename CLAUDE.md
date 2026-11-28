# CLAUDE.md

> **Leia primeiro.** **MayaJus** (MayaCorp): gestão de escritório de advocacia, white-label, com hub de RPAs. Cliente atual: **CFME Advogados**
> (o nome, o logo e a cor vêm de Configurações › Identidade; nunca deixe "CFME" fixo no código de produto).
> Especificação: `MayaCorp_Automacoes_RPA01_NFSe.md`.

| Ambiente | Endereço | Pasta no servidor | Portas (API/web) | Banco | Branch |
|---|---|---|---|---|---|
| Homologação | `hml-automacoes.mayacorp.com.br` | `/home/deploy/mayacorp-automacoes/hml` | 10031 / 10032 | `automacoes_hml` | `develop` |
| Produção | `mayajus.mayacorp.com.br` (antigo: automacoes1) | `/home/deploy/mayacorp-automacoes/prod` | 10021 / 10022 | `automacoes_prod` | `main` |

**O servidor é compartilhado** (Hostinger VPS `srv1703721`, IP `2.25.130.240`, acesso `ssh flicsales` como `deploy` com sudo; Ubuntu 24.04) com Flicsales, MayaSec, MayaPost, MayaAssinador,
Pilates, App Beach, Print3D (Docker), Evolution e o site da MayaCorp. Regras: só **acrescentar** (nunca atualizar
pacotes, reiniciar serviços alheios ou editar sites do nginx de outros sistemas); serviços `automacoes-{api,worker,web}@<amb>`
rodando como `deploy`; site nginx próprio `automacoes-<amb>` sem `map` global; `nginx -t` antes de todo reload.
Portas já ocupadas por outros sistemas: 3000, 3001, 3007, 3010, 3020, 3030, 8000, 8001, 8010, 8011, 8020, 8030,
8077, 8080, 9000, 10001, 10002, 38000-38002, 39000-39002, 5432 (Postgres 16 compartilhado), 6379.

**Tudo entra primeiro em homologação**, com o modo **Teste** em Configurações › Prefeitura. Produção só quando o Jefferson mandar, e o deploy de prod cria a tag `vN`.

## Estrutura

- `backend/` é FastAPI + SQLAlchemy 2 + Alembic, gerenciado com `uv`. Rode comandos com `uv run python -m ...`: os `.exe` do venv são bloqueados nesta máquina Windows, então `uv run pytest` falha e `uv run python -m pytest` funciona.
  - `app/core/` é o núcleo compartilhado (auth JWT, usuários, identidade, certificado, notificações, auditoria imutável).
  - `app/modules/rpa_nfse/` é o RPA 01. Um robô novo vira um pacote irmão (`rpa_porto/`) com models, routes e tasks próprios, mais um card em `app/core/routes/hub.py`.
  - Dentro do RPA 01: `fatura.py` + `pix.py` (Nota de Honorários por nota, no modelo da NH do RCA, com PIX copia e cola),
    `extrato.py` + `conciliacao.py` (extrato OFX/CSV/XLSX → baixa automática), `raio_x.py` (análise do arquivo antes de emitir).
    Nota e fatura andam juntas: toda mudança de pagamento/cancelamento da nota chama `fatura.sincronizar(db, nota)`.
  - `app/modules/rpa_nfse/prefeitura_sp/` concentra **toda** a conversa com a Prefeitura. Quando o layout mudar, só esse pacote muda.
  - `app/modules/faturamento/`: Cliente → Contrato → Caso, com regras de cobrança (fixo, recorrente no estilo Outlook, por hora).
    - Itens a faturar → Revisão (pré-fatura "Em Revisão", com IA) → fatura NH (honorários) ou ND (despesas; nunca vira NFS-e).
    - A NFS-e da NH sai depois (`emitir_nfse` monta um lote com `dados_json.fatura_id`).
    - Nada é cobrado duas vezes: `FaturaItem.chave_cobranca` é UNIQUE e horas/despesas guardam `fatura_item_id`.
    - O valor/hora vem da tabela de preço (regra → caso → contrato) × o **cargo** do funcionário.
    - Tabela progressiva / regressiva (`faixas.py`, `RegraFaixa`): a regra por hora pode ter faixas de horas do **mês do lançamento** (zera todo dia 1º), cada uma cobrada por valor fixo, valor/hora, tabela × cargo ou % da tabela padrão. Modo `escalonada` (cada faixa vale para as horas dentro dela; lançamento na fronteira é dividido) ou `atingida` (o total do mês escolhe uma faixa só). Sem faixas, nada muda.
    - As horas com faixas são calculadas no mesmo ponto das outras (`service.pendencias`), então Itens a faturar, Revisão e fatura mostram o mesmo valor e o `detalhe` de onde ele veio. Cada hora faturada ou em revisão guarda o trecho do mês que ocupou (`FaturaItem.faixa`): as novas entram no primeiro espaço livre, sem repetir nem pular faixa.
    - O valor fixo de uma faixa é um item próprio (tipo `hora`, chave `faixa:<regra>:<aaaa-mm>:<nº>`, UNIQUE); as horas dentro dela saem com valor zero.
  - Com ou sem a figura do contrato (Configurações › Faturamento › Contratos, `fat_config.usa_contrato`, padrão sim): desligado, o escritório só vê Cliente → Caso. A estrutura não muda: cada cliente tem um contrato único criado por trás (`service.contrato_do_cliente`, nome "Geral"), onde ficam regras, pagadores, emissora e tabela; as telas escondem o contrato (`useUsaContrato()` em `frontend/lib/contrato.ts`) e a ficha do cliente ganha a aba Cobrança. Só desliga se nenhum cliente tiver mais de um contrato. Tela nova que mostre contrato precisa respeitar o hook.
  - Usuário = funcionário (`core.models.Usuario`, com cargo, OAB, endereço). `acesso_sistema=False` = só lança horas, sem login.
  - `app/modules/financas/` (Financeiro): contas bancárias e extrato, transferências, contas a pagar (rateio, recorrência, baixa),
    fluxo de caixa, DRE gerencial (pela `grupo_dre` da categoria), projeção de despesas, previsão de caixa e projeção de impostos (Simples ou Presumido).
    - O saldo nunca é gravado: é sempre calculado a partir dos lançamentos.
    - Pagar uma conta lança um débito no extrato. Fatura paga vira crédito na conta de recebimento (`fatura.espelhar_no_financeiro`).
    - **Conciliação bancária** (`conciliacao.py` + `routes_conciliacao.py`, tela **Conta Bancária › Conciliação**, permissão `conciliacao.ver` / `conciliacao.conciliar`): o extrato do banco (OFX/CSV/XLSX, lido por `rpa_nfse/extrato.ler_movimentos`, o mesmo leitor de Recebimentos, agora com débitos e saldo final) de UMA conta. Cada linha (`fin_conciliacao_linha`, UNIQUE conta × chave: a mesma linha nunca entra duas vezes) fica **conciliada** (já havia lançamento igual, até 3 dias de diferença: só vincula), **baixa sugerida** (conta a pagar ou fatura em aberto que casa por valor, data e nome/documento; vale um pagamento para vários títulos; confiança alta só com nome ou documento) ou **sem correspondência** (sugere o lançamento a criar).
    - Nada é gravado sem OK: os três popups (contas a pagar para criar, recebimentos para criar, baixas sugeridas) gravam o lote numa transação, pelos serviços das telas (`service.criar_contas` + `pagar`, `service.lancar`, `fatura.dar_baixa`). O que cada linha fez fica em `fin_conciliacao_vinculo` (UNIQUE linha × alvo e UNIQUE lançamento): é a trava contra lançamento em dobro e o que permite **desfazer em bloco** (`reabrir`/`excluir_conta`, `excluir_lancamento`, `fatura.desfazer_baixa`).
    - A classificação é refeita ao abrir a conciliação (`classificar`): baixa ou lançamento desfeito em outra tela devolve a linha a pendente. O "só no sistema" e o fechamento (saldo do arquivo × saldo calculado) são calculados na leitura. O que o usuário confirma vira regra (`fin_conciliacao_regra`: descrição normalizada → categoria/favorecido) e a próxima importação já sugere; IA é opcional (botão).
- **Tipos de caso e partes** (ainda em `app/modules/faturamento/`; especificação em `SPEC_MAYAJUS_TIPOS_DE_CASO_E_PARTES.md`, decisões em `docs/analise_partes_atual.md`, campos em `docs/campos_padrao.md`, gerado por `doc_campos.py`):
  - `Caso.tipo_caso` (contencioso | consultivo | administrativo). A coluna antiga `tipo` é **calculada** num ponto só (`casos.sincronizar_tipo`: tipo de caso + justiça). Chamada antiga que manda só `tipo` continua valendo (o tipo de caso é deduzido; sem os dois: com nº de processo é contencioso, senão consultivo). Trocar o tipo depois de criado é só do administrador.
  - `casos.py` é o ponto único do caso por tipo: `aplicar` (rotas) e `ao_criar` (importações, tribunais) decidem o tipo, gravam os campos comuns novos (só os que vieram no pedido), a extensão 1:1 (`fat_caso_contencioso` / `_consultivo` / `_administrativo`, em `tipos_caso.py`) e garantem o cliente entre as partes. Entram e saem pelos blocos `contencioso`, `consultivo`, `administrativo` de `CasoIn` / `CasoOut` (mesma classe na entrada e na saída).
  - No contencioso, número CNJ, tribunal, vara, comarca, instância, valor da causa, distribuição e polo continuam nas colunas do caso. O CNJ usa `tribunais/cnj.py`; número repetido é aviso (`aviso_cnj_duplicado`), não bloqueio.
  - Listas fixas = `tipos_caso.ROTULOS` (saem em `/faturamento/casos/opcoes`). Listas do escritório = `fat_lista_item` (`listas.py`, rota `/faturamento/listas`); item do sistema ou em uso só é desativado. Seeds (listas, áreas, categorias e qualificações) entram sozinhos: `seeds_caso.garantir` ao criar o escritório e na primeira leitura.
  - Partes (`envolvimento.py`): Pessoa × caso com categoria (por tipo de caso, com polo) e qualificação, mais os advogados da parte. O caso nunca fica sem cliente; no contencioso `Caso.polo` vem das partes que são cliente; conflito de interesses responde 409 e pede `conflito_confirmado` (quem confirmou fica na auditoria). Parte retirada é desativada, nunca apagada. `parte_contraria` e `polo` em texto ficam como legado.
  - Migração dos dados antigos: `migrar_partes.py` (idempotente, com `--dry-run`); os CSV de revisão ficam na pasta de arquivos do escritório e o administrador baixa em `/api/faturamento/migracao-partes`.
  - Capa do tribunal (`docs/capa_do_tribunal.md`): a consulta é `tribunais/caso.py · capa` (nada grava; a tela é `components/tribunais/cnj-caso.tsx`, que preenche só campo vazio ao digitar o CNJ) e a gravação é `faturamento/partes_tribunal.py` (`preencher_ficha` + `aplicar_partes`, pelo job `importar_caso` ou, em caso antigo que nunca recebeu partes, pela ficha sozinha: `CasoOut.buscar_partes_tribunal` → `POST /casos/{id}/partes-do-tribunal`, sem botão). Regra de não duplicar: pessoa pelo CPF/CNPJ (documento de cliente sem Pessoa cria ou liga a Pessoa do cliente: `pessoas.service.ligar_cliente_pelo_documento`), advogado pela OAB, o cliente do caso é a mesma parte, e nome idêntico só funde com pessoa jurídica ou ente público (homônimo pessoa física com CPF vira possível duplicado para mesclar).
- `app/modules/pessoas/` (**Cadastros › Pessoas**): o cadastro único de partes é a tabela `trb_pessoa` (a mesma das partes de processo importado), mais `pes_advogado` e `pes_advogado_oab`.
  - **O cliente é uma parte**: `tomador.pessoa_id` é único (1:1). Antes de todo flush com cliente novo ou alterado (`rpa_nfse/models.py` → `pessoas.service.sincronizar_clientes`) o cliente ganha a sua Pessoa, ou é ligado à que já tem o mesmo CPF/CNPJ, e nome, documento e tipo vão do cliente para a Pessoa. "É cliente" nunca é gravado: toda saída de Pessoa traz `cliente_id` (o código do cliente) e `eh_cliente` calculados do vínculo.
  - Documento único por escritório: cadastrar com CPF/CNPJ que já existe devolve a pessoa existente (`ja_existia`). Busca por `nome_normalizado` e documento sem máscara (sem `pg_trgm`/`unaccent`: o Postgres é compartilhado); possíveis duplicados por semelhança de nome calculada em Python (0,8).
  - Mesclar é só do administrador, com auditoria: a pessoa de um cliente é sempre a que fica e clientes diferentes não se mesclam. Pessoa em uso é desativada, não excluída. Permissão `pessoas.ver` / `editar` / `excluir`.
- `app/modules/comissoes/` (tela **Financeiro › Comissões** e seção "Comissão" na ficha do profissional): cada profissional tem regras de comissão (`com_regra`: % com alcance geral, cliente, contrato ou caso; vigência opcional). Vale a mais específica (caso > contrato > cliente > geral); regra de 0% tira o alcance da comissão.
  - A comissão **nunca é gravada**: `service.apurar` calcula na leitura, sobre o que o cliente pagou em fatura NH (o mesmo valor do crédito no extrato; ND não gera), pela data do pagamento, distribuindo o recebido entre os casos da fatura na proporção dos itens.
  - Só o vínculo é guardado: `com_lancada` (UNIQUE fatura × profissional) diz que aquela comissão virou a conta a pagar X (uma conta por profissional, `funcionario_id` = o profissional, categoria "Comissões"). Conta paga = comissão paga; conta excluída (`financas.service.excluir_conta` chama `soltar_contas`) = volta a "a pagar".
  - Recebimento estornado ou fatura cancelada com conta já gerada não apaga nada: aparece como divergência na tela. Permissão `comissoes.ver` / `comissoes.editar` (gerar a conta); as regras seguem `cfg_profissionais`.
- `app/modules/boletos/` (tela **Boletos**, especificação em `SPEC_CNAB240_SANTANDER.md`): boletos registrados por arquivo CNAB 240, sem API de banco.
  - `cnab/` é o motor genérico de campos fixos (o layout é conferido ao importar: 1 a 240, sem buraco). Cada banco é um adaptador em `bancos/` (hoje `santander/` e `bradesco/`; o que é do padrão FEBRABAN fica em `bancos/retorno_comum.py`); banco novo = pacote novo + uma linha em `bancos/registry.py`.
  - Fluxo: boleto (rascunho) → **remessa** `.REM` → upload no Internet Banking → **retorno** `.RET` → registrado / rejeitado / pago. Pagamento dá baixa na fatura (`service._baixar_fatura`).
  - Nosso número: contador por convênio, travado ao reservar, nunca reaproveitado. Depois da remessa o boleto só muda por instrução (02 baixa, 06 vencimento).
  - O boleto só vai ao cliente depois do retorno `02` (e-mail com boleto + NH/ND + NFS-e em `envio.py`). Convênio não homologado gera remessa de **teste**.
  - Códigos marcados `TODO [CONFIRMAR]` em `bancos/santander/codigos.py` são editáveis no cadastro do convênio; confirmar com o banco na homologação.
- `app/modules/relatorios/` (menu **Relatórios**): gerador genérico. `fontes.py` declara cada fonte (horas, casos, andamentos, tarefas, regras, despesas, faturas) com colunas e permissão e carrega as linhas; `motor.py` filtra, agrupa para o gráfico e ordena (igual para toda fonte); `prontos.py` são só configurações (os relatórios de Clientes, Casos e Financeiro).
  - Relatório novo = uma entrada em `prontos.py`; dado novo = uma `Fonte` em `fontes.py`. A rota é livre: quem decide o acesso é a permissão da fonte e de cada coluna (valor de horas exige `faturas.ver`; sem `ver_todos`/`ver_todas`, só as próprias horas/tarefas).
  - Gráfico: paleta categórica `--viz-c1..c8` (validada claro/escuro), no máximo 8 séries, o resto vira "Outros". Excel sai com a aba Gráfico nativa. Salvos em `relatorio_salvo`.
- `app/modules/mcp/` (Minha conta › **Claude**): conector MCP em `POST /api/mcp` (Streamable HTTP sem sessão, JSON-RPC feito à mão em FastAPI, sem SDK).
  - Login OAuth 2.1 com PKCE e registro dinâmico (`oauth.py`); o `client_id` é um JWT (nada guardado antes do login). A conexão (`conexao_mcp`: usuário, aplicativo, leitura ou escrita) fica no banco do escritório e pode ser encerrada pelo usuário ou pelo administrador.
  - As ferramentas (`ferramentas.py`: `buscar_rotas`, `detalhar_rota`, `consultar`, `relatorio`, `alterar`) chamam a própria API por dentro com um access token do usuário: valem as permissões, as validações e a auditoria das telas. O índice vem do OpenAPI, então rota nova aparece sozinha; o que não pode passar entra em `_BLOQUEADAS` / `_SO_LEITURA`.
  - A descoberta `/.well-known/oauth-*` na raiz do domínio é respondida pelo Next (`frontend/app/.well-known/`, espelho de `oauth.py`), porque o nginx só manda `/api` para o backend. Tela de autorização: `/conectar-claude`.
- `app/controle/` (banco `mayajus_controle`): escritórios, planos, contratos e **cobrança pelo Mercado Pago**
  (`cobranca.py` + `mercadopago.py` + `routes_cobranca.py`: mensalidade no dia 1, avulsa, cartão recorrente, régua de e-mails,
  webhook em `/api/public/mercadopago`, "Meu plano" do cliente). Token do MP fica cifrado no controle (tela Cobranças do admin).
  Cadastro fiscal do cliente (`cadastro.py`): fonte única é o `Tomador` do banco do admin (`Cliente.tomador_id`), editado na aba Dados da ficha com o mesmo formulário de Cadastros › Clientes (`frontend/components/clientes/cadastro-form.tsx`, rotas `/nfse/tomadores`). Nome, documento, e-mail do financeiro (1º e-mail), telefone (1º) e responsável (contato principal) do `Cliente` são cópia, refeita ao salvar o tomador, a cada leitura do admin e no migrar (`ligar_todos`, que liga os antigos sem duplicar). Cadastro incompleto (`rpa_nfse.service.pendencias_para_nota`) não emite: o que falta fica em `cobranca.nfse_erro`.
  NFS-e da mensalidade (`nota_fiscal.py`): com a opção ligada, cobrança paga vira nota no banco do admin (emissora da MayaCorp, Emissor Nacional) para o CNPJ do escritório; o resumo (número, chave, erro) fica na cobrança. A baixa registra a cobrança em `session.info` e quem dá o commit chama `nota_fiscal.apos_pagamento(cobranca.pagas(db))`.
  - **Serviços cobrados dos clientes do admin = regras de cobrança do faturamento** (`faturamento_admin.py`), um caminho só: ficha do cliente (Admin › Clientes › aba Cobranças, o mesmo componente `CobrancaDoCliente` dos escritórios, no `tomador_id` do cliente) → Faturamento › Itens a faturar → fatura → NFS-e. O Mercado Pago ficou só com a mensalidade do plano, o cartão e as avulsas.
    - `faturamento_admin.preparar()` roda no migrar de todo deploy (`service.migrar_todos`, depois de `cadastro.ligar_todos()`), idempotente: põe o banco do admin sem contratos (`fat_config.usa_contrato = False`; se já houver contratos só avisa no log), com `fat_config.texto_servico = "Serviços prestados"` (1ª linha da fatura e da nota; vazio = "Honorários advocatícios", o padrão dos escritórios) e com o emissor de NFS-e liberado (`robos` com `nfse_lote`, senão a tela do lote da fatura abre "Sem acesso").
    - O motor antigo de "cobranças recorrentes" (`cobranca_recorrente`, link do Mercado Pago por competência) foi desligado: rotas, tela e geração na rotina diária saíram. Cada recorrência ativa ou pausada vira uma regra recorrente no contrato único do cliente, só com as competências ainda não geradas, e fica `status = "migrada"` com `regra_id`. A tabela e as cobranças `tipo = "recorrente"` já geradas são histórico (seguem a régua e recebem baixa). Recorrência de cliente sem cadastro ligado NÃO migra: fica o aviso no log.
    - Cliente inativado ou excluído no admin sai de Itens a faturar (`cobrar_cliente` desliga o contrato único dele; reativar liga de novo).
    - No painel o menu Cadastros é escondido: link de "abrir cliente" passa sempre por `useLinkCliente()` (`frontend/lib/contrato.ts`), que no painel leva à ficha do admin do cliente daquele `tomador_id`.
  - Cliente sem acesso ao sistema (`Cliente.tipo = "externo"`, cadastro em `POST /admin/clientes/externo`): só ficha, contratos e cobranças; sem banco, login, domínio, plano, teste, mensalidade nem cartão recorrente. `service._esc` nunca devolve escritório para ele (login, domínio, token, worker e `migrar` passam por ali): no externo, `banco` vazio é "não tem banco", nunca o banco principal. Rota que mexe no ambiente usa `_escritorio`; a que serve aos dois, `_cliente`.
    - `dar-acesso` vira escritório pelo caminho do cadastro normal (`service.dar_acesso`); `tirar-acesso` vira externo sem apagar nada (o banco fica guardado e volta se o acesso for devolvido) e cancela o cartão no Mercado Pago. O escritório do banco principal não pode perder o acesso.
  - Cobranças recorrentes (`recorrencia.py` + `routes_recorrencia.py`, tabela `cobranca_recorrente`, seção na aba Cobranças da ficha): valem para os dois tipos de cliente e são sempre por link. A `rotina_diaria` gera a cobrança (`tipo="recorrente"`, UNIQUE recorrência × competência) `antecedencia` dias antes do vencimento, já com link e e-mail; depois ela segue régua, baixa e NFS-e como as outras (na nota vai a descrição do serviço, não o texto da licença).
    - O cursor (`proxima_competencia` + `geradas`) impede pular ou repetir; mudar valor, dia ou periodicidade só vale para as próximas. Atrasadas saem em ordem, até `TETO_POR_DIA` (3) por recorrência por dia, com `PRAZO_ATRASADA` (5) dias para pagar. Cliente inativo não gera.
    - Sem e-mail do financeiro a cobrança nasce do mesmo jeito e fica com `envio_erro` (a tela destaca "Não enviada"); a régua não repete erro no log e envia quando o e-mail aparecer.
  - Esquema do controle: migrations em `backend/alembic_controle/versions/` (o deploy roda `app.controle.cli migrar`).
- Menu **Cadastros** (`/cadastros/clientes`, `/cadastros/emissoras`): cadastros do escritório, compartilhados por todos os robôs.
- `frontend/` é Next.js (App Router) + Tailwind + shadcn/ui. Os tipos em `lib/types.ts` espelham os schemas Pydantic.
  - Tipos de caso e partes: o caso é criado e editado em `components/faturamento/caso/caso-dialog.tsx` (passo 1 = tipo; passo 2 = abas Geral, dados do tipo em `dados-tipo.tsx`, Partes e Campos adicionais); a aba Partes da ficha e do formulário é `caso/partes.tsx` (blocos por categoria, arrastar ou setas, 409 de conflito de interesses com confirmação). Tipos em `lib/casos.ts` e `lib/pessoas.ts`.
  - Cadastros › Pessoas: `app/(app)/cadastros/pessoas/page.tsx` + `components/pessoas/` (`comum.tsx` tem o `SeloCliente` "Cliente #código", usado em toda tela que mostra pessoa; `cadastro-rapido.tsx` mostra "Já cadastrada" quando o documento existe). As listas do caso são mantidas em Configurações › Faturamento › Listas (`components/faturamento/listas-config.tsx`).
- `deploy/` tem `deploy.sh hml|prod`, `rollback.sh`, `backup.sh`, systemd templated (`@hml`/`@prod`) e nginx.

## Padrão MayaCorp

- Paleta: Navy `#1E2D6B`, Indigo `#7C8FFF`, Teal `#1A8F5E`, Amber `#F5A623`, Red `#C94343`, Dark `#0F1729`, Gray `#F7F8FC`. Fontes: DM Sans + JetBrains Mono (números de nota, RPS, CNPJ).
- Telas de cadastro: cabeçalho → toolbar (busca + filtros + Novo) → tabela → vazio ilustrado → paginação → modal → confirmação → toast.
- Textos em português claro, sem jargão. Erro da Prefeitura passa sempre por `prefeitura_sp/erros.py` (mensagem + ação).
- Perfis (admin / operador / visualizador) são aplicados **no backend** (`deps.Admin`, `deps.Operador`); o frontend só esconde botões.
- Toda ação sensível chama `ctx.auditar(...)`. A tabela `auditoria` é imutável (listener bloqueia UPDATE/DELETE).

## NFS-e SP: o que já foi aprendido (vem do sistema RCA, validado com a Prefeitura em 09/2026)

- Layout 2 usa o endpoint **`https://nfews.prefeitura.sp.gov.br/lotenfe.asmx`**; o antigo não aceita V2.
- SOAP 1.1 com `SOAPAction` por operação (mapa `ACOES` em `cliente.py`). Sem isso o IIS devolve 500 genérico.
- XMLDSig: RSA-SHA256, C14N 1.0, prefixo `ds:`. Em SHA-1 ou sem prefixo a resposta é 1057.
- Assinatura do RPS (RSA-SHA1): no V2 o CCM vai com **12** posições e o valor é o `ValorFinalCobrado`.
- Os elementos seguem a **ordem** do `tpRPS` em `xsd/TiposNFe_v02.xsd`. PIS/COFINS/INSS/IR/CSLL/IPI são obrigatórios (zero).
- Razão social e discriminação vão **sem acento**.
- O XML é validado contra os XSD oficiais em `prefeitura_sp/xsd/` antes de sair. Teste: `tests/test_parser_xml.py`.
- Idempotência: `rps.chave_emissao` (`emissora:série:número`, UNIQUE) é preenchida ao entrar na fila. Em falha de comunicação, o robô consulta a nota antes de reenviar.

## NFS-e Nacional (Emissor Nacional, qualquer cidade): validado na produção restrita em 27/11/2026

- A empresa emissora escolhe `sistema_emissao`: `prefeitura_sp` (pacote `prefeitura_sp/`) ou `nacional` (pacote `nfse_nacional/`). Cada escritório usa o certificado da própria emissora.
- API Sefin Nacional com TLS mútuo (certificado ICP-Brasil). `POST /nfse` com `{"dpsXmlGZipB64"}` (XML em GZip + Base64); sucesso devolve `chaveAcesso` (50 dígitos) e `nfseXmlGZipB64`; erro devolve `erros[{Codigo, Descricao, Complemento}]`.
- `GET /dps/{id}` quer o Id **sem** o prefixo "DPS" (só os 42 números). Cancelamento: `POST /nfse/{chave}/eventos` com `{"pedidoRegistroEventoXmlGZipB64"}` (evento e101101).
- Assinatura aceita: RSA-SHA256, C14N 1.0 inclusiva, `<Signature>` sem prefixo como último filho da raiz, Reference ao Id de `infDPS`/`infPedReg`.
- Dois layouts: `xsd/` (produção, v1.01 de 09/02/2026) e `xsd_rtc/` (Reforma Tributária, já exigido na produção restrita: `finNFSe` e `indDest` obrigatórios, `xDescServ` depois do `cNBS`). Quando a produção mudar, troque `LAYOUT_DO_AMBIENTE["1"]` em `dps.py`.
- O XSD oficial de `TSSerieDPS` (v1.01 de produção) traz `^...$`, que no XSD vira literal: a cópia em `xsd/` está corrigida (comentado no arquivo).
- Modo Teste em Configurações › Prefeitura = produção restrita do governo (nota existe lá, sem valor fiscal; aqui fica como simulação).
- PDF da nota = **DANFSe v2.0**, desenhado pelo sistema no leiaute oficial da Nota Técnica SE/CGNFS-e nº 008 (v1.02, 14/07/2026; Anexo I) em `nfse_nacional/danfse_pdf.py`, sempre **a partir do XML autorizado** em `xml_path` (`nfse_nacional/leitura.py`), nunca do cadastro. Regras da nota técnica: só o que está no XML; campo vazio = traço; tomador/destinatário/intermediário ausentes viram uma linha; QR Code = `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=<chave>`; "NFS-e SEM VALIDADE JURÍDICA" quando `tpAmb` = 2; marca d'água "CANCELADA"; sem logo do escritório nem marca MayaCorp (o modelo não tem lugar). Fontes: Helvetica no lugar de Arial/MS Sans Serif. Mudou o desenho? Suba `pdf.LAYOUT_NACIONAL`: o PDF guardado é refeito no próximo download, e-mail ou ZIP (também quando a nota é cancelada).
- A API do governo que devolvia o DANFSe pronto (`GET https://adn.nfse.gov.br/danfse/{chave}`) foi suspensa em 03/08/2026 pela mesma nota técnica: `danfse.BUSCAR_OFICIAL = False`. O caminho continua em `nfse_nacional/danfse.py` (testado só com cliente simulado; estado em `<pdf>.json` ao lado do arquivo). Falta a tabela de municípios do IBGE: o nome da cidade do tomador sai do cadastro quando o código bate.

## Configuração

Configuração de **negócio** fica no banco e é editada em **Configurações**: usuários e senhas, identidade, certificado,
parâmetros fiscais, SMTP e modo da Prefeitura. O `.env` guarda só o que é **de servidor**: `DATABASE_URL`, `JWT_SECRET`,
`MASTER_KEY` (a chave que cifra o .pfx não pode morar no banco que ela protege) e `AMBIENTE`. Um banco por escritório
liga sozinho quando existe o banco `mayajus_controle` no mesmo servidor (`app/core/tenancy.py`, `app/controle/`); o
Jefferson não quer nada disso no .env. Não crie variável de
ambiente para regra de negócio. Emissão real só é liberada quando `AMBIENTE=prod`.

## Pegadinhas

1. **Parâmetros fiscais IBS/CBS do seed são provisórios** (NBS 113011000, cClassTrib 000001, cIndOp 100301). Precisam ser definidos com o contador da CFME antes de produção.
2. Os códigos em `prefeitura_sp/erros.py` são um mapeamento inicial. Confira com a tabela do manual durante a homologação.
3. `MASTER_KEY` cifra o .pfx no banco. Se ela for trocada ou perdida, o certificado precisa ser reenviado.
4. Migrations no SQLite: coluna NOT NULL nova em tabela existente precisa de `server_default` na migration gerada.
5. Encoding: o TXT da Lello costuma vir em Windows-1252. O parser detecta sozinho (`parser_txt.decodificar`).

## Comandos

```bash
cd backend
uv run python -m app.seed                                   # dados de demonstração (idempotente)
uv run python -m app.criar_usuario --login admin --nome "..." --email ... --perfil admin   # 1º acesso; senha pedida no terminal
uv run python -m uvicorn app.main:app --reload --port 8000
uv run python -m pytest -q
uv run python -m alembic revision --autogenerate -m "..."   # depois de mudar um model
uv run python -m app.worker                                 # worker (produção)
uv run python -m app.modules.faturamento.migrar_partes --dry-run   # tipos de caso e partes dos dados antigos (sem --dry-run grava)
uv run python -m app.modules.faturamento.doc_campos         # regera docs/campos_padrao.md
cd ../frontend && npm run dev
```
