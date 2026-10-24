"use client";

import { CalendarRange } from "lucide-react";

import { Field } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

import { mesAtual } from "./comum";

/** Cartão de indicador do financeiro. */
export function Stat({
  rotulo,
  valor,
  sub,
  tom,
  icone: I,
  destaque,
  className,
}: {
  rotulo: string;
  valor: React.ReactNode;
  sub?: React.ReactNode;
  tom?: "success" | "danger" | "warning" | "brand";
  icone?: React.ComponentType<{ className?: string }>;
  destaque?: boolean;
  className?: string;
}) {
  const cor = { success: "text-success-ink", danger: "text-danger-ink", warning: "text-warning-ink", brand: "text-info-ink" };
  const fundo = { success: "bg-success/10 text-success-ink", danger: "bg-danger/10 text-danger-ink", warning: "bg-warning/12 text-warning-ink", brand: "bg-brand/10 text-info-ink" };
  return (
    <div className={cn("card-surface flex min-w-0 items-start gap-3 p-4", destaque && "ring-1 ring-brand/30", className)}>
      {I && (
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tom ? fundo[tom] : "bg-muted text-muted-foreground")}>
          <I className="size-[18px]" />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{rotulo}</p>
        <p className={cn("mt-0.5 text-lg leading-tight font-semibold tracking-tight break-words tabular-nums xl:text-xl", tom && cor[tom])}>{valor}</p>
        {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

/** Valor com cor pelo sinal (teal ≥ 0, vermelho < 0). */
export function ValorSinal({ v, className, sinal }: { v: number; className?: string; sinal?: boolean }) {
  return (
    <span className={cn("font-mono tabular-nums", v < 0 ? "text-danger-ink" : "text-success-ink", className)}>
      {sinal && v > 0 ? "+" : ""}
      {moeda(v)}
    </span>
  );
}

/** Filtro de período (de/até) com atalho "Mês atual". */
export function Periodo({
  de,
  ate,
  onChange,
  idBase,
  atalhos = true,
}: {
  de: string;
  ate: string;
  onChange: (de: string, ate: string) => void;
  idBase: string;
  atalhos?: boolean;
}) {
  const hoje = new Date();
  const mes = (delta: number) => {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() + delta, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + delta + 1, 0);
    onChange(ini.toLocaleDateString("sv-SE"), fim.toLocaleDateString("sv-SE"));
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="De" htmlFor={`${idBase}-de`}>
        <Input id={`${idBase}-de`} type="date" value={de} onChange={(e) => onChange(e.target.value, ate)} className="w-38" />
      </Field>
      <Field label="Até" htmlFor={`${idBase}-ate`}>
        <Input id={`${idBase}-ate`} type="date" value={ate} min={de} onChange={(e) => onChange(de, e.target.value)} className="w-38" />
      </Field>
      {atalhos && (
        <div className="flex gap-1 pb-px">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              const m = mesAtual();
              onChange(m.de, m.ate);
            }}
          >
            <CalendarRange /> Mês atual
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => mes(-1)}>
            Mês passado
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => onChange(new Date(hoje.getFullYear(), 0, 1).toLocaleDateString("sv-SE"), hoje.toLocaleDateString("sv-SE"))}
          >
            No ano
          </Button>
        </div>
      )}
    </div>
  );
}
