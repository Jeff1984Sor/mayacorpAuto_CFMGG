"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotaoIAAdmin } from "@/components/admin/ia";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type ClienteNovoIn,
  type ClienteSaaS,
  type FichaIn,
  fichaDe,
  type PlanoOut,
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

/** Novo cliente (cria o ambiente e envia o convite) ou edição da ficha comercial. */
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
  const [dominio, setDominio] = useState("");
  const [colado, setColado] = useState("");
  const [buscando, setBuscando] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      cliente ? { ...vazio(), ...fichaDe(cliente), dias_teste: null } : vazio(),
    );
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
      };
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

  const outros = (clientes.data ?? []).filter((c) => c.id !== cliente?.id);

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

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={cliente ? `Ficha de ${cliente.nome}` : "Novo cliente MayaJus"}
      descricao={
        cliente
          ? "Dados comerciais, plano e contrato."
          : "Cria o ambiente (com o usuário Suporte) e envia as boas-vindas: o cliente cria o próprio usuário master pelo link."
      }
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={cliente ? "Salvar" : "Criar ambiente"}
      onSubmit={(e) => {
        e.preventDefault();
        if (f.nome.trim().length < 2)
          return toast.error("Informe o nome do escritório.");
        if (!cliente && !f.admin_email.trim())
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
          label="Escritório"
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
          dica="Recebe contratos e cobranças."
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

        {!cliente && (
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
