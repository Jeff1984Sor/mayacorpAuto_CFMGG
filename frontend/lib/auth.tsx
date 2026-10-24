"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { api, tokens } from "./api";
import type { Perfil, TokenOut, UsuarioMe } from "./types";

interface AuthCtx {
  usuario: UsuarioMe | undefined;
  carregando: boolean;
  logado: boolean;
  login: (email: string, senha: string) => Promise<UsuarioMe>;
  sair: () => void;
  pode: (...perfis: Perfil[]) => boolean;
  isAdmin: boolean;
  isOperador: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const temToken = useSyncExternalStore(
    subscribe,
    () => !!tokens.access,
    () => false,
  );

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<UsuarioMe>("/auth/me"),
    enabled: temToken,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const login = useCallback(
    async (email: string, senha: string) => {
      const t = await api.post<TokenOut>("/auth/login", { email, senha }, { auth: false });
      tokens.set(t);
      window.dispatchEvent(new StorageEvent("storage"));
      qc.setQueryData(["me"], t.usuario);
      return t.usuario;
    },
    [qc],
  );

  const sair = useCallback(() => {
    tokens.clear();
    qc.clear();
    window.dispatchEvent(new StorageEvent("storage"));
    router.replace("/login");
  }, [qc, router]);

  const value = useMemo<AuthCtx>(() => {
    const usuario = me.data;
    const pode = (...perfis: Perfil[]) => !!usuario && perfis.includes(usuario.perfil);
    return {
      usuario,
      carregando: temToken && me.isPending,
      logado: temToken && !!usuario,
      login,
      sair,
      pode,
      isAdmin: pode("admin"),
      isOperador: pode("admin", "operador"),
    };
  }, [me.data, me.isPending, temToken, login, sair]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}

export function useTemToken() {
  return useSyncExternalStore(
    subscribe,
    () => !!tokens.access,
    () => false,
  );
}
