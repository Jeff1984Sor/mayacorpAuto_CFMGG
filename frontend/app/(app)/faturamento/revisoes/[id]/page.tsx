"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  Copy,
  ExternalLink,
  FileSearch,
  FileText,
  History,
  Info,
  ListPlus,
  Loader2,
  PartyPopper,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Timer,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useProfissionais } from "@/components/faturamento/dialogos";
import { useEmitirNfse } from "@/components/faturamento/emitir";
import { IaBadge, IaGauge } from "@/components/faturamento/ia-score";
import { Diferenca, diasDesde, STATUS_REVISAO } from "@/components/faturamento/revisao-util";
import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { abrirArquivo, api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  documentoDaAba,
  horasDecimal,
  type IaAnalise,
  type ItemPendente,
  paraMinutos,
  ROTULO_DESPESA,
  type RevisaoItem,
  type RevisaoOut,
  rotuloTipoItem,
  type TipoDespesa,
} from "@/lib/faturamento";
import { data, dataHora, moeda, numero, relativo, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE");
const paraApi = (s: string) => String(toNum(s.replace(/\./g, "").replace(",", ".")));
const valorOk = (s: string) => /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s.trim()) && toNum(paraApi(s)) >= 0;
const paraBr = (v: string | number) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COR_TIPO: Record<string, "brand" | "success" | "warning" | "info" | "neutral"> = {
  fixo: "brand",
  recorrente: "success",
  hora: "warning",
  despesa: "info",
  avulso: "neutral",
};

// ================================================================ edição inline
function Editavel({
  valor,
  exibir,
  onSalvar,
  multilinha,
  validar,
  rotulo,
  desabilitado,
  className,
  inputClassName,
}: {
  valor: string;
  exibir?: React.ReactNode;
  onSalvar: (v: string) => Promise<unknown>;
  multilinha?: boolean;
  validar?: (v: string) => string | null;
  rotulo: string;
  desabilitado?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState(valor);
  const [salvando, setSalvando] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editando) ref.current?.select();
  }, [editando]);

  if (!editando || desabilitado)
    return (
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => {
          setV(valor);
          setEditando(true);
        }}
        aria-label={`Editar ${rotulo}`}
        className={cn(
          "-mx-1.5 rounded-md px-1.5 py-0.5 text-left transition enabled:hover:bg-brand/8 enabled:hover:ring-1 enabled:hover:ring-brand/30 disabled:cursor-default",
          className,
        )}
      >
        {exibir ?? valor}
      </button>
    );

  const confirmar = async () => {
    const novo = v.trim();
    if (novo === valor.trim()) return setEditando(false);
    const erro = validar?.(novo);
    if (erro) {
      toast.error(erro);
      ref.current?.focus();
      return;
    }
    setSalvando(true);
    try {
      await onSalvar(novo);
      setEditando(false);
    } catch {
      ref.current?.focus();
    } finally {
      setSalvando(false);
    }
  };
  const props = {
    ref,
    value: v,
    "aria-label": rotulo,
    disabled: salvando,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: confirmar,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditando(false);
      }
      if (e.key === "Enter" && (!multilinha || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        confirmar();
      }
    },
  };
  return (
    <div className="relative">
      {multilinha ? (
        <Textarea {...props} rows={3} className={cn("min-h-16 text-sm", inputClassName)} />
      ) : (
        <Input {...props} className={cn("h-8", inputClassName)} />
      )}
      {salvando && <Loader2 className="absolute top-2 right-2 size-4 animate-spin text-muted-foreground" />}
      {multilinha && <p className="mt-0.5 text-[10px] text-muted-foreground">Ctrl+Enter salva · Esc cancela</p>}
    </div>
  );
}

