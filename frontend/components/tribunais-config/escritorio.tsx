"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, FlaskConical, Loader2, Lock, Rocket, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, SwitchRow } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { chaveProtocolos, type ConfigTribunais, useConfigTribunais } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const FRASE = "PROTOCOLAR DE VERDADE";

type Modo = ConfigTribunais["modo"];

function Formulario({ cfg, podeEditar, irConsumo }: { cfg: ConfigTribunais; podeEditar: boolean; irConsumo: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(cfg);
  const [confirmar, setConfirmar] = useState(false);
  const [frase, setFrase] = useState("");
  const salvar = useMutation({
    mutationFn: (body: ConfigTribunais) =>
      api.put<ConfigTribunais>("/tribunais/config", {
        modo: body.modo,
        sincronizar_auto: body.sincronizar_auto,
        criar_andamentos: body.criar_andamentos,
        vincular_automatico: body.vincular_automatico,
        limiar_fuzzy: body.limiar_fuzzy,
      }),
    onSuccess: (r) => {
      qc.setQueryData([chaveProtocolos, "config"], r);
      setF(r);
      setConfirmar(false);
      setFrase("");
      toast.success(r.modo === "real" ? "Modo real ligado: os protocolos vão de verdade aos tribunais" : "Configuração salva");
    },
  });
  const escolher = (m: Modo) => {
    if (!podeEditar || m === cfg.modo || salvar.isPending) return;
    if (m === "real") setConfirmar(true);
    else salvar.mutate({ ...f, modo: m });
  };
  const sujo = JSON.stringify({ ...f, modo: cfg.modo }) !== JSON.stringify(cfg);

  const MODOS: { m: Modo; icone: typeof Rocket; titulo: string; texto: string }[] = [
    { m: "simulado", icone: FlaskConical, titulo: "Simulado", texto: "O robô faz todo o caminho — valida, assina e gera recibo — sem enviar nada ao tribunal. Para treinar e homologar." },
    { m: "real", icone: Rocket, titulo: "Real", texto: "As petições aprovadas pelo advogado são assinadas e protocoladas de verdade nos tribunais." },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {MODOS.map(({ m, icone: Icone, titulo, texto }) => {
          const ativo = cfg.modo === m;
          const bloqueado = m === "real" && !cfg.modo_real_disponivel;
          const card = (
            <button
              type="button"
              disabled={bloqueado || !podeEditar || salvar.isPending}
              onClick={() => escolher(m)}
              className={cn(
                "relative flex h-full w-full flex-col rounded-2xl border bg-card p-5 text-left transition-all",
                ativo && "border-transparent shadow-lg ring-2 ring-brand",
                !ativo && !bloqueado && podeEditar && "hover:-translate-y-0.5 hover:border-brand/40",
                bloqueado && "cursor-not-allowed opacity-55",
              )}
            >
              <div className="flex items-start justify-between">
                <div
                  className={cn(
                    "grid size-11 place-items-center rounded-xl ring-1 ring-inset",
                    m === "real" ? "bg-success/12 text-success-ink ring-success/35" : "bg-warning/12 text-warning-ink ring-warning/35",
                  )}
                >
                  <Icone className="size-5" />
                </div>
                {ativo ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground">
                    <Check className="size-3.5" /> Em uso
                  </span>
                ) : bloqueado ? (
                  <Lock className="size-4 text-muted-foreground" />
                ) : null}
              </div>
              <h3 className="mt-4 text-lg font-semibold">{titulo}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{texto}</p>
              {bloqueado && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Só existe no servidor de produção. Aqui ({cfg.ambiente}) o protocolo é sempre simulado.
                </p>
              )}
            </button>
          );
          return bloqueado ? (
            <Tooltip key={m}>
              <TooltipTrigger render={<div />}>{card}</TooltipTrigger>
              <TooltipContent>Disponível só no servidor de produção</TooltipContent>
            </Tooltip>
          ) : (
            <div key={m}>{card}</div>
          );
        })}
      </div>

      <fieldset disabled={!podeEditar} className="card-surface min-w-0 space-y-3 p-5">
        <h3 className="font-semibold">Acompanhamento dos processos</h3>
        <SwitchRow titulo="Sincronizar sozinho todo dia" descricao="Busca andamentos e intimações novas dos processos monitorados.">
          <Switch checked={f.sincronizar_auto} onCheckedChange={(v) => setF({ ...f, sincronizar_auto: v })} />
        </SwitchRow>
        <SwitchRow titulo="Criar andamentos no caso" descricao="Cada movimentação do tribunal vira um andamento no caso ligado ao processo.">
          <Switch checked={f.criar_andamentos} onCheckedChange={(v) => setF({ ...f, criar_andamentos: v })} />
        </SwitchRow>
        <SwitchRow titulo="Ligar processos a clientes automaticamente" descricao="Quando o CPF/CNPJ ou o nome da parte bate com um cliente do cadastro.">
          <Switch checked={f.vincular_automatico} onCheckedChange={(v) => setF({ ...f, vincular_automatico: v })} />
        </SwitchRow>
        <Field label={`Semelhança mínima de nome: ${f.limiar_fuzzy}%`} dica="Abaixo disso, o vínculo por nome vira só sugestão para alguém confirmar.">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={60}
              max={100}
              value={f.limiar_fuzzy}
              onChange={(e) => setF({ ...f, limiar_fuzzy: Number(e.target.value) })}
              className="flex-1 accent-(--brand)"
            />
            <Input
              type="number"
              min={60}
              max={100}
              value={f.limiar_fuzzy}
              onChange={(e) => setF({ ...f, limiar_fuzzy: Math.max(60, Math.min(100, Number(e.target.value) || 60)) })}
              className="w-20 font-mono"
            />
          </div>
        </Field>
        <div className="flex justify-end">
          <Button onClick={() => salvar.mutate({ ...f, modo: cfg.modo })} disabled={!sujo || salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
          </Button>
        </div>
      </fieldset>

      <div className="card-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Plano contratado</p>
          <p className="text-lg font-semibold">{cfg.plano_nome ?? "Sem plano definido"}</p>
          <p className="text-sm text-muted-foreground">Franquia de protocolos, excedente e setups aparecem em Consumo.</p>
        </div>
        <Button variant="outline" onClick={irConsumo}>
          Ver consumo do mês
        </Button>
      </div>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => {
          setConfirmar(o);
          if (!o) setFrase("");
        }}
        titulo="Ligar o protocolo real?"
        descricao="A partir de agora, toda petição aprovada e enviada é assinada com o certificado do advogado e protocolada de verdade no tribunal. Protocolo feito não se desfaz."
        confirmar="Ligar protocolo real"
        destrutivo
        desabilitado={frase.trim().toUpperCase() !== FRASE}
        carregando={salvar.isPending}
        onConfirm={() => salvar.mutate({ ...f, modo: "real" })}
      >
        <div className="space-y-2">
          <p className="text-sm">
            Para confirmar, digite <strong className="font-mono">{FRASE}</strong>:
          </p>
          <Input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={FRASE} className="font-mono" autoComplete="off" autoFocus />
        </div>
      </ConfirmDialog>
    </div>
  );
}

export function EscritorioTribunais({ podeEditar, irConsumo }: { podeEditar: boolean; irConsumo: () => void }) {
  const q = useConfigTribunais();
  if (!q.data) return <Skeleton className="h-80 rounded-2xl" />;
  return <Formulario key={JSON.stringify(q.data)} cfg={q.data} podeEditar={podeEditar} irConsumo={irConsumo} />;
}
