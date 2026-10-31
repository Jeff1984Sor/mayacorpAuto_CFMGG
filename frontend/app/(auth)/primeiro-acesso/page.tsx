"use client";

import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, tokens } from "@/lib/api";
import type { TokenOut } from "@/lib/types";

/** Boas-vindas de um escritório novo: o próprio cliente cria o usuário master e já entra. */
export default function PrimeiroAcessoPage() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{
    escritorio: string;
    email: string;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({
    nome: "",
    email: "",
    login: "",
    senha: "",
    confirma: "",
  });
  const [salvando, setSalvando] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- lê o link uma vez */
  useEffect(() => {
    const tk = new URLSearchParams(window.location.search).get("token");
    setToken(tk);
    if (!tk) {
      setErro("Link inválido. Peça um novo à MayaCorp.");
      return;
    }
    api
      .get<{ escritorio: string; email: string }>(`/auth/primeiro-acesso`, {
        token: tk,
      })
      .then((r) => {
        setInfo(r);
        setF((o) => ({ ...o, email: r.email ?? "" }));
      })
      .catch((e: Error) => setErro(e.message));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.senha !== f.confirma) return toast.error("As senhas não conferem.");
    setSalvando(true);
    try {
      const t = await api.post<TokenOut>(
        "/auth/primeiro-acesso",
        {
          token,
          nome: f.nome,
          email: f.email,
          login: f.login || null,
          senha: f.senha,
        },
        { auth: false },
      );
      tokens.set(t);
      window.location.replace("/"); // recarrega inteiro: o login novo entra com o escritório certo
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
      setSalvando(false);
    }
  };

  if (erro)
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-warning/10">
          <AlertTriangle className="size-7 text-warning-ink" />
        </div>
        <h1 className="text-xl font-semibold">
          Não foi possível abrir o primeiro acesso
        </h1>
        <p className="text-sm text-muted-foreground">{erro}</p>
        <Button className="h-11 w-full" render={<Link href="/login" />}>
          Ir para o login
        </Button>
      </div>
    );

  if (!info)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <form onSubmit={enviar} className="space-y-4">
      <div>
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand/12 text-navy dark:text-brand">
          <Sparkles className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bem-vindo ao MayaJus
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie o usuário master do <b>{info.escritorio}</b>. Ele administra o
          escritório: equipe, empresa emissora e certificado.
        </p>
      </div>
      <Field label="Seu nome" obrigatorio htmlFor="pa-nome">
        <Input
          id="pa-nome"
          value={f.nome}
          onChange={(e) => setF({ ...f, nome: e.target.value })}
          className="h-11"
          required
          minLength={3}
          autoFocus
        />
      </Field>
      <Field label="E-mail" obrigatorio htmlFor="pa-email">
        <Input
          id="pa-email"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          className="h-11"
          required
        />
      </Field>
      <Field
        label="Login (opcional)"
        htmlFor="pa-login"
        dica="Para entrar sem digitar o e-mail. Ex.: ana.silva"
      >
        <Input
          id="pa-login"
          value={f.login}
          onChange={(e) => setF({ ...f, login: e.target.value.toLowerCase() })}
          className="h-11"
          autoComplete="username"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Senha"
          obrigatorio
          htmlFor="pa-senha"
          dica="8+ caracteres, letras e números."
        >
          <Input
            id="pa-senha"
            type="password"
            value={f.senha}
            onChange={(e) => setF({ ...f, senha: e.target.value })}
            className="h-11"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>
        <Field
          label="Confirme a senha"
          obrigatorio
          htmlFor="pa-conf"
          erro={
            f.confirma && f.confirma !== f.senha
              ? "As senhas não conferem"
              : undefined
          }
        >
          <Input
            id="pa-conf"
            type="password"
            value={f.confirma}
            onChange={(e) => setF({ ...f, confirma: e.target.value })}
            className="h-11"
            required
            autoComplete="new-password"
          />
        </Field>
      </div>
      <Button type="submit" disabled={salvando} className="h-11 w-full">
        {salvando && <Loader2 className="animate-spin" />}
        Criar usuário e entrar
      </Button>
    </form>
  );
}
