"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  CopyX,
  Info,
  Minus,
  PieChart,
  ScanSearch,
  Sparkles,
  TrendingUp,
  UserMinus,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { duracao, moeda, moedaCompacta, numero, percentual, toNum } from "@/lib/format";
import type { Insight, RaioXOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONE: Record<string, LucideIcon> = {
  duplicidade: CopyX,
  valor_atipico: TrendingUp,
  ausentes: UserMinus,
  variacao: ArrowUpDown,
  concentracao: PieChart,
};

const COR_SCORE = (s: number) => (s >= 80 ? "#1a8f5e" : s >= 50 ? "#f5a623" : "#c94343");

export const raioXKey = (loteId: number | null) => ["raio-x", loteId] as const;

function Gauge({ score, frase }: { score: number; frase: string }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  const arco = c * 0.75; // 270°
  const cor = COR_SCORE(score);
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative size-44">
        <div className="absolute inset-6 rounded-full blur-2xl" style={{ background: `${cor}33` }} />
        <svg viewBox="0 0 160 160" className="relative size-full rotate-[135deg]">
          <circle cx="80" cy="80" r={r} fill="none" stroke="var(--muted)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${arco} ${c}`} />
          <motion.circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke={cor}
            strokeWidth="12"
            strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${(arco * Math.max(0, Math.min(100, score))) / 100} ${c}` }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ filter: `drop-shadow(0 0 6px ${cor}80)` }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <AnimatedNumber value={score} className="block text-5xl font-semibold tracking-tight num" />
            <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">saúde do arquivo</span>
          </div>
        </div>
      </div>
      <p className="-mt-3 max-w-56 text-sm font-medium" style={{ color: cor }}>
        {frase}
      </p>
    </div>
  );
}

function CardInsight({ ins, ativo, onClick, i }: { ins: Insight; ativo: boolean; onClick: () => void; i: number }) {
  const Icone = ICONE[ins.tipo] ?? Info;
  const clicavel = ins.rps_ids.length > 0;
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 + i * 0.07 }}
      disabled={!clicavel}
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 rounded-xl border bg-background/60 p-3 text-left transition-all",
        clicavel && "hover:border-brand/40 hover:bg-background",
        ativo && "border-brand bg-brand/6 ring-2 ring-brand/30",
        !clicavel && "cursor-default",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          ins.nivel === "erro" && "bg-danger/10 text-danger-ink",
          ins.nivel === "aviso" && "bg-warning/12 text-warning-ink",
          ins.nivel !== "erro" && ins.nivel !== "aviso" && "bg-brand/10 text-info-ink",
        )}
      >
        <Icone className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{ins.titulo}</span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{ins.texto}</span>
        {clicavel && (
          <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-info-ink">
            {ativo ? "Mostrando na tabela ↓" : `Ver ${numero(ins.rps_ids.length)} linha(s) na tabela`}
          </span>
        )}
      </span>
    </motion.button>
  );
}

export function RaioX({
  loteId,
  qtdSelecionados,
  destaque,
  onDestacar,
  acao,
}: {
  loteId: number;
  qtdSelecionados: number;
  destaque: { titulo: string; ids: number[] } | null;
  onDestacar: (d: { titulo: string; ids: number[] } | null) => void;
  /** Ação extra no cabeçalho (ex.: botão "Análise por IA"). */
  acao?: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(true);
  const q = useQuery({
    queryKey: raioXKey(loteId),
    queryFn: () => api.get<RaioXOut>(`/nfse/importacoes/${loteId}/raio-x`),
    placeholderData: (prev) => prev,
    meta: { silencioso: true },
  });
  const rx = q.data;
  const maxCliente = Math.max(1, ...(rx?.top_clientes ?? []).map((c) => toNum(c.valor)));
  const comp = rx?.comparativo;
  const variacao = comp?.variacao ?? null;
  const SetaComp = variacao == null || variacao === 0 ? Minus : variacao > 0 ? ArrowUpRight : ArrowDownRight;

  if (q.isError) return null;

  return (
    <div className="card-surface relative mb-4 overflow-hidden">
      <div className="pointer-events-none absolute -top-24 left-1/3 h-48 w-96 rounded-full bg-brand/12 blur-3xl" />
      <div className="relative flex items-center gap-2 pr-3">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3.5 text-left"
        aria-expanded={aberto}
      >
        <span className="grid size-8 place-items-center rounded-lg brand-gradient text-white shadow-md shadow-brand/30">
          <ScanSearch className="size-4" />
        </span>
        <span className="font-semibold">Raio-X do arquivo</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-navy to-brand px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
          <Sparkles className="size-3" /> IA MayaCorp
        </span>
        {!aberto && rx && (
          <span className="ml-1 hidden truncate text-sm text-muted-foreground sm:inline">
            · saúde <strong style={{ color: COR_SCORE(rx.score) }}>{rx.score}</strong> · {rx.insights.length} insight(s)
          </span>
        )}
        {q.isFetching && rx && <span className="size-1.5 animate-pulse rounded-full bg-brand" title="Atualizando" />}
        <ChevronDown className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
      </button>
      {acao}
      </div>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="relative overflow-hidden"
          >
            {!rx ? (
              <div className="grid gap-4 border-t p-5 lg:grid-cols-[200px_1fr_280px]">
                <Skeleton className="mx-auto size-40 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
                <Skeleton className="h-40" />
              </div>
            ) : (
              <div className="grid gap-5 border-t p-5 lg:grid-cols-[200px_1fr_290px]">
                <Gauge score={rx.score} frase={rx.frase} />

                <div className="min-w-0 space-y-2">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">O que encontramos</p>
                  {rx.insights.length === 0 ? (
                    <div className="rounded-xl border border-success/25 bg-success/6 p-4 text-sm text-success-ink">
                      Nenhum ponto de atenção. Arquivo redondo. ✨
                    </div>
                  ) : (
                    <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 xl:grid-cols-2">
                      {rx.insights.map((ins, i) => {
                        const ativo = destaque?.titulo === ins.titulo;
                        return (
                          <CardInsight
                            key={`${ins.tipo}-${i}`}
                            ins={ins}
                            i={i}
                            ativo={ativo}
                            onClick={() => onDestacar(ativo ? null : { titulo: ins.titulo, ids: ins.rps_ids })}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2 rounded-xl bg-brand/8 px-3 py-2.5 text-sm">
                    <Zap className="size-4 shrink-0 text-warning" />
                    <span>
                      ≈ <strong className="num">{duracao(rx.previsao_segundos)}</strong> para emitir{" "}
                      <strong className="num">{numero(qtdSelecionados)}</strong> notas em <strong className="num">{rx.sublotes}</strong> lote(s)
                    </span>
                  </div>

                  {rx.top_clientes.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Maiores clientes</p>
                      <ul className="space-y-1.5">
                        {rx.top_clientes.slice(0, 5).map((c, i) => (
                          <li key={c.nome} className="text-xs">
                            <div className="flex justify-between gap-2">
                              <span className="truncate">{c.nome}</span>
                              <span className="shrink-0 num text-muted-foreground">{moedaCompacta(c.valor)}</span>
                            </div>
                            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                              <motion.div
                                className="h-full rounded-full bg-linear-to-r from-navy to-brand"
                                initial={{ width: 0 }}
                                animate={{ width: `${(toNum(c.valor) / maxCliente) * 100}%` }}
                                transition={{ delay: 0.2 + i * 0.06, duration: 0.6 }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {comp && (
                    <div className="flex items-center gap-3 rounded-xl border p-3">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-lg",
                          variacao == null || variacao === 0
                            ? "bg-muted text-muted-foreground"
                            : variacao > 0
                              ? "bg-success/10 text-success-ink"
                              : "bg-danger/10 text-danger-ink",
                        )}
                      >
                        <SetaComp className="size-4" />
                      </span>
                      <div className="min-w-0 text-xs">
                        <p>
                          <strong className="text-sm num">{percentual(variacao)}</strong>{" "}
                          <span className="text-muted-foreground">vs. lote #{String(comp.lote_anterior).padStart(4, "0")}</span>
                        </p>
                        <p className="truncate text-muted-foreground num">
                          {moeda(comp.valor_anterior)} → {moeda(comp.valor_atual)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
