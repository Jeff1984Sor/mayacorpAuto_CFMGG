"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { motion } from "motion/react";

import { Skeleton } from "@/components/ui/skeleton";
import { percentual } from "@/lib/format";
import { cn } from "@/lib/utils";

export function KpiCard({
  titulo,
  valor,
  variacao,
  icone: Icone,
  /** Quando true, subir é ruim (ex.: rejeições, tempo). */
  inverso,
  dica,
  carregando,
  indice = 0,
}: {
  titulo: string;
  valor: React.ReactNode;
  variacao?: number | null;
  icone: React.ComponentType<{ className?: string }>;
  inverso?: boolean;
  dica?: string;
  carregando?: boolean;
  indice?: number;
}) {
  const bom = variacao == null || variacao === 0 ? null : inverso ? variacao < 0 : variacao > 0;
  const Seta = variacao == null || variacao === 0 ? Minus : variacao > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: indice * 0.05, duration: 0.35, ease: "easeOut" }}
      className="group card-surface relative overflow-hidden p-4"
    >
      <div className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-brand/10 blur-2xl transition-opacity group-hover:opacity-100 md:opacity-60" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground">{titulo}</p>
        <div className="grid size-8 place-items-center rounded-lg bg-brand/10 text-navy dark:text-brand">
          <Icone className="size-4" />
        </div>
      </div>
      {carregando ? (
        <Skeleton className="mt-3 h-8 w-28" />
      ) : (
        <p className="relative mt-2 truncate text-[22px] leading-tight font-semibold tracking-tight num sm:text-[26px]">{valor}</p>
      )}
      <div className="relative mt-2 flex items-center gap-1.5 text-xs">
        {carregando ? (
          <Skeleton className="h-4 w-24" />
        ) : variacao == null ? (
          <span className="text-muted-foreground">sem histórico do mês anterior</span>
        ) : (
          <>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
                bom === null && "bg-muted text-muted-foreground",
                bom === true && "bg-success/10 text-success-ink",
                bom === false && "bg-danger/10 text-danger-ink",
              )}
            >
              <Seta className="size-3" />
              {percentual(variacao ?? null)}
            </span>
            <span className="text-muted-foreground">{dica ?? "vs. mês anterior"}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}
