"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, CreditCard, HandCoins, MailWarning, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  type ClienteSaaS,
  type Cobranca,
  type PagamentoCliente,
  ROTULO_ASSINATURA,
  ROTULO_TIPO_COBRANCA,
  TOM_COBRANCA,
} from "@/lib/admin";
import { api } from "@/lib/api";
import { data, moeda } from "@/lib/format";

export function copiarLink(link: string) {
  navigator.clipboard.writeText(link).then(
    () => toast.success("Link copiado"),
    () => toast.error("Não deu para copiar. Selecione e copie o link."),
  );
}

function hojeMais(dias: number) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function AvulsaDialog({
  open,
  onClose,
  clienteId,
}: {
  open: boolean;
  onClose: () => void;
  clienteId?: number;
}) {
  const qc = useQueryClient();
  const clientes = useQuery({
    queryKey: ["admin", "clientes", "", "todos"],
    queryFn: () => api.get<ClienteSaaS[]>("/admin/clientes"),
    enabled: open,
  });
  const vazio = () => ({
    cliente_id: clienteId ? String(clienteId) : "",
    descricao: "",
    valor: "",
    vencimento: hojeMais(5),
    enviar: true,
  });
  const [f, setF] = useState(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- limpa ao abrir */
  useEffect(() => {
    if (open) setF(vazio());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () =>
      api.post<Cobranca>("/admin/cobrancas/avulsa", {
        ...f,
        cliente_id: Number(f.cliente_id),
      }),
    onSuccess: (k) => {
      toast.success(
        f.enviar ? "Cobrança criada e enviada por e-mail" : "Cobrança criada",
        {
          action: k.link
            ? { label: "Copiar link", onClick: () => copiarLink(k.link!) }
            : undefined,
        },
      );
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo="Cobrança avulsa"
      descricao="Sem produto: descreva e informe o valor. Sai um link do Mercado Pago (Pix, cartão ou boleto)."
      salvando={salvar.isPending}
      rotuloSalvar="Criar cobrança"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!clienteId && (
          <Field
            label="Cliente"
            obrigatorio
            htmlFor="av-cli"
            className="sm:col-span-2"
          >
            <NativeSelect
              id="av-cli"
              required
              value={f.cliente_id}
              onChange={(e) => setF({ ...f, cliente_id: e.target.value })}
            >
              <option value="">Escolha…</option>
              {clientes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field
          label="Descrição"
          obrigatorio
          htmlFor="av-desc"
          className="sm:col-span-2"
        >
          <Input
            id="av-desc"
            required
            minLength={3}
            value={f.descricao}
            onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder="Ex.: Implantação e treinamento"
            autoFocus
          />
        </Field>
        <Field label="Valor (R$)" obrigatorio htmlFor="av-valor">
          <Input
            id="av-valor"
            required
            type="number"
            step="0.01"
            min={0.01}
            value={f.valor}
            onChange={(e) => setF({ ...f, valor: e.target.value })}
          />
        </Field>
        <Field label="Vencimento" obrigatorio htmlFor="av-venc">
          <Input
            id="av-venc"
            required
            type="date"
            value={f.vencimento}
            onChange={(e) => setF({ ...f, vencimento: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Switch
            checked={f.enviar}
            onCheckedChange={(v) => setF({ ...f, enviar: v })}
          />{" "}
          Enviar por e-mail para o financeiro do cliente
        </label>
      </div>
    </FormDialog>
  );
}

/** Selo da cobrança em aberto cujo e-mail não saiu (ex.: falta o e-mail do financeiro na ficha). */
export function NaoEnviada({ k }: { k: Cobranca }) {
  if (!k.envio_erro) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-medium text-warning-ink">
      <MailWarning className="size-3 shrink-0" />
      Não enviada: {k.envio_erro}
    </span>
  );
}

/** Aba da ficha do cliente: como ele paga (link ou cartão recorrente), as recorrências e as cobranças dele. */
export function AbaCobrancas({
  cli,
  recorrencias,
}: {
  cli: ClienteSaaS;
  /** seção "Cobranças recorrentes", entre a forma de pagamento e a lista */
  recorrencias?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [avulsa, setAvulsa] = useState(false);
  const externo = cli.tipo === "externo";
  const pag = useQuery({
    queryKey: ["admin", "pagamento", cli.id],
    queryFn: () =>
      api.get<PagamentoCliente>(`/admin/clientes/${cli.id}/pagamento`),
    enabled: !externo,
  });
  const lista = useQuery({
    queryKey: ["admin", "cobrancas", "cliente", cli.id],
    queryFn: () =>
      api.get<Cobranca[]>("/admin/cobrancas", { cliente_id: cli.id }),
  });
  const forma = useMutation({
    mutationFn: (f: "link" | "cartao") =>
      api.put(`/admin/clientes/${cli.id}/pagamento`, { forma_pagamento: f }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin", "pagamento", cli.id] }),
  });
  const assinar = useMutation({
    mutationFn: () =>
      api.post<PagamentoCliente>(`/admin/clientes/${cli.id}/assinatura`),
    onSuccess: (r) => {
      toast.success("Link do cartão enviado ao financeiro do cliente", {
        action: r.link
          ? { label: "Copiar link", onClick: () => copiarLink(r.link!) }
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ["admin", "pagamento", cli.id] });
    },
  });
  const p = pag.data;
  return (
    <div className="space-y-4">
      {externo ? (
        <div className="card-surface space-y-1 p-4">
          <p className="font-medium">Forma de pagamento</p>
          <p className="text-sm">
            Link do Mercado Pago em cada cobrança (Pix, cartão ou boleto).
          </p>
          <p className="text-xs text-muted-foreground">
            O link vai por e-mail para o financeiro do cliente quando a cobrança
            é gerada, e os lembretes seguem a régua de e-mails.
          </p>
        </div>
      ) : (
      <div className="card-surface space-y-3 p-4">
        <p className="font-medium">Forma de pagamento</p>
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect
            value={p?.forma_pagamento ?? "link"}
            onChange={(e) => forma.mutate(e.target.value as "link" | "cartao")}
            className="max-w-72"
            aria-label="Forma de pagamento"
          >
            <option value="link">
              Link do Mercado Pago todo mês (Pix, cartão ou boleto)
            </option>
            <option value="cartao">Cartão recorrente (assinatura)</option>
          </NativeSelect>
          {p?.forma_pagamento === "cartao" && (
            <>
              <span className="text-sm text-muted-foreground">
                Assinatura:{" "}
                {p.assinatura_status
                  ? (ROTULO_ASSINATURA[p.assinatura_status] ??
                    p.assinatura_status)
                  : "não criada"}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={assinar.isPending}
                onClick={() => assinar.mutate()}
              >
                <CreditCard />{" "}
                {p.assinatura_id
                  ? "Reenviar link do cartão"
                  : "Enviar link do cartão"}
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          No cartão, o Mercado Pago debita a mensalidade sozinho; excedentes do
          mês saem como link à parte.
        </p>
      </div>
      )}
      {recorrencias}
      <div className="flex items-center justify-between">
        <p className="font-medium">Cobranças</p>
        <Button size="sm" onClick={() => setAvulsa(true)}>
          <Plus /> Cobrança avulsa
        </Button>
      </div>
      {!lista.data?.length ? (
        <EmptyState
          icone={HandCoins}
          titulo="Nenhuma cobrança"
          descricao={
            externo
              ? "As cobranças das recorrências e as avulsas aparecem aqui assim que forem geradas."
              : "As mensalidades aparecem aqui assim que forem geradas."
          }
        />
      ) : (
        <div className="card-surface divide-y">
          {lista.data.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-48 flex-1">
                <p className="font-medium">{k.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {ROTULO_TIPO_COBRANCA[k.tipo]} · vence {data(k.vencimento)}
                  {k.status === "paga" &&
                    ` · paga em ${data(k.pago_em)} (${k.forma_paga})`}
                </p>
                <NaoEnviada k={k} />
              </div>
              <span className="font-mono tabular-nums">{moeda(k.valor)}</span>
              <Pill tom={TOM_COBRANCA[k.status]}>{k.status_rotulo}</Pill>
              {k.link &&
                (k.status === "pendente" || k.status === "vencida") && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Copiar link"
                    onClick={() => copiarLink(k.link!)}
                  >
                    <Copy />
                  </Button>
                )}
            </div>
          ))}
        </div>
      )}
      <AvulsaDialog
        open={avulsa}
        onClose={() => setAvulsa(false)}
        clienteId={cli.id}
      />
    </div>
  );
}
