"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

/** Botão "Excluir" do admin: confirmação, chamada DELETE e aviso. `digitar` exige redigitar um texto (sem volta). */
export function BotaoExcluir({
  url,
  titulo,
  descricao,
  digitar,
  rotulo = "Excluir",
  icone = false,
  onFeito,
}: {
  url: string;
  titulo: string;
  descricao: string;
  digitar?: string;
  rotulo?: string;
  icone?: boolean;
  onFeito?: () => void;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const excluir = useMutation({
    mutationFn: () => api.del<{ mensagem: string }>(digitar ? `${url}?confirmar=${encodeURIComponent(texto.trim())}` : url),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["admin"] });
      onFeito?.();
    },
    onError: () => setAberto(false),
  });
  return (
    <>
      {icone ? (
        <Button type="button" size="icon" variant="ghost" title={rotulo} aria-label={rotulo} onClick={() => setAberto(true)}>
          <Trash2 />
        </Button>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="text-danger-ink" onClick={() => setAberto(true)}>
          <Trash2 /> {rotulo}
        </Button>
      )}
      <ConfirmDialog
        open={aberto}
        onOpenChange={(o) => {
          setAberto(o);
          if (!o) setTexto("");
        }}
        titulo={titulo}
        descricao={descricao}
        confirmar={rotulo}
        destrutivo
        desabilitado={!!digitar && texto.trim().toLowerCase() !== digitar.toLowerCase()}
        carregando={excluir.isPending}
        onConfirm={() => excluir.mutate()}
      >
        {digitar && (
          <div className="space-y-1.5">
            <p className="text-sm">
              Para confirmar, digite <b className="font-mono">{digitar}</b>:
            </p>
            <Input value={texto} onChange={(e) => setTexto(e.target.value)} className="font-mono" autoFocus />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
