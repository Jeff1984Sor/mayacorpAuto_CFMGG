// Tipos do comissionamento: espelham app/modules/comissoes (routes.py e service.apurar).

export type AlcanceComissao = "geral" | "cliente" | "contrato" | "caso";
export type SituacaoComissao = "a_pagar" | "conta_gerada" | "paga";

/** Regra de comissão de um profissional (Configurações › Profissionais › ficha). */
export interface RegraComissaoOut {
  id: number;
  usuario_id: number;
  alcance: AlcanceComissao;
  tomador_id: number | null;
  contrato_id: number | null;
  caso_id: number | null;
  percentual: string;
  vigencia_inicio: string | null;
  ativo: boolean;
  observacao: string | null;
  alvo: string | null;
  alvo_detalhe: string | null;
}

export interface RegraComissaoIn {
  alcance: AlcanceComissao;
  tomador_id: number | null;
  contrato_id: number | null;
  caso_id: number | null;
  percentual: number;
  vigencia_inicio: string | null;
  ativo: boolean;
  observacao?: string | null;
}

export interface AlvoComissao {
  id: number;
  rotulo: string;
  detalhe: string | null;
}

/** Uma fatia de comissão: recebimento (fatura paga) × profissional × caso. */
export interface LinhaComissao {
  /** "fatura:profissional": a unidade que vira conta a pagar. */
  chave: string;
  fatura_id: number;
  fatura: string;
  usuario_id: number;
  profissional: string;
  pago_em: string;
  situacao: SituacaoComissao;
  conta_pagar_id: number | null;
  conta_descricao: string | null;
  conta_vencimento: string | null;
  conta_pagamento: string | null;
  cliente_id: number | null;
  cliente: string;
  pagador_id: number | null;
  contrato_id: number | null;
  contrato: string | null;
  caso_id: number | null;
  caso: string | null;
  area_id: number | null;
  area: string | null;
  base: number;
  percentual: number | null;
  comissao: number;
  regra_id: number | null;
  alcance: AlcanceComissao | null;
  regra: string | null;
  divergencia: string | null;
}

export interface ApuracaoComissoes {
  de: string;
  ate: string;
  kpis: {
    base: number;
    comissao: number;
    a_pagar: number;
    conta_gerada: number;
    paga: number;
    recebimentos: number;
    comissoes: number;
    divergencias: number;
  };
  linhas: LinhaComissao[];
  /** Comissões que já viraram conta a pagar, mas o recebimento foi estornado ou a fatura cancelada. */
  divergencias: LinhaComissao[];
  opcoes: { profissionais: { id: number; nome: string }[]; clientes: { id: number; nome: string }[] };
}

export interface GerarContaComissaoOut {
  contas: { id: number; descricao: string; valor: number; usuario_id: number; profissional: string; comissoes: number }[];
  ja_lancadas: number;
  categoria: string;
}

export const ROTULO_ALCANCE: Record<AlcanceComissao, string> = { geral: "Geral", cliente: "Cliente", contrato: "Contrato", caso: "Caso" };
export const ROTULO_SITUACAO: Record<SituacaoComissao, string> = { a_pagar: "A pagar", conta_gerada: "Conta gerada", paga: "Paga" };

export const pctFmt = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
