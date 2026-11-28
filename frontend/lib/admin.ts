// Admin MayaCorp (/api/admin): espelha app/controle/routes_admin.py
import type { CorpoCadastro } from "@/components/clientes/cadastro-form";

import type { Decimal } from "./types";

export type StatusCliente = "teste" | "ativo" | "suspenso" | "inativo";

/** "escritorio" usa o MayaJus; "externo" é cliente da MayaCorp sem acesso ao sistema (só ficha e cobrança). */
export type TipoCliente = "escritorio" | "externo";

export const ROTULO_TIPO: Record<TipoCliente, string> = {
  escritorio: "Usa o MayaJus",
  externo: "Sem acesso ao sistema",
};

/** Situação de quem não tem acesso ao sistema: só "ativo" (é cobrado) e "inativo" (não é cobrado). */
export const ROTULO_STATUS_EXTERNO: Record<"ativo" | "inativo", string> = {
  ativo: "Ativo",
  inativo: "Inativo (não é cobrado)",
};

export const ROTULO_STATUS: Record<StatusCliente, string> = {
  teste: "Em teste",
  ativo: "Ativo",
  suspenso: "Suspenso (avisado)",
  inativo: "Inativo (sem acesso)",
};

export const TOM_STATUS: Record<StatusCliente, "info" | "success" | "warning" | "neutral"> = {
  teste: "info",
  ativo: "success",
  suspenso: "warning",
  inativo: "neutral",
};

export interface PlanoOut {
  id: number;
  nome: string;
  preco_mensal: Decimal;
  preco_anual: Decimal;
  usuarios: number | null;
  notas_mes: number | null;
  preco_nota_excedente: Decimal;
  preco_usuario_adicional: Decimal;
  recursos: string[];
  ativo: boolean;
  ordem: number;
}

export type PlanoIn = Omit<PlanoOut, "id">;

/** O que é só do admin (comercial): plano, contrato, teste, indicação, robôs e a observação interna. */
export interface ComercialIn {
  plano_id: number | null;
  ciclo: "mensal" | "anual";
  inicio_contrato: string | null;
  teste_ate: string | null;
  observacao: string | null;
  indicado_por_id: number | null;
  robos?: string[];
}

/**
 * A ficha como o admin devolve. Nome, documento, responsável, e-mail do financeiro e telefone são a cópia do
 * cadastro completo do cliente (o de Cadastros › Clientes, em `tomador_id`): o e-mail do financeiro é o 1º e-mail,
 * o telefone é o 1º telefone e o responsável é o contato principal. Mudam só pelo cadastro.
 */
export interface FichaIn extends ComercialIn {
  nome: string;
  documento: string | null;
  responsavel: string | null;
  email_financeiro: string | null;
  telefone: string | null;
}

/** Cliente novo que usa o MayaJus: o cadastro completo mais o plano e o acesso. */
export interface ClienteNovoIn extends ComercialIn {
  cadastro: CorpoCadastro;
  slug: string | null;
  admin_nome: string;
  admin_email: string;
  dias_teste: number | null;
  dominios: string[];
}

/** Cliente novo sem acesso ao sistema: o cadastro completo (para cobrar e emitir a nota) e a observação interna. */
export interface ExternoIn {
  cadastro: CorpoCadastro;
  observacao: string | null;
}

/** Situação do cadastro completo: pronto para a nota fiscal ou o que falta (a mesma regra do emissor). */
export interface SituacaoCadastro {
  tomador_id: number | null;
  completo: boolean;
  /** o CNPJ/CPF é o cadastro de outro cliente: este fica sem cadastro até corrigir */
  conflito: string | null;
  pendencias: string[];
}

/** "CEP, logradouro e e-mail" */
export const listarPendencias = (p: string[]) =>
  p.length <= 1 ? (p[0] ?? "") : `${p.slice(0, -1).join(", ")} e ${p[p.length - 1]}`;

export interface DarAcessoIn {
  admin_nome: string;
  admin_email: string | null;
  plano_id: number | null;
  ciclo: "mensal" | "anual";
  inicio_contrato: string | null;
  dias_teste: number | null;
  dominios: string[];
}

export interface ClienteSaaS extends FichaIn {
  id: number;
  /** o cadastro completo deste cliente em Cadastros › Clientes do admin */
  tomador_id: number | null;
  cadastro: SituacaoCadastro;
  slug: string;
  tipo: TipoCliente;
  /** sem acesso hoje, mas o ambiente de quando tinha continua guardado */
  ambiente_guardado: boolean;
  boas_vindas_para?: string | null;
  ambiente_de_antes?: boolean;
  status: StatusCliente;
  status_rotulo: string;
  criado_em: string;
  plano: PlanoOut | null;
  valor: Decimal | null;
  valor_com_desconto: Decimal | null;
  desconto_percentual: Decimal;
  indicacoes_ativas: number;
  indicado_por: { id: number; nome: string } | null;
  banco_principal: boolean;
  dominios: { id: number; host: string }[];
  convite?: string;
}

export interface ResumoAdmin {
  clientes: number;
  por_status: Record<StatusCliente, number>;
  mrr: Decimal;
  sem_acesso: number;
}

export interface UsoCliente {
  mes: string;
  usuarios: number;
  limite_usuarios: number | null;
  notas_mes: number;
  limite_notas: number | null;
  usuarios_excedentes: number;
  notas_excedentes: number;
  valor_excedente: Decimal;
}

