"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BriefcaseBusiness, Check, Copy, Eye, Loader2, MoreHorizontal, Pencil, Plus, Table2, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AreasAtuacao, CamposAdicionaisConfig } from "@/components/faturamento/config-ficha";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CargoOut, TabelaOut } from "@/lib/faturamento";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const paraBr = (v: string | number) => toNum(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const paraApi = (s: string) => String(toNum(s.replace(/\./g, "").replace(",", ".")));
const valido = (s: string) => /^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s.trim());

// ---------------------------------------------------------------- cargos
function Cargos() {
  const qc = useQueryClient();
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api.get<CargoOut[]>("/config/cargos") });
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<{ id: number; nome: string } | null>(null);
  const [excluir, setExcluir] = useState<CargoOut | null>(null);
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["cargos"] });
    qc.invalidateQueries({ queryKey: ["usuarios"] });
    qc.invalidateQueries({ queryKey: ["fat"] });
  };
  const lista = cargos.data ?? [];
  const criar = useMutation({
    mutationFn: () => api.post<CargoOut>("/config/cargos", { nome: novo.trim(), ordem: (lista.at(-1)?.ordem ?? 0) + 1, ativo: true }),
    onSuccess: (c) => {
      toast.success(`Cargo “${c.nome}” criado`);
      setNovo("");
      invalidar();
    },
  });
  const salvar = useMutation({
    mutationFn: (c: CargoOut) => api.put<CargoOut>(`/config/cargos/${c.id}`, { nome: c.nome, ordem: c.ordem, ativo: c.ativo }),
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/config/cargos/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      invalidar();
    },
  });
  const mover = async (i: number, d: -1 | 1) => {
    const a = lista[i];
    const b = lista[i + d];
    if (!a || !b) return;
    // reescreve a ordem inteira para não depender de valores repetidos
    const nova = [...lista];
    nova[i] = b;
    nova[i + d] = a;
    await Promise.all(nova.map((c, k) => (c.ordem !== k + 1 ? api.put(`/config/cargos/${c.id}`, { nome: c.nome, ordem: k + 1, ativo: c.ativo }) : null)));
    invalidar();
  };

  return (
    <section className="card-surface overflow-hidden" aria-labelledby="cargos-t">
      <header className="flex items-start gap-3 border-b p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
          <BriefcaseBusiness className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="cargos-t" className="font-semibold">
            Cargos
          </h2>
          <p className="text-sm text-muted-foreground">A categoria de cada profissional. As tabelas de preço dão um valor/hora por cargo.</p>
        </div>
      </header>
      <form
        className="flex gap-2 border-b bg-muted/30 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (novo.trim().length >= 2) criar.mutate();
        }}
      >
        <Input aria-label="Nome do novo cargo" value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo cargo, ex.: Sócio, Advogado pleno, Estagiário" />
        <Button type="submit" disabled={novo.trim().length < 2 || criar.isPending}>
          {criar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
        </Button>
      </form>
      {cargos.isPending ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <EmptyState icone={BriefcaseBusiness} titulo="Nenhum cargo ainda" descricao="Comece pelos cargos da equipe (Sócio, Advogado, Estagiário…) para montar as tabelas de preço." />
      ) : (
        <ul className="divide-y">
          {lista.map((c, i) => (
            <li key={c.id} className={cn("group flex items-center gap-2 px-3 py-2", !c.ativo && "opacity-60")}>
              <div className="flex flex-col opacity-40 transition group-hover:opacity-100">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                  <ArrowUp className="size-3" />
                </button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                  <ArrowDown className="size-3" />
                </button>
              </div>
              {editando?.id === c.id ? (
                <form
                  className="flex flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editando.nome.trim().length >= 2) salvar.mutate({ ...c, nome: editando.nome.trim() });
                  }}
                >
                  <Input aria-label="Nome do cargo" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} className="h-8" autoFocus onKeyDown={(e) => e.key === "Escape" && setEditando(null)} />
                  <Button type="submit" size="icon-sm" aria-label="Salvar" disabled={salvar.isPending}>
                    <Check />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditando(null)}>
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-sm font-medium" onDoubleClick={() => setEditando({ id: c.id, nome: c.nome })}>
                    {c.nome}
                  </button>
                  {!c.ativo && <Pill tom="neutral">inativo</Pill>}
                  <Link
                    href="/configuracoes/usuarios"
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                    title="Profissionais ativos neste cargo"
                  >
                    <Users className="size-3" /> {c.qtd_funcionarios}
                  </Link>
                  <Switch checked={c.ativo} onCheckedChange={(v) => salvar.mutate({ ...c, ativo: v })} aria-label={`${c.nome} ativo`} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${c.nome}`} onClick={() => setEditando({ id: c.id, nome: c.nome })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${c.nome}`} onClick={() => setExcluir(c)}>
                    <Trash2 />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o cargo “${excluir?.nome ?? ""}”?`}
        descricao="Se houver profissionais ou tabelas de preço usando este cargo, ele só é desativado."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </section>
  );
}

// ---------------------------------------------------------------- tabela de preço
function TabelaDialog({
  open,
  onOpenChange,
  tabela,
  base,
  cargos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tabela: TabelaOut | null;
  /** duplicar: copia os valores desta tabela */
  base: TabelaOut | null;
  cargos: CargoOut[];
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [valores, setValores] = useState<Record<number, string>>({});
  const [reajuste, setReajuste] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    const fonte = tabela ?? base;
    setNome(tabela ? tabela.nome : base ? `${base.nome} (cópia)` : "");
    setAtivo(tabela ? tabela.ativo : true);
    setValores(Object.fromEntries((fonte?.itens ?? []).map((i) => [i.cargo_id, paraBr(i.valor_hora)])));
    setReajuste("");
  }, [open, tabela, base]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visiveis = cargos.filter((c) => c.ativo || valores[c.id]);
  const invalidos = Object.entries(valores).filter(([, v]) => v.trim() && !valido(v));
  const preenchidos = Object.values(valores).filter((v) => v.trim()).length;

  const aplicarReajuste = () => {
    const p = toNum(reajuste.replace(",", "."));
    if (!p) return;
    setValores((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim() && valido(v) ? paraBr(toNum(paraApi(v)) * (1 + p / 100)) : v])));
    toast.success(`Reajuste de ${p.toLocaleString("pt-BR")}% aplicado. Revise e salve.`);
    setReajuste("");
  };

  const salvar = useMutation({
    mutationFn: () => {
      const body = {
        nome: nome.trim(),
        ativo,
        itens: Object.entries(valores)
          .filter(([, v]) => v.trim())
          .map(([k, v]) => ({ cargo_id: Number(k), valor_hora: paraApi(v) })),
      };
      return tabela ? api.put<TabelaOut>(`/faturamento/tabelas/${tabela.id}`, body) : api.post<TabelaOut>("/faturamento/tabelas", body);
    },
    onSuccess: (t) => {
      toast.success(tabela ? "Tabela atualizada" : `Tabela “${t.nome}” criada`);
      qc.invalidateQueries({ queryKey: ["fat"] });
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={tabela ? `Editar ${tabela.nome}` : base ? `Duplicar ${base.nome}` : "Nova tabela de preço"}
      descricao="Valor/hora de cada cargo. Cargo em branco fica fora da tabela, e as horas dele aparecem com aviso em Itens a faturar."
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={tabela ? "Salvar tabela" : "Criar tabela"}
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim().length < 2) return toast.error("Dê um nome à tabela.");
        if (invalidos.length) return toast.error("Há valores inválidos. Use o formato 450,00.");
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={ativo} onCheckedChange={setAtivo} aria-label="Tabela ativa" /> Ativa
        </label>
      }
    >
      <div className="space-y-4">
        <Field label="Nome da tabela" obrigatorio htmlFor="tabela-nome">
          <Input id="tabela-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Tabela padrão 2026, Contencioso, Cliente estratégico" autoFocus />
        </Field>
        {visiveis.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Cadastre os cargos ao lado antes de montar a tabela.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>
                {preenchidos} de {visiveis.length} cargos com valor
              </span>
              <span className="flex items-center gap-1.5">
                <label htmlFor="tabela-reajuste">Reajustar</label>
                <Input
                  id="tabela-reajuste"
                  value={reajuste}
                  onChange={(e) => setReajuste(e.target.value.replace(/[^\d,.-]/g, ""))}
                  className="h-7 w-16 text-right"
                  placeholder="%"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      aplicarReajuste();
                    }
                  }}
                />
                <Button type="button" variant="outline" size="xs" onClick={aplicarReajuste} disabled={!reajuste}>
                  Aplicar
                </Button>
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Cargo</th>
                  <th>Valor/hora</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visiveis.map((c) => {
                  const v = valores[c.id] ?? "";
                  const erro = v.trim() && !valido(v);
                  return (
                    <tr key={c.id} className={cn(!v.trim() && "bg-muted/20")}>
                      <td className="px-3 py-2">
                        <label htmlFor={`tabela-cargo-${c.id}`} className="font-medium">
                          {c.nome}
                        </label>
                        {!c.ativo && <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>}
                      </td>
                      <td className="w-48 px-3 py-1.5">
                        <div className="relative">
                          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                          <Input
                            id={`tabela-cargo-${c.id}`}
                            inputMode="decimal"
                            value={v}
                            onChange={(e) => setValores((o) => ({ ...o, [c.id]: e.target.value.replace(/[^\d,.]/g, "") }))}
                            onBlur={() => v.trim() && valido(v) && setValores((o) => ({ ...o, [c.id]: paraBr(paraApi(v)) }))}
                            placeholder="fora da tabela"
                            aria-invalid={!!erro}
                            className="h-8 pr-10 pl-8 text-right font-mono"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">/h</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FormDialog>
  );
}

function Tabelas() {
  const qc = useQueryClient();
  const tabelas = useQuery({ queryKey: ["fat", "tabelas"], queryFn: () => api.get<TabelaOut[]>("/faturamento/tabelas") });
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api.get<CargoOut[]>("/config/cargos") });
  const [dialogo, setDialogo] = useState<{ tabela: TabelaOut | null; base: TabelaOut | null } | null>(null);
  const [excluir, setExcluir] = useState<TabelaOut | null>(null);
  const [inativas, setInativas] = useState(false);
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/faturamento/tabelas/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const todas = tabelas.data ?? [];
  const lista = todas.filter((t) => inativas || t.ativo);
  const listaCargos = cargos.data ?? [];
  const linhas = listaCargos.filter((c) => c.ativo || lista.some((t) => t.itens.some((i) => i.cargo_id === c.id)));
  const valor = (t: TabelaOut, cid: number) => t.itens.find((i) => i.cargo_id === cid)?.valor_hora;

  return (
    <section className="card-surface overflow-hidden" aria-labelledby="tabelas-t">
      <header className="flex flex-wrap items-start gap-3 border-b p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success-ink">
          <Table2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="tabelas-t" className="font-semibold">
            Tabelas de preço
          </h2>
          <p className="text-sm text-muted-foreground">Valor/hora por cargo. O contrato escolhe a tabela, e o caso pode trocar.</p>
        </div>
        <div className="flex items-center gap-3">
          {todas.some((t) => !t.ativo) && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={inativas} onChange={(e) => setInativas(e.target.checked)} className="accent-[var(--brand)]" /> Inativas
            </label>
          )}
          <Button onClick={() => setDialogo({ tabela: null, base: null })} disabled={listaCargos.length === 0}>
            <Plus /> Nova tabela
          </Button>
        </div>
      </header>

      {tabelas.isPending || cargos.isPending ? (
        <Skeleton className="m-4 h-48 rounded-xl" />
      ) : lista.length === 0 ? (
        <EmptyState
          icone={Table2}
          titulo="Nenhuma tabela de preço"
          descricao={listaCargos.length === 0 ? "Cadastre os cargos primeiro, depois monte a tabela com o valor/hora de cada um." : "Monte a primeira tabela com o valor/hora de cada cargo."}
          acao={
            listaCargos.length > 0 && (
              <Button onClick={() => setDialogo({ tabela: null, base: null })}>
                <Plus /> Criar tabela
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th scope="col" className="sticky left-0 z-10 min-w-40 bg-muted/90 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground backdrop-blur">
                  Cargo
                </th>
                {lista.map((t) => (
                  <th key={t.id} scope="col" className={cn("min-w-44 px-3 py-2 text-right align-bottom", !t.ativo && "opacity-60")}>
                    <div className="flex items-center justify-end gap-1">
                      <span className="truncate font-semibold" title={t.nome}>
                        {t.nome}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Ações da tabela ${t.nome}`} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setDialogo({ tabela: t, base: null })}>
                            <Pencil /> Editar valores
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDialogo({ tabela: null, base: t })}>
                            <Copy /> Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setExcluir(t)}>
                            <Trash2 /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <p className="text-[11px] font-normal text-muted-foreground">
                      {t.ativo ? `${t.itens.length} cargo(s)` : "inativa"}
                    </p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {linhas.map((c) => (
                <tr key={c.id} className="hover:bg-accent/30">
                  <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-2.5 text-left font-medium">
                    {c.nome}
                    {!c.ativo && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(inativo)</span>}
                  </th>
                  {lista.map((t) => {
                    const v = valor(t, c.id);
                    return (
                      <td key={t.id} className={cn("px-3 py-2.5 text-right font-mono tabular-nums", !t.ativo && "opacity-60")}>
                        {v != null ? (
                          <button type="button" onClick={() => setDialogo({ tabela: t, base: null })} className="rounded px-1 hover:bg-muted">
                            {moeda(v)}
                            <span className="text-xs text-muted-foreground">/h</span>
                          </button>
                        ) : (
                          <button type="button" onClick={() => setDialogo({ tabela: t, base: null })} className="rounded px-1 text-xs font-sans text-warning-ink hover:bg-warning/10">
                            sem valor
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TabelaDialog open={!!dialogo} onOpenChange={(o) => !o && setDialogo(null)} tabela={dialogo?.tabela ?? null} base={dialogo?.base ?? null} cargos={listaCargos} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir a tabela “${excluir?.nome ?? ""}”?`}
        descricao="Se algum contrato, caso ou regra usa esta tabela, ela só é desativada e continua valendo para o que já usa."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </section>
  );
}

export default function ConfigFaturamentoPage() {
  const { pode } = useAuth();
  // consulta sem edição: os controles ficam desligados (cargos dependem de Profissionais)
  const fat = !pode("cfg_faturamento.editar");
  const cargos = !pode("cfg_profissionais.editar");
  return (
    <Tabs defaultValue="precos">
      {fat && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-info/30 bg-info/8 px-3.5 py-2.5 text-sm text-info-ink">
          <Eye className="size-4 shrink-0" />
          Seu perfil de acesso permite consultar esta configuração, mas não alterá-la.
        </p>
      )}
      <TabsList className="mb-4">
        <TabsTrigger value="precos">Cargos e tabelas de preço</TabsTrigger>
        <TabsTrigger value="areas">Áreas de atuação</TabsTrigger>
        <TabsTrigger value="campos">Campos adicionais</TabsTrigger>
      </TabsList>
      <TabsContent value="precos">
        <div className="grid gap-5 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] xl:items-start">
          <fieldset disabled={cargos} className="min-w-0">
            <Cargos />
          </fieldset>
          <fieldset disabled={fat} className="min-w-0">
            <Tabelas />
          </fieldset>
        </div>
      </TabsContent>
      <TabsContent value="areas" className="max-w-3xl">
        <fieldset disabled={fat} className="min-w-0">
          <AreasAtuacao />
        </fieldset>
      </TabsContent>
      <TabsContent value="campos" className="max-w-4xl">
        <fieldset disabled={fat} className="min-w-0">
          <CamposAdicionaisConfig />
        </fieldset>
      </TabsContent>
    </Tabs>
  );
}
