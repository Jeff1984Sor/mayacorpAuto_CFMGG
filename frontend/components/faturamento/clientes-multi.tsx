"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { documento } from "@/lib/format";
import type { Pagina, TomadorOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ClienteEscolhido {
  id: number;
  nome: string;
}

/** Multisseleção de clientes com busca no servidor. `unico` = escolhe um só. */
export function ClientesMulti({
  valor,
  onChange,
  unico,
  id,
}: {
  valor: ClienteEscolhido[];
  onChange: (v: ClienteEscolhido[]) => void;
  unico?: boolean;
  id?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 250);
  const lista = useQuery({
    queryKey: ["tomadores-multi", busca],
    queryFn: () => api.get<Pagina<TomadorOut>>("/nfse/tomadores", { q: busca, por_pagina: 40 }),
    enabled: aberto,
  });
  const marcado = (cid: number) => valor.some((v) => v.id === cid);
  const alternar = (c: TomadorOut) => {
    if (unico) {
      onChange(marcado(c.id) ? [] : [{ id: c.id, nome: c.nome }]);
      setAberto(false);
      return;
    }
    onChange(marcado(c.id) ? valor.filter((v) => v.id !== c.id) : [...valor, { id: c.id, nome: c.nome }]);
  };
  const resumo = valor.length === 0 ? "Todos os clientes" : valor.length === 1 ? valor[0].nome : `${valor.length} clientes`;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
              valor.length > 0 && "border-brand/50 bg-brand/5",
            )}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{resumo}</span>
        {valor.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar clientes"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente"
              aria-label="Buscar cliente"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable={!unico}>
          {lista.data?.itens.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Nenhum cliente.</li>}
          {lista.data?.itens.map((c) => {
            const on = marcado(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => alternar(c)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className={cn("grid size-4 shrink-0 place-items-center border", unico ? "rounded-full" : "rounded", on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30")}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.nome}</span>
                    {c.cpf_cnpj && <span className="block font-mono text-[11px] text-muted-foreground">{documento(c.cpf_cnpj)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!unico && valor.length > 0 && (
          <div className="flex flex-wrap gap-1 border-t p-2">
            {valor.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-brand/12 py-0.5 pr-1 pl-2 text-xs">
                <span className="max-w-36 truncate">{v.nome}</span>
                <button type="button" onClick={() => onChange(valor.filter((x) => x.id !== v.id))} aria-label={`Remover ${v.nome}`} className="rounded-full p-0.5 hover:bg-foreground/10">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
