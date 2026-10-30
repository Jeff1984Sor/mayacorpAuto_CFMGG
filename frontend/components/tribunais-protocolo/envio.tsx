"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Fingerprint, Loader2, RefreshCw, Send, ShieldCheck, Stamp, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, dataHora } from "@/lib/format";
import {
  diasAte,
  EDITAVEIS,
  type MensagemValidacao,
  type ProtocoloOut,
  ROTULO_GRAU,
  ROTULO_TIPO,
  textoPrazo,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const FRASE = "PROTOCOLAR";

export function ListaValidacao({ msgs }: { msgs: MensagemValidacao[] }) {
  const erros = msgs.filter((m) => m.nivel === "erro");
  const avisos = msgs.filter((m) => m.nivel === "aviso");
  if (msgs.length === 0)
    return (
      <p className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/8 px-3.5 py-3 text-sm text-success-ink">
        <CheckCircle2 className="size-4 shrink-0" /> Tudo certo: nenhuma pendência encontrada.
      </p>
    );
  return (
    <ul className="space-y-1.5">
      {erros.map((m, i) => (
        <li key={`e${i}`} className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/6 px-3 py-2 text-sm text-danger-ink">
          <XCircle className="mt-0.5 size-4 shrink-0" /> {m.mensagem}
        </li>
      ))}
      {avisos.map((m, i) => (
        <li key={`a${i}`} className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {m.mensagem}
        </li>
      ))}
    </ul>
  );
}

export function EnvioProtocolo({
  p,
  sujo,
  onAtualizado,
  onSalvar,
}: {
  p: ProtocoloOut;
  /** Há alterações não salvas no formulário. */
  sujo: boolean;
  onAtualizado: (p: ProtocoloOut) => void;
  onSalvar: () => void;
}) {
  const { pode } = useAuth();
  const [validacao, setValidacao] = useState<MensagemValidacao[] | null>(null);
  const [aprovar, setAprovar] = useState(false);
  const [enviar, setEnviar] = useState(false);
  const [conferi, setConferi] = useState(false);
  const [frase, setFrase] = useState("");

  const msgs = validacao ?? p.validacao ?? [];
  const erros = msgs.filter((m) => m.nivel === "erro").length;
  const editavel = EDITAVEIS.includes(p.status);
  const podeProtocolar = pode("trib_protocolos.protocolar");
  const real = p.modo_efetivo === "real";
  const dias = diasAte(p.prazo_final);

  const validar = useMutation({
    mutationFn: () => api.post<{ validacao: MensagemValidacao[]; pode_aprovar: boolean }>(`/tribunais/protocolos/${p.id}/validar`),
    onSuccess: (r) => {
      setValidacao(r.validacao);
      toast.success("Validação atualizada");
    },
  });
  const aprovarMut = useMutation({
    mutationFn: () => api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/aprovar`),
    onSuccess: (r) => {
      onAtualizado(r);
      setValidacao(null);
      setAprovar(false);
      toast.success("Petição aprovada. Agora ela pode ser protocolada.");
    },
  });
  const enviarMut = useMutation({
    mutationFn: () => api.post<ProtocoloOut>(`/tribunais/protocolos/${p.id}/enviar`),
    onSuccess: (r) => {
      onAtualizado(r);
      setEnviar(false);
      setConferi(false);
      setFrase("");
      toast.success("Enviado para a fila do protocolo. Acompanhe aqui o retorno do tribunal.");
    },
  });

  const aprovacaoOk = !!p.aprovacao;
  const podeEnviar = editavel && aprovacaoOk && (p.status === "aprovado" || p.status === "erro") && erros === 0 && !sujo;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <section className="card-surface p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Conferência antes do envio</h3>
            {editavel && (
              <Button variant="outline" size="sm" onClick={() => validar.mutate()} disabled={validar.isPending || sujo}>
                {validar.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Conferir de novo
              </Button>
            )}
          </div>
          {sujo && (
            <p className="mb-3 flex items-center gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-ink">
              <AlertTriangle className="size-4 shrink-0" /> Há alterações não salvas. Salve para conferir e aprovar.
              <Button size="xs" className="ml-auto" onClick={onSalvar}>
                Salvar agora
              </Button>
            </p>
          )}
          {editavel ? (
            <>
              <ListaValidacao msgs={msgs} />
              {erros > 0 && <p className="mt-3 text-xs text-muted-foreground">Os itens em vermelho impedem a aprovação. Os amarelos são avisos.</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Este protocolo já saiu para o tribunal; a conferência foi feita antes do envio.</p>
          )}
        </section>

        <section className="card-surface p-5">
          <h3 className="mb-1 flex items-center gap-2 font-semibold">
            <Fingerprint className="size-4 text-info-ink" /> Impressão digital do conteúdo
          </h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Resumo criptográfico (SHA-256) dos dados, das partes, da peça e de cada documento. Se qualquer coisa mudar, ele muda — e a aprovação deixa de valer.
          </p>
          <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs break-all">{p.hash_conteudo}</p>
          {p.aprovacoes_invalidadas > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {p.aprovacoes_invalidadas === 1 ? "1 aprovação anterior deixou" : `${p.aprovacoes_invalidadas} aprovações anteriores deixaram`} de valer porque o conteúdo mudou.
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className={cn("card-surface overflow-hidden", aprovacaoOk && "ring-2 ring-success/40")}>
          <div className={cn("h-1.5", aprovacaoOk ? "bg-success" : "bg-muted")} />
          <div className="p-5">
            <h3 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className={cn("size-4", aprovacaoOk ? "text-success-ink" : "text-muted-foreground")} /> 1. Aprovação do advogado
            </h3>
            {aprovacaoOk ? (
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Aprovado por</dt>
                  <dd className="font-medium">{p.aprovacao!.advogado}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Em</dt>
                  <dd>
                    <Mono>{dataHora(p.aprovacao!.aprovado_em)}</Mono>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">IP</dt>
                  <dd>
                    <Mono>{p.aprovacao!.ip ?? "—"}</Mono>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Conteúdo</dt>
                  <dd className="font-mono text-[11px]" title={p.aprovacao!.hash}>
                    {p.aprovacao!.hash.slice(0, 16)}…
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                Só <strong className="text-foreground">{p.advogado_nome}</strong>, titular do certificado, aprova. A aprovação autoriza o uso da assinatura dele
                para exatamente este conteúdo.
              </p>
            )}
            {editavel && p.pode_aprovar && podeProtocolar && !aprovacaoOk && (
              <Button className="mt-4 w-full" disabled={erros > 0 || sujo} onClick={() => setAprovar(true)}>
                <ShieldCheck /> Aprovar esta petição
              </Button>
            )}
            {editavel && !p.pode_aprovar && !aprovacaoOk && (
              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">Peça para {p.advogado_nome} abrir este protocolo e aprovar.</p>
            )}
          </div>
        </section>

        <section className="card-surface p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Stamp className="size-4 text-info-ink" /> 2. Protocolar no tribunal
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {real
              ? "Modo real: a petição é assinada e entregue de verdade ao tribunal."
              : p.modo === "real"
                ? "Modo simulado: o escritório está no modo real, mas este servidor não é o de produção. Nada vai ao tribunal."
                : "Modo simulado: o robô faz todo o caminho, mas nada vai ao tribunal."}
          </p>
          {podeProtocolar && editavel && (
            <Button className="mt-4 w-full" variant={real ? "destructive" : "default"} disabled={!podeEnviar} onClick={() => setEnviar(true)}>
              <Send /> {p.status === "erro" ? "Tentar protocolar de novo" : "Protocolar"}
            </Button>
          )}
          {editavel && !aprovacaoOk && <p className="mt-2 text-xs text-muted-foreground">Precisa da aprovação do advogado primeiro.</p>}
          {!podeProtocolar && <p className="mt-2 text-xs text-muted-foreground">Seu perfil não permite protocolar.</p>}
        </section>
      </div>

      <ConfirmDialog
        open={aprovar}
        onOpenChange={setAprovar}
        titulo="Aprovar esta petição?"
        descricao={
          <>
            Ao aprovar, você autoriza o sistema a assinar com o <strong>seu certificado digital</strong> e protocolar exatamente este conteúdo. Se algo mudar
            depois (dados, peça ou documentos), a aprovação deixa de valer e será preciso aprovar de novo. Sua aprovação fica registrada com data, hora e IP.
          </>
        }
        confirmar="Aprovo este conteúdo"
        carregando={aprovarMut.isPending}
        onConfirm={() => aprovarMut.mutate()}
      >
        <p className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-[11px] break-all">{p.hash_conteudo}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={enviar}
        onOpenChange={(o) => {
          setEnviar(o);
          if (!o) {
            setConferi(false);
            setFrase("");
          }
        }}
        titulo={real ? "Protocolar no tribunal de verdade?" : "Protocolar a petição?"}
        descricao={
          real
            ? "A petição será assinada com o certificado do advogado e entregue ao tribunal. Depois de protocolada, não dá para desfazer."
            : "Modo simulado: o envio é ensaiado e nada chega ao tribunal."
        }
        confirmar={real ? "Protocolar de verdade" : "Protocolar"}
        destrutivo={real}
        desabilitado={!conferi || (real && frase.trim().toUpperCase() !== FRASE)}
        carregando={enviarMut.isPending}
        onConfirm={() => enviarMut.mutate()}
      >
        <dl className="space-y-1.5 rounded-xl border p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Tribunal</dt>
            <dd className="text-right font-medium">
              {p.tribunal} · {ROTULO_GRAU[p.grau]}
              {p.sistema && ` · ${p.sistema.toUpperCase()}`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Processo</dt>
            <dd className="text-right">{p.numero_formatado ? <Mono>{p.numero_formatado}</Mono> : "Processo novo (distribuição)"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Petição</dt>
            <dd className="text-right">{p.tipo === "inicial" ? ROTULO_TIPO.inicial : (p.tipo_peticao_nome ?? ROTULO_TIPO[p.tipo])}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Assina</dt>
            <dd className="text-right">{p.advogado_nome}</dd>
          </div>
          {p.prazo_final && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Prazo</dt>
              <dd className={cn("text-right", dias != null && dias <= 1 && "font-semibold text-danger-ink")}>
                {data(p.prazo_final)} ({textoPrazo(dias)})
              </dd>
            </div>
          )}
          <div className="border-t pt-1.5">
            <dt className="mb-1 text-muted-foreground">Documentos ({p.documentos.length})</dt>
            <dd>
              <ol className="list-decimal space-y-0.5 pl-5 text-xs">
                {[...p.documentos]
                  .sort((a, b) => a.ordem - b.ordem)
                  .map((d) => (
                    <li key={d.id}>
                      {d.descricao} <span className="text-muted-foreground">· {d.tipo_documento_nome}</span>
                    </li>
                  ))}
              </ol>
            </dd>
          </div>
        </dl>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={conferi} onCheckedChange={(v) => setConferi(!!v)} className="mt-0.5" />
          Conferi o tribunal, o processo, os documentos e o prazo.
        </label>
        {real && (
          <div className="space-y-1.5">
            <p className="text-sm">
              Para confirmar, digite <strong className="font-mono">{FRASE}</strong>:
            </p>
            <Input value={frase} onChange={(e) => setFrase(e.target.value)} placeholder={FRASE} className="font-mono" autoComplete="off" />
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
