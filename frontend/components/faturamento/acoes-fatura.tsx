"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, DollarSign, FileX2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FluxoCard } from "@/lib/faturamento";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE");

function Bolinha({ titulo, tom, onClick, children }: { titulo: string; tom: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={titulo}
            onClick={onClick}
            className={cn("grid size-8 place-items-center rounded-full border transition hover:scale-105 [&_svg]:size-4", tom)}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{titulo}</TooltipContent>
    </Tooltip>
  );
}

/** Ações rápidas da fatura no Fluxo: dar baixa ($), cancelar a NFS-e e cancelar a fatura. */
export function AcoesFatura({ f, pago }: { f: FluxoCard; pago: boolean }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const [dlg, setDlg] = useState<"baixa" | "nfse" | "fatura" | null>(null);
  const [baixa, setBaixa] = useState({ data: hoje(), valor: "", conta: "" });
  const [motivo, setMotivo] = useState("");
  const contas = useQuery({
    queryKey: ["fin", "contas"],
    queryFn: () => api.get<{ id: number; nome: string; ativo: boolean }[]>("/financeiro/contas"),
    enabled: dlg === "baixa" && pode("contas_bancarias.ver"),
    meta: { silencioso: true },
  });
  const pronto = (msg: string) => {
    toast.success(msg);
    setDlg(null);
    setMotivo("");
    qc.invalidateQueries({ queryKey: ["fat"] });
    qc.invalidateQueries({ queryKey: ["faturas"] });
  };
  const darBaixa = useMutation({
    mutationFn: () =>
      api.post(`/nfse/faturas/${f.id}/baixa`, {
        data: baixa.data,
        valor: baixa.valor ? toNum(baixa.valor.replace(/\./g, "").replace(",", ".")) : null,
        conta_bancaria_id: baixa.conta ? Number(baixa.conta) : null,
      }),
    onSuccess: () => pronto(`${f.titulo} paga`),
  });
  const cancelarNota = useMutation({
    mutationFn: () => api.post(`/nfse/notas/${f.nfse_id}/cancelar`, { motivo: motivo.trim() }),
    onSuccess: () => pronto(`NFS-e ${f.nfse_numero} cancelada`),
  });
  const cancelarFatura = useMutation({
    mutationFn: () => api.post(`/faturamento/faturas/${f.id}/cancelar`, { motivo: motivo.trim() }),
    onSuccess: () => pronto(`${f.titulo} cancelada: os itens voltaram para Itens a faturar`),
  });

  if (f.tipo !== "fatura") return null;
  const temNota = !!f.nfse_id && !f.nfse_cancelada;
  return (
    <div className="flex items-center justify-end gap-1.5">
      {!pago && pode("faturas.baixar") && (
        <Bolinha titulo="Dar baixa (registrar pagamento)" tom="border-success/40 bg-success/10 text-success-ink hover:bg-success/20" onClick={() => setDlg("baixa")}>
          <DollarSign />
        </Bolinha>
      )}
      {temNota && !pago && pode("nfse_notas.cancelar") && (
        <Bolinha titulo={`Cancelar a NFS-e ${f.nfse_numero}`} tom="border-warning/40 bg-warning/10 text-warning-ink hover:bg-warning/20" onClick={() => setDlg("nfse")}>
          <FileX2 />
        </Bolinha>
      )}
      {!temNota && !pago && pode("faturas.cancelar") && (
        <Bolinha titulo="Cancelar a fatura" tom="border-danger/40 bg-danger/10 text-danger-ink hover:bg-danger/20" onClick={() => setDlg("fatura")}>
          <Ban />
        </Bolinha>
      )}

      <FormDialog
        open={dlg === "baixa"}
        onOpenChange={(o) => !o && setDlg(null)}
        titulo={`Dar baixa em ${f.titulo}`}
        descricao={`${f.cliente} · ${moeda(f.valor)}. ${temNota ? "A NFS-e recebe a baixa junto." : ""}`}
        rotuloSalvar="Registrar pagamento"
        salvando={darBaixa.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          darBaixa.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data do pagamento" obrigatorio htmlFor="fx-data">
            <Input id="fx-data" type="date" required max={hoje()} value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} />
          </Field>
          <Field label="Valor recebido" htmlFor="fx-valor" dica="Vazio = o total da fatura.">
            <Input id="fx-valor" inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} placeholder={toNum(f.valor).toFixed(2).replace(".", ",")} className="num" />
          </Field>
          {(contas.data?.length ?? 0) > 0 && (
            <Field label="Conta bancária" htmlFor="fx-conta" dica="Onde o dinheiro entrou. Vazio = conta padrão de recebimento." className="sm:col-span-2">
              <NativeSelect id="fx-conta" value={baixa.conta} onChange={(e) => setBaixa({ ...baixa, conta: e.target.value })}>
                <option value="">Conta padrão</option>
                {contas.data!.filter((c) => c.ativo).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={dlg === "nfse" || dlg === "fatura"}
        onOpenChange={(o) => {
          if (!o) {
            setDlg(null);
            setMotivo("");
          }
        }}
        titulo={dlg === "nfse" ? `Cancelar a NFS-e ${f.nfse_numero}?` : `Cancelar a fatura ${f.titulo}?`}
        descricao={
          dlg === "nfse"
            ? f.origem === "nota"
              ? "A nota é cancelada na Prefeitura e a fatura é cancelada junto."
              : "A nota é cancelada na Prefeitura e a fatura volta para “Aguardando NFS-e”: emita outra nota ou cancele a fatura."
            : "Os itens (parcelas, horas e despesas) voltam para Itens a faturar."
        }
        confirmar={dlg === "nfse" ? "Cancelar NFS-e" : "Cancelar fatura"}
        destrutivo
        desabilitado={motivo.trim().length < (dlg === "nfse" ? 10 : 3)}
        carregando={cancelarNota.isPending || cancelarFatura.isPending}
        onConfirm={() => (dlg === "nfse" ? cancelarNota.mutate() : cancelarFatura.mutate())}
      >
        <Field label="Motivo" obrigatorio htmlFor="fx-motivo" dica={dlg === "nfse" ? "Mínimo de 10 caracteres (vai para a Prefeitura)." : undefined}>
          <Textarea id="fx-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
