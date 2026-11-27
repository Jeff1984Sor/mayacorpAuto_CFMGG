"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  EIXO,
  GRADE,
  LegendaItem,
  TooltipCaixa,
} from "@/components/dashboard/ui";
import {
  type Categoria,
  corSerie,
  formatar,
  formatarEixo,
  type ResultadoGrafico,
} from "@/lib/relatorios";

type Linha = { rotulo: string; total: number; cat: Categoria } & Record<
  string,
  unknown
>;

const curto = (s: string, n = 28) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** Gráfico do relatório. Clicar numa barra/fatia filtra por ela (e pela série, se houver). */
export function GraficoRelatorio({
  g,
  onClicar,
}: {
  g: ResultadoGrafico;
  onClicar?: (cat: Categoria, serie?: string) => void;
}) {
  const fmt = (v: number) => formatar(v, g.medida.tipo);
  const eixo = (v: number) => formatarEixo(v, g.medida.tipo);
  const series = g.series;
  const temSerie = series.length > 0;
  const linhas: Linha[] = g.categorias.map((c) => {
    const l: Linha = { rotulo: c.rotulo, total: c.total, cat: c };
    series.forEach((s, i) => (l[`s${i}`] = c.valores[s] ?? 0));
    return l;
  });
  const clicavel = (c: Categoria) =>
    !!onClicar && c.chave !== "__outros__" && c.chave !== "~";
  const cursor = onClicar ? "pointer" : undefined;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--accent)", opacity: 0.45 }}
      content={({ active, payload }) => {
        const p = payload?.[0]?.payload as Linha | undefined;
        if (!active || !p) return null;
        const itens = temSerie
          ? series
              .map((s, i) => ({ s, v: Number(p[`s${i}`] ?? 0) }))
              .filter((x) => x.v !== 0)
              .map((x) => ({
                cor: corSerie(x.s, series),
                rotulo: x.s,
                valor: fmt(x.v),
              }))
          : [
              {
                cor: "var(--viz-c1)",
                rotulo: g.medida.rotulo,
                valor: fmt(p.total),
              },
            ];
        const rodape = [
          temSerie && itens.length > 1 ? `Total ${fmt(p.total)}` : null,
          clicavel(p.cat) ? "Clique para filtrar" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <TooltipCaixa
            titulo={p.rotulo}
            linhas={itens.slice(0, 10)}
            rodape={rodape || undefined}
          />
        );
      }}
    />
  );

  const legenda =
    temSerie && g.tipo !== "rosca" ? (
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <LegendaItem
            key={s}
            cor={corSerie(s, series)}
            rotulo={s}
            forma={g.tipo === "linhas" ? "linha" : "rect"}
          />
        ))}
      </div>
    ) : null;

  const clicarBarra = (serie?: string) => (d: { payload?: Linha }) => {
    const c = d?.payload?.cat;
    if (c && clicavel(c)) onClicar?.(c, serie === "Outros" ? undefined : serie);
  };

  // ---------------------------------------------------------------------- rosca
  if (g.tipo === "rosca") {
    const fatias = g.categorias.filter((c) => c.total > 0);
    const nomes = fatias.map((c) => c.rotulo);
    const cor = (c: Categoria) =>
      c.chave === "__outros__" ? "var(--viz-muted)" : corSerie(c.rotulo, nomes);
    return (
      <div className="grid items-center gap-4 md:grid-cols-[minmax(0,260px)_1fr]">
        <div className="relative mx-auto aspect-square w-full max-w-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={fatias}
                dataKey="total"
                nameKey="rotulo"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={1.5}
                stroke="var(--card)"
                strokeWidth={2}
                onClick={(d: { payload?: Categoria }) =>
                  d?.payload && clicavel(d.payload) && onClicar?.(d.payload)
                }
                style={{ cursor }}
              >
                {fatias.map((c) => (
                  <Cell key={c.chave} fill={cor(c)} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  const c = payload?.[0]?.payload as Categoria | undefined;
                  if (!active || !c) return null;
                  const pct = g.total ? (c.total / g.total) * 100 : 0;
                  return (
                    <TooltipCaixa
                      titulo={c.rotulo}
                      linhas={[
                        {
                          cor: cor(c),
                          rotulo: `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
                          valor: fmt(c.total),
                        },
                      ]}
                      rodape={clicavel(c) ? "Clique para filtrar" : undefined}
                    />
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="font-mono text-base font-semibold">
                {fmt(g.total)}
              </p>
            </div>
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          {fatias.map((c) => {
            const pct = g.total ? (c.total / g.total) * 100 : 0;
            return (
              <li key={c.chave}>
                <button
                  type="button"
                  disabled={!clicavel(c)}
                  onClick={() => onClicar?.(c)}
                  className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-accent/60"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: cor(c) }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={c.rotulo}>
                    {c.rotulo}
                  </span>
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                    {pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                  </span>
                  <span className="w-28 text-right font-mono text-xs tabular-nums">
                    {fmt(c.total)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // ---------------------------------------------------------------------- linhas / área
  if (g.tipo === "linhas" || g.tipo === "area") {
    const chaves = temSerie ? series.map((_, i) => `s${i}`) : ["total"];
    const nomes = temSerie ? series : [g.medida.rotulo];
    const Grafico = g.tipo === "area" ? AreaChart : LineChart;
    return (
      <div>
        {legenda}
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <Grafico
              data={linhas}
              margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              onClick={(st: { activeLabel?: string | number }) => {
                const l = linhas.find((x) => x.rotulo === st?.activeLabel);
                if (l && clicavel(l.cat)) onClicar?.(l.cat);
              }}
              style={{ cursor }}
            >
              <CartesianGrid vertical={false} {...GRADE} />
              <XAxis
                dataKey="rotulo"
                {...EIXO}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis {...EIXO} width={64} tickFormatter={eixo} />
              {tooltip}
              {chaves.map((k, i) =>
                g.tipo === "area" ? (
                  <Area
                    key={k}
                    type="linear"
                    dataKey={k}
                    stackId={temSerie ? "a" : undefined}
                    stroke={corSerie(nomes[i], nomes)}
                    fill={corSerie(nomes[i], nomes)}
                    fillOpacity={0.22}
                    strokeWidth={2}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  />
                ) : (
                  <Line
                    key={k}
                    type="linear"
                    dataKey={k}
                    stroke={corSerie(nomes[i], nomes)}
                    strokeWidth={2}
                    dot={
                      linhas.length <= 24
                        ? {
                            r: 4,
                            strokeWidth: 2,
                            stroke: "var(--card)",
                            fill: corSerie(nomes[i], nomes),
                          }
                        : false
                    }
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                  />
                ),
              )}
            </Grafico>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------- barras
  const horizontal = g.tipo === "barras_h";
  const empilha = temSerie && (g.tipo === "empilhado" || horizontal);
  const chaves = temSerie ? series.map((_, i) => `s${i}`) : ["total"];
  const nomes = temSerie ? series : [g.medida.rotulo];
  const larguraEixo = Math.min(
    280,
    Math.max(90, Math.max(...linhas.map((l) => curto(l.rotulo).length)) * 7.4),
  );
  const altura = horizontal
    ? Math.max(
        180,
        linhas.length * (empilha || !temSerie ? 30 : 22 * chaves.length),
      )
    : 320;
  return (
    <div>
      {legenda}
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={linhas}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            barGap={2}
            barCategoryGap={horizontal ? "22%" : "18%"}
          >
            <CartesianGrid
              vertical={horizontal}
              horizontal={!horizontal}
              {...GRADE}
            />
            {horizontal ? (
              <>
                <XAxis type="number" {...EIXO} tickFormatter={eixo} />
                <YAxis
                  type="category"
                  dataKey="rotulo"
                  {...EIXO}
                  width={larguraEixo}
                  interval={0}
                  tick={({
                    x,
                    y,
                    payload,
                  }: {
                    x?: number | string;
                    y?: number | string;
                    payload?: { value?: unknown };
                  }) => (
                    // uma linha só (o recharts quebra o rótulo sozinho); o nome inteiro aparece no tooltip
                    <text
                      x={x}
                      y={y}
                      dy={4}
                      textAnchor="end"
                      fontSize={11}
                      fill="var(--viz-axis)"
                    >
                      {curto(String(payload?.value ?? ""))}
                    </text>
                  )}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="rotulo"
                  {...EIXO}
                  interval="preserveStartEnd"
                  minTickGap={8}
                  tickFormatter={(v: string) => curto(v, 16)}
                />
                <YAxis {...EIXO} width={64} tickFormatter={eixo} />
              </>
            )}
            {tooltip}
            {chaves.map((k, i) => {
              const ultima = i === chaves.length - 1;
              const raio: [number, number, number, number] = horizontal
                ? [0, 4, 4, 0]
                : [4, 4, 0, 0];
              return (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId={empilha ? "a" : undefined}
                  fill={corSerie(nomes[i], nomes)}
                  maxBarSize={horizontal ? 22 : 40}
                  radius={!empilha || ultima ? raio : 0}
                  stroke={empilha ? "var(--card)" : undefined}
                  strokeWidth={empilha ? 1 : 0}
                  onClick={clicarBarra(temSerie ? series[i] : undefined)}
                  style={{ cursor }}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
