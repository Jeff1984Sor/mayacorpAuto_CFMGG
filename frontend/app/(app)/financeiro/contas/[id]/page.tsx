"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  Landmark,
  MoreHorizontal,
  Pencil,
  Plus,
  Receipt,
  Scale,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { mesAtual } from "@/components/financeiro/comum";
import { ContaForm } from "@/components/financeiro/contas/conta-form";
import { ImportarExtratoDialog } from "@/components/financeiro/contas/importar-dialog";
import { LancamentoDialog } from "@/components/financeiro/contas/lancamento-dialog";
import { TransferenciaDialog } from "@/components/financeiro/contas/transferencia-dialog";
import { Periodo, Stat } from "@/components/financeiro/ui";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type ExtratoOut, type LancamentoOut, ROTULO_TIPO_CONTA } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const ORIGEM: Record<string, { l: string; tom: "brand" | "info" | "success" | "neutral" | "warning" }> = {
  fatura: { l: "Fatura", tom: "success" },
  conta_pagar: { l: "Conta a pagar", tom: "warning" },
  transferencia: { l: "Transferência", tom: "info" },
  importacao: { l: "Importado", tom: "neutral" },
};

function LinkOrigem({ l }: { l: LancamentoOut }) {
  if (l.fatura_id)
    return (
      <Link href={`/nfse/faturas/${l.fatura_id}`} className="font-mono text-[11px] text-info-ink hover:underline">
        {l.fatura_codigo ?? "ver fatura"}
      </Link>
    );
  if (l.conta_pagar_id)
    return (
      <Link href={`/financeiro/pagar/${l.conta_pagar_id}`} className="text-[11px] text-info-ink hover:underline">
        ver conta a pagar
      </Link>
    );
  return null;
}

