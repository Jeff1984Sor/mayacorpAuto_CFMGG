"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Receipt, Sparkles, Trash2, Upload, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, ApiError } from "@/lib/api";
import { type DespesaOut, ROTULO_DESPESA, type TipoDespesa } from "@/lib/faturamento";
import { moeda, tamanhoArquivo, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE");
const paraApi = (s: string) => String(toNum(s.replace(/\./g, "").replace(",", ".")));
const paraBr = (v: string | number) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const valorOk = (s: string) => /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s.trim()) && toNum(paraApi(s)) > 0;
const ehRecibo = (f: File) => /\.(pdf|png|jpe?g|webp|heic)$/i.test(f.name);

interface CamposRecibo {
  data?: string;
  tipo?: TipoDespesa;
  descricao?: string;
  valor?: string;
  fornecedor?: string;
}

/** Lê o recibo com a IA. Devolve os campos, ou a mensagem de erro (IA desligada, arquivo ilegível…). */
async function lerRecibo(f: File): Promise<{ campos: CamposRecibo } | { erro: string }> {
  const fd = new FormData();
  fd.append("arquivo", f);
  try {
    return await api.post<{ campos: CamposRecibo }>("/faturamento/ia/ler-recibo", fd);
  } catch (e) {
    return { erro: e instanceof ApiError ? e.message : "Não foi possível ler o recibo." };
  }
}

async function enviarComprovante(despesaId: number, f: File) {
  const fd = new FormData();
  fd.append("arquivo", f);
  await api.post(`/faturamento/despesas/${despesaId}/comprovante`, fd);
}

function DicaIA() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-info-ink">
      <Sparkles className="size-3" /> preenchido pela IA
    </span>
  );
}

// ================================================================ nova/editar despesa (com leitura do recibo)
interface FormDespesa {
  data: string;
  tipo: TipoDespesa;
  descricao: string;
  valor: string;
  reembolsavel: boolean;
}

