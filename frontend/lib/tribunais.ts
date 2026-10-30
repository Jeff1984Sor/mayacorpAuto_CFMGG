// Integração com Tribunais: espelho das saídas de backend/app/modules/tribunais/routes.py (*_out) + hooks.

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";

// ---------------------------------------------------------------- tipos
export interface Oab {
  numero: string;
  uf: string;
  tipo: "principal" | "suplementar" | "estagiario" | string;
}

export interface CertificadoAdv {
  id: number;
  usuario_id: number;
  tipo: string;
  titular_nome: string;
  titular_cpf: string | null;
  emissor_ac: string | null;
  numero_serie: string | null;
  thumbprint_sha256: string | null;
  valido_de: string | null;
  valido_ate: string | null;
  dias_para_vencer: number;
  revogado: boolean;
  revogacao_verificada_em: string | null;
  revogacao_msg: string | null;
  escopo_autorizado: string[];
  criado_em: string | null;
}

export type StatusVarredura = "pendente" | "rodando" | "concluida" | "parcial" | "erro";
export type StatusImportacao = "nao_importar" | "fila" | "importado" | "erro" | "sem_acesso";

export interface Varredura {
  id: number;
  advogado_id: number;
  advogado_nome: string | null;
  inscricoes_oab: Oab[];
  tribunais_alvo: string[];
  data_inicio: string | null;
  data_fim: string | null;
  coleta: "navegador" | "servidor";
  status: StatusVarredura;
  iniciada_em: string | null;
  concluida_em: string | null;
  total_comunicacoes: number;
  total_encontrados: number;
  resumo_por_tribunal: Record<string, number>;
  erro: string | null;
  por_status: Partial<Record<StatusImportacao, number>>;
  djen: { url: string; itens_por_pagina: number; requisicoes_por_minuto: number };
}

export interface Encontrado {
  id: number;
  numero_cnj: string;
  numero_formatado: string;
  tribunal: string | null;
  sistema_provavel: string | null;
  fonte: string;
  partes_resumo: string | null;
  classe_resumo: string | null;
  orgao_resumo: string | null;
  ultima_movimentacao_em: string | null;
  comunicacoes: number;
  segredo_justica: boolean | null;
  possivel_cliente_id: number | null;
  possivel_cliente_nome: string | null;
  possivel_cliente_criterio: string | null;
  ja_importado: boolean;
  selecionado_para_importar: boolean;
  status_importacao: StatusImportacao;
  erro: string | null;
  processo_id: number | null;
  partes: { nome: string; polo: string }[];
  advogados: { nome: string; oab: string; uf: string }[];
}

export interface VarreduraDetalhe extends Varredura {
  encontrados: Encontrado[];
  total_filtrado: number;
  pagina: number;
}

export interface ComunicacoesOut {
  novos: number;
  total_encontrados: number;
  total_comunicacoes: number;
  intimacoes_registradas: number;
  resumo_por_tribunal: Record<string, number>;
}

export interface Advogado {
  id: number;
  nome: string;
  cpf: string | null;
  email: string | null;
  oabs: Oab[];
  certificado: CertificadoAdv | null;
  ultima_varredura: Varredura | null;
  processos: number;
}

export interface Candidato {
  id: number;
  nome: string;
  cpf: string | null;
  oab: string | null;
  oabs: Oab[];
}

/** Parte de GET /tribunais/eu que estas telas usam. */
export interface EuTribunais {
  usuario_id: number;
  nome: string;
  cpf: string | null;
  email: string | null;
  oabs: Oab[];
  certificado: CertificadoAdv | null;
}

export interface TribunalCatalogo {
  id: number;
  sigla: string;
  nome: string;
  segmento_j: string;
  codigo_tr: string;
  uf: string | null;
  ramo: string;
}

export type Situacao = "ativo" | "suspenso" | "arquivado" | "baixado" | "extinto";

export interface ClienteDoProcesso {
  id: number;
  nome: string;
  status: StatusVinculo;
}

export interface ProcessoResumo {
  id: number;
  numero_cnj: string;
  numero_formatado: string;
  tribunal: string;
  tribunal_nome: string;
  ramo: string;
  sistema: string | null;
  grau: string | null;
  classe_nome: string | null;
  orgao_julgador: string | null;
  situacao: Situacao;
  nivel_sigilo: number;
  segredo_justica: boolean | null;
  partes_resumo: string | null;
  clientes: ClienteDoProcesso[];
  caso_id: number | null;
  caso_numero: number | null;
  responsavel_interno_id: number | null;
  responsavel_nome: string | null;
  ultima_sincronizacao: string | null;
  sincronizacao_erro: string | null;
  movimentacoes_nao_lidas: number;
  monitorar: boolean;
  origem_importacao: string | null;
  ultima_movimentacao_em: string | null;
}

