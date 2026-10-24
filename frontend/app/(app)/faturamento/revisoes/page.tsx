"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileSearch, ListChecks } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { IaBadge } from "@/components/faturamento/ia-score";
import { Diferenca, diasDesde, STATUS_REVISAO } from "@/components/faturamento/revisao-util";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { documentoDaAba, type RevisaoResumo, type StatusRevisao } from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filtro = StatusRevisao | "todas";

export default function RevisoesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Filtro>("em_revisao");
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [q, setQ] = useState("");
  const lista = useQuery({
    queryKey: ["fat", "revisoes", status, cliente[0]?.id ?? null],
    queryFn: () => api.get<RevisaoResumo[]>("/faturamento/revisoes", { status, tomador_id: cliente[0]?.id }),
  });
  const termo = q.trim().toLowerCase();
  const itens = (lista.data ?? []).filter(
    (r) => !termo || String(r.numero).includes(termo) || r.tomador_nome.toLowerCase().includes(termo) || r.contrato_nome.toLowerCase().includes(termo),
  );
  const total = itens.reduce((a, r) => a + toNum(r.total), 0);

  return (
    <div>
      <PageHeader
        titulo="Revisões"
        descricao="Faturas montadas esperando conferência antes de virar NH ou ND."
        icone={FileSearch}
        migalhas={[{ label: "Faturamento" }, { label: "Revisões" }]}
        acoes={
          <Button variant="outline" render={<Link href="/faturamento/itens" />}>
            <ListChecks /> Itens a faturar
          </Button>
        }
      />
      <TableCard>
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Segmented<Filtro>
              value={status}
              onChange={setStatus}
              opcoes={[
                { value: "em_revisao", label: "Em revisão", tom: "warning" },
                { value: "faturada", label: "Faturadas", tom: "success" },
                { value: "descartada", label: "Descartadas" },
                { value: "todas", label: "Todas" },
              ]}
            />
            <div className="sm:w-64">
              <ClientesMulti unico valor={cliente} onChange={setCliente} id="revisoes-cliente" />
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Nº, cliente ou contrato" />
          </div>
          {itens.length > 0 && (
            <p className="text-sm whitespace-nowrap text-muted-foreground">
              {itens.length} · <strong className="font-mono text-foreground">{moeda(total)}</strong>
            </p>
          )}
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={8} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={FileSearch}
            titulo={status === "em_revisao" ? "Nenhuma revisão aberta" : "Nenhuma revisão encontrada"}
            descricao={status === "em_revisao" ? "Selecione itens em Itens a faturar e clique em Enviar para Revisão." : "Troque o filtro de situação ou de cliente."}
            acao={
              <Button render={<Link href="/faturamento/itens" />}>
                Ir para Itens a faturar <ArrowRight />
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nº</th>
                  <th className="px-3 py-2.5 font-medium">Cliente / contrato</th>
                  <th className="px-3 py-2.5 font-medium">Doc.</th>
                  <th className="px-3 py-2.5 text-right font-medium">Itens</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Responsável</th>
                  <th className="px-3 py-2.5 font-medium">IA</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((r) => {
                  const dias = diasDesde(r.criado_em);
                  const st = STATUS_REVISAO[r.status];
                  return (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      className={cn(linhaClicavel, "focus-visible:bg-accent/40 focus-visible:outline-none")}
                      onClick={() => router.push(`/faturamento/revisoes/${r.id}`)}
                      onKeyDown={(e) => e.key === "Enter" && router.push(`/faturamento/revisoes/${r.id}`)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold">#{r.numero}</td>
                      <td className="max-w-72 px-3 py-3">
                        <p className="truncate font-medium">{r.tomador_nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          #{r.contrato_numero} {r.contrato_nome} · {data(r.de)} a {data(r.ate)}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Pill tom={r.aba === "despesas" ? "info" : "brand"}>{documentoDaAba(r.aba)}</Pill>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{r.qtd_itens}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <p className="font-mono font-semibold tabular-nums">{moeda(r.total)}</p>
                        <Diferenca total={r.total} original={r.total_original} />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{r.responsavel_nome ?? "—"}</td>
                      <td className="px-3 py-3">
                        <IaBadge nota={r.nota_ia} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-0.5">
                          <StatusBadge tom={st.tom} label={st.l} />
                          {r.status === "em_revisao" ? (
                            <span className={cn("text-[11px]", dias >= 5 ? "font-medium text-danger-ink" : "text-muted-foreground")}>
                              {dias === 0 ? "aberta hoje" : `há ${dias} dia${dias === 1 ? "" : "s"}`}
                            </span>
                          ) : (
                            r.fatura_codigo && <span className="font-mono text-[11px] text-muted-foreground">{r.fatura_codigo}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </div>
  );
}
