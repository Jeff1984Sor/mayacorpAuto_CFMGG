"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { abrirArquivo, api, baixar } from "@/lib/api";
import type { NfseOut } from "@/lib/types";

export function SelosNota({ n }: { n: Pick<NfseOut, "simulada"> }) {
  return n.simulada ? (
    <Pill tom="warning" className="ml-1.5">
      Simulação
    </Pill>
  ) : null;
}

export function useAcoesNota() {
  const qc = useQueryClient();
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["notas"] });
    qc.invalidateQueries({ queryKey: ["nota"] });
    qc.invalidateQueries({ queryKey: ["painel"] });
  };
  return {
    pdf: (n: Pick<NfseOut, "id">) =>
      abrirArquivo(`/nfse/notas/${n.id}/pdf`).catch((e: Error) => toast.error(e.message)),
    xml: (n: Pick<NfseOut, "id" | "numero">) =>
      baixar(`/nfse/notas/${n.id}/xml`, {}, `nfse-${n.numero}.xml`).catch((e: Error) => toast.error(e.message)),
    prefeitura: (n: Pick<NfseOut, "link_prefeitura">) => window.open(n.link_prefeitura, "_blank", "noopener"),
    email: useMutation({
      mutationFn: ({ id, destinatarios }: { id: number; destinatarios?: string[] }) =>
        api.post(`/nfse/notas/${id}/enviar-email`, destinatarios ? { destinatarios } : {}),
      onSuccess: () => {
        toast.success("E-mail enviado ao tomador");
        invalidar();
      },
    }),
    zip: useMutation({
      mutationFn: (ids: number[]) => baixar("/nfse/notas/zip", { method: "POST", body: { ids } }, "notas.zip"),
      onSuccess: () => toast.success("ZIP baixado"),
    }),
    exportar: useMutation({
      mutationFn: (ids: number[]) => baixar("/nfse/notas/exportar", { method: "POST", body: { ids } }, "notas.xlsx"),
    }),
    invalidar,
  };
}

export function CancelarNotaDialog({
  nota,
  onClose,
}: {
  nota: Pick<NfseOut, "id" | "numero"> | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const cancelar = useMutation({
    mutationFn: () => api.post(`/nfse/notas/${nota!.id}/cancelar`, { motivo }),
    onSuccess: () => {
      toast.success(`NFS-e ${nota!.numero} cancelada`);
      qc.invalidateQueries({ queryKey: ["notas"] });
      qc.invalidateQueries({ queryKey: ["nota"] });
      setMotivo("");
      onClose();
    },
  });
  return (
    <ConfirmDialog
      open={!!nota}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Cancelar a NFS-e ${nota?.numero ?? ""}?`}
      descricao="O cancelamento é enviado à Prefeitura e fica registrado na auditoria. Não é possível desfazer."
      confirmar="Cancelar nota"
      destrutivo
      carregando={cancelar.isPending}
      desabilitado={motivo.trim().length < 10}
      onConfirm={() => cancelar.mutate()}
    >
      <Field label="Motivo do cancelamento" obrigatorio dica={`${motivo.trim().length}/10 caracteres no mínimo`}>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: serviço não prestado, valor incorreto…" />
      </Field>
    </ConfirmDialog>
  );
}

/** Cancela várias notas, uma por vez (cada uma vai à Prefeitura), mostrando o andamento e o que não deu certo. */
export function CancelarNotasLoteDialog({
  notas,
  onClose,
  onConcluido,
}: {
  notas: Pick<NfseOut, "id" | "numero" | "status">[] | null;
  onClose: () => void;
  onConcluido?: () => void;
}) {
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [feitas, setFeitas] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [falhas, setFalhas] = useState<{ numero: number; mensagem: string }[] | null>(null);
  const alvo = (notas ?? []).filter((n) => n.status === "emitida");
  const ignoradas = (notas?.length ?? 0) - alvo.length;

  const fechar = () => {
    if (rodando) return;
    setMotivo("");
    setFeitas(0);
    setFalhas(null);
    onClose();
  };
  const executar = async () => {
    setRodando(true);
    setFeitas(0);
    const erros: { numero: number; mensagem: string }[] = [];
    for (const n of alvo) {
      try {
        await api.post(`/nfse/notas/${n.id}/cancelar`, { motivo });
      } catch (e) {
        erros.push({ numero: n.numero, mensagem: (e as Error).message });
      }
      setFeitas((x) => x + 1);
    }
    setRodando(false);
    for (const k of ["notas", "nota", "painel", "faturas", "fluxo"]) qc.invalidateQueries({ queryKey: [k] });
    const ok = alvo.length - erros.length;
    if (ok) toast.success(`${ok} NFS-e cancelada${ok > 1 ? "s" : ""}`);
    onConcluido?.();
    if (erros.length) setFalhas(erros);
    else {
      setMotivo("");
      setFeitas(0);
      onClose();
    }
  };

  if (falhas) {
    return (
      <ConfirmDialog
        open={!!notas}
        onOpenChange={(o) => !o && fechar()}
        titulo={`${falhas.length} nota${falhas.length > 1 ? "s" : ""} não ${falhas.length > 1 ? "foram canceladas" : "foi cancelada"}`}
        descricao="As demais foram canceladas. Veja o motivo de cada uma e tente de novo, se for o caso."
        confirmar="Entendi"
        onConfirm={fechar}
      >
        <ul className="max-h-60 space-y-1.5 overflow-y-auto text-sm">
          {falhas.map((f) => (
            <li key={f.numero} className="rounded-lg bg-muted/40 px-3 py-2">
              <span className="num font-medium">NFS-e {f.numero}</span>
              <span className="text-muted-foreground"> — {f.mensagem}</span>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog
      open={!!notas}
      onOpenChange={(o) => !o && fechar()}
      titulo={`Cancelar ${alvo.length} NFS-e?`}
      descricao={
        <>
          Cada cancelamento é enviado à Prefeitura e fica registrado na auditoria. Não é possível desfazer.
          {ignoradas > 0 && ` ${ignoradas} nota(s) já cancelada(s) na seleção ficam de fora.`}
        </>
      }
      confirmar={rodando ? `Cancelando ${Math.min(feitas + 1, alvo.length)} de ${alvo.length}…` : `Cancelar ${alvo.length} nota${alvo.length > 1 ? "s" : ""}`}
      destrutivo
      carregando={rodando}
      desabilitado={motivo.trim().length < 10 || alvo.length === 0}
      onConfirm={executar}
    >
      <p className="text-xs text-muted-foreground num">
        {alvo.slice(0, 12).map((n) => n.numero).join(", ")}
        {alvo.length > 12 && ` e mais ${alvo.length - 12}`}
      </p>
      <Field label="Motivo do cancelamento (vale para todas)" obrigatorio dica={`${motivo.trim().length}/10 caracteres no mínimo`}>
        <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={rodando} placeholder="Ex.: serviço não prestado, valor incorreto…" />
      </Field>
      {rodando && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-danger transition-all" style={{ width: `${(feitas / Math.max(alvo.length, 1)) * 100}%` }} />
        </div>
      )}
    </ConfirmDialog>
  );
}
