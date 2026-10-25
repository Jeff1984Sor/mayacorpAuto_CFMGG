"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Play, SendHorizonal, Sparkles, X } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface Acao {
  tipo: string;
  rotulo: string;
  parametros: Record<string, unknown>;
}
interface Msg {
  papel: "usuario" | "assistente";
  texto: string;
  acoes?: (Acao & { estado?: "feita" | "ignorada" | "erro"; resultado?: string })[];
}

const SUGESTOES = ["O que precisa da minha atenção aqui?", "Resuma em 3 pontos", "Quais os próximos passos?"];

/** Conversa com o assistente sobre a tela atual; ações propostas só rodam com "Executar". */
export function AssistenteChat({ tela, titulo, conteudo }: { tela: string; titulo: string; conteudo: () => string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const enviar = useMutation({
    mutationFn: (historico: Msg[]) =>
      api.post<{ resposta: string; acoes: Acao[] }>("/ia/assistente/conversa", {
        tela,
        titulo,
        conteudo: conteudo(),
        mensagens: historico.map((m) => ({ papel: m.papel, texto: m.texto })),
      }),
    onSuccess: (r) => setMsgs((m) => [...m, { papel: "assistente", texto: r.resposta, acoes: r.acoes }]),
    onError: () => setMsgs((m) => m.slice(0, -1)),
  });
  const executar = useMutation({
    mutationFn: ({ acao }: { acao: Acao; mi: number; ai: number }) =>
      api.post<{ mensagem: string; navegar?: string }>("/ia/assistente/executar", { tipo: acao.tipo, parametros: acao.parametros }),
    onSuccess: (r, { mi, ai }) => {
      marcar(mi, ai, "feita", r.mensagem);
      toast.success(r.mensagem);
      qc.invalidateQueries();
      if (r.navegar && r.navegar !== tela) router.push(r.navegar);
    },
    onError: (e: Error, { mi, ai }) => marcar(mi, ai, "erro", e.message),
  });
  const marcar = (mi: number, ai: number, estado: "feita" | "ignorada" | "erro", resultado?: string) =>
    setMsgs((m) => m.map((x, i) => (i !== mi ? x : { ...x, acoes: x.acoes?.map((a, j) => (j === ai ? { ...a, estado, resultado } : a)) })));

  const mandar = (t: string) => {
    const v = t.trim();
    if (!v || enviar.isPending) return;
    const historico: Msg[] = [...msgs, { papel: "usuario", texto: v }];
    setMsgs(historico);
    setTexto("");
    enviar.mutate(historico);
  };

  return (
    <div className="mt-auto border-t bg-muted/20" data-ia-ignorar>
      <div className="space-y-3 px-5 pt-4">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <Sparkles className="size-3.5 text-info-ink" /> Converse com o assistente
        </p>
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5">
            {SUGESTOES.map((s) => (
              <button key={s} type="button" onClick={() => mandar(s)} className="rounded-full border bg-background px-2.5 py-1 text-xs transition hover:border-brand hover:text-info-ink">
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, mi) => (
          <motion.div key={mi} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", m.papel === "usuario" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[88%] space-y-2", m.papel === "usuario" && "text-right")}>
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                  m.papel === "usuario" ? "rounded-br-sm bg-navy text-white dark:bg-brand dark:text-navy" : "rounded-bl-sm border bg-card",
                )}
              >
                {m.texto}
              </div>
              {m.acoes?.map((a, ai) => (
                <div key={ai} className={cn("rounded-xl border p-2.5 text-left text-sm", a.estado === "feita" ? "border-success/30 bg-success/6" : a.estado === "erro" ? "border-danger/30 bg-danger/6" : "border-brand/30 bg-brand/6")}>
                  <p className="font-medium">{a.rotulo}</p>
                  {a.resultado && <p className={cn("mt-0.5 text-xs", a.estado === "erro" ? "text-danger-ink" : "text-success-ink")}>{a.resultado}</p>}
                  {!a.estado || a.estado === "erro" ? (
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="xs"
                        disabled={!isOperador && a.tipo !== "navegar"}
                        title={!isOperador && a.tipo !== "navegar" ? "Seu perfil só consulta" : undefined}
                        onClick={() => executar.mutate({ acao: a, mi, ai })}
                      >
                        {executar.isPending && executar.variables?.mi === mi && executar.variables?.ai === ai ? <Loader2 className="animate-spin" /> : <Play />}
                        {a.tipo === "navegar" ? "Abrir" : "Executar"}
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => marcar(mi, ai, "ignorada")}>
                        <X /> Ignorar
                      </Button>
                    </div>
                  ) : a.estado === "feita" ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-success-ink">
                      <Check className="size-3.5" /> Feito
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Ignorada</p>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        ))}
        {enviar.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Pensando…
          </div>
        )}
        <div ref={fim} />
      </div>
      <form
        className="sticky bottom-0 mt-3 flex items-end gap-2 border-t bg-background/95 p-3 backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          mandar(texto);
        }}
      >
        <textarea
          aria-label="Mensagem para o assistente"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              mandar(texto);
            }
          }}
          rows={2}
          placeholder="Pergunte ou peça algo… ex.: “lança 2h de reunião no caso 15”"
          className="min-h-10 flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        />
        <Button type="submit" size="icon" disabled={!texto.trim() || enviar.isPending} aria-label="Enviar">
          <SendHorizonal />
        </Button>
      </form>
    </div>
  );
}
