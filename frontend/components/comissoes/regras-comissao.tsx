"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useUsaContrato } from "@/lib/contrato";
import { type AlcanceComissao, type AlvoComissao, pctFmt, type RegraComissaoIn, type RegraComissaoOut, ROTULO_ALCANCE } from "@/lib/comissoes";
import { data } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALCANCES: { v: AlcanceComissao; dica: string }[] = [
  { v: "geral", dica: "Tudo o que o escritório receber" },
  { v: "cliente", dica: "Só o que um cliente pagar" },
  { v: "contrato", dica: "Só os recebimentos de um contrato" },
  { v: "caso", dica: "Só os recebimentos de um caso" },
];
const TOM: Record<AlcanceComissao, string> = {
  geral: "bg-muted text-muted-foreground ring-border",
  cliente: "bg-brand/10 text-info-ink ring-brand/25",
  contrato: "bg-warning/12 text-warning-ink ring-warning/30",
  caso: "bg-success/10 text-success-ink ring-success/25",
};

interface Form {
  id: number | null;
  alcance: AlcanceComissao;
  alvo: AlvoComissao | null;
  percentual: string;
  vigencia: string;
}
const novo = (): Form => ({ id: null, alcance: "geral", alvo: null, percentual: "", vigencia: "" });
const alvoId = (r: RegraComissaoOut) => r.tomador_id ?? r.contrato_id ?? r.caso_id;
const paraNumero = (v: string) => Number(v.replace(/\s|%/g, "").replace(",", "."));

function corpo(alcance: AlcanceComissao, alvo: number | null, percentual: number, vigencia: string | null, ativo: boolean): RegraComissaoIn {
  return {
    alcance,
    tomador_id: alcance === "cliente" ? alvo : null,
    contrato_id: alcance === "contrato" ? alvo : null,
    caso_id: alcance === "caso" ? alvo : null,
    percentual,
    vigencia_inicio: vigencia || null,
    ativo,
  };
}

