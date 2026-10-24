"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ContaPagarForm } from "@/components/financeiro/pagar/conta-pagar-form";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { ContaPagarOut } from "@/lib/financeiro";
import { data, moeda } from "@/lib/format";

export default function EditarContaPagarPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useQuery({ queryKey: ["fin", "conta-pagar", Number(id)], queryFn: () => api.get<ContaPagarOut>(`/financeiro/contas-pagar/${id}`) });
  const voltar = () => router.push("/financeiro/pagar");
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        titulo={q.data ? q.data.favorecido_nome || q.data.descricao : "Conta a pagar"}
        icone={CalendarClock}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Lançamentos", href: "/financeiro/pagar" }, { label: "Editar" }]}
      />
      {q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : !q.data ? (
        <EmptyState icone={CalendarClock} titulo="Conta não encontrada" acao={<Button variant="outline" render={<Link href="/financeiro/pagar" />}>Voltar</Button>} />
      ) : q.data.data_pagamento ? (
        <div className="card-surface">
          <EmptyState
            icone={CheckCircle2}
            titulo={`Conta paga em ${data(q.data.data_pagamento)}`}
            descricao={`Valor pago ${moeda(q.data.valor_pago ?? q.data.valor)}${q.data.conta_bancaria_nome ? ` pela conta ${q.data.conta_bancaria_nome}` : ""}. Para alterar, reabra a conta em Lançamentos.`}
            acao={<Button render={<Link href="/financeiro/pagar" />}>Voltar para Lançamentos</Button>}
          />
        </div>
      ) : (
        <ContaPagarForm conta={q.data} onSalvo={voltar} onCancelar={voltar} />
      )}
    </div>
  );
}
