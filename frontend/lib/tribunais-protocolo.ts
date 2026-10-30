"use client";

/** Tipos e consultas do protocolo de petições, do certificado do advogado e da configuração dos tribunais.
 *  Espelham os dicts montados em backend/app/modules/tribunais/routes_protocolo.py, routes_config.py e routes.py (/eu, /advogados). */

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import type { Pagina, TomadorOut } from "./types";

// ------------------------------------------------------------------------------------------------ domínio
export type StatusProtocolo = "rascunho" | "aprovado" | "na_fila" | "enviando" | "protocolado" | "erro" | "verificar";
export type TipoProtocolo = "inicial" | "intermediaria" | "habilitacao" | "recurso";
export type Grau = "1g" | "2g" | "turma_recursal" | "superior";
export type Polo = "ativo" | "passivo" | "terceiro" | "fiscal_lei" | "vitima" | "testemunha" | "outro";
export type Escopo = "consulta" | "download" | "protocolo";
export type EventoAviso = "protocolo_sucesso" | "protocolo_falha" | "protocolo_inicial_distribuido" | "protocolo_intermediaria";
export type Prioridade = "idoso" | "idoso_80" | "doenca_grave" | "pcd" | "crianca_adolescente" | "violencia_domestica" | "outra";

export const EDITAVEIS: StatusProtocolo[] = ["rascunho", "aprovado", "erro"];
export const EM_ANDAMENTO: StatusProtocolo[] = ["na_fila", "enviando"];

export const ROTULO_TIPO: Record<TipoProtocolo, string> = {
  inicial: "Petição inicial",
  intermediaria: "Petição intermediária",
  habilitacao: "Pedido de habilitação",
  recurso: "Recurso",
};

export const ROTULO_GRAU: Record<Grau, string> = {
  "1g": "1º grau",
  "2g": "2º grau",
  turma_recursal: "Turma recursal",
  superior: "Tribunal superior",
};

export const ROTULO_POLO: Record<Polo, string> = {
  ativo: "Polo ativo (autor)",
  passivo: "Polo passivo (réu)",
  terceiro: "Terceiro interessado",
  fiscal_lei: "Fiscal da lei",
  vitima: "Vítima",
  testemunha: "Testemunha",
  outro: "Outro",
};

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  idoso: "Idoso (60+)",
  idoso_80: "Idoso (80+)",
  doenca_grave: "Doença grave",
  pcd: "Pessoa com deficiência",
  crianca_adolescente: "Criança ou adolescente",
  violencia_domestica: "Violência doméstica",
  outra: "Outra",
};

export const ROTULO_EVENTO: Record<EventoAviso, { titulo: string; texto: string }> = {
  protocolo_sucesso: { titulo: "Protocolo realizado", texto: "Quando o tribunal confirma o recebimento da petição." },
  protocolo_falha: { titulo: "Falha no protocolo", texto: "Quando a petição não entra. Sempre avisa, para ninguém perder prazo." },
  protocolo_inicial_distribuido: { titulo: "Petição inicial distribuída", texto: "Quando o processo novo recebe número e vara." },
  protocolo_intermediaria: { titulo: "Petição intermediária protocolada", texto: "Aviso específico para petições em processos existentes." },
};

export const NIVEIS_SIGILO = [
  { v: 0, l: "Público" },
  { v: 1, l: "1 · Segredo de justiça" },
  { v: 2, l: "2 · Sigilo mínimo" },
  { v: 3, l: "3 · Sigilo médio" },
  { v: 4, l: "4 · Sigilo intenso" },
  { v: 5, l: "5 · Sigilo absoluto" },
];

export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

// ------------------------------------------------------------------------------------------- entrada (ProtocoloIn)
export interface EnderecoParte {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  codigo_ibge: string | null;
  uf: string | null;
  pais: string;
  tipo: "residencial" | "comercial" | "citacao" | null;
}

