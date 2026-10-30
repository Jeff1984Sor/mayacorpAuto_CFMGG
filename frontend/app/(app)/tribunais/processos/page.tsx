"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Briefcase, Eraser, FileDown, Lock, Scale, ScanSearch } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { type ClienteEscolhido, ClientesMulti } from "@/components/faturamento/clientes-multi";
import { useProfissionais } from "@/components/faturamento/dialogos";
import { linhaClicavel, Pagination, SearchInput, TableCard, TableSkeleton } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { SemAcesso } from "@/components/mayacorp/sem-acesso";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { data, relativo } from "@/lib/format";
import {
  CHAVE,
  cnjCompleto,
  mascaraCnj,
  oabTexto,
  POR_PAGINA_PROCESSOS,
  type ProcessoDetalhe,
  rotuloGrau,
  rotuloSistema,
  SITUACAO,
  type Situacao,
  useCandidatos,
  useEuTribunais,
  useProcessos,
  useTribunaisCatalogo,
} from "@/lib/tribunais";
import { cn } from "@/lib/utils";

// ================================================================ importar pelo número
function ImportarDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { usuario, pode } = useAuth();
  const listar = pode("trib_processos.ver");
  const candidatos = useCandidatos(open && listar);
  // sem acesso à lista (403): só a própria OAB
  const gerir = listar && !candidatos.isError;
  const eu = useEuTribunais(open && !gerir);
  const [numero, setNumero] = useState("");
  const [adv, setAdv] = useState("");
  const pessoas = gerir ? (candidatos.data ?? []) : eu.data ? [{ id: eu.data.usuario_id, nome: eu.data.nome, oabs: eu.data.oabs }] : [];
  const importar = useMutation({
    mutationFn: () =>
      api.post<ProcessoDetalhe>("/tribunais/processos/importar", {
        numero_cnj: numero.replace(/\D/g, ""),
        advogado_id: adv ? Number(adv) : (usuario?.id ?? null),
      }),
    onSuccess: (p) => {
      toast.success(`Processo ${p.numero_formatado} importado`, { description: p.caso_id ? `Ligado ao caso #${p.caso_numero}.` : undefined });
      qc.invalidateQueries({ queryKey: [CHAVE] });
      onOpenChange(false);
      setNumero("");
      router.push(`/tribunais/processos/${p.id}`);
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Importar pelo número"
      rotuloSalvar="Importar"
      salvando={importar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        if (!cnjCompleto(numero)) return toast.error("O número do processo tem 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO).");
        importar.mutate();
      }}
    >
      <div className="grid gap-4">
        <Field label="Número do processo (CNJ)" obrigatorio htmlFor="imp-cnj" dica="Busca a capa e as movimentações no DataJud; com certificado, também as partes e os documentos.">
          <Input
            id="imp-cnj"
            value={numero}
            onChange={(e) => setNumero(mascaraCnj(e.target.value))}
            placeholder="0000000-00.0000.0.00.0000"
            inputMode="numeric"
            className="font-mono"
            autoFocus
          />
        </Field>
        <Field label="Advogado responsável" htmlFor="imp-adv" dica="As OABs dele identificam a parte representada pelo escritório.">
          <NativeSelect id="imp-adv" value={adv || String(usuario?.id ?? "")} onChange={(e) => setAdv(e.target.value)} disabled={!gerir}>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.oabs.length ? ` · ${p.oabs.map(oabTexto).join(", ")}` : " (sem OAB)"}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </FormDialog>
  );
}

