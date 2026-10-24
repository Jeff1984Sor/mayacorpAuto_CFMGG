"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, Loader2, PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type Conversa,
  dataMsg,
  diaChave,
  type Msg,
  type PaginaMsgs,
  ROTULO_STATUS,
  rotuloDia,
  textoSimples,
  type UsuarioChat,
} from "@/lib/comunicador";
import { cn } from "@/lib/utils";

import { AvatarConversa } from "./avatar";
import { Compositor } from "./compositor";
import { type EstadoEnvio, Bolha } from "./mensagem";
import { atualizarConversa, gravarMsgNoCache, qk, useComunicador } from "./provider";

interface Pendente {
  tempId: string;
  texto: string;
  resposta: Msg | null;
  estado: Exclude<EstadoEnvio, undefined>;
  criada_em: string;
}

const PERTO_DO_FIM = 140;

function Digitando({ nomes }: { nomes: string[] }) {
  if (!nomes.length) return null;
  const texto = nomes.length === 1 ? `${nomes[0]} está digitando` : `${nomes.slice(0, 2).join(" e ")} estão digitando`;
  return (
    <div className="flex items-center gap-2 px-5 pt-2 pb-1 text-xs text-muted-foreground" aria-live="polite">
      <span className="flex items-end gap-0.5 rounded-full border bg-card px-2.5 py-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }} />
        ))}
      </span>
      {texto}…
    </div>
  );
}

