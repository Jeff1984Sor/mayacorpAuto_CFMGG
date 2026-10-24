"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Camera, Check, IdCard, KeyRound, Loader2, Mail, MapPin, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CidadeInput } from "@/components/mayacorp/cidade-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCep } from "@/hooks/use-cep";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CargoOut } from "@/lib/faturamento";
import type { Perfil, UsuarioMe, UsuarioOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PERFIS: Record<Perfil, { l: string; d: string }> = {
  admin: { l: "Administrador", d: "Tudo: configurações, certificado, usuários, emissão e cancelamento" },
  operador: { l: "Operador", d: "Importar, validar, emitir, faturar e cadastrar clientes" },
  visualizador: { l: "Visualizador", d: "Consultar painel, lotes, notas e faturas" },
};

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const LOGIN_RE = /^[a-z0-9._-]{3,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const dig = (v: string) => v.replace(/\D/g, "");
export const mascaraCpf = (v: string) =>
  dig(v)
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
export const mascaraTelefone = (v: string) => {
  const d = dig(v).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const mascaraCep = (v: string) => dig(v).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");

function cpfValido(v: string) {
  const d = dig(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const sugerirLogin = (email: string) =>
  (email.split("@")[0] ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "");

interface Form {
  nome: string;
  email: string;
  cpf: string;
  telefone: string;
  data_admissao: string;
  cargo_id: number | null;
  oab: string;
  cep: string;
  logradouro: string;
  numero_endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  ativo: boolean;
  acesso_sistema: boolean;
  login: string;
  perfil: Perfil;
  modoSenha: "convite" | "senha";
  senha: string;
}

const vazio = (): Form => ({
  nome: "",
  email: "",
  cpf: "",
  telefone: "",
  data_admissao: "",
  cargo_id: null,
  oab: "",
  cep: "",
  logradouro: "",
  numero_endereco: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  ativo: true,
  acesso_sistema: true,
  login: "",
  perfil: "operador",
  modoSenha: "convite",
  senha: "",
});

const deUsuario = (u: UsuarioOut): Form => ({
  nome: u.nome,
  email: u.email,
  cpf: u.cpf ? mascaraCpf(u.cpf) : "",
  telefone: u.telefone ? mascaraTelefone(u.telefone) : "",
  data_admissao: u.data_admissao ?? "",
  cargo_id: u.cargo_id,
  oab: u.oab ?? "",
  cep: u.cep ? mascaraCep(u.cep) : "",
  logradouro: u.logradouro ?? "",
  numero_endereco: u.numero_endereco ?? "",
  complemento: u.complemento ?? "",
  bairro: u.bairro ?? "",
  cidade: u.cidade ?? "",
  uf: u.uf ?? "",
  ativo: u.ativo,
  acesso_sistema: u.acesso_sistema,
  login: u.login ?? "",
  perfil: u.perfil,
  modoSenha: "convite",
  senha: "",
});

const n = (v: string) => (v.trim() ? v.trim() : null);

function Secao({ id, icone: I, titulo, descricao, children }: { id: string; icone: React.ComponentType<{ className?: string }>; titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-4 rounded-2xl border bg-card p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
          <I className="size-[18px]" />
        </span>
        <div>
          <h3 id={`${id}-t`} className="text-sm font-semibold">
            {titulo}
          </h3>
          <p className="text-xs text-muted-foreground">{descricao}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Foto: a própria pessoa troca a dela; o administrador troca a de qualquer profissional já cadastrado. */
function FotoEditor({ usuario, nome, eu }: { usuario: UsuarioOut | null; nome: string; eu: boolean }) {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const pode = eu || (isAdmin && !!usuario);
  const enviar = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      if (eu) qc.setQueryData(["me"], await api.post<UsuarioMe>("/auth/me/foto", fd));
      else await api.post(`/auth/usuarios/${usuario!.id}/foto`, fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      toast.success("Foto atualizada");
    },
  });
  const dz = useDropzone({
    multiple: false,
    disabled: !pode,
    accept: { "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "image/webp": [".webp"] },
    maxSize: 4 * 1024 * 1024,
    onDrop: (f) => f[0] && enviar.mutate(f[0]),
    onDropRejected: () => toast.error("Use PNG, JPG ou WEBP de até 4 MB."),
  });
  const avatar = (
    <UserAvatar nome={nome || "?"} fotoUrl={usuario?.foto_url} className="size-20 ring-4 ring-card shadow-lg" textoClassName="text-xl" />
  );
  if (!pode)
    return (
      <div className="relative" title={!usuario ? "Salve o cadastro para enviar a foto." : undefined}>
        {avatar}
      </div>
    );
  return (
    <div {...dz.getRootProps()} className="group relative cursor-pointer rounded-full" aria-label={eu ? "Trocar minha foto" : `Trocar a foto de ${nome}`}>
      <input {...dz.getInputProps()} aria-label="Arquivo da foto" />
      {avatar}
      <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
        {enviar.isPending ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
      </span>
    </div>
  );
}

function NovoCargoInline({ onCriado }: { onCriado: (c: CargoOut) => void }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const criar = useMutation({
    mutationFn: () => api.post<CargoOut>("/config/cargos", { nome: nome.trim(), ordem: 0, ativo: true }),
    onSuccess: (c) => {
      toast.success(`Cargo “${c.nome}” criado`);
      qc.invalidateQueries({ queryKey: ["cargos"] });
      onCriado(c);
      setNome("");
      setAberto(false);
    },
  });
  if (!aberto)
    return (
      <button type="button" onClick={() => setAberto(true)} className="inline-flex items-center gap-1 text-xs font-medium text-info-ink hover:underline">
        <Plus className="size-3" /> Novo cargo
      </button>
    );
  return (
    <div className="flex items-center gap-1.5">
      <Input
        aria-label="Nome do novo cargo"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="ex.: Advogado sênior"
        className="h-8"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (nome.trim().length >= 2) criar.mutate();
          }
          if (e.key === "Escape") setAberto(false);
        }}
      />
      <Button type="button" size="icon-sm" disabled={nome.trim().length < 2 || criar.isPending} onClick={() => criar.mutate()} aria-label="Criar cargo">
        {criar.isPending ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setAberto(false)} aria-label="Cancelar">
        <X />
      </Button>
    </div>
  );
}

export function FuncionarioDialog({
  open,
  onOpenChange,
  usuario,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  usuario: UsuarioOut | null;
}) {
  const qc = useQueryClient();
  const { usuario: eu } = useAuth();
  const cepApi = useCep();
  const [f, setF] = useState<Form>(vazio);
  const [erros, setErros] = useState<Partial<Record<keyof Form, string>>>({});
  const [enviarConvite, setEnviarConvite] = useState(true);
  const cargos = useQuery({ queryKey: ["cargos"], queryFn: () => api.get<CargoOut[]>("/config/cargos"), enabled: open });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(usuario ? deUsuario(usuario) : vazio());
    setErros({});
    setEnviarConvite(true);
  }, [open, usuario]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((o) => ({ ...o, [k]: v }));
    if (erros[k]) setErros((e) => ({ ...e, [k]: undefined }));
  };
  const souEu = !!usuario && usuario.id === eu?.id;
  const ganhaAcesso = !!usuario && !usuario.acesso_sistema && f.acesso_sistema;
  const cargo = cargos.data?.find((c) => c.id === f.cargo_id);

  const buscarCep = async (v: string) => {
    const r = await cepApi.buscar(v);
    if (r)
      setF((o) => ({
        ...o,
        logradouro: r.logradouro || o.logradouro,
        bairro: r.bairro || o.bairro,
        cidade: r.localidade || o.cidade,
        uf: r.uf || o.uf,
        complemento: o.complemento || r.complemento,
      }));
  };

  const validar = () => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (f.nome.trim().length < 2) e.nome = "Informe o nome completo.";
    if (!EMAIL_RE.test(f.email.trim())) e.email = "E-mail inválido.";
    if (f.cpf && !cpfValido(f.cpf)) e.cpf = "CPF inválido.";
    if (f.cep && dig(f.cep).length !== 8) e.cep = "CEP com 8 dígitos.";
    if (f.acesso_sistema && f.login && !LOGIN_RE.test(f.login)) e.login = "3 a 60 caracteres: letras minúsculas, números, . _ -";
    if (f.acesso_sistema && !usuario && f.modoSenha === "senha" && f.senha.length < 8) e.senha = "Mínimo de 8 caracteres.";
    setErros(e);
    if (Object.keys(e).length) {
      const primeiro = Object.keys(e)[0];
      document.getElementById(`func-${primeiro}`)?.focus();
    }
    return Object.keys(e).length === 0;
  };

  const salvar = useMutation({
    mutationFn: async () => {
      const dados = {
        nome: f.nome.trim(),
        email: f.email.trim(),
        cpf: dig(f.cpf) || null,
        telefone: n(f.telefone),
        data_admissao: f.data_admissao || null,
        cargo_id: f.cargo_id,
        oab: n(f.oab),
        cep: dig(f.cep) || null,
        logradouro: n(f.logradouro),
        numero_endereco: n(f.numero_endereco),
        complemento: n(f.complemento),
        bairro: n(f.bairro),
        cidade: n(f.cidade),
        uf: n(f.uf),
        acesso_sistema: f.acesso_sistema,
      };
      if (usuario) {
        const body: Record<string, unknown> = { ...dados };
        if (f.acesso_sistema) {
          body.login = n(f.login);
          if (!souEu) body.perfil = f.perfil;
        }
        if (!souEu) body.ativo = f.ativo;
        const r = await api.patch<UsuarioOut>(`/config/usuarios/${usuario.id}`, body);
        if (ganhaAcesso && enviarConvite) await api.post(`/config/usuarios/${usuario.id}/redefinir-senha`);
        return r;
      }
      return api.post<UsuarioOut>("/config/usuarios", {
        ...dados,
        login: f.acesso_sistema ? n(f.login) : null,
        perfil: f.perfil,
        senha: f.acesso_sistema && f.modoSenha === "senha" ? f.senha : null,
      });
    },
    onSuccess: (r) => {
      if (usuario) toast.success(`${r.nome} atualizado(a)`, { description: ganhaAcesso && enviarConvite ? `Convite enviado para ${r.email}` : undefined });
      else if (!r.acesso_sistema) toast.success(`${r.nome} cadastrado(a)`, { description: "Sem acesso ao sistema: aparece só no timesheet." });
      else if (f.modoSenha === "senha") toast.success(`${r.nome} já pode entrar`);
      else toast.success(`Convite enviado para ${r.email}`);
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["cargos"] });
      qc.invalidateQueries({ queryKey: ["fat", "profissionais"] });
      onOpenChange(false);
    },
  });

  const rotuloSalvar = usuario
    ? "Salvar alterações"
    : !f.acesso_sistema
      ? "Cadastrar profissional"
      : f.modoSenha === "senha"
        ? "Criar com senha"
        : "Cadastrar e enviar convite";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (validar()) salvar.mutate();
          }}
        >
          {/* capa */}
          <div className="relative shrink-0">
            <div className="brand-gradient h-20" />
            <div className="flex items-end gap-4 px-5 pb-4 sm:px-6">
              <div className="-mt-10">
                <FotoEditor usuario={usuario} nome={f.nome} eu={souEu} />
              </div>
              <div className="min-w-0 flex-1 pb-0.5">
                <DialogTitle className="truncate text-lg">{f.nome.trim() || (usuario ? usuario.nome : "Novo profissional")}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{cargo?.nome ?? "Sem cargo"}</span>
                  {f.oab && <span className="font-mono text-xs">OAB {f.oab}</span>}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium",
                      f.acesso_sistema ? "bg-success/12 text-success-ink" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {f.acesso_sistema ? PERFIS[f.perfil].l : "Sem acesso"}
                  </span>
                </DialogDescription>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t bg-muted/30 p-4 sm:p-5">
            <Secao id="func-sec-pessoais" icone={UserRound} titulo="Dados pessoais" descricao="Quem é a pessoa e como falar com ela.">
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Nome completo" obrigatorio htmlFor="func-nome" erro={erros.nome} className="sm:col-span-6">
                  <Input id="func-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus={!usuario} autoComplete="off" />
                </Field>
                <Field label="E-mail" obrigatorio htmlFor="func-email" erro={erros.email} className="sm:col-span-3">
                  <Input
                    id="func-email"
                    type="email"
                    value={f.email}
                    onChange={(e) => set("email", e.target.value)}
                    onBlur={() => !f.login && f.acesso_sistema && !usuario && set("login", sugerirLogin(f.email))}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Telefone" htmlFor="func-telefone" className="sm:col-span-3">
                  <Input id="func-telefone" inputMode="tel" value={f.telefone} onChange={(e) => set("telefone", mascaraTelefone(e.target.value))} placeholder="(11) 90000-0000" className="num" />
                </Field>
                <Field label="CPF" htmlFor="func-cpf" erro={erros.cpf} className="sm:col-span-3">
                  <Input id="func-cpf" inputMode="numeric" value={f.cpf} onChange={(e) => set("cpf", mascaraCpf(e.target.value))} placeholder="000.000.000-00" className="num" />
                </Field>
                <Field label="Data de admissão" htmlFor="func-data_admissao" className="sm:col-span-3">
                  <Input id="func-data_admissao" type="date" value={f.data_admissao} onChange={(e) => set("data_admissao", e.target.value)} />
                </Field>
              </div>
            </Secao>

            <Secao id="func-sec-cargo" icone={BriefcaseBusiness} titulo="Cargo e OAB" descricao="O cargo define o valor/hora nas tabelas de preço.">
              <div className="grid gap-4 sm:grid-cols-6">
                <Field
                  label="Cargo"
                  htmlFor="func-cargo_id"
                  className="sm:col-span-4"
                  dica={<NovoCargoInline onCriado={(c) => set("cargo_id", c.id)} />}
                >
                  <NativeSelect id="func-cargo_id" value={f.cargo_id ?? ""} onChange={(e) => set("cargo_id", e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Sem cargo</option>
                    {cargos.data
                      ?.filter((c) => c.ativo || c.id === f.cargo_id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                          {!c.ativo ? " (inativo)" : ""}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <Field label="OAB" htmlFor="func-oab" className="sm:col-span-2" dica="ex.: SP 123.456">
                  <Input id="func-oab" value={f.oab} onChange={(e) => set("oab", e.target.value.toUpperCase())} maxLength={20} className="num" />
                </Field>
              </div>
              {!f.cargo_id && (
                <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-ink">
                  Sem cargo, as horas lançadas por esta pessoa não têm valor/hora nas regras por hora.
                </p>
              )}
            </Secao>

            <Secao id="func-sec-endereco" icone={MapPin} titulo="Endereço" descricao="Digite o CEP para preencher o resto.">
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="CEP" htmlFor="func-cep" erro={erros.cep} className="sm:col-span-2">
                  <div className="relative">
                    <Input
                      id="func-cep"
                      inputMode="numeric"
                      value={f.cep}
                      onChange={(e) => {
                        const v = mascaraCep(e.target.value);
                        set("cep", v);
                        if (dig(v).length === 8 && dig(v) !== dig(f.cep)) buscarCep(v);
                      }}
                      placeholder="00000-000"
                      className="num pr-8"
                    />
                    {cepApi.carregando && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
                  </div>
                </Field>
                <Field label="Logradouro" htmlFor="func-logradouro" className="sm:col-span-4">
                  <Input id="func-logradouro" value={f.logradouro} onChange={(e) => set("logradouro", e.target.value)} maxLength={150} />
                </Field>
                <Field label="Número" htmlFor="func-numero_endereco" className="sm:col-span-2">
                  <Input id="func-numero_endereco" value={f.numero_endereco} onChange={(e) => set("numero_endereco", e.target.value)} maxLength={10} />
                </Field>
                <Field label="Complemento" htmlFor="func-complemento" className="sm:col-span-4">
                  <Input id="func-complemento" value={f.complemento} onChange={(e) => set("complemento", e.target.value)} maxLength={60} />
                </Field>
                <Field label="Bairro" htmlFor="func-bairro" className="sm:col-span-2">
                  <Input id="func-bairro" value={f.bairro} onChange={(e) => set("bairro", e.target.value)} maxLength={80} />
                </Field>
                <Field label="Cidade" htmlFor="func-cidade" className="sm:col-span-3">
                  <CidadeInput uf={f.uf} id="func-cidade" value={f.cidade} onChange={(e) => set("cidade", e.target.value)} maxLength={80} />
                </Field>
                <Field label="UF" htmlFor="func-uf" className="sm:col-span-1">
                  <NativeSelect id="func-uf" value={f.uf} onChange={(e) => set("uf", e.target.value)}>
                    <option value="">—</option>
                    {UFS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </Secao>

            <Secao id="func-sec-acesso" icone={ShieldCheck} titulo="Acesso ao sistema" descricao="Quem não acessa continua aparecendo no timesheet.">
              <label
                htmlFor="func-acesso"
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                  f.acesso_sistema ? "border-brand/40 bg-brand/5" : "bg-muted/40",
                  souEu && "cursor-not-allowed opacity-70",
                )}
              >
                <span className={cn("grid size-9 place-items-center rounded-lg", f.acesso_sistema ? "brand-gradient text-white" : "bg-muted text-muted-foreground")}>
                  <KeyRound className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Acessa o sistema</span>
                  <span className="block text-xs text-muted-foreground">
                    {f.acesso_sistema ? "Entra com login e senha, conforme o perfil." : "Sem login. Só lança horas por meio de outra pessoa."}
                  </span>
                </span>
                <Switch id="func-acesso" checked={f.acesso_sistema} disabled={souEu} onCheckedChange={(v) => set("acesso_sistema", v)} />
              </label>

              <AnimatePresence initial={false}>
                {f.acesso_sistema && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="grid gap-4 pt-4 sm:grid-cols-2">
                      <Field label="Usuário (login)" htmlFor="func-login" erro={erros.login} dica="Opcional: permite entrar sem digitar o e-mail." className="sm:col-span-2 sm:max-w-sm">
                        <Input
                          id="func-login"
                          value={f.login}
                          onChange={(e) => set("login", e.target.value.toLowerCase())}
                          className="font-mono"
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="ex.: cristina"
                        />
                      </Field>
                      <fieldset className="sm:col-span-2" disabled={souEu}>
                        <legend className="mb-2 text-sm font-medium">Perfil{souEu && <span className="ml-2 text-xs font-normal text-muted-foreground">(você não altera o seu)</span>}</legend>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {(Object.keys(PERFIS) as Perfil[]).map((k) => (
                            <label
                              key={k}
                              className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background p-3 transition-colors has-checked:border-brand has-checked:bg-brand/6 has-disabled:cursor-not-allowed"
                            >
                              <input type="radio" name="func-perfil" value={k} checked={f.perfil === k} onChange={() => set("perfil", k)} className="mt-1 accent-[var(--brand)]" />
                              <span>
                                <span className="block text-sm font-medium">{PERFIS[k].l}</span>
                                <span className="block text-xs text-muted-foreground">{PERFIS[k].d}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>

                      {!usuario && (
                        <fieldset className="sm:col-span-2">
                          <legend className="mb-2 text-sm font-medium">Primeiro acesso</legend>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {(
                              [
                                ["convite", Mail, "Enviar convite por e-mail", "A pessoa define a própria senha pelo link."],
                                ["senha", KeyRound, "Definir a senha agora", "Combine a senha por um canal seguro."],
                              ] as const
                            ).map(([k, I, t, d]) => (
                              <label
                                key={k}
                                className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background p-3 transition-colors has-checked:border-brand has-checked:bg-brand/6"
                              >
                                <input type="radio" name="func-modo" checked={f.modoSenha === k} onChange={() => set("modoSenha", k)} className="sr-only" />
                                <I className="mt-0.5 size-4 text-info-ink" />
                                <span>
                                  <span className="block text-sm font-medium">{t}</span>
                                  <span className="block text-xs text-muted-foreground">{d}</span>
                                </span>
                              </label>
                            ))}
                          </div>
                          {f.modoSenha === "senha" && (
                            <Field label="Senha inicial" htmlFor="func-senha" erro={erros.senha} className="mt-3 sm:max-w-sm">
                              <SenhaInput id="func-senha" value={f.senha} onChange={(v) => set("senha", v)} autoComplete="new-password" forca />
                            </Field>
                          )}
                        </fieldset>
                      )}
                      {ganhaAcesso && (
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <Switch checked={enviarConvite} onCheckedChange={setEnviarConvite} aria-label="Enviar convite ao salvar" />
                          Enviar convite por e-mail ao salvar
                        </label>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Secao>
          </div>

          <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-card px-5 py-3">
            {usuario && !souEu && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Profissional ativo" /> Ativo
              </label>
            )}
            {usuario && (
              <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
                <IdCard className="size-3.5" /> ID {usuario.id}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={salvar.isPending}>
                {salvar.isPending && <Loader2 className="animate-spin" />} {rotuloSalvar}
              </Button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
