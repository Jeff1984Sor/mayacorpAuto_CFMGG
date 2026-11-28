"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Contact, ExternalLink, MoreHorizontal, Pencil, Scale, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { linhaClicavel, Pagination, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { SeloCliente } from "@/components/pessoas/comum";
import { PessoaDialog } from "@/components/pessoas/pessoa-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePaginado } from "@/hooks/use-paginado";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type PessoaResumo, TIPOS_PESSOA, UFS } from "@/lib/pessoas";
import { cn } from "@/lib/utils";

type SimNao = "" | "true" | "false";

export default function PessoasPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { pode, usuario } = useAuth();
  const podeVer = pode("pessoas.ver");
  const podeEditar = pode("pessoas.editar");
  const podeExcluir = pode("pessoas.excluir");
  const lista = usePaginado<PessoaResumo>("pessoas", "/pessoas", { ativo: true }, 25);
  const [tipo, setTipo] = useState("");
  const [cliente, setCliente] = useState<SimNao>("");
  const [advogado, setAdvogado] = useState<SimNao>("");
  const [uf, setUf] = useState("");
  const [situacao, setSituacao] = useState<"ativas" | "inativas">("ativas");
  /** null = fechado; 0 = nova pessoa; id = pessoa aberta */
  const [aberta, setAberta] = useState<number | null>(null);
  const [excluir, setExcluir] = useState<PessoaResumo | null>(null);

  useEffect(() => {
    // ?id= abre a pessoa (link do cartão da parte no caso)
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única da URL
    if (id) setAberta(id);
  }, []);

  const remover = useMutation({
    mutationFn: (p: PessoaResumo) => api.del<{ mensagem: string }>(`/pessoas/${p.id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["pessoas"] });
    },
  });

  if (usuario && !podeVer) return <SemAcesso />;
  const filtrando = !!(lista.q || tipo || cliente || advogado || uf || situacao !== "ativas");

  return (
    <div>
      <PageHeader
        titulo="Pessoas"
        icone={Contact}
        descricao="O cadastro único de partes: clientes, partes contrárias, terceiros e advogados. Cada pessoa é cadastrada uma vez e aparece em quantos casos for preciso."
        migalhas={[{ label: "Cadastros" }, { label: "Pessoas" }]}
        acoes={
          podeEditar && (
            <Button onClick={() => setAberta(0)}>
              <UserPlus /> Nova pessoa
            </Button>
          )
        }
      />
      <TableCard>
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Nome, nome fantasia ou CPF/CNPJ" className="sm:w-80" />
            <NativeSelect
              aria-label="Tipo de pessoa"
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value);
                lista.setFiltro("tipo", e.target.value || undefined);
              }}
              className="h-9 sm:w-44"
            >
              <option value="">Todos os tipos</option>
              {TIPOS_PESSOA.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.rotulo}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="É cliente"
              value={cliente}
              onChange={(e) => {
                setCliente(e.target.value as SimNao);
                lista.setFiltro("eh_cliente", e.target.value || undefined);
              }}
              className="h-9 sm:w-40"
            >
              <option value="">Clientes ou não</option>
              <option value="true">Só clientes</option>
              <option value="false">Quem não é cliente</option>
            </NativeSelect>
            <NativeSelect
              aria-label="É advogado"
              value={advogado}
              onChange={(e) => {
                setAdvogado(e.target.value as SimNao);
                lista.setFiltro("eh_advogado", e.target.value || undefined);
              }}
              className="h-9 sm:w-44"
            >
              <option value="">Advogados ou não</option>
              <option value="true">Só advogados</option>
              <option value="false">Quem não é advogado</option>
            </NativeSelect>
            <NativeSelect
              aria-label="UF do endereço"
              value={uf}
              onChange={(e) => {
                setUf(e.target.value);
                lista.setFiltro("uf", e.target.value || undefined);
              }}
              className="h-9 sm:w-28"
            >
              <option value="">Toda UF</option>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </NativeSelect>
            <Segmented
              value={situacao}
              onChange={(v) => {
                setSituacao(v);
                lista.setFiltro("ativo", v === "ativas");
              }}
              opcoes={[
                { value: "ativas", label: "Ativas" },
                { value: "inativas", label: "Inativas" },
              ]}
            />
          </div>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={Contact}
            titulo={filtrando ? "Ninguém encontrado" : "Nenhuma pessoa ainda"}
            descricao={filtrando ? "Troque a busca ou os filtros." : "As pessoas entram aqui quando viram parte de um caso, ou pelo botão Nova pessoa. Os clientes já fazem parte deste cadastro."}
            acao={
              podeEditar &&
              !filtrando && (
                <Button onClick={() => setAberta(0)}>
                  <UserPlus /> Nova pessoa
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                  <th className="px-3 py-2.5 font-medium">CPF / CNPJ</th>
                  <th className="px-3 py-2.5 font-medium">OAB</th>
                  <th className="px-3 py-2.5 font-medium">Cidade</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="w-10 px-3 py-2.5">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((p) => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    className={cn(linhaClicavel, "focus-visible:bg-accent/40 focus-visible:outline-none", !p.ativo && "opacity-60")}
                    onClick={() => setAberta(p.id)}
                    onKeyDown={(e) => e.key === "Enter" && setAberta(p.id)}
                  >
                    <td className="max-w-96 px-4 py-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{p.nome}</span>
                        <SeloCliente clienteId={p.cliente_id} />
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{p.tipo_pessoa_nome}</td>
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">{p.documento_formatado ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3">
                      {p.eh_advogado ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Scale className="size-3.5 text-muted-foreground" />
                          <span className="font-mono">{p.oabs.join(" · ") || "sem OAB"}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{p.cidade ? `${p.cidade}${p.uf ? `/${p.uf}` : ""}` : (p.uf ?? "—")}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={p.ativo ? "ativo" : "descartado"} label={p.ativo ? "Ativa" : "Inativa"} />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${p.nome}`} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => setAberta(p.id)}>
                            <Pencil /> {podeEditar ? "Abrir e editar" : "Abrir"}
                          </DropdownMenuItem>
                          {p.cliente_id && (
                            <DropdownMenuItem onClick={() => router.push(`/cadastros/clientes?id=${p.cliente_id}`)}>
                              <ExternalLink /> Abrir cliente
                            </DropdownMenuItem>
                          )}
                          {podeExcluir && !p.cliente_id && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluir(p)}>
                                <Trash2 /> Excluir ou desativar
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
        {lista.total > 0 && <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />}
      </TableCard>
      <PessoaDialog open={aberta !== null} onOpenChange={(o) => !o && setAberta(null)} pessoaId={aberta || null} onTrocar={setAberta} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir ${excluir?.nome ?? ""}?`}
        descricao="Se a pessoa aparece em algum caso ou processo, ela é só desativada e o histórico fica guardado. Sem uso nenhum, é excluída do cadastro."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir)}
      />
    </div>
  );
}
