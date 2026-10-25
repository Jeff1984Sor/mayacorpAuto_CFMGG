"use client";

import { ArrowRight, ChevronDown, ScrollText } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState } from "react";

import { Mono } from "@/components/mayacorp/brand";
import { Pagination, SearchInput, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { usePaginado } from "@/hooks/use-paginado";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";
import type { AuditoriaOut, UsuarioOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ENTIDADES = ["", "lote", "nfse", "rps", "emissora", "tomador", "certificado", "usuario", "identidade", "parametro_fiscal", "notificacao"];

function tomAcao(a: string): "danger" | "success" | "warning" | "brand" | "neutral" {
  if (/cancel|exclu|delet|remov|desativ/i.test(a)) return "danger";
  if (/emit|cri|import|ativ|login/i.test(a)) return "success";
  if (/alter|atualiz|edit|troc|corrig/i.test(a)) return "warning";
  return "brand";
}

const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Diff({ antes, depois }: { antes: Record<string, unknown> | null; depois: Record<string, unknown> | null }) {
  const chaves = [...new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})])];
  if (!chaves.length) return <p className="text-sm text-muted-foreground">Sem dados alterados registrados.</p>;
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Campo</th>
            <th className="px-3 py-2 font-medium">Antes</th>
            <th className="w-6" />
            <th className="px-3 py-2 font-medium">Depois</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {chaves.map((k) => (
            <tr key={k}>
              <td className="px-3 py-2 font-medium">{k}</td>
              <td className="max-w-64 px-3 py-2 break-all">
                <span className="rounded bg-danger/8 px-1 font-mono text-danger-ink">{fmt(antes?.[k])}</span>
              </td>
              <td>
                <ArrowRight className="size-3 text-muted-foreground" />
              </td>
              <td className="max-w-64 px-3 py-2 break-all">
                <span className="rounded bg-success/8 px-1 font-mono text-success-ink">{fmt(depois?.[k])}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AuditoriaPage() {
  const { pode } = useAuth();
  const podeVer = pode("auditoria.ver");
  const lista = usePaginado<AuditoriaOut>("auditoria", "/auditoria", {}, 30);
  const [aberto, setAberto] = useState<number | null>(null);
  const usuarios = useQuery({
    queryKey: ["usuarios"],
    queryFn: () => api.get<UsuarioOut[]>("/config/usuarios"),
    enabled: podeVer,
    meta: { silencioso: true },
  });
  const fotos = new Map((usuarios.data ?? []).map((u) => [u.nome, u.foto_url]));
  if (!podeVer) return <SemAcesso />;

  return (
    <div>
      <PageHeader
        titulo="Auditoria"
        descricao="Registro imutável: quem fez o quê, quando, de onde — com o antes e o depois."
        icone={ScrollText}
        migalhas={[{ label: "Início", href: "/" }, { label: "Auditoria" }]}
      />
      <TableCard>
        <Toolbar>
          <SearchInput value={lista.q} onChange={lista.setQ} placeholder="Usuário, ação ou descrição" />
          <NativeSelect value={String(lista.filtros.entidade ?? "")} onChange={(e) => lista.setFiltro("entidade", e.target.value)} className="w-48">
            {ENTIDADES.map((e) => (
              <option key={e} value={e}>
                {e ? e.replace("_", " ") : "Todas as entidades"}
              </option>
            ))}
          </NativeSelect>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={5} />
        ) : lista.itens.length === 0 ? (
          <EmptyState icone={ScrollText} titulo="Nenhum registro" descricao="As ações sensíveis aparecem aqui automaticamente." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-3 py-2.5 font-medium">Quem</th>
                  <th className="px-3 py-2.5 font-medium">Ação</th>
                  <th className="px-3 py-2.5 font-medium">O quê</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">IP</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.itens.map((a) => {
                  const temDiff = !!(a.antes_json || a.depois_json);
                  const on = aberto === a.id;
                  return (
                    <Fragment key={a.id}>
                      <tr
                        className={cn("transition-colors", temDiff && "cursor-pointer hover:bg-accent/40", on && "bg-accent/40")}
                        onClick={() => temDiff && setAberto(on ? null : a.id)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          <Mono>{dataHora(a.criado_em)}</Mono>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <UserAvatar
                              nome={a.usuario_nome ?? "Robô"}
                              fotoUrl={a.usuario_nome ? fotos.get(a.usuario_nome) : null}
                              className="size-6"
                              textoClassName="text-[9px]"
                              inativo={!a.usuario_nome}
                            />
                            <span className="truncate">{a.usuario_nome ?? "Robô"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Pill tom={tomAcao(a.acao)}>{a.acao.replaceAll("_", " ")}</Pill>
                        </td>
                        <td className="max-w-md px-3 py-3">
                          <p className="truncate">{a.descricao ?? "—"}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {a.entidade}
                            {a.entidade_id && <Mono> #{a.entidade_id}</Mono>}
                          </p>
                        </td>
                        <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                          <Mono>{a.ip ?? "—"}</Mono>
                        </td>
                        <td className="px-3 py-3">
                          {temDiff && <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", on && "rotate-180")} />}
                        </td>
                      </tr>
                      <AnimatePresence>
                        {on && (
                          <tr>
                            <td colSpan={6} className="bg-muted/30 p-0">
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className="p-4">
                                  <Diff antes={a.antes_json} depois={a.depois_json} />
                                </div>
                              </motion.div>
                            </td>
                          </tr>
                        )}
                      </AnimatePresence>
                    </Fragment>
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