export function DespesaDialog({ open, onOpenChange, casoId, despesa }: { open: boolean; onOpenChange: (o: boolean) => void; casoId: number; despesa: DespesaOut | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormDespesa>({ data: hoje(), tipo: "custas", descricao: "", valor: "", reembolsavel: true });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [tocados, setTocados] = useState<Set<keyof FormDespesa>>(new Set());
  const [ia, setIa] = useState<Set<keyof FormDespesa>>(new Set());
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(despesa ? { data: despesa.data, tipo: despesa.tipo, descricao: despesa.descricao, valor: paraBr(despesa.valor), reembolsavel: despesa.reembolsavel } : { data: hoje(), tipo: "custas", descricao: "", valor: "", reembolsavel: true });
    setArquivo(null);
    setTocados(new Set(despesa ? (["data", "tipo", "descricao", "valor"] as const) : []));
    setIa(new Set());
    setAviso(null);
  }, [open, despesa]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof FormDespesa>(k: K, v: FormDespesa[K]) => {
    setF((o) => ({ ...o, [k]: v }));
    setTocados((t) => new Set(t).add(k));
    setIa((s) => {
      const n = new Set(s);
      n.delete(k);
      return n;
    });
  };

  const escolher = async (file: File | null) => {
    setArquivo(file);
    setAviso(null);
    if (!file || !ehRecibo(file)) return;
    setLendo(true);
    const r = await lerRecibo(file);
    setLendo(false);
    if ("erro" in r) {
      setAviso(`${r.erro} O arquivo continua anexado como comprovante.`);
      return;
    }
    const c = r.campos;
    const novos = new Set<keyof FormDespesa>();
    const n = { ...f };
    const pode = (k: keyof FormDespesa, vazio: boolean) => !tocados.has(k) && vazio;
    if (c.data && pode("data", true)) {
      n.data = c.data;
      novos.add("data");
    }
    if (c.tipo && pode("tipo", true)) {
      n.tipo = c.tipo;
      novos.add("tipo");
    }
    if (c.descricao && pode("descricao", !f.descricao.trim())) {
      n.descricao = c.descricao;
      novos.add("descricao");
    }
    if (c.valor && pode("valor", !f.valor.trim())) {
      n.valor = paraBr(c.valor);
      novos.add("valor");
    }
    setF(n);
    setIa(novos);
    if (!Object.keys(c).length) setAviso("Não consegui ler os dados deste recibo. Preencha à mão; o arquivo segue como comprovante.");
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const body = { ...f, descricao: f.descricao.trim(), valor: paraApi(f.valor) };
      const d = despesa ? await api.put<DespesaOut>(`/faturamento/despesas/${despesa.id}`, body) : await api.post<DespesaOut>(`/faturamento/casos/${casoId}/despesas`, body);
      if (arquivo) await enviarComprovante(d.id, arquivo);
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
      descricao="Anexe o recibo primeiro: a IA lê e preenche os campos para você."
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
        <Field label="Comprovante" htmlFor="desp-arquivo" dica={despesa?.tem_comprovante ? "Já tem comprovante; enviar outro substitui." : "PDF ou foto do recibo, até 15 MB."} className="sm:col-span-2">
          <label
            htmlFor="desp-arquivo"
            className={cn(
              "relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl border border-dashed px-3 py-3 text-sm transition hover:border-brand/50 hover:bg-brand/5",
              lendo && "border-brand/50 bg-brand/5",
            )}
          >
            {lendo ? <Loader2 className="size-4 animate-spin text-info-ink" /> : arquivo ? <Receipt className="size-4 text-info-ink" /> : <Upload className="size-4 text-info-ink" />}
            <span className="min-w-0 flex-1 truncate">{lendo ? "Lendo o recibo…" : arquivo ? arquivo.name : "Escolher o recibo"}</span>
            {arquivo && !lendo && <span className="text-xs text-muted-foreground">{tamanhoArquivo(arquivo.size)}</span>}
            {lendo && <span className="ia-shimmer pointer-events-none absolute inset-0" />}
          </label>
          <input id="desp-arquivo" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => escolher(e.target.files?.[0] ?? null)} />
          {aviso && <p className="mt-1.5 text-xs text-muted-foreground">{aviso}</p>}
        </Field>
        <Field label="Tipo" htmlFor="desp-tipo" dica={ia.has("tipo") ? <DicaIA /> : undefined}>
          <NativeSelect id="desp-tipo" value={f.tipo} onChange={(e) => set("tipo", e.target.value as TipoDespesa)} className={cn(ia.has("tipo") && "border-brand/50 bg-brand/5")}>
            {Object.entries(ROTULO_DESPESA).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Data" htmlFor="desp-data" dica={ia.has("data") ? <DicaIA /> : undefined}>
          <Input id="desp-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} className={cn(ia.has("data") && "border-brand/50 bg-brand/5")} />
        </Field>
        <Field label="Descrição" obrigatorio htmlFor="desp-desc" className="sm:col-span-2" dica={ia.has("descricao") ? <DicaIA /> : undefined}>
          <Input id="desp-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={300} placeholder="ex.: Guia de custas iniciais" className={cn(ia.has("descricao") && "border-brand/50 bg-brand/5")} />
        </Field>
        <Field label="Valor" obrigatorio htmlFor="desp-valor" dica={ia.has("valor") ? <DicaIA /> : undefined}>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
            <Input
              id="desp-valor"
              value={f.valor}
              inputMode="decimal"
              onChange={(e) => set("valor", e.target.value.replace(/[^\d,.]/g, ""))}
              className={cn("pl-8 font-mono", ia.has("valor") && "border-brand/50 bg-brand/5")}
              placeholder="0,00"
            />
          </div>
        </Field>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={f.reembolsavel} onCheckedChange={(v) => set("reembolsavel", v)} aria-label="Reembolsável pelo cliente" /> Reembolsável pelo cliente
          </label>
        </div>
      </div>
    </FormDialog>
  );
}

// ================================================================ lançar recibos em lote
type Leitura = "fila" | "lendo" | "ok" | "ilegivel";
type Envio = null | "enviando" | "ok" | "erro";
interface Linha {
  id: number;
  file: File;
  thumb: string | null;
  leitura: Leitura;
  erroLeitura: string | null;
  data: string;
  tipo: TipoDespesa;
  descricao: string;
  valor: string;
  reembolsavel: boolean;
  envio: Envio;
  erroEnvio: string | null;
}

