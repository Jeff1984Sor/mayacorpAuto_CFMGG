"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useTemToken } from "./auth";
import type { ContratoOut } from "./faturamento";

export interface ConfigFaturamento {
  usa_contrato: boolean;
}

export const CHAVE_CONFIG_FATURAMENTO = ["fat-config"];

/**
 * Configurações › Faturamento › "Trabalhar com contratos". Desligado, o escritório só vê Cliente → Caso: cada cliente
 * tem um contrato único por trás (regras de cobrança, emissora, tabela e pagadores), que as telas não mostram.
 * Enquanto carrega vale o padrão (com contratos).
 */
export function useUsaContrato(): boolean {
  const temToken = useTemToken();
  const q = useQuery({
    queryKey: CHAVE_CONFIG_FATURAMENTO,
    queryFn: () => api.get<ConfigFaturamento>("/faturamento/config"),
    staleTime: 5 * 60_000,
    enabled: temToken,
  });
  return q.data?.usa_contrato ?? true;
}

/** O contrato único do cliente (cria na primeira vez). É nele que entram os casos e as regras de cobrança. */
export const garantirContratoDoCliente = (tomadorId: number) => api.post<ContratoOut>(`/faturamento/clientes/${tomadorId}/contrato`, {});

/** Só consulta: null se o cliente ainda não tem nada definido. */
export const lerContratoDoCliente = (tomadorId: number) => api.get<ContratoOut | null>(`/faturamento/clientes/${tomadorId}/contrato`);
