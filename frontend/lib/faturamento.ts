// Faturamento: espelho de backend/app/modules/faturamento/schemas.py (Decimal chega como string).

import type { Decimal } from "./types";

export type TipoRegra = "fixo" | "recorrente" | "hora";
export type Frequencia = "diaria" | "semanal" | "mensal" | "anual";
export type Termino = "sem" | "ocorrencias" | "data";
export type StatusCaso = "aberto" | "encerrado";
export type TipoDespesa = "custas" | "copias" | "deslocamento" | "correio" | "diligencia" | "honorario_perito" | "outros";
export type Aba = "honorarios" | "despesas";
export type StatusRevisao = "em_revisao" | "faturada" | "descartada";

export interface CargoOut {
  id: number;
  nome: string;
  ordem: number;
  ativo: boolean;
  qtd_funcionarios: number;
}

/** Funcionário para timesheet (inclui quem não acessa o sistema). */
export interface ProfissionalOut {
  id: number;
  nome: string;
  email: string;
  cargo_id: number | null;
  cargo_nome: string | null;
  oab: string | null;
  acesso_sistema: boolean;
  ativo: boolean;
}

export interface TabelaOut {
  id: number;
  nome: string;
  ativo: boolean;
  itens: { cargo_id: number; valor_hora: Decimal }[];
}

export interface ContratoIn {
  tomador_id: number;
  emissora_id: number | null;
  tabela_preco_id: number | null;
  nome: string;
  objeto: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  ativo: boolean;
  observacao: string | null;
}

export interface ContratoOut extends ContratoIn {
  id: number;
  numero: number;
  tomador_nome: string;
  tabela_preco_nome: string | null;
  qtd_casos: number;
  qtd_regras: number;
}

export type Polo = "ativo" | "passivo" | "terceiro" | "consultivo";
export type TipoCaso = "consultivo" | "administrativo" | "judicial_estadual" | "judicial_federal" | "judicial_trabalhista";

export const ROTULO_TIPO_CASO: Record<TipoCaso, string> = {
  consultivo: "Consultivo",
  administrativo: "Administrativo",
  judicial_estadual: "Judicial Estadual",
  judicial_federal: "Judicial Federal",
  judicial_trabalhista: "Judicial Trabalhista",
};
export type TipoCampo = "texto" | "texto_longo" | "numero" | "moeda" | "data" | "sim_nao" | "lista";
export type ValorCampo = string | number | boolean | null;

export interface AreaOut {
  id: number;
  nome: string;
  cor: string | null;
  ordem: number;
  ativo: boolean;
  qtd_casos: number;
}

export interface CampoIn {
  nome: string;
  tipo: TipoCampo;
  opcoes: string[];
  obrigatorio: boolean;
  ajuda: string | null;
  area_id: number | null;
  ordem: number;
  ativo: boolean;
}

export interface CampoOut extends CampoIn {
  id: number;
  qtd_preenchidos: number;
}

export interface CasoIn {
  titulo: string;
  descricao: string | null;
  numero_processo: string | null;
  parte_contraria: string | null;
  tipo: TipoCaso | null;
  instancia: string | null;
  area_id: number | null;
  polo: Polo | null;
  tribunal: string | null;
  vara: string | null;
  comarca: string | null;
  valor_causa: string | null;
  data_distribuicao: string | null;
  /** {"<id do campo>": valor} */
  campos: Record<string, ValorCampo>;
  responsavel_id: number | null;
  tabela_preco_id: number | null;
  status: StatusCaso;
  data_abertura: string | null;
  data_encerramento: string | null;
}

export interface CasoOut extends CasoIn {
  id: number;
  numero: number;
  contrato_id: number;
  contrato_nome: string;
  contrato_numero: number;
  tomador_id: number;
  tomador_nome: string;
  responsavel_nome: string | null;
  tipo_nome: string | null;
  instancia_nome: string | null;
  area_nome: string | null;
  area_cor: string | null;
  qtd_anexos: number;
  qtd_andamentos: number;
  qtd_tarefas_abertas: number;
  tabela_preco_efetiva: string | null;
  tem_regra_propria: boolean;
  horas_pendentes: Decimal;
  despesas_pendentes: Decimal;
}

export interface RegraIn {
  tipo: TipoRegra;
  descricao: string;
  valor: string | null;
  data_pagamento: string | null;
  frequencia: Frequencia | null;
  intervalo: number;
  data_inicio: string | null;
  termino: Termino;
  ocorrencias: number | null;
  data_fim: string | null;
  tabela_preco_id: number | null;
  ativo: boolean;
  observacao: string | null;
}

export interface RegraOut extends Omit<RegraIn, "valor"> {
  id: number;
  contrato_id: number;
  caso_id: number | null;
  valor: Decimal | null;
  resumo: string;
  parcelas_faturadas: number;
  proxima: string | null;
}

