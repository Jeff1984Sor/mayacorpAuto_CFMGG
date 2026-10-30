"use client";

import { useMutation } from "@tanstack/react-query";
import { Info, Landmark, Loader2, RefreshCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CasoIn } from "@/lib/faturamento";
import { numero } from "@/lib/format";
import { mascaraCnj, POLO, rotuloSistema } from "@/lib/tribunais";

/** Saída de GET /tribunais/capa (backend/app/modules/tribunais/caso.py · capa). */
export interface CapaProcesso {
  numero_cnj: string;
  numero_formatado: string;
  tribunal: string;
  tribunal_nome: string;
  tipo: "judicial_estadual" | "judicial_federal" | "judicial_trabalhista" | null;
  instancia: string | null;
  vara: string | null;
  comarca: string | null;
  classe: string | null;
  assuntos: string[];
  data_distribuicao: string | null;
  sistema: string | null;
  partes: { nome: string; polo: string }[];
  polo: "ativo" | "passivo" | null;
  parte_contraria: string | null;
  titulo: string | null;
  movimentos: number;
  encontrado: boolean;
  avisos: string[];
  processo_id: number | null;
}

/** Campos da ficha que o tribunal preenche. */
const CAMPOS = ["titulo", "tipo", "tribunal", "instancia", "vara", "comarca", "data_distribuicao", "polo", "parte_contraria"] as const;
type CampoCapa = (typeof CAMPOS)[number];
const ROTULO: Record<CampoCapa, string> = {
  titulo: "título",
  tipo: "tipo",
  tribunal: "tribunal",
  instancia: "instância",
  vara: "vara",
  comarca: "comarca",
  data_distribuicao: "distribuição",
  polo: "polo",
  parte_contraria: "parte contrária",
};

const vazio = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const igual = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Valores do tribunal para a ficha (só o que veio preenchido). */
function valoresDaCapa(c: CapaProcesso): Partial<CasoIn> {
  const out: Partial<Record<CampoCapa, unknown>> = {};
  for (const k of CAMPOS) if (!vazio(c[k])) out[k] = c[k];
  return out as Partial<CasoIn>;
}

/**
 * Nº do processo (CNJ) da ficha do caso: com 20 dígitos consulta o tribunal (GET /tribunais/capa) e preenche
 * os campos vazios, sem sobrescrever o que já foi digitado.
 */
