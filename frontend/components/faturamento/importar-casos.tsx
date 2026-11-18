"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  FolderPlus,
  Loader2,
  Repeat2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { data as fmtData, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

type Papel = "chave" | "contrato" | "descricao" | "valor" | "vencimento" | "titulo" | "processo" | "parte_contraria";
type Celula = string | number | boolean | null;

interface Lido {
  arquivo: string;
  colunas: string[];
  linhas: Celula[][];
  primeira_linha: number;
  sugestao: Record<Papel, number | null>;
  campos: { id: number; nome: string; do_cliente: boolean }[];
  campo_chave_id: number | null;
  contratos: { id: number; numero: number; nome: string; ativo: boolean }[];
}
interface Item {
  linha: number;
  chave: string;
  erro: string | null;
  caso: { id: number; numero: number; titulo: string } | null;
  contrato: { id: number; nome: string; numero: number } | null;
  contrato_novo: string | null;
  descricao: string;
  valor: string | null;
  vencimento: string | null;
  acao_caso: "criar" | "existe" | "repetido" | null;
  acao_regra: "criar" | "pular" | "sem_data" | "sem_valor" | null;
  motivo: string | null;
}
interface Plano {
  itens: Item[];
  resumo: {
    linhas: number;
    erros: number;
    casos_novos: number;
    casos_existentes: number;
    repetidos: number;
    regras_novas: number;
    regras_iguais: number;
    sem_data: number;
    sem_valor: number;
    contratos_novos: string[];
  };
}
interface Resultado {
  linha: number;
  chave: string;
  caso_numero: number | null;
  caso: "criado" | "existente" | null;
  regra: string | null;
  status: "ok" | "erro";
  mensagem: string | null;
}

const PAPEIS: { k: Papel; l: string; obrig?: boolean; dica: string }[] = [
  { k: "chave", l: "Chave do caso", obrig: true, dica: "ex.: nº do sinistro" },
  { k: "contrato", l: "Contrato", dica: "nome ou nº do contrato" },
  { k: "descricao", l: "Texto da cobrança", dica: "vai para a regra de cobrança" },
  { k: "valor", l: "Valor", dica: "valor da cobrança" },
  { k: "vencimento", l: "Vencimento", dica: "data da cobrança" },
  { k: "titulo", l: "Título do caso", dica: "opcional" },
  { k: "processo", l: "Nº do processo", dica: "opcional" },
  { k: "parte_contraria", l: "Parte contrária", dica: "opcional" },
];
const LOTE = 10;
const PASSOS = ["Arquivo", "Colunas", "Conferência", "Importação"] as const;

export function ImportarCasosDialog({ open, onOpenChange, tomadorId, nomeCliente }: { open: boolean; onOpenChange: (o: boolean) => void; tomadorId: number; nomeCliente: string }) {
  const qc = useQueryClient();
  const [passo, setPasso] = useState(0);
  const [lido, setLido] = useState<Lido | null>(null);
  const [mapa, setMapa] = useState<Record<Papel, number | null>>({} as Record<Papel, number | null>);
  const [campoChave, setCampoChave] = useState<number | null>(null);
  const [contratoPadrao, setContratoPadrao] = useState<number | null>(null);
  const [vencPadrao, setVencPadrao] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [perguntaData, setPerguntaData] = useState<"pergunta" | "data" | null>(null);
  const [dataTodos, setDataTodos] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [feitos, setFeitos] = useState<Resultado[]>([]);
  const [importando, setImportando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const reiniciar = () => {
    setPasso(0);
    setLido(null);
    setPlano(null);
    setVencPadrao(null);
    setFeitos([]);
    setPerguntaData(null);
  };
  const fechar = (o: boolean) => {
    if (importando) return; // não interrompe no meio
    onOpenChange(o);
    if (!o) setTimeout(reiniciar, 300);
  };

  const corpo = (linhas: Celula[][], primeira: number, venc: string | null) => ({
    linhas,
    mapa: Object.fromEntries(Object.entries(mapa).filter(([, v]) => v !== null && v !== undefined)),
    campo_chave_id: campoChave,
    contrato_padrao_id: contratoPadrao,
    vencimento_padrao: venc,
    primeira_linha: primeira,
  });

  const enviarArquivo = async (f: File) => {
    setCarregando(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", f);
      const r = await api.post<Lido>(`/faturamento/clientes/${tomadorId}/importar-casos/ler`, fd);
      setLido(r);
      setMapa(r.sugestao);
      setCampoChave(r.campo_chave_id);
      const ativos = r.contratos.filter((c) => c.ativo);
      setContratoPadrao(ativos.length === 1 ? ativos[0].id : null);
      setPasso(1);
    } catch {
      /* o api já mostra o erro */
    } finally {
      setCarregando(false);
    }
  };

  const analisar = async (venc: string | null = vencPadrao) => {
    if (!lido) return;
    if (mapa.chave === null || mapa.chave === undefined) return toast.error("Diga qual coluna tem a chave do caso.");
    if (!campoChave) return toast.error("Escolha em que campo do caso a chave fica guardada.");
    setCarregando(true);
    try {
      const p = await api.post<Plano>(`/faturamento/clientes/${tomadorId}/importar-casos/analisar`, corpo(lido.linhas, lido.primeira_linha, venc));
      setPlano(p);
      setPasso(2);
      if (p.resumo.sem_data > 0 && !venc) setPerguntaData("pergunta");
    } catch {
      /* erro já exibido */
    } finally {
      setCarregando(false);
    }
  };

  const importar = async () => {
    if (!lido || !plano) return;
    setPasso(3);
    setImportando(true);
    setFeitos([]);
    try {
      for (let i = 0; i < lido.linhas.length; i += LOTE) {
        const r = await api.post<{ resultados: Resultado[] }>(
          `/faturamento/clientes/${tomadorId}/importar-casos/aplicar`,
          corpo(lido.linhas.slice(i, i + LOTE), lido.primeira_linha + i, vencPadrao),
        );
        setFeitos((o) => [...o, ...r.resultados]);
      }
      qc.invalidateQueries({ queryKey: ["fat"] });
      toast.success("Importação concluída");
    } catch {
      toast.error("A importação parou no meio. Pode rodar de novo: o que já entrou não é repetido.");
    } finally {
      setImportando(false);
    }
  };

  const total = plano?.itens.length ?? 0;
  const pct = total ? Math.round((feitos.length / total) * 100) : 0;
  const cont = {
    casos: feitos.filter((r) => r.caso === "criado").length,
    existentes: feitos.filter((r) => r.caso === "existente").length,
    regras: feitos.filter((r) => r.regra === "criada").length,
    iguais: feitos.filter((r) => r.regra === "igual").length,
    erros: feitos.filter((r) => r.status === "erro").length,
  };
  const acabou = passo === 3 && !importando && feitos.length > 0;

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {/* cabeçalho com os passos */}
        <div className="relative overflow-hidden border-b bg-gradient-to-br from-brand/12 via-card to-success/8 px-6 pt-5 pb-4">
          <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand/15 blur-3xl" />
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="size-5 text-info-ink" /> Importar casos por planilha
          </DialogTitle>
          <DialogDescription>{nomeCliente}: cadastra os casos que faltam e as regras de cobrança, sem repetir o que já existe.</DialogDescription>
          <ol className="mt-4 flex items-center gap-2">
            {PASSOS.map((p, i) => (
              <li key={p} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-all",
                    i < passo ? "bg-success text-white" : i === passo ? "bg-brand text-white ring-4 ring-brand/20" : "bg-muted text-muted-foreground",
                  )}
                >
                  {i < passo ? <CheckCircle2 className="size-4" /> : i + 1}
                </span>
                <span className={cn("hidden text-sm sm:inline", i === passo ? "font-medium" : "text-muted-foreground")}>{p}</span>
                {i < PASSOS.length - 1 && <span className={cn("h-px flex-1 transition-colors", i < passo ? "bg-success" : "bg-border")} />}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={passo} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-6">
              {/* ---------------------------------------------------------------- 1. arquivo */}
              {passo === 0 && (
                <button
                  type="button"
                  onClick={() => arquivo.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setArrastando(true);
                  }}
                  onDragLeave={() => setArrastando(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setArrastando(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void enviarArquivo(f);
                  }}
                  className={cn(
                    "group flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-16 text-center transition",
                    arrastando ? "scale-[1.01] border-brand bg-brand/8" : "border-border hover:border-brand/50 hover:bg-muted/30",
                  )}
                >
                  <motion.span
                    animate={{ y: carregando ? 0 : [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                    className="grid size-16 place-items-center rounded-2xl bg-brand/12 text-info-ink shadow-sm"
                  >
                    {carregando ? <Loader2 className="size-7 animate-spin" /> : <UploadCloud className="size-8" />}
                  </motion.span>
                  <span className="text-base font-semibold">{carregando ? "Lendo a planilha…" : "Arraste a planilha aqui ou clique para escolher"}</span>
                  <span className="max-w-md text-sm text-muted-foreground">
                    Excel (.xlsx) ou .csv. O sistema descobre sozinho qual coluna é o sinistro, o contrato, o texto, o valor e o vencimento. Você confere antes de importar.
                  </span>
                  <input
                    ref={arquivo}
                    type="file"
                    accept=".xlsx,.xlsm,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void enviarArquivo(f);
                      e.target.value = "";
                    }}
                  />
                </button>
              )}

              {/* ---------------------------------------------------------------- 2. colunas */}
              {passo === 1 && lido && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-success/8 px-4 py-3 text-sm">
                    <Sparkles className="size-4 text-success-ink" />
                    <span>
                      <strong>{lido.arquivo}</strong>: {lido.linhas.length} linha(s). Já marquei as colunas que reconheci; confira.
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {PAPEIS.map((p) => (
                      <Field key={p.k} label={p.l} obrigatorio={p.obrig} htmlFor={`col-${p.k}`} dica={p.dica}>
                        <NativeSelect
                          id={`col-${p.k}`}
                          value={mapa[p.k] ?? ""}
                          onChange={(e) => setMapa((m) => ({ ...m, [p.k]: e.target.value === "" ? null : Number(e.target.value) }))}
                          className={cn(mapa[p.k] !== null && mapa[p.k] !== undefined && "border-success/50 bg-success/5")}
                        >
                          <option value="">— não usar —</option>
                          {lido.colunas.map((c, i) => (
                            <option key={i} value={i}>
                              {c}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="A chave fica guardada no campo" obrigatorio htmlFor="campo-chave" dica="É por ele que o sistema acha o caso que já existe.">
                      <NativeSelect id="campo-chave" value={campoChave ?? ""} onChange={(e) => setCampoChave(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">{lido.campos.length ? "Escolha…" : "Crie o campo (ex.: Nº do sinistro) na aba Casos"}</option>
                        {lido.campos.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nome}
                            {c.do_cliente ? " (deste cliente)" : ""}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    {(mapa.contrato === null || mapa.contrato === undefined) && (
                      <Field label="Contrato dos casos novos" htmlFor="contrato-padrao" dica="Sem coluna de contrato, todos vão para este. Vazio = cria um contrato.">
                        <NativeSelect id="contrato-padrao" value={contratoPadrao ?? ""} onChange={(e) => setContratoPadrao(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Criar “{nomeCliente} — casos importados”</option>
                          {lido.contratos.map((c) => (
                            <option key={c.id} value={c.id}>
                              #{c.numero} {c.nome}
                              {c.ativo ? "" : " (inativo)"}
                            </option>
                          ))}
                        </NativeSelect>
                      </Field>
                    )}
                  </div>
                  {/* amostra com as colunas escolhidas em destaque */}
                  <div className="overflow-x-auto rounded-2xl border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          {lido.colunas.map((c, i) => {
                            const papel = PAPEIS.find((p) => mapa[p.k] === i);
                            return (
                              <th key={i} className={cn("px-3 py-2 text-left font-medium whitespace-nowrap", papel && "bg-brand/10 text-info-ink")}>
                                {c}
                                {papel && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white">{papel.l}</span>}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lido.linhas.slice(0, 5).map((r, n) => (
                          <tr key={n}>
                            {lido.colunas.map((_, i) => (
                              <td key={i} className={cn("max-w-56 truncate px-3 py-1.5", PAPEIS.some((p) => mapa[p.k] === i) && "bg-brand/4")}>
                                {r[i] === null || r[i] === undefined ? "" : String(r[i])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------------------- 3. conferência */}
              {passo === 2 && plano && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Cartao icone={FolderPlus} tom="brand" n={plano.resumo.casos_novos} l="casos novos" />
                    <Cartao icone={Repeat2} tom="neutral" n={plano.resumo.casos_existentes} l="já cadastrados" />
                    <Cartao icone={Sparkles} tom="success" n={plano.resumo.regras_novas} l="cobranças novas" />
                    <Cartao icone={CheckCircle2} tom="neutral" n={plano.resumo.regras_iguais} l="cobranças iguais (pula)" />
                  </div>
                  {(plano.resumo.contratos_novos.length > 0 || plano.resumo.sem_data > 0 || plano.resumo.erros > 0) && (
                    <div className="space-y-2">
                      {plano.resumo.contratos_novos.length > 0 && (
                        <Aviso tom="brand">
                          Contrato(s) que não existem e serão criados: <strong>{plano.resumo.contratos_novos.join(", ")}</strong>. Depois confira os dados deles.
                        </Aviso>
                      )}
                      {plano.resumo.sem_data > 0 && (
                        <Aviso tom="warning">
                          {plano.resumo.sem_data} cobrança(s) sem data de vencimento: só o caso entra.{" "}
                          <button type="button" className="font-medium underline" onClick={() => setPerguntaData("pergunta")}>
                            Usar uma data para todas
                          </button>
                        </Aviso>
                      )}
                      {plano.resumo.erros > 0 && <Aviso tom="danger">{plano.resumo.erros} linha(s) com problema não entram (veja abaixo).</Aviso>}
                    </div>
                  )}
                  {vencPadrao && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CalendarClock className="size-4" /> Vencimento usado onde a planilha não traz data: <strong className="text-foreground">{fmtData(vencPadrao)}</strong>
                    </p>
                  )}
                  <div className="overflow-hidden rounded-2xl border">
                    <div className="max-h-[42dvh] overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                          <tr>
                            <th className="px-3 py-2 font-medium">Linha</th>
                            <th className="px-3 py-2 font-medium">Chave</th>
                            <th className="px-3 py-2 font-medium">Caso</th>
                            <th className="px-3 py-2 font-medium">Contrato</th>
                            <th className="px-3 py-2 font-medium">Cobrança</th>
                            <th className="px-3 py-2 text-right font-medium">Valor</th>
                            <th className="px-3 py-2 font-medium">Vencimento</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {plano.itens.map((it) => (
                            <tr key={it.linha} className={cn(it.erro && "bg-danger/5")}>
                              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{it.linha}</td>
                              <td className="px-3 py-2 font-mono text-xs">{it.chave || "—"}</td>
                              <td className="px-3 py-2">
                                {it.erro ? (
                                  <span className="text-xs text-danger-ink">{it.erro}</span>
                                ) : it.caso ? (
                                  <Chip tom="neutral">#{it.caso.numero} já existe</Chip>
                                ) : it.acao_caso === "repetido" ? (
                                  <Chip tom="neutral">mesmo caso da linha acima</Chip>
                                ) : (
                                  <Chip tom="brand">novo</Chip>
                                )}
                              </td>
                              <td className="max-w-44 truncate px-3 py-2 text-xs">
                                {it.contrato ? `#${it.contrato.numero} ${it.contrato.nome}` : it.contrato_novo ? <Chip tom="brand">criar: {it.contrato_novo}</Chip> : "—"}
                              </td>
                              <td className="max-w-64 px-3 py-2">
                                <p className="truncate text-xs" title={it.descricao}>
                                  {it.descricao || <span className="text-muted-foreground">Honorários</span>}
                                </p>
                                {it.acao_regra === "criar" ? (
                                  <Chip tom="success">nova</Chip>
                                ) : it.acao_regra === "pular" ? (
                                  <Chip tom="neutral">igual: pula</Chip>
                                ) : it.acao_regra === "sem_data" ? (
                                  <Chip tom="warning">sem data</Chip>
                                ) : it.acao_regra === "sem_valor" ? (
                                  <Chip tom="neutral">sem valor</Chip>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-xs">{it.valor ? moeda(toNum(it.valor)) : "—"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{it.vencimento ? fmtData(it.vencimento) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------------------------------------------------------------- 4. importação ao vivo */}
              {passo === 3 && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4 py-2 text-center">
                    <div className="relative grid size-36 place-items-center">
                      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
                        <circle cx="60" cy="60" r="52" className="fill-none stroke-muted" strokeWidth="10" />
                        <motion.circle
                          cx="60"
                          cy="60"
                          r="52"
                          className={cn("fill-none", acabou ? "stroke-success" : "stroke-brand")}
                          strokeWidth="10"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 52}
                          animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - pct / 100) }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </svg>
                      {acabou ? (
                        <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
                          <CheckCircle2 className="size-14 text-success" />
                        </motion.span>
                      ) : (
                        <span className="font-mono text-3xl font-semibold tabular-nums">{pct}%</span>
                      )}
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{acabou ? "Migração concluída!" : "Migrando os casos…"}</p>
                      <p className="text-sm text-muted-foreground">
                        {feitos.length} de {total} linha(s)
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <Cartao icone={FolderPlus} tom="brand" n={cont.casos} l="casos criados" />
                    <Cartao icone={Repeat2} tom="neutral" n={cont.existentes} l="já existiam" />
                    <Cartao icone={Sparkles} tom="success" n={cont.regras} l="cobranças criadas" />
                    <Cartao icone={CheckCircle2} tom="neutral" n={cont.iguais} l="iguais (puladas)" />
                    <Cartao icone={CircleAlert} tom={cont.erros ? "danger" : "neutral"} n={cont.erros} l="com problema" />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-2xl border bg-muted/20 p-2">
                    <AnimatePresence initial={false}>
                      {[...feitos].reverse().slice(0, 60).map((r) => (
                        <motion.div
                          key={`${r.linha}-${r.chave}`}
                          initial={{ opacity: 0, x: -12, height: 0 }}
                          animate={{ opacity: 1, x: 0, height: "auto" }}
                          className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
                        >
                          {r.status === "erro" ? <CircleAlert className="size-3.5 text-danger" /> : <CheckCircle2 className="size-3.5 text-success" />}
                          <span className="font-mono text-muted-foreground">linha {r.linha}</span>
                          <span className="font-mono">{r.chave}</span>
                          <span className="text-muted-foreground">
                            {r.status === "erro"
                              ? r.mensagem
                              : `${r.caso === "criado" ? `caso #${r.caso_numero} criado` : `caso #${r.caso_numero}`} · ${
                                  r.regra === "criada" ? "cobrança criada" : r.regra === "igual" ? "cobrança igual, pulada" : (r.mensagem ?? "sem cobrança")
                                }`}
                          </span>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* rodapé */}
        <div className="flex items-center justify-between gap-2 border-t bg-card px-6 py-3">
          <div>
            {passo > 0 && passo < 3 && (
              <Button type="button" variant="ghost" onClick={() => setPasso(passo - 1)} disabled={carregando}>
                <ArrowLeft /> Voltar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {passo === 1 && (
              <Button type="button" onClick={() => void analisar()} disabled={carregando}>
                {carregando ? <Loader2 className="animate-spin" /> : <ArrowRight />} Conferir
              </Button>
            )}
            {passo === 2 && plano && (
              <Button type="button" onClick={() => void importar()} disabled={!plano.itens.some((i) => !i.erro)}>
                <UploadCloud /> Importar {plano.itens.filter((i) => !i.erro).length} linha(s)
              </Button>
            )}
            {passo === 3 && (
              <Button type="button" onClick={() => fechar(false)} disabled={importando}>
                {importando ? <Loader2 className="animate-spin" /> : null} {importando ? "Importando…" : "Fechar"}
              </Button>
            )}
          </div>
        </div>

        {/* pergunta: mesma data para todas as cobranças sem vencimento */}
        <AnimatePresence>
          {perguntaData && plano && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-20 grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
              <motion.div initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} className="w-full max-w-2xl overflow-hidden rounded-3xl border bg-card shadow-2xl">
                <div className="flex items-start gap-3 border-b bg-warning/8 p-5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-warning/15 text-warning-ink">
                    <CalendarClock className="size-5" />
                  </span>
                  <div>
                    <p className="font-semibold">{plano.resumo.sem_data} cobrança(s) sem data de vencimento</p>
                    <p className="text-sm text-muted-foreground">Podemos colocar a mesma data de vencimento para todos estes casos?</p>
                  </div>
                </div>
                <div className="max-h-[38dvh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-4 py-2 font-medium">Caso</th>
                        <th className="px-4 py-2 font-medium">Cobrança</th>
                        <th className="px-4 py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {plano.itens
                        .filter((i) => i.acao_regra === "sem_data")
                        .map((i) => (
                          <tr key={i.linha}>
                            <td className="px-4 py-2 font-mono text-xs">
                              {i.chave}
                              <span className="ml-2 font-sans text-muted-foreground">{i.caso ? `#${i.caso.numero}` : "novo"}</span>
                            </td>
                            <td className="max-w-72 truncate px-4 py-2 text-xs">{i.descricao || "Honorários"}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs">{i.valor ? moeda(toNum(i.valor)) : "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t p-5">
                  {perguntaData === "pergunta" ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setPerguntaData(null)}>
                        Não, só cadastrar os casos
                      </Button>
                      <Button type="button" onClick={() => setPerguntaData("data")}>
                        Sim, mesma data para todos
                      </Button>
                    </div>
                  ) : (
                    <form
                      className="flex flex-wrap items-end justify-end gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!dataTodos) return toast.error("Escolha a data de vencimento.");
                        setVencPadrao(dataTodos);
                        setPerguntaData(null);
                        void analisar(dataTodos);
                      }}
                    >
                      <Field label="Data de vencimento para todos" htmlFor="venc-todos" className="flex-1">
                        <Input id="venc-todos" type="date" value={dataTodos} onChange={(e) => setDataTodos(e.target.value)} autoFocus />
                      </Field>
                      <Button type="button" variant="ghost" onClick={() => setPerguntaData("pergunta")}>
                        Voltar
                      </Button>
                      <Button type="submit">
                        <CheckCircle2 /> Aplicar a data
                      </Button>
                    </form>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

const TONS = {
  brand: "bg-brand/10 text-info-ink",
  success: "bg-success/10 text-success-ink",
  warning: "bg-warning/12 text-warning-ink",
  danger: "bg-danger/10 text-danger-ink",
  neutral: "bg-muted text-muted-foreground",
} as const;

function Cartao({ icone: Icone, tom, n, l }: { icone: React.ComponentType<{ className?: string }>; tom: keyof typeof TONS; n: number; l: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", TONS[tom])}>
        <Icone className="size-4" />
      </span>
      <div className="min-w-0">
        <motion.p key={n} initial={{ y: -4, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="font-mono text-xl leading-none font-semibold tabular-nums">
          {n}
        </motion.p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{l}</p>
      </div>
    </div>
  );
}

function Chip({ tom, children }: { tom: keyof typeof TONS; children: React.ReactNode }) {
  return <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", TONS[tom])}>{children}</span>;
}

function Aviso({ tom, children }: { tom: "brand" | "warning" | "danger"; children: React.ReactNode }) {
  return <div className={cn("rounded-xl px-4 py-2.5 text-sm", TONS[tom])}>{children}</div>;
}
