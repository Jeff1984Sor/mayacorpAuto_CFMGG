"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronRight, FileSearch, FileText, KanbanSquare, Layers, Loader2, Receipt, Wallet, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { FiltroDocumento, type TipoDocumento } from "@/components/faturamento/filtro-documento";
import { useEmitirNfse } from "@/components/faturamento/emitir";
import { IaBadge } from "@/components/faturamento/ia-score";
import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { Mono } from "@/components/mayacorp/brand";
import { SearchInput, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ColunaFluxo, FluxoCard, FluxoOut } from "@/lib/faturamento";
import { data, moeda, numero } from "@/lib/format";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const menos = (dias: number) => iso(new Date(Date.now() - dias * 86_400_000));

type Filtro = ColunaFluxo | "todos";

const STATUS: { k: ColunaFluxo; l: string; icone: React.ComponentType<{ className?: string }>; tom: string; pill: "warning" | "brand" | "neutral" | "danger" | "success" }[] = [
  { k: "em_revisao", l: "Em revisão", icone: FileSearch, tom: "bg-warning/12 text-warning-ink", pill: "warning" },
  { k: "aguardando_nfse", l: "Aguardando NFS-e", icone: FileText, tom: "bg-brand/12 text-info-ink", pill: "brand" },
  { k: "a_receber", l: "A receber", icone: Wallet, tom: "bg-navy/10 text-foreground dark:bg-brand/15", pill: "neutral" },
  { k: "vencidas", l: "Vencidas", icone: AlertTriangle, tom: "bg-danger/10 text-danger-ink", pill: "danger" },
  { k: "pagas", l: "Pagas", icone: CheckCircle2, tom: "bg-success/10 text-success-ink", pill: "success" },
];
const ROTULO = Object.fromEntries(STATUS.map((s) => [s.k, s])) as Record<ColunaFluxo, (typeof STATUS)[number]>;

type Linha = FluxoCard & { status: ColunaFluxo };

function detalhe(l: Linha) {
  switch (l.status) {
    case "em_revisao":
      return (
        <span className="flex items-center gap-1.5">
          <IaBadge nota={l.nota_ia} />
          <span className={cn((l.dias ?? 0) >= 5 && "font-medium text-danger-ink")}>{l.dias ? `há ${l.dias} dia(s)` : "hoje"}</span>
        </span>
      );
    case "vencidas":
      return <span className="font-medium text-danger-ink">{l.dias} dia(s) em atraso</span>;
    case "pagas":
      return <>pago em {data(l.pago_em ?? l.data)}</>;
    default:
      return l.vencimento ? <>vence {data(l.vencimento)}</> : null;
  }
}

