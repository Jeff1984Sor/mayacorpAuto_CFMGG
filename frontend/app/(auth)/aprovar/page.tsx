"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Inbox,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClienteSaaS, PlanoOut } from "@/lib/admin";
import { api } from "@/lib/api";
import { documento, moeda } from "@/lib/format";

interface Sol {
  nome: string;
  documento: string | null;
  responsavel: string;
  email: string;
  telefone: string | null;
  plano: PlanoOut | null;
  ciclo: "mensal" | "anual";
  usuarios: number | null;
  indicacao: string | null;
  mensagem: string | null;
  status: "nova" | "aprovada" | "recusada";
}

/** Aprovar um cadastro do site pelo link do e-mail, sem entrar no sistema (o link identifica o administrador). */
export default function AprovarPage() {
  const [token, setToken] = useState("");
  const [s, setS] = useState<Sol | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [dias, setDias] = useState("15");
  const [fazendo, setFazendo] = useState<"aprovar" | "recusar" | null>(null);
  const [feito, setFeito] = useState<{
    tipo: "aprovada" | "recusada";
    convite?: string;
  } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- lê o link uma vez */
  useEffect(() => {
    const tk = new URLSearchParams(window.location.search).get("token") ?? "";
    setToken(tk);
    api
      .get<Sol>("/public/solicitacao", { token: tk })
      .then(setS)
      .catch((e: Error) => setErro(e.message));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const agir = async (tipo: "aprovar" | "recusar") => {
    setFazendo(tipo);
    try {
      const r = await api.post<ClienteSaaS>(
        `/public/solicitacao/${tipo}`,
        { token, dias_teste: Number(dias) || null },
        { auth: false },
      );
      setFeito({
        tipo: tipo === "aprovar" ? "aprovada" : "recusada",
        convite: r.convite,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setFazendo(null);
    }
  };

  if (erro)
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-warning/10">
          <AlertTriangle className="size-7 text-warning-ink" />
        </div>
        <h1 className="text-xl font-semibold">Não foi possível abrir</h1>
        <p className="text-sm text-muted-foreground">{erro}</p>
      </div>
    );
  if (!s)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  if (feito)
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/10">
          <CheckCircle2 className="size-7 text-success" />
        </div>
        <h1 className="text-xl font-semibold">
          {feito.tipo === "aprovada"
            ? `${s.nome} aprovado`
            : "Solicitação recusada"}
        </h1>
        {feito.tipo === "aprovada" && (
          <>
            <p className="text-sm text-muted-foreground">
              O ambiente foi criado e as boas-vindas foram enviadas para{" "}
              <b>{s.email}</b>.
            </p>
            {feito.convite && (
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(feito.convite!)
                    .then(() => toast.success("Link copiado"))
                }
              >
                <Copy /> Copiar link de boas-vindas (WhatsApp)
              </Button>
            )}
          </>
        )}
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand/12 text-navy dark:text-brand">
          <Inbox className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Novo cadastro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Veio do formulário do site.
        </p>
      </div>
      <div className="space-y-1 rounded-xl border p-4 text-sm">
        <p className="text-base font-semibold">
          {s.nome}{" "}
          {s.documento && (
            <span className="font-mono text-xs text-muted-foreground">
              {documento(s.documento)}
            </span>
          )}
        </p>
        <p>
          {s.responsavel} · {s.email}
        </p>
        <p>{s.telefone}</p>
        <p className="text-muted-foreground">
          {s.plano
            ? `${s.plano.nome} (${s.ciclo}) · ${moeda(s.ciclo === "anual" ? s.plano.preco_anual : s.plano.preco_mensal)}`
            : "Plano a definir"}
          {s.usuarios ? ` · ${s.usuarios} usuário(s)` : ""}
          {s.indicacao ? ` · indicação: ${s.indicacao}` : ""}
        </p>
        {s.mensagem && (
          <p className="mt-2 whitespace-pre-line rounded-lg bg-muted/50 p-2 text-xs">
            {s.mensagem}
          </p>
        )}
      </div>
      {s.status !== "nova" ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          Esta solicitação já foi {s.status}.
        </p>
      ) : (
        <>
          <Field
            label="Dias de teste grátis"
            htmlFor="ap-dias"
            dica="Vazio = já entra como ativo (sem teste)."
          >
            <Input
              id="ap-dias"
              type="number"
              min={1}
              max={90}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className="h-11 max-w-32"
            />
          </Field>
          <div className="flex gap-3">
            <Button
              className="h-11 flex-1"
              disabled={!!fazendo}
              onClick={() => agir("aprovar")}
            >
              {fazendo === "aprovar" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}{" "}
              Aprovar e criar ambiente
            </Button>
            <Button
              variant="outline"
              className="h-11"
              disabled={!!fazendo}
              onClick={() => agir("recusar")}
            >
              {fazendo === "recusar" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <X />
              )}{" "}
              Recusar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
