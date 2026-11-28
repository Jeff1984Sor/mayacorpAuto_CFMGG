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
  - Usuário = funcionário (`core.models.Usuario`, com cargo, OAB, endereço). `acesso_sistema=False` = só lança horas, sem login.
  - `app/modules/financas/` (Financeiro): contas bancárias e extrato, transferências, contas a pagar (rateio, recorrência, baixa),
    fluxo de caixa, DRE gerencial (pela `grupo_dre` da categoria), projeção de despesas, previsão de caixa e projeção de impostos (Simples ou Presumido).
    - O saldo nunca é gravado: é sempre calculado a partir dos lançamentos.
    - Pagar uma conta lança um débito no extrato. Fatura paga vira crédito na conta de recebimento (`fatura.espelhar_no_financeiro`).
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
  NFS-e da mensalidade (`nota_fiscal.py`): com a opção ligada, cobrança paga vira nota no banco do admin (emissora da MayaCorp, Emissor Nacional) para o CNPJ do escritório; o resumo (número, chave, erro) fica na cobrança. A baixa registra a cobrança em `session.info` e quem dá o commit chama `nota_fiscal.apos_pagamento(cobranca.pagas(db))`.
- Menu **Cadastros** (`/cadastros/clientes`, `/cadastros/emissoras`): cadastros do escritório, compartilhados por todos os robôs.
- `frontend/` é Next.js (App Router) + Tailwind + shadcn/ui. Os tipos em `lib/types.ts` espelham os schemas Pydantic.
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
- Modo Teste em Configurações › Prefeitura = produção restrita do governo (nota existe lá, sem valor fiscal; aqui fica como simulação). O PDF oficial (DANFSe) não respondeu na produção restrita: o sistema gera o próprio PDF com a chave de acesso.

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
cd ../frontend && npm run dev
```
