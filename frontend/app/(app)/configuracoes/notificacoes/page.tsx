"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Save, Server } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { PreencherIA } from "@/components/ia/preencher-ia";
import { Field, FormSection, SwitchRow } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { destacarCampos } from "@/hooks/use-ia";
import { api } from "@/lib/api";
import { useBrand } from "@/lib/brand";
import { moeda } from "@/lib/format";
import type { NotificacoesOut } from "@/lib/types";
import { cn } from "@/lib/utils";

type Form = NotificacoesOut & { smtp_senha: string };

const VARIAVEIS = ["{nome_tomador}", "{numero_nota}", "{valor}", "{link_prefeitura}", "{nome_emissora}"];

function render(t: string, nome: string) {
  return t
    .replaceAll("{nome_tomador}", "Condomínio Ed. Solar")
    .replaceAll("{numero_nota}", "00012345")
    .replaceAll("{valor}", moeda(1250))
    .replaceAll("{link_prefeitura}", "https://nfe.prefeitura.sp.gov.br/…")
    .replaceAll("{nome_emissora}", nome);
}

export default function NotificacoesPage() {
  const qc = useQueryClient();
  const { nome_exibicao, logoSrc } = useBrand();
  const q = useQuery({ queryKey: ["notificacoes"], queryFn: () => api.get<NotificacoesOut>("/config/notificacoes") });
  const [f, setF] = useState<Form | null>(null);
  const [avisos, setAvisos] = useState("");
  const [versaoIA, setVersaoIA] = useState(0);
  const corpo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!q.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o formulário com os dados do servidor
    setF({ ...q.data, smtp_senha: "" });
    setAvisos(q.data.avisos_destinatarios.join(", "));
  }, [q.data]);

  const salvar = useMutation({
    mutationFn: () => {
      const { smtp_senha_definida: _s, smtp_senha, ...resto } = f!;
      void _s;
      return api.put("/config/notificacoes", {
        ...resto,
        smtp_host: resto.smtp_host || null,
        smtp_usuario: resto.smtp_usuario || null,
        smtp_senha: smtp_senha || null,
        avisos_destinatarios: avisos
          .split(/[;,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
    },
    onSuccess: () => {
      toast.success("Notificações salvas");
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
    },
  });

  if (!f) return <Skeleton className="h-96 rounded-2xl" />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => (o ? { ...o, [k]: v } : o));
  const inserir = (v: string) => {
    const el = corpo.current;
    if (!el) return set("corpo_modelo", f.corpo_modelo + v);
    const ini = el.selectionStart;
    const novo = f.corpo_modelo.slice(0, ini) + v + f.corpo_modelo.slice(el.selectionEnd);
    set("corpo_modelo", novo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + v.length, ini + v.length);
    });
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div id="modelo-email" className="card-surface divide-y p-5">
        <FormSection titulo="Envio ao tomador" descricao="Decisão da CFME: e-mail automático ao concluir cada lote.">
          <div className="sm:col-span-2">
            <SwitchRow titulo="Enviar automaticamente as notas por e-mail" descricao="Desligado: o envio é manual (botão no resultado do lote).">
              <Switch checked={f.envio_automatico} onCheckedChange={(v) => set("envio_automatico", v)} />
            </SwitchRow>
          </div>
          <SwitchRow titulo="Anexar PDF">
            <Switch checked={f.anexar_pdf} onCheckedChange={(v) => set("anexar_pdf", v)} />
          </SwitchRow>
          <SwitchRow titulo="Anexar XML">
            <Switch checked={f.anexar_xml} onCheckedChange={(v) => set("anexar_xml", v)} />
          </SwitchRow>
        </FormSection>

        <FormSection titulo="Modelo do e-mail" descricao="Clique numa variável para inserir no texto.">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2.5 sm:col-span-2">
            <p className="text-xs text-muted-foreground">Peça um texto novo ou uma melhoria do atual. Nada é salvo sozinho.</p>
            <PreencherIA<{ assunto_modelo?: string; corpo_modelo?: string }>
              endpoint="/ia/preencher/email"
              rotulo="Escrever com IA"
              rotuloAcao="Escrever"
              titulo="Escrever o e-mail com IA"
              descricao="Diga como quer o texto. A IA usa só as variáveis que o sistema conhece."
              placeholder="Ex.: mais formal, lembrar o vencimento da fatura e agradecer pela parceria…"
              minimo={5}
              linhas={4}
              corpo={(instrucao) => ({ instrucao, assunto_atual: f.assunto_modelo, corpo_atual: f.corpo_modelo })}
              aplicar={(c) => {
                let n = 0;
                if (c.assunto_modelo) {
                  set("assunto_modelo", c.assunto_modelo);
                  n++;
                }
                if (c.corpo_modelo) {
                  set("corpo_modelo", c.corpo_modelo);
                  n++;
                }
                if (n) {
                  setVersaoIA((v) => v + 1);
                  requestAnimationFrame(() => destacarCampos(document.getElementById("modelo-email"), ["assunto_modelo", "corpo_modelo"]));
                }
                return n;
              }}
            />
          </div>
          <Field label="Assunto" className="sm:col-span-2">
            <Input name="assunto_modelo" value={f.assunto_modelo} onChange={(e) => set("assunto_modelo", e.target.value)} />
          </Field>
          <Field label="Corpo" className="sm:col-span-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {VARIAVEIS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => inserir(v)}
                  className="rounded-md bg-brand/10 px-2 py-0.5 font-mono text-[11px] text-info-ink transition hover:bg-brand/20"
                >
                  {v}
                </button>
              ))}
            </div>
            <Textarea ref={corpo} name="corpo_modelo" rows={7} value={f.corpo_modelo} onChange={(e) => set("corpo_modelo", e.target.value)} />
          </Field>
        </FormSection>

        <FormSection titulo="Remetente e servidor" descricao="SMTP próprio ou serviço transacional. Vazio = servidor da MayaCorp.">
          <Field label="Nome do remetente">
            <Input value={f.remetente_nome} onChange={(e) => set("remetente_nome", e.target.value)} />
          </Field>
          <Field label="E-mail do remetente">
            <Input type="email" value={f.remetente_email} onChange={(e) => set("remetente_email", e.target.value)} />
          </Field>
          <Field label="Servidor SMTP">
            <Input value={f.smtp_host ?? ""} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.exemplo.com.br" />
          </Field>
          <Field label="Porta">
            <Input type="number" value={f.smtp_porta} onChange={(e) => set("smtp_porta", Number(e.target.value))} className="num" />
          </Field>
          <Field label="Usuário">
            <Input value={f.smtp_usuario ?? ""} onChange={(e) => set("smtp_usuario", e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Senha" dica={f.smtp_senha_definida ? "Já definida — preencha só para trocar." : undefined}>
            <Input
              type="password"
              value={f.smtp_senha}
              onChange={(e) => set("smtp_senha", e.target.value)}
              placeholder={f.smtp_senha_definida ? "••••••••" : ""}
              autoComplete="new-password"
            />
          </Field>
        </FormSection>

        <FormSection titulo="Avisos internos" descricao="Quem da equipe recebe os alertas do robô.">
          <Field label="Destinatários" className="sm:col-span-2" dica="Separe por vírgula.">
            <Input value={avisos} onChange={(e) => setAvisos(e.target.value)} placeholder="cristina@cfme.com.br, financeiro@cfme.com.br" />
          </Field>
          <SwitchRow titulo="Fim de lote">
            <Switch checked={f.aviso_fim_lote} onCheckedChange={(v) => set("aviso_fim_lote", v)} />
          </SwitchRow>
          <SwitchRow titulo="Rejeições">
            <Switch checked={f.aviso_rejeicoes} onCheckedChange={(v) => set("aviso_rejeicoes", v)} />
          </SwitchRow>
          <SwitchRow titulo="Vencimento do certificado" descricao="30, 15, 7 e 1 dia antes">
            <Switch checked={f.aviso_certificado} onCheckedChange={(v) => set("aviso_certificado", v)} />
          </SwitchRow>
        </FormSection>

        <div className="flex justify-end pt-5">
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar notificações
          </Button>
        </div>
      </div>

      <div className="space-y-3 xl:sticky xl:top-[calc(var(--tb)+var(--faixa)+24px)] xl:h-fit">
        <p className="text-sm font-medium">Pré-visualização do e-mail</p>
        <motion.div
          key={versaoIA}
          initial={versaoIA ? { opacity: 0.4, y: 8, scale: 0.98 } : false}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className={cn("relative overflow-hidden rounded-2xl border bg-card shadow-lg", versaoIA > 0 && "ring-2 ring-brand/40")}
        >
          {versaoIA > 0 && (
            <motion.span
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 1.6, delay: 0.3 }}
              className="ia-shimmer pointer-events-none absolute inset-0 z-10"
            />
          )}
          <div className="space-y-1 border-b bg-muted/40 p-4 text-xs">
            <p>
              <span className="text-muted-foreground">De:</span> {f.remetente_nome} &lt;{f.remetente_email}&gt;
            </p>
            <p>
              <span className="text-muted-foreground">Assunto:</span> <strong>{render(f.assunto_modelo, nome_exibicao)}</strong>
            </p>
          </div>
          <div className="brand-gradient flex h-14 items-center px-5">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="" className="h-8 rounded bg-white object-contain p-1" />
            ) : (
              <span className="font-semibold text-white">{nome_exibicao}</span>
            )}
          </div>
          <div className="p-5 text-sm whitespace-pre-wrap">{render(f.corpo_modelo, nome_exibicao)}</div>
          <div className="flex gap-2 border-t p-4">
            {f.anexar_pdf && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs">
                <Mail className="size-3" /> nfse-00012345.pdf
              </span>
            )}
            {f.anexar_xml && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs">
                <Server className="size-3" /> nfse-00012345.xml
              </span>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
