"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, Clock, Lock, Paperclip, Pencil, Plus, Receipt, Timer, Trash2, Upload, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AndamentosCaso } from "@/components/faturamento/andamentos";
import { AnexosCaso } from "@/components/faturamento/anexos";
import { useAreas, useCampos } from "@/components/faturamento/campos-adicionais";
import { CasoIAMenu, PreencherCasoDialog, ResumoCasoSheet } from "@/components/faturamento/caso-ia";
import { CasoDialog, casoParaIn, normalizarCampos, useProfissionais } from "@/components/faturamento/dialogos";
import { AreaBadge, DetalhesCaso } from "@/components/faturamento/ficha-caso";
import { RegrasCobranca } from "@/components/faturamento/regras";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { abrirArquivo, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type CasoIn, type CasoOut, type DespesaOut, hhmm, paraMinutos, ROTULO_DESPESA, type TimesheetOut, type TipoDespesa } from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE");
const paraApi = (s: string) => String(toNum(s.replace(/\./g, "").replace(",", ".")));
const valorOk = (s: string) => /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s.trim()) && toNum(paraApi(s)) > 0;
const paraBr = (v: string | number) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Travado({ codigo }: { codigo: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-ink" title="Já faturado: não pode ser alterado">
      <Lock className="size-3" /> {codigo ?? "faturado"}
    </span>
  );
}

// ================================================================ timesheet
interface FormHoras {
  profissional_id: string;
  data: string;
  horas: string;
  descricao: string;
  faturavel: boolean;
}

