"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Gavel, Landmark, MessageSquare, MoreHorizontal, Newspaper, Pencil, Plus, Scale, ScrollText, StickyNote, Trash2, Users } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AndamentoIn, AndamentoOut, TipoAndamento } from "@/lib/faturamento";
import { data, relativo } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useProfissionais } from "./dialogos";
import { EnriquecerIA } from "./horas-input";

export const TIPO_ANDAMENTO: Record<TipoAndamento, { l: string; icone: React.ComponentType<{ className?: string }>; cor: string }> = {
  andamento: { l: "Andamento", icone: ScrollText, cor: "bg-brand/12 text-info-ink ring-brand/25" },
  publicacao: { l: "Publicação", icone: Newspaper, cor: "bg-sky-500/12 text-sky-700 ring-sky-500/25 dark:text-sky-300" },
  despacho: { l: "Despacho", icone: FileText, cor: "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-300" },
  decisao: { l: "Decisão", icone: Gavel, cor: "bg-warning/14 text-warning-ink ring-warning/30" },
  sentenca: { l: "Sentença", icone: Scale, cor: "bg-danger/10 text-danger-ink ring-danger/25" },
  audiencia: { l: "Audiência", icone: Landmark, cor: "bg-success/10 text-success-ink ring-success/25" },
  reuniao: { l: "Reunião", icone: Users, cor: "bg-teal-500/12 text-teal-700 ring-teal-500/25 dark:text-teal-300" },
  nota: { l: "Nota interna", icone: StickyNote, cor: "bg-muted text-muted-foreground ring-border" },
};
const COM_PRAZO: TipoAndamento[] = ["audiencia"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const hoje = () => new Date().toLocaleDateString("sv-SE");
const vazio = (): AndamentoIn => ({ data: hoje(), tipo: "andamento", titulo: "", descricao: null, prazo: null, concluido: false, responsavel_id: null });

function AndamentoDialog({ open, onOpenChange, casoId, andamento }: { open: boolean; onOpenChange: (o: boolean) => void; casoId: number; andamento: AndamentoOut | null }) {
  const qc = useQueryClient();
  const profs = useProfissionais(open);
  const [f, setF] = useState<AndamentoIn>(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      andamento
        ? { data: andamento.data, tipo: andamento.tipo, titulo: andamento.titulo, descricao: andamento.descricao, prazo: andamento.prazo, concluido: andamento.concluido, responsavel_id: andamento.responsavel_id }
        : vazio(),
    );
  }, [open, andamento]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof AndamentoIn>(k: K, v: AndamentoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body = { ...f, titulo: f.titulo.trim(), descricao: f.descricao?.trim() || null };
      return andamento ? api.put(`/faturamento/andamentos/${andamento.id}`, body) : api.post(`/faturamento/casos/${casoId}/andamentos`, body);
    },
    onSuccess: () => {
      toast.success(andamento ? "Andamento atualizado" : "Andamento registrado");
      qc.invalidateQueries({ queryKey: ["fat"] });
      onOpenChange(false);
    },
  });
  const comPrazo = COM_PRAZO.includes(f.tipo) || !!f.prazo;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={andamento ? "Editar andamento" : "Novo andamento"}
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (f.titulo.trim().length < 2) return toast.error("Informe o título.");
        salvar.mutate();
      }}
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Tipo" className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {(Object.entries(TIPO_ANDAMENTO) as [TipoAndamento, (typeof TIPO_ANDAMENTO)[TipoAndamento]][]).map(([k, t]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.tipo === k}
              onClick={() => set("tipo", k)}
              className={cn("flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs transition", f.tipo === k ? "border-brand bg-brand/8 font-medium" : "text-muted-foreground hover:border-brand/40")}
            >
              <span className={cn("grid size-7 place-items-center rounded-lg ring-1", t.cor)}>
                <t.icone className="size-3.5" />
              </span>
              {t.l}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Título" obrigatorio htmlFor="and-titulo" className="sm:col-span-4">
            <Input id="and-titulo" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} maxLength={200} autoFocus placeholder="ex.: Juntada de contestação" />
          </Field>
          <Field label="Data" htmlFor="and-data" className="sm:col-span-2">
            <Input id="and-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
          {comPrazo && (
            <Field label="Data da audiência" htmlFor="and-prazo" className="sm:col-span-2">
              <Input id="and-prazo" type="date" value={f.prazo ?? ""} onChange={(e) => set("prazo", e.target.value || null)} />
            </Field>
          )}
          <Field label="Responsável" htmlFor="and-resp" className={comPrazo ? "sm:col-span-2" : "sm:col-span-3"}>
            <NativeSelect id="and-resp" value={f.responsavel_id ?? ""} onChange={(e) => set("responsavel_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {profs.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {comPrazo && (
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
              <Checkbox checked={f.concluido} onCheckedChange={(v) => set("concluido", !!v)} aria-label="Concluído" /> Concluído
            </label>
          )}
          <Field label="Descrição" htmlFor="and-desc" className="sm:col-span-6">
            <Textarea id="and-desc" rows={5} value={f.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} />
            <EnriquecerIA
              className="mt-1.5"
              valor={{ titulo: f.titulo, descricao: f.descricao ?? "" }}
              onChange={(v) => setF((o) => ({ ...o, titulo: v.titulo ?? o.titulo, descricao: v.descricao }))}
              corpo={() => ({ tipo: "andamento", texto: (f.descricao ?? "").trim() || f.titulo, titulo: f.titulo, tipo_andamento: f.tipo, caso_id: casoId })}
            />
          </Field>
        </div>
      </div>
    </FormDialog>
  );
}

