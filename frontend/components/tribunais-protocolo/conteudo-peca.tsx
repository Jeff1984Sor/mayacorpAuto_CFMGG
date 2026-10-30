"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, CheckCheck, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Field, FormSection } from "@/components/mayacorp/form";
import { IaButton } from "@/components/ia/ia-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { ConteudoPeca, ProtocoloIn, SugestaoPeca } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

function ListaEditor({ itens, onChange, rotulo, placeholder }: { itens: string[]; onChange: (v: string[]) => void; rotulo: string; placeholder: string }) {
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= itens.length) return;
    const n = [...itens];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  return (
    <div className="space-y-2">
      {itens.map((x, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2 w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}.</span>
          <Textarea value={x} rows={2} onChange={(e) => onChange(itens.map((y, j) => (j === i ? e.target.value : y)))} className="min-h-0 flex-1" />
          <div className="flex flex-col">
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} aria-label="Descer">
              <ArrowDown />
            </Button>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(itens.filter((_, j) => j !== i))} aria-label={`Remover ${rotulo}`}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...itens, ""])}>
        <Plus /> {placeholder}
      </Button>
    </div>
  );
}

const CAMPOS_IA: { k: keyof SugestaoPeca; l: string }[] = [
  { k: "enderecamento", l: "Endereçamento" },
  { k: "abertura", l: "Abertura" },
  { k: "fatos", l: "Dos fatos" },
  { k: "fundamentos_juridicos", l: "Do direito" },
  { k: "pedidos", l: "Dos pedidos" },
  { k: "pedido_tutela", l: "Pedido de tutela" },
  { k: "provas", l: "Das provas" },
  { k: "local", l: "Local" },
];

