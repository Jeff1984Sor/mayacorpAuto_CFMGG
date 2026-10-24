"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { percentual } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sparkline: linha de desênfase, ponto final no acento. Sem eixos, apenas a forma da série. */
function Sparkline({ valores, alerta }: { valores: number[]; alerta?: boolean }) {
  if (valores.length < 2) return <div className="h-8" />;
  const w = 120;
  const h = 32;
  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const span = max - min || 1;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const [ux, uy] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="var(--viz-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={ux} cy={uy} r={3.5} fill={alerta ? "var(--viz-vencida)" : "var(--viz-1)"} stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}

/** Stat tile: rótulo · valor (proporcional) · delta vs período anterior · sparkline mensal. Clicável quando filtra. */
export function KpiTile({
  rotulo,
  valor,
  delta,
  bomSubir = true,
  serie,
  alerta,
  onClick,
  ativo,
  dica,
}: {
  rotulo: string;
  valor: string;
  delta: number | null;
  bomSubir?: boolean;
  serie: number[];
  alerta?: boolean;
  onClick?: () => void;
  ativo?: boolean;
  dica?: string;
}) {
  const bom = delta == null || Math.abs(delta) < 0.05 ? null : bomSubir ? delta > 0 : delta < 0;
  const Seta = delta == null || Math.abs(delta) < 0.05 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={dica}
      aria-pressed={onClick ? !!ativo : undefined}
      className={cn(
        "card-surface relative flex min-w-0 flex-col p-3.5 text-left transition-all",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:border-brand/40",
        ativo && "ring-2 ring-brand",
        alerta && "border-danger/35 bg-danger/[0.04]",
      )}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        {alerta && <span className="size-1.5 rounded-full bg-danger" aria-hidden />}
        {rotulo}
      </span>
      <span className={cn("mt-1 truncate text-[22px] leading-tight font-semibold tracking-tight", alerta && "text-danger-ink")}>{valor}</span>
      <span className="mt-1 flex items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md px-1 py-px font-medium num",
            bom === null && "bg-muted text-muted-foreground",
            bom === true && "bg-success/10 text-success-ink",
            bom === false && "bg-danger/10 text-danger-ink",
          )}
        >
          <Seta className="size-3" />
          {delta == null ? "—" : percentual(delta)}
        </span>
        <span className="truncate text-muted-foreground">vs. período anterior</span>
      </span>
      <div className="mt-2">
        <Sparkline valores={serie} alerta={alerta} />
      </div>
    </Tag>
  );
}
