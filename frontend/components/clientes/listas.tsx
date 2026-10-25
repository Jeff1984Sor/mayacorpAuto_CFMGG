"use client";

import {
  Building2,
  Check,
  Copy,
  Hash,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  Receipt,
  Smartphone,
  Star,
  Trash2,
  Truck,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { CidadeInput } from "@/components/mayacorp/cidade-input";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCep } from "@/hooks/use-cep";
import type { ContatoCliente, EnderecoCliente, TelefoneCliente, TipoEndereco, TipoTelefone } from "@/lib/types";
import { cn } from "@/lib/utils";
import { soDigitos } from "@/lib/validacao";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const mascaraFone = (v: string | null | undefined) => {
  const d = soDigitos(v ?? "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const mascaraCep = (v: string) => soDigitos(v).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
export const linkWhatsApp = (v: string | null | undefined) => `https://wa.me/55${soDigitos(v ?? "")}`;

export const TIPO_ENDERECO: Record<TipoEndereco, { l: string; icone: LucideIcon; cls: string }> = {
  cobranca: { l: "Cobrança", icone: Receipt, cls: "bg-warning/12 text-warning-ink ring-warning/30" },
  correspondencia: { l: "Correspondência", icone: Mail, cls: "bg-brand/12 text-info-ink ring-brand/30" },
  entrega: { l: "Entrega", icone: Truck, cls: "bg-success/12 text-success-ink ring-success/30" },
  filial: { l: "Filial", icone: Building2, cls: "bg-navy/10 text-navy ring-navy/25 dark:text-brand" },
  outro: { l: "Outro", icone: MapPin, cls: "bg-muted text-muted-foreground ring-border" },
};
export const TIPO_TELEFONE: Record<TipoTelefone, { l: string; icone: LucideIcon }> = {
  comercial: { l: "Comercial", icone: Building2 },
  celular: { l: "Celular", icone: Smartphone },
  whatsapp: { l: "WhatsApp", icone: MessageCircle },
  fixo: { l: "Fixo", icone: Phone },
  fax: { l: "Fax", icone: Printer },
  outro: { l: "Outro", icone: Hash },
};

// ---------------------------------------------------------------- estado do formulário
// Tudo em texto (vazio = ""), com uma chave local para o React; vira o formato da API em paraApi.
type ComChave<T> = { [K in keyof T]-?: T[K] extends boolean ? boolean : T[K] extends TipoEndereco | TipoTelefone ? T[K] : string } & { _k: string };
export type EnderecoForm = ComChave<EnderecoCliente>;
export type ContatoForm = ComChave<ContatoCliente>;
export type TelefoneForm = ComChave<TelefoneCliente>;
export interface ListasCliente {
  enderecos: EnderecoForm[];
  contatos: ContatoForm[];
  telefones: TelefoneForm[];
}

let seq = 0;
const chave = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;
const txt = (v: unknown) => (v == null ? "" : String(v));

export const enderecoVazio = (tipo: TipoEndereco = "cobranca"): EnderecoForm => ({
  _k: chave(),
  tipo,
  descricao: "",
  cep: "",
  tipo_logradouro: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
});
const contatoVazio = (principal: boolean): ContatoForm => ({
  _k: chave(),
  nome: "",
  cargo: "",
  email: "",
  telefone: "",
  celular: "",
  whatsapp: false,
  recebe_notas: false,
  principal,
  observacao: "",
});
export const telefoneVazio = (numero = "", tipo: TipoTelefone = "comercial"): TelefoneForm => ({ _k: chave(), numero: mascaraFone(numero), tipo, ramal: "", descricao: "" });

/** Do cliente salvo para o formulário. Cliente antigo (só `telefone`) ganha esse número como 1º da lista. */
export function deCliente(c: { enderecos?: EnderecoCliente[]; contatos?: ContatoCliente[]; telefones?: TelefoneCliente[]; telefone?: string | null } | null): ListasCliente {
  const tels = c?.telefones ?? [];
  return {
    enderecos: (c?.enderecos ?? []).map((e) => ({
      ...enderecoVazio(e.tipo),
      ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, txt(v)])),
      tipo: e.tipo ?? "outro",
      cep: mascaraCep(e.cep ?? ""),
    })),
    contatos: (c?.contatos ?? []).map((p) => ({
      ...contatoVazio(false),
      ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "boolean" ? v : txt(v)])),
      telefone: mascaraFone(p.telefone),
      celular: mascaraFone(p.celular),
      whatsapp: !!p.whatsapp,
      recebe_notas: !!p.recebe_notas,
      principal: !!p.principal,
    })),
    telefones: tels.length
      ? tels.map((t) => ({ ...telefoneVazio(t.numero, t.tipo ?? "comercial"), ramal: txt(t.ramal), descricao: txt(t.descricao) }))
      : c?.telefone
        ? [telefoneVazio(c.telefone)]
        : [],
  };
}

