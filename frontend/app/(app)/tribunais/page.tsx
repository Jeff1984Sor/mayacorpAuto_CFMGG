"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Bell,
  BellRing,
  Briefcase,
  CalendarPlus,
  CheckCheck,
  FileSignature,
  Gauge,
  Info,
  KeyRound,
  Landmark,
  Link2,
  ListChecks,
  RotateCcw,
  ScanSearch,
  Scale,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { TarefaPrazoDialog } from "@/components/tribunais/tarefa-prazo-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora, numero, relativo } from "@/lib/format";
import {
  CHAVE,
  FONTE,
  type IntimacaoRecente,
  type JobTribunal,
  STATUS_JOB,
  STATUS_PROTOCOLO,
  TIPO_JOB,
  useAlertasTribunais,
  useJobsTribunais,
  usePainelTribunais,
} from "@/lib/tribunais";
import { cn } from "@/lib/utils";

/** Selo do modo da integração (simulado não fala com os tribunais). */
function ModoTribunais({ modo }: { modo: "simulado" | "real" }) {
  const real = modo === "real";
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
            real ? "bg-success/12 text-success-ink ring-success/35" : "bg-warning/12 text-warning-ink ring-warning/35",
          )}
        >
          <span className={cn("size-2 rounded-full", real ? "bg-success" : "bg-warning")} />
          {real ? "Real" : "Simulado"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {real ? "Consultas, downloads e protocolos vão de verdade aos tribunais." : "Modo de teste: nada é enviado aos tribunais com certificado."}
      </TooltipContent>
    </Tooltip>
  );
}

function Indicador({
  titulo,
  valor,
  icone: Icone,
  href,
  destaque,
  carregando,
}: {
  titulo: string;
  valor: number | undefined;
  icone: React.ComponentType<{ className?: string }>;
  href?: string;
  destaque?: "warning" | "danger";
  carregando?: boolean;
}) {
  const corpo = (
    <>
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-navy dark:text-brand",
          destaque === "warning" && (valor ?? 0) > 0 && "bg-warning/12 text-warning-ink",
          destaque === "danger" && (valor ?? 0) > 0 && "bg-danger/10 text-danger-ink",
        )}
      >
        <Icone className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        {carregando ? <Skeleton className="h-7 w-14" /> : <span className="block text-2xl leading-tight font-semibold num">{numero(valor ?? 0)}</span>}
        <span className="block truncate text-xs text-muted-foreground">{titulo}</span>
      </span>
      {href && <ArrowRight className="size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />}
    </>
  );
  const cls = "group card-surface flex items-center gap-3 p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-all hover:-translate-y-0.5 hover:border-brand/40")}>
      {corpo}
    </Link>
  ) : (
    <div className={cls}>{corpo}</div>
  );
}

