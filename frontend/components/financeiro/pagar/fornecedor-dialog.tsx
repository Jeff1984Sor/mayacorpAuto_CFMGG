"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCnpj } from "@/hooks/use-cnpj";
import { api } from "@/lib/api";
import type { FornecedorIn, FornecedorOut } from "@/lib/financeiro";

import { useCategoriasFin } from "../comum";

const dig = (v: string) => v.replace(/\D/g, "");
export function mascaraDoc(v: string, tipo: "PF" | "PJ") {
  const d = dig(v).slice(0, tipo === "PF" ? 11 : 14);
  if (tipo === "PF") return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

const vazio = (nome = ""): FornecedorIn => ({
  nome,
  tipo: "PJ",
  cpf_cnpj: "",
  email: "",
  telefone: "",
  chave_pix: "",
  banco: "",
  agencia: "",
  conta: "",
  categoria_padrao_id: null,
  observacao: "",
  ativo: true,
});

/** Cadastro de fornecedor (tela de Fornecedores e atalho "+ novo fornecedor"). */
export function FornecedorDialog({
  open,
  onOpenChange,
  fornecedor,
  nomeInicial,
  onSalvo,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fornecedor?: FornecedorOut | null;
  nomeInicial?: string;
  onSalvo?: (f: FornecedorOut) => void;
}) {
  const qc = useQueryClient();
  const cnpj = useCnpj();
  const cats = useCategoriasFin("despesa");
  const [f, setF] = useState<FornecedorIn>(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (!open) return;
    setF(
      fornecedor
        ? {
            ...fornecedor,
            cpf_cnpj: fornecedor.cpf_cnpj ? mascaraDoc(fornecedor.cpf_cnpj, fornecedor.tipo) : "",
            email: fornecedor.email ?? "",
            telefone: fornecedor.telefone ?? "",
            chave_pix: fornecedor.chave_pix ?? "",
            banco: fornecedor.banco ?? "",
            agencia: fornecedor.agencia ?? "",
            conta: fornecedor.conta ?? "",
            observacao: fornecedor.observacao ?? "",
          }
        : vazio(nomeInicial ?? ""),
    );
  }, [open, fornecedor, nomeInicial]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof FornecedorIn>(k: K, v: FornecedorIn[K]) => setF((o) => ({ ...o, [k]: v }));
  const preencher = async (valor: string) => {
    if (f.tipo !== "PJ") return;
    const d = await cnpj.buscar(valor);
    if (!d) return;
    setF((o) => ({
      ...o,
      nome: o.nome.trim() ? o.nome : (d.nome_fantasia || d.razao_social || ""),
      email: o.email || d.email || "",
      telefone: o.telefone || d.telefone || "",
    }));
    toast.success("Dados preenchidos pela Receita Federal");
  };
  const salvar = useMutation({
    mutationFn: () => {
      const n = (s: string | null) => (s && s.trim() ? s.trim() : null);
      const body: FornecedorIn = {
        ...f,
        nome: f.nome.trim(),
        cpf_cnpj: dig(f.cpf_cnpj ?? "") || null,
        email: n(f.email),
        telefone: n(f.telefone),
        chave_pix: n(f.chave_pix),
        banco: n(f.banco),
        agencia: n(f.agencia),
        conta: n(f.conta),
        observacao: n(f.observacao),
      };
      return fornecedor ? api.put<FornecedorOut>(`/financeiro/fornecedores/${fornecedor.id}`, body) : api.post<FornecedorOut>("/financeiro/fornecedores", body);
    },
    onSuccess: (r) => {
      toast.success(fornecedor ? "Fornecedor atualizado" : `Fornecedor “${r.nome}” cadastrado`);
      qc.invalidateQueries({ queryKey: ["fin"] });
      onSalvo?.(r);
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={fornecedor ? `Editar ${fornecedor.nome}` : "Novo fornecedor"}
      descricao="Quem recebe os pagamentos do escritório. A categoria padrão já vem preenchida nas contas novas."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (f.nome.trim().length < 2) return toast.error("Informe o nome.");
        const d = dig(f.cpf_cnpj ?? "");
        if (d && d.length !== (f.tipo === "PF" ? 11 : 14)) return toast.error(f.tipo === "PF" ? "CPF com 11 dígitos." : "CNPJ com 14 dígitos.");
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", v)} aria-label="Fornecedor ativo" /> Ativo
        </label>
      }
    >
      <div className="grid gap-4 sm:grid-cols-6">
        <Field label="Tipo" htmlFor="forn-tipo" className="sm:col-span-2">
          <NativeSelect
            id="forn-tipo"
            value={f.tipo}
            onChange={(e) => {
              const t = e.target.value as "PF" | "PJ";
              setF((o) => ({ ...o, tipo: t, cpf_cnpj: mascaraDoc(o.cpf_cnpj ?? "", t) }));
            }}
          >
            <option value="PJ">Pessoa jurídica</option>
            <option value="PF">Pessoa física</option>
          </NativeSelect>
        </Field>
        <Field label={f.tipo === "PF" ? "CPF" : "CNPJ"} htmlFor="forn-doc" className="sm:col-span-4" dica={f.tipo === "PJ" ? "Digite o CNPJ: nome, e-mail e telefone vêm da Receita." : undefined}>
          <div className="relative">
            <Input
              id="forn-doc"
              inputMode="numeric"
              value={f.cpf_cnpj ?? ""}
              onChange={(e) => {
                const v = mascaraDoc(e.target.value, f.tipo);
                set("cpf_cnpj", v);
                if (f.tipo === "PJ" && dig(v).length === 14) preencher(v);
              }}
              className="num pr-8"
            />
            {cnpj.carregando && <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
        </Field>
        <Field label="Nome" obrigatorio htmlFor="forn-nome" className="sm:col-span-6">
          <Input id="forn-nome" value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus />
        </Field>
        <Field label="E-mail" htmlFor="forn-email" className="sm:col-span-3">
          <Input id="forn-email" type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Telefone" htmlFor="forn-tel" className="sm:col-span-3">
          <Input id="forn-tel" value={f.telefone ?? ""} onChange={(e) => set("telefone", e.target.value)} />
        </Field>
        <Field label="Chave PIX" htmlFor="forn-pix" className="sm:col-span-6">
          <Input id="forn-pix" value={f.chave_pix ?? ""} onChange={(e) => set("chave_pix", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Banco" htmlFor="forn-banco" className="sm:col-span-2">
          <Input id="forn-banco" value={f.banco ?? ""} onChange={(e) => set("banco", e.target.value)} />
        </Field>
        <Field label="Agência" htmlFor="forn-ag" className="sm:col-span-2">
          <Input id="forn-ag" value={f.agencia ?? ""} onChange={(e) => set("agencia", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Conta" htmlFor="forn-conta" className="sm:col-span-2">
          <Input id="forn-conta" value={f.conta ?? ""} onChange={(e) => set("conta", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Categoria padrão" htmlFor="forn-cat" className="sm:col-span-6" dica="Usada quando você escolhe este fornecedor numa conta a pagar.">
          <NativeSelect id="forn-cat" value={f.categoria_padrao_id ?? ""} onChange={(e) => set("categoria_padrao_id", e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {cats.data
              ?.filter((c) => c.ativo || c.id === f.categoria_padrao_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Observação" htmlFor="forn-obs" className="sm:col-span-6">
          <Textarea id="forn-obs" rows={2} value={f.observacao ?? ""} onChange={(e) => set("observacao", e.target.value)} />
        </Field>
      </div>
    </FormDialog>
  );
}