export interface PessoaIn {
  tipo_pessoa: "fisica" | "juridica" | "autoridade" | "orgao_representacao";
  nome: string;
  nome_social: string | null;
  nome_fantasia: string | null;
  cpf: string | null;
  cnpj: string | null;
  justificativa_sem_documento: string | null;
  outros_documentos: Record<string, unknown>[];
  sexo: "M" | "F" | "N" | null;
  data_nascimento: string | null;
  nacionalidade: string | null;
  naturalidade: string | null;
  estado_civil: "solteiro" | "casado" | "divorciado" | "separado" | "viuvo" | "nao_informado" | null;
  uniao_estavel: boolean | null;
  profissao: string | null;
  nome_mae: string | null;
  nome_pai: string | null;
  email: string | null;
  telefones: string[];
  enderecos: EnderecoParte[];
  ente_publico: boolean;
}

export interface AdvogadoParteIn {
  nome: string;
  cpf: string | null;
  oab_numero: string;
  oab_uf: string;
  tipo_representante: "advogado" | "procurador" | "defensor" | "escritorio";
  recebe_intimacao: boolean;
}

export interface ParteIn {
  polo: Polo;
  tipo_participacao: string | null;
  pessoa: PessoaIn;
  assistencia_judiciaria: boolean;
  advogados: AdvogadoParteIn[];
  cliente_id: number | null;
}

export interface AssuntoIn {
  codigo: string;
  nome: string | null;
  principal: boolean;
}

export interface CabecalhoInicial {
  localidade_codigo: string | null;
  localidade_nome: string | null;
  competencia_codigo: string | null;
  orgao_julgador_codigo: string | null;
  classe_codigo: string | null;
  classe_nome: string | null;
  assuntos: AssuntoIn[];
  valor_causa: string | null;
  justica_gratuita_requerida: boolean | null;
  prioridades: Prioridade[];
  tutela_urgencia: boolean | null;
  segredo_justica_requerido: boolean | null;
  nivel_sigilo: number;
  juizo_100_digital: boolean | null;
  audiencia_conciliacao: "deseja" | "nao_deseja" | null;
  prevencao_processo_cnj: string | null;
  processo_referencia_cnj: string | null;
  sem_reu: boolean;
}

export interface ConteudoPeca {
  enderecamento: string | null;
  abertura: string | null;
  fatos: string | null;
  fundamentos_juridicos: string | null;
  pedidos: string[];
  pedido_tutela: string | null;
  provas: string[];
  local: string | null;
}

export interface ProtocoloIn {
  tipo: TipoProtocolo;
  advogado_id: number;
  titulo: string | null;
  processo_id: number | null;
  caso_id: number | null;
  tribunal_sigla: string | null;
  grau: Grau;
  cabecalho: CabecalhoInicial;
  partes: ParteIn[];
  conteudo_peca: ConteudoPeca;
  tipo_peticao_codigo: string | null;
  tipo_peticao_nome: string | null;
  em_resposta_a_intimacao_id: number | null;
  polo_peticionante: Polo | null;
  parte_ids: number[];
  pedido_urgente: boolean;
  nivel_sigilo: number;
  prazo_final: string | null;
  fora_do_prazo_justificativa: string | null;
}

export const enderecoVazio = (): EnderecoParte => ({
  cep: null,
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  cidade: null,
  codigo_ibge: null,
  uf: null,
  pais: "Brasil",
  tipo: "residencial",
});

export const pessoaVazia = (): PessoaIn => ({
  tipo_pessoa: "fisica",
  nome: "",
  nome_social: null,
  nome_fantasia: null,
  cpf: null,
  cnpj: null,
  justificativa_sem_documento: null,
  outros_documentos: [],
  sexo: null,
  data_nascimento: null,
  nacionalidade: "brasileira",
  naturalidade: null,
  estado_civil: null,
  uniao_estavel: null,
  profissao: null,
  nome_mae: null,
  nome_pai: null,
  email: null,
  telefones: [],
  enderecos: [enderecoVazio()],
  ente_publico: false,
});

export const cabecalhoVazio = (): CabecalhoInicial => ({
  localidade_codigo: null,
  localidade_nome: null,
  competencia_codigo: null,
  orgao_julgador_codigo: null,
  classe_codigo: null,
  classe_nome: null,
  assuntos: [],
  valor_causa: null,
  justica_gratuita_requerida: false,
  prioridades: [],
  tutela_urgencia: false,
  segredo_justica_requerido: false,
  nivel_sigilo: 0,
  juizo_100_digital: null,
  audiencia_conciliacao: null,
  prevencao_processo_cnj: null,
  processo_referencia_cnj: null,
  sem_reu: false,
});

