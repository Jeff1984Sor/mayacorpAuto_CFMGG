"use client";

import { useEffect, useState } from "react";

import { baixarBlob } from "@/lib/api";

// cache por URL (a URL já carrega ?v=... e muda quando a foto muda)
const cache = new Map<string, Promise<string | null>>();

function carregar(url: string) {
  let p = cache.get(url);
  if (!p) {
    const caminho = url.startsWith("/api/") ? url.slice(4) : url;
    p = baixarBlob(caminho)
      .then(({ blob }) => URL.createObjectURL(blob))
      .catch(() => {
        cache.delete(url);
        return null;
      });
    cache.set(url, p);
  }
  return p;
}

/** Foto protegida por Bearer → objectURL (ou null enquanto carrega / sem foto). */
export function useFoto(url: string | null | undefined) {
  const [src, setSrc] = useState<{ url: string; src: string | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    void carregar(url).then((s) => vivo && setSrc({ url, src: s }));
    return () => {
      vivo = false;
    };
  }, [url]);
  return url && src?.url === url ? src.src : null;
}
