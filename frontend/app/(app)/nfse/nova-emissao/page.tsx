"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  Check,
  FileText,
  FileUp,
  Loader2,
  Rocket,
  ShieldAlert,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { PageHeader } from "@/components/mayacorp/page-header";
import { BotaoAnaliseIA } from "@/components/ia/analise-ia";
import { RaioX, raioXKey } from "@/components/nfse/raio-x";
import { Resultado } from "@/components/nfse/resultado";
import { RpsEditor } from "@/components/nfse/rps-editor";
import { RpsTable, type FiltroRps } from "@/components/nfse/rps-table";
import { Transmissao } from "@/components/nfse/transmissao";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { nomeEmissora, useEmissoras } from "@/hooks/use-nfse";
import { loteFinalizado, useProgresso } from "@/hooks/use-progresso";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { documento, moeda, numero, tamanhoArquivo } from "@/lib/format";
import type { LoteDetalhe, LoteOut, ResumoImportacao, RpsOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const ETAPAS = ["Upload", "Pré-validação", "Transmissão", "Resultado"] as const;

function Stepper({ etapa }: { etapa: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 overflow-x-auto pb-1">
      {ETAPAS.map((e, i) => {
        const feito = i < etapa;
        const atual = i === etapa;
        return (
          <li key={e} className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors",
                atual && "bg-brand/12 ring-1 ring-brand/30",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold transition-all",
                  feito && "bg-success text-white",
                  atual && "brand-gradient text-white shadow-md shadow-brand/30",
                  !feito && !atual && "bg-muted text-muted-foreground",
                )}
              >
                {feito ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cn("text-sm whitespace-nowrap", atual ? "font-semibold" : "text-muted-foreground")}>{e}</span>
            </div>
            {i < ETAPAS.length - 1 && (
              <div className="h-px min-w-4 flex-1 bg-border">
                <motion.div className="h-px bg-success" initial={false} animate={{ width: feito ? "100%" : "0%" }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- etapa 1
interface Leitura {
  linhas: number;
  detalhes: number;
  encoding: string;
}

async function lerNoNavegador(f: File): Promise<Leitura> {
  const buf = await f.arrayBuffer();
  let txt: string;
  let encoding = "UTF-8";
  try {
    txt = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    txt = new TextDecoder("windows-1252").decode(buf);
    encoding = "Windows-1252";
  }
  const linhas = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return { linhas: linhas.length, detalhes: linhas.filter((l) => /^[26]/.test(l)).length, encoding };
}

function EtapaUpload({ onImportado }: { onImportado: (l: LoteDetalhe) => void }) {
  const emissoras = useEmissoras();
  const ativas = (emissoras.data ?? []).filter((e) => e.ativa);
  const [emissoraId, setEmissoraId] = useState<number | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const escolhida = ativas.find((e) => e.id === emissoraId) ?? (ativas.length === 1 ? ativas[0] : undefined);

  const onDrop = useCallback(async (aceitos: File[]) => {
    const f = aceitos[0];
    if (!f) return;
    setArquivo(f);
    setLeitura(await lerNoNavegador(f));
  }, []);
  const dz = useDropzone({
    onDrop,
    multiple: false,
    accept: { "text/plain": [".txt"] },
    onDropRejected: () => toast.error("Envie o arquivo .txt de RPS gerado pela Lello (layout da Prefeitura de SP)."),
  });

  const importar = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("arquivo", arquivo!);
      fd.append("emissora_id", String(escolhida!.id));
      return api.post<LoteDetalhe>("/nfse/importacoes", fd);
    },
    onSuccess: (l) => {
      toast.success(`${numero(l.qtd)} RPS lidos e conferidos`);
      onImportado(l);
    },
  });

  if (emissoras.isPending) return <Skeleton className="h-80 rounded-2xl" />;
  if (ativas.length === 0)
    return (
      <div className="card-surface">
        <EmptyState
          icone={Building2}
          titulo="Cadastre a empresa emissora primeiro"
          descricao="Precisamos do CNPJ, da inscrição municipal (CCM) e do certificado digital para emitir."
          acao={<Button render={<Link href="/cadastros/emissoras" />}>Cadastrar emissora</Button>}
        />
      </div>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div
          {...dz.getRootProps()}
          className={cn(
            "group relative grid min-h-72 cursor-pointer place-items-center overflow-hidden rounded-3xl border-2 border-dashed bg-card p-8 text-center transition-all",
            dz.isDragActive ? "scale-[1.01] border-brand bg-brand/5" : "hover:border-brand/50 hover:bg-brand/[0.03]",
          )}
        >
          <input {...dz.getInputProps()} />
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-0 transition-opacity group-hover:opacity-60" />
          <div className="relative">
            <motion.div
              animate={dz.isDragActive ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
              className="mx-auto grid size-16 place-items-center rounded-2xl brand-gradient text-white shadow-xl shadow-brand/30"
            >
              <UploadCloud className="size-8" />
            </motion.div>
            <h3 className="mt-5 text-lg font-semibold">{dz.isDragActive ? "Pode soltar!" : "Arraste o arquivo de RPS aqui"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              ou <span className="font-medium text-info-ink underline-offset-4 group-hover:underline">clique para escolher</span> · .txt no
              layout da Prefeitura de SP
            </p>
            <p className="mt-3 text-xs text-muted-foreground">.csv e .xlsx em breve</p>
          </div>
        </div>

        <AnimatePresence>
          {arquivo && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="card-surface flex items-center gap-4 p-4"
            >
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/12 text-info-ink">
                <FileText className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{arquivo.name}</p>
                <p className="text-sm text-muted-foreground">
                  {tamanhoArquivo(arquivo.size)}
                  {leitura && (
                    <>
                      {" "}
                      · <Mono>{numero(leitura.linhas)}</Mono> linhas · <Mono>{numero(leitura.detalhes)}</Mono> RPS detectados ·{" "}
                      {leitura.encoding}
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setArquivo(null);
                  setLeitura(null);
                }}
                aria-label="Remover arquivo"
              >
                <X />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="card-surface flex flex-col p-5">
        <h3 className="font-semibold">Empresa emissora</h3>
        <p className="mb-3 text-sm text-muted-foreground">Quem presta o serviço e emite as notas.</p>
        <div className="space-y-2">
          {ativas.map((e) => {
            const sel = escolhida?.id === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setEmissoraId(e.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all",
                  sel ? "border-brand bg-brand/6 ring-1 ring-brand/30" : "hover:border-brand/40",
                )}
              >
                <span className={cn("mt-0.5 grid size-4 place-items-center rounded-full border", sel && "border-brand bg-brand")}>
                  {sel && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{nomeEmissora(e)}</span>
                  <span className="block text-xs text-muted-foreground num">
                    {documento(e.cnpj)} · CCM {e.ccm}
                  </span>
                  {!e.saude_ok && (
                    <span className="mt-1 flex items-center gap-1 text-xs text-danger-ink">
                      <ShieldAlert className="size-3" /> {e.saude_msg || "Falta certificado válido"}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <Button
          className="mt-5 h-11 w-full brand-gradient text-white shadow-lg shadow-brand/25"
          disabled={!arquivo || !escolhida || importar.isPending}
          onClick={() => importar.mutate()}
        >
          {importar.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
          {importar.isPending ? "Lendo e validando…" : "Ler e validar arquivo"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Nada é enviado à Prefeitura nesta etapa.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- etapa 2
function RodapeResumo({
  resumo,
  onEmitir,
  onDescartar,
  emitindo,
}: {
  resumo: ResumoImportacao;
  onEmitir: () => void;
  onDescartar: () => void;
  emitindo: boolean;
}) {
  return (
    <div className="sticky bottom-3 z-20 mt-4">
      <div className="glass flex flex-col gap-3 rounded-2xl border p-3 shadow-2xl shadow-dark-maya/10 sm:flex-row sm:items-center sm:justify-between sm:pl-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            <strong className="num">{numero(resumo.qtd_selecionados)}</strong>
            <span className="text-muted-foreground">/{numero(resumo.qtd)} RPS</span>
          </span>
          <span className="font-semibold num">{moeda(resumo.valor_total)}</span>
          <span className="text-muted-foreground">
            ISS <span className="text-foreground num">{moeda(resumo.iss_total)}</span>
          </span>
          {resumo.tomadores_novos > 0 && (
            <span className="text-warning-ink">
              <span className="num">{resumo.tomadores_novos}</span> tomador(es) novo(s)
            </span>
          )}
          {resumo.com_erro > 0 && (
            <span className="font-medium text-danger-ink">
              <span className="num">{resumo.com_erro}</span> com erro
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-muted-foreground" onClick={onDescartar}>
            <Trash2 /> Descartar
          </Button>
          <Button
            onClick={onEmitir}
            disabled={!resumo.pode_emitir || emitindo || resumo.qtd_selecionados === 0}
            className="h-10 brand-gradient px-5 text-white shadow-lg shadow-brand/30 disabled:shadow-none"
          >
            {emitindo ? <Loader2 className="animate-spin" /> : <Rocket />}
            Emitir {numero(resumo.qtd_selecionados)} notas
          </Button>
        </div>
      </div>
      {!resumo.pode_emitir && resumo.com_erro > 0 && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Corrija ou desmarque as linhas com erro para liberar a emissão.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- página
export default function NovaEmissaoPage() {
  const { isOperador } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [loteId, setLoteId] = useState<number | null>(null);
  const [etapa, setEtapa] = useState(0);
  const [aberto, setAberto] = useState<RpsOut | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [descartar, setDescartar] = useState(false);
  const [destaque, setDestaque] = useState<{ titulo: string; ids: number[] } | null>(null);
  const atualizarRaioX = () => qc.invalidateQueries({ queryKey: raioXKey(loteId) });

  // retoma uma importação pela URL (?lote=ID)
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("lote"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- leitura única da URL
    if (id) setLoteId(id);
  }, []);

  const lote = useQuery({
    queryKey: ["lote", loteId],
    queryFn: () => api.get<LoteDetalhe>(`/nfse/importacoes/${loteId}`),
    enabled: !!loteId,
  });

  // etapa derivada do status quando o lote é carregado
  useEffect(() => {
    const s = lote.data?.status;
    if (!s) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza etapa com o servidor
    setEtapa(s === "validando" ? 1 : loteFinalizado(s) ? 3 : 2);
  }, [lote.data?.status]);

  const setLote = (l: LoteDetalhe) => {
    qc.setQueryData(["lote", l.id], l);
    setLoteId(l.id);
    window.history.replaceState(null, "", `/nfse/nova-emissao?lote=${l.id}`);
  };

  const atualizarLocal = (r: RpsOut, resumo: ResumoImportacao) =>
    qc.setQueryData<LoteDetalhe>(["lote", loteId], (old) =>
      old ? { ...old, resumo, rps: old.rps.map((x) => (x.id === r.id ? r : x)) } : old,
    );

  const toggle = useMutation({
    mutationFn: ({ r, v }: { r: RpsOut; v: boolean }) =>
      api.patch<{ rps: RpsOut; resumo: ResumoImportacao }>(`/nfse/importacoes/${loteId}/rps/${r.id}`, { selecionado: v }),
    onMutate: ({ r, v }) => {
      qc.setQueryData<LoteDetalhe>(["lote", loteId], (old) =>
        old ? { ...old, rps: old.rps.map((x) => (x.id === r.id ? { ...x, selecionado: v } : x)) } : old,
      );
    },
    onSuccess: (res) => {
      atualizarLocal(res.rps, res.resumo);
      atualizarRaioX();
    },
    onError: () => lote.refetch(),
  });

  const toggleTodos = useMutation({
    mutationFn: ({ v, filtro }: { v: boolean; filtro: FiltroRps }) =>
      api.post<ResumoImportacao>(`/nfse/importacoes/${loteId}/selecao`, {
        selecionado: v,
        status: filtro === "todos" ? undefined : filtro,
      }),
    onSuccess: () => {
      void lote.refetch();
      atualizarRaioX();
    },
  });

  const emitir = useMutation({
    mutationFn: () => api.post<LoteOut>(`/nfse/importacoes/${loteId}/emitir`),
    onSuccess: (l) => {
      setConfirmar(false);
      qc.setQueryData<LoteDetalhe>(["lote", loteId], (old) => (old ? { ...old, ...l } : old));
      setEtapa(2);
      qc.invalidateQueries({ queryKey: ["lotes"] });
    },
  });

  const descartarMut = useMutation({
    mutationFn: () => api.del(`/nfse/importacoes/${loteId}`),
    onSuccess: () => {
      toast.success("Importação descartada");
      setDescartar(false);
      setLoteId(null);
      setEtapa(0);
      setDestaque(null);
      window.history.replaceState(null, "", "/nfse/nova-emissao");
    },
  });

  const { progresso, conectado } = useProgresso(etapa === 2 ? loteId : null, async () => {
    await lote.refetch();
    setEtapa(3);
    qc.invalidateQueries({ queryKey: ["painel"] });
    qc.invalidateQueries({ queryKey: ["notas"] });
  });

  if (!isOperador)
    return (
      <EmptyState icone={ShieldAlert} titulo="Sem permissão" descricao="Seu perfil é somente leitura. Peça a um operador para emitir." />
    );

  const l = lote.data;

  return (
    <div>
      <PageHeader
        titulo="Nova emissão"
        descricao="Do arquivo da Lello às notas emitidas no layout 2 — em minutos."
        icone={FileUp}
        migalhas={[{ label: "NFS-e", href: "/nfse" }, { label: "Nova emissão" }]}
        acoes={
          etapa === 3 && (
            <>
              <Button variant="outline" render={<Link href={`/nfse/lotes/${loteId}`} />}>
                Ver detalhe do lote
              </Button>
              <Button
                onClick={() => {
                  setLoteId(null);
                  setEtapa(0);
                  router.replace("/nfse/nova-emissao");
                }}
              >
                <FileUp /> Nova emissão
              </Button>
            </>
          )
        }
      />
      <Stepper etapa={etapa} />

      <AnimatePresence mode="wait">
        <motion.div
          key={etapa}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22 }}
        >
          {etapa === 0 && <EtapaUpload onImportado={(x) => { setLote(x); setEtapa(1); }} />}

          {etapa === 1 &&
            (!l ? (
              <Skeleton className="h-96 rounded-2xl" />
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Button variant="ghost" size="sm" onClick={() => setDescartar(true)}>
                    <ArrowLeft /> Outro arquivo
                  </Button>
                  <span className="truncate">
                    <FileText className="mr-1 inline size-4" />
                    {l.arquivo_origem} · {l.emissora_nome}
                    {l.encoding && ` · ${l.encoding}`}
                  </span>
                </div>
                <RaioX
                  loteId={l.id}
                  qtdSelecionados={l.resumo.qtd_selecionados}
                  destaque={destaque}
                  onDestacar={setDestaque}
                  acao={<BotaoAnaliseIA endpoint={`/ia/analise/lote/${l.id}`} contexto={`Lote #${String(l.numero).padStart(4, "0")}`} tamanho="sm" />}
                />
                <RpsTable
                  rps={l.rps}
                  destaque={destaque}
                  onLimparDestaque={() => setDestaque(null)}
                  selecionavel
                  onAbrir={setAberto}
                  onToggle={(r, v) => toggle.mutate({ r, v })}
                  onToggleTodos={(v, filtro) => toggleTodos.mutate({ v, filtro })}
                />
                <RodapeResumo
                  resumo={l.resumo}
                  emitindo={emitir.isPending}
                  onEmitir={() => setConfirmar(true)}
                  onDescartar={() => setDescartar(true)}
                />
              </>
            ))}

          {etapa === 2 && <Transmissao progresso={progresso} conectado={conectado} />}

          {etapa === 3 && (l ? <Resultado lote={l} onCorrigir={setAberto} /> : <Skeleton className="h-72 rounded-3xl" />)}
        </motion.div>
      </AnimatePresence>

      {loteId && (
        <RpsEditor
          loteId={loteId}
          rps={aberto}
          onClose={() => setAberto(null)}
          onSaved={(r, resumo) => {
            atualizarLocal(r, resumo);
            atualizarRaioX();
            setAberto((a) => (a && a.id === r.id && r.status === "erro" ? r : a));
          }}
        />
      )}

      {l && (
        <ConfirmDialog
          open={confirmar}
          onOpenChange={setConfirmar}
          titulo={`Emitir ${numero(l.resumo.qtd_selecionados)} notas?`}
          descricao={
            <>
              Total de <strong>{moeda(l.resumo.valor_total)}</strong> para {l.emissora_nome}. Primeiro testamos o lote na Prefeitura;
              passando, as notas são transmitidas de verdade em lotes de até 50.
            </>
          }
          confirmar="Emitir agora"
          carregando={emitir.isPending}
          onConfirm={() => emitir.mutate()}
        />
      )}
      <ConfirmDialog
        open={descartar}
        onOpenChange={setDescartar}
        titulo="Descartar esta importação?"
        descricao="Nenhuma nota foi emitida. Você poderá subir o arquivo novamente."
        confirmar="Descartar"
        destrutivo
        carregando={descartarMut.isPending}
        onConfirm={() => descartarMut.mutate()}
      />
    </div>
  );
}
