"use client";

import { useQuery } from "@tanstack/react-query";
import {
  FileSignature,
  Gavel,
  Layers,
  Pencil,
  ScrollText,
  Timer,
  UserRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  type CasoOut,
  hhmm,
  horasDecimal,
  ROTULO_POLO,
  type TimesheetOut,
} from "@/lib/faturamento";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

import { camposDaArea, exibirCampo, useCampos } from "./campos-adicionais";
import { ehJudicial } from "./judiciario";

export function AreaBadge({
  nome,
  cor,
  className,
}: {
  nome: string | null;
  cor: string | null;
  className?: string;
}) {
  if (!nome) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
      style={{
        background: `color-mix(in oklab, ${cor ?? "#7C8FFF"} 12%, transparent)`,
        color: `color-mix(in oklab, ${cor ?? "#7C8FFF"} 75%, var(--foreground))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${cor ?? "#7C8FFF"} 30%, transparent)`,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: cor ?? "#7C8FFF" }}
      />
      {nome}
    </span>
  );
}

function Grupo({
  titulo,
  icone: I,
  children,
  className,
}: {
  titulo: string;
  icone: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card-surface p-5", className)} aria-label={titulo}>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <I className="size-4 text-info-ink" /> {titulo}
      </h3>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Item({
  rotulo,
  children,
  largo,
  mono,
}: {
  rotulo: string;
  children: React.ReactNode;
  largo?: boolean;
  mono?: boolean;
}) {
  const vazio =
    children === null ||
    children === undefined ||
    children === "" ||
    children === false;
  return (
    <div className={cn("min-w-0", largo && "sm:col-span-2")}>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {rotulo}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm break-words",
          mono && "font-mono",
          vazio && "text-muted-foreground/60",
        )}
      >
        {vazio ? "—" : children}
      </dd>
    </div>
  );
}

