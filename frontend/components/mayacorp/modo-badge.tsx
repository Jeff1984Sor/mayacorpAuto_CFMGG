"use client";

import Link from "next/link";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePrefeitura } from "@/hooks/use-nfse";
import { useAuth } from "@/lib/auth";
import type { ModoPrefeitura } from "@/lib/types";
import { cn } from "@/lib/utils";

export const MODO_INFO: Record<ModoPrefeitura, { rotulo: string; dica: string; classe: string; ponto: string }> = {
  simulado: {
    rotulo: "Simulação",
    dica: "Nada vai para a Prefeitura. Notas de demonstração, sem valor fiscal.",
    classe: "bg-warning/12 text-warning-ink ring-warning/35",
    ponto: "bg-warning",
  },
  teste: {
    rotulo: "Teste",
    dica: "A Prefeitura valida o lote, mas não gera nota.",
    classe: "bg-brand/12 text-info-ink ring-brand/35",
    ponto: "bg-brand",
  },
  producao: {
    rotulo: "Produção",
    dica: "Emissão real: as notas têm valor fiscal.",
    classe: "bg-success/12 text-success-ink ring-success/35",
    ponto: "bg-success",
  },
};

/** Selo global do modo de emissão (topbar). */
export function ModoBadge({ className }: { className?: string }) {
  const { data } = usePrefeitura();
  const { pode } = useAuth();
  if (!data) return null;
  const m = MODO_INFO[data.modo] ?? MODO_INFO.simulado;
  const conteudo = (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        m.classe,
        className,
      )}
    >
      <span className="relative flex size-2">
        {data.modo === "producao" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", m.ponto)} />}
        <span className={cn("relative inline-flex size-2 rounded-full", m.ponto)} />
      </span>
      {m.rotulo}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={pode("cfg_prefeitura.ver") ? <Link href="/configuracoes/prefeitura" /> : <span />}>{conteudo}</TooltipTrigger>
      <TooltipContent side="bottom">{m.dica}</TooltipContent>
    </Tooltip>
  );
}
