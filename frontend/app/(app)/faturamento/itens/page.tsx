"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, ExternalLink, FileSearch, Filter, ListChecks, Loader2, ReceiptText, Send, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { abrirArquivo, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type Aba,
  type ClientePendente,
  type FaturarOut,
  type ItemPendente,
  type ItensAFaturarOut,
  type RevisaoResumo,
  ROTULO_TIPO_REGRA,
  rotuloTipoItem,
  type TipoRegra,
} from "@/lib/faturamento";
import { data, documento, moeda, numero, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const inicioMes = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};
const fimMes = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

type Filtros = { aba: Aba; de: string; ate: string; clientes: ClienteEscolhido[]; tipos: TipoRegra[] };

const COR_TIPO: Record<string, "brand" | "success" | "warning" | "neutral" | "info"> = {
  fixo: "brand",
  recorrente: "success",
  hora: "warning",
  despesa: "info",
};

function Tri({ itens, sel, onChange, rotulo }: { itens: ItemPendente[]; sel: Set<string>; onChange: (v: boolean) => void; rotulo: string }) {
  const validos = itens.filter((i) => !i.aviso);
  const n = validos.filter((i) => sel.has(i.chave)).length;
  return (
    <Checkbox
      checked={validos.length > 0 && n === validos.length}
      indeterminate={n > 0 && n < validos.length}
      disabled={validos.length === 0}
      onCheckedChange={(v) => onChange(!!v)}
      aria-label={rotulo}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Para onde ir para corrigir o aviso do item. */
function linkAviso(aviso: string, contratoId: number, casoId: number | null) {
  if (/tabela de pre[cç]o no contrato/i.test(aviso))
    return casoId ? { href: `/faturamento/casos/${casoId}`, rotulo: "Escolher no caso" } : { href: `/faturamento/contratos/${contratoId}`, rotulo: "Escolher no contrato" };
  if (/sem cargo/i.test(aviso)) return { href: "/configuracoes/faturamento", rotulo: "Ajustar cargo ou tabela" };
  return { href: `/faturamento/contratos/${contratoId}`, rotulo: "Abrir contrato" };
}

function LinhaItem({ i, sel, onToggle, contratoId }: { i: ItemPendente; sel: boolean; onToggle: (v: boolean) => void; contratoId: number }) {
  const aviso = !!i.aviso;
  return (
    <tr className={cn("text-sm transition-colors", aviso ? "bg-warning/6" : sel ? "bg-brand/[0.04]" : "hover:bg-accent/30")}>
      <td className="py-2 pr-2 pl-12">
        <Checkbox checked={sel} disabled={aviso} onCheckedChange={(v) => onToggle(!!v)} aria-label={`Selecionar ${i.descricao}`} />
      </td>
      <td className="px-2 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">{data(i.data)}</td>
      <td className="max-w-40 px-2 py-2 text-xs">
        {i.caso_numero ? (
          <Link href={`/faturamento/casos/${i.caso_id}`} className="hover:underline" title={i.caso_titulo ?? undefined}>
            <span className="font-mono">#{i.caso_numero}</span> <span className="text-muted-foreground">{i.caso_titulo}</span>
          </Link>
        ) : (
          <span className="text-muted-foreground">Contrato</span>
        )}
      </td>
      <td className="min-w-56 px-2 py-2">
        <div className="flex items-start gap-2">
          <Pill tom={COR_TIPO[i.tipo] ?? "neutral"}>{rotuloTipoItem(i.tipo)}</Pill>
          <span className="line-clamp-2">{i.descricao}</span>
        </div>
        {aviso && (
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning-ink">
            <AlertTriangle className="size-3.5 shrink-0" /> {i.aviso}
            {(() => {
              const l = linkAviso(i.aviso!, contratoId, i.caso_id);
              return (
                <Link href={l.href} className="ml-1 underline underline-offset-2 hover:no-underline">
                  {l.rotulo}
                </Link>
              );
            })()}
          </p>
        )}
      </td>
      <td className="px-2 py-2 text-xs whitespace-nowrap text-muted-foreground">{i.parcela ?? "—"}</td>
      <td className="hidden px-2 py-2 font-mono text-xs whitespace-nowrap lg:table-cell">
        {i.quantidade != null ? (
          <>
            {numero(toNum(i.quantidade))} h × {i.valor_unitario != null ? moeda(i.valor_unitario) : "?"}
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="hidden px-2 py-2 text-xs text-muted-foreground xl:table-cell">{i.profissional ?? "—"}</td>
      <td className="px-4 py-2 text-right font-mono font-medium whitespace-nowrap tabular-nums">{moeda(i.valor)}</td>
    </tr>
  );
}

function ResultadoDialog({
  aberto,
  onClose,
  faturas,
  revisoes,
}: {
  aberto: boolean;
  onClose: () => void;
  faturas: FaturarOut | null;
  revisoes: RevisaoResumo[] | null;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl brand-gradient text-white shadow-lg shadow-brand/30">
            {faturas ? <ReceiptText className="size-5" /> : <FileSearch className="size-5" />}
          </span>
          <div>
            <DialogTitle>{faturas ? `${faturas.faturas.length} fatura(s) criada(s)` : `${revisoes?.length ?? 0} revisão(ões) aberta(s)`}</DialogTitle>
            <DialogDescription>
              {faturas ? `Total ${moeda(faturas.total)}. NH segue para emissão da NFS-e; ND nunca tem nota.` : "Os itens ficam reservados até a revisão ser aprovada ou descartada."}
            </DialogDescription>
          </div>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
          {faturas?.faturas.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Pill tom={f.codigo.startsWith("ND") ? "info" : "brand"}>{f.codigo.slice(0, 2)}</Pill>
              <div className="min-w-0 flex-1">
                <Link href={`/nfse/faturas/${f.id}`} className="font-mono font-semibold hover:underline">
                  {f.codigo}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {f.tomador_nome}
                  {f.contrato_nome && ` · ${f.contrato_nome}`} · vence {data(f.data_vencimento)}
                </p>
              </div>
              <span className="font-mono text-sm tabular-nums">{moeda(f.valor)}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => abrirArquivo(`/nfse/faturas/${f.id}/pdf`)} aria-label={`Abrir PDF da ${f.codigo}`}>
                <ExternalLink />
              </Button>
            </li>
          ))}
          {revisoes?.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Pill tom={r.aba === "despesas" ? "info" : "brand"}>{r.aba === "despesas" ? "ND" : "NH"}</Pill>
              <div className="min-w-0 flex-1">
                <Link href={`/faturamento/revisoes/${r.id}`} className="font-semibold hover:underline">
                  Revisão #{r.numero}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {r.tomador_nome} · #{r.contrato_numero} {r.contrato_nome} · {r.qtd_itens} itens
                </p>
              </div>
              <span className="font-mono text-sm tabular-nums">{moeda(r.total)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          {revisoes && revisoes.length === 1 && (
            <Button render={<Link href={`/faturamento/revisoes/${revisoes[0].id}`} />}>Abrir a revisão</Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ItensAFaturarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { isOperador } = useAuth();
  const [rascunho, setRascunho] = useState<Filtros>({ aba: "honorarios", de: inicioMes(), ate: fimMes(), clientes: [], tipos: [] });
  const [aplicado, setAplicado] = useState<Filtros | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [confirmarDireto, setConfirmarDireto] = useState(false);
  const [resultado, setResultado] = useState<{ faturas: FaturarOut | null; revisoes: RevisaoResumo[] | null } | null>(null);

  const params = aplicado
    ? {
        aba: aplicado.aba,
        de: aplicado.de,
        ate: aplicado.ate,
        cliente_ids: aplicado.clientes.map((c) => c.id),
        tipos: aplicado.aba === "honorarios" ? aplicado.tipos : [],
      }
    : null;
  const q = useQuery({
    queryKey: ["fat", "itens", params],
    queryFn: () => api.get<ItensAFaturarOut>("/faturamento/itens-a-faturar", params!),
    enabled: !!params,
  });
  const clientes = useMemo(() => q.data?.clientes ?? [], [q.data]);
  const porChave = useMemo(() => {
    const m = new Map<string, ItemPendente>();
    clientes.forEach((c) => c.contratos.forEach((k) => k.itens.forEach((i) => m.set(i.chave, i))));
    return m;
  }, [clientes]);
  const selecionados = [...sel].filter((k) => porChave.has(k));
  const totalSel = selecionados.reduce((a, k) => a + toNum(porChave.get(k)!.valor), 0);

  const filtrar = (f: Filtros = rascunho) => {
    if (f.de > f.ate) return toast.error("A data inicial é depois da final.");
    setAplicado({ ...f });
    setSel(new Set());
    setAbertos(new Set());
  };
  const marcar = (itens: ItemPendente[], v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      itens.filter((i) => !i.aviso).forEach((i) => (v ? n.add(i.chave) : n.delete(i.chave)));
      return n;
    });
  const itensDo = (c: ClientePendente) => c.contratos.flatMap((k) => k.itens);
  const alternarAberto = (id: number) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const corpo = () => ({
    aba: aplicado!.aba,
    de: aplicado!.de,
    ate: aplicado!.ate,
    chaves: selecionados,
    cliente_ids: aplicado!.clientes.length ? aplicado!.clientes.map((c) => c.id) : null,
    tipos: aplicado!.aba === "honorarios" && aplicado!.tipos.length ? aplicado!.tipos : null,
  });
  const depois = () => {
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["fat"] });
    qc.invalidateQueries({ queryKey: ["faturas"] });
  };
  const revisar = useMutation({
    mutationFn: () => api.post<RevisaoResumo[]>("/faturamento/revisoes", corpo()),
    onSuccess: (r) => {
      depois();
      toast.success(`${r.length} revisão(ões) aberta(s)`, {
        action: r.length === 1 ? { label: "Abrir", onClick: () => router.push(`/faturamento/revisoes/${r[0].id}`) } : undefined,
      });
      setResultado({ faturas: null, revisoes: r });
    },
  });
  const faturar = useMutation({
    mutationFn: () => api.post<FaturarOut>("/faturamento/faturar", corpo()),
    onSuccess: (r) => {
      depois();
      setConfirmarDireto(false);
      toast.success(`${r.faturas.length} fatura(s) criada(s) · ${moeda(r.total)}`);
      setResultado({ faturas: r, revisoes: null });
    },
    onError: () => setConfirmarDireto(false),
  });

  const avisos = clientes.reduce((a, c) => a + itensDo(c).filter((i) => i.aviso).length, 0);
  const doc = aplicado?.aba === "despesas" ? "ND" : "NH";

  return (
    <div className="pb-24">
      <PageHeader
        titulo="Itens a faturar"
        icone={ListChecks}
        migalhas={[{ label: "Faturamento" }, { label: "Itens a faturar" }]}
      />

      {/* filtros */}
      <section className="card-surface mb-5 space-y-4 p-4">
        <div role="tablist" aria-label="Tipo de cobrança" className="inline-flex rounded-xl bg-muted p-1">
          {(["honorarios", "despesas"] as Aba[]).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={rascunho.aba === a}
              onClick={() => {
                const f = { ...rascunho, aba: a };
                setRascunho(f);
                if (aplicado) filtrar(f);
              }}
              className={cn("relative rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground transition", rascunho.aba === a && "text-foreground")}
            >
              {rascunho.aba === a && <motion.span layoutId="aba-itens" className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border" />}
              <span className="relative">
                {a === "honorarios" ? "Honorários" : "Despesas"} <span className="text-xs text-muted-foreground">({a === "honorarios" ? "NH" : "ND"})</span>
              </span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_minmax(0,1fr)_auto] lg:items-end">
          <Field label="De" htmlFor="itens-de">
            <Input id="itens-de" type="date" value={rascunho.de} onChange={(e) => setRascunho({ ...rascunho, de: e.target.value })} />
          </Field>
          <Field label="Até" htmlFor="itens-ate">
            <Input id="itens-ate" type="date" value={rascunho.ate} onChange={(e) => setRascunho({ ...rascunho, ate: e.target.value })} />
          </Field>
          <Field label="Clientes" htmlFor="itens-clientes">
            <ClientesMulti id="itens-clientes" valor={rascunho.clientes} onChange={(v) => setRascunho({ ...rascunho, clientes: v })} />
          </Field>
          <Button onClick={() => filtrar()} className="h-9 px-5" disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="animate-spin" /> : <Filter />} Filtrar
          </Button>
        </div>
        {rascunho.aba === "honorarios" && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipos de regra">
            <span className="text-xs text-muted-foreground">Tipos de regra:</span>
            {(Object.keys(ROTULO_TIPO_REGRA) as TipoRegra[]).map((t) => {
              const on = rascunho.tipos.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRascunho({ ...rascunho, tipos: on ? rascunho.tipos.filter((x) => x !== t) : [...rascunho.tipos, t] })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    on ? "border-brand bg-brand/12 text-info-ink" : "text-muted-foreground hover:border-brand/40",
                  )}
                >
                  {ROTULO_TIPO_REGRA[t]}
                </button>
              );
            })}
            {rascunho.tipos.length === 0 && <span className="text-xs text-muted-foreground">(todos)</span>}
          </div>
        )}
      </section>

      {/* resultados */}
      {!aplicado ? (
        <div className="card-surface">
          <EmptyState
            icone={Filter}
            titulo="Escolha o período e clique em Filtrar"
            descricao="Aparecem as parcelas vencendo no período, as horas lançadas e as despesas reembolsáveis ainda não cobradas."
            acao={
              <Button onClick={() => filtrar()}>
                <Filter /> Filtrar este mês
              </Button>
            }
          />
        </div>
      ) : q.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : clientes.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={ListChecks}
            titulo="Nada a faturar no período"
            descricao="Confira se os contratos têm regras de cobrança e se as horas e despesas foram lançadas nos casos."
            acao={
              <Button variant="outline" render={<Link href="/faturamento/contratos" />}>
                Ver contratos
              </Button>
            }
          />
        </div>
      ) : (
        <section className="card-surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{clientes.length}</strong> cliente(s) · <strong className="text-foreground">{q.data!.qtd_itens}</strong> item(ns) ·{" "}
              <strong className="font-mono text-foreground">{moeda(q.data!.total)}</strong>
            </p>
            {avisos > 0 && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-warning-ink">
                <AlertTriangle className="size-3.5" /> {avisos} item(ns) precisam de ajuste antes de faturar
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-12 py-2.5 pl-4">
                    <Tri itens={clientes.flatMap(itensDo)} sel={sel} onChange={(v) => marcar(clientes.flatMap(itensDo), v)} rotulo="Selecionar tudo" />
                  </th>
                  <th className="px-2 py-2.5 font-medium">Cliente</th>
                  <th className="px-2 py-2.5 font-medium">A faturar</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const aberto = abertos.has(c.tomador_id);
                  const itens = itensDo(c);
                  return (
                    <Fragment key={c.tomador_id}>
                      <tr className={cn("cursor-pointer border-b transition-colors hover:bg-accent/30", aberto && "bg-muted/30")} onClick={() => alternarAberto(c.tomador_id)}>
                        <td className="py-3 pl-4">
                          <Tri itens={itens} sel={sel} onChange={(v) => marcar(itens, v)} rotulo={`Selecionar tudo de ${c.tomador_nome}`} />
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{c.tomador_nome}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">
                                {documento(c.tomador_doc)} · {c.qtd_itens} item(ns)
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(c.tipos).map(([t, v]) => (
                              <span key={t} className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs">
                                <span className={cn("size-1.5 rounded-full", t === "hora" ? "bg-warning" : t === "recorrente" ? "bg-success" : t === "despesa" ? "bg-info" : "bg-brand")} />
                                {rotuloTipoItem(t)} <span className="font-mono">{moeda(v)}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap tabular-nums">{moeda(c.total)}</td>
                      </tr>
                      <AnimatePresence initial={false}>
                        {aberto &&
                          c.contratos.map((k) => (
                            <Fragment key={k.contrato_id}>
                              <tr className="border-b bg-muted/20">
                                <td className="py-2 pl-8">
                                  <Tri itens={k.itens} sel={sel} onChange={(v) => marcar(k.itens, v)} rotulo={`Selecionar contrato ${k.contrato_nome}`} />
                                </td>
                                <td colSpan={2} className="px-2 py-2 text-sm">
                                  <Link href={`/faturamento/contratos/${k.contrato_id}`} className="font-medium hover:underline">
                                    <span className="font-mono text-muted-foreground">#{k.contrato_numero}</span> {k.contrato_nome}
                                  </Link>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-sm font-medium tabular-nums">{moeda(k.total)}</td>
                              </tr>
                              <tr className="border-b">
                                <td colSpan={4} className="p-0">
                                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                                    <table className="w-full">
                                      <thead className="text-left text-[11px] text-muted-foreground">
                                        <tr>
                                          <th className="w-16" />
                                          <th className="px-2 py-1.5 font-medium">Data</th>
                                          <th className="px-2 py-1.5 font-medium">Caso</th>
                                          <th className="px-2 py-1.5 font-medium">Descrição</th>
                                          <th className="px-2 py-1.5 font-medium">Parcela</th>
                                          <th className="hidden px-2 py-1.5 font-medium lg:table-cell">Horas × valor/hora</th>
                                          <th className="hidden px-2 py-1.5 font-medium xl:table-cell">Profissional</th>
                                          <th className="px-4 py-1.5 text-right font-medium">Valor</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y">
                                        {k.itens.map((i) => (
                                          <LinhaItem key={i.chave} i={i} contratoId={k.contrato_id} sel={sel.has(i.chave)} onToggle={(v) => marcar([i], v)} />
                                        ))}
                                      </tbody>
                                    </table>
                                  </motion.div>
                                </td>
                              </tr>
                            </Fragment>
                          ))}
                      </AnimatePresence>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* rodapé fixo */}
      <AnimatePresence>
        {aplicado && selecionados.length > 0 && isOperador && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-24 pl-4 lg:pl-[calc(var(--sb)+1rem)]"
          >
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
              <span className="mr-1 text-sm">
                <strong className="tabular-nums">{selecionados.length}</strong> item(ns) · <strong className="font-mono">{moeda(totalSel)}</strong>{" "}
                <span className="text-white/60">em {doc}</span>
              </span>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setConfirmarDireto(true)} disabled={faturar.isPending || revisar.isPending}>
                <Zap /> Faturar direto
              </Button>
              <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => revisar.mutate()} disabled={revisar.isPending || faturar.isPending}>
                {revisar.isPending ? <Loader2 className="animate-spin" /> : <Send />} Enviar para Revisão
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmarDireto}
        onOpenChange={setConfirmarDireto}
        titulo={`Faturar ${selecionados.length} item(ns) direto?`}
        descricao={`Cria a(s) ${doc} agora, sem passar pela revisão. Total ${moeda(totalSel)}.`}
        confirmar="Faturar agora"
        carregando={faturar.isPending}
        onConfirm={() => faturar.mutate()}
      />
      <ResultadoDialog aberto={!!resultado} onClose={() => setResultado(null)} faturas={resultado?.faturas ?? null} revisoes={resultado?.revisoes ?? null} />
    </div>
  );
}