export interface UsuarioCliente {
  id: number;
  nome: string;
  email: string;
  login: string | null;
  ativo: boolean;
  acesso_sistema: boolean;
  convite_pendente: boolean;
  perfil: string;
  ultimo_acesso: string | null;
}

export interface ModeloContrato {
  id: number;
  nome: string;
  corpo: string;
  ativo: boolean;
  atualizado_em: string;
  variaveis_desconhecidas: string[];
}

export interface ContratoCliente {
  id: number;
  cliente_id: number;
  modelo_id: number | null;
  titulo: string;
  corpo: string;
  status: "rascunho" | "enviado" | "assinado" | "cancelado";
  enviado_para: string[];
  enviado_em: string | null;
  criado_em: string;
  variaveis_vazias?: string[];
  cliente_nome?: string;
}

export const ROTULO_CONTRATO: Record<ContratoCliente["status"], [string, "neutral" | "info" | "success" | "danger"]> = {
  rascunho: ["Rascunho", "neutral"],
  enviado: ["Enviado", "info"],
  assinado: ["Assinado", "success"],
  cancelado: ["Cancelado", "danger"],
};

export interface Rotulo {
  chave: string;
  rotulo: string;
}

export interface PoliticaIndicacao {
  desconto_por_indicacao: Decimal;
  desconto_maximo: Decimal;
  teto: Decimal;
}

export const comercialDe = (c: ClienteSaaS): ComercialIn => ({
  plano_id: c.plano_id,
  ciclo: c.ciclo,
  inicio_contrato: c.inicio_contrato,
  teste_ate: c.teste_ate,
  observacao: c.observacao,
  indicado_por_id: c.indicado_por_id,
  robos: c.robos ?? [],
});

// ---------------------------------------------------------------- cobrança (Mercado Pago)
export type StatusCobranca = "pendente" | "vencida" | "paga" | "cancelada";

export const TOM_COBRANCA: Record<StatusCobranca, "info" | "danger" | "success" | "neutral"> = {
  pendente: "info",
  vencida: "danger",
  paga: "success",
  cancelada: "neutral",
};

export interface Cobranca {
  id: number;
  cliente_id: number;
  cliente_nome: string;
  cliente_tipo: TipoCliente;
  tipo: "mensalidade" | "avulsa" | "cartao" | "recorrente";
  recorrencia_id: number | null;
  /** por que o e-mail não saiu (ex.: "falta o e-mail do financeiro"); só nas cobranças em aberto */
  envio_erro: string | null;
  competencia: string | null;
  descricao: string;
  itens: { descricao: string; valor: Decimal }[];
  valor: Decimal;
  vencimento: string;
  status: StatusCobranca;
  status_rotulo: string;
  link: string | null;
  pago_em: string | null;
  forma_paga: string | null;
  avisos: number[];
  criado_em: string;
  /** NFS-e da MayaCorp para o escritório (emitida no admin quando a cobrança é paga) */
  nfse_status: "emitindo" | "emitida" | "erro" | "cancelada" | null;
  nfse_id: number | null;
  nfse_numero: number | null;
  nfse_chave: string | null;
  nfse_erro: string | null;
  nfse_em: string | null;
}

export interface ResumoCobranca {
  em_aberto: Decimal;
  vencido: Decimal;
  recebido_mes: Decimal;
  inadimplentes: number;
  /** mensalidades de plano + recorrências ativas, tudo trazido para o mês */
  receita_recorrente: Decimal;
  receita_planos: Decimal;
  nao_enviadas: number;
}

export const ROTULO_TIPO_COBRANCA: Record<Cobranca["tipo"], string> = {
  mensalidade: "Mensalidade",
  avulsa: "Avulsa",
  recorrente: "Recorrente",
  cartao: "Cartão (assinatura)",
};

export interface ConfigCobranca {
  conectado: boolean;
  segredo_definido: boolean;
  conta: string | null;
  dia_vencimento: number;
  gerar_automatico: boolean;
  regua: number[];
  url_notificacao: string | null;
  /** emitir a NFS-e da mensalidade quando a cobrança for paga */
  nfse_automatica: boolean;
  nfse_emissora_id: number | null;
  nfse_descricao: string | null;
}

export interface PagamentoCliente {
  forma_pagamento: "link" | "cartao";
  assinatura_id: string | null;
  assinatura_status: string | null;
  link?: string;
}

export const ROTULO_ASSINATURA: Record<string, string> = {
  pending: "aguardando o cliente cadastrar o cartão",
  authorized: "ativa",
  paused: "pausada",
  cancelled: "cancelada",
};

export interface MeuPlano {
  nome: string;
  status: StatusCliente;
  teste_ate: string | null;
  ciclo: "mensal" | "anual";
  plano: PlanoOut | null;
  valor: Decimal | null;
  forma_pagamento: "link" | "cartao";
  assinatura_status: string | null;
  pode_alterar: boolean;
  uso: UsoCliente;
  planos: PlanoOut[];
  recursos: Rotulo[];
  em_aberto: Cobranca[];
  pagas: Cobranca[];
}

/** Passo da régua em palavras: -3 → "3 dias antes", 0 → "no dia", 5 → "5 dias depois". */
export const passoRegua = (d: number) => (d === 0 ? "no dia" : d < 0 ? `${-d} dia(s) antes` : `${d} dia(s) depois`);
