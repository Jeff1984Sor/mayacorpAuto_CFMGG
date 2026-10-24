"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, ChevronRight, ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, Info, ListOrdered, Percent, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { ContasMulti, useContasBancarias } from "@/components/financeiro/comum";
import { Periodo, Stat } from "@/components/financeiro/ui";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, baixar } from "@/lib/api";
import { moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

interface LinhaDre {
  chave: string;
  rotulo: string;
  tipo: "grupo" | "subtotal";
  total: number;
  meses: Record<string, number>;
  itens?: { categoria: string; total: number; meses: Record<string, number> }[];
}

interface Dre {
  de: string;
  ate: string;
  meses: string[];
  linhas: LinhaDre[];
  margem: number | null;
  receita_bruta: number;
  resultado: number;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
const inicioAno = () => new Date(new Date().getFullYear(), 0, 1).toLocaleDateString("sv-SE");
const hoje = () => new Date().toLocaleDateString("sv-SE");

function Valor({ v, forte, neutro }: { v: number | undefined; forte?: boolean; neutro?: boolean }) {
  if (v == null || Math.abs(v) < 0.005) return <span className="text-muted-foreground/50">—</span>;
  return <span className={cn("font-mono tabular-nums", forte && "font-semibold", !neutro && v < 0 && "text-danger-ink")}>{moeda(v)}</span>;
}

export default function DrePage() {
  const [periodo, setPeriodo] = useState({ de: inicioAno(), ate: hoje() });
  const [contas, setContas] = useState<number[]>([]);
  const [mensal, setMensal] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const todasContas = useContasBancarias();
  const params = { de: periodo.de, ate: periodo.ate, mensal, conta_ids: contas };
  const q = useQuery({ queryKey: ["fin", "dre", params], queryFn: () => api.get<Dre>("/financeiro/dre", params), placeholderData: (p) => p });
  const r = q.data;
  const naoClass = r?.linhas.find((l) => l.chave === "nao_classificado");
  const grupos = (r?.linhas ?? []).filter((l) => l.tipo === "grupo" && l.itens?.length);
  const tudoAberto = grupos.length > 0 && grupos.every((g) => abertos.has(g.chave));
  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const variasContas = (todasContas.data?.length ?? 0) > 1;

  return (
    <div>
      <PageHeader
        titulo="DRE"
        descricao="Demonstrativo de resultado gerencial: receitas e despesas pelo grupo de cada categoria."
        icone={ListOrdered}
        migalhas={[{ label: "Conta Bancária" }, { label: "DRE" }]}
        acoes={
          <Button variant="outline" onClick={() => baixar("/financeiro/dre.xlsx", { query: { de: periodo.de, ate: periodo.ate, conta_ids: contas } }, "dre.xlsx")}>
            <FileSpreadsheet /> Exportar Excel
          </Button>
        }
      />
      <div className="card-surface mb-5 flex flex-wrap items-end gap-3 p-4">
        <Periodo idBase="dre" de={periodo.de} ate={periodo.ate} onChange={(de, ate) => setPeriodo({ de, ate })} />
        {variasContas && (
          <Field label="Contas" htmlFor="dre-contas" className="w-full sm:w-60">
            <ContasMulti id="dre-contas" valor={contas} onChange={setContas} />
          </Field>
        )}
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={mensal} onCheckedChange={setMensal} aria-label="Mês a mês" /> Mês a mês
        </label>
      </div>

      <p className="mb-4 flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Regime de caixa: vale a data em que o dinheiro entrou ou saiu. Cada categoria cai na linha definida no campo “Grupo da DRE” em{" "}
          <Link href="/financeiro/categorias" className="text-info-ink hover:underline">
            Categorias
          </Link>
          .{variasContas && " Transferências entre contas aparecem numa linha própria: com todas as contas elas se anulam."}
        </span>
      </p>

      {q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !r ? null : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat rotulo="Receita bruta" valor={moeda(r.receita_bruta)} icone={TrendingUp} tom="brand" />
            <Stat rotulo="Resultado líquido" valor={moeda(r.resultado)} icone={Wallet} tom={r.resultado < 0 ? "danger" : "success"} destaque />
            <Stat
              rotulo="Margem"
              valor={r.margem == null ? "—" : `${r.margem.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              icone={Percent}
              tom={r.margem == null ? undefined : r.margem < 0 ? "danger" : "success"}
              sub="Resultado ÷ receita bruta"
            />
          </div>

          {naoClass && naoClass.itens?.length ? (
            <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-ink">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>
                {naoClass.itens.length} categoria(s) sem grupo da DRE somam {moeda(naoClass.total)} em “Não classificado”.{" "}
                <Link href="/financeiro/categorias" className="font-medium underline">
                  Classificar agora
                </Link>
              </span>
            </p>
          ) : null}

          {r.linhas.every((l) => !l.total) ? (
            <div className="card-surface">
              <EmptyState icone={ListOrdered} titulo="Nenhum movimento no período" descricao="Lance o extrato das contas para ver o resultado." />
            </div>
          ) : (
            <section className="card-surface overflow-hidden" aria-label="DRE">
              <div className="flex justify-end border-b px-3 py-2">
                <Button variant="ghost" size="xs" onClick={() => setAbertos(tudoAberto ? new Set() : new Set(grupos.map((g) => g.chave)))}>
                  {tudoAberto ? <ChevronsDownUp /> : <ChevronsUpDown />} {tudoAberto ? "Recolher tudo" : "Abrir tudo"}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className={cn("w-full text-sm", mensal && "min-w-[900px]")}>
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="sticky left-0 z-10 min-w-64 bg-muted px-4 py-2.5 text-left font-medium">Linha</th>
                      {r.meses.map((m) => (
                        <th key={m} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                          {rotuloMes(m)}
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right font-medium">Total</th>
                      {!mensal && <th className="w-20 px-3 py-2.5 text-right font-medium">% receita</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {r.linhas.map((l) => {
                      const sub = l.tipo === "subtotal";
                      const transf = l.chave === "transferencias";
                      const aberto = abertos.has(l.chave);
                      const temItens = !!l.itens?.length;
                      const resultado = l.chave === "resultado_liquido" || l.chave === "geracao_caixa";
                      return (
                        <Fragment key={l.chave}>
                          <tr
                            className={cn(
                              "border-b",
                              sub && "bg-brand/[0.05] font-semibold",
                              resultado && "bg-brand/10",
                              transf && "bg-muted/40 text-muted-foreground italic",
                              temItens && "cursor-pointer hover:bg-accent/40",
                            )}
                            onClick={() => temItens && alternar(l.chave)}
                          >
                            <td className={cn("sticky left-0 z-10 px-4 py-2.5", sub ? "bg-[color-mix(in_oklab,var(--brand)_6%,var(--card))]" : "bg-card", transf && "bg-muted")}>
                              <span className="flex items-center gap-1.5">
                                {temItens ? (
                                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                {sub ? <span className="uppercase tracking-wide">{l.rotulo}</span> : l.rotulo}
                                {transf && (
                                  <Tooltip>
                                    <TooltipTrigger render={<span className="inline-flex" />}>
                                      <ArrowLeftRight className="size-3.5" aria-label="Sobre transferências" />
                                    </TooltipTrigger>
                                    <TooltipContent>Movimentação entre contas do escritório — não é receita nem despesa</TooltipContent>
                                  </Tooltip>
                                )}
                              </span>
                            </td>
                            {r.meses.map((m) => (
                              <td key={m} className="px-3 py-2.5 text-right whitespace-nowrap">
                                <Valor v={l.meses[m]} forte={sub} neutro={transf} />
                              </td>
                            ))}
                            <td className={cn("px-4 py-2.5 text-right whitespace-nowrap", resultado && "text-base")}>
                              {resultado ? (
                                <span className={cn("font-mono font-bold tabular-nums", l.total < 0 ? "text-danger-ink" : "text-success-ink")}>{moeda(l.total)}</span>
                              ) : (
                                <Valor v={l.total} forte={sub} neutro={transf} />
                              )}
                            </td>
                            {!mensal && (
                              <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                                {r.receita_bruta && !transf ? `${((l.total / r.receita_bruta) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}
                              </td>
                            )}
                          </tr>
                          {aberto &&
                            l.itens?.map((it) => (
                              <tr key={`${l.chave}-${it.categoria}`} className={cn("border-b text-xs", transf ? "bg-muted/20 text-muted-foreground" : "bg-muted/10")}>
                                <td className="sticky left-0 z-10 bg-card py-2 pr-4 pl-11">{it.categoria}</td>
                                {r.meses.map((m) => (
                                  <td key={m} className="px-3 py-2 text-right whitespace-nowrap">
                                    <Valor v={it.meses[m]} neutro={transf} />
                                  </td>
                                ))}
                                <td className="px-4 py-2 text-right whitespace-nowrap">
                                  <Valor v={it.total} neutro={transf} />
                                </td>
                                {!mensal && (
                                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                                    {r.receita_bruta && !transf ? `${((it.total / r.receita_bruta) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : ""}
                                  </td>
                                )}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
