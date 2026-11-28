"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  ContatosEditor,
  contarListas,
  deCliente,
  EnderecosEditor,
  erroListas,
  paraApi,
  TelefonesEditor,
  telefoneVazio,
  type ListasCliente,
} from "@/components/clientes/listas";
import { CidadeInput } from "@/components/mayacorp/cidade-input";
import { EmailChips } from "@/components/mayacorp/email-chips";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCep } from "@/hooks/use-cep";
import { preencherVazios, useCnpj } from "@/hooks/use-cnpj";
import { destacarCampos } from "@/hooks/use-ia";
import { cep as fmtCep, documento } from "@/lib/format";
import type { TomadorOut } from "@/lib/types";
import { docValido, soDigitos } from "@/lib/validacao";

// O cadastro completo do cliente (Cadastros › Clientes). É um formulário só: a tela de Cadastros dos escritórios e
// o admin da MayaCorp (novo cliente e aba Dados da ficha; lá a tela de Cadastros fica fora do menu) usam este mesmo
// estado, os mesmos campos e as mesmas rotas (/nfse/tomadores).

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

const schema = z
  .object({
    tipo: z.enum(["PF", "PJ", "EX"]),
    nome: z.string().min(2, "Obrigatório"),
    cpf_cnpj: z.string().optional(),
    im: z.string().optional(),
    ie: z.string().optional(),
    cep: z.string().optional(),
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().optional(),
    emails: z.array(z.email("E-mail inválido")),
    telefone: z.string().optional(),
    observacoes: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo !== "EX" && v.cpf_cnpj && !docValido(v.cpf_cnpj))
      ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: v.tipo === "PF" ? "CPF inválido" : "CNPJ inválido" });
  });
type Form = z.infer<typeof schema>;
const vazio: Form = {
  tipo: "PJ",
  nome: "",
  cpf_cnpj: "",
  im: "",
  ie: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  emails: [],
  telefone: "",
  observacoes: "",
};

/** O corpo de POST/PUT /nfse/tomadores (o PUT substitui as listas: elas vão sempre, completas). */
export type CorpoCadastro = Omit<Form, "cpf_cnpj" | "cep"> &
  ReturnType<typeof paraApi> & { cpf_cnpj: string | null; cep: string | null; ativo: boolean };

/**
 * Estado do cadastro do cliente: campos, listas (endereços, contatos, telefones), busca do CNPJ na Receita, busca
 * do CEP e "Preencher com IA". `ativo` recarrega o formulário (modal aberto ou ficha na tela); `raiz` é o id do
 * elemento onde os campos preenchidos sozinhos são destacados.
 */
