"use client";

import { AlertTriangle, Eye, Loader2, PencilLine, Plug } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, tokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface Pedido {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
}

interface Aplicativo {
  nome: string;
  destino: string;
  confiavel: boolean;
}

type Escopo = "leitura" | "escrita";

const OPCOES: { id: Escopo; icone: typeof Eye; titulo: string; texto: string }[] = [
  {
    id: "leitura",
    icone: Eye,
    titulo: "Só consultar",
    texto: "O Claude lê os dados e monta relatórios. Não altera nada.",
  },
  {
    id: "escrita",
    icone: PencilLine,
    titulo: "Consultar e alterar",
    texto: "Também cria e altera (tarefas, horas, casos, faturas…), sempre dentro do que o seu perfil permite.",
  },
];

/** Tela de autorização do conector MCP: a pessoa, já logada, libera o Claude para agir como ela. */
export default function ConectarClaudePage() {
  const { usuario } = useAuth();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [app, setApp] = useState<Aplicativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escopo, setEscopo] = useState<Escopo>("leitura");
  const [enviando, setEnviando] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- lê o link uma vez */
  useEffect(() => {
    if (!tokens.access) {
      const volta = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?volta=${volta}`);
      return;
    }
    const q = new URLSearchParams(window.location.search);
    const p: Pedido = {
      client_id: q.get("client_id") ?? "",
      redirect_uri: q.get("redirect_uri") ?? "",
      code_challenge: q.get("code_challenge") ?? "",
      state: q.get("state"),
    };
    if (!p.client_id || !p.redirect_uri || !p.code_challenge) {
      setErro("Este link de conexão está incompleto. Volte ao Claude e conecte de novo.");
      return;
    }
    setPedido(p);
    api<Aplicativo>("/mcp/oauth/cliente", {
      query: { client_id: p.client_id, redirect_uri: p.redirect_uri },
      auth: false,
    })
      .then(setApp)
      .catch((e: Error) => setErro(e.message));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const autorizar = async () => {
    if (!pedido) return;
    setEnviando(true);
    try {
      const r = await api.post<{ redirect: string }>("/mcp/oauth/aprovar", { ...pedido, escopo });
      window.location.href = r.redirect;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível autorizar.");
      setEnviando(false);
    }
  };

  const cancelar = () => {
    if (!pedido) return;
    const u = new URL(pedido.redirect_uri);
    u.searchParams.set("error", "access_denied");
    if (pedido.state) u.searchParams.set("state", pedido.state);
    window.location.href = u.toString();
  };

  const trocarUsuario = () => {
    tokens.clear();
    const volta = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?volta=${volta}`);
  };

  if (erro)
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-warning/10">
          <AlertTriangle className="size-7 text-warning-ink" />
        </div>
        <h1 className="text-xl font-semibold">Não foi possível conectar</h1>
        <p className="text-sm text-muted-foreground">{erro}</p>
      </div>
    );
  if (!app || !usuario)
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand/12 text-navy dark:text-brand">
          <Plug className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Conectar o {app.nome}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O {app.nome} vai acessar o sistema como <b className="text-foreground">{usuario.nome}</b>, com as mesmas
          permissões do seu perfil. Tudo o que ele fizer fica registrado no seu nome.
        </p>
      </div>

      <div className="space-y-2" role="radiogroup" aria-label="O que o Claude pode fazer">
        {OPCOES.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={escopo === o.id}
            onClick={() => setEscopo(o.id)}
            className={cn(
              "flex w-full gap-3 rounded-xl border p-3.5 text-left transition",
              escopo === o.id ? "border-brand bg-brand/8 ring-1 ring-brand" : "hover:bg-muted/50",
            )}
          >
            <o.icone className={cn("mt-0.5 size-4 shrink-0", escopo === o.id ? "text-info-ink" : "text-muted-foreground")} />
            <span>
              <span className="block text-sm font-medium">{o.titulo}</span>
              <span className="block text-sm text-muted-foreground">{o.texto}</span>
            </span>
          </button>
        ))}
      </div>

      {!app.confiavel && (
        <div className="flex gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          <p>
            Depois de autorizar, você será levado para <b>{app.destino}</b>, que não é um endereço do Claude. Só continue
            se foi você quem iniciou esta conexão.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={cancelar} disabled={enviando}>
          Cancelar
        </Button>
        <Button className="flex-1" onClick={autorizar} disabled={enviando}>
          {enviando && <Loader2 className="animate-spin" />} Autorizar
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Você volta para {app.destino}. Para encerrar depois: Minha conta › Claude.{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={trocarUsuario}>
          Não é {usuario.nome.split(" ")[0]}? Entrar com outro usuário
        </button>
      </p>
    </div>
  );
}