/** Aba "Detalhes": a ficha do caso em modo leitura. */
export function DetalhesCaso({
  caso,
  onEditar,
  irPara,
  podeEditar,
}: {
  caso: CasoOut;
  onEditar: () => void;
  irPara: (aba: string) => void;
  podeEditar: boolean;
}) {
  const campos = useCampos();
  const ts = useQuery({
    queryKey: ["fat", "timesheet", caso.id],
    queryFn: () =>
      api.get<TimesheetOut[]>(`/faturamento/casos/${caso.id}/timesheet`),
  });
  const extras = camposDaArea(campos.data, caso.area_id);
  const porProf = new Map<string, number>();
  (ts.data ?? [])
    .filter((t) => t.faturavel && !t.faturado)
    .forEach((t) =>
      porProf.set(
        t.profissional_nome,
        (porProf.get(t.profissional_nome) ?? 0) + t.minutos,
      ),
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => irPara("timesheet")}
          className="card-surface flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-warning/12 text-warning-ink">
            <Timer className="size-5" />
          </span>
          <span>
            <span className="block text-xs text-muted-foreground">
              Horas a faturar
            </span>
            <span className="block font-mono text-xl font-semibold tabular-nums">
              {horasDecimal(caso.horas_pendentes)}
            </span>
            {porProf.size > 0 && (
              <span className="block text-[11px] text-muted-foreground">
                {[...porProf.entries()]
                  .map(([n, m]) => `${n.split(" ")[0]} ${hhmm(m)}`)
                  .join(" · ")}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={() => irPara("despesas")}
          className="card-surface flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-info-ink">
            <Wallet className="size-5" />
          </span>
          <span>
            <span className="block text-xs text-muted-foreground">
              Despesas a reembolsar
            </span>
            <span className="block font-mono text-xl font-semibold tabular-nums">
              {moeda(caso.despesas_pendentes)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => irPara("andamentos")}
          className="card-surface flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-success/10 text-success-ink">
            <ScrollText className="size-5" />
          </span>
          <span>
            <span className="block text-xs text-muted-foreground">
              Andamentos
            </span>
            <span className="block text-xl font-semibold tabular-nums">
              {caso.qtd_andamentos}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => irPara("anexos")}
          className="card-surface flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
            <FileSignature className="size-5" />
          </span>
          <span>
            <span className="block text-xs text-muted-foreground">Anexos</span>
            <span className="block text-xl font-semibold tabular-nums">
              {caso.qtd_anexos}
            </span>
          </span>
        </button>
      </div>

      <div className="flex justify-end">
        {podeEditar && (
          <Button variant="outline" size="sm" onClick={onEditar}>
            <Pencil /> Editar ficha
          </Button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Grupo titulo="Identificação" icone={UserRound}>
          <Item rotulo="Título" largo>
            {caso.titulo}
          </Item>
          <Item rotulo="Tipo">{caso.tipo_nome}</Item>
          <Item rotulo="Área de atuação">
            {caso.area_nome && (
              <AreaBadge nome={caso.area_nome} cor={caso.area_cor} />
            )}
          </Item>
          <Item rotulo="Nº do processo" mono>
            {caso.numero_processo}
          </Item>
          <Item rotulo="Responsável">{caso.responsavel_nome}</Item>
          <Item rotulo="Situação">
            <StatusBadge
              tom={caso.status === "aberto" ? "success" : "neutral"}
              label={caso.status === "aberto" ? "Aberto" : "Encerrado"}
            />
          </Item>
          <Item
            rotulo={
              caso.status === "encerrado"
                ? "Abertura · encerramento"
                : "Abertura"
            }
          >
            {caso.data_abertura ? data(caso.data_abertura) : null}
            {caso.status === "encerrado" && caso.data_encerramento
              ? ` · ${data(caso.data_encerramento)}`
              : null}
          </Item>
        </Grupo>

        {(ehJudicial(caso.tipo) || caso.tribunal || caso.numero_processo) && (
          <Grupo titulo="Processo" icone={Gavel}>
            <Item rotulo="Instância">{caso.instancia_nome}</Item>
            <Item rotulo="Polo">
              {caso.polo ? ROTULO_POLO[caso.polo] : null}
            </Item>
            <Item rotulo="Parte contrária">{caso.parte_contraria}</Item>
            <Item rotulo="Tribunal">{caso.tribunal}</Item>
            <Item rotulo="Vara">{caso.vara}</Item>
            <Item rotulo="Comarca">{caso.comarca}</Item>
            <Item rotulo="Distribuição">
              {caso.data_distribuicao ? data(caso.data_distribuicao) : null}
            </Item>
            <Item rotulo="Valor da causa" mono>
              {caso.valor_causa != null && toNum(caso.valor_causa)
                ? moeda(caso.valor_causa)
                : null}
            </Item>
          </Grupo>
        )}

        <Grupo titulo="Contrato e cobrança" icone={FileSignature}>
          <Item rotulo="Cliente">{caso.tomador_nome}</Item>
          <Item rotulo="Contrato">
            <Link
              href={`/faturamento/contratos/${caso.contrato_id}`}
              className="text-info-ink hover:underline"
            >
              #{caso.contrato_numero} {caso.contrato_nome}
            </Link>
          </Item>
          <Item rotulo="Tabela de preço">
            {caso.tabela_preco_efetiva ? (
              <>
                {caso.tabela_preco_efetiva}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  {caso.tabela_preco_id ? "(do caso)" : "(do contrato)"}
                </span>
              </>
            ) : null}
          </Item>
          <Item rotulo="Regra de cobrança">
            <button
              type="button"
              onClick={() => irPara("regra")}
              className="text-info-ink hover:underline"
            >
              {caso.tem_regra_propria
                ? "Regra própria do caso"
                : "Segue o contrato"}
            </button>
          </Item>
        </Grupo>

        <Grupo titulo="Campos adicionais" icone={Layers}>
          {extras.length === 0 ? (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Nenhum campo adicional para esta área.{" "}
              <Link
                href="/configuracoes/faturamento"
                className="text-info-ink hover:underline"
              >
                Criar campos
              </Link>
            </p>
          ) : (
            extras.map((c) => (
              <Item key={c.id} rotulo={c.nome} largo={c.tipo === "texto_longo"}>
                {exibirCampo(c, caso.campos?.[String(c.id)])}
              </Item>
            ))
          )}
        </Grupo>

        <section
          className="card-surface p-5 xl:col-span-2"
          aria-label="Descrição"
        >
          <h3 className="mb-2 text-sm font-semibold">Descrição</h3>
          {caso.descricao ? (
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {caso.descricao}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/60">—</p>
          )}
        </section>
      </div>
    </div>
  );
}
