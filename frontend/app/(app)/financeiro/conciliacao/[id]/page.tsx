"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  EyeOff,
  GitCompareArrows,
  GraduationCap,
  Link2,
  Scale,
  SearchX,
  Undo2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { chaveConciliacao, EnviarExtratoDialog, useAposGravar, ValorLinha } from "@/components/financeiro/conciliacao/comum";
import { DesfazerDialog, RegrasDialog } from "@/components/financeiro/conciliacao/extras";
import { BaixasDialog, CriarPagarDialog, CriarReceberDialog } from "@/components/financeiro/conciliacao/popups";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ConciliacaoDetalhe, DesfeitoOut, LinhaOut, SituacaoLinha, VinculoOut } from "@/lib/conciliacao";
import { data, dataHora, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const SITUACAO: Record<SituacaoLinha, { l: string; tom: "success" | "warning" | "info" | "brand" | "neutral" }> = {
  conciliada: { l: "Conciliada", tom: "success" },
  feita: { l: "Lançada aqui", tom: "brand" },
  baixa_sugerida: { l: "Baixa sugerida", tom: "warning" },
  sem_correspondencia: { l: "A criar", tom: "info" },
  ignorada: { l: "Ignorada", tom: "neutral" },
};

const ORIGEM: Record<string, string> = {
  manual: "Lançamento manual",
  fatura: "Recebimento de fatura",
  conta_pagar: "Pagamento de conta",
  transferencia: "Transferência",
  importacao: "Importado",
  estorno: "Estorno",
};

type Filtro = "todas" | "pendentes" | "conciliadas" | "feitas" | "ignoradas";

function Grupo({
  rotulo,
  qtd,
  detalhe,
  icone: I,
  tom,
  acao,
  onClick,
}: {
  rotulo: string;
  qtd: number;
  detalhe: React.ReactNode;
  icone: React.ComponentType<{ className?: string }>;
  tom: "danger" | "success" | "warning" | "brand" | "neutral";
  acao?: string;
  onClick?: () => void;
}) {
  const fundo = {
    danger: "bg-danger/10 text-danger-ink",
    success: "bg-success/10 text-success-ink",
    warning: "bg-warning/12 text-warning-ink",
    brand: "bg-brand/10 text-info-ink",
    neutral: "bg-muted text-muted-foreground",
  }[tom];
  const ativo = !!onClick && qtd > 0;
  return (
    <button
      type="button"
      disabled={!ativo}
      onClick={onClick}
      className={cn("card-surface flex min-w-0 flex-col items-start gap-2 p-4 text-left transition", ativo ? "hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" : "cursor-default", qtd === 0 && "opacity-60")}
    >
      <span className="flex w-full items-center gap-2.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", fundo)}>
          <I className="size-[18px]" />
        </span>
        <span className="text-2xl leading-none font-semibold tabular-nums">{qtd}</span>
      </span>
      <span className="text-sm leading-snug font-medium">{rotulo}</span>
      <span className="text-xs text-muted-foreground">{detalhe}</span>
      {acao && ativo && <span className="mt-auto pt-1 text-xs font-semibold text-info-ink">{acao} →</span>}
    </button>
  );
}

function LinkVinculo({ v }: { v: VinculoOut }) {
  const href = v.fatura_id ? `/nfse/faturas/${v.fatura_id}` : v.conta_pagar_id ? `/financeiro/pagar/${v.conta_pagar_id}` : null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs">
      <Link2 className="size-3 shrink-0 text-muted-foreground" />
      {href ? (
        <Link href={href} className="min-w-0 truncate text-info-ink hover:underline" title={v.rotulo}>
          {v.rotulo}
        </Link>
      ) : (
        <span className="min-w-0 truncate" title={v.rotulo}>
          {v.rotulo}
        </span>
      )}
    </span>
  );
}

function DetalheLinha({ l }: { l: LinhaOut }) {
  return (
    <div className="min-w-0 space-y-0.5">
      {l.vinculos.map((v, i) => (
        <LinkVinculo key={i} v={v} />
      ))}
      {l.situacao === "baixa_sugerida" && (
        <p className="truncate text-xs" title={l.titulos.map((t) => `${t.rotulo} (${t.nome})`).join(" + ")}>
          {l.titulos.map((t) => `${t.rotulo}${t.nome ? ` · ${t.nome}` : ""}`).join(" + ")}
        </p>
      )}
      {l.situacao === "sem_correspondencia" && <p className="text-xs text-muted-foreground">Nada parecido no sistema: revise e crie o lançamento.</p>}
      {l.motivo && l.situacao !== "feita" && <p className="text-xs text-muted-foreground">{l.motivo}</p>}
      {l.aviso && <p className="text-xs text-warning-ink">{l.aviso}</p>}
    </div>
  );
}

