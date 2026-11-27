"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  Check,
  Filter,
  ListFilter,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { numero } from "@/lib/format";
import {
  type ColunaMeta,
  descreverFiltro,
  ehNumerica,
  type Filtro,
  filtroVazio,
  type FonteMeta,
  PERIODOS,
} from "@/lib/relatorios";
import { cn } from "@/lib/utils";

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Barra de filtros: um chip por filtro (clique para editar), "+ Filtro" para qualquer coluna da fonte. */
export function BarraFiltros({
  fonte,
  filtros,
  onChange,
}: {
  fonte: FonteMeta;
  filtros: Filtro[];
  onChange: (f: Filtro[]) => void;
}) {
  const cols = useMemo(
    () => Object.fromEntries(fonte.colunas.map((c) => [c.id, c])),
    [fonte],
  );
  const [aberto, setAberto] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState("");

  const trocar = (i: number, f: Filtro) =>
    onChange(filtros.map((x, j) => (j === i ? f : x)));
  const tirar = (i: number) => onChange(filtros.filter((_, j) => j !== i));
  const fechar = (i: number) => {
    setAberto(null);
    if (filtros[i] && filtroVazio(filtros[i])) tirar(i);
  };
  const adicionar = (c: ColunaMeta) => {
    setNovo(false);
    setBusca("");
    const existe = filtros.findIndex((f) => f.coluna === c.id);
    if (existe >= 0) return setAberto(existe);
    onChange([...filtros, { coluna: c.id }]);
    setAberto(filtros.length);
  };
  const lista = fonte.colunas.filter(
    (c) => !busca || semAcento(c.rotulo).includes(semAcento(busca)),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Filter className="size-3.5" /> Filtros
      </span>
      {filtros.map((f, i) => {
        const c = cols[f.coluna];
        if (!c) return null;
        const vazio = filtroVazio(f);
        return (
          <Popover
            key={`${f.coluna}-${i}`}
            open={aberto === i}
            onOpenChange={(o) => (o ? setAberto(i) : fechar(i))}
          >
            <span
              className={cn(
                "inline-flex h-8 items-center rounded-full border text-sm transition-colors",
                vazio
                  ? "border-dashed text-muted-foreground"
                  : f.negar
                    ? "border-danger/30 bg-danger/8"
                    : "border-brand/25 bg-brand/8",
              )}
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex h-full max-w-80 items-center gap-1.5 truncate pr-1 pl-3"
                  >
                    {c.tipo === "data" ? (
                      <CalendarRange className="size-3.5 shrink-0 opacity-70" />
                    ) : (
                      <ListFilter className="size-3.5 shrink-0 opacity-70" />
                    )}
                    <span className="truncate">
                      {vazio ? c.rotulo : descreverFiltro(f, c)}
                    </span>
                  </button>
                }
              />
              <button
                type="button"
                aria-label={`Tirar o filtro ${c.rotulo}`}
                onClick={() => tirar(i)}
                className="mr-1 grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </span>
            <PopoverContent align="start" className="w-80 p-3">
              <EditorFiltro
                fonte={fonte}
                col={c}
                filtro={f}
                onAplicar={(nf) => {
                  setAberto(null);
                  if (filtroVazio(nf)) tirar(i);
                  else trocar(i, nf);
                }}
              />
            </PopoverContent>
          </Popover>
        );
      })}
      <Popover open={novo} onOpenChange={setNovo}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed px-3 text-sm text-muted-foreground hover:border-brand/40 hover:text-foreground"
            />
          }
        >
          <Plus className="size-3.5" /> Filtro
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-1 p-2">
          <div className="relative mb-1">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Filtrar por…"
              className="h-8 pl-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {lista.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => adicionar(c)}
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="truncate">{c.rotulo}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {ROTULO_TIPO[c.tipo]}
                </span>
              </button>
            ))}
            {lista.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Nenhuma coluna
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {filtros.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Limpar
        </button>
      )}
    </div>
  );
}

const ROTULO_TIPO: Record<string, string> = {
  texto: "texto",
  longo: "texto",
  lista: "lista",
  data: "data",
  bool: "sim/não",
  numero: "número",
  moeda: "valor",
  horas: "horas",
};

