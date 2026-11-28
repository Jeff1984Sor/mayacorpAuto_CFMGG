"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ExternalLink,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { casoParaIn } from "@/components/faturamento/dialogos";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { AdvogadoRapido, PessoaRapida } from "@/components/pessoas/cadastro-rapido";
import { LinhaPessoa, SeloCliente, useBuscaPessoas } from "@/components/pessoas/comum";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/use-debounce";
import { api, ApiError } from "@/lib/api";
import {
  type AdvogadoDaParte,
  type AdvogadoDaParteIn,
  type CategoriaPartes,
  conflitoDe,
  type Envolvimento,
  type EnvolvimentoIn,
  type PartesDoCaso,
  type RespostaConflito,
} from "@/lib/casos";
import type { CasoOut } from "@/lib/faturamento";
import { data } from "@/lib/format";
import { type AdvogadoResumo, documentoMascarado, type PessoaResumo } from "@/lib/pessoas";
import { cn } from "@/lib/utils";

export function usePartes(casoId: number, inativos = false) {
  return useQuery({
    queryKey: ["fat", "partes", casoId, inativos],
    queryFn: () => api.get<PartesDoCaso>(`/faturamento/casos/${casoId}/envolvimentos`, { inativos: inativos || undefined }),
  });
}

// ================================================================ conflito de interesses
/**
 * Roda uma gravação que pode responder 409 com `conflito`: mostra os casos em que a pessoa está do lado oposto e,
 * se o usuário confirmar, repete com `conflito_confirmado: true` (fica na auditoria).
 */
function useConflito() {
  const [pendente, setPendente] = useState<{ resposta: RespostaConflito; repetir: () => void } | null>(null);
  const [rodando, setRodando] = useState(false);
  const executar = async <T,>(gravar: (confirmado: boolean) => Promise<T>, depois: (r: T) => void, confirmado = false) => {
    setRodando(true);
    try {
      const r = await gravar(confirmado);
      setPendente(null);
      depois(r);
    } catch (e) {
      const conflito = e instanceof ApiError && e.status === 409 ? conflitoDe(e.body) : null;
      if (conflito) setPendente({ resposta: conflito, repetir: () => executar(gravar, depois, true) });
      else toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setRodando(false);
    }
  };
  const dialogo = (
    <ConfirmDialog
      open={!!pendente}
      onOpenChange={(o) => !o && setPendente(null)}
      titulo="Possível conflito de interesses"
      descricao={pendente?.resposta.detail}
      confirmar="Confirmar e continuar"
      carregando={rodando}
      onConfirm={() => pendente?.repetir()}
    >
      <ListaConflitos conflitos={pendente?.resposta.conflitos ?? []} />
      <p className="text-xs text-muted-foreground">A confirmação fica registrada no histórico, com o seu nome e a data.</p>
    </ConfirmDialog>
  );
  return { executar, dialogo, rodando };
}

