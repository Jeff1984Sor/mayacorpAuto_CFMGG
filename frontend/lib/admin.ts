// Admin MayaCorp (/api/admin): espelha app/controle/routes_admin.py
import type { Decimal } from "./types";

export type StatusCliente = "teste" | "ativo" | "suspenso" | "inativo";

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

export interface FichaIn {
  nome: string;
  documento: string | null;
  responsavel: string | null;
  email_financeiro: string | null;
  telefone: string | null;
  plano_id: number | null;
  ciclo: "mensal" | "anual";
  inicio_contrato: string | null;
  teste_ate: string | null;
  observacao: string | null;
  indicado_por_id: number | null;
}

export interface ClienteNovoIn extends FichaIn {
  slug: string | null;
  admin_nome: string;
  admin_email: string;
  dias_teste: number | null;
  dominios: string[];
}

export interface ClienteSaaS extends FichaIn {
  id: number;
  slug: string;
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
}

export interface Rotulo {
  chave: string;
  rotulo: string;
}

export interface PoliticaIndicacao {
  desconto_por_indicacao: Decimal;
  desconto_maximo: Decimal;
  teto: Decimal;
}

export const fichaDe = (c: ClienteSaaS): FichaIn => ({
  nome: c.nome,
  documento: c.documento,
  responsavel: c.responsavel,
  email_financeiro: c.email_financeiro,
  telefone: c.telefone,
  plano_id: c.plano_id,
  ciclo: c.ciclo,
  inicio_contrato: c.inicio_contrato,
  teste_ate: c.teste_ate,
  observacao: c.observacao,
  indicado_por_id: c.indicado_por_id,
});
