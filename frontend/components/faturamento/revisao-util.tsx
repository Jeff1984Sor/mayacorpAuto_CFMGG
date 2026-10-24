import type { StatusRevisao } from "@/lib/faturamento";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export const STATUS_REVISAO: Record<StatusRevisao, { l: string; tom: "warning" | "success" | "neutral" }> = {
  em_revisao: { l: "Em revisão", tom: "warning" },
  faturada: { l: "Faturada", tom: "success" },
  descartada: { l: "Descartada", tom: "neutral" },
};

export function diasDesde(iso: string) {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function Diferenca({ total, original, className }: { total: string | number; original: string | number; className?: string }) {
  const d = toNum(total) - toNum(original);
  if (Math.abs(d) < 0.005) return null;
  return (
    <span className={cn("font-mono text-xs tabular-nums", d > 0 ? "text-success-ink" : "text-danger-ink", className)}>
      {d > 0 ? "+" : "−"}
      {moeda(Math.abs(d))}
    </span>
  );
}
