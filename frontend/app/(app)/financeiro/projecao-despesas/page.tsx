"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronRight, Info, Scale, TrendingDown, Wallet } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { eixoMoeda } from "@/components/financeiro/graficos";
import { Stat } from "@/components/financeiro/ui";
import { Segmented } from "@/components/mayacorp/data-table";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Projecao {
  saldo_atual: number;
  gasto_medio_sem_conta: number;
  receitas_total: number;
  despesas_total: number;
  saldo_final: number;
  primeiro_mes_negativo: string | null;
  linhas: {
    mes: string;
    rotulo: string;
    receitas: number;
    contas_a_pagar: number;
    gastos_estimados: number;
    despesas: number;
    resultado: number;
    saldo: number;
    qtd_contas: number;
    por_categoria: { categoria: string; valor: number }[];
  }[];
}

export default function ProjecaoDespesasPage() {
  const [meses, setMeses] = useState<"6" | "12" | "24">("12");
  const [aberto, setAberto] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["fin", "projecao-despesas", meses], queryFn: () => api.get<Projecao>("/financeiro/projecao-despesas", { meses }), placeholderData: (p) => p });
  const r = q.data;
  const pontos = (r?.linhas ?? []).map((l) => ({ ...l, despesasNeg: l.despesas }));

  return (
    <div>
      <PageHeader
        titulo="Projeção de Despesas"
        descricao="Para onde o caixa vai nos próximos meses, com o que já está lançado e a média de gastos."
        icone={TrendingDown}
        migalhas={[{ label: "Conta Bancária" }, { label: "Projeção de Despesas" }]}
        acoes={
          <Segmented
            value={meses}
            onChange={setMeses}
            opcoes={[
              { value: "6", label: "6 meses" },
              { value: "12", label: "12 meses" },
              { value: "24", label: "24 meses" },
            ]}
          />
        }
      />
      {q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !r ? null : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          {r.primeiro_mes_negativo && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                O saldo projetado fica <strong>negativo em {r.primeiro_mes_negativo}</strong>. Antecipe recebimentos, renegocie contas ou corte gastos antes disso.{" "}
                <Link href="/financeiro/previsao-caixa" className="font-medium underline">
                  Ver a previsão dia a dia
                </Link>
              </span>
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat rotulo="Saldo atual" valor={moeda(r.saldo_atual)} icone={Wallet} tom={r.saldo_atual < 0 ? "danger" : undefined} />
            <Stat rotulo={`Receitas previstas (${meses}m)`} valor={moeda(r.receitas_total)} icone={ArrowDownLeft} tom="success" />
            <Stat rotulo={`Despesas previstas (${meses}m)`} valor={moeda(r.despesas_total)} icone={ArrowUpRight} tom="danger" />
            <Stat rotulo="Saldo no fim" valor={moeda(r.saldo_final)} icone={Scale} tom={r.saldo_final < 0 ? "danger" : "success"} destaque />
          </div>

          <ChartCard
            titulo="Receitas × despesas e saldo projetado"
            legenda={
              <>
                <LegendaItem cor="var(--viz-2)" rotulo="Receitas" />
                <LegendaItem cor="var(--viz-vencida)" rotulo="Despesas" />
                <LegendaItem cor="var(--viz-1)" rotulo="Saldo projetado" forma="linha" />
              </>
            }
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pontos} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} {...GRADE} />
                  <XAxis dataKey="rotulo" {...EIXO} />
                  <YAxis {...EIXO} width={60} tickFormatter={eixoMoeda} />
                  <ReferenceLine y={0} stroke="var(--viz-axis)" />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as (typeof pontos)[number] | undefined;
                      if (!active || !p) return null;
                      return (
                        <TooltipCaixa
                          titulo={p.rotulo}
                          linhas={[
                            { cor: "var(--viz-2)", rotulo: "Receitas", valor: moeda(p.receitas) },
                            { cor: "var(--viz-vencida)", rotulo: "Despesas", valor: moeda(p.despesas) },
                            { cor: "var(--viz-1)", rotulo: "Saldo", valor: moeda(p.saldo) },
                          ]}
                          rodape={`${p.qtd_contas} conta(s) a pagar + ${moeda(p.gastos_estimados)} de gastos estimados`}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="receitas" fill="var(--viz-2)" maxBarSize={26} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="despesas" fill="var(--viz-vencida)" maxBarSize={26} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="saldo" stroke="var(--viz-1)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--viz-1)" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <section className="card-surface overflow-hidden" aria-label="Projeção mês a mês">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Mês</th>
                    <th className="px-3 py-2.5 text-right font-medium">Receitas</th>
                    <th className="px-3 py-2.5 text-right font-medium">Contas a pagar</th>
                    <th className="px-3 py-2.5 text-right font-medium">Gastos estimados</th>
                    <th className="px-3 py-2.5 text-right font-medium">Resultado</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {r.linhas.map((l, i) => {
                    const on = aberto === l.mes;
                    return (
                      <Fragment key={l.mes}>
                        <tr className={cn("cursor-pointer border-b hover:bg-accent/40", l.saldo < 0 && "bg-danger/[0.04]")} onClick={() => setAberto(on ? null : l.mes)}>
                          <td className="px-4 py-2.5 font-medium">
                            <span className="flex items-center gap-1.5">
                              <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", on && "rotate-90")} />
                              {l.rotulo}
                              {i === 0 && <span className="text-[11px] font-normal text-muted-foreground">(inclui atrasados)</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-success-ink tabular-nums">{moeda(l.receitas)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            {moeda(l.contas_a_pagar)} <span className="text-[11px] text-muted-foreground">({l.qtd_contas})</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-muted-foreground tabular-nums">{moeda(l.gastos_estimados)}</td>
                          <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", l.resultado < 0 ? "text-danger-ink" : "text-success-ink")}>{moeda(l.resultado)}</td>
                          <td className={cn("px-4 py-2.5 text-right font-mono font-semibold tabular-nums", l.saldo < 0 && "text-danger-ink")}>{moeda(l.saldo)}</td>
                        </tr>
                        {on && (
                          <tr className="border-b bg-muted/20">
                            <td colSpan={6} className="px-4 py-3">
                              {l.por_categoria.length === 0 ? (
                                <p className="pl-5 text-xs text-muted-foreground">Nenhuma conta a pagar lançada para o mês. Só entram os gastos estimados.</p>
                              ) : (
                                <ul className="grid gap-x-8 gap-y-1 pl-5 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                  {l.por_categoria.map((c) => (
                                    <li key={c.categoria} className="flex justify-between gap-2">
                                      <span className="truncate">{c.categoria}</span>
                                      <span className="font-mono tabular-nums">{moeda(c.valor)}</span>
                                    </li>
                                  ))}
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

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Como calculamos: saldo do mês = saldo anterior + receitas previstas (faturas em aberto e parcelas das regras de cobrança, no prazo médio que cada cliente costuma pagar) − contas a pagar
              em aberto − gastos estimados ({moeda(r.gasto_medio_sem_conta)}/mês, a média dos últimos 6 meses do que saiu do caixa sem passar por Contas a Pagar).
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
