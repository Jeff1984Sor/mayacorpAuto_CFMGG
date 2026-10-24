import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export const tomNota = (n: number) => (n >= 80 ? "success" : n >= 60 ? "warning" : "danger");

const COR = {
  success: { txt: "text-success-ink", bg: "bg-success/10 ring-success/25", stroke: "var(--success)" },
  warning: { txt: "text-warning-ink", bg: "bg-warning/12 ring-warning/30", stroke: "var(--warning)" },
  danger: { txt: "text-danger-ink", bg: "bg-danger/10 ring-danger/25", stroke: "var(--danger)" },
};

/** Selo compacto com a nota do Revisor IA (0–100). */
export function IaBadge({ nota, className }: { nota: number | null | undefined; className?: string }) {
  if (nota == null) return <span className={cn("text-xs text-muted-foreground", className)}>—</span>;
  const c = COR[tomNota(nota)];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset", c.bg, c.txt, className)} title="Nota do Revisor IA">
      <Sparkles className="size-3" /> {nota}
    </span>
  );
}

/** Medidor semicircular da nota (0–100). */
export function IaGauge({ nota }: { nota: number }) {
  const v = Math.max(0, Math.min(100, nota));
  const c = COR[tomNota(v)];
  const r = 52;
  const comp = Math.PI * r;
  return (
    <div className="relative mx-auto w-44" role="img" aria-label={`Nota ${v} de 100`}>
      <svg viewBox="0 0 120 68" className="w-full">
        <path d="M 8 60 A 52 52 0 0 1 112 60" fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M 8 60 A 52 52 0 0 1 112 60"
          fill="none"
          stroke={c.stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={comp}
          strokeDashoffset={comp * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className={cn("text-3xl leading-none font-bold tabular-nums", c.txt)}>{v}</p>
        <p className="text-[11px] text-muted-foreground">de 100</p>
      </div>
    </div>
  );
}
