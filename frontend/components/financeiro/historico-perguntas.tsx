"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  FastForward,
  Repeat,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data, moeda } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * O cliente decide: uma pergunta por vez sobre cada favorecido do extrato (quem é, se cadastra, em que categoria),
 * com a sugestão da IA já marcada. As respostas viram as decisões da importação.
 */

export type Papel =
  | "fornecedor"
  | "profissional"
  | "cliente"
  | "banco"
  | "imposto"
  | "transferencia"
  | "outro";

export interface GrupoHistorico {
  chave: string;
  tipo: "credito" | "debito";
  exemplo: string;
  qtd: number;
  total: string;
  de: string;
  ate: string;
  recorrente: { meses: number; valor_medio: string; dia: number } | null;
  papel: Papel;
  nome: string;
  existente_id: number | null;
  categoria: string | null;
  subcategoria: string | null;
  categoria_nova: boolean;
  cadastrar?: boolean;
}

const PAPEIS: { v: Papel; l: string; d: string }[] = [
  {
    v: "profissional",
    l: "Profissional",
    d: "salário, pró-labore, estagiário",
  },
  { v: "fornecedor", l: "Fornecedor", d: "aluguel, contas, serviços" },
  { v: "cliente", l: "Cliente", d: "quem paga honorários" },
  { v: "banco", l: "Banco", d: "tarifas, juros, IOF" },
  { v: "imposto", l: "Imposto", d: "DAS, DARF, ISS, INSS" },
  { v: "transferencia", l: "Transferência", d: "entre contas próprias" },
  { v: "outro", l: "Outro", d: "não se encaixa" },
];
const ROTULO: Record<Papel, string> = Object.fromEntries(
  PAPEIS.map((p) => [p.v, p.l.toLowerCase()]),
) as Record<Papel, string>;
const CADASTRAVEL: Papel[] = ["profissional", "fornecedor", "cliente"];

type Etapa = { chave: string; tipo: "papel" | "cadastro" | "categoria" };

function etapasDe(grupos: GrupoHistorico[]): Etapa[] {
  const out: Etapa[] = [];
  for (const g of grupos) {
    if (g.existente_id && !g.categoria_nova) continue; // já conhecido: nada a perguntar
    out.push({ chave: g.chave, tipo: "papel" });
    if (CADASTRAVEL.includes(g.papel) && !g.existente_id)
      out.push({ chave: g.chave, tipo: "cadastro" });
    if (g.papel !== "transferencia")
      out.push({ chave: g.chave, tipo: "categoria" });
  }
  return out;
}

