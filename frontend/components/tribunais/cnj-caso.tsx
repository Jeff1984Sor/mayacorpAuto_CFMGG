"use client";

import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, Info, Landmark, Loader2, RefreshCw, Scale, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useOpcoesCaso } from "@/components/faturamento/caso/campos";
import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { SeloCliente } from "@/components/pessoas/comum";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AdvogadoDaCapa, CapaProcesso, ContenciosoDados, ParteDaCapa } from "@/lib/casos";
import type { CasoIn } from "@/lib/faturamento";
import { paraBr, paraDecimalApi } from "@/lib/financeiro";
import { data, numero } from "@/lib/format";
import { documentoMascarado, exibirOab } from "@/lib/pessoas";
import { mascaraCnj, POLO, rotuloSistema } from "@/lib/tribunais";
import { cn } from "@/lib/utils";

export type { CapaProcesso } from "@/lib/casos";

/** Um campo da ficha que o tribunal informou: onde fica, o valor para gravar e o texto para mostrar. */
interface Proposta {
  alvo: "caso" | "contencioso";
  chave: string;
  rotulo: string;
  valor: unknown;
  texto: string;
}

const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
/** Campo ainda não preenchido: texto em branco, sim/não em "não" e lista sem itens. */
const vazio = (v: unknown) => v === null || v === undefined || v === false || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

function igual(chave: string, atual: unknown, doTribunal: unknown) {
  // lista (outros assuntos): o que o tribunal informa já está entre os escolhidos
  if (Array.isArray(atual) && Array.isArray(doTribunal)) return doTribunal.every((i) => atual.includes(i));
  if (chave === "valor_causa") return Number(paraDecimalApi(String(atual))) === Number(paraDecimalApi(String(doTribunal)));
  return String(atual ?? "").trim().toLowerCase() === String(doTribunal ?? "").trim().toLowerCase();
}

/** Tudo o que o tribunal informou para a ficha (campos do caso e do bloco contencioso). Só o que veio preenchido. */
function propostasDaCapa(c: CapaProcesso, rotuloDe: (campo: string, valor: string) => string): Proposta[] {
  const out: Proposta[] = [];
  const por = (alvo: Proposta["alvo"], chave: string, rotulo: string, valor: unknown, texto?: string | null) => {
    if (!vazio(valor)) out.push({ alvo, chave, rotulo, valor, texto: texto || String(valor) });
  };
  por("caso", "titulo", "título", c.titulo);
  por("contencioso", "justica", "justiça", c.justica, c.justica_nome);
  por("caso", "tribunal", "tribunal", c.tribunal);
  por("contencioso", "uf", "UF", c.uf);
  por("caso", "instancia", "instância", c.instancia, c.instancia && rotuloDe("instancia", c.instancia));
  por("caso", "vara", "vara", c.vara);
  por("caso", "comarca", "comarca", c.comarca);
  por("contencioso", "codigo_orgao", "código do órgão", c.codigo_orgao);
  por("contencioso", "sistema_tribunal", "sistema do tribunal", c.sistema_tribunal, c.sistema_tribunal && rotuloDe("sistema_tribunal", c.sistema_tribunal));
  por("contencioso", "juiz_relator", "juiz / relator", c.juiz_relator);
  por("contencioso", "fase_processual", "fase processual", c.fase_processual, c.fase_processual && rotuloDe("fase_processual", c.fase_processual));
  por("caso", "data_distribuicao", "distribuição", c.data_distribuicao, c.data_distribuicao && data(c.data_distribuicao));
  por("caso", "valor_causa", "valor da causa", c.valor_causa != null ? paraBr(c.valor_causa) : null, c.valor_causa != null ? `R$ ${paraBr(c.valor_causa)}` : null);
  // sim/não: só o "sim" do tribunal preenche (igual ao servidor na importação)
  por("contencioso", "segredo_justica", "segredo de justiça", c.segredo_justica === true, "sim");
  por("contencioso", "justica_gratuita", "justiça gratuita", c.justica_gratuita === true, "sim");
  por("caso", "polo", "lado do cliente", c.polo, c.polo && POLO[c.polo]);
  por("caso", "parte_contraria", "parte contrária", c.parte_contraria);
  // classe e assuntos: só os que já existem nas listas do escritório (os outros entram ao importar o processo)
  por("contencioso", "classe_id", "classe processual", c.classe_detalhe?.item_id, c.classe_detalhe?.nome);
  const assuntos = c.assuntos_detalhe ?? [];
  const principal = assuntos.find((a) => a.principal) ?? assuntos[0];
  por("contencioso", "assunto_id", "assunto principal", principal?.item_id, principal?.nome);
  const outros = assuntos.filter((a) => a !== principal && a.item_id && a.item_id !== principal?.item_id);
  por("contencioso", "assuntos_secundarios_ids", "outros assuntos", [...new Set(outros.map((a) => a.item_id as number))], outros.map((a) => a.nome).join(", "));
  return out;
}

