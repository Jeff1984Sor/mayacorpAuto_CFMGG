"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Loader2, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Field, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";

interface ChaveIA {
  provedor: "openai" | "gemini";
  nome: string;
  definida: boolean;
  atualizado_em: string | null;
}

interface IACliente {
  ativo: boolean;
  provedor: string | null;
  modelo: string | null;
  tem_chave: boolean;
  /** a base usa a chave da MayaCorp (trocar a chave aqui atualiza a base) */
  chave_mayacorp: boolean;
}

const chaveChaves = ["admin", "ia", "chaves"];

/** Planos e indicação › Chaves de IA da MayaCorp (OpenAI e Gemini), usadas para liberar a IA dos escritórios. */
export function ChavesIA() {
  const q = useQuery({ queryKey: chaveChaves, queryFn: () => api.get<ChaveIA[]>("/admin/ia/chaves") });
  return (
    <div className="card-surface mt-5 space-y-4 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-brand" />
        <p className="font-medium">Chaves de IA da MayaCorp</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Guardadas cifradas. Com elas você libera a IA de cada escritório na ficha do cliente (aba <b>IA</b>). Trocar uma chave aqui
        atualiza todos os escritórios que usam a anterior. O consumo cai na conta da MayaCorp.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {(q.data ?? []).map((c) => (
          <LinhaChave key={c.provedor} c={c} />
        ))}
      </div>
    </div>
  );
}

function LinhaChave({ c }: { c: ChaveIA }) {
  const qc = useQueryClient();
  const [chave, setChave] = useState("");
  const salvar = useMutation({
    mutationFn: () =>
      api.put<{ modelos: string[]; bases_atualizadas: string[] }>(`/admin/ia/chaves/${c.provedor}`, { chave }),
    onSuccess: (r) => {
      toast.success(
        `Chave ${c.nome} testada e salva (${r.modelos.length} modelos disponíveis)` +
          (r.bases_atualizadas.length ? `. Atualizada em: ${r.bases_atualizadas.join(", ")}` : ""),
      );
      setChave("");
      qc.invalidateQueries({ queryKey: ["admin", "ia"] });
    },
  });
  const importar = useMutation({
    mutationFn: () => api.post<{ origem: string }>(`/admin/ia/chaves/${c.provedor}/importar`),
    onSuccess: (r) => {
      toast.success(`Chave ${c.nome} importada da base ${r.origem}`);
      qc.invalidateQueries({ queryKey: ["admin", "ia"] });
    },
  });
  return (
    <form
      className="space-y-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <KeyRound className="size-4 text-muted-foreground" /> {c.nome}
        </p>
        <Pill tom={c.definida ? "success" : "neutral"}>{c.definida ? "chave salva" : "sem chave"}</Pill>
      </div>
      {c.atualizado_em && <p className="text-xs text-muted-foreground">Atualizada em {dataHora(c.atualizado_em)}</p>}
      <div className="flex items-end gap-2">
        <Field label={c.definida ? "Trocar a chave" : "Chave de API"} htmlFor={`ia-${c.provedor}`} className="flex-1">
          <Input
            id={`ia-${c.provedor}`}
            type="password"
            autoComplete="off"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder={c.provedor === "openai" ? "sk-…" : "AIza…"}
            required
            minLength={10}
          />
        </Field>
        <Button type="submit" disabled={salvar.isPending || chave.trim().length < 10}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Testar e salvar
        </Button>
      </div>
      {!c.definida && (
        <Button type="button" variant="ghost" size="sm" disabled={importar.isPending} onClick={() => importar.mutate()}>
          <Download /> Usar a chave que já está ligada em algum escritório
        </Button>
      )}
    </form>
  );
}

/** Ficha do cliente › IA: liga ou desliga a IA do escritório, com provedor e modelo, usando a chave da MayaCorp. */
export function AbaIA({ cid }: { cid: number }) {
  const qc = useQueryClient();
  const chaves = useQuery({ queryKey: chaveChaves, queryFn: () => api.get<ChaveIA[]>("/admin/ia/chaves") });
  const atual = useQuery({ queryKey: ["admin", "ia", "cliente", cid], queryFn: () => api.get<IACliente>(`/admin/clientes/${cid}/ia`) });
  const prontas = (chaves.data ?? []).filter((c) => c.definida);
  const [f, setF] = useState({ ativo: false, provedor: "", modelo: "" });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o que está na base do escritório */
  useEffect(() => {
    if (atual.data)
      setF({
        ativo: atual.data.ativo,
        provedor: atual.data.provedor && prontas.some((p) => p.provedor === atual.data.provedor) ? atual.data.provedor : (prontas[0]?.provedor ?? ""),
        modelo: atual.data.modelo ?? "",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atual.data, chaves.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const modelos = useQuery({
    queryKey: ["admin", "ia", "modelos", f.provedor],
    queryFn: () => api.get<string[]>(`/admin/ia/modelos/${f.provedor}`),
    enabled: !!f.provedor && f.ativo,
  });
  const salvar = useMutation({
    mutationFn: () => api.put<IACliente>(`/admin/clientes/${cid}/ia`, f.ativo ? f : { ativo: false }),
    onSuccess: (r) => {
      toast.success(r.ativo ? `IA liberada (${r.modelo})` : "IA desligada para este escritório");
      qc.invalidateQueries({ queryKey: ["admin", "ia", "cliente", cid] });
    },
  });
  const a = atual.data;
  return (
    <form
      className="card-surface max-w-2xl space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-5 text-brand" />
        <p className="font-medium">Inteligência Artificial do escritório</p>
        {a && (
          <Pill tom={a.ativo ? "success" : "neutral"}>
            {a.ativo ? `ligada · ${a.provedor === "openai" ? "OpenAI" : "Gemini"} ${a.modelo ?? ""}` : "desligada"}
          </Pill>
        )}
        {a?.ativo && !a.chave_mayacorp && <Pill tom="warning">chave própria do escritório</Pill>}
      </div>
      {prontas.length === 0 ? (
        <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning-ink">
          Cadastre primeiro a chave da OpenAI ou do Gemini em <b>MayaCorp › Planos e indicação › Chaves de IA</b>.
        </p>
      ) : (
        <>
          <SwitchRow titulo="Liberar a IA" descricao="Preencher com IA, análises, revisão de fatura e leitura de documentos.">
            <Switch checked={f.ativo} onCheckedChange={(v) => setF({ ...f, ativo: v })} />
          </SwitchRow>
          {f.ativo && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provedor" htmlFor="ia-prov">
                <NativeSelect id="ia-prov" value={f.provedor} onChange={(e) => setF({ ...f, provedor: e.target.value, modelo: "" })}>
                  {prontas.map((p) => (
                    <option key={p.provedor} value={p.provedor}>
                      {p.nome}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Modelo"
                htmlFor="ia-mod"
                dica={f.provedor === "openai" ? "Com a OpenAI, PDF escaneado precisa ir como foto." : undefined}
              >
                <NativeSelect id="ia-mod" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value })} required>
                  <option value="">{modelos.isPending ? "Carregando…" : "Escolha…"}</option>
                  {f.modelo && !(modelos.data ?? []).includes(f.modelo) && <option value={f.modelo}>{f.modelo}</option>}
                  {(modelos.data ?? []).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          <Button type="submit" disabled={salvar.isPending || (f.ativo && !f.modelo)}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
          </Button>
        </>
      )}
    </form>
  );
}
