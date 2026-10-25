"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Banknote,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Download,
  FilePlus2,
  FileSpreadsheet,
  Loader2,
  MailCheck,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Receipt,
  Repeat,
  Send,
  Trash2,
  Undo2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CategoriaSubSelect, mesAtual } from "@/components/financeiro/comum";
import { ImportarContasDialog, PagarDialog, PagarLoteDialog } from "@/components/financeiro/pagar/dialogos";
import { Stat } from "@/components/financeiro/ui";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Pagination, SearchInput, Segmented, TableCard, TableSkeleton } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { abrirArquivo, api, baixar } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ContaPagarOut, ContasPagarListaOut } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "" | "pendente" | "atrasado" | "pago" | "aberto";
const POR_PAGINA = 100;

const STATUS: Record<string, { l: string; cls: string }> = {
  pendente: { l: "Pendente", cls: "bg-brand/10 text-info-ink ring-brand/25" },
  atrasado: { l: "Atrasado", cls: "bg-danger/10 text-danger-ink ring-danger/25" },
  pago: { l: "Pago", cls: "bg-success/10 text-success-ink ring-success/25" },
};

function Rateio({ c }: { c: ContaPagarOut }) {
  if (c.rateio.length <= 1)
    return (
      <>
        <span>{c.categoria_nome ?? <span className="text-warning-ink">sem categoria</span>}</span>
        {c.subcategoria_nome && <span className="block text-[11px] text-muted-foreground">{c.subcategoria_nome}</span>}
      </>
    );
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-info-ink hover:bg-brand/15" />}>
        Rateio ({c.rateio.length})
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-1 p-3">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">Rateio de {moeda(c.valor)}</p>
        {c.rateio.map((r, i) => (
          <div key={i} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="truncate">
                {r.categoria_nome}
                {r.subcategoria_nome && <span className="text-muted-foreground"> › {r.subcategoria_nome}</span>}
              </span>
              <span className="font-mono">{moeda(r.valor)}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-brand" style={{ width: `${toNum(r.percentual)}%` }} />
              </div>
              <span className="w-12 text-right text-muted-foreground tabular-nums">{toNum(r.percentual).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Lancamentos() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("contas_pagar.editar");
  const podePagar = pode("contas_pagar.pagar");
  const podeExcluir = pode("contas_pagar.excluir");

  // filtros moram na URL; sem nenhum parâmetro, abre no mês atual
  const temParams = sp.toString().length > 0;
  const mes = mesAtual();
  const filtros = {
    q: sp.get("q") ?? "",
    categoria_id: sp.get("categoria_id") ? Number(sp.get("categoria_id")) : null,
    subcategoria_id: sp.get("subcategoria_id") ? Number(sp.get("subcategoria_id")) : null,
    status: (sp.get("status") ?? "") as Status,
    de: temParams ? (sp.get("de") ?? "") : mes.de,
    ate: temParams ? (sp.get("ate") ?? "") : mes.ate,
    pagina: Number(sp.get("pagina") ?? 1),
  };
  const setFiltros = (mud: Partial<typeof filtros>) => {
    const n = { ...filtros, pagina: 1, ...mud };
    const u = new URLSearchParams();
    Object.entries(n).forEach(([k, v]) => {
      if (k === "pagina" && v === 1) return;
      if (v !== null && v !== "" && v !== undefined) u.set(k, String(v));
    });
    if (!u.toString()) u.set("de", ""); // mantém "todo o período" ao limpar as datas
    router.replace(`${pathname}?${u.toString()}`, { scroll: false });
  };
  const [busca, setBusca] = useState(filtros.q);
  const buscaDeb = useDebounce(busca, 350);
  const ultimaBusca = useRef(filtros.q);
  useEffect(() => {
    if (buscaDeb !== ultimaBusca.current) {
      ultimaBusca.current = buscaDeb;
      setFiltros({ q: buscaDeb });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só quando a busca muda
  }, [buscaDeb]);

  const params = {
    q: filtros.q || undefined,
    categoria_id: filtros.categoria_id ?? undefined,
    subcategoria_id: filtros.subcategoria_id ?? undefined,
    status: filtros.status || undefined,
    de: filtros.de || undefined,
    ate: filtros.ate || undefined,
    pagina: filtros.pagina,
    por_pagina: POR_PAGINA,
  };
  const q = useQuery({
    queryKey: ["fin", "contas-pagar", params],
    queryFn: () => api.get<ContasPagarListaOut>("/financeiro/contas-pagar", params),
    placeholderData: (p) => p,
  });
  const itens = q.data?.itens ?? [];
  const k = (q.data?.kpis ?? {}) as Record<string, number | string>;

  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pagar, setPagar] = useState<ContaPagarOut | null>(null);
  const [lote, setLote] = useState<ContaPagarOut[]>([]);
  const [excluir, setExcluir] = useState<ContaPagarOut | null>(null);
  const [importar, setImportar] = useState(false);
  const upRef = useRef<HTMLInputElement>(null);
  const [upAlvo, setUpAlvo] = useState<{ id: number; tipo: "anexo" | "comprovante" } | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: ["fin"] });

  const reabrir = useMutation({ mutationFn: (id: number) => api.post(`/financeiro/contas-pagar/${id}/reabrir`), onSuccess: () => (toast.success("Conta reaberta"), invalidar()) });
  const agendar = useMutation({
    mutationFn: (id: number) => api.post<ContaPagarOut>(`/financeiro/contas-pagar/${id}/agendamento`),
    onSuccess: () => (toast.success("Aviso de agendamento enviado"), invalidar()),
  });
  const remover = useMutation({
    mutationFn: ({ id, escopo }: { id: number; escopo: "ocorrencia" | "serie" }) => api<{ mensagem: string }>(`/financeiro/contas-pagar/${id}`, { method: "DELETE", query: { escopo } }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      invalidar();
    },
  });
  const enviar = useMutation({
    mutationFn: ({ id, tipo, f }: { id: number; tipo: string; f: File }) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post(`/financeiro/contas-pagar/${id}/arquivo`, fd, { query: { tipo } });
    },
    onSuccess: (_r, v) => (toast.success(v.tipo === "anexo" ? "Anexo enviado" : "Comprovante enviado"), invalidar()),
  });
  const anexar = (id: number, tipo: "anexo" | "comprovante") => {
    setUpAlvo({ id, tipo });
    upRef.current?.click();
  };

  const abertasSel = itens.filter((c) => sel.has(c.id) && !c.data_pagamento);
  const totalSel = itens.filter((c) => sel.has(c.id)).reduce((a, c) => a + toNum(c.valor), 0);
  const marcar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
  const todos = itens.length > 0 && itens.every((c) => sel.has(c.id));
  const filtrando = !!(filtros.q || filtros.categoria_id || filtros.status);

  return (
    <div className={cn(sel.size > 0 && "pb-24")}>
      <PageHeader
        titulo="Contas a pagar"
        icone={CalendarClock}
        migalhas={[{ label: "Contas a Pagar" }, { label: "Lançamentos" }]}
        acoes={
          <>
            <Button variant="outline" onClick={() => baixar("/financeiro/contas-pagar/exportar.xlsx", { query: params }, "contas_a_pagar.xlsx")}>
              <FileSpreadsheet /> Exportar
            </Button>
            <Button variant="outline" onClick={() => baixar("/financeiro/contas-pagar/modelo.xlsx", {}, "modelo_contas_a_pagar.xlsx")}>
              <Download /> Modelo
            </Button>
            {podeEditar && (
              <>
                <Button variant="outline" onClick={() => setImportar(true)}>
                  <Upload /> Importar
                </Button>
                <Button render={<Link href="/financeiro/pagar/nova" />}>
                  <FilePlus2 /> Nova conta
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button type="button" className="text-left" onClick={() => setFiltros({ status: filtros.status === "aberto" ? "" : "aberto" })}>
          <Stat rotulo="Em aberto" valor={moeda(k.em_aberto)} sub={`${k.qtd_aberto ?? 0} conta(s)`} icone={Wallet} tom="brand" destaque={filtros.status === "aberto"} />
        </button>
        <button type="button" className="text-left" onClick={() => setFiltros({ status: filtros.status === "atrasado" ? "" : "atrasado" })}>
          <Stat rotulo="Atrasado" valor={moeda(k.atrasado)} sub={`${k.qtd_atrasado ?? 0} conta(s)`} icone={AlarmClock} tom="danger" destaque={filtros.status === "atrasado"} />
        </button>
        <Stat rotulo="Próximos 7 dias" valor={moeda(k.proximos_7_dias)} sub={`${k.qtd_proximos_7_dias ?? 0} conta(s)`} icone={CalendarDays} tom="warning" />
        <button type="button" className="text-left" onClick={() => setFiltros({ status: filtros.status === "pago" ? "" : "pago" })}>
          <Stat rotulo="Pago" valor={moeda(k.pago)} sub={`${k.qtd_pago ?? 0} conta(s)`} icone={CheckCircle2} tom="success" destaque={filtros.status === "pago"} />
        </button>
      </div>

      <TableCard>
        <div className="flex flex-col gap-2 border-b p-3 xl:flex-row xl:flex-wrap xl:items-center">
          <SearchInput value={busca} onChange={setBusca} placeholder="Favorecido, descrição ou documento" className="xl:w-72" />
          <CategoriaSubSelect
            idBase="cp-filtro"
            tipo="despesa"
            vazio="Todas as categorias"
            categoriaId={filtros.categoria_id}
            subcategoriaId={filtros.subcategoria_id}
            onChange={(c, s) => setFiltros({ categoria_id: c, subcategoria_id: s })}
            className="xl:w-[26rem]"
          />
          <Segmented<Status>
            value={filtros.status}
            onChange={(v) => setFiltros({ status: v })}
            opcoes={[
              { value: "", label: "Todas" },
              { value: "pendente", label: "Pendentes" },
              { value: "atrasado", label: "Atrasadas", tom: "danger" },
              { value: "pago", label: "Pagas", tom: "success" },
            ]}
          />
          <div className="flex items-center gap-1.5">
            <Input type="date" aria-label="Vencimento de" value={filtros.de} onChange={(e) => setFiltros({ de: e.target.value })} className="h-9 w-38" />
            <span className="text-xs text-muted-foreground">até</span>
            <Input type="date" aria-label="Vencimento até" value={filtros.ate} onChange={(e) => setFiltros({ ate: e.target.value })} className="h-9 w-38" />
            <Button variant="ghost" size="sm" onClick={() => setFiltros({ de: mes.de, ate: mes.ate })}>
              Mês atual
            </Button>
          </div>
        </div>
        {q.isPending ? (
          <TableSkeleton colunas={8} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={Receipt}
            titulo={filtrando ? "Nenhuma conta com esses filtros" : "Nenhuma conta neste período"}
            descricao={filtrando ? "Troque os filtros ou o período." : "Lance as contas do mês ou importe a planilha do modelo."}
            acao={
              podeEditar && (
                <div className="flex gap-2">
                  <Button render={<Link href="/financeiro/pagar/nova" />}>
                    <FilePlus2 /> Nova conta
                  </Button>
                  <Button variant="outline" onClick={() => setImportar(true)}>
                    <Upload /> Importar
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <div className={cn("overflow-x-auto transition-opacity", q.isFetching && "opacity-70")}>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox checked={todos} indeterminate={!todos && sel.size > 0} onCheckedChange={(v) => itens.forEach((c) => marcar(c.id, !!v))} aria-label="Selecionar página" />
                  </th>
                  <th className="px-2 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Favorecido</th>
                  <th className="px-3 py-2.5 font-medium">Categoria</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Pagamento</th>
                  <th className="w-28 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((c) => {
                  const st = STATUS[c.status] ?? STATUS.pendente;
                  const pago = !!c.data_pagamento;
                  return (
                    <tr key={c.id} className={cn("group align-top transition-colors hover:bg-accent/30", sel.has(c.id) && "bg-brand/[0.04]")}>
                      <td className="px-4 py-3">
                        <Checkbox checked={sel.has(c.id)} onCheckedChange={(v) => marcar(c.id, !!v)} aria-label={`Selecionar ${c.favorecido_nome || c.descricao}`} />
                      </td>
                      <td className="px-2 py-3 whitespace-nowrap">
                        <p className={cn("font-mono text-xs", c.status === "atrasado" && "font-semibold text-danger-ink")}>{data(c.data_vencimento)}</p>
                        {c.documento && <p className="font-mono text-[11px] text-muted-foreground">{c.documento}</p>}
                      </td>
                      <td className="max-w-72 px-3 py-3">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {c.favorecido_nome || c.descricao}
                          {c.grupo_recorrencia && (
                            <span title={c.recorrencia_indeterminada ? "Recorrente, sem fim" : `Parcela ${c.parcela}/${c.parcelas_total}`} className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                              <Repeat className="size-3" />
                              {c.parcela && c.parcelas_total ? `${c.parcela}/${c.parcelas_total}` : ""}
                            </span>
                          )}
                        </p>
                        {c.favorecido_nome && c.descricao && <p className="truncate text-[11px] text-muted-foreground">{c.descricao}</p>}
                      </td>
                      <td className="max-w-52 px-3 py-3 text-xs">
                        <Rateio c={c} />
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-semibold whitespace-nowrap tabular-nums">{moeda(c.valor)}</td>
                      <td className="px-3 py-3">
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", st.cls)}>{st.l}</span>
                        {c.dias_atraso > 0 && <p className="mt-0.5 text-[11px] text-danger-ink">{c.dias_atraso} dia(s)</p>}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {pago ? (
                          <>
                            <p className="font-mono">{data(c.data_pagamento)}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {moeda(c.valor_pago)}
                              {c.conta_bancaria_nome && ` · ${c.conta_bancaria_nome}`}
                            </p>
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {c.tem_anexo && (
                            <Button variant="ghost" size="icon-sm" aria-label="Ver boleto/nota" title="Ver boleto/nota" onClick={() => abrirArquivo(`/financeiro/contas-pagar/${c.id}/arquivo?tipo=anexo`)}>
                              <Paperclip />
                            </Button>
                          )}
                          {c.agendamento_enviado_em && (
                            <span title={`Aviso de agendamento enviado em ${data(c.agendamento_enviado_em)}`} className="grid size-7 place-items-center text-success-ink">
                              <MailCheck className="size-4" />
                            </span>
                          )}
                          {podePagar && !pago && (
                            <Button size="xs" variant="outline" onClick={() => setPagar(c)}>
                              <Banknote /> Pagar
                            </Button>
                          )}
                          {(podeEditar || podePagar || podeExcluir) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${c.favorecido_nome || c.descricao}`} />}>
                                <MoreHorizontal />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-60">
                                {!pago && podeEditar && (
                                  <DropdownMenuItem onClick={() => router.push(`/financeiro/pagar/${c.id}`)}>
                                    <Pencil /> Editar
                                  </DropdownMenuItem>
                                )}
                                {pago && podePagar && (
                                  <DropdownMenuItem onClick={() => reabrir.mutate(c.id)}>
                                    <Undo2 /> Reabrir (desfazer pagamento)
                                  </DropdownMenuItem>
                                )}
                                {podeEditar && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => anexar(c.id, "anexo")}>
                                      <Upload /> {c.tem_anexo ? "Trocar boleto/nota" : "Anexar boleto/nota"}
                                    </DropdownMenuItem>
                                    {c.tem_comprovante ? (
                                      <DropdownMenuItem onClick={() => abrirArquivo(`/financeiro/contas-pagar/${c.id}/arquivo?tipo=comprovante`)}>
                                        <Receipt /> Ver comprovante
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem onClick={() => anexar(c.id, "comprovante")}>
                                        <Receipt /> Anexar comprovante
                                      </DropdownMenuItem>
                                    )}
                                    {!pago && (
                                      <DropdownMenuItem onClick={() => agendar.mutate(c.id)}>
                                        <Send /> {c.agendamento_enviado_em ? `Reenviar aviso (enviado ${data(c.agendamento_enviado_em)})` : "Enviar aviso de agendamento"}
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                )}
                                {podeExcluir && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem variant="destructive" onClick={() => setExcluir(c)}>
                                      <Trash2 /> Excluir
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-sm font-medium">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs text-muted-foreground">
                    {q.data?.total ?? 0} conta(s) no filtro
                    {q.isFetching && <Loader2 className="ml-2 inline size-3 animate-spin" />}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">{moeda(k.total)}</td>
                  <td colSpan={3} className="px-3 py-2.5 text-xs text-muted-foreground">
                    aberto {moeda(k.em_aberto)} · pago {moeda(k.pago)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <Pagination pagina={filtros.pagina} porPagina={POR_PAGINA} total={q.data?.total ?? 0} onChange={(p) => setFiltros({ pagina: p })} />
      </TableCard>

      <input
        ref={upRef}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        aria-label="Arquivo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && upAlvo) {
            if (f.size > 15 * 1024 * 1024) toast.error("Arquivo maior que 15 MB.");
            else enviar.mutate({ id: upAlvo.id, tipo: upAlvo.tipo, f });
          }
          e.target.value = "";
        }}
      />

      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-24 pl-4 lg:pl-[calc(var(--sb)+1rem)]"
          >
            <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
              <span className="text-sm">
                <strong className="tabular-nums">{sel.size}</strong> selecionada(s) · <strong className="font-mono">{moeda(totalSel)}</strong>
              </span>
              {podePagar && abertasSel.length > 0 && (
                <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => setLote(abertasSel)}>
                  <Banknote /> Pagar selecionadas ({abertasSel.length})
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={() => setSel(new Set())} aria-label="Limpar seleção">
                <X />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <PagarDialog conta={pagar} onClose={() => setPagar(null)} />
      <PagarLoteDialog contas={lote} onClose={() => setLote([])} onPago={() => setSel(new Set())} />
      <ImportarContasDialog open={importar} onOpenChange={setImportar} />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir esta conta?"
        descricao={excluir ? `${excluir.favorecido_nome || excluir.descricao} · ${moeda(excluir.valor)} · vence ${data(excluir.data_vencimento)}${excluir.data_pagamento ? ". O pagamento e o lançamento no extrato também são desfeitos." : ""}` : ""}
        confirmar={excluir?.grupo_recorrencia ? "Só esta" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate({ id: excluir.id, escopo: "ocorrencia" })}
      >
        {excluir?.grupo_recorrencia && (
          <Button variant="outline" className="w-full text-danger-ink" disabled={remover.isPending} onClick={() => remover.mutate({ id: excluir.id, escopo: "serie" })}>
            <Repeat /> Esta e as próximas em aberto da série
          </Button>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default function ContasPagarPage() {
  return (
    <Suspense fallback={<TableSkeleton colunas={8} />}>
      <Lancamentos />
    </Suspense>
  );
}
