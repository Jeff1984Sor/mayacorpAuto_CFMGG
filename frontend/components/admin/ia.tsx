"use client";

import { useMutation } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";

import { IaButton } from "@/components/ia/ia-button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * ✨ Botão de IA do admin com "Desfazer": chama `rota` com `corpo()`, entrega a resposta em `aplicar` e
 * guarda o valor anterior (`atual`) para voltar.
 */
export function BotaoIAAdmin<R, V>({
  rota,
  corpo,
  atual,
  aplicar,
  restaurar,
  rotulo,
  className,
}: {
  rota: string;
  corpo: () => Record<string, unknown>;
  atual: V;
  aplicar: (r: R) => void;
  restaurar: (v: V) => void;
  rotulo: string;
  className?: string;
}) {
  const [anterior, setAnterior] = useState<{ v: V } | null>(null);
  const ir = useMutation({
    mutationFn: () => api.post<R>(rota, corpo()),
    onSuccess: (r) => {
      setAnterior({ v: atual });
      aplicar(r);
    },
  });
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <IaButton tamanho="sm" carregando={ir.isPending} disabled={ir.isPending} onClick={() => ir.mutate()}>
        {rotulo}
      </IaButton>
      {anterior && !ir.isPending && (
        <button
          type="button"
          onClick={() => {
            restaurar(anterior.v);
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
