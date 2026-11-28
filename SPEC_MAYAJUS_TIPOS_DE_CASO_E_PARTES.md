# MayaJus — Spec: Tipos de Caso, Campos Padrão e Cadastro Único de Partes

> **Para o agente (Claude Code / VS Code):** leia este documento inteiro antes de começar.
> Execute por fases (seção 10), fazendo commit ao final de cada fase.
> **Não rode nada localmente** — o código roda no servidor `prod2` (GCP). Gere as migrations e os comandos, mas deixe a execução para o deploy.

---

## 0. Antes de codar — reconhecimento obrigatório

1. Leia os models atuais de **Caso/Processo**, **Parte**, **Cliente** e qualquer model de **Advogado/Usuário**.
2. Identifique:
   - o padrão de **multi-tenant** (FK `escritorio`/`tenant`, middleware, manager). **Todo model novo deste spec segue esse mesmo padrão.**
   - o padrão de nomes (PT-BR, snake_case), as classes base (`TimeStampedModel`, soft delete, auditoria) e o padrão de templates/telas.
   - onde as partes ficam hoje (texto livre no caso? model `Parte` com FK pro caso?).
3. Antes de alterar models, escreva um resumo curto em `docs/analise_partes_atual.md` dizendo **o que existe hoje e como vai ser migrado**.
4. Se algum nome deste spec bater com algo que já existe, **reaproveite o que existe** e adapte; não crie duplicado.

Stack esperada: Django + PostgreSQL. Se o repo usar outra coisa, adapte os conceitos mantendo o modelo de dados.

---

## 1. Visão geral da mudança

| Antes | Depois |
|---|---|
| Caso sem tipo (ou tipo livre) | Campo obrigatório `tipo_caso`: **Contencioso**, **Consultivo**, **Administrativo** |
| Mesmos campos para todo caso | **Campos comuns** + **campos específicos por tipo** |
| Partes cadastradas dentro do caso | **Cadastro único de Pessoas (partes)**, reaproveitado entre casos |
| Sem papel estruturado | **Envolvimento** da pessoa no caso: Categoria (ex.: Polo Ativo) + Qualificação (ex.: Autor) |
| Sem advogado da parte | **Advogados da parte** vinculados a cada envolvimento (com OAB) |

### Diagrama de entidades

```
Pessoa (cadastro único: PF/PJ)
 ├── PessoaEndereco (N)
 ├── PessoaContato (N)
 └── Advogado (0..1)  ──  AdvogadoOAB (N)

Caso
 ├── tipo_caso: CONTENCIOSO | CONSULTIVO | ADMINISTRATIVO
 ├── CasoContencioso   (1:1, só se contencioso)
 ├── CasoConsultivo    (1:1, só se consultivo)
 ├── CasoAdministrativo(1:1, só se administrativo)
 └── Envolvimento (N)  ── Pessoa
        ├── categoria  → CategoriaEnvolvimento (por tipo de caso)
        ├── qualificacao → QualificacaoEnvolvimento (por categoria)
        └── EnvolvimentoAdvogado (N) ── Advogado / AdvogadoOAB
```

---

## 2. Decisão de arquitetura dos campos

**Abordagem híbrida (obrigatória):**

1. **Campos comuns** → colunas reais em `Caso`.
2. **Campos específicos** → tabelas de extensão **1:1** (`CasoContencioso`, `CasoConsultivo`, `CasoAdministrativo`). Colunas reais, indexáveis, com filtro e relatório fácil.
3. **Campos personalizados do escritório** (futuro / opcional nesta entrega) → `CampoPersonalizado` (definição por tenant e por tipo de caso) + `Caso.dados_extras` (JSONB). Ver seção 7.

Por que não EAV para tudo: os campos padrão precisam de filtro, ordenação, relatório e integração (tribunais, NFS-e, varredura OAB). Coluna real é mais simples e rápida.

**Listas de valores** (fase, status, tribunal, órgão, etc.): usar `TextChoices` quando a lista for fixa do sistema; usar **tabela configurável por tenant** (com seed padrão) quando o escritório precisar editar. A coluna "Lista" nas tabelas abaixo indica qual usar:
- `choices` = `TextChoices` fixo no código
- `tabela` = model configurável com seed (o escritório pode adicionar/desativar itens, nunca apagar itens em uso)

---

## 3. Campo Tipo de Caso

```python
class TipoCaso(models.TextChoices):
    CONTENCIOSO = "CONTENCIOSO", "Contencioso"
    CONSULTIVO = "CONSULTIVO", "Consultivo"
    ADMINISTRATIVO = "ADMINISTRATIVO", "Administrativo"
```

Regras:
- Obrigatório na criação. Casos já existentes recebem `CONTENCIOSO` na migração **se tiverem número de processo**, senão `CONSULTIVO` — e gerar relatório (`docs/migracao_tipo_caso.csv`) para o usuário revisar.
- **Troca de tipo** depois de criado: permitida só para perfil admin, com confirmação. Ao trocar: a extensão antiga é mantida (não apaga dado), cria a nova extensão, e os envolvimentos cuja categoria não existe no novo tipo ficam marcados como "pendente de reclassificação" (ver 6.4).
- O tipo define: qual extensão é usada, quais abas/campos aparecem no formulário e quais categorias de envolvimento ficam disponíveis.

---

## 4. Campos padrão

### 4.1 Campos comuns (model `Caso`) — todos os tipos