const nulo = (v: string) => (v.trim() ? v.trim() : null);
const enderecoVazioDeFato = (e: EnderecoForm) =>
  !(e.descricao + e.cep + e.logradouro + e.numero + e.complemento + e.bairro + e.cidade + e.uf).trim();

/** Para a API. O PUT substitui as listas: sempre mandar as três. Linhas totalmente vazias somem. */
export function paraApi(l: ListasCliente) {
  const telefones = l.telefones
    .filter((t) => soDigitos(t.numero))
    .map((t) => ({ numero: soDigitos(t.numero), tipo: t.tipo, ramal: nulo(t.ramal), descricao: nulo(t.descricao) }));
  return {
    enderecos: l.enderecos
      .filter((e) => !enderecoVazioDeFato(e))
      .map((e) => ({
        tipo: e.tipo,
        descricao: nulo(e.descricao),
        cep: soDigitos(e.cep) || null,
        tipo_logradouro: nulo(e.tipo_logradouro),
        logradouro: nulo(e.logradouro),
        numero: nulo(e.numero),
        complemento: nulo(e.complemento),
        bairro: nulo(e.bairro),
        cidade: nulo(e.cidade),
        uf: nulo(e.uf),
      })),
    contatos: l.contatos
      .filter((c) => c.nome.trim() || c.email.trim() || soDigitos(c.telefone + c.celular))
      .map((c) => ({
        nome: c.nome.trim(),
        cargo: nulo(c.cargo),
        email: nulo(c.email),
        telefone: soDigitos(c.telefone) || null,
        celular: soDigitos(c.celular) || null,
        whatsapp: c.whatsapp,
        recebe_notas: c.recebe_notas,
        principal: c.principal,
        observacao: nulo(c.observacao),
      })),
    telefones,
    telefone: telefones[0]?.numero ?? null,
  };
}

/** Primeiro problema das listas: a aba onde está e a mensagem. */
export function erroListas(l: ListasCliente): { aba: "contatos" | "telefones"; msg: string } | null {
  for (const c of l.contatos) {
    const vazio = !(c.nome.trim() || c.email.trim() || soDigitos(c.telefone + c.celular));
    if (vazio) continue;
    if (c.nome.trim().length < 2) return { aba: "contatos", msg: "Informe o nome de cada pessoa de contato." };
    if (c.email.trim() && !EMAIL_RE.test(c.email.trim())) return { aba: "contatos", msg: `E-mail inválido em ${c.nome}.` };
  }
  for (const t of l.telefones) {
    const d = soDigitos(t.numero);
    if (d && d.length < 8) return { aba: "telefones", msg: `Telefone incompleto: ${t.numero}.` };
  }
  return null;
}

export const contarListas = (l: ListasCliente) => {
  const p = paraApi(l);
  return { enderecos: p.enderecos.length, contatos: p.contatos.length, telefones: p.telefones.length };
};

