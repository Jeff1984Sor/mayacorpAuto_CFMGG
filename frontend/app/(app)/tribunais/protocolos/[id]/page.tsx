"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileOutput,
  Loader2,
  MoreHorizontal,
  Save,
  ShieldAlert,
  Stamp,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, FormSection, NativeSelect } from "@/components/mayacorp/form";
import { DICA_VERIFICAR, PrazoTexto, SimuladoPill, StatusProtocoloBadge } from "@/components/tribunais-protocolo/comum";
import { ConteudoPecaEditor } from "@/components/tribunais-protocolo/conteudo-peca";
import { CustasProtocolo } from "@/components/tribunais-protocolo/custas";
import { DadosInicial } from "@/components/tribunais-protocolo/dados-inicial";
import { DadosIntermediaria } from "@/components/tribunais-protocolo/dados-intermediaria";
import { DocumentosProtocolo } from "@/components/tribunais-protocolo/documentos";
import { EnvioProtocolo } from "@/components/tribunais-protocolo/envio";
import { PartesEditor } from "@/components/tribunais-protocolo/partes-editor";
import { NaoEntrouDialog, RegistrarRetornoDialog, RetornosProtocolo } from "@/components/tribunais-protocolo/retorno";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { abrirArquivo, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dataHora } from "@/lib/format";
import {
  type AdvogadoParteIn,
  chaveProtocolos,
  EDITAVEIS,
  EM_ANDAMENTO,
  type Grau,
  limparProtocoloIn,
  type ProtocoloIn,
  type ProtocoloOut,
  protocoloParaIn,
  ROTULO_GRAU,
  ROTULO_TIPO,
  useCandidatos,
  useProtocolo,
} from "@/lib/tribunais-protocolo";