| Campo | Tipo | Obrig. | Lista | Observação |
|---|---|---|---|---|
| `tipo_caso` | Char | ✅ | choices | Seção 3 |
| `numero_interno` / `pasta` | Char | ✅ | — | Gerado automático por tenant (ex.: `2026/000123`), editável. Único por tenant |
| `titulo` | Char(255) | ✅ | — | Ex.: "Fulano x Banco X — Revisional" |
| `cliente_principal` | FK Pessoa | ✅ | — | Atalho; deve existir também como Envolvimento marcado `eh_cliente=True` |
| `area_direito` | FK | ✅ | tabela | Cível, Trabalhista, Tributário, Previdenciário, Família, Consumidor, Empresarial/Societário, Criminal, Administrativo, Ambiental, Imobiliário, Bancário, Contratual, Digital/LGPD, Regulatório, Securitário, Eleitoral, Outros |
| `responsavel` | FK Usuário | ✅ | — | Advogado responsável interno |
| `equipe` | M2M Usuário | — | — | Demais membros |
| `status` | Char | ✅ | choices | `ATIVO`, `SUSPENSO`, `ARQUIVADO`, `ENCERRADO` |
| `data_abertura` | Date | ✅ | — | Default hoje |
| `data_encerramento` | Date | — | — | Obrigatória se status = ENCERRADO |
| `motivo_encerramento` | FK | — | tabela | Êxito, Acordo, Improcedência, Desistência, Perda de objeto, Entregue (consultivo), Revogação de mandato, Outros |
| `objeto` / `descricao` | Text | — | — | Resumo do caso |
| `valor_estimado` | Decimal(15,2) | — | — | Valor econômico envolvido |
| `origem_captacao` | FK | — | tabela | Indicação, Site, Cliente recorrente, Parceiro, Outros |
| `centro_custo` | FK | — | tabela | Para financeiro |
| `forma_honorario` | Char | — | choices | `FIXO`, `HORA`, `EXITO`, `FIXO_MAIS_EXITO`, `MENSAL_PARTIDO`, `PRO_BONO` |
| `valor_honorario` | Decimal | — | — | |
| `percentual_exito` | Decimal(5,2) | — | — | |
| `contrato_honorarios` | FK Documento | — | — | Se existir módulo de documentos |
| `etiquetas` | M2M Etiqueta | — | tabela | Tags livres por tenant |
| `caso_pai` | FK Caso (self) | — | — | Vínculo: recurso, incidente, desdobramento, administrativo → judicial |
| `tipo_vinculo` | Char | — | choices | `RECURSO`, `INCIDENTE`, `APENSO`, `DESDOBRAMENTO`, `CONEXO`, `JUDICIALIZACAO` |
| `sigiloso` | Bool | — | — | Restringe visualização à equipe |
| `observacoes` | Text | — | — | |
| `dados_extras` | JSONB | — | — | Campos personalizados (seção 7) |
| `criado_por`, `criado_em`, `atualizado_em` | — | auto | — | Seguir classe base do projeto |

### 4.2 Contencioso (`CasoContencioso`, OneToOne com Caso)

| Campo | Tipo | Obrig. | Lista | Observação |
|---|---|---|---|---|
| `numero_cnj` | Char(25) | ✅* | — | Máscara `NNNNNNN-DD.AAAA.J.TR.OOOO`. *Pode ficar vazio se `pre_ajuizamento=True` |
| `pre_ajuizamento` | Bool | — | — | Caso ainda não distribuído |
| `numero_antigo` | Char | — | — | Numeração anterior ao CNJ |
| `justica` | Char | ✅ | choices | `ESTADUAL`, `FEDERAL`, `TRABALHO`, `ELEITORAL`, `MILITAR_UNIAO`, `MILITAR_ESTADUAL`, `STF`, `STJ`, `TST`, `TSE`, `STM`, `CNJ`. **Auto pelo dígito J do CNJ** |
| `tribunal` | FK | ✅ | tabela | Seed: todos os tribunais (TJs, TRFs 1–6, TRTs 1–24, TREs, STF, STJ, TST, TSE, STM, TJMs). **Auto pelo J+TR do CNJ** |
| `instancia` | Char | ✅ | choices | `PRIMEIRA`, `SEGUNDA`, `SUPERIOR`, `SUPREMO`, `JUIZADO`, `TURMA_RECURSAL` |
| `comarca` / `secao_judiciaria` | Char | — | — | |
| `uf` | Char(2) | — | choices | |
| `orgao_julgador` | Char | — | — | Vara / câmara / turma |
| `codigo_orgao` | Char(4) | — | — | `OOOO` do CNJ |
| `juiz_relator` | Char | — | — | |
| `sistema_tribunal` | Char | — | choices | `PJE`, `ESAJ`, `EPROC`, `PROJUDI`, `TUCUJURIS`, `SEEU`, `FISICO`, `OUTRO` — usado pela integração com tribunais |
| `classe_processual` | FK | — | tabela | Seed das classes mais comuns das TPU/CNJ (Procedimento Comum, Execução de Título Extrajudicial, Cumprimento de Sentença, Mandado de Segurança, Ação Trabalhista – Rito Ordinário/Sumaríssimo, Juizado Especial Cível, Embargos à Execução, Monitória, Busca e Apreensão, Despejo, Inventário, Divórcio, Alimentos, Recuperação Judicial, Execução Fiscal, Agravo de Instrumento, Apelação, Recurso Ordinário, REsp, RE, etc.) |
| `assunto_principal` | FK | — | tabela | Seed TPU/CNJ (assuntos mais comuns) |
| `assuntos_secundarios` | M2M | — | tabela | |
| `rito` | Char | — | choices | `COMUM`, `SUMARIO`, `SUMARISSIMO`, `ESPECIAL`, `JUIZADO`, `EXECUCAO` |
| `fase_processual` | Char | ✅ | choices | `PRE_AJUIZAMENTO`, `CONHECIMENTO`, `INSTRUCAO`, `SENTENCIADO`, `RECURSAL`, `CUMPRIMENTO_SENTENCA`, `EXECUCAO`, `ACORDO_CUMPRIMENTO`, `SUSPENSO`, `ARQUIVADO_PROVISORIO`, `ENCERRADO` |
| `polo_cliente` | Char | ✅ | choices | `ATIVO`, `PASSIVO`, `TERCEIRO` — **derivado** dos envolvimentos onde `eh_cliente=True`; alertar se inconsistente |
| `data_distribuicao` | Date | — | — | |
| `data_citacao` | Date | — | — | |
| `data_transito_julgado` | Date | — | — | |
| `valor_causa` | Decimal | — | — | |
| `valor_condenacao` | Decimal | — | — | |
| `valor_acordo` | Decimal | — | — | |
| `prognostico` | Char | — | choices | `PROVAVEL`, `POSSIVEL`, `REMOTO` (padrão CPC 25 / auditoria) |
| `valor_provisionado` | Decimal | — | — | |
| `valor_risco` | Decimal | — | — | |
| `deposito_judicial` | Decimal | — | — | Soma (se houver tabela de depósitos, vira campo calculado) |
| `justica_gratuita` | Bool | — | — | |
| `segredo_justica` | Bool | — | — | |
| `tutela_liminar` | Char | — | choices | `NAO_REQUERIDA`, `REQUERIDA`, `DEFERIDA`, `INDEFERIDA`, `REVOGADA` |
| `resultado` | Char | — | choices | `PROCEDENTE`, `PARCIALMENTE_PROCEDENTE`, `IMPROCEDENTE`, `ACORDO`, `EXTINTO_SEM_MERITO`, `DESISTENCIA` |
| `monitorar_andamentos` | Bool | — | — | Liga a captura automática (integração tribunais) |

