"use client";

import { useBrand } from "@/lib/brand";
import { VERSAO } from "@/lib/env";
import { iniciais } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Logo do cliente (white-label) com fallback de monograma. */
export function ClientLogo({ className, compacto }: { className?: string; compacto?: boolean }) {
  const { logoSrc, nome_exibicao } = useBrand();
  if (logoSrc && !compacto) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoSrc} alt={nome_exibicao} className={cn("h-8 w-auto object-contain", className)} />;
  }
  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl brand-gradient text-sm font-bold text-white shadow-lg shadow-brand/25 ring-1 ring-white/15",
        className,
      )}
    >
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={nome_exibicao} className="size-full bg-white object-contain p-1" />
      ) : (
        iniciais(nome_exibicao)
      )}
    </div>
  );
}

export function MayaCorpAssinatura({ className, versao = true }: { className?: string; versao?: boolean }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs", className)}>
      <span className="inline-block size-1.5 rounded-full bg-brand" />
      Uma solução <span className="font-semibold tracking-tight">MayaCorp</span>
      {versao && <span className="rounded bg-current/10 px-1.5 py-px font-mono text-[10px] opacity-80">{VERSAO}</span>}
    </p>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num text-[0.92em]", className)}>{children}</span>;
}
