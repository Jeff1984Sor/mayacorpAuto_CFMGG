"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { TableCard, TableSkeleton, Toolbar } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, FormSection, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/use-debounce";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { api } from "@/lib/api";
import { aliquota, toNum } from "@/lib/format";
import type { Pagina, ParametroFiscalIn, ParametroFiscalOut, TomadorOut } from "@/lib/types";

const ESCOPO = { padrao: "Padrão", servico: "Por serviço", tomador: "Por tomador" } as const;

const novoParam = (emissora_id: number): ParametroFiscalIn => ({
  emissora_id,
  escopo: "padrao",
  descricao: "",
  cod_servico: "",
  tomador_id: null,
  aliquota_iss: null,
  nbs: "",
  cst_ibscbs: "",
  class_trib: "",
  ind_operacao: "",
  finalidade: "0",
  ind_final: "0",
  tipo_operacao: "1",
  ind_destinatario: "0",
  tributacao_rps: "T",
  prioridade: 0,
  ativo: true,
});

function TomadorPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [q, setQ] = useState("");
  const busca = useDebounce(q, 250);
  const r = useQuery({
    queryKey: ["tomadores-picker", busca, value],
    queryFn: () => api.get<Pagina<TomadorOut>>("/nfse/tomadores", { q: busca, por_pagina: 20 }),
  });
  return (
    <div className="grid gap-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tomador por nome ou documento" />
      <NativeSelect value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— escolha —</option>
        {r.data?.itens.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nome}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function ParamForm({ param, emissoraId, open, onClose }: { param: ParametroFiscalOut | null; emissoraId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<ParametroFiscalIn>(novoParam(emissoraId));
  const [aliq, setAliq] = useState("");
  useEffect(() => {
    if (!open) return;
    const base = param ?? novoParam(emissoraId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o formulário ao abrir
    setV(base);
    setAliq(base.aliquota_iss != null ? (toNum(base.aliquota_iss) * 100).toFixed(2).replace(".", ",") : "");
  }, [open, param, emissoraId]);
  const set = <K extends keyof ParametroFiscalIn>(k: K, x: ParametroFiscalIn[K]) => setV((o) => ({ ...o, [k]: x }));
  const txt = (k: keyof ParametroFiscalIn) => ({
    value: (v[k] as string | null) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(k, (e.target.value || null) as never),
  });

  const salvar = useMutation({
    mutationFn: () => {
      const body = { ...v, aliquota_iss: aliq ? (toNum(aliq.replace(",", ".")) / 100).toFixed(4) : null };
      return param ? api.put(`/config/parametros-fiscais/${param.id}`, body) : api.post("/config/parametros-fiscais", body);
    },
    onSuccess: () => {
      toast.success("Parâmetro salvo");
      qc.invalidateQueries({ queryKey: ["parametros"] });
      onClose();
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo={param ? "Editar parâmetro fiscal" : "Novo parâmetro fiscal"}
      descricao="Valores usados quando o arquivo de RPS não traz a informação — especialmente os campos do layout 2."
      largura="xl"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={v.ativo} onCheckedChange={(x) => set("ativo", x)} /> Ativo
        </label>
      }
    >
      <div className="divide-y">
        <FormSection titulo="Quando aplicar" descricao="Regras específicas vencem o padrão; em empate, a maior prioridade.">
          <Field label="Escopo">
            <NativeSelect value={v.escopo} onChange={(e) => set("escopo", e.target.value as ParametroFiscalIn["escopo"])}>
              {Object.entries(ESCOPO).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Descrição">
            <Input {...txt("descricao")} placeholder="ex.: Honorários advocatícios" />
          </Field>
          {v.escopo === "servico" && (
            <Field label="Código do serviço" className="sm:col-span-2">
              <Input {...txt("cod_servico")} className="num" placeholder="ex.: 03220" />
            </Field>
          )}
          {v.escopo === "tomador" && (
            <Field label="Tomador" className="sm:col-span-2">
              <TomadorPicker value={v.tomador_id} onChange={(id) => set("tomador_id", id)} />
            </Field>
          )}
          <Field label="Prioridade">
            <Input type="number" value={v.prioridade} onChange={(e) => set("prioridade", Number(e.target.value))} className="num" />
          </Field>
        </FormSection>
        <FormSection titulo="ISS" descricao="Tributação municipal.">
          <Field label="Alíquota ISS (%)" dica="Vazio = usa a da emissora">
            <Input value={aliq} onChange={(e) => setAliq(e.target.value)} className="num" inputMode="decimal" />
          </Field>
          <Field label="Tributação do RPS">
            <NativeSelect {...txt("tributacao_rps")}>
              <option value="T">T — Tributado em São Paulo</option>
              <option value="F">F — Tributado fora de São Paulo</option>
              <option value="A">A — Tributado em SP, isento</option>
              <option value="B">B — Tributado fora de SP, isento</option>
              <option value="M">M — Tributado em SP, imune</option>
              <option value="N">N — Tributado fora de SP, imune</option>
              <option value="X">X — Tributado em SP, exigibilidade suspensa</option>
              <option value="V">V — Tributado em SP, retido</option>
              <option value="P">P — Exportação de serviços</option>
            </NativeSelect>
          </Field>
        </FormSection>
        <FormSection titulo="IBS / CBS (layout 2)" descricao="Definidos com o contador da CFME, conforme a planilha de campos da Prefeitura.">
          <Field label="Código NBS" dica="Nomenclatura Brasileira de Serviços">
            <Input {...txt("nbs")} className="num" placeholder="ex.: 113011000" />
          </Field>
          <Field label="CST IBS/CBS">
            <Input {...txt("cst_ibscbs")} className="num" placeholder="ex.: 000" maxLength={3} />
          </Field>
          <Field label="Classificação tributária (cClassTrib)">
            <Input {...txt("class_trib")} className="num" placeholder="ex.: 000001" maxLength={6} />
          </Field>
          <Field label="Indicador de operação (cIndOp)">
            <Input {...txt("ind_operacao")} className="num" placeholder="ex.: 100301" maxLength={6} />
          </Field>
          <Field label="Finalidade da NFS-e">
            <NativeSelect {...txt("finalidade")}>
              <option value="0">0 — Regular</option>
              <option value="1">1 — Crédito</option>
              <option value="2">2 — Débito</option>
            </NativeSelect>
          </Field>
          <Field label="Consumidor final">
            <NativeSelect {...txt("ind_final")}>
              <option value="0">0 — Não</option>
              <option value="1">1 — Sim</option>
            </NativeSelect>
          </Field>
          <Field label="Tipo de operação">
            <NativeSelect {...txt("tipo_operacao")}>
              <option value="1">1 — Fornecimento com pagamento posterior</option>
              <option value="2">2 — Recebimento do pagamento com fornecimento já realizado</option>
              <option value="3">3 — Fornecimento com pagamento já realizado</option>
              <option value="4">4 — Recebimento do pagamento com fornecimento posterior</option>
              <option value="5">5 — Fornecimento e recebimento concomitantes</option>
            </NativeSelect>
          </Field>
          <Field label="Destinatário">
            <NativeSelect {...txt("ind_destinatario")}>
              <option value="0">0 — O próprio tomador</option>
              <option value="1">1 — Outra pessoa (destinatário informado)</option>
            </NativeSelect>
          </Field>
        </FormSection>
      </div>
    </FormDialog>
  );
}

export default function ParametrosFiscaisPage() {
  const qc = useQueryClient();
  const emissoras = useEmissoras();
  const [emissoraId, setEmissoraId] = useState<number | null>(null);
  const eid = emissoraId ?? emissoras.data?.[0]?.id ?? null;
  const [editar, setEditar] = useState<ParametroFiscalOut | null>(null);
  const [novo, setNovo] = useState(false);
  const [excluir, setExcluir] = useState<ParametroFiscalOut | null>(null);
  const lista = useQuery({
    queryKey: ["parametros", eid],
    queryFn: () => api.get<ParametroFiscalOut[] | Pagina<ParametroFiscalOut>>("/config/parametros-fiscais", { emissora_id: eid }),
    enabled: !!eid,
  });
  const params = (Array.isArray(lista.data) ? lista.data : (lista.data?.itens ?? [])).filter((p) => !eid || p.emissora_id === eid);
  const remover = useMutation({
    mutationFn: (id: number) => api.del(`/config/parametros-fiscais/${id}`),
    onSuccess: () => {
      toast.success("Parâmetro excluído");
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["parametros"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-2xl border border-brand/25 bg-brand/6 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-info-ink" />
        <p>
          O arquivo da Lello não traz os campos novos de <strong>IBS e CBS</strong>. Estes parâmetros completam cada RPS antes da conversão
          para o layout 2. Comece pelo <strong>padrão</strong> e crie regras por código de serviço ou tomador quando necessário.
        </p>
      </div>
      <TableCard>
        <Toolbar>
          <NativeSelect value={eid ?? ""} onChange={(e) => setEmissoraId(Number(e.target.value))} className="w-72">
            {emissoras.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {nomeEmissora(e)}
              </option>
            ))}
          </NativeSelect>
          <Button onClick={() => setNovo(true)} disabled={!eid}>
            <Plus /> Novo parâmetro
          </Button>
        </Toolbar>
        {lista.isPending && eid ? (
          <TableSkeleton colunas={6} />
        ) : params.length === 0 ? (
          <EmptyState
            icone={Percent}
            titulo="Nenhum parâmetro fiscal"
            descricao="Cadastre o padrão de ISS/IBS/CBS definido com o contador."
            acao={
              eid && (
                <Button onClick={() => setNovo(true)}>
                  <Plus /> Criar padrão
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Regra</th>
                  <th className="px-3 py-2.5 font-medium">ISS</th>
                  <th className="px-3 py-2.5 font-medium">NBS</th>
                  <th className="px-3 py-2.5 font-medium">CST</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">cClassTrib</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">cIndOp</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="w-20 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {params
                  .sort((a, b) => (a.escopo === "padrao" ? -1 : 1) - (b.escopo === "padrao" ? -1 : 1) || b.prioridade - a.prioridade)
                  .map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Pill tom={p.escopo === "padrao" ? "brand" : "neutral"}>{ESCOPO[p.escopo]}</Pill>
                          <span className="font-medium">{p.descricao || (p.escopo === "padrao" ? "Padrão da emissora" : "—")}</span>
                        </div>
                        {p.escopo === "servico" && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            serviço <Mono>{p.cod_servico}</Mono>
                          </p>
                        )}
                        {p.escopo === "tomador" && <p className="mt-0.5 text-xs text-muted-foreground">tomador #{p.tomador_id}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <Mono>{p.aliquota_iss != null ? aliquota(p.aliquota_iss) : "emissora"}</Mono>
                      </td>
                      <td className="px-3 py-3">
                        <Mono>{p.nbs || "—"}</Mono>
                      </td>
                      <td className="px-3 py-3">
                        <Mono>{p.cst_ibscbs || "—"}</Mono>
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <Mono>{p.class_trib || "—"}</Mono>
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <Mono>{p.ind_operacao || "—"}</Mono>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={p.ativo ? "ativo" : "descartado"} label={p.ativo ? "Ativo" : "Inativo"} />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditar(p)} aria-label="Editar">
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="text-danger-ink" onClick={() => setExcluir(p)} aria-label="Excluir">
                            <Trash2 />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      {eid && (
        <ParamForm
          open={novo || !!editar}
          param={editar}
          emissoraId={eid}
          onClose={() => {
            setNovo(false);
            setEditar(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir este parâmetro?"
        descricao="Os próximos lotes deixam de usar esta regra."
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
