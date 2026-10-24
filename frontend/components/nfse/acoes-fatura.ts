"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { baixar } from "@/lib/api";

/** ZIP de faturas por ids ou por lote. */
export function useZipFaturas() {
  return useMutation({
    mutationFn: (alvo: { ids?: number[]; lote_id?: number }) =>
      baixar(
        "/nfse/faturas/zip",
        { method: "POST", body: { ids: alvo.ids ?? [], lote_id: alvo.lote_id ?? null } },
        alvo.lote_id ? `faturas-lote-${alvo.lote_id}.zip` : "faturas.zip",
      ),
    onSuccess: () => toast.success("ZIP de faturas baixado"),
  });
}
