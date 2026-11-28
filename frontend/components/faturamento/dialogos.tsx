"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { erroPagadores, PagadoresCampo } from "@/components/faturamento/pagadores";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import {
  type CampoOut,
  type CasoIn,
  type CasoOut,
  type ContratoIn,
  type ContratoOut,
  type ProfissionalOut,
  type TabelaOut,
  type ValorCampo,
} from "@/lib/faturamento";
import { paraBr, paraDecimalApi } from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { Pagina, TomadorOut } from "@/lib/types";

const nulo = (s: string | null | undefined) =>
  s && s.trim() ? s.trim() : null;

export function useTabelas(enabled = true) {
  return useQuery({
    queryKey: ["fat", "tabelas"],
    queryFn: () => api.get<TabelaOut[]>("/faturamento/tabelas"),
    enabled,
  });
}

export function useProfissionais(enabled = true) {
  return useQuery({
    queryKey: ["fat", "profissionais"],
    queryFn: () => api.get<ProfissionalOut[]>("/faturamento/profissionais"),
    enabled,
    staleTime: 60_000,
  });
}

/** Select de tabela de preço (valor/hora por cargo). */
export function TabelaPrecoSelect({
  id,
  valor,
  onChange,
  vazio,
}: {
  id: string;
  valor: number | null;
  onChange: (v: number | null) => void;
  vazio: string;
}) {
  const tabelas = useTabelas();
  return (
    <NativeSelect
      id={id}
      value={valor ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{vazio}</option>
      {tabelas.data
        ?.filter((t) => t.ativo || t.id === valor)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.nome}
            {!t.ativo ? " (inativa)" : ""}
          </option>
        ))}
    </NativeSelect>
  );
}

const dicaTabela = (
  <>
    Define o valor/hora de cada cargo nas regras por hora.{" "}
    <Link
      href="/configuracoes/faturamento"
      className="text-info-ink hover:underline"
    >
      Gerenciar tabelas
    </Link>
  </>
);

