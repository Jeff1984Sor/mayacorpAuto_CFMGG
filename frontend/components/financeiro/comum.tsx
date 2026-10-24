"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";

import { NativeSelect } from "@/components/mayacorp/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFieldId } from "@/components/ui/field-id";
import { api } from "@/lib/api";
import type { CategoriaOut, ConfigFinanceiroOut, ContaOut, FornecedorOut, TipoCategoria } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- dados
// Todas as chaves começam com "fin": invalidar ["fin"] atualiza o módulo inteiro.

export function useContasBancarias() {
  return useQuery({ queryKey: ["fin", "contas"], queryFn: () => api.get<ContaOut[]>("/financeiro/contas") });
}

export function useCategoriasFin(tipo?: TipoCategoria) {
  return useQuery({
    queryKey: ["fin", "categorias", tipo ?? "todas"],
    queryFn: () => api.get<CategoriaOut[]>("/financeiro/categorias", { tipo }),
    staleTime: 30_000,
  });
}

export function useFornecedores() {
  return useQuery({ queryKey: ["fin", "fornecedores"], queryFn: () => api.get<FornecedorOut[]>("/financeiro/fornecedores") });
}

export interface Favorecidos {
  fornecedores: { id: number; nome: string; tipo: string; categoria_padrao_id: number | null }[];
  funcionarios: { id: number; nome: string; cargo: string | null }[];
}

export function useFavorecidos() {
  return useQuery({ queryKey: ["fin", "favorecidos"], queryFn: () => api.get<Favorecidos>("/financeiro/favorecidos"), staleTime: 30_000 });
}

export function useConfigFinanceiro() {
  return useQuery({ queryKey: ["fin", "config"], queryFn: () => api.get<ConfigFinanceiroOut>("/financeiro/config"), staleTime: 60_000 });
}

// ---------------------------------------------------------------- datas
export const isoHoje = () => new Date().toLocaleDateString("sv-SE");
export function mesAtual() {
  const d = new Date();
  return {
    de: new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("sv-SE"),
    ate: new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString("sv-SE"),
  };
}

// ---------------------------------------------------------------- dinheiro
/** Campo de valor em reais ("1.234,56"). Guarda texto; converta com paraDecimalApi. */
export function DinheiroInput({
  value,
  onChange,
  id,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const fieldId = useFieldId();
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <Input
        id={id ?? fieldId}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ""))}
        placeholder="0,00"
        className={cn("pl-8 text-right font-mono tabular-nums", className)}
        {...props}
      />
    </div>
  );
}

