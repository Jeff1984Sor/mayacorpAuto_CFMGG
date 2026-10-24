# MayaJus

Hub de robôs (RPAs) da MayaCorp, white-label, com a marca do cliente. Primeiro cliente: **CFME Advogados**.

**RPA 01 · Emissor Inteligente de NFS-e em Lote, Layout 2 (Reforma Tributária).** O arquivo de RPS gerado pela Lello é lido, validado linha a linha, convertido para o XML do layout 2 da NFS-e de São Paulo (ISS + IBS + CBS), assinado com o certificado A1, testado na Prefeitura e transmitido em lotes de até 50. O resultado são as notas, com PDF e XML.

Especificação completa: [MayaCorp_Automacoes_RPA01_NFSe.md](MayaCorp_Automacoes_RPA01_NFSe.md).

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui + TanStack Query + Zod + Recharts |
| Backend | FastAPI + SQLAlchemy 2 + Pydantic v2 + Alembic (Python 3.12, `uv`) |
| Fila / robôs | Fila no próprio banco + serviço `app.worker` (em dev roda em threads dentro da API); progresso ao vivo via SSE |
| XML / assinatura | `lxml` + `signxml` (XMLDSig RSA-SHA256) + `cryptography` (.pfx), validação contra os **XSD oficiais v2** |
| SOAP | `httpx` com TLS mútuo (certificado A1) |
| PDF | PDF oficial do portal (`notaprintpdf.aspx`); se o portal não responder, PDF próprio (ReportLab) com a marca do cliente e QR |
| Banco | PostgreSQL (hml/prod) · SQLite em dev |

## Rodar localmente

