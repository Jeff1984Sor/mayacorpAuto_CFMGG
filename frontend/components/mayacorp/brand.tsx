"use client";

import { useQuery } from "@tanstack/react-query";

import { API_URL } from "@/lib/api";
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

/** Marca do produto Maya Jus (telas públicas não mostram o nome do cliente). */
export function MayaJusLogo({ className, claro }: { className?: string; claro?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="grid size-11 shrink-0 place-items-center rounded-xl brand-gradient text-white shadow-lg shadow-brand/25 ring-1 ring-white/15">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7Zm14 0-3 7a3.5 3.5 0 0 0 6 0l-3-7Z" />
        </svg>
      </div>
      <div>
        <p className={cn("text-lg leading-tight font-semibold tracking-tight", claro ? "text-white" : "text-foreground")}>
          Maya <span className="text-brand">Jus</span>
        </p>
        <p className={cn("text-xs", claro ? "text-white/60" : "text-muted-foreground")}>Gestão para escritórios de advocacia</p>
      </div>
    </div>
  );
}

/** Versão que está no ar (v2, v3...), lida da API; o valor do build é só o fallback. */
function useVersao() {
  const { data } = useQuery({
    queryKey: ["versao-no-ar"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/health`);
      return ((await r.json()) as { versao?: string }).versao;
    },
    staleTime: 30 * 60_000,
    retry: false,
  });
  return data && data !== "dev" ? data : VERSAO;
}

export function MayaCorpAssinatura({ className, versao = true }: { className?: string; versao?: boolean }) {
  const numero = useVersao();
  return (
    <p className={cn("flex items-center gap-1.5 text-xs", className)}>
      <span className="inline-block size-1.5 rounded-full bg-brand" />
      Uma solução <span className="font-semibold tracking-tight">MayaCorp</span>
      {versao && <span className="rounded bg-current/10 px-1.5 py-px font-mono text-[10px] opacity-80">{numero}</span>}
    </p>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num text-[0.92em]", className)}>{children}</span>;
}