function RedigirIA({
  protocoloId,
  aberto,
  onOpenChange,
  onAceitar,
}: {
  protocoloId: number;
  aberto: boolean;
  onOpenChange: (o: boolean) => void;
  onAceitar: (patch: Partial<ConteudoPeca>) => void;
}) {
  const [briefing, setBriefing] = useState("");
  const [sug, setSug] = useState<SugestaoPeca | null>(null);
  const [aceitos, setAceitos] = useState<Set<string>>(new Set());
  const gerar = useMutation({
    mutationFn: () => api.post<SugestaoPeca>(`/tribunais/protocolos/${protocoloId}/ia-redigir`, { briefing }),
    onSuccess: (r) => {
      setSug(r);
      setAceitos(new Set());
    },
  });
  const aceitar = (k: keyof SugestaoPeca) => {
    if (!sug) return;
    const v = sug[k];
    if (v == null) return;
    onAceitar({ [k]: v } as Partial<ConteudoPeca>);
    setAceitos((s) => new Set(s).add(k));
  };
  const disponiveis = CAMPOS_IA.filter((c) => {
    const v = sug?.[c.k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Redigir com IA</SheetTitle>
          <SheetDescription>
            Conte o caso com suas palavras. A IA sugere o texto; nada é gravado até você aceitar e salvar. Revise tudo: a responsabilidade pela peça é do advogado.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Field label="Relato do caso" dica={`${briefing.trim().length} caracteres (mínimo 20). Inclua fatos, datas, valores e o que o cliente quer.`}>
            <Textarea value={briefing} onChange={(e) => setBriefing(e.target.value)} rows={7} maxLength={20000} />
          </Field>
          <IaButton onClick={() => gerar.mutate()} carregando={gerar.isPending} disabled={briefing.trim().length < 20}>
            {sug ? "Gerar de novo" : "Gerar sugestão"}
          </IaButton>
          {sug && (
            <div className="space-y-3">
              {disponiveis.length === 0 && <p className="text-sm text-muted-foreground">A IA não devolveu sugestões. Detalhe mais o relato.</p>}
              {disponiveis.map(({ k, l }) => {
                const v = sug[k];
                const ok = aceitos.has(k);
                return (
                  <div key={k} className={cn("rounded-xl border p-3", ok && "border-success/40 bg-success/5")}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{l}</p>
                      <Button type="button" size="sm" variant={ok ? "ghost" : "outline"} onClick={() => aceitar(k)} disabled={ok}>
                        <Check /> {ok ? "Aceito" : "Usar este texto"}
                      </Button>
                    </div>
                    {Array.isArray(v) ? (
                      <ol className="list-decimal space-y-1 pl-5 text-sm">
                        {v.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap text-foreground/90">{v}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <SheetFooter className="border-t">
          {sug && disponiveis.length > 0 && (
            <Button
              type="button"
              onClick={() => {
                const patch: Record<string, unknown> = {};
                disponiveis.forEach(({ k }) => {
                  if (!aceitos.has(k)) patch[k] = sug[k];
                });
                onAceitar(patch as Partial<ConteudoPeca>);
                setAceitos(new Set(disponiveis.map((d) => d.k)));
                toast.success("Sugestões aplicadas. Revise e clique em Salvar.");
                onOpenChange(false);
              }}
            >
              <CheckCheck /> Usar todas
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function ConteudoPecaEditor({
  protocoloId,
  form,
  set,
  acoes,
}: {
  protocoloId: number;
  form: ProtocoloIn;
  set: (patch: Partial<ProtocoloIn>) => void;
  acoes: React.ReactNode;
}) {
  const c = form.conteudo_peca;
  const setC = (patch: Partial<ConteudoPeca>) => set({ conteudo_peca: { ...c, ...patch } });
  const [ia, setIa] = useState(false);
  const inicial = form.tipo === "inicial";
  const tutela = inicial ? !!form.cabecalho.tutela_urgencia : form.pedido_urgente;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {inicial ? "A qualificação das partes, o valor da causa e a opção de audiência saem dos dados." : "Escreva a petição; o PDF é gerado no padrão do escritório."}
        </p>
        <div className="flex flex-wrap gap-2">
          <IaButton onClick={() => setIa(true)}>Redigir com IA</IaButton>
          {acoes}
        </div>
      </div>
      <div className="divide-y">
        <FormSection titulo="Cabeçalho">
          <Field label="Endereçamento" className="sm:col-span-2" dica="Juízo a que a petição é dirigida.">
            <Input
              value={c.enderecamento ?? ""}
              onChange={(e) => setC({ enderecamento: e.target.value })}
              placeholder="EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA … VARA CÍVEL DO FORO …"
            />
          </Field>
          {!inicial && (
            <Field label="Abertura" className="sm:col-span-2" dica="Ex.: Fulano, já qualificado nos autos, vem respeitosamente…">
              <Textarea value={c.abertura ?? ""} onChange={(e) => setC({ abertura: e.target.value })} rows={3} />
            </Field>
          )}
        </FormSection>
        <FormSection titulo="Dos fatos">
          <Textarea value={c.fatos ?? ""} onChange={(e) => setC({ fatos: e.target.value })} rows={10} className="sm:col-span-2" />
        </FormSection>
        <FormSection titulo="Do direito" descricao="Fundamentos jurídicos.">
          <Textarea value={c.fundamentos_juridicos ?? ""} onChange={(e) => setC({ fundamentos_juridicos: e.target.value })} rows={10} className="sm:col-span-2" />
        </FormSection>
        {(tutela || c.pedido_tutela) && (
          <FormSection titulo="Pedido de tutela" descricao="Urgência: probabilidade do direito e perigo da demora.">
            <Textarea value={c.pedido_tutela ?? ""} onChange={(e) => setC({ pedido_tutela: e.target.value })} rows={5} className="sm:col-span-2" />
          </FormSection>
        )}
        <FormSection titulo="Dos pedidos" descricao="Um pedido por linha; a ordem é a da peça.">
          <div className="sm:col-span-2">
            <ListaEditor itens={c.pedidos} onChange={(v) => setC({ pedidos: v })} rotulo="pedido" placeholder="Pedido" />
          </div>
        </FormSection>
        <FormSection titulo="Das provas" descricao="As provas que pretende produzir.">
          <div className="sm:col-span-2">
            <ListaEditor itens={c.provas} onChange={(v) => setC({ provas: v })} rotulo="prova" placeholder="Prova" />
          </div>
        </FormSection>
        <FormSection titulo="Fecho" descricao="A data e a assinatura (nome + OAB) entram sozinhas.">
          <Field label="Local">
            <Input value={c.local ?? ""} onChange={(e) => setC({ local: e.target.value })} placeholder="São Paulo" />
          </Field>
        </FormSection>
      </div>
      <RedigirIA protocoloId={protocoloId} aberto={ia} onOpenChange={setIa} onAceitar={setC} />
    </div>
  );
}