**Validação do número CNJ** (`utils/cnj.py`, com teste):
- Formato `NNNNNNN-DD.AAAA.J.TR.OOOO` (aceitar com ou sem pontuação; salvar formatado).
- Dígito verificador: módulo 97 (Res. CNJ 65/2008):
  `DD = 98 - (int(f"{NNNNNNN}{AAAA}{J}{TR}{OOOO}") * 100 % 97)`.
- Ao digitar um CNJ válido, preencher automaticamente `justica`, `tribunal`, `codigo_orgao` e ano.
- `numero_cnj` único por tenant (alerta de duplicidade com link pro caso existente).

### 4.3 Consultivo (`CasoConsultivo`, OneToOne com Caso)

| Campo | Tipo | Obrig. | Lista | Observação |
|---|---|---|---|---|
| `tipo_demanda` | FK | ✅ | tabela | Parecer, Elaboração de contrato, Revisão de contrato, Due diligence, Opinião legal, Compliance/Programa de integridade, LGPD/Privacidade, Societário (alteração, constituição, acordo de sócios), Planejamento tributário, Planejamento sucessório, Notificação extrajudicial, Negociação, Reunião/Consulta, Registro de marca/PI, Regularização imobiliária, Outros |
| `solicitante` | FK Pessoa | — | — | Pessoa física que pediu (pode ser funcionário do cliente) |
| `departamento_solicitante` | Char | — | — | Jurídico, RH, Financeiro... |
| `data_solicitacao` | Date | ✅ | — | |
| `prazo_entrega` | Date | — | — | Gera alerta/agenda |
| `sla_dias` | Int | — | — | Se o contrato do cliente tiver SLA |
| `prioridade` | Char | ✅ | choices | `BAIXA`, `MEDIA`, `ALTA`, `URGENTE` |
| `complexidade` | Char | — | choices | `BAIXA`, `MEDIA`, `ALTA` |
| `etapa` | Char | ✅ | choices | `RECEBIDO`, `EM_ANALISE`, `AGUARDANDO_CLIENTE`, `AGUARDANDO_TERCEIRO`, `EM_ELABORACAO`, `EM_REVISAO`, `ENTREGUE`, `EM_NEGOCIACAO`, `CONCLUIDO`, `CANCELADO` |
| `horas_estimadas` | Decimal(7,2) | — | — | |
| `horas_realizadas` | Decimal(7,2) | — | — | Calculado do timesheet, se existir |
| `valor_envolvido` | Decimal | — | — | Valor do contrato/operação |
| `contrato_vigencia_inicio` | Date | — | — | Quando a demanda é contrato |
| `contrato_vigencia_fim` | Date | — | — | Gera alerta de vencimento/renovação |
| `renovacao_automatica` | Bool | — | — | |
| `data_entrega` | Date | — | — | Obrigatória se etapa = ENTREGUE/CONCLUIDO |
| `documento_entregue` | FK Documento | — | — | |
| `risco_identificado` | Char | — | choices | `BAIXO`, `MEDIO`, `ALTO`, `CRITICO` |
| `recomendacao_resumo` | Text | — | — | Conclusão do parecer |
| `gerou_contencioso` | FK Caso | — | — | Atalho para o caso judicial que nasceu daqui |

