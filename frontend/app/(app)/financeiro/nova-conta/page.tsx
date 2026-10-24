"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { ContaForm } from "@/components/financeiro/contas/conta-form";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { useAuth } from "@/lib/auth";

export default function NovaContaPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titulo="Nova conta"
        icone={Plus}
        migalhas={[{ label: "Conta Bancária" }, { label: "Contas", href: "/financeiro/contas" }, { label: "Nova conta" }]}
      />
      {isAdmin ? (
        <div className="card-surface p-5 sm:p-6">
          <ContaForm onSalvo={(c) => router.push(`/financeiro/contas/${c.id}`)} onCancelar={() => router.push("/financeiro/contas")} />
        </div>
      ) : (
        <EmptyState icone={Plus} titulo="Somente administradores" descricao="Peça a um administrador para cadastrar contas bancárias." />
      )}
    </div>
  );
}
