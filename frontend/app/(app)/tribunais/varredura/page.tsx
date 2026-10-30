"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleStop,
  Download,
  History,
  Loader2,
  Lock,
  Play,
  Plus,
  ScanSearch,
  Search,
  ShieldCheck,
  Timer,
  UserRoundSearch,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pagination, SearchInput, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { type EstadoColeta, useColetaDjen } from "@/components/tribunais/use-coleta-djen";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora, numero, relativo } from "@/lib/format";
import {
  CHAVE,
  CRITERIO,
  type Encontrado,
  type Oab,
  oabTexto,
  POR_PAGINA_ENCONTRADOS,
  rotuloSistema,
  STATUS_IMPORTACAO,
  STATUS_VARREDURA,
  type StatusImportacao,
  UFS,
  useAdvogadosTribunais,
  useCandidatos,
  useEuTribunais,
  useTribunaisCatalogo,
  useVarredura,
  useVarreduras,
  type Varredura,
} from "@/lib/tribunais";
import { cn } from "@/lib/utils";

// ================================================================ tribunais (multi)
function TribunaisMulti({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const cat = useTribunaisCatalogo();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = q.trim().toLowerCase();
  const lista = (cat.data ?? []).filter((t) => !termo || t.sigla.toLowerCase().includes(termo) || t.nome.toLowerCase().includes(termo));
  const alternar = (s: string) => onChange(valor.includes(s) ? valor.filter((x) => x !== s) : [...valor, s]);
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id="var-tribunais"
            type="button"
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
              valor.length > 0 && "border-brand/50 bg-brand/5",
            )}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{valor.length === 0 ? "Todos os tribunais" : valor.join(", ")}</span>
        {valor.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Limpar tribunais"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
          >
            <X className="size-3.5" />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sigla ou nome (ex.: TJSP)"
              aria-label="Buscar tribunal"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" role="listbox" aria-multiselectable>
          {cat.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Carregando…</li>}
          {lista.map((t) => {
            const on = valor.includes(t.sigla);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => alternar(t.sigla)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30")}>
                    {on && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="w-14 shrink-0 font-mono text-xs font-medium">{t.sigla}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.nome}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ================================================================ nova busca
interface Pessoa {
  id: number;
  nome: string;
  oabs: Oab[];
}

function CadastrarOab({ pessoa }: { pessoa: Pessoa }) {
  const qc = useQueryClient();
  const [num, setNum] = useState("");
  const [uf, setUf] = useState("SP");
  const salvar = useMutation({
    mutationFn: () =>
      api.put(`/tribunais/advogados/${pessoa.id}/oabs`, [...pessoa.oabs, { numero: num.replace(/\D/g, ""), uf, tipo: pessoa.oabs.length ? "suplementar" : "principal" }]),
    onSuccess: () => {
      toast.success(`OAB ${num}/${uf} cadastrada para ${pessoa.nome}`);
      setNum("");
      qc.invalidateQueries({ queryKey: [CHAVE] });
    },
  });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!num.replace(/\D/g, "")) return toast.error("Informe o número da OAB.");
        salvar.mutate();
      }}
    >
      <Field label="Número da OAB" htmlFor="var-oab-num">
        <Input id="var-oab-num" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 10))} className="w-36 font-mono" placeholder="123456" />
      </Field>
      <Field label="UF" htmlFor="var-oab-uf">
        <NativeSelect id="var-oab-uf" value={uf} onChange={(e) => setUf(e.target.value)} className="w-20">
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="outline" disabled={salvar.isPending}>
        {salvar.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar OAB
      </Button>
    </form>
  );
}

