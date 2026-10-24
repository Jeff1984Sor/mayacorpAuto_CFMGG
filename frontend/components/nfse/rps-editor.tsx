"use client";

import { useMutation } from "@tanstack/react-query";
import { Ban, Loader2, MapPin, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCep } from "@/hooks/use-cep";
import { ProblemaItem } from "./problema";
import { api } from "@/lib/api";
import { documento, moeda, toNum } from "@/lib/format";
import type { ResumoImportacao, RpsOut, RpsPatch } from "@/lib/types";

type Tomador = {
  nome: string;
  cpf_cnpj: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
};

const str = (v: unknown) => (v == null ? "" : String(v));

function tomadorDe(r: RpsOut): Tomador {
  const t = (r.dados?.tomador ?? {}) as Record<string, unknown>;
  const emails = t.emails as string[] | undefined;
  return {
    nome: str(t.nome ?? r.tomador_nome),
    cpf_cnpj: str(t.cpf_cnpj ?? r.tomador_doc),
    email: str(t.email ?? emails?.[0]),
    cep: str(t.cep),
    logradouro: str(t.logradouro),
    numero: str(t.numero),
    complemento: str(t.complemento),
    bairro: str(t.bairro),
    cidade: str(t.cidade),
    uf: str(t.uf),
  };
}

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function RpsEditor({
  loteId,
  rps,
  onClose,
  onSaved,
  somenteLeitura,
}: {
  loteId: number;
  rps: RpsOut | null;
  onClose: () => void;
  onSaved: (r: RpsOut, resumo: ResumoImportacao) => void;
  somenteLeitura?: boolean;
}) {
  const [f, setF] = useState({
    data_emissao: "",
    cod_servico: "",
    aliquota: "",
    valor: "",
    deducoes: "",
    iss_retido: false,
    discriminacao: "",
  });
  const [t, setT] = useState<Tomador>(() => ({
    nome: "",
    cpf_cnpj: "",
    email: "",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  }));
  const cep = useCep();

  /* eslint-disable react-hooks/set-state-in-effect -- sincroniza o formulário com a linha aberta */
  useEffect(() => {
    if (!rps) return;
    setF({
      data_emissao: rps.data_emissao,
      cod_servico: rps.cod_servico,
      aliquota: (toNum(rps.aliquota) * 100).toFixed(2),
      valor: toNum(rps.valor).toFixed(2),
      deducoes: toNum(rps.deducoes).toFixed(2),
      iss_retido: rps.iss_retido,
      discriminacao: rps.discriminacao,
    });
    setT(tomadorDe(rps));
  }, [rps]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const salvar = useMutation({
    mutationFn: (patch: RpsPatch) =>
      api.patch<{ rps: RpsOut; resumo: ResumoImportacao }>(`/nfse/importacoes/${loteId}/rps/${rps!.id}`, patch),
    onSuccess: (res, patch) => {
      onSaved(res.rps, res.resumo);
      if (patch.descartar) {
        toast.success(`RPS ${res.rps.numero} descartado`);
        onClose();
      } else if (res.rps.status === "erro") {
        toast.warning("Salvo, mas ainda há problemas nesta linha.");
      } else {
        toast.success(`RPS ${res.rps.numero} corrigido`);
        onClose();
      }
    },
  });

  const enviar = () => {
    salvar.mutate({
      data_emissao: f.data_emissao,
      cod_servico: f.cod_servico,
      aliquota: (toNum(f.aliquota) / 100).toFixed(4),
      valor: toNum(f.valor).toFixed(2),
      deducoes: toNum(f.deducoes).toFixed(2),
      iss_retido: f.iss_retido,
      discriminacao: f.discriminacao,
      tomador: {
        nome: t.nome,
        cpf_cnpj: t.cpf_cnpj.replace(/\D/g, ""),
        email: t.email || null,
        cep: t.cep.replace(/\D/g, ""),
        logradouro: t.logradouro,
        numero: t.numero,
        complemento: t.complemento,
        bairro: t.bairro,
        cidade: t.cidade,
        uf: t.uf,
      },
    });
  };

  const buscarCep = async () => {
    const r = await cep.buscar(t.cep);
    if (r) setT((x) => ({ ...x, logradouro: r.logradouro || x.logradouro, bairro: r.bairro || x.bairro, cidade: r.localidade, uf: r.uf }));
  };

  const campoComErro = (c: string) => rps?.erros.some((e) => e.nivel === "erro" && (e.campo === c || e.campo.endsWith(`.${c}`)));
  const issCalc = (toNum(f.valor) - toNum(f.deducoes)) * (toNum(f.aliquota) / 100);
  const desab = somenteLeitura || salvar.isPending;

  return (
    <Sheet open={!!rps} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
        {rps && (
          <>
            <SheetHeader className="border-b p-5">
              <div className="flex items-center gap-2">
                <SheetTitle className="text-lg">
                  RPS <span className="num">{rps.numero}</span>
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                    série {rps.serie} · linha {rps.linha}
                  </span>
                </SheetTitle>
                <StatusBadge status={rps.status} />
              </div>
              <SheetDescription>Corrija os dados abaixo. A linha é revalidada ao salvar.</SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {rps.erros.length > 0 && (
                <div className="space-y-1.5">
                  {rps.erros.map((e, i) => (
                    <ProblemaItem key={i} p={e} />
                  ))}
                </div>
              )}

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Tomador</h4>
                <Field label="Nome / razão social" erro={campoComErro("nome") ? "Verifique" : undefined}>
                  <Input value={t.nome} disabled={desab} onChange={(e) => setT({ ...t, nome: e.target.value })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="CPF / CNPJ">
                    <Input
                      value={t.cpf_cnpj}
                      disabled={desab}
                      aria-invalid={campoComErro("cpf_cnpj")}
                      className="num"
                      onChange={(e) => setT({ ...t, cpf_cnpj: e.target.value })}
                      onBlur={() => setT((x) => ({ ...x, cpf_cnpj: documento(x.cpf_cnpj) }))}
                    />
                  </Field>
                  <Field label="E-mail">
                    <Input
                      type="email"
                      value={t.email}
                      disabled={desab}
                      aria-invalid={campoComErro("email")}
                      onChange={(e) => setT({ ...t, email: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-[150px_1fr_100px]">
                  <Field label="CEP">
                    <div className="relative">
                      <Input
                        value={t.cep}
                        disabled={desab}
                        aria-invalid={campoComErro("cep")}
                        className="num pr-8"
                        onChange={(e) => setT({ ...t, cep: e.target.value })}
                        onBlur={buscarCep}
                      />
                      {cep.carregando ? (
                        <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      ) : (
                        <MapPin className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                      )}
                    </div>
                  </Field>
                  <Field label="Logradouro">
                    <Input value={t.logradouro} disabled={desab} onChange={(e) => setT({ ...t, logradouro: e.target.value })} />
                  </Field>
                  <Field label="Número">
                    <Input value={t.numero} disabled={desab} onChange={(e) => setT({ ...t, numero: e.target.value })} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
                  <Field label="Bairro">
                    <Input value={t.bairro} disabled={desab} onChange={(e) => setT({ ...t, bairro: e.target.value })} />
                  </Field>
                  <Field label="Cidade">
                    <Input value={t.cidade} disabled={desab} onChange={(e) => setT({ ...t, cidade: e.target.value })} />
                  </Field>
                  <Field label="UF">
                    <NativeSelect value={t.uf} disabled={desab} onChange={(e) => setT({ ...t, uf: e.target.value })}>
                      <option value="">—</option>
                      {UFS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              </section>

              <Separator />

              <section className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Serviço e valores</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Data de emissão">
                    <Input
                      type="date"
                      value={f.data_emissao}
                      disabled={desab}
                      aria-invalid={campoComErro("data_emissao")}
                      onChange={(e) => setF({ ...f, data_emissao: e.target.value })}
                    />
                  </Field>
                  <Field label="Código do serviço">
                    <Input
                      value={f.cod_servico}
                      disabled={desab}
                      className="num"
                      aria-invalid={campoComErro("cod_servico")}
                      onChange={(e) => setF({ ...f, cod_servico: e.target.value })}
                    />
                  </Field>
                  <Field label="Alíquota ISS (%)">
                    <Input
                      inputMode="decimal"
                      value={f.aliquota}
                      disabled={desab}
                      className="num"
                      onChange={(e) => setF({ ...f, aliquota: e.target.value.replace(",", ".") })}
                    />
                  </Field>
                  <Field label="Valor do serviço">
                    <Input
                      inputMode="decimal"
                      value={f.valor}
                      disabled={desab}
                      className="num"
                      aria-invalid={campoComErro("valor")}
                      onChange={(e) => setF({ ...f, valor: e.target.value.replace(",", ".") })}
                    />
                  </Field>
                  <Field label="Deduções">
                    <Input
                      inputMode="decimal"
                      value={f.deducoes}
                      disabled={desab}
                      className="num"
                      aria-invalid={campoComErro("deducoes")}
                      onChange={(e) => setF({ ...f, deducoes: e.target.value.replace(",", ".") })}
                    />
                  </Field>
                  <Field label="ISS calculado">
                    <div className="flex h-8 items-center rounded-lg bg-muted px-2.5 text-sm font-medium num">{moeda(issCalc)}</div>
                  </Field>
                </div>
                <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  ISS retido pelo tomador
                  <Switch checked={f.iss_retido} disabled={desab} onCheckedChange={(v) => setF({ ...f, iss_retido: v })} />
                </label>
                <Field label="Discriminação do serviço">
                  <Textarea
                    rows={4}
                    value={f.discriminacao}
                    disabled={desab}
                    onChange={(e) => setF({ ...f, discriminacao: e.target.value })}
                  />
                </Field>
              </section>
            </div>

            {!somenteLeitura && (
              <SheetFooter className="flex-row justify-between gap-2 border-t bg-muted/30 p-4">
                <Button
                  variant="ghost"
                  className="text-danger-ink hover:bg-danger/10"
                  disabled={salvar.isPending}
                  onClick={() => salvar.mutate({ descartar: true })}
                >
                  <Ban /> Descartar linha
                </Button>
                <Button onClick={enviar} disabled={salvar.isPending} className="px-4">
                  {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                  Salvar e revalidar
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
