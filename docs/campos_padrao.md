# Campos padrão por tipo de caso

Gerado do código por `uv run python -m app.modules.faturamento.doc_campos` (não edite à mão). Os nomes são os da API (`CasoIn` / `CasoOut`); as listas marcadas como “Lista” são editadas pelo escritório em Configurações › Faturamento.

## Campos comuns (todo caso)

| Campo | Tipo | Obrigatório | Opções / de onde vem |
|---|---|---|---|
| `titulo` | texto | sim (ou o modelo de título do cliente) |  |
| `descricao` | texto |  |  |
| `numero_processo` | texto |  |  |
| `parte_contraria` | texto |  |  |
| `tipo` | opção |  | Calculado: consultivo, administrativo ou judicial estadual/federal/trabalhista (pela justiça) |
| `area_id` | escolha |  | Área de atuação (Configurações › Faturamento) |
| `polo` | opção |  | ativo, passivo, terceiro (no contencioso vem das partes) |
| `instancia` | opção |  | 1ª instância, Juizado Especial, 2ª instância (Tribunal), Turma Recursal, Tribunal Superior, STF |
| `tribunal` | texto |  |  |
| `vara` | texto |  |  |
| `comarca` | texto |  |  |
| `valor_causa` | valor |  |  |
| `data_distribuicao` | data |  |  |
| `campos` | campos |  | Campos adicionais do escritório (Configurações › Faturamento) |
| `responsavel_id` | escolha |  | Profissional do escritório |
| `tabela_preco_id` | escolha |  | Tabela de preço |
| `status` | opção |  | Ativo, Suspenso, Arquivado, Encerrado |
| `data_abertura` | data |  |  |
| `data_encerramento` | data | quando encerrado |  |
| `tipo_caso` | opção | sim (deduzido em chamadas antigas) | Contencioso, Consultivo, Administrativo |
| `equipe_ids` | várias escolhas |  | Profissionais do escritório |
| `etiqueta_ids` | várias escolhas |  | Lista “Etiquetas” |
| `motivo_encerramento_id` | escolha |  | Lista “Motivos de encerramento” |
| `origem_id` | escolha |  | Lista “Origem da captação” |
| `centro_custo_id` | escolha |  | Lista “Centros de custo” |
| `valor_estimado` | valor |  |  |
| `caso_pai_id` | escolha |  | Outro caso |
| `tipo_vinculo` | opção |  | Recurso, Incidente, Apenso, Desdobramento, Conexo, Judicialização |
| `sigiloso` | sim/não |  |  |
| `observacoes` | texto |  |  |

O cliente do caso vem do contrato e entra sozinho entre as partes. A cobrança (forma, valor, êxito) é a regra de cobrança do caso ou do contrato, não um campo do caso.

## Contencioso (bloco `contencioso`)

Número do processo (CNJ), tribunal, vara, comarca, instância, valor da causa, data de distribuição e polo são os campos comuns acima. Com um número CNJ válido, justiça, tribunal, órgão e UF são preenchidos sozinhos.

| Campo | Tipo | Obrigatório | Opções / de onde vem |
|---|---|---|---|
| `pre_ajuizamento` | sim/não |  |  |
| `numero_antigo` | texto |  |  |
| `justica` | opção |  | Justiça Estadual, Justiça Federal, Justiça do Trabalho, Justiça Eleitoral, Justiça Militar da União, Justiça Militar Estadual, STF, STJ, TST, TSE, STM, CNJ |
| `uf` | texto |  |  |
| `codigo_orgao` | texto |  |  |
| `juiz_relator` | texto |  |  |
| `sistema_tribunal` | opção |  | PJe, e-SAJ, eproc, Projudi, Tucujuris, SEEU, Físico, Outro |
| `classe_id` | escolha |  | Lista “Classes processuais” |
| `assunto_id` | escolha |  | Lista “Assuntos” |
| `assuntos_secundarios_ids` | várias escolhas |  | Lista “Assuntos” |
| `rito` | opção |  | Comum, Sumário, Sumaríssimo, Especial, Juizado, Execução |
| `fase_processual` | opção |  | Pré-ajuizamento, Conhecimento, Instrução, Sentenciado, Recursal, Cumprimento de sentença, Execução, Acordo em cumprimento, Suspenso, Arquivado provisoriamente, Encerrado |
| `data_citacao` | data |  |  |
| `data_transito_julgado` | data |  |  |
| `valor_condenacao` | valor |  |  |
| `valor_acordo` | valor |  |  |
| `prognostico` | opção |  | Provável, Possível, Remoto |
| `valor_provisionado` | valor |  |  |
| `valor_risco` | valor |  |  |
| `deposito_judicial` | valor |  |  |
| `justica_gratuita` | sim/não |  |  |
| `segredo_justica` | sim/não |  |  |
| `tutela_liminar` | opção |  | Não requerida, Requerida, Deferida, Indeferida, Revogada |
| `resultado` | opção |  | Procedente, Parcialmente procedente, Improcedente, Acordo, Extinto sem resolução do mérito, Desistência |
| `monitorar_andamentos` | sim/não |  |  |