export function useCadastroCliente({
  cliente,
  ativo,
  podeEditar,
  raiz = "form-cliente",
}: {
  cliente: TomadorOut | null;
  ativo: boolean;
  podeEditar: boolean;
  raiz?: string;
}) {
  const cep = useCep();
  const cnpj = useCnpj();
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: vazio });
  const [listas, setListas] = useState<ListasCliente>(() => deCliente(null));
  const [aba, setAba] = useState("dados");
  const setLista = <K extends keyof ListasCliente>(k: K, v: ListasCliente[K]) => setListas((o) => ({ ...o, [k]: v }));
  // telefone vindo da Receita ou da IA entra na lista só se ela estiver vazia
  const sugerirTelefone = (numero: string | null | undefined) => {
    if (!numero || listas.telefones.length) return false;
    setListas((o) => (o.telefones.length ? o : { ...o, telefones: [telefoneVazio(numero)] }));
    return true;
  };

  // CNPJ digitado → busca na Receita e preenche só o que está vazio
  const preencherPorCnpj = async (valor: string) => {
    if (f.getValues("tipo") !== "PJ") return;
    const d = await cnpj.buscar(valor);
    if (!d) return;
    const mudou = preencherVazios(
      f.getValues() as Record<string, unknown>,
      {
        nome: d.razao_social, logradouro: d.logradouro, numero: d.numero, complemento: d.complemento,
        bairro: d.bairro, cidade: d.cidade, uf: d.uf, cep: d.cep ? fmtCep(d.cep) : null,
      },
      (campo, v) => f.setValue(campo as keyof Form, v as never, { shouldDirty: true, shouldValidate: true }),
    );
    if (sugerirTelefone(d.telefone)) mudou.push("telefones");
    const emails = f.getValues("emails");
    if (d.email && !emails.includes(d.email)) {
      f.setValue("emails", [...emails, d.email], { shouldDirty: true, shouldValidate: true });
      mudou.push("emails");
    }
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
      requestAnimationFrame(() => destacarCampos(document.getElementById(raiz), mudou));
      toast.success(`Dados da Receita preenchidos: ${d.razao_social}`);
    }
  };

  // ✨ Preencher com IA: aplica no formulário (sem salvar) e destaca o que mudou
  const aplicarIA = (c: Record<string, unknown>) => {
    const textos = ["tipo", "nome", "cpf_cnpj", "im", "ie", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "observacoes"] as const;
    const mudou: string[] = [];
    textos.forEach((k) => {
      const v = c[k];
      if (v == null || v === "") return;
      let valor = String(v);
      if (k === "cpf_cnpj") valor = documento(valor);
      if (k === "cep") valor = fmtCep(valor);
      if (k === "tipo" && !["PF", "PJ", "EX"].includes(valor)) return;
      f.setValue(k, valor as never, { shouldDirty: true, shouldValidate: true });
      mudou.push(k);
    });
    if (typeof c.telefone === "string" && sugerirTelefone(c.telefone)) mudou.push("telefones");
    if (Array.isArray(c.emails) && c.emails.length) {
      f.setValue("emails", [...new Set([...f.getValues("emails"), ...(c.emails as string[])])], { shouldDirty: true, shouldValidate: true });
      mudou.push("emails");
    }
    requestAnimationFrame(() => destacarCampos(document.getElementById(raiz), mudou));
    return mudou.length;
  };
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir ou ao trocar de cliente */
  useEffect(() => {
    if (!ativo) return;
    f.reset(
      cliente
        ? ({
            ...vazio,
            ...Object.fromEntries(Object.entries(cliente).map(([k, v]) => [k, v ?? ""])),
            cpf_cnpj: documento(cliente.cpf_cnpj) === "—" ? "" : documento(cliente.cpf_cnpj),
            cep: fmtCep(cliente.cep),
            emails: cliente.emails ?? [],
            tipo: cliente.tipo,
          } as Form)
        : vazio,
    );
    setListas(deCliente(cliente));
    setAba("dados");
  }, [ativo, cliente, f]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const buscarCep = async () => {
    const r = await cep.buscar(f.getValues("cep") ?? "");
    if (r) {
      f.setValue("logradouro", r.logradouro);
      f.setValue("bairro", r.bairro);
      f.setValue("cidade", r.localidade);
      f.setValue("uf", r.uf);
    }
  };

  const corpo = (v: Form): CorpoCadastro => ({
    ...v,
    cpf_cnpj: soDigitos(v.cpf_cnpj) || null,
    cep: soDigitos(v.cep) || null,
    ...paraApi(listas),
    ativo: cliente?.ativo ?? true,
  });

  /** Valida os campos e as listas (abrindo a aba do problema) e entrega o corpo pronto para a API. */
  const aoEnviar = (salvar: (corpo: CorpoCadastro) => void) =>
    f.handleSubmit(
      (v) => {
        const erro = erroListas(listas);
        if (erro) {
          setAba(erro.aba);
          toast.error(erro.msg);
          return;
        }
        salvar(corpo(v));
      },
      () => setAba("dados"),
    );

  return { f, listas, setLista, aba, setAba, cep, cnpj, preencherPorCnpj, aplicarIA, buscarCep, aoEnviar, podeEditar };
}

export type CadastroCliente = ReturnType<typeof useCadastroCliente>;

