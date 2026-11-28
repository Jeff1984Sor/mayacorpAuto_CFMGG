"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  FastForward,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  SquareX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { BotaoExcluir } from "@/components/admin/excluir";
import { copiarLink } from "@/components/admin/cobranca";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDebounce } from "@/hooks/use-debounce";
import {
  type ClienteSaaS,
  type Cobranca,
  type ConfigCobranca,
  type Periodicidade,
  type PreviaRecorrencia,
  type Recorrencia,
  type RecorrenciaIn,
  ROTULO_PERIODICIDADE,
  TOM_RECORRENCIA,
} from "@/lib/admin";
import { api, ApiError } from "@/lib/api";
import { data, moeda } from "@/lib/format";

type Form = {
  descricao: string;
  valor: string;
  periodicidade: Periodicidade;
  dia_vencimento: string;
  /** AAAA-MM */
  inicio: string;
  termino_tipo: RecorrenciaIn["termino_tipo"];
  termino_data: string;
  termino_quantidade: string;
  antecedencia: string;
  observacao: string;
};

const DIA_PADRAO = 10;

/** Mês sugerido para a primeira cobrança: este, ou o próximo se o dia do vencimento já passou. */
function mesSugerido() {
  const d = new Date();
  if (d.getDate() > DIA_PADRAO) d.setMonth(d.getMonth() + 1, 1);
  return d.toLocaleDateString("sv-SE").slice(0, 7);
}

const mesAno = (competencia: string) =>
  competencia.split("-").reverse().join("/");

/** O primeiro aviso "antes do vencimento" da régua (o mesmo padrão que o servidor usa). */
function antecedenciaPadrao(regua?: number[]) {
  const antes = (regua ?? []).filter((d) => d < 0).map((d) => -d);
  return antes.length ? Math.max(...antes) : 3;
}

const formDe = (r: Recorrencia | null, antecedencia: number): Form =>
  r
    ? {
        descricao: r.descricao,
        valor: String(r.valor),
        periodicidade: r.periodicidade,
        dia_vencimento: String(r.dia_vencimento),
        inicio: r.inicio.slice(0, 7),
        termino_tipo: r.termino_tipo,
        termino_data: r.termino_data ?? "",
        termino_quantidade: r.termino_quantidade
          ? String(r.termino_quantidade)
          : "",
        antecedencia: String(r.antecedencia),
        observacao: r.observacao ?? "",
      }
    : {
        descricao: "",
        valor: "",
        periodicidade: "mensal",
        dia_vencimento: String(DIA_PADRAO),
        inicio: mesSugerido(),
        termino_tipo: "sem_fim",
        termino_data: "",
        termino_quantidade: "12",
        antecedencia: String(antecedencia),
        observacao: "",
      };

const corpoDe = (f: Form): RecorrenciaIn => ({
  descricao: f.descricao.trim(),
  valor: f.valor,
  periodicidade: f.periodicidade,
  dia_vencimento: Number(f.dia_vencimento),
  inicio: `${f.inicio}-01`,
  termino_tipo: f.termino_tipo,
  termino_data: f.termino_tipo === "data" ? f.termino_data || null : null,
  termino_quantidade:
    f.termino_tipo === "quantidade"
      ? Number(f.termino_quantidade) || null
      : null,
  antecedencia: f.antecedencia === "" ? null : Number(f.antecedencia),
  observacao: f.observacao.trim() || null,
});

