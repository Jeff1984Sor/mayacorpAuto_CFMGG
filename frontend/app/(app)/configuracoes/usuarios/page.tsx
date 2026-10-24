"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, MoreHorizontal, Pencil, UserCheck, UserPlus, UserX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput, TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativo } from "@/lib/format";
import type { Perfil, UsuarioOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const PERFIS: Record<Perfil, { l: string; d: string }> = {
  admin: { l: "Administrador", d: "Tudo: configurações, certificado, usuários, emissão e cancelamento" },
  operador: { l: "Operador", d: "Importar, validar, emitir, baixar notas e cadastrar clientes" },
  visualizador: { l: "Visualizador", d: "Consultar painel, lotes e notas; baixar PDF/XML" },
};

const LOGIN_RE = /^[a-z0-9._-]{3,60}$/;
const login = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => !v || LOGIN_RE.test(v), "3 a 60 caracteres: letras minúsculas, números, . _ -");

const conviteSchema = z
  .object({
    nome: z.string().min(2, "Obrigatório"),
    email: z.email("E-mail inválido"),
    login,
    perfil: z.enum(["admin", "operador", "visualizador"]),
    definirSenha: z.boolean(),
    senha: z.string(),
  })
  .refine((v) => !v.definirSenha || v.senha.length >= 8, { path: ["senha"], message: "Mínimo de 8 caracteres" });
type Convite = z.infer<typeof conviteSchema>;

const editarSchema = z.object({ nome: z.string().min(2, "Obrigatório"), email: z.email("E-mail inválido"), login });
type Editar = z.infer<typeof editarSchema>;

const sugerirLogin = (email: string) =>
  email
    .split("@")[0]
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "") ?? "";

