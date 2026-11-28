// Tipos de caso e partes: espelho de backend/app/modules/faturamento/{schemas.py,tipos_caso.py,casos.py,listas.py,envolvimento.py}.
// Decimal chega como string; data como "AAAA-MM-DD".

import type { PessoaResumo } from "./pessoas";
import type { Decimal } from "./types";

export type TipoDeCaso = "contencioso" | "consultivo" | "administrativo";
export type TipoVinculo = "recurso" | "incidente" | "apenso" | "desdobramento" | "conexo" | "judicializacao";

export const TIPOS_DE_CASO: TipoDeCaso[] = ["contencioso", "consultivo", "administrativo"];

export const ROTULO_TIPO_DE_CASO: Record<TipoDeCaso, string> = {
  contencioso: "Contencioso",
  consultivo: "Consultivo",
  administrativo: "Administrativo",
};

export const ROTULO_STATUS_CASO: Record<string, string> = {
  aberto: "Ativo",
  suspenso: "Suspenso",
  arquivado: "Arquivado",
  encerrado: "Encerrado",
};

export const TOM_STATUS_CASO: Record<string, "success" | "warning" | "neutral"> = {
  aberto: "success",
  suspenso: "warning",
  arquivado: "neutral",
  encerrado: "neutral",
};

export interface ItemNome {
  id: number;
  nome: string;
}

export interface Opcao {
  valor: string;
  rotulo: string;
}

/** GET /faturamento/casos/opcoes */
export interface OpcoesCaso {
  opcoes: Record<string, Opcao[]>;
  listas: TipoLista[];
}

// ---------------------------------------------------------------- listas configuráveis
export type CodigoLista =
  | "motivo_encerramento"
  | "origem"
  | "centro_custo"
  | "etiqueta"
  | "classe"
  | "assunto"
  | "tipo_demanda"
  | "orgao"
  | "tipo_procedimento";

export interface TipoLista {
  lista: CodigoLista;
  nome: string;
  /** tipo de caso em que a lista aparece; null = todos */
  tipo_caso: TipoDeCaso | null;
}

export interface ListaItemIn {
  lista: string;
  nome: string;
  ordem: number;
  ativo: boolean;
}

export interface ListaItemOut extends ListaItemIn {
  id: number;
  sistema: boolean;
}

// ---------------------------------------------------------------- dados de cada tipo (entram e saem iguais)
export interface ContenciosoDados {
  pre_ajuizamento: boolean;
  numero_antigo: string | null;
  justica: string | null;
  uf: string | null;
  codigo_orgao: string | null;
  juiz_relator: string | null;
  sistema_tribunal: string | null;
  classe_id: number | null;
  classe_nome?: string | null;
  assunto_id: number | null;
  assunto_nome?: string | null;
  assuntos_secundarios_ids: number[];
  assuntos_secundarios?: ItemNome[];
  rito: string | null;
  fase_processual: string | null;
  data_citacao: string | null;
  data_transito_julgado: string | null;
  valor_condenacao: Decimal | null;
  valor_acordo: Decimal | null;
  prognostico: string | null;
  valor_provisionado: Decimal | null;
  valor_risco: Decimal | null;
  deposito_judicial: Decimal | null;
  justica_gratuita: boolean;
  segredo_justica: boolean;
  tutela_liminar: string | null;
  resultado: string | null;
  monitorar_andamentos: boolean;
}

export interface ConsultivoDados {
  tipo_demanda_id: number | null;
  tipo_demanda_nome?: string | null;
  solicitante_id: number | null;
  solicitante_nome?: string | null;
  departamento_solicitante: string | null;
  data_solicitacao: string | null;
  prazo_entrega: string | null;
  sla_dias: number | null;
  prioridade: string;
  complexidade: string | null;
  etapa: string;
  horas_estimadas: Decimal | null;
  /** leitura: soma do timesheet */
  horas_realizadas?: Decimal | null;
  valor_envolvido: Decimal | null;
  contrato_vigencia_inicio: string | null;
  contrato_vigencia_fim: string | null;
  renovacao_automatica: boolean;
  data_entrega: string | null;
  documento_entregue_id: number | null;
  risco_identificado: string | null;
  recomendacao_resumo: string | null;
  gerou_contencioso_id: number | null;
  gerou_contencioso_titulo?: string | null;
}

