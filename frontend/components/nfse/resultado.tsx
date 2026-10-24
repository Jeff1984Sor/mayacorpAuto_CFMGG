"use client";

import confetti from "canvas-confetti";
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Mail, ReceiptText, RotateCcw, Wrench, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef } from "react";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { Mono } from "@/components/mayacorp/brand";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { duracao, moeda, numero, toNum } from "@/lib/format";
import type { LoteDetalhe, RpsOut } from "@/lib/types";

import { useZipFaturas } from "./acoes-fatura";
import { useAcoesLote } from "./acoes-lote";
import { ProblemaItem } from "./problema";

export function soltarConfete() {
  const cores = ["#1e2d6b", "#7c8fff", "#1a8f5e", "#f5a623"];
  const disparar = (x: number, angle: number) =>
    confetti({ particleCount: 70, spread: 62, startVelocity: 48, angle, origin: { x, y: 0.7 }, colors: cores, scalar: 0.9, disableForReducedMotion: true });
  disparar(0.15, 60);
  disparar(0.85, 120);
}

export function Resultado({ lote, onCorrigir }: { lote: LoteDetalhe; onCorrigir?: (r: RpsOut) => void }) {
  const { isOperador } = useAuth();
  const acoes = useAcoesLote(lote.id, lote.numero);
  const zipFaturas = useZipFaturas();
  const rejeitadas = lote.rps.filter((r) => r.status === "rejeitado");
  const emitidas = lote.rps.filter((r) => r.status === "emitido");
  const valorEmitido = emitidas.reduce((a, r) => a + toNum(r.valor), 0);
  const perfeito = lote.qtd_rejeitadas === 0 && lote.qtd_emitidas > 0;
  const soltou = useRef(false);
  const tempo =
    lote.iniciado_em && lote.concluido_em ? (new Date(lote.concluido_em).getTime() - new Date(lote.iniciado_em).getTime()) / 1000 : 0;

  useEffect(() => {
    if (perfeito && !soltou.current) {
      soltou.current = true;
      soltarConfete();
    }
  }, [perfeito]);

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-3xl bg-dark-maya p-6 text-white sm:p-8"
      >
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className={`absolute -top-24 -right-16 size-80 rounded-full blur-[90px] ${perfeito ? "bg-success/50" : "bg-warning/40"}`} />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-white/60">
              Lote <Mono>#{String(lote.numero).padStart(4, "0")}</Mono> · {lote.emissora_nome}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              {perfeito ? "Tudo emitido! 🎉" : lote.qtd_emitidas > 0 ? "Emissão concluída com pendências" : "Nenhuma nota emitida"}
            </h2>
            <p className="mt-1 text-white/60">
              {numero(lote.qtd_emitidas)} notas · {moeda(valorEmitido)}
              {tempo > 0 && ` · em ${duracao(tempo)}`}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="min-w-32 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <CheckCircle2 className="size-5 text-success-ink" />
              <AnimatedNumber value={lote.qtd_emitidas} className="mt-2 block text-3xl font-semibold num" />
              <p className="text-xs text-white/55">emitidas</p>
            </div>
            <div className="min-w-32 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
              <XCircle className="size-5 text-danger-ink" />
              <AnimatedNumber value={lote.qtd_rejeitadas} className="mt-2 block text-3xl font-semibold num" />
              <p className="text-xs text-white/55">rejeitadas</p>
            </div>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2">
          <Button
            onClick={() => acoes.zip.mutate()}
            disabled={acoes.zip.isPending || lote.qtd_emitidas === 0}
            className="h-10 bg-white px-4 text-navy hover:bg-white/90"
          >
            {acoes.zip.isPending ? <Loader2 className="animate-spin" /> : <Download />} Baixar ZIP (PDF + XML)
          </Button>
          {isOperador && (
            <Button
              onClick={() => acoes.emails.mutate()}
              disabled={acoes.emails.isPending || lote.qtd_emitidas === 0}
              variant="outline"
              className="h-10 border-white/20 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
            >
              {acoes.emails.isPending ? <Loader2 className="animate-spin" /> : <Mail />} Enviar por e-mail aos tomadores
            </Button>
          )}
          <Button
            onClick={() => zipFaturas.mutate({ lote_id: lote.id })}
            disabled={zipFaturas.isPending || lote.qtd_emitidas === 0}
            variant="outline"
            className="h-10 border-white/20 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
          >
            {zipFaturas.isPending ? <Loader2 className="animate-spin" /> : <ReceiptText />} Baixar faturas (ZIP)
          </Button>
          <Button
            onClick={() => acoes.conferencia.mutate()}
            disabled={acoes.conferencia.isPending}
            variant="outline"
            className="h-10 border-white/20 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
          >
            {acoes.conferencia.isPending ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Exportar planilha de conferência
          </Button>
        </div>
      </motion.div>

      {rejeitadas.length > 0 && (
        <div className="card-surface overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <XCircle className="size-4 text-danger-ink" /> {rejeitadas.length} rejeitada(s) pela Prefeitura
              </h3>
              <p className="text-sm text-muted-foreground">O que passou já está emitido. Corrija os itens abaixo e reenvie só eles.</p>
            </div>
            {isOperador && (
              <Button onClick={() => acoes.reprocessar.mutate()} disabled={acoes.reprocessar.isPending}>
                {acoes.reprocessar.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reenviar rejeitadas
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {rejeitadas.map((r) => {
              return (
                <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger-ink">
                    <XCircle className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-sm font-medium">
                      RPS <Mono>{r.numero}</Mono> · {r.tomador_nome} · <Mono>{moeda(r.valor)}</Mono>
                    </p>
                    {r.erros.length ? (
                      r.erros.map((e, k) => <ProblemaItem key={k} p={e} semCaixa className="text-muted-foreground" />)
                    ) : (
                      <p className="text-sm text-muted-foreground">Rejeitado pela Prefeitura.</p>
                    )}
                  </div>
                  {isOperador && onCorrigir && (
                    <Button variant="outline" size="sm" onClick={() => onCorrigir(r)}>
                      <Wrench /> Corrigir
                    </Button>
                  )}

                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
