"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, CircleSlash, Clock, TrendingDown, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { moeda, moedaCompacta, numero, percentual } from "@/lib/format";
import { FAIXAS, ROTULO_SITUACAO, type Situacao } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "./ui";

const BARRA = { maxBarSize: 24, radius: [4, 4, 0, 0] as [number, number, number, number] };
const apagado = (sel: string[], k: string) => sel.length > 0 && !sel.includes(k);

interface TTProps<T> {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: T }>;
}

// recharts entrega o estado do clique com activeIndex (number | string)
type CliqueGrafico = { activeIndex?: number | string | null } | null | undefined;
const indiceDo = (s: CliqueGrafico) => (s && s.activeIndex != null ? Number(s.activeIndex) : null);

// =============================================================== Emitido × Recebido
export interface PontoMes {
  m: string;
  rotulo: string;
  emitido: number;
  recebido: number;
  tendencia: number;
}

export function EmitidoRecebido({
  dados,
  tendenciaPct,
  sel,
  onMes,
}: {
  dados: PontoMes[];
  tendenciaPct: number | null;
  sel: string[];
  onMes: (m: string) => void;
}) {
  const tt = ({ active, payload }: TTProps<PontoMes>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={p.rotulo}
        linhas={[
          { cor: "var(--viz-1)", rotulo: "Emitido", valor: moeda(p.emitido) },
          { cor: "var(--viz-2)", rotulo: "Recebido", valor: moeda(p.recebido) },
          { cor: "var(--viz-muted)", rotulo: "Tendência", valor: moeda(p.tendencia) },
        ]}
        rodape="Clique para filtrar este mês"
      />
    );
  };
  const sobe = (tendenciaPct ?? 0) >= 0;
  return (
    <ChartCard
      titulo="Emitido × Recebido por mês"
      subtitulo="Emitido pela data de emissão; recebido pela data do pagamento"
      className="lg:col-span-2"
      acoes={
        tendenciaPct != null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              sobe ? "bg-success/10 text-success-ink" : "bg-danger/10 text-danger-ink",
            )}
          >
            {sobe ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            tendência {percentual(tendenciaPct)}
          </span>
        )
      }
      legenda={
        <>
          <LegendaItem cor="var(--viz-1)" rotulo="Emitido" />
          <LegendaItem cor="var(--viz-2)" rotulo="Recebido" />
          <LegendaItem cor="var(--viz-muted)" rotulo="Tendência do emitido" forma="tracejado" />
        </>
      }
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={dados}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barGap={2}
            onClick={(s: CliqueGrafico) => {
              const i = indiceDo(s);
              if (i != null && dados[i]) onMes(dados[i].m);
            }}
            className="cursor-pointer"
          >
            <CartesianGrid vertical={false} {...GRADE} />
            <XAxis dataKey="rotulo" {...EIXO} />
            <YAxis {...EIXO} width={56} tickFormatter={(v: number) => moedaCompacta(v).replace("R$", "").trim()} />
            <Tooltip content={tt} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
            <Bar dataKey="emitido" name="Emitido" fill="var(--viz-1)" {...BARRA}>
              {dados.map((d) => (
                <Cell key={d.m} fillOpacity={apagado(sel, d.m) ? 0.28 : 1} />
              ))}
            </Bar>
            <Bar dataKey="recebido" name="Recebido" fill="var(--viz-2)" {...BARRA}>
              {dados.map((d) => (
                <Cell key={d.m} fillOpacity={apagado(sel, d.m) ? 0.28 : 1} />
              ))}
            </Bar>
            <Line
              type="linear"
              dataKey="tendencia"
              stroke="var(--viz-muted)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// =============================================================== Aging
export interface PontoAging {
  faixa: string;
  valor: number;
  qtd: number;
}
const COR_FAIXA: Record<string, string> = {
  "A vencer": "var(--viz-1)",
  "1–15 dias": "var(--viz-age-1)",
  "16–30 dias": "var(--viz-age-2)",
  "31–60 dias": "var(--viz-age-3)",
  "61–90 dias": "var(--viz-age-4)",
  "+90 dias": "var(--viz-age-5)",
};

