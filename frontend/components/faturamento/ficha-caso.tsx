"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  FileSignature,
  FolderTree,
  Gavel,
  Landmark,
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
import { TOM_STATUS_CASO } from "@/lib/casos";
import { useLinkCliente, useUsaContrato } from "@/lib/contrato";
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
import { useOpcoesCaso } from "./caso/campos";

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
  const nada = (x: React.ReactNode) => x === null || x === undefined || x === "" || x === false;
  const vazio = Array.isArray(children) ? children.every(nada) : nada(children);
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
  const usaContrato = useUsaContrato();
  const linkCliente = useLinkCliente();
  const campos = useCampos();
  const opcoes = useOpcoesCaso();
  /** rótulo de uma lista fixa do sistema (fase, etapa, prognóstico...) */
  const rot = (campo: string, valor: string | null | undefined) => (valor ? (opcoes.data?.opcoes[campo]?.find((o) => o.valor === valor)?.rotulo ?? valor) : null);
  const dinheiro = (v: string | null | undefined) => (v != null && toNum(v) ? moeda(v) : null);
  const dia = (v: string | null | undefined) => (v ? data(v) : null);
  const simNao = (v: boolean | null | undefined) => (v ? "Sim" : null);
  const outroCaso = (id: number | null | undefined, titulo: string | null | undefined) =>
    id ? (
      <Link href={`/faturamento/casos/${id}`} className="text-info-ink hover:underline">
        {titulo ?? `Caso nº ${id}`}
      </Link>
    ) : null;
  const cont = caso.contencioso;
  const cons = caso.consultivo;
  const adm = caso.administrativo;
  const ts = useQuery({
    queryKey: ["fat", "timesheet", caso.id],
    queryFn: () =>
      api.get<TimesheetOut[]>(`/faturamento/casos/${caso.id}/timesheet`),
  });
  const extras = camposDaArea(campos.data, caso.area_id, caso.tomador_id);
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
          <Item rotulo="Tipo de caso">
            {caso.tipo_caso_nome}
            {caso.tipo_nome && caso.tipo_nome !== caso.tipo_caso_nome ? ` · ${caso.tipo_nome}` : ""}
          </Item>
          <Item rotulo="Área de atuação">
            {caso.area_nome && (
              <AreaBadge nome={caso.area_nome} cor={caso.area_cor} />
            )}
          </Item>
          {(caso.tipo_caso === "contencioso" || caso.numero_processo) && (
            <Item rotulo="Nº do processo" mono>
              {caso.numero_processo}
            </Item>
          )}
          <Item rotulo="Responsável">{caso.responsavel_nome}</Item>
          <Item rotulo="Situação">
            <StatusBadge tom={TOM_STATUS_CASO[caso.status] ?? "neutral"} label={caso.status_nome} />
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
          {caso.status === "encerrado" && <Item rotulo="Motivo do encerramento">{caso.motivo_encerramento_nome}</Item>}
          <Item rotulo="Equipe" largo>
            {caso.equipe.length ? caso.equipe.map((e) => e.nome).join(", ") : null}
          </Item>
          <Item rotulo="Partes" largo>
            {(caso.partes_resumo || caso.parte_contraria) && (
              <button type="button" onClick={() => irPara("partes")} className="text-left text-info-ink hover:underline">
                {caso.partes_resumo ?? caso.parte_contraria}
              </button>
            )}
          </Item>
        </Grupo>

        {(caso.tipo_caso === "contencioso" || caso.tribunal) && (
          <Grupo titulo="Dados do processo" icone={Gavel}>
            {cont?.pre_ajuizamento && <Item rotulo="Situação do processo">Ainda não ajuizado</Item>}
            <Item rotulo="Justiça">{rot("justica", cont?.justica)}</Item>
            <Item rotulo="Instância">{caso.instancia_nome}</Item>
            <Item rotulo="Fase processual">{rot("fase_processual", cont?.fase_processual)}</Item>
            <Item rotulo="Lado do cliente">
              {caso.polo ? ROTULO_POLO[caso.polo] : null}
            </Item>
            <Item rotulo="Tribunal">
              {caso.tribunal}
              {caso.tribunal && cont?.uf ? ` · ${cont.uf}` : (cont?.uf ?? null)}
            </Item>
            <Item rotulo="Comarca">{caso.comarca}</Item>
            <Item rotulo="Vara / órgão julgador">
              {caso.vara}
              {cont?.codigo_orgao ? <span className="text-xs text-muted-foreground"> (órgão {cont.codigo_orgao})</span> : null}
            </Item>
            <Item rotulo="Juiz / relator">{cont?.juiz_relator}</Item>
            <Item rotulo="Classe processual">{cont?.classe_nome}</Item>
            <Item rotulo="Assunto">
              {cont?.assunto_nome}
              {cont?.assuntos_secundarios?.length ? <span className="text-xs text-muted-foreground"> · {cont.assuntos_secundarios.map((a) => a.nome).join(", ")}</span> : null}
            </Item>
            <Item rotulo="Rito">{rot("rito", cont?.rito)}</Item>
            <Item rotulo="Sistema do tribunal">{rot("sistema_tribunal", cont?.sistema_tribunal)}</Item>
            <Item rotulo="Distribuição">{dia(caso.data_distribuicao)}</Item>
            <Item rotulo="Citação">{dia(cont?.data_citacao)}</Item>
            <Item rotulo="Valor da causa" mono>
              {dinheiro(caso.valor_causa)}
            </Item>
            <Item rotulo="Prognóstico de perda">{rot("prognostico", cont?.prognostico)}</Item>
            {cont?.valor_provisionado != null && (
              <Item rotulo="Valor provisionado" mono>
                {dinheiro(cont.valor_provisionado)}
              </Item>
            )}
            {cont?.valor_risco != null && (
              <Item rotulo="Valor em risco" mono>
                {dinheiro(cont.valor_risco)}
              </Item>
            )}
            {cont?.deposito_judicial != null && (
              <Item rotulo="Depósito judicial" mono>
                {dinheiro(cont.deposito_judicial)}
              </Item>
            )}
            {cont?.tutela_liminar && <Item rotulo="Tutela / liminar">{rot("tutela_liminar", cont.tutela_liminar)}</Item>}
            {cont?.resultado && <Item rotulo="Resultado">{rot("resultado", cont.resultado)}</Item>}
            {cont?.valor_condenacao != null && (
              <Item rotulo="Valor da condenação" mono>
                {dinheiro(cont.valor_condenacao)}
              </Item>
            )}
            {cont?.valor_acordo != null && (
              <Item rotulo="Valor do acordo" mono>
                {dinheiro(cont.valor_acordo)}
              </Item>
            )}
            {cont?.data_transito_julgado && <Item rotulo="Trânsito em julgado">{dia(cont.data_transito_julgado)}</Item>}
            {cont?.numero_antigo && (
              <Item rotulo="Número antigo" mono>
                {cont.numero_antigo}
              </Item>
            )}
            {cont && (
              <Item rotulo="Marcações" largo>
                {[cont.justica_gratuita && "Justiça gratuita", cont.segredo_justica && "Segredo de justiça", cont.monitorar_andamentos ? "Acompanha andamentos no tribunal" : "Sem acompanhamento de andamentos"]
                  .filter(Boolean)
                  .join(" · ")}
              </Item>
            )}
          </Grupo>
        )}

        {caso.tipo_caso === "consultivo" && cons && (
          <Grupo titulo="Dados da demanda" icone={ClipboardList}>
            <Item rotulo="Tipo de demanda">{cons.tipo_demanda_nome}</Item>
            <Item rotulo="Etapa">{rot("etapa", cons.etapa)}</Item>
            <Item rotulo="Prioridade">{rot("prioridade", cons.prioridade)}</Item>
            <Item rotulo="Complexidade">{rot("complexidade", cons.complexidade)}</Item>
            <Item rotulo="Quem pediu">
              {cons.solicitante_nome}
              {cons.departamento_solicitante ? <span className="text-xs text-muted-foreground"> · {cons.departamento_solicitante}</span> : null}
            </Item>
            <Item rotulo="Data do pedido">{dia(cons.data_solicitacao)}</Item>
            <Item rotulo="Prazo de entrega">
              {dia(cons.prazo_entrega)}
              {cons.sla_dias != null ? <span className="text-xs text-muted-foreground"> · prazo combinado de {cons.sla_dias} dias</span> : null}
            </Item>
            <Item rotulo="Entregue em">{dia(cons.data_entrega)}</Item>
            <Item rotulo="Horas estimadas · lançadas" mono>
              {cons.horas_estimadas != null || toNum(cons.horas_realizadas) ? `${cons.horas_estimadas != null ? horasDecimal(cons.horas_estimadas) : "—"} · ${horasDecimal(cons.horas_realizadas)}` : null}
            </Item>
            <Item rotulo="Valor envolvido" mono>
              {dinheiro(cons.valor_envolvido)}
            </Item>
            {(cons.contrato_vigencia_inicio || cons.contrato_vigencia_fim) && (
              <Item rotulo="Vigência do contrato analisado">
                {dia(cons.contrato_vigencia_inicio) ?? "—"} a {dia(cons.contrato_vigencia_fim) ?? "—"}
                {cons.renovacao_automatica ? " · renovação automática" : ""}
              </Item>
            )}
            <Item rotulo="Risco identificado">{rot("risco_identificado", cons.risco_identificado)}</Item>
            {cons.gerou_contencioso_id && <Item rotulo="Caso judicial que nasceu daqui">{outroCaso(cons.gerou_contencioso_id, cons.gerou_contencioso_titulo)}</Item>}
            {cons.recomendacao_resumo && (
              <Item rotulo="Resumo da recomendação" largo>
                <span className="whitespace-pre-line">{cons.recomendacao_resumo}</span>
              </Item>
            )}
          </Grupo>
        )}

        {caso.tipo_caso === "administrativo" && adm && (
          <Grupo titulo="Dados do procedimento" icone={Landmark}>
            <Item rotulo="Órgão">
              {adm.orgao_nome}
              {adm.unidade_orgao ? <span className="text-xs text-muted-foreground"> · {adm.unidade_orgao}</span> : null}
            </Item>
            <Item rotulo="Esfera">
              {rot("esfera", adm.esfera)}
              {adm.municipio || adm.uf ? ` · ${[adm.municipio, adm.uf].filter(Boolean).join("/")}` : ""}
            </Item>
            <Item rotulo="Tipo de procedimento" largo>
              {adm.tipo_procedimento_nome}
            </Item>
            <Item rotulo="Fase">{rot("fase_adm", adm.fase_adm)}</Item>
            <Item rotulo="Instância">{rot("instancia_adm", adm.instancia_adm)}</Item>
            <Item rotulo="Nº do processo administrativo" mono>
              {adm.numero_processo_adm}
            </Item>
            <Item rotulo="Nº do protocolo" mono>
              {adm.numero_protocolo}
            </Item>
            {adm.numero_auto_infracao && (
              <Item rotulo="Auto de infração" mono>
                {adm.numero_auto_infracao}
              </Item>
            )}
            {adm.numero_nb && (
              <Item rotulo="Nº do benefício" mono>
                {adm.numero_nb}
              </Item>
            )}
            <Item rotulo="Ciência / notificação">{dia(adm.data_ciencia)}</Item>
            <Item rotulo="Prazo de defesa">{dia(adm.prazo_defesa)}</Item>
            <Item rotulo="Protocolo em">{dia(adm.data_protocolo)}</Item>
            <Item rotulo="Valor autuado" mono>
              {dinheiro(adm.valor_autuado)}
            </Item>
            {(adm.valor_multa != null || adm.valor_juros != null) && (
              <Item rotulo="Multa · juros" mono>
                {dinheiro(adm.valor_multa) ?? "—"} · {dinheiro(adm.valor_juros) ?? "—"}
              </Item>
            )}
            {adm.valor_atualizado != null && (
              <Item rotulo="Valor atualizado" mono>
                {dinheiro(adm.valor_atualizado)}
                {adm.data_atualizacao_valor ? <span className="font-sans text-xs text-muted-foreground"> em {dia(adm.data_atualizacao_valor)}</span> : null}
              </Item>
            )}
            <Item rotulo="Garantia">{rot("garantia", adm.garantia)}</Item>
            <Item rotulo="Exigibilidade suspensa">{simNao(adm.exigibilidade_suspensa)}</Item>
            <Item rotulo="Prognóstico de perda">{rot("prognostico", adm.prognostico)}</Item>
            <Item rotulo="Decisão">
              {rot("decisao", adm.decisao)}
              {adm.data_decisao ? ` · ${dia(adm.data_decisao)}` : ""}
            </Item>
            {adm.cabe_judicializacao && <Item rotulo="Cabe levar à Justiça">Sim{adm.prazo_judicializacao ? ` · até ${dia(adm.prazo_judicializacao)}` : ""}</Item>}
            {adm.caso_judicial_id && <Item rotulo="Caso judicial que nasceu daqui">{outroCaso(adm.caso_judicial_id, adm.caso_judicial_titulo)}</Item>}
            {adm.link_sistema_orgao && (
              <Item rotulo="Sistema do órgão" largo>
                <a href={adm.link_sistema_orgao} target="_blank" rel="noreferrer" className="text-info-ink hover:underline">
                  {adm.link_sistema_orgao}
                </a>
              </Item>
            )}
          </Grupo>
        )}

        <Grupo titulo="Organização" icone={FolderTree}>
          <Item rotulo="Origem da captação">{caso.origem_nome}</Item>
          <Item rotulo="Centro de custo">{caso.centro_custo_nome}</Item>
          <Item rotulo="Valor estimado" mono>
            {dinheiro(caso.valor_estimado)}
          </Item>
          <Item rotulo="Caso sigiloso">{simNao(caso.sigiloso)}</Item>
          <Item rotulo="Etiquetas" largo>
            {caso.etiquetas.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {caso.etiquetas.map((e) => (
                  <span key={e.id} className="rounded-full bg-brand/12 px-2 py-0.5 text-xs">
                    {e.nome}
                  </span>
                ))}
              </span>
            )}
          </Item>
          <Item rotulo="Vinculado ao caso" largo>
            {caso.caso_pai_id ? (
              <>
                {outroCaso(caso.caso_pai_id, caso.caso_pai_titulo)}
                {caso.tipo_vinculo ? <span className="text-xs text-muted-foreground"> · {rot("tipo_vinculo", caso.tipo_vinculo)}</span> : null}
              </>
            ) : null}
          </Item>
          {caso.observacoes && (
            <Item rotulo="Observações internas" largo>
              <span className="whitespace-pre-line">{caso.observacoes}</span>
            </Item>
          )}
        </Grupo>

        <Grupo titulo={usaContrato ? "Contrato e cobrança" : "Cliente e cobrança"} icone={FileSignature}>
          <Item rotulo="Cliente">
            {usaContrato ? (
              caso.tomador_nome
            ) : (
              <Link href={linkCliente(caso.tomador_id)} className="text-info-ink hover:underline">
                {caso.tomador_nome}
              </Link>
            )}
          </Item>
          {usaContrato && (
            <Item rotulo="Contrato">
              <Link
                href={`/faturamento/contratos/${caso.contrato_id}`}
                className="text-info-ink hover:underline"
              >
                #{caso.contrato_numero} {caso.contrato_nome}
              </Link>
            </Item>
          )}
          <Item rotulo="Tabela de preço">
            {caso.tabela_preco_efetiva ? (
              <>
                {caso.tabela_preco_efetiva}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  {caso.tabela_preco_id ? "(do caso)" : usaContrato ? "(do contrato)" : "(do cliente)"}
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
                : usaContrato ? "Segue o contrato" : "Segue o cliente"}
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