export default function ExtratoPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("contas_bancarias.editar");
  const podeExcluir = pode("contas_bancarias.excluir");
  const [periodo, setPeriodo] = useState(mesAtual);
  const [lanc, setLanc] = useState<{ l: LancamentoOut | null } | null>(null);
  const [excluir, setExcluir] = useState<LancamentoOut | null>(null);
  const [transf, setTransf] = useState(false);
  const [importar, setImportar] = useState(false);
  const [editarConta, setEditarConta] = useState(false);
  const [excluirConta, setExcluirConta] = useState(false);
  const q = useQuery({
    queryKey: ["fin", "extrato", cid, periodo.de, periodo.ate],
    queryFn: () => api.get<ExtratoOut>(`/financeiro/contas/${cid}/extrato`, { de: periodo.de, ate: periodo.ate }),
    placeholderData: (p) => p,
  });
  const remover = useMutation({
    mutationFn: (lid: number) => api.del<{ mensagem: string }>(`/financeiro/lancamentos/${lid}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fin"] });
    },
  });
  const removerConta = useMutation({
    mutationFn: () => api.del<{ mensagem: string }>(`/financeiro/contas/${cid}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fin"] });
      router.push("/financeiro/contas");
    },
  });

  if (q.isPending)
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  if (!q.data)
    return (
      <EmptyState
        icone={Landmark}
        titulo="Conta não encontrada"
        acao={
          <Button variant="outline" render={<Link href="/financeiro/contas" />}>
            Voltar
          </Button>
        }
      />
    );
  const e = q.data;
  const c = e.conta;
  const saldoAtual = toNum(c.saldo_atual);

  return (
    <div>
      <Link href="/financeiro/contas" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Contas
      </Link>
      <div className="card-surface relative mb-5 overflow-hidden p-5 pl-6">
        <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: c.cor }} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.nome}</h1>
              {!c.ativo && <Pill tom="neutral">inativa</Pill>}
            </div>
            <p className="text-sm text-muted-foreground">
              {ROTULO_TIPO_CONTA[c.tipo]}
              {c.banco && ` · ${c.banco}`}
              {c.agencia && (
                <>
                  {" · ag "}
                  <span className="font-mono">{c.agencia}</span>
                </>
              )}
              {c.numero && (
                <>
                  {" · cc "}
                  <span className="font-mono">{c.numero}</span>
                </>
              )}
              {c.titular && ` · ${c.titular}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {podeEditar && (
              <>
                <Button onClick={() => setLanc({ l: null })}>
                  <Plus /> Lançamento
                </Button>
                <Button variant="outline" onClick={() => setTransf(true)}>
                  <ArrowLeftRight /> Transferência
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Mais ações da conta" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => baixar(`/financeiro/contas/${cid}/extrato.xlsx`, { query: { de: periodo.de, ate: periodo.ate } }, "extrato.xlsx")}>
                  <FileSpreadsheet /> Exportar Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => baixar(`/financeiro/contas/${cid}/modelo.xlsx`, {}, "modelo_extrato.xlsx")}>
                  <Download /> Baixar modelo
                </DropdownMenuItem>
                {podeEditar && (
                  <DropdownMenuItem onClick={() => setImportar(true)}>
                    <Upload /> Importar planilha
                  </DropdownMenuItem>
                )}
                {(podeEditar || podeExcluir) && <DropdownMenuSeparator />}
                {podeEditar && (
                  <DropdownMenuItem onClick={() => setEditarConta(true)}>
                    <Pencil /> Editar conta
                  </DropdownMenuItem>
                )}
                {podeExcluir && (
                  <DropdownMenuItem variant="destructive" onClick={() => setExcluirConta(true)}>
                    <Trash2 /> Excluir conta
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-4 border-t pt-4">
          <Periodo idBase="extrato" de={periodo.de} ate={periodo.ate} onChange={(de, ate) => setPeriodo({ de, ate })} />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat rotulo="Entradas" valor={moeda(e.entradas)} tom="success" icone={ArrowDownLeft} />
        <Stat rotulo="Saídas" valor={moeda(e.saidas)} tom="danger" icone={ArrowUpRight} />
        <Stat rotulo="Saldo do período" valor={moeda(e.saldo_periodo)} tom={toNum(e.saldo_periodo) < 0 ? "danger" : "success"} icone={Scale} sub={`Saldo no fim: ${moeda(e.saldo_final)}`} />
        <Stat rotulo="Saldo atual" valor={moeda(saldoAtual)} tom={saldoAtual < 0 ? "danger" : "success"} icone={Wallet} destaque />
      </div>

      <section className={cn("card-surface overflow-hidden transition-opacity", q.isFetching && "opacity-70")} aria-label="Extrato">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Data</th>
                <th className="px-3 py-2.5 font-medium">Descrição</th>
                <th className="px-3 py-2.5 font-medium">Categoria › Sub</th>
                <th className="px-3 py-2.5 text-right font-medium">Entrada</th>
                <th className="px-3 py-2.5 text-right font-medium">Saída</th>
                <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr className="bg-muted/20">
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{data(e.de)}</td>
                <td className="px-3 py-2.5 font-medium text-muted-foreground" colSpan={4}>
                  Saldo anterior
                </td>
                <td className={cn("px-3 py-2.5 text-right font-mono font-semibold tabular-nums", toNum(e.saldo_anterior) < 0 && "text-danger-ink")}>{moeda(e.saldo_anterior)}</td>
                <td />
              </tr>
              {e.linhas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    <Receipt className="mx-auto mb-2 size-6 opacity-50" />
                    Nenhum lançamento no período.
                    {podeEditar && (
                      <>
                        {" "}
                        <button type="button" onClick={() => setLanc({ l: null })} className="font-medium text-info-ink hover:underline">
                          Lançar agora
                        </button>{" "}
                        ou{" "}
                        <button type="button" onClick={() => setImportar(true)} className="font-medium text-info-ink hover:underline">
                          importar a planilha
                        </button>
                        .
                      </>
                    )}
                  </td>
                </tr>
              )}
              {e.linhas.map((l) => {
                const ent = l.tipo === "credito";
                const o = ORIGEM[l.origem];
                return (
                  <tr key={l.id} className="group hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{data(l.data)}</td>
                    <td className="max-w-80 px-3 py-2.5">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate">{l.descricao}</span>
                        {o && <Pill tom={o.tom}>{o.l}</Pill>}
                      </p>
                      <p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                        {l.favorecido_nome && <span>{l.favorecido_nome}</span>}
                        {l.documento && <span className="font-mono">doc {l.documento}</span>}
                        <LinkOrigem l={l} />
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {l.categoria_nome ? (
                        <>
                          {l.categoria_nome}
                          {l.subcategoria_nome && <span className="text-muted-foreground"> › {l.subcategoria_nome}</span>}
                        </>
                      ) : l.origem === "transferencia" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-warning-ink">sem categoria</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap text-success-ink tabular-nums">{ent ? moeda(l.valor) : ""}</td>
                    <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap text-danger-ink tabular-nums">{!ent ? moeda(l.valor) : ""}</td>
                    <td className={cn("px-3 py-2.5 text-right font-mono whitespace-nowrap tabular-nums", toNum(l.saldo) < 0 && "text-danger-ink")}>{moeda(l.saldo)}</td>
                    <td className="px-3 py-2.5">
                      {(podeEditar || podeExcluir) && l.editavel && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${l.descricao}`} className="opacity-60 group-hover:opacity-100" />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {podeEditar && (
                              <DropdownMenuItem onClick={() => setLanc({ l })}>
                                <Pencil /> Editar
                              </DropdownMenuItem>
                            )}
                            {podeExcluir && (
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluir(l)}>
                                <Trash2 /> Excluir
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {e.linhas.length > 0 && (
              <tfoot className="border-t bg-muted/30 font-medium">
                <tr>
                  <td colSpan={3} className="px-4 py-2.5 text-xs text-muted-foreground">
                    {e.linhas.length} lançamento(s) de {data(e.de)} a {data(e.ate)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-success-ink tabular-nums">{moeda(e.entradas)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-danger-ink tabular-nums">{moeda(e.saidas)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono font-semibold tabular-nums", toNum(e.saldo_final) < 0 && "text-danger-ink")}>{moeda(e.saldo_final)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
      <p className="mt-2 text-xs text-muted-foreground">Lançamentos de faturas, contas a pagar e transferências são alterados na tela de origem.</p>

      <LancamentoDialog open={!!lanc} onOpenChange={(o) => !o && setLanc(null)} contaId={cid} lancamento={lanc?.l ?? null} />
      <TransferenciaDialog open={transf} onOpenChange={setTransf} origemId={cid} />
      <ImportarExtratoDialog open={importar} onOpenChange={setImportar} contaId={cid} contaNome={c.nome} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este lançamento?"
        descricao={excluir ? `${excluir.descricao} · ${moeda(excluir.valor)} em ${data(excluir.data)}` : ""}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
      <ConfirmDialog
        open={excluirConta}
        onOpenChange={setExcluirConta}
        titulo={`Excluir a conta ${c.nome}?`}
        descricao={c.qtd_lancamentos ? `Ela tem ${c.qtd_lancamentos} lançamento(s): será desativada e o histórico fica.` : "A conta não tem lançamentos e será apagada."}
        confirmar={c.qtd_lancamentos ? "Desativar" : "Excluir"}
        destrutivo
        carregando={removerConta.isPending}
        onConfirm={() => removerConta.mutate()}
      />
      <Dialog open={editarConta} onOpenChange={setEditarConta}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Editar conta</DialogTitle>
          <ContaForm conta={c} onSalvo={() => setEditarConta(false)} onCancelar={() => setEditarConta(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
