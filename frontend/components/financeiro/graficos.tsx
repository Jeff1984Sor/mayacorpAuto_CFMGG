"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { TooltipCaixa } from "@/components/dashboard/ui";
import { moeda } from "@/lib/format";

/** Paleta categórica para donuts (ordenada por contraste; "Outras" fica cinza). */
export const CORES_CAT = [
  "var(--viz-1)",
  "var(--viz-2)",
  "#F5A623",
  "#C94343",
  "#0EA5E9",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "var(--viz-cancelada)",
];

export interface Fatia {
  nome: string;
  valor: number;
}

/** Donut com lista lateral (valor + %). */
export function Donut({
  dados,
  vazio = "Sem dados no período",
  altura = 180,
}: {
  dados: Fatia[];
  vazio?: string;
  altura?: number;
}) {
  const total = dados.reduce((a, d) => a + d.valor, 0);
  if (!dados.length || !total)
    return (
      <p className="grid h-40 place-items-center text-sm text-muted-foreground">
        {vazio}
      </p>
    );
  const top =
    dados.length > 8
      ? [
          ...dados.slice(0, 8),
          {
            nome: "Outras",
            valor: dados.slice(8).reduce((a, d) => a + d.valor, 0),
          },
        ]
      : dados;
  return (
    <div className="@container">
      <div className="grid items-center gap-4 @md:grid-cols-[180px_minmax(0,1fr)]">
        <div
          style={{ height: altura }}
          className="relative mx-auto w-full max-w-[200px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={top}
                dataKey="valor"
                nameKey="nome"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={1.5}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {top.map((d, i) => (
                  <Cell
                    key={d.nome}
                    fill={
                      d.nome === "Outras"
                        ? "var(--viz-cancelada)"
                        : CORES_CAT[i % CORES_CAT.length]
                    }
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as Fatia | undefined;
                  if (!active || !p) return null;
                  return (
                    <TooltipCaixa
                      titulo={p.nome}
                      linhas={[
                        {
                          cor: "var(--viz-1)",
                          rotulo: `${((p.valor / total) * 100).toFixed(1)}%`,
                          valor: moeda(p.valor),
                        },
                      ]}
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[10px] text-muted-foreground">Total</p>
              <p className="font-mono text-sm font-semibold">{moeda(total)}</p>
            </div>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs">
          {top.map((d, i) => (
            <li key={d.nome} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{
                  background:
                    d.nome === "Outras"
                      ? "var(--viz-cancelada)"
                      : CORES_CAT[i % CORES_CAT.length],
                }}
              />
              <span className="min-w-0 flex-1 truncate">{d.nome}</span>
              <span className="font-mono tabular-nums">{moeda(d.valor)}</span>
              <span className="w-11 text-right text-muted-foreground tabular-nums">
                {((d.valor / total) * 100).toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const eixoMoeda = (v: number) => {
  const a = Math.abs(v);
  const s =
    a >= 1e6
      ? `${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
      : a >= 1e3
        ? `${(a / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
        : a.toLocaleString("pt-BR");
  return v < 0 ? `-${s}` : s;
};
