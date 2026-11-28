"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { ComarcaCombo, TribunalCombo, VaraCombo } from "@/components/faturamento/judiciario";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PessoaPicker } from "@/components/pessoas/comum";
import { CnjCaso } from "@/components/tribunais/cnj-caso";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import type { AdministrativoDados, CnjLido, ConsultivoDados, ContenciosoDados, ListaItemOut, Opcao } from "@/lib/casos";
import type { CasoIn, Polo, TipoCaso } from "@/lib/faturamento";
import { horasDecimal } from "@/lib/faturamento";
import { UFS } from "@/lib/pessoas";

import { CasoPicker, DinheiroInput, itensDaLista, ListaSelect, Marca, OpcaoSelect, SecaoForm, VariosItens } from "./campos";

type Opcoes = Record<string, Opcao[]> | undefined;
type Setter<T> = <K extends keyof T>(k: K, v: T[K]) => void;

const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Tipo antigo do caso (usado pelos seletores de tribunal e vara) a partir da justiça. */
export function tipoAntigoDaJustica(justica: string | null | undefined): TipoCaso | null {
  if (justica === "estadual") return "judicial_estadual";
  if (justica === "federal") return "judicial_federal";
  if (justica === "trabalho" || justica === "tst") return "judicial_trabalhista";
  return null;
}

export const JUSTICA_DO_TIPO_ANTIGO: Partial<Record<TipoCaso, string>> = {
  judicial_estadual: "estadual",
  judicial_federal: "federal",
  judicial_trabalhista: "trabalho",
};

