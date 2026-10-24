"use client";

import {
  ChevronsLeft,
  CircleUserRound,
  KeyRound,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  UserRound,
  ChevronDown,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useComunicador } from "@/components/comunicador/provider";
import { ChatBotao, MencoesBotao } from "@/components/comunicador/topbar";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand";
import { EH_HML } from "@/lib/env";
import type { UsuarioMe } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ClientLogo, MayaCorpAssinatura } from "./brand";
import { CommandPalette, abrirPaleta } from "./command-palette";
import { ModoBadge } from "./modo-badge";
import { TrocarSenhaDialog } from "./trocar-senha-dialog";
import { UserAvatar } from "./user-avatar";
import { ativo, navPara, type NavItem } from "./nav";

const PERFIL_LABEL = { admin: "Administrador", operador: "Operador", visualizador: "Visualizador" } as const;

const nadaAssinar = () => () => {};

// ----- estado "recolhido" guardado no <html> + localStorage (aplicado antes da pintura no layout) -----
const assinarClasse = (cb: () => void) => {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
};
function useRecolhido(): [boolean, () => void] {
  const recolhido = useSyncExternalStore(
    assinarClasse,
    () => document.documentElement.classList.contains("sb-recolhido"),
    () => false,
  );
  const alternar = () => {
    const novo = !document.documentElement.classList.contains("sb-recolhido");
    document.documentElement.classList.toggle("sb-recolhido", novo);
    try {
      localStorage.setItem("sb-recolhido", novo ? "1" : "0");
    } catch {}
  };
  return [recolhido, alternar];
}

export function FaixaAmbiente() {
  if (!EH_HML) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex h-[22px] items-center justify-center bg-[#c62828] px-2 text-[11px] font-bold tracking-wider text-white no-print">
      <span className="truncate">AMBIENTE DE HOMOLOGAÇÃO — notas não têm valor fiscal</span>
    </div>
  );
}

