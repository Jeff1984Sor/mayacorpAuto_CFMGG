"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { abrirArquivo, api, baixar } from "@/lib/api";
import type { NfseOut } from "@/lib/types";

export function SelosNota({ n }: { n: Pick<NfseOut, "simulada"> }) {
  return n.simulada ? (
    <Pill tom="warning" className="ml-1.5">
      Simulação
    </Pill>
  ) : null;
}

export function useAcoesNota() {
  const qc = useQueryClient();
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["notas"] });
    qc.invalidateQueries({ queryKey: ["nota"] });
    qc.invalidateQueries({ queryKey: ["painel"] });
  };
  return {
    pdf: (n: Pick<NfseOut, "id">) =>
      abrirArquivo(`/nfse/notas/${n.id}/pdf`).catch((e: Error) => toast.error(e.message)),
    xml: (n: Pick<NfseOut, "id" | "numero">) =>
      baixar(`/nfse/notas/${n.id}/xml`, {}, `nfse-${n.numero}.xml`).catch((e: Error) => toast.error(e.message)),
    prefeitura: (n: Pick<NfseOut, "link_prefeitura">) => window.open(n.link_prefeitura, "_blank", "noopener"),
    email: useMutation({
      mutationFn: ({ id, destinatarios }: { id: number; destinatarios?: string[] }) =>
        api.post(`/nfse/notas/${id}/enviar-email`, destinatarios ? { destinatarios } : {}),
      onSuccess: () => {
        toast.success("E-mail enviado ao tomador");
        invalidar();
      },
    }),
    zip: useMutation({
      mutationFn: (ids: number[]) => baixar("/nfse/notas/zip", { method: "POST", body: { ids } }, "notas.zip"),
      onSuccess: () => toast.success("ZIP baixado"),
    }),
    exportar: useMutation({
      mutationFn: (ids: number[]) => baixar("/nfse/notas/exportar", { method: "POST", body: { ids } }, "notas.xlsx"),
    }),
    invalidar,
  };
}

export function CancelarNotaDialog({
  nota,
  onClose,
}: {
  nota: Pick<NfseOut, "id" | "numero"> | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const cancelar = useMutation({
    mutationFn: () => api.post(`/nfse/notas/${nota!.id}/cancelar`, { motivo }),
    onSuccess: () => {
      toast.success(`NFS-e ${nota!.numero} cancelada`);
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["nota"] });
      setMotivo("");
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open={!!nota}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Cancelar a NFS-e ${nota?.numero ?? ""}?`}
      descricao="O cancelamento é enviado à Prefeitura e fica registrado na auditoria. Não é possível desfazer."
      confirmar="Cancelar nota"
      destrutivo
      carregando={cancelar.isPending}
      desabilitado={motivo.trim().length < 10}
      onConfirm={() => cancelar.mutate()}
    >
      <Field label="Motivo do cancelamento" obrigatorio dica={`${motivo.trim().length}/10 caracteres no mínimo`}>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: serviço não prestado, valor incorreto…" />
      </Field>
    </ConfirmDialog>
  );
}
