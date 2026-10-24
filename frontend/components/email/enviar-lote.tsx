"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FastForward, Loader2, Lock, Mails, Send, UserX, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/mayacorp/animated-number";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SwitchRow } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { moeda, numero } from "@/lib/format";
import type { EnvioLoteOut, FiltroNotas, ModeloEmailOut, NfseOut, TipoAnexo } from "@/lib/types";
import { cn } from "@/lib/utils";

import { AviaoDecolando } from "./aviao";
import { AnexosEscolha, emailValido, LinhaEmails, PreviaEmail, TextareaAuto } from "./pecas";

export interface AlvoLote {
  ids?: number[];
  filtro?: FiltroNotas;
  total: number;
}

const ROTULO_VAR: Record<string, string> = {
  nome_tomador: "Nome do cliente",
  numero_nota: "Nº da nota",
  valor: "Valor",
  link_prefeitura: "Link da Prefeitura",
  nome_emissora: "Emissora",
  vencimento: "Vencimento",
  codigo_fatura: "Código da fatura",
};

/** Resolve o modelo com o que a lista já tem; o que o front não sabe fica como {variavel}. */
function aplicar(modelo: string, n: NfseOut | undefined) {
  if (!n) return modelo;
  const v: Record<string, string | null> = {
    nome_tomador: n.tomador_nome,
    numero_nota: String(n.numero),
    valor: moeda(n.valor),
    link_prefeitura: n.link_prefeitura,
    codigo_fatura: n.fatura_codigo,
  };
  return modelo.replace(/\{([a-z_]+)\}/g, (m, k: string) => v[k] ?? m);
}

function Contador({ icone: I, rotulo, valor, tom }: { icone: React.ComponentType<{ className?: string }>; rotulo: string; valor: number; tom: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-card p-4 text-center">
      <I className={cn("mx-auto size-6", tom)} />
      <AnimatedNumber value={valor} className="mt-1 block text-3xl font-semibold" />
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </motion.div>
  );
}

