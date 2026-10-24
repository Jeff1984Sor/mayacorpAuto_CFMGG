"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, baixar } from "@/lib/api";
import { type ContaPagarOut, paraDecimalApi } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ContaSelect, DinheiroInput, useContasBancarias } from "../comum";

/** Baixa de uma conta: data, conta bancária, juros e desconto. */
export function PagarDialog({ conta, onClose }: { conta: ContaPagarOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const contas = useContasBancarias();
  const [f, setF] = useState({ data: "", banco: null as number | null, juros: "", desconto: "" });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!conta) return;
    const ativas = (contas.data ?? []).filter((c) => c.ativo);
    // sugestão: a preferida da conta; senão a única ativa; senão a primeira conta corrente
    const sugerida = conta.conta_bancaria_id ?? (ativas.length === 1 ? ativas[0].id : (ativas.find((c) => c.tipo === "corrente")?.id ?? null));
    setF({ data: conta.data_vencimento, banco: sugerida, juros: "", desconto: "" });
  }, [conta, contas.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const juros = toNum(paraDecimalApi(f.juros || "0"));
  const desconto = toNum(paraDecimalApi(f.desconto || "0"));
  const pago = toNum(conta?.valor) + juros - desconto;
  const pagar = useMutation({
    mutationFn: () =>
      api.post<ContaPagarOut>(`/financeiro/contas-pagar/${conta!.id}/pagar`, {
        data: f.data,
        conta_bancaria_id: f.banco,
        juros: paraDecimalApi(f.juros || "0"),
        desconto: paraDecimalApi(f.desconto || "0"),
      }),
    onSuccess: (r) => {
      toast.success("Conta paga", { description: r.conta_bancaria_nome ? `Lançada no extrato de ${r.conta_bancaria_nome}` : "Sem conta bancária: não entrou no extrato." });
      qc.invalidateQueries({ queryKey: ["fin"] });
      onClose();
    },
  });
  return (
    <FormDialog
      open={!!conta}
      onOpenChange={(o) => !o && onClose()}
      titulo="Pagar conta"
      descricao={conta ? `${conta.favorecido_nome || conta.descricao} · vence ${data(conta.data_vencimento)}` : undefined}
      rotuloSalvar={`Pagar ${moeda(pago)}`}
      salvando={pagar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.data) return toast.error("Informe a data do pagamento.");
        if (desconto > toNum(conta?.valor)) return toast.error("O desconto não pode passar do valor.");
        pagar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Data do pagamento" htmlFor="pg-data">
          <Input id="pg-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Field>
        <Field label="Conta bancária" htmlFor="pg-banco" dica={!f.banco ? "Sem conta, o pagamento não entra em nenhum extrato." : undefined}>
          <ContaSelect id="pg-banco" value={f.banco} onChange={(v) => setF({ ...f, banco: v })} />
        </Field>
        <Field label="Juros / multa" htmlFor="pg-juros">
          <DinheiroInput id="pg-juros" value={f.juros} onChange={(v) => setF({ ...f, juros: v })} />
        </Field>
        <Field label="Desconto" htmlFor="pg-desc">
          <DinheiroInput id="pg-desc" value={f.desconto} onChange={(v) => setF({ ...f, desconto: v })} />
        </Field>
        <dl className="grid grid-cols-2 gap-y-1 rounded-xl bg-muted/40 p-3 text-sm sm:col-span-2">
          <dt className="text-muted-foreground">Valor da conta</dt>
          <dd className="text-right font-mono">{moeda(conta?.valor)}</dd>
          {juros > 0 && (
            <>
              <dt className="text-muted-foreground">+ juros</dt>
              <dd className="text-right font-mono text-danger-ink">{moeda(juros)}</dd>
            </>
          )}
          {desconto > 0 && (
            <>
              <dt className="text-muted-foreground">− desconto</dt>
              <dd className="text-right font-mono text-success-ink">{moeda(desconto)}</dd>
            </>
          )}
          <dt className="border-t pt-1 font-medium">Valor pago</dt>
          <dd className="border-t pt-1 text-right font-mono text-lg font-semibold">{moeda(pago)}</dd>
        </dl>
      </div>
    </FormDialog>
  );
}

