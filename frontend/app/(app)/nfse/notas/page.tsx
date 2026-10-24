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
import type { NfseOut } from "@/lib/types";

export default function NotasPage() {
  const router = useRouter();
  const { isAdmin, isOperador } = useAuth();
  const lista = usePaginado<NfseOut>("notas", "/nfse/notas", {}, 25);
  const acoes = useAcoesNota();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cancelar, setCancelar] = useState<NfseOut | null>(null);

  const ids = [...sel];
  const todos = lista.itens.length > 0 && lista.itens.every((n) => sel.has(n.id));
  const alguns = lista.itens.some((n) => sel.has(n.id));
  const marcar = (id: number, v: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });
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
                      checked={todos}
                      indeterminate={!todos && alguns}
                      onCheckedChange={(v) => lista.itens.forEach((n) => marcar(n.id, !!v))}
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
              <tbody className="divide-y">
                {lista.itens.map((n) => (
                  <tr key={n.id} className={linhaClicavel} onClick={() => router.push(`/nfse/notas/${n.id}`)}>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={sel.has(n.id)} onCheckedChange={(v) => marcar(n.id, !!v)} aria-label={`Selecionar nota ${n.numero}`} />
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
                          {isOperador && n.status === "emitida" && (
                            <DropdownMenuItem onClick={() => acoes.email.mutate({ id: n.id })}>
                              <Mail /> Reenviar e-mail
                            </DropdownMenuItem>
                          )}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={lista.pagina} porPagina={lista.porPagina} total={lista.total} onChange={lista.setPagina} />
      </TableCard>

      {/* barra de ações em massa */}
      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4 lg:pl-(--sb)"
          >
            <div className="flex items-center gap-2 rounded-2xl bg-dark-maya p-2 pl-4 text-white shadow-2xl ring-1 ring-white/10">
              <span className="text-sm">
                <strong className="num">{numero(sel.size)}</strong> selecionada(s)
              </span>
              <Button
                size="sm"
                className="bg-white text-navy hover:bg-white/90"
                onClick={() => acoes.zip.mutate(ids)}
                disabled={acoes.zip.isPending}
              >
                {acoes.zip.isPending ? <Loader2 className="animate-spin" /> : <Download />} Baixar ZIP
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
                onClick={() => acoes.exportar.mutate(ids)}
              >
                <FileSpreadsheet /> Excel
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => setSel(new Set())}
                aria-label="Limpar seleção"
              >
                <X />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CancelarNotaDialog nota={cancelar} onClose={() => setCancelar(null)} />
    </div>
  );
}
