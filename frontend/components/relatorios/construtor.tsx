"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BarChart3,
  Clock,
  FileSpreadsheet,
  Hash,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Save,
  SaveAll,
  Sigma,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ChartCard } from "@/components/dashboard/ui";
import { Stat } from "@/components/financeiro/ui";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { BarraFiltros } from "@/components/relatorios/filtros";
import { GraficoRelatorio } from "@/components/relatorios/grafico";
import { PainelMontar } from "@/components/relatorios/painel";
import { TabelaRelatorio } from "@/components/relatorios/tabela";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { api, baixar } from "@/lib/api";
import { numero } from "@/lib/format";
import {
  type Categoria,
  type ConfigRelatorio,
  descreverFiltro,
  ehDimensao,
  type Filtro,
  filtroVazio,
  type FonteMeta,
  formatar,
  GRANULARIDADES,
  type Resultado,
  type Salvo,
} from "@/lib/relatorios";
import { cn } from "@/lib/utils";

/** Para onde o gráfico desce depois de clicar numa barra (drill-down). */
const DESCE: Record<string, string[]> = {
  cliente: ["caso", "titulo", "contrato"],
  contrato: ["caso", "titulo"],
  area: ["caso", "titulo"],
  profissional: ["caso"],
  responsavel: ["titulo", "caso"],
  tribunal: ["vara", "comarca"],
  foro: ["vara"],
  comarca: ["vara"],
  tipo: ["cliente"],
  situacao: ["cliente"],
  status: ["cliente"],
};
const DESCE_DATA: Record<string, string> = {
  ano: "mes",
  trimestre: "mes",
  mes: "dia",
  semana: "dia",
};

