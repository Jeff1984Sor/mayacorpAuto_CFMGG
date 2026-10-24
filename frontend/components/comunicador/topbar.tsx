"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Bell, Check, CheckCheck, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type Mencao, horaLista } from "@/lib/comunicador";
import { iniciais } from "@/lib/format";
import { cn } from "@/lib/utils";

import { qk, useComunicador } from "./provider";

function Contador({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-bold text-brand-foreground tabular-nums ring-2 ring-card",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Ícone do chat com o total de não lidas. */
export function ChatBotao() {
  const { resumo } = useComunicador();
  return (
    <Link
      href="/comunicador"
      className="relative grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
      aria-label={resumo.nao_lidas ? `Comunicador: ${resumo.nao_lidas} mensagem(ns) não lida(s)` : "Comunicador"}
    >
      <MessageCircle className="size-[18px]" />
      <Contador n={resumo.nao_lidas} />
    </Link>
  );
}

/** Sininho = centro de menções. */
export function MencoesBotao() {
  const { resumo } = useComunicador();
  const qc = useQueryClient();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const lista = useQuery({
    queryKey: qk.mencoes,
    queryFn: () => api.get<Mencao[]>("/comunicador/mencoes", { pendentes: true }),
    enabled: aberto,
    meta: { silencioso: true },
  });
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: qk.mencoes });
    qc.invalidateQueries({ queryKey: qk.resumo });
  };
  const ler = useMutation({ mutationFn: (id: number) => api.post(`/comunicador/mencoes/${id}/ler`), onSuccess: atualizar });
  const resolver = useMutation({ mutationFn: (id: number) => api.post(`/comunicador/mencoes/${id}/resolver`), onSuccess: atualizar });

  const abrir = (m: Mencao) => {
    if (!m.lida) ler.mutate(m.id);
    setAberto(false);
    router.push(m.url);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="relative grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label={resumo.mencoes ? `${resumo.mencoes} menção(ões) nova(s)` : "Menções"}
          />
        }
      >
        <Bell className="size-[18px]" />
        <Contador n={resumo.mencoes} className="bg-danger text-white" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="flex items-center gap-1.5 font-semibold">
            <AtSign className="size-4 text-info-ink" /> Menções
          </p>
          <Link href="/comunicador" onClick={() => setAberto(false)} className="text-xs font-medium text-info-ink hover:underline">
            Abrir o Comunicador
          </Link>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {lista.isPending ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : !lista.data?.length ? (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-success/10 text-success-ink">
                <CheckCheck className="size-6" />
              </div>
              <p className="text-sm font-medium">Nada pendente</p>
              <p className="text-xs text-muted-foreground">Quando alguém chamar você com @, aparece aqui.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {lista.data.map((m) => (
                <li key={m.id} className={cn("group flex gap-3 px-4 py-3 transition-colors hover:bg-accent/40", !m.lida && "bg-brand/[0.04]")}>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full brand-gradient text-[11px] font-semibold text-white">
                    {iniciais(m.autor_nome)}
                  </span>
                  <button type="button" onClick={() => abrir(m)} className="min-w-0 flex-1 text-left">
                    <p className="flex items-center gap-1.5 text-sm">
                      <strong className="truncate font-semibold">{m.autor_nome}</strong>
                      {!m.lida && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-label="nova" />}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{horaLista(m.criada_em)}</span>
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{m.trecho}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => resolver.mutate(m.id)}
                    className="self-center rounded-md p-1.5 text-muted-foreground opacity-60 transition hover:bg-success/10 hover:text-success-ink group-hover:opacity-100"
                    aria-label="Resolver menção"
                    title="Resolver"
                  >
                    <Check className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
