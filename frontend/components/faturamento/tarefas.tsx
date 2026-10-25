"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Briefcase,
  Building,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Gavel,
  Landmark,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Shapes,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useFieldId } from "@/components/ui/field-id";
import { abrirArquivo, api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AnexoOut, CasoOut, PrioridadeTarefa, StatusTarefa, TarefaIn, TarefaOut, TarefasListaOut, TipoTarefa } from "@/lib/faturamento";
import { data, tamanhoArquivo } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useProfissionais } from "./dialogos";
import { EnriquecerIA } from "./horas-input";

// ================================================================ metadados
type Icone = React.ComponentType<{ className?: string }>;
export const TIPO_TAREFA: Record<TipoTarefa, { l: string; icone: Icone }> = {
  prazo: { l: "Prazo", icone: AlarmClock },
  audiencia: { l: "Audiência", icone: Landmark },
  diligencia: { l: "Diligência", icone: Building },
  reuniao: { l: "Reunião", icone: Users },
  peticao: { l: "Petição", icone: FileText },
  ligacao: { l: "Ligação", icone: Phone },
  administrativo: { l: "Administrativo", icone: Briefcase },
  outro: { l: "Outro", icone: Shapes },
};
export const PRIORIDADE: Record<PrioridadeTarefa, { l: string; ponto: string; chip: string }> = {
  baixa: { l: "Baixa", ponto: "bg-slate-400", chip: "bg-slate-500/10 text-slate-600 ring-slate-500/25 dark:text-slate-300" },
  media: { l: "Média", ponto: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300" },
  alta: { l: "Alta", ponto: "bg-warning", chip: "bg-warning/12 text-warning-ink ring-warning/30" },
  urgente: { l: "Urgente", ponto: "bg-danger", chip: "bg-danger/10 text-danger-ink ring-danger/25" },
};
export const STATUS_TAREFA: Record<StatusTarefa, { l: string; cor: string }> = {
  a_fazer: { l: "A fazer", cor: "bg-muted text-muted-foreground" },
  em_andamento: { l: "Em andamento", cor: "bg-brand/12 text-info-ink" },
  concluida: { l: "Concluída", cor: "bg-success/12 text-success-ink" },
  cancelada: { l: "Cancelada", cor: "bg-muted text-muted-foreground line-through" },
};

const hoje = () => new Date().toLocaleDateString("sv-SE");
export const aberta = (t: TarefaOut) => t.status === "a_fazer" || t.status === "em_andamento";

/** "vence amanhã", "3 dias de atraso"… */
export function rotuloPrazo(t: TarefaOut): { texto: string; cls: string } | null {
  if (!t.prazo) return null;
  const d = t.dias_para_prazo ?? Math.round((new Date(`${t.prazo}T00:00:00`).getTime() - new Date(`${hoje()}T00:00:00`).getTime()) / 86_400_000);
  if (!aberta(t)) return { texto: data(t.prazo), cls: "text-muted-foreground" };
  if (d < 0) return { texto: `${-d} dia${d === -1 ? "" : "s"} de atraso`, cls: "font-semibold text-danger-ink" };
  if (d === 0) return { texto: t.hora ? `hoje às ${t.hora}` : "vence hoje", cls: "font-semibold text-warning-ink" };
  if (d === 1) return { texto: t.hora ? `amanhã às ${t.hora}` : "vence amanhã", cls: "text-warning-ink" };
  if (d <= 7) return { texto: `em ${d} dias`, cls: "text-foreground" };
  return { texto: data(t.prazo), cls: "text-muted-foreground" };
}

export function useEtiquetas(enabled = true) {
  return useQuery({ queryKey: ["fat", "tarefas", "etiquetas"], queryFn: () => api.get<string[]>("/faturamento/tarefas/etiquetas"), enabled, staleTime: 30_000 });
}

export function useCasosSelect(enabled = true) {
  return useQuery({ queryKey: ["fat", "casos", "select"], queryFn: () => api.get<CasoOut[]>("/faturamento/casos"), enabled, staleTime: 60_000 });
}

export function useMudarStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: StatusTarefa }) => api.patch<TarefaOut>(`/faturamento/tarefas/${id}/status`, { status }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["fat"] });
      if (t.status === "concluida") toast.success("Tarefa concluída", { description: t.titulo });
    },
  });
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ================================================================ caso (combobox com busca)
export function CasoCombo({ value, onChange, id, rotuloVazio = "Sem caso (tarefa avulsa)" }: { value: number | null; onChange: (v: number | null) => void; id?: string; rotuloVazio?: string }) {
  const fieldId = useFieldId();
  const casos = useCasosSelect();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = sem(q.trim());
  const lista = (casos.data ?? []).filter((c) => !termo || sem(`${c.numero} ${c.titulo} ${c.tomador_nome} ${c.numero_processo ?? ""}`).includes(termo)).slice(0, 100);
  const atual = casos.data?.find((c) => c.id === value);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id ?? fieldId}
            type="button"
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !atual && "text-muted-foreground")}>
          {atual ? (
            <>
              <span className="font-mono text-xs text-muted-foreground">#{atual.numero}</span> {atual.titulo}
              <span className="text-muted-foreground"> · {atual.tomador_nome}</span>
            </>
          ) : (
            rotuloVazio
          )}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-80 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nº, título, cliente ou processo"
              aria-label="Buscar caso"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => {
                onChange(null);
                setAberto(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            >
              <Check className={cn("size-3.5", value === null ? "text-info-ink" : "invisible")} /> {rotuloVazio}
            </button>
          </li>
          {lista.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === c.id}
                onClick={() => {
                  onChange(c.id);
                  setAberto(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn("size-3.5 shrink-0", value === c.id ? "text-info-ink" : "invisible")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className="font-mono text-xs text-muted-foreground">#{c.numero}</span> {c.titulo}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.tomador_nome}</span>
                </span>
              </button>
            </li>
          ))}
          {casos.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Carregando…</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ================================================================ etiquetas
function EtiquetasInput({ valor, onChange, id }: { valor: string[]; onChange: (v: string[]) => void; id: string }) {
  const sugestoes = useEtiquetas();
  const [txt, setTxt] = useState("");
  const add = (t: string) => {
    const e = t.trim().replace(/,$/, "");
    if (e && !valor.includes(e)) onChange([...valor, e]);
    setTxt("");
  };
  const sobra = (sugestoes.data ?? []).filter((s) => !valor.includes(s) && (!txt || sem(s).includes(sem(txt)))).slice(0, 8);
  return (
    <div>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {valor.map((e) => (
          <span key={e} className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pr-1 pl-2 text-xs text-info-ink">
            #{e}
            <button type="button" onClick={() => onChange(valor.filter((x) => x !== e))} aria-label={`Remover ${e}`} className="rounded-full p-0.5 hover:bg-foreground/10">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={txt}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setTxt(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(txt);
            }
            if (e.key === "Backspace" && !txt && valor.length) onChange(valor.slice(0, -1));
          }}
          onBlur={() => txt.trim() && add(txt)}
          placeholder={valor.length ? "" : "Digite e tecle Enter"}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
        />
      </div>
      {sobra.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {sobra.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand/40 hover:text-foreground">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================ diálogo da tarefa
const vazia = (casoId: number | null, eu: number | null): TarefaIn => ({
  caso_id: casoId,
  titulo: "",
  descricao: null,
  tipo: "outro",
  status: "a_fazer",
  prioridade: "media",
  prazo: null,
  hora: null,
  responsavel_id: eu,
  etiquetas: [],
});

function mascaraHora(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, d.length - 2)}:${d.slice(-2)}` : d;
}
const horaOk = (h: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

export function TarefaDialog({
  open,
  onOpenChange,
  tarefa,
  casoId,
  prazoInicial,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tarefa: TarefaOut | null;
  /** prazo já escolhido (clique num dia do calendário) */
  prazoInicial?: string;
  /** caso já escolhido (aba Tarefas do caso) */
  casoId?: number | null;
  onSalvo?: (t: TarefaOut) => void;
}) {
  const qc = useQueryClient();
  const { usuario, pode } = useAuth();
  const podeEditar = pode("tarefas.editar");
  const profs = useProfissionais(open);
  const [f, setF] = useState<TarefaIn>(() => vazia(casoId ?? null, null));
  const [fila, setFila] = useState<File[]>([]);
  const [tentou, setTentou] = useState(false);
  const [excluirAnexo, setExcluirAnexo] = useState<AnexoOut | null>(null);
  const anexos = useQuery({
    queryKey: ["fat", "tarefa-anexos", tarefa?.id],
    queryFn: () => api.get<AnexoOut[]>(`/faturamento/tarefas/${tarefa!.id}/anexos`),
    enabled: open && !!tarefa,
  });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      tarefa
        ? {
            caso_id: tarefa.caso_id,
            titulo: tarefa.titulo,
            descricao: tarefa.descricao,
            tipo: tarefa.tipo,
            status: tarefa.status,
            prioridade: tarefa.prioridade,
            prazo: tarefa.prazo,
            hora: tarefa.hora,
            responsavel_id: tarefa.responsavel_id,
            etiquetas: tarefa.etiquetas ?? [],
          }
        : { ...vazia(casoId ?? null, usuario?.id ?? null), prazo: prazoInicial ?? null },
    );
    setFila([]);
    setTentou(false);
  }, [open, tarefa, casoId, usuario, prazoInicial]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof TarefaIn>(k: K, v: TarefaIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const enviarArquivos = async (id: number, files: File[]) => {
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((x) => fd.append("arquivos", x));
    await api.post(`/faturamento/tarefas/${id}/anexos`, fd);
  };
  const salvar = useMutation({
    mutationFn: async () => {
      const body: TarefaIn = { ...f, titulo: f.titulo.trim(), descricao: f.descricao?.trim() || null, hora: f.prazo && f.hora ? f.hora : null };
      const t = tarefa ? await api.put<TarefaOut>(`/faturamento/tarefas/${tarefa.id}`, body) : await api.post<TarefaOut>("/faturamento/tarefas", body);
      if (fila.length) await enviarArquivos(t.id, fila);
      return t;
    },
    onSuccess: (t) => {
      toast.success(tarefa ? "Tarefa atualizada" : "Tarefa criada", { description: t.titulo });
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(t);
      onOpenChange(false);
    },
  });
  const enviarAgora = useMutation({
    mutationFn: (files: File[]) => enviarArquivos(tarefa!.id, files),
    onSuccess: () => {
      toast.success("Arquivo(s) anexado(s)");
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const removerAnexo = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/anexos/${id}`),
    onSuccess: () => {
      setExcluirAnexo(null);
      toast.success("Anexo excluído");
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const dz = useDropzone({
    multiple: true,
    maxSize: 50 * 1024 * 1024,
    onDrop: (fs) => (tarefa ? enviarAgora.mutate(fs) : setFila((o) => [...o, ...fs])),
    onDropRejected: () => toast.error("Arquivo maior que 50 MB."),
  });
  const erroHora = f.hora && !horaOk(f.hora) ? "Use HH:MM (00:00 a 23:59)." : null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={!podeEditar ? "Tarefa" : tarefa ? "Editar tarefa" : "Nova tarefa"}
      largura="xl"
      salvando={salvar.isPending}
      rotuloSalvar={podeEditar ? "Salvar" : "Fechar"}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!podeEditar) return onOpenChange(false);
        setTentou(true);
        if (f.titulo.trim().length < 2) return toast.error("Informe o título da tarefa.");
        if (erroHora) return toast.error(erroHora);
        salvar.mutate();
      }}
    >
      <fieldset disabled={!podeEditar} className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <Field label="Título" obrigatorio htmlFor="tar-titulo" erro={tentou && f.titulo.trim().length < 2 ? "Informe o título." : undefined}>
            <Input id="tar-titulo" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} maxLength={200} autoFocus placeholder="ex.: Protocolar contestação" />
          </Field>
          <Field label="Descrição" htmlFor="tar-desc">
            <Textarea id="tar-desc" rows={5} value={f.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} />
            <EnriquecerIA
              className="mt-1.5"
              valor={{ titulo: f.titulo, descricao: f.descricao ?? "" }}
              onChange={(v) => setF((o) => ({ ...o, titulo: v.titulo ?? o.titulo, descricao: v.descricao }))}
              corpo={() => ({ tipo: "tarefa", texto: (f.descricao ?? "").trim() || f.titulo, titulo: f.titulo, caso_id: f.caso_id })}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] text-foreground/80">Tipo</p>
            <div role="radiogroup" aria-label="Tipo da tarefa" className="grid grid-cols-4 gap-1.5">
              {(Object.entries(TIPO_TAREFA) as [TipoTarefa, (typeof TIPO_TAREFA)[TipoTarefa]][]).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.tipo === k}
                  onClick={() => set("tipo", k)}
                  className={cn("flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs transition", f.tipo === k ? "border-brand bg-brand/8 font-medium text-info-ink" : "text-muted-foreground hover:border-brand/40")}
                >
                  <t.icone className="size-4" />
                  {t.l}
                </button>
              ))}
            </div>
          </div>
          <Field label="Caso" htmlFor="tar-caso" dica={tarefa && f.caso_id !== tarefa.caso_id ? "Os anexos da tarefa vão junto para o novo caso." : undefined}>
            <CasoCombo id="tar-caso" value={f.caso_id} onChange={(v) => set("caso_id", v)} />
          </Field>
          <Field label="Etiquetas" htmlFor="tar-etq">
            <EtiquetasInput id="tar-etq" valor={f.etiquetas} onChange={(v) => set("etiquetas", v)} />
          </Field>
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] text-foreground/80">
              <Paperclip className="size-3.5" /> Anexos
            </p>
            <div
              {...dz.getRootProps()}
              className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-sm transition", dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40")}
            >
              <input {...dz.getInputProps()} aria-label="Anexos da tarefa" />
              {enviarAgora.isPending ? <Loader2 className="size-4 animate-spin text-info-ink" /> : <Upload className="size-4 text-info-ink" />}
              <span className="text-muted-foreground">{tarefa ? "Arraste arquivos para anexar agora" : "Arraste arquivos (enviados ao criar a tarefa)"}</span>
            </div>
            {(fila.length > 0 || (anexos.data?.length ?? 0) > 0) && (
              <ul className="mt-2 divide-y rounded-xl border">
                {fila.map((x, i) => (
                  <li key={`f${i}`} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="text-[11px] text-muted-foreground">{tamanhoArquivo(x.size)} · ao salvar</span>
                    <button type="button" onClick={() => setFila((o) => o.filter((_, j) => j !== i))} aria-label={`Tirar ${x.name}`} className="rounded p-0.5 hover:bg-muted">
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
                {anexos.data?.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <Paperclip className="size-3.5 text-muted-foreground" />
                    <button type="button" onClick={() => abrirArquivo(`/faturamento/anexos/${a.id}`)} className="min-w-0 flex-1 truncate text-left hover:underline">
                      {a.nome}
                    </button>
                    <span className="text-[11px] text-muted-foreground">{tamanhoArquivo(a.tamanho)}</span>
                    <button type="button" onClick={() => abrirArquivo(`/faturamento/anexos/${a.id}`)} aria-label={`Ver ${a.nome}`} className="rounded p-0.5 hover:bg-muted">
                      <Eye className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => baixar(`/faturamento/anexos/${a.id}`, { query: { download: true } }, a.nome)} aria-label={`Baixar ${a.nome}`} className="rounded p-0.5 hover:bg-muted">
                      <Download className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setExcluirAnexo(a)} aria-label={`Excluir ${a.nome}`} className="rounded p-0.5 text-danger-ink hover:bg-danger/10">
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <aside className="space-y-4 rounded-2xl border bg-muted/30 p-4">
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Field label="Prazo" htmlFor="tar-prazo">
              <Input id="tar-prazo" type="date" value={f.prazo ?? ""} onChange={(e) => set("prazo", e.target.value || null)} />
            </Field>
            <Field label="Hora" htmlFor="tar-hora" erro={erroHora ?? undefined}>
              <Input id="tar-hora" value={f.hora ?? ""} disabled={!f.prazo} onChange={(e) => set("hora", mascaraHora(e.target.value) || null)} placeholder="HH:MM" inputMode="numeric" className="font-mono" />
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-[13px] text-foreground/80">Prioridade</p>
            <div role="radiogroup" aria-label="Prioridade" className="grid grid-cols-2 gap-1.5">
              {(Object.entries(PRIORIDADE) as [PrioridadeTarefa, (typeof PRIORIDADE)[PrioridadeTarefa]][]).map(([k, p]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.prioridade === k}
                  onClick={() => set("prioridade", k)}
                  className={cn("flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition", f.prioridade === k ? cn("ring-1 ring-inset", p.chip) : "text-muted-foreground hover:border-brand/40")}
                >
                  <span className={cn("size-2 rounded-full", p.ponto)} /> {p.l}
                </button>
              ))}
            </div>
          </div>
          <Field label="Situação" htmlFor="tar-status">
            <NativeSelect id="tar-status" value={f.status} onChange={(e) => set("status", e.target.value as StatusTarefa)}>
              {Object.entries(STATUS_TAREFA).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Responsável" htmlFor="tar-resp">
            <NativeSelect id="tar-resp" value={f.responsavel_id ?? ""} onChange={(e) => set("responsavel_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {profs.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {tarefa && (
            <p className="text-[11px] text-muted-foreground">
              Criada por {tarefa.criado_por ?? "—"} em {data(tarefa.criado_em)}
              {tarefa.concluida_em && ` · concluída em ${data(tarefa.concluida_em)}`}
            </p>
          )}
        </aside>
      </fieldset>
      <ConfirmDialog
        open={!!excluirAnexo}
        onOpenChange={(o) => !o && setExcluirAnexo(null)}
        titulo="Excluir este anexo?"
        descricao={excluirAnexo?.nome}
        confirmar="Excluir"
        destrutivo
        carregando={removerAnexo.isPending}
        onConfirm={() => excluirAnexo && removerAnexo.mutate(excluirAnexo.id)}
      />
    </FormDialog>
  );
}

// ================================================================ linha da tarefa
export function TarefaLinha({
  t,
  onAbrir,
  selecionada,
  onSelecionar,
  mostrarCaso = true,
  podeEditar,
  acoes,
}: {
  t: TarefaOut;
  onAbrir: () => void;
  selecionada?: boolean;
  onSelecionar?: (v: boolean) => void;
  mostrarCaso?: boolean;
  podeEditar: boolean;
  acoes?: React.ReactNode;
}) {
  const status = useMudarStatus();
  const T = TIPO_TAREFA[t.tipo];
  const prazo = rotuloPrazo(t);
  const feita = t.status === "concluida";
  return (
    <li className={cn("group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30", selecionada && "bg-brand/[0.05]", !aberta(t) && "opacity-70")}>
      {onSelecionar && (
        <Checkbox className="mt-1 opacity-40 group-hover:opacity-100 data-[checked]:opacity-100" checked={!!selecionada} onCheckedChange={(v) => onSelecionar(!!v)} aria-label={`Selecionar ${t.titulo}`} />
      )}
      <button
        type="button"
        disabled={!podeEditar || status.isPending || t.status === "cancelada"}
        onClick={() => status.mutate({ id: t.id, status: feita ? "a_fazer" : "concluida" })}
        aria-label={feita ? `Reabrir ${t.titulo}` : `Concluir ${t.titulo}`}
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition",
          feita ? "border-success bg-success text-white" : "border-muted-foreground/40 hover:border-success hover:bg-success/10",
        )}
      >
        {feita && <Check className="size-3" strokeWidth={3} />}
      </button>
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium", feita && "text-muted-foreground line-through")}>
          <span className={cn("size-2 shrink-0 rounded-full", PRIORIDADE[t.prioridade].ponto)} title={`Prioridade ${PRIORIDADE[t.prioridade].l}`} />
          <T.icone className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">{t.titulo}</span>
          {t.status === "em_andamento" && <span className="rounded-full bg-brand/12 px-1.5 text-[10px] font-semibold text-info-ink">em andamento</span>}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {prazo && (
            <span className={prazo.cls}>
              {prazo.texto}
              {t.hora && !prazo.texto.includes(t.hora) && ` · ${t.hora}`}
            </span>
          )}
          {t.etiquetas.map((e) => (
            <span key={e} className="rounded-full bg-muted px-1.5">
              #{e}
            </span>
          ))}
          {t.qtd_anexos > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <Paperclip className="size-3" /> {t.qtd_anexos}
            </span>
          )}
        </p>
      </button>
      {mostrarCaso && t.caso_id && (
        <Link
          href={`/faturamento/casos/${t.caso_id}`}
          className="hidden max-w-56 shrink-0 truncate rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-brand/40 hover:text-foreground md:inline-block"
          title={`${t.caso_titulo} · ${t.cliente_nome}`}
        >
          #{t.caso_numero} {t.caso_titulo}
        </Link>
      )}
      {acoes}
      {t.responsavel_nome ? (
        <span title={t.responsavel_nome} className="shrink-0">
          <UserAvatar nome={t.responsavel_nome} className="size-6" textoClassName="text-[9px]" />
        </span>
      ) : (
        <span className="size-6 shrink-0" />
      )}
    </li>
  );
}