const completo = (f: Form) =>
  f.descricao.trim().length >= 3 &&
  Number(f.valor) > 0 &&
  /^\d{4}-\d{2}$/.test(f.inicio) &&
  (f.termino_tipo !== "data" || !!f.termino_data) &&
  (f.termino_tipo !== "quantidade" || Number(f.termino_quantidade) >= 1);

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning-ink">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function RecorrenciaDialog({
  open,
  onClose,
  cli,
  rec,
}: {
  open: boolean;
  onClose: () => void;
  cli: ClienteSaaS;
  rec: Recorrencia | null;
}) {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["admin", "cobranca-config"],
    queryFn: () => api.get<ConfigCobranca>("/admin/cobranca/config"),
    enabled: open,
  });
  const padrao = antecedenciaPadrao(cfg.data?.regua);
  const [f, setF] = useState<Form>(() => formDe(null, 3));
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (open) setF(formDe(rec, padrao));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rec]);
  useEffect(() => {
    // a régua chegou depois de o modal abrir: a recorrência nova começa com a antecedência dela
    if (open && !rec) setF((o) => ({ ...o, antecedencia: String(padrao) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padrao]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setF((o) => ({ ...o, [k]: v }));

  const paraPrevia = useDebounce(f, 350);
  const previa = useQuery({
    queryKey: ["admin", "recorrencia-previa", cli.id, rec?.id ?? 0, paraPrevia],
    queryFn: () =>
      api.post<PreviaRecorrencia>("/admin/recorrencias/previa", {
        ...corpoDe(paraPrevia),
        cliente_id: cli.id,
        recorrencia_id: rec?.id ?? null,
      }),
    enabled: open && completo(paraPrevia),
    meta: { silencioso: true },
    retry: false,
    staleTime: 0,
  });
  const p = previa.data;

  const salvar = useMutation({
    mutationFn: () =>
      rec
        ? api.put<Recorrencia>(`/admin/recorrencias/${rec.id}`, corpoDe(f))
        : api.post<Recorrencia>(
            `/admin/clientes/${cli.id}/recorrencias`,
            corpoDe(f),
          ),
    onSuccess: (r) => {
      if (rec) toast.success("Recorrência atualizada: vale da próxima cobrança em diante");
      else if (r.sem_email)
        toast.warning(
          "Recorrência criada, mas falta o e-mail do financeiro na ficha: as cobranças serão geradas e não enviadas.",
          { duration: 12000 },
        );
      else toast.success("Recorrência criada");
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  const jaGerou = !!rec && rec.geradas > 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo={rec ? "Editar recorrência" : "Nova cobrança recorrente"}
      descricao={
        rec
          ? "O que mudar aqui vale da próxima cobrança em diante. As que já saíram continuam como estão."
          : `${cli.nome}: uma cobrança a cada período, com link do Mercado Pago (Pix, cartão ou boleto) enviado por e-mail.`
      }
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={rec ? "Salvar" : "Criar recorrência"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!completo(f))
          return toast.error("Preencha a descrição, o valor e o término.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Descrição"
          obrigatorio
          htmlFor="rec-desc"
          className="sm:col-span-2"
          dica="Aparece no e-mail, no link de pagamento e na nota, seguida do mês (ex.: Hospedagem do site 01/2027)."
        >
          <Input
            id="rec-desc"
            required
            minLength={3}
            maxLength={180}
            value={f.descricao}
            onChange={(e) => set("descricao", e.target.value)}
            placeholder="Ex.: Hospedagem do site"
            autoFocus
          />
        </Field>
        <Field label="Valor (R$)" obrigatorio htmlFor="rec-valor">
          <Input
            id="rec-valor"
            required
            type="number"
            step="0.01"
            min={0.01}
            value={f.valor}
            onChange={(e) => set("valor", e.target.value)}
          />
        </Field>
        <Field label="Periodicidade" htmlFor="rec-per">
          <NativeSelect
            id="rec-per"
            value={f.periodicidade}
            onChange={(e) =>
              set("periodicidade", e.target.value as Periodicidade)
            }
          >
            {(Object.keys(ROTULO_PERIODICIDADE) as Periodicidade[]).map((k) => (
              <option key={k} value={k}>
                {ROTULO_PERIODICIDADE[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Dia do vencimento" htmlFor="rec-dia">
          <NativeSelect
            id="rec-dia"
            value={f.dia_vencimento}
            onChange={(e) => set("dia_vencimento", e.target.value)}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Dia {d}
              </option>
            ))}
            <option value="0">Último dia do mês</option>
          </NativeSelect>
        </Field>
        <Field
          label="Primeira cobrança em"
          obrigatorio
          htmlFor="rec-inicio"
          dica={
            jaGerou
              ? "Não muda depois que a primeira cobrança saiu."
              : "Mês do primeiro vencimento."
          }
        >
          <Input
            id="rec-inicio"
            type="month"
            required
            disabled={jaGerou}
            value={f.inicio}
            onChange={(e) => set("inicio", e.target.value)}
          />
        </Field>
        <Field label="Término" htmlFor="rec-termino">
          <NativeSelect
            id="rec-termino"
            value={f.termino_tipo}
            onChange={(e) =>
              set("termino_tipo", e.target.value as Form["termino_tipo"])
            }
          >
            <option value="sem_fim">Sem fim (até encerrar)</option>
            <option value="data">Até uma data</option>
            <option value="quantidade">Número de cobranças</option>
          </NativeSelect>
        </Field>
        {f.termino_tipo === "data" ? (
          <Field
            label="Até"
            obrigatorio
            htmlFor="rec-ate"
            dica="Último vencimento aceito."
          >
            <Input
              id="rec-ate"
              type="date"
              required
              value={f.termino_data}
              onChange={(e) => set("termino_data", e.target.value)}
            />
          </Field>
        ) : f.termino_tipo === "quantidade" ? (
          <Field
            label="Quantas cobranças"
            obrigatorio
            htmlFor="rec-qtd"
            dica={
              jaGerou ? `Já saíram ${rec!.geradas}.` : "No total, contando a primeira."
            }
          >
            <Input
              id="rec-qtd"
              type="number"
              required
              min={Math.max(1, rec?.geradas ?? 1)}
              max={600}
              value={f.termino_quantidade}
              onChange={(e) => set("termino_quantidade", e.target.value)}
            />
          </Field>
        ) : null}
        <Field
          label="Gerar e enviar quantos dias antes"
          htmlFor="rec-ant"
          dica={`Do vencimento. Padrão: ${padrao}, o primeiro aviso da régua de e-mails.`}
        >
          <Input
            id="rec-ant"
            type="number"
            min={0}
            max={60}
            value={f.antecedencia}
            onChange={(e) => set("antecedencia", e.target.value)}
          />
        </Field>
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3 sm:col-span-2">
          <p className="flex items-center gap-2 text-[13px] font-medium">
            <CalendarClock className="size-4 text-muted-foreground" />
            Confira as próximas cobranças
            {previa.isFetching && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </p>
          {!completo(f) ? (
            <p className="text-xs text-muted-foreground">
              Preencha a descrição e o valor para ver as datas.
            </p>
          ) : previa.isError ? (
            <p className="text-xs text-danger-ink">
              {previa.error instanceof ApiError
                ? previa.error.message
                : "Não deu para calcular as datas. Confira os campos."}
            </p>
          ) : !p ? (
            <Skeleton className="h-16" />
          ) : (
            <>
              <ul className="divide-y rounded-md border bg-card text-sm">
                {p.proximas.map((x) => (
                  <li
                    key={x.competencia}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2"
                  >
                    <span className="w-20 font-mono text-xs text-muted-foreground">
                      {mesAno(x.competencia)}
                    </span>
                    <span className="w-32 font-medium">
                      vence {data(x.vencimento)}
                    </span>
                    <span className="w-28 font-mono tabular-nums">
                      {moeda(x.valor)}
                    </span>
                    <span className="flex-1 text-xs text-muted-foreground">
                      {x.ja_sai
                        ? `já passou da data: sai na próxima rodada, com ${p.prazo_atrasada} dias para pagar`
                        : `sai e vai por e-mail em ${data(x.sai_em)}`}
                    </span>
                  </li>
                ))}
              </ul>
              {p.termina && (
                <p className="text-xs text-muted-foreground">
                  {p.proximas.length
                    ? `Depois ${p.proximas.length === 1 ? "desta" : "destas"} a recorrência termina.`
                    : "Não há mais cobranças: a recorrência já chegou ao fim."}
                </p>
              )}
              {p.saem_ja > 1 && (
                <Aviso>
                  {p.saem_ja} cobranças já passaram da data e vão sair sozinhas,
                  em ordem, até {p.por_dia} por dia. Se a ideia é cobrar só
                  daqui para a frente, mude o mês da primeira cobrança.
                </Aviso>
              )}
              {p.sem_email && (
                <Aviso>
                  Falta o e-mail do financeiro na ficha de {cli.nome}: as
                  cobranças serão geradas, mas não enviadas, e ficam destacadas
                  na tela Cobranças.
                </Aviso>
              )}
              {p.cliente_inativo && (
                <Aviso>
                  O cliente está inativo: nada é gerado enquanto ele não for
                  reativado.
                </Aviso>
              )}
            </>
          )}
        </div>

        <Field
          label="Observação"
          htmlFor="rec-obs"
          className="sm:col-span-2"
          dica="Só para a MayaCorp; o cliente não vê."
        >
          <Textarea
            id="rec-obs"
            rows={2}
            value={f.observacao}
            onChange={(e) => set("observacao", e.target.value)}
          />
        </Field>
      </div>
    </FormDialog>
  );
}

/** Seção "Cobranças recorrentes" da aba Cobranças da ficha do cliente. */
export function Recorrencias({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const [editar, setEditar] = useState<Recorrencia | "nova" | null>(null);
  const [acao, setAcao] = useState<{
    r: Recorrencia;
    tipo: "encerrar" | "gerar";
  } | null>(null);
  const lista = useQuery({
    queryKey: ["admin", "recorrencias", cli.id],
    queryFn: () =>
      api.get<Recorrencia[]>(`/admin/clientes/${cli.id}/recorrencias`),
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const situacao = useMutation({
    mutationFn: ({
      r,
      acao,
    }: {
      r: Recorrencia;
      acao: "pausar" | "retomar" | "encerrar";
    }) =>
      api.post<Recorrencia>(`/admin/recorrencias/${r.id}/situacao`, { acao }),
    onSuccess: (r) => {
      toast.success(`${r.descricao}: ${r.status_rotulo.toLowerCase()}`);
      setAcao(null);
      atualizar();
    },
  });
  const gerar = useMutation({
    mutationFn: (r: Recorrencia) =>
      api.post<{ cobranca: Cobranca; recorrencia: Recorrencia }>(
        `/admin/recorrencias/${r.id}/gerar`,
      ),
    onSuccess: ({ cobranca: k }) => {
      const link = k.link;
      if (k.envio_erro)
        toast.warning(`${k.descricao} gerada, mas não enviada: ${k.envio_erro}.`, {
          duration: 12000,
          action: link
            ? { label: "Copiar link", onClick: () => copiarLink(link) }
            : undefined,
        });
      else
        toast.success(`${k.descricao} gerada e enviada por e-mail`, {
          action: link
            ? { label: "Copiar link", onClick: () => copiarLink(link) }
            : undefined,
        });
      setAcao(null);
      atualizar();
    },
  });
  const itens = lista.data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Cobranças recorrentes</p>
          <p className="text-xs text-muted-foreground">
            Serviços cobrados todo período. A cobrança sai sozinha na data, com
            o link de pagamento.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditar("nova")}>
          <Plus /> Nova recorrência
        </Button>
      </div>
      {!cli.email_financeiro && itens.some((r) => r.status === "ativa") && (
        <Aviso>
          Falta o e-mail do financeiro na ficha: as cobranças são geradas, mas
          não enviadas.
        </Aviso>
      )}
      {lista.isPending ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : itens.length === 0 ? (
        <EmptyState
          icone={Repeat}
          titulo="Nenhuma cobrança recorrente"
          descricao="Crie uma para cobrar todo mês (ou a cada 2, 3, 6 ou 12 meses) sem precisar lembrar."
          acao={
            <Button onClick={() => setEditar("nova")}>
              <Plus /> Nova recorrência
            </Button>
          }
        />
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Descrição</th>
                <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                <th className="px-3 py-2.5 font-medium">Periodicidade</th>
                <th className="px-3 py-2.5 font-medium">Próximo vencimento</th>
                <th className="px-3 py-2.5 font-medium">Situação</th>
                <th className="px-3 py-2.5 font-medium">Geradas / pagas</th>
                <th className="px-3 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((r) => {
                const viva = r.status === "ativa" || r.status === "pausada";
                return (
                  <tr key={r.id} className={viva ? "" : "text-muted-foreground"}>
                    <td className="max-w-64 px-4 py-3">
                      <p className="truncate font-medium" title={r.descricao}>
                        {r.descricao}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.termino_tipo === "data"
                          ? `até ${data(r.termino_data)}`
                          : r.termino_tipo === "quantidade"
                            ? `${r.termino_quantidade} cobranças no total`
                            : "sem fim"}
                        {r.observacao && ` · ${r.observacao}`}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {moeda(r.valor)}
                    </td>
                    <td className="px-3 py-3">{r.periodicidade_rotulo}</td>
                    <td className="px-3 py-3 text-xs">
                      {r.proximo_vencimento ? (
                        <>
                          {data(r.proximo_vencimento)}
                          {r.status === "ativa" && !r.cliente_inativo && (
                            <p className="text-muted-foreground">
                              sai {r.antecedencia} dia(s) antes
                            </p>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Pill tom={TOM_RECORRENCIA[r.status]}>
                        {r.status_rotulo}
                      </Pill>
                      {r.status === "ativa" && r.cliente_inativo && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          cliente inativo: não gera
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums">
                      {r.geradas} / {r.pagas}
                      {r.em_aberto > 0 && (
                        <span className="font-sans text-muted-foreground">
                          {" "}
                          · {r.em_aberto} em aberto
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        {r.status === "ativa" && r.proximo_vencimento && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Gerar a próxima agora"
                            aria-label={`Gerar a próxima agora: ${r.descricao}`}
                            onClick={() => setAcao({ r, tipo: "gerar" })}
                          >
                            <FastForward />
                          </Button>
                        )}
                        {r.status !== "encerrada" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            aria-label={`Editar ${r.descricao}`}
                            onClick={() => setEditar(r)}
                          >
                            <Pencil />
                          </Button>
                        )}
                        {viva && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              title={
                                r.status === "ativa"
                                  ? "Pausar (para de gerar até retomar)"
                                  : "Retomar"
                              }
                              aria-label={`${r.status === "ativa" ? "Pausar" : "Retomar"} ${r.descricao}`}
                              disabled={situacao.isPending}
                              onClick={() =>
                                situacao.mutate({
                                  r,
                                  acao:
                                    r.status === "ativa" ? "pausar" : "retomar",
                                })
                              }
                            >
                              {r.status === "ativa" ? <Pause /> : <Play />}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Encerrar"
                              aria-label={`Encerrar ${r.descricao}`}
                              onClick={() => setAcao({ r, tipo: "encerrar" })}
                            >
                              <SquareX />
                            </Button>
                          </>
                        )}
                        {r.geradas === 0 && (
                          <BotaoExcluir
                            icone
                            url={`/admin/recorrencias/${r.id}`}
                            titulo={`Excluir “${r.descricao}”?`}
                            descricao="Ela ainda não gerou nenhuma cobrança, então some sem deixar rastro."
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RecorrenciaDialog
        open={!!editar}
        onClose={() => setEditar(null)}
        cli={cli}
        rec={editar && editar !== "nova" ? editar : null}
      />
      <ConfirmDialog
        open={!!acao}
        onOpenChange={(o) => !o && setAcao(null)}
        titulo={
          acao?.tipo === "gerar"
            ? "Gerar a próxima cobrança agora?"
            : "Encerrar a recorrência?"
        }
        descricao={
          acao &&
          (acao.tipo === "gerar"
            ? `${acao.r.descricao}: sai já a cobrança de ${moeda(acao.r.valor)} com vencimento em ${data(acao.r.proximo_vencimento)}, com o link e o e-mail, sem esperar a data. Ela não sai de novo depois.`
            : `${acao.r.descricao} para de gerar cobranças de vez. As ${acao.r.geradas} já geradas continuam como estão (as em aberto seguem sendo cobradas).`)
        }
        confirmar={acao?.tipo === "gerar" ? "Gerar agora" : "Encerrar"}
        destrutivo={acao?.tipo === "encerrar"}
        carregando={gerar.isPending || situacao.isPending}
        onConfirm={() =>
          acao &&
          (acao.tipo === "gerar"
            ? gerar.mutate(acao.r)
            : situacao.mutate({ r: acao.r, acao: "encerrar" }))
        }
      />
    </div>
  );
}
