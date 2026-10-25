"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PontoCor, todasDoCatalogo, useCatalogo, usePerfisAcesso, COR_PADRAO } from "@/components/perfis/comum";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CatalogoPermissoes, PerfilAcessoOut } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Cobertura do perfil em cada grupo do catálogo (ex.: Cadastros 8/15). */
function Cobertura({ perfil, catalogo }: { perfil: PerfilAcessoOut; catalogo: CatalogoPermissoes }) {
  const tem = new Set(perfil.permissoes);
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-2">
      {catalogo.grupos.map((g) => {
        const todas = g.recursos.flatMap((r) => r.acoes.map((a) => `${r.id}.${a}`));
        const n = perfil.administrador ? todas.length : todas.filter((p) => tem.has(p)).length;
        const pct = todas.length ? n / todas.length : 0;
        return (
          <div key={g.grupo} title={`${g.grupo}: ${n} de ${todas.length}`}>
            <p className="flex justify-between text-[10px] text-muted-foreground">
              <span className="truncate">{g.grupo}</span>
              <span className="tabular-nums">
                {n}/{todas.length}
              </span>
            </p>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: perfil.cor || COR_PADRAO }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PerfisPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { pode, usuario } = useAuth();
  const editar = pode("cfg_perfis.editar");
  const perfis = usePerfisAcesso();
  const catalogo = useCatalogo();
  const [q, setQ] = useState("");
  const [excluir, setExcluir] = useState<PerfilAcessoOut | null>(null);
  const total = todasDoCatalogo(catalogo.data).length;

  const duplicar = useMutation({
    mutationFn: (p: PerfilAcessoOut) => api.post<PerfilAcessoOut>(`/config/perfis/${p.id}/duplicar`),
    onSuccess: (novo) => {
      toast.success(`Perfil "${novo.nome}" criado`, { description: "Ajuste o nome e as permissões." });
      qc.invalidateQueries({ queryKey: ["perfis"] });
      router.push(`/configuracoes/perfis/${novo.id}`);
    },
  });
  const remover = useMutation({
    mutationFn: (p: PerfilAcessoOut) => api.del<{ mensagem: string }>(`/config/perfis/${p.id}`),
    onSuccess: (r) => {
      toast.success(r?.mensagem ?? "Perfil excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["perfis"] });
    },
    onError: () => setExcluir(null),
  });

  const termo = q.trim().toLowerCase();
  const lista = (perfis.data ?? []).filter((p) => !termo || p.nome.toLowerCase().includes(termo) || (p.descricao ?? "").toLowerCase().includes(termo));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Perfis de acesso</h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          {(perfis.data?.length ?? 0) > 5 && <SearchInput value={q} onChange={setQ} placeholder="Buscar perfil" className="sm:w-64" />}
          {editar && (
            <Button render={<Link href="/configuracoes/perfis/novo" />}>
              <Plus /> Novo perfil
            </Button>
          )}
        </div>
      </div>

      {perfis.isPending || catalogo.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <EmptyState icone={ShieldCheck} titulo={termo ? "Nenhum perfil com esse nome" : "Nenhum perfil cadastrado"} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((p) => {
            const n = p.administrador ? total : p.permissoes.length;
            const meu = usuario?.perfil_acesso_id === p.id;
            return (
              <article
                key={p.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
              >
                <div className="h-1.5" style={{ background: `linear-gradient(90deg, ${p.cor || COR_PADRAO}, color-mix(in oklab, ${p.cor || COR_PADRAO} 35%, transparent))` }} />
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <header className="flex items-start gap-3">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-md"
                      style={{ background: p.cor || COR_PADRAO, boxShadow: `0 6px 16px -8px ${p.cor || COR_PADRAO}` }}
                    >
                      {p.administrador ? <ShieldCheck className="size-5" /> : <span className="text-sm font-semibold">{p.nome.slice(0, 2).toUpperCase()}</span>}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="flex flex-wrap items-center gap-1.5 font-semibold">
                        <Link href={`/configuracoes/perfis/${p.id}`} className="truncate after:absolute after:inset-0 focus-visible:outline-none">
                          {p.nome}
                        </Link>
                        {p.administrador && <span className="rounded-md bg-brand/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-info-ink uppercase">Acesso total</span>}
                        {p.sistema && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground" title="Perfil padrão: não pode ser excluído">
                            <Lock className="size-3" /> padrão
                          </span>
                        )}
                        {meu && <span className="rounded-md bg-success/12 px-1.5 py-0.5 text-[10px] font-semibold text-success-ink uppercase">o seu</span>}
                      </h3>
                      <p className="mt-0.5 line-clamp-2 min-h-8 text-xs text-muted-foreground">{p.descricao || "Sem descrição."}</p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="relative z-10 -mt-1 -mr-1" aria-label={`Ações do perfil ${p.nome}`} />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => router.push(`/configuracoes/perfis/${p.id}`)}>
                          <Pencil /> {editar ? "Editar" : "Ver permissões"}
                        </DropdownMenuItem>
                        {editar && (
                          <>
                            <DropdownMenuItem onClick={() => duplicar.mutate(p)} disabled={duplicar.isPending}>
                              <Copy /> Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setExcluir(p)}>
                              <Trash2 /> Excluir
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </header>

                  <div>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="text-muted-foreground">Permissões</span>
                      <span className="font-medium tabular-nums">
                        {n} <span className="font-normal text-muted-foreground">de {total}</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full brand-gradient transition-[width]" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {catalogo.data && <Cobertura perfil={p} catalogo={catalogo.data} />}

                  <footer className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {p.qtd_usuarios === 0 ? "Ninguém usa" : p.qtd_usuarios === 1 ? "1 profissional" : `${p.qtd_usuarios} profissionais`}
                    </span>
                    <span className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <PontoCor cor={p.cor} className="size-2 ring-0" /> {editar ? "Editar" : "Ver"}
                    </span>
                  </footer>
                </div>
              </article>
            );
          })}
          {editar && !termo && (
            <Link
              href="/configuracoes/perfis/novo"
              className={cn(
                "flex min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-card/50 text-sm text-muted-foreground transition-colors",
                "hover:border-brand/50 hover:bg-brand/5 hover:text-foreground",
              )}
            >
              <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-info-ink">
                <Plus className="size-5" />
              </span>
              Criar perfil
            </Link>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o perfil "${excluir?.nome ?? ""}"?`}
        descricao={
          excluir?.qtd_usuarios
            ? `${excluir.qtd_usuarios} profissional(is) usam este perfil. Troque o perfil deles antes de excluir.`
            : "As permissões deste perfil são apagadas. Essa ação não pode ser desfeita."
        }
        confirmar="Excluir perfil"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir)}
      />
    </div>
  );
}
