"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { csv, normalizarBusca, ROTULO_SITUACAO, type Nota } from "@/lib/dashboard";
import { data, documento, moeda, numero } from "@/lib/format";
import { cn } from "@/lib/utils";

type Campo = "tipo" | "nf" | "fatura" | "cliente" | "emissao" | "vencimento" | "pagamento" | "valor" | "situacao" | "previsao";

const COLS: { k: Campo; l: string; num?: boolean; classe?: string }[] = [
  { k: "fatura", l: "Fatura" },
  { k: "nf", l: "NFS-e", classe: "hidden md:table-cell" },
  { k: "cliente", l: "Cliente" },
  { k: "emissao", l: "Emissão", classe: "hidden sm:table-cell" },
  { k: "vencimento", l: "Vencimento", classe: "hidden lg:table-cell" },
  { k: "pagamento", l: "Pagamento", classe: "hidden lg:table-cell" },
  { k: "valor", l: "Valor", num: true },
  { k: "situacao", l: "Situação" },
  { k: "previsao", l: "Previsão", classe: "hidden xl:table-cell" },
];

export function TabelaNotas({ notas, hoje }: { notas: Nota[]; hoje: string }) {
  const [q, setQ] = useState("");
  const [ordem, setOrdem] = useState<{ k: Campo; desc: boolean }>({ k: "emissao", desc: true });
  const [limite, setLimite] = useState(50);

  const lista = useMemo(() => {
    const t = normalizarBusca(q.trim());
    const f = t ? notas.filter((n) => n.busca.includes(t)) : notas;
    const s = [...f].sort((a, b) => {
      const va = a[ordem.k] ?? "";
      const vb = b[ordem.k] ?? "";
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return ordem.desc ? -r : r;
    });
    return s;
  }, [notas, q, ordem]);
  const total = lista.reduce((a, n) => a + n.valor, 0);

  const exportar = () => {
    const linhas: (string | number | null)[][] = [
      ["Tipo", "Fatura", "NFS-e", "Situação da NFS-e", "Origem", "Contrato", "Cliente", "CPF/CNPJ", "Emissora", "Serviço", "Lote", "Emissão", "Vencimento", "Pagamento", "Valor", "ISS", "Recebido", "Situação", "Previsão de pagamento"],
      ...lista.map((n) => [
        n.tipo,
        n.fatura,
        n.nf,
        n.nfse,
        n.origem,
        n.contrato,
        n.cliente,
        n.doc,
        n.emissora,
        n.servico,
        n.loteRotulo,
        n.emissao,
        n.vencimento,
        n.pagamento,
        n.valor,
        n.iss,
        n.recebido,
        ROTULO_SITUACAO[n.situacao],
        n.previsao,
      ]),
    ];
    const blob = new Blob([csv(linhas)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faturamento-${hoje}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const ordenar = (k: Campo) => setOrdem((o) => (o.k === k ? { k, desc: !o.desc } : { k, desc: k === "valor" || k === "emissao" }));

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">Documentos do filtro</h3>
          <p className="text-xs text-muted-foreground">
            <span className="num">{numero(lista.length)}</span> documento(s) · <span className="num">{moeda(total)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimite(50);
              }}
              placeholder="Fatura, NFS-e, cliente, contrato, CNPJ…"
              className="h-9 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
            />
          </div>
          <Button variant="outline" className="h-9" onClick={exportar} disabled={!lista.length}>
            <Download /> CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {COLS.map((c) => {
                const on = ordem.k === c.k;
                const I = on ? (ordem.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                return (
                  <th key={c.k} className={cn("px-3 py-2 font-medium", c.num && "text-right", c.classe)} aria-sort={on ? (ordem.desc ? "descending" : "ascending") : "none"}>
                    <button type="button" onClick={() => ordenar(c.k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}>
                      {c.l}
                      <I className={cn("size-3", !on && "opacity-40")} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y tabular-nums">
            {lista.slice(0, limite).map((n) => {
              const atrasada = !!n.previsao && n.previsao < hoje;
              return (
                <tr key={n.chave} className="transition-colors hover:bg-accent/40">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={cn("mr-1.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset", n.tipo === "ND" ? "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300" : "bg-brand/10 text-info-ink ring-brand/25")}>
                      {n.tipo}
                    </span>
                    {n.fatura_id ? (
                      <Link href={`/nfse/faturas/${n.fatura_id}`} className="font-mono text-xs font-semibold text-info-ink hover:underline">
                        {n.fatura}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">sem fatura</span>
                    )}
                    {n.contrato !== "—" && <p className="max-w-44 truncate text-[11px] text-muted-foreground">{n.contrato}</p>}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    {n.nf != null && n.nfse_id ? (
                      <Link href={`/nfse/notas/${n.nfse_id}`} className={cn("font-mono font-semibold hover:underline", n.nfse === "Cancelada" ? "text-muted-foreground line-through" : "text-info-ink")}>
                        {n.nf}
                      </Link>
                    ) : (
                      <span className={cn("text-xs", n.nfse === "Aguardando NFS-e" ? "text-warning-ink" : "text-muted-foreground")}>{n.nfse === "Não se aplica (reembolso)" ? "não se aplica" : n.nfse}</span>
                    )}
                  </td>
                  <td className="max-w-56 px-3 py-2">
                    <p className="truncate">{n.cliente}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{documento(n.doc)}</p>
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-xs text-muted-foreground sm:table-cell">{data(n.emissao)}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs text-muted-foreground lg:table-cell">{data(n.vencimento)}</td>
                  <td className="hidden px-3 py-2 font-mono text-xs lg:table-cell">
                    {n.pagamento ? <span className="text-success-ink">{data(n.pagamento)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{moeda(n.valor)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={n.situacao} />
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-xs xl:table-cell">
                    {n.previsao && n.prazoBase ? (
                      <Tooltip>
                        <TooltipTrigger render={<span className={cn("cursor-help", atrasada ? "font-semibold text-danger-ink" : "text-muted-foreground")} />}>
                          {data(n.previsao)}
                          {atrasada && " ⚠"}
                        </TooltipTrigger>
                        <TooltipContent>
                          {n.prazoBase.doCliente ? `${n.cliente} costuma pagar em ${n.prazoBase.dias} dias` : `Prazo médio geral: ${n.prazoBase.dias} dias`}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {lista.length > limite && (
        <div className="border-t p-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setLimite((l) => l + 100)}>
            Mostrar mais ({numero(lista.length - limite)} restantes)
          </Button>
        </div>
      )}
    </section>
  );
}
