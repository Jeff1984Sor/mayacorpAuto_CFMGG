"use client";

import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, GraduationCap, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ContaSelect } from "@/components/financeiro/comum";
import { EnviarExtratoDialog } from "@/components/financeiro/conciliacao/comum";
import { RegrasDialog } from "@/components/financeiro/conciliacao/extras";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ConciliacaoOut } from "@/lib/conciliacao";
import { data, dataHora } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ConciliacoesPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const podeConciliar = pode("conciliacao.conciliar");
  const [conta, setConta] = useState<number | null>(null);
  const [enviar, setEnviar] = useState(false);
  const [regras, setRegras] = useState(false);
  const q = useQuery({
    queryKey: ["fin", "conciliacao", "lista", conta],
    queryFn: () => api.get<ConciliacaoOut[]>("/financeiro/conciliacao", { conta_id: conta }),
    placeholderData: (p) => p,
  });
  const lista = q.data ?? [];
  return (
    <div>
      <PageHeader
        titulo="Conciliação bancária"
        descricao="Suba o extrato do banco: o sistema compara com as contas a pagar, as faturas e o que já está lançado, e mostra o que falta para você revisar."
        icone={GitCompareArrows}
        analiseIA={false}
        acoes={
          <>
            <Button variant="outline" onClick={() => setRegras(true)}>
              <GraduationCap /> O que o sistema aprendeu
            </Button>
            {podeConciliar && (
              <Button onClick={() => setEnviar(true)}>
                <UploadCloud /> Conciliar extrato
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-72">
          <ContaSelect value={conta} onChange={setConta} vazio="Todas as contas" id="filtro-conta" />
        </div>
        {conta !== null && (
          <Button variant="ghost" size="sm" onClick={() => setConta(null)}>
            Limpar filtro
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-72 rounded-2xl" />
      ) : lista.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={GitCompareArrows}
            titulo={conta ? "Nenhum extrato conciliado nesta conta" : "Nenhum extrato conciliado ainda"}
            descricao="Baixe o extrato no site do banco (OFX, CSV ou Excel) e suba aqui. Nada é lançado sem a sua confirmação."
            acao={
              podeConciliar ? (
                <Button onClick={() => setEnviar(true)}>
                  <UploadCloud /> Conciliar extrato
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <section className={cn("card-surface overflow-hidden transition-opacity", q.isFetching && "opacity-70")} aria-label="Extratos conciliados">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Conta e arquivo</th>
                  <th className="px-3 py-2.5 font-medium">Período do extrato</th>
                  <th className="px-3 py-2.5 text-right font-medium">Linhas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Conferidas</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Enviado</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Abrir a conciliação de ${c.arquivo_nome}`}
                    onClick={() => router.push(`/financeiro/conciliacao/${c.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && router.push(`/financeiro/conciliacao/${c.id}`)}
                    className="cursor-pointer hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                  >
                    <td className="max-w-80 px-4 py-2.5">
                      <p className="truncate font-medium">{c.conta_nome}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground" title={c.arquivo_nome}>
                        {c.arquivo_nome}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                      {data(c.periodo_de)} a {data(c.periodo_ate)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.qtd_linhas}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.resumo.conciliadas + c.resumo.feitas}</td>
                    <td className="px-3 py-2.5">
                      {c.resumo.pendentes === 0 ? <Pill tom="success">tudo conferido</Pill> : <Pill tom="warning">{c.resumo.pendentes} pendente(s)</Pill>}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {dataHora(c.criado_em)}
                      {c.usuario_nome && <span className="block">{c.usuario_nome}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {enviar && <EnviarExtratoDialog open onOpenChange={setEnviar} contaId={conta ?? undefined} />}
      <RegrasDialog open={regras} onOpenChange={setRegras} podeEditar={podeConciliar} />
    </div>
  );
}
