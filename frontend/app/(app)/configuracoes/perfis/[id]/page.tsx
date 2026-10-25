"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Eye,
  Loader2,
  Lock,
  Minus,
  Palette,
  Save,
  ShieldCheck,
  SquareCheckBig,
  SquareDashed,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { COR_PADRAO, CORES_PERFIL, PerfilAcessoSelect, PontoCor, todasDoCatalogo, useCatalogo, usePerfisAcesso } from "@/components/perfis/comum";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CatalogoPermissoes, PerfilAcessoIn, PerfilAcessoOut, UsuarioOut } from "@/lib/types";
import { cn } from "@/lib/utils";

type Recurso = CatalogoPermissoes["grupos"][number]["recursos"][number];
type Estado = boolean | "mixed";

interface Form {
  nome: string;
  descricao: string;
  cor: string;
  administrador: boolean;
  permissoes: string[];
}

const vazio = (): Form => ({ nome: "", descricao: "", cor: CORES_PERFIL[1], administrador: false, permissoes: [] });
const dePerfil = (p: PerfilAcessoOut): Form => ({
  nome: p.nome,
  descricao: p.descricao ?? "",
  cor: p.cor ?? COR_PADRAO,
  administrador: p.administrador,
  permissoes: [...p.permissoes].sort(),
});
const chave = (f: Form) => JSON.stringify({ ...f, nome: f.nome.trim(), descricao: f.descricao.trim(), permissoes: [...f.permissoes].sort() });
const perms = (r: Recurso) => r.acoes.map((a) => `${r.id}.${a}`);
const estadoDe = (lista: string[], tem: Set<string>): Estado => {
  const n = lista.filter((p) => tem.has(p)).length;
  return n === 0 ? false : n === lista.length ? true : "mixed";
};

/** Caixa de marcar com o estado "parcial" (grupo ou linha com parte das permissões). */
function Marca({ estado, onClick, disabled, rotulo, className }: { estado: Estado; onClick: () => void; disabled?: boolean; rotulo: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={estado}
      aria-label={rotulo}
      title={rotulo}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-all outline-none focus-visible:ring-3 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
        estado ? "border-brand bg-brand text-white shadow-sm shadow-brand/30 dark:text-navy" : "border-input bg-background hover:border-brand/60",
        className,
      )}
    >
      {estado === true && <Check className="size-3" strokeWidth={3} />}
      {estado === "mixed" && <Minus className="size-3" strokeWidth={3} />}
    </button>
  );
}

function Cartao({ icone: I, titulo, acao, children, className }: { icone: React.ComponentType<{ className?: string }>; titulo: React.ReactNode; acao?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("card-surface overflow-hidden", className)}>
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-info-ink">
          <I className="size-4" />
        </span>
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{titulo}</h3>
        {acao}
      </header>
      {children}
    </section>
  );
}

