"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { numero } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Superfície padrão das tabelas MayaCorp. */
export function TableCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("card-surface overflow-hidden", className)}>{children}</div>;
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar…",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full sm:w-80", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 rounded-lg bg-background pr-8 pl-9"
        data-busca
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/** Abas de filtro rápido em formato "segmented control". */
export function Segmented<T extends string>({
  value,
  onChange,
  opcoes,
}: {
  value: T;
  onChange: (v: T) => void;
  opcoes: { value: T; label: string; contagem?: number; tom?: "success" | "warning" | "danger" }[];
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-all",
            value === o.value && "bg-card text-foreground shadow-sm ring-1 ring-border",
          )}
        >
          {o.tom && (
            <span
              className={cn(
                "size-1.5 rounded-full",
                o.tom === "success" && "bg-success",
                o.tom === "warning" && "bg-warning",
                o.tom === "danger" && "bg-danger",
              )}
            />
          )}
          {o.label}
          {o.contagem !== undefined && (
            <span className="rounded bg-muted-foreground/10 px-1.5 text-[11px] num">{numero(o.contagem)}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  pagina,
  porPagina,
  total,
  onChange,
}: {
  pagina: number;
  porPagina: number;
  total: number;
  onChange: (p: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const de = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const ate = Math.min(total, pagina * porPagina);
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span>
        <span className="num text-foreground">{numero(de)}</span>–<span className="num text-foreground">{numero(ate)}</span> de{" "}
        <span className="num text-foreground">{numero(total)}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={pagina <= 1} onClick={() => onChange(pagina - 1)} aria-label="Anterior">
          <ChevronLeft />
        </Button>
        <span className="px-2 num">
          {pagina}/{paginas}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={pagina >= paginas}
          onClick={() => onChange(pagina + 1)}
          aria-label="Próxima"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function TableSkeleton({ linhas = 6, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: colunas }).map((__, j) => (
            <Skeleton key={j} className={cn("h-4", j === 0 ? "w-32" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Classes padrão para <tr> com hover e cursor. */
export const linhaClicavel = "cursor-pointer transition-colors hover:bg-accent/50";