## Consultivo (bloco `consultivo`)

| Campo | Tipo | Obrigatório | Opções / de onde vem |
|---|---|---|---|
| `tipo_demanda_id` | escolha | sim | Lista “Tipos de demanda” |
| `solicitante_id` | escolha |  | Pessoa do cadastro único |
| `departamento_solicitante` | texto |  |  |
| `data_solicitacao` | data |  |  |
| `prazo_entrega` | data |  |  |
| `sla_dias` | número |  |  |
| `prioridade` | opção |  | Baixa, Média, Alta, Urgente |
| `complexidade` | opção |  | Baixa, Média, Alta |
| `etapa` | opção |  | Recebido, Em análise, Aguardando o cliente, Aguardando terceiro, Em elaboração, Em revisão, Entregue, Em negociação, Concluído, Cancelado |
| `horas_estimadas` | valor |  |  |
| `valor_envolvido` | valor |  |  |
| `contrato_vigencia_inicio` | data |  |  |
| `contrato_vigencia_fim` | data |  |  |
| `renovacao_automatica` | sim/não |  |  |
| `data_entrega` | data | quando a etapa é entregue ou concluído |  |
| `documento_entregue_id` | escolha |  | Anexo do caso |
| `risco_identificado` | opção |  | Baixo, Médio, Alto, Crítico |
| `recomendacao_resumo` | texto |  |  |
| `gerou_contencioso_id` | escolha |  | Outro caso |

## Administrativo (bloco `administrativo`)

| Campo | Tipo | Obrigatório | Opções / de onde vem |
|---|---|---|---|
| `esfera` | opção | sim | Federal, Estadual, Municipal, Distrital |
| `orgao_id` | escolha | sim | Lista “Órgãos” |
| `unidade_orgao` | texto |  |  |
| `uf` | texto |  |  |
| `municipio` | texto |  |  |
| `tipo_procedimento_id` | escolha | sim | Lista “Tipos de procedimento” |
| `numero_processo_adm` | texto | este ou o protocolo, depois do pré-protocolo |  |
| `numero_protocolo` | texto |  |  |
| `numero_auto_infracao` | texto |  |  |
| `numero_nb` | texto |  |  |
| `instancia_adm` | opção |  | 1ª instância, 2ª instância, Especial / superior, Única |
| `fase_adm` | opção |  | Pré-protocolo, Protocolado, Em análise, Exigência, Defesa apresentada, Aguardando julgamento, Decidido, Em recurso, Definitivo, Encerrado |
| `data_ciencia` | data |  |  |
| `prazo_defesa` | data |  |  |
| `data_protocolo` | data |  |  |
| `valor_autuado` | valor |  |  |
| `valor_multa` | valor |  |  |
| `valor_juros` | valor |  |  |
| `valor_atualizado` | valor |  |  |
| `data_atualizacao_valor` | data |  |  |
| `exigibilidade_suspensa` | sim/não |  |  |
| `garantia` | opção |  | Nenhuma, Depósito, Seguro garantia, Fiança, Arrolamento |
| `prognostico` | opção |  | Provável, Possível, Remoto |
| `decisao` | opção |  | Favorável, Parcialmente favorável, Desfavorável, Anulado, Arquivado |
| `data_decisao` | data | quando há decisão |  |
| `cabe_judicializacao` | sim/não |  |  |
| `prazo_judicializacao` | data |  |  |
| `caso_judicial_id` | escolha |  | Outro caso |
| `link_sistema_orgao` | texto |  |  |

## Listas configuráveis e os valores que vêm prontos