export const conteudoVazio = (): ConteudoPeca => ({
  enderecamento: null,
  abertura: null,
  fatos: null,
  fundamentos_juridicos: null,
  pedidos: [],
  pedido_tutela: null,
  provas: [],
  local: null,
});

// ------------------------------------------------------------------------------------------------ saídas
export interface ProtocoloResumo {
  id: number;
  tipo: TipoProtocolo;
  status: StatusProtocolo;
  titulo: string | null;
  tribunal: string;
  numero_formatado: string | null;
  advogado_nome: string | null;
  prazo_final: string | null;
  criado_em: string;
  simulado: boolean | null;
  numero_protocolo: string | null;
  data_hora_protocolo: string | null;
  documentos: number;
  aprovado: boolean;
  ultimo_erro: string | null;
}

export interface DocumentoProtocolo {
  id: number;
  ordem: number;
  tipo_documento_codigo: string | null;
  tipo_documento_nome: string;
  descricao: string;
  nome_arquivo: string;
  mimetype: string;
  tamanho_bytes: number;
  hash_sha256: string;
  paginas: number | null;
  pesquisavel: boolean | null;
  nivel_sigilo: number;
  assinado: boolean;
  formato_assinatura: string | null;
}

export type TipoCusta = "inicial" | "preparo_recursal" | "porte_remessa" | "diligencia_oficial" | "mandato" | "outra";
export type StatusCusta = "gerada" | "paga" | "vinculada" | "vencida" | "isenta";

export const ROTULO_TIPO_CUSTA: Record<TipoCusta, string> = {
  inicial: "Custas iniciais",
  preparo_recursal: "Preparo recursal",
  porte_remessa: "Porte de remessa e retorno",
  diligencia_oficial: "Diligência do oficial",
  mandato: "Taxa de mandato",
  outra: "Outra",
};

export const ROTULO_STATUS_CUSTA: Record<StatusCusta, [string, "success" | "warning" | "danger" | "info" | "neutral"]> = {
  gerada: ["Guia gerada", "warning"],
  paga: ["Paga", "success"],
  vinculada: ["Vinculada", "info"],
  vencida: ["Vencida", "danger"],
  isenta: ["Isenta", "neutral"],
};

export interface CustaOut {
  id: number;
  tipo_custa: TipoCusta;
  tipo_guia: string;
  codigo_receita: string | null;
  valor: string;
  base_calculo: string | null;
  numero_guia: string;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  vencimento: string;
  pagador_nome: string;
  pagador_documento: string;
  status: StatusCusta;
  pago_em: string | null;
  tem_comprovante: boolean;
  reembolsar_cliente: boolean;
  despesa_id: number | null;
}

export interface CustaIn {
  tipo_custa: TipoCusta;
  tipo_guia: string;
  codigo_receita: string | null;
  valor: string;
  base_calculo: string | null;
  numero_guia: string;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  vencimento: string;
  pagador_nome: string;
  pagador_documento: string;
  status: StatusCusta;
  pago_em: string | null;
  reembolsar_cliente: boolean;
}

export interface EmailRetorno {
  destinatario: string;
  papel: string | null;
  evento: string;
  status: string;
  tentativas: number;
  erro: string | null;
  enviado_em: string | null;
}

export interface RetornoProtocolo {
  id: number;
  sucesso: boolean;
  numero_protocolo: string | null;
  data_hora_protocolo: string | null;
  numero_cnj_gerado: string | null;
  numero_cnj_gerado_formatado: string | null;
  orgao_julgador_distribuido: string | null;
  tipo_distribuicao: string | null;
  tem_recibo: boolean;
  hash_documentos_enviados: string[] | null;
  mensagem_erro: string | null;
  codigo_erro: string | null;
  tentativa: number;
  simulado: boolean;
  manual: boolean;
  recuperado: boolean;
  criado_em: string;
  emails: EmailRetorno[];
}

export interface MensagemValidacao {
  nivel: "erro" | "aviso";
  mensagem: string;
}

export interface Aprovacao {
  id: number;
  advogado: string | null;
  aprovado_em: string;
  ip: string | null;
  hash: string;
}

