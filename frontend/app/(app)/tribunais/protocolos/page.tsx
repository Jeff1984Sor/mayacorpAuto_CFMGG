"use client";

import { AlertTriangle, ChevronDown, FilePlus2, FileText, Plus, Stamp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Mono } from "@/components/mayacorp/brand";
import { linhaClicavel, SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { DICA_VERIFICAR, PrazoTexto, SimuladoPill, StatusProtocoloBadge } from "@/components/tribunais-protocolo/comum";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { dataHora } from "@/lib/format";
import { ROTULO_TIPO, type TipoProtocolo, useProtocolos } from "@/lib/tribunais-protocolo";

type Filtro = "todos" | "rascunho" | "aprovado" | "andamento" | "protocolado" | "atencao";

export default function ProtocolosPage() {
  const router = useRouter();
  const { pode } = useAuth();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [tipo, setTipo] = useState<"" | TipoProtocolo>("");
  const [busca, setBusca] = useState("");
  const q = useProtocolos({ tipo: tipo || undefined });
  const todos = useMemo(() => q.data ?? [], [q.data]);

  const contagem = useMemo(() => {
    const c = { rascunho: 0, aprovado: 0, andamento: 0, protocolado: 0, atencao: 0 };
    for (const p of todos) {
      if (p.status === "rascunho") c.rascunho++;
      else if (p.status === "aprovado") c.aprovado++;
      else if (p.status === "na_fila" || p.status === "enviando") c.andamento++;
      else if (p.status === "protocolado") c.protocolado++;
      else c.atencao++;
    }
    return c;
  }, [todos]);

  const lista = todos.filter((p) => {
    if (filtro === "andamento" && !(p.status === "na_fila" || p.status === "enviando")) return false;
    if (filtro === "atencao" && !(p.status === "erro" || p.status === "verificar")) return false;
    if (["rascunho", "aprovado", "protocolado"].includes(filtro) && p.status !== filtro) return false;
    const t = busca.trim().toLowerCase();
    if (!t) return true;
    return [p.titulo, p.numero_formatado, p.tribunal, p.advogado_nome, p.numero_protocolo]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(t) || String(x).replace(/\D/g, "").includes(t.replace(/\D/g, "") || "§"));
  });

  const verificar = todos.filter((p) => p.status === "verificar");
  const podeCriar = pode("trib_protocolos.editar");

  const novo = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button />}>
        <Plus /> Nova petição <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => router.push("/tribunais/protocolos/novo?tipo=inicial")}>
          <FilePlus2 /> Petição inicial
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/tribunais/protocolos/novo?tipo=intermediaria")}>
          <FileText /> Petição intermediária
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      <PageHeader
        titulo="Protocolos"
        icone={Stamp}
        migalhas={[{ label: "Tribunais", href: "/tribunais" }, { label: "Protocolos" }]}
        acoes={podeCriar && novo}
      />

      {verificar.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0 text-warning-ink" />
          <div className="flex-1">
            <p className="font-semibold text-warning-ink">
              {verificar.length === 1 ? "1 protocolo" : `${verificar.length} protocolos`} sem resposta do tribunal
            </p>
            <p className="text-muted-foreground">
              {DICA_VERIFICAR}. Abra o portal do tribunal, veja se a petição entrou e registre o resultado.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFiltro("atencao")}>
            Ver quais são
          </Button>
        </div>
      )}

      <TableCard>
        <Toolbar>
          <SearchInput value={busca} onChange={setBusca} placeholder="Título, processo, tribunal ou nº do protocolo" />
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={tipo} onChange={(e) => setTipo(e.target.value as TipoProtocolo | "")} className="w-48" aria-label="Tipo">
              <option value="">Todos os tipos</option>
              {Object.entries(ROTULO_TIPO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </div>
        </Toolbar>
        <div className="border-b px-3 py-2">
          <Segmented
            value={filtro}
            onChange={setFiltro}
            opcoes={[
              { value: "todos", label: "Todos", contagem: todos.length },
              { value: "rascunho", label: "Rascunhos", contagem: contagem.rascunho },
              { value: "aprovado", label: "Aprovados", contagem: contagem.aprovado },
              { value: "andamento", label: "Enviando", contagem: contagem.andamento },
              { value: "protocolado", label: "Protocolados", contagem: contagem.protocolado, tom: "success" },
              { value: "atencao", label: "Precisam de atenção", contagem: contagem.atencao, tom: contagem.atencao ? "danger" : undefined },
            ]}
          />
        </div>
        {q.isPending ? (
          <TableSkeleton colunas={6} />
        ) : lista.length === 0 ? (
          <EmptyState
            icone={Stamp}
            titulo={todos.length === 0 ? "Nenhuma petição ainda" : "Nada encontrado"}
            descricao={
              todos.length === 0
                ? "Monte a petição aqui, anexe os documentos, peça a aprovação do advogado e protocole direto no tribunal."
                : "Ajuste a busca ou o filtro."
            }
            acao={todos.length === 0 && podeCriar && novo}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Petição</th>
                  <th className="px-3 py-2.5 font-medium">Processo</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Advogado</th>
                  <th className="px-3 py-2.5 font-medium">Prazo</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Protocolo nº</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((p) => (
                  <tr key={p.id} className={linhaClicavel} onClick={() => router.push(`/tribunais/protocolos/${p.id}`)}>
                    <td className="max-w-80 px-4 py-3">
                      <Link href={`/tribunais/protocolos/${p.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.titulo || ROTULO_TIPO[p.tipo]}
                      </Link>
                      <p className="text-[11px] text-muted-foreground">
                        {ROTULO_TIPO[p.tipo]} · {p.documentos} {p.documentos === 1 ? "documento" : "documentos"}
                      </p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="mr-1.5 text-xs font-semibold text-muted-foreground">{p.tribunal}</span>
                      {p.numero_formatado ? <Mono>{p.numero_formatado}</Mono> : <span className="text-xs text-muted-foreground">processo novo</span>}
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{p.advogado_nome ?? "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <PrazoTexto prazo={p.status === "protocolado" ? null : p.prazo_final} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusProtocoloBadge status={p.status} />
                        <SimuladoPill simulado={p.simulado} />
                      </div>
                      {p.status === "verificar" && <p className="mt-1 text-[11px] font-medium text-warning-ink">{DICA_VERIFICAR}</p>}
                      {p.status === "erro" && p.ultimo_erro && (
                        <p className="mt-1 max-w-64 truncate text-[11px] text-danger-ink" title={p.ultimo_erro}>
                          {p.ultimo_erro}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap lg:table-cell">
                      {p.numero_protocolo ? (
                        <>
                          <Mono>{p.numero_protocolo}</Mono>
                          <p className="text-[11px] text-muted-foreground">{dataHora(p.data_hora_protocolo)}</p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
    </div>
  );
}
