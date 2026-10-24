"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CircleUserRound, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { useState } from "react";

import { Mono } from "@/components/mayacorp/brand";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { UsuarioMe } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERFIL = { admin: "Administrador", operador: "Operador", visualizador: "Visualizador" } as const;

function TrocarSenha() {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const diferente = confirma.length > 0 && confirma !== nova;
  const trocar = useMutation({
    mutationFn: () => api.post("/auth/trocar-senha", { senha_atual: atual, nova_senha: nova }),
    onSuccess: () => {
      toast.success("Senha alterada");
      setAtual("");
      setNova("");
      setConfirma("");
    },
  });
  return (
    <form
      className="card-surface space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!diferente && nova) trocar.mutate();
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <KeyRound className="size-4 text-info-ink" /> Trocar senha
      </h3>
      <Field label="Senha atual">
        <SenhaInput value={atual} onChange={setAtual} autoComplete="current-password" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nova senha">
          <SenhaInput value={nova} onChange={setNova} autoComplete="new-password" forca />
        </Field>
        <Field label="Confirme a nova senha" erro={diferente ? "As senhas não conferem" : undefined}>
          <SenhaInput value={confirma} onChange={setConfirma} autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={trocar.isPending || !atual || !nova || diferente}>
          {trocar.isPending && <Loader2 className="animate-spin" />} Salvar nova senha
        </Button>
      </div>
    </form>
  );
}

export default function MinhaContaPage() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const atualizar = (u: UsuarioMe) => {
    qc.setQueryData(["me"], u);
    qc.invalidateQueries({ queryKey: ["usuarios"] });
  };
  const enviar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<UsuarioMe>("/auth/me/foto", fd);
    },
    onSuccess: (u) => {
      atualizar(u);
      toast.success("Foto atualizada");
    },
  });
  const remover = useMutation({
    mutationFn: () => api.del<UsuarioMe>("/auth/me/foto"),
    onSuccess: (u) => {
      atualizar(u);
      toast.success("Foto removida");
    },
  });
  const dz = useDropzone({
    multiple: false,
    accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] },
    maxSize: 4 * 1024 * 1024,
    onDrop: (f) => f[0] && enviar.mutate(f[0]),
    onDropRejected: () => toast.error("Use PNG, JPG ou WEBP de até 4 MB."),
  });
  if (!usuario) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader titulo="Minha conta" descricao="Sua foto, seus dados de acesso e sua senha." icone={CircleUserRound} />
      <div className="space-y-5">
        <div className="card-surface relative overflow-hidden">
          <div className="brand-gradient h-24" />
          <div className="flex flex-col gap-5 px-5 pb-5 sm:flex-row sm:items-end">
            <div
              {...dz.getRootProps()}
              className={cn(
                "group relative -mt-12 size-28 shrink-0 cursor-pointer rounded-full ring-4 ring-card transition",
                dz.isDragActive && "ring-brand",
              )}
              title="Arraste uma foto ou clique para escolher"
            >
              <input {...dz.getInputProps()} />
              <UserAvatar nome={usuario.nome} fotoUrl={usuario.foto_url} className="size-28" textoClassName="text-3xl" />
              <div className="absolute inset-0 grid place-items-center rounded-full bg-dark-maya/55 text-white opacity-0 transition group-hover:opacity-100">
                {enviar.isPending ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold">{usuario.nome}</h2>
              <p className="text-sm text-muted-foreground">{PERFIL[usuario.perfil]}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={dz.open} disabled={enviar.isPending}>
                <Camera /> {usuario.foto_url ? "Trocar foto" : "Enviar foto"}
              </Button>
              {usuario.foto_url && (
                <Button variant="ghost" className="text-danger-ink" onClick={() => remover.mutate()} disabled={remover.isPending}>
                  <Trash2 /> Remover
                </Button>
              )}
            </div>
          </div>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">PNG, JPG ou WEBP até 4 MB. A foto é recortada em círculo automaticamente.</p>
        </div>

        <div className="card-surface grid gap-4 p-5 sm:grid-cols-3">
          <Field label="Nome">
            <Input value={usuario.nome} readOnly className="bg-muted/50 text-muted-foreground" />
          </Field>
          <Field label="E-mail" dica="Alterado por um administrador.">
            <Input value={usuario.email} readOnly className="bg-muted/50 text-muted-foreground" />
          </Field>
          <Field label="Usuário (login)" dica="Alterado por um administrador.">
            <div className="flex h-8 items-center rounded-lg border bg-muted/50 px-2.5 text-sm">
              {usuario.login ? <Mono>{usuario.login}</Mono> : <span className="text-muted-foreground">—</span>}
            </div>
          </Field>
        </div>

        <TrocarSenha />
      </div>
    </div>
  );
}
