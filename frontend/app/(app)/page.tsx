"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Bot,
  FileCheck2,
  FileUp,
  Landmark,
  Lightbulb,
  Mail,
  Plus,
  Receipt,
  Sparkles,
  Truck,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { MayaCorpAssinatura } from "@/components/mayacorp/brand";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand";
import { dataHora, moeda, moedaCompacta, numero } from "@/lib/format";
import type { AutomacaoCard, PainelOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function fraseDoMes(p: PainelOut) {
  const mes = new Date().toLocaleDateString("pt-BR", { month: "long" });
  const n = p.notas_emitidas.valor;
  if (!n) return `Nenhuma nota emitida em ${mes} ainda. Que tal começar a primeira emissão?`;
  const rej = p.rejeicoes.valor;
  return (
    <>
      Em {mes} já são <strong className="font-semibold text-white">{numero(n)} notas</strong>, somando{" "}
      <strong className="font-semibold text-white">{moeda(p.valor_faturado.valor)}</strong>
      {rej ? ` — ${numero(rej)} rejeição(ões) para revisar.` : " — sem nenhuma rejeição. 👏"}
    </>
  );
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const ICONES: Record<string, LucideIcon> = {
  nfse: FileCheck2,
  receipt: Receipt,
  "🧾": FileCheck2,
  "file-check": FileCheck2,
  porto: Truck,
  truck: Truck,
  "📤": Upload,
  upload: Upload,
  mail: Mail,
  email: Mail,
  conciliacao: Landmark,
  relatorio: BarChart3,
};

function CardAutomacao({ a, i }: { a: AutomacaoCard; i: number }) {
  const Icone = ICONES[a.icone] ?? Bot;
  const ativo = a.status === "ativo";
  const corpo = (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 * i }}
      whileHover={ativo ? { y: -3 } : undefined}
      className={cn(
        "group card-surface relative h-full overflow-hidden p-5 transition-shadow",
        ativo ? "hover:shadow-xl hover:shadow-brand/10" : "opacity-80",
      )}
    >
      {ativo && (
        <div className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-brand/15 blur-3xl transition-opacity group-hover:bg-brand/25" />
      )}
      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            "grid size-12 place-items-center rounded-2xl",
            ativo ? "brand-gradient text-white shadow-lg shadow-brand/30" : "bg-muted text-muted-foreground",
          )}
        >
          <Icone className="size-6" />
        </div>
        <StatusBadge status={a.status} pulse={ativo} />
      </div>
      <h3 className="relative mt-5 font-semibold">{a.nome}</h3>
      <p className="relative mt-1 line-clamp-2 text-sm text-muted-foreground">{a.descricao}</p>
      <div className="relative mt-5 flex items-center justify-between border-t pt-4 text-sm">
        <span className="font-medium num">{a.metrica ?? (ativo ? "—" : "Em breve")}</span>
        {ativo && <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />}
      </div>
    </motion.div>
  );
  return ativo && a.href ? (
    <Link href={a.href} className="block h-full">
      {corpo}
    </Link>
  ) : (
    corpo
  );
}