export interface ProtocoloOut {
  id: number;
  tipo: TipoProtocolo;
  status: StatusProtocolo;
  titulo: string | null;
  processo_id: number | null;
  caso_id: number | null;
  numero_cnj: string | null;
  numero_formatado: string | null;
  advogado_id: number;
  advogado_nome: string | null;
  tribunal: string;
  tribunal_nome: string;
  grau: Grau;
  sistema: string | null;
  sistema_portal: string | null;
  cabecalho: Partial<CabecalhoInicial>;
  partes: ParteIn[];
  conteudo_peca: Partial<ConteudoPeca>;
  tipo_peticao_codigo: string | null;
  tipo_peticao_nome: string | null;
  em_resposta_a_intimacao_id: number | null;
  polo_peticionante: Polo | null;
  parte_ids: number[];
  pedido_urgente: boolean;
  nivel_sigilo: number;
  prazo_final: string | null;
  fora_do_prazo_justificativa: string | null;
  criado_por: string | null;
  enviado_por: string | null;
  tentativas: number;
  simulado: boolean | null;
  ultimo_erro: string | null;
  criado_em: string;
  atualizado_em: string | null;
  /** Modo do escritório. */
  modo: "simulado" | "real";
  modo_real_disponivel: boolean;
  /** "real" só com o escritório em modo real E em produção. */
  modo_efetivo: "simulado" | "real";
  hash_conteudo: string;
  aprovacao: Aprovacao | null;
  aprovacoes_invalidadas: number;
  pode_aprovar: boolean;
  documentos: DocumentoProtocolo[];
  custas: CustaOut[];
  retornos: RetornoProtocolo[];
  /** Só vem enquanto o protocolo é editável (rascunho, aprovado, erro). */
  validacao?: MensagemValidacao[];
}

export interface SugestaoPeca {
  enderecamento: string | null;
  abertura: string | null;
  local: string | null;
  fatos: string | null;
  fundamentos_juridicos: string | null;
  pedidos: string[] | null;
  pedido_tutela: string | null;
  provas: string[] | null;
}

/** Converte a resposta da API no corpo completo do PUT (que substitui tudo). */
export function protocoloParaIn(p: ProtocoloOut): ProtocoloIn {
  const cab = { ...cabecalhoVazio(), ...(p.cabecalho ?? {}) };
  if (cab.valor_causa != null) cab.valor_causa = String(cab.valor_causa);
  return {
    tipo: p.tipo,
    advogado_id: p.advogado_id,
    titulo: p.titulo,
    processo_id: p.processo_id,
    caso_id: p.caso_id,
    tribunal_sigla: p.tribunal,
    grau: p.grau,
    cabecalho: cab,
    partes: (p.partes ?? []).map((x) => ({
      ...x,
      pessoa: { ...pessoaVazia(), ...x.pessoa, enderecos: (x.pessoa?.enderecos ?? []).map((e) => ({ ...enderecoVazio(), ...e })) },
      advogados: x.advogados ?? [],
    })),
    conteudo_peca: { ...conteudoVazio(), ...(p.conteudo_peca ?? {}) },
    tipo_peticao_codigo: p.tipo_peticao_codigo,
    tipo_peticao_nome: p.tipo_peticao_nome,
    em_resposta_a_intimacao_id: p.em_resposta_a_intimacao_id,
    polo_peticionante: p.polo_peticionante,
    parte_ids: p.parte_ids ?? [],
    pedido_urgente: p.pedido_urgente,
    nivel_sigilo: p.nivel_sigilo,
    prazo_final: p.prazo_final ? p.prazo_final.slice(0, 10) : null,
    fora_do_prazo_justificativa: p.fora_do_prazo_justificativa,
  };
}

/** "1.234,56" ou "1234.56" → "1234.56"; vazio → null. */
export function paraDecimal(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}

