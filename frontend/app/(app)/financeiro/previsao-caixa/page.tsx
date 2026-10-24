"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  AlertOctagon,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  ChartLine,
  Hourglass,
  Info,
  PiggyBank,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { DinheiroInput, useConfigFinanceiro } from "@/components/financeiro/comum";
import { Donut, eixoMoeda } from "@/components/financeiro/graficos";
import { Stat } from "@/components/financeiro/ui";
import { Segmented } from "@/components/mayacorp/data-table";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { paraDecimalApi } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Evento {
  tipo: "entrada" | "saida";
  origem: "conta_pagar" | "fatura" | "revisao" | "regra" | "estimado";
  id: number | null;
  data: string;
  descricao: string;
  quem: string | null;
  categoria: string;
  valor: number;
  vencida?: boolean;
}

interface Previsao {
  hoje: string;
  horizonte: number;
  saldo_minimo: number;
  alerta: { nivel: "critico" | "atencao" | "ok"; texto: string };
  kpis: {
    conta_corrente: number;
    investimento: number;
    entra: number;
    sai: number;
    menor_saldo: number;
    menor_saldo_data: string;
    menor_saldo_com_transferencias: number;
    folego_dias: number | null;
    primeiro_dia_abaixo_minimo: string | null;
  };
  serie: { data: string; sem_transferir: number; com_transferencias: number }[];
  realizado: { data: string; saldo: number }[];
  plano_transferencias: { data: string; valor: number; parcial: boolean }[];
  recebimentos_atrasados: { origem: string; id: number; descricao: string; cliente: string; data: string; vencimento?: string; valor: number; dias_atraso: number }[];
  saidas_30_dias: { categoria: string; valor: number }[];
  semanas: { inicio: string; fim: string; entra: number; sai: number; menor: number; saldo_fim: number; com_transferencias: number; gastos_estimados: number; eventos: Evento[] }[];
}

type Atraso = "7" | "15" | "30" | "nao";
interface Controles {
  minimo: string;
  horizonte: "30" | "60" | "90" | "180" | "365";
  atraso: Atraso;
  recorrentes: boolean;
  revisoes: boolean;
  gasto_medio: boolean;
}
const PADRAO: Controles = { minimo: "", horizonte: "90", atraso: "15", recorrentes: true, revisoes: false, gasto_medio: true };
const CHAVE = "mayacorp:previsao-caixa";

function lerControles(): Controles {
  try {
    const s = localStorage.getItem(CHAVE);
    return s ? { ...PADRAO, ...JSON.parse(s) } : PADRAO;
  } catch {
    return PADRAO;
  }
}

const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function linkEvento(e: Evento) {
  if (e.origem === "conta_pagar" && e.id) return `/financeiro/pagar/${e.id}`;
  if (e.origem === "fatura" && e.id) return `/nfse/faturas/${e.id}`;
  if (e.origem === "revisao" && e.id) return `/faturamento/revisoes/${e.id}`;
  return null;
}
const ROTULO_ORIGEM: Record<string, string> = { conta_pagar: "Conta a pagar", fatura: "Fatura", revisao: "Revisão", regra: "Parcela de contrato", estimado: "Estimado" };

