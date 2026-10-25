import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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
  const { pode } = useAuth();
  return useQuery({
    queryKey: ["prefeitura"],
    queryFn: () => api.get<ConfigPrefeituraOut>("/config/prefeitura"),
    enabled: pode("cfg_prefeitura.ver"),
    staleTime: 60_000,
    meta: { silencioso: true },
  });
}
