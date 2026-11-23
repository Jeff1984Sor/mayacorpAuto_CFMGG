# SPEC — Módulo de Boletos CNAB 240 (Santander) · MayaJus

> **Para o agente do VS Code:** este documento é a especificação completa para implementar a emissão de boletos registrados via arquivo CNAB 240 (remessa/retorno) no MayaJus, começando pelo Santander. Leia inteiro antes de codar. Siga a ordem das tarefas da seção 10. Não invente valores de campo: onde estiver marcado **[CONFIRMAR]**, deixe parametrizável e registre um TODO.

---

## 1. Contexto

- **Projeto:** MayaJus — gestão de escritório de advocacia (Django + PostgreSQL). Repo: `Jeff1984Sor/mayacorpAuto_CFMGG`.
- **Objetivo:** o escritório (beneficiário) emite boletos para os clientes dele (pagadores) a partir dos lançamentos financeiros do MayaJus.
- **Modelo escolhido:** CNAB 240 (padrão FEBRABAN), **sem API bancária**. Fluxo por arquivo:
  1. MayaJus gera boletos (nosso número, código de barras, linha digitável, PDF).
  2. MayaJus gera o arquivo **remessa** (`.REM`).
  3. Usuário faz upload da remessa no Internet Banking Empresarial do Santander.
  4. Banco devolve o arquivo **retorno** (`.RET`).
  5. Usuário importa o retorno no MayaJus → baixa automática (registrado, rejeitado, pago, baixado).
- **Referência oficial:** Santander — Layout CNAB 240 Cobrança (H7815, v8.3, abril/2025) e Manual de Código de Barras (v3.6, abril/2025). Ambos públicos no site do Santander.
- **Multibanco desde o início:** o núcleo CNAB 240 é genérico; o Santander é o primeiro "adapter". Itaú, Bradesco, BB, Sicoob etc. virão depois sem reescrever o núcleo.

---

## 2. Arquitetura

Criar um app Django `cobranca/`:

```
cobranca/
├── __init__.py
├── apps.py
├── models.py                 # Convenio, Boleto, ArquivoRemessa, ArquivoRetorno, OcorrenciaBoleto
├── admin.py
├── cnab/
│   ├── __init__.py
│   ├── fields.py             # Field spec: posição, tamanho, tipo, decimais, default, formatação
│   ├── record.py             # Classe base Record: build() -> str(240), parse(str) -> dict
│   ├── validators.py         # tamanho de linha, CRLF, contagens
│   └── exceptions.py
├── bancos/
│   ├── __init__.py
│   ├── base.py               # BancoBase (interface abstrata)
│   ├── registry.py           # get_banco("033") -> SantanderCNAB240
│   └── santander/
│       ├── __init__.py
│       ├── layout.py         # specs de todos os registros (header, P, Q, R, Y-03, trailers, T, U)
│       ├── remessa.py        # gerar_remessa(convenio, boletos) -> bytes
│       ├── retorno.py        # ler_retorno(bytes) -> list[OcorrenciaRetorno]
│       ├── nosso_numero.py   # cálculo DV módulo 11
│       ├── codigo_barras.py  # código de barras 44 posições + linha digitável 47
│       └── codigos.py        # dicionários de código de movimento remessa/retorno
├── boleto_pdf/
│   ├── render.py             # PDF do boleto (WeasyPrint ou ReportLab)
│   ├── barcode_itf.py        # Interleaved 2 of 5
│   └── templates/boleto.html
├── services.py               # orquestração: emitir, gerar remessa, processar retorno
├── views.py / urls.py
└── tests/
    ├── test_fields.py
    ├── test_nosso_numero.py
    ├── test_codigo_barras.py
    ├── test_remessa_santander.py
    ├── test_retorno_santander.py
    └── fixtures/             # arquivos .REM e .RET de exemplo
```

### 2.1 Interface do banco (`bancos/base.py`)

```python
class BancoBase(ABC):
    codigo: str          # "033"
    nome: str            # "BANCO SANTANDER"

    @abstractmethod
    def calcular_nosso_numero(self, sequencial: int, convenio) -> str: ...
    @abstractmethod
    def codigo_barras(self, boleto) -> str: ...          # 44 dígitos
    @abstractmethod
    def linha_digitavel(self, codigo_barras: str) -> str: ...  # 47 dígitos
    @abstractmethod
    def gerar_remessa(self, convenio, boletos, sequencial_arquivo: int) -> bytes: ...
    @abstractmethod
    def ler_retorno(self, conteudo: bytes) -> list["OcorrenciaRetorno"]: ...
```