export interface SimulacaoOut {
  resumo: string;
  parcelas: { n: number; data: string }[];
  total_parcelas: number | null;
}

export type TipoAndamento = "andamento" | "publicacao" | "despacho" | "decisao" | "sentenca" | "audiencia" | "reuniao" | "nota";

export interface AndamentoIn {
  data: string;
  tipo: TipoAndamento;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  concluido: boolean;
  responsavel_id: number | null;
}

export interface AndamentoOut extends AndamentoIn {
  id: number;
  caso_id: number;
  responsavel_nome: string | null;
  criado_por: string | null;
  criado_em: string;
  atrasado: boolean;
}

export interface AnexoOut {
  id: number;
  caso_id: number;
  /** anexo de uma tarefa (fica na pasta "Tarefas") */
  tarefa_id: number | null;
  /** recibo de uma despesa do caso (fica na pasta "Despesas" e não pode ser apagado daqui) */
  despesa_id: number | null;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  tamanho: number;
  mime: string | null;
  enviado_por: string | null;
  criado_em: string;
}

export interface ResumoCaso {
  resumo: string;
  situacao_atual: string;
  proximos_passos: string[];
  riscos: string[];
  gerado_em: string;
}

/** Sugestões da IA para a ficha do caso (nada é salvo). */
export type SugestaoCaso = Partial<Omit<CasoIn, "campos">> & { campos?: Record<string, ValorCampo> };

export const ROTULO_POLO: Record<Polo, string> = {
  ativo: "Polo ativo (autor)",
  passivo: "Polo passivo (réu)",
  terceiro: "Terceiro interessado",
  consultivo: "Consultivo",
};

export interface TimesheetOut {
  id: number;
  caso_id: number;
  profissional_id: number;
  profissional_nome: string;
  cargo_nome: string | null;
  data: string;
  minutos: number;
  descricao: string;
  faturavel: boolean;
  faturado: boolean;
  fatura_codigo: string | null;
}

export interface DespesaOut {
  id: number;
  caso_id: number;
  data: string;
  tipo: TipoDespesa;
  descricao: string;
  valor: Decimal;
  reembolsavel: boolean;
  tem_comprovante: boolean;
  lancado_por: string | null;
  faturado: boolean;
  fatura_codigo: string | null;
}

export interface ItemPendente {
  chave: string;
  tipo: string;
  caso_id: number | null;
  caso_numero: number | null;
  caso_titulo: string | null;
  data: string;
  descricao: string;
  valor: Decimal;
  parcela: string | null;
  quantidade: Decimal | null;
  valor_unitario: Decimal | null;
  profissional: string | null;
  aviso: string | null;
}

export interface ContratoPendente {
  contrato_id: number;
  contrato_numero: number;
  contrato_nome: string;
  total: Decimal;
  itens: ItemPendente[];
}

export interface ClientePendente {
  tomador_id: number;
  tomador_nome: string;
  tomador_doc: string | null;
  total: Decimal;
  qtd_itens: number;
  tipos: Record<string, Decimal>;
  contratos: ContratoPendente[];
}

export interface ItensAFaturarOut {
  clientes: ClientePendente[];
  total: Decimal;
  qtd_itens: number;
}

export interface FaturadaOut {
  id: number;
  codigo: string;
  tomador_nome: string;
  contrato_nome: string | null;
  valor: Decimal;
  data_vencimento: string;
}

export interface FaturarOut {
  faturas: FaturadaOut[];
  total: Decimal;
}

export interface RevisaoItem {
  id: number;
  chave: string;
  tipo: string;
  regra_id: number | null;
  caso_id: number | null;
  caso_numero: number | null;
  caso_titulo: string | null;
  competencia: string | null;
  parcela: string | null;
  data: string;
  descricao: string;
  profissional: string | null;
  profissional_id: number | null;
  quantidade: Decimal | null;
  valor_unitario: Decimal | null;
  valor: Decimal;
  valor_original: Decimal;
  excluido: boolean;
  manual: boolean;
}

export interface RevisaoResumo {
  id: number;
  numero: number;
  aba: Aba;
  status: StatusRevisao;
  contrato_id: number;
  contrato_numero: number;
  contrato_nome: string;
  tomador_id: number;
  tomador_nome: string;
  de: string;
  ate: string;
  responsavel_nome: string | null;
  criado_em: string;
  qtd_itens: number;
  total: Decimal;
  total_original: Decimal;
  fatura_id: number | null;
  fatura_codigo: string | null;
  nota_ia: number | null;
}

export interface IaAnalise {
  resumo?: string;
  nota?: number;
  alertas?: { item_id: number | null; nivel: "alto" | "medio" | "baixo" | string; texto: string }[];
  sugestoes?: { item_id: number; descricao: string; motivo?: string }[];
  texto_fatura?: string;
}

