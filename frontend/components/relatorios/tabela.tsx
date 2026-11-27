"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Pagination } from "@/components/mayacorp/data-table";
import {
  ehNumerica,
  formatar,
  type Ordem,
  type Resultado,
} from "@/lib/relatorios";
import { cn } from "@/lib/utils";

const POR_PAGINA = 50;

/** Tabela do relatório: ordena clicando no cabeçalho (o servidor ordena tudo), totais no rodapé. */
export function TabelaRelatorio({
  r,
  ordenar,
  onOrdenar,
}: {
  r: Resultado;
  ordenar: Ordem[];
  onOrdenar: (o: Ordem[]) => void;
}) {
  const [pagina, setPagina] = useState(1);
  const total = r.linhas.length;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pg = Math.min(pagina, paginas);
  const linhas = r.linhas.slice((pg - 1) * POR_PAGINA, pg * POR_PAGINA);
  const atual = ordenar[0];
  const clicar = (id: string) => {
    if (atual?.coluna !== id) onOrdenar([{ coluna: id, desc: false }]);
    else if (!atual.desc) onOrdenar([{ coluna: id, desc: true }]);
    else onOrdenar([]);
    setPagina(1);
  };
  const temTotal = r.colunas.some((c) => ehNumerica(c.tipo) && r.totais[c.id]);

  return (
    <div>
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 border-b bg-muted text-left text-xs text-muted-foreground">
            <tr>
              {r.colunas.map((c) => {
                const num = ehNumerica(c.tipo);
                const ativa = atual?.coluna === c.id;
                const Ic = ativa
                  ? atual.desc
                    ? ArrowDown
                    : ArrowUp
                  : ChevronsUpDown;
                return (
                  <th
                    key={c.id}
                    className={cn(
                      "px-3 py-2.5 font-medium whitespace-nowrap",
                      num && "text-right",
                    )}
                    aria-sort={
                      ativa
                        ? atual.desc
                          ? "descending"
                          : "ascending"
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => clicar(c.id)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-foreground",
                        ativa && "text-foreground",
                        num && "flex-row-reverse",
                      )}
                    >
                      {c.rotulo}
                      <Ic className={cn("size-3", !ativa && "opacity-40")} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y">
            {linhas.map((l, i) => (
              <tr
                key={(pg - 1) * POR_PAGINA + i}
                className="hover:bg-accent/30"
              >
                {r.colunas.map((c, j) => {
                  const v = l[j];
                  const num = ehNumerica(c.tipo);
                  const texto = formatar(v, c.tipo);
                  return (
                    <td
                      key={c.id}
                      title={
                        c.tipo === "longo" ||
                        (typeof v === "string" && v.length > 40)
                          ? String(v ?? "")
                          : undefined
                      }
                      className={cn(
                        "px-3 py-2 align-top",
                        num &&
                          "text-right font-mono whitespace-nowrap tabular-nums",
                        c.tipo === "data" &&
                          "font-mono text-xs whitespace-nowrap",
                        c.tipo === "longo" ? "max-w-md min-w-60" : "max-w-72",
                        v === null && "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "block",
                          c.tipo === "longo"
                            ? "line-clamp-3 whitespace-pre-line"
                            : "truncate",
                        )}
                      >
                        {texto}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {temTotal && (
            <tfoot className="sticky bottom-0 border-t-2 bg-card font-semibold">
              <tr>
                {r.colunas.map((c, j) => {
                  const t = r.totais[c.id];
                  return (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 py-2.5",
                        ehNumerica(c.tipo) &&
                          "text-right font-mono whitespace-nowrap tabular-nums",
                      )}
                    >
                      {j === 0 && !t
                        ? "Total"
                        : t
                          ? formatar(t.soma, c.tipo)
                          : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {paginas > 1 && (
        <Pagination
          pagina={pg}
          porPagina={POR_PAGINA}
          total={total}
          onChange={setPagina}
        />
      )}
    </div>
  );
}
