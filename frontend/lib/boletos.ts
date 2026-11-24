/** Tipos dos boletos (CNAB 240). Espelham os schemas de backend/app/modules/boletos/routes.py. */

type Decimal = string;

export type StatusBoleto =
  | "rascunho"
  | "em_remessa"
  | "registrado"
  | "rejeitado"
  | "pago"
  | "baixado"
  | "em_protesto"
  | "protestado"
  | "cancelado";

export interface Motivo {
  codigo: string;
  descricao: string;
}

export interface OcorrenciaBoleto {
  id: number;
  origem: "retorno" | "remessa" | "sistema";
  codigo_movimento: string;
  descricao: string;
  motivos: Motivo[];
  data_ocorrencia: string | null;
  valor_pago: Decimal | null;
  alerta: string | null;
  criado_em: string;
}

export interface Pagador {
  pagador_nome: string;
  pagador_documento: string;
  pagador_endereco: string;
  pagador_bairro: string;
  pagador_cep: string;
  pagador_cidade: string;
  pagador_uf: string;
}

export interface BoletoOut extends Pagador {
  id: number;
  convenio_id: number;
  convenio_nome: string;
  banco: string;
  fatura_id: number | null;
  fatura_codigo: string | null;
  tomador_id: number | null;
  descricao: string;
  seu_numero: string;
  nosso_numero: string | null;
  nosso_numero_fmt: string | null;
  valor: Decimal;
  data_emissao: string;
  data_vencimento: string;
  codigo_barras: string;
  linha_digitavel: string;
  linha_digitavel_fmt: string;
  status: StatusBoleto;
  status_rotulo: string;
  /** 02 = pedido de baixa, 06 = alteração de vencimento (esperando a próxima remessa) */
  instrucao_pendente: string | null;
  novo_vencimento: string | null;
  valor_pago: Decimal | null;
  valor_liquido: Decimal | null;
  data_pagamento: string | null;
  data_credito: string | null;
  tarifa: Decimal | null;
  motivos: Motivo[];
  remessa_id: number | null;
  remessa_sequencial: number | null;
  /** só o que ainda não foi para o banco pode ser editado ou excluído */
  editavel: boolean;
  /** o banco já confirmou o registro: pode ir para o cliente */
  pode_enviar_ao_cliente: boolean;
  ocorrencias: OcorrenciaBoleto[];
}

export interface ConvenioIn {
  nome: string;
  emissora_id: number;
  conta_bancaria_id: number | null;
  banco: string;
  agencia: string;
  agencia_dv: string;
  conta: string;
  conta_dv: string;
  codigo_beneficiario: string;
  codigo_transmissao: string;
  carteira: string;
  tipo_cobranca: string;
  forma_cadastramento: string;
  tipo_documento: string;
  especie_titulo: string;
  numeracao: "EMPRESA" | "BANCO";
  proximo_nosso_numero: number;
  proximo_sequencial_arquivo: number;
  codigo_juros: string;
  juros_mensal_pct: Decimal;
  multa_pct: Decimal;
  codigo_protesto: string;
  dias_protesto: number;
  codigo_baixa: string;
  dias_baixa: number;
  mensagem_1: string | null;
  mensagem_2: string | null;
  instrucoes: string | null;
  pix_habilitado: boolean;
  pix_chave_tipo: string | null;
  pix_chave: string | null;
  ativo: boolean;
  homologado: boolean;
}

export interface ConvenioOut extends ConvenioIn {
  id: number;
  banco_nome: string;
  emissora_nome: string;
  qtd_boletos: number;
  /** o que falta no cadastro para poder emitir */
  pendencias: string[];
}

export interface CampoDoBanco {
  rotulo: string;
  obrigatorio: boolean;
  tamanho: number;
  dica?: string;
}

export interface BancoBoleto {
  codigo: string;
  nome: string;
  opcoes: Record<string, Record<string, string>>;
  /** valores usuais do banco, aplicados ao escolhê-lo no convênio */
  padroes: Partial<ConvenioIn>;
  /** campos que mudam de banco para banco; null = o banco não usa */
  campos: { codigo_beneficiario?: CampoDoBanco | null; codigo_transmissao?: CampoDoBanco | null; conta_tamanho?: number };
}

export interface RemessaOut {
  id: number;
  convenio_id: number;
  convenio_nome: string;
  sequencial: number;
  gerado_em: string;
  nome_arquivo: string;
  qtd_boletos: number;
  valor_total: Decimal;
  ambiente: "teste" | "producao";
}

export interface RemessaPendente {
  entradas: number;
  instrucoes: number;
  valor: Decimal;
  teste: boolean;
  pendencias: string[];
}

export interface LinhaRetorno {
  codigo: string;
  descricao: string;
  nosso_numero: string;
  seu_numero: string;
  pagador: string;
  valor: Decimal;
  valor_pago: Decimal | null;
  data: string | null;
  motivos: Motivo[];
  boleto_id: number | null;
  resultado: "registrados" | "rejeitados" | "pagos" | "baixados" | "alterados" | "outras" | "orfas" | "repetidas";
  alerta: string | null;
}

export interface RetornoOut {
  id: number;
  convenio_id: number;
  convenio_nome: string;
  importado_em: string;
  nome_arquivo: string;
  qtd_ocorrencias: number;
  qtd_orfas: number;
  resumo: {
    contagem: Record<LinhaRetorno["resultado"], number>;
    avisos: string[];
    linhas?: LinhaRetorno[];
  };
}

export interface FaturaDisponivel {
  id: number;
  codigo: string;
  cliente: string;
  total: Decimal;
  sugestao: Pagador & { tomador_id: number | null; valor: Decimal; data_vencimento: string; descricao: string };
}

export interface ResumoBoletos {
  por_status: Record<StatusBoleto, { qtd: number; total: Decimal }>;
  aguardando_remessa: number;
  instrucoes_pendentes: number;
}

export interface PreviaEmail {
  para: string[];
  assunto: string;
  corpo: string;
  anexos: { tipo: "boleto" | "fatura" | "nfse"; nome: string; rotulo: string }[];
  pode_enviar: boolean;
  aviso: string | null;
}

export const TOM_STATUS: Record<StatusBoleto, "success" | "warning" | "danger" | "info" | "neutral" | "brand"> = {
  rascunho: "warning",
  em_remessa: "info",
  registrado: "brand",
  rejeitado: "danger",
  pago: "success",
  baixado: "neutral",
  em_protesto: "danger",
  protestado: "danger",
  cancelado: "neutral",
};

export const ROTULO_RESULTADO: Record<LinhaRetorno["resultado"], string> = {
  registrados: "Registrado",
  rejeitados: "Rejeitado",
  pagos: "Pago",
  baixados: "Baixado",
  alterados: "Vencimento alterado",
  outras: "Outra ocorrência",
  orfas: "Sem boleto no sistema",
  repetidas: "Já importada antes",
};