// ================================================================ lista
function ProcessosTela() {
  const { pode } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [busca, setBusca] = useState(sp.get("q") ?? "");
  const q = useDebounce(busca, 300);
  const [tribunal, setTribunal] = useState(sp.get("tribunal") ?? "");
  const [situacao, setSituacao] = useState(sp.get("situacao") ?? "");
  const [cliente, setCliente] = useState<ClienteEscolhido[]>([]);
  const [resp, setResp] = useState("");
  const [comIntimacao, setComIntimacao] = useState(sp.get("com_intimacao") === "1");
  const [semCaso, setSemCaso] = useState(sp.get("sem_caso") === "1");
  const [pagina, setPagina] = useState(1);
  const [importar, setImportar] = useState(false);
  const cat = useTribunaisCatalogo();
  const profs = useProfissionais();

  const lista = useProcessos({
    q,
    tribunal,
    situacao,
    cliente_id: cliente[0]?.id,
    responsavel_id: resp ? Number(resp) : undefined,
    com_intimacao: comIntimacao,
    sem_caso: semCaso,
    pagina,
  });
  const itens = lista.data?.itens ?? [];
  const filtrando = !!(q || tribunal || situacao || cliente.length || resp || comIntimacao || semCaso);
  const mudar = (fn: () => void) => {
    fn();
    setPagina(1);
  };

  if (!pode("trib_processos.ver")) return <SemAcesso />;

  return (
    <div>
      <PageHeader
        titulo="Processos"
        icone={Scale}
        migalhas={[{ label: "Tribunais", href: "/tribunais" }, { label: "Processos" }]}
        acoes={
          pode("trib_processos.importar") && (
            <>
              <Button variant="outline" render={<Link href="/tribunais/varredura" />}>
                <ScanSearch /> Buscar pela OAB
              </Button>
              <Button onClick={() => setImportar(true)}>
                <FileDown /> Importar pelo número
              </Button>
            </>
          )
        }
      />

      <TableCard>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={busca} onChange={(v) => mudar(() => setBusca(v))} placeholder="Número, parte, classe ou vara" className="sm:w-72" />
          <NativeSelect aria-label="Tribunal" value={tribunal} onChange={(e) => mudar(() => setTribunal(e.target.value))} className="h-9 w-40">
            <option value="">Todos os tribunais</option>
            {cat.data?.map((t) => (
              <option key={t.id} value={t.sigla}>
                {t.sigla}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="Situação" value={situacao} onChange={(e) => mudar(() => setSituacao(e.target.value))} className="h-9 w-36">
            <option value="">Todas as situações</option>
            {(Object.keys(SITUACAO) as Situacao[]).map((s) => (
              <option key={s} value={s}>
                {SITUACAO[s].l}
              </option>
            ))}
          </NativeSelect>
          <div className={cn("w-52", !pode("clientes.ver") && "hidden")}>
            <ClientesMulti unico id="proc-cliente" valor={cliente} onChange={(v) => mudar(() => setCliente(v))} />
          </div>
          <NativeSelect aria-label="Responsável" value={resp} onChange={(e) => mudar(() => setResp(e.target.value))} className="h-9 w-44">
            <option value="">Todos os responsáveis</option>
            {profs.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </NativeSelect>
          <label className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm">
            <Checkbox checked={comIntimacao} onCheckedChange={(v) => mudar(() => setComIntimacao(!!v))} aria-label="Com intimação não lida" /> Com intimação não lida
          </label>
          <label className="flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm">
            <Checkbox checked={semCaso} onCheckedChange={(v) => mudar(() => setSemCaso(!!v))} aria-label="Sem caso" /> Sem caso
          </label>
          {filtrando && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setBusca("");
                setTribunal("");
                setSituacao("");
                setCliente([]);
                setResp("");
                setComIntimacao(false);
                setSemCaso(false);
                setPagina(1);
                router.replace(pathname, { scroll: false });
              }}
            >
              <Eraser /> Limpar filtros
            </Button>
          )}
        </div>

        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : itens.length === 0 ? (
          <EmptyState
            icone={Scale}
            titulo={filtrando ? "Nenhum processo com esses filtros" : "Nenhum processo ainda"}
            descricao={filtrando ? "Troque ou limpe os filtros." : "Busque pela OAB do advogado ou importe um processo pelo número."}
            acao={
              !filtrando &&
              pode("trib_processos.importar") && (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button render={<Link href="/tribunais/varredura" />}>
                    <ScanSearch /> Buscar pela OAB
                  </Button>
                  <Button variant="outline" onClick={() => setImportar(true)}>
                    <FileDown /> Importar pelo número
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Processo</th>
                  <th className="px-3 py-2.5 font-medium">Partes</th>
                  <th className="px-3 py-2.5 font-medium">Classe e órgão</th>
                  <th className="px-3 py-2.5 font-medium">Cliente e caso</th>
                  <th className="px-3 py-2.5 font-medium">Responsável</th>
                  <th className="px-3 py-2.5 font-medium">Última movimentação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((p) => {
                  const sit = SITUACAO[p.situacao] ?? { l: p.situacao, tom: "neutral" as const };
                  return (
                    <tr key={p.id} className={cn(linhaClicavel, "align-top")} onClick={() => router.push(`/tribunais/processos/${p.id}`)}>
                      <td className="px-4 py-3">
                        <p className="flex items-center gap-1.5">
                          <Link
                            href={`/tribunais/processos/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                          >
                            {p.numero_formatado}
                          </Link>
                          {p.nivel_sigilo > 0 && <Lock className="size-3.5 text-warning-ink" aria-label="Processo sigiloso" />}
                          {p.movimentacoes_nao_lidas > 0 && (
                            <span
                              className="inline-flex h-5 items-center gap-0.5 rounded-full bg-danger/10 px-1.5 text-[11px] font-semibold text-danger-ink"
                              title={`${p.movimentacoes_nao_lidas} movimentação(ões) não lida(s)`}
                            >
                              <Bell className="size-3" />
                              {p.movimentacoes_nao_lidas}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1">
                          <Pill tom="brand">{p.tribunal}</Pill>
                          <span className="text-[11px] text-muted-foreground">{[rotuloSistema(p.sistema), rotuloGrau(p.grau)].filter(Boolean).join(" · ")}</span>
                          {p.situacao !== "ativo" && <StatusBadge tom={sit.tom} label={sit.l} />}
                          {!p.monitorar && <Pill tom="neutral">não monitorado</Pill>}
                        </p>
                      </td>
                      <td className="max-w-64 px-3 py-3">
                        <span className="line-clamp-2">{p.partes_resumo ?? "—"}</span>
                      </td>
                      <td className="max-w-64 px-3 py-3">
                        <p className="line-clamp-1">{p.classe_nome ?? "—"}</p>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{p.orgao_julgador}</p>
                      </td>
                      <td className="max-w-56 px-3 py-3">
                        {p.clientes.length === 0 ? (
                          <span className="text-xs text-muted-foreground">sem cliente</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {p.clientes.map((c) => (
                              <span
                                key={`${c.id}-${c.status}`}
                                className={cn(
                                  "max-w-full truncate rounded-full px-2 py-0.5 text-xs",
                                  c.status === "sugerido" ? "bg-warning/12 text-warning-ink" : "bg-success/10 text-success-ink",
                                )}
                                title={c.status === "sugerido" ? "Vínculo sugerido: confirme na ficha" : undefined}
                              >
                                {c.nome}
                                {c.status === "sugerido" && " ?"}
                              </span>
                            ))}
                          </div>
                        )}
                        {p.caso_id ? (
                          <Link
                            href={`/faturamento/casos/${p.caso_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-info-ink underline-offset-4 hover:underline"
                          >
                            <Briefcase className="size-3" /> Caso #{p.caso_numero}
                          </Link>
                        ) : (
                          <p className="mt-1 text-[11px] text-warning-ink">sem caso</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">{p.responsavel_nome ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-mono text-xs">{data(p.ultima_movimentacao_em)}</span>
                        <p className={cn("text-[11px]", p.sincronizacao_erro ? "text-danger-ink" : "text-muted-foreground")} title={p.sincronizacao_erro ?? undefined}>
                          {p.sincronizacao_erro ? "erro ao sincronizar" : `sincronizado ${relativo(p.ultima_sincronizacao)}`}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagina={pagina} porPagina={POR_PAGINA_PROCESSOS} total={lista.data?.total ?? 0} onChange={setPagina} />
      </TableCard>
      <ImportarDialog open={importar} onOpenChange={setImportar} />
    </div>
  );
}

export default function ProcessosPage() {
  return (
    <Suspense fallback={null}>
      <ProcessosTela />
    </Suspense>
  );
}
