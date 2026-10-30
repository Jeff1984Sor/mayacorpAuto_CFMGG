"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, RotateCcw, Save } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmailChips, emailsValidos } from "@/components/mayacorp/email-chips";
import { Field, SwitchRow } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { chaveProtocolos, type NotificacaoCfg, ROTULO_EVENTO } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const ROTULO_VAR: Record<string, string> = {
  advogado_responsavel_nome: "advogado responsável",
  protocolado_por_nome: "quem protocolou",
  cliente_nome: "cliente",
  numero_cnj: "nº do processo",
  numero_protocolo: "nº do protocolo",
  data_hora_protocolo: "data/hora",
  tribunal_sigla: "tribunal",
  sistema: "sistema",
  orgao_julgador: "órgão julgador",
  classe: "classe",
  tipo_peticao: "tipo de petição",
  partes_resumo: "partes",
  valor_causa: "valor da causa",
  prazo_final: "prazo final",
  mensagem_erro: "erro",
  link_processo: "link do processo",
};

function CartaoEvento({ n, variaveis, podeEditar }: { n: NotificacaoCfg; variaveis: string[]; podeEditar: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState(n);
  const [restaurar, setRestaurar] = useState(false);
  const foco = useRef<"assunto" | "corpo">("corpo");
  const assunto = useRef<HTMLInputElement>(null);
  const corpo = useRef<HTMLTextAreaElement>(null);
  const set = (p: Partial<NotificacaoCfg>) => setF((x) => ({ ...x, ...p }));
  const sujo = JSON.stringify(f) !== JSON.stringify(n);
  const falha = n.evento === "protocolo_falha";

  const salvar = useMutation({
    mutationFn: () => api.put<NotificacaoCfg>(`/tribunais/notificacoes/${n.evento}`, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "notificacoes"] });
      toast.success(`Aviso “${ROTULO_EVENTO[n.evento]?.titulo ?? n.evento}” salvo`);
    },
  });
  const restaurarMut = useMutation({
    mutationFn: () => api.post<NotificacaoCfg>(`/tribunais/notificacoes/${n.evento}/restaurar`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "notificacoes"] });
      setRestaurar(false);
      toast.success("Modelo padrão restaurado");
    },
  });

  const inserir = (v: string) => {
    const tag = `{{${v}}}`;
    const el = foco.current === "assunto" ? assunto.current : corpo.current;
    const campo = foco.current === "assunto" ? "assunto" : "corpo_texto";
    const atual = f[campo];
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    set({ [campo]: atual.slice(0, ini) + tag + atual.slice(fim) } as Partial<NotificacaoCfg>);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + tag.length, ini + tag.length);
    });
  };

  const info = ROTULO_EVENTO[n.evento] ?? { titulo: n.evento, texto: "" };
  return (
    <fieldset disabled={!podeEditar} className={cn("card-surface min-w-0 overflow-hidden", !f.ativo && "opacity-80")}>
      <div className="flex items-start gap-3 border-b p-4">
        <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", falha ? "bg-danger/10 text-danger-ink" : "bg-brand/12 text-info-ink")}>
          <Mail className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{info.titulo}</p>
          <p className="text-xs text-muted-foreground">{info.texto}</p>
        </div>
        <Switch checked={f.ativo} onCheckedChange={(v) => set({ ativo: v })} aria-label="Aviso ativo" />
      </div>
      {f.ativo && (
        <div className="space-y-4 p-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <SwitchRow titulo="Responsável do caso">
              <Switch checked={f.notificar_responsavel_caso} onCheckedChange={(v) => set({ notificar_responsavel_caso: v })} />
            </SwitchRow>
            <SwitchRow titulo="Quem protocolou">
              <Switch checked={f.notificar_quem_protocolou} onCheckedChange={(v) => set({ notificar_quem_protocolou: v })} />
            </SwitchRow>
            <SwitchRow titulo="Titular do certificado">
              <Switch checked={f.notificar_titular_certificado} onCheckedChange={(v) => set({ notificar_titular_certificado: v })} />
            </SwitchRow>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sempre enviar também para" erro={emailsValidos(f.destinatarios_fixos) ? undefined : "Há e-mail inválido"}>
              <EmailChips value={f.destinatarios_fixos} onChange={(v) => set({ destinatarios_fixos: v })} />
            </Field>
            <Field label="Cópia oculta" erro={emailsValidos(f.copia_oculta) ? undefined : "Há e-mail inválido"}>
              <EmailChips value={f.copia_oculta} onChange={(v) => set({ copia_oculta: v })} />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <SwitchRow titulo="Anexar o recibo" descricao="Recibo grande vai por link (7 dias).">
              <Switch checked={f.anexar_recibo} onCheckedChange={(v) => set({ anexar_recibo: v })} />
            </SwitchRow>
            <SwitchRow titulo="Anexar a peça principal">
              <Switch checked={f.anexar_peca_principal} onCheckedChange={(v) => set({ anexar_peca_principal: v })} />
            </SwitchRow>
            <SwitchRow titulo="Respeitar o sigilo" descricao="Em processo sigiloso, não anexa nem detalha.">
              <Switch checked={f.respeitar_sigilo} onCheckedChange={(v) => set({ respeitar_sigilo: v })} />
            </SwitchRow>
          </div>
          <Field label="Assunto">
            <Input ref={assunto} value={f.assunto} onFocus={() => (foco.current = "assunto")} onChange={(e) => set({ assunto: e.target.value })} maxLength={300} />
          </Field>
          <Field label="Texto do e-mail">
            <Textarea ref={corpo} value={f.corpo_texto} onFocus={() => (foco.current = "corpo")} onChange={(e) => set({ corpo_texto: e.target.value })} rows={9} className="font-mono text-xs" />
          </Field>
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">Clique para inserir no assunto ou no texto (onde o cursor estiver):</p>
            <div className="flex flex-wrap gap-1.5">
              {variaveis.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => inserir(v)}
                  title={`{{${v}}}`}
                  className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs hover:border-brand/50 hover:bg-brand/8"
                >
                  {ROTULO_VAR[v] ?? v}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => setRestaurar(true)}>
          <RotateCcw /> Restaurar modelo
        </Button>
        <Button
          size="sm"
          disabled={!sujo || salvar.isPending || !emailsValidos(f.destinatarios_fixos) || !emailsValidos(f.copia_oculta)}
          onClick={() => salvar.mutate()}
        >
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </div>
      <ConfirmDialog
        open={restaurar}
        onOpenChange={setRestaurar}
        titulo="Restaurar o modelo padrão?"
        descricao="O assunto e o texto voltam ao modelo original. Destinatários e opções não mudam."
        confirmar="Restaurar"
        carregando={restaurarMut.isPending}
        onConfirm={() => restaurarMut.mutate()}
      />
    </fieldset>
  );
}

export function AvisosProtocolo({ podeEditar }: { podeEditar: boolean }) {
  const q = useQuery({
    queryKey: [chaveProtocolos, "notificacoes"],
    queryFn: () => api.get<{ eventos: NotificacaoCfg[]; variaveis: string[] }>("/tribunais/notificacoes"),
  });
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cada pessoa recebe um e-mail só, mesmo que esteja em mais de um papel. Falha no protocolo com prazo vencendo hoje sai com [URGENTE] e vai também para os
        destinatários fixos.
      </p>
      {q.data.eventos.map((n) => (
        <CartaoEvento key={JSON.stringify(n)} n={n} variaveis={q.data.variaveis} podeEditar={podeEditar} />
      ))}
    </div>
  );
}
