"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { CategoriaSubSelect, FavorecidoCombo } from "@/components/financeiro/comum";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import {
  type ConciliacaoDetalhe,
  type ItemBaixa,
  type ItemPagar,
  type ItemReceber,
  type LinhaOut,
  problemasDoLote,
  type ResultadoOut,
  ROTULO_ORIGEM_SUGESTAO,
  type TituloOut,
} from "@/lib/conciliacao";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { CartaoTitulo, PopupLote, RodapeLote, TH, TituloBusca, useAposGravar, ValorLinha } from "./comum";

type Fechar = () => void;

/** Grava o lote: se o servidor recusar, marca as linhas com o motivo (nada foi gravado). */
function useGravar<T>(conc: ConciliacaoDetalhe, rota: string, onFechar: Fechar, setErros: (e: Record<number, string>) => void) {
  const aposGravar = useAposGravar(conc.id);
  return useMutation({
    meta: { silencioso: true },
    mutationFn: (itens: T[]) => api.post<ResultadoOut>(`/financeiro/conciliacao/${conc.id}/${rota}`, { itens }),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      aposGravar(r.conciliacao);
      onFechar();
    },
    onError: (e) => {
      const p = problemasDoLote(e);
      setErros(p.linhas);
      toast.error(Object.keys(p.linhas).length ? `${p.mensagem} Nada foi gravado.` : p.mensagem);
    },
  });
}

function useSugerirIA(conc: ConciliacaoDetalhe, onChegou: (c: ConciliacaoDetalhe) => void) {
  const aposGravar = useAposGravar(conc.id);
  return useMutation({
    mutationFn: () => api.post<ConciliacaoDetalhe>(`/financeiro/conciliacao/${conc.id}/sugerir-ia`),
    onSuccess: (c) => {
      aposGravar(c);
      onChegou(c);
    },
  });
}

function BotaoIA({ visivel, carregando, onClick }: { visivel: boolean; carregando: boolean; onClick: () => void }) {
  if (!visivel) return null;
  return (
    <Button variant="outline" size="sm" className="border-brand/40 text-info-ink" disabled={carregando} onClick={onClick}>
      {carregando ? <Loader2 className="animate-spin" /> : <Sparkles />} Sugerir categorias com IA
    </Button>
  );
}

function MarcarTodas({ total, marcadas, onChange }: { total: number; marcadas: number; onChange: (v: boolean) => void }) {
  return (
    <Checkbox
      aria-label="Marcar todas"
      checked={total > 0 && marcadas === total}
      indeterminate={marcadas > 0 && marcadas < total}
      onCheckedChange={(v) => onChange(!!v)}
    />
  );
}

function OrigemSugestao({ l }: { l: LinhaOut }) {
  const o = l.sugestao?.origem;
  if (!o) return null;
  return (
    <Pill className="shrink-0 whitespace-nowrap" tom={o === "regra" ? "success" : o === "ia" ? "brand" : "neutral"}>
      {ROTULO_ORIGEM_SUGESTAO[o] ?? o}
    </Pill>
  );
}

function LinhaBanco({ l }: { l: LinhaOut }) {
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="shrink-0">No banco:</span>
      <span className="min-w-0 truncate font-mono" title={l.descricao}>
        {l.descricao || "sem descrição"}
      </span>
      <OrigemSugestao l={l} />
    </p>
  );
}

function ErroLinha({ texto }: { texto?: string }) {
  if (!texto) return null;
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-danger-ink">
      <TriangleAlert className="mt-px size-3.5 shrink-0" /> {texto}
    </p>
  );
}

const linhaTr = (falta: boolean, marcada: boolean) => cn("border-b align-top last:border-b-0", falta && "bg-warning/10", !marcada && "opacity-55");

// ================================================================ contas a pagar para criar
type EdicaoPagar = Omit<ItemPagar, "linha_id"> & { marcada: boolean };