function HorasForm({ f, set, profs, idp }: { f: FormHoras; set: <K extends keyof FormHoras>(k: K, v: FormHoras[K]) => void; profs: ReturnType<typeof useProfissionais>; idp: string }) {
  const min = paraMinutos(f.horas);
  const prof = profs.data?.find((p) => String(p.id) === f.profissional_id);
  return (
    <div className="grid gap-3 sm:grid-cols-12">
      <Field label="Profissional" htmlFor={`${idp}-prof`} className="sm:col-span-4" dica={prof ? (prof.cargo_nome ?? <span className="text-warning-ink">Sem cargo: sem valor/hora na tabela</span>) : undefined}>
        <NativeSelect id={`${idp}-prof`} value={f.profissional_id} onChange={(e) => set("profissional_id", e.target.value)}>
          {profs.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {!p.acesso_sistema ? " (sem acesso)" : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Data" htmlFor={`${idp}-data`} className="sm:col-span-3">
        <Input id={`${idp}-data`} type="date" value={f.data} max={hoje()} onChange={(e) => set("data", e.target.value)} />
      </Field>
      <Field label="Horas" htmlFor={`${idp}-horas`} className="sm:col-span-2" dica={min ? `= ${hhmm(min)}` : "hh:mm"}>
        <Input id={`${idp}-horas`} value={f.horas} onChange={(e) => set("horas", e.target.value)} placeholder="1:30" className="font-mono" />
      </Field>
      <div className="flex items-end pb-2 sm:col-span-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.faturavel} onCheckedChange={(v) => set("faturavel", v)} aria-label="Faturável" /> Faturável
        </label>
      </div>
      <Field label="Descrição" htmlFor={`${idp}-desc`} className="sm:col-span-12">
        <Textarea id={`${idp}-desc`} rows={2} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="O que foi feito, como vai aparecer na fatura" />
      </Field>
    </div>
  );
}

function validarHoras(f: FormHoras) {
  const m = paraMinutos(f.horas);
  if (!m || m > 1440) return "Informe as horas no formato 1:30 (até 24h).";
  if (f.descricao.trim().length < 2) return "Descreva o que foi feito.";
  return null;
}
const corpoHoras = (f: FormHoras) => ({
  profissional_id: f.profissional_id ? Number(f.profissional_id) : null,
  data: f.data,
  minutos: paraMinutos(f.horas),
  descricao: f.descricao.trim(),
  faturavel: f.faturavel,
});

function Timesheet({ caso }: { caso: CasoOut }) {
  const qc = useQueryClient();
  const { usuario, isOperador } = useAuth();
  const profs = useProfissionais();
  const q = useQuery({ queryKey: ["fat", "timesheet", caso.id], queryFn: () => api.get<TimesheetOut[]>(`/faturamento/casos/${caso.id}/timesheet`) });
  const novo = (): FormHoras => ({ profissional_id: usuario ? String(usuario.id) : "", data: hoje(), horas: "", descricao: "", faturavel: true });
  const [f, setF] = useState<FormHoras>(novo);
  const [editar, setEditar] = useState<TimesheetOut | null>(null);
  const [fe, setFe] = useState<FormHoras>(novo);
  const [excluir, setExcluir] = useState<TimesheetOut | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- profissional padrão = eu, quando o usuário carrega */
  useEffect(() => {
    if (usuario && !f.profissional_id) setF((o) => ({ ...o, profissional_id: String(usuario.id) }));
  }, [usuario, f.profissional_id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat"] });
  const criar = useMutation({
    mutationFn: () => api.post(`/faturamento/casos/${caso.id}/timesheet`, corpoHoras(f)),
    onSuccess: () => {
      toast.success(`${hhmm(paraMinutos(f.horas))} lançadas`);
      setF((o) => ({ ...novo(), profissional_id: o.profissional_id, data: o.data }));
      invalidar();
    },
  });
  const salvar = useMutation({
    mutationFn: () => api.put(`/faturamento/timesheet/${editar!.id}`, corpoHoras(fe)),
    onSuccess: () => {
      toast.success("Lançamento atualizado");
      setEditar(null);
      invalidar();
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/timesheet/${id}`),
    onSuccess: () => {
      toast.success("Lançamento excluído");
      setExcluir(null);
      invalidar();
    },
  });
  const lista = q.data ?? [];
  const totalMin = lista.reduce((a, t) => a + t.minutos, 0);
  const pendMin = lista.filter((t) => t.faturavel && !t.faturado).reduce((a, t) => a + t.minutos, 0);

  return (
    <div className="space-y-4">
      {isOperador && caso.status === "aberto" && (
        <form
          className="card-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const erro = validarHoras(f);
            if (erro) return toast.error(erro);
            criar.mutate();
          }}
        >
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Timer className="size-4 text-info-ink" /> Lançar horas
          </h3>
          <HorasForm f={f} set={(k, v) => setF((o) => ({ ...o, [k]: v }))} profs={profs} idp="ts-novo" />
          <div className="mt-3 flex justify-end">
            <Button type="submit" disabled={criar.isPending}>
              <Plus /> Lançar
            </Button>
          </div>
        </form>
      )}
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : lista.length === 0 ? (
        <div className="card-surface">
          <EmptyState icone={Clock} titulo="Nenhuma hora lançada" descricao="Use o formulário acima para registrar o tempo dedicado ao caso." />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b px-4 py-2.5 text-sm text-muted-foreground">
            <span>
              Total <strong className="font-mono text-foreground">{hhmm(totalMin)}</strong>
            </span>
            <span>
              A faturar <strong className="font-mono text-warning-ink">{hhmm(pendMin)}</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-3 py-2.5 font-medium">Profissional</th>
                  <th className="px-3 py-2.5 font-medium">Descrição</th>
                  <th className="px-3 py-2.5 text-right font-medium">Horas</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="w-20 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((t) => (
                  <tr key={t.id} className={cn("align-top", t.faturado && "bg-muted/20")}>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{data(t.data)}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{t.profissional_nome}</p>
                      <p className="text-[11px] text-muted-foreground">{t.cargo_nome ?? "sem cargo"}</p>
                    </td>
                    <td className="max-w-md px-3 py-3 whitespace-pre-line">{t.descricao}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{hhmm(t.minutos)}</td>
                    <td className="px-3 py-3">
                      {t.faturado ? <Travado codigo={t.fatura_codigo} /> : t.faturavel ? <Pill tom="warning">a faturar</Pill> : <Pill tom="neutral">não faturável</Pill>}
                    </td>
                    <td className="px-3 py-3">
                      {isOperador && !t.faturado && (
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Editar lançamento"
                            onClick={() => {
                              setFe({ profissional_id: String(t.profissional_id), data: t.data, horas: hhmm(t.minutos), descricao: t.descricao, faturavel: t.faturavel });
                              setEditar(t);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Excluir lançamento" onClick={() => setExcluir(t)}>
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <FormDialog
        open={!!editar}
        onOpenChange={(o) => !o && setEditar(null)}
        titulo="Editar horas"
        largura="lg"
        salvando={salvar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          const erro = validarHoras(fe);
          if (erro) return toast.error(erro);
          salvar.mutate();
        }}
      >
        <HorasForm f={fe} set={(k, v) => setFe((o) => ({ ...o, [k]: v }))} profs={profs} idp="ts-edit" />
      </FormDialog>
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este lançamento de horas?"
        descricao={excluir ? `${hhmm(excluir.minutos)} de ${excluir.profissional_nome} em ${data(excluir.data)}.` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}

// ================================================================ despesas
interface FormDespesa {
  data: string;
  tipo: TipoDespesa;
  descricao: string;
  valor: string;
  reembolsavel: boolean;
}

function DespesaDialog({ open, onOpenChange, caso, despesa }: { open: boolean; onOpenChange: (o: boolean) => void; caso: CasoOut; despesa: DespesaOut | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormDespesa>({ data: hoje(), tipo: "custas", descricao: "", valor: "", reembolsavel: true });
  const [arquivo, setArquivo] = useState<File | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(despesa ? { data: despesa.data, tipo: despesa.tipo, descricao: despesa.descricao, valor: paraBr(despesa.valor), reembolsavel: despesa.reembolsavel } : { data: hoje(), tipo: "custas", descricao: "", valor: "", reembolsavel: true });
    setArquivo(null);
  }, [open, despesa]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof FormDespesa>(k: K, v: FormDespesa[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: async () => {
      const body = { ...f, descricao: f.descricao.trim(), valor: paraApi(f.valor) };
      const d = despesa ? await api.put<DespesaOut>(`/faturamento/despesas/${despesa.id}`, body) : await api.post<DespesaOut>(`/faturamento/casos/${caso.id}/despesas`, body);
      if (arquivo) {
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        await api.post(`/faturamento/despesas/${d.id}/comprovante`, fd);
      }
      return d;
    },
    onSuccess: () => {
      toast.success(despesa ? "Despesa atualizada" : "Despesa lançada");
      qc.invalidateQueries({ queryKey: ["fat"] });
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={despesa ? "Editar despesa" : "Nova despesa"}
      descricao="Despesas reembolsáveis vão para a Nota de Despesas (ND) do cliente."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (f.descricao.trim().length < 2) return toast.error("Informe a descrição.");
        if (!valorOk(f.valor)) return toast.error("Informe um valor maior que zero, ex.: 150,00.");
        if (arquivo && arquivo.size > 15 * 1024 * 1024) return toast.error("O comprovante passa de 15 MB.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="desp-tipo">
          <NativeSelect id="desp-tipo" value={f.tipo} onChange={(e) => set("tipo", e.target.value as TipoDespesa)}>
            {Object.entries(ROTULO_DESPESA).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Data" htmlFor="desp-data">
          <Input id="desp-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
        </Field>
        <Field label="Descrição" obrigatorio htmlFor="desp-desc" className="sm:col-span-2">
          <Input id="desp-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={300} placeholder="ex.: Guia de custas iniciais" />
        </Field>
        <Field label="Valor" obrigatorio htmlFor="desp-valor">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <Input id="desp-valor" value={f.valor} inputMode="decimal" onChange={(e) => set("valor", e.target.value.replace(/[^\d,.]/g, ""))} className="pl-8 font-mono" placeholder="0,00" />
          </div>
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.reembolsavel} onCheckedChange={(v) => set("reembolsavel", v)} aria-label="Reembolsável pelo cliente" /> Reembolsável pelo cliente
          </label>
        </div>
        <Field label="Comprovante" htmlFor="desp-arquivo" dica={despesa?.tem_comprovante ? "Já tem comprovante; enviar outro substitui." : "PDF ou imagem, até 15 MB."} className="sm:col-span-2">
          <label htmlFor="desp-arquivo" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-sm transition hover:border-brand/50 hover:bg-brand/5">
            <Upload className="size-4 text-info-ink" />
            <span className="min-w-0 flex-1 truncate">{arquivo ? arquivo.name : "Escolher arquivo"}</span>
            {arquivo && <span className="text-xs text-muted-foreground">{(arquivo.size / 1024).toFixed(0)} KB</span>}
          </label>
          <input id="desp-arquivo" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </FormDialog>
  );
}

function Despesas({ caso }: { caso: CasoOut }) {
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const q = useQuery({ queryKey: ["fat", "despesas", caso.id], queryFn: () => api.get<DespesaOut[]>(`/faturamento/casos/${caso.id}/despesas`) });
  const [dlg, setDlg] = useState<{ d: DespesaOut | null } | null>(null);
  const [excluir, setExcluir] = useState<DespesaOut | null>(null);
  const upRef = useRef<HTMLInputElement>(null);
  const [upPara, setUpPara] = useState<number | null>(null);
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/despesas/${id}`),
    onSuccess: () => {
      toast.success("Despesa excluída");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const enviar = useMutation({
    mutationFn: ({ id, f }: { id: number; f: File }) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post(`/faturamento/despesas/${id}/comprovante`, fd);
    },
    onSuccess: () => {
      toast.success("Comprovante anexado");
      qc.invalidateQueries({ queryKey: ["fat", "despesas", caso.id] });
    },
  });
  const lista = q.data ?? [];
  const pend = lista.filter((d) => d.reembolsavel && !d.faturado).reduce((a, d) => a + toNum(d.valor), 0);

  return (
    <div className="space-y-4">
      <input
        ref={upRef}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        aria-label="Comprovante"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && upPara) enviar.mutate({ id: upPara, f });
          e.target.value = "";
        }}
      />
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : lista.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Wallet}
            titulo="Nenhuma despesa"
            descricao="Custas, cópias e deslocamentos lançados aqui viram Nota de Despesas para o cliente."
            acao={
              isOperador && (
                <Button onClick={() => setDlg({ d: null })}>
                  <Plus /> Nova despesa
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2.5 text-sm text-muted-foreground">
            <span>
              Total <strong className="font-mono text-foreground">{moeda(lista.reduce((a, d) => a + toNum(d.valor), 0))}</strong>
            </span>
            <span>
              A reembolsar <strong className="font-mono text-warning-ink">{moeda(pend)}</strong>
            </span>
            {isOperador && (
              <Button size="sm" className="ml-auto" onClick={() => setDlg({ d: null })}>
                <Plus /> Nova despesa
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">Descrição</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Comprovante</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="w-20 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((d) => (
                  <tr key={d.id} className={cn(d.faturado && "bg-muted/20")}>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{data(d.data)}</td>
                    <td className="px-3 py-3">{ROTULO_DESPESA[d.tipo]}</td>
                    <td className="max-w-sm px-3 py-3">
                      <p>{d.descricao}</p>
                      {d.lancado_por && <p className="text-[11px] text-muted-foreground">por {d.lancado_por}</p>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold whitespace-nowrap tabular-nums">{moeda(d.valor)}</td>
                    <td className="px-3 py-3">
                      {d.tem_comprovante ? (
                        <Button variant="ghost" size="xs" onClick={() => abrirArquivo(`/faturamento/despesas/${d.id}/comprovante`)}>
                          <Paperclip /> Ver
                        </Button>
                      ) : isOperador && !d.faturado ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={enviar.isPending}
                          onClick={() => {
                            setUpPara(d.id);
                            upRef.current?.click();
                          }}
                        >
                          <Upload /> Anexar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {d.faturado ? <Travado codigo={d.fatura_codigo} /> : d.reembolsavel ? <Pill tom="warning">a reembolsar</Pill> : <Pill tom="neutral">do escritório</Pill>}
                    </td>
                    <td className="px-3 py-3">
                      {isOperador && !d.faturado && (
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" aria-label="Editar despesa" onClick={() => setDlg({ d })}>
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Excluir despesa" onClick={() => setExcluir(d)}>
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <DespesaDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} caso={caso} despesa={dlg?.d ?? null} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir esta despesa?"
        descricao={excluir ? `${excluir.descricao} · ${moeda(excluir.valor)}` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}

export default function CasoPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const [aba, setAba] = useState("detalhes");
  const [editar, setEditar] = useState(false);
  const [preencher, setPreencher] = useState(false);
  const [resumo, setResumo] = useState(false);
  const q = useQuery({ queryKey: ["fat", "caso", cid], queryFn: () => api.get<CasoOut>(`/faturamento/casos/${cid}`) });
  const areas = useAreas();
  const campos = useCampos();
  const aplicarIA = useMutation({
    mutationFn: (patch: Partial<CasoIn>) => {
      const base = casoParaIn(q.data!);
      const corpo: CasoIn = { ...base, ...patch, campos: normalizarCampos({ ...base.campos, ...(patch.campos ?? {}) }, campos.data ?? []) };
      return api.put<CasoOut>(`/faturamento/casos/${cid}`, corpo);
    },
    onSuccess: (r) => {
      qc.setQueryData(["fat", "caso", cid], r);
      qc.invalidateQueries({ queryKey: ["fat"] });
      setPreencher(false);
      toast.success("Ficha atualizada com as sugestões da IA");
    },
  });
  if (q.isPending) return <Skeleton className="h-48 rounded-2xl" />;
  if (!q.data) return <EmptyState icone={Briefcase} titulo="Caso não encontrado" />;
  const c = q.data;

  return (
    <div>
      <Link href={`/faturamento/contratos/${c.contrato_id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Contrato #{c.contrato_numero} {c.contrato_nome}
      </Link>
      <div className="card-surface relative mb-5 overflow-hidden p-5">
        <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: c.area_cor ? c.area_cor : undefined }} />
        {!c.area_cor && <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">Caso #{c.numero}</span>
              <h1 className="text-2xl font-semibold tracking-tight">{c.titulo}</h1>
              <StatusBadge tom={c.status === "aberto" ? "success" : "neutral"} label={c.status === "aberto" ? "Aberto" : "Encerrado"} />
              {c.tipo_nome && <Pill tom="neutral">{c.tipo_nome}</Pill>}
              <AreaBadge nome={c.area_nome} cor={c.area_cor} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{c.tomador_nome}</span>
              {c.numero_processo && (
                <>
                  {" "}
                  · <span className="font-mono">{c.numero_processo}</span>
                </>
              )}
              {c.parte_contraria && ` · contra ${c.parte_contraria}`}
              {c.responsavel_nome && ` · resp. ${c.responsavel_nome}`}
              {c.data_abertura && ` · aberto em ${data(c.data_abertura)}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <CasoIAMenu podeEditar={isOperador} onPreencher={() => setPreencher(true)} onResumir={() => setResumo(true)} />
            {isOperador && (
              <Button variant="outline" size="sm" onClick={() => setEditar(true)}>
                <Pencil /> Editar
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="andamentos">
              Andamentos{c.qtd_andamentos > 0 && <span className="text-xs text-muted-foreground tabular-nums">{c.qtd_andamentos}</span>}
            </TabsTrigger>
            <TabsTrigger value="timesheet">
              <Clock /> Timesheet
            </TabsTrigger>
            <TabsTrigger value="despesas">
              <Receipt /> Despesas
            </TabsTrigger>
            <TabsTrigger value="anexos">
              Anexos{c.qtd_anexos > 0 && <span className="text-xs text-muted-foreground tabular-nums">{c.qtd_anexos}</span>}
            </TabsTrigger>
            <TabsTrigger value="regra">Regra de Cobrança</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="detalhes" className="pt-4">
          <DetalhesCaso caso={c} irPara={setAba} podeEditar={isOperador} onEditar={() => setEditar(true)} />
        </TabsContent>
        <TabsContent value="andamentos" className="pt-4">
          <AndamentosCaso casoId={c.id} />
        </TabsContent>
        <TabsContent value="timesheet" className="pt-4">
          <Timesheet caso={c} />
        </TabsContent>
        <TabsContent value="despesas" className="pt-4">
          <Despesas caso={c} />
        </TabsContent>
        <TabsContent value="anexos" className="pt-4">
          <AnexosCaso casoId={c.id} />
        </TabsContent>
        <TabsContent value="regra" className="pt-4">
          <RegrasCobranca
            contratoId={c.contrato_id}
            casoId={c.id}
            vazioTexto="Sem regra própria, o caso segue as regras do contrato. Crie uma se este caso é cobrado de outro jeito (ex.: êxito, valor fixo do processo)."
          />
        </TabsContent>
      </Tabs>
      <CasoDialog open={editar} onOpenChange={setEditar} contratoId={c.contrato_id} caso={c} />
      <PreencherCasoDialog
        open={preencher}
        onOpenChange={setPreencher}
        atual={casoParaIn(c)}
        areas={areas.data ?? []}
        campos={campos.data ?? []}
        aplicando={aplicarIA.isPending}
        onAplicar={(patch) => aplicarIA.mutate(patch)}
      />
      <ResumoCasoSheet casoId={c.id} titulo={`Caso #${c.numero} · ${c.titulo}`} aberto={resumo} onOpenChange={setResumo} />
    </div>
  );
}
