"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, FileSpreadsheet, History, Scale } from "lucide-react";
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { ContasMulti, mesAtual } from "@/components/financeiro/comum";
import { Donut, eixoMoeda } from "@/components/financeiro/graficos";
import { Periodo, Stat } from "@/components/financeiro/ui";
import { Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, baixar } from "@/lib/api";
import { data, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

type Agrupar = "dia" | "semana" | "mes";

interface FluxoCaixa {
  saldo_anterior: number;
  entradas: number;
  saidas: number;
  saldo_final: number;
  resultado?: number;
  grupos: { chave: string; entradas: number; saidas: number; saldo: number }[];
  por_categoria: { tipo: "entrada" | "saida"; categoria: string; valor: number }[];
  linhas: {
    id: number;
    data: string;
    conta: string;
    descricao: string;
    categoria: string | null;
    subcategoria: string | null;
    favorecido: string | null;
    documento: string | null;
    entrada: number | null;
    saida: number | null;
    saldo: number;
    origem: string;
  }[];
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotulo(chave: string, agrupar: Agrupar) {
  if (agrupar === "mes") {
    const [a, m] = chave.split("-");
    return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
  }
  const [, m, d] = chave.split("-");
  return agrupar === "semana" ? `sem ${d}/${m}` : `${d}/${m}`;
}

export default function FluxoCaixaPage() {
  const [periodo, setPeriodo] = useState(mesAtual);
  const [contas, setContas] = useState<number[]>([]);
  const [agrupar, setAgrupar] = useState<Agrupar>("dia");
  const [limite, setLimite] = useState(150);
  const params = { de: periodo.de, ate: periodo.ate, conta_ids: contas, agrupar };
  const q = useQuery({
    queryKey: ["fin", "fluxo-caixa", params],
    queryFn: () => api.get<FluxoCaixa>("/financeiro/fluxo-caixa", params),
    placeholderData: (p) => p,
  });
  const r = q.data;
  const pontos = (r?.grupos ?? []).map((g) => ({ ...g, rotulo: rotulo(g.chave, agrupar), saidasNeg: g.saidas }));
  const ent = (r?.por_categoria ?? []).filter((c) => c.tipo === "entrada").map((c) => ({ nome: c.categoria, valor: c.valor }));
  const sai = (r?.por_categoria ?? []).filter((c) => c.tipo === "saida").map((c) => ({ nome: c.categoria, valor: c.valor }));

  return (
    <div>
      <PageHeader
        titulo="Fluxo de Caixa"
        descricao="O que entrou e saiu de verdade, conta a conta ou de todas juntas."
        icone={ArrowLeftRight}
        migalhas={[{ label: "Conta Bancária" }, { label: "Fluxo de Caixa" }]}
        acoes={
          <Button variant="outline" onClick={() => baixar("/financeiro/fluxo-caixa.xlsx", { query: { de: periodo.de, ate: periodo.ate, conta_ids: contas } }, "fluxo_caixa.xlsx")}>
            <FileSpreadsheet /> Exportar Excel
          </Button>
        }
      />
      <div className="card-surface mb-5 flex flex-wrap items-end gap-3 p-4">
        <Periodo idBase="fluxo" de={periodo.de} ate={periodo.ate} onChange={(de, ate) => setPeriodo({ de, ate })} />
        <Field label="Contas" htmlFor="fluxo-contas" className="w-full sm:w-64">
          <ContasMulti id="fluxo-contas" valor={contas} onChange={setContas} />
        </Field>
      </div>

      {q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !r ? null : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat rotulo="Saldo anterior" valor={moeda(r.saldo_anterior)} icone={History} tom={r.saldo_anterior < 0 ? "danger" : undefined} />
            <Stat rotulo="Entradas" valor={moeda(r.entradas)} icone={ArrowDownLeft} tom="success" />
            <Stat rotulo="Saídas" valor={moeda(r.saidas)} icone={ArrowUpRight} tom="danger" />
            <Stat
              rotulo="Saldo final"
              valor={moeda(r.saldo_final)}
              icone={Scale}
              tom={r.saldo_final < 0 ? "danger" : "success"}
              destaque
              sub={`Resultado do período ${moeda(r.entradas - r.saidas)}`}
            />
          </div>

          {r.linhas.length === 0 ? (
            <div className="card-surface">
              <EmptyState icone={ArrowLeftRight} titulo="Nenhum movimento no período" descricao="Troque o período ou as contas, ou lance o extrato na tela da conta." />
            </div>
          ) : (
            <>
              <ChartCard
                titulo="Entradas, saídas e saldo"
                subtitulo={contas.length !== 1 ? "Transferências entre as contas filtradas não contam como entrada nem saída." : undefined}
                acoes={
                  <Segmented<Agrupar>
                    value={agrupar}
                    onChange={setAgrupar}
                    opcoes={[
                      { value: "dia", label: "Dia" },
                      { value: "semana", label: "Semana" },
                      { value: "mes", label: "Mês" },
                    ]}
                  />
                }
                legenda={
                  <>
                    <LegendaItem cor="var(--viz-2)" rotulo="Entradas" />
                    <LegendaItem cor="var(--viz-vencida)" rotulo="Saídas" />
                    <LegendaItem cor="var(--viz-1)" rotulo="Saldo" forma="linha" />
                  </>
                }
              >
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                      <CartesianGrid vertical={false} {...GRADE} />
                      <XAxis dataKey="rotulo" {...EIXO} minTickGap={12} />
                      <YAxis yAxisId="v" {...EIXO} width={56} tickFormatter={eixoMoeda} />
                      <YAxis yAxisId="s" orientation="right" {...EIXO} width={56} tickFormatter={eixoMoeda} />
                      <Tooltip
                        cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                        content={({ active, payload }) => {
                          const p = payload?.[0]?.payload as (typeof pontos)[number] | undefined;
                          if (!active || !p) return null;
                          return (
                            <TooltipCaixa
                              titulo={p.rotulo}
                              linhas={[
                                { cor: "var(--viz-2)", rotulo: "Entradas", valor: moeda(p.entradas) },
                                { cor: "var(--viz-vencida)", rotulo: "Saídas", valor: moeda(p.saidas) },
                                { cor: "var(--viz-1)", rotulo: "Saldo", valor: moeda(p.saldo) },
                              ]}
                            />
                          );
                        }}
                      />
                      <Bar yAxisId="v" dataKey="entradas" fill="var(--viz-2)" maxBarSize={22} radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="v" dataKey="saidas" fill="var(--viz-vencida)" maxBarSize={22} radius={[4, 4, 0, 0]} />
                      <Line yAxisId="s" type="monotone" dataKey="saldo" stroke="var(--viz-1)" strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>

              <div className="grid gap-5 lg:grid-cols-2">
                <ChartCard titulo="Entradas por categoria">
                  <Donut dados={ent} vazio="Nenhuma entrada no período" />
                </ChartCard>
                <ChartCard titulo="Saídas por categoria">
                  <Donut dados={sai} vazio="Nenhuma saída no período" />
                </ChartCard>
              </div>

              <section className="card-surface overflow-hidden" aria-label="Movimentos">
                <header className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="font-semibold">Movimentos</h2>
                  <span className="text-xs text-muted-foreground">{r.linhas.length} lançamento(s)</span>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Data</th>
                        <th className="px-3 py-2.5 font-medium">Descrição</th>
                        <th className="px-3 py-2.5 font-medium">Conta</th>
                        <th className="px-3 py-2.5 font-medium">Categoria</th>
                        <th className="px-3 py-2.5 text-right font-medium">Entrada</th>
                        <th className="px-3 py-2.5 text-right font-medium">Saída</th>
                        <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      <tr className="bg-muted/20">
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{data(periodo.de)}</td>
                        <td colSpan={5} className="px-3 py-2 font-medium text-muted-foreground">
                          Saldo anterior
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{moeda(r.saldo_anterior)}</td>
                      </tr>
                      {r.linhas.slice(0, limite).map((l) => (
                        <tr key={l.id} className="hover:bg-accent/30">
                          <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{data(l.data)}</td>
                          <td className="max-w-72 px-3 py-2">
                            <p className="flex items-center gap-1.5">
                              <span className="truncate">{l.descricao}</span>
                              {l.origem === "transferencia" && <Pill tom="info">transferência</Pill>}
                            </p>
                            {l.favorecido && <p className="truncate text-[11px] text-muted-foreground">{l.favorecido}</p>}
                          </td>
                          <td className="px-3 py-2 text-xs">{l.conta}</td>
                          <td className="px-3 py-2 text-xs">
                            {l.categoria ?? "—"}
                            {l.subcategoria && <span className="text-muted-foreground"> › {l.subcategoria}</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-success-ink tabular-nums">{l.entrada != null ? moeda(l.entrada) : ""}</td>
                          <td className="px-3 py-2 text-right font-mono text-danger-ink tabular-nums">{l.saida != null ? moeda(l.saida) : ""}</td>
                          <td className={cn("px-3 py-2 text-right font-mono tabular-nums", l.saldo < 0 && "text-danger-ink")}>{moeda(l.saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {r.linhas.length > limite && (
                  <div className="border-t p-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setLimite((l) => l + 300)}>
                      Mostrar mais ({r.linhas.length - limite} restantes)
                    </Button>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
