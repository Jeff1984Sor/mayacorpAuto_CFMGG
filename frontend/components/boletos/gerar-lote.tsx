"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Barcode, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useConvenios } from "@/components/boletos/dialogos";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface Resultado {
  criados: number;
  falhas: { codigo: string | null; cliente: string; erros: string[] }[];
}

/** Botão da barra de seleção de Faturas: um boleto por fatura marcada, com os dados do cadastro do cliente. */
export function GerarBoletosBotao({ faturaIds, onConcluido, className }: { faturaIds: number[]; onConcluido?: () => void; className?: string }) {
  const qc = useQueryClient();
  const convenios = useConvenios();
  const prontos = (convenios.data ?? []).filter((c) => c.ativo && c.pendencias.length === 0);
  const gerar = useMutation({
    mutationFn: () => api.post<Resultado>("/boletos/lote", { convenio_id: prontos[0].id, fatura_ids: faturaIds }),
    onSuccess: (r) => {
      if (r.criados) toast.success(`${r.criados} boleto(s) criado(s). Eles vão na próxima remessa (tela Boletos).`);
      r.falhas.slice(0, 6).forEach((f) => toast.error(`${f.codigo ?? "Fatura"} · ${f.cliente}: ${f.erros[0]}`));
      if (r.falhas.length > 6) toast.error(`…e mais ${r.falhas.length - 6} fatura(s) sem boleto.`);
      qc.invalidateQueries({ queryKey: ["boletos"] });
      onConcluido?.();
    },
  });
  if (prontos.length === 0) return null; // sem convênio pronto, o botão nem aparece
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      disabled={gerar.isPending}
      onClick={() => (prontos.length > 1 ? toast.info("Há mais de um convênio: crie os boletos pela tela Boletos, escolhendo o convênio.") : gerar.mutate())}
    >
      {gerar.isPending ? <Loader2 className="animate-spin" /> : <Barcode />} Gerar boletos ({faturaIds.length})
    </Button>
  );
}