/** Limpa o corpo antes de enviar: strings vazias viram null (o Pydantic valida e-mail, CEP etc.). */
export function limparProtocoloIn(b: ProtocoloIn): ProtocoloIn {
  const n = (v: string | null | undefined) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  return {
    ...b,
    titulo: n(b.titulo),
    prazo_final: n(b.prazo_final),
    tipo_peticao_codigo: n(b.tipo_peticao_codigo),
    tipo_peticao_nome: n(b.tipo_peticao_nome),
    fora_do_prazo_justificativa: n(b.fora_do_prazo_justificativa),
    cabecalho: {
      ...b.cabecalho,
      valor_causa: paraDecimal(b.cabecalho.valor_causa),
      assuntos: b.cabecalho.assuntos.filter((a) => a.codigo.trim()),
      localidade_codigo: n(b.cabecalho.localidade_codigo),
      localidade_nome: n(b.cabecalho.localidade_nome),
      competencia_codigo: n(b.cabecalho.competencia_codigo),
      orgao_julgador_codigo: n(b.cabecalho.orgao_julgador_codigo),
      classe_codigo: n(b.cabecalho.classe_codigo),
      classe_nome: n(b.cabecalho.classe_nome),
      prevencao_processo_cnj: n(b.cabecalho.prevencao_processo_cnj),
      processo_referencia_cnj: n(b.cabecalho.processo_referencia_cnj),
    },
    partes: b.partes.map((p) => ({
      ...p,
      tipo_participacao: n(p.tipo_participacao),
      pessoa: {
        ...p.pessoa,
        cpf: n(p.pessoa.cpf),
        cnpj: n(p.pessoa.cnpj),
        email: n(p.pessoa.email),
        justificativa_sem_documento: n(p.pessoa.justificativa_sem_documento),
        data_nascimento: n(p.pessoa.data_nascimento),
        profissao: n(p.pessoa.profissao),
        nacionalidade: n(p.pessoa.nacionalidade),
        nome_mae: n(p.pessoa.nome_mae),
        nome_pai: n(p.pessoa.nome_pai),
        nome_social: n(p.pessoa.nome_social),
        nome_fantasia: n(p.pessoa.nome_fantasia),
        telefones: p.pessoa.telefones.map((t) => t.trim()).filter(Boolean),
        enderecos: p.pessoa.enderecos.map((e) => ({
          ...e,
          cep: n(e.cep),
          logradouro: n(e.logradouro),
          numero: n(e.numero),
          complemento: n(e.complemento),
          bairro: n(e.bairro),
          cidade: n(e.cidade),
          uf: n(e.uf),
        })),
      },
      advogados: p.advogados
        .filter((a) => a.oab_numero.trim())
        .map((a) => ({ ...a, cpf: n(a.cpf), oab_uf: a.oab_uf.toUpperCase() })),
    })),
    conteudo_peca: {
      ...b.conteudo_peca,
      enderecamento: n(b.conteudo_peca.enderecamento),
      abertura: n(b.conteudo_peca.abertura),
      fatos: n(b.conteudo_peca.fatos),
      fundamentos_juridicos: n(b.conteudo_peca.fundamentos_juridicos),
      pedido_tutela: n(b.conteudo_peca.pedido_tutela),
      local: n(b.conteudo_peca.local),
      pedidos: b.conteudo_peca.pedidos.map((x) => x.trim()).filter(Boolean),
      provas: b.conteudo_peca.provas.map((x) => x.trim()).filter(Boolean),
    },
  };
}

// --------------------------------------------------------------------------------- apoio (tribunais, tabelas…)
export interface SistemaOut {
  id: number;
  tribunal_id: number;
  grau: Grau;
  sistema: "pje" | "eproc" | "esaj" | "projudi" | "proprio";
  versao_sistema: string | null;
  url_portal: string | null;
  url_consulta_publica: string | null;
  url_mni: string | null;
  versao_mni: string | null;
  mni_consulta: boolean;
  mni_peticionamento: boolean;
  mni_inicial: boolean;
  exige_credenciamento: boolean;
  autenticacao: ("certificado" | "usuario_senha" | "2fa")[];
  tamanho_max_arquivo_mb: number;
  tamanho_max_total_mb: number | null;
  formatos_aceitos: string[];
  exige_pdf_pesquisavel: boolean;
  formato_assinatura: "PAdES" | "CAdES" | "assinatura_no_portal";
  adaptador: "MniAdapter" | "PjeAdapter" | "EprocAdapter" | "EsajAdapter" | "ProjudiAdapter" | "PortalAdapter";
  config_extra: Record<string, unknown>;
  data_inicio: string | null;
  data_fim: string | null;
  status_saude: "ok" | "lento" | "fora" | "mudou_layout";
  ultima_verificacao: string | null;
  validado: boolean;
  intervalo_min_s: number;
  janela_inicio: string | null;
  janela_fim: string | null;
  ativo: boolean;
}

