"use client";

import { useMutation } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import { useFieldId } from "@/components/ui/field-id";
import { Input } from "@/components/ui/input";
import { IaButtonVisual } from "@/components/ia/ia-button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// ================================================================ horas HH:MM
/** "1:30" → 90 · null se vazio/ inválido. Aceita só HH:MM (minutos 00–59, até 24:00). */
export function minutosDe(txt: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(txt.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi > 59) return null;
  const total = h * 60 + mi;
  return total > 0 && total <= 24 * 60 ? total : null;
}

/** Mensagem de erro para o campo de horas (null = ok). */
export function erroHoras(txt: string): string | null {
  const t = txt.trim();
  if (!t) return "Informe as horas.";
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return "Use o formato HH:MM.";
  if (Number(m[2]) > 59) return "Os minutos vão de 00 a 59.";
  const total = Number(m[1]) * 60 + Number(m[2]);
  if (total === 0) return "Informe um tempo maior que zero.";
  if (total > 24 * 60) return "No máximo 24:00 por lançamento.";
  return null;
}

/** Máscara durante a digitação: só dígitos e ":"; "130" vira "1:30". */
function mascarar(v: string) {
  const limpo = v.replace(/[^\d:]/g, "");
  if (limpo.includes(":")) {
    const [h, m = ""] = limpo.split(":");
    return `${h.slice(0, 2)}:${m.replace(/:/g, "").slice(0, 2)}`;
  }
  const d = limpo.slice(0, 4);
  return d.length >= 3 ? `${d.slice(0, d.length - 2)}:${d.slice(-2)}` : d;
}

/** No blur: "10" → "10:00", "1:3" → "1:30". */
function completar(v: string) {
  const t = v.trim();
  if (!t) return t;
  if (/^\d{1,2}$/.test(t)) return `${t}:00`;
  const m = /^(\d{1,2}):(\d)$/.exec(t);
  if (m) return `${m[1]}:${m[2]}0`;
  return t;
}

export const rotuloMinutos = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** Campo de horas sempre em HH:MM. `mostrarErro` liga a mensagem inline (ex.: depois de tentar salvar). */
export function HorasInput({
  value,
  onChange,
  id,
  mostrarErro,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  mostrarErro?: boolean;
  className?: string;
  autoFocus?: boolean;
}) {
  const fieldId = useFieldId();
  const [tocado, setTocado] = useState(false);
  const min = minutosDe(value);
  const erro = mostrarErro || (tocado && value.trim() !== "") ? erroHoras(value) : null;
  return (
    <div>
      <Input
        id={id ?? fieldId}
        value={value}
        inputMode="numeric"
        placeholder="HH:MM"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-invalid={!!erro}
        onChange={(e) => onChange(mascarar(e.target.value))}
        onBlur={() => {
          setTocado(true);
          onChange(completar(value));
        }}
        className={cn("font-mono tabular-nums", className)}
      />
      <p className={cn("mt-1 text-xs", erro ? "text-danger" : "text-muted-foreground")} aria-live="polite">
        {erro ?? (min ? `= ${rotuloMinutos(min)}` : "ex.: 1:30")}
      </p>
    </div>
  );
}

// ================================================================ ✨ Enriquecer com IA
export interface TextoEnriquecivel {
  titulo?: string;
  descricao: string;
}

/**
 * Reescreve o texto de forma profissional (andamento ou horas). Mostra "Desfazer" para voltar ao texto anterior.
 * Erros (inclusive IA desligada) aparecem como toast.
 */
export function EnriquecerIA({
  valor,
  onChange,
  corpo,
  className,
}: {
  valor: TextoEnriquecivel;
  onChange: (v: TextoEnriquecivel) => void;
  corpo: () => Record<string, unknown>;
  className?: string;
}) {
  const [anterior, setAnterior] = useState<TextoEnriquecivel | null>(null);
  const texto = (valor.descricao || valor.titulo || "").trim();
  const ir = useMutation({
    mutationFn: () => api.post<{ titulo?: string; descricao: string }>("/faturamento/ia/enriquecer", corpo()),
    onSuccess: (r) => {
      setAnterior(valor);
      onChange({ ...valor, ...(r.titulo !== undefined && valor.titulo !== undefined ? { titulo: r.titulo } : {}), descricao: r.descricao });
    },
  });
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <IaButtonVisual type="button" tamanho="sm" carregando={ir.isPending} disabled={ir.isPending || texto.length < 2} onClick={() => ir.mutate()} title={texto.length < 2 ? "Escreva algo primeiro" : undefined}>
        Enriquecer com IA
      </IaButtonVisual>
      {anterior && !ir.isPending && (
        <button
          type="button"
          onClick={() => {
            onChange(anterior);
            setAnterior(null);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Undo2 className="size-3" /> Desfazer
        </button>
      )}
    </span>
  );
}
