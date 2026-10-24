import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { ConfigIAOut } from "@/lib/types";

export const configIAKey = ["config-ia"] as const;

export function useConfigIA() {
  return useQuery({
    queryKey: configIAKey,
    queryFn: () => api.get<ConfigIAOut>("/config/ia"),
    staleTime: 60_000,
    meta: { silencioso: true },
  });
}

/** Marca por 2s os campos preenchidos pela IA (procura [name] ou [data-campo] dentro do container). */
export function destacarCampos(container: HTMLElement | null, nomes: string[]) {
  if (!container) return;
  nomes.forEach((n) => {
    const el = container.querySelector<HTMLElement>(`[name="${n}"], [data-campo="${n}"]`);
    if (!el) return;
    el.removeAttribute("data-ia");
    void el.offsetWidth; // reinicia a animação
    el.setAttribute("data-ia", "1");
    setTimeout(() => el.removeAttribute("data-ia"), 2200);
  });
}
