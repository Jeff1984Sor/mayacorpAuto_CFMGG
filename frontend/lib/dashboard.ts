// Dashboard de Faturamento — todos os cálculos no navegador (como o painel do RCA).
// Datas trafegam como "YYYY-MM-DD"; comparações de string ISO são cronológicas.

export type Situacao = "aberta" | "vencida" | "paga" | "cancelada";

export type StatusNfse = "Emitida" | "Aguardando NFS-e" | "Cancelada" | "Não se aplica (reembolso)";

/** Uma linha por fatura (NH ou ND, do arquivo da Lello ou de contrato) e as NFS-e sem fatura. */
export interface NotaDash {
  id: number;
  /** chave única da linha ("f12" fatura, "n34" nota sem fatura) */
  chave: string;
  tipo: "NH" | "ND";
  origem: "Contrato" | "Arquivo da Lello";
  /** "#n nome" ou "—" */
  contrato: string;
  nfse: StatusNfse;
  nfse_id: number | null;
  nf: number | null;
  fatura_id: number | null;
  fatura: string | null;
  cliente: string;
  cliente_id: number | null;
  doc: string | null;
  emissora: string;
  servico: string;
  lote: number | null;
  lote_id: number | null;
  emissao: string;
  vencimento: string | null;
  pagamento: string | null;
  valor: number;
  iss: number;
  recebido: number;
  cancelada: boolean;
  situacao: Situacao;
  origem_baixa: string | null;
  simulada: boolean;
}

export interface LoteDash {
  id: number;
  numero: number;
  mes: string;
  emitidas: number;
  rejeitadas: number;
  status: string;
  segundos: number;
}

export interface DashboardOut {
  notas: NotaDash[];
  lotes: LoteDash[];
  hoje: string;
  inicial: { de: string; ate: string };
}

/** Nota com os campos derivados usados pelos filtros. */
export interface Nota extends NotaDash {
  mes: string;
  atraso: FaixaAtraso | null;
  previsao: string | null;
  prazoBase: { dias: number; doCliente: boolean } | null;
  loteRotulo: string;
  busca: string;
}

export const FAIXAS = ["A vencer", "1–15 dias", "16–30 dias", "31–60 dias", "61–90 dias", "+90 dias"] as const;
export type FaixaAtraso = (typeof FAIXAS)[number];

export const DIMENSOES = ["cliente", "emissora", "situacao", "mes", "atraso", "tipo", "origem", "contrato", "nfse", "servico", "lote", "previsao"] as const;
export type Dimensao = (typeof DIMENSOES)[number];
export type Filtros = Partial<Record<Dimensao, string[]>>;

export const ROTULO_DIM: Record<Dimensao, string> = {
  cliente: "Cliente",
  emissora: "Emissora",
  situacao: "Situação",
  mes: "Mês",
  atraso: "Atraso",
  tipo: "Tipo",
  origem: "Origem",
  contrato: "Contrato",
  nfse: "NFS-e",
  servico: "Serviço",
  lote: "Lote",
  previsao: "Previsão",
};

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  aberta: "Aberta",
  vencida: "Vencida",
  paga: "Paga",
  cancelada: "Cancelada",
};

// ---------------------------------------------------------------- datas
const DIA = 86_400_000;
export const toDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const diasEntre = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DIA);
export const somaDias = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DIA));
export const mesDe = (s: string) => s.slice(0, 7);

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export function nomeMes(m: string, comAno = true) {
  const [a, mm] = m.split("-");
  return comAno ? `${MESES_CURTOS[Number(mm) - 1]}/${a.slice(2)}` : MESES_CURTOS[Number(mm) - 1];
}
export function mesesEntre(de: string, ate: string) {
  const out: string[] = [];
  let [a, m] = de.slice(0, 7).split("-").map(Number);
  const [a2, m2] = ate.slice(0, 7).split("-").map(Number);
  while (a < a2 || (a === a2 && m <= m2)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return out;
}
export const fimDoMes = (m: string) => {
  const [a, mm] = m.split("-").map(Number);
  return iso(new Date(a, mm, 0));
};
export function inicioSemana(s: string) {
  const d = toDate(s);
  const dow = (d.getDay() + 6) % 7; // segunda = 0
  return iso(new Date(d.getTime() - dow * DIA));
}

/** Atalhos de período relativos a "hoje". */
export function atalho(nome: "mes" | "tri" | "ano" | "12m" | "tudo", hoje: string, primeira: string): { de: string; ate: string } {
  const d = toDate(hoje);
  if (nome === "mes") return { de: iso(new Date(d.getFullYear(), d.getMonth(), 1)), ate: hoje };
  if (nome === "tri") return { de: iso(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)), ate: hoje };
  if (nome === "ano") return { de: iso(new Date(d.getFullYear(), 0, 1)), ate: hoje };
  if (nome === "12m") return { de: iso(new Date(d.getFullYear(), d.getMonth() - 11, 1)), ate: hoje };
  return { de: primeira, ate: hoje };
}

