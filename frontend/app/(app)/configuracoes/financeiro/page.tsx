"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ContaSelect, DinheiroInput, useCategoriasFin, useConfigFinanceiro, useContasBancarias } from "@/components/financeiro/comum";
import { EmailChips } from "@/components/mayacorp/email-chips";
import { Field, FormSection, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { type ConfigFinanceiroOut, paraBr, paraDecimalApi } from "@/lib/financeiro";

function CatSelect({ id, value, onChange }: { id: string; value: number | null; onChange: (v: number | null) => void }) {
  const receitas = useCategoriasFin("receita");
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">—</option>
      {receitas.data
        ?.filter((c) => c.ativo || c.id === value)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
    </NativeSelect>
  );
}

export default function ConfigFinanceiroPage() {
  const qc = useQueryClient();
  const cfg = useConfigFinanceiro();
  const contas = useContasBancarias();
  const [f, setF] = useState({ conta: null as number | null, honorarios: null as number | null, reembolso: null as number | null, minimo: "", emails: [] as string[] });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega a configuração */
  useEffect(() => {
    if (cfg.data)
      setF({
        conta: cfg.data.conta_recebimento_id,
        honorarios: cfg.data.categoria_honorarios_id,
        reembolso: cfg.data.categoria_reembolso_id,
        minimo: paraBr(cfg.data.saldo_minimo),
        emails: cfg.data.agendamento_destinatarios,
      });
  }, [cfg.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () =>
      api.put<ConfigFinanceiroOut>("/financeiro/config", {
        conta_recebimento_id: f.conta,
        categoria_honorarios_id: f.honorarios,
        categoria_reembolso_id: f.reembolso,
        saldo_minimo: paraDecimalApi(f.minimo || "0"),
        agendamento_destinatarios: f.emails,
      }),
    onSuccess: (r) => {
      qc.setQueryData(["fin", "config"], r);
      qc.invalidateQueries({ queryKey: ["fin"] });
      toast.success("Configurações do financeiro salvas");
    },
  });
  if (cfg.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <form
      className="card-surface divide-y p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <FormSection titulo="Recebimentos" descricao="Fatura paga vira um crédito no extrato desta conta, na categoria certa.">
        <Field label="Conta padrão de recebimento" htmlFor="cfg-conta" className="sm:col-span-2" dica={contas.data?.length ? undefined : "Cadastre uma conta em Conta Bancária › Nova conta."}>
          <ContaSelect id="cfg-conta" value={f.conta} onChange={(v) => setF({ ...f, conta: v })} vazio="Nenhuma (não lança no extrato)" />
        </Field>
        <Field label="Categoria dos honorários (NH)" htmlFor="cfg-hon">
          <CatSelect id="cfg-hon" value={f.honorarios} onChange={(v) => setF({ ...f, honorarios: v })} />
        </Field>
        <Field label="Categoria dos reembolsos (ND)" htmlFor="cfg-reemb">
          <CatSelect id="cfg-reemb" value={f.reembolso} onChange={(v) => setF({ ...f, reembolso: v })} />
        </Field>
      </FormSection>
      <FormSection titulo="Previsão de caixa" descricao="Abaixo deste valor, a previsão avisa e sugere trazer dinheiro do investimento.">
        <Field label="Saldo mínimo da conta corrente" htmlFor="cfg-min">
          <DinheiroInput id="cfg-min" value={f.minimo} onChange={(v) => setF({ ...f, minimo: v })} />
        </Field>
      </FormSection>
      <FormSection titulo="Aviso de agendamento" descricao="Quem agenda os pagamentos no banco recebe um e-mail com os dados da conta e o boleto anexo.">
        <Field label="Destinatários" htmlFor="cfg-emails" className="sm:col-span-2" dica={<>O envio usa o SMTP de <Link href="/configuracoes/notificacoes" className="text-info-ink hover:underline">Notificações e e-mail</Link>.</>}>
          <EmailChips value={f.emails} onChange={(v) => setF({ ...f, emails: v })} />
        </Field>
      </FormSection>
      <div className="flex justify-end pt-5">
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </div>
    </form>
  );
}
