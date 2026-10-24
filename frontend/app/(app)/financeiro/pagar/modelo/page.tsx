"use client";

import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { baixar } from "@/lib/api";

const COLUNAS = ["Vencimento", "Pagamento", "Categoria", "Subcategoria", "Descrição", "Favorecido", "Valor", "Forma de pagamento", "Documento", "Observação"];

export default function ModeloContasPagarPage() {
  const [baixando, setBaixando] = useState(false);
  const feito = useRef(false);
  const baixarModelo = async () => {
    setBaixando(true);
    try {
      await baixar("/financeiro/contas-pagar/modelo.xlsx", {}, "modelo_contas_a_pagar.xlsx");
    } catch {
      toast.error("Não foi possível baixar o modelo.");
    } finally {
      setBaixando(false);
    }
  };
  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    baixarModelo();
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        titulo="Modelo de contas a pagar"
        descricao="Preencha a planilha e importe em Lançamentos › Importar."
        icone={FileSpreadsheet}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Baixar modelo" }]}
      />
      <div className="card-surface space-y-4 p-6">
        <p className="flex items-center gap-2 text-sm">
          {baixando ? <Loader2 className="size-4 animate-spin text-info-ink" /> : <Download className="size-4 text-success-ink" />}
          {baixando ? "Baixando o modelo…" : "O download começou. Se não apareceu, clique em baixar de novo."}
        </p>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Colunas da planilha (aba “Contas”)</p>
          <ol className="flex flex-wrap gap-1.5">
            {COLUNAS.map((c, i) => (
              <li key={c} className="rounded-lg border bg-muted/30 px-2 py-1 text-xs">
                <span className="mr-1 font-mono text-muted-foreground">{String.fromCharCode(65 + i)}</span>
                {c}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            Categorias e fornecedores que ainda não existem são criados na importação. Com a data de pagamento preenchida, a conta já entra como paga.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={baixarModelo} disabled={baixando}>
            <Download /> Baixar de novo
          </Button>
          <Button variant="outline" render={<Link href="/financeiro/pagar" />}>
            <ArrowLeft /> Ir para Lançamentos
          </Button>
        </div>
      </div>
    </div>
  );
}
