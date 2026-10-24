"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Building2,
  Calculator,
  CalendarClock,
  ChevronDown,
  Gauge,
  Info,
  Landmark,
  Loader2,
  Percent,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { ChartCard, EIXO, GRADE, LegendaItem, TooltipCaixa } from "@/components/dashboard/ui";
import { DinheiroInput } from "@/components/financeiro/comum";
import { eixoMoeda } from "@/components/financeiro/graficos";
import { Stat } from "@/components/financeiro/ui";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { paraBr, paraDecimalApi } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type Num = number | string;
interface Faixa {
  limite: Num;
  aliquota: Num;
  deducao: Num;
}
interface Linha {
  mes: string;
  receita: Num;
  origem: "contador" | "sistema" | "mes_corrente" | "projecao" | "editado";
  realizado: boolean;
  atual: boolean;
  impostos: Record<string, Num>;
  total_impostos: Num;
  aliquota_efetiva: Num;
  vencimento: string;
  rbt12?: Num;
  faixa?: number;
  aliquota_nominal?: Num;
  mudou_faixa?: boolean;
  trimestre?: boolean;
}
interface ConfigImp {
  regime: "simples" | "presumido" | "real";
  regime_cadastro: "simples" | "presumido" | "real" | "mei";
  regime_receita: "competencia" | "caixa";
  anexo: "III" | "IV" | "V";
  faixas: Faixa[];
  dia_vencimento_das: number;
  aliq_pis: Num;
  aliq_cofins: Num;
  aliq_pis_real: Num;
  aliq_cofins_real: Num;
  presuncao_irpj: Num;
  presuncao_csll: Num;
  aliq_irpj: Num;
  aliq_adicional_irpj: Num;
  limite_adicional_trimestre: Num;
  aliq_csll: Num;
  iss_modo: "percentual" | "fixo";
  iss_fixo_mensal: Num;
  aliquota_iss_emissora: Num;
  dia_vencimento: number;
}
interface Projecao {
  emissora_id: number;
  emissora: string;
  metodo: string;
  aviso: string;
  resumo: {
    regime: "simples" | "presumido" | "real";
    regime_cadastro: string;
    regime_receita: string;
    anexo: string;
    faturado_mes_atual: Num;
    a_emitir_mes_atual: Num;
    estimado_mes_atual: Num;
    imposto_mes_atual: Num;
    proximo_pagamento: { valor: Num; vencimento: string } | null;
    impostos_12m: Num;
    receita_12m: Num;
    projecao_12m: Num;
    receita_projetada_12m: Num;
    carga_12m: Num;
    rbt12?: Num;
    faixa?: number;
    aliquota_efetiva?: Num;
    aliquota_nominal?: Num;
    falta_proxima_faixa?: Num | null;
    uso_faixa?: Num;
    uso_teto?: Num;
    muda_faixa_em?: string | null;
  };
  linhas: Linha[];
  config: ConfigImp;
  receitas_informadas: { mes: string; valor: Num; observacao: string | null }[];
}
interface Simulacao {
  valor: Num;
  mes: string;
  imposto: Num;
  liquido: Num;
  aliquota: Num;
  vencimento: string;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const rotMes = (m: string) => `${MESES[Number(m.slice(5)) - 1]}/${m.slice(2, 4)}`;
const pct = (v: Num | undefined | null, casas = 2) => (v == null ? "—" : `${toNum(v).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: 0 })}%`);
const ORDEM_IMPOSTOS = ["DAS", "PIS", "COFINS", "ISS", "IRPJ", "CSLL"];
const ORIGEM: Record<Linha["origem"], { l: string; tom: "success" | "brand" | "warning" | "neutral" | "info" }> = {
  contador: { l: "contador", tom: "success" },
  sistema: { l: "sistema", tom: "neutral" },
  mes_corrente: { l: "mês corrente", tom: "brand" },
  projecao: { l: "projeção", tom: "info" },
  editado: { l: "editado", tom: "warning" },
};
const REGIMES = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real", mei: "MEI" } as const;

function lerEdits(emissoraId: number | null): Record<string, string> {
  if (!emissoraId) return {};
  try {
    return JSON.parse(localStorage.getItem(`mayacorp:impostos:${emissoraId}`) ?? "{}");
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- configuração (admin)
function ConfigPainel({ p, onSalvo }: { p: Projecao; onSalvo: (r: Projecao) => void }) {
  const [c, setC] = useState<ConfigImp>(p.config);
  const [regime, setRegime] = useState<string>(p.config.regime_cadastro);
  /* eslint-disable react-hooks/set-state-in-effect -- recarrega quando a projeção muda */
  useEffect(() => {
    setC(p.config);
    setRegime(p.config.regime_cadastro);
  }, [p.config]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof ConfigImp>(k: K, v: ConfigImp[K]) => setC((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: (recarregar: boolean) => {
      // não devolve campos só de leitura (regime_cadastro, aliquota_iss_emissora)
      const { regime_cadastro: _rc, aliquota_iss_emissora: _ai, regime: _r, ...resto } = c;
      void _rc;
      void _ai;
      void _r;
      return api.put<Projecao>(`/financeiro/impostos/${p.emissora_id}/config`, {
        ...resto,
        regime,
        faixas: recarregar ? null : c.faixas.map((f) => ({ limite: toNum(f.limite), aliquota: toNum(f.aliquota), deducao: toNum(f.deducao) })),
        recarregar_tabela: recarregar,
      });
    },
    onSuccess: (r) => {
      toast.success("Configuração dos impostos salva");
      onSalvo(r);
    },
  });
  const simples = regime === "simples" || regime === "mei";
  const real = regime === "real";
  const numIn = (k: keyof ConfigImp, rotulo: string, sufixo = "%") => (
    <Field label={rotulo} htmlFor={`imp-${String(k)}`}>
      <div className="relative">
        <Input
          id={`imp-${String(k)}`}
          inputMode="decimal"
          value={String(c[k] ?? "")}
          onChange={(e) => set(k, e.target.value.replace(",", ".") as never)}
          className="pr-8 text-right font-mono"
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{sufixo}</span>
      </div>
    </Field>
  );
  return (
    <form
      className="space-y-5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate(false);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Regime tributário" htmlFor="imp-regime" dica={<>O regime é o do cadastro da empresa (<Link href="/cadastros/emissoras" className="text-info-ink hover:underline">Emissoras</Link>); salvar aqui atualiza o cadastro.</>} className="sm:col-span-2">
          <NativeSelect id="imp-regime" value={regime} onChange={(e) => setRegime(e.target.value)}>
            {Object.entries(REGIMES).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Receita considerada" htmlFor="imp-receita">
          <NativeSelect id="imp-receita" value={c.regime_receita} onChange={(e) => set("regime_receita", e.target.value as ConfigImp["regime_receita"])}>
            <option value="competencia">Competência (emissão)</option>
            <option value="caixa">Caixa (pagamento)</option>
          </NativeSelect>
        </Field>
      </div>

      {simples ? (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Anexo" htmlFor="imp-anexo">
              <NativeSelect id="imp-anexo" value={c.anexo} onChange={(e) => set("anexo", e.target.value as ConfigImp["anexo"])}>
                <option value="III">Anexo III</option>
                <option value="IV">Anexo IV</option>
                <option value="V">Anexo V</option>
              </NativeSelect>
            </Field>
            <Field label="Dia de vencimento do DAS" htmlFor="imp-dia-das">
              <Input id="imp-dia-das" type="number" min={1} max={31} value={c.dia_vencimento_das} onChange={(e) => set("dia_vencimento_das", Number(e.target.value))} />
            </Field>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium">Faixas do Anexo {c.anexo}</span>
              <Button type="button" size="xs" variant="ghost" onClick={() => salvar.mutate(true)} disabled={salvar.isPending}>
                <RotateCcw /> Recarregar tabela oficial
              </Button>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Faixa</th>
                  <th className="px-2 py-1.5 text-left font-medium">RBT12 até</th>
                  <th className="px-2 py-1.5 text-left font-medium">Alíquota nominal</th>
                  <th className="px-3 py-1.5 text-left font-medium">Parcela a deduzir</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {c.faixas.map((f, i) => (
                  <tr key={i} className={cn(p.resumo.faixa === i + 1 && "bg-brand/6")}>
                    <td className="px-3 py-1.5 font-medium">{i + 1}ª</td>
                    {(["limite", "aliquota", "deducao"] as const).map((k) => (
                      <td key={k} className="px-2 py-1.5">
                        <Input
                          aria-label={`${k} da faixa ${i + 1}`}
                          inputMode="decimal"
                          value={String(f[k])}
                          onChange={(e) => set("faixas", c.faixas.map((x, j) => (j === i ? { ...x, [k]: e.target.value.replace(",", ".") } : x)))}
                          className="h-8 text-right font-mono"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-4">
          {real ? (
            <>
              {numIn("aliq_pis_real", "PIS (não cumulativo)")}
              {numIn("aliq_cofins_real", "COFINS (não cumulativo)")}
            </>
          ) : (
            <>
              {numIn("aliq_pis", "PIS")}
              {numIn("aliq_cofins", "COFINS")}
              {numIn("presuncao_irpj", "Presunção IRPJ")}
              {numIn("aliq_irpj", "IRPJ")}
              {numIn("aliq_adicional_irpj", "Adicional IRPJ")}
              {numIn("limite_adicional_trimestre", "Limite do adicional (tri)", "R$")}
              {numIn("presuncao_csll", "Presunção CSLL")}
              {numIn("aliq_csll", "CSLL")}
            </>
          )}
          <Field label="ISS" htmlFor="imp-iss-modo" dica={c.iss_modo === "percentual" ? `Usa a alíquota do cadastro da emissora (${pct(c.aliquota_iss_emissora)}).` : "Valor fixo por mês (sociedade de profissionais)."}>
            <NativeSelect id="imp-iss-modo" value={c.iss_modo} onChange={(e) => set("iss_modo", e.target.value as ConfigImp["iss_modo"])}>
              <option value="percentual">Percentual sobre a receita</option>
              <option value="fixo">Fixo mensal</option>
            </NativeSelect>
          </Field>
          {c.iss_modo === "fixo" && numIn("iss_fixo_mensal", "ISS fixo mensal", "R$")}
          <Field label="Dia de vencimento" htmlFor="imp-dia">
            <Input id="imp-dia" type="number" min={1} max={31} value={c.dia_vencimento} onChange={(e) => set("dia_vencimento", Number(e.target.value))} />
          </Field>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar configuração
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- página
export default function ImpostosPage() {
  const qc = useQueryClient();
  const { isAdmin, isOperador } = useAuth();
  const emissoras = useEmissoras();
  const [emissoraId, setEmissoraId] = useState<number | null>(null);
  const [metodo, setMetodo] = useState("media3");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [sim, setSim] = useState({ valor: "", mes: new Date().toLocaleDateString("sv-SE").slice(0, 7) });
  const [simRes, setSimRes] = useState<Simulacao | null>(null);
  const [inf, setInf] = useState({ mes: "", valor: "", obs: "" });

  const ativas = (emissoras.data ?? []).filter((e) => e.ativa);
  const id = emissoraId ?? ativas[0]?.id ?? null;
  /* eslint-disable react-hooks/set-state-in-effect -- edições da receita futura ficam no navegador, por empresa */
  useEffect(() => {
    setEdits(lerEdits(id));
  }, [id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const gravarEdits = (n: Record<string, string>) => {
    setEdits(n);
    try {
      localStorage.setItem(`mayacorp:impostos:${id}`, JSON.stringify(n));
    } catch {
      /* sem armazenamento local */
    }
  };
  const chave = ["fin", "impostos", id, metodo, edits];
  const q = useQuery({
    queryKey: chave,
    enabled: !!id,
    placeholderData: (p) => p,
    meta: { silencioso: true },
    queryFn: () =>
      Object.keys(edits).length
        ? api.post<Projecao>("/financeiro/impostos/recalcular", { emissora_id: id, metodo, editados: Object.fromEntries(Object.entries(edits).map(([k, v]) => [k, paraDecimalApi(v)])) })
        : api.get<Projecao>("/financeiro/impostos", { emissora_id: id ?? undefined, metodo }),
  });
  const p = q.data;
  const atualizar = (r: Projecao) => {
    qc.setQueryData(chave, r);
    qc.invalidateQueries({ queryKey: ["fin", "impostos"] });
  };
  const simular = useMutation({
    mutationFn: () => api.post<Simulacao>(`/financeiro/impostos/${id}/simular`, { valor: paraDecimalApi(sim.valor), mes: `${sim.mes}-01` }),
    onSuccess: setSimRes,
  });
  const informar = useMutation({
    mutationFn: () => api.post<Projecao>(`/financeiro/impostos/${id}/receitas-informadas`, { mes: inf.mes, valor: paraDecimalApi(inf.valor), observacao: inf.obs.trim() || null }),
    onSuccess: (r) => {
      toast.success("Receita do contador registrada");
      setInf({ mes: "", valor: "", obs: "" });
      atualizar(r);
    },
  });
  const apagarInf = useMutation({
    mutationFn: (mes: string) => api.del<Projecao>(`/financeiro/impostos/${id}/receitas-informadas/${mes}`),
    onSuccess: (r) => (toast.success("Receita informada removida"), atualizar(r)),
  });

  if (emissoras.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (!ativas.length)
    return (
      <EmptyState
        icone={Building2}
        titulo="Cadastre a empresa emissora"
        descricao="A projeção de impostos usa o regime e as NFS-e de cada empresa."
        acao={
          <Button render={<Link href="/cadastros/emissoras" />}>
            <Building2 /> Ir para Emissoras
          </Button>
        }
      />
    );

  const linhasAsc = p ? [...p.linhas].reverse() : [];
  const colunas = ORDEM_IMPOSTOS.filter((k) => linhasAsc.some((l) => k in l.impostos));
  const pontos = linhasAsc.map((l) => ({ ...l, rot: rotMes(l.mes), rec: toNum(l.receita), imp: toNum(l.total_impostos), aliq: toNum(l.aliquota_efetiva) }));
  const r = p?.resumo;
  const mesAtualNome = MESES_LONGOS[new Date().getMonth()];
  const futuro = (l: Linha) => !l.realizado;

  return (
    <div>
      <PageHeader
        titulo="Projeção de Impostos"
        icone={Calculator}
        migalhas={[{ label: "Faturamento" }, { label: "Projeção de Impostos" }]}
        acoes={
          <div className="flex flex-wrap gap-2">
            {ativas.length > 1 && (
              <NativeSelect aria-label="Empresa emissora" value={id ?? ""} onChange={(e) => setEmissoraId(Number(e.target.value))} className="h-9 w-56">
                {ativas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {nomeEmissora(e)}
                  </option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect aria-label="Como projetar" value={metodo} onChange={(e) => setMetodo(e.target.value)} className="h-9 w-52">
              <option value="media3">Média dos últimos 3 meses</option>
              <option value="media6">Média dos últimos 6 meses</option>
              <option value="media12">Média dos últimos 12 meses</option>
              <option value="ano_anterior">Mesmo mês do ano anterior</option>
            </NativeSelect>
          </div>
        }
      />

      {q.isError && !p ? (
        <EmptyState icone={Calculator} titulo="Não foi possível calcular" descricao={q.error instanceof ApiError ? q.error.message : "Tente de novo em instantes."} />
      ) : !p || !r ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className={cn("space-y-5 transition-opacity", q.isFetching && "opacity-70")}>
          {/* frase-resumo */}
          <section className="relative overflow-hidden rounded-3xl bg-dark-maya p-6 text-white shadow-xl">
            <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/30 blur-3xl" />
            <p className="relative text-xs text-white/60">
              {p.emissora} · {REGIMES[r.regime_cadastro as keyof typeof REGIMES] ?? r.regime}
              {r.regime === "simples" && ` · Anexo ${r.anexo}`} · receita por {r.regime_receita === "caixa" ? "caixa" : "competência"}
            </p>
            <p className="relative mt-2 text-lg leading-relaxed sm:text-xl">
              Faturado em <strong>{mesAtualNome}</strong> até hoje <strong className="font-mono">{moeda(r.faturado_mes_atual)}</strong>
              {toNum(r.a_emitir_mes_atual) > 0 && (
                <>
                  {" "}
                  <span className="text-white/70">(+ {moeda(r.a_emitir_mes_atual)} a emitir)</span>
                </>
              )}{" "}
              → imposto estimado <strong className="font-mono text-amber-300">{moeda(r.imposto_mes_atual)}</strong>
              {toNum(r.estimado_mes_atual) > toNum(r.faturado_mes_atual) + toNum(r.a_emitir_mes_atual) && (
                <span className="block text-sm text-white/60">considerando o mês fechando em {moeda(r.estimado_mes_atual)} pela média</span>
              )}
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat
              rotulo="Próximo pagamento"
              valor={r.proximo_pagamento ? moeda(r.proximo_pagamento.valor) : "—"}
              icone={CalendarClock}
              tom="warning"
              sub={r.proximo_pagamento ? `vence ${data(r.proximo_pagamento.vencimento)}` : undefined}
            />
            <Stat rotulo="Alíquota efetiva" valor={pct(r.regime === "simples" ? r.aliquota_efetiva : r.carga_12m)} icone={Percent} tom="brand" sub={r.regime === "simples" ? `nominal ${pct(r.aliquota_nominal)}` : "carga dos últimos 12 meses"} />
            <Stat rotulo="Impostos últimos 12m" valor={moeda(r.impostos_12m)} icone={Landmark} sub={`carga ${pct(r.carga_12m)} sobre ${moeda(r.receita_12m)}`} />
            <Stat rotulo="Projeção próximos 12m" valor={moeda(r.projecao_12m)} icone={TrendingUp} sub={`sobre ${moeda(r.receita_projetada_12m)} de receita`} />
            {r.regime === "simples" && r.rbt12 != null ? (
              <div className="card-surface p-4">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Gauge className="size-3.5" /> RBT12 · {r.faixa}ª faixa
                </p>
                <p className="mt-0.5 font-mono text-xl font-semibold">{moeda(r.rbt12)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={toNum(r.uso_faixa)} aria-valuemin={0} aria-valuemax={100} aria-label="Uso da faixa">
                  <div className={cn("h-full rounded-full", toNum(r.uso_faixa) > 85 ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, toNum(r.uso_faixa))}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {r.falta_proxima_faixa != null ? `faltam ${moeda(r.falta_proxima_faixa)} para a próxima faixa` : "última faixa"}
                  {r.muda_faixa_em && <span className="text-warning-ink"> · muda em {rotMes(r.muda_faixa_em)}</span>}
                </p>
              </div>
            ) : null}
          </div>
          {r.regime === "simples" && toNum(r.uso_teto) > 80 && (
            <p className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger-ink">
              <Info className="size-4" /> O faturamento dos últimos 12 meses já usa {pct(r.uso_teto, 1)} do limite do Simples (R$ 4,8 milhões). Converse com o contador sobre a mudança de regime.
            </p>
          )}

          <ChartCard
            titulo="Receita, impostos e alíquota efetiva"
            subtitulo="Barras mais claras são meses projetados"
            legenda={
              <>
                <LegendaItem cor="var(--viz-1)" rotulo="Receita" />
                <LegendaItem cor="#F5A623" rotulo="Impostos" />
                <LegendaItem cor="var(--viz-vencida)" rotulo="Alíquota efetiva" forma="linha" />
              </>
            }
          >
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={pontos} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid vertical={false} {...GRADE} />
                  <XAxis dataKey="rot" {...EIXO} />
                  <YAxis yAxisId="v" {...EIXO} width={56} tickFormatter={eixoMoeda} />
                  <YAxis yAxisId="a" orientation="right" {...EIXO} width={40} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip
                    cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                    content={({ active, payload }) => {
                      const x = payload?.[0]?.payload as (typeof pontos)[number] | undefined;
                      if (!active || !x) return null;
                      return (
                        <TooltipCaixa
                          titulo={`${x.rot} · ${ORIGEM[x.origem].l}`}
                          linhas={[
                            { cor: "var(--viz-1)", rotulo: "Receita", valor: moeda(x.rec) },
                            { cor: "#F5A623", rotulo: "Impostos", valor: moeda(x.imp) },
                            { cor: "var(--viz-vencida)", rotulo: "Alíquota efetiva", valor: pct(x.aliq) },
                          ]}
                          rodape={`Vence ${data(x.vencimento)}`}
                        />
                      );
                    }}
                  />
                  <Bar yAxisId="v" dataKey="rec" fill="var(--viz-1)" maxBarSize={22} radius={[4, 4, 0, 0]}>
                    {pontos.map((x) => (
                      <Cell key={x.mes} fillOpacity={x.realizado ? 1 : x.atual ? 0.75 : 0.4} />
                    ))}
                  </Bar>
                  <Bar yAxisId="v" dataKey="imp" fill="#F5A623" maxBarSize={22} radius={[4, 4, 0, 0]}>
                    {pontos.map((x) => (
                      <Cell key={x.mes} fillOpacity={x.realizado ? 1 : x.atual ? 0.75 : 0.4} />
                    ))}
                  </Bar>
                  <Line yAxisId="a" type="stepAfter" dataKey="aliq" stroke="var(--viz-vencida)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
            {/* tabela mês a mês */}
            <section className="card-surface overflow-hidden" aria-label="Mês a mês">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div>
                  <h2 className="font-semibold">Mês a mês</h2>
                  <p className="text-xs text-muted-foreground">Clique na receita de um mês futuro para simular outro valor.</p>
                </div>
                {Object.keys(edits).length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => gravarEdits({})}>
                    <Undo2 /> Desfazer {Object.keys(edits).length} edição(ões)
                  </Button>
                )}
              </header>
              <div className="max-h-[640px] overflow-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-muted text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Mês</th>
                      <th className="px-3 py-2 text-right font-medium">Receita</th>
                      {colunas.map((k) => (
                        <th key={k} className="px-3 py-2 text-right font-medium">
                          {k}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                      <th className="px-3 py-2 text-right font-medium">Alíq.</th>
                      <th className="px-4 py-2 text-left font-medium">Vencimento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {p.linhas.map((l) => (
                      <tr key={l.mes} className={cn(l.atual && "bg-brand/8 font-medium", !l.realizado && !l.atual && "text-muted-foreground")}>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            {rotMes(l.mes)}
                            <Pill tom={ORIGEM[l.origem].tom}>{ORIGEM[l.origem].l}</Pill>
                            {l.mudou_faixa && (
                              <span title={`Muda para a ${l.faixa}ª faixa`} className="inline-flex items-center text-[10px] font-semibold text-warning-ink">
                                <ArrowUp className="size-3" />
                                {l.faixa}ª
                              </span>
                            )}
                            {l.trimestre && <span className="text-[10px] text-muted-foreground" title="Fecha o trimestre: IRPJ e CSLL">tri</span>}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {futuro(l) && editando === l.mes ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                setEditando(null);
                              }}
                            >
                              <DinheiroInput
                                aria-label={`Receita de ${rotMes(l.mes)}`}
                                value={edits[l.mes] ?? paraBr(l.receita)}
                                onChange={(v) => gravarEdits({ ...edits, [l.mes]: v })}
                                onBlur={() => setEditando(null)}
                                className="h-7 w-36"
                                autoFocus
                              />
                            </form>
                          ) : futuro(l) ? (
                            <span className="inline-flex items-center gap-1">
                              <button type="button" onClick={() => setEditando(l.mes)} className="rounded px-1 font-mono tabular-nums hover:bg-brand/8 hover:ring-1 hover:ring-brand/30" aria-label={`Editar receita de ${rotMes(l.mes)}`}>
                                {moeda(l.receita)}
                              </button>
                              {edits[l.mes] && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const n = { ...edits };
                                    delete n[l.mes];
                                    gravarEdits(n);
                                  }}
                                  aria-label={`Voltar a receita projetada de ${rotMes(l.mes)}`}
                                  className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                >
                                  <Undo2 className="size-3" />
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums">{moeda(l.receita)}</span>
                          )}
                        </td>
                        {colunas.map((k) => (
                          <td key={k} className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {l.impostos[k] != null ? moeda(l.impostos[k]) : ""}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{moeda(l.total_impostos)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{pct(l.aliquota_efetiva)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{data(l.vencimento)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
              {/* simulador */}
              <section className="card-surface p-4" aria-labelledby="sim-t">
                <h2 id="sim-t" className="mb-3 flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-info-ink" /> Se eu faturar…
                </h2>
                <form
                  className="grid grid-cols-[1fr_130px] gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (toNum(paraDecimalApi(sim.valor || "0")) <= 0) return toast.error("Informe um valor.");
                    simular.mutate();
                  }}
                >
                  <Field label="Valor" htmlFor="sim-valor">
                    <DinheiroInput id="sim-valor" value={sim.valor} onChange={(v) => setSim({ ...sim, valor: v })} />
                  </Field>
                  <Field label="No mês" htmlFor="sim-mes">
                    <Input id="sim-mes" type="month" value={sim.mes} onChange={(e) => setSim({ ...sim, mes: e.target.value })} />
                  </Field>
                  <Button type="submit" className="col-span-2" disabled={simular.isPending}>
                    {simular.isPending ? <Loader2 className="animate-spin" /> : <Calculator />} Calcular
                  </Button>
                </form>
                {simRes && (
                  <dl className="mt-3 grid grid-cols-2 gap-y-1.5 rounded-xl bg-muted/40 p-3 text-sm">
                    <dt className="text-muted-foreground">Imposto a mais</dt>
                    <dd className="text-right font-mono font-semibold text-warning-ink">{moeda(simRes.imposto)}</dd>
                    <dt className="text-muted-foreground">Fica líquido</dt>
                    <dd className="text-right font-mono font-semibold text-success-ink">{moeda(simRes.liquido)}</dd>
                    <dt className="text-muted-foreground">Alíquota marginal</dt>
                    <dd className="text-right">{pct(simRes.aliquota)}</dd>
                    <dt className="text-muted-foreground">Vencimento</dt>
                    <dd className="text-right font-mono">{data(simRes.vencimento)}</dd>
                  </dl>
                )}
              </section>

              {/* receita do contador */}
              <section className="card-surface p-4" aria-labelledby="inf-t">
                <h2 id="inf-t" className="font-semibold">
                  Receita informada pelo contador
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">Substitui o valor do sistema no mês (ex.: receitas fora das NFS-e emitidas aqui).</p>
                {isOperador && (
                  <form
                    className="grid grid-cols-2 gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!inf.mes) return toast.error("Escolha o mês.");
                      informar.mutate();
                    }}
                  >
                    <Field label="Mês" htmlFor="inf-mes">
                      <Input id="inf-mes" type="month" value={inf.mes} onChange={(e) => setInf({ ...inf, mes: e.target.value })} />
                    </Field>
                    <Field label="Receita" htmlFor="inf-valor">
                      <DinheiroInput id="inf-valor" value={inf.valor} onChange={(v) => setInf({ ...inf, valor: v })} />
                    </Field>
                    <Field label="Observação" htmlFor="inf-obs" className="col-span-2">
                      <Input id="inf-obs" value={inf.obs} onChange={(e) => setInf({ ...inf, obs: e.target.value })} maxLength={300} />
                    </Field>
                    <Button type="submit" variant="outline" className="col-span-2" disabled={informar.isPending}>
                      {informar.isPending && <Loader2 className="animate-spin" />} Registrar
                    </Button>
                  </form>
                )}
                {p.receitas_informadas.length > 0 && (
                  <ul className="mt-3 divide-y rounded-xl border text-sm">
                    {p.receitas_informadas.map((x) => (
                      <li key={x.mes} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-14 font-medium">{rotMes(x.mes)}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{x.observacao}</span>
                        <span className="font-mono">{moeda(x.valor)}</span>
                        {isOperador && (
                          <Button variant="ghost" size="icon-xs" onClick={() => apagarInf.mutate(x.mes)} aria-label={`Remover receita de ${rotMes(x.mes)}`}>
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>

          {p.aviso && (
            <p className="flex items-start gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {p.aviso}
            </p>
          )}

          {isAdmin && (
            <section className="card-surface overflow-hidden">
              <button type="button" onClick={() => setConfigAberta((a) => !a)} aria-expanded={configAberta} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/30">
                <Landmark className="size-4 text-info-ink" />
                <span className="font-semibold">Configuração do cálculo</span>
                <span className="text-xs text-muted-foreground">regime, faixas, alíquotas e vencimentos</span>
                <ChevronDown className={cn("ml-auto size-4 transition-transform", configAberta && "rotate-180")} />
              </button>
              {configAberta && (
                <div className="border-t">
                  <ConfigPainel p={p} onSalvo={(x) => (atualizar(x), qc.invalidateQueries({ queryKey: ["emissoras"] }))} />
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