// ---------------------------------------------------------------- categoria › subcategoria
/** Par de selects em cascata. */
export function CategoriaSubSelect({
  tipo,
  categoriaId,
  subcategoriaId,
  onChange,
  idBase,
  vazio = "Sem categoria",
  className,
}: {
  tipo?: TipoCategoria;
  categoriaId: number | null;
  subcategoriaId: number | null;
  onChange: (categoriaId: number | null, subcategoriaId: number | null) => void;
  idBase: string;
  vazio?: string;
  className?: string;
}) {
  const cats = useCategoriasFin(tipo);
  const lista = (cats.data ?? []).filter((c) => c.ativo || c.id === categoriaId);
  const cat = lista.find((c) => c.id === categoriaId);
  const subs = (cat?.subcategorias ?? []).filter((s) => s.ativo || s.id === subcategoriaId);
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
      <NativeSelect id={`${idBase}-cat`} aria-label="Categoria" value={categoriaId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, null)}>
        <option value="">{vazio}</option>
        {(["despesa", "receita"] as const)
          .filter((t) => !tipo || t === tipo)
          .map((t) => {
            const grupo = lista.filter((c) => c.tipo === t);
            if (!grupo.length) return null;
            return (
              <optgroup key={t} label={t === "despesa" ? "Despesas" : "Receitas"}>
                {grupo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </optgroup>
            );
          })}
      </NativeSelect>
      <NativeSelect
        id={`${idBase}-sub`}
        aria-label="Subcategoria"
        value={subcategoriaId ?? ""}
        disabled={!cat || subs.length === 0}
        onChange={(e) => onChange(categoriaId, e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{!cat ? "Subcategoria" : subs.length ? "Sem subcategoria" : "Sem subcategorias"}</option>
        {subs.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nome}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

// ---------------------------------------------------------------- favorecido
export type FavorecidoValor = { fornecedor_id: number | null; funcionario_id: number | null; favorecido: string | null };

export const nomeFavorecido = (v: FavorecidoValor, f?: Favorecidos) =>
  (v.fornecedor_id && f?.fornecedores.find((x) => x.id === v.fornecedor_id)?.nome) ||
  (v.funcionario_id && f?.funcionarios.find((x) => x.id === v.funcionario_id)?.nome) ||
  v.favorecido ||
  "";

function Item({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" role="option" aria-selected={on} onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
        <Check className={cn("size-3.5 shrink-0", on ? "text-info-ink" : "invisible")} />
        {children}
      </button>
    </li>
  );
}

/**
 * Combobox agrupado (Fornecedores / Profissionais) com texto livre.
 * `onNovoFornecedor` mostra o atalho "+ novo fornecedor" com o texto digitado.
 */
export function FavorecidoCombo({
  valor,
  onChange,
  id,
  onNovoFornecedor,
  onFornecedorEscolhido,
}: {
  valor: FavorecidoValor;
  onChange: (v: FavorecidoValor) => void;
  id?: string;
  onNovoFornecedor?: (nome: string) => void;
  onFornecedorEscolhido?: (f: Favorecidos["fornecedores"][number]) => void;
}) {
  const fieldId = useFieldId();
  const fav = useFavorecidos();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = q.trim().toLowerCase();
  const forn = (fav.data?.fornecedores ?? []).filter((f) => !termo || f.nome.toLowerCase().includes(termo));
  const func = (fav.data?.funcionarios ?? []).filter((f) => !termo || f.nome.toLowerCase().includes(termo));
  const atual = nomeFavorecido(valor, fav.data);
  const escolher = (v: FavorecidoValor) => {
    onChange(v);
    setAberto(false);
    setQ("");
  };
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id ?? fieldId}
            type="button"
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !atual && "text-muted-foreground")}>{atual || "Escolha ou digite…"}</span>
        {atual && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar favorecido"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ fornecedor_id: null, funcionario_id: null, favorecido: null });
            }}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) {
                  e.preventDefault();
                  escolher({ fornecedor_id: null, funcionario_id: null, favorecido: q.trim() });
                }
              }}
              placeholder="Buscar ou digitar um nome"
              aria-label="Buscar favorecido"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {forn.length > 0 && <li className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Fornecedores</li>}
          {forn.map((f) => (
            <Item
              key={`f${f.id}`}
              on={valor.fornecedor_id === f.id}
              onClick={() => {
                escolher({ fornecedor_id: f.id, funcionario_id: null, favorecido: null });
                onFornecedorEscolhido?.(f);
              }}
            >
              <span className="truncate">{f.nome}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{f.tipo}</span>
            </Item>
          ))}
          {func.length > 0 && <li className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Profissionais</li>}
          {func.map((f) => (
            <Item key={`u${f.id}`} on={valor.funcionario_id === f.id} onClick={() => escolher({ fornecedor_id: null, funcionario_id: f.id, favorecido: null })}>
              <span className="truncate">{f.nome}</span>
              {f.cargo && <span className="ml-auto truncate text-[11px] text-muted-foreground">{f.cargo}</span>}
            </Item>
          ))}
          {q.trim() && (
            <>
              <li className="my-1 border-t" />
              <Item on={false} onClick={() => escolher({ fornecedor_id: null, funcionario_id: null, favorecido: q.trim() })}>
                Usar “{q.trim()}” sem cadastro
              </Item>
              {onNovoFornecedor && (
                <Item
                  on={false}
                  onClick={() => {
                    setAberto(false);
                    onNovoFornecedor(q.trim());
                    setQ("");
                  }}
                >
                  <span className="font-medium text-info-ink">+ Novo fornecedor “{q.trim()}”</span>
                </Item>
              )}
            </>
          )}
          {!forn.length && !func.length && !q.trim() && <li className="p-3 text-center text-sm text-muted-foreground">Nenhum fornecedor ou profissional.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- contas
/** Multisseleção de contas bancárias (vazio = todas). */
export function ContasMulti({ valor, onChange, id }: { valor: number[]; onChange: (v: number[]) => void; id?: string }) {
  const contas = useContasBancarias();
  const lista = contas.data ?? [];
  const [aberto, setAberto] = useState(false);
  const resumo = valor.length === 0 ? "Todas as contas" : valor.length === 1 ? (lista.find((c) => c.id === valor[0])?.nome ?? "1 conta") : `${valor.length} contas`;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
              valor.length > 0 && "border-brand/50 bg-brand/5",
            )}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{resumo}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-0 p-1">
        <ul role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto">
          {lista.map((c) => {
            const on = valor.includes(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => onChange(on ? valor.filter((x) => x !== c.id) : [...valor, c.id])}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", !c.ativo && "opacity-60")}
                >
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30")}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.cor }} />
                  <span className="truncate">{c.nome}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {valor.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
            Limpar (todas as contas)
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Select simples de conta bancária ativa. */
export function ContaSelect({ value, onChange, id, vazio = "Escolha a conta…" }: { value: number | null; onChange: (v: number | null) => void; id?: string; vazio?: string }) {
  const contas = useContasBancarias();
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{vazio}</option>
      {contas.data
        ?.filter((c) => c.ativo || c.id === value)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.banco ? ` · ${c.banco}` : ""}
          </option>
        ))}
    </NativeSelect>
  );
}
