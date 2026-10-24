"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, baixar } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Resultado {
  criados: number;
  atualizados: number;
  erros: string[];
  qtd_erros: number;
}

/** Botões "Exportar" + "Importar" (com diálogo) para contratos e casos. */
export function PlanilhaAcoes({ recurso, rotulo, podeImportar }: { recurso: "contratos" | "casos"; rotulo: string; podeImportar: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [exportando, setExportando] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={exportando}
        onClick={async () => {
          setExportando(true);
          try {
            await baixar(`/faturamento/${recurso}/exportar.xlsx`, {}, `${recurso}.xlsx`);
          } catch {
            toast.error("Não foi possível exportar agora.");
          } finally {
            setExportando(false);
          }
        }}
      >
        {exportando ? <Loader2 className="animate-spin" /> : <Download />} Exportar
      </Button>
      {podeImportar && (
        <Button variant="outline" onClick={() => setAberto(true)}>
          <Upload /> Importar
        </Button>
      )}
      <ImportarDialog open={aberto} onOpenChange={setAberto} recurso={recurso} rotulo={rotulo} />
    </>
  );
}

function ImportarDialog({ open, onOpenChange, recurso, rotulo }: { open: boolean; onOpenChange: (o: boolean) => void; recurso: string; rotulo: string }) {
  const qc = useQueryClient();
  const [res, setRes] = useState<Resultado | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- limpa ao abrir */
  useEffect(() => {
    if (open) setRes(null);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const enviar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<Resultado>(`/faturamento/${recurso}/importar`, fd);
    },
    onSuccess: (r) => {
      setRes(r);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const dz = useDropzone({
    multiple: false,
    disabled: enviar.isPending,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (f) => f[0] && enviar.mutate(f[0]),
    onDropRejected: () => toast.error("Envie uma planilha .xlsx."),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Importar {rotulo}</DialogTitle>
        <DialogDescription>Planilha .xlsx no formato do modelo.</DialogDescription>
        {!res ? (
          <>
            <p className="flex items-start gap-2 rounded-xl bg-brand/6 px-3 py-2 text-xs text-info-ink">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Exporte, ajuste no Excel e importe de volta: linhas com Nº atualizam o registro; linhas sem Nº viram registros novos.
            </p>
            <div
              {...dz.getRootProps()}
              className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition", dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40")}
            >
              <input {...dz.getInputProps()} aria-label={`Planilha de ${rotulo}`} />
              {enviar.isPending ? <Loader2 className="size-7 animate-spin text-info-ink" /> : <FileSpreadsheet className="size-7 text-info-ink" />}
              <p className="text-sm font-medium">{enviar.isPending ? "Importando…" : "Arraste a planilha ou clique para escolher"}</p>
            </div>
            <Button variant="link" size="sm" className="self-start px-0" onClick={() => baixar(`/faturamento/${recurso}/modelo.xlsx`, {}, `modelo_${recurso}.xlsx`)}>
              <Download /> Baixar modelo
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <p className="rounded-xl bg-success/10 px-3 py-2.5 text-sm text-success-ink">
                <CheckCircle2 className="mr-1.5 inline size-4" /> <strong>{res.criados}</strong> criado(s)
              </p>
              <p className="rounded-xl bg-brand/8 px-3 py-2.5 text-sm text-info-ink">
                <strong>{res.atualizados}</strong> atualizado(s)
              </p>
            </div>
            {res.qtd_erros > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/8 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-warning-ink">
                  <AlertTriangle className="size-4" /> {res.qtd_erros} linha(s) com problema
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                  {res.erros.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {res.qtd_erros > res.erros.length && <li>… e mais {res.qtd_erros - res.erros.length}</li>}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRes(null)}>
                <Upload /> Importar outra
              </Button>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