function Fechamento({ c }: { c: ConciliacaoDetalhe }) {
  const f = c.fechamento;
  const dif = f.diferenca === null ? null : toNum(f.diferenca);
  const semExplicacao = f.sem_explicacao === null ? null : toNum(f.sem_explicacao);
  return (
    <section className="card-surface mb-5 p-4" aria-label="Fechamento">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Fechamento em {data(f.data)}</h2>
        {dif !== null && (Math.abs(dif) < 0.005 ? <Pill tom="success">saldos batem</Pill> : <Pill tom="warning">há diferença</Pill>)}
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Saldo no extrato do banco</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{f.saldo_extrato === null ? "—" : moeda(f.saldo_extrato)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Saldo no sistema</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{moeda(f.saldo_sistema)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Diferença</dt>
          <dd className={cn("font-mono text-lg font-semibold tabular-nums", dif !== null && Math.abs(dif) >= 0.005 && "text-warning-ink")}>{dif === null ? "—" : moeda(dif)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {f.saldo_extrato === null
          ? "Este arquivo não traz o saldo final, então não dá para comparar. O saldo do sistema é sempre calculado pelos lançamentos."
          : dif !== null && Math.abs(dif) < 0.005
            ? "O saldo que o banco informa é o mesmo que o sistema calcula."
            : Math.abs(toNum(f.a_lancar)) < 0.005
              ? "Não há linha pendente que explique a diferença: confira o que está “só no sistema” e o saldo inicial da conta."
              : `${moeda(f.a_lancar)} da diferença vêm das linhas que ainda faltam lançar` +
                (semExplicacao !== null && Math.abs(semExplicacao) >= 0.005
                  ? `; ${moeda(semExplicacao)} não têm explicação no extrato: confira o que está “só no sistema” e o saldo inicial da conta.`
                  : ": lançando todas, os saldos batem.")}
      </p>
    </section>
  );
}

export default function ConciliacaoPage() {
  const { id } = useParams<{ id: string }>();
  const cid = Number(id);
  const { pode } = useAuth();
  const podeConciliar = pode("conciliacao.conciliar");
  const aposGravar = useAposGravar(cid);
  const [popup, setPopup] = useState<"pagar" | "receber" | "baixas" | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [desfazer, setDesfazer] = useState(false);
  const [regras, setRegras] = useState(false);
  const [enviar, setEnviar] = useState(false);
  const q = useQuery({ queryKey: chaveConciliacao(cid), queryFn: () => api.get<ConciliacaoDetalhe>(`/financeiro/conciliacao/${cid}`), meta: { silencioso: true }, retry: false });
  const ignorar = useMutation({
    mutationFn: ({ l, voltar }: { l: LinhaOut; voltar: boolean }) => api.post<ConciliacaoDetalhe>(`/financeiro/conciliacao/${cid}/ignorar`, { linha_ids: [l.id] }, { query: { voltar } }),
    onSuccess: (c, v) => {
      aposGravar(c);
      toast.success(v.voltar ? "Linha de volta à conciliação." : "Linha ignorada: saiu da contagem.");
    },
  });
  const desfazerLinha = useMutation({
    mutationFn: (l: LinhaOut) => api.post<DesfeitoOut>(`/financeiro/conciliacao/${cid}/desfazer`, { linha_ids: [l.id] }),
    onSuccess: (r) => {
      aposGravar(r.conciliacao);
      if (r.nao_desfeitas.length) toast.error(r.nao_desfeitas[0].motivo);
      else toast.success(r.avisos[0] ?? r.mensagem);
    },
  });

  if (q.isPending)
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  if (!q.data)
    return (
      <EmptyState
        icone={SearchX}
        titulo="Conciliação não encontrada"
        descricao="Ela pode ter sido excluída, ou o seu perfil não tem acesso."
        acao={
          <Button variant="outline" nativeButton={false} render={<Link href="/financeiro/conciliacao" />}>
            Voltar
          </Button>
        }
      />
    );
  const c = q.data;
  const r = c.resumo;
  const pendente = (l: LinhaOut) => l.situacao === "baixa_sugerida" || l.situacao === "sem_correspondencia";
  const FILTROS: { id: Filtro; l: string; n: number; f: (l: LinhaOut) => boolean }[] = [
    { id: "todas", l: "Todas", n: c.linhas.length, f: () => true },
    { id: "pendentes", l: "Pendentes", n: r.pendentes, f: pendente },
    { id: "conciliadas", l: "Já conciliadas", n: r.conciliadas, f: (l) => l.situacao === "conciliada" },
    { id: "feitas", l: "Lançadas aqui", n: r.feitas, f: (l) => l.situacao === "feita" },
    { id: "ignoradas", l: "Ignoradas", n: r.ignoradas, f: (l) => l.situacao === "ignorada" },
  ];
  const linhas = c.linhas.filter(FILTROS.find((f) => f.id === filtro)!.f);
  const irPara = (f: Filtro, alvo = "linhas") => {
    setFiltro(f);
    document.getElementById(alvo)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div>
      <Link href="/financeiro/conciliacao" className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Conciliações
      </Link>
      <div className="card-surface mb-5 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Conciliação · {c.conta_nome}</h1>
              {r.pendentes === 0 ? <Pill tom="success">tudo conferido</Pill> : <Pill tom="warning">{r.pendentes} pendente(s)</Pill>}
            </div>
            <p className="mt-1 text-sm break-words text-muted-foreground">
              <span className="font-mono text-[13px]">{c.arquivo_nome}</span> · {data(c.periodo_de)} a {data(c.periodo_ate)}
              {c.banco && ` · ${c.banco}`} · enviado {c.usuario_nome ? `por ${c.usuario_nome} ` : ""}em {dataHora(c.criado_em)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {c.qtd_linhas} linha(s) deste arquivo
              {c.qtd_repetidas > 0 && ` · ${c.qtd_repetidas} já tinham vindo em outro extrato desta conta e não entraram de novo`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<Link href={`/financeiro/contas/${c.conta_id}`} />}>
              Ver a conta
            </Button>
            <Button variant="outline" onClick={() => setRegras(true)}>
              <GraduationCap /> O que o sistema aprendeu
            </Button>
            {podeConciliar && (
              <>
                <Button variant="outline" onClick={() => setDesfazer(true)}>
                  <Undo2 /> Desfazer
                </Button>
                <Button onClick={() => setEnviar(true)}>
                  <UploadCloud /> Outro extrato
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground" data-testid="resumo-frase">
        <strong className="text-foreground">{r.pagar_criar}</strong> conta(s) a pagar para criar · <strong className="text-foreground">{r.receber_criar}</strong>{" "}
        recebimento(s) para criar · <strong className="text-foreground">{r.baixas}</strong> baixa(s) sugerida(s) ·{" "}
        <strong className="text-foreground">{r.conciliadas}</strong> já conciliada(s)
        {r.feitas > 0 && (
          <>
            {" "}
            · <strong className="text-foreground">{r.feitas}</strong> lançada(s) aqui
          </>
        )}{" "}
        · <strong className="text-foreground">{r.so_no_sistema}</strong> só no sistema
        {podeConciliar ? ". Nada é gravado sem a sua confirmação." : "."}
      </p>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Grupo rotulo="Contas a pagar para criar" qtd={r.pagar_criar} detalhe={r.pagar_criar ? `${moeda(r.valor_pagar_criar)} em saídas sem lançamento` : "Nenhuma saída sem lançamento"} icone={ArrowUpRight} tom="danger" acao={podeConciliar ? "Revisar e criar" : undefined} onClick={podeConciliar ? () => setPopup("pagar") : undefined} />
        <Grupo rotulo="Recebimentos para criar" qtd={r.receber_criar} detalhe={r.receber_criar ? `${moeda(r.valor_receber_criar)} em entradas sem fatura` : "Nenhuma entrada sem fatura"} icone={ArrowDownLeft} tom="success" acao={podeConciliar ? "Revisar e criar" : undefined} onClick={podeConciliar ? () => setPopup("receber") : undefined} />
        <Grupo rotulo="Baixas sugeridas" qtd={r.baixas} detalhe={r.baixas ? `${r.baixas_alta} de alta confiança` : "Nenhum título em aberto casou"} icone={GitCompareArrows} tom="warning" acao={podeConciliar ? "Conferir os pares" : undefined} onClick={podeConciliar ? () => setPopup("baixas") : undefined} />
        <Grupo rotulo="Já conciliadas" qtd={r.conciliadas + r.feitas} detalhe={r.feitas ? `${r.conciliadas} já estavam no sistema · ${r.feitas} lançadas aqui` : "Já estavam lançadas no sistema"} icone={CircleCheck} tom="brand" acao="Ver" onClick={() => irPara(r.conciliadas ? "conciliadas" : "feitas")} />
        <Grupo rotulo="Só no sistema" qtd={r.so_no_sistema} detalhe="Lançado na conta e não veio no extrato" icone={SearchX} tom="neutral" acao="Ver" onClick={() => irPara(filtro, "so-no-sistema")} />
      </div>

      <Fechamento c={c} />

      <section id="linhas" className={cn("card-surface scroll-mt-4 overflow-hidden transition-opacity", q.isFetching && "opacity-70")} aria-label="Linhas do extrato">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <h2 className="mr-2 text-sm font-semibold">Linhas do extrato</h2>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", filtro === f.id ? "border-brand/50 bg-brand/10 text-info-ink" : "text-muted-foreground hover:bg-muted")}
            >
              {f.l} <span className="tabular-nums opacity-70">{f.n}</span>
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-24 px-4 py-2.5 font-medium">Data</th>
                <th className="w-[27%] px-3 py-2.5 font-medium">No extrato do banco</th>
                <th className="w-32 px-3 py-2.5 text-right font-medium">Valor</th>
                <th className="w-[136px] px-3 py-2.5 font-medium">Situação</th>
                <th className="px-3 py-2.5 font-medium">No sistema</th>
                <th className="w-28 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {linhas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma linha neste filtro.
                  </td>
                </tr>
              )}
              {linhas.map((l) => (
                <tr key={l.id} className="group align-top hover:bg-accent/30">
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{data(l.data)}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-mono text-xs break-words">{l.descricao || "sem descrição"}</p>
                    {l.documento && <p className="font-mono text-[11px] text-muted-foreground">doc {l.documento}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ValorLinha l={l} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tom={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].l}</Pill>
                    {l.situacao === "baixa_sugerida" && <p className="mt-1 text-[11px] text-muted-foreground">confiança {l.confianca === "alta" ? "alta" : "média"}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    <DetalheLinha l={l} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {podeConciliar && pendente(l) && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" title="Não lançar esta linha" disabled={ignorar.isPending} onClick={() => ignorar.mutate({ l, voltar: false })}>
                        <EyeOff /> Ignorar
                      </Button>
                    )}
                    {podeConciliar && l.situacao === "ignorada" && (
                      <Button variant="ghost" size="sm" disabled={ignorar.isPending} onClick={() => ignorar.mutate({ l, voltar: true })}>
                        <Undo2 /> Voltar
                      </Button>
                    )}
                    {podeConciliar && l.situacao === "feita" && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" title="Desfaz só o que esta linha criou ou baixou" disabled={desfazerLinha.isPending} onClick={() => desfazerLinha.mutate(l)}>
                        <Undo2 /> Desfazer
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="so-no-sistema" className="card-surface mt-5 scroll-mt-4 overflow-hidden" aria-label="Só no sistema">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Só no sistema ({c.so_no_sistema.length})</h2>
          <p className="text-xs text-muted-foreground">
            Está lançado nesta conta entre {data(c.periodo_de)} e {data(c.periodo_ate)} e não veio em nenhum extrato. Pode ser digitação errada, baixa indevida ou um
            lançamento de outra data. Nada é apagado por aqui: abra a origem para corrigir.
          </p>
        </div>
        {c.so_no_sistema.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Tudo o que está lançado no período apareceu no extrato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-24 px-4 py-2.5 font-medium">Data</th>
                  <th className="px-3 py-2.5 font-medium">Lançamento no sistema</th>
                  <th className="w-44 px-3 py-2.5 font-medium">Origem</th>
                  <th className="w-32 px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="w-36 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {c.so_no_sistema.map((s) => (
                  <tr key={s.id} className="hover:bg-accent/30">
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{data(s.data)}</td>
                    <td className="max-w-0 px-3 py-2.5">
                      <p className="truncate" title={s.descricao}>
                        {s.descricao}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{ORIGEM[s.origem] ?? s.origem}</td>
                    <td className="px-3 py-2.5 text-right">
                      <ValorLinha l={s} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs">
                      <Link href={s.fatura_id ? `/nfse/faturas/${s.fatura_id}` : s.conta_pagar_id ? `/financeiro/pagar/${s.conta_pagar_id}` : `/financeiro/contas/${c.conta_id}`} className="text-info-ink hover:underline">
                        {s.fatura_id ? "abrir a fatura" : s.conta_pagar_id ? "abrir a conta a pagar" : "abrir o extrato"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {popup === "pagar" && <CriarPagarDialog conc={c} onFechar={() => setPopup(null)} />}
      {popup === "receber" && <CriarReceberDialog conc={c} onFechar={() => setPopup(null)} />}
      {popup === "baixas" && <BaixasDialog conc={c} onFechar={() => setPopup(null)} />}
      <DesfazerDialog conc={c} open={desfazer} onOpenChange={setDesfazer} />
      <RegrasDialog open={regras} onOpenChange={setRegras} podeEditar={podeConciliar} />
      {enviar && <EnviarExtratoDialog open onOpenChange={setEnviar} contaId={c.conta_id} />}
    </div>
  );
}
