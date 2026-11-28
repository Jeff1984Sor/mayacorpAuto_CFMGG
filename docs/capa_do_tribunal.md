# Capa do tribunal: o que preenche a ficha e as partes do caso

Vale só para caso **contencioso** com a opção "buscar andamentos no tribunal" ligada. Código:
`backend/app/modules/faturamento/partes_tribunal.py` (ficha e partes) e `backend/app/modules/tribunais/caso.py` (capa).
Testes: `backend/tests/test_partes_tribunal.py`.

## De onde vem cada dado

Só entra o que a fonte devolve. Nada é deduzido além do que está na tabela.

| Fonte | Quando é usada | O que devolve |
|---|---|---|
| **DataJud** (público, pelo número) | Sempre | Classe e assuntos (código CNJ e nome), órgão julgador (nome, código e município IBGE), sistema (PJe, e-SAJ, eproc, Projudi), grau, data de ajuizamento, nível de sigilo, movimentos. **Não traz partes, valor da causa, juiz nem justiça gratuita.** |
| **DJEN** (diário, público; só responde a IP do Brasil, por isso depende do proxy configurado na plataforma) | Quando o proxy está configurado | Nome e polo (ativo, passivo, outro) de quem foi intimado e uma **lista única** de advogados (nome, OAB e UF). **Não traz documento, tipo de participação nem diz qual advogado representa qual parte.** |
| **MNI** (consulta com o certificado do advogado, modo Real, tribunal com o serviço liberado) | Na importação e ao baixar os autos | Partes com polo, CPF/CNPJ (ou mascarado), endereço, assistência judiciária e os advogados **de cada parte** (nome, CPF, OAB, tipo de representante, se recebe intimação); valor da causa, magistrado, competência, prioridades. A leitura do MNI feita hoje traz o polo, não o tipo de participação (autor, réu...). |
| **Número CNJ** | Sempre | Justiça (dígito J), tribunal, UF do tribunal e código do órgão (OOOO). |

Consequência: com as fontes públicas, as partes entram no polo certo, sem documento e sem qualificação, e só o
advogado do próprio escritório é ligado a uma parte (o cliente). Juiz, valor da causa e justiça gratuita só aparecem
quando o processo foi consultado com certificado.

## `GET /api/tribunais/capa?numero=&contrato_id=` (consulta; nada é gravado)

Tudo o que já devolvia continua igual (`classe` e `assuntos` seguem como textos; `partes` segue com `nome` e `polo`).
A mais:

| Campo | Conteúdo |
|---|---|
| `justica`, `justica_nome` | Pelo número CNJ (ex.: `trabalho`, "Justiça do Trabalho"). |
| `uf` | UF do tribunal; em TRF (várias UFs), a do município do órgão julgador quando o DataJud manda o código IBGE; senão `null`. |
| `codigo_orgao` | OOOO do número. |
| `sistema_tribunal` | `pje`, `esaj`, `eproc`, `projudi` ou `fisico` (processo físico). Sistema que o catálogo não conhece: `null`. |
| `segredo_justica` | `true`/`false` pelo nível de sigilo do DataJud; `null` se o processo não foi achado. |
| `juiz_relator`, `valor_causa`, `justica_gratuita` | Só se o processo já está importado no escritório e foi consultado com certificado; senão `null`. `valor_causa` é texto ("50000.00"). |
| `fase_processual` | Só quando a classe diz a fase: cumprimento de sentença, execução, ou recurso tramitando no tribunal. Senão `null`. |
| `classe_codigo` | Código CNJ da classe. |
| `classe_detalhe` | `{codigo, nome, item_id}`; `item_id` é o item da lista "classe" com o mesmo nome (ou `null`: será criado ao importar). |
| `assuntos_detalhe` | `[{codigo, nome, principal, item_id}]`, com o item da lista "assunto" quando existe. |
| `fonte_partes` | `djen`, `processo_importado` (partes já guardadas no escritório) ou `null`. |
| `partes[]` (campos a mais) | `tipo_participacao`, `documento`, `documento_parcial`, `advogados[]`, `pessoa_id`, `pessoa_criterio` (`documento` ou `nome`), `cliente_id` (se a pessoa é cliente do escritório) e `cliente_do_caso` (é o cliente do contrato informado). |
| `advogados[]` | Advogados que o DJEN listou sem dizer de quem são: `{nome, oab_numero, oab_uf, advogado_id}` (`advogado_id` quando a OAB já está no cadastro). |

Cada advogado (de parte ou da lista) sai como `{nome, oab_numero, oab_uf, advogado_id}`.

## O que a importação grava

Acontece quando o processo é ligado ao caso: caso salvo com número CNJ (job `importar_caso`), caso criado a partir do
processo (Tribunais), processo ligado a um caso, autos baixados com certificado e o botão "Trazer partes do tribunal".
A sincronização diária (DataJud) só traz andamentos.

### Ficha (`preencher_ficha`)

`justica`, `uf`, `codigo_orgao`, `juiz_relator`, `sistema_tribunal`, `segredo_justica`, `justica_gratuita` (do processo
ou da assistência judiciária da parte que é o cliente), `valor_causa`, classe, assunto principal, assuntos secundários e
`fase_processual` (só quando a classe diz).

- **Cada campo é preenchido no máximo uma vez e só se estiver vazio.** A lista dos campos já preenchidos fica em
  `fat_caso_contencioso.preenchido_tribunal`. O que o usuário digitou antes fica; o que ele trocou ou apagou depois não
  volta. Para sim/não, "vazio" é "não"; para a fase, é a fase padrão ("conhecimento").