- **Motivos de encerramento** (`motivo_encerramento`): Êxito; Acordo; Improcedência; Desistência; Perda de objeto; Entregue (consultivo); Revogação de mandato; Outros
- **Origem da captação** (`origem`): Indicação; Site; Cliente recorrente; Parceiro; Outros
- **Centros de custo** (`centro_custo`): (começa vazia: o escritório cria os seus)
- **Etiquetas** (`etiqueta`): (começa vazia: o escritório cria os seus)
- **Classes processuais** (`classe`, contencioso): Procedimento Comum Cível; Execução de Título Extrajudicial; Cumprimento de Sentença; Mandado de Segurança; Ação Trabalhista - Rito Ordinário; Ação Trabalhista - Rito Sumaríssimo; Procedimento do Juizado Especial Cível; Embargos à Execução; Monitória; Busca e Apreensão; Despejo; Inventário; Divórcio; Alimentos; Recuperação Judicial; Falência; Execução Fiscal; Embargos de Terceiro; Ação Civil Pública; Tutela Cautelar Antecedente; Agravo de Instrumento; Apelação; Recurso Ordinário; Recurso Inominado; Recurso de Revista; Recurso Especial; Recurso Extraordinário; Ação Penal - Procedimento Ordinário; Habeas Corpus
- **Assuntos** (`assunto`, contencioso): Indenização por Dano Moral; Indenização por Dano Material; Inadimplemento; Rescisão do contrato; Cobrança; Contratos Bancários; Cédula de Crédito Bancário; Práticas Abusivas; Inclusão Indevida em Cadastro de Inadimplentes; Despesas Condominiais; Locação de Imóvel; Compra e Venda; Planos de Saúde; Acidente de Trânsito; Responsabilidade Civil; Alimentos; Guarda; Dissolução; Inventário e Partilha; Verbas Rescisórias; Horas Extras; Reconhecimento de Relação de Emprego; Adicional de Insalubridade; Rescisão Indireta; FGTS; Aposentadoria por Tempo de Contribuição; Auxílio por Incapacidade Temporária; Benefício Assistencial (LOAS); ICMS; ISS; IRPJ; Contribuições Previdenciárias; Dívida Ativa; Recuperação judicial e Falência; Marca; Proteção de Dados Pessoais (LGPD)
- **Tipos de demanda** (`tipo_demanda`, consultivo): Parecer; Elaboração de contrato; Revisão de contrato; Due diligence; Opinião legal; Compliance/Programa de integridade; LGPD/Privacidade; Societário (alteração, constituição, acordo de sócios); Planejamento tributário; Planejamento sucessório; Notificação extrajudicial; Negociação; Reunião/Consulta; Registro de marca/PI; Regularização imobiliária; Outros
- **Órgãos** (`orgao`, administrativo): Receita Federal; PGFN; CARF; INSS/CRPS; Ministério do Trabalho (SRTE); SEFAZ; TIT/SP; Prefeitura (ISS/IPTU); PROCON; Senacon; ANATEL; ANS; ANVISA; ANEEL; ANTT; ANP; ANAC; BACEN; CVM; SUSEP; CADE; IBAMA; CETESB/órgão ambiental estadual; DETRAN; Junta Comercial; INPI; Tribunal de Contas (TCU/TCE/TCM); Corregedoria; OAB (TED); Conselhos profissionais; Polícia Federal (imigração/armas); Cartórios; Outros
- **Tipos de procedimento** (`tipo_procedimento`, administrativo): Defesa de auto de infração; Impugnação; Recurso voluntário; Recurso especial (CARF); Manifestação de inconformidade; Pedido de restituição/compensação; Consulta fiscal; Parcelamento/transação; Requerimento de benefício (INSS); Recurso CRPS; Reclamação PROCON; Processo administrativo disciplinar (PAD); Sindicância; Licitação/impugnação de edital; Recurso em licitação; Licenciamento (ambiental/sanitário); Registro/autorização; Processo sancionador (agência reguladora); Ato de concentração (CADE); Tomada de contas; Outros
- **Áreas de atuação**: Cível; Trabalhista; Tributário; Previdenciário; Família; Consumidor; Empresarial/Societário; Criminal; Administrativo; Ambiental; Imobiliário; Bancário; Contratual; Digital/LGPD; Regulatório; Securitário; Eleitoral; Outros

## Partes do caso: categorias e qualificações

As categorias são fixas por tipo de caso. As qualificações vêm prontas e o escritório pode acrescentar as suas.

### Contencioso

| Categoria | Polo | Qualificações |
|---|---|---|
| Polo Ativo | Ativo | Autor, Requerente, Reclamante, Exequente, Impetrante, Embargante, Apelante, Agravante, Recorrente, Querelante, Denunciante (penal), Assistente de Acusação, Litisconsorte Ativo, Credor, Alimentando, Inventariante, Promovente, Suscitante, Oponente |
| Polo Passivo | Passivo | Réu, Requerido, Reclamado, Executado, Impetrado (autoridade coatora), Embargado, Apelado, Agravado, Recorrido, Querelado, Denunciado/Acusado, Investigado, Litisconsorte Passivo, Devedor, Alimentante, Promovido, Suscitado, Oposto, Responsável Subsidiário/Solidário (trabalhista) |
| Terceiros | Neutro | Terceiro Interessado, Assistente Simples, Assistente Litisconsorcial, Denunciado à Lide, Chamado ao Processo, Opoente, Amicus Curiae, Terceiro Embargante, Arrematante, Credor Habilitado, Administrador Judicial, Interveniente |
| Outros | Neutro | Ministério Público (fiscal da ordem jurídica), Defensoria Pública, Perito Judicial, Assistente Técnico, Testemunha, Informante, Preposto, Curador Especial, Tutor/Curador, Representante Legal, Leiloeiro, Depositário, Intérprete/Tradutor, Mediador/Conciliador, Correspondente |