---

## 3. Motor de campos fixos (`cnab/fields.py` e `cnab/record.py`)

Toda linha CNAB 240 tem **exatamente 240 caracteres**. Um caractere a mais ou a menos invalida o arquivo inteiro.

### 3.1 Tipos de campo

| Tipo | Formatação na remessa | Parse no retorno |
|---|---|---|
| `N` (numérico) | só dígitos, **zeros à esquerda**, sem separador | `int`, ou `Decimal` se tiver decimais |
| `N` com `dec=2` | `Decimal("150.75")` → `"000000000015075"` (15 pos) | divide por 10^dec |
| `A` (alfanumérico) | **maiúsculo**, sem acento, **espaços à direita**, truncar se exceder | `str.strip()` |
| `D` (data) | `DDMMAAAA`; data vazia → `"00000000"` | `date` ou `None` se zeros |
| Brancos | espaços | ignorar |

### 3.2 Regras obrigatórias

- Remover acentos e caracteres fora de `A-Z 0-9 espaço . , - / ( )` nos campos alfanuméricos (usar `unicodedata.normalize("NFKD")`).
- Numérico com valor maior que o tamanho → **lançar exceção**, nunca truncar.
- Alfanumérico maior que o tamanho → truncar e registrar warning.
- Fim de linha: **CRLF** (`\r\n`). Encoding: **ASCII / latin-1**.
- Definir os layouts de forma **declarativa** (lista de `Field(nome, inicio, fim, tipo, dec=0, default=None)`), validando no import que as posições são contíguas de 1 a 240, sem buracos nem sobreposição. Esse teste pega 90% dos erros.

```python
Field("codigo_banco", 1, 3, "N", default="033")
Field("lote", 4, 7, "N")
Field("tipo_registro", 8, 8, "N", default="3")
...
```

---

## 4. Layout Santander — Remessa

Estrutura do arquivo:

```
Header de Arquivo        (tipo 0)
  Header de Lote         (tipo 1)
    Segmento P           (tipo 3)  ┐
    Segmento Q           (tipo 3)  │ por boleto
    [Segmento R]         (tipo 3)  │ opcional (multa, desconto 2/3, mensagens 3/4)
    [Segmento Y-03]      (tipo 3)  ┘ opcional (QR Code Pix)
  Trailer de Lote        (tipo 5)
Trailer de Arquivo       (tipo 9)
```

O número sequencial do registro no lote (pos. 009-013) começa em 1 e incrementa a cada segmento (P=1, Q=2, P=3, Q=4...).

### 4.1 Header de Arquivo

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | `033` |
| 004-007 | Lote | N | 4 | `0000` |
| 008 | Tipo de registro | N | 1 | `0` |
| 009-016 | Brancos | A | 8 | |
| 017 | Tipo de inscrição da empresa | N | 1 | 1=CPF, 2=CNPJ |
| 018-032 | Nº de inscrição da empresa | N | 15 | |
| 033-047 | Código de transmissão | N | 15 | fornecido pelo banco (convênio) |
| 048-072 | Brancos | A | 25 | |
| 073-102 | Nome da empresa | A | 30 | |
| 103-132 | Nome do banco | A | 30 | `BANCO SANTANDER` |
| 133-142 | Brancos | A | 10 | |
| 143 | Código remessa | N | 1 | `1` |
| 144-151 | Data de geração | D | 8 | DDMMAAAA |
| 152-157 | Brancos | A | 6 | |
| 158-163 | Nº sequencial do arquivo | N | 6 | incrementa por arquivo, por convênio |
| 164-166 | Versão do layout | N | 3 | `040` |
| 167-240 | Brancos | A | 74 | |

### 4.2 Header de Lote

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | `033` |
| 004-007 | Lote | N | 4 | `0001` |
| 008 | Tipo de registro | N | 1 | `1` |
| 009 | Tipo de operação | A | 1 | `R` |
| 010-011 | Tipo de serviço | N | 2 | `01` |
| 012-013 | Brancos | A | 2 | |
| 014-016 | Versão do layout do lote | N | 3 | `030` |
| 017 | Brancos | A | 1 | |
| 018 | Tipo de inscrição | N | 1 | 1=CPF, 2=CNPJ |
| 019-033 | Nº de inscrição | N | 15 | |
| 034-053 | Brancos | A | 20 | |
| 054-068 | Código de transmissão | N | 15 | |
| 069-073 | Brancos | A | 5 | |
| 074-103 | Nome do beneficiário | A | 30 | |
| 104-143 | Mensagem 1 | A | 40 | impressa no boleto |
| 144-183 | Mensagem 2 | A | 40 | impressa no boleto |
| 184-191 | Nº remessa/retorno | N | 8 | = sequencial do arquivo |
| 192-199 | Data de gravação | D | 8 | |
| 200-240 | Brancos | A | 41 | |