function Resultado({ r, onFechar }: { r: EnvioLoteOut; onFechar: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className={cn("mx-auto mb-3 grid size-16 place-items-center rounded-3xl text-white shadow-xl", r.falhas.length ? "bg-warning shadow-warning/30" : "brand-gradient shadow-brand/30")}
        >
          {r.falhas.length ? <AlertTriangle className="size-8" /> : <CheckCircle2 className="size-8" />}
        </motion.div>
        <h3 className="text-xl font-semibold">
          {r.enviados ? `${numero(r.enviados)} e-mail${r.enviados > 1 ? "s" : ""} enviado${r.enviados > 1 ? "s" : ""}` : "Nenhum e-mail enviado"}
        </h3>
        <p className="text-sm text-muted-foreground">de {numero(r.total)} nota(s) emitida(s) no envio</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Contador icone={CheckCircle2} rotulo="enviados" valor={r.enviados} tom="text-success-ink" />
        <Contador icone={FastForward} rotulo="puladas (já enviadas)" valor={r.puladas} tom="text-info-ink" />
        <Contador icone={UserX} rotulo="sem e-mail" valor={r.sem_email.length} tom="text-warning-ink" />
        <Contador icone={XCircle} rotulo="falhas" valor={r.falhas.length} tom="text-danger-ink" />
      </div>
      {r.sem_email.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/6">
          <p className="border-b border-warning/20 px-4 py-2.5 text-sm font-medium text-warning-ink">
            Clientes sem e-mail no cadastro: complete e reenvie essas notas
          </p>
          <ul className="max-h-56 divide-y divide-warning/15 overflow-y-auto">
            {r.sem_email.map((s) => (
              <li key={s.nfse_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">NFS-e {s.numero}</span>
                <span className="min-w-0 flex-1 truncate">{s.cliente || "Cliente sem nome"}</span>
                <Link href={`/cadastros/clientes?q=${encodeURIComponent(s.cliente)}`} className="shrink-0 text-xs font-medium text-info-ink hover:underline">
                  Abrir cadastro →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.falhas.length > 0 && (
        <div className="rounded-2xl border border-danger/25 bg-danger/5">
          <p className="border-b border-danger/20 px-4 py-2.5 text-sm font-medium text-danger-ink">Falharam ao enviar</p>
          <ul className="max-h-48 divide-y divide-danger/15 overflow-y-auto">
            {r.falhas.map((f) => (
              <li key={f.nfse_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Link href={`/nfse/notas/${f.nfse_id}`} className="font-mono text-xs text-info-ink hover:underline">
                  NFS-e {f.numero}
                </Link>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.erro ?? "Erro desconhecido"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-center">
        <Button onClick={onFechar} className="px-6">
          Concluir
        </Button>
      </div>
    </div>
  );
}

/** Envio em lote: modelo com variáveis, cada nota para o e-mail do próprio cliente. */
export function EnviarEmailsLote({
  open,
  onOpenChange,
  alvo,
  exemplos,
  onConcluido,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  alvo: AlvoLote;
  exemplos: NfseOut[];
  onConcluido?: () => void;
}) {
  const qc = useQueryClient();
  const modelo = useQuery({ queryKey: ["email-modelo"], queryFn: () => api.get<ModeloEmailOut>("/nfse/notas/email/modelo"), enabled: open });
  const m = modelo.data;

  const [extra, setExtra] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [verCc, setVerCc] = useState(false);
  const [verCco, setVerCco] = useState(false);
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [anexos, setAnexos] = useState<TipoAnexo[]>([]);
  const [pular, setPular] = useState(true);
  const [ex, setEx] = useState(0);
  const [aba, setAba] = useState<"escrever" | "previa">("escrever");
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<EnvioLoteOut | null>(null);
  const [voando, setVoando] = useState(false);
  const ativo = useRef<"assunto" | "corpo">("corpo");
  const refAssunto = useRef<HTMLInputElement>(null);
  const refCorpo = useRef<HTMLTextAreaElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- reinicia o compositor com o modelo do servidor */
  useEffect(() => {
    if (!m || !open) return;
    setExtra([]);
    setCc(m.cc);
    setCco(m.cco);
    setVerCc(m.cc.length > 0);
    setVerCco(m.cco.length > 0);
    setAssunto(m.assunto_modelo);
    setCorpo(m.corpo_modelo);
    setAnexos(m.anexos_padrao);
    setPular(true);
    setEx(0);
    setResultado(null);
    setAba("escrever");
  }, [m, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const inserir = (v: string) => {
    const token = `{${v}}`;
    const alvoCampo = ativo.current;
    const el = alvoCampo === "assunto" ? refAssunto.current : refCorpo.current;
    const atual = alvoCampo === "assunto" ? assunto : corpo;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    const novo = atual.slice(0, ini) + token + atual.slice(fim);
    if (alvoCampo === "assunto") setAssunto(novo);
    else setCorpo(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + token.length, ini + token.length);
    });
  };

  const invalidos = [...extra, ...cc, ...cco].filter((e) => !emailValido(e));
  const pode = !!m && assunto.trim().length >= 2 && corpo.trim().length >= 2 && invalidos.length === 0 && alvo.total > 0;

  const enviar = useMutation({
    mutationFn: () =>
      api.post<EnvioLoteOut>("/nfse/notas/enviar-emails", {
        ...(alvo.filtro ? { filtro: alvo.filtro } : { ids: alvo.ids }),
        para_extra: extra,
        cc,
        cco,
        assunto_modelo: assunto.trim(),
        corpo_modelo: corpo,
        anexos,
        pular_ja_enviadas: pular,
      }),
    onSuccess: (r) => {
      setConfirmar(false);
      setVoando(true);
      setTimeout(() => {
        setVoando(false);
        setResultado(r);
      }, 900);
      toast.success(`${numero(r.enviados)} e-mail(s) enviado(s)`);
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["nota"] });
      onConcluido?.();
    },
    onError: () => setConfirmar(false),
  });

  const exemplo = exemplos[Math.min(ex, Math.max(0, exemplos.length - 1))];
  const corpoPrevia = aplicar(corpo, exemplo) + (m?.assinatura ? `\n\n${m.assinatura}` : "");
  const anexosPrevia = anexos.map((t) => ({
    tipo: t,
    nome: t === "pdf" ? `NFSe_${exemplo?.numero ?? "{numero_nota}"}.pdf` : t === "xml" ? `NFSe_${exemplo?.numero ?? "{numero_nota}"}.xml` : `Fatura_${(exemplo?.fatura_codigo ?? "{codigo_fatura}").replace(/^NH\s*/, "").replace(/\W+/g, "_")}.pdf`,
  }));

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !enviar.isPending && onOpenChange(o)}>
        <DialogContent
          className="flex h-[min(94dvh,900px)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && pode && !resultado) {
              e.preventDefault();
              setConfirmar(true);
            }
          }}
        >
          <AviaoDecolando ativo={voando} />
          <div className="flex items-center gap-3 border-b px-5 py-3.5 pr-12">
            <span className="grid size-9 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/30">
              <Mails className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">
                Enviar {numero(alvo.total)} nota{alvo.total > 1 ? "s" : ""} por e-mail
              </DialogTitle>
              <DialogDescription className="text-xs">Cada cliente recebe a própria nota, com o texto montado a partir do modelo.</DialogDescription>
            </div>
          </div>

          {resultado ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Resultado r={resultado} onFechar={() => onOpenChange(false)} />
            </div>
          ) : (
            <>
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
                    {aba === a && <motion.span layoutId="aba-email-lote" className="absolute inset-x-6 -bottom-px h-0.5 rounded-full bg-brand" />}
                  </button>
                ))}
              </div>
              <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
                <div className={cn("min-h-0 overflow-y-auto px-5 py-3", aba !== "escrever" && "hidden lg:block")}>
                  {!m ? (
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
                        <span className="truncate text-muted-foreground">{m.remetente}</span>
                      </div>
                      <div className="flex min-h-10 items-center gap-1.5 border-b px-1 text-sm">
                        <span className="w-10 shrink-0 text-muted-foreground">Para</span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
                          <Lock className="size-3" /> o e-mail de cada cliente
                        </span>
                        <span className="ml-auto flex gap-2">
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
                        </span>
                      </div>
                      <LinhaEmails rotulo="Também" valor={extra} onChange={setExtra} placeholder="também enviar para… (opcional)" />
                      {verCc && <LinhaEmails rotulo="Cc" valor={cc} onChange={setCc} autoFocus={!cc.length} />}
                      {verCco && <LinhaEmails rotulo="Cco" valor={cco} onChange={setCco} autoFocus={!cco.length} />}

                      <div className="flex flex-wrap items-center gap-1.5 pt-3">
                        <span className="mr-1 text-xs text-muted-foreground">Inserir:</span>
                        {m.variaveis.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => inserir(v)}
                            title={`Inserir {${v}}`}
                            className="rounded-md bg-brand/10 px-2 py-0.5 text-[11px] text-info-ink transition hover:bg-brand/20"
                          >
                            {ROTULO_VAR[v] ?? v}
                          </button>
                        ))}
                      </div>

                      <div className="flex min-h-10 items-center gap-1.5 border-b px-1">
                        <label htmlFor="lote-assunto" className="w-14 shrink-0 text-sm text-muted-foreground">
                          Assunto
                        </label>
                        <input
                          id="lote-assunto"
                          ref={refAssunto}
                          value={assunto}
                          onFocus={() => (ativo.current = "assunto")}
                          onChange={(e) => setAssunto(e.target.value)}
                          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none"
                          maxLength={300}
                        />
                      </div>
                      <div className="pt-3">
                        <TextareaAuto
                          ref={refCorpo}
                          value={corpo}
                          onFocus={() => (ativo.current = "corpo")}
                          onChange={(e) => setCorpo(e.target.value)}
                          aria-label="Modelo do corpo do e-mail"
                          className="min-h-40 font-mono text-[13px]"
                          max={380}
                        />
                      </div>
                      {m.assinatura && (
                        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
                          <span className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold tracking-wider uppercase">
                            <Lock className="size-3" /> Assinatura (Configurações › Identidade)
                          </span>
                          {m.assinatura}
                        </div>
                      )}

                      <div className="space-y-3 border-t pt-3">
                        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Anexos de cada nota</p>
                        <AnexosEscolha
                          anexos={[{ tipo: "pdf" }, { tipo: "xml" }, { tipo: "fatura" }]}
                          marcados={anexos}
                          onAlternar={(t) => setAnexos((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))}
                        />
                        <SwitchRow titulo="Pular notas já enviadas" descricao="Quem já recebeu essa nota por e-mail não recebe de novo.">
                          <Switch checked={pular} onCheckedChange={setPular} />
                        </SwitchRow>
                      </div>
                    </div>
                  )}
                </div>

                <div className={cn("min-h-0 overflow-y-auto border-l bg-muted/30 p-4 lg:p-5", aba !== "previa" && "hidden lg:block")}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Exemplo com uma nota</p>
                    {exemplos.length > 1 && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon-xs" onClick={() => setEx((i) => (i - 1 + exemplos.length) % exemplos.length)} aria-label="Exemplo anterior">
                          <ChevronLeft />
                        </Button>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Math.min(ex, exemplos.length - 1) + 1}/{exemplos.length}
                        </span>
                        <Button variant="ghost" size="icon-xs" onClick={() => setEx((i) => (i + 1) % exemplos.length)} aria-label="Próximo exemplo">
                          <ChevronRight />
                        </Button>
                      </div>
                    )}
                  </div>
                  {m ? (
                    <AnimatePresence mode="wait">
                      <motion.div key={exemplo?.id ?? "x"} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }}>
                        <PreviaEmail
                          de={m.remetente}
                          para={[exemplo ? `e-mail de ${exemplo.tomador_nome}` : "e-mail de cada cliente", ...extra].join(", ")}
                          cc={cc}
                          assunto={aplicar(assunto, exemplo)}
                          corpo={corpoPrevia}
                          anexos={anexosPrevia}
                          variaveis
                        />
                      </motion.div>
                    </AnimatePresence>
                  ) : (
                    <Skeleton className="h-96 rounded-2xl" />
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Os campos em <span className="rounded bg-brand/12 px-1 font-mono text-info-ink">{"{destaque}"}</span> são preenchidos nota a nota no envio.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t bg-card px-5 py-3">
                <p className="text-sm text-muted-foreground">
                  {alvo.filtro ? "Todas as notas do filtro" : `${numero(alvo.total)} nota(s) selecionada(s)`}
                  {invalidos.length > 0 && <span className="ml-2 text-danger-ink">E-mail inválido: {invalidos[0]}</span>}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviar.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={() => setConfirmar(true)} disabled={!pode || enviar.isPending || voando} className="group h-9 brand-gradient px-5 text-white shadow-lg shadow-brand/30">
                    {enviar.isPending ? <Loader2 className="animate-spin" /> : <Send className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />}
                    Enviar {numero(alvo.total)} e-mail{alvo.total > 1 ? "s" : ""}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={setConfirmar}
        titulo={`Enviar ${numero(alvo.total)} e-mail${alvo.total > 1 ? "s" : ""}?`}
        descricao={
          <>
            Cada cliente recebe a própria nota{anexos.length ? ` com ${anexos.length} anexo(s)` : " sem anexos"}.
            {pular ? " Notas já enviadas serão puladas." : " Notas já enviadas serão enviadas de novo."}
            {cc.length > 0 && ` Cópia para ${cc.join(", ")}.`}
          </>
        }
        confirmar="Enviar agora"
        carregando={enviar.isPending}
        onConfirm={() => enviar.mutate()}
      />
    </>
  );
}