export function PerguntasHistorico({
  grupos,
  sugestoes,
  onChange,
  onFim,
}: {
  grupos: GrupoHistorico[];
  sugestoes: Record<string, GrupoHistorico>;
  onChange: (chave: string, mudanca: Partial<GrupoHistorico>) => void;
  onFim: () => void;
}) {
  const [i, setI] = useState(0);
  const [direcao, setDirecao] = useState(1);
  const cats = useQuery({
    queryKey: ["fin", "categorias", "todas"],
    queryFn: () =>
      api.get<
        {
          id: number;
          nome: string;
          tipo: "receita" | "despesa";
          ativo: boolean;
        }[]
      >("/financeiro/categorias"),
  });
  // a lista de perguntas se ajusta às respostas (ex.: virou "transferência" → sem pergunta de categoria)
  const etapas = useMemo(() => etapasDe(grupos), [grupos]);
  const total = etapas.length;
  const atual = etapas[Math.min(i, total - 1)];
  const g = atual ? grupos.find((x) => x.chave === atual.chave) : undefined;
  const sug = g ? sugestoes[g.chave] : undefined;
  const [outra, setOutra] = useState("");

  const ir = (delta: number) => {
    setDirecao(delta);
    setOutra("");
    if (i + delta >= total) onFim();
    else setI(Math.max(0, i + delta));
  };

  if (!total || !g || !atual)
    return (
      <div className="card-surface p-8 text-center">
        <Check className="mx-auto mb-2 size-8 text-success" />
        <p className="font-medium">
          Nada a perguntar: todos os favorecidos já estão cadastrados.
        </p>
        <Button className="mt-4" onClick={onFim}>
          Ver o resumo
        </Button>
      </div>
    );

  const tipoCat = g.tipo === "credito" ? "receita" : "despesa";
  const opcoesCat = (cats.data ?? [])
    .filter((c) => c.ativo && c.tipo === tipoCat)
    .map((c) => c.nome);
  if (sug?.categoria && !opcoesCat.includes(sug.categoria))
    opcoesCat.unshift(sug.categoria);

  const contexto = (
    <div className="rounded-xl border bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-mono text-xs">
        {g.tipo === "credito" ? (
          <ArrowDownLeft className="size-4 text-success" />
        ) : (
          <ArrowUpRight className="size-4 text-danger" />
        )}
        {g.exemplo}
      </p>
      <p className="mt-1.5 text-muted-foreground">
        {g.qtd} {g.tipo === "credito" ? "recebimento(s)" : "pagamento(s)"} ·
        total <b className="font-mono text-foreground">{moeda(g.total)}</b> ·{" "}
        {data(g.de)}
        {g.ate !== g.de ? ` a ${data(g.ate)}` : ""}
        {g.recorrente && (
          <span className="ml-1 inline-flex items-center gap-1 text-info-ink">
            <Repeat className="size-3.5" /> todo mês, perto do dia{" "}
            {g.recorrente.dia}
          </span>
        )}
      </p>
    </div>
  );

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center gap-3 border-b px-5 py-3 text-sm">
        <span className="text-muted-foreground">
          Pergunta {Math.min(i + 1, total)} de {total}
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-brand"
            animate={{ width: `${(Math.min(i + 1, total) / total) * 100}%` }}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onFim}
          title="Usa a sugestão da IA em tudo o que falta"
        >
          <FastForward /> Aceitar as sugestões para o resto
        </Button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${atual.chave}-${atual.tipo}`}
          initial={{ opacity: 0, x: 30 * direcao }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 * direcao }}
          transition={{ duration: 0.2 }}
          className="space-y-5 p-6"
        >
          {atual.tipo === "papel" && (
            <>
              <h3 className="text-xl font-semibold">
                Quem é <span className="text-info-ink">{g.nome}</span>?
              </h3>
              {contexto}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {PAPEIS.map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => {
                      onChange(g.chave, {
                        papel: p.v,
                        existente_id:
                          p.v === sug?.papel ? sug.existente_id : null,
                      });
                      ir(1);
                    }}
                    className={cn(
                      "relative rounded-xl border p-3 text-left transition hover:border-brand/60 hover:bg-brand/5",
                      g.papel === p.v && "border-brand ring-2 ring-brand",
                    )}
                  >
                    <span className="block font-medium">{p.l}</span>
                    <span className="text-xs text-muted-foreground">{p.d}</span>
                    {sug?.papel === p.v && (
                      <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-medium text-info-ink">
                        <Sparkles className="size-3" /> sugestão
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {atual.tipo === "cadastro" && (
            <>
              <h3 className="text-xl font-semibold">
                Cadastro como {ROTULO[g.papel]} novo?
              </h3>
              {contexto}
              <div className="max-w-md space-y-1.5">
                <label htmlFor="hq-nome" className="text-sm">
                  Nome no cadastro
                </label>
                <Input
                  id="hq-nome"
                  value={g.nome}
                  onChange={(e) => onChange(g.chave, { nome: e.target.value })}
                  className="h-11 text-base"
                  autoFocus
                />
                {g.papel === "profissional" && (
                  <p className="text-xs text-muted-foreground">
                    Entra sem acesso ao sistema (só para lançamentos e horas).
                    Dá para dar login depois.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  onClick={() => {
                    onChange(g.chave, { cadastrar: true });
                    ir(1);
                  }}
                >
                  <Check /> Sim, cadastrar
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    onChange(g.chave, { cadastrar: false });
                    ir(1);
                  }}
                >
                  Não, só anotar o nome no lançamento
                </Button>
              </div>
            </>
          )}

          {atual.tipo === "categoria" && (
            <>
              <h3 className="text-xl font-semibold">
                Em qual categoria{" "}
                {g.tipo === "credito"
                  ? "entram esses recebimentos"
                  : "entram esses pagamentos"}
                ?
              </h3>
              {contexto}
              <div className="flex flex-wrap gap-2">
                {opcoesCat.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      onChange(g.chave, {
                        categoria: c,
                        categoria_nova: !(cats.data ?? []).some(
                          (x) => x.nome === c,
                        ),
                      });
                      ir(1);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition hover:border-brand/60 hover:bg-brand/5",
                      g.categoria === c &&
                        "border-brand bg-brand/10 ring-1 ring-brand",
                    )}
                  >
                    {sug?.categoria === c && (
                      <Sparkles className="size-3.5 text-info-ink" />
                    )}
                    {c}
                  </button>
                ))}
              </div>
              <form
                className="flex max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!outra.trim()) return;
                  onChange(g.chave, {
                    categoria: outra.trim(),
                    categoria_nova: !(cats.data ?? []).some(
                      (x) => x.nome === outra.trim(),
                    ),
                  });
                  ir(1);
                }}
              >
                <Input
                  value={outra}
                  onChange={(e) => setOutra(e.target.value)}
                  placeholder="Outra categoria (é criada)"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!outra.trim()}
                >
                  Usar
                </Button>
              </form>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-between border-t px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          disabled={i === 0}
          onClick={() => ir(-1)}
        >
          <ArrowLeft /> Voltar
        </Button>
        <Button variant="ghost" size="sm" onClick={() => ir(1)}>
          Manter e seguir
        </Button>
      </div>
    </div>
  );
}