function ListaConflitos({ conflitos }: { conflitos: RespostaConflito["conflitos"] }) {
  return (
    <ul className="max-h-56 space-y-1.5 overflow-y-auto">
      {conflitos.map((c) => (
        <li key={c.caso_id} className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          <span className="min-w-0 flex-1">
            <Link href={`/faturamento/casos/${c.caso_id}`} target="_blank" className="font-medium text-info-ink hover:underline">
              <span className="font-mono">#{c.numero}</span> {c.titulo}
            </Link>
            <span className="block text-xs text-muted-foreground">
              Lá é {c.papel_nome.toLowerCase()}
              {c.categoria ? ` (${c.categoria})` : ""}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ================================================================ advogados da parte
interface AdvEscolhido {
  /** id do vínculo (parte já gravada) ou do advogado (parte nova) */
  chave: number;
  advogado_id: number;
  nome: string;
  oab: string | null;
  principal: boolean;
  eh_interno: boolean;
}

const doResumo = (a: AdvogadoResumo, principal: boolean): AdvEscolhido => ({
  chave: a.advogado_id,
  advogado_id: a.advogado_id,
  nome: a.nome,
  oab: (a.oabs.find((o) => o.principal) ?? a.oabs[0])?.exibicao ?? null,
  principal,
  eh_interno: a.eh_interno,
});

const daParte = (a: AdvogadoDaParte): AdvEscolhido => ({ chave: a.id, advogado_id: a.advogado_id, nome: a.nome, oab: a.oab, principal: a.principal, eh_interno: a.eh_interno });

function AdvogadosDaParte({
  itens,
  onIncluir,
  onRetirar,
  onPrincipal,
  ocupado,
}: {
  itens: AdvEscolhido[];
  onIncluir: (a: AdvogadoResumo) => void;
  onRetirar: (a: AdvEscolhido) => void;
  onPrincipal: (a: AdvEscolhido) => void;
  ocupado?: boolean;
}) {
  const [q, setQ] = useState("");
  const [novo, setNovo] = useState(false);
  const termo = useDebounce(q.trim(), 250);
  const busca = useQuery({
    queryKey: ["pessoas", "advogados", termo],
    queryFn: () => api.get<AdvogadoResumo[]>("/advogados/buscar", { q: termo, limite: 12 }),
    enabled: termo.length >= 2,
  });
  const achados = (busca.data ?? []).filter((a) => !itens.some((i) => i.advogado_id === a.advogado_id));
  return (
    <fieldset className="rounded-2xl border bg-card p-4">
      <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Advogados desta parte</legend>
      {itens.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {itens.map((a) => (
            <li key={a.chave} className="flex items-center gap-2 rounded-lg border bg-background/50 px-3 py-2 text-sm">
              <Scale className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.nome}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {a.oab ?? "sem OAB no cadastro"}
                  {a.eh_interno ? " · do escritório" : ""}
                </span>
              </span>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onPrincipal(a)}
                aria-pressed={a.principal}
                title={a.principal ? "Recebe as intimações" : "Marcar como principal (recebe as intimações)"}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition",
                  a.principal ? "border-brand bg-brand/10 text-info-ink" : "text-muted-foreground hover:border-brand/40",
                )}
              >
                <Star className={cn("size-3", a.principal && "fill-current")} /> Principal
              </button>
              <Button type="button" variant="ghost" size="icon-sm" disabled={ocupado} aria-label={`Retirar ${a.nome}`} onClick={() => onRetirar(a)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {novo ? (
        <AdvogadoRapido
          textoInicial={q}
          onCancelar={() => setNovo(false)}
          onPronto={(a) => {
            setNovo(false);
            setQ("");
            if (itens.some((i) => i.advogado_id === a.advogado_id)) return toast.info("Este advogado já está nesta parte.");
            onIncluir(a);
          }}
        />
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder="Buscar advogado por nome ou OAB (ex.: 123456/SP)"
              aria-label="Buscar advogado"
              className="h-9 w-full rounded-lg border border-input bg-transparent pr-2 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>
          {termo.length >= 2 && (
            <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border p-1">
              {busca.isPending && <li className="p-2 text-center text-sm text-muted-foreground">Buscando…</li>}
              {!busca.isPending && achados.length === 0 && <li className="p-2 text-center text-sm text-muted-foreground">Nenhum advogado encontrado no cadastro.</li>}
              {achados.map((a) => (
                <li key={a.advogado_id}>
                  <button
                    type="button"
                    onClick={() => {
                      onIncluir(a);
                      setQ("");
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{a.nome}</span>
                        <SeloCliente clienteId={a.cliente_id} />
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {a.oabs.map((o) => o.exibicao).join(" · ") || "sem OAB"}
                        {a.sociedade_nome ? ` · ${a.sociedade_nome}` : ""}
                      </span>
                    </span>
                    <Plus className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setNovo(true)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-info-ink hover:underline">
            <UserPlus className="size-4" /> Cadastrar advogado (nome + OAB)
          </button>
        </>
      )}
    </fieldset>
  );
}

// ================================================================ modal: adicionar / editar parte
function ParteDialog({
  caso,
  categoria,
  env,
  open,
  onOpenChange,
}: {
  caso: CasoOut;
  categoria: CategoriaPartes | null;
  /** parte já gravada (edição) */
  env: Envolvimento | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const conflito = useConflito();
  const [q, setQ] = useState("");
  const [pessoa, setPessoa] = useState<PessoaResumo | null>(null);
  const [nova, setNova] = useState(false);
  const [qualificacao, setQualificacao] = useState<number | null>(null);
  const [ehCliente, setEhCliente] = useState(false);
  const [principal, setPrincipal] = useState(false);
  const [advs, setAdvs] = useState<AdvEscolhido[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const busca = useBuscaPessoas(q, open && !env && !pessoa && !nova);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setQ("");
    setNova(false);
    setPessoa(env?.pessoa ?? null);
    setQualificacao(env?.qualificacao_id ?? null);
    setEhCliente(env?.eh_cliente ?? false);
    setPrincipal(env?.principal ?? false);
    setAdvs(env ? env.advogados.filter((a) => a.ativo).map(daParte) : []);
  }, [open, env]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat"] });
  const base = `/faturamento/casos/${caso.id}/envolvimentos`;
  const qualificacoes = (categoria?.qualificacoes ?? []).filter((x) => x.ativo || x.id === qualificacao);

  const salvar = () => {
    if (!categoria) return;
    if (!pessoa) return toast.error("Escolha a pessoa ou cadastre uma nova.");
    if (env) {
      const corpo: Record<string, unknown> = {};
      if (qualificacao !== env.qualificacao_id) corpo.qualificacao_id = qualificacao;
      if (ehCliente !== env.eh_cliente) corpo.eh_cliente = ehCliente;
      if (principal !== env.principal) corpo.principal = principal;
      if (Object.keys(corpo).length === 0) return onOpenChange(false);
      return conflito.executar(
        (confirmado) => api.put<Envolvimento>(`${base}/${env.id}`, { ...corpo, conflito_confirmado: confirmado }),
        () => {
          toast.success("Parte atualizada");
          invalidar();
          onOpenChange(false);
        },
      );
    }
    const corpo: EnvolvimentoIn = {
      pessoa_id: pessoa.id,
      categoria_id: categoria.id,
      qualificacao_id: qualificacao,
      eh_cliente: ehCliente,
      principal,
      advogados: advs.map((a): AdvogadoDaParteIn => ({ advogado_id: a.advogado_id, principal: a.principal })),
    };
    conflito.executar(
      (confirmado) => api.post<Envolvimento>(base, { ...corpo, conflito_confirmado: confirmado }),
      (e) => {
        toast.success(`${e.pessoa.nome} entrou em ${categoria.nome}`);
        invalidar();
        onOpenChange(false);
      },
    );
  };

  // parte já gravada: cada mudança nos advogados é gravada na hora
  const naApi = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
      const lista = await api.get<AdvogadoDaParte[]>(`${base}/${env!.id}/advogados`);
      setAdvs(lista.filter((a) => a.ativo).map(daParte));
      invalidar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  };
  const incluirAdv = (a: AdvogadoResumo) => {
    if (env) return naApi(() => api.post(`${base}/${env.id}/advogados`, { advogado_id: a.advogado_id, principal: advs.length === 0 } satisfies AdvogadoDaParteIn));
    setAdvs((o) => [...o, doResumo(a, o.length === 0)]);
  };
  const retirarAdv = (a: AdvEscolhido) => {
    if (env) return naApi(() => api.del(`${base}/${env.id}/advogados/${a.chave}`));
    setAdvs((o) => o.filter((x) => x.chave !== a.chave));
  };
  const principalAdv = (a: AdvEscolhido) => {
    if (env) {
      const atual = env.advogados.find((x) => x.id === a.chave);
      return naApi(() =>
        api.put(`${base}/${env.id}/advogados/${a.chave}`, {
          advogado_id: a.advogado_id,
          oab_id: atual?.oab_id ?? null,
          principal: !a.principal,
          tipo_habilitacao: atual?.tipo_habilitacao ?? null,
          data_habilitacao: atual?.data_habilitacao ?? null,
          data_desabilitacao: atual?.data_desabilitacao ?? null,
          documento_procuracao_id: atual?.documento_procuracao_id ?? null,
          ativo: true,
        } satisfies AdvogadoDaParteIn),
      );
    }
    setAdvs((o) => o.map((x) => ({ ...x, principal: x.chave === a.chave ? !a.principal : false })));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <form
            className="flex max-h-[92dvh] flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              salvar();
            }}
          >
            <DialogHeader className="border-b p-5">
              <DialogTitle className="text-lg">{env ? "Editar parte" : `Adicionar em ${categoria?.nome ?? ""}`}</DialogTitle>
              <DialogDescription>
                {env ? `${env.pessoa.nome} em ${categoria?.nome ?? env.categoria_nome}.` : "A pessoa vem do cadastro único: cada uma é cadastrada uma vez e aparece em quantos casos for preciso."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* 1. pessoa */}
              {pessoa ? (
                <div className="flex items-center gap-3 rounded-xl border bg-muted/25 px-3 py-2.5 text-sm">
                  <UsersRound className="size-5 shrink-0 text-info-ink" />
                  <LinhaPessoa p={pessoa} />
                  {!env && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPessoa(null)}>
                      Trocar
                    </Button>
                  )}
                </div>
              ) : nova ? (
                <PessoaRapida nomeInicial={q} onCancelar={() => setNova(false)} onPronta={(p) => (setPessoa(p), setNova(false))} />
              ) : (
                <div>
                  <label htmlFor="parte-busca" className="mb-1.5 block text-[13px] text-foreground/80">
                    Pessoa<span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="parte-busca"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                      placeholder="Buscar por nome ou CPF/CNPJ"
                      autoFocus
                      className="h-10 w-full rounded-lg border border-input bg-transparent pr-2 pl-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    />
                  </div>
                  {q.trim().length >= 2 && (
                    <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border p-1" role="listbox" aria-label="Pessoas encontradas">
                      {busca.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Buscando…</li>}
                      {busca.data?.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Ninguém com esse nome ou documento no cadastro.</li>}
                      {busca.data?.map((p) => (
                        <li key={p.id}>
                          <button type="button" role="option" aria-selected={false} onClick={() => setPessoa(p)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                            <LinhaPessoa p={p} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" onClick={() => setNova(true)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-info-ink hover:underline">
                    <UserPlus className="size-4" /> Cadastrar nova pessoa
                  </button>
                </div>
              )}

              {/* 2. papel */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Qualificação" htmlFor="parte-qualificacao" className="sm:col-span-2" dica={`Só as qualificações de ${categoria?.nome ?? "esta categoria"}.`}>
                  <NativeSelect id="parte-qualificacao" value={qualificacao ?? ""} onChange={(e) => setQualificacao(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Sem qualificação</option>
                    {qualificacoes.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm">
                  <Switch checked={ehCliente} onCheckedChange={setEhCliente} aria-label="É cliente" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">É cliente</span>
                    <span className="block text-xs text-muted-foreground">O escritório representa esta parte neste caso.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm">
                  <Switch checked={principal} onCheckedChange={setPrincipal} aria-label="Principal" className="mt-0.5" />
                  <span>
                    <span className="block font-medium">Principal</span>
                    <span className="block text-xs text-muted-foreground">A parte que dá nome ao bloco (entra no título sugerido).</span>
                  </span>
                </label>
              </div>

              {/* 3. advogados */}
              <AdvogadosDaParte itens={advs} onIncluir={incluirAdv} onRetirar={retirarAdv} onPrincipal={principalAdv} ocupado={ocupado} />
            </div>
            <DialogFooter className="m-0 items-center rounded-none p-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={conflito.rodando || ocupado} className="px-4">
                {conflito.rodando && <Loader2 className="animate-spin" />}
                {env ? "Salvar" : "Adicionar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {conflito.dialogo}
    </>
  );
}

// ================================================================ cartão da parte
function CartaoParte({
  e,
  categorias,
  podeEditar,
  primeiro,
  ultimo,
  arrastando,
  onEditar,
  onSubir,
  onDescer,
  onMover,
  onRetirar,
  onDevolver,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  e: Envolvimento;
  categorias: CategoriaPartes[];
  podeEditar: boolean;
  primeiro: boolean;
  ultimo: boolean;
  arrastando: boolean;
  onEditar: () => void;
  onSubir: () => void;
  onDescer: () => void;
  onMover: (c: CategoriaPartes) => void;
  onRetirar: () => void;
  onDevolver: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (ev: React.DragEvent) => void;
}) {
  const doc = documentoMascarado(e.pessoa);
  const advs = e.advogados.filter((a) => a.ativo);
  const outras = categorias.filter((c) => c.id !== e.categoria_id);
  return (
    <li
      draggable={podeEditar && e.ativo}
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(e.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      className={cn(
        "group rounded-xl border bg-card p-3 text-sm transition",
        e.eh_cliente && "border-success/40 bg-success/5",
        !e.ativo && "opacity-60",
        arrastando && "opacity-40",
        e.pendente_reclassificacao && "border-warning/50",
      )}
    >
      <div className="flex items-start gap-2">
        {podeEditar && e.ativo && <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="font-medium break-words">{e.pessoa.nome}</span>
            <SeloCliente clienteId={e.pessoa.cliente_id} />
            {e.principal && (
              <span className="inline-flex h-5 items-center gap-1 rounded-md bg-brand/12 px-1.5 text-[11px] font-semibold text-info-ink ring-1 ring-brand/30 ring-inset" title="Parte principal do bloco">
                <Star className="size-3 fill-current" /> Principal
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {e.qualificacao_nome ?? <span className="italic">sem qualificação</span>}
            {doc && (
              <>
                {" · "}
                <span className="font-mono">{doc}</span>
              </>
            )}
            {e.representado_por_nome && ` · representado por ${e.representado_por_nome}`}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
            {e.eh_cliente && <Pill tom="success">Cliente neste caso</Pill>}
            {e.pendente_reclassificacao && <Pill tom="warning">Revisar papel</Pill>}
            {!e.ativo && <Pill tom="neutral">Retirada{e.data_exclusao ? ` em ${data(e.data_exclusao)}` : ""}</Pill>}
            {e.conflitos.length > 0 && (
              <span
                className="inline-flex h-5 items-center gap-1 rounded-md bg-danger/10 px-1.5 text-[11px] font-semibold text-danger-ink ring-1 ring-danger/25 ring-inset"
                title={`Do lado oposto em: ${e.conflitos.map((c) => `#${c.numero} ${c.titulo} (${c.papel_nome.toLowerCase()})`).join("; ")}`}
              >
                <AlertTriangle className="size-3" /> Conflito de interesses em {e.conflitos.length} caso{e.conflitos.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {advs.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t pt-2">
              {advs.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-1.5 text-xs">
                  <Scale className="size-3 shrink-0 text-muted-foreground" />
                  <span>{a.nome}</span>
                  {a.oab && <span className="font-mono text-muted-foreground">{a.oab}</span>}
                  {a.principal && <Star className="size-3 fill-current text-info-ink" aria-label="Advogado principal" />}
                </li>
              ))}
            </ul>
          )}
        </div>
        {podeEditar && e.ativo && (
          <div className="flex shrink-0 items-center">
            <div className="flex flex-col">
              <button type="button" onClick={onSubir} disabled={primeiro} aria-label={`Subir ${e.pessoa.nome}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:invisible">
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" onClick={onDescer} disabled={ultimo} aria-label={`Descer ${e.pessoa.nome}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:invisible">
                <ArrowDown className="size-3.5" />
              </button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${e.pessoa.nome}`} />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={onEditar}>
                  <Pencil /> Editar parte e advogados
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    window.open(`/cadastros/pessoas?id=${e.pessoa_id}`, "_blank")
                  }
                >
                  <ExternalLink /> Abrir cadastro da pessoa
                </DropdownMenuItem>
                {outras.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Mover para…</DropdownMenuLabel>
                      {outras.map((c) => (
                        <DropdownMenuItem key={c.id} onClick={() => onMover(c)}>
                          <ArrowRightLeft /> {c.nome}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onRetirar}>
                  <Trash2 /> Retirar do caso
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        {podeEditar && !e.ativo && (
          <Button type="button" variant="ghost" size="xs" onClick={onDevolver}>
            <RotateCcw /> Devolver ao caso
          </Button>
        )}
      </div>
    </li>
  );
}

const TOM_POLO: Record<string, "brand" | "warning" | "neutral"> = { ativo: "brand", passivo: "warning", neutro: "neutral" };

// ================================================================ aba Partes
/** Partes do caso em blocos por categoria (no contencioso: Polo Ativo, Polo Passivo, Terceiros e Outros). */
export function PartesCaso({ caso, podeEditar, onTituloUsado }: { caso: CasoOut; podeEditar: boolean; onTituloUsado?: (titulo: string) => void }) {
  const qc = useQueryClient();
  const [inativos, setInativos] = useState(false);
  const q = usePartes(caso.id, inativos);
  const conflito = useConflito();
  const [dlg, setDlg] = useState<{ categoria: CategoriaPartes; env: Envolvimento | null } | null>(null);
  const [retirar, setRetirar] = useState<Envolvimento | null>(null);
  const [arrastado, setArrastado] = useState<Envolvimento | null>(null);
  const [alvo, setAlvo] = useState<{ categoria: number; posicao: number } | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fat"] });
  const base = `/faturamento/casos/${caso.id}/envolvimentos`;

  const reordenar = useMutation({
    mutationFn: (v: { categoria_id: number; ids: number[] }) => api.post(`${base}/reordenar`, v),
    onSuccess: invalidar,
  });
  const remover = useMutation({
    mutationFn: (e: Envolvimento) => api.del<{ mensagem: string }>(`${base}/${e.id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setRetirar(null);
      invalidar();
    },
  });
  const devolver = useMutation({
    mutationFn: (e: Envolvimento) => api.put(`${base}/${e.id}`, { ativo: true }),
    onSuccess: () => {
      toast.success("Parte devolvida ao caso");
      invalidar();
    },
  });
  const usarTitulo = useMutation({
    mutationFn: (titulo: string) => api.put<CasoOut>(`/faturamento/casos/${caso.id}`, { ...casoParaIn(caso), titulo }),
    onSuccess: (c) => {
      toast.success("Título do caso atualizado");
      qc.setQueryData(["fat", "caso", caso.id], c);
      invalidar();
      onTituloUsado?.(c.titulo);
    },
  });
  const mover = (e: Envolvimento, c: CategoriaPartes, posicao?: number) =>
    conflito.executar(
      (confirmado) => api.post<Envolvimento>(`${base}/${e.id}/mover`, { categoria_id: c.id, posicao, conflito_confirmado: confirmado }),
      () => {
        toast.success(`${e.pessoa.nome} agora está em ${c.nome}`, { description: e.qualificacao_nome ? "A qualificação antiga não vale no bloco novo: escolha outra em Editar." : undefined });
        invalidar();
      },
    );

  if (q.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (!q.data) return null;
  const p = q.data;
  const ativosDe = (c: CategoriaPartes) => c.envolvimentos.filter((e) => e.ativo);
  const trocar = (c: CategoriaPartes, i: number, d: -1 | 1) => {
    const ids = ativosDe(c).map((e) => e.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reordenar.mutate({ categoria_id: c.id, ids });
  };
  const soltar = (c: CategoriaPartes) => {
    const e = arrastado;
    const posicao = alvo?.categoria === c.id ? alvo.posicao : ativosDe(c).length;
    setArrastado(null);
    setAlvo(null);
    if (!e) return;
    if (e.categoria_id !== c.id) return void mover(e, c, posicao);
    const ids = ativosDe(c)
      .map((x) => x.id)
      .filter((i) => i !== e.id);
    const de = ativosDe(c).findIndex((x) => x.id === e.id);
    ids.splice(posicao > de ? posicao - 1 : posicao, 0, e.id);
    if (ids.join() !== ativosDe(c).map((x) => x.id).join()) reordenar.mutate({ categoria_id: c.id, ids });
  };
  const total = p.categorias.reduce((n, c) => n + ativosDe(c).length, 0);
  const sugerido = p.titulo_sugerido && p.titulo_sugerido !== caso.titulo ? p.titulo_sugerido : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {p.partes_resumo ? (
            <>
              <span className="font-medium text-foreground">{p.partes_resumo}</span> · {total} parte{total === 1 ? "" : "s"}
            </>
          ) : (
            `${total} parte${total === 1 ? "" : "s"} no caso`
          )}
          {p.polo_cliente && ` · cliente no polo ${p.polo_cliente}`}
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch size="sm" checked={inativos} onCheckedChange={setInativos} aria-label="Mostrar partes retiradas" /> Mostrar partes retiradas
        </label>
      </div>

      {p.pendentes_reclassificacao > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          <span>
            <strong className="font-medium">
              {p.pendentes_reclassificacao} parte{p.pendentes_reclassificacao > 1 ? "s" : ""} para revisar.
            </strong>{" "}
            O papel veio da migração ou de uma troca de tipo do caso. Confira o bloco e escolha a qualificação em “Editar parte” (ou mova para o bloco certo).
          </span>
        </p>
      )}
      {p.polo_inconsistente && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          Há partes marcadas como cliente em polos diferentes. Confira quem o escritório representa neste caso.
        </p>
      )}
      {!p.tem_cliente && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
          Nenhuma parte está marcada como cliente. Marque “É cliente” em pelo menos uma.
        </p>
      )}
      {sugerido && podeEditar && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-brand/5 px-3 py-2.5 text-sm">
          <Wand2 className="size-4 shrink-0 text-info-ink" />
          <span className="min-w-0 flex-1">
            Título sugerido pelas partes: <strong className="font-medium">{sugerido}</strong>
          </span>
          <Button type="button" size="sm" variant="outline" disabled={usarTitulo.isPending} onClick={() => usarTitulo.mutate(sugerido)}>
            {usarTitulo.isPending && <Loader2 className="animate-spin" />} Usar título sugerido
          </Button>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {p.categorias.map((c) => {
          const lista = inativos ? c.envolvimentos : ativosDe(c);
          const sobre = !!arrastado && alvo?.categoria === c.id;
          return (
            <section
              key={c.id}
              aria-label={c.nome}
              onDragOver={(ev) => {
                if (!arrastado) return;
                ev.preventDefault();
                if (alvo?.categoria !== c.id) setAlvo({ categoria: c.id, posicao: ativosDe(c).length });
              }}
              onDrop={(ev) => {
                ev.preventDefault();
                soltar(c);
              }}
              className={cn("card-surface flex flex-col overflow-hidden transition", sobre && "ring-2 ring-brand/50")}
            >
              <header className="flex items-center gap-2 border-b px-4 py-3">
                <h3 className="font-semibold">{c.nome}</h3>
                {c.polo !== "neutro" && <Pill tom={TOM_POLO[c.polo]}>{c.polo_nome}</Pill>}
                <span className="text-xs text-muted-foreground tabular-nums">{ativosDe(c).length}</span>
                {podeEditar && (
                  <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setDlg({ categoria: c, env: null })}>
                    <Plus /> Adicionar
                  </Button>
                )}
              </header>
              {lista.length === 0 ? (
                <p className="flex-1 px-4 py-8 text-center text-sm text-muted-foreground">
                  Ninguém em {c.nome} ainda.{podeEditar && arrastado ? " Solte aqui para mover." : ""}
                </p>
              ) : (
                <ul className="flex-1 space-y-2 p-3">
                  {lista.map((e) => {
                    const ativos = ativosDe(c);
                    const i = ativos.findIndex((x) => x.id === e.id);
                    return (
                      <CartaoParte
                        key={e.id}
                        e={e}
                        categorias={p.categorias}
                        podeEditar={podeEditar}
                        primeiro={i <= 0}
                        ultimo={i === ativos.length - 1}
                        arrastando={arrastado?.id === e.id}
                        onEditar={() => setDlg({ categoria: c, env: e })}
                        onSubir={() => trocar(c, i, -1)}
                        onDescer={() => trocar(c, i, 1)}
                        onMover={(dest) => mover(e, dest)}
                        onRetirar={() => setRetirar(e)}
                        onDevolver={() => devolver.mutate(e)}
                        onDragStart={() => setArrastado(e)}
                        onDragEnd={() => (setArrastado(null), setAlvo(null))}
                        onDragOver={(ev) => {
                          if (!arrastado || i < 0) return;
                          ev.preventDefault();
                          ev.stopPropagation();
                          const r = ev.currentTarget.getBoundingClientRect();
                          const posicao = ev.clientY > r.top + r.height / 2 ? i + 1 : i;
                          if (alvo?.categoria !== c.id || alvo.posicao !== posicao) setAlvo({ categoria: c.id, posicao });
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {podeEditar && total > 1 && <p className="text-xs text-muted-foreground">Arraste um cartão para mudar a ordem ou levar a parte para outro bloco. As setas e o menu “…” fazem o mesmo.</p>}

      <ParteDialog caso={caso} categoria={dlg?.categoria ?? null} env={dlg?.env ?? null} open={!!dlg} onOpenChange={(o) => !o && setDlg(null)} />
      <ConfirmDialog
        open={!!retirar}
        onOpenChange={(o) => !o && setRetirar(null)}
        titulo={`Retirar ${retirar?.pessoa.nome ?? ""} do caso?`}
        descricao="A parte não é apagada: fica guardada no histórico do caso e pode ser devolvida depois. A pessoa continua no cadastro."
        confirmar="Retirar"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => retirar && remover.mutate(retirar)}
      />
      {conflito.dialogo}
    </div>
  );
}
