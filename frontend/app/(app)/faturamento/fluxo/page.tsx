"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, FileSearch, FileText, KanbanSquare, Loader2, Receipt, Wallet } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { useEmitirNfse } from "@/components/faturamento/emitir";
import { IaBadge } from "@/components/faturamento/ia-score";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ColunaFluxo, FluxoCard, FluxoOut } from "@/lib/faturamento";
import { data, moeda, moedaCompacta } from "@/lib/format";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const menos = (dias: number) => iso(new Date(Date.now() - dias * 86_400_000));

const COLUNAS: { k: ColunaFluxo; l: string; icone: React.ComponentType<{ className?: string }>; cor: string; barra: string }[] = [
  { k: "em_revisao", l: "Em revisão", icone: FileSearch, cor: "text-warning-ink", barra: "bg-warning" },
  { k: "aguardando_nfse", l: "Aguardando NFS-e", icone: FileText, cor: "text-info-ink", barra: "bg-brand" },
  { k: "a_receber", l: "A receber", icone: Wallet, cor: "text-foreground", barra: "bg-navy dark:bg-brand/70" },
  { k: "vencidas", l: "Vencidas", icone: AlertTriangle, cor: "text-danger-ink", barra: "bg-danger" },
  { k: "pagas", l: "Pagas", icone: CheckCircle2, cor: "text-success-ink", barra: "bg-success" },
];

function Cartao({ c, coluna, sel, onSel }: { c: FluxoCard; coluna: ColunaFluxo; sel?: boolean; onSel?: (v: boolean) => void }) {
  const href = c.tipo === "revisao" ? `/faturamento/revisoes/${c.id}` : `/nfse/faturas/${c.id}`;
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <div
        className={cn(
          "group relative rounded-xl border bg-card p-3 shadow-xs transition hover:-translate-y-0.5 hover:shadow-md",
          coluna === "vencidas" && "border-danger/30",
          sel && "border-brand ring-2 ring-brand/30",
        )}
      >
        {onSel && (
          <div className="absolute top-3 right-3 z-10">
            <Checkbox checked={!!sel} onCheckedChange={(v) => onSel(!!v)} aria-label={`Selecionar ${c.titulo} para emitir`} />
          </div>
        )}
        <Link href={href} className="block focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring">
          <div className="flex items-center gap-1.5 pr-6">
            <Pill tom={c.documento === "ND" ? "info" : "brand"}>{c.documento}</Pill>
            <span className="truncate font-mono text-xs font-semibold">{c.titulo}</span>
          </div>
          <p className="mt-1.5 truncate text-sm font-medium" title={c.cliente}>
            {c.cliente}
          </p>
          {c.contrato && <p className="truncate text-xs text-muted-foreground">{c.contrato}</p>}
        </Link>
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="font-mono text-sm font-semibold tabular-nums">{moeda(c.valor)}</span>
          <span className="text-right text-[11px] text-muted-foreground">
            {coluna === "em_revisao" && (
              <span className="flex items-center gap-1.5">
                <IaBadge nota={c.nota_ia} />
                <span className={cn((c.dias ?? 0) >= 5 && "font-medium text-danger-ink")}>{c.dias ? `${c.dias}d` : "hoje"}</span>
              </span>
            )}
            {coluna === "vencidas" && <span className="font-semibold text-danger-ink">{c.dias} dia(s) em atraso</span>}
            {coluna === "a_receber" && c.vencimento && <>vence {data(c.vencimento)}</>}
            {coluna === "aguardando_nfse" && <>emitida {data(c.data)}</>}
            {coluna === "pagas" && <>pago {data(c.pago_em ?? c.data)}</>}
          </span>
        </div>
        {c.nfse_numero && <p className="mt-1 text-[11px] text-muted-foreground">NFS-e {c.nfse_numero}</p>}
      </div>
    </motion.li>
  );
}

