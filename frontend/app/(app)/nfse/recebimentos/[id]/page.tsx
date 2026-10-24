"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import {
  Ban,
  CheckCheck,
  CheckCircle2,
  FileCheck2,
  HandCoins,
  ListChecks,
  Loader2,
  Search,
  Sparkles,
  Undo2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { Mono } from "@/components/mayacorp/brand";
import { Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora, moeda, numero, toNum } from "@/lib/format";
import type { ExtratoDetalhe, LancamentoOut, NotaResumo } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filtro = "todos" | "sugerido" | "conciliado" | "sem_par" | "outros";

const corConfianca = (c: number) => (c >= 85 ? "bg-success" : c >= 60 ? "bg-warning" : "bg-muted-foreground/40");

function confeteDiscreto() {
  confetti({
    particleCount: 60,
    spread: 70,
    startVelocity: 32,
    origin: { y: 0.35 },
    colors: ["#1a8f5e", "#7c8fff", "#1e2d6b"],
    scalar: 0.8,
    disableForReducedMotion: true,
  });
}

function ChipNota({ n }: { n: NotaResumo }) {
  const curto = n.tomador_nome.length > 22 ? `${n.tomador_nome.slice(0, 21)}…` : n.tomador_nome;
  return (
    <Link
      href={`/nfse/notas/${n.id}`}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors hover:border-brand/40"
      title={n.tomador_nome}
    >
      <FileCheck2 className="size-3 text-info-ink" />
      <span className="num">NFS-e {n.numero}</span>·<span className="num">{moeda(n.valor)}</span>·<span className="text-muted-foreground">{curto}</span>
    </Link>
  );
}