export function periodoAnterior(de: string, ate: string) {
  const dur = diasEntre(de, ate) + 1;
  const fim = somaDias(de, -1);
  return { de: somaDias(fim, -(dur - 1)), ate: fim };
}

// ---------------------------------------------------------------- derivação
export function faixaAtraso(n: NotaDash, hoje: string): FaixaAtraso | null {
  if (n.cancelada || n.pagamento) return null;
  const venc = n.vencimento ?? n.emissao;
  const atraso = diasEntre(venc, hoje);
  if (atraso <= 0) return "A vencer";
  if (atraso <= 15) return "1–15 dias";
  if (atraso <= 30) return "16–30 dias";
  if (atraso <= 60) return "31–60 dias";
  if (atraso <= 90) return "61–90 dias";
  return "+90 dias";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Prazo médio (emissão → pagamento) por cliente e geral, das notas pagas. */
export function prazos(notas: NotaDash[]) {
  const por = new Map<string, number[]>();
  const todos: number[] = [];
  notas.forEach((n) => {
    if (!n.pagamento || n.cancelada) return;
    const d = diasEntre(n.emissao, n.pagamento);
    if (d < 0) return;
    todos.push(d);
    por.set(n.cliente, [...(por.get(n.cliente) ?? []), d]);
  });
  const media = (v: number[]) => (v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null);
  const cliente = new Map<string, number>();
  por.forEach((v, k) => {
    const m = media(v);
    if (m != null) cliente.set(k, m);
  });
  return { cliente, geral: media(todos) ?? 30 };
}

export function preparar(d: DashboardOut): Nota[] {
  const p = prazos(d.notas);
  return d.notas.map((n) => {
    const aberta = !n.pagamento && !n.cancelada;
    const doCliente = p.cliente.has(n.cliente);
    const dias = doCliente ? p.cliente.get(n.cliente)! : p.geral;
    return {
      ...n,
      mes: mesDe(n.emissao),
      atraso: faixaAtraso(n, d.hoje),
      previsao: aberta ? somaDias(n.emissao, dias) : null,
      prazoBase: aberta ? { dias, doCliente } : null,
      loteRotulo: n.lote != null ? `#${String(n.lote).padStart(4, "0")}` : "—",
      busca: semAcento([n.nf, n.fatura, n.cliente, n.doc, n.emissora, n.servico, n.lote, n.contrato, n.tipo].filter((x) => x != null).join(" ")),
    };
  });
}

// ---------------------------------------------------------------- filtros
/** Bucket da previsão (semana ou mês); previsões já passadas caem em "atrasada". */
export function bucketPrevisao(n: Nota, hoje: string, g: "semana" | "mes") {
  if (!n.previsao) return null;
  if (n.previsao < hoje) return "atrasada";
  return g === "semana" ? inicioSemana(n.previsao) : mesDe(n.previsao);
}

export function valorDim(n: Nota, d: Dimensao, hoje: string, g: "semana" | "mes"): string | null {
  switch (d) {
    case "cliente":
      return n.cliente;
    case "emissora":
      return n.emissora;
    case "situacao":
      return n.situacao;
    case "mes":
      return n.mes;
    case "atraso":
      return n.atraso;
    case "tipo":
      return n.tipo;
    case "origem":
      return n.origem;
    case "contrato":
      return n.contrato;
    case "nfse":
      return n.nfse;
    case "servico":
      return n.servico;
    case "lote":
      return n.loteRotulo;
    case "previsao":
      return bucketPrevisao(n, hoje, g);
  }
}

export interface Ctx {
  filtros: Filtros;
  hoje: string;
  g: "semana" | "mes";
}

/** A nota passa nos filtros (ignorando uma dimensão, para as contagens das segmentações e o realce dos gráficos). */
export function passa(n: Nota, c: Ctx, ignorar?: Dimensao) {
  for (const d of DIMENSOES) {
    if (d === ignorar) continue;
    const sel = c.filtros[d];
    if (!sel?.length) continue;
    const v = valorDim(n, d, c.hoje, c.g);
    if (v == null || !sel.includes(v)) return false;
  }
  // canceladas só entram quando a Situação pede (como no RCA)
  if (n.cancelada && ignorar !== "situacao" && !c.filtros.situacao?.includes("cancelada")) return false;
  return true;
}

const noPeriodo = (s: string | null, de: string, ate: string) => !!s && s >= de && s <= ate;
const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);

