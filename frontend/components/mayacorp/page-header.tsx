import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export function PageHeader({
  titulo,
  descricao,
  icone: Icone,
  acoes,
  migalhas,
  className,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  icone?: React.ComponentType<{ className?: string }>;
  acoes?: React.ReactNode;
  migalhas?: { label: string; href?: string }[];
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {migalhas && migalhas.length > 0 && (
          <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {migalhas.map((m, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="size-3" />}
                {m.href ? (
                  <Link href={m.href} className="transition-colors hover:text-foreground">
                    {m.label}
                  </Link>
                ) : (
                  <span className="text-foreground/80">{m.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          {Icone && (
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/12 text-navy ring-1 ring-brand/25 dark:text-brand">
              <Icone className="size-5" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{titulo}</h1>
            {descricao && <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>}
          </div>
        </div>
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