export function ConstrutorRelatorio({
  fonte,
  inicial,
  titulo,
  descricao,
  salvo,
  migalha,
}: {
  fonte: FonteMeta;
  inicial: ConfigRelatorio;
  titulo: string;
  descricao?: string;
  salvo?: Salvo;
  migalha?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [config, setConfig] = useState<ConfigRelatorio>(inicial);
  const [painel, setPainel] = useState(true);
  const [salvar, setSalvar] = useState<null | "novo" | "editar">(null);
  const cols = useMemo(
    () => Object.fromEntries(fonte.colunas.map((c) => [c.id, c])),
    [fonte],
  );

  // o que vai ao servidor: sem filtro em branco (o chip recém-criado ainda sem valor)
  const pedido = useMemo(
    () => ({
      fonte: fonte.id,
      ...config,
      filtros: config.filtros.filter((f) => !filtroVazio(f) && cols[f.coluna]),
    }),
    [config, fonte.id, cols],
  );
  const consulta = useDebounce(pedido, 250);
  const q = useQuery({
    queryKey: ["relatorios", "executar", consulta],
    queryFn: () => api.post<Resultado>("/relatorios/executar", consulta),
    placeholderData: keepPreviousData,
  });
  const r = q.data;
  const g = r?.grafico;
  const mudou = JSON.stringify(config) !== JSON.stringify(inicial);

  const subtitulo = pedido.filtros
    .map((f) => descreverFiltro(f, cols[f.coluna]))
    .join(" · ");
  const exportar = useMutation({
    mutationFn: () =>
      baixar(
        "/relatorios/exportar",
        {
          method: "POST",
          body: { ...pedido, titulo, subtitulo: subtitulo || null },
        },
        `${titulo}.xlsx`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizarSalvo = useMutation({
    mutationFn: () =>
      api.put<Salvo>(`/relatorios/salvos/${salvo!.id}`, {
        nome: salvo!.nome,
        descricao: salvo!.descricao,
        fonte: fonte.id,
        config,
        compartilhado: salvo!.compartilhado,
      }),
    onSuccess: () => {
      toast.success("Relatório salvo");
      qc.invalidateQueries({ queryKey: ["relatorios", "catalogo"] });
    },
  });

  const filtrarPor = (cat: Categoria, serie?: string) => {
    if (!g) return;
    const antes = config;
    const dim = g.dimensao.id;
    const novo: Filtro =
      g.dimensao.tipo === "data"
        ? { coluna: dim, de: cat.de ?? null, ate: cat.ate ?? null }
        : { coluna: dim, valores: [cat.valor ?? cat.rotulo] };
    let filtros = [...config.filtros.filter((f) => f.coluna !== dim), novo];
    if (serie && g.serie)
      filtros = [
        ...filtros.filter((f) => f.coluna !== g.serie!.id),
        { coluna: g.serie.id, valores: [serie] },
      ];
    // desce um nível: cliente → caso, mês → dia...
    let grafico = config.grafico;
    if (
      g.dimensao.tipo === "data" &&
      g.granularidade &&
      DESCE_DATA[g.granularidade] &&
      g.granularidade !== "dia_semana"
    ) {
      grafico = {
        ...grafico,
        granularidade: DESCE_DATA[
          g.granularidade
        ] as typeof grafico.granularidade,
      };
    } else {
      const prox = (DESCE[dim] ?? []).find(
        (id) => cols[id] && ehDimensao(cols[id].tipo) && id !== dim,
      );
      if (prox)
        grafico = {
          ...grafico,
          dimensao: prox,
          serie: grafico.serie === prox ? null : grafico.serie,
        };
    }
    setConfig({ ...config, filtros, grafico });
    const rot =
      g.dimensao.tipo === "data" ? cat.rotulo : (cat.valor ?? cat.rotulo);
    const desceu =
      grafico.dimensao !== config.grafico.dimensao
        ? ` · agora por ${cols[grafico.dimensao!]?.rotulo.toLowerCase()}`
        : grafico.granularidade !== config.grafico.granularidade
          ? ` · agora por ${GRANULARIDADES.find((x) => x.id === grafico.granularidade)?.rotulo.toLowerCase()}`
          : "";
    toast(
      `Filtrado: ${g.dimensao.rotulo} = ${rot}${serie ? ` e ${g.serie?.rotulo} = ${serie}` : ""}${desceu}`,
      {
        action: { label: "Desfazer", onClick: () => setConfig(antes) },
      },
    );
  };

  const numericas = (r?.colunas ?? [])
    // número de identificação (Nº do caso) não é medida: não vira total
    .filter((c) => r?.totais[c.id] && !/(^|_)numero$/.test(c.id))
    .slice(0, 3);
  const tituloGrafico = g
    ? `${g.agregacao === "contagem" ? `Quantidade de ${r!.rotulo_contagem.toLowerCase()}` : `${g.medida.rotulo}${g.agregacao !== "soma" ? ` (${g.agregacao === "media" ? "média" : g.agregacao === "max" ? "maior" : "menor"})` : ""}`} por ${g.dimensao.rotulo.toLowerCase()}${g.serie ? ` e ${g.serie.rotulo.toLowerCase()}` : ""}`
    : "";

  return (
    <div>
      <PageHeader
        titulo={titulo}
        descricao={descricao}
        icone={BarChart3}
        migalhas={[
          { label: "Relatórios", href: "/relatorios" },
          ...(migalha ? [{ label: migalha }] : []),
          { label: titulo },
        ]}
        acoes={
          <>
            {mudou && (
              <Button variant="ghost" onClick={() => setConfig(inicial)}>
                <RotateCcw /> Desfazer mudanças
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => exportar.mutate()}
              disabled={exportar.isPending || !r}
            >
              {exportar.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileSpreadsheet />
              )}{" "}
              Excel
            </Button>
            {salvo?.meu && (
              <Button
                variant={mudou ? "default" : "outline"}
                onClick={() => atualizarSalvo.mutate()}
                disabled={atualizarSalvo.isPending || !mudou}
              >
                <Save /> Salvar
              </Button>
            )}
            <Button
              variant={salvo?.meu ? "outline" : "default"}
              onClick={() => setSalvar("novo")}
            >
              <SaveAll /> {salvo ? "Salvar como…" : "Salvar como meu"}
            </Button>
          </>
        }
      />

      <div
        className={cn(
          "grid items-start gap-5",
          painel && "lg:grid-cols-[300px_minmax(0,1fr)]",
        )}
      >
        {painel && (
          <aside
            className="card-surface p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
            aria-label="Montar relatório"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold">Montar relatório</p>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPainel(false)}
                aria-label="Esconder o painel"
              >
                <PanelLeftClose />
              </Button>
            </div>
            <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Base: <b className="text-foreground">{fonte.nome}</b>
            </p>
            <PainelMontar fonte={fonte} config={config} onChange={setConfig} />
          </aside>
        )}

        <div className="min-w-0 space-y-5">
          <section
            className="card-surface flex items-start gap-2 p-3"
            aria-label="Filtros"
          >
            {!painel && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPainel(true)}
                aria-label="Mostrar o painel"
                title="Montar relatório"
              >
                <PanelLeftOpen />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <BarraFiltros
                fonte={fonte}
                filtros={config.filtros}
                onChange={(filtros) => setConfig({ ...config, filtros })}
              />
            </div>
            {q.isFetching && (
              <Loader2
                className="mt-1.5 size-4 shrink-0 animate-spin text-muted-foreground"
                aria-label="Atualizando"
              />
            )}
          </section>

          {!r ? (
            q.isError ? (
              <div className="card-surface">
                <EmptyState
                  icone={BarChart3}
                  titulo="Não deu para montar o relatório"
                  descricao={(q.error as Error).message}
                />
              </div>
            ) : (
              <div className="space-y-5">
                <Skeleton className="h-20 rounded-2xl" />
                <Skeleton className="h-80 rounded-2xl" />
              </div>
            )
          ) : (
            <div
              className={cn(
                "space-y-5 transition-opacity",
                q.isFetching && "opacity-70",
              )}
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
                <Stat
                  rotulo={r.rotulo_contagem}
                  valor={numero(r.total_linhas)}
                  icone={Hash}
                  tom="brand"
                />
                {numericas.map((c) => {
                  const t = r.totais[c.id];
                  const media = c.tipo === "numero";
                  return (
                    <Stat
                      key={c.id}
                      rotulo={media ? `${c.rotulo} (média)` : c.rotulo}
                      valor={formatar(media ? t.media : t.soma, c.tipo)}
                      icone={
                        c.tipo === "horas"
                          ? Clock
                          : c.tipo === "moeda"
                            ? Wallet
                            : Sigma
                      }
                      sub={
                        !media && t.media != null && r.total_linhas > 1
                          ? `média ${formatar(t.media, c.tipo)} por linha`
                          : undefined
                      }
                    />
                  );
                })}
              </div>

              {config.grafico.tipo !== "nenhum" &&
                (g && g.categorias.length > 0 ? (
                  <ChartCard
                    titulo={tituloGrafico}
                    subtitulo={
                      <>
                        Total {formatar(g.total, g.medida.tipo)}
                        {g.outros > 0 &&
                          ` · ${g.outros} agrupados em “Outros”`}{" "}
                        · clique no gráfico para filtrar e descer um nível
                      </>
                    }
                  >
                    <GraficoRelatorio g={g} onClicar={filtrarPor} />
                  </ChartCard>
                ) : (
                  <div className="card-surface grid h-40 place-items-center p-4 text-center text-sm text-muted-foreground">
                    {config.grafico.dimensao
                      ? "Nada para desenhar com estes filtros."
                      : "Escolha “Agrupar por” no painel para ver o gráfico."}
                  </div>
                ))}

              <section className="card-surface overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5 text-sm">
                  <p className="font-medium">
                    {numero(r.total_linhas)} {r.rotulo_contagem.toLowerCase()}
                    {r.truncado && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        mostrando os primeiros {numero(r.linhas.length)} · o
                        Excel leva tudo
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Clique no título da coluna para ordenar
                  </p>
                </div>
                {r.total_linhas === 0 ? (
                  <EmptyState
                    icone={BarChart3}
                    titulo="Nada encontrado"
                    descricao="Troque ou tire algum filtro."
                  />
                ) : (
                  <TabelaRelatorio
                    r={r}
                    ordenar={config.ordenar}
                    onOrdenar={(ordenar) => setConfig({ ...config, ordenar })}
                  />
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      <SalvarDialog
        aberto={salvar !== null}
        onClose={() => setSalvar(null)}
        fonte={fonte.id}
        config={config}
        sugestao={salvo ? `${salvo.nome} (cópia)` : titulo}
        onSalvo={(s) => {
          qc.invalidateQueries({ queryKey: ["relatorios", "catalogo"] });
          router.push(`/relatorios/s${s.id}`);
        }}
      />
    </div>
  );
}

function SalvarDialog({
  aberto,
  onClose,
  fonte,
  config,
  sugestao,
  onSalvo,
}: {
  aberto: boolean;
  onClose: () => void;
  fonte: string;
  config: ConfigRelatorio;
  sugestao: string;
  onSalvo: (s: Salvo) => void;
}) {
  const [f, setF] = useState({ nome: "", descricao: "", compartilhado: false });
  const [aberto_, setAberto_] = useState(false);
  if (aberto && !aberto_) {
    setAberto_(true);
    setF({ nome: sugestao, descricao: "", compartilhado: false });
  }
  if (!aberto && aberto_) setAberto_(false);
  const m = useMutation({
    mutationFn: () =>
      api.post<Salvo>("/relatorios/salvos", {
        ...f,
        nome: f.nome.trim(),
        descricao: f.descricao.trim() || null,
        fonte,
        config,
      }),
    onSuccess: (s) => {
      toast.success(`“${s.nome}” salvo em Meus relatórios`);
      onClose();
      onSalvo(s);
    },
  });
  return (
    <FormDialog
      open={aberto}
      onOpenChange={(o) => !o && onClose()}
      titulo="Salvar relatório"
      descricao="Fica em Relatórios › Meus relatórios com as colunas, os filtros e o gráfico de agora."
      salvando={m.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field label="Nome" obrigatorio htmlFor="rel-nome">
        <Input
          id="rel-nome"
          value={f.nome}
          onChange={(e) => setF({ ...f, nome: e.target.value })}
          maxLength={120}
          required
          minLength={2}
          autoFocus
        />
      </Field>
      <Field label="Descrição" htmlFor="rel-desc">
        <Textarea
          id="rel-desc"
          value={f.descricao}
          onChange={(e) => setF({ ...f, descricao: e.target.value })}
          maxLength={300}
          rows={2}
        />
      </Field>
      <SwitchRow
        titulo="Compartilhar com o escritório"
        descricao="Todos veem e usam; só você (ou um administrador) altera."
      >
        <Switch
          checked={f.compartilhado}
          onCheckedChange={(v) => setF({ ...f, compartilhado: v })}
        />
      </SwitchRow>
    </FormDialog>
  );
}
