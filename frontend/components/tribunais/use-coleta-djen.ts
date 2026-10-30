"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import type { ComunicacoesOut, Oab, Varredura } from "@/lib/tribunais";

/**
 * Coleta do DJEN feita pelo NAVEGADOR: o DJEN só responde a IPs do Brasil e o servidor fica fora.
 * O navegador busca as páginas direto no DJEN (CORS liberado, sem Authorization) e manda cada página
 * para /tribunais/varreduras/{id}/comunicacoes. Respeita o limite de requisições por minuto e o 429.
 */
export type FaseColeta = "coletando" | "aguardando" | "concluindo" | "fim" | "parada" | "erro";

export interface EstadoColeta {
  varreduraId: number;
  fase: FaseColeta;
  oab: Oab | null;
  oabIndice: number;
  oabTotal: number;
  pagina: number;
  paginas: number | null;
  comunicacoes: number;
  encontrados: number;
  intimacoes: number;
  resumo: Record<string, number>;
  /** Segundos até tentar de novo depois de um 429 */
  espera: number;
  mensagem: string | null;
}

const LOTE_MAX = 500;
const ESPERA_429 = 60;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function urlDjen(v: Varredura, oab: Oab, pagina: number) {
  const u = new URL(v.djen.url);
  u.searchParams.set("numeroOab", oab.numero.replace(/\D/g, ""));
  u.searchParams.set("ufOab", oab.uf.toUpperCase());
  u.searchParams.set("pagina", String(pagina));
  u.searchParams.set("itensPorPagina", String(v.djen.itens_por_pagina || 100));
  if (v.data_inicio) u.searchParams.set("dataDisponibilizacaoInicio", v.data_inicio.slice(0, 10));
  if (v.data_fim) u.searchParams.set("dataDisponibilizacaoFim", v.data_fim.slice(0, 10));
  return u.toString();
}

export function useColetaDjen(onFim?: (v: Varredura | null) => void) {
  const [estado, setEstado] = useState<EstadoColeta | null>(null);
  const pararRef = useRef(false);
  const rodandoRef = useRef(false);
  const onFimRef = useRef(onFim);
  useEffect(() => {
    onFimRef.current = onFim;
  }, [onFim]);

  const ativa = !!estado && (estado.fase === "coletando" || estado.fase === "aguardando" || estado.fase === "concluindo");

  // não deixa fechar a aba no meio da coleta
  useEffect(() => {
    if (!ativa) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [ativa]);

  // saiu da tela: encerra como parcial (o que já foi colhido fica salvo)
  useEffect(
    () => () => {
      pararRef.current = true;
    },
    [],
  );

  const parar = useCallback(() => {
    pararRef.current = true;
  }, []);

  const iniciar = useCallback(async (v: Varredura) => {
    if (rodandoRef.current) return;
    rodandoRef.current = true;
    pararRef.current = false;
    const porPagina = v.djen.itens_por_pagina || 100;
    const intervalo = Math.ceil(60_000 / Math.max(1, v.djen.requisicoes_por_minuto || 18)) + 100;
    const atualizar = (p: Partial<EstadoColeta> | ((e: EstadoColeta) => Partial<EstadoColeta>)) =>
      setEstado((e) => (e ? { ...e, ...(typeof p === "function" ? p(e) : p) } : e));
    /** Espera em fatias curtas para responder rápido ao "Parar". */
    const esperar = async (ms: number) => {
      const fim = Date.now() + ms;
      while (Date.now() < fim && !pararRef.current) await dormir(Math.min(250, fim - Date.now()));
    };

    setEstado({
      varreduraId: v.id,
      fase: "coletando",
      oab: v.inscricoes_oab[0] ?? null,
      oabIndice: 0,
      oabTotal: v.inscricoes_oab.length,
      pagina: 1,
      paginas: null,
      comunicacoes: v.total_comunicacoes,
      encontrados: v.total_encontrados,
      intimacoes: 0,
      resumo: v.resumo_por_tribunal ?? {},
      espera: 0,
      mensagem: null,
    });

    let erro: string | null = null;
    let ultima = 0;
    try {
      oabs: for (let i = 0; i < v.inscricoes_oab.length; i++) {
        const oab = v.inscricoes_oab[i];
        atualizar({ oab, oabIndice: i, pagina: 1, paginas: null });
        let n = 1;
        for (;;) {
          if (pararRef.current) break oabs;
          const falta = ultima + intervalo - Date.now();
          if (falta > 0) await esperar(falta);
          if (pararRef.current) break oabs;
          ultima = Date.now();
          atualizar({ fase: "coletando", pagina: n, espera: 0 });

          let r: Response;
          try {
            r = await fetch(urlDjen(v, oab, n), { headers: { Accept: "application/json" } });
          } catch {
            erro = "Não foi possível falar com o DJEN (sem internet, site fora do ar ou bloqueado pela rede).";
            break oabs;
          }
          if (r.status === 429) {
            // limite do DJEN: espera 1 minuto e tenta a mesma página de novo
            for (let s = ESPERA_429; s > 0 && !pararRef.current; s--) {
              atualizar({ fase: "aguardando", espera: s });
              await esperar(1000);
            }
            ultima = Date.now();
            continue;
          }
          if (!r.ok) {
            erro = `O DJEN respondeu com erro (HTTP ${r.status}) na página ${n} da OAB ${oab.numero}/${oab.uf}.`;
            break oabs;
          }
          const corpo = (await r.json()) as { count?: number | string; items?: Record<string, unknown>[] };
          const itens = Array.isArray(corpo.items) ? corpo.items : [];
          const count = Number(corpo.count ?? 0) || 0;
          atualizar({ paginas: Math.max(1, Math.ceil(count / porPagina)) });

          for (let k = 0; k < itens.length; k += LOTE_MAX) {
            const out = await api.post<ComunicacoesOut>(`/tribunais/varreduras/${v.id}/comunicacoes`, { itens: itens.slice(k, k + LOTE_MAX) });
            atualizar((e) => ({
              comunicacoes: out.total_comunicacoes,
              encontrados: out.total_encontrados,
              intimacoes: e.intimacoes + out.intimacoes_registradas,
              resumo: out.resumo_por_tribunal ?? e.resumo,
            }));
          }

          if (itens.length < porPagina || n * porPagina >= count) break;
          n++;
        }
      }
    } catch (e) {
      erro = e instanceof ApiError ? e.message : e instanceof Error ? `Falha na coleta: ${e.message}` : "Falha inesperada na coleta.";
    }

    const parou = pararRef.current;
    atualizar({ fase: "concluindo", espera: 0 });
    let fim: Varredura | null = null;
    try {
      fim = await api.post<Varredura>(
        `/tribunais/varreduras/${v.id}/concluir`,
        erro ? { erro: erro.slice(0, 1000), parcial: true } : parou ? { parcial: true } : {},
      );
      atualizar({
        fase: erro ? "erro" : parou ? "parada" : "fim",
        mensagem: erro,
        resumo: fim.resumo_por_tribunal ?? {},
        encontrados: fim.total_encontrados,
        comunicacoes: fim.total_comunicacoes,
      });
    } catch (e) {
      atualizar({ fase: "erro", mensagem: erro ?? (e instanceof Error ? e.message : "Não foi possível encerrar a busca.") });
    } finally {
      rodandoRef.current = false;
    }
    onFimRef.current?.(fim);
  }, []);

  const limpar = useCallback(() => {
    if (!rodandoRef.current) setEstado(null);
  }, []);

  return { estado, ativa, iniciar, parar, limpar };
}
