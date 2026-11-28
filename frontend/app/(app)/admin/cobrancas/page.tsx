"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CalendarPlus,
  CheckCircle2,
  Copy,
  HandCoins,
  Link2,
  Plus,
  ReceiptText,
  Repeat,
  Send,
  Settings2,
  Wallet,
  FileText,
  Loader2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AvulsaDialog,
  copiarLink,
  NaoEnviada,
} from "@/components/admin/cobranca";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import {
  Segmented,
  TableCard,
  TableSkeleton,
  Toolbar,
} from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect, SwitchRow } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { KpiCard } from "@/components/mayacorp/kpi-card";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { BotaoExcluir } from "@/components/admin/excluir";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  type Cobranca,
  type ConfigCobranca,
  passoRegua,
  type ResumoCobranca,
  ROTULO_TIPO_COBRANCA,
  type StatusCobranca,
  TOM_COBRANCA,
} from "@/lib/admin";
import { abrirArquivo, api } from "@/lib/api";
import { useEmissoras } from "@/hooks/use-nfse";
import { data, moeda } from "@/lib/format";

const TIPO = ROTULO_TIPO_COBRANCA;

export default function CobrancasPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusCobranca | "todas">("todas");
  const [tipo, setTipo] = useState<Cobranca["tipo"] | "todos">("todos");
  const [avulsa, setAvulsa] = useState(false);
  const [gerar, setGerar] = useState(false);
  const [mp, setMp] = useState(false);
  const [acao, setAcao] = useState<{
    k: Cobranca;
    tipo: "baixa" | "cancelar";
  } | null>(null);
  const cfg = useQuery({
    queryKey: ["admin", "cobranca-config"],
    queryFn: () => api.get<ConfigCobranca>("/admin/cobranca/config"),
  });
  const resumo = useQuery({
    queryKey: ["admin", "cobrancas", "resumo"],
    queryFn: () => api.get<ResumoCobranca>("/admin/cobrancas/resumo"),
  });
  const lista = useQuery({
    queryKey: ["admin", "cobrancas", status, tipo],
    queryFn: () =>
      api.get<Cobranca[]>("/admin/cobrancas", {
        status: status === "todas" ? undefined : status,
        tipo: tipo === "todos" ? undefined : tipo,
      }),
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const enviar = useMutation({
    mutationFn: (k: Cobranca) =>
      api.post<Cobranca & { enviado_para: string[] }>(
        `/admin/cobrancas/${k.id}/enviar`,
      ),
    onSuccess: (r) => {
      toast.success(`Cobrança enviada para ${r.enviado_para.join(", ")}`);
      atualizar();
    },
  });
  const executar = useMutation({
    mutationFn: () =>
      acao!.tipo === "baixa"
        ? api.post(`/admin/cobrancas/${acao!.k.id}/baixa`, { forma: "manual" })
        : api.post(`/admin/cobrancas/${acao!.k.id}/cancelar`),
    onSuccess: () => {
      toast.success(
        acao!.tipo === "baixa" ? "Baixa registrada" : "Cobrança cancelada",
      );
      setAcao(null);
      atualizar();
    },
  });
  const nota = useMutation({
    mutationFn: (k: Cobranca) => api.post<Cobranca>(`/admin/cobrancas/${k.id}/nfse`),
    onSuccess: (k) => {
      toast.success(`NFS-e nº ${k.nfse_numero} emitida e enviada ao cliente`);
      atualizar();
    },
    onError: () => atualizar(),
  });
  const r = resumo.data;
  const conectado = cfg.data?.conectado;

  return (
    <div>
      <PageHeader
        titulo="Cobranças"
        icone={HandCoins}
        migalhas={[{ label: "MayaCorp" }, { label: "Cobranças" }]}
        acoes={
          <>
            <Button variant="outline" onClick={() => setMp(true)}>
              <Settings2 /> Mercado Pago
            </Button>
            <Button
              variant="outline"
              disabled={!conectado}
              onClick={() => setGerar(true)}
            >
              <CalendarPlus /> Gerar mensalidades
            </Button>
            <Button disabled={!conectado} onClick={() => setAvulsa(true)}>
              <Plus /> Cobrança avulsa
            </Button>
          </>
        }
      />

      {cfg.data && !conectado && (
        <div className="card-surface mb-5 flex flex-wrap items-center gap-3 border-warning/40 p-4 text-sm">
          <AlertTriangle className="size-5 text-warning-ink" />
          <span className="flex-1">
            Conecte a conta do Mercado Pago da MayaCorp para gerar links de
            pagamento e assinaturas.
          </span>
          <Button size="sm" onClick={() => setMp(true)}>
            Conectar
          </Button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          titulo="Receita recorrente"
          icone={Repeat}
          carregando={!r}
          valor={r ? moeda(r.receita_recorrente) : "—"}
        />
        <KpiCard
          titulo="Recebido no mês"
          icone={CheckCircle2}
          indice={1}
          carregando={!r}
          valor={r ? moeda(r.recebido_mes) : "—"}
        />
        <KpiCard
          titulo="Em aberto (a vencer)"
          icone={Wallet}
          indice={2}
          carregando={!r}
          valor={r ? moeda(r.em_aberto) : "—"}
        />
        <KpiCard
          titulo="Vencido"
          icone={AlertTriangle}
          indice={3}
          carregando={!r}
          valor={r ? moeda(r.vencido) : "—"}
        />
        <KpiCard
          titulo="Clientes em atraso"
          icone={ReceiptText}
          indice={4}
          carregando={!r}
          valor={r ? String(r.inadimplentes) : "—"}
        />
      </div>
      {r && (
        <p className="-mt-3 mb-5 text-xs text-muted-foreground">
          Receita recorrente prevista por mês: as mensalidades de plano (as
          anuais entram divididas por 12). Os outros serviços cobrados dos
          clientes são regras de cobrança e aparecem em Faturamento › Itens a
          faturar.
        </p>
      )}
      {r && r.nao_enviadas > 0 && (
        <p className="mb-5 flex items-start gap-2 rounded-lg bg-warning/12 px-3 py-2 text-sm text-warning-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {r.nao_enviadas === 1
              ? "1 cobrança em aberto não foi enviada"
              : `${r.nao_enviadas} cobranças em aberto não foram enviadas`}
            . Elas estão marcadas na lista: confira o e-mail do financeiro na
            ficha do cliente e use “Enviar por e-mail”.
          </span>
        </p>
      )}

      <TableCard>
        <Toolbar>
          <Segmented
            value={status}
            onChange={setStatus}
            opcoes={[
              { value: "todas", label: "Todas" },
              { value: "pendente", label: "Em aberto" },
              { value: "vencida", label: "Vencidas", tom: "danger" },
              { value: "paga", label: "Pagas", tom: "success" },
              { value: "cancelada", label: "Canceladas" },
            ]}
          />
          <NativeSelect
            aria-label="Tipo de cobrança"
            value={tipo}
            onChange={(e) =>
              setTipo(e.target.value as Cobranca["tipo"] | "todos")
            }
            className="h-9 w-48"
          >
            <option value="todos">Todos os tipos</option>
            {(Object.keys(TIPO) as Cobranca["tipo"][]).map((t) => (
              <option key={t} value={t}>
                {TIPO[t]}
              </option>
            ))}
          </NativeSelect>
        </Toolbar>
        {lista.isPending ? (
          <TableSkeleton colunas={6} />
        ) : !lista.data?.length ? (
          <EmptyState
            icone={HandCoins}
            titulo="Nenhuma cobrança"
            descricao="As mensalidades saem sozinhas todo dia 1 (com o Mercado Pago conectado). Você também pode gerar agora ou criar uma cobrança avulsa. Outros serviços são regras de cobrança do cliente e aparecem em Faturamento › Itens a faturar."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Cobrança</th>
                  <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-3 py-2.5 font-medium">Nota fiscal</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lista.data.map((k) => (
                  <tr key={k.id}>
                    <td className="px-4 py-3 font-medium">
                      {k.cliente_nome}
                      {k.cliente_tipo === "externo" && (
                        <div className="text-[11px] font-normal text-muted-foreground">
                          sem acesso ao sistema
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {k.descricao}
                      <div className="text-xs text-muted-foreground">
                        {TIPO[k.tipo]}
                        {k.itens.length > 1 &&
                          ` · ${k.itens.map((i) => i.descricao).join(" · ")}`}
                      </div>
                      <NaoEnviada k={k} />
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {moeda(k.valor)}
                    </td>
                    <td className="px-3 py-3 text-xs">{data(k.vencimento)}</td>
                    <td className="px-3 py-3">
                      <Pill tom={TOM_COBRANCA[k.status]}>
                        {k.status_rotulo}
                      </Pill>
                      {k.status === "paga" && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {data(k.pago_em)} · {k.forma_paga}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {k.nfse_status === "emitida" && k.nfse_numero ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium text-info-ink hover:underline"
                          title={k.nfse_chave ? `Chave de acesso ${k.nfse_chave}` : undefined}
                          onClick={() => abrirArquivo(`/admin/cobrancas/${k.id}/nfse/pdf`).catch((e: Error) => toast.error(e.message))}
                        >
                          <FileText className="size-3.5" /> NFS-e nº {k.nfse_numero}
                        </button>
                      ) : k.nfse_status === "emitindo" ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> Emitindo…
                        </span>
                      ) : k.nfse_status === "erro" ? (
                        <span className="block max-w-56 text-danger-ink" title={k.nfse_erro ?? undefined}>
                          Não emitida: {k.nfse_erro}
                        </span>
                      ) : k.nfse_status === "cancelada" ? (
                        <span className="text-muted-foreground">NFS-e nº {k.nfse_numero} cancelada</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {k.status === "paga" && (!k.nfse_status || k.nfse_status === "erro" || k.nfse_status === "cancelada") && (
                        <Button
                          size="xs"
                          variant="outline"
                          className="mt-1"
                          disabled={nota.isPending}
                          onClick={() => nota.mutate(k)}
                        >
                          {nota.isPending && nota.variables?.id === k.id ? <Loader2 className="animate-spin" /> : <FileText />}
                          {k.nfse_status ? "Emitir de novo" : "Emitir NFS-e"}
                        </Button>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        {k.link &&
                          (k.status === "pendente" ||
                            k.status === "vencida") && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Copiar link de pagamento"
                              onClick={() => copiarLink(k.link!)}
                            >
                              <Copy />
                            </Button>
                          )}
                        {(k.status === "pendente" ||
                          k.status === "vencida") && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Enviar por e-mail"
                              disabled={enviar.isPending}
                              onClick={() => enviar.mutate(k)}
                            >
                              <Send />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Dar baixa (recebido fora do Mercado Pago)"
                              onClick={() => setAcao({ k, tipo: "baixa" })}
                            >
                              <CheckCircle2 />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Cancelar"
                              onClick={() => setAcao({ k, tipo: "cancelar" })}
                            >
                              <Ban />
                            </Button>
                          </>
                        )}
                        {k.status !== "paga" && (
                          <BotaoExcluir
                            icone
                            url={`/admin/cobrancas/${k.id}`}
                            titulo="Excluir a cobrança?"
                            descricao={`${k.cliente_nome}: ${k.descricao}. Use para cobrança criada por engano; o link do Mercado Pago deixa de valer para nós.`}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <AvulsaDialog open={avulsa} onClose={() => setAvulsa(false)} />
      <GerarDialog open={gerar} onClose={() => setGerar(false)} />
      <MercadoPagoDialog
        open={mp}
        onClose={() => setMp(false)}
        cfg={cfg.data}
      />
      <ConfirmDialog
        open={!!acao}
        onOpenChange={(o) => !o && setAcao(null)}
        titulo={
          acao?.tipo === "baixa" ? "Dar baixa manual?" : "Cancelar a cobrança?"
        }
        descricao={
          acao &&
          (acao.tipo === "baixa"
            ? `${acao.k.cliente_nome}: ${moeda(acao.k.valor)} entra como paga (recebida fora do Mercado Pago).`
            : `${acao.k.cliente_nome}: ${acao.k.descricao}. O link deixa de valer para nós e a régua para de enviar.`)
        }
        confirmar={acao?.tipo === "baixa" ? "Dar baixa" : "Cancelar cobrança"}
        destrutivo={acao?.tipo === "cancelar"}
        carregando={executar.isPending}
        onConfirm={() => executar.mutate()}
      />
    </div>
  );
}

function GerarDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [comp, setComp] = useState(() => new Date().toISOString().slice(0, 7));
  const [enviar, setEnviar] = useState(true);
  const gerar = useMutation({
    mutationFn: () =>
      api.post<{ criadas: string[]; erros: string[] }>(
        "/admin/cobrancas/gerar",
        { competencia: comp, enviar },
      ),
    onSuccess: (r) => {
      if (r.erros.length)
        toast.warning(
          `${r.criadas.length} gerada(s). Problemas: ${r.erros.join(" · ")}`,
          { duration: 12000 },
        );
      else
        toast.success(
          r.criadas.length
            ? `${r.criadas.length} mensalidade(s) gerada(s)`
            : "Nada novo: as mensalidades do mês já existem",
        );
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo="Gerar mensalidades"
      descricao="Uma por cliente ativo: plano (com desconto por indicação) + excedentes do mês anterior. As que já existem não são duplicadas."
      salvando={gerar.isPending}
      rotuloSalvar="Gerar"
      onSubmit={(e) => {
        e.preventDefault();
        gerar.mutate();
      }}
    >
      <div className="space-y-4">
        <Field label="Mês" htmlFor="ger-mes">
          <Input
            id="ger-mes"
            type="month"
            required
            value={comp}
            onChange={(e) => setComp(e.target.value)}
            className="max-w-48"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enviar} onCheckedChange={setEnviar} /> Enviar o link
          por e-mail agora
        </label>
      </div>
    </FormDialog>
  );
}

function MercadoPagoDialog({
  open,
  onClose,
  cfg,
}: {
  open: boolean;
  onClose: () => void;
  cfg?: ConfigCobranca;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    token: "",
    segredo: "",
    dia_vencimento: 10,
    gerar_automatico: true,
    regua: "-3, 0, 3, 10",
    nfse_automatica: false,
    nfse_emissora_id: "" as string,
    nfse_descricao: "",
  });
  const emissoras = useEmissoras();
  /* eslint-disable react-hooks/set-state-in-effect -- carrega ao abrir */
  useEffect(() => {
    if (open && cfg)
      setF({
        token: "",
        segredo: "",
        dia_vencimento: cfg.dia_vencimento,
        gerar_automatico: cfg.gerar_automatico,
        regua: cfg.regua.join(", "),
        nfse_automatica: cfg.nfse_automatica,
        nfse_emissora_id: cfg.nfse_emissora_id ? String(cfg.nfse_emissora_id) : "",
        nfse_descricao: cfg.nfse_descricao ?? "",
      });
  }, [open, cfg]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const regua = f.regua
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const salvar = useMutation({
    mutationFn: () =>
      api.put<ConfigCobranca>("/admin/cobranca/config", {
        ...f,
        token: f.token || null,
        segredo: f.segredo || null,
        regua,
        nfse_emissora_id: f.nfse_emissora_id ? Number(f.nfse_emissora_id) : null,
        nfse_descricao: f.nfse_descricao.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(
        r.conectado
          ? `Mercado Pago conectado (${r.conta})`
          : "Configuração salva",
      );
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  const testar = useMutation({
    mutationFn: () =>
      api.post<{ conta: string }>("/admin/cobranca/config/testar"),
    onSuccess: (r) => toast.success(`Conexão ok: ${r.conta}`),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo="Mercado Pago"
      descricao="A conta da MayaCorp que recebe as mensalidades. As chaves ficam cifradas."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
      rodapeExtra={
        cfg?.conectado && (
          <Button
            type="button"
            variant="outline"
            disabled={testar.isPending}
            onClick={() => testar.mutate()}
          >
            <Link2 /> Testar conexão
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {cfg?.conectado && (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success-ink">
            Conectado à conta <b>{cfg.conta}</b>. Para trocar, cole outro Access
            Token.
          </p>
        )}
        <Field
          label="Access Token de produção"
          htmlFor="mp-token"
          dica="Mercado Pago › Seu negócio › Configurações › Credenciais (ou mercadopago.com.br/developers › Suas integrações › Credenciais de produção). Começa com APP_USR-."
        >
          <Input
            id="mp-token"
            type="password"
            autoComplete="off"
            value={f.token}
            onChange={(e) => setF({ ...f, token: e.target.value })}
            placeholder={
              cfg?.conectado ? "•••••••• (mantém o atual)" : "APP_USR-…"
            }
          />
        </Field>
        <Field
          label="Assinatura secreta das notificações (opcional)"
          htmlFor="mp-seg"
          dica={`Em Suas integrações › Webhooks, cadastre a URL abaixo (eventos: Pagamentos e Planos e assinaturas) e cole aqui a assinatura secreta.`}
        >
          <Input
            id="mp-seg"
            type="password"
            autoComplete="off"
            value={f.segredo}
            onChange={(e) => setF({ ...f, segredo: e.target.value })}
            placeholder={
              cfg?.segredo_definido ? "•••••••• (mantém a atual)" : ""
            }
          />
        </Field>
        {cfg?.url_notificacao && (
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs">
            <span className="flex-1 truncate">{cfg.url_notificacao}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => copiarLink(cfg.url_notificacao!)}
            >
              <Copy />
            </Button>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dia do vencimento" htmlFor="mp-dia" dica="Do 1 ao 28.">
            <Input
              id="mp-dia"
              type="number"
              min={1}
              max={28}
              value={f.dia_vencimento}
              onChange={(e) =>
                setF({ ...f, dia_vencimento: Number(e.target.value) })
              }
            />
          </Field>
          <Field
            label="Régua de e-mails (dias)"
            htmlFor="mp-regua"
            dica={
              regua.map(passoRegua).join(" · ") ||
              "Negativo = antes do vencimento."
            }
          >
            <Input
              id="mp-regua"
              value={f.regua}
              onChange={(e) => setF({ ...f, regua: e.target.value })}
            />
          </Field>
        </div>
        <SwitchRow
          titulo="Gerar as mensalidades sozinho"
          descricao="Todo dia 1, para os clientes ativos. Atraso só gera aviso; suspender é sempre manual."
        >
          <Switch
            checked={f.gerar_automatico}
            onCheckedChange={(v) => setF({ ...f, gerar_automatico: v })}
          />
        </SwitchRow>
        <SwitchRow
          titulo="Emitir a NFS-e quando a cobrança for paga"
          descricao="A nota sai pela empresa emissora da MayaCorp (com o certificado dela), para o CNPJ do escritório, e vai por e-mail ao financeiro dele."
        >
          <Switch
            checked={f.nfse_automatica}
            onCheckedChange={(v) => setF({ ...f, nfse_automatica: v })}
          />
        </SwitchRow>
        {f.nfse_automatica && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Empresa emissora" htmlFor="mp-emissora" dica="Cadastre em Configurações › Empresas emissoras.">
              <NativeSelect
                id="mp-emissora"
                value={f.nfse_emissora_id}
                onChange={(e) => setF({ ...f, nfse_emissora_id: e.target.value })}
              >
                <option value="">A primeira ativa</option>
                {(emissoras.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razao_social}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Texto da nota"
              htmlFor="mp-texto"
              dica="{descricao} = a descrição da cobrança (ex.: MayaJus 11/2026)."
            >
              <Input
                id="mp-texto"
                value={f.nfse_descricao}
                onChange={(e) => setF({ ...f, nfse_descricao: e.target.value })}
                maxLength={300}
              />
            </Field>
          </div>
        )}
      </div>
    </FormDialog>
  );
}
