"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, Search, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import type { OpcoesPessoa, PessoaResumo } from "@/lib/pessoas";
import { cn } from "@/lib/utils";

export function useOpcoesPessoa(enabled = true) {
  return useQuery({
    queryKey: ["pessoas", "opcoes"],
    queryFn: () => api.get<OpcoesPessoa>("/pessoas/opcoes"),
    staleTime: 10 * 60_000,
    enabled,
  });
}

/**
 * A pessoa que é cliente do escritório aparece sempre com o código do cliente ("Cliente #123").
 * O cliente é uma parte: está no cadastro único uma vez só e é reconhecido por este selo.
 */
export function SeloCliente({ clienteId, className }: { clienteId: number | null | undefined; className?: string }) {
  if (!clienteId) return null;
  return (
    <span
      title={`Cliente do escritório, código ${clienteId}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-success/10 px-1.5 text-[11px] font-semibold whitespace-nowrap text-success-ink ring-1 ring-success/25 ring-inset",
        className,
      )}
    >
      <BadgeCheck className="size-3" />
      Cliente <span className="font-mono">#{clienteId}</span>
    </span>
  );
}

/** Linha de uma pessoa nas buscas: nome, selo de cliente, documento, OAB e cidade. */
export function LinhaPessoa({ p, className }: { p: PessoaResumo; className?: string }) {
  const detalhe = [p.documento_formatado, ...p.oabs, p.cidade && p.uf ? `${p.cidade}/${p.uf}` : p.cidade || p.uf].filter(Boolean);
  return (
    <span className={cn("min-w-0 flex-1", className)}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{p.nome}</span>
        <SeloCliente clienteId={p.cliente_id} />
        {!p.ativo && <span className="shrink-0 text-[11px] text-muted-foreground">(inativa)</span>}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {detalhe.length ? <span className="font-mono">{detalhe.join(" · ")}</span> : p.tipo_pessoa_nome}
      </span>
    </span>
  );
}

/** Busca única no cadastro de pessoas: nome ou CPF/CNPJ (com ou sem máscara). */
export function useBuscaPessoas(q: string, enabled = true) {
  const termo = useDebounce(q.trim(), 250);
  return useQuery({
    queryKey: ["pessoas", "buscar", termo],
    queryFn: () => api.get<PessoaResumo[]>("/pessoas/buscar", { q: termo, limite: 20 }),
    enabled: enabled && termo.length >= 2,
    staleTime: 10_000,
  });
}

/** Campo que escolhe UMA pessoa do cadastro único (solicitante, representante legal, sociedade de advogados). */
export function PessoaPicker({
  id,
  valor,
  nome,
  onChange,
  vazio = "Escolher pessoa…",
  onCadastrar,
}: {
  id?: string;
  valor: number | null;
  /** nome da pessoa escolhida (para mostrar sem buscar de novo) */
  nome: string | null | undefined;
  onChange: (p: PessoaResumo | null) => void;
  vazio?: string;
  /** mostra "Cadastrar nova pessoa" no fim da lista */
  onCadastrar?: (texto: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const busca = useBuscaPessoas(q, aberto);
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
        <span className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground")}>{valor ? (nome ?? `Pessoa nº ${valor}`) : vazio}</span>
        {valor && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
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
              placeholder="Nome ou CPF/CNPJ"
              aria-label="Buscar pessoa"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {q.trim().length < 2 && <li className="p-3 text-center text-sm text-muted-foreground">Digite pelo menos 2 letras ou o documento.</li>}
          {q.trim().length >= 2 && busca.data?.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Ninguém encontrado.</li>}
          {q.trim().length >= 2 &&
            busca.data?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p.id === valor}
                  onClick={() => {
                    onChange(p);
                    setAberto(false);
                    setQ("");
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <LinhaPessoa p={p} />
                </button>
              </li>
            ))}
        </ul>
        {onCadastrar && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => {
                setAberto(false);
                onCadastrar(q.trim());
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-info-ink hover:bg-muted"
            >
              <UserPlus className="size-4" /> Cadastrar nova pessoa
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
