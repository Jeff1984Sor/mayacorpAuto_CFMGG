"use client";

import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Moon, Sun, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Command } from "@/components/ui/command";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { documento, moeda } from "@/lib/format";
import type { NfseOut, Pagina, TomadorOut } from "@/lib/types";

import { navPara } from "./nav";

const EVENTO = "maya:paleta";
export const abrirPaleta = () => window.dispatchEvent(new Event(EVENTO));

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 250);
  const router = useRouter();
  const { usuario, pode } = useAuth();
  const { setTheme, resolvedTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        const campo = document.querySelector<HTMLInputElement>("input[data-busca]");
        if (campo) {
          e.preventDefault();
          campo.focus();
        }
      }
    };
    const onAbrir = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(EVENTO, onAbrir);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(EVENTO, onAbrir);
    };
  }, []);

  const ativo = open && busca.trim().length >= 2;
  const notas = useQuery({
    queryKey: ["paleta-notas", busca],
    queryFn: () => api.get<Pagina<NfseOut>>("/nfse/notas", { q: busca, por_pagina: 5 }),
    enabled: ativo && pode("nfse_notas.ver"),
    meta: { silencioso: true },
  });
  const clientes = useQuery({
    queryKey: ["paleta-clientes", busca],
    queryFn: () => api.get<Pagina<TomadorOut>>("/nfse/tomadores", { q: busca, por_pagina: 5 }),
    enabled: ativo && pode("clientes.ver"),
    meta: { silencioso: true },
  });

  const ir = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Busca rápida" description="Navegue ou busque notas e clientes">
      <Command shouldFilter={!ativo}>
        <CommandInput placeholder="Digite para buscar ou navegar…" value={q} onValueChange={setQ} />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          {ativo && (notas.data?.itens.length ?? 0) > 0 && (
            <CommandGroup heading="Notas fiscais">
              {notas.data!.itens.map((n) => (
                <CommandItem key={n.id} value={`nota-${n.id}`} onSelect={() => ir(`/nfse/notas/${n.id}`)}>
                  <FileCheck2 />
                  <span className="num">Nº {n.numero}</span>
                  <span className="truncate text-muted-foreground">{n.tomador_nome}</span>
                  <CommandShortcut className="num">{moeda(n.valor)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {ativo && (clientes.data?.itens.length ?? 0) > 0 && (
            <CommandGroup heading="Clientes">
              {clientes.data!.itens.map((c) => (
                <CommandItem key={c.id} value={`cli-${c.id}`} onSelect={() => ir(`/cadastros/clientes?id=${c.id}`)}>
                  <UsersRound />
                  <span className="truncate">{c.nome}</span>
                  <CommandShortcut className="num">{documento(c.cpf_cnpj)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!ativo &&
            navPara(usuario && pode, usuario?.equipe_mayacorp).map((g) => (
              <CommandGroup key={g.titulo} heading={g.titulo}>
                {g.itens
                  .filter((i) => !i.emBreve)
                  .map((i) => (
                    <CommandItem key={i.href} value={`${g.titulo} ${i.label}`} onSelect={() => ir(i.href)}>
                      <i.icone />
                      {i.label}
                      {i.atalho && <CommandShortcut>{i.atalho}</CommandShortcut>}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          {!ativo && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Preferências">
                <CommandItem
                  value="alternar tema escuro claro"
                  onSelect={() => {
                    setTheme(resolvedTheme === "dark" ? "light" : "dark");
                    setOpen(false);
                  }}
                >
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />}
                  Alternar tema claro/escuro
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
