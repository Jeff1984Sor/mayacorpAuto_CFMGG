"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowRight, FilePlus2, Gavel, Loader2, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cabecalhoVazio,
  conteudoVazio,
  type Grau,
  type ProtocoloIn,
  type ProtocoloOut,
  ROTULO_GRAU,
  ROTULO_TIPO,
  type TipoProtocolo,
  useCandidatos,
  useProcesso,
  useProcessosBusca,
  useTribunais,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

const RAMOS: Record<string, string> = {
  superior: "Tribunais superiores",
  estadual: "Justiça estadual",
  federal: "Justiça federal",
  trabalho: "Justiça do trabalho",
  eleitoral: "Justiça eleitoral",
  militar: "Justiça militar",
};

function NovoProtocolo() {
  const router = useRouter();
  const params = useSearchParams();
  const { usuario } = useAuth();
  const processoUrl = Number(params.get("processo_id")) || null;
  const tipoUrl = params.get("tipo") as TipoProtocolo | null;
  const [tipo, setTipo] = useState<TipoProtocolo>(
    tipoUrl && tipoUrl in ROTULO_TIPO ? tipoUrl : processoUrl ? "intermediaria" : "inicial",
  );
  const [advogado, setAdvogado] = useState<number | null>(null);
  const [processoId, setProcessoId] = useState<number | null>(processoUrl);
  const [busca, setBusca] = useState("");
  const [tribunal, setTribunal] = useState("");
  const [grau, setGrau] = useState<Grau>("1g");
  const [titulo, setTitulo] = useState("");

  const cand = useCandidatos();
  const tribunais = useTribunais();
  const q = useDebounce(busca, 300);
  const inicial = tipo === "inicial";
  const processos = useProcessosBusca(q, !inicial && !processoId);
  const processo = useProcesso(processoId);

  // advogados possíveis: quem tem OAB cadastrada
  const advogados = useMemo(() => (cand.data ?? []).filter((c) => c.oabs.length > 0), [cand.data]);
  const advogadoId = advogado ?? (advogados.find((a) => a.id === usuario?.id)?.id ?? advogados[0]?.id ?? null);

  const porRamo = useMemo(() => {
    const g: Record<string, { sigla: string; nome: string }[]> = {};
    for (const t of tribunais.data ?? []) (g[t.ramo] ??= []).push({ sigla: t.sigla, nome: t.nome });
    return g;
  }, [tribunais.data]);

  const criar = useMutation({
    mutationFn: () => {
      const corpo: ProtocoloIn = {
        tipo,
        advogado_id: advogadoId!,
        titulo: titulo.trim() || null,
        processo_id: inicial ? null : processoId,
        caso_id: null,
        tribunal_sigla: inicial ? tribunal : null,
        grau,
        cabecalho: cabecalhoVazio(),
        partes: [],
        conteudo_peca: conteudoVazio(),
        tipo_peticao_codigo: null,
        tipo_peticao_nome: tipo === "habilitacao" ? "Pedido de habilitação" : null,
        em_resposta_a_intimacao_id: null,
        polo_peticionante: null,
        parte_ids: [],
        pedido_urgente: false,
        nivel_sigilo: 0,
        prazo_final: null,
        fora_do_prazo_justificativa: null,
      };
      return api.post<ProtocoloOut>("/tribunais/protocolos", corpo);
    },
    onSuccess: (p) => {
      toast.success("Rascunho criado. Agora preencha os dados da petição.");
      router.replace(`/tribunais/protocolos/${p.id}`);
    },
  });

  const pronto = !!advogadoId && (inicial ? !!tribunal : !!processoId);

  return (
    <div>
      <PageHeader
        titulo="Nova petição"
        icone={FilePlus2}
        analiseIA={false}
        migalhas={[
          { label: "Tribunais", href: "/tribunais" },
          { label: "Protocolos", href: "/tribunais/protocolos" },
          { label: "Nova petição" },
        ]}
      />
      <form
        className="card-surface mx-auto max-w-3xl space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (pronto) criar.mutate();
        }}
      >
        <div>
          <p className="mb-2 text-[13px] text-foreground/80">Tipo de petição</p>
          <div className="grid gap-2 sm:grid-cols-4">
            {(Object.keys(ROTULO_TIPO) as TipoProtocolo[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={cn(
                  "rounded-xl border p-3 text-left text-sm transition-all",
                  tipo === t ? "border-transparent bg-brand/10 ring-2 ring-brand" : "hover:border-brand/40",
                )}
              >
                <p className="font-medium">{ROTULO_TIPO[t]}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t === "inicial" ? "Abre um processo novo" : t === "habilitacao" ? "Entrar num processo existente" : "Em processo existente"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <Field
          label="Advogado que assina"
          obrigatorio
          dica={
            advogados.length === 0
              ? "Ninguém com OAB cadastrada. Cadastre a OAB em Tribunais › Meu certificado e OAB."
              : "Só ele pode aprovar o envio. O certificado dele é que assina a petição."
          }
        >
          {cand.isPending ? (
            <Skeleton className="h-9" />
          ) : (
            <NativeSelect value={advogadoId ?? ""} onChange={(e) => setAdvogado(Number(e.target.value) || null)}>
              {advogados.length === 0 && <option value="">—</option>}
              {advogados.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} · OAB {a.oabs.map((o) => `${o.numero}/${o.uf}`).join(", ")}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        {inicial ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Field label="Tribunal" obrigatorio>
              <NativeSelect value={tribunal} onChange={(e) => setTribunal(e.target.value)}>
                <option value="">Escolha o tribunal</option>
                {Object.entries(porRamo).map(([ramo, lista]) => (
                  <optgroup key={ramo} label={RAMOS[ramo] ?? ramo}>
                    {lista.map((t) => (
                      <option key={t.sigla} value={t.sigla}>
                        {t.sigla} · {t.nome}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Grau">
              <NativeSelect value={grau} onChange={(e) => setGrau(e.target.value as Grau)}>
                {Object.entries(ROTULO_GRAU).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        ) : (
          <Field label="Processo" obrigatorio>
            {processoId ? (
              <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                <Gavel className="size-5 shrink-0 text-info-ink" />
                {processo.data ? (
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="mr-1.5 text-xs font-semibold text-muted-foreground">{processo.data.tribunal}</span>
                      <Mono>{processo.data.numero_formatado}</Mono>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[processo.data.classe_nome, processo.data.orgao_julgador, processo.data.partes_resumo].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                ) : (
                  <Skeleton className="h-8 flex-1" />
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setProcessoId(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border">
                <div className="relative border-b p-2">
                  <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número CNJ, parte, classe ou vara" className="pl-9" autoFocus />
                </div>
                <ul className="max-h-72 divide-y overflow-y-auto">
                  {processos.isPending ? (
                    <li className="p-3">
                      <Skeleton className="h-8" />
                    </li>
                  ) : (processos.data?.itens ?? []).length === 0 ? (
                    <li className="p-4 text-center text-sm text-muted-foreground">
                      Nenhum processo encontrado. Importe o processo em Tribunais › Processos antes de peticionar.
                    </li>
                  ) : (
                    processos.data!.itens.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => setProcessoId(p.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/50">
                          <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">{p.tribunal}</span>
                          <span className="min-w-0 flex-1">
                            <Mono>{p.numero_formatado}</Mono>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[p.classe_nome, p.partes_resumo].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </Field>
        )}

        <Field label="Título interno" dica="Só para achar o protocolo aqui no sistema (ex.: Contestação — Fulano x Banco).">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} />
        </Field>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={() => router.push("/tribunais/protocolos")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!pronto || criar.isPending}>
            {criar.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />} Criar rascunho
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NovoProtocoloPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <NovoProtocolo />
    </Suspense>
  );
}
