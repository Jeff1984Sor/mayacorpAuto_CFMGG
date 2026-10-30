# Especificação de Campos — Integração com Tribunais

**Escopo:** importação (migração) de processos pela OAB + protocolo de petições (inicial e intermediária) em todos os tribunais, usando o certificado digital do advogado.

**Base de referência:** estrutura do MNI (Modelo Nacional de Interoperabilidade, CNJ), TPU (Tabelas Processuais Unificadas do CNJ), CPC arts. 287 e 319, Lei 11.419/2006.

> Convenções: **Obr.** = obrigatório (S = sim, N = não, C = condicional). Tipos: `str`, `int`, `dec`, `bool`, `date`, `datetime`, `enum`, `bytes`, `uuid`, `json`.

---

## Sumário

1. [Visão geral do fluxo](#1-visão-geral-do-fluxo)
2. [Certificado e advogado](#2-certificado-e-advogado)
3. [Cadastro de tribunais e sistemas](#3-cadastro-de-tribunais-e-sistemas)
4. [Descoberta de processos (varredura pela OAB)](#4-descoberta-de-processos-varredura-pela-oab)
5. [Processo (dados de capa)](#5-processo-dados-de-capa)
6. [Partes e representantes](#6-partes-e-representantes)
7. [Movimentações](#7-movimentações)
8. [Documentos dos autos](#8-documentos-dos-autos)
9. [Vínculo com cliente](#9-vínculo-com-cliente)
10. [Protocolo — petição inicial](#10-protocolo--petição-inicial)
11. [Protocolo — petição intermediária](#11-protocolo--petição-intermediária)
12. [Custas e guias](#12-custas-e-guias)
13. [Retorno do protocolo](#13-retorno-do-protocolo)
14. [Jobs, fila e auditoria](#14-jobs-fila-e-auditoria)
15. [Tabelas de domínio (enums)](#15-tabelas-de-domínio-enums)
16. [Regras e validações importantes](#16-regras-e-validações-importantes)
17. [Notificação por e-mail do protocolo](#17-notificação-por-e-mail-do-protocolo)
18. [Cobrança e medição de uso](#18-cobrança-e-medição-de-uso)

---

## 1. Visão geral do fluxo

```
[Upload certificado A1] → [Consentimento LGPD] → [Varredura por OAB (DJEN / agregador)]
        → [Lista de processos encontrados] → [Usuário escolhe quais importar]
        → [Download completo por tribunal (certificado)] → [Match automático com clientes]
        → [Processo no sistema] → [Gerar peça] → [Advogado revisa e assina] → [Protocolo] → [Recibo]
```

**Roteamento pelo número CNJ** `NNNNNNN-DD.AAAA.J.TR.OOOO`:
- `J` = segmento da Justiça (1 STF, 2 CNJ, 3 STJ, 4 Federal, 5 Trabalho, 6 Eleitoral, 7 Militar União, 8 Estadual, 9 Militar Estadual)
- `TR` = tribunal dentro do segmento
- `OOOO` = unidade de origem

`J + TR` → identifica o tribunal → a tabela de tribunais (seção 3) diz qual sistema/adaptador usar.

---

## 2. Certificado e advogado

### 2.1 Advogado

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| nome_completo | str | S | Como consta na OAB |
| cpf | str(11) | S | Usado no login/MNI e na assinatura |
| email | str | S | Endereço eletrônico exigido na procuração (CPC 287) |
| telefone | str | N | |
| inscricoes_oab | lista | S | Ver 2.2 |
| sociedade_advogados_id | uuid | N | Se atua por sociedade |
| ativo | bool | S | |

### 2.2 Inscrição OAB

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| numero | str | S | Só dígitos |
| uf | enum(UF) | S | |
| tipo | enum | S | `principal`, `suplementar`, `estagiario` |
| letra_complementar | str | N | Algumas seccionais usam (ex.: "A", "E") |
| situacao | enum | N | `regular`, `suspensa`, `cancelada` (consultar CNA) |

### 2.3 Certificado digital

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| advogado_id | uuid | S | |
| tipo | enum | S | `A1` (arquivo .pfx/.p12) ou `A3` (token/cartão — exige agente local) |
| arquivo_ref | str | C | Referência no cofre (KMS/Secret Manager). **Nunca** salvar o .pfx em texto puro no banco |
| senha_ref | str | C | Referência ao segredo da senha no cofre |
| titular_nome | str | S | Extraído do certificado |
| titular_cpf | str | S | Extraído; deve bater com advogado.cpf |
| emissor_ac | str | S | Autoridade certificadora |
| numero_serie | str | S | |
| thumbprint_sha256 | str | S | Identificador único |
| valido_de | datetime | S | |
| valido_ate | datetime | S | Alertar 30/15/7 dias antes |
| revogado | bool | S | Checar LCR/OCSP periodicamente |
| agente_local_id | uuid | C | Obrigatório se A3 |
| escopo_autorizado | enum[] | S | `consulta`, `download`, `protocolo` |
| termo_consentimento_id | uuid | S | Ver 2.4 |
| criado_em / removido_em | datetime | S/N | Remoção = apagar do cofre |

### 2.4 Termo de consentimento (LGPD)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| advogado_id | uuid | S | |
| versao_termo | str | S | |
| escopos_aceitos | enum[] | S | Igual a escopo_autorizado |
| aceito_em | datetime | S | |
| ip / user_agent | str | S | Prova do aceite |
| revogado_em | datetime | N | Revogação dispara exclusão do certificado |

---

## 3. Cadastro de tribunais e sistemas

### 3.1 Tribunal

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| sigla | str | S | TJSP, TRT2, TRF3, STJ… |
| nome | str | S | |
| segmento_j | int | S | Dígito J do CNJ |
| codigo_tr | str(2) | S | Dígitos TR do CNJ |
| uf | enum(UF) | N | Nulo p/ tribunais nacionais |
| ramo | enum | S | `estadual`, `federal`, `trabalho`, `eleitoral`, `militar`, `superior` |

### 3.2 Instância de sistema (tribunal × grau × sistema)

Um tribunal pode ter vários sistemas ao mesmo tempo (ex.: TJSP com e-SAJ e eproc durante a migração).

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| tribunal_id | uuid | S | |
| grau | enum | S | `1g`, `2g`, `turma_recursal`, `superior` |
| sistema | enum | S | `pje`, `eproc`, `esaj`, `projudi`, `proprio` |
| versao_sistema | str | N | |
| url_portal | str | S | Login web |
| url_consulta_publica | str | N | |
| url_mni | str | N | Endpoint SOAP do MNI |
| versao_mni | str | N | Ex.: 2.2.2 |
| mni_consulta | bool | S | Aceita consultarProcesso |
| mni_peticionamento | bool | S | Aceita entregarManifestacaoProcessual |
| mni_inicial | bool | S | Aceita petição inicial via MNI |
| exige_credenciamento | bool | S | Advogado precisa se credenciar antes no sistema |
| autenticacao | enum[] | S | `certificado`, `usuario_senha`, `2fa` |
| tamanho_max_arquivo_mb | int | S | Varia por tribunal |
| tamanho_max_total_mb | int | N | |
| formatos_aceitos | str[] | S | Normalmente `application/pdf`; alguns aceitam mídia |
| exige_pdf_pesquisavel | bool | N | OCR / PDF-A |
| formato_assinatura | enum | S | `PAdES`, `CAdES`, `assinatura_no_portal` |
| adaptador | str | S | Nome da classe/módulo (ex.: `PjeAdapter`) |
| config_extra | json | N | Particularidades locais |
| data_inicio / data_fim | date | N | Para sistemas em migração (ex.: e-SAJ TJSP) |
| status_saude | enum | S | `ok`, `lento`, `fora`, `mudou_layout` |
| ultima_verificacao | datetime | S | |

### 3.3 Tabelas locais (cache das TPU por tribunal)

| Tabela | Campos | Uso |
|---|---|---|
| classe_processual | codigo_cnj, codigo_local, nome, grau, permite_inicial | Petição inicial |
| assunto | codigo_cnj, codigo_local, nome, pai_id | Petição inicial |
| tipo_documento | codigo_local, nome, sistema_id | Documentos da peça |
| tipo_peticao | codigo_local, nome, sistema_id | Intermediária |
| localidade / comarca | codigo_local, nome, uf, codigo_ibge | Competência |
| orgao_julgador | codigo_local, nome, localidade_id, competencias | Distribuição |
| competencia | codigo_local, nome | Inicial |

> Sincronizar periodicamente (TPU do CNJ + tabelas que cada sistema expõe).

---

## 4. Descoberta de processos (varredura pela OAB)

### 4.1 Varredura

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| advogado_id | uuid | S | |
| inscricoes_oab | lista | S | Todas as OABs (principal + suplementares) |
| fontes | enum[] | S | `djen`, `agregador`, `sistema_tribunal` |
| tribunais_alvo | uuid[] | N | Vazio = todos |
| status | enum | S | `pendente`, `rodando`, `concluida`, `parcial`, `erro` |
| iniciada_em / concluida_em | datetime | S/N | |
| total_encontrados | int | S | |
| resumo_por_tribunal | json | S | `{ "TJSP": 210, "TRT2": 80, ... }` |

### 4.2 Processo encontrado (pré-importação)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| varredura_id | uuid | S | |
| numero_cnj | str(20) | S | Só dígitos; chave de deduplicação |
| tribunal_id | uuid | S | Derivado do CNJ |
| sistema_provavel | enum | N | |
| fonte | enum | S | De onde veio |
| partes_resumo | str | N | Para exibir na tela de escolha |
| classe_resumo | str | N | |
| ultima_movimentacao_em | datetime | N | |
| segredo_justica | bool | N | |
| possivel_cliente_id | uuid | N | Pré-match (seção 9) |
| selecionado_para_importar | bool | S | Escolha do usuário |
| status_importacao | enum | S | `nao_importar`, `fila`, `importado`, `erro`, `sem_acesso` |

---

## 5. Processo (dados de capa)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| numero_cnj | str(20) | S | Único |
| numero_formatado | str | S | `NNNNNNN-DD.AAAA.J.TR.OOOO` |
| numeros_antigos | str[] | N | Numeração anterior / outro sistema |
| tribunal_id | uuid | S | |
| sistema_instancia_id | uuid | S | Sistema onde tramita **hoje** |
| grau | enum | S | |
| classe_codigo_cnj | int | S | TPU |
| classe_nome | str | S | |
| assuntos | lista | S | `[{codigo_cnj, nome, principal: bool}]` |
| competencia | str | N | |
| localidade_codigo | str | S | Comarca/seção/foro |
| orgao_julgador | str | S | Vara/câmara/turma |
| orgao_julgador_codigo | str | N | |
| magistrado | str | N | |
| valor_causa | dec | N | |
| data_ajuizamento | datetime | S | |
| nivel_sigilo | int | S | 0 = público; >0 = sigiloso |
| segredo_justica | bool | S | |
| justica_gratuita | bool | N | |
| prioridades | enum[] | N | `idoso`, `doenca_grave`, `pcd`, `crianca`, … |
| tutela_liminar_requerida | bool | N | |
| juizo_100_digital | bool | N | |
| situacao | enum | S | `ativo`, `suspenso`, `arquivado`, `baixado`, `extinto` |
| processo_principal_cnj | str | N | Para incidentes/apensos |
| processos_vinculados | str[] | N | Apensos, recursos, cumprimento |
| migrado_de_sistema | enum | N | Ex.: `esaj` → `eproc` |
| migrado_em | datetime | N | |
| hash_dados | str | S | Detectar mudanças entre sincronizações |
| ultima_sincronizacao | datetime | S | |
| origem_importacao | enum | S | `varredura`, `manual`, `protocolo_inicial` |
| responsavel_interno_id | uuid | N | Advogado responsável no escritório |
| status_interno | str | N | Campo do escritório |

---

## 6. Partes e representantes

### 6.1 Parte (no processo)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| processo_id | uuid | S | |
| polo | enum | S | `ativo`, `passivo`, `terceiro`, `fiscal_lei`, `vitima`, `testemunha`, `outro` |
| tipo_participacao | str | N | Autor, réu, exequente, reclamante, assistente… |
| pessoa_id | uuid | S | Ver 6.2 |
| assistencia_judiciaria | bool | N | |
| intimacao_pendente | bool | N | |
| relacionamento | str | N | Ex.: representado por, sucessor de |
| ordem | int | N | |

### 6.2 Pessoa

Usado tanto na importação quanto no cadastro de partes para a petição inicial (CPC 319, II).

| Campo | Tipo | Obr. (inicial) | Observação |
|---|---|---|---|
| id | uuid | S | |
| tipo_pessoa | enum | S | `fisica`, `juridica`, `autoridade`, `orgao_representacao` |
| nome | str | S | Razão social se PJ |
| nome_social | str | N | |
| nome_fantasia | str | N | PJ |
| cpf / cnpj | str | C | Obrigatório se conhecido; se desconhecido, justificar na peça (CPC 319 §1º) |
| documento_mascarado | bool | N | Tribunal só mostrou parcial |
| outros_documentos | lista | N | `[{tipo: RG/CNH/passaporte/CTPS/PIS, numero, emissor, uf}]` |
| sexo | enum | N | Exigido em alguns sistemas |
| data_nascimento | date | N | Usado para prioridade de idoso |
| nacionalidade | str | C | |
| naturalidade | str | N | |
| estado_civil | enum | C | Exigido pelo CPC 319 p/ PF |
| uniao_estavel | bool | C | CPC 319 |
| profissao | str | C | CPC 319 p/ PF |
| nome_mae / nome_pai | str | N | Alguns tribunais exigem p/ PF sem CPF |
| email | str | C | CPC 319 |
| telefones | str[] | N | |
| enderecos | lista | S | Ver 6.3 |
| representante_legal_id | uuid | N | Menor/incapaz/PJ |
| ente_publico | bool | N | Muda regras de citação/intimação |

### 6.3 Endereço

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| cep | str(8) | S | |
| logradouro | str | S | |
| numero | str | S | "S/N" se não houver |
| complemento | str | N | |
| bairro | str | S | |
| cidade | str | S | |
| codigo_ibge | str | N | Alguns sistemas pedem |
| uf | enum | S | |
| pais | str | S | Padrão "Brasil" |
| tipo | enum | N | `residencial`, `comercial`, `citacao` |

### 6.4 Advogado da parte (no processo)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| parte_id | uuid | S | |
| nome | str | S | |
| cpf | str | N | |
| oab_numero / oab_uf | str | S | |
| tipo_representante | enum | S | `advogado`, `procurador`, `defensor`, `escritorio` |
| recebe_intimacao | bool | N | |
| e_o_usuario | bool | S | Marca se é o advogado dono da conta |

---

## 7. Movimentações

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| processo_id | uuid | S | |
| data_hora | datetime | S | |
| codigo_nacional | int | N | Movimento TPU |
| codigo_local | str | N | |
| descricao | str | S | Texto exibido pelo tribunal |
| complementos | json | N | Complementos tabelados |
| nivel_sigilo | int | S | |
| documento_vinculado_id | uuid | N | |
| responsavel | str | N | Magistrado/servidor |
| e_intimacao | bool | N | |
| prazo_final | date | N | Calculado/informado |
| hash | str | S | Deduplicação entre sincronizações |
| lida_pelo_usuario | bool | S | Para alertas no sistema |

---

## 8. Documentos dos autos

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| processo_id | uuid | S | |
| id_documento_tribunal | str | S | Id no sistema de origem |
| id_documento_pai | str | N | Anexos de uma petição |
| tipo_documento_codigo | str | N | |
| tipo_documento_nome | str | S | Petição, sentença, despacho, procuração… |
| descricao | str | N | |
| data_hora_juntada | datetime | S | |
| movimentacao_id | uuid | N | |
| mimetype | str | S | |
| tamanho_bytes | int | S | |
| paginas | int | N | |
| hash_sha256 | str | S | Integridade/deduplicação |
| nivel_sigilo | int | S | |
| assinantes | lista | N | `[{nome, cpf, data_hora, certificado_serie}]` |
| storage_ref | str | S | Caminho no bucket (GCS) |
| texto_extraido_ref | str | N | OCR/texto p/ busca e IA |
| status_download | enum | S | `pendente`, `baixado`, `erro`, `sem_acesso` |

---

## 9. Vínculo com cliente

### 9.1 Regras de match

| Prioridade | Critério | Ação |
|---|---|---|
| 1 | CPF/CNPJ completo igual | **Vínculo automático** |
| 2 | CNPJ raiz (8 primeiros dígitos) igual | Sugerir (filial/matriz) |
| 3 | Nome normalizado idêntico + documento parcial compatível | Sugerir com confiança alta |
| 4 | Nome normalizado idêntico, sem documento | Sugerir — **exige confirmação** |
| 5 | Nome similar (fuzzy ≥ limiar) | Sugerir com confiança baixa |

**Normalização de nome:** maiúsculas, sem acento, sem pontuação, remover sufixos societários (LTDA, S/A, SA, ME, EPP, EIRELI), remover "DE/DA/DO/DOS/DAS", espaços múltiplos.

### 9.2 Vínculo

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| processo_id | uuid | S | |
| parte_id | uuid | S | Qual parte do processo é o cliente |
| cliente_id | uuid | S | Cadastro interno de cliente |
| criterio | enum | S | `cpf_cnpj`, `cnpj_raiz`, `nome_doc_parcial`, `nome_exato`, `nome_fuzzy`, `manual` |
| confianca | dec | S | 0–1 |
| status | enum | S | `automatico`, `sugerido`, `confirmado`, `rejeitado` |
| confirmado_por / em | uuid / datetime | N | |
| polo_cliente | enum | S | Copiado da parte (cliente é autor ou réu?) |

### 9.3 Cliente sem cadastro

Se a parte representada pelo advogado não bate com nenhum cliente → oferecer **"Criar cliente a partir da parte"**, pré-preenchendo os campos da seção 6.2.

---

## 10. Protocolo — petição inicial

### 10.1 Cabeçalho do processo novo

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | Rascunho interno |
| advogado_id | uuid | S | Quem assina |
| certificado_id | uuid | S | |
| tribunal_id | uuid | S | |
| sistema_instancia_id | uuid | S | |
| grau | enum | S | Normalmente 1g |
| localidade_codigo | str | S | Comarca/foro/seção judiciária |
| competencia_codigo | str | C | Exigido em vários PJe |
| orgao_julgador_codigo | str | C | Só quando há direcionamento (prevenção, juizado específico) |
| classe_codigo | str | S | Tabela local/TPU |
| assuntos | lista | S | `[{codigo, principal: bool}]` — ao menos 1 principal |
| valor_causa | dec | S | CPC 319, V |
| justica_gratuita_requerida | bool | S | Se sim, dispensa custas iniciais |
| prioridades | enum[] | N | Com documento comprobatório |
| tutela_urgencia | bool | S | Sinaliza "pedido de liminar" |
| segredo_justica_requerido | bool | S | |
| nivel_sigilo | int | S | |
| juizo_100_digital | bool | N | |
| audiencia_conciliacao | enum | S | `deseja`, `nao_deseja` (CPC 319, VII) |
| prevencao_processo_cnj | str | N | Distribuição por dependência |
| processo_referencia_cnj | str | N | Ex.: cumprimento de sentença, embargos |

### 10.2 Partes da inicial

Mesmos campos das seções 6.1–6.4. Mínimo:
- Polo ativo: ≥ 1 parte, com o advogado do usuário vinculado.
- Polo passivo: ≥ 1 parte (exceto procedimentos sem réu, ex.: jurisdição voluntária).
- Cada parte: nome + CPF/CNPJ (ou justificativa) + endereço completo.

### 10.3 Documentos da inicial

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| ordem | int | S | Petição principal = 1 |
| tipo_documento_codigo | str | S | Tabela local |
| descricao | str | S | Nome que aparecerá nos autos |
| arquivo_ref | str | S | PDF no storage |
| mimetype | str | S | |
| tamanho_bytes | int | S | Validar contra limite do tribunal |
| hash_sha256 | str | S | |
| nivel_sigilo | int | S | |
| assinado | bool | S | |
| formato_assinatura | enum | S | Conforme sistema |

**Documentos típicos obrigatórios/recomendados:**
- Petição inicial (principal)
- Procuração (com e-mail do advogado — CPC 287)
- Documento de identificação da parte
- Comprovante de endereço
- Declaração de hipossuficiência (se gratuidade)
- Guia de custas + comprovante de pagamento (se não gratuita)
- Documentos que comprovem a prioridade (se houver)
- Contrato social / atos constitutivos (se PJ)
- Documentos que fundamentam o pedido

### 10.4 Conteúdo da peça (para geração do documento)

Campos que o gerador de peças precisa (CPC 319):

| Campo | Observação |
|---|---|
| enderecamento | Juízo a que é dirigida |
| qualificacao_partes | Gerado das seções 6.2/6.3 |
| fatos | Texto |
| fundamentos_juridicos | Texto |
| pedidos | Lista |
| pedido_tutela | Texto, se tutela_urgencia |
| valor_causa_texto | Por extenso |
| provas | Lista de provas que pretende produzir |
| opcao_audiencia | Texto derivado de 10.1 |
| local_data | |
| assinatura | Nome + OAB/UF |

---

## 11. Protocolo — petição intermediária

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| processo_id | uuid | S | Deve existir e estar ativo |
| numero_cnj | str | S | |
| sistema_instancia_id | uuid | S | Sistema atual do processo (atenção à migração!) |
| advogado_id | uuid | S | Deve estar habilitado no processo |
| certificado_id | uuid | S | |
| tipo_peticao_codigo | str | S | Tabela local (manifestação, contestação, recurso…) |
| em_resposta_a_intimacao_id | str | N | Vincular à intimação = marca ciência/cumprimento |
| polo_peticionante | enum | S | |
| parte_ids | uuid[] | S | Em nome de quem peticiona |
| pedido_urgente | bool | N | |
| nivel_sigilo | int | S | |
| documentos | lista | S | Mesmos campos de 10.3 (principal + anexos) |
| custas_id | uuid | C | Recursos com preparo, por exemplo |
| prazo_final | date | N | Para alertar se protocolo está perto/fora do prazo |

> **Habilitação:** se o advogado não estiver nos autos, a primeira petição deve ser um pedido de habilitação com procuração.

---

## 12. Custas e guias

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| protocolo_id | uuid | S | Inicial ou intermediária |
| tribunal_id | uuid | S | |
| tipo_custa | enum | S | `inicial`, `preparo_recursal`, `porte_remessa`, `diligencia_oficial`, `mandato`, `outra` |
| tipo_guia | str | S | DARE (TJSP), GRU (federal), guia própria… |
| codigo_receita | str | C | |
| valor | dec | S | |
| base_calculo | dec | N | Normalmente valor da causa |
| numero_guia | str | S | |
| linha_digitavel / codigo_barras | str | N | |
| vencimento | date | S | |
| pagador_nome / documento | str | S | |
| status | enum | S | `gerada`, `paga`, `vinculada`, `vencida`, `isenta` |
| comprovante_ref | str | C | PDF do comprovante |
| pago_em | datetime | N | |

---

## 13. Retorno do protocolo

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| protocolo_id | uuid | S | |
| sucesso | bool | S | |
| numero_protocolo | str | C | Recibo do tribunal |
| data_hora_protocolo | datetime | C | **Prova de tempestividade** |
| numero_cnj_gerado | str | C | Só na inicial |
| orgao_julgador_distribuido | str | C | Só na inicial |
| tipo_distribuicao | enum | N | `sorteio`, `dependencia`, `prevencao` |
| recibo_ref | str | C | PDF/HTML do recibo |
| resposta_bruta_ref | str | S | XML/HTML integral guardado |
| hash_documentos_enviados | str[] | S | |
| mensagem_erro | str | C | |
| codigo_erro | str | C | |
| tentativa | int | S | |

---

## 14. Jobs, fila e auditoria

### 14.1 Job

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| tipo | enum | S | `varredura`, `importar_processo`, `sincronizar`, `baixar_documentos`, `protocolar`, `sincronizar_tabelas`, `health_check` |
| tribunal_id | uuid | N | Fila separada por tribunal |
| referencia_id | uuid | S | Processo/protocolo/varredura |
| prioridade | int | S | Protocolo > sincronização > download |
| status | enum | S | `fila`, `rodando`, `ok`, `erro`, `reprocessar`, `cancelado` |
| tentativas / max_tentativas | int | S | |
| proxima_tentativa_em | datetime | N | Backoff exponencial |
| erro | str | N | |
| iniciado_em / concluido_em | datetime | N | |

> **Protocolo nunca é reenviado automaticamente** sem antes consultar se o primeiro envio entrou (evita protocolo duplicado).

### 14.2 Auditoria de uso do certificado

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| certificado_id | uuid | S | |
| acao | enum | S | `login`, `consulta`, `download`, `assinatura`, `protocolo` |
| tribunal_id | uuid | S | |
| referencia | str | S | Nº CNJ / id protocolo |
| usuario_disparou_id | uuid | N | Nulo = job automático |
| aprovacao_humana_id | uuid | C | **Obrigatório para assinatura/protocolo** |
| data_hora | datetime | S | |
| ip_origem | str | S | |
| resultado | enum | S | |

### 14.3 Aprovação humana (protocolo)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| protocolo_id | uuid | S | |
| advogado_id | uuid | S | Tem que ser o titular do certificado |
| hash_conteudo_aprovado | str | S | Se o conteúdo mudar depois, invalida |
| aprovado_em | datetime | S | |
| ip / user_agent | str | S | |

---

## 15. Tabelas de domínio (enums)

| Enum | Valores |
|---|---|
| sistema | `pje`, `eproc`, `esaj`, `projudi`, `proprio` |
| grau | `1g`, `2g`, `turma_recursal`, `superior` |
| polo | `ativo`, `passivo`, `terceiro`, `fiscal_lei`, `vitima`, `testemunha`, `outro` |
| tipo_pessoa | `fisica`, `juridica`, `autoridade`, `orgao_representacao` |
| estado_civil | `solteiro`, `casado`, `divorciado`, `separado`, `viuvo`, `nao_informado` |
| prioridade | `idoso`, `idoso_80`, `doenca_grave`, `pcd`, `crianca_adolescente`, `violencia_domestica`, `outra` |
| nivel_sigilo | 0 público … 5 (conforme MNI) |
| situacao_processo | `ativo`, `suspenso`, `arquivado`, `baixado`, `extinto` |
| status_saude | `ok`, `lento`, `fora`, `mudou_layout` |

---

## 16. Regras e validações importantes

1. **Roteamento pelo CNJ + data:** antes de qualquer ação, confirmar em qual sistema o processo está **hoje** (TJSP em migração e-SAJ → eproc).
2. **Deduplicação:** chave = `numero_cnj` (só dígitos). Mesmo processo pode vir de várias fontes.
3. **Certificado:** validar titular = advogado, validade e revogação antes de cada uso. A3 só via agente local.
4. **Protocolo exige aprovação humana** registrada (seção 14.3). Robô nunca assina sozinho.
5. **Arquivos:** validar tamanho, formato e assinatura contra `sistema_instancia` **antes** de tentar enviar.
6. **Custas:** inicial não-gratuita só sobe com guia `paga` ou `vinculada`.
7. **Prazo:** bloquear/avisar fortemente protocolo após `prazo_final`.
8. **Sigilo:** documentos e processos com `nivel_sigilo > 0` só visíveis para usuários autorizados no escritório.
9. **Idempotência:** em erro de rede no protocolo, consultar o processo/recibo antes de reenviar.
10. **Rate limit por tribunal:** intervalo mínimo entre requisições e janela de horário configuráveis.
11. **Guardar tudo:** resposta bruta do tribunal + recibo + hashes = defesa do advogado em discussão de tempestividade.
12. **Tabelas locais:** classes, assuntos e tipos de documento variam por tribunal — nunca hardcodar códigos.

---

## 17. Notificação por e-mail do protocolo

**Gatilho:** criação de um registro em `retorno_protocolo` (seção 13).
- `sucesso = true` → evento `protocolo_sucesso`
- `sucesso = false` → evento `protocolo_falha`

O envio é **assíncrono** (job na fila), então nunca trava nem desfaz o protocolo.

### 17.1 Configuração de notificação (por escritório)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| escritorio_id | uuid | S | |
| evento | enum | S | `protocolo_sucesso`, `protocolo_falha`, `protocolo_inicial_distribuido`, `protocolo_intermediaria` |
| ativo | bool | S | Padrão: `true` para sucesso e falha |
| notificar_responsavel_caso | bool | S | Padrão `true` → `processo.responsavel_interno_id` |
| notificar_quem_protocolou | bool | S | Padrão `true` (se for outra pessoa que não o responsável) |
| notificar_titular_certificado | bool | S | Padrão `false` |
| destinatarios_fixos | str[] | N | Ex.: controladoria@escritorio.com.br |
| copia_oculta | str[] | N | |
| anexar_recibo | bool | S | Padrão `true` |
| anexar_peca_principal | bool | S | Padrão `false` (sigilo/tamanho) |
| template_id | uuid | S | Ver 17.3 |
| respeitar_sigilo | bool | S | Padrão `true`: processo sigiloso → e-mail sem nomes das partes e sem anexos |

### 17.2 Preferência individual (por advogado)

Sobrepõe a configuração do escritório para aquela pessoa.

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| usuario_id | uuid | S | |
| evento | enum | S | |
| receber | bool | S | Advogado pode desligar o aviso de sucesso; **falha não pode ser desligada** |
| email_alternativo | str | N | Se quiser receber em outro e-mail |

### 17.3 Template de e-mail

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| evento | enum | S | |
| assunto | str | S | Aceita variáveis |
| corpo_html | str | S | Aceita variáveis |
| corpo_texto | str | S | Versão texto puro |

**Variáveis disponíveis:**

| Variável | Origem |
|---|---|
| `{{advogado_responsavel_nome}}` | processo.responsavel_interno_id |
| `{{protocolado_por_nome}}` | aprovacao_humana.advogado_id |
| `{{cliente_nome}}` | vínculo (seção 9) |
| `{{numero_cnj}}` | processo / retorno (gerado, na inicial) |
| `{{numero_protocolo}}` | retorno_protocolo |
| `{{data_hora_protocolo}}` | retorno_protocolo (formato `dd/mm/aaaa HH:MM`) |
| `{{tribunal_sigla}}` / `{{sistema}}` | tribunal / sistema_instancia |
| `{{orgao_julgador}}` | retorno (inicial) ou processo |
| `{{classe}}` / `{{tipo_peticao}}` | protocolo |
| `{{partes_resumo}}` | "Autor x Réu" (omitido se sigiloso) |
| `{{valor_causa}}` | inicial |
| `{{prazo_final}}` | intermediária, se houver |
| `{{mensagem_erro}}` | só em falha |
| `{{link_processo}}` | link interno do sistema |

**Template padrão — sucesso:**

> **Assunto:** ✅ Protocolo realizado — {{numero_cnj}} ({{tribunal_sigla}})
>
> Olá, {{advogado_responsavel_nome}}.
>
> A petição **{{tipo_peticao}}** foi protocolada com sucesso.
> - Processo: {{numero_cnj}}
> - Cliente: {{cliente_nome}}
> - Tribunal: {{tribunal_sigla}} ({{sistema}})
> - Órgão: {{orgao_julgador}}
> - Protocolo nº: {{numero_protocolo}}
> - Data/hora: {{data_hora_protocolo}}
> - Protocolado por: {{protocolado_por_nome}}
>
> O recibo segue em anexo. [Abrir processo]({{link_processo}})

**Template padrão — falha:**

> **Assunto:** ⚠️ Falha no protocolo — {{numero_cnj}} ({{tribunal_sigla}})
>
> Olá, {{advogado_responsavel_nome}}.
>
> **A petição NÃO foi protocolada.**
> - Processo: {{numero_cnj}}
> - Tentativa em: {{data_hora_protocolo}}
> - Erro retornado: {{mensagem_erro}}
> - Prazo final: {{prazo_final}}
>
> Verifique e reenvie. [Abrir processo]({{link_processo}})

### 17.4 Log de envio

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| retorno_protocolo_id | uuid | S | |
| evento | enum | S | |
| destinatario | str | S | Um registro por destinatário |
| papel_destinatario | enum | S | `responsavel_caso`, `quem_protocolou`, `titular_certificado`, `fixo` |
| assunto_renderizado | str | S | |
| anexos | str[] | N | Refs dos arquivos anexados |
| provedor | str | S | SendGrid, SES, SMTP… |
| id_mensagem_provedor | str | N | |
| status | enum | S | `fila`, `enviado`, `entregue`, `aberto`, `bounce`, `erro` |
| tentativas | int | S | Até 5, backoff exponencial |
| erro | str | N | |
| enviado_em | datetime | N | |

### 17.5 Regras

1. **Responsável do caso sem e-mail ou não definido** → enviar para quem protocolou e marcar alerta no processo ("caso sem responsável").
2. **Mesmo destinatário em mais de um papel** → enviar um e-mail só (deduplicar por endereço).
3. **Falha no protocolo** sempre notifica, independente de preferência individual, e também gera alerta dentro do sistema.
4. **Falha com prazo vencendo hoje** → assunto com prefixo `[URGENTE]` e notificação também para os destinatários fixos.
5. **Bounce** no e-mail do responsável → alerta no sistema para o administrador do escritório corrigir o cadastro.
6. **Recibo maior que o limite do provedor** → em vez de anexar, enviar link autenticado com expiração.
7. **Idempotência:** chave `retorno_protocolo_id + destinatario + evento` — nunca enviar o mesmo aviso duas vezes.

---

## 18. Cobrança e medição de uso

**Modelo:** franquia mensal de protocolos incluída no plano + excedente por unidade com desconto progressivo. Petição inicial consome mais créditos que intermediária. **Só conta protocolo com sucesso.** Varredura/importação cobrada como setup (uma vez).

> Valores abaixo são parâmetros configuráveis — definir após calcular custo real por protocolo (infra + API agregadora + manutenção de adaptadores).

### 18.1 Plano

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| nome | str | S | Básico, Profissional, Escritório… |
| preco_mensal | dec | S | |
| creditos_protocolo_mes | int | S | Franquia (ex.: 30, 150) |
| creditos_acumulam | bool | S | Padrão `false` (zera no ciclo) |
| permite_excedente | bool | S | Se `false`, bloqueia ao esgotar |
| limite_excedente_mes | int | N | Teto de segurança |
| limite_processos_monitorados | int | N | |
| limite_certificados | int | N | Nº de advogados com certificado |
| ativo | bool | S | |

### 18.2 Peso por tipo de protocolo

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| tipo_protocolo | enum | S | `intermediaria`, `inicial`, `habilitacao`, `recurso` |
| creditos | int | S | Ex.: intermediária = 1, habilitação = 1, recurso = 2, inicial = 4 |

### 18.3 Faixas de excedente

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| plano_id | uuid | S | |
| de_creditos / ate_creditos | int | S | Faixa de consumo excedente no mês |
| preco_por_credito | dec | S | Cai conforme a faixa sobe |

### 18.4 Setup de importação

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| de_processos / ate_processos | int | S | Faixa de processos importados |
| preco | dec | S | Cobrança única |
| inclui_download_autos | bool | S | |
| reimportacao_gratis_dias | int | N | Janela para reprocessar sem custo |

### 18.5 Lançamento de consumo (ledger)

| Campo | Tipo | Obr. | Observação |
|---|---|---|---|
| id | uuid | S | |
| escritorio_id | uuid | S | |
| ciclo | str | S | `AAAA-MM` |
| origem | enum | S | `protocolo`, `importacao`, `ajuste`, `estorno` |
| referencia_id | uuid | S | retorno_protocolo / varredura |
| creditos | int | S | Negativo em estorno |
| dentro_franquia | bool | S | |
| valor | dec | S | 0 se dentro da franquia |
| criado_em | datetime | S | |

### 18.6 Regras

1. Lançamento criado **somente** quando `retorno_protocolo.sucesso = true`.
2. Idempotência: um lançamento por `retorno_protocolo_id`.
3. Protocolo que falhou por erro do sistema e foi reenviado com sucesso conta **uma vez**.
4. Alerta ao escritório em 80% e 100% da franquia.
5. `permite_excedente = false` → bloquear novos protocolos com aviso claro (nunca bloquear no meio de um envio).
6. Fechamento do ciclo gera fatura: mensalidade + excedente + setups do mês.
7. Estorno manual exige motivo e usuário admin (auditoria).

---

## Pendências para validar por tribunal

- [ ] Endpoint MNI e versão (consulta e peticionamento)
- [ ] Exige credenciamento prévio do advogado?
- [ ] Inicial aceita via MNI ou só pelo portal?
- [ ] Limites de arquivo (por arquivo e total)
- [ ] Formato de assinatura aceito
- [ ] Tipo de guia de custas e forma de vinculação
- [ ] Campos extras obrigatórios no cadastro de partes (sexo, filiação, IBGE…)
