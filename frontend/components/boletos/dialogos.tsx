"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileText, Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Segmented } from "@/components/mayacorp/data-table";
import { Field, FormSection, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import { abrirArquivo, api } from "@/lib/api";
import {
  type BancoBoleto,
  type BoletoOut,
  type ConvenioIn,
  type ConvenioOut,
  type FaturaDisponivel,
  type Pagador,
  type PreviaEmail,
  ROTULO_RESULTADO,
  type RetornoOut,
  TOM_STATUS,
} from "@/lib/boletos";
import type { ContaOut } from "@/lib/financeiro";
import { data, dataHora, documento, moeda } from "@/lib/format";
import type { EmissoraOut, Pagina } from "@/lib/types";

const invalidar = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["boletos"] });

export function useConvenios() {
  return useQuery({ queryKey: ["boletos", "convenios"], queryFn: () => api.get<ConvenioOut[]>("/boletos/convenios") });
}

/** "1.150,00" ou "1150.00" → "1150.00" (o servidor recebe sempre com ponto). */
function valorParaApi(v: string) {
  const s = v.trim().replace(/\s|R\$/g, "");
  return s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
}

const PAGADOR_VAZIO: Pagador = {
  pagador_nome: "",
  pagador_documento: "",
  pagador_endereco: "",
  pagador_bairro: "",
  pagador_cep: "",
  pagador_cidade: "",
  pagador_uf: "",
};

// ============================================================================ boleto: criar e editar
interface FormBoleto extends Pagador {
  convenio_id: number | "";
  fatura_id: number | null;
  tomador_id: number | null;
  valor: string;
  data_vencimento: string;
  descricao: string;
}

