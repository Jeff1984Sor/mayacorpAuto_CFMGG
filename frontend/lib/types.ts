// Espelho dos schemas Pydantic (backend/app/core/schemas.py e backend/app/modules/rpa_nfse/schemas.py).
// Decimal chega como string no JSON.

export type Decimal = string;
export type Perfil = "admin" | "operador" | "visualizador";

export interface Pagina<T> {
  itens: T[];
  total: number;
  pagina: number;
  por_pagina: number;
}

export interface UsuarioMe {
  id: number;
  nome: string;
  email: string;
  login: string | null;
  perfil: Perfil;
  tenant_id: number;
  /** Exige Bearer: buscar com fetch → blob (ver hooks/use-foto). */
  foto_url: string | null;
  /** Equipe MayaCorp: gerencia configurações restritas (ex.: IA). */
  equipe_mayacorp: boolean;
  /** Preferências de interface salvas no servidor (acompanham o usuário em qualquer computador). */
  preferencias?: { menu_recolhido?: string[] } & Record<string, unknown>;
}

export interface TokenOut {
  access_token: string;
  refresh_token: string;
  token_type: string;
  usuario: UsuarioMe;
}

export interface IdentidadePublica {
  nome_exibicao: string;
  logo_url: string | null;
  cor_destaque: string | null;
}

export interface IdentidadeOut extends IdentidadePublica {
  assinatura_email: string | null;
}

export interface CertificadoOut {
  id: number;
  titular: string;
  cnpj: string | null;
  emissor: string;
  valido_de: string;
  valido_ate: string;
  dias_restantes: number;
  serial: string;
  ativo: boolean;
  ultimo_teste_em: string | null;
  ultimo_teste_ok: boolean | null;
  ultimo_teste_msg: string | null;
  criado_em: string;
}

export interface TesteConexaoOut {
  ok: boolean;
  mensagem: string;
  detalhe: string | null;
}

