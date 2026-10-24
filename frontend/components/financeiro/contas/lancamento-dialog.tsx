"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { type LancamentoIn, type LancamentoOut, paraBr, paraDecimalApi, type TipoLancamento } from "@/lib/financeiro";
import { toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CategoriaSubSelect, DinheiroInput, FavorecidoCombo, isoHoje } from "../comum";

const vazio = (): LancamentoIn => ({
  data: isoHoje(),
  descricao: "",
  tipo: "debito",
  valor: "",
  categoria_id: null,
  subcategoria_id: null,
  fornecedor_id: null,
  funcionario_id: null,
  favorecido: null,
  documento: null,
  observacao: null,
});

/** Lançamento manual no extrato (novo ou edição). */
export function LancamentoDialog({ open, onOpenChange, contaId, lancamento }: { open: boolean; onOpenChange: (o: boolean) => void; contaId: number; lancamento: LancamentoOut | null }) {
  const qc = useQueryClient();
  const [f, setF] = useState<LancamentoIn>(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      lancamento
        ? {
            data: lancamento.data,
            descricao: lancamento.descricao,
            tipo: lancamento.tipo,
            valor: paraBr(lancamento.valor),
            categoria_id: lancamento.categoria_id,
            subcategoria_id: lancamento.subcategoria_id,
            fornecedor_id: lancamento.fornecedor_id,
            funcionario_id: lancamento.funcionario_id,
            favorecido: lancamento.favorecido,
            documento: lancamento.documento,
            observacao: lancamento.observacao,
          }
        : vazio(),
    );
  }, [open, lancamento]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof LancamentoIn>(k: K, v: LancamentoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        descricao: f.descricao.trim(),
        valor: paraDecimalApi(f.valor),
        documento: f.documento?.trim() || null,
        observacao: f.observacao?.trim() || null,
      };
      return lancamento ? api.put<LancamentoOut>(`/financeiro/lancamentos/${lancamento.id}`, body) : api.post<LancamentoOut>(`/financeiro/contas/${contaId}/lancamentos`, body);
    },
    onSuccess: () => {
      toast.success(lancamento ? "Lançamento atualizado" : "Lançamento registrado");
      qc.invalidateQueries({ queryKey: ["fin"] });
      onOpenChange(false);
    },
  });
  const entrada = f.tipo === "credito";
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={lancamento ? "Editar lançamento" : "Novo lançamento"}
      descricao="Movimento avulso do extrato. Pagamentos de contas e recebimentos de faturas entram sozinhos."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (f.descricao.trim().length < 2) return toast.error("Informe a descrição.");
        if (toNum(paraDecimalApi(f.valor || "0")) <= 0) return toast.error("Informe um valor maior que zero.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <div role="radiogroup" aria-label="Tipo de lançamento" className="grid grid-cols-2 gap-2 sm:col-span-6">
          {(
            [
              ["credito", "Entrada", ArrowDownLeft, "border-success bg-success/8 text-success-ink"],
              ["debito", "Saída", ArrowUpRight, "border-danger bg-danger/8 text-danger-ink"],
            ] as const
          ).map(([k, l, I, on]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.tipo === k}
              onClick={() => setF((o) => ({ ...o, tipo: k as TipoLancamento, categoria_id: null, subcategoria_id: null }))}
              className={cn("flex items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition", f.tipo === k ? on : "text-muted-foreground hover:bg-muted/50")}
            >
              <I className="size-4" /> {l}
            </button>
          ))}
        </div>
        <Field label="Descrição" obrigatorio htmlFor="lanc-desc" className="sm:col-span-4">
          <Input id="lanc-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={255} autoFocus />
        </Field>
        <Field label="Valor" obrigatorio htmlFor="lanc-valor" className="sm:col-span-2">
          <DinheiroInput id="lanc-valor" value={f.valor} onChange={(v) => set("valor", v)} className={entrada ? "text-success-ink" : "text-danger-ink"} />
        </Field>
        <Field label="Data" htmlFor="lanc-data" className="sm:col-span-2">
          <Input id="lanc-data" type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
        </Field>
        <Field label={entrada ? "Recebido de" : "Pago a"} htmlFor="lanc-fav" className="sm:col-span-4">
          <FavorecidoCombo
            id="lanc-fav"
            valor={{ fornecedor_id: f.fornecedor_id, funcionario_id: f.funcionario_id, favorecido: f.favorecido }}
            onChange={(v) => setF((o) => ({ ...o, ...v }))}
          />
        </Field>
        <Field label="Categoria › Subcategoria" htmlFor="lanc-cat-cat" className="sm:col-span-6">
          <CategoriaSubSelect
            idBase="lanc-cat"
            tipo={entrada ? "receita" : "despesa"}
            categoriaId={f.categoria_id}
            subcategoriaId={f.subcategoria_id}
            onChange={(c, s) => setF((o) => ({ ...o, categoria_id: c, subcategoria_id: s }))}
          />
        </Field>
        <Field label="Documento" htmlFor="lanc-doc" className="sm:col-span-2">
          <Input id="lanc-doc" value={f.documento ?? ""} onChange={(e) => set("documento", e.target.value)} className="font-mono" maxLength={80} />
        </Field>
        <Field label="Observação" htmlFor="lanc-obs" className="sm:col-span-4">
          <Textarea id="lanc-obs" rows={1} value={f.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}
