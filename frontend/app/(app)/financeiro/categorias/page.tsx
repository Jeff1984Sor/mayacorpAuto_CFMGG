"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronRight, FolderTree, ListChecks, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useCategoriasFin } from "@/components/financeiro/comum";
import { SearchInput } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type CategoriaOut, type GrupoDre, ROTULO_GRUPO_DRE, type SubcategoriaOut, type TipoCategoria } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

const CORES = ["#7C8FFF", "#1E2D6B", "#1A8F5E", "#F5A623", "#C94343", "#0EA5E9", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B"];

/** Texto editável no lugar (Enter salva, Esc cancela). */
function NomeEditavel({ valor, onSalvar, rotulo, desabilitado, className }: { valor: string; onSalvar: (v: string) => void; rotulo: string; desabilitado?: boolean; className?: string }) {
  const [ed, setEd] = useState<string | null>(null);
  if (ed === null)
    return (
      <span className={cn("group/n inline-flex min-w-0 items-center gap-1", className)}>
        <span className="truncate">{valor}</span>
        {!desabilitado && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEd(valor);
            }}
            aria-label={`Renomear ${rotulo}`}
            className="rounded p-0.5 text-muted-foreground opacity-0 transition group-hover/n:opacity-100 hover:bg-muted focus-visible:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        )}
      </span>
    );
  const salvar = () => {
    const v = ed.trim();
    if (v && v !== valor) onSalvar(v);
    setEd(null);
  };
  return (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <Input
        aria-label={`Novo nome de ${rotulo}`}
        value={ed}
        onChange={(e) => setEd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") salvar();
          if (e.key === "Escape") setEd(null);
        }}
        onBlur={salvar}
        className="h-7 w-56"
        autoFocus
      />
    </span>
  );
}

