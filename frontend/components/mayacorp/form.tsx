"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef, useId } from "react";

import { FieldIdContext, useFieldId } from "@/components/ui/field-id";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({
  label,
  erro,
  dica,
  children,
  className,
  obrigatorio,
  htmlFor,
}: {
  label: string;
  erro?: string;
  dica?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  obrigatorio?: boolean;
  htmlFor?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-[13px] text-foreground/80">
        {label}
        {obrigatorio && <span className="text-danger">*</span>}
      </Label>
      <FieldIdContext.Provider value={id}>{children}</FieldIdContext.Provider>
      {erro ? (
        <p className="text-xs text-danger">{erro}</p>
      ) : dica ? (
        <p className="text-xs text-muted-foreground">{dica}</p>
      ) : null}
    </div>
  );
}

/** Select nativo estilizado — leve e perfeito com react-hook-form. */
export const NativeSelect = forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(function NativeSelect(
  { className, children, id, ...props },
  ref,
) {
  const fieldId = useFieldId();
  return (
    <div className="relative">
      <select
        ref={ref}
        id={id ?? fieldId}
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30 [&>option]:bg-popover",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});

export function FormSection({
  titulo,
  descricao,
  children,
  className,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[220px_1fr] md:gap-8", className)}>
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {descricao && <p className="mt-1 text-xs text-muted-foreground">{descricao}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function SwitchRow({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/50 p-3.5">
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </div>
  );
}
