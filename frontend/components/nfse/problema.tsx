"use client";

import { AlertTriangle, ChevronRight, Code2, XCircle } from "lucide-react";
import Link from "next/link";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Problema } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Um problema de validação/rejeição: mensagem humanizada + ação sugerida + detalhes técnicos. */
export function ProblemaItem({ p, className, semCaixa }: { p: Problema; className?: string; semCaixa?: boolean }) {
  const erro = p.nivel === "erro";
  const Icone = erro ? XCircle : AlertTriangle;
  const acao = p.acao ?? (p.nfse_id ? "Abrir a nota existente →" : null);
  return (
    <div
      className={cn(
        "flex gap-2 text-sm",
        !semCaixa && "rounded-lg border px-3 py-2",
        !semCaixa && (erro ? "border-danger/25 bg-danger/6" : "border-warning/30 bg-warning/8"),
        className,
      )}
    >
      <Icone className={cn("mt-0.5 size-4 shrink-0", erro ? "text-danger-ink" : "text-warning-ink")} />
      <div className="min-w-0 flex-1">
        <p>{p.mensagem}</p>
        {acao &&
          (p.nfse_id ? (
            <Link href={`/nfse/notas/${p.nfse_id}`} className="mt-0.5 inline-flex items-center text-xs font-medium text-info-ink hover:underline">
              {acao.replace(/\s*→\s*$/, "")} <ChevronRight className="size-3" />
            </Link>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">{acao}</p>
          ))}
      </div>
      {(p.tecnico || p.codigo != null) && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                aria-label="Detalhes técnicos"
              />
            }
          >
            <Code2 className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-sm font-mono text-[11px]">
            {p.codigo != null && <span className="font-semibold">Código {p.codigo}: </span>}
            {p.tecnico ?? p.campo}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
