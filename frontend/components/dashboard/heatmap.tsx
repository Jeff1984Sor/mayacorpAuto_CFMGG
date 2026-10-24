"use client";

import { useState } from "react";

import { moeda, moedaCompacta } from "@/lib/format";
import { nomeMes } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

import { ChartCard } from "./ui";

export interface Matriz {
  clientes: string[];
  meses: string[];
  valores: Record<string, Record<string, number>>; // cliente -> mes -> valor
  max: number;
}

const PASSOS = 7;
const corDo = (v: number, max: number) => {
  if (!v || !max) return null;
  const passo = Math.min(PASSOS, Math.max(1, Math.ceil((v / max) * PASSOS)));
  return `var(--viz-heat-${passo})`;
};

/** Heatmap cliente × mês (sequencial, uma cor). Clique na célula filtra cliente + mês. */
export function HeatmapClienteMes({
  matriz,
  selClientes,
  selMeses,
  onCelula,
}: {
  matriz: Matriz;
  selClientes: string[];
  selMeses: string[];
  onCelula: (cliente: string, mes: string) => void;
}) {
  const [foco, setFoco] = useState<{ c: string; m: string } | null>(null);
  const v = foco ? (matriz.valores[foco.c]?.[foco.m] ?? 0) : null;
  const ativo = (c: string, m: string) =>
    (!selClientes.length || selClientes.includes(c)) && (!selMeses.length || selMeses.includes(m));

  return (
    <ChartCard
      titulo="Cliente × mês"
      subtitulo="Valor emitido por cliente em cada mês · clique numa célula para filtrar os dois"
      className="lg:col-span-3"
      acoes={
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden>
          <span>menos</span>
          <span className="flex overflow-hidden rounded-sm">
            {Array.from({ length: PASSOS }).map((_, i) => (
              <span key={i} className="h-2.5 w-4" style={{ background: `var(--viz-heat-${i + 1})` }} />
            ))}
          </span>
          <span>mais ({moedaCompacta(matriz.max)})</span>
        </div>
      }
    >
      <p className="mb-2 h-5 truncate text-sm" aria-live="polite">
        {foco ? (
          <>
            <strong className="font-semibold">{moeda(v ?? 0)}</strong>{" "}
            <span className="text-muted-foreground">
              · {foco.c} · {nomeMes(foco.m)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Passe o mouse (ou use Tab) sobre uma célula para ver o valor.</span>
        )}
      </p>
      <div className="overflow-x-auto pb-1">
        <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card" />
              {matriz.meses.map((m) => (
                <th key={m} className="px-0.5 pb-1 text-center text-[11px] font-normal whitespace-nowrap text-muted-foreground">
                  {nomeMes(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matriz.clientes.map((c) => (
              <tr key={c}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-40 truncate bg-card pr-2 text-left text-xs font-normal text-muted-foreground"
                  title={c}
                >
                  {c}
                </th>
                {matriz.meses.map((m) => {
                  const valor = matriz.valores[c]?.[m] ?? 0;
                  const cor = corDo(valor, matriz.max);
                  const on = ativo(c, m);
                  return (
                    <td key={m} className="p-0">
                      <button
                        type="button"
                        aria-label={`${c}, ${nomeMes(m)}: ${moeda(valor)}`}
                        onMouseEnter={() => setFoco({ c, m })}
                        onFocus={() => setFoco({ c, m })}
                        onMouseLeave={() => setFoco(null)}
                        onBlur={() => setFoco(null)}
                        onClick={() => onCelula(c, m)}
                        className={cn(
                          "block h-7 w-full min-w-9 rounded-[4px] transition-[opacity,box-shadow] outline-none hover:ring-2 hover:ring-foreground/40 focus-visible:ring-2 focus-visible:ring-foreground/60",
                          !cor && "bg-muted/60",
                          !on && "opacity-25",
                        )}
                        style={cor ? { background: cor } : undefined}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
