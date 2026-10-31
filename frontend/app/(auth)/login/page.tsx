"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  UserRound,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { MayaJusLogo } from "@/components/mayacorp/brand";
import { Field } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  email: z.string().trim().min(1, "Informe seu e-mail ou usuário"),
  senha: z.string().min(1, "Informe a senha"),
});

function ComIcone({
  icone: I,
  children,
}: {
  icone: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <I className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}

function Login({
  onEsqueci,
  onPrimeiro,
}: {
  onEsqueci: () => void;
  onPrimeiro: () => void;
}) {
  const { login } = useAuth();
  const router = useRouter();
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", senha: "" },
  });

  const enviar = form.handleSubmit(async (v) => {
    setErro(null);
    try {
      const u = await login(v.email, v.senha);
      toast.success(`Bem-vindo(a), ${u.nome.split(" ")[0]}!`);
      const volta = new URLSearchParams(window.location.search).get("volta");
      router.replace(
        volta && volta.startsWith("/") && !volta.startsWith("//") ? volta : "/",
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível entrar.");
    }
  });

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Field
        label="E-mail ou usuário"
        erro={form.formState.errors.email?.message}
      >
        <ComIcone icone={UserRound}>
          <Input
            {...form.register("email")}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="voce@cfme.com.br ou seu.usuario"
            className="h-11 pl-9"
            autoFocus
          />
        </ComIcone>
      </Field>
      <Field label="Senha" erro={form.formState.errors.senha?.message}>
        <ComIcone icone={Lock}>
          <Input
            {...form.register("senha")}
            type={ver ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className="h-11 pr-10 pl-9"
          />
          <button
            type="button"
            onClick={() => setVer((x) => !x)}
            className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label={ver ? "Ocultar senha" : "Mostrar senha"}
          >
            {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </ComIcone>
      </Field>
      <AnimatePresence>
        {erro && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-lg border border-danger/25 bg-danger/8 px-3 py-2 text-sm text-danger"
          >
            {erro}
          </motion.p>
        )}
      </AnimatePresence>
      <div className="flex justify-between">
        <button
          type="button"
          onClick={onPrimeiro}
          className="text-sm font-medium text-navy hover:underline dark:text-brand"
        >
          1º acesso
        </button>
        <button
          type="button"
          onClick={onEsqueci}
          className="text-sm font-medium text-navy hover:underline dark:text-brand"
        >
          Esqueci minha senha
        </button>
      </div>
      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="group h-11 w-full brand-gradient text-white shadow-lg shadow-brand/25 hover:opacity-95"
      >
        {form.formState.isSubmitting ? (
          <Loader2 className="animate-spin" />
        ) : null}
        Entrar
        <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
      </Button>
    </form>
  );
}

/** "Esqueci minha senha" ou "1º acesso" (o e-mail do financeiro do escritório recebe o link para criar a senha). */
function Esqueci({
  onVoltar,
  primeiro,
}: {
  onVoltar: () => void;
  primeiro?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    try {
      await api.post(
        primeiro ? "/auth/primeiro-acesso/pedir" : "/auth/forgot",
        { email },
        { auth: false },
      );
      setEnviado(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setCarregando(false);
    }
  };
  if (enviado)
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/10">
          <MailCheck className="size-7 text-success" />
        </div>
        <p className="text-sm text-muted-foreground">
          {primeiro ? (
            <>
              Se <strong className="text-foreground">{email}</strong> for o
              e-mail do financeiro de um escritório que ainda não criou o
              acesso, você receberá o link para criar o seu usuário e a sua
              senha. Confira também o spam.
            </>
          ) : (
            <>
              Se <strong className="text-foreground">{email}</strong> estiver
              cadastrado, você receberá um link para criar uma nova senha.
            </>
          )}
        </p>
        <Button variant="outline" className="w-full" onClick={onVoltar}>
          <ArrowLeft /> Voltar ao login
        </Button>
      </div>
    );
  return (
    <form onSubmit={enviar} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {primeiro
          ? "Primeira vez no MayaJus? Informe o e-mail do financeiro do escritório (o do cadastro) e enviaremos o link para criar o seu usuário e a sua senha."
          : "Informe seu e-mail e enviaremos um link para redefinir a senha."}
      </p>
      <ComIcone icone={Mail}>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          placeholder="voce@escritorio.com.br"
          className="h-11 pl-9"
          autoFocus
        />
      </ComIcone>
      <Button type="submit" disabled={carregando} className="h-11 w-full">
        {carregando && <Loader2 className="animate-spin" />}
        Enviar link
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={onVoltar}
      >
        <ArrowLeft /> Voltar
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const [modo, setModo] = useState<"login" | "esqueci" | "primeiro">("login");
  return (
    <div>
      <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <MayaJusLogo className="mb-8 lg:hidden" />
        <h1 className="text-2xl font-semibold tracking-tight">
          {modo === "login"
            ? "Entrar"
            : modo === "primeiro"
              ? "1º acesso"
              : "Recuperar acesso"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modo === "login"
            ? "Acesse o MayaJus com seu e-mail ou usuário."
            : modo === "primeiro"
              ? "Crie o seu acesso ao MayaJus."
              : "Vamos te ajudar a voltar."}
        </p>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={modo}
          initial={{ opacity: 0, x: modo === "login" ? -12 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: modo === "login" ? 12 : -12 }}
          transition={{ duration: 0.18 }}
        >
          {modo === "login" ? (
            <Login
              onEsqueci={() => setModo("esqueci")}
              onPrimeiro={() => setModo("primeiro")}
            />
          ) : (
            <Esqueci
              onVoltar={() => setModo("login")}
              primeiro={modo === "primeiro"}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
