"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFieldId } from "@/components/ui/field-id";
import { api } from "@/lib/api";
import type { TipoCaso } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

export const JUDICIAIS: TipoCaso[] = ["judicial_estadual", "judicial_federal", "judicial_trabalhista"];
export const ehJudicial = (t: TipoCaso | null | undefined) => !!t && JUDICIAIS.includes(t);

export const ROTULO_INSTANCIA: Record<string, string> = {
  primeira: "1ª instância",
  juizado: "Juizado Especial",
  segunda: "2ª instância (Tribunal)",
  turma_recursal: "Turma Recursal",
  superior: "Tribunal Superior",
  stf: "STF",
};

interface Tribunal {
  sigla: string;
  nome: string;
  ufs: string[];
}

export function useInstancias(enabled = true) {
  return useQuery({
    queryKey: ["fat", "judiciario", "instancias"],
    queryFn: () => api.get<{ valor: string; rotulo: string }[]>("/faturamento/judiciario/instancias"),
    enabled,
    staleTime: Infinity,
  });
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Opcao {
  valor: string;
  rotulo: string;
  sub?: string;
}

/** Combobox com busca; `livre` aceita texto digitado que não está na lista. */
function Combo({
  value,
  onChange,
  opcoes,
  placeholder,
  livre,
  disabled,
  carregando,
  id,
  exibir,
  vazio = "Nada encontrado",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  opcoes: Opcao[];
  placeholder: string;
  livre?: boolean;
  disabled?: boolean;
  carregando?: boolean;
  id?: string;
  exibir?: (v: string) => string;
  vazio?: string;
}) {
  const fieldId = useFieldId();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = sem(q.trim());
  const filtradas = useMemo(
    () => (termo ? opcoes.filter((o) => sem(`${o.valor} ${o.rotulo} ${o.sub ?? ""}`).includes(termo)) : opcoes).slice(0, 200),
    [opcoes, termo],
  );
  const escolher = (v: string | null) => {
    onChange(v);
    setAberto(false);
    setQ("");
  };
  const exato = filtradas.some((o) => sem(o.valor) === termo || sem(o.rotulo) === termo);
  return (
    <Popover open={aberto} onOpenChange={(o) => !disabled && setAberto(o)}>
      <PopoverTrigger
        render={
          <button
            id={id ?? fieldId}
            type="button"
            disabled={disabled}
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted-foreground")}>{value ? (exibir ? exibir(value) : value) : placeholder}</span>
        {carregando ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtradas.length === 1) escolher(filtradas[0].valor);
                  else if (livre && q.trim()) escolher(q.trim());
                }
              }}
              placeholder={livre ? "Buscar ou digitar" : "Buscar"}
              aria-label={`Buscar ${placeholder.toLowerCase()}`}
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          {livre && q.trim() && !exato && (
            <li>
              <button type="button" role="option" aria-selected={false} onClick={() => escolher(q.trim())} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className="text-info-ink">Usar “{q.trim()}”</span>
              </button>
            </li>
          )}
          {value && (
            <li>
              <button type="button" onClick={() => escolher(null)} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
                Limpar
              </button>
            </li>
          )}
          {filtradas.map((o) => (
            <li key={o.valor}>
              <button type="button" role="option" aria-selected={value === o.valor} onClick={() => escolher(o.valor)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                <Check className={cn("size-3.5 shrink-0", value === o.valor ? "text-info-ink" : "invisible")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.rotulo}</span>
                  {o.sub && <span className="block truncate text-[11px] text-muted-foreground">{o.sub}</span>}
                </span>
              </button>
            </li>
          ))}
          {!filtradas.length && !(livre && q.trim()) && <li className="p-3 text-center text-sm text-muted-foreground">{carregando ? "Carregando…" : vazio}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function TribunalCombo({ value, onChange, tipo, instancia, id }: { value: string | null; onChange: (v: string | null) => void; tipo: TipoCaso | null; instancia: string | null; id?: string }) {
  const q = useQuery({
    queryKey: ["fat", "judiciario", "tribunais", tipo, instancia],
    queryFn: () => api.get<Tribunal[]>("/faturamento/judiciario/tribunais", { tipo: tipo ?? undefined, instancia: instancia ?? undefined }),
    staleTime: Infinity,
  });
  const lista = q.data ?? [];
  const opcoes = lista.map((t) => ({ valor: t.sigla, rotulo: `${t.sigla} · ${t.nome}`, sub: t.ufs.length ? t.ufs.join(", ") : undefined }));
  const t = lista.find((x) => x.sigla === value);
  return (
    <Combo
      id={id}
      value={value}
      onChange={onChange}
      opcoes={opcoes}
      livre
      carregando={q.isPending}
      placeholder="Escolha o tribunal"
      exibir={(v) => (t ? `${t.sigla} · ${t.nome}${t.ufs.length === 1 ? ` · ${t.ufs[0]}` : ""}` : v)}
    />
  );
}

export function ComarcaCombo({ value, onChange, tribunal, id }: { value: string | null; onChange: (v: string | null) => void; tribunal: string | null; id?: string }) {
  const q = useQuery({
    queryKey: ["fat", "judiciario", "comarcas", tribunal],
    queryFn: () => api.get<string[]>("/faturamento/judiciario/comarcas", { tribunal: tribunal! }),
    enabled: !!tribunal && tribunal.length >= 2,
    staleTime: Infinity,
    meta: { silencioso: true },
  });
  return (
    <Combo
      id={id}
      value={value}
      onChange={onChange}
      opcoes={(q.data ?? []).map((c) => ({ valor: c, rotulo: c }))}
      livre
      disabled={!tribunal}
      carregando={!!tribunal && q.isPending}
      placeholder={tribunal ? "Escolha a comarca" : "Escolha o tribunal antes"}
    />
  );
}

export function VaraCombo({ value, onChange, tribunal, comarca, tipo, id }: { value: string | null; onChange: (v: string | null) => void; tribunal: string | null; comarca: string | null; tipo: TipoCaso | null; id?: string }) {
  const q = useQuery({
    queryKey: ["fat", "judiciario", "varas", tribunal, comarca, tipo],
    queryFn: () => api.get<string[]>("/faturamento/judiciario/varas", { tribunal: tribunal ?? undefined, comarca: comarca ?? undefined, tipo: tipo ?? undefined }),
    staleTime: 60_000,
    meta: { silencioso: true },
  });
  return <Combo id={id} value={value} onChange={onChange} opcoes={(q.data ?? []).map((v) => ({ valor: v, rotulo: v }))} livre carregando={q.isPending} placeholder="Escolha ou digite a vara" vazio="Digite o nome da vara" />;
}
