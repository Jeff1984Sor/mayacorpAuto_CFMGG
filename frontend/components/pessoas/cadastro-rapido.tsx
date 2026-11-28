"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { type AdvogadoRapidoIn, type AdvogadoResumo, mascaraDocumento, type PessoaIn, type PessoaOut, type PessoaResumo, type TipoPessoa, TIPOS_PESSOA, UFS } from "@/lib/pessoas";
import { cnpjValido, cpfValido } from "@/lib/validacao";

import { LinhaPessoa } from "./comum";

const digitos = (v: string) => v.replace(/\D/g, "");

/** O que o tipo de pessoa pede de documento (igual à regra do servidor). */
export function erroDocumento(tipo: TipoPessoa, doc: string, advogadoComOab = false): string | null {
  const d = digitos(doc);
  if (tipo === "sem_documento") return d ? "Pessoa “sem documento” não leva CPF/CNPJ: escolha pessoa física ou jurídica." : null;
  if (!d) {
    if (tipo === "fisica" && !advogadoComOab) return "Informe o CPF (ou cadastre como “sem documento”).";
    if (tipo === "juridica") return "Informe o CNPJ (ou cadastre como “sem documento”).";
    return null;
  }
  if (tipo === "fisica") return d.length !== 11 ? "Pessoa física precisa de CPF (11 dígitos)." : cpfValido(d) ? null : "CPF inválido: confira os dígitos.";
  if (tipo === "juridica" || tipo === "ente_publico") return d.length !== 14 ? "Informe o CNPJ com 14 dígitos." : cnpjValido(d) ? null : "CNPJ inválido: confira os dígitos.";
  if (d.length === 11) return cpfValido(d) ? null : "CPF inválido: confira os dígitos.";
  if (d.length === 14) return cnpjValido(d) ? null : "CNPJ inválido: confira os dígitos.";
  return "CPF tem 11 dígitos e CNPJ tem 14.";
}

export const rotuloDocumento = (tipo: TipoPessoa) => (tipo === "fisica" ? "CPF" : tipo === "juridica" || tipo === "ente_publico" ? "CNPJ" : "CPF ou CNPJ");

/**
 * Cadastro rápido de pessoa (tipo, nome, documento, e-mail, telefone). Se o CPF/CNPJ já está no cadastro, nada é
 * criado: a tela mostra a pessoa que já existia e oferece "Usar esta".
 */
