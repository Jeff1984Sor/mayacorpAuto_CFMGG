"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { numero } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface OpcaoSlicer {
  valor: string;
  rotulo: string;
  qtd: number;
}

/** Segmentação multisseleção com busca e contagem (a contagem respeita os outros filtros). */
export function Slicer({
  titulo,
  opcoes,
  selecionados,
  onAlternar,
  onDefinir,
}: {
  titulo: string;
  opcoes: OpcaoSlicer[];
  selecionados: string[];
  onAlternar: (v: string) => void;
  onDefinir: (vals: string[]) => void;
}) {
  const [busca, setBusca] = useState("");
  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(() => opcoes.filter((o) => !termo || o.rotulo.toLowerCase().includes(termo)), [opcoes, termo]);
  const ativo = selecionados.length > 0;
  const resumo =
    selecionados.length === 0
      ? "Todos"
      : selecionados.length === 1
        ? (opcoes.find((o) => o.valor === selecionados[0])?.rotulo ?? selecionados[0])
        : `${selecionados.length} selecionados`;

  return (
    <Popover onOpenChange={(o) => !o && setBusca("")}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "flex h-12 min-w-0 flex-col items-start justify-center rounded-xl border bg-card px-3 text-left transition-all hover:border-brand/40",
              ativo && "border-brand/60 bg-brand/6 ring-1 ring-brand/25",
            )}
          />
        }
      >
        <span className="text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">{titulo}</span>
        <span className="flex w-full items-center gap-1 text-sm font-medium">
          <span className="min-w-0 flex-1 truncate">{resumo}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={`Buscar ${titulo.toLowerCase()}…`}
              className="h-8 w-full rounded-lg border bg-transparent pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable>
          {visiveis.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Nada encontrado</li>}
          {visiveis.map((o) => {
            const on = selecionados.includes(o.valor);
            return (
              <li key={o.valor}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onAlternar(o.valor)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    o.qtd === 0 && !on && "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded border",
                      on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30",
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground num">{numero(o.qtd)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t p-2">
          <button
            type="button"
            className="text-xs font-medium text-info-ink hover:underline disabled:opacity-40"
            onClick={() => onDefinir([...new Set([...selecionados, ...visiveis.map((o) => o.valor)])])}
            disabled={!visiveis.length}
          >
            Selecionar {termo ? "os visíveis" : "todos"}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
            onClick={() => onDefinir([])}
            disabled={!ativo}
          >
            <X className="size-3" /> Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
