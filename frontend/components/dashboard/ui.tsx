"use client";

import { cn } from "@/lib/utils";

/** Card padrão dos visuais: título (sentence case), subtítulo, legenda/ações e corpo. */
export function ChartCard({
  titulo,
  subtitulo,
  acoes,
  legenda,
  children,
  className,
  destaque,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  acoes?: React.ReactNode;
  legenda?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  destaque?: boolean;
}) {
  return (
    <section
      className={cn(
        "card-surface relative flex min-w-0 flex-col p-4 sm:p-5",
        destaque && "ring-1 ring-brand/30 shadow-[0_12px_40px_-20px_var(--brand)]",
        className,
      )}
    >
      {destaque && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden>
          <div className="absolute -top-16 -right-10 size-48 rounded-full bg-brand/12 blur-3xl" />
        </div>
      )}
      <header className="relative mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">{titulo}</h3>
          {subtitulo && <p className="text-xs text-muted-foreground">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
      </header>
      {legenda && <div className="relative mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{legenda}</div>}
      <div className="relative min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Item de legenda: retângulo para barras/áreas, traço para linhas. Texto em tinta de texto, nunca na cor da série. */
export function LegendaItem({ cor, rotulo, forma = "rect" }: { cor: string; rotulo: string; forma?: "rect" | "linha" | "tracejado" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {forma === "rect" ? (
        <span className="size-2.5 rounded-[3px]" style={{ background: cor }} />
      ) : (
        <span
          className="h-0 w-3.5 border-t-2"
          style={{ borderColor: cor, borderStyle: forma === "tracejado" ? "dashed" : "solid" }}
        />
      )}
      {rotulo}
    </span>
  );
}

export interface LinhaTooltip {
  cor: string;
  rotulo: string;
  valor: string;
  forma?: "rect" | "linha";
}

/** Tooltip: o valor lidera (forte), o nome da série vem depois; chave em traço curto. */
export function TooltipCaixa({ titulo, linhas, rodape }: { titulo?: string; linhas: LinhaTooltip[]; rodape?: string }) {
  return (
    <div className="min-w-40 rounded-xl border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {titulo && <p className="mb-1 font-medium text-muted-foreground">{titulo}</p>}
      <div className="space-y-0.5">
        {linhas.map((l) => (
          <p key={l.rotulo} className="flex items-center gap-2">
            <span className="h-0 w-3 shrink-0 border-t-2" style={{ borderColor: l.cor }} />
            <strong className="text-sm text-foreground num">{l.valor}</strong>
            <span className="text-muted-foreground">{l.rotulo}</span>
          </p>
        ))}
      </div>
      {rodape && <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">{rodape}</p>}
    </div>
  );
}

/** Eixos/grade recessivos (hairline sólida). */
export const EIXO = { stroke: "var(--viz-axis)", fontSize: 11, tickLine: false, axisLine: false } as const;
export const GRADE = { stroke: "var(--viz-grid)", strokeDasharray: undefined } as const;