function ConviteDialog({ open, onOpenChange, onSalvo }: { open: boolean; onOpenChange: (o: boolean) => void; onSalvo: () => void }) {
  const f = useForm<Convite>({
    resolver: zodResolver(conviteSchema),
    defaultValues: { nome: "", email: "", login: "", perfil: "operador", definirSenha: false, senha: "" },
  });
  const definir = f.watch("definirSenha");
  const convite = useMutation({
    mutationFn: (v: Convite) =>
      api.post("/config/usuarios", {
        nome: v.nome,
        email: v.email,
        login: v.login || null,
        perfil: v.perfil,
        senha: v.definirSenha ? v.senha : null,
      }),
    onSuccess: (_r, v) => {
      toast.success(v.definirSenha ? `${v.nome} já pode entrar` : `Convite enviado para ${v.email}`);
      f.reset();
      onOpenChange(false);
      onSalvo();
    },
  });
  const er = f.formState.errors;
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Novo usuário"
      descricao={definir ? "A pessoa entra direto com a senha que você definir." : "A pessoa recebe um e-mail e define a própria senha."}
      rotuloSalvar={definir ? "Criar usuário" : "Enviar convite"}
      salvando={convite.isPending}
      largura="lg"
      onSubmit={f.handleSubmit((v) => convite.mutate(v))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" obrigatorio erro={er.nome?.message} className="sm:col-span-2">
          <Input {...f.register("nome")} autoFocus />
        </Field>
        <Field label="E-mail" obrigatorio erro={er.email?.message}>
          <Input
            type="email"
            {...f.register("email", {
              onBlur: (e) => {
                if (!f.getValues("login")) f.setValue("login", sugerirLogin(e.target.value));
              },
            })}
          />
        </Field>
        <Field label="Usuário (login)" erro={er.login?.message} dica="Opcional — permite entrar sem digitar o e-mail.">
          <Input {...f.register("login")} className="font-mono" autoCapitalize="none" spellCheck={false} placeholder="ex.: cristina" />
        </Field>
        <div className="sm:col-span-2">
          <SwitchRow titulo="Definir senha agora" descricao="Sem depender do e-mail de convite.">
            <Switch checked={definir} onCheckedChange={(v) => f.setValue("definirSenha", v, { shouldValidate: true })} />
          </SwitchRow>
        </div>
        {definir && (
          <Field label="Senha inicial" erro={er.senha?.message} className="sm:col-span-2">
            <SenhaInput value={f.watch("senha")} onChange={(v) => f.setValue("senha", v)} autoComplete="new-password" forca />
          </Field>
        )}
        <Field label="Perfil" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(PERFIS).map(([k, p]) => (
              <label
                key={k}
                className="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors has-checked:border-brand has-checked:bg-brand/6"
              >
                <input type="radio" value={k} {...f.register("perfil")} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="block text-sm font-medium">{p.l}</span>
                  <span className="block text-xs text-muted-foreground">{p.d}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </FormDialog>
  );
}

function EditarDialog({ usuario, onClose, onSalvo }: { usuario: UsuarioOut | null; onClose: () => void; onSalvo: () => void }) {
  const f = useForm<Editar>({ resolver: zodResolver(editarSchema), defaultValues: { nome: "", email: "", login: "" } });
  useEffect(() => {
    if (usuario) f.reset({ nome: usuario.nome, email: usuario.email, login: usuario.login ?? "" });
  }, [usuario, f]);
  const salvar = useMutation({
    mutationFn: (v: Editar) => api.patch(`/config/usuarios/${usuario!.id}`, { nome: v.nome, email: v.email, login: v.login || null }),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      onClose();
      onSalvo();
    },
  });
  const er = f.formState.errors;
  return (
    <FormDialog
      open={!!usuario}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Editar ${usuario?.nome ?? ""}`}
      salvando={salvar.isPending}
      onSubmit={f.handleSubmit((v) => salvar.mutate(v))}
    >
      <div className="space-y-4">
        <Field label="Nome" erro={er.nome?.message}>
          <Input {...f.register("nome")} />
        </Field>
        <Field label="E-mail" erro={er.email?.message}>
          <Input type="email" {...f.register("email")} />
        </Field>
        <Field label="Usuário (login)" erro={er.login?.message}>
          <Input {...f.register("login")} className="font-mono" autoCapitalize="none" spellCheck={false} />
        </Field>
      </div>
    </FormDialog>
  );
}

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
      descricao="Combine a senha com a pessoa por um canal seguro. Ela pode trocá-la depois em “Trocar senha”."
      rotuloSalvar="Definir senha"
      salvando={definir.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (senha.length >= 8) definir.mutate();
        else toast.error("Mínimo de 8 caracteres.");
      }}
    >
      <Field label="Nova senha">
        <SenhaInput value={senha} onChange={setSenha} autoComplete="new-password" forca autoFocus />
      </Field>
    </FormDialog>
  );
}

export default function UsuariosPage() {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const [q, setQ] = useState("");
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<UsuarioOut | null>(null);
  const [senhaDe, setSenhaDe] = useState<UsuarioOut | null>(null);
  const [desativar, setDesativar] = useState<UsuarioOut | null>(null);
  const lista = useQuery({ queryKey: ["usuarios"], queryFn: () => api.get<UsuarioOut[]>("/config/usuarios"), refetchInterval: 60_000 });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["usuarios"] });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: number; perfil?: Perfil; ativo?: boolean }) => api.patch(`/config/usuarios/${id}`, body),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      setDesativar(null);
      invalidar();
    },
  });
  const reset = useMutation({
    mutationFn: (u: UsuarioOut) => api.post(`/config/usuarios/${u.id}/redefinir-senha`),
    onSuccess: (_r, u) => toast.success(`Link enviado para ${u.email}`),
  });

  const termo = q.toLowerCase();
  const usuarios = (lista.data ?? []).filter(
    (u) => !termo || u.nome.toLowerCase().includes(termo) || u.email.toLowerCase().includes(termo) || (u.login ?? "").includes(termo),
  );
  const online = (lista.data ?? []).filter((u) => u.online);

  return (
    <div className="space-y-4">
      {online.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 pl-4">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
          </span>
          <span className="text-sm font-medium">Online agora</span>
          <div className="flex -space-x-2">
            {online.slice(0, 8).map((u) => (
              <span key={u.id} title={u.nome}>
                <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-7 ring-2 ring-card" textoClassName="text-[10px]" />
              </span>
            ))}
          </div>
          <span className="truncate text-sm text-muted-foreground">{online.map((u) => u.nome.split(" ")[0]).join(", ")}</span>
        </div>
      )}

      <TableCard>
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder="Nome, e-mail ou login" />
          <Button onClick={() => setNovo(true)}>
            <UserPlus /> Novo usuário
          </Button>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={5} />
        ) : usuarios.length === 0 ? (
          <EmptyState icone={Users} titulo="Nenhum usuário encontrado" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Usuário</th>
                  <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Login</th>
                  <th className="px-3 py-2.5 font-medium">Perfil</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Último acesso</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {usuarios.map((u) => (
                  <tr key={u.id} className={cn("transition-colors hover:bg-accent/40", !u.ativo && "opacity-60")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-9" textoClassName="text-xs" online={u.online} inativo={!u.ativo} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-medium">
                            {u.nome}
                            {u.id === eu?.id && <Pill tom="brand">você</Pill>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      {u.login ? <Mono className="rounded bg-muted px-1.5 py-0.5">{u.login}</Mono> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <NativeSelect
                        value={u.perfil}
                        disabled={u.id === eu?.id || patch.isPending}
                        onChange={(e) => patch.mutate({ id: u.id, perfil: e.target.value as Perfil })}
                        className="h-8 w-40"
                      >
                        {Object.entries(PERFIS).map(([k, p]) => (
                          <option key={k} value={k}>
                            {p.l}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                      {u.online ? <span className="text-success-ink">agora</span> : relativo(u.ultimo_acesso)}
                    </td>
                    <td className="px-3 py-3">
                      {u.convite_pendente ? (
                        <StatusBadge tom="warning" label="Convite pendente" />
                      ) : (
                        <StatusBadge status={u.ativo ? "ativo" : "descartado"} label={u.ativo ? "Ativo" : "Inativo"} />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuGroup>
                            <DropdownMenuLabel>{u.nome}</DropdownMenuLabel>
                          </DropdownMenuGroup>
                          <DropdownMenuItem onClick={() => setEditar(u)}>
                            <Pencil /> Editar dados
                          </DropdownMenuItem>
                          {u.id !== eu?.id && (
                            <>
                              <DropdownMenuItem onClick={() => setSenhaDe(u)}>
                                <KeyRound /> Definir senha
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => reset.mutate(u)}>
                                <Mail /> {u.convite_pendente ? "Reenviar convite" : "Enviar link de redefinição"}
                              </DropdownMenuItem>
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

      <div className="grid gap-3 md:grid-cols-3">
        {Object.entries(PERFIS).map(([k, p]) => (
          <div key={k} className="rounded-2xl border bg-card p-4">
            <p className="text-sm font-semibold">{p.l}</p>
            <p className="mt-1 text-xs text-muted-foreground">{p.d}</p>
          </div>
        ))}
      </div>

      <ConviteDialog open={novo} onOpenChange={setNovo} onSalvo={invalidar} />
      <EditarDialog usuario={editar} onClose={() => setEditar(null)} onSalvo={invalidar} />
      <DefinirSenhaDialog usuario={senhaDe} onClose={() => setSenhaDe(null)} />
      <ConfirmDialog
        open={!!desativar}
        onOpenChange={(o) => !o && setDesativar(null)}
        titulo={`Desativar ${desativar?.nome ?? ""}?`}
        descricao="O acesso é bloqueado na hora. O histórico e a auditoria são mantidos."
        confirmar="Desativar"
        destrutivo
        carregando={patch.isPending}
        onConfirm={() => desativar && patch.mutate({ id: desativar.id, ativo: false })}
      />
    </div>
  );
}
