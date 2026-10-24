"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, ChevronsUpDown, KeyRound, Loader2, PlugZap, RefreshCw, Save, ShieldCheck, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, SwitchRow } from "@/components/mayacorp/form";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { configIAKey, useConfigIA } from "@/hooks/use-ia";
import { api } from "@/lib/api";
import type { ConfigIAIn, ConfigIAOut, ProvedorIA } from "@/lib/types";
import { cn } from "@/lib/utils";

function LogoOpenAI({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07Zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5ZM3.6 18.3a4.47 4.47 0 0 1-.53-3.01l.14.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.84 2.79a4.5 4.5 0 0 1-6.14-1.65ZM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87Zm16.6 3.86-5.84-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.66Zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66ZM8.31 12.86 6.29 11.7a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.79.79 0 0 0-.39.68Zm1.1-2.37L12 8.98l2.6 1.5v3l-2.6 1.5-2.6-1.5Z" />
    </svg>
  );
}

function LogoGemini({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <linearGradient id="gGemini" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4f8bf9" />
          <stop offset="55%" stopColor="#9b72f2" />
          <stop offset="100%" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path fill="url(#gGemini)" d="M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.3 14.3 0 0 0 12 12 14.3 14.3 0 0 0-12 12Z" />
    </svg>
  );
}

const PROVEDORES: Record<ProvedorIA, { nome: string; descricao: string; logo: React.ComponentType<{ className?: string }>; dica: string }> = {
  openai: {
    nome: "OpenAI",
    descricao: "Modelos GPT. Ótimos em texto e em extrair dados de documentos.",
    logo: LogoOpenAI,
    dica: "Crie a chave em platform.openai.com › API keys (começa com sk-).",
  },
  gemini: {
    nome: "Google Gemini",
    descricao: "Modelos Gemini do Google AI Studio. Rápidos e econômicos.",
    logo: LogoGemini,
    dica: "Crie a chave em aistudio.google.com › Get API key.",
  },
};

