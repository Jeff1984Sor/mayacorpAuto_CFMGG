"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { ConciliacaoDetalhe, DesfeitoOut, RegraOut } from "@/lib/conciliacao";
import { moeda } from "@/lib/format";

import { useAposGravar } from "./comum";

/** Desfaz em bloco o que a conciliação criou ou baixou; o que não pôde ser desfeito aparece com o motivo. */
export function DesfazerDialog({ conc, open, onOpenChange }: { conc: ConciliacaoDetalhe; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const aposGravar = useAposGravar(conc.id);
  const [excluir, setExcluir] = useState(false);
  const [resultado, setResultado] = useState<DesfeitoOut | null>(null);
  const desfazer = useMutation({
    mutationFn: () => api.post<DesfeitoOut>(`/financeiro/conciliacao/${conc.id}/desfazer`, { excluir_importacao: excluir }),
    onSuccess: (r) => {
      onOpenChange(false);
      if (r.excluida) {
        toast.success(r.mensagem);
        aposGravar(null);
        router.push("/financeiro/conciliacao");
        return;
      }
      aposGravar(r.conciliacao);
      if (r.nao_desfeitas.length || r.avisos.length) setResultado(r);
      else toast.success(r.mensagem);
    },
  });
  const feitas = conc.resumo.feitas;
  return (
    <>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        titulo="Desfazer esta conciliação?"
        descricao={
          feitas
            ? `Tudo o que esta conciliação criou ou baixou (${feitas} linha(s)) é desfeito de uma vez: as contas a pagar criadas são excluídas, as baixas voltam atrás e as faturas voltam a ficar em aberto. O que já existia antes não muda.`
            : "Esta conciliação ainda não criou nem baixou nada. Você pode excluir o extrato para subir o arquivo certo."
        }
        confirmar={excluir ? "Desfazer e excluir o extrato" : "Desfazer tudo"}
        destrutivo
        desabilitado={!feitas && !excluir}
        carregando={desfazer.isPending}
        onConfirm={() => desfazer.mutate()}
      >
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm">
          <Checkbox className="mt-0.5" checked={excluir} onCheckedChange={(v) => setExcluir(!!v)} />
          <span>
            Excluir também este extrato
            <span className="block text-xs text-muted-foreground">Use quando o arquivo errado foi enviado: as linhas saem e o arquivo certo pode ser enviado.</span>
          </span>
        </label>
      </ConfirmDialog>
      <Dialog open={!!resultado} onOpenChange={(o) => !o && setResultado(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogTitle>{resultado?.mensagem}</DialogTitle>
          <DialogDescription>O que não pôde ser desfeito continua como estava. Resolva o motivo e desfaça de novo.</DialogDescription>
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {resultado?.nao_desfeitas.map((n) => (
              <li key={n.linha_id} className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-mono text-xs break-words">{n.descricao}</span>
                  <span className="font-mono whitespace-nowrap tabular-nums">{moeda(n.valor)}</span>
                </p>
                <p className="mt-1 text-xs text-warning-ink">{n.motivo}</p>
              </li>
            ))}
            {resultado?.avisos.map((a) => (
              <li key={a} className="rounded-lg border p-3 text-xs text-muted-foreground">
                {a}
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={() => setResultado(null)}>Entendi</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** O que o escritório já ensinou: a próxima linha parecida vem com esta categoria e este favorecido. */
export function RegrasDialog({ open, onOpenChange, podeEditar }: { open: boolean; onOpenChange: (o: boolean) => void; podeEditar: boolean }) {
  const qc = useQueryClient();
  const regras = useQuery({ queryKey: ["fin", "conciliacao", "regras"], queryFn: () => api.get<RegraOut[]>("/financeiro/conciliacao/regras"), enabled: open });
  const esquecer = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/financeiro/conciliacao/regras/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fin", "conciliacao"] });
    },
  });
  const lista = regras.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold">O que o sistema aprendeu</DialogTitle>
          <DialogDescription className="mt-1">
            Cada vez que você confirma ou corrige um lançamento, a descrição do banco fica ligada à categoria e ao favorecido. No próximo extrato, a linha
            parecida já vem preenchida.
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {lista.length === 0 ? (
            <p className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
              <GraduationCap className="size-7 opacity-60" />
              {regras.isPending ? "Carregando…" : "Nada aprendido ainda. Confirme os lançamentos de um extrato e as regras aparecem aqui."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-popover text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Quando a descrição for parecida com</th>
                  <th className="px-3 py-2.5 font-medium">Sugere</th>
                  <th className="px-3 py-2.5 text-right font-medium">Usos</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-72 px-5 py-2.5">
                      <p className="flex items-center gap-1.5">
                        <Pill tom={r.tipo === "credito" ? "success" : "danger"}>{r.tipo === "credito" ? "entrada" : "saída"}</Pill>
                        <span className="min-w-0 truncate font-mono text-xs" title={r.exemplo ?? r.padrao}>
                          {r.exemplo ?? r.padrao}
                        </span>
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.categoria_nome ?? <span className="text-muted-foreground">sem categoria</span>}
                      {r.subcategoria_nome && <span className="text-muted-foreground"> › {r.subcategoria_nome}</span>}
                      {r.favorecido_nome && <span className="block text-muted-foreground">{r.favorecido_nome}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{r.usos}</td>
                    <td className="px-3 py-2.5">
                      {podeEditar && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Esquecer a regra de ${r.exemplo ?? r.padrao}`} title="Esquecer" className="text-muted-foreground hover:text-danger-ink" disabled={esquecer.isPending} onClick={() => esquecer.mutate(r.id)}>
                          <Trash2 />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
