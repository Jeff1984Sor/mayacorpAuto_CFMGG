"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { paraDecimalApi } from "@/lib/financeiro";
import { moeda, toNum } from "@/lib/format";

import { ContaSelect, DinheiroInput, isoHoje, useContasBancarias } from "../comum";

/** Transferência entre contas do escritório (não é receita nem despesa). */
export function TransferenciaDialog({ open, onOpenChange, origemId }: { open: boolean; onOpenChange: (o: boolean) => void; origemId?: number }) {
  const qc = useQueryClient();
  const contas = useContasBancarias();
  const [f, setF] = useState({ origem: null as number | null, destino: null as number | null, data: isoHoje(), valor: "", descricao: "" });
  /* eslint-disable react-hooks/set-state-in-effect -- reinicia ao abrir */
  useEffect(() => {
    if (open) setF({ origem: origemId ?? null, destino: null, data: isoHoje(), valor: "", descricao: "" });
  }, [open, origemId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const origem = contas.data?.find((c) => c.id === f.origem);
  const destino = contas.data?.find((c) => c.id === f.destino);
  const valor = toNum(paraDecimalApi(f.valor || "0"));
  const salvar = useMutation({
    mutationFn: () =>
      api.post<{ mensagem: string }>("/financeiro/transferencias", {
        origem_id: f.origem,
        destino_id: f.destino,
        data: f.data,
        valor: paraDecimalApi(f.valor),
        descricao: f.descricao.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fin"] });
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Transferência entre contas"
      descricao="Sai de uma conta e entra na outra no mesmo dia. Não conta como receita nem despesa."
      rotuloSalvar="Transferir"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.origem || !f.destino) return toast.error("Escolha as duas contas.");
        if (f.origem === f.destino) return toast.error("Escolha contas diferentes.");
        if (valor <= 0) return toast.error("Informe um valor maior que zero.");
        salvar.mutate();
      }}
    >
      <div className="space-y-3">
        <Field label="De" obrigatorio htmlFor="transf-origem" dica={origem ? `Saldo atual ${moeda(origem.saldo_atual)}` : undefined}>
          <ContaSelect id="transf-origem" value={f.origem} onChange={(v) => setF({ ...f, origem: v })} />
        </Field>
        <div className="flex justify-center">
          <span className="grid size-8 place-items-center rounded-full bg-brand/10 text-info-ink">
            <ArrowDown className="size-4" />
          </span>
        </div>
        <Field label="Para" obrigatorio htmlFor="transf-destino" dica={destino ? `Saldo atual ${moeda(destino.saldo_atual)}` : undefined}>
          <ContaSelect id="transf-destino" value={f.destino} onChange={(v) => setF({ ...f, destino: v })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valor" obrigatorio htmlFor="transf-valor" dica={origem && valor > 0 ? `Fica ${moeda(toNum(origem.saldo_atual) - valor)} na origem` : undefined}>
            <DinheiroInput id="transf-valor" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
          </Field>
          <Field label="Data" htmlFor="transf-data">
            <Input id="transf-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
          </Field>
        </div>
        <Field label="Descrição" htmlFor="transf-desc">
          <Input id="transf-desc" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="ex.: Resgate do CDB para pagar a folha" maxLength={200} />
        </Field>
      </div>
    </FormDialog>
  );
}
