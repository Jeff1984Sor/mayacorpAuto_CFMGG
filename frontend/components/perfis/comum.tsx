"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import type { CatalogoPermissoes, PerfilAcessoOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export const COR_PADRAO = "#64748B";
export const CORES_PERFIL = ["#1E2D6B", "#7C8FFF", "#1A8F5E", "#F5A623", "#C94343", "#0EA5E9", "#9333EA", "#DB2777", "#0F766E", "#64748B"];

export function usePerfisAcesso(enabled = true) {
  return useQuery({ queryKey: ["perfis"], queryFn: () => api.get<PerfilAcessoOut[]>("/config/perfis"), enabled, staleTime: 60_000 });
}

export function useCatalogo() {
  return useQuery({ queryKey: ["perfis", "catalogo"], queryFn: () => api.get<CatalogoPermissoes>("/config/perfis/catalogo"), staleTime: Infinity });
}

/** Total de permissões do catálogo ("recurso.acao"). */
export const todasDoCatalogo = (c: CatalogoPermissoes | undefined) =>
  c?.grupos.flatMap((g) => g.recursos.flatMap((r) => r.acoes.map((a) => `${r.id}.${a}`))) ?? [];

export function PontoCor({ cor, className }: { cor: string | null | undefined; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white/60 dark:ring-white/10", className)} style={{ background: cor || COR_PADRAO }} />;
}

/** Selo do perfil de acesso (lista de profissionais, cabeçalhos). */
export function PerfilBadge({ nome, cor, className }: { nome: string | null | undefined; cor: string | null | undefined; className?: string }) {
  const c = cor || COR_PADRAO;
  return (
    <span
      className={cn("inline-flex h-6 max-w-44 items-center gap-1.5 rounded-full px-2 text-xs font-medium", className)}
      style={{ background: `color-mix(in oklab, ${c} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${c} 32%, transparent)` }}
    >
      <PontoCor cor={c} className="size-2 ring-0" />
      <span className="truncate">{nome ?? "Sem perfil"}</span>
    </span>
  );
}

/** Escolha do perfil de acesso: botão com a cor e o nome; a lista mostra a descrição e quantas pessoas usam. */
export function PerfilAcessoSelect({
  id,
  value,
  onChange,
  disabled,
  className,
  compacto,
}: {
  id?: string;
  value: number | null;
  onChange: (id: number) => void;
  disabled?: boolean;
  className?: string;
  /** Versão menor, para trocar o perfil direto numa lista. */
  compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const perfis = usePerfisAcesso();
  const atual = perfis.data?.find((p) => p.id === value);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border bg-background text-left text-sm transition-colors outline-none hover:border-brand/40 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
          compacto ? "h-8 px-2.5" : "h-10 px-3",
          className,
        )}
      >
        {atual ? (
          <>
            <PontoCor cor={atual.cor} />
            <span className="min-w-0 flex-1 truncate font-medium">{atual.nome}</span>
            {atual.administrador && !compacto && <ShieldCheck className="size-3.5 text-info-ink" aria-label="Acesso total" />}
          </>
        ) : (
          <span className="flex-1 text-muted-foreground">{perfis.isPending ? "Carregando…" : "Escolha um perfil"}</span>
        )}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,340px)] gap-0 p-1">
        <div role="listbox" aria-label="Perfis de acesso" className="max-h-80 overflow-y-auto">
          {perfis.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={p.id === value}
              onClick={() => {
                onChange(p.id);
                setAberto(false);
              }}
              className={cn("flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent", p.id === value && "bg-brand/8")}
            >
              <PontoCor cor={p.cor} className="mt-1.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{p.nome}</span>
                  {p.administrador && <span className="rounded bg-brand/12 px-1 text-[10px] font-semibold text-info-ink uppercase">Acesso total</span>}
                </span>
                {p.descricao && <span className="block text-xs text-muted-foreground">{p.descricao}</span>}
              </span>
              <span className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">{p.qtd_usuarios}</span>
              {p.id === value && <Check className="mt-0.5 size-4 text-info-ink" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