### 4.4 Administrativo (`CasoAdministrativo`, OneToOne com Caso)

| Campo | Tipo | Obrig. | Lista | Observação |
|---|---|---|---|---|
| `esfera` | Char | ✅ | choices | `FEDERAL`, `ESTADUAL`, `MUNICIPAL`, `DISTRITAL` |
| `orgao` | FK | ✅ | tabela | Seed: Receita Federal, PGFN, CARF, INSS/CRPS, Ministério do Trabalho (SRTE), SEFAZ (por UF), TIT/SP, Prefeitura (ISS/IPTU), PROCON, Senacon, ANATEL, ANS, ANVISA, ANEEL, ANTT, ANP, ANAC, BACEN, CVM, SUSEP, CADE, IBAMA, CETESB/órgão ambiental estadual, DETRAN, Junta Comercial, INPI, Tribunal de Contas (TCU/TCE/TCM), Corregedoria, OAB (TED), Conselhos profissionais, Polícia Federal (imigração/armas), Cartórios, Outros |
| `unidade_orgao` | Char | — | — | Delegacia, regional, câmara, turma |
| `uf` / `municipio` | Char | — | — | |
| `tipo_procedimento` | FK | ✅ | tabela | Defesa de auto de infração, Impugnação, Recurso voluntário, Recurso especial (CARF), Manifestação de inconformidade, Pedido de restituição/compensação, Consulta fiscal, Parcelamento/transação, Requerimento de benefício (INSS), Recurso CRPS, Reclamação PROCON, Processo administrativo disciplinar (PAD), Sindicância, Licitação/impugnação de edital, Recurso em licitação, Licenciamento (ambiental/sanitário), Registro/autorização, Processo sancionador (agência reguladora), Ato de concentração (CADE), Tomada de contas, Outros |
| `numero_processo_adm` | Char | ✅* | — | *Ou `numero_protocolo` |
| `numero_protocolo` | Char | — | — | |
| `numero_auto_infracao` | Char | — | — | |
| `numero_nb` | Char | — | — | Nº do benefício (INSS) |
| `instancia_adm` | Char | ✅ | choices | `PRIMEIRA`, `SEGUNDA`, `ESPECIAL_SUPERIOR`, `UNICA` |
| `fase_adm` | Char | ✅ | choices | `PRE_PROTOCOLO`, `PROTOCOLADO`, `EM_ANALISE`, `EXIGENCIA`, `DEFESA_APRESENTADA`, `AGUARDANDO_JULGAMENTO`, `DECIDIDO`, `EM_RECURSO`, `DEFINITIVO`, `ENCERRADO` |
| `data_ciencia` / `data_notificacao` | Date | — | — | Base para contagem de prazo |
| `prazo_defesa` | Date | — | — | Gera prazo na agenda |
| `data_protocolo` | Date | — | — | |
| `valor_autuado` | Decimal | — | — | Principal |
| `valor_multa` | Decimal | — | — | |
| `valor_juros` | Decimal | — | — | |
| `valor_atualizado` | Decimal | — | — | |
| `data_atualizacao_valor` | Date | — | — | |
| `exigibilidade_suspensa` | Bool | — | — | Tributário |
| `garantia` | Char | — | choices | `NENHUMA`, `DEPOSITO`, `SEGURO_GARANTIA`, `FIANCA`, `ARROLAMENTO` |
| `prognostico` | Char | — | choices | `PROVAVEL`, `POSSIVEL`, `REMOTO` |
| `decisao` | Char | — | choices | `FAVORAVEL`, `PARCIALMENTE_FAVORAVEL`, `DESFAVORAVEL`, `ANULADO`, `ARQUIVADO` |
| `data_decisao` | Date | — | — | |
| `cabe_judicializacao` | Bool | — | — | |
| `prazo_judicializacao` | Date | — | — | Ex.: prazo de MS (120 dias) |
| `caso_judicial` | FK Caso | — | — | Atalho para o contencioso decorrente (`tipo_vinculo=JUDICIALIZACAO`) |
| `link_sistema_orgao` | URL | — | — | e-CAC, Meu INSS, portal da agência |

---

## 5. Cadastro Único de Partes (Pessoas)

### 5.1 `Pessoa`

| Campo | Tipo | Obrig. | Observação |
|---|---|---|---|
| `tipo_pessoa` | choices `PF`/`PJ`/`ENTE_PUBLICO`/`ESTRANGEIRO`/`SEM_DOCUMENTO` | ✅ | `SEM_DOCUMENTO` para "Réu desconhecido", espólio sem CPF etc. |
| `nome` | Char(255) | ✅ | Nome completo / razão social |
| `nome_social` | Char | — | PF |
| `nome_fantasia` | Char | — | PJ |
| `cpf_cnpj` | Char(18) | ✅* | Salvar só dígitos (`documento_numerico`) + versão formatada. Validar DV. **Único por tenant** quando preenchido. *Não obrigatório p/ `ESTRANGEIRO`/`SEM_DOCUMENTO` |
| `documento_estrangeiro` | Char | — | Passaporte etc. |
| `rg` / `orgao_emissor` / `uf_rg` | Char | — | PF |
| `data_nascimento` / `data_fundacao` | Date | — | |
| `nacionalidade` | Char | — | default "brasileira" |
| `estado_civil` | choices | — | PF — usado na qualificação de peças |
| `regime_bens` | choices | — | PF |
| `profissao` | Char | — | PF |
| `nome_mae` | Char | — | PF (muitos tribunais pedem) |
| `pis_nit` / `ctps` | Char | — | PF — trabalhista/previdenciário |
| `inscricao_estadual` / `inscricao_municipal` | Char | — | PJ — conversa com a emissão de NFS-e |
| `cnae_principal` | Char | — | PJ |
| `representante_legal` | FK Pessoa (self) | — | PJ → sócio/administrador; incapaz → responsável |
| `eh_cliente` | Bool | — | Flag global: já é cliente do escritório |
| `eh_ente_publico` | Bool | — | Auto se tipo = ENTE_PUBLICO |
| `ativo` | Bool | — | Soft delete |
| `observacoes` | Text | — | |
| `consentimento_lgpd` / `base_legal_lgpd` | — | — | Base legal: exercício regular de direito / contrato |
| auditoria | — | — | criado_por, criado_em, atualizado_em |

