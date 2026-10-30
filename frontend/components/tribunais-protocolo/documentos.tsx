"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, FileCheck2, FileText, Loader2, MoreHorizontal, Pencil, ShieldCheck, Trash2, UploadCloud } from "lucide-react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api, baixar } from "@/lib/api";
import { tamanhoArquivo } from "@/lib/format";
import { type DocumentoProtocolo, NIVEIS_SIGILO, type ProtocoloOut, useTiposDocumento } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

import { HashCurto } from "./comum";

interface Meta {
  tipo_documento_nome: string;
  tipo_documento_codigo: string;
  descricao: string;
  nivel_sigilo: number;
}

function MetaCampos({ m, set }: { m: Meta; set: (p: Partial<Meta>) => void }) {
  const tipos = useTiposDocumento();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Tipo de documento" obrigatorio className="sm:col-span-2">
        <Input list="trib-tipos-doc" value={m.tipo_documento_nome} onChange={(e) => set({ tipo_documento_nome: e.target.value })} maxLength={150} />
        <datalist id="trib-tipos-doc">
          {(tipos.data ?? []).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </Field>
      <Field label="Descrição nos autos" className="sm:col-span-2" dica="Nome que aparece no processo. Vazio = o tipo.">
        <Input value={m.descricao} onChange={(e) => set({ descricao: e.target.value })} maxLength={300} />
      </Field>
      <Field label="Código do tipo no tribunal" dica="Opcional; da tabela do tribunal.">
        <Input value={m.tipo_documento_codigo} onChange={(e) => set({ tipo_documento_codigo: e.target.value })} className="font-mono" />
      </Field>
      <Field label="Sigilo">
        <NativeSelect value={m.nivel_sigilo} onChange={(e) => set({ nivel_sigilo: Number(e.target.value) })}>
          {NIVEIS_SIGILO.map((n) => (
            <option key={n.v} value={n.v}>
              {n.l}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

export function DocumentosProtocolo({
  p,
  editavel,
  onAtualizado,
  acoes,
}: {
  p: ProtocoloOut;
  editavel: boolean;
  onAtualizado: (p: ProtocoloOut) => void;
  acoes?: React.ReactNode;
}) {
  const docs = [...p.documentos].sort((a, b) => a.ordem - b.ordem);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [meta, setMeta] = useState<Meta>({ tipo_documento_nome: "", tipo_documento_codigo: "", descricao: "", nivel_sigilo: 0 });
  const [editar, setEditar] = useState<DocumentoProtocolo | null>(null);
  const [metaEd, setMetaEd] = useState<Meta>(meta);
  const [excluir, setExcluir] = useState<DocumentoProtocolo | null>(null);

  const dz = useDropzone({
    multiple: true,
    disabled: !editavel,
    accept: { "application/pdf": [".pdf"] },
    onDrop: (f) => {
      if (!f.length) return;
      setArquivos(f);
      setMeta({
        tipo_documento_nome: docs.length === 0 ? (p.tipo === "inicial" ? "Petição inicial" : (p.tipo_peticao_nome ?? "Petição")) : "",
        tipo_documento_codigo: "",
        descricao: "",
        nivel_sigilo: p.nivel_sigilo,
      });
    },
    onDropRejected: () => toast.error("Envie arquivos PDF."),
  });

  const enviar = useMutation({
    mutationFn: async () => {
      let ult: ProtocoloOut | null = null;
      for (const f of arquivos) {
        const fd = new FormData();
        fd.append("arquivo", f);
        fd.append("tipo_documento_nome", meta.tipo_documento_nome.trim());
        fd.append("descricao", (arquivos.length > 1 ? f.name.replace(/\.pdf$/i, "") : meta.descricao.trim()) || meta.tipo_documento_nome.trim());
        if (meta.tipo_documento_codigo.trim()) fd.append("tipo_documento_codigo", meta.tipo_documento_codigo.trim());
        fd.append("nivel_sigilo", String(meta.nivel_sigilo));
        ult = await api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/documentos`, fd);
        onAtualizado(ult);
      }
      return ult;
    },
    onSuccess: () => {
      toast.success(arquivos.length > 1 ? `${arquivos.length} documentos anexados` : "Documento anexado");
      setArquivos([]);
    },
  });

  const patch = useMutation({
    mutationFn: ({ did, corpo }: { did: number; corpo: Record<string, unknown> }) =>
      api.patch<ProtocoloOut>(`/tribunais/protocolos/${p.id}/documentos/${did}`, corpo),
    onSuccess: onAtualizado,
  });

  const mover = useMutation({
    mutationFn: async ({ a, b }: { a: DocumentoProtocolo; b: DocumentoProtocolo }) => {
      await api.patch<ProtocoloOut>(`/tribunais/protocolos/${p.id}/documentos/${a.id}`, { ordem: b.ordem });
      return api.patch<ProtocoloOut>(`/tribunais/protocolos/${p.id}/documentos/${b.id}`, { ordem: a.ordem });
    },
    onSuccess: onAtualizado,
  });

  const remover = useMutation({
    mutationFn: (did: number) => api.del<ProtocoloOut>(`/tribunais/protocolos/${p.id}/documentos/${did}`),
    onSuccess: (r) => {
      onAtualizado(r);
      setExcluir(null);
      toast.success("Documento removido");
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          A ordem 1 é a petição principal. Cada mudança aqui exige nova aprovação do advogado.
        </p>
        {acoes}
      </div>

      {editavel && (
        <div
          {...dz.getRootProps()}
          className={cn(
            "grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors",
            dz.isDragActive ? "border-brand bg-brand/5" : "hover:border-brand/50",
          )}
        >
          <input {...dz.getInputProps()} />
          <span className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <UploadCloud className="size-6" />
            Arraste os PDFs aqui ou clique para escolher
          </span>
        </div>
      )}

      {docs.length === 0 ? (
        <div className="card-surface">
          <EmptyState icone={FileText} titulo="Nenhum documento" descricao="Gere a petição em PDF pelo conteúdo da peça ou anexe o PDF pronto, mais procuração e documentos." />
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2.5 font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Documento</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Arquivo</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Hash</th>
                <th className="px-3 py-2.5 font-medium">Assinatura</th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((d, i) => (
                <tr key={d.id}>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{d.ordem}</td>
                  <td className="max-w-72 px-3 py-3">
                    <p className="truncate font-medium">{d.descricao}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.tipo_documento_nome}
                      {d.tipo_documento_codigo && <span className="ml-1 font-mono">({d.tipo_documento_codigo})</span>}
                      {d.ordem === 1 && <span className="ml-1.5 font-semibold text-info-ink">principal</span>}
                      {d.nivel_sigilo > 0 && <span className="ml-1.5 text-warning-ink">sigilo {d.nivel_sigilo}</span>}
                    </p>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell">
                    <p className="max-w-48 truncate text-xs" title={d.nome_arquivo}>
                      {d.nome_arquivo}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {tamanhoArquivo(d.tamanho_bytes)}
                      {d.paginas != null && ` · ${d.paginas} pág.`}
                      {d.pesquisavel === false ? (
                        <span className="ml-1 text-warning-ink">· sem texto pesquisável</span>
                      ) : d.pesquisavel ? (
                        " · pesquisável"
                      ) : null}
                    </p>
                  </td>
                  <td className="hidden px-3 py-3 lg:table-cell">
                    <HashCurto hash={d.hash_sha256} />
                  </td>
                  <td className="px-3 py-3">
                    {d.assinado ? (
                      <Pill tom="success" className="normal-case">
                        <ShieldCheck className="size-3" /> {d.formato_assinatura ?? "assinado"}
                      </Pill>
                    ) : (
                      <span className="text-xs text-muted-foreground">assina no envio</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-0.5">
                      {editavel && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Subir"
                            disabled={i === 0 || mover.isPending}
                            onClick={() => mover.mutate({ a: d, b: docs[i - 1] })}
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Descer"
                            disabled={i === docs.length - 1 || mover.isPending}
                            onClick={() => mover.mutate({ a: d, b: docs[i + 1] })}
                          >
                            <ArrowDown />
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => baixar(`/tribunais/protocolos/${p.id}/documentos/${d.id}/arquivo`, {}, d.nome_arquivo)}>
                            <Download /> Baixar original
                          </DropdownMenuItem>
                          {d.assinado && (
                            <DropdownMenuItem
                              onClick={() => baixar(`/tribunais/protocolos/${p.id}/documentos/${d.id}/arquivo`, { query: { assinado: true } }, d.nome_arquivo)}
                            >
                              <FileCheck2 /> Baixar assinado
                            </DropdownMenuItem>
                          )}
                          {editavel && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setMetaEd({
                                    tipo_documento_nome: d.tipo_documento_nome,
                                    tipo_documento_codigo: d.tipo_documento_codigo ?? "",
                                    descricao: d.descricao,
                                    nivel_sigilo: d.nivel_sigilo,
                                  });
                                  setEditar(d);
                                }}
                              >
                                <Pencil /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluir(d)}>
                                <Trash2 /> Remover
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mover.isPending && (
            <p className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Reordenando…
            </p>
          )}
        </div>
      )}

      <FormDialog
        open={arquivos.length > 0}
        onOpenChange={(o) => !o && setArquivos([])}
        titulo={arquivos.length > 1 ? `Anexar ${arquivos.length} documentos` : "Anexar documento"}
        descricao={arquivos.map((f) => `${f.name} (${tamanhoArquivo(f.size)})`).join(" · ")}
        salvando={enviar.isPending}
        rotuloSalvar="Anexar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!meta.tipo_documento_nome.trim()) return toast.error("Informe o tipo de documento.");
          enviar.mutate();
        }}
      >
        <MetaCampos m={meta} set={(x) => setMeta((m) => ({ ...m, ...x }))} />
        {arquivos.length > 1 && <p className="mt-3 text-xs text-muted-foreground">Com vários arquivos, a descrição de cada um é o nome do arquivo (dá para editar depois).</p>}
      </FormDialog>

      <FormDialog
        open={!!editar}
        onOpenChange={(o) => !o && setEditar(null)}
        titulo="Editar documento"
        salvando={patch.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (!editar) return;
          patch.mutate(
            {
              did: editar.id,
              corpo: {
                tipo_documento_nome: metaEd.tipo_documento_nome.trim() || editar.tipo_documento_nome,
                tipo_documento_codigo: metaEd.tipo_documento_codigo.trim() || null,
                descricao: metaEd.descricao.trim() || metaEd.tipo_documento_nome.trim(),
                nivel_sigilo: metaEd.nivel_sigilo,
              },
            },
            { onSuccess: () => setEditar(null) },
          );
        }}
      >
        <MetaCampos m={metaEd} set={(x) => setMetaEd((m) => ({ ...m, ...x }))} />
      </FormDialog>

      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Remover o documento?"
        descricao={excluir && <>“{excluir.descricao}” sai da petição. Se ela já estava aprovada, o advogado precisa aprovar de novo.</>}
        confirmar="Remover"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
