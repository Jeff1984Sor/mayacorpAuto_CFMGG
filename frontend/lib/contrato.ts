"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useAuth, useTemToken } from "./auth";
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

/**
 * Para onde vai um link de "abrir o cliente" (o cadastro, com a cobrança dele). Nos escritórios é Cadastros › Clientes.
 * No painel MayaCorp esse menu não existe: os clientes são os de Admin › Clientes, e a ficha é a do cliente cujo
 * cadastro (`tomador_id`) é aquele. Sem id, devolve a lista.
 */
export function useLinkCliente(): (tomadorId?: number | null, aba?: "cobrancas" | "dados") => string {
  const { usuario } = useAuth();
  const painel = !!usuario?.painel_mayacorp;
  const q = useQuery({
    queryKey: ["admin", "clientes", "por-cadastro"],
    queryFn: () => api.get<{ id: number; tomador_id: number | null }[]>("/admin/clientes"),
    staleTime: 60_000,
    enabled: painel,
  });
  return (tomadorId, aba = "cobrancas") => {
    if (!painel) return tomadorId ? `/cadastros/clientes?id=${tomadorId}` : "/cadastros/clientes";
    const c = tomadorId ? q.data?.find((x) => x.tomador_id === tomadorId) : undefined;
    return c ? `/admin/clientes/${c.id}?aba=${aba}` : "/admin/clientes";
  };
}

/** O contrato único do cliente (cria na primeira vez). É nele que entram os casos e as regras de cobrança. */
export const garantirContratoDoCliente = (tomadorId: number) => api.post<ContratoOut>(`/faturamento/clientes/${tomadorId}/contrato`, {});

/** Só consulta: null se o cliente ainda não tem nada definido. */
export const lerContratoDoCliente = (tomadorId: number) => api.get<ContratoOut | null>(`/faturamento/clientes/${tomadorId}/contrato`);
