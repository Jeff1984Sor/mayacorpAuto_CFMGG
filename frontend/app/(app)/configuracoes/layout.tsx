"use client";

import { Eye, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { NAV } from "@/components/mayacorp/nav";
import { PageHeader } from "@/components/mayacorp/page-header";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ABAS = NAV.find((g) => g.titulo === "Configurações")!.itens.filter((i) => i.href.startsWith("/configuracoes"));
// telas que tratam a edição item a item (listas com filtros e diálogos); nas demais o formulário inteiro fica só leitura
const EDICAO_PROPRIA = ["/configuracoes/usuarios", "/configuracoes/perfis", "/configuracoes/faturamento", "/configuracoes/ia", "/configuracoes/tribunais"];

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  const { pode, usuario } = useAuth();
  const abas = ABAS.filter((a) => (!a.permissao || pode(a.permissao)) && (!a.equipe || usuario?.equipe_mayacorp));
  const pathname = usePathname();
  const router = useRouter();
  // /configuracoes vai para a primeira aba que o perfil enxerga
  const primeira = abas[0]?.href;
  useEffect(() => {
    if (pathname === "/configuracoes" && primeira) router.replace(primeira);
  }, [pathname, primeira, router]);
  const atual = abas.find((a) => pathname.startsWith(a.href));
  const soLeitura =
    !!atual?.permissao && !EDICAO_PROPRIA.includes(atual.href) && !pode(atual.permissao.replace(/\.ver$/, ".editar"));
  // sem nenhuma aba, o bloqueio da página (AppShell) já mostra "Sem acesso"
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
      {soLeitura ? (
        <>
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-info/30 bg-info/8 px-3.5 py-2.5 text-sm text-info-ink">
            <Eye className="size-4 shrink-0" />
            Seu perfil de acesso permite consultar esta configuração, mas não alterá-la.
          </p>
          <fieldset disabled className="min-w-0">
            {children}
          </fieldset>
        </>
      ) : (
        children
      )}
    </div>
  );
}
