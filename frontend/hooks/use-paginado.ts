import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "@/lib/api";
import type { Pagina } from "@/lib/types";

import { useDebounce } from "./use-debounce";

type Filtros = Record<string, string | number | boolean | null | undefined>;

/** Lista paginada padrão: ?q=&pagina=&por_pagina= + filtros. */
export function usePaginado<T>(chave: string, path: string, filtrosIniciais: Filtros = {}, porPagina = 20) {
  const [q, setQBruto] = useState("");
  const [pagina, setPagina] = useState(1);
  const [filtros, setFiltrosBruto] = useState<Filtros>(filtrosIniciais);
  const busca = useDebounce(q, 300);

  const query = useQuery({
    queryKey: [chave, path, busca, pagina, porPagina, filtros],
    queryFn: () => api.get<Pagina<T>>(path, { q: busca, pagina, por_pagina: porPagina, ...filtros }),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    q,
    setQ: (v: string) => {
      setQBruto(v);
      setPagina(1);
    },
    pagina,
    setPagina,
    porPagina,
    filtros,
    setFiltro: (k: string, v: Filtros[string]) => {
      setFiltrosBruto((f) => ({ ...f, [k]: v }));
      setPagina(1);
    },
    itens: query.data?.itens ?? [],
    total: query.data?.total ?? 0,
  };
}
