"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, ScrollText } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  linhaClicavel,
  TableCard,
  TableSkeleton,
} from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { BotaoIAAdmin } from "@/components/admin/ia";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  type ContratoCliente,
  type ModeloContrato,
  ROTULO_CONTRATO,
  type Rotulo,
} from "@/lib/admin";
import { api } from "@/lib/api";
import { data, dataHora } from "@/lib/format";

const EXEMPLO = `CONTRATO DE LICENÇA DE USO DO MAYAJUS

CONTRATANTE: {{cliente_nome}}, inscrito no CNPJ/CPF {{cliente_documento}}, neste ato representado por {{responsavel}}.

CONTRATADA: MayaCorp.

1. OBJETO. Licença de uso do sistema MayaJus no plano {{plano}}, com até {{usuarios}} usuários e {{notas_mes}} notas fiscais por mês.

2. PREÇO. Cobrança {{ciclo}} de R$ {{valor}}. Nota excedente: R$ {{nota_excedente}}. Usuário adicional: R$ {{usuario_adicional}} por mês.

3. VIGÊNCIA. A partir de {{data_inicio}}, por prazo indeterminado.

São Paulo, {{data_hoje}}.`;

/** Contratos dos clientes e os modelos de onde eles saem, numa tela só. */
export default function ContratosPage() {
  const lista = useQuery({
    queryKey: ["admin", "modelos"],
    queryFn: () => api.get<ModeloContrato[]>("/admin/modelos-contrato"),
  });
  const [edit, setEdit] = useState<{ m: ModeloContrato | null } | null>(null);
  const [aba, setAba] = useState(
    useSearchParams().get("aba") === "modelos" ? "modelos" : "contratos",
  );
  return (
    <div>
      <PageHeader
        titulo="Contratos"
        icone={ScrollText}
        migalhas={[{ label: "MayaCorp" }, { label: "Contratos" }]}
        acoes={
          aba === "modelos" && (
            <Button onClick={() => setEdit({ m: null })}>
              <Plus /> Novo modelo
            </Button>
          )
        }
      />
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="contratos">Contratos dos clientes</TabsTrigger>
          <TabsTrigger value="modelos">Modelos</TabsTrigger>
        </TabsList>
        <TabsContent value="contratos">
          <ContratosGerados irParaModelos={() => setAba("modelos")} />
        </TabsContent>
        <TabsContent value="modelos">
          <TableCard>
            {lista.isPending ? (
              <TableSkeleton colunas={3} />
            ) : !lista.data?.length ? (
              <EmptyState
                icone={ScrollText}
                titulo="Nenhum modelo de contrato"
                descricao="Escreva o contrato uma vez com {{variáveis}}; na ficha do cliente ele sai preenchido, em PDF, pronto para enviar."
                acao={
                  <Button onClick={() => setEdit({ m: null })}>
                    <Plus /> Novo modelo
                  </Button>
                }
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Modelo</th>
                    <th className="px-3 py-2.5 font-medium">Atualizado</th>
                    <th className="px-3 py-2.5 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lista.data.map((m) => (
                    <tr
                      key={m.id}
                      className={linhaClicavel}
                      onClick={() => setEdit({ m })}
                    >
                      <td className="px-4 py-3 font-medium">
                        {m.nome}
                        {m.variaveis_desconhecidas.length > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-xs text-warning-ink">
                            <AlertTriangle className="size-3" /> variável
                            desconhecida
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {dataHora(m.atualizado_em)}
                      </td>
                      <td className="px-3 py-3">
                        <Pill tom={m.ativo ? "success" : "neutral"}>
                          {m.ativo ? "Ativo" : "Inativo"}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        </TabsContent>
      </Tabs>
      <ModeloDialog edit={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ContratosGerados({ irParaModelos }: { irParaModelos: () => void }) {
  const router = useRouter();
  const lista = useQuery({
    queryKey: ["admin", "contratos"],
    queryFn: () => api.get<ContratoCliente[]>("/admin/contratos"),
  });
  return (
    <TableCard>
      {lista.isPending ? (
        <TableSkeleton colunas={4} />
      ) : !lista.data?.length ? (
        <EmptyState
          icone={ScrollText}
          titulo="Nenhum contrato gerado"
          descricao="Abra o cliente, aba Contratos, e gere a partir de um modelo: os dados da ficha entram sozinhos."
          acao={
            <Button variant="outline" onClick={irParaModelos}>
              Ver modelos
            </Button>
          }
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">Contrato</th>
              <th className="px-3 py-2.5 font-medium">Criado</th>
              <th className="px-3 py-2.5 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lista.data.map((k) => (
              <tr
                key={k.id}
                className={linhaClicavel}
                onClick={() =>
                  router.push(`/admin/clientes/${k.cliente_id}?aba=contratos`)
                }
              >
                <td className="px-4 py-3 font-medium">{k.cliente_nome}</td>
                <td className="px-3 py-3">{k.titulo}</td>
                <td className="px-3 py-3 text-xs">{data(k.criado_em)}</td>
                <td className="px-3 py-3">
                  <Pill tom={ROTULO_CONTRATO[k.status][1]}>
                    {ROTULO_CONTRATO[k.status][0]}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function ModeloDialog({
  edit,
  onClose,
}: {
  edit: { m: ModeloContrato | null } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const vars = useQuery({
    queryKey: ["admin", "variaveis"],
    queryFn: () => api.get<Rotulo[]>("/admin/contratos/variaveis"),
  });
  const [f, setF] = useState({ nome: "", corpo: "", ativo: true });
  const [pedido, setPedido] = useState("");
  const texto = useRef<HTMLTextAreaElement>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (edit)
      setF(
        edit.m
          ? { nome: edit.m.nome, corpo: edit.m.corpo, ativo: edit.m.ativo }
          : {
              nome: "Contrato de licença MayaJus",
              corpo: EXEMPLO,
              ativo: true,
            },
      );
  }, [edit]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () =>
      edit?.m
        ? api.put<ModeloContrato>(`/admin/modelos-contrato/${edit.m.id}`, f)
        : api.post<ModeloContrato>("/admin/modelos-contrato", f),
    onSuccess: (m) => {
      if (m.variaveis_desconhecidas.length)
        toast.warning(
          `Variáveis que o sistema não conhece: ${m.variaveis_desconhecidas.join(", ")}`,
        );
      else toast.success("Modelo salvo");
      qc.invalidateQueries({ queryKey: ["admin", "modelos"] });
      onClose();
    },
  });
  const inserir = (chave: string) => {
    const el = texto.current;
    const tag = `{{${chave}}}`;
    if (!el) return setF((o) => ({ ...o, corpo: o.corpo + tag }));
    const ini = el.selectionStart ?? f.corpo.length;
    const fim = el.selectionEnd ?? ini;
    setF((o) => ({
      ...o,
      corpo: o.corpo.slice(0, ini) + tag + o.corpo.slice(fim),
    }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + tag.length, ini + tag.length);
    });
  };
  return (
    <FormDialog
      open={!!edit}
      onOpenChange={(o) => !o && onClose()}
      titulo={edit?.m ? edit.m.nome : "Novo modelo de contrato"}
      descricao="Clique numa variável para inserir no ponto do cursor. Ela é trocada pelos dados da ficha do cliente."
      largura="xl"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={f.ativo}
            onCheckedChange={(v) => setF({ ...f, ativo: v })}
            aria-label="Modelo ativo"
          />{" "}
          Ativo
        </label>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="grid gap-4">
          <Field label="Nome do modelo" obrigatorio htmlFor="mod-nome">
            <Input
              id="mod-nome"
              value={f.nome}
              onChange={(e) => setF({ ...f, nome: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Pedido para a IA"
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              placeholder="Ex.: inclua cláusula de LGPD e multa de 2% por atraso"
              className="min-w-64 flex-1"
            />
            <BotaoIAAdmin<
              {
                corpo: string;
                resumo: string;
                variaveis_desconhecidas: string[];
              },
              string
            >
              rota="/admin/ia/contrato"
              rotulo={f.corpo.trim() ? "Melhorar com IA" : "Escrever com IA"}
              corpo={() => ({
                instrucao: pedido.trim() || null,
                corpo: f.corpo.trim() || null,
              })}
              atual={f.corpo}
              aplicar={(r) => {
                setF((o) => ({ ...o, corpo: r.corpo }));
                if (r.variaveis_desconhecidas.length)
                  toast.warning(
                    `A IA usou variáveis que não existem: ${r.variaveis_desconhecidas.join(", ")}`,
                  );
                else if (r.resumo) toast.success(r.resumo);
              }}
              restaurar={(v) => setF((o) => ({ ...o, corpo: v }))}
            />
          </div>
          <Field
            label="Texto"
            obrigatorio
            htmlFor="mod-corpo"
            dica="Deixe uma linha em branco entre os parágrafos."
          >
            <Textarea
              ref={texto}
              id="mod-corpo"
              rows={20}
              value={f.corpo}
              onChange={(e) => setF({ ...f, corpo: e.target.value })}
              className="font-mono text-xs"
            />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[13px] text-foreground/80">Variáveis</p>
          <div className="flex flex-wrap gap-1.5 lg:flex-col">
            {vars.data?.map((v) => (
              <button
                key={v.chave}
                type="button"
                onClick={() => inserir(v.chave)}
                className="rounded-md border px-2 py-1 text-left text-xs transition hover:border-brand/50 hover:bg-brand/5"
                title={`{{${v.chave}}}`}
              >
                {v.rotulo}
              </button>
            ))}
          </div>
        </div>
      </div>
    </FormDialog>
  );
}
