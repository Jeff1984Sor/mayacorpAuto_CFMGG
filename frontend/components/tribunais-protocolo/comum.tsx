"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { data as fmtData } from "@/lib/format";
import { diasAte, type StatusProtocolo, textoPrazo, tomPrazo, useTabela } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const STATUS: Record<StatusProtocolo, [string, "success" | "warning" | "danger" | "info" | "neutral" | "brand", boolean?]> = {
  rascunho: ["Rascunho", "neutral"],
  aprovado: ["Aprovado", "info"],
  na_fila: ["Na fila", "brand", true],
  enviando: ["Enviando ao tribunal", "brand", true],
  protocolado: ["Protocolado", "success"],
  erro: ["Não protocolado", "danger"],
  verificar: ["Conferir no tribunal", "warning", true],
};

export const DICA_VERIFICAR = "Sem resposta do tribunal: confira antes de reenviar";

export function StatusProtocoloBadge({ status, className }: { status: StatusProtocolo; className?: string }) {
  const [l, t, p] = STATUS[status] ?? [status, "neutral"];
  return (
    <span title={status === "verificar" ? DICA_VERIFICAR : undefined}>
      <StatusBadge label={l} tom={t} pulse={p} className={cn(status === "verificar" && "ring-2 ring-warning/60", className)} />
    </span>
  );
}

export function SimuladoPill({ simulado }: { simulado: boolean | null | undefined }) {
  if (!simulado) return null;
  return (
    <Pill tom="warning" className="normal-case">
      Simulação
    </Pill>
  );
}

export function PrazoTexto({ prazo, className }: { prazo: string | null | undefined; className?: string }) {
  if (!prazo) return <span className="text-muted-foreground">—</span>;
  const d = diasAte(prazo);
  const t = tomPrazo(d);
  return (
    <span className={cn("inline-flex flex-col leading-tight", className)}>
      <span className="num">{fmtData(prazo)}</span>
      <span
        className={cn(
          "text-[11px]",
          t === "danger" && "font-semibold text-danger-ink",
          t === "warning" && "font-medium text-warning-ink",
          t === "info" && "text-muted-foreground",
        )}
      >
        {textoPrazo(d)}
      </span>
    </span>
  );
}

/** Hash curto em fonte mono, com o completo no title. */
export function HashCurto({ hash, tamanho = 12 }: { hash: string | null | undefined; tamanho?: number }) {
  if (!hash) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-mono text-[11px] text-muted-foreground" title={hash}>
      {hash.slice(0, tamanho)}…
    </span>
  );
}

/**
 * Campo "código + nome" com busca na tabela local do tribunal (classe, assunto, localidade, tipo de petição…).
 * Sem tabela sincronizada, o usuário digita o código e o nome à mão.
 */
export function BuscaTabela({
  tabela,
  tribunal,
  codigo,
  nome,
  onChange,
  placeholder = "Digite para buscar",
  semNome,
  disabled,
}: {
  tabela: string;
  tribunal: string | null | undefined;
  codigo: string | null;
  nome: string | null;
  onChange: (codigo: string | null, nome: string | null) => void;
  placeholder?: string;
  /** Só o código (ex.: competência, órgão julgador): o nome é só para achar. */
  semNome?: boolean;
  disabled?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const busca = useDebounce(texto, 300);
  const q = useTabela(tabela, tribunal, busca, aberto && busca.trim().length >= 2);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);
  const itens = q.data ?? [];
  return (
    <div ref={caixa} className="relative">
      <div className="flex gap-2">
        <Input
          value={codigo ?? ""}
          onChange={(e) => onChange(e.target.value || null, nome)}
          placeholder="Código"
          className="w-28 shrink-0 font-mono"
          disabled={disabled}
          aria-label="Código"
        />
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={aberto ? texto : semNome ? texto : (nome ?? "")}
            onFocus={() => {
              setAberto(true);
              setTexto(semNome ? texto : (nome ?? ""));
            }}
            onChange={(e) => {
              setTexto(e.target.value);
              setAberto(true);
              if (!semNome) onChange(codigo, e.target.value || null);
            }}
            placeholder={placeholder}
            className="pr-7 pl-8"
            disabled={disabled}
          />
          {(codigo || nome) && !disabled && (
            <button
              type="button"
              onClick={() => {
                onChange(null, null);
                setTexto("");
              }}
              className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
              aria-label="Limpar"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {aberto && busca.trim().length >= 2 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {q.isFetching && itens.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Buscando…</p>
          ) : itens.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Nada na tabela do tribunal. Se ela ainda não foi sincronizada, informe o código à mão.
            </p>
          ) : (
            itens.map((i) => (
              <button
                key={i.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange(i.codigo_local, i.nome);
                  setTexto(semNome ? i.nome : "");
                  setAberto(false);
                }}
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{i.codigo_local}</span>
                <span className="min-w-0 flex-1">{i.nome}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
