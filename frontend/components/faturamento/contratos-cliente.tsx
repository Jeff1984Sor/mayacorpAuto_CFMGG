"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FilePlus2, FileSignature } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ContratoOut } from "@/lib/faturamento";
import { data } from "@/lib/format";

import { ContratoDialog } from "./dialogos";

/** Aba "Contratos" no cadastro do cliente. */
export function ContratosDoCliente({ tomadorId }: { tomadorId: number }) {
  const router = useRouter();
  const { isOperador } = useAuth();
  const [novo, setNovo] = useState(false);
  const q = useQuery({ queryKey: ["fat", "contratos", "cliente", tomadorId], queryFn: () => api.get<ContratoOut[]>("/faturamento/contratos", { tomador_id: tomadorId }) });
  const lista = q.data ?? [];
  return (
    // o diálogo é um portal, mas o submit dele sobe pela árvore do React até o formulário do cliente
    <div onSubmit={(e) => e.stopPropagation()}>
      {q.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <FileSignature className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-2 font-medium">Nenhum contrato com este cliente</p>
          <p className="text-sm text-muted-foreground">O contrato define como o cliente é cobrado: valor fixo, mensalidade ou horas.</p>
          {isOperador && (
            <Button type="button" className="mt-4" onClick={() => setNovo(true)}>
              <FilePlus2 /> Novo contrato
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {isOperador && (
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => setNovo(true)}>
                <FilePlus2 /> Novo contrato
              </Button>
            </div>
          )}
          <ul className="divide-y rounded-xl border">
            {lista.map((c) => (
              <li key={c.id}>
                <Link href={`/faturamento/contratos/${c.id}`} className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-accent/40">
                  <span className="font-mono text-xs text-muted-foreground">#{c.numero}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.qtd_casos} caso(s) · {c.qtd_regras} regra(s){c.data_inicio && ` · desde ${data(c.data_inicio)}`}
                    </span>
                  </span>
                  <StatusBadge status={c.ativo ? "ativo" : "descartado"} label={c.ativo ? "Ativo" : "Encerrado"} />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ContratoDialog open={novo} onOpenChange={setNovo} tomadorId={tomadorId} onSalvo={(c) => router.push(`/faturamento/contratos/${c.id}`)} />
    </div>
  );
}
