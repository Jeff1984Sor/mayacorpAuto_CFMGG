"use client";

import { type InfiniteData, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { api, API_URL, tentarRefresh, tokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type Conversa,
  type EventoWS,
  type Msg,
  type PaginaMsgs,
  type Resumo,
  type StatusPresenca,
  textoSimples,
  tocarSom,
} from "@/lib/comunicador";

export const qk = {
  usuarios: ["com", "usuarios"] as const,
  conversas: ["com", "conversas"] as const,
  resumo: ["com", "resumo"] as const,
  mencoes: ["com", "mencoes"] as const,
  msgs: (cid: number) => ["com", "msgs", cid] as const,
};

interface ComCtx {
  conectado: boolean;
  online: Record<number, StatusPresenca>;
  meuStatus: StatusPresenca;
  definirStatus: (s: "online" | "ocupado") => void;
  resumo: Resumo;
  /** conversa_id -> {usuario_id -> último id lido} (vindo dos eventos "lida") */
  lidas: Record<number, Record<number, number>>;
  /** conversa_id -> {usuario_id -> timestamp do último "digitando"} */
  digitando: Record<number, Record<number, number>>;
  conversaAberta: number | null;
  setConversaAberta: (cid: number | null) => void;
  avisarDigitando: (cid: number) => void;
  /** Incrementa a cada mensagem recebida de outra pessoa (o widget pulsa). */
  pulso: number;
  /** O widget flutuante registra aqui como abrir uma conversa (ação "Responder" do toast). */
  registrarWidget: (abrir: ((cid: number) => void) | null) => void;
}

const Ctx = createContext<ComCtx | null>(null);

export function useComunicador() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useComunicador fora do ComunicadorProvider");
  return c;
}

/** Acrescenta (ou substitui) uma mensagem no cache paginado da conversa, sem duplicar. */
export function gravarMsgNoCache(qc: ReturnType<typeof useQueryClient>, m: Msg) {
  qc.setQueryData<InfiniteData<PaginaMsgs, number | null>>(qk.msgs(m.conversa_id), (old) => {
    if (!old) return old;
    const existe = old.pages.some((p) => p.itens.some((x) => x.id === m.id));
    if (existe) {
      return { ...old, pages: old.pages.map((p) => ({ ...p, itens: p.itens.map((x) => (x.id === m.id ? m : x)) })) };
    }
    const [primeira, ...resto] = old.pages;
    return { ...old, pages: [{ ...primeira, itens: [...primeira.itens, m] }, ...resto] };
  });
}

/** Atualiza a prévia da conversa na lista e a traz para o topo. */
export function atualizarConversa(qc: ReturnType<typeof useQueryClient>, m: Msg, contaNaoLida: boolean) {
  let achou = false;
  qc.setQueryData<Conversa[]>(qk.conversas, (old) => {
    if (!old) return old;
    const lista = old.map((c) => {
      if (c.id !== m.conversa_id) return c;
      achou = true;
      const ehUltima = !c.ultima || m.id >= c.ultima.id;
      return {
        ...c,
        ultima: ehUltima ? m : c.ultima,
        ultima_msg_em: ehUltima ? m.criada_em : c.ultima_msg_em,
        nao_lidas: contaNaoLida ? c.nao_lidas + 1 : c.nao_lidas,
      };
    });
    return lista.sort((a, b) => (b.ultima_msg_em ?? "").localeCompare(a.ultima_msg_em ?? "") || b.id - a.id);
  });
  if (!achou) qc.invalidateQueries({ queryKey: qk.conversas });
}

