"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Check,
  CreditCard,
  ExternalLink,
  Gem,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type MeuPlano,
  type PlanoOut,
  ROTULO_ASSINATURA,
  TOM_COBRANCA,
} from "@/lib/admin";
import { api, ApiError } from "@/lib/api";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

function Barra({
  rotulo,
  usado,
  limite,
}: {
  rotulo: string;
  usado: number;
  limite: number | null;
}) {
  const pct = limite ? Math.min(100, (usado / limite) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{rotulo}</span>
        <span className="font-mono tabular-nums">
          {usado} / {limite ?? "∞"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-brand",
          )}
          style={{ width: `${limite ? pct : 4}%` }}
        />
      </div>
    </div>
  );
}

function abrir(link: string) {
  window.open(link, "_blank", "noopener");
}

export default function MeuPlanoPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["meu-plano"],
    queryFn: () => api.get<MeuPlano>("/meu-plano"),
    retry: false,
  });
  const [troca, setTroca] = useState<PlanoOut | null>(null);
  const trocar = useMutation({
    mutationFn: () =>
      api.put<MeuPlano>("/meu-plano", {
        plano_id: troca!.id,
        ciclo:
          q.data?.forma_pagamento === "cartao"
            ? "mensal"
            : (q.data?.ciclo ?? "mensal"),
      }),
    onSuccess: (r) => {
      toast.success(`Plano alterado para ${r.plano?.nome}`);
      qc.setQueryData(["meu-plano"], r);
      setTroca(null);
    },
  });
  const cartao = useMutation({
    mutationFn: () => api.post<{ link: string }>("/meu-plano/cartao"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["meu-plano"] });
      abrir(r.link);
    },
  });
  const pagar = useMutation({
    mutationFn: (id: number) =>
      api.post<{ link: string }>(`/meu-plano/cobrancas/${id}/link`),
    onSuccess: (r) => abrir(r.link),
  });

  if (q.isError) {
    const nao = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div>
        <PageHeader
          titulo="Meu plano"
          icone={Gem}
          migalhas={[{ label: "Minha conta" }, { label: "Meu plano" }]}
        />
        <EmptyState
          icone={Gem}
          titulo={nao ? "Plano não disponível aqui" : "Não deu para carregar"}
          descricao={
            nao ? "Este ambiente não tem plano do MayaJus." : q.error.message
          }
        />
      </div>
    );
  }
  const m = q.data;
  const atual = m?.plano?.id;
  const ordem = m?.planos.findIndex((p) => p.id === atual) ?? -1;

  return (
    <div>
      <PageHeader
        titulo="Meu plano"
        icone={Gem}
        migalhas={[{ label: "Minha conta" }, { label: "Meu plano" }]}
      />
      {!m ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card-surface space-y-3 p-5">
              <p className="text-sm text-muted-foreground">Plano atual</p>
              <p className="text-2xl font-semibold">
                {m.plano?.nome ?? "Sem plano"}{" "}
                {m.status === "teste" && (
                  <Pill tom="info">
                    em teste{m.teste_ate ? ` até ${data(m.teste_ate)}` : ""}
                  </Pill>
                )}
              </p>
              {m.valor && (
                <p className="font-mono text-lg">
                  {moeda(m.valor)}{" "}
                  <span className="font-sans text-sm text-muted-foreground">
                    por {m.ciclo === "anual" ? "ano" : "mês"}
                  </span>
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Pagamento:{" "}
                {m.forma_pagamento === "cartao"
                  ? `cartão recorrente (${ROTULO_ASSINATURA[m.assinatura_status ?? ""] ?? "não cadastrado"})`
                  : "link do Mercado Pago por e-mail (Pix, cartão ou boleto)"}
              </p>
              {m.pode_alterar &&
                m.ciclo === "mensal" &&
                m.plano &&
                m.assinatura_status !== "authorized" && (
                  <Button
                    variant="outline"
                    disabled={cartao.isPending}
                    onClick={() => cartao.mutate()}
                  >
                    <CreditCard /> Pagar no cartão todo mês, automático
                  </Button>
                )}
            </div>
            <div className="card-surface space-y-4 p-5">
              <p className="text-sm text-muted-foreground">Uso neste mês</p>
              <Barra
                rotulo="Usuários com acesso"
                usado={m.uso.usuarios}
                limite={m.uso.limite_usuarios}
              />
              <Barra
                rotulo="Notas fiscais emitidas"
                usado={m.uso.notas_mes}
                limite={m.uso.limite_notas}
              />
              {toNum(m.uso.valor_excedente) > 0 && (
                <p className="text-sm text-warning-ink">
                  Além do plano: {moeda(m.uso.valor_excedente)} (entra na
                  próxima mensalidade).
                </p>
              )}
            </div>
          </div>

          {m.em_aberto.length > 0 && (
            <div className="card-surface divide-y">
              <p className="px-5 py-3 font-medium">Em aberto</p>
              {m.em_aberto.map((k) => (
                <div
                  key={k.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"
                >
                  <div className="flex-1">
                    <p className="font-medium">{k.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      vence {data(k.vencimento)}
                    </p>
                  </div>
                  <span className="font-mono tabular-nums">
                    {moeda(k.valor)}
                  </span>
                  <Pill tom={TOM_COBRANCA[k.status]}>{k.status_rotulo}</Pill>
                  <Button
                    size="sm"
                    disabled={pagar.isPending}
                    onClick={() => pagar.mutate(k.id)}
                  >
                    <ExternalLink /> Pagar
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-3 font-medium">Planos</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {m.planos.map((p, i) => {
                const eh = p.id === atual;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "card-surface flex flex-col gap-3 p-5",
                      eh && "border-brand ring-1 ring-brand",
                    )}
                  >
                    <p className="text-lg font-semibold">{p.nome}</p>
                    <p className="font-mono text-xl">
                      {moeda(p.preco_mensal)}
                      <span className="font-sans text-sm text-muted-foreground">
                        /mês
                      </span>
                    </p>
                    <ul className="flex-1 space-y-1 text-sm">
                      <li>
                        {p.usuarios ?? "Usuários ilimitados"}
                        {p.usuarios ? " usuário(s)" : ""}
                      </li>
                      <li>
                        {p.notas_mes ?? "Notas ilimitadas"}
                        {p.notas_mes != null ? " notas fiscais por mês" : ""}
                      </li>
                      {p.recursos.map((r) => (
                        <li key={r} className="flex items-center gap-1.5">
                          <Check className="size-3.5 text-success" />{" "}
                          {m.recursos.find((x) => x.chave === r)?.rotulo ?? r}
                        </li>
                      ))}
                    </ul>
                    {eh ? (
                      <Pill tom="brand">Seu plano</Pill>
                    ) : (
                      m.pode_alterar && (
                        <Button
                          variant={i > ordem ? "default" : "outline"}
                          onClick={() => setTroca(p)}
                        >
                          <BadgeDollarSign />{" "}
                          {ordem >= 0 && i < ordem
                            ? "Mudar para este"
                            : "Fazer upgrade"}
                        </Button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            {!m.pode_alterar && (
              <p className="mt-2 text-xs text-muted-foreground">
                Só o administrador do escritório pode mudar o plano.
              </p>
            )}
          </div>

          {m.pagas.length > 0 && (
            <div className="card-surface divide-y">
              <p className="px-5 py-3 font-medium">Pagamentos</p>
              {m.pagas.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center gap-3 px-5 py-2.5 text-sm"
                >
                  <span className="flex-1">{k.descricao}</span>
                  <span className="text-xs text-muted-foreground">
                    {data(k.pago_em)} · {k.forma_paga}
                  </span>
                  <span className="font-mono tabular-nums">
                    {moeda(k.valor)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!troca}
        onOpenChange={(o) => !o && setTroca(null)}
        titulo={`Mudar para o plano ${troca?.nome}?`}
        descricao={
          troca &&
          `Os limites mudam agora. A próxima mensalidade já vem em ${moeda(troca.preco_mensal)}.`
        }
        confirmar="Mudar de plano"
        carregando={trocar.isPending}
        onConfirm={() => trocar.mutate()}
      />
    </div>
  );
}
