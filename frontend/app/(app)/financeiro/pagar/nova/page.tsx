"use client";

import { FilePlus2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { ContaPagarForm } from "@/components/financeiro/pagar/conta-pagar-form";
import { PageHeader } from "@/components/mayacorp/page-header";

export default function NovaContaPagarPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        titulo="Nova conta a pagar"
        icone={FilePlus2}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Lançamentos", href: "/financeiro/pagar" }, { label: "Nova conta" }]}
      />
      <ContaPagarForm onSalvo={() => router.push("/financeiro/pagar")} onCancelar={() => router.push("/financeiro/pagar")} />
    </div>
  );
}
