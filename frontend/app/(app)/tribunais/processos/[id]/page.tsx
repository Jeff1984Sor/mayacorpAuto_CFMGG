"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Briefcase,
  CalendarPlus,
  Check,
  CheckCheck,
  ExternalLink,
  FileDown,
  FilePlus2,
  FileSignature,
  FileText,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Scale,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { type ClienteEscolhido, ClientesMulti } from "@/components/faturamento/clientes-multi";
import { useProfissionais } from "@/components/faturamento/dialogos";
import { CasoCombo } from "@/components/faturamento/tarefas";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pagination, Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { TarefaPrazoDialog } from "@/components/tribunais/tarefa-prazo-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { abrirArquivo, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ContratoOut } from "@/lib/faturamento";
import { data, dataHora, documento, moeda, numero, relativo, tamanhoArquivo } from "@/lib/format";
import {
  CHAVE,
  CRITERIO,
  FONTE,
  type Movimentacao,
  type Parte,
  POLO,
  POR_PAGINA_MOVS,
  type ProcessoDetalhe,
  rotuloGrau,
  rotuloSistema,
  SITUACAO,
  type Situacao,
  STATUS_DOWNLOAD,
  STATUS_PROTOCOLO,
  STATUS_VINCULO,
  TIPO_PROTOCOLO,
  useMovimentacoes,
  useProcesso,
} from "@/lib/tribunais";
import { cn } from "@/lib/utils";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function Info({ rotulo, children, className }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{rotulo}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

// ================================================================ gestão interna
function Gestao({ p }: { p: ProcessoDetalhe }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("trib_processos.editar");
  const profs = useProfissionais();
  const [statusInterno, setStatusInterno] = useState(p.status_interno ?? "");
  /* eslint-disable react-hooks/set-state-in-effect -- acompanha o valor salvo */
  useEffect(() => setStatusInterno(p.status_interno ?? ""), [p.status_interno]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<ProcessoDetalhe>(`/tribunais/processos/${p.id}`, patch),
    onSuccess: (r) => {
      qc.setQueryData([CHAVE, "processo", p.id], r);
      qc.invalidateQueries({ queryKey: [CHAVE, "processos"] });
      toast.success("Processo atualizado");
    },
  });
  return (
    <section className="card-surface grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Gestão no escritório">
      <Field label="Responsável no escritório" htmlFor="pr-resp">
        <NativeSelect
          id="pr-resp"
          value={p.responsavel_interno_id ?? ""}
          disabled={!podeEditar || salvar.isPending}
          onChange={(e) => salvar.mutate({ responsavel_interno_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Sem responsável</option>
          {profs.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.nome}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Situação" htmlFor="pr-sit">
        <NativeSelect id="pr-sit" value={p.situacao} disabled={!podeEditar || salvar.isPending} onChange={(e) => salvar.mutate({ situacao: e.target.value })}>
          {(Object.keys(SITUACAO) as Situacao[]).map((s) => (
            <option key={s} value={s}>
              {SITUACAO[s].l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Status interno" htmlFor="pr-status" dica="Anotação livre (ex.: aguardando cliente).">
        <Input
          id="pr-status"
          value={statusInterno}
          maxLength={60}
          disabled={!podeEditar}
          onChange={(e) => setStatusInterno(e.target.value)}
          onBlur={() => statusInterno !== (p.status_interno ?? "") && salvar.mutate({ status_interno: statusInterno.trim() || null })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-foreground/80">Monitorar</span>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={p.monitorar} disabled={!podeEditar || salvar.isPending} onCheckedChange={(v) => salvar.mutate({ monitorar: v })} aria-label="Monitorar o processo" />
          {p.monitorar ? "Sincroniza todo dia" : "Parado"}
        </label>
      </div>
    </section>
  );
}

// ================================================================ movimentações
function Movimentacoes({ p }: { p: ProcessoDetalhe }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("trib_processos.editar");
  const [filtro, setFiltro] = useState<"todas" | "intimacoes" | "nao_lidas">("todas");
  const [pagina, setPagina] = useState(1);
  const [tarefa, setTarefa] = useState<Movimentacao | null>(null);
  const q = useMovimentacoes(p.id, { so_intimacoes: filtro === "intimacoes", nao_lidas: filtro === "nao_lidas", pagina });
  const lidas = useMutation({
    mutationFn: (corpo: { ids?: number[]; todas?: boolean }) => api.post<{ marcadas: number }>(`/tribunais/processos/${p.id}/movimentacoes/lidas`, corpo),
    onSuccess: (r) => {
      if (r.marcadas > 1) toast.success(`${r.marcadas} movimentações marcadas como lidas`);
      qc.invalidateQueries({ queryKey: [CHAVE] });
    },
  });
  const itens = q.data?.itens ?? [];
  const grupos: { mes: string; itens: Movimentacao[] }[] = [];
  itens.forEach((m) => {
    const k = (m.data_hora ?? "").slice(0, 7);
    const g = grupos.at(-1);
    if (g && g.mes === k) g.itens.push(m);
    else grupos.push({ mes: k, itens: [m] });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={filtro}
          onChange={(v) => {
            setFiltro(v);
            setPagina(1);
          }}
          opcoes={[
            { value: "todas", label: "Todas", contagem: p.total_movimentacoes },
            { value: "intimacoes", label: "Intimações" },
            { value: "nao_lidas", label: "Não lidas", contagem: p.movimentacoes_nao_lidas, tom: p.movimentacoes_nao_lidas ? "danger" : undefined },
          ]}
        />
        {podeEditar && p.movimentacoes_nao_lidas > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={lidas.isPending} onClick={() => lidas.mutate({ todas: true })}>
            <CheckCheck /> Marcar todas como lidas
          </Button>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : itens.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Scale}
            titulo={filtro === "todas" ? "Nenhuma movimentação" : "Nada com este filtro"}
            descricao={filtro === "todas" ? "Use Sincronizar para buscar as movimentações no tribunal." : "Troque o filtro acima."}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {grupos.map((g) => (
            <section key={g.mes || "sem-data"} aria-label={g.mes}>
              <h3 className="mb-3 inline-block rounded-full bg-background/90 px-3 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase ring-1 ring-border">
                {g.mes ? `${MESES[Number(g.mes.slice(5)) - 1]} de ${g.mes.slice(0, 4)}` : "Sem data"}
              </h3>
              <ol className="relative ml-4 space-y-3 border-l pl-6">
                {g.itens.map((m, i) => (
                  <motion.li key={m.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }} className="relative">
                    <span
                      className={cn(
                        "absolute top-3 -left-[39px] grid size-7 place-items-center rounded-full ring-4 ring-background",
                        m.e_intimacao ? "bg-warning/14 text-warning-ink" : "bg-brand/12 text-info-ink",
                      )}
                    >
                      {m.e_intimacao ? <Bell className="size-3.5" /> : <Scale className="size-3.5" />}
                    </span>
                    <article className={cn("card-surface p-3.5", m.e_intimacao && "border-warning/40 bg-warning/4", !m.lida && "ring-1 ring-brand/40")}>
                      <header className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="font-mono">{dataHora(m.data_hora)}</span>
                            <Pill tom={m.fonte === "djen" ? "warning" : m.fonte === "mni" ? "success" : "neutral"}>{FONTE[m.fonte] ?? m.fonte}</Pill>
                            {m.e_intimacao && <Pill tom="warning">intimação</Pill>}
                            {!m.lida && <Pill tom="brand">nova</Pill>}
                            {m.nivel_sigilo > 0 && <Lock className="size-3 text-warning-ink" aria-label="Sigilosa" />}
                            {m.orgao && <span className="truncate">· {m.orgao}</span>}
                          </p>
                        </div>
                        {m.prazo_final && (
                          <Pill tom="danger" className="normal-case">
                            prazo {data(m.prazo_final)}
                          </Pill>
                        )}
                        {m.e_intimacao &&
                          (m.tarefa_id ? (
                            <Pill tom="success">tarefa criada</Pill>
                          ) : (
                            podeEditar && (
                              <Button size="xs" variant="outline" onClick={() => setTarefa(m)}>
                                <CalendarPlus /> Criar tarefa de prazo
                              </Button>
                            )
                          ))}
                        {podeEditar && !m.lida && (
                          <Button size="icon-xs" variant="ghost" aria-label="Marcar como lida" disabled={lidas.isPending} onClick={() => lidas.mutate({ ids: [m.id] })}>
                            <Check />
                          </Button>
                        )}
                      </header>
                      <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{m.descricao}</p>
                    </article>
                  </motion.li>
                ))}
              </ol>
            </section>
          ))}
          {(q.data?.total ?? 0) > POR_PAGINA_MOVS && (
            <div className="card-surface overflow-hidden">
              <Pagination pagina={pagina} porPagina={POR_PAGINA_MOVS} total={q.data?.total ?? 0} onChange={setPagina} />
            </div>
          )}
        </div>
      )}
      <TarefaPrazoDialog mov={tarefa} numero={p.numero_formatado} responsavelPadrao={p.responsavel_interno_id} onOpenChange={(o) => !o && setTarefa(null)} />
    </div>
  );
}

// ================================================================ vincular cliente
function VincularDialog({ p, parteId, open, onOpenChange }: { p: ProcessoDetalhe; parteId: number | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [parte, setParte] = useState("");
  /* eslint-disable react-hooks/set-state-in-effect -- reinicia ao abrir */
  useEffect(() => {
    if (!open) return;
    setCliente([]);
    setParte(parteId ? String(parteId) : "");
  }, [open, parteId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const vincular = useMutation({
    mutationFn: () => api.post<ProcessoDetalhe>(`/tribunais/processos/${p.id}/vinculos`, { cliente_id: cliente[0].id, parte_id: parte ? Number(parte) : null }),
    onSuccess: (r) => {
      qc.setQueryData([CHAVE, "processo", p.id], r);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      toast.success(`Processo vinculado a ${cliente[0].nome}`);
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Vincular cliente"
      rotuloSalvar="Vincular"
      salvando={vincular.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!cliente[0]) return toast.error("Escolha o cliente.");
        vincular.mutate();
      }}
    >
      <div className="grid gap-4">
        <Field label="Cliente" obrigatorio htmlFor="vin-cli">
          <ClientesMulti unico id="vin-cli" valor={cliente} onChange={setCliente} />
        </Field>
        <Field label="Qual parte é o cliente" htmlFor="vin-parte" dica="Opcional, mas ajuda a saber o polo do cliente.">
          <NativeSelect id="vin-parte" value={parte} onChange={(e) => setParte(e.target.value)}>
            <option value="">Não sei / não informar</option>
            {p.partes.map((pa) => (
              <option key={pa.id} value={pa.id}>
                {pa.pessoa.nome} ({POLO[pa.polo] ?? pa.polo})
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </FormDialog>
  );
}

// ================================================================ partes
function Partes({ p, onVincular }: { p: ProcessoDetalhe; onVincular: (parteId: number) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { pode } = useAuth();
  const podeEditar = pode("trib_processos.editar");
  const podeCliente = podeEditar && pode("clientes.editar");
  const criar = useMutation({
    mutationFn: (parte: Parte) => api.post<{ cliente_id: number; processo: ProcessoDetalhe }>(`/tribunais/processos/${p.id}/criar-cliente`, { parte_id: parte.id }),
    onSuccess: (r, parte) => {
      qc.setQueryData([CHAVE, "processo", p.id], r.processo);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      toast.success(`Cliente ${parte.pessoa.nome} cadastrado e vinculado`, {
        action: { label: "Abrir cliente", onClick: () => router.push(`/cadastros/clientes?id=${r.cliente_id}`) },
      });
    },
  });
  if (p.partes.length === 0)
    return (
      <div className="card-surface">
        <EmptyState icone={Users} titulo="Partes ainda não conhecidas" descricao="Com o certificado do advogado, a sincronização traz as partes completas do tribunal." />
      </div>
    );
  const polos = [...new Set(p.partes.map((x) => x.polo))];
  const vinculada = (pa: Parte) => p.vinculos.some((v) => v.parte_id === pa.id && v.status !== "rejeitado");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {polos.map((polo) => (
        <section key={polo} className="card-surface p-4" aria-label={POLO[polo] ?? polo}>
          <h3 className="mb-3 text-sm font-semibold">{POLO[polo] ?? polo}</h3>
          <ul className="space-y-3">
            {p.partes
              .filter((x) => x.polo === polo)
              .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
              .map((pa) => {
                const doc = pa.pessoa.cnpj || pa.pessoa.cpf;
                return (
                  <li key={pa.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{pa.pessoa.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {pa.tipo_participacao && <>{pa.tipo_participacao} · </>}
                          {doc ? <span className="font-mono">{documento(doc)}</span> : pa.pessoa.documento_parcial ? <span className="font-mono">{pa.pessoa.documento_parcial}</span> : "sem documento"}
                          {pa.assistencia_judiciaria && " · justiça gratuita"}
                        </p>
                      </div>
                      {vinculada(pa) ? (
                        <Pill tom="success">cliente</Pill>
                      ) : (
                        podeEditar && (
                          <div className="flex flex-wrap gap-1">
                            {pode("clientes.ver") && (
                              <Button size="xs" variant="ghost" onClick={() => onVincular(pa.id)}>
                                <Link2 /> Vincular
                              </Button>
                            )}
                            {podeCliente && (
                              <Button size="xs" variant="outline" disabled={criar.isPending} onClick={() => criar.mutate(pa)}>
                                <UserPlus /> Criar cliente a partir da parte
                              </Button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                    {pa.advogados.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t pt-2">
                        {pa.advogados.map((a) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <span>{a.nome}</span>
                            {a.oab_numero && (
                              <span className="font-mono text-muted-foreground">
                                OAB {a.oab_numero}
                                {a.oab_uf ? `/${a.oab_uf}` : ""}
                              </span>
                            )}
                            {a.e_o_usuario && <Pill tom="brand">Você</Pill>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ================================================================ cliente e caso
function CriarCasoDialog({ p, open, onOpenChange }: { p: ProcessoDetalhe; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const clientes = [...new Map(p.vinculos.filter((v) => v.status === "automatico" || v.status === "confirmado").map((v) => [v.cliente_id, v.cliente_nome ?? `Cliente ${v.cliente_id}`])).entries()];
  const [cliente, setCliente] = useState("");
  const [contrato, setContrato] = useState("");
  const [titulo, setTitulo] = useState("");
  const clienteId = cliente || (clientes[0] ? String(clientes[0][0]) : "");
  const contratos = useQuery({
    queryKey: ["fat", "contratos", "do-cliente", clienteId],
    queryFn: () => api.get<ContratoOut[]>("/faturamento/contratos", { tomador_id: clienteId, ativos: true }),
    enabled: open && !!clienteId,
  });
  const contratoId = contrato || (contratos.data?.[0] ? String(contratos.data[0].id) : "");
  const criar = useMutation({
    mutationFn: () => api.post<{ caso_id: number; caso_numero: number; processo: ProcessoDetalhe }>(`/tribunais/processos/${p.id}/caso`, { contrato_id: Number(contratoId), titulo: titulo.trim() || null }),
    onSuccess: (r) => {
      qc.setQueryData([CHAVE, "processo", p.id], r.processo);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      qc.invalidateQueries({ queryKey: ["fat"] });
      toast.success(`Caso #${r.caso_numero} criado`, { description: "As movimentações viraram andamentos do caso.", action: { label: "Abrir", onClick: () => router.push(`/faturamento/casos/${r.caso_id}`) } });
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Criar caso a partir do processo"
      rotuloSalvar="Criar caso"
      salvando={criar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!contratoId) return toast.error("Escolha o contrato.");
        criar.mutate();
      }}
    >
      {clientes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Vincule (ou confirme) o cliente deste processo primeiro: o caso fica dentro de um contrato do cliente.</p>
      ) : (
        <div className="grid gap-4">
          <Field label="Cliente" htmlFor="cc-cli">
            <NativeSelect
              id="cc-cli"
              value={clienteId}
              onChange={(e) => {
                setCliente(e.target.value);
                setContrato("");
              }}
            >
              {clientes.map(([cid, nome]) => (
                <option key={cid} value={cid}>
                  {nome}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Contrato"
            obrigatorio
            htmlFor="cc-contrato"
            dica={
              contratos.data && contratos.data.length === 0 ? (
                <span className="text-warning-ink">
                  Este cliente não tem contrato ativo.{" "}
                  <Link href="/faturamento/contratos" className="underline underline-offset-4">
                    Cadastrar contrato
                  </Link>
                </span>
              ) : undefined
            }
          >
            <NativeSelect id="cc-contrato" value={contratoId} onChange={(e) => setContrato(e.target.value)} disabled={contratos.isPending}>
              {contratos.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.numero} {c.nome}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Título do caso" htmlFor="cc-titulo" dica="Vazio: classe e número do processo.">
            <Input id="cc-titulo" value={titulo} maxLength={250} onChange={(e) => setTitulo(e.target.value)} placeholder={`${p.classe_nome ?? "Processo"} — ${p.numero_formatado}`} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}

function LigarCasoDialog({ p, open, onOpenChange }: { p: ProcessoDetalhe; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [caso, setCaso] = useState<number | null>(null);
  const ligar = useMutation({
    mutationFn: () => api.post<ProcessoDetalhe>(`/tribunais/processos/${p.id}/ligar-caso`, { caso_id: caso }),
    onSuccess: (r) => {
      qc.setQueryData([CHAVE, "processo", p.id], r);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      qc.invalidateQueries({ queryKey: ["fat"] });
      toast.success(`Processo ligado ao caso #${r.caso_numero}`);
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Ligar a um caso existente"
      rotuloSalvar="Ligar"
      salvando={ligar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!caso) return toast.error("Escolha o caso.");
        ligar.mutate();
      }}
    >
      <Field label="Caso" obrigatorio htmlFor="lc-caso" dica="As movimentações do processo entram como andamentos do caso.">
        <CasoCombo id="lc-caso" value={caso} onChange={setCaso} rotuloVazio="Escolha o caso" />
      </Field>
    </FormDialog>
  );
}

function ClienteECaso({ p, onVincular }: { p: ProcessoDetalhe; onVincular: () => void }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("trib_processos.editar");
  const [criarCaso, setCriarCaso] = useState(false);
  const [ligar, setLigar] = useState(false);
  const acao = useMutation({
    mutationFn: ({ id, tipo }: { id: number; tipo: "confirmar" | "rejeitar" }) => api.post<ProcessoDetalhe>(`/tribunais/vinculos/${id}/${tipo}`),
    onSuccess: (r, { tipo }) => {
      qc.setQueryData([CHAVE, "processo", p.id], r);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      toast.success(tipo === "confirmar" ? "Vínculo confirmado" : "Vínculo rejeitado");
    },
  });
  const parteNome = (id: number | null) => p.partes.find((x) => x.id === id)?.pessoa.nome;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="card-surface overflow-hidden lg:col-span-3" aria-label="Clientes vinculados">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">Clientes</h3>
          {podeEditar && pode("clientes.ver") && (
            <Button size="sm" variant="outline" onClick={onVincular}>
              <Link2 /> Vincular cliente
            </Button>
          )}
        </div>
        {p.vinculos.length === 0 ? (
          <EmptyState icone={Users} titulo="Nenhum cliente vinculado" descricao="O robô compara as partes com o cadastro de clientes. Se não achou, vincule à mão ou crie o cliente a partir de uma parte." className="py-10" />
        ) : (
          <ul className="divide-y">
            {p.vinculos.map((v) => {
              const st = STATUS_VINCULO[v.status] ?? { l: v.status, tom: "neutral" as const };
              return (
                <li key={v.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", v.status === "rejeitado" && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{v.cliente_nome ?? `Cliente ${v.cliente_id}`}</p>
                    <p className="text-xs text-muted-foreground">
                      {CRITERIO[v.criterio] ?? v.criterio} · confiança <span className="num">{Math.round(v.confianca * 100)}%</span>
                      {parteNome(v.parte_id) && ` · parte ${parteNome(v.parte_id)}`}
                      {v.polo_cliente && ` (${(POLO[v.polo_cliente] ?? v.polo_cliente).toLowerCase()})`}
                      {v.confirmado_por && ` · por ${v.confirmado_por} ${relativo(v.confirmado_em)}`}
                    </p>
                  </div>
                  <StatusBadge tom={st.tom} label={st.l} />
                  {podeEditar && (v.status === "sugerido" || v.status === "automatico") && (
                    <div className="flex gap-1">
                      <Button size="xs" variant="outline" disabled={acao.isPending} onClick={() => acao.mutate({ id: v.id, tipo: "confirmar" })}>
                        <Check /> Confirmar
                      </Button>
                      <Button size="xs" variant="ghost" disabled={acao.isPending} onClick={() => acao.mutate({ id: v.id, tipo: "rejeitar" })}>
                        <X /> Rejeitar
                      </Button>
                    </div>
                  )}
                  {podeEditar && v.status === "rejeitado" && (
                    <Button size="xs" variant="ghost" disabled={acao.isPending} onClick={() => acao.mutate({ id: v.id, tipo: "confirmar" })}>
                      <Check /> Confirmar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card-surface p-5 lg:col-span-2" aria-label="Caso">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <Briefcase className="size-4 text-info-ink" /> Caso no escritório
        </h3>
        {p.caso_id ? (
          <>
            <p className="text-sm">
              Este processo está ligado ao <strong>caso #{p.caso_numero}</strong>. As movimentações novas viram andamentos do caso.
            </p>
            <Button className="mt-4" variant="outline" render={<Link href={`/faturamento/casos/${p.caso_id}`} />}>
              <Briefcase /> Abrir caso #{p.caso_numero}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Sem caso, o processo não entra em timesheet, despesas e faturamento.</p>
            {podeEditar && (
              <div className="mt-4 flex flex-wrap gap-2">
                {pode("casos.editar") && (
                  <Button onClick={() => setCriarCaso(true)}>
                    <FilePlus2 /> Criar caso
                  </Button>
                )}
                {pode("casos.ver") && (
                  <Button variant="outline" onClick={() => setLigar(true)}>
                    <Link2 /> Ligar a caso existente
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </section>
      <CriarCasoDialog p={p} open={criarCaso} onOpenChange={setCriarCaso} />
      <LigarCasoDialog p={p} open={ligar} onOpenChange={setLigar} />
    </div>
  );
}

// ================================================================ documentos
function Documentos({ p, onBaixar, baixando }: { p: ProcessoDetalhe; onBaixar: () => void; baixando: boolean }) {
  const { pode } = useAuth();
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const abrir = async (id: number) => {
    setAbrindo(id);
    try {
      await abrirArquivo(`/tribunais/documentos/${id}/arquivo`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o documento.");
    } finally {
      setAbrindo(null);
    }
  };
  const acaoBaixar = pode("trib_processos.editar") && (
    <Button variant="outline" onClick={onBaixar} disabled={baixando}>
      {baixando ? <Loader2 className="animate-spin" /> : <FileDown />} Baixar autos
    </Button>
  );
  if (p.documentos.length === 0)
    return (
      <div className="card-surface">
        <EmptyState icone={FileText} titulo="Nenhum documento dos autos" descricao="Com o certificado do advogado, o robô baixa as peças e decisões do processo." acao={acaoBaixar} />
      </div>
    );
  return (
    <section className="card-surface overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">
          Documentos <span className="text-xs font-normal text-muted-foreground num">{p.documentos.length}</span>
        </h3>
        {acaoBaixar}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Juntada</th>
              <th className="px-3 py-2.5 font-medium">Documento</th>
              <th className="px-3 py-2.5 font-medium">Tamanho</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
              <th className="w-24 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {p.documentos.map((d) => {
              const st = STATUS_DOWNLOAD[d.status_download] ?? { l: d.status_download, tom: "neutral" as const };
              return (
                <tr key={d.id} className={cn(d.id_documento_pai && "bg-muted/15")}>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{dataHora(d.data_hora_juntada)}</td>
                  <td className={cn("px-3 py-2.5", d.id_documento_pai && "pl-8")}>
                    <p className="flex items-center gap-1.5 font-medium">
                      {d.nivel_sigilo > 0 && <Lock className="size-3 text-warning-ink" aria-label="Sigiloso" />}
                      {d.tipo_documento_nome ?? "Documento"}
                    </p>
                    {d.descricao && <p className="text-xs text-muted-foreground">{d.descricao}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                    {d.tamanho_bytes ? tamanhoArquivo(d.tamanho_bytes) : "—"}
                    {d.paginas ? ` · ${d.paginas} pág.` : ""}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tom={st.tom} label={st.l} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {d.tem_arquivo && (
                      <Button size="xs" variant="ghost" disabled={abrindo === d.id} onClick={() => abrir(d.id)}>
                        {abrindo === d.id ? <Loader2 className="animate-spin" /> : <ExternalLink />} Abrir
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ================================================================ protocolos
function Protocolos({ p }: { p: ProcessoDetalhe }) {
  const { pode } = useAuth();
  const nova = pode("trib_protocolos.editar") && (
    <Button render={<Link href={`/tribunais/protocolos/novo?processo_id=${p.id}`} />}>
      <FileSignature /> Nova petição
    </Button>
  );
  if (p.protocolos.length === 0)
    return (
      <div className="card-surface">
        <EmptyState icone={FileSignature} titulo="Nenhuma petição neste processo" descricao="Petições protocoladas pelo sistema, com aprovação de um advogado, aparecem aqui." acao={nova} />
      </div>
    );
  return (
    <section className="card-surface overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">Petições</h3>
        {nova}
      </div>
      <ul className="divide-y">
        {p.protocolos.map((x) => {
          const st = STATUS_PROTOCOLO[x.status] ?? { l: x.status, tom: "neutral" as const };
          return (
            <li key={x.id}>
              <Link href={`/tribunais/protocolos/${x.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50">
                <FileSignature className="size-4 shrink-0 text-info-ink" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{x.titulo ?? TIPO_PROTOCOLO[x.tipo] ?? x.tipo}</p>
                  <p className="text-xs text-muted-foreground">
                    {TIPO_PROTOCOLO[x.tipo] ?? x.tipo} · {dataHora(x.criado_em)}
                  </p>
                </div>
                <StatusBadge tom={st.tom} label={st.l} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ================================================================ página
export default function ProcessoPage() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const qc = useQueryClient();
  const router = useRouter();
  const { pode } = useAuth();
  const q = useProcesso(pid);
  const [aba, setAba] = useState("movimentacoes");
  const [excluir, setExcluir] = useState(false);
  const [vincular, setVincular] = useState<{ parte: number | null } | null>(null);

  const sincronizar = useMutation({
    mutationFn: () => api.post<{ novas: number; mudou: boolean; processo: ProcessoDetalhe }>(`/tribunais/processos/${pid}/sincronizar`),
    onSuccess: (r) => {
      qc.setQueryData([CHAVE, "processo", pid], r.processo);
      qc.invalidateQueries({ queryKey: [CHAVE] });
      toast.success(r.novas ? `${r.novas} movimentação(ões) nova(s)` : "Processo em dia", { description: r.mudou ? "A capa do processo foi atualizada." : undefined });
    },
  });
  const baixar = useMutation({
    mutationFn: () => api.post(`/tribunais/processos/${pid}/baixar-documentos`),
    onSuccess: () => {
      toast.success("Download dos autos na fila", { description: "Os documentos aparecem aqui conforme forem baixados." });
      qc.invalidateQueries({ queryKey: [CHAVE, "jobs"] });
    },
  });
  const remover = useMutation({
    mutationFn: () => api.del(`/tribunais/processos/${pid}`),
    onSuccess: () => {
      toast.success("Processo excluído");
      qc.invalidateQueries({ queryKey: [CHAVE] });
      router.push("/tribunais/processos");
    },
  });

  if (q.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (!q.data)
    return (
      <EmptyState
        icone={Scale}
        titulo="Processo não encontrado"
        descricao={q.error?.message}
        acao={
          <Button variant="outline" render={<Link href="/tribunais/processos" />}>
            Voltar aos processos
          </Button>
        }
      />
    );
  const p = q.data;
  const podeEditar = pode("trib_processos.editar");
  const sit = SITUACAO[p.situacao] ?? { l: p.situacao, tom: "neutral" as const };
  const assuntos = (p.assuntos ?? []).map((a) => a.nome ?? a.codigo).filter(Boolean);

  return (
    <div>
      <Link href="/tribunais/processos" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Processos
      </Link>

      <div className="card-surface relative mb-4 overflow-hidden p-5">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight sm:text-2xl">{p.numero_formatado}</h1>
              <Pill tom="brand">{p.tribunal}</Pill>
              <StatusBadge tom={sit.tom} label={sit.l} />
              {p.nivel_sigilo > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/12 px-2 py-0.5 text-xs font-medium text-warning-ink">
                  <Lock className="size-3" /> sigilo nível {p.nivel_sigilo}
                </span>
              )}
              {p.segredo_justica && p.nivel_sigilo === 0 && <Pill tom="warning">segredo de justiça</Pill>}
              {p.movimentacoes_nao_lidas > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger-ink">
                  <Bell className="size-3" /> {p.movimentacoes_nao_lidas} não lida(s)
                </span>
              )}
            </div>
            <p className="mt-1 text-sm">{p.classe_nome ?? "Classe não informada"}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{p.partes_resumo}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {p.sistema_portal && (
              <Button variant="ghost" size="sm" render={<a href={p.sistema_portal} target="_blank" rel="noopener noreferrer" />}>
                <ExternalLink /> Portal {rotuloSistema(p.sistema) ?? "do tribunal"}
              </Button>
            )}
            {podeEditar && (
              <Button variant="outline" size="sm" disabled={sincronizar.isPending} onClick={() => sincronizar.mutate()}>
                <RefreshCw className={cn(sincronizar.isPending && "animate-spin")} /> Sincronizar
              </Button>
            )}
            {podeEditar && (
              <Button variant="outline" size="sm" disabled={baixar.isPending} onClick={() => baixar.mutate()}>
                {baixar.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} Baixar autos
              </Button>
            )}
            {pode("trib_processos.excluir") && (
              <Button variant="ghost" size="sm" className="text-danger-ink" onClick={() => setExcluir(true)}>
                <Trash2 /> Excluir
              </Button>
            )}
          </div>
        </div>

        {p.migrado_de_sistema && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Este processo foi migrado do sistema {rotuloSistema(p.migrado_de_sistema) ?? p.migrado_de_sistema}
            {p.migrado_em && ` em ${data(p.migrado_em)}`}. Petições vão pelo sistema atual ({rotuloSistema(p.sistema) ?? "—"}).
          </p>
        )}
        {p.sincronizacao_erro && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger/8 px-3 py-2 text-sm text-danger-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Última sincronização falhou: {p.sincronizacao_erro}
          </p>
        )}

        <dl className="mt-4 grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info rotulo="Órgão julgador">{p.orgao_julgador}</Info>
          <Info rotulo="Comarca / localidade">{p.localidade_nome}</Info>
          <Info rotulo="Sistema e grau">{[rotuloSistema(p.sistema), rotuloGrau(p.grau)].filter(Boolean).join(" · ")}</Info>
          <Info rotulo="Valor da causa">{p.valor_causa ? <span className="num">{moeda(p.valor_causa)}</span> : null}</Info>
          <Info rotulo="Ajuizamento">{p.data_ajuizamento ? data(p.data_ajuizamento) : null}</Info>
          <Info rotulo="Magistrado">{p.magistrado}</Info>
          <Info rotulo="Advogado da importação">{p.advogado_nome}</Info>
          <Info rotulo="Última sincronização">{p.ultima_sincronizacao ? relativo(p.ultima_sincronizacao) : "nunca"}</Info>
          {assuntos.length > 0 && (
            <Info rotulo="Assuntos" className="sm:col-span-2 lg:col-span-4">
              {assuntos.join(" · ")}
            </Info>
          )}
          {(p.justica_gratuita || p.juizo_100_digital || p.tutela_liminar_requerida || (p.prioridades?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1.5 sm:col-span-2 lg:col-span-4">
              {p.justica_gratuita && <Pill tom="neutral">justiça gratuita</Pill>}
              {p.juizo_100_digital && <Pill tom="neutral">juízo 100% digital</Pill>}
              {p.tutela_liminar_requerida && <Pill tom="warning">pedido de liminar</Pill>}
              {p.prioridades?.map((x) => (
                <Pill key={x} tom="info">
                  prioridade: {x.replace(/_/g, " ")}
                </Pill>
              ))}
            </div>
          )}
          {(p.numeros_antigos?.length ?? 0) > 0 && (
            <Info rotulo="Números anteriores" className="sm:col-span-2 lg:col-span-4">
              <span className="font-mono text-xs">{p.numeros_antigos?.join(", ")}</span>
            </Info>
          )}
        </dl>
      </div>

      <div className="mb-5">
        <Gestao p={p} />
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="movimentacoes">
              Movimentações
              {p.movimentacoes_nao_lidas > 0 && <span className="rounded-full bg-danger/12 px-1.5 text-[11px] font-semibold text-danger-ink tabular-nums">{p.movimentacoes_nao_lidas}</span>}
            </TabsTrigger>
            <TabsTrigger value="partes">
              Partes{p.partes.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{p.partes.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="cliente">
              Cliente e caso
              {p.vinculos.some((v) => v.status === "sugerido") && <span className="size-1.5 rounded-full bg-warning" aria-label="vínculo a confirmar" />}
            </TabsTrigger>
            <TabsTrigger value="documentos">
              Documentos{p.documentos.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{numero(p.documentos.length)}</span>}
            </TabsTrigger>
            <TabsTrigger value="protocolos" className={cn(!pode("trib_protocolos.ver") && "hidden")}>
              Petições{p.protocolos.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{p.protocolos.length}</span>}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="movimentacoes" className="pt-4">
          <Movimentacoes p={p} />
        </TabsContent>
        <TabsContent value="partes" className="pt-4">
          <Partes p={p} onVincular={(parte) => setVincular({ parte })} />
        </TabsContent>
        <TabsContent value="cliente" className="pt-4">
          <ClienteECaso p={p} onVincular={() => setVincular({ parte: null })} />
        </TabsContent>
        <TabsContent value="documentos" className="pt-4">
          <Documentos p={p} onBaixar={() => baixar.mutate()} baixando={baixar.isPending} />
        </TabsContent>
        <TabsContent value="protocolos" className="pt-4">
          <Protocolos p={p} />
        </TabsContent>
      </Tabs>

      <VincularDialog p={p} parteId={vincular?.parte ?? null} open={!!vincular} onOpenChange={(o) => !o && setVincular(null)} />
      <ConfirmDialog
        open={excluir}
        onOpenChange={setExcluir}
        titulo="Excluir este processo?"
        descricao={`${p.numero_formatado} sai do sistema com movimentações, partes e documentos baixados. O caso ligado e os andamentos já criados continuam. Se quiser só parar de acompanhar, desligue "Monitorar".`}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => remover.mutate()}
      />
    </div>
  );
}
