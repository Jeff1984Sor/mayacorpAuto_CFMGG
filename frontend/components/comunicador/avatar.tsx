"use client";

import { Bot, Users } from "lucide-react";

import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { COR_STATUS, type Conversa, ROTULO_STATUS, type StatusPresenca, type UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

export function BolinhaPresenca({ status, className }: { status: StatusPresenca; className?: string }) {
  return (
    <span
      className={cn("absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-card", COR_STATUS[status], className)}
      title={ROTULO_STATUS[status]}
      aria-label={ROTULO_STATUS[status]}
    />
  );
}

/** Avatar de uma conversa: pessoa (com presença), grupo ou o robô. */
export function AvatarConversa({
  conversa,
  usuarios,
  online,
  tamanho = "size-10",
}: {
  conversa: Conversa;
  usuarios: Map<number, UsuarioChat>;
  online: Record<number, StatusPresenca>;
  tamanho?: string;
}) {
  if (conversa.tipo === "robo")
    return (
      <span className={cn("relative grid shrink-0 place-items-center rounded-2xl brand-gradient text-white shadow-md shadow-brand/30", tamanho)}>
        <Bot className="size-1/2" />
      </span>
    );
  if (conversa.tipo === "grupo")
    return (
      <span className={cn("relative grid shrink-0 place-items-center rounded-full bg-brand/12 text-info-ink ring-1 ring-brand/25", tamanho)}>
        <Users className="size-1/2" />
      </span>
    );
  const u = conversa.outro_id != null ? usuarios.get(conversa.outro_id) : undefined;
  const status = (conversa.outro_id != null && online[conversa.outro_id]) || u?.status || "offline";
  return (
    <span className={cn("relative shrink-0", tamanho)}>
      <UserAvatar nome={u?.nome ?? conversa.titulo} fotoUrl={u?.foto_url} className={tamanho} textoClassName="text-xs" />
      <BolinhaPresenca status={status} />
    </span>
  );
}