// ================================================================ aba "Tarefas" do caso
export function TarefasCaso({ casoId }: { casoId: number }) {
  const qc = useQueryClient();
  const { usuario, pode } = useAuth();
  const podeEditar = pode("tarefas.editar");
  const q = useQuery({ queryKey: ["fat", "tarefas", "caso", casoId], queryFn: () => api.get<TarefasListaOut>("/faturamento/tarefas", { caso_id: casoId }) });
  const [rapida, setRapida] = useState({ titulo: "", prazo: "", descricao: "" });
  const [dlg, setDlg] = useState<{ t: TarefaOut | null } | null>(null);
  const [verConcluidas, setVerConcluidas] = useState(false);
  const [excluir, setExcluir] = useState<TarefaOut | null>(null);
  const criar = useMutation({
    mutationFn: () => api.post<TarefaOut>("/faturamento/tarefas", { ...vazia(casoId, usuario?.id ?? null), titulo: rapida.titulo.trim(), prazo: rapida.prazo || null, descricao: rapida.descricao.trim() || null }),
    onSuccess: (t) => {
      toast.success("Tarefa criada", { description: t.titulo });
      setRapida({ titulo: "", prazo: "", descricao: "" });
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/tarefas/${id}`),
    onSuccess: () => {
      toast.success("Tarefa excluída");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const itens = q.data?.itens ?? [];
  const abertas = itens.filter(aberta);
  const fechadas = itens.filter((t) => !aberta(t));
  const r = q.data?.resumo;

  return (
    <div className="space-y-4">
      {podeEditar && (
        <form
          className="card-surface flex flex-wrap items-center gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (rapida.titulo.trim().length >= 2) criar.mutate();
          }}
        >
          <Plus className="ml-1 size-4 text-info-ink" />
          <Input aria-label="Nova tarefa" value={rapida.titulo} onChange={(e) => setRapida({ ...rapida, titulo: e.target.value })} placeholder="Nova tarefa… (Enter para criar)" className="min-w-56 flex-1 border-0 shadow-none focus-visible:ring-0" />
          <Input aria-label="Prazo" type="date" value={rapida.prazo} onChange={(e) => setRapida({ ...rapida, prazo: e.target.value })} className="h-8 w-38" />
          <Button type="submit" size="sm" disabled={rapida.titulo.trim().length < 2 || criar.isPending}>
            {criar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Criar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDlg({ t: null })}>
            Mais detalhes
          </Button>
          <Textarea
            aria-label="Descrição da nova tarefa"
            value={rapida.descricao}
            onChange={(e) => setRapida({ ...rapida, descricao: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && rapida.titulo.trim().length >= 2) {
                e.preventDefault();
                criar.mutate();
              }
            }}
            rows={2}
            placeholder="Descrição (opcional) — Ctrl+Enter para criar"
            className="basis-full resize-y text-sm"
          />
        </form>
      )}
      {r && (r.atrasadas > 0 || r.hoje > 0) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {r.atrasadas > 0 && <span className="rounded-full bg-danger/10 px-2.5 py-1 font-medium text-danger-ink">{r.atrasadas} atrasada(s)</span>}
          {r.hoje > 0 && <span className="rounded-full bg-warning/12 px-2.5 py-1 font-medium text-warning-ink">{r.hoje} para hoje</span>}
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : itens.length === 0 ? (
        <p className="card-surface py-10 text-center text-sm text-muted-foreground">Nenhuma tarefa neste caso. Use a linha acima para criar a primeira.</p>
      ) : (
        <section className="card-surface overflow-hidden" aria-label="Tarefas do caso">
          {abertas.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tudo em dia: nenhuma tarefa aberta.</p>
          ) : (
            <ul className="divide-y">
              {abertas.map((t) => (
                <TarefaMenuLinha key={t.id} t={t} podeEditar={podeEditar} onAbrir={() => setDlg({ t })} onExcluir={() => setExcluir(t)} />
              ))}
            </ul>
          )}
          {fechadas.length > 0 && (
            <>
              <button type="button" onClick={() => setVerConcluidas((v) => !v)} className="flex w-full items-center gap-1.5 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn("size-3.5 transition-transform", verConcluidas && "rotate-180")} /> {fechadas.length} concluída(s) ou cancelada(s)
              </button>
              {verConcluidas && (
                <ul className="divide-y border-t">
                  {fechadas.map((t) => (
                    <TarefaMenuLinha key={t.id} t={t} podeEditar={podeEditar} onAbrir={() => setDlg({ t })} onExcluir={() => setExcluir(t)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      <TarefaDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} tarefa={dlg?.t ?? null} casoId={casoId} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir esta tarefa?"
        descricao={excluir ? `${excluir.titulo}${excluir.qtd_anexos ? ` · os ${excluir.qtd_anexos} anexo(s) também são apagados` : ""}` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}

function TarefaMenuLinha({ t, podeEditar, onAbrir, onExcluir }: { t: TarefaOut; podeEditar: boolean; onAbrir: () => void; onExcluir: () => void }) {
  const status = useMudarStatus();
  const podeExcluir = useAuth().pode("tarefas.excluir");
  return (
    <TarefaLinha
      t={t}
      onAbrir={onAbrir}
      mostrarCaso={false}
      podeEditar={podeEditar}
      acoes={
        podeEditar && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${t.titulo}`} className="-my-1 opacity-50 group-hover:opacity-100" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onAbrir}>
                <Pencil /> Editar
              </DropdownMenuItem>
              {t.status !== "em_andamento" && aberta(t) && (
                <DropdownMenuItem onClick={() => status.mutate({ id: t.id, status: "em_andamento" })}>
                  <Gavel /> Marcar em andamento
                </DropdownMenuItem>
              )}
              {t.status !== "cancelada" && (
                <DropdownMenuItem onClick={() => status.mutate({ id: t.id, status: "cancelada" })}>
                  <X /> Cancelar tarefa
                </DropdownMenuItem>
              )}
              {podeExcluir && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onExcluir}>
                    <Trash2 /> Excluir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    />
  );
}

export function useTarefa(id: number | null) {
  return useQuery({ queryKey: ["fat", "tarefa", id], queryFn: () => api.get<TarefaOut>(`/faturamento/tarefas/${id}`), enabled: !!id });
}