export type SistemaIn = Omit<SistemaOut, "id" | "tribunal_id" | "ultima_verificacao">;

export interface TribunalOut {
  id: number;
  sigla: string;
  nome: string;
  segmento_j: string;
  codigo_tr: string;
  uf: string | null;
  ramo: string;
  alias_datajud: string | null;
  sistemas: SistemaOut[];
}

export interface ItemTabela {
  id: number;
  tabela: string;
  codigo_local: string;
  codigo_cnj: string | null;
  nome: string;
  pai_codigo: string | null;
  extra: Record<string, unknown>;
  tribunal_id: number | null;
  sistema_id: number | null;
}

export interface Oab {
  numero: string;
  uf: string;
  tipo: "principal" | "suplementar" | "estagiario";
}

export interface OabCadastrada extends Oab {
  id?: number;
  letra_complementar: string | null;
  situacao: "regular" | "suspensa" | "cancelada" | null;
}

export interface Candidato {
  id: number;
  nome: string;
  oab: string | null;
  oabs: Oab[];
  tem_certificado: boolean;
}

export interface CertificadoAdvogado {
  id: number;
  usuario_id: number;
  tipo: string;
  titular_nome: string;
  titular_cpf: string | null;
  emissor_ac: string | null;
  numero_serie: string | null;
  thumbprint_sha256: string | null;
  valido_de: string;
  valido_ate: string;
  dias_para_vencer: number;
  revogado: boolean | null;
  revogacao_verificada_em: string | null;
  revogacao_msg: string | null;
  escopo_autorizado: Escopo[];
  criado_em: string;
}

export interface EuOut {
  usuario_id: number;
  nome: string;
  cpf: string | null;
  email: string;
  oabs: Oab[];
  oabs_cadastradas: OabCadastrada[];
  certificado: CertificadoAdvogado | null;
  termo: { id: number; versao: string; escopos: Escopo[]; aceito_em: string } | null;
  termo_vigente: { versao: string; texto: string };
  preferencias: Partial<Record<EventoAviso, { receber: boolean; email_alternativo: string | null }>>;
}

export interface UsoCertificado {
  id: number;
  certificado_id: number;
  acao: string;
  tribunal: string | null;
  referencia: string | null;
  usuario: string;
  aprovacao_humana_id: number | null;
  data_hora: string;
  ip_origem: string | null;
  resultado: string | null;
  detalhe: string | null;
}

export interface AdvogadoOut {
  id: number;
  nome: string;
  cpf: string | null;
  email: string;
  oabs: Oab[];
  certificado: CertificadoAdvogado | null;
  ultima_varredura: { id: number; status: string; concluida_em: string | null; iniciada_em: string | null; total_encontrados: number } | null;
  processos: number;
}

/** Recorte de GET /tribunais/processos e /tribunais/processos/{id} que o protocolo usa. */
export interface ProcessoResumo {
  id: number;
  numero_cnj: string;
  numero_formatado: string;
  tribunal: string;
  tribunal_nome: string;
  sistema: string | null;
  grau: string | null;
  classe_nome: string | null;
  orgao_julgador: string | null;
  partes_resumo: string | null;
  caso_id: number | null;
  nivel_sigilo: number;
}

export interface ParteProcesso {
  id: number;
  polo: Polo;
  tipo_participacao: string | null;
  pessoa: { id: number; nome: string; tipo_pessoa: string; cpf: string | null; cnpj: string | null };
  advogados: { id: number; nome: string; oab_numero: string | null; oab_uf: string | null; e_o_usuario: boolean }[];
}

export interface ProcessoDetalhe extends ProcessoResumo {
  partes: ParteProcesso[];
  sistema_portal: string | null;
}

export interface IntimacaoAberta {
  id: number;
  data_hora: string;
  descricao: string;
  prazo_final: string | null;
}

export interface ConfigTribunais {
  modo: "simulado" | "real";
  sincronizar_auto: boolean;
  criar_andamentos: boolean;
  vincular_automatico: boolean;
  limiar_fuzzy: number;
  plano_id: number | null;
  plano_nome: string | null;
  ambiente: string;
  modo_real_disponivel: boolean;
}