export function PessoaRapida({
  nomeInicial = "",
  onPronta,
  onCancelar,
}: {
  nomeInicial?: string;
  onPronta: (p: PessoaResumo) => void;
  onCancelar: () => void;
}) {
  const qc = useQueryClient();
  const soNumeros = /^[\d.\-/\s]+$/.test(nomeInicial) && digitos(nomeInicial).length >= 11;
  const [tipo, setTipo] = useState<TipoPessoa>(digitos(nomeInicial).length === 14 && soNumeros ? "juridica" : "fisica");
  const [nome, setNome] = useState(soNumeros ? "" : nomeInicial);
  const [doc, setDoc] = useState(soNumeros ? mascaraDocumento(nomeInicial) : "");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [existente, setExistente] = useState<PessoaOut | null>(null);
  const criar = useMutation({
    mutationFn: () => {
      const corpo: Partial<PessoaIn> = {
        tipo_pessoa: tipo,
        nome: nome.trim(),
        cpf_cnpj: digitos(doc) || null,
        email: email.trim() || null,
        telefones: telefone.trim() ? [telefone.trim()] : [],
      };
      return api.post<PessoaOut>("/pessoas", corpo);
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["pessoas"] });
      if (p.ja_existia) return setExistente(p);
      toast.success(`${p.nome} entrou no cadastro de pessoas`);
      onPronta(p);
    },
  });
  const enviar = () => {
    if (nome.trim().length < 2) return toast.error("Informe o nome.");
    const erro = erroDocumento(tipo, doc);
    if (erro) return toast.error(erro);
    criar.mutate();
  };

  if (existente)
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/8 p-3">
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <UserCheck className="size-4 text-warning-ink" /> Já cadastrada
        </p>
        <p className="mb-2 text-sm text-muted-foreground">Este CPF/CNPJ já está no cadastro de pessoas. Nenhuma pessoa nova foi criada.</p>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <LinhaPessoa p={existente} />
          <Button type="button" size="sm" onClick={() => onPronta(existente)}>
            Usar esta
          </Button>
        </div>
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={() => setExistente(null)}>
            Voltar ao cadastro
          </Button>
        </div>
      </div>
    );

  return (
    <div
      className="rounded-xl border bg-muted/25 p-3"
      onKeyDown={(e) => {
        // dentro de outro formulário: Enter cadastra a pessoa, não salva o de fora
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          enviar();
        }
      }}
    >
      <p className="mb-3 flex items-center gap-2 text-sm font-medium">
        <UserPlus className="size-4 text-info-ink" /> Cadastrar nova pessoa
      </p>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Tipo" htmlFor="pr-tipo" className="sm:col-span-2">
          <NativeSelect id="pr-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPessoa)}>
            {TIPOS_PESSOA.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tipo === "fisica" ? "Nome completo" : "Nome / razão social"} obrigatorio htmlFor="pr-nome" className="sm:col-span-4">
          <Input id="pr-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
        {tipo !== "sem_documento" && (
          <Field label={rotuloDocumento(tipo)} obrigatorio={tipo === "fisica" || tipo === "juridica"} htmlFor="pr-doc" className="sm:col-span-2">
            <Input id="pr-doc" value={doc} inputMode="numeric" className="font-mono" onChange={(e) => setDoc(mascaraDocumento(e.target.value))} />
          </Field>
        )}
        <Field label="E-mail" htmlFor="pr-email" className={tipo === "sem_documento" ? "sm:col-span-3" : "sm:col-span-2"}>
          <Input id="pr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Telefone" htmlFor="pr-tel" className={tipo === "sem_documento" ? "sm:col-span-3" : "sm:col-span-2"}>
          <Input id="pr-tel" value={telefone} inputMode="tel" onChange={(e) => setTelefone(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">O restante (endereços, contatos, dados de advogado) é completado depois em Cadastros › Pessoas.</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="button" size="sm" disabled={criar.isPending} onClick={enviar}>
          {criar.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Cadastrar
        </Button>
      </div>
    </div>
  );
}

/** Cadastro rápido do advogado de uma parte: nome + OAB + UF. Com a OAB já no cadastro, devolve o advogado que já existia. */
export function AdvogadoRapido({
  textoInicial = "",
  onPronto,
  onCancelar,
}: {
  textoInicial?: string;
  onPronto: (a: AdvogadoResumo) => void;
  onCancelar: () => void;
}) {
  const qc = useQueryClient();
  // "123456/SP" já digitado na busca vira número e UF
  const lida = /^\s*(?:OAB\s*\/?\s*)?([A-Za-z]{2})?\s*([\d.]+-?[A-Za-z]?)\s*\/?\s*([A-Za-z]{2})?\s*$/.exec(textoInicial);
  const [nome, setNome] = useState(lida ? "" : textoInicial);
  const [numero, setNumero] = useState(lida ? lida[2].replace(/\./g, "") : "");
  const [uf, setUf] = useState((lida?.[3] ?? lida?.[1] ?? "").toUpperCase());
  const criar = useMutation({
    mutationFn: () => api.post<AdvogadoResumo>("/advogados", { nome: nome.trim(), oab_numero: numero.trim(), oab_uf: uf } satisfies AdvogadoRapidoIn),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ["pessoas"] });
      if (a.ja_existia) toast.info(`Esta OAB já está no cadastro: ${a.nome}. Foi usado o advogado que já existia.`);
      else toast.success(`${a.nome} entrou no cadastro de pessoas`);
      onPronto(a);
    },
  });
  const enviar = () => {
    if (nome.trim().length < 2) return toast.error("Informe o nome do advogado.");
    if (!numero.trim() || !uf) return toast.error("Informe o número e a UF da OAB.");
    criar.mutate();
  };
  return (
    <div
      className="rounded-xl border bg-muted/25 p-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          enviar();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Nome do advogado" obrigatorio htmlFor="ar-nome" className="sm:col-span-3">
          <Input id="ar-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
        </Field>
        <Field label="Nº da OAB" obrigatorio htmlFor="ar-oab" className="sm:col-span-2">
          <Input id="ar-oab" value={numero} maxLength={12} className="font-mono" onChange={(e) => setNumero(e.target.value.replace(/[^\dA-Za-z-]/g, ""))} />
        </Field>
        <Field label="UF" obrigatorio htmlFor="ar-uf" className="sm:col-span-1">
          <NativeSelect id="ar-uf" value={uf} onChange={(e) => setUf(e.target.value)}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="button" size="sm" disabled={criar.isPending} onClick={enviar}>
          {criar.isPending ? <Loader2 className="animate-spin" /> : <UserPlus />} Cadastrar advogado
        </Button>
      </div>
    </div>
  );
}
