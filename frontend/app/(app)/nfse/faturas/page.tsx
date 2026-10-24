"use client";

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCircle2, CircleSlash, Download, Loader2, ReceiptText, Wallet, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { Mono } from "@/components/mayacorp/brand";
import { Pagination, SearchInput, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { useEmitirNfse } from "@/components/faturamento/emitir";
import { useZipFaturas } from "@/components/nfse/acoes-fatura";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePaginado } from "@/hooks/use-paginado";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, documento, moeda, numero } from "@/lib/format";
import type { FaturaOut, ResumoFaturas, SituacaoFatura } from "@/lib/types";
import { cn } from "@/lib/utils";

const CARDS: { s: SituacaoFatura; l: string; i: React.ComponentType<{ className?: string }>; tom: string }[] = [
  { s: "aberta", l: "Em aberto", i: Wallet, tom: "bg-brand/12 text-info-ink" },
  { s: "vencida", l: "Vencidas", i: AlarmClock, tom: "bg-danger/10 text-danger-ink" },
  { s: "paga", l: "Pagas", i: CheckCircle2, tom: "bg-success/10 text-success-ink" },
  { s: "cancelada", l: "Canceladas", i: CircleSlash, tom: "bg-muted text-muted-foreground" },
];

export default function FaturasPage() {
  const router = useRouter();
  const lista = usePaginado<FaturaOut>("faturas", "/nfse/faturas", {}, 25);
  const resumo = useQuery({ queryKey: ["faturas-resumo"], queryFn: () => api.get<ResumoFaturas>("/nfse/faturas/resumo") });
  const zip = useZipFaturas();
  const emitir = useEmitirNfse();
  const { isOperador } = useAuth();
  const tipo = (lista.filtros.tipo as string | undefined) ?? "";
  const [sel, setSel] = useState<Set<number>>(new Set());
  const situacao = (lista.filtros.situacao as SituacaoFatura | undefined) ?? null;
  const { setFiltro } = lista;

  // ?lote=ID / ?situacao= vindos do lote e do painel
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const l = u.get("lote");
    const sit = u.get("situacao");
    if (l) setFiltro("lote_id", Number(l));
    if (sit && ["aberta", "vencida", "paga", "cancelada"].includes(sit)) setFiltro("situacao", sit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leitura única da URL
  }, []);

  const marcar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const todos = lista.itens.length > 0 && lista.itens.every((f) => sel.has(f.id));
  const alguns = lista.itens.some((f) => sel.has(f.id));
  const filtrando = !!(lista.q || situacao || lista.filtros.de || lista.filtros.ate || lista.filtros.lote_id || tipo || lista.filtros.sem_nfse);
  const emitiveis = lista.itens.filter((f) => sel.has(f.id) && f.pode_emitir_nfse).map((f) => f.id);

  return (
    <div>
      <PageHeader
        titulo="Faturas"
        icone={ReceiptText}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Faturas" }]}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CARDS.map((c, i) => {
          const r = resumo.data?.[c.s];
          const on = situacao === c.s;
          return (
            <motion.button
              key={c.s}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => lista.setFiltro("situacao", on ? undefined : c.s)}
              className={cn(
                "card-surface flex items-start gap-3 p-4 text-left transition-all hover:-translate-y-0.5",
                on && "ring-2 ring-brand",
              )}
            >
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", c.tom)}>
                <c.i className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] text-muted-foreground">{c.l}</span>
                {r ? (
                  <>
                    <AnimatedNumber value={r.valor} format={(n) => moeda(n)} className="block truncate text-lg font-semibold num" />
                    <span className="text-xs text-muted-foreground">
                      <span className="num">{numero(r.qtd)}</span> fatura(s)
                    </span>
                  </>
                ) : (
                  <Skeleton className="mt-1 h-6 w-24" />
                )}
              </span>
            </motion.button>
          );
        })}
      </div>

      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Cliente, nº da fatura, NFS-e ou CPF/CNPJ" className="sm:w-96" />
          <div className="flex flex-wrap items-center gap-2">
            {lista.filtros.lote_id ? (
              <button
                type="button"
                onClick={() => lista.setFiltro("lote_id", undefined)}
                className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand/10 px-2.5 text-xs font-medium text-info-ink"
              >
                Lote #{String(lista.filtros.lote_id).padStart(4, "0")} <X className="size-3" />
              </button>
            ) : null}
            <NativeSelect aria-label="Tipo de fatura" value={tipo} onChange={(e) => lista.setFiltro("tipo", e.target.value || undefined)} className="h-9 w-40">
              <option value="">NH e ND</option>
              <option value="honorarios">Só NH (honorários)</option>
              <option value="despesas">Só ND (despesas)</option>
            </NativeSelect>
            <label className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs">
              <Checkbox checked={!!lista.filtros.sem_nfse} onCheckedChange={(v) => lista.setFiltro("sem_nfse", v ? true : undefined)} aria-label="Só sem NFS-e" /> Sem NFS-e
            </label>
            <Input type="date" value={String(lista.filtros.de ?? "")} onChange={(e) => lista.setFiltro("de", e.target.value)} className="h-9 w-38" aria-label="De" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={String(lista.filtros.ate ?? "")} onChange={(e) => lista.setFiltro("ate", e.target.value)} className="h-9 w-38" aria-label="Até" />
          </div>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={7} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={ReceiptText}
            titulo={filtrando ? "Nenhuma fatura encontrada" : "Nenhuma fatura ainda"}
            descricao={filtrando ? "Ajuste a busca ou os filtros." : "Cada NFS-e emitida ganha automaticamente sua Nota de Honorários."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox
                      checked={todos}
                      indeterminate={!todos && alguns}
                      onCheckedChange={(v) => lista.itens.forEach((f) => marcar(f.id, !!v))}
                      aria-label="Selecionar página"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Fatura</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">NFS-e</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Emissão</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((f) => (
                  <tr key={f.id} className={linhaClicavel} onClick={() => router.push(`/nfse/faturas/${f.id}`)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={sel.has(f.id)} onCheckedChange={(v) => marcar(f.id, !!v)} aria-label={`Selecionar ${f.codigo}`} />
                    </td>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">
                      <Pill tom={f.tipo === "despesas" ? "info" : "brand"} className="mr-1.5">
                        {f.tipo === "despesas" ? "ND" : "NH"}
                      </Pill>
                      <Mono>{f.codigo}</Mono>
                      {f.simulada && (
                        <Pill tom="warning" className="ml-1.5">
                          Simulação
                        </Pill>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell" onClick={(e) => f.pode_emitir_nfse && e.stopPropagation()}>
                      {f.nfse_numero ? (
                        <Mono>{f.nfse_numero}</Mono>
                      ) : f.pode_emitir_nfse && isOperador ? (
                        <Button size="xs" variant="outline" onClick={() => emitir.mutate([f.id])} disabled={emitir.isPending}>
                          <ReceiptText /> Emitir NFS-e
                        </Button>
                      ) : (
                        <span className="text-xs">{f.tipo === "despesas" ? "—" : "Sem NFS-e"}</span>
                      )}
                    </td>
                    <td className="max-w-60 px-3 py-3">
                      <p className="truncate">{f.tomador_nome}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        <span className="num">{documento(f.tomador_doc)}</span>
                        {f.contrato_nome && ` · ${f.contrato_nome}`}
                      </p>
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground lg:table-cell">
                      <Mono>{data(f.data_emissao)}</Mono>
                    </td>
                    <td className={cn("px-3 py-3", f.situacao === "vencida" ? "font-medium text-danger-ink" : "text-muted-foreground")}>
                      <Mono>{data(f.data_vencimento)}</Mono>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Mono>{moeda(f.total)}</Mono>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={f.situacao} />
                      {f.pago_em && <p className="mt-0.5 text-[11px] text-muted-foreground num">em {data(f.pago_em)}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />
      </TableCard>

      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 lg:pl-(--sb)"
          >
            <div className="flex items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
              <span className="text-sm">
                <strong className="num">{numero(sel.size)}</strong> selecionada(s)
              </span>
              <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => zip.mutate({ ids: [...sel] })} disabled={zip.isPending}>
                {zip.isPending ? <Loader2 className="animate-spin" /> : <Download />} Baixar PDFs (ZIP)
              </Button>
              {isOperador && emitiveis.length > 0 && (
                <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => emitir.mutate(emitiveis)} disabled={emitir.isPending}>
                  {emitir.isPending ? <Loader2 className="animate-spin" /> : <ReceiptText />} Emitir NFS-e ({emitiveis.length})
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setSel(new Set())} aria-label="Limpar seleção">
                <X />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
