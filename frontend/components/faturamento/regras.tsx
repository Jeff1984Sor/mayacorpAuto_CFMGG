"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, MoreHorizontal, Pencil, Repeat, Timer, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROTULO_TIPO_REGRA, type RegraOut, type TipoRegra } from "@/lib/faturamento";
import { data, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

import { RegraDialog } from "./regra-dialog";

const ICONE: Record<TipoRegra, React.ComponentType<{ className?: string }>> = { fixo: CalendarDays, recorrente: Repeat, hora: Timer };
const COR: Record<TipoRegra, string> = {
  fixo: "bg-brand/12 text-info-ink",
  recorrente: "bg-success/10 text-success-ink",
  hora: "bg-warning/12 text-warning-ink",
};

function CardRegra({ r, onEditar, onExcluir, podeEditar }: { r: RegraOut; onEditar: () => void; onExcluir: () => void; podeEditar: boolean }) {
  const I = ICONE[r.tipo];
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("card-surface flex flex-col p-4", !r.ativo && "opacity-60")}>
      <header className="flex items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", COR[r.tipo])}>
          <I className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tom={r.tipo === "hora" ? "warning" : r.tipo === "recorrente" ? "success" : "brand"}>{ROTULO_TIPO_REGRA[r.tipo]}</Pill>
            {r.caso_id && <Pill tom="neutral">regra do caso</Pill>}
            {!r.ativo && <Pill tom="neutral">inativa</Pill>}
          </div>
          <h3 className="mt-1 truncate font-semibold" title={r.descricao}>
            {r.descricao}
          </h3>
          <p className="text-sm text-muted-foreground">{r.resumo}</p>
        </div>
        {podeEditar && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações da regra ${r.descricao}`} />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditar}>
                <Pencil /> Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onExcluir}>
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-sm">
        <div>
          <dt className="text-[11px] text-muted-foreground">Valor</dt>
          <dd className="font-semibold tabular-nums">{r.tipo === "hora" ? "por hora" : moeda(r.valor)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Próxima parcela</dt>
          <dd className="font-medium tabular-nums">{r.tipo === "hora" ? "—" : r.proxima ? data(r.proxima) : "concluída"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Faturadas</dt>
          <dd className="font-medium tabular-nums">
            {r.tipo === "hora" ? "—" : `${r.parcelas_faturadas}${r.tipo === "recorrente" && r.termino === "ocorrencias" && r.ocorrencias ? `/${r.ocorrencias}` : ""}`}
          </dd>
        </div>
      </dl>
    </motion.article>
  );
}

/** Lista de regras de cobrança (do contrato ou de um caso) com criar/editar/excluir. */
export function RegrasCobranca({ contratoId, casoId, vazioTexto }: { contratoId?: number; casoId?: number; vazioTexto?: string }) {
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const [editar, setEditar] = useState<RegraOut | null>(null);
  const [nova, setNova] = useState(false);
  const [excluir, setExcluir] = useState<RegraOut | null>(null);
  const q = useQuery({
    queryKey: ["fat", "regras", contratoId ?? null, casoId ?? null],
    queryFn: () => api.get<RegraOut[]>("/faturamento/regras", casoId ? { caso_id: casoId } : { contrato_id: contratoId }),
  });
  const regras = (q.data ?? []).filter((r) => (casoId ? r.caso_id === casoId : true));
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/faturamento/regras/${id}`),
    onSuccess: () => {
      toast.success("Regra excluída");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });

  return (
    <div className="space-y-4">
      {isOperador && regras.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setNova(true)}>
            <CalendarPlus /> Nova regra
          </Button>
        </div>
      )}
      {q.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : regras.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Repeat}
            titulo="Nenhuma regra de cobrança"
            descricao={vazioTexto ?? "Defina como este contrato é cobrado: valor fixo, mensalidade recorrente ou por hora."}
            acao={
              isOperador && (
                <Button onClick={() => setNova(true)}>
                  <CalendarPlus /> Criar regra
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {regras.map((r) => (
            <CardRegra key={r.id} r={r} podeEditar={isOperador} onEditar={() => setEditar(r)} onExcluir={() => setExcluir(r)} />
          ))}
        </div>
      )}
      {casoId == null && regras.some((r) => r.caso_id) && (
        <p className="text-xs text-muted-foreground">
          Regras marcadas “regra do caso” valem só para aquele caso.
        </p>
      )}

      <RegraDialog
        open={nova || !!editar}
        onOpenChange={(o) => {
          if (!o) {
            setNova(false);
            setEditar(null);
          }
        }}
        contratoId={contratoId}
        casoId={casoId}
        regra={editar}
      />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir a regra “${excluir?.descricao ?? ""}”?`}
        descricao="Parcelas já faturadas continuam nas faturas. As próximas deixam de aparecer em Itens a faturar."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
