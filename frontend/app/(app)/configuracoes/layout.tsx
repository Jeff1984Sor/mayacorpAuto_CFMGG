"use client";

import { Settings, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { EmptyState } from "@/components/mayacorp/empty-state";
import { NAV } from "@/components/mayacorp/nav";
import { PageHeader } from "@/components/mayacorp/page-header";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ABAS = NAV.find((g) => g.titulo === "Configurações")!.itens.filter((i) => i.href.startsWith("/configuracoes"));

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, usuario } = useAuth();
  const abas = ABAS.filter((a) => !a.equipe || usuario?.equipe_mayacorp);
  const pathname = usePathname();
  if (!isAdmin)
    return <EmptyState icone={ShieldAlert} titulo="Somente administradores" descricao="Peça a um administrador para alterar as configurações." />;
  return (
    <div>
      <PageHeader
        titulo="Configurações"
        descricao="Identidade, certificado, profissionais, faturamento, parâmetros fiscais e notificações."
        icone={Settings}
        migalhas={[{ label: "Início", href: "/" }, { label: "Configurações" }]}
      />
      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b px-1">
        {abas.map((a) => {
          const on = pathname.startsWith(a.href);
          return (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                "relative flex shrink-0 items-center gap-2 px-3 pt-1 pb-3 text-sm font-medium transition-colors",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <a.icone className={cn("size-4", on && "text-info-ink")} />
              {a.label}
              {on && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand" />}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
