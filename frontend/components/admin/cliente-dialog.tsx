"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, ChevronRight, HandCoins } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CadastroAbas, type CorpoCadastro, useCadastroCliente } from "@/components/clientes/cadastro-form";
import { PreencherIA } from "@/components/ia/preencher-ia";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ClienteNovoIn,
  type ClienteSaaS,
  type ComercialIn,
  comercialDe,
  type ExternoIn,
  type PlanoOut,
  type Rotulo,
  type TipoCliente,
} from "@/lib/admin";
import { api } from "@/lib/api";
import { moeda } from "@/lib/format";

/** O que o admin guarda além do cadastro completo: plano, contrato, teste e o acesso do cliente novo. */
type Comercial = Omit<ClienteNovoIn, "cadastro">;

const vazio = (): Comercial => ({
  plano_id: null,
  ciclo: "mensal",
  inicio_contrato: new Date().toLocaleDateString("sv-SE"),
  teste_ate: null,
  observacao: null,
  indicado_por_id: null,
  robos: [],
  slug: null,
  admin_nome: "",
  admin_email: "",
  dias_teste: 15,
  dominios: [],
});

const nulo = (v: string | null) => (v && v.trim() ? v.trim() : null);

/** O 1º e-mail do cadastro é o do financeiro (regra de app/controle/cadastro.py). */
export const DICA_EMAIL_FINANCEIRO =
  "O 1º e-mail é o do financeiro: recebe as cobranças, os contratos e a nota fiscal.";

export function usePlanos() {
  return useQuery({
    queryKey: ["admin", "planos"],
    queryFn: () => api.get<PlanoOut[]>("/admin/planos"),
  });
}

/** As duas formas de ser cliente da MayaCorp: a primeira escolha do "Novo cliente". */
const TIPOS: {
  tipo: TipoCliente;
  icone: typeof Building2;
  titulo: string;
  texto: string;
}[] = [
  {
    tipo: "escritorio",
    icone: Building2,
    titulo: "Usa o MayaJus",
    texto:
      "Escritório com acesso ao sistema: ganha o ambiente, plano, teste grátis e as boas-vindas por e-mail.",
  },
  {
    tipo: "externo",
    icone: HandCoins,
    titulo: "Só cobrança, sem acesso ao sistema",
    texto:
      "Cliente de outro serviço da MayaCorp: só o cadastro, para cobrar e emitir a nota. Não cria ambiente nem login.",
  },
];

/**
 * Novo cliente (o cadastro completo, igual ao de Cadastros › Clientes, mais o plano e o acesso de quem usa o
 * MayaJus) ou, com `cliente`, a edição dos dados comerciais (o cadastro completo é editado na aba Dados da ficha).
 */
