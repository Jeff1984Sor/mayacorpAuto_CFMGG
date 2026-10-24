"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, Copy, Lightbulb, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import type { AnaliseOut, NivelPonto } from "@/lib/types";
import { cn } from "@/lib/utils";

import { IaButton } from "./ia-button";

const NIVEL: Record<NivelPonto, { icone: React.ComponentType<{ className?: string }>; caixa: string; texto: string; rotulo: string }> = {
  ok: { icone: CheckCircle2, caixa: "border-success/25 bg-success/6", texto: "text-success-ink", rotulo: "OK" },
  atencao: { icone: AlertTriangle, caixa: "border-warning/30 bg-warning/8", texto: "text-warning-ink", rotulo: "Atenção" },
  risco: { icone: ShieldAlert, caixa: "border-danger/25 bg-danger/6", texto: "text-danger-ink", rotulo: "Risco" },
};

function paraTexto(a: AnaliseOut) {
  const rot = { ok: "✅", atencao: "⚠️", risco: "🛑" } as const;
  return [
    a.titulo,
    "",
    a.resumo,
    "",
    ...a.pontos.map((p) => `${rot[p.nivel] ?? "•"} ${p.texto}`),
    "",
    `Recomendação: ${a.recomendacao}`,
    "",
    "Gerado por IA, confira antes de decidir.",
  ].join("\n");
}

export function AnaliseSheet({
  analise,
  aberto,
  onOpenChange,
  contexto,
  onRefazer,
  refazendo,
}: {
  analise: AnaliseOut | null;
  aberto: boolean;
  onOpenChange: (o: boolean) => void;
  contexto: string;
  onRefazer?: () => void;
  refazendo?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    if (!analise) return;
    await navigator.clipboard.writeText(paraTexto(analise));
    setCopiado(true);
    toast.success("Análise copiada");
    setTimeout(() => setCopiado(false), 1800);
  };
  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="relative overflow-hidden border-b p-5">
          <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand/20 blur-3xl" />
          <span className="relative inline-flex w-fit items-center gap-1 rounded-full bg-linear-to-r from-navy to-brand px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
            <Sparkles className="size-3" /> Análise por IA · {contexto}
          </span>
          <SheetTitle className="relative mt-2 pr-8 text-xl leading-snug">{analise?.titulo ?? "Analisando…"}</SheetTitle>
          <SheetDescription className="sr-only">Resultado da análise gerada por inteligência artificial</SheetDescription>
        </SheetHeader>

        {analise && (
          <div className={cn("flex-1 space-y-5 overflow-y-auto p-5 transition-opacity", refazendo && "opacity-50")}>
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[15px] leading-relaxed">
              {analise.resumo}
            </motion.p>

            {analise.pontos.length > 0 && (
              <ul className="space-y-2">
                {analise.pontos.map((p, i) => {
                  const n = NIVEL[p.nivel] ?? NIVEL.atencao;
                  return (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.08 + i * 0.06 }}
                      className={cn("flex gap-3 rounded-xl border p-3 text-sm", n.caixa)}
                    >
                      <n.icone className={cn("mt-0.5 size-4 shrink-0", n.texto)} />
                      <span className="flex-1">{p.texto}</span>
                      <span className={cn("shrink-0 text-[10px] font-semibold tracking-wider uppercase", n.texto)}>{n.rotulo}</span>
                    </motion.li>
                  );
                })}
              </ul>
            )}

            {analise.recomendacao && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15 + analise.pontos.length * 0.06 }}
                className="relative overflow-hidden rounded-2xl brand-gradient p-4 text-white shadow-lg shadow-brand/25"
              >
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-white/75 uppercase">
                  <Lightbulb className="size-3.5" /> Recomendação
                </p>
                <p className="mt-1 font-medium">{analise.recomendacao}</p>
              </motion.div>
            )}
          </div>
        )}

        <SheetFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground">Gerado por IA, confira antes de decidir.</p>
          <div className="flex gap-2">
            {onRefazer && (
              <Button variant="ghost" size="sm" onClick={onRefazer} disabled={refazendo}>
                <RefreshCw className={cn(refazendo && "animate-spin")} /> Refazer
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={copiar} disabled={!analise}>
              {copiado ? <Check /> : <Copy />} {copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Botão "Análise por IA" + Sheet com o resultado. */
export function BotaoAnaliseIA({
  endpoint,
  contexto,
  rotulo = "Análise por IA",
  tamanho,
  className,
}: {
  endpoint: string;
  contexto: string;
  rotulo?: string;
  tamanho?: "sm" | "md";
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [analise, setAnalise] = useState<AnaliseOut | null>(null);
  const gerar = useMutation({
    mutationFn: () => api.post<AnaliseOut>(endpoint),
    onSuccess: (a) => {
      setAnalise(a);
      setAberto(true);
    },
  });
  return (
    <>
      <IaButton
        tamanho={tamanho}
        className={className}
        carregando={gerar.isPending && !aberto}
        onClick={() => (analise ? setAberto(true) : gerar.mutate())}
        title={analise ? "Ver a última análise" : undefined}
      >
        {rotulo}
      </IaButton>
      <AnaliseSheet
        analise={analise}
        aberto={aberto}
        onOpenChange={setAberto}
        contexto={contexto}
        onRefazer={() => gerar.mutate()}
        refazendo={gerar.isPending}
      />
    </>
  );
}
