"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building,
  Download,
  Loader2,
  MoreHorizontal,
  Archive,
  Pencil,
  RotateCcw,
  Plus,
  Trash2,
  Upload,
  User,
  UserRound,
  UsersRound,
  ChartPie,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { CadastroAbas, type CorpoCadastro, useCadastroCliente } from "@/components/clientes/cadastro-form";
import { mascaraFone } from "@/components/clientes/listas";
import { CasosDoCliente } from "@/components/faturamento/casos-do-cliente";
import { CobrancaDoCliente, ContratosDoCliente } from "@/components/faturamento/contratos-cliente";
import { useUsaContrato } from "@/lib/contrato";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pagination, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PreencherIA } from "@/components/ia/preencher-ia";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { usePaginado } from "@/hooks/use-paginado";
import { api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, documento, moeda, numero } from "@/lib/format";
import type { NfseOut, Pagina, TomadorOut } from "@/lib/types";

function Historico({ id }: { id: number }) {
  const q = useQuery({
    queryKey: ["tomador-notas", id],
    queryFn: () => api.get<NfseOut[] | Pagina<NfseOut>>(`/nfse/tomadores/${id}/notas`),
  });
  const notas = Array.isArray(q.data) ? q.data : (q.data?.itens ?? []);
  const total = notas.filter((n) => n.status === "emitida").reduce((a, n) => a + Number(n.valor), 0);
  if (q.isPending) return <TableSkeleton linhas={3} colunas={3} />;
  if (!notas.length) return <EmptyState icone={UsersRound} titulo="Nenhuma nota para este cliente" className="py-8" />;
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">Notas</p>
          <p className="text-xl font-semibold num">{numero(notas.length)}</p>
        </div>
        <div className="rounded-xl bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">Valor acumulado</p>
          <p className="text-xl font-semibold num">{moeda(total)}</p>
        </div>
      </div>
      <ul className="divide-y rounded-xl border">
        {notas.map((n) => (
          <li key={n.id}>
            <Link href={`/nfse/notas/${n.id}`} className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent/50">
              <Mono className="font-semibold">{n.numero}</Mono>
              <span className="text-muted-foreground num">{data(n.data_emissao)}</span>
              <span className="flex-1" />
              <Mono>{moeda(n.valor)}</Mono>
              <StatusBadge status={n.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClienteForm({ cliente, open, onClose }: { cliente: TomadorOut | null; open: boolean; onClose: () => void }) {
  const usaContrato = useUsaContrato();
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("clientes.editar");
  const cad = useCadastroCliente({ cliente, ativo: open, podeEditar });

  const salvar = useMutation({
    mutationFn: (body: CorpoCadastro) =>
      cliente ? api.put(`/nfse/tomadores/${cliente.id}`, body) : api.post("/nfse/tomadores", body),
    onSuccess: () => {
      toast.success(cliente ? "Cliente atualizado" : "Cliente cadastrado");
      qc.invalidateQueries({ queryKey: ["tomadores"] });
      qc.invalidateQueries({ queryKey: ["admin"] }); // no admin da MayaCorp, este cadastro é a ficha de um cliente
      onClose();
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo={cliente ? cliente.nome : "Novo cliente"}
      formId="form-cliente"
      acaoCabecalho={podeEditar && <PreencherIA endpoint="/ia/preencher/cliente" aplicar={cad.aplicarIA} />}
      descricao={cliente ? (usaContrato ? "Dados, endereços, contatos, contratos e histórico de notas." : "Dados, endereços, contatos, cobrança, casos e histórico de notas.") : undefined}
      largura="xl"
      salvando={salvar.isPending}
      rotuloSalvar={podeEditar ? "Salvar" : "Fechar"}
      onSubmit={podeEditar ? cad.aoEnviar((body) => salvar.mutate(body)) : (e) => (e.preventDefault(), onClose())}
    >
      <CadastroAbas
        cad={cad}
        gatilhos={
          <>
            {cliente && pode("contratos.ver") && <TabsTrigger value="contratos">{usaContrato ? "Contratos" : "Cobrança"}</TabsTrigger>}
            {cliente && pode("contratos.ver") && <TabsTrigger value="casos">Casos</TabsTrigger>}
            {cliente && <TabsTrigger value="historico">Histórico</TabsTrigger>}
          </>
        }
      >
        {cliente && (
          <>
            <TabsContent value="contratos">
              {usaContrato ? <ContratosDoCliente tomadorId={cliente.id} /> : <CobrancaDoCliente tomadorId={cliente.id} />}
            </TabsContent>
            <TabsContent value="casos">
              <CasosDoCliente tomadorId={cliente.id} nomeCliente={cliente.nome} />
            </TabsContent>
            <TabsContent value="historico">
              <Historico id={cliente.id} />
            </TabsContent>
          </>
        )}
      </CadastroAbas>
    </FormDialog>
  );
}

interface Dependencias {
  notas: number;
  faturas: number;
  contratos: number;
  casos: number;
  horas: number;
  despesas: number;
  tarefas: number;
  revisoes: number;
  bloqueio: string | null;
}

export default function ClientesPage() {
  const { pode } = useAuth();
  const usaContrato = useUsaContrato();
  const podeEditar = pode("clientes.editar");
  const qc = useQueryClient();
  const lista = usePaginado<TomadorOut>("tomadores", "/nfse/tomadores", { situacao: "ativos" });
  const [editar, setEditar] = useState<TomadorOut | null>(null);
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState<TomadorOut | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  const { setQ } = lista;
  useEffect(() => {
    const url = new URLSearchParams(window.location.search);
    // ?q= vem de links como "sem e-mail" do envio em lote
    const busca = url.get("q");
    if (busca) setQ(busca);
    const id = Number(url.get("id"));
    if (!id) return;
    api
      .get<TomadorOut>(`/nfse/tomadores/${id}`)
      .then(setEditar)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- leitura única da URL
  }, []);

  const importar = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("arquivo", file);
      return api.post<{ criados?: number; atualizados?: number; mensagem?: string }>("/nfse/tomadores/importar", fd);
    },
    onSuccess: (r) => {
      toast.success(r?.mensagem ?? `Importação concluída: ${r?.criados ?? 0} novos, ${r?.atualizados ?? 0} atualizados`);
      qc.invalidateQueries({ queryKey: ["tomadores"] });
    },
  });
  const exportar = useMutation({ mutationFn: () => baixar("/nfse/tomadores/exportar", {}, "clientes.xlsx") });
  const deps = useQuery({
    queryKey: ["tomadores", "dependencias", excluir?.id],
    queryFn: () => api.get<Dependencias>(`/nfse/tomadores/${excluir!.id}/dependencias`),
    enabled: !!excluir,
  });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/nfse/tomadores/${id}?tudo=true`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries();
    },
  });
  const ativar = useMutation({
    mutationFn: async ({ c, ativo }: { c: TomadorOut; ativo: boolean }) => {
      const atual = await api.get<TomadorOut>(`/nfse/tomadores/${c.id}`);
      return api.put(`/nfse/tomadores/${c.id}`, { ...atual, ativo });
    },
    onSuccess: (_, { c, ativo }) => {
      toast.success(ativo ? `${c.nome} reativado` : `${c.nome} inativado: some das listas de escolha`);
      qc.invalidateQueries({ queryKey: ["tomadores"] });
    },
  });
  const d = deps.data;
  const ligados = d
    ? [
        ...(usaContrato ? [[d.contratos, "contrato(s)"]] : []),
        [d.casos, "caso(s)"],
        [d.horas, "lançamento(s) de horas"],
        [d.despesas, "despesa(s)"],
        [d.tarefas, "tarefa(s)"],
        [d.revisoes, "revisão(ões) em aberto"],
      ].filter(([n]) => (n as number) > 0)
    : [];

  const filtroInc = lista.filtros.incompleto ? "inc" : "todos";

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        icone={UsersRound}
        migalhas={[{ label: "Cadastros", href: "/cadastros" }, { label: "Clientes" }]}
        acoes={
          <>
            <Button variant="outline" render={<Link href="/relatorios#clientes" />}>
              <ChartPie /> Relatórios
            </Button>
            <Button variant="outline" onClick={() => exportar.mutate()} disabled={exportar.isPending}>
              <Download /> Exportar
            </Button>
            {pode("clientes.importar") && (
              <>
                <input
                  ref={inputArquivo}
                  type="file"
                  accept=".xlsx,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importar.mutate(f);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" onClick={() => inputArquivo.current?.click()} disabled={importar.isPending}>
                  {importar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Importar planilha
                </Button>
              </>
            )}
            {podeEditar && (
              <Button onClick={() => setNovo(true)}>
                <Plus /> Novo cliente
              </Button>
            )}
          </>
        }
      />
      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Nome, CPF/CNPJ ou e-mail" />
          <Segmented
            value={String(lista.filtros.situacao ?? "ativos")}
            onChange={(v) => lista.setFiltro("situacao", v)}
            opcoes={[
              { value: "ativos", label: "Ativos" },
              { value: "inativos", label: "Inativos" },
              { value: "todos", label: "Todos" },
            ]}
          />
          <Segmented
            value={filtroInc}
            onChange={(v) => lista.setFiltro("incompleto", v === "inc" ? true : undefined)}
            opcoes={[
              { value: "todos", label: "Todos" },
              { value: "inc", label: "Dados incompletos", tom: "warning" },
            ]}
          />
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={UsersRound}
            titulo={lista.q || filtroInc === "inc" ? "Nenhum cliente encontrado" : "Nenhum cliente ainda"}
            descricao={
              lista.q || filtroInc === "inc"
                ? "Ajuste a busca ou o filtro."
                : "Os tomadores entram aqui automaticamente quando você importa o primeiro arquivo."
            }
            acao={
              podeEditar &&
              !lista.q && (
                <Button onClick={() => setNovo(true)}>
                  <Plus /> Cadastrar cliente
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">CPF/CNPJ</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">E-mail</th>
                  <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Telefone</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Cidade</th>
                  <th className="px-3 py-2.5 text-right font-medium">Notas</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Acumulado</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((c) => {
                  const contato = c.contatos?.find((p) => p.principal) ?? c.contatos?.[0];
                  const tel = c.telefones?.[0];
                  return (
                    <tr key={c.id} className={linhaClicavel} onClick={() => setEditar(c)}>
                      <td className="max-w-72 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                            {c.tipo === "PF" ? <User className="size-4" /> : <Building className="size-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate font-medium">
                              <span className="truncate">{c.nome}</span>
                              {c.ativo === false && <Pill>inativo</Pill>}
                              {c.incompleto && (
                                <Pill tom="warning">
                                  <AlertCircle className="size-3" /> incompleto
                                </Pill>
                              )}
                            </p>
                            {contato ? (
                              <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground" title="Contato principal">
                                <UserRound className="size-3 shrink-0" />
                                <span className="truncate">
                                  {contato.nome}
                                  {contato.cargo && ` · ${contato.cargo}`}
                                </span>
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">{c.tipo === "PF" ? "Pessoa física" : c.tipo === "PJ" ? "Pessoa jurídica" : "Exterior"}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                        <Mono>{documento(c.cpf_cnpj)}</Mono>
                      </td>
                      <td className="hidden max-w-56 truncate px-3 py-3 text-muted-foreground lg:table-cell">
                        {c.emails[0] ?? "—"}
                        {c.emails.length > 1 && <span className="ml-1 text-xs">+{c.emails.length - 1}</span>}
                      </td>
                      <td className="hidden px-3 py-3 whitespace-nowrap text-muted-foreground xl:table-cell">
                        {tel || c.telefone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mono>{mascaraFone(tel?.numero ?? c.telefone)}</Mono>
                            {tel?.ramal && <span className="text-xs">r. {tel.ramal}</span>}
                            {(c.telefones?.length ?? 0) > 1 && <span className="text-xs">+{c.telefones.length - 1}</span>}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{c.cidade ? `${c.cidade}/${c.uf}` : "—"}</td>
                      <td className="px-3 py-3 text-right">
                        <Mono>{numero(c.qtd_notas)}</Mono>
                      </td>
                      <td className="hidden px-3 py-3 text-right whitespace-nowrap sm:table-cell">
                        <Mono>{moeda(c.valor_acumulado)}</Mono>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                            <MoreHorizontal />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditar(c)}>
                              <Pencil /> {podeEditar ? "Editar" : "Ver"}
                            </DropdownMenuItem>
                            {podeEditar && (
                              <DropdownMenuItem onClick={() => ativar.mutate({ c, ativo: c.ativo === false })}>
                                {c.ativo === false ? <RotateCcw /> : <Archive />} {c.ativo === false ? "Reativar" : "Inativar"}
                              </DropdownMenuItem>
                            )}
                            {pode("clientes.excluir") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onClick={() => setExcluir(c)}>
                                  <Trash2 /> Excluir
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />
      </TableCard>

      <ClienteForm
        open={novo || !!editar}
        cliente={editar}
        onClose={() => {
          setNovo(false);
          setEditar(null);
        }}
      />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir ${excluir?.nome ?? ""}?`}
        descricao={
          !d
            ? "Conferindo o que está ligado a este cliente…"
            : d.bloqueio
              ? d.bloqueio
              : ligados.length
                ? "Também serão apagados, sem volta:"
                : "Nada está ligado a este cliente. A exclusão não pode ser desfeita."
        }
        confirmar={ligados.length ? "Excluir com tudo" : "Excluir"}
        destrutivo
        desabilitado={!d || !!d.bloqueio}
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      >
        {d && !d.bloqueio && ligados.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {ligados.map(([n, r]) => (
              <li key={r as string}>
                <b>{n as number}</b> {r as string}
              </li>
            ))}
          </ul>
        )}
        {d?.bloqueio && excluir?.ativo !== false && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              ativar.mutate({ c: excluir!, ativo: false });
              setExcluir(null);
            }}
          >
            <Archive /> Inativar em vez de excluir
          </Button>
        )}
      </ConfirmDialog>
    </div>
  );
}