export function ClienteDialog({
  open,
  onOpenChange,
  cliente,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cliente?: ClienteSaaS | null;
  onSalvo?: (c: ClienteSaaS) => void;
}) {
  const qc = useQueryClient();
  const planos = usePlanos();
  const clientes = useQuery({
    queryKey: ["admin", "clientes", "todos"],
    queryFn: () => api.get<ClienteSaaS[]>("/admin/clientes"),
    enabled: open,
  });
  const [f, setF] = useState<Comercial>(vazio);
  // cliente novo começa pela escolha do tipo (null); na edição o tipo é o do cliente
  const [tipo, setTipo] = useState<TipoCliente | null>(null);
  const externo = tipo === "externo";
  const [dominio, setDominio] = useState("");
  // o mesmo formulário de Cadastros › Clientes (só no cliente novo; na edição ele fica na aba Dados da ficha)
  const cad = useCadastroCliente({
    cliente: null,
    ativo: open && !cliente,
    podeEditar: true,
    raiz: "form-cliente-admin",
  });

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      cliente
        ? { ...vazio(), ...comercialDe(cliente), dias_teste: null }
        : vazio(),
    );
    setTipo(cliente ? cliente.tipo : null);
    setDominio("");
  }, [open, cliente]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof Comercial>(k: K, v: Comercial[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const plano = planos.data?.find((p) => p.id === f.plano_id);

  const salvar = useMutation({
    mutationFn: (cadastro: CorpoCadastro | null) => {
      const comercial: ComercialIn = {
        plano_id: f.plano_id,
        ciclo: f.ciclo,
        inicio_contrato: f.inicio_contrato,
        teste_ate: f.teste_ate,
        observacao: nulo(f.observacao),
        indicado_por_id: f.indicado_por_id,
        robos: f.robos ?? [],
      };
      if (cliente)
        return api.put<ClienteSaaS>(`/admin/clientes/${cliente.id}`, comercial);
      if (externo) {
        const corpo: ExternoIn = {
          cadastro: cadastro!,
          observacao: comercial.observacao,
        };
        return api.post<ClienteSaaS>("/admin/clientes/externo", corpo);
      }
      const corpo: ClienteNovoIn = {
        ...comercial,
        cadastro: cadastro!,
        slug: nulo(f.slug),
        admin_nome: f.admin_nome.trim(),
        admin_email: f.admin_email.trim(),
        dias_teste: f.dias_teste || null,
        dominios: dominio.trim() ? [dominio.trim()] : [],
      };
      return api.post<ClienteSaaS>("/admin/clientes", corpo);
    },
    onSuccess: (c) => {
      if (cliente) toast.success("Dados comerciais atualizados");
      else if (externo)
        toast.success(`${c.nome} cadastrado, sem acesso ao sistema.`, {
          description:
            "Para cobrar, crie a regra de cobrança na aba Cobranças: ela aparece em Faturamento › Itens a faturar.",
        });
      else
        toast.success(`Ambiente de ${c.nome} criado. Boas-vindas enviadas.`, {
          duration: 20000,
          description:
            "O link vale por 7 dias. Copie se quiser mandar também pelo WhatsApp.",
          action: c.convite
            ? {
                label: "Copiar link",
                onClick: () => navigator.clipboard.writeText(c.convite!),
              }
            : undefined,
        });
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["tomadores"] });
      onSalvo?.(c);
      onOpenChange(false);
    },
  });

  const robos = useQuery({
    queryKey: ["admin", "robos"],
    queryFn: () => api.get<Rotulo[]>("/admin/robos"),
    enabled: open,
  });
  // quem pode ter indicado: só outro cliente que usa o MayaJus
  const outros = (clientes.data ?? []).filter(
    (c) => c.id !== cliente?.id && c.tipo === "escritorio",
  );

  if (!cliente && tipo === null)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">Novo cliente</DialogTitle>
            <DialogDescription>
              Este cliente vai usar o MayaJus ou só precisa ser cobrado?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {TIPOS.map((t) => (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setTipo(t.tipo)}
                className="group flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-brand hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-brand/12 text-info-ink">
                  <t.icone className="size-5" />
                </span>
                <span className="flex items-center gap-1 font-medium">
                  {t.titulo}
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="text-sm text-muted-foreground">{t.texto}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Dá para mudar depois: na ficha, “Dar acesso ao sistema” ou “Tirar o
            acesso”.
          </p>
        </DialogContent>
      </Dialog>
    );

  const planoEContrato = !externo && (
    <>
      <Field
        label="Plano"
        htmlFor="cli-plano"
        dica={
          plano
            ? `${moeda(f.ciclo === "anual" ? plano.preco_anual : plano.preco_mensal)} por ${f.ciclo === "anual" ? "ano" : "mês"}`
            : undefined
        }
      >
        <NativeSelect
          id="cli-plano"
          value={f.plano_id ?? ""}
          onChange={(e) =>
            set("plano_id", e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Sem plano ainda</option>
          {planos.data
            ?.filter((p) => p.ativo || p.id === f.plano_id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label="Cobrança" htmlFor="cli-ciclo">
        <NativeSelect
          id="cli-ciclo"
          value={f.ciclo}
          onChange={(e) => set("ciclo", e.target.value as ComercialIn["ciclo"])}
        >
          <option value="mensal">Mensal</option>
          <option value="anual">Anual (2 meses grátis)</option>
        </NativeSelect>
      </Field>
      <Field label="Início do contrato" htmlFor="cli-inicio">
        <Input
          id="cli-inicio"
          type="date"
          value={f.inicio_contrato ?? ""}
          onChange={(e) => set("inicio_contrato", e.target.value || null)}
        />
      </Field>
      {cliente ? (
        <Field label="Teste grátis até" htmlFor="cli-teste">
          <Input
            id="cli-teste"
            type="date"
            value={f.teste_ate ?? ""}
            onChange={(e) => set("teste_ate", e.target.value || null)}
          />
        </Field>
      ) : (
        <Field
          label="Teste grátis"
          htmlFor="cli-dias"
          dica="Dias; deixe vazio para começar já ativo."
        >
          <Input
            id="cli-dias"
            type="number"
            min={1}
            max={90}
            value={f.dias_teste ?? ""}
            onChange={(e) =>
              set("dias_teste", e.target.value ? Number(e.target.value) : null)
            }
          />
        </Field>
      )}
      <Field
        label="Indicado por"
        htmlFor="cli-indicacao"
        dica="Quem indicou ganha desconto enquanto este cliente estiver ativo."
      >
        <NativeSelect
          id="cli-indicacao"
          value={f.indicado_por_id ?? ""}
          onChange={(e) =>
            set(
              "indicado_por_id",
              e.target.value ? Number(e.target.value) : null,
            )
          }
        >
          <option value="">Ninguém</option>
          {outros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div className="sm:col-span-2">
        <p className="mb-2 text-[13px] text-foreground/80">Robôs liberados</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(robos.data ?? []).map((r) => (
            <label
              key={r.chave}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <Checkbox
                checked={(f.robos ?? []).includes(r.chave)}
                onCheckedChange={(v) =>
                  set(
                    "robos",
                    v
                      ? [...(f.robos ?? []), r.chave]
                      : (f.robos ?? []).filter((x) => x !== r.chave),
                  )
                }
              />
              {r.rotulo}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Robôs feitos sob medida. Gestão, faturamento e financeiro valem para
          todos.
        </p>
      </div>
    </>
  );

  const acesso = !cliente && !externo && (
    <>
      <p className="text-[13px] font-medium text-foreground/80 sm:col-span-2">
        Boas-vindas e acesso
      </p>
      <Field label="Nome de quem recebe" htmlFor="cli-adm-nome">
        <Input
          id="cli-adm-nome"
          value={f.admin_nome}
          onChange={(e) => set("admin_nome", e.target.value)}
        />
      </Field>
      <Field
        label="E-mail das boas-vindas"
        obrigatorio
        htmlFor="cli-adm-email"
        dica="Recebe o link para criar o usuário master. Sem e-mail no cadastro, é também o do financeiro."
      >
        <Input
          id="cli-adm-email"
          type="email"
          value={f.admin_email}
          onChange={(e) => set("admin_email", e.target.value)}
        />
      </Field>
      <Field
        label="Domínio próprio"
        htmlFor="cli-dominio"
        dica="Opcional. Ex.: sistema.escritorio.com.br"
      >
        <Input
          id="cli-dominio"
          value={dominio}
          onChange={(e) => setDominio(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Field
        label="Identificador"
        htmlFor="cli-slug"
        dica="Opcional; gerado pelo nome."
      >
        <Input
          id="cli-slug"
          value={f.slug ?? ""}
          onChange={(e) => set("slug", e.target.value)}
          className="font-mono"
          placeholder="silva-advogados"
        />
      </Field>
    </>
  );

  const comercial = (
    <div className="grid gap-4 sm:grid-cols-2">
      {acesso}
      {planoEContrato}
      <Field
        label="Observação interna"
        htmlFor="cli-obs"
        className="sm:col-span-2"
        dica="Só a MayaCorp vê. Não vai para a nota nem para o cliente."
      >
        <Textarea
          id="cli-obs"
          rows={2}
          value={f.observacao ?? ""}
          onChange={(e) => set("observacao", e.target.value)}
        />
      </Field>
    </div>
  );

  if (cliente)
    return (
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        titulo={`Dados comerciais de ${cliente.nome}`}
        descricao={
          externo
            ? "Só o que é interno da MayaCorp. Nome, CNPJ, endereço, e-mails e contatos ficam no cadastro, na aba Dados."
            : "Plano, contrato, teste e indicação. Nome, CNPJ, endereço, e-mails e contatos ficam no cadastro, na aba Dados."
        }
        largura="lg"
        salvando={salvar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate(null);
        }}
      >
        {comercial}
      </FormDialog>
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={
        externo ? "Novo cliente sem acesso ao sistema" : "Novo cliente MayaJus"
      }
      descricao={
        externo
          ? "O cadastro completo, para cobrar e emitir a nota. Digite o CNPJ: a Receita preenche e você confere. Não cria ambiente, login nem período de teste."
          : "Digite o CNPJ: a Receita preenche o cadastro e você confere. Depois, em Plano e acesso, diga quem recebe as boas-vindas."
      }
      formId="form-cliente-admin"
      acaoCabecalho={
        <PreencherIA endpoint="/ia/preencher/cliente" aplicar={cad.aplicarIA} />
      }
      largura="xl"
      salvando={salvar.isPending}
      rotuloSalvar={externo ? "Cadastrar cliente" : "Criar ambiente"}
      rodapeExtra={
        <Button type="button" variant="ghost" onClick={() => setTipo(null)}>
          <ArrowLeft /> Trocar o tipo
        </Button>
      }
      onSubmit={cad.aoEnviar((cadastro) => {
        if (!externo && !f.admin_email.trim()) {
          cad.setAba("comercial");
          return void toast.error(
            "Informe o e-mail que recebe as boas-vindas.",
          );
        }
        salvar.mutate(cadastro);
      })}
    >
      <CadastroAbas
        cad={cad}
        dicaEmails={DICA_EMAIL_FINANCEIRO}
        gatilhos={
          <TabsTrigger value="comercial">
            {externo ? "Interno" : "Plano e acesso"}
          </TabsTrigger>
        }
      >
        <TabsContent value="comercial">{comercial}</TabsContent>
      </CadastroAbas>
    </FormDialog>
  );
}