function Alertas() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const q = useAlertasTribunais();
  const lidos = useMutation({
    mutationFn: (corpo: { ids?: number[]; todas?: boolean }) => api.post<{ marcados: number }>("/tribunais/alertas/lidos", corpo),
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE] }),
  });
  const lista = q.data ?? [];
  if (lista.length === 0) return null;
  const ICONE = { erro: AlertOctagon, aviso: AlertTriangle, info: Info } as const;
  return (
    <section className="card-surface p-4" aria-label="Avisos">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing className="size-4 text-warning-ink" /> Avisos <span className="text-xs font-normal text-muted-foreground num">{lista.length}</span>
        </h2>
        {pode("trib_processos.editar") && (
          <Button variant="ghost" size="sm" disabled={lidos.isPending} onClick={() => lidos.mutate({ todas: true })}>
            <CheckCheck /> Marcar todos como lidos
          </Button>
        )}
      </div>
      <ul className="max-h-72 space-y-2 overflow-y-auto">
        {lista.map((a) => {
          const I = ICONE[a.severidade as keyof typeof ICONE] ?? Info;
          const href = a.protocolo_id ? `/tribunais/protocolos/${a.protocolo_id}` : a.processo_id ? `/tribunais/processos/${a.processo_id}` : null;
          return (
            <li
              key={a.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm",
                a.severidade === "erro" && "border-danger/25 bg-danger/6",
                a.severidade === "aviso" && "border-warning/30 bg-warning/8",
                a.severidade !== "erro" && a.severidade !== "aviso" && "border-info/25 bg-info/6",
              )}
            >
              <I
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  a.severidade === "erro" ? "text-danger-ink" : a.severidade === "aviso" ? "text-warning-ink" : "text-info-ink",
                )}
              />
              <div className="min-w-0 flex-1">
                <p>{a.mensagem}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{relativo(a.criado_em)}</p>
              </div>
              {href && (
                <Link href={href} className="shrink-0 text-xs font-medium underline-offset-4 hover:underline">
                  Abrir <ArrowRight className="inline size-3" />
                </Link>
              )}
              {pode("trib_processos.editar") && (
                <Button variant="ghost" size="icon-xs" aria-label="Marcar como lido" disabled={lidos.isPending} onClick={() => lidos.mutate({ ids: [a.id] })}>
                  <CheckCheck />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Intimacoes({ itens, carregando }: { itens: IntimacaoRecente[]; carregando: boolean }) {
  const router = useRouter();
  const { pode } = useAuth();
  const [tarefa, setTarefa] = useState<IntimacaoRecente | null>(null);
  return (
    <section className="card-surface flex flex-col p-5 lg:col-span-2" aria-label="Intimações recentes">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold">
          <Bell className="size-4 text-info-ink" /> Intimações não lidas
        </h2>
        <Button variant="ghost" size="sm" render={<Link href="/tribunais/processos?com_intimacao=1" />}>
          Processos com intimação <ArrowRight />
        </Button>
      </div>
      <div className="flex-1 divide-y">
        {carregando && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2.5 h-14" />)}
        {!carregando && itens.length === 0 && (
          <EmptyState icone={CheckCheck} titulo="Nenhuma intimação pendente" descricao="As intimações novas dos processos monitorados aparecem aqui." className="py-8" />
        )}
        {itens.map((m) => (
          <div
            key={m.id}
            role="link"
            tabIndex={0}
            onClick={() => router.push(`/tribunais/processos/${m.processo_id}`)}
            onKeyDown={(e) => e.key === "Enter" && router.push(`/tribunais/processos/${m.processo_id}`)}
            className="-mx-2 flex cursor-pointer flex-col gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-start"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{m.numero_formatado}</span>
                <Pill tom="brand">{m.tribunal}</Pill>
                <span className="font-mono">{data(m.data_hora)}</span>
                <span>· {FONTE[m.fonte] ?? m.fonte}</span>
              </p>
              <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line">{m.descricao}</p>
            </div>
            {m.tarefa_id ? (
              <Pill tom="success">tarefa criada</Pill>
            ) : (
              pode("trib_processos.editar") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTarefa(m);
                  }}
                >
                  <CalendarPlus /> Criar tarefa de prazo
                </Button>
              )
            )}
          </div>
        ))}
      </div>
      <TarefaPrazoDialog mov={tarefa} numero={tarefa?.numero_formatado ?? ""} onOpenChange={(o) => !o && setTarefa(null)} />
    </section>
  );
}

function Fila() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const q = useJobsTribunais();
  const acao = useMutation({
    mutationFn: ({ j, tipo }: { j: JobTribunal; tipo: "reprocessar" | "cancelar" }) => api.post(`/tribunais/jobs/${j.id}/${tipo}`),
    onSuccess: (_r, { tipo }) => {
      toast.success(tipo === "reprocessar" ? "Tarefa de volta à fila" : "Tarefa cancelada");
      qc.invalidateQueries({ queryKey: [CHAVE] });
    },
  });
  const lista = q.data ?? [];
  const podeEditar = pode("trib_processos.editar");
  return (
    <section className="card-surface overflow-hidden" aria-label="Fila de trabalho">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ListChecks className="size-4 text-info-ink" /> Fila de trabalho do robô
        </h2>
        <span className="text-xs text-muted-foreground">últimas {lista.length}</span>
      </div>
      {q.isPending ? (
        <div className="p-4">
          <Skeleton className="h-32" />
        </div>
      ) : lista.length === 0 ? (
        <EmptyState icone={ListChecks} titulo="A fila está vazia" descricao="Importações, sincronizações e downloads aparecem aqui enquanto o robô trabalha." className="py-10" />
      ) : (
        <div className="max-h-105 overflow-auto">
          <table className="w-full min-w-180 text-sm">
            <thead className="sticky top-0 border-b bg-muted/60 text-left text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-2.5 font-medium">O quê</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="px-3 py-2.5 font-medium">Tentativas</th>
                <th className="px-3 py-2.5 font-medium">Criada</th>
                <th className="px-3 py-2.5 font-medium">Erro</th>
                <th className="w-40 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.map((j) => {
                const st = STATUS_JOB[j.status] ?? { l: j.status, tom: "neutral" as const };
                const podeReprocessar = podeEditar && j.tipo !== "protocolar" && (j.status === "erro" || j.status === "cancelado");
                const podeCancelar = podeEditar && (j.status === "fila" || j.status === "reprocessar");
                return (
                  <tr key={j.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{TIPO_JOB[j.tipo] ?? j.tipo}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{j.referencia ?? `#${j.referencia_id}`}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tom={st.tom} label={st.l} pulse={j.status === "rodando"} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {j.tentativas}/{j.max_tentativas}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{dataHora(j.criado_em)}</td>
                    <td className="max-w-xs px-3 py-2.5 text-xs text-danger-ink">
                      <span className="line-clamp-2" title={j.erro ?? undefined}>
                        {j.erro ?? ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {podeReprocessar && (
                          <Button size="xs" variant="outline" disabled={acao.isPending} onClick={() => acao.mutate({ j, tipo: "reprocessar" })}>
                            <RotateCcw /> Reprocessar
                          </Button>
                        )}
                        {podeCancelar && (
                          <Button size="xs" variant="ghost" disabled={acao.isPending} onClick={() => acao.mutate({ j, tipo: "cancelar" })}>
                            <XCircle /> Cancelar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function PainelTribunaisPage() {
  const { pode } = useAuth();
  const q = usePainelTribunais();
  const p = q.data;
  const carregando = q.isPending;
  const maxTrib = Math.max(1, ...(p?.por_tribunal ?? []).map((t) => t.processos));
  const protocolos = Object.entries(p?.protocolos ?? {}).filter(([, n]) => n > 0);
  const filaAtiva = Object.values(p?.fila ?? {}).reduce((a, n) => a + n, 0);
  const uso = p?.uso;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Tribunais"
        icone={Landmark}
        migalhas={[{ label: "Início", href: "/" }, { label: "Tribunais" }]}
        acoes={
          <>
            {p && <ModoTribunais modo={p.modo} />}
            <Button variant="outline" render={<Link href="/tribunais/processos" />}>
              <Scale /> Processos
            </Button>
            {pode("trib_processos.importar") && (
              <Button render={<Link href="/tribunais/varredura" />} className="brand-gradient text-white shadow-md shadow-brand/25">
                <ScanSearch /> Buscar pela OAB
              </Button>
            )}
          </>
        }
      />

      <Alertas />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Indicador titulo="Processos" valor={p?.processos} icone={Scale} href="/tribunais/processos" carregando={carregando} />
        <Indicador titulo="Monitorados" valor={p?.monitorados} icone={Gauge} carregando={carregando} />
        <Indicador titulo="Sem caso ligado" valor={p?.sem_caso} icone={Briefcase} href="/tribunais/processos?sem_caso=1" destaque="warning" carregando={carregando} />
        <Indicador titulo="Intimações não lidas" valor={p?.intimacoes_nao_lidas} icone={Bell} href="/tribunais/processos?com_intimacao=1" destaque="danger" carregando={carregando} />
        <Indicador titulo="Vínculos a confirmar" valor={p?.vinculos_sugeridos} icone={Link2} destaque="warning" carregando={carregando} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Intimacoes itens={p?.intimacoes_recentes ?? []} carregando={carregando} />

        <div className="space-y-4">
          <section className="card-surface p-5" aria-label="Protocolos">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <FileSignature className="size-4 text-info-ink" /> Protocolos
              </h2>
              {pode("trib_protocolos.ver") && (
                <Button variant="ghost" size="sm" render={<Link href="/tribunais/protocolos" />}>
                  Ver <ArrowRight />
                </Button>
              )}
            </div>
            {carregando ? (
              <Skeleton className="h-16" />
            ) : protocolos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma petição ainda.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {protocolos.map(([s, n]) => {
                  const st = STATUS_PROTOCOLO[s] ?? { l: s, tom: "neutral" as const };
                  return <StatusBadge key={s} tom={st.tom} label={`${st.l}: ${n}`} />;
                })}
              </div>
            )}
            {filaAtiva > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                <span className="num text-foreground">{filaAtiva}</span> tarefa(s) do robô em andamento ou com erro (veja a fila abaixo).
              </p>
            )}
          </section>

          <section className="card-surface p-5" aria-label="Franquia do mês">
            <h2 className="mb-1 font-semibold">Franquia de protocolos</h2>
            {carregando || !uso ? (
              <Skeleton className="h-12" />
            ) : !uso.plano ? (
              <p className="text-sm text-muted-foreground">Nenhum plano contratado. Fale com a MayaCorp para liberar o protocolo.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Plano {uso.plano} · ciclo {uso.ciclo}
                </p>
                <p className="mt-2 text-sm">
                  <span className="text-xl font-semibold num">{numero(uso.usado)}</span>
                  <span className="text-muted-foreground"> de {numero(uso.franquia)} créditos</span>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", (uso.percentual ?? 0) >= 100 ? "bg-danger" : (uso.percentual ?? 0) >= 80 ? "bg-warning" : "bg-brand")}
                    style={{ width: `${Math.min(100, uso.percentual ?? 0)}%` }}
                  />
                </div>
                {uso.excedente > 0 && (
                  <p className="mt-2 text-xs text-warning-ink">
                    {numero(uso.excedente)} crédito(s) além da franquia{uso.permite_excedente ? " (cobrados à parte)" : ""}.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="card-surface p-5" aria-label="Certificados">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <KeyRound className="size-4 text-info-ink" /> Certificados dos advogados
            </h2>
            {carregando ? (
              <Skeleton className="h-16" />
            ) : (p?.certificados.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum certificado enviado.{" "}
                <Link href="/tribunais/meu-certificado" className="font-medium text-info-ink underline-offset-4 hover:underline">
                  Enviar o meu
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {p?.certificados.map((c) => {
                  const ruim = c.revogado || c.dias_para_vencer < 0;
                  const perto = !ruim && c.dias_para_vencer <= 30;
                  return (
                    <li key={c.id} className="flex items-center gap-3 text-sm">
                      {ruim ? (
                        <ShieldAlert className="size-4 shrink-0 text-danger-ink" />
                      ) : (
                        <ShieldCheck className={cn("size-4 shrink-0", perto ? "text-warning-ink" : "text-success-ink")} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{c.titular_nome}</span>
                      <span className={cn("shrink-0 text-xs", ruim ? "text-danger-ink" : perto ? "text-warning-ink" : "text-muted-foreground")}>
                        {c.revogado ? "revogado" : c.dias_para_vencer < 0 ? "vencido" : `vence em ${c.dias_para_vencer} dia(s)`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="card-surface p-5" aria-label="Processos por tribunal">
        <h2 className="mb-4 font-semibold">Processos por tribunal</h2>
        {carregando ? (
          <Skeleton className="h-32" />
        ) : (p?.por_tribunal.length ?? 0) === 0 ? (
          <EmptyState
            icone={Landmark}
            titulo="Nenhum processo ainda"
            descricao="Busque pela OAB do advogado para trazer os processos de todos os tribunais."
            className="py-8"
            acao={
              pode("trib_processos.importar") && (
                <Button render={<Link href="/tribunais/varredura" />}>
                  <ScanSearch /> Buscar pela OAB
                </Button>
              )
            }
          />
        ) : (
          <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            {p?.por_tribunal.map((t) => (
              <li key={t.tribunal}>
                <Link href={`/tribunais/processos?tribunal=${encodeURIComponent(t.tribunal)}`} className="group flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 font-mono text-xs font-medium">{t.tribunal}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-linear-to-r from-navy to-brand transition-all group-hover:opacity-80" style={{ width: `${(t.processos / maxTrib) * 100}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-right num">{numero(t.processos)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Fila />
    </div>
  );
}
