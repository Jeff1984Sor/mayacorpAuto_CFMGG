"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCategoriasFin } from "@/components/financeiro/comum";
import { FornecedorDialog, mascaraDoc } from "@/components/financeiro/pagar/fornecedor-dialog";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FornecedorOut } from "@/lib/financeiro";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function FornecedoresPage() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("fornecedores.editar");
  const podeExcluir = pode("fornecedores.excluir");
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 300);
  const [ativos, setAtivos] = useState<"sim" | "todos">("sim");
  const [dlg, setDlg] = useState<{ f: FornecedorOut | null } | null>(null);
  const [excluir, setExcluir] = useState<FornecedorOut | null>(null);
  const cats = useCategoriasFin("despesa");
  const lista = useQuery({
    queryKey: ["fin", "fornecedores", busca, ativos],
    queryFn: () => api.get<FornecedorOut[]>("/financeiro/fornecedores", { q: busca || undefined, ativos: ativos === "sim" ? true : undefined }),
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/financeiro/fornecedores/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fin"] });
    },
  });
  const itens = lista.data ?? [];
  const nomeCat = (id: number | null) => cats.data?.find((c) => c.id === id)?.nome;

  return (
    <div>
      <PageHeader
        titulo="Fornecedores"
        icone={Truck}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Fornecedores" }]}
        acoes={
          podeEditar && (
            <Button onClick={() => setDlg({ f: null })}>
              <Plus /> Novo fornecedor
            </Button>
          )
        }
      />
      <TableCard>
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Nome, e-mail ou CPF/CNPJ" className="sm:w-80" />
          <Segmented
            value={ativos}
            onChange={setAtivos}
            opcoes={[
              { value: "sim", label: "Ativos" },
              { value: "todos", label: "Todos" },
            ]}
          />
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={7} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={Truck}
            titulo={busca ? "Nenhum fornecedor encontrado" : "Nenhum fornecedor cadastrado"}
            descricao={busca ? "Troque a busca." : "Cadastre quem o escritório paga para agilizar as contas a pagar."}
            acao={
              podeEditar &&
              !busca && (
                <Button onClick={() => setDlg({ f: null })}>
                  <Plus /> Novo fornecedor
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">CPF/CNPJ</th>
                  <th className="px-3 py-2.5 font-medium">Contato</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pago 12m</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((f) => (
                  <tr key={f.id} className={cn(linhaClicavel, !f.ativo && "opacity-60")} onClick={() => podeEditar && setDlg({ f })}>
                    <td className="max-w-72 px-4 py-3">
                      <p className="truncate font-medium">{f.nome}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[nomeCat(f.categoria_padrao_id), f.chave_pix && `PIX ${f.chave_pix}`].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Pill tom="neutral">{f.tipo}</Pill>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{f.cpf_cnpj ? mascaraDoc(f.cpf_cnpj, f.tipo) : "—"}</td>
                    <td className="max-w-56 px-3 py-3 text-xs">
                      <p className="truncate">{f.email ?? "—"}</p>
                      {f.telefone && <p className="text-muted-foreground">{f.telefone}</p>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{f.qtd_contas}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{toNum(f.total_pago_12m) ? moeda(f.total_pago_12m) : "—"}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={f.ativo ? "ativo" : "descartado"} label={f.ativo ? "Ativo" : "Inativo"} />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {(podeEditar || podeExcluir) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${f.nome}`} />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {podeEditar && (
                              <DropdownMenuItem onClick={() => setDlg({ f })}>
                                <Pencil /> Editar
                              </DropdownMenuItem>
                            )}
                            {podeExcluir && (
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluir(f)}>
                                <Trash2 /> Excluir
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
      <FornecedorDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} fornecedor={dlg?.f ?? null} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir ${excluir?.nome ?? ""}?`}
        descricao={excluir?.qtd_contas ? "Ele tem contas lançadas: será desativado e o histórico fica." : "O fornecedor será apagado."}
        confirmar={excluir?.qtd_contas ? "Desativar" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
