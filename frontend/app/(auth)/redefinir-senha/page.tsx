"use client";

import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function forca(s: string) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[A-Z]/.test(s) && /[a-z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^A-Za-z0-9]/.test(s)) p++;
  return Math.min(4, p);
}

export default function RedefinirSenhaPage() {
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [ok, setOk] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const f = forca(senha);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha !== confirma) return toast.error("As senhas não conferem.");
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return toast.error("Link inválido. Peça um novo e-mail.");
    setCarregando(true);
    try {
      await api.post("/auth/reset", { token, senha }, { auth: false });
      setOk(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setCarregando(false);
    }
  };

  if (ok)
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/10">
          <CheckCircle2 className="size-7 text-success" />
        </div>
        <h1 className="text-2xl font-semibold">Senha definida!</h1>
        <p className="text-sm text-muted-foreground">Agora é só entrar com o seu e-mail e a nova senha.</p>
        <Button className="h-11 w-full" render={<Link href="/login" />}>
          Ir para o login
        </Button>
      </div>
    );

  return (
    <form onSubmit={enviar} className="space-y-5">
      <div>
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand/12 text-navy dark:text-brand">
          <KeyRound className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Defina sua senha</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use pelo menos 8 caracteres, com letras e números.</p>
      </div>
      <Field label="Nova senha">
        <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="h-11" required minLength={8} autoFocus />
        <div className="mt-1 grid grid-cols-4 gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1 rounded-full bg-muted transition-colors",
                i < f && (f <= 1 ? "bg-danger" : f === 2 ? "bg-warning" : "bg-success"),
              )}
            />
          ))}
        </div>
      </Field>
      <Field label="Confirme a senha" erro={confirma && confirma !== senha ? "As senhas não conferem" : undefined}>
        <Input type="password" value={confirma} onChange={(e) => setConfirma(e.target.value)} className="h-11" required />
      </Field>
      <Button type="submit" disabled={carregando} className="h-11 w-full">
        {carregando && <Loader2 className="animate-spin" />}
        Salvar senha
      </Button>
    </form>
  );
}
