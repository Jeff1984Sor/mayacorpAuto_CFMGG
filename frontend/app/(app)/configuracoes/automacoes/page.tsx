"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, FolderArchive, Landmark, Loader2, Mail, ReceiptText, Save, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/brand";
import type { ConfigAutomacoes } from "@/lib/types";
import { cn } from "@/lib/utils";

function Cartao({
  icone: I,
  titulo,
  descricao,
  children,
  acao,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
  acao?: React.ReactNode;
}) {
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-start gap-3 border-b p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl brand-gradient text-white shadow-md shadow-brand/25">
          <I className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{titulo}</h3>
          <p className="text-sm text-muted-foreground">{descricao}</p>
        </div>
        {acao}
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </section>
  );
}

function PreviaRelatorio({ nome, planilha, zip }: { nome: string; planilha: boolean; zip: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background text-sm shadow-sm">
      <div className="space-y-0.5 border-b bg-muted/40 px-4 py-2.5 text-xs">
        <p>
          <span className="text-muted-foreground">Para:</span> {nome}
        </p>
        <p>
          <span className="text-muted-foreground">Assunto:</span> <strong>NFS-e: 64 nota(s) emitida(s) — lote #0001</strong>
        </p>
      </div>
      <div className="space-y-1.5 p-4">
        <p>Olá! O robô terminou o lote #0001:</p>
        <p>
          ✅ <strong className="num">64</strong> notas emitidas
        </p>
        <p>
          💰 <strong className="num">R$ 98.420,00</strong> em serviços
        </p>
        <p>
          🧾 ISS de <strong className="num">R$ 4.921,00</strong>
        </p>
        <p>
          ❌ <strong className="num">0</strong> rejeitadas
        </p>
      </div>
      {(planilha || zip) && (
        <div className="flex flex-wrap gap-2 border-t px-4 py-3">
          {planilha && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs">
              <FileSpreadsheet className="size-3" /> conferencia_lote_0001.xlsx
            </span>
          )}
          {zip && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs">
              <FolderArchive className="size-3" /> notas_lote_0001.zip
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function AutomacoesPage() {
  const qc = useQueryClient();
  const { pode } = useAuth();
  const { nome_exibicao } = useBrand();
  const q = useQuery({ queryKey: ["automacoes"], queryFn: () => api.get<ConfigAutomacoes>("/config/automacoes") });
  const [c, setC] = useState<ConfigAutomacoes | null>(null);
  const [gerar, setGerar] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o formulário com os dados do servidor
    if (q.data) setC(q.data);
  }, [q.data]);

  const salvar = useMutation({
    mutationFn: () => api.put<ConfigAutomacoes>("/config/automacoes", c),
    onSuccess: (r) => {
      qc.setQueryData(["automacoes"], r);
      toast.success("Automações salvas");
    },
  });
  const pendentes = useMutation({
    mutationFn: () => api.post<{ mensagem: string }>("/nfse/faturas/gerar-pendentes"),
    onSuccess: (r) => {
      toast.success(r?.mensagem ?? "Faturas geradas");
      setGerar(false);
      qc.invalidateQueries({ queryKey: ["faturas"] });
      qc.invalidateQueries({ queryKey: ["faturas-resumo"] });
    },
  });

  if (!c) return <Skeleton className="h-96 rounded-2xl" />;
  const set = <K extends keyof ConfigAutomacoes>(k: K, v: ConfigAutomacoes[K]) => setC((o) => (o ? { ...o, [k]: v } : o));
  const destinatariosOk = emailsValidos(c.relatorio_destinatarios);
  const sujo = JSON.stringify(c) !== JSON.stringify(q.data);

  return (
    <div className="space-y-5 pb-20">
      <Cartao
        icone={ReceiptText}
        titulo="Fatura (Nota de Honorários)"
        descricao="Toda NFS-e emitida (em lote ou individual) gera a sua Nota de Honorários, com PIX."
        acao={
          pode("faturas.editar") && (
            <Button variant="outline" size="sm" onClick={() => setGerar(true)}>
              <Wand2 /> Gerar faturas das notas antigas
            </Button>
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div className="grid grid-cols-2 gap-4 sm:col-span-2 sm:max-w-md">
            <Field label="Próxima Nota de Honorários" htmlFor="fat-proxima-nh" dica={`Sai como NH ${String(c.fatura_proxima_nh).padStart(5, "0")}`}>
              <Input
                id="fat-proxima-nh"
                type="number"
                min={1}
                value={c.fatura_proxima_nh}
                onChange={(e) => set("fatura_proxima_nh", Math.max(1, Number(e.target.value) || 1))}
                className="num"
              />
            </Field>
            <Field label="Próxima Nota de Despesas" htmlFor="fat-proxima-nd" dica={`Sai como ND ${String(c.fatura_proxima_nd).padStart(5, "0")}`}>
              <Input
                id="fat-proxima-nd"
                type="number"
                min={1}
                value={c.fatura_proxima_nd}
                onChange={(e) => set("fatura_proxima_nd", Math.max(1, Number(e.target.value) || 1))}
                className="num"
              />
            </Field>
            <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
              Honorários e Despesas têm sequências separadas e contínuas. Não dá para voltar a um número já usado.
            </p>
          </div>
          <Field label="Vencimento da fatura" className="sm:col-span-2" dica={
            c.fatura_vencimento_modo === "emissao"
              ? "A fatura vence no mesmo dia em que a NFS-e é gerada (à vista)."
              : `A fatura vence ${c.fatura_dias_vencimento} dia(s) depois da emissão da NFS-e.`
          }>
            <div className="flex flex-wrap items-center gap-2">
              <div role="radiogroup" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
                {(
                  [
                    ["emissao", "Na data de emissão da nota"],
                    ["dias", "Dias após a emissão"],
                  ] as const
                ).map(([modo, rotulo]) => (
                  <button
                    key={modo}
                    type="button"
                    role="radio"
                    aria-checked={c.fatura_vencimento_modo === modo}
                    onClick={() => set("fatura_vencimento_modo", modo)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition",
                      c.fatura_vencimento_modo === modo
                        ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
              {c.fatura_vencimento_modo === "dias" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    aria-label="Dias para vencimento"
                    value={c.fatura_dias_vencimento}
                    onChange={(e) => set("fatura_dias_vencimento", Math.max(0, Math.min(120, Number(e.target.value))))}
                    className="num w-20"
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              )}
            </div>
          </Field>
          <Field label="Instruções de pagamento" dica="Saem no rodapé da fatura." className="sm:col-span-2">
            <Textarea
              rows={3}
              value={c.fatura_instrucoes ?? ""}
              onChange={(e) => set("fatura_instrucoes", e.target.value || null)}
              placeholder="Pagamento via PIX ou transferência. Após o vencimento, multa de 2% e juros de 1% ao mês."
            />
          </Field>
          <div className="sm:col-span-2">
            <SwitchRow titulo="Anexar a fatura no e-mail ao cliente" descricao="Junto com o PDF e o XML da nota.">
              <Switch checked={c.fatura_anexar_email} onCheckedChange={(v) => set("fatura_anexar_email", v)} />
            </SwitchRow>
          </div>
        </div>
      </Cartao>

      <Cartao icone={Mail} titulo="Relatório para o escritório" descricao="Um resumo por e-mail sempre que o robô terminar.">
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <SwitchRow titulo={`Enviar à ${nome_exibicao} quando as notas forem emitidas`} descricao="Ao fim de cada lote.">
              <Switch checked={c.relatorio_emissao_ativo} onCheckedChange={(v) => set("relatorio_emissao_ativo", v)} />
            </SwitchRow>
            <Field label="Destinatários" erro={destinatariosOk ? undefined : "Há e-mails inválidos (em vermelho)."}>
              <EmailChips value={c.relatorio_destinatarios} onChange={(v) => set("relatorio_destinatarios", v)} placeholder="financeiro@cfme.com.br — Enter para adicionar" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchRow titulo="Anexar planilha de conferência">
                <Switch checked={c.relatorio_anexar_planilha} onCheckedChange={(v) => set("relatorio_anexar_planilha", v)} />
              </SwitchRow>
              <SwitchRow titulo="Anexar ZIP das notas">
                <Switch checked={c.relatorio_anexar_zip} onCheckedChange={(v) => set("relatorio_anexar_zip", v)} />
              </SwitchRow>
            </div>
            <SwitchRow titulo="Avisar também quando o extrato der baixa" descricao="Resumo das notas pagas a cada extrato processado.">
              <Switch checked={c.relatorio_baixas_ativo} onCheckedChange={(v) => set("relatorio_baixas_ativo", v)} />
            </SwitchRow>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">Pré-visualização</p>
            <PreviaRelatorio
              nome={c.relatorio_destinatarios.join(", ") || nome_exibicao}
              planilha={c.relatorio_anexar_planilha}
              zip={c.relatorio_anexar_zip}
            />
          </div>
        </div>
      </Cartao>

      <Cartao icone={Landmark} titulo="Baixa automática pelo extrato" descricao="Suba o extrato do banco e o robô dá baixa nas notas pagas.">
        <SwitchRow titulo="Dar baixa automaticamente" descricao="Desligado: tudo vira sugestão para você confirmar.">
          <Switch checked={c.baixa_automatica} onCheckedChange={(v) => set("baixa_automatica", v)} />
        </SwitchRow>
        <div className={cn("space-y-4", !c.baixa_automatica && "pointer-events-none opacity-50")}>
          <div>
            <div className="mb-2 flex items-end justify-between">
              <label htmlFor="confianca" className="text-sm font-medium">
                Confiança mínima para baixa automática
              </label>
              <span className="text-2xl font-semibold text-info-ink num">{c.confianca_minima}</span>
            </div>
            <input
              id="confianca"
              type="range"
              min={60}
              max={100}
              step={1}
              value={c.confianca_minima}
              onChange={(e) => set("confianca_minima", Number(e.target.value))}
              className="w-full accent-[var(--brand)]"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground num">
              <span>60 · mais baixas</span>
              <span>85 · recomendado</span>
              <span>100 · só certeza</span>
            </div>
          </div>
        </div>
      </Cartao>

      {/* barra de salvar fixa */}
      <div className="sticky bottom-3 z-20 flex justify-end">
        <div className="glass flex items-center gap-3 rounded-2xl border p-2 pl-4 shadow-xl">
          <span className="text-sm text-muted-foreground">{sujo ? "Alterações não salvas" : "Tudo salvo"}</span>
          <Button onClick={() => salvar.mutate()} disabled={!sujo || salvar.isPending || !destinatariosOk}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar automações
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={gerar}
        onOpenChange={setGerar}
        titulo="Gerar faturas das notas antigas?"
        descricao="Cria a Nota de Honorários para as NFS-e já emitidas que ainda não têm fatura. Notas canceladas ficam de fora."
        confirmar="Gerar faturas"
        carregando={pendentes.isPending}
        onConfirm={() => pendentes.mutate()}
      />
    </div>
  );
}
