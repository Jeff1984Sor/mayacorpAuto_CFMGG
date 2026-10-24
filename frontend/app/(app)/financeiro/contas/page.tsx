"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, Plus, Wallet } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { useContasBancarias } from "@/components/financeiro/comum";
import { TransferenciaDialog } from "@/components/financeiro/contas/transferencia-dialog";
import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { type ContaOut, ROTULO_TIPO_CONTA } from "@/lib/financeiro";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Barrinha entradas × saídas do mês (proporção). */
function Balanco({ entradas, saidas }: { entradas: number; saidas: number }) {
  const total = entradas + saidas || 1;
  return (
    <div className="mt-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="bg-success" style={{ width: `${(entradas / total) * 100}%` }} />
        <div className="bg-danger" style={{ width: `${(saidas / total) * 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px]">
        <span className="flex items-center gap-1 text-success-ink">
          <ArrowDownLeft className="size-3" /> <span className="font-mono">{moeda(entradas)}</span>
        </span>
        <span className="flex items-center gap-1 text-danger-ink">
          <span className="font-mono">{moeda(saidas)}</span> <ArrowUpRight className="size-3" />
        </span>
      </div>
    </div>
  );
}

function CartaoConta({ c, i }: { c: ContaOut; i: number }) {
  const saldo = toNum(c.saldo_atual);
  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
      <Link
        href={`/financeiro/contas/${c.id}`}
        className={cn("card-surface group relative block overflow-hidden p-4 pl-5 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", !c.ativo && "opacity-55 grayscale-[.4]")}
      >
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.cor }} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{c.nome}</p>
            <p className="truncate text-xs text-muted-foreground">
              {ROTULO_TIPO_CONTA[c.tipo]}
              {(c.banco || c.numero) && (
                <>
                  {" · "}
                  <span className="font-mono">{[c.banco, c.numero].filter(Boolean).join(" · ")}</span>
                </>
              )}
            </p>
          </div>
          {!c.ativo && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">inativa</span>}
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">Saldo atual</p>
        <p className={cn("font-mono text-2xl font-semibold tracking-tight tabular-nums", saldo < 0 ? "text-danger-ink" : "text-success-ink")}>{moeda(saldo)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">No mês</p>
        <Balanco entradas={toNum(c.entradas_mes)} saidas={toNum(c.saidas_mes)} />
      </Link>
    </motion.li>
  );
}

export default function ContasPage() {
  const { isOperador } = useAuth();
  const contas = useContasBancarias();
  const [transf, setTransf] = useState(false);
  const lista = contas.data ?? [];
  const ativas = lista.filter((c) => c.ativo);
  const total = ativas.reduce((a, c) => a + toNum(c.saldo_atual), 0);
  const entradas = ativas.reduce((a, c) => a + toNum(c.entradas_mes), 0);
  const saidas = ativas.reduce((a, c) => a + toNum(c.saidas_mes), 0);

  return (
    <div>
      <PageHeader
        titulo="Contas"
        descricao="Saldo de cada conta do escritório, com o extrato e os lançamentos."
        icone={Wallet}
        migalhas={[{ label: "Conta Bancária" }, { label: "Contas" }]}
        acoes={
          isOperador && (
            <>
              <Button variant="outline" onClick={() => setTransf(true)} disabled={ativas.length < 2}>
                <ArrowLeftRight /> Transferência
              </Button>
              <Button render={<Link href="/financeiro/nova-conta" />}>
                <Plus /> Nova conta
              </Button>
            </>
          )
        }
      />

      {contas.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : lista.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Landmark}
            titulo="Nenhuma conta cadastrada"
            descricao="Cadastre as contas do escritório para acompanhar saldo, extrato, fluxo de caixa e DRE."
            acao={
              isOperador && (
                <Button render={<Link href="/financeiro/nova-conta" />}>
                  <Plus /> Cadastrar a primeira conta
                </Button>
              )
            }
          />
        </div>
      ) : (
        <>
          <section className="relative mb-6 overflow-hidden rounded-3xl bg-dark-maya p-6 text-white shadow-xl sm:p-8" aria-label="Saldo total">
            <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 size-60 rounded-full bg-success/20 blur-3xl" />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-white/70">Saldo total das contas ativas</p>
                <AnimatedNumber value={total} format={(v) => moeda(v)} className={cn("block font-mono text-4xl font-semibold tracking-tight sm:text-5xl", total < 0 && "text-red-300")} />
                <p className="mt-1 text-xs text-white/60">
                  {ativas.length} conta(s) ativa(s){lista.length > ativas.length && ` · ${lista.length - ativas.length} inativa(s)`}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <dt className="flex items-center gap-1 text-white/60">
                    <ArrowDownLeft className="size-3.5" /> Entradas no mês
                  </dt>
                  <dd className="font-mono text-lg font-semibold text-emerald-300">{moeda(entradas)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1 text-white/60">
                    <ArrowUpRight className="size-3.5" /> Saídas no mês
                  </dt>
                  <dd className="font-mono text-lg font-semibold text-red-300">{moeda(saidas)}</dd>
                </div>
              </dl>
            </div>
          </section>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lista.map((c, i) => (
              <CartaoConta key={c.id} c={c} i={i} />
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Entradas e saídas do mês não incluem transferências entre contas.</p>
        </>
      )}
      <TransferenciaDialog open={transf} onOpenChange={setTransf} />
    </div>
  );
}
