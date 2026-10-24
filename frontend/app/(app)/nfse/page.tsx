"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  Clock,
  FileCheck2,
  FileUp,
  Gauge,
  HandCoins,
  Info,
  Landmark,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { BotaoAnaliseIA } from "@/components/ia/analise-ia";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { KpiCard } from "@/components/mayacorp/kpi-card";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora, duracao, moeda, moedaCompacta, numero } from "@/lib/format";
import type { PainelOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const COR_STATUS: Record<string, string> = {
  concluido: "#1a8f5e",
  parcial: "#f5a623",
  falhou: "#c94343",
  transmitindo: "#7c8fff",
  na_fila: "#1e2d6b",
  validando: "color-mix(in oklab, #7c8fff 55%, #f7f8fc)",
  descartado: "color-mix(in oklab, #0f1729 30%, #f7f8fc)",
};
const ROTULO_STATUS: Record<string, string> = {
  concluido: "Emitido",
  parcial: "Parcial",
  falhou: "Rejeitado",
  transmitindo: "Transmitindo",
  na_fila: "Na fila",
  validando: "Validando",
  descartado: "Descartado",
};

function ChartTooltip({
  active,
  payload,
  label,
  fmt,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; payload?: Record<string, unknown> }[];
  label?: string;
  fmt?: (n: string, v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-foreground num">{fmt ? fmt(p.name, p.value) : numero(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

function Alertas({ alertas }: { alertas: PainelOut["alertas"] }) {
  const ICONE = { erro: AlertOctagon, aviso: AlertTriangle, info: Info } as const;
  return (
    <AnimatePresence initial={false}>
      {alertas.map((a, i) => {
        const I = ICONE[a.nivel as keyof typeof ICONE] ?? Info;
        return (
          <motion.div
            key={a.texto}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
              a.nivel === "erro" && "border-danger/25 bg-danger/6",
              a.nivel === "aviso" && "border-warning/30 bg-warning/8",
              a.nivel === "info" && "border-info/25 bg-info/6",
            )}
          >
            <I
              className={cn(
                "size-4 shrink-0",
                a.nivel === "erro" && "text-danger-ink",
                a.nivel === "aviso" && "text-warning-ink",
                a.nivel === "info" && "text-info-ink",
              )}
            />
            <span className="flex-1">{a.texto}</span>
            {a.href && (
              <Link href={a.href} className="shrink-0 text-xs font-medium underline-offset-4 hover:underline">
                Ver <ArrowRight className="inline size-3" />
              </Link>
            )}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

function Saude() {
  const { data: emissoras } = useEmissoras();
  if (!emissoras?.length) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {emissoras
        .filter((e) => e.ativa)
        .map((e) => (
          <Link
            key={e.id}
            href={`/cadastros/emissoras?id=${e.id}`}
            className={cn(
              "group flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-brand/40",
            )}
          >
            <div
              className={cn(
                "grid size-10 place-items-center rounded-lg",
                e.saude_ok ? "bg-success/10 text-success-ink" : "bg-danger/10 text-danger-ink",
              )}
            >
              {e.saude_ok ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nomeEmissora(e)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {e.saude_msg || (e.saude_ok ? "Pronta para emitir" : "Falta certificado válido")} · próximo RPS{" "}
                <span className="num">
                  {e.prox_rps}/{e.serie_rps}
                </span>
              </p>
            </div>
            <ArrowRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </Link>
        ))}
    </div>
  );
}

export default function PainelNfsePage() {
  const { isOperador } = useAuth();
  const q = useQuery({ queryKey: ["painel"], queryFn: () => api.get<PainelOut>("/nfse/painel"), refetchInterval: 30_000 });
  const p = q.data;
  const carregando = q.isPending;

  const porDia = (p?.por_dia ?? []).map((d) => ({ ...d, rotulo: data(d.dia).slice(0, 5) }));
  const top = (p?.top_tomadores ?? []).slice(0, 10).map((t) => ({ ...t, curto: t.nome.length > 22 ? `${t.nome.slice(0, 21)}…` : t.nome }));
  const status = (p?.status_lotes ?? []).filter((s) => s.qtd > 0);
  const totalLotes = status.reduce((a, s) => a + s.qtd, 0);

  return (
    <div className="space-y-6">
      <PageHeader analiseIA={false}
        titulo="Painel da NFS-e"
        descricao="Emissor inteligente em lote · layout 2 (ISS, IBS e CBS)"
        icone={Gauge}
        migalhas={[{ label: "Início", href: "/" }, { label: "NFS-e" }]}
        acoes={
          <>
            <BotaoAnaliseIA endpoint="/ia/analise/painel" contexto="Painel do mês" className="h-9" />
            {isOperador && (
              <Button render={<Link href="/nfse/nova-emissao" />} className="h-9 brand-gradient px-4 text-white shadow-md shadow-brand/25">
                <FileUp /> Nova emissão
              </Button>
            )}
          </>
        }
      />

      {p && p.alertas.length > 0 && (
        <div className="space-y-2">
          <Alertas alertas={p.alertas} />
        </div>
      )}

      <Saude />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard indice={0} titulo="Notas emitidas" icone={FileCheck2} carregando={carregando} valor={p && numero(p.notas_emitidas.valor)} variacao={p?.notas_emitidas.variacao} />
        <KpiCard indice={1} titulo="Valor faturado" icone={Banknote} carregando={carregando} valor={p && moedaCompacta(p.valor_faturado.valor)} variacao={p?.valor_faturado.variacao} />
        <KpiCard indice={2} titulo="ISS" icone={Landmark} carregando={carregando} valor={p && moedaCompacta(p.iss.valor)} variacao={p?.iss.variacao} />
        <KpiCard indice={3} titulo="Rejeições" icone={XCircle} inverso carregando={carregando} valor={p && numero(p.rejeicoes.valor)} variacao={p?.rejeicoes.variacao} />
        <KpiCard indice={4} titulo="Tempo médio por lote" icone={Clock} inverso carregando={carregando} valor={p && duracao(p.tempo_medio_lote_seg.valor)} variacao={p?.tempo_medio_lote_seg.variacao} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/nfse/faturas?situacao=aberta" className="group card-surface relative flex items-center gap-4 overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-brand/40">
          <div className="pointer-events-none absolute -right-10 -bottom-10 size-32 rounded-full bg-brand/12 blur-2xl" />
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand/12 text-info-ink">
            <Wallet className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-muted-foreground">A receber</span>
            {p ? (
              <span className="block truncate text-2xl font-semibold num">{moeda(p.a_receber)}</span>
            ) : (
              <Skeleton className="mt-1 h-7 w-32" />
            )}
            <span className="text-xs text-muted-foreground">
              <span className="num">{numero(p?.a_receber_qtd ?? 0)}</span> fatura(s) em aberto
            </span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </Link>
        <Link href="/nfse/faturas?situacao=paga" className="group card-surface relative flex items-center gap-4 overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:border-success/40">
          <div className="pointer-events-none absolute -right-10 -bottom-10 size-32 rounded-full bg-success/12 blur-2xl" />
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-success/10 text-success-ink">
            <HandCoins className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-muted-foreground">Recebido no mês</span>
            {p ? (
              <span className="block truncate text-2xl font-semibold text-success-ink num">{moeda(p.recebido_mes)}</span>
            ) : (
              <Skeleton className="mt-1 h-7 w-32" />
            )}
            <span className="text-xs text-muted-foreground">baixas manuais e pelo extrato</span>
          </span>
          <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Notas emitidas por dia</h3>
              <p className="text-xs text-muted-foreground">Mês corrente</p>
            </div>
          </div>
          <div className="h-64">
            {carregando ? (
              <Skeleton className="size-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={porDia} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gNotas" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="rotulo" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip
                    cursor={{ stroke: "var(--brand)", strokeDasharray: 4 }}
                    content={<ChartTooltip fmt={(_, v) => `${numero(v)} notas`} />}
                  />
                  <Area type="monotone" dataKey="notas" name="notas" stroke="var(--brand)" strokeWidth={2.5} fill="url(#gNotas)" activeDot={{ r: 5, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card-surface p-5">
          <h3 className="font-semibold">Status dos últimos lotes</h3>
          <p className="text-xs text-muted-foreground">Emitido · parcial · rejeitado</p>
          <div className="relative mt-2 h-48">
            {carregando ? (
              <Skeleton className="mx-auto size-44 rounded-full" />
            ) : totalLotes === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">Sem lotes ainda</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={status} dataKey="qtd" nameKey="status" innerRadius="66%" outerRadius="92%" paddingAngle={status.length > 1 ? 3 : 0} cornerRadius={6} stroke="none">
                      {status.map((s) => (
                        <Cell key={s.status} fill={COR_STATUS[s.status] ?? "color-mix(in oklab, #0f1729 30%, #f7f8fc)"} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip fmt={(n, v) => `${ROTULO_STATUS[n] ?? n}: ${v}`} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <p className="text-2xl font-semibold num">{totalLotes}</p>
                    <p className="text-[11px] text-muted-foreground">lotes</p>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {status.map((s) => (
              <span key={s.status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: COR_STATUS[s.status] }} />
                {ROTULO_STATUS[s.status] ?? s.status} <span className="text-foreground num">{s.qtd}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card-surface p-5 lg:col-span-3">
          <h3 className="font-semibold">Top 10 tomadores por valor</h3>
          <p className="mb-3 text-xs text-muted-foreground">Mês corrente</p>
          <div className="h-80">
            {carregando ? (
              <Skeleton className="size-full" />
            ) : top.length === 0 ? (
              <EmptyState icone={Building2} titulo="Sem notas no mês" descricao="Os maiores clientes aparecem aqui." className="py-8" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <defs>
                    <linearGradient id="gBar" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#1e2d6b" />
                      <stop offset="100%" stopColor="var(--brand)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" tickFormatter={(v: number) => moedaCompacta(v)} />
                  <YAxis type="category" dataKey="curto" width={150} tickLine={false} axisLine={false} fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip fmt={(_, v) => moeda(v)} />} />
                  <Bar dataKey="valor" name="valor" fill="url(#gBar)" radius={[0, 6, 6, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card-surface flex flex-col p-5 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Lotes recentes</h3>
            <Button variant="ghost" size="sm" render={<Link href="/nfse/lotes" />}>
              Todos <ArrowRight />
            </Button>
          </div>
          <div className="flex-1 divide-y">
            {carregando && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="my-2.5 h-11" />)}
            {p?.ultimos_lotes.length === 0 && (
              <EmptyState icone={FileUp} titulo="Nenhum lote ainda" descricao="Suba o primeiro arquivo da Lello." className="py-8" />
            )}
            {p?.ultimos_lotes.map((l) => (
              <Link key={l.id} href={`/nfse/lotes/${l.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="num">#{String(l.numero).padStart(4, "0")}</span>
                    <span className="truncate text-muted-foreground">{l.emissora_nome}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="num">{numero(l.qtd_emitidas)}</span>/<span className="num">{numero(l.qtd)}</span> emitidas · {dataHora(l.criado_em)}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
