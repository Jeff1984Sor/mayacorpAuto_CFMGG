/** Relatórios: espelha app/modules/relatorios (fontes, motor, prontos, salvos). */
import {
  Banknote,
  Briefcase,
  CalendarDays,
  Clock,
  FileSignature,
  FolderOpen,
  Gavel,
  HandCoins,
  Landmark,
  PieChart,
  Receipt,
  ReceiptText,
  Scale,
  ScrollText,
  Timer,
  UserCheck,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { data as fmtData, moeda, numero } from "@/lib/format";

export type TipoColuna =
  "texto" | "longo" | "lista" | "data" | "bool" | "numero" | "moeda" | "horas";
export type TipoGrafico =
  "barras" | "barras_h" | "empilhado" | "linhas" | "area" | "rosca" | "nenhum";
export type Granularidade =
  "dia" | "semana" | "mes" | "trimestre" | "ano" | "dia_semana";
export type Agregacao = "soma" | "media" | "max" | "min";

export interface ColunaMeta {
  id: string;
  rotulo: string;
  tipo: TipoColuna;
  padrao: boolean;
}

export interface FonteMeta {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  rotulo_contagem: string;
  data_principal: string | null;
  colunas: ColunaMeta[];
}

export interface Filtro {
  coluna: string;
  valores?: string[] | null;
  contem?: string | null;
  de?: string | null;
  ate?: string | null;
  relativo?: string | null;
  min?: number | null;
  max?: number | null;
  negar?: boolean;
}

export interface ConfigGrafico {
  tipo: TipoGrafico;
  dimensao?: string | null;
  granularidade?: Granularidade | null;
  serie?: string | null;
  medida?: string;
  agregacao?: Agregacao;
  limite?: number;
}

export interface Ordem {
  coluna: string;
  desc?: boolean;
}

export interface ConfigRelatorio {
  colunas: string[];
  filtros: Filtro[];
  grafico: ConfigGrafico;
  ordenar: Ordem[];
}

export interface Pronto {
  id: string;
  grupo: "Clientes" | "Casos" | "Financeiro";
  nome: string;
  descricao: string;
  icone: string;
  fonte: string;
  config: ConfigRelatorio;
}

export interface Salvo {
  id: number;
  nome: string;
  descricao: string | null;
  fonte: string;
  config: ConfigRelatorio;
  compartilhado: boolean;
  meu: boolean;
  autor: string | null;
  atualizado_em: string;
}

export interface Catalogo {
  fontes: FonteMeta[];
  prontos: Pronto[];
  salvos: Salvo[];
}

export interface Categoria {
  chave: string;
  rotulo: string;
  total: number;
  qtd: number | null;
  valores: Record<string, number>;
  valor?: string;
  de?: string | null;
  ate?: string | null;
}

export interface ResultadoGrafico {
  tipo: TipoGrafico;
  dimensao: ColunaMeta;
  granularidade: Granularidade | null;
  serie: ColunaMeta | null;
  medida: { id: string; rotulo: string; tipo: TipoColuna };
  agregacao: Agregacao | "contagem";
  categorias: Categoria[];
  series: string[];
  outros: number;
  total: number;
}

export type Celula = string | number | boolean | null;

export interface Resultado {
  fonte: string;
  rotulo_contagem: string;
  colunas: ColunaMeta[];
  linhas: Celula[][];
  total_linhas: number;
  truncado: boolean;
  totais: Record<string, { soma: number; media: number | null }>;
  grafico: ResultadoGrafico | null;
}

export const NUMERICOS: TipoColuna[] = ["numero", "moeda", "horas"];
export const ehNumerica = (t: TipoColuna) => NUMERICOS.includes(t);
/** pode virar eixo do gráfico ("Agrupar por") */
export const ehDimensao = (t: TipoColuna) =>
  t === "lista" || t === "texto" || t === "data" || t === "bool";

export const VAZIO = "(vazio)";

/** Cor categórica por posição FIXA da série (nunca pela ordem de tamanho); "Outros" é sempre neutro. */
export function corSerie(nome: string, series: string[]) {
  if (nome === "Outros") return "var(--viz-muted)";
  const i = series.filter((s) => s !== "Outros").indexOf(nome);
  return `var(--viz-c${(i < 0 ? 0 : i % 8) + 1})`;
}

export const horasFmt = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export function formatar(v: Celula | undefined, tipo: TipoColuna): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (tipo) {
    case "moeda":
      return moeda(v as number);
    case "horas":
      return horasFmt(Number(v));
    case "numero":
      return numero(v as number);
    case "data":
      return fmtData(String(v));
    case "bool":
      return v ? "Sim" : "Não";
    default:
      return String(v);
  }
}

