"use client";

import {
  Ban,
  Download,
  ExternalLink,
  FileCheck2,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  MoreHorizontal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Mono } from "@/components/mayacorp/brand";
import { Pagination, SearchInput, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { EnviarEmailsLote } from "@/components/email/enviar-lote";
import { BotaoEmailNota } from "@/components/email/enviar-nota";
import { CancelarNotaDialog, SelosNota, useAcoesNota } from "@/components/nfse/acoes-nota";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { usePaginado } from "@/hooks/use-paginado";
import { useAuth } from "@/lib/auth";
import { data, documento, moeda, numero } from "@/lib/format";
import type { FiltroNotas, NfseOut } from "@/lib/types";

export default function NotasPage() {
  const router = useRouter();
  const { isAdmin, isOperador } = useAuth();
  const lista = usePaginado<NfseOut>("notas", "/nfse/notas", {}, 25);
  const acoes = useAcoesNota();
  const [sel, setSel] = useState<Map<number, NfseOut>>(new Map());
  const [todasDoFiltro, setTodasDoFiltro] = useState(false);
  const [emailLote, setEmailLote] = useState(false);
  const [cancelar, setCancelar] = useState<NfseOut | null>(null);

  const ids = [...sel.keys()];
  const todos = lista.itens.length > 0 && lista.itens.every((n) => sel.has(n.id));
  const alguns = lista.itens.some((n) => sel.has(n.id));
  const qtdSel = todasDoFiltro ? lista.total : sel.size;
  const limparSel = () => {
    setSel(new Map());
    setTodasDoFiltro(false);
  };
  // trocar busca/filtros desfaz o "todas do filtro" (a seleção passaria a valer para outras notas)
  const chaveFiltro = JSON.stringify([lista.q, lista.filtros]);
  const [chaveAnterior, setChaveAnterior] = useState(chaveFiltro);
  if (chaveAnterior !== chaveFiltro) {
    setChaveAnterior(chaveFiltro);
    setTodasDoFiltro(false);
  }
  const filtroAtual: FiltroNotas = {
    q: lista.q || null,
    status: (lista.filtros.status as string) || null,
    de: (lista.filtros.de as string) || null,
    ate: (lista.filtros.ate as string) || null,
    pagamento: (lista.filtros.pagamento as string) || null,
  };
  const marcarNota = (n: NfseOut, v: boolean) => {
    setTodasDoFiltro(false);
    setSel((s) => {
      const m = new Map(s);
      if (v) m.set(n.id, n);
      else m.delete(n.id);
      return m;
    });
  };
  const filtrando = !!(lista.q || lista.filtros.status || lista.filtros.de || lista.filtros.ate || lista.filtros.pagamento);

  return (
    <div>
      <PageHeader
        titulo="Notas emitidas"
        descricao="Busque, baixe, reenvie e cancele as NFS-e emitidas."
        icone={FileCheck2}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Notas emitidas" }]}
        acoes={
          <Button variant="outline" onClick={() => acoes.exportar.mutate([])} disabled={acoes.exportar.isPending}>
            <FileSpreadsheet /> Exportar Excel
          </Button>
        }
      />

      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Nº da nota, RPS, tomador, CPF/CNPJ ou valor" className="sm:w-96" />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={String(lista.filtros.de ?? "")}
              onChange={(e) => lista.setFiltro("de", e.target.value)}
              className="h-9 w-38"
              aria-label="De"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <Input
              type="date"
              value={String(lista.filtros.ate ?? "")}
              onChange={(e) => lista.setFiltro("ate", e.target.value)}
              className="h-9 w-38"
              aria-label="Até"
            />
            <NativeSelect value={String(lista.filtros.status ?? "")} onChange={(e) => lista.setFiltro("status", e.target.value)} className="w-36">
              <option value="">Todas</option>
              <option value="emitida">Emitidas</option>
              <option value="cancelada">Canceladas</option>
            </NativeSelect>
            <NativeSelect value={String(lista.filtros.pagamento ?? "")} onChange={(e) => lista.setFiltro("pagamento", e.target.value)} className="w-40">
              <option value="">Pagas e em aberto</option>
              <option value="paga">Pagas</option>
              <option value="aberta">Em aberto</option>
            </NativeSelect>
          </div>
        </Toolbar>

        {lista.isPending ? (
          <TableSkeleton colunas={7} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={FileCheck2}
            titulo={filtrando ? "Nenhuma nota encontrada" : "Nenhuma nota emitida ainda"}
            descricao={filtrando ? "Ajuste a busca ou o período." : "As notas emitidas pelo robô aparecem aqui, com PDF e XML."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <Checkbox
                      checked={todasDoFiltro || todos}
                      indeterminate={!todasDoFiltro && !todos && alguns}
                      onCheckedChange={(v) => {
                        if (!v) return limparSel();
                        lista.itens.forEach((n) => marcarNota(n, true));
                      }}
                      aria-label="Selecionar página"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">Nº NFS-e</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Verificação</th>
                  <th className="px-3 py-2.5 font-medium">Emissão</th>
                  <th className="px-3 py-2.5 font-medium">Tomador</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">ISS</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              {(todasDoFiltro || (todos && lista.total > lista.itens.length)) && (
                <tbody>
                  <tr>
                    <td colSpan={9} className="border-b bg-brand/6 px-4 py-2 text-center text-sm">
                      {todasDoFiltro ? (
                        <>
                          Todas as <strong className="num">{numero(lista.total)}</strong> notas do filtro estão selecionadas.{" "}
                          <button type="button" onClick={limparSel} className="font-medium text-info-ink hover:underline">
                            Limpar seleção
                          </button>
                        </>
                      ) : (
                        <>
                          As <strong className="num">{numero(lista.itens.length)}</strong> notas desta página estão selecionadas.{" "}
                          <button type="button" onClick={() => setTodasDoFiltro(true)} className="font-medium text-info-ink hover:underline">
                            Selecionar todas as {numero(lista.total)} notas do filtro
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                </tbody>
              )}
              <tbody className="divide-y">
                {lista.itens.map((n) => (
                  <tr key={n.id} className={linhaClicavel} onClick={() => router.push(`/nfse/notas/${n.id}`)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={todasDoFiltro || sel.has(n.id)} onCheckedChange={(v) => marcarNota(n, !!v)} aria-label={`Selecionar nota ${n.numero}`} />
                    </td>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">
                      <Mono>{n.numero}</Mono>
                      <SelosNota n={n} />
                      <p className="text-[11px] font-normal text-muted-foreground num">
                        RPS {n.rps_numero}/{n.rps_serie}
                        {n.fatura_id && (
                          <>
                            {" · "}
                            <Link href={`/nfse/faturas/${n.fatura_id}`} onClick={(e) => e.stopPropagation()} className="text-info-ink hover:underline">
                              {n.fatura_codigo ?? "fatura"}
                            </Link>
                          </>
                        )}
                      </p>
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground lg:table-cell">
                      <Mono>{n.cod_verificacao}</Mono>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      <Mono>{data(n.data_emissao)}</Mono>
                    </td>
                    <td className="max-w-60 px-3 py-3">
                      <p className="truncate">{n.tomador_nome}</p>
                      <p className="text-[11px] text-muted-foreground num">{documento(n.tomador_doc)}</p>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Mono>{moeda(n.valor)}</Mono>
                    </td>
                    <td className="hidden px-3 py-3 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                      <Mono>{moeda(n.iss)}</Mono>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={n.status} />
                        {n.status === "emitida" &&
                          (n.pago_em ? (
                            <span className="text-[11px] font-medium text-success-ink">✓ paga em {data(n.pago_em)}</span>
                          ) : n.fatura_id ? (
                            <span className="text-[11px] text-muted-foreground">a receber</span>
                          ) : null)}
                      </div>
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-0.5">
                      {isOperador && n.status === "emitida" && <BotaoEmailNota nfseId={n.id} numero={n.numero} />}
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => acoes.pdf(n)}>
                            <FileText /> Ver PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => acoes.xml(n)}>
                            <FileCode2 /> Baixar XML
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => acoes.prefeitura(n)}>
                            <ExternalLink /> Abrir na Prefeitura
                          </DropdownMenuItem>
                          {isAdmin && n.status === "emitida" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setCancelar(n)}>
                                <Ban /> Cancelar nota
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />
      </TableCard>

      {/* barra de ações em massa (deixa o canto direito livre para o botão do Comunicador) */}
      <AnimatePresence>
        {qtdSel > 0 && (
          <motion.div
            initial={{ y: 90, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 90, opacity: 0, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center pr-24 pl-4 lg:pl-[calc(var(--sb)+1rem)]"
          >
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl shadow-dark-maya/30 ring-1 ring-white/10">
              <span className="mr-1 text-sm whitespace-nowrap">
                <strong className="num">{numero(qtdSel)}</strong> selecionada{qtdSel > 1 ? "s" : ""}
                {todasDoFiltro && <span className="ml-1 text-white/60">(todas do filtro)</span>}
              </span>
              {isOperador && (
                <Button size="sm" className="bg-white text-navy hover:bg-white/90" onClick={() => setEmailLote(true)}>
                  <Mail /> Enviar por e-mail
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => acoes.zip.mutate(ids)}
                disabled={acoes.zip.isPending || todasDoFiltro}
                title={todasDoFiltro ? "Para baixar, selecione as notas da página" : undefined}
              >
                {acoes.zip.isPending ? <Loader2 className="animate-spin" /> : <Download />} Baixar ZIP
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => acoes.exportar.mutate(ids)}
                disabled={todasDoFiltro}
                title={todasDoFiltro ? "Para exportar o filtro inteiro, use “Exportar Excel” no topo" : undefined}
              >
                <FileSpreadsheet /> Exportar
              </Button>
              <Button size="sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={limparSel}>
                <X /> Limpar
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {emailLote && (
        <EnviarEmailsLote
          open={emailLote}
          onOpenChange={setEmailLote}
          alvo={todasDoFiltro ? { filtro: filtroAtual, total: lista.total } : { ids, total: ids.length }}
          exemplos={todasDoFiltro ? lista.itens : [...sel.values()]}
          onConcluido={limparSel}
        />
      )}

      <CancelarNotaDialog nota={cancelar} onClose={() => setCancelar(null)} />
    </div>
  );
}
