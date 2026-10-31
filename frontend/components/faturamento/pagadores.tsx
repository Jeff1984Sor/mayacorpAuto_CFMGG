"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { PagadorIn } from "@/lib/faturamento";
import { toNum } from "@/lib/format";
import type { Pagina, TomadorOut } from "@/lib/types";
import { cn } from "@/lib/utils";

type Modo = "cliente" | "outro" | "dividir";

const MODOS: { v: Modo; l: string }[] = [
  { v: "cliente", l: "O próprio cliente" },
  { v: "outro", l: "Outro cliente" },
  { v: "dividir", l: "Dividir entre clientes" },
];

const modoDe = (p: PagadorIn[]): Modo =>
  p.length === 0 ? "cliente" : p.length === 1 ? "outro" : "dividir";

/** Mensagem de erro dos pagadores (ou null se está tudo certo). */
export function erroPagadores(p: PagadorIn[]): string | null {
  if (p.some((x) => !x.tomador_id)) return "Escolha quem paga o contrato.";
  if (new Set(p.map((x) => x.tomador_id)).size !== p.length)
    return "O mesmo pagador aparece duas vezes.";
  if (
    p.length > 1 &&
    Math.abs(p.reduce((s, x) => s + toNum(x.percentual), 0) - 100) > 0.001
  )
    return "A divisão entre os pagadores precisa somar 100%.";
  return null;
}

/** Quem paga o contrato: o próprio cliente (padrão), outro cliente, ou vários com a % de cada um. */
export function PagadoresCampo({
  tomadorId,
  nomes,
  valor,
  onChange,
}: {
  /** cliente do contrato */
  tomadorId: number;
  /** nomes já conhecidos (cliente do contrato e pagadores salvos) */
  nomes: Record<number, string>;
  valor: PagadorIn[];
  onChange: (v: PagadorIn[]) => void;
}) {
  const modo = modoDe(valor);
  const total = valor.reduce((s, x) => s + toNum(x.percentual), 0);

  const escolherModo = (m: Modo) => {
    if (m === modo) return;
    if (m === "cliente") onChange([]);
    else if (m === "outro") onChange([{ tomador_id: 0, percentual: "100" }]);
    else
      onChange([
        { tomador_id: valor[0]?.tomador_id || tomadorId, percentual: "50" },
        { tomador_id: 0, percentual: "50" },
      ]);
  };
  const alterar = (i: number, p: Partial<PagadorIn>) =>
    onChange(valor.map((x, j) => (j === i ? { ...x, ...p } : x)));

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Quem paga"
      >
        {MODOS.map((o) => (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={modo === o.v}
            onClick={() => escolherModo(o.v)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition",
              modo === o.v
                ? "border-brand bg-brand/10 font-medium text-info-ink"
                : "text-muted-foreground hover:border-brand/40",
            )}
          >
            {o.l}
          </button>
        ))}
      </div>

      {modo === "cliente" && (
        <p className="text-xs text-muted-foreground">
          As faturas saem em nome do cliente do contrato.
        </p>
      )}

      {modo === "outro" && (
        <>
          <ClienteBusca
            id="contrato-pagador-0"
            valor={valor[0].tomador_id}
            nomes={nomes}
            onChange={(id) => alterar(0, { tomador_id: id })}
          />
          <p className="text-xs text-muted-foreground">
            As faturas e a NFS-e saem em nome deste pagador.
          </p>
        </>
      )}

      {modo === "dividir" && (
        <>
          {valor.map((p, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2"
            >
              <ClienteBusca
                id={`contrato-pagador-${i}`}
                valor={p.tomador_id}
                nomes={nomes}
                onChange={(id) => alterar(i, { tomador_id: id })}
              />
              <div className="relative">
                <Input
                  aria-label={`Percentual do pagador ${i + 1}`}
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={p.percentual}
                  onChange={(e) => alterar(i, { percentual: e.target.value })}
                  className="pr-6 text-right font-mono"
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover pagador ${i + 1}`}
                disabled={valor.length <= 2}
                onClick={() => onChange(valor.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange([
                  ...valor,
                  {
                    tomador_id: 0,
                    percentual: String(Math.max(0, 100 - total)),
                  },
                ])
              }
            >
              <Plus /> Pagador
            </Button>
            <p
              className={cn(
                "font-mono text-xs",
                Math.abs(total - 100) > 0.001
                  ? "text-danger"
                  : "text-muted-foreground",
              )}
            >
              Total{" "}
              {total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Cada pagador recebe a própria fatura (e NFS-e) com a sua parte de
            cada item.
          </p>
        </>
      )}
    </div>
  );
}

function ClienteBusca({
  id,
  valor,
  nomes,
  onChange,
}: {
  id: string;
  valor: number;
  nomes: Record<number, string>;
  onChange: (id: number) => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<Record<number, string>>({});
  const clientes = useQuery({
    queryKey: ["tomadores-picker-pagador", busca],
    queryFn: () =>
      api.get<Pagina<TomadorOut>>("/nfse/tomadores", {
        q: busca,
        por_pagina: 30,
      }),
  });
  const opcoes = clientes.data?.itens ?? [];
  const faltando = valor && !opcoes.some((c) => c.id === valor);
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
      <Input
        aria-label="Buscar pagador"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou CNPJ"
      />
      <NativeSelect
        id={id}
        value={valor || ""}
        onChange={(e) => {
          const novo = Number(e.target.value) || 0;
          const c = opcoes.find((x) => x.id === novo);
          if (c) setEscolhido((o) => ({ ...o, [c.id]: c.nome }));
          onChange(novo);
        }}
      >
        <option value="">Escolha…</option>
        {faltando && (
          <option value={valor}>
            {escolhido[valor] ?? nomes[valor] ?? `Cliente ${valor}`}
          </option>
        )}
        {opcoes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
