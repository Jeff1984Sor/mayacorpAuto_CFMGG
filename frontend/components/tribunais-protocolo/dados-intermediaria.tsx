"use client";

import { AlertTriangle, Bell, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Mono } from "@/components/mayacorp/brand";
import { Field, FormSection, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { data, dataHora, documento } from "@/lib/format";
import {
  diasAte,
  NIVEIS_SIGILO,
  type Polo,
  type ProtocoloIn,
  type ProtocoloOut,
  ROTULO_POLO,
  useIntimacoesAbertas,
  useProcesso,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

import { BuscaTabela } from "./comum";

export function DadosIntermediaria({
  p,
  form,
  set,
}: {
  p: ProtocoloOut;
  form: ProtocoloIn;
  set: (patch: Partial<ProtocoloIn>) => void;
}) {
  const proc = useProcesso(form.processo_id);
  const intim = useIntimacoesAbertas(form.processo_id);
  const dias = diasAte(form.prazo_final);
  const vencido = dias != null && dias < 0;
  const partes = proc.data?.partes ?? [];
  const polos = [...new Set(partes.map((x) => x.polo))];

  return (
    <div className="divide-y">
      <FormSection titulo="Processo" descricao="A petição vai para este processo, no sistema que o tribunal usa hoje.">
        <div className="sm:col-span-2">
          {proc.data ? (
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p>
                <span className="mr-1.5 text-xs font-semibold text-muted-foreground">{proc.data.tribunal}</span>
                <Mono>{proc.data.numero_formatado}</Mono>
                <Link href={`/tribunais/processos/${proc.data.id}`} className="ml-2 inline-flex items-center gap-1 text-xs text-info-ink hover:underline">
                  abrir <ExternalLink className="size-3" />
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[proc.data.classe_nome, proc.data.orgao_julgador, p.sistema?.toUpperCase()].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <Skeleton className="h-14" />
          )}
        </div>
      </FormSection>

      <FormSection titulo="Petição" descricao="O tipo segue a tabela do tribunal. Sem tabela sincronizada, informe o código e o nome.">
        <Field label="Tipo de petição" className="sm:col-span-2" obrigatorio>
          <BuscaTabela
            tabela="tipo_peticao"
            tribunal={p.tribunal}
            codigo={form.tipo_peticao_codigo}
            nome={form.tipo_peticao_nome}
            onChange={(c, n) => set({ tipo_peticao_codigo: c, tipo_peticao_nome: n })}
            placeholder="Ex.: Contestação, Manifestação, Embargos de declaração"
          />
        </Field>
        <Field label="Título interno">
          <Input value={form.titulo ?? ""} onChange={(e) => set({ titulo: e.target.value })} maxLength={200} />
        </Field>
        <Field label="Nível de sigilo">
          <NativeSelect value={form.nivel_sigilo} onChange={(e) => set({ nivel_sigilo: Number(e.target.value) })}>
            {NIVEIS_SIGILO.map((n) => (
              <option key={n.v} value={n.v}>
                {n.l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <SwitchRow titulo="Pedido urgente" descricao="Sinaliza ao tribunal que a petição pede análise urgente (ex.: liminar).">
            <Switch checked={form.pedido_urgente} onCheckedChange={(v) => set({ pedido_urgente: v })} />
          </SwitchRow>
        </div>
      </FormSection>

      <FormSection titulo="Em nome de quem" descricao="O polo e as partes que o escritório representa nesta petição.">
        <Field label="Polo de quem peticiona" obrigatorio>
          <NativeSelect value={form.polo_peticionante ?? ""} onChange={(e) => set({ polo_peticionante: (e.target.value || null) as Polo | null, parte_ids: [] })}>
            <option value="">Escolha</option>
            {(Object.keys(ROTULO_POLO) as Polo[]).map((k) => (
              <option key={k} value={k}>
                {ROTULO_POLO[k]}
                {polos.length && !polos.includes(k) ? " (sem partes neste processo)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-foreground/80">
            Partes <span className="text-danger">*</span>
          </p>
          {proc.isPending ? (
            <Skeleton className="h-20" />
          ) : partes.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">O processo não tem partes importadas. Sincronize o processo antes.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {partes
                .filter((x) => !form.polo_peticionante || x.polo === form.polo_peticionante)
                .map((x) => {
                  const marcado = form.parte_ids.includes(x.id);
                  const nosso = x.advogados.some((a) => a.e_o_usuario);
                  return (
                    <li key={x.id}>
                      <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm", marcado && "bg-brand/5")}>
                        <Checkbox
                          checked={marcado}
                          onCheckedChange={(v) =>
                            set({
                              parte_ids: v ? [...form.parte_ids, x.id] : form.parte_ids.filter((i) => i !== x.id),
                              polo_peticionante: form.polo_peticionante ?? x.polo,
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{x.pessoa.nome}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {ROTULO_POLO[x.polo] ?? x.polo}
                            {(x.pessoa.cpf || x.pessoa.cnpj) && (
                              <>
                                {" · "}
                                <Mono>{documento(x.pessoa.cpf ?? x.pessoa.cnpj)}</Mono>
                              </>
                            )}
                            {x.advogados.length > 0 && ` · adv.: ${x.advogados.map((a) => a.nome).join(", ")}`}
                          </span>
                        </span>
                        {nosso && <span className="text-[11px] font-medium text-success-ink">nossa parte</span>}
                      </label>
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </FormSection>

      <FormSection titulo="Prazo" descricao="Vincular à intimação marca a ciência e usa o prazo dela.">
        <Field label="Em resposta à intimação" className="sm:col-span-2">
          <NativeSelect
            value={form.em_resposta_a_intimacao_id ?? ""}
            onChange={(e) => {
              const id = Number(e.target.value) || null;
              const m = intim.data?.find((x) => x.id === id);
              set({ em_resposta_a_intimacao_id: id, prazo_final: m?.prazo_final?.slice(0, 10) ?? form.prazo_final });
            }}
          >
            <option value="">Nenhuma (petição espontânea)</option>
            {(intim.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {dataHora(m.data_hora)} · {m.descricao.slice(0, 90)}
                {m.prazo_final ? ` · prazo ${data(m.prazo_final)}` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Prazo final" dica={dias != null && !vencido ? (dias === 0 ? "Vence hoje." : `Faltam ${dias} dia(s).`) : undefined}>
          <Input type="date" value={form.prazo_final ?? ""} onChange={(e) => set({ prazo_final: e.target.value || null })} />
        </Field>
        {vencido && (
          <Field label="Justificativa de protocolo fora do prazo" className="sm:col-span-2" obrigatorio>
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-danger/8 px-3 py-2 text-xs text-danger-ink">
              <AlertTriangle className="size-4 shrink-0" /> O prazo já passou. Explique o motivo (ex.: prazo suspenso, justa causa).
            </div>
            <Textarea
              value={form.fora_do_prazo_justificativa ?? ""}
              onChange={(e) => set({ fora_do_prazo_justificativa: e.target.value })}
              maxLength={500}
              rows={2}
            />
          </Field>
        )}
        {intim.data && intim.data.length > 0 && !form.em_resposta_a_intimacao_id && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
            <Bell className="size-3.5" /> Este processo tem {intim.data.length} intimação(ões). Se a petição responde a uma delas, vincule acima.
          </p>
        )}
      </FormSection>
    </div>
  );
}
