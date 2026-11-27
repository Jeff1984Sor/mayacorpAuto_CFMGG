"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  type Catalogo,
  ICONES,
  type Pronto,
  type Salvo,
} from "@/lib/relatorios";

const GRUPOS: { id: Pronto["grupo"]; titulo: string; descricao: string }[] = [
  {
    id: "Clientes",
    titulo: "Clientes",
    descricao: "Horas, contratos e regras de cobrança de cada cliente",
  },
  {
    id: "Casos",
    titulo: "Casos",
    descricao: "Processos, foro, carteira, agenda e pauta de audiências",
  },
  {
    id: "Financeiro",
    titulo: "Financeiro",
    descricao: "Despesas, faturamento, recebimento e horas faturadas",
  },
];

const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export default function RelatoriosPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["relatorios", "catalogo"],
    queryFn: () => api.get<Catalogo>("/relatorios/catalogo"),
  });
  const [busca, setBusca] = useState("");
  const [excluir, setExcluir] = useState<Salvo | null>(null);
  const del = useMutation({
    mutationFn: (s: Salvo) => api.del(`/relatorios/salvos/${s.id}`),
    onSuccess: () => {
      toast.success("Relatório excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["relatorios", "catalogo"] });
    },
  });
  const c = q.data;
  const casa = (t: string) => !busca || semAcento(t).includes(semAcento(busca));
  const fonteNome = (id: string) =>
    c?.fontes.find((f) => f.id === id)?.nome ?? id;
  const salvos = (c?.salvos ?? []).filter((s) =>
    casa(`${s.nome} ${s.descricao ?? ""}`),
  );

  return (
    <div>
      <PageHeader
        titulo="Relatórios"
        icone={BarChart3}
        descricao="Abra um relatório pronto, escolha as colunas, filtre e clique no gráfico para descer nos detalhes. Salve do seu jeito e leve para o Excel."
        acoes={
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Procurar relatório…"
              className="pl-9"
              aria-label="Procurar relatório"
            />
          </div>
        }
      />

      {!c ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <Link
            href="/relatorios/novo"
            className="card-surface group relative flex items-center gap-4 overflow-hidden p-5 ring-1 ring-brand/25 transition-shadow hover:shadow-[0_12px_40px_-20px_var(--brand)]"
          >
            <div
              className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand/12 blur-3xl"
              aria-hidden
            />
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand text-white">
              <Wand2 className="size-6" />
            </span>
            <div className="relative min-w-0">
              <p className="font-semibold">Gerador de relatório</p>
              <p className="text-sm text-muted-foreground">
                Comece do zero: escolha a base (
                {c.fontes
                  .map((f) => f.nome.split(" (")[0].toLowerCase())
                  .join(", ")}
                ), as colunas, os filtros e o gráfico.
              </p>
            </div>
          </Link>

          {salvos.length > 0 && (
            <section>
              <h2 className="mb-1 flex items-center gap-2 font-semibold">
                <Sparkles className="size-4 text-brand" /> Meus relatórios
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Os que você salvou e os compartilhados pelo escritório
              </p>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {salvos.map((s) => (
                  <div
                    key={s.id}
                    className="card-surface group relative flex gap-3 p-4 transition-colors hover:bg-accent/30"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
                      <BarChart3 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/relatorios/s${s.id}`}
                        className="font-medium after:absolute after:inset-0 hover:underline"
                      >
                        {s.nome}
                      </Link>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {s.descricao || fonteNome(s.fonte)}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {s.compartilhado && (
                          <Pill tom="info">
                            <Share2 className="size-3" /> compartilhado
                          </Pill>
                        )}
                        {!s.meu && s.autor && (
                          <Pill tom="neutral">de {s.autor}</Pill>
                        )}
                      </div>
                    </div>
                    {s.meu && (
                      <button
                        type="button"
                        onClick={() => setExcluir(s)}
                        aria-label={`Excluir ${s.nome}`}
                        className="relative z-10 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger-ink focus-visible:opacity-100"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {GRUPOS.map((gr) => {
            const lista = c.prontos.filter(
              (p) => p.grupo === gr.id && casa(`${p.nome} ${p.descricao}`),
            );
            if (lista.length === 0) return null;
            return (
              <section
                key={gr.id}
                id={gr.id.toLowerCase()}
                className="scroll-mt-4"
              >
                <h2 className="font-semibold">{gr.titulo}</h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  {gr.descricao}
                </p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {lista.map((p) => {
                    const I = ICONES[p.icone] ?? BarChart3;
                    return (
                      <Link
                        key={p.id}
                        href={`/relatorios/${p.id}`}
                        className="card-surface flex gap-3 p-4 transition-colors hover:bg-accent/30"
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground/80">
                          <I className="size-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium">{p.nome}</p>
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {p.descricao}
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir “${excluir?.nome}”?`}
        descricao={
          excluir?.compartilhado
            ? "Ele some para todo o escritório."
            : "Só a configuração é apagada; os dados continuam."
        }
        confirmar="Excluir"
        destrutivo
        carregando={del.isPending}
        onConfirm={() => excluir && del.mutate(excluir)}
      />
    </div>
  );
}