function UfSelect({ id, valor, onChange }: { id?: string; valor: string | null; onChange: (v: string | null) => void }) {
  return (
    <NativeSelect id={id} value={valor ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {UFS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </NativeSelect>
  );
}

function DataInput({ id, valor, onChange, min }: { id?: string; valor: string | null; onChange: (v: string | null) => void; min?: string | null }) {
  return <Input id={id} type="date" value={valor ?? ""} min={min ?? undefined} onChange={(e) => onChange(e.target.value || null)} />;
}

// ================================================================ contencioso
/**
 * Nº do processo (CNJ), o primeiro campo do contencioso: confere o dígito verificador, preenche justiça, tribunal,
 * UF e órgão, avisa se outro caso já usa o número e (com permissão) busca os dados no tribunal.
 */
export function NumeroProcessoCnj({
  f,
  setF,
  d,
  setD,
  casoId,
  contratoId,
}: {
  f: CasoIn;
  setF: React.Dispatch<React.SetStateAction<CasoIn>>;
  d: ContenciosoDados;
  setD: React.Dispatch<React.SetStateAction<ContenciosoDados>>;
  casoId?: number;
  contratoId: number | null | undefined;
}) {
  const tipoAntigo = tipoAntigoDaJustica(d.justica);

  // Número CNJ: confere o dígito e traz justiça, tribunal, UF e órgão; avisa se outro caso já usa o número.
  const numero = useDebounce(digitos(f.numero_processo), 400);
  const completo = numero.length === 20;
  const cnj = useQuery({
    queryKey: ["fat", "cnj", numero, casoId ?? null],
    queryFn: () => api.get<CnjLido>("/faturamento/casos/cnj", { numero, caso_id: casoId }),
    enabled: completo,
    staleTime: 60_000,
  });
  // o número que já veio com o caso não repreenche nada: só o que for digitado ou colado agora
  const aplicado = useRef<string | null>(null);
  const inicial = useRef(digitos(f.numero_processo));
  const lido = cnj.data;
  // preenche o formulário com o que o número CNJ diz
  useEffect(() => {
    if (!lido?.valido || !completo || aplicado.current === numero) return;
    aplicado.current = numero;
    if (inicial.current === numero) return;
    setD((o) => ({
      ...o,
      justica: lido.justica ?? o.justica,
      uf: lido.uf ?? o.uf,
      codigo_orgao: lido.codigo_orgao ?? o.codigo_orgao,
      pre_ajuizamento: false,
      fase_processual: o.fase_processual === "pre_ajuizamento" ? "conhecimento" : o.fase_processual,
    }));
    if (lido.tribunal) setF((o) => (o.tribunal === lido.tribunal ? o : { ...o, tribunal: lido.tribunal ?? null, comarca: null, vara: null }));
  }, [lido, numero, completo, setD, setF]);

  const avisoCnj =
    completo && lido ? (
      lido.valido ? (
        <div className="space-y-1.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-success/8 px-3 py-2 text-sm text-success-ink">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>
              Número conferido:{" "}
              <strong className="font-medium">
                {[lido.justica_nome, lido.tribunal, lido.uf, lido.codigo_orgao ? `órgão ${lido.codigo_orgao}` : null, lido.ano ? `ano ${lido.ano}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </strong>
            </span>
          </p>
          {lido.duplicado && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm">
              <AlertTriangle className="size-4 shrink-0 text-warning-ink" />
              <span>
                Este número já está no caso{" "}
                <Link href={`/faturamento/casos/${lido.duplicado.caso_id}`} target="_blank" className="font-medium text-info-ink hover:underline">
                  #{lido.duplicado.numero} {lido.duplicado.titulo} <ExternalLink className="inline size-3" />
                </Link>
                . Você pode salvar mesmo assim.
              </span>
            </p>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger-ink">
          <AlertTriangle className="size-4 shrink-0" /> {lido.mensagem}
        </p>
      )
    ) : null;


  return (
    <>
      <CnjCaso
        valor={f.numero_processo}
        onChange={(v) => setF((o) => ({ ...o, numero_processo: v }))}
        contratoId={contratoId}
        form={{ ...f, tipo: tipoAntigo }}
        onAplicar={(patch) => {
          const { tipo, ...resto } = patch;
          setF((o) => ({ ...o, ...resto }));
          const justica = tipo ? JUSTICA_DO_TIPO_ANTIGO[tipo] : undefined;
          if (justica) setD((o) => (o.justica ? o : { ...o, justica }));
        }}
        abaixo={avisoCnj}
      />
      {!digitos(f.numero_processo) && (
        <Marca
          className="sm:col-span-6"
          rotulo="O caso ainda não foi ajuizado"
          dica="Sem número de processo por enquanto. Quando houver, é só preencher acima."
          valor={d.pre_ajuizamento}
          onChange={(v) => setD((o) => ({ ...o, pre_ajuizamento: v, fase_processual: v ? "pre_ajuizamento" : o.fase_processual === "pre_ajuizamento" ? null : o.fase_processual }))}
        />
      )}
    </>
  );
}

export function DadosContencioso({
  f,
  setF,
  d,
  setD,
  opcoes,
  listas,
  casoId,
  mostrarParteContraria,
}: {
  f: CasoIn;
  setF: React.Dispatch<React.SetStateAction<CasoIn>>;
  d: ContenciosoDados;
  setD: React.Dispatch<React.SetStateAction<ContenciosoDados>>;
  opcoes: Opcoes;
  listas: ListaItemOut[] | undefined;
  casoId?: number;
  /** o modelo de título do cliente usa a parte contrária em texto */
  mostrarParteContraria: boolean;
}) {
  const set: Setter<CasoIn> = (k, v) => setF((o) => ({ ...o, [k]: v }));
  const setd: Setter<ContenciosoDados> = (k, v) => setD((o) => ({ ...o, [k]: v }));
  const tipoAntigo = tipoAntigoDaJustica(d.justica);

  return (
    <div className="space-y-4">
      <SecaoForm titulo="Processo">
        <Field label="Justiça" htmlFor="caso-justica" className="sm:col-span-2" dica="Vem do número CNJ.">
          <OpcaoSelect id="caso-justica" opcoes={opcoes?.justica} valor={d.justica} onChange={(v) => setd("justica", v)} />
        </Field>
        <Field label="Instância" htmlFor="caso-instancia" className="sm:col-span-2">
          <OpcaoSelect id="caso-instancia" opcoes={opcoes?.instancia} valor={f.instancia} onChange={(v) => set("instancia", v)} />
        </Field>
        <Field label="Fase processual" htmlFor="caso-fase" className="sm:col-span-2">
          <OpcaoSelect id="caso-fase" opcoes={opcoes?.fase_processual} valor={d.fase_processual} onChange={(v) => setd("fase_processual", v)} />
        </Field>
        <Field label="Tribunal" htmlFor="caso-tribunal" className="sm:col-span-4">
          <TribunalCombo
            id="caso-tribunal"
            value={f.tribunal}
            tipo={tipoAntigo}
            instancia={f.instancia}
            onChange={(v) => setF((o) => ({ ...o, tribunal: v, comarca: v !== o.tribunal ? null : o.comarca }))}
          />
        </Field>
        <Field label="UF" htmlFor="caso-uf" className="sm:col-span-2">
          <UfSelect id="caso-uf" valor={d.uf} onChange={(v) => setd("uf", v)} />
        </Field>
        <Field label="Comarca / seção judiciária" htmlFor="caso-comarca" className="sm:col-span-3">
          <ComarcaCombo id="caso-comarca" value={f.comarca} tribunal={f.tribunal} onChange={(v) => set("comarca", v)} />
        </Field>
        <Field label="Vara / órgão julgador" htmlFor="caso-vara" className="sm:col-span-3">
          <VaraCombo id="caso-vara" value={f.vara} tribunal={f.tribunal} comarca={f.comarca} tipo={tipoAntigo} onChange={(v) => set("vara", v)} />
        </Field>
        <Field label="Código do órgão" htmlFor="caso-orgao" className="sm:col-span-2" dica="Os 4 últimos dígitos do número.">
          <Input id="caso-orgao" value={d.codigo_orgao ?? ""} maxLength={4} className="font-mono" onChange={(e) => setd("codigo_orgao", e.target.value.replace(/\D/g, "") || null)} />
        </Field>
        <Field label="Juiz / relator" htmlFor="caso-juiz" className="sm:col-span-4">
          <Input id="caso-juiz" value={d.juiz_relator ?? ""} onChange={(e) => setd("juiz_relator", e.target.value)} />
        </Field>
        <Field label="Classe processual" htmlFor="caso-classe" className="sm:col-span-3">
          <ListaSelect id="caso-classe" itens={itensDaLista(listas, "classe", [d.classe_id])} valor={d.classe_id} onChange={(v) => setd("classe_id", v)} />
        </Field>
        <Field label="Assunto principal" htmlFor="caso-assunto" className="sm:col-span-3">
          <ListaSelect id="caso-assunto" itens={itensDaLista(listas, "assunto", [d.assunto_id])} valor={d.assunto_id} onChange={(v) => setd("assunto_id", v)} />
        </Field>
        <Field label="Outros assuntos" htmlFor="caso-assuntos" className="sm:col-span-6">
          <VariosItens
            id="caso-assuntos"
            opcoes={itensDaLista(listas, "assunto", d.assuntos_secundarios_ids).filter((i) => i.id !== d.assunto_id)}
            valor={d.assuntos_secundarios_ids}
            onChange={(v) => setd("assuntos_secundarios_ids", v)}
            adicionar="Adicionar assunto…"
          />
        </Field>
        <Field label="Rito" htmlFor="caso-rito" className="sm:col-span-2">
          <OpcaoSelect id="caso-rito" opcoes={opcoes?.rito} valor={d.rito} onChange={(v) => setd("rito", v)} />
        </Field>
        <Field label="Sistema do tribunal" htmlFor="caso-sistema" className="sm:col-span-2">
          <OpcaoSelect id="caso-sistema" opcoes={opcoes?.sistema_tribunal} valor={d.sistema_tribunal} onChange={(v) => setd("sistema_tribunal", v)} />
        </Field>
        <Field label="Número antigo" htmlFor="caso-numero-antigo" className="sm:col-span-2" dica="Numeração anterior ao CNJ.">
          <Input id="caso-numero-antigo" value={d.numero_antigo ?? ""} maxLength={40} className="font-mono" onChange={(e) => setd("numero_antigo", e.target.value)} />
        </Field>
        <Field
          label="Lado do cliente"
          htmlFor="caso-polo"
          className="sm:col-span-3"
          dica={casoId ? "Ao trocar, as partes que são cliente mudam de polo junto." : "O cliente entra nas partes do caso neste polo."}
        >
          <NativeSelect id="caso-polo" value={f.polo && f.polo !== "consultivo" ? f.polo : ""} onChange={(e) => set("polo", (e.target.value || null) as Polo | null)}>
            <option value="">—</option>
            <option value="ativo">Polo ativo (autor)</option>
            <option value="passivo">Polo passivo (réu)</option>
            <option value="terceiro">Terceiro interessado</option>
          </NativeSelect>
        </Field>
        {mostrarParteContraria && (
          <Field label="Parte contrária (texto do título)" htmlFor="caso-parte" className="sm:col-span-3" dica="Usada no título do caso. As partes ficam na aba Partes.">
            <Input id="caso-parte" value={f.parte_contraria ?? ""} onChange={(e) => set("parte_contraria", e.target.value)} />
          </Field>
        )}
      </SecaoForm>

      <SecaoForm titulo="Datas e valores">
        <Field label="Distribuição" htmlFor="caso-distrib" className="sm:col-span-2">
          <DataInput id="caso-distrib" valor={f.data_distribuicao} onChange={(v) => set("data_distribuicao", v)} />
        </Field>
        <Field label="Citação" htmlFor="caso-citacao" className="sm:col-span-2">
          <DataInput id="caso-citacao" valor={d.data_citacao} onChange={(v) => setd("data_citacao", v)} />
        </Field>
        <Field label="Trânsito em julgado" htmlFor="caso-transito" className="sm:col-span-2">
          <DataInput id="caso-transito" valor={d.data_transito_julgado} min={f.data_distribuicao} onChange={(v) => setd("data_transito_julgado", v)} />
        </Field>
        <Field label="Valor da causa" htmlFor="caso-valor" className="sm:col-span-2">
          <DinheiroInput id="caso-valor" valor={f.valor_causa} onChange={(v) => set("valor_causa", v)} />
        </Field>
        <Field label="Valor da condenação" htmlFor="caso-condenacao" className="sm:col-span-2">
          <DinheiroInput id="caso-condenacao" valor={d.valor_condenacao} onChange={(v) => setd("valor_condenacao", v)} />
        </Field>
        <Field label="Valor do acordo" htmlFor="caso-acordo" className="sm:col-span-2">
          <DinheiroInput id="caso-acordo" valor={d.valor_acordo} onChange={(v) => setd("valor_acordo", v)} />
        </Field>
      </SecaoForm>

      <SecaoForm titulo="Risco e resultado">
        <Field label="Prognóstico de perda" htmlFor="caso-prognostico" className="sm:col-span-2">
          <OpcaoSelect id="caso-prognostico" opcoes={opcoes?.prognostico} valor={d.prognostico} onChange={(v) => setd("prognostico", v)} />
        </Field>
        <Field label="Valor provisionado" htmlFor="caso-provisionado" className="sm:col-span-2">
          <DinheiroInput id="caso-provisionado" valor={d.valor_provisionado} onChange={(v) => setd("valor_provisionado", v)} />
        </Field>
        <Field label="Valor em risco" htmlFor="caso-risco" className="sm:col-span-2">
          <DinheiroInput id="caso-risco" valor={d.valor_risco} onChange={(v) => setd("valor_risco", v)} />
        </Field>
        <Field label="Depósito judicial" htmlFor="caso-deposito" className="sm:col-span-2">
          <DinheiroInput id="caso-deposito" valor={d.deposito_judicial} onChange={(v) => setd("deposito_judicial", v)} />
        </Field>
        <Field label="Tutela / liminar" htmlFor="caso-tutela" className="sm:col-span-2">
          <OpcaoSelect id="caso-tutela" opcoes={opcoes?.tutela_liminar} valor={d.tutela_liminar} onChange={(v) => setd("tutela_liminar", v)} />
        </Field>
        <Field label="Resultado" htmlFor="caso-resultado" className="sm:col-span-2">
          <OpcaoSelect id="caso-resultado" opcoes={opcoes?.resultado} valor={d.resultado} onChange={(v) => setd("resultado", v)} />
        </Field>
        <Marca className="sm:col-span-2" rotulo="Justiça gratuita" valor={d.justica_gratuita} onChange={(v) => setd("justica_gratuita", v)} />
        <Marca className="sm:col-span-2" rotulo="Segredo de justiça" valor={d.segredo_justica} onChange={(v) => setd("segredo_justica", v)} />
        <Marca
          className="sm:col-span-2"
          rotulo="Acompanhar andamentos"
          dica="Busca capa e andamentos no tribunal."
          valor={d.monitorar_andamentos}
          onChange={(v) => setd("monitorar_andamentos", v)}
        />
      </SecaoForm>
    </div>
  );
}

// ================================================================ consultivo
export function DadosConsultivo({
  d,
  setD,
  opcoes,
  listas,
  casoId,
  dataAbertura,
}: {
  d: ConsultivoDados;
  setD: React.Dispatch<React.SetStateAction<ConsultivoDados>>;
  opcoes: Opcoes;
  listas: ListaItemOut[] | undefined;
  casoId?: number;
  dataAbertura: string | null;
}) {
  const setd: Setter<ConsultivoDados> = (k, v) => setD((o) => ({ ...o, [k]: v }));
  const entregue = d.etapa === "entregue" || d.etapa === "concluido";
  return (
    <div className="space-y-4">
      <SecaoForm titulo="Demanda">
        <Field label="Tipo de demanda" obrigatorio htmlFor="caso-demanda" className="sm:col-span-3">
          <ListaSelect
            id="caso-demanda"
            itens={itensDaLista(listas, "tipo_demanda", [d.tipo_demanda_id])}
            valor={d.tipo_demanda_id}
            onChange={(v) => setd("tipo_demanda_id", v)}
            vazio="Escolha…"
          />
        </Field>
        <Field label="Etapa" obrigatorio htmlFor="caso-etapa" className="sm:col-span-3">
          <OpcaoSelect id="caso-etapa" semVazio opcoes={opcoes?.etapa} valor={d.etapa} onChange={(v) => setd("etapa", v ?? "recebido")} />
        </Field>
        <Field label="Prioridade" obrigatorio htmlFor="caso-prioridade" className="sm:col-span-2">
          <OpcaoSelect id="caso-prioridade" semVazio opcoes={opcoes?.prioridade} valor={d.prioridade} onChange={(v) => setd("prioridade", v ?? "media")} />
        </Field>
        <Field label="Complexidade" htmlFor="caso-complexidade" className="sm:col-span-2">
          <OpcaoSelect id="caso-complexidade" opcoes={opcoes?.complexidade} valor={d.complexidade} onChange={(v) => setd("complexidade", v)} />
        </Field>
        <Field label="Risco identificado" htmlFor="caso-risco-id" className="sm:col-span-2">
          <OpcaoSelect id="caso-risco-id" opcoes={opcoes?.risco_identificado} valor={d.risco_identificado} onChange={(v) => setd("risco_identificado", v)} />
        </Field>
        <Field label="Quem pediu" htmlFor="caso-solicitante" className="sm:col-span-3" dica="Pessoa do cadastro único (ex.: um funcionário do cliente).">
          <PessoaPicker
            id="caso-solicitante"
            valor={d.solicitante_id}
            nome={d.solicitante_nome}
            onChange={(p) => setD((o) => ({ ...o, solicitante_id: p?.id ?? null, solicitante_nome: p?.nome ?? null }))}
          />
        </Field>
        <Field label="Departamento de quem pediu" htmlFor="caso-departamento" className="sm:col-span-3">
          <Input id="caso-departamento" value={d.departamento_solicitante ?? ""} maxLength={100} placeholder="ex.: Jurídico, RH, Financeiro" onChange={(e) => setd("departamento_solicitante", e.target.value)} />
        </Field>
      </SecaoForm>

      <SecaoForm titulo="Prazos e esforço">
        <Field label="Data do pedido" htmlFor="caso-solicitacao" className="sm:col-span-2" dica={!d.data_solicitacao && dataAbertura ? "Vazio = data de abertura." : undefined}>
          <DataInput id="caso-solicitacao" valor={d.data_solicitacao} onChange={(v) => setd("data_solicitacao", v)} />
        </Field>
        <Field label="Prazo de entrega" htmlFor="caso-prazo" className="sm:col-span-2">
          <DataInput id="caso-prazo" valor={d.prazo_entrega} onChange={(v) => setd("prazo_entrega", v)} />
        </Field>
        <Field label="Data de entrega" obrigatorio={entregue} htmlFor="caso-entrega" className="sm:col-span-2">
          <DataInput id="caso-entrega" valor={d.data_entrega} min={d.data_solicitacao} onChange={(v) => setd("data_entrega", v)} />
        </Field>
        <Field label="Prazo combinado (dias)" htmlFor="caso-sla" className="sm:col-span-2">
          <Input
            id="caso-sla"
            inputMode="numeric"
            value={d.sla_dias ?? ""}
            className="font-mono"
            onChange={(e) => setd("sla_dias", e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null)}
          />
        </Field>
        <Field
          label="Horas estimadas"
          htmlFor="caso-horas"
          className="sm:col-span-2"
          dica={casoId && d.horas_realizadas != null ? `Já lançadas no timesheet: ${horasDecimal(d.horas_realizadas)}` : undefined}
        >
          <DinheiroInput id="caso-horas" prefixo="" valor={d.horas_estimadas} onChange={(v) => setd("horas_estimadas", v)} />
        </Field>
        <Field label="Valor envolvido" htmlFor="caso-envolvido" className="sm:col-span-2">
          <DinheiroInput id="caso-envolvido" valor={d.valor_envolvido} onChange={(v) => setd("valor_envolvido", v)} />
        </Field>
      </SecaoForm>

      <SecaoForm titulo="Contrato analisado (quando a demanda é um contrato)">
        <Field label="Início da vigência" htmlFor="caso-vig-ini" className="sm:col-span-2">
          <DataInput id="caso-vig-ini" valor={d.contrato_vigencia_inicio} onChange={(v) => setd("contrato_vigencia_inicio", v)} />
        </Field>
        <Field label="Fim da vigência" htmlFor="caso-vig-fim" className="sm:col-span-2">
          <DataInput id="caso-vig-fim" valor={d.contrato_vigencia_fim} min={d.contrato_vigencia_inicio} onChange={(v) => setd("contrato_vigencia_fim", v)} />
        </Field>
        <Marca className="sm:col-span-2 sm:self-end" rotulo="Renovação automática" valor={d.renovacao_automatica} onChange={(v) => setd("renovacao_automatica", v)} />
      </SecaoForm>

      <SecaoForm titulo="Conclusão">
        <Field label="Resumo da recomendação" htmlFor="caso-recomendacao" className="sm:col-span-6">
          <Textarea id="caso-recomendacao" rows={3} value={d.recomendacao_resumo ?? ""} onChange={(e) => setd("recomendacao_resumo", e.target.value)} />
        </Field>
        <Field label="Caso judicial que nasceu desta demanda" htmlFor="caso-gerou" className="sm:col-span-6">
          <CasoPicker
            id="caso-gerou"
            valor={d.gerou_contencioso_id}
            rotulo={d.gerou_contencioso_titulo}
            exceto={casoId}
            onChange={(id, rotulo) => setD((o) => ({ ...o, gerou_contencioso_id: id, gerou_contencioso_titulo: rotulo }))}
          />
        </Field>
      </SecaoForm>
    </div>
  );
}

// ================================================================ administrativo
export function DadosAdministrativo({
  d,
  setD,
  opcoes,
  listas,
  casoId,
}: {
  d: AdministrativoDados;
  setD: React.Dispatch<React.SetStateAction<AdministrativoDados>>;
  opcoes: Opcoes;
  listas: ListaItemOut[] | undefined;
  casoId?: number;
}) {
  const setd: Setter<AdministrativoDados> = (k, v) => setD((o) => ({ ...o, [k]: v }));
  const texto = (k: "unidade_orgao" | "municipio" | "numero_processo_adm" | "numero_protocolo" | "numero_auto_infracao" | "numero_nb" | "link_sistema_orgao") => ({
    value: d[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setd(k, e.target.value),
  });
  return (
    <div className="space-y-4">
      <SecaoForm titulo="Órgão e procedimento">
        <Field label="Esfera" obrigatorio htmlFor="caso-esfera" className="sm:col-span-2">
          <OpcaoSelect id="caso-esfera" opcoes={opcoes?.esfera} valor={d.esfera} onChange={(v) => setd("esfera", v)} vazio="Escolha…" />
        </Field>
        <Field label="Órgão" obrigatorio htmlFor="caso-orgao-adm" className="sm:col-span-4">
          <ListaSelect id="caso-orgao-adm" itens={itensDaLista(listas, "orgao", [d.orgao_id])} valor={d.orgao_id} onChange={(v) => setd("orgao_id", v)} vazio="Escolha…" />
        </Field>
        <Field label="Tipo de procedimento" obrigatorio htmlFor="caso-procedimento" className="sm:col-span-6">
          <ListaSelect
            id="caso-procedimento"
            itens={itensDaLista(listas, "tipo_procedimento", [d.tipo_procedimento_id])}
            valor={d.tipo_procedimento_id}
            onChange={(v) => setd("tipo_procedimento_id", v)}
            vazio="Escolha…"
          />
        </Field>
        <Field label="Unidade do órgão" htmlFor="caso-unidade" className="sm:col-span-3" dica="Delegacia, regional, câmara, turma.">
          <Input id="caso-unidade" maxLength={150} {...texto("unidade_orgao")} />
        </Field>
        <Field label="Município" htmlFor="caso-municipio" className="sm:col-span-2">
          <Input id="caso-municipio" maxLength={80} {...texto("municipio")} />
        </Field>
        <Field label="UF" htmlFor="caso-uf-adm" className="sm:col-span-1">
          <UfSelect id="caso-uf-adm" valor={d.uf} onChange={(v) => setd("uf", v)} />
        </Field>
        <Field label="Instância" htmlFor="caso-instancia-adm" className="sm:col-span-3">
          <OpcaoSelect id="caso-instancia-adm" opcoes={opcoes?.instancia_adm} valor={d.instancia_adm} onChange={(v) => setd("instancia_adm", v)} vazio="1ª instância (padrão)" />
        </Field>
        <Field label="Fase" htmlFor="caso-fase-adm" className="sm:col-span-3" dica="Sem número de processo nem protocolo, a fase é pré-protocolo.">
          <OpcaoSelect id="caso-fase-adm" opcoes={opcoes?.fase_adm} valor={d.fase_adm} onChange={(v) => setd("fase_adm", v)} vazio="Automática" />
        </Field>
      </SecaoForm>

      <SecaoForm titulo="Números">
        <Field label="Nº do processo administrativo" htmlFor="caso-numero-adm" className="sm:col-span-3">
          <Input id="caso-numero-adm" maxLength={60} className="font-mono" {...texto("numero_processo_adm")} />
        </Field>
        <Field label="Nº do protocolo" htmlFor="caso-protocolo" className="sm:col-span-3">
          <Input id="caso-protocolo" maxLength={60} className="font-mono" {...texto("numero_protocolo")} />
        </Field>
        <Field label="Nº do auto de infração" htmlFor="caso-auto" className="sm:col-span-3">
          <Input id="caso-auto" maxLength={60} className="font-mono" {...texto("numero_auto_infracao")} />
        </Field>
        <Field label="Nº do benefício (INSS)" htmlFor="caso-nb" className="sm:col-span-3">
          <Input id="caso-nb" maxLength={30} className="font-mono" {...texto("numero_nb")} />
        </Field>
        <Field label="Endereço do sistema do órgão" htmlFor="caso-link" className="sm:col-span-6" dica="e-CAC, Meu INSS, portal da agência. Comece com https://">
          <Input id="caso-link" type="url" maxLength={300} placeholder="https://" {...texto("link_sistema_orgao")} />
        </Field>
      </SecaoForm>

      <SecaoForm titulo="Prazos e valores">
        <Field label="Ciência / notificação" htmlFor="caso-ciencia" className="sm:col-span-2" dica="Base da contagem do prazo.">
          <DataInput id="caso-ciencia" valor={d.data_ciencia} onChange={(v) => setd("data_ciencia", v)} />
        </Field>
        <Field label="Prazo de defesa" htmlFor="caso-prazo-defesa" className="sm:col-span-2">
          <DataInput id="caso-prazo-defesa" valor={d.prazo_defesa} onChange={(v) => setd("prazo_defesa", v)} />
        </Field>
        <Field label="Data do protocolo" htmlFor="caso-data-protocolo" className="sm:col-span-2">
          <DataInput id="caso-data-protocolo" valor={d.data_protocolo} onChange={(v) => setd("data_protocolo", v)} />
        </Field>
        <Field label="Valor autuado" htmlFor="caso-autuado" className="sm:col-span-2">
          <DinheiroInput id="caso-autuado" valor={d.valor_autuado} onChange={(v) => setd("valor_autuado", v)} />
        </Field>
        <Field label="Multa" htmlFor="caso-multa" className="sm:col-span-2">
          <DinheiroInput id="caso-multa" valor={d.valor_multa} onChange={(v) => setd("valor_multa", v)} />
        </Field>
        <Field label="Juros" htmlFor="caso-juros" className="sm:col-span-2">
          <DinheiroInput id="caso-juros" valor={d.valor_juros} onChange={(v) => setd("valor_juros", v)} />
        </Field>
        <Field label="Valor atualizado" htmlFor="caso-atualizado" className="sm:col-span-2">
          <DinheiroInput id="caso-atualizado" valor={d.valor_atualizado} onChange={(v) => setd("valor_atualizado", v)} />
        </Field>
        <Field label="Atualizado em" htmlFor="caso-data-atualizacao" className="sm:col-span-2">
          <DataInput id="caso-data-atualizacao" valor={d.data_atualizacao_valor} onChange={(v) => setd("data_atualizacao_valor", v)} />
        </Field>
        <Field label="Garantia" htmlFor="caso-garantia" className="sm:col-span-2">
          <OpcaoSelect id="caso-garantia" opcoes={opcoes?.garantia} valor={d.garantia} onChange={(v) => setd("garantia", v)} />
        </Field>
        <Marca
          className="sm:col-span-6"
          rotulo="Exigibilidade suspensa"
          dica="A cobrança do valor está suspensa enquanto o processo corre."
          valor={d.exigibilidade_suspensa}
          onChange={(v) => setd("exigibilidade_suspensa", v)}
        />
      </SecaoForm>

      <SecaoForm titulo="Decisão">
        <Field label="Prognóstico de perda" htmlFor="caso-prognostico-adm" className="sm:col-span-2">
          <OpcaoSelect id="caso-prognostico-adm" opcoes={opcoes?.prognostico} valor={d.prognostico} onChange={(v) => setd("prognostico", v)} />
        </Field>
        <Field label="Decisão" htmlFor="caso-decisao" className="sm:col-span-2">
          <OpcaoSelect id="caso-decisao" opcoes={opcoes?.decisao} valor={d.decisao} onChange={(v) => setd("decisao", v)} />
        </Field>
        <Field label="Data da decisão" obrigatorio={!!d.decisao} htmlFor="caso-data-decisao" className="sm:col-span-2">
          <DataInput id="caso-data-decisao" valor={d.data_decisao} onChange={(v) => setd("data_decisao", v)} />
        </Field>
        <Marca
          className="sm:col-span-3"
          rotulo="Cabe levar à Justiça"
          valor={d.cabe_judicializacao}
          onChange={(v) => setD((o) => ({ ...o, cabe_judicializacao: v, prazo_judicializacao: v ? o.prazo_judicializacao : null }))}
        />
        {d.cabe_judicializacao && (
          <Field label="Prazo para entrar na Justiça" htmlFor="caso-prazo-jud" className="sm:col-span-3">
            <DataInput id="caso-prazo-jud" valor={d.prazo_judicializacao} onChange={(v) => setd("prazo_judicializacao", v)} />
          </Field>
        )}
        <Field label="Caso judicial que nasceu deste procedimento" htmlFor="caso-judicial" className="sm:col-span-6">
          <CasoPicker
            id="caso-judicial"
            valor={d.caso_judicial_id}
            rotulo={d.caso_judicial_titulo}
            exceto={casoId}
            onChange={(id, rotulo) => setD((o) => ({ ...o, caso_judicial_id: id, caso_judicial_titulo: rotulo }))}
          />
        </Field>
      </SecaoForm>
    </div>
  );
}
