"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, WifiOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { PainelConversa } from "@/components/comunicador/conversa";
import { ListaConversas } from "@/components/comunicador/lista-conversas";
import { EscolherPessoas } from "@/components/comunicador/novo-grupo";
import { PainelPessoas } from "@/components/comunicador/pessoas";
import { qk, useComunicador } from "@/components/comunicador/provider";
import { api } from "@/lib/api";
import type { Conversa, Msg, UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

const CHAVE_PAINEL = "com-pessoas-aberto";

function Comunicador() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { conectado } = useComunicador();
  const selecionada = Number(params.get("conversa")) || null;
  const alvoUrl = Number(params.get("msg")) || null;
  const [alvoMsg, setAlvoMsg] = useState<number | null>(null);
  const [dialogo, setDialogo] = useState<"grupo" | "direta" | null>(null);
  const [pessoasAberto, setPessoasAberto] = useState(true);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência local do painel
      setPessoasAberto(localStorage.getItem(CHAVE_PAINEL) !== "0");
    } catch {
      /* storage indisponível */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- alvo vindo da URL (menção, busca, toast)
    if (alvoUrl) setAlvoMsg(alvoUrl);
  }, [alvoUrl, selecionada]);

  const usuariosQ = useQuery({ queryKey: qk.usuarios, queryFn: () => api.get<UsuarioChat[]>("/comunicador/usuarios"), staleTime: 60_000 });
  const conversasQ = useQuery({ queryKey: qk.conversas, queryFn: () => api.get<Conversa[]>("/comunicador/conversas") });
  const usuarios = useMemo(() => new Map((usuariosQ.data ?? []).map((u) => [u.id, u])), [usuariosQ.data]);
  const conversas = useMemo(() => conversasQ.data ?? [], [conversasQ.data]);
  const atual = conversas.find((c) => c.id === selecionada) ?? null;

  const abrir = useCallback(
    (cid: number | null, msg?: number) => {
      const q = cid ? `?conversa=${cid}${msg ? `&msg=${msg}` : ""}` : "";
      router.replace(`/comunicador${q}`, { scroll: false });
    },
    [router],
  );

  // conversa da URL que ainda não está na lista (ex.: acabou de ser criada por outra pessoa)
  useEffect(() => {
    if (selecionada && conversasQ.data && !atual) qc.invalidateQueries({ queryKey: qk.conversas });
  }, [selecionada, conversasQ.data, atual, qc]);

  const direta = useMutation({
    mutationFn: (u: UsuarioChat) => api.post<Conversa>(`/comunicador/diretas/${u.id}`),
    onSuccess: (c) => {
      qc.setQueryData<Conversa[]>(qk.conversas, (old) => (old?.some((x) => x.id === c.id) ? old : [c, ...(old ?? [])]));
      abrir(c.id);
    },
  });

  const alternarPessoas = () =>
    setPessoasAberto((v) => {
      try {
        localStorage.setItem(CHAVE_PAINEL, v ? "0" : "1");
      } catch {
        /* storage indisponível */
      }
      return !v;
    });

  return (
    <div className="-mx-4 -my-6 h-[calc(100dvh-var(--tb)-var(--faixa))] sm:-mx-6 lg:-mx-8 lg:-my-8">
      <div className="flex h-full min-h-0 overflow-hidden border-y bg-card lg:rounded-none">
        {/* esquerda: conversas */}
        <div className={cn("h-full min-h-0 w-full shrink-0 border-r lg:block lg:w-80", atual ? "hidden" : "block")}>
          <ListaConversas
            conversas={conversas}
            carregando={conversasQ.isPending}
            usuarios={usuarios}
            selecionada={selecionada}
            onAbrir={(c) => abrir(c.id)}
            onAbrirMsg={(m: Msg) => abrir(m.conversa_id, m.id)}
            onNovoGrupo={() => setDialogo("grupo")}
            onNovaDireta={() => setDialogo("direta")}
          />
        </div>

        {/* centro: conversa */}
        <main className={cn("h-full min-h-0 min-w-0 flex-1 bg-background/60", atual ? "block" : "hidden lg:block")}>
          {!conectado && (
            <div className="flex items-center justify-center gap-2 border-b bg-warning/10 px-3 py-1.5 text-xs text-warning-ink" role="status">
              <WifiOff className="size-3.5" /> Reconectando ao Comunicador… as mensagens chegam assim que voltar.
            </div>
          )}
          {atual ? (
            <PainelConversa
              key={atual.id}
              conversa={atual}
              usuarios={usuarios}
              alvoMsg={alvoMsg}
              onAlvoConsumido={() => setAlvoMsg(null)}
              onVoltar={() => abrir(null)}
              pessoasAberto={pessoasAberto}
              onAlternarPessoas={alternarPessoas}
            />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <div className="relative mx-auto mb-5 size-20">
                  <div className="absolute inset-0 rounded-3xl bg-brand/30 blur-2xl" />
                  <div className="relative grid size-20 place-items-center rounded-3xl brand-gradient text-white shadow-xl shadow-brand/30">
                    <MessagesSquare className="size-9" />
                  </div>
                </div>
                <h2 className="text-lg font-semibold">Comunicador</h2>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Escolha uma conversa à esquerda ou clique numa pessoa da equipe. Use <strong>@</strong> para chamar alguém e o robô avisa aqui quando algo
                  acontecer.
                </p>
              </div>
            </div>
          )}
        </main>

        {/* direita: equipe */}
        {pessoasAberto && (
          <div className="hidden h-full min-h-0 w-72 shrink-0 border-l xl:block">
            <PainelPessoas usuarios={usuariosQ.data ?? []} onAbrirDireta={(u) => direta.mutate(u)} />
          </div>
        )}
      </div>

      <EscolherPessoas
        modo={dialogo ?? "grupo"}
        open={!!dialogo}
        onOpenChange={(o) => !o && setDialogo(null)}
        usuarios={usuariosQ.data ?? []}
        onCriado={(c) => {
          qc.invalidateQueries({ queryKey: qk.conversas });
          qc.setQueryData<Conversa[]>(qk.conversas, (old) => (old?.some((x) => x.id === c.id) ? old : [c, ...(old ?? [])]));
          abrir(c.id);
        }}
      />
    </div>
  );
}

export default function ComunicadorPage() {
  return (
    <Suspense fallback={null}>
      <Comunicador />
    </Suspense>
  );
}