export function ComunicadorProvider({ children }: { children: React.ReactNode }) {
  const { usuario, logado } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const eu = usuario?.id ?? null;

  const [conectado, setConectado] = useState(false);
  const [online, setOnline] = useState<Record<number, StatusPresenca>>({});
  const [lidas, setLidas] = useState<Record<number, Record<number, number>>>({});
  const [digitando, setDigitando] = useState<Record<number, Record<number, number>>>({});
  const [conversaAberta, setConversaAberta] = useState<number | null>(null);
  const [pulso, setPulso] = useState(0);
  const widget = useRef<((cid: number) => void) | null>(null);
  const registrarWidget = useCallback((fn: ((cid: number) => void) | null) => {
    widget.current = fn;
  }, []);

  const ws = useRef<WebSocket | null>(null);
  const abertaRef = useRef<number | null>(null);
  const ultimoDigitando = useRef<Record<number, number>>({});
  useEffect(() => {
    abertaRef.current = conversaAberta;
  }, [conversaAberta]);

  const resumoQ = useQuery({
    queryKey: qk.resumo,
    queryFn: () => api.get<Resumo>("/comunicador/resumo"),
    enabled: logado,
    refetchInterval: 120_000,
    meta: { silencioso: true },
  });
  const resumo = useMemo(() => resumoQ.data ?? { nao_lidas: 0, mencoes: 0 }, [resumoQ.data]);

  const enviar = useCallback((o: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(o));
  }, []);

  // ---------------------------------------------------------------- eventos
  const tratar = useCallback(
    (ev: EventoWS) => {
      switch (ev.tipo) {
        case "ola":
          setOnline(Object.fromEntries(Object.entries(ev.online).map(([k, v]) => [Number(k), v])));
          break;
        case "presenca":
          setOnline((o) => ({ ...o, [ev.usuario_id]: ev.status }));
          qc.setQueryData<{ id: number; status: StatusPresenca }[]>(qk.usuarios, (old) =>
            old?.map((u) => (u.id === ev.usuario_id ? { ...u, status: ev.status } : u)),
          );
          break;
        case "mensagem.nova": {
          const m = ev.mensagem;
          const minha = m.autor_id === eu;
          const visivel = abertaRef.current === m.conversa_id && document.visibilityState === "visible";
          gravarMsgNoCache(qc, m);
          atualizarConversa(qc, m, !minha && !visivel);
          if (m.autor_id != null)
            setDigitando((d) => {
              if (!d[m.conversa_id]?.[m.autor_id!]) return d;
              const c = { ...d[m.conversa_id] };
              delete c[m.autor_id!];
              return { ...d, [m.conversa_id]: c };
            });
          if (!minha) {
            qc.invalidateQueries({ queryKey: qk.resumo });
            setPulso((x) => x + 1);
            if (!visivel) {
              tocarSom();
              const texto = m.apagada ? "Mensagem apagada" : textoSimples(m.texto);
              const abrirWidget = widget.current;
              toast(m.robo ? "🤖 Robô MayaCorp" : m.autor_nome, {
                description: texto.length > 120 ? `${texto.slice(0, 119)}…` : texto,
                action:
                  abrirWidget && !m.robo
                    ? { label: "Responder", onClick: () => abrirWidget(m.conversa_id) }
                    : { label: "Abrir", onClick: () => (abrirWidget ? abrirWidget(m.conversa_id) : router.push(`/comunicador?conversa=${m.conversa_id}&msg=${m.id}`)) },
              });
            }
          }
          break;
        }
        case "mensagem.atualizada":
          gravarMsgNoCache(qc, ev.mensagem);
          qc.setQueryData<Conversa[]>(qk.conversas, (old) =>
            old?.map((c) => (c.ultima?.id === ev.mensagem.id ? { ...c, ultima: ev.mensagem } : c)),
          );
          break;
        case "lida":
          setLidas((l) => ({
            ...l,
            [ev.conversa_id]: { ...l[ev.conversa_id], [ev.usuario_id]: Math.max(l[ev.conversa_id]?.[ev.usuario_id] ?? 0, ev.ate_id) },
          }));
          if (ev.usuario_id === eu) {
            // li em outra aba: zera os contadores aqui também
            qc.setQueryData<Conversa[]>(qk.conversas, (old) => old?.map((c) => (c.id === ev.conversa_id ? { ...c, nao_lidas: 0 } : c)));
            qc.invalidateQueries({ queryKey: qk.resumo });
          }
          break;
        case "digitando":
          if (ev.usuario_id === eu) break;
          setDigitando((d) => ({ ...d, [ev.conversa_id]: { ...d[ev.conversa_id], [ev.usuario_id]: Date.now() } }));
          break;
        case "mencao.nova":
          tocarSom();
          toast(`${ev.mencao.autor_nome} mencionou você`, {
            description: ev.mencao.trecho.length > 120 ? `${ev.mencao.trecho.slice(0, 119)}…` : ev.mencao.trecho,
            action: { label: "Ver", onClick: () => router.push(ev.mencao.url) },
          });
          qc.invalidateQueries({ queryKey: qk.resumo });
          qc.invalidateQueries({ queryKey: qk.mencoes });
          break;
        case "pong":
          break;
      }
    },
    [eu, qc, router],
  );
  const tratarRef = useRef(tratar);
  useEffect(() => {
    tratarRef.current = tratar;
  }, [tratar]);

  // ---------------------------------------------------------------- conexão (um socket por aba)
  useEffect(() => {
    if (!logado) return;
    let vivo = true;
    let tentativa = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const agendar = () => {
      if (!vivo) return;
      const espera = Math.min(30_000, 1000 * 2 ** tentativa);
      tentativa++;
      timer = setTimeout(conectar, espera);
    };

    function conectar() {
      if (!vivo || !tokens.access) return;
      const url = `${API_URL.replace(/^http/, "ws")}/ws/comunicador?token=${encodeURIComponent(tokens.access)}`;
      const s = new WebSocket(url);
      ws.current = s;
      s.onopen = () => {
        tentativa = 0;
        setConectado(true);
        // ao reconectar, sincroniza o que pode ter chegado enquanto estava fora
        qc.invalidateQueries({ queryKey: ["com"] });
        ping = setInterval(() => s.readyState === WebSocket.OPEN && s.send(JSON.stringify({ tipo: "ping" })), 25_000);
      };
      s.onmessage = (e) => {
        try {
          tratarRef.current(JSON.parse(e.data) as EventoWS);
        } catch {
          /* evento malformado: ignora */
        }
      };
      s.onclose = async (e) => {
        setConectado(false);
        if (ping) clearInterval(ping);
        if (ws.current === s) ws.current = null;
        if (!vivo) return;
        if (e.code === 4401) {
          const ok = await tentarRefresh();
          if (!ok) return; // sessão acabou: o fluxo de login cuida
          tentativa = 0;
        }
        agendar();
      };
      s.onerror = () => {
        try {
          s.close();
        } catch {
          /* já fechado */
        }
      };
    }

    conectar();
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      if (ping) clearInterval(ping);
      ws.current?.close(1000);
      ws.current = null;
    };
  }, [logado, qc]);

  // ---------------------------------------------------------------- atividade (presença "ausente" automática no servidor)
  useEffect(() => {
    if (!conectado) return;
    let ultimo = 0;
    const ativo = () => {
      const agora = Date.now();
      if (agora - ultimo < 30_000) return;
      ultimo = agora;
      enviar({ tipo: "atividade" });
    };
    const vis = () => document.visibilityState === "visible" && ativo();
    window.addEventListener("pointermove", ativo, { passive: true });
    window.addEventListener("keydown", ativo);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("pointermove", ativo);
      window.removeEventListener("keydown", ativo);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [conectado, enviar]);

  // "digitando…" some depois de 4s sem novo aviso
  useEffect(() => {
    const t = setInterval(() => {
      setDigitando((d) => {
        const agora = Date.now();
        let mudou = false;
        const novo: typeof d = {};
        Object.entries(d).forEach(([cid, us]) => {
          const vivos = Object.fromEntries(Object.entries(us).filter(([, ts]) => agora - ts < 4000));
          if (Object.keys(vivos).length !== Object.keys(us).length) mudou = true;
          if (Object.keys(vivos).length) novo[Number(cid)] = vivos as Record<number, number>;
        });
        return mudou ? novo : d;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // título da aba: "(3) …"
  const total = resumo.nao_lidas + resumo.mencoes;
  useEffect(() => {
    const aplicar = () => {
      const base = document.title.replace(/^\(\d+\)\s*/, "");
      const novo = total ? `(${total}) ${base}` : base;
      if (document.title !== novo) document.title = novo;
    };
    aplicar();
    const t = setTimeout(aplicar, 300); // depois que a marca/rota redefinem o título
    return () => clearTimeout(t);
  }, [total, pathname]);

  const avisarDigitando = useCallback(
    (cid: number) => {
      const agora = Date.now();
      if (agora - (ultimoDigitando.current[cid] ?? 0) < 3000) return;
      ultimoDigitando.current[cid] = agora;
      enviar({ tipo: "digitando", conversa_id: cid });
    },
    [enviar],
  );

  const definirStatus = useCallback(
    (s: "online" | "ocupado") => {
      enviar({ tipo: "status", valor: s });
      if (eu != null) setOnline((o) => ({ ...o, [eu]: s }));
    },
    [enviar, eu],
  );

  const value = useMemo<ComCtx>(
    () => ({
      conectado,
      online,
      meuStatus: (eu != null && online[eu]) || (conectado ? "online" : "offline"),
      definirStatus,
      resumo,
      lidas,
      digitando,
      conversaAberta,
      setConversaAberta,
      avisarDigitando,
      pulso,
      registrarWidget,
    }),
    [conectado, online, eu, definirStatus, resumo, lidas, digitando, conversaAberta, avisarDigitando, pulso, registrarWidget],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
