import { cn } from "@/lib/utils";

/** Estado vazio ilustrado: ícone sobre "folhas" empilhadas com brilho da marca. */
export function EmptyState({
  icone: Icone,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  descricao?: React.ReactNode;
  acao?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="relative mb-6 h-28 w-36">
        <div className="absolute inset-0 rounded-full bg-brand/20 blur-2xl" />
        <div className="absolute top-4 left-3 h-20 w-24 -rotate-8 rounded-xl border bg-card/80 shadow-sm" />
        <div className="absolute top-2 right-3 h-20 w-24 rotate-6 rounded-xl border bg-card/80 shadow-sm" />
        <div className="absolute inset-x-6 top-0 grid h-24 place-items-center rounded-2xl border bg-card shadow-lg">
          <div className="grid size-12 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/30">
            <Icone className="size-6" />
          </div>
          <div className="absolute bottom-3 left-4 h-1.5 w-10 rounded-full bg-muted" />
          <div className="absolute right-4 bottom-3 h-1.5 w-6 rounded-full bg-brand/30" />
        </div>
      </div>
      <h3 className="text-base font-semibold">{titulo}</h3>
      {descricao && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}
