"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Formulário em modal — padrão de cadastro MayaCorp. */
export function FormDialog({
  open,
  onOpenChange,
  titulo,
  descricao,
  children,
  onSubmit,
  salvando,
  rotuloSalvar = "Salvar",
  largura = "md",
  rodapeExtra,
  acaoCabecalho,
  formId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent) => void;
  salvando?: boolean;
  rotuloSalvar?: string;
  largura?: "md" | "lg" | "xl";
  rodapeExtra?: React.ReactNode;
  /** Ação no cabeçalho, à direita do título (ex.: "✨ Preencher com IA"). */
  acaoCabecalho?: React.ReactNode;
  formId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[92dvh] gap-0 overflow-hidden p-0",
          largura === "md" && "sm:max-w-lg",
          largura === "lg" && "sm:max-w-2xl",
          largura === "xl" && "sm:max-w-4xl",
        )}
      >
        <form id={formId} onSubmit={onSubmit} className="flex max-h-[92dvh] flex-col">
          <DialogHeader className="border-b p-5">
            <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", acaoCabecalho && "pr-8")}>
              <div className="min-w-0">
                <DialogTitle className="text-lg">{titulo}</DialogTitle>
                {descricao && <DialogDescription>{descricao}</DialogDescription>}
              </div>
              {acaoCabecalho && <div className="shrink-0">{acaoCabecalho}</div>}
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          <DialogFooter className="m-0 items-center rounded-none p-4">
            {rodapeExtra && <div className="mr-auto">{rodapeExtra}</div>}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvando} className="px-4">
              {salvando && <Loader2 className="animate-spin" />}
              {rotuloSalvar}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
