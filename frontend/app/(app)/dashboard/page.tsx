"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Check, Eraser, FileUp, LayoutDashboard, Link2, ListChecks, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Aging, EmitidoRecebido, Previsao, Rejeicoes, SituacaoRosca, TopClientes } from "@/components/dashboard/graficos";
import { HeatmapClienteMes, type Matriz } from "@/components/dashboard/heatmap";
import { KpiTile } from "@/components/dashboard/kpi";
import { Slicer, type OpcaoSlicer } from "@/components/dashboard/slicer";
import { TabelaNotas } from "@/components/dashboard/tabela";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardEstado } from "@/hooks/use-dashboard-estado";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  atalho,
  bucketPrevisao,
  type Ctx,
  type DashboardOut,
  type Dimensao,
  emitidasNoPeriodo,
  FAIXAS,
  lotesFiltrados,
  type Medidas,
  medidas,
  mesDe,
  mesesEntre,
  fimDoMes,
  nomeMes,
  type Nota,
  passa,
  periodoAnterior,
  preparar,
  prazos,
  ROTULO_DIM,
  ROTULO_SITUACAO,
  type Situacao,
  somaDias,
  tendencia,
  valorDim,
  variacao,
} from "@/lib/dashboard";
import { data, moeda, moedaCompacta, numero } from "@/lib/format";
import { cn } from "@/lib/utils";

const SLICERS: Dimensao[] = ["cliente", "tipo", "origem", "contrato", "nfse", "situacao", "mes", "atraso", "emissora", "servico", "lote"];
const ATALHOS = [
  { k: "mes", l: "Este mês" },
  { k: "tri", l: "Trimestre" },
  { k: "ano", l: "Ano" },
  { k: "12m", l: "12 meses" },
  { k: "tudo", l: "Tudo" },
] as const;
const ORDEM_SIT: Situacao[] = ["aberta", "vencida", "paga", "cancelada"];

const soma = (v: number[]) => v.reduce((a, b) => a + b, 0);
const curto = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function rotuloValor(d: Dimensao, v: string) {
  if (d === "situacao") return ROTULO_SITUACAO[v as Situacao] ?? v;
  if (d === "mes") return nomeMes(v);
  if (d === "previsao") return v === "atrasada" ? "Previsão já passou" : v.length === 7 ? nomeMes(v) : `semana de ${data(v).slice(0, 5)}`;
  return v;
}

