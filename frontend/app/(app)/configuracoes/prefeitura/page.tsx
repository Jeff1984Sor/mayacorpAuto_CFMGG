"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, FlaskConical, Landmark, Loader2, Lock, Rocket, ShieldAlert, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { MODO_INFO } from "@/components/mayacorp/modo-badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePrefeitura } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import type { ConfigPrefeituraOut, ModoPrefeitura } from "@/lib/types";
import { cn } from "@/lib/utils";

const FRASE = "EMITIR NOTAS REAIS";

const MODOS: { modo: ModoPrefeitura; icone: React.ComponentType<{ className?: string }>; titulo: string; texto: string; itens: string[] }[] = [
  {
    modo: "simulado",
    icone: Sparkles,
    titulo: "Simulação",
    texto: "Para treinar e demonstrar. O robô faz tudo — lê, valida, assina e gera PDF — sem falar com a Prefeitura.",
    itens: ["Nenhuma chamada externa", "Notas com selo “Simulação”", "Sem valor fiscal"],
  },
  {
    modo: "teste",
    icone: FlaskConical,
    titulo: "Teste",
    texto: "Envia o lote ao serviço de validação do layout 2. A Prefeitura confere tudo, mas não gera nota.",
    itens: ["Usa o certificado A1 de verdade", "Valida schema e regras", "Não gera NFS-e"],
  },
  {
    modo: "producao",
    icone: Rocket,
    titulo: "Produção",
    texto: "Emissão real no Web Service da Prefeitura de São Paulo. Cada lote é testado antes e depois transmitido.",
    itens: ["Notas com valor fiscal", "Lotes de até 50 RPS", "Sem duplicidade (idempotência)"],
  },
];

export default function PrefeituraPage() {
  const qc = useQueryClient();
  const q = usePrefeitura();
  const [confirmar, setConfirmar] = useState(false);
  const [frase, setFrase] = useState("");

  const salvar = useMutation({
    mutationFn: (body: { modo: ModoPrefeitura; confirmacao?: string }) => api.put<ConfigPrefeituraOut>("/config/prefeitura", body),
    onSuccess: (r) => {
      qc.setQueryData(["prefeitura"], r);
      qc.invalidateQueries({ queryKey: ["painel"] });
      qc.invalidateQueries({ queryKey: ["emissoras"] });
      toast.success(`Modo alterado para ${MODO_INFO[r.modo].rotulo}`);
      setConfirmar(false);
      setFrase("");
    },
  });

  if (!q.data) return <Skeleton className="h-80 rounded-2xl" />;
  const atual = q.data;

  const escolher = (m: ModoPrefeitura) => {
    if (m === atual.modo || salvar.isPending) return;
    if (m === "producao") setConfirmar(true);
    else salvar.mutate({ modo: m });
  };

  return (
    <div className="space-y-6">
      <div className="card-surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl brand-gradient text-white shadow-lg shadow-brand/25">
          <Landmark className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Integração com a Prefeitura de São Paulo</h3>
          <p className="text-sm text-muted-foreground">
            Web Service SOAP da Nota Fiscal Paulistana · layout 2 (ISS + IBS + CBS) · certificado A1 com TLS mútuo.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Servidor</dt>
          <dd className="font-medium uppercase">{atual.ambiente}</dd>
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="max-w-64 truncate font-mono text-xs" title={atual.endpoint}>
            {atual.endpoint}
          </dd>
        </dl>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {MODOS.map((m, i) => {
          const permitido = atual.modos_permitidos.includes(m.modo);
          const ativo = atual.modo === m.modo;
          const info = MODO_INFO[m.modo];
          const card = (
            <motion.button
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              disabled={!permitido || salvar.isPending}
              onClick={() => escolher(m.modo)}
              className={cn(
                "group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card p-5 text-left transition-all",
                ativo && "border-transparent ring-2 ring-brand shadow-xl shadow-brand/15",
                !ativo && permitido && "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg",
                !permitido && "cursor-not-allowed opacity-55",
              )}
            >
              {ativo && <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-brand/20 blur-3xl" />}
              <div className="relative flex items-start justify-between">
                <div
                  className={cn(
                    "grid size-11 place-items-center rounded-xl ring-1 ring-inset",
                    info.classe,
                  )}
                >
                  <m.icone className="size-5" />
                </div>
                {ativo ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground">
                    <Check className="size-3.5" /> Em uso
                  </span>
                ) : !permitido ? (
                  <Lock className="size-4 text-muted-foreground" />
                ) : salvar.isPending && salvar.variables?.modo === m.modo ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
              </div>
              <h3 className="relative mt-4 text-lg font-semibold">{m.titulo}</h3>
              <p className="relative mt-1 text-sm text-muted-foreground">{m.texto}</p>
              <ul className="relative mt-4 space-y-1.5 border-t pt-4 text-sm">
                {m.itens.map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span className={cn("size-1.5 rounded-full", info.ponto)} />
                    {x}
                  </li>
                ))}
              </ul>
            </motion.button>
          );
          return permitido ? (
            <div key={m.modo}>{card}</div>
          ) : (
            <Tooltip key={m.modo}>
              <TooltipTrigger render={<div />}>{card}</TooltipTrigger>
              <TooltipContent>Disponível só no servidor de produção</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldAlert className="size-3.5" /> Sair da simulação exige um certificado A1 ativo. Toda troca de modo fica registrada na auditoria.
      </p>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => {
          setConfirmar(o);
          if (!o) setFrase("");
        }}
        titulo="Ligar a emissão real?"
        descricao="A partir de agora, cada lote emitido gera notas fiscais com valor legal na Prefeitura de São Paulo. Cancelamentos seguem os prazos da Prefeitura."
        confirmar="Ligar emissão real"
        destrutivo
        desabilitado={frase.trim().toUpperCase() !== FRASE}
        carregando={salvar.isPending}
        onConfirm={() => salvar.mutate({ modo: "producao", confirmacao: frase.trim() })}
      >
        <div className="space-y-2">
          <p className="text-sm">
            Para confirmar, digite <strong className="font-mono">{FRASE}</strong>:
          </p>
          <Input
            value={frase}
            onChange={(e) => setFrase(e.target.value)}
            placeholder={FRASE}
            className={cn("font-mono", frase && frase.trim().toUpperCase() === FRASE && "border-danger ring-3 ring-danger/20")}
            autoFocus
            autoComplete="off"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
