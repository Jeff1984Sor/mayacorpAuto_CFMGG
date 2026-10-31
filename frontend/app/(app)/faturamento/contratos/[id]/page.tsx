"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Briefcase, FileSignature, FolderPlus, Loader2, Pencil, Receipt, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { CasoDialog, ContratoDialog } from "@/components/faturamento/dialogos";
import { useEmitirNfse } from "@/components/faturamento/emitir";
import { RegrasCobranca } from "@/components/faturamento/regras";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type CasoOut, type ContratoOut, horasDecimal, textoPagadores } from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import type { FaturaOut, Pagina } from "@/lib/types";
import { cn } from "@/lib/utils";

function Kpi({ rotulo, valor, sub, tom }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode; tom?: string }) {
  return (
    <div className="rounded-xl border bg-background/60 px-4 py-3 backdrop-blur">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tom)}>{valor}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Casos({ contrato }: { contrato: ContratoOut }) {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEditar = pode("casos.editar");
  const [novo, setNovo] = useState(false);
  const q = useQuery({ queryKey: ["fat", "casos", contrato.id], queryFn: () => api.get<CasoOut[]>("/faturamento/casos", { contrato_id: contrato.id }) });
  const casos = q.data ?? [];
  return (
    <div className="space-y-4">
      {podeEditar && casos.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setNovo(true)}>
            <FolderPlus /> Novo caso
          </Button>
        </div>
      )}
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : casos.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Briefcase}
            titulo="Nenhum caso neste contrato"
            descricao="Casos recebem horas e despesas, e podem ter regra de cobrança própria."
            acao={
              podeEditar && (
                <Button onClick={() => setNovo(true)}>
                  <FolderPlus /> Novo caso
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Nº</th>
                <th className="px-3 py-2.5 font-medium">Caso</th>
                <th className="px-3 py-2.5 font-medium">Responsável</th>
                <th className="px-3 py-2.5 font-medium">Tabela</th>
                <th className="px-3 py-2.5 text-right font-medium">Horas pendentes</th>
                <th className="px-3 py-2.5 text-right font-medium">Despesas pendentes</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {casos.map((c) => (
                <tr
                  key={c.id}
                  tabIndex={0}
                  className={cn(linhaClicavel, "focus-visible:bg-accent/40 focus-visible:outline-none")}
                  onClick={() => router.push(`/faturamento/casos/${c.id}`)}
                  onKeyDown={(e) => e.key === "Enter" && router.push(`/faturamento/casos/${c.id}`)}
                >
                  <td className="px-4 py-3 font-mono font-semibold">#{c.numero}</td>
                  <td className="max-w-80 px-3 py-3">
                    <p className="flex items-center gap-1.5 truncate font-medium">
                      {c.titulo}
                      {c.tem_regra_propria && <Pill tom="brand">regra própria</Pill>}
                    </p>
                    {c.numero_processo && <p className="truncate font-mono text-[11px] text-muted-foreground">{c.numero_processo}</p>}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{c.responsavel_nome ?? "—"}</td>
                  <td className="px-3 py-3 text-xs">{c.tabela_preco_efetiva ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{toNum(c.horas_pendentes) ? horasDecimal(c.horas_pendentes) : "—"}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{toNum(c.despesas_pendentes) ? moeda(c.despesas_pendentes) : "—"}</td>
                  <td className="px-3 py-3">
                    <StatusBadge tom={c.status === "aberto" ? "success" : "neutral"} label={c.status === "aberto" ? "Aberto" : "Encerrado"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CasoDialog open={novo} onOpenChange={setNovo} contratoId={contrato.id} onSalvo={(c) => router.push(`/faturamento/casos/${c.id}`)} />
    </div>
  );
}

function Faturas({ faturas, carregando }: { faturas: FaturaOut[]; carregando: boolean }) {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEmitir = pode("nfse_emissao.emitir");
  const emitir = useEmitirNfse();
  if (carregando) return <Skeleton className="h-40 rounded-2xl" />;
  if (faturas.length === 0)
    return (
      <div className="card-surface">
        <EmptyState
          icone={Receipt}
          titulo="Nenhuma fatura deste contrato"
          descricao="As faturas aparecem aqui depois de aprovadas em Revisões ou faturadas direto."
          acao={
            <Button render={<Link href="/faturamento/itens" />}>
              Ir para Itens a faturar
            </Button>
          }
        />
      </div>
    );
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Fatura</th>
            <th className="px-3 py-2.5 font-medium">NFS-e</th>
            <th className="px-3 py-2.5 font-medium">Emissão</th>
            <th className="px-3 py-2.5 font-medium">Vencimento</th>
            <th className="px-3 py-2.5 text-right font-medium">Total</th>
            <th className="px-3 py-2.5 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {faturas.map((f) => (
            <tr key={f.id} className={linhaClicavel} onClick={() => router.push(`/nfse/faturas/${f.id}`)}>
              <td className="px-4 py-3 whitespace-nowrap">
                <Pill tom={f.tipo === "despesas" ? "info" : "brand"} className="mr-1.5">
                  {f.tipo === "despesas" ? "ND" : "NH"}
                </Pill>
                <span className="font-mono font-semibold">{f.codigo}</span>
              </td>
              <td className="px-3 py-3" onClick={(e) => f.pode_emitir_nfse && e.stopPropagation()}>
                {f.nfse_numero ? (
                  <span className="font-mono">{f.nfse_numero}</span>
                ) : f.pode_emitir_nfse && podeEmitir ? (
                  <Button size="xs" variant="outline" onClick={() => emitir.mutate([f.id])} disabled={emitir.isPending}>
                    {emitir.isPending ? <Loader2 className="animate-spin" /> : <Receipt />} Emitir NFS-e
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">{f.tipo === "despesas" ? "não se aplica" : "Sem NFS-e"}</span>
                )}
              </td>
              <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{data(f.data_emissao)}</td>
              <td className={cn("px-3 py-3 font-mono text-xs", f.situacao === "vencida" ? "font-medium text-danger-ink" : "text-muted-foreground")}>{data(f.data_vencimento)}</td>
              <td className="px-3 py-3 text-right font-mono whitespace-nowrap tabular-nums">{moeda(f.total)}</td>
              <td className="px-3 py-3">
                <StatusBadge status={f.situacao} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ContratoPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("contratos.editar");
  const podeExcluir = pode("contratos.excluir");
  const emissoras = useEmissoras();
  const [editar, setEditar] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const q = useQuery({ queryKey: ["fat", "contrato", cid], queryFn: () => api.get<ContratoOut>(`/faturamento/contratos/${cid}`) });
  const fat = useQuery({
    queryKey: ["faturas", "contrato", cid],
    queryFn: () => api.get<Pagina<FaturaOut>>("/nfse/faturas", { contrato_id: cid, por_pagina: 200 }),
    enabled: pode("faturas.ver"),
  });
  const remover = useMutation({
    mutationFn: () => api.del<{ mensagem: string }>(`/faturamento/contratos/${cid}`),
    onSuccess: (r) => {
      toast.success(r.mensagem ?? "Contrato excluído");
      qc.invalidateQueries({ queryKey: ["fat"] });
      router.push("/faturamento/contratos");
    },
  });

  if (q.isPending) return <Skeleton className="h-48 rounded-2xl" />;
  if (!q.data)
    return (
      <EmptyState
        icone={FileSignature}
        titulo="Contrato não encontrado"
        acao={
          <Button variant="outline" render={<Link href="/faturamento/contratos" />}>
            Voltar
          </Button>
        }
      />
    );
  const c = q.data;
  const faturas = (fat.data?.itens ?? []).filter((f) => f.status !== "cancelada");
  const soma = (fs: FaturaOut[]) => fs.reduce((a, f) => a + toNum(f.total), 0);
  const recebido = soma(faturas.filter((f) => f.situacao === "paga"));
  const aberto = soma(faturas.filter((f) => f.situacao === "aberta" || f.situacao === "vencida"));
  const vencido = soma(faturas.filter((f) => f.situacao === "vencida"));
  const emissora = emissoras.data?.find((e) => e.id === c.emissora_id);

  return (
    <div>
      <Link href="/faturamento/contratos" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Contratos
      </Link>
      <div className="card-surface relative mb-5 overflow-hidden">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
        <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">#{c.numero}</span>
                <h1 className="text-2xl font-semibold tracking-tight">{c.nome}</h1>
                <StatusBadge status={c.ativo ? "ativo" : "descartado"} label={c.ativo ? "Ativo" : "Encerrado"} />
              </div>
              <p className="mt-1 text-sm">
                <span className="font-medium">{c.tomador_nome}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {c.data_inicio ? `desde ${data(c.data_inicio)}` : "sem início definido"}
                  {c.data_fim && ` até ${data(c.data_fim)}`}
                  {emissora && ` · emite por ${nomeEmissora(emissora)}`}
                  {c.tabela_preco_nome && ` · tabela ${c.tabela_preco_nome}`}
                </span>
              </p>
              {textoPagadores(c.pagadores) && (
                <p className="mt-1 text-sm font-medium text-info-ink">{textoPagadores(c.pagadores)}</p>
              )}
              {c.objeto && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{c.objeto}</p>}
            </div>
            {podeEditar && (
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditar(true)}>
                  <Pencil /> Editar
                </Button>
                {podeExcluir && (
                  <Button variant="ghost" size="icon-sm" onClick={() => setExcluir(true)} aria-label="Excluir contrato">
                    <Trash2 />
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi rotulo="Faturado" valor={moeda(soma(faturas))} sub={`${faturas.length} fatura(s)`} />
            <Kpi rotulo="Recebido" valor={moeda(recebido)} tom="text-success-ink" />
            <Kpi rotulo="Em aberto" valor={moeda(aberto)} sub={vencido > 0 ? <span className="text-danger-ink">{moeda(vencido)} vencido</span> : undefined} />
            <Kpi rotulo="Casos" valor={c.qtd_casos} />
            <Kpi rotulo="Regras ativas" valor={c.qtd_regras} tom={c.qtd_regras === 0 ? "text-warning-ink" : undefined} sub={c.qtd_regras === 0 ? "nada será cobrado" : undefined} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="regras">
        <TabsList>
          <TabsTrigger value="regras">Regras de cobrança</TabsTrigger>
          <TabsTrigger value="casos">Casos ({c.qtd_casos})</TabsTrigger>
          <TabsTrigger value="faturas" className={cn(!pode("faturas.ver") && "hidden")}>Faturas ({faturas.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="regras" className="pt-4">
          <RegrasCobranca contratoId={c.id} />
        </TabsContent>
        <TabsContent value="casos" className="pt-4">
          <Casos contrato={c} />
        </TabsContent>
        <TabsContent value="faturas" className="pt-4">
          <Faturas faturas={fat.data?.itens ?? []} carregando={fat.isPending} />
        </TabsContent>
      </Tabs>

      <ContratoDialog open={editar} onOpenChange={setEditar} contrato={c} />
      <ConfirmDialog
        open={excluir}
        onOpenChange={setExcluir}
        titulo={`Excluir o contrato #${c.numero}?`}
        descricao="Só é possível excluir contratos sem faturas. Com histórico, prefira marcar como encerrado em Editar."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => remover.mutate()}
      />
    </div>
  );
}
