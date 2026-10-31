"use client";

import { cn } from "@/lib/utils";

export type TipoDocumento = "" | "honorarios" | "despesas";

const OPCOES: { v: TipoDocumento; l: string }[] = [
  { v: "", l: "Todas" },
  { v: "honorarios", l: "Honorários (NH)" },
  { v: "despesas", l: "Despesas (ND)" },
];

/** Filtro Nota de Honorários × Nota de Despesas (Faturas e Fluxo de Faturamento). */
export function FiltroDocumento({ valor, onChange }: { valor: TipoDocumento; onChange: (v: TipoDocumento) => void }) {
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Tipo de nota">
      {OPCOES.map((o) => {
        const on = valor === o.v;
        return (
          <button
            key={o.v || "todas"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.v)}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition",
              on && "bg-card text-foreground shadow-sm",
            )}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}