/** Valor compacto para eixos. */
export function formatarEixo(v: number, tipo: TipoColuna): string {
  if (tipo === "horas") return `${numero(Math.round(v))}h`;
  if (tipo === "moeda") {
    const a = Math.abs(v);
    if (a >= 1_000_000)
      return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (a >= 1_000)
      return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
    return `R$ ${numero(Math.round(v))}`;
  }
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export const PERIODOS: { id: string; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "esta_semana", rotulo: "Esta semana" },
  { id: "proxima_semana", rotulo: "Próxima semana" },
  { id: "este_mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "proximo_mes", rotulo: "Próximo mês" },
  { id: "ultimos_7", rotulo: "Últimos 7 dias" },
  { id: "ultimos_30", rotulo: "Últimos 30 dias" },
  { id: "ultimos_90", rotulo: "Últimos 90 dias" },
  { id: "ultimos_12m", rotulo: "Últimos 12 meses" },
  { id: "este_ano", rotulo: "Este ano" },
  { id: "ano_passado", rotulo: "Ano passado" },
  { id: "proximos_7", rotulo: "Próximos 7 dias" },
  { id: "proximos_30", rotulo: "Próximos 30 dias" },
  { id: "hoje_em_diante", rotulo: "De hoje em diante" },
  { id: "ate_hoje", rotulo: "Até hoje" },
  { id: "atrasadas", rotulo: "Antes de hoje" },
];
export const ROTULO_PERIODO = Object.fromEntries(
  PERIODOS.map((p) => [p.id, p.rotulo]),
);

export const GRANULARIDADES: { id: Granularidade; rotulo: string }[] = [
  { id: "dia", rotulo: "Dia" },
  { id: "semana", rotulo: "Semana" },
  { id: "mes", rotulo: "Mês" },
  { id: "trimestre", rotulo: "Trimestre" },
  { id: "ano", rotulo: "Ano" },
  { id: "dia_semana", rotulo: "Dia da semana" },
];

export const AGREGACOES: { id: Agregacao; rotulo: string }[] = [
  { id: "soma", rotulo: "Soma" },
  { id: "media", rotulo: "Média" },
  { id: "max", rotulo: "Maior" },
  { id: "min", rotulo: "Menor" },
];

export const ICONES: Record<string, LucideIcon> = {
  clock: Clock,
  briefcase: Briefcase,
  scroll: ScrollText,
  calendar: CalendarDays,
  receipt: Receipt,
  "receipt-text": ReceiptText,
  wallet: Wallet,
  banknote: Banknote,
  users: Users,
  "file-signature": FileSignature,
  "user-round": UserRound,
  "user-check": UserCheck,
  scale: Scale,
  landmark: Landmark,
  "folder-open": FolderOpen,
  gavel: Gavel,
  timer: Timer,
  "pie-chart": PieChart,
  "hand-coins": HandCoins,
};

/** Texto curto de um filtro, para o chip e o subtítulo do Excel. */
export function descreverFiltro(
  f: Filtro,
  col: ColunaMeta | undefined,
): string {
  const nome = col?.rotulo ?? f.coluna;
  const nao = f.negar ? "não " : "";
  if (f.relativo)
    return `${nome}: ${nao}${(ROTULO_PERIODO[f.relativo] ?? f.relativo).toLowerCase()}`;
  if (f.de || f.ate) {
    const de = f.de ? fmtData(f.de) : "…";
    const ate = f.ate ? fmtData(f.ate) : "…";
    return `${nome}: ${nao}${f.de === f.ate ? de : `${de} a ${ate}`}`;
  }
  if (f.min != null || f.max != null) {
    const t = col?.tipo ?? "numero";
    if (f.min != null && f.max != null)
      return `${nome}: ${nao}${formatar(f.min, t)} a ${formatar(f.max, t)}`;
    return f.min != null
      ? `${nome} ${f.negar ? "<" : "≥"} ${formatar(f.min, t)}`
      : `${nome} ${f.negar ? ">" : "≤"} ${formatar(f.max!, t)}`;
  }
  if (f.contem) return `${nome} ${nao}contém "${f.contem}"`;
  if (f.valores?.length) {
    const v =
      f.valores.length > 2
        ? `${f.valores.slice(0, 2).join(", ")} +${f.valores.length - 2}`
        : f.valores.join(", ");
    return `${nome}${f.negar ? " ≠ " : ": "}${v}`;
  }
  return nome;
}

export const filtroVazio = (f: Filtro) =>
  !f.relativo &&
  !f.de &&
  !f.ate &&
  f.min == null &&
  f.max == null &&
  !f.contem &&
  !(f.valores && f.valores.length);

export function configPadrao(fonte: FonteMeta): ConfigRelatorio {
  const dim =
    fonte.colunas.find((c) => c.tipo === "lista" && c.padrao) ??
    fonte.colunas.find((c) => ehDimensao(c.tipo));
  return {
    colunas: fonte.colunas.filter((c) => c.padrao).map((c) => c.id),
    filtros: fonte.data_principal
      ? [{ coluna: fonte.data_principal, relativo: "este_ano" }]
      : [],
    grafico: {
      tipo: "barras_h",
      dimensao: dim?.id ?? null,
      medida: "_contagem",
    },
    ordenar: [],
  };
}