export default function InicioPage() {
  const { usuario, isOperador } = useAuth();
  const { nome_exibicao } = useBrand();
  const hub = useQuery({ queryKey: ["hub"], queryFn: () => api.get<AutomacaoCard[]>("/hub/automacoes") });
  const painel = useQuery({ queryKey: ["painel"], queryFn: () => api.get<PainelOut>("/nfse/painel") });
  const p = painel.data;

  const resumo = [
    { l: "Notas no mês", v: p ? numero(p.notas_emitidas.valor) : null },
    { l: "Faturado", v: p ? moedaCompacta(p.valor_faturado.valor) : null },
    { l: "ISS", v: p ? moedaCompacta(p.iss.valor) : null },
    { l: "Rejeições", v: p ? numero(p.rejeicoes.valor) : null },
  ];

  return (
    <div className="space-y-8">
      {/* hero */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-dark-maya p-6 text-white sm:p-8"
      >
        <div className="grid-bg absolute inset-0 opacity-50" />
        <div className="absolute -top-24 -right-10 size-80 rounded-full bg-brand/40 blur-[90px]" />
        <div className="absolute -bottom-32 left-10 size-72 rounded-full bg-navy blur-[80px]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80">
              <Sparkles className="size-3.5 text-brand" /> {nome_exibicao} · Maya Jus
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {saudacao()}, {usuario?.nome.split(" ")[0]}.
            </h1>
            <div className="mt-2 max-w-xl text-white/70">
              {p ? (
                fraseDoMes(p)
              ) : (
                <Skeleton className="h-5 w-80 bg-white/10" />
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {isOperador && (
                <Button render={<Link href="/nfse/nova-emissao" />} className="h-10 bg-white px-4 text-navy hover:bg-white/90">
                  <FileUp /> Nova emissão
                </Button>
              )}
              <Button
                render={<Link href="/nfse" />}
                variant="outline"
                className="h-10 border-white/20 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
              >
                Ver painel <ArrowRight />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[400px] lg:grid-cols-2">
            {resumo.map((r) => (
              <div key={r.l} className="min-w-0 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                <p className="text-[11px] text-white/55">{r.l}</p>
                {r.v === null ? (
                  <Skeleton className="mt-1.5 h-6 w-16 bg-white/10" />
                ) : (
                  <p className="mt-0.5 truncate text-xl font-semibold num">{r.v}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* catálogo */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Minhas automações</h2>
            <p className="text-sm text-muted-foreground">Cada robô é um módulo — mesmo login, mesmo lugar.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {hub.isPending
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)
            : hub.data?.map((a, i) => <CardAutomacao key={a.slug} a={a} i={i} />)}
          <motion.a
            href="mailto:mayacorp@mayacorp.com.br?subject=Ideia%20de%20automa%C3%A7%C3%A3o"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="group flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-5 text-center transition-colors hover:border-brand/50 hover:bg-brand/5"
          >
            <div className="grid size-12 place-items-center rounded-2xl bg-muted transition-colors group-hover:bg-brand/15">
              <Plus className="size-6 text-muted-foreground group-hover:text-info-ink" />
            </div>
            <div>
              <p className="font-semibold">Nova ideia?</p>
              <p className="text-sm text-muted-foreground">Conte para a MayaCorp o próximo robô.</p>
            </div>
          </motion.a>
        </div>
      </section>

      {/* atividade */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Últimos lotes</h3>
            <Button variant="ghost" size="sm" render={<Link href="/nfse/lotes" />}>
              Ver todos <ArrowRight />
            </Button>
          </div>
          <div className="divide-y">
            {painel.isPending &&
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-3 h-10" />)}
            {p?.ultimos_lotes.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lote ainda. Que tal começar o primeiro?</p>
            )}
            {p?.ultimos_lotes.slice(0, 5).map((l) => (
              <Link
                key={l.id}
                href={`/nfse/lotes/${l.id}`}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="grid size-9 place-items-center rounded-lg bg-muted text-xs font-semibold num">#{l.numero}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.arquivo_origem}</p>
                  <p className="text-xs text-muted-foreground">
                    {numero(l.qtd)} RPS · {dataHora(l.criado_em)}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </Link>
            ))}
          </div>
        </div>
        <div className="card-surface flex flex-col p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Lightbulb className="size-4 text-warning" /> Atenção agora
          </h3>
          <div className="mt-3 flex-1 space-y-2">
            {painel.isPending && <Skeleton className="h-16" />}
            {p?.alertas.length === 0 && (
              <p className="rounded-xl bg-success/8 p-3 text-sm text-success-ink">Tudo certo por aqui. Nenhum alerta. ✨</p>
            )}
            {p?.alertas.map((a, i) => (
              <Link
                key={i}
                href={a.href ?? "/nfse"}
                className={cn(
                  "block rounded-xl border-l-4 p-3 text-sm transition-colors hover:bg-accent/50",
                  a.nivel === "erro" && "border-danger bg-danger/5",
                  a.nivel === "aviso" && "border-warning bg-warning/8",
                  a.nivel === "info" && "border-info bg-info/5",
                )}
              >
                {a.texto}
              </Link>
            ))}
          </div>
          <MayaCorpAssinatura className="mt-4 text-muted-foreground" />
        </div>
      </section>
    </div>
  );
}