export interface AdministrativoDados {
  esfera: string | null;
  orgao_id: number | null;
  orgao_nome?: string | null;
  unidade_orgao: string | null;
  uf: string | null;
  municipio: string | null;
  tipo_procedimento_id: number | null;
  tipo_procedimento_nome?: string | null;
  numero_processo_adm: string | null;
  numero_protocolo: string | null;
  numero_auto_infracao: string | null;
  numero_nb: string | null;
  instancia_adm: string | null;
  fase_adm: string | null;
  data_ciencia: string | null;
  prazo_defesa: string | null;
  data_protocolo: string | null;
  valor_autuado: Decimal | null;
  valor_multa: Decimal | null;
  valor_juros: Decimal | null;
  valor_atualizado: Decimal | null;
  data_atualizacao_valor: string | null;
  exigibilidade_suspensa: boolean;
  garantia: string | null;
  prognostico: string | null;
  decisao: string | null;
  data_decisao: string | null;
  cabe_judicializacao: boolean;
  prazo_judicializacao: string | null;
  caso_judicial_id: number | null;
  caso_judicial_titulo?: string | null;
  link_sistema_orgao: string | null;
}

export const contenciosoVazio = (): ContenciosoDados => ({
  pre_ajuizamento: false,
  numero_antigo: null,
  justica: null,
  uf: null,
  codigo_orgao: null,
  juiz_relator: null,
  sistema_tribunal: null,
  classe_id: null,
  assunto_id: null,
  assuntos_secundarios_ids: [],
  rito: null,
  fase_processual: null,
  data_citacao: null,
  data_transito_julgado: null,
  valor_condenacao: null,
  valor_acordo: null,
  prognostico: null,
  valor_provisionado: null,
  valor_risco: null,
  deposito_judicial: null,
  justica_gratuita: false,
  segredo_justica: false,
  tutela_liminar: null,
  resultado: null,
  monitorar_andamentos: true,
});

export const consultivoVazio = (): ConsultivoDados => ({
  tipo_demanda_id: null,
  solicitante_id: null,
  departamento_solicitante: null,
  data_solicitacao: null,
  prazo_entrega: null,
  sla_dias: null,
  prioridade: "media",
  complexidade: null,
  etapa: "recebido",
  horas_estimadas: null,
  valor_envolvido: null,
  contrato_vigencia_inicio: null,
  contrato_vigencia_fim: null,
  renovacao_automatica: false,
  data_entrega: null,
  documento_entregue_id: null,
  risco_identificado: null,
  recomendacao_resumo: null,
  gerou_contencioso_id: null,
});

export const administrativoVazio = (): AdministrativoDados => ({
  esfera: null,
  orgao_id: null,
  unidade_orgao: null,
  uf: null,
  municipio: null,
  tipo_procedimento_id: null,
  numero_processo_adm: null,
  numero_protocolo: null,
  numero_auto_infracao: null,
  numero_nb: null,
  instancia_adm: null,
  fase_adm: null,
  data_ciencia: null,
  prazo_defesa: null,
  data_protocolo: null,
  valor_autuado: null,
  valor_multa: null,
  valor_juros: null,
  valor_atualizado: null,
  data_atualizacao_valor: null,
  exigibilidade_suspensa: false,
  garantia: null,
  prognostico: null,
  decisao: null,
  data_decisao: null,
  cabe_judicializacao: false,
  prazo_judicializacao: null,
  caso_judicial_id: null,
  link_sistema_orgao: null,
});

/** Campos de valor (dinheiro ou horas) de cada bloco: na tela ficam com vírgula, na API com ponto. */
export const CAMPOS_DECIMAIS = {
  contencioso: ["valor_condenacao", "valor_acordo", "valor_provisionado", "valor_risco", "deposito_judicial"],
  consultivo: ["horas_estimadas", "valor_envolvido"],
  administrativo: ["valor_autuado", "valor_multa", "valor_juros", "valor_atualizado"],
} as const;

export interface CasoRef {
  caso_id: number;
  numero: number;
  titulo: string;
}

/** GET /faturamento/casos/cnj */
export interface CnjLido {
  valido: boolean;
  mensagem: string | null;
  numero_formatado?: string;
  ano?: number;
  justica?: string | null;
  justica_nome?: string | null;
  tribunal?: string | null;
  tribunal_nome?: string | null;
  uf?: string | null;
  codigo_orgao?: string | null;
  /** tipo antigo (judicial_estadual...), para os seletores de tribunal e vara */
  tipo?: string | null;
  duplicado?: CasoRef | null;
}

