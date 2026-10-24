import { cn } from "@/lib/utils";

type Tom = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const TONS: Record<Tom, string> = {
  success: "bg-success/10 text-success-ink ring-success/25",
  warning: "bg-warning/12 text-warning-ink ring-warning/30",
  danger: "bg-danger/10 text-danger-ink ring-danger/25",
  info: "bg-info/10 text-info-ink ring-info/25",
  neutral: "bg-muted text-muted-foreground ring-border",
  brand: "bg-brand/12 text-info-ink ring-brand/30",
};

const DOT: Record<Tom, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-muted-foreground/60",
  brand: "bg-brand",
};

const MAPA: Record<string, [string, Tom, boolean?]> = {
  // lote
  validando: ["Validando", "info"],
  na_fila: ["Na fila", "brand", true],
  transmitindo: ["Transmitindo", "brand", true],
  concluido: ["Concluído", "success"],
  parcial: ["Parcial", "warning"],
  falhou: ["Falhou", "danger"],
  descartado: ["Descartado", "neutral"],
  // rps
  ok: ["OK", "success"],
  aviso: ["Aviso", "warning"],
  erro: ["Erro", "danger"],
  emitido: ["Emitido", "success"],
  rejeitado: ["Rejeitado", "danger"],
  // nfse
  emitida: ["Emitida", "success"],
  cancelada: ["Cancelada", "neutral"],
  // fatura
  aberta: ["Aberta", "brand"],
  vencida: ["Vencida", "danger"],
  paga: ["Paga", "success"],
  // lançamento do extrato
  conciliado: ["Conciliado", "success"],
  sugerido: ["Sugerido", "warning"],
  sem_par: ["Sem par", "neutral"],
  ignorado: ["Ignorado", "neutral"],
  duplicado: ["Duplicado", "info"],
  // hub
  ativo: ["Ativo", "success"],
  planejado: ["Planejado", "info"],
  ideia: ["Ideia", "neutral"],
};

export function StatusBadge({
  status,
  label,
  tom,
  className,
  pulse,
}: {
  status?: string;
  label?: string;
  tom?: Tom;
  className?: string;
  pulse?: boolean;
}) {
  const [l, t, p] = MAPA[status ?? ""] ?? [status ?? "", "neutral" as Tom];
  const tone = tom ?? t;
  const pulsar = pulse ?? p;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONS[tone],
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {pulsar && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", DOT[tone])} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", DOT[tone])} />
      </span>
      {label ?? l}
    </span>
  );
}

export function Pill({ children, tom = "neutral", className }: { children: React.ReactNode; tom?: Tom; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset",
        TONS[tom],
        className,
      )}
    >
      {children}
    </span>
  );
}
