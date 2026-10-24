"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ClientesMulti, type ClienteEscolhido } from "@/components/faturamento/clientes-multi";
import { useAreas } from "@/components/faturamento/campos-adicionais";
import { CasoDialog } from "@/components/faturamento/dialogos";
import { AreaBadge } from "@/components/faturamento/ficha-caso";
import { PlanilhaAcoes } from "@/components/faturamento/importar-planilha";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type CasoOut, ROTULO_TIPO_CASO, type TipoCaso } from "@/lib/faturamento";
import { data, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CasosPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { isOperador, isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 300);
  const [status, setStatus] = useState<"aberto" | "encerrado" | "todos">("aberto");
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [tipo, setTipo] = useState<TipoCaso | "">("");
  const [areaId, setAreaId] = useState("");
  const areas = useAreas();
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<CasoOut | null>(null);
  const [excluir, setExcluir] = useState<CasoOut | null>(null);
  const lista = useQuery({
    queryKey: ["fat", "casos", busca, status, cliente[0]?.id ?? null, tipo, areaId],
    queryFn: () =>
      api.get<CasoOut[]>("/faturamento/casos", {
        q: busca || undefined,
        status: status === "todos" ? undefined : status,
        tomador_id: cliente[0]?.id,
        tipo: tipo || undefined,
        area_id: areaId || undefined,
      }),
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/faturamento/casos/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fat"] });
      setExcluir(null);
    },
  });
  const itens = lista.data ?? [];
  const filtrando = !!(busca || cliente.length || status !== "aberto" || tipo || areaId);
  const abrir = (c: CasoOut) => router.push(`/faturamento/casos/${c.id}`);

  return (
    <div>
      <PageHeader
        titulo="Casos"
        icone={Briefcase}
        migalhas={[{ label: "Cadastros" }, { label: "Casos" }]}
        acoes={
          <>
            <PlanilhaAcoes recurso="casos" rotulo="casos" podeImportar={isOperador} />
            {isOperador && (
              <Button onClick={() => setNovo(true)}>
                <FolderPlus /> Novo caso
              </Button>
            )}
          </>
        }
      />
      <TableCard>
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Título, nº do caso, processo ou parte contrária" className="sm:w-80" />
            <div className="sm:w-64">
              <ClientesMulti unico id="casos-cliente" valor={cliente} onChange={setCliente} />
            </div>
            <NativeSelect aria-label="Tipo do caso" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCaso | "")} className="h-9 sm:w-44">
              <option value="">Todos os tipos</option>
              {Object.entries(ROTULO_TIPO_CASO).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            {(areas.data?.length ?? 0) > 0 && (
              <NativeSelect aria-label="Área de atuação" value={areaId} onChange={(e) => setAreaId(e.target.value)} className="h-9 sm:w-44">
                <option value="">Todas as áreas</option>
                {areas.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Segmented
              value={status}
              onChange={setStatus}
              opcoes={[
                { value: "aberto", label: "Abertos" },
                { value: "encerrado", label: "Encerrados" },
                { value: "todos", label: "Todos" },
              ]}
            />
          </div>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={8} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={Briefcase}
            titulo={filtrando ? "Nenhum caso encontrado" : "Nenhum caso ainda"}
            descricao={filtrando ? "Troque a busca, o cliente ou a situação." : "Cada caso pertence a um contrato e recebe horas e despesas."}
            acao={
              isOperador &&
              !filtrando && (
                <Button onClick={() => setNovo(true)}>
                  <FolderPlus /> Novo caso
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nº</th>
                  <th className="px-3 py-2.5 font-medium">Caso</th>
                  <th className="px-3 py-2.5 font-medium">Área · Tipo · Instância</th>
                  <th className="px-3 py-2.5 font-medium">Cliente · Contrato</th>
                  <th className="px-3 py-2.5 font-medium">Responsável</th>
                  <th className="px-3 py-2.5 text-right font-medium">Horas a faturar</th>
                  <th className="px-3 py-2.5 text-right font-medium">Despesas a faturar</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="w-10 px-3 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    className={cn(linhaClicavel, "focus-visible:bg-accent/40 focus-visible:outline-none", c.status === "encerrado" && "opacity-60")}
                    onClick={() => abrir(c)}
                    onKeyDown={(e) => e.key === "Enter" && abrir(c)}
                  >
                    <td className="px-4 py-3 font-mono font-semibold">#{c.numero}</td>
                    <td className="max-w-72 px-3 py-3">
                      <p className="truncate font-medium">{c.titulo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.numero_processo ? <span className="font-mono">{c.numero_processo}</span> : null}
                        {c.numero_processo && c.parte_contraria ? " · " : ""}
                        {c.parte_contraria}
                        {!c.numero_processo && !c.parte_contraria && c.data_abertura ? `aberto em ${data(c.data_abertura)}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        {c.area_nome ? <AreaBadge nome={c.area_nome} cor={c.area_cor} /> : <span className="text-xs text-muted-foreground">—</span>}
                        {c.tipo_nome && <span className="text-[11px] text-muted-foreground">{c.tipo_nome}</span>}
                        {c.instancia_nome && <span className="text-[11px] text-muted-foreground">{c.instancia_nome}{c.tribunal ? ` · ${c.tribunal}` : ""}</span>}
                      </div>
                    </td>
                    <td className="max-w-64 px-3 py-3">
                      <p className="truncate">{c.tomador_nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        #{c.contrato_numero} {c.contrato_nome}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{c.responsavel_nome ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(c.horas_pendentes) ? `${String(c.horas_pendentes).replace(".", ",")} h` : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{Number(c.despesas_pendentes) ? moeda(c.despesas_pendentes) : "—"}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={c.status === "aberto" ? "ativo" : "descartado"} label={c.status === "aberto" ? "Aberto" : "Encerrado"} />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {isOperador && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações do caso ${c.numero}`} />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditar(c)}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            {isAdmin && (
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluir(c)}>
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
      <CasoDialog open={novo} onOpenChange={setNovo} onSalvo={(c) => router.push(`/faturamento/casos/${c.id}`)} />
      <CasoDialog open={!!editar} onOpenChange={(o) => !o && setEditar(null)} contratoId={editar?.contrato_id} caso={editar} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o caso #${excluir?.numero}?`}
        descricao="Se o caso já tiver horas, despesas, regras ou faturas, ele é apenas encerrado e o histórico fica guardado."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