export interface AdvogadoParte {
  id: number;
  nome: string;
  oab_numero: string | null;
  oab_uf: string | null;
  e_o_usuario: boolean;
  tipo_representante: string | null;
}

export interface Parte {
  id: number;
  polo: string;
  tipo_participacao: string | null;
  ordem: number | null;
  assistencia_judiciaria: boolean | null;
  intimacao_pendente: boolean | null;
  pessoa: {
    id: number;
    nome: string;
    tipo_pessoa: string | null;
    cpf: string | null;
    cnpj: string | null;
    documento_parcial: string | null;
    enderecos: Record<string, string | null>[] | null;
    email: string | null;
  };
  advogados: AdvogadoParte[];
}

export type StatusVinculo = "automatico" | "sugerido" | "confirmado" | "rejeitado";

export interface VinculoOut {
  id: number;
  parte_id: number | null;
  cliente_id: number;
  cliente_nome: string | null;
  criterio: string;
  confianca: number;
  status: StatusVinculo;
  polo_cliente: string | null;
  confirmado_por: string | null;
  confirmado_em: string | null;
}

export interface DocumentoAutos {
  id: number;
  id_documento_tribunal: string | null;
  id_documento_pai: string | null;
  tipo_documento_nome: string | null;
  descricao: string | null;
  data_hora_juntada: string | null;
  mimetype: string | null;
  tamanho_bytes: number | null;
  paginas: number | null;
  nivel_sigilo: number;
  status_download: "pendente" | "baixado" | "erro" | "sem_acesso" | string;
  tem_arquivo: boolean;
}

export interface ProtocoloResumo {
  id: number;
  tipo: string;
  status: string;
  titulo: string | null;
  criado_em: string | null;
}

export interface Assunto {
  codigo?: string | number | null;
  nome?: string | null;
  principal?: boolean | null;
}

export interface ProcessoDetalhe extends ProcessoResumo {
  numeros_antigos: string[] | null;
  graus: string[] | null;
  classe_codigo_cnj: string | null;
  assuntos: Assunto[] | null;
  competencia: string | null;
  localidade_codigo: string | null;
  localidade_nome: string | null;
  orgao_julgador_codigo: string | null;
  magistrado: string | null;
  valor_causa: string | null;
  data_ajuizamento: string | null;
  justica_gratuita: boolean | null;
  prioridades: string[] | null;
  tutela_liminar_requerida: boolean | null;
  juizo_100_digital: boolean | null;
  processo_principal_cnj: string | null;
  processos_vinculados: string[] | null;
  migrado_de_sistema: string | null;
  migrado_em: string | null;
  status_interno: string | null;
  advogado_id: number | null;
  advogado_nome: string | null;
  sistema_portal: string | null;
  partes: Parte[];
  vinculos: VinculoOut[];
  documentos: DocumentoAutos[];
  protocolos: ProtocoloResumo[];
  total_movimentacoes: number;
}

export interface Movimentacao {
  id: number;
  data_hora: string | null;
  codigo_nacional: string | number | null;
  descricao: string;
  complementos: unknown;
  orgao: string | null;
  grau: string | null;
  e_intimacao: boolean;
  prazo_final: string | null;
  fonte: "datajud" | "djen" | "mni" | "manual" | string;
  lida: boolean;
  andamento_id: number | null;
  tarefa_id: number | null;
  nivel_sigilo: number;
}

export interface IntimacaoRecente extends Movimentacao {
  processo_id: number;
  numero_formatado: string;
  tribunal: string;
}

export interface UsoFranquia {
  ciclo: string;
  plano: string | null;
  franquia: number;
  usado: number;
  excedente: number;
  percentual: number | null;
  valor_excedente: string;
  permite_excedente: boolean;
}