export interface UsuarioOut {
  id: number;
  nome: string;
  email: string;
  login: string | null;
  foto_url: string | null;
  perfil: Perfil;
  ativo: boolean;
  convite_pendente: boolean;
  ultimo_acesso: string | null;
  online: boolean;
  acesso_sistema: boolean;
  cargo_id: number | null;
  cargo_nome: string | null;
  cpf: string | null;
  oab: string | null;
  telefone: string | null;
  data_admissao: string | null;
  cep: string | null;
  logradouro: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

export interface NotificacoesOut {
  remetente_nome: string;
  remetente_email: string;
  smtp_host: string | null;
  smtp_porta: number;
  smtp_usuario: string | null;
  smtp_senha_definida: boolean;
  assunto_modelo: string;
  corpo_modelo: string;
  anexar_pdf: boolean;
  anexar_xml: boolean;
  envio_automatico: boolean;
  avisos_destinatarios: string[];
  aviso_fim_lote: boolean;
  aviso_rejeicoes: boolean;
  aviso_certificado: boolean;
  /** versão HTML do e-mail com o logo do escritório no topo */
  email_logo: boolean;
  email_cc_padrao: string[];
  email_cco_padrao: string[];
}

export interface AuditoriaOut {
  id: number;
  usuario_nome: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  descricao: string | null;
  antes_json: Record<string, unknown> | null;
  depois_json: Record<string, unknown> | null;
  ip: string | null;
  criado_em: string;
}

export interface AutomacaoCard {
  slug: string;
  nome: string;
  descricao: string;
  icone: string;
  status: "ativo" | "planejado" | "ideia" | string;
  href: string | null;
  metrica: string | null;
}

// ---------- NFS-e ----------
export type Regime = "simples" | "presumido" | "real" | "mei";
export type StatusLote =
  | "validando"
  | "na_fila"
  | "transmitindo"
  | "concluido"
  | "parcial"
  | "falhou"
  | "descartado";
export type StatusRps =
  | "ok"
  | "aviso"
  | "erro"
  | "descartado"
  | "na_fila"
  | "transmitindo"
  | "emitido"
  | "rejeitado";
export type StatusNfse = "emitida" | "cancelada";

export interface EmissoraOut {
  id: number;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  ccm: string;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  email: string | null;
  regime: Regime;
  cod_servico_padrao: string | null;
  aliquota_iss: Decimal;
  serie_rps: string;
  prox_rps: number;
  certificado_id: number | null;
  ativa: boolean;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  saude_ok: boolean;
  saude_msg: string;
}

export type EmissoraIn = Omit<EmissoraOut, "id" | "saude_ok" | "saude_msg" | "aliquota_iss"> & {
  aliquota_iss: string | number;
};

export interface TomadorOut {
  id: number;
  tipo: "PF" | "PJ" | "EX";
  nome: string;
  cpf_cnpj: string | null;
  im: string | null;
  ie: string | null;
  tipo_logradouro: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  emails: string[];
  telefone: string | null;
  observacoes: string | null;
  incompleto: boolean;
  qtd_notas: number;
  valor_acumulado: Decimal;
  criado_em: string;
}

export type TomadorIn = Omit<TomadorOut, "id" | "incompleto" | "qtd_notas" | "valor_acumulado" | "criado_em">;

export interface ParametroFiscalIn {
  emissora_id: number;
  escopo: "padrao" | "servico" | "tomador";
  descricao: string | null;
  cod_servico: string | null;
  tomador_id: number | null;
  aliquota_iss: Decimal | number | null;
  nbs: string | null;
  cst_ibscbs: string | null;
  class_trib: string | null;
  ind_operacao: string | null;
  finalidade: string | null;
  ind_final: string | null;
  tipo_operacao: string | null;
  ind_destinatario: string | null;
  tributacao_rps: string;
  prioridade: number;
  ativo: boolean;
}

export interface ParametroFiscalOut extends ParametroFiscalIn {
  id: number;
}

export interface Problema {
  campo: string;
  nivel: "erro" | "aviso" | string;
  mensagem: string;
  /** Ação sugerida em linguagem simples, ex.: "Abrir a nota existente →" */
  acao?: string | null;
  codigo?: number | null;
  /** Retorno técnico da Prefeitura (mostrado em "detalhes técnicos") */
  tecnico?: string | null;
  nfse_id?: number | null;
}

export interface RpsOut {
  id: number;
  linha: number;
  selecionado: boolean;
  serie: string;
  numero: number;
  data_emissao: string;
  tomador_id: number | null;
  tomador_nome: string;
  tomador_doc: string | null;
  tomador_novo: boolean;
  cod_servico: string;
  aliquota: Decimal;
  valor: Decimal;
  deducoes: Decimal;
  iss: Decimal;
  iss_retido: boolean;
  discriminacao: string;
  status: StatusRps;
  erros: Problema[];
  dados: Record<string, unknown>;
  nfse_id: number | null;
  nfse_numero: number | null;
}

export interface RpsPatch {
  selecionado?: boolean;
  descartar?: boolean;
  data_emissao?: string;
  cod_servico?: string;
  aliquota?: string | number;
  valor?: string | number;
  deducoes?: string | number;
  iss_retido?: boolean;
  discriminacao?: string;
  tomador?: Record<string, unknown>;
}

export interface ResumoImportacao {
  qtd: number;
  qtd_selecionados: number;
  valor_total: Decimal;
  iss_total: Decimal;
  tomadores_novos: number;
  com_erro: number;
  com_aviso: number;
  ok: number;
  pode_emitir: boolean;
}

export interface LoteEvento {
  em: string;
  etapa: string;
  texto: string;
  nivel: "info" | "aviso" | "erro" | "sucesso" | string;
}

export interface LoteOut {
  id: number;
  numero: number;
  emissora_id: number;
  emissora_nome: string;
  usuario_nome: string | null;
  arquivo_origem: string;
  qtd: number;
  valor_total: Decimal;
  iss_total: Decimal;
  status: StatusLote;
  sublotes_total: number;
  sublotes_feitos: number;
  qtd_emitidas: number;
  qtd_rejeitadas: number;
  mensagem: string | null;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
}

export interface LoteDetalhe extends LoteOut {
  encoding: string | null;
  eventos: LoteEvento[];
  resumo: ResumoImportacao;
  rps: RpsOut[];
}

export interface ProgressoOut {
  lote_id: number;
  status: StatusLote;
  sublotes_total: number;
  sublotes_feitos: number;
  qtd: number;
  qtd_emitidas: number;
  qtd_rejeitadas: number;
  percentual: number;
  mensagem: string | null;
  eventos: LoteEvento[];
}

export interface NfseOut {
  id: number;
  numero: number;
  cod_verificacao: string;
  data_emissao: string;
  rps_serie: string;
  rps_numero: number;
  lote_id: number;
  emissora_id: number;
  tomador_id: number | null;
  tomador_nome: string;
  tomador_doc: string | null;
  valor: Decimal;
  iss: Decimal;
  status: StatusNfse;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  link_prefeitura: string;
  simulada: boolean;
  pago_em: string | null;
  valor_pago: Decimal | null;
  baixa_origem: string | null;
  fatura_id: number | null;
  fatura_codigo: string | null;
}

export interface NfseDetalhe extends NfseOut {
  discriminacao: string;
  cod_servico: string;
  aliquota: Decimal;
  tomador_emails: string[];
  envios: { id?: number; destinatarios: string[]; status: string; enviado_em: string; erro?: string | null }[];
}

export interface Indicador {
  valor: number;
  anterior: number;
  variacao: number | null;
}

export interface Alerta {
  nivel: "info" | "aviso" | "erro" | string;
  texto: string;
  href: string | null;
}

export interface PainelOut {
  notas_emitidas: Indicador;
  valor_faturado: Indicador;
  iss: Indicador;
  rejeicoes: Indicador;
  tempo_medio_lote_seg: Indicador;
  por_dia: { dia: string; notas: number; valor: number }[];
  top_tomadores: { nome: string; valor: number; notas: number }[];
  status_lotes: { status: string; qtd: number }[];
  alertas: Alerta[];
  ultimos_lotes: LoteOut[];
  a_receber: number;
  a_receber_qtd: number;
  recebido_mes: number;
}

// ---------- Configurações › Prefeitura ----------
export type ModoPrefeitura = "simulado" | "teste" | "producao";

export interface ConfigPrefeituraOut {
  modo: ModoPrefeitura;
  modos_permitidos: ModoPrefeitura[];
  ambiente: string;
  endpoint: string;
}

// ---------- Raio-X do arquivo ----------
export type TipoInsight = "duplicidade" | "valor_atipico" | "ausentes" | "variacao" | "concentracao" | string;

export interface Insight {
  tipo: TipoInsight;
  nivel: "erro" | "aviso" | "info" | string;
  titulo: string;
  texto: string;
  rps_ids: number[];
}

export interface RaioXOut {
  score: number;
  frase: string;
  insights: Insight[];
  comparativo: { lote_anterior: number; valor_anterior: number | string; valor_atual: number | string; variacao: number | null } | null;
  top_clientes: { nome: string; valor: number | string }[];
  previsao_segundos: number;
  sublotes: number;
}

// ---------- Configurações › Automações ----------
export interface ConfigAutomacoes {
  fatura_ativa: boolean;
  fatura_dias_vencimento: number;
  /** "dias": N dias após a emissão · "emissao": vence na data de emissão da nota */
  fatura_vencimento_modo: "dias" | "emissao";
  fatura_instrucoes: string | null;
  fatura_anexar_email: boolean;
  relatorio_emissao_ativo: boolean;
  relatorio_destinatarios: string[];
  relatorio_anexar_planilha: boolean;
  relatorio_anexar_zip: boolean;
  relatorio_baixas_ativo: boolean;
  baixa_automatica: boolean;
  confianca_minima: number;
}

// ---------- Faturas (Notas de Honorários) ----------
export type SituacaoFatura = "aberta" | "vencida" | "paga" | "cancelada";

export interface FaturaOut {
  id: number;
  codigo: string;
  numero: number;
  ano: number;
  /** null em faturas do Faturamento ainda sem NFS-e (e sempre em ND) */
  nfse_id: number | null;
  nfse_numero: number | null;
  lote_id: number | null;
  emissora_id: number;
  tomador_id: number | null;
  tomador_nome: string;
  tomador_doc: string | null;
  /** honorarios = NH · despesas = ND */
  tipo: "honorarios" | "despesas";
  /** nota (Lello) | faturamento (Itens a faturar) */
  origem: "nota" | "faturamento";
  contrato_id: number | null;
  contrato_nome: string | null;
  pode_emitir_nfse: boolean;
  data_emissao: string;
  data_vencimento: string;
  valor: Decimal;
  desconto: Decimal;
  juros: Decimal;
  total: Decimal;
  status: "aberta" | "paga" | "cancelada";
  situacao: SituacaoFatura;
  pago_em: string | null;
  descricao: string;
  pix_copia_e_cola: string | null;
  simulada: boolean;
}

export type ResumoFaturas = Record<SituacaoFatura, { qtd: number; valor: number }>;

// ---------- Recebimentos ----------
export type StatusLancamento = "conciliado" | "sugerido" | "sem_par" | "ignorado" | "duplicado";

export interface NotaResumo {
  id: number;
  numero: number;
  tomador_nome: string;
  valor: Decimal;
  data_emissao: string;
  pago_em: string | null;
  lote_numero: number;
}

export interface LancamentoOut {
  id: number;
  data: string;
  valor: Decimal;
  descricao: string;
  documento: string | null;
  status: StatusLancamento;
  confianca: number;
  motivo: string | null;
  notas: NotaResumo[];
}

export interface ExtratoOut {
  id: number;
  arquivo_nome: string;
  formato: string;
  banco: string | null;
  periodo_de: string | null;
  periodo_ate: string | null;
  qtd_creditos: number;
  qtd_conciliados: number;
  qtd_sugeridos: number;
  valor_creditos: Decimal;
  valor_conciliado: Decimal;
  notas_baixadas: number;
  criado_em: string;
}

export interface ExtratoDetalhe extends ExtratoOut {
  lancamentos: LancamentoOut[];
}

// ---------- Inteligência Artificial ----------
export type ProvedorIA = "openai" | "gemini";

export interface ConfigIAOut {
  ativo: boolean;
  provedor: ProvedorIA;
  modelo: string | null;
  chave_definida: boolean;
  /** Só os 4 últimos caracteres; a chave nunca volta da API. */
  chave_final: string | null;
  provedores: Record<ProvedorIA, string>;
  aviso: string;
  /** Só a equipe MayaCorp altera chave, provedor e modelo. */
  pode_editar: boolean;
}

export interface ConfigIAIn {
  ativo: boolean;
  provedor: ProvedorIA;
  modelo: string | null;
  chave?: string | null;
}

export type NivelPonto = "ok" | "atencao" | "risco";

export interface AnaliseOut {
  titulo: string;
  resumo: string;
  pontos: { nivel: NivelPonto; texto: string }[];
  recomendacao: string;
}

export interface PreenchimentoOut<C = Record<string, unknown>> {
  campos: C;
  avisos: string[];
}

// ---------- E-mail das notas ----------
export type TipoAnexo = "pdf" | "xml" | "fatura";

export interface AnexoEmail {
  tipo: TipoAnexo;
  nome: string;
  tamanho: number;
  padrao: boolean;
}

export interface EnvioEmailHist {
  destinatarios: string[];
  cc?: string[];
  cco?: string[];
  assunto?: string;
  anexos?: string[];
  usuario_nome?: string | null;
  status: string;
  enviado_em: string;
  erro?: string | null;
}

export interface EmailPreviaOut {
  remetente: string;
  para: string[];
  cc: string[];
  cco: string[];
  assunto: string;
  corpo: string;
  anexos: AnexoEmail[];
  emails_cliente: string[];
  cliente_id: number | null;
  envios: EnvioEmailHist[];
}

export interface ModeloEmailOut {
  remetente: string;
  assunto_modelo: string;
  corpo_modelo: string;
  assinatura: string;
  cc: string[];
  cco: string[];
  anexos_padrao: TipoAnexo[];
  variaveis: string[];
}

export interface FiltroNotas {
  q?: string | null;
  status?: string | null;
  emissora_id?: number | null;
  lote_id?: number | null;
  de?: string | null;
  ate?: string | null;
  pagamento?: string | null;
}

export interface EnvioLoteOut {
  total: number;
  enviados: number;
  falhas: { nfse_id: number; numero: number; erro: string | null }[];
  sem_email: { nfse_id: number; numero: number; cliente: string }[];
  puladas: number;
}