### 4.3 Segmento P (obrigatório)

| Pos | Campo | Tipo | Tam | Dec | Conteúdo |
|---|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | | `033` |
| 004-007 | Lote | N | 4 | | `0001` |
| 008 | Tipo de registro | N | 1 | | `3` |
| 009-013 | Nº sequencial no lote | N | 5 | | |
| 014 | Segmento | A | 1 | | `P` |
| 015 | Brancos | A | 1 | | |
| 016-017 | Código de movimento | N | 2 | | ver 6.1 (`01` = entrada) |
| 018-021 | Agência | N | 4 | | |
| 022 | DV agência | N | 1 | | |
| 023-031 | Conta corrente | N | 9 | | |
| 032 | DV conta | N | 1 | | |
| 033-041 | Conta cobrança FIDC | N | 9 | | zeros se não FIDC |
| 042 | DV conta FIDC | N | 1 | | zero |
| 043-044 | Brancos | A | 2 | | |
| 045-057 | Nosso número (com DV) | N | 13 | | ver seção 5 |
| 058 | Tipo de cobrança (carteira) | A | 1 | | **[CONFIRMAR]** nota 5 do manual |
| 059 | Forma de cadastramento | N | 1 | | **[CONFIRMAR]** nota 6 do manual |
| 060 | Tipo de documento | N | 1 | | 1=Tradicional, 2=Escritural |
| 061 | Brancos | A | 1 | | |
| 062 | Brancos | A | 1 | | |
| 063-077 | Seu número | A | 15 | | ID do lançamento no MayaJus; volta no retorno |
| 078-085 | Vencimento | D | 8 | | |
| 086-100 | Valor nominal | N | 15 | 2 | |
| 101-104 | Agência cobradora FIDC | N | 4 | | zeros |
| 105 | DV agência FIDC | N | 1 | | zero |
| 106 | Brancos | A | 1 | | |
| 107-108 | Espécie do título | N | 2 | | **[CONFIRMAR]** nota 20 (DS = duplicata de serviço é o caso de honorários) |
| 109 | Aceite | A | 1 | | `N` |
| 110-117 | Data de emissão | D | 8 | | |
| 118 | Código de juros de mora | N | 1 | | **[CONFIRMAR]** nota 21 (valor/dia, taxa mensal, isento) |
| 119-126 | Data de juros | D | 8 | | normalmente vencimento + 1 |
| 127-141 | Juros (valor/dia ou taxa) | N | 15 | 2 | |
| 142 | Código desconto 1 | N | 1 | | **[CONFIRMAR]** nota 23; 0 = sem desconto |
| 143-150 | Data desconto 1 | D | 8 | | |
| 151-165 | Valor/percentual desconto 1 | N | 15 | 2 | |
| 166-180 | Percentual IOF | N | 15 | 5 | zeros (não é seguradora) |
| 181-195 | Valor de abatimento | N | 15 | 2 | |
| 196-220 | Identificação do título na empresa | A | 25 | | UUID curto do boleto no MayaJus; volta no retorno |
| 221 | Código de protesto | N | 1 | | **[CONFIRMAR]** nota 25 |
| 222-223 | Dias para protesto | N | 2 | | |
| 224 | Código de baixa/devolução | N | 1 | | **[CONFIRMAR]** nota 26 |
| 225 | Fixo zero | N | 1 | | `0` |
| 226-227 | Dias para baixa/devolução | N | 2 | | |
| 228-229 | Código da moeda | N | 2 | | `00` (Real) |
| 230-240 | Brancos | A | 11 | | |