/** Pessoas com este perfil, com troca rápida de perfil e inclusão de quem está em outro. */
function UsuariosDoPerfil({ perfil }: { perfil: PerfilAcessoOut }) {
  const qc = useQueryClient();
  const { pode, usuario: eu } = useAuth();
  const editar = pode("cfg_profissionais.editar");
  const usuarios = useQuery({ queryKey: ["usuarios"], queryFn: () => api.get<UsuarioOut[]>("/config/usuarios") });
  const trocar = useMutation({
    mutationFn: ({ u, perfilId }: { u: UsuarioOut; perfilId: number }) => api.patch<UsuarioOut>(`/config/usuarios/${u.id}`, { perfil_acesso_id: perfilId }),
    onSuccess: (r) => {
      toast.success(`${r.nome} agora é ${r.perfil_acesso_nome}`);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["perfis"] });
    },
  });
  const ativos = (usuarios.data ?? []).filter((u) => u.ativo && u.acesso_sistema);
  const daqui = ativos.filter((u) => u.perfil_acesso_id === perfil.id);
  const outros = ativos.filter((u) => u.perfil_acesso_id !== perfil.id && u.id !== eu?.id);
  return (
    <Cartao
      icone={Users}
      titulo={
        <>
          Usuários com este perfil <span className="ml-1 font-normal text-muted-foreground tabular-nums">{usuarios.data ? daqui.length : ""}</span>
        </>
      }
    >
      {usuarios.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-10 rounded-lg" />
        </div>
      ) : (
        <>
          {daqui.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Ninguém usa este perfil ainda.</p>
          ) : (
            <ul className="max-h-96 divide-y overflow-y-auto">
              {daqui.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-8" textoClassName="text-[11px]" online={u.online} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {u.nome} {u.id === eu?.id && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.cargo_nome ?? u.email}</p>
                  </div>
                  {editar && u.id !== eu?.id && (
                    <PerfilAcessoSelect
                      compacto
                      value={u.perfil_acesso_id}
                      onChange={(perfilId) => perfilId !== u.perfil_acesso_id && trocar.mutate({ u, perfilId })}
                      disabled={trocar.isPending}
                      className="w-36"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {editar && outros.length > 0 && (
            <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-3">
              <UserPlus className="size-4 shrink-0 text-muted-foreground" />
              <NativeSelect
                aria-label="Trazer alguém para este perfil"
                value=""
                disabled={trocar.isPending}
                onChange={(e) => {
                  const u = outros.find((o) => String(o.id) === e.target.value);
                  if (u) trocar.mutate({ u, perfilId: perfil.id });
                }}
                className="h-8 flex-1 text-sm"
              >
                <option value="">Trazer alguém para este perfil…</option>
                {outros.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome} · hoje: {u.perfil_acesso_nome ?? "sem perfil"}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </>
      )}
    </Cartao>
  );
}

export default function PerfilEditorPage() {
  const { id } = useParams<{ id: string }>();
  const novo = id === "novo";
  const pid = novo ? null : Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const { pode, usuario: eu } = useAuth();
  const editar = pode("cfg_perfis.editar");
  const perfis = usePerfisAcesso();
  const catalogo = useCatalogo();
  const perfil = perfis.data?.find((p) => p.id === pid);

  const [f, setF] = useState<Form>(vazio);
  const [base, setBase] = useState<string>(() => chave(vazio()));
  const [busca, setBusca] = useState("");
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [excluir, setExcluir] = useState(false);

  // carrega o formulário uma vez por perfil (recarregar a lista não apaga o que está sendo editado)
  const [carregado, setCarregado] = useState<number | null>(null);
  if (perfil && carregado !== perfil.id) {
    setCarregado(perfil.id);
    setF(dePerfil(perfil));
    setBase(chave(dePerfil(perfil)));
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => ({ ...o, [k]: v }));
  const tem = useMemo(() => new Set(f.permissoes), [f.permissoes]);
  const todas = useMemo(() => todasDoCatalogo(catalogo.data), [catalogo.data]);
  const sujo = chave(f) !== base;
  const travado = !editar || f.administrador;
  const n = f.administrador ? todas.length : f.permissoes.length;

  const mudar = (fn: (s: Set<string>) => void) =>
    setF((o) => {
      const s = new Set(o.permissoes);
      fn(s);
      return { ...o, permissoes: [...s].sort() };
    });
  // marcar qualquer ação liga o "Ver"; desmarcar o "Ver" limpa as demais
  const alternar = (r: Recurso, acao: string) =>
    mudar((s) => {
      const p = `${r.id}.${acao}`;
      if (s.has(p)) {
        s.delete(p);
        if (acao === "ver") perms(r).forEach((x) => s.delete(x));
      } else {
        s.add(p);
        if (acao !== "ver" && r.acoes.includes("ver")) s.add(`${r.id}.ver`);
      }
    });
  const alternarLista = (lista: string[]) =>
    mudar((s) => {
      const todasMarcadas = lista.every((p) => s.has(p));
      lista.forEach((p) => (todasMarcadas ? s.delete(p) : s.add(p)));
    });

  const copiarDe = (p: PerfilAcessoOut) => {
    set("permissoes", p.administrador ? [...todas].sort() : [...p.permissoes].sort());
    toast.success(`Permissões copiadas de "${p.nome}"`, { description: "Ajuste o que precisar e salve." });
  };
  const aplicarModelo = (nome: string, lista: string[]) => {
    set("permissoes", [...new Set(lista)].sort());
    toast.success(`Modelo "${nome}" aplicado`);
  };
  const grupoConfig = catalogo.data?.grupos.find((g) => g.grupo === "Configurações");
  const daConfig = new Set(grupoConfig?.recursos.flatMap(perms) ?? []);

  const salvar = useMutation({
    mutationFn: () => {
      const body: PerfilAcessoIn = {
        nome: f.nome.trim(),
        descricao: f.descricao.trim() || null,
        cor: f.cor,
        administrador: f.administrador,
        permissoes: f.administrador ? [] : f.permissoes,
      };
      return pid ? api.put<PerfilAcessoOut>(`/config/perfis/${pid}`, body) : api.post<PerfilAcessoOut>("/config/perfis", body);
    },
    onSuccess: (r) => {
      toast.success(pid ? "Perfil salvo" : `Perfil "${r.nome}" criado`, {
        description: r.qtd_usuarios ? `Vale na hora para ${r.qtd_usuarios} profissional(is).` : undefined,
      });
      setF(dePerfil(r));
      setBase(chave(dePerfil(r)));
      qc.setQueryData<PerfilAcessoOut[]>(["perfis"], (l) => (l ? (pid ? l.map((p) => (p.id === r.id ? r : p)) : [...l, r]) : l));
      qc.invalidateQueries({ queryKey: ["perfis"] });
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      if (eu?.perfil_acesso_id === r.id) qc.invalidateQueries({ queryKey: ["me"] });
      if (!pid) router.replace(`/configuracoes/perfis/${r.id}`);
    },
  });
  const duplicar = useMutation({
    mutationFn: () => api.post<PerfilAcessoOut>(`/config/perfis/${pid}/duplicar`),
    onSuccess: (r) => {
      toast.success(`Perfil "${r.nome}" criado`);
      qc.invalidateQueries({ queryKey: ["perfis"] });
      router.push(`/configuracoes/perfis/${r.id}`);
    },
  });
  const remover = useMutation({
    mutationFn: () => api.del<{ mensagem: string }>(`/config/perfis/${pid}`),
    onSuccess: (r) => {
      toast.success(r?.mensagem ?? "Perfil excluído");
      qc.invalidateQueries({ queryKey: ["perfis"] });
      router.replace("/configuracoes/perfis");
    },
    onError: () => setExcluir(false),
  });

  const podeSalvar = editar && sujo && f.nome.trim().length >= 2 && !salvar.isPending;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && podeSalvar) {
        e.preventDefault();
        salvar.mutate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [podeSalvar, salvar]);

  const termo = busca.trim().toLowerCase();
  const grupos = useMemo(() => {
    if (!catalogo.data) return [];
    const ordem = Object.keys(catalogo.data.acoes);
    return catalogo.data.grupos
      .map((g) => {
        const recursos = g.recursos.filter(
          (r) =>
            !termo ||
            g.grupo.toLowerCase().includes(termo) ||
            r.nome.toLowerCase().includes(termo) ||
            r.acoes.some((a) => (catalogo.data!.acoes[a] ?? a).toLowerCase().includes(termo)),
        );
        const colunas = ordem.filter((a) => recursos.some((r) => r.acoes.includes(a)));
        return { grupo: g.grupo, recursos, colunas, todas: g.recursos.flatMap(perms) };
      })
      .filter((g) => g.recursos.length > 0);
  }, [catalogo.data, termo]);

  if (perfis.isPending || catalogo.isPending)
    return (
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-[600px] rounded-2xl" />
      </div>
    );
  if (!novo && !perfil)
    return (
      <EmptyState
        icone={ShieldCheck}
        titulo="Perfil não encontrado"
        descricao="Ele pode ter sido excluído."
        acao={
          <Button variant="outline" render={<Link href="/configuracoes/perfis" />}>
            <ArrowLeft /> Voltar aos perfis
          </Button>
        }
      />
    );
  if (novo && !editar)
    return (
      <EmptyState
        icone={Lock}
        titulo="Sem acesso"
        descricao="Peça ao administrador para liberar no seu perfil de acesso."
        acao={
          <Button variant="outline" render={<Link href="/configuracoes/perfis" />}>
            <ArrowLeft /> Voltar aos perfis
          </Button>
        }
      />
    );

  const acoes = catalogo.data!.acoes;
  const outrosPerfis = (perfis.data ?? []).filter((p) => p.id !== pid);

  return (
    <div className="space-y-4 pb-20">
      {/* topo */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href="/configuracoes/perfis" />} aria-label="Voltar aos perfis">
          <ArrowLeft />
        </Button>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-md transition-colors" style={{ background: f.cor, boxShadow: `0 6px 16px -8px ${f.cor}` }}>
          {f.administrador ? <ShieldCheck className="size-5" /> : <span className="text-sm font-semibold">{(f.nome.trim() || "Novo").slice(0, 2).toUpperCase()}</span>}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="truncate">{f.nome.trim() || (novo ? "Novo perfil" : perfil?.nome)}</span>
            {f.administrador && <span className="rounded-md bg-brand/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-info-ink uppercase">Acesso total</span>}
            {perfil?.sistema && (
              <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                <Lock className="size-3" /> padrão
              </span>
            )}
            {!editar && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Eye className="size-3" /> só consulta
              </span>
            )}
          </h2>
        </div>
        {editar && pid && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => duplicar.mutate()} disabled={duplicar.isPending}>
              {duplicar.isPending ? <Loader2 className="animate-spin" /> : <Copy />} Duplicar
            </Button>
            {!perfil?.sistema && (
              <Button variant="outline" size="sm" className="text-danger-ink hover:text-danger-ink" onClick={() => setExcluir(true)}>
                <Trash2 /> Excluir
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[340px_1fr]">
        {/* coluna esquerda */}
        <div className="space-y-4 lg:sticky lg:top-[calc(var(--tb)+var(--faixa)+1rem)]">
          <Cartao icone={Palette} titulo="Identificação">
            <fieldset disabled={!editar} className="space-y-4 p-4">
              <Field label="Nome" obrigatorio htmlFor="perfil-nome">
                <Input id="perfil-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} maxLength={80} autoFocus={novo} placeholder="ex.: Estagiário" />
              </Field>
              <Field label="Descrição" htmlFor="perfil-desc">
                <Textarea
                  id="perfil-desc"
                  value={f.descricao}
                  onChange={(e) => set("descricao", e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Para quem é este perfil e o que ele faz"
                />
              </Field>
              <div>
                <p className="mb-2 text-sm font-medium">Cor</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {CORES_PERFIL.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => set("cor", c)}
                      aria-label={`Cor ${c}`}
                      aria-pressed={f.cor.toLowerCase() === c.toLowerCase()}
                      className={cn(
                        "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110 disabled:pointer-events-none",
                        f.cor.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground/60",
                      )}
                      style={{ background: c }}
                    >
                      {f.cor.toLowerCase() === c.toLowerCase() && <Check className="size-3.5 text-white" strokeWidth={3} />}
                    </button>
                  ))}
                  <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed text-muted-foreground hover:border-brand/60" title="Outra cor">
                    <Palette className="size-3.5" />
                    <input type="color" value={f.cor} onChange={(e) => set("cor", e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Escolher outra cor" />
                  </label>
                </div>
              </div>
              <label
                htmlFor="perfil-admin"
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                  f.administrador ? "border-brand/50 bg-brand/6" : "bg-background/50",
                  (perfil?.sistema || !editar) && "cursor-not-allowed",
                )}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", f.administrador ? "brand-gradient text-white" : "bg-muted text-muted-foreground")}>
                  <ShieldCheck className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Acesso total (administrador)</span>
                  <span className="block text-xs text-muted-foreground">
                    {perfil?.sistema ? "O Administrador padrão sempre tem acesso total. Duplique para criar outro." : "Pode tudo, inclusive o que for criado no futuro."}
                  </span>
                </span>
                <Switch id="perfil-admin" checked={f.administrador} disabled={perfil?.sistema || !editar} onCheckedChange={(v) => set("administrador", v)} />
              </label>
            </fieldset>
          </Cartao>

          {perfil && pode("cfg_profissionais.ver") && <UsuariosDoPerfil perfil={perfil} />}
          {novo && <p className="px-1 text-xs text-muted-foreground">Depois de salvar, você poderá trazer pessoas para este perfil.</p>}
        </div>

        {/* matriz de permissões */}
        <Cartao
          icone={SquareCheckBig}
          titulo="Permissões"
          acao={
            <span className="text-sm tabular-nums">
              <strong className="font-semibold">{n}</strong> <span className="text-muted-foreground">de {todas.length} permissões</span>
            </span>
          }
        >
          <div className="h-1 bg-muted">
            <motion.div className="h-full brand-gradient" animate={{ width: `${todas.length ? (n / todas.length) * 100 : 0}%` }} transition={{ type: "spring", stiffness: 260, damping: 30 }} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar tela ou ação" className="sm:w-64" />
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
              {editar && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={f.administrador} />}>
                      <Wand2 /> Copiar de outro perfil <ChevronDown className="!size-3.5 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Perfis</DropdownMenuLabel>
                        {outrosPerfis.map((p) => (
                          <DropdownMenuItem key={p.id} onClick={() => copiarDe(p)}>
                            <PontoCor cor={p.cor} />
                            <span className="flex-1 truncate">{p.nome}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{p.administrador ? todas.length : p.permissoes.length}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Modelos</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => aplicarModelo("Só consulta", todas.filter((p) => p.endsWith(".ver") && !daConfig.has(p)))}>
                          <Eye /> Só consulta (sem configurações)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => aplicarModelo("Tudo menos configurações", todas.filter((p) => !daConfig.has(p)))}>
                          <SquareCheckBig /> Tudo, menos configurações
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="sm" disabled={f.administrador} onClick={() => set("permissoes", [...todas].sort())}>
                    <SquareCheckBig /> Marcar tudo
                  </Button>
                  <Button variant="ghost" size="sm" disabled={f.administrador || f.permissoes.length === 0} onClick={() => set("permissoes", [])}>
                    <SquareDashed /> Limpar
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="relative">
            <AnimatePresence>
              {f.administrador && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center px-4"
                >
                  <div className="glass flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm shadow-xl">
                    <ShieldCheck className="size-5 text-info-ink" />
                    <span>
                      <strong className="font-semibold">Acesso total.</strong> <span className="text-muted-foreground">Todas as permissões estão liberadas.</span>
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={cn("divide-y transition-opacity", f.administrador && "pointer-events-none opacity-40 select-none")} aria-disabled={f.administrador}>
              {grupos.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nada encontrado para &quot;{busca}&quot;.</p>}
              {grupos.map((g) => {
                const aberto = !!termo || !fechados.has(g.grupo);
                const est = f.administrador ? true : estadoDe(g.todas, tem);
                const marcadas = f.administrador ? g.todas.length : g.todas.filter((p) => tem.has(p)).length;
                return (
                  <div key={g.grupo}>
                    <div className="flex items-center gap-3 bg-muted/30 px-4 py-2.5">
                      <Marca estado={est} disabled={travado} onClick={() => alternarLista(g.todas)} rotulo={`Marcar tudo em ${g.grupo}`} />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() =>
                          setFechados((s) => {
                            const o = new Set(s);
                            if (o.has(g.grupo)) o.delete(g.grupo);
                            else o.add(g.grupo);
                            return o;
                          })
                        }
                        aria-expanded={aberto}
                      >
                        <span className="text-sm font-semibold">{g.grupo}</span>
                        <span className="rounded-full bg-background px-1.5 text-[11px] text-muted-foreground tabular-nums ring-1 ring-border">
                          {marcadas}/{g.todas.length}
                        </span>
                        <ChevronDown className={cn("ml-auto size-4 text-muted-foreground transition-transform", !aberto && "-rotate-90")} />
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {aberto && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-[11px] text-muted-foreground">
                                  <th className="w-10 px-4 py-2" />
                                  <th className="px-2 py-2 text-left font-medium">Tela / recurso</th>
                                  {g.colunas.map((a) => (
                                    <th key={a} className="w-24 px-2 py-2 text-center font-medium leading-tight">
                                      {acoes[a] ?? a}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/60">
                                {g.recursos.map((r) => {
                                  const lista = perms(r);
                                  const estLinha = f.administrador ? true : estadoDe(lista, tem);
                                  return (
                                    <tr key={r.id} className={cn("transition-colors hover:bg-accent/30", estLinha && "bg-brand/[0.03]")}>
                                      <td className="px-4 py-2.5">
                                        <Marca estado={estLinha} disabled={travado} onClick={() => alternarLista(lista)} rotulo={`Marcar tudo em ${r.nome}`} className="size-4 rounded-[4px] opacity-70" />
                                      </td>
                                      <td className="px-2 py-2.5">
                                        <span className={cn("font-medium", !estLinha && "text-muted-foreground")}>{r.nome}</span>
                                      </td>
                                      {g.colunas.map((a) => (
                                        <td key={a} className="px-2 py-2.5 text-center">
                                          {r.acoes.includes(a) ? (
                                            <span className="inline-flex">
                                              <Marca
                                                estado={f.administrador || tem.has(`${r.id}.${a}`)}
                                                disabled={travado}
                                                onClick={() => alternar(r, a)}
                                                rotulo={`${r.nome}: ${acoes[a] ?? a}`}
                                              />
                                            </span>
                                          ) : (
                                            <span className="text-muted-foreground/30">·</span>
                                          )}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            Marcar qualquer ação libera também o &quot;Ver&quot; daquela tela; desmarcar o &quot;Ver&quot; tira as demais. O servidor confere cada permissão.
          </p>
        </Cartao>
      </div>

      {/* barra de salvar fixa */}
      {editar && (
        <div className="sticky bottom-3 z-20 flex justify-end">
          <div className="glass flex items-center gap-3 rounded-2xl border p-2 pl-4 shadow-xl">
            <span className="text-sm text-muted-foreground">{sujo ? "Alterações não salvas" : novo ? "Preencha e salve" : "Tudo salvo"}</span>
            {sujo && !novo && perfil && (
              <Button
                variant="ghost"
                onClick={() => {
                  setF(dePerfil(perfil));
                  toast("Alterações descartadas");
                }}
              >
                <Undo2 /> Descartar
              </Button>
            )}
            <Button onClick={() => salvar.mutate()} disabled={!podeSalvar} title="Ctrl+S">
              {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} {novo ? "Criar perfil" : "Salvar perfil"}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={excluir}
        onOpenChange={setExcluir}
        titulo={`Excluir o perfil "${perfil?.nome ?? ""}"?`}
        descricao={
          perfil?.qtd_usuarios
            ? `${perfil.qtd_usuarios} profissional(is) usam este perfil. Troque o perfil deles antes de excluir.`
            : "As permissões deste perfil são apagadas. Essa ação não pode ser desfeita."
        }
        confirmar="Excluir perfil"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => remover.mutate()}
      />
    </div>
  );
}
