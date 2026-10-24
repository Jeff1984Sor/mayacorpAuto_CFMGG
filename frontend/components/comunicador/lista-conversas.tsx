"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquarePlus, Pin, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Conversa, horaLista, type Msg, textoSimples, type UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

import { AvatarConversa } from "./avatar";
import { useComunicador } from "./provider";

function previa(c: Conversa, eu: number | undefined) {
  const m = c.ultima;
  if (!m) return c.tipo === "robo" ? "Avisos automáticos dos robôs" : "Sem mensagens ainda";
  if (m.apagada) return "Mensagem apagada";
  const quem = m.autor_id === eu ? "Você: " : c.tipo === "grupo" ? `${m.autor_nome.split(" ")[0]}: ` : "";
  return quem + textoSimples(m.texto).replace(/\s+/g, " ");
}

export function ListaConversas({
  conversas,
  carregando,
  usuarios,
  selecionada,
  onAbrir,
  onAbrirMsg,
  onNovoGrupo,
  onNovaDireta,
  acoesExtra,
  compacto,
}: {
  conversas: Conversa[];
  carregando: boolean;
  usuarios: Map<number, UsuarioChat>;
  selecionada: number | null;
  onAbrir: (c: Conversa) => void;
  onAbrirMsg: (m: Msg) => void;
  onNovoGrupo: () => void;
  onNovaDireta: () => void;
  acoesExtra?: React.ReactNode;
  compacto?: boolean;
}) {
  const { usuario } = useAuth();
  const { online, digitando } = useComunicador();
  const [q, setQ] = useState("");
  const termo = q.trim().toLowerCase();
  const busca = useDebounce(termo, 300);

  const resultados = useQuery({
    queryKey: ["com", "busca", busca],
    queryFn: () => api.get<Msg[]>("/comunicador/busca", { q: busca }),
    enabled: busca.length >= 3,
    meta: { silencioso: true },
  });

  const ordenadas = useMemo(() => {
    const robo = conversas.filter((c) => c.tipo === "robo");
    const outras = conversas.filter((c) => c.tipo !== "robo" && (!termo || c.titulo.toLowerCase().includes(termo)));
    return [...(termo && !"robô mayacorp".includes(termo) ? [] : robo), ...outras];
  }, [conversas, termo]);
  const tituloDe = (cid: number) => conversas.find((c) => c.id === cid)?.titulo ?? "Conversa";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center justify-between">
          <h2 className={cn("font-semibold tracking-tight", compacto ? "text-base" : "text-lg")}>{compacto ? "Comunicador" : "Conversas"}</h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onNovaDireta}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Nova conversa"
              title="Nova conversa"
            >
              <MessageSquarePlus className="size-4" />
            </button>
            <button
              type="button"
              onClick={onNovoGrupo}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 text-xs font-medium text-info-ink transition hover:bg-brand/18"
            >
              <Users className="size-3.5" /> {compacto ? "Grupo" : "Novo grupo"}
            </button>
            {acoesExtra}
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversas e mensagens"
            className="h-9 w-full rounded-lg border bg-background pr-8 pl-8 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
            aria-label="Buscar conversas e mensagens"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" aria-label="Limpar busca">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {carregando ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-44" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="p-1.5" role="listbox" aria-label="Conversas">
            {ordenadas.map((c) => {
              const on = c.id === selecionada;
              const robo = c.tipo === "robo";
              const quemDigita = Object.keys(digitando[c.id] ?? {}).map(Number);
              const nomeDigita = quemDigita.length ? (usuarios.get(quemDigita[0])?.nome.split(" ")[0] ?? "Alguém") : null;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onAbrir(c)}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors",
                      on ? "bg-brand/10 ring-1 ring-brand/30" : "hover:bg-muted",
                      robo && !on && "bg-linear-to-r from-brand/8 to-transparent",
                    )}
                  >
                    <AvatarConversa conversa={c} usuarios={usuarios} online={online} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className={cn("truncate text-sm", c.nao_lidas ? "font-semibold" : "font-medium")}>
                          {robo ? "🤖 Robô MayaCorp" : c.titulo}
                        </span>
                        {robo && <Pin className="size-3 shrink-0 rotate-45 text-info-ink" aria-label="fixada" />}
                        <span className={cn("ml-auto shrink-0 text-[11px]", c.nao_lidas ? "font-semibold text-info-ink" : "text-muted-foreground")}>
                          {horaLista(c.ultima_msg_em)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        {nomeDigita ? (
                          <span className="flex-1 truncate text-xs font-medium text-info-ink">{c.tipo === "grupo" ? `${nomeDigita} está digitando…` : "digitando…"}</span>
                        ) : (
                          <span className={cn("flex-1 truncate text-xs", c.nao_lidas ? "text-foreground" : "text-muted-foreground")}>{previa(c, usuario?.id)}</span>
                        )}
                        {c.nao_lidas > 0 && (
                          <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-foreground tabular-nums">
                            {c.nao_lidas > 99 ? "99+" : c.nao_lidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {busca.length >= 3 && (
          <div className="border-t p-2">
            <p className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Mensagens</p>
            {resultados.isPending ? (
              <Skeleton className="m-2 h-12" />
            ) : !resultados.data?.length ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">Nenhuma mensagem com “{busca}”.</p>
            ) : (
              <ul>
                {resultados.data.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => onAbrirMsg(m)} className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted">
                      <p className="flex items-center gap-2 text-xs">
                        <span className="truncate font-semibold">{tituloDe(m.conversa_id)}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{horaLista(m.criada_em)}</span>
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        <span className="text-foreground">{m.autor_nome.split(" ")[0]}:</span> {textoSimples(m.texto)}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