export default function PrevisaoCaixaPage() {
  const cfg = useConfigFinanceiro();
  const [c, setC] = useState<Controles>(PADRAO);
  const [carregado, setCarregado] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- lê as preferências salvas no navegador */
  useEffect(() => {
    setC(lerControles());
    setCarregado(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!carregado) return;
    try {
      localStorage.setItem(CHAVE, JSON.stringify(c));
    } catch {
      /* navegador sem armazenamento: segue sem lembrar */
    }
  }, [c, carregado]);
  const set = <K extends keyof Controles>(k: K, v: Controles[K]) => setC((o) => ({ ...o, [k]: v }));
  const minimoDeb = useDebounce(c.minimo, 500);
  const params = {
    horizonte: Number(c.horizonte),
    saldo_minimo: minimoDeb.trim() ? paraDecimalApi(minimoDeb) : undefined,
    contar_atrasados: c.atraso !== "nao",
    atraso_dias: c.atraso === "nao" ? undefined : Number(c.atraso),
    recorrentes: c.recorrentes,
    revisoes: c.revisoes,
    gasto_medio: c.gasto_medio,
  };
  const q = useQuery({
    queryKey: ["fin", "previsao-caixa", params],
    queryFn: () => api.get<Previsao>("/financeiro/previsao-caixa", params),
    enabled: carregado,
    placeholderData: (p) => p,
  });
  const r = q.data;

  const pontos = r
    ? [
        ...r.realizado.slice(0, -1).map((p) => ({ data: p.data, realizado: p.saldo })),
        ...r.serie.map((p, i) => ({ data: p.data, sem: p.sem_transferir, com: p.com_transferencias, realizado: i === 0 ? r.realizado.at(-1)?.saldo : undefined })),
      ]
    : [];
  const temPlano = (r?.plano_transferencias.length ?? 0) > 0;
  const ALERTA = {
    critico: { cls: "border-danger/40 bg-danger/8 text-danger-ink", icone: AlertOctagon, titulo: "Risco de faltar dinheiro" },
    atencao: { cls: "border-warning/50 bg-warning/10 text-warning-ink", icone: ShieldAlert, titulo: "Atenção ao saldo mínimo" },
    ok: { cls: "border-success/40 bg-success/8 text-success-ink", icone: CheckCircle2, titulo: "Caixa tranquilo" },
  };
  const al = r ? ALERTA[r.alerta.nivel] : null;

  return (
    <div>
      <PageHeader
        titulo="Previsão de Caixa"
        icone={ChartLine}
        migalhas={[{ label: "Conta Bancária" }, { label: "Previsão de Caixa" }]}
      />

      {/* controles */}
      <section className="card-surface mb-5 grid gap-4 p-4 lg:grid-cols-[200px_auto_auto_1fr] lg:items-end" aria-label="Parâmetros da previsão">
        <Field label="Saldo mínimo" htmlFor="prev-min" dica={cfg.data ? `Vazio = ${moeda(cfg.data.saldo_minimo)} (Configurações)` : undefined}>
          <DinheiroInput id="prev-min" value={c.minimo} onChange={(v) => set("minimo", v)} placeholder={cfg.data ? toNum(cfg.data.saldo_minimo).toLocaleString("pt-BR") : "10.000"} />
        </Field>
        <Field label="Horizonte" htmlFor="prev-hor">
          <Segmented
            value={c.horizonte}
            onChange={(v) => set("horizonte", v)}
            opcoes={[
              { value: "30", label: "30d" },
              { value: "60", label: "60d" },
              { value: "90", label: "90d" },
              { value: "180", label: "180d" },
              { value: "365", label: "1 ano" },
            ]}
          />
        </Field>
        <Field label="Recebimento atrasado entra em" htmlFor="prev-atraso">
          <Segmented
            value={c.atraso}
            onChange={(v) => set("atraso", v)}
            opcoes={[
              { value: "7", label: "7 dias" },
              { value: "15", label: "15 dias" },
              { value: "30", label: "30 dias" },
              { value: "nao", label: "Não contar" },
            ]}
          />
        </Field>
        <div className="flex flex-wrap gap-x-5 gap-y-2 lg:justify-end">
          {(
            [
              ["recorrentes", "Parcelas de contratos"],
              ["revisoes", "Revisões em andamento"],
              ["gasto_medio", "Gastos médios do dia a dia"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Switch checked={c[k]} onCheckedChange={(v) => set(k, v)} aria-label={l} /> {l}
            </label>
          ))}
        </div>
      </section>

      {!r ? (
        <div className="space-y-4">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          {al && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} role="status" className={cn("flex items-start gap-3 rounded-2xl border px-4 py-3", al.cls)}>
              <al.icone className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-semibold">{al.titulo}</p>
                <p className="text-sm">{r.alerta.texto}</p>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat rotulo="Conta corrente" valor={moeda(r.kpis.conta_corrente)} icone={Wallet} tom={r.kpis.conta_corrente < 0 ? "danger" : "brand"} />
            <Stat rotulo="Investimento" valor={moeda(r.kpis.investimento)} icone={PiggyBank} />
            <Stat rotulo={`Entra (${r.horizonte}d)`} valor={moeda(r.kpis.entra)} icone={ArrowDownLeft} tom="success" />
            <Stat rotulo={`Sai (${r.horizonte}d)`} valor={moeda(r.kpis.sai)} icone={ArrowUpRight} tom="danger" />
            <Stat
              rotulo="Menor saldo"
              valor={moeda(r.kpis.menor_saldo)}
              icone={TrendingDown}
              tom={r.kpis.menor_saldo < 0 ? "danger" : r.kpis.menor_saldo < r.saldo_minimo ? "warning" : "success"}
              sub={`em ${data(r.kpis.menor_saldo_data)}${temPlano ? ` · com resgates ${moeda(r.kpis.menor_saldo_com_transferencias)}` : ""}`}
            />
            <Stat
              rotulo="Fôlego"
              valor={r.kpis.folego_dias == null ? `+${r.horizonte} dias` : `${r.kpis.folego_dias} dias`}
              icone={Hourglass}
              tom={r.kpis.folego_dias == null ? "success" : r.kpis.folego_dias < 30 ? "danger" : "warning"}
              sub={r.kpis.folego_dias == null ? "sem ficar negativo no horizonte" : "até o saldo ficar negativo (sem resgates)"}
            />
          </div>

          <ChartCard
            titulo="Saldo da conta corrente"
            subtitulo={`Últimos 60 dias realizados e os próximos ${r.horizonte} previstos`}
            destaque
            legenda={
              <>
                <LegendaItem cor="var(--viz-muted)" rotulo="Realizado" forma="linha" />
                <LegendaItem cor="var(--viz-1)" rotulo="Previsto sem transferir" forma="linha" />
                {temPlano && <LegendaItem cor="var(--viz-2)" rotulo="Com resgates do investimento" forma="linha" />}
                <LegendaItem cor="var(--viz-vencida)" rotulo={`Saldo mínimo ${moeda(r.saldo_minimo)}`} forma="tracejado" />
              </>
            }
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pontos} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="prev-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} {...GRADE} />
                  <XAxis dataKey="data" {...EIXO} tickFormatter={curta} minTickGap={28} />
                  <YAxis {...EIXO} width={60} tickFormatter={eixoMoeda} />
                  <ReferenceLine y={r.saldo_minimo} stroke="var(--viz-vencida)" strokeDasharray="6 4" strokeWidth={1.5} />
                  <ReferenceLine y={0} stroke="var(--viz-axis)" />
                  <ReferenceLine x={r.hoje} stroke="var(--viz-axis)" strokeDasharray="2 3" label={{ value: "hoje", position: "insideTopRight", fill: "var(--viz-axis)", fontSize: 11 }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as { data: string; realizado?: number; sem?: number; com?: number } | undefined;
                      if (!active || !p) return null;
                      const linhas = [];
                      if (p.realizado != null && p.sem == null) linhas.push({ cor: "var(--viz-muted)", rotulo: "Realizado", valor: moeda(p.realizado) });
                      if (p.sem != null) linhas.push({ cor: "var(--viz-1)", rotulo: "Sem transferir", valor: moeda(p.sem) });
                      if (temPlano && p.com != null && p.com !== p.sem) linhas.push({ cor: "var(--viz-2)", rotulo: "Com resgates", valor: moeda(p.com) });
                      const plano = r.plano_transferencias.find((t) => t.data === p.data);
                      return <TooltipCaixa titulo={data(p.data)} linhas={linhas} rodape={plano ? `Resgatar ${moeda(plano.valor)} do investimento` : undefined} />;
                    }}
                  />
                  <Line type="monotone" dataKey="realizado" stroke="var(--viz-muted)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Area type="monotone" dataKey="sem" stroke="var(--viz-1)" strokeWidth={2.5} fill="url(#prev-grad)" dot={false} />
                  {temPlano && <Line type="stepAfter" dataKey="com" stroke="var(--viz-2)" strokeWidth={2} dot={false} />}
                  {r.plano_transferencias.map((t) => {
                    const s = r.serie.find((x) => x.data === t.data);
                    return s ? <ReferenceDot key={t.data} x={t.data} y={s.com_transferencias} r={6} fill="var(--viz-2)" stroke="var(--card)" strokeWidth={2} /> : null;
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-5 xl:grid-cols-3">
            <section className="card-surface p-4" aria-labelledby="plano-t">
              <h2 id="plano-t" className="mb-3 flex items-center gap-2 font-semibold">
                <ArrowRightLeft className="size-4 text-success-ink" /> Plano de transferências
              </h2>
              {r.plano_transferencias.length === 0 ? (
                <p className="text-sm text-muted-foreground">{r.kpis.investimento > 0 ? "Não precisa resgatar do investimento no horizonte." : "Sem conta de investimento para resgatar."}</p>
              ) : (
                <ol className="space-y-2">
                  {r.plano_transferencias.map((t, i) => (
                    <li key={t.data} className="flex items-center gap-3 rounded-xl border bg-success/5 px-3 py-2">
                      <span className="grid size-7 place-items-center rounded-full bg-success/15 text-xs font-semibold text-success-ink">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-semibold">{moeda(t.valor)}</p>
                        <p className="text-[11px] text-muted-foreground">até {data(t.data)}</p>
                      </div>
                      {t.parcial && <Pill tom="danger">investimento acaba</Pill>}
                    </li>
                  ))}
                </ol>
              )}
              <Link href="/financeiro/contas" className="mt-3 inline-block text-xs text-info-ink hover:underline">
                Fazer a transferência em Contas
              </Link>
            </section>

            <section className="card-surface p-4 xl:col-span-2" aria-labelledby="atras-t">
              <h2 id="atras-t" className="mb-3 flex items-center gap-2 font-semibold">
                <AlarmClock className="size-4 text-danger-ink" /> Recebimentos atrasados
                <span className="text-xs font-normal text-muted-foreground">
                  {c.atraso === "nao" ? "(fora da previsão)" : `(entram daqui a ${c.atraso} dias)`}
                </span>
              </h2>
              {r.recebimentos_atrasados.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cliente atrasado. 🎉</p>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-1.5 font-medium">Cliente</th>
                        <th className="py-1.5 font-medium">Previsto</th>
                        <th className="py-1.5 text-right font-medium">Atraso</th>
                        <th className="py-1.5 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {r.recebimentos_atrasados.map((a) => (
                        <tr key={`${a.origem}-${a.id}`}>
                          <td className="max-w-64 py-1.5">
                            {a.origem === "fatura" ? (
                              <Link href={`/nfse/faturas/${a.id}`} className="block truncate hover:underline">
                                {a.descricao}
                              </Link>
                            ) : (
                              <span className="block truncate">{a.descricao}</span>
                            )}
                          </td>
                          <td className="py-1.5 font-mono text-xs">{data(a.data)}</td>
                          <td className="py-1.5 text-right text-xs font-medium text-danger-ink">{a.dias_atraso}d</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{moeda(a.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <ChartCard titulo="Para onde vai o dinheiro" subtitulo="Saídas previstas nos próximos 30 dias">
              <Donut dados={r.saidas_30_dias.map((s) => ({ nome: s.categoria, valor: s.valor }))} vazio="Nenhuma saída prevista" />
            </ChartCard>

            <section className="card-surface overflow-hidden xl:col-span-2" aria-label="Semana a semana">
              <header className="border-b px-4 py-3">
                <h2 className="font-semibold">Semana a semana</h2>
                <p className="text-xs text-muted-foreground">Clique numa semana para ver o que entra e sai.</p>
              </header>
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Semana</th>
                      <th className="px-3 py-2 text-right font-medium">Entra</th>
                      <th className="px-3 py-2 text-right font-medium">Sai</th>
                      <th className="px-3 py-2 text-right font-medium">Menor saldo</th>
                      <th className="px-4 py-2 text-right font-medium">Saldo no fim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.semanas.map((w) => {
                      const on = aberta === w.inicio;
                      const abaixo = w.menor < r.saldo_minimo;
                      return (
                        <Fragment key={w.inicio}>
                          <tr className={cn("cursor-pointer border-b hover:bg-accent/40", abaixo && "bg-danger/[0.04]")} onClick={() => setAberta(on ? null : w.inicio)}>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1.5">
                                <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", on && "rotate-90")} />
                                <span className="font-mono text-xs">
                                  {curta(w.inicio)} – {curta(w.fim)}
                                </span>
                                {w.eventos.length > 0 && <span className="text-[11px] text-muted-foreground">({w.eventos.length})</span>}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-success-ink tabular-nums">{w.entra ? moeda(w.entra) : "—"}</td>
                            <td className="px-3 py-2 text-right font-mono text-danger-ink tabular-nums">{w.sai ? moeda(w.sai) : "—"}</td>
                            <td className={cn("px-3 py-2 text-right font-mono tabular-nums", w.menor < 0 ? "font-semibold text-danger-ink" : abaixo && "text-warning-ink")}>{moeda(w.menor)}</td>
                            <td className={cn("px-4 py-2 text-right font-mono font-medium tabular-nums", w.saldo_fim < 0 && "text-danger-ink")}>{moeda(w.saldo_fim)}</td>
                          </tr>
                          {on && (
                            <tr className="border-b bg-muted/20">
                              <td colSpan={5} className="px-4 py-2.5">
                                {w.eventos.length === 0 && !w.gastos_estimados ? (
                                  <p className="pl-5 text-xs text-muted-foreground">Nada previsto nesta semana.</p>
                                ) : (
                                  <ul className="space-y-1 pl-5 text-xs">
                                    {w.eventos.map((e, i) => {
                                      const href = linkEvento(e);
                                      return (
                                        <li key={i} className="flex items-center gap-2">
                                          <span className="w-11 font-mono text-muted-foreground">{curta(e.data)}</span>
                                          {e.tipo === "entrada" ? <ArrowDownLeft className="size-3.5 text-success-ink" /> : <ArrowUpRight className="size-3.5 text-danger-ink" />}
                                          <span className="min-w-0 flex-1 truncate">
                                            {href ? (
                                              <Link href={href} className="hover:underline">
                                                {e.descricao}
                                              </Link>
                                            ) : (
                                              e.descricao
                                            )}
                                            {e.quem && <span className="text-muted-foreground"> · {e.quem}</span>}
                                          </span>
                                          <span className="hidden text-[11px] text-muted-foreground sm:inline">{ROTULO_ORIGEM[e.origem]}</span>
                                          {e.vencida && <Pill tom="danger">vencida</Pill>}
                                          <span className={cn("w-28 text-right font-mono tabular-nums", e.tipo === "entrada" ? "text-success-ink" : "text-danger-ink")}>
                                            {e.tipo === "entrada" ? "+" : "−"}
                                            {moeda(e.valor)}
                                          </span>
                                        </li>
                                      );
                                    })}
                                    {w.gastos_estimados > 0 && (
                                      <li className="flex items-center gap-2 text-muted-foreground">
                                        <span className="w-11" />
                                        <ArrowUpRight className="size-3.5" />
                                        <span className="flex-1">Gastos do dia a dia (média)</span>
                                        <span className="w-28 text-right font-mono tabular-nums">−{moeda(w.gastos_estimados)}</span>
                                      </li>
                                    )}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Considera as contas correntes ativas (investimento à parte). Recebimentos caem na data em que cada cliente costuma pagar; contas a pagar vencidas entram hoje; os gastos do
              dia a dia usam a média dos últimos 3 meses distribuída nos dias em que costumam acontecer.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