// ---------------------------------------------------------------- peças comuns
function Vazio({ icone: I, titulo, texto, children }: { icone: LucideIcon; titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed bg-muted/20 px-6 py-10 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/25">
        <I className="size-5" />
      </span>
      <p className="font-medium">{titulo}</p>
      <p className="mt-0.5 max-w-sm text-sm text-muted-foreground">{texto}</p>
      {children && <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

const animacao = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.97 }, transition: { duration: 0.16 } };

// ---------------------------------------------------------------- endereços
function EnderecoCard({ e, onChange, onRemover }: { e: EnderecoForm; onChange: (e: EnderecoForm) => void; onRemover: () => void }) {
  const cep = useCep();
  const t = TIPO_ENDERECO[e.tipo];
  const set = <K extends keyof EnderecoForm>(k: K, v: EnderecoForm[K]) => onChange({ ...e, [k]: v });
  const buscarCep = async () => {
    const r = await cep.buscar(e.cep);
    if (r) onChange({ ...e, logradouro: r.logradouro || e.logradouro, bairro: r.bairro || e.bairro, cidade: r.localidade || e.cidade, uf: r.uf || e.uf });
  };
  return (
    <motion.div layout {...animacao} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full pr-1 pl-2.5 text-xs font-semibold ring-1 ring-inset", t.cls)}>
          <t.icone className="size-3.5" />
          <select
            aria-label="Tipo do endereço"
            value={e.tipo}
            onChange={(ev) => set("tipo", ev.target.value as TipoEndereco)}
            className="cursor-pointer bg-transparent pr-1 outline-none disabled:cursor-default"
          >
            {(Object.keys(TIPO_ENDERECO) as TipoEndereco[]).map((k) => (
              <option key={k} value={k} className="text-foreground">
                {TIPO_ENDERECO[k].l}
              </option>
            ))}
          </select>
        </span>
        <Input
          aria-label="Descrição do endereço"
          value={e.descricao}
          onChange={(ev) => set("descricao", ev.target.value)}
          maxLength={80}
          placeholder="Descrição (ex.: Filial Campinas)"
          className="h-7 min-w-40 flex-1 border-transparent bg-transparent px-2 shadow-none focus-visible:border-input focus-visible:bg-background"
        />
        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-danger-ink" onClick={onRemover} aria-label="Remover endereço">
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-6">
        <Field label="CEP" className="sm:col-span-2">
          <div className="relative">
            <Input value={e.cep} onChange={(ev) => set("cep", mascaraCep(ev.target.value))} onBlur={buscarCep} className="num pr-8" placeholder="00000-000" />
            {cep.carregando ? (
              <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : (
              <MapPin className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            )}
          </div>
        </Field>
        <Field label="Logradouro" className="sm:col-span-3">
          <Input value={e.logradouro} onChange={(ev) => set("logradouro", ev.target.value)} maxLength={150} />
        </Field>
        <Field label="Número" className="sm:col-span-1">
          <Input value={e.numero} onChange={(ev) => set("numero", ev.target.value)} maxLength={10} />
        </Field>
        <Field label="Complemento" className="sm:col-span-2">
          <Input value={e.complemento} onChange={(ev) => set("complemento", ev.target.value)} maxLength={60} />
        </Field>
        <Field label="Bairro" className="sm:col-span-1">
          <Input value={e.bairro} onChange={(ev) => set("bairro", ev.target.value)} maxLength={80} />
        </Field>
        <Field label="UF" className="sm:col-span-1">
          <NativeSelect value={e.uf} onChange={(ev) => set("uf", ev.target.value)}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Cidade" className="sm:col-span-2">
          <CidadeInput uf={e.uf} value={e.cidade} onChange={(ev) => set("cidade", ev.target.value)} maxLength={80} placeholder={e.uf ? "Cidade" : undefined} />
        </Field>
      </div>
    </motion.div>
  );
}

export function EnderecosEditor({
  lista,
  onChange,
  principal,
  podeEditar,
}: {
  lista: EnderecoForm[];
  onChange: (l: EnderecoForm[]) => void;
  /** endereço principal do formulário, para "Copiar do principal" */
  principal: () => Partial<EnderecoForm>;
  podeEditar: boolean;
}) {
  const adicionar = (base?: Partial<EnderecoForm>) => onChange([...lista, { ...enderecoVazio(lista.length ? "correspondencia" : "cobranca"), ...base }]);
  const copiar = () => {
    const p = principal();
    if (!(p.logradouro || p.cidade || p.cep)) return;
    adicionar({ ...p, descricao: "Cópia do principal" });
  };
  const acoes = podeEditar && (
    <>
      <Button type="button" size="sm" onClick={() => adicionar()}>
        <Plus /> Adicionar endereço
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={copiar} title="Cria um endereço com os dados do principal (aba Dados)">
        <Copy /> Copiar do principal
      </Button>
    </>
  );
  return (
    <fieldset disabled={!podeEditar} className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        Além do <strong className="font-medium text-foreground">endereço principal</strong> (aba Dados, vai na nota fiscal): cobrança, correspondência, entrega e filiais.
      </p>
      {lista.length === 0 ? (
        <Vazio icone={MapPin} titulo="Nenhum endereço adicional" texto="Cadastre onde enviar boletos, correspondências ou o endereço de uma filial.">
          {acoes}
        </Vazio>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {lista.map((e, i) => (
              <EnderecoCard
                key={e._k}
                e={e}
                onChange={(n) => onChange(lista.map((x, j) => (j === i ? n : x)))}
                onRemover={() => onChange(lista.filter((_, j) => j !== i))}
              />
            ))}
          </AnimatePresence>
          {podeEditar && <div className="flex flex-wrap gap-2">{acoes}</div>}
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- contatos
function ContatoCard({
  c,
  editando,
  podeEditar,
  onChange,
  onEditar,
  onConcluir,
  onRemover,
  onPrincipal,
}: {
  c: ContatoForm;
  editando: boolean;
  podeEditar: boolean;
  onChange: (c: ContatoForm) => void;
  onEditar: () => void;
  onConcluir: () => void;
  onRemover: () => void;
  onPrincipal: () => void;
}) {
  const set = <K extends keyof ContatoForm>(k: K, v: ContatoForm[K]) => onChange({ ...c, [k]: v });
  const emailRuim = !!c.email.trim() && !EMAIL_RE.test(c.email.trim());
  const nomeRuim = c.nome.trim().length < 2;
  return (
    <motion.div
      layout
      {...animacao}
      className={cn("flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors", c.principal && "border-brand/50 ring-1 ring-brand/20", editando && "sm:col-span-2")}
    >
      <div className="flex items-start gap-3 p-3.5">
        <UserAvatar nome={c.nome.trim() || "?"} className="size-10" textoClassName="text-xs" />
        <div className="min-w-0 flex-1">
          {editando ? (
            <div className="grid gap-3 sm:grid-cols-6">
              <Field label="Nome" obrigatorio className="sm:col-span-3" erro={nomeRuim && c.nome ? "Mínimo de 2 letras." : undefined}>
                <Input value={c.nome} onChange={(e) => set("nome", e.target.value)} maxLength={150} autoFocus={!c.nome} placeholder="ex.: Maria Souza" />
              </Field>
              <Field label="Cargo / área" className="sm:col-span-3">
                <Input value={c.cargo} onChange={(e) => set("cargo", e.target.value)} maxLength={100} placeholder="ex.: Financeiro, Síndica" />
              </Field>
              <Field label="E-mail" className="sm:col-span-6" erro={emailRuim ? "E-mail inválido." : undefined}>
                <Input type="email" value={c.email} onChange={(e) => set("email", e.target.value)} placeholder="nome@empresa.com.br" />
              </Field>
              <Field label="Telefone" className="sm:col-span-2">
                <Input value={c.telefone} onChange={(e) => set("telefone", mascaraFone(e.target.value))} className="num" inputMode="tel" placeholder="(11) 3333-4444" />
              </Field>
              <Field label="Celular" className="sm:col-span-2">
                <Input value={c.celular} onChange={(e) => set("celular", mascaraFone(e.target.value))} className="num" inputMode="tel" placeholder="(11) 99999-0000" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
                <Switch checked={c.whatsapp} onCheckedChange={(v) => set("whatsapp", v)} aria-label="O celular tem WhatsApp" />
                <MessageCircle className="size-4 text-success" /> WhatsApp
              </label>
              <Field label="Observação" className="sm:col-span-6">
                <Input value={c.observacao} onChange={(e) => set("observacao", e.target.value)} maxLength={300} placeholder="ex.: atende só de manhã" />
              </Field>
            </div>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-1.5 font-medium">
                <span className="truncate">{c.nome || "Sem nome"}</span>
                {c.principal && (
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-brand/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-info-ink uppercase">
                    <Star className="size-2.5 fill-current" /> Principal
                  </span>
                )}
              </p>
              {c.cargo && <p className="truncate text-xs text-muted-foreground">{c.cargo}</p>}
              <div className="mt-2 space-y-1 text-sm">
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1.5 truncate text-info-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Mail className="size-3.5 shrink-0" /> <span className="truncate">{c.email}</span>
                  </a>
                )}
                {c.telefone && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Phone className="size-3.5" /> <span className="num">{c.telefone}</span>
                  </p>
                )}
                {c.celular && (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Smartphone className="size-3.5" /> <span className="num">{c.celular}</span>
                    {c.whatsapp && (
                      <a
                        href={linkWhatsApp(c.celular)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1 inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success-ink hover:bg-success/20"
                        title="Abrir conversa no WhatsApp"
                      >
                        <MessageCircle className="size-3" /> WhatsApp
                      </a>
                    )}
                  </p>
                )}
                {c.observacao && <p className="text-xs text-muted-foreground italic">{c.observacao}</p>}
                {!c.email && !c.telefone && !c.celular && <p className="text-xs text-muted-foreground">Sem e-mail nem telefone.</p>}
              </div>
            </>
          )}
        </div>
        {podeEditar && !editando && (
          <div className="flex shrink-0 gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" onClick={onEditar} aria-label={`Editar ${c.nome}`}>
              <Pencil />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-danger-ink" onClick={onRemover} aria-label={`Remover ${c.nome}`}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-muted/25 px-3.5 py-2 text-xs">
        <button
          type="button"
          role="radio"
          aria-checked={c.principal}
          onClick={onPrincipal}
          className={cn("inline-flex items-center gap-1.5 rounded-full transition-colors disabled:cursor-default", c.principal ? "font-medium text-info-ink" : "text-muted-foreground hover:text-foreground")}
        >
          <Star className={cn("size-3.5", c.principal && "fill-current")} /> {c.principal ? "Contato principal" : "Tornar principal"}
        </button>
        <label className="inline-flex items-center gap-2">
          <Switch checked={c.recebe_notas} onCheckedChange={(v) => set("recebe_notas", v)} aria-label={`${c.nome || "Contato"} recebe as notas por e-mail`} className="scale-90" />
          <span className={c.recebe_notas ? "text-foreground" : "text-muted-foreground"}>Recebe as notas por e-mail</span>
        </label>
        {c.recebe_notas && !c.email.trim() && <span className="text-warning-ink">Falta o e-mail</span>}
        {editando && (
          <div className="ml-auto flex gap-1.5">
            <Button type="button" size="xs" variant="ghost" className="text-muted-foreground hover:text-danger-ink" onClick={onRemover}>
              <Trash2 /> Remover
            </Button>
            <Button type="button" size="xs" onClick={onConcluir} disabled={nomeRuim || emailRuim}>
              <Check /> Concluir
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ContatosEditor({ lista, onChange, podeEditar }: { lista: ContatoForm[]; onChange: (l: ContatoForm[]) => void; podeEditar: boolean }) {
  // contatos sem nome (recém-criados) já abrem em edição
  const [editando, setEditando] = useState<Set<string>>(() => new Set(lista.filter((c) => !c.nome).map((c) => c._k)));
  const alternar = (k: string, on: boolean) =>
    setEditando((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  const adicionar = () => {
    const novo = contatoVazio(lista.length === 0);
    onChange([...lista, novo]);
    alternar(novo._k, true);
  };
  const atualizar = (i: number, c: ContatoForm) => onChange(lista.map((x, j) => (j === i ? c : x)));
  const remover = (i: number) => {
    const resto = lista.filter((_, j) => j !== i);
    // sempre há um principal (o servidor faz o mesmo)
    if (lista[i].principal && resto.length) resto[0] = { ...resto[0], principal: true };
    onChange(resto);
  };
  return (
    <fieldset disabled={!podeEditar} className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">
        Pessoas com quem o escritório fala. Quem <strong className="font-medium text-foreground">recebe as notas</strong> entra como destinatário dos e-mails de NFS-e e fatura.
      </p>
      {lista.length === 0 ? (
        <Vazio icone={UsersRound} titulo="Nenhuma pessoa de contato" texto="Cadastre o síndico, o financeiro ou o contador do cliente.">
          {podeEditar && (
            <Button type="button" size="sm" onClick={adicionar}>
              <UserPlus /> Adicionar contato
            </Button>
          )}
        </Vazio>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Contato principal">
            <AnimatePresence initial={false}>
              {lista.map((c, i) => (
                <ContatoCard
                  key={c._k}
                  c={c}
                  editando={podeEditar && editando.has(c._k)}
                  podeEditar={podeEditar}
                  onChange={(n) => atualizar(i, n)}
                  onEditar={() => alternar(c._k, true)}
                  onConcluir={() => alternar(c._k, false)}
                  onRemover={() => remover(i)}
                  onPrincipal={() => onChange(lista.map((x, j) => ({ ...x, principal: j === i })))}
                />
              ))}
            </AnimatePresence>
          </div>
          {podeEditar && (
            <Button type="button" size="sm" variant="outline" onClick={adicionar}>
              <UserPlus /> Adicionar contato
            </Button>
          )}
        </>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------- telefones
export function TelefonesEditor({ lista, onChange, podeEditar }: { lista: TelefoneForm[]; onChange: (l: TelefoneForm[]) => void; podeEditar: boolean }) {
  const set = (i: number, t: Partial<TelefoneForm>) => onChange(lista.map((x, j) => (j === i ? { ...x, ...t } : x)));
  const adicionar = () => onChange([...lista, telefoneVazio("", lista.length ? "celular" : "comercial")]);
  const tornarPrincipal = (i: number) => onChange([lista[i], ...lista.filter((_, j) => j !== i)]);
  return (
    <fieldset disabled={!podeEditar} className="min-w-0 space-y-3">
      <p className="text-sm text-muted-foreground">O primeiro da lista é o telefone principal do cliente (usado nas listas e na nota).</p>
      {lista.length === 0 ? (
        <Vazio icone={Phone} titulo="Nenhum telefone" texto="Comercial, celular, WhatsApp ou fax, com ramal e descrição.">
          {podeEditar && (
            <Button type="button" size="sm" onClick={adicionar}>
              <Plus /> Adicionar telefone
            </Button>
          )}
        </Vazio>
      ) : (
        <>
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {lista.map((t, i) => {
                const T = TIPO_TELEFONE[t.tipo];
                const d = soDigitos(t.numero);
                return (
                  <motion.li
                    key={t._k}
                    layout
                    {...animacao}
                    className={cn("flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-2.5 shadow-sm sm:flex-nowrap", i === 0 && "border-brand/50 ring-1 ring-brand/20")}
                  >
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", t.tipo === "whatsapp" ? "bg-success/12 text-success-ink" : "bg-brand/10 text-info-ink")}>
                      <T.icone className="size-4" />
                    </span>
                    <NativeSelect aria-label="Tipo do telefone" value={t.tipo} onChange={(e) => set(i, { tipo: e.target.value as TipoTelefone })} className="h-9 w-32 shrink-0">
                      {(Object.keys(TIPO_TELEFONE) as TipoTelefone[]).map((k) => (
                        <option key={k} value={k}>
                          {TIPO_TELEFONE[k].l}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label="Número"
                      value={t.numero}
                      onChange={(e) => set(i, { numero: mascaraFone(e.target.value) })}
                      inputMode="tel"
                      placeholder="(11) 3333-4444"
                      className={cn("num h-9 w-40 shrink-0", d && d.length < 8 && "border-danger")}
                      autoFocus={!t.numero && i === lista.length - 1 && lista.length > 1}
                    />
                    <Input aria-label="Ramal" value={t.ramal} onChange={(e) => set(i, { ramal: e.target.value })} maxLength={10} placeholder="Ramal" className="num h-9 w-20 shrink-0" />
                    <Input aria-label="Descrição do telefone" value={t.descricao} onChange={(e) => set(i, { descricao: e.target.value })} maxLength={60} placeholder="Descrição (ex.: Financeiro)" className="h-9 min-w-32 flex-1" />
                    <div className="flex shrink-0 items-center gap-1">
                      {(t.tipo === "whatsapp" || t.tipo === "celular") && d.length >= 10 && (
                        <a href={linkWhatsApp(d)} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg text-success hover:bg-success/10" title="Abrir no WhatsApp" aria-label="Abrir no WhatsApp">
                          <MessageCircle className="size-4" />
                        </a>
                      )}
                      {i === 0 ? (
                        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-brand/12 px-2 text-[11px] font-semibold text-info-ink">
                          <Star className="size-3 fill-current" /> Principal
                        </span>
                      ) : (
                        podeEditar && (
                          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => tornarPrincipal(i)}>
                            <Star /> Tornar principal
                          </Button>
                        )
                      )}
                      {podeEditar && (
                        <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-danger-ink" onClick={() => onChange(lista.filter((_, j) => j !== i))} aria-label="Remover telefone">
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {podeEditar && (
            <Button type="button" size="sm" variant="outline" onClick={adicionar}>
              <Plus /> Adicionar telefone
            </Button>
          )}
        </>
      )}
    </fieldset>
  );
}
