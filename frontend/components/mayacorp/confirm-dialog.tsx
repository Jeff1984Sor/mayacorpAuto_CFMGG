"use client";

import { Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function ConfirmDialog({
  open,
  onOpenChange,
  titulo,
  descricao,
  confirmar = "Confirmar",
  destrutivo,
  carregando,
  onConfirm,
  children,
  desabilitado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulo: string;
  descricao?: React.ReactNode;
  confirmar?: string;
  destrutivo?: boolean;
  carregando?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
  desabilitado?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          {descricao && <AlertDialogDescription>{descricao}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            variant={destrutivo ? "destructive" : "default"}
            className={destrutivo ? "bg-danger! text-white! hover:bg-danger/90!" : undefined}
            disabled={carregando || desabilitado}
            onClick={onConfirm}
          >
            {carregando && <Loader2 className="animate-spin" />}
            {confirmar}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
