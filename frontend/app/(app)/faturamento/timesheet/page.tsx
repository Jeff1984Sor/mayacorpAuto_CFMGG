"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Clock, Eraser, FileSpreadsheet, Gauge, Lock, Pencil, Plus, Receipt, Timer, Trash2, Wallet } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { ChartCard, EIXO, GRADE, TooltipCaixa } from "@/components/dashboard/ui";
import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { useProfissionais } from "@/components/faturamento/dialogos";
import { EnriquecerIA, erroHoras, HorasInput, minutosDe } from "@/components/faturamento/horas-input";
import { CasoCombo, useCasosSelect } from "@/components/faturamento/tarefas";
import { Stat } from "@/components/financeiro/ui";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput, Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hhmm } from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Linha {
  id: number;
  data: string;
  minutos: number;
  descricao: string;
  faturavel: boolean;
  faturado: boolean;
  fatura_codigo: string | null;
  profissional_id: number;
  profissional_nome: string;
  cargo_nome: string | null;
  caso_id: number;
  caso_numero: number;
  caso_titulo: string;
  contrato_id: number;
  contrato_nome: string;
  cliente_id: number;
  cliente_nome: string;
  valor_hora: string | null;
  valor: string | null;
}
interface Grupo {
  id: number;
  nome: string;
  minutos: number;
  minutos_faturaveis: number;
  valor: string;
  lancamentos: number;
}
interface Central {
  itens: Linha[];
  resumo: {
    de: string;
    ate: string;
    lancamentos: number;
    minutos: number;
    minutos_faturaveis: number;
    minutos_nao_faturaveis: number;
    minutos_faturados: number;
    minutos_a_faturar: number;
    valor_a_faturar: string;
    valor_faturado: string;
    sem_valor_hora: number;
    aproveitamento: number;
    meus_minutos_hoje: number;
    meus_minutos_semana: number;
  };
  por_profissional: Grupo[];
  por_cliente: Grupo[];
  por_dia: { data: string; minutos: number }[];
}

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const hojeIso = () => iso(new Date());
const h = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (s: string) => DIAS[new Date(`${s}T00:00:00`).getDay()];

function preset(nome: string) {
  const d = new Date();
  if (nome === "hoje") return { de: hojeIso(), ate: hojeIso() };
  if (nome === "semana") {
    const seg = new Date(d);
    seg.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return { de: iso(seg), ate: hojeIso() };
  }
  if (nome === "passado") return { de: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), ate: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
  return { de: iso(new Date(d.getFullYear(), d.getMonth(), 1)), ate: hojeIso() };
}
const PRESETS = [
  { k: "hoje", l: "Hoje" },
  { k: "semana", l: "Esta semana" },
  { k: "mes", l: "Este mês" },
  { k: "passado", l: "Mês passado" },
];