export interface PainelTribunais {
  modo: "simulado" | "real";
  processos: number;
  monitorados: number;
  sem_caso: number;
  intimacoes_nao_lidas: number;
  vinculos_sugeridos: number;
  protocolos: Record<string, number>;
  por_tribunal: { tribunal: string; processos: number }[];
  certificados: CertificadoAdv[];
  fila: Record<string, number>;
  uso: UsoFranquia;
  alertas_nao_lidos: number;
  intimacoes_recentes: IntimacaoRecente[];
}

export interface AlertaTribunal {
  id: number;
  tipo: string;
  severidade: "info" | "aviso" | "erro" | string;
  mensagem: string;
  processo_id: number | null;
  protocolo_id: number | null;
  lido: boolean;
  criado_em: string | null;
}

export interface JobTribunal {
  id: number;
  tipo: string;
  referencia_id: number;
  /** Texto legível (ex.: número do processo) */
  referencia: string | null;
  prioridade: number;
  status: "fila" | "rodando" | "ok" | "erro" | "reprocessar" | "cancelado";
  tentativas: number;
  max_tentativas: number;
  proxima_tentativa_em: string | null;
  erro: string | null;
  criado_em: string | null;
  concluido_em: string | null;
}

export interface Lista<T> {
  itens: T[];
  total: number;
  pagina: number;
}

export type Prioridade = "baixa" | "media" | "alta" | "urgente";

// ---------------------------------------------------------------- rótulos
export const SITUACAO: Record<Situacao, { l: string; tom: "success" | "warning" | "neutral" | "danger" }> = {
  ativo: { l: "Ativo", tom: "success" },
  suspenso: { l: "Suspenso", tom: "warning" },
  arquivado: { l: "Arquivado", tom: "neutral" },
  baixado: { l: "Baixado", tom: "neutral" },
  extinto: { l: "Extinto", tom: "neutral" },
};

export const STATUS_VINCULO: Record<StatusVinculo, { l: string; tom: "success" | "warning" | "neutral" | "info" }> = {
  automatico: { l: "Automático", tom: "info" },
  sugerido: { l: "Sugerido", tom: "warning" },
  confirmado: { l: "Confirmado", tom: "success" },
  rejeitado: { l: "Rejeitado", tom: "neutral" },
};

export const CRITERIO: Record<string, string> = {
  cpf_cnpj: "CPF/CNPJ igual",
  cnpj_raiz: "Mesma raiz de CNPJ",
  nome_doc_parcial: "Nome e documento parcial",
  nome_exato: "Nome igual",
  nome_fuzzy: "Nome parecido",
  manual: "Manual",
};

export const FONTE: Record<string, string> = { datajud: "DataJud", djen: "DJEN", mni: "MNI", manual: "Manual" };

export const STATUS_IMPORTACAO: Record<StatusImportacao, { l: string; tom: "success" | "warning" | "neutral" | "danger" | "brand" }> = {
  nao_importar: { l: "Não importado", tom: "neutral" },
  fila: { l: "Importando", tom: "brand" },
  importado: { l: "Importado", tom: "success" },
  erro: { l: "Erro", tom: "danger" },
  sem_acesso: { l: "Sem acesso", tom: "warning" },
};

export const STATUS_VARREDURA: Record<StatusVarredura, { l: string; tom: "success" | "warning" | "neutral" | "danger" | "brand" }> = {
  pendente: { l: "Pendente", tom: "neutral" },
  rodando: { l: "Coletando", tom: "brand" },
  concluida: { l: "Concluída", tom: "success" },
  parcial: { l: "Parcial", tom: "warning" },
  erro: { l: "Erro", tom: "danger" },
};

export const TIPO_JOB: Record<string, string> = {
  varredura: "Busca pela OAB",
  importar_processo: "Importar processo",
  sincronizar: "Sincronizar processo",
  baixar_documentos: "Baixar autos",
  protocolar: "Protocolar petição",
  verificar_protocolo: "Conferir protocolo",
  notificar: "Enviar aviso",
  sincronizar_tabelas: "Atualizar tabelas",
  health_check: "Checar tribunais",
};

export const STATUS_JOB: Record<string, { l: string; tom: "success" | "warning" | "neutral" | "danger" | "brand" }> = {
  fila: { l: "Na fila", tom: "brand" },
  rodando: { l: "Rodando", tom: "brand" },
  ok: { l: "Concluída", tom: "success" },
  erro: { l: "Erro", tom: "danger" },
  reprocessar: { l: "Vai tentar de novo", tom: "warning" },
  cancelado: { l: "Cancelada", tom: "neutral" },
};