export interface NotificacaoCfg {
  evento: EventoAviso;
  ativo: boolean;
  notificar_responsavel_caso: boolean;
  notificar_quem_protocolou: boolean;
  notificar_titular_certificado: boolean;
  destinatarios_fixos: string[];
  copia_oculta: string[];
  anexar_recibo: boolean;
  anexar_peca_principal: boolean;
  respeitar_sigilo: boolean;
  assunto: string;
  corpo_texto: string;
  corpo_html: string | null;
}

export interface Plataforma {
  datajud_url: string;
  datajud_chave: string | null;
  djen_url: string;
  djen_proxy_url: string | null;
  intervalo_datajud_ms: number;
  termo_versao: string;
  termo_texto: string;
}

export interface Faixa {
  de_creditos: number;
  ate_creditos: number | null;
  preco_por_credito: string;
}

export interface PlanoOut {
  id: number;
  nome: string;
  preco_mensal: string;
  creditos_protocolo_mes: number;
  creditos_acumulam: boolean;
  permite_excedente: boolean;
  limite_excedente_mes: number | null;
  limite_processos_monitorados: number | null;
  limite_certificados: number | null;
  ativo: boolean;
  faixas: Faixa[];
}

export type PlanoIn = Omit<PlanoOut, "id">;

export interface FaixaSetup {
  id?: number;
  de_processos: number;
  ate_processos: number | null;
  preco: string;
  inclui_download_autos: boolean;
  reimportacao_gratis_dias: number | null;
}

export interface PlanosOut {
  planos: PlanoOut[];
  pesos: Record<string, number>;
  setup: FaixaSetup[];
}

export interface Consumo {
  id: number;
  ciclo: string;
  origem: "protocolo" | "importacao" | "ajuste" | "estorno";
  referencia_id: number | null;
  creditos: number;
  quantidade: number | null;
  dentro_franquia: boolean;
  valor: string;
  motivo: string | null;
  criado_em: string;
}

export interface CobrancaOut {
  ciclo: string;
  plano: string | null;
  mensalidade: string;
  excedente: string;
  setups: string;
  total: string;
  uso: {
    ciclo: string;
    plano: string | null;
    franquia: number;
    usado: number;
    excedente: number;
    percentual: number | null;
    valor_excedente: string;
    permite_excedente: boolean;
  };
  lancamentos: Consumo[];
  ciclos: string[];
  pesos: Record<string, number>;
}

export interface TabelaResumo {
  tribunal: string;
  tabela: string;
  registros: number;
}

// ------------------------------------------------------------------------------------------------- consultas
const K = "trib-prot";

export function useProtocolos(f: { status?: string; tipo?: string; advogado_id?: number | null }) {
  return useQuery({
    queryKey: [K, "lista", f],
    queryFn: () => api.get<ProtocoloResumo[]>("/tribunais/protocolos", { status: f.status, tipo: f.tipo, advogado_id: f.advogado_id }),
  });
}

export function useProtocolo(id: number) {
  return useQuery({
    queryKey: [K, "protocolo", id],
    queryFn: () => api.get<ProtocoloOut>(`/tribunais/protocolos/${id}`),
    enabled: Number.isFinite(id) && id > 0,
    refetchInterval: (q) => (q.state.data && EM_ANDAMENTO.includes(q.state.data.status) ? 3000 : false),
  });
}

export function useTiposDocumento() {
  return useQuery({
    queryKey: [K, "tipos-documento"],
    queryFn: () => api.get<string[]>("/tribunais/protocolos/tipos-documento"),
    staleTime: Infinity,
  });
}

export function useTabela(tabela: string, tribunal: string | null | undefined, q: string, ativo = true) {
  return useQuery({
    queryKey: [K, "tabela", tabela, tribunal, q],
    queryFn: () => api.get<ItemTabela[]>("/tribunais/tabelas", { tabela, tribunal, q, limite: 30 }),
    enabled: ativo,
    staleTime: 5 * 60_000,
    meta: { silencioso: true },
  });
}

export function useTribunais() {
  return useQuery({ queryKey: [K, "tribunais"], queryFn: () => api.get<TribunalOut[]>("/tribunais/tribunais"), staleTime: 5 * 60_000 });
}

