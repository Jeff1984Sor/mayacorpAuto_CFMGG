"use client";

import { CheckCircle2, Clock3, Info, Loader2, Radio, Send, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { dataHora } from "@/lib/format";
import type { LoteEvento, ProgressoOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function Anel({ pct }: { pct: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-48">
      <div className="absolute inset-4 rounded-full bg-brand/15 blur-2xl" />
      <svg viewBox="0 0 160 160" className="relative size-full -rotate-90">
        <defs>
          <linearGradient id="gAnel" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1e2d6b" />
            <stop offset="100%" stopColor="var(--brand)" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--muted)" strokeWidth="12" />
        <motion.circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="url(#gAnel)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.min(100, pct)) / 100 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <AnimatedNumber value={pct} format={(n) => `${Math.round(n)}%`} className="text-4xl font-semibold tracking-tight num" />
          <p className="text-xs text-muted-foreground">concluído</p>
        </div>
      </div>
    </div>
  );
}

const ICONE_EVENTO: Record<string, React.ComponentType<{ className?: string }>> = {
  erro: XCircle,
  aviso: TriangleAlert,
  sucesso: CheckCircle2,
  info: Info,
};

export function LinhaDoTempo({ eventos, compacta }: { eventos: LoteEvento[]; compacta?: boolean }) {
  const lista = compacta ? [...eventos].reverse().slice(0, 8) : eventos;
  return (
    <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
      <AnimatePresence initial={false}>
        {lista.map((e, i) => {
          const I = ICONE_EVENTO[e.nivel] ?? Info;
          return (
            <motion.li
              key={`${e.em}-${i}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative flex gap-3 pl-0"
            >
              <span
                className={cn(
                  "relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-card ring-1",
                  e.nivel === "erro" && "text-danger-ink ring-danger/30",
                  e.nivel === "aviso" && "text-warning-ink ring-warning/30",
                  e.nivel === "sucesso" && "text-success-ink ring-success/30",
                  e.nivel === "info" && "text-info-ink ring-brand/30",
                )}
              >
                <I className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 pb-0.5">
                <p className="text-sm">
                  <span className="mr-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{e.etapa}</span>
                  {e.texto}
                </p>
                <p className="text-[11px] text-muted-foreground num">{dataHora(e.em)}</p>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

export function Transmissao({ progresso, conectado }: { progresso: ProgressoOut | null; conectado: boolean }) {
  const p = progresso;
  const total = p?.sublotes_total ?? 0;
  const feitos = p?.sublotes_feitos ?? 0;
  const pct = p ? (p.percentual > 0 ? p.percentual : total ? (feitos / total) * 100 : 0) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="card-surface relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <Anel pct={pct} />
          <div className="flex-1 space-y-4 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {p ? <StatusBadge status={p.status} /> : <StatusBadge status="na_fila" />}
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Radio className={cn("size-3.5", conectado && "text-success-ink")} />
                {conectado ? "ao vivo" : "sincronizando"}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {p?.status === "na_fila" ? "Na fila de emissão…" : "Transmitindo à Prefeitura"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {p?.mensagem ?? "Testando o lote no ambiente de validação antes de enviar de verdade."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border bg-background/60 p-3">
                <p className="text-[11px] text-muted-foreground">Lote</p>
                <p className="text-lg font-semibold num">
                  {Math.min(feitos + (p?.status === "transmitindo" ? 1 : 0), total) || "–"}/{total || "–"}
                </p>
              </div>
              <div className="rounded-xl border border-success/25 bg-success/6 p-3">
                <p className="text-[11px] text-success-ink">Emitidas</p>
                <AnimatedNumber value={p?.qtd_emitidas ?? 0} className="text-lg font-semibold text-success-ink num" />
              </div>
              <div className="rounded-xl border border-danger/25 bg-danger/6 p-3">
                <p className="text-[11px] text-danger-ink">Rejeitadas</p>
                <AnimatedNumber value={p?.qtd_rejeitadas ?? 0} className="text-lg font-semibold text-danger-ink num" />
              </div>
            </div>
          </div>
        </div>

        {/* barra por lote (cada segmento = até 50 RPS) */}
        {total > 0 && (
          <div className="relative mt-6">
            <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Progresso por lote de até 50 RPS</span>
              <span className="num">
                {feitos}/{total}
              </span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: total }).map((_, i) => (
                <div key={i} className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  {i < feitos && (
                    <motion.div layout initial={{ width: 0 }} animate={{ width: "100%" }} className="absolute inset-y-0 left-0 rounded-full brand-gradient" />
                  )}
                  {i === feitos && p?.status === "transmitindo" && (
                    <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-brand/70 to-transparent bg-size-[200%_100%]" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative mt-6 grid gap-2 sm:grid-cols-3">
          {[
            { i: ShieldCheck, t: "Assinado com certificado A1" },
            { i: Send, t: "Teste antes do envio real" },
            { i: Clock3, t: "Novas tentativas automáticas" },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <x.i className="size-3.5 text-info-ink" /> {x.t}
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface flex flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Atividade do robô</h3>
          {p && !["concluido", "parcial", "falhou"].includes(p.status) && <Loader2 className="size-4 animate-spin text-info-ink" />}
        </div>
        <div className="max-h-96 flex-1 overflow-y-auto pr-1">
          {p?.eventos.length ? (
            <LinhaDoTempo eventos={p.eventos} compacta />
          ) : (
            <p className="text-sm text-muted-foreground">Aguardando o primeiro retorno…</p>
          )}
        </div>
        <p className="mt-4 rounded-xl bg-brand/8 p-3 text-xs text-muted-foreground">
          💡 Pode fechar esta tela: o robô continua trabalhando e avisa por e-mail quando terminar.
        </p>
      </div>
    </div>
  );
}