### 4.4 Segmento Q (obrigatório na entrada)

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | `033` |
| 004-007 | Lote | N | 4 | |
| 008 | Tipo de registro | N | 1 | `3` |
| 009-013 | Nº sequencial no lote | N | 5 | |
| 014 | Segmento | A | 1 | `Q` |
| 015 | Brancos | A | 1 | |
| 016-017 | Código de movimento | N | 2 | mesmo do P |
| 018 | Tipo de inscrição do pagador | N | 1 | 1=CPF, 2=CNPJ |
| 019-033 | Nº de inscrição do pagador | N | 15 | **obrigatório** |
| 034-073 | Nome do pagador | A | 40 | |
| 074-113 | Endereço do pagador | A | 40 | **obrigatório** |
| 114-128 | Bairro | A | 15 | |
| 129-133 | CEP | N | 5 | |
| 134-136 | Sufixo do CEP | N | 3 | |
| 137-151 | Cidade | A | 15 | |
| 152-153 | UF | A | 2 | validar contra lista de UFs |
| 154 | Tipo de inscrição do sacador/avalista | N | 1 | 0 se não houver |
| 155-169 | Nº de inscrição do sacador/avalista | N | 15 | zeros |
| 170-209 | Nome do sacador/avalista | A | 40 | brancos |
| 210-212 | Reservado | N | 3 | `000` |
| 213-215 | Reservado | N | 3 | `000` |
| 216-218 | Reservado | N | 3 | `000` |
| 219-221 | Reservado | N | 3 | `000` |
| 222-240 | Brancos | A | 19 | |

### 4.5 Segmento R (opcional: multa, descontos 2 e 3, mensagens 3 e 4)

| Pos | Campo | Tipo | Tam | Dec | Conteúdo |
|---|---|---|---|---|---|
| 001-013 | (igual ao P: banco, lote, tipo 3, sequencial) | | | | |
| 014 | Segmento | A | 1 | | `R` |
| 015 | Brancos | A | 1 | | |
| 016-017 | Código de movimento | N | 2 | | |
| 018 | Código desconto 2 | N | 1 | | |
| 019-026 | Data desconto 2 | D | 8 | | |
| 027-041 | Valor/percentual desconto 2 | N | 15 | 2 | |
| 042 | Código desconto 3 | N | 1 | | |
| 043-050 | Data desconto 3 | D | 8 | | |
| 051-065 | Valor/percentual desconto 3 | N | 15 | 2 | |
| 066 | Código da multa | N | 1 | | 1=valor fixo, 2=percentual |
| 067-074 | Data da multa | D | 8 | | |
| 075-089 | Valor/percentual da multa | N | 15 | 2 | |
| 090-099 | Brancos | A | 10 | | |
| 100-139 | Mensagem 3 | A | 40 | | |
| 140-179 | Mensagem 4 | A | 40 | | |
| 180-240 | Brancos | A | 61 | | |

> Gerar o Segmento R **só** quando o boleto tiver multa, desconto 2/3 ou mensagem 3/4.

### 4.6 Segmento Y-03 (opcional: QR Code Pix / boleto híbrido)

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-013 | (banco, lote, tipo 3, sequencial) | | | |
| 014 | Segmento | A | 1 | `Y` |
| 015 | Brancos | A | 1 | |
| 016-017 | Código de movimento | N | 2 | |
| 018-019 | Identificação do registro | N | 2 | `03` |
| 020-080 | Brancos | A | 61 | |
| 081 | Tipo de chave Pix | A | 1 | 1=CPF, 2=CNPJ, 3=Telefone, 4=E-mail, 5=Aleatória |
| 082-158 | Chave Pix | A | 77 | |
| 159-193 | TXID | A | 35 | 26 a 35 chars, só `[A-Za-z0-9]`, **único por boleto** |
| 194-240 | Brancos | A | 47 | |

> Fase 2. Deixar feature flag `convenio.pix_habilitado`.

### 4.7 Trailer de Lote

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | `033` **[CONFIRMAR]**: o manual cita 353/008/033 |
| 004-007 | Lote | N | 4 | `0001` |
| 008 | Tipo de registro | N | 1 | `5` |
| 009-017 | Brancos | A | 9 | |
| 018-023 | Qtde de registros no lote | N | 6 | **inclui header e trailer do lote**; se errar, o lote inteiro é rejeitado |
| 024-240 | Brancos | A | 217 | |

### 4.8 Trailer de Arquivo

| Pos | Campo | Tipo | Tam | Conteúdo |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | `033` |
| 004-007 | Lote | N | 4 | `9999` |
| 008 | Tipo de registro | N | 1 | `9` |
| 009-017 | Brancos | A | 9 | |
| 018-023 | Qtde de lotes | N | 6 | nº de registros tipo 1 |
| 024-029 | Qtde de registros no arquivo | N | 6 | total de linhas (tipos 0+1+3+5+9) |
| 030-240 | Brancos | A | 211 | |

---

## 5. Nosso número (`nosso_numero.py`)