export function PainelConversa({
  conversa,
  usuarios,
  alvoMsg,
  onAlvoConsumido,
  onVoltar,
  pessoasAberto,
  onAlternarPessoas,
}: {
  conversa: Conversa;
  usuarios: Map<number, UsuarioChat>;
  alvoMsg: number | null;
  onAlvoConsumido: () => void;
  onVoltar: () => void;
  pessoasAberto: boolean;
  onAlternarPessoas: () => void;
}) {
  const cid = conversa.id;
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const eu = usuario?.id;
  const { online, lidas, digitando, avisarDigitando, setConversaAberta } = useComunicador();
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [resposta, setResposta] = useState<Msg | null>(null);
  const [apagar, setApagar] = useState<Msg | null>(null);
  const [destaque, setDestaque] = useState<number | null>(null);
  const [novas, setNovas] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const topo = useRef<HTMLDivElement>(null);
  const antesDeCarregar = useRef<{ h: number; t: number } | null>(null);
  const ultimoId = useRef<number | null>(null);
  const lidoEnviado = useRef(0);
  const primeiraCarga = useRef(true);

  useEffect(() => {
    setConversaAberta(cid);
    return () => setConversaAberta(null);
  }, [cid, setConversaAberta]);

  /* eslint-disable react-hooks/set-state-in-effect -- reinicia o estado local ao trocar de conversa */
  useEffect(() => {
    setPendentes([]);
    setResposta(null);
    setNovas(0);
    primeiraCarga.current = true;
    ultimoId.current = null;
    lidoEnviado.current = 0;
  }, [cid]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const q = useInfiniteQuery({
    queryKey: qk.msgs(cid),
    queryFn: ({ pageParam }) => api.get<PaginaMsgs>(`/comunicador/conversas/${cid}/mensagens`, { antes: pageParam, limite: 40 }),
    initialPageParam: null as number | null,
    getNextPageParam: (ultima) => (ultima.tem_mais && ultima.itens.length ? ultima.itens[0].id : undefined),
    staleTime: Infinity,
  });
  const msgs = useMemo(() => (q.data ? [...q.data.pages].reverse().flatMap((p) => p.itens) : []), [q.data]);

  // ✓✓: até onde todos os outros leram
  const lidaAte = useMemo(() => {
    const outros = conversa.participantes.filter((p) => p !== eu);
    const ev = lidas[cid] ?? {};
    const valores = outros.map((o) => ev[o]);
    const porEventos = valores.length && valores.every((v) => v != null) ? Math.min(...(valores as number[])) : 0;
    if (conversa.tipo === "direta" && conversa.outro_id != null) return Math.max(conversa.lida_por_todos_ate, ev[conversa.outro_id] ?? 0);
    return Math.max(conversa.lida_por_todos_ate, porEventos);
  }, [conversa, lidas, cid, eu]);

  // ------------------------------------------------------------ leitura
  const marcarLido = useCallback(() => {
    const ult = msgs[msgs.length - 1];
    if (!ult || document.visibilityState !== "visible" || ult.id <= lidoEnviado.current) return;
    lidoEnviado.current = ult.id;
    api
      .post(`/comunicador/conversas/${cid}/lido`, { ate_id: ult.id })
      .then(() => {
        qc.setQueryData<Conversa[]>(qk.conversas, (old) => old?.map((c) => (c.id === cid ? { ...c, nao_lidas: 0 } : c)));
        qc.invalidateQueries({ queryKey: qk.resumo });
      })
      .catch(() => {
        lidoEnviado.current = 0;
      });
  }, [msgs, cid, qc]);
  useEffect(() => {
    marcarLido();
    const vis = () => marcarLido();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", vis);
    };
  }, [marcarLido]);

  // ------------------------------------------------------------ rolagem
  const noFim = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < PERTO_DO_FIM;
  };
  const irParaFim = (suave = false) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: suave ? "smooth" : "auto" });
    setNovas(0);
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !msgs.length) return;
    // preservar a posição ao carregar mensagens antigas no topo
    if (antesDeCarregar.current) {
      el.scrollTop = el.scrollHeight - antesDeCarregar.current.h + antesDeCarregar.current.t;
      antesDeCarregar.current = null;
      return;
    }
    const ult = msgs[msgs.length - 1];
    if (primeiraCarga.current) {
      primeiraCarga.current = false;
      ultimoId.current = ult.id;
      if (!alvoMsg) el.scrollTop = el.scrollHeight;
      return;
    }
    if (ultimoId.current !== ult.id) {
      const nova = ult.id > (ultimoId.current ?? 0);
      ultimoId.current = ult.id;
      if (!nova) return;
      const pertoDoFim = ult.autor_id === eu || noFim();
      requestAnimationFrame(() => {
        if (pertoDoFim) irParaFim(true);
        else setNovas((n) => n + 1);
        if (ult.autor_id !== eu) setAnuncio(`${ult.autor_nome}: ${ult.apagada ? "mensagem apagada" : textoSimples(ult.texto)}`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage à lista de mensagens
  }, [msgs]);

  useEffect(() => {
    if (pendentes.length) requestAnimationFrame(() => irParaFim(true));
  }, [pendentes.length]);

  // scroll infinito para cima
  useEffect(() => {
    const alvo = topo.current;
    const raiz = scroller.current;
    if (!alvo || !raiz) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage && !primeiraCarga.current) {
          antesDeCarregar.current = { h: raiz.scrollHeight, t: raiz.scrollTop };
          void q.fetchNextPage();
        }
      },
      { root: raiz, rootMargin: "200px 0px 0px 0px" },
    );
    io.observe(alvo);
    return () => io.disconnect();
  }, [q]);

  // ir até uma mensagem (resposta citada, menção, busca): carrega páginas antigas se preciso
  const irPara = useCallback(
    async (id: number) => {
      for (let i = 0; i < 15; i++) {
        const el = document.getElementById(`msg-${id}`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          setDestaque(id);
          setTimeout(() => setDestaque((d) => (d === id ? null : d)), 1800);
          return true;
        }
        const dados = qc.getQueryData<{ pages: PaginaMsgs[] }>(qk.msgs(cid));
        const ultima = dados?.pages[dados.pages.length - 1];
        if (!ultima?.tem_mais) return false;
        antesDeCarregar.current = scroller.current ? { h: scroller.current.scrollHeight, t: scroller.current.scrollTop } : null;
        await q.fetchNextPage();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return false;
    },
    [qc, cid, q],
  );
  useEffect(() => {
    if (!alvoMsg || !msgs.length) return;
    const t = setTimeout(() => {
      void irPara(alvoMsg).then((ok) => {
        if (!ok) toast.info("Essa mensagem não está mais disponível.");
        onAlvoConsumido();
      });
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara quando o alvo chega e as mensagens carregaram
  }, [alvoMsg, msgs.length > 0]);

  // ------------------------------------------------------------ envio otimista
  const enviarReal = useCallback(
    async (p: Pendente) => {
      setPendentes((ps) => ps.map((x) => (x.tempId === p.tempId ? { ...x, estado: "pendente" } : x)));
      try {
        const m = await api.post<Msg>(`/comunicador/conversas/${cid}/mensagens`, { texto: p.texto, resposta_a_id: p.resposta?.id ?? null });
        gravarMsgNoCache(qc, m);
        atualizarConversa(qc, m, false);
        lidoEnviado.current = Math.max(lidoEnviado.current, m.id);
        setPendentes((ps) => ps.filter((x) => x.tempId !== p.tempId));
      } catch {
        setPendentes((ps) => ps.map((x) => (x.tempId === p.tempId ? { ...x, estado: "erro" } : x)));
      }
    },
    [cid, qc],
  );
  const enviar = (texto: string) => {
    const p: Pendente = { tempId: `t${Date.now()}${Math.random()}`, texto, resposta, estado: "pendente", criada_em: new Date().toISOString() };
    setPendentes((ps) => [...ps, p]);
    setResposta(null);
    void enviarReal(p);
  };

  const editar = useMutation({
    mutationFn: ({ id, texto }: { id: number; texto: string }) => api.patch<Msg>(`/comunicador/mensagens/${id}`, { texto }),
    onSuccess: (m) => gravarMsgNoCache(qc, m),
  });
  const apagarMut = useMutation({
    mutationFn: (id: number) => api.del<Msg | undefined>(`/comunicador/mensagens/${id}`),
    onSuccess: (m, id) => {
      if (m && typeof m === "object" && "id" in m) gravarMsgNoCache(qc, m);
      else
        qc.setQueryData<{ pages: PaginaMsgs[]; pageParams: unknown[] }>(qk.msgs(cid), (old) =>
          old ? { ...old, pages: old.pages.map((p) => ({ ...p, itens: p.itens.map((x) => (x.id === id ? { ...x, apagada: true, texto: "" } : x)) })) } : old,
        );
      setApagar(null);
    },
  });

  // ------------------------------------------------------------ cabeçalho
  const outro = conversa.outro_id != null ? usuarios.get(conversa.outro_id) : undefined;
  const statusOutro = (conversa.outro_id != null && online[conversa.outro_id]) || outro?.status || "offline";
  const subtitulo =
    conversa.tipo === "robo"
      ? "Avisos automáticos: lotes, rejeições, certificado, baixas"
      : conversa.tipo === "direta"
        ? ROTULO_STATUS[statusOutro]
        : conversa.participantes
            .filter((p) => p !== eu)
            .map((p) => usuarios.get(p)?.nome.split(" ")[0])
            .filter(Boolean)
            .join(", ") + " e você";
  const nomesDigitando = Object.keys(digitando[cid] ?? {})
    .map((u) => usuarios.get(Number(u))?.nome.split(" ")[0] ?? "Alguém")
    .filter(Boolean);
  const candidatos = conversa.participantes.filter((p) => p !== eu).map((p) => usuarios.get(p)).filter(Boolean) as UsuarioChat[];

  // ------------------------------------------------------------ render da lista
  const itens: React.ReactNode[] = [];
  let diaAnterior = "";
  const todos: { m: Msg; estado?: EstadoEnvio; tempId?: string }[] = [
    ...msgs.map((m) => ({ m })),
    ...pendentes.map((p, i) => ({
      tempId: p.tempId,
      estado: p.estado as EstadoEnvio,
      m: {
        id: Number.MAX_SAFE_INTEGER - pendentes.length + i,
        conversa_id: cid,
        autor_id: eu ?? null,
        autor_nome: usuario?.nome ?? "Você",
        robo: false,
        texto: p.texto,
        apagada: false,
        editada: false,
        link: null,
        resposta_a: p.resposta ? { id: p.resposta.id, autor_nome: p.resposta.autor_nome, texto: textoSimples(p.resposta.texto).slice(0, 140) } : null,
        criada_em: p.criada_em,
      } as Msg,
    })),
  ];
  todos.forEach(({ m, estado, tempId }, i) => {
    const dia = diaChave(m.criada_em);
    if (dia !== diaAnterior) {
      itens.push(
        <div key={`dia-${dia}`} className="sticky top-2 z-10 my-4 flex justify-center">
          <span className="rounded-full border bg-card/90 px-3 py-1 text-[11px] font-medium text-muted-foreground capitalize shadow-sm backdrop-blur">
            {rotuloDia(m.criada_em)}
          </span>
        </div>,
      );
      diaAnterior = dia;
    }
    const ant = todos[i - 1]?.m;
    const prox = todos[i + 1]?.m;
    const mesmoBloco = (a?: Msg, b?: Msg) =>
      !!a && !!b && a.autor_id === b.autor_id && a.robo === b.robo && diaChave(a.criada_em) === diaChave(b.criada_em) &&
      Math.abs(dataMsg(b.criada_em).getTime() - dataMsg(a.criada_em).getTime()) < 5 * 60_000;
    const minha = m.autor_id === eu && !m.robo;
    const autor = m.autor_id != null ? usuarios.get(m.autor_id) : undefined;
    const p = tempId ? pendentes.find((x) => x.tempId === tempId) : undefined;
    itens.push(
      <Bolha
        key={tempId ?? m.id}
        m={m}
        eu={eu}
        minha={minha}
        inicioGrupo={!mesmoBloco(ant, m)}
        fimGrupo={!mesmoBloco(m, prox)}
        grupo={conversa.tipo === "grupo"}
        lidaAte={lidaAte}
        estado={estado}
        destaque={destaque === m.id}
        avatar={
          m.robo ? (
            <span className="grid size-8 place-items-center rounded-xl brand-gradient text-white">
              <Sparkles className="size-4" />
            </span>
          ) : (
            <UserAvatar nome={m.autor_nome} fotoUrl={autor?.foto_url} className="size-8" textoClassName="text-[10px]" />
          )
        }
        onResponder={() => setResposta(m)}
        onEditar={minha && !tempId ? (texto) => editar.mutateAsync({ id: m.id, texto }) : undefined}
        onApagar={minha && !tempId ? () => setApagar(m) : undefined}
        onIrPara={(id) => void irPara(id)}
        onTentarDeNovo={p ? () => void enviarReal(p) : undefined}
        onDescartar={p ? () => setPendentes((ps) => ps.filter((x) => x.tempId !== p.tempId)) : undefined}
      />,
    );
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <button type="button" onClick={onVoltar} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden" aria-label="Voltar para as conversas">
          <ArrowLeft className="size-5" />
        </button>
        <AvatarConversa conversa={conversa} usuarios={usuarios} online={online} tamanho="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{conversa.tipo === "robo" ? "🤖 Robô MayaCorp" : conversa.titulo}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {nomesDigitando.length && conversa.tipo === "direta" ? <span className="text-info-ink">digitando…</span> : subtitulo}
          </p>
        </div>
        <button
          type="button"
          onClick={onAlternarPessoas}
          className="hidden size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground xl:grid"
          aria-label={pessoasAberto ? "Esconder equipe" : "Mostrar equipe"}
          title={pessoasAberto ? "Esconder equipe" : "Mostrar equipe"}
        >
          {pessoasAberto ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
        </button>
      </header>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_1px_1px,var(--viz-grid)_1px,transparent_0)] bg-size-[22px_22px] pb-3">
        <div ref={topo} className="h-1" />
        {q.isFetchingNextPage && (
          <div className="flex justify-center py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!q.hasNextPage && msgs.length > 0 && (
          <p className="py-4 text-center text-[11px] text-muted-foreground">Início da conversa</p>
        )}
        {q.isPending ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <Skeleton className={cn("h-10 rounded-2xl", i % 2 ? "w-48" : "w-64")} />
              </div>
            ))}
          </div>
        ) : todos.length === 0 ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl brand-gradient text-3xl shadow-xl shadow-brand/30">👋</div>
              <p className="font-semibold">{conversa.tipo === "robo" ? "Nenhum aviso ainda" : "Diga oi!"}</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                {conversa.tipo === "robo"
                  ? "Quando um lote terminar, uma nota for rejeitada ou o certificado estiver para vencer, o robô avisa aqui."
                  : "Comece a conversa. Use @ para chamar alguém do grupo."}
              </p>
            </div>
          </div>
        ) : (
          itens
        )}
      </div>

      <Digitando nomes={nomesDigitando} />

      {novas > 0 && (
        <button
          type="button"
          onClick={() => irParaFim(true)}
          className="absolute bottom-28 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground shadow-lg"
        >
          <ArrowDown className="size-3.5" /> {novas} nova{novas > 1 ? "s" : ""} mensage{novas > 1 ? "ns" : "m"}
        </button>
      )}

      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>

      <Compositor
        bloqueado={conversa.tipo === "robo"}
        candidatos={candidatos}
        resposta={resposta}
        onCancelarResposta={() => setResposta(null)}
        onEnviar={enviar}
        onDigitando={() => avisarDigitando(cid)}
        rascunhoKey={`com-rascunho-${cid}`}
      />

      <ConfirmDialog
        open={!!apagar}
        onOpenChange={(o) => !o && setApagar(null)}
        titulo="Apagar esta mensagem?"
        descricao="Ela some para todos e fica “Mensagem apagada” no lugar."
        confirmar="Apagar"
        destrutivo
        carregando={apagarMut.isPending}
        onConfirm={() => apagar && apagarMut.mutate(apagar.id)}
      />
    </div>
  );
}
