"use client";

import { useQuery } from "@tanstack/react-query";
import { FilePlus2, FileSignature } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { ContratoDialog } from "@/components/faturamento/dialogos";
import { PlanilhaAcoes } from "@/components/faturamento/importar-planilha";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ContratoOut } from "@/lib/faturamento";
import { data } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ContratosPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEditar = pode("contratos.editar");
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 300);
  const [ativos, setAtivos] = useState<"sim" | "todos">("sim");
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [novo, setNovo] = useState(false);
  const lista = useQuery({
    queryKey: ["fat", "contratos", busca, ativos, cliente[0]?.id ?? null],
    queryFn: () => api.get<ContratoOut[]>("/faturamento/contratos", { q: busca || undefined, ativos: ativos === "sim" ? true : undefined, tomador_id: cliente[0]?.id }),
  });
  const itens = lista.data ?? [];
  const filtrando = !!(busca || cliente.length);

  return (
    <div>
      <PageHeader
        titulo="Contratos"
        icone={FileSignature}
        migalhas={[{ label: "Cadastros" }, { label: "Contratos" }]}
        acoes={
          <>
            <PlanilhaAcoes recurso="contratos" rotulo="contratos" podeImportar={pode("contratos.importar")} />
            {podeEditar && (
              <Button onClick={() => setNovo(true)}>
                <FilePlus2 /> Novo contrato
              </Button>
            )}
          </>
        }
      />
      <TableCard>
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Nome do contrato ou cliente" />
            <div className="sm:w-64">
              <ClientesMulti unico id="contratos-cliente" valor={cliente} onChange={setCliente} />
            </div>
            <Segmented
              value={ativos}
              onChange={setAtivos}
              opcoes={[
                { value: "sim", label: "Ativos" },
                { value: "todos", label: "Todos" },
              ]}
            />
          </div>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={FileSignature}
            titulo={filtrando ? "Nenhum contrato encontrado" : "Nenhum contrato ainda"}
            descricao={filtrando ? "Troque a busca ou o cliente." : "Crie o primeiro contrato e defina como o cliente é cobrado."}
            acao={
              podeEditar &&
              !filtrando && (
                <Button onClick={() => setNovo(true)}>
                  <FilePlus2 /> Novo contrato
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nº</th>
                  <th className="px-3 py-2.5 font-medium">Contrato</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Vigência</th>
                  <th className="px-3 py-2.5 font-medium">Tabela de preço</th>
                  <th className="px-3 py-2.5 text-right font-medium">Casos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Regras</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    className={cn(linhaClicavel, "focus-visible:bg-accent/40 focus-visible:outline-none", !c.ativo && "opacity-60")}
                    onClick={() => router.push(`/faturamento/contratos/${c.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && router.push(`/faturamento/contratos/${c.id}`)}
                  >
                    <td className="px-4 py-3 font-mono font-semibold">#{c.numero}</td>
                    <td className="max-w-72 px-3 py-3">
                      <p className="truncate font-medium">{c.nome}</p>
                      {c.objeto && <p className="truncate text-xs text-muted-foreground">{c.objeto}</p>}
                    </td>
                    <td className="max-w-56 truncate px-3 py-3">{c.tomador_nome}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-muted-foreground">
                      {c.data_inicio ? data(c.data_inicio) : "—"} {c.data_fim ? `a ${data(c.data_fim)}` : "· sem fim"}
                    </td>
                    <td className="px-3 py-3 text-xs">{c.tabela_preco_nome ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.qtd_casos}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{c.qtd_regras === 0 ? <Pill tom="warning">0</Pill> : c.qtd_regras}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={c.ativo ? "ativo" : "descartado"} label={c.ativo ? "Ativo" : "Encerrado"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
      <ContratoDialog open={novo} onOpenChange={setNovo} onSalvo={(c) => router.push(`/faturamento/contratos/${c.id}`)} />
    </div>
  );
}