export interface RevisaoOut extends RevisaoResumo {
  observacao: string | null;
  nota_interna: string | null;
  responsavel_id: number | null;
  ia_analise: IaAnalise | null;
  eventos: { em: string; texto: string; usuario: string | null }[];
  itens: RevisaoItem[];
  casos: { id: number; numero: number; titulo: string }[];
  total_horas: Decimal;
}

export interface FluxoCard {
  tipo: "revisao" | "fatura";
  id: number;
  titulo: string;
  cliente: string;
  contrato: string | null;
  valor: Decimal;
  data: string;
  documento: "NH" | "ND";
  responsavel?: string | null;
  dias?: number;
  nota_ia?: number | null;
  vencimento?: string;
  nfse_numero?: number | null;
  origem?: string;
  pago_em?: string | null;
}

export type ColunaFluxo = "em_revisao" | "aguardando_nfse" | "a_receber" | "vencidas" | "pagas";

export interface FluxoOut {
  de: string;
  ate: string;
  colunas: Record<ColunaFluxo, { qtd: number; total: Decimal; cards: FluxoCard[] }>;
}

// ---------------------------------------------------------------- rótulos
export const ROTULO_TIPO_REGRA: Record<TipoRegra, string> = {
  fixo: "Valor fixo",
  recorrente: "Fixo recorrente",
  hora: "Por hora",
};

/** Tipos de item (pendentes e da revisão), inclusive despesas e lançamentos avulsos. */
export function rotuloTipoItem(t: string) {
  return (
    { fixo: "Fixo", recorrente: "Recorrente", hora: "Horas", despesa: "Despesa", avulso: "Avulso", lancamento: "Avulso" } as Record<string, string>
  )[t] ?? t;
}

export const ROTULO_FREQUENCIA: Record<Frequencia, { nome: string; unidade: [string, string] }> = {
  diaria: { nome: "Diário", unidade: ["dia", "dias"] },
  semanal: { nome: "Semanal", unidade: ["semana", "semanas"] },
  mensal: { nome: "Mensal", unidade: ["mês", "meses"] },
  anual: { nome: "Anual", unidade: ["ano", "anos"] },
};

export const ROTULO_DESPESA: Record<TipoDespesa, string> = {
  custas: "Custas",
  copias: "Cópias",
  deslocamento: "Deslocamento",
  correio: "Correio",
  diligencia: "Diligência",
  honorario_perito: "Honorário de perito",
  outros: "Outros",
};

export const documentoDaAba = (a: Aba) => (a === "despesas" ? "ND" : "NH");

// ---------------------------------------------------------------- horas
/** 90 → "1:30" */
export function hhmm(minutos: number | null | undefined) {
  const m = Math.max(0, Math.round(minutos ?? 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** "1:30" | "1h30" | "1,5" | "90m" → minutos (null se inválido). */
export function paraMinutos(txt: string): number | null {
  const t = txt.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let m = /^(\d{1,2})[:h](\d{1,2})?m?$/.exec(t);
  if (m) {
    const min = m[2] ? Number(m[2]) : 0;
    return min < 60 ? Number(m[1]) * 60 + min : null;
  }
  m = /^(\d+)m(in)?$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:[.,]\d+)?)$/.exec(t);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 60);
  return null;
}

/** Decimal de horas ("1.50") → "1:30" */
export const horasDecimal = (h: Decimal | number | null | undefined) => hhmm(Number(h ?? 0) * 60);

// ---------------------------------------------------------------- tarefas
export type TipoTarefa = "prazo" | "audiencia" | "diligencia" | "reuniao" | "peticao" | "ligacao" | "administrativo" | "outro";
export type StatusTarefa = "a_fazer" | "em_andamento" | "concluida" | "cancelada";
export type PrioridadeTarefa = "baixa" | "media" | "alta" | "urgente";

export interface TarefaIn {
  caso_id: number | null;
  titulo: string;
  descricao: string | null;
  tipo: TipoTarefa;
  status: StatusTarefa;
  prioridade: PrioridadeTarefa;
  prazo: string | null;
  /** "HH:MM" */
  hora: string | null;
  responsavel_id: number | null;
  etiquetas: string[];
}

export interface TarefaOut extends TarefaIn {
  id: number;
  caso_numero: number | null;
  caso_titulo: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  concluida_em: string | null;
  criado_por: string | null;
  criado_em: string;
  atrasada: boolean;
  dias_para_prazo: number | null;
  qtd_anexos: number;
}

export interface TarefasListaOut {
  itens: TarefaOut[];
  resumo: Record<"abertas" | "atrasadas" | "hoje" | "semana" | "minhas" | "sem_prazo" | "concluidas_7d" | StatusTarefa, number>;
}