**`PessoaEndereco`** (N): tipo (`RESIDENCIAL`, `COMERCIAL`, `CORRESPONDENCIA`, `CITACAO`), CEP (busca ViaCEP), logradouro, número, complemento, bairro, cidade, código IBGE (importante p/ NFS-e), UF, país, principal (bool).

**`PessoaContato`** (N): tipo (`EMAIL`, `CELULAR`, `WHATSAPP`, `TELEFONE`, `SITE`), valor, descrição, principal (bool), aceita_comunicacao (bool).

**Regras do cadastro único:**
- Busca/autocomplete por nome, CPF/CNPJ (com e sem máscara), nome fantasia. Usar `pg_trgm` + `unaccent` para busca por nome.
- Ao digitar CPF/CNPJ já existente → **não cria novo**, mostra a pessoa existente e oferece "usar esta".
- Detecção de **possíveis duplicados** por nome parecido (similaridade trigram > 0.8) sem documento → aviso, não bloqueio.
- **Mesclar pessoas** (admin): escolhe a principal, move todos os envolvimentos/endereços/contatos e desativa a duplicada. Registrar log.
- Edição na pessoa reflete em todos os casos (é o mesmo registro). Tela da pessoa mostra a aba **"Casos em que aparece"** com tipo de envolvimento em cada um — útil pra checagem de **conflito de interesses** (ver 6.5).
- Não permitir excluir Pessoa com envolvimento; só desativar.

### 5.2 `Advogado` e `AdvogadoOAB`

Advogado é uma **Pessoa** (PF) com dados profissionais — assim o mesmo cadastro serve como advogado da parte contrária, correspondente, ou até como parte.

**`Advogado`** (OneToOne com Pessoa):

| Campo | Tipo | Observação |
|---|---|---|
| `pessoa` | OneToOne Pessoa | ✅ |
| `sociedade` | FK Pessoa (PJ) | Escritório/sociedade de advogados a que pertence |
| `eh_interno` | Bool | Advogado do próprio escritório (vincula a `Usuario`) |
| `usuario` | FK Usuário | Se interno |
| `email_profissional` / `telefone_profissional` | Char | |
| `observacoes` | Text | |

**`AdvogadoOAB`** (N por advogado):

| Campo | Tipo | Observação |
|---|---|---|
| `advogado` | FK | |
| `numero` | Char | Só dígitos + letra (ex.: `123456`, `123456-A`) |
| `uf` | Char(2) | |
| `tipo_inscricao` | choices `PRINCIPAL`, `SUPLEMENTAR`, `ESTAGIARIO`, `PROVISORIA` | |
| `situacao` | choices `REGULAR`, `SUSPENSA`, `CANCELADA`, `LICENCIADA` | |
| `principal` | Bool | |

Unique: (`numero`, `uf`, `tipo_inscricao`) por tenant. Exibição padrão: `OAB/SP 123.456`.
Conecta com a **varredura por OAB** e o **protocolo automático** (integração tribunais) — os advogados internos com OAB alimentam essa rotina.

---

## 6. Envolvimento (Pessoa ↔ Caso)

### 6.1 Models

**`CategoriaEnvolvimento`** (tabela com seed, por tipo de caso)
- `tipo_caso` (choices), `codigo`, `nome`, `ordem`, `polo` (choices `ATIVO`, `PASSIVO`, `NEUTRO`), `ativo`, `sistema` (bool — itens do sistema não podem ser apagados).

**`QualificacaoEnvolvimento`** (tabela com seed, por categoria)
- `categoria` (FK), `codigo`, `nome`, `ordem`, `ativo`, `sistema`.
- O escritório pode adicionar qualificações próprias.

**`Envolvimento`**

| Campo | Tipo | Obrig. | Observação |
|---|---|---|---|
| `caso` | FK Caso | ✅ | |
| `pessoa` | FK Pessoa | ✅ | |
| `categoria` | FK CategoriaEnvolvimento | ✅ | Deve ser do mesmo `tipo_caso` do caso |
| `qualificacao` | FK QualificacaoEnvolvimento | — | Deve pertencer à categoria |
| `eh_cliente` | Bool | — | Cliente do escritório **neste caso** |
| `principal` | Bool | — | Parte principal do polo (aparece no título) |
| `ordem` | Int | — | Ordenação dentro do polo |
| `representado_por` | FK Envolvimento (self) | — | Ex.: menor representado pela mãe, PJ pelo preposto |
| `data_inclusao` / `data_exclusao` | Date | — | Parte excluída do processo fica no histórico |
| `ativo` | Bool | — | |
| `pendente_reclassificacao` | Bool | — | Após troca de tipo do caso |
| `observacoes` | Text | — | |

