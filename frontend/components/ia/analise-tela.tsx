"use client";

import { useMutation } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import type { AnaliseOut } from "@/lib/types";

import { AnaliseSheet } from "./analise-ia";
import { IaButton } from "./ia-button";

const LIMITE = 60_000;

/** Texto visível da página (indicadores, tabelas, filtros), sem menus nem o que for marcado com data-ia-ignorar. */
function conteudoDaTela(): string {
  const main = document.querySelector("main");
  if (!main) return "";
  const copia = main.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-ia-ignorar], script, style, svg, button, nav[aria-label='breadcrumb']").forEach((e) => e.remove());
  // valores dos campos de filtro (datas, selects) não entram no innerText
  const filtros = [...main.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")]
    .filter((e) => e.type !== "checkbox" && e.type !== "hidden" && e.value)
    .map((e) => `${e.getAttribute("aria-label") || e.id || e.name || "filtro"}: ${e instanceof HTMLSelectElement ? e.selectedOptions[0]?.text : e.value}`);
  const texto = (copia.innerText || copia.textContent || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return [filtros.length ? `Filtros: ${filtros.join(" · ")}` : "", texto].filter(Boolean).join("\n\n").slice(0, LIMITE);
}

/** Botão "Análise por IA" presente em todas as telas: a IA lê o que está na tela e aponta riscos e próximos passos. */
export function AnaliseTelaIA({ titulo }: { titulo: string }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [analise, setAnalise] = useState<AnaliseOut | null>(null);
  const [rota, setRota] = useState<string | null>(null);
  const gerar = useMutation({
    mutationFn: () => {
      const conteudo = conteudoDaTela();
      if (conteudo.length < 20) throw new Error("A tela ainda não tem dados para analisar.");
      return api.post<AnaliseOut>("/ia/analise/tela", { tela: pathname + window.location.search, titulo, conteudo });
    },
    onSuccess: (a) => {
      setAnalise(a);
      setRota(pathname + window.location.search);
      setAberto(true);
    },
  });
  // a análise vale para a tela (e os filtros) em que foi feita
  const valida = analise && rota === pathname + (typeof window !== "undefined" ? window.location.search : "");
  return (
    <>
      <IaButton
        tamanho="sm"
        className="h-9"
        carregando={gerar.isPending && !aberto}
        onClick={() => (valida ? setAberto(true) : gerar.mutate())}
        title={valida ? "Ver a última análise desta tela" : "A IA lê o que está na tela e aponta riscos e próximos passos"}
      >
        Análise por IA
      </IaButton>
      <AnaliseSheet
        analise={analise}
        aberto={aberto}
        onOpenChange={setAberto}
        contexto={titulo}
        onRefazer={() => gerar.mutate()}
        refazendo={gerar.isPending}
      />
    </>
  );
}
