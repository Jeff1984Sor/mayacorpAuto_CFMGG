import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ConfigPrefeituraOut, EmissoraOut } from "@/lib/types";

export function useEmissoras() {
  return useQuery({
    queryKey: ["emissoras"],
    queryFn: () => api.get<EmissoraOut[]>("/nfse/emissoras"),
    staleTime: 60_000,
  });
}

export const nomeEmissora = (e: Pick<EmissoraOut, "nome_fantasia" | "razao_social">) => e.nome_fantasia || e.razao_social;

export function usePrefeitura() {
  return useQuery({
    queryKey: ["prefeitura"],
    queryFn: () => api.get<ConfigPrefeituraOut>("/config/prefeitura"),
    staleTime: 60_000,
    meta: { silencioso: true },
  });
}
