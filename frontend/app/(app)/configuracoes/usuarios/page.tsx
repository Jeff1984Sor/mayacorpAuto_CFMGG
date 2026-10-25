"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronRight, KeyRound, ShieldCheck, Mail, MoreHorizontal, Pencil, UserCheck, UserPlus, Users, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { FuncionarioDialog, mascaraTelefone } from "@/components/funcionarios/funcionario-dialog";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput, Segmented, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { PerfilBadge, PontoCor, usePerfisAcesso } from "@/components/perfis/comum";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CargoOut } from "@/lib/faturamento";
import { relativo } from "@/lib/format";
import type { UsuarioOut } from "@/lib/types";
import { cn } from "@/lib/utils";

type FiltroAcesso = "todos" | "com" | "sem";

function DefinirSenhaDialog({ usuario, onClose }: { usuario: UsuarioOut | null; onClose: () => void }) {
  const [senha, setSenha] = useState("");
  const definir = useMutation({
    mutationFn: () => api.post(`/config/usuarios/${usuario!.id}/definir-senha`, { senha }),
    onSuccess: () => {
      toast.success(`Senha de ${usuario!.nome} definida`);
      setSenha("");
      onClose();
    },
  });
  return (
    <FormDialog
      open={!!usuario}
      onOpenChange={(o) => {
        if (!o) {
          setSenha("");
          onClose();
        }
      }}
      titulo={`Definir senha de ${usuario?.nome ?? ""}`}
      descricao="Combine a senha com a pessoa por um canal seguro. Ela pode trocá-la depois em Minha conta."
      rotuloSalvar="Definir senha"
      salvando={definir.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (senha.length >= 8) definir.mutate();
        else toast.error("Mínimo de 8 caracteres.");
      }}
    >
      <Field label="Nova senha" htmlFor="nova-senha-func">
        <SenhaInput id="nova-senha-func" value={senha} onChange={setSenha} autoComplete="new-password" forca autoFocus />
      </Field>
    </FormDialog>
  );
}

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: string }) {
  return (
    <div className="card-surface px-4 py-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tom)}>{valor}</p>
    </div>
  );
}

