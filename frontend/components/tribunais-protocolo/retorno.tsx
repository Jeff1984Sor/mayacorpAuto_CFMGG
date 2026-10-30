"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, FileUp, Mail, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Input } from "@/components/ui/input";
import { api, baixar } from "@/lib/api";
import { dataHora } from "@/lib/format";
import type { ProtocoloOut } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const PAPEL: Record<string, string> = {
  responsavel_caso: "responsável do caso",
  quem_protocolou: "quem protocolou",
  titular_certificado: "titular do certificado",
  fixo: "destinatário fixo",
  copia_oculta: "cópia oculta",
};

const STATUS_EMAIL: Record<string, [string, "success" | "danger" | "neutral" | "info"]> = {
  fila: ["Na fila", "neutral"],
  enviado: ["Enviado", "success"],
  entregue: ["Entregue", "success"],
  aberto: ["Aberto", "success"],
  bounce: ["Voltou (endereço inválido)", "danger"],
  erro: ["Falhou", "danger"],
};

/** Diálogo "Registrar retorno do portal": o advogado protocolou no portal (ou conferiu depois de falha). */
export function RegistrarRetornoDialog({
  p,
  open,
  onOpenChange,
  onAtualizado,
}: {
  p: ProtocoloOut;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAtualizado: (p: ProtocoloOut) => void;
}) {
  const [numero, setNumero] = useState("");
  const [quando, setQuando] = useState("");
  const [cnj, setCnj] = useState("");
  const [recibo, setRecibo] = useState<File | null>(null);
  const reg = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("entrou", "true");
      fd.append("numero_protocolo", numero.trim());
      if (quando) fd.append("data_hora", quando);
      if (cnj.trim()) fd.append("numero_cnj_gerado", cnj.replace(/\D/g, ""));
      if (recibo) fd.append("recibo", recibo);
      return api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/registrar-retorno`, fd);
    },
    onSuccess: (r) => {
      onAtualizado(r);
      onOpenChange(false);
      setNumero("");
      setQuando("");
      setCnj("");
      setRecibo(null);
      toast.success("Retorno registrado. O protocolo ficou como protocolado.");
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Registrar o recibo do tribunal"
      descricao="Use quando a petição entrou pelo portal do tribunal (ou quando você conferiu lá que ela entrou)."
      rotuloSalvar="Registrar"
      salvando={reg.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!numero.trim()) return toast.error("Informe o número do protocolo que está no recibo.");
        reg.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nº do protocolo" obrigatorio>
          <Input value={numero} onChange={(e) => setNumero(e.target.value)} className="font-mono" autoFocus />
        </Field>
        <Field label="Data e hora do protocolo" dica="Como está no recibo: é a prova de tempestividade.">
          <Input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
        </Field>
        {p.tipo === "inicial" && (
          <Field label="Nº do processo distribuído (CNJ)" className="sm:col-span-2">
            <Input value={cnj} onChange={(e) => setCnj(e.target.value)} className="font-mono" placeholder="0000000-00.0000.0.00.0000" />
          </Field>
        )}
        <Field label="Recibo (PDF)" className="sm:col-span-2">
          <Input type="file" accept=".pdf,image/*" onChange={(e) => setRecibo(e.target.files?.[0] ?? null)} />
        </Field>
        {p.sistema_portal && (
          <a href={p.sistema_portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info-ink hover:underline sm:col-span-2">
            Abrir o portal do {p.tribunal} <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </FormDialog>
  );
}

export function NaoEntrouDialog({
  p,
  open,
  onOpenChange,
  onAtualizado,
}: {
  p: ProtocoloOut;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAtualizado: (p: ProtocoloOut) => void;
}) {
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("entrou", "false");
      return api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/registrar-retorno`, fd);
    },
    onSuccess: (r) => {
      onAtualizado(r);
      onOpenChange(false);
      toast.success("Registrado: a petição não entrou. Ela voltou para ser enviada de novo.");
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Confirmar que a petição NÃO entrou?"
      descricao="Confira no portal do tribunal antes. Se ela entrou e você reenviar, a petição fica em duplicidade nos autos. Ao confirmar, o protocolo volta para ser enviado de novo."
      confirmar="Confirmo: não entrou"
      destrutivo
      carregando={m.isPending}
      onConfirm={() => m.mutate()}
    />
  );
}

