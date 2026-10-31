"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Inbox, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import {
  Segmented,
  TableCard,
  TableSkeleton,
  Toolbar,
} from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClienteSaaS, PlanoOut } from "@/lib/admin";
import { api } from "@/lib/api";
import { dataHora, documento, moeda } from "@/lib/format";

interface Solicitacao {
  id: number;
  nome: string;
  documento: string | null;
  responsavel: string;
  email: string;
  telefone: string | null;
  plano: PlanoOut | null;
  ciclo: "mensal" | "anual";
  usuarios: number | null;
  indicacao: string | null;
  mensagem: string | null;
  status: "nova" | "aprovada" | "recusada";
  cliente_id: number | null;
  criado_em: string;
}

const TOM = { nova: "info", aprovada: "success", recusada: "neutral" } as const;
const ROTULO = { nova: "Nova", aprovada: "Aprovada", recusada: "Recusada" };
const LINK_CADASTRO = "https://mayajus.mayacorp.com.br/cadastro";

/** Cadastros feitos no formulário do site da MayaCorp, esperando aprovação. */
export default function SolicitacoesPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [status, setStatus] = useState<
    "nova" | "aprovada" | "recusada" | "todas"
  >("nova");
  const [aprovar, setAprovar] = useState<Solicitacao | null>(null);
  const [recusar, setRecusar] = useState<Solicitacao | null>(null);
  const [dias, setDias] = useState("15");
  const lista = useQuery({
    queryKey: ["admin", "solicitacoes", status],
    queryFn: () =>
      api.get<Solicitacao[]>("/admin/solicitacoes", {
        status: status === "todas" ? undefined : status,
      }),
  });
  const ok = useMutation({
    mutationFn: () =>
      api.post<ClienteSaaS>(`/admin/solicitacoes/${aprovar!.id}/aprovar`, {
        dias_teste: Number(dias) || null,
      }),
    onSuccess: (c) => {
      toast.success(`Ambiente de ${c.nome} criado e boas-vindas enviadas`, {
        action: c.convite
          ? {
              label: "Copiar link",
              onClick: () => navigator.clipboard.writeText(c.convite!),
            }
          : undefined,
        duration: 15000,
      });
      setAprovar(null);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const nao = useMutation({
    mutationFn: () => api.post(`/admin/solicitacoes/${recusar!.id}/recusar`),
    onSuccess: () => {
      toast.success("Solicitação recusada");
      setRecusar(null);
      qc.invalidateQueries({ queryKey: ["admin", "solicitacoes"] });
    },
  });

  return (
    <div>
      <PageHeader
        titulo="Solicitações"
        icone={Inbox}
        migalhas={[{ label: "MayaCorp" }, { label: "Solicitações" }]}
        acoes={
          <Button
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(LINK_CADASTRO)
                .then(() => toast.success("Link do formulário copiado"))
            }
          >
            <Copy /> Link do formulário
          </Button>
        }
      />
      <TableCard>
        <Toolbar>
          <Segmented
            value={status}
            onChange={setStatus}
            opcoes={[
              { value: "nova", label: "Novas" },
              { value: "aprovada", label: "Aprovadas", tom: "success" },
              { value: "recusada", label: "Recusadas" },
              { value: "todas", label: "Todas" },
            ]}
          />
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={5} />
        ) : !lista.data?.length ? (
          <EmptyState
            icone={Inbox}
            titulo="Nenhuma solicitação"
            descricao={`Os cadastros feitos no formulário do site (${LINK_CADASTRO}) aparecem aqui para você aprovar.`}
          />
        ) : (
          <div className="divide-y">
            {lista.data.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-start gap-4 px-4 py-4 text-sm"
              >
                <div className="min-w-60 flex-1 space-y-0.5">
                  <p className="font-medium">
                    {s.nome}{" "}
                    {s.documento && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {documento(s.documento)}
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {s.responsavel} · {s.email} · {s.telefone}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.plano
                      ? `${s.plano.nome} (${s.ciclo}) · ${moeda(s.ciclo === "anual" ? s.plano.preco_anual : s.plano.preco_mensal)}`
                      : "Plano a definir"}
                    {s.usuarios ? ` · ${s.usuarios} usuário(s)` : ""}
                    {s.indicacao ? ` · indicação: ${s.indicacao}` : ""}
                  </p>
                  {s.mensagem && (
                    <p className="mt-1 whitespace-pre-line rounded-lg bg-muted/50 p-2 text-xs">
                      {s.mensagem}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {dataHora(s.criado_em)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tom={TOM[s.status]}>{ROTULO[s.status]}</Pill>
                  {s.status === "nova" && (
                    <>
                      <Button size="sm" onClick={() => setAprovar(s)}>
                        <Check /> Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRecusar(s)}
                      >
                        <X /> Recusar
                      </Button>
                    </>
                  )}
                  {s.cliente_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        router.push(`/admin/clientes/${s.cliente_id}`)
                      }
                    >
                      Abrir cliente
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </TableCard>

      <FormDialog
        open={!!aprovar}
        onOpenChange={(o) => !o && setAprovar(null)}
        titulo={`Aprovar ${aprovar?.nome ?? ""}`}
        descricao="Cria o ambiente com o usuário Suporte e envia as boas-vindas para o cliente criar o usuário master."
        rotuloSalvar="Aprovar e criar ambiente"
        salvando={ok.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          ok.mutate();
        }}
      >
        <Field
          label="Dias de teste grátis"
          htmlFor="apr-dias"
          dica="Vazio = já entra como ativo (sem teste)."
        >
          <Input
            id="apr-dias"
            type="number"
            min={1}
            max={90}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="max-w-32"
          />
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={!!recusar}
        onOpenChange={(o) => !o && setRecusar(null)}
        titulo={`Recusar ${recusar?.nome ?? ""}?`}
        descricao="A solicitação sai da lista de novas. Nenhum e-mail é enviado."
        confirmar="Recusar"
        destrutivo
        carregando={nao.isPending}
        onConfirm={() => nao.mutate()}
      />
    </div>
  );
}