export default function FluxoPage() {
  const { isOperador } = useAuth();
  const [de, setDe] = useState(menos(90));
  const [ate, setAte] = useState(iso(new Date()));
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const emitir = useEmitirNfse();
  const q = useQuery({
    queryKey: ["fat", "fluxo", de, ate, cliente[0]?.id ?? null],
    queryFn: () => api.get<FluxoOut>("/faturamento/fluxo", { de, ate, tomador_id: cliente[0]?.id }),
  });
  const aguardando = q.data?.colunas.aguardando_nfse.cards ?? [];
  const selValidos = [...sel].filter((id) => aguardando.some((c) => c.id === id));
  const alternar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div>
      <PageHeader
        titulo="Fluxo de Faturamento"
        descricao="Do item revisado ao dinheiro na conta: veja onde cada cobrança está."
        icone={KanbanSquare}
        migalhas={[{ label: "Faturamento" }, { label: "Fluxo" }]}
      />
      <div className="card-surface mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[150px_150px_minmax(0,320px)_1fr] lg:items-end">
        <Field label="Faturas emitidas de" htmlFor="fluxo-de">
          <Input id="fluxo-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="até" htmlFor="fluxo-ate">
          <Input id="fluxo-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
        </Field>
        <Field label="Cliente" htmlFor="fluxo-cliente">
          <ClientesMulti unico id="fluxo-cliente" valor={cliente} onChange={setCliente} />
        </Field>
        <p className="text-xs text-muted-foreground lg:text-right">Revisões em aberto aparecem sempre, qualquer que seja o período.</p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="grid min-w-[1060px] grid-cols-5 gap-3">
          {COLUNAS.map((col) => {
            const dados = q.data?.colunas[col.k];
            const I = col.icone;
            const todosSel = col.k === "aguardando_nfse" && aguardando.length > 0 && selValidos.length === aguardando.length;
            return (
              <section key={col.k} aria-labelledby={`col-${col.k}`} className={cn("flex min-h-[60dvh] flex-col rounded-2xl bg-muted/50 ring-1 ring-border", col.k === "vencidas" && "bg-danger/4")}>
                <header className="relative overflow-hidden rounded-t-2xl px-3 pt-3 pb-2.5">
                  <span className={cn("absolute inset-x-0 top-0 h-1", col.barra)} />
                  <div className="flex items-center gap-2">
                    <I className={cn("size-4", col.cor)} />
                    <h2 id={`col-${col.k}`} className="text-sm font-semibold">
                      {col.l}
                    </h2>
                    <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">{dados?.qtd ?? "–"}</span>
                  </div>
                  <p className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", col.cor)}>{dados ? moedaCompacta(dados.total) : "—"}</p>
                  {col.k === "aguardando_nfse" && isOperador && aguardando.length > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Checkbox
                          checked={todosSel}
                          indeterminate={selValidos.length > 0 && !todosSel}
                          onCheckedChange={(v) => setSel(v ? new Set(aguardando.map((c) => c.id)) : new Set())}
                          aria-label="Selecionar todas para emitir"
                        />
                        Todas
                      </label>
                      <Button size="xs" className="ml-auto" disabled={!selValidos.length || emitir.isPending} onClick={() => emitir.mutate(selValidos)}>
                        {emitir.isPending ? <Loader2 className="animate-spin" /> : <Receipt />}
                        Emitir NFS-e{selValidos.length > 0 && ` (${selValidos.length})`}
                      </Button>
                    </div>
                  )}
                </header>
                <ul className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                  {q.isPending ? (
                    [0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)
                  ) : !dados?.cards.length ? (
                    <li className="grid h-32 place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
                      {col.k === "em_revisao" ? (
                        <span>
                          Nada em revisão.
                          <br />
                          <Link href="/faturamento/itens" className="font-medium text-info-ink hover:underline">
                            Ver itens a faturar
                          </Link>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" /> Vazio no período
                        </span>
                      )}
                    </li>
                  ) : (
                    dados.cards.map((c) => (
                      <Cartao
                        key={`${c.tipo}-${c.id}`}
                        c={c}
                        coluna={col.k}
                        sel={col.k === "aguardando_nfse" ? sel.has(c.id) : undefined}
                        onSel={col.k === "aguardando_nfse" && isOperador ? (v) => alternar(c.id, v) : undefined}
                      />
                    ))
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