/** Aba "Dados": identificação, e-mails e o endereço principal (o que vai na nota). */
function CadastroDados({ cad, dicaEmails }: { cad: CadastroCliente; dicaEmails?: React.ReactNode }) {
  const { f, cep, cnpj, preencherPorCnpj, buscarCep, podeEditar } = cad;
  const er = f.formState.errors;
  const tipo = f.watch("tipo");
  return (
    <fieldset disabled={!podeEditar} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="Tipo" className="sm:col-span-2">
        <NativeSelect {...f.register("tipo")}>
          <option value="PJ">Pessoa jurídica</option>
          <option value="PF">Pessoa física</option>
          <option value="EX">Exterior</option>
        </NativeSelect>
      </Field>
      <Field label={tipo === "PF" ? "CPF" : tipo === "PJ" ? "CNPJ" : "Documento"} erro={er.cpf_cnpj?.message} className="sm:col-span-4">
        <div className="relative">
          <Input
            {...f.register("cpf_cnpj", { onChange: (e) => void preencherPorCnpj(e.target.value) })}
            className="num pr-8"
            placeholder={tipo === "PJ" ? "Digite o CNPJ e buscamos na Receita" : undefined}
            onBlur={(e) => {
              f.setValue("cpf_cnpj", documento(e.target.value) === "—" ? "" : documento(e.target.value));
              void preencherPorCnpj(e.target.value);
            }}
          />
          {cnpj.carregando && (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </Field>
      <Field label={tipo === "PF" ? "Nome" : "Razão social"} obrigatorio erro={er.nome?.message} className="sm:col-span-6">
        <Input {...f.register("nome")} />
      </Field>
      <Field label="Inscrição municipal" className="sm:col-span-3">
        <Input {...f.register("im")} className="num" />
      </Field>
      <Field label="Inscrição estadual" className="sm:col-span-3">
        <Input {...f.register("ie")} className="num" />
      </Field>
      <Field label="E-mails para envio da nota" className="sm:col-span-6" erro={er.emails?.message ?? er.emails?.[0]?.message} dica={dicaEmails}>
        <EmailChips campo="emails" value={f.watch("emails")} onChange={(v) => f.setValue("emails", v, { shouldValidate: true })} />
      </Field>
      <div className="flex items-center gap-2 border-t pt-4 sm:col-span-6">
        <span className="grid size-7 place-items-center rounded-lg bg-brand/10 text-info-ink">
          <MapPin className="size-3.5" />
        </span>
        <p className="text-sm font-semibold">Endereço principal</p>
        <span className="text-xs text-muted-foreground">vai na nota fiscal · outros endereços na aba Endereços</span>
      </div>
      <Field label="CEP" className="sm:col-span-2">
        <div className="relative">
          <Input {...f.register("cep")} className="num pr-8" onBlur={buscarCep} />
          {cep.carregando ? (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <MapPin className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
        </div>
      </Field>
      <Field label="Logradouro" className="sm:col-span-3">
        <Input {...f.register("logradouro")} />
      </Field>
      <Field label="Número" className="sm:col-span-1">
        <Input {...f.register("numero")} />
      </Field>
      <Field label="Complemento" className="sm:col-span-2">
        <Input {...f.register("complemento")} />
      </Field>
      <Field label="Bairro" className="sm:col-span-2">
        <Input {...f.register("bairro")} />
      </Field>
      <Field label="Cidade" className="sm:col-span-3">
        <CidadeInput uf={f.watch("uf")} {...f.register("cidade")} />
      </Field>
      <Field label="UF" className="sm:col-span-1">
        <NativeSelect {...f.register("uf")}>
          <option value="">—</option>
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Observações" className="sm:col-span-6">
        <Textarea rows={2} {...f.register("observacoes")} />
      </Field>
    </fieldset>
  );
}

/**
 * As abas do cadastro: Dados | Endereços | Contatos | Telefones, mais as que a tela quiser acrescentar (`gatilhos`
 * são os botões das abas extras e `children` os conteúdos delas).
 */
export function CadastroAbas({
  cad,
  gatilhos,
  children,
  dicaEmails,
  rotuloDados = "Dados",
}: {
  cad: CadastroCliente;
  gatilhos?: React.ReactNode;
  children?: React.ReactNode;
  dicaEmails?: React.ReactNode;
  /** Nome da 1ª aba, para quando o formulário já está dentro de uma aba "Dados". */
  rotuloDados?: string;
}) {
  const { f, listas, setLista, aba, setAba, podeEditar } = cad;
  const qtd = contarListas(listas);
  return (
    <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
      {/* contain: a fila de abas rola dentro da própria largura, sem alargar o modal no celular */}
      <div className="-mx-1 mb-4 overflow-x-auto px-1 [contain:inline-size]">
        <TabsList>
          <TabsTrigger value="dados">{rotuloDados}</TabsTrigger>
          {(
            [
              ["enderecos", "Endereços", qtd.enderecos],
              ["contatos", "Contatos", qtd.contatos],
              ["telefones", "Telefones", qtd.telefones],
            ] as const
          ).map(([v, l, n]) => (
            <TabsTrigger key={v} value={v}>
              {l}
              {n > 0 && <span className="rounded-full bg-brand/12 px-1.5 text-[11px] font-semibold text-info-ink tabular-nums">{n}</span>}
            </TabsTrigger>
          ))}
          {gatilhos}
        </TabsList>
      </div>
      <TabsContent value="dados">
        <CadastroDados cad={cad} dicaEmails={dicaEmails} />
      </TabsContent>
      <TabsContent value="enderecos">
        <EnderecosEditor
          lista={listas.enderecos}
          onChange={(l) => setLista("enderecos", l)}
          podeEditar={podeEditar}
          principal={() => {
            const v = f.getValues();
            return { cep: v.cep ?? "", logradouro: v.logradouro ?? "", numero: v.numero ?? "", complemento: v.complemento ?? "", bairro: v.bairro ?? "", cidade: v.cidade ?? "", uf: v.uf ?? "" };
          }}
        />
      </TabsContent>
      <TabsContent value="contatos">
        <ContatosEditor lista={listas.contatos} onChange={(l) => setLista("contatos", l)} podeEditar={podeEditar} />
      </TabsContent>
      <TabsContent value="telefones">
        <TelefonesEditor lista={listas.telefones} onChange={(l) => setLista("telefones", l)} podeEditar={podeEditar} />
      </TabsContent>
      {children}
    </Tabs>
  );
}
