"use client";

import { useQuery } from "@tanstack/react-query";
import { forwardRef, useId } from "react";

import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

/** Municípios da UF (lista oficial do IBGE, servida pela API). Fica em cache a sessão inteira. */
export function useCidades(uf: string | null | undefined) {
  const sigla = (uf ?? "").trim().toUpperCase();
  return useQuery({
    queryKey: ["cidades", sigla],
    queryFn: () => api.get<string[]>(`/cadastros/cidades/${sigla}`),
    enabled: sigla.length === 2,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Campo Cidade: escolhida a UF, sugere todos os municípios dela (dá para digitar e filtrar). */
export const CidadeInput = forwardRef<HTMLInputElement, React.ComponentProps<typeof Input> & { uf: string | null | undefined }>(
  function CidadeInput({ uf, placeholder, ...props }, ref) {
    const lista = useId();
    const cidades = useCidades(uf);
    const temUf = (uf ?? "").length === 2;
    return (
      <>
        <Input
          ref={ref}
          list={temUf ? lista : undefined}
          autoComplete="off"
          placeholder={placeholder ?? (temUf ? (cidades.isPending ? "Carregando cidades…" : `Digite para buscar (${cidades.data?.length ?? 0} cidades)`) : "Escolha a UF primeiro")}
          {...props}
        />
        {temUf && (
          <datalist id={lista}>
            {cidades.data?.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        )}
      </>
    );
  },
);
