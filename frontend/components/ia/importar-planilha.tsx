"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Prévia da planilha anexada ao assistente: o que vai ser cadastrado, coluna por campo, linhas ok e com problema. */
interface Previa {
  alvo: string;
  alvo_rotulo: string;
  dica: string;
  observacao: string | null;
  colunas: string[];
  campos: { chave: string; rotulo: string; obrigatorio: boolean }[];
  mapeamento: Record<string, number>;
  total: number;
  validas: number;
  linhas: { linha: number; valores: Record<string, unknown>; erros: string[] }[];
  opcoes: { chave: string; rotulo: string }[];
}

interface Resultado {
  alvo_rotulo: string;
  criados: number;
  com_erro: number;
  exemplos: string[];
  erros: { linha: number; erro: string }[];
}

const valor = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));

export function ImportarPlanilha({
  arquivo,
  pedido,
  tela,
  onFim,
}: {
  arquivo: File;
  pedido: string;
  tela: string;
  onFim: (resumo: string | null) => void;
}) {
  const qc = useQueryClient();
  const [previa, setPrevia] = useState<Previa | null>(null);
  const corpo = (extra: Record<string, string>) => {
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return fd;
  };
  const ler = useMutation({
    mutationFn: (extra: Record<string, string>) => api.post<Previa>("/ia/assistente/planilha", corpo({ tela, pedido, ...extra })),
    onSuccess: setPrevia,
  });
  const importar = useMutation({
    mutationFn: () =>
      api.post<Resultado>("/ia/assistente/planilha/importar", corpo({ alvo: previa!.alvo, mapeamento: JSON.stringify(previa!.mapeamento) })),
    onSuccess: () => qc.invalidateQueries(),
  });
  /* eslint-disable react-hooks/exhaustive-deps -- lê a planilha uma vez, ao anexar */
  useEffect(() => {
    ler.mutate({});
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const trocarCampo = (campo: string, coluna: string) => {
    if (!previa) return;
    const mapa = { ...previa.mapeamento };
    if (coluna === "") delete mapa[campo];
    else mapa[campo] = Number(coluna);
    ler.mutate({ alvo: previa.alvo, mapeamento: JSON.stringify(mapa) });
  };
  const r = importar.data;

  return (
    <div className="rounded-xl border border-brand/30 bg-card p-3 text-left text-sm shadow-sm">
      <p className="flex items-center gap-2 font-medium">
        <FileSpreadsheet className="size-4 text-success" /> <span className="truncate">{arquivo.name}</span>
        {!r && (
          <button type="button" onClick={() => onFim(null)} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Cancelar">
            <X className="size-4" />
          </button>
        )}
      </p>

      {ler.isPending && !previa && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Lendo a planilha e entendendo as colunas…
        </p>
      )}
      {ler.isError && <p className="mt-2 text-xs text-danger-ink">{(ler.error as Error).message}</p>}

      {previa && !r && (
        <div className={cn("mt-2 space-y-3", ler.isPending && "opacity-60")}>
          <label className="block text-xs text-muted-foreground">
            Cadastrar como
            <select
              value={previa.alvo}
              onChange={(e) => ler.mutate({ alvo: e.target.value })}
              className="mt-1 block w-full rounded-lg border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              {previa.opcoes.map((o) => (
                <option key={o.chave} value={o.chave}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
          {(previa.observacao || previa.dica) && <p className="text-xs text-muted-foreground">{previa.observacao || previa.dica}</p>}

          <details className="rounded-lg border bg-muted/30 px-2.5 py-1.5" open={previa.validas === 0}>
            <summary className="cursor-pointer text-xs font-medium">Colunas → campos</summary>
            <div className="mt-2 space-y-1.5">
              {previa.campos.map((c) => (
                <div key={c.chave} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 truncate" title={c.rotulo}>
                    {c.rotulo}
                    {c.obrigatorio && <span className="text-danger-ink"> *</span>}
                  </span>
                  <select
                    value={previa.mapeamento[c.chave] ?? ""}
                    onChange={(e) => trocarCampo(c.chave, e.target.value)}
                    className="min-w-0 flex-1 rounded-md border bg-background px-1.5 py-1"
                    aria-label={`Coluna de ${c.rotulo}`}
                  >
                    <option value="">— não importar —</option>
                    {previa.colunas.map((col, i) => (
                      <option key={i} value={i}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </details>

          <p className="text-xs">
            <b className="text-success-ink">{previa.validas}</b> de {previa.total} linha(s) prontas
            {previa.total > previa.validas && (
              <>
                {" · "}
                <b className="text-danger-ink">{previa.total - previa.validas}</b> com problema (ficam de fora)
              </>
            )}
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {previa.linhas.slice(0, 30).map((l) => {
              const titulo = valor(Object.values(l.valores)[0]);
              return (
                <li key={l.linha} className="flex items-start gap-1.5">
                  {l.erros.length ? (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-ink" />
                  ) : (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                  )}
                  <span className="min-w-0">
                    <span className="text-muted-foreground">L{l.linha}</span> {titulo || "—"}
                    {l.erros.length > 0 && <span className="block text-warning-ink">{l.erros.join("; ")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button size="sm" className="w-full" disabled={!previa.validas || importar.isPending || ler.isPending} onClick={() => importar.mutate()}>
            {importar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Importar {previa.validas} {previa.alvo_rotulo.toLowerCase()}
          </Button>
          {importar.isError && <p className="text-xs text-danger-ink">{(importar.error as Error).message}</p>}
        </div>
      )}

      {r && (
        <div className="mt-2 space-y-2 text-xs">
          <p className="flex items-center gap-1.5 text-sm text-success-ink">
            <Check className="size-4" /> {r.criados} {r.alvo_rotulo.toLowerCase()} cadastrado(s)
          </p>
          {r.exemplos.length > 0 && <p className="text-muted-foreground">{r.exemplos.slice(0, 5).join(" · ")}{r.criados > 5 ? " …" : ""}</p>}
          {r.com_erro > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/6 p-2">
              <p className="font-medium text-warning-ink">{r.com_erro} linha(s) não entraram:</p>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {r.erros.map((e) => (
                  <li key={e.linha}>
                    L{e.linha}: {e.erro}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onFim(`Importei ${r.criados} ${r.alvo_rotulo.toLowerCase()} de ${arquivo.name}${r.com_erro ? ` (${r.com_erro} linha(s) com problema ficaram de fora)` : ""}.`)
            }
          >
            Concluir
          </Button>
        </div>
      )}
    </div>
  );
}
