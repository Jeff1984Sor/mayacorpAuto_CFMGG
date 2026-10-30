"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useProfissionais } from "@/components/faturamento/dialogos";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data } from "@/lib/format";
import { CHAVE, type Movimentacao, PRIORIDADE, type Prioridade } from "@/lib/tribunais";

/** Intimação → tarefa de prazo (POST /tribunais/movimentacoes/{id}/tarefa). */
export function TarefaPrazoDialog({
  mov,
  numero,
  responsavelPadrao,
  onOpenChange,
}: {
  mov: Pick<Movimentacao, "id" | "descricao" | "data_hora" | "prazo_final"> | null;
  numero: string;
  responsavelPadrao?: number | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const profs = useProfissionais(!!mov);
  const [prazo, setPrazo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [resp, setResp] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("alta");
  /* eslint-disable react-hooks/set-state-in-effect -- preenche ao abrir */
  useEffect(() => {
    if (!mov) return;
    setPrazo(mov.prazo_final?.slice(0, 10) ?? "");
    setTitulo(`Prazo — ${numero}`);
    setResp(responsavelPadrao ? String(responsavelPadrao) : "");
    setPrioridade("alta");
  }, [mov, numero, responsavelPadrao]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const criar = useMutation({
    mutationFn: () =>
      api.post<{ tarefa_id: number }>(`/tribunais/movimentacoes/${mov!.id}/tarefa`, {
        prazo,
        titulo: titulo.trim() || null,
        responsavel_id: resp ? Number(resp) : null,
        prioridade,
      }),
    onSuccess: () => {
      toast.success("Tarefa de prazo criada", { description: `Prazo em ${data(prazo)}. Ela aparece em Tarefas.` });
      qc.invalidateQueries({ queryKey: [CHAVE] });
      qc.invalidateQueries({ queryKey: ["fat"] });
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={!!mov}
      onOpenChange={onOpenChange}
      titulo="Criar tarefa de prazo"
      rotuloSalvar="Criar tarefa"
      salvando={criar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!prazo) return toast.error("Informe a data final do prazo.");
        criar.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {mov && (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground sm:col-span-2">
            <p className="mb-1 font-mono">{data(mov.data_hora)}</p>
            <p className="line-clamp-4 whitespace-pre-line text-foreground/85">{mov.descricao}</p>
          </div>
        )}
        <Field label="Título" htmlFor="tp-titulo" className="sm:col-span-2">
          <Input id="tp-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <Field label="Prazo final" obrigatorio htmlFor="tp-prazo">
          <Input id="tp-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </Field>
        <Field label="Prioridade" htmlFor="tp-prio">
          <NativeSelect id="tp-prio" value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)}>
            {(Object.keys(PRIORIDADE) as Prioridade[]).map((p) => (
              <option key={p} value={p}>
                {PRIORIDADE[p]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Responsável" htmlFor="tp-resp" className="sm:col-span-2" dica="Vazio: o responsável pelo processo (ou você).">
          <NativeSelect id="tp-resp" value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">Responsável pelo processo</option>
            {profs.data
              ?.filter((p) => p.ativo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </NativeSelect>
        </Field>
      </div>
    </FormDialog>
  );
}