function BadgePrazo({ a }: { a: AndamentoOut }) {
  if (!a.prazo) return null;
  const cls = a.concluido ? "bg-success/10 text-success-ink" : a.atrasado ? "bg-danger/12 text-danger-ink" : "bg-warning/12 text-warning-ink";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      <CalendarClock className="size-3" />
      {a.concluido ? "concluído" : a.atrasado ? "atrasado" : a.tipo === "audiencia" ? "audiência" : "prazo"} · {data(a.prazo)}
    </span>
  );
}

export function AndamentosCaso({ casoId }: { casoId: number }) {
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const q = useQuery({ queryKey: ["fat", "andamentos", casoId], queryFn: () => api.get<AndamentoOut[]>(`/faturamento/casos/${casoId}/andamentos`) });
  const [filtro, setFiltro] = useState<TipoAndamento | "pendentes" | null>(null);
  const [dlg, setDlg] = useState<{ a: AndamentoOut | null } | null>(null);
  const [excluir, setExcluir] = useState<AndamentoOut | null>(null);
  const concluir = useMutation({
    mutationFn: (a: AndamentoOut) =>
      api.put(`/faturamento/andamentos/${a.id}`, { data: a.data, tipo: a.tipo, titulo: a.titulo, descricao: a.descricao, prazo: a.prazo, concluido: !a.concluido, responsavel_id: a.responsavel_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fat"] }),
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/andamentos/${id}`),
    onSuccess: () => {
      toast.success("Andamento excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const todos = [...(q.data ?? [])].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
  const pendentes = todos.filter((a) => a.prazo && !a.concluido);
  const lista = filtro === "pendentes" ? pendentes : filtro ? todos.filter((a) => a.tipo === filtro) : todos;
  const tipos = [...new Set(todos.map((a) => a.tipo))];
  const grupos: { mes: string; itens: AndamentoOut[] }[] = [];
  lista.forEach((a) => {
    const k = a.data.slice(0, 7);
    const g = grupos.at(-1);
    if (g && g.mes === k) g.itens.push(a);
    else grupos.push({ mes: k, itens: [a] });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
          <button
            type="button"
            onClick={() => setFiltro(null)}
            aria-pressed={!filtro}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", !filtro ? "border-brand bg-brand/10 text-info-ink" : "text-muted-foreground hover:border-brand/40")}
          >
            Todos ({todos.length})
          </button>
          {pendentes.length > 0 && (
            <button
              type="button"
              onClick={() => setFiltro(filtro === "pendentes" ? null : "pendentes")}
              aria-pressed={filtro === "pendentes"}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", filtro === "pendentes" ? "border-danger bg-danger/10 text-danger-ink" : "text-danger-ink hover:border-danger/40")}
            >
              Prazos em aberto ({pendentes.length})
            </button>
          )}
          {tipos.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltro(filtro === t ? null : t)}
              aria-pressed={filtro === t}
              className={cn("rounded-full border px-3 py-1 text-xs transition", filtro === t ? "border-brand bg-brand/10 font-medium text-info-ink" : "text-muted-foreground hover:border-brand/40")}
            >
              {TIPO_ANDAMENTO[t].l}
            </button>
          ))}
        </div>
        {isOperador && todos.length > 0 && (
          <Button className="ml-auto" onClick={() => setDlg({ a: null })}>
            <Plus /> Novo andamento
          </Button>
        )}
      </div>

      {q.isPending ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : todos.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={MessageSquare}
            titulo="Nenhum andamento"
            descricao="Registre publicações, decisões, audiências e notas internas do caso. Prazos agora ficam em Tarefas."
            acao={
              isOperador && (
                <Button onClick={() => setDlg({ a: null })}>
                  <Plus /> Registrar o primeiro
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grupos.map((g) => (
            <section key={g.mes} aria-label={g.mes}>
              <h3 className="sticky top-[calc(var(--tb,52px)+0.5rem)] z-10 mb-3 inline-block rounded-full bg-background/90 px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase ring-1 ring-border backdrop-blur">
                {MESES[Number(g.mes.slice(5)) - 1]} de {g.mes.slice(0, 4)}
              </h3>
              <ol className="relative ml-4 space-y-3 border-l pl-6">
                {g.itens.map((a, i) => {
                  const t = TIPO_ANDAMENTO[a.tipo];
                  return (
                    <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} className="relative">
                      <span className={cn("absolute top-3 -left-[39px] grid size-7 place-items-center rounded-full ring-4 ring-background", t.cor)}>
                        <t.icone className="size-3.5" />
                      </span>
                      <article className={cn("card-surface group p-3.5", a.atrasado && !a.concluido && "border-danger/40")}>
                        <header className="flex flex-wrap items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="font-mono">{data(a.data)}</span>·<span className="font-medium">{t.l}</span>
                              {a.responsavel_nome && <>· {a.responsavel_nome}</>}
                            </p>
                            <h4 className={cn("mt-0.5 font-medium", a.concluido && "text-muted-foreground line-through")}>{a.titulo}</h4>
                          </div>
                          <BadgePrazo a={a} />
                          {isOperador && a.prazo && (
                            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Checkbox checked={a.concluido} onCheckedChange={() => concluir.mutate(a)} aria-label={`Concluir ${a.titulo}`} /> concluir
                            </label>
                          )}
                          {isOperador && (
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${a.titulo}`} className="opacity-60 group-hover:opacity-100" />}>
                                <MoreHorizontal />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setDlg({ a })}>
                                  <Pencil /> Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onClick={() => setExcluir(a)}>
                                  <Trash2 /> Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </header>
                        {a.descricao && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{a.descricao}</p>}
                        {a.criado_por && (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            por {a.criado_por} · {relativo(a.criado_em)}
                          </p>
                        )}
                      </article>
                    </motion.li>
                  );
                })}
              </ol>
            </section>
          ))}
          {lista.length === 0 && <p className="text-sm text-muted-foreground">Nenhum andamento com este filtro.</p>}
        </div>
      )}
      <AndamentoDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} casoId={casoId} andamento={dlg?.a ?? null} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este andamento?"
        descricao={excluir ? `${TIPO_ANDAMENTO[excluir.tipo].l} de ${data(excluir.data)}: ${excluir.titulo}` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
