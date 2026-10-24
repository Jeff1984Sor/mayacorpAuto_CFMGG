"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, Clock4, Infinity as InfinityIcon, Loader2, Repeat, Save, Timer } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { api, ApiError } from "@/lib/api";
import {
  type Frequencia,
  ROTULO_FREQUENCIA,
  type RegraIn,
  type RegraOut,
  type SimulacaoOut,
  type TabelaOut,
  type Termino,
  type TipoRegra,
} from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE");

const TIPOS: { v: TipoRegra; l: string; d: string; i: React.ComponentType<{ className?: string }> }[] = [
  { v: "fixo", l: "Valor fixo", d: "Um valor numa data", i: CalendarDays },
  { v: "recorrente", l: "Fixo recorrente", d: "Mensalidade, anuidade…", i: Repeat },
  { v: "hora", l: "Por hora", d: "Horas × valor/hora", i: Timer },
];

const vazio = (): RegraIn => ({
  tipo: "recorrente",
  descricao: "",
  valor: null,
  data_pagamento: hoje(),
  frequencia: "mensal",
  intervalo: 1,
  data_inicio: hoje(),
  termino: "sem",
  ocorrencias: 12,
  data_fim: null,
  tabela_preco_id: null,
  ativo: true,
  observacao: null,
});

function deRegra(r: RegraOut): RegraIn {
  return {
    tipo: r.tipo,
    descricao: r.descricao,
    valor: r.valor != null ? toNum(r.valor).toFixed(2).replace(".", ",") : null,
    data_pagamento: r.data_pagamento,
    frequencia: r.frequencia ?? "mensal",
    intervalo: r.intervalo || 1,
    data_inicio: r.data_inicio,
    termino: r.termino,
    ocorrencias: r.ocorrencias ?? 12,
    data_fim: r.data_fim,
    tabela_preco_id: r.tabela_preco_id,
    ativo: r.ativo,
    observacao: r.observacao,
  };
}

/** Corpo enviado ao backend: só os campos que o tipo usa, valor com ponto. */
function corpo(f: RegraIn): RegraIn {
  const valor = f.valor ? String(toNum(f.valor.replace(/\./g, "").replace(",", "."))) : null;
  const base = { ...f, descricao: f.descricao.trim(), observacao: f.observacao?.trim() || null };
  if (f.tipo === "fixo") return { ...base, valor, frequencia: null, data_inicio: null, termino: "sem", ocorrencias: null, data_fim: null, tabela_preco_id: null };
  if (f.tipo === "recorrente")
    return {
      ...base,
      valor,
      data_pagamento: null,
      tabela_preco_id: null,
      ocorrencias: f.termino === "ocorrencias" ? f.ocorrencias : null,
      data_fim: f.termino === "data" ? f.data_fim : null,
    };
  return { ...base, valor: null, data_pagamento: null, frequencia: null, data_inicio: null, termino: "sem", ocorrencias: null, data_fim: null };
}

function mensagem(e: unknown) {
  if (e instanceof ApiError) return e.message.replace(/^body(\.\w+)*:\s*/i, "").replace(/^Value error,\s*/i, "");
  return "Não foi possível calcular.";
}