export function CnjCaso({
  valor,
  onChange,
  contratoId,
  form,
  onAplicar,
}: {
  valor: string | null;
  onChange: (v: string) => void;
  contratoId: number | null | undefined;
  form: CasoIn;
  onAplicar: (patch: Partial<CasoIn>) => void;
}) {
  const { pode } = useAuth();
  const podeBuscar = pode("casos.editar");
  const [capa, setCapa] = useState<CapaProcesso | null>(null);
  const [conflitos, setConflitos] = useState<CampoCapa[]>([]);
  const [digitou, setDigitou] = useState(false);
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const ultimoRef = useRef<string | null>(null);

  const consultar = useMutation({
    mutationFn: (num: string) => api.get<CapaProcesso>("/tribunais/capa", { numero: num, contrato_id: contratoId ?? undefined }),
    onSuccess: (c) => {
      const atual = formRef.current;
      const vals = valoresDaCapa(c);
      const patch: Partial<Record<CampoCapa, unknown>> = {};
      const diferentes: CampoCapa[] = [];
      for (const k of CAMPOS) {
        if (!(k in vals)) continue;
        if (vazio(atual[k])) patch[k] = vals[k];
        else if (!igual(atual[k], vals[k])) diferentes.push(k);
      }
      onAplicar(patch as Partial<CasoIn>);
      setCapa(c);
      setConflitos(diferentes);
    },
  });

  const debounced = useDebounce(valor ?? "", 600);
  const num = digitos(debounced);
  const { mutate } = consultar;
  useEffect(() => {
    if (!podeBuscar || !digitou || num.length !== 20 || ultimoRef.current === num) return;
    ultimoRef.current = num;
    mutate(num);
  }, [num, digitou, podeBuscar, mutate]);

  const atualCompleto = digitos(valor).length === 20;
  const buscar = () => {
    const n = digitos(valor);
    ultimoRef.current = n;
    consultar.mutate(n);
  };
  const usarTribunal = () => {
    if (!capa) return;
    const vals = valoresDaCapa(capa) as Record<string, unknown>;
    onAplicar(Object.fromEntries(conflitos.map((k) => [k, vals[k]])) as Partial<CasoIn>);
    setConflitos([]);
  };
  const mostrarCapa = capa && capa.numero_cnj === digitos(valor);
  const polos = mostrarCapa ? [...new Set(capa.partes.map((p) => p.polo))] : [];

  return (
    <div className="space-y-3 sm:col-span-6">
      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Número do processo (CNJ)"
          htmlFor="caso-processo"
          className="min-w-64 flex-1"
          dica={podeBuscar ? "Com o número completo, os dados do processo vêm do tribunal." : undefined}
        >
          <Input
            id="caso-processo"
            value={valor ?? ""}
            onChange={(e) => {
              setDigitou(true);
              onChange(mascaraCnj(e.target.value));
            }}
            className="h-10 font-mono text-base"
            placeholder="0000000-00.0000.0.00.0000"
            inputMode="numeric"
          />
        </Field>
        {podeBuscar && (
          <Button type="button" variant="outline" className="mb-[22px] h-10" disabled={!atualCompleto || consultar.isPending} onClick={buscar}>
            {consultar.isPending ? <Loader2 className="animate-spin" /> : <Search />} Buscar no tribunal
          </Button>
        )}
      </div>

      {consultar.isPending && (
        <p className="flex items-center gap-2 rounded-lg bg-brand/8 px-3 py-2 text-sm text-info-ink">
          <Loader2 className="size-4 animate-spin" /> Consultando o tribunal…
        </p>
      )}

      {mostrarCapa && !consultar.isPending && (
        <div className="rounded-xl border bg-muted/25 p-3 text-sm">
          <div className="flex flex-wrap items-start gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-navy dark:text-brand">
              <Landmark className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{capa.tribunal_nome}</span>
                <Pill tom="brand">{capa.tribunal}</Pill>
                {capa.sistema && <span className="text-xs text-muted-foreground">{rotuloSistema(capa.sistema)}</span>}
                {capa.encontrado && (
                  <span className="text-xs text-muted-foreground">
                    · <span className="num">{numero(capa.movimentos)}</span> movimentação(ões)
                  </span>
                )}
                {capa.processo_id && <Pill tom="success">já acompanhado</Pill>}
              </p>
              {capa.classe && <p className="mt-0.5">{capa.classe}</p>}
              {capa.assuntos.length > 0 && <p className="text-xs text-muted-foreground">{capa.assuntos.join(" · ")}</p>}
              {polos.length > 0 && (
                <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {polos.map((polo) => (
                    <div key={polo} className="min-w-0">
                      <dt className="text-muted-foreground">{POLO[polo] ?? polo}</dt>
                      <dd className="truncate">
                        {capa.partes
                          .filter((p) => p.polo === polo)
                          .map((p) => p.nome)
                          .join(", ")}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
          {capa.avisos.length > 0 && (
            <ul className="mt-2 space-y-1 border-t pt-2">
              {capa.avisos.map((a) => (
                <li key={a} className="flex items-start gap-1.5 text-xs text-info-ink">
                  <Info className="mt-0.5 size-3.5 shrink-0" /> {a}
                </li>
              ))}
            </ul>
          )}
          {conflitos.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
              <span className="text-warning-ink">
                O tribunal informa outro valor para {conflitos.map((k) => ROTULO[k]).join(", ")}.
              </span>
              <Button type="button" size="xs" variant="outline" onClick={usarTribunal}>
                <RefreshCw /> Usar dados do tribunal
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