- **Campo:** Segmento P, pos. 045-057 (13 dígitos, já com DV).
- **DV módulo 11:** multiplicar os dígitos da direita para a esquerda pelos pesos 2, 3, 4, 5, 6, 7, 8, 9 (volta para 2 depois do 9). Somar e tirar o resto da divisão por 11.
  - DV = 11 − resto
  - se o resultado for 10 → DV = 1
  - se o resultado for 11 ou 0 → DV = 0
- **Caso de teste obrigatório (exemplo do manual):** base `3147578` → soma 147 → 147 mod 11 = 4 → DV = 7 → `31475787`.
- **Formato no campo:** base (12 dígitos, zero à esquerda) + DV = 13 dígitos.
- **Sequencial:** por convênio, em tabela com `SELECT ... FOR UPDATE`, para não duplicar sob concorrência. Nunca reutilizar um número.
- **Alternativa do banco:** se o convênio estiver parametrizado como numeração "BANCO", enviar zeros e o banco atribui. Suportar via `convenio.numeracao = "EMPRESA" | "BANCO"` (padrão EMPRESA, porque precisamos do número para gerar o PDF antes do retorno).

---

## 6. Códigos de movimento (`codigos.py`)

### 6.1 Remessa (implementar na fase 1: 01, 02, 06; o resto fica como enum)

| Código | Significado |
|---|---|
| 01 | Entrada de boleto |
| 02 | Pedido de baixa |
| 04 | Concessão de abatimento |
| 05 | Cancelamento de abatimento |
| 06 | Alteração de vencimento |
| 07 | Alteração do ID do título na empresa |
| 08 | Alteração do seu número |
| 09 | Pedido de protesto |
| 10 | Concessão de desconto |
| 11 | Cancelamento de desconto |
| 18 | Sustar protesto |
| 31 | Alteração de outros dados |
| 98 | Não protestar |

### 6.2 Retorno (mapear para status do boleto no MayaJus)

| Código | Significado | Ação no MayaJus |
|---|---|---|
| 02 | Entrada confirmada | `status = REGISTRADO` |
| 03 | Entrada rejeitada | `status = REJEITADO` + salvar motivos (T 209-218) |
| 06 | Liquidação | `status = PAGO`, gravar valor pago, data, crédito; **baixar o lançamento financeiro** |
| 09 | Baixa | `status = BAIXADO` |
| 14 | Alteração de vencimento confirmada | atualizar vencimento |
| 17 | Liquidação após baixa | `status = PAGO` + alerta para revisar |
| 19 | Instrução de protesto confirmada | `status = EM_PROTESTO` |
| 25 | Protestado e baixado | `status = PROTESTADO` |
| 26 | Instrução rejeitada | log + alerta |
| 28 | Débito de tarifa | registrar a tarifa (T 194-208) |
| 30 | Alteração de dados rejeitada | log + alerta |
| 93 | Pagamento recebido | log |
| outros | — | salvar em `OcorrenciaBoleto` sem mudar status |

Os motivos de rejeição ficam na pos. 209-218 do Segmento T (5 códigos de 2 dígitos). **[CONFIRMAR]** tabela de motivos (notas 40-A e 40-C do manual) e montar o dicionário `MOTIVOS_REJEICAO`.

---

## 7. Layout Santander — Retorno

O retorno tem a mesma estrutura de headers e trailers. Para cada boleto vêm os **Segmentos T + U** (em par). O parser deve:

1. Validar que todas as linhas têm 240 caracteres (aceitar LF ou CRLF).
2. Validar código do banco `033` e tipo de arquivo retorno no header (pos. 143 = `2`).
3. Agrupar T + U pelo sequencial.
4. Localizar o boleto por **nosso número** (T 041-053); se não achar, tentar por **ID na empresa** (T 101-125); se não achar, cair em "ocorrência órfã" para revisão manual.
5. Ser **idempotente**: guardar o hash SHA-256 do arquivo e recusar importar o mesmo arquivo duas vezes. Também não duplicar uma ocorrência com o mesmo (boleto, código, data).

### 7.1 Segmento T

