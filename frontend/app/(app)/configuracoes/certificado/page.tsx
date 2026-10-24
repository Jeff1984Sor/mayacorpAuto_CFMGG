"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileKey2,
  KeyRound,
  Loader2,
  Lock,
  PlugZap,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { data, dataHora, documento, relativo, tamanhoArquivo } from "@/lib/format";
import type { CertificadoOut, TesteConexaoOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function tom(dias: number) {
  return dias < 0 ? "danger" : dias <= 30 ? "warning" : "success";
}

function Contagem({ dias, total }: { dias: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, dias / Math.max(total, 1)));
  const t = tom(dias);
  const cor = t === "danger" ? "#c94343" : t === "warning" ? "#f5a623" : "#1a8f5e";
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--muted)" strokeWidth="9" />
        <motion.circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={cor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-3xl font-semibold num">{Math.max(0, dias)}</p>
          <p className="text-[11px] text-muted-foreground">{dias < 0 ? "vencido" : dias === 1 ? "dia restante" : "dias restantes"}</p>
        </div>
      </div>
    </div>
  );
}

function Upload({ onEnviado }: { onEnviado: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const dz = useDropzone({
    multiple: false,
    accept: { "application/x-pkcs12": [".pfx", ".p12"] },
    onDrop: (f) => f[0] && setArquivo(f[0]),
    onDropRejected: () => toast.error("Envie o certificado A1 (.pfx ou .p12)."),
  });
  const enviar = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("arquivo", arquivo!);
      fd.append("senha", senha);
      return api.post<CertificadoOut>("/config/certificados", fd);
    },
    onSuccess: (c) => {
      toast.success(`Certificado de ${c.titular} carregado`);
      setArquivo(null);
      setSenha("");
      onEnviado();
    },
  });
  return (
    <div className="card-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <UploadCloud className="size-4 text-info-ink" /> Enviar certificado A1
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">O arquivo e a senha são criptografados e nunca mais exibidos nem baixados.</p>
      <div
        {...dz.getRootProps()}
        className={cn(
          "grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors",
          dz.isDragActive ? "border-brand bg-brand/5" : "hover:border-brand/50",
        )}
      >
        <input {...dz.getInputProps()} />
        {arquivo ? (
          <div className="flex items-center gap-3">
            <FileKey2 className="size-8 text-info-ink" />
            <div className="text-left">
              <p className="font-medium">{arquivo.name}</p>
              <p className="text-xs text-muted-foreground">{tamanhoArquivo(arquivo.size)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setArquivo(null);
              }}
              aria-label="Remover"
            >
              <X />
            </Button>
          </div>
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <KeyRound className="size-6" />
            Arraste o .pfx / .p12 ou clique para escolher
          </span>
        )}
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          enviar.mutate();
        }}
      >
        <Field label="Senha do certificado" className="flex-1">
          <div className="relative">
            <Lock className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className="h-9 pl-9" autoComplete="new-password" />
          </div>
        </Field>
        <Button type="submit" disabled={!arquivo || !senha || enviar.isPending} className="h-9">
          {enviar.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Ler e guardar
        </Button>
      </form>
    </div>
  );
}

