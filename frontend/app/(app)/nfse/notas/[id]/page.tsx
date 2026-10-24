"use client";

import { useQuery } from "@tanstack/react-query";
import { Ban, Building2, Copy, ReceiptText, ExternalLink, FileCheck2, FileCode2, FileText, Loader2, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { CancelarNotaDialog, SelosNota, useAcoesNota } from "@/components/nfse/acoes-nota";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { aliquota, data, dataHora, documento, moeda } from "@/lib/format";
import type { NfseDetalhe } from "@/lib/types";

function Linha({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{l}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

export default function NotaDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, isOperador } = useAuth();
  const acoes = useAcoesNota();
  const [cancelar, setCancelar] = useState(false);
  const [dest, setDest] = useState("");
  const q = useQuery({ queryKey: ["nota", Number(id)], queryFn: () => api.get<NfseDetalhe>(`/nfse/notas/${id}`) });
  const n = q.data;

  if (!n)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-96" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-2xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );

  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copiado"));
  const cancelada = n.status === "cancelada";

  return (
    <div className="space-y-5">
      <PageHeader
        titulo={
          <span className="flex items-center gap-3">
            NFS-e <Mono>{n.numero}</Mono> <StatusBadge status={n.status} />
            <SelosNota n={n} />
          </span>
        }
        descricao={`Emitida em ${dataHora(n.data_emissao)} · RPS ${n.rps_numero}/${n.rps_serie}`}
        icone={FileCheck2}
        migalhas={[
          { label: "NFS-e", href: "/nfse" },
          { label: "Notas emitidas", href: "/nfse/notas" },
          { label: String(n.numero) },
        ]}
        acoes={
          <>
            <Button onClick={() => acoes.pdf(n)}>
              <FileText /> Ver PDF
            </Button>
            <Button variant="outline" onClick={() => acoes.xml(n)}>
              <FileCode2 /> XML
            </Button>
            <Button variant="outline" onClick={() => acoes.prefeitura(n)}>
              <ExternalLink /> Prefeitura
            </Button>
            {isAdmin && !cancelada && (
              <Button variant="destructive" onClick={() => setCancelar(true)}>
                <Ban /> Cancelar
              </Button>
            )}
          </>
        }
      />

      {cancelada && (
        <div className="rounded-xl border border-danger/25 bg-danger/6 p-4 text-sm">
          <p className="font-medium text-danger-ink">Nota cancelada em {dataHora(n.cancelada_em)}</p>
          {n.motivo_cancelamento && <p className="mt-1 text-muted-foreground">Motivo: {n.motivo_cancelamento}</p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* "papel" da nota */}
          <div className="card-surface relative overflow-hidden">
            <div className="brand-gradient h-1.5" />
            <div className="grid gap-6 p-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Valor do serviço</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight num">{moeda(n.valor)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  ISS <span className="text-foreground num">{moeda(n.iss)}</span> · alíquota <span className="num">{aliquota(n.aliquota)}</span>
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-4">
                <p className="text-xs text-muted-foreground">Código de verificação</p>
                <div className="mt-1 flex items-center gap-2">
                  <Mono className="text-xl font-semibold tracking-widest">{n.cod_verificacao}</Mono>
                  <Button variant="ghost" size="icon-xs" onClick={() => copiar(n.cod_verificacao)} aria-label="Copiar">
                    <Copy />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Serviço <Mono>{n.cod_servico}</Mono>
                </p>
              </div>
            </div>
            <div className="border-t p-6">
              <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Discriminação</p>
              <p className="text-sm whitespace-pre-wrap">{n.discriminacao || "—"}</p>
            </div>
          </div>

          <div className="card-surface p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <Send className="size-4 text-info-ink" /> Envios por e-mail
            </h3>
            {n.envios.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta nota ainda não foi enviada por e-mail.</p>
            ) : (
              <ul className="divide-y">
                {n.envios.map((e, i) => (
                  <li key={e.id ?? i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="truncate">{e.destinatarios.join(", ")}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {dataHora(e.enviado_em)}
                      <StatusBadge status={e.status === "enviado" ? "ok" : "erro"} label={e.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {isOperador && !cancelada && (
              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const lista = dest
                    .split(/[;,\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  acoes.email.mutate({ id: n.id, destinatarios: lista.length ? lista : undefined }, { onSuccess: () => setDest("") });
                }}
              >
                <Input
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder={n.tomador_emails.join(", ") || "e-mail do destinatário"}
                  className="h-9"
                />
                <Button type="submit" disabled={acoes.email.isPending}>
                  {acoes.email.isPending ? <Loader2 className="animate-spin" /> : <Mail />} Reenviar
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card-surface p-5">
            <h3 className="mb-1 flex items-center gap-2 font-semibold">
              <Building2 className="size-4 text-info-ink" /> Tomador
            </h3>
            <div className="divide-y">
              <Linha l="Nome">{n.tomador_nome}</Linha>
              <Linha l="CPF/CNPJ">
                <Mono>{documento(n.tomador_doc)}</Mono>
              </Linha>
              <Linha l="E-mails">{n.tomador_emails.length ? n.tomador_emails.join(", ") : "—"}</Linha>
            </div>
            {n.tomador_id && (
              <Button variant="ghost" size="sm" className="mt-2 -ml-2" render={<Link href={`/cadastros/clientes?id=${n.tomador_id}`} />}>
                Ver cadastro →
              </Button>
            )}
          </div>
          {n.fatura_id && (
            <Link
              href={`/nfse/faturas/${n.fatura_id}`}
              className="card-surface group flex items-center gap-3 p-4 transition-colors hover:border-brand/40"
            >
              <span className={n.pago_em ? "grid size-10 place-items-center rounded-xl bg-success/10 text-success-ink" : "grid size-10 place-items-center rounded-xl bg-brand/12 text-info-ink"}>
                <ReceiptText className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted-foreground">Nota de Honorários</span>
                <Mono className="font-semibold">{n.fatura_codigo}</Mono>
              </span>
              {n.pago_em ? (
                <StatusBadge status="paga" label={`Paga · ${data(n.pago_em)}`} />
              ) : (
                <StatusBadge status="aberta" label="A receber" />
              )}
            </Link>
          )}
          <div className="card-surface p-5">
            <h3 className="mb-1 font-semibold">Origem</h3>
            <div className="divide-y">
              <Linha l="RPS">
                <Mono>
                  {n.rps_numero}/{n.rps_serie}
                </Mono>
              </Linha>
              <Linha l="Lote">
                <Link href={`/nfse/lotes/${n.lote_id}`} className="text-info-ink hover:underline">
                  ver lote →
                </Link>
              </Linha>
              <Linha l="Emissão">
                <Mono>{dataHora(n.data_emissao)}</Mono>
              </Linha>
            </div>
          </div>
        </div>
      </div>

      <CancelarNotaDialog nota={cancelar ? n : null} onClose={() => setCancelar(false)} />
    </div>
  );
}
