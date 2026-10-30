"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Coins, Loader2, Pencil, Plus, Save, Scale, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { Field, FormSection, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { moeda } from "@/lib/format";
import {
  chaveProtocolos,
  type ConfigTribunais,
  type FaixaSetup,
  paraDecimal,
  type PlanoIn,
  type PlanoOut,
  type PlanosOut,
  ROTULO_TIPO,
  type TipoProtocolo,
  useConfigTribunais,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const numOuNull = (v: string) => (v.trim() === "" ? null : Number(v));

const planoVazio = (): PlanoIn => ({
  nome: "",
  preco_mensal: "",
  creditos_protocolo_mes: 30,
  creditos_acumulam: false,
  permite_excedente: true,
  limite_excedente_mes: null,
  limite_processos_monitorados: null,
  limite_certificados: null,
  ativo: true,
  faixas: [],
});

function PlanoDialog({ alvo, onOpenChange }: { alvo: { plano: PlanoOut | null } | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PlanoIn>(() => {
    if (!alvo?.plano) return planoVazio();
    const { id: _id, ...resto } = alvo.plano;
    void _id;
    return resto;
  });
  const set = (x: Partial<PlanoIn>) => setF((v) => ({ ...v, ...x }));
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = {
        ...f,
        preco_mensal: paraDecimal(f.preco_mensal) ?? "0",
        faixas: f.faixas.map((x) => ({ ...x, preco_por_credito: paraDecimal(x.preco_por_credito) ?? "0" })),
      };
      return alvo?.plano ? api.put<PlanoOut>(`/tribunais/planos/${alvo.plano.id}`, corpo) : api.post<PlanoOut>("/tribunais/planos", corpo);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "planos"] });
      toast.success("Plano salvo");
      onOpenChange(false);
    },
  });
  const setFaixa = (i: number, x: Partial<PlanoIn["faixas"][number]>) => set({ faixas: f.faixas.map((y, j) => (j === i ? { ...y, ...x } : y)) });
  return (
    <FormDialog
      open={!!alvo}
      onOpenChange={onOpenChange}
      titulo={alvo?.plano ? `Plano ${alvo.plano.nome}` : "Novo plano"}
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="divide-y">
        <FormSection titulo="Plano">
          <Field label="Nome" obrigatorio>
            <Input value={f.nome} onChange={(e) => set({ nome: e.target.value })} required minLength={2} maxLength={80} />
          </Field>
          <Field label="Mensalidade (R$)" obrigatorio>
            <Input value={f.preco_mensal} onChange={(e) => set({ preco_mensal: e.target.value })} className="font-mono" inputMode="decimal" required />
          </Field>
          <Field label="Créditos de protocolo por mês" obrigatorio>
            <Input type="number" min={0} value={f.creditos_protocolo_mes} onChange={(e) => set({ creditos_protocolo_mes: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Teto de excedente por mês" dica="Vazio = sem teto.">
            <Input type="number" min={0} value={f.limite_excedente_mes ?? ""} onChange={(e) => set({ limite_excedente_mes: numOuNull(e.target.value) })} />
          </Field>
          <Field label="Processos monitorados (limite)">
            <Input
              type="number"
              min={0}
              value={f.limite_processos_monitorados ?? ""}
              onChange={(e) => set({ limite_processos_monitorados: numOuNull(e.target.value) })}
            />
          </Field>
          <Field label="Advogados com certificado (limite)">
            <Input type="number" min={0} value={f.limite_certificados ?? ""} onChange={(e) => set({ limite_certificados: numOuNull(e.target.value) })} />
          </Field>
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
            <SwitchRow titulo="Permite excedente" descricao="Sem isso, bloqueia ao esgotar.">
              <Switch checked={f.permite_excedente} onCheckedChange={(v) => set({ permite_excedente: v })} />
            </SwitchRow>
            <SwitchRow titulo="Créditos acumulam">
              <Switch checked={f.creditos_acumulam} onCheckedChange={(v) => set({ creditos_acumulam: v })} />
            </SwitchRow>
            <SwitchRow titulo="Ativo">
              <Switch checked={f.ativo} onCheckedChange={(v) => set({ ativo: v })} />
            </SwitchRow>
          </div>
        </FormSection>
        <FormSection titulo="Faixas de excedente" descricao="O preço por crédito cai conforme o consumo sobe.">
          <div className="space-y-2 sm:col-span-2">
            {f.faixas.map((x, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? "De (créditos)" : ""}>
                  <Input type="number" min={1} value={x.de_creditos} onChange={(e) => setFaixa(i, { de_creditos: Number(e.target.value) || 1 })} />
                </Field>
                <Field label={i === 0 ? "Até (vazio = sem fim)" : ""}>
                  <Input type="number" min={1} value={x.ate_creditos ?? ""} onChange={(e) => setFaixa(i, { ate_creditos: numOuNull(e.target.value) })} />
                </Field>
                <Field label={i === 0 ? "R$ por crédito" : ""}>
                  <Input value={x.preco_por_credito} onChange={(e) => setFaixa(i, { preco_por_credito: e.target.value })} className="font-mono" inputMode="decimal" />
                </Field>
                <Button type="button" variant="ghost" size="icon-sm" className="mb-1" aria-label="Remover faixa" onClick={() => set({ faixas: f.faixas.filter((_, j) => j !== i) })}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const ult = f.faixas.at(-1);
                set({ faixas: [...f.faixas, { de_creditos: ult?.ate_creditos ? ult.ate_creditos + 1 : 1, ate_creditos: null, preco_por_credito: "" }] });
              }}
            >
              <Plus /> Faixa
            </Button>
          </div>
        </FormSection>
      </div>
    </FormDialog>
  );
}

function Pesos({ pesos }: { pesos: Record<string, number> }) {
  const qc = useQueryClient();
  const [f, setF] = useState(pesos);
  const salvar = useMutation({
    mutationFn: () => api.put<PlanosOut>("/tribunais/pesos", f),
    onSuccess: (r) => {
      qc.setQueryData([chaveProtocolos, "planos"], r);
      toast.success("Pesos salvos");
    },
  });
  return (
    <div className="card-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <Scale className="size-4 text-info-ink" /> Créditos por tipo de protocolo
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        {(Object.keys(ROTULO_TIPO) as TipoProtocolo[]).map((t) => (
          <Field key={t} label={ROTULO_TIPO[t]}>
            <Input type="number" min={0} value={f[t] ?? 0} onChange={(e) => setF({ ...f, [t]: Math.max(0, Number(e.target.value) || 0) })} className="font-mono" />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending || JSON.stringify(f) === JSON.stringify(pesos)}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar pesos
        </Button>
      </div>
    </div>
  );
}

function Setup({ setup }: { setup: FaixaSetup[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState(setup);
  const setL = (i: number, x: Partial<FaixaSetup>) => setF((l) => l.map((y, j) => (j === i ? { ...y, ...x } : y)));
  const salvar = useMutation({
    mutationFn: () =>
      api.put<PlanosOut>(
        "/tribunais/faixas-setup",
        f.map(({ id: _id, ...x }) => {
          void _id;
          return { ...x, preco: paraDecimal(x.preco) ?? "0" };
        }),
      ),
    onSuccess: (r) => {
      qc.setQueryData([chaveProtocolos, "planos"], r);
      toast.success("Faixas de setup salvas");
    },
  });
  return (
    <div className="card-surface p-5">
      <h3 className="font-semibold">Setup de importação (cobrança única)</h3>
      <p className="mb-3 text-sm text-muted-foreground">Por quantidade de processos importados na varredura pela OAB.</p>
      <div className="space-y-2">
        {f.map((x, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
            <Field label="De (processos)">
              <Input type="number" min={1} value={x.de_processos} onChange={(e) => setL(i, { de_processos: Number(e.target.value) || 1 })} />
            </Field>
            <Field label="Até">
              <Input type="number" min={1} value={x.ate_processos ?? ""} onChange={(e) => setL(i, { ate_processos: numOuNull(e.target.value) })} />
            </Field>
            <Field label="Preço (R$)">
              <Input value={x.preco} onChange={(e) => setL(i, { preco: e.target.value })} className="font-mono" inputMode="decimal" />
            </Field>
            <Field label="Reimportação grátis (dias)">
              <Input type="number" min={0} value={x.reimportacao_gratis_dias ?? ""} onChange={(e) => setL(i, { reimportacao_gratis_dias: numOuNull(e.target.value) })} />
            </Field>
            <label className="inline-flex h-9 items-center gap-2 text-xs">
              <Checkbox checked={x.inclui_download_autos} onCheckedChange={(v) => setL(i, { inclui_download_autos: !!v })} /> Inclui download dos autos
            </label>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover" onClick={() => setF((l) => l.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setF((l) => [
              ...l,
              { de_processos: (l.at(-1)?.ate_processos ?? 0) + 1, ate_processos: null, preco: "", inclui_download_autos: false, reimportacao_gratis_dias: 30 },
            ])
          }
        >
          <Plus /> Faixa
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar faixas
        </Button>
      </div>
    </div>
  );
}

function Ajuste() {
  const qc = useQueryClient();
  const [creditos, setCreditos] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/tribunais/cobranca/ajuste", { creditos: Number(creditos), valor: paraDecimal(valor) ?? "0", motivo: motivo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "cobranca"] });
      toast.success("Ajuste lançado no mês atual");
      setCreditos("");
      setValor("");
      setMotivo("");
    },
  });
  return (
    <form
      className="card-surface space-y-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!creditos || Number.isNaN(Number(creditos))) return toast.error("Informe os créditos (negativo para devolver).");
        if (motivo.trim().length < 5) return toast.error("Explique o motivo.");
        m.mutate();
      }}
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <Coins className="size-4 text-info-ink" /> Ajuste de créditos deste escritório
      </h3>
      <p className="text-sm text-muted-foreground">Cortesia, correção ou bônus. Entra no mês atual e fica na auditoria.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Créditos" dica="Negativo devolve créditos.">
          <Input type="number" value={creditos} onChange={(e) => setCreditos(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Valor (R$)" dica="0 = sem cobrança.">
          <Input value={valor} onChange={(e) => setValor(e.target.value)} className="font-mono" inputMode="decimal" placeholder="0,00" />
        </Field>
      </div>
      <Field label="Motivo" obrigatorio>
        <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={300} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={m.isPending}>
          {m.isPending ? <Loader2 className="animate-spin" /> : <Check />} Lançar ajuste
        </Button>
      </div>
    </form>
  );
}

export function PlanosTribunais() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [chaveProtocolos, "planos"], queryFn: () => api.get<PlanosOut>("/tribunais/planos") });
  const cfg = useConfigTribunais();
  const [editar, setEditar] = useState<{ plano: PlanoOut | null } | null>(null);
  const definir = useMutation({
    mutationFn: (pid: number | null) => api.put<ConfigTribunais>(`/tribunais/config/plano${pid ? `?plano_id=${pid}` : ""}`),
    onSuccess: (r) => {
      qc.setQueryData([chaveProtocolos, "config"], r);
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "cobranca"] });
      toast.success(r.plano_nome ? `Escritório no plano ${r.plano_nome}` : "Escritório sem plano");
    },
  });
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const atual = cfg.data?.plano_id ?? null;

  return (
    <div className="space-y-6">
      <div className="card-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <Field label="Plano deste escritório" className="flex-1">
          <NativeSelect value={atual ?? ""} onChange={(e) => definir.mutate(Number(e.target.value) || null)} disabled={definir.isPending}>
            <option value="">Sem plano (sem franquia nem cobrança)</option>
            {q.data.planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome} · {moeda(p.preco_mensal)}/mês · {p.creditos_protocolo_mes} créditos
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button onClick={() => setEditar({ plano: null })}>
          <Plus /> Novo plano
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {q.data.planos.map((p) => (
          <div key={p.id} className={cn("card-surface p-5", p.id === atual && "ring-2 ring-brand", !p.ativo && "opacity-60")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="flex items-center gap-2 font-semibold">
                  {p.nome}
                  {p.id === atual && <Pill tom="brand">em uso</Pill>}
                  {!p.ativo && <Pill tom="neutral">inativo</Pill>}
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  <Mono>{moeda(p.preco_mensal)}</Mono>
                  <span className="text-sm font-normal text-muted-foreground">/mês</span>
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label="Editar plano" onClick={() => setEditar({ plano: p })}>
                <Pencil />
              </Button>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              <li>
                <Mono className="text-foreground">{p.creditos_protocolo_mes}</Mono> créditos de protocolo por mês{p.creditos_acumulam ? " (acumulam)" : ""}
              </li>
              <li>{p.permite_excedente ? `Excedente permitido${p.limite_excedente_mes != null ? ` até ${p.limite_excedente_mes}` : ""}` : "Sem excedente: bloqueia ao esgotar"}</li>
              {p.limite_certificados != null && <li>Até {p.limite_certificados} advogado(s) com certificado</li>}
              {p.limite_processos_monitorados != null && <li>Até {p.limite_processos_monitorados} processos monitorados</li>}
              {p.faixas.map((fx) => (
                <li key={fx.de_creditos} className="text-xs">
                  Excedente {fx.de_creditos}–{fx.ate_creditos ?? "∞"}: <Mono>{moeda(fx.preco_por_credito)}</Mono>/crédito
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Pesos key={JSON.stringify(q.data.pesos)} pesos={q.data.pesos} />
      <Setup key={JSON.stringify(q.data.setup)} setup={q.data.setup} />
      <Ajuste />
      {editar && <PlanoDialog key={editar.plano?.id ?? "novo"} alvo={editar} onOpenChange={(o) => !o && setEditar(null)} />}
    </div>
  );
}