/** Prévia das parcelas (1ª 10/01/2026 · 2ª 10/02/2026…) */
function Previa({ form }: { form: RegraIn }) {
  const chave = useDebounce(JSON.stringify(corpo(form)), 350);
  const pronto = form.tipo !== "hora" && !!form.valor && (form.tipo === "fixo" ? !!form.data_pagamento : !!form.data_inicio);
  const sim = useQuery({
    queryKey: ["fat", "simular", chave],
    queryFn: () => api.post<SimulacaoOut>("/faturamento/regras/simular", JSON.parse(chave)),
    enabled: pronto && JSON.parse(chave).descricao.length >= 2,
    retry: false,
    meta: { silencioso: true },
    placeholderData: (p) => p,
  });

  if (form.tipo === "hora")
    return (
      <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        <Clock4 className="mb-2 size-6 text-info-ink" />
        Cada hora lançada no timesheet vira um item a faturar: <strong className="text-foreground">horas × valor/hora</strong> da categoria do profissional
        na tabela escolhida.
      </div>
    );
  if (!pronto || form.descricao.trim().length < 2)
    return (
      <div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
        Preencha descrição, valor e datas para ver as parcelas aqui.
      </div>
    );
  if (sim.isError) return <p className="rounded-xl border border-warning/30 bg-warning/8 p-3 text-sm text-warning-ink">{mensagem(sim.error)}</p>;
  if (!sim.data) return <Skeleton className="h-48 rounded-2xl" />;
  const s = sim.data;
  const valor = form.valor ? toNum(form.valor.replace(/\./g, "").replace(",", ".")) : 0;
  return (
    <div className={cn("space-y-3 transition-opacity", sim.isFetching && "opacity-60")}>
      <div className="rounded-2xl brand-gradient p-4 text-white shadow-lg shadow-brand/25">
        <p className="text-[11px] font-semibold tracking-wider text-white/70 uppercase">Resumo</p>
        <p className="mt-0.5 font-semibold">{s.resumo}</p>
        <p className="mt-2 text-sm text-white/80">
          {s.total_parcelas ? (
            <>
              {s.total_parcelas} parcela{s.total_parcelas > 1 ? "s" : ""} · total <strong className="text-white">{moeda(valor * s.total_parcelas)}</strong>
            </>
          ) : (
            <span className="inline-flex items-center gap-1">
              <InfinityIcon className="size-4" /> sem término · {moeda(valor)} por parcela
            </span>
          )}
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Parcelas {s.parcelas.length >= 60 && "(primeiras 60)"}
        </p>
        <ol className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-1 overflow-y-auto pr-1">
          {s.parcelas.map((p, i) => (
            <motion.li
              key={`${p.n}-${p.data}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.015 }}
              className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs"
            >
              <span className="font-semibold text-info-ink tabular-nums">{p.n}ª</span>
              <span className="font-mono tabular-nums">{data(p.data)}</span>
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function RegraDialog({
  open,
  onOpenChange,
  contratoId,
  casoId,
  regra,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contratoId?: number;
  casoId?: number;
  regra?: RegraOut | null;
  onSalvo?: (r: RegraOut) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<RegraIn>(vazio);
  const tabelas = useQuery({ queryKey: ["fat", "tabelas"], queryFn: () => api.get<TabelaOut[]>("/faturamento/tabelas"), enabled: open });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega a regra ao abrir */
  useEffect(() => {
    if (open) setF(regra ? deRegra(regra) : vazio());
  }, [open, regra]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof RegraIn>(k: K, v: RegraIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const freq = (f.frequencia ?? "mensal") as Frequencia;
  const un = ROTULO_FREQUENCIA[freq].unidade;

  const salvar = useMutation({
    mutationFn: () => {
      const body = corpo(f);
      if (regra) return api.put<RegraOut>(`/faturamento/regras/${regra.id}`, body);
      return casoId ? api.post<RegraOut>(`/faturamento/casos/${casoId}/regras`, body) : api.post<RegraOut>(`/faturamento/contratos/${contratoId}/regras`, body);
    },
    onSuccess: (r) => {
      toast.success(regra ? "Regra atualizada" : "Regra criada", { description: r.resumo });
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(r);
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <div className="flex items-center gap-3 border-b px-5 py-3.5 pr-12">
          <span className="grid size-9 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/30">
            <CalendarClock className="size-[18px]" />
          </span>
          <div>
            <DialogTitle className="text-base">{regra ? "Editar regra de cobrança" : "Nova regra de cobrança"}</DialogTitle>
            <DialogDescription className="text-xs">
              {casoId ? "Vale só para este caso e substitui a regra do contrato." : "Vale para todos os casos do contrato que não tiverem regra própria."}
            </DialogDescription>
          </div>
        </div>

        <form
          className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
          onSubmit={(e) => {
            e.preventDefault();
            salvar.mutate();
          }}
        >
          <div className="space-y-5 p-5">
            <div role="radiogroup" aria-label="Tipo de cobrança" className="grid grid-cols-3 gap-2">
              {TIPOS.map((t) => {
                const on = f.tipo === t.v;
                return (
                  <button
                    key={t.v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set("tipo", t.v)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all",
                      on ? "border-brand bg-brand/8 ring-1 ring-brand/40" : "hover:border-brand/40",
                    )}
                  >
                    <t.i className={cn("size-5", on ? "text-info-ink" : "text-muted-foreground")} />
                    <span className="text-sm font-semibold">{t.l}</span>
                    <span className="text-[11px] text-muted-foreground">{t.d}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
              <Field label="Descrição" obrigatorio htmlFor="regra-descricao">
                <Input id="regra-descricao" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="ex.: Mensalidade do contencioso" autoFocus />
              </Field>
              {f.tipo !== "hora" && (
                <Field label="Valor (R$)" obrigatorio htmlFor="regra-valor">
                  <Input id="regra-valor" inputMode="decimal" value={f.valor ?? ""} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" className="font-mono" />
                </Field>
              )}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {f.tipo === "fixo" && (
                <motion.div key="fixo" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Field label="Data de pagamento" obrigatorio htmlFor="regra-data-pagamento" className="max-w-56">
                    <Input id="regra-data-pagamento" type="date" value={f.data_pagamento ?? ""} onChange={(e) => set("data_pagamento", e.target.value || null)} />
                  </Field>
                </motion.div>
              )}

              {f.tipo === "recorrente" && (
                <motion.div key="rec" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  <fieldset className="rounded-2xl border p-4">
                    <legend className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Padrão de recorrência</legend>
                    <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
                      <div role="radiogroup" aria-label="Frequência" className="space-y-1 sm:border-r sm:pr-4">
                        {(Object.keys(ROTULO_FREQUENCIA) as Frequencia[]).map((k) => (
                          <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm", freq === k && "bg-brand/10 font-medium")}>
                            <input type="radio" name="frequencia" checked={freq === k} onChange={() => set("frequencia", k)} className="accent-[var(--brand)]" />
                            {ROTULO_FREQUENCIA[k].nome}
                          </label>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 self-start pt-1 text-sm">
                        <label htmlFor="regra-intervalo">A cada</label>
                        <Input
                          id="regra-intervalo"
                          type="number"
                          min={1}
                          max={99}
                          value={f.intervalo}
                          onChange={(e) => set("intervalo", Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                          className="h-8 w-16 text-center font-mono"
                        />
                        <span>{f.intervalo === 1 ? un[0] : un[1]}</span>
                        <p className="w-full text-xs text-muted-foreground">
                          {freq === "mensal" && "No mesmo dia do mês da data de início (dia 31 vira o último dia em meses menores)."}
                          {freq === "semanal" && "No mesmo dia da semana da data de início."}
                          {freq === "anual" && "No mesmo dia e mês da data de início."}
                          {freq === "diaria" && "Todos os dias a partir da data de início."}
                        </p>
                      </div>
                    </div>
                  </fieldset>

                  <fieldset className="rounded-2xl border p-4">
                    <legend className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Intervalo de recorrência</legend>
                    <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
                      <Field label="Começa em" obrigatorio htmlFor="regra-inicio">
                        <Input id="regra-inicio" type="date" value={f.data_inicio ?? ""} onChange={(e) => set("data_inicio", e.target.value || null)} />
                      </Field>
                      <div role="radiogroup" aria-label="Término" className="space-y-2 text-sm">
                        {(
                          [
                            ["sem", "Sem data de término"],
                            ["ocorrencias", "Termina após"],
                            ["data", "Termina em"],
                          ] as [Termino, string][]
                        ).map(([v, l]) => (
                          <label key={v} className={cn("flex min-h-9 cursor-pointer flex-wrap items-center gap-2 rounded-lg px-2 py-1", f.termino === v && "bg-brand/10")}>
                            <input type="radio" name="termino" checked={f.termino === v} onChange={() => set("termino", v)} className="accent-[var(--brand)]" />
                            <span className={cn(f.termino === v && "font-medium")}>{l}</span>
                            {v === "ocorrencias" && (
                              <>
                                <Input
                                  aria-label="Quantidade de parcelas"
                                  type="number"
                                  min={1}
                                  max={999}
                                  value={f.ocorrencias ?? ""}
                                  disabled={f.termino !== "ocorrencias"}
                                  onChange={(e) => set("ocorrencias", e.target.value ? Number(e.target.value) : null)}
                                  className="h-8 w-20 text-center font-mono"
                                />
                                <span>ocorrências</span>
                              </>
                            )}
                            {v === "data" && (
                              <Input
                                aria-label="Data de término"
                                type="date"
                                value={f.data_fim ?? ""}
                                min={f.data_inicio ?? undefined}
                                disabled={f.termino !== "data"}
                                onChange={(e) => set("data_fim", e.target.value || null)}
                                className="h-8 w-40"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  </fieldset>
                </motion.div>
              )}

              {f.tipo === "hora" && (
                <motion.div key="hora" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Field
                    label="Tabela de preço"
                    htmlFor="regra-tabela"
                    dica={
                      <>
                        Vazio = usa a tabela do caso e, se não houver, a do contrato. O valor/hora vem do cargo de quem lançou.{" "}
                        <Link href="/configuracoes/faturamento" className="text-info-ink hover:underline">
                          Gerenciar tabelas
                        </Link>
                      </>
                    }
                  >
                    <NativeSelect id="regra-tabela" value={f.tabela_preco_id ?? ""} onChange={(e) => set("tabela_preco_id", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">A do caso ou do contrato</option>
                      {tabelas.data?.filter((t) => t.ativo || t.id === f.tabela_preco_id).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nome} ({t.itens.length} cargo{t.itens.length === 1 ? "" : "s"})
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </motion.div>
              )}
            </AnimatePresence>

            <Field label="Observação interna" htmlFor="regra-obs">
              <Textarea id="regra-obs" rows={2} value={f.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} />
            </Field>
          </div>

          <aside className="border-t bg-muted/30 p-5 md:border-t-0 md:border-l">
            <p className="mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Prévia</p>
            <Previa form={f} />
          </aside>
        </form>

        <div className="flex items-center justify-between gap-3 border-t bg-card px-5 py-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Regra ativa" /> Ativa
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || f.descricao.trim().length < 2}>
              {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar regra
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
