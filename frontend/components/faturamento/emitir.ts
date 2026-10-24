"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { api } from "@/lib/api";

/** Gera um lote de NFS-e com as NH escolhidas e abre a tela do lote (pré-validação → Emitir). */
export function useEmitirNfse() {
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fatura_ids: number[]) => api.post<{ lote_id: number; numero?: number }>("/faturamento/emitir-nfse", { fatura_ids }),
    onSuccess: (r, ids) => {
      toast.success(`Lote${r.numero ? ` ${r.numero}` : ""} criado com ${ids.length} nota(s)`, { description: "Confira a pré-validação e clique em Emitir." });
      qc.invalidateQueries({ queryKey: ["fat"] });
      qc.invalidateQueries({ queryKey: ["faturas"] });
      router.push(`/nfse/nova-emissao?lote=${r.lote_id}`);
    },
  });
}
