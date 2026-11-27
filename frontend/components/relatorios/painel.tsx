"use client";

import {
  AreaChart,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BarChartHorizontal,
  ChartColumnStacked,
  EyeOff,
  LineChart,
  PieChart,
  Search,
} from "lucide-react";
import { useState } from "react";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AGREGACOES,
  type ConfigGrafico,
  type ConfigRelatorio,
  ehDimensao,
  ehNumerica,
  type FonteMeta,
  GRANULARIDADES,
  type TipoGrafico,
} from "@/lib/relatorios";
import { cn } from "@/lib/utils";

const TIPOS: {
  id: TipoGrafico;
  rotulo: string;
  icone: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "barras_h", rotulo: "Barras deitadas", icone: BarChartHorizontal },
  { id: "barras", rotulo: "Colunas", icone: BarChart3 },
  { id: "empilhado", rotulo: "Colunas empilhadas", icone: ChartColumnStacked },
  { id: "linhas", rotulo: "Linhas", icone: LineChart },
  { id: "area", rotulo: "Área", icone: AreaChart },
  { id: "rosca", rotulo: "Rosca", icone: PieChart },
  { id: "nenhum", rotulo: "Sem gráfico", icone: EyeOff },
];

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Painel "Montar": tipo de gráfico, agrupamento, medida e colunas da tabela (marcar e ordenar). */
export function PainelMontar({
  fonte,
  config,
  onChange,
}: {
  fonte: FonteMeta;
  config: ConfigRelatorio;
  onChange: (c: ConfigRelatorio) => void;
}) {
  const g = config.grafico;
  const setG = (p: Partial<ConfigGrafico>) =>
    onChange({ ...config, grafico: { ...g, ...p } });
  const dims = fonte.colunas.filter((c) => ehDimensao(c.tipo));
  const medidas = fonte.colunas.filter((c) => ehNumerica(c.tipo));
  const dim = fonte.colunas.find((c) => c.id === g.dimensao);
  const medidaNum = g.medida && g.medida !== "_contagem";
  const semGrafico = g.tipo === "nenhum";

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Gráfico
        </h3>
        <div
          className="grid grid-cols-7 gap-1"
          role="radiogroup"
          aria-label="Tipo de gráfico"
        >
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={g.tipo === t.id}
              title={t.rotulo}
              aria-label={t.rotulo}
              onClick={() =>
                setG({
                  tipo: t.id,
                  limite: t.id === "rosca" ? 8 : g.limite === 8 ? 15 : g.limite,
                })
              }
              className={cn(
                "grid aspect-square place-items-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground",
                g.tipo === t.id && "border-brand/40 bg-brand/10 text-info-ink",
              )}
            >
              <t.icone className="size-4" />
            </button>
          ))}
        </div>
        {!semGrafico && (
          <>
            <Field label="Agrupar por" htmlFor="rel-dim">
              <NativeSelect
                id="rel-dim"
                value={g.dimensao ?? ""}
                onChange={(e) => setG({ dimensao: e.target.value || null })}
              >
                <option value="">Escolha…</option>
                {dims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {dim?.tipo === "data" && (
              <Field label="Período de cada ponto" htmlFor="rel-gran">
                <NativeSelect
                  id="rel-gran"
                  value={g.granularidade ?? "mes"}
                  onChange={(e) =>
                    setG({
                      granularidade: e.target
                        .value as ConfigGrafico["granularidade"],
                    })
                  }
                >
                  {GRANULARIDADES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.rotulo}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {g.tipo !== "rosca" && (
              <Field
                label="Dividir por (cores)"
                htmlFor="rel-serie"
                dica="Até 8 cores; o resto vira “Outros”."
              >
                <NativeSelect
                  id="rel-serie"
                  value={g.serie ?? ""}
                  onChange={(e) => setG({ serie: e.target.value || null })}
                >
                  <option value="">Não dividir</option>
                  {dims
                    .filter((c) => c.id !== g.dimensao && c.tipo !== "data")
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
            )}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Medir" htmlFor="rel-med">
                <NativeSelect
                  id="rel-med"
                  value={g.medida ?? "_contagem"}
                  onChange={(e) => setG({ medida: e.target.value })}
                >
                  <option value="_contagem">
                    Quantidade ({fonte.rotulo_contagem.toLowerCase()})
                  </option>
                  {medidas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rotulo}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {medidaNum && (
                <Field label="Cálculo" htmlFor="rel-ag">
                  <NativeSelect
                    id="rel-ag"
                    value={g.agregacao ?? "soma"}
                    onChange={(e) =>
                      setG({
                        agregacao: e.target.value as ConfigGrafico["agregacao"],
                      })
                    }
                  >
                    {AGREGACOES.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.rotulo}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            {dim && dim.tipo !== "data" && (
              <Field label="Mostrar no gráfico" htmlFor="rel-lim">
                <NativeSelect
                  id="rel-lim"
                  value={g.limite ?? 15}
                  onChange={(e) => setG({ limite: Number(e.target.value) })}
                >
                  {[5, 8, 10, 15, 20, 30, 50].map((n) => (
                    <option key={n} value={n}>
                      Os {n} maiores
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </>
        )}
      </section>
      <Colunas fonte={fonte} config={config} onChange={onChange} />
    </div>
  );
}

function Colunas({
  fonte,
  config,
  onChange,
}: {
  fonte: FonteMeta;
  config: ConfigRelatorio;
  onChange: (c: ConfigRelatorio) => void;
}) {
  const [busca, setBusca] = useState("");
  const sel = config.colunas.filter((id) =>
    fonte.colunas.some((c) => c.id === id),
  );
  const por = Object.fromEntries(fonte.colunas.map((c) => [c.id, c]));
  const set = (colunas: string[]) => onChange({ ...config, colunas });
  const mover = (i: number, d: -1 | 1) => {
    const n = [...sel];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    set(n);
  };
  const livres = fonte.colunas.filter(
    (c) =>
      !sel.includes(c.id) &&
      (!busca || semAcento(c.rotulo).includes(semAcento(busca))),
  );
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Colunas{" "}
          <span className="font-normal normal-case">({sel.length})</span>
        </h3>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => set(fonte.colunas.map((c) => c.id))}
          >
            todas
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:underline"
            onClick={() =>
              set(fonte.colunas.filter((c) => c.padrao).map((c) => c.id))
            }
          >
            padrão
          </button>
        </div>
      </div>
      <ul className="space-y-0.5">
        {sel.map((id, i) => (
          <li
            key={id}
            className="group flex items-center gap-2 rounded-md bg-brand/6 py-1 pr-1 pl-2 text-sm"
          >
            <Checkbox
              checked
              onCheckedChange={() => set(sel.filter((x) => x !== id))}
              aria-label={`Tirar ${por[id].rotulo}`}
            />
            <span className="min-w-0 flex-1 truncate">{por[id].rotulo}</span>
            <button
              type="button"
              aria-label="Subir"
              disabled={i === 0}
              onClick={() => mover(i, -1)}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-foreground/10 disabled:opacity-25"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Descer"
              disabled={i === sel.length - 1}
              onClick={() => mover(i, 1)}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-foreground/10 disabled:opacity-25"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="relative pt-1">
        <Search className="absolute top-1/2 left-2.5 mt-0.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Adicionar coluna…"
          className="h-8 pl-8"
        />
      </div>
      <ul className="max-h-72 space-y-0.5 overflow-y-auto">
        {livres.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground">
              <Checkbox
                checked={false}
                onCheckedChange={() => set([...sel, c.id])}
              />
              <span className="truncate">{c.rotulo}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