// ================================================================ diálogos de ação
function AdicionarHorasDialog({ open, onOpenChange, rev, onFeito }: { open: boolean; onOpenChange: (o: boolean) => void; rev: RevisaoOut; onFeito: (r: RevisaoOut) => void }) {
  const { usuario } = useAuth();
  const profs = useProfissionais(open);
  const [f, setF] = useState({ caso_id: "", profissional_id: "", data: hoje(), horas: "", descricao: "", valor_hora: "" });
  const [erro, setErro] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- reinicia ao abrir */
  useEffect(() => {
    if (open) {
      setF({ caso_id: rev.casos.length === 1 ? String(rev.casos[0].id) : "", profissional_id: usuario ? String(usuario.id) : "", data: hoje(), horas: "", descricao: "", valor_hora: "" });
      setErro(null);
    }
  }, [open, rev.casos, usuario]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }));
  const minutos = paraMinutos(f.horas);
  const salvar = useMutation({
    mutationFn: () =>
      api.post<RevisaoOut>(`/faturamento/revisoes/${rev.id}/horas`, {
        caso_id: Number(f.caso_id),
        profissional_id: f.profissional_id ? Number(f.profissional_id) : null,
        data: f.data,
        minutos,
        descricao: f.descricao.trim(),
        valor_hora: f.valor_hora.trim() ? paraApi(f.valor_hora) : null,
      }),
    meta: { silencioso: true },
    onSuccess: (r) => {
      toast.success("Horas adicionadas à revisão", { description: "O lançamento também fica no timesheet do caso." });
      onFeito(r);
      onOpenChange(false);
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : "Não foi possível adicionar."),
  });
  const semValorHora = !!erro && /valor\/hora|regra por hora|tabela/i.test(erro);
  const prof = profs.data?.find((p) => String(p.id) === f.profissional_id);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Adicionar horas"
      descricao="Lança no timesheet do caso e já inclui nesta revisão."
      largura="lg"
      rotuloSalvar="Adicionar"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        if (!f.caso_id) return setErro("Escolha o caso.");
        if (!minutos || minutos > 1440) return setErro("Informe as horas no formato 1:30 (até 24h).");
        if (f.descricao.trim().length < 2) return setErro("Descreva o que foi feito.");
        if (f.valor_hora.trim() && !valorOk(f.valor_hora)) return setErro("Valor/hora inválido. Use 450,00.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Caso" obrigatorio htmlFor="rh-caso" className="sm:col-span-6">
          <NativeSelect id="rh-caso" value={f.caso_id} onChange={(e) => set("caso_id", e.target.value)}>
            <option value="">Escolha o caso…</option>
            {rev.casos.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.numero} {c.titulo}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Profissional" htmlFor="rh-prof" className="sm:col-span-4" dica={prof && !prof.cargo_nome ? "Sem cargo: informe o valor/hora abaixo." : prof?.cargo_nome ?? undefined}>
          <NativeSelect id="rh-prof" value={f.profissional_id} onChange={(e) => set("profissional_id", e.target.value)}>
            {profs.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.cargo_nome ? ` · ${p.cargo_nome}` : ""}
                {!p.acesso_sistema ? " (sem acesso)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Data" htmlFor="rh-data" className="sm:col-span-2">
          <Input id="rh-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
        </Field>
        <Field label="Horas" obrigatorio htmlFor="rh-horas" className="sm:col-span-2" dica={minutos ? `${horasDecimal(minutos / 60)} h` : "ex.: 1:30"}>
          <Input id="rh-horas" value={f.horas} onChange={(e) => set("horas", e.target.value)} placeholder="1:30" className="font-mono" inputMode="numeric" />
        </Field>
        <Field label="Valor/hora" htmlFor="rh-valor" className="sm:col-span-4" dica="Opcional. Vazio = o da tabela de preço do cargo.">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <Input id="rh-valor" value={f.valor_hora} onChange={(e) => set("valor_hora", e.target.value.replace(/[^\d,.]/g, ""))} className={cn("pl-8 font-mono", semValorHora && "border-warning ring-3 ring-warning/30")} inputMode="decimal" />
          </div>
        </Field>
        <Field label="Descrição" obrigatorio htmlFor="rh-desc" className="sm:col-span-6">
          <Textarea id="rh-desc" rows={3} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="ex.: Elaboração de contestação" />
        </Field>
        {erro && (
          <p role="alert" className={cn("flex items-start gap-2 rounded-lg px-3 py-2 text-sm sm:col-span-6", semValorHora ? "bg-warning/12 text-warning-ink" : "bg-danger/10 text-danger-ink")}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {erro}
          </p>
        )}
      </div>
    </FormDialog>
  );
}

