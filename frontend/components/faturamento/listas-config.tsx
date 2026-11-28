"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, ListChecks, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { type CodigoLista, type ListaItemIn, type ListaItemOut, ROTULO_TIPO_DE_CASO, type TipoLista } from "@/lib/casos";
import { cn } from "@/lib/utils";

import { useListas, useOpcoesCaso } from "./caso/campos";

/** Onde cada lista aparece (uma linha, para quem configura). */
const ONDE: Record<CodigoLista, string> = {
  motivo_encerramento: "Motivo escolhido ao encerrar um caso.",
  origem: "De onde o caso veio (indicação, site, parceiro...).",
  centro_custo: "Para separar os casos no financeiro.",
  etiqueta: "Marcadores livres do caso.",
  classe: "Classe do processo, nos dados do contencioso.",
  assunto: "Assunto principal e outros assuntos do processo.",
  tipo_demanda: "O que o cliente pediu, nos dados do consultivo.",
  orgao: "Órgão público do procedimento administrativo.",
  tipo_procedimento: "Tipo do procedimento administrativo.",
};

/**
 * Configurações › Faturamento › Listas: o escritório mantém as listas usadas no caso (adiciona, renomeia, ordena e
 * desativa). Item padrão do sistema ou já usado em algum caso não é apagado: só desativado.
 */
