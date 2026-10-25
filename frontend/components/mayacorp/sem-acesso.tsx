"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

import { EmptyState } from "./empty-state";

/** Tela mostrada no lugar da página quando o perfil de acesso não libera o endereço. */
export function SemAcesso({ titulo = "Sem acesso" }: { titulo?: string }) {
  const { usuario } = useAuth();
  return (
    <EmptyState
      icone={ShieldOff}
      titulo={titulo}
      descricao={
        <>
          Peça ao administrador para liberar no seu perfil de acesso
          {usuario?.perfil_acesso_nome && (
            <>
              {" "}
              (<strong className="font-medium text-foreground">{usuario.perfil_acesso_nome}</strong>)
            </>
          )}
          .
        </>
      }
      acao={<Button variant="outline" render={<Link href="/" />}>Voltar ao início</Button>}
      className="py-20"
    />
  );
}
