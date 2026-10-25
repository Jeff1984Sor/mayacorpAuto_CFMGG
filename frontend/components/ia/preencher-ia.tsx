"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { PreenchimentoOut } from "@/lib/types";

import { AvisoIADesativada, IaButtonVisual, useIAAtiva } from "./ia-button";

/**
 * "✨ Preencher com IA": a pessoa cola um texto, a IA devolve campos e o formulário é preenchido
 * (sem salvar). `aplicar` recebe os campos e devolve quantos foram aplicados.
 */
export function PreencherIA<C extends Record<string, unknown>>({
  endpoint,
  rotulo = "Preencher com IA",
  titulo = "Preencher com IA",
  descricao = "Cole o texto e a IA preenche o formulário. Você revisa antes de salvar.",
  placeholder = "Cole aqui uma assinatura de e-mail, cartão CNPJ, contrato…",
  minimo = 10,
  corpo = (texto) => ({ texto }),
  aplicar,
  tamanho = "sm",
  linhas = 7,
  rotuloAcao = "Preencher",
}: {
  endpoint: string;
  rotulo?: string;
  titulo?: string;
  descricao?: string;
  placeholder?: string;
  minimo?: number;
  corpo?: (texto: string) => Record<string, unknown>;
  aplicar: (campos: C) => number;
  tamanho?: "sm" | "md";
  linhas?: number;
  rotuloAcao?: string;
}) {
  const { ativa, carregando: carregandoCfg, permitida } = useIAAtiva();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<{ qtd: number; avisos: string[] } | null>(null);

  const gerar = useMutation({
    mutationFn: () => api.post<PreenchimentoOut<C>>(endpoint, corpo(texto.trim())),
    onSuccess: (r) => {
      const qtd = aplicar(r.campos);
      setResultado({ qtd, avisos: r.avisos ?? [] });
      if (qtd > 0 && !(r.avisos ?? []).length) setTimeout(() => setAberto(false), 1400);
    },
  });

  if (!permitida) return null;
  if (!carregandoCfg && !ativa) return <AvisoIADesativada tamanho={tamanho}>{rotulo}</AvisoIADesativada>;

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (o) setResultado(null);
      }}
    >
      <PopoverTrigger render={<IaButtonVisual tamanho={tamanho} carregando={gerar.isPending} disabled={carregandoCfg} />}>{rotulo}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,420px)] gap-0 overflow-hidden p-0">
        <div className="relative border-b p-4">
          <div className="pointer-events-none absolute -top-10 -right-6 size-28 rounded-full bg-brand/20 blur-2xl" />
          <p className="relative flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4 text-info-ink" /> {titulo}
          </p>
          <p className="relative mt-0.5 text-xs text-muted-foreground">{descricao}</p>
        </div>
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (texto.trim().length >= minimo) gerar.mutate();
          }}
        >
          <div className="relative">
            <Textarea
              rows={linhas}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={placeholder}
              className="resize-none text-sm"
              autoFocus
              disabled={gerar.isPending}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (texto.trim().length >= minimo) gerar.mutate();
                }
              }}
            />
            {gerar.isPending && <div className="ia-shimmer pointer-events-none absolute inset-0 rounded-lg" />}
          </div>

          <AnimatePresence>
            {resultado && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-1.5 overflow-hidden">
                <p className="flex items-center gap-1.5 rounded-lg bg-success/8 px-3 py-2 text-sm text-success-ink">
                  <CheckCircle2 className="size-4 shrink-0" />
                  {resultado.qtd > 0 ? `${resultado.qtd} campo(s) preenchido(s). Revise e salve.` : "Não encontrei dados para preencher neste texto."}
                </p>
                {resultado.avisos.map((a, i) => (
                  <p key={i} className="flex gap-1.5 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-ink">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {a}
                  </p>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Ctrl+Enter · nada é salvo sozinho</span>
            <Button type="submit" size="sm" disabled={gerar.isPending || texto.trim().length < minimo}>
              <Wand2 /> {gerar.isPending ? "Pensando…" : rotuloAcao}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