Constraints:
- Unique (`caso`, `pessoa`, `categoria`, `qualificacao`) entre ativos.
- Pelo menos 1 envolvimento com `eh_cliente=True` por caso (validação no form/service, não constraint de banco).
- No contencioso, se `principal=True`, só um principal por polo.

**`EnvolvimentoAdvogado`** — advogados da parte naquele caso

| Campo | Tipo | Obrig. | Observação |
|---|---|---|---|
| `envolvimento` | FK Envolvimento | ✅ | |
| `advogado` | FK Advogado | ✅ | |
| `oab` | FK AdvogadoOAB | — | Qual OAB está habilitada no caso (default: principal) |
| `principal` | Bool | — | Advogado que recebe intimações |
| `tipo_habilitacao` | choices `PROCURACAO`, `SUBSTABELECIMENTO_COM_RESERVA`, `SUBSTABELECIMENTO_SEM_RESERVA`, `DEFENSOR_PUBLICO`, `DATIVO`, `PROCURADOR_PUBLICO` | — | |
| `data_habilitacao` | Date | — | |
| `data_desabilitacao` | Date | — | Renúncia/revogação |
| `documento_procuracao` | FK Documento | — | |
| `ativo` | Bool | — | |

Para o **cliente**, o padrão é sugerir automaticamente os advogados internos da equipe do caso. Para a **parte contrária**, o usuário busca/cadastra o advogado (cadastro único — ele vai se repetir em outros processos).

### 6.2 Seed — CONTENCIOSO

| Categoria (polo) | Qualificações |
|---|---|
| **Polo Ativo** (ATIVO) | Autor, Requerente, Reclamante, Exequente, Impetrante, Embargante, Apelante, Agravante, Recorrente, Querelante, Denunciante (penal), Assistente de Acusação, Litisconsorte Ativo, Credor, Alimentando, Inventariante, Promovente, Suscitante, Oponente |
| **Polo Passivo** (PASSIVO) | Réu, Requerido, Reclamado, Executado, Impetrado (autoridade coatora), Embargado, Apelado, Agravado, Recorrido, Querelado, Denunciado/Acusado, Investigado, Litisconsorte Passivo, Devedor, Alimentante, Promovido, Suscitado, Oposto, Responsável Subsidiário/Solidário (trabalhista) |
| **Terceiros** (NEUTRO) | Terceiro Interessado, Assistente Simples, Assistente Litisconsorcial, Denunciado à Lide, Chamado ao Processo, Opoente, Amicus Curiae, Terceiro Embargante, Arrematante, Credor Habilitado, Administrador Judicial, Interveniente |
| **Outros** (NEUTRO) | Ministério Público (fiscal da ordem jurídica), Defensoria Pública, Perito Judicial, Assistente Técnico, Testemunha, Informante, Preposto, Curador Especial, Tutor/Curador, Representante Legal, Leiloeiro, Depositário, Intérprete/Tradutor, Mediador/Conciliador, Correspondente |

### 6.3 Seed — CONSULTIVO

| Categoria (polo) | Qualificações |
|---|---|
| **Cliente / Solicitante** (ATIVO) | Cliente, Contratante, Solicitante, Consulente, Sócio/Acionista, Administrador, Empresa do Grupo, Beneficiário |
| **Contraparte** (PASSIVO) | Contraparte, Contratado, Fornecedor, Locador, Locatário, Comprador, Vendedor, Cedente, Cessionário, Investidor, Empresa-alvo (M&A/Due diligence), Licenciante, Licenciado, Notificado |
| **Intervenientes** (NEUTRO) | Interveniente Anuente, Fiador/Avalista, Garantidor, Cônjuge Anuente, Testemunha Contratual, Agente Fiduciário, Escrow Agent |
| **Outros** (NEUTRO) | Assessor Externo, Contador, Auditor, Consultor Técnico, Corretor, Cartório/Tabelião, Órgão de Registro, Advogado da Contraparte (sem ser parte — usar só se não couber em EnvolvimentoAdvogado), Parecerista Externo |

### 6.4 Seed — ADMINISTRATIVO

| Categoria (polo) | Qualificações |
|---|---|
| **Interessado / Requerente** (ATIVO) | Interessado, Requerente, Autuado, Contribuinte, Impugnante, Recorrente, Segurado/Beneficiário, Licitante, Reclamante (PROCON), Representante (denúncia), Servidor Processado (PAD), Requerente de Licença |
| **Órgão / Autoridade** (PASSIVO) | Órgão Público, Autoridade Autuante, Autoridade Julgadora, Fazenda Pública, Agência Reguladora, Comissão de Licitação/Agente de Contratação, Comissão Processante, Recorrido |
| **Terceiros Interessados** (NEUTRO) | Terceiro Interessado, Concorrente, Licitante Concorrente, Reclamado (PROCON — quando o cliente é o reclamante), Representado, Responsável Solidário, Coobrigado |
| **Outros** (NEUTRO) | Fiscal/Auditor, Perito, Assistente Técnico, Testemunha, Relator/Conselheiro, Procurador do Órgão, Ministério Público de Contas, Preposto, Contador |

