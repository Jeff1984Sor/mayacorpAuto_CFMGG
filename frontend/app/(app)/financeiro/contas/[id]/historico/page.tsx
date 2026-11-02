"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarRange,
  CheckCircle2,
  Copy,
  FileUp,
  Landmark,
  Loader2,
  Repeat,
  Sparkles,
  Tags,
  UserRound,
  UsersRound,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { KpiCard } from "@/components/mayacorp/kpi-card";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data, moeda, numero } from "@/lib/format";
import { cn } from "@/lib/utils";

type Papel = "fornecedor" | "profissional" | "cliente" | "banco" | "imposto" | "transferencia" | "outro";

interface Grupo {
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
}

interface Analise {
  ia: boolean;
  periodo: { de: string; ate: string };
  totais: { movimentos: number; entradas: string; saidas: string; ja_lancados: number };
  resumo: { fornecedores_novos: number; profissionais_novos: number; clientes_novos: number; categorias_novas: number };
  grupos: Grupo[];
  linhas: { data: string; descricao: string; valor: string; tipo: string; documento: string | null; grupo: string; duplicada: boolean }[];
}

interface Resultado {
  lancados: number;
  ignorados: number;
  criados: { fornecedores: string[]; profissionais: string[]; clientes: string[]; categorias: string[] };
  saldo_calculado: string;
}

const PAPEIS: { v: Papel; l: string }[] = [
  { v: "fornecedor", l: "Fornecedor" },
  { v: "profissional", l: "Profissional" },
  { v: "cliente", l: "Cliente" },
  { v: "banco", l: "Banco (tarifas)" },
  { v: "imposto", l: "Imposto" },
  { v: "transferencia", l: "Transferência própria" },
  { v: "outro", l: "Outro" },
];

const ETAPAS = ["Lendo o extrato…", "Agrupando por favorecido…", "Cruzando com os cadastros…", "A IA está classificando…"];

