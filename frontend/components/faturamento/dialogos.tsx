"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import type { CasoIn, CasoOut, ContratoIn, ContratoOut, ProfissionalOut, TabelaOut } from "@/lib/faturamento";
import type { Pagina, TomadorOut } from "@/lib/types";

const nulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function useTabelas(enabled = true) {
  return useQuery({ queryKey: ["fat", "tabelas"], queryFn: () => api.get<TabelaOut[]>("/faturamento/tabelas"), enabled });
}

export function useProfissionais(enabled = true) {
  return useQuery({ queryKey: ["fat", "profissionais"], queryFn: () => api.get<ProfissionalOut[]>("/faturamento/profissionais"), enabled, staleTime: 60_000 });
}

/** Select de tabela de preço (valor/hora por cargo). */
export function TabelaPrecoSelect({ id, valor, onChange, vazio }: { id: string; valor: number | null; onChange: (v: number | null) => void; vazio: string }) {
  const tabelas = useTabelas();
  return (
    <NativeSelect id={id} value={valor ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
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
    <Link href="/configuracoes/faturamento" className="text-info-ink hover:underline">
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contrato?: ContratoOut | null;
  /** cliente fixo (aberto a partir do cadastro do cliente) */
  tomadorId?: number;
  onSalvo?: (c: ContratoOut) => void;
}) {
  const qc = useQueryClient();
  const emissoras = useEmissoras();
  const [f, setF] = useState<ContratoIn>({
    tomador_id: 0,
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
    queryFn: () => api.get<Pagina<TomadorOut>>("/nfse/tomadores", { q: buscaCli, por_pagina: 30 }),
    enabled: open && !tomadorId && !contrato,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      contrato
        ? {
            tomador_id: contrato.tomador_id,
            emissora_id: contrato.emissora_id,
            tabela_preco_id: contrato.tabela_preco_id,
            nome: contrato.nome,
            objeto: contrato.objeto,
            data_inicio: contrato.data_inicio,
            data_fim: contrato.data_fim,
            ativo: contrato.ativo,
            observacao: contrato.observacao,
          }
        : { tomador_id: tomadorId ?? 0, emissora_id: null, tabela_preco_id: null, nome: "", objeto: null, data_inicio: new Date().toLocaleDateString("sv-SE"), data_fim: null, ativo: true, observacao: null },
    );
    setBuscaCli("");
  }, [open, contrato, tomadorId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof ContratoIn>(k: K, v: ContratoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body: ContratoIn = { ...f, nome: f.nome.trim(), objeto: nulo(f.objeto), observacao: nulo(f.observacao) };
      return contrato ? api.put<ContratoOut>(`/faturamento/contratos/${contrato.id}`, body) : api.post<ContratoOut>("/faturamento/contratos", body);
    },
    onSuccess: (c) => {
      toast.success(contrato ? "Contrato atualizado" : `Contrato #${c.numero} criado`);
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(c);
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={contrato ? `Editar contrato #${contrato.numero}` : "Novo contrato"}
      descricao="O contrato reúne os casos e as regras de cobrança do cliente."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.tomador_id) return toast.error("Escolha o cliente.");
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Contrato ativo" /> Ativo
        </label>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!tomadorId && !contrato && (
          <Field label="Cliente" obrigatorio htmlFor="contrato-cliente" className="sm:col-span-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
              <Input id="contrato-cliente-busca" aria-label="Buscar cliente" value={buscaCli} onChange={(e) => setBuscaCli(e.target.value)} placeholder="Buscar por nome ou CNPJ" />
              <NativeSelect id="contrato-cliente" value={f.tomador_id || ""} onChange={(e) => set("tomador_id", Number(e.target.value) || 0)}>
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
        <Field label="Nome do contrato" obrigatorio htmlFor="contrato-nome" className="sm:col-span-2">
          <Input id="contrato-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="ex.: Contencioso cível 2026" autoFocus />
        </Field>
        <Field label="Objeto" htmlFor="contrato-objeto" className="sm:col-span-2">
          <Textarea id="contrato-objeto" rows={2} value={f.objeto ?? ""} onChange={(e) => set("objeto", e.target.value)} placeholder="O que o escritório faz por este cliente" />
        </Field>
        <Field label="Empresa emissora" htmlFor="contrato-emissora" dica="Opcional: a padrão é usada se ficar em branco.">
          <NativeSelect id="contrato-emissora" value={f.emissora_id ?? ""} onChange={(e) => set("emissora_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">Padrão</option>
            {emissoras.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {nomeEmissora(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Tabela de preço" htmlFor="contrato-tabela" dica={dicaTabela}>
          <TabelaPrecoSelect id="contrato-tabela" valor={f.tabela_preco_id} onChange={(v) => set("tabela_preco_id", v)} vazio="Nenhuma" />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-sm">
          <Field label="Início" htmlFor="contrato-inicio">
            <Input id="contrato-inicio" type="date" value={f.data_inicio ?? ""} onChange={(e) => set("data_inicio", e.target.value || null)} />
          </Field>
          <Field label="Fim" htmlFor="contrato-fim">
            <Input id="contrato-fim" type="date" value={f.data_fim ?? ""} min={f.data_inicio ?? undefined} onChange={(e) => set("data_fim", e.target.value || null)} />
          </Field>
        </div>
        <Field label="Observação" htmlFor="contrato-obs" className="sm:col-span-2">
          <Textarea id="contrato-obs" rows={2} value={f.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------- caso
export function CasoDialog({
  open,
  onOpenChange,
  contratoId,
  caso,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contratoId: number;
  caso?: CasoOut | null;
  onSalvo?: (c: CasoOut) => void;
}) {
  const qc = useQueryClient();
  const usuarios = useProfissionais(open);
  const [f, setF] = useState<CasoIn>({
    titulo: "",
    descricao: null,
    numero_processo: null,
    parte_contraria: null,
    responsavel_id: null,
    tabela_preco_id: null,
    status: "aberto",
    data_abertura: null,
    data_encerramento: null,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      caso
        ? {
            titulo: caso.titulo,
            descricao: caso.descricao,
            numero_processo: caso.numero_processo,
            parte_contraria: caso.parte_contraria,
            responsavel_id: caso.responsavel_id,
            tabela_preco_id: caso.tabela_preco_id,
            status: caso.status,
            data_abertura: caso.data_abertura,
            data_encerramento: caso.data_encerramento,
          }
        : { titulo: "", descricao: null, numero_processo: null, parte_contraria: null, responsavel_id: null, tabela_preco_id: null, status: "aberto", data_abertura: new Date().toLocaleDateString("sv-SE"), data_encerramento: null },
    );
  }, [open, caso]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof CasoIn>(k: K, v: CasoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body: CasoIn = {
        ...f,
        titulo: f.titulo.trim(),
        descricao: nulo(f.descricao),
        numero_processo: nulo(f.numero_processo),
        parte_contraria: nulo(f.parte_contraria),
        data_encerramento: f.status === "encerrado" ? f.data_encerramento : null,
      };
      return caso ? api.put<CasoOut>(`/faturamento/casos/${caso.id}`, body) : api.post<CasoOut>(`/faturamento/contratos/${contratoId}/casos`, body);
    },
    onSuccess: (c) => {
      toast.success(caso ? "Caso atualizado" : `Caso #${c.numero} criado`);
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(c);
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={caso ? `Editar caso #${caso.numero}` : "Novo caso"}
      descricao="Casos recebem horas e despesas e podem ter regra de cobrança própria."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" obrigatorio htmlFor="caso-titulo" className="sm:col-span-2">
          <Input id="caso-titulo" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="ex.: Ação de cobrança — Cond. Solar" autoFocus />
        </Field>
        <Field label="Nº do processo" htmlFor="caso-processo">
          <Input id="caso-processo" value={f.numero_processo ?? ""} onChange={(e) => set("numero_processo", e.target.value)} className="font-mono" placeholder="0000000-00.0000.0.00.0000" />
        </Field>
        <Field label="Parte contrária" htmlFor="caso-parte">
          <Input id="caso-parte" value={f.parte_contraria ?? ""} onChange={(e) => set("parte_contraria", e.target.value)} />
        </Field>
        <Field label="Responsável" htmlFor="caso-resp">
          <NativeSelect id="caso-resp" value={f.responsavel_id ?? ""} onChange={(e) => set("responsavel_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {usuarios.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
                {u.cargo_nome ? ` · ${u.cargo_nome}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Situação" htmlFor="caso-status">
          <NativeSelect id="caso-status" value={f.status} onChange={(e) => set("status", e.target.value as CasoIn["status"])}>
            <option value="aberto">Aberto</option>
            <option value="encerrado">Encerrado</option>
          </NativeSelect>
        </Field>
        <Field label="Tabela de preço (vazio = a do contrato)" htmlFor="caso-tabela" dica={dicaTabela} className="sm:col-span-2">
          <TabelaPrecoSelect id="caso-tabela" valor={f.tabela_preco_id} onChange={(v) => set("tabela_preco_id", v)} vazio="A do contrato" />
        </Field>
        <Field label="Abertura" htmlFor="caso-abertura">
          <Input id="caso-abertura" type="date" value={f.data_abertura ?? ""} onChange={(e) => set("data_abertura", e.target.value || null)} />
        </Field>
        {f.status === "encerrado" && (
          <Field label="Encerramento" htmlFor="caso-encerramento">
            <Input id="caso-encerramento" type="date" value={f.data_encerramento ?? ""} onChange={(e) => set("data_encerramento", e.target.value || null)} />
          </Field>
        )}
        <Field label="Descrição" htmlFor="caso-desc" className="sm:col-span-2">
          <Textarea id="caso-desc" rows={3} value={f.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}
