"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Eye, Layers, ListPlus, Loader2, Pencil, Plus, Shapes, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { AreaOut, CampoIn, CampoOut, TipoCampo, ValorCampo } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

import { CampoInput, TIPOS_CAMPO, useAreas, useCampos } from "./campos-adicionais";

const CORES = ["#7C8FFF", "#1E2D6B", "#1A8F5E", "#F5A623", "#C94343", "#0EA5E9", "#8B5CF6", "#EC4899", "#14B8A6", "#64748B"];

// ================================================================ áreas de atuação
export function AreasAtuacao() {
  const qc = useQueryClient();
  const areas = useAreas();
  const lista = areas.data ?? [];
  const [nova, setNova] = useState({ nome: "", cor: CORES[0] });
  const [editando, setEditando] = useState<{ id: number; nome: string } | null>(null);
  const [cores, setCores] = useState<number | null>(null);
  const [excluir, setExcluir] = useState<AreaOut | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat"] });
  const criar = useMutation({
    mutationFn: () => api.post<AreaOut>("/faturamento/areas", { nome: nova.nome.trim(), cor: nova.cor, ordem: (lista.at(-1)?.ordem ?? 0) + 1, ativo: true }),
    onSuccess: (a) => {
      toast.success(`Área “${a.nome}” criada`);
      setNova({ nome: "", cor: CORES[(lista.length + 1) % CORES.length] });
      invalidar();
    },
  });
  const salvar = useMutation({
    mutationFn: (a: AreaOut) => api.put(`/faturamento/areas/${a.id}`, { nome: a.nome, cor: a.cor, ordem: a.ordem, ativo: a.ativo }),
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/faturamento/areas/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      invalidar();
    },
  });
  const mover = async (i: number, d: -1 | 1) => {
    const nova = [...lista];
    [nova[i], nova[i + d]] = [nova[i + d], nova[i]];
    await Promise.all(nova.map((a, k) => (a.ordem !== k + 1 ? api.put(`/faturamento/areas/${a.id}`, { nome: a.nome, cor: a.cor, ordem: k + 1, ativo: a.ativo }) : null)));
    invalidar();
  };

  return (
    <section className="card-surface overflow-hidden" aria-labelledby="areas-t">
      <header className="flex items-start gap-3 border-b p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
          <Shapes className="size-5" />
        </span>
        <div>
          <h2 id="areas-t" className="font-semibold">
            Áreas de atuação
          </h2>
          <p className="text-sm text-muted-foreground">Cível, Trabalhista, Tributário… Organizam os casos e podem ter campos próprios.</p>
        </div>
      </header>
      <form
        className="flex items-center gap-2 border-b bg-muted/30 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (nova.nome.trim().length >= 2) criar.mutate();
        }}
      >
        <span className="relative">
          <button type="button" onClick={() => setCores(cores === -1 ? null : -1)} aria-label="Cor da nova área" className="block size-6 rounded-full ring-2 ring-background ring-offset-1 ring-offset-border" style={{ background: nova.cor }} />
          {cores === -1 && (
            <Paleta
              atual={nova.cor}
              onEscolher={(c) => {
                setNova({ ...nova, cor: c });
                setCores(null);
              }}
            />
          )}
        </span>
        <Input aria-label="Nome da nova área" value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Nova área, ex.: Trabalhista" />
        <Button type="submit" disabled={nova.nome.trim().length < 2 || criar.isPending}>
          {criar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar
        </Button>
      </form>
      {areas.isPending ? (
        <Skeleton className="m-3 h-32 rounded-lg" />
      ) : lista.length === 0 ? (
        <EmptyState icone={Shapes} titulo="Nenhuma área ainda" descricao="Crie as áreas em que o escritório atua para classificar os casos." />
      ) : (
        <ul className="divide-y">
          {lista.map((a, i) => (
            <li key={a.id} className={cn("group flex items-center gap-2.5 px-3 py-2", !a.ativo && "opacity-60")}>
              <div className="flex flex-col opacity-40 transition group-hover:opacity-100">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${a.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                  <ArrowUp className="size-3" />
                </button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${a.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                  <ArrowDown className="size-3" />
                </button>
              </div>
              <span className="relative">
                <button type="button" onClick={() => setCores(cores === a.id ? null : a.id)} aria-label={`Cor de ${a.nome}`} className="block size-3.5 rounded-full ring-1 ring-black/10" style={{ background: a.cor ?? "var(--muted)" }} />
                {cores === a.id && (
                  <Paleta
                    atual={a.cor}
                    onEscolher={(c) => {
                      salvar.mutate({ ...a, cor: c });
                      setCores(null);
                    }}
                  />
                )}
              </span>
              {editando?.id === a.id ? (
                <form
                  className="flex flex-1 items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editando.nome.trim().length >= 2) salvar.mutate({ ...a, nome: editando.nome.trim() });
                  }}
                >
                  <Input aria-label="Nome da área" value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} className="h-8" autoFocus onKeyDown={(e) => e.key === "Escape" && setEditando(null)} />
                  <Button type="submit" size="icon-sm" aria-label="Salvar">
                    <Check />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancelar" onClick={() => setEditando(null)}>
                    <X />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.nome}</span>
                  {!a.ativo && <Pill tom="neutral">inativa</Pill>}
                  <span className="text-xs text-muted-foreground">{a.qtd_casos} caso(s)</span>
                  <Switch checked={a.ativo} onCheckedChange={(v) => salvar.mutate({ ...a, ativo: v })} aria-label={`${a.nome} ativa`} />
                  <Button variant="ghost" size="icon-sm" aria-label={`Renomear ${a.nome}`} onClick={() => setEditando({ id: a.id, nome: a.nome })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${a.nome}`} onClick={() => setExcluir(a)}>
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
        titulo={`Excluir a área “${excluir?.nome ?? ""}”?`}
        descricao={excluir?.qtd_casos ? "Há casos nesta área: ela só é desativada." : "A área será apagada."}
        confirmar={excluir?.qtd_casos ? "Desativar" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </section>
  );
}

function Paleta({ atual, onEscolher }: { atual: string | null; onEscolher: (c: string) => void }) {
  return (
    <span className="absolute top-7 left-0 z-20 flex w-44 flex-wrap gap-1.5 rounded-xl border bg-popover p-2 shadow-lg">
      {CORES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onEscolher(c)}
          aria-label={`Usar ${c}`}
          className={cn("size-6 rounded-full", atual?.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground ring-offset-1")}
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

// ================================================================ campos adicionais
const vazio = (): CampoIn => ({ nome: "", tipo: "texto", opcoes: [], obrigatorio: false, ajuda: null, area_id: null, ordem: 0, ativo: true });

function CampoDialog({ open, onOpenChange, campo, areas }: { open: boolean; onOpenChange: (o: boolean) => void; campo: CampoOut | null; areas: AreaOut[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState<CampoIn>(vazio);
  const [opcao, setOpcao] = useState("");
  const [previa, setPrevia] = useState<ValorCampo>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(campo ? { nome: campo.nome, tipo: campo.tipo, opcoes: campo.opcoes, obrigatorio: campo.obrigatorio, ajuda: campo.ajuda, area_id: campo.area_id, ordem: campo.ordem, ativo: campo.ativo } : vazio());
    setOpcao("");
    setPrevia(null);
  }, [open, campo]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof CampoIn>(k: K, v: CampoIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const addOpcao = () => {
    const o = opcao.trim();
    if (!o || f.opcoes.includes(o)) return;
    set("opcoes", [...f.opcoes, o]);
    setOpcao("");
  };
  const salvar = useMutation({
    mutationFn: () => {
      const body = { ...f, nome: f.nome.trim(), ajuda: f.ajuda?.trim() || null, opcoes: f.tipo === "lista" ? f.opcoes : [] };
      return campo ? api.put<CampoOut>(`/faturamento/campos/${campo.id}`, body) : api.post<CampoOut>("/faturamento/campos", body);
    },
    onSuccess: (c) => {
      toast.success(campo ? "Campo atualizado" : `Campo “${c.nome}” criado`);
      qc.invalidateQueries({ queryKey: ["fat"] });
      onOpenChange(false);
    },
  });
  const campoPrevia: CampoOut = { ...f, id: 0, qtd_preenchidos: 0, nome: f.nome || "Nome do campo" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (f.nome.trim().length < 2) return toast.error("Dê um nome ao campo.");
            if (f.tipo === "lista" && f.opcoes.length === 0) return toast.error("Adicione as opções da lista.");
            salvar.mutate();
          }}
        >
          <div className="border-b px-5 py-4 pr-12">
            <DialogTitle>{campo ? `Editar “${campo.nome}”` : "Novo campo adicional"}</DialogTitle>
            <DialogDescription>Aparece na aba Detalhes de cada caso e no formulário do caso.</DialogDescription>
          </div>
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-4 p-5">
              <Field label="Nome do campo" obrigatorio htmlFor="campo-nome">
                <Input id="campo-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="ex.: Fase processual, Nº do sinistro, Juiz" autoFocus maxLength={100} />
              </Field>
              <div>
                <p className="mb-1.5 text-[13px] text-foreground/80">Tipo</p>
                <div role="radiogroup" aria-label="Tipo do campo" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.entries(TIPOS_CAMPO) as [TipoCampo, (typeof TIPOS_CAMPO)[TipoCampo]][]).map(([k, t]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={f.tipo === k}
                      onClick={() => {
                        set("tipo", k);
                        setPrevia(null);
                      }}
                      className={cn(
                        "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition",
                        f.tipo === k ? "border-brand bg-brand/8 ring-1 ring-brand/30" : "hover:border-brand/40 hover:bg-muted/40",
                      )}
                    >
                      <t.icone className={cn("size-4", f.tipo === k ? "text-info-ink" : "text-muted-foreground")} />
                      <span className="text-sm font-medium">{t.l}</span>
                      <span className="text-[11px] text-muted-foreground">{t.d}</span>
                    </button>
                  ))}
                </div>
              </div>
              {f.tipo === "lista" && (
                <Field label="Opções" obrigatorio htmlFor="campo-opcao">
                  <div className="flex gap-2">
                    <Input
                      id="campo-opcao"
                      value={opcao}
                      onChange={(e) => setOpcao(e.target.value)}
                      placeholder="Digite e tecle Enter"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addOpcao();
                        }
                      }}
                    />
                    <Button type="button" variant="outline" onClick={addOpcao}>
                      <ListPlus /> Incluir
                    </Button>
                  </div>
                  {f.opcoes.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {f.opcoes.map((o) => (
                        <span key={o} className="inline-flex items-center gap-1 rounded-full bg-brand/10 py-0.5 pr-1 pl-2.5 text-xs text-info-ink">
                          {o}
                          <button type="button" onClick={() => set("opcoes", f.opcoes.filter((x) => x !== o))} aria-label={`Remover ${o}`} className="rounded-full p-0.5 hover:bg-foreground/10">
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vale para" htmlFor="campo-area">
                  <NativeSelect id="campo-area" value={f.area_id ?? ""} onChange={(e) => set("area_id", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Todas as áreas</option>
                    {areas
                      .filter((a) => a.ativo || a.id === f.area_id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          Só {a.nome}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label="Texto de ajuda" htmlFor="campo-ajuda">
                  <Input id="campo-ajuda" value={f.ajuda ?? ""} onChange={(e) => set("ajuda", e.target.value)} maxLength={200} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={f.obrigatorio} onCheckedChange={(v) => set("obrigatorio", v)} aria-label="Obrigatório" /> Obrigatório
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Ativo" /> Ativo
                </label>
              </div>
            </div>
            <aside className="border-t bg-muted/30 p-5 md:border-t-0 md:border-l">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <Eye className="size-3.5" /> Prévia
              </p>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <Field label={campoPrevia.nome} obrigatorio={f.obrigatorio} htmlFor="campo-previa" dica={f.ajuda || undefined}>
                  <CampoInput id="campo-previa" campo={campoPrevia} valor={previa} onChange={setPrevia} />
                </Field>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                {f.area_id ? `Só aparece em casos de ${areas.find((a) => a.id === f.area_id)?.nome}.` : "Aparece em todos os casos."}
              </p>
            </aside>
          </div>
          <div className="flex justify-end gap-2 border-t bg-card px-5 py-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={salvar.isPending}>
              {salvar.isPending && <Loader2 className="animate-spin" />} {campo ? "Salvar campo" : "Criar campo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CamposAdicionaisConfig() {
  const qc = useQueryClient();
  const campos = useCampos();
  const areas = useAreas();
  const [dlg, setDlg] = useState<{ c: CampoOut | null } | null>(null);
  const [excluir, setExcluir] = useState<CampoOut | null>(null);
  const lista = [...(campos.data ?? [])].sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat"] });
  const ordenar = useMutation({
    mutationFn: (ids: number[]) => api.post("/faturamento/campos/ordem", { ids }),
    onMutate: (ids) => {
      qc.setQueryData<CampoOut[]>(["fat", "campos"], (o) => o?.map((c) => ({ ...c, ordem: ids.indexOf(c.id) + 1 })));
    },
    onSettled: invalidar,
  });
  const alternar = useMutation({
    mutationFn: (c: CampoOut) => api.put(`/faturamento/campos/${c.id}`, { nome: c.nome, tipo: c.tipo, opcoes: c.opcoes, obrigatorio: c.obrigatorio, ajuda: c.ajuda, area_id: c.area_id, ordem: c.ordem, ativo: !c.ativo }),
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/faturamento/campos/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      invalidar();
    },
  });
  const mover = (i: number, d: -1 | 1) => {
    const ids = lista.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    ordenar.mutate(ids);
  };
  const [arrastando, setArrastando] = useState<number | null>(null);
  const soltar = (alvo: number) => {
    if (arrastando === null || arrastando === alvo) return;
    const ids = lista.map((c) => c.id).filter((id) => id !== arrastando);
    ids.splice(ids.indexOf(alvo), 0, arrastando);
    ordenar.mutate(ids);
    setArrastando(null);
  };
  const nomeArea = (id: number | null) => areas.data?.find((a) => a.id === id);

  return (
    <section className="card-surface overflow-hidden" aria-labelledby="campos-t">
      <header className="flex flex-wrap items-start gap-3 border-b p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success/10 text-success-ink">
          <Layers className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="campos-t" className="font-semibold">
            Campos adicionais
          </h2>
          <p className="text-sm text-muted-foreground">Informações próprias do escritório na ficha do caso. Arraste para mudar a ordem.</p>
        </div>
        <Button onClick={() => setDlg({ c: null })}>
          <Plus /> Novo campo
        </Button>
      </header>
      {campos.isPending ? (
        <Skeleton className="m-3 h-32 rounded-lg" />
      ) : lista.length === 0 ? (
        <EmptyState
          icone={Layers}
          titulo="Nenhum campo adicional"
          descricao="Crie campos como “Fase processual”, “Juiz” ou “Nº do sinistro” para completar a ficha dos casos."
          acao={
            <Button onClick={() => setDlg({ c: null })}>
              <Plus /> Criar o primeiro campo
            </Button>
          }
        />
      ) : (
        <ul className="divide-y">
          {lista.map((c, i) => {
            const T = TIPOS_CAMPO[c.tipo];
            const area = nomeArea(c.area_id);
            return (
              <li
                key={c.id}
                draggable
                onDragStart={() => setArrastando(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => soltar(c.id)}
                onDragEnd={() => setArrastando(null)}
                className={cn("group flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30", !c.ativo && "opacity-60", arrastando === c.id && "bg-brand/8")}
              >
                <div className="flex cursor-grab flex-col opacity-40 transition group-hover:opacity-100">
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} aria-label={`Subir ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                    <ArrowUp className="size-3" />
                  </button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${c.nome}`} className="rounded p-0.5 hover:bg-muted disabled:invisible">
                    <ArrowDown className="size-3" />
                  </button>
                </div>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <T.icone className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {c.nome}
                    {c.obrigatorio && <span className="text-danger">*</span>}
                    {!c.ativo && <Pill tom="neutral">inativo</Pill>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {T.l}
                    {c.tipo === "lista" && ` · ${c.opcoes.join(", ")}`}
                    {` · ${c.qtd_preenchidos} caso(s) preenchido(s)`}
                  </p>
                </div>
                {area ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                    <span className="size-2 rounded-full" style={{ background: area.cor ?? "var(--muted-foreground)" }} />
                    {area.nome}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Todas as áreas</span>
                )}
                <Switch checked={c.ativo} onCheckedChange={() => alternar.mutate(c)} aria-label={`${c.nome} ativo`} />
                <Button variant="ghost" size="icon-sm" aria-label={`Editar ${c.nome}`} onClick={() => setDlg({ c })}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${c.nome}`} onClick={() => setExcluir(c)}>
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <CampoDialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} campo={dlg?.c ?? null} areas={areas.data ?? []} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o campo “${excluir?.nome ?? ""}”?`}
        descricao={excluir?.qtd_preenchidos ? "Ele já tem valores em casos: só é desativado e os valores ficam guardados." : "O campo será apagado."}
        confirmar={excluir?.qtd_preenchidos ? "Desativar" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </section>
  );
}