// ---------------------------------------------------------------- partes do caso (envolvimento)
export interface Qualificacao {
  id: number;
  nome: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
}

export interface ConflitoCaso {
  caso_id: number;
  numero: number;
  titulo: string;
  papel: "cliente" | "contraria";
  papel_nome: string;
  categoria: string | null;
}

export interface AdvogadoDaParte {
  id: number;
  advogado_id: number;
  pessoa_id: number;
  nome: string;
  eh_interno: boolean;
  oab_id: number | null;
  /** "OAB/SP 123.456" */
  oab: string | null;
  principal: boolean;
  tipo_habilitacao: string | null;
  tipo_habilitacao_nome: string | null;
  data_habilitacao: string | null;
  data_desabilitacao: string | null;
  documento_procuracao_id: number | null;
  ativo: boolean;
}

export interface AdvogadoDaParteIn {
  advogado_id: number;
  oab_id?: number | null;
  principal: boolean;
  tipo_habilitacao?: string | null;
  data_habilitacao?: string | null;
  data_desabilitacao?: string | null;
  documento_procuracao_id?: number | null;
  ativo?: boolean;
}

export interface Envolvimento {
  id: number;
  caso_id: number;
  pessoa_id: number;
  pessoa: PessoaResumo;
  categoria_id: number;
  categoria_nome: string;
  polo: "ativo" | "passivo" | "neutro";
  qualificacao_id: number | null;
  qualificacao_nome: string | null;
  /** cliente do escritório NESTE caso */
  eh_cliente: boolean;
  principal: boolean;
  ordem: number;
  representado_por_id: number | null;
  representado_por_nome: string | null;
  data_inclusao: string | null;
  data_exclusao: string | null;
  ativo: boolean;
  pendente_reclassificacao: boolean;
  observacoes: string | null;
  advogados: AdvogadoDaParte[];
  conflitos: ConflitoCaso[];
}

export interface EnvolvimentoIn {
  pessoa_id: number;
  categoria_id: number;
  qualificacao_id: number | null;
  eh_cliente: boolean;
  principal: boolean;
  observacoes?: string | null;
  advogados: AdvogadoDaParteIn[];
  conflito_confirmado?: boolean;
}

export interface CategoriaPartes {
  id: number;
  tipo_caso: TipoDeCaso;
  codigo: string;
  nome: string;
  polo: "ativo" | "passivo" | "neutro";
  polo_nome: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
  qualificacoes: Qualificacao[];
  envolvimentos: Envolvimento[];
}

/** GET /faturamento/casos/{id}/envolvimentos */
export interface PartesDoCaso {
  caso_id: number;
  tipo_caso: TipoDeCaso;
  categorias: CategoriaPartes[];
  titulo_sugerido: string | null;
  partes_resumo: string | null;
  pendentes_reclassificacao: number;
  polo_cliente: string | null;
  polo_inconsistente: boolean;
  tem_cliente: boolean;
  /** advogados que o diário listou no processo sem dizer de quem são e que ainda não estão em nenhuma parte do caso */
  advogados_sem_parte: AdvogadoDoTribunal[];
}

/** Corpo do 409 de conflito de interesses. */
export interface RespostaConflito {
  detail: string;
  conflito: true;
  conflitos: ConflitoCaso[];
}

export function conflitoDe(body: unknown): RespostaConflito | null {
  if (body && typeof body === "object" && (body as { conflito?: unknown }).conflito === true) return body as RespostaConflito;
  return null;
}

// ---------------------------------------------------------------- capa do tribunal (docs/capa_do_tribunal.md)
/** Advogado como a capa devolve (de uma parte ou da lista sem dono). */
export interface AdvogadoDaCapa {
  nome: string;
  oab_numero: string | null;
  oab_uf: string | null;
  /** já está no cadastro único (pela OAB) */
  advogado_id: number | null;
}

export interface ParteDaCapa {
  nome: string;
  /** ativo | passivo | terceiro | fiscal_lei | vitima | testemunha | outro */
  polo: string;
  tipo_participacao: string | null;
  documento: string | null;
  /** documento que o tribunal mandou mascarado */
  documento_parcial: string | null;
  advogados: AdvogadoDaCapa[];
  /** pessoa do cadastro único que será usada */
  pessoa_id: number | null;
  pessoa_criterio: "documento" | "nome" | null;
  /** código do cliente, quando a pessoa é cliente do escritório */
  cliente_id: number | null;
  /** é o cliente do contrato informado na consulta */
  cliente_do_caso: boolean;
}

