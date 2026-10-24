"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronDown, History, Loader2, Mail, Send, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";
import type { EmailPreviaOut, TipoAnexo } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AviaoDecolando } from "./aviao";
import { AnexosEscolha, emailValido, LinhaEmails, PreviaEmail, TextareaAuto } from "./pecas";

const previaKey = (id: number) => ["email-previa", id] as const;

function Historico({ envios }: { envios: EmailPreviaOut["envios"] }) {
  if (!envios.length) return <p className="px-1 py-2 text-sm text-muted-foreground">Esta nota ainda não foi enviada por e-mail.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {[...envios].reverse().map((e, i) => {
        const ok = e.status === "enviado";
        return (
          <li key={i} className="flex gap-3 px-3 py-2.5 text-sm">
            {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-ink" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger-ink" />}
            <div className="min-w-0 flex-1">
              <p className="truncate">
                <span className="font-medium">{e.destinatarios.join(", ")}</span>
                {e.cc && e.cc.length > 0 && <span className="text-muted-foreground"> · Cc {e.cc.join(", ")}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {dataHora(e.enviado_em)}
                {e.usuario_nome && ` · por ${e.usuario_nome}`}
                {!ok && e.erro && <span className="text-danger-ink"> · {e.erro}</span>}
              </p>
            </div>
            <span className={cn("shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-medium", ok ? "bg-success/10 text-success-ink" : "bg-danger/10 text-danger-ink")}>
              {ok ? "Enviado" : "Falhou"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Compositor de e-mail de UMA nota (Para/Cc/Cco, assunto, corpo, anexos, pré-visualização ao vivo). */
export function EnviarEmailNota({
  nfseId,
  numero,
  open,
  onOpenChange,
}: {
  nfseId: number | null;
  numero?: number | string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: previaKey(nfseId ?? 0),
    queryFn: () => api.get<EmailPreviaOut>(`/nfse/notas/${nfseId}/email/previa`),
    enabled: open && !!nfseId,
    staleTime: 0,
  });
  const p = q.data;

  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [verCc, setVerCc] = useState(false);
  const [verCco, setVerCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [anexos, setAnexos] = useState<TipoAnexo[]>([]);
  const [salvar, setSalvar] = useState(true);
  const [aba, setAba] = useState<"escrever" | "previa">("escrever");
  const [historico, setHistorico] = useState(false);
  const [voando, setVoando] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o rascunho com a prévia do servidor */
  useEffect(() => {
    if (!p || !open) return;
    setPara(p.para);
    setCc(p.cc);
    setCco(p.cco);
    setVerCc(p.cc.length > 0);
    setVerCco(p.cco.length > 0);
    setAssunto(p.assunto);
    setCorpo(p.corpo);
    setAnexos(p.anexos.filter((a) => a.padrao).map((a) => a.tipo));
    setSalvar(true);
    setAba("escrever");
    setHistorico(false);
  }, [p, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const novos = useMemo(() => para.filter((e) => emailValido(e) && !(p?.emails_cliente ?? []).includes(e)), [para, p]);
  const invalidos = [...para, ...cc, ...cco].filter((e) => !emailValido(e));
  const podeEnviar = !!p && para.length > 0 && invalidos.length === 0 && assunto.trim().length > 0;

  const enviar = useMutation({
    mutationFn: () =>
      api.post<{ mensagem: string }>(`/nfse/notas/${nfseId}/enviar-email`, {
        destinatarios: para,
        cc,
        cco,
        assunto: assunto.trim(),
        corpo,
        anexos,
        salvar_no_cliente: novos.length > 0 && salvar,
      }),
    onSuccess: (r) => {
      setVoando(true);
      toast.success(r?.mensagem ?? "E-mail enviado", { description: `Para ${para.join(", ")}` });
      qc.invalidateQueries({ queryKey: previaKey(nfseId ?? 0) });
      qc.invalidateQueries({ queryKey: ["nota"] });
      qc.invalidateQueries({ queryKey: ["notas"] });
      if (novos.length && salvar) qc.invalidateQueries({ queryKey: ["tomadores"] });
      setTimeout(() => {
        setVoando(false);
        onOpenChange(false);
      }, 950);
    },
  });

  const tentarEnviar = () => {
    if (!podeEnviar) {
      if (!para.length) toast.error("Informe ao menos um destinatário.");
      else if (invalidos.length) toast.error(`E-mail inválido: ${invalidos[0]}`);
      return;
    }
    if (!enviar.isPending) enviar.mutate();
  };

  const anexosPrevia = (p?.anexos ?? []).filter((a) => anexos.includes(a.tipo));
  const linkCc = (
    <>
      {!verCc && (
        <button type="button" onClick={() => setVerCc(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          Cc
        </button>
      )}
      {!verCco && (
        <button type="button" onClick={() => setVerCco(true)} className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          Cco
        </button>
      )}
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !enviar.isPending && onOpenChange(o)}>
      <DialogContent
        className="flex h-[min(94dvh,880px)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            tentarEnviar();
          }
        }}
      >
        <AviaoDecolando ativo={voando} />
        <div className="flex items-center gap-3 border-b px-5 py-3.5 pr-12">
          <span className="grid size-9 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/30">
            <Mail className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-base">Enviar NFS-e {numero ?? ""} por e-mail</DialogTitle>
            <DialogDescription className="text-xs">Revise destinatários, texto e anexos. O cliente recebe exatamente o que está à direita.</DialogDescription>
          </div>
        </div>

        {/* abas no celular */}
        <div className="flex border-b lg:hidden" role="tablist">
          {(["escrever", "previa"] as const).map((a) => (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={aba === a}
              onClick={() => setAba(a)}
              className={cn("relative flex-1 py-2.5 text-sm font-medium text-muted-foreground", aba === a && "text-foreground")}
            >
              {a === "escrever" ? "Escrever" : "Pré-visualizar"}
              {aba === a && <motion.span layoutId="aba-email" className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
          {/* edição */}
          <div className={cn("min-h-0 overflow-y-auto px-5 py-3", aba !== "escrever" && "hidden lg:block")}>
            {!p ? (
              <div className="space-y-3 py-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
                <Skeleton className="h-48" />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex min-h-10 items-center gap-1.5 border-b px-1 text-sm">
                  <span className="w-10 shrink-0 text-muted-foreground">De</span>
                  <span className="truncate text-muted-foreground">{p.remetente}</span>
                </div>
                <LinhaEmails id="email-para" rotulo="Para" valor={para} onChange={setPara} sugestoes={p.emails_cliente} placeholder="e-mail do cliente" acao={linkCc} />
                {verCc && <LinhaEmails id="email-cc" rotulo="Cc" valor={cc} onChange={setCc} sugestoes={p.emails_cliente} autoFocus={!cc.length} />}
                {verCco && <LinhaEmails id="email-cco" rotulo="Cco" valor={cco} onChange={setCco} sugestoes={p.emails_cliente} autoFocus={!cco.length} />}
                <div className="flex min-h-10 items-center gap-1.5 border-b px-1">
                  <label htmlFor="email-assunto" className="w-14 shrink-0 text-sm text-muted-foreground">
                    Assunto
                  </label>
                  <input
                    id="email-assunto"
                    value={assunto}
                    onChange={(e) => setAssunto(e.target.value)}
                    className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                    maxLength={300}
                  />
                </div>

                <AnimatePresence>
                  {novos.length > 0 && p.cliente_id && (
                    <motion.label
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl border border-brand/25 bg-brand/6 px-3 py-2 text-sm"
                    >
                      <Checkbox checked={salvar} onCheckedChange={(v) => setSalvar(!!v)} />
                      <span>
                        Salvar {novos.length === 1 ? <strong>{novos[0]}</strong> : `${novos.length} e-mails novos`} no cadastro do cliente
                      </span>
                    </motion.label>
                  )}
                </AnimatePresence>

                <div className="pt-3">
                  <TextareaAuto value={corpo} onChange={(e) => setCorpo(e.target.value)} aria-label="Corpo do e-mail" className="min-h-48" max={460} />
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Anexos</p>
                  <AnexosEscolha anexos={p.anexos} marcados={anexos} onAlternar={(t) => setAnexos((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))} />
                  {anexos.length === 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-warning-ink">
                      <AlertTriangle className="size-3.5" /> Sem anexos: o cliente recebe só o texto e o link da Prefeitura.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* pré-visualização */}
          <div className={cn("min-h-0 overflow-y-auto border-l bg-muted/30 p-4 lg:p-5", aba !== "previa" && "hidden lg:block")}>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Como o cliente vai ver</p>
            {p ? (
              <PreviaEmail de={p.remetente} para={para.join(", ")} cc={cc} assunto={assunto} corpo={corpo} anexos={anexosPrevia} />
            ) : (
              <Skeleton className="h-96 rounded-2xl" />
            )}
          </div>
        </div>

        {/* histórico + enviar */}
        <AnimatePresence initial={false}>
          {historico && p && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="max-h-56 overflow-y-auto border-t bg-muted/20 px-5 py-3"
            >
              <Historico envios={p.envios} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-center justify-between gap-3 border-t bg-card px-5 py-3">
          <button
            type="button"
            onClick={() => setHistorico((h) => !h)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={historico}
            disabled={!p}
          >
            <History className="size-4" />
            Histórico de envios{p ? ` (${p.envios.length})` : ""}
            <ChevronDown className={cn("size-4 transition-transform", historico && "rotate-180")} />
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              <kbd className="font-mono">Ctrl+Enter</kbd> envia
            </span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviar.isPending}>
              Cancelar
            </Button>
            <Tooltip>
              <TooltipTrigger render={<span />}>
                <Button onClick={tentarEnviar} disabled={!podeEnviar || enviar.isPending || voando} className="group h-9 brand-gradient px-5 text-white shadow-lg shadow-brand/30">
                  {enviar.isPending ? <Loader2 className="animate-spin" /> : <Send className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
                  Enviar
                </Button>
              </TooltipTrigger>
              {!podeEnviar && p && (
                <TooltipContent>{!para.length ? "Informe ao menos um destinatário" : invalidos.length ? `E-mail inválido: ${invalidos[0]}` : "Preencha o assunto"}</TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Botão ✉️ padrão (com tooltip) que abre o compositor da nota. */
export function BotaoEmailNota({ nfseId, numero, tamanho = "icon-sm", rotulo }: { nfseId: number; numero?: number | string; tamanho?: "icon-sm" | "sm" | "default"; rotulo?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={rotulo ? "outline" : "ghost"}
              size={rotulo ? (tamanho === "icon-sm" ? "default" : tamanho) : "icon-sm"}
              onClick={(e) => {
                e.stopPropagation();
                setAberto(true);
              }}
              aria-label="Enviar por e-mail"
              className={cn(!rotulo && "text-muted-foreground hover:text-info-ink")}
            />
          }
        >
          <Mail />
          {rotulo}
        </TooltipTrigger>
        <TooltipContent>Enviar por e-mail</TooltipContent>
      </Tooltip>
      {aberto && (
        // eventos do diálogo (portal) não podem subir até a linha clicável da tabela
        <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <EnviarEmailNota nfseId={nfseId} numero={numero} open={aberto} onOpenChange={setAberto} />
        </span>
      )}
    </>
  );
}
