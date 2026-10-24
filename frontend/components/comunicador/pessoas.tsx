"use client";

import { Check, CircleDot, MinusCircle, Search, Users, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";

import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { useAuth } from "@/lib/auth";
import { COR_STATUS, ROTULO_STATUS, type StatusPresenca, type UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

import { BolinhaPresenca } from "./avatar";
import { useComunicador } from "./provider";

const ORDEM: StatusPresenca[] = ["online", "ocupado", "ausente", "offline"];

/** Equipe com presença ao vivo + seletor do meu status. Clicar abre a conversa direta. */
export function PainelPessoas({ usuarios, onAbrirDireta, className }: { usuarios: UsuarioChat[]; onAbrirDireta: (u: UsuarioChat) => void; className?: string }) {
  const { usuario } = useAuth();
  const { online, meuStatus, definirStatus, conectado } = useComunicador();
  const [q, setQ] = useState("");

  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase();
    const comStatus = usuarios
      .filter((u) => !t || u.nome.toLowerCase().includes(t))
      .map((u) => ({ ...u, status: (online[u.id] ?? u.status) as StatusPresenca }));
    return ORDEM.map((s) => ({ s, lista: comStatus.filter((u) => u.status === s) })).filter((g) => g.lista.length);
  }, [usuarios, online, q]);

  return (
    <aside className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Equipe">
      <div className="space-y-3 border-b p-3">
        <div className="flex items-center gap-3">
          <span className="relative">
            <UserAvatar nome={usuario?.nome ?? "?"} fotoUrl={usuario?.foto_url} className="size-9" textoClassName="text-xs" />
            <BolinhaPresenca status={conectado ? meuStatus : "offline"} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{usuario?.nome}</p>
            <p className="text-[11px] text-muted-foreground">{conectado ? ROTULO_STATUS[meuStatus] : "Reconectando…"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Meu status">
          {(
            [
              { v: "online", l: "Disponível", i: CircleDot },
              { v: "ocupado", l: "Ocupado", i: MinusCircle },
            ] as const
          ).map((o) => {
            const on = meuStatus === o.v || (o.v === "online" && meuStatus === "ausente");
            return (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => definirStatus(o.v)}
                disabled={!conectado}
                className={cn(
                  "inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition",
                  on && "bg-card text-foreground shadow-sm",
                )}
              >
                <span className={cn("size-2 rounded-full", COR_STATUS[o.v])} />
                {o.l}
                {on && <Check className="size-3" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar pessoa"
            className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
            aria-label="Buscar pessoa"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {usuarios.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Users className="mx-auto mb-2 size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Só você por aqui</p>
            <p className="text-xs text-muted-foreground">Convide a equipe em Configurações › Usuários.</p>
          </div>
        ) : (
          grupos.map((g) => (
            <section key={g.s} className="mb-2">
              <h3 className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {g.s === "offline" ? <WifiOff className="size-3" /> : <span className={cn("size-2 rounded-full", COR_STATUS[g.s])} />}
                {ROTULO_STATUS[g.s]} · {g.lista.length}
              </h3>
              <ul>
                {g.lista.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => onAbrirDireta(u)}
                      className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted", u.status === "offline" && "opacity-60")}
                      title={`Conversar com ${u.nome}`}
                    >
                      <span className="relative">
                        <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-8" textoClassName="text-[10px]" />
                        <BolinhaPresenca status={u.status} className="size-2.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{u.nome}</span>
                        <span className="block truncate text-[11px] text-muted-foreground capitalize">{u.perfil}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
