"use client";

import { useMutation } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Conversa, UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

/** Escolher pessoas: "grupo" (título + várias) ou "direta" (uma, abre a conversa). */
export function EscolherPessoas({
  modo,
  open,
  onOpenChange,
  usuarios,
  onCriado,
}: {
  modo: "grupo" | "direta";
  open: boolean;
  onOpenChange: (o: boolean) => void;
  usuarios: UsuarioChat[];
  onCriado: (c: Conversa) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [sel, setSel] = useState<number[]>([]);
  const [q, setQ] = useState("");
  const lista = usuarios.filter((u) => !q.trim() || u.nome.toLowerCase().includes(q.trim().toLowerCase()));

  const limpar = () => {
    setTitulo("");
    setSel([]);
    setQ("");
  };
  const criar = useMutation({
    mutationFn: () =>
      modo === "grupo"
        ? api.post<Conversa>("/comunicador/grupos", { titulo: titulo.trim(), usuario_ids: sel })
        : api.post<Conversa>(`/comunicador/diretas/${sel[0]}`),
    onSuccess: (c) => {
      limpar();
      onOpenChange(false);
      onCriado(c);
    },
  });
  const valido = modo === "grupo" ? titulo.trim().length >= 2 && sel.length > 0 : sel.length === 1;

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) limpar();
        onOpenChange(o);
      }}
      titulo={modo === "grupo" ? "Novo grupo" : "Nova conversa"}
      descricao={modo === "grupo" ? "Dê um nome e escolha quem participa." : "Escolha com quem conversar."}
      rotuloSalvar={modo === "grupo" ? "Criar grupo" : "Abrir conversa"}
      salvando={criar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) criar.mutate();
      }}
    >
      <div className="space-y-4">
        {modo === "grupo" && (
          <Field label="Nome do grupo">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="ex.: Financeiro" autoFocus maxLength={140} />
          </Field>
        )}
        <div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" className="pl-8" autoFocus={modo === "direta"} />
          </div>
          <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border p-1">
            {lista.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Ninguém encontrado.</li>}
            {lista.map((u) => {
              const on = sel.includes(u.id);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSel((s) => (modo === "direta" ? [u.id] : on ? s.filter((x) => x !== u.id) : [...s, u.id]))}
                    className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted", on && "bg-brand/8")}
                  >
                    <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-8" textoClassName="text-[10px]" />
                    <span className="min-w-0 flex-1 truncate">{u.nome}</span>
                    <span
                      className={cn(
                        "grid size-5 place-items-center border",
                        modo === "direta" ? "rounded-full" : "rounded",
                        on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30",
                      )}
                    >
                      {on && <Check className="size-3" strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {modo === "grupo" && sel.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{sel.length} pessoa(s) + você</p>}
        </div>
      </div>
    </FormDialog>
  );
}