const edicaoPagar = (l: LinhaOut): EdicaoPagar => ({
  marcada: !l.sugestao?.aviso,
  descricao: l.sugestao?.descricao || l.descricao,
  categoria_id: l.sugestao?.categoria_id ?? null,
  subcategoria_id: l.sugestao?.subcategoria_id ?? null,
  fornecedor_id: l.sugestao?.fornecedor_id ?? null,
  funcionario_id: l.sugestao?.funcionario_id ?? null,
  favorecido: l.sugestao?.favorecido ?? null,
});

export function CriarPagarDialog({ conc, onFechar }: { conc: ConciliacaoDetalhe; onFechar: Fechar }) {
  const [linhas] = useState(() => conc.linhas.filter((l) => l.situacao === "sem_correspondencia" && l.tipo === "debito"));
  const [ed, setEd] = useState<Record<number, EdicaoPagar>>(() => Object.fromEntries(linhas.map((l) => [l.id, edicaoPagar(l)])));
  const [erros, setErros] = useState<Record<number, string>>({});
  const corpo = useRef<HTMLTableSectionElement>(null);
  const gravar = useGravar<ItemPagar>(conc, "criar-pagar", onFechar, setErros);
  const ia = useSugerirIA(conc, (c) => {
    // só preenche as linhas que continuam sem categoria: o que o usuário já escolheu fica
    setEd((atual) => {
      const novo = { ...atual };
      let n = 0;
      c.linhas.forEach((l) => {
        if (novo[l.id] && !novo[l.id].categoria_id && l.sugestao?.categoria_id) {
          novo[l.id] = { ...novo[l.id], categoria_id: l.sugestao.categoria_id, subcategoria_id: l.sugestao.subcategoria_id, favorecido: novo[l.id].favorecido ?? l.sugestao.favorecido };
          n += 1;
        }
      });
      toast[n ? "success" : "info"](n ? `A IA sugeriu a categoria de ${n} linha(s). Confira antes de gravar.` : "A IA não encontrou categoria para as linhas que faltavam.");
      return novo;
    });
  });
  const mudar = (id: number, p: Partial<EdicaoPagar>) => {
    setEd((a) => ({ ...a, [id]: { ...a[id], ...p } }));
    setErros((a) => (a[id] ? { ...a, [id]: "" } : a));
  };
  const marcadas = linhas.filter((l) => ed[l.id].marcada);
  const falta = (l: LinhaOut) => ed[l.id].marcada && (!ed[l.id].categoria_id || !ed[l.id].descricao.trim());
  const faltando = linhas.filter(falta);
  const total = marcadas.reduce((s, l) => s + toNum(l.valor), 0);
  return (
    <PopupLote
      open
      onOpenChange={(o) => !o && onFechar()}
      titulo="Contas a pagar para criar"
      descricao={
        <>
          Saídas do extrato de <strong>{conc.conta_nome}</strong> que não estão no sistema. Ao confirmar, cada linha marcada vira uma conta a pagar já{" "}
          <strong>paga</strong> na data e no valor do banco, com o débito no extrato desta conta.
        </>
      }
      ferramentas={<BotaoIA visivel={conc.ia_disponivel && linhas.some((l) => !ed[l.id].categoria_id)} carregando={ia.isPending} onClick={() => ia.mutate()} />}
      rodape={
        <RodapeLote
          marcadas={marcadas.length}
          total={total}
          faltando={faltando.length}
          rotuloFalta="a categoria"
          rotuloGravar={marcadas.length === 1 ? "Criar 1 lançamento" : `Criar ${marcadas.length} lançamentos`}
          gravando={gravar.isPending}
          onFechar={onFechar}
          onIrParaFalta={() => corpo.current?.querySelector<HTMLElement>(`[data-linha="${faltando[0]?.id}"] select`)?.focus()}
          onGravar={() =>
            gravar.mutate(
              marcadas.map((l) => {
                const e = ed[l.id];
                return { linha_id: l.id, descricao: e.descricao.trim(), categoria_id: e.categoria_id, subcategoria_id: e.subcategoria_id, fornecedor_id: e.fornecedor_id, funcionario_id: e.funcionario_id, favorecido: e.favorecido };
              }),
            )
          }
        />
      }
    >
      <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(TH, "w-12 pl-5")}>
              <MarcarTodas total={linhas.length} marcadas={marcadas.length} onChange={(v) => setEd((a) => Object.fromEntries(Object.entries(a).map(([k, x]) => [k, { ...x, marcada: v }])))} />
            </th>
            <th className={cn(TH, "w-24")}>Data</th>
            <th className={TH}>Descrição</th>
            <th className={cn(TH, "w-[236px]")}>Favorecido</th>
            <th className={cn(TH, "w-[410px]")}>Categoria e subcategoria</th>
            <th className={cn(TH, "w-36 pr-5 text-right")}>Valor</th>
          </tr>
        </thead>
        <tbody ref={corpo}>
          {linhas.map((l) => {
            const e = ed[l.id];
            const semCategoria = e.marcada && !e.categoria_id;
            return (
              <tr key={l.id} data-linha={l.id} className={linhaTr(falta(l) || !!erros[l.id], e.marcada)}>
                <td className="border-b px-3 py-2.5 pl-5">
                  <Checkbox aria-label={`Criar ${l.descricao}`} className="mt-2" checked={e.marcada} onCheckedChange={(v) => mudar(l.id, { marcada: !!v })} />
                </td>
                <td className="border-b px-3 py-2.5 pt-4 font-mono text-xs whitespace-nowrap">{data(l.data)}</td>
                <td className="max-w-0 border-b px-3 py-2.5">
                  <Input aria-label="Descrição da conta a pagar" value={e.descricao} maxLength={255} aria-invalid={(e.marcada && !e.descricao.trim()) || undefined} onChange={(ev) => mudar(l.id, { descricao: ev.target.value })} />
                  <LinhaBanco l={l} />
                  {l.aviso && <ErroLinha texto={l.aviso} />}
                  <ErroLinha texto={erros[l.id]} />
                </td>
                <td className="border-b px-3 py-2.5">
                  <FavorecidoCombo
                    valor={{ fornecedor_id: e.fornecedor_id, funcionario_id: e.funcionario_id, favorecido: e.favorecido }}
                    onChange={(v) => mudar(l.id, v)}
                    onFornecedorEscolhido={(f) => !e.categoria_id && f.categoria_padrao_id && mudar(l.id, { fornecedor_id: f.id, funcionario_id: null, favorecido: null, categoria_id: f.categoria_padrao_id, subcategoria_id: null })}
                  />
                </td>
                <td className="border-b px-3 py-2.5">
                  <div className={cn("rounded-lg", semCategoria && "ring-2 ring-warning/60")}>
                    <CategoriaSubSelect className="sm:grid-cols-[1.4fr_1fr]" tipo="despesa" idBase={`cp-${l.id}`} vazio="Escolha a categoria…" categoriaId={e.categoria_id} subcategoriaId={e.subcategoria_id} onChange={(c, s) => mudar(l.id, { categoria_id: c, subcategoria_id: s })} />
                  </div>
                  {semCategoria && <p className="mt-1 text-xs text-warning-ink">Falta a categoria</p>}
                </td>
                <td className="border-b px-3 py-2.5 pt-4 pr-5 text-right">
                  <ValorLinha l={l} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PopupLote>
  );
}

// ================================================================ recebimentos para criar
type EdicaoReceber = { marcada: boolean; modo: "avulsa" | "fatura"; descricao: string; categoria_id: number | null; subcategoria_id: number | null; favorecido: string; faturas: TituloOut[] };

const edicaoReceber = (l: LinhaOut): EdicaoReceber => ({
  marcada: !l.sugestao?.aviso,
  modo: "avulsa",
  descricao: l.sugestao?.descricao || l.descricao,
  categoria_id: l.sugestao?.categoria_id ?? null,
  subcategoria_id: l.sugestao?.subcategoria_id ?? null,
  favorecido: l.sugestao?.favorecido ?? "",
  faturas: [],
});

function Modo({ valor, onChange, id }: { valor: "avulsa" | "fatura"; onChange: (m: "avulsa" | "fatura") => void; id: number }) {
  return (
    <div role="radiogroup" aria-label="Como lançar" className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
      {(["avulsa", "fatura"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={valor === m}
          id={`modo-${id}-${m}`}
          onClick={() => onChange(m)}
          className={cn("rounded-md px-2.5 py-1 font-medium whitespace-nowrap transition", valor === m ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}
        >
          {m === "avulsa" ? "Receita avulsa" : "Vincular a fatura"}
        </button>
      ))}
    </div>
  );
}

export function CriarReceberDialog({ conc, onFechar }: { conc: ConciliacaoDetalhe; onFechar: Fechar }) {
  const [linhas] = useState(() => conc.linhas.filter((l) => l.situacao === "sem_correspondencia" && l.tipo === "credito"));
  const [ed, setEd] = useState<Record<number, EdicaoReceber>>(() => Object.fromEntries(linhas.map((l) => [l.id, edicaoReceber(l)])));
  const [erros, setErros] = useState<Record<number, string>>({});
  const corpo = useRef<HTMLTableSectionElement>(null);
  const gravar = useGravar<ItemReceber>(conc, "criar-receber", onFechar, setErros);
  const ia = useSugerirIA(conc, (c) => {
    setEd((atual) => {
      const novo = { ...atual };
      let n = 0;
      c.linhas.forEach((l) => {
        if (novo[l.id] && !novo[l.id].categoria_id && l.sugestao?.categoria_id) {
          novo[l.id] = { ...novo[l.id], categoria_id: l.sugestao.categoria_id, subcategoria_id: l.sugestao.subcategoria_id };
          n += 1;
        }
      });
      toast[n ? "success" : "info"](n ? `A IA sugeriu a categoria de ${n} linha(s). Confira antes de gravar.` : "A IA não encontrou categoria para as linhas que faltavam.");
      return novo;
    });
  });
  const mudar = (id: number, p: Partial<EdicaoReceber>) => {
    setEd((a) => ({ ...a, [id]: { ...a[id], ...p } }));
    setErros((a) => (a[id] ? { ...a, [id]: "" } : a));
  };
  const marcadas = linhas.filter((l) => ed[l.id].marcada);
  const falta = (l: LinhaOut) => {
    const e = ed[l.id];
    if (!e.marcada) return false;
    return e.modo === "fatura" ? e.faturas.length === 0 : !e.categoria_id || e.descricao.trim().length < 2;
  };
  const faltando = linhas.filter(falta);
  const total = marcadas.reduce((s, l) => s + toNum(l.valor), 0);
  return (
    <PopupLote
      open
      onOpenChange={(o) => !o && onFechar()}
      titulo="Recebimentos para criar"
      descricao={
        <>
          Entradas do extrato de <strong>{conc.conta_nome}</strong> sem fatura correspondente. Em cada linha, escolha: lançar como <strong>receita avulsa</strong>{" "}
          (crédito no extrato) ou <strong>vincular a uma fatura em aberto</strong> (dá a baixa na fatura e na NFS-e, com um crédito só).
        </>
      }
      ferramentas={
        <BotaoIA visivel={conc.ia_disponivel && linhas.some((l) => ed[l.id].modo === "avulsa" && !ed[l.id].categoria_id)} carregando={ia.isPending} onClick={() => ia.mutate()} />
      }
      rodape={
        <RodapeLote
          marcadas={marcadas.length}
          total={total}
          faltando={faltando.length}
          rotuloFalta="a categoria ou a fatura"
          rotuloGravar={marcadas.length === 1 ? "Criar 1 lançamento" : `Criar ${marcadas.length} lançamentos`}
          gravando={gravar.isPending}
          onFechar={onFechar}
          onIrParaFalta={() => corpo.current?.querySelector<HTMLElement>(`[data-linha="${faltando[0]?.id}"] :is(select, [data-slot=popover-trigger])`)?.focus()}
          onGravar={() =>
            gravar.mutate(
              marcadas.map((l) => {
                const e = ed[l.id];
                return { linha_id: l.id, modo: e.modo, descricao: e.descricao.trim(), categoria_id: e.categoria_id, subcategoria_id: e.subcategoria_id, favorecido: e.favorecido.trim() || null, fatura_ids: e.modo === "fatura" ? e.faturas.map((f) => f.id) : [] };
              }),
            )
          }
        />
      }
    >
      <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(TH, "w-12 pl-5")}>
              <MarcarTodas total={linhas.length} marcadas={marcadas.length} onChange={(v) => setEd((a) => Object.fromEntries(Object.entries(a).map(([k, x]) => [k, { ...x, marcada: v }])))} />
            </th>
            <th className={cn(TH, "w-24")}>Data</th>
            <th className={cn(TH, "w-[250px]")}>Linha do extrato</th>
            <th className={TH}>Como lançar</th>
            <th className={cn(TH, "w-36 pr-5 text-right")}>Valor</th>
          </tr>
        </thead>
        <tbody ref={corpo}>
          {linhas.map((l) => {
            const e = ed[l.id];
            const soma = e.faturas.reduce((s, f) => s + toNum(f.valor), 0);
            const somaLiquida = e.faturas.reduce((s, f) => s + toNum(f.valor_liquido ?? f.valor), 0);
            const difere = e.modo === "fatura" && e.faturas.length > 0 && Math.abs(soma - toNum(l.valor)) > 0.004 && Math.abs(somaLiquida - toNum(l.valor)) > 0.004;
            return (
              <tr key={l.id} data-linha={l.id} className={linhaTr(falta(l) || !!erros[l.id], e.marcada)}>
                <td className="border-b px-3 py-2.5 pl-5">
                  <Checkbox aria-label={`Lançar ${l.descricao}`} className="mt-1.5" checked={e.marcada} onCheckedChange={(v) => mudar(l.id, { marcada: !!v })} />
                </td>
                <td className="border-b px-3 py-2.5 pt-3.5 font-mono text-xs whitespace-nowrap">{data(l.data)}</td>
                <td className="max-w-0 border-b px-3 py-2.5 pt-3">
                  <p className="font-mono text-xs break-words" title={l.descricao}>
                    {l.descricao || "sem descrição"}
                  </p>
                  <p className="mt-1">
                    <OrigemSugestao l={l} />
                  </p>
                  {l.aviso && <ErroLinha texto={l.aviso} />}
                  <ErroLinha texto={erros[l.id]} />
                </td>
                <td className="border-b px-3 py-2.5">
                  <Modo id={l.id} valor={e.modo} onChange={(m) => mudar(l.id, { modo: m })} />
                  {e.modo === "avulsa" ? (
                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      <Input aria-label="Descrição do recebimento" placeholder="Descrição" value={e.descricao} maxLength={255} aria-invalid={(e.marcada && e.descricao.trim().length < 2) || undefined} onChange={(ev) => mudar(l.id, { descricao: ev.target.value })} />
                      <Input aria-label="Cliente ou quem pagou" placeholder="Cliente ou quem pagou (opcional)" value={e.favorecido} maxLength={200} onChange={(ev) => mudar(l.id, { favorecido: ev.target.value })} />
                      <div className={cn("rounded-lg lg:col-span-2", e.marcada && !e.categoria_id && "ring-2 ring-warning/60")}>
                        <CategoriaSubSelect tipo="receita" idBase={`cr-${l.id}`} vazio="Escolha a categoria…" categoriaId={e.categoria_id} subcategoriaId={e.subcategoria_id} onChange={(c, s) => mudar(l.id, { categoria_id: c, subcategoria_id: s })} />
                      </div>
                      {e.marcada && !e.categoria_id && <p className="text-xs text-warning-ink lg:col-span-2">Falta a categoria</p>}
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {e.faturas.map((f) => (
                        <CartaoTitulo key={f.id} t={f} onRemover={() => mudar(l.id, { faturas: e.faturas.filter((x) => x.id !== f.id) })} />
                      ))}
                      <div className="flex flex-wrap items-center gap-2">
                        <TituloBusca tipo="fatura" rotulo={e.faturas.length ? "Outra fatura" : "Escolher a fatura"} invalido={e.marcada && e.faturas.length === 0} escolhidos={e.faturas.map((f) => f.id)} onEscolher={(f) => mudar(l.id, { faturas: [...e.faturas, f] })} />
                        {e.marcada && e.faturas.length === 0 && <span className="text-xs text-warning-ink">Falta escolher a fatura</span>}
                        {difere && (
                          <span className="text-xs text-warning-ink">
                            As faturas somam {moeda(soma)} e o crédito é de {moeda(l.valor)}.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </td>
                <td className="border-b px-3 py-2.5 pt-3.5 pr-5 text-right">
                  <ValorLinha l={l} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PopupLote>
  );
}

// ================================================================ baixas sugeridas
type EdicaoBaixa = { marcada: boolean; titulos: TituloOut[] };

export function BaixasDialog({ conc, onFechar }: { conc: ConciliacaoDetalhe; onFechar: Fechar }) {
  const [linhas] = useState(() => conc.linhas.filter((l) => l.situacao === "baixa_sugerida"));
  // seleção inicial: só as de alta confiança
  const [ed, setEd] = useState<Record<number, EdicaoBaixa>>(() => Object.fromEntries(linhas.map((l) => [l.id, { marcada: l.confianca === "alta" && !l.aviso, titulos: l.titulos }])));
  const [erros, setErros] = useState<Record<number, string>>({});
  const corpo = useRef<HTMLTableSectionElement>(null);
  const gravar = useGravar<ItemBaixa>(conc, "aprovar-baixas", onFechar, setErros);
  const mudar = (id: number, p: Partial<EdicaoBaixa>) => {
    setEd((a) => ({ ...a, [id]: { ...a[id], ...p } }));
    setErros((a) => (a[id] ? { ...a, [id]: "" } : a));
  };
  const marcar = (quais: (l: LinhaOut) => boolean) => setEd((a) => Object.fromEntries(linhas.map((l) => [l.id, { ...a[l.id], marcada: quais(l) }])));
  const marcadas = linhas.filter((l) => ed[l.id].marcada);
  const faltando = marcadas.filter((l) => ed[l.id].titulos.length === 0);
  const altas = linhas.filter((l) => l.confianca === "alta").length;
  const total = marcadas.reduce((s, l) => s + toNum(l.valor), 0);
  return (
    <PopupLote
      open
      onOpenChange={(o) => !o && onFechar()}
      titulo="Baixas sugeridas"
      descricao={
        <>
          Linhas do extrato de <strong>{conc.conta_nome}</strong> que casam com conta a pagar ou fatura em aberto. Confira o par, troque o título se não for esse e
          confirme: a baixa sai com a data do banco.
        </>
      }
      ferramentas={
        <>
          <Button variant="outline" size="sm" disabled={altas === 0} onClick={() => marcar((l) => l.confianca === "alta" && !l.aviso)}>
            Marcar as {altas} de alta confiança
          </Button>
          <Button variant="ghost" size="sm" onClick={() => marcar(() => true)}>
            Marcar todas
          </Button>
          <Button variant="ghost" size="sm" onClick={() => marcar(() => false)}>
            Desmarcar todas
          </Button>
        </>
      }
      rodape={
        <RodapeLote
          marcadas={marcadas.length}
          total={total}
          faltando={faltando.length}
          rotuloFalta="o título"
          rotuloGravar={marcadas.length === 1 ? "Dar baixa em 1 título" : `Dar baixa nas ${marcadas.length} marcadas`}
          gravando={gravar.isPending}
          onFechar={onFechar}
          onIrParaFalta={() => corpo.current?.querySelector<HTMLElement>(`[data-linha="${faltando[0]?.id}"] [data-slot=popover-trigger]`)?.focus()}
          onGravar={() => gravar.mutate(marcadas.map((l) => ({ linha_id: l.id, titulo: l.tipo === "debito" ? "conta_pagar" : "fatura", ids: ed[l.id].titulos.map((t) => t.id) })))}
        />
      }
    >
      <table className="w-full min-w-[1040px] table-fixed border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className={cn(TH, "w-12 pl-5")}>
              <MarcarTodas total={linhas.length} marcadas={marcadas.length} onChange={(v) => marcar(() => v)} />
            </th>
            <th className={cn(TH, "w-[30%]")}>No extrato do banco</th>
            <th className={cn(TH, "w-8 px-0")} />
            <th className={cn(TH, "w-[36%]")}>No sistema</th>
            <th className={cn(TH, "pr-5")}>Por que este</th>
          </tr>
        </thead>
        <tbody ref={corpo}>
          {linhas.map((l) => {
            const e = ed[l.id];
            const tipoTitulo = l.tipo === "debito" ? "conta_pagar" : "fatura";
            const soma = e.titulos.reduce((s, t) => s + toNum(t.valor), 0);
            const somaLiquida = e.titulos.reduce((s, t) => s + toNum(t.valor_liquido ?? t.valor), 0);
            const dif = toNum(l.valor) - soma;
            const fecha = Math.abs(dif) < 0.005 || Math.abs(toNum(l.valor) - somaLiquida) < 0.005;
            const trocado = e.titulos.map((t) => t.id).join() !== l.titulos.map((t) => t.id).join();
            return (
              <tr key={l.id} data-linha={l.id} className={linhaTr((e.marcada && e.titulos.length === 0) || !!erros[l.id], e.marcada)}>
                <td className="border-b px-3 py-3 pl-5">
                  <Checkbox aria-label={`Dar baixa: ${l.descricao}`} className="mt-1" checked={e.marcada} onCheckedChange={(v) => mudar(l.id, { marcada: !!v })} />
                </td>
                <td className="max-w-0 border-b px-3 py-3">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{data(l.data)}</span>
                    <ValorLinha l={l} className="text-sm font-semibold" />
                  </p>
                  <p className="mt-1 font-mono text-xs break-words" title={l.descricao}>
                    {l.descricao || "sem descrição"}
                  </p>
                  {l.aviso && <ErroLinha texto={l.aviso} />}
                  <ErroLinha texto={erros[l.id]} />
                </td>
                <td className="border-b py-3 pt-4 text-center text-muted-foreground">
                  <ArrowRight className="mx-auto size-4" />
                </td>
                <td className="max-w-0 border-b px-3 py-3">
                  <div className="space-y-1.5">
                    {e.titulos.map((t) => (
                      <CartaoTitulo key={t.id} t={t} onRemover={() => mudar(l.id, { titulos: e.titulos.filter((x) => x.id !== t.id) })} />
                    ))}
                    <div className="flex flex-wrap items-center gap-2">
                      <TituloBusca
                        tipo={tipoTitulo}
                        rotulo={e.titulos.length ? "Acrescentar título" : tipoTitulo === "fatura" ? "Escolher a fatura" : "Escolher a conta a pagar"}
                        invalido={e.marcada && e.titulos.length === 0}
                        escolhidos={e.titulos.map((t) => t.id)}
                        onEscolher={(t) => mudar(l.id, { titulos: [...e.titulos, t] })}
                      />
                      {e.titulos.length > 0 && !fecha && (
                        <span className="text-xs text-warning-ink">
                          {e.titulos.length === 1 && tipoTitulo === "conta_pagar"
                            ? `Diferença de ${moeda(Math.abs(dif))}: entra como ${dif > 0 ? "juros" : "desconto"}.`
                            : `Os títulos somam ${moeda(soma)} e a linha é de ${moeda(l.valor)}.`}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="border-b px-3 py-3 pr-5">
                  {trocado ? (
                    <Pill tom="info">título escolhido por você</Pill>
                  ) : (
                    <>
                      <Pill tom={l.confianca === "alta" ? "success" : "warning"}>confiança {l.confianca === "alta" ? "alta" : "média"}</Pill>
                      <p className="mt-1 text-xs text-muted-foreground">{l.motivo}</p>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PopupLote>
  );
}
