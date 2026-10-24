"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, baixar } from "@/lib/api";
import { moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ResumoImportacao {
  importados: number;
  ignoradas: number;
  entradas: number | string;
  saidas: number | string;
  categorias_novas: string[];
  simulacao: boolean;
}

/** Importa o extrato (.xlsx): primeiro simula, mostra o resultado e só então grava. */
export function ImportarExtratoDialog({ open, onOpenChange, contaId, contaNome }: { open: boolean; onOpenChange: (o: boolean) => void; contaId: number; contaNome: string }) {
  const qc = useQueryClient();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<ResumoImportacao | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- limpa ao abrir */
  useEffect(() => {
    if (open) {
      setArquivo(null);
      setPrevia(null);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const enviar = useMutation({
    mutationFn: ({ f, simular }: { f: File; simular: boolean }) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<ResumoImportacao>(`/financeiro/contas/${contaId}/importar`, fd, { query: { simular } });
    },
    onSuccess: (r) => {
      if (r.simulacao) setPrevia(r);
      else {
        toast.success(`${r.importados} lançamento(s) importado(s)`);
        qc.invalidateQueries({ queryKey: ["fin"] });
        onOpenChange(false);
      }
    },
  });
  const dz = useDropzone({
    multiple: false,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (fs) => {
      if (!fs[0]) return;
      setArquivo(fs[0]);
      setPrevia(null);
      enviar.mutate({ f: fs[0], simular: true });
    },
    onDropRejected: () => toast.error("Envie uma planilha .xlsx."),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Importar extrato</DialogTitle>
        <DialogDescription>
          Para a conta <strong>{contaNome}</strong>. Use o modelo ou a planilha do banco (.xlsx). Antes de gravar, mostramos o que vai entrar.
        </DialogDescription>
        <div
          {...dz.getRootProps()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition",
            dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40",
          )}
        >
          <input {...dz.getInputProps()} aria-label="Planilha do extrato" />
          {enviar.isPending && !previa ? <Loader2 className="size-7 animate-spin text-info-ink" /> : <FileSpreadsheet className="size-7 text-info-ink" />}
          <p className="text-sm font-medium">{arquivo ? arquivo.name : "Arraste a planilha ou clique para escolher"}</p>
          <p className="text-xs text-muted-foreground">Colunas: data, descrição, valor (ou entrada/saída), categoria.</p>
        </div>
        <Button variant="link" size="sm" className="-mt-2 self-start px-0" onClick={() => baixar(`/financeiro/contas/${contaId}/modelo.xlsx`, {}, "modelo_extrato.xlsx")}>
          <Download /> Baixar o modelo
        </Button>
        {previa && (
          <div className="rounded-xl border bg-muted/30 p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-success-ink" /> Prévia (nada foi gravado ainda)
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Lançamentos</dt>
              <dd className="text-right font-semibold tabular-nums">{previa.importados}</dd>
              <dt className="text-muted-foreground">Linhas ignoradas</dt>
              <dd className="text-right tabular-nums">{previa.ignoradas}</dd>
              <dt className="text-muted-foreground">Entradas</dt>
              <dd className="text-right font-mono text-success-ink">{moeda(previa.entradas)}</dd>
              <dt className="text-muted-foreground">Saídas</dt>
              <dd className="text-right font-mono text-danger-ink">{moeda(previa.saidas)}</dd>
            </dl>
            {previa.categorias_novas.length > 0 && (
              <p className="mt-3 text-xs text-warning-ink">
                Categorias novas que serão criadas: {previa.categorias_novas.join(", ")}. Confira depois em Categorias.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!previa || !arquivo || previa.importados === 0 || enviar.isPending} onClick={() => arquivo && enviar.mutate({ f: arquivo, simular: false })}>
            {enviar.isPending && previa ? <Loader2 className="animate-spin" /> : <Upload />} Importar {previa ? previa.importados : ""} lançamento(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
