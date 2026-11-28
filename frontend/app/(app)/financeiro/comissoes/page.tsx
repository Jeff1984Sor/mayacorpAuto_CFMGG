"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgePercent, Banknote, ChevronRight, ChevronsDownUp, ChevronsUpDown, CircleCheck, FilePlus2, FileSpreadsheet, HandCoins, Info, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { isoHoje, mesAtual, useCategoriasFin } from "@/components/financeiro/comum";
import { Periodo, Stat } from "@/components/financeiro/ui";
import { Segmented, TableCard } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type ApuracaoComissoes, type GerarContaComissaoOut, type LinhaComissao, pctFmt, ROTULO_SITUACAO, type SituacaoComissao } from "@/lib/comissoes";
import { data, moeda, moedaCompacta, numero } from "@/lib/format";
import { corSerie } from "@/lib/relatorios";
import { cn } from "@/lib/utils";

type Visao = "profissional" | "cliente" | "area";
const VISOES: { value: Visao; label: string }[] = [
  { value: "profissional", label: "Por profissional" },
  { value: "cliente", label: "Por cliente" },
  { value: "area", label: "Por área do caso" },
];
const NOME_VISAO: Record<Visao, string> = { profissional: "profissional", cliente: "cliente", area: "área do caso" };
const TITULO_VISAO: Record<Visao, string> = { profissional: "Profissional", cliente: "Cliente", area: "Área do caso" };
const MAX_SERIES = 8; // paleta categórica --viz-c1..c8; o resto vira "Outros"

// a situação tem cor própria (a mesma nos gráficos, nas etiquetas e nos indicadores)
const SITUACOES: { k: SituacaoComissao; cor: string; pill: string }[] = [
  { k: "a_pagar", cor: "var(--warning)", pill: "bg-warning/12 text-warning-ink ring-warning/30" },
  { k: "conta_gerada", cor: "var(--viz-c1)", pill: "bg-brand/10 text-info-ink ring-brand/25" },
  { k: "paga", cor: "var(--viz-paga)", pill: "bg-success/10 text-success-ink ring-success/25" },
];
const PILL = Object.fromEntries(SITUACOES.map((s) => [s.k, s.pill])) as Record<SituacaoComissao, string>;

interface Grupo {
  chave: string;
  nome: string;
  linhas: LinhaComissao[];
  base: number;
  comissao: number;
  a_pagar: number;
  conta_gerada: number;
  paga: number;
  recebimentos: number;
  divergencias: number;
}

function agrupar(linhas: LinhaComissao[], visao: Visao): Grupo[] {
  const mapa = new Map<string, Grupo & { bases: Map<string, number>; faturas: Set<number> }>();
  for (const l of linhas) {
    const [chave, nome] =
      visao === "profissional" ? [String(l.usuario_id), l.profissional] : visao === "cliente" ? [String(l.cliente_id ?? 0), l.cliente] : [String(l.area_id ?? 0), l.area ?? "Sem área"];
    let g = mapa.get(chave);
    if (!g) {
      g = { chave, nome, linhas: [], base: 0, comissao: 0, a_pagar: 0, conta_gerada: 0, paga: 0, recebimentos: 0, divergencias: 0, bases: new Map(), faturas: new Set() };
      mapa.set(chave, g);
    }
    g.linhas.push(l);
    g.comissao += l.comissao;
    g[l.situacao] += l.comissao;
    if (l.divergencia) g.divergencias += 1;
    g.bases.set(`${l.fatura_id}:${l.caso_id}`, l.base); // dois profissionais sobre o mesmo recebimento não dobram a base
    g.faturas.add(l.fatura_id);
  }
  return [...mapa.values()]
    .map(({ bases, faturas, ...g }) => ({ ...g, base: [...bases.values()].reduce((a, b) => a + b, 0), recebimentos: faturas.size }))
    .sort((a, b) => b.comissao - a.comissao || a.nome.localeCompare(b.nome));
}