export interface ItemDaCapa {
  codigo: number | null;
  nome: string;
  /** item da lista do escritório com este nome; null = entra na lista ao importar o processo */
  item_id: number | null;
}

/** Saída de GET /tribunais/capa (backend/app/modules/tribunais/caso.py · capa). Nada é gravado. */
export interface CapaProcesso {
  numero_cnj: string;
  numero_formatado: string;
  tribunal: string;
  tribunal_nome: string;
  tipo: "judicial_estadual" | "judicial_federal" | "judicial_trabalhista" | null;
  instancia: string | null;
  vara: string | null;
  comarca: string | null;
  classe: string | null;
  assuntos: string[];
  data_distribuicao: string | null;
  sistema: string | null;
  partes: ParteDaCapa[];
  polo: "ativo" | "passivo" | null;
  parte_contraria: string | null;
  titulo: string | null;
  movimentos: number;
  encontrado: boolean;
  avisos: string[];
  processo_id: number | null;
  // campos do contencioso: só o que a fonte informa (juiz, valor da causa e gratuidade só com certificado)
  justica: string | null;
  justica_nome: string | null;
  uf: string | null;
  codigo_orgao: string | null;
  juiz_relator: string | null;
  sistema_tribunal: string | null;
  /** decimal com ponto ("50000.00") */
  valor_causa: string | null;
  segredo_justica: boolean | null;
  justica_gratuita: boolean | null;
  fase_processual: string | null;
  classe_codigo: number | null;
  classe_detalhe: ItemDaCapa | null;
  assuntos_detalhe: (ItemDaCapa & { principal: boolean })[];
  /** djen = diário de justiça; processo_importado = partes já guardadas no escritório; null = nenhuma parte */
  fonte_partes: "djen" | "processo_importado" | null;
  /** advogados que o diário listou sem dizer de quem são */
  advogados: AdvogadoDaCapa[];
}

// ---------------------------------------------------------------- partes do tribunal no caso
/** Advogado nas respostas de `partes-do-tribunal` e em `PartesDoCaso.advogados_sem_parte`. */
export interface AdvogadoDoTribunal {
  advogado_id: number;
  pessoa_id: number;
  nome: string;
  oab_numero: string | null;
  oab_uf: string | null;
  /** "OAB/SP 123.456" */
  oab: string | null;
  eh_interno: boolean;
  envolvimento_id: number | null;
  /** nome da parte a que foi ligado */
  parte: string | null;
  /** em `advogados_ja_existiam`: o tribunal já tinha trazido e o usuário retirou da parte */
  retirado?: boolean;
}

export interface ParteDoTribunal {
  envolvimento_id: number;
  pessoa_id: number;
  nome: string;
  documento: string | null;
  cliente_id: number | null;
  eh_cliente: boolean;
  categoria_id: number;
  categoria: string;
  polo: "ativo" | "passivo" | "neutro";
  qualificacao_id: number | null;
  qualificacao: string | null;
  ativo: boolean;
  polo_tribunal: string;
  tipo_participacao: string | null;
  pessoa_criterio: "cliente" | "documento" | "nome";
  /** em `ja_existiam`: o cliente recebeu o polo ou a qualificação do processo */
  atualizada?: boolean;
  saiu_de_pendente?: boolean;
}

/**
 * POST /faturamento/casos/{id}/partes-do-tribunal. Não há botão: a ficha chama sozinha quando
 * `CasoOut.buscar_partes_tribunal` vem ligado (caso antigo que nunca recebeu partes do tribunal).
 */
export interface PartesDoTribunal {
  caso_id: number;
  processo_id: number;
  numero_processo: string;
  fonte: "mni" | "djen" | null;
  incluidas: ParteDoTribunal[];
  ja_existiam: ParteDoTribunal[];
  advogados_incluidos: AdvogadoDoTribunal[];
  advogados_ja_existiam: AdvogadoDoTribunal[];
  advogados_sem_parte: AdvogadoDoTribunal[];
  campos_preenchidos: string[];
  avisos: string[];
}
