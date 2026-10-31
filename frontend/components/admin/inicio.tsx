"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeDollarSign, Building2, CalendarClock, CheckCircle2, Hourglass, PauseCircle, ReceiptText, ScrollText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { linhaClicavel, TableCard, TableSkeleton } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { KpiCard } from "@/components/mayacorp/kpi-card";
import { Pill } from "@/components/mayacorp/status-badge";
import { type ClienteSaaS, type ResumoAdmin, ROTULO_STATUS, TOM_STATUS } from "@/lib/admin";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, moeda } from "@/lib/format";

const ATALHOS = [
  { label: "Clientes", href: "/admin/clientes", icone: Building2 },
  { label: "Contratos", href: "/admin/contratos", icone: ScrollText },
  { label: "Cobranças", href: "/admin/cobrancas", icone: ReceiptText },
  { label: "Contas a pagar", href: "/financeiro/pagar", icone: CalendarClock },
];

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** Início do admin MayaCorp: a carteira de clientes do MayaJus, não o painel de um escritório. */
export function InicioMayaCorp() {
  const router = useRouter();
  const { usuario } = useAuth();
  const resumo = useQuery({ queryKey: ["admin", "resumo"], queryFn: () => api.get<ResumoAdmin>("/admin/resumo") });
  const clientes = useQuery({ queryKey: ["admin", "clientes", "", "todos"], queryFn: () => api.get<ClienteSaaS[]>("/admin/clientes") });
  const r = resumo.data;
  // quem pede atenção: teste grátis acabando, suspensos e sem plano
  const atencao = (clientes.data ?? []).filter((c) => c.status === "teste" || c.status === "suspenso" || !c.plano);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {saudacao()}, {usuario?.nome.split(" ")[0]}.
        </h1>
        <p className="text-sm text-muted-foreground">Sua carteira de clientes do MayaJus.</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard titulo="Receita mensal (MRR)" icone={BadgeDollarSign} carregando={!r} valor={r ? moeda(r.mrr) : "—"} />
        <KpiCard titulo="Ativos" icone={CheckCircle2} indice={1} carregando={!r} valor={r ? String(r.por_status.ativo ?? 0) : "—"} />
        <KpiCard titulo="Em teste" icone={Hourglass} indice={2} carregando={!r} valor={r ? String(r.por_status.teste ?? 0) : "—"} />
        <KpiCard
          titulo="Suspensos / inativos"
          icone={PauseCircle}
          indice={3}
          carregando={!r}
          valor={r ? String((r.por_status.suspenso ?? 0) + (r.por_status.inativo ?? 0)) : "—"}
        />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ATALHOS.map((a) => (
          <Link key={a.href} href={a.href} className="card-surface flex items-center gap-3 p-4 text-sm font-medium hover:border-brand/50">
            <a.icone className="size-5 text-brand" /> {a.label}
          </Link>
        ))}
      </div>

      <h2 className="mb-2 font-medium">Pedem atenção</h2>
      <TableCard>
        {clientes.isPending ? (
          <TableSkeleton colunas={4} />
        ) : !atencao.length ? (
          <EmptyState icone={CheckCircle2} titulo="Tudo em dia" descricao="Nenhum cliente em teste, suspenso ou sem plano." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Escritório</th>
                <th className="px-3 py-2.5 font-medium">Plano</th>
                <th className="px-3 py-2.5 font-medium">Teste até</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {atencao.map((c) => (
                <tr key={c.id} className={linhaClicavel} onClick={() => router.push(`/admin/clientes/${c.id}`)}>
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-3 py-3">{c.plano?.nome ?? <span className="text-warning-ink">sem plano</span>}</td>
                  <td className="px-3 py-3 text-xs">{c.teste_ate ? data(c.teste_ate) : "—"}</td>
                  <td className="px-3 py-3">
                    <Pill tom={TOM_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
