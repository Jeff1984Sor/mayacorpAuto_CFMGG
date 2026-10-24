"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, KeyRound, Loader2, MapPin, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, FormSection, NativeSelect } from "@/components/mayacorp/form";
import { PreencherIA } from "@/components/ia/preencher-ia";
import { LerNotaFiscal, type NotaLida, type Secao } from "@/components/nfse/ler-nota";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { CidadeInput } from "@/components/mayacorp/cidade-input";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCep } from "@/hooks/use-cep";
import { preencherVazios, useCnpj } from "@/hooks/use-cnpj";
import { destacarCampos } from "@/hooks/use-ia";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { aliquota, cep as fmtCep, data, documento, toNum } from "@/lib/format";
import type { CertificadoOut, EmissoraOut } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cnpjValido, soDigitos } from "@/lib/validacao";

const REGIMES = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real", mei: "MEI" } as const;

const schema = z.object({
  razao_social: z.string().min(2, "Obrigatório"),
  nome_fantasia: z.string().optional(),
  cnpj: z.string().refine(cnpjValido, "CNPJ inválido"),
  ccm: z.string().refine((v) => soDigitos(v).length >= 7 && soDigitos(v).length <= 8, "CCM tem 8 dígitos"),
  cep: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  email: z.union([z.email("E-mail inválido"), z.literal("")]).optional(),
  regime: z.enum(["simples", "presumido", "real", "mei"]),
  cod_servico_padrao: z.string().optional(),
  aliquota_pct: z.string().refine((v) => toNum(v.replace(",", ".")) > 0 && toNum(v.replace(",", ".")) <= 5, "Entre 0 e 5%"),
  serie_rps: z.string().min(1, "Obrigatório").max(5),
  prox_rps: z.coerce.number().int().min(1),
  certificado_id: z.string().optional(),
  ativa: z.boolean(),
  telefone: z.string().optional(),
  banco: z.string().optional(),
  agencia: z.string().optional(),
  conta: z.string().optional(),
  chave_pix: z.string().optional(),
});
type Form = z.input<typeof schema>;

const vazio: Form = {
  razao_social: "",
  nome_fantasia: "",
  cnpj: "",
  ccm: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "São Paulo",
  uf: "SP",
  email: "",
  regime: "presumido",
  cod_servico_padrao: "",
  aliquota_pct: "5,00",
  serie_rps: "A",
  prox_rps: 1,
  certificado_id: "",
  ativa: true,
  telefone: "",
  banco: "",
  agencia: "",
  conta: "",
  chave_pix: "",
};

function paraForm(e: EmissoraOut): Form {
  return {
    ...vazio,
    ...Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ""])),
    cnpj: documento(e.cnpj),
    cep: fmtCep(e.cep),
    aliquota_pct: (toNum(e.aliquota_iss) * 100).toFixed(2).replace(".", ","),
    certificado_id: e.certificado_id ? String(e.certificado_id) : "",
    regime: e.regime,
    prox_rps: e.prox_rps,
    ativa: e.ativa,
  } as Form;
}