export default function CertificadoPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["certificados"], queryFn: () => api.get<CertificadoOut[]>("/config/certificados") });
  const [ativar, setAtivar] = useState<CertificadoOut | null>(null);
  const [teste, setTeste] = useState<TesteConexaoOut | null>(null);
  const certs = q.data ?? [];
  const ativo = certs.find((c) => c.ativo) ?? null;
  const total = ativo ? (new Date(ativo.valido_ate).getTime() - new Date(ativo.valido_de).getTime()) / 86400000 : 365;

  const testar = useMutation({
    mutationFn: (id: number) => api.post<TesteConexaoOut>(`/config/certificados/${id}/testar`),
    onSuccess: (r) => {
      setTeste(r);
      if (r.ok) toast.success(r.mensagem);
      else toast.error(r.mensagem);
      qc.invalidateQueries({ queryKey: ["certificados"] });
    },
  });
  const ativarMut = useMutation({
    mutationFn: (id: number) => api.post(`/config/certificados/${id}/ativar`),
    onSuccess: () => {
      toast.success("Certificado ativado — a troca foi confirmada");
      setAtivar(null);
      qc.invalidateQueries({ queryKey: ["certificados"] });
      qc.invalidateQueries({ queryKey: ["emissoras"] });
    },
  });

  if (q.isPending) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        {ativo ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-surface overflow-hidden">
            <div className="brand-gradient h-1.5" />
            <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
              <Contagem dias={ativo.dias_restantes} total={total} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="ativo" label="Em uso" />
                  {ativo.dias_restantes <= 30 && (
                    <StatusBadge tom={tom(ativo.dias_restantes)} label={ativo.dias_restantes < 0 ? "Vencido" : "Vence em breve"} />
                  )}
                </div>
                <h3 className="mt-2 truncate text-xl font-semibold">{ativo.titular}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">CNPJ</dt>
                    <dd className="font-medium">
                      <Mono>{documento(ativo.cnpj)}</Mono>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Validade</dt>
                    <dd className="font-medium">
                      <Mono>
                        {data(ativo.valido_de)} → {data(ativo.valido_ate)}
                      </Mono>
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Emissor</dt>
                    <dd className="truncate font-medium">{ativo.emissor}</dd>
                  </div>
                </dl>
              </div>
            </div>
            <div className="flex flex-col gap-3 border-t bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {ativo.ultimo_teste_em ? (
                  <>
                    Último teste {relativo(ativo.ultimo_teste_em)}:{" "}
                    <span className={ativo.ultimo_teste_ok ? "text-success-ink" : "text-danger-ink"}>
                      {ativo.ultimo_teste_ok ? "conexão OK" : (ativo.ultimo_teste_msg ?? "falhou")}
                    </span>
                  </>
                ) : (
                  "Ainda não testado com a Prefeitura."
                )}
              </p>
              <Button onClick={() => testar.mutate(ativo.id)} disabled={testar.isPending}>
                {testar.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Testar conexão com a Prefeitura
              </Button>
            </div>
            <AnimatePresence>
              {teste && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className={cn("overflow-hidden border-t", teste.ok ? "bg-success/6" : "bg-danger/6")}
                >
                  <div className="flex gap-3 p-4 text-sm">
                    {teste.ok ? <CheckCircle2 className="size-5 shrink-0 text-success-ink" /> : <XCircle className="size-5 shrink-0 text-danger-ink" />}
                    <div className="min-w-0">
                      <p className="font-medium">{teste.mensagem}</p>
                      {teste.detalhe && <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{teste.detalhe}</p>}
                    </div>
                    <button className="ml-auto self-start text-muted-foreground" onClick={() => setTeste(null)} aria-label="Fechar">
                      <X className="size-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="card-surface">
            <EmptyState
              icone={KeyRound}
              titulo="Nenhum certificado em uso"
              descricao="Envie o certificado A1 da empresa emissora para assinar e transmitir as notas."
            />
          </div>
        )}

        <div className="card-surface overflow-hidden">
          <div className="border-b p-4">
            <h3 className="font-semibold">Histórico de certificados</h3>
            <p className="text-sm text-muted-foreground">O anterior continua guardado até você confirmar a troca.</p>
          </div>
          {certs.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Nenhum certificado enviado.</p>
          ) : (
            <ul className="divide-y">
              {certs.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                  <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg", c.ativo ? "bg-brand/12 text-info-ink" : "bg-muted text-muted-foreground")}>
                    <FileKey2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.titular}</p>
                    <p className="text-xs text-muted-foreground">
                      <Mono>{documento(c.cnpj)}</Mono> · válido até <Mono>{data(c.valido_ate)}</Mono> · enviado {dataHora(c.criado_em)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tom={tom(c.dias_restantes)} label={c.dias_restantes < 0 ? "Vencido" : `${c.dias_restantes} dias`} />
                    {c.ativo ? (
                      <StatusBadge status="ativo" label="Em uso" />
                    ) : (
                      <Button size="sm" variant="outline" disabled={c.dias_restantes < 0} onClick={() => setAtivar(c)}>
                        Usar este
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Upload onEnviado={() => qc.invalidateQueries({ queryKey: ["certificados"] })} />
        <div className="rounded-2xl border bg-card p-5 text-sm">
          <h4 className="mb-2 font-semibold">Alertas de vencimento</h4>
          <p className="text-muted-foreground">
            Enviamos e-mail automaticamente <strong className="text-foreground">30, 15, 7 e 1 dia</strong> antes do vencimento. Configure quem
            recebe em Notificações.
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={!!ativar}
        onOpenChange={(o) => !o && setAtivar(null)}
        titulo="Trocar o certificado em uso?"
        descricao={
          ativar && (
            <>
              A partir de agora as notas serão assinadas com o certificado de <strong>{ativar.titular}</strong>, válido até{" "}
              {data(ativar.valido_ate)}.
            </>
          )
        }
        confirmar="Confirmar troca"
        carregando={ativarMut.isPending}
        onConfirm={() => ativar && ativarMut.mutate(ativar.id)}
      />
    </div>
  );
}
