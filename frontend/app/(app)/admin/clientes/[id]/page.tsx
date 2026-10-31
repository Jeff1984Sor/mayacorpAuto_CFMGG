"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  FileText,
  Globe,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ClienteDialog } from "@/components/admin/cliente-dialog";
import { BotaoIAAdmin } from "@/components/admin/ia";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AbaCobrancas } from "@/components/admin/cobranca";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ClienteSaaS,
  type ContratoCliente,
  type ModeloContrato,
  ROTULO_STATUS,
  type StatusCliente,
  TOM_STATUS,
  type UsoCliente,
  type UsuarioCliente,
  ROTULO_CONTRATO,
} from "@/lib/admin";
import { abrirArquivo, api } from "@/lib/api";
import { data, dataHora, documento, moeda, toNum } from "@/lib/format";

export default function FichaClientePage() {
  const { id } = useParams<{ id: string }>();
  const abaInicial = useSearchParams().get("aba") ?? "uso";
  const qc = useQueryClient();
  const [editar, setEditar] = useState(false);
  const [mudar, setMudar] = useState<StatusCliente | null>(null);
  const c = useQuery({
    queryKey: ["admin", "cliente", id],
    queryFn: () => api.get<ClienteSaaS>(`/admin/clientes/${id}`),
  });
  const status = useMutation({
    mutationFn: (s: StatusCliente) =>
      api.post<ClienteSaaS>(`/admin/clientes/${id}/status`, { status: s }),
    onSuccess: (r) => {
      toast.success(`${r.nome}: ${ROTULO_STATUS[r.status]}`);
      setMudar(null);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  if (c.isPending) return <Skeleton className="h-72 rounded-2xl" />;
  if (!c.data) return null;
  const cli = c.data;

  return (
    <div>
      <Link
        href="/admin/clientes"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Clientes
      </Link>
      <div className="card-surface mb-5 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {cli.nome}
              </h1>
              <Pill tom={TOM_STATUS[cli.status]}>
                {ROTULO_STATUS[cli.status]}
              </Pill>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {cli.slug}
              {cli.documento && ` · ${documento(cli.documento)}`}
              {cli.banco_principal && " · banco principal"}
            </p>
            <p className="mt-2 text-sm">
              {cli.plano ? (
                <>
                  Plano <b>{cli.plano.nome}</b> ({cli.ciclo}) ·{" "}
                  {moeda(cli.valor_com_desconto ?? cli.valor)}
                  {toNum(cli.desconto_percentual) > 0 && (
                    <span className="text-success-ink">
                      {" "}
                      (−{toNum(cli.desconto_percentual)}% por{" "}
                      {cli.indicacoes_ativas} indicação(ões); cheio{" "}
                      {moeda(cli.valor)})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">
                  Sem plano definido
                </span>
              )}
              {cli.inicio_contrato && (
                <span className="text-muted-foreground">
                  {" "}
                  · contrato desde {data(cli.inicio_contrato)}
                </span>
              )}
              {cli.status === "teste" && cli.teste_ate && (
                <span className="text-muted-foreground">
                  {" "}
                  · teste até {data(cli.teste_ate)}
                </span>
              )}
            </p>
            {cli.indicado_por && (
              <p className="mt-1 text-xs text-muted-foreground">
                Indicado por {cli.indicado_por.nome}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditar(true)}>
              <Pencil /> Ficha
            </Button>
            <NativeSelect
              aria-label="Situação do cliente"
              value=""
              onChange={(e) =>
                e.target.value && setMudar(e.target.value as StatusCliente)
              }
              className="h-8 w-44"
            >
              <option value="">Mudar situação…</option>
              {(Object.keys(ROTULO_STATUS) as StatusCliente[])
                .filter((s) => s !== cli.status)
                .map((s) => (
                  <option key={s} value={s}>
                    {ROTULO_STATUS[s]}
                  </option>
                ))}
            </NativeSelect>
          </div>
        </div>
      </div>

      <Tabs defaultValue={abaInicial}>
        <TabsList>
          <TabsTrigger value="uso">Uso e dados</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="dominios">Domínios</TabsTrigger>
          <TabsTrigger value="contratos">Contratos</TabsTrigger>
          <TabsTrigger value="cobrancas">Cobranças</TabsTrigger>
        </TabsList>
        <TabsContent value="uso">
          <AbaUso cli={cli} />
        </TabsContent>
        <TabsContent value="usuarios">
          <AbaUsuarios cli={cli} />
        </TabsContent>
        <TabsContent value="dominios">
          <AbaDominios cli={cli} />
        </TabsContent>
        <TabsContent value="contratos">
          <AbaContratos cli={cli} />
        </TabsContent>
        <TabsContent value="cobrancas">
          <AbaCobrancas cli={cli} />
        </TabsContent>
      </Tabs>

      <ClienteDialog open={editar} onOpenChange={setEditar} cliente={cli} />
      <ConfirmDialog
        open={!!mudar}
        onOpenChange={(o) => !o && setMudar(null)}
        titulo={mudar ? `Mudar para "${ROTULO_STATUS[mudar]}"?` : ""}
        descricao={
          mudar === "inativo"
            ? "Ninguém do escritório consegue entrar enquanto estiver inativo. Os dados são mantidos."
            : mudar === "suspenso"
              ? "O escritório continua entrando normalmente; serve para marcar quem está com pagamento em atraso."
              : "O escritório volta a entrar normalmente."
        }
        confirmar="Confirmar"
        destrutivo={mudar === "inativo"}
        carregando={status.isPending}
        onConfirm={() => mudar && status.mutate(mudar)}
      />
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-sm">{valor || "—"}</p>
    </div>
  );
}

function Medidor({
  rotulo,
  usado,
  limite,
}: {
  rotulo: string;
  usado: number;
  limite: number | null;
}) {
  const pct = limite ? Math.min(100, (usado / limite) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{rotulo}</span>
        <span className="font-mono tabular-nums">
          {usado} / {limite ?? "∞"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={
            pct >= 100
              ? "h-full bg-danger"
              : pct >= 80
                ? "h-full bg-warning"
                : "h-full bg-brand"
          }
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function AbaUso({ cli }: { cli: ClienteSaaS }) {
  const uso = useQuery({
    queryKey: ["admin", "uso", cli.id],
    queryFn: () => api.get<UsoCliente>(`/admin/clientes/${cli.id}/uso`),
  });
  const u = uso.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card-surface space-y-4 p-5">
        <p className="font-medium">
          Uso do mês {u ? `(${u.mes.split("-").reverse().join("/")})` : ""}
        </p>
        {u ? (
          <>
            <Medidor
              rotulo="Usuários com acesso"
              usado={u.usuarios}
              limite={u.limite_usuarios}
            />
            <Medidor
              rotulo="Notas fiscais emitidas"
              usado={u.notas_mes}
              limite={u.limite_notas}
            />
            <p className="text-sm text-muted-foreground">
              Excedente do mês:{" "}
              <b className="text-foreground">{moeda(u.valor_excedente)}</b>
              {(u.usuarios_excedentes > 0 || u.notas_excedentes > 0) &&
                ` (${u.usuarios_excedentes} usuário(s) e ${u.notas_excedentes} nota(s) acima do plano)`}
            </p>
          </>
        ) : (
          <Skeleton className="h-24" />
        )}
      </div>
      <div className="card-surface grid grid-cols-2 gap-4 p-5">
        <Info rotulo="Responsável" valor={cli.responsavel} />
        <Info rotulo="E-mail do financeiro" valor={cli.email_financeiro} />
        <Info rotulo="Telefone" valor={cli.telefone} />
        <Info rotulo="Cliente desde" valor={data(cli.criado_em)} />
        <div className="col-span-2">
          <Info rotulo="Observação" valor={cli.observacao} />
        </div>
      </div>
    </div>
  );
}

function AbaUsuarios({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [zerar, setZerar] = useState<UsuarioCliente | null>(null);
  const [f, setF] = useState({ nome: "", email: "", perfil: "Administrador" });
  const chave = ["admin", "usuarios", cli.id];
  const lista = useQuery({
    queryKey: chave,
    queryFn: () =>
      api.get<UsuarioCliente[]>(`/admin/clientes/${cli.id}/usuarios`),
  });
  const criar = useMutation({
    mutationFn: () =>
      api.post<UsuarioCliente>(`/admin/clientes/${cli.id}/usuarios`, f),
    onSuccess: (u) => {
      toast.success(`Convite enviado para ${u.email}`);
      setNovo(false);
      setF({ nome: "", email: "", perfil: "Administrador" });
      qc.invalidateQueries({ queryKey: chave });
    },
  });
  const zerarSenha = useMutation({
    mutationFn: (u: UsuarioCliente) =>
      api.post<{ mensagem: string }>(
        `/admin/clientes/${cli.id}/usuarios/${u.id}/zerar-senha`,
      ),
    onSuccess: (r) => {
      toast.success(r.mensagem);
      setZerar(null);
      qc.invalidateQueries({ queryKey: chave });
    },
  });
  const boasVindas = useMutation({
    mutationFn: () =>
      api.post<{ link: string; enviado_para: string }>(
        `/admin/clientes/${cli.id}/boas-vindas`,
      ),
    onSuccess: (r) =>
      toast.success(`Boas-vindas reenviadas para ${r.enviado_para}`, {
        action: {
          label: "Copiar link",
          onClick: () => navigator.clipboard.writeText(r.link),
        },
      }),
  });
  const ativo = useMutation({
    mutationFn: ({ u, v }: { u: UsuarioCliente; v: boolean }) =>
      api.post(`/admin/clientes/${cli.id}/usuarios/${u.id}/ativo`, {
        ativo: v,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex items-center justify-between border-b p-3">
        <p className="text-sm text-muted-foreground">
          Usuários do ambiente do cliente
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={boasVindas.isPending}
            onClick={() => boasVindas.mutate()}
          >
            <Mail /> Reenviar boas-vindas
          </Button>
          <Button size="sm" onClick={() => setNovo(true)}>
            <UserPlus /> Novo usuário
          </Button>
        </div>
      </div>
      {lista.isPending ? (
        <Skeleton className="m-4 h-32" />
      ) : !lista.data?.length ? (
        <EmptyState
          icone={Users}
          titulo="Nenhum usuário"
          descricao="Crie o primeiro acesso do escritório."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Nome</th>
                <th className="px-3 py-2.5 font-medium">Perfil</th>
                <th className="px-3 py-2.5 font-medium">Último acesso</th>
                <th className="px-3 py-2.5 font-medium">Ativo</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lista.data.map((u) => (
                <tr key={u.id} className={u.ativo ? "" : "opacity-60"}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.email}
                      {u.convite_pendente && (
                        <Pill className="ml-1.5">convite pendente</Pill>
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-3">{u.perfil}</td>
                  <td className="px-3 py-3 text-xs">
                    {u.ultimo_acesso ? dataHora(u.ultimo_acesso) : "nunca"}
                  </td>
                  <td className="px-3 py-3">
                    <Switch
                      checked={u.ativo}
                      onCheckedChange={(v) => ativo.mutate({ u, v })}
                      aria-label={`Ativo: ${u.nome}`}
                    />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setZerar(u)}
                    >
                      <KeyRound /> Zerar senha
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormDialog
        open={novo}
        onOpenChange={setNovo}
        titulo="Novo usuário do cliente"
        descricao="A pessoa recebe um convite por e-mail para criar a senha."
        salvando={criar.isPending}
        rotuloSalvar="Enviar convite"
        onSubmit={(e) => {
          e.preventDefault();
          criar.mutate();
        }}
      >
        <div className="grid gap-4">
          <Field label="Nome" obrigatorio htmlFor="usu-nome">
            <Input
              id="usu-nome"
              value={f.nome}
              onChange={(e) => setF({ ...f, nome: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="E-mail" obrigatorio htmlFor="usu-email">
            <Input
              id="usu-email"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Perfil" htmlFor="usu-perfil">
            <NativeSelect
              id="usu-perfil"
              value={f.perfil}
              onChange={(e) => setF({ ...f, perfil: e.target.value })}
            >
              <option>Administrador</option>
              <option>Operador</option>
              <option>Visualizador</option>
            </NativeSelect>
          </Field>
        </div>
      </FormDialog>
      <ConfirmDialog
        open={!!zerar}
        onOpenChange={(o) => !o && setZerar(null)}
        titulo={zerar ? `Zerar a senha de ${zerar.nome}?` : ""}
        descricao="A senha atual deixa de funcionar na hora e a pessoa recebe por e-mail o link para criar outra."
        confirmar="Zerar senha"
        destrutivo
        carregando={zerarSenha.isPending}
        onConfirm={() => zerar && zerarSenha.mutate(zerar)}
      />
    </div>
  );
}

function AbaDominios({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const [host, setHost] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api.post(`/admin/clientes/${cli.id}/dominios`, { host: host.trim() }),
    onSuccess: () => {
      toast.success(
        "Domínio cadastrado. Aponte o DNS dele para o servidor do MayaJus.",
      );
      setHost("");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const del = useMutation({
    mutationFn: (did: number) =>
      api.del(`/admin/clientes/${cli.id}/dominios/${did}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
  return (
    <div className="card-surface space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        Quem entra por um destes endereços cai direto no ambiente do cliente,
        com o nome e o logo dele. Sem domínio próprio, o escritório entra pelo
        endereço principal do MayaJus e é reconhecido pelo login.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (host.trim()) add.mutate();
        }}
      >
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="sistema.escritorio.com.br"
          className="max-w-sm font-mono"
          aria-label="Novo domínio"
        />
        <Button type="submit" disabled={add.isPending}>
          <Plus /> Adicionar
        </Button>
      </form>
      {cli.dominios.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum domínio próprio.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {cli.dominios.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between px-3 py-2"
            >
              <span className="flex items-center gap-2 font-mono text-sm">
                <Globe className="size-4 text-muted-foreground" /> {d.host}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover ${d.host}`}
                onClick={() => del.mutate(d.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AbaContratos({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const chave = ["admin", "contratos", cli.id];
  const modelos = useQuery({
    queryKey: ["admin", "modelos"],
    queryFn: () => api.get<ModeloContrato[]>("/admin/modelos-contrato"),
  });
  const lista = useQuery({
    queryKey: chave,
    queryFn: () =>
      api.get<ContratoCliente[]>(`/admin/clientes/${cli.id}/contratos`),
  });
  const [modelo, setModelo] = useState("");
  const [aberto, setAberto] = useState<ContratoCliente | null>(null);
  const [envio, setEnvio] = useState<ContratoCliente | null>(null);
  const [para, setPara] = useState("");
  const [mensagem, setMensagem] = useState("");
  const gerar = useMutation({
    mutationFn: () =>
      api.post<ContratoCliente>(`/admin/clientes/${cli.id}/contratos`, {
        modelo_id: Number(modelo),
      }),
    onSuccess: (k) => {
      if (k.variaveis_vazias?.length)
        toast.warning(
          `Campos sem valor na ficha: ${k.variaveis_vazias.join(", ")}. Confira o texto.`,
        );
      else toast.success("Contrato gerado. Revise e envie.");
      setAberto(k);
      qc.invalidateQueries({ queryKey: chave });
    },
  });
  const salvar = useMutation({
    mutationFn: (k: ContratoCliente) =>
      api.put<ContratoCliente>(`/admin/contratos/${k.id}`, {
        titulo: k.titulo,
        corpo: k.corpo,
      }),
    onSuccess: () => {
      toast.success("Contrato salvo");
      setAberto(null);
      qc.invalidateQueries({ queryKey: chave });
    },
  });
  const enviar = useMutation({
    mutationFn: () =>
      api.post<ContratoCliente>(`/admin/contratos/${envio!.id}/enviar`, {
        para: para.split(/[,;\s]+/).filter(Boolean),
        mensagem: mensagem.trim() || null,
      }),
    onSuccess: (k) => {
      toast.success(`Contrato enviado para ${k.enviado_para.join(", ")}`);
      setEnvio(null);
      qc.invalidateQueries({ queryKey: chave });
    },
  });
  const marcar = useMutation({
    mutationFn: ({
      k,
      s,
    }: {
      k: ContratoCliente;
      s: "assinado" | "cancelado";
    }) => api.post(`/admin/contratos/${k.id}/status`, { status: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });
  const ativos = (modelos.data ?? []).filter((m) => m.ativo);

  return (
    <div className="card-surface overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <NativeSelect
          aria-label="Modelo de contrato"
          value={modelo}
          onChange={(e) => setModelo(e.target.value)}
          className="h-9 w-72"
        >
          <option value="">
            {ativos.length ? "Escolha o modelo…" : "Cadastre um modelo antes"}
          </option>
          {ativos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          disabled={!modelo || gerar.isPending}
          onClick={() => gerar.mutate()}
        >
          <FileText /> Gerar contrato
        </Button>
        <Link
          href="/admin/contratos?aba=modelos"
          className="ml-auto text-xs text-muted-foreground hover:underline"
        >
          Modelos de contrato
        </Link>
      </div>
      {!lista.data?.length ? (
        <EmptyState
          icone={FileText}
          titulo="Nenhum contrato"
          descricao="Gere a partir de um modelo: os dados da ficha entram sozinhos."
        />
      ) : (
        <ul className="divide-y">
          {lista.data.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{k.titulo}</p>
                <p className="text-xs text-muted-foreground">
                  Gerado em {data(k.criado_em)}
                  {k.enviado_em &&
                    ` · enviado em ${dataHora(k.enviado_em)} para ${k.enviado_para.join(", ")}`}
                </p>
              </div>
              <Pill tom={ROTULO_CONTRATO[k.status][1]}>
                {ROTULO_CONTRATO[k.status][0]}
              </Pill>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => abrirArquivo(`/admin/contratos/${k.id}/pdf`)}
              >
                PDF
              </Button>
              {k.status === "rascunho" && (
                <Button variant="ghost" size="sm" onClick={() => setAberto(k)}>
                  <Pencil /> Revisar
                </Button>
              )}
              {k.status !== "cancelado" && k.status !== "assinado" && (
                <Button
                  size="sm"
                  onClick={() => {
                    setPara(cli.email_financeiro ?? "");
                    setMensagem("");
                    setEnvio(k);
                  }}
                >
                  <Send /> Enviar
                </Button>
              )}
              {k.status === "enviado" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => marcar.mutate({ k, s: "assinado" })}
                >
                  Marcar assinado
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormDialog
        open={!!aberto}
        onOpenChange={(o) => !o && setAberto(null)}
        titulo="Revisar contrato"
        descricao="O texto já vem com os dados da ficha. Ajuste o que precisar antes de enviar."
        largura="xl"
        salvando={salvar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (aberto) salvar.mutate(aberto);
        }}
      >
        {aberto && (
          <div className="grid gap-4">
            <Field label="Título" htmlFor="ct-titulo">
              <Input
                id="ct-titulo"
                value={aberto.titulo}
                onChange={(e) =>
                  setAberto({ ...aberto, titulo: e.target.value })
                }
              />
            </Field>
            <BotaoIAAdmin<{ corpo: string; resumo: string }, string>
              rota="/admin/ia/contrato"
              rotulo="Revisar com IA"
              corpo={() => ({
                instrucao:
                  "revise o texto: clareza, coerência e português, sem mudar valores e prazos",
                corpo: aberto.corpo,
              })}
              atual={aberto.corpo}
              aplicar={(r) => {
                setAberto((a) => (a ? { ...a, corpo: r.corpo } : a));
                if (r.resumo) toast.success(r.resumo);
              }}
              restaurar={(v) => setAberto((a) => (a ? { ...a, corpo: v } : a))}
            />
            <Field label="Texto" htmlFor="ct-corpo">
              <Textarea
                id="ct-corpo"
                rows={18}
                value={aberto.corpo}
                onChange={(e) =>
                  setAberto({ ...aberto, corpo: e.target.value })
                }
                className="font-mono text-xs"
              />
            </Field>
          </div>
        )}
      </FormDialog>
      <FormDialog
        open={!!envio}
        onOpenChange={(o) => !o && setEnvio(null)}
        titulo="Enviar contrato por e-mail"
        descricao="O PDF vai em anexo."
        salvando={enviar.isPending}
        rotuloSalvar="Enviar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!para.trim()) return toast.error("Informe o e-mail.");
          enviar.mutate();
        }}
      >
        <div className="grid gap-4">
          <Field
            label="Para"
            obrigatorio
            htmlFor="ct-para"
            dica="Separe vários e-mails com vírgula."
          >
            <Input
              id="ct-para"
              value={para}
              onChange={(e) => setPara(e.target.value)}
            />
          </Field>
          <BotaoIAAdmin<{ mensagem: string }, string>
            rota="/admin/ia/mensagem"
            rotulo="Escrever com IA"
            corpo={() => ({ titulo: envio?.titulo ?? "", cliente_id: cli.id })}
            atual={mensagem}
            aplicar={(r) => setMensagem(r.mensagem)}
            restaurar={setMensagem}
          />
          <Field
            label="Mensagem"
            htmlFor="ct-msg"
            dica="Opcional; sem ela vai um texto padrão."
          >
            <Textarea
              id="ct-msg"
              rows={4}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
            />
          </Field>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> {envio?.titulo}
          </p>
        </div>
      </FormDialog>
    </div>
  );
}