export function BoletoDialog({ open, onOpenChange, boleto }: { open: boolean; onOpenChange: (o: boolean) => void; boleto: BoletoOut | null }) {
  const qc = useQueryClient();
  const convenios = useConvenios();
  const ativos = (convenios.data ?? []).filter((c) => c.ativo && c.pendencias.length === 0);
  const [origem, setOrigem] = useState<"fatura" | "avulso">("fatura");
  const [busca, setBusca] = useState("");
  const termo = useDebounce(busca, 300);
  const [f, setF] = useState<FormBoleto>({
    ...PAGADOR_VAZIO,
    convenio_id: "",
    fatura_id: null,
    tomador_id: null,
    valor: "",
    data_vencimento: "",
    descricao: "",
  });
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const set = <K extends keyof FormBoleto>(k: K, v: FormBoleto[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!open) return;
    setBusca("");
    setEscolhida(boleto?.fatura_codigo ?? null);
    setOrigem(boleto ? (boleto.fatura_id ? "fatura" : "avulso") : "fatura");
    setF(
      boleto
        ? {
            convenio_id: boleto.convenio_id,
            fatura_id: boleto.fatura_id,
            tomador_id: boleto.tomador_id,
            valor: boleto.valor.replace(".", ","),
            data_vencimento: boleto.data_vencimento,
            descricao: boleto.descricao,
            pagador_nome: boleto.pagador_nome,
            pagador_documento: boleto.pagador_documento,
            pagador_endereco: boleto.pagador_endereco,
            pagador_bairro: boleto.pagador_bairro,
            pagador_cep: boleto.pagador_cep,
            pagador_cidade: boleto.pagador_cidade,
            pagador_uf: boleto.pagador_uf,
          }
        : { ...PAGADOR_VAZIO, convenio_id: "", fatura_id: null, tomador_id: null, valor: "", data_vencimento: "", descricao: "" },
    );
  }, [open, boleto]);

  // um convênio só: já vem escolhido
  useEffect(() => {
    if (open && !boleto && f.convenio_id === "" && ativos.length === 1) set("convenio_id", ativos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boleto, ativos.length]);

  const faturas = useQuery({
    queryKey: ["boletos", "faturas-disponiveis", termo],
    queryFn: () => api.get<FaturaDisponivel[]>("/boletos/faturas-disponiveis", { q: termo || undefined }),
    enabled: open && !boleto && origem === "fatura" && !f.fatura_id,
  });
  const clientes = useQuery({
    queryKey: ["boletos", "clientes", termo],
    queryFn: () => api.get<Pagina<{ id: number; nome: string; cpf_cnpj: string | null }>>("/nfse/tomadores", { q: termo, por_pagina: 8 }),
    enabled: open && !boleto && origem === "avulso" && termo.length >= 2,
  });

  const usarFatura = (x: FaturaDisponivel) => {
    const s = x.sugestao;
    setEscolhida(`${x.codigo} · ${x.cliente}`);
    setF((a) => ({
      ...a,
      fatura_id: x.id,
      tomador_id: s.tomador_id,
      valor: s.valor.replace(".", ","),
      data_vencimento: s.data_vencimento,
      descricao: s.descricao,
      pagador_nome: s.pagador_nome ?? "",
      pagador_documento: s.pagador_documento ?? "",
      pagador_endereco: s.pagador_endereco ?? "",
      pagador_bairro: s.pagador_bairro ?? "",
      pagador_cep: s.pagador_cep ?? "",
      pagador_cidade: s.pagador_cidade ?? "",
      pagador_uf: s.pagador_uf ?? "",
    }));
  };
  const usarCliente = async (id: number) => {
    const p = await api.get<Pagador>(`/boletos/clientes/${id}/pagador`);
    setF((a) => ({ ...a, ...p, tomador_id: id }));
    setBusca("");
  };

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, valor: valorParaApi(f.valor), convenio_id: Number(f.convenio_id) };
      return boleto ? api.put<BoletoOut>(`/boletos/${boleto.id}`, corpo) : api.post<BoletoOut>("/boletos", corpo);
    },
    onSuccess: () => {
      toast.success(boleto ? "Boleto alterado" : "Boleto criado. Ele vai na próxima remessa.");
      invalidar(qc);
      onOpenChange(false);
    },
  });

  const semConvenio = !convenios.isPending && ativos.length === 0;
  const mostraCampos = !!boleto || origem === "avulso" || !!f.fatura_id;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={boleto ? `Editar boleto ${boleto.seu_numero}` : "Novo boleto"}
      descricao={boleto ? "Só dá para editar enquanto o boleto não foi para o banco." : "De uma fatura (NH ou ND) ou avulso."}
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={boleto ? "Salvar" : "Criar boleto"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.convenio_id) return toast.error("Escolha o convênio.");
        if (!mostraCampos) return toast.error("Escolha a fatura.");
        salvar.mutate();
      }}
    >
      {semConvenio ? (
        <p className="rounded-xl bg-warning/10 p-4 text-sm text-warning-ink">
          Antes de criar boletos, cadastre o convênio com o banco na aba <strong>Convênios</strong>.
        </p>
      ) : (
        <div className="space-y-4">
          {!boleto && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Convênio" obrigatorio>
                <NativeSelect value={f.convenio_id} onChange={(e) => set("convenio_id", e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Escolha…</option>
                  {ativos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.banco_nome})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Origem">
                <Segmented
                  value={origem}
                  onChange={(v) => {
                    setOrigem(v);
                    setBusca("");
                    setEscolhida(null);
                    setF((a) => ({ ...a, ...PAGADOR_VAZIO, fatura_id: null, tomador_id: null, valor: "", data_vencimento: "", descricao: "" }));
                  }}
                  opcoes={[
                    { value: "fatura", label: "De uma fatura" },
                    { value: "avulso", label: "Avulso" },
                  ]}
                />
              </Field>
            </div>
          )}

          {!boleto && origem === "fatura" && !f.fatura_id && (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Buscar fatura pelo cliente ou número" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
              </div>
              <div className="mt-2 max-h-72 divide-y overflow-y-auto rounded-xl border">
                {faturas.isPending ? (
                  <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
                ) : (faturas.data ?? []).length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">Nenhuma fatura em aberto sem boleto.</p>
                ) : (
                  faturas.data!.map((x) => (
                    <button key={x.id} type="button" onClick={() => usarFatura(x)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50">
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{x.codigo}</span> <span className="truncate">{x.cliente}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs">{moeda(x.sugestao.valor)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {!boleto && origem === "fatura" && f.fatura_id && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm">
              <span className="truncate">
                Fatura: <strong>{escolhida}</strong>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setF((a) => ({ ...a, fatura_id: null }))}>
                Trocar
              </Button>
            </div>
          )}

          {!boleto && origem === "avulso" && (
            <div>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Puxar os dados de um cliente cadastrado (opcional)" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </div>
              {termo.length >= 2 && (clientes.data?.itens ?? []).length > 0 && (
                <div className="mt-2 max-h-48 divide-y overflow-y-auto rounded-xl border">
                  {clientes.data!.itens.map((c) => (
                    <button key={c.id} type="button" onClick={() => usarCliente(c.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50">
                      <span className="truncate">{c.nome}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{documento(c.cpf_cnpj)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {mostraCampos && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Valor (R$)" obrigatorio>
                  <Input inputMode="decimal" value={f.valor} onChange={(e) => set("valor", e.target.value)} placeholder="0,00" required />
                </Field>
                <Field label="Vencimento" obrigatorio>
                  <Input type="date" value={f.data_vencimento} onChange={(e) => set("data_vencimento", e.target.value)} required />
                </Field>
                <Field label="Descrição" dica="Sai nas instruções do boleto">
                  <Input value={f.descricao} onChange={(e) => set("descricao", e.target.value)} maxLength={200} />
                </Field>
              </div>
              <FormSection titulo="Pagador">
                <div className="grid gap-3 sm:grid-cols-6">
                  <Field label="Nome" obrigatorio className="sm:col-span-4">
                    <Input value={f.pagador_nome} onChange={(e) => set("pagador_nome", e.target.value)} required />
                  </Field>
                  <Field label="CPF/CNPJ" obrigatorio className="sm:col-span-2">
                    <Input value={f.pagador_documento} onChange={(e) => set("pagador_documento", e.target.value)} required />
                  </Field>
                  <Field label="CEP" obrigatorio className="sm:col-span-2">
                    <Input value={f.pagador_cep} onChange={(e) => set("pagador_cep", e.target.value)} required />
                  </Field>
                  <Field label="Endereço" obrigatorio className="sm:col-span-4">
                    <Input value={f.pagador_endereco} onChange={(e) => set("pagador_endereco", e.target.value)} required />
                  </Field>
                  <Field label="Bairro" className="sm:col-span-2">
                    <Input value={f.pagador_bairro} onChange={(e) => set("pagador_bairro", e.target.value)} />
                  </Field>
                  <Field label="Cidade" obrigatorio className="sm:col-span-3">
                    <Input value={f.pagador_cidade} onChange={(e) => set("pagador_cidade", e.target.value)} required />
                  </Field>
                  <Field label="UF" obrigatorio className="sm:col-span-1">
                    <Input value={f.pagador_uf} onChange={(e) => set("pagador_uf", e.target.value.toUpperCase())} maxLength={2} required />
                  </Field>
                </div>
              </FormSection>
            </>
          )}
        </div>
      )}
    </FormDialog>
  );
}

// ============================================================================ boleto: detalhe
export function BoletoDetalhe({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["boletos", "um", id], queryFn: () => api.get<BoletoOut>(`/boletos/${id}`), enabled: id !== null });
  const b = q.data;
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Boleto {b?.seu_numero ?? ""}</DialogTitle>
          <DialogDescription>{b ? `${b.pagador_nome} · ${b.convenio_nome}` : "Carregando…"}</DialogDescription>
        </DialogHeader>
        {b && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tom={TOM_STATUS[b.status]}>{b.status_rotulo}</Pill>
              {b.instrucao_pendente && <Pill tom="warning">{b.instrucao_pendente === "02" ? "Baixa na próxima remessa" : `Novo vencimento ${data(b.novo_vencimento)} na próxima remessa`}</Pill>}
            </div>
            {!b.pode_enviar_ao_cliente && (b.status === "rascunho" || b.status === "em_remessa") && (
              <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-warning-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                O banco ainda não confirmou o registro. Não envie este boleto ao cliente antes de importar o retorno: ele pode ser recusado na hora de pagar.
              </p>
            )}
            {b.motivos.length > 0 && (
              <div className="rounded-xl bg-danger/10 p-3 text-danger-ink">
                <p className="font-medium">O banco recusou:</p>
                <ul className="mt-1 list-disc pl-5">
                  {b.motivos.map((m) => (
                    <li key={m.codigo}>
                      {m.descricao} <span className="opacity-60">(código {m.codigo})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {(
                [
                  ["Valor", moeda(b.valor)],
                  ["Vencimento", data(b.data_vencimento)],
                  ["Emissão", data(b.data_emissao)],
                  ["Nosso número", b.nosso_numero_fmt ?? "o banco vai numerar"],
                  ["Fatura", b.fatura_codigo ?? "avulso"],
                  ["Remessa", b.remessa_sequencial ? `nº ${b.remessa_sequencial}` : "ainda não foi"],
                  ...(b.valor_pago ? ([["Pago", `${moeda(b.valor_pago)} em ${data(b.data_pagamento)}`], ["Crédito", data(b.data_credito)], ["Tarifa", b.tarifa ? moeda(b.tarifa) : "—"]] as [string, string][]) : []),
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {b.linha_digitavel_fmt && (
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">Linha digitável</p>
                <p className="font-mono text-[13px] break-all">{b.linha_digitavel_fmt}</p>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Histórico</p>
              <ul className="divide-y rounded-xl border">
                {b.ocorrencias.map((o) => (
                  <li key={o.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span>{o.descricao}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{o.data_ocorrencia ? data(o.data_ocorrencia) : dataHora(o.criado_em)}</span>
                    </div>
                    {o.alerta && <p className="mt-0.5 text-xs text-warning-ink">{o.alerta}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <DialogFooter>
          {b?.codigo_barras && (
            <Button variant="outline" onClick={() => abrirArquivo(`/boletos/${b.id}/pdf`).catch((e: Error) => toast.error(e.message))}>
              <FileText /> Ver PDF
            </Button>
          )}
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================ alterar vencimento
export function VencimentoDialog({ boleto, onClose }: { boleto: BoletoOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [dia, setDia] = useState("");
  useEffect(() => setDia(boleto?.data_vencimento ?? ""), [boleto]);
  const m = useMutation({
    mutationFn: () => api.post(`/boletos/${boleto!.id}/vencimento`, { data: dia }),
    onSuccess: () => {
      toast.success(boleto!.status === "rascunho" ? "Vencimento alterado" : "Alteração registrada: gere a remessa para avisar o banco");
      invalidar(qc);
      onClose();
    },
  });
  return (
    <FormDialog
      open={!!boleto}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Alterar vencimento · ${boleto?.seu_numero ?? ""}`}
      descricao="Boleto que já está no banco só muda depois da próxima remessa e do retorno do banco."
      salvando={m.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Field label="Novo vencimento" obrigatorio>
        <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} required />
      </Field>
    </FormDialog>
  );
}

// ============================================================================ e-mail (boleto + fatura + NFS-e)
export function EmailBoletoDialog({ boleto, onClose }: { boleto: BoletoOut | null; onClose: () => void }) {
  const qc = useQueryClient();
  const previa = useQuery({
    queryKey: ["boletos", "email", boleto?.id],
    queryFn: () => api.get<PreviaEmail>(`/boletos/${boleto!.id}/email`),
    enabled: !!boleto,
  });
  const [para, setPara] = useState("");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [tipos, setTipos] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!previa.data) return;
    setPara(previa.data.para.join(", "));
    setAssunto(previa.data.assunto);
    setCorpo(previa.data.corpo);
    setTipos(new Set(previa.data.anexos.map((a) => a.tipo)));
  }, [previa.data]);
  const enviar = useMutation({
    mutationFn: () =>
      api.post<{ mensagem: string }>(`/boletos/${boleto!.id}/enviar-email`, {
        destinatarios: para
          .split(/[,;\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        assunto,
        corpo,
        anexos: [...tipos],
      }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      invalidar(qc);
      onClose();
    },
  });
  const p = previa.data;
  return (
    <FormDialog
      open={!!boleto}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Enviar por e-mail · ${boleto?.seu_numero ?? ""}`}
      descricao="O boleto vai junto com a fatura e a nota fiscal, quando existirem."
      largura="lg"
      salvando={enviar.isPending}
      rotuloSalvar="Enviar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!p?.pode_enviar) return toast.error(p?.aviso ?? "Este boleto ainda não pode ser enviado.");
        enviar.mutate();
      }}
    >
      {!p ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-3">
          {p.aviso && (
            <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {p.aviso}
            </p>
          )}
          <Field label="Para" obrigatorio dica="Separe vários e-mails com vírgula">
            <Input value={para} onChange={(e) => setPara(e.target.value)} placeholder="financeiro@cliente.com.br" required />
          </Field>
          <Field label="Assunto">
            <Input value={assunto} onChange={(e) => setAssunto(e.target.value)} />
          </Field>
          <Field label="Mensagem">
            <Textarea rows={9} value={corpo} onChange={(e) => setCorpo(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] text-foreground/80">Anexos</p>
            <div className="flex flex-wrap gap-3">
              {p.anexos.map((a) => (
                <label key={a.tipo} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <Checkbox
                    checked={tipos.has(a.tipo)}
                    disabled={a.tipo === "boleto"}
                    onCheckedChange={(v) =>
                      setTipos((s) => {
                        const n = new Set(s);
                        if (v) n.add(a.tipo);
                        else n.delete(a.tipo);
                        return n;
                      })
                    }
                  />
                  {a.rotulo}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

// ============================================================================ retorno: enviar o arquivo e ver o resultado
export function RetornoDialog({ open, onOpenChange, verId }: { open: boolean; onOpenChange: (o: boolean) => void; verId?: number | null }) {
  const qc = useQueryClient();
  const convenios = useConvenios();
  const arquivo = useRef<HTMLInputElement>(null);
  const [convenio, setConvenio] = useState("");
  const [resultado, setResultado] = useState<RetornoOut | null>(null);
  const antigo = useQuery({
    queryKey: ["boletos", "retorno", verId],
    queryFn: () => api.get<RetornoOut>(`/boletos/retornos/${verId}`),
    enabled: open && !!verId,
  });
  useEffect(() => {
    if (open) setResultado(null);
  }, [open]);
  const importar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("arquivo", f);
      if (convenio) fd.append("convenio_id", convenio);
      return api.post<RetornoOut>("/boletos/retornos", fd);
    },
    onSuccess: (r) => {
      setResultado(r);
      toast.success("Retorno processado");
      invalidar(qc);
      qc.invalidateQueries({ queryKey: ["faturas"] });
    },
    onSettled: () => {
      if (arquivo.current) arquivo.current.value = "";
    },
  });
  const r = verId ? antigo.data : resultado;
  const c = r?.resumo.contagem;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{r ? `Retorno ${r.nome_arquivo}` : "Importar retorno do banco"}</DialogTitle>
          <DialogDescription>
            {r ? `${r.convenio_nome} · importado em ${dataHora(r.importado_em)}` : "Envie o arquivo .RET baixado no Internet Banking. Importar o mesmo arquivo duas vezes não duplica nada."}
          </DialogDescription>
        </DialogHeader>
        {!r ? (
          <div className="space-y-3">
            {(convenios.data ?? []).length > 1 && (
              <Field label="Convênio" dica="Deixe em branco para o sistema achar pela agência e conta do arquivo">
                <NativeSelect value={convenio} onChange={(e) => setConvenio(e.target.value)}>
                  <option value="">Descobrir pelo arquivo</option>
                  {convenios.data!.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nome}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <input ref={arquivo} type="file" accept=".ret,.RET,.txt,.TXT" className="hidden" onChange={(e) => e.target.files?.[0] && importar.mutate(e.target.files[0])} />
            <Button onClick={() => arquivo.current?.click()} disabled={importar.isPending}>
              {importar.isPending ? <Loader2 className="animate-spin" /> : <FileText />} Escolher arquivo de retorno
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill tom="brand">{c!.registrados} registrado(s)</Pill>
              <Pill tom="success">{c!.pagos} pago(s)</Pill>
              <Pill tom="danger">{c!.rejeitados} rejeitado(s)</Pill>
              <Pill tom="neutral">{c!.baixados} baixado(s)</Pill>
              {c!.alterados > 0 && <Pill tom="info">{c!.alterados} vencimento(s) alterado(s)</Pill>}
              {c!.outras > 0 && <Pill tom="neutral">{c!.outras} outra(s)</Pill>}
              {c!.orfas > 0 && <Pill tom="warning">{c!.orfas} sem boleto no sistema</Pill>}
              {c!.repetidas > 0 && <Pill tom="neutral">{c!.repetidas} já importada(s)</Pill>}
            </div>
            {r.resumo.avisos.map((a) => (
              <p key={a} className="rounded-xl bg-warning/10 p-3 text-warning-ink">
                {a}
              </p>
            ))}
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Boleto</th>
                    <th className="px-3 py-2 font-medium">Pagador</th>
                    <th className="px-3 py-2 font-medium">O que o banco disse</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(r.resumo.linhas ?? []).map((l, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-xs">{l.seu_numero || l.nosso_numero || "—"}</td>
                      <td className="max-w-52 truncate px-3 py-2">{l.pagador}</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          {l.resultado === "pagos" || l.resultado === "registrados" ? <CheckCircle2 className="size-3.5 text-success" /> : null}
                          {ROTULO_RESULTADO[l.resultado]}
                          <span className="text-xs text-muted-foreground">({l.descricao})</span>
                        </span>
                        {l.motivos.map((m) => (
                          <p key={m.codigo} className="text-xs text-danger-ink">
                            {m.descricao} (código {m.codigo})
                          </p>
                        ))}
                        {l.alerta && <p className="text-xs text-warning-ink">{l.alerta}</p>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{moeda(l.valor_pago ?? l.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant={r ? "default" : "outline"} onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================ convênio
const CONVENIO_NOVO: ConvenioIn = {
  nome: "",
  emissora_id: 0,
  conta_bancaria_id: null,
  banco: "033",
  agencia: "",
  agencia_dv: "0",
  conta: "",
  conta_dv: "",
  codigo_beneficiario: "",
  codigo_transmissao: "",
  carteira: "101",
  tipo_cobranca: "5",
  forma_cadastramento: "1",
  tipo_documento: "1",
  especie_titulo: "04",
  numeracao: "EMPRESA",
  proximo_nosso_numero: 1,
  proximo_sequencial_arquivo: 1,
  codigo_juros: "2",
  juros_mensal_pct: "1.00",
  multa_pct: "2.00",
  codigo_protesto: "0",
  dias_protesto: 0,
  codigo_baixa: "1",
  dias_baixa: 60,
  mensagem_1: null,
  mensagem_2: null,
  instrucoes: null,
  pix_habilitado: false,
  pix_chave_tipo: null,
  pix_chave: null,
  ativo: true,
  homologado: false,
};

export function ConvenioDialog({ open, onOpenChange, convenio }: { open: boolean; onOpenChange: (o: boolean) => void; convenio: ConvenioOut | null }) {
  const qc = useQueryClient();
  const bancos = useQuery({ queryKey: ["boletos", "bancos"], queryFn: () => api.get<BancoBoleto[]>("/boletos/bancos"), enabled: open });
  const emissoras = useQuery({ queryKey: ["emissoras"], queryFn: () => api.get<EmissoraOut[]>("/nfse/emissoras"), enabled: open });
  const contas = useQuery({ queryKey: ["fin", "contas"], queryFn: () => api.get<ContaOut[]>("/financeiro/contas"), enabled: open });
  const [f, setF] = useState<ConvenioIn>(CONVENIO_NOVO);
  const set = <K extends keyof ConvenioIn>(k: K, v: ConvenioIn[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!open) return;
    if (convenio) {
      // só os campos do formulário (o que é calculado pelo servidor fica de fora)
      setF(Object.fromEntries(Object.entries(convenio).filter(([k]) => k in CONVENIO_NOVO)) as unknown as ConvenioIn);
    } else setF(CONVENIO_NOVO);
  }, [open, convenio]);
  useEffect(() => {
    if (open && !convenio && !f.emissora_id && emissoras.data?.length) set("emissora_id", emissoras.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, convenio, emissoras.data]);
  const op = bancos.data?.find((b) => b.codigo === f.banco)?.opcoes ?? {};
  const opcoes = (k: string) => Object.entries(op[k] ?? {});
  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { ...f, mensagem_1: f.mensagem_1 || null, mensagem_2: f.mensagem_2 || null, instrucoes: f.instrucoes || null, pix_chave: f.pix_chave || null, pix_chave_tipo: f.pix_chave_tipo || null };
      return convenio ? api.put<ConvenioOut>(`/boletos/convenios/${convenio.id}`, corpo) : api.post<ConvenioOut>("/boletos/convenios", corpo);
    },
    onSuccess: () => {
      toast.success(convenio ? "Convênio alterado" : "Convênio cadastrado");
      invalidar(qc);
      onOpenChange(false);
    },
  });
  const texto = (k: keyof ConvenioIn, label: string, extra?: { obrigatorio?: boolean; dica?: string; max?: number; className?: string }) => (
    <Field label={label} obrigatorio={extra?.obrigatorio} dica={extra?.dica} className={extra?.className}>
      <Input value={(f[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} maxLength={extra?.max} required={extra?.obrigatorio} />
    </Field>
  );
  const escolha = (k: keyof ConvenioIn, label: string, tabela: string, dica?: string) => (
    <Field label={label} dica={dica}>
      <NativeSelect value={(f[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)}>
        {opcoes(tabela).map(([v, r]) => (
          <option key={v} value={v}>
            {r}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo={convenio ? `Convênio ${convenio.nome}` : "Novo convênio"}
      descricao="Os códigos vêm do contrato de cobrança com o banco (peça ao gerente)."
      largura="xl"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!f.emissora_id) return toast.error("Escolha a empresa emissora.");
        salvar.mutate();
      }}
    >
      <div className="space-y-5">
        <FormSection titulo="Conta de cobrança">
          <div className="grid gap-3 sm:grid-cols-6">
            {texto("nome", "Apelido", { obrigatorio: true, className: "sm:col-span-2", max: 120 })}
            <Field label="Banco" className="sm:col-span-2">
              <NativeSelect value={f.banco} onChange={(e) => set("banco", e.target.value)}>
                {(bancos.data ?? []).map((b) => (
                  <option key={b.codigo} value={b.codigo}>
                    {b.codigo} · {b.nome}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Beneficiário (empresa emissora)" obrigatorio className="sm:col-span-2">
              <NativeSelect value={f.emissora_id || ""} onChange={(e) => set("emissora_id", Number(e.target.value))}>
                <option value="">Escolha…</option>
                {(emissoras.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razao_social}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {texto("agencia", "Agência", { obrigatorio: true, max: 4 })}
            {texto("agencia_dv", "Dígito", { obrigatorio: true, max: 1 })}
            {texto("conta", "Conta", { obrigatorio: true, max: 9, className: "sm:col-span-2" })}
            {texto("conta_dv", "Dígito", { obrigatorio: true, max: 1 })}
            <span />
            {texto("codigo_beneficiario", "Código do beneficiário", { obrigatorio: true, max: 7, className: "sm:col-span-2", dica: "Vai no código de barras" })}
            {texto("codigo_transmissao", "Código de transmissão", { obrigatorio: true, max: 15, className: "sm:col-span-2", dica: "Vai no cabeçalho da remessa" })}
            <Field label="O crédito cai em" className="sm:col-span-2" dica="Conta do Financeiro que recebe os pagamentos">
              <NativeSelect value={f.conta_bancaria_id ?? ""} onChange={(e) => set("conta_bancaria_id", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Conta de recebimento padrão</option>
                {(contas.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </FormSection>

        <FormSection titulo="Parâmetros da cobrança" descricao="Já vêm com o mais comum para honorários. Confirme com o banco antes da primeira remessa.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Carteira">
              <NativeSelect
                value={f.carteira}
                onChange={(e) => {
                  const cart = e.target.value;
                  setF((x) => ({ ...x, carteira: cart, tipo_cobranca: op.tipo_cobranca_da_carteira?.[cart] ?? x.tipo_cobranca }));
                }}
              >
                {opcoes("carteira").map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {escolha("tipo_cobranca", "Tipo de cobrança", "tipo_cobranca")}
            {escolha("forma_cadastramento", "Forma de cadastramento", "forma_cadastramento")}
            {escolha("tipo_documento", "Tipo de documento", "tipo_documento")}
            {escolha("especie_titulo", "Espécie do título", "especie_titulo", "Honorários = duplicata de serviço")}
            <Field label="Quem numera o boleto" dica="Pela empresa, o PDF sai antes do retorno do banco">
              <NativeSelect value={f.numeracao} onChange={(e) => set("numeracao", e.target.value as "EMPRESA" | "BANCO")}>
                <option value="EMPRESA">O sistema (recomendado)</option>
                <option value="BANCO">O banco</option>
              </NativeSelect>
            </Field>
            {escolha("codigo_juros", "Juros de mora", "codigo_juros")}
            <Field label="Juros ao mês (%)">
              <Input inputMode="decimal" value={f.juros_mensal_pct} onChange={(e) => set("juros_mensal_pct", e.target.value.replace(",", "."))} />
            </Field>
            <Field label="Multa (%)">
              <Input inputMode="decimal" value={f.multa_pct} onChange={(e) => set("multa_pct", e.target.value.replace(",", "."))} />
            </Field>
            {escolha("codigo_protesto", "Protesto", "codigo_protesto")}
            <Field label="Dias para protesto">
              <Input type="number" min={0} max={99} value={f.dias_protesto} onChange={(e) => set("dias_protesto", Number(e.target.value))} />
            </Field>
            <span />
            {escolha("codigo_baixa", "Baixa/devolução", "codigo_baixa")}
            <Field label="Dias para baixa">
              <Input type="number" min={0} max={99} value={f.dias_baixa} onChange={(e) => set("dias_baixa", Number(e.target.value))} />
            </Field>
          </div>
        </FormSection>

        <FormSection titulo="Numeração e mensagens">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Próximo nosso número" dica="Nunca volta: número de boleto não é reaproveitado">
              <Input type="number" min={1} value={f.proximo_nosso_numero} onChange={(e) => set("proximo_nosso_numero", Number(e.target.value))} />
            </Field>
            <Field label="Próxima remessa (sequencial)">
              <Input type="number" min={1} value={f.proximo_sequencial_arquivo} onChange={(e) => set("proximo_sequencial_arquivo", Number(e.target.value))} />
            </Field>
            {texto("mensagem_1", "Mensagem 1 (até 40 letras)", { max: 40 })}
            {texto("mensagem_2", "Mensagem 2 (até 40 letras)", { max: 40 })}
            <Field label="Instruções no boleto" className="sm:col-span-2">
              <Textarea rows={2} value={f.instrucoes ?? ""} onChange={(e) => set("instrucoes", e.target.value)} maxLength={600} />
            </Field>
          </div>
        </FormSection>

        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchRow titulo="Homologado pelo banco" descricao="Enquanto desligado, toda remessa sai marcada como TESTE.">
            <Switch checked={f.homologado} onCheckedChange={(v) => set("homologado", !!v)} />
          </SwitchRow>
          <SwitchRow titulo="Ativo" descricao="Convênio inativo não gera boleto novo.">
            <Switch checked={f.ativo} onCheckedChange={(v) => set("ativo", !!v)} />
          </SwitchRow>
        </div>
        {convenio && convenio.pendencias.length > 0 && (
          <div className="rounded-xl bg-warning/10 p-3 text-sm text-warning-ink">
            <p className="font-medium">Falta para poder emitir:</p>
            <ul className="mt-1 list-disc pl-5">
              {convenio.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </FormDialog>
  );
}

