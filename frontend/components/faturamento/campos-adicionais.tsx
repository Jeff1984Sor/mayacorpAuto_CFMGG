"use client";

import { useQuery } from "@tanstack/react-query";
import { AlignLeft, Calendar, CircleDollarSign, Hash, List, ToggleLeft, Type } from "lucide-react";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { AreaOut, CampoOut, TipoCampo, ValorCampo } from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export const TIPOS_CAMPO: Record<TipoCampo, { l: string; d: string; icone: React.ComponentType<{ className?: string }> }> = {
  texto: { l: "Texto curto", d: "Uma linha", icone: Type },
  texto_longo: { l: "Texto longo", d: "Parágrafos", icone: AlignLeft },
  numero: { l: "Número", d: "Quantidade, código", icone: Hash },
  moeda: { l: "Valor em R$", d: "Dinheiro", icone: CircleDollarSign },
  data: { l: "Data", d: "Dia/mês/ano", icone: Calendar },
  sim_nao: { l: "Sim / não", d: "Liga e desliga", icone: ToggleLeft },
  lista: { l: "Lista", d: "Escolha entre opções", icone: List },
};

export function useAreas(enabled = true) {
  return useQuery({ queryKey: ["fat", "areas"], queryFn: () => api.get<AreaOut[]>("/faturamento/areas"), enabled, staleTime: 30_000 });
}

export function useCampos(enabled = true) {
  return useQuery({ queryKey: ["fat", "campos"], queryFn: () => api.get<CampoOut[]>("/faturamento/campos"), enabled, staleTime: 30_000 });
}

/** Campos ativos que valem para um caso desta área, na ordem configurada. */
export function camposDaArea(campos: CampoOut[] | undefined, areaId: number | null) {
  return (campos ?? []).filter((c) => c.ativo && (!c.area_id || c.area_id === areaId)).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
}

/** Valor do campo para leitura. */
export function exibirCampo(c: CampoOut, v: ValorCampo | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  switch (c.tipo) {
    case "moeda":
      return moeda(toNum(String(v).replace(",", ".")));
    case "numero":
      return toNum(String(v).replace(",", ".")).toLocaleString("pt-BR");
    case "data":
      return data(String(v));
    case "sim_nao":
      return v === true || v === "true" ? "Sim" : "Não";
    default:
      return String(v);
  }
}

/** Entrada certa para cada tipo de campo adicional. */
export function CampoInput({ campo, valor, onChange, id }: { campo: CampoOut; valor: ValorCampo | undefined; onChange: (v: ValorCampo) => void; id: string }) {
  const v = valor ?? "";
  switch (campo.tipo) {
    case "texto_longo":
      return <Textarea id={id} rows={3} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
    case "numero":
      return <Input id={id} inputMode="decimal" value={String(v)} onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ""))} className="font-mono" />;
    case "moeda":
      return (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
          <Input id={id} inputMode="decimal" value={String(v)} onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))} className="pl-8 text-right font-mono" />
        </div>
      );
    case "data":
      return <Input id={id} type="date" value={String(v)} onChange={(e) => onChange(e.target.value || null)} />;
    case "sim_nao":
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch id={id} checked={v === true || v === "true"} onCheckedChange={(x) => onChange(x)} aria-label={campo.nome} />
          {v === true || v === "true" ? "Sim" : "Não"}
        </label>
      );
    case "lista":
      return (
        <NativeSelect id={id} value={String(v)} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {campo.opcoes.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      );
    default:
      return <Input id={id} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** Bloco com os campos adicionais (formulário do caso). */
export function CamposAdicionaisForm({
  campos,
  valores,
  onChange,
  idBase,
  className,
}: {
  campos: CampoOut[];
  valores: Record<string, ValorCampo>;
  onChange: (id: number, v: ValorCampo) => void;
  idBase: string;
  className?: string;
}) {
  if (!campos.length) return null;
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {campos.map((c) => (
        <Field key={c.id} label={c.nome} obrigatorio={c.obrigatorio} htmlFor={`${idBase}-${c.id}`} dica={c.ajuda ?? undefined} className={cn(c.tipo === "texto_longo" && "sm:col-span-2")}>
          <CampoInput id={`${idBase}-${c.id}`} campo={c} valor={valores[String(c.id)]} onChange={(v) => onChange(c.id, v)} />
        </Field>
      ))}
    </div>
  );
}
