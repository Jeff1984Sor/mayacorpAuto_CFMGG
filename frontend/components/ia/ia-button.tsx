"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { forwardRef } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfigIA } from "@/hooks/use-ia";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Tamanho = "sm" | "md";

const BASE =
  "group/ia relative inline-flex shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-lg border font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-brand/40 disabled:pointer-events-none";

const VISUAL =
  "border-brand/35 bg-linear-to-r from-brand/10 via-brand/5 to-navy/10 text-info-ink shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_4px_14px_-6px_var(--brand)] hover:border-brand/60 hover:from-brand/18 hover:to-navy/14 hover:shadow-[0_6px_20px_-8px_var(--brand)] active:translate-y-px dark:from-brand/18 dark:to-navy/30";

const TAM: Record<Tamanho, string> = {
  sm: "h-7 px-2.5 text-[0.8rem] [&_svg]:size-3.5",
  md: "h-8 px-3 text-sm [&_svg]:size-4",
};

/** Superfície visual do botão de IA (sem lógica) — usada também como trigger de popovers. */
export const IaButtonVisual = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { carregando?: boolean; tamanho?: Tamanho }
>(function IaButtonVisual({ className, children, carregando, tamanho = "md", ...props }, ref) {
  return (
    <button ref={ref} type="button" aria-busy={carregando} className={cn(BASE, VISUAL, TAM[tamanho], className)} {...props}>
      {carregando && <span className="ia-shimmer pointer-events-none absolute inset-0" />}
      <Sparkles className={cn("relative transition-transform group-hover/ia:rotate-12 group-hover/ia:scale-110", carregando && "animate-pulse")} />
      <span className="relative">{carregando ? "Pensando…" : children}</span>
    </button>
  );
});

function AvisoIADesativada({ children, tamanho, className }: { children: React.ReactNode; tamanho?: Tamanho; className?: string }) {
  const { usuario } = useAuth();
  const gerencia = !!usuario?.equipe_mayacorp;
  return (
    <Popover>
      <PopoverTrigger render={<IaButtonVisual tamanho={tamanho} className={cn("opacity-80", className)} />}>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4">
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg brand-gradient text-white">
            <Sparkles className="size-4" />
          </span>
          <div className="text-sm">
            <p className="font-semibold">A IA está desligada</p>
            <p className="mt-1 text-muted-foreground">
              {gerencia ? (
                <>
                  Ative a IA em{" "}
                  <Link href="/configuracoes/ia" className="font-medium text-info-ink hover:underline">
                    Configurações › Inteligência Artificial
                  </Link>
                  .
                </>
              ) : (
                "Peça à MayaCorp para ativar a IA."
              )}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Botão "✨ IA" padrão. Se a IA estiver desativada, o clique abre um aviso em vez de chamar a ação.
 */
export function IaButton({
  onClick,
  carregando,
  children,
  tamanho,
  className,
  disabled,
  title,
}: {
  onClick: () => void;
  carregando?: boolean;
  children: React.ReactNode;
  tamanho?: Tamanho;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const cfg = useConfigIA();
  if (cfg.data && !cfg.data.ativo)
    return (
      <AvisoIADesativada tamanho={tamanho} className={className}>
        {children}
      </AvisoIADesativada>
    );
  return (
    <IaButtonVisual
      tamanho={tamanho}
      className={className}
      carregando={carregando}
      disabled={disabled || carregando || cfg.isPending}
      onClick={onClick}
      title={title}
    >
      {children}
    </IaButtonVisual>
  );
}

/** Para triggers de popover: true se a IA está ativa (ou ainda não sabemos). */
export function useIAAtiva() {
  const cfg = useConfigIA();
  return { ativa: !!cfg.data?.ativo, carregando: cfg.isPending };
}

export { AvisoIADesativada };
