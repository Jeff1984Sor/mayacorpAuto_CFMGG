"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, MessageCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Conversa, Msg, UsuarioChat } from "@/lib/comunicador";
import type { UsuarioMe } from "@/lib/types";
import { cn } from "@/lib/utils";

import { PainelConversa } from "./conversa";
import { ListaConversas } from "./lista-conversas";
import { EscolherPessoas } from "./novo-grupo";
import { qk, useComunicador } from "./provider";

const MQ = "(max-width: 639px)";
function useCelular() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(MQ);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

function BotaoIcone({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={rotulo}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{rotulo}</TooltipContent>
    </Tooltip>
  );
}

/** Comunicador flutuante (canto inferior direito), presente em todas as telas exceto /comunicador. */
export function ComunicadorWidget() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const { resumo, pulso, registrarWidget } = useComunicador();
  const celular = useCelular();
  const naPagina = pathname.startsWith("/comunicador");

  const pref = usuario?.preferencias as { comunicador_aberto?: boolean; comunicador_conversa?: number | null } | undefined;
  const [aberto, setAbertoLocal] = useState<boolean | null>(null);
  const [cid, setCidLocal] = useState<number | null | undefined>(undefined);
  const [alvoMsg, setAlvoMsg] = useState<number | null>(null);
  const [dialogo, setDialogo] = useState<"grupo" | "direta" | null>(null);
  const abertoEfetivo = aberto ?? !!pref?.comunicador_aberto;
  const conversaId = cid === undefined ? (pref?.comunicador_conversa ?? null) : cid;

  // preferência por usuário (vale em qualquer computador). As duas chaves vão SEMPRE juntas:
  // o servidor mescla a partir do registro lido em cada requisição, e duas gravações simultâneas
  // com uma chave cada uma perderiam a outra.
  const estado = useRef({ aberto: abertoEfetivo, conversa: conversaId });
  useEffect(() => {
    estado.current = { aberto: abertoEfetivo, conversa: conversaId };
  }, [abertoEfetivo, conversaId]);
  const atualizar = useCallback(
    (mudanca: { aberto?: boolean; conversa?: number | null }) => {
      const novo = { ...estado.current, ...mudanca };
      estado.current = novo;
      if (mudanca.aberto !== undefined) setAbertoLocal(novo.aberto);
      if (mudanca.conversa !== undefined) setCidLocal(novo.conversa);
      api
        .put<UsuarioMe>("/auth/me/preferencias", { comunicador_aberto: novo.aberto, comunicador_conversa: novo.conversa })
        .then((u) => qc.setQueryData(["me"], u))
        .catch(() => {}); // preferência visual: falhar ao salvar não atrapalha o uso
    },
    [qc],
  );
  const setAberto = useCallback((v: boolean) => atualizar({ aberto: v }), [atualizar]);
  const setConversa = useCallback((id: number | null) => atualizar({ conversa: id }), [atualizar]);

  const ativo = abertoEfetivo && !naPagina;
  const usuariosQ = useQuery({ queryKey: qk.usuarios, queryFn: () => api.get<UsuarioChat[]>("/comunicador/usuarios"), staleTime: 60_000, enabled: ativo });
  const conversasQ = useQuery({ queryKey: qk.conversas, queryFn: () => api.get<Conversa[]>("/comunicador/conversas"), enabled: ativo });
  const usuarios = useMemo(() => new Map((usuariosQ.data ?? []).map((u) => [u.id, u])), [usuariosQ.data]);
  const conversas = useMemo(() => conversasQ.data ?? [], [conversasQ.data]);
  const atual = conversas.find((c) => c.id === conversaId) ?? null;

  // "Responder" no toast abre o painel direto na conversa
  useEffect(() => {
    if (naPagina) return;
    registrarWidget((id) => atualizar({ aberto: true, conversa: id }));
    return () => registrarWidget(null);
  }, [naPagina, registrarWidget, atualizar]);

  // Esc fecha o painel (no desktop; no celular a folha já trata)
  useEffect(() => {
    if (!ativo || celular) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) setAberto(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [ativo, celular, setAberto]);


  if (naPagina || !usuario) return null;

  const telaCheia = () => {
    setAberto(false);
    router.push(conversaId ? `/comunicador?conversa=${conversaId}` : "/comunicador");
  };
  const acoes = (
    <>
      <BotaoIcone rotulo="Abrir em tela cheia" onClick={telaCheia}>
        <Maximize2 className="size-4" />
      </BotaoIcone>
      <BotaoIcone rotulo="Fechar" onClick={() => setAberto(false)}>
        <X className="size-4" />
      </BotaoIcone>
    </>
  );

  const conteudo = (
    <div className="flex h-full min-h-0 flex-col">
      {atual ? (
        <PainelConversa
          key={atual.id}
          conversa={atual}
          usuarios={usuarios}
          alvoMsg={alvoMsg}
          onAlvoConsumido={() => setAlvoMsg(null)}
          onVoltar={() => setConversa(null)}
          compacto
          acoesExtra={acoes}
        />
      ) : (
        <ListaConversas
          conversas={conversas}
          carregando={conversasQ.isPending}
          usuarios={usuarios}
          selecionada={null}
          onAbrir={(c) => setConversa(c.id)}
          onAbrirMsg={(m: Msg) => {
            setAlvoMsg(m.id);
            setConversa(m.conversa_id);
          }}
          onNovoGrupo={() => setDialogo("grupo")}
          onNovaDireta={() => setDialogo("direta")}
          acoesExtra={acoes}
          compacto
        />
      )}
    </div>
  );

  const total = resumo.nao_lidas;

  return (
    <>
      {/* botão flutuante */}
      <div className="no-print fixed right-6 bottom-6 z-40">
        <Tooltip>
          <TooltipTrigger
            render={
              <motion.button
                type="button"
                onClick={() => setAberto(!abertoEfetivo)}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                aria-label={total ? `Comunicador: ${total} não lida(s)` : "Comunicador"}
                aria-expanded={abertoEfetivo}
                className="relative grid size-14 place-items-center rounded-full brand-gradient text-white shadow-xl shadow-brand/40 ring-1 ring-white/20"
              />
            }
          >
            {/* pulso discreto quando chega mensagem */}
            <AnimatePresence>
              {pulso > 0 && !abertoEfetivo && (
                <motion.span
                  key={pulso}
                  className="absolute inset-0 rounded-full ring-4 ring-brand"
                  initial={{ opacity: 0.7, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.6 }}
                  transition={{ duration: 1.2, ease: "easeOut" }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={abertoEfetivo ? "x" : "msg"}
                initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.18 }}
                className="grid place-items-center"
              >
                {abertoEfetivo ? <X className="size-6" /> : <MessageCircle className="size-6" />}
              </motion.span>
            </AnimatePresence>
            {total > 0 && !abertoEfetivo && (
              <motion.span
                key={total}
                initial={{ scale: 0.5 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white tabular-nums ring-2 ring-background"
              >
                {total > 99 ? "99+" : total}
              </motion.span>
            )}
          </TooltipTrigger>
          <TooltipContent side="left">Comunicador</TooltipContent>
        </Tooltip>
      </div>

      {/* painel */}
      {celular ? (
        <Sheet open={abertoEfetivo} onOpenChange={setAberto}>
          <SheetContent side="bottom" showCloseButton={false} className="h-dvh max-h-dvh gap-0 rounded-none p-0 data-[side=bottom]:h-dvh">
            <SheetTitle className="sr-only">Comunicador</SheetTitle>
            <SheetDescription className="sr-only">Conversas da equipe</SheetDescription>
            {conteudo}
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {abertoEfetivo && (
            <motion.section
              role="dialog"
              aria-label="Comunicador"
              initial={{ opacity: 0, scale: 0.6, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.6, y: 24 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              style={{ transformOrigin: "bottom right" }}
              className={cn(
                "no-print fixed right-6 bottom-24 z-40 flex h-[min(560px,calc(100dvh-8rem))] w-[380px] flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-dark-maya/25",
              )}
            >
              {conteudo}
            </motion.section>
          )}
        </AnimatePresence>
      )}

      <EscolherPessoas
        modo={dialogo ?? "grupo"}
        open={!!dialogo}
        onOpenChange={(o) => !o && setDialogo(null)}
        usuarios={usuariosQ.data ?? []}
        onCriado={(c) => {
          qc.invalidateQueries({ queryKey: qk.conversas });
          qc.setQueryData<Conversa[]>(qk.conversas, (old) => (old?.some((x) => x.id === c.id) ? old : [c, ...(old ?? [])]));
          setConversa(c.id);
        }}
      />
    </>
  );
}