/** Pagar várias de uma vez (no vencimento de cada uma ou numa data só). */
export function PagarLoteDialog({ contas, onClose, onPago }: { contas: ContaPagarOut[]; onClose: () => void; onPago: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ data: "", banco: null as number | null });
  const pagar = useMutation({
    mutationFn: () => api.post<{ mensagem: string }>("/financeiro/contas-pagar/pagar-lote", { ids: contas.map((c) => c.id), data: f.data || null, conta_bancaria_id: f.banco }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fin"] });
      onPago();
      onClose();
    },
  });
  const total = contas.reduce((a, c) => a + toNum(c.valor), 0);
  return (
    <FormDialog
      open={contas.length > 0}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Pagar ${contas.length} conta(s)`}
      descricao={`Total ${moeda(total)}. Sem juros nem desconto: para isso, pague uma a uma.`}
      rotuloSalvar="Pagar todas"
      salvando={pagar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        pagar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Data do pagamento" htmlFor="pgl-data" dica="Vazio = no vencimento de cada conta.">
          <Input id="pgl-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Field>
        <Field label="Conta bancária" htmlFor="pgl-banco" dica="Vazio = a preferida de cada conta.">
          <ContaSelect id="pgl-banco" value={f.banco} onChange={(v) => setF({ ...f, banco: v })} vazio="A preferida de cada conta" />
        </Field>
        <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border text-sm sm:col-span-2">
          {contas.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-xs text-muted-foreground">{data(c.data_vencimento)}</span>
              <span className="min-w-0 flex-1 truncate">{c.favorecido_nome || c.descricao}</span>
              <span className="font-mono tabular-nums">{moeda(c.valor)}</span>
            </li>
          ))}
        </ul>
      </div>
    </FormDialog>
  );
}

interface ResultadoImportacao {
  importadas: number;
  erros: string[];
  qtd_erros: number;
  categorias_novas: string[];
}

export function ImportarContasDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [res, setRes] = useState<ResultadoImportacao | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- limpa ao abrir */
  useEffect(() => {
    if (open) setRes(null);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const enviar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<ResultadoImportacao>("/financeiro/contas-pagar/importar", fd);
    },
    onSuccess: (r) => {
      setRes(r);
      qc.invalidateQueries({ queryKey: ["fin"] });
    },
  });
  const dz = useDropzone({
    multiple: false,
    disabled: enviar.isPending,
    accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (fs) => fs[0] && enviar.mutate(fs[0]),
    onDropRejected: () => toast.error("Envie a planilha .xlsx do modelo."),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Importar contas a pagar</DialogTitle>
        <DialogDescription>Use o modelo (.xlsx). Categorias e fornecedores novos são criados na hora.</DialogDescription>
        {!res ? (
          <>
            <div
              {...dz.getRootProps()}
              className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition", dz.isDragActive ? "border-brand bg-brand/6" : "hover:border-brand/50 hover:bg-muted/40")}
            >
              <input {...dz.getInputProps()} aria-label="Planilha de contas a pagar" />
              {enviar.isPending ? <Loader2 className="size-7 animate-spin text-info-ink" /> : <FileSpreadsheet className="size-7 text-info-ink" />}
              <p className="text-sm font-medium">{enviar.isPending ? "Importando…" : "Arraste a planilha ou clique para escolher"}</p>
            </div>
            <Button variant="link" size="sm" className="self-start px-0" onClick={() => baixar("/financeiro/contas-pagar/modelo.xlsx", {}, "modelo_contas_a_pagar.xlsx")}>
              <Download /> Baixar o modelo
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5 text-sm text-success-ink">
              <CheckCircle2 className="size-4" /> <strong>{res.importadas}</strong> conta(s) importada(s)
            </p>
            {res.categorias_novas.length > 0 && (
              <p className="rounded-xl bg-brand/6 px-3 py-2 text-xs text-info-ink">Categorias criadas: {res.categorias_novas.join(", ")}. Confira o grupo da DRE em Categorias.</p>
            )}
            {res.qtd_erros > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/8 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-warning-ink">
                  <AlertTriangle className="size-4" /> {res.qtd_erros} linha(s) com problema
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                  {res.erros.map((e) => (
                    <li key={e}>{e}</li>
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
