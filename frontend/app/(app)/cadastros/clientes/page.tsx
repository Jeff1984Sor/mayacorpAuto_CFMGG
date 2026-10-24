"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Building,
  Download,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
  User,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pagination, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmailChips } from "@/components/mayacorp/email-chips";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCep } from "@/hooks/use-cep";
import { usePaginado } from "@/hooks/use-paginado";
import { api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cep as fmtCep, data, documento, moeda, numero } from "@/lib/format";
import type { NfseOut, Pagina, TomadorOut } from "@/lib/types";
import { docValido, soDigitos } from "@/lib/validacao";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

const schema = z
  .object({
    tipo: z.enum(["PF", "PJ", "EX"]),
    nome: z.string().min(2, "Obrigatório"),
    cpf_cnpj: z.string().optional(),
    im: z.string().optional(),
    ie: z.string().optional(),
    cep: z.string().optional(),
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().optional(),
    emails: z.array(z.email("E-mail inválido")),
    telefone: z.string().optional(),
    observacoes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo !== "EX" && v.cpf_cnpj && !docValido(v.cpf_cnpj))
      ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: v.tipo === "PF" ? "CPF inválido" : "CNPJ inválido" });
  });
type Form = z.infer<typeof schema>;
const vazio: Form = {
  tipo: "PJ",
  nome: "",
  cpf_cnpj: "",
  im: "",
  ie: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  emails: [],
  telefone: "",
  observacoes: "",
};

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
  const qc = useQueryClient();
  const { isOperador } = useAuth();
  const cep = useCep();
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: vazio });
  useEffect(() => {
    if (!open) return;
    f.reset(
      cliente
        ? ({
            ...vazio,
            ...Object.fromEntries(Object.entries(cliente).map(([k, v]) => [k, v ?? ""])),
            cpf_cnpj: documento(cliente.cpf_cnpj) === "—" ? "" : documento(cliente.cpf_cnpj),
            cep: fmtCep(cliente.cep),
            emails: cliente.emails ?? [],
            tipo: cliente.tipo,
          } as Form)
        : vazio,
    );
  }, [open, cliente, f]);

  const salvar = useMutation({
    mutationFn: (v: Form) => {
      const body = { ...v, cpf_cnpj: soDigitos(v.cpf_cnpj) || null, cep: soDigitos(v.cep) || null };
      return cliente ? api.put(`/nfse/tomadores/${cliente.id}`, body) : api.post("/nfse/tomadores", body);
    },
    onSuccess: () => {
      toast.success(cliente ? "Cliente atualizado" : "Cliente cadastrado");
      qc.invalidateQueries({ queryKey: ["tomadores"] });
      onClose();
    },
  });
  const er = f.formState.errors;
  const tipo = f.watch("tipo");
  const buscarCep = async () => {
    const r = await cep.buscar(f.getValues("cep") ?? "");
    if (r) {
      f.setValue("logradouro", r.logradouro);
      f.setValue("bairro", r.bairro);
      f.setValue("cidade", r.localidade);
      f.setValue("uf", r.uf);
    }
  };

  const dados = (
    <fieldset disabled={!isOperador} className="grid gap-4 sm:grid-cols-6">
      <Field label="Tipo" className="sm:col-span-2">
        <NativeSelect {...f.register("tipo")}>
          <option value="PJ">Pessoa jurídica</option>
          <option value="PF">Pessoa física</option>
          <option value="EX">Exterior</option>
        </NativeSelect>
      </Field>
      <Field label={tipo === "PF" ? "CPF" : tipo === "PJ" ? "CNPJ" : "Documento"} erro={er.cpf_cnpj?.message} className="sm:col-span-4">
        <Input {...f.register("cpf_cnpj")} className="num" onBlur={(e) => f.setValue("cpf_cnpj", documento(e.target.value) === "—" ? "" : documento(e.target.value))} />
      </Field>
      <Field label={tipo === "PF" ? "Nome" : "Razão social"} obrigatorio erro={er.nome?.message} className="sm:col-span-6">
        <Input {...f.register("nome")} />
      </Field>
      <Field label="Inscrição municipal" className="sm:col-span-3">
        <Input {...f.register("im")} className="num" />
      </Field>
      <Field label="Inscrição estadual" className="sm:col-span-3">
        <Input {...f.register("ie")} className="num" />
      </Field>
      <Field label="E-mails para envio da nota" className="sm:col-span-6" erro={er.emails?.message ?? er.emails?.[0]?.message}>
        <EmailChips value={f.watch("emails")} onChange={(v) => f.setValue("emails", v, { shouldValidate: true })} />
      </Field>
      <Field label="Telefone" className="sm:col-span-2">
        <Input {...f.register("telefone")} />
      </Field>
      <Field label="CEP" className="sm:col-span-2">
        <div className="relative">
          <Input {...f.register("cep")} className="num pr-8" onBlur={buscarCep} />
          {cep.carregando ? (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <MapPin className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      </Field>
      <Field label="Número" className="sm:col-span-2">
        <Input {...f.register("numero")} />
      </Field>
      <Field label="Logradouro" className="sm:col-span-4">
        <Input {...f.register("logradouro")} />
      </Field>
      <Field label="Complemento" className="sm:col-span-2">
        <Input {...f.register("complemento")} />
      </Field>
      <Field label="Bairro" className="sm:col-span-2">
        <Input {...f.register("bairro")} />
      </Field>
      <Field label="Cidade" className="sm:col-span-3">
        <Input {...f.register("cidade")} />
      </Field>
      <Field label="UF" className="sm:col-span-1">
        <NativeSelect {...f.register("uf")}>
          <option value="">—</option>
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Observações" className="sm:col-span-6">
        <Textarea rows={2} {...f.register("observacoes")} />
      </Field>
    </fieldset>
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo={cliente ? cliente.nome : "Novo cliente"}
      descricao={cliente ? "Dados do tomador e histórico de notas." : "Quem recebe a nota."}
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={isOperador ? "Salvar" : "Fechar"}
      onSubmit={isOperador ? f.handleSubmit((v) => salvar.mutate(v)) : (e) => (e.preventDefault(), onClose())}
    >
      {cliente ? (
        <Tabs defaultValue="dados">
          <TabsList className="mb-4">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="dados">{dados}</TabsContent>
          <TabsContent value="historico">
            <Historico id={cliente.id} />
          </TabsContent>
        </Tabs>
      ) : (
        dados
      )}
    </FormDialog>
  );
}

export default function ClientesPage() {
  const { isOperador, isAdmin } = useAuth();
  const qc = useQueryClient();
  const lista = usePaginado<TomadorOut>("tomadores", "/nfse/tomadores");
  const [editar, setEditar] = useState<TomadorOut | null>(null);
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState<TomadorOut | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (!id) return;
    api
      .get<TomadorOut>(`/nfse/tomadores/${id}`)
      .then(setEditar)
      .catch(() => {});
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
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/nfse/tomadores/${id}`),
    onSuccess: () => {
      toast.success("Cliente excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["tomadores"] });
    },
  });

  const filtroInc = lista.filtros.incompleto ? "inc" : "todos";

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        descricao="Tomadores das notas — alimentados automaticamente pelos arquivos importados."
        icone={UsersRound}
        migalhas={[{ label: "Cadastros", href: "/cadastros" }, { label: "Clientes" }]}
        acoes={
          <>
            <Button variant="outline" onClick={() => exportar.mutate()} disabled={exportar.isPending}>
              <Download /> Exportar
            </Button>
            {isOperador && (
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
                <Button onClick={() => setNovo(true)}>
                  <Plus /> Novo cliente
                </Button>
              </>
            )}
          </>
        }
      />
      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Nome, CPF/CNPJ ou e-mail" />
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
              isOperador &&
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
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Cidade</th>
                  <th className="px-3 py-2.5 text-right font-medium">Notas</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Acumulado</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((c) => (
                  <tr key={c.id} className={linhaClicavel} onClick={() => setEditar(c)}>
                    <td className="max-w-72 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                          {c.tipo === "PF" ? <User className="size-4" /> : <Building className="size-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            <span className="truncate">{c.nome}</span>
                            {c.incompleto && (
                              <Pill tom="warning">
                                <AlertCircle className="size-3" /> incompleto
                              </Pill>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{c.tipo === "PF" ? "Pessoa física" : c.tipo === "PJ" ? "Pessoa jurídica" : "Exterior"}</p>
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
                            <Pencil /> {isOperador ? "Editar" : "Ver"}
                          </DropdownMenuItem>
                          {isAdmin && (
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
                ))}
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
        descricao="Clientes com notas emitidas não podem ser excluídos (guarda fiscal)."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
