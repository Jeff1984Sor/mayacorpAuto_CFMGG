"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, baixar } from "@/lib/api";
import type { LoteOut } from "@/lib/types";

export function useAcoesLote(loteId: number | null | undefined, numero?: number) {
  const qc = useQueryClient();
  const n = String(numero ?? loteId ?? "").padStart(4, "0");

  const zip = useMutation({
    mutationFn: () => baixar("/nfse/notas/zip", { method: "POST", body: { lote_id: loteId, ids: [] } }, `notas-lote-${n}.zip`),
    onSuccess: () => toast.success("ZIP com PDFs e XMLs baixado"),
  });
  const conferencia = useMutation({
    mutationFn: () => baixar(`/nfse/lotes/${loteId}/conferencia`, {}, `conferencia-lote-${n}.xlsx`),
  });
  const arquivo = useMutation({
    mutationFn: () => baixar(`/nfse/lotes/${loteId}/arquivo`, {}, `lote-${n}.txt`),
  });
  const emails = useMutation({
    mutationFn: () => api.post<{ mensagem?: string }>(`/nfse/lotes/${loteId}/enviar-emails`),
    onSuccess: (r) => toast.success(r?.mensagem ?? "E-mails enviados aos tomadores"),
  });
  const reprocessar = useMutation({
    mutationFn: () => api.post<LoteOut>(`/nfse/lotes/${loteId}/reprocessar-rejeitados`),
    onSuccess: () => {
      toast.success("Rejeitados reenviados para a fila");
      qc.invalidateQueries({ queryKey: ["lote"] });
      qc.invalidateQueries({ queryKey: ["lotes"] });
    },
  });
  return { zip, conferencia, arquivo, emails, reprocessar };
}