function LancamentoDialog({ open, onOpenChange, rev, onFeito }: { open: boolean; onOpenChange: (o: boolean) => void; rev: RevisaoOut; onFeito: (r: RevisaoOut) => void }) {
  const despesas = rev.aba === "despesas";
  const [f, setF] = useState({ data: hoje(), descricao: "", valor: "", caso_id: "", tipo_despesa: "outros" as TipoDespesa });
  /* eslint-disable react-hooks/set-state-in-effect -- reinicia ao abrir */
  useEffect(() => {
    if (open) setF({ data: hoje(), descricao: "", valor: "", caso_id: rev.casos.length === 1 ? String(rev.casos[0].id) : "", tipo_despesa: "outros" });
  }, [open, rev.casos]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () =>
      api.post<RevisaoOut>(`/faturamento/revisoes/${rev.id}/lancamentos`, {
        data: f.data,
        descricao: f.descricao.trim(),
        valor: paraApi(f.valor),
        caso_id: f.caso_id ? Number(f.caso_id) : null,
        tipo_despesa: despesas ? f.tipo_despesa : null,
      }),
    onSuccess: (r) => {
      toast.success(despesas ? "Despesa lançada no caso e incluída" : "Lançamento incluído");
      onFeito(r);
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={despesas ? "Adicionar despesa" : "Adicionar lançamento"}
      descricao={despesas ? "A despesa é registrada no caso e entra nesta ND." : "Um valor avulso só desta fatura (ex.: honorário de êxito, ajuste)."}
      rotuloSalvar="Adicionar"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (despesas && !f.caso_id) return toast.error("Escolha o caso da despesa.");
        if (f.descricao.trim().length < 2) return toast.error("Informe a descrição.");
        if (!valorOk(f.valor) || toNum(paraApi(f.valor)) <= 0) return toast.error("Informe um valor maior que zero, ex.: 1.250,00.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {(despesas || rev.casos.length > 0) && (
          <Field label="Caso" obrigatorio={despesas} htmlFor="rl-caso" className="sm:col-span-2">
            <NativeSelect id="rl-caso" value={f.caso_id} onChange={(e) => set("caso_id", e.target.value)}>
              <option value="">{despesas ? "Escolha o caso…" : "Do contrato (sem caso)"}</option>
              {rev.casos.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.numero} {c.titulo}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {despesas && (
          <Field label="Tipo de despesa" htmlFor="rl-tipo">
            <NativeSelect id="rl-tipo" value={f.tipo_despesa} onChange={(e) => set("tipo_despesa", e.target.value as TipoDespesa)}>
              {Object.entries(ROTULO_DESPESA).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Data" htmlFor="rl-data">
          <Input id="rl-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
        </Field>
        <Field label="Valor" obrigatorio htmlFor="rl-valor">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <Input id="rl-valor" value={f.valor} onChange={(e) => set("valor", e.target.value.replace(/[^\d,.]/g, ""))} className="pl-8 font-mono" inputMode="decimal" placeholder="0,00" />
          </div>
        </Field>
        <Field label="Descrição" obrigatorio htmlFor="rl-desc" className="sm:col-span-2">
          <Input id="rl-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={300} />
        </Field>
      </div>
    </FormDialog>
  );
}

function IncluirPendentesDialog({ open, onOpenChange, rev, onFeito }: { open: boolean; onOpenChange: (o: boolean) => void; rev: RevisaoOut; onFeito: (r: RevisaoOut) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ["fat", "revisao", rev.id, "disponiveis"],
    queryFn: () => api.get<ItemPendente[]>(`/faturamento/revisoes/${rev.id}/disponiveis`),
    enabled: open,
  });
  /* eslint-disable react-hooks/set-state-in-effect -- limpa ao abrir */
  useEffect(() => {
    if (open) setSel(new Set());
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const itens = q.data ?? [];
  const validos = itens.filter((i) => !i.aviso);
  const total = itens.filter((i) => sel.has(i.chave)).reduce((a, i) => a + toNum(i.valor), 0);
  const incluir = useMutation({
    mutationFn: () => api.post<RevisaoOut>(`/faturamento/revisoes/${rev.id}/incluir`, { chaves: [...sel] }),
    onSuccess: (r) => {
      toast.success(`${sel.size} item(ns) incluído(s)`);
      onFeito(r);
      onOpenChange(false);
    },
  });
  const alternar = (k: string, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(k);
      else n.delete(k);
      return n;
    });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Incluir itens pendentes"
      descricao={`Itens do contrato #${rev.contrato_numero} que ainda não estão em nenhuma fatura.`}
      largura="xl"
      rotuloSalvar={sel.size ? `Incluir ${sel.size} · ${moeda(total)}` : "Incluir"}
      salvando={incluir.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!sel.size) return toast.error("Marque pelo menos um item.");
        incluir.mutate();
      }}
    >
      {q.isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : itens.length === 0 ? (
        <EmptyState icone={ListPlus} titulo="Nada pendente neste contrato" descricao="Todas as parcelas, horas e despesas já estão nesta ou em outra fatura." />
      ) : (
        <div className="max-h-[55dvh] overflow-y-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2">
                  <Checkbox
                    aria-label="Marcar todos"
                    checked={validos.length > 0 && validos.every((i) => sel.has(i.chave))}
                    indeterminate={sel.size > 0 && sel.size < validos.length}
                    onCheckedChange={(v) => setSel(v ? new Set(validos.map((i) => i.chave)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2 font-medium">Data</th>
                <th className="px-2 py-2 font-medium">Descrição</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((i) => (
                <tr key={i.chave} className={cn(i.aviso && "bg-warning/6")}>
                  <td className="px-3 py-2">
                    <Checkbox checked={sel.has(i.chave)} disabled={!!i.aviso} onCheckedChange={(v) => alternar(i.chave, !!v)} aria-label={`Incluir ${i.descricao}`} />
                  </td>
                  <td className="px-2 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">{data(i.data)}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-start gap-2">
                      <Pill tom={COR_TIPO[i.tipo] ?? "neutral"}>{rotuloTipoItem(i.tipo)}</Pill>
                      <span>
                        {i.descricao}
                        {i.caso_numero && <span className="ml-1 text-xs text-muted-foreground">· caso #{i.caso_numero}</span>}
                        {i.quantidade != null && <span className="ml-1 font-mono text-xs text-muted-foreground">· {horasDecimal(i.quantidade)} h</span>}
                      </span>
                    </div>
                    {i.aviso && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-warning-ink">
                        <AlertTriangle className="size-3" /> {i.aviso}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap tabular-nums">{moeda(i.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormDialog>
  );
}

function ApagarItemDialog({
  item,
  onClose,
  onApagar,
  carregando,
}: {
  item: RevisaoItem | null;
  onClose: () => void;
  onApagar: (apagarLancamento: boolean) => void;
  carregando: boolean;
}) {
  const lancamento = item && (item.tipo === "hora" || item.tipo === "despesa");
  const [modo, setModo] = useState<"tirar" | "apagar">("tirar");
  /* eslint-disable react-hooks/set-state-in-effect -- volta ao padrão seguro */
  useEffect(() => {
    if (item) setModo("tirar");
  }, [item]);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (!lancamento)
    return (
      <ConfirmDialog
        open={!!item}
        onOpenChange={(o) => !o && onClose()}
        titulo="Remover este item da revisão?"
        descricao={item?.manual ? "O lançamento avulso é apagado." : "A parcela volta para Itens a faturar."}
        confirmar="Remover"
        destrutivo
        carregando={carregando}
        onConfirm={() => onApagar(false)}
      />
    );
  const nome = item.tipo === "hora" ? "as horas" : "a despesa";
  return (
    <ConfirmDialog
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      titulo={`O que fazer com ${nome}?`}
      descricao={item.descricao}
      confirmar={modo === "tirar" ? "Tirar da fatura" : "Apagar do caso"}
      destrutivo={modo === "apagar"}
      carregando={carregando}
      onConfirm={() => onApagar(modo === "apagar")}
    >
      <div className="grid gap-2" role="radiogroup" aria-label="Como remover">
        {(
          [
            ["tirar", Undo2, "Só tirar desta fatura", `${item.tipo === "hora" ? "As horas continuam" : "A despesa continua"} no caso e volta${item.tipo === "hora" ? "m" : ""} para Itens a faturar.`],
            ["apagar", Trash2, "Apagar o lançamento do caso", "Some do timesheet/das despesas do caso. Não dá para desfazer."],
          ] as const
        ).map(([k, I, t, d]) => (
          <label key={k} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", modo === k && (k === "apagar" ? "border-danger bg-danger/6" : "border-brand bg-brand/6"))}>
            <input type="radio" name="apagar-modo" checked={modo === k} onChange={() => setModo(k)} className="sr-only" />
            <I className={cn("mt-0.5 size-4", k === "apagar" ? "text-danger-ink" : "text-info-ink")} />
            <span>
              <span className="block text-sm font-medium">{t}</span>
              <span className="block text-xs text-muted-foreground">{d}</span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}

// ================================================================ painel IA
const NIVEL = {
  alto: { l: "Atenção alta", cor: "text-danger-ink", bg: "bg-danger/8 border-danger/25", dot: "bg-danger" },
  medio: { l: "Atenção média", cor: "text-warning-ink", bg: "bg-warning/10 border-warning/30", dot: "bg-warning" },
  baixo: { l: "Observações", cor: "text-info-ink", bg: "bg-brand/6 border-brand/20", dot: "bg-brand" },
} as const;

function PainelIA({
  rev,
  aberta,
  onAtualizar,
  onDestacar,
}: {
  rev: RevisaoOut;
  aberta: boolean;
  onAtualizar: (r: RevisaoOut) => void;
  onDestacar: (id: number) => void;
}) {
  const ia: IaAnalise | null = rev.ia_analise;
  const [erro, setErro] = useState<string | null>(null);
  const analisar = useMutation({
    mutationFn: () => api.post<RevisaoOut>(`/faturamento/revisoes/${rev.id}/ia`),
    meta: { silencioso: true },
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      onAtualizar(r);
      toast.success("Análise concluída", { description: r.ia_analise?.resumo?.slice(0, 120) });
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : "Não foi possível analisar agora."),
  });
  const aplicar = useMutation({
    mutationFn: (ids: number[]) => api.post<RevisaoOut>(`/faturamento/revisoes/${rev.id}/ia/aplicar`, { item_ids: ids }),
    onSuccess: (r, ids) => {
      onAtualizar(r);
      toast.success(ids.length ? "Sugestão aplicada" : "Todas as sugestões aplicadas");
    },
  });
  const salvarObs = useMutation({
    mutationFn: (texto: string) => api.patch<RevisaoOut>(`/faturamento/revisoes/${rev.id}`, { observacao: texto }),
    onSuccess: (r) => {
      onAtualizar(r);
      toast.success("Texto levado para a observação ao cliente");
    },
  });
  const porId = useMemo(() => new Map(rev.itens.map((i) => [i.id, i])), [rev.itens]);
  const alertas = ia?.alertas ?? [];
  const sugestoes = (ia?.sugestoes ?? []).filter((s) => porId.has(s.item_id));
  const grupos = (["alto", "medio", "baixo"] as const).map((n) => ({ n, itens: alertas.filter((a) => (a.nivel in NIVEL ? a.nivel : "baixo") === n) })).filter((g) => g.itens.length);

  return (
    <section aria-labelledby="ia-t" className="card-surface overflow-hidden">
      <header className="relative overflow-hidden border-b p-4">
        <div className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-brand/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl brand-gradient text-white shadow-lg shadow-brand/30">
            <Sparkles className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="ia-t" className="font-semibold">
              Revisor IA
            </h2>
            <p className="text-xs text-muted-foreground">Confere descrições, valores e horas antes de faturar.</p>
          </div>
        </div>
        {aberta && (
          <Button className="relative mt-3 w-full" variant={ia ? "outline" : "default"} onClick={() => analisar.mutate()} disabled={analisar.isPending}>
            {analisar.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {analisar.isPending ? "Analisando…" : ia ? "Analisar de novo" : "Analisar com IA"}
          </Button>
        )}
        {erro && (
          <p role="alert" className="relative mt-3 flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning-ink">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {erro}{" "}
              {/configur/i.test(erro) && (
                <Link href="/configuracoes/ia" className="font-medium underline">
                  Configurar IA
                </Link>
              )}
            </span>
          </p>
        )}
      </header>

      {analisar.isPending && !ia ? (
        <div className="space-y-3 p-4">
          <Skeleton className="mx-auto h-24 w-44 rounded-full" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : !ia ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Sparkles className="mx-auto mb-2 size-6 text-brand/60" />
          {aberta ? "Clique em Analisar para receber uma nota, alertas e sugestões de texto." : "Esta revisão não foi analisada pela IA."}
        </div>
      ) : (
        <div className={cn("divide-y transition-opacity", analisar.isPending && "opacity-50")}>
          <div className="p-4">
            {ia.nota != null && <IaGauge nota={ia.nota} />}
            {ia.resumo && <p className="mt-3 text-sm leading-relaxed">{ia.resumo}</p>}
          </div>

          {grupos.length > 0 && (
            <div className="space-y-3 p-4">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Alertas ({alertas.length})</h3>
              {grupos.map((g) => (
                <div key={g.n}>
                  <p className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-medium", NIVEL[g.n].cor)}>
                    <span className={cn("size-1.5 rounded-full", NIVEL[g.n].dot)} /> {NIVEL[g.n].l}
                  </p>
                  <ul className="space-y-1.5">
                    {g.itens.map((a, k) => {
                      const item = a.item_id != null ? porId.get(a.item_id) : undefined;
                      return (
                        <li key={k}>
                          <button
                            type="button"
                            disabled={!item}
                            onClick={() => item && onDestacar(item.id)}
                            className={cn("w-full rounded-lg border px-3 py-2 text-left text-xs leading-relaxed transition enabled:hover:shadow-sm", NIVEL[g.n].bg)}
                          >
                            {a.texto}
                            {item && <span className="mt-1 block truncate font-medium text-muted-foreground">→ {item.descricao}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {sugestoes.length > 0 && (
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Sugestões de texto ({sugestoes.length})</h3>
                {aberta && sugestoes.length > 1 && (
                  <Button size="xs" variant="outline" onClick={() => aplicar.mutate([])} disabled={aplicar.isPending}>
                    <CheckCheck /> Aplicar todas
                  </Button>
                )}
              </div>
              {sugestoes.map((s) => {
                const item = porId.get(s.item_id)!;
                return (
                  <div key={s.item_id} className="rounded-xl border bg-background p-3 text-xs">
                    <button type="button" onClick={() => onDestacar(item.id)} className="mb-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      Item de {data(item.data)} · {moeda(item.valor)}
                    </button>
                    <p className="rounded-md bg-danger/8 px-2 py-1 text-danger-ink line-through decoration-danger/40">{item.descricao}</p>
                    <p className="mt-1 rounded-md bg-success/10 px-2 py-1 text-success-ink">{s.descricao}</p>
                    {s.motivo && <p className="mt-1.5 text-muted-foreground">{s.motivo}</p>}
                    {aberta && (
                      <Button size="xs" className="mt-2" onClick={() => aplicar.mutate([s.item_id])} disabled={aplicar.isPending}>
                        <Check /> Aplicar
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {ia.texto_fatura && (
            <div className="space-y-2 p-4">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Texto sugerido para a fatura</h3>
              <blockquote className="rounded-xl border-l-4 border-brand bg-brand/5 px-3 py-2 text-sm leading-relaxed">{ia.texto_fatura}</blockquote>
              <div className="flex flex-wrap gap-2">
                {aberta && (
                  <Button size="xs" onClick={() => salvarObs.mutate(ia.texto_fatura!)} disabled={salvarObs.isPending || rev.observacao === ia.texto_fatura}>
                    <ArrowRight /> {rev.observacao === ia.texto_fatura ? "Já está na observação" : "Usar como observação ao cliente"}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(ia.texto_fatura!);
                    toast.success("Copiado");
                  }}
                >
                  <Copy /> Copiar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ================================================================ notas (observação e nota interna)
function CampoTexto({ id, rotulo, dica, valor, desabilitado, onSalvar }: { id: string; rotulo: string; dica: string; valor: string; desabilitado: boolean; onSalvar: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState(valor);
  const [salvando, setSalvando] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- acompanha o valor do servidor (ex.: texto da IA) */
  useEffect(() => setV(valor), [valor]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const sujo = v !== valor;
  return (
    <Field label={rotulo} htmlFor={id} dica={dica}>
      <Textarea id={id} rows={3} value={v} disabled={desabilitado} onChange={(e) => setV(e.target.value)} />
      {sujo && !desabilitado && (
        <div className="mt-1.5 flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={() => setV(valor)}>
            Desfazer
          </Button>
          <Button
            size="xs"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                await onSalvar(v);
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando && <Loader2 className="animate-spin" />} Salvar
          </Button>
        </div>
      )}
    </Field>
  );
}

// ================================================================ página
export default function RevisaoPage() {
  const { id } = useParams<{ id: string }>();
  const rid = Number(id);
  const qc = useQueryClient();
  const router = useRouter();
  const { isOperador } = useAuth();
  const chave = ["fat", "revisao", rid];
  const q = useQuery({ queryKey: chave, queryFn: () => api.get<RevisaoOut>(`/faturamento/revisoes/${rid}`) });
  const [destaque, setDestaque] = useState<number | null>(null);
  const [dlg, setDlg] = useState<"horas" | "lanc" | "pend" | "descartar" | "aprovar" | null>(null);
  const [apagar, setApagar] = useState<RevisaoItem | null>(null);
  const [motivo, setMotivo] = useState("");
  const [faturada, setFaturada] = useState<RevisaoOut | null>(null);
  const emitir = useEmitirNfse();

  const atualizar = (r: RevisaoOut) => {
    qc.setQueryData(chave, r);
    qc.invalidateQueries({ queryKey: ["fat", "revisoes"] });
    qc.invalidateQueries({ queryKey: ["fat", "itens"] });
  };
  const patchItem = (iid: number, body: Record<string, unknown>) => api.patch<RevisaoOut>(`/faturamento/revisoes/${rid}/itens/${iid}`, body).then(atualizar);
  const alternarExcluido = useMutation({ mutationFn: (i: RevisaoItem) => patchItem(i.id, { excluido: !i.excluido }) });
  const remover = useMutation({
    mutationFn: ({ i, apagar }: { i: RevisaoItem; apagar: boolean }) => api.del<RevisaoOut>(`/faturamento/revisoes/${rid}/itens/${i.id}?apagar_lancamento=${apagar}`),
    onSuccess: (r, v) => {
      atualizar(r);
      setApagar(null);
      toast.success(v.apagar ? "Lançamento apagado do caso" : "Item retirado da revisão");
    },
  });
  const descartar = useMutation({
    mutationFn: () => api.post<{ mensagem: string }>(`/faturamento/revisoes/${rid}/descartar`, { motivo: motivo.trim() || null }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fat"] });
      router.push("/faturamento/revisoes");
    },
  });
  const aprovar = useMutation({
    mutationFn: () => api.post<RevisaoOut>(`/faturamento/revisoes/${rid}/aprovar`),
    onSuccess: (r) => {
      atualizar(r);
      qc.invalidateQueries({ queryKey: ["fat"] });
      qc.invalidateQueries({ queryKey: ["faturas"] });
      setDlg(null);
      setFaturada(r);
      import("canvas-confetti").then((m) => m.default({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ["#1E2D6B", "#7C8FFF", "#1A8F5E", "#F5A623"] }));
    },
    onError: () => setDlg(null),
  });

  // rola até o item destacado pela IA
  useEffect(() => {
    if (destaque == null) return;
    document.getElementById(`item-${destaque}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setDestaque(null), 2600);
    return () => clearTimeout(t);
  }, [destaque]);

  if (q.isPending)
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  if (!q.data)
    return (
      <EmptyState
        icone={FileSearch}
        titulo="Revisão não encontrada"
        acao={
          <Button variant="outline" render={<Link href="/faturamento/revisoes" />}>
            Voltar para Revisões
          </Button>
        }
      />
    );

  const r = q.data;
  const aberta = r.status === "em_revisao" && isOperador;
  const st = STATUS_REVISAO[r.status];
  const doc = documentoDaAba(r.aba);
  const ativos = r.itens.filter((i) => !i.excluido);
  const excluidos = r.itens.length - ativos.length;
  const alertasPorItem = new Map<number, string>();
  (r.ia_analise?.alertas ?? []).forEach((a) => {
    if (a.item_id != null && !alertasPorItem.has(a.item_id)) alertasPorItem.set(a.item_id, a.nivel);
  });
  const dias = diasDesde(r.criado_em);

  return (
    <div className={cn(aberta && "pb-24")}>
      {/* cabeçalho */}
      <div className="mb-5">
        <Link href="/faturamento/revisoes" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Revisões
        </Link>
        <div className="card-surface relative overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-linear-to-l from-brand/8 to-transparent" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">Revisão #{r.numero}</h1>
                <StatusBadge tom={st.tom} label={st.l} pulse={r.status === "em_revisao"} />
                <Pill tom={r.aba === "despesas" ? "info" : "brand"}>{doc === "NH" ? "Nota de Honorários" : "Nota de Despesas"}</Pill>
                {r.nota_ia != null && <IaBadge nota={r.nota_ia} />}
              </div>
              <p className="mt-1.5 text-sm">
                <span className="font-medium">{r.tomador_nome}</span>
                <span className="text-muted-foreground"> · </span>
                <Link href={`/faturamento/contratos/${r.contrato_id}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  #{r.contrato_numero} {r.contrato_nome}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Período {data(r.de)} a {data(r.ate)} · aberta {dias === 0 ? "hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`}
                {r.responsavel_nome && ` por ${r.responsavel_nome}`}
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-4 sm:gap-8">
              <div>
                <dt className="text-xs text-muted-foreground">Total</dt>
                <dd className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={toNum(r.total)} format={(n) => moeda(n)} />
                </dd>
                <dd>
                  <Diferenca total={r.total} original={r.total_original} />
                  {Math.abs(toNum(r.total) - toNum(r.total_original)) >= 0.005 && <span className="ml-1 text-[11px] text-muted-foreground">vs {moeda(r.total_original)}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Horas</dt>
                <dd className="font-mono text-2xl font-semibold tabular-nums">{horasDecimal(r.total_horas)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Itens</dt>
                <dd className="text-2xl font-semibold tabular-nums">{ativos.length}</dd>
                {excluidos > 0 && <dd className="text-[11px] text-muted-foreground">{excluidos} excluído(s)</dd>}
              </div>
            </dl>
          </div>
          {r.status === "faturada" && r.fatura_id && (
            <div className="relative mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-success/10 px-3 py-2 text-sm text-success-ink">
              <CheckCheck className="size-4" /> Faturada como{" "}
              <Link href={`/nfse/faturas/${r.fatura_id}`} className="font-mono font-semibold underline">
                {r.fatura_codigo}
              </Link>
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => abrirArquivo(`/nfse/faturas/${r.fatura_id}/pdf`)}>
                <FileText /> PDF
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="min-w-0 space-y-5">
          {/* itens */}
          <section aria-labelledby="itens-t" className="card-surface overflow-hidden">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <h2 id="itens-t" className="mr-auto font-semibold">
                Itens da {doc}
              </h2>
              {aberta && (
                <>
                  {r.aba === "honorarios" && (
                    <Button size="sm" variant="outline" onClick={() => setDlg("horas")} disabled={r.casos.length === 0} title={r.casos.length === 0 ? "O contrato não tem casos" : undefined}>
                      <Timer /> Adicionar horas
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setDlg("lanc")} disabled={r.aba === "despesas" && r.casos.length === 0}>
                    <Plus /> {r.aba === "despesas" ? "Adicionar despesa" : "Adicionar lançamento"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDlg("pend")}>
                    <ListPlus /> Incluir pendentes
                  </Button>
                </>
              )}
            </header>
            {r.itens.length === 0 ? (
              <EmptyState
                icone={ListPlus}
                titulo="Revisão sem itens"
                descricao="Inclua itens pendentes do contrato ou adicione um lançamento."
                acao={
                  aberta && (
                    <Button onClick={() => setDlg("pend")}>
                      <ListPlus /> Incluir pendentes
                    </Button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Data</th>
                      <th className="px-2 py-2.5 font-medium">Descrição</th>
                      <th className="px-2 py-2.5 text-right font-medium">Horas</th>
                      <th className="px-2 py-2.5 text-right font-medium">Valor</th>
                      <th className="w-24 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {r.itens.map((i) => {
                      const ehHora = i.tipo === "hora";
                      const alerta = alertasPorItem.get(i.id);
                      const mudou = Math.abs(toNum(i.valor) - toNum(i.valor_original)) >= 0.005;
                      const editavel = aberta && !i.excluido;
                      return (
                        <motion.tr
                          key={i.id}
                          id={`item-${i.id}`}
                          layout="position"
                          className={cn(
                            "align-top transition-colors",
                            i.excluido && "bg-muted/40 text-muted-foreground",
                            destaque === i.id && "bg-brand/10 ring-2 ring-brand ring-inset",
                          )}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="font-mono text-xs">{data(i.data)}</p>
                            {i.caso_numero && (
                              <Link href={`/faturamento/casos/${i.caso_id}`} className="text-[11px] text-muted-foreground hover:underline" title={i.caso_titulo ?? undefined}>
                                caso #{i.caso_numero}
                              </Link>
                            )}
                          </td>
                          <td className={cn("min-w-72 px-2 py-3", i.excluido && "line-through decoration-muted-foreground/50")}>
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <Pill tom={COR_TIPO[i.tipo] ?? "neutral"}>{rotuloTipoItem(i.tipo)}</Pill>
                              {i.manual && <Pill tom="info">manual</Pill>}
                              {i.parcela && <span className="text-[11px] text-muted-foreground">parcela {i.parcela}</span>}
                              {i.profissional && <span className="text-[11px] text-muted-foreground">· {i.profissional}</span>}
                              {alerta && (
                                <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium", NIVEL[(alerta in NIVEL ? alerta : "baixo") as keyof typeof NIVEL].cor)}>
                                  <AlertTriangle className="size-3" /> IA
                                </span>
                              )}
                            </div>
                            <Editavel
                              rotulo="descrição"
                              valor={i.descricao}
                              multilinha
                              desabilitado={!editavel}
                              validar={(v) => (v.length < 2 ? "A descrição precisa de pelo menos 2 letras." : null)}
                              onSalvar={(v) => patchItem(i.id, { descricao: v })}
                              exibir={<span className="leading-relaxed whitespace-pre-line">{i.descricao}</span>}
                            />
                          </td>
                          <td className="px-2 py-3 text-right whitespace-nowrap">
                            {ehHora && i.quantidade != null ? (
                              <>
                                <Editavel
                                  rotulo="horas"
                                  valor={horasDecimal(i.quantidade)}
                                  desabilitado={!editavel}
                                  className="font-mono tabular-nums"
                                  inputClassName="w-20 text-right font-mono"
                                  validar={(v) => {
                                    const m = paraMinutos(v);
                                    return !m || m > 1440 ? "Use o formato 1:30 (até 24h)." : null;
                                  }}
                                  onSalvar={(v) => patchItem(i.id, { quantidade: (paraMinutos(v)! / 60).toFixed(4) })}
                                />
                                {i.valor_unitario != null && <p className="text-[11px] text-muted-foreground">× {moeda(i.valor_unitario)}</p>}
                              </>
                            ) : i.quantidade != null ? (
                              <span className="font-mono text-xs">{numero(toNum(i.quantidade))}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-right whitespace-nowrap">
                            <Editavel
                              rotulo="valor"
                              valor={paraBr(i.valor)}
                              desabilitado={!editavel}
                              className={cn("font-mono font-semibold tabular-nums", i.excluido && "line-through")}
                              inputClassName="w-28 text-right font-mono"
                              exibir={moeda(i.valor)}
                              validar={(v) => (valorOk(v) ? null : "Valor inválido. Use 1.250,00.")}
                              onSalvar={(v) => patchItem(i.id, { valor: paraApi(v) })}
                            />
                            {mudou && <p className="font-mono text-[11px] text-muted-foreground line-through">{moeda(i.valor_original)}</p>}
                          </td>
                          <td className="px-3 py-3">
                            {aberta && (
                              <div className="flex justify-end gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => alternarExcluido.mutate(i)}
                                  disabled={alternarExcluido.isPending}
                                  aria-label={i.excluido ? `Restaurar ${i.descricao}` : `Excluir da fatura ${i.descricao}`}
                                  title={i.excluido ? "Restaurar" : "Excluir da fatura (pode desfazer)"}
                                >
                                  {i.excluido ? <RotateCcw /> : <XCircle />}
                                </Button>
                                <Button variant="ghost" size="icon-sm" onClick={() => setApagar(i)} aria-label={`Remover ${i.descricao}`} title="Remover da revisão">
                                  <Trash2 />
                                </Button>
                              </div>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t bg-muted/30 text-sm">
                    <tr>
                      <td colSpan={2} className="px-4 py-2.5 text-xs text-muted-foreground">
                        {ativos.length} item(ns) na fatura{excluidos > 0 && ` · ${excluidos} excluído(s) não entram`}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono text-xs">{horasDecimal(r.total_horas)} h</td>
                      <td className="px-2 py-2.5 text-right font-mono font-bold tabular-nums">{moeda(r.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* observações */}
          <section className="card-surface grid gap-4 p-4 md:grid-cols-2">
            <CampoTexto
              id="rev-obs"
              rotulo="Observação para o cliente"
              dica={`Sai impressa na ${doc}.`}
              valor={r.observacao ?? ""}
              desabilitado={!aberta}
              onSalvar={(v) => api.patch<RevisaoOut>(`/faturamento/revisoes/${rid}`, { observacao: v }).then((x) => (atualizar(x), toast.success("Observação salva")))}
            />
            <CampoTexto
              id="rev-nota"
              rotulo="Nota interna"
              dica="Só a equipe vê."
              valor={r.nota_interna ?? ""}
              desabilitado={!aberta}
              onSalvar={(v) => api.patch<RevisaoOut>(`/faturamento/revisoes/${rid}`, { nota_interna: v }).then((x) => (atualizar(x), toast.success("Nota salva")))}
            />
          </section>

          {/* histórico */}
          <section aria-labelledby="hist-t" className="card-surface p-4">
            <h2 id="hist-t" className="mb-3 flex items-center gap-2 font-semibold">
              <History className="size-4 text-muted-foreground" /> Histórico
            </h2>
            {r.eventos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem eventos.</p>
            ) : (
              <ol className="relative space-y-3 border-l pl-5">
                {r.eventos.map((e, k) => (
                  <li key={k} className="relative">
                    <span className={cn("absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card", k === 0 ? "bg-brand" : "bg-muted-foreground/40")} />
                    <p className="text-sm">{e.texto}</p>
                    <p className="text-[11px] text-muted-foreground" title={dataHora(e.em)}>
                      {e.usuario ?? "Sistema"} · {relativo(e.em)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="xl:sticky xl:top-[calc(var(--tb,52px)+1rem)]">
          <PainelIA rev={r} aberta={aberta} onAtualizar={atualizar} onDestacar={setDestaque} />
        </aside>
      </div>

      {/* rodapé de decisão */}
      {aberta && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-24 pl-4 lg:pl-[calc(var(--sb)+1rem)]">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
            <span className="mr-1 text-sm">
              {doc} de <strong className="font-mono">{moeda(r.total)}</strong>
            </span>
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setDlg("descartar")}>
              <XCircle /> Descartar revisão
            </Button>
            <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => setDlg("aprovar")} disabled={ativos.length === 0 || toNum(r.total) <= 0}>
              <Send /> Aprovar e faturar
            </Button>
          </div>
        </div>
      )}

      {aberta && (
        <>
          <AdicionarHorasDialog open={dlg === "horas"} onOpenChange={(o) => setDlg(o ? "horas" : null)} rev={r} onFeito={atualizar} />
          <LancamentoDialog open={dlg === "lanc"} onOpenChange={(o) => setDlg(o ? "lanc" : null)} rev={r} onFeito={atualizar} />
          <IncluirPendentesDialog open={dlg === "pend"} onOpenChange={(o) => setDlg(o ? "pend" : null)} rev={r} onFeito={atualizar} />
        </>
      )}
      <ApagarItemDialog item={apagar} onClose={() => setApagar(null)} carregando={remover.isPending} onApagar={(a) => apagar && remover.mutate({ i: apagar, apagar: a })} />
      <ConfirmDialog
        open={dlg === "descartar"}
        onOpenChange={(o) => {
          setDlg(o ? "descartar" : null);
          if (!o) setMotivo("");
        }}
        titulo={`Descartar a revisão #${r.numero}?`}
        descricao="Nenhuma fatura é criada. Os itens voltam para Itens a faturar; os lançamentos manuais avulsos são apagados."
        confirmar="Descartar"
        destrutivo
        carregando={descartar.isPending}
        onConfirm={() => descartar.mutate()}
      >
        <Field label="Motivo" htmlFor="rev-motivo" dica="Opcional, fica no histórico.">
          <Textarea id="rev-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={dlg === "aprovar"}
        onOpenChange={(o) => setDlg(o ? "aprovar" : null)}
        titulo={`Aprovar e gerar a ${doc}?`}
        descricao={`${r.tomador_nome} · ${ativos.length} item(ns).`}
        confirmar={`Faturar ${moeda(r.total)}`}
        carregando={aprovar.isPending}
        onConfirm={() => aprovar.mutate()}
      >
        <div className="rounded-xl border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-mono text-lg font-bold">{moeda(r.total)}</span>
          </div>
          {Math.abs(toNum(r.total) - toNum(r.total_original)) >= 0.005 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Antes da revisão</span>
              <span className="font-mono">
                {moeda(r.total_original)} <Diferenca total={r.total} original={r.total_original} />
              </span>
            </div>
          )}
          {r.nota_ia == null && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-warning-ink">
              <Sparkles className="size-3.5" /> Ainda não passou pelo Revisor IA.
            </p>
          )}
        </div>
      </ConfirmDialog>

      {/* resultado */}
      <Dialog open={!!faturada} onOpenChange={(o) => !o && setFaturada(null)}>
        <DialogContent className="sm:max-w-md">
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/12 text-success-ink">
              <PartyPopper className="size-7" />
            </span>
            <DialogTitle className="mt-3 text-lg">{doc} gerada</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-base font-semibold text-foreground">{faturada?.fatura_codigo}</span> · {moeda(faturada?.total)}
            </DialogDescription>
          </div>
          <div className="grid gap-2">
            {faturada?.fatura_id && (
              <Button variant="outline" onClick={() => abrirArquivo(`/nfse/faturas/${faturada.fatura_id}/pdf`)}>
                <ExternalLink /> Abrir PDF da {doc}
              </Button>
            )}
            {doc === "NH" && faturada?.fatura_id && (
              <Button onClick={() => emitir.mutate([faturada.fatura_id!])} disabled={emitir.isPending}>
                {emitir.isPending ? <Loader2 className="animate-spin" /> : <FileText />} Emitir NFS-e agora
              </Button>
            )}
            <Button variant="ghost" render={<Link href="/faturamento/fluxo" />}>
              <Clock /> Ver no Fluxo de Faturamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