function ItemNav({ item, recolhido, onNavigate }: { item: NavItem; recolhido: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { resumo } = useComunicador();
  const contador = item.badge === "comunicador" ? resumo.nao_lidas : 0;
  const on = ativo(pathname, item);
  const Icone = item.icone;
  const conteudo = (
    <>
      {on && (
        <motion.span
          layoutId="nav-ativo"
          className="absolute inset-0 rounded-lg bg-linear-to-r from-brand/25 to-brand/5 ring-1 ring-brand/30"
          transition={{ type: "spring", stiffness: 500, damping: 38 }}
        />
      )}
      {on && <span className="absolute top-1/2 -left-2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand shadow-[0_0_12px_var(--brand)]" />}
      <Icone
        className={cn(
          "relative size-[18px] shrink-0 transition-colors",
          on ? "text-brand drop-shadow-[0_0_6px_var(--brand)]" : "text-sidebar-foreground/60 group-hover:text-white",
        )}
      />
      {!recolhido && (
        <span className="relative flex-1 truncate">{item.label}</span>
      )}
      {contador > 0 &&
        (recolhido ? (
          <span className="absolute top-1 right-2 size-2 rounded-full bg-brand ring-2 ring-sidebar" aria-label={`${contador} não lidas`} />
        ) : (
          <span className="relative min-w-5 rounded-full bg-brand px-1.5 text-center text-[11px] leading-5 font-semibold text-brand-foreground tabular-nums">
            {contador > 99 ? "99+" : contador}
          </span>
        ))}
      {!recolhido && item.emBreve && (
        <span className="relative rounded-md bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-foreground/70 uppercase">
          em breve
        </span>
      )}
    </>
  );
  const classe = cn(
    "group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors",
    recolhido && "justify-center px-0",
    on ? "text-white" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
    item.emBreve && "cursor-not-allowed opacity-60 hover:bg-transparent",
  );
  const el = item.emBreve ? (
    <span className={classe}>{conteudo}</span>
  ) : (
    <Link href={item.href} className={classe} onClick={onNavigate}>
      {conteudo}
    </Link>
  );
  if (!recolhido) return el;
  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{el}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
        {item.emBreve && " · em breve"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Grupos do menu recolhidos pelo usuário — salvos no servidor (valem no próximo login, em qualquer computador). */
function useGruposRecolhidos() {
  const { usuario } = useAuth();
  const qc = useQueryClient();
  const [local, setLocal] = useState<string[] | null>(null);
  const fechados = new Set(local ?? usuario?.preferencias?.menu_recolhido ?? []);
  const alternar = (titulo: string) => {
    const novo = new Set(fechados);
    if (novo.has(titulo)) novo.delete(titulo);
    else novo.add(titulo);
    const lista = [...novo];
    setLocal(lista);
    api
      .put<UsuarioMe>("/auth/me/preferencias", { menu_recolhido: lista })
      .then((u) => qc.setQueryData(["me"], u))
      .catch(() => {}); // preferência visual: falhar ao salvar não atrapalha o uso
  };
  return { fechados, alternar };
}

function SidebarConteudo({ recolhido, onNavigate, onRecolher }: { recolhido: boolean; onNavigate?: () => void; onRecolher?: () => void }) {
  const { usuario } = useAuth();
  const { nome_exibicao } = useBrand();
  const pathname = usePathname();
  const grupos = navPara(usuario?.perfil);
  const { fechados, alternar } = useGruposRecolhidos();
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
      {/* glow indigo */}
      <div className="pointer-events-none absolute -top-24 -left-24 size-64 rounded-full bg-brand/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-40 w-[140%] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />

      <div
        className={cn(
          "relative flex h-(--tb) shrink-0 items-center gap-2.5 border-b border-sidebar-border px-3.5",
          recolhido && "justify-center px-2",
        )}
      >
        <ClientLogo compacto />
        {!recolhido && (
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-white">{nome_exibicao}</p>
            <p className="text-[11px] text-sidebar-foreground/60">Automações</p>
          </div>
        )}
        {onRecolher && !recolhido && (
          <button
            onClick={onRecolher}
            className="grid size-7 place-items-center rounded-md text-sidebar-foreground/60 transition hover:bg-white/8 hover:text-white"
            aria-label="Recolher menu"
          >
            <ChevronsLeft className="size-4" />
          </button>
        )}
      </div>

      <nav className="relative flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-2 py-4 [scrollbar-width:thin]">
        {grupos.map((g) => {
          const fechado = !recolhido && fechados.has(g.titulo);
          // grupo recolhido ainda mostra a tela em que a pessoa está
          const itens = fechado ? g.itens.filter((i) => ativo(pathname, i)) : g.itens;
          return (
            <div key={g.titulo}>
              {recolhido ? (
                <div className="mx-3 mb-2 h-px bg-white/8 first:hidden" />
              ) : (
                <button
                  type="button"
                  onClick={() => alternar(g.titulo)}
                  aria-expanded={!fechado}
                  className="group/grupo mb-1.5 flex w-full items-center justify-between rounded-md px-2.5 py-0.5 text-[10.5px] font-semibold tracking-[0.12em] text-sidebar-foreground/45 uppercase transition hover:text-sidebar-foreground/80"
                >
                  <span>{g.titulo}</span>
                  <span className="flex items-center gap-1.5">
                    {fechado && (
                      <span className="rounded-full bg-white/8 px-1.5 text-[9px] tracking-normal normal-case">{g.itens.length}</span>
                    )}
                    <ChevronDown
                      className={cn(
                        "size-3.5 opacity-60 transition-transform duration-200 group-hover/grupo:opacity-100",
                        fechado && "-rotate-90",
                      )}
                    />
                  </span>
                </button>
              )}
              <AnimatePresence initial={false}>
                <motion.div
                  key={fechado ? "fechado" : "aberto"}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="space-y-0.5 overflow-hidden"
                >
                  {itens.map((i) => (
                    <ItemNav key={i.label} item={i} recolhido={recolhido} onNavigate={onNavigate} />
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      <div className={cn("relative shrink-0 border-t border-sidebar-border p-3", recolhido && "px-2")}>
        {recolhido ? (
          <button
            onClick={onRecolher}
            className="mx-auto grid size-9 place-items-center rounded-lg text-sidebar-foreground/60 transition hover:bg-white/8 hover:text-white"
            aria-label="Expandir menu"
          >
            <ChevronsLeft className="size-4 rotate-180" />
          </button>
        ) : (
          <MayaCorpAssinatura className="justify-center text-sidebar-foreground/55" />
        )}
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const opcoes = [
    { v: "light", i: Sun, l: "Claro" },
    { v: "dark", i: Moon, l: "Escuro" },
    { v: "system", i: Monitor, l: "Automático" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
      {opcoes.map((o) => (
        <button
          key={o.v}
          onClick={() => setTheme(o.v)}
          className={cn(
            "grid size-7 place-items-center rounded-md text-muted-foreground transition",
            theme === o.v && "bg-card text-foreground shadow-sm",
          )}
          aria-label={o.l}
          title={o.l}
        >
          <o.i className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { usuario, sair } = useAuth();
  const [trocarSenha, setTrocarSenha] = useState(false);
  const router = useRouter();
  const mac = useSyncExternalStore(
    nadaAssinar,
    () => /Mac/.test(navigator.platform),
    () => false,
  );
  return (
    <header className="glass fixed top-(--faixa) right-0 left-0 z-30 flex h-(--tb) items-center gap-2 border-b px-3 transition-[left] duration-200 sm:px-5 lg:left-(--sb) no-print">
      <button
        onClick={onMenu}
        className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="size-5" />
      </button>

      <button
        onClick={abrirPaleta}
        className="group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-background/60 px-3 text-sm text-muted-foreground transition hover:border-brand/40 hover:bg-background"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Buscar notas, clientes, lotes…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>

      <div className="flex-1" />
      <ModoBadge className="hidden sm:inline-flex" />
      <div className="hidden md:block">
        <ThemeToggle />
      </div>
      <ChatBotao />
      <MencoesBotao />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition hover:bg-muted" />
          }
        >
          <UserAvatar nome={usuario?.nome ?? "?"} fotoUrl={usuario?.foto_url} className="size-8 ring-2 ring-brand/30" textoClassName="text-xs" />
          <div className="hidden text-left leading-tight md:block">
            <p className="max-w-36 truncate text-sm font-medium">{usuario?.nome.split(" ")[0]}</p>
            <p className="text-[11px] text-muted-foreground">{usuario && PERFIL_LABEL[usuario.perfil]}</p>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2.5">
              <UserAvatar nome={usuario?.nome ?? "?"} fotoUrl={usuario?.foto_url} className="size-9" textoClassName="text-xs" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{usuario?.nome}</span>
                <span className="block truncate text-xs font-normal">{usuario?.email}</span>
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between px-2 py-1.5 sm:hidden">
            <span className="text-sm">Tema</span>
            <ThemeToggle />
          </div>
          <div className="px-2 py-1.5 sm:hidden">
            <ModoBadge />
          </div>
          <DropdownMenuItem disabled>
            <UserRound /> {usuario && PERFIL_LABEL[usuario.perfil]}
            {usuario?.login && <span className="ml-auto font-mono text-[11px]">@{usuario.login}</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/minha-conta")}>
            <CircleUserRound /> Minha conta
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTrocarSenha(true)}>
            <KeyRound /> Trocar senha
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={sair} variant="destructive">
            <LogOut /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TrocarSenhaDialog open={trocarSenha} onOpenChange={setTrocarSenha} />
    </header>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [recolhido, alternar] = useRecolhido();
  const [gaveta, setGaveta] = useState(false);
  const pathname = usePathname();
  // eslint-disable-next-line react-hooks/set-state-in-effect -- fecha a gaveta ao navegar
  useEffect(() => setGaveta(false), [pathname]);

  return (
    <>
      <FaixaAmbiente />
      {/* sidebar fixa (desktop) */}
      <aside className="fixed top-(--faixa) bottom-0 left-0 z-40 hidden w-(--sb) transition-[width] duration-200 lg:block no-print">
        <SidebarConteudo recolhido={recolhido} onRecolher={alternar} />
      </aside>
      {/* gaveta (mobile) */}
      <AnimatePresence>
        {gaveta && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-dark-maya/50 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setGaveta(false)}
            />
            <motion.aside
              className="fixed top-(--faixa) bottom-0 left-0 z-50 w-[min(82vw,290px)] shadow-2xl lg:hidden"
              initial={{ x: "-102%" }}
              animate={{ x: 0 }}
              exit={{ x: "-102%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
            >
              <SidebarConteudo recolhido={false} onNavigate={() => setGaveta(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <Topbar onMenu={() => setGaveta(true)} />
      <CommandPalette />

      <main className="min-h-dvh pt-[calc(var(--tb)+var(--faixa))] transition-[padding] duration-200 lg:pl-(--sb)">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </>
  );
}