| Pos | Campo | Tipo | Tam | Dec |
|---|---|---|---|---|
| 001-003 | Código do banco | N | 3 | |
| 004-007 | Lote | N | 4 | |
| 008 | Tipo de registro (`3`) | N | 1 | |
| 009-013 | Nº sequencial | N | 5 | |
| 014 | Segmento (`T`) | A | 1 | |
| 015 | Brancos | A | 1 | |
| 016-017 | Código de movimento retorno | A | 2 | |
| 018-021 | Agência | N | 4 | |
| 022 | DV agência | N | 1 | |
| 023-031 | Conta | N | 9 | |
| 032 | DV conta | N | 1 | |
| 033-040 | Brancos | A | 8 | |
| 041-053 | Nosso número | N | 13 | |
| 054 | Carteira | A | 1 | |
| 055-069 | Seu número | A | 15 | |
| 070-077 | Vencimento | D | 8 | |
| 078-092 | Valor nominal | N | 15 | 2 |
| 093-095 | Banco cobrador/recebedor | N | 3 | |
| 096-099 | Agência cobradora/recebedora | N | 4 | |
| 100 | DV agência | N | 1 | |
| 101-125 | ID do título na empresa | A | 25 | |
| 126-127 | Código da moeda | N | 2 | |
| 128 | Tipo de inscrição do pagador | N | 1 | |
| 129-143 | Nº de inscrição do pagador | N | 15 | |
| 144-183 | Nome do pagador | A | 40 | |
| 184-193 | Conta cobrança | A | 10 | |
| 194-208 | Valor da tarifa | N | 15 | 2 |
| 209-218 | Motivos (5 × 2 dígitos) | A | 10 | |
| 219-240 | Brancos | A | 22 | |

### 7.2 Segmento U

| Pos | Campo | Tipo | Tam | Dec |
|---|---|---|---|---|
| 001-015 | (banco, lote, tipo, sequencial, `U`, branco) | | | |
| 016-017 | Código de movimento retorno | N | 2 | |
| 018-032 | Juros / multa / encargos | N | 15 | 2 |
| 033-047 | Desconto concedido | N | 15 | 2 |
| 048-062 | Abatimento | N | 15 | 2 |
| 063-077 | IOF | N | 15 | 2 |
| 078-092 | **Valor pago** | N | 15 | 2 |
| 093-107 | **Valor líquido creditado** | N | 15 | 2 |
| 108-122 | Outras despesas | N | 15 | 2 |
| 123-137 | Outros créditos | N | 15 | 2 |
| 138-145 | **Data da ocorrência** (pagamento) | D | 8 | |
| 146-153 | **Data do crédito** | D | 8 | |
| 154-157 | Código de ocorrência do pagador | N | 4 | |
| 158-165 | Data da ocorrência do pagador | D | 8 | |
| 166-180 | Valor da ocorrência do pagador | N | 15 | 2 |
| 181-210 | Complemento | A | 30 | |
| 211-213 | Banco correspondente | N | 3 | |
| 214-240 | Brancos | A | 27 | |

---

## 8. Código de barras e linha digitável (`codigo_barras.py`)

### 8.1 Código de barras (44 posições)

| Pos | Conteúdo |
|---|---|
| 01-03 | Banco `033` |
| 04 | Moeda `9` |
| 05 | DV geral (módulo 11 sobre as outras 43 posições, pesos 2-9; se o resultado for 0, 10 ou 11 → `1`) |
| 06-09 | Fator de vencimento |
| 10-19 | Valor (10 dígitos, 2 decimais) |
| 20-44 | Campo livre Santander (25 posições) ↓ |

**Campo livre Santander** (manual de Código de Barras v3.6):

| Pos (no código) | Tam | Conteúdo |
|---|---|---|
| 20 | 1 | Fixo `9` |
| 21-27 | 7 | Código do beneficiário |
| 28-40 | 13 | Nosso número com DV |
| 41 | 1 | Fixo `0` (IOF; só seguradoras usam outro valor) |
| 42-44 | 3 | Carteira: `101` = Cobrança Rápida com Registro, `104` = Cobrança Eletrônica com Registro |

> **[CONFIRMAR]** essas posições no PDF "Código de Barras Santander abril 2025 v36" antes de ir para produção.

### 8.2 Fator de vencimento — ATENÇÃO

- Fator = dias entre a data base e o vencimento.
- Base original: 07/10/1997 (fator 1000 = 03/07/2000).
- **O fator chegou a 9999 em 21/02/2025 e reiniciou em 1000 em 22/02/2025** (regra FEBRABAN). Implementar com a base nova: `fator = 1000 + (vencimento - date(2025, 2, 22)).days`.
- Testes: `22/02/2025 → 1000`, `23/02/2025 → 1001`.

### 8.3 Linha digitável (47 posições)

Montar os 5 campos padrão FEBRABAN a partir do código de barras:

