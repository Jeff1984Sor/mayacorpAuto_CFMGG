"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileText, Landmark, Loader2, type LucideIcon, Plus, Repeat, Scale, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CamposAdicionaisForm, camposDaArea, useAreas, useCampos } from "@/components/faturamento/campos-adicionais";
import { PreencherCasoDialog } from "@/components/faturamento/caso-ia";
import { type ClienteEscolhido, ClientesMulti } from "@/components/faturamento/clientes-multi";
import { camposParaForm, casoParaIn, normalizarCampos, TabelaPrecoSelect, useProfissionais, vazioCaso } from "@/components/faturamento/dialogos";
import { renderTitulo, useModeloCaso } from "@/components/faturamento/titulo-caso";
import { IaButton } from "@/components/ia/ia-button";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  type AdministrativoDados,
  administrativoVazio,
  CAMPOS_DECIMAIS,
  type ConsultivoDados,
  consultivoVazio,
  type ContenciosoDados,
  contenciosoVazio,
  ROTULO_STATUS_CASO,
  ROTULO_TIPO_DE_CASO,
  type TipoDeCaso,
  TIPOS_DE_CASO,
  type TipoVinculo,
} from "@/lib/casos";
import { garantirContratoDoCliente, useUsaContrato } from "@/lib/contrato";
import { type CasoIn, type CasoOut, type ContratoOut, ROTULO_TIPO_CASO } from "@/lib/faturamento";
import { paraBr, paraDecimalApi } from "@/lib/financeiro";
import { marcarImportacaoDoCaso } from "@/lib/tribunais";
import { cn } from "@/lib/utils";

import { CasoPicker, DinheiroInput, itensDaLista, ListaSelect, Marca, OpcaoSelect, SecaoForm, useListas, useOpcoesCaso, VariosItens } from "./campos";
import { DadosAdministrativo, DadosConsultivo, DadosContencioso, JUSTICA_DO_TIPO_ANTIGO, NumeroProcessoCnj, tipoAntigoDaJustica } from "./dados-tipo";
import { PartesCaso } from "./partes";

const nulo = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** Os três tipos de caso: o tipo decide os campos do formulário e os blocos de partes. */
export const TIPOS_CASO_INFO: Record<TipoDeCaso, { icone: LucideIcon; descricao: string; aba: string; exemplos: string }> = {
  contencioso: {
    icone: Scale,
    descricao: "Processo na Justiça, já ajuizado ou a ajuizar.",
    aba: "Dados do processo",
    exemplos: "Número CNJ, tribunal, vara, fase e polos.",
  },
  consultivo: {
    icone: FileText,
    descricao: "Parecer, contrato, due diligence e outras demandas sem processo.",
    aba: "Dados da demanda",
    exemplos: "Tipo de demanda, prazo de entrega, etapa e quem pediu.",
  },
  administrativo: {
    icone: Landmark,
    descricao: "Procedimento em órgão público: Receita, INSS, PROCON, agências.",
    aba: "Dados do procedimento",
    exemplos: "Órgão, tipo de procedimento, prazos de defesa e valores.",
  },
};

type Bloco = ContenciosoDados | ConsultivoDados | AdministrativoDados;

/** Bloco vindo da API (ponto decimal) pronto para editar (vírgula). */
function blocoParaForm<T extends Bloco>(bloco: T, campos: readonly string[]): T {
  const out = { ...bloco } as Record<string, unknown>;
  for (const k of campos) out[k] = out[k] != null && out[k] !== "" ? paraBr(out[k] as string) : null;
  return out as T;
}

/** Bloco do formulário para a API: valores com ponto, textos vazios viram nulo. */
function blocoParaApi<T extends Bloco>(bloco: T, campos: readonly string[]): T {
  const out = { ...bloco } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (typeof v === "string") out[k] = v.trim() || null;
  for (const k of campos) out[k] = out[k] ? paraDecimalApi(out[k] as string) : null;
  return out as T;
}

type Aba = "geral" | "tipo" | "partes" | "extras";

/**
 * Novo caso em 2 passos (tipo → dados em abas) e edição do caso (direto nas abas).
 * Com "Trabalhar com contratos" desligado, pede só o cliente e usa o contrato único dele.
 */