```bash
# Backend (http://127.0.0.1:8000, docs em /api/docs)
cd backend
uv sync
uv run python -m app.seed            # cria CFME, usuários, emissora, parâmetros e um lote já emitido
uv run python -m uvicorn app.main:app --reload --port 8000

# Frontend (http://localhost:3000)
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Logins de demonstração (senha `Cfme@2026`): `admin@cfme.com.br`, `operador@cfme.com.br`, `visualizador@cfme.com.br`.

O login aceita e-mail **ou** nome de usuário. Para criar o primeiro administrador de um ambiente novo
(a senha é pedida no terminal e não fica em arquivo nenhum):

```bash
uv run python -m app.criar_usuario --login admin --nome "Seu nome" --email voce@mayacorp.com.br --perfil admin
```

Depois disso, usuários, senhas, certificado, identidade, SMTP e modo da Prefeitura são geridos em **Configurações**.

Arquivo para testar o upload: `backend/exemplos/lello_rps_exemplo.txt` (120 RPS, sendo 2 com erro de propósito e 1 tomador novo).

### Modos da Prefeitura (Configurações › Prefeitura)

| Modo | O que faz |
|---|---|
| `simulado` (padrão) | Nenhuma chamada externa. O XML é assinado com um certificado efêmero e validado no XSD oficial; o simulador responde no formato da Prefeitura. Notas marcadas **SIMULAÇÃO**. |
| `teste` | Usa o `TesteEnvioLoteRPS` da Prefeitura: valida tudo de verdade, não gera nota. Exige certificado A1. |
| `producao` | Emissão real. Só aparece no servidor de produção (`AMBIENTE=prod`) e exige digitar EMITIR NOTAS REAIS. |

### Raio-X do arquivo

Antes de emitir, o robô compara o arquivo com o histórico e dá uma nota de 0 a 100: aponta possível cobrança em dobro,
valor fora do padrão do cliente, clientes recorrentes que sumiram do arquivo, variação contra o lote anterior,
concentração por cliente e o tempo previsto de emissão (`GET /api/nfse/importacoes/{id}/raio-x`).

### Fatura (Nota de Honorários)

Cada NFS-e emitida gera a sua fatura (`NH 2026/00001`), no mesmo desenho da NH do sistema RCA: emitente, logo do
escritório, emissão, vencimento, nº da nota fiscal, dados bancários e **QR Code PIX "copia e cola" com o valor**.
A fatura vai anexada no e-mail ao cliente e acompanha a nota: nota paga = fatura paga; nota cancelada = fatura cancelada.

### Recebimentos: extrato → baixa automática

A CFME sobe o extrato do banco (OFX, CSV ou Excel). Cada crédito é casado com as notas em aberto e recebe uma confiança:

| Confiança | Situação |
|---|---|
| 97 | Valor exato e cliente (CNPJ/nome) identificado na descrição |
| 92 | O crédito é a soma exata de um **lote inteiro** (a Lello paga em bloco) |
| 90 | Soma exata das notas em aberto de um cliente citado |
| 88 | Única nota em aberto com aquele valor |
| 70 / 60 | Combinação de notas ou várias notas possíveis: vira **sugestão** para confirmar |

Acima da confiança mínima (Configurações › Automações, padrão 85) a baixa é automática, com a **data do crédito**,
na nota e na fatura. O mesmo crédito nunca baixa duas vezes (FITID do OFX ou data+valor+descrição).

### Relatório para o escritório

Em Configurações › Automações: ao fim de cada lote, e-mail para a CFME com "X notas emitidas", valor, ISS, rejeitadas
e a planilha de conferência (e, se quiser, o ZIP das notas). Opcional: aviso quando o extrato der baixa.

## Testes

```bash
cd backend && uv run python -m pytest -q
```

Cobrem o parser do TXT (encoding, rodapé), a validação do XML layout 2 contra o XSD oficial, a assinatura XMLDSig e o fluxo inteiro pela API: upload, correção, emissão, rejeição parcial, reprocessamento, ZIP, idempotência, perfis, auditoria imutável, Raio-X, fatura + PIX, conciliação de extrato OFX/CSV (baixa automática, duplicidade, desfazer), relatório por e-mail, foto e troca de senha.

## Estrutura

```
backend/app/core/                 auth, usuários, identidade, certificado, auditoria, e-mail
backend/app/modules/rpa_nfse/     o robô: parser_txt, validator, service, tasks, pdf, routes
backend/app/modules/rpa_nfse/prefeitura_sp/   XML layout 2, assinaturas, SOAP, simulador, erros humanizados, XSD
frontend/app/                     telas (login, início, nfse/*, configuracoes/*, auditoria)
deploy/                           deploy.sh, rollback.sh, backup.sh, systemd, nginx
```

## Deploy

**Primeira instalação** de um ambiente (no servidor, Ubuntu/Debian com PostgreSQL):

```bash
curl -fsSL https://raw.githubusercontent.com/Jeff1984Sor/mayacorpAuto_CFMGG/main/deploy/instalar.sh -o instalar.sh
sudo bash instalar.sh hml     # homologação (branch develop)
sudo bash instalar.sh prod    # produção (branch main)
```

O banco começa **vazio** (só o cliente, a identidade e as configurações) e o script pede o login do primeiro
administrador. **Atualizações** depois: `./deploy/deploy.sh hml` → validar → `./deploy/deploy.sh prod`.
Ver `.claude/skills/deploy-hml` e `.claude/skills/deploy-prod`.

Para zerar dados de teste mantendo os usuários: `uv run python -m app.limpar_dados --confirmar "LIMPAR TUDO"`.

## Volume

Medido com 500 RPS (modo simulação, notebook): leitura + pré-validação 0,4 s · Raio-X 0,03 s · emissão completa
(teste + envio em 10 lotes de 50, XML, PDF da nota e fatura com PIX) 63 s · 11 MB de memória. Em produção soma-se
o tempo de resposta da Prefeitura (teste + envio por lote de 50); os PDFs oficiais são baixados 8 em paralelo.

---

Uma solução **MayaCorp** · Fábrica de Software · mayacorp@mayacorp.com.br