function Carregando() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-16 w-96" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { isOperador } = useAuth();
  const q = useQuery({
    queryKey: ["dashboard-faturamento"],
    queryFn: () => api.get<DashboardOut>("/dashboard/faturamento"),
    staleTime: 60_000,
  });
  const d = q.data;
  const notas = useMemo(() => (d ? preparar(d) : []), [d]);
  const { estado, alternar, definir, periodo, granularidade, limpar } = useDashboardEstado(d?.inicial ?? null);
  const [copiado, setCopiado] = useState(false);

  const calc = useMemo(() => {
    if (!d || !estado) return null;
    const { de, ate, f, g } = estado;
    const hoje = d.hoje;
    const ctx: Ctx = { filtros: f, hoje, g };
    const ant = periodoAnterior(de, ate);
    const base = emitidasNoPeriodo(notas, ctx, de, ate);
    const meses = mesesEntre(de, ate);

    // --- KPIs + sparklines (uma medida por mês, últimos 12 meses do período)
    const atual = medidas(notas, d.lotes, ctx, de, ate);
    const anterior = medidas(notas, d.lotes, ctx, ant.de, ant.ate);
    const porMes = meses.slice(-12).map((m) => {
      const ini = `${m}-01` < de ? de : `${m}-01`;
      const fim = fimDoMes(m) > ate ? ate : fimDoMes(m);
      return medidas(notas, d.lotes, ctx, ini, fim);
    });
    const serie = (k: keyof Medidas) => porMes.map((x) => x[k] ?? 0);

    // --- segmentações: contagem respeitando os outros filtros
    const opcoes = {} as Record<Dimensao, OpcaoSlicer[]>;
    SLICERS.forEach((dim) => {
      const cont = new Map<string, number>();
      emitidasNoPeriodo(notas, ctx, de, ate, dim).forEach((n) => {
        const v = valorDim(n, dim, hoje, g);
        if (v != null) cont.set(v, (cont.get(v) ?? 0) + 1);
      });
      const todos = new Set<string>();
      notas.forEach((n) => {
        const v = valorDim(n, dim, hoje, g);
        if (v != null && (dim !== "mes" || meses.includes(v))) todos.add(v);
      });
      (f[dim] ?? []).forEach((v) => todos.add(v));
      let lista = [...todos].map((v) => ({ valor: v, rotulo: rotuloValor(dim, v), qtd: cont.get(v) ?? 0 }));
      if (dim === "situacao") lista = ORDEM_SIT.filter((s) => todos.has(s)).map((s) => lista.find((o) => o.valor === s)!);
      else if (dim === "atraso") lista = FAIXAS.filter((x) => todos.has(x)).map((x) => lista.find((o) => o.valor === x)!);
      else if (dim === "mes" || dim === "lote") lista.sort((a, b) => b.valor.localeCompare(a.valor));
      else lista.sort((a, b) => b.qtd - a.qtd || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
      opcoes[dim] = lista;
    });

    // --- Emitido × Recebido por mês (ignora o filtro de mês para mostrar a série inteira)
    const semMes = emitidasNoPeriodo(notas, ctx, de, ate, "mes").filter((n) => !n.cancelada);
    const pagasSemMes = notas.filter((n) => n.pagamento && n.pagamento >= de && n.pagamento <= ate && !n.cancelada && passa(n, ctx, "mes"));
    const brutos = meses.map((m) => ({
      m,
      rotulo: nomeMes(m),
      emitido: soma(semMes.filter((n) => n.mes === m).map((n) => n.valor)),
      recebido: soma(pagasSemMes.filter((n) => mesDe(n.pagamento!) === m).map((n) => n.recebido || n.valor)),
    }));
    // meses vazios no começo do período (antes do primeiro lote) não entram na série nem na tendência
    const primeiro = brutos.findIndex((x) => x.emitido > 0 || x.recebido > 0);
    const serieER = primeiro > 0 ? brutos.slice(primeiro) : brutos;
    const tend = tendencia(serieER.map((x) => x.emitido));
    const er = serieER.map((x, i) => ({ ...x, tendencia: tend.ajuste[i] ?? 0 }));

    // --- aging (carteira em aberto hoje)
    const abertas = notas.filter((n) => n.atraso && n.emissao <= ate && passa(n, ctx, "atraso"));
    const aging = FAIXAS.map((fx) => {
      const ns = abertas.filter((n) => n.atraso === fx);
      return { faixa: fx, valor: soma(ns.map((n) => n.valor)), qtd: ns.length };
    });

    // --- top clientes (até 8 + "Outros")
    const semCli = emitidasNoPeriodo(notas, ctx, de, ate, "cliente").filter((n) => !n.cancelada);
    const porCli = new Map<string, number>();
    semCli.forEach((n) => porCli.set(n.cliente, (porCli.get(n.cliente) ?? 0) + n.valor));
    const totalCli = soma([...porCli.values()]);
    const ordenados = [...porCli.entries()].sort((a, b) => b[1] - a[1]);
    const top = ordenados.slice(0, 8).map(([c, v]) => ({ cliente: c, curto: curto(c), valor: v, pct: totalCli ? (v / totalCli) * 100 : 0 }));
    const resto = soma(ordenados.slice(8).map(([, v]) => v));
    if (resto > 0) top.push({ cliente: `Outros (${ordenados.length - 8})`, curto: `Outros (${ordenados.length - 8})`, valor: resto, pct: (resto / totalCli) * 100, outros: true } as never);

    // --- situação
    const semSit = emitidasNoPeriodo(notas, ctx, de, ate, "situacao");
    const situacao = ORDEM_SIT.map((s) => {
      const ns = semSit.filter((n) => n.situacao === s);
      return { situacao: s, valor: soma(ns.map((n) => n.valor)), qtd: ns.length };
    });

    // --- previsão de recebimento
    const p = prazos(d.notas);
    const emAberto = notas.filter((n) => n.previsao && n.emissao <= ate && passa(n, ctx, "previsao"));
    const buckets = new Map<string, { valor: number; qtd: number }>();
    emAberto.forEach((n) => {
      const k = bucketPrevisao(n, hoje, g)!;
      const b = buckets.get(k) ?? { valor: 0, qtd: 0 };
      b.valor += n.valor;
      b.qtd++;
      buckets.set(k, b);
    });
    const chaves = [...buckets.keys()].sort((a, b) => (a === "atrasada" ? -1 : b === "atrasada" ? 1 : a.localeCompare(b)));
    const previsao = chaves.map((k) => ({
      chave: k,
      rotulo: k === "atrasada" ? "Atrasada" : g === "mes" ? nomeMes(k) : data(k).slice(0, 5),
      atrasada: k === "atrasada",
      ...buckets.get(k)!,
    }));
    const lim30 = somaDias(hoje, 30);
    const proximos30 = soma(emAberto.filter((n) => n.previsao! >= hoje && n.previsao! <= lim30).map((n) => n.valor));
    const atrasado = soma(emAberto.filter((n) => n.previsao! < hoje).map((n) => n.valor));

    // --- rejeições (lotes), série inteira do período
    const ctxSemMes: Ctx = { ...ctx, filtros: { ...f, mes: [] } };
    const ls = lotesFiltrados(d.lotes, ctxSemMes, de, ate);
    const rejeicoes = meses.map((m) => {
      const lm = ls.filter((l) => l.mes === m);
      const rej = soma(lm.map((l) => l.rejeitadas));
      const emi = soma(lm.map((l) => l.emitidas));
      return { m, rotulo: nomeMes(m), rejeitadas: rej, emitidas: emi, taxa: rej + emi ? (rej / (rej + emi)) * 100 : 0 };
    });

    // --- matriz cliente × mês (ignora cliente e mês para manter o contexto)
    const ctxMatriz: Ctx = { ...ctx, filtros: { ...f, cliente: [], mes: [] } };
    const baseMatriz = emitidasNoPeriodo(notas, ctxMatriz, de, ate).filter((n) => !n.cancelada);
    const valores: Matriz["valores"] = {};
    const totCli = new Map<string, number>();
    baseMatriz.forEach((n) => {
      valores[n.cliente] ??= {};
      valores[n.cliente][n.mes] = (valores[n.cliente][n.mes] ?? 0) + n.valor;
      totCli.set(n.cliente, (totCli.get(n.cliente) ?? 0) + n.valor);
    });
    const clientesMatriz = [...totCli.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
    const matriz: Matriz = {
      clientes: clientesMatriz,
      meses,
      valores,
      max: Math.max(0, ...clientesMatriz.flatMap((c) => Object.values(valores[c] ?? {}))),
    };

    // --- tabela: notas do filtro (inclui as em aberto antigas quando o filtro é de previsão/atraso)
    const usaCarteira = !!(f.previsao?.length || f.atraso?.length);
    const tabela: Nota[] = usaCarteira ? notas.filter((n) => n.emissao <= ate && passa(n, ctx)) : base;

    return {
      ctx,
      ant,
      atual,
      anterior,
      serie,
      opcoes,
      er,
      tendPct: tend.pct,
      aging,
      top,
      situacao,
      previsao,
      prazoGeral: p.geral,
      proximos30,
      atrasado,
      rejeicoes,
      matriz,
      tabela,
      simulada: tabela.some((n) => n.simulada),
    };
  }, [d, estado, notas]);

  if (q.isPending) return <Carregando />;
  if (q.isError) return <EmptyState icone={BarChart3} titulo="Não foi possível carregar o dashboard" descricao={(q.error as Error).message} />;
  if (d && d.notas.length === 0)
    return (
      <div>
        <PageHeader titulo="Dashboard de Faturamento" icone={LayoutDashboard} migalhas={[{ label: "Início", href: "/" }, { label: "Dashboard" }]} />
        <div className="card-surface">
          <EmptyState
            icone={BarChart3}
            titulo="Ainda não há faturas"
            descricao="Faturamento, recebimentos, atrasos e a previsão de caixa aparecem aqui assim que a primeira NH ou ND for gerada."
            acao={
              <div className="flex flex-wrap justify-center gap-2">
                <Button render={<Link href="/faturamento/itens" />}>
                  <ListChecks /> Ver itens a faturar
                </Button>
                {isOperador && (
                  <Button variant="outline" render={<Link href="/nfse/nova-emissao" />}>
                    <FileUp /> Nova emissão
                  </Button>
                )}
              </div>
            }
          />
        </div>
      </div>
    );
  if (!d || !estado || !calc) return <Carregando />;

  const { de, ate, f, g } = estado;
  const a = calc.atual;
  const b = calc.anterior;
  const chips = (Object.entries(f) as [Dimensao, string[]][]).flatMap(([dim, vals]) => (vals ?? []).map((v) => ({ dim, v })));
  const atalhoAtivo = ATALHOS.find((x) => {
    const r = atalho(x.k, d.hoje, d.inicial.de);
    return r.de === de && r.ate === ate;
  })?.k;
  const sitSel = f.situacao ?? [];
  const soSit = (s: Situacao[]) => sitSel.length === s.length && s.every((x) => sitSel.includes(x));
  const kpiSit = (s: Situacao[]) => definir("situacao", soSit(s) ? [] : s);

  const copiarLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopiado(true);
    toast.success("Link copiado — quem abrir verá exatamente esta visão");
    setTimeout(() => setCopiado(false), 1800);
  };

  return (
    <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
      <PageHeader
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            Dashboard de Faturamento
            {calc.simulada && (
              <Pill tom="warning" className="align-middle">
                Simulação
              </Pill>
            )}
          </span>
        }
        icone={LayoutDashboard}
        migalhas={[{ label: "Início", href: "/" }, { label: "Dashboard" }]}
        acoes={
          <>
            <Button variant="outline" onClick={limpar} disabled={!chips.length}>
              <Eraser /> Limpar filtros
            </Button>
            <Button variant="outline" onClick={copiarLink}>
              {copiado ? <Check /> : <Link2 />} Copiar link
            </Button>
          </>
        }
      />

      {/* período: uma linha acima de tudo o que ele escopa */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {ATALHOS.map((x) => (
            <button
              key={x.k}
              type="button"
              aria-pressed={atalhoAtivo === x.k}
              onClick={() => {
                const r = atalho(x.k, d.hoje, d.inicial.de);
                periodo(r.de, r.ate);
              }}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground transition-all",
                atalhoAtivo === x.k && "bg-card text-foreground shadow-sm ring-1 ring-border",
              )}
            >
              {atalhoAtivo === x.k && <Check className="size-3.5" strokeWidth={3} />}
              {x.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={de} max={ate} onChange={(e) => e.target.value && periodo(e.target.value, ate)} className="h-9 w-38" aria-label="De" />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" value={ate} min={de} onChange={(e) => e.target.value && periodo(de, e.target.value)} className="h-9 w-38" aria-label="Até" />
        </div>
        <span className="text-xs text-muted-foreground lg:ml-auto">
          comparado com {data(calc.ant.de)} a {data(calc.ant.ate)}
        </span>
      </div>

      {/* segmentações */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {SLICERS.map((dim) => (
          <Slicer
            key={dim}
            titulo={ROTULO_DIM[dim]}
            opcoes={calc.opcoes[dim]}
            selecionados={f[dim] ?? []}
            onAlternar={(v) => alternar(dim, v)}
            onDefinir={(vals) => definir(dim, vals)}
          />
        ))}
      </div>

      {chips.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Filtros ativos:</span>
          {chips.map(({ dim, v }) => (
            <button
              key={`${dim}-${v}`}
              type="button"
              onClick={() => alternar(dim, v)}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-brand/30 bg-brand/8 pr-1.5 pl-2.5 text-xs transition-colors hover:bg-brand/15"
              aria-label={`Remover filtro ${ROTULO_DIM[dim]}: ${rotuloValor(dim, v)}`}
            >
              <span className="text-muted-foreground">{ROTULO_DIM[dim]}:</span>
              <span className="max-w-48 truncate font-medium">{rotuloValor(dim, v)}</span>
              <X className="size-3 text-muted-foreground" />
            </button>
          ))}
        </motion.div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 [&>*]:min-w-0">
        <KpiTile rotulo="Faturado" valor={moedaCompacta(a.emitido)} delta={variacao(a.emitido, b.emitido)} serie={calc.serie("emitido")} dica={moeda(a.emitido)} />
        <KpiTile
          rotulo="Recebido"
          valor={moedaCompacta(a.recebido)}
          delta={variacao(a.recebido, b.recebido)}
          serie={calc.serie("recebido")}
          onClick={() => kpiSit(["paga"])}
          ativo={soSit(["paga"])}
          dica={`${moeda(a.recebido)} · clique para ver as pagas`}
        />
        <KpiTile
          rotulo="Em aberto"
          valor={moedaCompacta(a.aberto)}
          delta={variacao(a.aberto, b.aberto)}
          bomSubir={false}
          serie={calc.serie("aberto")}
          onClick={() => kpiSit(["aberta", "vencida"])}
          ativo={soSit(["aberta", "vencida"])}
          dica={`${moeda(a.aberto)} · clique para ver as em aberto`}
        />
        <KpiTile
          rotulo="Vencido"
          valor={moedaCompacta(a.vencido)}
          delta={variacao(a.vencido, b.vencido)}
          bomSubir={false}
          serie={calc.serie("vencido")}
          alerta={a.vencido > 0}
          onClick={() => kpiSit(["vencida"])}
          ativo={soSit(["vencida"])}
          dica={`${moeda(a.vencido)} · clique para ver as vencidas`}
        />
        <KpiTile rotulo="ISS" valor={moedaCompacta(a.iss)} delta={variacao(a.iss, b.iss)} serie={calc.serie("iss")} dica={moeda(a.iss)} />
        <KpiTile
          rotulo="Prazo médio de recebimento"
          valor={a.prazo == null ? "—" : `${Math.round(a.prazo)} dias`}
          delta={variacao(a.prazo, b.prazo)}
          bomSubir={false}
          serie={calc.serie("prazo")}
          dica="Da emissão ao pagamento, nas faturas pagas no período"
        />
        <KpiTile rotulo="Ticket médio" valor={a.ticket == null ? "—" : moedaCompacta(a.ticket)} delta={variacao(a.ticket, b.ticket)} serie={calc.serie("ticket")} dica={a.ticket == null ? undefined : moeda(a.ticket)} />
        <KpiTile rotulo="Documentos emitidos" valor={numero(a.qtd)} delta={variacao(a.qtd, b.qtd)} serie={calc.serie("qtd")} />
        <KpiTile
          rotulo="Taxa de rejeição"
          valor={a.rejeicao == null ? "—" : `${a.rejeicao.toFixed(1).replace(".", ",")}%`}
          delta={variacao(a.rejeicao, b.rejeicao)}
          bomSubir={false}
          serie={calc.serie("rejeicao")}
          dica="RPS rejeitados ÷ RPS enviados, nos lotes do período"
        />
      </div>

      {/* gráficos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <EmitidoRecebido dados={calc.er} tendenciaPct={calc.tendPct} sel={f.mes ?? []} onMes={(m) => alternar("mes", m)} />
        <SituacaoRosca dados={calc.situacao} sel={sitSel} onSituacao={(s) => alternar("situacao", s)} />

        <Previsao
          dados={calc.previsao}
          sel={f.previsao ?? []}
          onBucket={(k) => alternar("previsao", k)}
          g={g}
          onG={granularidade}
          prazoGeral={calc.prazoGeral}
          proximos30={calc.proximos30}
          atrasado={calc.atrasado}
        />
        <Aging dados={calc.aging} sel={f.atraso ?? []} onFaixa={(x) => alternar("atraso", x)} />

        <TopClientes dados={calc.top} sel={f.cliente ?? []} onCliente={(c) => alternar("cliente", c)} />
        <Rejeicoes dados={calc.rejeicoes} sel={f.mes ?? []} onMes={(m) => alternar("mes", m)} />
        <div className="card-surface flex flex-col justify-center gap-2 p-5 text-sm">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Em uma frase</p>
          <p className="leading-relaxed">
            No período, foram faturados <strong>{moeda(a.emitido)}</strong> em <strong>{numero(a.qtd)}</strong> documentos (NH e ND) e recebidos{" "}
            <strong>{moeda(a.recebido)}</strong>. A carteira em aberto soma <strong>{moeda(a.aberto)}</strong>
            {a.vencido > 0 ? (
              <>
                , dos quais <strong className="text-danger-ink">{moeda(a.vencido)}</strong> já venceram
              </>
            ) : null}
            {a.prazo != null && (
              <>
                ; os clientes pagam, em média, em <strong>{Math.round(a.prazo)} dias</strong>
              </>
            )}
            .
          </p>
        </div>

        <HeatmapClienteMes
          matriz={calc.matriz}
          selClientes={f.cliente ?? []}
          selMeses={f.mes ?? []}
          onCelula={(c, m) => {
            const mesmo = (f.cliente ?? []).length === 1 && f.cliente![0] === c && (f.mes ?? []).length === 1 && f.mes![0] === m;
            definir("cliente", mesmo ? [] : [c]);
            definir("mes", mesmo ? [] : [m]);
          }}
        />
      </div>

      <TabelaNotas notas={calc.tabela} hoje={d.hoje} />
    </div>
  );
}
