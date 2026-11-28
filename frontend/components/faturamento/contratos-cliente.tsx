"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FilePlus2, FileSignature, Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { garantirContratoDoCliente, lerContratoDoCliente } from "@/lib/contrato";
import { type ContratoOut, textoPagadores } from "@/lib/faturamento";
import { data } from "@/lib/format";

import { ContratoDialog } from "./dialogos";
import { RegrasCobranca } from "./regras";

/**
 * Aba "Cobrança" no cadastro do cliente, para o escritório que trabalha sem contratos (Configurações › Faturamento):
 * as regras de cobrança, quem paga, a empresa emissora e a tabela de preço ficam direto no cliente.
 */
export function CobrancaDoCliente({ tomadorId }: { tomadorId: number }) {
  const { pode } = useAuth();
  const podeEditar = pode("contratos.editar");
  const podeCriar = pode("casos.editar");
  const [editar, setEditar] = useState(false);
  const emissoras = useEmissoras();
  const q = useQuery({
    queryKey: ["fat", "contratos", "do-cliente-unico", tomadorId, podeCriar],
    queryFn: async () => (await lerContratoDoCliente(tomadorId)) ?? (podeCriar ? garantirContratoDoCliente(tomadorId) : null),
  });
  const c = q.data;
  const emissora = (emissoras.data ?? []).find((e) => e.id === c?.emissora_id);
  if (q.isPending) return <Skeleton className="h-32 rounded-xl" />;
  if (!c)
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <FileSignature className="mx-auto size-7 text-muted-foreground/60" />
        <p className="mt-2 font-medium">Cobrança ainda não definida</p>
        <p className="text-sm text-muted-foreground">Quem cadastra casos define aqui como este cliente é cobrado.</p>
      </div>
    );
  const resumo: [string, string][] = [
    ["Quem paga", textoPagadores(c.pagadores) ?? "O próprio cliente"],
    ["Empresa emissora", emissora ? nomeEmissora(emissora) : "Padrão"],
    ["Tabela de preço", c.tabela_preco_nome ?? "Nenhuma"],
  ];
  return (
    // o diálogo é um portal, mas o submit dele sobe pela árvore do React até o formulário do cliente
    <div className="space-y-4" onSubmit={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3">
        {resumo.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <p className="text-[11px] text-muted-foreground">{rotulo}</p>
            <p className="truncate text-sm font-medium">{valor}</p>
          </div>
        ))}
        {podeEditar && (
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setEditar(true)}>
            <Pencil /> Alterar
          </Button>
        )}
      </div>
      <RegrasCobranca
        contratoId={c.id}
        vazioTexto="Defina como este cliente é cobrado: valor fixo, mensalidade recorrente ou por hora. Um caso pode ter regra própria."
      />
      <ContratoDialog open={editar} onOpenChange={setEditar} contrato={c} simples />
    </div>
  );
}

/** Aba "Contratos" no cadastro do cliente. */
export function ContratosDoCliente({ tomadorId }: { tomadorId: number }) {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEditar = pode("contratos.editar");
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
          {podeEditar && (
            <Button type="button" className="mt-4" onClick={() => setNovo(true)}>
              <FilePlus2 /> Novo contrato
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {podeEditar && (
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