- **Classe e assunto**: procura o item da lista pelo nome sem acento e sem diferença de maiúsculas. Não achou: cria o
  item como item do escritório (não é do sistema, pode ser editado em Configurações › Faturamento).

### Partes (`aplicar_partes`)

Cada parte do processo vira parte do caso na categoria do polo (Polo Ativo, Polo Passivo, Terceiros; fiscal da lei,
testemunha, vítima e "outro" vão para Outros). A qualificação entra quando o tribunal informa o tipo de participação
com o nome de uma qualificação da categoria, ou quando o polo já diz o papel (fiscal da lei, testemunha).

**Pessoa (cadastro único)**
1. Com CPF/CNPJ: a pessoa do cadastro com esse documento.
2. Sem documento, ou com ele mascarado: só por nome idêntico depois de normalizado (sem acento, pontuação e sufixo
   societário). Havendo uma única pessoa com documento e esse nome, é ela; havendo várias, fica a pessoa sem documento.
3. Nunca por semelhança.
4. Quando o tribunal passa a informar o documento de quem tinha vindo só com o nome (DJEN e depois MNI), a mesma pessoa
   recebe o documento.

**Cliente.** A parte que é o cliente do caso (vínculo confirmado, mesma pessoa, mesmo CPF/CNPJ ou, sem documento, mesmo
nome; vínculo rejeitado pelo usuário não conta) é a mesma parte "é cliente" que o caso já tem. Ela vai para o polo e a
qualificação que o processo diz enquanto ninguém a classificou à mão (sem qualificação e ainda "pendente de
reclassificação" ou já no mesmo polo).

**Não duplicar (critério).** Só entra quem ainda não está no caso. Já está no caso quem tem a mesma pessoa ou nome
normalizado idêntico sem documento diferente, **mesmo desativado**. Quem já está não é alterado: qualificação trocada,
parte movida de categoria e parte desativada ficam como o usuário deixou. Rodar de novo não cria nada.

**Advogados.** Cada um vira Advogado + inscrição na OAB (reaproveitado pela OAB; sem OAB, pelo CPF ou pelo nome entre os
advogados) e advogado da parte, uma vez por parte. Advogado que o usuário retirou da parte não volta: a parte guarda
quais advogados o tribunal já trouxe (`fat_envolvimento.advogados_do_tribunal`).
- Partes do MNI: cada advogado vai para a parte que o tribunal informou.
- Partes do DJEN: só o advogado do escritório (OAB de um profissional do escritório) é ligado, ao cliente. Os outros
  entram no cadastro e voltam em `advogados_sem_parte`, para o usuário ligar na aba Partes.

## `POST /api/faturamento/casos/{id}/partes-do-tribunal`

Permissão `casos.editar`. Sem corpo. Aplica as partes do processo do caso; se o caso ainda não tem processo importado
(ou o processo está sem partes) e a busca está ligada, importa antes. Erro 400 com a mensagem quando o caso não é
contencioso, não tem número CNJ, o processo não foi achado ou a busca no tribunal está desligada no caso.

```json
{
  "caso_id": 10, "processo_id": 3, "numero_processo": "0000000-00.2025.5.15.0001",
  "fonte": "djen",
  "incluidas": [{"envolvimento_id": 1, "pessoa_id": 2, "nome": "...", "documento": null, "cliente_id": null,
                 "eh_cliente": false, "categoria_id": 5, "categoria": "Polo Ativo", "polo": "ativo",
                 "qualificacao_id": null, "qualificacao": null, "ativo": true, "polo_tribunal": "ativo",
                 "tipo_participacao": null, "pessoa_criterio": "nome"}],
  "ja_existiam": [{"...": "os mesmos campos", "atualizada": false, "saiu_de_pendente": false}],
  "advogados_incluidos": [{"advogado_id": 1, "pessoa_id": 9, "nome": "...", "oab_numero": "123456", "oab_uf": "SP",
                           "oab": "OAB/SP 123.456", "eh_interno": true, "envolvimento_id": 4, "parte": "..."}],
  "advogados_ja_existiam": [],
  "advogados_sem_parte": [{"...": "os mesmos campos", "envolvimento_id": null, "parte": null}],
  "campos_preenchidos": ["uf", "classe_id"],
  "avisos": []
}
```

- `fonte`: `mni`, `djen` ou `null` (processo sem partes).
- `pessoa_criterio`: `cliente`, `documento` ou `nome`.
- `ja_existiam[].atualizada`: `true` só para o cliente que recebeu o polo ou a qualificação do processo.
- `advogados_ja_existiam[].retirado`: `true` quando o tribunal já tinha trazido o advogado e o usuário o retirou da parte.
- `polo` é o da categoria (`ativo`, `passivo`, `neutro`); `polo_tribunal` é o que o tribunal informou.

## O que depende do tribunal

- Partes pelas fontes públicas dependem do DJEN: processo sem publicação no diário, ou plataforma sem o proxy no
  Brasil, fica sem partes até a consulta com certificado.
- Documento, advogados de cada parte, juiz, valor da causa e justiça gratuita dependem do MNI (certificado do advogado,
  modo Real e tribunal com consulta liberada).
- Processo em segredo de justiça normalmente não aparece no DataJud público.
- A qualificação (autor, réu, exequente...) hoje não vem de nenhuma das três fontes; o usuário escolhe na aba Partes.
