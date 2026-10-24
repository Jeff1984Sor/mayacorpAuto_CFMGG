# CLAUDE.md

> **Leia primeiro.** Plataforma MayaCorp Automações: hub white-label de RPAs. Cliente atual: **CFME Advogados**
> (o nome, o logo e a cor vêm de Configurações › Identidade; nunca deixe "CFME" fixo no código de produto).
> Especificação: `MayaCorp_Automacoes_RPA01_NFSe.md`.

| Ambiente | Endereço | Pasta no servidor | Portas (API/web) | Banco | Branch |
|---|---|---|---|---|---|
| Homologação | `hml-automacoes.mayacorp.com.br` | `/home/deploy/mayacorp-automacoes/hml` | 8160 / 3160 | `automacoes_hml` | `develop` |
| Produção | `automacoes.mayacorp.com.br` | `/home/deploy/mayacorp-automacoes/prod` | 8060 / 3060 | `automacoes_prod` | `main` |

**O servidor é compartilhado** (VPS `srv1703721`, Ubuntu 24.04) com Flicsales, MayaSec, MayaPost, MayaAssinador,
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

## Configuração

Configuração de **negócio** fica no banco e é editada em **Configurações**: usuários e senhas, identidade, certificado,
parâmetros fiscais, SMTP e modo da Prefeitura. O `.env` guarda só o que é **de servidor**: `DATABASE_URL`, `JWT_SECRET`,
`MASTER_KEY` (a chave que cifra o .pfx não pode morar no banco que ela protege) e `AMBIENTE`. Não crie variável de
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