- Campo 1: banco + moeda + posições 20-24 + DV (módulo 10)
- Campo 2: posições 25-34 + DV (módulo 10)
- Campo 3: posições 35-44 + DV (módulo 10)
- Campo 4: DV geral (posição 5)
- Campo 5: fator de vencimento + valor (posições 6-19)

Módulo 10: pesos 2,1,2,1... da direita para a esquerda; se o produto for > 9, somar os dígitos; DV = (10 − soma % 10) % 10.

Formatar para exibição: `XXXXX.XXXXX XXXXX.XXXXXX XXXXX.XXXXXX X XXXXXXXXXXXXXX`.

### 8.4 PDF do boleto

- Layout padrão FEBRABAN (recibo do pagador + ficha de compensação).
- Código de barras **Interleaved 2 of 5 (ITF)**. Usar `python-barcode` ou implementar ITF direto (é simples), renderizado como SVG/PNG embutido.
- Logo do Santander: **não embutir logo oficial**; usar só o texto "Banco Santander | 033-7".
- Gerar com WeasyPrint a partir de `templates/boleto.html`.
- Se `pix_habilitado`, incluir o QR Code (fase 2; o payload EMV vem do banco no retorno ou é montado com a chave + TXID **[CONFIRMAR]**).

---

## 9. Modelos de dados (`models.py`)

```python
class Convenio(models.Model):
    escritorio = FK(Escritorio)                 # multi-tenant do MayaJus
    banco = CharField(max_length=3, default="033")
    agencia = CharField(4); agencia_dv = CharField(1)
    conta = CharField(9); conta_dv = CharField(1)
    codigo_beneficiario = CharField(7)          # vai no código de barras
    codigo_transmissao = CharField(15)          # vai no header
    carteira = CharField(3, default="101")
    tipo_cobranca = CharField(1)                # pos. 058 do P [CONFIRMAR]
    forma_cadastramento = CharField(1)          # pos. 059 do P [CONFIRMAR]
    especie_titulo = CharField(2)               # [CONFIRMAR]
    numeracao = CharField(choices=["EMPRESA", "BANCO"], default="EMPRESA")
    proximo_nosso_numero = BigIntegerField(default=1)
    proximo_sequencial_arquivo = IntegerField(default=1)
    juros_mensal_pct = DecimalField(default=1.00)
    multa_pct = DecimalField(default=2.00)
    dias_protesto = IntegerField(null=True)
    dias_baixa = IntegerField(default=60)
    pix_habilitado = BooleanField(default=False)
    pix_chave_tipo = CharField(1, blank=True); pix_chave = CharField(77, blank=True)
    ativo = BooleanField(default=True)
    homologado = BooleanField(default=False)    # só gera remessa de produção se True

class Boleto(models.Model):
    convenio = FK(Convenio)
    lancamento = FK("financeiro.Lancamento")    # ajustar ao model existente
    pagador_nome, pagador_documento, pagador_tipo_doc,
    pagador_endereco, pagador_bairro, pagador_cep, pagador_cidade, pagador_uf
    seu_numero = CharField(15)
    id_empresa = CharField(25, unique=True)     # vai no P 196-220
    nosso_numero = CharField(13, unique_together=convenio)
    valor = DecimalField(12, 2)
    data_emissao, data_vencimento
    codigo_barras = CharField(44); linha_digitavel = CharField(47)
    status = CharField(choices=[RASCUNHO, EM_REMESSA, REGISTRADO, REJEITADO,
                                PAGO, BAIXADO, EM_PROTESTO, PROTESTADO, CANCELADO])
    valor_pago, valor_liquido, data_pagamento, data_credito, tarifa  # vêm do retorno
    remessa = FK(ArquivoRemessa, null=True)
    pdf = FileField(null=True)
    txid = CharField(35, blank=True)

class ArquivoRemessa(models.Model):
    convenio, sequencial, gerado_em, gerado_por, arquivo (FileField), qtd_boletos,
    valor_total, hash_sha256, ambiente = choices(["TESTE", "PRODUCAO"])

class ArquivoRetorno(models.Model):
    convenio, importado_em, importado_por, arquivo, hash_sha256 (unique),
    qtd_ocorrencias, qtd_orfas, status_processamento, log

class OcorrenciaBoleto(models.Model):
    boleto (null=True, para órfãs), retorno, codigo_movimento, descricao,
    motivos (JSONField), data_ocorrencia, valor_pago, payload_bruto (TextField)
```

Usar `Decimal` sempre. Nunca usar `float` para dinheiro.

---

## 10. Tarefas em ordem (cada uma com testes passando antes da próxima)

