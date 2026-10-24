"use client";

import { Avatar, AvatarBadge, AvatarFallback } from "@/components/ui/avatar";
import { useFoto } from "@/hooks/use-foto";
import { iniciais } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Avatar do usuário: foto (autenticada) ou iniciais em gradiente da marca. */
export function UserAvatar({
  nome,
  fotoUrl,
  className,
  online,
  inativo,
  textoClassName,
}: {
  nome: string;
  fotoUrl?: string | null;
  className?: string;
  online?: boolean;
  inativo?: boolean;
  textoClassName?: string;
}) {
  const src = useFoto(fotoUrl);
  return (
    <Avatar className={className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={nome} className="aspect-square size-full rounded-full object-cover" />
      ) : (
        <AvatarFallback className={cn("font-semibold", inativo ? "bg-muted" : "brand-gradient text-white", textoClassName)}>
          {iniciais(nome)}
        </AvatarFallback>
      )}
      {online && <AvatarBadge className="bg-success" />}
    </Avatar>
  );
}
