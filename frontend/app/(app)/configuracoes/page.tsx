"use client";

import { Settings } from "lucide-react";

import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { NAV } from "@/components/mayacorp/nav";
import { useAuth } from "@/lib/auth";

/** O layout redireciona para a primeira aba liberada; sem nenhuma, avisa. */
export default function ConfiguracoesPage() {
  const { pode } = useAuth();
  const algum = NAV.find((g) => g.titulo === "Configurações")!.itens.some(
    (i) => i.href.startsWith("/configuracoes") && !i.equipe && (!i.permissao || pode(i.permissao)),
  );
  return algum ? <Settings className="mx-auto mt-10 size-6 animate-pulse text-muted-foreground" /> : <SemAcesso />;
}
