"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, ExternalLink, GitMerge, Loader2, Plus, Trash2, UserCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useProfissionais } from "@/components/faturamento/dialogos";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCep } from "@/hooks/use-cep";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TOM_STATUS_CASO } from "@/lib/casos";
import { cep as fmtCep } from "@/lib/format";
import {
  type AdvogadoIO,
  type CasoDaPessoa,
  type ContatoPessoa,
  type EnderecoPessoa,
  mascaraDocumento,
  type OabIO,
  type PessoaDuplicada,
  type PessoaIn,
  type PessoaOut,
  type TipoPessoa,
  TIPOS_PESSOA,
  UFS,
} from "@/lib/pessoas";

import { erroDocumento, rotuloDocumento } from "./cadastro-rapido";
import { LinhaPessoa, PessoaPicker, SeloCliente, useOpcoesPessoa } from "./comum";

type Form = Omit<PessoaIn, "advogado"> & { telefonesTexto: string };

const vazia = (): Form => ({
  tipo_pessoa: "fisica",
  nome: "",
  nome_social: null,
  nome_fantasia: null,
  cpf_cnpj: null,
  documento_estrangeiro: null,
  rg: null,
  rg_orgao_emissor: null,
  rg_uf: null,
  data_nascimento: null,
  data_fundacao: null,
  nacionalidade: null,
  estado_civil: null,
  regime_bens: null,
  profissao: null,
  nome_mae: null,
  pis_nit: null,
  ctps: null,
  inscricao_estadual: null,
  inscricao_municipal: null,
  cnae_principal: null,
  representante_legal_id: null,
  email: null,
  telefones: [],
  telefonesTexto: "",
  enderecos: [],
  contatos: [],
  observacoes: null,
  consentimento_lgpd: null,
  base_legal_lgpd: null,
  ativo: true,
});

const advVazio = (): AdvogadoIO => ({ sociedade_id: null, eh_interno: false, usuario_id: null, email_profissional: null, telefone_profissional: null, observacoes: null, oabs: [] });
const enderecoVazio = (principal: boolean): EnderecoPessoa => ({ tipo: "residencial", cep: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, codigo_ibge: null, uf: null, pais: "Brasil", principal });
const contatoVazio = (): ContatoPessoa => ({ tipo: "celular", valor: "", descricao: null, principal: false, aceita_comunicacao: true });
const oabVazia = (principal: boolean): OabIO => ({ numero: "", uf: "", tipo_inscricao: "principal", situacao: "regular", principal });

const nulo = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const FISICAS: TipoPessoa[] = ["fisica", "estrangeiro", "sem_documento"];

