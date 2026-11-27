"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSignature,
  FolderPlus,
  Gavel,
  ListTodo,
  type LucideIcon,
  MessagesSquare,
  Scale,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";

import { InicioMayaCorp } from "@/components/admin/inicio";
import { MayaCorpAssinatura } from "@/components/mayacorp/brand";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand";
import { data, dataHora, numero } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tela inicial do escritório: o dia de trabalho de quem entrou. Nenhum valor em dinheiro aparece aqui. */

interface TarefaInicio {
  id: number;
  titulo: string;
  prazo: string | null;
  hora: string | null;
  tipo: string;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  caso_id: number | null;
  caso: string | null;
  atrasada: boolean;
}

interface Inicio {
  data: string;
  tarefas: { abertas: number; hoje: number; atrasadas: number; semana: number; proximas: TarefaInicio[] } | null;
  numeros: { rotulo: string; valor: number; href: string; icone: string }[];
  pendencias: { qtd: number; texto: string; href: string; tom: "erro" | "aviso" | "info" }[];
  lotes: { id: number; numero: number; arquivo: string; qtd: number; status: string; criado_em: string }[];
}

const ICONE_NUMERO: Record<string, LucideIcon> = {
  casos: Briefcase,
  novo: FolderPlus,
  clientes: UsersRound,
  contratos: FileSignature,
  processos: Scale,
};

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function fraseDoDia(t: Inicio["tarefas"], pendencias: number) {
  if (!t) return pendencias ? `Há ${pendencias} assunto(s) esperando por você logo abaixo.` : "Tudo o que o seu perfil libera está no menu ao lado.";
  if (t.atrasadas)
    return (
      <>
        Você tem <strong className="font-semibold text-white">{numero(t.atrasadas)} tarefa(s) atrasada(s)</strong>
        {t.hoje ? ` e ${numero(t.hoje)} para hoje.` : "."} Vale começar por elas.
      </>
    );
  if (t.hoje)
    return (
      <>
        Hoje há <strong className="font-semibold text-white">{numero(t.hoje)} tarefa(s)</strong> na sua agenda
        {t.semana ? ` e mais ${numero(t.semana)} nos próximos 7 dias.` : "."}
      </>
    );
  if (t.semana) return `Nada vence hoje. Nos próximos 7 dias há ${numero(t.semana)} tarefa(s) na sua agenda.`;
  return t.abertas ? `Nenhum prazo próximo. Você tem ${numero(t.abertas)} tarefa(s) em aberto, sem data.` : "Sua agenda está livre: nenhuma tarefa em aberto.";
}

function quando(t: TarefaInicio, hoje: string) {
  if (!t.prazo) return "sem data";
  if (t.prazo === hoje) return t.hora ? `hoje, ${t.hora}` : "hoje";
  return `${data(t.prazo)}${t.hora ? `, ${t.hora}` : ""}`;
}

export default function InicioPage() {
  const { usuario } = useAuth();
  return usuario?.painel_mayacorp ? <InicioMayaCorp /> : <InicioEscritorio />;
}