1. **Motor de campos** (`cnab/fields.py`, `record.py`) + testes de formatação (N, A, D, decimais, acentos, overflow).
2. **Layout Santander declarativo** (`layout.py`) + teste que valida posições contíguas de 1 a 240 em **todos** os registros.
3. **Nosso número** + teste com o exemplo do manual (`3147578 → 7`) e casos de DV 10/11/0.
4. **Código de barras + linha digitável + fator de vencimento** (com a regra de 22/02/2025) + testes.
5. **Models + migrations** + admin básico do `Convenio`.
6. **Gerador de remessa** (`remessa.py`): P + Q obrigatórios, R condicional. Testes: toda linha com 240 chars, CRLF, contagens dos trailers corretas, sequenciais corretos, snapshot de um arquivo fixture.
7. **Parser de retorno** (`retorno.py`) + fixture `.RET` fabricada a partir do layout + testes de cada código (02, 03, 06, 09, 17).
8. **Services:** `emitir_boletos(lancamentos)`, `gerar_remessa(convenio)`, `processar_retorno(arquivo)` com transação atômica e idempotência.
9. **PDF do boleto** (WeasyPrint + ITF).
10. **Telas:** cadastro do convênio, lista de boletos com filtro por status, botão "Gerar remessa" (download do `.REM`), upload do `.RET` com relatório do processamento (registrados / rejeitados com motivo / pagos / órfãos).
11. **Fase 2:** Segmento Y-03 (Pix), instruções 06 (alterar vencimento) e 09 (protesto) pela tela, envio do boleto por e-mail ao pagador **só depois do status REGISTRADO**.

---

## 11. Regras de negócio importantes

- **Não enviar o boleto ao pagador antes do retorno `02` (entrada confirmada).** Até lá o boleto pode ser recusado na hora do pagamento. A tela deve deixar isso claro.
- Remessa de **TESTE** enquanto `convenio.homologado = False`: gerar normalmente, mas marcar o arquivo e a UI como teste.
- Um boleto entra em **uma** remessa só. Depois disso, mudanças vão por instrução (02, 06 etc.), nunca reenviando a entrada.
- Valor mínimo, CPF/CNPJ válido, CEP com 8 dígitos e UF válida: **validar antes** de entrar na remessa e mostrar o erro por boleto.
- Liquidação (`06`/`17`) baixa o lançamento no financeiro do MayaJus. Se `valor_pago` for diferente de `valor`, registrar a diferença (juros/desconto) e não falhar.
- Logar tudo em `OcorrenciaBoleto` com o `payload_bruto` da linha, para auditoria.

---

## 12. Homologação com o Santander

1. O escritório contrata a Cobrança CNAB 240 com o gerente e recebe: código do beneficiário, código de transmissão, carteira e parâmetros (numeração, espécie, protesto).
2. O MayaJus gera uma remessa de **teste** com 3-5 boletos.
3. Validar no Internet Banking PJ: **Cobrança e Recebimentos → Teste de Arquivos**.
4. Corrigir o que for apontado e repetir até passar.
5. Pagar um boleto real de valor baixo, importar o retorno e conferir a baixa.
6. Marcar `convenio.homologado = True`.

---

## 13. Pontos em aberto **[CONFIRMAR]** (resolver com o manual ou o gerente)

- [ ] Pos. 058 (tipo de cobrança/carteira) e 059 (forma de cadastramento) do Segmento P — notas 5 e 6.
- [ ] Espécie do título para honorários (nota 20) — provável DS (duplicata de serviço).
- [ ] Códigos de juros (nota 21), desconto (nota 23), protesto (nota 25) e baixa (nota 26).
- [ ] Código do banco no Trailer de Lote (o manual cita 353/008/033) — validar no Teste de Arquivos.
- [ ] Tabela de motivos de rejeição (notas 40-A e 40-C).
- [ ] Posições do campo livre do código de barras no manual v3.6.
- [ ] Payload do QR Code Pix no boleto híbrido (fase 2).

---

## 14. Definição de pronto (fase 1)

- [ ] `pytest cobranca/` verde, cobertura ≥ 90% em `cnab/` e `bancos/santander/`.
- [ ] Remessa gerada passa no **Teste de Arquivos** do Santander sem erro.
- [ ] Retorno real importado: boletos registrados, rejeitados com motivo legível e pagos com baixa no financeiro.
- [ ] Reimportar o mesmo retorno não duplica nada.
- [ ] PDF do boleto lido corretamente por app de banco (linha digitável e código de barras).