### Consultivo

| Categoria | Polo | Qualificações |
|---|---|---|
| Cliente / Solicitante | Ativo | Cliente, Contratante, Solicitante, Consulente, Sócio/Acionista, Administrador, Empresa do Grupo, Beneficiário |
| Contraparte | Passivo | Contraparte, Contratado, Fornecedor, Locador, Locatário, Comprador, Vendedor, Cedente, Cessionário, Investidor, Empresa-alvo (M&A/Due diligence), Licenciante, Licenciado, Notificado |
| Intervenientes | Neutro | Interveniente Anuente, Fiador/Avalista, Garantidor, Cônjuge Anuente, Testemunha Contratual, Agente Fiduciário, Escrow Agent |
| Outros | Neutro | Assessor Externo, Contador, Auditor, Consultor Técnico, Corretor, Cartório/Tabelião, Órgão de Registro, Advogado da Contraparte, Parecerista Externo |

### Administrativo

| Categoria | Polo | Qualificações |
|---|---|---|
| Interessado / Requerente | Ativo | Interessado, Requerente, Autuado, Contribuinte, Impugnante, Recorrente, Segurado/Beneficiário, Licitante, Reclamante (PROCON), Representante (denúncia), Servidor Processado (PAD), Requerente de Licença |
| Órgão / Autoridade | Passivo | Órgão Público, Autoridade Autuante, Autoridade Julgadora, Fazenda Pública, Agência Reguladora, Comissão de Licitação/Agente de Contratação, Comissão Processante, Recorrido |
| Terceiros Interessados | Neutro | Terceiro Interessado, Concorrente, Licitante Concorrente, Reclamado (PROCON), Representado, Responsável Solidário, Coobrigado |
| Outros | Neutro | Fiscal/Auditor, Perito, Assistente Técnico, Testemunha, Relator/Conselheiro, Procurador do Órgão, Ministério Público de Contas, Preposto, Contador |

Campos de cada parte: pessoa (cadastro único), categoria, qualificação, é cliente, principal, representado por, data de inclusão, data de exclusão, observações e advogados (advogado, OAB, principal, tipo de habilitação: Procuração, Substabelecimento com reserva, Substabelecimento sem reserva, Defensor público, Dativo, Procurador público, datas de habilitação e desabilitação, procuração).

## Pessoas (Cadastros › Pessoas)

| Campo | Tipo | Opções |
|---|---|---|
| `tipo_pessoa` | opção | Pessoa física, Pessoa jurídica, Ente público, Estrangeiro, Sem documento, Autoridade, Órgão de representação |
| `nome` | texto |  |
| `nome_social` | texto |  |
| `nome_fantasia` | texto |  |
| `cpf_cnpj` | texto |  |
| `documento_estrangeiro` | texto |  |
| `rg` | texto |  |
| `rg_orgao_emissor` | texto |  |
| `rg_uf` | texto |  |
| `data_nascimento` | data |  |
| `data_fundacao` | data |  |
| `nacionalidade` | texto |  |
| `estado_civil` | opção | Solteiro(a), Casado(a), Divorciado(a), Viúvo(a), Separado(a), União estável |
| `regime_bens` | opção | Comunhão parcial, Comunhão universal, Separação total, Separação obrigatória, Participação final nos aquestos |
| `profissao` | texto |  |
| `nome_mae` | texto |  |
| `pis_nit` | texto |  |
| `ctps` | texto |  |
| `inscricao_estadual` | texto |  |
| `inscricao_municipal` | texto |  |
| `cnae_principal` | texto |  |
| `representante_legal_id` | escolha |  |
| `email` | texto |  |
| `telefones` | lista |  |
| `observacoes` | texto |  |
| `consentimento_lgpd` | sim/não |  |
| `base_legal_lgpd` | texto |  |
| `ativo` | sim/não |  |

- Endereços (vários): tipo (Residencial, Comercial, Correspondência, Citação), CEP, logradouro, número, complemento, bairro, cidade, código IBGE, UF, país, principal.
- Contatos (vários): tipo (E-mail, Celular, WhatsApp, Telefone, Site), valor, descrição, principal, aceita comunicação.
- Advogado (quando a pessoa é advogado): sociedade, advogado do escritório (usuário), e-mail e telefone profissionais e inscrições na OAB (número, UF, tipo: Principal, Suplementar, Estagiário, Provisória; situação: Regular, Suspensa, Cancelada, Licenciada).
- A pessoa de um cliente traz o código do cliente (`cliente_id`); nome, CPF/CNPJ e tipo dela são os do cadastro de clientes.