export function useCandidatos(ativo = true) {
  return useQuery({
    queryKey: [K, "candidatos"],
    queryFn: () => api.get<Candidato[]>("/tribunais/advogados/candidatos"),
    enabled: ativo,
  });
}

export function useEu() {
  return useQuery({ queryKey: [K, "eu"], queryFn: () => api.get<EuOut>("/tribunais/eu") });
}

export function useProcessosBusca(q: string, ativo = true) {
  return useQuery({
    queryKey: [K, "processos", q],
    queryFn: () => api.get<{ itens: ProcessoResumo[]; total: number }>("/tribunais/processos", { q, por_pagina: 20 }),
    enabled: ativo,
  });
}

export function useProcesso(id: number | null | undefined) {
  return useQuery({
    queryKey: [K, "processo", id],
    queryFn: () => api.get<ProcessoDetalhe>(`/tribunais/processos/${id}`),
    enabled: !!id,
  });
}

export function useIntimacoesAbertas(processoId: number | null | undefined) {
  return useQuery({
    queryKey: [K, "intimacoes", processoId],
    queryFn: () => api.get<IntimacaoAberta[]>(`/tribunais/processos/${processoId}/intimacoes-abertas`),
    enabled: !!processoId,
    meta: { silencioso: true },
  });
}

export function useConfigTribunais(ativo = true) {
  return useQuery({
    queryKey: [K, "config"],
    queryFn: () => api.get<ConfigTribunais>("/tribunais/config"),
    enabled: ativo,
    meta: { silencioso: true },
  });
}

export function useClientesBusca(q: string, ativo = true) {
  return useQuery({
    queryKey: [K, "clientes", q],
    queryFn: () => api.get<Pagina<TomadorOut>>("/nfse/tomadores", { q, por_pagina: 20 }),
    enabled: ativo,
  });
}

export const chaveProtocolos = K;

// -------------------------------------------------------------------------------------------- utilitários
/** Dias até o prazo (negativo = vencido). */
export function diasAte(iso: string | null | undefined) {
  if (!iso) return null;
  const alvo = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo.getTime() - hoje.getTime()) / 86_400_000);
}

export function tomPrazo(dias: number | null): "danger" | "warning" | "info" | "neutral" {
  if (dias == null) return "neutral";
  if (dias < 0 || dias <= 1) return "danger";
  if (dias <= 5) return "warning";
  return "info";
}

export function textoPrazo(dias: number | null) {
  if (dias == null) return "";
  if (dias < 0) return `vencido há ${-dias} dia${dias === -1 ? "" : "s"}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `em ${dias} dias`;
}

export function mascararCpf(cpf: string | null | undefined) {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "—";
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** Converte um cliente do cadastro (tomador) em parte. */
export function pessoaDoCliente(t: TomadorOut): PessoaIn {
  const d = (t.cpf_cnpj ?? "").replace(/\D/g, "");
  const enderecos: EnderecoParte[] = [];
  if (t.logradouro || t.cep) {
    enderecos.push({
      ...enderecoVazio(),
      cep: t.cep,
      logradouro: [t.tipo_logradouro, t.logradouro].filter(Boolean).join(" ") || null,
      numero: t.numero,
      complemento: t.complemento,
      bairro: t.bairro,
      cidade: t.cidade,
      uf: t.uf,
      tipo: t.tipo === "PJ" ? "comercial" : "residencial",
    });
  }
  for (const e of t.enderecos ?? []) {
    enderecos.push({
      ...enderecoVazio(),
      cep: e.cep,
      logradouro: [e.tipo_logradouro, e.logradouro].filter(Boolean).join(" ") || null,
      numero: e.numero,
      complemento: e.complemento,
      bairro: e.bairro,
      cidade: e.cidade,
      uf: e.uf,
      tipo: "comercial",
    });
  }
  return {
    ...pessoaVazia(),
    tipo_pessoa: t.tipo === "PJ" ? "juridica" : "fisica",
    nome: t.nome,
    cpf: d.length === 11 ? d : null,
    cnpj: d.length === 14 ? d : null,
    email: t.emails?.[0] ?? null,
    telefones: (t.telefones ?? []).map((x) => x.numero).filter(Boolean),
    enderecos: enderecos.length ? enderecos : [enderecoVazio()],
  };
}