function CorPicker({ cor, onChange, rotulo, desabilitado }: { cor: string | null; onChange: (c: string) => void; rotulo: string; desabilitado?: boolean }) {
  const [aberto, setAberto] = useState(false);
  return (
    <span className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setAberto((a) => !a)}
        aria-label={`Cor de ${rotulo}`}
        className="block size-3.5 rounded-full ring-1 ring-black/10 disabled:cursor-default"
        style={{ background: cor ?? "var(--muted)" }}
      />
      {aberto && (
        <span className="absolute top-5 left-0 z-20 flex w-44 flex-wrap gap-1.5 rounded-xl border bg-popover p-2 shadow-lg">
          {CORES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                onChange(c);
                setAberto(false);
              }}
              aria-label={`Usar ${c}`}
              className={cn("size-6 rounded-full", cor?.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground ring-offset-1")}
              style={{ background: c }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

function Bloco({
  titulo,
  tipo,
  cats,
  selecao,
  sel,
  marcar,
  podeEditar,
  destaque,
}: {
  titulo: string;
  tipo?: TipoCategoria;
  cats: CategoriaOut[];
  selecao: boolean;
  sel: { cats: Set<number>; subs: Set<number> };
  marcar: (k: "cats" | "subs", id: number, v: boolean) => void;
  podeEditar: boolean;
  destaque?: boolean;
}) {
  const qc = useQueryClient();
  const [nova, setNova] = useState("");
  const [recolhido, setRecolhido] = useState(false);
  const qtdItens = cats.reduce((n, c) => n + c.subcategorias.length, 0);
  const [novaSub, setNovaSub] = useState<Record<number, string>>({});
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fin"] });
  const salvarCat = useMutation({
    mutationFn: (c: CategoriaOut) => api.put(`/financeiro/categorias/${c.id}`, { nome: c.nome, tipo: c.tipo, grupo_dre: c.grupo_dre, cor: c.cor, ativo: c.ativo }),
    onSuccess: invalidar,
  });
  const criarCat = useMutation({
    mutationFn: () => api.post<CategoriaOut>("/financeiro/categorias", { nome: nova.trim(), tipo, grupo_dre: tipo === "receita" ? "receita_bruta" : null, cor: null, ativo: true }),
    onSuccess: (c) => {
      toast.success(`Categoria “${c.nome}” criada`);
      setNova("");
      invalidar();
    },
  });
  const excluirCat = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/financeiro/categorias/${id}`),
    onSuccess: (r) => (toast.success(r.mensagem), invalidar()),
  });
  const criarSub = useMutation({
    mutationFn: ({ cid, nome }: { cid: number; nome: string }) => api.post(`/financeiro/categorias/${cid}/subcategorias`, { nome, ativo: true }),
    onSuccess: (_r, v) => {
      setNovaSub((o) => ({ ...o, [v.cid]: "" }));
      invalidar();
    },
  });
  const salvarSub = useMutation({ mutationFn: (s: SubcategoriaOut) => api.put(`/financeiro/subcategorias/${s.id}`, { nome: s.nome, ativo: s.ativo }), onSuccess: invalidar });
  const excluirSub = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/financeiro/subcategorias/${id}`),
    onSuccess: (r) => (toast.success(r.mensagem), invalidar()),
  });

  return (
    <section className={cn("card-surface overflow-hidden", destaque && "ring-1 ring-warning/40")} aria-label={titulo}>
      <header className={cn("flex flex-wrap items-center gap-2 border-b px-4 py-3", tipo === "despesa" && "bg-danger/5", tipo === "receita" && "bg-success/5", destaque && "bg-warning/8")}>
        <button type="button" onClick={() => setRecolhido((r) => !r)} aria-expanded={!recolhido} aria-label={`${recolhido ? "Abrir" : "Recolher"} ${titulo}`} className="rounded p-0.5 hover:bg-muted">
          <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", !recolhido && "rotate-90")} />
        </button>
        {destaque && <AlertTriangle className="size-4 text-warning-ink" />}
        <span className={cn("size-2.5 rounded-full", tipo === "despesa" ? "bg-danger" : tipo === "receita" ? "bg-success" : "bg-warning")} />
        <h2 className="text-base font-semibold">{titulo}</h2>
        <span className="text-xs text-muted-foreground">
          {cats.length} categoria(s) · {qtdItens} subcategoria(s)
        </span>
        {tipo && podeEditar && (
          <form
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (nova.trim().length >= 2) criarCat.mutate();
            }}
          >
            <Input aria-label={`Nova categoria de ${titulo.toLowerCase()}`} value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova categoria" className="h-8 w-48" />
            <Button type="submit" size="sm" disabled={nova.trim().length < 2 || criarCat.isPending}>
              {criarCat.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
            </Button>
          </form>
        )}
      </header>
      {destaque && <p className="border-b bg-warning/5 px-4 py-2 text-xs text-muted-foreground">Nomes com vírgula costumam ser dois campos colados na planilha. Renomeie, junte ou exclua.</p>}
      {recolhido ? null : cats.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma categoria{tipo ? "" : " para revisar"}.</p>
      ) : (
        <ul className="pb-1 text-sm">
          {cats.map((c) => {
            const emUso = c.uso_contas + c.uso_lancamentos > 0;
            const podeExcluir = !emUso && c.subcategorias.length === 0;
            return (
              <li key={c.id} className={cn(!c.ativo && "opacity-60")}>
                {/* categoria */}
                <div className="group/c flex items-center gap-2 border-b border-dotted py-1.5 pr-3 pl-9 hover:bg-accent/40">
                  {selecao && <Checkbox checked={sel.cats.has(c.id)} onCheckedChange={(v) => marcar("cats", c.id, !!v)} aria-label={`Selecionar ${c.nome}`} />}
                  <CorPicker cor={c.cor} rotulo={c.nome} desabilitado={!podeEditar} onChange={(cor) => salvarCat.mutate({ ...c, cor })} />
                  <NomeEditavel valor={c.nome} rotulo={c.nome} desabilitado={!podeEditar} onSalvar={(nome) => salvarCat.mutate({ ...c, nome })} className="min-w-0 flex-1 font-semibold" />
                  {c.revisar && !destaque && <Pill tom="warning">revisar</Pill>}
                  {!c.grupo_dre && <Pill tom="warning">sem DRE</Pill>}
                  <NativeSelect
                    aria-label={`Grupo da DRE de ${c.nome}`}
                    value={c.grupo_dre ?? ""}
                    disabled={!podeEditar}
                    onChange={(e) => salvarCat.mutate({ ...c, grupo_dre: (e.target.value || null) as GrupoDre | null })}
                    className="h-7 w-52 border-transparent bg-transparent text-xs text-muted-foreground shadow-none group-hover/c:border-input focus-visible:border-input"
                  >
                    <option value="">DRE: não classificado</option>
                    {Object.entries(ROTULO_GRUPO_DRE).map(([k, l]) => (
                      <option key={k} value={k}>
                        DRE: {l}
                      </option>
                    ))}
                  </NativeSelect>
                  {podeEditar && (
                    <span className="flex w-16 items-center justify-end gap-1 opacity-0 transition group-hover/c:opacity-100 focus-within:opacity-100">
                      <Switch size="sm" checked={c.ativo} onCheckedChange={(v) => salvarCat.mutate({ ...c, ativo: v })} aria-label={`${c.nome} ativa`} />
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        disabled={!podeExcluir || excluirCat.isPending}
                        title={emUso ? "Em uso: desative em vez de excluir" : c.subcategorias.length ? "Exclua as subcategorias antes" : "Excluir categoria"}
                        aria-label={`Excluir ${c.nome}`}
                        onClick={() => excluirCat.mutate(c.id)}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
                {/* subcategorias logo abaixo */}
                <ul>
                  {c.subcategorias.map((s) => (
                    <li key={s.id} className={cn("group/i flex items-center gap-2 border-b border-dotted py-1 pr-3 pl-14 hover:bg-accent/40", !s.ativo && "opacity-60")}>
                      {selecao ? (
                        <Checkbox checked={sel.subs.has(s.id)} onCheckedChange={(v) => marcar("subs", s.id, !!v)} aria-label={`Selecionar ${s.nome}`} />
                      ) : (
                        <span className="text-muted-foreground" aria-hidden>
                          –
                        </span>
                      )}
                      <NomeEditavel valor={s.nome} rotulo={s.nome} desabilitado={!podeEditar} onSalvar={(nome) => salvarSub.mutate({ ...s, nome })} className="min-w-0 flex-1" />
                      {s.uso > 0 && <span className="text-[11px] text-muted-foreground num">{s.uso} uso(s)</span>}
                      {podeEditar && (
                        <span className="flex w-16 items-center justify-end gap-1 opacity-0 transition group-hover/i:opacity-100 focus-within:opacity-100">
                          <Switch size="sm" checked={s.ativo} onCheckedChange={(v) => salvarSub.mutate({ ...s, ativo: v })} aria-label={`${s.nome} ativa`} />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={s.uso > 0 || excluirSub.isPending}
                            title={s.uso > 0 ? "Em uso: desative em vez de excluir" : "Excluir subcategoria"}
                            aria-label={`Excluir ${s.nome}`}
                            onClick={() => excluirSub.mutate(s.id)}
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                  {podeEditar && (
                    <li className="border-b border-dotted py-1 pr-3 pl-14">
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const nome = (novaSub[c.id] ?? "").trim();
                          if (nome) criarSub.mutate({ cid: c.id, nome });
                        }}
                      >
                        <Plus className="size-3.5 text-muted-foreground" aria-hidden />
                        <input
                          aria-label={`Nova subcategoria de ${c.nome}`}
                          value={novaSub[c.id] ?? ""}
                          onChange={(e) => setNovaSub((o) => ({ ...o, [c.id]: e.target.value }))}
                          placeholder="Nova subcategoria (Enter para salvar)"
                          className="h-6 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
                        />
                        {(novaSub[c.id] ?? "").trim() && (
                          <Button type="submit" size="xs" disabled={criarSub.isPending}>
                            Adicionar
                          </Button>
                        )}
                      </form>
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function CategoriasPage() {
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const q = useCategoriasFin();
  const [busca, setBusca] = useState("");
  const [selecao, setSelecao] = useState(false);
  const [sel, setSel] = useState({ cats: new Set<number>(), subs: new Set<number>() });
  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(
    () => (q.data ?? []).filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.subcategorias.some((s) => s.nome.toLowerCase().includes(termo))),
    [q.data, termo],
  );
  const revisar = filtradas.filter((c) => c.revisar);
  const normais = filtradas.filter((c) => !c.revisar);
  const semDre = (q.data ?? []).filter((c) => c.ativo && !c.grupo_dre).length;
  const marcar = (k: "cats" | "subs", id: number, v: boolean) =>
    setSel((o) => {
      const n = new Set(o[k]);
      if (v) n.add(id);
      else n.delete(id);
      return { ...o, [k]: n };
    });
  const lote = useMutation({
    mutationFn: () => api.post<{ excluidas: number; puladas: string[] }>("/financeiro/categorias/excluir-lote", { categoria_ids: [...sel.cats], subcategoria_ids: [...sel.subs] }),
    onSuccess: (r) => {
      if (r.puladas.length) toast.warning(`${r.excluidas} excluída(s). Ficaram ${r.puladas.length} em uso: ${r.puladas.slice(0, 6).join(", ")}${r.puladas.length > 6 ? "…" : ""}`, { duration: 9000 });
      else toast.success(`${r.excluidas} excluída(s)`);
      setSel({ cats: new Set(), subs: new Set() });
      setSelecao(false);
      qc.invalidateQueries({ queryKey: ["fin"] });
    },
  });
  const nSel = sel.cats.size + sel.subs.size;
  const props = { selecao, sel, marcar, podeEditar: isOperador };

  return (
    <div>
      <PageHeader
        titulo="Categorias e Subcategorias"
        icone={FolderTree}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Categorias" }]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar categoria ou subcategoria" className="sm:w-80" />
        {isOperador && (
          <div className="ml-auto flex items-center gap-2">
            {selecao && (
              <Button variant="destructive" size="sm" disabled={!nSel || lote.isPending} onClick={() => lote.mutate()}>
                {lote.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir selecionadas ({nSel})
              </Button>
            )}
            <Button
              variant={selecao ? "outline" : "ghost"}
              size="sm"
              onClick={() => {
                setSelecao((s) => !s);
                setSel({ cats: new Set(), subs: new Set() });
              }}
            >
              {selecao ? <X /> : <ListChecks />} {selecao ? "Cancelar seleção" : "Selecionar"}
            </Button>
          </div>
        )}
      </div>
      {semDre > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning-ink">
          <AlertTriangle className="size-4 shrink-0" /> {semDre} categoria(s) ativa(s) sem grupo da DRE aparecem como “Não classificado”. Escolha o grupo no seletor de cada uma.
        </p>
      )}
      {q.isPending ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (q.data ?? []).length === 0 ? (
        <div className="card-surface">
          <EmptyState icone={FolderTree} titulo="Nenhuma categoria" descricao="As categorias padrão são criadas ao abrir as contas bancárias." />
        </div>
      ) : (
        <div className="space-y-5">
          {revisar.length > 0 && <Bloco titulo="Vindas da importação — revisar" cats={revisar} destaque {...props} />}
          <Bloco titulo="Despesas" tipo="despesa" cats={normais.filter((c) => c.tipo === "despesa")} {...props} />
          <Bloco titulo="Receitas" tipo="receita" cats={normais.filter((c) => c.tipo === "receita")} {...props} />
          {selecao && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Check className="size-3.5" /> Itens em uso são pulados na exclusão em lote; desative-os.</p>}
        </div>
      )}
    </div>
  );
}