export const STATUS_PROTOCOLO: Record<string, { l: string; tom: "success" | "warning" | "neutral" | "danger" | "brand" | "info" }> = {
  rascunho: { l: "Rascunho", tom: "neutral" },
  aprovado: { l: "Aprovado", tom: "info" },
  na_fila: { l: "Na fila", tom: "brand" },
  enviando: { l: "Enviando", tom: "brand" },
  protocolado: { l: "Protocolado", tom: "success" },
  erro: { l: "Erro", tom: "danger" },
  verificar: { l: "Conferir", tom: "warning" },
};

export const TIPO_PROTOCOLO: Record<string, string> = {
  inicial: "Inicial",
  intermediaria: "Intermediária",
  habilitacao: "Habilitação",
  recurso: "Recurso",
};

export const STATUS_DOWNLOAD: Record<string, { l: string; tom: "success" | "warning" | "neutral" | "danger" }> = {
  pendente: { l: "Pendente", tom: "neutral" },
  baixado: { l: "Baixado", tom: "success" },
  erro: { l: "Erro", tom: "danger" },
  sem_acesso: { l: "Sem acesso", tom: "warning" },
};

export const POLO: Record<string, string> = {
  ativo: "Polo ativo",
  passivo: "Polo passivo",
  terceiro: "Terceiros",
  fiscal_lei: "Fiscal da lei",
  vitima: "Vítima",
  testemunha: "Testemunha",
  outro: "Outros",
};

export const GRAU: Record<string, string> = {
  "1g": "1º grau",
  "2g": "2º grau",
  G1: "1º grau",
  G2: "2º grau",
  turma_recursal: "Turma recursal",
  superior: "Tribunal superior",
};

export const SISTEMA: Record<string, string> = { pje: "PJe", eproc: "eproc", esaj: "e-SAJ", projudi: "Projudi", proprio: "Sistema próprio" };

export const PRIORIDADE: Record<Prioridade, string> = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

export const rotuloSistema = (s: string | null | undefined) => (s ? (SISTEMA[s] ?? s) : null);
export const rotuloGrau = (g: string | null | undefined) => (g ? (GRAU[g] ?? g) : null);
export const oabTexto = (o: Pick<Oab, "numero" | "uf">) => `${o.numero}/${o.uf}`;

