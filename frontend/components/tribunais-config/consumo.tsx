"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dataHora, moeda } from "@/lib/format";
import { chaveProtocolos, type CobrancaOut, type Consumo, ROTULO_TIPO, type TipoProtocolo } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const ORIGEM: Record<Consumo["origem"], [string, "brand" | "info" | "warning" | "danger"]> = {
  protocolo: ["Protocolo", "brand"],
  importacao: ["Importação", "info"],
  ajuste: ["Ajuste", "warning"],
  estorno: ["Estorno", "danger"],
};

const nomeCiclo = (c: string) => {
  const [a, m] = c.split("-").map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

export function ConsumoTribunais() {
  const qc = useQueryClient();
  const { usuario, pode } = useAuth();
  const [ciclo, setCiclo] = useState<string | null>(null);
  const [estornar, setEstornar] = useState<Consumo | null>(null);
  const [motivo, setMotivo] = useState("");
  const q = useQuery({
    queryKey: [chaveProtocolos, "cobranca", ciclo],
    queryFn: () => api.get<CobrancaOut>("/tribunais/cobranca", { ciclo }),
  });
  const estorno = useMutation({
    mutationFn: () => api.post("/tribunais/cobranca/estorno", { consumo_id: estornar!.id, motivo: motivo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "cobranca"] });
      toast.success("Estorno lançado (fica registrado na auditoria)");
      setEstornar(null);
      setMotivo("");
    },
  });

  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const c = q.data;
  const pct = c.uso.franquia ? Math.min(100, Math.round((c.uso.usado * 100) / c.uso.franquia)) : 0;
  const tom = pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success";
  const podeEstornar = !!usuario?.administrador && pode("cfg_tribunais.editar");
  const estornados = new Set(c.lancamentos.filter((l) => l.origem === "estorno").map((l) => l.referencia_id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Plano <strong className="text-foreground">{c.plano ?? "não definido"}</strong>. Só conta protocolo que deu certo.
        </p>
        <NativeSelect value={c.ciclo} onChange={(e) => setCiclo(e.target.value)} className="w-52 capitalize" aria-label="Mês">
          {c.ciclos.map((x) => (
            <option key={x} value={x}>
              {nomeCiclo(x)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="card-surface p-5">
          <p className="text-xs text-muted-foreground">Créditos de protocolo usados</p>
          <p className="mt-1 text-3xl font-semibold">
            <Mono>{c.uso.usado}</Mono>
            <span className="text-base font-normal text-muted-foreground"> de {c.uso.franquia} da franquia</span>
          </p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", tom)} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {c.uso.excedente > 0
              ? `${c.uso.excedente} crédito(s) além da franquia${c.uso.permite_excedente ? "" : " — o plano não permite excedente: novos protocolos ficam bloqueados"}.`
              : pct >= 80
                ? "Perto do fim da franquia. O escritório recebe aviso em 80% e 100%."
                : "Dentro da franquia."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 border-t pt-3 text-xs text-muted-foreground">
            Peso por tipo:
            {Object.entries(c.pesos).map(([t, n]) => (
              <span key={t} className="rounded-md bg-muted px-1.5 py-0.5">
                {ROTULO_TIPO[t as TipoProtocolo] ?? t}: <Mono>{n}</Mono>
              </span>
            ))}
          </div>
        </div>
        <div className="card-surface p-5">
          <p className="mb-2 text-xs text-muted-foreground capitalize">Fechamento de {nomeCiclo(c.ciclo)}</p>
          <dl className="space-y-1.5 text-sm">
            {(
              [
                ["Mensalidade", c.mensalidade],
                ["Excedente de protocolos", c.excedente],
                ["Setup de importação", c.setups],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <dt className="text-muted-foreground">{l}</dt>
                <dd>
                  <Mono>{moeda(v)}</Mono>
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>
                <Mono>{moeda(c.total)}</Mono>
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="border-b p-4">
          <h3 className="font-semibold">Lançamentos do mês</h3>
        </div>
        {c.lancamentos.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-3 py-2.5 font-medium">Origem</th>
                  <th className="px-3 py-2.5 font-medium">Descrição</th>
                  <th className="px-3 py-2.5 text-right font-medium">Créditos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  {podeEstornar && <th className="w-12 px-3 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y">
                {c.lancamentos.map((l) => {
                  const [ol, ot] = ORIGEM[l.origem] ?? [l.origem, "info"];
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Mono>{dataHora(l.criado_em)}</Mono>
                      </td>
                      <td className="px-3 py-2.5">
                        <Pill tom={ot} className="normal-case">
                          {ol}
                        </Pill>
                      </td>
                      <td className="max-w-80 px-3 py-2.5 text-muted-foreground">
                        {l.motivo ?? (l.origem === "protocolo" ? `Retorno #${l.referencia_id}` : "—")}
                        {l.dentro_franquia && <span className="ml-1.5 text-[11px] text-success-ink">· na franquia</span>}
                        {estornados.has(l.id) && <span className="ml-1.5 text-[11px] text-danger-ink">· estornado</span>}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right", l.creditos < 0 && "text-danger-ink")}>
                        <Mono>{l.creditos}</Mono>
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <Mono>{moeda(l.valor)}</Mono>
                      </td>
                      {podeEstornar && (
                        <td className="px-3 py-2.5">
                          {l.origem !== "estorno" && !estornados.has(l.id) && (
                            <Button variant="ghost" size="icon-sm" title="Estornar" aria-label="Estornar" onClick={() => setEstornar(l)}>
                              <Undo2 />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FormDialog
        open={!!estornar}
        onOpenChange={(o) => !o && setEstornar(null)}
        titulo="Estornar lançamento"
        descricao={estornar ? `${ORIGEM[estornar.origem]?.[0]} · ${estornar.creditos} crédito(s) · ${moeda(estornar.valor)}. O estorno entra no mês atual.` : undefined}
        rotuloSalvar="Estornar"
        salvando={estorno.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (motivo.trim().length < 5) return toast.error("Explique o motivo (mínimo 5 letras).");
          estorno.mutate();
        }}
      >
        <Field label="Motivo" obrigatorio dica="Fica gravado na auditoria com o seu nome.">
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={300} />
        </Field>
      </FormDialog>
    </div>
  );
}
