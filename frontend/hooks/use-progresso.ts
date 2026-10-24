"use client";

import { useEffect, useRef, useState } from "react";

import { api, sseUrl } from "@/lib/api";
import type { LoteDetalhe, ProgressoOut, StatusLote } from "@/lib/types";

const FINAIS: StatusLote[] = ["concluido", "parcial", "falhou", "descartado"];
export const loteFinalizado = (s: StatusLote) => FINAIS.includes(s);

function deLote(l: LoteDetalhe): ProgressoOut {
  return {
    lote_id: l.id,
    status: l.status,
    sublotes_total: l.sublotes_total,
    sublotes_feitos: l.sublotes_feitos,
    qtd: l.qtd,
    qtd_emitidas: l.qtd_emitidas,
    qtd_rejeitadas: l.qtd_rejeitadas,
    percentual: l.sublotes_total ? (l.sublotes_feitos / l.sublotes_total) * 100 : 0,
    mensagem: l.mensagem,
    eventos: l.eventos,
  };
}

/**
 * Acompanha o progresso de um lote em tempo real via SSE (/progresso?token=).
 * Se o EventSource falhar, cai para polling a cada 2s.
 */
export function useProgresso(loteId: number | null, onFim?: (p: ProgressoOut) => void) {
  const [p, setP] = useState<ProgressoOut | null>(null);
  const [conectado, setConectado] = useState(false);
  const fim = useRef(onFim);
  useEffect(() => {
    fim.current = onFim;
  });

  useEffect(() => {
    if (!loteId) return;
    let encerrado = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let es: EventSource | null = null;

    const terminar = (x: ProgressoOut) => {
      if (encerrado) return;
      encerrado = true;
      es?.close();
      if (poll) clearInterval(poll);
      setConectado(false);
      fim.current?.(x);
    };

    const iniciarPolling = () => {
      if (poll || encerrado) return;
      const tick = async () => {
        try {
          const l = await api.get<LoteDetalhe>(`/nfse/lotes/${loteId}`);
          const x = deLote(l);
          setP(x);
          if (loteFinalizado(x.status)) terminar(x);
        } catch {
          /* tenta de novo */
        }
      };
      void tick();
      poll = setInterval(tick, 2000);
    };

    try {
      es = new EventSource(sseUrl(`/nfse/lotes/${loteId}/progresso`));
      es.onopen = () => setConectado(true);
      es.addEventListener("progresso", (ev) => {
        const x = JSON.parse((ev as MessageEvent).data) as ProgressoOut;
        setP(x);
        if (loteFinalizado(x.status)) terminar(x);
      });
      es.addEventListener("fim", (ev) => {
        const raw = (ev as MessageEvent).data;
        let x: ProgressoOut | null = null;
        try {
          x = raw ? (JSON.parse(raw) as ProgressoOut) : null;
        } catch {
          /* fim sem payload */
        }
        if (x) {
          setP(x);
          terminar(x);
        } else {
          es?.close();
          iniciarPolling();
        }
      });
      es.onerror = () => {
        if (encerrado) return;
        es?.close();
        setConectado(false);
        iniciarPolling();
      };
    } catch {
      iniciarPolling();
    }

    return () => {
      encerrado = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [loteId]);

  return { progresso: p, conectado };
}
