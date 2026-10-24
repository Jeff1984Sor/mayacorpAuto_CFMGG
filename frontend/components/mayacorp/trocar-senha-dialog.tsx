"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";

import { Field } from "./form";
import { FormDialog } from "./form-dialog";
import { SenhaInput } from "./senha-input";

export function TrocarSenhaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const limpar = () => {
    setAtual("");
    setNova("");
    setConfirma("");
  };
  const trocar = useMutation({
    mutationFn: () => api.post("/auth/trocar-senha", { senha_atual: atual, nova_senha: nova }),
    onSuccess: () => {
      toast.success("Senha alterada");
      limpar();
      onOpenChange(false);
    },
  });
  const diferente = confirma.length > 0 && confirma !== nova;
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) limpar();
        onOpenChange(o);
      }}
      titulo="Trocar senha"
      descricao="Use pelo menos 8 caracteres, com letras e números."
      rotuloSalvar="Trocar senha"
      salvando={trocar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (diferente || !nova) return;
        trocar.mutate();
      }}
    >
      <div className="space-y-4">
        <Field label="Senha atual">
          <SenhaInput value={atual} onChange={setAtual} autoComplete="current-password" autoFocus />
        </Field>
        <Field label="Nova senha">
          <SenhaInput value={nova} onChange={setNova} autoComplete="new-password" forca />
        </Field>
        <Field label="Confirme a nova senha" erro={diferente ? "As senhas não conferem" : undefined}>
          <SenhaInput value={confirma} onChange={setConfirma} autoComplete="new-password" />
        </Field>
      </div>
    </FormDialog>
  );
}