**Troca de tipo de caso** → mapear categorias por `polo`: ATIVO→ATIVO, PASSIVO→PASSIVO, NEUTRO→ "Outros" do novo tipo; marcar `pendente_reclassificacao=True` e zerar `qualificacao`. Mostrar banner no caso pedindo revisão.

### 6.5 Conflito de interesses

Ao adicionar um envolvimento, verificar se a **mesma Pessoa** aparece em outro caso ativo do tenant no **polo oposto ao do cliente** (ex.: é cliente num caso e parte contrária em outro). Se sim → **alerta** (não bloqueia) com lista dos casos. Registrar quem confirmou e quando (`AlertaConflitoConfirmado` ou log simples).

### 6.6 Título automático do caso (contencioso)

Sugerir `titulo` = `{principal polo ativo} x {principal polo passivo}` (+ "e outros" se houver mais de um no polo). Só sugerir; o usuário pode editar.

---

## 7. Campos personalizados (opcional nesta entrega — deixar estrutura pronta)

**`CampoPersonalizado`** (por tenant): `tipo_caso` (ou "todos"), `codigo` (slug), `rotulo`, `tipo_dado` (`TEXTO`, `TEXTO_LONGO`, `NUMERO`, `DECIMAL`, `MOEDA`, `DATA`, `BOOL`, `LISTA`, `LISTA_MULTIPLA`, `PESSOA`, `URL`), `opcoes` (JSON, para lista), `obrigatorio`, `ordem`, `grupo/aba`, `ativo`, `ajuda`.

Valores salvos em `Caso.dados_extras` (JSONB) com chave = `codigo`. Validar pelo tipo no service. Índice GIN em `dados_extras`.
Tela de admin do escritório: "Configurações → Campos do caso" para criar/ordenar/desativar.

---

## 8. Telas / UX

### 8.1 Novo caso
1. **Passo 1 — Tipo de caso**: 3 cards grandes (Contencioso / Consultivo / Administrativo) com ícone e uma linha de descrição.
2. **Passo 2 — Dados**: abas
   - **Geral** (campos comuns)
   - **Dados do processo** / **Dados da demanda** / **Dados do procedimento** (conforme tipo)
   - **Partes** (envolvimentos)
   - **Financeiro/Honorários**
   - **Campos personalizados** (se houver)
3. No contencioso, o campo **Nº CNJ vem primeiro**: ao colar um CNJ válido, preenche justiça/tribunal/ano e (se a integração com tribunais estiver ativa) oferece "Buscar dados no tribunal" para importar partes e advogados.

### 8.2 Aba Partes (o coração da mudança)
- Layout em **colunas/blocos por categoria** (no contencioso: Polo Ativo | Polo Passivo | Terceiros | Outros).
- Cada bloco tem botão **"+ Adicionar"** que abre modal:
  1. Campo de busca única (nome ou CPF/CNPJ) com autocomplete do cadastro único.
  2. Se não achar → "Cadastrar nova pessoa" (form rápido: tipo, nome, documento, e-mail, telefone; resto depois).
  3. Selecionar **Qualificação** (filtrada pela categoria), marcar **É cliente** / **Principal**.
  4. Seção **Advogados desta parte**: buscar advogado por nome ou OAB (`123456/SP`); se não achar, cadastrar rápido (nome + OAB + UF + sociedade). Marcar principal.
- Card de cada parte mostra: nome, documento mascarado, qualificação, selo "Cliente", e lista de advogados com OAB.
- Arrastar para reordenar dentro do bloco; mover entre blocos = trocar categoria.
- Badge de alerta de conflito de interesses quando aplicável.

### 8.3 Cadastro de Pessoas (menu próprio)
- Lista com filtros: tipo, é cliente, é advogado, cidade/UF, ativo.
- Detalhe com abas: Dados | Endereços | Contatos | Dados de advogado (se for) | Casos em que aparece | Histórico.
- Ação admin: **Mesclar duplicados**.

### 8.4 Listagem de casos
- Filtro por **tipo de caso** (chips no topo) + filtros específicos aparecem conforme o tipo selecionado (fase, tribunal, órgão, prognóstico, etapa...).
- Coluna "Partes" mostra `Ativo x Passivo` resumido.

---

## 9. Migração de dados (partes atuais → cadastro único)

Criar migração de dados + management command `migrar_partes_cadastro_unico --dry-run`:

1. Para cada parte atual: normalizar documento (só dígitos), nome (trim, unaccent p/ comparação).
2. Agrupar por `(tenant, documento)`; sem documento, agrupar por `(tenant, nome normalizado)` **somente se idêntico** — caso contrário cria pessoas separadas e lista como "possível duplicado".
3. Criar `Pessoa` + endereço/contato (se houver).
4. Criar `Envolvimento` mapeando o papel antigo:
   - textos tipo "autor/reclamante/requerente/exequente/impetrante" → Polo Ativo + qualificação correspondente;
   - "réu/reclamado/requerido/executado/impetrado" → Polo Passivo;
   - cliente do caso → `eh_cliente=True`;
   - não identificado → categoria "Outros" + `pendente_reclassificacao=True`.
5. Se as partes antigas tinham advogado em texto (nome/OAB), tentar extrair OAB com regex (`(\d{3,6})[\s/-]*([A-Z]{2})` e variações `OAB/SP 123.456`) e criar `Advogado` + `AdvogadoOAB` + `EnvolvimentoAdvogado`.
6. Gerar relatório `docs/migracao_partes_relatorio.csv` (pessoa criada, casos vinculados, duplicados suspeitos, pendências).
7. **Não apagar** a tabela/colunas antigas nesta entrega — renomear para `*_legado` ou manter readonly. Remoção numa entrega futura.
8. Comando idempotente (pode rodar 2x sem duplicar).