export default function ProfissionaisPage() {
  const qc = useQueryClient();
  const { usuario: eu, pode } = useAuth();
  const editar = pode("cfg_profissionais.editar");
  const [q, setQ] = useState("");
  const [cargoId, setCargoId] = useState<string>("");
  const [perfilId, setPerfilId] = useState<string>("");
  const [acesso, setAcesso] = useState<FiltroAcesso>("todos");
  const [inativos, setInativos] = useState(false);
  const [dialogo, setDialogo] = useState<{ u: UsuarioOut | null } | null>(null);
  const [senhaDe, setSenhaDe] = useState<UsuarioOut | null>(null);
  const [desativar, setDesativar] = useState<UsuarioOut | null>(null);
  const lista = useQuery({ queryKey: ["usuarios"], queryFn: () => api.get<UsuarioOut[]>("/config/usuarios"), refetchInterval: 60_000 });
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api.get<CargoOut[]>("/config/cargos") });
  const perfis = usePerfisAcesso(pode("cfg_perfis.ver"));

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number; ativo?: boolean }) => api.patch(`/config/usuarios/${id}`, body),
    onSuccess: () => {
      toast.success("Cadastro atualizado");
      setDesativar(null);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["fat", "profissionais"] });
    },
  });
  const reset = useMutation({
    mutationFn: (u: UsuarioOut) => api.post(`/config/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (_r, u) => toast.success(`Link enviado para ${u.email}`),
  });

  const todos = lista.data ?? [];
  const termo = q.trim().toLowerCase();
  const usuarios = todos.filter(
    (u) =>
      (inativos || u.ativo) &&
      (!cargoId || (cargoId === "sem" ? !u.cargo_id : String(u.cargo_id) === cargoId)) &&
      (!perfilId || (u.acesso_sistema && String(u.perfil_acesso_id) === perfilId)) &&
      (acesso === "todos" || (acesso === "com" ? u.acesso_sistema : !u.acesso_sistema)) &&
      (!termo ||
        u.nome.toLowerCase().includes(termo) ||
        u.email.toLowerCase().includes(termo) ||
        (u.login ?? "").includes(termo) ||
        (u.oab ?? "").toLowerCase().includes(termo) ||
        (u.cpf ?? "").includes(termo.replace(/\D/g, "") || "§")),
  );
  const ativos = todos.filter((u) => u.ativo);
  const online = ativos.filter((u) => u.online);
  const filtrando = !!(termo || cargoId || perfilId || acesso !== "todos");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Profissionais</h2>
          <p className="text-sm text-muted-foreground">Equipe do escritório num cadastro só: quem acessa o sistema e quem só aparece no timesheet.</p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/configuracoes/faturamento" />}>
          <BriefcaseBusiness /> Cargos e tabelas de preço
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi rotulo="Profissionais ativos" valor={ativos.length} />
        <Kpi rotulo="Com acesso ao sistema" valor={ativos.filter((u) => u.acesso_sistema).length} tom="text-info-ink" />
        <Kpi rotulo="Sem acesso (só timesheet)" valor={ativos.filter((u) => !u.acesso_sistema).length} />
        <div className="card-surface px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {online.length > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />}
              <span className={cn("relative inline-flex size-2 rounded-full", online.length ? "bg-success" : "bg-muted-foreground/40")} />
            </span>
            Online agora
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-2xl font-semibold tabular-nums">{online.length}</span>
            <div className="flex -space-x-2">
              {online.slice(0, 5).map((u) => (
                <span key={u.id} title={u.nome}>
                  <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-6 ring-2 ring-card" textoClassName="text-[9px]" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TableCard>
        <Toolbar>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <SearchInput value={q} onChange={setQ} placeholder="Nome, e-mail, login, OAB ou CPF" />
            <NativeSelect aria-label="Filtrar por cargo" value={cargoId} onChange={(e) => setCargoId(e.target.value)} className="h-9 sm:w-48">
              <option value="">Todos os cargos</option>
              <option value="sem">Sem cargo</option>
              {cargos.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </NativeSelect>
            {(perfis.data?.length ?? 0) > 0 && (
              <NativeSelect aria-label="Filtrar por perfil de acesso" value={perfilId} onChange={(e) => setPerfilId(e.target.value)} className="h-9 sm:w-48">
                <option value="">Todos os perfis</option>
                {perfis.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Segmented<FiltroAcesso>
              value={acesso}
              onChange={setAcesso}
              opcoes={[
                { value: "todos", label: "Todos" },
                { value: "com", label: "Com acesso" },
                { value: "sem", label: "Sem acesso" },
              ]}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} className="accent-[var(--brand)]" /> Mostrar inativos
            </label>
          </div>
          {editar && (
            <Button onClick={() => setDialogo({ u: null })}>
              <UserPlus /> Novo profissional
            </Button>
          )}
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : usuarios.length === 0 ? (
          <EmptyState
            icone={Users}
            titulo={filtrando ? "Ninguém com esses filtros" : "Nenhum profissional cadastrado"}
            descricao={filtrando ? "Limpe a busca ou troque o cargo e o acesso." : "Cadastre a equipe: quem acessa o sistema e quem só lança horas."}
            acao={
              filtrando ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setCargoId("");
                    setPerfilId("");
                    setAcesso("todos");
                  }}
                >
                  Limpar filtros
                </Button>
              ) : (
                editar && (
                  <Button onClick={() => setDialogo({ u: null })}>
                    <UserPlus /> Novo profissional
                  </Button>
                )
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  <th className="px-3 py-2.5 font-medium">Cargo</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Login</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">E-mail</th>
                  <th className="px-3 py-2.5 font-medium">Perfil de acesso</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Último acesso</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {usuarios.map((u) => (
                  <tr
                    key={u.id}
                    tabIndex={0}
                    onClick={() => setDialogo({ u })}
                    onKeyDown={(e) => e.key === "Enter" && setDialogo({ u })}
                    className={cn("cursor-pointer transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none", !u.ativo && "opacity-60")}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-9" textoClassName="text-xs" online={u.online} inativo={!u.ativo} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{u.nome}</span>
                            {u.id === eu?.id && <Pill tom="brand">você</Pill>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[u.oab && `OAB ${u.oab}`, u.telefone && mascaraTelefone(u.telefone)].filter(Boolean).join(" · ") || <span className="lg:hidden">{u.email}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">{u.cargo_nome ?? <span className="text-xs text-warning-ink">Sem cargo</span>}</td>
                    <td className="hidden px-3 py-3 md:table-cell">{u.login ? <span className="font-mono text-xs">{u.login}</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    <td className="hidden max-w-56 truncate px-3 py-3 text-muted-foreground lg:table-cell">{u.email}</td>
                    <td className="px-3 py-3">
                      {!u.acesso_sistema ? (
                        <Pill tom="neutral">Sem acesso</Pill>
                      ) : (
                        <PerfilBadge nome={u.perfil_acesso_nome} cor={u.perfil_acesso_cor} />
                      )}
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                      {!u.acesso_sistema ? "—" : u.online ? <span className="text-success-ink">agora</span> : relativo(u.ultimo_acesso)}
                    </td>
                    <td className="px-3 py-3">
                      {!u.ativo ? (
                        <StatusBadge status="descartado" label="Inativo" />
                      ) : u.acesso_sistema && u.convite_pendente ? (
                        <StatusBadge tom="warning" label="Convite pendente" />
                      ) : (
                        <StatusBadge status="ativo" label="Ativo" />
                      )}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${u.nome}`} />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>{u.nome}</DropdownMenuLabel>
                          </DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => setDialogo({ u })}>
                            <Pencil /> {editar ? "Editar cadastro" : "Ver cadastro"}
                          </DropdownMenuItem>
                          {u.id !== eu?.id && editar && (
                            <>
                              {u.acesso_sistema && (
                                <>
                                  <DropdownMenuItem onClick={() => setSenhaDe(u)}>
                                    <KeyRound /> Definir senha
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => reset.mutate(u)}>
                                    <Mail /> {u.convite_pendente ? "Reenviar convite" : "Enviar link de redefinição"}
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              {u.ativo ? (
                                <DropdownMenuItem variant="destructive" onClick={() => setDesativar(u)}>
                                  <UserX /> Desativar
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => patch.mutate({ id: u.id, ativo: true })}>
                                  <UserCheck /> Reativar
                                </DropdownMenuItem>
                              )}
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
      </TableCard>

      {(perfis.data?.length ?? 0) > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {perfis.data?.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPerfilId(perfilId === String(p.id) ? "" : String(p.id))}
              className={cn(
                "group rounded-2xl border bg-card p-4 text-left transition-colors hover:border-brand/40",
                perfilId === String(p.id) && "border-brand/60 bg-brand/5",
              )}
              title="Filtrar a lista por este perfil"
            >
              <p className="flex items-center gap-2 text-sm font-semibold">
                <PontoCor cor={p.cor} />
                <span className="truncate">{p.nome}</span>
                {p.administrador && <ShieldCheck className="size-3.5 text-info-ink" aria-label="Acesso total" />}
                <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{p.qtd_usuarios}</span>
              </p>
              {p.descricao && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.descricao}</p>}
            </button>
          ))}
          <div className="rounded-2xl border border-dashed bg-card p-4">
            <p className="text-sm font-semibold">Sem acesso</p>
            <p className="mt-1 text-xs text-muted-foreground">Não entra no sistema. Aparece como profissional no timesheet e nas revisões.</p>
          </div>
          {pode("cfg_perfis.ver") && (
            <Link
              href="/configuracoes/perfis"
              className="flex items-center gap-2 rounded-2xl border border-dashed bg-card p-4 text-sm font-medium text-info-ink transition-colors hover:border-brand/40"
            >
              <ShieldCheck className="size-4" /> Gerenciar perfis de acesso <ChevronRight className="ml-auto size-4" />
            </Link>
          )}
        </div>
      )}

      <FuncionarioDialog open={!!dialogo} onOpenChange={(o) => !o && setDialogo(null)} usuario={dialogo?.u ?? null} />
      <DefinirSenhaDialog usuario={senhaDe} onClose={() => setSenhaDe(null)} />
      <ConfirmDialog
        open={!!desativar}
        onOpenChange={(o) => !o && setDesativar(null)}
        titulo={`Desativar ${desativar?.nome ?? ""}?`}
        descricao="O acesso é bloqueado na hora e a pessoa sai das listas de timesheet. O histórico e a auditoria são mantidos."
        confirmar="Desativar"
        destrutivo
        carregando={patch.isPending}
        onConfirm={() => desativar && patch.mutate({ id: desativar.id, ativo: false })}
      />
    </div>
  );
}
