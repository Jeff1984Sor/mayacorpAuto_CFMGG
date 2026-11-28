// Conciliação bancária: espelho de backend/app/modules/financas/routes_conciliacao.py (Decimal chega como string).

import { ApiError } from "./api";
import type { TipoLancamento } from "./financeiro";
import type { Decimal } from "./types";

export type SituacaoLinha = "conciliada" | "baixa_sugerida" | "sem_correspondencia" | "feita" | "ignorada";
export type TipoTitulo = "conta_pagar" | "fatura";

export interface TituloOut {
  tipo: TipoTitulo;
  id: number;
  /** descrição da conta a pagar ou código da fatura */
  rotulo: string;
  /** favorecido ou cliente */
  nome: string;
  valor: Decimal;
  /** fatura com retenção: o que o cliente deposita */
  valor_liquido: Decimal | null;
  vencimento: string;
}

export interface VinculoOut {
  /** vinculo | conta_criada | receita_avulsa | baixa_conta | baixa_fatura */
  tipo: string;
  rotulo: string;
  lancamento_id: number | null;
  conta_pagar_id: number | null;
  fatura_id: number | null;
}

export interface SugestaoOut {
  descricao: string;
  categoria_id: number | null;
  subcategoria_id: number | null;
  fornecedor_id: number | null;
  funcionario_id: number | null;
  favorecido: string | null;
  natureza: string | null;
  /** de onde veio a sugestão: regra (aprendida) | cadastro | palavras | ia */
  origem: string | null;
  aviso: string | null;
}

export interface LinhaOut {
  id: number;
  data: string;
  tipo: TipoLancamento;
  valor: Decimal;
  descricao: string;
  documento: string | null;
  situacao: SituacaoLinha;
  confianca: "alta" | "media" | null;
  motivo: string | null;
  aviso: string | null;
  sugestao: SugestaoOut | null;
  titulos: TituloOut[];
  vinculos: VinculoOut[];
}

export interface SoNoSistemaOut {
  id: number;
  data: string;
  tipo: TipoLancamento;
  valor: Decimal;
  descricao: string;
  origem: string;
  fatura_id: number | null;
  conta_pagar_id: number | null;
}

export interface ResumoConciliacao {
  pagar_criar: number;
  receber_criar: number;
  baixas: number;
  baixas_alta: number;
  conciliadas: number;
  feitas: number;
  ignoradas: number;
  so_no_sistema: number;
  pendentes: number;
  valor_pagar_criar: Decimal;
  valor_receber_criar: Decimal;
}

export interface FechamentoOut {
  data: string;
  saldo_extrato: Decimal | null;
  saldo_sistema: Decimal;
  diferenca: Decimal | null;
  /** quanto das linhas ainda pendentes explica a diferença */
  a_lancar: Decimal;
  sem_explicacao: Decimal | null;
}

export interface ConciliacaoOut {
  id: number;
  conta_id: number;
  conta_nome: string;
  arquivo_nome: string;
  formato: string;
  banco: string | null;
  periodo_de: string;
  periodo_ate: string;
  criado_em: string;
  usuario_nome: string | null;
  qtd_linhas: number;
  qtd_repetidas: number;
  resumo: ResumoConciliacao;
}

export interface ConciliacaoDetalhe extends ConciliacaoOut {
  linhas: LinhaOut[];
  so_no_sistema: SoNoSistemaOut[];
  fechamento: FechamentoOut;
  ia_disponivel: boolean;
}

export interface EnvioOut {
  id: number;
  ja_importado: boolean;
  novas: number;
  repetidas: number;
  mensagem: string;
}

export interface ResultadoOut {
  feitas: number;
  ja_feitas: number;
  mensagem: string;
  conciliacao: ConciliacaoDetalhe;
}

export interface NaoDesfeita {
  linha_id: number;
  descricao: string;
  valor: Decimal;
  motivo: string;
}

export interface DesfeitoOut {
  desfeitas: number;
  avisos: string[];
  nao_desfeitas: NaoDesfeita[];
  excluida: boolean;
  mensagem: string;
  conciliacao: ConciliacaoDetalhe | null;
}

export interface RegraOut {
  id: number;
  tipo: TipoLancamento;
  padrao: string;
  exemplo: string | null;
  natureza: string | null;
  categoria_nome: string | null;
  subcategoria_nome: string | null;
  favorecido_nome: string | null;
  usos: number;
}

export interface ItemPagar {
  linha_id: number;
  descricao: string;
  categoria_id: number | null;
  subcategoria_id: number | null;
  fornecedor_id: number | null;
  funcionario_id: number | null;
  favorecido: string | null;
}

export interface ItemReceber {
  linha_id: number;
  modo: "avulsa" | "fatura";
  descricao: string;
  categoria_id: number | null;
  subcategoria_id: number | null;
  favorecido: string | null;
  fatura_ids: number[];
}

export interface ItemBaixa {
  linha_id: number;
  titulo: TipoTitulo;
  ids: number[];
}

export const ROTULO_ORIGEM_SUGESTAO: Record<string, string> = {
  regra: "aprendido",
  cadastro: "do cadastro",
  palavras: "pela descrição",
  ia: "IA",
};

/** Quando o servidor recusa o lote, ele diz em que linha e por quê (nada é gravado). */
export function problemasDoLote(e: unknown): { mensagem: string; linhas: Record<number, string> } {
  const linhas: Record<number, string> = {};
  let mensagem = e instanceof Error ? e.message : "Não foi possível gravar.";
  if (e instanceof ApiError && e.body && typeof e.body === "object" && "detail" in e.body) {
    const d = (e.body as { detail: unknown }).detail;
    if (d && typeof d === "object" && !Array.isArray(d)) {
      const det = d as { mensagem?: string; linhas?: { linha_id: number; motivo: string }[] };
      if (det.mensagem) mensagem = det.mensagem;
      (det.linhas ?? []).forEach((l) => {
        linhas[l.linha_id] = l.motivo;
      });
    }
  }
  return { mensagem, linhas };
}