---

## 10. Plano de execução (fases com commit)

**Fase 1 — Base**
- [ ] Reconhecimento (seção 0) + `docs/analise_partes_atual.md`
- [ ] `TipoCaso` no `Caso` + campos comuns que faltarem
- [ ] Models de listas configuráveis (área, tribunal, classe, assunto, órgão, tipo de demanda, tipo de procedimento, etc.)
- [ ] Seeds (data migrations ou fixtures + command `carregar_seeds_mayajus`) — idempotente, por tenant, com `sistema=True`

**Fase 2 — Extensões por tipo**
- [ ] `CasoContencioso`, `CasoConsultivo`, `CasoAdministrativo`
- [ ] `utils/cnj.py` (validação DV + parsing J/TR/OOOO) + mapa J.TR → tribunal
- [ ] Service `criar_caso(tipo, dados)` que cria Caso + extensão em transação
- [ ] Signal/service para garantir que a extensão certa existe

**Fase 3 — Pessoas e advogados**
- [ ] `Pessoa`, `PessoaEndereco`, `PessoaContato`, `Advogado`, `AdvogadoOAB`
- [ ] Validadores CPF/CNPJ (DV) e OAB
- [ ] Extensões Postgres `pg_trgm` e `unaccent` (migration `CreateExtension`) + índices
- [ ] Endpoint de autocomplete `/api/pessoas/buscar?q=` e `/api/advogados/buscar?q=` (aceita `123456/SP`)
- [ ] Busca de CEP (ViaCEP) — chamar do backend em `prod2`

**Fase 4 — Envolvimento**
- [ ] `CategoriaEnvolvimento`, `QualificacaoEnvolvimento` + seeds das seções 6.2–6.4
- [ ] `Envolvimento`, `EnvolvimentoAdvogado` + validações (categoria do mesmo tipo, qualificação da categoria, ≥1 cliente)
- [ ] Derivação de `polo_cliente` no contencioso
- [ ] Checagem de conflito de interesses (6.5)
- [ ] Título automático (6.6)

**Fase 5 — Telas**
- [ ] Wizard novo caso (8.1)
- [ ] Aba Partes (8.2) com modais de pessoa/advogado
- [ ] CRUD de Pessoas + mesclar (8.3)
- [ ] Filtros por tipo na listagem (8.4)
- [ ] Admin Django registrado para todos os models novos (com `list_filter`, `search_fields`, inlines)

**Fase 6 — Migração**
- [ ] Command `migrar_partes_cadastro_unico` (seção 9) com `--dry-run` e `--tenant`
- [ ] Classificação de `tipo_caso` dos casos existentes + CSV de revisão

**Fase 7 — Campos personalizados (se der tempo)**
- [ ] `CampoPersonalizado` + `dados_extras` + tela de configuração

**Fase 8 — Testes e docs**
- [ ] Testes (seção 11)
- [ ] `docs/campos_padrao.md` gerado a partir dos models (lista de campos por tipo) para o time de suporte/implantação
- [ ] Atualizar README com os comandos novos

---

## 11. Testes mínimos

- CNJ: válidos, DV errado, com/sem máscara, mapeamento J/TR para tribunal (ex.: `.8.26.` → TJSP, `.5.15.` → TRT15, `.4.03.` → TRF3).
- CPF/CNPJ: válidos, inválidos, sequências repetidas (`111.111.111-11`).
- Pessoa: não duplica por documento no mesmo tenant; pode repetir documento em tenants diferentes.
- Envolvimento: rejeita categoria de outro tipo de caso; rejeita qualificação de outra categoria; exige ≥1 cliente; único principal por polo.
- Troca de tipo: preserva dados, marca pendências.
- Conflito de interesses: dispara quando a pessoa é cliente num caso e parte contrária em outro.
- Migração: idempotente; relatório gerado; mapeamento de papéis antigos.
- Isolamento de tenant em todas as queries novas (pessoa do tenant A nunca aparece no autocomplete do tenant B).

---

## 12. Critérios de aceite

1. Criar caso exige escolher Contencioso, Consultivo ou Administrativo, e o formulário mostra só os campos daquele tipo.
2. Uma mesma pessoa (ex.: Banco X, CNPJ único) é cadastrada uma vez e aparece em N casos com envolvimentos diferentes.
3. No contencioso, a aba Partes mostra **Polo Ativo, Polo Passivo, Terceiros e Outros**; no consultivo e no administrativo, as categorias das seções 6.3 e 6.4.
4. Cada parte pode ter 0..N advogados, com OAB/UF, e o advogado também é cadastro único.
5. Colar um CNJ válido preenche justiça e tribunal sozinho.
6. Partes antigas foram migradas sem perda, com relatório de pendências.
7. Tudo respeita o multi-tenant existente.
8. Listas configuráveis podem ganhar itens novos pelo escritório sem deploy.

---

## 13. Fora do escopo (não fazer agora)

- Remover tabelas/colunas legadas de partes.
- Importação automática de partes pelos tribunais (só deixar o gancho "Buscar dados no tribunal" chamando o serviço da integração, se já existir).
- Consulta automática de situação da OAB no CNA.
- Consulta automática de CNPJ na Receita (pode deixar o gancho).