export function CasoDialog({
  open,
  onOpenChange,
  contratoId,
  caso,
  onSalvo,
  abaInicial = "geral",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contratoId?: number;
  caso?: CasoOut | null;
  onSalvo?: (c: CasoOut) => void;
  abaInicial?: Aba;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { administrador, pode } = useAuth();
  const usuarios = useProfissionais(open);
  const areas = useAreas(open);
  const campos = useCampos(open);
  const opcoes = useOpcoesCaso(open);
  const listas = useListas(open);
  const usaContrato = useUsaContrato();
  const escolherContrato = !contratoId && !caso;
  const [tipoCaso, setTipoCaso] = useState<TipoDeCaso | null>(null);
  const [aba, setAba] = useState<Aba>("geral");
  const [contrato, setContrato] = useState<number | null>(null);
  const [clienteSel, setClienteSel] = useState<ClienteEscolhido[]>([]);
  const cliente = clienteSel[0]?.id ?? null;
  const [novoContrato, setNovoContrato] = useState("");
  const [ia, setIa] = useState(false);
  const [trocar, setTrocar] = useState<TipoDeCaso | null>(null);
  const contratos = useQuery({
    queryKey: ["fat", "contratos", "ativos-select"],
    queryFn: () => api.get<ContratoOut[]>("/faturamento/contratos", { ativos: true }),
    enabled: open && escolherContrato,
  });
  // cliente primeiro (todos os clientes, com busca); cliente sem contrato ganha um ali mesmo
  const contratosDoCliente = (contratos.data ?? []).filter((c) => c.tomador_id === cliente);
  const escolherCliente = (v: ClienteEscolhido[]) => {
    setClienteSel(v);
    const doCliente = (contratos.data ?? []).filter((c) => c.tomador_id === v[0]?.id);
    setContrato(doCliente.length === 1 ? doCliente[0].id : null);
    setNovoContrato("");
  };
  const criarContrato = useMutation({
    mutationFn: () => api.post<ContratoOut>("/faturamento/contratos", { tomador_id: cliente, nome: novoContrato.trim() || "Contencioso" }),
    onSuccess: async (c) => {
      toast.success(`Contrato #${c.numero} ${c.nome} criado`);
      await qc.invalidateQueries({ queryKey: ["fat", "contratos"] });
      setContrato(c.id);
    },
  });
  const [f, setF] = useState<CasoIn>(vazioCaso);
  const [paiRotulo, setPaiRotulo] = useState<string | null>(null);
  const [cont, setCont] = useState<ContenciosoDados>(contenciosoVazio);
  const [cons, setCons] = useState<ConsultivoDados>(consultivoVazio);
  const [adm, setAdm] = useState<AdministrativoDados>(administrativoVazio);
  /** depois de salvar um caso novo: abrir a ficha na aba Partes */
  const irParaPartes = useRef(false);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setAba(abaInicial);
    setTrocar(null);
    irParaPartes.current = false;
    if (!caso) {
      setF({ ...vazioCaso(), equipe_ids: [], etiqueta_ids: [], motivo_encerramento_id: null, origem_id: null, centro_custo_id: null, valor_estimado: null, caso_pai_id: null, tipo_vinculo: null, sigiloso: false, observacoes: null });
      setTipoCaso(null);
      setClienteSel([]);
      setContrato(null);
      setPaiRotulo(null);
      setCont(contenciosoVazio());
      setCons(consultivoVazio());
      setAdm(administrativoVazio());
      return;
    }
    const base = casoParaIn(caso);
    setF({
      ...base,
      valor_causa: base.valor_causa != null ? paraBr(base.valor_causa) : null,
      campos: camposParaForm(base.campos, campos.data ?? []),
      equipe_ids: caso.equipe_ids ?? [],
      etiqueta_ids: caso.etiqueta_ids ?? [],
      motivo_encerramento_id: caso.motivo_encerramento_id ?? null,
      origem_id: caso.origem_id ?? null,
      centro_custo_id: caso.centro_custo_id ?? null,
      valor_estimado: caso.valor_estimado != null ? paraBr(caso.valor_estimado) : null,
      caso_pai_id: caso.caso_pai_id ?? null,
      tipo_vinculo: caso.tipo_vinculo ?? null,
      sigiloso: !!caso.sigiloso,
      observacoes: caso.observacoes ?? null,
    });
    setTipoCaso(caso.tipo_caso);
    setPaiRotulo(caso.caso_pai_titulo);
    setCont(blocoParaForm({ ...contenciosoVazio(), ...(caso.contencioso ?? {}) }, CAMPOS_DECIMAIS.contencioso));
    setCons(blocoParaForm({ ...consultivoVazio(), ...(caso.consultivo ?? {}) }, CAMPOS_DECIMAIS.consultivo));
    setAdm(blocoParaForm({ ...administrativoVazio(), ...(caso.administrativo ?? {}) }, CAMPOS_DECIMAIS.administrativo));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a aba inicial só vale na abertura
  }, [open, caso, campos.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof CasoIn>(k: K, v: CasoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  // cliente do caso: do caso aberto, da escolha no formulário ou do contrato recebido
  const contratoFixo = useQuery({
    queryKey: ["fat", "contrato", contratoId],
    queryFn: () => api.get<ContratoOut>(`/faturamento/contratos/${contratoId}`),
    enabled: open && !!contratoId && !caso,
  });
  const tomadorId = caso?.tomador_id ?? cliente ?? contratoFixo.data?.tomador_id ?? null;
  const modelo = useModeloCaso(open ? tomadorId : null);
  const modeloTitulo = modelo.data?.modelo_titulo_caso?.trim() || "";
  const extras = camposDaArea(campos.data, f.area_id, tomadorId);
  const contratoNome = caso?.contrato_nome ?? contratoFixo.data?.nome ?? (contratos.data ?? []).find((c) => c.id === contrato)?.nome ?? "";
  const contencioso = tipoCaso === "contencioso";
  /** tipo antigo (judicial estadual, federal, trabalhista...): só para a prévia do título e para a IA */
  const tipoAntigo = contencioso ? tipoAntigoDaJustica(cont.justica) : tipoCaso;
  const tituloGerado = modeloTitulo
    ? renderTitulo(
        modeloTitulo,
        {
          numero: caso ? `#${caso.numero}` : "",
          processo: f.numero_processo,
          parte_contraria: f.parte_contraria,
          tipo: tipoAntigo ? ROTULO_TIPO_CASO[tipoAntigo] : tipoCaso ? ROTULO_TIPO_DE_CASO[tipoCaso] : "",
          area: areas.data?.find((a) => a.id === f.area_id)?.nome,
          tribunal: f.tribunal,
          vara: f.vara,
          comarca: f.comarca,
          valor_causa: f.valor_causa ? `R$ ${f.valor_causa}` : "",
          data_distribuicao: f.data_distribuicao ? f.data_distribuicao.split("-").reverse().join("/") : "",
          cliente: caso?.tomador_nome ?? contratoFixo.data?.tomador_nome ?? clienteSel[0]?.nome,
          contrato: contratoNome,
        },
        extras,
        f.campos,
      )
    : "";
  const salvar = useMutation({
    mutationFn: () => {
      const tipo = tipoCaso as TipoDeCaso;
      const body: CasoIn = {
        ...f,
        titulo: tituloGerado || f.titulo.trim(),
        descricao: nulo(f.descricao),
        numero_processo: nulo(f.numero_processo),
        parte_contraria: nulo(f.parte_contraria),
        tipo: tipoAntigo,
        tribunal: nulo(f.tribunal),
        vara: nulo(f.vara),
        comarca: nulo(f.comarca),
        valor_causa: f.valor_causa && f.valor_causa.trim() ? paraDecimalApi(f.valor_causa) : null,
        campos: normalizarCampos(f.campos, campos.data ?? []),
        data_encerramento: f.status === "encerrado" ? f.data_encerramento : null,
        tipo_caso: tipo,
        equipe_ids: (f.equipe_ids ?? []).filter((i) => i !== f.responsavel_id),
        motivo_encerramento_id: f.status === "encerrado" ? (f.motivo_encerramento_id ?? null) : null,
        valor_estimado: f.valor_estimado && f.valor_estimado.trim() ? paraDecimalApi(f.valor_estimado) : null,
        tipo_vinculo: f.caso_pai_id ? (f.tipo_vinculo ?? null) : null,
        observacoes: nulo(f.observacoes),
        // só o bloco do tipo do caso vai no pedido
        ...(tipo === "contencioso" ? { contencioso: blocoParaApi(cont, CAMPOS_DECIMAIS.contencioso) } : {}),
        ...(tipo === "consultivo" ? { consultivo: blocoParaApi(cons, CAMPOS_DECIMAIS.consultivo) } : {}),
        ...(tipo === "administrativo" ? { administrativo: blocoParaApi(adm, CAMPOS_DECIMAIS.administrativo) } : {}),
      };
      if (caso) return api.put<CasoOut>(`/faturamento/casos/${caso.id}`, body);
      const criar = (id: number) => api.post<CasoOut>(`/faturamento/contratos/${id}/casos`, body);
      // sem a figura do contrato: o caso entra no contrato único do cliente (criado por trás na primeira vez)
      if (!contratoId && !usaContrato && cliente) return garantirContratoDoCliente(cliente).then((k) => criar(k.id));
      return criar((contratoId ?? contrato) as number);
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
      onOpenChange(false);
      if (!caso && irParaPartes.current) router.push(`/faturamento/casos/${c.id}?aba=partes`);
      else onSalvo?.(c);
    },
    onError: () => {
      irParaPartes.current = false;
    },
  });
  const vazioExtra = (id: number) => {
    const v = f.campos[String(id)];
    return v === undefined || v === null || v === "";
  };
  /** Confere o que falta e leva para a aba do campo. */
  const validar = (): [Aba, string] | null => {
    if (escolherContrato && !cliente) return ["geral", "Escolha o cliente do caso."];
    if (escolherContrato && usaContrato && !contrato) return ["geral", "Escolha o contrato do caso."];
    if (!tituloGerado && f.titulo.trim().length < 2) return ["geral", modeloTitulo ? "Preencha os campos do título ou digite um título." : "Informe o título do caso."];
    if (f.status === "encerrado" && !f.data_encerramento) return ["geral", "Informe a data de encerramento do caso."];
    if (tipoCaso === "contencioso") {
      const n = (f.numero_processo ?? "").replace(/\D/g, "");
      if (!n && !cont.pre_ajuizamento) return ["geral", "Informe o número do processo (CNJ) ou marque que o caso ainda não foi ajuizado."];
      if (n && n.length !== 20) return ["geral", "O número CNJ tem 20 dígitos. Numeração anterior ao CNJ vai em “Número antigo”, na aba Dados do processo."];
    }
    if (tipoCaso === "consultivo") {
      if (!cons.tipo_demanda_id) return ["tipo", "Escolha o tipo de demanda."];
      if ((cons.etapa === "entregue" || cons.etapa === "concluido") && !cons.data_entrega) return ["tipo", "Informe a data de entrega: a demanda está entregue ou concluída."];
    }
    if (tipoCaso === "administrativo") {
      if (!adm.esfera) return ["tipo", "Escolha a esfera (federal, estadual, municipal ou distrital)."];
      if (!adm.orgao_id) return ["tipo", "Escolha o órgão."];
      if (!adm.tipo_procedimento_id) return ["tipo", "Escolha o tipo de procedimento."];
      if (adm.decisao && !adm.data_decisao) return ["tipo", "Informe a data da decisão."];
      if (adm.link_sistema_orgao?.trim() && !/^https?:\/\//i.test(adm.link_sistema_orgao.trim())) return ["tipo", "O endereço do sistema do órgão precisa começar com https://"];
    }
    const faltando = extras.find((c) => c.obrigatorio && vazioExtra(c.id));
    if (faltando) return ["extras", `Preencha o campo “${faltando.nome}”.`];
    return null;
  };
  const enviar = (paraPartes = false) => {
    const erro = validar();
    if (erro) {
      setAba(erro[0]);
      return toast.error(erro[1]);
    }
    irParaPartes.current = paraPartes;
    salvar.mutate();
  };

  const info = tipoCaso ? TIPOS_CASO_INFO[tipoCaso] : null;
  const trocouTipo = !!caso && !!tipoCaso && tipoCaso !== caso.tipo_caso;
  const status = opcoes.data?.opcoes.status ?? Object.entries(ROTULO_STATUS_CASO).map(([valor, rotulo]) => ({ valor, rotulo }));
  const equipeOpcoes = (usuarios.data ?? []).filter((u) => u.id !== f.responsavel_id && (u.ativo || (f.equipe_ids ?? []).includes(u.id))).map((u) => ({ id: u.id, nome: u.nome }));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("max-h-[92dvh] gap-0 overflow-hidden p-0", tipoCaso ? "sm:max-w-4xl" : "sm:max-w-3xl")}>
          {!tipoCaso ? (
            // ---------------------------------------------------------------- passo 1: tipo de caso
            <div className="flex max-h-[92dvh] flex-col">
              <DialogHeader className="border-b p-5">
                <DialogTitle className="text-lg">Novo caso</DialogTitle>
                <DialogDescription>Passo 1 de 2 · Que tipo de caso é este? O tipo define os campos do formulário e os blocos de partes.</DialogDescription>
              </DialogHeader>
              <div className="grid flex-1 gap-3 overflow-y-auto p-5 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de caso">
                {TIPOS_DE_CASO.map((t, i) => {
                  const I = TIPOS_CASO_INFO[t].icone;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={false}
                      autoFocus={i === 0}
                      onClick={() => {
                        setTipoCaso(t);
                        setAba("geral");
                      }}
                      className="group flex flex-col items-start gap-3 rounded-2xl border bg-card p-5 text-left transition outline-none hover:-translate-y-0.5 hover:border-brand hover:shadow-md focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="grid size-12 place-items-center rounded-xl bg-brand/10 text-navy ring-1 ring-brand/25 transition group-hover:bg-brand/20 dark:text-brand">
                        <I className="size-6" />
                      </span>
                      <span>
                        <span className="block text-base font-semibold">{ROTULO_TIPO_DE_CASO[t]}</span>
                        <span className="mt-1 block text-sm text-muted-foreground">{TIPOS_CASO_INFO[t].descricao}</span>
                      </span>
                      <span className="mt-auto flex w-full items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                        <span>{TIPOS_CASO_INFO[t].exemplos}</span>
                        <ArrowRight className="size-4 shrink-0 text-info-ink opacity-0 transition group-hover:opacity-100" />
                      </span>
                    </button>
                  );
                })}
              </div>
              <DialogFooter className="m-0 items-center rounded-none p-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // ---------------------------------------------------------------- passo 2: dados em abas
            <form
              className="flex max-h-[92dvh] flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                enviar();
              }}
            >
              <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)} className="min-h-0 flex-1 gap-0">
              <DialogHeader className="border-b p-5 pb-0">
                <div className="flex flex-col gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
                      {caso ? `Editar caso #${caso.numero}` : "Novo caso"}
                      <Pill tom="brand">{ROTULO_TIPO_DE_CASO[tipoCaso]}</Pill>
                    </DialogTitle>
                    <DialogDescription>
                      {caso ? (
                        trocouTipo ? (
                          <span className="text-warning-ink">O tipo muda de {ROTULO_TIPO_DE_CASO[caso.tipo_caso]} para {ROTULO_TIPO_DE_CASO[tipoCaso]} ao salvar.</span>
                        ) : (
                          info?.descricao
                        )
                      ) : (
                        <>Passo 2 de 2 · {info?.descricao}</>
                      )}
                    </DialogDescription>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!caso && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setTipoCaso(null)}>
                        <ArrowLeft /> Trocar tipo
                      </Button>
                    )}
                    {caso && administrador && (
                      <DropdownTrocarTipo atual={tipoCaso} onEscolher={setTrocar} />
                    )}
                    <IaButton tamanho="sm" onClick={() => setIa(true)}>
                      Preencher com IA
                    </IaButton>
                  </div>
                </div>
                <div className="-mx-1 mt-3 overflow-x-auto px-1 pb-3">
                    <TabsList>
                      <TabsTrigger value="geral" className="px-3">Geral</TabsTrigger>
                      <TabsTrigger value="tipo" className="px-3">{info?.aba}</TabsTrigger>
                      <TabsTrigger value="partes" className="px-3">Partes</TabsTrigger>
                      {extras.length > 0 && <TabsTrigger value="extras" className="px-3">Campos adicionais</TabsTrigger>}
                    </TabsList>
                </div>
              </DialogHeader>
              <div className="min-h-[50dvh] flex-1 overflow-y-auto p-5">
                  {/* ------------------------------------------------ Geral (fica montada: o cartão do tribunal e as
                      diferenças para escolher continuam lá quando o usuário volta de outra aba) */}
                  <TabsContent value="geral" keepMounted className="space-y-4">
                    {contencioso && (
                      <SecaoForm titulo="Número do processo">
                        <NumeroProcessoCnj f={f} setF={setF} d={cont} setD={setCont} casoId={caso?.id} contratoId={contratoId ?? contrato ?? caso?.contrato_id} />
                      </SecaoForm>
                    )}
                    <SecaoForm titulo="Identificação">
                      {escolherContrato && (
                        <>
                          <Field label="Cliente" obrigatorio htmlFor="caso-cliente" className={usaContrato ? "sm:col-span-3" : "sm:col-span-6"}>
                            <ClientesMulti unico id="caso-cliente" valor={clienteSel} onChange={escolherCliente} />
                          </Field>
                          {usaContrato && (
                            <Field label="Contrato" obrigatorio htmlFor="caso-contrato" className="sm:col-span-3">
                              <NativeSelect id="caso-contrato" value={contrato ?? ""} disabled={!cliente} onChange={(e) => setContrato(e.target.value ? Number(e.target.value) : null)}>
                                <option value="">{!cliente ? "Escolha o cliente primeiro" : contratosDoCliente.length ? "Escolha o contrato…" : "Cliente sem contrato ativo"}</option>
                                {contratosDoCliente.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    #{c.numero} {c.nome}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                          )}
                          {usaContrato && cliente && !contratos.isLoading && contratosDoCliente.length === 0 && !contrato && (
                            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 sm:col-span-6">
                              <p className="w-full text-sm">
                                <strong>{clienteSel[0]?.nome}</strong> ainda não tem contrato. Crie um agora para cadastrar o caso.
                              </p>
                              <Input
                                value={novoContrato}
                                onChange={(e) => setNovoContrato(e.target.value)}
                                placeholder="Nome do contrato (ex.: Contencioso)"
                                className="max-w-xs bg-background"
                                aria-label="Nome do novo contrato"
                              />
                              <Button type="button" onClick={() => criarContrato.mutate()} disabled={criarContrato.isPending}>
                                {criarContrato.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Criar contrato
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      <Field
                        label="Título"
                        obrigatorio={!modeloTitulo}
                        htmlFor="caso-titulo"
                        className="sm:col-span-6"
                        dica={
                          modeloTitulo
                            ? "Montado pelo modelo do cliente (Cadastros › Clientes › aba Casos)."
                            : contencioso
                              ? "Depois de incluir as partes, a aba Partes sugere “Autor x Réu”."
                              : undefined
                        }
                      >
                        {modeloTitulo ? (
                          <div id="caso-titulo" className="flex min-h-9 items-center rounded-md border bg-muted/40 px-3 py-1.5 text-sm" aria-live="polite">
                            {tituloGerado || <span className="text-muted-foreground">Preencha os campos do modelo: {modeloTitulo}</span>}
                          </div>
                        ) : (
                          <Input id="caso-titulo" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="ex.: Ação de cobrança — Cond. Solar" />
                        )}
                      </Field>
                      <Field label="Área de atuação" htmlFor="caso-area" className="sm:col-span-2">
                        <NativeSelect id="caso-area" value={f.area_id ?? ""} onChange={(e) => set("area_id", e.target.value ? Number(e.target.value) : null)}>
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
                      <Field label="Responsável" htmlFor="caso-resp" className="sm:col-span-2">
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
                      <Field label="Situação" htmlFor="caso-status" className="sm:col-span-2">
                        <NativeSelect id="caso-status" value={f.status} onChange={(e) => set("status", e.target.value as CasoIn["status"])}>
                          {status.map((s) => (
                            <option key={s.valor} value={s.valor}>
                              {s.rotulo}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                      <Field label="Abertura" htmlFor="caso-abertura" className="sm:col-span-2">
                        <Input id="caso-abertura" type="date" value={f.data_abertura ?? ""} onChange={(e) => set("data_abertura", e.target.value || null)} />
                      </Field>
                      {f.status === "encerrado" && (
                        <>
                          <Field label="Encerramento" obrigatorio htmlFor="caso-encerramento" className="sm:col-span-2">
                            <Input
                              id="caso-encerramento"
                              type="date"
                              value={f.data_encerramento ?? ""}
                              min={f.data_abertura ?? undefined}
                              onChange={(e) => set("data_encerramento", e.target.value || null)}
                            />
                          </Field>
                          <Field label="Motivo do encerramento" htmlFor="caso-motivo" className="sm:col-span-2">
                            <ListaSelect
                              id="caso-motivo"
                              itens={itensDaLista(listas.data, "motivo_encerramento", [f.motivo_encerramento_id])}
                              valor={f.motivo_encerramento_id ?? null}
                              onChange={(v) => set("motivo_encerramento_id", v)}
                            />
                          </Field>
                        </>
                      )}
                      <Field label="Equipe" htmlFor="caso-equipe" className="sm:col-span-6" dica="Os demais profissionais do caso, além do responsável.">
                        <VariosItens id="caso-equipe" opcoes={equipeOpcoes} valor={(f.equipe_ids ?? []).filter((i) => i !== f.responsavel_id)} onChange={(v) => set("equipe_ids", v)} adicionar="Adicionar profissional…" />
                      </Field>
                    </SecaoForm>

                    <SecaoForm titulo="Organização">
                      <Field label="Origem da captação" htmlFor="caso-origem" className="sm:col-span-2">
                        <ListaSelect id="caso-origem" itens={itensDaLista(listas.data, "origem", [f.origem_id])} valor={f.origem_id ?? null} onChange={(v) => set("origem_id", v)} />
                      </Field>
                      <Field label="Centro de custo" htmlFor="caso-centro" className="sm:col-span-2">
                        <ListaSelect id="caso-centro" itens={itensDaLista(listas.data, "centro_custo", [f.centro_custo_id])} valor={f.centro_custo_id ?? null} onChange={(v) => set("centro_custo_id", v)} />
                      </Field>
                      <Field label="Valor estimado" htmlFor="caso-estimado" className="sm:col-span-2" dica="Valor econômico envolvido.">
                        <DinheiroInput id="caso-estimado" valor={f.valor_estimado} onChange={(v) => set("valor_estimado", v)} />
                      </Field>
                      <Field label="Etiquetas" htmlFor="caso-etiquetas" className="sm:col-span-6">
                        <VariosItens
                          id="caso-etiquetas"
                          opcoes={itensDaLista(listas.data, "etiqueta", f.etiqueta_ids ?? [])}
                          valor={f.etiqueta_ids ?? []}
                          onChange={(v) => set("etiqueta_ids", v)}
                          adicionar="Adicionar etiqueta…"
                        />
                      </Field>
                      <Field label="Vinculado a outro caso" htmlFor="caso-pai" className={f.caso_pai_id ? "sm:col-span-4" : "sm:col-span-6"} dica="Recurso, incidente, apenso ou desdobramento de outro caso.">
                        <CasoPicker
                          id="caso-pai"
                          valor={f.caso_pai_id ?? null}
                          rotulo={paiRotulo}
                          exceto={caso?.id}
                          onChange={(id, rotulo) => {
                            setPaiRotulo(rotulo);
                            setF((o) => ({ ...o, caso_pai_id: id, tipo_vinculo: id ? o.tipo_vinculo : null }));
                          }}
                        />
                      </Field>
                      {f.caso_pai_id && (
                        <Field label="Tipo de vínculo" htmlFor="caso-vinculo" className="sm:col-span-2">
                          <OpcaoSelect id="caso-vinculo" opcoes={opcoes.data?.opcoes.tipo_vinculo} valor={f.tipo_vinculo ?? null} onChange={(v) => set("tipo_vinculo", v as TipoVinculo | null)} />
                        </Field>
                      )}
                      <Marca
                        className="sm:col-span-6"
                        rotulo="Caso sigiloso"
                        dica="Só o responsável, a equipe do caso e o administrador conseguem abrir."
                        valor={!!f.sigiloso}
                        onChange={(v) => set("sigiloso", v)}
                      />
                    </SecaoForm>

                    <SecaoForm titulo="Cobrança">
                      <Field
                        label={usaContrato ? "Tabela de preço (vazio = a do contrato)" : "Tabela de preço (vazio = a do cliente)"}
                        htmlFor="caso-tabela"
                        dica="Define o valor/hora de cada cargo nas regras por hora."
                        className="sm:col-span-6"
                      >
                        <TabelaPrecoSelect id="caso-tabela" valor={f.tabela_preco_id} onChange={(v) => set("tabela_preco_id", v)} vazio={usaContrato ? "A do contrato" : "A do cliente"} />
                      </Field>
                    </SecaoForm>

                    <Field label="Descrição" htmlFor="caso-desc">
                      <Textarea id="caso-desc" rows={3} value={f.descricao ?? ""} onChange={(e) => set("descricao", e.target.value)} placeholder="Resumo do caso" />
                    </Field>
                    <Field label="Observações internas" htmlFor="caso-obs">
                      <Textarea id="caso-obs" rows={2} value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} />
                    </Field>
                  </TabsContent>

                  {/* ------------------------------------------------ dados do tipo */}
                  <TabsContent value="tipo">
                    {tipoCaso === "contencioso" && (
                      <DadosContencioso
                        f={f}
                        setF={setF}
                        d={cont}
                        setD={setCont}
                        opcoes={opcoes.data?.opcoes}
                        listas={listas.data}
                        casoId={caso?.id}
                        mostrarParteContraria={/parte/i.test(modeloTitulo) || (!!caso && !!caso.parte_contraria)}
                      />
                    )}
                    {tipoCaso === "consultivo" && <DadosConsultivo d={cons} setD={setCons} opcoes={opcoes.data?.opcoes} listas={listas.data} casoId={caso?.id} dataAbertura={f.data_abertura} />}
                    {tipoCaso === "administrativo" && <DadosAdministrativo d={adm} setD={setAdm} opcoes={opcoes.data?.opcoes} listas={listas.data} casoId={caso?.id} />}
                  </TabsContent>

                  {/* ------------------------------------------------ Partes */}
                  <TabsContent value="partes">
                    {caso && !trocouTipo ? (
                      <PartesCaso caso={caso} podeEditar={pode("casos.editar")} onTituloUsado={(t) => set("titulo", t)} />
                    ) : (
                      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 text-center">
                        <span className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-brand/10 text-navy ring-1 ring-brand/25 dark:text-brand">
                          <UsersRound className="size-6" />
                        </span>
                        {caso ? (
                          <>
                            <h3 className="text-base font-semibold">Salve a troca de tipo primeiro</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              As partes vão para os blocos de {ROTULO_TIPO_DE_CASO[tipoCaso]} do mesmo lado e ficam marcadas para revisão. Depois de salvar, confira na aba Partes do caso.
                            </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-base font-semibold">As partes entram depois de salvar o caso</h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              O cliente já entra sozinho como parte{contencioso ? " (no lado que você escolher em Dados do processo)" : ""}. As demais pessoas e os advogados são incluídos na ficha do caso, e nada do que
                              você preencheu aqui se perde.
                            </p>
                            <Button type="button" className="mt-4" disabled={salvar.isPending} onClick={() => enviar(true)}>
                              {salvar.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />} Salvar e incluir as partes
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </TabsContent>

                  {/* ------------------------------------------------ Campos adicionais */}
                  {extras.length > 0 && (
                    <TabsContent value="extras">
                      <fieldset className="rounded-2xl border bg-card p-4">
                        <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Campos adicionais</legend>
                        <CamposAdicionaisForm idBase="caso-extra" campos={extras} valores={f.campos} onChange={(id, v) => setF((o) => ({ ...o, campos: { ...o.campos, [String(id)]: v } }))} />
                      </fieldset>
                    </TabsContent>
                  )}
              </div>
              </Tabs>
              <DialogFooter className="m-0 items-center rounded-none p-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvar.isPending} className="px-4">
                  {salvar.isPending && <Loader2 className="animate-spin" />}
                  Salvar
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!trocar}
        onOpenChange={(o) => !o && setTrocar(null)}
        titulo={trocar ? `Trocar o tipo para ${ROTULO_TIPO_DE_CASO[trocar]}?` : ""}
        descricao={
          <>
            Os dados de {caso ? ROTULO_TIPO_DE_CASO[caso.tipo_caso].toLowerCase() : ""} ficam guardados (nada é apagado) e o formulário passa a mostrar os campos do tipo novo. As partes vão para os blocos do mesmo lado no tipo
            novo, sem qualificação, marcadas para revisão. A troca só acontece quando você salvar o caso e fica registrada no histórico.
          </>
        }
        confirmar="Trocar tipo"
        onConfirm={() => {
          setTipoCaso(trocar);
          setAba("tipo");
          setTrocar(null);
        }}
      />
      <PreencherCasoDialog
        open={ia}
        onOpenChange={setIa}
        atual={{
          ...f,
          tipo: tipoAntigo,
          valor_causa: f.valor_causa ? paraDecimalApi(f.valor_causa) : null,
          campos: normalizarCampos(f.campos, campos.data ?? []),
        }}
        areas={areas.data ?? []}
        campos={campos.data ?? []}
        onAplicar={(patch) => {
          // o tipo do caso já foi escolhido: da sugestão de tipo só se aproveita a justiça
          const { tipo, ...resto } = patch;
          const justica = tipo ? JUSTICA_DO_TIPO_ANTIGO[tipo] : undefined;
          if (justica && contencioso) setCont((o) => (o.justica ? o : { ...o, justica }));
          setF((o) => ({
            ...o,
            ...resto,
            valor_causa: resto.valor_causa != null ? paraBr(resto.valor_causa) : o.valor_causa,
            campos: resto.campos ? camposParaForm({ ...o.campos, ...resto.campos }, campos.data ?? []) : o.campos,
          }));
          setIa(false);
          toast.success("Sugestões aplicadas no formulário. Revise e salve.");
        }}
      />
    </>
  );
}

function DropdownTrocarTipo({ atual, onEscolher }: { atual: TipoDeCaso; onEscolher: (t: TipoDeCaso) => void }) {
  return (
    <div className="relative">
      <NativeSelect
        aria-label="Trocar o tipo do caso (só administrador)"
        value=""
        onChange={(e) => e.target.value && onEscolher(e.target.value as TipoDeCaso)}
        className="h-7 w-auto rounded-md pl-7 text-[0.8rem]"
      >
        <option value="">Trocar tipo</option>
        {TIPOS_DE_CASO.filter((t) => t !== atual).map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_DE_CASO[t]}
          </option>
        ))}
      </NativeSelect>
      <Repeat className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
