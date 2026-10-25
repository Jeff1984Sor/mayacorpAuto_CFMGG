"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, FileText, ListChecks, Loader2, RefreshCw, ShieldAlert, Sparkles, Upload, Wand2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { AvisoIADesativada, IaButtonVisual, useIAAtiva } from "@/components/ia/ia-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { type AreaOut, type CampoOut, type CasoIn, ROTULO_POLO, ROTULO_TIPO_CASO, type Polo, type TipoCaso, type ResumoCaso, type SugestaoCaso, type ValorCampo } from "@/lib/faturamento";
import { data, dataHora, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { exibirCampo } from "./campos-adicionais";
import { ROTULO_INSTANCIA } from "./judiciario";

const ROTULOS: Record<string, string> = {
  titulo: "Título",
  numero_processo: "Nº do processo",
  parte_contraria: "Parte contrária",
  tipo: "Tipo do caso",
  instancia: "Instância",
  area_id: "Área de atuação",
  polo: "Polo",
  tribunal: "Tribunal",
  vara: "Vara",
  comarca: "Comarca",
  valor_causa: "Valor da causa",
  data_distribuicao: "Distribuição",
  descricao: "Descrição",
};

interface Linha {
  chave: string; // campo da ficha ou "campo:<id>"
  rotulo: string;
  atual: string | null;
  sugerido: string;
}

/** Monta a lista "atual → sugerido" para revisão. */
function linhasDaSugestao(s: SugestaoCaso, atual: CasoIn, areas: AreaOut[], campos: CampoOut[]): Linha[] {
  const fmt = (k: string, v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (k === "area_id") return areas.find((a) => a.id === Number(v))?.nome ?? String(v);
    if (k === "polo") return ROTULO_POLO[v as Polo] ?? String(v);
    if (k === "tipo") return ROTULO_TIPO_CASO[v as TipoCaso] ?? String(v);
    if (k === "instancia") return ROTULO_INSTANCIA[String(v)] ?? String(v);
    if (k === "valor_causa") return moeda(toNum(String(v)));
    if (k === "data_distribuicao") return data(String(v));
    return String(v);
  };
  const out: Linha[] = [];
  for (const k of Object.keys(ROTULOS)) {
    const v = (s as Record<string, unknown>)[k];
    const sug = fmt(k, v);
    if (sug === null) continue;
    const at = fmt(k, (atual as unknown as Record<string, unknown>)[k]);
    if (at === sug) continue;
    out.push({ chave: k, rotulo: ROTULOS[k], atual: at, sugerido: sug });
  }
  for (const [id, v] of Object.entries(s.campos ?? {})) {
    const c = campos.find((x) => String(x.id) === id);
    if (!c) continue;
    const sug = exibirCampo(c, v);
    if (!sug) continue;
    const at = exibirCampo(c, atual.campos?.[id]);
    if (at === sug) continue;
    out.push({ chave: `campo:${id}`, rotulo: c.nome, atual: at, sugerido: sug });
  }
  return out;
}

/** "Preencher com IA": texto colado e/ou arquivo → sugestões revisadas uma a uma. */
export function PreencherCasoDialog({
  open,
  onOpenChange,
  atual,
  areas,
  campos,
  onAplicar,
  aplicando,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  atual: CasoIn;
  areas: AreaOut[];
  campos: CampoOut[];
  onAplicar: (patch: Partial<CasoIn>) => void;
  aplicando?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [sug, setSug] = useState<SugestaoCaso | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- recomeça ao abrir */
  useEffect(() => {
    if (open) {
      setTexto("");
      setArquivo(null);
      setSug(null);
      setErro(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const linhas = sug ? linhasDaSugestao(sug, atual, areas, campos) : [];
  const ler = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      if (texto.trim()) fd.append("texto", texto.trim());
      if (arquivo) fd.append("arquivo", arquivo);
      return api.post<{ campos: SugestaoCaso }>("/faturamento/casos/ia/preencher", fd);
    },
    meta: { silencioso: true },
    onMutate: () => setErro(null),
    onSuccess: (r) => {
      setSug(r.campos);
      setMarcados(new Set(linhasDaSugestao(r.campos, atual, areas, campos).map((l) => l.chave)));
    },
    onError: (e) => setErro(e instanceof ApiError ? e.message : "A IA não conseguiu ler agora."),
  });
  const dz = useDropzone({
    multiple: false,
    maxSize: 15 * 1024 * 1024,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
      "image/*": [".png", ".jpg", ".jpeg", ".webp"],
    },
    onDrop: (f) => f[0] && setArquivo(f[0]),
    onDropRejected: () => toast.error("Use PDF, DOCX, TXT ou imagem de até 15 MB."),
  });
  const aplicar = () => {
    if (!sug) return;
    const patch: Partial<CasoIn> = {};
    const camposNovos: Record<string, ValorCampo> = { ...(atual.campos ?? {}) };
    marcados.forEach((k) => {
      if (k.startsWith("campo:")) {
        const id = k.slice(6);
        camposNovos[id] = sug.campos?.[id] ?? null;
      } else (patch as Record<string, unknown>)[k] = (sug as Record<string, unknown>)[k];
    });
    if ([...marcados].some((k) => k.startsWith("campo:"))) patch.campos = camposNovos;
    onAplicar(patch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="relative border-b p-5 pr-12">
          <div className="pointer-events-none absolute -top-12 -right-6 size-36 rounded-full bg-brand/20 blur-3xl" />
          <DialogTitle className="relative flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg brand-gradient text-white">
              <Sparkles className="size-4" />
            </span>
            Preencher a ficha com IA
          </DialogTitle>
          <DialogDescription className="relative mt-1">Envie a petição, a decisão ou um e-mail. A IA sugere os campos e você escolhe o que aplicar.</DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!sug ? (
            <div className="space-y-3">
              <div
                {...dz.getRootProps()}
                className={cn(
                  "relative flex cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition",
                  dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40",
                )}
              >
                <input {...dz.getInputProps()} aria-label="Documento do caso" />
                {arquivo ? <FileText className="size-7 text-info-ink" /> : <Upload className="size-7 text-info-ink" />}
                <p className="text-sm font-medium">{arquivo ? arquivo.name : "Arraste um arquivo ou clique para escolher"}</p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, TXT ou imagem · até 15 MB</p>
                {arquivo && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setArquivo(null);
                    }}
                    className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Tirar o arquivo"
                  >
                    <X className="size-4" />
                  </button>
                )}
                {ler.isPending && <div className="ia-shimmer pointer-events-none absolute inset-0" />}
              </div>
              <div className="relative">
                <Textarea
                  aria-label="Texto do documento"
                  rows={7}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="…ou cole aqui o texto (petição inicial, publicação, e-mail do cliente)"
                  className="resize-none text-sm"
                  disabled={ler.isPending}
                />
                {ler.isPending && <div className="ia-shimmer pointer-events-none absolute inset-0 rounded-lg" />}
              </div>
              {erro && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-sm text-warning-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {erro}
                </p>
              )}
            </div>
          ) : linhas.length === 0 ? (
            <div className="py-8 text-center">
              <Check className="mx-auto size-8 text-success-ink" />
              <p className="mt-2 font-medium">Nada novo para preencher</p>
              <p className="text-sm text-muted-foreground">A ficha já tem o que a IA encontrou no documento.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{linhas.length} sugestão(ões)</p>
                <button
                  type="button"
                  className="text-xs text-info-ink hover:underline"
                  onClick={() => setMarcados(marcados.size === linhas.length ? new Set() : new Set(linhas.map((l) => l.chave)))}
                >
                  {marcados.size === linhas.length ? "Desmarcar todas" : "Marcar todas"}
                </button>
              </div>
              <ul className="divide-y rounded-xl border">
                {linhas.map((l, i) => (
                  <motion.li key={l.chave} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                    <label className={cn("flex cursor-pointer gap-3 px-3 py-2.5 transition-colors", marcados.has(l.chave) ? "bg-brand/[0.04]" : "opacity-70")}>
                      <Checkbox
                        className="mt-0.5"
                        checked={marcados.has(l.chave)}
                        onCheckedChange={(v) =>
                          setMarcados((s) => {
                            const n = new Set(s);
                            if (v) n.add(l.chave);
                            else n.delete(l.chave);
                            return n;
                          })
                        }
                        aria-label={`Aplicar ${l.rotulo}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-muted-foreground">{l.rotulo}</span>
                        <span className="mt-0.5 flex flex-wrap items-start gap-x-2 gap-y-1 text-sm">
                          {l.atual && <span className="rounded bg-danger/8 px-1.5 text-danger-ink line-through decoration-danger/40">{l.atual}</span>}
                          {l.atual && <ArrowRight className="mt-0.5 size-3.5 text-muted-foreground" />}
                          <span className={cn("rounded bg-success/10 px-1.5 text-success-ink", l.chave === "descricao" && "whitespace-pre-line")}>{l.sugerido}</span>
                        </span>
                      </span>
                    </label>
                  </motion.li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">Sugestões da IA: confira antes de salvar.</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-card px-5 py-3">
          {sug && (
            <Button variant="ghost" className="mr-auto" onClick={() => setSug(null)}>
              <RefreshCw /> Ler outro documento
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {!sug ? (
            <Button onClick={() => ler.mutate()} disabled={ler.isPending || (!arquivo && texto.trim().length < 20)}>
              {ler.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {ler.isPending ? "Lendo…" : "Ler com IA"}
            </Button>
          ) : (
            linhas.length > 0 && (
              <Button onClick={aplicar} disabled={!marcados.size || aplicando}>
                {aplicando ? <Loader2 className="animate-spin" /> : <Check />} Aplicar {marcados.size}
              </Button>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resumoTexto(r: ResumoCaso, titulo: string) {
  return [
    titulo,
    "",
    r.resumo,
    "",
    `Situação atual: ${r.situacao_atual}`,
    "",
    "Próximos passos:",
    ...r.proximos_passos.map((p) => `• ${p}`),
    "",
    "Riscos:",
    ...r.riscos.map((p) => `• ${p}`),
    "",
    "Gerado por IA, confira antes de usar.",
  ].join("\n");
}

/** Resumo do caso gerado pela IA. */
export function ResumoCasoSheet({ casoId, titulo, aberto, onOpenChange }: { casoId: number; titulo: string; aberto: boolean; onOpenChange: (o: boolean) => void }) {
  const [r, setR] = useState<ResumoCaso | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const gerar = useMutation({
    mutationFn: () => api.post<ResumoCaso>(`/faturamento/casos/${casoId}/ia/resumo`),
    meta: { silencioso: true },
    onMutate: () => setErro(null),
    onSuccess: setR,
    onError: (e) => setErro(e instanceof ApiError ? e.message : "Não foi possível resumir agora."),
  });
  // gera ao abrir pela primeira vez
  useEffect(() => {
    if (aberto && !r && !gerar.isPending && !erro) gerar.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir
  }, [aberto]);
  const copiar = async () => {
    if (!r) return;
    await navigator.clipboard.writeText(resumoTexto(r, titulo));
    toast.success("Resumo copiado");
  };
  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="relative overflow-hidden border-b">
          <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-brand/20 blur-3xl" />
          <SheetTitle className="relative flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg brand-gradient text-white">
              <Sparkles className="size-4" />
            </span>
            Resumo do caso
          </SheetTitle>
          <SheetDescription className="relative">{titulo}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 p-5">
          {gerar.isPending ? (
            <div className="space-y-3">
              {[90, 70, 80, 60].map((w, i) => (
                <div key={i} className="ia-shimmer h-4 rounded" style={{ width: `${w}%` }} />
              ))}
              <p className="pt-2 text-xs text-muted-foreground">Lendo ficha, andamentos, horas e despesas…</p>
            </div>
          ) : erro ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-sm text-warning-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {erro}
            </p>
          ) : r ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
              <p className="text-[15px] leading-relaxed">{r.resumo}</p>
              <section className="rounded-xl border bg-brand/5 p-3">
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-info-ink uppercase">Situação atual</h3>
                <p className="text-sm">{r.situacao_atual}</p>
              </section>
              {r.proximos_passos.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <ListChecks className="size-3.5" /> Próximos passos
                  </h3>
                  <ol className="space-y-1.5">
                    {r.proximos_passos.map((p, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/12 text-[11px] font-semibold text-success-ink">{i + 1}</span>
                        {p}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {r.riscos.length > 0 && (
                <section>
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <ShieldAlert className="size-3.5" /> Riscos
                  </h3>
                  <ul className="space-y-1.5">
                    {r.riscos.map((p, i) => (
                      <li key={i} className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm">
                        {p}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="text-[11px] text-muted-foreground">Gerado por IA em {dataHora(r.gerado_em)}. Confira antes de usar.</p>
            </motion.div>
          ) : null}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="ghost" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
            <RefreshCw /> Gerar de novo
          </Button>
          <Button onClick={copiar} disabled={!r}>
            <Copy /> Copiar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Botão ✨ IA do cabeçalho do caso, com as duas ações. */
export function CasoIAMenu({ onPreencher, onResumir, podeEditar }: { onPreencher: () => void; onResumir: () => void; podeEditar: boolean }) {
  const { ativa, carregando, permitida } = useIAAtiva();
  if (!permitida) return null;
  if (!carregando && !ativa) return <AvisoIADesativada>IA</AvisoIADesativada>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IaButtonVisual disabled={carregando} />}>
        IA <ChevronDown className="!size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {podeEditar && (
          <DropdownMenuItem onClick={onPreencher}>
            <Wand2 />
            <span>
              <span className="block">Preencher com IA</span>
              <span className="block text-xs text-muted-foreground">a partir da petição ou de um e-mail</span>
            </span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onResumir}>
          <FileText />
          <span>
            <span className="block">Resumir caso</span>
            <span className="block text-xs text-muted-foreground">situação, próximos passos e riscos</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
