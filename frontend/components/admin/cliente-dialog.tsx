"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  HandCoins,
  Loader2,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotaoIAAdmin } from "@/components/admin/ia";
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
import { Textarea } from "@/components/ui/textarea";
import {
  type ClienteNovoIn,
  type ClienteSaaS,
  type FichaIn,
  fichaDe,
  type PlanoOut,
  type Rotulo,
  type TipoCliente,
} from "@/lib/admin";
import { api } from "@/lib/api";
import { moeda } from "@/lib/format";

const vazio = (): ClienteNovoIn => ({
  nome: "",
  documento: null,
  responsavel: null,
  email_financeiro: null,
  telefone: null,
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
      "Cliente de outro serviço da MayaCorp: só a ficha, para cobrar e emitir a nota. Não cria ambiente nem login.",
  },
];

/** Novo cliente (com acesso: cria o ambiente e envia o convite; sem acesso: só a ficha) ou edição da ficha. */
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
  const [f, setF] = useState<ClienteNovoIn>(vazio);
  // cliente novo começa pela escolha do tipo (null); na edição o tipo é o do cliente
  const [tipo, setTipo] = useState<TipoCliente | null>(null);
  const externo = tipo === "externo";
  const [dominio, setDominio] = useState("");
  const [colado, setColado] = useState("");
  const [buscando, setBuscando] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      cliente ? { ...vazio(), ...fichaDe(cliente), dias_teste: null } : vazio(),
    );
    setTipo(cliente ? cliente.tipo : null);
    setDominio("");
    setColado("");
  }, [open, cliente]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof ClienteNovoIn>(k: K, v: ClienteNovoIn[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const plano = planos.data?.find((p) => p.id === f.plano_id);

  const salvar = useMutation({
    mutationFn: () => {
      const ficha: FichaIn = {
        nome: f.nome.trim(),
        documento: nulo(f.documento),
        responsavel: nulo(f.responsavel),
        email_financeiro: nulo(f.email_financeiro),
        telefone: nulo(f.telefone),
        plano_id: f.plano_id,
        ciclo: f.ciclo,
        inicio_contrato: f.inicio_contrato,
        teste_ate: f.teste_ate,
        observacao: nulo(f.observacao),
        indicado_por_id: f.indicado_por_id,
        robos: f.robos ?? [],
      };
      if (externo && !cliente)
        return api.post<ClienteSaaS>("/admin/clientes/externo", {
          nome: ficha.nome,
          documento: ficha.documento,
          responsavel: ficha.responsavel,
          email_financeiro: ficha.email_financeiro,
          telefone: ficha.telefone,
          observacao: ficha.observacao,
        });
      return cliente
        ? api.put<ClienteSaaS>(`/admin/clientes/${cliente.id}`, ficha)
        : api.post<ClienteSaaS>("/admin/clientes", {
            ...ficha,
            slug: nulo(f.slug),
            admin_nome: f.admin_nome.trim(),
            admin_email: f.admin_email.trim(),
            dias_teste: f.dias_teste || null,
            dominios: dominio.trim() ? [dominio.trim()] : [],
          });
    },
    onSuccess: (c) => {
      if (cliente) toast.success("Ficha atualizada");
      else if (externo)
        toast.success(`${c.nome} cadastrado, sem acesso ao sistema.`, {
          description:
            "Para cobrar, crie uma cobrança recorrente ou avulsa na aba Cobranças.",
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

  const buscarCnpj = async () => {
    const dig = (f.documento ?? "").replace(/\D/g, "");
    if (dig.length !== 14)
      return toast.error("Digite o CNPJ (14 números) para buscar.");
    setBuscando(true);
    try {
      const r = await api.get<{
        razao_social: string | null;
        nome_fantasia: string | null;
        telefone: string | null;
        email: string | null;
      }>(`/cnpj/${dig}`);
      setF((o) => ({
        ...o,
        documento: dig,
        nome: o.nome.trim() ? o.nome : r.nome_fantasia || r.razao_social || "",
        telefone: o.telefone || r.telefone,
        email_financeiro: o.email_financeiro || r.email,
      }));
      toast.success(`Encontrado: ${r.razao_social ?? r.nome_fantasia}`);
    } finally {
      setBuscando(false);
    }
  };

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

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={
        cliente
          ? `Ficha de ${cliente.nome}`
          : externo
            ? "Novo cliente sem acesso ao sistema"
            : "Novo cliente MayaJus"
      }
      descricao={
        externo
          ? "Só a ficha: o necessário para cobrar e emitir a nota. Não cria ambiente, login nem período de teste."
          : cliente
            ? "Dados comerciais, plano e contrato."
            : "Cria o ambiente (com o usuário Suporte) e envia as boas-vindas: o cliente cria o próprio usuário master pelo link."
      }
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={
        cliente ? "Salvar" : externo ? "Cadastrar cliente" : "Criar ambiente"
      }
      rodapeExtra={
        !cliente && (
          <Button type="button" variant="ghost" onClick={() => setTipo(null)}>
            <ArrowLeft /> Trocar o tipo
          </Button>
        )
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (f.nome.trim().length < 2)
          return toast.error(
            externo
              ? "Informe o nome ou a razão social."
              : "Informe o nome do escritório.",
          );
        if (!cliente && !externo && !f.admin_email.trim())
          return toast.error("Informe o e-mail que recebe as boas-vindas.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-dashed p-3 sm:col-span-2">
          <Textarea
            aria-label="Texto para a IA preencher a ficha"
            rows={2}
            value={colado}
            onChange={(e) => setColado(e.target.value)}
            placeholder="Cole aqui o cartão CNPJ, um e-mail ou a assinatura do cliente…"
            className="text-xs"
          />
          <BotaoIAAdmin<{ campos: Partial<FichaIn> }, ClienteNovoIn>
            rota="/admin/ia/ficha"
            rotulo="Preencher com IA"
            corpo={() => ({ texto: colado })}
            atual={f}
            aplicar={(r) => {
              if (!Object.keys(r.campos).length)
                return void toast.info("A IA não achou dados no texto.");
              setF((o) => ({ ...o, ...r.campos }));
            }}
            restaurar={setF}
          />
        </div>
        <Field
          label={externo ? "Nome ou razão social" : "Escritório"}
          obrigatorio
          htmlFor="cli-nome"
          className="sm:col-span-2"
        >
          <Input
            id="cli-nome"
            value={f.nome}
            onChange={(e) => set("nome", e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="CNPJ / CPF" htmlFor="cli-doc">
          <div className="flex gap-2">
            <Input
              id="cli-doc"
              value={f.documento ?? ""}
              onChange={(e) => set("documento", e.target.value)}
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              disabled={buscando}
              onClick={buscarCnpj}
            >
              {buscando ? <Loader2 className="animate-spin" /> : <Search />}{" "}
              Receita
            </Button>
          </div>
        </Field>
        <Field label="Responsável" htmlFor="cli-resp">
          <Input
            id="cli-resp"
            value={f.responsavel ?? ""}
            onChange={(e) => set("responsavel", e.target.value)}
          />
        </Field>
        <Field
          label="E-mail do financeiro"
          htmlFor="cli-email"
          dica={
            externo
              ? "Recebe as cobranças e a nota. Sem ele a cobrança é gerada, mas não é enviada."
              : "Recebe contratos e cobranças."
          }
        >
          <Input
            id="cli-email"
            type="email"
            value={f.email_financeiro ?? ""}
            onChange={(e) => set("email_financeiro", e.target.value)}
          />
        </Field>
        <Field label="Telefone" htmlFor="cli-tel">
          <Input
            id="cli-tel"
            value={f.telefone ?? ""}
            onChange={(e) => set("telefone", e.target.value)}
          />
        </Field>

        {!externo && (
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
            onChange={(e) => set("ciclo", e.target.value as FichaIn["ciclo"])}
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
                set(
                  "dias_teste",
                  e.target.value ? Number(e.target.value) : null,
                )
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
        )}

        {!cliente && !externo && (
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
              dica="Recebe o link para criar o usuário master."
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
        )}
        <Field label="Observação" htmlFor="cli-obs" className="sm:col-span-2">
          <Textarea
            id="cli-obs"
            rows={2}
            value={f.observacao ?? ""}
            onChange={(e) => set("observacao", e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}
