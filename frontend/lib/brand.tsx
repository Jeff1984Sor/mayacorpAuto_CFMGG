"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { API_URL, api } from "./api";
import type { IdentidadePublica } from "./types";

const PADRAO: IdentidadePublica = { nome_exibicao: "CFME Advogados", logo_url: null, cor_destaque: null };

interface BrandCtx extends IdentidadePublica {
  logoSrc: string | null;
  /** Cor aplicada (pode ser uma pré-visualização ao vivo). */
  preview: (cor: string | null | undefined) => void;
}

const Ctx = createContext<BrandCtx>({ ...PADRAO, logoSrc: null, preview: () => {} });

function contraste(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#0f1729" : "#ffffff";
}

export function aplicarCor(cor: string | null) {
  const root = document.documentElement;
  if (cor && /^#[0-9a-f]{6}$/i.test(cor)) {
    root.style.setProperty("--brand", cor);
    root.style.setProperty("--brand-foreground", contraste(cor));
  } else {
    root.style.removeProperty("--brand");
    root.style.removeProperty("--brand-foreground");
  }
}

export function resolverLogo(url: string | null | undefined) {
  if (!url) return null;
  if (/^https?:/.test(url)) return url;
  // a API devolve caminhos relativos a ela (ex.: /public/logo?v=...)
  return `${API_URL}${url.startsWith("/api/") ? url.slice(4) : url}`;
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: ["identidade-publica"],
    queryFn: () => api.get<IdentidadePublica>("/public/identidade"),
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const [previewCor, setPreviewCor] = useState<string | null | undefined>(undefined);
  const ident = data ?? PADRAO;
  const cor = previewCor !== undefined ? previewCor : ident.cor_destaque;

  useEffect(() => {
    aplicarCor(cor);
  }, [cor]);

  useEffect(() => {
    const publica = /^\/(login|redefinir-senha|primeiro-acesso)/.test(window.location.pathname);
    document.title = publica ? "MayaJus · Gestão jurídica" : `${ident.nome_exibicao} · MayaJus`;
  }, [ident.nome_exibicao]);

  return (
    <Ctx.Provider value={{ ...ident, cor_destaque: cor, logoSrc: resolverLogo(ident.logo_url), preview: setPreviewCor }}>
      {children}
    </Ctx.Provider>
  );
}

export const useBrand = () => useContext(Ctx);
