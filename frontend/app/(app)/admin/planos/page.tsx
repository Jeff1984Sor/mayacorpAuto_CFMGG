"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, Gift, LifeBuoy, Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { usePlanos } from "@/components/admin/cliente-dialog";
import {
  linhaClicavel,
  TableCard,
  TableSkeleton,
} from "@/components/mayacorp/data-table";
import { Field } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { PageHeader } from "@/components/mayacorp/page-header";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { PlanoIn, PlanoOut, PoliticaIndicacao, Rotulo } from "@/lib/admin";
import { api } from "@/lib/api";
import { moeda, toNum } from "@/lib/format";

const novoPlano = (): PlanoIn => ({
  nome: "",
  preco_mensal: "0",
  preco_anual: "0",
  usuarios: 1,
  notas_mes: 20,
  preco_nota_excedente: "0.50",
  preco_usuario_adicional: "49.90",
  recursos: ["gestao"],
  ativo: true,
  ordem: 99,
});

export default function PlanosPage() {
  const planos = usePlanos();
  const recursos = useQuery({
    queryKey: ["admin", "recursos"],
    queryFn: () => api.get<Rotulo[]>("/admin/recursos"),
  });
  const [edit, setEdit] = useState<{ p: PlanoOut | null } | null>(null);
  const rot = (k: string) =>
    recursos.data?.find((r) => r.chave === k)?.rotulo ?? k;

  return (
    <div>
      <PageHeader
        titulo="Planos e indicação"
        icone={BadgeDollarSign}
        migalhas={[{ label: "MayaCorp" }, { label: "Planos" }]}
        acoes={
          <Button onClick={() => setEdit({ p: null })}>
            <Plus /> Novo plano
          </Button>
        }
      />
      <TableCard>
        {planos.isPending ? (
          <TableSkeleton colunas={7} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Plano</th>
                  <th className="px-3 py-2.5 text-right font-medium">Mensal</th>
                  <th className="px-3 py-2.5 text-right font-medium">Anual</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Usuários
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    Notas/mês
                  </th>
                  <th className="px-3 py-2.5 font-medium">Excedentes</th>
                  <th className="px-3 py-2.5 font-medium">Recursos</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {planos.data?.map((p) => (
                  <tr
                    key={p.id}
                    className={linhaClicavel + (p.ativo ? "" : " opacity-60")}
                    onClick={() => setEdit({ p })}
                  >
                    <td className="px-4 py-3 font-medium">
                      {p.nome} {!p.ativo && <Pill>inativo</Pill>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {moeda(p.preco_mensal)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {moeda(p.preco_anual)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {p.usuarios ?? "∞"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {p.notas_mes ?? "∞"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      nota {moeda(p.preco_nota_excedente)} · usuário{" "}
                      {moeda(p.preco_usuario_adicional)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.recursos.map((r) => (
                          <Pill key={r} tom="brand">
                            {rot(r)}
                          </Pill>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>

      <Indicacao />
      <SenhaSuporte />
      <PlanoDialog
        edit={edit}
        onClose={() => setEdit(null)}
        recursos={recursos.data ?? []}
      />
    </div>
  );
}

function PlanoDialog({
  edit,
  onClose,
  recursos,
}: {
  edit: { p: PlanoOut | null } | null;
  onClose: () => void;
  recursos: Rotulo[];
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<PlanoIn>(novoPlano);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (edit) setF(edit.p ? { ...edit.p } : novoPlano());
  }, [edit]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const set = <K extends keyof PlanoIn>(k: K, v: PlanoIn[K]) =>
    setF((o) => ({ ...o, [k]: v }));
  const salvar = useMutation({
    mutationFn: () =>
      edit?.p
        ? api.put(`/admin/planos/${edit.p.id}`, f)
        : api.post("/admin/planos", f),
    onSuccess: () => {
      toast.success("Plano salvo");
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <FormDialog
      open={!!edit}
      onOpenChange={(o) => !o && onClose()}
      titulo={edit?.p ? `Plano ${edit.p.nome}` : "Novo plano"}
      descricao="Limite vazio = ilimitado. Mudanças valem para quem já está no plano."
      largura="lg"
      salvando={salvar.isPending}
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
      rodapeExtra={
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={f.ativo}
            onCheckedChange={(v) => set("ativo", v)}
            aria-label="Plano ativo"
          />{" "}
          Ativo
        </label>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nome"
          obrigatorio
          htmlFor="pl-nome"
          className="sm:col-span-2"
        >
          <Input
            id="pl-nome"
            value={f.nome}
            onChange={(e) => set("nome", e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Mensal (R$)" htmlFor="pl-mensal">
          <Input
            id="pl-mensal"
            type="number"
            step="0.01"
            min={0}
            value={f.preco_mensal}
            onChange={(e) => set("preco_mensal", e.target.value)}
          />
        </Field>
        <Field
          label="Anual (R$)"
          htmlFor="pl-anual"
          dica={`10× o mensal = ${moeda(toNum(f.preco_mensal) * 10)}`}
        >
          <Input
            id="pl-anual"
            type="number"
            step="0.01"
            min={0}
            value={f.preco_anual}
            onChange={(e) => set("preco_anual", e.target.value)}
          />
        </Field>
        <Field label="Usuários incluídos" htmlFor="pl-usu">
          <Input
            id="pl-usu"
            type="number"
            min={1}
            value={f.usuarios ?? ""}
            onChange={(e) => set("usuarios", num(e.target.value))}
            placeholder="ilimitado"
          />
        </Field>
        <Field label="Notas fiscais por mês" htmlFor="pl-notas">
          <Input
            id="pl-notas"
            type="number"
            min={0}
            value={f.notas_mes ?? ""}
            onChange={(e) => set("notas_mes", num(e.target.value))}
            placeholder="ilimitadas"
          />
        </Field>
        <Field label="Nota excedente (R$)" htmlFor="pl-exc">
          <Input
            id="pl-exc"
            type="number"
            step="0.01"
            min={0}
            value={f.preco_nota_excedente}
            onChange={(e) => set("preco_nota_excedente", e.target.value)}
          />
        </Field>
        <Field label="Usuário adicional (R$)" htmlFor="pl-usuad">
          <Input
            id="pl-usuad"
            type="number"
            step="0.01"
            min={0}
            value={f.preco_usuario_adicional}
            onChange={(e) => set("preco_usuario_adicional", e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-2 text-[13px] text-foreground/80">
            Recursos liberados
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {recursos.map((r) => (
              <label
                key={r.chave}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={f.recursos.includes(r.chave)}
                  onCheckedChange={(v) =>
                    set(
                      "recursos",
                      v
                        ? [...f.recursos, r.chave]
                        : f.recursos.filter((x) => x !== r.chave),
                    )
                  }
                />
                {r.rotulo}
              </label>
            ))}
          </div>
        </div>
      </div>
    </FormDialog>
  );
}

function Indicacao() {
  const qc = useQueryClient();
  const pol = useQuery({
    queryKey: ["admin", "politica"],
    queryFn: () => api.get<PoliticaIndicacao>("/admin/politica-indicacao"),
  });
  const [f, setF] = useState({
    desconto_por_indicacao: "",
    desconto_maximo: "",
  });
  /* eslint-disable react-hooks/set-state-in-effect -- carrega a política */
  useEffect(() => {
    if (pol.data)
      setF({
        desconto_por_indicacao: pol.data.desconto_por_indicacao,
        desconto_maximo: pol.data.desconto_maximo,
      });
  }, [pol.data]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const salvar = useMutation({
    mutationFn: () => api.put("/admin/politica-indicacao", f),
    onSuccess: () => {
      toast.success("Política de indicação salva");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const por = toNum(f.desconto_por_indicacao);
  const max = Math.min(toNum(f.desconto_maximo), 10);
  return (
    <form
      className="card-surface mt-5 space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <Gift className="size-5 text-brand" />
        <p className="font-medium">Desconto por indicação</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Cada cliente indicado que está ativo (pagando) dá desconto na
        mensalidade de quem indicou. O desconto soma por indicação e nunca passa
        de {pol.data ? toNum(pol.data.teto) : 10}% da mensalidade.
      </p>
      <div className="grid max-w-md grid-cols-2 gap-4">
        <Field label="% por indicação" htmlFor="ind-por">
          <Input
            id="ind-por"
            type="number"
            step="0.5"
            min={0.5}
            max={10}
            value={f.desconto_por_indicacao}
            onChange={(e) =>
              setF({ ...f, desconto_por_indicacao: e.target.value })
            }
          />
        </Field>
        <Field label="Máximo (%)" htmlFor="ind-max" dica="Até 10%.">
          <Input
            id="ind-max"
            type="number"
            step="0.5"
            min={0.5}
            max={10}
            value={f.desconto_maximo}
            onChange={(e) => setF({ ...f, desconto_maximo: e.target.value })}
          />
        </Field>
      </div>
      {por > 0 && (
        <p className="text-xs text-muted-foreground">
          Exemplo: 1 indicação = {Math.min(por, max)}% · 2 ={" "}
          {Math.min(por * 2, max)}% · 3 = {Math.min(por * 3, max)}%
        </p>
      )}
      <Button type="submit" disabled={salvar.isPending}>
        <Save /> Salvar política
      </Button>
    </form>
  );
}

function SenhaSuporte() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "suporte"],
    queryFn: () => api.get<{ senha_definida: boolean }>("/admin/suporte"),
  });
  const [senha, setSenha] = useState("");
  const salvar = useMutation({
    mutationFn: () => api.put("/admin/suporte", { senha }),
    onSuccess: () => {
      toast.success("Senha do Suporte salva");
      setSenha("");
      qc.invalidateQueries({ queryKey: ["admin", "suporte"] });
    },
  });
  return (
    <form
      className="card-surface mt-5 space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        salvar.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <LifeBuoy className="size-5 text-brand" />
        <p className="font-medium">Usuário Suporte</p>
        {q.data && (
          <Pill tom={q.data.senha_definida ? "success" : "warning"}>
            {q.data.senha_definida ? "senha definida" : "sem senha"}
          </Pill>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Todo escritório novo ganha o usuário <b>Suporte</b> (login{" "}
        <span className="font-mono">suporte.identificador</span>), com esta
        senha. Ele não conta no limite de usuários do plano. A senha fica
        guardada cifrada; mudar aqui vale para os próximos escritórios.
      </p>
      <div className="flex max-w-md items-end gap-3">
        <Field
          label={q.data?.senha_definida ? "Nova senha" : "Senha"}
          htmlFor="sup-senha"
          className="flex-1"
        >
          <Input
            id="sup-senha"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={salvar.isPending}>
          <Save /> Salvar
        </Button>
      </div>
    </form>
  );
}
