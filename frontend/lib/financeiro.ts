// Financeiro: espelho de backend/app/modules/financas/schemas.py (Decimal chega como string).

import type { Decimal } from "./types";

export type TipoConta = "corrente" | "poupanca" | "pagamento" | "caixa" | "investimento";

export interface ContaOut {
  id: number;
  nome: string;
  banco: string | null;
  agencia: string | null;
  numero: string | null;
  tipo: TipoConta;
  titular: string | null;
  emissora_id: number | null;
  saldo_inicial: Decimal;
  data_saldo_inicial: string | null;
  cor: string;
  ativo: boolean;
  saldo_atual: Decimal;
  entradas_mes: Decimal;
  saidas_mes: Decimal;
  qtd_lancamentos: number;
}
export type TipoLancamento = "credito" | "debito";
export type TipoCategoria = "receita" | "despesa";
export type GrupoDre =
  | "receita_bruta"
  | "deducoes"
  | "outras_receitas"
  | "pessoal"
  | "custos"
  | "administrativas"
  | "financeiras"
  | "impostos_lucro"
  | "investimentos"
  | "retiradas";
export type FormaPagamento = "pix" | "boleto" | "ted" | "dinheiro" | "cartao" | "debito" | "outro";

export interface ContaIn {
  nome: string;
  banco: string | null;
  agencia: string | null;
  numero: string | null;
  tipo: TipoConta;
  titular: string | null;
  emissora_id: number | null;
  saldo_inicial: string;
  data_saldo_inicial: string | null;
  cor: string;
  ativo: boolean;
}

export interface LancamentoIn {
  data: string;
  descricao: string;
  tipo: TipoLancamento;
  valor: string;
  categoria_id: number | null;
  subcategoria_id: number | null;
  fornecedor_id: number | null;
  funcionario_id: number | null;
  favorecido: string | null;
  documento: string | null;
  observacao: string | null;
}

export interface LancamentoOut extends Omit<LancamentoIn, "valor"> {
  id: number;
  conta_id: number;
  valor: Decimal;
  categoria_nome: string | null;
  subcategoria_nome: string | null;
  favorecido_nome: string | null;
  /** manual | fatura | conta_pagar | transferencia | importacao … */
  origem: string;
  transferencia_par_id: number | null;
  fatura_id: number | null;
  fatura_codigo: string | null;
  conta_pagar_id: number | null;
  saldo: Decimal | null;
  editavel: boolean;
}

export interface ExtratoOut {
  conta: ContaOut;
  de: string;
  ate: string;
  saldo_anterior: Decimal;
  entradas: Decimal;
  saidas: Decimal;
  saldo_periodo: Decimal;
  saldo_final: Decimal;
  linhas: LancamentoOut[];
}

export interface TransferenciaIn {
  origem_id: number;
  destino_id: number;
  data: string;
  valor: string;
  descricao: string | null;
}

export interface SubcategoriaOut {
  id: number;
  categoria_id: number;
  nome: string;
  ativo: boolean;
  uso: number;
}

export interface CategoriaOut {
  id: number;
  nome: string;
  tipo: TipoCategoria;
  grupo_dre: GrupoDre | null;
  cor: string | null;
  ativo: boolean;
  subcategorias: SubcategoriaOut[];
  uso_contas: number;
  uso_lancamentos: number;
  /** veio de importação com nome estranho */
  revisar: boolean;
}

export interface FornecedorIn {
  nome: string;
  tipo: "PF" | "PJ";
  cpf_cnpj: string | null;
  email: string | null;
  telefone: string | null;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  categoria_padrao_id: number | null;
  observacao: string | null;
  ativo: boolean;
}

export interface FornecedorOut extends FornecedorIn {
  id: number;
  qtd_contas: number;
  total_pago_12m: Decimal;
}

export interface RateioIn {
  categoria_id: number;
  subcategoria_id: number | null;
  valor: string;
}

export interface RateioOut {
  categoria_id: number;
  categoria_nome: string | null;
  subcategoria_id: number | null;
  subcategoria_nome: string | null;
  valor: Decimal;
  percentual: Decimal;
}

export interface ContaPagarIn {
  descricao: string | null;
  fornecedor_id: number | null;
  funcionario_id: number | null;
  favorecido: string | null;
  data_vencimento: string;
  data_competencia: string | null;
  forma_pagamento: FormaPagamento | null;
  documento: string | null;
  codigo_barras: string | null;
  observacao: string | null;
  conta_bancaria_id: number | null;
  rateio: RateioIn[];
  /** só na criação: 0 = não repete; 1 mensal, 2 bimestral, 3 trimestral, 6 semestral, 12 anual */
  recorrencia_meses: number;
  recorrencia_indeterminada: boolean;
  repeticoes: number | null;
}

export interface ContaPagarOut {
  id: number;
  descricao: string;
  fornecedor_id: number | null;
  funcionario_id: number | null;
  favorecido: string | null;
  favorecido_nome: string;
  categoria_id: number | null;
  categoria_nome: string | null;
  subcategoria_nome: string | null;
  valor: Decimal;
  data_vencimento: string;
  data_competencia: string | null;
  forma_pagamento: FormaPagamento | null;
  documento: string | null;
  codigo_barras: string | null;
  observacao: string | null;
  grupo_recorrencia: string | null;
  recorrencia_meses: number;
  recorrencia_indeterminada: boolean;
  parcela: number | null;
  parcelas_total: number | null;
  conta_bancaria_id: number | null;
  conta_bancaria_nome: string | null;
  data_pagamento: string | null;
  valor_pago: Decimal | null;
  juros: Decimal;
  desconto: Decimal;
  /** pendente | atrasado | pago */
  status: string;
  dias_atraso: number;
  tem_anexo: boolean;
  tem_comprovante: boolean;
  agendamento_enviado_em: string | null;
  rateio: RateioOut[];
}

export interface ContasPagarListaOut {
  itens: ContaPagarOut[];
  total: number;
  kpis: Record<string, unknown>;
}

export interface ConfigFinanceiroOut {
  conta_recebimento_id: number | null;
  categoria_honorarios_id: number | null;
  categoria_reembolso_id: number | null;
  saldo_minimo: Decimal;
  agendamento_destinatarios: string[];
}

// ---------------------------------------------------------------- rótulos
export const ROTULO_TIPO_CONTA: Record<TipoConta, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupança",
  pagamento: "Conta de pagamento",
  caixa: "Caixa",
  investimento: "Investimento",
};

export const ROTULO_GRUPO_DRE: Record<GrupoDre, string> = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções (impostos sobre faturamento)",
  outras_receitas: "Outras receitas",
  pessoal: "Pessoal",
  custos: "Custos",
  administrativas: "Despesas administrativas",
  financeiras: "Despesas financeiras",
  impostos_lucro: "IRPJ / CSLL",
  investimentos: "Investimentos",
  retiradas: "Retiradas (pró-labore, lucros)",
};

export const ROTULO_FORMA: Record<FormaPagamento, string> = {
  pix: "PIX",
  boleto: "Boleto",
  ted: "TED",
  dinheiro: "Dinheiro",
  cartao: "Cartão",
  debito: "Débito automático",
  outro: "Outro",
};

/** "1.234,56" | "5.000" | "1234.56" → "1234.56" (para a API) */
export const paraDecimalApi = (s: string) => {
  const t = s.trim();
  if (!t) return "0";
  // vírgula = decimal brasileiro; sem vírgula, "5.000" é milhar e "5.5" é decimal
  const n = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  return String(Number(n) || 0);
};
/** número → "1.234,56" */
export const paraBr = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
