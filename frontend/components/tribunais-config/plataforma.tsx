"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FileSpreadsheet, Loader2, PlugZap, Save, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { Field, FormSection, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { numero } from "@/lib/format";
import { chaveProtocolos, type Plataforma, type TabelaResumo, useTribunais } from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

function FormPlataforma({ p }: { p: Plataforma }) {
  const qc = useQueryClient();
  const [f, setF] = useState(p);
  const [teste, setTeste] = useState<Record<string, string> | null>(null);
  const set = (x: Partial<Plataforma>) => setF((v) => ({ ...v, ...x }));
  const salvar = useMutation({
    mutationFn: () =>
      api.put<Plataforma>("/tribunais/plataforma", { ...f, datajud_chave: f.datajud_chave || null, djen_proxy_url: f.djen_proxy_url || null }),
    onSuccess: (r) => {
      qc.setQueryData([chaveProtocolos, "plataforma"], r);
      toast.success("Plataforma salva");
    },
  });
  const testar = useMutation({
    mutationFn: () => api.post<Record<string, string>>("/tribunais/plataforma/testar"),
    onSuccess: setTeste,
  });
  const mudouTermo = f.termo_texto !== p.termo_texto && f.termo_versao === p.termo_versao;
  return (
    <div className="card-surface divide-y p-5">
      <FormSection titulo="DataJud (CNJ)" descricao="Consulta pública dos processos (capa e movimentações).">
        <Field label="Endereço" className="sm:col-span-2">
          <Input value={f.datajud_url} onChange={(e) => set({ datajud_url: e.target.value })} className="font-mono text-xs" />
        </Field>
        <Field label="Chave da API" dica="A chave pública do CNJ já vem preenchida.">
          <Input value={f.datajud_chave ?? ""} onChange={(e) => set({ datajud_chave: e.target.value })} className="font-mono text-xs" />
        </Field>
        <Field label="Intervalo entre consultas (ms)">
          <Input type="number" min={200} max={10000} value={f.intervalo_datajud_ms} onChange={(e) => set({ intervalo_datajud_ms: Number(e.target.value) })} className="font-mono" />
        </Field>
      </FormSection>
      <FormSection titulo="DJEN (comunicações)" descricao="Intimações pela OAB. Fora do Brasil, a consulta roda pelo navegador do usuário.">
        <Field label="Endereço" className="sm:col-span-2">
          <Input value={f.djen_url} onChange={(e) => set({ djen_url: e.target.value })} className="font-mono text-xs" />
        </Field>
        <Field label="Proxy no Brasil (opcional)" className="sm:col-span-2">
          <Input value={f.djen_proxy_url ?? ""} onChange={(e) => set({ djen_proxy_url: e.target.value })} className="font-mono text-xs" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="button" variant="outline" onClick={() => testar.mutate()} disabled={testar.isPending}>
            {testar.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} Testar conexões
          </Button>
          {teste && (
            <dl className="mt-3 space-y-1 rounded-xl border p-3 text-sm">
              {Object.entries(teste).map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="w-20 font-medium uppercase">{k}</dt>
                  <dd className={cn(v.startsWith("ok") ? "text-success-ink" : "text-danger-ink")}>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </FormSection>
      <FormSection titulo="Termo LGPD do certificado" descricao="Mudou o texto? Suba a versão: todos terão de aceitar de novo ao reenviar o certificado.">
        <Field label="Versão" erro={mudouTermo ? "O texto mudou: troque a versão." : undefined}>
          <Input value={f.termo_versao} onChange={(e) => set({ termo_versao: e.target.value })} className="font-mono" maxLength={20} />
        </Field>
        <Field label="Texto" className="sm:col-span-2">
          <Textarea value={f.termo_texto} onChange={(e) => set({ termo_texto: e.target.value })} rows={12} className="text-xs" />
        </Field>
      </FormSection>
      <div className="flex justify-end pt-4">
        <Button onClick={() => salvar.mutate()} disabled={salvar.isPending || mudouTermo}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </div>
    </div>
  );
}

export function PlataformaTribunais() {
  const q = useQuery({ queryKey: [chaveProtocolos, "plataforma"], queryFn: () => api.get<Plataforma>("/tribunais/plataforma") });
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  return <FormPlataforma key={JSON.stringify(q.data)} p={q.data} />;
}

const TABELAS: Record<string, string> = {
  classe: "Classes processuais",
  assunto: "Assuntos",
  tipo_documento: "Tipos de documento",
  tipo_peticao: "Tipos de petição",
  localidade: "Localidades (comarcas/foros)",
  orgao_julgador: "Órgãos julgadores",
  competencia: "Competências",
};

export function TabelasLocais() {
  const qc = useQueryClient();
  const resumo = useQuery({ queryKey: [chaveProtocolos, "tabelas-resumo"], queryFn: () => api.get<TabelaResumo[]>("/tribunais/tabelas/resumo") });
  const tribunais = useTribunais();
  const [tabela, setTabela] = useState("classe");
  const [tribunal, setTribunal] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [substituir, setSubstituir] = useState(true);
  const importar = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("tabela", tabela);
      fd.append("arquivo", arquivo!);
      if (tribunal) fd.append("tribunal", tribunal);
      fd.append("substituir", String(substituir));
      return api.post<{ importados: number }>("/tribunais/tabelas/importar", fd);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "tabelas-resumo"] });
      qc.invalidateQueries({ queryKey: [chaveProtocolos, "tabela"] });
      toast.success(`${numero(r.importados)} linhas importadas`);
      setArquivo(null);
    },
  });
  const linhas = [...(resumo.data ?? [])].sort((a, b) => a.tribunal.localeCompare(b.tribunal) || a.tabela.localeCompare(b.tabela));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="card-surface overflow-hidden">
        <div className="border-b p-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Database className="size-4 text-info-ink" /> Tabelas carregadas
          </h3>
          <p className="text-sm text-muted-foreground">Cache local das tabelas do CNJ (TPU) e de cada tribunal, usado nas buscas do protocolo.</p>
        </div>
        {resumo.isPending ? (
          <Skeleton className="m-4 h-32" />
        ) : linhas.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhuma tabela carregada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Origem</th>
                <th className="px-3 py-2.5 font-medium">Tabela</th>
                <th className="px-3 py-2.5 text-right font-medium">Registros</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {linhas.map((l) => (
                <tr key={`${l.tribunal}-${l.tabela}`}>
                  <td className="px-4 py-2.5 font-medium">{l.tribunal}</td>
                  <td className="px-3 py-2.5">{TABELAS[l.tabela] ?? l.tabela}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Mono>{numero(l.registros)}</Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <form
        className="card-surface space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!arquivo) return toast.error("Escolha o arquivo CSV ou XLSX.");
          importar.mutate();
        }}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <FileSpreadsheet className="size-4 text-info-ink" /> Importar planilha
        </h3>
        <p className="text-xs text-muted-foreground">
          Colunas: <Mono>codigo_local</Mono> e <Mono>nome</Mono> (obrigatórias), <Mono>codigo_cnj</Mono> e <Mono>pai_codigo</Mono> (opcionais). Outras
          colunas ficam como dados extras.
        </p>
        <Field label="Tabela">
          <NativeSelect value={tabela} onChange={(e) => setTabela(e.target.value)}>
            {Object.entries(TABELAS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Tribunal" dica="Vazio = tabela nacional (TPU), vale para todos.">
          <NativeSelect value={tribunal} onChange={(e) => setTribunal(e.target.value)}>
            <option value="">Nacional (TPU)</option>
            {(tribunais.data ?? []).map((t) => (
              <option key={t.id} value={t.sigla}>
                {t.sigla} · {t.nome}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Arquivo (CSV ou XLSX)">
          <Input type="file" accept=".csv,.xlsx" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={substituir} onCheckedChange={(v) => setSubstituir(!!v)} className="mt-0.5" />
          <span>
            Substituir a tabela atual
            <span className="block text-xs text-muted-foreground">Desmarcado, as linhas são somadas às que já existem.</span>
          </span>
        </label>
        <Button type="submit" className="w-full" disabled={importar.isPending || !arquivo}>
          {importar.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Importar
        </Button>
      </form>
    </div>
  );
}