function SelectModelo({
  valor,
  onChange,
  modelos,
  disabled,
}: {
  valor: string | null;
  onChange: (m: string) => void;
  modelos: string[];
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const lista = valor && !modelos.includes(valor) ? [valor, ...modelos] : modelos;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("truncate font-mono", !valor && "font-sans text-muted-foreground")}>{valor ?? "Escolha o modelo"}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command>
          <CommandInput placeholder="Buscar modelo…" value={busca} onValueChange={setBusca} />
          <CommandList className="max-h-72">
            <CommandEmpty>
              {busca.trim() ? (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    onChange(busca.trim());
                    setAberto(false);
                  }}
                >
                  Usar “<span className="font-mono">{busca.trim()}</span>”
                </button>
              ) : (
                "Clique em “Buscar modelos” primeiro."
              )}
            </CommandEmpty>
            <CommandGroup>
              {lista.map((m) => (
                <CommandItem
                  key={m}
                  value={m}
                  onSelect={() => {
                    onChange(m);
                    setAberto(false);
                  }}
                >
                  <span className="flex-1 truncate font-mono text-[13px]">{m}</span>
                  {m === valor && <Check className="size-4 text-info-ink" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ModoLeitura({ cfg }: { cfg: ConfigIAOut }) {
  const info = PROVEDORES[cfg.provedor];
  return (
    <div className="space-y-5">
      <div className="card-surface relative overflow-hidden">
        <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-brand/15 blur-3xl" />
        <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl border bg-background shadow-sm">
            <info.logo className="size-9" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold">Inteligência Artificial</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-linear-to-r from-navy to-brand px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <ShieldCheck className="size-3.5" /> Gerenciado pela MayaCorp
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              A chave, o provedor e o modelo são configurados pela equipe MayaCorp. Fale com ela para ativar, trocar ou desligar.
            </p>
          </div>
        </div>
        <dl className="relative grid gap-px border-t bg-border sm:grid-cols-3">
          {[
            {
              l: "Situação",
              v: cfg.ativo ? (
                <span className="inline-flex items-center gap-1.5 text-success-ink">
                  <span className="size-2 rounded-full bg-success" /> Ativa
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <span className="size-2 rounded-full bg-muted-foreground/50" /> Desativada
                </span>
              ),
            },
            { l: "Provedor", v: cfg.provedores?.[cfg.provedor] ?? info.nome },
            { l: "Modelo", v: <span className="font-mono text-[13px]">{cfg.modelo ?? "—"}</span> },
          ].map((x) => (
            <div key={x.l} className="bg-card px-6 py-4">
              <dt className="text-xs text-muted-foreground">{x.l}</dt>
              <dd className="mt-0.5 font-medium">{x.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex gap-3 rounded-2xl border border-warning/35 bg-warning/8 p-4 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
        <div>
          <p className="font-semibold text-warning-ink">Privacidade (LGPD)</p>
          <p className="mt-0.5">{cfg.aviso}</p>
        </div>
      </div>
    </div>
  );
}

export default function IAPage() {
  const qc = useQueryClient();
  const q = useConfigIA();
  const salvo = q.data;
  const [ativo, setAtivo] = useState(false);
  const [provedor, setProvedor] = useState<ProvedorIA>("openai");
  const [modelo, setModelo] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [trocarChave, setTrocarChave] = useState(false);
  const [modelos, setModelos] = useState<string[]>([]);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário com os dados do servidor */
  useEffect(() => {
    if (!salvo) return;
    setAtivo(salvo.ativo);
    setProvedor(salvo.provedor);
    setModelo(salvo.modelo);
    setTrocarChave(!salvo.chave_definida);
  }, [salvo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const mudouProvedor = !!salvo && provedor !== salvo.provedor;
  const chaveSalvaValida = !!salvo?.chave_definida && !mudouProvedor;
  const descartaChave = mudouProvedor && !!salvo?.chave_definida && !chave.trim();
  const mostraCampoChave = trocarChave || !chaveSalvaValida;

  const buscar = useMutation({
    mutationFn: () => api.post<string[]>("/config/ia/modelos", { provedor, chave: chave.trim() || null }),
    onSuccess: (lista) => {
      setModelos(lista);
      toast.success(`${lista.length} modelo(s) disponível(is)`);
      if (lista.length && (!modelo || !lista.includes(modelo))) setModelo(lista[0]);
    },
  });

  const salvar = useMutation({
    mutationFn: () => {
      const body: ConfigIAIn = { ativo, provedor, modelo };
      if (chave.trim()) body.chave = chave.trim();
      return api.put<ConfigIAOut>("/config/ia", body);
    },
    onSuccess: (r) => {
      qc.setQueryData(configIAKey, r);
      setChave("");
      setTrocarChave(!r.chave_definida);
      toast.success(r.ativo ? "IA ativa — os botões ✨ já funcionam" : "Configuração salva");
    },
  });

  const testar = useMutation({
    mutationFn: () => api.post<{ ok: boolean; mensagem: string }>("/config/ia/testar"),
    onSuccess: (r) => (r.ok ? toast.success(r.mensagem) : toast.error(r.mensagem)),
  });

  if (!salvo) return <Skeleton className="h-96 rounded-2xl" />;
  if (!salvo.pode_editar) return <ModoLeitura cfg={salvo} />;

  const sujo =
    ativo !== salvo.ativo || provedor !== salvo.provedor || modelo !== salvo.modelo || chave.trim().length > 0;
  const podeBuscar = !!chave.trim() || chaveSalvaValida;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex gap-3 rounded-2xl border border-warning/35 bg-warning/8 p-4 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" />
        <div>
          <p className="font-semibold text-warning-ink">Privacidade (LGPD)</p>
          <p className="mt-0.5">{salvo.aviso}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(PROVEDORES) as ProvedorIA[]).map((p, i) => {
          const info = PROVEDORES[p];
          const on = provedor === p;
          return (
            <motion.button
              key={p}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              onClick={() => {
                setProvedor(p);
                setModelos([]);
                if (p !== salvo.provedor) setModelo(null);
                else setModelo(salvo.modelo);
              }}
              className={cn(
                "group relative flex items-start gap-4 overflow-hidden rounded-2xl border bg-card p-5 text-left transition-all",
                on ? "border-transparent shadow-xl ring-2 shadow-brand/15 ring-brand" : "hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg",
              )}
            >
              {on && <div className="pointer-events-none absolute -top-16 -right-16 size-44 rounded-full bg-brand/20 blur-3xl" />}
              <span className="relative grid size-14 shrink-0 place-items-center rounded-2xl border bg-background shadow-sm">
                <info.logo className="size-8" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-lg font-semibold">{info.nome}</span>
                  {salvo.provedor === p && salvo.ativo && (
                    <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success-ink uppercase">em uso</span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-muted-foreground">{info.descricao}</span>
              </span>
              <span
                className={cn(
                  "relative grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  on ? "border-brand bg-brand text-white" : "border-muted-foreground/30",
                )}
              >
                {on && <Check className="size-3" />}
              </span>
            </motion.button>
          );
        })}
      </div>

      <section className="card-surface divide-y">
        <div className="space-y-4 p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-info-ink" /> Chave de API · {PROVEDORES[provedor].nome}
          </h3>
          {!mostraCampoChave ? (
            <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3 sm:flex-row sm:items-center">
              <span className="grid size-9 place-items-center rounded-lg bg-success/10 text-success-ink">
                <Check className="size-4" />
              </span>
              <p className="flex-1 text-sm">
                Chave salva <span className="font-mono tracking-wider">••••{salvo.chave_final}</span>
                <span className="block text-xs text-muted-foreground">Guardada criptografada. Ela nunca é exibida de novo.</span>
              </p>
              <Button variant="outline" size="sm" onClick={() => setTrocarChave(true)}>
                <RefreshCw /> Trocar chave
              </Button>
            </div>
          ) : (
            <Field label="Chave" dica={PROVEDORES[provedor].dica}>
              <div className="flex gap-2">
                <div className="flex-1">
                  <SenhaInput
                    value={chave}
                    onChange={setChave}
                    autoComplete="off"
                    placeholder={provedor === "openai" ? "sk-…" : "AIza…"}
                    className="font-mono"
                  />
                </div>
                {chaveSalvaValida && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setChave("");
                      setTrocarChave(false);
                    }}
                  >
                    Cancelar
                  </Button>
                )}
              </div>
            </Field>
          )}
          {descartaChave && (
            <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm text-warning-ink">
              <AlertTriangle className="size-4 shrink-0" />
              Ao salvar sem uma chave nova, a chave da {PROVEDORES[salvo.provedor].nome} será descartada (ela não funciona no {PROVEDORES[provedor].nome}).
            </p>
          )}
        </div>

        <div className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <Bot className="size-4 text-info-ink" /> Modelo
          </h3>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <SelectModelo valor={modelo} onChange={setModelo} modelos={modelos} />
            </div>
            <Button variant="outline" onClick={() => buscar.mutate()} disabled={!podeBuscar || buscar.isPending}>
              {buscar.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Buscar modelos
            </Button>
          </div>
          {!podeBuscar && <p className="text-xs text-muted-foreground">Informe a chave para buscar os modelos disponíveis na sua conta.</p>}
        </div>

        <div className="p-5">
          <SwitchRow titulo="IA ativa" descricao="Liga os botões ✨ Análise por IA e Preencher com IA em todo o sistema.">
            <Switch checked={ativo} onCheckedChange={setAtivo} disabled={!modelo || (!chaveSalvaValida && !chave.trim())} />
          </SwitchRow>
        </div>
      </section>

      <div className="sticky bottom-3 z-20 flex justify-end">
        <div className="glass flex flex-wrap items-center gap-2 rounded-2xl border p-2 pl-4 shadow-xl">
          <span className="mr-1 text-sm text-muted-foreground">{sujo ? "Alterações não salvas" : "Tudo salvo"}</span>
          <Button variant="outline" onClick={() => testar.mutate()} disabled={testar.isPending || sujo || !salvo.chave_definida}>
            {testar.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Testar conexão
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={!sujo || salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
          </Button>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Sparkles className="size-3.5 text-info-ink" /> Cada uso da IA fica registrado na auditoria (provedor e modelo).
      </p>
    </div>
  );
}