// ---------------------------------------------------------------- contrato
export function ContratoDialog({
  open,
  onOpenChange,
  contrato,
  tomadorId,
  onSalvo,
  simples = false,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contrato?: ContratoOut | null;
  /** cliente fixo (aberto a partir do cadastro do cliente) */
  tomadorId?: number;
  onSalvo?: (c: ContratoOut) => void;
  /** sem a figura do contrato: só o que vale para o cliente (quem paga, emissora, tabela e observação) */
  simples?: boolean;
}) {
  const qc = useQueryClient();
  const emissoras = useEmissoras();
  const [f, setF] = useState<ContratoIn>({
    tomador_id: 0,
    pagadores: [],
    emissora_id: null,
    tabela_preco_id: null,
    nome: "",
    objeto: null,
    data_inicio: null,
    data_fim: null,
    ativo: true,
    observacao: null,
  });
  const [buscaCli, setBuscaCli] = useState("");
  const clientes = useQuery({
    queryKey: ["tomadores-picker-contrato", buscaCli],
    queryFn: () =>
      api.get<Pagina<TomadorOut>>("/nfse/tomadores", {
        situacao: "ativos",
        q: buscaCli,
        por_pagina: 30,
      }),
    enabled: open && !tomadorId && !contrato,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      contrato
        ? {
            tomador_id: contrato.tomador_id,
            pagadores: contrato.pagadores.map((p) => ({
              tomador_id: p.tomador_id,
              percentual: p.percentual,
            })),
            emissora_id: contrato.emissora_id,
            tabela_preco_id: contrato.tabela_preco_id,
            nome: contrato.nome,
            objeto: contrato.objeto,
            data_inicio: contrato.data_inicio,
            data_fim: contrato.data_fim,
            ativo: contrato.ativo,
            observacao: contrato.observacao,
          }
        : {
            tomador_id: tomadorId ?? 0,
            pagadores: [],
            emissora_id: null,
            tabela_preco_id: null,
            nome: "",
            objeto: null,
            data_inicio: new Date().toLocaleDateString("sv-SE"),
            data_fim: null,
            ativo: true,
            observacao: null,
          },
    );
    setBuscaCli("");
  }, [open, contrato, tomadorId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const emissorasAtivas = (emissoras.data ?? []).filter(
    (e) => e.ativa || e.id === f.emissora_id,
  );
  /** com uma só emissora não há "padrão" a escolher: é ela */
  const emissoraUnica =
    emissorasAtivas.length === 1 ? emissorasAtivas[0] : null;
  const set = <K extends keyof ContratoIn>(k: K, v: ContratoIn[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const nomeCliente =
    contrato?.tomador_nome ??
    clientes.data?.itens.find((c) => c.id === f.tomador_id)?.nome;
  const nomesPagadores: Record<number, string> = {
    ...Object.fromEntries(
      (contrato?.pagadores ?? []).map((p) => [p.tomador_id, p.tomador_nome]),
    ),
    ...(f.tomador_id && nomeCliente ? { [f.tomador_id]: nomeCliente } : {}),
  };
  const salvar = useMutation({
    mutationFn: () => {
      const body: ContratoIn = {
        ...f,
        emissora_id: f.emissora_id ?? emissoraUnica?.id ?? null,
        nome: f.nome.trim(),
        objeto: nulo(f.objeto),
        observacao: nulo(f.observacao),
      };
      return contrato
        ? api.put<ContratoOut>(`/faturamento/contratos/${contrato.id}`, body)
        : api.post<ContratoOut>("/faturamento/contratos", body);
    },
    onSuccess: (c) => {
      toast.success(
        simples ? "Cobrança do cliente atualizada" : contrato ? "Contrato atualizado" : `Contrato #${c.numero} criado`,
      );
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(c);
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={
        simples ? "Cobrança do cliente" : contrato ? `Editar contrato #${contrato.numero}` : "Novo contrato"
      }
      descricao={
        simples
          ? "Quem paga as faturas, por qual empresa elas saem e a tabela de preço das horas."
          : "O contrato reúne os casos e as regras de cobrança do cliente."
      }
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.tomador_id) return toast.error("Escolha o cliente.");
        const erro = erroPagadores(f.pagadores);
        if (erro) return toast.error(erro);
        salvar.mutate();
      }}
      rodapeExtra={
        simples ? undefined : (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={f.ativo}
              onCheckedChange={(v) => set("ativo", v)}
              aria-label="Contrato ativo"
            />{" "}
            Ativo
          </label>
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!tomadorId && !contrato && (
          <Field
            label="Cliente"
            obrigatorio
            htmlFor="contrato-cliente"
            className="sm:col-span-2"
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
              <Input
                id="contrato-cliente-busca"
                aria-label="Buscar cliente"
                value={buscaCli}
                onChange={(e) => setBuscaCli(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
              />
              <NativeSelect
                id="contrato-cliente"
                value={f.tomador_id || ""}
                onChange={(e) => set("tomador_id", Number(e.target.value) || 0)}
              >
                <option value="">Escolha…</option>
                {clientes.data?.itens.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </Field>
        )}
        {!simples && (
        <Field
          label="Nome do contrato"
          obrigatorio
          htmlFor="contrato-nome"
          className="sm:col-span-2"
        >
          <Input
            id="contrato-nome"
            value={f.nome}
            onChange={(e) => set("nome", e.target.value)}
            placeholder="ex.: Contencioso cível 2026"
            autoFocus
          />
        </Field>
        )}
        {!simples && (
        <Field
          label="Objeto"
          htmlFor="contrato-objeto"
          className="sm:col-span-2"
        >
          <Textarea
            id="contrato-objeto"
            rows={2}
            value={f.objeto ?? ""}
            onChange={(e) => set("objeto", e.target.value)}
            placeholder="O que o escritório faz por este cliente"
          />
        </Field>
        )}
        <Field label="Quem paga" className="sm:col-span-2">
          <PagadoresCampo
            tomadorId={f.tomador_id}
            nomes={nomesPagadores}
            valor={f.pagadores}
            onChange={(v) => set("pagadores", v)}
          />
        </Field>
        <Field
          label="Empresa emissora"
          htmlFor="contrato-emissora"
          dica={
            emissoraUnica
              ? undefined
              : "Opcional: a padrão é usada se ficar em branco."
          }
        >
          <NativeSelect
            id="contrato-emissora"
            value={f.emissora_id ?? emissoraUnica?.id ?? ""}
            onChange={(e) =>
              set("emissora_id", e.target.value ? Number(e.target.value) : null)
            }
          >
            {!emissoraUnica && <option value="">Padrão</option>}
            {emissorasAtivas.map((e) => (
              <option key={e.id} value={e.id}>
                {nomeEmissora(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Tabela de preço"
          htmlFor="contrato-tabela"
          dica={dicaTabela}
        >
          <TabelaPrecoSelect
            id="contrato-tabela"
            valor={f.tabela_preco_id}
            onChange={(v) => set("tabela_preco_id", v)}
            vazio="Nenhuma"
          />
        </Field>
        <div className={cn("grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-sm", simples && "hidden")}>
          <Field label="Início" htmlFor="contrato-inicio">
            <Input
              id="contrato-inicio"
              type="date"
              value={f.data_inicio ?? ""}
              onChange={(e) => set("data_inicio", e.target.value || null)}
            />
          </Field>
          <Field label="Fim" htmlFor="contrato-fim">
            <Input
              id="contrato-fim"
              type="date"
              value={f.data_fim ?? ""}
              min={f.data_inicio ?? undefined}
              onChange={(e) => set("data_fim", e.target.value || null)}
            />
          </Field>
        </div>
        <Field
          label="Observação"
          htmlFor="contrato-obs"
          className="sm:col-span-2"
        >
          <Textarea
            id="contrato-obs"
            rows={2}
            value={f.observacao ?? ""}
            onChange={(e) => set("observacao", e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------- caso
export const vazioCaso = (): CasoIn => ({
  titulo: "",
  descricao: null,
  numero_processo: null,
  parte_contraria: null,
  tipo: null,
  instancia: null,
  area_id: null,
  polo: null,
  tribunal: null,
  vara: null,
  comarca: null,
  valor_causa: null,
  data_distribuicao: null,
  campos: {},
  responsavel_id: null,
  tabela_preco_id: null,
  status: "aberto",
  data_abertura: new Date().toLocaleDateString("sv-SE"),
  data_encerramento: null,
});

/** Ficha do caso no formato da API (para salvar mesclando alterações). */
export function casoParaIn(c: CasoOut): CasoIn {
  return {
    titulo: c.titulo,
    descricao: c.descricao,
    numero_processo: c.numero_processo,
    parte_contraria: c.parte_contraria,
    tipo: c.tipo,
    instancia: c.instancia,
    area_id: c.area_id,
    polo: c.polo,
    tribunal: c.tribunal,
    vara: c.vara,
    comarca: c.comarca,
    valor_causa: c.valor_causa,
    data_distribuicao: c.data_distribuicao,
    campos: c.campos ?? {},
    responsavel_id: c.responsavel_id,
    tabela_preco_id: c.tabela_preco_id,
    status: c.status,
    data_abertura: c.data_abertura,
    data_encerramento: c.data_encerramento,
    // o tipo do caso vai junto para a gravação não deduzir outro pelo tipo antigo
    tipo_caso: c.tipo_caso,
  };
}

/** Valores de número/moeda dos campos adicionais vão para a API com ponto decimal. */
export function normalizarCampos(
  valores: Record<string, ValorCampo>,
  campos: CampoOut[],
) {
  const out: Record<string, ValorCampo> = {};
  for (const [k, v] of Object.entries(valores)) {
    const c = campos.find((x) => String(x.id) === k);
    if (v === "" || v === undefined) continue;
    out[k] =
      c &&
      (c.tipo === "moeda" || c.tipo === "numero") &&
      v !== null &&
      typeof v !== "boolean"
        ? paraDecimalApi(String(v))
        : v;
  }
  return out;
}

/** Valores vindos da API (ponto decimal) prontos para editar (vírgula). */
export function camposParaForm(
  valores: Record<string, ValorCampo>,
  campos: CampoOut[],
) {
  const out: Record<string, ValorCampo> = { ...valores };
  for (const c of campos) {
    const v = out[String(c.id)];
    if (v === null || v === undefined || typeof v === "boolean") continue;
    if (c.tipo === "moeda") out[String(c.id)] = paraBr(String(v));
    if (c.tipo === "numero") out[String(c.id)] = String(v).replace(".", ",");
  }
  return out;
}
