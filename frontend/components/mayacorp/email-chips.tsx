"use client";

import { X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lista de e-mails em chips: Enter, vírgula ou ponto e vírgula adicionam; Backspace remove o último. */
export function EmailChips({
  value,
  onChange,
  erro,
  placeholder = "nome@empresa.com.br — Enter para adicionar",
  campo,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  erro?: string;
  placeholder?: string;
  /** Nome do campo (data-campo), usado para destacar após preenchimento por IA. */
  campo?: string;
}) {
  const [txt, setTxt] = useState("");
  const add = () => {
    const novos = txt
      .split(/[;,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (novos.length) onChange([...new Set([...value, ...novos])]);
    setTxt("");
  };
  return (
    <div>
      <div data-campo={campo} className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        {value.map((e) => (
          <span
            key={e}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs",
              EMAIL.test(e) ? "bg-brand/12" : "bg-danger/12 text-danger-ink",
            )}
          >
            {e}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== e))} aria-label={`Remover ${e}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === ";") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !txt && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={add}
          placeholder={value.length ? "" : placeholder}
          className="min-w-40 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {erro && <p className="mt-1 text-xs text-danger">{erro}</p>}
    </div>
  );
}

export const emailsValidos = (v: string[]) => v.every((e) => EMAIL.test(e));
