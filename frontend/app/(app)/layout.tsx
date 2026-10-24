"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { ClientLogo } from "@/components/mayacorp/brand";
import { AppShell } from "@/components/mayacorp/shell";
import { useMontado } from "@/hooks/use-montado";
import { useAuth, useTemToken } from "@/lib/auth";

function TelaCarregando() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-xl bg-brand/30" />
          <ClientLogo compacto className="relative size-12" />
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full animate-shimmer bg-linear-to-r from-transparent via-brand to-transparent bg-size-[200%_100%]" />
        </div>
      </div>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const montado = useMontado();
  const temToken = useTemToken();
  const { logado, carregando } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (montado && !temToken) router.replace(`/login?volta=${encodeURIComponent(pathname)}`);
  }, [montado, temToken, router, pathname]);

  if (!montado || !logado || carregando) return <TelaCarregando />;
  return <AppShell>{children}</AppShell>;
}