/** Importar o histórico da conta com IA: raio-x do extrato antigo, o que falta cadastrar e o lançamento de tudo. */
export default function HistoricoContaPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState(0);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [filtro, setFiltro] = useState<"falta" | "todos">("falta");
  const contas = useQuery({ queryKey: ["fin", "contas"], queryFn: () => api.get<{ id: number; nome: string }[]>("/financeiro/contas") });
  const conta = { data: contas.data?.find((c) => String(c.id) === id) };

  const analisar = useMutation({
    mutationFn: (arquivo: File) => {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      setEtapa(0);
      const t = setInterval(() => setEtapa((e) => Math.min(e + 1, ETAPAS.length - 1)), 1600);
      return api.post<Analise>(`/financeiro/contas/${id}/historico/analisar`, fd).finally(() => clearInterval(t));
    },
    onSuccess: (a) => setGrupos(a.grupos),
  });
  const a = analisar.data;
  const importar = useMutation({
    mutationFn: () => api.post<Resultado>(`/financeiro/contas/${id}/historico/importar`, { grupos, linhas: a!.linhas }),
    onSuccess: () => {
      qc.invalidateQueries();
      import("canvas-confetti").then((m) => m.default({ particleCount: 120, spread: 80, origin: { y: 0.6 }, colors: ["#1E2D6B", "#7C8FFF", "#1A8F5E", "#F5A623"] }));
    },
  });
  const set = (chave: string, campo: keyof Grupo, valor: unknown) =>
    setGrupos((gs) => gs.map((g) => (g.chave === chave ? { ...g, [campo]: valor, ...(campo === "papel" || campo === "nome" ? { existente_id: null } : {}) } : g)));

  const falta = useMemo(() => {
    const novos = (p: Papel) => grupos.filter((g) => g.papel === p && !g.existente_id);
    const cats = new Map<string, Grupo>();
    grupos.filter((g) => g.categoria_nova && g.categoria).forEach((g) => cats.set(g.categoria!.toLowerCase(), g));
    return { fornecedores: novos("fornecedor"), profissionais: novos("profissional"), clientes: novos("cliente"), categorias: [...cats.values()] };
  }, [grupos]);
  const recorrentes = grupos.filter((g) => g.recorrente && g.tipo === "debito");
  const novos = a ? a.linhas.filter((l) => !l.duplicada).length : 0;
  const visiveis = filtro === "falta" ? grupos.filter((g) => !g.existente_id && ["fornecedor", "profissional", "cliente"].includes(g.papel)) : grupos;
  const r = importar.data;

  return (
    <div>
      <PageHeader
        titulo="Importar histórico com IA"
        icone={Sparkles}
        migalhas={[{ label: "Conta bancária", href: "/financeiro/contas" }, { label: conta.data?.nome ?? "Conta", href: `/financeiro/contas/${id}` }, { label: "Histórico" }]}
        acoes={
          <Button variant="outline" render={<Link href={`/financeiro/contas/${id}`} />}>
            <ArrowLeft /> Voltar à conta
          </Button>
        }
      />
      <input
        ref={entrada}
        type="file"
        accept=".ofx,.csv,.txt,.xlsx,.xlsm"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) analisar.mutate(f);
          e.target.value = "";
        }}
      />

      {/* 1. enviar o extrato */}
      {!a && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) analisar.mutate(f);
          }}
          className="card-surface relative grid min-h-80 place-items-center overflow-hidden p-10 text-center"
        >
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/20 blur-3xl" />
          {analisar.isPending ? (
            <div className="relative space-y-4">
              <Loader2 className="mx-auto size-10 animate-spin text-brand" />
              <motion.p key={etapa} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-lg font-medium">
                {ETAPAS[etapa]}
              </motion.p>
              <p className="text-sm text-muted-foreground">Extratos de anos inteiros levam alguns segundos.</p>
            </div>
          ) : (
            <div className="relative max-w-xl space-y-4">
              <div className="mx-auto grid size-16 place-items-center rounded-2xl brand-gradient text-white shadow-lg shadow-brand/30">
                <FileUp className="size-8" />
              </div>
              <h2 className="text-2xl font-semibold">Traga o passado da conta</h2>
              <p className="text-muted-foreground">
                Envie o extrato antigo (OFX do banco, CSV ou Excel, de meses ou anos). A IA descobre quem é cada favorecido, mostra o que ainda não
                está cadastrado (fornecedores, profissionais, clientes, categorias) e lança tudo já categorizado, sem duplicar.
              </p>
              <Button size="lg" onClick={() => entrada.current?.click()}>
                <FileUp /> Escolher extrato
              </Button>
              <p className="text-xs text-muted-foreground">ou arraste o arquivo para cá</p>
              {analisar.isError && <p className="text-sm text-danger-ink">{(analisar.error as Error).message}</p>}
            </div>
          )}
        </div>
      )}

      {/* 3. resultado */}
      {r && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="card-surface space-y-5 p-8 text-center">
          <CheckCircle2 className="mx-auto size-14 text-success" />
          <h2 className="text-2xl font-semibold">Histórico importado!</h2>
          <p className="text-muted-foreground">
            <b className="text-foreground">{numero(r.lancados)}</b> lançamentos entraram na conta
            {r.ignorados ? ` (${numero(r.ignorados)} já existiam e ficaram de fora)` : ""}. Saldo calculado agora:{" "}
            <b className="font-mono text-foreground">{moeda(r.saldo_calculado)}</b>.
          </p>
          <div className="mx-auto grid max-w-3xl gap-3 text-left sm:grid-cols-2">
            {(
              [
                ["Fornecedores cadastrados", r.criados.fornecedores, Building2],
                ["Profissionais cadastrados (sem login)", r.criados.profissionais, UserRound],
                ["Clientes cadastrados", r.criados.clientes, UsersRound],
                ["Categorias criadas", r.criados.categorias, Tags],
              ] as const
            ).map(([t, lista, Icone]) => (
              <div key={t} className="rounded-xl border p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icone className="size-4 text-brand" /> {t}: {lista.length}
                </p>
                {lista.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{lista.slice(0, 8).join(" · ")}{lista.length > 8 ? " …" : ""}</p>}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Confira o saldo com o do banco. Se não bater, ajuste o saldo inicial em Editar conta.</p>
          <Button render={<Link href={`/financeiro/contas/${id}`} />}>Ver a conta</Button>
        </motion.div>
      )}

      {/* 2. raio-x */}
      {a && !r && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {a.ia ? (
              <Pill tom="brand">
                <Sparkles className="size-3" /> analisado pela IA
              </Pill>
            ) : (
              <Pill>classificado por palavras-chave (ligue a IA em Configurações para mais precisão)</Pill>
            )}
            <span className="text-muted-foreground">
              <CalendarRange className="mr-1 inline size-4" />
              {data(a.periodo.de)} a {data(a.periodo.ate)}
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => analisar.reset()}>
              Trocar arquivo
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard titulo="Movimentos no extrato" icone={Landmark} valor={numero(a.totais.movimentos)} dica={a.totais.ja_lancados ? `${numero(a.totais.ja_lancados)} já estão na conta` : "nenhum repetido"} />
            <KpiCard titulo="Entradas" icone={ArrowDownLeft} indice={1} valor={moeda(a.totais.entradas)} />
            <KpiCard titulo="Saídas" icone={ArrowUpRight} indice={2} valor={moeda(a.totais.saidas)} />
            <KpiCard titulo="Favorecidos" icone={UsersRound} indice={3} valor={numero(grupos.length)} dica={`${numero(grupos.filter((g) => g.existente_id).length)} já cadastrados`} />
          </div>

          {/* o que falta cadastrar */}
          <div className="card-surface p-5">
            <p className="mb-3 flex items-center gap-2 font-medium">
              <Sparkles className="size-4 text-brand" /> O que falta cadastrar
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ["Fornecedores novos", falta.fornecedores, Building2],
                  ["Profissionais novos", falta.profissionais, UserRound],
                  ["Clientes novos", falta.clientes, UsersRound],
                  ["Categorias novas", falta.categorias, Tags],
                ] as const
              ).map(([t, lista, Icone]) => (
                <div key={t} className={cn("rounded-xl border p-4", lista.length ? "border-brand/30 bg-brand/5" : "opacity-70")}>
                  <p className="flex items-center gap-2 text-sm">
                    <Icone className="size-4 text-brand" /> {t}
                  </p>
                  <p className="mt-1 text-3xl font-semibold">{lista.length}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {t === "Categorias novas" ? lista.map((g) => g.categoria).join(" · ") : lista.map((g) => g.nome).join(" · ") || "nada"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {recorrentes.length > 0 && (
            <div className="card-surface p-5">
              <p className="mb-3 flex items-center gap-2 font-medium">
                <Repeat className="size-4 text-brand" /> Contas que se repetem todo mês
              </p>
              <div className="flex flex-wrap gap-2">
                {recorrentes.map((g) => (
                  <span key={g.chave} className="rounded-full border px-3 py-1 text-sm">
                    {g.nome} · <span className="font-mono">{moeda(g.recorrente!.valor_medio)}</span> · dia {g.recorrente!.dia} ·{" "}
                    {g.recorrente!.meses} meses
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Dica: cadastre-as em Contas a pagar como recorrentes para a previsão de caixa ficar certa.</p>
            </div>
          )}

          {/* revisão por favorecido */}
          <div className="card-surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
              <p className="font-medium">Revise quem é quem</p>
              <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
                {(["falta", "todos"] as const).map((f) => (
                  <button key={f} type="button" onClick={() => setFiltro(f)} className={cn("rounded-md px-3 py-1", filtro === f && "bg-card shadow-sm")}>
                    {f === "falta" ? "Só os novos" : `Todos (${grupos.length})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">No extrato</th>
                    <th className="px-3 py-2.5 font-medium">É</th>
                    <th className="px-3 py-2.5 font-medium">Nome no cadastro</th>
                    <th className="px-3 py-2.5 font-medium">Categoria</th>
                    <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visiveis.map((g) => (
                    <tr key={g.chave}>
                      <td className="max-w-72 px-4 py-2.5">
                        <p className="truncate text-xs" title={g.exemplo}>
                          {g.tipo === "credito" ? <ArrowDownLeft className="mr-1 inline size-3.5 text-success" /> : <ArrowUpRight className="mr-1 inline size-3.5 text-danger" />}
                          {g.exemplo}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.qtd}× · {data(g.de)}
                          {g.ate !== g.de ? ` a ${data(g.ate)}` : ""}
                          {g.recorrente && " · mensal"}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <select value={g.papel} onChange={(e) => set(g.chave, "papel", e.target.value)} className="rounded-md border bg-background px-2 py-1 text-xs">
                          {PAPEIS.map((p) => (
                            <option key={p.v} value={p.v}>
                              {p.l}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Input value={g.nome} onChange={(e) => set(g.chave, "nome", e.target.value)} className="h-8 text-xs" />
                          {["fornecedor", "profissional", "cliente"].includes(g.papel) &&
                            (g.existente_id ? <Pill tom="success">já existe</Pill> : <Pill tom="brand">novo</Pill>)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {g.papel === "transferencia" ? (
                          <span className="text-xs text-muted-foreground">sem categoria</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Input value={g.categoria ?? ""} onChange={(e) => set(g.chave, "categoria", e.target.value || null)} className="h-8 text-xs" placeholder="Categoria" />
                            {g.categoria_nova && <Pill tom="warning">nova</Pill>}
                          </div>
                        )}
                      </td>
                      <td className={cn("px-3 py-2.5 text-right font-mono whitespace-nowrap", g.tipo === "credito" ? "text-success-ink" : "")}>
                        {g.tipo === "credito" ? "+" : "−"} {moeda(g.total)}
                      </td>
                    </tr>
                  ))}
                  {!visiveis.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        <CheckCircle2 className="mx-auto mb-2 size-6 text-success" /> Todo mundo deste extrato já está cadastrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-dark-maya p-3 pl-5 text-white shadow-2xl ring-1 ring-white/10">
            <p className="flex-1 text-sm">
              Vai cadastrar <b>{falta.fornecedores.length}</b> fornecedor(es), <b>{falta.profissionais.length}</b> profissional(is),{" "}
              <b>{falta.clientes.length}</b> cliente(s) e <b>{falta.categorias.length}</b> categoria(s), e lançar <b>{numero(novos)}</b> movimento(s)
              {a.totais.ja_lancados ? (
                <>
                  {" "}
                  <Copy className="mx-0.5 inline size-3.5" /> {numero(a.totais.ja_lancados)} repetido(s) ficam de fora
                </>
              ) : null}
              .
            </p>
            <Button className="bg-white text-navy hover:bg-white/90" disabled={importar.isPending || !novos} onClick={() => importar.mutate()}>
              {importar.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Importar histórico
            </Button>
          </div>
          {importar.isError && <p className="text-sm text-danger-ink">{(importar.error as Error).message}</p>}
        </div>
      )}
    </div>
  );
}
