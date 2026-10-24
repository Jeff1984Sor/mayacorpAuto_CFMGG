"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Landmark, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { type ContaIn, type ContaOut, paraBr, paraDecimalApi, ROTULO_TIPO_CONTA, type TipoConta } from "@/lib/financeiro";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { DinheiroInput, isoHoje } from "../comum";

export const CORES_CONTA = ["#7C8FFF", "#1E2D6B", "#1A8F5E", "#F5A623", "#C94343", "#0EA5E9", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B"];

const vazio = (): ContaIn => ({
  nome: "",
  banco: null,
  agencia: null,
  numero: null,
  tipo: "corrente",
  titular: null,
  emissora_id: null,
  saldo_inicial: "",
  data_saldo_inicial: isoHoje(),
  cor: CORES_CONTA[0],
  ativo: true,
});

const n = (s: string | null) => (s && s.trim() ? s.trim() : null);

/** Formulário de conta bancária (página "Nova conta" e edição no extrato). */
export function ContaForm({ conta, onSalvo, onCancelar }: { conta?: ContaOut | null; onSalvo: (c: ContaOut) => void; onCancelar?: () => void }) {
  const qc = useQueryClient();
  const emissoras = useEmissoras();
  const [f, setF] = useState<ContaIn>(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega a conta */
  useEffect(() => {
    setF(
      conta
        ? {
            nome: conta.nome,
            banco: conta.banco,
            agencia: conta.agencia,
            numero: conta.numero,
            tipo: conta.tipo,
            titular: conta.titular,
            emissora_id: conta.emissora_id,
            saldo_inicial: paraBr(conta.saldo_inicial),
            data_saldo_inicial: conta.data_saldo_inicial,
            cor: conta.cor,
            ativo: conta.ativo,
          }
        : vazio(),
    );
  }, [conta]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof ContaIn>(k: K, v: ContaIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body: ContaIn = {
        ...f,
        nome: f.nome.trim(),
        banco: n(f.banco),
        agencia: n(f.agencia),
        numero: n(f.numero),
        titular: n(f.titular),
        saldo_inicial: paraDecimalApi(f.saldo_inicial),
      };
      return conta ? api.put<ContaOut>(`/financeiro/contas/${conta.id}`, body) : api.post<ContaOut>("/financeiro/contas", body);
    },
    onSuccess: (c) => {
      toast.success(conta ? "Conta atualizada" : `Conta “${c.nome}” criada`);
      qc.invalidateQueries({ queryKey: ["fin"] });
      onSalvo(c);
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (f.nome.trim().length < 2) return toast.error("Dê um nome à conta.");
        salvar.mutate();
      }}
      className="space-y-5"
    >
      {/* prévia do cartão */}
      <div className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${f.cor}, color-mix(in oklab, ${f.cor} 55%, #0f1729))` }}>
        <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-xs text-white/70">{ROTULO_TIPO_CONTA[f.tipo]}</p>
            <p className="text-lg font-semibold">{f.nome || "Nome da conta"}</p>
            <p className="font-mono text-xs text-white/80">
              {[f.banco, f.agencia && `ag ${f.agencia}`, f.numero && `cc ${f.numero}`].filter(Boolean).join(" · ") || "banco · agência · número"}
            </p>
          </div>
          <Landmark className="size-6 text-white/70" />
        </div>
        <p className="relative mt-6 text-xs text-white/70">Saldo inicial</p>
        <p className="relative font-mono text-2xl font-semibold">{moeda(toNum(paraDecimalApi(f.saldo_inicial || "0")))}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Nome da conta" obrigatorio htmlFor="conta-nome" className="sm:col-span-4">
          <Input id="conta-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="ex.: Itaú principal, Caixinha, CDB" autoFocus={!conta} />
        </Field>
        <Field label="Tipo" htmlFor="conta-tipo" className="sm:col-span-2">
          <NativeSelect id="conta-tipo" value={f.tipo} onChange={(e) => set("tipo", e.target.value as TipoConta)}>
            {Object.entries(ROTULO_TIPO_CONTA).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Banco" htmlFor="conta-banco" className="sm:col-span-2">
          <Input id="conta-banco" value={f.banco ?? ""} onChange={(e) => set("banco", e.target.value)} placeholder="ex.: Itaú" />
        </Field>
        <Field label="Agência" htmlFor="conta-agencia" className="sm:col-span-2">
          <Input id="conta-agencia" value={f.agencia ?? ""} onChange={(e) => set("agencia", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Número" htmlFor="conta-numero" className="sm:col-span-2">
          <Input id="conta-numero" value={f.numero ?? ""} onChange={(e) => set("numero", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Titular" htmlFor="conta-titular" className="sm:col-span-3">
          <Input id="conta-titular" value={f.titular ?? ""} onChange={(e) => set("titular", e.target.value)} />
        </Field>
        <Field label="Empresa emissora" htmlFor="conta-emissora" dica="Opcional: de qual CNPJ é a conta." className="sm:col-span-3">
          <NativeSelect id="conta-emissora" value={f.emissora_id ?? ""} onChange={(e) => set("emissora_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {emissoras.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {nomeEmissora(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Saldo inicial" htmlFor="conta-saldo" dica="Negativo se a conta começou no vermelho (ex.: -1.500,00)." className="sm:col-span-3">
          <DinheiroInput id="conta-saldo" value={f.saldo_inicial} onChange={(v) => set("saldo_inicial", v)} />
        </Field>
        <Field label="Data do saldo inicial" htmlFor="conta-data" className="sm:col-span-3">
          <Input id="conta-data" type="date" value={f.data_saldo_inicial ?? ""} onChange={(e) => set("data_saldo_inicial", e.target.value || null)} />
        </Field>
        <fieldset className="sm:col-span-6">
          <legend className="mb-2 text-[13px] text-foreground/80">Cor</legend>
          <div className="flex flex-wrap items-center gap-2">
            {CORES_CONTA.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("cor", c)}
                aria-label={`Cor ${c}`}
                aria-pressed={f.cor.toLowerCase() === c.toLowerCase()}
                className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition", f.cor.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground")}
                style={{ background: c }}
              >
                {f.cor.toLowerCase() === c.toLowerCase() && <Check className="size-4 text-white" />}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="color" value={f.cor} onChange={(e) => set("cor", e.target.value)} className="size-8 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label="Outra cor" />
              outra
            </label>
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Conta ativa" /> Ativa
        </label>
        <div className="ml-auto flex gap-2">
          {onCancelar && (
            <Button type="button" variant="outline" onClick={onCancelar}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending && <Loader2 className="animate-spin" />} {conta ? "Salvar conta" : "Criar conta"}
          </Button>
        </div>
      </div>
    </form>
  );
}