export default function ProtocoloPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const qc = useQueryClient();
  const { pode } = useAuth();
  const q = useProtocolo(id);
  const cand = useCandidatos();

  const [aba, setAba] = useState("dados");
  const [form, setForm] = useState<ProtocoloIn | null>(null);
  const [sync, setSync] = useState<string | null>(null);
  const [invalidada, setInvalidada] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [registrar, setRegistrar] = useState(false);
  const [naoEntrou, setNaoEntrou] = useState(false);

  // sincroniza o formulário com o servidor (sem perder o que está sendo digitado)
  const sujo = !!form && JSON.stringify(form) !== sync;
  const chave = q.data ? JSON.stringify(protocoloParaIn(q.data)) : null;
  if (chave && chave !== sync) {
    setSync(chave);
    if (!form || !sujo) setForm(JSON.parse(chave) as ProtocoloIn);
  }

  useEffect(() => {
    if (!sujo) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sujo]);

  const chaveQ = useMemo(() => [chaveProtocolos, "protocolo", id], [id]);

  /** Aplica a resposta do servidor e avisa se a aprovação caiu. */
  const aplicar = (r: ProtocoloOut) => {
    const ant = qc.getQueryData<ProtocoloOut>(chaveQ);
    if (ant && ((ant.aprovacao && !r.aprovacao) || r.aprovacoes_invalidadas > ant.aprovacoes_invalidadas)) {
      setInvalidada(true);
      toast.warning("A aprovação deixou de valer porque o conteúdo mudou. O advogado precisa aprovar de novo.");
    }
    qc.setQueryData(chaveQ, r);
    qc.invalidateQueries({ queryKey: [chaveProtocolos, "lista"] });
  };

  const salvarMut = useMutation({
    mutationFn: (f: ProtocoloIn) => {
      const corpo = limparProtocoloIn(f.tipo === "inicial" ? { ...f, nivel_sigilo: f.cabecalho.nivel_sigilo } : f);
      return api.put<ProtocoloOut>(`/tribunais/protocolos/${id}`, corpo);
    },
    onSuccess: (r) => {
      aplicar(r);
      const novo = JSON.stringify(protocoloParaIn(r));
      setSync(novo);
      setForm(JSON.parse(novo) as ProtocoloIn);
    },
  });
  const salvar = () => form && salvarMut.mutateAsync(form).then(() => toast.success("Petição salva"));
  const salvarSeSujo = async () => {
    if (sujo && form) await salvarMut.mutateAsync(form);
  };

  const previa = useMutation({
    mutationFn: async () => {
      await salvarSeSujo();
      await abrirArquivo(`/tribunais/protocolos/${id}/previa`);
    },
  });
  const gerar = useMutation({
    mutationFn: async () => {
      await salvarSeSujo();
      return api.post<ProtocoloOut>(`/tribunais/protocolos/${id}/gerar-peca`);
    },
    onSuccess: (r) => {
      aplicar(r);
      toast.success("Petição gerada em PDF e colocada como documento principal");
      setAba("documentos");
    },
  });
  const excluirMut = useMutation({
    mutationFn: () => api.del(`/tribunais/protocolos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "lista"] });
      toast.success("Protocolo excluído");
      router.replace("/tribunais/protocolos");
    },
  });

  // advogado que assina: pré-preenche a OAB no polo ativo
  const advogados = useMemo(() => (cand.data ?? []).filter((c) => c.oabs.length > 0), [cand.data]);
  const advogadoPadrao: AdvogadoParteIn | null = useMemo(() => {
    const a = advogados.find((x) => x.id === form?.advogado_id);
    if (!a) return null;
    const o = a.oabs.find((x) => x.tipo === "principal") ?? a.oabs[0];
    return { nome: a.nome, cpf: null, oab_numero: o.numero, oab_uf: o.uf, tipo_representante: "advogado", recebe_intimacao: true };
  }, [advogados, form?.advogado_id]);

  if (q.isPending || (q.data && !form)) return <Skeleton className="h-96 rounded-2xl" />;
  if (!q.data || !form) return <EmptyState icone={Stamp} titulo="Protocolo não encontrado" />;
  const p = q.data;
  const editavel = EDITAVEIS.includes(p.status) && pode("trib_protocolos.editar");
  const inicial = p.tipo === "inicial";
  const set = (patch: Partial<ProtocoloIn>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const erros = (p.validacao ?? []).filter((m) => m.nivel === "erro").length;
  const podeExcluir = (p.status === "rascunho" || p.status === "aprovado") && p.retornos.length === 0 && pode("trib_protocolos.editar");
  const podeRegistrar =
    pode("trib_protocolos.protocolar") &&
    (p.status === "verificar" || p.status === "erro" || (!!p.sistema_portal && (p.status === "rascunho" || p.status === "aprovado")));

  const acoesPeca = (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => previa.mutate()} disabled={previa.isPending}>
        {previa.isPending ? <Loader2 className="animate-spin" /> : <Eye />} Pré-visualizar PDF
      </Button>
      {editavel && (
        <Button type="button" size="sm" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
          {gerar.isPending ? <Loader2 className="animate-spin" /> : <FileOutput />} Gerar petição em PDF
        </Button>
      )}
    </>
  );

  return (
    <div>
      <Link href="/tribunais/protocolos" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Protocolos
      </Link>

      <div className="card-surface relative mb-4 overflow-hidden p-5">
        <div className="brand-gradient absolute inset-x-0 top-0 h-1.5" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{p.titulo || (inicial ? ROTULO_TIPO.inicial : (p.tipo_peticao_nome ?? ROTULO_TIPO[p.tipo]))}</h1>
              <StatusProtocoloBadge status={p.status} />
              <SimuladoPill simulado={p.simulado} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{ROTULO_TIPO[p.tipo]}</span>·<span>{p.tribunal}</span>·<span>{ROTULO_GRAU[p.grau]}</span>
              {p.sistema && <span>· {p.sistema.toUpperCase()}</span>}
              {p.numero_formatado && (
                <>
                  ·
                  <Link href={`/tribunais/processos/${p.processo_id}`} className="hover:underline">
                    <Mono>{p.numero_formatado}</Mono>
                  </Link>
                </>
              )}
              <span>· assina {p.advogado_nome}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {p.prazo_final && p.status !== "protocolado" && (
              <div className="text-right text-xs">
                <p className="text-muted-foreground">Prazo</p>
                <PrazoTexto prazo={p.prazo_final} className="items-end" />
              </div>
            )}
            {podeExcluir && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Mais ações" />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => setExcluir(true)}>
                    <Trash2 /> Excluir protocolo
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* faixas de situação */}
      {p.status === "verificar" && (
        <div className="mb-4 rounded-xl border-2 border-warning/60 bg-warning/12 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="size-6 shrink-0 text-warning-ink" />
            <div className="flex-1">
              <p className="font-semibold text-warning-ink">{DICA_VERIFICAR}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                O envio saiu, mas o tribunal não respondeu. A petição pode ter entrado. Abra o portal do tribunal e veja nos autos antes de qualquer
                reenvio: reenviar sem conferir pode duplicar a petição.
              </p>
              {pode("trib_protocolos.protocolar") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setRegistrar(true)}>
                    <CheckCircle2 /> Entrou (tenho o recibo)
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setNaoEntrou(true)}>
                    Não entrou
                  </Button>
                  {p.sistema_portal && (
                    <a href={p.sistema_portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 text-sm text-info-ink hover:underline">
                      Abrir portal do {p.tribunal} <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {p.status === "erro" && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/8 p-4 sm:flex-row sm:items-center">
          <AlertTriangle className="size-5 shrink-0 text-danger-ink" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-danger-ink">A petição não foi protocolada</p>
            <p className="text-muted-foreground">{p.ultimo_erro ?? "Veja o retorno do tribunal."} Corrija, aprove de novo se preciso, e reenvie.</p>
          </div>
          {podeRegistrar && (
            <Button size="sm" variant="outline" onClick={() => setRegistrar(true)}>
              Registrar retorno do portal
            </Button>
          )}
        </div>
      )}
      {EM_ANDAMENTO.includes(p.status) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/8 p-4 text-sm">
          <Loader2 className="size-5 shrink-0 animate-spin text-info-ink" />
          <div>
            <p className="font-semibold">{p.status === "na_fila" ? "Na fila do protocolo" : "Enviando ao tribunal…"}</p>
            <p className="text-muted-foreground">Esta tela se atualiza sozinha. Não precisa ficar aqui: o aviso chega por e-mail.</p>
          </div>
        </div>
      )}
      {p.status === "protocolado" && p.retornos.some((r) => r.sucesso) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-success/40 bg-success/8 p-4 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-success-ink" />
          {(() => {
            const r = [...p.retornos].reverse().find((x) => x.sucesso)!;
            return (
              <p>
                <span className="font-semibold">Protocolado</span> sob o nº <Mono>{r.numero_protocolo ?? "—"}</Mono> em <Mono>{dataHora(r.data_hora_protocolo)}</Mono>
                {r.numero_cnj_gerado_formatado && (
                  <>
                    {" "}
                    · processo <Mono>{r.numero_cnj_gerado_formatado}</Mono>
                  </>
                )}
              </p>
            );
          })()}
        </div>
      )}
      {invalidada && !p.aprovacao && EDITAVEIS.includes(p.status) && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 p-3.5 text-sm">
          <AlertTriangle className="size-5 shrink-0 text-warning-ink" />
          <p className="flex-1">
            <span className="font-semibold">A aprovação deixou de valer.</span> O conteúdo mudou depois que {p.advogado_nome} aprovou; ele precisa aprovar de
            novo antes do envio.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setInvalidada(false)}>
            Entendi
          </Button>
        </div>
      )}

      {EDITAVEIS.includes(p.status) && (
        <div
          className={
            p.modo_efetivo === "real"
              ? "mb-4 flex items-center gap-2 rounded-xl border border-success/40 bg-success/8 px-3.5 py-2.5 text-sm text-success-ink"
              : "mb-4 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm text-warning-ink"
          }
        >
          <Stamp className="size-4 shrink-0" />
          {p.modo_efetivo === "real"
            ? "Modo real: ao protocolar, a petição vai de verdade ao tribunal."
            : p.modo === "real"
              ? "Modo simulado neste servidor (fora da produção): nada vai ao tribunal."
              : "Modo simulado: o envio é ensaiado e nada vai ao tribunal."}
        </div>
      )}

      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            {inicial && (
              <TabsTrigger value="partes">
                Partes <span className="text-xs text-muted-foreground tabular-nums">{form.partes.length}</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="peca">Conteúdo da peça</TabsTrigger>
            <TabsTrigger value="documentos">
              Documentos <span className="text-xs text-muted-foreground tabular-nums">{p.documentos.length}</span>
            </TabsTrigger>
            <TabsTrigger value="custas">
              Custas{p.custas.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{p.custas.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="envio">
              Aprovar e enviar
              {erros > 0 && <span className="rounded bg-danger/15 px-1 text-[11px] font-semibold text-danger-ink tabular-nums">{erros}</span>}
              {p.aprovacao && <CheckCircle2 className="text-success-ink" />}
            </TabsTrigger>
            <TabsTrigger value="retorno">
              Retorno{p.retornos.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{p.retornos.length}</span>}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dados" className="pt-4">
          <fieldset disabled={!editavel} className="card-surface min-w-0 p-5">
            <FormSection titulo="Assinatura" descricao="Só o advogado que assina pode aprovar o envio.">
              <Field label="Advogado que assina">
                <NativeSelect value={form.advogado_id} onChange={(e) => set({ advogado_id: Number(e.target.value) })}>
                  {!advogados.some((a) => a.id === form.advogado_id) && <option value={form.advogado_id}>{p.advogado_nome}</option>}
                  {advogados.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nome} · OAB {a.oabs.map((o) => `${o.numero}/${o.uf}`).join(", ")}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {inicial && (
                <Field label="Grau">
                  <NativeSelect value={form.grau} onChange={(e) => set({ grau: e.target.value as Grau })}>
                    {Object.entries(ROTULO_GRAU).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </FormSection>
            <div className="border-t pt-5">
              {inicial ? <DadosInicial p={p} form={form} set={set} /> : <DadosIntermediaria p={p} form={form} set={set} />}
            </div>
          </fieldset>
        </TabsContent>

        {inicial && (
          <TabsContent value="partes" className="pt-4">
            <fieldset disabled={!editavel} className="min-w-0">
              <PartesEditor
                partes={form.partes}
                onChange={(partes) => set({ partes })}
                advogadoPadrao={advogadoPadrao}
                semReu={form.cabecalho.sem_reu}
              />
            </fieldset>
          </TabsContent>
        )}

        <TabsContent value="peca" className="pt-4">
          <fieldset disabled={!editavel} className="card-surface min-w-0 p-5">
            <ConteudoPecaEditor protocoloId={p.id} form={form} set={set} acoes={acoesPeca} />
          </fieldset>
        </TabsContent>

        <TabsContent value="documentos" className="pt-4">
          <DocumentosProtocolo p={p} editavel={editavel} onAtualizado={aplicar} acoes={<div className="flex gap-2">{acoesPeca}</div>} />
        </TabsContent>

        <TabsContent value="custas" className="pt-4">
          <CustasProtocolo p={p} onAtualizado={aplicar} />
        </TabsContent>

        <TabsContent value="envio" className="pt-4">
          <EnvioProtocolo p={p} sujo={sujo} onAtualizado={aplicar} onSalvar={() => salvar()} />
        </TabsContent>

        <TabsContent value="retorno" className="space-y-4 pt-4">
          {podeRegistrar && (
            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="font-medium">Protocolou pelo portal do tribunal?</p>
                <p className="text-muted-foreground">
                  {p.status === "verificar"
                    ? "Confira no portal se a petição entrou e registre o resultado."
                    : "Registre aqui o número e o recibo para o histórico ficar completo."}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setRegistrar(true)}>
                  {p.status === "verificar" ? "Entrou (tenho o recibo)" : "Registrar retorno do portal"}
                </Button>
                {p.status === "verificar" && (
                  <Button size="sm" variant="outline" onClick={() => setNaoEntrou(true)}>
                    Não entrou
                  </Button>
                )}
              </div>
            </div>
          )}
          <RetornosProtocolo p={p} />
        </TabsContent>
      </Tabs>

      {/* barra de salvar */}
      {editavel && sujo && (
        <div className="sticky bottom-3 z-30 mt-4 rounded-xl border bg-background/95 shadow-lg backdrop-blur">
          <div className="flex flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              Alterações não salvas{p.aprovacao ? ". Salvar muda o conteúdo aprovado: será preciso aprovar de novo." : "."}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (sync) setForm(JSON.parse(sync) as ProtocoloIn);
                }}
              >
                Descartar
              </Button>
              <Button onClick={() => salvar()} disabled={salvarMut.isPending}>
                {salvarMut.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={excluir}
        onOpenChange={setExcluir}
        titulo="Excluir este protocolo?"
        descricao="O rascunho, os documentos anexados e as guias saem do sistema. Isso não pode ser desfeito."
        confirmar="Excluir"
        destrutivo
        carregando={excluirMut.isPending}
        onConfirm={() => excluirMut.mutate()}
      />
      <RegistrarRetornoDialog p={p} open={registrar} onOpenChange={setRegistrar} onAtualizado={aplicar} />
      <NaoEntrouDialog p={p} open={naoEntrou} onOpenChange={setNaoEntrou} onAtualizado={aplicar} />
    </div>
  );
}