function InicioEscritorio() {
  const { usuario, pode } = useAuth();
  const { nome_exibicao } = useBrand();
  const q = useQuery({ queryKey: ["hub", "inicio"], queryFn: () => api.get<Inicio>("/hub/inicio") });
  const d = q.data;
  const t = d?.tarefas ?? null;
  const hojeTexto = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  const atalhos = [
    { rotulo: "Tarefas", href: "/faturamento/tarefas", icone: ListTodo, ok: pode("tarefas.ver") },
    { rotulo: "Casos", href: "/faturamento/casos", icone: Briefcase, ok: pode("casos.ver") },
    { rotulo: "Lançar horas", href: "/faturamento/timesheet", icone: Clock, ok: pode("timesheet.ver") },
    { rotulo: "Clientes", href: "/cadastros/clientes", icone: UsersRound, ok: pode("clientes.ver") },
    { rotulo: "Tribunais", href: "/tribunais", icone: Gavel, ok: pode("trib_processos.ver") },
    { rotulo: "Comunicador", href: "/comunicador", icone: MessagesSquare, ok: pode("comunicador.usar") },
  ].filter((a) => a.ok);

  const agenda = t
    ? [
        { rotulo: "Atrasadas", valor: t.atrasadas, icone: AlertTriangle, alerta: t.atrasadas > 0 },
        { rotulo: "Para hoje", valor: t.hoje, icone: CalendarCheck, alerta: false },
        { rotulo: "Próximos 7 dias", valor: t.semana, icone: CalendarClock, alerta: false },
        { rotulo: "Em aberto", valor: t.abertas, icone: ListTodo, alerta: false },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* cabeçalho: o dia de hoje */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl bg-dark-maya p-6 text-white sm:p-8"
      >
        <div className="grid-bg absolute inset-0 opacity-50" />
        <div className="absolute -top-24 -right-10 size-80 rounded-full bg-brand/40 blur-[90px]" />
        <div className="absolute -bottom-32 left-10 size-72 rounded-full bg-navy blur-[80px]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-white/80">
              <Sparkles className="size-3.5 text-brand" /> {nome_exibicao} · <span className="first-letter:uppercase">{hojeTexto}</span>
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {saudacao()}, {usuario?.nome.split(" ")[0]}.
            </h1>
            <div className="mt-2 max-w-xl text-white/70">{d ? fraseDoDia(t, d.pendencias.length) : <Skeleton className="h-5 w-80 bg-white/10" />}</div>
            <div className="mt-6 flex flex-wrap gap-2">
              {atalhos.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
                >
                  <a.icone className="size-4 text-white/70" /> {a.rotulo}
                </Link>
              ))}
            </div>
          </div>
          {agenda.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[420px] lg:grid-cols-2">
              {agenda.map((a) => (
                <Link
                  key={a.rotulo}
                  href="/faturamento/tarefas"
                  className={cn(
                    "min-w-0 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur transition-colors hover:bg-white/10",
                    a.alerta && "border-danger/60 bg-danger/20",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] text-white/60">
                    <a.icone className="size-3.5" /> {a.rotulo}
                  </p>
                  <p className="mt-0.5 text-2xl font-semibold num">{numero(a.valor)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </motion.section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* minha agenda */}
        <div className="card-surface p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <ListTodo className="size-4 text-info-ink" /> Minha agenda
            </h2>
            {pode("tarefas.ver") && (
              <Link href="/faturamento/tarefas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                Ver todas <ArrowRight className="size-4" />
              </Link>
            )}
          </div>
          {q.isPending ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-12" />)
          ) : !t ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Seu perfil não usa a agenda de tarefas.</p>
          ) : t.proximas.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="size-8 text-success" />
              <p className="text-sm text-muted-foreground">Nenhuma tarefa em aberto no seu nome.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {t.proximas.map((x) => (
                <li key={x.id}>
                  <Link href="/faturamento/tarefas" className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        x.atrasada ? "bg-danger" : x.prioridade === "urgente" || x.prioridade === "alta" ? "bg-warning" : "bg-brand",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{x.titulo}</p>
                      <p className="truncate text-xs text-muted-foreground">{x.caso ?? "Sem caso"}</p>
                    </div>
                    {x.tipo === "prazo" && <Pill tom="danger">Prazo</Pill>}
                    {x.tipo === "audiencia" && <Pill tom="warning">Audiência</Pill>}
                    <span className={cn("shrink-0 text-xs num", x.atrasada ? "font-medium text-danger-ink" : "text-muted-foreground")}>
                      {x.atrasada ? `atrasada · ${data(x.prazo)}` : quando(x, d!.data)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* o que está parado */}
        <div className="card-surface flex flex-col p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-4 text-warning" /> Esperando por você
          </h2>
          <div className="mt-3 flex-1 space-y-2">
            {q.isPending && <Skeleton className="h-16" />}
            {d?.pendencias.length === 0 && <p className="rounded-xl bg-success/8 p-3 text-sm text-success-ink">Nada parado. Tudo em dia. ✨</p>}
            {d?.pendencias.map((p) => (
              <Link
                key={p.texto}
                href={p.href}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border-l-4 p-3 text-sm transition-colors hover:bg-accent/50",
                  p.tom === "erro" && "border-danger bg-danger/5",
                  p.tom === "aviso" && "border-warning bg-warning/8",
                  p.tom === "info" && "border-info bg-info/5",
                )}
              >
                <span>{p.texto}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
          <MayaCorpAssinatura className="mt-4 text-muted-foreground" />
        </div>
      </section>

      {/* o escritório em números (só quantidades) */}
      {(q.isPending || (d && d.numeros.length > 0)) && (
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">O escritório hoje</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {q.isPending
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
              : d!.numeros.map((n, i) => {
                  const Icone = ICONE_NUMERO[n.icone] ?? Briefcase;
                  return (
                    <motion.div key={n.rotulo} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
                      <Link href={n.href} className="card-surface group flex items-center gap-3 p-4 transition-shadow hover:shadow-lg hover:shadow-brand/10">
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand/10 text-info-ink">
                          <Icone className="size-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-2xl leading-tight font-semibold num">{numero(n.valor)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{n.rotulo}</span>
                        </span>
                      </Link>
                    </motion.div>
                  );
                })}
          </div>
        </section>
      )}

      {/* últimas emissões: só o andamento, sem valores */}
      {d && d.lotes.length > 0 && (
        <section className="card-surface p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Últimas emissões de notas</h2>
            <Link href="/nfse/lotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Ver todas <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="divide-y">
            {d.lotes.map((l) => (
              <Link key={l.id} href={`/nfse/lotes/${l.id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-accent/50">
                <div className="grid size-9 place-items-center rounded-lg bg-muted text-xs font-semibold num">#{l.numero}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.arquivo}</p>
                  <p className="text-xs text-muted-foreground">
                    {numero(l.qtd)} nota(s) · {dataHora(l.criado_em)}
                  </p>
                </div>
                <StatusBadge status={l.status} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