function EscolherNotas({
  extratoId,
  lanc,
  onClose,
  onConfirmado,
}: {
  extratoId: number;
  lanc: LancamentoOut | null;
  onClose: () => void;
  onConfirmado: (l: LancamentoOut) => void;
}) {
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 250);
  const [sel, setSel] = useState<Map<number, NotaResumo>>(new Map());
  const lid = lanc?.id;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reinicia ao abrir outro lançamento
    setSel(new Map((lanc?.notas ?? []).map((n) => [n.id, n])));
    setQ("");
  }, [lanc]);

  const cand = useQuery({
    queryKey: ["candidatas", extratoId, lid, busca],
    queryFn: () => api.get<NotaResumo[]>(`/nfse/extratos/${extratoId}/lancamentos/${lid}/candidatas`, { q: busca }),
    enabled: !!lid,
  });
  const confirmar = useMutation({
    mutationFn: () => api.post<LancamentoOut>(`/nfse/extratos/${extratoId}/lancamentos/${lid}/confirmar`, { nfse_ids: [...sel.keys()] }),
    onSuccess: (l) => {
      onConfirmado(l);
      onClose();
    },
  });

  const alvo = toNum(lanc?.valor);
  const soma = [...sel.values()].reduce((a, n) => a + toNum(n.valor), 0);
  const diff = Math.round((alvo - soma) * 100) / 100;
  const bate = sel.size > 0 && Math.abs(diff) < 0.005;
  const lista = useMemo(() => {
    const ids = new Set((cand.data ?? []).map((n) => n.id));
    // mantém visíveis as já marcadas mesmo fora do resultado da busca
    return [...(cand.data ?? []), ...[...sel.values()].filter((n) => !ids.has(n.id))];
  }, [cand.data, sel]);
  const toggle = (n: NotaResumo, v: boolean) =>
    setSel((m) => {
      const x = new Map(m);
      if (v) x.set(n.id, n);
      else x.delete(n.id);
      return x;
    });

  return (
    <Sheet open={!!lanc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-lg">
        {lanc && (
          <>
            <SheetHeader className="border-b p-5">
              <SheetTitle>Escolher notas para este crédito</SheetTitle>
              <SheetDescription>
                {data(lanc.data)} · {lanc.descricao}
              </SheetDescription>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-muted/60 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Crédito</p>
                  <p className="font-semibold num">{moeda(alvo)}</p>
                </div>
                <div className={cn("rounded-xl p-2.5 transition-colors", bate ? "bg-success/12" : "bg-muted/60")}>
                  <p className="text-[11px] text-muted-foreground">Selecionado</p>
                  <AnimatedNumber value={soma} format={(n) => moeda(n)} className={cn("block font-semibold num", bate && "text-success-ink")} />
                </div>
                <div className={cn("rounded-xl p-2.5", bate ? "bg-success/12" : diff < 0 ? "bg-danger/10" : "bg-warning/12")}>
                  <p className="text-[11px] text-muted-foreground">{bate ? "Bateu!" : diff > 0 ? "Falta" : "Passou"}</p>
                  <p className={cn("font-semibold num", bate ? "text-success-ink" : diff < 0 ? "text-danger-ink" : "text-warning-ink")}>
                    {bate ? "✓" : moeda(Math.abs(diff))}
                  </p>
                </div>
              </div>
            </SheetHeader>
            <div className="border-b p-3">
              <div className="relative">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, nº da nota ou valor" className="h-9 pl-9" autoFocus />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {cand.isPending ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : lista.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma nota em aberto encontrada.</p>
              ) : (
                <ul className="divide-y">
                  {lista.map((n) => {
                    const on = sel.has(n.id);
                    return (
                      <li key={n.id}>
                        <label className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40", on && "bg-brand/6")}>
                          <Checkbox checked={on} onCheckedChange={(v) => toggle(n, !!v)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{n.tomador_nome}</span>
                            <span className="text-[11px] text-muted-foreground num">
                              NFS-e {n.numero} · lote #{String(n.lote_numero).padStart(4, "0")} · {data(n.data_emissao)}
                            </span>
                          </span>
                          <Mono className="text-sm">{moeda(n.valor)}</Mono>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <SheetFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/30 p-4">
              <span className="text-sm text-muted-foreground">
                <span className="num">{sel.size}</span> nota(s)
              </span>
              <Button onClick={() => confirmar.mutate()} disabled={!bate || confirmar.isPending}>
                {confirmar.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Confirmar baixa
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LinhaLancamento({
  l,
  extratoId,
  recemConciliado,
  onAtualizado,
  onEscolher,
}: {
  l: LancamentoOut;
  extratoId: number;
  recemConciliado: boolean;
  onAtualizado: (l: LancamentoOut, msg: string) => void;
  onEscolher: (l: LancamentoOut) => void;
}) {
  const { isAdmin, isOperador } = useAuth();
  const acao = useMutation({
    mutationFn: ({ tipo }: { tipo: "confirmar" | "ignorar" | "desfazer"; msg: string }) =>
      api.post<LancamentoOut>(`/nfse/extratos/${extratoId}/lancamentos/${l.id}/${tipo}`, tipo === "confirmar" ? {} : undefined),
    onSuccess: (r, v) => onAtualizado(r, v.msg),
  });
  const credito = toNum(l.valor) > 0;
  const conciliado = l.status === "conciliado";

  return (
    <motion.li
      layout
      className={cn("relative grid gap-3 px-4 py-3.5 transition-colors sm:grid-cols-[96px_1fr_auto] sm:items-center", conciliado && "bg-success/[0.04]")}
    >
      <AnimatePresence>
        {recemConciliado && (
          <motion.div
            className="pointer-events-none absolute inset-0 bg-success/15"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4 }}
          />
        )}
      </AnimatePresence>
      <div className="relative">
        <p className="text-xs text-muted-foreground num">{data(l.data)}</p>
        <p className={cn("text-base font-semibold num", credito ? "text-foreground" : "text-danger-ink")}>{moeda(l.valor)}</p>
      </div>
      <div className="relative min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {conciliado ? (
            <motion.span
              key={`ok-${recemConciliado}`}
              initial={recemConciliado ? { scale: 0.4, rotate: -20 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 15 }}
              className="inline-flex"
            >
              <StatusBadge status="conciliado" label="Conciliado ✓" />
            </motion.span>
          ) : (
            <StatusBadge status={l.status} />
          )}
          <p className="min-w-0 truncate text-sm font-medium" title={l.descricao}>
            {l.descricao}
          </p>
        </div>
        {credito && l.status !== "duplicado" && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" title={`Confiança ${l.confianca}`}>
              <motion.div
                className={cn("h-full rounded-full", corConfianca(l.confianca))}
                initial={{ width: 0 }}
                animate={{ width: `${l.confianca}%` }}
                transition={{ duration: 0.7 }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground">
              <span className="num">{l.confianca}</span>
              {l.motivo && ` · ${l.motivo}`}
            </span>
          </div>
        )}
        {!credito && l.motivo && <p className="text-[11px] text-muted-foreground">{l.motivo}</p>}
        {l.notas.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {l.notas.map((n) => (
              <ChipNota key={n.id} n={n} />
            ))}
          </div>
        )}
      </div>
      <div className="relative flex flex-wrap justify-end gap-1.5">
        {isOperador && l.status === "sugerido" && l.notas.length > 0 && (
          <Button size="sm" onClick={() => acao.mutate({ tipo: "confirmar", msg: "Baixa confirmada" })} disabled={acao.isPending}>
            {acao.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar
          </Button>
        )}
        {isOperador && credito && (l.status === "sugerido" || l.status === "sem_par") && (
          <>
            <Button size="sm" variant="outline" onClick={() => onEscolher(l)}>
              <ListChecks /> Escolher notas
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => acao.mutate({ tipo: "ignorar", msg: "Lançamento ignorado" })} disabled={acao.isPending}>
              <Ban /> Ignorar
            </Button>
          </>
        )}
        {isAdmin && conciliado && (
          <Button size="sm" variant="ghost" className="text-danger-ink" onClick={() => acao.mutate({ tipo: "desfazer", msg: "Baixa desfeita" })} disabled={acao.isPending}>
            <Undo2 /> Desfazer
          </Button>
        )}
      </div>
    </motion.li>
  );
}

export default function ExtratoPage() {
  const { id } = useParams<{ id: string }>();
  const eid = Number(id);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["extrato", eid], queryFn: () => api.get<ExtratoDetalhe>(`/nfse/extratos/${eid}`) });
  const e = q.data;
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [escolher, setEscolher] = useState<LancamentoOut | null>(null);
  const [recentes, setRecentes] = useState<Set<number>>(new Set());
  const completoAntes = useRef<boolean | null>(null);

  const pct = e && e.qtd_creditos ? (e.qtd_conciliados / e.qtd_creditos) * 100 : 0;

  // confete discreto quando a conciliação chega a 100% durante a sessão
  useEffect(() => {
    if (!e) return;
    const completo = e.qtd_creditos > 0 && e.qtd_conciliados >= e.qtd_creditos;
    if (completoAntes.current === false && completo) confeteDiscreto();
    completoAntes.current = completo;
  }, [e]);

  const atualizado = (l: LancamentoOut, msg: string) => {
    qc.setQueryData<ExtratoDetalhe>(["extrato", eid], (old) => (old ? { ...old, lancamentos: old.lancamentos.map((x) => (x.id === l.id ? l : x)) } : old));
    if (l.status === "conciliado") {
      setRecentes((s) => new Set(s).add(l.id));
      setTimeout(
        () =>
          setRecentes((s) => {
            const n = new Set(s);
            n.delete(l.id);
            return n;
          }),
        1600,
      );
    }
    toast.success(msg);
    void q.refetch();
    qc.invalidateQueries({ queryKey: ["extratos"] });
    qc.invalidateQueries({ queryKey: ["faturas"] });
    qc.invalidateQueries({ queryKey: ["faturas-resumo"] });
    qc.invalidateQueries({ queryKey: ["notas"] });
    qc.invalidateQueries({ queryKey: ["painel"] });
  };

  const lancs = e?.lancamentos ?? [];
  const cont = {
    todos: lancs.length,
    sugerido: lancs.filter((l) => l.status === "sugerido").length,
    conciliado: lancs.filter((l) => l.status === "conciliado").length,
    sem_par: lancs.filter((l) => l.status === "sem_par").length,
    outros: lancs.filter((l) => l.status === "ignorado" || l.status === "duplicado").length,
  };
  const visiveis = lancs.filter((l) =>
    filtro === "todos" ? true : filtro === "outros" ? l.status === "ignorado" || l.status === "duplicado" : l.status === filtro,
  );

  if (!e)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-96" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );

  return (
    <div className="space-y-5">
      <PageHeader
        titulo={e.arquivo_nome}
        descricao={`${e.banco ?? "Banco não identificado"} · ${e.formato.toUpperCase()}${e.periodo_de ? ` · ${data(e.periodo_de)} → ${data(e.periodo_ate)}` : ""} · enviado ${dataHora(e.criado_em)}`}
        icone={HandCoins}
        migalhas={[
          { label: "NFS-e", href: "/nfse" },
          { label: "Recebimentos", href: "/nfse/recebimentos" },
          { label: `Extrato #${e.id}` },
        ]}
      />

      <div className="card-surface relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full bg-success/12 blur-3xl" />
        <div className="relative grid gap-5 md:grid-cols-[auto_1fr] md:items-center">
          <div className="flex items-center gap-4">
            <div className="relative size-24">
              <svg viewBox="0 0 100 100" className="size-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--muted)" strokeWidth="10" />
                <motion.circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={pct === 100 ? "#1a8f5e" : "var(--brand)"}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 42}
                  initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - pct / 100) }}
                  transition={{ duration: 0.9, ease: "easeOut" }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <AnimatedNumber value={pct} format={(n) => `${Math.round(n)}%`} className="text-xl font-semibold num" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">{pct === 100 ? "Tudo conciliado! 🎉" : "Conciliação"}</p>
              <p className="text-xs text-muted-foreground">dos créditos do extrato</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
              { l: "Créditos", v: numero(e.qtd_creditos), sub: moeda(e.valor_creditos) },
              { l: "Conciliados", v: numero(e.qtd_conciliados), c: "text-success-ink" },
              { l: "Notas baixadas", v: numero(e.notas_baixadas), c: "text-success-ink" },
              { l: "Valor conciliado", v: moeda(e.valor_conciliado), c: "text-success-ink" },
              { l: "Sugestões", v: numero(cont.sugerido), c: cont.sugerido ? "text-warning-ink" : "" },
            ].map((x) => (
              <div key={x.l} className="rounded-xl border bg-background/60 p-3">
                <p className="text-[11px] text-muted-foreground">{x.l}</p>
                <p className={cn("truncate text-lg font-semibold num", x.c)}>{x.v}</p>
                {x.sub && <p className="text-[11px] text-muted-foreground num">{x.sub}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {cont.sugerido > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
          <Sparkles className="size-4 shrink-0 text-warning-ink" />
          <span className="flex-1">
            O robô encontrou <strong className="num">{cont.sugerido}</strong> par(es) prováveis, abaixo da confiança mínima. Confira e confirme.
          </span>
          <Button size="sm" variant="outline" onClick={() => setFiltro("sugerido")}>
            Ver sugestões
          </Button>
        </div>
      )}

      <div className="card-surface overflow-hidden">
        <div className="border-b p-3">
          <Segmented
            value={filtro}
            onChange={setFiltro}
            opcoes={[
              { value: "todos", label: "Todos", contagem: cont.todos },
              { value: "sugerido", label: "Sugeridos", contagem: cont.sugerido, tom: "warning" },
              { value: "conciliado", label: "Conciliados", contagem: cont.conciliado, tom: "success" },
              { value: "sem_par", label: "Sem par", contagem: cont.sem_par },
              { value: "outros", label: "Ignorados/duplicados", contagem: cont.outros },
            ]}
          />
        </div>
        {visiveis.length === 0 ? (
          <EmptyState icone={CheckCircle2} titulo="Nada por aqui" descricao="Nenhum lançamento neste filtro." className="py-10" />
        ) : (
          <ul className="divide-y">
            {visiveis.map((l) => (
              <LinhaLancamento
                key={l.id}
                l={l}
                extratoId={eid}
                recemConciliado={recentes.has(l.id)}
                onAtualizado={atualizado}
                onEscolher={setEscolher}
              />
            ))}
          </ul>
        )}
      </div>

      <EscolherNotas extratoId={eid} lanc={escolher} onClose={() => setEscolher(null)} onConfirmado={(l) => atualizado(l, "Baixa confirmada")} />
    </div>
  );
}
