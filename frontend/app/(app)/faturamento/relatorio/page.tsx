"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, BarChart3, CheckCircle2, Clock, FileSpreadsheet, Receipt, Ticket, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { eixoMoeda } from "@/components/financeiro/graficos";
import { Periodo, Stat } from "@/components/financeiro/ui";
import { Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api, baixar } from "@/lib/api";
import { data, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Relatorio {
  resumo: {
    qtd: number;
    total: number;
    pago: number;
    em_aberto: number;
    vencido: number;
    qtd_vencidas: number;
    canceladas: number;
    ticket_medio: number;
    prazo_medio_recebimento: number | null;
    inadimplencia: number;
  };
  por_cliente: { tomador_id: number | null; cliente: string; qtd: number; total: number; pago: number; aberto: number }[];
  por_situacao: { situacao: string; qtd: number; total: number }[];
  por_mes: { mes: string; rotulo: string; qtd: number; total: number; pago: number }[];
  por_tipo: { tipo: string; qtd: number; total: number }[];
  por_contrato: { contrato_id: number; contrato: string; cliente: string; qtd: number; total: number }[];
  horas_por_profissional: { profissional: string; horas: number; valor: number }[];
  faturas: { id: number; codigo: string; tipo: string; cliente: string; emissao: string; vencimento: string; pago_em: string | null; total: number; situacao: string; nfse: number | null; dias_atraso: number }[];
}

const COR_SIT: Record<string, string> = { aberta: "var(--viz-aberta)", vencida: "var(--viz-vencida)", paga: "var(--viz-paga)", cancelada: "var(--viz-cancelada)" };
const ROT_SIT: Record<string, string> = { aberta: "Em aberto", vencida: "Vencida", paga: "Paga", cancelada: "Cancelada" };
type Aba = "clientes" | "contratos" | "horas" | "faturas";

const inicioAno = () => new Date(new Date().getFullYear(), 0, 1).toLocaleDateString("sv-SE");
const horas = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

export default function RelatorioFaturamentoPage() {
  const emissoras = useEmissoras();
  const [periodo, setPeriodo] = useState({ de: inicioAno(), ate: new Date().toLocaleDateString("sv-SE") });
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [emissora, setEmissora] = useState("");
  const [tipo, setTipo] = useState("");
  const [situacao, setSituacao] = useState("");
  const [aba, setAba] = useState<Aba>("clientes");
  const params = {
    de: periodo.de || undefined,
    ate: periodo.ate || undefined,
    tomador_id: cliente[0]?.id,
    emissora_id: emissora || undefined,
    tipo: tipo || undefined,
    situacao: situacao || undefined,
  };
  const q = useQuery({ queryKey: ["fin", "relatorio-faturamento", params], queryFn: () => api.get<Relatorio>("/financeiro/relatorio-faturamento", params), placeholderData: (p) => p });
  const r = q.data;
  const top = (r?.por_cliente ?? []).slice(0, 10).map((c) => ({ ...c, nome: c.cliente.length > 26 ? `${c.cliente.slice(0, 25)}…` : c.cliente }));
  const sit = (r?.por_situacao ?? []).filter((s) => s.total > 0);
  const totalSit = sit.reduce((a, s) => a + s.total, 0);

  return (
    <div>
      <PageHeader
        titulo="Relatório de Faturamento"
        icone={BarChart3}
        migalhas={[{ label: "Faturamento" }, { label: "Relatório" }]}
        acoes={
          <Button variant="outline" onClick={() => baixar("/financeiro/relatorio-faturamento.xlsx", { query: params }, "relatorio_faturamento.xlsx")}>
            <FileSpreadsheet /> Exportar Excel
          </Button>
        }
      />
      <section className="card-surface mb-5 flex flex-wrap items-end gap-3 p-4" aria-label="Filtros">
        <Periodo idBase="relfat" de={periodo.de} ate={periodo.ate} onChange={(de, ate) => setPeriodo({ de, ate })} />
        <Field label="Cliente" htmlFor="relfat-cliente" className="w-full sm:w-60">
          <ClientesMulti unico id="relfat-cliente" valor={cliente} onChange={setCliente} />
        </Field>
        {(emissoras.data?.length ?? 0) > 1 && (
          <Field label="Emissora" htmlFor="relfat-emissora">
            <NativeSelect id="relfat-emissora" value={emissora} onChange={(e) => setEmissora(e.target.value)} className="w-48">
              <option value="">Todas</option>
              {emissoras.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {nomeEmissora(e)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Tipo" htmlFor="relfat-tipo">
          <NativeSelect id="relfat-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-36">
            <option value="">NH e ND</option>
            <option value="honorarios">NH</option>
            <option value="despesas">ND</option>
          </NativeSelect>
        </Field>
        <Field label="Situação" htmlFor="relfat-sit">
          <NativeSelect id="relfat-sit" value={situacao} onChange={(e) => setSituacao(e.target.value)} className="w-36">
            <option value="">Todas</option>
            {Object.entries(ROT_SIT).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </section>

      {!r ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : r.resumo.qtd === 0 && r.faturas.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Receipt}
            titulo="Nenhuma fatura no período"
            descricao="Troque o período ou os filtros."
            acao={
              <Button variant="outline" render={<Link href="/faturamento/itens" />}>
                Ir para Itens a faturar
              </Button>
            }
          />
        </div>
      ) : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat rotulo="Faturado" valor={moeda(r.resumo.total)} icone={Receipt} tom="brand" sub={`${r.resumo.qtd} fatura(s)${r.resumo.canceladas ? ` · ${r.resumo.canceladas} cancelada(s)` : ""}`} />
            <Stat rotulo="Recebido" valor={moeda(r.resumo.pago)} icone={CheckCircle2} tom="success" />
            <Stat rotulo="Em aberto" valor={moeda(r.resumo.em_aberto)} icone={Wallet} />
            <Stat
              rotulo="Vencido"
              valor={moeda(r.resumo.vencido)}
              icone={AlarmClock}
              tom={r.resumo.vencido > 0 ? "danger" : undefined}
              sub={`${r.resumo.qtd_vencidas} fatura(s) · inadimplência ${r.resumo.inadimplencia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
            />
            <Stat rotulo="Ticket médio" valor={moeda(r.resumo.ticket_medio)} icone={Ticket} />
            <Stat rotulo="Prazo médio de recebimento" valor={r.resumo.prazo_medio_recebimento == null ? "—" : `${r.resumo.prazo_medio_recebimento} dias`} icone={Clock} sub="da emissão ao pagamento" />
          </div>

          <ChartCard
            titulo="Faturado × recebido por mês"
            legenda={
              <>
                <LegendaItem cor="var(--viz-1)" rotulo="Faturado" />
                <LegendaItem cor="var(--viz-2)" rotulo="Recebido" />
              </>
            }
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={r.por_mes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} {...GRADE} />
                  <XAxis dataKey="rotulo" {...EIXO} />
                  <YAxis {...EIXO} width={56} tickFormatter={eixoMoeda} />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as Relatorio["por_mes"][number] | undefined;
                      if (!active || !p) return null;
                      return (
                        <TooltipCaixa
                          titulo={p.rotulo}
                          linhas={[
                            { cor: "var(--viz-1)", rotulo: "Faturado", valor: moeda(p.total) },
                            { cor: "var(--viz-2)", rotulo: "Recebido", valor: moeda(p.pago) },
                          ]}
                          rodape={`${p.qtd} fatura(s)`}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="total" fill="var(--viz-1)" maxBarSize={26} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="pago" fill="var(--viz-2)" maxBarSize={26} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-5 xl:grid-cols-3">
            <ChartCard titulo="Top 10 clientes" subtitulo="Faturado no período" className="xl:col-span-2">
              <div style={{ height: Math.max(160, top.length * 32) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid horizontal={false} {...GRADE} />
                    <XAxis type="number" {...EIXO} tickFormatter={eixoMoeda} />
                    <YAxis type="category" dataKey="nome" {...EIXO} width={170} />
                    <Tooltip
                      cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                      content={({ active, payload }) => {
                        const p = payload?.[0]?.payload as (typeof top)[number] | undefined;
                        if (!active || !p) return null;
                        return (
                          <TooltipCaixa
                            titulo={p.cliente}
                            linhas={[
                              { cor: "var(--viz-1)", rotulo: "Faturado", valor: moeda(p.total) },
                              { cor: "var(--viz-2)", rotulo: "Recebido", valor: moeda(p.pago) },
                              { cor: "var(--viz-aberta)", rotulo: "Em aberto", valor: moeda(p.aberto) },
                            ]}
                          />
                        );
                      }}
                    />
                    <Bar dataKey="total" fill="var(--viz-1)" radius={[0, 4, 4, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
            <ChartCard titulo="Por situação">
              {sit.length === 0 ? (
                <p className="grid h-40 place-items-center text-sm text-muted-foreground">Sem faturas</p>
              ) : (
                <div className="space-y-3">
                  <div className="relative h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={sit} dataKey="total" nameKey="situacao" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke="var(--card)" strokeWidth={2}>
                          {sit.map((s) => (
                            <Cell key={s.situacao} fill={COR_SIT[s.situacao] ?? "var(--viz-muted)"} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Total</p>
                        <p className="font-mono text-sm font-semibold">{moeda(totalSit)}</p>
                      </div>
                    </div>
                  </div>
                  <ul className="space-y-1.5 text-xs">
                    {sit.map((s) => (
                      <li key={s.situacao} className="flex items-center gap-2">
                        <span className="size-2.5 rounded-[3px]" style={{ background: COR_SIT[s.situacao] }} />
                        <span className="flex-1">{ROT_SIT[s.situacao] ?? s.situacao}</span>
                        <span className="text-muted-foreground">{s.qtd}</span>
                        <span className="w-28 text-right font-mono">{moeda(s.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ChartCard>
          </div>

          <section className="card-surface overflow-hidden">
            <div className="border-b px-3 py-2.5">
              <Segmented<Aba>
                value={aba}
                onChange={setAba}
                opcoes={[
                  { value: "clientes", label: "Por cliente", contagem: r.por_cliente.length },
                  { value: "contratos", label: "Por contrato", contagem: r.por_contrato.length },
                  { value: "horas", label: "Horas por profissional", contagem: r.horas_por_profissional.length },
                  { value: "faturas", label: "Faturas", contagem: r.faturas.length },
                ]}
              />
            </div>
            <div className="max-h-[560px] overflow-auto">
              {aba === "clientes" && (
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Cliente</th>
                      <th className="px-3 py-2.5 text-right font-medium">Faturas</th>
                      <th className="px-3 py-2.5 text-right font-medium">Faturado</th>
                      <th className="px-3 py-2.5 text-right font-medium">Recebido</th>
                      <th className="px-4 py-2.5 text-right font-medium">Em aberto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {r.por_cliente.map((c) => (
                      <tr key={`${c.tomador_id}-${c.cliente}`} className="hover:bg-accent/30">
                        <td className="max-w-80 truncate px-4 py-2">{c.cliente}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{c.qtd}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{moeda(c.total)}</td>
                        <td className="px-3 py-2 text-right font-mono text-success-ink tabular-nums">{moeda(c.pago)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{moeda(c.aberto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {aba === "contratos" &&
                (r.por_contrato.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma fatura ligada a contrato no período.</p>
                ) : (
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Contrato</th>
                        <th className="px-3 py-2.5 font-medium">Cliente</th>
                        <th className="px-3 py-2.5 text-right font-medium">Faturas</th>
                        <th className="px-4 py-2.5 text-right font-medium">Faturado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {r.por_contrato.map((c) => (
                        <tr key={c.contrato_id} className="hover:bg-accent/30">
                          <td className="px-4 py-2">
                            <Link href={`/faturamento/contratos/${c.contrato_id}`} className="hover:underline">
                              {c.contrato}
                            </Link>
                          </td>
                          <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">{c.cliente}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{c.qtd}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{moeda(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              {aba === "horas" &&
                (r.horas_por_profissional.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma hora faturada no período.</p>
                ) : (
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Profissional</th>
                        <th className="px-3 py-2.5 text-right font-medium">Horas</th>
                        <th className="px-3 py-2.5 text-right font-medium">Valor/hora médio</th>
                        <th className="px-4 py-2.5 text-right font-medium">Faturado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {r.horas_por_profissional.map((h) => (
                        <tr key={h.profissional} className="hover:bg-accent/30">
                          <td className="px-4 py-2">{h.profissional}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{horas(h.horas)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground tabular-nums">{h.horas ? moeda(h.valor / h.horas) : "—"}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">{moeda(h.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              {aba === "faturas" && (
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Fatura</th>
                      <th className="px-3 py-2.5 font-medium">Cliente</th>
                      <th className="px-3 py-2.5 font-medium">Emissão</th>
                      <th className="px-3 py-2.5 font-medium">Vencimento</th>
                      <th className="px-3 py-2.5 font-medium">NFS-e</th>
                      <th className="px-3 py-2.5 text-right font-medium">Total</th>
                      <th className="px-4 py-2.5 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {r.faturas.map((f) => (
                      <tr key={f.id} className="hover:bg-accent/30">
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Pill tom={f.tipo === "despesas" ? "info" : "brand"} className="mr-1.5">
                            {f.tipo === "despesas" ? "ND" : "NH"}
                          </Pill>
                          <Link href={`/nfse/faturas/${f.id}`} className="font-mono font-semibold hover:underline">
                            {f.codigo}
                          </Link>
                        </td>
                        <td className="max-w-60 truncate px-3 py-2">{f.cliente}</td>
                        <td className="px-3 py-2 font-mono text-xs">{data(f.emissao)}</td>
                        <td className={cn("px-3 py-2 font-mono text-xs", f.situacao === "vencida" && "text-danger-ink")}>
                          {data(f.vencimento)}
                          {f.dias_atraso > 0 && <span className="ml-1 font-sans">({f.dias_atraso}d)</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{f.nfse ?? "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{moeda(f.total)}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={f.situacao} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