/** Até 8 grupos; os demais somam em "Outros" (sempre por último e em cinza). */
function paraGrafico(grupos: Grupo[]) {
  const topo = grupos.slice(0, MAX_SERIES).map((g) => ({ nome: g.nome, comissao: g.comissao, a_pagar: g.a_pagar, conta_gerada: g.conta_gerada, paga: g.paga }));
  const resto = grupos.slice(MAX_SERIES);
  if (resto.length) {
    const soma = (k: "comissao" | SituacaoComissao) => resto.reduce((a, g) => a + g[k], 0);
    topo.push({ nome: "Outros", comissao: soma("comissao"), a_pagar: soma("a_pagar"), conta_gerada: soma("conta_gerada"), paga: soma("paga") });
  }
  return topo;
}

const curto = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pct = (parte: number, total: number) => (total ? `${((parte / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");

function Graficos({ grupos, visao, total }: { grupos: Grupo[]; visao: Visao; total: number }) {
  const dados = useMemo(() => paraGrafico(grupos), [grupos]);
  const nomes = dados.map((d) => d.nome);
  const fatias = dados.filter((d) => d.comissao > 0);
  const larguraEixo = Math.min(220, Math.max(90, Math.max(...dados.map((d) => curto(d.nome).length)) * 7.2));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard titulo={`Comissão por ${NOME_VISAO[visao]}`} subtitulo="Participação de cada um no total do período">
        <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,200px)_1fr]">
          <div className="relative mx-auto aspect-square w-full max-w-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={fatias} dataKey="comissao" nameKey="nome" innerRadius="62%" outerRadius="100%" paddingAngle={1.5} stroke="var(--card)" strokeWidth={2}>
                  {fatias.map((d) => (
                    <Cell key={d.nome} fill={corSerie(d.nome, nomes)} />
                  ))}
                </Pie>
                <ChartTooltip
                  content={({ active, payload }) => {
                    const d = payload?.[0]?.payload as (typeof dados)[number] | undefined;
                    if (!active || !d) return null;
                    return <TooltipCaixa titulo={d.nome} linhas={[{ cor: corSerie(d.nome, nomes), rotulo: pct(d.comissao, total), valor: moeda(d.comissao) }]} />;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="font-mono text-sm font-semibold">{moedaCompacta(total)}</p>
              </div>
            </div>
          </div>
          <ul className="space-y-0.5 text-sm">
            {fatias.map((d) => (
              <li key={d.nome} className="flex items-center gap-2 rounded-lg px-2 py-1">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: corSerie(d.nome, nomes) }} />
                <span className="min-w-0 flex-1 truncate" title={d.nome}>
                  {d.nome}
                </span>
                <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{pct(d.comissao, total)}</span>
                <span className="w-24 text-right font-mono text-xs tabular-nums">{moeda(d.comissao)}</span>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>

      <ChartCard
        titulo="Em que pé está"
        subtitulo={`A pagar, com conta gerada e já paga, por ${NOME_VISAO[visao]}`}
        legenda={SITUACOES.map((s) => (
          <LegendaItem key={s.k} cor={s.cor} rotulo={ROTULO_SITUACAO[s.k]} />
        ))}
      >
        <div style={{ height: Math.max(170, dados.length * 34 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }} barCategoryGap="24%">
              <CartesianGrid vertical horizontal={false} {...GRADE} />
              <XAxis type="number" {...EIXO} tickFormatter={(v: number) => moedaCompacta(v)} />
              <YAxis
                type="category"
                dataKey="nome"
                {...EIXO}
                width={larguraEixo}
                interval={0}
                tick={({ x, y, payload }: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => (
                  <text x={x} y={y} dy={4} textAnchor="end" fontSize={11} fill="var(--viz-axis)">
                    {curto(String(payload?.value ?? ""))}
                  </text>
                )}
              />
              <ChartTooltip
                cursor={{ fill: "var(--accent)", opacity: 0.45 }}
                content={({ active, payload }) => {
                  const d = payload?.[0]?.payload as (typeof dados)[number] | undefined;
                  if (!active || !d) return null;
                  const linhas = SITUACOES.filter((s) => d[s.k] > 0).map((s) => ({ cor: s.cor, rotulo: ROTULO_SITUACAO[s.k], valor: moeda(d[s.k]) }));
                  return <TooltipCaixa titulo={d.nome} linhas={linhas} rodape={`Total ${moeda(d.comissao)}`} />;
                }}
              />
              {SITUACOES.map((s, i) => (
                <Bar key={s.k} dataKey={s.k} stackId="a" fill={s.cor} maxBarSize={22} radius={i === SITUACOES.length - 1 ? [0, 4, 4, 0] : 0} stroke="var(--card)" strokeWidth={1} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}

function SituacaoPill({ l }: { l: LinhaComissao }) {
  const pill = (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset", PILL[l.situacao])}>
      {ROTULO_SITUACAO[l.situacao]}
    </span>
  );
  if (!l.conta_pagar_id) return pill;
  return (
    <Tooltip>
      <TooltipTrigger render={<Link href={`/financeiro/pagar/${l.conta_pagar_id}`} className="inline-flex hover:opacity-80" />}>{pill}</TooltipTrigger>
      <TooltipContent>
        {l.conta_descricao}
        {l.conta_pagamento ? ` · paga em ${data(l.conta_pagamento)}` : l.conta_vencimento ? ` · vence em ${data(l.conta_vencimento)}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function GerarContaDialog({
  open,
  onOpenChange,
  linhas,
  periodo,
  onGerado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  linhas: LinhaComissao[];
  periodo: { de: string; ate: string };
  onGerado: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const cats = useCategoriasFin("despesa");
  const padrao = cats.data?.find((c) => c.ativo && c.nome.trim().toLowerCase() === "comissões");
  const [vencimento, setVencimento] = useState(isoHoje());
  const [categoria, setCategoria] = useState<number | "padrao">("padrao");
  const [observacao, setObservacao] = useState("");
  const resumo = useMemo(() => agrupar(linhas, "profissional"), [linhas]);
  const total = resumo.reduce((a, g) => a + g.comissao, 0);
  const gerar = useMutation({
    mutationFn: () =>
      api.post<GerarContaComissaoOut>("/financeiro/comissoes/gerar-conta", {
        itens: [...new Map(linhas.map((l) => [l.chave, { fatura_id: l.fatura_id, usuario_id: l.usuario_id }])).values()],
        data_vencimento: vencimento,
        categoria_id: categoria === "padrao" ? (padrao?.id ?? null) : categoria,
        de: periodo.de,
        ate: periodo.ate,
        observacao: observacao.trim() || null,
      }),
    onSuccess: (r) => {
      const n = r.contas.length;
      toast.success(n === 1 ? "Conta a pagar gerada" : `${n} contas a pagar geradas`, {
        description: r.contas.map((c) => `${c.profissional}: ${moeda(c.valor)}`).join(" · "),
        action: { label: "Ver contas", onClick: () => router.push("/financeiro/pagar") },
      });
      qc.invalidateQueries({ queryKey: ["fin"] });
      onGerado();
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Gerar conta a pagar"
      descricao="Confira antes de confirmar: será criada uma conta em Contas a pagar para cada profissional, com a soma das comissões escolhidas."
      rotuloSalvar={resumo.length === 1 ? "Confirmar e gerar 1 conta" : `Confirmar e gerar ${resumo.length} contas`}
      salvando={gerar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (vencimento) gerar.mutate();
      }}
    >
      <div className="space-y-4">
        <ul className="divide-y rounded-xl border bg-muted/30">
          {resumo.map((g) => (
            <li key={g.chave} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-info-ink">
                <HandCoins className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.nome}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {numero(g.recebimentos)} recebimento(s) · sobre {moeda(g.base)}
                </span>
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums">{moeda(g.comissao)}</span>
            </li>
          ))}
          {resumo.length > 1 && (
            <li className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono font-semibold tabular-nums">{moeda(total)}</span>
            </li>
          )}
        </ul>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimento" htmlFor="com-venc" obrigatorio>
            <Input id="com-venc" type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </Field>
          <Field label="Categoria" htmlFor="com-cat" dica={categoria === "padrao" && !padrao ? "A categoria “Comissões” será criada em Despesas." : undefined}>
            <NativeSelect id="com-cat" value={categoria} onChange={(e) => setCategoria(e.target.value === "padrao" ? "padrao" : Number(e.target.value))}>
              <option value="padrao">Comissões{padrao ? "" : " (criar)"}</option>
              {(cats.data ?? [])
                .filter((c) => c.ativo && c.id !== padrao?.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Observação" htmlFor="com-obs" className="sm:col-span-2" dica="Opcional. As faturas de origem já vão na observação da conta.">
            <Input id="com-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
          </Field>
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>O favorecido de cada conta é o próprio profissional. Quando a conta for paga, a comissão aparece aqui como paga; se a conta for excluída, a comissão volta a ficar a pagar.</span>
        </p>
      </div>
    </FormDialog>
  );
}

export default function ComissoesPage() {
  const { pode } = useAuth();
  const podeGerar = pode("comissoes.editar");
  const [periodo, setPeriodo] = useState(mesAtual);
  const [usuarioId, setUsuarioId] = useState<number | null>(null);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [situacao, setSituacao] = useState<"" | SituacaoComissao>("");
  const [visao, setVisao] = useState<Visao>("profissional");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [gerando, setGerando] = useState(false);

  const params = { de: periodo.de, ate: periodo.ate, usuario_id: usuarioId, tomador_id: clienteId, situacao };
  const q = useQuery({
    queryKey: ["fin", "comissoes", params],
    queryFn: () => api.get<ApuracaoComissoes>("/financeiro/comissoes", params),
    placeholderData: (p) => p,
    enabled: !!periodo.de && !!periodo.ate,
  });
  const r = q.data;
  const linhas = useMemo(() => r?.linhas ?? [], [r]);
  const grupos = useMemo(() => agrupar(linhas, visao), [linhas, visao]);
  // só vale a seleção do que ainda está a pagar no resultado atual
  const aPagar = useMemo(() => new Set(linhas.filter((l) => l.situacao === "a_pagar").map((l) => l.chave)), [linhas]);
  const selecionadas = useMemo(() => new Set([...marcadas].filter((k) => aPagar.has(k))), [marcadas, aPagar]);
  const linhasSelecionadas = useMemo(() => linhas.filter((l) => selecionadas.has(l.chave)), [linhas, selecionadas]);
  const valorSelecionado = linhasSelecionadas.reduce((a, l) => a + l.comissao, 0);
  const filtrado = !!usuarioId || !!clienteId || !!situacao;
  const selecionavel = podeGerar && visao === "profissional";
  const colunas = (selecionavel ? 1 : 0) + 7;

  const marcar = (chaves: string[], on: boolean) =>
    setMarcadas((s) => {
      const n = new Set(s);
      chaves.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  const alternar = (k: string) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const chaveAberto = (g: Grupo) => `${visao}:${g.chave}`;
  const tudoAberto = grupos.length > 0 && grupos.every((g) => abertos.has(chaveAberto(g)));
  const limpar = () => {
    setUsuarioId(null);
    setClienteId(null);
    setSituacao("");
  };

  return (
    <div>
      <PageHeader
        titulo="Comissões"
        descricao="O que cada profissional tem a receber sobre os honorários que os clientes pagaram."
        icone={BadgePercent}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Comissões" }]}
        acoes={
          <>
            <Button variant="outline" onClick={() => baixar("/financeiro/comissoes/exportar.xlsx", { query: params }, "comissoes.xlsx")}>
              <FileSpreadsheet /> Exportar Excel
            </Button>
            {podeGerar && (
              <Button disabled={selecionadas.size === 0} onClick={() => setGerando(true)}>
                <FilePlus2 /> Gerar conta a pagar{selecionadas.size > 0 ? ` (${moeda(valorSelecionado)})` : ""}
              </Button>
            )}
          </>
        }
      />

      <div className="card-surface mb-5 flex flex-wrap items-end gap-3 p-4">
        <Periodo idBase="com" de={periodo.de} ate={periodo.ate} onChange={(de, ate) => setPeriodo({ de, ate })} />
        <Field label="Profissional" htmlFor="com-prof" className="w-full sm:w-52">
          <NativeSelect id="com-prof" value={usuarioId ?? ""} onChange={(e) => setUsuarioId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todos</option>
            {r?.opcoes.profissionais.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Cliente" htmlFor="com-cli" className="w-full sm:w-56">
          <NativeSelect id="com-cli" value={clienteId ?? ""} onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todos</option>
            {r?.opcoes.clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-foreground/80">Situação</span>
          <Segmented
            value={situacao}
            onChange={setSituacao}
            opcoes={[
              { value: "", label: "Todas" },
              { value: "a_pagar", label: "A pagar", tom: "warning" },
              { value: "conta_gerada", label: "Conta gerada" },
              { value: "paga", label: "Paga", tom: "success" },
            ]}
          />
        </div>
        {filtrado && (
          <Button variant="ghost" size="sm" className="h-9" onClick={limpar}>
            <X /> Limpar filtros
          </Button>
        )}
      </div>

      <p className="mb-4 flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Vale a data em que o cliente pagou a fatura de honorários (reembolso de despesas não gera comissão). O percentual de cada profissional é definido na ficha dele, em{" "}
          <Link href="/configuracoes/usuarios" className="text-info-ink hover:underline">
            Configurações › Profissionais
          </Link>
          : geral, por cliente, por contrato ou por caso (vale a regra mais específica).
        </span>
      </p>

      {q.isPending ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : !r ? (
        <div className="card-surface">
          <EmptyState icone={BadgePercent} titulo="Não foi possível carregar as comissões" descricao="Confira o período e tente de novo." />
        </div>
      ) : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat rotulo="Base recebida" valor={moeda(r.kpis.base)} icone={Banknote} tom="brand" sub={`${numero(r.kpis.recebimentos)} recebimento(s) com comissão`} />
            <Stat rotulo="Comissão do período" valor={moeda(r.kpis.comissao)} icone={BadgePercent} sub={r.kpis.base ? `${pct(r.kpis.comissao, r.kpis.base)} da base recebida` : undefined} destaque />
            <Stat
              rotulo="A pagar"
              valor={moeda(r.kpis.a_pagar)}
              icone={Wallet}
              tom={r.kpis.a_pagar > 0 ? "warning" : undefined}
              sub={r.kpis.conta_gerada > 0 ? `+ ${moeda(r.kpis.conta_gerada)} com conta gerada, aguardando pagamento` : "Ainda sem conta a pagar gerada"}
            />
            <Stat rotulo="Já paga" valor={moeda(r.kpis.paga)} icone={CircleCheck} tom={r.kpis.paga > 0 ? "success" : undefined} sub={r.kpis.comissao ? `${pct(r.kpis.paga, r.kpis.comissao)} da comissão` : undefined} />
          </div>

          {r.divergencias.length > 0 && (
            <section className="rounded-2xl border border-warning/40 bg-warning/10 p-4" aria-label="Divergências">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-warning-ink">
                <AlertTriangle className="size-4" /> {r.divergencias.length === 1 ? "1 comissão já lançada precisa de atenção" : `${r.divergencias.length} comissões já lançadas precisam de atenção`}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                A conta a pagar foi gerada, mas o recebimento deixou de existir. Nada foi apagado: confira a conta e exclua ou ajuste o valor em Contas a pagar. Estes valores não entram
                nos indicadores acima.
              </p>
              <ul className="mt-3 divide-y divide-warning/20 text-sm">
                {r.divergencias.map((d) => (
                  <li key={d.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="font-mono text-xs">{d.fatura}</span>
                    <span className="font-medium">{d.profissional}</span>
                    <span className="text-muted-foreground">{d.cliente}</span>
                    <span className="font-mono tabular-nums">{moeda(d.comissao)}</span>
                    <span className="min-w-0 flex-1 basis-60 text-xs text-warning-ink">{d.divergencia}</span>
                    {d.conta_pagar_id && (
                      <Button variant="outline" size="xs" render={<Link href={`/financeiro/pagar/${d.conta_pagar_id}`} />}>
                        Abrir a conta{d.situacao === "paga" ? " (paga)" : ""}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {linhas.length === 0 ? (
            <div className="card-surface">
              <EmptyState
                icone={BadgePercent}
                titulo={filtrado ? "Nenhuma comissão com estes filtros" : "Nenhuma comissão neste período"}
                descricao={
                  filtrado
                    ? "Tente outro profissional, cliente ou situação."
                    : "A comissão aparece quando um cliente paga uma fatura de honorários alcançada pela regra de algum profissional."
                }
                acao={
                  filtrado ? (
                    <Button variant="outline" onClick={limpar}>
                      <X /> Limpar filtros
                    </Button>
                  ) : pode("cfg_profissionais.ver") ? (
                    <Button variant="outline" render={<Link href="/configuracoes/usuarios" />}>
                      <BadgePercent /> Cadastrar comissão na ficha do profissional
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Segmented value={visao} onChange={setVisao} opcoes={VISOES} />
                {selecionavel && aPagar.size > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selecionadas.size > 0 ? `${numero(selecionadas.size)} comissão(ões) escolhida(s): ${moeda(valorSelecionado)}` : "Marque as comissões a pagar para gerar a conta."}
                  </p>
                )}
                {podeGerar && !selecionavel && <p className="text-xs text-muted-foreground">Para gerar a conta a pagar, use a visão por profissional.</p>}
              </div>

              <Graficos grupos={grupos} visao={visao} total={r.kpis.comissao} />

              <TableCard>
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {numero(grupos.length)} {grupos.length === 1 ? "grupo" : "grupos"} · {numero(r.kpis.comissoes)} comissão(ões) em {numero(r.kpis.recebimentos)} recebimento(s)
                  </p>
                  <Button variant="ghost" size="xs" onClick={() => setAbertos(tudoAberto ? new Set() : new Set(grupos.map(chaveAberto)))}>
                    {tudoAberto ? <ChevronsDownUp /> : <ChevronsUpDown />} {tudoAberto ? "Recolher tudo" : "Abrir tudo"}
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        {selecionavel && (
                          <th className="w-10 px-4 py-2.5">
                            <Checkbox
                              checked={aPagar.size > 0 && selecionadas.size === aPagar.size}
                              indeterminate={selecionadas.size > 0 && selecionadas.size < aPagar.size}
                              disabled={aPagar.size === 0}
                              onCheckedChange={(v) => marcar([...aPagar], !!v)}
                              aria-label="Selecionar todas as comissões a pagar"
                            />
                          </th>
                        )}
                        <th className="px-3 py-2.5 text-left font-medium">{TITULO_VISAO[visao]}</th>
                        <th className="px-3 py-2.5 text-right font-medium">Recebimentos</th>
                        <th className="px-3 py-2.5 text-right font-medium">Valor recebido</th>
                        <th className="px-3 py-2.5 text-right font-medium">Comissão</th>
                        <th className="px-3 py-2.5 text-right font-medium">A pagar</th>
                        <th className="px-3 py-2.5 text-right font-medium">Conta gerada</th>
                        <th className="px-4 py-2.5 text-right font-medium">Paga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grupos.map((g) => {
                        const aberto = abertos.has(chaveAberto(g));
                        const doGrupo = [...new Set(g.linhas.filter((l) => l.situacao === "a_pagar").map((l) => l.chave))];
                        const marcadasDoGrupo = doGrupo.filter((k) => selecionadas.has(k)).length;
                        return (
                          <Fragment key={g.chave}>
                            <tr className={cn("cursor-pointer border-b transition-colors hover:bg-accent/40", aberto && "bg-brand/[0.04]")} onClick={() => alternar(chaveAberto(g))}>
                              {selecionavel && (
                                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={doGrupo.length > 0 && marcadasDoGrupo === doGrupo.length}
                                    indeterminate={marcadasDoGrupo > 0 && marcadasDoGrupo < doGrupo.length}
                                    disabled={doGrupo.length === 0}
                                    onCheckedChange={(v) => marcar(doGrupo, !!v)}
                                    aria-label={`Selecionar as comissões a pagar de ${g.nome}`}
                                  />
                                </td>
                              )}
                              <td className="px-3 py-3">
                                <span className="flex items-center gap-2 font-medium">
                                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
                                  <span className="truncate" title={g.nome}>
                                    {g.nome}
                                  </span>
                                  {g.divergencias > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger render={<span className="inline-flex text-warning-ink" />}>
                                        <AlertTriangle className="size-3.5" aria-label="Há divergência" />
                                      </TooltipTrigger>
                                      <TooltipContent>Há comissão com valor diferente do que foi para a conta a pagar. Abra para ver.</TooltipContent>
                                    </Tooltip>
                                  )}
                                </span>
                              </td>
                              <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{numero(g.recebimentos)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">{moeda(g.base)}</td>
                              <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums">{moeda(g.comissao)}</td>
                              <Celula v={g.a_pagar} className="text-warning-ink" />
                              <Celula v={g.conta_gerada} className="text-info-ink" />
                              <Celula v={g.paga} className="pr-4 text-success-ink" />
                            </tr>
                            {aberto && (
                              <tr className="border-b bg-muted/20">
                                <td colSpan={colunas} className="p-0">
                                  <Detalhe linhas={g.linhas} visao={visao} selecionavel={selecionavel} selecionadas={selecionadas} marcar={marcar} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 text-sm font-semibold">
                      <tr>
                        {selecionavel && <td />}
                        <td className="px-3 py-2.5">Total</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{numero(r.kpis.recebimentos)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{moeda(r.kpis.base)}</td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums">{moeda(r.kpis.comissao)}</td>
                        <Celula v={r.kpis.a_pagar} />
                        <Celula v={r.kpis.conta_gerada} />
                        <Celula v={r.kpis.paga} className="pr-4" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </TableCard>
            </>
          )}
        </div>
      )}

      {gerando && <GerarContaDialog open onOpenChange={setGerando} linhas={linhasSelecionadas} periodo={periodo} onGerado={() => setMarcadas(new Set())} />}
    </div>
  );
}

function Celula({ v, className }: { v: number; className?: string }) {
  return (
    <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", className)}>{Math.abs(v) < 0.005 ? <span className="text-muted-foreground/50">—</span> : moeda(v)}</td>
  );
}

/** Detalhe do grupo: uma linha por recebimento × profissional × caso, com a regra que aplicou. */
function Detalhe({
  linhas,
  visao,
  selecionavel,
  selecionadas,
  marcar,
}: {
  linhas: LinhaComissao[];
  visao: Visao;
  selecionavel: boolean;
  selecionadas: Set<string>;
  marcar: (chaves: string[], on: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto px-3 py-2 sm:px-4">
      <table className="w-full text-xs">
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            {selecionavel && <th className="w-8 py-1.5" />}
            <th className="px-2 py-1.5 text-left font-medium">Fatura</th>
            {visao !== "profissional" && <th className="px-2 py-1.5 text-left font-medium">Profissional</th>}
            {visao !== "cliente" && <th className="px-2 py-1.5 text-left font-medium">Cliente</th>}
            <th className="px-2 py-1.5 text-left font-medium">Caso</th>
            <th className="px-2 py-1.5 text-left font-medium">Pago em</th>
            <th className="px-2 py-1.5 text-right font-medium">Valor recebido</th>
            <th className="px-2 py-1.5 text-right font-medium">%</th>
            <th className="px-2 py-1.5 text-right font-medium">Comissão</th>
            <th className="px-2 py-1.5 text-left font-medium">Regra aplicada</th>
            <th className="px-2 py-1.5 text-left font-medium">Situação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {linhas.map((l, i) => (
            <tr key={`${l.chave}:${l.caso_id}:${i}`} className={cn(selecionadas.has(l.chave) && "bg-brand/[0.05]")}>
              {selecionavel && (
                <td className="py-2">
                  {l.situacao === "a_pagar" && (
                    <Checkbox checked={selecionadas.has(l.chave)} onCheckedChange={(v) => marcar([l.chave], !!v)} aria-label={`Selecionar a comissão da fatura ${l.fatura}`} />
                  )}
                </td>
              )}
              <td className="px-2 py-2 font-mono whitespace-nowrap">{l.fatura}</td>
              {visao !== "profissional" && <td className="max-w-44 truncate px-2 py-2">{l.profissional}</td>}
              {visao !== "cliente" && (
                <td className="max-w-48 truncate px-2 py-2" title={l.cliente}>
                  {l.cliente}
                </td>
              )}
              <td className="max-w-56 px-2 py-2">
                <span className="block truncate" title={l.caso ?? undefined}>
                  {l.caso ?? <span className="text-muted-foreground">Sem caso</span>}
                </span>
                {visao !== "area" && l.area && <span className="block truncate text-[11px] text-muted-foreground">{l.area}</span>}
              </td>
              <td className="px-2 py-2 font-mono whitespace-nowrap">{data(l.pago_em)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{moeda(l.base)}</td>
              <td className="px-2 py-2 text-right font-mono tabular-nums">{pctFmt(l.percentual)}</td>
              <td className="px-2 py-2 text-right font-mono font-semibold tabular-nums">{moeda(l.comissao)}</td>
              <td className="max-w-56 px-2 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="truncate" title={l.regra ?? undefined}>
                    {l.regra ?? "—"}
                  </span>
                  {l.divergencia && (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex shrink-0 text-warning-ink" />}>
                        <AlertTriangle className="size-3.5" aria-label="Divergência" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{l.divergencia}</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </td>
              <td className="px-2 py-2">
                <SituacaoPill l={l} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
