"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { ConstrutorRelatorio } from "@/components/relatorios/construtor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  type Catalogo,
  type ConfigRelatorio,
  configPadrao,
  type FonteMeta,
  ICONES,
} from "@/lib/relatorios";

/** Filtros vindos do endereço (?cliente=Nome&caso=...): viram filtros de lista na abertura. */
function comFiltrosDaUrl(
  cfg: ConfigRelatorio,
  fonte: FonteMeta,
  sp: URLSearchParams,
): ConfigRelatorio {
  const extras = [...sp.entries()].filter(
    ([k, v]) => v && k !== "fonte" && fonte.colunas.some((c) => c.id === k),
  );
  if (!extras.length) return cfg;
  const tirar = new Set(extras.map(([k]) => k));
  return {
    ...cfg,
    filtros: [
      ...cfg.filtros.filter((f) => !tirar.has(f.coluna)),
      ...extras.map(([k, v]) => ({ coluna: k, valores: [v] })),
    ],
  };
}

export default function RelatorioPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const q = useQuery({
    queryKey: ["relatorios", "catalogo"],
    queryFn: () => api.get<Catalogo>("/relatorios/catalogo"),
  });
  const c = q.data;
  if (!c) return <Skeleton className="h-[480px] rounded-2xl" />;

  const fonteDe = (fid: string) => c.fontes.find((f) => f.id === fid);

  if (id === "novo") {
    const fonte = fonteDe(sp.get("fonte") ?? "");
    if (!fonte)
      return (
        <div>
          <PageHeader
            titulo="Gerador de relatório"
            icone={Wand2}
            descricao="Primeiro, de onde vêm os dados?"
            migalhas={[
              { label: "Relatórios", href: "/relatorios" },
              { label: "Gerador" },
            ]}
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {c.fontes.map((f) => {
              const I = ICONES[f.icone] ?? BarChart3;
              return (
                <Link
                  key={f.id}
                  href={`/relatorios/novo?fonte=${f.id}`}
                  className="card-surface flex gap-3 p-4 transition-colors hover:bg-accent/30"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
                    <I className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{f.nome}</p>
                    <p className="text-sm text-muted-foreground">
                      {f.descricao}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {f.colunas.length} colunas
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      );
    return (
      <ConstrutorRelatorio
        key={`novo-${fonte.id}`}
        fonte={fonte}
        inicial={comFiltrosDaUrl(configPadrao(fonte), fonte, sp)}
        titulo={`Relatório de ${fonte.nome.split(" (")[0].toLowerCase()}`}
        migalha="Gerador"
      />
    );
  }

  const salvo = id.startsWith("s")
    ? c.salvos.find((s) => `s${s.id}` === id)
    : undefined;
  const pronto = c.prontos.find((p) => p.id === id);
  const fonte = fonteDe(salvo?.fonte ?? pronto?.fonte ?? "");
  if (!fonte || (!salvo && !pronto))
    return (
      <div className="card-surface">
        <EmptyState
          icone={BarChart3}
          titulo="Relatório não encontrado"
          descricao="Ele pode ter sido excluído, ou o seu perfil não tem acesso a esses dados."
          acao={
            <Button variant="outline" render={<Link href="/relatorios" />}>
              Ver os relatórios
            </Button>
          }
        />
      </div>
    );
  const base = (salvo?.config ?? pronto!.config) as ConfigRelatorio;
  const inicial: ConfigRelatorio = {
    colunas: base.colunas ?? [],
    filtros: base.filtros ?? [],
    grafico: base.grafico ?? { tipo: "barras_h" },
    ordenar: base.ordenar ?? [],
  };
  return (
    <ConstrutorRelatorio
      key={`${id}-${sp.toString()}`}
      fonte={fonte}
      inicial={comFiltrosDaUrl(inicial, fonte, sp)}
      titulo={salvo?.nome ?? pronto!.nome}
      descricao={salvo?.descricao ?? pronto?.descricao}
      salvo={salvo}
      migalha={salvo ? "Meus relatórios" : pronto?.grupo}
    />
  );
}
