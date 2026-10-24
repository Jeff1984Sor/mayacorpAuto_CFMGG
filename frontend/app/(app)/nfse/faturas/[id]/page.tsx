"use client";

import { ChamarAlguem } from "@/components/comunicador/chamar-alguem";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  FileSignature,
  Pencil,
  QrCode,
  ReceiptText,
  Undo2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useEmitirNfse } from "@/components/faturamento/emitir";
import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { abrirArquivo, api, baixar, baixarBlob } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, documento, moeda, toNum } from "@/lib/format";
import type { ContaOut } from "@/lib/financeiro";
import type { FaturaOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const hoje = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local

function PdfInline({ id, versao }: { id: number; versao: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    let atual: string | null = null;
    baixarBlob(`/nfse/faturas/${id}/pdf`)
      .then(({ blob }) => {
        atual = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        if (vivo) setUrl(atual);
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
      if (atual) URL.revokeObjectURL(atual);
    };
  }, [id, versao]);
  if (erro) return <div className="grid h-full place-items-center text-sm text-muted-foreground">Não foi possível carregar o PDF.</div>;
  if (!url) return <Skeleton className="size-full rounded-none" />;
  return <iframe src={`${url}#toolbar=0&view=FitH`} title="Fatura em PDF" className="size-full bg-white" />;
}

export default function FaturaDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const fid = Number(id);
  const qc = useQueryClient();
  const { isAdmin, isOperador } = useAuth();
  const q = useQuery({ queryKey: ["fatura", fid], queryFn: () => api.get<FaturaOut>(`/nfse/faturas/${fid}`) });
  const f = q.data;
  const [editar, setEditar] = useState(false);
  const [pagar, setPagar] = useState(false);
  const [desfazer, setDesfazer] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [form, setForm] = useState({ venc: "", desconto: "", juros: "" });
  const [baixa, setBaixa] = useState({ data: hoje(), valor: "", conta: "" });
  const [cancelar, setCancelar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const emitir = useEmitirNfse();
  const contas = useQuery({ queryKey: ["fin", "contas"], queryFn: () => api.get<ContaOut[]>("/financeiro/contas"), enabled: pagar, meta: { silencioso: true } });

  const aplicar = (nova: FaturaOut, msg: string) => {
    qc.setQueryData(["fatura", fid], nova);
    qc.invalidateQueries({ queryKey: ["faturas"] });
    qc.invalidateQueries({ queryKey: ["faturas-resumo"] });
    qc.invalidateQueries({ queryKey: ["notas"] });
    qc.invalidateQueries({ queryKey: ["nota"] });
    qc.invalidateQueries({ queryKey: ["painel"] });
    toast.success(msg);
  };
  const salvar = useMutation({
    mutationFn: () =>
      api.patch<FaturaOut>(`/nfse/faturas/${fid}`, {
        data_vencimento: form.venc,
        desconto: toNum(form.desconto.replace(",", ".")).toFixed(2),
        juros: toNum(form.juros.replace(",", ".")).toFixed(2),
      }),
    onSuccess: (r) => {
      aplicar(r, "Fatura atualizada");
      setEditar(false);
    },
  });
  const registrar = useMutation({
    mutationFn: () =>
      api.post<FaturaOut>(`/nfse/faturas/${fid}/baixa`, {
        data: baixa.data,
        valor: baixa.valor ? toNum(baixa.valor.replace(",", ".")).toFixed(2) : null,
        conta_bancaria_id: baixa.conta ? Number(baixa.conta) : null,
      }),
    onSuccess: (r) => {
      aplicar(r, "Pagamento registrado");
      setPagar(false);
    },
  });
  const cancelarFatura = useMutation({
    mutationFn: () => api.post<{ mensagem: string }>(`/faturamento/faturas/${fid}/cancelar`, { motivo: motivo.trim() }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      q.refetch();
      qc.invalidateQueries({ queryKey: ["faturas"] });
      qc.invalidateQueries({ queryKey: ["faturas-resumo"] });
      qc.invalidateQueries({ queryKey: ["fat"] });
      setCancelar(false);
    },
  });
  const estornar = useMutation({
    mutationFn: () => api.del<FaturaOut>(`/nfse/faturas/${fid}/baixa`),
    onSuccess: (r) => {
      aplicar(r, "Pagamento desfeito");
      setDesfazer(false);
    },
  });

  if (!f)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-96" />
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Skeleton className="h-[640px] rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );

  const aberta = f.status === "aberta";
  const copiarPix = async () => {
    if (!f.pix_copia_e_cola) return;
    await navigator.clipboard.writeText(f.pix_copia_e_cola);
    setCopiado(true);
    toast.success("PIX copia e cola copiado");
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{f.codigo}</Mono> <StatusBadge status={f.situacao} />
            {f.simulada && <Pill tom="warning">Simulação</Pill>}
          </span>
        }
        descricao={`${f.tipo === "despesas" ? "Nota de Despesas" : "Nota de Honorários"} de ${f.tomador_nome}${f.nfse_numero ? ` · NFS-e ${f.nfse_numero}` : f.tipo === "honorarios" ? " · sem NFS-e" : ""}${f.contrato_nome ? ` · ${f.contrato_nome}` : ""}`}
        icone={ReceiptText}
        migalhas={[
          { label: "NFS-e", href: "/nfse" },
          { label: "Faturas", href: "/nfse/faturas" },
          { label: f.codigo },
        ]}
        acoes={
          <>
            <ChamarAlguem origemTipo="fatura" origemId={f.id} contexto={`a fatura ${f.codigo}`} />
            <Button variant="outline" onClick={() => abrirArquivo(`/nfse/faturas/${fid}/pdf`)}>
              <ExternalLink /> Abrir PDF
            </Button>
            <Button variant="outline" onClick={() => baixar(`/nfse/faturas/${fid}/pdf`, {}, `${f.codigo.replace(/\W+/g, "_")}.pdf`)}>
              <Download /> Baixar
            </Button>
            {isOperador && aberta && (
              <Button
                onClick={() => {
                  setBaixa({ data: hoje(), valor: "", conta: "" });
                  setPagar(true);
                }}
              >
                <Banknote /> Registrar pagamento
              </Button>
            )}
            {isOperador && f.pode_emitir_nfse && (
              <Button variant="outline" onClick={() => emitir.mutate([f.id])} disabled={emitir.isPending}>
                <FileCheck2 /> Emitir NFS-e
              </Button>
            )}
            {isAdmin && f.origem === "faturamento" && !f.nfse_id && f.status === "aberta" && (
              <Button variant="ghost" className="text-danger-ink" onClick={() => setCancelar(true)}>
                <X /> Cancelar fatura
              </Button>
            )}
            {isAdmin && f.status === "paga" && (
              <Button variant="destructive" onClick={() => setDesfazer(true)}>
                <Undo2 /> Desfazer pagamento
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="card-surface h-[72dvh] min-h-[560px] overflow-hidden">
          <PdfInline id={fid} versao={`${f.status}-${f.data_vencimento}-${f.total}`} />
        </div>

        <div className="space-y-4">
          <div className="card-surface overflow-hidden">
            <div className={cn("h-1.5", f.situacao === "paga" ? "bg-success" : f.situacao === "vencida" ? "bg-danger" : "brand-gradient")} />
            <div className="p-5">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Total</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight num">{moeda(f.total)}</p>
              <dl className="mt-4 space-y-2 text-sm">
                {[
                  ["Valor dos serviços", moeda(f.valor)],
                  ["Desconto", toNum(f.desconto) ? `− ${moeda(f.desconto)}` : "—"],
                  ["Juros / multa", toNum(f.juros) ? `+ ${moeda(f.juros)}` : "—"],
                  ["Emissão", data(f.data_emissao)],
                  ["Vencimento", data(f.data_vencimento)],
                  ...(f.pago_em ? [["Pago em", data(f.pago_em)]] : []),
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">{l}</dt>
                    <dd
                      className={cn(
                        "font-medium num",
                        l === "Vencimento" && f.situacao === "vencida" && "text-danger-ink",
                        l === "Pago em" && "text-success-ink",
                      )}
                    >
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
              {isOperador && aberta && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 w-full"
                  onClick={() => {
                    setForm({
                      venc: f.data_vencimento,
                      desconto: toNum(f.desconto).toFixed(2).replace(".", ","),
                      juros: toNum(f.juros).toFixed(2).replace(".", ","),
                    });
                    setEditar(true);
                  }}
                >
                  <Pencil /> Editar vencimento, desconto e juros
                </Button>
              )}
            </div>
          </div>

          {f.pix_copia_e_cola && aberta && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card-surface p-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <QrCode className="size-4 text-info-ink" /> PIX copia e cola
              </h3>
              <p className="mt-2 line-clamp-3 rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] break-all text-muted-foreground">
                {f.pix_copia_e_cola}
              </p>
              <Button className="mt-3 w-full" onClick={copiarPix}>
                {copiado ? <Check /> : <Copy />} {copiado ? "Copiado!" : "Copiar código PIX"}
              </Button>
            </motion.div>
          )}

          <div className="card-surface p-5 text-sm">
            <h3 className="mb-2 font-semibold">Cliente</h3>
            <p className="font-medium">{f.tomador_nome}</p>
            <p className="text-muted-foreground num">{documento(f.tomador_doc)}</p>
            <div className="mt-4 flex flex-col gap-1.5 border-t pt-4">
              {f.nfse_id ? (
                <Link href={`/nfse/notas/${f.nfse_id}`} className="inline-flex items-center gap-2 text-info-ink hover:underline">
                  <FileCheck2 className="size-4" /> NFS-e {f.nfse_numero}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <FileCheck2 className="size-4" /> {f.tipo === "despesas" ? "ND não tem NFS-e" : "Ainda sem NFS-e"}
                </span>
              )}
              {f.lote_id && (
                <Link href={`/nfse/lotes/${f.lote_id}`} className="inline-flex items-center gap-2 text-info-ink hover:underline">
                  <CalendarClock className="size-4" /> Lote de origem
                </Link>
              )}
              {f.contrato_id && (
                <Link href={`/faturamento/contratos/${f.contrato_id}`} className="inline-flex items-center gap-2 text-info-ink hover:underline">
                  <FileSignature className="size-4" /> Contrato {f.contrato_nome}
                </Link>
              )}
            </div>
            {f.descricao && <p className="mt-4 border-t pt-4 text-xs whitespace-pre-wrap text-muted-foreground">{f.descricao}</p>}
          </div>
        </div>
      </div>

      <FormDialog
        open={editar}
        onOpenChange={setEditar}
        titulo="Editar fatura"
        descricao="O PDF é regenerado com os novos valores."
        salvando={salvar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          salvar.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Vencimento">
            <Input type="date" value={form.venc} onChange={(e) => setForm({ ...form, venc: e.target.value })} />
          </Field>
          <Field label="Desconto (R$)">
            <Input inputMode="decimal" value={form.desconto} onChange={(e) => setForm({ ...form, desconto: e.target.value })} className="num" />
          </Field>
          <Field label="Juros / multa (R$)">
            <Input inputMode="decimal" value={form.juros} onChange={(e) => setForm({ ...form, juros: e.target.value })} className="num" />
          </Field>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Novo total:{" "}
          <strong className="text-foreground num">
            {moeda(toNum(f.valor) - toNum(form.desconto.replace(",", ".")) + toNum(form.juros.replace(",", ".")))}
          </strong>
        </p>
      </FormDialog>

      <FormDialog
        open={pagar}
        onOpenChange={setPagar}
        titulo="Registrar pagamento"
        descricao="Baixa manual — use quando o pagamento não veio pelo extrato."
        rotuloSalvar="Registrar"
        salvando={registrar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          registrar.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data do pagamento">
            <Input type="date" value={baixa.data} max={hoje()} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} />
          </Field>
          <Field label="Valor recebido" dica={`Vazio = total (${moeda(f.total)})`}>
            <Input inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} placeholder={toNum(f.total).toFixed(2).replace(".", ",")} className="num" />
          </Field>
          {(contas.data?.length ?? 0) > 0 && (
            <Field label="Conta bancária" htmlFor="baixa-conta" dica="Onde o dinheiro entrou. Vazio = conta padrão de recebimento." className="sm:col-span-2">
              <NativeSelect id="baixa-conta" value={baixa.conta} onChange={(e) => setBaixa({ ...baixa, conta: e.target.value })}>
                <option value="">Conta padrão</option>
                {contas.data
                  ?.filter((c) => c.ativo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.banco ? ` · ${c.banco}` : ""}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={cancelar}
        onOpenChange={(o) => {
          setCancelar(o);
          if (!o) setMotivo("");
        }}
        titulo={`Cancelar a ${f.codigo}?`}
        descricao="Os itens voltam para Itens a faturar e podem ser faturados de novo. Fica registrado na auditoria."
        confirmar="Cancelar fatura"
        destrutivo
        carregando={cancelarFatura.isPending}
        desabilitado={motivo.trim().length < 3}
        onConfirm={() => cancelarFatura.mutate()}
      >
        <Field label="Motivo" obrigatorio htmlFor="cancelar-motivo" dica="Mínimo de 3 letras.">
          <Textarea id="cancelar-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
      </ConfirmDialog>
      <ConfirmDialog
        open={desfazer}
        onOpenChange={setDesfazer}
        titulo="Desfazer o pagamento?"
        descricao="A fatura volta a ficar em aberto e a nota deixa de constar como paga. Fica registrado na auditoria."
        confirmar="Desfazer pagamento"
        destrutivo
        carregando={estornar.isPending}
        onConfirm={() => estornar.mutate()}
      />
    </div>
  );
}