export function Aging({ dados, sel, onFaixa }: { dados: PontoAging[]; sel: string[]; onFaixa: (f: string) => void }) {
  const total = dados.reduce((a, d) => a + d.valor, 0);
  const tt = ({ active, payload }: TTProps<PontoAging>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={p.faixa}
        linhas={[{ cor: COR_FAIXA[p.faixa], rotulo: `${numero(p.qtd)} nota(s)`, valor: moeda(p.valor) }]}
        rodape={total ? `${((p.valor / total) * 100).toFixed(1).replace(".", ",")}% do em aberto · clique para filtrar` : undefined}
      />
    );
  };
  return (
    <ChartCard titulo="Em aberto por atraso" subtitulo="Dias depois do vencimento, hoje">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            margin={{ top: 18, right: 4, left: 0, bottom: 0 }}
            onClick={(s: CliqueGrafico) => {
              const i = indiceDo(s);
              if (i != null && dados[i]) onFaixa(dados[i].faixa);
            }}
            className="cursor-pointer"
          >
            <CartesianGrid vertical={false} {...GRADE} />
            <XAxis dataKey="faixa" {...EIXO} interval={0} fontSize={10} tickFormatter={(v: string) => v.replace(" dias", "d")} />
            <YAxis {...EIXO} width={48} tickFormatter={(v: number) => moedaCompacta(v).replace("R$", "").trim()} />
            <Tooltip content={tt} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
            <Bar dataKey="valor" {...BARRA} maxBarSize={36}>
              {dados.map((d) => (
                <Cell key={d.faixa} fill={COR_FAIXA[d.faixa]} fillOpacity={apagado(sel, d.faixa) ? 0.28 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// =============================================================== Top clientes
export interface PontoCliente {
  cliente: string;
  curto: string;
  valor: number;
  pct: number;
  outros?: boolean;
}

/** Rótulo de categoria em uma linha só (truncado), alinhado ao eixo. */
function TickCliente({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: string } }) {
  const v = String(payload?.value ?? "");
  return (
    <text x={Number(x) - 6} y={Number(y)} dy={4} textAnchor="end" fontSize={11} fill="var(--viz-axis)">
      <title>{v}</title>
      {v.length > 22 ? `${v.slice(0, 21)}…` : v}
    </text>
  );
}

export function TopClientes({ dados, sel, onCliente }: { dados: PontoCliente[]; sel: string[]; onCliente: (c: string) => void }) {
  const tt = ({ active, payload }: TTProps<PontoCliente>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={p.cliente}
        linhas={[{ cor: "var(--viz-1)", rotulo: `${p.pct.toFixed(1).replace(".", ",")}% do total`, valor: moeda(p.valor) }]}
        rodape={p.outros ? undefined : "Clique para filtrar este cliente"}
      />
    );
  };
  return (
    <ChartCard titulo="Top clientes por emitido" subtitulo="Participação no total emitido do período">
      <div style={{ height: Math.max(180, dados.length * 30 + 20) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
            onClick={(s: CliqueGrafico) => {
              const i = indiceDo(s);
              const d = i != null ? dados[i] : null;
              if (d && !d.outros) onCliente(d.cliente);
            }}
            className="cursor-pointer"
          >
            <CartesianGrid horizontal={false} {...GRADE} />
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="curto" {...EIXO} width={150} interval={0} tick={<TickCliente />} />
            <Tooltip content={tt} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
            <Bar dataKey="valor" maxBarSize={18} radius={[0, 4, 4, 0]}>
              {dados.map((d) => (
                <Cell
                  key={d.cliente}
                  fill={d.outros ? "var(--viz-muted)" : "var(--viz-1)"}
                  fillOpacity={!d.outros && apagado(sel, d.cliente) ? 0.28 : 1}
                />
              ))}
              <LabelList
                dataKey="pct"
                position="right"
                className="fill-muted-foreground"
                fontSize={11}
                formatter={(v: unknown) => `${Number(v).toFixed(1).replace(".", ",")}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

// =============================================================== Situação (rosca; status = ícone + rótulo, nunca só cor)
export interface PontoSituacao {
  situacao: Situacao;
  valor: number;
  qtd: number;
}
const COR_SIT: Record<Situacao, string> = {
  aberta: "var(--viz-aberta)",
  vencida: "var(--viz-vencida)",
  paga: "var(--viz-paga)",
  cancelada: "var(--viz-cancelada)",
};
const ICONE_SIT: Record<Situacao, React.ComponentType<{ className?: string }>> = {
  aberta: Clock,
  vencida: AlertTriangle,
  paga: CheckCircle2,
  cancelada: CircleSlash,
};

export function SituacaoRosca({ dados, sel, onSituacao }: { dados: PontoSituacao[]; sel: string[]; onSituacao: (s: string) => void }) {
  const total = dados.reduce((a, d) => a + d.valor, 0);
  const visiveis = dados.filter((d) => d.qtd > 0);
  const tt = ({ active, payload }: TTProps<PontoSituacao>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={ROTULO_SITUACAO[p.situacao]}
        linhas={[{ cor: COR_SIT[p.situacao], rotulo: `${numero(p.qtd)} nota(s)`, valor: moeda(p.valor) }]}
      />
    );
  };
  return (
    <ChartCard titulo="Situação" subtitulo="Valor das notas emitidas no período">
      <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col">
        <div className="relative size-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={visiveis}
                dataKey="valor"
                nameKey="situacao"
                innerRadius="64%"
                outerRadius="96%"
                paddingAngle={visiveis.length > 1 ? 2 : 0}
                cornerRadius={4}
                animationDuration={400}
                stroke="var(--card)"
                strokeWidth={2}
                onClick={(d: { situacao?: string; payload?: PontoSituacao }) => {
                  const s = d?.payload?.situacao ?? d?.situacao;
                  if (s) onSituacao(s);
                }}
                className="cursor-pointer"
              >
                {visiveis.map((d) => (
                  <Cell key={d.situacao} fill={COR_SIT[d.situacao]} fillOpacity={apagado(sel, d.situacao) ? 0.28 : 1} />
                ))}
              </Pie>
              <Tooltip content={tt} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-lg font-semibold">{moedaCompacta(total)}</p>
              <p className="text-[11px] text-muted-foreground">no período</p>
            </div>
          </div>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1">
          {dados.map((d) => {
            const I = ICONE_SIT[d.situacao];
            const on = sel.includes(d.situacao);
            return (
              <li key={d.situacao}>
                <button
                  type="button"
                  onClick={() => onSituacao(d.situacao)}
                  aria-pressed={on}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    on && "bg-brand/8 ring-1 ring-brand/30",
                    apagado(sel, d.situacao) && "opacity-55",
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: COR_SIT[d.situacao] }} />
                  <I className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{ROTULO_SITUACAO[d.situacao]}</span>
                  <span className="text-xs text-muted-foreground num">{numero(d.qtd)}</span>
                  <span className="shrink-0 text-right font-medium whitespace-nowrap num">{moedaCompacta(d.valor)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </ChartCard>
  );
}

// =============================================================== Previsão de recebimento
export interface PontoPrevisao {
  chave: string;
  rotulo: string;
  valor: number;
  qtd: number;
  atrasada?: boolean;
}

export function Previsao({
  dados,
  sel,
  onBucket,
  g,
  onG,
  prazoGeral,
  proximos30,
  atrasado,
}: {
  dados: PontoPrevisao[];
  sel: string[];
  onBucket: (k: string) => void;
  g: "semana" | "mes";
  onG: (g: "semana" | "mes") => void;
  prazoGeral: number;
  proximos30: number;
  atrasado: number;
}) {
  const tt = ({ active, payload }: TTProps<PontoPrevisao>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={p.atrasada ? "Previsão já passou (pagamento atrasado)" : p.rotulo}
        linhas={[{ cor: p.atrasada ? "var(--viz-vencida)" : "var(--viz-2)", rotulo: `${numero(p.qtd)} nota(s)`, valor: moeda(p.valor) }]}
        rodape="Clique para ver estas notas na tabela"
      />
    );
  };
  return (
    <ChartCard
      destaque
      titulo="Previsão de recebimento"
      subtitulo={`Data provável = emissão + prazo médio de cada cliente (geral: ${prazoGeral} dias)`}
      className="lg:col-span-2"
      acoes={
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {(["semana", "mes"] as const).map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => onG(x)}
              aria-pressed={g === x}
              className={cn("rounded-md px-2.5 py-1 font-medium text-muted-foreground", g === x && "bg-card text-foreground shadow-sm")}
            >
              {x === "semana" ? "Por semana" : "Por mês"}
            </button>
          ))}
        </div>
      }
      legenda={
        <>
          <LegendaItem cor="var(--viz-2)" rotulo="Previsto para receber" />
          <LegendaItem cor="var(--viz-vencida)" rotulo="Previsão já passou" />
        </>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 sm:max-w-md">
        <div className="rounded-xl border bg-background/60 p-2.5">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarClock className="size-3.5" /> Próximos 30 dias
          </p>
          <p className="text-lg font-semibold">{moeda(proximos30)}</p>
        </div>
        <div className="rounded-xl border bg-background/60 p-2.5">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <AlertTriangle className="size-3.5" /> Já deveria ter entrado
          </p>
          <p className={cn("text-lg font-semibold", atrasado > 0 && "text-danger-ink")}>{moeda(atrasado)}</p>
        </div>
      </div>
      <div className="h-60">
        {dados.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Nada em aberto para prever. 🎉</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dados}
              margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
              onClick={(s: CliqueGrafico) => {
                const i = indiceDo(s);
                if (i != null && dados[i]) onBucket(dados[i].chave);
              }}
              className="cursor-pointer"
            >
              <CartesianGrid vertical={false} {...GRADE} />
              <XAxis dataKey="rotulo" {...EIXO} interval="preserveStartEnd" minTickGap={8} />
              <YAxis {...EIXO} width={48} tickFormatter={(v: number) => moedaCompacta(v).replace("R$", "").trim()} />
              <Tooltip content={tt} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
              <Bar dataKey="valor" {...BARRA}>
                {dados.map((d) => (
                  <Cell key={d.chave} fill={d.atrasada ? "var(--viz-vencida)" : "var(--viz-2)"} fillOpacity={apagado(sel, d.chave) ? 0.28 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

// =============================================================== Rejeições (lotes)
export interface PontoRejeicao {
  m: string;
  rotulo: string;
  rejeitadas: number;
  emitidas: number;
  taxa: number;
}

export function Rejeicoes({ dados, sel, onMes }: { dados: PontoRejeicao[]; sel: string[]; onMes: (m: string) => void }) {
  const total = dados.reduce((a, d) => a + d.rejeitadas, 0);
  const tt = ({ active, payload }: TTProps<PontoRejeicao>) => {
    const p = payload?.[0]?.payload;
    if (!active || !p) return null;
    return (
      <TooltipCaixa
        titulo={p.rotulo}
        linhas={[{ cor: "var(--viz-vencida)", rotulo: "rejeitada(s)", valor: numero(p.rejeitadas) }]}
        rodape={`${numero(p.emitidas)} emitida(s) · taxa ${p.taxa.toFixed(1).replace(".", ",")}%`}
      />
    );
  };
  return (
    <ChartCard
      titulo="Rejeições por mês"
      subtitulo="RPS rejeitados pela Prefeitura, nos lotes"
      acoes={
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5" /> <span className="num">{numero(total)}</span> no período
        </span>
      }
    >
      <div className="h-56">
        {total === 0 ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
            <span>
              <CheckCircle2 className="mx-auto mb-1 size-6 text-success-ink" />
              Nenhuma rejeição no período.
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={dados}
              margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
              onClick={(s: CliqueGrafico) => {
                const i = indiceDo(s);
                if (i != null && dados[i]) onMes(dados[i].m);
              }}
              className="cursor-pointer"
            >
              <CartesianGrid vertical={false} {...GRADE} />
              <XAxis dataKey="rotulo" {...EIXO} />
              <YAxis {...EIXO} width={32} allowDecimals={false} />
              <Tooltip content={tt} cursor={{ fill: "var(--accent)", opacity: 0.5 }} />
              <Bar dataKey="rejeitadas" fill="var(--viz-vencida)" {...BARRA}>
                {dados.map((d) => (
                  <Cell key={d.m} fillOpacity={apagado(sel, d.m) ? 0.28 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
  );
}

export { FAIXAS };
