"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function forcaSenha(s: string) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^A-Za-z0-9]/.test(s)) p++;
  return Math.min(4, p);
}

/** Campo de senha com olho para mostrar e medidor de força opcional. */
export function SenhaInput({
  value,
  onChange,
  forca,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (v: string) => void;
  forca?: boolean;
}) {
  const [ver, setVer] = useState(false);
  const f = forcaSenha(value);
  return (
    <div>
      <div className="relative">
        <Input {...props} type={ver ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} className={cn("pr-9", className)} />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setVer((x) => !x)}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
          aria-label={ver ? "Ocultar senha" : "Mostrar senha"}
        >
          {ver ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      </div>
      {forca && (
        <div className="mt-1.5 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1 rounded-full bg-muted transition-colors",
                value && i < f && (f <= 1 ? "bg-danger" : f === 2 ? "bg-warning" : "bg-success"),
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}
