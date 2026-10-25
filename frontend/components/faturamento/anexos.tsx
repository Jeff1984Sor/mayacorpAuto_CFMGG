"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  Eye,
  File,
  Folder,
  FolderOpen,
  ListTodo,
  Receipt,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Presentation,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Segmented } from "@/components/mayacorp/data-table";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, baixar, baixarBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AnexoOut } from "@/lib/faturamento";

import { TarefaDialog, useTarefa } from "./tarefas";
import { relativo, tamanhoArquivo } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORIAS = ["Petição", "Procuração", "Contrato", "Decisão", "Comprovante", "Outros"];
const ACEITOS = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip,.msg,.eml,.odt,.ods,.rtf,.xml";
const MAX = 50 * 1024 * 1024;

const ext = (nome: string) => nome.split(".").pop()?.toLowerCase() ?? "";
function iconeDo(nome: string): { i: React.ComponentType<{ className?: string }>; cor: string } {
  const e = ext(nome);
  if (e === "pdf") return { i: FileText, cor: "bg-danger/10 text-danger-ink" };
  if (["doc", "docx", "odt", "rtf", "txt"].includes(e)) return { i: FileText, cor: "bg-brand/12 text-info-ink" };
  if (["xls", "xlsx", "ods", "csv"].includes(e)) return { i: FileSpreadsheet, cor: "bg-success/10 text-success-ink" };
  if (["ppt", "pptx"].includes(e)) return { i: Presentation, cor: "bg-warning/14 text-warning-ink" };
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return { i: FileImage, cor: "bg-violet-500/12 text-violet-700 dark:text-violet-300" };
  if (e === "zip") return { i: FileArchive, cor: "bg-muted text-muted-foreground" };
  if (["msg", "eml"].includes(e)) return { i: Mail, cor: "bg-sky-500/12 text-sky-700 dark:text-sky-300" };
  return { i: File, cor: "bg-muted text-muted-foreground" };
}
const previsualiza = (nome: string) => ["pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(ext(nome));

function Previa({ anexo, onClose }: { anexo: AnexoOut | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!anexo) return;
    let u: string | null = null;
    baixarBlob(`/faturamento/anexos/${anexo.id}`)
      .then(({ blob }) => {
        u = URL.createObjectURL(blob);
        setUrl(u);
      })
      .catch(() => toast.error("Não foi possível abrir o arquivo."));
    return () => {
      if (u) URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [anexo]);
  return (
    <Dialog open={!!anexo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <div className="flex items-center gap-2 border-b px-4 py-2.5 pr-12">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{anexo?.nome}</DialogTitle>
          {anexo && (
            <Button size="sm" variant="outline" onClick={() => baixar(`/faturamento/anexos/${anexo.id}`, { query: { download: true } }, anexo.nome)}>
              <Download /> Baixar
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 bg-muted/40" data-ia-ignorar>
          {!url ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : anexo && ext(anexo.nome) === "pdf" ? (
            <iframe src={url} title={anexo.nome} className="size-full bg-white" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- blob local autenticado
            <img src={url} alt={anexo?.nome ?? ""} className="mx-auto max-h-full max-w-full object-contain p-4" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditarAnexo({ anexo, onClose }: { anexo: AnexoOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ descricao: "", categoria: "" });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (anexo) setF({ descricao: anexo.descricao ?? "", categoria: anexo.categoria ?? "" });
  }, [anexo]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () => api.patch(`/faturamento/anexos/${anexo!.id}`, f),
    onSuccess: () => {
      toast.success("Anexo atualizado");
      qc.invalidateQueries({ queryKey: ["fat", "anexos"] });
      onClose();
    },
  });
  return (
    <FormDialog
      open={!!anexo}
      onOpenChange={(o) => !o && onClose()}
      titulo={anexo?.nome ?? ""}
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="space-y-4">
        <Field label="Pasta" htmlFor="anexo-cat">
          <Input id="anexo-cat" list="anexo-categorias" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} maxLength={60} />
          <datalist id="anexo-categorias">
            {CATEGORIAS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Descrição" htmlFor="anexo-desc">
          <Input id="anexo-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} maxLength={300} />
        </Field>
      </div>
    </FormDialog>
  );
}

function Acoes({
  a,
  podeEditar,
  onVer,
  onEditar,
  onExcluir,
  onVerDespesa,
  onAbrirTarefa,
}: {
  a: AnexoOut;
  podeEditar: boolean;
  onVer: (a: AnexoOut) => void;
  onEditar: (a: AnexoOut) => void;
  onExcluir: (a: AnexoOut) => void;
  onVerDespesa?: () => void;
  onAbrirTarefa?: (id: number) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${a.nome}`} />}>
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {previsualiza(a.nome) && (
          <DropdownMenuItem onClick={() => onVer(a)}>
            <Eye /> Visualizar
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => baixar(`/faturamento/anexos/${a.id}`, { query: { download: true } }, a.nome)}>
          <Download /> Baixar
        </DropdownMenuItem>
        {a.tarefa_id && onAbrirTarefa && (
          <DropdownMenuItem onClick={() => onAbrirTarefa(a.tarefa_id!)}>
            <ListTodo /> Abrir tarefa
          </DropdownMenuItem>
        )}
        {a.despesa_id && onVerDespesa && (
          <DropdownMenuItem onClick={onVerDespesa}>
            <Receipt /> Ver despesa
          </DropdownMenuItem>
        )}
        {podeEditar && !a.despesa_id && (
          <>
            <DropdownMenuItem onClick={() => onEditar(a)}>
              <Pencil /> Pasta e descrição
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onExcluir(a)}>
              <Trash2 /> Excluir
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SEM_PASTA = "Sem pasta";
const pastaDe = (a: AnexoOut) => a.categoria?.trim() || (a.tarefa_id ? "Tarefas" : SEM_PASTA);

function ItemLista({ a, onAbrir, acoes }: { a: AnexoOut; onAbrir: () => void; acoes: React.ReactNode }) {
  const I = iconeDo(a.nome);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", I.cor)}>
        <I.i className="size-4" />
      </span>
      <button type="button" onClick={onAbrir} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium hover:underline">{a.nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {[a.descricao, tamanhoArquivo(a.tamanho), a.enviado_por && `por ${a.enviado_por}`, relativo(a.criado_em)].filter(Boolean).join(" · ")}
        </p>
      </button>
      {a.despesa_id && <span className="hidden rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-ink sm:inline">recibo de despesa</span>}
      {acoes}
    </li>
  );
}

function ItemGrade({ a, onAbrir, acoes }: { a: AnexoOut; onAbrir: () => void; acoes: React.ReactNode }) {
  const I = iconeDo(a.nome);
  return (
    <li className="group relative rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:shadow-md">
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <span className={cn("mb-3 grid h-20 w-full place-items-center rounded-lg", I.cor)}>
          <I.i className="size-8" />
        </span>
        <p className="truncate text-sm font-medium">{a.nome}</p>
        <p className="text-[11px] text-muted-foreground">
          {tamanhoArquivo(a.tamanho)} · {relativo(a.criado_em)}
        </p>
      </button>
      <div className="absolute top-2 right-2 rounded-md bg-card/80 backdrop-blur">{acoes}</div>
    </li>
  );
}

export function AnexosCaso({ casoId, onVerDespesa }: { casoId: number; onVerDespesa?: () => void }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("casos.editar");
  const q = useQuery({ queryKey: ["fat", "anexos", casoId], queryFn: () => api.get<AnexoOut[]>(`/faturamento/casos/${casoId}/anexos`) });
  const [modo, setModo] = useState<"lista" | "grade">("lista");
  const [fila, setFila] = useState<File[]>([]);
  const [pasta, setPasta] = useState("");
  const [descricao, setDescricao] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [ver, setVer] = useState<AnexoOut | null>(null);
  const [editar, setEditar] = useState<AnexoOut | null>(null);
  const [excluir, setExcluir] = useState<AnexoOut | null>(null);
  const enviar = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fila.forEach((f) => fd.append("arquivos", f));
      if (descricao.trim()) fd.append("descricao", descricao.trim());
      if (pasta.trim()) fd.append("categoria", pasta.trim());
      return api.post<AnexoOut[]>(`/faturamento/casos/${casoId}/anexos`, fd);
    },
    onSuccess: (r) => {
      toast.success(`${r.length} arquivo(s) anexado(s)${pasta.trim() ? ` na pasta ${pasta.trim()}` : ""}`);
      setFila([]);
      setDescricao("");
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/anexos/${id}`),
    onSuccess: () => {
      toast.success("Anexo excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const dz = useDropzone({
    multiple: true,
    maxSize: MAX,
    disabled: !podeEditar || enviar.isPending,
    onDrop: (fs) => {
      const ok = fs.filter((f) => ACEITOS.split(",").includes(`.${ext(f.name)}`));
      if (ok.length < fs.length) toast.error(`${fs.length - ok.length} arquivo(s) com tipo não aceito.`);
      setFila((o) => [...o, ...ok]);
    },
    onDropRejected: (r) => toast.error(`${r.length} arquivo(s) recusado(s): tipo não aceito ou maior que 50 MB.`),
  });
  const todos = q.data ?? [];
  const pastas = [...new Set(todos.map(pastaDe))].sort((a, b) => (a === SEM_PASTA ? 1 : b === SEM_PASTA ? -1 : a.localeCompare(b, "pt-BR")));
  const sugestoes = [...new Set([...CATEGORIAS, ...pastas.filter((p) => p !== SEM_PASTA)])];
  const visiveis = aberta ? pastas.filter((p) => p === aberta) : pastas;
  const abrir = (a: AnexoOut) => (previsualiza(a.nome) ? setVer(a) : baixar(`/faturamento/anexos/${a.id}`, { query: { download: true } }, a.nome));
  const acoes = (a: AnexoOut) => (
    <Acoes a={a} podeEditar={podeEditar} onVer={setVer} onEditar={setEditar} onExcluir={setExcluir} onVerDespesa={onVerDespesa} onAbrirTarefa={setTarefaId} />
  );
  const [tarefaId, setTarefaId] = useState<number | null>(null);
  const tarefa = useTarefa(tarefaId);

  return (
    <div className="space-y-4">
      {podeEditar && (
        <section className="card-surface p-4" aria-label="Enviar arquivos">
          <div
            {...dz.getRootProps()}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition",
              dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40",
            )}
          >
            <input {...dz.getInputProps({ accept: ACEITOS })} aria-label="Arquivos do caso" />
            <span className="grid size-11 place-items-center rounded-2xl brand-gradient text-white shadow-lg shadow-brand/25">
              <Upload className="size-5" />
            </span>
            <p className="text-sm font-medium">Arraste os arquivos ou clique para escolher</p>
            <p className="text-xs text-muted-foreground">PDF, Word, Excel, PowerPoint, imagens, ZIP, e-mails (.msg/.eml) · até 50 MB cada</p>
          </div>
          {fila.length > 0 && (
            <div className="mt-3 space-y-3">
              <ul className="flex flex-wrap gap-1.5">
                {fila.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs">
                    <Paperclip className="size-3" /> <span className="max-w-48 truncate">{f.name}</span>
                    <span className="text-muted-foreground">{tamanhoArquivo(f.size)}</span>
                    <button type="button" onClick={() => setFila((o) => o.filter((_, j) => j !== i))} aria-label={`Tirar ${f.name}`} className="rounded-full p-0.5 hover:bg-foreground/10">
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-start">
                <Field label="Pasta" htmlFor="up-pasta" dica="Escolha uma sugestão ou digite uma pasta nova.">
                  <Input id="up-pasta" list="up-pastas" value={pasta} onChange={(e) => setPasta(e.target.value)} maxLength={60} placeholder="Sem pasta" />
                  <datalist id="up-pastas">
                    {sugestoes.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {CATEGORIAS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setPasta(pasta === c ? "" : c)}
                        aria-pressed={pasta === c}
                        className={cn("rounded-full border px-2 py-0.5 text-[11px] transition", pasta === c ? "border-brand bg-brand/10 font-medium text-info-ink" : "text-muted-foreground hover:border-brand/40")}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Descrição" htmlFor="up-desc">
                  <Input id="up-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={300} />
                </Field>
                <Button className="sm:mt-6" onClick={() => enviar.mutate()} disabled={enviar.isPending}>
                  {enviar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Enviar {fila.length}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : todos.length === 0 ? (
        <p className="card-surface py-10 text-center text-sm text-muted-foreground">
          <Paperclip className="mx-auto mb-2 size-6 opacity-50" />
          Nenhum arquivo neste caso.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 flex-wrap gap-2" role="group" aria-label="Pastas">
              {pastas.map((p) => {
                const qtd = todos.filter((a) => pastaDe(a) === p).length;
                const on = aberta === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAberta(on ? null : p)}
                    aria-pressed={on}
                    className={cn(
                      "group flex min-w-36 items-center gap-2.5 rounded-xl border bg-card px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-md",
                      on && "border-brand ring-2 ring-brand/25",
                    )}
                  >
                    {on ? <FolderOpen className="size-5 text-info-ink" /> : <Folder className={cn("size-5", p === SEM_PASTA ? "text-muted-foreground" : p === "Despesas" ? "text-success-ink" : "text-warning-ink")} />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p}</span>
                      <span className="block text-[11px] text-muted-foreground">{qtd} arquivo(s)</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <Segmented
              value={modo}
              onChange={setModo}
              opcoes={[
                { value: "lista", label: "Lista" },
                { value: "grade", label: "Grade" },
              ]}
            />
          </div>
          <div className="space-y-4">
            {visiveis.map((p) => {
              const itens = todos.filter((a) => pastaDe(a) === p);
              return (
                <section key={p} className="card-surface overflow-hidden" aria-label={`Pasta ${p}`}>
                  <header className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
                    <FolderOpen className={cn("size-4", p === SEM_PASTA ? "text-muted-foreground" : p === "Despesas" ? "text-success-ink" : "text-warning-ink")} />
                    <h3 className="text-sm font-semibold">{p}</h3>
                    <span className="text-xs text-muted-foreground">{itens.length}</span>
                    {p === "Despesas" && onVerDespesa && (
                      <button type="button" onClick={onVerDespesa} className="ml-auto text-xs text-info-ink hover:underline">
                        ver despesas
                      </button>
                    )}
                  </header>
                  {modo === "lista" ? (
                    <ul className="divide-y">
                      {itens.map((a) => (
                        <ItemLista key={a.id} a={a} onAbrir={() => abrir(a)} acoes={acoes(a)} />
                      ))}
                    </ul>
                  ) : (
                    <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
                      {itens.map((a) => (
                        <ItemGrade key={a.id} a={a} onAbrir={() => abrir(a)} acoes={acoes(a)} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
      <Previa anexo={ver} onClose={() => setVer(null)} />
      <TarefaDialog open={!!tarefaId && !!tarefa.data} onOpenChange={(o) => !o && setTarefaId(null)} tarefa={tarefa.data ?? null} />
      <EditarAnexo anexo={editar} onClose={() => setEditar(null)} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este arquivo?"
        descricao={excluir?.nome}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
