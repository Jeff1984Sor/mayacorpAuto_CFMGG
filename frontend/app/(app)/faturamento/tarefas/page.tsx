"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  CalendarDays,
  CalendarRange,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eraser,
  Inbox,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  UserRoundCheck,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { useProfissionais } from "@/components/faturamento/dialogos";
import {
  aberta,
  CasoCombo,
  PRIORIDADE,
  rotuloPrazo,
  STATUS_TAREFA,
  TarefaDialog,
  TarefaLinha,
  TIPO_TAREFA,
  useEtiquetas,
  useMudarStatus,
} from "@/components/faturamento/tarefas";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput, Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PrioridadeTarefa, StatusTarefa, TarefaOut, TarefasListaOut, TipoTarefa } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

type Visao = "lista" | "quadro" | "calendario";
const CHAVE_VISAO = "mayacorp:tarefas:visao";
const hojeIso = () => new Date().toLocaleDateString("sv-SE");
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};

// ---------------------------------------------------------------- filtro multi (popover com caixas)
function Multi<T extends string>({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: { v: T; l: string; ponto?: string }[]; valor: T[]; onChange: (v: T[]) => void }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition hover:bg-muted/40",
              valor.length ? "border-brand/50 bg-brand/5 text-info-ink" : "text-muted-foreground",
            )}
          />
        }
      >
        {rotulo}
        {valor.length > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-brand-foreground">{valor.length}</span>}
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1">
        {opcoes.map((o) => {
          const on = valor.includes(o.v);
          return (
            <label key={o.v} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <Checkbox checked={on} onCheckedChange={(x) => onChange(x ? [...valor, o.v] : valor.filter((y) => y !== o.v))} aria-label={o.l} />
              {o.ponto && <span className={cn("size-2 rounded-full", o.ponto)} />}
              {o.l}
            </label>
          );
        })}
        {valor.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md border-t px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted">
            Limpar
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- lista agrupada
function grupoDe(t: TarefaOut, hoje: string) {
  if (!aberta(t)) return "Concluídas";
  if (!t.prazo) return "Sem prazo";
  if (t.prazo < hoje) return "Atrasadas";
  if (t.prazo === hoje) return "Hoje";
  if (t.prazo === somaDias(hoje, 1)) return "Amanhã";
  if (t.prazo <= somaDias(hoje, 7)) return "Esta semana";
  return "Depois";
}
const GRUPOS = ["Atrasadas", "Hoje", "Amanhã", "Esta semana", "Depois", "Sem prazo", "Concluídas"] as const;
const COR_GRUPO: Record<string, string> = { Atrasadas: "text-danger-ink", Hoje: "text-warning-ink", Amanhã: "text-warning-ink", Concluídas: "text-success-ink" };

function Lista({
  itens,
  sel,
  setSel,
  onAbrir,
  podeEditar,
}: {
  itens: TarefaOut[];
  sel: Set<number>;
  setSel: (s: Set<number>) => void;
  onAbrir: (t: TarefaOut) => void;
  podeEditar: boolean;
}) {
  const hoje = hojeIso();
  const [fechados, setFechados] = useState<Set<string>>(new Set(["Concluídas"]));
  return (
    <div className="space-y-4">
      {GRUPOS.map((g) => {
        const doGrupo = itens.filter((t) => grupoDe(t, hoje) === g);
        if (!doGrupo.length) return null;
        const fechado = fechados.has(g);
        const todos = doGrupo.every((t) => sel.has(t.id));
        return (
          <section key={g} className="card-surface overflow-hidden" aria-label={g}>
            <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              {podeEditar && (
                <Checkbox
                  checked={todos}
                  indeterminate={!todos && doGrupo.some((t) => sel.has(t.id))}
                  onCheckedChange={(v) => {
                    const n = new Set(sel);
                    doGrupo.forEach((t) => (v ? n.add(t.id) : n.delete(t.id)));
                    setSel(n);
                  }}
                  aria-label={`Selecionar ${g}`}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  const n = new Set(fechados);
                  if (fechado) n.delete(g);
                  else n.add(g);
                  setFechados(n);
                }}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", fechado && "-rotate-90")} />
                <h2 className={cn("text-sm font-semibold", COR_GRUPO[g])}>{g}</h2>
                <span className="text-xs text-muted-foreground">{doGrupo.length}</span>
              </button>
            </header>
            {!fechado && (
              <ul className="divide-y">
                {doGrupo.map((t) => (
                  <TarefaLinha
                    key={t.id}
                    t={t}
                    onAbrir={() => onAbrir(t)}
                    podeEditar={podeEditar}
                    selecionada={sel.has(t.id)}
                    onSelecionar={
                      podeEditar
                        ? (v) => {
                            const n = new Set(sel);
                            if (v) n.add(t.id);
                            else n.delete(t.id);
                            setSel(n);
                          }
                        : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- quadro (kanban)
const COLUNAS: StatusTarefa[] = ["a_fazer", "em_andamento", "concluida", "cancelada"];
function Quadro({ itens, onAbrir, podeEditar, comCanceladas }: { itens: TarefaOut[]; onAbrir: (t: TarefaOut) => void; podeEditar: boolean; comCanceladas: boolean }) {
  const status = useMudarStatus();
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [sobre, setSobre] = useState<StatusTarefa | null>(null);
  const cols = COLUNAS.filter((c) => c !== "cancelada" || comCanceladas);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className={cn("grid gap-3", cols.length === 4 ? "min-w-[1000px] grid-cols-4" : "min-w-[760px] grid-cols-3")}>
        {cols.map((c) => {
          const lista = itens.filter((t) => t.status === c);
          return (
            <section
              key={c}
              aria-label={STATUS_TAREFA[c].l}
              onDragOver={(e) => {
                if (!podeEditar) return;
                e.preventDefault();
                setSobre(c);
              }}
              onDragLeave={() => setSobre((s) => (s === c ? null : s))}
              onDrop={() => {
                const t = itens.find((x) => x.id === arrastando);
                if (t && t.status !== c) status.mutate({ id: t.id, status: c });
                setArrastando(null);
                setSobre(null);
              }}
              className={cn("flex min-h-[55dvh] flex-col rounded-2xl bg-muted/50 ring-1 ring-border transition", sobre === c && "bg-brand/8 ring-2 ring-brand/40")}
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_TAREFA[c].cor)}>{STATUS_TAREFA[c].l}</span>
                <span className="ml-auto text-xs font-semibold text-muted-foreground tabular-nums">{lista.length}</span>
              </header>
              <ul className="flex-1 space-y-2 overflow-y-auto px-2.5 pb-3">
                {lista.map((t) => {
                  const T = TIPO_TAREFA[t.tipo];
                  const p = rotuloPrazo(t);
                  return (
                    <motion.li key={t.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <button
                        type="button"
                        draggable={podeEditar}
                        onDragStart={() => setArrastando(t.id)}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => onAbrir(t)}
                        className={cn(
                          "w-full cursor-grab rounded-xl border bg-card p-3 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing",
                          t.atrasada && aberta(t) && "border-danger/40",
                          arrastando === t.id && "opacity-50",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", PRIORIDADE[t.prioridade].ponto)} />
                          <p className={cn("min-w-0 flex-1 text-sm font-medium", t.status === "concluida" && "text-muted-foreground line-through")}>{t.titulo}</p>
                          <T.icone className="size-3.5 shrink-0 text-muted-foreground" />
                        </div>
                        {t.caso_id && (
                          <p className="mt-1 truncate pl-4 text-[11px] text-muted-foreground">
                            #{t.caso_numero} {t.caso_titulo}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2 pl-4">
                          {p && <span className={cn("text-[11px]", p.cls)}>{p.texto}</span>}
                          {t.responsavel_nome && (
                            <span className="ml-auto" title={t.responsavel_nome}>
                              <UserAvatar nome={t.responsavel_nome} className="size-5" textoClassName="text-[8px]" />
                            </span>
                          )}
                        </div>
                      </button>
                    </motion.li>
                  );
                })}
                {!lista.length && <li className="grid h-24 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground">{podeEditar ? "Arraste uma tarefa para cá" : "Vazio"}</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- calendário
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function Calendario({ itens, onAbrir, onNova }: { itens: TarefaOut[]; onAbrir: (t: TarefaOut) => void; onNova?: (dia: string) => void }) {
  const hoje = hojeIso();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [a, m] = mes.split("-").map(Number);
  const primeiro = new Date(a, m - 1, 1);
  const offset = (primeiro.getDay() + 6) % 7;
  const dias = new Date(a, m, 0).getDate();
  const celulas = Array.from({ length: Math.ceil((offset + dias) / 7) * 7 }, (_, i) => {
    const d = i - offset + 1;
    return d >= 1 && d <= dias ? `${mes}-${String(d).padStart(2, "0")}` : null;
  });
  const porDia = useMemo(() => {
    const mp = new Map<string, TarefaOut[]>();
    itens.forEach((t) => t.prazo && mp.set(t.prazo, [...(mp.get(t.prazo) ?? []), t]));
    return mp;
  }, [itens]);
  const ir = (d: number) => {
    const n = new Date(a, m - 1 + d, 1);
    setMes(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  };
  const semPrazo = itens.filter((t) => !t.prazo && aberta(t)).length;
  return (
    <section className="card-surface overflow-hidden" aria-label="Calendário">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" onClick={() => ir(-1)} aria-label="Mês anterior">
          <ChevronLeft />
        </Button>
        <h2 className="min-w-40 text-center font-semibold">
          {MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1)} de {a}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={() => ir(1)} aria-label="Próximo mês">
          <ChevronRight />
        </Button>
        <Button variant="outline" size="xs" onClick={() => setMes(hoje.slice(0, 7))}>
          Hoje
        </Button>
        {semPrazo > 0 && <span className="ml-auto text-xs text-muted-foreground">{semPrazo} tarefa(s) sem prazo não aparecem aqui</span>}
      </header>
      <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-medium text-muted-foreground uppercase">
        {DIAS.map((d) => (
          <div key={d} className="py-1.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celulas.map((dia, i) => {
          const ts = dia ? (porDia.get(dia) ?? []) : [];
          return (
            <div key={i} className={cn("group min-h-28 border-r border-b p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0", !dia && "bg-muted/20", dia === hoje && "bg-brand/5")}>
              {dia && (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cn("grid size-6 place-items-center rounded-full text-xs", dia === hoje ? "bg-brand font-semibold text-brand-foreground" : "text-muted-foreground")}>{Number(dia.slice(8))}</span>
                    {onNova && (
                      <button type="button" onClick={() => onNova(dia)} aria-label={`Nova tarefa em ${dia}`} className="rounded p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted">
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <ul className="space-y-0.5">
                    {ts.slice(0, 4).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => onAbrir(t)}
                          className={cn(
                            "flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] transition hover:bg-muted",
                            !aberta(t) ? "text-muted-foreground line-through" : t.atrasada ? "bg-danger/8 text-danger-ink" : "bg-brand/6",
                          )}
                          title={t.titulo}
                        >
                          <span className={cn("size-1.5 shrink-0 rounded-full", PRIORIDADE[t.prioridade].ponto)} />
                          {t.hora && <span className="font-mono">{t.hora}</span>}
                          <span className="truncate">{t.titulo}</span>
                        </button>
                      </li>
                    ))}
                    {ts.length > 4 && <li className="px-1 text-[10px] text-muted-foreground">+{ts.length - 4}</li>}
                  </ul>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- página
function Central() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const profs = useProfissionais();
  const etiquetas = useEtiquetas();

  const lista = (k: string) => sp.getAll(k);
  const f = {
    q: sp.get("q") ?? "",
    status: lista("status") as StatusTarefa[],
    prioridade: lista("prioridade") as PrioridadeTarefa[],
    tipo: lista("tipo") as TipoTarefa[],
    responsavel_id: sp.get("responsavel_id") ?? "",
    minhas: sp.get("minhas") === "true",
    tomador_id: sp.get("tomador_id") ?? "",
    cliente_nome: sp.get("cliente_nome") ?? "",
    caso_id: sp.get("caso_id") ?? "",
    sem_caso: sp.get("sem_caso") === "true",
    de: sp.get("de") ?? "",
    ate: sp.get("ate") ?? "",
    situacao: sp.get("situacao") ?? "",
    etiqueta: sp.get("etiqueta") ?? "",
  };
  type F = typeof f;
  const setF = (mud: Partial<F>) => {
    const n = { ...f, ...mud };
    const u = new URLSearchParams();
    Object.entries(n).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((x) => u.append(k, x));
      else if (v === true) u.set(k, "true");
      else if (v) u.set(k, String(v));
    });
    router.replace(`${pathname}${u.toString() ? `?${u}` : ""}`, { scroll: false });
  };
  const filtrando = sp.toString().length > 0;
  const [busca, setBusca] = useState(f.q);
  const buscaDeb = useDebounce(busca, 350);
  useEffect(() => {
    if (buscaDeb !== f.q) setF({ q: buscaDeb });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando a busca muda
  }, [buscaDeb]);

  const [visao, setVisao] = useState<Visao>("lista");
  /* eslint-disable react-hooks/set-state-in-effect -- lembra a visão escolhida no navegador */
  useEffect(() => {
    try {
      const v = localStorage.getItem(CHAVE_VISAO) as Visao | null;
      if (v === "lista" || v === "quadro" || v === "calendario") setVisao(v);
    } catch {
      /* sem armazenamento local */
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  const mudarVisao = (v: Visao) => {
    setVisao(v);
    try {
      localStorage.setItem(CHAVE_VISAO, v);
    } catch {
      /* sem armazenamento local */
    }
  };
  const [comCanceladas, setComCanceladas] = useState(false);

  const params = {
    q: f.q || undefined,
    status: f.status,
    prioridade: f.prioridade,
    tipo: f.tipo,
    responsavel_id: f.responsavel_id || undefined,
    minhas: f.minhas || undefined,
    tomador_id: f.tomador_id || undefined,
    caso_id: f.caso_id || undefined,
    sem_caso: f.sem_caso || undefined,
    de: f.de || undefined,
    ate: f.ate || undefined,
    situacao: f.situacao || undefined,
    etiqueta: f.etiqueta || undefined,
  };
  const q = useQuery({ queryKey: ["fat", "tarefas", "central", params], queryFn: () => api.get<TarefasListaOut>("/faturamento/tarefas", params), placeholderData: (p) => p });
  const itens = q.data?.itens ?? [];
  const r = q.data?.resumo;

  const [dlg, setDlg] = useState<{ t: TarefaOut | null; prazo?: string } | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [excluirLote, setExcluirLote] = useState(false);
  const selecionadas = itens.filter((t) => sel.has(t.id));
  const lote = useMutation({
    mutationFn: async (acao: { tipo: "concluir" } | { tipo: "responsavel"; id: number | null } | { tipo: "excluir" }) => {
      for (const t of selecionadas) {
        if (acao.tipo === "concluir") await api.patch(`/faturamento/tarefas/${t.id}/status`, { status: "concluida" });
        else if (acao.tipo === "excluir") await api.del(`/faturamento/tarefas/${t.id}`);
        else
          await api.put(`/faturamento/tarefas/${t.id}`, {
            caso_id: t.caso_id,
            titulo: t.titulo,
            descricao: t.descricao,
            tipo: t.tipo,
            status: t.status,
            prioridade: t.prioridade,
            prazo: t.prazo,
            hora: t.hora,
            responsavel_id: acao.id,
            etiquetas: t.etiquetas,
          });
      }
      return acao.tipo;
    },
    onSuccess: (tipo) => {
      toast.success(`${selecionadas.length} tarefa(s) ${tipo === "concluir" ? "concluída(s)" : tipo === "excluir" ? "excluída(s)" : "reatribuída(s)"}`);
      setSel(new Set());
      setExcluirLote(false);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });

  const chips: { k: string; l: string; n: number | undefined; icone: React.ComponentType<{ className?: string }>; on: boolean; aplicar: Partial<F>; cls?: string }[] = [
    { k: "abertas", l: "Abertas", n: r?.abertas, icone: Inbox, on: f.situacao === "abertas", aplicar: { situacao: "abertas", status: [] } },
    { k: "atrasadas", l: "Atrasadas", n: r?.atrasadas, icone: AlarmClock, on: f.situacao === "atrasadas", aplicar: { situacao: "atrasadas", status: [] }, cls: "text-danger-ink" },
    { k: "hoje", l: "Hoje", n: r?.hoje, icone: Clock, on: f.situacao === "hoje", aplicar: { situacao: "hoje", status: [] }, cls: "text-warning-ink" },
    { k: "semana", l: "Esta semana", n: r?.semana, icone: CalendarRange, on: f.situacao === "semana", aplicar: { situacao: "semana", status: [] } },
    { k: "minhas", l: "Minhas", n: r?.minhas, icone: UserRoundCheck, on: f.minhas, aplicar: { minhas: !f.minhas, responsavel_id: "" } },
    { k: "sem_prazo", l: "Sem prazo", n: r?.sem_prazo, icone: CalendarDays, on: f.situacao === "sem_prazo", aplicar: { situacao: "sem_prazo", status: [] } },
    { k: "concluidas", l: "Concluídas em 7 dias", n: r?.concluidas_7d, icone: CheckCircle2, on: f.status.length === 1 && f.status[0] === "concluida", aplicar: { status: ["concluida"], situacao: "" }, cls: "text-success-ink" },
  ];
  const cliente: ClienteEscolhido[] = f.tomador_id ? [{ id: Number(f.tomador_id), nome: f.cliente_nome || `Cliente ${f.tomador_id}` }] : [];

  return (
    <div className={cn(sel.size > 0 && "pb-24")}>
      <PageHeader
        titulo="Tarefas"
        icone={ListTodo}
        migalhas={[{ label: "Cadastros" }, { label: "Tarefas" }]}
        acoes={
          <>
            <Segmented<Visao>
              value={visao}
              onChange={mudarVisao}
              opcoes={[
                { value: "lista", label: "Lista" },
                { value: "quadro", label: "Quadro" },
                { value: "calendario", label: "Calendário" },
              ]}
            />
            {isOperador && (
              <Button onClick={() => setDlg({ t: null })}>
                <Plus /> Nova tarefa
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {chips.map((c) => (
          <button
            key={c.k}
            type="button"
            aria-pressed={c.on}
            onClick={() => (c.on ? setF({ situacao: "", minhas: c.k === "minhas" ? false : f.minhas, status: c.k === "concluidas" ? [] : f.status }) : setF(c.aplicar))}
            className={cn("card-surface flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md", c.on && "ring-2 ring-brand")}
          >
            <c.icone className={cn("size-5 shrink-0", c.cls ?? "text-info-ink")} />
            <span className="min-w-0">
              <span className={cn("block text-xl leading-tight font-semibold tabular-nums", c.k === "atrasadas" && (c.n ?? 0) > 0 && "text-danger-ink")}>{c.n ?? "—"}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{c.l}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="card-surface mb-4 flex flex-wrap items-center gap-2 p-3">
        <SearchInput value={busca} onChange={setBusca} placeholder="Título, descrição, caso ou processo" className="sm:w-72" />
        <Multi rotulo="Situação" valor={f.status} onChange={(v) => setF({ status: v })} opcoes={(Object.keys(STATUS_TAREFA) as StatusTarefa[]).map((k) => ({ v: k, l: STATUS_TAREFA[k].l }))} />
        <Multi rotulo="Prioridade" valor={f.prioridade} onChange={(v) => setF({ prioridade: v })} opcoes={(Object.keys(PRIORIDADE) as PrioridadeTarefa[]).map((k) => ({ v: k, l: PRIORIDADE[k].l, ponto: PRIORIDADE[k].ponto }))} />
        <Multi rotulo="Tipo" valor={f.tipo} onChange={(v) => setF({ tipo: v })} opcoes={(Object.keys(TIPO_TAREFA) as TipoTarefa[]).map((k) => ({ v: k, l: TIPO_TAREFA[k].l }))} />
        <NativeSelect aria-label="Responsável" value={f.minhas ? "eu" : f.responsavel_id} onChange={(e) => (e.target.value === "eu" ? setF({ minhas: true, responsavel_id: "" }) : setF({ minhas: false, responsavel_id: e.target.value }))} className="h-9 w-44">
          <option value="">Todos os responsáveis</option>
          <option value="eu">Minhas</option>
          {profs.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </NativeSelect>
        <div className="w-52">
          <ClientesMulti unico id="tar-cliente" valor={cliente} onChange={(v) => setF({ tomador_id: v[0] ? String(v[0].id) : "", cliente_nome: v[0]?.nome ?? "" })} />
        </div>
        <div className="w-56">
          <CasoCombo id="tar-filtro-caso" value={f.caso_id ? Number(f.caso_id) : null} onChange={(v) => setF({ caso_id: v ? String(v) : "", sem_caso: false })} rotuloVazio="Todos os casos" />
        </div>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm">
          <Checkbox checked={f.sem_caso} onCheckedChange={(v) => setF({ sem_caso: !!v, caso_id: "" })} aria-label="Só tarefas sem caso" /> Sem caso
        </label>
        <div className="flex items-center gap-1">
          <Input type="date" aria-label="Prazo de" value={f.de} onChange={(e) => setF({ de: e.target.value })} className="h-9 w-36" />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" aria-label="Prazo até" value={f.ate} onChange={(e) => setF({ ate: e.target.value })} className="h-9 w-36" />
        </div>
        {(etiquetas.data?.length ?? 0) > 0 && (
          <NativeSelect aria-label="Etiqueta" value={f.etiqueta} onChange={(e) => setF({ etiqueta: e.target.value })} className="h-9 w-40">
            <option value="">Todas as etiquetas</option>
            {etiquetas.data?.map((e) => (
              <option key={e} value={e}>
                #{e}
              </option>
            ))}
          </NativeSelect>
        )}
        {filtrando && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setBusca("");
              router.replace(pathname, { scroll: false });
            }}
          >
            <Eraser /> Limpar filtros
          </Button>
        )}
      </div>

      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : itens.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={ListTodo}
            titulo={filtrando ? "Nenhuma tarefa com esses filtros" : "Nenhuma tarefa ainda"}
            descricao={filtrando ? "Troque ou limpe os filtros." : "Crie tarefas para prazos, audiências, diligências e o dia a dia do escritório."}
            acao={
              filtrando ? (
                <Button variant="outline" onClick={() => router.replace(pathname, { scroll: false })}>
                  <Eraser /> Limpar filtros
                </Button>
              ) : (
                isOperador && (
                  <Button onClick={() => setDlg({ t: null })}>
                    <Plus /> Nova tarefa
                  </Button>
                )
              )
            }
          />
        </div>
      ) : (
        <div className={cn("transition-opacity", q.isFetching && "opacity-70")}>
          {visao === "lista" && <Lista itens={itens} sel={sel} setSel={setSel} onAbrir={(t) => setDlg({ t })} podeEditar={isOperador} />}
          {visao === "quadro" && (
            <>
              <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={comCanceladas} onCheckedChange={(v) => setComCanceladas(!!v)} aria-label="Mostrar canceladas" /> Mostrar canceladas
              </label>
              <Quadro itens={itens} onAbrir={(t) => setDlg({ t })} podeEditar={isOperador} comCanceladas={comCanceladas} />
            </>
          )}
          {visao === "calendario" && <Calendario itens={itens} onAbrir={(t) => setDlg({ t })} onNova={isOperador ? (dia) => setDlg({ t: null, prazo: dia }) : undefined} />}
        </div>
      )}

      {sel.size > 0 && (
        <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-24 pl-4 lg:pl-[calc(var(--sb)+1rem)]">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
            <span className="text-sm">
              <strong className="tabular-nums">{sel.size}</strong> selecionada(s)
            </span>
            <Button size="sm" className="bg-white text-navy hover:bg-white/90" disabled={lote.isPending} onClick={() => lote.mutate({ tipo: "concluir" })}>
              {lote.isPending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Concluir
            </Button>
            <Popover>
              <PopoverTrigger render={<Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" />}>
                <UserRound /> Responsável
              </PopoverTrigger>
              <PopoverContent align="center" className="w-56 gap-0 p-1">
                <button type="button" onClick={() => lote.mutate({ tipo: "responsavel", id: null })} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted">
                  Sem responsável
                </button>
                {profs.data?.map((p) => (
                  <button key={p.id} type="button" onClick={() => lote.mutate({ tipo: "responsavel", id: p.id })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                    <UserAvatar nome={p.nome} className="size-5" textoClassName="text-[8px]" /> {p.nome}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button size="sm" variant="ghost" className="text-red-300 hover:bg-white/10 hover:text-red-200" onClick={() => setExcluirLote(true)}>
              <Trash2 /> Excluir
            </Button>
            <Button size="icon-sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setSel(new Set())} aria-label="Limpar seleção">
              <X />
            </Button>
          </div>
        </motion.div>
      )}

      <TarefaDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        tarefa={dlg?.t ?? null}
        casoId={f.caso_id ? Number(f.caso_id) : null}
        prazoInicial={dlg?.prazo}
      />
      <ConfirmDialog
        open={excluirLote}
        onOpenChange={setExcluirLote}
        titulo={`Excluir ${sel.size} tarefa(s)?`}
        descricao="Os anexos dessas tarefas também são apagados."
        confirmar="Excluir"
        destrutivo
        carregando={lote.isPending}
        onConfirm={() => lote.mutate({ tipo: "excluir" })}
      />
    </div>
  );
}

export default function TarefasPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <Central />
    </Suspense>
  );
}
