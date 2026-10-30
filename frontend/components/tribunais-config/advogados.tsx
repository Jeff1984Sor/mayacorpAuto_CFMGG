"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, MoreHorizontal, Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { TableSkeleton } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { TabelaUso, tomValidade } from "@/components/tribunais-protocolo/uso-certificado";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data, relativo } from "@/lib/format";
import { type AdvogadoOut, chaveProtocolos, type Oab, UFS, type UsoCertificado, useCandidatos } from "@/lib/tribunais-protocolo";

function OabsDialog({
  alvo,
  onOpenChange,
  podeEscolher,
}: {
  alvo: { id: number | null; nome: string; oabs: Oab[] } | null;
  onOpenChange: (o: boolean) => void;
  podeEscolher: boolean;
}) {
  const qc = useQueryClient();
  const cand = useCandidatos(!!alvo && podeEscolher);
  const [uid, setUid] = useState<number | null>(alvo?.id ?? null);
  const [lista, setLista] = useState<Oab[]>(alvo?.oabs.length ? alvo.oabs : [{ numero: "", uf: "SP", tipo: "principal" }]);
  const set = (i: number, p: Partial<Oab>) => setLista((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const salvar = useMutation({
    mutationFn: () => api.put(`/tribunais/advogados/${uid}/oabs`, lista.filter((o) => o.numero.trim())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "advogados"] });
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "candidatos"] });
      toast.success("Inscrições na OAB salvas");
      onOpenChange(false);
    },
  });
  return (
    <FormDialog
      open={!!alvo}
      onOpenChange={onOpenChange}
      titulo={alvo?.id ? `OAB de ${alvo.nome}` : "Cadastrar OAB de um profissional"}
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!uid) return toast.error("Escolha o profissional.");
        salvar.mutate();
      }}
    >
      <div className="space-y-3">
        {!alvo?.id && (
          <Field label="Profissional" obrigatorio>
            <NativeSelect
              value={uid ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value) || null;
                setUid(id);
                const c = cand.data?.find((x) => x.id === id);
                if (c?.oabs.length) setLista(c.oabs);
              }}
            >
              <option value="">Escolha</option>
              {(cand.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.oabs.length ? ` · ${c.oabs.map((o) => `${o.numero}/${o.uf}`).join(", ")}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {lista.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_80px_130px_auto] items-end gap-2">
            <Field label={i === 0 ? "Número" : ""}>
              <Input value={o.numero} onChange={(e) => set(i, { numero: e.target.value.replace(/\D/g, "") })} className="font-mono" />
            </Field>
            <Field label={i === 0 ? "UF" : ""}>
              <NativeSelect value={o.uf} onChange={(e) => set(i, { uf: e.target.value })}>
                {UFS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={i === 0 ? "Tipo" : ""}>
              <NativeSelect value={o.tipo} onChange={(e) => set(i, { tipo: e.target.value as Oab["tipo"] })}>
                <option value="principal">Principal</option>
                <option value="suplementar">Suplementar</option>
                <option value="estagiario">Estagiário</option>
              </NativeSelect>
            </Field>
            <Button type="button" variant="ghost" size="icon-sm" className="mb-1" onClick={() => setLista((l) => l.filter((_, j) => j !== i))} aria-label="Remover">
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setLista((l) => [...l, { numero: "", uf: "SP", tipo: "suplementar" }])}>
          <Plus /> Inscrição
        </Button>
      </div>
    </FormDialog>
  );
}

function UsoDialog({ alvo, onOpenChange }: { alvo: AdvogadoOut | null; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({
    queryKey: [chaveProtocolos, "uso", alvo?.id],
    queryFn: () => api.get<UsoCertificado[]>("/tribunais/uso-certificado", { usuario_id: alvo!.id }),
    enabled: !!alvo,
  });
  return (
    <Dialog open={!!alvo} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Uso do certificado de {alvo?.nome}</DialogTitle>
        </DialogHeader>
        <div className="rounded-xl border">
          <TabelaUso itens={q.data ?? []} carregando={q.isPending} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdvogadosTribunais({ podeEditar }: { podeEditar: boolean }) {
  const q = useQuery({ queryKey: [chaveProtocolos, "advogados"], queryFn: () => api.get<AdvogadoOut[]>("/tribunais/advogados") });
  const [oabs, setOabs] = useState<{ id: number | null; nome: string; oabs: Oab[] } | null>(null);
  const [uso, setUso] = useState<AdvogadoOut | null>(null);
  const lista = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Profissionais com OAB ou certificado. Cada advogado envia o próprio certificado em Tribunais › Meu certificado e OAB.</p>
        {podeEditar && (
          <Button onClick={() => setOabs({ id: null, nome: "", oabs: [] })}>
            <Plus /> Cadastrar OAB
          </Button>
        )}
      </div>
      <div className="card-surface overflow-hidden">
        {q.isPending ? (
          <TableSkeleton colunas={5} />
        ) : lista.length === 0 ? (
          <EmptyState icone={Scale} titulo="Nenhum advogado com OAB" descricao="Cadastre a OAB dos profissionais para buscar processos e protocolar." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Advogado</th>
                  <th className="px-3 py-2.5 font-medium">OAB</th>
                  <th className="px-3 py-2.5 font-medium">Certificado</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Última busca pela OAB</th>
                  <th className="px-3 py-2.5 text-right font-medium">Processos</th>
                  <th className="w-12 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.nome}</p>
                      <p className="text-[11px] text-muted-foreground">{a.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      {a.oabs.length ? (
                        a.oabs.map((o) => (
                          <p key={`${o.numero}${o.uf}`}>
                            <Mono>
                              {o.numero}/{o.uf}
                            </Mono>
                            {o.tipo !== "principal" && <span className="ml-1 text-[11px] text-muted-foreground">{o.tipo}</span>}
                          </p>
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {a.certificado ? (
                        <>
                          <StatusBadge
                            tom={a.certificado.revogado ? "danger" : tomValidade(a.certificado.dias_para_vencer)}
                            label={
                              a.certificado.revogado
                                ? "Revogado"
                                : a.certificado.dias_para_vencer < 0
                                  ? "Vencido"
                                  : `${a.certificado.dias_para_vencer} dias`
                            }
                          />
                          <p className="mt-0.5 text-[11px] text-muted-foreground">até {data(a.certificado.valido_ate)}</p>
                        </>
                      ) : (
                        <StatusBadge tom="neutral" label="Sem certificado" />
                      )}
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">
                      {a.ultima_varredura ? relativo(a.ultima_varredura.concluida_em ?? a.ultima_varredura.iniciada_em) : "nunca"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Mono>{a.processos}</Mono>
                    </td>
                    <td className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Ações" />}>
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {podeEditar && (
                            <DropdownMenuItem onClick={() => setOabs({ id: a.id, nome: a.nome, oabs: a.oabs })}>
                              <Pencil /> Editar OAB
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setUso(a)}>
                            <History /> Uso do certificado
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {oabs && <OabsDialog key={oabs.id ?? 0} alvo={oabs} onOpenChange={(o) => !o && setOabs(null)} podeEscolher={podeEditar} />}
      <UsoDialog alvo={uso} onOpenChange={(o) => !o && setUso(null)} />
    </div>
  );
}