let seq = 1;
const pendencias = (l: Linha) => {
  const p: string[] = [];
  if (!l.data) p.push("data");
  if (l.descricao.trim().length < 2) p.push("descrição");
  if (!valorOk(l.valor)) p.push("valor");
  return p;
};

export function LancarRecibosDialog({ open, onOpenChange, casoId }: { open: boolean; onOpenChange: (o: boolean) => void; casoId: number }) {
  const qc = useQueryClient();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [lancando, setLancando] = useState(false);
  const fila = useRef<number[]>([]);
  const ativos = useRef(0);
  const arquivos = useRef(new Map<number, File>());
  const [iaDesligada, setIaDesligada] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- recomeça ao abrir */
  useEffect(() => {
    if (!open) return;
    setLinhas((o) => {
      o.forEach((l) => l.thumb && URL.revokeObjectURL(l.thumb));
      return [];
    });
    fila.current = [];
    arquivos.current = new Map();
    setIaDesligada(false);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const atualizar = (id: number, mud: Partial<Linha>) => setLinhas((o) => o.map((l) => (l.id === id ? { ...l, ...mud } : l)));

  const proximo = () => {
    while (ativos.current < 2 && fila.current.length) {
      const id = fila.current.shift()!;
      const file = arquivos.current.get(id);
      if (!file) continue;
      ativos.current++;
      atualizar(id, { leitura: "lendo" });
      lerRecibo(file).then((r) => {
        ativos.current--;
        if ("erro" in r) {
          if (/IA|intelig/i.test(r.erro)) setIaDesligada(true);
          atualizar(id, { leitura: "ilegivel", erroLeitura: r.erro });
        } else {
          const c = r.campos;
          const ok = !!(c.descricao && c.valor);
          setLinhas((o) =>
            o.map((l) =>
              l.id === id
                ? {
                    ...l,
                    leitura: ok ? "ok" : "ilegivel",
                    erroLeitura: ok ? null : "Recibo pouco legível: complete os campos.",
                    data: c.data ?? l.data,
                    tipo: c.tipo ?? l.tipo,
                    descricao: c.descricao ?? (c.fornecedor ? c.fornecedor : l.descricao),
                    valor: c.valor ? paraBr(c.valor) : l.valor,
                  }
                : l,
            ),
          );
        }
        proximo();
      });
    }
  };

  const adicionar = (files: File[]) => {
    const novas: Linha[] = files.map((file) => ({
      id: seq++,
      file,
      thumb: /^image\//.test(file.type) ? URL.createObjectURL(file) : null,
      leitura: "fila",
      erroLeitura: null,
      data: hoje(),
      tipo: "outros",
      descricao: "",
      valor: "",
      reembolsavel: true,
      envio: null,
      erroEnvio: null,
    }));
    novas.forEach((l) => arquivos.current.set(l.id, l.file));
    setLinhas((o) => [...o, ...novas]);
    fila.current.push(...novas.map((l) => l.id));
    setTimeout(proximo, 0);
  };

  const dz = useDropzone({
    multiple: true,
    maxSize: 15 * 1024 * 1024,
    disabled: lancando,
    accept: { "application/pdf": [".pdf"], "image/*": [".png", ".jpg", ".jpeg", ".webp", ".heic"] },
    onDrop: adicionar,
    onDropRejected: (r) => toast.error(`${r.length} arquivo(s) recusado(s): use PDF ou foto de até 15 MB.`),
  });

  const pendentes = linhas.filter((l) => l.envio !== "ok");
  const lendo = linhas.some((l) => l.leitura === "lendo" || l.leitura === "fila");
  const bloqueadas = pendentes.filter((l) => pendencias(l).length > 0);
  const total = pendentes.reduce((a, l) => a + (valorOk(l.valor) ? toNum(paraApi(l.valor)) : 0), 0);
  const lidas = linhas.filter((l) => l.leitura !== "fila" && l.leitura !== "lendo").length;

  const lancar = async () => {
    setLancando(true);
    let ok = 0;
    let falhas = 0;
    for (const l of pendentes) {
      atualizar(l.id, { envio: "enviando", erroEnvio: null });
      try {
        const d = await api.post<DespesaOut>(
          `/faturamento/casos/${casoId}/despesas`,
          { data: l.data, tipo: l.tipo, descricao: l.descricao.trim(), valor: paraApi(l.valor), reembolsavel: l.reembolsavel },
        );
        await enviarComprovante(d.id, l.file);
        atualizar(l.id, { envio: "ok" });
        ok++;
      } catch (e) {
        atualizar(l.id, { envio: "erro", erroEnvio: e instanceof ApiError ? e.message : "Falhou" });
        falhas++;
      }
    }
    setLancando(false);
    qc.invalidateQueries({ queryKey: ["fat"] });
    if (falhas) toast.warning(`${ok} despesa(s) lançada(s), ${falhas} com erro. Corrija e tente de novo.`);
    else {
      toast.success(`${ok} despesa(s) lançada(s) com os comprovantes`);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !lancando && onOpenChange(o)}>
      <DialogContent className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <div className="relative overflow-hidden border-b px-5 py-4 pr-12">
          <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand/20 blur-3xl" />
          <DialogTitle className="relative flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/30">
              <Receipt className="size-[18px]" />
            </span>
            Lançar recibos em lote
          </DialogTitle>
          <DialogDescription className="relative mt-1">Solte vários recibos de uma vez: a IA lê cada um, você confere e lança tudo com os comprovantes.</DialogDescription>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div
            {...dz.getRootProps()}
            className={cn(
              "flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-5 transition",
              dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40",
              linhas.length === 0 && "flex-col py-12 text-center",
            )}
          >
            <input {...dz.getInputProps()} aria-label="Recibos" />
            <span className={cn("grid place-items-center rounded-2xl brand-gradient text-white shadow-lg shadow-brand/25", linhas.length ? "size-10" : "size-14")}>
              <Upload className={linhas.length ? "size-5" : "size-6"} />
            </span>
            <div className={cn(linhas.length === 0 && "space-y-1")}>
              <p className="text-sm font-medium">{linhas.length ? "Adicionar mais recibos" : "Arraste os recibos aqui ou clique para escolher"}</p>
              <p className="text-xs text-muted-foreground">PDF ou fotos (Uber, guias de custas, cópias, Correios…) · até 15 MB cada</p>
            </div>
            {linhas.length > 0 && (
              <div className="ml-auto w-40 text-right">
                <p className="text-xs text-muted-foreground">
                  {lidas} de {linhas.length} lido(s)
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div className="h-full rounded-full brand-gradient" animate={{ width: `${(lidas / linhas.length) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {iaDesligada && (
            <p className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Sparkles className="size-3.5" /> A IA está desligada: preencha os dados de cada recibo abaixo. Os arquivos seguem como comprovantes.
            </p>
          )}

          {linhas.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Recibo</th>
                    <th className="px-2 py-2.5 font-medium">Data</th>
                    <th className="px-2 py-2.5 font-medium">Tipo</th>
                    <th className="px-2 py-2.5 font-medium">Descrição</th>
                    <th className="px-2 py-2.5 text-right font-medium">Valor</th>
                    <th className="px-2 py-2.5 text-center font-medium">Reemb.</th>
                    <th className="w-10 px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <AnimatePresence initial={false}>
                    {linhas.map((l) => {
                      const falta = pendencias(l);
                      const travada = l.envio === "ok" || l.envio === "enviando" || lancando;
                      return (
                        <motion.tr
                          key={l.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className={cn("align-top", l.envio === "ok" && "bg-success/5", l.envio === "erro" && "bg-danger/5")}
                        >
                          <td className="w-56 px-3 py-2.5">
                            <div className="flex items-start gap-2.5">
                              <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
                                {l.thumb ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- prévia local do arquivo escolhido
                                  <img src={l.thumb} alt="" className="size-full object-cover" />
                                ) : (
                                  <FileText className="size-5 text-danger-ink" />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium" title={l.file.name}>
                                  {l.file.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{tamanhoArquivo(l.file.size)}</p>
                                {l.leitura === "lendo" || l.leitura === "fila" ? (
                                  <div className="mt-1.5">
                                    <div className="relative h-1 overflow-hidden rounded-full bg-muted">
                                      {l.leitura === "lendo" && <div className="ia-shimmer absolute inset-0 rounded-full bg-brand/40" />}
                                    </div>
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">{l.leitura === "lendo" ? "Lendo…" : "Na fila"}</p>
                                  </div>
                                ) : l.envio === "ok" ? (
                                  <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-success-ink">
                                    <CheckCircle2 className="size-3" /> lançada
                                  </p>
                                ) : l.envio === "enviando" ? (
                                  <p className="mt-1 flex items-center gap-1 text-[11px] text-info-ink">
                                    <Loader2 className="size-3 animate-spin" /> lançando…
                                  </p>
                                ) : l.envio === "erro" ? (
                                  <p className="mt-1 flex items-center gap-1 text-[11px] text-danger-ink" title={l.erroEnvio ?? ""}>
                                    <XCircle className="size-3" /> {l.erroEnvio}
                                  </p>
                                ) : l.leitura === "ok" ? (
                                  <p className="mt-1 flex items-center gap-1 text-[11px] text-info-ink">
                                    <Sparkles className="size-3" /> lido pela IA
                                  </p>
                                ) : (
                                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning-ink" title={l.erroLeitura ?? ""}>
                                    <AlertTriangle className="size-3" /> preencha à mão
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="w-36 px-2 py-2.5">
                            <Input aria-label="Data" type="date" value={l.data} disabled={travada} onChange={(e) => atualizar(l.id, { data: e.target.value })} className={cn("h-8", falta.includes("data") && "border-danger")} />
                          </td>
                          <td className="w-40 px-2 py-2.5">
                            <NativeSelect aria-label="Tipo" value={l.tipo} disabled={travada} onChange={(e) => atualizar(l.id, { tipo: e.target.value as TipoDespesa })} className="h-8">
                              {Object.entries(ROTULO_DESPESA).map(([k, r]) => (
                                <option key={k} value={k}>
                                  {r}
                                </option>
                              ))}
                            </NativeSelect>
                          </td>
                          <td className="px-2 py-2.5">
                            <Input
                              aria-label="Descrição"
                              value={l.descricao}
                              disabled={travada}
                              onChange={(e) => atualizar(l.id, { descricao: e.target.value })}
                              maxLength={300}
                              className={cn("h-8", falta.includes("descrição") && l.leitura !== "lendo" && l.leitura !== "fila" && "border-danger")}
                            />
                          </td>
                          <td className="w-36 px-2 py-2.5">
                            <div className="relative">
                              <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">R$</span>
                              <Input
                                aria-label="Valor"
                                inputMode="decimal"
                                value={l.valor}
                                disabled={travada}
                                onChange={(e) => atualizar(l.id, { valor: e.target.value.replace(/[^\d,.]/g, "") })}
                                onBlur={() => valorOk(l.valor) && atualizar(l.id, { valor: paraBr(paraApi(l.valor)) })}
                                className={cn("h-8 pl-7 text-right font-mono", falta.includes("valor") && l.leitura !== "lendo" && l.leitura !== "fila" && "border-danger")}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-center">
                            <Switch checked={l.reembolsavel} disabled={travada} onCheckedChange={(v) => atualizar(l.id, { reembolsavel: v })} aria-label="Reembolsável" />
                          </td>
                          <td className="px-2 py-2.5">
                            {l.envio !== "ok" && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={lancando}
                                aria-label={`Tirar ${l.file.name}`}
                                onClick={() => {
                                  if (l.thumb) URL.revokeObjectURL(l.thumb);
                                  fila.current = fila.current.filter((x) => x !== l.id);
                                  setLinhas((o) => o.filter((x) => x.id !== l.id));
                                }}
                              >
                                <Trash2 />
                              </Button>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t bg-card px-5 py-3">
          <div className="mr-auto text-sm">
            <span className="text-muted-foreground">{pendentes.length} despesa(s) · total </span>
            <strong className="font-mono text-base tabular-nums">{moeda(total)}</strong>
            {bloqueadas.length > 0 && !lendo && <span className="ml-2 text-xs text-danger-ink">{bloqueadas.length} com campo faltando</span>}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={lancando}>
            Cancelar
          </Button>
          <Button onClick={lancar} disabled={lancando || lendo || pendentes.length === 0 || bloqueadas.length > 0}>
            {lancando ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Lançar {pendentes.length} despesa(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