/** Máscara do número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
export function mascaraCnj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 20);
  const partes = [d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16, 20)];
  const sep = ["", "-", ".", ".", ".", "."];
  return partes.reduce((acc, p, i) => (p ? acc + sep[i] + p : acc), "");
}

export const cnjCompleto = (v: string) => v.replace(/\D/g, "").length === 20;

// ---------------------------------------------------------------- hooks
export const CHAVE = "trib";

export function usePainelTribunais() {
  return useQuery({ queryKey: [CHAVE, "painel"], queryFn: () => api.get<PainelTribunais>("/tribunais/painel"), refetchInterval: 60_000 });
}

export function useAlertasTribunais() {
  return useQuery({ queryKey: [CHAVE, "alertas"], queryFn: () => api.get<AlertaTribunal[]>("/tribunais/alertas", { nao_lidos: true, limite: 50 }) });
}

export function useJobsTribunais(status?: string) {
  return useQuery({
    queryKey: [CHAVE, "jobs", status ?? ""],
    queryFn: () => api.get<JobTribunal[]>("/tribunais/jobs", { status, limite: 50 }),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => j.status === "fila" || j.status === "rodando") ? 5_000 : 30_000),
  });
}

export function useAdvogadosTribunais(enabled = true) {
  return useQuery({ queryKey: [CHAVE, "advogados"], queryFn: () => api.get<Advogado[]>("/tribunais/advogados"), enabled, staleTime: 30_000, meta: { silencioso: true } });
}

export function useCandidatos(enabled = true) {
  return useQuery({ queryKey: [CHAVE, "candidatos"], queryFn: () => api.get<Candidato[]>("/tribunais/advogados/candidatos"), enabled, staleTime: 30_000, meta: { silencioso: true } });
}

export function useEuTribunais(enabled = true) {
  return useQuery({ queryKey: [CHAVE, "eu"], queryFn: () => api.get<EuTribunais>("/tribunais/eu"), enabled, staleTime: 30_000 });
}

export function useTribunaisCatalogo() {
  return useQuery({
    queryKey: [CHAVE, "catalogo"],
    queryFn: () => api.get<TribunalCatalogo[]>("/tribunais/tribunais"),
    staleTime: 10 * 60_000,
  });
}

export function useVarreduras() {
  return useQuery({ queryKey: [CHAVE, "varreduras"], queryFn: () => api.get<Varredura[]>("/tribunais/varreduras") });
}

export interface FiltrosVarredura {
  tribunal?: string;
  status?: string;
  q?: string;
  so_clientes?: boolean;
  pagina?: number;
}

export const POR_PAGINA_ENCONTRADOS = 100;

export function useVarredura(id: number | null, f: FiltrosVarredura, acompanhar: boolean) {
  return useQuery({
    queryKey: [CHAVE, "varredura", id, f],
    queryFn: () =>
      api.get<VarreduraDetalhe>(`/tribunais/varreduras/${id}`, {
        tribunal: f.tribunal || undefined,
        status: f.status || undefined,
        q: f.q || undefined,
        so_clientes: f.so_clientes || undefined,
        pagina: f.pagina ?? 1,
        por_pagina: POR_PAGINA_ENCONTRADOS,
      }),
    enabled: !!id,
    placeholderData: (p) => p,
    // acompanha a coleta pelo servidor e a importação em fila
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === "rodando" && (d.coleta === "servidor" || acompanhar)) return 3_000;
      return (d.por_status.fila ?? 0) > 0 ? 3_000 : false;
    },
  });
}

export interface FiltrosProcessos {
  q?: string;
  tribunal?: string;
  situacao?: string;
  cliente_id?: number;
  responsavel_id?: number;
  com_intimacao?: boolean;
  sem_caso?: boolean;
  pagina?: number;
}

export const POR_PAGINA_PROCESSOS = 50;

export function useProcessos(f: FiltrosProcessos) {
  return useQuery({
    queryKey: [CHAVE, "processos", f],
    queryFn: () =>
      api.get<Lista<ProcessoResumo>>("/tribunais/processos", {
        q: f.q || undefined,
        tribunal: f.tribunal || undefined,
        situacao: f.situacao || undefined,
        cliente_id: f.cliente_id || undefined,
        responsavel_id: f.responsavel_id || undefined,
        com_intimacao: f.com_intimacao || undefined,
        sem_caso: f.sem_caso || undefined,
        pagina: f.pagina ?? 1,
        por_pagina: POR_PAGINA_PROCESSOS,
      }),
    placeholderData: (p) => p,
  });
}

export function useProcesso(id: number) {
  return useQuery({ queryKey: [CHAVE, "processo", id], queryFn: () => api.get<ProcessoDetalhe>(`/tribunais/processos/${id}`), enabled: id > 0 });
}

export const POR_PAGINA_MOVS = 100;

export function useMovimentacoes(id: number, f: { so_intimacoes?: boolean; nao_lidas?: boolean; pagina?: number }) {
  return useQuery({
    queryKey: [CHAVE, "movs", id, f],
    queryFn: () =>
      api.get<Lista<Movimentacao>>(`/tribunais/processos/${id}/movimentacoes`, {
        so_intimacoes: f.so_intimacoes || undefined,
        nao_lidas: f.nao_lidas || undefined,
        pagina: f.pagina ?? 1,
        por_pagina: POR_PAGINA_MOVS,
      }),
    enabled: id > 0,
    placeholderData: (p) => p,
  });
}

export function useProcessoDoCaso(casoId: number, enabled = true, intervalo?: (p: ProcessoResumo | null | undefined) => number | false) {
  return useQuery({
    refetchInterval: intervalo ? (q) => intervalo(q.state.data) : undefined,
    queryKey: [CHAVE, "caso", casoId],
    queryFn: () => api.get<ProcessoResumo | null>(`/tribunais/casos/${casoId}/processo`),
    enabled,
    meta: { silencioso: true },
  });
}

// ---------------------------------------------------------------- importação ao salvar o caso
/** Caso salvo com nº CNJ: o backend importa o processo em segundo plano; a ficha acompanha por esta janela. */
export const JANELA_MS = 120_000;
const importacoesDoCaso = new Map<number, number>();

export function marcarImportacaoDoCaso(casoId: number) {
  importacoesDoCaso.set(casoId, Date.now());
}

export function msDesdeImportacaoDoCaso(casoId: number) {
  const t = importacoesDoCaso.get(casoId);
  return t ? Date.now() - t : Infinity;
}