const FONTE_PARTES: Record<string, string> = {
  djen: "Partes informadas pelo diário de justiça (DJEN): ele traz o nome e o polo, sem CPF/CNPJ, e uma lista única de advogados, sem dizer quem cada um representa.",
  processo_importado: "Partes do processo que o escritório já acompanha, como o tribunal informou.",
};

function SeloCadastro() {
  return (
    <span
      title="Esta pessoa já está no cadastro do escritório: a parte usa o mesmo cadastro"
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-brand/10 px-1.5 text-[11px] font-semibold whitespace-nowrap text-info-ink ring-1 ring-brand/25 ring-inset"
    >
      <BadgeCheck className="size-3" /> Já no cadastro
    </span>
  );
}

function LinhaAdvogado({ a }: { a: AdvogadoDaCapa }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <Scale className="size-3 shrink-0 text-muted-foreground" />
      <span className="break-words">{a.nome}</span>
      <span className="font-mono text-muted-foreground">{exibirOab(a.oab_numero, a.oab_uf) ?? "sem OAB informada"}</span>
    </li>
  );
}

function ParteCapa({ p }: { p: ParteDaCapa }) {
  const doc = documentoMascarado({ cpf_cnpj: p.documento, documento_formatado: p.documento_parcial });
  return (
    <li className={cn("rounded-lg px-2 py-1.5", p.cliente_do_caso ? "bg-success/8 ring-1 ring-success/30 ring-inset" : "bg-background/60")}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-medium break-words">{p.nome}</span>
        {p.cliente_do_caso && <Pill tom="success">Cliente deste caso</Pill>}
        {p.cliente_id ? <SeloCliente clienteId={p.cliente_id} /> : p.pessoa_id ? <SeloCadastro /> : null}
      </p>
      {(p.tipo_participacao || doc) && (
        <p className="text-muted-foreground">
          {p.tipo_participacao}
          {p.tipo_participacao && doc ? " · " : ""}
          {doc && <span className="font-mono">{doc}</span>}
        </p>
      )}
      {p.advogados.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {p.advogados.map((a) => (
            <LinhaAdvogado key={`${a.nome}-${a.oab_numero}-${a.oab_uf}`} a={a} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Nº do processo (CNJ) da ficha do caso: com 20 dígitos consulta o tribunal (GET /tribunais/capa) e preenche
 * os campos vazios do caso e do bloco contencioso, sem sobrescrever o que já foi digitado. Campo já preenchido com
 * outro valor aparece como diferença, para o usuário decidir se usa o do tribunal.
 */
export function CnjCaso({
  valor,
  onChange,
  contratoId,
  form,
  onAplicar,
  contencioso,
  onAplicarContencioso,
  casoNovo,
  abaixo,
}: {
  valor: string | null;
  onChange: (v: string) => void;
  contratoId: number | null | undefined;
  form: CasoIn;
  onAplicar: (patch: Partial<CasoIn>) => void;
  contencioso: ContenciosoDados;
  onAplicarContencioso: (patch: Partial<ContenciosoDados>) => void;
  /** caso ainda não salvo: ao salvar, a importação traz as partes */
  casoNovo?: boolean;
  /** aviso logo abaixo do número (ex.: o que o número CNJ diz e o caso que já usa o mesmo número) */
  abaixo?: React.ReactNode;
}) {
  const { pode } = useAuth();
  const podeBuscar = pode("casos.editar");
  const opcoes = useOpcoesCaso(podeBuscar).data?.opcoes;
  const [capa, setCapa] = useState<CapaProcesso | null>(null);
  const [conflitos, setConflitos] = useState<Proposta[]>([]);
  const [preenchidos, setPreenchidos] = useState<string[]>([]);
  const [digitou, setDigitou] = useState(false);
  const atualRef = useRef({ form, contencioso, opcoes });
  useEffect(() => {
    atualRef.current = { form, contencioso, opcoes };
  }, [form, contencioso, opcoes]);
  const ultimoRef = useRef<string | null>(null);

  const aplicar = (itens: Proposta[]) => {
    const doAlvo = (alvo: Proposta["alvo"]) => Object.fromEntries(itens.filter((p) => p.alvo === alvo).map((p) => [p.chave, p.valor]));
    if (itens.some((p) => p.alvo === "caso")) onAplicar(doAlvo("caso") as Partial<CasoIn>);
    if (itens.some((p) => p.alvo === "contencioso")) onAplicarContencioso(doAlvo("contencioso") as Partial<ContenciosoDados>);
  };

  const consultar = useMutation({
    mutationFn: (num: string) => api.get<CapaProcesso>("/tribunais/capa", { numero: num, contrato_id: contratoId ?? undefined }),
    onSuccess: (c) => {
      const { form: f, contencioso: d, opcoes: op } = atualRef.current;
      const rotuloDe = (campo: string, v: string) => op?.[campo]?.find((o) => o.valor === v)?.rotulo ?? (campo === "sistema_tribunal" ? rotuloSistema(v) : null) ?? v;
      const vazios: Proposta[] = [];
      const diferentes: Proposta[] = [];
      for (const p of propostasDaCapa(c, rotuloDe)) {
        const atual = (p.alvo === "caso" ? (f as unknown as Record<string, unknown>) : (d as unknown as Record<string, unknown>))[p.chave];
        if (vazio(atual)) vazios.push(p);
        else if (!igual(p.chave, atual, p.valor)) diferentes.push(p);
      }
      aplicar(vazios);
      setCapa(c);
      setPreenchidos(vazios.map((p) => p.rotulo));
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
    aplicar(conflitos);
    setPreenchidos((o) => [...o, ...conflitos.map((p) => p.rotulo)]);
    setConflitos([]);
  };
  const mostrarCapa = capa && capa.numero_cnj === digitos(valor);
  const polos = mostrarCapa ? [...new Set(capa.partes.map((p) => p.polo))] : [];
  // classe e assuntos que ainda não existem nas listas do escritório
  const foraDaLista = mostrarCapa ? [capa.classe_detalhe, ...(capa.assuntos_detalhe ?? [])].filter((i) => i && !i.item_id).map((i) => i!.nome) : [];
  const fatos = mostrarCapa
    ? [
        capa.juiz_relator ? `Juiz / relator: ${capa.juiz_relator}` : null,
        capa.valor_causa != null ? `Valor da causa: R$ ${paraBr(capa.valor_causa)}` : null,
        capa.segredo_justica ? "Segredo de justiça" : null,
        capa.justica_gratuita ? "Justiça gratuita" : null,
      ].filter(Boolean)
    : [];

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

      {abaixo}

      {consultar.isPending && (
        <p className="flex items-center gap-2 rounded-lg bg-brand/8 px-3 py-2 text-sm text-info-ink">
          <Loader2 className="size-4 animate-spin" /> Consultando o tribunal…
        </p>
      )}

      {mostrarCapa && !consultar.isPending && (
        <div className="rounded-xl border bg-muted/25 p-3 text-sm" data-capa-tribunal>
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
              {fatos.length > 0 && <p className="mt-1 text-xs break-words">{fatos.join(" · ")}</p>}
              {foraDaLista.length > 0 && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {foraDaLista.map((n) => `“${n}”`).join(", ")} ainda {foraDaLista.length > 1 ? "não estão nas listas" : "não está na lista"} do escritório:{" "}
                    {foraDaLista.length > 1 ? "entram" : "entra"} na lista ao salvar e importar o processo.
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="mt-2 border-t pt-2 text-xs">
            {polos.length > 0 ? (
              <>
                <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                  {polos.map((polo) => (
                    <div key={polo} className="min-w-0">
                      <dt className="mb-1 text-muted-foreground">{POLO[polo] ?? polo}</dt>
                      <dd>
                        <ul className="space-y-1">
                          {capa.partes
                            .filter((p) => p.polo === polo)
                            .map((p, i) => (
                              <ParteCapa key={`${p.nome}-${i}`} p={p} />
                            ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
                {capa.advogados.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-muted-foreground">Advogados do processo (o diário não diz quem cada um representa)</p>
                    <ul className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                      {capa.advogados.map((a) => (
                        <LinhaAdvogado key={`${a.nome}-${a.oab_numero}-${a.oab_uf}`} a={a} />
                      ))}
                    </ul>
                  </div>
                )}
                {capa.fonte_partes && FONTE_PARTES[capa.fonte_partes] && <p className="mt-2 text-muted-foreground">{FONTE_PARTES[capa.fonte_partes]}</p>}
                {casoNovo && <p className="mt-1 text-muted-foreground">As partes entram no caso sozinhas depois de salvar.</p>}
              </>
            ) : (
              <p className="text-muted-foreground">
                O tribunal não informou as partes deste processo: as fontes públicas nem sempre trazem. Com o certificado digital do advogado elas vêm completas.
              </p>
            )}
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
          {preenchidos.length > 0 && (
            <p className="mt-2 flex items-start gap-1.5 border-t pt-2 text-xs text-success-ink">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              <span>Preenchido com os dados do tribunal: {preenchidos.join(", ")}.</span>
            </p>
          )}
          {conflitos.length > 0 && (
            <div className="mt-2 border-t pt-2 text-xs">
              <p className="text-warning-ink">
                {conflitos.length > 1 ? "Estes campos já estavam preenchidos e o tribunal informa outro valor:" : "Este campo já estava preenchido e o tribunal informa outro valor:"}
              </p>
              <ul className="mt-1 space-y-0.5">
                {conflitos.map((p) => (
                  <li key={`${p.alvo}-${p.chave}`} className="break-words">
                    <span className="text-muted-foreground">{p.rotulo}:</span> <span className="font-medium">{p.texto}</span>
                  </li>
                ))}
              </ul>
              <Button type="button" size="xs" variant="outline" className="mt-2" onClick={usarTribunal}>
                <RefreshCw /> Usar dados do tribunal
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
