"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign, Building2, CheckCircle2, Hourglass, PauseCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteDialog } from "@/components/admin/cliente-dialog";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { KpiCard } from "@/components/mayacorp/kpi-card";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { type ClienteSaaS, type ResumoAdmin, ROTULO_STATUS, type StatusCliente, TOM_STATUS } from "@/lib/admin";
import { api } from "@/lib/api";
import { data, documento, moeda, toNum } from "@/lib/format";

export default function ClientesMayaJusPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 300);
  const [status, setStatus] = useState<StatusCliente | "todos">("todos");
  const [novo, setNovo] = useState(false);
  const resumo = useQuery({ queryKey: ["admin", "resumo"], queryFn: () => api.get<ResumoAdmin>("/admin/resumo") });
  const lista = useQuery({
    queryKey: ["admin", "clientes", busca, status],
    queryFn: () => api.get<ClienteSaaS[]>("/admin/clientes", { q: busca || undefined, status: status === "todos" ? undefined : status }),
  });
  const itens = lista.data ?? [];
  const r = resumo.data;

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        icone={Building2}
        migalhas={[{ label: "MayaCorp" }, { label: "Clientes" }]}
        acoes={
          <Button onClick={() => setNovo(true)}>
            <Plus /> Novo cliente
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard titulo="Receita mensal (MRR)" icone={BadgeDollarSign} carregando={!r} valor={r ? moeda(r.mrr) : "—"} />
        <KpiCard titulo="Ativos" icone={CheckCircle2} indice={1} carregando={!r} valor={r ? String(r.por_status.ativo ?? 0) : "—"} />
        <KpiCard titulo="Em teste" icone={Hourglass} indice={2} carregando={!r} valor={r ? String(r.por_status.teste ?? 0) : "—"} />
        <KpiCard titulo="Suspensos / inativos" icone={PauseCircle} indice={3} carregando={!r} valor={r ? String((r.por_status.suspenso ?? 0) + (r.por_status.inativo ?? 0)) : "—"} />
      </div>

      <TableCard>
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Escritório, identificador ou CNPJ" className="sm:w-80" />
          <Segmented
            value={status}
            onChange={setStatus}
            opcoes={[
              { value: "todos", label: "Todos" },
              { value: "teste", label: "Em teste" },
              { value: "ativo", label: "Ativos" },
              { value: "suspenso", label: "Suspensos" },
              { value: "inativo", label: "Inativos" },
            ]}
          />
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={Building2}
            titulo={busca || status !== "todos" ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"}
            descricao="Cada cliente ganha um banco próprio, o administrador recebe o convite e já pode usar."
            acao={
              <Button onClick={() => setNovo(true)}>
                <Plus /> Novo cliente
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Escritório</th>
                  <th className="px-3 py-2.5 font-medium">Plano</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Início do contrato</th>
                  <th className="px-3 py-2.5 font-medium">Domínio</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((c) => (
                  <tr key={c.id} className={linhaClicavel} onClick={() => router.push(`/admin/clientes/${c.id}`)}>
                    <td className="max-w-72 px-4 py-3">
                      <p className="truncate font-medium">{c.nome}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {c.slug}
                        {c.documento && ` · ${documento(c.documento)}`}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      {c.plano ? (
                        <>
                          {c.plano.nome} <span className="text-xs text-muted-foreground">· {c.ciclo}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {c.valor ? moeda(c.valor_com_desconto ?? c.valor) : "—"}
                      {toNum(c.desconto_percentual) > 0 && (
                        <p className="text-[11px] text-success-ink">−{toNum(c.desconto_percentual)}% indicação</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">{c.inicio_contrato ? data(c.inicio_contrato) : "—"}</td>
                    <td className="max-w-48 truncate px-3 py-3 font-mono text-xs">{c.dominios[0]?.host ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Pill tom={TOM_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Pill>
                      {c.status === "teste" && c.teste_ate && <p className="mt-0.5 text-[11px] text-muted-foreground">até {data(c.teste_ate)}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <ClienteDialog open={novo} onOpenChange={setNovo} onSalvo={(c) => router.push(`/admin/clientes/${c.id}`)} />
    </div>
  );
}
