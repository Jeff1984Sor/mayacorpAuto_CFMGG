"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, HandCoins, Landmark, Loader2, Sparkles, UploadCloud } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { Pagination, TableCard, TableSkeleton, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { usePaginado } from "@/hooks/use-paginado";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora, moeda, numero, toNum } from "@/lib/format";
import type { ExtratoDetalhe, ExtratoOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function Upload() {
  const qc = useQueryClient();
  const router = useRouter();
  const enviar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<ExtratoDetalhe>("/nfse/extratos", fd);
    },
    onSuccess: (e) => {
      qc.setQueryData(["extrato", e.id], e);
      qc.invalidateQueries({ queryKey: ["extratos"] });
      qc.invalidateQueries({ queryKey: ["faturas"] });
      qc.invalidateQueries({ queryKey: ["painel"] });
      toast.success(`${numero(e.qtd_conciliados)} de ${numero(e.qtd_creditos)} crédito(s) conciliado(s) · ${numero(e.notas_baixadas)} nota(s) baixada(s)`);
      router.push(`/nfse/recebimentos/${e.id}`);
    },
  });
  const dz = useDropzone({
    multiple: false,
    maxSize: 15 * 1024 * 1024,
    accept: {
      "application/x-ofx": [".ofx"],
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    onDrop: (f) => f[0] && enviar.mutate(f[0]),
    onDropRejected: () => toast.error("Envie o extrato em OFX, CSV ou XLSX (até 15 MB)."),
    disabled: enviar.isPending,
  });
  return (
    <div
      {...dz.getRootProps()}
      className={cn(
        "group relative mb-6 grid cursor-pointer overflow-hidden rounded-3xl border-2 border-dashed bg-card p-6 transition-all sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-6",
        dz.isDragActive ? "scale-[1.01] border-brand bg-brand/5" : "hover:border-brand/50",
      )}
    >
      <input {...dz.getInputProps()} />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-0 transition-opacity group-hover:opacity-50" />
      <motion.div
        animate={dz.isDragActive ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }}
        className="relative mx-auto mb-4 grid size-14 place-items-center rounded-2xl brand-gradient text-white shadow-xl shadow-brand/30 sm:mx-0 sm:mb-0"
      >
        {enviar.isPending ? <Loader2 className="size-7 animate-spin" /> : <UploadCloud className="size-7" />}
      </motion.div>
      <div className="relative text-center sm:text-left">
        <h3 className="font-semibold">{enviar.isPending ? "Lendo o extrato e procurando as notas pagas…" : "Arraste o extrato do banco aqui"}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          OFX, CSV ou XLSX. O robô casa cada crédito com as notas em aberto e dá baixa sozinho quando tem certeza.
        </p>
      </div>
      <div className="relative mt-4 flex justify-center gap-1.5 sm:mt-0">
        {["OFX", "CSV", "XLSX"].map((f) => (
          <Pill key={f} tom="brand">
            {f}
          </Pill>
        ))}
      </div>
    </div>
  );
}

export default function RecebimentosPage() {
  const router = useRouter();
  const { isOperador } = useAuth();
  const lista = usePaginado<ExtratoOut>("extratos", "/nfse/extratos", {}, 25);

  return (
    <div>
      <PageHeader
        titulo="Recebimentos"
        descricao="Extrato bancário → baixa automática das notas pagas."
        icone={HandCoins}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Recebimentos" }]}
      />
      {isOperador && <Upload />}

      <TableCard>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Landmark className="size-4 text-info-ink" />
          <h3 className="font-semibold">Extratos processados</h3>
        </div>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={FileSpreadsheet}
            titulo="Nenhum extrato ainda"
            descricao="Exporte o extrato do internet banking (OFX de preferência) e arraste aqui em cima."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Arquivo</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Período</th>
                  <th className="px-3 py-2.5 font-medium">Conciliação</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Créditos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Conciliado</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium lg:table-cell">Notas baixadas</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((e) => {
                  const pct = e.qtd_creditos ? (e.qtd_conciliados / e.qtd_creditos) * 100 : 0;
                  return (
                    <tr key={e.id} className={linhaClicavel} onClick={() => router.push(`/nfse/recebimentos/${e.id}`)}>
                      <td className="max-w-72 px-4 py-3">
                        <p className="flex items-center gap-2 truncate font-medium">
                          <span className="truncate">{e.arquivo_nome}</span>
                          <Pill>{e.formato}</Pill>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {e.banco ?? "Banco não identificado"} · enviado {dataHora(e.criado_em)}
                        </p>
                      </td>
                      <td className="hidden px-3 py-3 whitespace-nowrap text-muted-foreground md:table-cell">
                        <Mono>{e.periodo_de ? `${data(e.periodo_de)} → ${data(e.periodo_ate)}` : "—"}</Mono>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", pct === 100 ? "bg-success" : "bg-brand")} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs num">
                            {e.qtd_conciliados}/{e.qtd_creditos}
                          </span>
                          {e.qtd_sugeridos > 0 && (
                            <Pill tom="warning">
                              <Sparkles className="size-3" /> {e.qtd_sugeridos}
                            </Pill>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-right whitespace-nowrap sm:table-cell">
                        <Mono>{moeda(e.valor_creditos)}</Mono>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Mono className={cn(toNum(e.valor_conciliado) > 0 && "text-success-ink")}>{moeda(e.valor_conciliado)}</Mono>
                      </td>
                      <td className="hidden px-3 py-3 text-right lg:table-cell">
                        <Mono>{numero(e.notas_baixadas)}</Mono>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />
      </TableCard>
    </div>
  );
}
