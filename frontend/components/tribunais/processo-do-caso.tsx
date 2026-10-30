"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bell, FileDown, Landmark, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativo } from "@/lib/format";
import { CHAVE, JANELA_MS, msDesdeImportacaoDoCaso, type ProcessoDetalhe, rotuloGrau, rotuloSistema, useProcessoDoCaso } from "@/lib/tribunais";

/** Cartão "Processo no tribunal" da ficha do caso. */
export function ProcessoDoCaso({ casoId, numeroProcesso }: { casoId: number; numeroProcesso: string | null }) {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const digitos = (numeroProcesso ?? "").replace(/\D/g, "");
  // caso salvo com nº CNJ: o backend importa o processo em segundo plano; acompanha por até 2 min
  const [janela, setJanela] = useState(() => msDesdeImportacaoDoCaso(casoId) < JANELA_MS);
  useEffect(() => {
    const passou = msDesdeImportacaoDoCaso(casoId);
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reabre a janela quando o caso é salvo de novo */
    setJanela(passou < JANELA_MS);
    if (passou >= JANELA_MS) return;
    const t = setTimeout(() => setJanela(false), JANELA_MS - passou);
    return () => clearTimeout(t);
  }, [casoId, digitos]);
  const ativo = janela && digitos.length === 20;
  const q = useProcessoDoCaso(casoId, true, (p) => (!p && ativo ? 5_000 : false));
  const aguardando = ativo && !q.data;
  // quando o processo aparece, recarrega andamentos e anexos do caso
  const tinha = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const atual = q.data?.id ?? null;
    if (tinha.current === null && atual) {
      qc.invalidateQueries({ queryKey: ["fat", "andamentos", casoId] });
      qc.invalidateQueries({ queryKey: ["fat", "anexos", casoId] });
      qc.invalidateQueries({ queryKey: ["fat", "caso", casoId] });
    }
    if (q.isSuccess) tinha.current = atual;
  }, [q.data, q.isSuccess, qc, casoId]);
  const importar = useMutation({
    mutationFn: async () => {
      const p = await api.post<ProcessoDetalhe>("/tribunais/processos/importar", { numero_cnj: digitos });
      // a importação já liga sozinha quando o número bate; senão, liga aqui
      if (!p.caso_id) return api.post<ProcessoDetalhe>(`/tribunais/processos/${p.id}/ligar-caso`, { caso_id: casoId });
      return p;
    },
    onSuccess: (p) => {
      if (p.caso_id && p.caso_id !== casoId) toast.warning(`O processo foi importado, mas já está ligado ao caso #${p.caso_numero}.`);
      else toast.success("Processo importado do tribunal", { description: "As movimentações entraram como andamentos do caso." });
      qc.invalidateQueries({ queryKey: [CHAVE] });
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });

  if (q.isPending || q.isError) return null;
  const p = q.data;
  if (!p) {
    if (digitos.length !== 20) return null;
    if (aguardando)
      return (
        <div className="card-surface mb-5 flex items-center gap-3 p-4 text-sm text-info-ink">
          <Loader2 className="size-4 shrink-0 animate-spin" /> Buscando o processo <span className="font-mono">{numeroProcesso}</span> no tribunal: andamentos e
          arquivos aparecem no caso em instantes.
        </div>
      );
    if (!pode("trib_processos.importar")) return null;
    return (
      <div className="card-surface mb-5 flex flex-wrap items-center gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-navy dark:text-brand">
          <Landmark className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          O processo <span className="font-mono text-foreground">{numeroProcesso}</span> ainda não é acompanhado no tribunal.
        </p>
        <Button variant="outline" size="sm" disabled={importar.isPending} onClick={() => importar.mutate()}>
          {importar.isPending ? <Loader2 className="animate-spin" /> : <FileDown />} Importar do tribunal
        </Button>
      </div>
    );
  }
  const corpo = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-navy dark:text-brand">
        <Landmark className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Processo no tribunal</span>
          <span className="font-mono text-sm font-medium">{p.numero_formatado}</span>
          <Pill tom="brand">{p.tribunal}</Pill>
          {p.nivel_sigilo > 0 && <Lock className="size-3.5 text-warning-ink" aria-label="Sigiloso" />}
          {p.movimentacoes_nao_lidas > 0 && (
            <span className="inline-flex h-5 items-center gap-0.5 rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger-ink">
              <Bell className="size-3" /> {p.movimentacoes_nao_lidas} não lida(s)
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {[rotuloSistema(p.sistema), rotuloGrau(p.grau), p.orgao_julgador].filter(Boolean).join(" · ")}
          {` · sincronizado ${relativo(p.ultima_sincronizacao)}`}
        </span>
      </span>
    </>
  );
  return pode("trib_processos.ver") ? (
    <Link href={`/tribunais/processos/${p.id}`} className="group card-surface mb-5 flex items-center gap-3 p-4 transition-all hover:border-brand/40">
      {corpo}
      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
    </Link>
  ) : (
    <div className="card-surface mb-5 flex items-center gap-3 p-4">{corpo}</div>
  );
}
