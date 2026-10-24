"use client";

import { ChamarAlguem } from "@/components/comunicador/chamar-alguem";
import { BotaoEmailNota } from "@/components/email/enviar-nota";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Mail,
  ReceiptText,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { BotaoAnaliseIA } from "@/components/ia/analise-ia";
import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { useZipFaturas } from "@/components/nfse/acoes-fatura";
import { useAcoesLote } from "@/components/nfse/acoes-lote";
import { RpsEditor } from "@/components/nfse/rps-editor";
import { RpsTable } from "@/components/nfse/rps-table";
import { LinhaDoTempo, Transmissao } from "@/components/nfse/transmissao";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loteFinalizado, useProgresso } from "@/hooks/use-progresso";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dataHora, duracao, moeda, numero } from "@/lib/format";
import type { LoteDetalhe, RpsOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const FASES = [
  { k: "upload", l: "Upload", i: Upload },
  { k: "validacao", l: "Validação", i: Search },
  { k: "teste", l: "Teste", i: ShieldCheck },
  { k: "envio", l: "Envio", i: Send },
  { k: "retorno", l: "Retorno", i: CheckCircle2 },
];

function faseAtual(l: LoteDetalhe) {
  if (l.status === "validando") return 1;
  if (l.status === "na_fila") return 2;
  if (l.status === "transmitindo") {
    const temEnvio = l.eventos.some((e) => /envio/i.test(e.etapa));
    return temEnvio ? 3 : 2;
  }
  return 5;
}

function Fases({ lote }: { lote: LoteDetalhe }) {
  const atual = faseAtual(lote);
  const falhou = lote.status === "falhou";
  return (
    <div className="grid grid-cols-5 gap-1">
      {FASES.map((f, i) => {
        const feito = i < atual;
        const agora = i === atual;
        return (
          <div key={f.k} className="flex flex-col items-center gap-2 text-center">
            <div className="flex w-full items-center">
              <div className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : feito || agora ? "bg-success" : "bg-border")} />
              <div
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-card transition-colors",
                  feito && !(falhou && i === 4) && "bg-success text-white",
                  feito && falhou && i === 4 && "bg-danger text-white",
                  agora && "brand-gradient text-white shadow-lg shadow-brand/30",
                  !feito && !agora && "bg-muted text-muted-foreground",
                )}
              >
                {agora ? <Loader2 className="size-4 animate-spin" /> : <f.i className="size-4" />}
              </div>
              <div className={cn("h-0.5 flex-1", i === 4 ? "bg-transparent" : feito ? "bg-success" : "bg-border")} />
            </div>
            <span className={cn("text-xs", agora || feito ? "font-medium" : "text-muted-foreground")}>{f.l}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function LoteDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const loteId = Number(id);
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const [aberto, setAberto] = useState<RpsOut | null>(null);
  const [confirmaReproc, setConfirmaReproc] = useState(false);

  const q = useQuery({ queryKey: ["lote", loteId], queryFn: () => api.get<LoteDetalhe>(`/nfse/lotes/${loteId}`) });
  const l = q.data;
  const emAndamento = !!l && !loteFinalizado(l.status) && l.status !== "validando";
  const { progresso, conectado } = useProgresso(emAndamento ? loteId : null, () => {
    void q.refetch();
    qc.invalidateQueries({ queryKey: ["lotes"] });
  });
  const acoes = useAcoesLote(loteId, l?.numero);
  const zipFaturas = useZipFaturas();

  if (q.isPending || !l)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );

  const tempo = l.iniciado_em && l.concluido_em ? (new Date(l.concluido_em).getTime() - new Date(l.iniciado_em).getTime()) / 1000 : 0;
  const rejeitadas = l.rps.filter((r) => r.status === "rejeitado").length;

  return (
    <div className="space-y-5">
      <PageHeader
        titulo={
          <span className="flex items-center gap-3">
            Lote <Mono>#{String(l.numero).padStart(4, "0")}</Mono> <StatusBadge status={l.status} />
          </span>
        }
        descricao={
          <>
            {l.arquivo_origem} · {l.emissora_nome} · por {l.usuario_nome ?? "—"} em {dataHora(l.criado_em)}
          </>
        }
        icone={Layers}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Lotes", href: "/nfse/lotes" }, { label: `#${l.numero}` }]}
        acoes={
          <>
            <ChamarAlguem origemTipo="lote" origemId={l.id} contexto={`o lote #${String(l.numero).padStart(4, "0")}`} />
            {isOperador && <BotaoAnaliseIA endpoint={`/ia/analise/lote/${l.id}`} contexto={`Lote #${String(l.numero).padStart(4, "0")}`} />}
            {l.status === "validando" && isOperador && (
              <Button render={<Link href={`/nfse/nova-emissao?lote=${l.id}`} />}>Continuar conferência</Button>
            )}
            <Button variant="outline" onClick={() => acoes.arquivo.mutate()} disabled={acoes.arquivo.isPending}>
              <FileText /> Arquivo original
            </Button>
            <Button variant="outline" onClick={() => acoes.conferencia.mutate()} disabled={acoes.conferencia.isPending}>
              <FileSpreadsheet /> Conferência
            </Button>
            {l.qtd_emitidas > 0 && (
              <Button variant="outline" onClick={() => acoes.zip.mutate()} disabled={acoes.zip.isPending}>
                {acoes.zip.isPending ? <Loader2 className="animate-spin" /> : <Download />} ZIP
              </Button>
            )}
            {l.qtd_emitidas > 0 && (
              <Button variant="outline" onClick={() => zipFaturas.mutate({ lote_id: l.id })} disabled={zipFaturas.isPending}>
                {zipFaturas.isPending ? <Loader2 className="animate-spin" /> : <ReceiptText />} Faturas (ZIP)
              </Button>
            )}
            {isOperador && l.qtd_emitidas > 0 && (
              <Button variant="outline" onClick={() => acoes.emails.mutate()} disabled={acoes.emails.isPending}>
                <Mail /> E-mails
              </Button>
            )}
            {isOperador && rejeitadas > 0 && loteFinalizado(l.status) && (
              <Button onClick={() => setConfirmaReproc(true)}>
                <RotateCcw /> Reprocessar rejeitados
              </Button>
            )}
          </>
        }
      />

      <div className="card-surface p-5">
        <Fases lote={l} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { l: "RPS", v: numero(l.qtd) },
          { l: "Valor total", v: moeda(l.valor_total) },
          { l: "ISS", v: moeda(l.iss_total) },
          { l: "Emitidas", v: numero(l.qtd_emitidas), c: "text-success-ink" },
          { l: "Rejeitadas", v: numero(l.qtd_rejeitadas), c: l.qtd_rejeitadas ? "text-danger-ink" : "" },
        ].map((x) => (
          <div key={x.l} className="card-surface p-4">
            <p className="text-xs text-muted-foreground">{x.l}</p>
            <p className={cn("mt-1 text-xl font-semibold num", x.c)}>{x.v}</p>
          </div>
        ))}
      </div>

      {emAndamento && <Transmissao progresso={progresso} conectado={conectado} />}

      <div className="grid gap-4 2xl:grid-cols-[1fr_360px]">
        <RpsTable
          rps={l.rps}
          onAbrir={setAberto}
          acaoNota={isOperador ? (r) => <BotaoEmailNota nfseId={r.nfse_id!} numero={r.nfse_numero ?? undefined} /> : undefined}
        />
        <div className="card-surface h-fit p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Linha do tempo</h3>
            {tempo > 0 && <span className="text-xs text-muted-foreground">em {duracao(tempo)}</span>}
          </div>
          {l.eventos.length ? (
            <div className="max-h-[560px] overflow-y-auto pr-1">
              <LinhaDoTempo eventos={l.eventos} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sem eventos registrados.</p>
          )}
        </div>
      </div>

      <RpsEditor
        loteId={loteId}
        rps={aberto}
        somenteLeitura={!isOperador || !(aberto?.status === "rejeitado" || l.status === "validando")}
        onClose={() => setAberto(null)}
        onSaved={() => void q.refetch()}
      />
      <ConfirmDialog
        open={confirmaReproc}
        onOpenChange={setConfirmaReproc}
        titulo={`Reprocessar ${rejeitadas} rejeitado(s)?`}
        descricao="Só os RPS rejeitados voltam para a fila. Antes de reenviar, o robô consulta se a nota já foi gerada — nada é emitido duas vezes."
        confirmar="Reprocessar"
        carregando={acoes.reprocessar.isPending}
        onConfirm={() =>
          acoes.reprocessar.mutate(undefined, {
            onSuccess: () => {
              setConfirmaReproc(false);
              void q.refetch();
            },
          })
        }
      />
    </div>
  );
}
