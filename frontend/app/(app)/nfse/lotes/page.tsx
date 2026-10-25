"use client";

import { FileUp, Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Mono } from "@/components/mayacorp/brand";
import { Pagination, SearchInput, TableCard, TableSkeleton, Toolbar, linhaClicavel } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { usePaginado } from "@/hooks/use-paginado";
import { useAuth } from "@/lib/auth";
import { dataHora, moeda, numero } from "@/lib/format";
import type { LoteOut } from "@/lib/types";

const STATUS = [
  ["", "Todos os status"],
  ["validando", "Validando"],
  ["na_fila", "Na fila"],
  ["transmitindo", "Transmitindo"],
  ["concluido", "Concluído"],
  ["parcial", "Parcial"],
  ["falhou", "Falhou"],
] as const;

export default function LotesPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const podeEmitir = pode("nfse_emissao.emitir");
  const emissoras = useEmissoras();
  const lista = usePaginado<LoteOut>("lotes", "/nfse/lotes");
  const filtrando = !!lista.q || !!lista.filtros.status || !!lista.filtros.emissora_id;

  return (
    <div>
      <PageHeader
        titulo="Lotes"
        descricao="Todas as importações de arquivo e o andamento de cada uma."
        icone={Layers}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Lotes" }]}
        acoes={
          podeEmitir && (
            <Button render={<Link href="/nfse/nova-emissao" />}>
              <FileUp /> Nova emissão
            </Button>
          )
        }
      />
      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Nº do lote ou arquivo" />
          <div className="flex gap-2">
            <NativeSelect
              value={String(lista.filtros.status ?? "")}
              onChange={(e) => lista.setFiltro("status", e.target.value)}
              className="w-44"
            >
              {STATUS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            {(emissoras.data?.length ?? 0) > 1 && (
              <NativeSelect
                value={String(lista.filtros.emissora_id ?? "")}
                onChange={(e) => lista.setFiltro("emissora_id", e.target.value)}
                className="w-48"
              >
                <option value="">Todas as emissoras</option>
                {emissoras.data!.map((e) => (
                  <option key={e.id} value={e.id}>
                    {nomeEmissora(e)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={7} />
        ) : lista.itens.length === 0 ? (
          <EmptyState
            icone={Layers}
            titulo={filtrando ? "Nenhum lote encontrado" : "Nenhum lote ainda"}
            descricao={filtrando ? "Tente outro filtro." : "Cada arquivo importado vira um lote aqui."}
            acao={
              !filtrando &&
              podeEmitir && (
                <Button render={<Link href="/nfse/nova-emissao" />}>
                  <FileUp /> Importar primeiro arquivo
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Lote</th>
                  <th className="px-4 py-2.5 font-medium">Arquivo</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Emissora</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Usuário</th>
                  <th className="px-4 py-2.5 font-medium">Data</th>
                  <th className="px-4 py-2.5 text-right font-medium">Qtd.</th>
                  <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Valor</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((l) => {
                  const andando = l.status === "transmitindo" || l.status === "na_fila";
                  return (
                    <tr
                      key={l.id}
                      className={linhaClicavel}
                      onClick={() =>
                        router.push(l.status === "validando" ? `/nfse/nova-emissao?lote=${l.id}` : `/nfse/lotes/${l.id}`)
                      }
                    >
                      <td className="px-4 py-3 font-semibold">
                        <Mono>#{String(l.numero).padStart(4, "0")}</Mono>
                      </td>
                      <td className="max-w-56 truncate px-4 py-3">{l.arquivo_origem}</td>
                      <td className="hidden max-w-48 truncate px-4 py-3 text-muted-foreground lg:table-cell">{l.emissora_nome}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{l.usuario_nome ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        <Mono>{dataHora(l.criado_em)}</Mono>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Mono>{numero(l.qtd)}</Mono>
                        {l.qtd_rejeitadas > 0 && <span className="ml-1 text-xs text-danger-ink num">({l.qtd_rejeitadas}✕)</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-right whitespace-nowrap sm:table-cell">
                        <Mono>{moeda(l.valor_total)}</Mono>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={l.status} />
                          {andando && l.sublotes_total > 0 && (
                            <Progress value={(l.sublotes_feitos / l.sublotes_total) * 100} className="w-24" />
                          )}
                        </div>
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
    </div>
  );
}
