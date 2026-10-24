"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2, Paperclip, Plus, Repeat, Split, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { type ContaPagarIn, type ContaPagarOut, type FormaPagamento, paraBr, paraDecimalApi, ROTULO_FORMA } from "@/lib/financeiro";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CategoriaSubSelect, ContaSelect, DinheiroInput, FavorecidoCombo, type FavorecidoValor, isoHoje, useFavorecidos } from "../comum";
import { FornecedorDialog } from "./fornecedor-dialog";

interface LinhaRateio {
  chave: number;
  categoria_id: number | null;
  subcategoria_id: number | null;
  valor: string;
}

export const RECORRENCIAS = [
  { m: 0, l: "Não repete" },
  { m: 1, l: "Mensal" },
  { m: 2, l: "Bimestral" },
  { m: 3, l: "Trimestral" },
  { m: 6, l: "Semestral" },
  { m: 12, l: "Anual" },
];

/** Soma meses mantendo o dia (31 vira o último dia em meses menores). */
function somarMeses(iso: string, meses: number) {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimo)).toLocaleDateString("sv-SE");
}

let seq = 1;
const novaLinha = (categoria_id: number | null = null, valor = ""): LinhaRateio => ({ chave: seq++, categoria_id, subcategoria_id: null, valor });

/** Nova conta a pagar e edição (com escopo "só esta" / "esta e as próximas" nas séries). */
export function ContaPagarForm({ conta, onSalvo, onCancelar }: { conta?: ContaPagarOut | null; onSalvo: () => void; onCancelar: () => void }) {
  const qc = useQueryClient();
  const fav = useFavorecidos();
  const [favorecido, setFavorecido] = useState<FavorecidoValor>({ fornecedor_id: null, funcionario_id: null, favorecido: null });
  const [f, setF] = useState({
    descricao: "",
    data_vencimento: isoHoje(),
    data_competencia: "",
    forma_pagamento: "" as FormaPagamento | "",
    documento: "",
    codigo_barras: "",
    observacao: "",
    conta_bancaria_id: null as number | null,
  });
  const [rateio, setRateio] = useState<LinhaRateio[]>(() => [novaLinha()]);
  const [rec, setRec] = useState({ meses: 0, indeterminada: true, repeticoes: "12" });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [novoForn, setNovoForn] = useState<string | null>(null);
  const [perguntarEscopo, setPerguntarEscopo] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega a conta na edição */
  useEffect(() => {
    if (!conta) return;
    setFavorecido({ fornecedor_id: conta.fornecedor_id, funcionario_id: conta.funcionario_id, favorecido: conta.favorecido });
    setF({
      descricao: conta.descricao,
      data_vencimento: conta.data_vencimento,
      data_competencia: conta.data_competencia ?? "",
      forma_pagamento: conta.forma_pagamento ?? "",
      documento: conta.documento ?? "",
      codigo_barras: conta.codigo_barras ?? "",
      observacao: conta.observacao ?? "",
      conta_bancaria_id: conta.conta_bancaria_id,
    });
    setRateio(
      conta.rateio.length
        ? conta.rateio.map((r) => ({ chave: seq++, categoria_id: r.categoria_id, subcategoria_id: r.subcategoria_id, valor: paraBr(r.valor) }))
        : [novaLinha(conta.categoria_id, paraBr(conta.valor))],
    );
  }, [conta]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((o) => ({ ...o, [k]: v }));
  const valores = rateio.map((r) => toNum(paraDecimalApi(r.valor || "0")));
  const total = valores.reduce((a, v) => a + v, 0);
  const previa = useMemo(() => {
    if (!rec.meses || !f.data_vencimento) return [];
    const n = rec.indeterminada ? 12 : Math.min(Number(rec.repeticoes) || 0, 24);
    return Array.from({ length: n }, (_, i) => somarMeses(f.data_vencimento, i * rec.meses));
  }, [rec, f.data_vencimento]);

  const escolherFornecedor = (categoriaPadrao: number | null) => {
    // fornecedor com categoria padrão preenche o rateio vazio
    if (categoriaPadrao && rateio.length === 1 && !rateio[0].categoria_id) setRateio([{ ...rateio[0], categoria_id: categoriaPadrao, subcategoria_id: null }]);
  };

  const corpo = (): ContaPagarIn => ({
    descricao: f.descricao.trim() || null,
    ...favorecido,
    data_vencimento: f.data_vencimento,
    data_competencia: f.data_competencia || null,
    forma_pagamento: f.forma_pagamento || null,
    documento: f.documento.trim() || null,
    codigo_barras: f.codigo_barras.replace(/\s/g, "") || null,
    observacao: f.observacao.trim() || null,
    conta_bancaria_id: f.conta_bancaria_id,
    rateio: rateio.map((r) => ({ categoria_id: r.categoria_id!, subcategoria_id: r.subcategoria_id, valor: paraDecimalApi(r.valor) })),
    recorrencia_meses: conta ? 0 : rec.meses,
    recorrencia_indeterminada: !conta && rec.meses > 0 && rec.indeterminada,
    repeticoes: !conta && rec.meses > 0 && !rec.indeterminada ? Number(rec.repeticoes) || null : null,
  });

  const salvar = useMutation({
    mutationFn: async (escopo: "ocorrencia" | "serie") => {
      let id: number;
      let msg: string;
      if (conta) {
        const r = await api.put<{ mensagem: string }>(`/financeiro/contas-pagar/${conta.id}`, { ...corpo(), escopo });
        id = conta.id;
        msg = r.mensagem;
      } else {
        const r = await api.post<ContaPagarOut[]>("/financeiro/contas-pagar", corpo());
        id = r[0].id;
        msg = r.length > 1 ? `${r.length} contas criadas (série)` : "Conta criada";
      }
      if (arquivo) {
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        await api.post(`/financeiro/contas-pagar/${id}/arquivo`, fd, { query: { tipo: "anexo" } });
      }
      return msg;
    },
    onSuccess: (msg) => {
      toast.success(msg);
      qc.invalidateQueries({ queryKey: ["fin"] });
      onSalvo();
    },
  });

  const validar = () => {
    if (!favorecido.fornecedor_id && !favorecido.funcionario_id && !favorecido.favorecido && !f.descricao.trim()) return "Informe o favorecido ou a descrição.";
    if (!f.data_vencimento) return "Informe o vencimento.";
    if (rateio.some((r) => !r.categoria_id)) return "Escolha a categoria de cada linha.";
    if (valores.some((v) => v <= 0)) return "Cada linha precisa de um valor maior que zero.";
    if (!conta && rec.meses > 0 && !rec.indeterminada && !(Number(rec.repeticoes) >= 1)) return "Informe quantas vezes a conta se repete.";
    if (arquivo && arquivo.size > 15 * 1024 * 1024) return "O anexo passa de 15 MB.";
    return null;
  };

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const erro = validar();
        if (erro) return toast.error(erro);
        if (conta?.grupo_recorrencia) setPerguntarEscopo(true);
        else salvar.mutate("ocorrencia");
      }}
    >
      <section className="card-surface p-5">
        <h2 className="mb-4 text-sm font-semibold">Dados da conta</h2>
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Favorecido" htmlFor="cp-fav" className="sm:col-span-3" dica="Fornecedor, profissional ou um nome livre.">
            <FavorecidoCombo
              id="cp-fav"
              valor={favorecido}
              onChange={setFavorecido}
              onNovoFornecedor={setNovoForn}
              onFornecedorEscolhido={(x) => escolherFornecedor(x.categoria_padrao_id)}
            />
          </Field>
          <Field label="Descrição" htmlFor="cp-desc" className="sm:col-span-3">
            <Input id="cp-desc" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} placeholder="ex.: Aluguel do escritório" maxLength={255} />
          </Field>
          <Field label="Vencimento" obrigatorio htmlFor="cp-venc" className="sm:col-span-2">
            <Input id="cp-venc" type="date" value={f.data_vencimento} onChange={(e) => set("data_vencimento", e.target.value)} />
          </Field>
          <Field label="Competência" htmlFor="cp-comp" className="sm:col-span-2" dica="Mês a que a despesa se refere.">
            <Input id="cp-comp" type="date" value={f.data_competencia} onChange={(e) => set("data_competencia", e.target.value)} />
          </Field>
          <Field label="Forma de pagamento" htmlFor="cp-forma" className="sm:col-span-2">
            <NativeSelect id="cp-forma" value={f.forma_pagamento} onChange={(e) => set("forma_pagamento", e.target.value as FormaPagamento | "")}>
              <option value="">—</option>
              {Object.entries(ROTULO_FORMA).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Documento" htmlFor="cp-doc" className="sm:col-span-2" dica="Nº da nota, boleto ou recibo.">
            <Input id="cp-doc" value={f.documento} onChange={(e) => set("documento", e.target.value)} className="font-mono" maxLength={80} />
          </Field>
          <Field label="Código de barras" htmlFor="cp-barras" className="sm:col-span-4">
            <Input id="cp-barras" value={f.codigo_barras} onChange={(e) => set("codigo_barras", e.target.value)} className="font-mono" maxLength={60} inputMode="numeric" />
          </Field>
          <Field label="Conta bancária preferida" htmlFor="cp-banco" className="sm:col-span-3" dica="Sugerida na hora de pagar.">
            <ContaSelect id="cp-banco" value={f.conta_bancaria_id} onChange={(v) => set("conta_bancaria_id", v)} vazio="—" />
          </Field>
          <Field label="Observação" htmlFor="cp-obs" className="sm:col-span-3">
            <Textarea id="cp-obs" rows={1} value={f.observacao} onChange={(e) => set("observacao", e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card-surface p-5" aria-labelledby="rateio-t">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <Split className="size-4 text-info-ink" />
          <h2 id="rateio-t" className="text-sm font-semibold">
            Categoria e valor
          </h2>
          <span className="text-xs text-muted-foreground">{rateio.length > 1 ? "rateado entre categorias" : "use + para ratear entre categorias"}</span>
          <div className="ml-auto text-right">
            <p className="text-[11px] text-muted-foreground">Total da conta</p>
            <p className="font-mono text-xl font-semibold tabular-nums">{moeda(total)}</p>
          </div>
        </header>
        <ul className="space-y-2">
          {rateio.map((r, i) => (
            <li key={r.chave} className="grid items-end gap-2 rounded-xl border bg-muted/20 p-2.5 sm:grid-cols-[minmax(0,1fr)_160px_64px_36px]">
              <Field label={i === 0 ? "Categoria › Subcategoria" : `Linha ${i + 1}`} htmlFor={`cp-rat-${r.chave}-cat`}>
                <CategoriaSubSelect
                  idBase={`cp-rat-${r.chave}`}
                  tipo="despesa"
                  vazio="Escolha a categoria…"
                  categoriaId={r.categoria_id}
                  subcategoriaId={r.subcategoria_id}
                  onChange={(c, s) => setRateio((rs) => rs.map((x) => (x.chave === r.chave ? { ...x, categoria_id: c, subcategoria_id: s } : x)))}
                />
              </Field>
              <Field label="Valor" htmlFor={`cp-rat-${r.chave}-valor`}>
                <DinheiroInput id={`cp-rat-${r.chave}-valor`} value={r.valor} onChange={(v) => setRateio((rs) => rs.map((x) => (x.chave === r.chave ? { ...x, valor: v } : x)))} />
              </Field>
              <p className="pb-2 text-right text-xs text-muted-foreground tabular-nums" aria-label="Percentual">
                {total > 0 ? `${((valores[i] / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mb-0.5"
                disabled={rateio.length === 1}
                onClick={() => setRateio((rs) => rs.filter((x) => x.chave !== r.chave))}
                aria-label={`Remover linha ${i + 1}`}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRateio((rs) => [...rs, novaLinha()])}>
          <Plus /> Ratear com outra categoria
        </Button>
      </section>

      {!conta ? (
        <section className="card-surface p-5" aria-labelledby="rec-t">
          <h2 id="rec-t" className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Repeat className="size-4 text-info-ink" /> Recorrência
          </h2>
          <div role="radiogroup" aria-label="Repetição" className="flex flex-wrap gap-1.5">
            {RECORRENCIAS.map((o) => (
              <button
                key={o.m}
                type="button"
                role="radio"
                aria-checked={rec.meses === o.m}
                onClick={() => setRec({ ...rec, meses: o.m })}
                className={cn("rounded-full border px-3 py-1.5 text-sm transition", rec.meses === o.m ? "border-brand bg-brand/10 font-medium text-info-ink" : "text-muted-foreground hover:border-brand/40")}
              >
                {o.l}
              </button>
            ))}
          </div>
          {rec.meses > 0 && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
              <div className="space-y-2" role="radiogroup" aria-label="Até quando">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="cp-fim" checked={rec.indeterminada} onChange={() => setRec({ ...rec, indeterminada: true })} className="accent-[var(--brand)]" />
                  Sem fim (até eu parar)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="cp-fim" checked={!rec.indeterminada} onChange={() => setRec({ ...rec, indeterminada: false })} className="accent-[var(--brand)]" />
                  Repetir
                  <Input
                    aria-label="Quantas vezes"
                    value={rec.repeticoes}
                    disabled={rec.indeterminada}
                    onChange={(e) => setRec({ ...rec, repeticoes: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                    className="h-8 w-16 text-center"
                    inputMode="numeric"
                  />
                  vezes
                </label>
                <p className="text-xs text-muted-foreground">
                  {rec.indeterminada ? "As próximas parcelas vão sendo criadas sozinhas, sempre 12 meses à frente." : `Total da série: ${moeda(total * (Number(rec.repeticoes) || 0))}`}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Vencimentos {rec.indeterminada && "(primeiros 12)"}</p>
                <ol className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1">
                  {previa.map((d, i) => (
                    <li key={d} className="flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs">
                      <span className="font-semibold text-info-ink">{i + 1}ª</span>
                      <span className="font-mono">{data(d)}</span>
                    </li>
                  ))}
                  {rec.indeterminada && <li className="self-center px-2 text-xs text-muted-foreground">…</li>}
                </ol>
              </div>
            </div>
          )}
        </section>
      ) : (
        conta.grupo_recorrencia && (
          <p className="flex items-center gap-2 rounded-xl bg-brand/6 px-3 py-2 text-sm text-info-ink">
            <CalendarClock className="size-4" /> Esta conta faz parte de uma série
            {conta.parcela && conta.parcelas_total ? ` (${conta.parcela}/${conta.parcelas_total})` : ""}. Ao salvar, você escolhe se a mudança vale só para ela ou para as próximas em aberto.
          </p>
        )
      )}

      <section className="card-surface p-5">
        <Field label="Anexo (boleto ou nota)" htmlFor="cp-anexo" dica={conta?.tem_anexo ? "Já tem anexo; enviar outro substitui." : "PDF ou imagem, até 15 MB. Opcional."}>
          <label htmlFor="cp-anexo" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-3 py-3 text-sm transition hover:border-brand/50 hover:bg-brand/5">
            {arquivo ? <Paperclip className="size-4 text-info-ink" /> : <Upload className="size-4 text-info-ink" />}
            <span className="min-w-0 flex-1 truncate">{arquivo ? arquivo.name : "Escolher arquivo"}</span>
          </label>
          <input id="cp-anexo" type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Field>
      </section>

      <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-2xl border bg-card/90 p-3 shadow-lg backdrop-blur">
        <span className="mr-auto self-center text-sm text-muted-foreground">
          {rec.meses > 0 && !conta ? `${RECORRENCIAS.find((x) => x.m === rec.meses)?.l} · ` : ""}
          <strong className="font-mono text-foreground">{moeda(total)}</strong>
        </span>
        <Button type="button" variant="outline" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending && <Loader2 className="animate-spin" />} {conta ? "Salvar alterações" : "Lançar conta"}
        </Button>
      </div>

      <FornecedorDialog
        open={novoForn !== null}
        onOpenChange={(o) => !o && setNovoForn(null)}
        nomeInicial={novoForn ?? ""}
        onSalvo={(x) => {
          setFavorecido({ fornecedor_id: x.id, funcionario_id: null, favorecido: null });
          escolherFornecedor(x.categoria_padrao_id);
          fav.refetch();
        }}
      />
      <ConfirmDialog
        open={perguntarEscopo}
        onOpenChange={setPerguntarEscopo}
        titulo="Aplicar a mudança em quais contas?"
        descricao="Esta conta faz parte de uma série recorrente."
        confirmar="Só esta"
        carregando={salvar.isPending}
        onConfirm={() => salvar.mutate("ocorrencia")}
      >
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={salvar.isPending}
          onClick={() => {
            setPerguntarEscopo(false);
            salvar.mutate("serie");
          }}
        >
          <Repeat /> Esta e as próximas em aberto da série
        </Button>
      </ConfirmDialog>
    </form>
  );
}