export function ListasConfig() {
  const qc = useQueryClient();
  const tipos = useOpcoesCaso();
  const todas = useListas();
  const [lista, setLista] = useState<CodigoLista>("motivo_encerramento");
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<{ id: number; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<ListaItemOut | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat", "listas"] });
  const itens = (todas.data ?? []).filter((i) => i.lista === lista);
  const atual = tipos.data?.listas.find((t) => t.lista === lista);
  const corpo = (i: ListaItemOut, patch: Partial<ListaItemIn> = {}): ListaItemIn => ({ lista: i.lista, nome: i.nome, ordem: i.ordem, ativo: i.ativo, ...patch });

  const criar = useMutation({
    mutationFn: () => api.post<ListaItemOut>("/faturamento/listas", { lista, nome: novo.trim(), ordem: 0, ativo: true } satisfies ListaItemIn),
    onSuccess: (i) => {
      toast.success(`“${i.nome}” entrou na lista`);
      setNovo("");
      invalidar();
    },
  });
  const salvar = useMutation({
    mutationFn: (v: { item: ListaItemOut; patch: Partial<ListaItemIn> }) => api.put<ListaItemOut>(`/faturamento/listas/${v.item.id}`, corpo(v.item, v.patch)),
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
  });
  const remover = useMutation({
    mutationFn: (i: ListaItemOut) => api.del<{ mensagem: string }>(`/faturamento/listas/${i.id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      invalidar();
    },
  });
  const mover = async (i: number, d: -1 | 1) => {
    if (!itens[i] || !itens[i + d]) return;
    // reescreve a ordem inteira para não depender de valores repetidos
    const nova = [...itens];
    [nova[i], nova[i + d]] = [nova[i + d], nova[i]];
    try {
      await Promise.all(nova.map((x, k) => (x.ordem !== k + 1 ? api.put(`/faturamento/listas/${x.id}`, corpo(x, { ordem: k + 1 })) : null)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar a ordem.");
    }
    invalidar();
  };
  const grupos: { titulo: string; listas: TipoLista[] }[] = [
    { titulo: "Todos os casos", listas: (tipos.data?.listas ?? []).filter((t) => !t.tipo_caso) },
    ...(["contencioso", "consultivo", "administrativo"] as const).map((t) => ({ titulo: ROTULO_TIPO_DE_CASO[t], listas: (tipos.data?.listas ?? []).filter((x) => x.tipo_caso === t) })),
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
      <nav className="card-surface p-2" aria-label="Listas">
        {tipos.isPending && <Skeleton className="h-64 rounded-xl" />}
        {grupos.map(
          (g) =>
            g.listas.length > 0 && (
              <div key={g.titulo} className="mb-2 last:mb-0">
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.titulo}</p>
                {g.listas.map((t) => {
                  const n = (todas.data ?? []).filter((i) => i.lista === t.lista && i.ativo).length;
                  return (
                    <button
                      key={t.lista}
                      type="button"
                      aria-current={lista === t.lista}
                      onClick={() => {
                        setLista(t.lista);
                        setEditando(null);
                        setNovo("");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                        lista === t.lista ? "bg-brand/10 font-medium text-info-ink" : "hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{t.nome}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
                    </button>
                  );
                })}
              </div>
            ),
        )}
      </nav>

      <section className="card-surface overflow-hidden" aria-labelledby="lista-t">
        <header className="flex items-start gap-3 border-b p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
            <ListChecks className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lista-t" className="font-semibold">
              {atual?.nome ?? "Lista"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {ONDE[lista]} Item padrão do sistema ou já usado em algum caso não é apagado: fica desativado e some das opções novas.
            </p>
          </div>
        </header>
        <form
          className="flex gap-2 border-b bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (novo.trim()) criar.mutate();
          }}
        >
          <Input aria-label="Nome do novo item" value={novo} maxLength={150} onChange={(e) => setNovo(e.target.value)} placeholder="Novo item da lista" />
          <Button type="submit" disabled={!novo.trim() || criar.isPending}>
            {criar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
          </Button>
        </form>
        {todas.isPending ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 rounded-lg" />
            ))}
          </div>
        ) : itens.length === 0 ? (
          <EmptyState icone={ListChecks} titulo="Lista vazia" descricao="Adicione o primeiro item no campo acima. Ele aparece na hora no formulário do caso." />
        ) : (
          <ul className="divide-y">
            {itens.map((c, i) => (
              <li key={c.id} className={cn("group flex items-center gap-2 px-3 py-2", !c.ativo && "bg-muted/20")}>
                <div className="flex flex-col opacity-40 transition group-hover:opacity-100">
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                    <ArrowUp className="size-3" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} aria-label={`Descer ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                    <ArrowDown className="size-3" />
                  </button>
                </div>
                {editando?.id === c.id ? (
                  <form
                    className="flex flex-1 items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editando.nome.trim()) salvar.mutate({ item: c, patch: { nome: editando.nome.trim() } });
                    }}
                  >
                    <Input aria-label="Nome do item" value={editando.nome} maxLength={150} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} className="h-8" autoFocus onKeyDown={(e) => e.key === "Escape" && setEditando(null)} />
                    <Button type="submit" size="icon-sm" aria-label="Salvar" disabled={salvar.isPending}>
                      <Check />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditando(null)}>
                      <X />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className={cn("min-w-0 flex-1 truncate text-sm", !c.ativo && "text-muted-foreground line-through")}>{c.nome}</span>
                    {c.sistema && <Pill tom="neutral">Padrão</Pill>}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch size="sm" checked={c.ativo} onCheckedChange={(v) => salvar.mutate({ item: c, patch: { ativo: v } })} aria-label={`${c.nome} ativo`} />
                      {c.ativo ? "Ativo" : "Desativado"}
                    </label>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Renomear ${c.nome}`} onClick={() => setEditando({ id: c.id, nome: c.nome })}>
                      <Pencil />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Excluir ${c.nome}`} disabled={c.sistema && !c.ativo} onClick={() => setExcluir(c)}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir “${excluir?.nome ?? ""}”?`}
        descricao={
          excluir?.sistema
            ? "Este é um item padrão do sistema: ele não é apagado, só desativado. Os casos que já usam continuam com ele."
            : "Se algum caso já usa este item, ele é só desativado (os casos continuam com ele). Sem uso, é apagado."
        }
        confirmar={excluir?.sistema ? "Desativar" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir)}
      />
    </div>
  );
}