export function RetornosProtocolo({ p }: { p: ProtocoloOut }) {
  const lista = [...p.retornos].reverse();
  if (lista.length === 0)
    return (
      <div className="card-surface">
        <EmptyState icone={FileUp} titulo="Sem retorno do tribunal" descricao="Depois do envio, o recibo, o número do protocolo e os avisos por e-mail aparecem aqui." />
      </div>
    );
  return (
    <div className="space-y-3">
      {lista.map((r) => (
        <div key={r.id} className={cn("card-surface overflow-hidden", r.sucesso ? "ring-1 ring-success/30" : "ring-1 ring-danger/25")}>
          <div className={cn("h-1", r.sucesso ? "bg-success" : "bg-danger")} />
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
            <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl", r.sucesso ? "bg-success/12 text-success-ink" : "bg-danger/10 text-danger-ink")}>
              {r.sucesso ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{r.sucesso ? "Protocolado" : "Não protocolado"}</p>
                <span className="text-xs text-muted-foreground">tentativa {r.tentativa} · {dataHora(r.criado_em)}</span>
                {r.simulado && (
                  <Pill tom="warning" className="normal-case">
                    Simulação
                  </Pill>
                )}
                {r.manual && (
                  <Pill tom="info" className="normal-case">
                    Registrado à mão
                  </Pill>
                )}
                {r.recuperado && (
                  <Pill tom="brand" className="normal-case">
                    Recuperado na consulta
                  </Pill>
                )}
              </div>
              {r.sucesso ? (
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Nº do protocolo</dt>
                    <dd>
                      <Mono>{r.numero_protocolo ?? "—"}</Mono>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Data e hora no tribunal</dt>
                    <dd>
                      <Mono>{dataHora(r.data_hora_protocolo)}</Mono>
                    </dd>
                  </div>
                  {r.numero_cnj_gerado_formatado && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Processo distribuído</dt>
                      <dd>
                        <Mono>{r.numero_cnj_gerado_formatado}</Mono>
                      </dd>
                    </div>
                  )}
                  {r.orgao_julgador_distribuido && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Órgão</dt>
                      <dd>
                        {r.orgao_julgador_distribuido}
                        {r.tipo_distribuicao && <span className="text-muted-foreground"> · {r.tipo_distribuicao}</span>}
                      </dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-danger-ink">
                  {r.mensagem_erro ?? "O tribunal recusou a petição."}
                  {r.codigo_erro && <span className="ml-1 font-mono text-xs">({r.codigo_erro})</span>}
                </p>
              )}
              {r.emails.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Mail className="size-3.5" /> Avisos por e-mail
                  </p>
                  <ul className="space-y-1 text-xs">
                    {r.emails.map((e, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.destinatario}</span>
                        {e.papel && <span className="text-muted-foreground">{PAPEL[e.papel] ?? e.papel.replace(/_/g, " ")}</span>}
                        <StatusBadge className="h-5" label={(STATUS_EMAIL[e.status] ?? [e.status])[0]} tom={(STATUS_EMAIL[e.status] ?? [e.status, "neutral"])[1]} />
                        {e.erro && <span className="text-danger-ink">{e.erro}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {r.tem_recibo && (
              <button
                type="button"
                onClick={() => baixar(`/tribunais/retornos/${r.id}/recibo`, {}, `recibo-${r.numero_protocolo ?? r.id}.pdf`)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <Download className="size-4" /> Recibo
              </button>
            )}
          </div>
          {r.hash_documentos_enviados && r.hash_documentos_enviados.length > 0 && (
            <div className="border-t bg-muted/30 px-5 py-2 text-[11px] text-muted-foreground">
              Documentos enviados (SHA-256):{" "}
              {r.hash_documentos_enviados.map((h) => (
                <span key={h} className="mr-2 font-mono" title={h}>
                  {h.slice(0, 10)}…
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