function NovaBusca({ bloqueado, onIniciada }: { bloqueado: boolean; onIniciada: (v: Varredura) => void }) {
  const { usuario, pode } = useAuth();
  const listar = pode("trib_processos.ver");
  const candidatos = useCandidatos(listar);
  const advogados = useAdvogadosTribunais(listar);
  // sem acesso à lista (403): só a própria OAB
  const gerir = listar && !candidatos.isError;
  const eu = useEuTribunais(!gerir);
  const pessoas: Pessoa[] = useMemo(
    () => (gerir ? (candidatos.data ?? []) : eu.data ? [{ id: eu.data.usuario_id, nome: eu.data.nome, oabs: eu.data.oabs }] : []),
    [gerir, candidatos.data, eu.data],
  );
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const padrao = pessoas.find((p) => p.id === usuario?.id && p.oabs.length) ?? pessoas.find((p) => p.oabs.length) ?? pessoas[0];
  const advId = escolhido ?? padrao?.id ?? null;
  const pessoa = pessoas.find((p) => p.id === advId) ?? null;
  const infoAdv = advogados.data?.find((a) => a.id === advId);
  const comOab = pessoas.filter((p) => p.oabs.length > 0);
  const semOab = pessoas.filter((p) => p.oabs.length === 0);

  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [soNovas, setSoNovas] = useState(false);
  const [tribunais, setTribunais] = useState<string[]>([]);

  const iniciar = useMutation({
    mutationFn: () =>
      api.post<Varredura>("/tribunais/varreduras", {
        advogado_id: advId,
        data_inicio: soNovas ? null : inicio || null,
        data_fim: soNovas ? null : fim || null,
        tribunais_alvo: tribunais,
        so_novas: soNovas,
      }),
    onSuccess: (v) => onIniciada(v),
  });

  const carregando = gerir ? candidatos.isPending : eu.isPending;

  return (
    <form
      className="card-surface p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pessoa) return toast.error("Escolha o advogado.");
        if (!pessoa.oabs.length) return toast.error(`${pessoa.nome} não tem OAB cadastrada.`);
        if (!soNovas && inicio && fim && inicio > fim) return toast.error("A data inicial é depois da final.");
        iniciar.mutate();
      }}
    >
      <h2 className="mb-4 flex items-center gap-2 font-semibold">
        <UserRoundSearch className="size-4 text-info-ink" /> Nova busca
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Advogado" htmlFor="var-adv" className="sm:col-span-2">
          {carregando ? (
            <Skeleton className="h-9" />
          ) : (
            <NativeSelect id="var-adv" value={advId ?? ""} onChange={(e) => setEscolhido(Number(e.target.value) || null)} disabled={!gerir}>
              {comOab.length > 0 && (
                <optgroup label="Com OAB">
                  {comOab.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome} · {p.oabs.map(oabTexto).join(", ")}
                    </option>
                  ))}
                </optgroup>
              )}
              {semOab.length > 0 && (
                <optgroup label="Sem OAB cadastrada">
                  {semOab.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          )}
        </Field>

        {pessoa && (
          <div className="rounded-xl border bg-muted/30 p-3 text-sm sm:col-span-2">
            {pessoa.oabs.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Busca nas OABs</span>
                {pessoa.oabs.map((o) => (
                  <Pill key={oabTexto(o)} tom="brand" className="font-mono normal-case">
                    {oabTexto(o)}
                  </Pill>
                ))}
                {infoAdv?.certificado && (
                  <span className="inline-flex items-center gap-1 text-xs text-success-ink">
                    <ShieldCheck className="size-3.5" /> com certificado
                  </span>
                )}
                {infoAdv?.ultima_varredura && (
                  <span className="text-xs text-muted-foreground">· última busca {relativo(infoAdv.ultima_varredura.iniciada_em)}</span>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-warning-ink">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  {pessoa.nome} ainda não tem OAB cadastrada. Sem a OAB não dá para buscar.
                </p>
                {pode("cfg_tribunais.editar") ? (
                  <CadastrarOab pessoa={pessoa} />
                ) : pessoa.id === usuario?.id ? (
                  <Button variant="outline" size="sm" render={<Link href="/tribunais/meu-certificado" />}>
                    Cadastrar minha OAB
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">Peça a um administrador para cadastrar a OAB desta pessoa.</p>
                )}
              </div>
            )}
          </div>
        )}

        <Field label="Disponibilizadas a partir de" htmlFor="var-inicio">
          <Input id="var-inicio" type="date" value={inicio} disabled={soNovas} onChange={(e) => setInicio(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="var-fim">
          <Input id="var-fim" type="date" value={fim} disabled={soNovas} onChange={(e) => setFim(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <Checkbox checked={soNovas} onCheckedChange={(v) => setSoNovas(!!v)} aria-label="Só intimações novas" className="mt-0.5" />
          <span>
            Só intimações novas
            <span className="block text-xs text-muted-foreground">Desde a última busca deste advogado (ou dos últimos 7 dias, se for a primeira).</span>
          </span>
        </label>
        <Field label="Tribunais" htmlFor="var-tribunais" dica="Vazio: todos os tribunais do país." className="sm:col-span-2">
          <TribunaisMulti valor={tribunais} onChange={setTribunais} />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          A busca é feita pelo seu navegador no Diário de Justiça Eletrônico Nacional (DJEN). Deixe esta aba aberta até terminar.
        </p>
        <Button type="submit" disabled={bloqueado || iniciar.isPending || !pessoa?.oabs.length} className="brand-gradient px-4 text-white shadow-md shadow-brand/25">
          {iniciar.isPending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Buscar processos
        </Button>
      </div>
    </form>
  );
}

// ================================================================ progresso
function Progresso({ e, onParar, onFechar }: { e: EstadoColeta; onParar: () => void; onFechar: () => void }) {
  const ativa = e.fase === "coletando" || e.fase === "aguardando" || e.fase === "concluindo";
  const pct = e.paginas ? Math.min(100, Math.round((e.pagina / e.paginas) * 100)) : 0;
  const resumo = Object.entries(e.resumo);
  return (
    <section
      className={cn(
        "card-surface relative overflow-hidden p-5",
        e.fase === "erro" && "border-danger/30",
        (e.fase === "fim" || e.fase === "parada") && "border-success/30",
      )}
      aria-live="polite"
    >
      {ativa && <div className="brand-gradient absolute inset-x-0 top-0 h-1 animate-pulse" />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            {ativa ? <Loader2 className="size-4 animate-spin text-info-ink" /> : e.fase === "erro" ? <AlertTriangle className="size-4 text-danger-ink" /> : <Check className="size-4 text-success-ink" />}
            {e.fase === "coletando" && "Coletando no DJEN…"}
            {e.fase === "aguardando" && "O DJEN pediu uma pausa"}
            {e.fase === "concluindo" && "Encerrando e procurando clientes…"}
            {e.fase === "fim" && "Busca concluída"}
            {e.fase === "parada" && "Busca interrompida (o que já veio foi salvo)"}
            {e.fase === "erro" && "A busca parou com erro"}
          </h2>
          {ativa && (
            <p className="mt-1 text-xs text-warning-ink">
              <AlertTriangle className="mr-1 inline size-3.5" />
              Não feche nem recarregue esta aba até terminar.
            </p>
          )}
          {e.mensagem && <p className="mt-1 text-sm text-danger-ink">{e.mensagem}</p>}
        </div>
        {ativa ? (
          <Button variant="outline" onClick={onParar} disabled={e.fase === "concluindo"}>
            <CircleStop /> Parar
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onFechar}>
            Fechar
          </Button>
        )}
      </div>

      {(e.fase === "coletando" || e.fase === "aguardando") && (
        <div className="mt-4 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {e.oab && (
                <>
                  OAB <span className="font-mono text-foreground">{oabTexto(e.oab)}</span>
                  {e.oabTotal > 1 && ` (${e.oabIndice + 1} de ${e.oabTotal})`} ·{" "}
                </>
              )}
              página <span className="num text-foreground">{e.pagina}</span>
              {e.paginas ? (
                <>
                  {" "}
                  de <span className="num text-foreground">{e.paginas}</span>
                </>
              ) : null}
            </span>
            {e.fase === "aguardando" && (
              <span className="inline-flex items-center gap-1 font-medium text-warning-ink">
                <Timer className="size-3.5" /> tentando de novo em {e.espera}s
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-linear-to-r from-navy to-brand transition-all" style={{ width: `${e.paginas ? pct : 5}%` }} />
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xl font-semibold num">{numero(e.comunicacoes)}</p>
          <p className="text-[11px] text-muted-foreground">comunicações</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xl font-semibold num">{numero(e.encontrados)}</p>
          <p className="text-[11px] text-muted-foreground">processos encontrados</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xl font-semibold num">{numero(e.intimacoes)}</p>
          <p className="text-[11px] text-muted-foreground">intimações em processos já importados</p>
        </div>
      </div>
      {resumo.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {resumo.map(([t, n]) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs">
              <span className="font-mono font-medium">{t}</span> <span className="num text-muted-foreground">{n}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ================================================================ histórico
function Historico({ ativo, onAbrir }: { ativo: number | null; onAbrir: (id: number) => void }) {
  const q = useVarreduras();
  const lista = q.data ?? [];
  return (
    <section className="card-surface flex flex-col overflow-hidden" aria-label="Buscas anteriores">
      <h2 className="flex items-center gap-2 border-b px-4 py-3 font-semibold">
        <History className="size-4 text-info-ink" /> Buscas anteriores
      </h2>
      <div className="max-h-140 flex-1 divide-y overflow-y-auto">
        {q.isPending && <Skeleton className="m-4 h-24" />}
        {!q.isPending && lista.length === 0 && <EmptyState icone={History} titulo="Nenhuma busca ainda" descricao="As buscas feitas aparecem aqui para reabrir." className="py-8" />}
        {lista.map((v) => {
          const st = STATUS_VARREDURA[v.status] ?? { l: v.status, tom: "neutral" as const };
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onAbrir(v.id)}
              className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent/50", ativo === v.id && "bg-brand/8")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{v.advogado_nome ?? "—"}</span>
                <StatusBadge tom={st.tom} label={st.l} pulse={v.status === "rodando"} />
              </span>
              <span className="text-xs text-muted-foreground">
                {dataHora(v.iniciada_em)} · <span className="num">{numero(v.total_encontrados)}</span> processo(s) ·{" "}
                <span className="num">{numero(v.total_comunicacoes)}</span> comunicação(ões)
              </span>
              {(v.data_inicio || v.data_fim) && (
                <span className="text-[11px] text-muted-foreground">
                  período {data(v.data_inicio)} a {data(v.data_fim)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ================================================================ resultado
function Resultado({
  id,
  coletandoAqui,
  onRetomar,
}: {
  id: number;
  coletandoAqui: boolean;
  onRetomar: (v: Varredura) => void;
}) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeImportar = pode("trib_processos.importar");
  const [busca, setBusca] = useState("");
  const q = useDebounce(busca, 300);
  const [tribunal, setTribunal] = useState("");
  const [status, setStatus] = useState("");
  const [soClientes, setSoClientes] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [confirmarTodos, setConfirmarTodos] = useState(false);
  const [encerrar, setEncerrar] = useState(false);

  const filtros = { tribunal, status, q, so_clientes: soClientes, pagina };
  const r = useVarredura(id, filtros, coletandoAqui);
  const v = r.data;
  const itens = v?.encontrados ?? [];
  const importaveis = (v?.por_status.nao_importar ?? 0) + (v?.por_status.erro ?? 0);
  const naFila = v?.por_status.fila ?? 0;
  const rodando = v?.status === "rodando";
  const selecionavel = (e: Encontrado) => e.status_importacao === "nao_importar" || e.status_importacao === "erro";

  const importar = useMutation({
    mutationFn: (corpo: { encontrado_ids?: number[]; todos?: boolean }) => api.post<{ na_fila: number }>(`/tribunais/varreduras/${id}/importar`, corpo),
    onSuccess: (res) => {
      toast.success(`${res.na_fila} processo(s) na fila para importar`, { description: "O robô traz capa, partes e movimentações de cada um. Acompanhe por aqui." });
      setSel(new Set());
      setConfirmarTodos(false);
      qc.invalidateQueries({ queryKey: [CHAVE] });
    },
  });
  const concluir = useMutation({
    mutationFn: () => api.post<Varredura>(`/tribunais/varreduras/${id}/concluir`, { parcial: true }),
    onSuccess: () => {
      toast.success("Busca encerrada com o que já foi coletado");
      setEncerrar(false);
      qc.invalidateQueries({ queryKey: [CHAVE] });
    },
  });

  if (r.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (!v) return null;

  const st = STATUS_VARREDURA[v.status] ?? { l: v.status, tom: "neutral" as const };
  const tribunaisDaBusca = Object.keys(v.resumo_por_tribunal ?? {});
  const marcaveis = itens.filter(selecionavel);
  const todosMarcados = marcaveis.length > 0 && marcaveis.every((e) => sel.has(e.id));
  const filtrando = !!(q || tribunal || status || soClientes);
  const mudar = (fn: () => void) => {
    fn();
    setPagina(1);
  };

  return (
    <section className="space-y-4" aria-label="Resultado da busca">
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{v.advogado_nome}</span>
              {v.inscricoes_oab.map((o) => (
                <Pill key={oabTexto(o)} tom="neutral" className="font-mono normal-case">
                  {oabTexto(o)}
                </Pill>
              ))}
              <StatusBadge tom={st.tom} label={st.l} pulse={rodando} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Iniciada {dataHora(v.iniciada_em)}
              {v.concluida_em && ` · encerrada ${dataHora(v.concluida_em)}`}
              {(v.data_inicio || v.data_fim) && ` · período ${data(v.data_inicio)} a ${data(v.data_fim)}`}
              {v.tribunais_alvo.length > 0 && ` · só ${v.tribunais_alvo.join(", ")}`}
              {" · "}
              <span className="num text-foreground">{numero(v.total_encontrados)}</span> processo(s) em{" "}
              <span className="num text-foreground">{numero(v.total_comunicacoes)}</span> comunicação(ões)
            </p>
            {v.erro && <p className="mt-1 text-sm text-danger-ink">{v.erro}</p>}
          </div>
          {rodando && v.coleta === "navegador" && !coletandoAqui && podeImportar && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => onRetomar(v)}>
                <Play /> Retomar coleta
              </Button>
              <Button variant="ghost" onClick={() => setEncerrar(true)}>
                <CircleStop /> Encerrar
              </Button>
            </div>
          )}
        </div>
        {rodando && v.coleta === "servidor" && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-brand/8 px-3 py-2 text-sm text-info-ink">
            <Loader2 className="size-4 animate-spin" /> O servidor está coletando no DJEN. Pode sair desta tela: o resultado fica salvo.
          </p>
        )}
        {rodando && v.coleta === "navegador" && !coletandoAqui && (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-ink">
            Esta busca não terminou (a aba pode ter sido fechada no meio). Retome para continuar de onde der (as comunicações repetidas são ignoradas) ou encerre com o que já veio.
          </p>
        )}
        {tribunaisDaBusca.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tribunaisDaBusca.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tribunal === t}
                onClick={() => mudar(() => setTribunal(tribunal === t ? "" : t))}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                  tribunal === t ? "border-brand bg-brand/10 text-info-ink" : "hover:border-brand/40",
                )}
              >
                <span className="font-mono font-medium">{t}</span> <span className="num text-muted-foreground">{v.resumo_por_tribunal[t]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <TableCard>
        <Toolbar>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={busca} onChange={(x) => mudar(() => setBusca(x))} placeholder="Parte, número ou classe" className="sm:w-64" />
            <NativeSelect aria-label="Tribunal" value={tribunal} onChange={(e) => mudar(() => setTribunal(e.target.value))} className="h-9 w-36">
              <option value="">Todos os tribunais</option>
              {tribunaisDaBusca.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Situação" value={status} onChange={(e) => mudar(() => setStatus(e.target.value))} className="h-9 w-40">
              <option value="">Todas as situações</option>
              {(Object.keys(STATUS_IMPORTACAO) as StatusImportacao[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_IMPORTACAO[s].l}
                  {v.por_status[s] ? ` (${v.por_status[s]})` : ""}
                </option>
              ))}
            </NativeSelect>
            <label className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm">
              <Checkbox checked={soClientes} onCheckedChange={(x) => mudar(() => setSoClientes(!!x))} aria-label="Só possíveis clientes" /> Só possíveis clientes
            </label>
          </div>
          {podeImportar && (
            <div className="flex flex-wrap items-center gap-2">
              {naFila > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-info-ink">
                  <Loader2 className="size-3.5 animate-spin" /> importando {naFila}
                </span>
              )}
              <Button variant="outline" disabled={rodando || sel.size === 0 || importar.isPending} onClick={() => importar.mutate({ encontrado_ids: [...sel] })}>
                <Download /> Importar selecionados{sel.size > 0 && ` (${sel.size})`}
              </Button>
              <Button disabled={rodando || importaveis === 0 || importar.isPending} onClick={() => setConfirmarTodos(true)}>
                <Download /> Importar todos{importaveis > 0 && ` (${importaveis})`}
              </Button>
            </div>
          )}
        </Toolbar>
        {r.isFetching && itens.length === 0 ? (
          <TableSkeleton colunas={6} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={ScanSearch}
            titulo={filtrando ? "Nenhum processo com esses filtros" : rodando ? "Coletando…" : "Nenhum processo encontrado"}
            descricao={
              filtrando
                ? "Troque ou limpe os filtros."
                : rodando
                  ? "Os processos aparecem aqui conforme as páginas do DJEN chegam."
                  : "O DJEN não trouxe comunicações para esta OAB no período. Tente um período maior."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-245 text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    {podeImportar && (
                      <Checkbox
                        checked={todosMarcados}
                        disabled={rodando || marcaveis.length === 0}
                        onCheckedChange={(x) => setSel(x ? new Set([...sel, ...marcaveis.map((e) => e.id)]) : new Set([...sel].filter((i) => !marcaveis.some((e) => e.id === i))))}
                        aria-label="Selecionar todos desta página"
                      />
                    )}
                  </th>
                  <th className="px-3 py-2.5 font-medium">Processo</th>
                  <th className="px-3 py-2.5 font-medium">Partes</th>
                  <th className="px-3 py-2.5 font-medium">Classe e órgão</th>
                  <th className="px-3 py-2.5 font-medium">Última comunicação</th>
                  <th className="px-3 py-2.5 font-medium">Possível cliente</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((e) => {
                  const si = STATUS_IMPORTACAO[e.status_importacao] ?? { l: e.status_importacao, tom: "neutral" as const };
                  const marcado = sel.has(e.id);
                  return (
                    <tr key={e.id} className={cn("align-top", marcado && "bg-brand/5")}>
                      <td className="px-4 py-3">
                        {podeImportar && selecionavel(e) && (
                          <Checkbox
                            checked={marcado}
                            disabled={rodando}
                            onCheckedChange={(x) => {
                              const n = new Set(sel);
                              if (x) n.add(e.id);
                              else n.delete(e.id);
                              setSel(n);
                            }}
                            aria-label={`Selecionar ${e.numero_formatado}`}
                          />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {e.processo_id ? (
                          <Link href={`/tribunais/processos/${e.processo_id}`} className="font-mono text-xs font-medium text-info-ink underline-offset-4 hover:underline">
                            {e.numero_formatado}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs font-medium">{e.numero_formatado}</span>
                        )}
                        <p className="mt-1 flex flex-wrap items-center gap-1">
                          {e.tribunal && <Pill tom="brand">{e.tribunal}</Pill>}
                          {e.sistema_provavel && <span className="text-[11px] text-muted-foreground">{rotuloSistema(e.sistema_provavel)}</span>}
                          {e.segredo_justica && <Lock className="size-3 text-warning-ink" aria-label="Segredo de justiça" />}
                        </p>
                      </td>
                      <td className="max-w-64 px-3 py-3">
                        <span className="line-clamp-2">{e.partes_resumo ?? "—"}</span>
                      </td>
                      <td className="max-w-64 px-3 py-3">
                        <p className="line-clamp-1">{e.classe_resumo ?? "—"}</p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{e.orgao_resumo}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs">{data(e.ultima_movimentacao_em)}</span>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="num">{e.comunicacoes}</span> comunicação(ões)
                        </p>
                      </td>
                      <td className="max-w-52 px-3 py-3">
                        {e.possivel_cliente_nome ? (
                          <>
                            <p className="truncate font-medium">{e.possivel_cliente_nome}</p>
                            {e.possivel_cliente_criterio && (
                              <Pill tom={e.possivel_cliente_criterio === "nome_fuzzy" ? "warning" : "success"} className="mt-1 normal-case">
                                {CRITERIO[e.possivel_cliente_criterio] ?? e.possivel_cliente_criterio}
                              </Pill>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span title={e.erro ?? undefined}>
                          <StatusBadge tom={si.tom} label={e.ja_importado && e.status_importacao === "importado" ? "Já no sistema" : si.l} pulse={e.status_importacao === "fila"} />
                        </span>
                        {e.erro && <p className="mt-1 line-clamp-2 max-w-48 text-[11px] text-danger-ink">{e.erro}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={pagina} porPagina={POR_PAGINA_ENCONTRADOS} total={v.total_filtrado} onChange={setPagina} />
      </TableCard>

      <ConfirmDialog
        open={confirmarTodos}
        onOpenChange={setConfirmarTodos}
        titulo={`Importar ${importaveis} processo(s)?`}
        descricao="Entram na fila todos os processos desta busca que ainda não estão no sistema (inclusive os de outras páginas e filtros). Cada um passa a ser monitorado."
        confirmar="Importar todos"
        carregando={importar.isPending}
        onConfirm={() => importar.mutate({ todos: true })}
      />
      <ConfirmDialog
        open={encerrar}
        onOpenChange={setEncerrar}
        titulo="Encerrar esta busca?"
        descricao="Fica salvo o que já foi coletado, e você pode importar os processos encontrados."
        confirmar="Encerrar"
        carregando={concluir.isPending}
        onConfirm={() => concluir.mutate()}
      />
    </section>
  );
}

// ================================================================ página
function VarreduraTela() {
  const { pode } = useAuth();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const vid = Number(sp.get("v")) || null;
  const abrir = (id: number | null) => router.replace(id ? `${pathname}?v=${id}` : pathname, { scroll: false });
  const coleta = useColetaDjen((fim) => {
    qc.invalidateQueries({ queryKey: [CHAVE] });
    if (fim) {
      if (fim.status === "erro") toast.error("A busca parou com erro", { description: fim.erro ?? undefined });
      else toast.success(`${fim.total_encontrados} processo(s) encontrados`, { description: "Escolha quais importar na lista abaixo." });
    }
  });

  if (!pode("trib_processos.ver")) return <SemAcesso />;
  const podeBuscar = pode("trib_processos.importar");
  const coletandoEsta = coleta.ativa && coleta.estado?.varreduraId === vid;

  const iniciada = (v: Varredura) => {
    abrir(v.id);
    qc.invalidateQueries({ queryKey: [CHAVE, "varreduras"] });
    if (v.coleta === "navegador") void coleta.iniciar(v);
    else toast.success("Busca iniciada pelo servidor", { description: "Acompanhe o resultado aqui." });
  };

  return (
    <div className="space-y-6">
      <PageHeader titulo="Buscar pela OAB" icone={ScanSearch} migalhas={[{ label: "Tribunais", href: "/tribunais" }, { label: "Buscar pela OAB" }]} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {podeBuscar ? (
            <NovaBusca bloqueado={coleta.ativa} onIniciada={iniciada} />
          ) : (
            <div className="card-surface p-5 text-sm text-muted-foreground">Seu perfil pode ver as buscas, mas não iniciar novas nem importar processos.</div>
          )}
          {coleta.estado && <Progresso e={coleta.estado} onParar={coleta.parar} onFechar={coleta.limpar} />}
        </div>
        <Historico ativo={vid} onAbrir={(id) => abrir(id)} />
      </div>

      {vid && (
        <Resultado
          key={vid}
          id={vid}
          coletandoAqui={!!coletandoEsta}
          onRetomar={(v) => {
            if (coleta.ativa) return toast.error("Já há uma busca em andamento nesta aba.");
            void coleta.iniciar(v);
          }}
        />
      )}
    </div>
  );
}

export default function VarreduraPage() {
  return (
    <Suspense fallback={null}>
      <VarreduraTela />
    </Suspense>
  );
}
