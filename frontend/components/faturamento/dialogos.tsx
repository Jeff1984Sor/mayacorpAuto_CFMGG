"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CamposAdicionaisForm,
  camposDaArea,
  useAreas,
  useCampos,
} from "@/components/faturamento/campos-adicionais";
import { PreencherCasoDialog } from "@/components/faturamento/caso-ia";
import {
  ComarcaCombo,
  ehJudicial,
  ROTULO_INSTANCIA,
  TribunalCombo,
  useInstancias,
  VaraCombo,
} from "@/components/faturamento/judiciario";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { IaButton } from "@/components/ia/ia-button";
import { CnjCaso } from "@/components/tribunais/cnj-caso";
import { marcarImportacaoDoCaso } from "@/lib/tribunais";
import {
  type CampoOut,
  type CasoIn,
  type CasoOut,
  type ContratoIn,
  type ContratoOut,
  type Polo,
  type ProfissionalOut,
  ROTULO_POLO,
  ROTULO_TIPO_CASO,
  type TabelaOut,
  type TipoCaso,
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
    queryFn: () =>
      api.get<Pagina<TomadorOut>>("/nfse/tomadores", {
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

  const set = <K extends keyof ContratoIn>(k: K, v: ContratoIn[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () => {
      const body: ContratoIn = {
        ...f,
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
        contrato ? "Contrato atualizado" : `Contrato #${c.numero} criado`,
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
        contrato ? `Editar contrato #${contrato.numero}` : "Novo contrato"
      }
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
          <Switch
            checked={f.ativo}
            onCheckedChange={(v) => set("ativo", v)}
            aria-label="Contrato ativo"
          />{" "}
          Ativo
        </label>
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
        <Field
          label="Empresa emissora"
          htmlFor="contrato-emissora"
          dica="Opcional: a padrão é usada se ficar em branco."
        >
          <NativeSelect
            id="contrato-emissora"
            value={f.emissora_id ?? ""}
            onChange={(e) =>
              set("emissora_id", e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">Padrão</option>
            {emissoras.data?.map((e) => (
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
        <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:max-w-sm">
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
const vazioCaso = (): CasoIn => ({
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
function camposParaForm(
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

function SecaoForm({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-2xl border bg-card p-4">
      <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {titulo}
      </legend>
      <div className="grid gap-4 sm:grid-cols-6">{children}</div>
    </fieldset>
  );
}

export function CasoDialog({
  open,
  onOpenChange,
  contratoId,
  caso,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contratoId?: number;
  caso?: CasoOut | null;
  onSalvo?: (c: CasoOut) => void;
}) {
  const qc = useQueryClient();
  const usuarios = useProfissionais(open);
  const areas = useAreas(open);
  const campos = useCampos(open);
  const instancias = useInstancias(open);
  const escolherContrato = !contratoId && !caso;
  const [contrato, setContrato] = useState<number | null>(null);
  const [cliente, setCliente] = useState<number | null>(null);
  const [ia, setIa] = useState(false);
  const contratos = useQuery({
    queryKey: ["fat", "contratos", "ativos-select"],
    queryFn: () =>
      api.get<ContratoOut[]>("/faturamento/contratos", { ativos: true }),
    enabled: open && escolherContrato,
  });
  // cliente primeiro: a lista sai dos contratos ativos (só faz sentido escolher quem tem contrato)
  const clientes = Array.from(
    new Map(
      (contratos.data ?? [])
        .filter((c) => c.tomador_id != null)
        .map((c) => [c.tomador_id as number, c.tomador_nome] as const),
    ),
  ).sort((x, y) => x[1].localeCompare(y[1], "pt-BR"));
  const contratosDoCliente = (contratos.data ?? []).filter((c) => c.tomador_id === cliente);
  const escolherCliente = (id: number | null) => {
    setCliente(id);
    const doCliente = (contratos.data ?? []).filter((c) => c.tomador_id === id);
    setContrato(doCliente.length === 1 ? doCliente[0].id : null);
  };
  const [f, setF] = useState<CasoIn>(vazioCaso);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    if (!caso) {
      setF(vazioCaso());
      setCliente(null);
      setContrato(null);
      return;
    }
    const base = casoParaIn(caso);
    setF({
      ...base,
      valor_causa: base.valor_causa != null ? paraBr(base.valor_causa) : null,
      campos: camposParaForm(base.campos, campos.data ?? []),
    });
  }, [open, caso, campos.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof CasoIn>(k: K, v: CasoIn[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const extras = camposDaArea(campos.data, f.area_id);
  const salvar = useMutation({
    mutationFn: () => {
      const body: CasoIn = {
        ...f,
        titulo: f.titulo.trim(),
        descricao: nulo(f.descricao),
        numero_processo: nulo(f.numero_processo),
        parte_contraria: nulo(f.parte_contraria),
        tribunal: nulo(f.tribunal),
        vara: nulo(f.vara),
        comarca: nulo(f.comarca),
        valor_causa:
          f.valor_causa && f.valor_causa.trim()
            ? paraDecimalApi(f.valor_causa)
            : null,
        campos: normalizarCampos(f.campos, campos.data ?? []),
        data_encerramento:
          f.status === "encerrado" ? f.data_encerramento : null,
      };
      return caso
        ? api.put<CasoOut>(`/faturamento/casos/${caso.id}`, body)
        : api.post<CasoOut>(
            `/faturamento/contratos/${contratoId ?? contrato}/casos`,
            body,
          );
    },
    onSuccess: (c) => {
      toast.success(caso ? "Caso atualizado" : `Caso #${c.numero} criado`);
      const cnj = (c.numero_processo ?? "").replace(/\D/g, "");
      const antes = (caso?.numero_processo ?? "").replace(/\D/g, "");
      if (cnj.length === 20 && cnj !== antes) {
        marcarImportacaoDoCaso(c.id);
        toast.info("Andamentos e arquivos do processo estão sendo baixados do tribunal", {
          description: "Eles aparecem no caso em alguns instantes.",
        });
      }
      qc.invalidateQueries({ queryKey: ["fat"] });
      onSalvo?.(c);
      onOpenChange(false);
    },
  });
  const vazioExtra = (id: number) => {
    const v = f.campos[String(id)];
    return v === undefined || v === null || v === "";
  };

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        titulo={caso ? `Editar caso #${caso.numero}` : "Novo caso"}
        largura="xl"
        salvando={salvar.isPending}
        acaoCabecalho={
          <IaButton tamanho="sm" onClick={() => setIa(true)}>
            Preencher com IA
          </IaButton>
        }
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (escolherContrato && !cliente)
            return toast.error("Escolha o cliente do caso.");
          if (escolherContrato && !contrato)
            return toast.error("Escolha o contrato do caso.");
          if (f.titulo.trim().length < 2)
            return toast.error("Informe o título do caso.");
          const faltando = extras.find(
            (c) => c.obrigatorio && vazioExtra(c.id),
          );
          if (faltando)
            return toast.error(`Preencha o campo “${faltando.nome}”.`);
          salvar.mutate();
        }}
      >
        <div className="space-y-4">
          <SecaoForm titulo="Identificação">
            {escolherContrato && (
              <>
                <Field label="Cliente" obrigatorio htmlFor="caso-cliente" className="sm:col-span-3">
                  <NativeSelect
                    id="caso-cliente"
                    value={cliente ?? ""}
                    onChange={(e) => escolherCliente(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">{contratos.isLoading ? "Carregando…" : "Escolha o cliente…"}</option>
                    {clientes.map(([id, nome]) => (
                      <option key={id} value={id}>
                        {nome}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Contrato" obrigatorio htmlFor="caso-contrato" className="sm:col-span-3">
                  <NativeSelect
                    id="caso-contrato"
                    value={contrato ?? ""}
                    disabled={!cliente}
                    onChange={(e) => setContrato(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">
                      {!cliente ? "Escolha o cliente primeiro" : contratosDoCliente.length ? "Escolha o contrato…" : "Cliente sem contrato ativo"}
                    </option>
                    {contratosDoCliente.map((c) => (
                      <option key={c.id} value={c.id}>
                        #{c.numero} {c.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            {(!f.tipo || ehJudicial(f.tipo) || !!f.numero_processo) && (
              <CnjCaso
                valor={f.numero_processo}
                onChange={(v) => set("numero_processo", v)}
                contratoId={contratoId ?? contrato ?? caso?.contrato_id}
                form={f}
                onAplicar={(patch) => setF((o) => ({ ...o, ...patch }))}
              />
            )}
            <Field
              label="Título"
              obrigatorio
              htmlFor="caso-titulo"
              className="sm:col-span-4"
            >
              <Input
                id="caso-titulo"
                value={f.titulo}
                onChange={(e) => set("titulo", e.target.value)}
                placeholder="ex.: Ação de cobrança — Cond. Solar"
                autoFocus={!escolherContrato}
              />
            </Field>
            <div
              className="sm:col-span-6"
              role="radiogroup"
              aria-label="Tipo do caso"
            >
              <p className="mb-1.5 text-[13px] text-foreground/80">
                Tipo do caso
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.entries(ROTULO_TIPO_CASO) as [TipoCaso, string][]).map(
                  ([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={f.tipo === k}
                      onClick={() => set("tipo", f.tipo === k ? null : k)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition",
                        f.tipo === k
                          ? "border-brand bg-brand/10 font-medium text-info-ink"
                          : "text-muted-foreground hover:border-brand/40",
                      )}
                    >
                      {l}
                    </button>
                  ),
                )}
              </div>
            </div>
            <Field
              label="Área de atuação"
              htmlFor="caso-area"
              className="sm:col-span-2"
            >
              <NativeSelect
                id="caso-area"
                value={f.area_id ?? ""}
                onChange={(e) =>
                  set("area_id", e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">—</option>
                {areas.data
                  ?.filter((a) => a.ativo || a.id === f.area_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field
              label="Responsável"
              htmlFor="caso-resp"
              className="sm:col-span-2"
            >
              <NativeSelect
                id="caso-resp"
                value={f.responsavel_id ?? ""}
                onChange={(e) =>
                  set(
                    "responsavel_id",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              >
                <option value="">—</option>
                {usuarios.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                    {u.cargo_nome ? ` · ${u.cargo_nome}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Situação"
              htmlFor="caso-status"
              className="sm:col-span-2"
            >
              <NativeSelect
                id="caso-status"
                value={f.status}
                onChange={(e) =>
                  set("status", e.target.value as CasoIn["status"])
                }
              >
                <option value="aberto">Aberto</option>
                <option value="encerrado">Encerrado</option>
              </NativeSelect>
            </Field>
            <Field
              label="Abertura"
              htmlFor="caso-abertura"
              className={
                f.status === "encerrado" ? "sm:col-span-1" : "sm:col-span-2"
              }
            >
              <Input
                id="caso-abertura"
                type="date"
                value={f.data_abertura ?? ""}
                onChange={(e) => set("data_abertura", e.target.value || null)}
              />
            </Field>
            {f.status === "encerrado" && (
              <Field
                label="Encerramento"
                htmlFor="caso-encerramento"
                className="sm:col-span-1"
              >
                <Input
                  id="caso-encerramento"
                  type="date"
                  value={f.data_encerramento ?? ""}
                  onChange={(e) =>
                    set("data_encerramento", e.target.value || null)
                  }
                />
              </Field>
            )}
          </SecaoForm>

          {ehJudicial(f.tipo) ? (
            <SecaoForm titulo="Processo">
              <Field
                label="Instância"
                htmlFor="caso-instancia"
                className="sm:col-span-2"
              >
                <NativeSelect
                  id="caso-instancia"
                  value={f.instancia ?? ""}
                  onChange={(e) => set("instancia", e.target.value || null)}
                >
                  <option value="">—</option>
                  {(
                    instancias.data ??
                    Object.entries(ROTULO_INSTANCIA).map(([valor, rotulo]) => ({
                      valor,
                      rotulo,
                    }))
                  ).map((i) => (
                    <option key={i.valor} value={i.valor}>
                      {i.rotulo}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Tribunal"
                htmlFor="caso-tribunal"
                className="sm:col-span-4"
              >
                <TribunalCombo
                  id="caso-tribunal"
                  value={f.tribunal}
                  tipo={f.tipo}
                  instancia={f.instancia}
                  onChange={(v) =>
                    setF((o) => ({
                      ...o,
                      tribunal: v,
                      comarca: v !== o.tribunal ? null : o.comarca,
                    }))
                  }
                />
              </Field>
              <Field
                label="Comarca"
                htmlFor="caso-comarca"
                className="sm:col-span-3"
              >
                <ComarcaCombo
                  id="caso-comarca"
                  value={f.comarca}
                  tribunal={f.tribunal}
                  onChange={(v) => set("comarca", v)}
                />
              </Field>
              <Field label="Vara" htmlFor="caso-vara" className="sm:col-span-3">
                <VaraCombo
                  id="caso-vara"
                  value={f.vara}
                  tribunal={f.tribunal}
                  comarca={f.comarca}
                  tipo={f.tipo}
                  onChange={(v) => set("vara", v)}
                />
              </Field>
              <Field label="Polo" htmlFor="caso-polo" className="sm:col-span-3">
                <NativeSelect
                  id="caso-polo"
                  value={f.polo ?? ""}
                  onChange={(e) =>
                    set("polo", (e.target.value || null) as Polo | null)
                  }
                >
                  <option value="">—</option>
                  {Object.entries(ROTULO_POLO).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Parte contrária"
                htmlFor="caso-parte"
                className="sm:col-span-6"
              >
                <Input
                  id="caso-parte"
                  value={f.parte_contraria ?? ""}
                  onChange={(e) => set("parte_contraria", e.target.value)}
                />
              </Field>
              <Field
                label="Valor da causa"
                htmlFor="caso-valor"
                className="sm:col-span-3"
              >
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                    R$
                  </span>
                  <Input
                    id="caso-valor"
                    inputMode="decimal"
                    value={f.valor_causa ?? ""}
                    onChange={(e) =>
                      set("valor_causa", e.target.value.replace(/[^\d,.]/g, ""))
                    }
                    className="pl-8 text-right font-mono"
                  />
                </div>
              </Field>
              <Field
                label="Distribuição"
                htmlFor="caso-distrib"
                className="sm:col-span-3"
              >
                <Input
                  id="caso-distrib"
                  type="date"
                  value={f.data_distribuicao ?? ""}
                  onChange={(e) =>
                    set("data_distribuicao", e.target.value || null)
                  }
                />
              </Field>
            </SecaoForm>
          ) : (
            <SecaoForm titulo="Contraparte">
              <Field
                label="Parte contrária"
                htmlFor="caso-parte"
                className="sm:col-span-6"
                dica={
                  f.tipo
                    ? undefined
                    : "Escolha um tipo judicial para ver os campos do processo."
                }
              >
                <Input
                  id="caso-parte"
                  value={f.parte_contraria ?? ""}
                  onChange={(e) => set("parte_contraria", e.target.value)}
                />
              </Field>
            </SecaoForm>
          )}

          <SecaoForm titulo="Cobrança">
            <Field
              label="Tabela de preço (vazio = a do contrato)"
              htmlFor="caso-tabela"
              dica={dicaTabela}
              className="sm:col-span-6"
            >
              <TabelaPrecoSelect
                id="caso-tabela"
                valor={f.tabela_preco_id}
                onChange={(v) => set("tabela_preco_id", v)}
                vazio="A do contrato"
              />
            </Field>
          </SecaoForm>

          {extras.length > 0 && (
            <fieldset className="rounded-2xl border bg-card p-4">
              <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Campos adicionais
              </legend>
              <CamposAdicionaisForm
                idBase="caso-extra"
                campos={extras}
                valores={f.campos}
                onChange={(id, v) =>
                  setF((o) => ({
                    ...o,
                    campos: { ...o.campos, [String(id)]: v },
                  }))
                }
              />
            </fieldset>
          )}

          <Field label="Descrição" htmlFor="caso-desc">
            <Textarea
              id="caso-desc"
              rows={4}
              value={f.descricao ?? ""}
              onChange={(e) => set("descricao", e.target.value)}
            />
          </Field>
        </div>
      </FormDialog>
      <PreencherCasoDialog
        open={ia}
        onOpenChange={setIa}
        atual={{
          ...f,
          valor_causa: f.valor_causa ? paraDecimalApi(f.valor_causa) : null,
          campos: normalizarCampos(f.campos, campos.data ?? []),
        }}
        areas={areas.data ?? []}
        campos={campos.data ?? []}
        onAplicar={(patch) => {
          setF((o) => ({
            ...o,
            ...patch,
            valor_causa:
              patch.valor_causa != null
                ? paraBr(patch.valor_causa)
                : o.valor_causa,
            campos: patch.campos
              ? camposParaForm(
                  { ...o.campos, ...patch.campos },
                  campos.data ?? [],
                )
              : o.campos,
          }));
          setIa(false);
          toast.success("Sugestões aplicadas no formulário. Revise e salve.");
        }}
      />
    </>
  );
}