/** Busca do cliente, contrato ou caso da regra (procura no servidor enquanto digita). */
function AlvoCombo({ alcance, valor, onChange, id }: { alcance: Exclude<AlcanceComissao, "geral">; valor: AlvoComissao | null; onChange: (a: AlvoComissao | null) => void; id: string }) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = useDebounce(q, 250);
  const busca = useQuery({
    queryKey: ["usuarios", "comissoes", "alvos", alcance, termo],
    queryFn: () => api.get<AlvoComissao[]>("/config/usuarios/comissoes/alvos", { alcance, q: termo }),
    enabled: aberto,
    placeholderData: (p) => p,
  });
  const nome = { cliente: "cliente", contrato: "contrato", caso: "caso" }[alcance];
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />
        }
      >
        <span className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground")}>{valor?.rotulo ?? `Escolha o ${nome}…`}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-80 gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder={alcance === "cliente" ? "Nome ou CNPJ/CPF" : alcance === "contrato" ? "Nome, número ou cliente" : "Título, número ou nº do processo"}
              aria-label={`Buscar ${nome}`}
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
          {busca.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Buscando…</li>}
          {busca.data?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={valor?.id === a.id}
                onClick={() => {
                  onChange(a);
                  setAberto(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Check className={cn("size-3.5 shrink-0", valor?.id === a.id ? "text-info-ink" : "invisible")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.rotulo}</span>
                  {a.detalhe && <span className="block truncate text-[11px] text-muted-foreground">{a.detalhe}</span>}
                </span>
              </button>
            </li>
          ))}
          {busca.data?.length === 0 && <li className="p-3 text-center text-sm text-muted-foreground">Nada encontrado.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Seção "Comissão" da ficha do profissional: percentual sobre o que o cliente pagou (honorários), por alcance.
 * Cada regra é salva na hora (não depende do botão Salvar da ficha).
 */
export function RegrasComissao({ usuarioId, somenteLeitura }: { usuarioId: number; somenteLeitura?: boolean }) {
  const usaContrato = useUsaContrato();
  const qc = useQueryClient();
  const chave = ["usuarios", usuarioId, "comissoes"];
  const base = `/config/usuarios/${usuarioId}/comissoes`;
  const lista = useQuery({ queryKey: chave, queryFn: () => api.get<RegraComissaoOut[]>(base) });
  const [f, setF] = useState<Form | null>(null);
  const [erro, setErro] = useState("");
  const [excluir, setExcluir] = useState<RegraComissaoOut | null>(null);
  const atualizar = () => {
    qc.invalidateQueries({ queryKey: chave });
    qc.invalidateQueries({ queryKey: ["fin", "comissoes"] });
  };

  const salvar = useMutation({
    mutationFn: (x: Form) => {
      const antiga = lista.data?.find((r) => r.id === x.id);
      const dados = corpo(x.alcance, x.alvo?.id ?? null, paraNumero(x.percentual), x.vigencia, antiga?.ativo ?? true);
      return x.id ? api.put<RegraComissaoOut>(`${base}/${x.id}`, dados) : api.post<RegraComissaoOut>(base, dados);
    },
    onSuccess: (_, x) => {
      toast.success(x.id ? "Comissão atualizada" : "Comissão cadastrada");
      setF(null);
      atualizar();
    },
    onError: (e: Error) => setErro(e.message),
    meta: { silencioso: true }, // o erro aparece no próprio formulário
  });
  const alternar = useMutation({
    mutationFn: (r: RegraComissaoOut) => api.put(`${base}/${r.id}`, corpo(r.alcance, alvoId(r), Number(r.percentual), r.vigencia_inicio, !r.ativo)),
    onSuccess: atualizar,
  });
  const remover = useMutation({
    mutationFn: (r: RegraComissaoOut) => api.del(`${base}/${r.id}`),
    onSuccess: () => {
      toast.success("Comissão excluída");
      setExcluir(null);
      atualizar();
    },
  });

  const confirmar = () => {
    if (!f) return;
    const p = paraNumero(f.percentual);
    if (f.percentual.trim() === "" || Number.isNaN(p) || p < 0 || p > 100) return setErro("Informe o percentual, de 0 a 100.");
    if (f.alcance !== "geral" && !f.alvo) return setErro(`Escolha o ${f.alcance} desta comissão.`);
    setErro("");
    salvar.mutate(f);
  };
  const editar = (r: RegraComissaoOut) => {
    setErro("");
    setF({
      id: r.id,
      alcance: r.alcance,
      alvo: r.alcance === "geral" ? null : { id: alvoId(r) ?? 0, rotulo: r.alvo ?? "", detalhe: r.alvo_detalhe },
      percentual: String(Number(r.percentual)).replace(".", ","),
      vigencia: r.vigencia_inicio ?? "",
    });
  };

  if (lista.isPending) return <Skeleton className="h-16 rounded-xl" />;
  if (lista.isError) return <p className="text-sm text-danger-ink">Não foi possível carregar as comissões deste profissional.</p>;
  const regras = lista.data ?? [];

  return (
    <div className="space-y-3">
      {regras.length === 0 && !f && (
        <p className="rounded-xl border border-dashed bg-background/60 px-3 py-4 text-center text-sm text-muted-foreground">
          Este profissional ainda não tem comissão. Cadastre um percentual geral ou por {usaContrato ? "cliente, contrato ou caso" : "cliente ou caso"}.
        </p>
      )}
      {regras.length > 0 && (
        <ul className="divide-y rounded-xl border bg-background/60">
          {regras.map((r) => (
            <li key={r.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5", !r.ativo && "opacity-60")}>
              <span className="w-16 shrink-0 font-mono text-base font-semibold tabular-nums">{pctFmt(r.percentual)}</span>
              <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset", TOM[r.alcance])}>
                {ROTULO_ALCANCE[r.alcance]}
              </span>
              <span className="min-w-0 flex-1 basis-40">
                <span className="block truncate text-sm">{r.alcance === "geral" ? "Tudo o que for recebido" : (r.alvo ?? "—")}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {[r.alvo_detalhe, r.vigencia_inicio ? `a partir de ${data(r.vigencia_inicio)}` : null, Number(r.percentual) === 0 ? "sem comissão aqui" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              {!somenteLeitura && (
                <span className="flex shrink-0 items-center gap-1">
                  <Switch checked={r.ativo} disabled={alternar.isPending} onCheckedChange={() => alternar.mutate(r)} aria-label={r.ativo ? "Desativar comissão" : "Ativar comissão"} />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => editar(r)} aria-label="Editar comissão">
                    <Pencil />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setExcluir(r)} aria-label="Excluir comissão">
                    <Trash2 />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {f && (
        // Enter aqui não pode enviar o formulário da ficha (esta seção salva sozinha)
        <div className="rounded-xl border border-brand/30 bg-brand/[0.04] p-3" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}>
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Sobre o quê" htmlFor="com-alcance" className="sm:col-span-2" dica={ALCANCES.find((a) => a.v === f.alcance)?.dica}>
              <NativeSelect id="com-alcance" value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value as AlcanceComissao, alvo: null })}>
                {ALCANCES.filter((a) => usaContrato || a.v !== "contrato" || f.alcance === "contrato").map((a) => (
                  <option key={a.v} value={a.v}>
                    {ROTULO_ALCANCE[a.v]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {f.alcance !== "geral" && (
              <Field label={ROTULO_ALCANCE[f.alcance]} htmlFor="com-alvo" obrigatorio className="sm:col-span-4">
                <AlvoCombo id="com-alvo" alcance={f.alcance} valor={f.alvo} onChange={(alvo) => setF({ ...f, alvo })} />
              </Field>
            )}
            <Field label="Percentual" htmlFor="com-pct" obrigatorio className="sm:col-span-2" dica="0% = sem comissão neste alcance">
              <div className="relative">
                <Input
                  id="com-pct"
                  inputMode="decimal"
                  value={f.percentual}
                  onChange={(e) => setF({ ...f, percentual: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmar();
                    }
                  }}
                  placeholder="10"
                  className="num pr-7"
                  autoFocus
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </Field>
            <Field label="Vale a partir de" htmlFor="com-vigencia" className="sm:col-span-2" dica="Opcional: pela data do pagamento">
              <Input id="com-vigencia" type="date" value={f.vigencia} onChange={(e) => setF({ ...f, vigencia: e.target.value })} />
            </Field>
          </div>
          {erro && <p className="mt-2 text-xs text-danger">{erro}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setF(null)}>
              <X /> Cancelar
            </Button>
            <Button type="button" size="sm" disabled={salvar.isPending} onClick={confirmar}>
              {salvar.isPending ? <Loader2 className="animate-spin" /> : <Check />} {f.id ? "Salvar comissão" : "Adicionar comissão"}
            </Button>
          </div>
        </div>
      )}

      {!f && !somenteLeitura && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setErro("");
            setF(novo());
          }}
        >
          <Plus /> Nova comissão
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        A comissão é um percentual sobre o que o cliente efetivamente pagou em honorários (reembolso de despesas não entra). Se mais de uma regra alcançar o mesmo
        recebimento, vale a mais específica: {usaContrato ? "caso, depois contrato, depois cliente" : "caso, depois cliente"}, depois a geral.
      </p>

      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir esta comissão?"
        descricao={
          excluir
            ? `${pctFmt(excluir.percentual)} · ${ROTULO_ALCANCE[excluir.alcance]}${excluir.alvo ? `: ${excluir.alvo}` : ""}. Os recebimentos que ainda não viraram conta a pagar deixam de gerar esta comissão.`
            : undefined
        }
        confirmar="Excluir"
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir)}
      />
    </div>
  );
}
