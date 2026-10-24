"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DIMENSOES, type Dimensao, type Filtros } from "@/lib/dashboard";

export interface EstadoDash {
  de: string;
  ate: string;
  f: Filtros;
  g: "semana" | "mes";
}

function lerUrl(padrao: { de: string; ate: string }): EstadoDash {
  const q = new URLSearchParams(window.location.search);
  const f: Filtros = {};
  DIMENSOES.forEach((d) => {
    const v = q.getAll(`f_${d}`);
    if (v.length) f[d] = v;
  });
  const data = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  return {
    de: data(q.get("de")) ?? padrao.de,
    ate: data(q.get("ate")) ?? padrao.ate,
    f,
    g: q.get("g") === "mes" ? "mes" : "semana",
  };
}

function gravarUrl(e: EstadoDash) {
  const q = new URLSearchParams();
  q.set("de", e.de);
  q.set("ate", e.ate);
  if (e.g === "mes") q.set("g", "mes");
  DIMENSOES.forEach((d) => (e.f[d] ?? []).forEach((v) => q.append(`f_${d}`, v)));
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}

/** Estado do dashboard (período + filtros) sincronizado com a querystring. */
export function useDashboardEstado(padrao: { de: string; ate: string } | null) {
  const [estado, setEstado] = useState<EstadoDash | null>(null);
  const iniciado = useRef(false);

  useEffect(() => {
    if (!padrao || iniciado.current) return;
    iniciado.current = true;
    setEstado(lerUrl(padrao));
  }, [padrao]);

  useEffect(() => {
    if (estado) gravarUrl(estado);
  }, [estado]);

  const alternar = useCallback((d: Dimensao, v: string, sozinho = false) => {
    setEstado((e) => {
      if (!e) return e;
      const atual = e.f[d] ?? [];
      const tem = atual.includes(v);
      const novo = sozinho ? (tem && atual.length === 1 ? [] : [v]) : tem ? atual.filter((x) => x !== v) : [...atual, v];
      return { ...e, f: { ...e.f, [d]: novo } };
    });
  }, []);

  const definir = useCallback((d: Dimensao, vals: string[]) => {
    setEstado((e) => (e ? { ...e, f: { ...e.f, [d]: vals } } : e));
  }, []);

  const periodo = useCallback((de: string, ate: string) => setEstado((e) => (e ? { ...e, de, ate } : e)), []);
  const granularidade = useCallback(
    (g: "semana" | "mes") => setEstado((e) => (e ? { ...e, g, f: { ...e.f, previsao: [] } } : e)),
    [],
  );
  const limpar = useCallback(() => setEstado((e) => (e ? { ...e, f: {} } : e)), []);

  return { estado, alternar, definir, periodo, granularidade, limpar };
}
