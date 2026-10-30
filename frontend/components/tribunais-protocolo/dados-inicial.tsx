"use client";

import { Plus, Star, X } from "lucide-react";
import { useState } from "react";

import { Field, FormSection, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  type CabecalhoInicial,
  NIVEIS_SIGILO,
  type Prioridade,
  type ProtocoloIn,
  type ProtocoloOut,
  ROTULO_GRAU,
  ROTULO_PRIORIDADE,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";

import { BuscaTabela } from "./comum";

export function DadosInicial({
  p,
  form,
  set,
}: {
  p: ProtocoloOut;
  form: ProtocoloIn;
  set: (patch: Partial<ProtocoloIn>) => void;
}) {
  const c = form.cabecalho;
  const setC = (patch: Partial<CabecalhoInicial>) => set({ cabecalho: { ...c, ...patch } });
  const [novoAssunto, setNovoAssunto] = useState<{ codigo: string | null; nome: string | null }>({ codigo: null, nome: null });
  const trib = p.tribunal;

  const addAssunto = () => {
    if (!novoAssunto.codigo) return;
    if (c.assuntos.some((a) => a.codigo === novoAssunto.codigo)) return;
    setC({ assuntos: [...c.assuntos, { codigo: novoAssunto.codigo, nome: novoAssunto.nome, principal: c.assuntos.length === 0 }] });
    setNovoAssunto({ codigo: null, nome: null });
  };

  const sn = (v: boolean | null, f: (b: boolean) => void) => <Switch checked={!!v} onCheckedChange={f} />;

  return (
    <div className="divide-y">
      <FormSection titulo="Onde distribuir" descricao={`${p.tribunal_nome} · ${ROTULO_GRAU[p.grau]}${p.sistema ? ` · ${p.sistema.toUpperCase()}` : ""}`}>
        <Field label="Título interno" className="sm:col-span-2">
          <Input value={form.titulo ?? ""} onChange={(e) => set({ titulo: e.target.value })} maxLength={200} placeholder="Ex.: Ação de cobrança — Fulano x Empresa" />
        </Field>
        <Field label="Comarca / foro / seção" className="sm:col-span-2" obrigatorio>
          <BuscaTabela
            tabela="localidade"
            tribunal={trib}
            codigo={c.localidade_codigo}
            nome={c.localidade_nome}
            onChange={(cod, nome) => setC({ localidade_codigo: cod, localidade_nome: nome })}
            placeholder="Ex.: São Paulo — Foro Central"
          />
        </Field>
        <Field label="Competência" dica="Exigida em vários PJe.">
          <BuscaTabela
            tabela="competencia"
            tribunal={trib}
            codigo={c.competencia_codigo}
            nome={null}
            semNome
            onChange={(cod) => setC({ competencia_codigo: cod })}
          />
        </Field>
        <Field label="Órgão julgador" dica="Só com direcionamento (prevenção, juizado específico).">
          <BuscaTabela
            tabela="orgao_julgador"
            tribunal={trib}
            codigo={c.orgao_julgador_codigo}
            nome={null}
            semNome
            onChange={(cod) => setC({ orgao_julgador_codigo: cod })}
          />
        </Field>
      </FormSection>

      <FormSection titulo="Classe e assuntos" descricao="Pela tabela do tribunal (TPU do CNJ). Ao menos um assunto principal.">
        <Field label="Classe processual" className="sm:col-span-2" obrigatorio>
          <BuscaTabela
            tabela="classe"
            tribunal={trib}
            codigo={c.classe_codigo}
            nome={c.classe_nome}
            onChange={(cod, nome) => setC({ classe_codigo: cod, classe_nome: nome })}
            placeholder="Ex.: Procedimento Comum Cível"
          />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-foreground/80">
            Assuntos <span className="text-danger">*</span>
          </p>
          {c.assuntos.length > 0 && (
            <ul className="mb-2 divide-y rounded-xl border">
              {c.assuntos.map((a) => (
                <li key={a.codigo} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <button
                    type="button"
                    title={a.principal ? "Assunto principal" : "Tornar principal"}
                    onClick={() => setC({ assuntos: c.assuntos.map((x) => ({ ...x, principal: x.codigo === a.codigo })) })}
                    className={cn("grid size-6 place-items-center rounded", a.principal ? "text-warning" : "text-muted-foreground hover:text-warning")}
                  >
                    <Star className={cn("size-4", a.principal && "fill-current")} />
                  </button>
                  <span className="font-mono text-xs text-muted-foreground">{a.codigo}</span>
                  <span className="min-w-0 flex-1 truncate">{a.nome ?? "—"}</span>
                  {a.principal && <span className="text-[11px] font-medium text-warning-ink">principal</span>}
                  <button
                    type="button"
                    onClick={() => {
                      const resto = c.assuntos.filter((x) => x.codigo !== a.codigo);
                      if (a.principal && resto[0]) resto[0] = { ...resto[0], principal: true };
                      setC({ assuntos: resto });
                    }}
                    className="text-muted-foreground hover:text-danger"
                    aria-label="Remover assunto"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <div className="flex-1">
              <BuscaTabela
                tabela="assunto"
                tribunal={trib}
                codigo={novoAssunto.codigo}
                nome={novoAssunto.nome}
                onChange={(cod, nome) => setNovoAssunto({ codigo: cod, nome })}
                placeholder="Buscar assunto"
              />
            </div>
            <Button type="button" variant="outline" onClick={addAssunto} disabled={!novoAssunto.codigo}>
              <Plus /> Incluir
            </Button>
          </div>
        </div>
        <Field label="Valor da causa (R$)" obrigatorio>
          <Input
            inputMode="decimal"
            value={c.valor_causa ?? ""}
            onChange={(e) => setC({ valor_causa: e.target.value.replace(/[^\d.,]/g, "") || null })}
            placeholder="0,00"
            className="font-mono"
          />
        </Field>
        <Field label="Audiência de conciliação" obrigatorio dica="CPC 319, VII.">
          <NativeSelect
            value={c.audiencia_conciliacao ?? ""}
            onChange={(e) => setC({ audiencia_conciliacao: (e.target.value || null) as CabecalhoInicial["audiencia_conciliacao"] })}
          >
            <option value="">Escolha</option>
            <option value="deseja">O autor deseja a audiência</option>
            <option value="nao_deseja">O autor não deseja a audiência</option>
          </NativeSelect>
        </Field>
      </FormSection>

      <FormSection titulo="Pedidos especiais">
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          <SwitchRow titulo="Justiça gratuita" descricao="Dispensa as custas iniciais. Anexe a declaração de hipossuficiência.">
            {sn(c.justica_gratuita_requerida, (v) => setC({ justica_gratuita_requerida: v }))}
          </SwitchRow>
          <SwitchRow titulo="Tutela de urgência (liminar)" descricao="Preencha o pedido de tutela no conteúdo da peça.">
            {sn(c.tutela_urgencia, (v) => setC({ tutela_urgencia: v }))}
          </SwitchRow>
          <SwitchRow titulo="Segredo de justiça" descricao="Pede que o processo corra em segredo.">
            {sn(c.segredo_justica_requerido, (v) => setC({ segredo_justica_requerido: v, nivel_sigilo: v ? Math.max(1, c.nivel_sigilo) : 0 }))}
          </SwitchRow>
          <SwitchRow titulo="Juízo 100% digital" descricao="Todos os atos por meio eletrônico.">
            {sn(c.juizo_100_digital, (v) => setC({ juizo_100_digital: v }))}
          </SwitchRow>
          <SwitchRow titulo="Procedimento sem réu" descricao="Ex.: jurisdição voluntária. Dispensa o polo passivo.">
            {sn(c.sem_reu, (v) => setC({ sem_reu: v }))}
          </SwitchRow>
        </div>
        {c.segredo_justica_requerido && (
          <Field label="Nível de sigilo">
            <NativeSelect value={c.nivel_sigilo} onChange={(e) => setC({ nivel_sigilo: Number(e.target.value) })}>
              {NIVEIS_SIGILO.map((n) => (
                <option key={n.v} value={n.v}>
                  {n.l}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] text-foreground/80">Prioridades de tramitação</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROTULO_PRIORIDADE) as Prioridade[]).map((k) => {
              const on = c.prioridades.includes(k);
              return (
                <label
                  key={k}
                  className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", on && "border-brand/50 bg-brand/8")}
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) => setC({ prioridades: v ? [...c.prioridades, k] : c.prioridades.filter((x) => x !== k) })}
                  />
                  {ROTULO_PRIORIDADE[k]}
                </label>
              );
            })}
          </div>
          {c.prioridades.length > 0 && <p className="mt-1.5 text-xs text-muted-foreground">Anexe o documento que comprova a prioridade.</p>}
        </div>
      </FormSection>

      <FormSection titulo="Processos relacionados" descricao="Distribuição por dependência ou ação ligada a outra (cumprimento, embargos).">
        <Field label="Prevenção (nº CNJ)">
          <Input
            value={c.prevencao_processo_cnj ?? ""}
            onChange={(e) => setC({ prevencao_processo_cnj: e.target.value })}
            placeholder="0000000-00.0000.0.00.0000"
            className="font-mono"
          />
        </Field>
        <Field label="Processo de referência (nº CNJ)">
          <Input
            value={c.processo_referencia_cnj ?? ""}
            onChange={(e) => setC({ processo_referencia_cnj: e.target.value })}
            placeholder="0000000-00.0000.0.00.0000"
            className="font-mono"
          />
        </Field>
      </FormSection>
    </div>
  );
}
