"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, BadgeCheck, ChevronDown, ChevronRight, ClipboardList, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { SearchInput } from "@/components/mayacorp/data-table";
import { Field, FormSection, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { relativo } from "@/lib/format";
import { chaveProtocolos, type Grau, ROTULO_GRAU, type SistemaIn, type SistemaOut, type TribunalOut, useTribunais } from "@/lib/tribunais-protocolo";

const RAMOS: Record<string, string> = {
  superior: "Tribunais superiores",
  estadual: "Justiça estadual",
  federal: "Justiça federal",
  trabalho: "Justiça do trabalho",
  eleitoral: "Justiça eleitoral",
  militar: "Justiça militar",
};

const SAUDE: Record<SistemaOut["status_saude"], [string, "success" | "warning" | "danger" | "info"]> = {
  ok: ["No ar", "success"],
  lento: ["Lento", "warning"],
  fora: ["Fora do ar", "danger"],
  mudou_layout: ["Layout mudou", "danger"],
};

const PENDENCIAS = [
  "Endpoint MNI e versão (consulta e peticionamento)",
  "Exige credenciamento prévio do advogado?",
  "Inicial aceita via MNI ou só pelo portal?",
  "Limites de arquivo (por arquivo e total)",
  "Formato de assinatura aceito",
  "Tipo de guia de custas e forma de vinculação",
  "Campos extras obrigatórios no cadastro de partes (sexo, filiação, IBGE…)",
];

const novoSistema = (): SistemaIn => ({
  grau: "1g",
  sistema: "pje",
  versao_sistema: null,
  url_portal: null,
  url_consulta_publica: null,
  url_mni: null,
  versao_mni: "2.2.2",
  mni_consulta: false,
  mni_peticionamento: false,
  mni_inicial: false,
  exige_credenciamento: true,
  autenticacao: ["certificado"],
  tamanho_max_arquivo_mb: 10,
  tamanho_max_total_mb: null,
  formatos_aceitos: ["application/pdf"],
  exige_pdf_pesquisavel: false,
  formato_assinatura: "PAdES",
  adaptador: "MniAdapter",
  config_extra: {},
  data_inicio: null,
  data_fim: null,
  status_saude: "ok",
  validado: false,
  intervalo_min_s: 5,
  janela_inicio: null,
  janela_fim: null,
  ativo: true,
});

function paraIn(s: SistemaOut): SistemaIn {
  const { id: _i, tribunal_id: _t, ultima_verificacao: _u, ...resto } = s;
  void _i;
  void _t;
  void _u;
  return { ...resto, data_inicio: resto.data_inicio?.slice(0, 10) ?? null, data_fim: resto.data_fim?.slice(0, 10) ?? null };
}

function SistemaDialog({
  alvo,
  onOpenChange,
}: {
  alvo: { tribunal: TribunalOut; sistema: SistemaOut | null } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<SistemaIn>(() => (alvo?.sistema ? paraIn(alvo.sistema) : novoSistema()));
  const [extra, setExtra] = useState(() => JSON.stringify(f.config_extra ?? {}, null, 2));
  const set = (x: Partial<SistemaIn>) => setF((v) => ({ ...v, ...x }));
  const n = (v: string) => v.trim() || null;
  const salvar = useMutation({
    mutationFn: () => {
      let config_extra: Record<string, unknown> = {};
      try {
        config_extra = extra.trim() ? (JSON.parse(extra) as Record<string, unknown>) : {};
      } catch {
        throw new Error("Configuração extra não é um JSON válido.");
      }
      const corpo = { ...f, config_extra };
      return alvo?.sistema
        ? api.put<SistemaOut>(`/tribunais/sistemas/${alvo.sistema.id}`, corpo)
        : api.post<SistemaOut>(`/tribunais/tribunais/${alvo!.tribunal.id}/sistemas`, corpo);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "tribunais"] });
      toast.success("Sistema salvo");
      onOpenChange(false);
    },
  });
  const autent = (k: SistemaIn["autenticacao"][number], v: boolean) =>
    set({ autenticacao: v ? [...new Set([...f.autenticacao, k])] : f.autenticacao.filter((x) => x !== k) });

  return (
    <FormDialog
      open={!!alvo}
      onOpenChange={onOpenChange}
      titulo={`${alvo?.sistema ? "Editar" : "Novo"} sistema · ${alvo?.tribunal.sigla ?? ""}`}
      largura="xl"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="divide-y">
        <FormSection titulo="Identificação">
          <Field label="Grau">
            <NativeSelect value={f.grau} onChange={(e) => set({ grau: e.target.value as Grau })}>
              {Object.entries(ROTULO_GRAU).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Sistema">
            <NativeSelect value={f.sistema} onChange={(e) => set({ sistema: e.target.value as SistemaIn["sistema"] })}>
              <option value="pje">PJe</option>
              <option value="eproc">eproc</option>
              <option value="esaj">e-SAJ</option>
              <option value="projudi">Projudi</option>
              <option value="proprio">Próprio</option>
            </NativeSelect>
          </Field>
          <Field label="Versão do sistema">
            <Input value={f.versao_sistema ?? ""} onChange={(e) => set({ versao_sistema: n(e.target.value) })} />
          </Field>
          <Field label="Adaptador">
            <NativeSelect value={f.adaptador} onChange={(e) => set({ adaptador: e.target.value as SistemaIn["adaptador"] })}>
              {["MniAdapter", "PjeAdapter", "EprocAdapter", "EsajAdapter", "ProjudiAdapter", "PortalAdapter"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Em uso desde">
            <Input type="date" value={f.data_inicio ?? ""} onChange={(e) => set({ data_inicio: e.target.value || null })} />
          </Field>
          <Field label="Em uso até" dica="Preencha quando o tribunal migrar de sistema.">
            <Input type="date" value={f.data_fim ?? ""} onChange={(e) => set({ data_fim: e.target.value || null })} />
          </Field>
        </FormSection>
        <FormSection titulo="Endereços">
          <Field label="Portal" className="sm:col-span-2">
            <Input value={f.url_portal ?? ""} onChange={(e) => set({ url_portal: n(e.target.value) })} className="font-mono text-xs" />
          </Field>
          <Field label="Consulta pública" className="sm:col-span-2">
            <Input value={f.url_consulta_publica ?? ""} onChange={(e) => set({ url_consulta_publica: n(e.target.value) })} className="font-mono text-xs" />
          </Field>
          <Field label="Serviço MNI" className="sm:col-span-2" dica="Obrigatório para homologar o protocolo automático.">
            <Input value={f.url_mni ?? ""} onChange={(e) => set({ url_mni: n(e.target.value) })} className="font-mono text-xs" />
          </Field>
          <Field label="Versão do MNI">
            <Input value={f.versao_mni ?? ""} onChange={(e) => set({ versao_mni: n(e.target.value) })} className="font-mono" />
          </Field>
        </FormSection>
        <FormSection titulo="O que o MNI aceita">
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
            <SwitchRow titulo="Consulta">
              <Switch checked={f.mni_consulta} onCheckedChange={(v) => set({ mni_consulta: v })} />
            </SwitchRow>
            <SwitchRow titulo="Petição intermediária">
              <Switch checked={f.mni_peticionamento} onCheckedChange={(v) => set({ mni_peticionamento: v })} />
            </SwitchRow>
            <SwitchRow titulo="Petição inicial">
              <Switch checked={f.mni_inicial} onCheckedChange={(v) => set({ mni_inicial: v })} />
            </SwitchRow>
          </div>
        </FormSection>
        <FormSection titulo="Acesso e assinatura">
          <div className="space-y-2 sm:col-span-2">
            <SwitchRow titulo="Exige credenciamento prévio do advogado">
              <Switch checked={f.exige_credenciamento} onCheckedChange={(v) => set({ exige_credenciamento: v })} />
            </SwitchRow>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">Autenticação:</span>
              {(
                [
                  ["certificado", "Certificado"],
                  ["usuario_senha", "Usuário e senha"],
                  ["2fa", "2 fatores"],
                ] as const
              ).map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-2">
                  <Checkbox checked={f.autenticacao.includes(k)} onCheckedChange={(v) => autent(k, !!v)} /> {l}
                </label>
              ))}
            </div>
          </div>
          <Field label="Formato de assinatura">
            <NativeSelect value={f.formato_assinatura} onChange={(e) => set({ formato_assinatura: e.target.value as SistemaIn["formato_assinatura"] })}>
              <option value="PAdES">PAdES (no PDF)</option>
              <option value="CAdES">CAdES (destacada)</option>
              <option value="assinatura_no_portal">Assinatura no portal</option>
            </NativeSelect>
          </Field>
        </FormSection>
        <FormSection titulo="Arquivos">
          <Field label="Máximo por arquivo (MB)">
            <Input type="number" min={1} max={500} value={f.tamanho_max_arquivo_mb} onChange={(e) => set({ tamanho_max_arquivo_mb: Number(e.target.value) || 1 })} />
          </Field>
          <Field label="Máximo no total (MB)">
            <Input
              type="number"
              min={1}
              value={f.tamanho_max_total_mb ?? ""}
              onChange={(e) => set({ tamanho_max_total_mb: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
          <Field label="Formatos aceitos" className="sm:col-span-2" dica="Tipos MIME separados por vírgula.">
            <Input
              value={f.formatos_aceitos.join(", ")}
              onChange={(e) => set({ formatos_aceitos: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              className="font-mono text-xs"
            />
          </Field>
          <div className="sm:col-span-2">
            <SwitchRow titulo="Exige PDF pesquisável (com texto)">
              <Switch checked={f.exige_pdf_pesquisavel} onCheckedChange={(v) => set({ exige_pdf_pesquisavel: v })} />
            </SwitchRow>
          </div>
        </FormSection>
        <FormSection titulo="Ritmo e saúde" descricao="Para não sobrecarregar o tribunal.">
          <Field label="Intervalo mínimo entre envios (s)">
            <Input type="number" min={0} max={3600} value={f.intervalo_min_s} onChange={(e) => set({ intervalo_min_s: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Situação">
            <NativeSelect value={f.status_saude} onChange={(e) => set({ status_saude: e.target.value as SistemaIn["status_saude"] })}>
              {Object.entries(SAUDE).map(([k, [l]]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Janela: das">
            <Input type="time" value={f.janela_inicio ?? ""} onChange={(e) => set({ janela_inicio: e.target.value || null })} />
          </Field>
          <Field label="até">
            <Input type="time" value={f.janela_fim ?? ""} onChange={(e) => set({ janela_fim: e.target.value || null })} />
          </Field>
        </FormSection>
        <FormSection titulo="Configuração extra" descricao="JSON livre para o adaptador.">
          <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows={4} className="font-mono text-xs sm:col-span-2" />
        </FormSection>
        <FormSection titulo="Liberação">
          <div className="space-y-2 sm:col-span-2">
            <SwitchRow titulo="Homologado pela MayaCorp" descricao="Libera o protocolo automático neste sistema. Exige o endereço do MNI (ou assinatura no portal).">
              <Switch checked={f.validado} onCheckedChange={(v) => set({ validado: v })} />
            </SwitchRow>
            <SwitchRow titulo="Ativo">
              <Switch checked={f.ativo} onCheckedChange={(v) => set({ ativo: v })} />
            </SwitchRow>
          </div>
        </FormSection>
      </div>
    </FormDialog>
  );
}

export function SistemasTribunais() {
  const qc = useQueryClient();
  const q = useTribunais();
  const [busca, setBusca] = useState("");
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [editar, setEditar] = useState<{ tribunal: TribunalOut; sistema: SistemaOut | null } | null>(null);
  const [excluir, setExcluir] = useState<SistemaOut | null>(null);
  const saude = useMutation({
    mutationFn: (sid: number) => api.post<SistemaOut>(`/tribunais/sistemas/${sid}/saude`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "tribunais"] });
      toast.success(`Saúde verificada: ${SAUDE[r.status_saude]?.[0] ?? r.status_saude}`);
    },
  });
  const excluirMut = useMutation({
    mutationFn: (sid: number) => api.del<{ ok: boolean; desativado: boolean }>(`/tribunais/sistemas/${sid}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "tribunais"] });
      setExcluir(null);
      toast.success(r.desativado ? "O sistema tem histórico: foi só desativado" : "Sistema excluído");
    },
  });

  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const g: Record<string, TribunalOut[]> = {};
    for (const x of q.data ?? []) {
      if (t && !x.sigla.toLowerCase().includes(t) && !x.nome.toLowerCase().includes(t)) continue;
      (g[x.ramo] ??= []).push(x);
    }
    return g;
  }, [q.data, busca]);

  const alternar = (id: number) =>
    setAbertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="card-surface overflow-hidden">
        <div className="border-b p-3">
          <SearchInput value={busca} onChange={setBusca} placeholder="Sigla ou nome do tribunal" />
        </div>
        {q.isPending ? (
          <Skeleton className="m-4 h-64" />
        ) : (
          Object.entries(grupos).map(([ramo, lista]) => (
            <div key={ramo}>
              <p className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{RAMOS[ramo] ?? ramo}</p>
              <ul className="divide-y">
                {lista.map((t) => {
                  const aberto = abertos.has(t.id) || !!busca.trim();
                  const homolog = t.sistemas.filter((s) => s.validado && s.ativo).length;
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => alternar(t.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40">
                        {aberto ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                        <span className="w-16 shrink-0 font-semibold">{t.sigla}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t.nome}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.sistemas.length} sistema(s){homolog > 0 && <span className="ml-1 text-success-ink">· {homolog} homologado(s)</span>}
                        </span>
                      </button>
                      {aberto && (
                        <div className="space-y-2 bg-muted/20 px-4 pt-1 pb-3 pl-11">
                          {t.sistemas.map((s) => {
                            const [sl, st] = SAUDE[s.status_saude] ?? [s.status_saude, "info"];
                            return (
                              <div key={s.id} className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
                                <div className="min-w-0 flex-1">
                                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                    {s.sistema.toUpperCase()} · {ROTULO_GRAU[s.grau]}
                                    {s.validado ? (
                                      <Pill tom="success" className="normal-case">
                                        <BadgeCheck className="size-3" /> homologado
                                      </Pill>
                                    ) : (
                                      <Pill tom="neutral" className="normal-case">
                                        não homologado
                                      </Pill>
                                    )}
                                    {!s.ativo && (
                                      <Pill tom="danger" className="normal-case">
                                        inativo
                                      </Pill>
                                    )}
                                    <StatusBadge label={sl} tom={st} className="h-5" />
                                  </p>
                                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                    MNI: {s.url_mni ? [s.mni_consulta && "consulta", s.mni_peticionamento && "intermediária", s.mni_inicial && "inicial"].filter(Boolean).join(", ") || "sem serviços" : "sem endereço"}
                                    {" · "}
                                    {s.formato_assinatura} · até {s.tamanho_max_arquivo_mb} MB
                                    {s.ultima_verificacao && ` · verificado ${relativo(s.ultima_verificacao)}`}
                                  </p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => saude.mutate(s.id)} disabled={saude.isPending && saude.variables === s.id}>
                                    {saude.isPending && saude.variables === s.id ? <Loader2 className="animate-spin" /> : <Activity />} Checar saúde
                                  </Button>
                                  <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditar({ tribunal: t, sistema: s })}>
                                    <Pencil />
                                  </Button>
                                  <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(s)}>
                                    <Trash2 />
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                          <Button size="sm" variant="outline" onClick={() => setEditar({ tribunal: t, sistema: null })}>
                            <Plus /> Sistema
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>
      <aside className="h-fit rounded-2xl border bg-card p-5 text-sm">
        <h4 className="mb-2 flex items-center gap-2 font-semibold">
          <ClipboardList className="size-4 text-info-ink" /> Pendências para validar por tribunal
        </h4>
        <p className="mb-3 text-xs text-muted-foreground">Antes de marcar um sistema como homologado, confirme com o tribunal:</p>
        <ul className="space-y-2">
          {PENDENCIAS.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
              {p}
            </li>
          ))}
        </ul>
      </aside>
      {editar && <SistemaDialog key={`${editar.tribunal.id}-${editar.sistema?.id ?? "novo"}`} alvo={editar} onOpenChange={(o) => !o && setEditar(null)} />}
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo="Excluir o sistema?"
        descricao="Se houver processos ou protocolos nele, o sistema é só desativado (o histórico fica)."
        confirmar="Excluir"
        destrutivo
        carregando={excluirMut.isPending}
        onConfirm={() => excluir && excluirMut.mutate(excluir.id)}
      />
    </div>
  );
}