// ---------------------------------------------------------------- lançar horas
function LancarHoras() {
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const profs = useProfissionais();
  const casos = useCasosSelect();
  const [f, setF] = useState({ caso_id: null as number | null, profissional_id: "", data: hojeIso(), horas: "", descricao: "", faturavel: true });
  const [tentou, setTentou] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- profissional padrão = eu */
  useEffect(() => {
    if (usuario && !f.profissional_id) setF((o) => ({ ...o, profissional_id: String(usuario.id) }));
  }, [usuario, f.profissional_id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const caso = casos.data?.find((c) => c.id === f.caso_id);
  const prof = profs.data?.find((p) => String(p.id) === f.profissional_id);
  const minutos = minutosDe(f.horas);
  const salvar = useMutation({
    mutationFn: () =>
      api.post(`/faturamento/casos/${f.caso_id}/timesheet`, {
        profissional_id: f.profissional_id ? Number(f.profissional_id) : null,
        data: f.data,
        minutos,
        descricao: f.descricao.trim(),
        faturavel: f.faturavel,
      }),
    onSuccess: () => {
      toast.success(`${hhmm(minutos)} lançadas`, { description: caso ? `#${caso.numero} ${caso.titulo}` : undefined });
      setF((o) => ({ ...o, horas: "", descricao: "" }));
      setTentou(false);
      qc.invalidateQueries({ queryKey: ["fat"] });
      setTimeout(() => document.getElementById("lh-horas")?.focus(), 0);
    },
  });
  const avisos: string[] = [];
  if (caso && !caso.tabela_preco_efetiva) avisos.push("Este caso não tem tabela de preço: as horas entram sem valor/hora.");
  if (prof && !prof.cargo_nome) avisos.push(`${prof.nome} está sem cargo: sem valor/hora na tabela de preço.`);

  return (
    <section className="card-surface relative mb-5 overflow-hidden" aria-labelledby="lh-t">
      <div className="pointer-events-none absolute -top-20 -right-16 size-60 rounded-full bg-brand/15 blur-3xl" />
      <form
        className="relative p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setTentou(true);
          if (!f.caso_id) return toast.error("Escolha o caso.");
          if (erroHoras(f.horas)) return;
          if (f.descricao.trim().length < 2) return toast.error("Descreva o que foi feito.");
          salvar.mutate();
        }}
      >
        <h2 id="lh-t" className="mb-4 flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-lg brand-gradient text-white shadow-md shadow-brand/30">
            <Timer className="size-4" />
          </span>
          Lançar horas
        </h2>
        <div className="grid gap-3 lg:grid-cols-12">
          <Field label="Caso" obrigatorio htmlFor="lh-caso" className="lg:col-span-5" erro={tentou && !f.caso_id ? "Escolha o caso." : undefined}>
            <CasoCombo id="lh-caso" value={f.caso_id} onChange={(v) => setF({ ...f, caso_id: v })} rotuloVazio="Escolha o caso…" />
          </Field>
          <Field label="Profissional" htmlFor="lh-prof" className="lg:col-span-3">
            <NativeSelect id="lh-prof" value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })}>
              {profs.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {!p.acesso_sistema ? " (sem acesso)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Data" htmlFor="lh-data" className="lg:col-span-2">
            <Input id="lh-data" type="date" value={f.data} max={hojeIso()} onChange={(e) => setF({ ...f, data: e.target.value })} />
          </Field>
          <Field label="Horas" obrigatorio htmlFor="lh-horas" className="lg:col-span-2">
            <HorasInput id="lh-horas" value={f.horas} onChange={(v) => setF({ ...f, horas: v })} mostrarErro={tentou} />
          </Field>
          <Field label="Descrição" obrigatorio htmlFor="lh-desc" className="lg:col-span-12">
            <Textarea id="lh-desc" rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="O que foi feito, como vai aparecer na fatura" />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <EnriquecerIA valor={{ descricao: f.descricao }} onChange={(v) => setF((o) => ({ ...o, descricao: v.descricao }))} corpo={() => ({ tipo: "timesheet", texto: f.descricao, caso_id: f.caso_id, minutos })} />
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.faturavel} onCheckedChange={(v) => setF({ ...f, faturavel: v })} aria-label="Faturável" /> Faturável
          </label>
          {avisos.map((a) => (
            <span key={a} className="inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-xs text-warning-ink">
              <AlertTriangle className="size-3.5" /> {a}
            </span>
          ))}
          <Button type="submit" className="ml-auto" disabled={salvar.isPending}>
            <Plus /> Lançar
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- editar
function EditarDialog({ linha, onClose }: { linha: Linha | null; onClose: () => void }) {
  const qc = useQueryClient();
  const profs = useProfissionais(!!linha);
  const [f, setF] = useState({ profissional_id: "", data: "", horas: "", descricao: "", faturavel: true });
  const [tentou, setTentou] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (linha) setF({ profissional_id: String(linha.profissional_id), data: linha.data, horas: hhmm(linha.minutos), descricao: linha.descricao, faturavel: linha.faturavel });
    setTentou(false);
  }, [linha]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () =>
      api.put(`/faturamento/timesheet/${linha!.id}`, {
        profissional_id: Number(f.profissional_id),
        data: f.data,
        minutos: minutosDe(f.horas),
        descricao: f.descricao.trim(),
        faturavel: f.faturavel,
      }),
    onSuccess: () => {
      toast.success("Lançamento atualizado");
      qc.invalidateQueries({ queryKey: ["fat"] });
      onClose();
    },
  });
  return (
    <FormDialog
      open={!!linha}
      onOpenChange={(o) => !o && onClose()}
      titulo="Editar horas"
      descricao={linha ? `#${linha.caso_numero} ${linha.caso_titulo} · ${linha.cliente_nome}` : undefined}
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        setTentou(true);
        if (erroHoras(f.horas)) return;
        if (f.descricao.trim().length < 2) return toast.error("Descreva o que foi feito.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Profissional" htmlFor="ed-prof" className="sm:col-span-3">
          <NativeSelect id="ed-prof" value={f.profissional_id} onChange={(e) => setF({ ...f, profissional_id: e.target.value })}>
            {profs.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Data" htmlFor="ed-data" className="sm:col-span-2">
          <Input id="ed-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Field>
        <Field label="Horas" htmlFor="ed-horas" className="sm:col-span-1">
          <HorasInput id="ed-horas" value={f.horas} onChange={(v) => setF({ ...f, horas: v })} mostrarErro={tentou} />
        </Field>
        <Field label="Descrição" htmlFor="ed-desc" className="sm:col-span-6">
          <Textarea id="ed-desc" rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <Switch checked={f.faturavel} onCheckedChange={(v) => setF({ ...f, faturavel: v })} aria-label="Faturável" /> Faturável
        </label>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------- página
function TimesheetCentral() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const profs = useProfissionais();
  const padrao = preset("mes");
  const f = {
    de: sp.get("de") ?? padrao.de,
    ate: sp.get("ate") ?? padrao.ate,
    profissional_id: sp.get("profissional_id") ?? "",
    minhas: sp.get("minhas") === "true",
    tomador_id: sp.get("tomador_id") ?? "",
    cliente_nome: sp.get("cliente_nome") ?? "",
    caso_id: sp.get("caso_id") ?? "",
    faturavel: sp.get("faturavel") ?? "",
    situacao: sp.get("situacao") ?? "",
    q: sp.get("q") ?? "",
  };
  type F = typeof f;
  const setF = (mud: Partial<F>) => {
    const n = { ...f, ...mud };
    const u = new URLSearchParams();
    Object.entries(n).forEach(([k, v]) => {
      if (v === true) u.set(k, "true");
      else if (v) u.set(k, String(v));
    });
    router.replace(`${pathname}?${u}`, { scroll: false });
  };
  const [busca, setBusca] = useState(f.q);
  const buscaDeb = useDebounce(busca, 350);
  useEffect(() => {
    if (buscaDeb !== f.q) setF({ q: buscaDeb });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando a busca muda
  }, [buscaDeb]);
  const [visao, setVisao] = useState<"lista" | "semana">("lista");
  const [editar, setEditar] = useState<Linha | null>(null);
  const [excluir, setExcluir] = useState<Linha | null>(null);
  const [filtroDia, setFiltroDia] = useState<{ prof: number; dia: string } | null>(null);

  const params = {
    de: f.de,
    ate: f.ate,
    profissional_id: f.profissional_id || undefined,
    minhas: f.minhas || undefined,
    tomador_id: f.tomador_id || undefined,
    caso_id: f.caso_id || undefined,
    faturavel: f.faturavel || undefined,
    situacao: f.situacao || undefined,
    q: f.q || undefined,
  };
  const q = useQuery({ queryKey: ["fat", "timesheet-central", params], queryFn: () => api.get<Central>("/faturamento/timesheet", params), placeholderData: (p) => p });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/timesheet/${id}`),
    onSuccess: () => {
      toast.success("Lançamento excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const r = q.data?.resumo;
  const itens = useMemo(() => (q.data?.itens ?? []).filter((x) => !filtroDia || (x.profissional_id === filtroDia.prof && x.data === filtroDia.dia)), [q.data, filtroDia]);
  const porDia = useMemo(() => {
    const g = new Map<string, Linha[]>();
    itens.forEach((x) => g.set(x.data, [...(g.get(x.data) ?? []), x]));
    return [...g.entries()];
  }, [itens]);
  const presetAtivo = PRESETS.find((p) => {
    const x = preset(p.k);
    return x.de === f.de && x.ate === f.ate;
  })?.k;
  const filtrando = !!(f.profissional_id || f.minhas || f.tomador_id || f.caso_id || f.faturavel || f.situacao || f.q);
  const cliente: ClienteEscolhido[] = f.tomador_id ? [{ id: Number(f.tomador_id), nome: f.cliente_nome || "Cliente" }] : [];

  // semana: profissionais × dias do período (até 7 dias a partir do início)
  const semana = useMemo(() => {
    const dias: string[] = [];
    const ini = new Date(`${f.de}T00:00:00`);
    for (let i = 0; i < 7; i++) {
      const d = new Date(ini);
      d.setDate(ini.getDate() + i);
      if (iso(d) > f.ate) break;
      dias.push(iso(d));
    }
    const profsMap = new Map<number, { nome: string; dias: Record<string, number>; total: number }>();
    (q.data?.itens ?? []).forEach((x) => {
      if (!dias.includes(x.data)) return;
      const p = profsMap.get(x.profissional_id) ?? { nome: x.profissional_nome, dias: {}, total: 0 };
      p.dias[x.data] = (p.dias[x.data] ?? 0) + x.minutos;
      p.total += x.minutos;
      profsMap.set(x.profissional_id, p);
    });
    return { dias, linhas: [...profsMap.entries()] };
  }, [q.data, f.de, f.ate]);

  const grafDia = (q.data?.por_dia ?? []).map((d) => ({ ...d, rot: `${d.data.slice(8)}/${d.data.slice(5, 7)}`, horas: d.minutos / 60 }));

  return (
    <div>
      <PageHeader
        titulo="Timesheet"
        icone={Clock}
        migalhas={[{ label: "Cadastros" }, { label: "Timesheet" }]}
        acoes={
          <>
            {r && (
              <span className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm">
                <span className="text-muted-foreground">Hoje:</span> <strong className="font-mono tabular-nums">{h(r.meus_minutos_hoje)}</strong>
                <span className="text-muted-foreground">· Semana:</span> <strong className="font-mono tabular-nums">{h(r.meus_minutos_semana)}</strong>
              </span>
            )}
            <Button variant="outline" onClick={() => baixar("/faturamento/timesheet/exportar.xlsx", { query: params }, "timesheet.xlsx")}>
              <FileSpreadsheet /> Exportar
            </Button>
          </>
        }
      />

      {isOperador && <LancarHoras />}

      <div className="card-surface mb-5 flex flex-wrap items-center gap-2 p-3">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.k}
              type="button"
              aria-pressed={presetAtivo === p.k}
              onClick={() => setF(preset(p.k))}
              className={cn("h-8 rounded-md px-3 text-sm font-medium text-muted-foreground transition", presetAtivo === p.k && "bg-card text-foreground shadow-sm ring-1 ring-border")}
            >
              {p.l}
            </button>
          ))}
        </div>
        <Input type="date" aria-label="De" value={f.de} onChange={(e) => e.target.value && setF({ de: e.target.value })} className="h-9 w-36" />
        <span className="text-xs text-muted-foreground">até</span>
        <Input type="date" aria-label="Até" value={f.ate} min={f.de} onChange={(e) => e.target.value && setF({ ate: e.target.value })} className="h-9 w-36" />
        <NativeSelect aria-label="Profissional" value={f.minhas ? "eu" : f.profissional_id} onChange={(e) => (e.target.value === "eu" ? setF({ minhas: true, profissional_id: "" }) : setF({ minhas: false, profissional_id: e.target.value }))} className="h-9 w-44">
          <option value="">Todos os profissionais</option>
          <option value="eu">Minhas horas</option>
          {profs.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </NativeSelect>
        <div className="w-52">
          <ClientesMulti unico id="ts-cliente" valor={cliente} onChange={(v) => setF({ tomador_id: v[0] ? String(v[0].id) : "", cliente_nome: v[0]?.nome ?? "" })} />
        </div>
        <div className="w-56">
          <CasoCombo id="ts-filtro-caso" value={f.caso_id ? Number(f.caso_id) : null} onChange={(v) => setF({ caso_id: v ? String(v) : "" })} rotuloVazio="Todos os casos" />
        </div>
        <NativeSelect aria-label="Faturável" value={f.faturavel} onChange={(e) => setF({ faturavel: e.target.value })} className="h-9 w-36">
          <option value="">Faturável e não</option>
          <option value="true">Só faturáveis</option>
          <option value="false">Só não faturáveis</option>
        </NativeSelect>
        <NativeSelect aria-label="Situação" value={f.situacao} onChange={(e) => setF({ situacao: e.target.value })} className="h-9 w-36">
          <option value="">Toda situação</option>
          <option value="a_faturar">A faturar</option>
          <option value="faturadas">Faturadas</option>
        </NativeSelect>
        <SearchInput value={busca} onChange={setBusca} placeholder="Descrição, caso ou contrato" className="sm:w-60" />
        {filtrando && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setBusca("");
              setFiltroDia(null);
              router.replace(`${pathname}?de=${f.de}&ate=${f.ate}`, { scroll: false });
            }}
          >
            <Eraser /> Limpar filtros
          </Button>
        )}
      </div>

      {!r ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <Stat rotulo="Total de horas" valor={hhmm(r.minutos)} icone={Clock} tom="brand" sub={`${r.lancamentos} lançamento(s)`} />
            <Stat rotulo="Faturáveis" valor={hhmm(r.minutos_faturaveis)} icone={Timer} tom="success" />
            <Stat rotulo="Não faturáveis" valor={hhmm(r.minutos_nao_faturaveis)} icone={CalendarDays} />
            <Stat rotulo="A faturar" valor={hhmm(r.minutos_a_faturar)} icone={Wallet} tom="warning" sub={moeda(r.valor_a_faturar)} />
            <Stat rotulo="Faturado" valor={hhmm(r.minutos_faturados)} icone={Receipt} sub={moeda(r.valor_faturado)} />
            <Stat rotulo="Aproveitamento" valor={`${r.aproveitamento}%`} icone={Gauge} tom={r.aproveitamento >= 70 ? "success" : r.aproveitamento >= 40 ? "warning" : "danger"} sub="horas faturáveis ÷ total" />
          </div>
          {r.sem_valor_hora > 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-ink">
              <AlertTriangle className="size-4" /> {r.sem_valor_hora} lançamento(s) a faturar sem valor/hora: confira o cargo do profissional e a tabela de preço do caso.{" "}
              <Link href="/configuracoes/faturamento" className="font-medium underline">
                Tabelas de preço
              </Link>
            </p>
          )}

          {r.lancamentos === 0 ? (
            <div className="card-surface">
              <EmptyState
                icone={Clock}
                titulo={filtrando ? "Nenhuma hora com esses filtros" : "Nenhuma hora lançada no período"}
                descricao={filtrando ? "Troque ou limpe os filtros." : "Use o card Lançar horas acima para registrar o tempo do dia."}
                acao={
                  isOperador && !filtrando ? (
                    <Button onClick={() => document.getElementById("lh-horas")?.focus()}>
                      <Plus /> Lançar horas
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="grid gap-5 xl:grid-cols-3">
                <ChartCard titulo="Horas por dia" className="xl:col-span-2">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={grafDia} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} {...GRADE} />
                        <XAxis dataKey="rot" {...EIXO} minTickGap={8} />
                        <YAxis {...EIXO} width={36} tickFormatter={(v: number) => `${v}h`} />
                        <Tooltip
                          cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                          content={({ active, payload }) => {
                            const x = payload?.[0]?.payload as (typeof grafDia)[number] | undefined;
                            if (!active || !x) return null;
                            return <TooltipCaixa titulo={`${diaSemana(x.data)}, ${data(x.data)}`} linhas={[{ cor: "var(--viz-1)", rotulo: "horas", valor: hhmm(x.minutos) }]} />;
                          }}
                        />
                        <Bar dataKey="horas" fill="var(--viz-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </ChartCard>
                <ChartCard titulo="Por profissional">
                  <Ranking grupos={q.data!.por_profissional} avatar />
                </ChartCard>
              </div>
              <ChartCard titulo="Por cliente">
                <Ranking grupos={q.data!.por_cliente} colunas />
              </ChartCard>

              <div className="flex items-center justify-between gap-2">
                <Segmented
                  value={visao}
                  onChange={setVisao}
                  opcoes={[
                    { value: "lista", label: "Lista" },
                    { value: "semana", label: "Semana" },
                  ]}
                />
                {filtroDia && (
                  <button type="button" onClick={() => setFiltroDia(null)} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/8 px-2.5 py-1 text-xs">
                    {q.data!.itens.find((x) => x.profissional_id === filtroDia.prof)?.profissional_nome} · {data(filtroDia.dia)} ✕
                  </button>
                )}
              </div>

              {visao === "semana" ? (
                <section className="card-surface overflow-x-auto" aria-label="Semana">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-medium">Profissional</th>
                        {semana.dias.map((d) => (
                          <th key={d} className={cn("px-2 py-2.5 text-center font-medium", d === hojeIso() && "text-info-ink")}>
                            {diaSemana(d)} {d.slice(8)}/{d.slice(5, 7)}
                          </th>
                        ))}
                        <th className="px-4 py-2.5 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {semana.linhas.map(([pid, p]) => (
                        <tr key={pid}>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-2">
                              <UserAvatar nome={p.nome} className="size-6" textoClassName="text-[9px]" /> {p.nome}
                            </span>
                          </td>
                          {semana.dias.map((d) => {
                            const m = p.dias[d] ?? 0;
                            return (
                              <td key={d} className="px-1 py-1 text-center">
                                {m ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFiltroDia({ prof: pid, dia: d });
                                      setVisao("lista");
                                    }}
                                    className="w-full rounded-md py-1.5 font-mono text-xs tabular-nums transition hover:ring-1 hover:ring-brand/40"
                                    style={{ background: `color-mix(in oklab, var(--brand) ${Math.min(40, 8 + m / 15)}%, transparent)` }}
                                  >
                                    {hhmm(m)}
                                  </button>
                                ) : (
                                  <span className="text-muted-foreground/40">—</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">{hhmm(p.total)}</td>
                        </tr>
                      ))}
                      {!semana.linhas.length && (
                        <tr>
                          <td colSpan={semana.dias.length + 2} className="p-6 text-center text-sm text-muted-foreground">
                            Sem horas nos primeiros 7 dias do período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Mostra os 7 primeiros dias do período. Clique num total para ver os lançamentos.</p>
                </section>
              ) : (
                <div className="space-y-4">
                  {porDia.map(([dia, ls]) => (
                    <section key={dia} className="card-surface overflow-hidden" aria-label={dia}>
                      <header className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2">
                        <span className={cn("text-sm font-semibold capitalize", dia === hojeIso() && "text-info-ink")}>
                          {diaSemana(dia)}, {data(dia)}
                          {dia === hojeIso() && " · hoje"}
                        </span>
                        <span className="ml-auto font-mono text-sm font-semibold tabular-nums">{hhmm(ls.reduce((a, x) => a + x.minutos, 0))}</span>
                      </header>
                      <ul className="divide-y">
                        {ls.map((x) => (
                          <motion.li key={x.id} layout className="group flex items-start gap-3 px-4 py-2.5 hover:bg-accent/30">
                            <span title={`${x.profissional_nome}${x.cargo_nome ? ` · ${x.cargo_nome}` : ""}`}>
                              <UserAvatar nome={x.profissional_nome} className="size-7" textoClassName="text-[10px]" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm whitespace-pre-line">{x.descricao}</p>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {x.profissional_nome} ·{" "}
                                <Link href={`/faturamento/casos/${x.caso_id}`} className="hover:text-foreground hover:underline">
                                  #{x.caso_numero} {x.caso_titulo}
                                </Link>{" "}
                                · {x.cliente_nome}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="font-mono text-sm font-semibold tabular-nums">{hhmm(x.minutos)}</p>
                              <p className="text-[11px] text-muted-foreground tabular-nums">{x.valor ? moeda(x.valor) : x.faturavel ? "sem valor/hora" : ""}</p>
                            </div>
                            <div className="w-28 shrink-0 text-right">
                              {x.faturado ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-ink">
                                  <Lock className="size-3" /> {x.fatura_codigo}
                                </span>
                              ) : x.faturavel ? (
                                <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning-ink">a faturar</span>
                              ) : (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">não faturável</span>
                              )}
                            </div>
                            <div className="flex w-16 shrink-0 justify-end gap-0.5">
                              {isOperador && !x.faturado && (
                                <>
                                  <Button variant="ghost" size="icon-sm" aria-label="Editar lançamento" className="opacity-50 group-hover:opacity-100" onClick={() => setEditar(x)}>
                                    <Pencil />
                                  </Button>
                                  <Button variant="ghost" size="icon-sm" aria-label="Excluir lançamento" className="opacity-50 group-hover:opacity-100" onClick={() => setExcluir(x)}>
                                    <Trash2 />
                                  </Button>
                                </>
                              )}
                            </div>
                          </motion.li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <EditarDialog linha={editar} onClose={() => setEditar(null)} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este lançamento?"
        descricao={excluir ? `${hhmm(excluir.minutos)} de ${excluir.profissional_nome} em ${data(excluir.data)} · #${excluir.caso_numero} ${excluir.caso_titulo}` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}

function Ranking({ grupos, avatar, colunas }: { grupos: Grupo[]; avatar?: boolean; colunas?: boolean }) {
  const max = Math.max(1, ...grupos.map((g) => g.minutos));
  const lista = grupos.slice(0, colunas ? 12 : 8);
  return (
    <ul className={cn("space-y-2.5", colunas && "grid gap-x-8 gap-y-2.5 space-y-0 md:grid-cols-2")}>
      {lista.map((g) => (
        <li key={g.id}>
          <div className="flex items-center gap-2 text-xs">
            {avatar && <UserAvatar nome={g.nome} className="size-5" textoClassName="text-[8px]" />}
            <span className="min-w-0 flex-1 truncate font-medium">{g.nome}</span>
            <span className="font-mono tabular-nums">{hhmm(g.minutos)}</span>
            <span className="w-24 text-right font-mono text-muted-foreground tabular-nums">{toNum(g.valor) ? moeda(g.valor) : "—"}</span>
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full" style={{ width: `${(g.minutos_faturaveis / max) * 100}%`, background: "var(--viz-2)" }} />
            <div className="h-full" style={{ width: `${((g.minutos - g.minutos_faturaveis) / max) * 100}%`, background: "var(--viz-muted)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function TimesheetPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <TimesheetCentral />
    </Suspense>
  );
}