function UfSelect({ id, valor, onChange, ariaLabel }: { id?: string; valor: string | null; onChange: (v: string | null) => void; ariaLabel?: string }) {
  return (
    <NativeSelect id={id} aria-label={ariaLabel} value={valor ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">UF</option>
      {UFS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * Cadastros › Pessoas: detalhe e edição em abas (Dados, Endereços, Contatos, Dados de advogado, Casos em que aparece,
 * Possíveis duplicados). A pessoa de um cliente tem nome, CPF/CNPJ e tipo vindos do cadastro de clientes.
 */
export function PessoaDialog({
  open,
  onOpenChange,
  pessoaId,
  onTrocar,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** vazio = nova pessoa */
  pessoaId: number | null;
  /** abrir outra pessoa no lugar (a que já existia, a que ficou depois da mescla) */
  onTrocar: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { pode, administrador } = useAuth();
  const podeEditar = pode("pessoas.editar");
  const opcoes = useOpcoesPessoa(open);
  const usuarios = useProfissionais(open);
  const cep = useCep();
  const q = useQuery({
    queryKey: ["pessoas", "detalhe", pessoaId],
    queryFn: () => api.get<PessoaOut>(`/pessoas/${pessoaId}`),
    enabled: open && !!pessoaId,
  });
  const p = pessoaId ? q.data : undefined;
  const [aba, setAba] = useState("dados");
  const [f, setF] = useState<Form>(vazia);
  const [repNome, setRepNome] = useState<string | null>(null);
  const [ehAdv, setEhAdv] = useState(false);
  const [adv, setAdv] = useState<AdvogadoIO>(advVazio);
  const [existente, setExistente] = useState<PessoaOut | null>(null);
  const [mesclar, setMesclar] = useState<PessoaDuplicada | null>(null);
  const casos = useQuery({
    queryKey: ["pessoas", "casos", pessoaId],
    queryFn: () => api.get<CasoDaPessoa[]>(`/pessoas/${pessoaId}/casos`),
    enabled: open && !!pessoaId,
  });
  const duplicados = useQuery({
    queryKey: ["pessoas", "duplicados", pessoaId],
    queryFn: () => api.get<PessoaDuplicada[]>(`/pessoas/${pessoaId}/duplicados`),
    enabled: open && !!pessoaId,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setExistente(null);
    setMesclar(null);
    if (!pessoaId) {
      setAba("dados");
      setF(vazia());
      setRepNome(null);
      setEhAdv(false);
      setAdv(advVazio());
      return;
    }
    if (!p) return;
    const { advogado, ...resto } = p;
    setF({
      ...vazia(),
      ...Object.fromEntries(Object.entries(resto).filter(([k]) => k in vazia())),
      cpf_cnpj: p.cpf_cnpj ? mascaraDocumento(p.cpf_cnpj) : null,
      telefonesTexto: (p.telefones ?? []).join(", "),
      enderecos: (p.enderecos ?? []).map((e) => ({ ...enderecoVazio(false), ...e, cep: e.cep ? fmtCep(e.cep) : null })),
      contatos: (p.contatos ?? []).map((c) => ({ ...contatoVazio(), ...c })),
    } as Form);
    setRepNome(p.representante_legal_nome);
    setEhAdv(!!advogado);
    setAdv(advogado ? { ...advVazio(), ...advogado } : advVazio());
  }, [open, pessoaId, p]);
  useEffect(() => {
    if (open) setAba("dados");
  }, [open, pessoaId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => ({ ...o, [k]: v }));
  const texto = (k: keyof Form) => ({ value: (f[k] as string | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value as never) });
  const cliente = p?.cliente_id ?? null;
  const fisica = FISICAS.includes(f.tipo_pessoa);
  const juridica = f.tipo_pessoa === "juridica" || f.tipo_pessoa === "ente_publico";
  const leitura = !podeEditar;
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["pessoas"] });
    qc.invalidateQueries({ queryKey: ["fat", "partes"] });
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo: PessoaIn = {
        ...(Object.fromEntries(Object.entries(f).filter(([k]) => k !== "telefonesTexto").map(([k, v]) => [k, typeof v === "string" ? nulo(v) : v])) as unknown as PessoaIn),
        nome: f.nome.trim(),
        cpf_cnpj: f.tipo_pessoa === "sem_documento" ? null : (f.cpf_cnpj ?? "").replace(/\D/g, "") || null,
        telefones: f.telefonesTexto
          .split(/[,;\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
        enderecos: f.enderecos.map((e) => ({ ...e, cep: (e.cep ?? "").replace(/\D/g, "") || null })),
        contatos: f.contatos.filter((c) => c.valor.trim()).map((c) => ({ ...c, valor: c.valor.trim(), descricao: nulo(c.descricao) })),
      };
      // dados de advogado: manda quando é advogado; manda nulo só para retirar de quem era
      if (ehAdv) corpo.advogado = { ...adv, email_profissional: nulo(adv.email_profissional), telefone_profissional: nulo(adv.telefone_profissional), observacoes: nulo(adv.observacoes), oabs: adv.oabs.filter((o) => o.numero.trim()) };
      else if (p?.advogado) corpo.advogado = null;
      return pessoaId ? api.put<PessoaOut>(`/pessoas/${pessoaId}`, corpo) : api.post<PessoaOut>("/pessoas", corpo);
    },
    onSuccess: (r) => {
      invalidar();
      if (!pessoaId && r.ja_existia) return setExistente(r);
      toast.success(pessoaId ? "Pessoa atualizada" : `${r.nome} entrou no cadastro de pessoas`);
      onOpenChange(false);
    },
  });
  const juntar = useMutation({
    mutationFn: (d: PessoaDuplicada) => api.post<PessoaOut>(`/pessoas/${pessoaId}/mesclar`, { duplicada_id: d.id }),
    onSuccess: (r) => {
      toast.success(`Pessoas mescladas: ficou ${r.nome}`);
      setMesclar(null);
      invalidar();
      qc.invalidateQueries({ queryKey: ["fat"] });
      if (r.id !== pessoaId) onTrocar(r.id);
    },
  });

  const enviar = () => {
    if (f.nome.trim().length < 2) return (setAba("dados"), toast.error("Informe o nome."));
    const comOab = ehAdv && adv.oabs.some((o) => o.numero.trim());
    const erro = cliente ? null : erroDocumento(f.tipo_pessoa, f.cpf_cnpj ?? "", comOab);
    if (erro) return (setAba("dados"), toast.error(erro));
    if (ehAdv && adv.oabs.some((o) => o.numero.trim() && !o.uf)) return (setAba("advogado"), toast.error("Informe a UF de cada inscrição na OAB."));
    salvar.mutate();
  };

  const setEnd = (i: number, patch: Partial<EnderecoPessoa>) => set("enderecos", f.enderecos.map((e, k) => (k === i ? { ...e, ...patch } : patch.principal ? { ...e, principal: false } : e)));
  const setCont = (i: number, patch: Partial<ContatoPessoa>) => set("contatos", f.contatos.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const setOab = (i: number, patch: Partial<OabIO>) => setAdv((o) => ({ ...o, oabs: o.oabs.map((x, k) => (k === i ? { ...x, ...patch } : patch.principal ? { ...x, principal: false } : x)) }));
  const buscarCep = async (i: number) => {
    const e = f.enderecos[i];
    if (!e || (e.logradouro ?? "").trim()) return;
    const r = await cep.buscar(e.cep ?? "");
    if (r) setEnd(i, { logradouro: r.logradouro || null, bairro: r.bairro || null, cidade: r.localidade || null, uf: r.uf || null, codigo_ibge: r.ibge || null });
  };

  const nCasos = casos.data?.length ?? 0;
  const nDup = duplicados.data?.length ?? 0;
  const carregando = !!pessoaId && q.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <form
            className="flex max-h-[92dvh] flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              enviar();
            }}
          >
            <Tabs value={aba} onValueChange={(v) => setAba(String(v))} className="min-h-0 flex-1 gap-0">
              <DialogHeader className="border-b p-5 pb-0">
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg">
                  {pessoaId ? (p?.nome ?? "Pessoa") : "Nova pessoa"}
                  <SeloCliente clienteId={cliente} />
                  {p && !p.ativo && <Pill tom="neutral">Inativa</Pill>}
                </DialogTitle>
                <DialogDescription>
                  {pessoaId ? "O que mudar aqui vale para todos os casos em que a pessoa aparece: é o mesmo cadastro." : "Cada pessoa é cadastrada uma vez e aparece em quantos casos for preciso."}
                </DialogDescription>
                <div className="-mx-1 mt-3 overflow-x-auto px-1 pb-3">
                  <TabsList>
                    <TabsTrigger value="dados" className="px-3">
                      Dados
                    </TabsTrigger>
                    <TabsTrigger value="enderecos" className="px-3">
                      Endereços{f.enderecos.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{f.enderecos.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="contatos" className="px-3">
                      Contatos{f.contatos.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{f.contatos.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="advogado" className="px-3">
                      Dados de advogado{ehAdv && <span className="size-1.5 rounded-full bg-brand" />}
                    </TabsTrigger>
                    {pessoaId && (
                      <TabsTrigger value="casos" className="px-3">
                        Casos em que aparece{nCasos > 0 && <span className="text-xs text-muted-foreground tabular-nums">{nCasos}</span>}
                      </TabsTrigger>
                    )}
                    {pessoaId && (
                      <TabsTrigger value="duplicados" className="px-3">
                        Possíveis duplicados{nDup > 0 && <span className="rounded bg-warning/20 px-1 text-xs text-warning-ink tabular-nums">{nDup}</span>}
                      </TabsTrigger>
                    )}
                  </TabsList>
                </div>
              </DialogHeader>
              <div className="min-h-[50dvh] flex-1 overflow-y-auto p-5">
                {carregando ? (
                  <Skeleton className="h-64 rounded-2xl" />
                ) : (
                  <>
                    {/* ------------------------------------------------ Dados */}
                    <TabsContent value="dados" className="space-y-4">
                      {existente && (
                        <div className="rounded-xl border border-warning/30 bg-warning/8 p-3">
                          <p className="mb-1 flex items-center gap-2 text-sm font-medium">
                            <UserCheck className="size-4 text-warning-ink" /> Já cadastrada
                          </p>
                          <p className="mb-2 text-sm text-muted-foreground">Este CPF/CNPJ já está no cadastro de pessoas. Nenhuma pessoa nova foi criada.</p>
                          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                            <LinhaPessoa p={existente} />
                            <Button type="button" size="sm" onClick={() => onTrocar(existente.id)}>
                              Usar esta
                            </Button>
                          </div>
                        </div>
                      )}
                      {cliente && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-success/30 bg-success/8 px-3 py-2.5 text-sm">
                          <BadgeCheck className="size-4 shrink-0 text-success-ink" />
                          <span className="min-w-0 flex-1">
                            Esta pessoa é o <strong className="font-medium">cliente nº {cliente}</strong>. Nome, CPF/CNPJ e tipo vêm do cadastro de clientes (é ele que emite fatura e nota) e são alterados lá.
                          </span>
                          <Button variant="outline" size="sm" render={<Link href={`/cadastros/clientes?id=${cliente}`} />} nativeButton={false}>
                            <ExternalLink /> Abrir cliente
                          </Button>
                        </div>
                      )}
                      <fieldset disabled={leitura} className="grid gap-4 sm:grid-cols-6">
                        <Field label="Tipo" htmlFor="pes-tipo" className="sm:col-span-2">
                          <NativeSelect id="pes-tipo" value={f.tipo_pessoa} disabled={!!cliente} onChange={(e) => set("tipo_pessoa", e.target.value as TipoPessoa)}>
                            {(opcoes.data?.tipo_pessoa ?? TIPOS_PESSOA).filter((t) => TIPOS_PESSOA.some((x) => x.valor === t.valor) || t.valor === f.tipo_pessoa).map((t) => (
                              <option key={t.valor} value={t.valor}>
                                {t.rotulo}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <Field label={fisica ? "Nome completo" : "Nome / razão social"} obrigatorio htmlFor="pes-nome" className="sm:col-span-4">
                          <Input id="pes-nome" disabled={!!cliente} {...texto("nome")} />
                        </Field>
                        {f.tipo_pessoa !== "sem_documento" && (
                          <Field label={rotuloDocumento(f.tipo_pessoa)} obrigatorio={f.tipo_pessoa === "fisica" || f.tipo_pessoa === "juridica"} htmlFor="pes-doc" className="sm:col-span-2">
                            <Input id="pes-doc" disabled={!!cliente} inputMode="numeric" className="font-mono" value={f.cpf_cnpj ?? ""} onChange={(e) => set("cpf_cnpj", mascaraDocumento(e.target.value))} />
                          </Field>
                        )}
                        {f.tipo_pessoa === "estrangeiro" && (
                          <Field label="Documento estrangeiro" htmlFor="pes-doc-est" className="sm:col-span-2" dica="Passaporte, por exemplo.">
                            <Input id="pes-doc-est" maxLength={40} {...texto("documento_estrangeiro")} />
                          </Field>
                        )}
                        {juridica ? (
                          <>
                            <Field label="Nome fantasia" htmlFor="pes-fantasia" className="sm:col-span-4">
                              <Input id="pes-fantasia" maxLength={200} {...texto("nome_fantasia")} />
                            </Field>
                            <Field label="Fundação" htmlFor="pes-fundacao" className="sm:col-span-2">
                              <Input id="pes-fundacao" type="date" value={f.data_fundacao ?? ""} onChange={(e) => set("data_fundacao", e.target.value || null)} />
                            </Field>
                            <Field label="Inscrição estadual" htmlFor="pes-ie" className="sm:col-span-2">
                              <Input id="pes-ie" maxLength={20} className="font-mono" {...texto("inscricao_estadual")} />
                            </Field>
                            <Field label="Inscrição municipal" htmlFor="pes-im" className="sm:col-span-2">
                              <Input id="pes-im" maxLength={20} className="font-mono" {...texto("inscricao_municipal")} />
                            </Field>
                            <Field label="CNAE principal" htmlFor="pes-cnae" className="sm:col-span-2">
                              <Input id="pes-cnae" maxLength={10} className="font-mono" {...texto("cnae_principal")} />
                            </Field>
                          </>
                        ) : (
                          <>
                            <Field label="Nome social" htmlFor="pes-social" className="sm:col-span-4">
                              <Input id="pes-social" maxLength={200} {...texto("nome_social")} />
                            </Field>
                            <Field label="RG" htmlFor="pes-rg" className="sm:col-span-2">
                              <Input id="pes-rg" maxLength={20} className="font-mono" {...texto("rg")} />
                            </Field>
                            <Field label="Órgão emissor" htmlFor="pes-rg-orgao" className="sm:col-span-1">
                              <Input id="pes-rg-orgao" maxLength={20} {...texto("rg_orgao_emissor")} />
                            </Field>
                            <Field label="UF do RG" htmlFor="pes-rg-uf" className="sm:col-span-1">
                              <UfSelect id="pes-rg-uf" valor={f.rg_uf} onChange={(v) => set("rg_uf", v)} />
                            </Field>
                            <Field label="Nascimento" htmlFor="pes-nasc" className="sm:col-span-2">
                              <Input id="pes-nasc" type="date" value={f.data_nascimento ?? ""} onChange={(e) => set("data_nascimento", e.target.value || null)} />
                            </Field>
                            <Field label="Nacionalidade" htmlFor="pes-nac" className="sm:col-span-2">
                              <Input id="pes-nac" maxLength={60} placeholder="brasileira" {...texto("nacionalidade")} />
                            </Field>
                            <Field label="Estado civil" htmlFor="pes-civil" className="sm:col-span-2">
                              <NativeSelect id="pes-civil" value={f.estado_civil ?? ""} onChange={(e) => set("estado_civil", e.target.value || null)}>
                                <option value="">—</option>
                                {opcoes.data?.estado_civil.map((o) => (
                                  <option key={o.valor} value={o.valor}>
                                    {o.rotulo}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field label="Regime de bens" htmlFor="pes-regime" className="sm:col-span-2">
                              <NativeSelect id="pes-regime" value={f.regime_bens ?? ""} onChange={(e) => set("regime_bens", e.target.value || null)}>
                                <option value="">—</option>
                                {opcoes.data?.regime_bens.map((o) => (
                                  <option key={o.valor} value={o.valor}>
                                    {o.rotulo}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field label="Profissão" htmlFor="pes-prof" className="sm:col-span-2">
                              <Input id="pes-prof" maxLength={100} {...texto("profissao")} />
                            </Field>
                            <Field label="Nome da mãe" htmlFor="pes-mae" className="sm:col-span-4">
                              <Input id="pes-mae" maxLength={200} {...texto("nome_mae")} />
                            </Field>
                            <Field label="PIS / NIT" htmlFor="pes-pis" className="sm:col-span-1">
                              <Input id="pes-pis" maxLength={20} className="font-mono" {...texto("pis_nit")} />
                            </Field>
                            <Field label="CTPS" htmlFor="pes-ctps" className="sm:col-span-1">
                              <Input id="pes-ctps" maxLength={30} className="font-mono" {...texto("ctps")} />
                            </Field>
                          </>
                        )}
                        <Field label="E-mail" htmlFor="pes-email" className="sm:col-span-3">
                          <Input id="pes-email" type="email" maxLength={200} {...texto("email")} />
                        </Field>
                        <Field label="Telefones" htmlFor="pes-tel" className="sm:col-span-3" dica="Mais de um? Separe com vírgula.">
                          <Input id="pes-tel" value={f.telefonesTexto} onChange={(e) => set("telefonesTexto", e.target.value)} />
                        </Field>
                        <Field label={juridica ? "Representante legal" : "Representante legal (se houver)"} htmlFor="pes-rep" className="sm:col-span-6" dica="Outra pessoa do cadastro: sócio ou administrador da empresa, responsável pelo menor.">
                          <PessoaPicker
                            id="pes-rep"
                            valor={f.representante_legal_id}
                            nome={repNome}
                            onChange={(x) => {
                              setRepNome(x?.nome ?? null);
                              set("representante_legal_id", x?.id ?? null);
                            }}
                            vazio="Nenhum"
                          />
                        </Field>
                        <Field label="Observações" htmlFor="pes-obs" className="sm:col-span-6">
                          <Textarea id="pes-obs" rows={2} value={f.observacoes ?? ""} onChange={(e) => set("observacoes", e.target.value)} />
                        </Field>
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm sm:col-span-3">
                          <Switch checked={!!f.consentimento_lgpd} onCheckedChange={(v) => set("consentimento_lgpd", v)} aria-label="Consentimento LGPD" className="mt-0.5" />
                          <span>
                            <span className="block font-medium">Consentimento LGPD registrado</span>
                            <span className="block text-xs text-muted-foreground">A pessoa autorizou o uso dos dados.</span>
                          </span>
                        </label>
                        <Field label="Base legal (LGPD)" htmlFor="pes-base" className="sm:col-span-3">
                          <Input id="pes-base" maxLength={100} placeholder="ex.: exercício regular de direito" {...texto("base_legal_lgpd")} />
                        </Field>
                      </fieldset>
                    </TabsContent>

                    {/* ------------------------------------------------ Endereços */}
                    <TabsContent value="enderecos" className="space-y-3">
                      {f.enderecos.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum endereço cadastrado.</p>}
                      {f.enderecos.map((e, i) => (
                        <fieldset key={i} disabled={leitura} className="rounded-2xl border bg-card p-4">
                          <legend className="px-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Endereço {i + 1}</legend>
                          <div className="grid gap-3 sm:grid-cols-12">
                            <Field label="Tipo" htmlFor={`end-tipo-${i}`} className="sm:col-span-3">
                              <NativeSelect id={`end-tipo-${i}`} value={e.tipo} onChange={(ev) => setEnd(i, { tipo: ev.target.value })}>
                                {opcoes.data?.tipo_endereco.map((o) => (
                                  <option key={o.valor} value={o.valor}>
                                    {o.rotulo}
                                  </option>
                                ))}
                              </NativeSelect>
                            </Field>
                            <Field label="CEP" htmlFor={`end-cep-${i}`} className="sm:col-span-2">
                              <Input id={`end-cep-${i}`} inputMode="numeric" className="font-mono" value={e.cep ?? ""} onChange={(ev) => setEnd(i, { cep: fmtCep(ev.target.value.replace(/\D/g, "").slice(0, 8)) })} onBlur={() => buscarCep(i)} />
                            </Field>
                            <Field label="Rua / avenida" htmlFor={`end-log-${i}`} className="sm:col-span-5">
                              <Input id={`end-log-${i}`} value={e.logradouro ?? ""} onChange={(ev) => setEnd(i, { logradouro: ev.target.value })} />
                            </Field>
                            <Field label="Número" htmlFor={`end-num-${i}`} className="sm:col-span-2">
                              <Input id={`end-num-${i}`} value={e.numero ?? ""} onChange={(ev) => setEnd(i, { numero: ev.target.value })} />
                            </Field>
                            <Field label="Complemento" htmlFor={`end-comp-${i}`} className="sm:col-span-3">
                              <Input id={`end-comp-${i}`} value={e.complemento ?? ""} onChange={(ev) => setEnd(i, { complemento: ev.target.value })} />
                            </Field>
                            <Field label="Bairro" htmlFor={`end-bairro-${i}`} className="sm:col-span-3">
                              <Input id={`end-bairro-${i}`} value={e.bairro ?? ""} onChange={(ev) => setEnd(i, { bairro: ev.target.value })} />
                            </Field>
                            <Field label="Cidade" htmlFor={`end-cidade-${i}`} className="sm:col-span-4">
                              <Input id={`end-cidade-${i}`} value={e.cidade ?? ""} onChange={(ev) => setEnd(i, { cidade: ev.target.value })} />
                            </Field>
                            <Field label="UF" htmlFor={`end-uf-${i}`} className="sm:col-span-2">
                              <UfSelect id={`end-uf-${i}`} valor={e.uf} onChange={(v) => setEnd(i, { uf: v })} />
                            </Field>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm">
                              <Switch checked={e.principal} onCheckedChange={(v) => setEnd(i, { principal: v })} aria-label={`Endereço ${i + 1} principal`} /> Endereço principal
                            </label>
                            <Button type="button" variant="ghost" size="sm" onClick={() => set("enderecos", f.enderecos.filter((_, k) => k !== i))}>
                              <Trash2 /> Remover
                            </Button>
                          </div>
                        </fieldset>
                      ))}
                      {!leitura && (
                        <Button type="button" variant="outline" onClick={() => set("enderecos", [...f.enderecos, enderecoVazio(f.enderecos.length === 0)])}>
                          <Plus /> Adicionar endereço
                        </Button>
                      )}
                    </TabsContent>

                    {/* ------------------------------------------------ Contatos */}
                    <TabsContent value="contatos" className="space-y-3">
                      {f.contatos.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum contato cadastrado. O e-mail e os telefones principais ficam na aba Dados.</p>}
                      {f.contatos.map((c, i) => (
                        <fieldset key={i} disabled={leitura} className="grid items-end gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-12">
                          <Field label="Tipo" htmlFor={`con-tipo-${i}`} className="sm:col-span-2">
                            <NativeSelect id={`con-tipo-${i}`} value={c.tipo} onChange={(ev) => setCont(i, { tipo: ev.target.value })}>
                              {opcoes.data?.tipo_contato.map((o) => (
                                <option key={o.valor} value={o.valor}>
                                  {o.rotulo}
                                </option>
                              ))}
                            </NativeSelect>
                          </Field>
                          <Field label="Contato" htmlFor={`con-valor-${i}`} className="sm:col-span-4">
                            <Input id={`con-valor-${i}`} maxLength={200} value={c.valor} onChange={(ev) => setCont(i, { valor: ev.target.value })} />
                          </Field>
                          <Field label="De quem é" htmlFor={`con-desc-${i}`} className="sm:col-span-3">
                            <Input id={`con-desc-${i}`} maxLength={100} placeholder="ex.: financeiro, secretária" value={c.descricao ?? ""} onChange={(ev) => setCont(i, { descricao: ev.target.value })} />
                          </Field>
                          <div className="flex items-center gap-3 pb-2 sm:col-span-3">
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                              <Switch size="sm" checked={c.aceita_comunicacao} onCheckedChange={(v) => setCont(i, { aceita_comunicacao: v })} aria-label="Aceita receber comunicação" /> Aceita comunicação
                            </label>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover contato ${i + 1}`} className="ml-auto" onClick={() => set("contatos", f.contatos.filter((_, k) => k !== i))}>
                              <Trash2 />
                            </Button>
                          </div>
                        </fieldset>
                      ))}
                      {!leitura && (
                        <Button type="button" variant="outline" onClick={() => set("contatos", [...f.contatos, contatoVazio()])}>
                          <Plus /> Adicionar contato
                        </Button>
                      )}
                    </TabsContent>

                    {/* ------------------------------------------------ Dados de advogado */}
                    <TabsContent value="advogado" className="space-y-4">
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm">
                        <Switch checked={ehAdv} disabled={leitura || juridica} onCheckedChange={setEhAdv} aria-label="É advogado" className="mt-0.5" />
                        <span>
                          <span className="block font-medium">Esta pessoa é advogado(a)</span>
                          <span className="block text-xs text-muted-foreground">
                            {juridica ? "Advogado é pessoa física. A sociedade de advogados entra no campo Sociedade do cadastro de cada advogado." : "O mesmo cadastro serve como advogado da parte contrária, correspondente ou até como parte."}
                          </span>
                        </span>
                      </label>
                      {ehAdv && !juridica && (
                        <fieldset disabled={leitura} className="space-y-4">
                          <div className="rounded-2xl border bg-card p-4">
                            <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Inscrições na OAB</p>
                            {adv.oabs.length === 0 && <p className="mb-3 text-sm text-muted-foreground">Nenhuma inscrição cadastrada.</p>}
                            <div className="space-y-2">
                              {adv.oabs.map((o, i) => (
                                <div key={o.id ?? `n${i}`} className="grid items-end gap-2 sm:grid-cols-12">
                                  <Field label="Número" htmlFor={`oab-num-${i}`} className="sm:col-span-3" dica={o.exibicao ?? undefined}>
                                    <Input id={`oab-num-${i}`} maxLength={12} className="font-mono" value={o.numero} onChange={(e) => setOab(i, { numero: e.target.value.replace(/[^\dA-Za-z-]/g, "") })} />
                                  </Field>
                                  <Field label="UF" htmlFor={`oab-uf-${i}`} className="sm:col-span-2">
                                    <UfSelect id={`oab-uf-${i}`} valor={o.uf || null} onChange={(v) => setOab(i, { uf: v ?? "" })} />
                                  </Field>
                                  <Field label="Inscrição" htmlFor={`oab-tipo-${i}`} className="sm:col-span-3">
                                    <NativeSelect id={`oab-tipo-${i}`} value={o.tipo_inscricao} onChange={(e) => setOab(i, { tipo_inscricao: e.target.value })}>
                                      {opcoes.data?.tipo_inscricao.map((x) => (
                                        <option key={x.valor} value={x.valor}>
                                          {x.rotulo}
                                        </option>
                                      ))}
                                    </NativeSelect>
                                  </Field>
                                  <Field label="Situação" htmlFor={`oab-sit-${i}`} className="sm:col-span-2">
                                    <NativeSelect id={`oab-sit-${i}`} value={o.situacao} onChange={(e) => setOab(i, { situacao: e.target.value })}>
                                      {opcoes.data?.situacao_oab.map((x) => (
                                        <option key={x.valor} value={x.valor}>
                                          {x.rotulo}
                                        </option>
                                      ))}
                                    </NativeSelect>
                                  </Field>
                                  <div className="flex items-center gap-2 pb-2 sm:col-span-2">
                                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                                      <Switch size="sm" checked={o.principal} onCheckedChange={(v) => setOab(i, { principal: v })} aria-label={`Inscrição ${i + 1} principal`} /> Principal
                                    </label>
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remover inscrição ${i + 1}`} className="ml-auto" onClick={() => setAdv((x) => ({ ...x, oabs: x.oabs.filter((_, k) => k !== i) }))}>
                                      <Trash2 />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                            {!leitura && (
                              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAdv((x) => ({ ...x, oabs: [...x.oabs, oabVazia(x.oabs.length === 0)] }))}>
                                <Plus /> Adicionar inscrição
                              </Button>
                            )}
                          </div>
                          <div className="grid gap-4 sm:grid-cols-6">
                            <Field label="Sociedade de advogados" htmlFor="adv-soc" className="sm:col-span-6" dica="Pessoa jurídica do cadastro a que o advogado pertence.">
                              <PessoaPicker id="adv-soc" valor={adv.sociedade_id} nome={adv.sociedade_nome} vazio="Nenhuma" onChange={(x) => setAdv((o) => ({ ...o, sociedade_id: x?.id ?? null, sociedade_nome: x?.nome ?? null }))} />
                            </Field>
                            <Field label="E-mail profissional" htmlFor="adv-email" className="sm:col-span-3">
                              <Input id="adv-email" type="email" maxLength={200} value={adv.email_profissional ?? ""} onChange={(e) => setAdv((o) => ({ ...o, email_profissional: e.target.value }))} />
                            </Field>
                            <Field label="Telefone profissional" htmlFor="adv-tel" className="sm:col-span-3">
                              <Input id="adv-tel" maxLength={30} value={adv.telefone_profissional ?? ""} onChange={(e) => setAdv((o) => ({ ...o, telefone_profissional: e.target.value }))} />
                            </Field>
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border bg-background/50 px-3 py-2.5 text-sm sm:col-span-3">
                              <Switch checked={adv.eh_interno} onCheckedChange={(v) => setAdv((o) => ({ ...o, eh_interno: v, usuario_id: v ? o.usuario_id : null }))} aria-label="Advogado do escritório" className="mt-0.5" />
                              <span>
                                <span className="block font-medium">Advogado do escritório</span>
                                <span className="block text-xs text-muted-foreground">Trabalha aqui (ligue ao usuário dele ao lado).</span>
                              </span>
                            </label>
                            {adv.eh_interno && (
                              <Field label="Usuário no sistema" htmlFor="adv-usuario" className="sm:col-span-3">
                                <NativeSelect id="adv-usuario" value={adv.usuario_id ?? ""} onChange={(e) => setAdv((o) => ({ ...o, usuario_id: e.target.value ? Number(e.target.value) : null }))}>
                                  <option value="">—</option>
                                  {usuarios.data?.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.nome}
                                    </option>
                                  ))}
                                </NativeSelect>
                              </Field>
                            )}
                            <Field label="Observações do advogado" htmlFor="adv-obs" className="sm:col-span-6">
                              <Textarea id="adv-obs" rows={2} value={adv.observacoes ?? ""} onChange={(e) => setAdv((o) => ({ ...o, observacoes: e.target.value }))} />
                            </Field>
                          </div>
                        </fieldset>
                      )}
                    </TabsContent>

                    {/* ------------------------------------------------ Casos em que aparece */}
                    {pessoaId && (
                      <TabsContent value="casos">
                        {casos.isPending ? (
                          <Skeleton className="h-32 rounded-2xl" />
                        ) : nCasos === 0 ? (
                          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Esta pessoa ainda não aparece em nenhum caso.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-2xl border">
                            <table className="w-full min-w-[640px] text-sm">
                              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-2.5 font-medium">Caso</th>
                                  <th className="px-3 py-2.5 font-medium">Tipo</th>
                                  <th className="px-3 py-2.5 font-medium">Papel</th>
                                  <th className="px-3 py-2.5 font-medium">Situação</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {casos.data?.map((c, i) => (
                                  <tr key={`${c.caso_id}-${i}`} className={c.ativo ? undefined : "opacity-60"}>
                                    <td className="max-w-80 px-4 py-2.5">
                                      <Link href={`/faturamento/casos/${c.caso_id}?aba=partes`} className="font-medium text-info-ink hover:underline">
                                        <span className="font-mono">#{c.numero}</span> {c.titulo}
                                      </Link>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {c.cliente_nome}
                                        {c.numero_processo ? <span className="font-mono"> · {c.numero_processo}</span> : null}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground">{c.tipo_caso_nome}</td>
                                    <td className="px-3 py-2.5">
                                      <span className="flex flex-wrap items-center gap-1.5">
                                        {[c.categoria, c.qualificacao].filter(Boolean).join(" · ") || "—"}
                                        {c.eh_cliente && <Pill tom="success">Cliente</Pill>}
                                        {c.principal && <Pill tom="brand">Principal</Pill>}
                                        {c.pendente_reclassificacao && <Pill tom="warning">Revisar</Pill>}
                                        {!c.ativo && <Pill tom="neutral">Retirada</Pill>}
                                      </span>
                                      {c.origem !== "partes" && <span className="block text-[11px] text-muted-foreground">{c.origem === "cliente" ? "cliente do caso (partes ainda não cadastradas)" : "parte do processo importado do tribunal"}</span>}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <StatusBadge tom={TOM_STATUS_CASO[c.status] ?? "neutral"} label={c.status_nome} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </TabsContent>
                    )}

                    {/* ------------------------------------------------ Possíveis duplicados */}
                    {pessoaId && (
                      <TabsContent value="duplicados" className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Pessoas com o mesmo CPF/CNPJ ou com nome muito parecido. É só um aviso: confira antes de juntar.
                          {!administrador && " A mescla é feita pelo administrador."}
                        </p>
                        {duplicados.isPending ? (
                          <Skeleton className="h-24 rounded-2xl" />
                        ) : nDup === 0 ? (
                          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum possível duplicado encontrado.</p>
                        ) : (
                          <ul className="space-y-2">
                            {duplicados.data?.map((d) => (
                              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-sm">
                                <AlertTriangle className="size-4 shrink-0 text-warning-ink" />
                                <LinhaPessoa p={d} />
                                <span className="text-xs text-muted-foreground">
                                  {d.motivo} · {Math.round(d.semelhanca * 100)}% parecido
                                </span>
                                <Button type="button" variant="ghost" size="sm" onClick={() => onTrocar(d.id)}>
                                  Abrir
                                </Button>
                                {administrador && (
                                  <Button type="button" variant="outline" size="sm" onClick={() => setMesclar(d)}>
                                    <GitMerge /> Mesclar
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TabsContent>
                    )}
                  </>
                )}
              </div>
            </Tabs>
            <DialogFooter className="m-0 items-center rounded-none p-4">
              {podeEditar && pessoaId && !cliente && (
                <label className="mr-auto flex items-center gap-2 text-sm">
                  <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Pessoa ativa" /> Ativa
                </label>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {podeEditar ? "Cancelar" : "Fechar"}
              </Button>
              {podeEditar && (
                <Button type="submit" disabled={salvar.isPending || carregando} className="px-4">
                  {salvar.isPending && <Loader2 className="animate-spin" />}
                  Salvar
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!mesclar}
        onOpenChange={(o) => !o && setMesclar(null)}
        titulo={`Mesclar ${mesclar?.nome ?? ""} em ${p?.nome ?? ""}?`}
        descricao={
          <>
            As duas passam a ser uma pessoa só. <strong>{p?.nome}</strong> fica; os casos, processos, endereços, contatos e dados de advogado de <strong>{mesclar?.nome}</strong> passam para ela, e a duplicada é desativada (não é apagada).
            {(mesclar?.cliente_id || cliente) && " A pessoa de um cliente é sempre a que fica."} A mescla fica registrada no histórico e não tem botão de desfazer.
          </>
        }
        confirmar="Mesclar"
        destrutivo
        carregando={juntar.isPending}
        onConfirm={() => mesclar && juntar.mutate(mesclar)}
      />
    </>
  );
}