function EditorFiltro({
  fonte,
  col,
  filtro,
  onAplicar,
}: {
  fonte: FonteMeta;
  col: ColunaMeta;
  filtro: Filtro;
  onAplicar: (f: Filtro) => void;
}) {
  const [f, setF] = useState<Filtro>(filtro);
  const aplicar = () => onAplicar(f);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        aplicar();
      }}
    >
      <p className="text-sm font-semibold">{col.rotulo}</p>
      {col.tipo === "data" ? (
        <EditorData f={f} setF={setF} />
      ) : ehNumerica(col.tipo) ? (
        <EditorFaixa f={f} setF={setF} horas={col.tipo === "horas"} />
      ) : col.tipo === "bool" ? (
        <div className="flex gap-2">
          {["Sim", "Não"].map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={f.valores?.[0] === v ? "default" : "outline"}
              className="flex-1"
              onClick={() => setF({ ...f, valores: [v] })}
            >
              {v}
            </Button>
          ))}
        </div>
      ) : col.tipo === "lista" ? (
        <EditorLista fonte={fonte} col={col} f={f} setF={setF} />
      ) : (
        <Input
          autoFocus
          value={f.contem ?? ""}
          onChange={(e) => setF({ ...f, contem: e.target.value || null })}
          placeholder="Contém…"
        />
      )}
      <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Excluir (mostrar o que <b className="font-semibold">não</b> é isso)
        </span>
        <Switch
          checked={!!f.negar}
          onCheckedChange={(v) => setF({ ...f, negar: v })}
        />
      </label>
      <div className="flex justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onAplicar({ coluna: f.coluna })}
        >
          Limpar
        </Button>
        <Button type="submit" size="sm">
          <Check /> Aplicar
        </Button>
      </div>
    </form>
  );
}

function EditorData({ f, setF }: { f: Filtro; setF: (f: Filtro) => void }) {
  const modo = f.de || f.ate ? "faixa" : "relativo";
  return (
    <div className="space-y-2">
      <NativeSelect
        aria-label="Período"
        value={f.relativo ?? (modo === "faixa" ? "__faixa" : "")}
        onChange={(e) =>
          e.target.value === "__faixa"
            ? setF({
                ...f,
                relativo: null,
                de: f.de ?? new Date().toLocaleDateString("sv-SE"),
                ate: f.ate ?? null,
              })
            : setF({
                ...f,
                relativo: e.target.value || null,
                de: null,
                ate: null,
              })
        }
      >
        <option value="">Escolha…</option>
        {PERIODOS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.rotulo}
          </option>
        ))}
        <option value="__faixa">Entre datas…</option>
      </NativeSelect>
      {modo === "faixa" && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="date"
            aria-label="De"
            value={f.de ?? ""}
            onChange={(e) =>
              setF({ ...f, relativo: null, de: e.target.value || null })
            }
          />
          <Input
            type="date"
            aria-label="Até"
            value={f.ate ?? ""}
            onChange={(e) =>
              setF({ ...f, relativo: null, ate: e.target.value || null })
            }
          />
        </div>
      )}
    </div>
  );
}

function EditorFaixa({
  f,
  setF,
  horas,
}: {
  f: Filtro;
  setF: (f: Filtro) => void;
  horas: boolean;
}) {
  const num = (s: string) => (s === "" ? null : Number(s.replace(",", ".")));
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        inputMode="decimal"
        aria-label="A partir de"
        placeholder={horas ? "De (horas)" : "De"}
        value={f.min ?? ""}
        onChange={(e) => setF({ ...f, min: num(e.target.value) })}
      />
      <Input
        inputMode="decimal"
        aria-label="Até"
        placeholder={horas ? "Até (horas)" : "Até"}
        value={f.max ?? ""}
        onChange={(e) => setF({ ...f, max: num(e.target.value) })}
      />
    </div>
  );
}

function EditorLista({
  fonte,
  col,
  f,
  setF,
}: {
  fonte: FonteMeta;
  col: ColunaMeta;
  f: Filtro;
  setF: (f: Filtro) => void;
}) {
  const [busca, setBusca] = useState("");
  const q = useQuery({
    queryKey: ["relatorios", "valores", fonte.id, col.id],
    queryFn: () =>
      api.get<{ valor: string; qtd: number }[]>("/relatorios/valores", {
        fonte: fonte.id,
        coluna: col.id,
      }),
    staleTime: 60_000,
  });
  const marcados = new Set(f.valores ?? []);
  const lista = (q.data ?? []).filter(
    (v) => !busca || semAcento(v.valor).includes(semAcento(busca)),
  );
  const alternar = (v: string) => {
    const s = new Set(marcados);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    setF({ ...f, valores: [...s], contem: null });
  };
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar…"
          className="h-8 pl-8"
        />
      </div>
      <div className="max-h-60 overflow-y-auto rounded-md border">
        {q.isPending ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Carregando…
          </p>
        ) : lista.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Nada encontrado
          </p>
        ) : (
          lista.map((v) => (
            <label
              key={v.valor}
              className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-accent/60"
            >
              <Checkbox
                checked={marcados.has(v.valor)}
                onCheckedChange={() => alternar(v.valor)}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  v.valor === "(vazio)" && "text-muted-foreground italic",
                )}
                title={v.valor}
              >
                {v.valor}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {numero(v.qtd)}
              </span>
            </label>
          ))
        )}
      </div>
      {marcados.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {marcados.size} selecionado(s) ·{" "}
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={() => setF({ ...f, valores: [] })}
          >
            desmarcar
          </button>
        </p>
      )}
    </div>
  );
}