function EmissoraForm({ emissora, open, onClose }: { emissora: EmissoraOut | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const cep = useCep();
  const certs = useQuery({
    queryKey: ["certificados"],
    queryFn: () => api.get<CertificadoOut[]>("/config/certificados"),
    enabled: open,
    meta: { silencioso: true },
  });
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: vazio });
  const cnpj = useCnpj();
  // Parâmetros IBS/CBS lidos de uma nota fiscal: gravados como padrão da emissora quando ela for salva
  const [paramsPendentes, setParamsPendentes] = useState<Record<string, string> | null>(null);

  const aplicarNota = (nota: NotaLida, secoes: Set<Secao>) => {
    const mudou: string[] = [];
    const definir = (campo: keyof Form, valor: unknown) => {
      if (valor === undefined || valor === null || valor === "") return;
      f.setValue(campo, valor as never, { shouldDirty: true, shouldValidate: true });
      mudou.push(campo);
    };
    if (secoes.has("empresa")) {
      for (const [k, v] of Object.entries(nota.empresa)) {
        if (!(k in vazio)) continue;
        definir(k as keyof Form, k === "cnpj" ? documento(v) : k === "cep" ? fmtCep(v) : v);
      }
    }
    if (secoes.has("fiscal")) {
      const fi = nota.fiscal;
      definir("cod_servico_padrao", fi.cod_servico_padrao);
      if (fi.aliquota_iss) definir("aliquota_pct", (Number(fi.aliquota_iss) * 100).toFixed(2).replace(".", ","));
      definir("serie_rps", fi.serie_rps);
      definir("prox_rps", fi.prox_rps);
      definir("regime", fi.regime);
    }
    const temParametros = secoes.has("parametros") && Object.keys(nota.parametros).length > 0;
    setParamsPendentes(temParametros ? nota.parametros : null);
    requestAnimationFrame(() => destacarCampos(document.getElementById("form-emissora"), mudou));
    toast.success(
      `${mudou.length} campo(s) preenchido(s) a partir da nota` + (temParametros ? " · parâmetros IBS/CBS prontos para salvar" : ""),
    );
  };

  // CNPJ digitado → busca na Receita e preenche só o que está vazio
  const preencherPorCnpj = async (valor: string) => {
    const d = await cnpj.buscar(valor);
    if (!d) return;
    const mudou = preencherVazios(
      f.getValues() as Record<string, unknown>,
      {
        razao_social: d.razao_social, nome_fantasia: d.nome_fantasia, logradouro: d.logradouro, numero: d.numero,
        complemento: d.complemento, bairro: d.bairro, cidade: d.cidade, uf: d.uf, cep: d.cep ? fmtCep(d.cep) : null,
        telefone: d.telefone, email: d.email,
      },
      (campo, v) => f.setValue(campo as keyof Form, v as never, { shouldDirty: true, shouldValidate: true }),
    );
    // A Receita às vezes não informa a rua (comum em MEI): completa pelo CEP, só no que estiver vazio
    if (d.cep && !f.getValues("logradouro")) {
      const end = await cep.buscar(d.cep);
      if (end) {
        mudou.push(
          ...preencherVazios(
            f.getValues() as Record<string, unknown>,
            { logradouro: end.logradouro, bairro: end.bairro, cidade: end.localidade, uf: end.uf },
            (campo, v) => f.setValue(campo as keyof Form, v as never, { shouldDirty: true, shouldValidate: true }),
          ),
        );
      }
    }
    if (mudou.length) {
      requestAnimationFrame(() => destacarCampos(document.getElementById("form-emissora"), mudou));
      toast.success(`Dados da Receita preenchidos: ${d.razao_social}`);
    }
  };

  // ✨ Preencher com IA (ex.: cartão CNPJ): aplica sem salvar e destaca os campos
  const aplicarIA = (c: Record<string, unknown>) => {
    const campos = ["razao_social", "nome_fantasia", "cnpj", "ccm", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "email", "telefone"] as const;
    const mudou: string[] = [];
    campos.forEach((k) => {
      const v = c[k];
      if (v == null || v === "") return;
      let valor = String(v);
      if (k === "cnpj") valor = documento(valor);
      if (k === "cep") valor = fmtCep(valor);
      f.setValue(k, valor, { shouldDirty: true, shouldValidate: true });
      mudou.push(k);
    });
    requestAnimationFrame(() => destacarCampos(document.getElementById("form-emissora"), mudou));
    return mudou.length;
  };
  useEffect(() => {
    if (open) f.reset(emissora ? paraForm(emissora) : vazio);
  }, [open, emissora, f]);

  const salvar = useMutation({
    mutationFn: (v: z.output<typeof schema>) => {
      const body = {
        ...v,
        cnpj: soDigitos(v.cnpj),
        ccm: soDigitos(v.ccm),
        cep: soDigitos(v.cep) || null,
        email: v.email || null,
        aliquota_iss: (toNum(v.aliquota_pct.replace(",", ".")) / 100).toFixed(4),
        certificado_id: v.certificado_id ? Number(v.certificado_id) : null,
        cod_servico_padrao: v.cod_servico_padrao || null,
        telefone: v.telefone || null,
        banco: v.banco || null,
        agencia: v.agencia || null,
        conta: v.conta || null,
        chave_pix: v.chave_pix?.trim() || null,
      };
      delete (body as Partial<typeof body>).aliquota_pct;
      return emissora
        ? api.put<EmissoraOut>(`/nfse/emissoras/${emissora.id}`, body)
        : api.post<EmissoraOut>("/nfse/emissoras", body);
    },
    onSuccess: async (salva) => {
      toast.success(emissora ? "Emissora atualizada" : "Emissora cadastrada");
      if (paramsPendentes) {
        try {
          await api.post(`/nfse/emissoras/${salva.id}/parametros-padrao`, paramsPendentes);
          toast.success("Parâmetros IBS/CBS da nota configurados como padrão da emissora");
        } catch {
          toast.warning("A emissora foi salva, mas os parâmetros IBS/CBS não. Configure em Parâmetros fiscais.");
        }
        setParamsPendentes(null);
      }
      qc.invalidateQueries();
      onClose();
    },
  });

  const er = f.formState.errors;
  const buscarCep = async () => {
    const r = await cep.buscar(f.getValues("cep") ?? "");
    if (r) {
      f.setValue("logradouro", r.logradouro);
      f.setValue("bairro", r.bairro);
      f.setValue("cidade", r.localidade);
      f.setValue("uf", r.uf);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setParamsPendentes(null);
          onClose();
        }
      }}
      titulo={emissora ? `Editar ${nomeEmissora(emissora)}` : "Nova empresa emissora"}
      formId="form-emissora"
      acaoCabecalho={
        <div className="flex flex-wrap items-center gap-2">
          <LerNotaFiscal aplicar={aplicarNota} />
          <PreencherIA
            endpoint="/ia/preencher/emissora"
            aplicar={aplicarIA}
            descricao="Cole o cartão CNPJ ou outro documento da empresa. Você revisa antes de salvar."
            placeholder="Cole aqui o cartão CNPJ, a ficha cadastral, uma assinatura de e-mail…"
          />
        </div>
      }
      descricao="Quem presta o serviço e emite a nota."
      largura="xl"
      salvando={salvar.isPending}
      onSubmit={f.handleSubmit((v) => salvar.mutate(v as z.output<typeof schema>))}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.watch("ativa")} onCheckedChange={(v) => f.setValue("ativa", v)} /> Ativa
        </label>
      }
    >
      <div className="divide-y">
        {paramsPendentes && (
          <div className="mb-4 rounded-xl border border-brand/30 bg-brand/[0.06] p-3 text-sm">
            <p className="font-medium">Parâmetros IBS/CBS lidos da nota</p>
            <p className="mt-0.5 text-muted-foreground">
              Ao salvar, viram o padrão desta emissora:{" "}
              <span className="num">
                {Object.entries(paramsPendentes)
                  .filter(([k]) => ["nbs", "class_trib", "ind_operacao", "cst_ibscbs"].includes(k))
                  .map(([k, v]) => `${{ nbs: "NBS", class_trib: "cClassTrib", ind_operacao: "cIndOp", cst_ibscbs: "CST" }[k]} ${v}`)
                  .join(" · ")}
              </span>
              . Confira com o contador.
            </p>
          </div>
        )}
        <FormSection titulo="Identificação" descricao="CNPJ e inscrição municipal (CCM) são obrigatórios em SP.">
          <Field label="Razão social" obrigatorio erro={er.razao_social?.message} className="sm:col-span-2">
            <Input {...f.register("razao_social")} />
          </Field>
          <Field label="Nome fantasia">
            <Input {...f.register("nome_fantasia")} />
          </Field>
          <Field label="E-mail" erro={er.email?.message}>
            <Input type="email" {...f.register("email")} />
          </Field>
          <Field label="Telefone">
            <Input {...f.register("telefone")} inputMode="tel" placeholder="(11) 3000-0000" />
          </Field>
          <Field label="CNPJ" obrigatorio erro={er.cnpj?.message}>
            <div className="relative">
              <Input
                {...f.register("cnpj", { onChange: (e) => void preencherPorCnpj(e.target.value) })}
                className="num pr-8"
                placeholder="Digite e buscamos na Receita"
                onBlur={(e) => {
                  f.setValue("cnpj", documento(e.target.value));
                  void preencherPorCnpj(e.target.value);
                }}
              />
              {cnpj.carregando && (
                <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
          </Field>
          <Field label="Inscrição municipal (CCM)" obrigatorio erro={er.ccm?.message}>
            <Input {...f.register("ccm")} className="num" />
          </Field>
        </FormSection>
        <FormSection titulo="Endereço" descricao="Digite o CEP e preenchemos o resto.">
          <Field label="CEP">
            <div className="relative">
              <Input {...f.register("cep")} className="num pr-8" onBlur={buscarCep} />
              {cep.carregando ? (
                <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <MapPin className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
          </Field>
          <Field label="Logradouro">
            <Input {...f.register("logradouro")} />
          </Field>
          <Field label="Número">
            <Input {...f.register("numero")} />
          </Field>
          <Field label="Complemento">
            <Input {...f.register("complemento")} />
          </Field>
          <Field label="Bairro">
            <Input {...f.register("bairro")} />
          </Field>
          <div className="grid grid-cols-[1fr_80px] gap-3">
            <Field label="Cidade">
              <CidadeInput uf={f.watch("uf")} {...f.register("cidade")} />
            </Field>
            <Field label="UF">
              <Input {...f.register("uf")} maxLength={2} className="uppercase" />
            </Field>
          </div>
        </FormSection>
        <FormSection titulo="Dados para pagamento (saem na fatura)" descricao="Impressos na Nota de Honorários; a chave PIX gera o “copia e cola”.">
          <Field label="Banco">
            <Input {...f.register("banco")} placeholder="ex.: 341 — Itaú" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agência">
              <Input {...f.register("agencia")} className="num" />
            </Field>
            <Field label="Conta">
              <Input {...f.register("conta")} className="num" />
            </Field>
          </div>
          <Field label="Chave PIX" className="sm:col-span-2" dica="CNPJ, e-mail, telefone ou chave aleatória.">
            <Input {...f.register("chave_pix")} className="font-mono" />
          </Field>
        </FormSection>
        <FormSection titulo="Fiscal e RPS" descricao="Padrões usados quando o arquivo não traz a informação.">
          <Field label="Regime tributário" dica="Também define o cálculo da Projeção de Impostos.">
            <NativeSelect {...f.register("regime")}>
              {Object.entries(REGIMES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Código de serviço padrão" dica="Item da lista de serviços municipal">
            <Input {...f.register("cod_servico_padrao")} className="num" placeholder="ex.: 03220" />
          </Field>
          <Field label="Alíquota ISS padrão (%)" erro={er.aliquota_pct?.message}>
            <Input {...f.register("aliquota_pct")} className="num" inputMode="decimal" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Série do RPS" erro={er.serie_rps?.message}>
              <Input {...f.register("serie_rps")} className="num uppercase" maxLength={5} />
            </Field>
            <Field label="Próximo nº RPS">
              <Input type="number" {...f.register("prox_rps")} className="num" />
            </Field>
          </div>
          <Field
            label="Certificado vinculado"
            className="sm:col-span-2"
            dica={
              <>
                Gerencie em{" "}
                <Link href="/configuracoes/certificado" className="text-info-ink hover:underline">
                  Configurações › Certificado
                </Link>
              </>
            }
          >
            <NativeSelect {...f.register("certificado_id")}>
              <option value="">— Nenhum —</option>
              {certs.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titular} · válido até {data(c.valido_ate)}
                  {c.ativo ? " · ativo" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FormSection>
      </div>
    </FormDialog>
  );
}

export default function EmissorasPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const emissoras = useEmissoras();
  const [editar, setEditar] = useState<EmissoraOut | null>(null);
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState<EmissoraOut | null>(null);

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    const e = emissoras.data?.find((x) => x.id === id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre o cadastro vindo de um link
    if (e && isAdmin) setEditar(e);
  }, [emissoras.data, isAdmin]);

  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/nfse/emissoras/${id}`),
    onSuccess: () => {
      toast.success("Emissora excluída");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["emissoras"] });
    },
  });

  return (
    <div>
      <PageHeader
        titulo="Empresa emissora"
        descricao="Prestadores que emitem as notas. Preparado para mais de uma empresa."
        icone={Building2}
        migalhas={[{ label: "Configurações", href: "/configuracoes" }, { label: "Empresas emissoras" }]}
        acoes={
          isAdmin && (
            <Button onClick={() => setNovo(true)}>
              <Plus /> Nova emissora
            </Button>
          )
        }
      />
      {emissoras.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : emissoras.data?.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icone={Building2}
            titulo="Nenhuma emissora cadastrada"
            descricao="Cadastre a CFME com CNPJ, CCM e certificado para começar a emitir."
            acao={
              isAdmin && (
                <Button onClick={() => setNovo(true)}>
                  <Plus /> Cadastrar emissora
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {emissoras.data?.map((e, i) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn("card-surface overflow-hidden", !e.ativa && "opacity-70")}
            >
              <div
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 text-sm font-medium",
                  e.saude_ok ? "bg-success/8 text-success-ink" : "bg-danger/8 text-danger-ink",
                )}
              >
                {e.saude_ok ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
                {e.saude_ok ? "Pronta para emitir" : e.saude_msg || "Falta certificado válido"}
                {e.saude_ok && e.saude_msg && <span className="font-normal opacity-80">· {e.saude_msg}</span>}
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold">{nomeEmissora(e)}</h3>
                    {e.nome_fantasia && <p className="truncate text-sm text-muted-foreground">{e.razao_social}</p>}
                  </div>
                  <StatusBadge status={e.ativa ? "ativo" : "descartado"} label={e.ativa ? "Ativa" : "Inativa"} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                  {[
                    ["CNPJ", <Mono key="c">{documento(e.cnpj)}</Mono>],
                    ["CCM", <Mono key="m">{e.ccm}</Mono>],
                    ["Regime", REGIMES[e.regime]],
                    ["Serviço padrão", <Mono key="s">{e.cod_servico_padrao ?? "—"}</Mono>],
                    ["ISS padrão", <Mono key="a">{aliquota(e.aliquota_iss)}</Mono>],
                    ["Chave PIX", <span key="p" className="block truncate font-mono text-xs">{e.chave_pix ?? "—"}</span>],
                    [
                      "Próximo RPS",
                      <Mono key="r">
                        {e.prox_rps} / {e.serie_rps}
                      </Mono>,
                    ],
                  ].map(([l, v]) => (
                    <div key={String(l)}>
                      <dt className="text-xs text-muted-foreground">{l}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="size-3.5" />
                  {[e.logradouro, e.numero, e.bairro, e.cidade && `${e.cidade}/${e.uf}`].filter(Boolean).join(", ") || "Endereço não informado"}
                </p>
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="size-3.5" /> {e.certificado_id ? "Certificado vinculado" : "Sem certificado"}
                  </span>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditar(e)}>
                        <Pencil /> Editar
                      </Button>
                      <Button variant="ghost" size="icon-sm" className="text-danger-ink" onClick={() => setExcluir(e)} aria-label="Excluir">
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <EmissoraForm
        open={novo || !!editar}
        emissora={editar}
        onClose={() => {
          setNovo(false);
          setEditar(null);
        }}
      />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir ${excluir ? nomeEmissora(excluir) : ""}?`}
        descricao="Emissoras com notas emitidas não podem ser excluídas — inative-as."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