export default function FluxoPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEmitirNfse = pode("nfse_emissao.emitir");
  const [de, setDe] = useState(menos(90));
  const [ate, setAte] = useState(iso(new Date()));
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<TipoDocumento>("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const emitir = useEmitirNfse();
  const q = useQuery({
    queryKey: ["fat", "fluxo", de, ate, cliente[0]?.id ?? null, tipo],
    queryFn: () => api.get<FluxoOut>("/faturamento/fluxo", { de, ate, tomador_id: cliente[0]?.id, tipo: tipo || undefined }),
  });

  const todas: Linha[] = useMemo(
    () => (q.data ? STATUS.flatMap((s) => q.data.colunas[s.k].cards.map((c) => ({ ...c, status: s.k }))) : []),
    [q.data],
  );
  const linhas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return todas.filter(
      (l) =>
        (filtro === "todos" || l.status === filtro) &&
        (!t || [l.titulo, l.cliente, l.contrato, l.nfse_numero ? String(l.nfse_numero) : ""].some((x) => x?.toLowerCase().includes(t))),
    );
  }, [todas, filtro, busca]);
  const totalTodos = todas.reduce((s, l) => s + Number(l.valor), 0);

  const emitiveis = linhas.filter((l) => l.status === "aguardando_nfse");
  const selValidos = emitiveis.filter((l) => sel.has(l.id)).map((l) => l.id);
  const todosSel = emitiveis.length > 0 && selValidos.length === emitiveis.length;
  const marcar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const abrir = (l: Linha) => router.push(l.tipo === "revisao" ? `/faturamento/revisoes/${l.id}` : `/nfse/faturas/${l.id}`);

  const cards: { k: Filtro; l: string; icone: React.ComponentType<{ className?: string }>; tom: string; qtd?: number; total?: number }[] = [
    { k: "todos", l: "Todas", icone: Layers, tom: "bg-muted text-foreground", qtd: todas.length, total: totalTodos },
    ...STATUS.map((s) => ({ ...s, qtd: q.data?.colunas[s.k].qtd, total: q.data ? Number(q.data.colunas[s.k].total) : undefined })),
  ];

  return (
    <div>
      <PageHeader titulo="Fluxo de Faturamento" icone={KanbanSquare} migalhas={[{ label: "Faturamento" }, { label: "Fluxo" }]} />

      {/* status no topo = filtro */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" role="tablist" aria-label="Filtrar por status">
        {cards.map((c, i) => {
          const on = filtro === c.k;
          return (
            <motion.button
              key={c.k}
              type="button"
              role="tab"
              aria-selected={on}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={() => {
                setFiltro(c.k);
                setSel(new Set());
              }}
              className={cn("card-surface flex items-start gap-3 p-3.5 text-left transition-all hover:-translate-y-0.5", on && "ring-2 ring-brand")}
            >
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", c.tom)}>
                <c.icone className="size-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-muted-foreground">{c.l}</span>
                {c.total !== undefined ? (
                  <>
                    <AnimatedNumber value={c.total} format={(n) => moeda(n)} className="block truncate text-base font-semibold num" />
                    <span className="text-xs text-muted-foreground">
                      <span className="num">{numero(c.qtd ?? 0)}</span> item(ns)
                    </span>
                  </>
                ) : (
                  <Skeleton className="mt-1 h-5 w-20" />
                )}
              </span>
            </motion.button>
          );
        })}
      </div>

      <TableCard>
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Fatura, cliente, contrato ou NFS-e" className="sm:w-80" />
          <div className="flex flex-wrap items-center gap-2">
            <FiltroDocumento
              valor={tipo}
              onChange={(v) => {
                setTipo(v);
                setSel(new Set());
              }}
            />
            <div className="w-64">
              <ClientesMulti unico id="fluxo-cliente" valor={cliente} onChange={setCliente} />
            </div>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-9 w-38" aria-label="Emitidas de" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-9 w-38" aria-label="Emitidas até" />
          </div>
        </Toolbar>

        {q.isPending ? (
          <TableSkeleton colunas={7} />
        ) : linhas.length === 0 ? (
          <EmptyState
            icone={KanbanSquare}
            titulo={busca || filtro !== "todos" ? "Nada neste filtro" : "Nenhuma cobrança no período"}
            descricao={filtro === "em_revisao" || filtro === "todos" ? "Envie itens para revisão em Itens a faturar." : "Ajuste o período, o cliente ou o status."}
            acao={
              <Button size="sm" variant="outline" render={<Link href="/faturamento/itens" />}>
                Ver itens a faturar
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    {podeEmitirNfse && emitiveis.length > 0 && (
                      <Checkbox
                        checked={todosSel}
                        indeterminate={selValidos.length > 0 && !todosSel}
                        onCheckedChange={(v) => setSel(v ? new Set(emitiveis.map((l) => l.id)) : new Set())}
                        aria-label="Selecionar todas as que aguardam NFS-e"
                      />
                    )}
                  </th>
                  <th className="px-3 py-2.5 font-medium">Documento</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Data</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {linhas.map((l) => {
                  const st = ROTULO[l.status];
                  const podeEmitir = l.status === "aguardando_nfse" && podeEmitirNfse;
                  return (
                    <tr key={`${l.tipo}-${l.id}`} className={cn(linhaClicavel, sel.has(l.id) && podeEmitir && "bg-brand/5")} onClick={() => abrir(l)}>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {podeEmitir && <Checkbox checked={sel.has(l.id)} onCheckedChange={(v) => marcar(l.id, !!v)} aria-label={`Selecionar ${l.titulo}`} />}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Pill tom={l.documento === "ND" ? "info" : "brand"} className="mr-1.5">
                          {l.documento}
                        </Pill>
                        <Mono>{l.titulo}</Mono>
                        {l.nfse_numero && <p className="mt-0.5 text-[11px] text-muted-foreground num">NFS-e {l.nfse_numero}</p>}
                      </td>
                      <td className="max-w-72 px-3 py-3">
                        <p className="truncate">{l.cliente}</p>
                        {l.contrato && <p className="truncate text-[11px] text-muted-foreground">{l.contrato}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <Pill tom={st.pill}>{st.l}</Pill>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{detalhe(l)}</p>
                      </td>
                      <td className="hidden px-3 py-3 text-muted-foreground lg:table-cell">
                        <Mono>{data(l.data)}</Mono>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Mono>{moeda(l.valor)}</Mono>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {podeEmitir ? (
                          <Button size="xs" onClick={() => emitir.mutate([l.id])} disabled={emitir.isPending}>
                            {emitir.isPending ? <Loader2 className="animate-spin" /> : <Receipt />} Gerar NFS-e
                          </Button>
                        ) : (
                          <Button size="xs" variant="ghost" onClick={() => abrir(l)}>
                            {l.tipo === "revisao" ? "Revisar" : "Abrir"} <ChevronRight />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {linhas.length > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              <span className="num">{numero(linhas.length)}</span> item(ns) · revisões em aberto aparecem sempre, qualquer que seja o período
            </span>
            <span className="font-medium text-foreground num">{moeda(linhas.reduce((s, l) => s + Number(l.valor), 0))}</span>
          </div>
        )}
      </TableCard>

      <AnimatePresence>
        {selValidos.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 lg:pl-(--sb)"
          >
            <div className="flex items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
              <span className="text-sm">
                <strong className="num">{numero(selValidos.length)}</strong> fatura(s) para NFS-e
              </span>
              <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => emitir.mutate(selValidos)} disabled={emitir.isPending}>
                {emitir.isPending ? <Loader2 className="animate-spin" /> : <Receipt />} Gerar NFS-e ({selValidos.length})
              </Button>
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
