// Cadastros › Pessoas (cadastro único de partes e advogados): espelho de backend/app/modules/pessoas/routes.py.

import type { Opcao } from "./casos";

export type TipoPessoa = "fisica" | "juridica" | "ente_publico" | "estrangeiro" | "sem_documento" | "autoridade" | "orgao_representacao";

/** Tipos oferecidos no cadastro (autoridade e órgão de representação vêm dos processos importados). */
export const TIPOS_PESSOA: { valor: TipoPessoa; rotulo: string }[] = [
  { valor: "fisica", rotulo: "Pessoa física" },
  { valor: "juridica", rotulo: "Pessoa jurídica" },
  { valor: "ente_publico", rotulo: "Ente público" },
  { valor: "estrangeiro", rotulo: "Estrangeiro" },
  { valor: "sem_documento", rotulo: "Sem documento" },
];

export interface EnderecoPessoa {
  tipo: string;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  codigo_ibge: string | null;
  uf: string | null;
  pais: string | null;
  principal: boolean;
}

export interface ContatoPessoa {
  tipo: string;
  valor: string;
  descricao: string | null;
  principal: boolean;
  aceita_comunicacao: boolean;
}

export interface OabIO {
  id?: number | null;
  numero: string;
  uf: string;
  tipo_inscricao: string;
  situacao: string;
  principal: boolean;
  /** leitura: "OAB/SP 123.456" */
  exibicao?: string | null;
}

export interface AdvogadoIO {
  id?: number | null;
  sociedade_id: number | null;
  sociedade_nome?: string | null;
  eh_interno: boolean;
  usuario_id: number | null;
  usuario_nome?: string | null;
  email_profissional: string | null;
  telefone_profissional: string | null;
  observacoes: string | null;
  oabs: OabIO[];
}

export interface PessoaIn {
  tipo_pessoa: TipoPessoa;
  nome: string;
  nome_social: string | null;
  nome_fantasia: string | null;
  cpf_cnpj: string | null;
  documento_estrangeiro: string | null;
  rg: string | null;
  rg_orgao_emissor: string | null;
  rg_uf: string | null;
  data_nascimento: string | null;
  data_fundacao: string | null;
  nacionalidade: string | null;
  estado_civil: string | null;
  regime_bens: string | null;
  profissao: string | null;
  nome_mae: string | null;
  pis_nit: string | null;
  ctps: string | null;
  inscricao_estadual: string | null;
  inscricao_municipal: string | null;
  cnae_principal: string | null;
  representante_legal_id: number | null;
  email: string | null;
  telefones: string[];
  enderecos: EnderecoPessoa[];
  contatos: ContatoPessoa[];
  observacoes: string | null;
  consentimento_lgpd: boolean | null;
  base_legal_lgpd: string | null;
  ativo: boolean;
  /** dados de advogado: não mandar o campo = não mexe; null = retira */
  advogado?: AdvogadoIO | null;
}

/** Saída curta, igual em toda rota (lista, busca, partes do caso). */
export interface PessoaResumo {
  id: number;
  nome: string;
  tipo_pessoa: TipoPessoa;
  tipo_pessoa_nome: string;
  cpf_cnpj: string | null;
  documento_formatado: string | null;
  /** é a Pessoa de um cliente do escritório */
  eh_cliente: boolean;
  /** código do cliente (id do cadastro de clientes) */
  cliente_id: number | null;
  eh_advogado: boolean;
  /** "OAB/SP 123.456" */
  oabs: string[];
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
}

export interface PessoaOut extends PessoaResumo, Omit<PessoaIn, "tipo_pessoa" | "nome" | "cpf_cnpj" | "ativo" | "advogado"> {
  representante_legal_nome: string | null;
  eh_ente_publico: boolean;
  advogado: AdvogadoIO | null;
  /** onde aparece (quem aparece em algum lugar não é excluído, só desativado) */
  em_uso: Record<string, number>;
  mesclada_em_id: number | null;
  /** no cadastro: o CPF/CNPJ já estava no cadastro e esta é a pessoa que já existia */
  ja_existia: boolean;
  criado_em: string | null;
}

export interface PessoaDuplicada extends PessoaResumo {
  semelhanca: number;
  motivo: string;
}

/** GET /pessoas/{id}/casos */
export interface CasoDaPessoa {
  caso_id: number;
  numero: number;
  titulo: string;
  tipo_caso: string;
  tipo_caso_nome: string;
  status: string;
  status_nome: string;
  cliente_id: number | null;
  cliente_nome: string | null;
  numero_processo: string | null;
  categoria: string | null;
  qualificacao: string | null;
  polo: string | null;
  eh_cliente: boolean;
  principal: boolean;
  ativo: boolean;
  pendente_reclassificacao: boolean;
  origem: "partes" | "cliente" | "processo";
}

/** GET /advogados/buscar e POST /advogados */
export interface AdvogadoResumo {
  advogado_id: number;
  pessoa_id: number;
  nome: string;
  oabs: OabIO[];
  sociedade_nome: string | null;
  eh_interno: boolean;
  cliente_id: number | null;
  eh_cliente: boolean;
  ja_existia: boolean;
}

export interface AdvogadoRapidoIn {
  nome: string;
  oab_numero: string;
  oab_uf: string;
  sociedade_id?: number | null;
  email_profissional?: string | null;
  telefone_profissional?: string | null;
}

/** GET /pessoas/opcoes */
export type OpcoesPessoa = Record<
  "tipo_pessoa" | "estado_civil" | "regime_bens" | "tipo_endereco" | "tipo_contato" | "tipo_inscricao" | "situacao_oab",
  Opcao[]
>;

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR",
  "RS", "SC", "SE", "SP", "TO",
];

const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Documento com os dígitos do meio escondidos (cartão da parte): 123.***.***-09 e 12.***.***\/0001-90. */
export function documentoMascarado(p: Pick<PessoaResumo, "cpf_cnpj" | "documento_formatado">): string | null {
  const d = digitos(p.cpf_cnpj);
  if (d.length === 11) return `${d.slice(0, 3)}.***.***-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}`;
  return p.documento_formatado || null;
}

/** CPF ou CNPJ enquanto digita. */
export function mascaraDocumento(v: string): string {
  const d = digitos(v).slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, "$1.$2.$3/$4-$5");
}

/** "OAB/SP 123.456" (o mesmo texto de `pessoas.service.exibir_oab`). */
export function exibirOab(numero: string | null | undefined, uf: string | null | undefined): string | null {
  if (!numero || !uf) return null;
  const [num, letra] = numero.toUpperCase().split("-");
  const d = digitos(num);
  if (!d) return null;
  return `OAB/${uf.toUpperCase()} ${Number(d).toLocaleString("pt-BR")}${letra ? `-${letra}` : ""}`;
}
