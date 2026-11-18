"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { api, baixar } from "@/lib/api";
import type { CampoOut } from "@/lib/faturamento";
import { cn } from "@/lib/utils";

import { TIPOS_CAMPO, useAreas, useCampos } from "./campos-adicionais";
import { CampoDialog } from "./config-ficha";
import { ImportarCasosDialog } from "./importar-casos";
import {
  PADRAO_TITULO,
  type ModeloTituloOut,
  renderTitulo,
  useModeloCaso,
} from "./titulo-caso";

/** Exemplo fixo para a prévia do modelo. */
const EXEMPLO = {
  numero: "#123",
  processo: "1001234-56.2026.8.26.0100",
  parte_contraria: "Banco Exemplo S/A",
  tipo: "Judicial Estadual",
  area: "Cível",
  tribunal: "TJSP",
  vara: "2ª Vara Cível",
  comarca: "São Paulo",
  valor_causa: "R$ 10.000,00",
  data_distribuicao: "05/03/2026",
  contrato: "Contencioso",
};

/** Aba "Casos" do cadastro do cliente: campos só deste cliente e o modelo do título dos casos. */
export function CasosDoCliente({
  tomadorId,
  nomeCliente,
}: {
  tomadorId: number;
  nomeCliente: string;
}) {
  const qc = useQueryClient();
  const { isAdmin, administrador } = useAuth();
  const admin = isAdmin || administrador; // criar campo é de administrador (o backend confere)
  const areas = useAreas();
  const gerais = useCampos();
  const doCliente = useQuery({
    queryKey: ["fat", "campos", "cliente", tomadorId],
    queryFn: () =>
      api.get<CampoOut[]>("/faturamento/campos", { tomador_id: tomadorId }),
  });
  const modelo = useModeloCaso(tomadorId);
  const [texto, setTexto] = useState("");
  const [notaTitulo, setNotaTitulo] = useState<boolean | null>(null);
  const [notaRegra, setNotaRegra] = useState<boolean | null>(null);
  const [dlg, setDlg] = useState<{ c: CampoOut | null } | null>(null);
  const [excluir, setExcluir] = useState<CampoOut | null>(null);
  const [importar, setImportar] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- carrega a configuração salva */
  useEffect(() => {
    if (!modelo.data) return;
    setTexto(modelo.data.modelo_titulo_caso ?? "");
    setNotaTitulo(modelo.data.nota_titulo_caso);
    setNotaRegra(modelo.data.nota_texto_regra);
  }, [modelo.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const campos = (doCliente.data ?? []).filter((c) => c.ativo);
  const usaveis = [
    ...(gerais.data ?? []).filter((c) => c.ativo && !c.tomador_id),
    ...campos,
  ];
  const exemplosCampos = Object.fromEntries(
    usaveis.map((c) => [
      String(c.id),
      c.tipo === "data" ? "2026-03-05" : `[${c.nome}]`,
    ]),
  );
  const previa = texto.trim()
    ? renderTitulo(
        texto,
        { ...EXEMPLO, cliente: nomeCliente },
        usaveis,
        exemplosCampos,
      )
    : "";
  const mudou =
    (modelo.data?.modelo_titulo_caso ?? "") !== texto.trim() ||
    (modelo.data?.nota_titulo_caso ?? null) !== notaTitulo ||
    (modelo.data?.nota_texto_regra ?? null) !== notaRegra;

  const inserir = (rotulo: string) => {
    const el = input.current;
    const token = `{${rotulo}}`;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const antes = texto.slice(0, ini);
    const sep = antes && !/[\s\-–—|/(]$/.test(antes) ? " - " : "";
    const novo = antes + sep + token + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = (antes + sep + token).length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const salvar = useMutation({
    mutationFn: () =>
      api.put<ModeloTituloOut>(
        `/faturamento/clientes/${tomadorId}/modelo-caso`,
        {
          modelo_titulo_caso: texto.trim() || null,
          nota_titulo_caso: notaTitulo,
          nota_texto_regra: notaRegra,
        },
      ),
    onSuccess: (r) => {
      toast.success("Configuração dos casos salva", {
        description: r.atualizados
          ? `${r.atualizados} caso(s) deste cliente com o título refeito.`
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });
  const remover = useMutation({
    mutationFn: (id: number) =>
      api.del<{ mensagem: string }>(`/faturamento/campos/${id}`),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setExcluir(null);
      qc.invalidateQueries({ queryKey: ["fat"] });
    },
  });

  return (
    <div className="space-y-5">
      {/* ---------------- importar casos por planilha */}
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-brand/10 via-card to-success/8 p-4">
        <div className="pointer-events-none absolute -top-10 -right-6 size-32 rounded-full bg-brand/15 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-sm">
            <FileSpreadsheet className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              Importar casos por planilha
            </h3>
            <p className="text-xs text-muted-foreground">
              Cadastra os casos que faltam, no contrato certo, com as regras de
              cobrança. O que já existe não é repetido.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void baixarModelo(tomadorId)}
            >
              <Download /> Baixar modelo
            </Button>
            <Button type="button" onClick={() => setImportar(true)}>
              <FileSpreadsheet /> Importar planilha
            </Button>
          </div>
        </div>
      </section>
      <ImportarCasosDialog
        open={importar}
        onOpenChange={setImportar}
        tomadorId={tomadorId}
        nomeCliente={nomeCliente}
      />

      {/* ---------------- campos do cliente */}
      <section className="rounded-2xl border">
        <header className="flex flex-wrap items-start gap-3 border-b p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success-ink">
            <Layers className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              Campos dos casos deste cliente
            </h3>
            <p className="text-xs text-muted-foreground">
              Aparecem no formulário de todo caso de {nomeCliente}, além dos
              campos gerais.
            </p>
          </div>
          {admin && (
            <Button type="button" size="sm" onClick={() => setDlg({ c: null })}>
              <Plus /> Novo campo
            </Button>
          )}
        </header>
        {doCliente.isPending ? (
          <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
        ) : (doCliente.data ?? []).length === 0 ? (
          <EmptyState
            icone={Layers}
            titulo="Nenhum campo próprio"
            descricao="Ex.: “Nº do sinistro”, “Apólice”, “Centro de custo”."
            className="py-6"
          />
        ) : (
          <ul className="divide-y">
            {(doCliente.data ?? []).map((c) => {
              const T = TIPOS_CAMPO[c.tipo];
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <T.icone className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {c.nome}
                      {c.obrigatorio && <span className="text-danger">*</span>}
                      {!c.ativo && <Pill tom="neutral">inativo</Pill>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {T.l}
                      {c.tipo === "lista" && ` · ${c.opcoes.join(", ")}`} ·{" "}
                      {c.qtd_preenchidos} caso(s) preenchido(s)
                    </p>
                  </div>
                  {admin && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Editar ${c.nome}`}
                        onClick={() => setDlg({ c })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Excluir ${c.nome}`}
                        onClick={() => setExcluir(c)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---------------- modelo do título */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-info-ink">
            <Type className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Título dos casos</h3>
            <p className="text-xs text-muted-foreground">
              Monte o título com os campos abaixo. Todo caso deste cliente
              recebe o título automaticamente; campo vazio some do título.
            </p>
          </div>
        </div>
        <Input
          ref={input}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Clique nos campos abaixo, ex.: {Nº do sinistro} - {Processo} - {Parte contrária}"
          className="font-mono text-[13px]"
          maxLength={300}
          aria-label="Modelo do título do caso"
        />
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {Object.values(PADRAO_TITULO).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => inserir(r)}
                className="rounded-full border px-2.5 py-0.5 text-xs transition hover:border-brand/50 hover:bg-brand/8"
              >
                {r}
              </button>
            ))}
          </div>
          {usaveis.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {usaveis.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => inserir(c.nome)}
                  className="rounded-full border border-success/40 bg-success/8 px-2.5 py-0.5 text-xs text-success-ink transition hover:bg-success/15"
                  title={c.tomador_id ? "Campo deste cliente" : "Campo geral"}
                >
                  {c.nome}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-3 rounded-xl bg-muted/40 px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">Exemplo: </span>
          {previa ? (
            <strong className="font-medium">{previa}</strong>
          ) : (
            <span className="text-muted-foreground">
              sem modelo: o título é digitado em cada caso
            </span>
          )}
        </div>
      </section>

      {/* ---------------- texto da nota fiscal deste cliente */}
      <section className="rounded-2xl border p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-warning/12 text-warning-ink">
            <ReceiptText className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">
              Na nota fiscal deste cliente
            </h3>
            <p className="text-xs text-muted-foreground">
              O que entra no texto da NFS-e das faturas de {nomeCliente}.
              “Padrão” segue Configurações › Automações.
            </p>
          </div>
        </div>
        <div className="space-y-2.5">
          <OpcaoNota
            titulo="Título do caso"
            exemplo="ex.: Caso #12 — 1234567 - Fulano"
            valor={notaTitulo}
            onChange={setNotaTitulo}
          />
          <OpcaoNota
            titulo="Texto da regra de cobrança"
            exemplo="ex.: Honorários iniciais"
            valor={notaRegra}
            onChange={setNotaRegra}
          />
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        {mudou && (
          <span className="text-xs text-warning-ink">Alteração não salva</span>
        )}
        <Button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={!mudou || salvar.isPending}
        >
          {salvar.isPending && <Loader2 className="animate-spin" />} Salvar
          configuração dos casos
        </Button>
      </div>

      <CampoDialog
        open={!!dlg}
        onOpenChange={(o) => !o && setDlg(null)}
        campo={dlg?.c ?? null}
        areas={areas.data ?? []}
        tomadorId={tomadorId}
      />
      <ConfirmDialog
        open={!!excluir}
        onOpenChange={(o) => !o && setExcluir(null)}
        titulo={`Excluir o campo “${excluir?.nome ?? ""}”?`}
        descricao={
          excluir?.qtd_preenchidos
            ? "Ele já tem valores em casos: só é desativado e os valores ficam guardados."
            : "O campo será apagado."
        }
        confirmar={excluir?.qtd_preenchidos ? "Desativar" : "Excluir"}
        destrutivo
        carregando={remover.isPending}
        onConfirm={() => excluir && remover.mutate(excluir.id)}
      />
    </div>
  );
}

/** Padrão (segue Configurações) · Sim · Não */
function OpcaoNota({
  titulo,
  exemplo,
  valor,
  onChange,
}: {
  titulo: string;
  exemplo: string;
  valor: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const opcoes: [boolean | null, string][] = [
    [null, "Padrão"],
    [true, "Sim"],
    [false, "Não"],
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/30 px-3 py-2">
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-muted-foreground">{exemplo}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={titulo}
        className="inline-flex rounded-lg border bg-background p-0.5"
      >
        {opcoes.map(([v, l]) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={valor === v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-md px-3 py-1 text-xs transition",
              valor === v
                ? v === false
                  ? "bg-muted font-medium text-foreground"
                  : "bg-brand font-medium text-white"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Planilha modelo da importação, já com o campo-chave e os contratos do cliente. */
export async function baixarModelo(tomadorId: number) {
  try {
    await baixar(
      `/faturamento/clientes/${tomadorId}/importar-casos/modelo`,
      {},
      "modelo_casos.xlsx",
    );
  } catch {
    toast.error("Não consegui baixar a planilha modelo.");
  }
}
