"use client";

import { useMutation } from "@tanstack/react-query";
import { Eye, MoreHorizontal, Pencil, Plus, Receipt, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { abrirArquivo, api } from "@/lib/api";
import { data, documento, moeda } from "@/lib/format";
import {
  type CustaIn,
  type CustaOut,
  paraDecimal,
  type ProtocoloOut,
  ROTULO_STATUS_CUSTA,
  ROTULO_TIPO_CUSTA,
  type StatusCusta,
  type TipoCusta,
} from "@/lib/tribunais-protocolo";

const vazia = (p: ProtocoloOut): CustaIn => ({
  tipo_custa: p.tipo === "inicial" ? "inicial" : p.tipo === "recurso" ? "preparo_recursal" : "outra",
  tipo_guia: p.tribunal === "TJSP" ? "DARE" : p.tribunal.startsWith("TRF") ? "GRU" : "",
  codigo_receita: null,
  valor: "",
  base_calculo: p.cabecalho?.valor_causa ? String(p.cabecalho.valor_causa) : null,
  numero_guia: "",
  linha_digitavel: null,
  codigo_barras: null,
  vencimento: "",
  pagador_nome: "",
  pagador_documento: "",
  status: "gerada",
  pago_em: null,
  reembolsar_cliente: false,
});

const deOut = (c: CustaOut): CustaIn => ({
  tipo_custa: c.tipo_custa,
  tipo_guia: c.tipo_guia,
  codigo_receita: c.codigo_receita,
  valor: c.valor,
  base_calculo: c.base_calculo,
  numero_guia: c.numero_guia,
  linha_digitavel: c.linha_digitavel,
  codigo_barras: c.codigo_barras,
  vencimento: c.vencimento?.slice(0, 10) ?? "",
  pagador_nome: c.pagador_nome,
  pagador_documento: c.pagador_documento,
  status: c.status,
  pago_em: c.pago_em,
  reembolsar_cliente: c.reembolsar_cliente,
});


export function CustasProtocolo({ p, onAtualizado }: { p: ProtocoloOut; onAtualizado: (p: ProtocoloOut) => void }) {
  const [form, setForm] = useState<CustaIn | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [excluir, setExcluir] = useState<CustaOut | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [alvoComprovante, setAlvoComprovante] = useState<number | null>(null);
  const set = (x: Partial<CustaIn>) => setForm((f) => (f ? { ...f, ...x } : f));

  const salvar = useMutation({
    mutationFn: (c: CustaIn) => {
      const corpo = { ...c, valor: paraDecimal(c.valor) ?? "0", base_calculo: paraDecimal(c.base_calculo), codigo_receita: c.codigo_receita || null };
      return editId
        ? api.put<ProtocoloOut>(`/tribunais/protocolos/${p.id}/custas/${editId}`, corpo)
        : api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/custas`, corpo);
    },
    onSuccess: (r) => {
      onAtualizado(r);
      toast.success(editId ? "Custa atualizada" : "Custa incluída");
      setForm(null);
    },
  });
  const remover = useMutation({
    mutationFn: (cid: number) => api.del<ProtocoloOut>(`/tribunais/protocolos/${p.id}/custas/${cid}`),
    onSuccess: (r) => {
      onAtualizado(r);
      setExcluir(null);
    },
  });
  const comprovante = useMutation({
    mutationFn: ({ cid, f }: { cid: number; f: File }) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      return api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/custas/${cid}/comprovante`, fd);
    },
    onSuccess: (r) => {
      onAtualizado(r);
      toast.success("Comprovante guardado. A guia ficou como paga.");
    },
  });

  const total = p.custas.reduce((s, c) => s + Number(c.valor || 0), 0);
  const gratuita = p.tipo === "inicial" && p.cabecalho?.justica_gratuita_requerida;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {gratuita ? "Justiça gratuita pedida: as custas iniciais ficam dispensadas (anexe a declaração de hipossuficiência)." : "Guias de custas e comprovantes de pagamento."}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditId(null);
            setForm(vazia(p));
          }}
        >
          <Plus /> Incluir guia
        </Button>
      </div>

      <input
        ref={arquivo}
        type="file"
        accept=".pdf,image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && alvoComprovante) comprovante.mutate({ cid: alvoComprovante, f });
          e.target.value = "";
        }}
      />

      {p.custas.length === 0 ? (
        <div className="card-surface">
          <EmptyState icone={Receipt} titulo="Nenhuma guia" descricao="Inclua a guia (DARE, GRU…) e depois o comprovante de pagamento." />
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Guia</th>
                <th className="px-3 py-2.5 font-medium">Vencimento</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Pagador</th>
                <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {p.custas.map((c) => {
                const [l, t] = ROTULO_STATUS_CUSTA[c.status] ?? [c.status, "neutral"];
                return (
                  <tr key={c.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {c.tipo_guia} <Mono className="text-muted-foreground">{c.numero_guia}</Mono>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {ROTULO_TIPO_CUSTA[c.tipo_custa]}
                        {c.codigo_receita && ` · receita ${c.codigo_receita}`}
                      </p>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Mono>{data(c.vencimento)}</Mono>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <p className="max-w-48 truncate">{c.pagador_nome}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <Mono>{documento(c.pagador_documento)}</Mono>
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Mono>{moeda(c.valor)}</Mono>
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge label={l} tom={t} />
                      {c.pago_em && <p className="mt-0.5 text-[11px] text-muted-foreground">paga em {data(c.pago_em)}</p>}
                      {c.despesa_id ? (
                        <p className="text-[11px] text-success-ink">Lançada como despesa do caso</p>
                      ) : c.reembolsar_cliente ? (
                        <p className="text-[11px] text-muted-foreground">Reembolso: vira despesa do caso quando for paga</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setAlvoComprovante(c.id);
                              arquivo.current?.click();
                            }}
                          >
                            <Upload /> {c.tem_comprovante ? "Trocar comprovante" : "Enviar comprovante"}
                          </DropdownMenuItem>
                          {c.tem_comprovante && (
                            <DropdownMenuItem onClick={() => abrirArquivo(`/tribunais/protocolos/${p.id}/custas/${c.id}/comprovante`)}>
                              <Eye /> Ver comprovante
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => {
                              setEditId(c.id);
                              setForm(deOut(c));
                            }}
                          >
                            <Pencil /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => setExcluir(c)}>
                            <Trash2 /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-sm">
              <tr>
                <td className="px-4 py-2.5 font-medium" colSpan={3}>
                  Total
                </td>
                <td className="px-3 py-2.5 text-right font-semibold">
                  <Mono>{moeda(total)}</Mono>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <FormDialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        titulo={editId ? "Editar guia de custas" : "Incluir guia de custas"}
        largura="lg"
        salvando={salvar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (form) salvar.mutate(form);
        }}
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-6">
            <Field label="Tipo de custa" className="sm:col-span-3" obrigatorio>
              <NativeSelect value={form.tipo_custa} onChange={(e) => set({ tipo_custa: e.target.value as TipoCusta })}>
                {Object.entries(ROTULO_TIPO_CUSTA).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Tipo de guia" className="sm:col-span-3" obrigatorio dica="DARE (TJSP), GRU (federal), guia própria…">
              <Input value={form.tipo_guia} onChange={(e) => set({ tipo_guia: e.target.value })} maxLength={40} required minLength={2} />
            </Field>
            <Field label="Nº da guia" className="sm:col-span-3" obrigatorio>
              <Input value={form.numero_guia} onChange={(e) => set({ numero_guia: e.target.value })} className="font-mono" maxLength={60} required />
            </Field>
            <Field label="Código de receita" className="sm:col-span-3">
              <Input value={form.codigo_receita ?? ""} onChange={(e) => set({ codigo_receita: e.target.value })} className="font-mono" />
            </Field>
            <Field label="Valor (R$)" className="sm:col-span-2" obrigatorio>
              <Input value={form.valor} onChange={(e) => set({ valor: e.target.value.replace(/[^\d.,]/g, "") })} className="font-mono" inputMode="decimal" required />
            </Field>
            <Field label="Base de cálculo (R$)" className="sm:col-span-2" dica="Normalmente o valor da causa.">
              <Input
                value={form.base_calculo ?? ""}
                onChange={(e) => set({ base_calculo: e.target.value.replace(/[^\d.,]/g, "") || null })}
                className="font-mono"
                inputMode="decimal"
              />
            </Field>
            <Field label="Vencimento" className="sm:col-span-2" obrigatorio>
              <Input type="date" value={form.vencimento} onChange={(e) => set({ vencimento: e.target.value })} required />
            </Field>
            <Field label="Linha digitável" className="sm:col-span-6">
              <Input value={form.linha_digitavel ?? ""} onChange={(e) => set({ linha_digitavel: e.target.value || null })} className="font-mono" />
            </Field>
            <Field label="Pagador" className="sm:col-span-4" obrigatorio>
              <Input value={form.pagador_nome} onChange={(e) => set({ pagador_nome: e.target.value })} required minLength={2} maxLength={200} />
            </Field>
            <Field label="CPF/CNPJ do pagador" className="sm:col-span-2" obrigatorio>
              <Input value={form.pagador_documento} onChange={(e) => set({ pagador_documento: e.target.value })} className="font-mono" required />
            </Field>
            <Field label="Situação" className="sm:col-span-3">
              <NativeSelect value={form.status} onChange={(e) => set({ status: e.target.value as StatusCusta })}>
                {Object.entries(ROTULO_STATUS_CUSTA).map(([k, [l]]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <label className="flex items-start gap-2 rounded-xl border p-3 text-sm sm:col-span-6">
              <Checkbox checked={form.reembolsar_cliente} onCheckedChange={(v) => set({ reembolsar_cliente: !!v })} className="mt-0.5" />
              <span>
                <span className="font-medium">Reembolsar do cliente</span>
                <span className="block text-xs text-muted-foreground">
                  Ao enviar o comprovante (ou marcar como paga), a guia entra sozinha como despesa do caso e sai na Nota de Despesas (nunca na NFS-e).
                  {!p.caso_id && " Este protocolo não está ligado a um caso: ligue o processo a um caso para lançar a despesa."}
                </span>
              </span>
            </label>
          </div>
        )}
      </FormDialog>

      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir a guia?"
        descricao={excluir && <>A guia {excluir.tipo_guia} nº {excluir.numero_guia} sai deste protocolo. Uma despesa já lançada no caso continua lá.</>}
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}