export function emitidasNoPeriodo(notas: Nota[], c: Ctx, de: string, ate: string, ignorar?: Dimensao) {
  return notas.filter((n) => noPeriodo(n.emissao, de, ate) && passa(n, c, ignorar));
}

// ---------------------------------------------------------------- medidas
export interface Medidas {
  emitido: number;
  recebido: number;
  aberto: number;
  vencido: number;
  iss: number;
  prazo: number | null;
  ticket: number | null;
  qtd: number;
  rejeicao: number | null;
}

/** Em aberto / vencido "na data X" (carteira naquele dia). */
function carteira(notas: Nota[], c: Ctx, x: string) {
  const ab = notas.filter((n) => !n.cancelada && n.emissao <= x && (!n.pagamento || n.pagamento > x) && passa(n, c));
  const venc = ab.filter((n) => (n.vencimento ?? n.emissao) < x);
  return { aberto: soma(ab.map((n) => n.valor)), vencido: soma(venc.map((n) => n.valor)) };
}

export function medidas(notas: Nota[], lotes: LoteDash[], c: Ctx, de: string, ate: string): Medidas {
  const base = emitidasNoPeriodo(notas, c, de, ate).filter((n) => !n.cancelada);
  const pagas = notas.filter((n) => noPeriodo(n.pagamento, de, ate) && !n.cancelada && passa(n, c));
  const dias = pagas.map((n) => diasEntre(n.emissao, n.pagamento!)).filter((d) => d >= 0);
  const x = ate < c.hoje ? ate : c.hoje;
  const cart = carteira(notas, c, x);
  const emitido = soma(base.map((n) => n.valor));
  const ls = lotesFiltrados(lotes, c, de, ate);
  const tot = soma(ls.map((l) => l.emitidas + l.rejeitadas));
  return {
    emitido,
    recebido: soma(pagas.map((n) => n.recebido || n.valor)),
    aberto: cart.aberto,
    vencido: cart.vencido,
    iss: soma(base.map((n) => n.iss)),
    prazo: dias.length ? soma(dias) / dias.length : null,
    ticket: base.length ? emitido / base.length : null,
    qtd: base.length,
    rejeicao: tot ? (soma(ls.map((l) => l.rejeitadas)) / tot) * 100 : null,
  };
}

export function lotesFiltrados(lotes: LoteDash[], c: Ctx, de: string, ate: string) {
  const meses = new Set(mesesEntre(de, ate));
  return lotes.filter(
    (l) =>
      meses.has(l.mes) &&
      (!c.filtros.mes?.length || c.filtros.mes.includes(l.mes)) &&
      (!c.filtros.lote?.length || c.filtros.lote.includes(`#${String(l.numero).padStart(4, "0")}`)),
  );
}

export const variacao = (atual: number | null, anterior: number | null) =>
  atual == null || anterior == null || anterior === 0 ? null : ((atual - anterior) / Math.abs(anterior)) * 100;

/** Série mensal de uma medida (para os sparklines): últimos até 12 meses do período. */
export function serieMensal(notas: Nota[], lotes: LoteDash[], c: Ctx, de: string, ate: string, k: keyof Medidas) {
  const ms = mesesEntre(de, ate).slice(-12);
  return ms.map((m) => {
    const ini = `${m}-01` < de ? de : `${m}-01`;
    const fim = fimDoMes(m) > ate ? ate : fimDoMes(m);
    return { m, v: medidas(notas, lotes, c, ini, fim)[k] ?? 0 };
  });
}

// ---------------------------------------------------------------- tendência
/** Regressão linear simples; devolve os valores ajustados e a variação % do primeiro ao último ponto. */
export function tendencia(v: number[]) {
  const n = v.length;
  if (n < 2) return { ajuste: v, pct: null as number | null };
  const xs = v.map((_, i) => i);
  const mx = soma(xs) / n;
  const my = soma(v) / n;
  const num = soma(xs.map((x, i) => (x - mx) * (v[i] - my)));
  const den = soma(xs.map((x) => (x - mx) ** 2));
  const b = den ? num / den : 0;
  const a = my - b * mx;
  const ajuste = xs.map((x) => Math.max(0, a + b * x));
  const ini = ajuste[0];
  return { ajuste, pct: ini > 0 ? ((ajuste[n - 1] - ini) / ini) * 100 : null };
}

// ---------------------------------------------------------------- CSV
export function csv(linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(esc).join(";")).join("\r\n");
}

export const normalizarBusca = semAcento;
