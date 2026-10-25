"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { ContaForm } from "@/components/financeiro/contas/conta-form";
import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { PageHeader } from "@/components/mayacorp/page-header";
import { useAuth } from "@/lib/auth";

export default function NovaContaPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const podeCriar = pode("contas_bancarias.editar");
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titulo="Nova conta"
        icone={Plus}
        migalhas={[{ label: "Conta Bancária" }, { label: "Contas", href: "/financeiro/contas" }, { label: "Nova conta" }]}
      />
      {podeCriar ? (
        <div className="card-surface p-5 sm:p-6">
          <ContaForm onSalvo={(c) => router.push(`/financeiro/contas/${c.id}`)} onCancelar={() => router.push("/financeiro/contas")} />
        </div>
      ) : (
        <SemAcesso />
      )}
    </div>
  );
}
