"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DICA_EMAIL_FINANCEIRO } from "@/components/admin/cliente-dialog";
import { CadastroAbas, type CorpoCadastro, useCadastroCliente } from "@/components/clientes/cadastro-form";
import { PreencherIA } from "@/components/ia/preencher-ia";
import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type ClienteSaaS, listarPendencias } from "@/lib/admin";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, moeda } from "@/lib/format";
import type { TomadorOut } from "@/lib/types";

/** Selo da lista: o cadastro não tem tudo o que a nota fiscal exige, com o que falta ao lado. */
export function SeloCadastro({ cli }: { cli: ClienteSaaS }) {
  if (cli.cadastro.completo) return null;
  const falta = listarPendencias(cli.cadastro.pendencias);
  return (
    <p className="mt-1 flex items-center gap-1.5" title={`Para emitir a nota falta: ${falta}`}>
      <Pill tom="warning" className="shrink-0">
        <AlertTriangle className="size-3" /> Cadastro incompleto
      </Pill>
      <span className="truncate text-[11px] text-muted-foreground">falta {falta}</span>
    </p>
  );
}

/** Aviso da ficha: o que falta no cadastro para a nota fiscal sair (a mesma conferência que o emissor faz). */
export function AvisoCadastro({ cli, className }: { cli: ClienteSaaS; className?: string }) {
  if (cli.cadastro.completo) return null;
  return (
    <div role="alert" className={`flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 ${className ?? ""}`}>
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-ink" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-warning-ink">Cadastro incompleto para emitir nota</p>
        <p className="mt-0.5">
          {cli.cadastro.conflito ? (
            <>Este cliente está sem cadastro: {cli.cadastro.conflito}.</>
          ) : (
            <>
              Falta: <b>{listarPendencias(cli.cadastro.pendencias)}</b>. Enquanto faltar, a cobrança paga fica sem
              nota fiscal, com este aviso.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Info({ rotulo, valor, dica }: { rotulo: string; valor: React.ReactNode; dica?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-sm break-words">{valor || "—"}</p>
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  );
}

/** O CNPJ/CPF deste cliente é o cadastro de outro: até corrigir, ele não tem cadastro para editar. */
function CorrigirDocumento({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const [doc, setDoc] = useState(cli.documento ?? "");
  const salvar = useMutation({
    mutationFn: () => api.put<ClienteSaaS>(`/admin/clientes/${cli.id}`, {
      documento: doc.replace(/\D/g, ""), plano_id: cli.plano_id, ciclo: cli.ciclo, inicio_contrato: cli.inicio_contrato,
      teste_ate: cli.teste_ate, observacao: cli.observacao, indicado_por_id: cli.indicado_por_id,
    }),
    onSuccess: () => {
      toast.success("Documento corrigido");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  return (
    <form
      className="card-surface flex max-w-xl flex-wrap items-end gap-3 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (![11, 14].includes(doc.replace(/\D/g, "").length)) return void toast.error("Informe o CNPJ (14 números) ou o CPF (11).");
        salvar.mutate();
      }}
    >
      <Field label="CNPJ / CPF deste cliente" htmlFor="cad-doc" className="min-w-56 flex-1">
        <Input id="cad-doc" value={doc} onChange={(e) => setDoc(e.target.value)} className="num" />
      </Field>
      <Button type="submit" disabled={salvar.isPending}>
        {salvar.isPending && <Loader2 className="animate-spin" />} Corrigir e criar o cadastro
      </Button>
    </form>
  );
}

/** O cadastro completo na ficha: o mesmo formulário e as mesmas rotas de Cadastros › Clientes. */
function CadastroCompleto({ cli, tomadorId }: { cli: ClienteSaaS; tomadorId: number }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const podeEditar = pode("clientes.editar");
  const q = useQuery({
    queryKey: ["tomadores", "um", tomadorId],
    queryFn: () => api.get<TomadorOut>(`/nfse/tomadores/${tomadorId}`),
  });
  const cad = useCadastroCliente({ cliente: q.data ?? null, ativo: !!q.data, podeEditar, raiz: "form-cadastro-admin" });
  const salvar = useMutation({
    mutationFn: (body: CorpoCadastro) => api.put<TomadorOut>(`/nfse/tomadores/${tomadorId}`, body),
    onSuccess: () => {
      toast.success("Cadastro atualizado");
      qc.invalidateQueries({ queryKey: ["tomadores"] });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  if (q.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (!q.data) return null;
  return (
    <form id="form-cadastro-admin" className="card-surface min-w-0 p-5" onSubmit={cad.aoEnviar((body) => salvar.mutate(body))}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">Cadastro de {cli.nome}</p>
          <p className="text-sm text-muted-foreground">
            É com estes dados que a nota fiscal é emitida. Salvar aqui atualiza também a cobrança e os contratos.
          </p>
        </div>
        {podeEditar && <PreencherIA endpoint="/ia/preencher/cliente" aplicar={cad.aplicarIA} />}
      </div>
      <CadastroAbas cad={cad} dicaEmails={DICA_EMAIL_FINANCEIRO} rotuloDados="Identificação" />
      {podeEditar && (
        <div className="mt-5 flex justify-end border-t pt-4">
          <Button type="submit" disabled={salvar.isPending} className="px-4">
            {salvar.isPending && <Loader2 className="animate-spin" />} Salvar cadastro
          </Button>
        </div>
      )}
    </form>
  );
}

/** Aba "Dados" da ficha: o cadastro completo (editável) e os dados comerciais. */
export function AbaDados({ cli, onEditarComercial }: { cli: ClienteSaaS; onEditarComercial: () => void }) {
  const externo = cli.tipo === "externo";
  return (
    <div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {cli.tomador_id ? <CadastroCompleto cli={cli} tomadorId={cli.tomador_id} /> : <CorrigirDocumento cli={cli} />}
        <div className="card-surface space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Dados comerciais</p>
            <Button variant="outline" size="sm" onClick={onEditarComercial}>
              <Pencil /> Editar
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <Info
              rotulo="E-mail do financeiro"
              valor={cli.email_financeiro ?? <span className="text-warning-ink">Não informado: as cobranças são geradas, mas não enviadas.</span>}
              dica="O 1º e-mail do cadastro. Recebe cobranças, contratos e a nota."
            />
            <Info rotulo="Responsável" valor={cli.responsavel} dica="O contato principal do cadastro." />
            <Info rotulo="Telefone" valor={cli.telefone} dica="O 1º telefone do cadastro." />
            {!externo && (
              <>
                <Info
                  rotulo="Plano"
                  valor={cli.plano ? `${cli.plano.nome} (${cli.ciclo}) · ${moeda(cli.valor_com_desconto ?? cli.valor)}` : "Sem plano definido"}
                />
                <Info rotulo="Início do contrato" valor={cli.inicio_contrato ? data(cli.inicio_contrato) : null} />
                {cli.teste_ate && <Info rotulo="Teste grátis até" valor={data(cli.teste_ate)} />}
                {cli.indicado_por && <Info rotulo="Indicado por" valor={cli.indicado_por.nome} />}
              </>
            )}
            <Info rotulo="Cliente desde" valor={data(cli.criado_em)} />
            <div className="sm:col-span-2 xl:col-span-1">
              <Info rotulo="Observação interna" valor={cli.observacao} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
