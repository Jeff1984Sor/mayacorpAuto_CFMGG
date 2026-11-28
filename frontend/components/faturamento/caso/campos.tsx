"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Search, X } from "lucide-react";
import { useState } from "react";

import { NativeSelect } from "@/components/mayacorp/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import type { CodigoLista, ListaItemOut, Opcao, OpcoesCaso } from "@/lib/casos";
import type { CasoOut } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

/** Listas fixas do sistema (valor e rótulo) para os formulários do caso. */
export function useOpcoesCaso(enabled = true) {
  return useQuery({
    queryKey: ["fat", "casos-opcoes"],
    queryFn: () => api.get<OpcoesCaso>("/faturamento/casos/opcoes"),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/** Todas as listas que o escritório edita (Configurações › Faturamento › Listas). */
export function useListas(enabled = true) {
  return useQuery({
    queryKey: ["fat", "listas"],
    queryFn: () => api.get<ListaItemOut[]>("/faturamento/listas"),
    staleTime: 60_000,
    enabled,
  });
}

/** Itens ativos de uma lista (mais os que já estão escolhidos, mesmo desativados). */
export function itensDaLista(todos: ListaItemOut[] | undefined, lista: CodigoLista, escolhidos: (number | null | undefined)[] = []) {
  return (todos ?? []).filter((i) => i.lista === lista && (i.ativo || escolhidos.includes(i.id)));
}

/** Seção do formulário (mesmo desenho do formulário de caso). */
export function SecaoForm({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <fieldset className={cn("rounded-2xl border bg-card p-4", className)}>
      <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</legend>
      <div className="grid gap-4 sm:grid-cols-6">{children}</div>
    </fieldset>
  );
}

export function OpcaoSelect({
  id,
  opcoes,
  valor,
  onChange,
  vazio = "—",
  semVazio,
}: {
  id?: string;
  opcoes: Opcao[] | undefined;
  valor: string | null;
  onChange: (v: string | null) => void;
  vazio?: string;
  semVazio?: boolean;
}) {
  return (
    <NativeSelect id={id} value={valor ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {!semVazio && <option value="">{vazio}</option>}
      {(opcoes ?? []).map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </NativeSelect>
  );
}

export function ListaSelect({
  id,
  itens,
  valor,
  onChange,
  vazio = "—",
}: {
  id?: string;
  itens: ListaItemOut[];
  valor: number | null;
  onChange: (v: number | null) => void;
  vazio?: string;
}) {
  return (
    <NativeSelect id={id} value={valor ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{vazio}</option>
      {itens.map((i) => (
        <option key={i.id} value={i.id}>
          {i.nome}
          {!i.ativo ? " (desativado)" : ""}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Valor em reais (ou horas, com `prefixo=""`): na tela com vírgula. */
export function DinheiroInput({
  id,
  valor,
  onChange,
  prefixo = "R$",
}: {
  id?: string;
  valor: string | null | undefined;
  onChange: (v: string) => void;
  prefixo?: string;
}) {
  return (
    <div className="relative">
      {prefixo && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{prefixo}</span>}
      <Input
        id={id}
        inputMode="decimal"
        value={valor ?? ""}
        onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
        className={cn("text-right font-mono", prefixo && "pl-8")}
      />
    </div>
  );
}

/** Interruptor com rótulo, do tamanho de um campo. */
export function Marca({ rotulo, dica, valor, onChange, className }: { rotulo: string; dica?: string; valor: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm", className)}>
      <Switch checked={valor} onCheckedChange={onChange} aria-label={rotulo} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block font-medium">{rotulo}</span>
        {dica && <span className="block text-xs text-muted-foreground">{dica}</span>}
      </span>
    </label>
  );
}

/** Vários itens de uma lista: os escolhidos viram etiquetas; o seletor acrescenta. */
export function VariosItens({
  id,
  opcoes,
  valor,
  onChange,
  adicionar = "Adicionar…",
}: {
  id?: string;
  opcoes: { id: number; nome: string }[];
  valor: number[];
  onChange: (v: number[]) => void;
  adicionar?: string;
}) {
  const livres = opcoes.filter((o) => !valor.includes(o.id));
  const nome = (i: number) => opcoes.find((o) => o.id === i)?.nome ?? `nº ${i}`;
  return (
    <div className="space-y-1.5">
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {valor.map((i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-brand/12 py-0.5 pr-1 pl-2 text-xs">
              <span className="max-w-48 truncate">{nome(i)}</span>
              <button type="button" onClick={() => onChange(valor.filter((x) => x !== i))} aria-label={`Remover ${nome(i)}`} className="rounded-full p-0.5 hover:bg-foreground/10">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <NativeSelect
        id={id}
        value=""
        disabled={livres.length === 0}
        onChange={(e) => {
          if (e.target.value) onChange([...valor, Number(e.target.value)]);
        }}
      >
        <option value="">{livres.length === 0 ? (opcoes.length ? "Todos já escolhidos" : "Nenhum item cadastrado") : adicionar}</option>
        {livres.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Escolhe outro caso do escritório (caso vinculado, caso judicial que nasceu daqui). */
export function CasoPicker({
  id,
  valor,
  rotulo,
  onChange,
  exceto,
  vazio = "Nenhum",
}: {
  id?: string;
  valor: number | null;
  /** "#12 Título" do caso escolhido */
  rotulo: string | null | undefined;
  onChange: (casoId: number | null, rotulo: string | null) => void;
  exceto?: number | null;
  vazio?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = useDebounce(q.trim(), 250);
  const lista = useQuery({
    queryKey: ["fat", "casos", "picker", termo],
    queryFn: () => api.get<CasoOut[]>("/faturamento/casos", { q: termo || undefined }),
    enabled: aberto,
  });
  const itens = (lista.data ?? []).filter((c) => c.id !== exceto).slice(0, 40);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground")}>{valor ? (rotulo ?? `Caso nº ${valor}`) : vazio}</span>
        {valor && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null, null);
            }}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Título, nº do caso ou processo"
              aria-label="Buscar caso"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {lista.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Buscando…</li>}
          {!lista.isPending && itens.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Nenhum caso encontrado.</li>}
          {itens.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === valor}
                onClick={() => {
                  onChange(c.id, `#${c.numero} ${c.titulo}`);
                  setAberto(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="font-mono text-xs text-muted-foreground">#{c.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.titulo}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {c.tipo_caso_nome} · {c.tomador_nome}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
