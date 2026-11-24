"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Barcode,
  CalendarClock,
  Download,
  Eye,
  FileText,
  FileUp,
  Landmark,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  BoletoDetalhe,
  BoletoDialog,
  ConvenioDialog,
  EmailBoletoDialog,
  RetornoDialog,
  useConvenios,
  VencimentoDialog,
} from "@/components/boletos/dialogos";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { linhaClicavel, Pagination, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePaginado } from "@/hooks/use-paginado";
import { abrirArquivo, api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type BoletoOut, type ConvenioOut, type RemessaOut, type RemessaPendente, type ResumoBoletos, type RetornoOut, TOM_STATUS } from "@/lib/boletos";
import { data, dataHora, documento, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

type Aba = "boletos" | "remessas" | "retornos" | "convenios";

const FILTROS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "rascunho", label: "Aguardando remessa" },
  { value: "em_remessa", label: "Enviados ao banco" },
  { value: "registrado", label: "Registrados" },
  { value: "vencido", label: "Vencidos" },
  { value: "pago", label: "Pagos" },
  { value: "rejeitado", label: "Rejeitados" },
  { value: "baixado", label: "Baixados" },
  { value: "cancelado", label: "Cancelados" },
];

export default function BoletosPage() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("boletos.editar");
  const podeExcluir = pode("boletos.excluir");
  const podeConvenio = pode("cfg_financeiro.editar");
  const [aba, setAba] = useState<Aba>("boletos");
  const convenios = useConvenios();
  const lista = usePaginado<BoletoOut>("boletos", "/boletos", {}, 25);
  const resumo = useQuery({ queryKey: ["boletos", "resumo"], queryFn: () => api.get<ResumoBoletos>("/boletos/resumo") });
  const [sel, setSel] = useState<Set<number>>(new Set());

  const [form, setForm] = useState<{ b: BoletoOut | null } | null>(null);
  const [ver, setVer] = useState<number | null>(null);
  const [vencimento, setVencimento] = useState<BoletoOut | null>(null);
  const [email, setEmail] = useState<BoletoOut | null>(null);
  const [excluir, setExcluir] = useState<BoletoOut | null>(null);
  const [baixa, setBaixa] = useState<BoletoOut | null>(null);
  const [remessa, setRemessa] = useState(false);
  const [retorno, setRetorno] = useState<{ ver: number | null } | null>(null);
  const [convenio, setConvenio] = useState<{ c: ConvenioOut | null } | null>(null);
  const [excluirConvenio, setExcluirConvenio] = useState<ConvenioOut | null>(null);

  const atualizar = () => qc.invalidateQueries({ queryKey: ["boletos"] });
  const remover = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/boletos/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      atualizar();
    },
  });
  const pedirBaixa = useMutation({
    mutationFn: (id: number) => api.post<BoletoOut>(`/boletos/${id}/baixa`),
    onSuccess: (b) => {
      toast.success(b.status === "cancelado" ? "Boleto cancelado" : "Baixa registrada: gere a remessa para avisar o banco");
      setBaixa(null);
      atualizar();
    },
  });
  const desistir = useMutation({
    mutationFn: (id: number) => api.del(`/boletos/${id}/instrucao`),
    onSuccess: () => {
      toast.success("Instrução cancelada");
      atualizar();
    },
  });
  const emailLote = useMutation({
    mutationFn: (ids: number[]) => api.post<{ enviados: number; falhas: { seu_numero: string | null; pagador: string; erro: string }[] }>("/boletos/enviar-emails", { ids }),
    onSuccess: (r) => {
      if (r.enviados) toast.success(`${r.enviados} e-mail(s) enviado(s)`);
      r.falhas.slice(0, 5).forEach((f) => toast.error(`${f.seu_numero ?? "Boleto"} · ${f.pagador}: ${f.erro}`));
      setSel(new Set());
      atualizar();
    },
  });
  const removerConvenio = useMutation({
    mutationFn: (id: number) => api.del<{ mensagem: string }>(`/boletos/convenios/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluirConvenio(null);
      atualizar();
    },
  });

  const semConvenio = !convenios.isPending && (convenios.data ?? []).length === 0;
  const aguardando = resumo.data?.aguardando_remessa ?? 0;
  const todosDaPagina = lista.itens.length > 0 && lista.itens.every((b) => sel.has(b.id));
  const marcar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div>
      <PageHeader
        titulo="Boletos"
        icone={Barcode}
        migalhas={[{ label: "Faturamento" }, { label: "Boletos" }]}
        descricao="Boletos registrados por arquivo: crie, gere a remessa, envie ao banco e importe o retorno."
        acoes={
          podeEditar && (
            <>
              <Button variant="outline" onClick={() => setRetorno({ ver: null })}>
                <FileUp /> Importar retorno
              </Button>
              <Button variant="outline" onClick={() => setRemessa(true)} disabled={semConvenio}>
                <Send /> Gerar remessa
                {aguardando > 0 && <span className="ml-1 rounded bg-warning/20 px-1.5 text-[11px] text-warning-ink num">{aguardando}</span>}
              </Button>
              <Button onClick={() => setForm({ b: null })}>
                <Plus /> Novo boleto
              </Button>
            </>
          )
        }
      />

      <div className="mb-4">
        <Segmented
          value={aba}
          onChange={setAba}
          opcoes={[
            { value: "boletos", label: "Boletos" },
            { value: "remessas", label: "Remessas" },
            { value: "retornos", label: "Retornos" },
            { value: "convenios", label: "Convênios", contagem: convenios.data?.length },
          ]}
        />
      </div>

      {aba === "boletos" && (
        <TableCard>
          <Toolbar>
            <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Pagador, CPF/CNPJ, nº do boleto ou nosso número" className="sm:w-96" />
            <NativeSelect className="w-52" aria-label="Situação" value={String(lista.filtros.status ?? "")} onChange={(e) => lista.setFiltro("status", e.target.value || undefined)}>
              {FILTROS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </NativeSelect>
            {(convenios.data ?? []).length > 1 && (
              <NativeSelect className="w-52" aria-label="Convênio" value={String(lista.filtros.convenio_id ?? "")} onChange={(e) => lista.setFiltro("convenio_id", e.target.value || undefined)}>
                <option value="">Todos os convênios</option>
                {convenios.data!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </NativeSelect>
            )}
            {sel.size > 0 && podeEditar && (
              <Button variant="outline" onClick={() => emailLote.mutate([...sel])} disabled={emailLote.isPending}>
                <Mail /> Enviar {sel.size} por e-mail
              </Button>
            )}
          </Toolbar>
          {lista.isPending ? (
            <TableSkeleton colunas={7} />
          ) : lista.itens.length === 0 ? (
            <EmptyState
              icone={Barcode}
              titulo={semConvenio ? "Cadastre o convênio com o banco" : lista.q || lista.filtros.status ? "Nenhum boleto encontrado" : "Nenhum boleto ainda"}
              descricao={
                semConvenio
                  ? "Com os códigos do contrato de cobrança (agência, conta, código do beneficiário e de transmissão) você já pode emitir."
                  : "Crie um boleto a partir de uma fatura ou avulso."
              }
              acao={
                semConvenio
                  ? podeConvenio && (
                      <Button
                        onClick={() => {
                          setAba("convenios");
                          setConvenio({ c: null });
                        }}
                      >
                        <Landmark /> Cadastrar convênio
                      </Button>
                    )
                  : podeEditar &&
                    !lista.q &&
                    !lista.filtros.status && (
                      <Button onClick={() => setForm({ b: null })}>
                        <Plus /> Novo boleto
                      </Button>
                    )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <Checkbox
                        checked={todosDaPagina}
                        onCheckedChange={(v) => setSel(v ? new Set([...sel, ...lista.itens.map((b) => b.id)]) : new Set())}
                        aria-label="Selecionar todos"
                      />
                    </th>
                    <th className="px-3 py-2.5 font-medium">Boleto</th>
                    <th className="px-3 py-2.5 font-medium">Pagador</th>
                    <th className="px-3 py-2.5 font-medium">Vencimento</th>
                    <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                    <th className="px-3 py-2.5 font-medium">Situação</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lista.itens.map((b) => {
                    const vencido = (b.status === "registrado" || b.status === "em_remessa") && b.data_vencimento < new Date().toISOString().slice(0, 10);
                    return (
                      <tr key={b.id} className={cn(linhaClicavel, sel.has(b.id) && "bg-brand/5")} onClick={() => setVer(b.id)}>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={sel.has(b.id)} onCheckedChange={(v) => marcar(b.id, !!v)} aria-label={`Selecionar ${b.seu_numero}`} />
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <p className="font-mono text-xs font-medium">{b.seu_numero}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{b.nosso_numero_fmt ?? "sem nosso número"}</p>
                        </td>
                        <td className="max-w-72 px-3 py-3">
                          <p className="truncate">{b.pagador_nome}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            <span className="font-mono">{documento(b.pagador_documento)}</span>
                            {b.descricao && ` · ${b.descricao}`}
                          </p>
                        </td>
                        <td className={cn("px-3 py-3 font-mono text-xs whitespace-nowrap", vencido && "font-medium text-danger-ink")}>
                          {data(b.data_vencimento)}
                          {b.novo_vencimento && <p className="text-[11px] text-warning-ink">→ {data(b.novo_vencimento)}</p>}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {moeda(b.valor)}
                          {b.valor_pago && b.valor_pago !== b.valor && <p className="text-[11px] text-muted-foreground">pago {moeda(b.valor_pago)}</p>}
                        </td>
                        <td className="px-3 py-3">
                          <Pill tom={TOM_STATUS[b.status]}>{vencido ? "Vencido" : b.status_rotulo}</Pill>
                          {b.instrucao_pendente && <p className="mt-0.5 text-[11px] text-warning-ink">{b.instrucao_pendente === "02" ? "baixa na próxima remessa" : "vencimento na próxima remessa"}</p>}
                          {b.status === "rejeitado" && b.motivos[0] && <p className="mt-0.5 max-w-52 truncate text-[11px] text-danger-ink">{b.motivos[0].descricao}</p>}
                        </td>
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${b.seu_numero}`} />}>
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setVer(b.id)}>
                                <Eye /> Ver detalhes
                              </DropdownMenuItem>
                              {b.codigo_barras && (
                                <DropdownMenuItem onClick={() => abrirArquivo(`/boletos/${b.id}/pdf`).catch((e: Error) => toast.error(e.message))}>
                                  <FileText /> Ver PDF
                                </DropdownMenuItem>
                              )}
                              {podeEditar && b.pode_enviar_ao_cliente && (
                                <DropdownMenuItem onClick={() => setEmail(b)}>
                                  <Mail /> Enviar por e-mail
                                </DropdownMenuItem>
                              )}
                              {podeEditar && <DropdownMenuSeparator />}
                              {podeEditar && b.editavel && (
                                <DropdownMenuItem onClick={() => setForm({ b })}>
                                  <Pencil /> Editar
                                </DropdownMenuItem>
                              )}
                              {podeEditar && (b.status === "registrado" || b.status === "em_remessa") && (
                                <DropdownMenuItem onClick={() => setVencimento(b)}>
                                  <CalendarClock /> Alterar vencimento
                                </DropdownMenuItem>
                              )}
                              {podeEditar && b.instrucao_pendente && (
                                <DropdownMenuItem onClick={() => desistir.mutate(b.id)}>
                                  <Undo2 /> Desistir da instrução
                                </DropdownMenuItem>
                              )}
                              {podeEditar && ["em_remessa", "registrado", "em_protesto"].includes(b.status) && b.instrucao_pendente !== "02" && (
                                <DropdownMenuItem variant="destructive" onClick={() => setBaixa(b)}>
                                  <Ban /> Pedir baixa
                                </DropdownMenuItem>
                              )}
                              {podeExcluir && ["rascunho", "rejeitado", "cancelado"].includes(b.status) && (
                                <DropdownMenuItem variant="destructive" onClick={() => setExcluir(b)}>
                                  <Trash2 /> Excluir
                                </DropdownMenuItem>
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
      )}

      {aba === "remessas" && <Remessas />}
      {aba === "retornos" && <Retornos abrir={(id) => setRetorno({ ver: id })} />}
      {aba === "convenios" && (
        <TableCard>
          <Toolbar>
            <p className="text-sm text-muted-foreground">Contrato de cobrança com o banco. Bancos: Santander e Bradesco (CNAB 240).</p>
            {podeConvenio && (
              <Button className="ml-auto" onClick={() => setConvenio({ c: null })}>
                <Plus /> Novo convênio
              </Button>
            )}
          </Toolbar>
          {convenios.isPending ? (
            <TableSkeleton colunas={5} />
          ) : semConvenio ? (
            <EmptyState icone={Landmark} titulo="Nenhum convênio cadastrado" descricao="Peça ao gerente o código do beneficiário e o código de transmissão da Cobrança CNAB 240." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Convênio</th>
                    <th className="px-3 py-2.5 font-medium">Banco · agência / conta</th>
                    <th className="px-3 py-2.5 font-medium">Carteira</th>
                    <th className="px-3 py-2.5 text-right font-medium">Boletos</th>
                    <th className="px-3 py-2.5 font-medium">Situação</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {convenios.data!.map((c) => (
                    <tr key={c.id} className={cn(podeConvenio && linhaClicavel, !c.ativo && "opacity-60")} onClick={() => podeConvenio && setConvenio({ c })}>
                      <td className="max-w-72 px-4 py-3">
                        <p className="truncate font-medium">{c.nome}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{c.emissora_nome}</p>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">
                        {c.banco_nome} · {c.agencia}-{c.agencia_dv} / {c.conta}-{c.conta_dv}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs">{c.carteira}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.qtd_boletos}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {!c.ativo && <Pill tom="neutral">Inativo</Pill>}
                          {c.pendencias.length > 0 ? <Pill tom="danger">Cadastro incompleto</Pill> : <Pill tom={c.homologado ? "success" : "warning"}>{c.homologado ? "Homologado" : "Em teste"}</Pill>}
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        {podeConvenio && (
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${c.nome}`} />}>
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setConvenio({ c })}>
                                <Pencil /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onClick={() => setExcluirConvenio(c)}>
                                <Trash2 /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TableCard>
      )}

      <BoletoDialog open={!!form} onOpenChange={(o) => !o && setForm(null)} boleto={form?.b ?? null} />
      <BoletoDetalhe id={ver} onClose={() => setVer(null)} />
      <VencimentoDialog boleto={vencimento} onClose={() => setVencimento(null)} />
      <EmailBoletoDialog boleto={email} onClose={() => setEmail(null)} />
      <RemessaDialog open={remessa} onOpenChange={setRemessa} convenios={convenios.data ?? []} />
      <RetornoDialog open={!!retorno} onOpenChange={(o) => !o && setRetorno(null)} verId={retorno?.ver} />
      <ConvenioDialog open={!!convenio} onOpenChange={(o) => !o && setConvenio(null)} convenio={convenio?.c ?? null} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o boleto ${excluir?.seu_numero ?? ""}?`}
        descricao="O boleto é apagado. O nosso número dele não volta a ser usado."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
      <ConfirmDialog
        open={!!baixa}
        onOpenChange={(o) => !o && setBaixa(null)}
        titulo={`Pedir a baixa do boleto ${baixa?.seu_numero ?? ""}?`}
        descricao="O pedido vai para o banco na próxima remessa. O boleto só deixa de valer quando o banco confirmar no retorno."
        confirmar="Pedir baixa"
        destrutivo
        carregando={pedirBaixa.isPending}
        onConfirm={() => baixa && pedirBaixa.mutate(baixa.id)}
      />
      <ConfirmDialog
        open={!!excluirConvenio}
        onOpenChange={(o) => !o && setExcluirConvenio(null)}
        titulo={`Excluir o convênio ${excluirConvenio?.nome ?? ""}?`}
        descricao={excluirConvenio?.qtd_boletos ? "Ele já tem boletos e não pode ser apagado: edite e desative." : "O convênio será apagado."}
        confirmar="Excluir"
        destrutivo
        carregando={removerConvenio.isPending}
        onConfirm={() => excluirConvenio && removerConvenio.mutate(excluirConvenio.id)}
      />
    </div>
  );
}

function RemessaDialog({ open, onOpenChange, convenios }: { open: boolean; onOpenChange: (o: boolean) => void; convenios: ConvenioOut[] }) {
  const qc = useQueryClient();
  const ativos = convenios.filter((c) => c.ativo);
  const [escolhido, setEscolhido] = useState<number | "">("");
  const cid = escolhido || (ativos.length === 1 ? ativos[0].id : "");
  const pend = useQuery({
    queryKey: ["boletos", "pendentes", cid],
    queryFn: () => api.get<RemessaPendente>("/boletos/remessas/pendentes", { convenio_id: cid as number }),
    enabled: open && !!cid,
  });
  const gerar = useMutation({
    mutationFn: () => api.post<{ remessa: RemessaOut; fora: { seu_numero: string; pagador: string; erros: string[] }[] }>("/boletos/remessas", { convenio_id: cid }),
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: ["boletos"] });
      await baixar(`/boletos/remessas/${r.remessa.id}/arquivo`, {}, r.remessa.nome_arquivo).catch(() => toast.error("A remessa foi gerada; baixe o arquivo na aba Remessas."));
      toast.success(`Remessa ${r.remessa.sequencial} gerada${r.remessa.ambiente === "teste" ? " (TESTE)" : ""}. Envie o arquivo no Internet Banking.`);
      r.fora.forEach((f) => toast.error(`${f.seu_numero} · ${f.pagador} ficou de fora: ${f.erros[0]}`));
      onOpenChange(false);
    },
  });
  const p = pend.data;
  const nada = !!p && p.entradas + p.instrucoes === 0;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Gerar arquivo de remessa"
      descricao="O arquivo leva ao banco os boletos novos e as instruções (baixa, vencimento). Depois de gerar, envie-o no Internet Banking e importe o retorno."
      confirmar="Gerar e baixar"
      carregando={gerar.isPending}
      desabilitado={!cid || !p || nada || p.pendencias.length > 0}
      onConfirm={() => gerar.mutate()}
    >
      <div className="space-y-3 text-sm">
        {ativos.length > 1 && (
          <NativeSelect value={cid} onChange={(e) => setEscolhido(e.target.value ? Number(e.target.value) : "")} aria-label="Convênio">
            <option value="">Escolha o convênio…</option>
            {ativos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </NativeSelect>
        )}
        {p && (
          <>
            <p>
              <strong>{p.entradas}</strong> boleto(s) novo(s) ({moeda(p.valor)}) e <strong>{p.instrucoes}</strong> instrução(ões).
            </p>
            {nada && <p className="text-muted-foreground">Não há nada esperando remessa neste convênio.</p>}
            {p.teste && <p className="rounded-xl bg-warning/10 p-3 text-warning-ink">Convênio ainda não homologado: a remessa sai marcada como TESTE. Valide-a no Internet Banking em Cobrança › Teste de Arquivos.</p>}
            {p.pendencias.map((x) => (
              <p key={x} className="rounded-xl bg-danger/10 p-3 text-danger-ink">
                {x}
              </p>
            ))}
          </>
        )}
      </div>
    </ConfirmDialog>
  );
}

function Remessas() {
  const q = useQuery({ queryKey: ["boletos", "remessas"], queryFn: () => api.get<RemessaOut[]>("/boletos/remessas") });
  const itens = q.data ?? [];
  return (
    <TableCard>
      {q.isPending ? (
        <TableSkeleton colunas={6} />
      ) : itens.length === 0 ? (
        <EmptyState icone={Send} titulo="Nenhuma remessa gerada" descricao="Crie os boletos e clique em “Gerar remessa”." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Nº</th>
                <th className="px-3 py-2.5 font-medium">Arquivo</th>
                <th className="px-3 py-2.5 font-medium">Convênio</th>
                <th className="px-3 py-2.5 font-medium">Gerada em</th>
                <th className="px-3 py-2.5 text-right font-medium">Registros</th>
                <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                <th className="w-28 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-mono text-xs">{r.sequencial}</td>
                  <td className="px-3 py-3 font-mono text-xs">
                    {r.nome_arquivo} {r.ambiente === "teste" && <Pill tom="warning">Teste</Pill>}
                  </td>
                  <td className="px-3 py-3">{r.convenio_nome}</td>
                  <td className="px-3 py-3 font-mono text-xs">{dataHora(r.gerado_em)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.qtd_boletos}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{moeda(r.valor_total)}</td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => baixar(`/boletos/remessas/${r.id}/arquivo`, {}, r.nome_arquivo).catch((e: Error) => toast.error(e.message))}>
                      <Download /> Baixar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}

function Retornos({ abrir }: { abrir: (id: number) => void }) {
  const q = useQuery({ queryKey: ["boletos", "retornos"], queryFn: () => api.get<RetornoOut[]>("/boletos/retornos") });
  const itens = q.data ?? [];
  return (
    <TableCard>
      {q.isPending ? (
        <TableSkeleton colunas={5} />
      ) : itens.length === 0 ? (
        <EmptyState icone={FileUp} titulo="Nenhum retorno importado" descricao="Depois de enviar a remessa ao banco, baixe o arquivo de retorno e importe aqui." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Arquivo</th>
                <th className="px-3 py-2.5 font-medium">Convênio</th>
                <th className="px-3 py-2.5 font-medium">Importado em</th>
                <th className="px-3 py-2.5 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((r) => {
                const c = r.resumo.contagem;
                return (
                  <tr key={r.id} className={linhaClicavel} onClick={() => abrir(r.id)}>
                    <td className="px-4 py-3 font-mono text-xs">{r.nome_arquivo}</td>
                    <td className="px-3 py-3">{r.convenio_nome}</td>
                    <td className="px-3 py-3 font-mono text-xs">{dataHora(r.importado_em)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.registrados > 0 && <Pill tom="brand">{c.registrados} registrado(s)</Pill>}
                        {c.pagos > 0 && <Pill tom="success">{c.pagos} pago(s)</Pill>}
                        {c.rejeitados > 0 && <Pill tom="danger">{c.rejeitados} rejeitado(s)</Pill>}
                        {c.baixados > 0 && <Pill tom="neutral">{c.baixados} baixado(s)</Pill>}
                        {c.orfas > 0 && <Pill tom="warning">{c.orfas} sem boleto</Pill>}
                        {r.qtd_ocorrencias === 0 && <Pill tom="neutral">vazio</Pill>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TableCard>
  );
}
